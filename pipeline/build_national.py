"""Phase 2: national build — all England & Wales LSOAs → PMTiles + details lookup.

Same metric and principles as Phase 1, scaled to ~35k LSOAs and all ~43 forces.
The browser can't load 35k polygons as raw GeoJSON, so we tile with tippecanoe
(→ PMTiles) and render with MapLibre GL. To keep tiles small, only SCALAR stats
ride in the tiles; the per-LSOA category breakdown + monthly sparkline go in a
separate national-details.json fetched lazily on click.

    python pipeline/build_national.py [--refresh-boundaries] [--skip-tiles]

Inputs: pipeline/data/raw/*/*-street.csv (all forces, run download.py --national),
        pipeline/data/interim/census2021-ts001-lsoa.csv (download.py --population).
Outputs: web/data/national.pmtiles, web/data/national-details.json.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import requests

import config
from crime_quality import (CrimeDataQualityError, discover_street_files,
                           quality_metadata, select_latest_window, write_manifest)

UA = {"User-Agent": "student-map-uk/0.2 (+OGL v3 data)"}

# Each bundle's rate/percentile/flag/total is baked into the tiles as scalars under
# a short suffix, so the MapLibre paint can recolour on toggle with no client recompute.
BUNDLE_CODE = {"residential_risk": "res", "footfall_heavy": "foot", "all": "all"}


def _log(m: str) -> None:
    print(m, flush=True)


# --- tippecanoe locator -------------------------------------------------------
def find_tippecanoe() -> str:
    for cand in (os.environ.get("CRIMEMAP_TIPPECANOE"), shutil.which("tippecanoe"),
                 str(Path.home() / ".local/bin/tippecanoe")):
        if cand and Path(cand).exists():
            return cand
    sys.exit("tippecanoe not found. Install it, or set CRIMEMAP_TIPPECANOE=/path/to/tippecanoe.")


# --- Price (ONS HPSSA median price; 2011-LSOA keyed, joined by direct code match) ---
def load_price() -> dict:
    if not config.PRICE_XLS.exists():
        _log("  (no price file — run `python pipeline/download.py --price`; skipping price)")
        return {}
    df = pd.read_excel(config.PRICE_XLS, sheet_name=config.PRICE_SHEET,
                       header=config.PRICE_HEADER_ROW, engine="xlrd", na_values=[":"])
    s = df[[config.PRICE_CODE_COL, config.PRICE_VALUE_COL]].dropna()
    return {str(k): int(v) for k, v in zip(s[config.PRICE_CODE_COL], s[config.PRICE_VALUE_COL])}


def load_rent() -> dict:
    """LAD code → latest mean monthly rent (£), from ONS PIPR."""
    if not config.RENT_XLSX.exists():
        _log("  (no rent file — run `python pipeline/download.py --rent`; skipping yield)")
        return {}
    df = pd.read_excel(config.RENT_XLSX, sheet_name=config.RENT_SHEET,
                       header=config.RENT_HEADER_ROW, engine="openpyxl")
    df = df[[config.RENT_TIME_COL, config.RENT_CODE_COL, config.RENT_VALUE_COL]].copy()
    df = df[df[config.RENT_CODE_COL].astype(str).str.match(r"[EW]0[6-9]")]   # LAD codes only
    df = df.dropna(subset=[config.RENT_VALUE_COL])
    df = df.sort_values(config.RENT_TIME_COL).groupby(config.RENT_CODE_COL).tail(1)  # latest per LAD
    return {str(k): float(v) for k, v in zip(df[config.RENT_CODE_COL], df[config.RENT_VALUE_COL])}


def load_lsoa_lad() -> dict:
    """LSOA21CD → LAD22CD (rent joins by code, not name — recon-confirmed)."""
    if not config.LSOA_LAD_CSV.exists():
        return {}
    df = pd.read_csv(config.LSOA_LAD_CSV, encoding="utf-8-sig",
                     usecols=[config.LSOA_LAD_CODE, config.LSOA_LAD_LAD], dtype=str)
    return dict(zip(df[config.LSOA_LAD_CODE], df[config.LSOA_LAD_LAD]))


# --- 1. Aggregate crime (all forces, incremental to bound memory) -------------
def aggregate_national() -> tuple[pd.DataFrame, list[str], dict]:
    discovered = discover_street_files(config.RAW_DIR)
    try:
        files, months = select_latest_window(discovered, config.WINDOW_MONTHS)
    except CrimeDataQualityError as exc:
        raise CrimeDataQualityError(
            f"Invalid raw crime window under {config.RAW_DIR}: {exc}. "
            "Run: python pipeline/download.py --national"
        ) from exc

    quality = quality_metadata(files, months, config.ENGLAND_WALES_FORCES)
    quality.update({"scope": "national", "phase": "build_input"})
    write_manifest(config.CRIME_COVERAGE_MANIFEST, quality)
    coverage = quality["coverage"]
    if coverage["coverage_ratio"] < config.MIN_FORCE_MONTH_COVERAGE:
        raise CrimeDataQualityError(
            "National raw crime input appears incomplete: observed "
            f"{coverage['observed_expected_force_months']}/{coverage['expected_force_months']} "
            f"expected force-month files ({coverage['coverage_ratio']:.1%}); "
            f"see {config.CRIME_COVERAGE_MANIFEST}"
        )
    if quality["completeness_status"] != "complete":
        _log("  WARNING: partial police.uk force coverage: "
             f"{coverage['observed_expected_force_months']}/{coverage['expected_force_months']} "
             f"force-months; audit → {config.CRIME_COVERAGE_MANIFEST}")
    ignored = len(discovered) - len(files)
    if ignored:
        _log(f"Crime: selected newest exact window; ignored {ignored} retained out-of-window CSV(s).")

    cols = [config.COL_LSOA_CODE, config.COL_LSOA_NAME, config.COL_MONTH, config.COL_CRIME_TYPE]
    bundle = set(config.CATEGORY_BUNDLES[config.DEFAULT_BUNDLE])

    cat_parts, month_parts, names = [], [], {}
    total_rows = dropped = 0
    for i, item in enumerate(files, 1):
        try:
            df = pd.read_csv(item.path, usecols=cols, dtype=str)
        except ValueError as exc:
            raise CrimeDataQualityError(f"invalid police.uk CSV schema in {item.path}: {exc}") from exc
        total_rows += len(df)
        if int(df[config.COL_MONTH].isna().sum()):
            raise CrimeDataQualityError(f"blank Month value(s) in {item.path}")
        content_months = set(df[config.COL_MONTH].unique())
        if content_months and content_months != {item.month}:
            raise CrimeDataQualityError(
                f"filename says {item.month}, but CSV contains {sorted(content_months)}: {item.path}"
            )
        if int(df[config.COL_CRIME_TYPE].isna().sum()):
            raise CrimeDataQualityError(f"blank Crime type value(s) in {item.path}")
        unknown = sorted(set(df[config.COL_CRIME_TYPE].unique()) - config.ALL_CRIME_TYPES)
        if unknown:
            raise CrimeDataQualityError(
                f"unrecognised Crime type(s) in {item.path}: {unknown}; update config.ALL_CRIME_TYPES"
            )
        dropped += int(df[config.COL_LSOA_CODE].isna().sum())
        df = df.dropna(subset=[config.COL_LSOA_CODE])
        cat_parts.append(df.groupby([config.COL_LSOA_CODE, config.COL_CRIME_TYPE]).size())
        bdf = df[df[config.COL_CRIME_TYPE].isin(bundle)]
        month_parts.append(bdf.groupby([config.COL_LSOA_CODE, config.COL_MONTH]).size())
        for code, nm in df.groupby(config.COL_LSOA_CODE)[config.COL_LSOA_NAME].first().items():
            names.setdefault(code, nm)
        if i % 100 == 0:
            _log(f"  aggregated {i}/{len(files)} files…")
    if not cat_parts or not any(len(part) for part in cat_parts):
        raise CrimeDataQualityError("no LSOA-mapped crimes found in the selected raw window")
    _log(f"Crime: {len(files)} files, {total_rows:,} rows ({dropped:,} without LSOA); "
         f"window {months[0]}..{months[-1]} ({len(months)} mo)")

    by_cat = (pd.concat(cat_parts).groupby(level=[0, 1]).sum()
                .unstack(fill_value=0).reindex(columns=sorted(config.ALL_CRIME_TYPES), fill_value=0))
    monthly = (pd.concat(month_parts).groupby(level=[0, 1]).sum()
                 .unstack(fill_value=0).reindex(columns=months, fill_value=0))
    monthly = monthly.reindex(by_cat.index, fill_value=0)

    out = pd.DataFrame(index=by_cat.index)
    out["lsoa21nm"] = pd.Series(names)
    for key, code in BUNDLE_CODE.items():
        out[f"t_{code}"] = by_cat[list(config.CATEGORY_BUNDLES[key])].sum(axis=1).astype(int)
    out["by_category"] = [r.astype(int).to_dict() for _, r in by_cat.iterrows()]
    out["monthly_counts"] = [list(map(int, r)) for _, r in monthly.iterrows()]
    _log(f"  {len(out):,} LSOAs with crime")
    return out, months, quality


# --- 2. National boundaries (paginate the full E&W layer) ---------------------
def fetch_national_boundaries(refresh: bool) -> dict:
    if config.NATIONAL_BOUNDARIES_CACHE.exists() and not refresh:
        gj = json.loads(config.NATIONAL_BOUNDARIES_CACHE.read_text())
        _log(f"Boundaries: cache hit ({len(gj['features']):,} features).")
        return gj
    feats: list[dict] = []
    offset, PAGE = 0, 2000
    while True:
        params = {
            "where": "1=1", "outFields": f"{config.BOUNDARY_FIELD_CODE},{config.BOUNDARY_FIELD_NAME}",
            "returnGeometry": "true", "outSR": "4326", "f": "geojson",
            "resultOffset": offset, "resultRecordCount": PAGE,
        }
        r = requests.post(config.BOUNDARIES_QUERY_URL, data=params, headers=UA, timeout=180)
        r.raise_for_status()
        page = r.json().get("features", [])
        feats.extend(page)
        _log(f"  boundaries {len(feats):,} (offset {offset})…")
        if len(page) < PAGE:
            break
        offset += PAGE
    gj = {"type": "FeatureCollection", "features": feats}
    config.INTERIM_DIR.mkdir(parents=True, exist_ok=True)
    config.NATIONAL_BOUNDARIES_CACHE.write_text(json.dumps(gj))
    _log(f"Boundaries: fetched {len(feats):,} E&W LSOAs → {config.NATIONAL_BOUNDARIES_CACHE.name}")
    return gj


def coverage_gap_areas(missing_force_months: list[list[str]]) -> tuple[list[str], tuple[str, ...]]:
    """Resolve incomplete forces to LSOA-name prefixes, or fail safely.

    A partial force cannot be left in the national ranking. If a future source
    gap affects a force whose geography has not yet been mapped in config, stop
    the build so it cannot silently publish incomplete rates as low crime.
    """
    forces = sorted({force for _month, force in missing_force_months})
    unmapped = [force for force in forces if force not in config.FORCE_AREA_NAME_PREFIXES]
    if unmapped:
        raise CrimeDataQualityError(
            "cannot safely publish partial force coverage; add LSOA display-name "
            f"prefixes to config.FORCE_AREA_NAME_PREFIXES for: {', '.join(unmapped)}"
        )
    prefixes = tuple(
        prefix
        for force in forces
        for prefix in config.FORCE_AREA_NAME_PREFIXES[force]
    )
    return forces, prefixes


# --- 3-4. Align to E&W region, join population, compute metric ----------------
def build_table(out: pd.DataFrame, boundaries: dict, n_months: int,
                quality: dict | None = None) -> pd.DataFrame:
    if quality is None:
        quality = out.attrs.get("crime_quality")
    if quality is None:
        raise CrimeDataQualityError("crime quality metadata is required before rates are calculated")
    region = {f["properties"][config.BOUNDARY_FIELD_CODE]: f["properties"][config.BOUNDARY_FIELD_NAME]
              for f in boundaries["features"]}
    out_of_region = [c for c in out.index if c not in region]
    if out_of_region:
        n = int(out.loc[out_of_region, "t_all"].sum())
        _log(f"  dropped {len(out_of_region)} non-E&W LSOAs ({n:,} crimes — e.g. BTP cross-border).")
    out = out.reindex(list(region))
    zero_cat = {c: 0 for c in sorted(config.ALL_CRIME_TYPES)}
    crimeless = out["t_all"].isna()
    for code in out.index[crimeless]:
        out.at[code, "by_category"] = dict(zero_cat)
        out.at[code, "monthly_counts"] = [0] * n_months
    for c in BUNDLE_CODE.values():
        out[f"t_{c}"] = out[f"t_{c}"].fillna(0).astype(int)
    out["lsoa21nm"] = out["lsoa21nm"].fillna(pd.Series(region))
    if int(crimeless.sum()):
        _log(f"  zero-filled {int(crimeless.sum())} LSOAs with no crime in window.")

    pop = pd.read_csv(config.POP_CSV, dtype={config.POP_COL_CODE: str})
    out["pop"] = out.index.map(pop.set_index(config.POP_COL_CODE)[config.POP_COL_VALUE].astype(int))
    miss = int(out["pop"].isna().sum())
    if miss:
        _log(f"  WARNING: {miss} LSOAs without 2021 population (vintage mismatch?).")

    out["months"] = n_months
    missing = quality.get("coverage", {}).get("missing_force_months", [])
    forces_with_submission_gaps, unavailable_prefixes = coverage_gap_areas(missing)
    out["coverage_unavailable"] = False
    if unavailable_prefixes:
        names = out["lsoa21nm"].fillna("").astype(str)
        out["coverage_unavailable"] = names.str.startswith(unavailable_prefixes)
        _log(f"  coverage unavailable: {int(out['coverage_unavailable'].sum())} LSOAs "
             f"across {len(forces_with_submission_gaps)} territorial force(s) with source gaps")
    # low-pop is bundle-independent; rate/percentile/high-rate are per bundle.
    out["low_pop_flag"] = (out["pop"] < config.LOW_POP_THRESHOLD) | out["pop"].isna()
    for key, code in BUNDLE_CODE.items():
        rate = (out[f"t_{code}"] / out["pop"] * config.RATE_PER).where(lambda s: np.isfinite(s))
        rate = rate.mask(out["coverage_unavailable"])
        out[f"r_{code}"] = rate.round(1)
        base = rate[~out["low_pop_flag"] & ~out["coverage_unavailable"] & rate.notna()]
        extreme = float(np.percentile(base, config.OUTLIER_RATE_PCTL)) if len(base) else float("inf")
        out[f"h_{code}"] = (rate > extreme).fillna(False)
        out[f"p_{code}"] = base.rank(pct=True).round(3)  # national percentile, per bundle
        _log(f"  [{key}] cutoff {extreme:.0f}/1,000 → {int(out[f'h_{code}'].sum())} high-rate")
    _log(f"  low-pop flagged: {int(out['low_pop_flag'].sum())} / {len(out)}")

    # Price layer (separate dimension; direct 2011↔2021 code match).
    pmap = load_price()
    out["price"] = out.index.map(pmap)
    out["price_pctl"] = out["price"].rank(pct=True).round(3)  # pricier = higher
    n_priced = int(out["price"].notna().sum())
    if n_priced:
        _log(f"  price: {n_priced}/{len(out)} LSOAs matched ({100*n_priced/len(out):.0f}%); "
             f"median £{int(out['price'].dropna().median()):,}")

    # Yield (investor metric): annual mean rent (LAD) ÷ median price (LSOA).
    rent, lsoa_lad = load_rent(), load_lsoa_lad()
    if rent and lsoa_lad:
        monthly = out.index.to_series().map(lsoa_lad).map(rent).astype(float)
        out["yield"] = (monthly * 12 / out["price"] * 100).round(1)
        out["yield_pctl"] = out["yield"].rank(pct=True).round(3)
        ny = int(out["yield"].notna().sum())
        _log(f"  yield: {ny}/{len(out)} LSOAs ({100*ny/len(out):.0f}%); "
             f"median {out['yield'].dropna().median():.1f}%")
    else:
        out["yield"] = float("nan")
        out["yield_pctl"] = float("nan")
    return out


# --- 5. Write slim GeoJSON (for tiles) + details lookup -----------------------
def write_outputs(out: pd.DataFrame, boundaries: dict, n_months: int, months: list[str],
                  quality: dict | None = None) -> None:
    by_code = {c: r for c, r in out.iterrows()}
    cats = sorted(config.ALL_CRIME_TYPES)
    feats, details, filt = [], {}, []
    for f in boundaries["features"]:
        code = f["properties"][config.BOUNDARY_FIELD_CODE]
        r = by_code.get(code)
        if r is None:
            continue
        pop = None if pd.isna(r["pop"]) else int(r["pop"])
        price = None if pd.isna(r["price"]) else int(r["price"])
        price_pctl = None if pd.isna(r["price_pctl"]) else float(r["price_pctl"])
        yld = None if pd.isna(r["yield"]) else float(r["yield"])
        yld_pctl = None if pd.isna(r["yield_pctl"]) else float(r["yield_pctl"])
        p_res = None if pd.isna(r["p_res"]) else float(r["p_res"])
        r_res = None if pd.isna(r["r_res"]) else float(r["r_res"])
        coverage_unavailable = bool(r.get("coverage_unavailable", False))
        props = {"lsoa21cd": code, "lsoa21nm": r["lsoa21nm"], "pop": pop,
                 "low_pop_flag": bool(r["low_pop_flag"]),
                 "coverage_unavailable": coverage_unavailable,
                 "price": price, "price_pctl": price_pctl,
                 "yield": yld, "yield_pctl": yld_pctl}
        for c in BUNDLE_CODE.values():   # per-bundle scalars: total, rate, percentile, high-rate
            props[f"t_{c}"] = int(r[f"t_{c}"])
            props[f"r_{c}"] = None if pd.isna(r[f"r_{c}"]) else float(r[f"r_{c}"])
            props[f"p_{c}"] = None if pd.isna(r[f"p_{c}"]) else float(r[f"p_{c}"])
            props[f"h_{c}"] = bool(r[f"h_{c}"])
        f["properties"] = props
        feats.append(f)
        # compact details (fetched lazily on click): arrays in the shared category/month order
        details[code] = {"c": [int(r["by_category"][c]) for c in cats],
                         "m": list(r["monthly_counts"]), "price": price, "price_pctl": price_pctl,
                         "yield": yld, "yield_pctl": yld_pctl}
        # Preserve the original first five cells; append evidence fields so old
        # clients keep working while newer filters can show count/population/rate.
        filt.append([code, r["lsoa21nm"], p_res, price, yld,
                     int(r["t_res"]), pop, r_res])

    config.INTERIM_DIR.mkdir(parents=True, exist_ok=True)
    config.NATIONAL_SLIM_GEOJSON.write_text(
        json.dumps({"type": "FeatureCollection", "features": feats}, allow_nan=False))
    config.WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    details_doc = {
        "categories": cats, "months": months, "default_bundle": config.DEFAULT_BUNDLE,
        "bundles": config.CATEGORY_BUNDLES, "window_months": n_months,
        "low_pop_threshold": config.LOW_POP_THRESHOLD, "price_label": config.PRICE_LABEL,
        "rent_label": config.RENT_LABEL, "lsoa": details,
    }
    if quality is not None:
        details_doc["quality"] = quality
    config.NATIONAL_DETAILS.write_text(json.dumps(details_doc, allow_nan=False))
    coverage = (quality or {}).get("coverage", {})
    missing = coverage.get("missing_force_months", [])
    completeness = (quality or {}).get("completeness_status", "unknown")
    forces_with_submission_gaps, unavailable_prefixes_tuple = coverage_gap_areas(missing)
    unavailable_prefixes = sorted(unavailable_prefixes_tuple)
    gap_month_counts = Counter(force for _month, force in missing)
    if completeness == "complete":
        coverage_note = (
            "All expected territorial police force-month files were present in the build input. "
            "This does not mean every offence was reported or recorded."
        )
    else:
        observed = coverage.get("observed_expected_force_months")
        expected = coverage.get("expected_force_months")
        force_summary = "; ".join(
            f"{force.replace('-', ' ').title()}: {gap_month_counts[force]} missing month(s)"
            for force in forces_with_submission_gaps
        )
        coverage_note = (
            f"The build contained {observed}/{expected} expected territorial police force-month "
            f"files; {len(missing)} submission gap(s) are recorded ({force_summary}). "
            "Affected areas are withheld. Missing source files must "
            "not be interpreted as zero crime."
            if observed is not None and expected is not None else
            "Force-by-month completeness could not be confirmed for this build. Missing source "
            "files must not be interpreted as zero crime."
        )
    config.NATIONAL_META.write_text(json.dumps({
        "schema_version": 1,
        "generated_at": (quality or {}).get("generated_at"),
        "geography": "England and Wales",
        "area_type": "2021 LSOA",
        "area_count": len(feats),
        "crime_window_start": months[0],
        "crime_window_end": months[-1],
        "window_months": n_months,
        "population_vintage": "Census 2021 usual residents",
        "coverage_status": completeness,
        "source_file_count": coverage.get("observed_force_months"),
        "expected_force_months": coverage.get("expected_force_months"),
        "observed_force_months": coverage.get("observed_expected_force_months"),
        "missing_force_months": missing,
        "forces_with_submission_gaps": forces_with_submission_gaps,
        "force_gap_month_counts": dict(sorted(gap_month_counts.items())),
        "unavailable_area_prefixes": unavailable_prefixes,
        "coverage_note": coverage_note,
    }, allow_nan=False, indent=2) + "\n")
    config.NATIONAL_FILTER.write_text(json.dumps(
        {"fields": ["code", "name", "crime_pctl_res", "price", "yield",
                    "crime_count_res", "population", "crime_rate_per_1000_res"],
         "count": len(filt), "rows": filt}, allow_nan=False))
    _log(f"  wrote {config.NATIONAL_FILTER.name} ({config.NATIONAL_FILTER.stat().st_size/1e6:.1f} MB)")
    _log(f"Wrote {len(feats):,} features → {config.NATIONAL_SLIM_GEOJSON.name} "
         f"({config.NATIONAL_SLIM_GEOJSON.stat().st_size/1e6:.0f} MB) and "
         f"{config.NATIONAL_DETAILS.name} ({config.NATIONAL_DETAILS.stat().st_size/1e6:.1f} MB)")


# --- 6. Tile with tippecanoe → PMTiles ----------------------------------------
def run_tippecanoe() -> None:
    tip = find_tippecanoe()
    cmd = [tip, "-o", str(config.NATIONAL_PMTILES), "-l", config.PMTILES_LAYER,
           "-Z4", "-z12",
           "--no-tiny-polygon-reduction",   # keep every LSOA
           "--no-feature-limit", "--no-tile-size-limit",  # never drop for a choropleth
           "--no-simplification-of-shared-nodes",
           "-r1",                            # retain all features at low zoom (no thinning)
           "--force", str(config.NATIONAL_SLIM_GEOJSON)]
    _log("Tiling: " + " ".join(cmd))
    subprocess.run(cmd, check=True)
    _log(f"Tiles → {config.NATIONAL_PMTILES} ({config.NATIONAL_PMTILES.stat().st_size/1e6:.1f} MB)")


def main() -> int:
    ap = argparse.ArgumentParser(description="Build national PMTiles + details.")
    ap.add_argument("--refresh-boundaries", action="store_true")
    ap.add_argument("--skip-tiles", action="store_true", help="write GeoJSON + details but don't run tippecanoe")
    args = ap.parse_args()

    out, months, quality = aggregate_national()
    n_months = len(months)
    boundaries = fetch_national_boundaries(refresh=args.refresh_boundaries)
    out = build_table(out, boundaries, n_months, quality)
    write_outputs(out, boundaries, n_months, months, quality)
    if not args.skip_tiles:
        run_tippecanoe()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

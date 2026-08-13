"""Validate the committed static data contract before a Pages deployment."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
DATA = WEB / "data"


def load_strict_json(path: Path) -> dict:
    def reject_constant(value: str) -> None:
        raise ValueError(f"non-finite JSON constant {value} in {path}")

    return json.loads(path.read_text(), parse_constant=reject_constant)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def main() -> int:
    required = [
        WEB / "index.html",
        WEB / "styles.css",
        WEB / "app.js",
        WEB / "favicon.svg",
        WEB / "game.html",
        WEB / "game.css",
        WEB / "game.js",
        DATA / "national.pmtiles",
        DATA / "national-details.json",
        DATA / "national-filter.json",
        DATA / "national-meta.json",
    ]
    for path in required:
        require(path.is_file() and path.stat().st_size > 0, f"missing or empty web artifact: {path}")

    details = load_strict_json(DATA / "national-details.json")
    index = load_strict_json(DATA / "national-filter.json")
    meta = load_strict_json(DATA / "national-meta.json")

    detail_codes = set(details.get("lsoa", {}))
    rows = index.get("rows", [])
    row_codes = [row[0] for row in rows]
    row_code_set = set(row_codes)
    area_count = meta.get("area_count")

    require(len(row_codes) == len(row_code_set), "national-filter.json has duplicate LSOA codes")
    require(detail_codes == row_code_set, "details and filter LSOA code sets differ")
    require(index.get("count") == len(rows), "national-filter.json count does not match its rows")
    require(area_count == len(detail_codes), "national-meta.json area_count does not match details")

    months = details.get("months", [])
    require(len(months) == details.get("window_months") == meta.get("window_months"),
            "crime-window month counts disagree")
    require(months and months[0] == meta.get("crime_window_start"),
            "crime-window start disagrees")
    require(months and months[-1] == meta.get("crime_window_end"),
            "crime-window end disagrees")
    require(len(details.get("categories", [])) == 14, "expected 14 police.uk crime categories")

    prefixes = meta.get("unavailable_area_prefixes", [])
    require(len(prefixes) == len(set(prefixes)), "duplicate unavailable-area prefix")
    names = [str(row[1]) for row in rows]
    unmatched = [prefix for prefix in prefixes if not any(name.startswith(f"{prefix} ") for name in names)]
    require(not unmatched, f"unavailable-area prefixes match no LSOA: {unmatched}")

    require((DATA / "national.pmtiles").stat().st_size > 1_000_000,
            "national.pmtiles is unexpectedly small")
    print(
        f"Validated {len(detail_codes):,} LSOAs, {len(months)} months, "
        f"{len(details['categories'])} categories and {len(prefixes)} unavailable-area prefixes."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

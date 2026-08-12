# CrimeMap UK — Engineering & Product Handoff

**Purpose of this file:** everything a new coding agent (Codex/ChatGPT, or a human dev)
needs to fully understand, run, extend, and deploy this project with **no missing context**.
Read this file first, then `CLAUDE.md` (the original product brief) and `pipeline/SOURCES.md`
(verified data endpoints). Nothing else is required.

- **Live site:** https://sarthk.github.io/crimemap-uk/
- **Repo:** https://github.com/sarthk/crimemap-uk (branch `main`; every push auto-deploys)
- **Owner:** Sarthak (GitHub `sarthk`)
- **Status:** England & Wales shipped and live. National crime + price + yield + a
  "Find areas" filter, all as separate transparent layers.

---

## 1. What it is (and the rules it lives by)

A calm, honest web map of **reported crime per resident**, by 2021 LSOA (Lower-layer
Super Output Area, ~1,500 residents each), for **England & Wales** (~35,672 LSOAs), now
extended into an **area-intelligence tool for buyers & investors** (adds median house
price, gross rental yield, and a criteria filter). It answers both "what's this area
like?" and "find me areas that are X."

**Non-negotiable principles (the product IS these — do not violate them):**
1. **Per-capita, never raw counts.** Raw counts map footfall, not resident risk.
2. **Show count + rate + population together.** The denominator is part of the truth.
3. **Handle the low-residential / footfall trap.** City-centre LSOAs have a per-capita
   rate inflated by non-resident footfall. These are **greyed, not painted red**, with
   the real figure + a caveat in the panel. (See §7 for exactly how.)
4. **Label everything "reported crime."** It's reported + anonymised + geocoded-to-nearest-
   point + ~1–2 month lagged + monthly. A methodology section is mandatory.
5. **Descriptive, never editorialising. No causal claims.** Numbers + caveats; user concludes.
6. **Separate, transparent layers — NEVER a blended "neighbourhood score."** Crime, price,
   yield stay distinct; the user sets thresholds. A black-box score is the one thing that
   would destroy the trust moat. Money flows *around* the data (referral links), never *into*
   it (no pay-to-rank).
7. **Attribute sources (all Open Government Licence v3).**

---

## 2. Architecture (one sentence)

**A Python pipeline turns free open data into three static files, which a single
self-contained HTML page renders with MapLibre GL + PMTiles, served by GitHub Pages —
no backend, no database, no build step.**

```
open data ──(pipeline/*.py)──▶  web/data/national.pmtiles       (vector tiles: scalar stats per LSOA)
                                web/data/national-details.json  (per-LSOA breakdown, lazy-loaded on click)
                                web/data/national-filter.json   (compact table powering the filter)
                                        │
                                        ▼
                            web/index.html  (MapLibre GL + PMTiles, all CSS+JS inlined)
                                        │
                        .github/workflows/deploy.yml → GitHub Pages
```

"Live tracker" = re-run the pipeline monthly, commit the refreshed `web/data/*`, push →
auto-redeploys. Crime data is monthly, so a monthly refresh *is* real-time here. **Do not
build streaming or a backend.**

---

## 3. Repository layout (every file)

```
CLAUDE.md                    Original product brief (Phase-1 spec + principles). Read it.
README.md                    Short overview + run/deploy + status checklist.
HANDOFF.md                   ← this file.
serve.py                     Range-capable local static server. USE THIS locally, not
                             `python -m http.server` (PMTiles needs HTTP Range → plain
                             http.server returns 200 full-file and the map won't load).
.github/workflows/deploy.yml GitHub Pages deploy: uploads web/ as the Pages artifact.
.gitignore                   Ignores pipeline/data/{raw,interim}; keeps web/data/.
pipeline/
  config.py                  SINGLE SOURCE OF TRUTH: every URL, path, threshold, bundle,
                             column name, region definition. Change knobs here.
  download.py                Downloads all inputs. CLI flags below (§6).
  build_national.py          THE national build: aggregate crime → join pop/price/rent →
                             compute rate/percentile/flags/yield → write the 3 web/data files
                             (runs tippecanoe for the .pmtiles). This is the main script.
  SOURCES.md                 Verified data endpoints + gotchas (recon-checked). Authoritative.
  requirements.txt           pandas, requests, remotezip, xlrd, openpyxl (+ numpy via pandas).
  build_geojson.py           LEGACY Phase-1 West-Yorkshire-only build (Leaflet + GeoJSON).
  step1_sanity.py            LEGACY Phase-1 sanity check. Both legacy files are UNUSED/UNSERVED
                             (kept for history). The live product is national only.
  data/raw/  data/interim/   Downloaded + intermediate data (gitignored, regenerable).
web/
  index.html                 THE APP. Self-contained (inline CSS + JS). MapLibre GL 5.24 +
                             pmtiles 4.4 from unpkg CDN. ~1000 lines.
  data/national.pmtiles      ~51 MB vector tiles (zoom 4–12). Scalar stats per LSOA (§5).
  data/national-details.json ~6 MB. Per-LSOA category breakdown + 12-mo series + price + yield.
  data/national-filter.json  ~1.9 MB. Compact [code,name,crime_pctl,price,yield] rows for filter.
```

---

## 4. Environment & dependencies

- **Python 3.11+** (developed on 3.14). `pip install -r pipeline/requirements.txt`.
- **tippecanoe** (Felt fork, v2.80.0) — required ONLY to (re)generate `national.pmtiles`.
  Not on PATH by default; no Homebrew was used. Build from source:
  `git clone --depth 1 https://github.com/felt/tippecanoe && cd tippecanoe && make -j4`.
  `build_national.py` finds it via, in order: `$CRIMEMAP_TIPPECANOE`, `which tippecanoe`,
  `~/.local/bin/tippecanoe`. Set `CRIMEMAP_TIPPECANOE=/path/to/tippecanoe` if elsewhere.
- **No Node/npm needed.** MapLibre + PMTiles load from a CDN like Leaflet; there is no bundler.
- **Disk:** the crime archive path uses ~1–2 GB temporarily; keep a few GB free.

---

## 5. Data model (schemas — exact)

**`national.pmtiles`** — vector tiles, tippecanoe layer name = **`lsoa`** (this is the
MapLibre `source-layer`; a wrong name = silent blank map). Per-feature properties:
- `lsoa21cd` (str), `lsoa21nm` (str), `pop` (int|null), `low_pop_flag` (bool)
- `price` (int|null £), `price_pctl` (0..1|null), `yield` (float %|null), `yield_pctl` (0..1|null)
- per crime-type bundle **code** in {`res`, `foot`, `all`}:
  - `t_<code>` total crimes (int), `r_<code>` rate per 1,000 (float|null),
    `p_<code>` percentile 0..1 (float|null), `h_<code>` high-rate flag (bool)

**`national-details.json`** (fetched once, lazily, on first area click):
```json
{ "categories": [14 crime-type strings, sorted],
  "months": ["2025-05", …, "2026-04"],
  "default_bundle": "residential_risk",
  "bundles": { "residential_risk": [...], "footfall_heavy": [...], "all": [...] },
  "window_months": 12, "low_pop_threshold": 500,
  "price_label": "ONS · median sold price · year to Mar 2023",
  "rent_label": "Gross yield (est.) · ONS mean rent (LA) ÷ ONS median price",
  "lsoa": { "E01…": { "c": [14 ints in `categories` order],
                       "m": [12 ints in `months` order, residential-risk bundle],
                       "price": int|null, "price_pctl": float|null,
                       "yield": float|null, "yield_pctl": float|null }, … } }
```

**`national-filter.json`** (fetched when the filter is first used):
```json
{ "fields": ["code","name","crime_pctl_res","price","yield"], "count": 35672,
  "rows": [ ["E01…","Leeds 111E", 0.999, 190000, 7.2], … ] }   // nulls allowed per cell
```

**The metric.** `rate_per_1000 = crimes_in_bundle_over_12mo / resident_population × 1000`,
rolling 12 months. `percentile` = rank of the rate among **non-low-pop** LSOAs (national).
`low_pop_flag` = `pop < 500` (in practice never true — 2021 LSOAs have a ~1,000 floor).
`high_rate_flag` = rate above the 99th percentile of non-low-pop rates (empirically the
town/city centres — the footfall cases). Yield = `mean_monthly_rent(LAD) × 12 / median_price(LSOA) × 100`.

**Crime-type bundles** (police.uk categories): `residential_risk` (default) = Burglary,
Robbery, Violence and sexual offences, Vehicle crime, Criminal damage and arson, Theft from
the person. `footfall_heavy` = Shoplifting, Anti-social behaviour, Public order, Other theft,
Drugs. `all` = every category. Bundle is a user choice; the UI says so.

---

## 6. The pipeline — how to (re)build from scratch

All data sources are free, OGL v3, verified live (exact URLs + parsing recipes in
`pipeline/SOURCES.md` and hard-coded in `pipeline/config.py`). Full refresh:

```bash
pip install -r pipeline/requirements.txt
python pipeline/download.py --national     # all 43 forces, rolling 12 mo crime (auto-detects latest month)
python pipeline/download.py --population    # ONS Census 2021 TS001 (once)
python pipeline/download.py --price         # ONS HPSSA median price by LSOA (.xls in a zip)
python pipeline/download.py --rent          # ONS PIPR rent (.xlsx) + ONS LSOA21→LAD22 lookup (.csv)
#   (or:  python pipeline/download.py --national --all   to grab crime + population + price + rent)
python pipeline/build_national.py           # → web/data/{national.pmtiles, national-details.json, national-filter.json}
python serve.py 8000                         # Range-capable server; open http://localhost:8000
```

**`download.py` flags:** `--national` (all E&W forces; else West-Yorkshire only, legacy),
`--archive` (crime via full 1.6 GB archive instead of range extraction), `--custom` (police.uk
custom POST download — slow, avoid), `--keep-archive`, `--population`, `--price`, `--rent`,
`--all`.

**`build_national.py` flags:** `--refresh-boundaries` (re-fetch the 35k LSOA boundaries from
ArcGIS instead of the cache), `--skip-tiles` (regenerate the JSON files but not the .pmtiles —
fast; use when only price/rent/details changed and geometry hasn't).

**Data sources & the ONE gotcha per source** (details in SOURCES.md):
- **Crime — police.uk archive** (`data.police.uk/data/archive/<YYYY-MM>.zip` → S3). NO
  per-force CSV URLs exist; CSVs ship only inside the zip. We range-extract just the WY files,
  or (national) download the whole archive. LSOA codes are **2021 vintage**. Each crime is
  pre-tagged with its LSOA code → **no spatial join, just `groupby`**.
- **Boundaries — ONS ArcGIS** "LSOA (Dec 2021) Boundaries EW BGC V5", FeatureServer, paginate
  `resultOffset` by 2000 (maxRecordCount). Fields `LSOA21CD`/`LSOA21NM`. `f=geojson`, `outSR=4326`.
- **Population — ONS Census 2021 TS001** (Nomis zip → `census2021-ts001-lsoa.csv`). Key col
  `geography code`, value col `Residence type: Total; measures: Value`. 2021 vintage. **100% join.**
- **Price — ONS HPSSA Dataset 46** (median price by LSOA, .xls in a zip; sheet `1a`, header
  row 6, `xlrd`). ⚠️ **2011-LSOA keyed, ends year-to-Mar-2023** (final release). We join by
  direct 2011↔2021 code match = **~92%** of LSOAs; the rest show "not published."
- **Rent — ONS PIPR** monthly price stats (.xlsx, sheet `Table 1`, header row 3, `openpyxl`).
  ⚠️ **MEAN (not median) rent, by local authority only.** Join to LSOAs by **LAD code** (name-
  join fails: "Bristol" ≠ "Bristol, City of") via the **ONS LSOA21→LAD22 lookup CSV**. ~88% yield.
- **Postcodes — postcodes.io** `GET /postcodes/{pc}` → use `result.codes.lsoa21` (not the
  generic `.lsoa`). Bulk/reverse endpoints exist.

---

## 7. The frontend (`web/index.html`)

One self-contained file. MapLibre GL JS 5.24 + pmtiles 4.4 (CDN), inline CSS + JS. Key pieces:

- **Map:** Carto Positron raster basemap + a vector `national` source (`pmtiles://./data/national.pmtiles`).
  Layers: `fill` (choropleth), `matchline` (bold outline for filter matches), `caution` (dashed
  outline on high-rate areas), `sel` (thick outline on the selected/searched area).
- **Choropleth colour** (`fillPaint(code)`): colourblind-safe ColorBrewer **YlOrRd** by
  `p_<bundle>` percentile. **Flagged areas (`low_pop_flag` OR `h_<bundle>`) are greyed**, not
  ramped — implementing principle #3. The real figures live in the panel.
- **Crime-type bundles** (`res`/`foot`/`all`): segmented control; `setBundle()` swaps
  `fill-color` to `fillPaint(code)` and re-applies the filter state.
- **Hover:** MapLibre popup showing `lsoa21nm` + `lsoa21cd`.
- **Click / postcode search / "Use my location" / URL hash** all call `select(code, props)`
  → `showPanel()` and set `location.hash = #<lsoa21cd>` (shareable deep-links; `goToCode()`
  handles inbound hashes). Postcode + reverse-geocode via postcodes.io.
- **Panel (`showPanel`)**: rate, count, population, percentile "standing", plain-language
  reading, direction-over-time trend (from `m[]`), category breakdown bars, price + yield
  (from details), a disclosed **affiliate** link-out, and "Copy link".
- **Top "Find areas" filter bar** (`#filterbar`): Crime (max percentile) / Max price / Min
  yield / Sort selects. `applyFilter()` reads `national-filter.json`, filters + sorts, renders
  the ranked "Matching areas" list in the sidebar, and highlights matches on the map by
  painting `fill` solid indigo `#4338ca` + `matchline`. Clearing restores the crime choropleth.
- **Visitor counter** (`initVisits`): cookie-free, deduped per browser/day via abacus; upgrade
  to real unique visitors by setting `VISITS.goatcounter`.

**Config knobs at the top of the inline `<script>`:**
- `AFFILIATE = { mortgage, conveyancer, survey }` — set referral URLs (empty = inert link).
- `VISITS = { goatcounter, ns, key }` — set a goatcounter.com site code for true uniques.

**Local-render gotcha:** the map fetches PMTiles tiles via HTTP **Range**. `serve.py` supports
it; `python -m http.server` does NOT (and the map silently never loads). GitHub Pages supports
Range, so production is fine. (During development the Claude preview's MapLibre renderer
sometimes wedged after many reloads — an environment quirk, not a code bug; the live site
renders correctly.)

---

## 8. Deploy

`.github/workflows/deploy.yml` uploads `web/` to GitHub Pages on every push to `main`
(Pages "Source: GitHub Actions"). The committed `web/data/*` files ARE the served data —
there is no build step in CI. To publish a data refresh: re-run the pipeline, commit
`web/data/*`, push.

**Custom domain (planned — e.g. `vicinia.uk`):** buy it → DNS: apex A-records to GitHub Pages
`185.199.108–111.153`, `www` CNAME → `sarthk.github.io` → repo Settings ▸ Pages ▸ Custom domain
→ add a `web/CNAME` file with the domain → enable Enforce HTTPS. (If rebranding, the in-page
brand string is "CrimeMap UK" in `web/index.html` header — change title/logo there.)

**Note on repo weight:** `national.pmtiles` (~51 MB) is committed so Pages serves it with no
build step; each monthly refresh re-commits it, growing git history. Fine for now; if it
becomes a problem, move tile generation into the Actions workflow (install tippecanoe in CI)
or use Git LFS.

---

## 9. Key design decisions & rationale (so you don't "fix" them)

- **Greyed footfall centres, not red.** A city-centre per-capita rate is inflated by visitors;
  painting it max-red would mislead exactly like raw counts did, inverted. So flagged areas are
  greyed on the map with the real number + caveat in the panel — *flagged, not hidden.*
- **No blended score.** Crime/price/yield are separate toggleable layers + a filter with user-set
  thresholds. This transparency is the moat vs. incumbents (UKCrimeStats/PropertyData).
- **PMTiles + MapLibre, not raw GeoJSON.** 35k polygons can't load as GeoJSON; tiles fetch only
  what's in view via Range. Tiles carry only scalars; heavy per-LSOA detail is lazy-loaded.
- **Yield is labelled an estimate.** Rent is LA-level + mean + 2026 over 2023 price. It's a
  relative guide, not a guaranteed return.

## 10. Known limitations (call these out; don't silently ship over them)

1. **Yield is overstated for the cheapest LSOAs** — LA-average rent over a very low local
   price yields implausible figures (e.g. 17%). **Recommended next fix:** flag/dim yields above
   ~12% as "LA-average rent over a low local price — likely overstated."
2. **Price is stale (to Mar 2023) and 2011-LSOA-joined (~92%).** Fresher/2021-native would mean
   computing medians from HM Land Registry `pp-complete.csv` (~5.5 GB) + a postcode→2021-LSOA
   lookup — deferred.
3. **No true year-over-year trend yet** — only 12 months are ingested; the panel shows a
   within-window 6-vs-6-month direction. True YoY needs a 24-month crime window (pipeline change).
4. **England & Wales only.** Scotland (Data Zones, different source/resolution) and Northern
   Ireland (NISRA) are separate systems — real work, deferred.
5. **No real analytics yet** — the visitor counter is a lightweight tally. Wire GoatCounter.

## 11. Roadmap (advisor-endorsed order)

Get real users first (put the live URL in front of 3–5 buyers/investors) → extreme-yield flag
→ amenities/commute-time (DfE schools, NaPTAN/OSM transport, all free) → 24-month window for
YoY → custom domain + optional rebrand to **Vicinia** → later Scotland/NI. The strategic arc:
crime is the trust wedge; price→yield→amenities make it a buying tool; revenue = referrals + B2B.

---

## 12. Kick-off prompt to paste into Codex

> Clone https://github.com/sarthk/crimemap-uk and read `HANDOFF.md` in full, then `CLAUDE.md`
> and `pipeline/SOURCES.md`. It's a static England & Wales crime/price/yield map: a Python
> pipeline (`pipeline/`) generates three files in `web/data/` that `web/index.html` (MapLibre
> GL + PMTiles, self-contained) renders, deployed to GitHub Pages. No backend. Preserve the
> non-negotiable principles in HANDOFF §1 (esp. per-capita, greyed footfall centres, and NO
> blended score). To run locally: `pip install -r pipeline/requirements.txt`, then serve with
> `python serve.py 8000` (NOT `http.server` — PMTiles needs HTTP Range). To rebuild data you
> also need tippecanoe (see HANDOFF §4). My first task is: <state your task>.

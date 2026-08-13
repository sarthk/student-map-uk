# Students Map UK — Engineering and Product Handoff

Last updated: 14 August 2026.

Read this file first, then `README.md`. `CLAUDE.md`, `pipeline/` and `web/data/` belong to
the repository's former CrimeMap product and are not the current public contract.

## 1. Current product contract

Students Map UK is a static, student-first map of useful places around an active UK
postcode with usable coordinates. It is intended to help someone new to an area discover
mapped services and venues without creating an account.

The product can answer:

> Which selected OpenStreetMap places were returned within this radius, and how far are
> they in a straight line from the postcode coordinate?

It cannot answer:

> Is every place listed? Is it open now, verified, affordable, discounted, recommended,
> safe, available or within a particular walking time?

Non-negotiable rules:

1. Say **loaded from OpenStreetMap when you searched**, not “live business availability.”
2. A missing result never proves that a place does not exist.
3. Distance is straight-line from a postcode coordinate, never a walking distance.
4. Do not claim results are verified, ranked, reviewed, student-approved or complete.
5. Show OpenStreetMap attribution wherever its map/place data is presented.
6. Keep postcode, location and third-party request behaviour visible before search.
7. Treat every OpenStreetMap tag as untrusted community-supplied content.
8. Separate public-app work from the retained crime pipeline and artifacts.

## 2. Current user experience

The entry page is `web/index.html`. A visitor can:

- enter a full UK postcode or approve browser geolocation;
- try example postcodes for Leeds, London, Edinburgh or Cardiff;
- choose a 600 m, 1.2 km or 2 km radius;
- view clustered markers and the corresponding accessible result list;
- filter by category or free text;
- sort nearest-first or A–Z;
- save places to an in-memory **My list**;
- ask **Pick for me** to select randomly from the current filtered set;
- inspect tagged address, hours, access, wheelchair, fee and cuisine fields when present;
- open an OpenStreetMap route, exact OSM object or validated website URL;
- read the data, privacy, scope and safety explanation in a modal;
- open the independent Freshers Week mini-game.

The result list initially renders 40 cards and can progressively show more. The browser
keeps at most the nearest 1,200 deduplicated results returned for a search.

## 3. Public architecture

```text
full postcode ──GET──▶ postcodes.io
                           │ latitude/longitude
                           ▼
                    Overpass QL request
                           │ OSM nodes/ways/relations
                           ▼
                 normalise + deduplicate + sort
                           │
                    MapLibre GeoJSON source
                           │
                 clustered map + result list
```

There is no application server, database, account system, bundler or compile step.

Runtime third parties:

- `https://api.postcodes.io/postcodes` — postcode lookup and reverse lookup;
- public Overpass interpreters, attempted sequentially in `OVERPASS_ENDPOINTS`;
- MapLibre GL JS from unpkg;
- CARTO raster basemap tiles containing OpenStreetMap-derived data;
- OpenStreetMap pages for exact objects and optional walking-route links.

If all Overpass endpoints fail, the app explicitly says that search is busy. It must not
render that failure as “no places found.”

## 4. Repository map

```text
README.md                         concise current-product guide
HANDOFF.md                        this authoritative handoff
serve.py                          static local preview server
.github/workflows/deploy.yml      deploys web/ to GitHub Pages

web/
  index.html                      Students Map semantic shell and policy copy
  styles.css                      responsive application styles
  app.js                          postcode, Overpass, map, cards and in-tab state
  favicon.svg                     local application icon
  game.html                       Freshers Week game shell
  game.css                        game-specific styles
  game.js                         game scenarios, scoring and keyboard interactions

CLAUDE.md                         historical CrimeMap brief
pipeline/                         retained CrimeMap ingestion/build/validation code
web/data/                         retained CrimeMap PMTiles and JSON artifacts
```

`web/app.js` does not import, fetch or otherwise read `web/data/`. The current deployment
workflow still runs legacy pipeline tests/data validation and uploads those artifacts;
this is repository compatibility overhead, not a Students Map dependency.

## 5. Postcode and place-query contract

`usePostcode()` normalises the entered value, calls postcodes.io and requires numeric
coordinates within the application's UK bounding box. Postcode quality `9` is rejected;
quality `5` or worse produces an approximate-centre message.

`useCurrentLocation()` requests browser permission, reverse-lookups the nearest postcode
and uses the browser coordinate as the search centre. No lookup happens before an
explicit search, example-button click or location action.

The permitted radii are hard-coded to 600, 1,200 and 2,000 metres. `makeOverpassQuery()`
constructs one allow-listed regular-expression selector from the fixed
`OVERPASS_KEY_PATTERN` and `OVERPASS_VALUE_PATTERN` constants and produces:

```overpass
[out:json][timeout:25];
nwr(around:RADIUS,LATITUDE,LONGITUDE)[~"ALLOWED_KEYS"~"ALLOWED_VALUES"];
out center qt;
```

Important rules:

- Never interpolate raw postcode or free-text filter input into Overpass QL.
- Keep radius and coordinate allow-list validation.
- Nodes use `lat`/`lon`; ways and relations use `center.lat`/`center.lon`.
- A returned way/relation centre is its bounding-box centre and may not be an entrance.
- Abort superseded requests and keep the current sequential endpoint fallback.
- Cache identical coordinate/radius results in memory only.
- Deduplicate by OSM object ID and a secondary normalised name/location key.
- Do not query automatically when the map pans.

## 6. Public categories

The default **Everything** view includes all returned selectors. Public categories are:

- **Study & supplies** — universities, colleges, libraries, selected schools, books,
  stationery, copy shops and coworking;
- **Food & coffee** — cafés, restaurants, fast food, food courts and ice cream;
- **Groceries** — supermarkets, convenience shops, food specialists and bakeries;
- **Health** — pharmacies, doctors, dentists, clinics, hospitals and selected healthcare;
- **Fitness & outdoors** — fitness/sports facilities, parks, pitches, tracks and climbing;
- **Transport** — stations, selected rail/public-transport features, bike facilities,
  car sharing, charging and fuel;
- **Shops & errands** — banking, post/parcel services, toilets, water, recycling and
  selected practical shops;
- **Personal care** — hairdressers, beauty/cosmetics, chemists and opticians;
- **Social & culture** — pubs/bars, cinemas, theatres, arts/community venues, museums,
  galleries and selected leisure attractions;
- **Housing help** — university residential features, estate agents and hostels returned
  by the fixed query selectors.

These are application-defined discovery groupings, not official classifications or
recommendations. A place can match several categories but receives one deterministic
primary category for its marker and card.

## 7. Browser state and data safety

Core in-memory state includes the current search context, loaded places, category/text
filter, sort mode, selected place, `savedIds`, visible-card limit and query cache. There
is no localStorage, sessionStorage, cookie or server-side persistence.

OpenStreetMap names, operators, addresses, hours and other tags are untrusted input:

- interpolate only through `escapeHtml()` or assign with `textContent`;
- accept external venue URLs only through `safeHttpUrl()` and only for HTTP(S);
- keep OSM object type/ID and coordinates numeric before building links/features;
- never inject raw tags into an event handler, style expression or Overpass selector;
- retain `rel="noopener"` on new-tab links.

## 8. Honest copy, privacy and attribution

“Live” in marketing copy means an on-demand request to a recent OpenStreetMap database
snapshot. It must never mean live opening, capacity, stock, accommodation or service
availability. Raw `opening_hours` is displayed only as community-listed information and
should not be converted into a confident “open now” badge without a separately tested
parser and stronger caveats.

The UI must disclose that:

- a postcode goes to postcodes.io;
- its coordinate, or a browser-approved coordinate, goes to one Overpass operator at a
  time;
- these providers and the basemap host receive ordinary request metadata such as IP
  address and referrer;
- the site itself does not store searches, saved places or game results;
- OSM coverage and details can be incomplete or stale;
- important information should be checked with the venue;
- the discovery map works around active UK postcodes with usable coordinates, but does
  not guarantee universal map coverage.

Visible attribution:

> Places and map data © OpenStreetMap contributors, ODbL. Postcodes by postcodes.io.
> Basemap © CARTO and OpenStreetMap contributors.

Do not add claims about student discounts, prices, reviews, safety, neighbourhood
quality, medical suitability or accommodation verification without a new validated
source and explicit methodology.

## 9. Freshers Week mini-game

`web/game.html`, `game.css` and `game.js` form an independent static experience. It has
seven fixed scenarios, begins with a £45 fictional budget and four energy, and calculates
Freshers Points, a result label and achievements locally. It supports buttons, number
keys and arrow-key choice navigation.

The game has no purchases, prizes, chance rewards, sign-in, saved scores or network
requests. Keep its fictional scoring clearly separate from real financial guidance.

## 10. Local development and release checks

Run:

```bash
python serve.py 8000
```

Open `http://127.0.0.1:8000`; an internet connection is required for map libraries,
tiles, postcode lookup and places.

Before deploying the Students Map frontend:

```bash
node --check web/app.js
node --check web/game.js
python -m compileall -q serve.py
git diff --check
```

Manual smoke checks:

1. Search each example postcode and an invalid postcode.
2. Test 600 m, 1.2 km and 2 km queries.
3. Test endpoint failure/retry separately from a genuine empty result.
4. Test category, text, sort, My list, Pick for me and progressive loading.
5. Inspect an unnamed place, a way/relation and a place with a hostile-looking tag value.
6. Verify selected markers, clusters, external URLs and visible OSM attribution.
7. Test location denial and success without implying that location is stored.
8. Preview desktop, narrow mobile, keyboard-only and reduced-motion behaviour.
9. Complete and replay the mini-game with keyboard and touch.

A push to `main` deploys `web/` through GitHub Pages. The current workflow additionally
runs legacy crime-pipeline validation; failures there do not necessarily indicate a
Students Map frontend defect.

## 11. Legacy CrimeMap boundary

This repository originally generated an England-and-Wales crime-rate map. The following
remain for history and possible extraction:

- `pipeline/` and its tests;
- `pipeline/SOURCES.md`;
- `web/data/national.pmtiles` and the national JSON artifacts;
- `CLAUDE.md` and crime-specific parts of the deployment validation;
- Range support in `serve.py`.

Do not restore crime, house-price, yield, affiliate or neighbourhood-ranking UI to
Students Map UK. Do not describe a crime-data rebuild as part of the normal student-app
release. If CrimeMap is revived, move it to a separate route or repository with its own
product contract, data-quality status and deployment checks.

## 12. Highest-priority next work

1. Add automated browser smoke tests for postcode success/error, Overpass failure,
   filtering, mobile layout and the mini-game.
2. Separate the legacy crime validation/artifacts from the Students Map deployment to
   reduce repository and Pages payload weight.
3. Add a first-party cache/proxy or managed POI provider before meaningful traffic;
   public Overpass instances are shared and best-effort.
4. Add a Content Security Policy after enumerating the required postcode, Overpass,
   unpkg, CARTO and OpenStreetMap origins.
5. Decide on and add a software licence; OpenStreetMap's ODbL attribution does not license
   this repository's application code.

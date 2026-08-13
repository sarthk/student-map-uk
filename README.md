# Students Map UK

A static, postcode-first discovery map for students finding useful places around an
active UK postcode. Search once to load nearby study spaces, food, groceries, health
services, fitness, transport, everyday errands, personal care, social venues and
housing-related help from community-maintained OpenStreetMap data.

The public application is in `web/`. It has no account system, application backend,
database, advertising tracker or behavioural analytics.

## What the site does

- Resolves a UK postcode with [postcodes.io](https://postcodes.io/), or uses a browser
  location after permission.
- Requests selected nearby map features from a public OpenStreetMap Overpass service.
- Supports 600 m, 1.2 km and 2 km search radii.
- Shows clustered map markers and an accessible list sorted by straight-line distance.
- Filters results by category or name and sorts them by distance or name.
- Lets a visitor keep a temporary **My list** and choose a random visible result with
  **Pick for me**.
- Links to the place on OpenStreetMap, its tagged website when available, and an
  OpenStreetMap walking-route page.
- Includes a separate, two-minute **Freshers Week** budget game at `web/game.html`.

At most the nearest 1,200 deduplicated mapped places are retained for one search, and 40
cards are initially shown. Search results, query caching, saved places and game state all
remain in memory for the current tab only.

## What the site does not know

“Live” means the app requests the latest available OpenStreetMap database snapshot when
the visitor searches. It does **not** mean that a business is currently open, operating,
available or verified.

OpenStreetMap is maintained by contributors, so listings can be missing, duplicated or
out of date. Distances are straight-line estimates from a postcode coordinate, not
walking distances or journey times. The site does not claim that results are complete,
student-approved, affordable, discounted, safe or medically authoritative.

## Runtime architecture

```text
postcode ──▶ postcodes.io ──▶ latitude/longitude
                                  │
                                  ▼
                         public Overpass API
                                  │
                         OpenStreetMap POIs
                                  │
                                  ▼
                 MapLibre map + list in the browser
```

The frontend is plain HTML, CSS and JavaScript with no build step. MapLibre GL JS loads
from unpkg; CARTO/OpenStreetMap provide the basemap. Public Overpass services are shared,
best-effort infrastructure, so the app tries two endpoints in sequence before showing
an explicit busy state.

## Local preview

```bash
python serve.py 8000
```

Open `http://127.0.0.1:8000`. The map and place search require an internet connection.

Useful static checks:

```bash
node --check web/app.js
node --check web/game.js
python -m compileall -q serve.py
git diff --check
```

## Repository map

```text
web/index.html       Students Map application shell and data/privacy explanation
web/styles.css       responsive map and result-list presentation
web/app.js           postcode lookup, Overpass query, POI normalisation and UI state
web/favicon.svg      local application icon
web/game.html        Freshers Week mini-game shell
web/game.css         mini-game presentation
web/game.js          seven-scenario, in-memory budget game
serve.py             local static preview server
.github/workflows/   GitHub Pages deployment

pipeline/            retained legacy crime-data pipeline; not used by Students Map UK
web/data/            retained legacy crime artifacts; not read by web/app.js
CLAUDE.md            historical CrimeMap brief; not the current product contract
```

## Privacy and attribution

A postcode is sent to postcodes.io. Its returned coordinate—or a browser-approved
location—is sent to one Overpass operator at a time. Those services and the basemap host
receive normal web-request information such as the visitor's IP address. This site does
not store searches or saved places.

Place and map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
available under the ODbL. Postcode lookup is provided by
[postcodes.io](https://postcodes.io/). Basemap © CARTO and OpenStreetMap contributors.

The repository does not yet include a separate software licence for the application
code.

## Legacy crime pipeline

This repository began as CrimeMap UK. The Python pipeline and generated PMTiles/JSON
files are kept for reference and possible future extraction, but they are not part of
the current Students Map runtime. Do not describe the deployed site as a crime map, and
do not make a crime-data refresh a prerequisite for changing the student places app.

The current deployment workflow still validates and uploads the legacy artifacts. That
is compatibility overhead, not a frontend dependency; separating or archiving it is a
future repository-cleanup task.

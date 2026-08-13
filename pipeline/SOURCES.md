# CrimeMap UK data sources

This file documents the inputs used by the current crime-reference product. Runtime URLs
and column names live in `pipeline/config.py`; the validation contract lives in
`pipeline/crime_quality.py`.

All public-sector inputs below are reused under the Open Government Licence v3. Source
availability does not make the resulting map a complete measure of crime.

## 1. Police-recorded street crime — police.uk

- Latest-month discovery: `https://data.police.uk/api/crimes-street-dates`
- National archive: `https://data.police.uk/data/archive/<YYYY-MM>.zip`
- Archive entry pattern: `<YYYY-MM>/<YYYY-MM>-<force>-street.csv`
- Public information and caveats: `https://data.police.uk/about/`

`download.py --national` uses HTTP Range reads against the archive so it can extract the
requested rolling-window entries without downloading the complete cumulative zip. The
full-archive `--archive` route is a resumable fallback. The custom form route supports one
force and must not be used while claiming a national build.

Required CSV fields:

```text
Month
LSOA code
LSOA name
Crime type
```

The pipeline expects the 14 canonical police.uk street-crime categories defined in
`config.ALL_CRIME_TYPES`. A new or misspelled category stops the build rather than silently
falling out of totals.

Important caveats:

- only offences reported to and recorded by police appear;
- recording practice, police activity and reporting behaviour vary;
- coordinates are anonymised and snapped to nearby locations;
- an incident near an LSOA boundary may be assigned to an adjacent area;
- force submissions can be absent for a month, so file presence must be audited;
- the force list returned inside the dates API concerns stop-and-search availability and
  is not evidence that every street-crime CSV is present.

Coverage is checked against the 43 territorial forces in England and Wales. British
Transport Police files can be present and are aggregated, but are reported separately
from that territorial completeness denominator.

The committed July 2025–June 2026 artifacts have 17 known territorial source-month gaps:
Greater Manchester (12) and Gloucestershire (5). Their configured LSOA areas are excluded
from rate and percentile calculation and withheld by the frontend. Exact gaps are written
to the local manifest and public metadata.

## 2. 2021 LSOA boundaries — ONS Open Geography Portal

Feature service, layer 0:

`https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Lower_layer_Super_Output_Areas_December_2021_Boundaries_EW_BGC_V5/FeatureServer/0`

Fields used: `LSOA21CD` and `LSOA21NM`. The service has a page-size limit, so
`build_national.py` paginates until all 35,672 England and Wales features are collected
and caches the result under `pipeline/data/interim/`.

The BGC boundary is generalised and clipped for web mapping. It is suitable for locating
the statistical neighbourhood, not cadastral or address-level analysis.

## 3. Census 2021 usual-resident population — ONS/Nomis TS001

- Bulk zip: `https://www.nomisweb.co.uk/output/census/2021/census2021-ts001.zip`
- Member: `census2021-ts001-lsoa.csv`
- Join key: `geography code`
- Value: `Residence type: Total; measures: Value`

This directly matches the 2021 LSOA geography. The total includes household and communal
establishment residents. It does not represent workers, visitors, shoppers or students
whose usual residence was elsewhere, and its 2021 vintage is older than the crime window.

## 4. Postcode and coordinate lookup — postcodes.io

- Postcode: `GET https://api.postcodes.io/postcodes/{postcode}`
- Coordinate lookup: `GET https://api.postcodes.io/postcodes?lon={lon}&lat={lat}`
- LSOA field: `result.codes.lsoa21`

The frontend calls this third-party service only after a user submits a postcode or grants
location permission and presses the location button. The privacy notice must remain next
to the search flow. A postcode is only a locator for the containing LSOA.

## 5. Optional legacy property inputs

`config.py` and `download.py` retain old ONS house-price, rent and LSOA-to-LAD inputs for
backward compatibility with the generated artifact schema. The current frontend does not
use or display them because their geography, vintage and property mix cannot support a
responsible investment ranking. They are not required for the crime-only download flow.

## 6. Build evidence

Every national build should retain or publish:

- exact start and end month;
- generation time;
- expected, observed and missing force-month pairs;
- selected filenames and ignored out-of-window files;
- input checksums or ETags where possible;
- category and row counts;
- LSOA join counts and missing population values;
- denominator source, vintage and geography;
- unavailable area prefixes and the build Git commit.

Missing data must block or be explicitly withheld. It must never be converted into a zero
and ranked as lower crime.

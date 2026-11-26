# Data sources for the sea-distance files in this folder

These are the provenance notes kept in Cheng-Pro (`data/*/SOURCE.md`). **Licences are not cleared for release**: see the notes below (NGA usage statement not recorded; lane network licence unverified).


---

# World Port Index (NGA Pub. 150)

## Source of truth
**`official/WPI.dbf` + `official/WPI.shp`** (shapefile package, unchanged from the zip) is the source of truth.
`world_port_index_MIRROR_superseded.csv` is the old third-party student-project mirror (7 columns, edition unknown, no licence). It is superseded and kept only for comparison; do not build from it.

## Provenance
- Zip file name: `world_port_index.zip` (downloaded by the user to their Windows PC, then committed to the repo root of `main`; commit 861bf61b6ed9fc4ba4f64107a270d8312fff5c14)
- Zip SHA-256: `45f677189f4cfaa0b1b1f219b9ff4c5d73ac0c66524f18acf78cd4756019b487`
- Download date: not recorded by the user's machine (file added to the repo 2026-11-26 07:17 +0800)
- Edition/date found in the package: dBASE header and all member files are dated **2017-03-28**. The zip has no readme or edition statement. The NGA page edition was not seen. Treat as "NGA WPI, file dated 2017-03-28"; this is older than the current NGA release. Verify against https://msi.nga.mil/Publications/WPI.
- Extracted into a fresh folder outside the repo, nothing inside was executed. Files are copied unchanged to `official/`.

## Is it the official full package?
It matches the **full NGA WPI attribute table** (78 fields: depths, pilotage, tugs, cranes, supplies, etc.), distributed as an ESRI shapefile. It is NOT a CSV. It does NOT contain an NGA readme, data dictionary, or licence text. The origin (downloaded from NGA vs. relayed) cannot be proven from the contents.

Contents (SHA-256 of each file in `official/SHA256SUMS.txt`):
WPI.dbf (attributes), WPI.shp / WPI.shx / WPI.sbn / WPI.sbx (geometry+indexes), WPI.prj (WGS84), WPI.cpg (UTF-8).

## Licence / usage statement
None found in the zip. The NGA statement still has to be copied verbatim from https://msi.nga.mil/Publications/WPI (not reachable from the cloud session). **Not yet recorded. Redistribution terms are UNVERIFIED.**

## Summary
- Rows: 3669 (dBASE record count)
- Columns (78), exact order from the .dbf header:
  `INDEX_NO,REGION_NO,PORT_NAME,COUNTRY,LATITUDE,LONGITUDE,LAT_DEG,LAT_MIN,LAT_HEMI,LONG_DEG,LONG_MIN,LONG_HEMI,PUB,CHART,HARBORSIZE,HARBORTYPE,SHELTER,ENTRY_TIDE,ENTRYSWELL,ENTRY_ICE,ENTRYOTHER,OVERHD_LIM,CHAN_DEPTH,ANCH_DEPTH,CARGODEPTH,OIL_DEPTH,TIDE_RANGE,MAX_VESSEL,HOLDGROUND,TURN_BASIN,PORTOFENTR,US_REP,ETAMESSAGE,PILOT_REQD,PILOTAVAIL,LOC_ASSIST,PILOTADVSD,TUGSALVAGE,TUG_ASSIST,PRATIQUE,SSCC_CERT,QUAR_OTHER,COMM_PHONE,COMM_FAX,COMM_RADIO,COMM_VHF,COMM_AIR,COMM_RAIL,CARGOWHARF,CARGO_ANCH,CARGMDMOOR,CARBCHMOOR,CARICEMOOR,MED_FACIL,GARBAGE,DEGAUSS,DRTYBALLST,CRANEFIXED,CRANEMOBIL,CRANEFLOAT,LIFT_100_,LIFT50_100,LIFT_25_49,LIFT_0_24,LONGSHORE,ELECTRICAL,SERV_STEAM,NAV_EQUIP,ELECREPAIR,PROVISIONS,WATER,FUEL_OIL,DIESEL,DECKSUPPLY,ENG_SUPPLY,REPAIRCODE,DRYDOCK,RAILWAY`
- Example record: INDEX_NO 61090, PORT_NAME SHAKOTAN, COUNTRY RU, LATITUDE 43.866667, LONGITUDE 146.833333. Numeric fields are stored as text like `61090.000000`.
- UN/LOCODE: **not present** (no LOCODE column).
- Country names: **not present**; COUNTRY holds a 2-letter code (e.g. RU).
- Note for the converter: it must read the .dbf (or convert to CSV) and parse the 78 real columns; the old 7-column CSV layout no longer applies.


---

# Sea-lane network data — provenance

## What this is
`marnet.json` is a global shipping-lane graph (9708 nodes, 15970 undirected edges, passage tags) converted by
`scripts/import-marnet.py` from `source/marnet_dict.py.txt`. The source file is stored with a .txt extension and is only
parsed with `ast.literal_eval`, never imported or executed. Coordinates in `marnet.json` are [lon, lat]; edge lengths are
recomputed (great-circle, nm) by `scripts/sea-route.js`, the source weights (km) are not used.

## Where it came from
- File: https://raw.githubusercontent.com/genthalili/searoute-py/main/searoute/data/marnet_dict.py
  (GitHub user `genthalili`, project "searoute-py", package metadata says Apache-2.0). Downloaded 2026-11-25; commit not recorded.
  SHA-256 of the stored copy: 3622fff283e71b940ba5d58280b07c5cb2e95959ffb48f647b39b500b6c50ea3
- That project credits Eurostat's SeaRoute Java library (https://github.com/eurostat/searoute, licensed EUPL v1.2;
  full text in `source/EUROSTAT_SEAROUTE_LICENSE_EUPL-1.2.txt`).
- Verbatim from the Eurostat SeaRoute README (master branch), describing the underlying network:

> This maritime network is based on the *Oak Ridge National Labs CTA Transportation Network Group, Global Shipping Lane Network, World, 2000* (retrieved from [geocommons.com](http://geocommons.com/datasets?id=25) or [github](https://github.com/geoiq/gc_data/blob/master/datasets/25.geojson)), enriched with some additional lines around the European coasts based on [AIS data](https://en.wikipedia.org/wiki/Automatic_identification_system).

- Verbatim from the searoute-py README:

> **Not for routing purposes!** This library was developed to generate realistic-looking sea routes for visualizations of maritime routes, not for mariners to route their ships.

## Licence status (UNVERIFIED — read before shipping in an app)
- searoute-py: no LICENSE file was found in the repository (LICENSE, LICENSE.md, NOTICE all 404); only its `setup.py` says
  `license='Apache-2.0'`. Whether that licence covers the data file is not stated.
- Eurostat SeaRoute: EUPL v1.2 (text included). Whether the network data is covered by it was not checked.
- The upstream data (Oak Ridge National Laboratory, 2000) has its own terms that were not checked.
- The maintainers' own warning above says the network is not for navigation. Treat this as a planning estimate only.


---

# Route map land outline — provenance

## What this is
`land.json` is the land outline drawn on the route map. It is generated by `node scripts/build-land.js` from
`source/ne_50m_land.geojson` (outer rings only, simplified to about 0.05 degrees, i.e. about 3 nm, stored as integers).

## Where it came from
- Dataset: Natural Earth, "Land", 1:50m (public domain map dataset).
- File: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson
  (GitHub repository `nvkelso/natural-earth-vector`, branch `master`; its VERSION file reads `5.2.0-pre`).
- Downloaded: 2026-11-25. SHA-256 of the stored file: `e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b`.
- Licence text from the same repository (stored verbatim in `source/NATURAL_EARTH_LICENSE.md`), first lines:

> # Everything here is public domain.
> All versions of Natural Earth raster + vector map data found on this website are in the public domain. You may use the maps in any manner, including modifying the content and design, electronic dissemination, and offset printing. [...]
> No permission is needed to use Natural Earth. Crediting the authors is unnecessary.

## Limits
Coastlines are generalised: fine for a planning overview, not a chart. Small islands, harbours and rivers are missing or simplified.
Not for navigation.


---

# Emission Control Area outlines — provenance

`scripts/eca-zones.js` holds the ECA outlines used to measure how much of a route lies inside an ECA. Part of it (between the
`BEGIN GENERATED` / `END GENERATED` markers) is generated by `node scripts/build-eca-zones.js` from the IMO resolution texts in `source/`.

## Official coordinates (generated)
| Area | Resolution | Source of the text in `source/` |
|---|---|---|
| North American ECA (Pacific coast incl. Alaska to Kodiak, Atlantic / Gulf coast, Hawaiian Islands) | MEPC.190(60), appendix VII, adopted 26 March 2010 | https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MEPCDocuments/MEPC.190%2860%29.pdf |
| United States Caribbean Sea ECA | MEPC.202(62), appendix VII, 2011 | https://www.epa.gov/sites/default/files/2016-09/documents/resolution-mepc-202-62-7-15-2011.pdf |
| North-East Atlantic ECA (adopted 1 May 2026; deemed accepted 1 March 2027 unless objected to; entry into force 1 September 2027) | MEPC.407(84), annex 3 of MEPC 84/16/Add.1 | https://wwwcdn.imo.org/localresources/en/OurWork/Environment/Documents/Annex%203.pdf |

- `source/*.txt` are `pdftotext -layout` extracts of those PDFs, kept unchanged. MEPC.190(60) and MEPC.202(62) are scans, so the text has OCR slips
  (T for 7, O for 0, J for 7, stray quotes). `scripts/parse-eca.js` cleans them; `scripts/test-eca.js` checks that every table is complete (47 + 206 + 45,
  27 and 157 points) and that no two consecutive points are implausibly far apart.
- The tables list the offshore boundary only. The inner side is the coast, so each list is closed over land with a few inland points
  (`CLOSE` in `scripts/build-eca-zones.js`); the Great Lakes, the Bahamas, Cuba and the Canary Islands are outside, the Gulf of St Lawrence and the St Lawrence to Montreal are inside.
- The North-East Atlantic table ends by following the Canadian Arctic ECA boundary, whose points are not in the file; the ring is closed with one straight line, which only matters in the Arctic.
- The IMO web page "Emission Control Areas (ECAs) designated under regulation 13 of MARPOL Annex VI" was read for the definitions of the Baltic Sea and North Sea areas:
  https://www.imo.org/en/ourwork/environment/pages/emission-control-areas-(ecas)-designated-under-regulation-13-of-marpol-annex-vi-(nox-emission-control).aspx

## Drawn from the regulation wording (hand-made rings)
- Baltic Sea area: the Baltic Sea proper with the Gulf of Bothnia, the Gulf of Finland and the entrance to the Baltic Sea, bounded by the parallel of the Skaw at 57°44.8' N.
- North Sea area: south of 62° N and east of 4° W, the Skagerrak, and the English Channel and its approaches east of 5° W and north of 48°30' N.
- Mediterranean Sea (SOx ECA, in force 1 May 2025): the Mediterranean to the Strait of Gibraltar, bounded to the east by the Black Sea limit at 41° N. The wording was not
  re-read from an IMO text in this session; the outline is a set of boxes and should be checked against the resolution.

## Not included
- Canadian Arctic ECA and Norwegian Sea ECA (adopted later; their coordinates were not obtained).

## Limits
Planning figure only. Check the current IMO list before relying on a boundary or an effective date.

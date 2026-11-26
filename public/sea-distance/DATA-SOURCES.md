# Data sources for the sea-distance files in this folder

These are the provenance notes kept in Cheng-Pro (`data/*/SOURCE.md`). Port data: NGA World Port Index (U.S. Government work, public domain; attribution and disclaimer below). Sea lanes: Eurostat SeaRoute network, EUPL-1.2 (`LICENSE-EUPL-1.2.txt` is in this folder). Coastline: Natural Earth (public domain). ECA outlines: IMO resolutions and the Chinese Ministry of Transport scheme.

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
The zip contains no licence text. The statement below was supplied by the project owner on 26 Nov 2026 for use in the apps; it was **not independently verified against the NGA website** (msi.nga.mil is not reachable from the cloud session). It is shown in the Sea Distance page, the route options panel and the user guide, in short form on the route-map printout.

> Data Attribution & Disclaimer: Port reference data is derived from the World Port Index (Pub. 150) published by the National Geospatial-Intelligence Agency (NGA) Maritime Safety Information portal (msi.nga.mil), produced as a U.S. Government work (public domain under 17 U.S.C. § 105). Pursuant to 10 U.S.C. § 456, this geospatial information is provided "as is" with no warranty as to accuracy, currency, or completeness. This application is for general informational and planning purposes only—it is not an official NGA navigational product and must not be used for primary navigation or passage planning. Mariners must consult current official nautical charts, Sailing Directions, Notice to Mariners, and local port authorities. In accordance with 10 U.S.C. § 425, reference to NGA data does not imply U.S. Government or NGA endorsement, sponsorship, or affiliation.

Status: public-domain U.S. Government work, so redistribution of the derived port list (`data/ports/ports.json`) is permitted; the attribution and disclaimer above must stay with it.

## Summary
- Rows: 3669 (dBASE record count)
- Columns (78), exact order from the .dbf header:
  `INDEX_NO,REGION_NO,PORT_NAME,COUNTRY,LATITUDE,LONGITUDE,LAT_DEG,LAT_MIN,LAT_HEMI,LONG_DEG,LONG_MIN,LONG_HEMI,PUB,CHART,HARBORSIZE,HARBORTYPE,SHELTER,ENTRY_TIDE,ENTRYSWELL,ENTRY_ICE,ENTRYOTHER,OVERHD_LIM,CHAN_DEPTH,ANCH_DEPTH,CARGODEPTH,OIL_DEPTH,TIDE_RANGE,MAX_VESSEL,HOLDGROUND,TURN_BASIN,PORTOFENTR,US_REP,ETAMESSAGE,PILOT_REQD,PILOTAVAIL,LOC_ASSIST,PILOTADVSD,TUGSALVAGE,TUG_ASSIST,PRATIQUE,SSCC_CERT,QUAR_OTHER,COMM_PHONE,COMM_FAX,COMM_RADIO,COMM_VHF,COMM_AIR,COMM_RAIL,CARGOWHARF,CARGO_ANCH,CARGMDMOOR,CARBCHMOOR,CARICEMOOR,MED_FACIL,GARBAGE,DEGAUSS,DRTYBALLST,CRANEFIXED,CRANEMOBIL,CRANEFLOAT,LIFT_100_,LIFT50_100,LIFT_25_49,LIFT_0_24,LONGSHORE,ELECTRICAL,SERV_STEAM,NAV_EQUIP,ELECREPAIR,PROVISIONS,WATER,FUEL_OIL,DIESEL,DECKSUPPLY,ENG_SUPPLY,REPAIRCODE,DRYDOCK,RAILWAY`
- Example record: INDEX_NO 61090, PORT_NAME SHAKOTAN, COUNTRY RU, LATITUDE 43.866667, LONGITUDE 146.833333. Numeric fields are stored as text like `61090.000000`.
- UN/LOCODE: **not present** (no LOCODE column).
- Country names: **not present**; COUNTRY holds a 2-letter code (e.g. RU).
- Note for the converter: it must read the .dbf (or convert to CSV) and parse the 78 real columns; the old 7-column CSV layout no longer applies.

---

# Sea-lane network data — provenance and licence

## What this is
`marnet.json` is a global shipping-lane graph (42,334 nodes, 78,703 undirected edges, passage tags) converted by `scripts/import-marnet-eurostat.py`
from the **Eurostat SeaRoute `marnet_plus_5km` network** (`source/marnet_plus_5km.gpkg`, a GeoPackage read with sqlite3 only). Coordinates in `marnet.json` are
[lon, lat]; edge lengths are recomputed (great-circle, nm) by `scripts/sea-route.js`.

## Where it came from
- Repository: https://github.com/eurostat/searoute (Eurostat, European Commission), file `modules/war/src/main/resources/marnet/marnet_plus_5km.gpkg`,
  commit 88a2e568a8e0144d1f5a81c3931a7bc2bcce6901 (10 Jan 2022). SHA-256 of the stored copy: 75ca6cc130b3748f568196a9caf62889e9f096ec358f65223b4095ac070be0e7. Downloaded 26 Nov 2026.
- Verbatim from the Eurostat SeaRoute README, describing the network:

> This maritime network is based on the *Oak Ridge National Labs CTA Transportation Network Group, Global Shipping Lane Network, World, 2000* (retrieved from geocommons.com or github), enriched with some additional lines around the European coasts based on AIS data. Simplified versions of this network have been produced for different resolutions (5km, 10km, 20km, 50km, 100km) based on a shrinking of too short edges and a removal of similar edges.

## Licence
- The repository, including this data file, is published by Eurostat under the **European Union Public Licence v. 1.2 (EUPL-1.2)**; the licence text is in `source/EUROSTAT_SEAROUTE_LICENSE_EUPL-1.2.txt`.
  This replaces the earlier network taken from a third-party Python package whose licence for the data was unclear.
- EUPL-1.2 allows use, copying and redistribution, also commercially. Conditions that apply to what we ship: keep the licence text and the copyright / attribution notice with the data (done here and in
  the apps' `DATA-SOURCES.md`), and distribute a modified version (`marnet.json` is one: converted, tags renamed, dateline links added) under the EUPL-1.2 or a compatible licence. The data file is separate
  from the application code, which stays under the project's own licence.
- The EUPL's own wording is authoritative; this note is a plain summary, not legal advice.
- The upstream CTA data (Oak Ridge National Laboratory, 2000; a U.S. Government-funded dataset) is credited as the source above. Its own terms were not separately checked; Eurostat redistributes the derived network under the EUPL.

## What the converter does
- Splits each line into one edge per pair of vertices, merges equal points (5 decimals) into nodes, and keeps the `pass` attribute as the edge tag.
- Renames Eurostat tags to the ids the router uses: `babelmandeb` -> `babalmandab`, `magellan` -> `chili`. Tags in the file: northwest, northeast, chili, babalmandab, malacca, bering, kiel, gibraltar, dover, panama, suez, corinth.
- The lines are cut at the 180th meridian; each node at 180 E is joined to the node at 180 W with the same latitude (12 zero-length links) so that routes can cross the Pacific.
- Not tagged in this network (the router blocks them by region instead, see `PASSAGE_BOX` in `scripts/sea-route.js`): Strait of Hormuz, Cape of Good Hope, Sunda Strait, Bosporus, Dardanelles.
- The Kiel and Corinth canals and the two Arctic routes (Northwest Passage, Northern Sea Route) are never used by default.

## Limits
Planning estimate only; it is not a navigation product. Coverage: ports far from a lane (river and lake ports, some remote coasts) get a long attach leg and a low-confidence warning.

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

## Detail layers (zoomed-in map)
`detail-land.json` and `detail-water.json` are generated by `node scripts/build-detail-map.js` from Natural Earth 1:10m vector data (public domain; same licence text as above,
`source/NATURAL_EARTH_LICENSE.md`; repository `nvkelso/natural-earth-vector`, `VERSION` 5.2.0-pre, downloaded 2026-11-26). The raw files are large and are fetched by the script into
`source/ne10m/` (not kept in git). SHA-256 of the files used:

| File (geojson folder of the repository) | SHA-256 |
|---|---|
| ne_10m_land | `1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416` |
| ne_10m_minor_islands | `8c933ca7a4760256bdc46408355706e39764b0fa01c160c28888b90b4faec29f` |
| ne_10m_lakes | `2d036f53dedec578001c5c30c2959ee7d4eebc1306900fa4367c49929ec8f2d9` |
| ne_10m_rivers_lake_centerlines | `bb854a900ecbd3b408df46d5e16e3e0f974ba55993f9d8b5c26e855273c0905a` |
| ne_10m_rivers_europe | `90712202ac46985812e90840df9acd5101599a9c649868d5bc55ee96c2fedd4c` |
| ne_10m_rivers_north_america | `dcd2348655a5f3d0ea7be35024073ab24f09115d2e4efb77e7bc0a33567db682` |
| ne_10m_geography_marine_polys | `53f865e8ffa966cdd402145c82c5cd14ee7ce974cd0eb9a3f59f03a4cfd2d66c` |
| ne_10m_bathymetry_K_200 | `5c6c182da8608153ea2dce22dfb32c987e5390e0bd4a122266143ba181a7b636` |

What is in them: land and minor islands at two levels of detail (simplified to about 0.7 nm and 0.2 nm), lakes, rivers (world set outside Europe and North America, the regional sets inside them),
the area deeper than 200 m (the continental shelf is the water that is not shaded), and the centre point of each named sea, gulf, bay, strait and channel.

## Limits of the detail layers
Generalised data for a planning picture: not an electronic navigational chart. There are no soundings, buoys, lights, traffic separation schemes, restricted areas or canals as charted objects.
Canals and many passages are visible only as the sea-lane network (a separate, optional layer). Not for navigation; use the official ENC / paper charts.

Towns and cities (`detail-places.json`): Natural Earth 1:10m `ne_10m_populated_places_simple` (public domain), SHA-256 `fd3fa867a320cbd5c5b6bb5bc550afeec2939fb2cef688e508007282a55ac42f`; names in plain ASCII, shown by the zoom level Natural Earth gives each place. Port names and positions on the map come from the World Port Index (see data/world-port-index/SOURCE.md).

Country names (`detail-countries.json`): Natural Earth 1:10m `ne_10m_admin_0_countries`, label point and zoom range of each name; SHA-256 `239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255`. Names follow Natural Earth's de-facto naming; they say nothing about borders or claims and are not a statement on any dispute.
Reefs (dotted line in `detail-water.json`): `ne_10m_reefs`, SHA-256 `4dcfb7cb57e7c04108df66ca0ac1bb4125b2b40b6bb45d7d2aa589bd4e46dc57`: a generalised outline of the larger reefs, not a hazard chart.
Small islands: islands too small to outline at the zoom in use are drawn as dots; the smallest ones in the data are stored as a small diamond at their position (about 0.5 nm wide), so their shape is not real.

---

# Emission Control Area outlines — provenance

`scripts/eca-zones.js` holds the ECA outlines used to measure how much of a route lies inside an ECA. Part of it (between the
`BEGIN GENERATED` / `END GENERATED` markers) is generated by `node scripts/build-eca-zones.js` from the IMO resolution texts in `source/`.

## Official coordinates (generated)
| Area | Resolution | Source of the text in `source/` |
|---|---|---|
| North American ECA (Pacific coast incl. Alaska to Kodiak, Atlantic / Gulf coast, Hawaiian Islands) | MEPC.190(60), appendix VII, adopted 26 March 2010 | https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MEPCDocuments/MEPC.190%2860%29.pdf |
| United States Caribbean Sea ECA | MEPC.202(62), appendix VII, 2011 | https://www.epa.gov/sites/default/files/2016-09/documents/resolution-mepc-202-62-7-15-2011.pdf |
| Canadian Arctic ECA (adopted 4 Oct 2024; amendments in force 1 Mar 2026; SOx/PM fuel limit from 1 Mar 2027 after the 12-month exemption of reg. 14.7) | MEPC.392(82), appendix VII para 5 (179 points) | https://wwwcdn.imo.org/localresources/en/OurWork/Environment/Documents/MEPC.392(82).pdf |
| Norwegian Sea ECA (same resolution and dates) | MEPC.392(82) refers to MARPOL Annex II reg. 13.9.4, which lists 29 points | consolidated Annex II text (https://www.riigiteataja.ee/aktilisa/2190/3202/4004/MARPOL_Annex2.pdf) |
| China domestic ECA: coastal area (60 points; table 1) and Hainan waters (20 points; table 2); 0.50% S from 1 Jan 2019, Hainan 0.10% S from 1 Jan 2022, inland rivers 0.10% S from 1 Jan 2020 | China Ministry of Transport, Implementation Scheme of the Domestic Emission Control Areas, 30 Nov 2018 (English reference version) | https://www.sh.msa.gov.cn/u/cms/www1553673902179.pdf |
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
- Mediterranean Sea (SOx ECA, MEPC.361(79) adopted 16 Dec 2022, in force 1 May 2024, fuel limit from 1 May 2025): "all waters bounded by the coasts of Europe, Africa and Asia", closed at the
  line Cape Trafalgar (36°11' N, 6°02' W) - Cape Spartel (35°48' N, 5°55' W), the Canakkale line (40°03' N 26°11' E - 40°01' N 26°12' E) and the northern entrance of the Suez Canal, excluding the box
  31°14' - 31°29' N, 32°16' - 32°28.48' E (so Port Said is outside). The Sea of Marmara and the Black Sea are outside. The outline is one ring over sea and land that follows these lines; the wording is in `source/MEPC.361-79_mediterranean_eca.txt`.

## Closing lines and what is not modelled
- Canadian Arctic: the table is the offshore line from the Yukon to Labrador; the inner side is the coast, closed here along the 60° N parallel and the Yukon meridian over land. Hudson Bay south of 60° N is therefore outside (not checked against the Canadian definition).
- Norwegian Sea: the 29 points run from the Russian border to 62° N on the Norwegian coast; closed over Norway, Sweden and Finland.
- China: the 59 coastal points (point 60, the end of the Beilun River centre line, has no coordinates in the text) are the offshore line from the Yalu to the Vietnamese border; closed over land west of the Bohai Sea. The coastal area (0.50% S) equals the global cap, so it is **off by default** and only measured when the user switches it on; Hainan waters (0.10% S from 1 Jan 2022) are on. The scheme's "0.10% on the coast from 1 Jan 2025" was only a feasibility study and no confirmed notice was found. Inland river sections (Yangtze, Xijiang; 0.10% S since 1 Jan 2020) are not modelled.
- Not modelled: port-limit rules (EU 0.10% at berth, Hong Kong at berth, the Korean port ECAs, California 24 nm which lies inside the North American ECA anyway), and the Arctic/other national rules.

## Limits
Planning figure only. Check the current IMO list before relying on a boundary or an effective date.

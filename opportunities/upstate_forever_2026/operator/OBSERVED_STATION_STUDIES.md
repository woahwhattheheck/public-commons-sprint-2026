# Observed station studies

Nine prepared studies connect the original gauge, lake and outfall sources to the maintained Station Geography desk. The existing saved edition, editable location choice, map, table, source download and portable receiving operations apply to these studies.

| Prepared study | Stations | Linked context rows | Original location candidates |
| --- | ---: | ---: | ---: |
| Regional USGS inventory | 67 | 1,267 | 67 |
| Retained USGS flow and stage | 17 | 1,267 | 17 |
| Eighteenmile lake study | 5 | 254 | 5 |
| Eighteenmile agency outfall locations | 10 | 740 | 18 |
| Eighteenmile indexed flowline locations | 10 | 740 | 18 |
| Complete regional observed discharge | 29 | 2,291 | 29 |
| Complete regional observed discharge and stage | 30 | 2,294 | 30 |
| HUC05–07 original NWIS gauge positions | 13 | 26,242 | 26 |
| HUC05–07 original NLDI gauge positions | 13 | 26,242 | 26 |

The two regional selections retain the same original 67-point NAD83 source. Their site lists distinguish 16 gauges with retained daily flow, one Chauga stage station and 50 inventory-only stations. The 1,267 rows comprise 96 calendar-year flow summaries, 1,152 calendar-month summaries, 16 lake-study-period summaries and three Chauga stage summaries. The original point properties retain flow/stage coverage and the original source IDs.

The five lake stations retain two WGS84 points and three NAD83 points. Their 254 linked rows comprise 75 individual chlorophyll observations, 26 printed seasonal summaries, 14 continuous-pH summaries, 14 continuous-DO summaries, five surface ranges, 96 routine SWS nutrient observations and 24 same-activity total-nitrogen records. Original laboratory censor fields, reporting units, source project, sample clocks and measurement IDs survive unchanged.

Each combined Eighteenmile study selects the gauge, five lake stations and four permitted outfalls. It adds 12 gauge-month records, 240 facility-month records, 230 original DMR reporting periods and four source-bound network relations. All 740 rows have an exact selected station or permit identity. Linked context rows include measurements, summaries and network relations; the source-specific fields distinguish them.

## Agency and network location choices

Both combined studies retain all three representations of each outfall: native state EPSG:26917, agency-projected EPSG:4326 and NLDI-indexed EPSG:4326. The agency study explicitly chooses each native state feature. The network study explicitly chooses the corresponding indexed feature. Each choice binds the actual imported source, native state object ID and original feature index. The desk can inspect or change that choice while preserving all alternatives.

An indexed point describes the network attachment used in the original reach/measure analysis. The original gauge relation, reporting feature, permit identity and distance between the supplied and indexed coordinates remain visible in the source properties and linked relation table. Changing a displayed location does not recalculate discharge quantities or the retained network relation.

The five original studies select the original 217-HUC model domain already used by the maintained assessment studies. The three Eighteenmile studies also select the actual full-resolution USGS whole-catchment basin using its original gauge_id field. The native map produces point-to-polygon memberships for both sources. Current dated USGS WBD service comparisons are an additional source at observations/wbd_station_join_20261013; they retain their own source date and join results.

## Install into the maintained application

Receive this complete component beneath the existing application directory opportunities/upstate_forever_2026. The installer adds one catalogue extension to the current model/station_geography.py and retains its existing content, including later assessment and microbial study support. It checks every supplied original source byte before installation and preserves an existing differing source for explicit reconciliation.

```sh
python operator/install_observed_station_studies.py --application . --source-root .
python -m model.observed_station_studies --workspace /mnt/data/gis12/original-workspace --source-manifest observations/station_context.sources.json --list
```

The original 217-HUC model-domain source is imported through the existing application source intake. It is the same domain required by the maintained 87- and 159-station assessment studies. The supplied native observation manifest contains all 22 original point and table bodies used by these recipes.

In the existing operator, open Station Geography after importing observations/station_context.sources.json. The prepared selections appear alongside the existing assessment and microbial studies. Build either original agency or indexed Eighteenmile study, inspect the saved map, select an outfall, and compare its retained source candidates and linked observations. Use the existing portable archive download to carry the complete study into another workspace.

## Native build and receive

```sh
python -m model.observed_station_studies --workspace /mnt/data/gis12/original-workspace --study-id eighteenmile-observed-context-agency-10 --build
python -m model.observed_station_studies --workspace /mnt/data/gis12/original-workspace --study-id eighteenmile-observed-context-network-10 --build
python -m model.observed_station_studies --workspace /mnt/data/gis12/original-workspace --study-id upper-savannah-usgs-observed-17 --build --receive-workspace /mnt/data/gis12/received-observed-stations --create-receiving-workspace
```

The third command builds the actual observed17 study, exports the ordinary geography ZIP, receives it into the second workspace and compares original coordinates, candidate properties, native feature choices, watershed memberships and observation counts across the two editions.

## Integration details

The component adds model/observed_station_studies.py and its JSON source recipes, observations/station_context.sources.json, this guide and an additive installer. The application catalogue adds this code immediately before its existing station-geography-catalog return:

```python
    # Original observation station study catalogue extension
    from .observed_station_studies import prepared_studies as observed_station_studies
    studies.extend(observed_station_studies(workspace, original_studies=studies))
```

The current assessment recipe remains the source of the original model-domain selection. The catalogue shares that resolved domain reference so the new recipes avoid repeatedly decoding the 11 MB boundary. The CLI resolves the same original domain itself.

The receiving application packages its model, operator, observation and source directories through the existing portable application builder. Include the two new model files and observation manifest when composing a narrower Station Geography source inventory.

The authored component has been checked against every retained point/table body and the exact native station ID, alias, reference and choice contract. Source-level execution linked all rows above with zero unmatched or ambiguous aliases, and confirmed all22 bodies against their original hashes. Native Python build and receive results belong to the executing workspace operation.

## Additional HUC05–07 calibration gauges

The same component now offers two additional prepared studies over the thirteen retained USGS gauges and all 26,242 original daily rows from 2020–2025. Of these rows, 26,241 contain numeric daily discharge; the original `Rat` row at Horse Creek on 2024-09-24 remains linked with its original qualifier, empty numeric field and source-row identity.

Import the canonical source manifest from the application root:

```sh
python -m model.observed_station_studies --workspace /absolute/existing/workspace --source-manifest calibration_station_geography.sources.json --list
python -m model.observed_station_studies --workspace /absolute/existing/workspace --study-id huc05-07-calibration-gauges-13-nwis --build
python -m model.observed_station_studies --workspace /absolute/existing/workspace --study-id huc05-07-calibration-gauges-13-nldi --build
```

The NWIS study explicitly selects the thirteen original NAD83 gauge positions. The NLDI study explicitly selects the thirteen original NLDI geographic positions. Both retain all twenty-six original candidates and every source attribute. Original station IDs, original agency site IDs and time-series IDs remain distinct. Daily rows join through the exact original site-number alias; no date, qualifier or nonnumeric record is dropped.

Each study uses the same complete thirteen original NLDI whole-catchment polygons (`simplified=false`, `splitCatchment=false`). The existing Station Geography engine performs the declared CRS transformations and all point/polygon membership calculations. The unchanged original 217-HUC domain is added automatically when retained; the prepared study remains usable with the whole-catchment source while the domain is being received. A subsequent domain-backed selection retains a separate native edition. The receiving operation reuses its saved preparations across interruptions, even if another source is imported meanwhile. To select newly received domain geometry, choose a new prepared study in the desk or start the same receiver with its explicit --domain-manifest selection; the earlier native edition remains retained.

The two zero-measure NLDI endpoint relations identified in the geographic applicability source remain visible. Original station positions are not moved to force a point into its whole-catchment polygon. Displaying the NWIS and NLDI editions lets the operator inspect those original coordinate meanings and native memberships in the same desk.

The root manifest binds all four selected source bodies to one canonical collection and preserves 59 original source members, including all eight hydrology publisher responses, all twenty-six NLDI feature/basin responses, the dated daily table and original transformation records. The recipe requires that manifest identity when resolving these four sources, so the portable Station Geography package carries the original companions even when an older table-only collection is also retained.

Use the maintained `--receive-workspace` and `--create-receiving-workspace` options on either build command to reopen its completed geography ZIP in a second Workspace. The existing comparison checks both coordinate candidates, selected original sources, memberships and observation counts. A native run returns actual edition/build IDs and the ordinary report, maps, source inventory and ZIP descriptors.

Include `calibration_station_geography.sources.json` in an application capture's explicit root-source inventory. The added source files themselves remain in the already retained `source/hydrology-huc05-07-20261013/` directory. Existing five study definitions and their original source files are preserved.

## Complete regional discharge and stage views

Two combined prepared studies bring the original observation families into a single regional map. The 29-gauge discharge view links 2,291 period-summary rows: 174 annual, 2,088 monthly and 29 lake-study-period summaries. The 30-station view adds the separate Chauga stage station and its three annual summaries, giving 2,294 context rows. Together the two flow source families retain 59,701 original daily records for 2020–2025. The Horse Creek nonnumeric source record remains in its original daily collection and coverage fields.

| Prepared study | Stations | Period-summary rows | Selected point candidates | Whole catchments |
| --- | ---: | ---: | ---: | ---: |
| upper-savannah-usgs-flow-29 | 29 | 2,291 | 29 | 14 |
| upper-savannah-usgs-observed-30 | 30 | 2,294 | 30 | 14 |

Both views use the original NAD83 gauge coordinates from the two agency inventories. Their selected sites consist of the 16 previously retained flow gauges, the 13 additional observed gauges, and optionally the stage station. The original 67-site inventory remains available separately. The fourteen complete upstream catchments consist of Eighteenmile plus the thirteen additional original NLDI geometries. The application computes their point memberships separately from the original 217-HUC reporting domain. A gauge outside that reporting domain remains a usable observed station with its actual geometry and separate contributing-area support.

Import all three source manifests into the existing scientific Workspace:

```sh
python -m model.observed_station_studies --workspace /mnt/data/gis12/original-workspace --source-manifest observations/station_context.sources.json --source-manifest calibration_station_geography.sources.json --source-manifest regional_station_context.sources.json --list
python -m model.observed_station_studies --workspace /mnt/data/gis12/original-workspace --study-id upper-savannah-usgs-flow-29 --build
python -m model.observed_station_studies --workspace /mnt/data/gis12/original-workspace --study-id upper-savannah-usgs-observed-30 --build --receive-workspace /mnt/data/gis12/received-regional-observed-stations --create-receiving-workspace
```

The new root manifest binds the three additional summary tables without changing their source bytes. The gauge/catchment selection resolves through the existing canonical calibration manifest, preserving its original publisher responses and transformation records in the portable collection. The separate thirteen-gauge NWIS and NLDI studies continue to expose their full daily records and both coordinate alternatives. Include regional_station_context.sources.json alongside calibration_station_geography.sources.json in an explicit application source inventory.

## Complete retained-source installation

The additive installer validates and installs every primary body and companion in its selected native source manifests. If the application includes the observed hydrology report, supply its current root report recipe and source manifest together in `--source-root`; their complete source closure and calibration binding are validated before publication. `--dry-run` returns changed paths, selected native manifests and retained-source member count. Existing identical originals are reused, generated report/calibration bindings move together, and previous changed files retain the existing backup.

## Original WBD coordinate context

Import `observations/wbd_station_join_20261013/station-context.sources.json` alongside the three study manifests. All nine choices retain their original site and measurement selections and attach the 197-row source table through the existing `site_tables` selection. Saved CSV, GeoJSON, printable report and portable receiving distinguish exact selected native coordinates from alternative original coordinates. The complete source and executed join are described in `observations/wbd_station_join_20261013/STATION_CONTEXT.md`.


## Complete original nine-study receiving

The original regional operation uses project `b9d5d257-c6bb-4f07-b975-8e8c63705db3` and the nine selections already declared in `model/observed_station_studies.json`. Its station counts are 67, 17, 5, 10, 10, 13, 13, 29 and 30 in the original recipe order. The complete 197-point WBD source retains every original coordinate variant and all nine selected-coordinate matches.

Use the maintained installer with the complete original four-manifest station source edition:

```sh
python -B SOURCE_ROOT/operator/install_observed_station_studies.py --application APPLICATION --source-root SOURCE_ROOT --without-hydrology-report
```

`--without-hydrology-report` selects the complete station installation and leaves the separately installed `observed_hydrology_context.report.json` / `.sources.json` edition intact. All original station sources, companions, authored source upgrades, shared hooks, syntax checks, backups and concurrent-write checks remain active. The default retains the existing optional hydrology-report refresh behavior. The explicit station-only option avoids importing that unrelated report's older companion source versions into this receiving course.

The complete station input closure consists of the three original station/calibration/regional manifests and their retained original data, plus the original WBD station-context manifest. The original report refresh has a different source closure; including it is a separate deliberate installation choice.

After installation, run the original study course with the actual application, original Workspace and an owned output directory:

```sh
python -B SOURCE_ROOT/source_tools/receive_observed_station_studies.py --application APPLICATION --workspace ORIGINAL_WORKSPACE --source-root SOURCE_ROOT --output OWNED_OUTPUT
```

The receiver retains the full original prepared selections, executes each study in a fresh child process using the same interpreter, builds its ordinary report and geography ZIP, and reopens that archive in the separate receiving Workspace through the existing `operate` API. Source imports use the explicitly supplied complete source root; no geometry, station, observation or WBD context is recreated by the receiver. Existing native builders retain and reuse completed editions on interruption.

The producing native worker must open, LOOK at and operate the actual outgoing Station Geography reports and every attachment as their recipient would: readable maps/tables at desktop/screenshare and 390px, the original source downloads, complete geography archives, and their independently received editions. Inspect the actual exported pages and contents, fix observed faults, and retain actual result identities in the original receiving thread. A saved screenshot that nobody viewed is insufficient. Keep this focused on completing the product.

## Current owner direction carried with this receiving operation

The following is the complete `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`. Its native model priority and October 13, 2026 14:00 UTC cutoff govern this complementary receiving course.

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.

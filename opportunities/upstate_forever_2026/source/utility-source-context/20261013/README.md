# Utility source context for the retained Upper Savannah study

This workflow joins the existing two-utility topology to the original FY26 NRCS state records and complete-domain South Carolina classification query. It reuses the retained 303-record USGS network, original 217-HUC domain and 36 utility memberships.

## Operate the same original source edition

From the application root:

```bash
node source_tools/utility_source_context_cli.mjs \
  --out /absolute/path/to/existing-workspace/utility-source-context
```

The command verifies all four selected original input byte identities before joining their records. It writes the complete JSON result, 46-row state-context CSV, readable HTML report and standalone designation explorer, with original HUC12 IDs, native source fields, state designations, class counts and source hashes. The output path can be the actual receiving Workspace; the command uses the retained source files in this application and performs no source acquisition.

The same source edition is ready for the ordinary Workspace source store:

```bash
python -B -m model.cli --workspace /absolute/path/to/existing-workspace \
  source-import source/utility-source-context-20261013.json
```

The imported document's stable ID is `upper-savannah-utility-source-context-20261013`, role `UTILITY_SOURCE_CONTEXT`. The existing original regional context, topology, network and classification-coverage bodies travel as source companions. The historical regional run `watershed-4592eb077b7164d59ba4` and its source/output identities remain the original earlier receiving edition.

## Actual results

| Source quantity | ARJWS | Pioneer / PRWD |
| --- | ---: | ---: |
| Original whole HUC12 units | 4 | 32 |
| USGS published whole-HUC area, km² | 428.01 | 2,562.96 |
| USGS and NRCS whole-HUC area, acres | 105,763.50 | 633,323.13 |
| Original NRCS state–HUC rows | 4 | 42 |
| NRCS state-portion acres | 105,763.55801944 | 633,323.37951127 |
| High-priority state–HUC rows | 1 | 3 |
| High-priority Ground acres | 29,763.37755626 | 59,689.71374627 |
| High-priority Surface acres | 0 | 0 |
| High-priority Both acres | 0 | 14,806.13777125 |
| Selected SC classification records | 0 | 1,002 |
| HUCs containing an SC portion | 4 | 12 |
| HUCs outside SC classification jurisdiction | 0 | 20 |

The NRCS priority in ARJWS is Upper Three And Twenty Creek's SC Ground designation. Pioneer's original priority records are Gum Log Creek in GA, system Both, and the two state portions of Lower Tugaloo River, system Ground. These are programme designations with their original resource concerns; they do not establish water quality at an intake and do not set an InVEST subsurface parameter.

Pioneer's selected classification inventory contains 879 ORW, 71 TN and 52 TPGT records, associated with seven HUC12 attributes. These are original publisher feature counts, not unique stream names, stream lengths, regulatory measurements or parcel intersections. The source query explicitly selects ORW, ONRW, TN, TPGT and TPT. Absence of one of these selected records does not assign a class to every water in the HUC.

The 20 Pioneer HUCs outside South Carolina remain part of the whole-watershed planning selection. The SCDES source supplies their query membership result while its regulatory jurisdiction stays South Carolina. Georgia and North Carolina designations require their own original sources.

## Preserve the three geographic meanings

The existing utility profile supplies whole-HUC focus anchors. Original ToHUC links identify the whole-HUC upstream planning footprint. The published intake protection polygons remain a separate geographic layer with their own 200-foot and 1,500-foot source records. Model totals use the actual retained analysis/reporting mask and finite pixels.

USGS `areasqkm` and `areaacres` are preserved as separate published fields. NRCS `huc12_ac` is counted once per distinct HUC, while `st_ac` is counted once per state–HUC row. Their original rounding differences remain visible. The CSV repeats whole-HUC fields and HUC-assigned classification counts on cross-state rows to retain the original relation; use distinct utility/HUC12 pairs when summing whole-HUC area or classification features. State-portion acres are summed on the original utility/HUC12/state rows. The JSON and HTML provide those unduplicated sums directly.

## Native quantities and receptor interpretation

[InVEST 3.20 NDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) produces nitrogen and phosphorus export rates in kg/hectare/year. [InVEST 3.20 SDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html) produces sediment export rates in metric tonnes/hectare/year. The application converts each native rate to cell mass using the actual native cell area once. Polygon totals multiply that retained mass by the selected reporting overlap fraction, with the uniform within-cell assumption retained in the application.

Both models describe land-origin export reaching the modeled stream. A ToHUC association groups that land for a receptor; it does not add in-stream retention, reservoir processing or an intake-concentration model. Paired changes compare actual alternative and baseline values on the same finite support, with alternative minus baseline and its negative for reduction.

The maintained regional model's presentation edition is now 1.1.0. Its report identifies land-origin export and the separate HUC-to-receptor relationship explicitly. The version participates in the report identity, preserving earlier reports under their original identifiers.

Scientific interpretation — **Needs expert review**: apply the retained programme, jurisdiction and model-endpoint distinctions when using this source context for watershed decisions.

## Reusable source contract

`source_tools/utility_source_context.mjs` exports:

- `buildUtilitySourceContext({topology, context, coverage, network, identities})`: verifies the original domain, class-query/count relation, utility paths and source areas; returns every original utility state row and its clearly scoped summaries.
- `utilityContextCsv(result)`: writes the complete utility/state record table.
- `utilityContextHtml(result)`: writes a standalone readable report with model meanings and original input identities. Wide tables scroll individually on narrow screens, and numeric values keep their digits together.
- `utilityContextExplorer(result, {sourceExplorerHref})`: writes the complete standalone designation controls and embeds the same JSON, CSV and report outputs. The optional link selects an actually supplied companion explorer.

No primitive missing value becomes zero. Zero source feature counts come from the selected classes in the original complete-domain query; geographic jurisdiction is an independent field.

## Original source paths

The exact paths, byte lengths and SHA256 values are in `inputs.json`. They reference the existing repository source editions:

- `source/receptor-topology/20261013/utility-topology-results.json`
- `source/receptor-topology/20261013/usgs-wbd-savannah-original-topology-20261013.json`
- `source/water_context/20261013/full-domain-water-context.json`
- `source/water_context/20261013/scdes-domain217-source-coverage.json`

The utility profile retains the [issuer RFP and appendix](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf). The source context retains the original [NRCS FY26 service](https://services.arcgis.com/SXbDpmb7xQkk44JV/ArcGIS/rest/services/Source_Water_Protection_Resource_Concern_FY26/FeatureServer/7), [SCDES classification service](https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2), and [USGS WBD layer](https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6).


## Receive both native Python utility exports

The same original data can be run with Python 3.10 or newer and its standard
library. From one pinned complete application checkout:

```bash
python -B source_tools/receive_utility_source_context.py \
  --out /absolute/path/to/existing-operation/utility-receiving
```

The receiver verifies the four original input bodies and the profile hash already
declared by the original topology result. It calls the maintained regional model,
utility-selection logic and watershed brief writer. Each execution writes a new
directory containing the full 217-HUC report, both utility selections, readable
briefs, original state/programme tables and the GIS membership CSVs.

The actual stdout and `receiving.json` record the computed report and selection
identities, source hashes, loaded implementation hashes, Python version, elapsed
time and every output file identity. All original input bodies travel with the
result. Keep the checkout fixed for the duration of the run. The receiver uses
local retained sources and requires no GIS package or network request.

## Responsive source explorer and report

Open `explorer.html` from the same generated directory. Choose either utility and an original watershed, inspect its state designation and jurisdiction, and use **Complete JSON**, **State record CSV** and **Full HTML report**. These downloads retain the original source values and identities. The HTML report uses one scroll container per wide table on narrow screens; numeric cells remain intact, and print removes horizontal scrolling.

The source producer emits the same presentation that was repaired in the original desktop and 390-pixel browser course. The generated report is 18,632 bytes for the retained source edition, SHA256 `1e6cb3c45c654983ccf1e7cde370a5b6dc4606aa86b4122791aa7bcf6919c491`. The table styling, wrappers, mobile hints and numeric classes preserve every original element's text. JSON, CSV, computational method version and original source hashes remain unchanged.

The command also copies the installed `source-explorer.html` when its embedded original topology and network bytes exactly match this selected input edition. Its relative **Back to watershed explorer** link then works from the generated directory without a server. If that optional member is absent or represents another source edition, the designation report and controls still generate; the return link is omitted and stdout records the reason as `source_explorer_status`. The source explorer itself retains its original 217-domain/4-or-32-utility selection and its saved-review reopening workflow.

`presentation_version` identifies this rendering separately from computational `version`. The ordinary source manifest retains the current report, standalone explorer and guide byte identities; reimporting that manifest preserves the new presentation edition alongside previously imported source objects.

Before presenting the outgoing edition, open and look at its actual desktop/screenshare and narrow/mobile screens and operate both utility selections, original watershed choices and all three downloads. Open the downloaded HTML and CSV, extract any delivered archive, and reopen the contained working source explorer. Inspect populated, empty, loading and error states where the interface provides them. View actual screenshots rather than relying on capture success, source review, DOM counts or another worker's approval. Repair clipped, split, cramped or overflowing content using plain industrial presentation. This applies to all final HTML, PDF, GIS, images, spreadsheets, archives, projects and any media; watch and listen to delivered media. Preserve original data, running scientific operations and existing owner-controlled policies, and carry the complete instruction into delegated receiving work.

## Current demonstration direction

The complete owner brief below is retained from `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`. Source-only designation review supports the same actual regional simulated-model course; it does not replace native execution.

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

# Regional atlas: source-calendar analysis and Monitoring intake

This complete study joins ECO-CLOUD-0730's original Regional Observation Atlas to
the existing Monitoring and Scientific Reports workflows. The whole 217-HUC
geography, 36 original station locations and original 730 source rows travel with
it. The selected routine cohort contains 729 activities; its one field replicate
remains in the excluded-record ledger and original source file.

## Open and work with the study

Open `index.html` from the package root. It is an offline, grayscale source review.
Choose the year window and exact analytical method, then inspect catchments,
stations, station-by-month cells, same-method year pairs and complete original
activity rows. The search and source-water filters select the displayed cohort.
Every displayed cohort exports in full, including all original source-row IDs.

Use **Planning handover** to retain reviewed catchments and notes. Load the
existing campaign configuration from its saved plan/receiver selection or the
original configuration JSON. It travels unchanged. The reviewed catchments are
separate review notes, not implicit additions to required-site constraints.
Save locally and export the review JSON for another workstation. Importing the
review checks the exact original source hashes and project identity.

The static report is `calendar-support.pdf`. Editable GIS is
`gis/calendar-support.gpkg`, with original projected watershed polygons and
original station points. The generated GeoJSON source includes full original
ToHUC links and attributes. No point is placed at a catchment centroid.

## Calendar and scientific meaning

The reference window defaults to January 2021 through December 2025. Each
station-month or HUC-month cell is occupied when it contains at least one selected
routine activity. Counts retain their source method and original censoring
intervals. The denominator is an explicit historical calendar, not a promised
sampling schedule or station operating period.

The station, catchment, annual, month and method tables contain zero cells as
well as occupied cells. The same-station/method year-pair table lists the exact
common calendar months and original activity counts. Equal month sets alone do
not establish equal flow, weather, frequency or sampling design. The study does
not pool the APHA and USGS analytical methods or calculate a concentration trend.

Three source fields support explicit Monitoring objectives:

| Source field | Meaning |
| --- | --- |
| `calendar_source_water_ha` | Original source-water intersection hectares |
| `calendar_no_observation_priority_ha` | Those hectares only where the selected cohort has no activity |
| `calendar_gap_priority_ha` | Source-water hectares × fraction of reference months without selected activities |

The last two objectives describe historical source support, not environmental
risk or site feasibility. Candidate catchments without source stations remain
search areas. Existing stations count as future baseline monitoring only when
explicitly selected in the original configuration. Historical presence does not
establish a funded ongoing campaign.

## Regenerate from the original atlas

Use the existing GIS environment with Fiona, Shapely, pyproj and ReportLab:

```sh
python source/atlas_calendar.py \
  --atlas /absolute/path/to/regional-observation-atlas-v1 \
  --output /absolute/path/to/new-calendar-edition
```

`--start-year`, `--end-year` and repeatable `--method APHA:9223-B` select another
explicit source window. The output directory must be new or empty. The package's
`inputs/` directory also has the original atlas layout needed for regeneration.
The source manifest pins all retained input bytes. The compiler carries its
complete source and HTML template into every generated edition.

## Receive in the existing scientific application

Keep the current complete application. No original shared module is replaced.
Use its existing scientific Workspace and an output directory outside both the
Workspace and this package:

```sh
python source/receive_atlas_calendar.py \
  --application-root /absolute/path/to/current/upstate_forever_2026 \
  --workspace /absolute/path/to/original/scientific-workspace \
  --package /absolute/path/to/calendar-package \
  --request /absolute/path/to/atlas-calendar-review.json \
  --output /absolute/path/to/calendar-native-operation
```

Omit `--request` to receive the default complete source window and calendar-gap
priority. This imports both vector sources and the typed report, builds the
original Monitoring network through the maintained source reader, and renders
through the existing Scientific Reports collector/formatter. With a supplied
configuration it runs the original native solver and saves its complete plan,
using unchanged dates, budget, currency, costs, crew and other constraints.

`--create-campaign` explicitly creates a new campaign from a feasible saved plan.
The stable operation ID supports replay. No existing campaign is revised. The
original 86A9 full-36 campaign continues independently and can adopt the new
source/priority through its maintained revision workflow.

The operation keeps `receiving.json`, native network/plan/campaign records as
applicable, source-bound review, PDF, HTML, Markdown, structured report and the
ordered report selection. Repeating the unchanged invocation reuses its saved
source and native records. A different selection uses a new operation directory.
Source imports retain original companions; model calculations and field records
remain under their existing owners.

## Package layout

`data/` holds complete source-row, station, watershed, calendar, method and
comparison tables. `gis/` holds source-ready vectors and a two-layer GeoPackage.
`inputs/` retains complete original source files. `source/` contains the full
compiler, review template and native receiving command. The two
`calendar-*.sources.json` manifests integrate with the current Sources desk;
`observed-report.json` uses the existing `upstate.observed-report/v1` contract.

Scientific source provenance is retained in `inputs/data/source-register.json`
and each station's `selected_source_ref`. The original authority and date belong
to the source, not to this compilation. The report's planning interpretation
uses those source identities throughout.

# Upper Savannah monitoring field support

Open `Ecosystem_Monitoring_Field_Planning.html` for the self-contained working desk. Read `Monitoring_Field_Support_Brief.pdf` for the one-page findings.

The original $4,800, $9,000 and $13,200 plans select 6, 12 and 18 catchment search areas. Their retained evidence joins reach the same 11 E. coli stations and 234 original results in Upper and Lower Tugaloo River. The draft-assessment site counts change from 10 to 14 to 15. These are different scientific objectives and source selections, preserved explicitly.

## Operate and keep the working selection

Choose a budget and search area. Inspect station coordinates, the original source fields, and historical records before selecting a candidate field location. An observation station and a draft-assessment station remain separate source choices even where their names resemble one another. The assessment metadata include WGS84, NAD83 and UTM17N coordinates. Original X/Y values and axis meanings remain separate from the displayed WGS84 latitude/longitude in both the desk and crew CSV. Add the field note, choose original calendar rounds, and save both the crew CSV and selection JSON. Open the saved JSON in another copy of the desk to restore its original plan, station choices, notes and rounds.

The example in `examples/` demonstrates one source-station selection and carries an explicit example note. It is an editable operating example, not a project field assignment. Its 18-slot calendar retains the original dates, crews and local time allowances.

The historical table initially selects routine samples. Its 233 matching rows exclude the one separately retained field replicate; choose all activities to see all 234 plan-associated records. The complete utility edition contains 730 records. Original conditions, detection-limit fields, method context, unit spellings, sample dates, source filename and CSV row ordinal remain intact. The CSV export returns every selected row, not just the visible page.

## Native source receiving

Use the original complete application and project from the accompanying Monitoring and Chemistry Workspace handoff. This field-support addition imports through the application's existing native source API:

```bash
python -B source/receive_field_support.py \
  --application /absolute/path/to/application \
  --workspace /absolute/path/to/workspace \
  --package /absolute/path/to/this-directory \
  --output /absolute/path/to/receiving-result.json
```

The receiver checks the original project, native network and all three saved plans, imports the complete manifest, then reopens both registered entries and their preserved companions. The document is `monitoring-field-planning`; the table is `monitoring-budget-field-support`. All imports are additive.

## Reproduce from the retained native project

```bash
python -B source/build_field_support.py \
  --application /absolute/path/to/application \
  --workspace /absolute/path/to/workspace \
  --budget-study /absolute/path/to/original-budget-study \
  --output /absolute/path/to/new-output
python -B source/build_field_page.py \
  --study /absolute/path/to/new-output \
  --template source/field_planning.html \
  --output /absolute/path/to/new-output/Ecosystem_Monitoring_Field_Planning.html
```

The producer reads the original Monitoring plans and verifies their native source bindings. It intersects the retained 34 WGS84 and two NAD83 station-coordinate records with the complete original catchment polygons, retaining actual transformation metadata and boundary distances. It keeps native assessment placement separate from publisher-listed HUC12 and utility membership. Every original observation and source companion is included.

`field-support.json` contains the complete joined data. `source-selection.json`, `native/`, and the five original source catalogs retain the exact source selection. `source-manifest.json` retains the complete hierarchy for native import. `CURRENT_OWNER_DIRECTION.md` carries the unchanged current owner direction, version 2026-10-13.3.

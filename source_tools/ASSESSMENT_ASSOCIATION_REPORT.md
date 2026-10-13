# Assessment and station publisher association report

This complete report joins the selected 192 original assessment records at 159
sites to the maintained native station-identity crosswalk and the original
217-watershed NRCS programme report. It gives reviewers every original record,
both publisher HUC assignments, source-page/feature references, the full
watershed comparison and complete reusable CSV/JSON files.

## Open the completed original report

The complete executed report is retained under
`results/assessment-association-review-20261013/`. Download or extract its
`assessment-associations.zip` and open `OPEN_ASSESSMENT_ASSOCIATIONS.html`.
The same directory contains `sources.json` for the existing Workspace import
command below. Its original report ID is
`assessment-association-report-94578ccc2ba23bd5bdd9`.

Keep saved review HTML beside the other extracted report files when following
its original CSV/JSON download links. Its interactive record selection and
selected-record CSV/JSON exports remain embedded in the saved HTML.

The current source inputs are the maintained original editions:

- `source/station-assessment-context/assessment-records-domain217.csv`:
  111,624 bytes; SHA256
  `01f1a0262bb719f39d4b6c8b6e690bbf670d9aea83cbe0f532daf81b0c6a09f7`.
- `source_data/wqp_assessment159_additional_two_20261013/assessment159_native_identity_crosswalk.csv`:
  42,751 bytes; SHA256
  `b5a658b16a9cb0b891426d53db78de01429f4363b83f2ff30625f9dbf932d84c`.
- `source/station-assessment-context/source-priority-assessment-domain217.json`:
  629,194 bytes; SHA256
  `5474827855ed902441d4cf0f65b17a606fefe715d902dc0c3c5fa0855f17b61f`.
  This is the unchanged complete original result from F0C8KECMA4V, including
  source references and selected-input identities.

The pure report builder reuses the merged
`source_tools/station_assessment_identity.mjs` exact-source join. Each
assessment identity is the pair of its publisher source ID and original record
ID. All 813 statewide TMDL records have source_row=1 in that original producer;
the selected records therefore retain their original IDs and source row text.

## Build, register, open and transfer

From the current complete application root, choose a new output directory whose
parent already exists. Node's standard library is sufficient for composition:

```sh
node source_tools/assessment_association_report_cli.mjs \
  --output /absolute/new/association-report \
  --workspace /absolute/existing/workspace \
  --python /absolute/current/python
```

The CLI writes the entire report and portable ZIP, then invokes the maintained
`model.cli source-import` against that exact generated source manifest. The
import returns the source collection ID. Open **Sources** in the existing
operator and select the resulting **Upper Savannah assessment and station source
associations** document. Its normal download inventory contains the report,
tables, exact original inputs and complete `assessment-associations.zip`.

Extract the ZIP into an empty directory and open
`OPEN_ASSESSMENT_ASSOCIATIONS.html` for the complete offline reviewer. The
document retains its internal table/record navigation and relative file links.
Search by station, source ID, HUC, county, cause or description; combine the
publisher relationship, source edition and programme filters. Select records
across searches, export that exact selection as CSV or JSON, or save a complete
HTML review with its current filters and selected original identities. The
printed report includes all 192 records together with the source and programme comparison tables.
Use the original source manifest to receive the same report and all companions
into another existing Workspace:

```sh
python -B -m model.cli --workspace /absolute/receiving/workspace \
  source-import /absolute/extracted/report/sources.json
```

The outer source manifest also retains the downloadable ZIP as a companion.
Inside that ZIP, its self-contained source manifest inventories the report's
files without recursively including the archive itself. Both bind the same
report document and input edition.

The output directory must be new. A failed write removes only the newly created
incomplete directory. A later Workspace import failure keeps the complete report
and ZIP and prints their location, so the original source import can continue
without rebuilding the report.

Omit `--workspace` to create the same complete portable report first.
`--assessments`, `--crosswalk` and `--programme` accept explicit retained input
paths; current source join validates its exact original assessment and native
crosswalk editions.

## Read the original associations

The actual joined source cohort has:

| Relationship | Assessment records | Distinct sites |
|---|---:|---:|
| Exact station-publisher HUC12 available |182|152|
| Station source reports HUC8 only |10|7|
| Assessment and station HUC12 differ |6|6|

Of 192 records, 176 match at HUC12 and 10 match only at the reported HUC8 level.
The ten coarser records remain unresolved for station-publisher HUC12 and its
NRCS state-HUC lookup. Their possible domain HUC12s are a lookup of all matching
prefixes.

The selected assessment-publisher HUC assignments associate 11 records at 8 sites
with NRCS FY26 priority HUCs. The station-publisher exact HUC12 assignments
associate 12 records at 9 sites. Each relationship reaches the same four priority
HUCs across the two assessment editions. The sole added priority association is
SV-809: the July 2026 TMDL table reports Cane Creek 030601010305; the retained
station publisher reports Lower Tugaloo River 030601020507, whose original
FY26 priority state rows identify GA and SC Ground / Water Quality.

All six differing HUC12 records belong to the July 2026 E.coli recreational-use
table and retain its original not-supported status:

| Station | Assessment-publisher HUC12 | Station-publisher HUC12 |
|---|---|---|
| SV-809 |030601010305|030601020507|
| RS-06190 |030601030502|030601030602|
| SV-318 |030601030510|030601030609|
| SV-164 |030601030602|030601030502|
| SV-052 |030601030609|030601030509|
| SV-353 |030601070208|030601070207|

The other five differences keep the same non-priority NRCS status in this
selected domain. The four original utility-focus HUCs have five records under
assessment-publisher assignments and six under station-publisher exact HUC12
assignments. All counts retain their stated relationship and denominator.

## Optional saved native polygon membership

Supply the actual saved Station geography `analysis.json` when that completed
edition is available:

```sh
node source_tools/assessment_association_report_cli.mjs \
  --geography /absolute/saved/station-geography/analysis.json \
  --output /absolute/new/association-report-with-geography
```

The report reads existing station memberships. It verifies the selected point's
original source SHA and native feature ID against the identity crosswalk before
showing that station's HUC12 membership as comparable. An absent station,
unresolved location, different selected point edition, outside-domain point or
missing polygon selection remains an explicit status. All retained membership
source references remain in the complete JSON/CSV.

Source comparison alone does not calculate point/polygon membership. Geographic
membership remains the original station-geography result; its selected point,
native CRS and polygon source references are retained. Native x/y values and
CRS strings in the publisher comparison remain original.

## Complete outputs and interpretation

The report includes every selected record and a complete 217-HUC comparison,
per-edition counts, all differences, original coordinate/feature identities and
NRCS state-HUC rows. Spreadsheet-facing CSV fields protect formula-like text;
canonical JSON and copied source files retain exact original values. Finite
negative coordinate strings remain unchanged in the derived CSV, and formula
expressions receive the protective apostrophe. Coordinate processing must retain
the stated native CRS; `assessment-native-identity.csv` remains the exact output
of the source join.

`assessment-native-identity.csv`, `publisher-huc-differences.csv` and
`identity-summary.json` are the unchanged outputs of the original reusable
source join. Report-specific outputs add programme and optional saved membership
context. The artifact inventory records exact output bytes and SHA256; the source
manifest retains the complete report closure.

Publisher assignments can be reviewed together without replacing either
original. A source-label difference does not modify impairment or use-support
status. NRCS programme priority, an assessment listing, a station location,
classified-reach status and modelled nutrient or sediment export remain distinct
source products. Counts of assessment rows, sites, HUCs and state-HUC programme
rows use their stated denominators.

# Complete station and assessment source-scope review

This report explores the complete original Savannah native station source and
two statewide assessment editions together. It retains every original record,
including assessments outside the selected 217-HUC domain and records absent
from this particular native station selection.

The source inventories contain 705 native station features, 1,516 published
2024 assessment records and 813 July 2026 assessment records. Exact station IDs
associate 246 assessment records with 209 native stations. Every native feature
retains its original attributes, geometry and EPSG:26917 coordinates; every
assessment retains its source-bound ID, original page, normalized source pointer
and complete original record.

## Open and explore

Download `source-scope-report.zip` from
`results/assessment-source-scope-review-20261013/`, extract it into an empty
directory, and open `OPEN_SOURCE_SCOPE.html`.

The reviewer works offline. Use the summary cards and source-scope filters to
choose records, then search station IDs, HUCs, county, cause or description.
Switch between statewide assessments and native station features. Tables show
100 rows per page; **Select all current results** selects every matching row
across all pages. The status line shows matching, selected and displayed counts.

Open a row for its complete original record and source identities. **Open
complete native station feature** and **Review this station's assessment
records** follow the exact station ID. Assessment source-page links retain the
original publisher reference.

Selections persist across filters, separately for assessments and native
stations. JSON exports contain complete nested original records, source inputs
and interpretation. CSV exports serialize nested source objects as JSON cells,
protect formula-like text and preserve finite negative coordinate values.

**Save complete review HTML** preserves both original inventories, filters,
selections and the active detail record. Keep it beside the extracted files for
its relative source download links. **Print current results** prints every
filtered row, including rows beyond the displayed page, together with the
report's source-comparison context.

## Use the existing Workspace source registry

From the complete application root:

```sh
python -B -m model.cli --workspace /absolute/current/workspace \
  source-import results/assessment-source-scope-review-20261013/sources.json
```

The normal **Sources** document and companion downloads receive the readable
report, complete audit data, portable ZIP and exact original source files.
The source entry supplies its report vintage and binds every companion's
bytes and SHA256.

To rebuild the report, choose a new output directory:

```sh
node source_tools/assessment_station_source_audit_cli.mjs \
  --application /absolute/current/application \
  --output /absolute/new/source-scope-report

python -B -m model.cli --workspace /absolute/current/workspace \
  source-import /absolute/new/source-scope-report/sources.json
```

The CLI reads four primary source bodies and five source companions. The
composer checks their original bytes and hashes and preserves all six original
audit files. It adds the offline report, source closure, report inventory,
source manifest and compressed ZIP.

## Source selections and denominators

| Source relationship | Assessment records | Native stations |
|---|---:|---:|
| Complete statewide assessment editions | 2,329 | — |
| Exact association with this native source | 246 | 209 |
| Assessment publisher HUC inside selected domain | 192 | — |
| Selected-domain assessment with native-source match | 182 | — |
| Selected-domain assessment absent from this native selection | 10 | — |

There are 496 native stations without a matching record in the two assessment
editions. This describes coverage of those sources; it does not determine the
stations' water quality.

For the 246 associated records, the publisher assignments give:

| Assessment publisher HUC | Station publisher HUC | Records |
|---|---|---:|
| Inside selected domain | Inside selected domain | 182 |
| Outside selected domain | Inside selected domain | 1 |
| Outside selected domain | Outside selected domain | 63 |

The one outside/inside record is the July 2026 SV-192 assessment. Its assessment
publisher HUC is `030601030613` and its native station publisher HUC is
`030601030513`. Both source assignments and the original record remain visible.

All eight differing publisher HUC12 records appear in the source-comparison
table and **Different publisher HUC12** filter. SV-686 is the differing 2024
record whose publisher HUCs are both outside the selected domain. Original
counties, descriptions and source pages remain available for inspection.

SV-835 and SV-834 retain their original 11-digit native HUC strings:
`30601030507` and `30601010703`. The reviewer marks their reported level as
unresolved at HUC12 and retains their original coordinates without padding or
reassigning those attributes.

## Relationship to the original 192-record report

`results/assessment-association-review-20261013/` contains the complete
217-HUC assessment-publisher selection: 192 records at 159 sites. That report
also joins the separately retained WQP station sources. Ten records have
station sources reporting HUC8, so their station-HUC12 programme association
remains unresolved.

This whole-source review uses the original 705-feature native selection and
complete statewide assessment editions. Its 246 records at 209 stations have
a different source selection. The offline report links to the fixed original
comparison, preserving both results and their denominators.

Publisher identifier comparison does not calculate point/polygon membership.
The maintained Station geography workflow retains its original point and
polygon analysis; native coordinates and CRS are available here for it.

## Complete portable originals

The ZIP includes the native station body, source manifest, publisher query
provenance and count response at their original
`source_data/scdes_savannah705_20261013/` paths.

It also includes both complete normalized assessment editions, the original
2024 publisher table-text companion, selected domain identifiers and unchanged
source manifest under `source/water-quality-assessments/20261013/`. Both original
import manifests retain their relative paths and resolve after extraction.

The report-level `sources.json` imports the whole report through the existing
Workspace document route. Its outer copy also registers the ZIP download; its
inner copy omits that archive self-reference. `report-artifacts.json` inventories
the report and original files, while the original `artifacts.json` continues to
describe the unchanged audit output.

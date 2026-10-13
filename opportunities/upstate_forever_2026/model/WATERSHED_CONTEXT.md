# Watershed context

The watershed context module turns the retained 217-HUC12 domain, NRCS FY26
state records and SCDES source coverage into regional, state and selected
watershed exports. It runs with Python 3.10 or newer and the standard library.

## Run the retained source

From the Upper Savannah application directory:

```bash
python model/watershed_context_cli.py \
  --source-context source/water_context/20261013/full-domain-water-context.json \
  --classification-coverage source/water_context/20261013/scdes-domain217-source-coverage.json \
  --select-huc12 030601020507 \
  --output-dir outputs/watershed-context

```

The complete context retains all original model HUC12s. The selection option
controls the separate selected-watershed exports and selection summary. Omit
it to export all watersheds as the selection. Multiple HUC12s may follow the
option, which may also be repeated.

The CLI also runs as `python -m model.watershed_context` or directly as
`python model/watershed_context.py`.

## Results and source meanings

The accepted regional source contains 217 distinct HUC12s, seven HUC8 regions
and 240 matched NRCS state rows. Their published watershed areas sum to
4,659,072.10 acres. Distinct state portions sum to 4,659,074.06895431 acres.
The 1.96895431-acre difference is retained; neither total is rescaled to the
other. Twenty-two watersheds span multiple states, including one spanning
three states.

NRCS identifies 15 distinct priority watersheds through 18 priority state
rows. Whole priority watersheds cover 467,561.88 acres. The designated state
portions cover 467,562.072553 acres. These totals represent two different
spatial selections: a cross-state watershed can contain both designated and
undesignated state portions.

| HUC8 | Model HUC12s | Priority HUC12s | Selected class records | Publisher HUC12s |
| --- | ---: | ---: | ---: | ---: |
| 03060101 | 36 | 1 | 782 | 8 |
| 03060102 | 32 | 2 | 1,002 | 7 |
| 03060103 | 57 | 4 | 102 | 4 |
| 03060104 | 43 | 7 | 0 | 0 |
| 03060105 | 18 | 1 | 0 | 0 |
| 03060106 | 8 | 0 | 0 | 0 |
| 03060107 | 23 | 0 | 0 | 0 |

The original SCDES geometry source has 1,886 records assigned by the
publisher to 19 HUC12s: ORW 1,040; TN 247; TPGT 599. The exact 217-HUC
membership query for ORW, ONRW, TN, TPGT and TPT returns the same complete
object-ID set. The additional query for HUC8s 03060104 through 03060107
returns zero selected-class records. The companion preserves both source
queries and the original geometry capture predicate.

The module binds coverage to the HUC12 membership in the original query
URL, the target class set, complete ID-set comparison and matching retained
counts. Each HUC includes separate fields for the query result and state
jurisdiction. The model domain contains 116 South Carolina-bearing HUC12s
and 101 HUC12s outside South Carolina.

| Field | Meaning |
| --- | --- |
| `classification_assignment` | Always `publisher_huc12_attribute` for these summaries. |
| `selected_classification_count` | Retained source records assigned to this HUC12 for the five target class codes. |
| `classification_coverage` | Selected target records, queried zero target records, outside South Carolina, or unverified. |
| `classification_query_coverage` | Whether the complete exact-domain query is bound to the supplied context. |
| `classification_scope` | South Carolina, outside South Carolina, or unknown from the retained state rows. |
| `priority` | True if any state row says High Priority Area; false for entirely Not Selected rows; null for unclassified priority status. |
| `area_acres` | Full watershed area counted once from NRCS `huc12_ac`. |
| `state_portion_acres` | Sum of distinct NRCS `st_ac` portions for that watershed. |
| `role` | `model_domain` unless an explicit native record supplies reporting or upstream role. |

These source counts support inspection and regional context. The existing
receiving-water engine computes geometric intersections and land-origin
sediment and nutrient export summaries over the selected contributing geometry.
InVEST transport ends at the modeled stream; river and reservoir retention and
intake concentrations require their own models. Outside-state watersheds
remain available for the original domain's upstream contributions.

## Python API

```python
from model.watershed_context import (
    build_watershed_context,
    selected_watershed_export,
    write_watershed_context,
)

report = build_watershed_context(
    source_context,
    classification_coverage=coverage_companion,
    network=native_network,              # Optional original HUC12/ToHUC records.
    selected_huc12s=["030601020507"],
)
files = write_watershed_context(report, output_directory)
selection = selected_watershed_export(report, ["030601020507"])

```

The pure report schema is `upstate.watershed-context/v1`. It includes:

- `hucs`: the complete model domain, including names, states, source state
  records, priorities, areas, classification context and optional topology.
- `huc8s` and `states`: regional summaries with distinct watershed and
  state-portion accounting.
- `priority_matrix`: source groups with both NRCS priority and selected
  classifications, priority alone, classifications alone, and remaining
  model watersheds.
- `selection`: selected IDs and their quantitative summary.
- `classification_coverage`: source membership, original query and retained
  geometry information.
- `network`: explicit native topology status, supplied-domain coverage and
  known domain exit edges.
- `sources` and `methods`: retained source references and calculations.

The deterministic report ID includes the analysis version and the full
input context, coverage, native network and selection. A change in one of
those inputs produces a different report ID.

The selected export schema is `upstate.selected-watersheds/v1`. It carries
the parent context ID and canonical report hash, selected rows and summary,
source references, coverage and methods. The same report can support
several selections without rerunning the source join.

## Optional native network

Pass `--network PATH` to include a JSON object containing a `rows` array
or original GeoJSON/Esri `features`. Each row needs its original HUC12 and
ToHUC attributes. Recognized names are:

| Field | Accepted names |
| --- | --- |
| Watershed identifier | `huc12`, `HUC12`, `huc12_code`, `HUC_12` |
| Downstream watershed | `ToHUC`, `tohuc`, `TOHUC`, `to_huc12`, `downstream_huc12` |
| Optional source role | `role` with `reporting`, `upstream` or `model_domain` |
| Optional reference | top-level `source_reference` |

Original HUC12 identifiers must retain all 12 digits. Blank downstream
values are unknown. Explicit terminal values include zero, twelve zeros,
OCEAN and CLOSED BASIN.

Topology follows the supplied directed links. It returns distinct known
upstream model-domain HUC12s, their source areas and priorities, downstream
paths, domain exits and source cycles. Upstream metrics exclude the focal
watershed. Missing records and unknown downstream links remain explicit.
The module uses the original source links for connectivity; HUC number
prefixes are used only for the separate HUC8 grouping.

## Export files

| File | Contents |
| --- | --- |
| `watershed-context.json` | Complete report and all original model HUC12s. |
| `watershed-hucs.csv` | One row per model HUC12 with quantitative context and source references. |
| `watershed-huc8s.csv` | One row per HUC8 region. |
| `watershed-states.csv` | Distinct state-portion summaries. |
| `watershed-report.md` | Readable regional, state and priority tables plus methods and sources. |
| `selected-watersheds.json` | Source-bound selection with retained per-state records and optional topology. |
| `selected-watersheds.csv` | Selected HUC12 rows. |

The writer returns a filename-keyed mapping with relative path, exact byte
length, SHA-256 and media type for each written file. CSV nested lists and
mappings are JSON values in their cells. JSON preserves HUC12 strings;
treat HUC12 columns as text when importing CSV into a spreadsheet.

Input `canonical_sha256` fields hash sorted compact JSON values. Original
source-byte hashes remain distinct, including the coverage companion's
membership response SHA-256. Export hashes cover the exact bytes written.

## Continue the original domain network

The CLI reads both plain JSON and gzip-compressed JSON by the original file
signature. Pass the retained original model-domain Esri JSON gzip directly:

```bash
python model/watershed_context_cli.py \
  --source-context source/water_context/20261013/full-domain-water-context.json \
  --classification-coverage source/water_context/20261013/scdes-domain217-source-coverage.json \
  --network /dev/shm/dbc61-upstate-model-domain-20261012/model-domain.esri.json.gz \
  --select-huc12 030601020507 \
  --output-dir outputs/watershed-context-20261013
```

Use the existing original domain's path on the receiving host. Its decompressed
original body has SHA-256
`2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`.

The reader streams directly from that retained gzip into the JSON parser.
The complete Esri or GeoJSON feature collection reaches the existing
HUC12/ToHUC interpretation, including its original fields and attributes.

The same native network input is included in the deterministic context ID.
Loading identical JSON from plain or compressed storage keeps the same
calculation identity. Supplying the original network enriches each model
HUC with its downstream path and distinct upstream model-domain HUCs,
areas, priorities and selected-classification counts.

The full and selected HUC CSVs now include the original state-area mapping
and the computed native-network fields. Nested HUC lists remain JSON in
their cells; missing network values remain empty. The Markdown report
shows selected whole-watershed areas, original state portions, selected
upstream context and downstream domain exits. Its source section links
to the original publishers; full source identities remain in the JSON.

These exports use the same filename-keyed path, byte-count, SHA-256 and
media-type mapping as the existing report writer. Add the report directory
to the maintained watershed workbench and map-atlas operation so its current
selection, export and reopen controls consume the same context ID.


## Utility contributing-watershed selections

The Regional watersheds desk now reads the original retained
`source/receptor-topology/20261013/utility-focus-profile.json` alongside
the saved regional report. Each utility choice joins its original focus
anchors to the complete native HUC12/ToHUC network in that report. It saves
the distinct upstream model-domain HUC12s and anchors as one original
selection. The existing four-anchor export remains separately labelled.

For the retained source edition, ARJWS selects four HUC12s and Pioneer
(PRWD) selects 32. Their actual HUC12 sets are disjoint. The reusable
selection logic traverses the supplied native links; it does not assume
those counts or determine drainage from HUC prefixes. Known upstream
source HUCs outside the selected model domain remain explicitly listed.
A report built without its native network provides an explanation and the
existing source/network build controls.

The selection keeps three distinct areas: original whole-HUC planning
units, published intake-protection polygons, and the retained native
reporting mask. NRCS `huc12_ac` counts each selected watershed once;
`st_ac` counts each original state–HUC portion once. USGS published
`areasqkm` remains in the original topology source and is not substituted
for NRCS acreage-derived report area.

`Ground`, `Surface` and `Both` retain their original NRCS programme
labels. The designated state-portion table reports each label separately
and preserves unknown source acreage. The source labels describe programme
context, not measured intake quality or InVEST subsurface coefficients.
SCDES counts retain their publisher-HUC assignment and SC jurisdiction.

Saving uses the existing `watershed.context.export` action with the
actual `report_id` and the displayed `utility_key`. The server reloads
the original profile and derives the same membership from the saved
report before exporting. The utility key includes the complete report,
profile byte identity, source anchors, membership, original state rows and
programme summaries. A changed profile creates another selection.

The saved export includes:

- The original utility profile bytes and their declared SHA-256.
- Complete selected-watershed JSON and per-HUC CSV.
- `utility-watershed-memberships.csv`, with original HUC12/ToHUC text,
  utility/receptor identity, anchor flag, whole-HUC acres, state labels and
  source/report identity for a direct GIS attribute join.
- `selected-watershed-state-records.csv`, preserving every original
  source field on its state–HUC row.
- `selected-programme-designations.csv`, with original labels, designated
  acreage, known acreage and missing-area counts.
- HTML and Markdown briefs with the utility footprint, anchor IDs,
  designated programme areas, source jurisdiction, membership and references.
- The original contributing-context CSV, when present.

Reopen the saved utility selection from the desk's existing selection
list. The selection keeps the same parent report and verified original
file downloads. Brief format v4 produces a new export identity; earlier
saved v3 exports retain their original files.

The scientific unit interpretation remains unchanged: InVEST 3.20 native
N/P export rates are kg/ha/year and sediment export rates are metric
tonnes/ha/year. Native cell mass uses the actual cell hectares once;
reporting overlaps and paired finite support retain the original model
calculation. The utility source selection itself computes no pollutant load.

See the [complete original two-utility source study](../source/utility-source-context/20261013/README.md)
for the independently traversed source records and runnable Node source join.

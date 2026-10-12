# Explicit MultiDatastream component analysis

This contribution lets an operator select original positions in a retained SensorThings MultiDatastream, explain the interpretation of each selected position, examine its original events and source metadata, and carry the selection through the existing analysis publication and receiving workflow. It uses the original SensorThings source store, operation journal, retained-file client and analysis project. The original scalar Datastream path remains available.

A component is identified by the original stream, its zero-based position, the exact source edition and the complete ordered metadata binding. An array result is never passed implicitly to a scalar parser. The original result vector and its complete observation JSON remain beside every projected value.

## Complete original example and present execution state

The retained example is IoTLab's AD4GD/KWB river Spree source, MultiDatastream 23, Thing 26 (Weid_Aqua100Data), Sensor 30 (AquaTroll 100), and Weidendammer Brücke. The source describes measurements from 2016; this example does not represent current telemetry.

The selected window is **20 June 2016 00:00:00 UTC, inclusive, through 27 June 2016 00:00:00 UTC, exclusive**. All seven advertised continuation pages were retained in original order. The request asked for 128 rows; the service returned six pages of 100 and one of 72. Each opaque continuation URL is retained verbatim.

The complete package contains 51 files: 24 original response bodies, 24 complete acquisition receipts, two failed source-query receipts, and its manifest. Both complete connector tool responses are retained in each acquisition receipt. Their actual return clocks and declared lengths are source evidence. Original provider HTTP status, request method and response headers were not exposed by that connector and remain null.

The complete selected recording contains 15 responses. It reconstructs exactly from the original package without another provider request:

| Item | Bytes | SHA-256 |
|---|---:|---|
| source-manifest.json | 37,256 | 5d5d7b25ba8ec913848ee0b49af58b4842013117a9934b5cb5ef6aff3dbabfba |
| native-recording.json | 1,946,549 | e1343f86d88e28648a3cd8648923b5471ae0fd31e3bbcb76a15a61916c2d0a04 |

The original files are under:
`stellar/scf-starforge-20261009/operations/sensorthings-iotlab-multicomponent-native-20261012/`.

The exact original-file decoder, component calculation and report rendering have executed in **Functions V8** against all these retained inputs. Source hashes, both full connector receipts and the full next-link sequence were checked. The report's execution receipt identifies those exact source modules and the restricted environment adapter. This establishes the original-file calculation. It does not establish a native source edition, browser run, approved publication or independently restored analysis project. Those actual identities come from the same original workspace receiver below when it runs.

No additional source capture is required for this example. Hamburg's categorical observations and BGS's separate scalar-pressure source keep their own recordings and editions.

## What the original positions mean

[OGC SensorThings 1.1, section 12, requirement 42 and table 12](https://docs.ogc.org/is/18-088/18-088.html) define the ordered relationship between results, units, component types and observed properties. The original response must establish the order; the application does not sort the properties into a preferred order.

| Original position | Original property | Original unit symbol | This example |
|---:|---|---|---|
| 0 | Seconds since first measurement | s | Retained as an original counter. It is not used to repair timestamps. |
| 1 | Water temperature | C | Explicit original JSON-number interpretation, retaining the original property and unit. |
| 2 | Conductivity at 25 C | uS/cm | Explicit original JSON-number interpretation, retaining the original property and unit. |
| 3 | Name/definition say total dissolved solids; description and sensor metadata say suspended solids calculated from conductivity | ppt | Retained and displayed with the source conflict. Not selected for this calculation. |

The four original `multiObservationDataTypes` are QUDT/SAREF property or unit URIs. They are not the five allowed observation-type codes in the cited OGC table. The selected component decision therefore records `numeric-json`, an explanation, and acknowledgment of `COMPONENT_TYPE_NOT_TABLE12_VALUE`. It does not change the original declaration to OM_Measurement or certify the service as conformant.

The public source and the two unsuccessful licence queries do not establish a data reuse licence. The CC BY 4.0 notice on the separate [AD4GD deliverable](https://zenodo.org/records/10838962) applies to that document. It is not assigned to these observations. The source report retains this distinction and the original source attribution.

## Actual source findings

There are **672 distinct original observation IDs**, each retaining four source positions, for **2,688 original component values**. Selecting positions 1 and 2 produces 1,344 explicit component occurrences.

The source has **644 distinct instants**, **28 instants containing two original observation IDs**, and **seven adjacent separations of 75 minutes**. The other 636 separations between distinct instants are 15 minutes. Ninety-six source rows per UTC date does not establish ninety-six distinct quarter-hour samples.

For example, at 2016-06-20T22:00:00Z, original observation 551 contains `[370800,21.363,810.148,0.527]`, while original observation 599 contains `[414000,21.225,821.949,0.534]`. Both survive the calculation and point projection. Their different elapsed counters are retained; neither event is shifted to another timestamp.

| Selected component | Eligible original samples | Exact sum | Arithmetic sample mean | Minimum | Maximum |
|---|---:|---:|---:|---:|---:|
| Temperature, original C | 672 | 15345.19 | 22.835104166667 | 20.452 | 25.346 |
| Conductivity, original uS/cm | 672 | 552163.765 | 821.672269345238 | 774.641 | 848.606 |

Each mean retains its exact sum/672 rational representation. Displayed decimals use half-even rounding to twelve decimal places. These are arithmetic means of the selected original occurrences, including the duplicate timestamps. They are not time-weighted values. The source supplies no resultQuality field for these 672 observations; missing quality is reported explicitly and does not become a QA pass.

The source report includes the complete daily sample table, all 28 duplicate-instant groups with both IDs/vectors/citations, every one of the 643 adjacent observed gaps, and a point-only figure for each selected component. No line joins the samples. There is no imputed coverage, inferred expected sample count, duration weighting, automatic unit conversion or timestamp repair.

## Exact values and plotting are separate

`componentExactEligibility` checks actual JSON numeric tokens, original positional alignment, explicit interpretation, integral values for a source-declared CountObservation, explicit normalized instant support and the bounded exact-decimal exponent. It permits canonical exponents from -4096 through 4096. Unsupported values remain source rows with a named exclusion reason.

`componentNumericEligibility` is the browser plotting boundary. It additionally requires a finite JavaScript number and rejects a nonzero original value that becomes zero in the browser. Exact sums, extrema and daily summaries use the exact-arithmetic eligibility; plotting never controls them.

The summary reports both sets of counts and exclusion reasons. The original `numericEligibleRows` field is retained as the browser eligibility compatibility field, with an explicit meaning. `exactNumericEligibleRows` determines `numericSummary.count`. The actual selected IoTLab source has 672 values eligible for each boundary in each component.

The original JSON number lexeme is retained throughout. Decimal sums and comparisons use integer arithmetic. A browser point is a display projection; its tooltip and downloadable row still carry the exact original value and source pointer.

## Rebuild the same recorded input

Use the selected original package in a private directory. The following command reads all declared files, checks their bytes and SHA-256, binds the complete connector evidence, and reconstructs the exact already-acquired recording. It has no HTTP client.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sensorthings/record-multicomponent.mjs \
  --originals /absolute/original-source-package \
  --output /absolute/receiving-input/native-recording.json
```

The output path is create-only. A repeated invocation accepts an existing output only when its full bytes match the pinned recording. An interrupted prefix or different file remains preserved and produces an explicit error.

The programmatic boundary is:

```js
import {assembleIotlabRecording, buildIotlabRecording}
  from './sensorthings/record-multicomponent.mjs';
```

`assembleIotlabRecording({manifestBytes, readMember})` is the pure retained-file boundary. `readMember` returns the complete declared original member bytes. `buildIotlabRecording({directory, destination})` supplies the native read/write boundary. Neither performs a source request.

## Receive the original week through the maintained workspace

Use the existing selected SensorThings installation and its original workspace. Keep the source inbox, buyer workspace and managed listener bindings with their original host owner. The receiver accepts an explicit absolute workspace path and the frozen recording.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sensorthings/receive-multicomponent.mjs \
  --workspace /absolute/original-sensorthings-workspace \
  --recording /absolute/receiving-input/native-recording.json
```

The fixed original operation is `SCF_SENSORTHINGS_IOTLAB_COMPONENTS_1B40_20261012`. The receiver uses the original source.add, catalog.capture, plan.create and capture.start actions, each with its stable suffix and the current expected revision. It consumes the exact selected recording and disables provider fetch. A completed source receipt records actual workspace, source, catalogue, plan, capture and edition IDs. It checks all 672 IDs, the array result shape, the four aligned metadata positions and consumption of all 15 selected responses.

If the same capture stopped before completion, reopen the same workspace and recording with `--resume`. The receiver preserves original requests and their response indices, including the repeated opening/closing metadata URL. It does not replace failed original responses with later source data. An unresolved action or failed request must be inspected through its saved original operation.

The receiver returns the complete component catalogue. Each position carries the real native-edition binding ID. Do not substitute the received-original-file report's binding ID: that report deliberately uses a different source identity and has no native edition.

## Responsible source review and original dataset/export

After examining the complete native edition and its actual issues, retain a JSON review with the actual IDs returned above:

```json
{
  "schema": "stellar-forge.sensorthings-iotlab-source-review.v1",
  "operationId": "SCF_SENSORTHINGS_IOTLAB_COMPONENTS_1B40_20261012",
  "editionId": "ACTUAL_NATIVE_EDITION_SHA256",
  "decision": "accept",
  "actor": "RESPONSIBLE_OPERATOR",
  "note": "ACTUAL_SOURCE_REVIEW",
  "acknowledgeIssues": ["ACTUAL_REVIEWED_ISSUE_CODE"]
}
```

The uppercase strings are placeholders, not a prepared acceptance or source identity. Supply the source's actual issue codes and the operator's substantive review. Reopen the same receiver with `--review /absolute/source-review.json`.

This records the original edition.review, prepares the original `components` dataset containing all four retained source positions, and exports the complete source edition. `delivery.sourceExport` is the original transfer receipt. `delivery.sourceFiles` and `datasetFiles` are full original file-selection responses. Their native IDs remain separate from the operation IDs.

## Explicit component selection and original analysis project

A native selection retains:

```js
{
  streamKeys: [actualMultiDatastreamKey],
  componentSelections: [{
    streamKey: actualMultiDatastreamKey,
    index: 1,
    bindingId: actualNativeComponentBindingId,
    interpretation: {
      mode: 'numeric-json',
      acknowledgedIssues: ['COMPONENT_TYPE_NOT_TABLE12_VALUE'],
      note: 'The operator explains use of this original numeric token, property and unit without rewriting the source datatype.'
    }
  }],
  period: {start: '2016-06-20T00:00:00Z', end: '2016-06-27T00:00:00Z'},
  view: 'numeric',
  timeBasis: 'phenomenonTime',
  viewerId: actualInstalledViewerIdOrNull
}
```

The complete example receiver requires positions 1 and 2. It accepts `--components` with schema `stellar-forge.sensorthings-iotlab-component-review.v1`, the original operationId, actual editionId, recordingSha256, actor, title, note, both complete componentSelections and optional viewerId. It validates the exact current bindings, then calls the existing `analysis.create` action. Other components remain separate explicit analyst choices in the same application.

Changing source edition or ordered metadata changes the binding. A revised selection must use the newly displayed descriptor and retain a fresh interpretation where required. Missing metadata, differently sized arrays or an unavailable property cannot be resolved by an acknowledgment. A missing result element remains a blocking numeric alignment issue.

The original result and selected component have separate identities. A comparison reports a selected-value/meaning change separately from a change confined to an unselected parent value or related source context. Comparing two editions does not establish an atomic service snapshot or a deletion at the source. Newly introduced declaration issues never receive an inferred acknowledgment.

## Native selection, exact summaries and original viewer

The existing **Source and saved selection** view now offers original scalar Datastreams or explicit MultiDatastream positions. The component catalogue comes from the current retained edition. Each position displays its complete property, unit, original observation declaration, source pointer and binding ID. The operator selects each position, chooses source-declared meaning or an explicit numeric-JSON interpretation, acknowledges the actual findings and records the reasoning. Nothing is selected or acknowledged automatically. Changing edition clears these choices; the backend also requires the exact new bindings.

The saved overview and row view show exact-arithmetic eligibility separately from finite browser plotting. They retain exact sum, rational sample mean, rounded display mean, extrema with citations, original quality-field presence, daily sample counts, repeated timestamps and adjacent separations. Timeline detail in the saved summary is bounded at 10,000 duplicate/gap entries per selected component, with explicit omitted counts. The actual 672-observation example fits in full. Complete publication CSV tables retain the full sequence.

The native viewer uses the unchanged original Helgoland application and existing authenticated STA query/paging route. The additive `analysis/component-sta.mjs` presents explicitly **derived** scalar-shaped component series with safe string identities; it is not a replacement service and does not rewrite a provider entity. Original vectors, typed IDs, units, declarations, sample times, quality, parameters and source references remain beside each derived entity in `analysis@component`. Map availability requires actual usable retained Thing, Sensor, selected property, Location and unit metadata. Numeric availability additionally requires eligible aligned finite JSON-number instants. A non-OGC source declaration remains visible after an explicit numeric interpretation; it is never changed to OM_Measurement.

A saved comparison separates selected-component changes, changes only in the original parent vector, and ordered metadata differences. A new issue in a later edition cannot receive an automatic acknowledgement. Original opening/closing byte comparisons and source/connector/native clocks remain the same separate source-context record.

## Publish, download and independently receive the same project

Use the actual saved project and version to retain a publication decision. The receiver's optional `--publication` file has schema `stellar-forge.sensorthings-iotlab-component-publication.v1`, the original operationId, actual projectId/versionId/editionId, named actor/title/note, and the actual comparisonIds/viewerEvidenceIds arrays.

The source edition must have an accepted review in the original workspace. The receiver calls the same `analysis.publish` and `analysis.export` actions. It returns the original publication and project-export records unchanged, adding `fileSelection` with the complete maintained file list. It never replaces the original record's files array.

The original publication operation includes a complete component report JSON, exact sample-summary CSV, daily CSV, duplicate-instant CSV and adjacent-gap CSV alongside its complete original row CSV/NDJSON. Every gap has both original endpoint occurrence lists and source citations. Separate-unit SVG figures retain original points, with an explicit preview cap of 10,000 per component and 25,000 per report; all 1,344 selected component occurrences in this example fit. No connecting line or interval support is inferred. Full source vectors and citations remain in the complete row files even if a larger figure reaches its stated cap.

The self-contained brief includes the positional interpretation, exact statistics, daily counts, duplicate/gap summaries and derived point figures. The original publication manifest and project export include every added file automatically; no second report store or receiver exists.

Use those returned selections with the existing retained-file client. They are `{kind:'analysis',id:actualPublicationOrExportId}`. The held-file reader reports full bytes/SHA, bounded ranges and an original read handle; the normal downloader binds both exportId and manifest SHA. Keep the original source archive, metadata, explicit component selections, annotations, review decisions and complete report files in the same project transfer.

Independent receiving uses the original analysis import/receiving operation, its configured source inbox and current expected revision. Source reviews are receiving evidence; they are not silently promoted to a new operator's accepted decision. The existing project receiver preserves the original project/version/selection identity and checks its entire declared closure before returning success. An actual receiving result and a reopened project are required before describing that phase as complete.

## Reproduce or reopen the complete original-file report

The complete explicit plan is `component-analysis-plan.json` in the operation package. The standalone report command is useful for inspecting the acquired originals before a native source edition exists:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sensorthings/report-multicomponent.mjs \
  --originals /absolute/original-source-package \
  --plan /absolute/operation/component-analysis-plan.json \
  --output /absolute/component-source-report
```

It creates a private, create-only report directory, retains the exact input plan/manifest and the ten actual runtime source modules, then writes:

- Complete source-bound JSON and self-contained HTML.
- The 1,344 selected source occurrences as editable CSV, with original full vectors, positions, property/unit declarations, time, quality and source citations.
- Daily sample summaries, all duplicate instants and every adjacent observed gap.
- Two standalone SVG point figures.
- The original request intent and a final complete file manifest.

A second invocation with the same completed output verifies every original report file and returns it without calculating again. An incomplete directory stays preserved. It never becomes a completed report merely because some output files exist. A deliberate new calculation requires an explicit new output location; the original input and failed files remain intact.

This command creates no SensorThings workspace, capture, edition, source review or application publication. It labels the actual runtime and retains null native IDs. The current committed report was calculated in Functions V8 at the recorded time. Its execution receipt binds the exact executed source blobs and their archived byte copies, including component model 046e7184f3eb474c006123ef967547b39651f4d3. The maintained component successor adds saved-summary timeline details without changing those original calculated files. A future native invocation records its own Node runtime and exact source copies; it does not replace the existing report receipt.

## Installed modules and integration boundaries

All implementation belongs to the original `sf30-seller-sdk/sensorthings` tree:

| Module | Responsibility |
|---|---|
| analysis/components.mjs and components.d.mts | Ordered metadata bindings, explicit selection, row projection, exact sample summaries, source-linked comparison. |
| analysis/component-source-report.mjs | Validate the complete original file/receipt closure and calculate the selected source report. |
| analysis/component-report.mjs | Full editable CSV, source-linked HTML and explicit point SVG. |
| analysis/component-publication.mjs | Complete native component tables, cited duplicate/gap report and bounded separate-unit point figures within the original publication. |
| analysis/component-sta.mjs and the original sta.mjs | Derived, explicitly attributed component series through the existing authenticated query and paging machinery. |
| record-multicomponent.mjs | Reconstruct the exact existing recording from retained original files. |
| receive-multicomponent.mjs | Original source/action/review/analysis/publication/export receiving programme. |
| report-multicomponent.mjs | Native retained-file report creation and completed-output reopening. |

The normal distribution contribution exposes the source-owned commands and paired component declaration. Its current composition retains the original scalar, Helgoland, Python, Desk and managed Applications metadata.

The shared analysis hooks use the existing model/schema/core/STA/UI, with the component model selected only when a component selection is supplied. Original scalar selection, original Python source handover and the original category timeline remain distinct paths. The native Helgoland projection must expose explicit derived component series with original source IDs, positions and interpretation context. It must not feed a complete array to parseFloat, infer a scalar measurement declaration, or connect the original source points into a continuous trace.

The final receiving owner carries the same original source operation through its managed application, point display, publication download and independent project reopen. No competing provider capture or second native store is part of this contribution.

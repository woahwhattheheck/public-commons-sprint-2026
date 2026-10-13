# Measurements: configured scientific authoring, results and receiving

This course operates the original Measurements service through its configured command-line and Merchant interfaces. It covers observation editions, sediment fitting and comparison, Chiques source intake, source-preparation comparison, daily-flow and concentration/discharge comparison, and complete original result files. The scientific models, database transactions, draft histories and receiving formats stay in the original service.

Use the installed `starforge measurement-workspace-client` command, or `node products/measurement-workspace/client-cli.mjs` from the complete selected source. Follow [OPERATOR.md](OPERATOR.md) for installation, Applications Review/Start/Open, the private connection receipt, token environment, host-declared input aliases and scientific workspace. Follow [LARGE_FILE_TRANSFERS.md](LARGE_FILE_TRANSFERS.md) for original files and full native editions too large for ordinary JSON requests. Follow [RECEIVING.md](RECEIVING.md) for independent receiving and the full standing producing-peer/all-attachments instruction in the operating guides.

The selected catalogue has 166 operations and retains 142 complete original scientific/source-tool files. This edition adds 58 routes to the preceding 108: ten observation, eighteen sediment, fifteen sediment comparison, four Chiques, three intake comparison, seven flow/flow-load comparison and one original-result source-selection operation. The existing sixteen Merchant tools remain and two tools expose complete native artifacts. The client does not create scientific defaults or automatically approve a parsed source.

## 1. Choose a useful original task and retain its inputs

Start with the scientific question, complete original files, actual station/sensor identity, source-supported quantities, time support and author. Select the appropriate original workspace and current source catalogue. Keep the original input files and the exact scientific JSON document beside the full output. Do not replace a source by an abbreviated row extract when its original identity, qualifiers or review context are required.

| Intended work | Original route family | Complete continuation artifact |
| --- | --- | --- |
| Explicit observation relationships, exclusions and downstream population | `observation-*` | Saved edition, original observations/report CSV, calibration JSON and complete workspace/source handback |
| Fit an SSC or TSS surrogate and inspect held-out predictions | `sediment-*` | Full scientific project, saved study, drafts/requests and HTML plus all four tables |
| Compare saved sediment models on the same original held-out targets | `sediment-comparison-*` | Full comparison project, including complete candidate sediment studies and histories |
| Receive the retained Chiques nutrient collection | `chiques-*` | Complete original preparation, text files and XLSX attachments through native collection receiving |
| Explain a change in source preparation | `intake-compare`, `intake-comparison-reopen` | Complete saved comparison with original preparation history |
| Compare two saved daily-flow studies | `flow-compare`, `flow-comparison-*` | Complete comparison bundle, with both full parent products |
| Compare two saved concentration/discharge load results | `flow-load-comparison*` | Complete load-comparison bundle, both results, original studies, contracts and CSVs |
| Return sources supporting a historical calibration or paired-load result | `export-source-selection` then original Source Returns | Full selected original sources through the existing handback publisher and receiver |

A report is useful for reading. A complete scientific project or bundle is needed when another engineer must inspect the original choices, reproduce the result or continue the work. Whole-workspace export is needed when the current imported source tables, reviews and wider project state must also travel.

## 2. The same configured execution pattern for every family

### Read a catalogue or saved document

Retain a fresh transport UUID before calling a GET operation. For example:

```sh
starforge measurement-workspace-client read \
  --config /absolute/private/connections.json \
  --workspace monitoring \
  --operation sediment-catalogue \
  --request-id 8b4907a0-420d-45fb-a4f1-72771d50be41 \
  --out /absolute/output/sediment-catalogue-receipt.json
```

The example UUID represents one deliberate request; generate and retain your own. The output is the transport receipt. Download its original response:

```sh
starforge measurement-workspace-client download \
  --config /absolute/private/connections.json \
  --workspace monitoring \
  --request-id 8b4907a0-420d-45fb-a4f1-72771d50be41 \
  --part response \
  --out /absolute/output/sediment-catalogue.json
```

Saved-object reads use `--params /absolute/input/selection.json`, whose complete JSON is, for example, `{"id":"<actual saved study SHA-256>"}`. The angle-bracket text in this guide is explanatory and must be replaced by the actual original identity; it is not a runnable fixture.

The CLI `read` command accepts GET operations only. A POST preview or comparison is scientifically read-only but still goes through an inspected host-declared input. The operation catalogue records its actual method, effect and supported replay.

### Inspect and execute a complete POST body

A host-declared JSON input file contains the operation, its route parameters if any, and the complete original body:

```json
{
  "operation": "sediment-preview",
  "body": {
    "definition": "<complete scientist-authored definition object>"
  }
}
```

Here `definition` is an object in a real request. Keep it complete; do not pass the illustrative string. Register that file under an input alias using the configuration course, then inspect the actual bytes:

```sh
starforge measurement-workspace-client inspect \
  --config /absolute/private/connections.json \
  --workspace monitoring \
  --input sediment-preview-current \
  --out /absolute/output/preview-input-inspection.json
```

Review the operation, source and complete body, retain the returned SHA-256, and execute under a new retained transport UUID:

```sh
starforge measurement-workspace-client execute \
  --config /absolute/private/connections.json \
  --workspace monitoring \
  --input sediment-preview-current \
  --sha256 <actual-inspected-input-SHA-256> \
  --request-id <original-transport-UUID> \
  --out /absolute/output/preview-receipt.json
```

A changed input is a newly inspected operation. The transport UUID and native scientific request ID serve different purposes. Keep both when the scientific body contains `request_id` or `operation_id`.

Configuration, scientific inputs and token values remain private. Merchant callers choose declared workspace/input aliases and the exact current instance; they cannot substitute a filesystem path or destination URL. The command line and Merchant call the same scientific owner.

## 3. Original response versus an actual HTML, CSV or ZIP file

The native service returns some files directly and others inside a JSON envelope. Downloading the raw response always preserves that first response exactly. It does not automatically turn a JSON envelope into a ZIP.

Use `artifact-info` followed by `artifact-download` when you need the actual native file:

```sh
starforge measurement-workspace-client artifact-info \
  --config /absolute/private/connections.json \
  --workspace monitoring \
  --request-id <original-successful-request-UUID> \
  --out /absolute/output/artifact-info.json

starforge measurement-workspace-client artifact-download \
  --config /absolute/private/connections.json \
  --workspace monitoring \
  --request-id <same-original-successful-request-UUID> \
  --out /absolute/output/complete-native-result.zip
```

Select the actual extension from artifact information. The helper resolves the operation from its retained original input and requires a complete successful response whose bytes match the saved result. It unwraps only declared native file envelopes. Original ZIP length and SHA-256 are checked against the exact decoded bytes; text envelopes preserve the original text and check supplied byte/hash fields. Direct HTML, CSV and JSON stay byte-for-byte original HTTP bodies.

Wrapped products include flow study/load bundles, collection and source-handback bundles, daily-flow comparison HTML/CSV/ZIP, and flow-load comparison HTML/CSV/ZIP. The original raw JSON remains separately available for every envelope. Scientific JSON documents are not rewritten into a new report or archive.

The complete JSON-envelope limit is 512 MiB; this is an admission limit, not an exercised performance claim. Larger native files use the existing complete transfer course. No truncated artifact is published. Output files are create-only; an exact replay can reuse the same complete bytes, while different bytes require a new output path.

Merchant uses `merchant_measurement_artifact_info` and `merchant_measurement_artifact_read` with the configured workspace, current instance and original request UUID. Read all pages until the retained file is complete, then use the existing release operation for its retained reader. A descriptor or first page does not deliver the whole file.

## 4. Observation editions: author explicit relationships

### Capture the actual source population

Use `observation-catalogue`, then `observation-inspect` with:

```text
{
  scope: {
    source_ids: [actual original source SHA-256 identities],
    filters: {explicit selected filters}
  },
  expected_revision: optional current workspace revision
}
```

The native scope permits 1–256 distinct original sources. Filters are `stationId`, `parameter`, `characteristic`, `fraction`, `unit`, `censor`, `method`, `organization`, `activityId`, `from` and `to`. Date filters use the original YYYY-MM-DD calendar. Read the returned full records, all source occurrences, current review/eligibility context, `workspace_revision` and `source_binding`.

A source record can have several original occurrences. Membership alone does not establish that two observations are duplicates, replicates or chemically equivalent.

### Preview the chosen edition

`observation-preview` takes:

```text
{
  scope,
  title,
  reviewer,
  purpose,
  expected_revision,
  source_binding,
  groups: [],
  exclusions: [],
  parent_id: null,
  parent_digest: null
}
```

Each group names 2–64 distinct original `member_ids`, a `relationship`, `rationale`, `evidence_reference`, `acknowledged_differences` and, where required, `representative_id`. The allowed relationships are:

| Relationship | Native interpretation |
| --- | --- |
| `same_observation` | Explicitly choose one member as representative and acknowledge each actual native concern/difference. |
| `independent_replicates` | Retain separate observations; do not average them. |
| `related_context` | Retain the stated relationship without inventing equivalence. |
| `distinct_observations` | Retain distinct observations. |
| `unresolved` | Retain the unresolved decision in the edition and its eligibility outcome. |

One original record cannot belong to multiple groups. A representative is required only for `same_observation` and must belong to that group. Explicit exclusions use `{record_id,reason}`; an excluded record cannot be the chosen representative. Inspect missing-field/difference concerns and native eligibility rather than inferring admission from a relationship label. Unassessed records remain in the edition; unresolved/unknown decisions remain excluded where the native rule requires.

### Save, reopen and continue

`observation-save` receives the exact reviewed preview body plus a retained nonempty `operation_id`. The native saved ID is `observation-edition-` followed by a hash; preserve the complete returned ID, including its prefix. It is not a bare 64-character source SHA.

Replaying the same operation ID and exact choices retrieves the original accepted edition before evaluating later workspace changes. A following edition names its actual `parent_id` and exact `parent_digest`. Retrieve it through `observation-edition` with `params.id`. Use `observation-editions` for saved history.

Download `observation-report.html`, `observation-observations.csv`, `observation-report.csv` and `observation-calibration.json` for the saved edition. CSV rows retain source occurrences, so their count need not equal the number of canonical records. Calibration JSON retains accepted and excluded records, original references and the edition/source binding.

This operation does not substitute nondetects, average replicates, infer sampling-time matches, convert BOD5 to ultimate BOD, or turn annual loads into concentration aliases. Fractions and methods stay explicit. Annual `PO4_KG`, `NH4_KG` and `NO3_KG` parameters require an explicit downstream derivation; native downstream admission remains responsible for scientific compatibility.

## 5. Sediment studies: original observations through saved predictions

### Choose complete sources and a named study

Read `sediment-catalogue` and the original source records. The complete definition has exactly these fields:

```text
{
  study_id: original named-study UUID,
  parent_id: null or original saved-study SHA-256,
  title,
  actor,
  at,
  note,
  selection: complete source/pairing selection,
  model: complete model/cohort selection,
  deployment: null or complete prediction selection,
  source_basis: null or {kind: "study" | "draft", id: original identity}
}
```

The named `study_id` is a UUID. A saved immutable edition's `id` and returned saved-study identity are SHA-256 values. Retain both. A following edition keeps the named study UUID, names its actual parent, and cannot predate it.

With `source_basis:null`, the native capture uses current original sources and reviews. A historical `source_basis` selects a saved study SHA or saved draft UUID and its full captured source/review/revision context. It cannot silently add a source absent from that historical basis. To broaden the source population, explicitly select current original sources and preview that new scientific decision.

### Bind channels from source fields

The pairing selection schema is `upstate.sediment-selection/v1`. Its fields are `schema,source_ids,siteId,sensor,target,from,to,channels,pairing,choices,rationale`.

The sensor has explicit `id,unit,method`; its unit is FNU or NTU. The target is explicitly SSC or TSS. Date bounds are source calendar dates or null. Each sediment/turbidity/discharge channel has `sourceIds,recordIds,filters,fields,rationale`. A null discharge channel is allowed. Source IDs must belong to the complete selected source population.

Field bindings are either an RFC6901 `{path}` into the original record or `{constant,reason}` with an attributed textual constant. Required channel fields are value, unit, siteId, method and sampledDate. Sediment also explicitly binds analyte; turbidity binds original sensorId. Other bindings include sampledAt, timeZone, eventId, censor, qualifier and detection. Channel filters compare an exact scalar at a specified original pointer. Use original field evidence for constants.

`sediment-observations` accepts `{definition,interpret:true}` to inspect the full interpreted population while authoring. Read its original source identities, values, units, qualifiers, sampling support and issues. A date without a resolved offset does not become an invented instant; an event label alone does not establish an independent hydrologic event. FNU and NTU are not silently exchanged, and SSC remains separate from TSS.

### Select actual pairs and cohorts

The pairing rule chooses `same-event`, `time-window` or `explicit`, with `maxDeltaSeconds`, `allowDateOnlySameEvent` and an explicit `eventMeaning` where supplied (`sample`, `hydrologic-event` or `unknown`). A time window requires an actual tolerance. Native tolerance is at most 31 days; this maximum is not a recommendation.

Each pairing choice names one original `sampleId`, `action` of select/exclude, chosen `turbidityId`, optional `dischargeId`, and a reason. A selected sample needs an actual turbidity observation. An excluded sample carries no selected predictors. Use `sediment-pairs-preview` with the whole definition and retain the resulting actual pair IDs.

The model explicitly selects:

- `form`: linear, log-linear or log-log;
- `includeDischarge`: true or false;
- `validationMode`: temporal or held-out;
- `confidence`: the scientist-selected interval coverage within the native 0.5–0.999 range;
- `rationale`;
- `cohorts`: exactly one train/validate/exclude choice for every original pair, with its `pairId,role,reason`.

The original model rejects training/validation reuse of a source observation or declared sampling event. Temporal validation requires a compatible source time axis and the complete validation support strictly later than all training support. Held-out means explicit source separation; it does not certify statistical independence. Review the retained event/grouping findings.

For prediction, author the original deployment definition using the native sediment controls/source contract and call `sediment-deployment-preview`. Preserve its explicit source selection and candidate choices. The fitting and deployment source union stays in the complete saved study. Inspect prediction-range flags and missing/invalid predictors; never replace them by an assumed fit.

### Preview and save the entire scientific edition

Call `sediment-preview` with `{definition}`. The result carries the full definition, original sources, captured review contexts, workspace revision, pairing, fit and predictions. Read the HTML/table-oriented result content before saving. Save the exact reviewed definition using:

```text
{
  request_id: new retained native UUID,
  expected_revision: preview.input.workspace_revision,
  expected_preview_id: preview.id,
  definition: exact reviewed definition
}
```

A stale revision or mismatched preview requires a fresh scientific preview and decision, with a new native request UUID. Do not edit an earlier request into a new decision. An exact repeated accepted request retrieves the original result.

Read `sediment-study` with its actual saved immutable SHA. Download `sediment-report.html`, `sediment-pairs.csv`, `sediment-residuals.csv`, `sediment-predictions.csv` and `sediment-coefficients.csv`. All are derived from the selected full saved study. The native study limit is 64 MiB; full project and draft limits are separate. A refusal at capacity does not permit row truncation.

### Save unfinished work and resolve an uncertain save

`sediment-drafts` receives `{request_id,draft}`. The authored draft contains exactly `id,title,actor,at,base_study_id,raw_definition,structured_definition,pending_request`. Keep unfinished raw text even when it is invalid JSON. Use null for absent base/structured/pending values. A pending request is the exact original scientific save body.

The native workspace captures `source_snapshot` and any `source_snapshot_error`; callers do not supply or replace those fields. A pending save must retain valid source identity. Draft IDs are immutable UUIDs: a following draft has a new ID. Read it with `sediment-draft`.

Read `sediment-request` using the original native request UUID. The result states whether it committed and retains the original body/outcome. If deliberately abandoning a still-uncommitted save, `sediment-abandon` takes `{request:originalSaveBody,actor,at,reason}`. If that save already committed, the native operation returns its accepted result; abandonment does not undo it.

### Receive a full sediment project

`sediment-project` returns `upstate.sediment-surrogate-project/v1` with complete studies, drafts and requests. Receive it with `sediment-receive` and:

```text
{request_id, actor, at, note, project: complete original project}
```

The original receiver preserves immutable editions, ancestry, captured originals and request history, and rejects conflicting identities. It does not replace the entire Measurements workspace or import those historical captures into the current source tables. A recipient can continue an original historical source basis; use a full workspace/source delivery when current imported sources and wider reviews must also be present.

## 6. Compare sediment models on a common original population

Read `sediment-comparison-catalogue`. Select at least two complete saved studies and call `sediment-comparison-candidates` with `{study_ids:[actualSavedSHAs]}`. Read the entire candidate/target catalogue before selecting a population.

The selection schema is `upstate.sediment-model-comparison-selection/v1` as declared by the selected native module. Preserve that module's literal schema when authoring. The exact fields are `schema,id,title,actor,at,note,models,observations,rangePolicy,rationale`. The comparison `id` is a UUID. Each model names `studyId,label,reason`. Each observation in the complete union of held-out targets receives `targetId,action,reason`, with action include/exclude.

All models must retain the same target, site, sensor identity, turbidity unit/method and response mg/L unit. Candidate observations must have original target identity and compatible support. A target used to train any candidate cannot be treated as common held-out evidence. Missing, ambiguous or excluded target support remains visible.

Choose `rangePolicy:"include-flagged"` to retain common observations with their range flags, or `"in-range-only"` for the one common in-range population. Read common target IDs and counts before comparing RMSE, MAE, bias, R-squared or interval coverage. Native empty-support metrics remain unavailable. No automatic model winner is chosen.

`sediment-comparison-preview` takes `{selection,parent_id}`. Save its exact reviewed result through `sediment-comparison-save`:

```text
{
  request_id: new original native UUID,
  expected_preview_id: preview.id,
  selection: exact reviewed selection,
  parent_id: original parent SHA or null
}
```

This save has no `expected_revision` field; its original full saved-study dependencies and preview bind the result. Following editions preserve the comparison UUID and actual parent. Read `sediment-comparison-edition` by returned edition SHA; download report.html, metrics.csv, observations.csv and coefficients.csv through their named operations.

Comparison drafts differ from sediment drafts: `sediment-comparison-drafts` takes `{request_id,draft:{id,title,actor,at,note,parent_id,study_ids,selection}}`. It preserves the complete unfinished selection. Read the original native request through `sediment-comparison-request`. Abandon uses `{request_id,original:originalSaveBody,actor,at,reason}`, with matching original request ID; do not substitute the sediment abandonment shape.

`sediment-comparison-project` contains the complete nested sediment project, saved comparisons, drafts and requests. Receive it through `sediment-comparison-receive` with `{request_id,actor,at,note,project}`. The original receiver rebuilds comparisons from the full candidate studies and preserves the combined local/incoming history. A metrics table alone cannot replace that project.

## 7. Chiques: receive the original source collection

Use `chiques-catalogue` and `chiques-collection` with the original collection ID. The specialist adapter reconstructs preparation from its retained original text files and XLSX attachments, checks every declared member and complete marker, and reports imported source references where present.

`chiques-preview` accepts either the actual original `{sourcePacket,attachments}` or `{preparation:completePriorPreparation}`. Keep the original source packet identity and complete attachments. Preview does not import a source.

After reviewing the original preparation and collection ID, `chiques-receive` takes:

```text
{preparation: complete reviewed preparation, expectedId: actual collection SHA-256}
```

The original collection receiver admits those actual source occurrences. Parsing/receiving does not approve calibration eligibility, convert nutrient basis, or supply an annual-load derivation. Use the retained Chiques field mappings and original application course to review the imported population. Reuse the existing collection publisher and full native bundle for turnover.

## 8. Compare saved intake mappings without changing source history

Read `intake-comparison-history` with `params.id` selecting the original preparation. Preserve its full project and `historySha`. Call `intake-compare` with that same route ID and:

```text
{
  expectedHistorySha: exact history SHA,
  beforeRevision: earlier selected saved revision,
  afterRevision: later selected saved revision
}
```

The revisions are distinct positive integers from that source's saved history. Both retain the same original file SHA and kind. The current original normalizer compares the complete original row occurrences and their accepted, rejected, unavailable or absent outcomes and field changes. This operation cannot align unrelated revised files merely by row number.

Keep the complete comparison JSON, including its retained preparation project. To independently reopen it, `intake-comparison-reopen` takes that full comparison document directly as its body, without a new `report` wrapper. The native module checks document/history identity and recomputes from the original project under the selected normalizer. Reopen writes and imports nothing. A parsed accepted row still requires the original review, mapping and eligibility work before downstream use.

## 9. Complete flow and concentration/discharge comparisons

### Daily-flow studies

Select actual saved immutable IDs from `flow-catalogue`. Existing `flow-compare` returns the comparison; `flow-comparison-report`, `flow-comparison-csv` and `flow-comparison-bundle` return the original file envelopes.

All take `{before_id,after_id,expected_comparison_id?}`. Use actual original study SHAs. Keep the returned comparison identity and supply it when intentionally binding later downloads to that exact result. Original complete parents and sources remain selected.

The bundle includes report, comparison JSON/CSV, selection, manifest and both complete scientific products. Extract the entire archive and keep relative siblings together so report links work. Different date windows are permitted; own-window volume totals from non-overlapping periods are not an observed change over equal support.

### Concentration/discharge load results

Select saved result identities from `load-catalogue`, then use:

- `flow-load-comparison`;
- `flow-load-comparison-report`;
- `flow-load-comparison-csv`;
- `flow-load-comparison-bundle`.

Their exact body is also `{before_id,after_id,expected_comparison_id?}`, selecting two distinct original saved load-result SHAs. The original reader reopens both full results and parent studies. Inspect changes in scientific contract, original source/support, series, daily calculations, periods and sample context. A point difference requires compatible quantities and equal quantified support; different assumptions, missing support and censoring bounds remain visible.

Use artifact download to obtain the actual ZIP. It retains before/after flow-loads.json, flow-study.json, contracts, original reports and every native CSV, plus load-comparison.json, load-comparison.csv, load-comparison-selection.json, report.html, README and manifest. Open the real reports and original documents.

The complete source includes the native `source_tools/flow_load_comparisons.mjs` rebuilding command recorded in that bundle's README. Installed equivalents preserve the original arguments: `starforge measurement-workspace-flow-product`, `starforge measurement-workspace-flow-comparison-product` and `starforge measurement-workspace-load-comparison-product`. Select the full source directory and exact parent files; write to a new output directory. The original Measurements receiver can receive each flow-study.json and preview/save the unchanged load contract. To reopen the existing stored result identities and full surrounding workspace, use the original full portable workspace. Do not invent a new comparison-receive route.

## 10. Select original sources for a saved result's handback

`export-source-selection` takes the saved export ID in `params.id`. Its selected native implementation understands historical version-1 `calibration` and `paired-loads` results.

For calibration, the retained accepted/excluded records carry historical original source references. For older paired-load results, immutable chemistry/flow record IDs remain in the result but their source associations are resolved from the current retained workspace. Read the output's notes, missing associations, original/current revision, result digest and `sourceSelectionComplete`. Do not claim a historical source choice where the original result did not save it.

This is source selection for the existing Source Returns owner. It creates no handback, performs no new scientific calculation and does not claim support for arbitrary observation, sediment or flow export formats. Preserve unsupported original JSON intact and use that family's actual complete project/bundle. When source selection is complete, pass the actual selected originals to the maintained handback preview/publish/receive course.

## 11. Recover the original operation and preserve later work

| Observed state | Continue the same original work |
| --- | --- |
| Successful complete transport | Download the retained response/artifact. Do not submit a new scientific write merely to retrieve it. |
| Completed HTTP error | Read the full original error and correct its actual cause. Preserve that first result. A newly authored transport request is distinct from retrying an unknown dispatch. |
| Unknown outcome after dispatch | Use `status`, complete retained input/attempt files and the original native request lookup where present. Use `--retry true` only for the catalogue's supported read/exact replay and unchanged original body. |
| Accepted sediment/comparison save | Native original request lookup/replay returns the accepted edition even if later scientific state advanced. |
| Stale scientific preview | Reopen current source/definition, inspect the changes, create a fresh preview and native request identity for the new decision. |
| Process identity changed | Review/start/reconfigure through the existing managed Applications owner. Do not aim an uncertain request at an arbitrary replacement process. Historical custody remains readable under its original receipt. |
| Whole-project receive changed native UUID | Retain accepted receive, follow the original Stop/Review/Start and same-directory transfer-rebind course where applicable. Preserve exact archive/action identity. |
| Capacity refusal | Keep complete inputs; select an explicit scientifically justified smaller cohort or the appropriate complete transfer/project format. Never truncate hidden rows. |

A transport receipt, a scientific request receipt, an immutable result and a full receiving project are separate retained objects. Keep their identities linked. Source snapshots in studies preserve the historical calculation; receiving them does not silently replace current source reviews. A later returned review is compared with the exact sent and current author state through the original returned-review mechanism.

## 12. Finish the actual operating and receiving course

For the selected real task, retain the complete original source, scientific definition, saved immutable result, raw transport input/response, actual downloadable products, and appropriate full project/bundle. Give the recipient the selected complete source version and its original operating instructions.

On a separate intended receiving workspace, open or receive that exact format using its native receiver, inspect its original sources/choices, make an attributed useful edit and export a complete successor. Reopen the successor while preserving the incoming original and later local history.

The producing engineer must operate and LOOK at the exact outgoing UI and every final attachment under the full standing rule in OPERATOR.md/RECEIVING.md: actual populated/empty/error and relevant narrow states, reports, CSV/JSON content, extracted archive members and editable working project. Repair observed defects in the original product. Source review and controlled function exercises do not establish native/browser or customer acceptance.

### Maintained source references

The configured routes are in [operations.mjs](operations.mjs); exact request custody is in [client.mjs](client.mjs); native file materialization is in [scientific-files.mjs](scientific-files.mjs); CLI commands are in [client-cli.mjs](client-cli.mjs). The complete selected native/browser/source-tool closure and immutable identities are in [original-source.json](original-source.json).

Original scientific contracts live under `opportunities/upstate_forever_2026/measurement_workspace/engine/`: observation_editions.mjs; sediment_workspace.mjs, sediment_pairs.mjs and sediment_surrogate.mjs; sediment_comparison_workspace.mjs and sediment_comparison.mjs; chiques_nutrient_workspace.mjs and collections.mjs; intake.mjs and intake_comparison.mjs; flow_comparison.mjs, flow_bundles.mjs and flow_load_comparison.mjs; result_handback.mjs. The installed complete source also retains the corresponding original browser controls, examples, reference sources and source_tools. Read the selected native contract when authoring its exact definition; retain its identity with the result.

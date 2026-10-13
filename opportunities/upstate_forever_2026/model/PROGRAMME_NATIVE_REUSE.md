# Programme native reuse

A source-update successor can select completed original runs as candidates for the existing native input matcher. This closes the gap between preparing a new source edition and executing its saved Programme: preparation no longer loses the original candidates that can supply unchanged native stages.

## Operator workflow

Open the existing Programme, choose **Update sources**, select its saved refresh plan and preview the successor. Expand **Source, dependency and native reuse details** for a case. The preview lists exact completed candidate IDs and the selected model stages they can supply. An original with no completed overlapping stage is shown separately with its reason for exclusion.

Create the reviewed successor, then continue it with the existing Programme execution controls. The native input matcher compares the original and successor inputs for each selected model. The original stage cache verifies copied native files. Matching stages retain their original source-run provenance; changed stages execute through the maintained native runner. The Programme's existing progress, report and comparison views show the resulting completion and stage history.

Candidate availability is checked again during creation. If an original gains its first completed overlapping stage or the source mappings change after preview, review the updated selection before creating the successor.

## Scientific scope

The optional `reuse_source_run_ids` field selects possible donors. It does not assert that a stage is equivalent. Actual admission is performed by the existing `NativeInputMatcher` and native stage cache, using the selected model, runtime, native argument flags, categorical and continuous inputs, scenario raster and relevant coefficient values. Existing exact content-signature cache recovery remains available with or without explicit candidates.

The helper requires a retained run whose immutable input-selection digest matches its ID and which contains at least one completed selected native stage. A completed NDR stage remains eligible while an unrelated SDR stage is unfinished. Each candidate binding records its original native selection and overlapping selected model scope. The scope stays stable if another stage completes later. It does not prepare, execute or complete a donor. Native file verification stays at the actual cache transfer or completed-run path.

Source successors collect the prior original run, its completed source-stage assembly donors, and any previously selected candidates. They preserve order, remove duplicates, exclude the target itself and omit originals with no completed overlapping stage. A changed successor selection rebuilds this list after the maintained Programme preview has determined the actual target run ID. A second preview binds the chosen candidates and confirms that adding them did not change that native identity.

Unchanged completed-stage assemblies retain their original `source_runs` mapping. A row cannot combine explicit reuse candidates with that assembly selector, because they represent different preparation paths.

## Programme API

A run selection may include:

```json
{
  "key": "restoration",
  "title": "Restoration under the new source edition",
  "profile_id": "<retained profile ID>",
  "scenario_id": "<retained scenario ID>",
  "models": ["ndr", "sdr"],
  "reuse_source_run_ids": ["<original completed native run ID>"]
}
```

Use the maintained `ComputeProgrammes.preview`, `create` and `execute` methods. The optional candidates are retained in the Programme selection; their original input selections are retained in the saved bindings. At execution the same IDs are passed to `Workspace.run(..., reuse_source_run_ids=...)`. The attempt record also retains the explicit requested candidates.

Existing Programme rows that omit the optional field keep their previous binding structure and identity. The helper coordinates candidate admission and is retained in the complete application source inventory. It does not replace a scientific engine module or add a new unconditional engine dependency that would invalidate older Programme identities. The actual native matcher, stage cache and scientific execution source remain governed by the existing Programme engine checks.

Source-update links retain the chosen candidate list and verify it against the successor Programme and the original candidate selections when reopened or restored. Older links with no candidate field keep their original preview identity and remain readable.

## Installation

The cumulative scientific desk installer runs the maintained source-successor installer first, followed by this component. To compose the same component into an already received application:

```bash
python -B operator/install_programme_reuse.py --application /absolute/application --source-root /absolute/source
```

The independent installer copies the complete helper, method, guarded patch, installer and component fragment. It applies exact, repeatable shared-source edits to the current Programme, source-successor and preview modules. It preserves each changed original, records an installation intent before replacement, retains file modes and rejects independently changed component files. No native model dispatch occurs during installation.

The `programme-native-reuse` component requires `programme-source-updates` and `programme-activity`. Its manifest includes every newly added runtime dependency. Full shared-file postimages are supplied for source publication; receiving composition uses the guarded edits.

## Source edition and receiving

The shared-source base was read at commit `ab5968499e25d74b8953f39478c03d3cddeb8721`: ComputeProgramme Git blob `188ef3177830bd71a4ca061f36f2dba34cc4b0c9`, successor Git blob `f1855e817559786be3d4bcc0f47fde04b9f23114`, and current successor browser Git blob `dd0f3ca689642137fe6980d17c4835e595da64ed`. The source-refresh facade and native comparison writers retain their existing ownership and implementation.

Receiving should open an existing saved Programme and its source-update preview, inspect candidate identities, save a successor, continue its original selected stages and reopen its report. A useful case changes a source container or an unused table field while retaining a model's actual inputs, alongside a real model-input change. The first may reuse its matching stage; the second follows the native matcher decision. Rendered operator readiness is established by exercising the exact installed application, including a narrow viewport and restored project.

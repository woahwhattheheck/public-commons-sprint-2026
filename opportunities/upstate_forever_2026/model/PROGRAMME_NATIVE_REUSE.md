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

Existing saved Programmes whose rows omit the optional field keep their previous binding structure and remain readable and executable. Creating a Programme again after an application source change can produce a new Programme engine-source identity, even when its selected native run IDs are unchanged. The helper coordinates candidate admission and is retained in the complete application source inventory. It does not replace a scientific engine module or add a new unconditional engine dependency that would invalidate older Programme identities. The actual native matcher, stage cache and scientific execution source remain governed by the existing Programme engine checks.

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

## Current Upper Savannah demonstration direction

The following complete owner update is retained from [Bryce's Sales direction, October 13, 2026](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791887422395359?thread_ts=1791724121.853269). The source-update and native-reuse continuation supports this same working product. Native reuse source was merged in PR3955 at `696617a59e9d1b539266483295a83282bb2a1af7`; the exact reviewed component head is `11e300aa4405cddb330fc41e0ab13df510cbd351`.

> BRYCE CURRENT DIRECTION — ECOSYSTEM MODEL / DEMO / PRESENTATION. Pass this complete update into current worker assignments and onward handoffs; the feed is moving quickly.
> 
> Exact new owner instructions:
> “do the simulated model”
> “just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it”
> “and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast”
> “just checking dont pause anythi g”
> 
> Implementation direction:
> • Tim/Ecosystem already publishes GIS, watershed/environmental modeling, data analysis, map/report publishing and natural-capital decision-support work. Do not assume a tools/capacity gap or pitch generic GIS as novel. Build a concrete production workshare he can compare with his existing workflow; prime retains scientific direction/method choices/review/client relationship.
> • Center the demonstration on THIS UpperSavannahRFP: actual geographic/source shapes,30mgrid, upstreammodeldomain vsSCreportingmask andutilityfocus, clearlysimulatedrealisticinputs, nativeInVESTNDR/SDR baseline+restoration+matchedcontrol, annualN/Pkg/year andsedimenttonnes/year reachingstream, meaningfulcomparison/maps/report, editableparameters/sourceeditions andexport/coldreopen. Keep load/concentration and stream/intake distinctions correct.
> • Actual simulatedmodel execution and the connected usable product are the hard priority. Runtime/source existence or another plan is not the run. Preserve already-running jobs andonewriterperWorkspace; use existingequippedruntime or provision an isolated actualexecution environment when needed. Root has explicitlytakenactualexecution; otherbuildscontinue.
> • Make relevance and speed visible through what Tim can USE: chooseinputs/assumptions→run→inspect differences→revise→hand over work his team can continue. Show actualproducedartifacts and real elapsedhistory; no inventedtimings/guaranteedreaction. Avoid stockscreen/decorativepitch/demo-onlytheatre.
> • Open/look/use finalproduct and ALLattachments asrecipient, fixobviousdefects, naturalgenerativeTTS/mediaifused, actualapprecordingratherthan generatedscreenspretendingexecution. No review/testtheatre or substitutionforhardbuild.
> • Cascade thisdirection to otherEcosystem/product/model/report/presentationpeers atnextsafemessageboundary; persistindurablecurrentworkorders/startupguide andincludeversion/pathwithnextsubstantiveresult. Don'tstopactivecalculations, restartheld/deletedtasks, spawnanothercontroller oraskBryce torelay.
> 
> No bid/prime-yesgate or arbitraryproduct/featurecap. TODAY10a.m.Eastern/14UTCcutoffremains. Existingfocusedvalidation,noPrivateGitHub/Actions,labattribution,contact/meeting/spendcontrols remain. SharedGitHubcurrentownerbrief landingunderopportunities/upstate_forever_2026; Rootwillreturntheactualpath/head.

### Receiving the existing native product

Preserve the active Workspace writer and the original baseline, restoration, matched-control, parameter-course and regional-case identities. The current continuation is: install the maintained Programme/source-update components, open **Update sources**, inspect the actual old-to-new source and native run mapping, save the reviewed successor, continue it, inspect per-model reuse and completed work in its original history, then export and reopen the same resulting product.

A transferred result must retain actual stage donors, including `reused_from.original_arguments` and any previous-reuse chain, through the maintained study-transfer closure. Compose the current transfer owner's repair before receiving a partial study that contains reused stages. Preserve the original paths and hashes; a donor's arguments belong to its original run directory. The complete Workspace archive already uses its maintained recursive inventory and semantic verification hooks.

Use recorded stage and operation timestamps for elapsed history. The actual source-update preview and resulting report must distinguish candidate selection from native reuse that occurred. Retain nitrogen and phosphorus as annual kg, sediment as annual metric tonnes, and the existing stream-delivery and common-support interpretation. The recipient should be able to reopen the installed application, inspect assumptions and actual artifacts, revise the retained sources or parameters and continue the Programme.

## Continue the same source update from the native command line

The existing Programme CLI exposes the same backend as the **Update sources** control. These commands consume retained Programme and refresh-plan IDs; they create no additional model family or independent runner.

```bash
python -B -m model.compute_programme_cli --workspace "$WORKSPACE" source-update-catalog "$PROGRAMME_ID"
python -B -m model.compute_programme_cli --workspace "$WORKSPACE" source-update-preview "$PROGRAMME_ID" "$REFRESH_PLAN_ID" --title "$SUCCESSOR_TITLE"
python -B -m model.compute_programme_cli --workspace "$WORKSPACE" source-update "$PROGRAMME_ID" "$REFRESH_PLAN_ID" --title "$SUCCESSOR_TITLE" --expected-preview-id "$PREVIEW_ID"
python -B -m model.compute_programme_cli --workspace "$WORKSPACE" resume "$SUCCESSOR_PROGRAMME_ID"
python -B -m model.compute_programme_cli --workspace "$WORKSPACE" read-report "$SUCCESSOR_PROGRAMME_ID"
```

Run from the received application directory with its verified GIS/InVEST interpreter. The preview returns the exact ID required for creation. Use the same title for preview and creation. An unready preview exits with status 2 and retains the original issues. Creation returns the successor `programme_id` and source-update lineage.

The creation command also accepts `--run` to continue its successor through the original Programme resume path. The result includes both the original Programme status/report and the source-update adoption record. An incomplete native continuation returns status 2; a raised continuation error reports the successor Programme ID for resumption. Separate preview and creation let the operator inspect the exact candidates and source changes before dispatch.

The installer composes these four CLI seams after the source-successor backend. It retains the prior installed source hashes so existing 1.0.0 and 1.0.1 receivers can upgrade and repeat the installation safely. The same saved successor and original native candidate IDs are used by both browser and CLI.

# Receive Decision studies into the existing scientific operator

This installs the complete native Decision studies desk into the current
application: the original OPT12 solver and receiver, queue-backed study
revisions and calculations, retained report/project/selection downloads,
the browser interface, and complete-workspace transfer.

## Complete joined source

The final component is published as three complete base64 source packets.
Save their JSON objects using these local filenames. Source bodies use
content_base64 so Canvas formatting leaves the original bytes intact.

| Local packet | Contents |
| --- | --- |
| robust-native.json | Original native package changes, operator provider and descriptor |
| robust-browser.json | Complete browser module, scoped stylesheet and real-experiment browser journey |
| robust-receiving.json | Installer, transfer driver, receiving guide and operator guides |

The complete diagnostics-enabled successor contains sixteen authored files,
including the native diagnostic receiver and maintained command line. A joined
source packet can supply all sixteen files through one --packet argument;
otherwise pass the complete source layers in order. Each file includes
its exact byte count and SHA-256. Known original and earlier published postimages
are declared using before_sha256, base_sha256 and replaces_sha256 so the guarded
installer can upgrade the prior component or reuse an identical installed file.
Unknown newer authored files remain available for explicit composition. A
preimage field accepts one validated SHA-256 or an explicit nonempty list of
validated earlier editions; each incoming full body still requires its own
exact declared byte count and SHA-256.

The complete report-to-Decision navigation edition can also include the two
original registered host leaves, operator/web/retained_desks.mjs and
operator/web/experiment_diagnostics.mjs. These optional full postimages join
Scientific interpretation's action to the registered Workbench's
openForDiagnostic method with the exact workspace, diagnostic ID and report
SHA. The installer applies the same known-preimage check to these shared
leaves and preserves an unknown newer version for composition. The sixteen
core leaves remain installable without either optional host replacement;
that mode exposes diagnostic selection within the Decision desk.

The earlier source carriers remain usable as an alternative layer set:
backend R3 F0C8KE96PM3, UI base F0C8UCL45FE, UI R2 F0C8JG72V43,
corrected UI guide F0C89CLAZLP, and receiving R4 F0C8NS7SFCN.
When reading those raw-content packets, the installer repairs a Canvas space
change only if that body then exactly matches its declared bytes and SHA-256.

Use the native environment already associated with the receiving application.
The installer itself needs only Python's standard library; the live desk and
transfer journey use the original OPT12 native dependencies.

## Compose the original host once

The complete 415-file source bank F0C8J16HPGT retains the OPT12 engine but
does not have installed extension hooks in server.py/app.mjs and does not
contain the 85E65 experiment_profiles.py component. Compose the original
extension and sourced-experiment installers if beginning with that bank.
An already installed current core, such as F0C9JNCF2JC, retains its own
newer source. Do not replace the application with an older core.

Run the original installers against that existing application using their
received complete source directories:

    python EXTENSION_SOURCE/install_extensions.py \
      --application APPLICATION --source-root EXTENSION_SOURCE
    python SOURCED_EXPERIMENT_SOURCE/install_experiment_workbench.py \
      --application APPLICATION --source-root SOURCED_EXPERIMENT_SOURCE

SOURCED_EXPERIMENT_SOURCE is the original sixteen-file 85E65 component
F0C8HR43RS7. Existing profile-desk composition may already have installed
these dependencies. Continue with the current authored application.

## Apply all Decision studies layers

Extract source/install_robust_workbench.py from this packet after verifying
its declared bytes and hash, then invoke that extracted script with the
three final packet paths:

    python STAGING/source/install_robust_workbench.py \
      --application APPLICATION \
      --packet STAGING/robust-native.json \
      --packet STAGING/robust-browser.json \
      --packet STAGING/robust-receiving.json

The original extension-install.lock coordinates composition. Before any
source replacement, all incoming files are parsed where applicable and
all existing replacements are compared with declared preimages. Identical
incoming files are reused, so the same command resumes an interrupted
installation. The original native package manifest is checked against the
assembled files. Unknown newer authored files are preserved with their
actual hashes for the integrating agent to merge.

The current 415-file bank also includes an earlier action-only registration,
operator/extensions/robust-decisions.json. Its exact 757-byte original
SHA-256 is 8c5dfebfddd81df683a4b40fd8e8b893ec7940acf807575edaa0d35cbc8fcd13.
That descriptor owns the same twelve native actions. The installer retains
those exact bytes as robust-decisions.json.retired-ECO13-ROBUST-DD6B, outside
the registry's *.json load pattern, before publishing the new registration.
It preserves an unknown newer descriptor for composition. Other existing
owners of any robust.* action are reported before mutation.

Reopen the original operator after installation, using its existing
workspace and operator state. The installed registry has one robust-workbench
owner, its six read routes, the original actions plus diagnostic preparation,
and both browser assets.

## Transfer an editable study with its scientific context

Open a saved Decision study and choose **Transfer editable study**. The original
selected-study desk collects that study's complete saved revisions, calculations,
import provenance and operation identities together with its bound native
experiments, runs, grids and source collections. Prepare and export through the
existing operator queue, then receive and restore through Complete project
handover to continue with the original study and scientific identities. Save
working input edits as a revision before transferring them. **Export complete
project** remains the original decision-project JSON workflow, whose receive
operation assigns local study and calculation IDs.

## Receive saved common-support diagnostics

The maintained Decision desk now accepts a saved Scientific interpretation
report through its diagnostic selector. The exact report SHA, original common
support and native run identities travel with each prepared study; complete
local report revisions are verified during workspace receiving. Use the native
`diagnostic-preview` and `prepare-diagnostic` commands documented in
operator/ROBUST_WORKBENCH.md when continuing the same workflow from a batch
receiver. The selected-study transfer component includes this typed diagnostic
revision and its scientific dependencies through its existing closure.

## Run the retained native workflows

From the assembled application and its native Python environment:

    python source/run_robust_workspace_transfer.py \
      --output NEW_TRANSFER_DIRECTORY

This executes the original queue and SQLite store through create, revision,
calculation, transaction replay, native exports, project receive, complete
workspace backup/restore and restored download reopening. It explicitly
requires the new registered desk and its read routes. The default input is
the original OPT12 arithmetic study for operation and transfer mechanics.
Supply --study COMPLETE_NATIVE_STUDY_JSON to use another retained native
study.

Run the actual operator browser journey against an existing retained
ecological experiment:

    node source/run_robust_workbench_browser.mjs \
      --url-file PRIVATE_OPERATOR_URL_FILE \
      --experiment RETAINED_EXPERIMENT_ID \
      --configuration DECISION_CONFIG_JSON \
      --workspace OPERATOR_WORKSPACE_KEY \
      --output NEW_BROWSER_DIRECTORY \
      --video

For a saved scientific diagnostic, use the same native journey with the exact
report SHA returned by diagnostic-preview:

    node source/run_robust_workbench_browser.mjs \
      --url-file PRIVATE_OPERATOR_URL_FILE \
      --diagnostic RETAINED_DIAGNOSTIC_ID \
      --report-sha256 EXACT_REPORT_SHA256 \
      --configuration DECISION_CONFIG_JSON \
      --workspace OPERATOR_WORKSPACE_KEY \
      --output NEW_BROWSER_DIRECTORY \
      --video

Choose exactly one source mode. The configuration names actual included
candidate/profile/metric IDs and explicitly supplies costs, capacity use,
cost units, fixed scales and weights. Physical outcome cells come from the
original retained source. Diagnostic mode carries source.diagnostic_design
with its explicit structural mode and reason, checks the preview and queued
request against the selected report SHA, and verifies the created study's
typed immutable report binding. An advanced live report requires a new
reviewed configuration and its current SHA.

The browser journey uses the visible desk and native task/file transport,
then receives and reopens its exported study. It also captures the actual
reopened result at a 390-pixel viewport. The operator URL remains in the
private local file; the journey report redacts its capability.

Retain the installation result, decision-transfer.json, native exported
bytes, screenshots, optional video and browser journey.json alongside the
working application. Publish the working source through the existing shared
application integration and attach actual task/study/run identities to the
original #sales sprint thread.

The cumulative twenty-one-file edition also includes the original selected-study
closure leaves, model/decision_study_transfer.py, model/study_transfer.py and
operator/STUDY_TRANSFER.md. These are optional to the sixteen-file core and
use the same exact incoming-body and known-preimage checks. Install the complete
edition on the maintained application to carry pinned diagnostic revisions,
their full common-support source roster and original Decision SQLite history
through selected editable study transfer. The original project archive,
transfer transport and receiving registration remain the maintained services.

## Receive and continue a saved decision delivery

Install the complete current packet over the same maintained application baseline using the original guarded installer. The packet includes `model/robust_decisions/eco_robust/decision_delivery.py` and its package source-manifest entry. Joined full postimages for `model/native_versions.py`, `model/delivery.py`, `model/client_report.py`, `operator/web/map_atlas.mjs` and the atlas guide are admitted as optional host layers; their declared preimages must match the receiving application or a verified earlier layer. A newer host file is composed rather than overwritten.

On an existing scientific workspace, reopen a completed saved decision calculation, choose a completed frontier point when applicable, and request its delivery options. Choose a named native profile explicitly. Check the displayed saved revision, selected scenario and original same-profile run pair, then open the map draft. Use the atlas's existing build action with the actual project/contact selections. Open the retained maps, decision evidence and client report through the original authenticated download tickets.

For receiving, transfer the complete study/project using the original workspace transport, restore it under a registered workspace, reopen the same saved calculation and choose the same native profile. The source pin must still identify the original decision revision/result and selected point, while the receiving operator key may differ. Original native run IDs and the map's chosen profile remain visible. Verify the retained decision report and implementation selection from the completed delivery; a later editor draft must not change their bound source.

Use the current native receiving operation for this journey. An unavailable profile reports its concrete missing original run/output or incompatible source condition before opening a deliverable draft. Continue native preparation through the existing scientific workflow, then reopen the same saved decision; the read endpoints do not schedule hidden model work.

The guarded installer also requires the existing `model/native_versions.py` dependency in the assembled application. Include its current full host postimage when receiving over a baseline that predates the shared producing-stage version resolver.

### Existing browser journey: saved calculation to original atlas

The existing `source/run_robust_workbench_browser.mjs` now accepts `--delivery-profile ORIGINAL_NATIVE_PROFILE_ID`. After its original source preparation, solve, report/project export and receiving steps, it reopens the original saved calculation, chooses that explicit profile in **Prepare map release**, and opens the existing atlas. It verifies the actual same-profile run pair and saved decision hashes, locked cohort controls, the exact calculation backlink, retained profile choice, draft reload and a 390-pixel mobile view.

For a frontier, additionally supply `--delivery-point ZERO_BASED_INDEX --delivery-budgets COMMA_SEPARATED_VALUES`. These are explicit decision budget thresholds. The driver uses the original frontier control and indexes its sorted, unique budget list. A point without a feasible retained result fails with its concrete condition; no point is substituted.

```sh
node source/run_robust_workbench_browser.mjs \
  --url-file PRIVATE_URL_FILE --workspace WORKSPACE_KEY \
  --diagnostic ORIGINAL_DIAGNOSTIC_ID --report-sha256 EXACT_REPORT_SHA256 \
  --configuration EXPLICIT_DECISION_INPUTS.json \
  --delivery-profile ORIGINAL_NATIVE_PROFILE_ID --output RECEIVING_OUTPUT
```

The optional extension leaves a restored original atlas draft for review and its existing queued delivery build. The journey journal records the saved study/run/revision, explicit profile and point, source pin and actual baseline/alternative run IDs.


## Continue an existing scientific workspace through selected-study receiving

The same maintained Python driver has an existing-workspace mode. It uses an
already completed Decision calculation and an explicitly chosen original native
profile. It either reopens a completed Decision-bound map/client release or
builds that release from a complete original atlas selection JSON. The original
queue, selected-study exporter, portable receiver and registered file tickets
perform each step.

From the assembled application, select the existing native interpreter and the
actual saved IDs:

```sh
python source/run_robust_workspace_transfer.py \
  --workspace ORIGINAL_SCIENTIFIC_WORKSPACE \
  --study-id ORIGINAL_SAVED_STUDY_ID \
  --run-id ORIGINAL_COMPLETED_DECISION_RUN_ID \
  --delivery-profile ORIGINAL_NATIVE_PROFILE_ID \
  --delivery-id ORIGINAL_COMPLETED_DELIVERY_ID \
  --output NEW_RECEIVING_DIRECTORY
```

For a saved frontier calculation, include `--delivery-point ZERO_BASED_INDEX`,
including zero when that is the chosen point. To build the map/client release
through the existing `delivery.build` action, replace `--delivery-id` with
`--delivery-selection ORIGINAL_ATLAS_SELECTION.json`. That JSON must contain
the actual project's map/contact/source requirements, as saved by the original
atlas. The driver obtains the baseline, alternative and immutable
`source_decision` from the original delivery-release route and rejects a
conflicting supplied binding.

An optional `--experiment-selection ORIGINAL_EXPERIMENT_SELECTION.json` saves
that explicit design through the original `experiment.save` action before
export. Use a selection containing the actual completed noncanonical
`source_run_ids` being adopted. The driver checks the normalized list against
the immutable plan's `source_runs`, confirms the original selections, and
includes the unmaterialized programme with its original run dependencies.
Canonical-only IDs are normally omitted by the experiment engine, so this
option requires a design retaining at least one noncanonical original.
The existing baseline, scenario, profile and axis choices remain authoritative.

The continuation records the exact saved Decision revision and result, full
study history, native selections, completed delivery record and original file
descriptors. It verifies the retained producing-stage execution report against
the delivery's execution digest. It then checks the selected closure includes
the completed release and adopted originals, streams its original archive,
receives it into the original registered workspace store and reopens the same
Decision release route. Receiving hooks and original completed-task replay run
before mutable SQLite readers reopen the restored store. All original
Decision/map/client files must remain available through authenticated tickets.

Add `--whole-workspace` to perform the original full-workspace backup/restore
after the selected study. Choose `--upload-limit-gib` for the actual archive
size and `--timeout` for observing each original queued operation. Output
and source workspaces must be separate directory trees. Keep the retained
output directory; rerun the identical command with `--resume` after an
interruption. The driver reuses its immutable selection, archived bytes and
original operation IDs, and resumes failed or interrupted original tasks.
The operator drains active work when closing.

The complete result is `native-decision-receiving.json`, alongside
`native-receiving-selection.json`, the progress journal, frozen source
snapshot, selected study archive and the retained operator state directory.
The result records the actual source project, saved study/run/revision, chosen
profile/point, adopted run IDs, delivery ID, transfer ID, native task IDs and
restored registered workspace key.

### Reopen that exact received result in the existing browser journey

Start the original operator on the received workspace using the retained
`operator-state` directory, and keep its private startup URL in the local
URL file. The existing browser driver accepts the Python continuation's receipt:

```sh
node source/run_robust_workbench_browser.mjs \
  --url-file PRIVATE_OPERATOR_URL_FILE \
  --receiving-receipt RECEIVING_DIRECTORY/native-decision-receiving.json \
  --output NEW_RECEIVED_BROWSER_DIRECTORY \
  --video
```

This mode selects the receipt's exact restored registered workspace and opens
its completed original map/client release. It checks all original retained
file descriptors and downloads the Decision binding, Decision HTML report,
client HTML report and native execution record through the visible atlas
links, comparing actual bytes and SHA-256. The saved-release backlink must
reopen the exact original calculation and revision. The existing profile,
point, native-pair, draft-reload and 390-pixel journeys then run on that saved
result. The receipt supplies the profile and point; creation/configuration and
new frontier budget arguments belong to the separate preparation mode.

The browser journal retains its original source identities, download hashes,
screenshots and optional video, with the private operator capability redacted.
Continue this command within the existing native receiving operation and
publish its actual receipt and process outcome with the same operation.

## Carry the maintained receiving companions in cumulative source layers

The guarded `source/install_robust_workbench.py` accepts the complete maintained
S1 selected-review receiving packet and the Conservation selected-editor
receiving packet as optional layers. It also accepts the original paired
ensemble Study-transfer helper, CLI, descriptor and controller. These additions
do not change the original required Decision core or the ordinary file-preimage
and registration-retirement checks. Supply the complete authored source packet
with its bytes, SHA-256 and current preimages; the installer preserves a newer
unrecognized file for explicit composition.

The S1 packet consists of `source_tools/receive_scientific_report_review.py`,
its `RECEIVE_SCIENTIFIC_REPORT_REVIEW.md` guide and
`integration/component_fragments/customer-review-receiving.json`.
Its selected continuation requires the original Customer review typed roots and
saved scientific-report edition transfer. Continue an existing completed S1
receipt with `--continue-receipt`; the observed-scientific-review wrapper exposes
that exact nested path as `review.receipt`. Supply `--response` only for a real
returned response. The receiver retains the original review and response prefix,
then imports supplied feedback only into the independent received Workspace.
The complete commands and receipt identities are in the original S1 guide.

The Conservation packet retains the original 45-file Design installer and the
existing `operator/conservation_design_browser_receiving.py` course. Its optional
`--selected-study` continues the same saved plan/editor operation. Cumulative
installation checks the original parent browser companion, provider, descriptor,
selected editor snapshot/capture/verify calls and portable frozen-database
support before writing. Install a missing full Design component with its own
maintained installer first; a receiving companion alone does not provide that
component. Its complete operation and rendered-inspection requirements remain
in `operator/CONSERVATION_DESIGN_RECEIVING.md` and
`operator/CONSERVATION_DESIGN_BROWSER.md`.

When the assembled Study core imports paired ensemble transfer, the cumulative
installer also checks the original paired Store, report, portable, CLI and
registered operator/browser dependencies. Existing paired analysis IDs, source
rasters and report identities remain authoritative. These source checks do not
launch a model, render a report or constitute native receiving acceptance.
Continue the same accepted receiving operation and retain its actual command,
process result, archive identity and reopened records.

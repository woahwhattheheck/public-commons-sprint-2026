# Decision studies in the existing scientific operator

Operation: ECO13-ROBUST-DD6B, October 13, 2026.

This component installs the retained OPT12 decision-study engine in the main
Upper Savannah operator. The original ecological experiment, scenario and
parameter profile IDs remain in the decision study. Operators can configure
costs, capacity, metric scales and weights, save immutable revisions, solve a
robust decision, explore budgets, reopen calculation history, export a report
or implementation selection, and transfer the complete study.

## Composition

Use the original OPT12 0.1.0 package carried by Slack F0C8TJK7EBE, already in
the cumulative 252-file bank F0C8JNZTURK. Its 18 inventoried files total
125,996 bytes. The existing main operator with ExtensionRegistry and
extension_host is supplied by current core carrier F0C9JNCF2JC. Preserve
newer source-science and workspace changes while adding this component.

The larger cumulative source bank F0C8J16HPGT has 415 files, but its
server.py/app.mjs are source preimages: merely copying registry modules does
not install the host hooks. When starting from that bank, compose the original
install_extensions.py against the receiving application (its --application
and --source-root arguments identify the destination and exact extension
source). Alternatively start from the already installed current core
F0C9JNCF2JC. The same cumulative bank omits the sourced parameter engine
model/experiment_profiles.py. Compose the retained 85E65 source F0C8HR43RS7
with its original install_experiment_workbench.py before using the profile
edition desk and sourced experiment workflow. Run the native transfer driver
against the resulting installed application; registry files alone are not an
installed operator. Preserve any newer scientific/core postimages when
applying the original installers.

Install the complete postimages in this source packet. Three native modules
have exact before hashes in the packet: store.py, operations.py and
integration.py. Their additive operation_id keyword is optional. Existing
standalone callers retain their current signatures and results. The
native engine.py, native.py, schema.py and reports.py are unchanged.
The new manifest registers robust_workbench.RobustWorkbench and the
original twelve robust.* action names. Install both companion browser
assets from the product-experience source packet before reopening the
operator, because the registry checks each declared asset. Do not
simultaneously register the old manual ACTIONS.update/dispatch snippet:
the extension is the single owner of those twelve actions.

The current cumulative bank also carries operator/extensions/robust-decisions.json,
an earlier action-only owner. Use source/install_robust_workbench.py with the
exact source layers described in source/ROBUST_RECEIVING.md. It retires only
the known 757-byte original descriptor to a retained filename outside *.json,
checks all incoming preimages, and installs the complete new owner. A newer
conflicting descriptor is preserved for composition before any source writes.

No server.py, app.mjs, index.html, workspace.py or portable.py edit is needed
on the retained extension host. model/ and operator/ are already in the
original application transfer inventory. The native SQLite database,
its immutable revisions, the operation bindings and retained export
files live beneath the original scientific workspace and travel in
the existing complete-workspace backup.

## Operator workflow

1. Open **Decision studies** and choose a retained experiment. Its original
   summary supplies the retained physical metrics and units. The original
   paged experiment index supplies every planned scenario and physical-profile
   ID, including unstarted cases, so partial results cannot silently remove
   planned alternatives from the decision configuration.
   The form leaves costs, capacity, normalization scales, weights and cost
   units for explicit operator entry. It does not estimate prices or
   science values. Enter a title and decision settings and prepare the
   study through the original task queue.
2. The existing native receiver accepts only complete requested
   scenario/profile pairs with their original baseline and alternative
   run IDs. It checks gain direction, units and common paired support.
   Every original requested pair remains visible; incompatible or
   incomplete selections fail with the native explanation.
3. Reopen the saved study, adjust the decision settings and save a new
   revision. Saving sends expected_revision. A competing later edit is
   surfaced for refresh, preserving both the original and new history.
4. Select worst-case, minimax-regret or expected-value objective. Expected
   value uses explicitly supplied probabilities. Every calculation sends
   the saved study ID and exact revision. The original engine retains the
   run and result; changing a form never changes an earlier calculation.
5. Explore explicit budget values using the frontier action. A frontier
   reports its native per-budget decisions. To publish one implementation
   selection, save the desired budget in its own revision and solve that
   revision, then export that single decision.
6. Download the original HTML/CSV report, complete project JSON or
   implementation-selection JSON from the completed task. File tickets
   come from the existing authenticated operator transport. Reopening the
   task regenerates tickets after an operator restart.
7. Receive a complete project JSON to create an independent study with
   the full original revision/result provenance. The receiver's original
   behavior gives the received study and runs new native IDs. Original
   source IDs and imported provenance remain in the study. Complete
   scientific-workspace backup additionally retains this desk and all
   other scientific workspace records.

Native package comparisons select one previously modeled scenario package.
The existing separate additive-actions mode requires its explicit additive
basis; whole InVEST scenario outcomes are not summed to manufacture a new
modeled package.

## HTTP and queue contracts

Authenticated GET or POST /api/robust-workbench/catalog returns workspace_key,
native studies, and retained experiments with summary_available. The study
read accepts study_id and optional revision and returns the native
{id,head,revision,sha256,study,runs} document. The run read accepts study_id
and run_id and returns the original run record. Study reads also return retained
operations and _downloads, so prior exports remain visible after full workspace
restore even when the receiving host has a new operator task queue. The experiment read accepts
experiment_id and returns its unaltered summary plus the editable
configuration. The methods read returns the native JSON schema and named
modes/objectives.

All mutations use POST /api/actions with the existing
{workspace,action,payload,operation_id} envelope. Action names and payloads:

| Action | Payload |
| --- | --- |
| robust.study.list | {} |
| robust.study.read | {study_id,revision?} |
| robust.study.create | {study} or {upload_id} |
| robust.study.revise | {study_id,study,expected_revision} |
| robust.experiment.prepare | {experiment_id,configuration} |
| robust.summary.prepare | {summary,configuration} |
| robust.solve | {study_id,revision,objective?,time_limit?,mip_rel_gap?} |
| robust.frontier | {study_id,revision,budgets,objective?,time_limit?} |
| robust.project.export | {study_id} |
| robust.project.receive | {project} or {upload_id} |
| robust.selection.export | {study_id,run_id} |
| robust.report.export | {study_id,run_id,format:"html" or "csv"} |

The current operator has a 4 MiB JSON request limit. For complete large
documents, stream the original file to POST /api/upload with the existing
X-Upload-Filename header. Its returned id is the upload_id above.
summary.prepare additionally accepts summary_upload_id and
configuration_upload_id in place of inline documents;
experiment.prepare accepts configuration_upload_id. Original upload size,
byte identity and SHA checks remain with the maintained operator.

GET /api/state includes persisted task results. Fetch GET /api/task?id=ID
for decorated _downloads. Native action results remain direct:
solve/frontier {run_id,revision,answer}; project export
ecosci.robust-project/1; selection export ecosci.robust-selection/1;
report export {media_type,filename,content}.

## Recovery and transfer

The queue's stable task ID is bound in the original SQLite transaction that
creates a study, saves a revision, receives a project or starts a calculation.
Replaying the same operation and request returns that original native
record. A changed request under the same identity fails. A completed
calculation keeps its original run ID; an interrupted or failed calculation
gets a new retained native attempt when the original task is resumed.
The original OS run lock protects a still-live calculation.

A workspace operation receipt retains the first native answer before export
files are published. If the process stops between receipt and file write,
resume reconstructs only the missing file from those exact retained bytes.
A changed study head cannot silently change an already committed export.

The provider participates in the existing workspace lock during its native
database operations, so ordinary portable backup does not overlap this
operator's SQLite writes. No decision state hook is added to ordinary
polling. Registered restore verification checks the retained SQL store,
complete revision chains, revision/result identity, operation references,
and retained download file bytes. Restore verification opens SQLite read-only,
so the original archive byte comparison remains valid if receiving is retried.
A legacy native store without the additive operation map remains valid; normal
desk use performs the optional schema migration after restore completes.

## Focused native acceptance

Use the package's existing arithmetic fixture to exercise the integration
mechanics: register the extension, create a study, replay its operation,
revise and replay, solve and replay its completed operation, reopen the
native run, export project/report/selection, receive the project and reopen
its provenance, then complete the original workspace backup/restore path.
Run a retained ecological experiment through the same form to assess the
real-data decision workflow and original support compatibility. No new
scientific solver or test suite is introduced here.

## Execute the complete transfer workflow

Run `python source/run_robust_workspace_transfer.py --output /new/decision-transfer`
from the assembled native environment. This starts the original Operator in a
new workspace, queues create/revise/solve and the three exports, receives the
native project, then performs the original full backup/upload/restore and
reopens retained history/downloads. It also replays the native transaction
operation IDs directly to exercise recovery after a SQL commit but before a
queue response. The output directory retains the working project, original
operator state, received complete application and workflow result. The default
input is OPT12's original arithmetic fixture; `--study PATH` selects an
existing complete native study. It does not schedule ecological raster runs.

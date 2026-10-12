# Groundwater workspace API
Version 1. All model parameters and scientific results use decimal strings; grid indices, row counts and versions are bounded integers. Exact binary heads/budgets remain downloadable.

## Original domain
The Python package is groundwater_workspace. Workbench(directory) opens the one private SQLite/object/run workspace. Workbench.state(project_id=None) returns the envelope below. Workbench.dispatch(request) commits the original operation before starting external work; replay of the exact request returns its saved result with current state. Changed request bytes under the same ID conflict. Workbench.operation(id) returns saved request metadata/result. No independent Tethys journal.

Request POST /api/action:
{action, actor, operation_id, expected_version, payload}
All committed operator mutations require the current global workspace.version. Exact operation replay resolves before the version check. Uploaded file bytes are excluded from browser localStorage; retain filename/bytes/SHA and reselect exact bytes when outcome is unknown. The server fingerprints decoded source bytes rather than base64 spelling.

State:
{workspace:{id,version,created}, projects:[Project], project:Project|null,
 sources:[Source], editions:[Edition], reviews:[Review], runs:[RunSummary],
 reports:[ReportSummary], receivers:[Receiver], deliveries:[Delivery],
 acknowledgments:[Acknowledgment], backups:[Backup], history:[Event], runtime:Runtime|null}
Project {id,name,description,site_label,version,created,updated}
Source {id,project_id,kind:'publisher_twri'|'native_package',name,sha256,files:[{path,sha256,bytes,role}],archive?,profile,findings,created}
Edition {id,project_id,source_id,parent_id,baseline_id,kind:'baseline'|'scenario',name,description,changes:[],parameters,profile,sha256,created,review_state}
Changes: {kind:'recharge',before:'3e-8',after:'...',reason}; {kind:'well',index:0,before:'-5',after:'...',reason}; {kind:'legacy_units',before:{length:'metres',time:'days'},after:{length:'feet',time:'seconds'},reason}. Supported scenario edits use the exact TWRI source and existing wells only; originals never change.
Review {id,subject_kind:'edition'|'run',subject_id,subject_sha256,decision:'approved'|'changes_requested',reason,findings:[{id,disposition:'acknowledged'|'requires_change',reason}],actor,created}
RunSummary {id,project_id,edition_id,state:'queued'|'running'|'complete'|'failed'|'interrupted',attempt,worker_active,runtime_sha256,created,updated,result_sha256?,issue?}
ReportSummary {id,project_id,run_id,title,sha256,created,downloads:{zip,json,html,csv}}
Receiver {id,name,directory,version,created}; one selected existing receiving directory, never an arbitrary remote endpoint.
Delivery {id,report_id,receiver_id,state:'queued'|'complete'|'uncertain',filename,sha256,bytes,created,issue?}
Acknowledgment {id,delivery_id,report_sha256,decision:'accepted'|'corrections_requested',by,occurred_on,reference,reason,created}. Named receiving decision is separate from file delivery or numerical review.
Backup {id,status:'queued'|'complete'|'failed'|'external_archive',filename?,sha256?,bytes?,created,issue?}

## Reads
GET /api/state?project_id=ID
GET /api/operations/ID
GET /api/sources/ID -> {source,editions}
GET /api/sources/ID/original?path=EXACT_RELATIVE_PATH -> exact original bytes
GET /api/editions/ID -> {edition,source,reviews,runs}
GET /api/runs/ID -> {run,edition,source,result?,attempts,files,review}
GET /api/runs/ID/file?path=EXACT_MANIFEST_PATH -> verified original native member
GET /api/runs/ID/compare?baseline_run_id=ID -> paired immutable native results. Reject incompatible grids, times, layer maps or declared units for physical deltas; preserve publisher numeric baseline comparison separately.
GET /api/reports/ID -> frozen report plus deliveries/acknowledgments
GET /api/reports/ID/export?format=zip|json|html|csv -> same frozen bytes
GET /api/backups/ID/download -> exact complete backup
GET /guide -> operator guide
GET /api/runtime -> configured runtime and actual fingerprint (no solver execution)

## Actions and payloads
project.create {name,description?,site_label?}
project.update {id,expected_project_version,name,description,site_label}
source.publisher {project_id,name?} retains all bundled original sources and one unchanged baseline edition; it does not run code.
source.import {project_id,name,filename,content_base64,mf6_namefile?,legacy_namefile?,layer_mapping?,intended_units?} retains the ZIP and every safe original member. Source closure findings remain visible. Uploaded Python is not executed.
edition.create {project_id,parent_id,name,description,changes:[]} creates one immutable scenario from the selected original edition.
edition.review {id,decision,reason,findings:[]} requires exact edition identity; unchanged baseline source discrepancies are explicit.
runtime.configure {python_executable,mf6_executable,mf2005_executable,reason} inspects actual installed binary/dependency identities and versions; does not install packages.
run.create {edition_id,reason} freezes source/edition/runtime and creates one queued native run.
run.execute {id,reason} starts the same original run once; existing live worker is returned.
run.resume {id,reason,retry_incomplete:false,rebind_runtime:false} reconciles the same original run first. An interrupted attempt remains retained. Explicit retry_incomplete may start a new attempt under the same run only after its original child lock is free. Rebinding may only adopt different paths with identical complete verified runtime fingerprints.
run.review {id,decision,reason,findings:[]} binds immutable result SHA; numerical completion alone is not human approval.
report.freeze {run_id,title,reason,comparison_run_ids:[]} freezes original sources, generated inputs, outputs, exact runtime/source identity, review and complete comparison in one report. Requires current approved native result and all selected members.
receiver.save {id?,expected_receiver_version?,name,directory}
report.deliver {report_id,receiver_id,reason} saves one exact delivery before file creation.
delivery.resume {id,reason} resumes same original file/package/receiver.
delivery.reconcile {id} verifies exact file and receipt; it never creates another send.
delivery.acknowledge {id,decision,by,occurred_on,reference,reason} verifies the original received package and appends its named decision.
backup.create {reason} captures the stopped complete application, original SQLite and all referenced native files.
backup.resume {id,reason} uses same original backup identity.
report.import is a CLI receiving command into a create-only destination; verifies complete manifest and opens the frozen report independently.
workspace.restore is a CLI create-only restore command; preserves workspace/operations/run IDs and old runtime identities, disables auto-run after restore. Explicit exact runtime rebind is available.

## HTTP and Tethys composition
Server is a loopback operator over the same Workbench and same static ui/{index.html,app.js,style.css}. Tethys must use the existing portal's current Paths API private user_workspace/app_workspace, original account permissions and request CSRF; it calls this Workbench API without copying a database or exposing private originals in media. A browser bootstrap object may provide apiBase, assetBase and guideUrl; both hosts serve the same UI. File responses delegate the same verified domain methods.
CLI workspace.py state/action/serve/execute-run/inspect-package/receive-package/restore use the same domain and exact JSON requests. Native runner has its own original worker lock inherited by native children; no separate Tethys queue or automatic duplicated solver run.

## Existing workspace binding
Workbench(directory, application=None, existing_only=False) validates any existing groundwater.sqlite through a read-only connection before use. An empty or partial existing DB is rejected without initializing schema or a replacement identity. Bound portal and restored-workspace reads use existing_only=True; only an explicit new-workspace action may create an absent DB. Installed wheels retain the complete reviewed application under groundwater_workspace/_application; source/editable use the original application directory.

Explicit creation accepts Workbench(directory, initial_workspace_id=UUID). Its original initialization.json binds identity before a temporary SQLite database is opened; verified initial schema is published atomically under workspace.lock. CLI init --workspace DIR [--workspace-id UUID] is the explicit creation command. Other CLI reads/actions require an existing original database.

Each run also freezes application_sha256 and a complete retained application-file manifest. Those exact code/assets enter the original object store at queue creation and are materialized inside the original native attempt before dispatch. A reserved but undispatched attempt resumes its same immutable preparation. A published dispatch with no live child requires explicit incomplete-attempt review before retry under the same run.

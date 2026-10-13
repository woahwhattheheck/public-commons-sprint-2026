# Client pipeline delivery workspace: engine and HTTP contract

This is the complete interface for the staff HTTP/browser arm. The engine retains source editions, operating contracts, installed-runtime references, original Dagster/dbt operations, source comparisons, reviews, and releases. Import and authoring do not execute the imported project.

## Application components

workspace.py owns the persistent application writer. native.py and runner.py retain original Dagster/dbt operations; receiving.py supplies complete export and receiving. server.py exposes that same writer to the staff browser and CLI. The HTTP layer does not create a separate execution engine.

## Python entry point

Import Workspace from workspace.py and Problem from common.py.
Workspace(root, source_root=installed_application_directory) opens one persistent writer. It exposes:

- meta(): workspace_id, schema, revision, created_at.
- snapshot(): the same metadata, projects page, latest runs page, latest releases page, native_available.
- invoke(action, payload, *, workspace_id=None, expected_revision=None, request_id=None): one read or one retained mutation.
- close(): close the HTTP writer without erasing or automatically replaying its native operation.
- runtime().status(): native lock state and current known operations.
- root and source_root as pathlib.Path.
- lock as a reentrant lock, used by the receiving/backup functions.

Problem has code, message, status and details. Return the actual status and error object; do not map every conflict or native outcome to HTTP 500.

Every successful invoke response has action, workspace_id, revision and result. Mutation responses also have request_id and replayed. A replay returns its original receipt, so the browser should refresh current state after it receives that receipt.

## HTTP surface

Bind to loopback by default. Generate a local capability and protect JSON mutations/downloads through the existing application session approach. Check Origin/Host for browser writes; do not embed credential values in HTML or responses. Keep CSP styles/scripts external.

- GET /api/state -> snapshot() plus selection {root,receiving_id,workspace_id}.
- GET /api/read?action=...&payload=<JSON> -> invoke(read_action, payload) plus the exact selection used for that read.
- POST /api/invoke -> JSON {action,payload,workspace_id,expected_revision,request_id,selection}; invoke the selected original writer.
- GET /api/backup -> receiving.create_backup(current_workspace, backup_directory) then download its exact archive.
- GET /api/releases/<release_id>/download -> receiving.create_release_archive(current_workspace, release_id, output_directory).
- POST /api/receive -> JSON {content_base64,workspace_id,expected_revision,request_id,selection}; use receiving.inspect_archive and receive_workspace, defined below.
- GET /api/received -> list the existing receiving catalogue and current selected writer.
- POST /api/open -> JSON {receiving_id,workspace_id,expected_revision,request_id,selection}; open an existing received writer without restoring its archive again.

Keep the original response body/request ID in an origin-wide IndexedDB pending slot before a POST. A lost response retains exactly that request and payload. A completed receive/open request must be resolved before comparing the now-current writer identity. Preserve later edits in the already-received directory. A real writer switch checks the original selected workspace and active native operation. Do not invent a successful native run, receiving archive, or tenant connection to fill an empty state.

## Read actions

- workspace.get {} -> snapshot.
- records.list {kind,project_id?,limit?,offset?} -> {items,total,offset,next_offset}. Kinds: project,edition,contract,binding,run,comparison,review,release. limit 1..200, default100.
- project.get {id} -> {project,edition,contract,binding,editions,contracts,runs,reviews,comparisons,releases}; each library is a page.
- edition.get / contract.get / binding.get / run.get / comparison.get / review.get / release.get {id} -> the full saved record.
- file.read {edition_id,path} -> {path,sha256,bytes,content,content_base64}. content is null for a non-UTF-8 file. Preserve the original bytes when it is not a text edit.
- edition.diff {before_id,after_id} -> {before_id,after_id,files:[{path,kind,before,after}]}, same project only.
- run.log {id,offset?,limit?} -> byte-offset log page; default65536, maximum262144; include next_offset and finished.
- run.artifact {id,path} -> actual retained artifact bytes and SHA; use a returned known path, never an arbitrary filesystem path.
- audit.list {offset?,limit?} -> {items,next_offset}.
- runtime.get {} -> actual runtime/lock and known run state. This does not run a pipeline.

## Mutation envelope

All mutations require all of:

{"action":"edition.save","payload":{},"workspace_id":"...","expected_revision":7,"request_id":"one-stable-uuid"}

For HTTP, include the exact `selection` object returned by `/api/state` in each new mutation, receive or open envelope. An original directory and a received copy retain the same workspace UUID but may have different saved state. The HTTP admission therefore also compares the selected root and receiving ID under the original Staff lock. A first request without its selection is rejected before a write. Existing retained request bodies, including earlier bodies without this additive field, are replayed unchanged; a completed retained response is resolved before checking the current writer.

Browser draft and project-form keys include workspace UUID, selected root and receiving ID. A late completed response updates only the draft from that originating writer. Read responses identify their actual selection, so an earlier writer\'s in-flight read is not merged into the current view.

expected_revision is the current *workspace* revision, not the entity's sequence. The engine increments the revision for accepted mutations and observed native progress. It rejects a stale writer/draft with a 409 while preserving the caller's draft. Exact request replay is checked first. The same request ID with different action, payload, identity, or expected revision is a conflict.

## Projects and source editions

project.create {label,description?} -> project {id,project_id,label,description,edition_id:null,contract_id:null,binding_id:null,created_at,updated_at}.

project.update {id,label?,description?} -> the same project ID with updated description.

edition.save {
  project_id,
  base_edition_id: current edition ID or null for initial import,
  label,
  source_notes?,
  files:[{path,content_base64}],
  delete_paths:[relative paths]
} -> immutable edition {id,project_id,parent_edition_id,label,source_notes,source_sha256,files,created_at}.

files contains changed/new files only; unchanged files are retained. Each saved file is {path,sha256,bytes}. Duplicate paths and save+delete conflicts are rejected. Source edition must contain dbt_project.yml. Supported sources are SQL,YAML,CSV,JSON,Markdown,text and lock files. Profiles, .env files, installed dependencies, target/log trees and repository internals stay outside the source import. Limits:32MiB/file,128MiB/edition.

Staff workflow must support initial directory/ZIP file selection (safe relative paths), reading every original file, retaining an unsaved UTF-8 edit, adding/deleting files, saving a new edition, reviewing exact changed paths and selecting historical editions. A generation is not replaced in place.

## Operating contract

contract.save {project_id,contract:{...}} -> immutable record {id,project_id,parent_contract_id,contract_sha256,contract,created_at}, also selects it on the project.

All contract fields:
- label:string, required
- owner:string, required
- purpose:string
- command: parse|build|run|seed|compile|source freshness|docs generate, default build
- select:string, original dbt selector, default empty
- exclude:string, original dbt exclusion, default empty
- vars:JSON object, default{}
- threads:int1..32, default1
- full_refresh:boolean, defaultfalse, valid for build/run/seed
- fail_fast:boolean, defaultfalse, valid for build/run/seed
- install_dependencies:boolean, defaultfalse; explicit original dbt deps before execution when required by the selected project
- generate_catalog:boolean, defaultfalse; original docs generation after the selected command, separate artifact directory
- expectations:[{unique_id,label?,accepted_statuses:[original status strings],required?:boolean}]
- notes:string

Expectations bind exact original dbt unique_id values from a native manifest; missing/unexecuted is distinct from a passed result. These are the client's operating acceptance criteria. Actual enforced schema, relationships, data tests and freshness definitions remain in the original SQL/YAML files and native dbt engine. Do not represent a plain owner/purpose note as an enforced data check.

Provide the full structured JSON editor plus practical labeled fields for label/owner/command/select/exclude, and a way to add expectations from a selected native result. Preserve optional fields and unsaved edits during state refresh.

## Installed execution binding

binding.save {project_id,binding:{label,mode,python_executable,dbt_executable,target,profiles_dir?}} -> immutable record with binding_sha256; selects it on the project.

mode managed_duckdb creates a local per-run DuckDB target using the selected project's original profile name. Default Python is the server's installed Python; default dbt is dbt on that installed environment's PATH; target local.

mode external_profiles refers to the operator's existing profiles directory and target. This endpoint accepts references, never credential values. The selected profile's actual hash is pinned before dispatch and checked by the native worker. Receive/reopen preserves recorded references as history; configuring an external connection on a receiving machine is explicit.

The browser should label these as installed runtime/connection paths. It must not imply a connection has been exercised before a native result exists.

## Original native execution

run.execute {project_id,edition_id?,contract_id?,binding_id?,base_run_id?} -> retained run in state prepared, then starts that *same* operation through the engine. Omitted IDs select the project's current saved records. It has id,project_id,request_id,edition_id,contract_id,binding_id,source_sha256,contract_sha256,binding_sha256,base_run_id,parent_run_id,dagster_run_id,state,request_dispatched,outcome,outcome_sha256,created_at,updated_at.

base_run_id, when used, copies the retained managed DuckDB database of one successful run of this same project before the selected incremental operation. It does not reuse another customer's database.

Original Dagster owns run execution and run storage; original dbt owns model execution and JSON artifacts. No native library is required merely to author/import/read the workspace. One native operation owns a workspace at a time.

run.start {id}: explicitly resumes only prepared or definite setup_failed before original native dispatch. It cannot relaunch an unknown or accepted operation.

run.reconcile {id}: reads the same retained native outcome/run identity. It never starts a replacement dbt command.

run.cancel {id}: records the stop intent and signals only the same verified native process when it exists; actual cancellation/result is read back afterward.

run.retry {id,binding_id?}: creates an explicit new run linked by parent_run_id only after a definite failed/cancelled outcome. An unknown result must be reconciled instead.

Read states: prepared,launching,running,setup_failed,interrupted,succeeded,failed,cancelled. run.get also gives can_start,can_retry,can_reconcile,native_available. An accepted HTTP operation is not a completed run.

## Native results and comparisons

Terminal outcome includes:
- actual original native run ID, Dagster status, dbt command/stage exit statuses and runtime versions
- evaluation {results,freshness,criteria,criteria_satisfied,manifest,native_metadata,artifact_files}
- results preserve exact unique_id/status/message/failures/execution_time/timing/adapter_response and raw native row
- manifest {metadata,nodes,parent_map,child_map}
- each node retains original type/path/relation/description/config/columns/meta/tags/dependencies/raw_code/compiled_code/checksum
- artifact_files carries actual names,byte sizes andSHA

Show paginated/filterable native nodes and original results, including unexecuted vs failed, the native run ID and source edition. Full original artifact downloads must remain available.

comparison.create {label,before_run_id,after_run_id} -> immutable comparison of two original manifests for the same client. It stores both run/edition identities, manifest identities, changed native nodes/fields, source diff and downstream unique IDs. It is source-impact information, not a claim that every downstream node executed.

## Review and release

review.save {run_id,reviewer,decision:approve|revise,comment?,comparison_id?} -> immutable review of one exact outcome and source/contract edition. A comparison must end at that run. Approval requires a successful original native run and all required operating criteria; revision reviews may record completed failures. Native history is never rewritten by the review.

release.create {review_id,label,operator_notes?} -> immutable client release bound to the approved review/run/edition/contract/outcome. Actual ZIP creation is separate and downloads the complete selected project/operating guide/native artifacts plus the installation sources. The app should distinguish saved release metadata from a materialized download.

## Receiving Python ABI

receiving.py exports:
- create_backup(workspace, output_directory, *, request_id=None) -> {path,bytes,sha256,workspace_id,revision,kind:"workspace",receiving_id}
- create_release_archive(workspace,release_id,output_directory,*,request_id=None) -> same archive metadata plus release_id and kind:"release"
- inspect_archive(archive_path) -> {schema,kind,workspace_id,revision,receiving_id,archive_sha256,files,release_id?,summary}
- receive_workspace(archive_path, destination, *, source_root=None) -> {root,receipt,workspace_id,revision,receiving_id,reused}; it does not open a second Workspace or execute a pipeline.
- received_catalog(parent_directory) -> rows of durable original receiving receipts and current root.
- inspect_received(destination) -> validate the original receipt/archive identity and current workspace database identity without restoring it again.

The server chooses a stable destination from receiving_id/archive identity, writes a retained receive request before changing the selected writer, and resolves that exact request after a lost response. Preserve edits in an existing received workspace. The engine backup/export checks the native lease; it will not copy an actively mutating database/run as a complete handover.

## Empty-state journey

Create a client project → import its original dbt source → save operating contract → select installed runtime/profile → run original project → inspect original node/artifact/history → save review → create client release → download → receive and reopen that same complete delivery. Do not fill any empty library with an invented successful example.


## Final native/writer lifetime joins

Workspace.operation_lock is an alias of its existing reentrant writer lock. invoke holds it through original mutation COMMIT and native.submit. Native setup errors after COMMIT cannot replace the retained accepted response. request.get {request_id} returns the original mutation answer or null; this is a read, without native dispatch.

For a real selected-writer switch or export use `with workspace.runtime().idle_guard():`. It owns the same writer lock plus native.lock until the guarded operation ends; a prepared launch cannot cross that boundary. A live original native operation returns native_in_use/409. Calling workspace.close inside the guard is valid. Ordinary process shutdown may call close directly; this closes only the host writer and leaves any original worker with its inherited native lease and output, for explicit reconciliation after restart.

runtime.status returns {native_available:boolean,closing:boolean,runs:[{id,state,dagster_run_id,request_dispatched}]}. The run list is the most recent100 known operations in prepared/launching/running/interrupted/setup_failed. The native lease is authoritative for active ownership; it is not inferred from a listed status.

run.log returns {id,offset,next_offset,content,content_base64,bytes,has_more,finished}. Offsets and bytes refer to original bytes; content is a display decoding. run.artifact returns {path,bytes,sha256,content_base64}, only for names retained in the original outcome.

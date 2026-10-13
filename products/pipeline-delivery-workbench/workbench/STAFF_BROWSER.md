# Client pipeline staff workspace

The staff application takes a client’s original dbt project from editable source through an operating contract, an original Dagster/dbt run, review, release and receiving. It uses the existing `Workspace` and `Runtime`. Importing a project and editing its source do not require Dagster to be installed.

## Start and reopen

From the delivered application directory:

```bash
python3 server.py /persistent/client-pipelines --control /persistent/client-pipelines-staff --port 8794
```

Open the local session URL printed by the server. The capability is in the URL fragment and exchanged for an HttpOnly, SameSite session cookie; it is removed from the address bar after connection. A server restart requires that session link again. Keep both persistent directories when moving or restarting the staff application. The source installation instructions and native dependencies are in the delivered README.

The server listens on loopback. It verifies the actual local Host, checks the same Origin for browser writes, and protects JSON reads, mutations and downloads with the local session. Source and node descriptions are rendered as text, with external scripts and styles. The desktop layout is a plain monochrome workspace with a client sidebar, source editor, structured forms and native result tables.

## Complete client workflow

### 1. Retain the original project

Create a client project with a useful label and description. In Source, import a directory, individual source files or a ZIP. If the selection contains multiple dbt projects, enter the intended project root. The import report lists the exact staged source paths, byte counts, hashes and excluded paths.

Source editions accept the engine’s original SQL, YAML, CSV, JSON, Markdown, text and lock-file formats. A saved edition retains `dbt_project.yml`. Existing profiles, environment files, installed dependencies, generated target/log trees and repository internals remain outside the import. ZIP entries are read without extraction; traversal, duplicate entries, symlinks, encrypted entries and oversized source are rejected.

Select a file to read its original bytes and edit UTF-8 content. A non-UTF-8 file remains available for exact-byte download or replacement through import. Add and delete paths in the draft, review the changed-file list, then save a new immutable edition. Historical editions remain readable; changing the selected history entry does not replace the project’s current edition.

The browser retains source changes, the selected base edition and the workspace revision in IndexedDB. A revision conflict keeps that draft. **Review current changes** compares the saved base with the current edition, identifies overlapping file paths, and lets the operator keep the draft or use the current saved file for each overlap. Applying the rebase changes the local draft; **Save new edition** performs the actual retained mutation.

### 2. Save the operating contract

Set the label, owner, purpose, original dbt command, selectors, exclusion and threads. The practical controls update the complete JSON editor. That editor preserves variables, dependency installation, catalog generation, exact node expectations, required flags and notes.

Expectations reference original dbt unique IDs. Add one from a selected native node and enter its accepted original statuses. Missing execution remains distinct from a failed result. Original SQL, YAML, relationships, data tests and freshness definitions are enforced by dbt; owner and purpose notes describe the operating agreement.

Saving a contract creates an immutable record and selects it for the project. Saved contract history is available as complete JSON. **Use current workspace revision** keeps the draft content while explicitly adopting the current revision for its next save.

### 3. Select the installed runtime

Choose managed DuckDB or an existing external profile directory. The form stores installed Python/dbt executable paths, a target and the profile-directory reference. It does not accept credential values, install the native environment or imply that a connection has already succeeded.

Managed DuckDB uses the project’s original profile name and a per-run local target. The run form can select a successful managed run of this same client as the data baseline for an incremental operation. An external connection is configured explicitly on the receiving machine.

### 4. Run and inspect original results

Native runs explicitly select saved source, contract and binding records. Unsaved source and contract drafts remain drafts. The engine commits the original request and Dagster run identity before native dispatch. An HTTP acceptance creates or controls that original operation; the actual outcome appears in its retained native result.

The interface offers the actions allowed by the original run state: start a prepared operation, reconcile an original outcome, request cancellation, or explicitly create a linked retry after a definite failure or cancellation. An unknown result is reconciled against its original operation. The staff server does not create a scheduler, launch an alternative command or replace a missing result.

The run detail retains the native run ID, selected record identities, dispatch state, source and outcome hashes, parent retry and incremental baseline. Original logs are paged by byte offset. Every listed native artifact can be downloaded in full and is checked against its retained size and SHA-256 before the browser offers it as a file.

Manifest nodes are filterable by text, resource type and whether they actually executed. Pages show up to 100 matching nodes. A selected node exposes its complete original definition, result, parent and child relationships. An executed result that lacks an emitted manifest definition remains visible. Unexecuted nodes are labeled explicitly.

### 5. Compare, review and release

Compare two original native manifests from the same client. A saved comparison includes the two run and source identities, changed source paths, changed native fields and original downstream unique IDs. Those relationships describe source impact; actual execution remains in each run’s results.

A review binds one exact native outcome and its source/contract editions. The form allows approval only when the run succeeded and all required operating criteria passed. A revision review can retain completed failures. The engine remains authoritative if a state changes between reading the form and saving.

A release binds an approved review. Saving its label and operator notes creates release metadata. **Build & download release** creates the complete selected-client archive and returns its exact bytes. **Download full workspace** produces the complete multi-project workspace backup. These are separate actions with distinct archive scopes.

### 6. Receive and continue

In Receiving & workspaces, select a complete workspace or client-release ZIP and receive it. The receiver validates the archive and selects a stable destination from the original receiving ID. The catalogue opens an existing received directory without restoring the archive again, preserving later source edits, reviews and native history.

The server serializes writer selection with the original `Runtime.idle_guard()`. That guard covers accepted launch intentions, the original native lease and writer detachment. A receiving switch uses the current workspace identity and revision. The original workspace remains reopenable from the same catalogue.

## Original request recovery

Before every project, run, receive or open POST, the browser stores the exact endpoint, request ID, original JSON body and draft context in one origin-wide IndexedDB slot. Browser tabs coordinate that slot. A lost response leaves it intact. On reopening, the application resolves the original request before issuing a new write.

A completed HTTP response is itself saved before it is applied to the view. If the browser closes after receiving it, the saved response is consumed first. The response is resolved before checking the now-selected workspace, which matters when a successful receive/open operation changed that selection. Exact replay does not restore a received archive again.

The staff server separately retains the transport intent and completed response in its control directory, using fsynced atomic files. The underlying engine retains its own original mutation acceptance. A server-side pending body can be recovered into the browser’s original-request slot through the authenticated pending endpoint. Neither layer invents a replacement native operation after an unknown outcome.

Later local edits are preserved when a response arrives: submitted source changes are cleared only when their current draft bytes still match the submitted bytes. The completed response remains visible in Receiving & workspaces and can be downloaded with its original request.

## HTTP and source ownership

| Surface | Responsibility |
| --- | --- |
| `server.py` | Local session, Host/Origin checks, one selected writer, transport receipts, source-ZIP inspection and complete downloads |
| `app.js` | Origin-wide request recovery, retained authoring drafts, source editing, original results, reviews, releases and receiving |
| `index.html` / `style.css` | Accessible desktop forms, source editor, result tables and monochrome responsive layout |
| `Workspace.invoke` | Original project, source, contract, binding, comparison, review, release and native-control mutations |
| `Runtime` | Original Dagster/dbt operation, native lease, source/profile binding, reconciliation and exact artifacts |
| `receiving.py` | Complete backup/client-release creation, archive validation and durable receiving catalogue |

The complete payload and Python interface definitions are in [HTTP_API.md](HTTP_API.md). The staff layer adds `POST /api/session`, `POST /api/import/source` for read-only ZIP inspection, and authenticated `GET /api/pending` for the retained transport body. It does not add a database writer or a native launcher.

Keep the staff control directory private to its operator. It contains retained requests and delivery archives so that a interrupted transport can be completed. Connection credentials remain in the existing external profile directory and are not supplied through the browser forms.

## Original and received writer drafts

The original workspace and each received directory keep separate browser drafts even when they preserve the same workspace UUID. Source, contract, binding and project-form drafts are keyed by the actual selection returned by the server, including its root and receiving ID. Switching directories retains the previous draft, clears the previous writer’s loaded records, and restores the destination’s own draft. A late response is applied only to its originating draft; a completed original response is still replayed before current-writer checks.

Every new HTTP mutation includes the exact `selection` from the current state response. This prevents an undispatched request from an older tab from being applied to a different directory whose UUID and revision happen to match. A read that crosses a writer change asks the operator to refresh the selected state. Original retained requests remain unchanged and continue through their saved identities.

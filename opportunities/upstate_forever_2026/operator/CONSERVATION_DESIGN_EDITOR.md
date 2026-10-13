# Scenario design inside the original native operator

Open **Scenario design**, prepare a completed original Conservation portfolio, then choose **Edit this original project** in the result. The original geometry editor opens inside the authenticated operator. Its project ID is the original preparation.project_id; reopening uses that same project and its current saved revision.

Create or reopen an alternative in the original editor. Edit polygon vertices, include or exclude explicitly selected original units, draw added polygons, retain multipart geometries and holes, and save. The original engine validates the project and the original SQLite Store enforces optimistic revisions and immutable baseline data. **Save and return to Scenario design** waits for the original editor to finish saving. Its normal local recovery mechanism remains available, with recovery storage isolated by Workspace and original project. Recovery of the initially opened project can create the owner's explicit independent copy; that recovery is retained on screen and is not replaced by the automatic preparation opening.

Choose **Land-cover scenario** in the editor, supply explicit source/destination codes and a reason, and optionally select actual native grid/profile/model families. The export uses the complete saved original project at the revision shown by the editor. If another operator saved a newer revision, the export reports a revision conflict so the current project can be reconciled. Download the complete native ZIP, return to the same Scenario design view, and receive it through the normal full binary upload. The original source importer, scenario writer and optional run preparer return their original IDs; the result opens those same native records.

The complete editable ZIP and original standalone editor remain available for portable work. The embedded and standalone presentations share the original source engine and Store behavior. The embedded Store is Workspace-owned; a standalone editor uses the directory explicitly chosen at its startup.

## Original stores and state

- Scientific plans, studies, source collections, scenarios and runs keep their existing stores.
- Original editor projects/revisions use conservation-design/editor/projects.sqlite, managed by the existing scenario-design.server.Store.
- Editor operations, original uploaded requests and complete exports are retained inside the same Workspace.
- Exact derived browser assets are under conservation-design/editor/assets/<content-digest>/, with their original source files retained in the application.
- The preparation-to-project reference retains the original plan, study, binding and project IDs.

Opening an existing preparation checks its immutable original baseline and reopens its current Store revision. Original imports and independently received project copies retain the owner's original receiving behavior. Retry of the same queued editor operation preserves its staged project and original task identity. A save recovered after its SQLite commit can recognize the same submitted body at the immediately following revision.

Portable Workspace capture includes the SQLite state, original request files, saved revisions/exports and the complete scenario-design application directory. The existing scientific run and its inputs travel through the ordinary native portable mechanism.

## Authentication and transport

The registered file route is:

    /api/file/conservation-design/{workspace_key}/editor/{member_path...}

Only index.html, app.js, style.css and transport.js are served. Each file uses the existing verified download ticket. A specific same-origin frame policy allows the original editor inside the main application. The normal download cookie applies to /api/file/; the application capability remains in the parent host.

The original editor's fetch calls—including its direct complete ZIP, GeoJSON and native-handover downloads—are handled by a small frame transport. Requests identify their original endpoint, original body, selected Workspace and displayed revision. The parent accepts messages only from its exact editor window and same origin, and calls the existing host.api for authenticated API actions. No capability appears in the frame URL or project.

Normal reads and pure geometry validation use POST /api/conservation-design/editor with a body containing workspace, path and optional data. File-backed writes use the existing binary upload service; the queued action receives its original upload ID. Native responses are returned to the original editor as the same JSON or complete binary bytes that its standalone server would return. Export tickets are downloaded and checked against their retained byte count and SHA-256 before delivery to the original editor.

## Queued and model interfaces

    conservation.design.editor.open
    {"preparation_id": "ORIGINAL_PREPARATION_ID"}

    conservation.design.editor.write
    {
      "path": "/api/projects/ORIGINAL_PROJECT_ID/upstate-plan",
      "upload_id": "ORIGINAL_OPERATOR_UPLOAD_ID",
      "expected_revision": 4
    }

Expected revision is required for project, GeoJSON, field-factor and complete land-cover exports. The original save request carries its own revision and complete project in its retained JSON body. Standard import/receive endpoints retain their original body semantics. The ordinary queue owns task IDs, accepted-operation recovery and interruption/resume; the editor does not introduce a second job runner.

Native functions in model/conservation_design_editor.py:

- open_preparation(workspace, preparation_id) → original {revision, project, _editor}.
- read(workspace, {path, data?}) → original read/geometry response.
- execute(workspace, selection, operation_id) → retained {id, state, response, files}.
- frame_assets(workspace) → exact file descriptors for the original editor presentation.

The native provider maps original uploaded bytes into a verified Workspace input before execute. Complete export responses contain file, filename, mime_type, project_id and revision, with normal original download tickets on the task. Browser opening uses the same prepared project ID and refreshes its current saved revision before boot.

The original standalone server and eco_bridge imports are guarded for private-package and standalone use. The original app.js and HTML remain in the owner source tree; exact transport/boot substitutions are applied to the retained served assets, including Workspace/project-specific recovery storage. Its original geometry editing, validation, numeric-property bindings, alternatives, source references and export construction remain the owner's implementation.

## Receiving the complete product path

The additive conservation_design_browser_receiving.py consumes the already-completed Conservation browser receipt. It keeps that receipt's original plan/study, prepares and downloads the complete editable project, opens iframe[data-design-editor] through data-design-action=edit, edits/reopens one identified alternative, exports with explicit codes and receives the exact downloaded ZIP through the real binary upload. It reopens the returned scenario and any prepared run and compares original input/source/project identities.

The browser companion is maintained with the complete operator source and uses the existing accepting native host. The authored frame/controller checks have executed in JavaScript for original Workspace/revision transport, direct binary export response and the previous full-upload/recovery cases. Native GIS/Chromium acceptance continues through the same original receiving operation and its concrete retained plan.

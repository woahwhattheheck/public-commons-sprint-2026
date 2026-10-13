# Conservation plan → editable geometry → original native scenario

This extension joins the existing Conservation plan store, ASTRA-DESIGN12's complete geometry editor, and the maintained native operator. It supplies the normal task queue, completed-operation reopening and download tickets for both directions.

## Complete operator journey

Open **Scenario design** beside Conservation. Choose a completed original portfolio and one of its four explicit geometry views, then **Prepare original plan**. The operation retains the complete original binding JSON, editable project JSON and editable ZIP inside the same Workspace. Its prepared project preserves every selected native string ID, source-edition reference, original candidate quantities and input descriptors.

Choose **Edit this original project** in the prepared result to use the original geometry editor inside this operator. It opens the same original project ID and current saved revision. Create an alternative, edit its polygons and export the complete native handover from **Land-cover scenario**, then use **Save and return to Scenario design**. Full embedded transport and revision details are in CONSERVATION_DESIGN_EDITOR.md.

For portable standalone work, download **Complete editable project ZIP** and start the supplied original editor:

    cd scenario-design
    python server.py --workspace /absolute/path/to/your/design-workspace

The editor's startup line gives its local URL. Use **Receive project**, create an alternative, edit the desired polygons, and select **Land-cover scenario**. Enter the actual source and replacement land-cover codes and a reason. Supplying an original grid/profile selection requests native preparation; the original partial NDR/SDR scope is preserved. Export the **complete native handover**, which includes original and edited GeoJSON, the exact binding, the editable source project and its member inventory.

Return to **Scenario design** in the main operator and choose this complete ZIP. The view uses the existing authenticated binary upload service, with the current operator upload limit and a 100 MiB maximum design handover. The queued request carries only the returned original upload ID. Before native receiving, the provider verifies that upload and retains its exact original bytes and receipt inside this Workspace. The advanced file-descriptor route and an already imported document source remain available.

The queue calls the original editor's register_landcover, which uses Workspace.import_sources, save_scenario and prepare_run. The complete edited footprint is checked against the original model_domain before requesting a run, with reporting-area intersection reported separately. The result provides **Open original scenario** and **Open prepared run** buttons using the ordinary operator controls.

The view keeps unsent field selections and the original browser File across tab remounts separately for each Workspace. Its upload is reused after a definite rejected queue request. Once submission is uncertain or accepted, the original operation identity remains recoverable; the normal task list can recover an accepted task even when its first response was lost. The view retains an interrupted operation's identity and supports the existing task resume endpoint. Reopening a design operation rechecks its full files, original plan reference, native scenario and prepared run identity. Downloads preserve the original source bytes. Changing geometry creates an explicitly identified editor revision; it does not alter the source plan.

## Source composition

Receive every file in this package at the maintained application root. The original scenario-design directory is complete, including its browser, command-line tools, guides and original tests. The owner's original modules use guarded imports for private-package and standalone use: conservation.py and engine.py, plus the original server.py and eco_bridge.py now loaded for the embedded Store. Original browser source remains intact; exact transport, initialization and recovery substitutions are applied only to the retained served assets. scenario-design/__init__.py is additive. No global engine or conservation module aliases are installed.

Additive runtime files:

- model/conservation_design.py
- model/conservation_design_editor.py
- operator/conservation_design.py
- operator/extensions/conservation-design.json
- operator/web/conservation_design.mjs
- operator/web/conservation_design_editor.mjs
- operator/web/conservation_design_frame.js
- operator/web/conservation_design.css
- scenario-design/__init__.py

The ordinary registered extension host reads the descriptor, mounts the client, dispatches the preparation, receiving and original editor queue actions, serves its assets, and retains existing authentication and file tickets. There is no shared server or Conservation browser edit. The native editor requires its existing Shapely and PyProj dependencies, already used by the scientific application.

The original editor source and the complete editable receiving must remain under scenario-design/. Its SOURCE_MANIFEST.json is regenerated from the complete package with the import-compatible source and initializer. The original 69,719-byte upstream ZIP had SHA256 77f5a0122d1ffda1512c15ec4f907a90e37c6daa3bbdd622a74a1fcfce3f93b4. The source composition document retains the exact import guards and original hashes. The supplied start.sh retains its executable mode.

Workspace state is under conservation-design/preparations/<preparation-id>/ and conservation-design/received/<receiving-id>/. Browser originals and original upload receipts are retained under conservation-design/uploads/ before receiving; portable capture includes them. These hold views and receiving receipts; authoritative plans, source collections, scenarios and runs remain in their existing directories. A portable Workspace capture must include all Workspace files and the full scenario-design application directory. The editor may retain its independent editable drafts in the directory explicitly selected at startup; export those complete drafts when handing them to another operator.

## Queued actions and passive reads

conservation.design.prepare payload:

    {
      "plan_id": "ORIGINAL_PLAN_ID",
      "geometry_role": "reporting_units",
      "title": "Optional project title"
    }

geometry_role is reporting_units, whole_units, reporting_union or whole_unit_union. Preparation is repeat-safe for the exact original binding and choice. Its result includes id, kind=preparation, state=complete, plan_id, study_id, binding_id, project_id and files.binding/project/editable_project.

conservation.design.receive accepts exactly one input. The normal browser upload uses:

    {"upload_id": "ORIGINAL_OPERATOR_UPLOAD_ID"}

The provider resolves the upload through the existing authenticated operator, verifies its original bytes and hash, and copies the full file into this Workspace before calling model.receive with the retained descriptor. Native source/scenario identities are independent of the transport upload ID.

A complete file already retained in the Workspace uses:

    {"file": {"path": "received/design.zip", "bytes": 12345, "sha256": "ACTUAL_SHA256"}}

or an original imported document:

    {"source": {"source_collection_id": "ORIGINAL_COLLECTION_ID", "source_id": "ORIGINAL_DOCUMENT_ID"}}

or, for compatibility with direct clients supplying a ZIP at most 2 MiB:

    {"bundle_base64": "COMPLETE_ORIGINAL_BYTES_BASE64"}

The original bytes are parsed as a complete eco.upstate-landcover-design/v1 handover; every member and the editable project are checked by the original editor. Native preparation validates the exact selected grid/profile/model families and original biophysical table. A profile supporting a subset of a combined grid resolves to that common native scope when models is omitted. An explicit scope must be available in both. The adapter delegates native preparation to the real Workspace using the resolved original selection.

The completed result includes:

    {
      "schema": "upstate.conservation-design/v1",
      "kind": "receiving",
      "id": "...",
      "state": "complete",
      "plan_id": "...",
      "study_id": "...",
      "source_reference": {},
      "project_id": "...",
      "design_revision_id": "...",
      "alternative_id": "...",
      "geometry_role": "...",
      "selected_ids": [],
      "edited_feature_count": 0,
      "source_collection_id": "...",
      "source_id": "...",
      "scenario_id": "...",
      "run_id": null,
      "run_selection": null,
      "model_domain_coverage": null,
      "native_receipt": {},
      "files": {}
    }

run_id, run_selection and model_domain_coverage contain the actual values when the handover requests preparation. The supplied selected_ids describe the original plan, while the edited feature count and retained design.geojson describe the independently edited footprint. The original plan's candidate quantities remain historical context for its modeled cases; compute the edited scenario through the original runner to obtain that scenario's own outputs.

GET /api/conservation-design/overview lists completed original portfolios and saved design operations. GET /api/conservation-design/preparation?id=... and /receiving?id=... reopen full records and provide _downloads through ordinary verified tickets. The standard workspace query parameter is required. These reads do not write new scientific records.

Python entry points are prepare(workspace, value), receive(workspace, value), get_preparation(workspace, id), get_receiving(workspace, id) and overview(workspace). Direct CLI:

    python -m model.conservation_design --workspace WORKSPACE prepare --plan-id ORIGINAL_PLAN_ID --geometry-role reporting_units
    python -m model.conservation_design --workspace WORKSPACE receive --descriptor COMPLETE_FILE_DESCRIPTOR.json
    python -m model.conservation_design --workspace WORKSPACE inspect --kind receiving --id ORIGINAL_RECEIVING_ID

## Validation and receiving

The complete original editor ZIP was decoded and every member matched its owner's SOURCE_MANIFEST before composition. All package import edits match exact original strings, and all output file hashes are included in the complete carrier. The additive browser module was syntax-compiled and exercised in the JavaScript runtime with injected host, storage and DOM contracts. Focused checks covered a 3 MiB raw File producing a 186-byte queue request, a late Workspace change suppressing task submission, a rejected request preserving editability and reusing its original upload, newest-history-request wins, original operation recovery, per-Workspace draft/File retention, and native scenario/run links. The native call sequence and result fields were checked against the maintained Workspace, binding and scenario modules. Actual GIS/Chromium receiving uses the accepting original application host.

The accepting original application receiver should use its existing actual regional plan: prepare the project; open and edit its original geometry; export the full native handover; receive it through the queue; reload that receiving record and compare its unchanged IDs/files. If an actual compatible native grid/profile is selected, retain that run_id and continue it through the existing run operation. This workflow reuses the selected original operation and does not rerun unrelated native cases.

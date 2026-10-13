# Complete calibration review

The existing Calibration and validation desk can retain one readable review of a completed nominal calibration together with explicitly selected source-error sensitivity and original-catchment maps. The package carries a self-contained HTML report, all scientific tables, original observation and catchment files, exact scientific records, selected map files, a member manifest and a complete ZIP.

## Operator journey

Open a completed calibration, then **Prepare review package** in **Complete calibration reviews**. Enter the review title and optional notes. Choose an existing published-source-error edition and an existing catchment-map edition, or retain the nominal analysis on its own.

A map containing source-error bands must be paired with the exact uncertainty edition from which it was made. Choosing that map in the form selects its original uncertainty edition. The backend enforces the same relationship. A map without error bands can accompany a sensitivity edition; the report states which edition the maps actually use.

**Build review package** uses the existing operator queue and workspace gate. The completed task opens the saved review. **Read report** opens the original authenticated member route. Download **Complete calibration review ZIP**, extract it, and open \`index.html\` to use the report offline. Every relative source/table/atlas link stays inside that package. Print the report through the browser's normal print command.

The saved review has its own selection, title and notes. Revising those choices creates another immutable review. Existing calibrations, rankings, plans and supplements retain their original identities.

## Scientific content

The report contains:

- The original selected profile, native run, calibration objective, candidate-run count and distinct-profile count.
- The declared pollutant weights and normalization, exact annual-reference method and original observation metadata.
- Original catchment groups and their calibration or held-out roles.
- Complete nominal candidate ranking, excluded candidate outcomes and physical metrics.
- Selected-model observed-versus-modeled load plots by pollutant, with filled circles for calibration and open squares for held-out validation. Incomplete pairs remain in the complete table and are counted beside each plot.
- The selected candidate's held-out physical metrics and full missing-support details. Challenger held-out values never enter the ranking or the review's candidate fit table.
- Original leave-group-out results and the complete retained candidate envelope, with the producer's exact interpretation.
- Optional published-source-error comparisons: multiplier, published-error coverage, original analysis state, signed pairwise loss gaps, numerical tolerances, first-tie multipliers and their explicit missing-value reasons.
- Optional original-catchment maps: complete PDF, SVG pages, GeoJSON and CSV. The first original SVG page per layer is embedded in the HTML so the main report displays independently of browser file-access restrictions. Every remaining original page travels in the package.
- Complete original selected-catchment rows, retaining observed, native, delivered external and adjusted loads separately, with units and support.
- A readable source inventory and exact member sizes and SHA-256 identities.

The report does not run a model or estimate another calibration. Its scatter coordinates are display positions of the retained values. The original nominal winner, objective, normalization and holdout design remain fixed.

A possible source-error reversal means a challenger can outperform the original selection somewhere within the declared marginal source ranges. It does not establish which challenger is globally best at that endpoint. Missing source errors remain visible. Exact coefficient cancellation or a zero multiplier may resolve an individual comparison while the overall source coverage remains partial.

Map interpretation remains the original map producer's interpretation. Nested upstream catchments keep their original geometry; the review does not add their area or loads. Challenger map layers remain calibration-only. Original selected-model validation layers are descriptive.

## Native API

From the complete current application:

~~~python
from model.workspace import Workspace
from model import calibration_review

workspace = Workspace("/absolute/path/to/the/original/workspace")
review = calibration_review.prepare(
    workspace,
    calibration_id,
    uncertainty_id=selected_uncertainty_id,  # None is allowed
    map_id=selected_map_id,                  # None is allowed
    title="Annual reference calibration review",
    notes="Questions and interpretation for this exact retained selection.",
)
reopened = calibration_review.inspect(workspace, review["id"])
~~~

Equivalent CLI:

~~~sh
python -B -m model.calibration_review "$WORKSPACE" prepare "$CALIBRATION_ID" \
  --uncertainty-id "$UNCERTAINTY_ID" --map-id "$MAP_ID" \
  --title "Annual reference calibration review"
python -B -m model.calibration_review "$WORKSPACE" inspect "$REVIEW_ID"
~~~

Omit optional supplement arguments when no supplement is selected. The module uses standard-library packaging and the existing scientific dependency inspectors. It does not import plotting, Fiona or raster processing to build this review from already completed artifacts.

The retained collection is \`calibration-reviews\`. Files live in \`calibration-review-exports/<selection_id>/\`. The selection identity includes the format version, original workspace and calibration IDs, explicitly selected supplements, title, notes and complete source stamp.

The result includes:

~~~text
version, workspace_id, state="complete"
selection_id, selection, title
calibration_id, plan_id, uncertainty_id, map_id
selected_run_id, selected_profile_id
directory, source_stamp, files, manifest, archive, file_count
~~~

All file descriptors contain the actual relative path, bytes and SHA-256. \`file_count\` counts report members before the outer manifest and ZIP; these two artifacts have their own descriptors.

## Retained originals and source checks

Preparation reuses \`calibration_uncertainty._retained\` and \`_source_stamp\` to check the completed report, original plan, observation edition, fixed objective/scales, reference units, prediction rows and original observation CSV. A selected uncertainty edition is reopened through its original inspector. A selected map edition is reopened through \`calibration_maps.inspect\`.

The catchment source is resolved through the current Workspace API and matched against the exact original spatial-group source hash. Its body and every companion retain original \`view_path\` or filename structure under \`sources/catchments/\`. This preserves shapefile companions and other original multi-file source formats.

The package keeps the original raw calibration, plan, observation and selected supplement JSON files; the exact original observation CSV; original catchment source entry and all its bytes; snapshots of each retained native candidate; complete original observation-comparison records; CSV tables; and every selected map artifact.

The full native raster workspace continues to travel through the maintained whole-project transfer. This review package intentionally contains its analysis and review inputs; its inventory states every included file. Original native selections, source vintages and comparison identities remain available in the retained scientific records.

Copies are independent streamed files, verified against the original byte identity. Publication is immutable and resumes at the same content-addressed selection. ZIP members use a fixed timestamp and stable ordering. A failed or interrupted build retains its partial content-addressed directory for resumption; it does not save a completed review record until the whole package and source dependencies have been checked.

\`inspect\` validates the retained record, original source chain, selected IDs, manifest, every member and archive. Workspace restore invokes this same validator through the existing calibration extension. Nested authenticated file requests verify only the requested immutable member, avoiding an unnecessary full archive rehash for every link.

## HTTP and task integration

The existing provider adds:

- Queue action \`calibration.review.prepare\` with \`report_id\`, optional \`uncertainty_id\`, \`map_id\`, \`title\` and \`notes\`.
- Read route \`GET /api/calibration/review?id=<review_id>\`.
- Item kind \`calibration-reviews\`.
- File route \`/api/file/calibration-review/{workspace_key}/{review_id}/{member_path...}\`.

The file route uses the maintained extension registry's authenticated, inventory-checked nested-member transport. Its report is script-free. The iframe and response policy preserve the local operator origin for authenticated relative file links, while scripts, forms, popups and top navigation remain disabled; images are embedded data images. Original JSON, CSV, vector, PDF and SVG members keep their normal file types and download behavior.

The calibration desk's state contains compact review summaries. The full file inventory is loaded on explicit review opening. The browser guards workspace and request identity before applying an asynchronous response. Leaving the desk invalidates pending reads; completed tasks and saved records reopen the same original review.

## Source installation

The maintained \`operator/install_calibration.py\` cohort now contains the review model, this guide and \`operator/web/calibration_review.mjs\`, in addition to the complete nominal, uncertainty and map components. It composes the receiving application's exact extension installer and preserves current shared server/browser source. The current extension registry must support typed nested file routes, as already required by the original editable GIS workflow.

~~~sh
python -B "$SOURCE/operator/install_calibration.py" \
  --source "$SOURCE" --application "$ACTUAL_APPLICATION"
~~~

The cumulative receiver calls the same install function before the final source snapshot and archive. Existing recursive application/workspace inventories already retain this module, browser asset, guide, review collection and export directory.


## Reopen the complete review after a project transfer

The maintained full workspace archive includes both `calibration-reviews/<review_id>.json` and every regular file below `calibration-review-exports/<selection_id>/`. This includes the report HTML, scientific tables, original source copies, all selected map files, the member manifest and `calibration-review.zip`. The related calibration, plan, observation, map and source-error records and original content-addressed objects travel in the same workspace inventory.

In the operator, finish the review task, open **Back up the original scientific workspace** and choose **Create complete backup**, then receive that archive into a new directory. Select the received workspace, open **Calibration and validation**, open the original completed calibration and choose its saved review. The receiving operator reopens every saved review with `calibration_review.inspect` before registering the workspace. Its local workspace key changes with the receiving directory; scientific project, selection and review IDs stay the same.

The original native API for a full transfer is:

~~~python
from pathlib import Path
from model import portable, calibration_review
from model.workspace import Workspace

original = Workspace("/absolute/path/to/original/workspace")
review = calibration_review.inspect(original, review_id)
archive_path = Path("/absolute/path/to/new-workspace-archive.zip")
portable.backup(original, archive_path, include_intermediates=True)
manifest = portable.inspect_archive(archive_path, verify=True)

prefix = "workspace/" + review["directory"] + "/"
for expected in [*review["files"].values(), review["manifest"], review["archive"]]:
    retained = manifest["members"][prefix + expected["path"]]
    if any(retained[field] != expected[field] for field in ("bytes", "sha256")):
        raise ValueError("The review archive member differs from its saved identity")

received = portable.restore(archive_path, "/absolute/path/to/new-receiving-directory")
reopened = calibration_review.inspect(Workspace(received["workspace"]), review["id"])
~~~

The original archive collector checks every file while streaming and compares the entire workspace and application inventories again before publishing. Restore verifies the manifest and extracted bytes, keeps the original scientific project identity, and publishes a new receiving directory. Application source under `model/`, `operator/` and `source_tools/` includes the review producer, registered desk, file routes and maintained installer.

For offline reading, unzip `calibration-review.zip` and open `index.html`; retain its full directory so relative table, map and source links resolve. Inside the operator, the same links use the existing HttpOnly download session. The report's iframe and HTTP sandbox both include `allow-same-origin` and `allow-downloads`, with no script permission, so `SameSite=Strict` authentication accompanies those local requests. The model report and copied original bytes are unchanged.

### Incremental handover through the existing continuity desk

The current [Project continuity](../operator/PROJECT_CONTINUITY.md#incremental-handover-with-saved-work) workflow, merged in PR3100, uses the same full native backup as its source. `NativeProjectTransfer.capture` calls `portable.backup` and the maintained `TransferStore.capture_archive` indexes **every** original archive member. A later review therefore enters the new snapshot as its original record, all package members and its complete ZIP. Only transfer blocks already present and verified on the receiver are reused.

Choose **Incremental handover with resumable parts** in the complete-project form. Receive its manifest, return the receiver's missing-block request, receive every requested part, and choose **Receive independent project** once the edition reports complete. The maintained engine reconstructs the original archive, invokes `portable.restore`, and calls the same extension workspace validators before registration. Open the saved review from that newly registered workspace.

The relevant original producers are `model/project_transfer.py`, `model/project_transfer_workspace.py`, `operator/project_transfer.py` and `operator/project_continuity.py`. `validate_snapshot` requires an exact original member set; ordered block lengths and member hashes must agree. `materialize_archive` refuses missing blocks and verifies every reconstructed member before the native restore. Full and incremental handovers therefore use the same review file identities.

For the existing command-line handover, use the commands in Project continuity's **Command-line handover** section. They retain the same snapshot ID across manifest acceptance, missing-block requests, part receiving and final native receiving. No separate calibration transport or source collector is required.


The origin requirement follows the browser's documented sandbox behavior: [Chrome's sandbox cookie explanation](https://privacysandbox.google.com/blog/sandbox-allow-same-site-none-cookies) and the [HTML iframe sandbox specification](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox). These are the existing session cookies; no capability token is placed in a report URL.

## Producing versions and native output quantities

Newly prepared reviews retain the exact calibration native-execution snapshot in **Native model versions and output quantities**, with a complete `tables/native-execution.csv`. The table records each candidate run and pollutant, actual producing-stage or observed-run version, explicitly labeled requested-version fallback, raster and annual-load units, area reduction, original versioned documentation, stage reuse and completion, and export/stream/argument hashes. Source inventories retain the original native records beside this readable presentation.

The snapshot comes from the completed calibration report, with its original plan as the retained fallback. Preparing a review never infers a producing version from the currently installed executable. Historical reports without this snapshot remain readable; their review explicitly identifies the available original native records.

The presentation edition `native-execution-v1` participates in a newly prepared review's immutable selection. An existing review keeps its original identity, files and transfer inventory. Prepare a new review from a newly completed calibration to include the current physical-output comparison contract. Normalization tables show the numeric scale and its recorded basis separately.

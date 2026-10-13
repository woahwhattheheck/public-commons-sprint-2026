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

The file route uses the maintained extension registry's authenticated, inventory-checked nested-member transport. Its report is script-free and receives an opaque sandbox policy; images are embedded data images. Original JSON, CSV, vector, PDF and SVG members keep their normal file types and download behavior.

The calibration desk's state contains compact review summaries. The full file inventory is loaded on explicit review opening. The browser guards workspace and request identity before applying an asynchronous response. Leaving the desk invalidates pending reads; completed tasks and saved records reopen the same original review.

## Source installation

The maintained \`operator/install_calibration.py\` cohort now contains the review model, this guide and \`operator/web/calibration_review.mjs\`, in addition to the complete nominal, uncertainty and map components. It composes the receiving application's exact extension installer and preserves current shared server/browser source. The current extension registry must support typed nested file routes, as already required by the original editable GIS workflow.

~~~sh
python -B "$SOURCE/operator/install_calibration.py" \
  --source "$SOURCE" --application "$ACTUAL_APPLICATION"
~~~

The cumulative receiver calls the same install function before the final source snapshot and archive. Existing recursive application/workspace inventories already retain this module, browser asset, guide, review collection and export directory.

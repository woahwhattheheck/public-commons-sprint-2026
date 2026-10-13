# Upper Savannah scientific operator

TokenJunkieLabs · maintained decision, source and native-model workflows

The modules in this directory extend the original Upper Savannah scientific application. They join source preparation, native-run work, saved scenario assessments, model programmes and source-bound water designations through the same Workspace, authenticated operator and task queue.

Needs expert review: environmental model interpretation and regulatory source applicability. The application preserves the selected inputs, physical units, geography and decision settings needed for that review.

## Work with retained model results

The Scenario decisions desk opens original completed runs, native paired comparisons and retained common-mask watershed reports. Nitrogen and phosphorus remain in kg/year; sediment remains in metric tonnes/year. Direction, priority weights, selected cases and reporting geography are explicit. Saving keeps the full physical comparison, original source snapshot, methods and revision parent.

Large assessments use resumable authenticated transfers within the original operator's request ceiling. The browser renders one table page while filtering and sorting the full cohort. JSON, CSV and text exports retain every computed row. Repeated workspace-state reads use compact derived saved-view summaries; opening and receiving a view verifies the original immutable record.

See [Scenario decisions](operator/SCENARIO_DECISIONS.md), the [component contract](operator/SCENARIO_DECISIONS_COMPONENT.md), and [performance notes](operator/SCENARIO_DECISIONS_PERFORMANCE.md).

## Install in the complete application

Compose these maintained source paths with the current complete Upper Savannah application and its original model/common.py, model/workspace.py, operator/server.py and operator/web/app.mjs. Keep the source-preparation and native-run component modules with their descriptors. The complete application receiver assembles these original dependencies and the current desk contributions together.

Run the shared installer against that actual application directory:

    python3 -B install_extensions.py --application /path/to/complete-application

For a source package held separately, add --source-root /path/to/current-source. The installer composes the original server/browser hooks, registered source roots, file tickets, task actions and workspace lifecycle. The [extension guide](operator/EXTENSIONS.md) documents full provider and browser contracts, typed report previews and nested GIS project members.

Use the original server with the scientific workspace:

    python3 -B operator/server.py --workspace /path/to/scientific-workspace

Open the operator_url returned by that server. The native model workflow retains the application's selected InVEST 3.20.0 NDR/SDR stages, source coefficients, grid and run identities. Existing complete workspaces can be transferred through their normal portable archive and receiving workflow.

## Effective water-designation workflow

The designation adapter consumes the original source crosswalk, declared rule edition and exact native geometry. It can import its selected source into the original Workspace, create a retained water-desk selection and pass that actual overlay into the original delivery operation. Effective classifications, source metadata and proposal context remain separately represented.

Use the original crosswalk builder's returned result with --crosswalk-result so its actual run directory and source-manifest identity are retained. Full commands, selection schema and source references are in [Water designation applicability](source_tools/WATER_DESIGNATION_APPLICABILITY.md).

## Focused development checks

The browser modules include focused checks for workspace-switch lifecycle and regional-cohort rendering/export behavior:

    node operator/web/extension_host.check.mjs
    node operator/web/scenario_decisions.performance.check.mjs

The receiving application exercises the original Python operator with its actual source imports, completed native results, saved assessments and portable restore. Verification notes in each guide distinguish the executed component checks from the receiving operation.

## License

Authored code uses the repository's [MIT license](../../LICENSE). Original environmental data, regulatory documents and external source material retain their publisher terms and attribution.

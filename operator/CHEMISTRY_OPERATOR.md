# Reach chemistry in the maintained operator

The Reach chemistry desk opens the original REACT12 calculation engine inside the existing scientific Workspace. Its queue, authenticated API, source intake, file tickets and complete-workspace receiving belong to the original operator. The solver remains the authored `model.reach_chemistry` package.

## Install and open

From the application containing `model/workspace.py` and `operator/server.py`:

```sh
python -B install_chemistry.py --application .
```

The installer reads the complete owned component, validates its Python and registration, then commits it under the shared extension-install lock. It accepts the original REACT12 files and its own current files; an independently changed file must be reconciled before replacement. Existing application routes and desks are composed through `operator/extensions/chemistry.json`.

Restart the original operator process, open the existing scientific workspace, and select **Reach chemistry** after **Observations**. The original annual-load observation comparison remains available in Observations.

The application requires the packages listed in `requirements-chemistry.txt`. Install them into the same Python environment used by the operator. Native computations use the original pinned scientific inputs and declared chemical project.

## Open a retained scientific project

The source intake accepts the original project JSON or an exported editable chemistry ZIP. Choose the retained source edition and its entry, then use **Import chemical project** or **Receive editable ZIP**. Source identities stay attached to each immutable chemical scenario.

Choose a saved chemical scenario and **Open scenario** to inspect and edit its physical inputs. The desk presents reach storage, transport, external loading and transformation coefficients, alongside each source reference. The complete project and provenance remain editable as JSON.

Concentrations use milligrams of the declared conserved basis per litre; external loads use kilograms of that basis per day, reach volumes cubic metres and flows cubic metres per day. Preserve the declared basis when assigning a measured species or entering a load.

Explain the scientific change and select **Save immutable scenario edition**. The case opened in the editor remains its parent, even when the saved-scenario selector changes. Open the resulting queued task and its saved scenario before running an edited selection.

Each scientific workspace retains its own editor and selected analysis while navigating to other desks. A newly completed operation refreshes saved scenarios, retained source choices and the analysis list without replacing an unsaved scientific draft. Opening another workspace uses that workspace's own retained editor.

## Calculate and inspect results

Select an analysis mode and enter the original engine's request:

- **simulate** calculates concentrations and conserved-basis mass budgets over the declared phases and sample times.
- **attribute** calculates source contributions through the same transport and reaction model.
- **sensitivity** calculates the requested parameter derivatives.
- **calibrate** fits the designated observations and saves the fitted parameters as a child scenario.
- **monitoring** selects measurements using the request's candidate errors and prior precision.
- **uncertainty** propagates the stated parameter distributions, correlations, draw count and seed.

The complete engine contract and numerical references are in `CHEMISTRY.md`. The selected saved scenario must match the current editor before **Run selected analysis** submits the original `chemistry.run` queue action.

Results expose concentrations, samples, budgets, reactions, observations, scores, parameters and other mode-specific collections. Pagination reads the retained run result, and downloads use the original authenticated file registrar. A cancelled or interrupted calculation can be reopened with **Resume same analysis**. Cancellation signals the active run directly, so it does not wait behind the serial scientific worker.

## Use measured observations

The original CSV input accepts `id,reach,species,day,mg_l,sigma_mg_l` and optional `role` (`fit` or `holdout`) and `qualifier` (`equal` or `below`). Supply the actual observation source reference. Verify reach assignment, species basis, elapsed time origin and uncertainty against the retained scientific project. The engine keeps held-out observations outside fitting and uses its upper-bound residual for nondetect observations marked `below`.

The separate ASTRA-OBS12 measured-observation consumer can provide the same native request from retained measurement bindings. Its `native_payload(binding, Chemistry(workspace), case_id)` returns the original `chemistry.run` payload after matching the selected case and records. Install that consumer from its complete maintained source when using its measured-data desk; this chemistry registration does not replace the original observation intake.

## Export, transfer and continue

**Export editable project** includes the selected case, its original source files and completed analyses. The original chemistry transfer preserves source identities, companions, original manifests and selected run artifacts. Receive the ZIP through the original Sources intake, then **Receive editable ZIP**. The receiver creates its own retained case and correctly mapped native run identities, including a fitted child scenario when present.

For the whole scientific workspace, use the existing complete-workspace backup and receiving controls. The extension's receiving hook reads retained cases, run selections, checkpoints and original artifacts. Reading a case verifies its retained source objects directly; it does not create a source-view directory.

After receiving, open Reach chemistry, choose the received case, inspect a completed result page, edit one physical parameter with an explanatory reason, save the child scenario and run the intended scientific request. Prior cases and completed analyses remain available for comparison.

## Source and integration

Original REACT12 source version: `0.1.0`, whose complete 31-member manifest is retained in `integration/reach_chemistry/SOURCE_MANIFEST.json`. Its eight solver/model/service modules remain unchanged.

This operator continuation adds the native extension descriptor, per-workspace browser lifecycle, read-only source-reference verification, receiving hook and current installer. The original distribution installer is retained at `integration/reach_chemistry/install_chemistry_legacy.py`; the root entry point now installs through the current registry without rewriting shared server or application files.


## Saved scientific reports

Open a completed analysis and select **Prepare scientific report**. The existing queued action renders the saved result with its physical units, source provenance, fit/held-out records, convergence and supplied prior assumptions. Open the completed edition under **Saved scientific reports**. The inline report uses original authenticated file tickets; the complete ZIP opens offline with all original members and the editable project. See [Chemistry scientific reports](../model/CHEMISTRY_REPORTS.md) for the source contract, native CLI and receiving course.

## Publish a saved Chemistry report with other scientific studies

A completed Chemistry report can now become an original source in **Scientific Reports**. This preserves the saved analysis and its report edition, then uses the same ordered composer, PDF/HTML renderer, source archive and reopening controls as other scientific studies.

1. Open **Saved scientific reports** in Reach chemistry and inspect the completed original report.
2. Select **Prepare source for scientific reports**. The existing queue runs `chemistry.report.source.prepare` with the saved `report_id`; it reuses the original result and retains its figures, complete tables, scientific report members, editable project and source provenance.
3. Open the completed task's **Open scientific report** control, or use the matching entry under **Sources for scientific reports**.
4. The existing composer receives the exact source collection and entry, appends it once after any already selected sources and preserves the current report title and contact. Preview the ordered report, prepare its PDF/HTML/data package and reopen the same saved edition through the original report controls.
5. Use **Inspect retained source** to inspect its original report/run IDs, scientific figure and companion counts, collection/entry identity and authenticated downloads. **Open original saved report** and **Open original analysis** return to those original records.

The existing desk and completed-task controls both verify the selected workspace and the returned source record before opening the composer. A delayed response from a previous workspace or superseded action is discarded. The per-workspace editor remains retained by the existing Chemistry host.

### Queue, read and native APIs

The original Chemistry dispatcher and CLI accept these additive actions:

```json
{"action":"chemistry.report.source.prepare","payload":{"report_id":"<saved report ID>"}}
{"action":"chemistry.report.source.get","payload":{"source_record_id":"<saved source record ID>"}}
{"action":"chemistry.report.source.list","payload":{"report_id":"<optional saved report ID>"}}
```

Use `GET /api/chemistry/report-source?workspace=<registered workspace>&source_record_id=<saved source record ID>` for the inspected source and its actual `scientific_report_selection`. The maintained host receives:

```json
{
  "workspace_key":"<registered workspace>",
  "sources":[{"source_collection_id":"<original collection>","source_id":"<original entry>"}],
  "title":"<saved report title>"
}
```

The scientific producer's exact retained-source contract is in [Chemistry report sources](../model/CHEMISTRY_REPORT_SOURCE.md). Its native records are stored in `chemistry-report-sources`; files remain in `chemistry-report-source-exports/<selection_id>`. The provider resolves their original relative descriptors against that retained directory before handing them to the existing workspace file registrar.

### Install, transfer and reopen the complete feature

Receive the complete Chemistry component plus the current Scientific Reports component. Run the existing installer:

```sh
python -B operator/install_chemistry.py --application ACTUAL_APP --source-root ACTUAL_SOURCE
```

The installer includes the producer, guide and append-only `chemistry_report_sources.json` component fragment, accepts the exact merged scientific-report predecessors and preserves independently changed source. It checks the currently installed shared publisher, figure renderer, observed-context reader and extension host without replacing them.

Whole-workspace transfer retains the original source records, source objects and report-source export directory through the existing recursive workspace inventory. Chemistry's receiving validator invokes the producer's original `verify_workspace`, so a reopened workspace checks each saved source against its original scientific report and retained members. The editable Chemistry project export remains its original project/run format; use the whole-workspace transfer to move saved report/source editions together with other scientific studies.

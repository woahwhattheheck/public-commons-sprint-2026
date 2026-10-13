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

The maintained native 0.3.0 CSV input preserves the original single-species records and also accepts explicit positive-weight component operators on one conserved basis. Keep each original record's `role` (`fit` or `holdout`) and `qualifier` (`equal`, `below` or `interval`). Interval rows retain `lower_mg_l`, `upper_mg_l`, `lower_closed` and `upper_closed` and omit the point `mg_l`; both endpoint flags are explicit. Supply the original source reference and verify reach assignment, conserved basis, elapsed time origin and error scale against the retained project. Held-out records stay outside fitting. Point error summaries remain separate from interval support and standardized distance to the limits. The complete input and result fields are in [Compound and interval observations](CHEMISTRY_COMPOUND_OBSERVATIONS.md) and the [original native observation contract](../model/reach_chemistry/OBSERVATIONS.md).

The separate ASTRA-OBS12 measured-observation consumer can provide the same native request from retained measurement bindings. Its `native_payload(binding, Chemistry(workspace), case_id)` returns the original `chemistry.run` payload after matching the selected case and records. Install that consumer from its complete maintained source when using its measured-data desk; this chemistry registration does not replace the original observation intake.

## Export, transfer and continue

**Export editable project** includes the selected case, its original source files and completed analyses. The original chemistry transfer preserves source identities, companions, original manifests and selected run artifacts. Receive the ZIP through the original Sources intake, then **Receive editable ZIP**. The receiver creates its own retained case and correctly mapped native run identities, including a fitted child scenario when present.

For the whole scientific workspace, use the existing complete-workspace backup and receiving controls. The extension's receiving hook reads retained cases, run selections, checkpoints and original artifacts. Reading a case verifies its retained source objects directly; it does not create a source-view directory.

After receiving, open Reach chemistry, choose the received case, inspect a completed result page, edit one physical parameter with an explanatory reason, save the child scenario and run the intended scientific request. Prior cases and completed analyses remain available for comparison.

## Source and integration

The original REACT12 `0.1.0` distribution remains documented by its unchanged 31-member `integration/reach_chemistry/SOURCE_MANIFEST.json`. The maintained native `0.3.0` compound/interval edition is recorded separately in `integration/reach_chemistry/COMPOUND_SOURCE.json`. Its current inference, input and presentation modules share the same original transport/reaction solver, saved-workspace API and receiving workflow.

This operator continuation adds the native extension descriptor, per-workspace browser lifecycle, read-only source-reference verification, receiving hook and current installer. The original distribution installer is retained at `integration/reach_chemistry/install_chemistry_legacy.py`; the root entry point now installs through the current registry without rewriting shared server or application files.


## Saved scientific reports

Open a completed analysis and select **Prepare scientific report**. The existing queued action renders the saved result with its physical units, source provenance, fit/held-out records, convergence and supplied prior assumptions. Open the completed edition under **Saved scientific reports**. The inline report uses original authenticated file tickets; the complete ZIP opens offline with all original members and the editable project. See [Chemistry scientific reports](../model/CHEMISTRY_REPORTS.md) for the source contract, native CLI and receiving course.

## Publish a saved Chemistry report with other scientific studies

A completed Chemistry report can now become an original source in **Scientific Reports**. This preserves the saved analysis and its report edition, then uses the same ordered composer, PDF/HTML renderer, source archive and reopening controls as other scientific studies.

1. Open **Saved scientific reports** in Reach chemistry and inspect the completed original report.
2. Select **Prepare source for scientific reports**. The existing queue runs `chemistry.report.source.prepare` with the saved `report_id`; it reuses the original result and retains its figures, complete tables, scientific report members, editable project and source provenance.
3. Choose **Open this report only** on the completed task or matching saved-source row to open exactly that original source and its title. Choose **Add to current report** to append it deliberately to the existing ordered draft.
4. The existing composer receives the exact source collection and entry. Opening only this report replaces the draft source selection and title; adding preserves the draft's existing source order and title and deduplicates the incoming source. Both keep contact details. Preview the intended selection, prepare its PDF/HTML/data package and reopen the same saved edition through the original report controls.
5. Use **Inspect retained source** to inspect its original report/run IDs, scientific figure and companion counts, collection/entry identity and authenticated downloads. **Open original saved report** and **Open original analysis** return to those original records.

The current Scientific Reports module declares prepared-source selection support with `SCIENTIFIC_REPORT_SOURCE_SELECTION = 'replace-v1'`. Receive that current component before using **Open this report only**; an older composer cannot silently turn this action into an append. **Add to current report** continues to use the original append contract.

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
  "title":"<saved report title>",
  "selection_mode":"replace"
}
```

The scientific producer's exact retained-source contract is in [Chemistry report sources](../model/CHEMISTRY_REPORT_SOURCE.md). Its native records are stored in `chemistry-report-sources`; files remain in `chemistry-report-source-exports/<selection_id>`. The provider resolves their original relative descriptors against that retained directory before handing them to the existing workspace file registrar.

### Install, transfer and reopen the complete feature

Receive the complete Chemistry component plus the current Scientific Reports component. Run the existing installer:

```sh
python -B operator/install_chemistry.py --application ACTUAL_APP --source-root ACTUAL_SOURCE
```

The installer includes the producer, guide and append-only `chemistry_report_sources.json` component fragment, accepts the exact merged scientific-report predecessors and preserves independently changed source. It checks the currently installed shared publisher, figure renderer, observed-context reader and extension host without replacing them.

Whole-workspace transfer retains the original source records, source objects and report-source export directory through the existing recursive workspace inventory. Chemistry's receiving validator invokes the producer's original `verify_workspace`, so a reopened workspace checks each saved source against its original scientific report and retained members. The editable Chemistry project export remains its original project/run format; use whole-workspace transfer or the original saved Scientific Report's selected Study transfer to move report/source editions with their editable scientific history.


### Transfer the selected scientific study

Once the ordered Scientific Report is saved, its existing **Transfer editable study** action includes the exact Chemistry cases and parent history, original source objects, selected completed run, saved Chemistry report and scientific-source export. The preview lists those original record groups. Receive through the existing project-transfer controls, then reopen the original report, source and run with their unchanged IDs.

Foreign-workspace report sources retain their complete captured original documents and labeled external lineage. Original local case IDs are resolved only when the captured source belongs to the original workspace being transferred. The source resolver uses the maintained archive, capture locks and restore validation.

The complete installation, native commands and shared-owner contract are in [Chemistry Study transfer](../model/CHEMISTRY_STUDY_TRANSFER.md).


## Receive a retained source bank into the existing application

The same installer accepts a complete decoded `commons.source-bank/v1` JSON packet. This is useful when a packet retains the authored Chemistry report, Scientific Reports, selected-Study and native-observation files while the receiving application already holds the other required CLI, style and original integration members. The complete current installer declares 38 source members; the packet explicitly identifies which members it provides.

Use a coherent packet containing the matching current `operator/install_chemistry.py`. The packet's installer must be byte-identical to the executing receiver. The installer rejects a historical packet that would replace a newer running receiver. The complete current packet composes the retained PR3723 presentation with the native 0.3.0 interval source, the current receiving mode and the original corrected component fragments. Keep this source family together; a packet containing new inference must also contain its current input, presentation, guides and source manifest.

If the complete current source is already unpacked, run its installer directly:

```sh
python -B CURRENT_SOURCE/operator/install_chemistry.py \
  --application ACTUAL_APP \
  --source-bank chemistry-source-bank.json \
  --dry-run

python -B CURRENT_SOURCE/operator/install_chemistry.py \
  --application ACTUAL_APP \
  --source-bank chemistry-source-bank.json > chemistry-install-result.json
```

If only the original JSON packet is available, first recover its matching installer. Supply the packet's independently recorded SHA-256 and a new staging directory; the following bootstrap checks the complete packet identity before writing that one retained source file:

```sh
python -B - chemistry-source-bank.json EXPECTED_PACKET_SHA256 NEW_STAGE <<'PY'
import hashlib, json, pathlib, sys
packet, expected, stage = sys.argv[1:]
raw = pathlib.Path(packet).read_bytes()
if hashlib.sha256(raw).hexdigest() != expected:
    raise ValueError('Retained source-bank SHA-256 differs')
bank = json.loads(raw.decode('utf-8'))
if bank.get('schema') != 'commons.source-bank/v1':
    raise ValueError('Select the decoded original source bank')
rows = [row for row in bank['files'] if row['path'] == 'operator/install_chemistry.py']
if len(rows) != 1:
    raise ValueError('The source bank must retain exactly one matching installer')
row = rows[0]
body = row['content'].encode('utf-8')
if len(body) != row['bytes'] or hashlib.sha256(body).hexdigest() != row['sha256']:
    raise ValueError('Original installer identity differs')
root = pathlib.Path(stage)
root.mkdir(parents=True, exist_ok=False)
out = root / 'install_chemistry.py'
out.write_bytes(body)
print(out)
PY

python -B NEW_STAGE/install_chemistry.py --application ACTUAL_APP \
  --source-bank chemistry-source-bank.json > chemistry-install-result.json
```

The maintained receiver performs the complete file-level validation, Python/JSON parsing, predecessor checks, shared-source composition and atomic installation. Source banks contain decoded JSON and full UTF-8 file content; decode the original compressed transport through the existing receiving bridge before this step.

### What the receiving mode preserves

Each supplied member must have an exact unique Chemistry path, UTF-8 content, byte count, SHA-256 and regular-file mode. Unknown paths, duplicate JSON fields, repeated members and truncated or changed source are rejected. A packet can contain all 38 members or a subset accompanied by the matching receiver.

Every omitted required file must already exist as an ordinary member of the selected installed application. Its exact bytes and permissions become part of the plan under the existing extension-install lock. Missing members are reported by their actual path. The installer never fills an omitted engine from an older source packet or a neighboring checkout.

The original Scientific Reports and selected-Study dependencies are read from that same current application. The maintained Chemistry Study composer adds its exact original hooks while preserving concurrent peer integrations. Shared dependencies, inherited engines and all installation preimages are checked again before commit; the completed plan is checked once more before returning.

The result JSON identifies the source packet by its exact byte count and SHA-256, lists supplied and inherited member identities and modes, and retains the original changed-file and shared-dependency information. Keep this result with the existing native receiving operation. A repeat installation of the same coherent edition leaves unchanged files untouched. The existing complete-source `--source-root` path remains available; the two input modes are mutually exclusive.

### Inspect the actual received product

Use the same original Workspace and completed native Chemistry analyses. After installation, restart the maintained operator and open the exact saved scientific report. Inspect its rendered tables and figures, open the prepared Scientific Reports source, exercise the important preview/download controls and reopen the saved report. Then preview and receive its selected editable Study and inspect the original case, run and source lineage in the received Workspace.

Record the actual rendered version, visible findings and any first exception in the existing receiving operation. Installation receipts establish the received source edition; the rendered report and important controls establish the user-visible result.

# Transfer a Chemistry scientific report as an editable Study

The selected **Study** transfer now retains the Chemistry history behind an ordered saved Scientific Report. Open the original scientific edition, choose its existing **Transfer editable study** action, review the dependency preview, export, and receive through the original project-transfer controls.

A report made from several sources keeps their original order and each producer's existing dependencies. This Chemistry resolver activates only for a source declared by `native-chemistry-scientific-source-v1`. Original modeled results, fitted coefficients, sampling designs and prior draws remain unchanged.

## What travels

For a report source produced in the selected workspace, the Study contains:

- The exact immutable saved case and its parent chain, including original project JSON, source references and reasons for edits.
- Every original source collection and object needed by those cases, including companion files.
- The selected completed native run, request, project, numerical result, original artifacts, checkpoint and attempt history. A retained fitted child case follows its original parent and the actual `calibrated_project` in the result.
- The exact saved Chemistry scientific report, its original report identity, captured run and case, HTML, summary, complete ZIP and editable Chemistry ZIP.
- The original immutable Chemistry scientific-source record and its complete export directory: typed recipe, scientific figures, full tables, original report files, source manifest and recovery pointer.
- The ordered saved Scientific Report and its PDF, HTML, data and original source bindings through the existing Scientific Reports transfer.

The preview shows distinct Chemistry case, run, report and source-edition record groups. Shared records and files are included once by the existing transfer closure. Unrelated Chemistry runs are not discovered merely because they share a case.

The separate editable Chemistry ZIP keeps its established project/run format. Selected Study transfer preserves the larger saved-report history described here. Whole-workspace backup continues to retain all workspace collections.

## Original source identity and foreign reports

The resolver verifies the source's complete companion roster against the typed recipe, then reads the captured report, run, case, project, request and result directly from retained content-addressed objects. It checks the original immutable case hash, exact project fingerprint, native run selection, report record hash, source stamp and report artifact manifest.

If that captured workspace ID equals the receiving Study's original workspace ID, the local editable records must match the captured originals. The original source producer is located by its exact selection and committed result pointer, with recovery from the corresponding immutable record if the pointer write was interrupted.

If the report source came from another workspace, its complete captured original documents and companions remain retained. Its foreign case/run/report IDs remain labeled as external lineage; the resolver does not look for same-named local records or fabricate editable local cases.

This preserves the distinction between importing a report source into a different project and receiving an original Study workspace with its existing identity.

## Original capture and reopen

The established selected-study engine remains responsible for preview tokens, lock acquisition, staging, file modes, complete archive hashing, destination reuse and receiving. Chemistry contributes its original run, report and source-export locks. It does not introduce a second archive format or transfer queue.

All paths pass through the existing closure's regular-file and containment checks. Original artifact lengths and SHA-256 identities become part of the ordinary staged archive checks. The complete run/report/export inventories are retained; temporary files and lock files follow the maintained engine's existing exclusions.

On reopening, the same saved Scientific Report recomputes its Chemistry lineage from the received originals. The original lineage receipt must still match while new recipient work may be appended separately. The Chemistry workspace validator additionally checks saved reports and typed-source editions against their native inputs and retained files.

## Install into the current application

Receive the complete current Chemistry family, the current Scientific Reports family and the current selected-study transfer engine. Install with the existing command:

```sh
python -B operator/install_chemistry.py --application ACTUAL_APP --source-root ACTUAL_SOURCE
```

The installer includes:

```text
model/chemistry_study_transfer.py
model/CHEMISTRY_STUDY_TRANSFER.md
source_tools/chemistry_study_composition.py
integration/component_fragments/chemistry_study_transfer.json
```

It reads the actual installed `model/study_transfer.py` and `model/scientific_report_study_transfer.py`, composes the Chemistry family declarations and callbacks, parses the full Python postimages, and verifies the current preimages before replacing any file. Existing Monitoring, calibration, receiving-water, native-process, Community, Conservation, Gauge, ensemble, land-cover and other producer joins remain in those same files. Repeating the installer verifies and reuses the existing Chemistry joins.

The component fragment adds the same original helper to both Chemistry and Study-transfer source inventories. It adds no reverse component dependency or alternate shared dispatcher.

## Native API

Use actual retained IDs from the selected workspace:

```python
from pathlib import Path
from model.workspace import Workspace
from model import study_transfer

workspace = Workspace(ACTUAL_WORKSPACE, create=False)
selection = {
    "schema": "upstate.study-selection/v1",
    "title": "Chemistry scientific study",
    "roots": [{"kind": "scientific-report-editions", "id": SAVED_SCIENTIFIC_EDITION_ID}],
    "include_related_results": False,
}
preview = study_transfer.preview(workspace, selection)
result = study_transfer.export_study(workspace, Path(OUTPUT_ARCHIVE), selection)
```

Receive that archive through the existing maintained project-transfer route. Against the received original workspace:

```python
from model import study_transfer, chemistry_reports, chemistry_report_source

receipt = study_transfer.verify_received_studies(received_workspace)
report = chemistry_reports.inspect(received_workspace, ORIGINAL_CHEMISTRY_REPORT_ID)
source = chemistry_report_source.inspect(received_workspace, ORIGINAL_SOURCE_RECORD_ID)
```

Reopen the same scientific edition, original Chemistry report and native run in their existing controls. The archive and receipt supply the concrete original IDs; the example does not invent a new run or source.

## Shared-owner composition contract

`model.chemistry_study_transfer` supplies:

- `IMMUTABLE_KINDS`, `DOCUMENTS`, `LOCKS` and `LABELS` for the existing closure.
- `visit(closure, kind, key, value, reason)` before the generic immutable-record branch.
- `lock_paths(closure)` for the original source-export locks.
- `include_source(closure, collection_id, entry)` after the ordered source's original binding has been validated.

The helper imports only `model.common` and the Python standard library. Reading a completed Study does not import the Chemistry solver, run a model or render a new report.

`source_tools.chemistry_study_composition.compose(sources)` returns complete postimages for the two currently installed shared modules. It uses their actual syntax tree to locate declarations and function boundaries, preserves peer callbacks, and rejects partial or ambiguous prior Chemistry joins. The shared transfer owner may apply the same declared callbacks directly; the installer recognizes the exact maintained composition emitted by this helper.

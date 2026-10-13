# Gauge reports in editable Study transfers

The existing scientific-report Study export now carries the original saved Gauge support analysis behind an explicitly selected report source. The receiving Workspace can reopen the selected scientific report, its saved Gauge edition, the linked Station Geography result, and its regional watershed context with the original source bytes and selections.

This is the continuation of the maintained Gauge support family: the whole-catchment source remains its existing edition, alternate indexed or coordinate-based upstream support retains its own original method and flags, and the direct HTML/PDF/ZIP report producer remains unchanged. The selected report's ordered source list is the input to this transfer. No geographic calculation, source acquisition, model run, or report render is repeated by the adapter.

## Operator course

1. In the existing Workspace, open a saved **Gauge support** edition. Review its original source method, selected regional HUC12s, utility scope, station IDs and daily-flow coverage.
2. Use **Compose scientific report**. The maintained composer receives the exact imported Gauge report source and preserves the order of any existing draft sources.
3. Save and render the scientific report through the existing scientific-report operation. Select that saved scientific-report edition in the ordinary editable **Study** transfer.
4. Preview the original dependency closure. It includes the saved scientific report and the original Gauge, station and regional records described below.
5. Export the selected Study to a new archive path. The existing capture path freezes the original records and report capture under their maintained locks, verifies retained members, and writes its ordinary portable archive.
6. Receive that archive through the maintained Study/Workspace receiving operation into a separate destination. Open the saved scientific report, then the original Gauge support and Station Geography editions. The selected regional report and its local original-source copies reopen with them.

A Gauge source imported from a different project remains a self-contained scientific source. Its captured original package, analysis, source manifests, companion bytes, maps and station archive travel with the selected scientific report. The receiving project does not look up foreign Gauge or station IDs in its own saved-record directories.

## Original identity and source closure

| Retained layer | Binding used by this adapter |
| --- | --- |
| Scientific report | Existing saved report ID and its ordered source choices |
| Imported Gauge report source | Original collection ID, source ID, body SHA256, source URI and declared producer edition |
| Gauge report recipe | Original project, Gauge ID/build, Station Geography ID, regional report reference, selection and summary |
| Gauge support calculation | Original version, ordered source identities, selected scopes, regional result and Station Geography build |
| Source geometry and daily coverage | Original collection/source IDs, complete source-entry metadata, body and ordered companion descriptors |
| Station Geography | Original immutable saved record, source selections, observations, spatial source collection and portable station ZIP |
| Regional watershed context | Original report ID, result SHA256, source fingerprint, selected source edition and full local receiving tree |
| Native Gauge report capture | Original registered capture, exact recipe and companion bytes, retained render products if already present |

The adapter reconstructs the original Gauge build identity from the original saved calculation. It compares each packaged source manifest and its original body/companion descriptors with the calculated source bindings. The original station ZIP captured by Gauge must match the saved Station Geography archive. The regional result captured by Gauge must match the saved regional report bytes; a later source-edition append is allowed only when the original selected edition is still retained by that report.

All reporting, upstream and utility scopes remain separate. Original whole-catchment, indexed split-catchment and coordinate-based drainage-basin support retain the saved support metadata and boolean request flags. Point-outside-own-basin relationships, overlapping/nested areas, complete or partial daily coverage, qualifier counts, dates and original units are unchanged.

For same-project sources, the original Gauge and station immutable records retain their identifiers. The regional report retains its maintained operator record and local source copies. Portable source collection entries retain their CAS objects, imported original manifest and all companion bytes through the existing Study source visitor.

## Maintained Python interface

The adapter is called by the existing scientific-report source dispatcher. It is not a second export engine.

```python
from model import gauge_study_transfer

# Inside scientific_report_study_transfer._source, after its existing validation:
gauge_study_transfer.include_source(closure, collection_id, entry)

# Inside the maintained study_transfer._capture_locks implementation:
# Add these original producer locks to the same existing capture lock loop.
gauge_study_transfer.lock_paths(closure)
```

`include_source` returns false for another report producer and leaves its existing dispatcher route in place. For a declared Gauge source, it validates and adds the original dependency closure, then records one lineage binding in `closure.report_source_records`. The existing selected-Study receipt and receiving verification consume those records.

The adapter imports only Python's standard library and `model.common` at module import time. It does not import the GIS stack, Gauge producer, station engine, Workspace class or portable writer. This keeps original selected-report inspection available on a source-only receiving interpreter.

### Use the established Study API

An equipped receiver can use the already-maintained API against an actual saved scientific-report ID:

```python
from model.workspace import Workspace
from model import study_transfer

workspace = Workspace("/absolute/existing/workspace")
selection = {
    "schema": "upstate.study-selection/v1",
    "title": "Selected regional gauge scientific report",
    "roots": [
        {"kind": "scientific-report-editions", "id": actual_saved_report_id}
    ],
    "include_related_results": True,
}
preview = study_transfer.preview(workspace, selection)
result = study_transfer.export_study(
    workspace,
    "/absolute/new/selected-gauge-study.zip",
    selection,
)
received = study_transfer.inspect_transfer_archive(result["path"], verify=True)
```

Use the actual report ID returned by the saved scientific-report operation. The archive destination must belong to this same selected Study; the existing writer can reuse a completed identical export. Original Workspace and Study receiving controls remain the route for independent restore and subsequent edits.

## Capture locking and concurrent work

The generic Study writer already holds the original Workspace lock while resolving the closure. That protects the regional operator report and its appended source-edition state. Saved Gauge and Station Geography records and their original package members are immutable.

A Gauge report source may already have direct rendered report products under its original native report-capture directory. `lock_paths` returns the exact `locks/gauge-report-<operation-id>.lock` used by that capture's producer. The generic writer acquires it through the same existing lock loop and resolves the closure again before staging files. It does not acquire the Workspace lock recursively.

The adapter adds only the selected native report capture, together with the complete original Gauge saved/package members. It does not sweep every later report-capture directory under the Gauge build. The original Station Geography and regional trees remain complete because they hold their original receiving/source closure.

## Current component composition

This continuation adds:

- `model/gauge_study_transfer.py`
- `model/GAUGE_STUDY_TRANSFER.md`
- `integration/component_fragments/gauge-study-transfer.json`

The fragment includes these paths under **gauge-support**, **study-transfer**, and **scientific-report-editions**. This makes the additive helper available whenever the shared scientific-report dispatcher imports it, even if the operator Gauge desk was not selected as a separate component. It adds no dependency back from scientific-report-editions to Gauge or ensemble components, so the maintained component graph remains acyclic.

The shared source dispatcher and capture-lock composition are maintained by the existing Study transfer owner. Receive their current complete `model/scientific_report_study_transfer.py` and `model/study_transfer.py` together with this helper. Preserve their other producer routes, Community/Conservation additions, native-process lineage and original transfer verification.

The complete Gauge source bank also retains the maintained native receiving recovery, current support-source choices, direct scientific reports and composer. These existing paths remain unchanged by this adapter: `model/gauge_support.py`, `model/gauge_report_context.py`, the Gauge provider/descriptor/client/CSS/installer/guide, `source_tools/receive_gauge_support.py`, its recovery guide, and the scientific-composer fragment.

## Resolving an actual receiving exception

The original error identifies the missing or changed member. Resolve it against the same source project and retained package:

- A missing same-project immutable Gauge or station record means the source-only report was received without its original editable closure. Receive the existing original Workspace/selected Study or use the source as an external-project capture in a different project; do not create substitute IDs.
- A changed regional fingerprint or absent selected source edition means that the exact original regional report must be retained beside its newer edition.
- A mismatched source body, companion descriptor or station ZIP means the transferred originals differ from the saved calculation. Recover the exact existing source member from its package.
- A busy native report lock means its existing render/export owns the capture. Continue the same Study export when that operation completes.

The original selected Study identity, ordered scientific sources and captured source values remain the same through repair and independent reopen.

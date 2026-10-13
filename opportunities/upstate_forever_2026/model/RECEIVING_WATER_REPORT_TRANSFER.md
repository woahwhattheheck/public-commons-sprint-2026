# Receiving-water reports in editable Study transfer

TokenJunkieLabs. This integration extends the existing selected scientific-report edition workflow. It retains the exact saved report and its original receiving-water study; it does not prepare geography, run a native model, or render a replacement report.

## Open, select and transfer

1. In Receiving waters, select a completed source plan or completed receiving-water analysis and prepare its scientific report source.
2. Open that source in the scientific report composer. Keep the desired source order and save the completed report edition.
3. Open the existing Study transfer workflow from that saved edition. Preview its original dependency inventory, then export through the maintained transfer queue.
4. Receive the archive using the existing editable Study receiver. The received saved report keeps its original edition ID, output files, source order and source bindings. A report produced in this project also retains the original receiving-water plan and, when selected, the completed analysis.

The standalone report producer is described in [RECEIVING_WATER_REPORT_SOURCE.md](RECEIVING_WATER_REPORT_SOURCE.md). The shared edition workflow is described in [SCIENTIFIC_REPORT_STUDY_TRANSFER.md](SCIENTIFIC_REPORT_STUDY_TRANSFER.md). Use those maintained controls and commands; this component has no separate archive format, controller or native operation.

## What travels with the report

| Selected original source | Retained editable history |
| --- | --- |
| Source-plan report from this project | Original immutable plan, projected geometry files, original source collections, explicit contextual references such as intake records, and the completed report capture |
| Completed-analysis report from this project | Everything above, plus the exact original analysis, grid and baseline/alternative run cohort followed by the existing receiving-water dependency visitor |
| A copy reimported into this same project | The selected source collection remains in the report edition; the original capture's source collection is retained separately so the original producer can reopen its saved record |
| Report imported from another project | The exact recipe, complete original companions and source identities remain self-contained. Foreign plan/run IDs are not resolved as local editable studies |

A source-only plan needs no model grid or native run unless its original saved selection explicitly contains one. Completed analyses follow the existing native dependency engine, which retains the original grids, profiles, scenarios and run outputs. The adapter does not substitute current model versions or recalculate physical quantities.

The original geography distinctions remain in the captured plan: published source polygon, explicit geometric context and retained HUC association. Original feature attributes, recorded geometry interpretation, source vintages, native feature IDs and contextual intake references travel unchanged. The original report's numerical tables preserve units, valid support, normalization and family aggregation through their existing captured source.

## Explicit source identity and compatibility

The maintained producer writes entry role `receiving-water-report-source`, source ID `receiving-water-scientific-report` and a verified `upstate.observed-report/v1` recipe whose `report_context_kind` is `receiving-water-scientific-study`.

New source entries also carry these explicit metadata keys:

- `report_context_kind`: the receiving-water context name.
- `report_source_id`: the original immutable dossier capture ID.
- `project_id`: the original project identity.

Sources created before those additive metadata keys remain supported. They must retain the exact original source ID, role, report schema, recipe context, project and canonical producer URI. Every metadata key that is present must agree with the retained recipe and capture. Recognition never guesses from a filename or a title.

The URI has the producer's existing form `urn:upstate:receiving-water-report:<project-id>:<capture-id>`. For a local study, the capture ID must equal the digest of its full original capture identity. The capture pins the plan record and optional analysis record, selected original source entry identities and the exact capture implementation.

A same-project copied source can have a different collection ID. Its source ID, role, title, vintage, URI, typed metadata, recipe body and complete companion names/bytes/hashes must agree with the original captured source. The lineage receipt records the selected collection and the original `capture_source` separately. This permits ordinary source archive reimport without inventing or replacing native record IDs.

## Original and geographic report editions

Original `receiving-water-report-source/1` captures keep their exact original implementation roles: `producer` and `plan_reader`, plus `exporter` and `scientific_formatter` for a completed analysis.

The maintained geographic edition `receiving-water-report-source/2` retains those roles and adds exactly `map_capture`, `map_renderer` and `scientific_figures`. Its `figures/source-map-spec.json`, paged overview SVGs and per-water SVGs are ordinary original recipe companions with exact byte/hash descriptors. They are retained through the same source and dossier inventory; transfer neither draws a new map nor substitutes a later geometry renderer. The recipe edition must match the immutable capture identity. Both editions remain readable after receiving.

Completed-analysis captures made with the maintained catchment-accounting report formatter also retain `accounting_formatter`, the exact captured `client_receiving_waters.py` body. The adapter accepts precisely either the original seven geographic analysis roles or those seven plus this eighth role. Its `implementation/accounting_formatter.py` companion must match the checksum pinned by the immutable capture, and it travels in the same exact declared source inventory. This compatibility addition applies only to completed-analysis `/2` captures; original `/1` captures and source-only `/2` captures keep their existing role sets. Unknown, missing or mismatched implementation roles still fail validation. Saved captures retain their original identities and formatter bodies.

## Source closure and cold receiving

The adapter reads retained CAS objects through the existing closure `read` and `add_file` methods. It does not call `Workspace.source_file`, the report producer's `inspect`, or report binding functions that create source-view hardlinks. This preserves the transfer engine's original file-identity checks on a cold Workspace.

Validation includes:

- Every recipe input and every original companion must have one canonical relative name and matching byte length and SHA-256.
- The plan and optional analysis must be complete, retain their original project, match their immutable identity/record digests, and retain every declared geometry/raster member.
- The completed-analysis export inventory must pin those exact plan and analysis records and retain all of its declared members.
- The original source register must match all geometry source identities and all explicit selectors found in the original plan selection and receptor context. Each retained collection, selected entry, original manifest and complete source body/companions must agree.
- Local captures must retain their original `report.json`, fixed intent, prepared source, import manifest, report recipe, implementation and exactly declared native/source members. Their original source selector is queued as a dependency.
- The original editable native records must equal the captured records. The existing water dependency visitor remains responsible for their full native run/grid/input closure.

Only the completed capture's declared members are selected. Temporary files and unfinished sibling report captures are not added. The adapter performs no writes and does not acquire a new lock. Original native plan/analysis locks and the transfer engine's read/stage identity checks remain authoritative.

## Maintained integration contract

The owned module is `model/receiving_water_report_transfer.py`. Its entry point is:

```python
include_source(closure, collection_id, entry) -> bool
```

It returns `False` for another producer. For a recognized source it validates the complete source, queues same-project original dependencies, registers one binding in `closure.report_source_records[(collection_id, entry["id"])]`, and returns `True`. Conflicting repeated bindings raise an error.

The shared owner calls it only from `scientific_report_study_transfer._source`, after validating the explicitly ordered saved-edition source and calling `closure.need("sources", collection_id, ...)`:

```python
from . import receiving_water_report_transfer
receiving_water_report_transfer.include_source(closure, collection_id, entry)
```

The generic source-collection visitor remains unchanged. Unrelated entries in a collection do not acquire new receiving-water dependencies merely because another source is selected.

The existing `upstate.study-report-lineage/v1` receipt records original source and project identities, capture ID, plan/analysis record digests, local/foreign relationship, local capture record digest and original source selector. Existing shared receipt verification checks it after receiving; there is no additional receipt format.

The additive component fragment `integration/component_fragments/receiving-water-report-transfer.json` joins this module and guide to the existing Receiving-water report and Study transfer families. It preserves the global catalogue and all peer fragments. The shared edition dispatcher is maintained by the scientific-report transfer owner and must include the call above when composing this component.

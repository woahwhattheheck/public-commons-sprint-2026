# Internal ECO sprint handoff — ASTRA-DESIGN12

## Product lane

Editable field geometry and explicit scenario input authoring, complementary to C79F's maintained workbench renderer, ECD1's scenario/experiment tools, and existing dataset/parameter/result inspection. Additive root `scenario-design/`; no original core file is replaced.

Private source coordination: `C0BTTA66TK3`, original thread `1791724121.853269`. Current conservation consumer: `F0C8RR36873`; exact source importer helper: reply `1791851148.768209`. The separate earlier field-factor contract is ECO v5 canvas `F0C8F3MKR3M`. This package contains no customer datasets or model outputs. The included acceptance fixture is explicitly authored for editor interaction and adapter IO.

## Entry points

- `server.py`: loopback local editor, SQLite revision store, complete project receiving/export, native-plan HTTP route.
- `engine.py`: original collection/provenance, topology and area validation, alternative realization, complete deterministic handover.
- `conservation.py`: original saved-plan intake, exact binding retention, complete geometry/code handover and original Upstate import_sources → save_scenario → prepare_run registration.
- `CONSERVATION.md`: complete current-product receiving and CLI/Python composition.
- `eco_bridge.py`: explicit native factor compilation, source-bound original-writer registration, complete independent geometry-edition receiving.
- `web/`: original offline HTML/CSS/JS editor. No third-party browser assets or build tooling.
- `README.md`: operator and integration commands.

The useful first composition is a navigation entry to the editor, a native `fields` dataset import, then the native plan/receiving flow. The original experiment runner keeps covariance, independent evaluation and cohort comparison semantics. Geometry-edition dataset IDs explicitly differ from their source; existing unrelated original scenarios are not relabeled over changed geometry.

## Completed checks

The native design export → receive → independently edit → re-export journey passes. The actual Chromium DOM and app JS, with Python HTTP transport to the running editor, performs field import, alternative creation, factor binding, vertex drag, polygon drawing, saved revision, complete download, independent receiving, further factor edit, and sender-preservation check with zero page exceptions. Native bridge IO checks cover maintained v5 action serialization, idempotent original registration, full receiving and unchanged source files/parameters. Direct browser navigation and full installed ECO modeling dependencies are separate from those checks, as detailed in README.

Two defects found through complete workflows were repaired: JSON object-key ordering in action-ledger regeneration, and integer-valued float canonicalization across browser JSON saving. These fixes preserve project reopening and provenance checks rather than relaxing baseline immutability.

## Current conservation composition

The editor receives the original conservation binding and retains its complete source_reference, selected-unit records, native assets and scientific contract inside its immutable baseline. The original saved projected-plane area fields remain alongside explicitly labeled geodesic display measurements. Current native registration is `conservation.register_landcover`, called inside the original operator task/lock path or from its provided idle-Workspace CLI. Every original and edited source file and companion enters the original `upstate.sources/v1` importer. Only the original save_scenario/prepare_run methods write scientific records; no separate queue is introduced.

The original-source browser intake preserves exact bytes, including UTF-8 BOMs and source numeric representation. Full browser import/edit/native-handover/independent-receive is exercised through the actual HTTP server; current native registration is an explicit published-interface journey, not a full scientific execution.

## Earlier v5 field-factor dependency

The bridge imports the operator-selected original `model/workspace.py` and `model/scenarios.py`; it does not vendor a competing Workspace. `put_scenario` and scenario conversion are the maintained writers. The adapter recognizes native `set_factor`, `fields`, `id` and `field_id` contracts. Geometry is a separate materialized input dataset, not an invented action kind.

## Throughput completion

Content-keyed geodesic/topology summaries eliminate repeated geometry work across alternatives while validating every changed coordinate payload. The complete 2,500-field / six-alternative save/export/receive/independent-edit/native-plan workflow fell from 21.129 to 8.690 seconds in separate Python processes. The native HTTP health response exposes cache counters. Full before/after stages and environment are in `PERFORMANCE.json`; the workload is reproducible through `tools/capacity_journey.py`.

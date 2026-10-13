# Deliver and reopen a Climate forcing study

This continuation uses the existing **Study delivery** workspace archive, its
original upload/restore queue, and the existing **Climate forcing** desk.
It adds the typed root `climate-forcing-studies`; it does not introduce another
archive format or a model execution engine.

Follow `CURRENT_OWNER_DIRECTION.md` version 2026-10-13.4 and its current
successors. Preserve the actual model owner and active native work. The delivered
application and every outgoing attachment must be opened, inspected and used in
the recipient's desktop and narrow layout, then reopened from the actual received
application. A source review or compile is not a completed native or browser course.

## Scientific workflow

1. In Climate forcing, choose the completed original baseline and the retained
   spatial forcing editions. Review their original units, period, resolution and
   source identity. Keep the actual profile's fixed or automatic NDR mean explicit.
2. Prepare the study and execute selected alternatives through the original native
   queue. The original baseline remains completed. SDR rainfall erosivity changes
   only when independently selected; annual precipitation never manufactures R.
3. Save the common-support annual mass report. Inspect the source-period choices,
   preflight means, actual retained NDR intermediates where present, signed mass
   differences, common finite areas and independent totals. Uniform automatic-mean
   runoff scaling can yield a valid zero response.
4. In Study delivery, select **Climate forcing studies** and the original saved
   study. Read the dependency preview and its actual file/byte totals. Other
   original study roots may be selected in the same existing archive.
5. Export once the original native owner is at an available boundary. Study
   capture uses the existing nonblocking Workspace, native-run, grid and family
   locks. An active original owner produces a normal retryable busy result;
   this operation neither interrupts a calculation nor creates another worker.
6. Restore through the original receiving flow into a new destination. Open the
   received study through the existing Climate forcing desk. The receiving
   Workspace keeps the original project, study, source, case and run identities.
7. Inspect the complete received report and downloads, reopen the original source
   selections and native cases, and perform the copied-application cold reopen
   below. Continue only genuinely unfinished alternatives through the original
   native queue.

## What the selected archive retains

The typed closure retains the immutable selection and current preparation
checkpoint; all original baseline and prepared-case grids, profiles, scenarios
and native run trees; complete original source collections and ordered companions;
and planned forcing/reporting source editions even when a case has not yet been
prepared. It retains the original source-composition manifest when present.

For each selected report it retains the original snapshot, complete immutable
record when available, HTML/CSV/JSON, numerical-pair cache, source manifest,
native-output and difference maps when requested, original arguments, report ZIP
and all declared companions. Interrupted report directories retain their existing
files and original snapshot for ordinary resumption. No report or map is rendered
during transfer.

The existing archive retains each source object and shared native dependency once.
Its maintained application-source closure travels with the study. Native run
visitors also retain actual producing-stage donor dependencies, where present.

The study receipt's `identity.climate_forcing_studies` records the exact prepared
case identities and captured report-directory membership. Verification of an older
receipt does not discover reports created later. Completed report records and
snapshots retain exact byte/SHA identities. Original pending work may continue
after receiving; the archive never declares that unexecuted alternatives completed.

## Existing developer/API entry point

The standard selection remains `upstate.study-selection/v1`:

```python
selection = {
    "schema": "upstate.study-selection/v1",
    "title": "Selected annual forcing study",
    "roots": [{"kind": "climate-forcing-studies", "id": study_id}],
    "include_related_results": True,
}
plan = study_transfer.preview(workspace, selection)
result = study_transfer.export_study(
    workspace, destination,
    {**selection, "preview_token": plan["preview_token"]},
)
```

The actual signature is **workspace, destination, selection**. Reusing an already
completed destination with the identical original project and selection reopens
that archive. Use a deliberate new destination to export a later edition.

The new helper exposes the normal typed-transfer constants plus
`visit`, `lock_paths`, `catalogue`, `receipt` and `verify_receipt`.
It composes the original dependency visitors, metadata/file-size preview,
owner-lock union, stable staging and portable ZIP writer. Large scientific
rasters are not repeatedly hashed during catalogue or preview; the original
archive writer authenticates the actual staged bodies.

## Concrete native export and receiving

For an equipped technical owner, use actual retained paths and the actual study
ID returned by Climate forcing. These commands create no native model run.

```bash
python3 - "$APPLICATION" "$WORKSPACE" "$STUDY_ID" "$STUDY_ZIP" <<'PY'
from pathlib import Path
import json, sys
sys.path.insert(0, sys.argv[1])
from model.workspace import Workspace
from model import study_transfer
ws = Workspace(sys.argv[2], create=False)
selection = {
    "schema": "upstate.study-selection/v1",
    "title": "Selected annual forcing study",
    "roots": [{"kind": "climate-forcing-studies", "id": sys.argv[3]}],
    "include_related_results": True,
}
plan = study_transfer.preview(ws, selection)
result = study_transfer.export_study(
    ws, Path(sys.argv[4]), {**selection, "preview_token": plan["preview_token"]})
print(json.dumps(result, ensure_ascii=False, indent=2))
PY
```

Restore into a new directory using the existing portable reader:

```bash
python3 - "$APPLICATION" "$STUDY_ZIP" "$NEW_RECEIVING_DIRECTORY" <<'PY'
import json, sys
sys.path.insert(0, sys.argv[1])
from model import portable
result = portable.restore(sys.argv[2], sys.argv[3])
print(json.dumps(result, ensure_ascii=False, indent=2))
PY
```

Then use the **application inside that actual received directory**, in a new
process, to verify the original selected-study receipt and native forcing state:

```bash
python3 - "$NEW_RECEIVING_DIRECTORY" "$ORIGINAL_PROJECT_ID" <<'PY'
from pathlib import Path
import json, sys
root = Path(sys.argv[1])
sys.path.insert(0, str(root / "application"))
from model.workspace import Workspace
from model import study_transfer, climate_forcing
ws = Workspace(root / "workspace", create=False)
if ws.project["id"] != sys.argv[2]:
    raise ValueError("The receiving project differs from its original identity")
result = {
    "project_id": ws.project["id"],
    "study_receipts": study_transfer.verify_received_studies(ws),
    "forcing": climate_forcing.verify_all(ws),
}
print(json.dumps(result, ensure_ascii=False, indent=2))
PY
```

For a completed saved report, the copied application's maintained CLI also opens
the exact original study/report and verifies its source/download members:

```bash
python3 "$NEW_RECEIVING_DIRECTORY/application/source_tools/climate_forcing_study.py" \
  --workspace "$NEW_RECEIVING_DIRECTORY/workspace" \
  reopen --study "$STUDY_ID" --report-id "$REPORT_ID" \
  --expected-project "$ORIGINAL_PROJECT_ID"
```

If no report has completed yet, use `show` or `verify` instead; retain the
honest pending state. The native cold-process result complements the required
actual browser, report, map, table and archive inspection. Keep the produced
receipt IDs, archive SHA, original project/study/report IDs and actual application
paths with the same receiving operation.

"""Receive retained native parameter studies through a complete project transfer.

Run after the selected native scientific operation has retained its current
result. This course reopens the original studies; it does not execute new cases.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import traceback

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model.common import held, identifier
from model import parameter_studies
from model.project_transfer_workspace import NativeProjectTransfer
from model.workspace import Workspace
from source_tools.receive_implementation import (
    identity, now, read, write, _capture, _checkpoint, _separate,
)

SCHEMA = "upstate.parameter-study-native-course/v1"
CODE = (
    "source_tools/receive_parameter_studies.py",
    "source_tools/receive_implementation.py",
    "model/parameter_studies.py", "model/parameter_exports.py",
    "model/portable_parameter_studies.py", "model/project_transfer.py",
    "model/project_transfer_workspace.py", "model/portable.py",
    "model/workspace.py",
)


def _selection(workspace, requested, path):
    requested = None if requested is None else sorted(set(identifier(key) for key in requested))
    if requested == []:
        raise ValueError("Select at least one original saved parameter study")
    previous = read(path) if path.exists() else None
    if previous is not None:
        if (previous.get("schema") != SCHEMA
                or previous.get("workspace") != str(workspace.root)
                or previous.get("project") != workspace.project
                or previous.get("requested_study_ids") != requested):
            raise ValueError("The receiving operation already names another original study selection")
        return previous
    records = parameter_studies.list_experiments(workspace)
    available = {row["id"] for row in records}
    selected = sorted(available) if requested is None else requested
    if not selected or set(selected) - available:
        raise ValueError("Choose original saved parameter studies in this Workspace")
    value = {"schema": SCHEMA, "workspace": str(workspace.root),
             "project": workspace.project, "requested_study_ids": requested,
             "study_ids": selected}
    write(path, value, immutable=True)
    return value


def _reopen(workspace, selected, original):
    """Join public native inspection to the frozen study/specification identity."""
    rows = []
    for key in selected:
        state = parameter_studies.inspect(workspace, key)
        captured = original[key]
        specification = identity(workspace.root / captured["selection_file"]["path"])
        if specification != {field: captured["selection_file"][field] for field in ("bytes", "sha256")}:
            raise ValueError("The receiving study now names another original specification: " + key)
        if (state["id"] != key or state["selection"]["baseline_run_id"] != captured["baseline_run_id"]
                or state["baseline_selection"] != captured["baseline_selection"]):
            raise ValueError("Reopening changed the original native study selection: " + key)
        rows.append({
            "id": key, "title": state["selection"]["title"],
            "state": state["state"], "progress": state["progress"],
            "comparison_id": state.get("comparison_id"),
            "baseline_run_id": state["selection"]["baseline_run_id"],
            "models": state["models"], "pollutants": state["pollutants"],
            "cases": [{"id": row["id"], "run_id": row["run_id"],
                       "profile_id": row["profile_id"], "state": row["state"]}
                      for row in state["cases"]],
            "open_saved_study": {"workspace": str(workspace.root), "study_id": key},
        })
    return rows


def _exports(workspace, selected, original):
    """Locate captured exports and show their actual current receiving-file status."""
    result = []
    for key in selected:
        for label, descriptor in original[key]["artifacts"].items():
            captured = descriptor.get("captured_file")
            path = workspace.root / descriptor["workspace_path"]
            current = identity(path) if path.exists() else None
            captured_identity = ({field: captured[field] for field in ("bytes", "sha256")}
                                 if captured is not None else None)
            result.append({
                "study_id": key, "label": label, "path": str(path),
                "original_descriptor": descriptor,
                "captured_file": captured,
                "current_file": current,
                "current_receiving_state": (
                    "matched" if current is not None and current == captured_identity
                    else "missing" if current is None else "changed"),
                "archive_member": "workspace/" + descriptor["workspace_path"],
            })
    return result


def run(workspace_path, operation, *, study_ids=None):
    workspace_path = Path(workspace_path).expanduser().resolve(strict=True)
    root = Path(operation).expanduser().resolve()
    _separate(root, workspace_path, "Receiving operation and original Workspace")
    _separate(root, APPLICATION, "Receiving operation and installed application")
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".receiving.lock", blocking=False):
        workspace = Workspace(workspace_path)
        selection = _selection(workspace, study_ids, root / "selection.json")
        state_path = root / "state.json"
        state = read(state_path) if state_path.exists() else {
            "schema": SCHEMA, "operation_id": "PARAMETERS:" + hashlib.sha256(
                str(root).encode("utf-8")).hexdigest(), "created_at": now(),
        }
        code = {relative: identity(APPLICATION / relative) for relative in CODE}
        state.setdefault("code_editions", [])
        if not state["code_editions"] or state["code_editions"][-1]["files"] != code:
            state["code_editions"].append({"application": str(APPLICATION),
                                           "observed_at": now(), "files": code})
        def checkpoint(phase, **values):
            _checkpoint(root, state, phase, **values)
        try:
            transfer = NativeProjectTransfer(workspace, root / "transfer")
            capture = _capture(transfer, root, state, checkpoint)
            snapshot = capture["snapshot"]
            retained = snapshot["archive"].get("parameter_studies")
            if (not retained or retained.get("schema") != "upstate.parameter-study-receiving/v1"
                    or retained.get("workspace_id") != workspace.project["id"]):
                raise ValueError("Use the complete current application's original parameter-study transfer")
            original = {row["id"]: row for row in retained["studies"]}
            if set(selection["study_ids"]) - set(original):
                raise ValueError("The captured project is missing a selected original study")
            write(root / "captured-studies.json", {
                "schema": retained["schema"], "workspace_id": retained["workspace_id"],
                "snapshot_id": capture["snapshot_id"],
                "studies": [original[key] for key in selection["study_ids"]],
            }, immutable=True)
            checkpoint("receiving", selected_studies=selection["study_ids"],
                       receiving_directory=str(root / "received"))
            received = transfer.restore(capture["snapshot_id"], root / "received",
                progress=lambda row: print(json.dumps(row, default=str), flush=True))
            if received.get("parameter_studies") != retained:
                raise ValueError("The native receiving result differs from the frozen original studies")
            restored = Workspace(received["workspace"])
            checkpoint("reopening_studies")
            reopened = _reopen(restored, selection["study_ids"], original)
            exports = _exports(restored, selection["study_ids"], original)
            # Restoring completes original archive verification. Hash selected
            # export downloads here as well because later recipient edits are
            # deliberately preserved when a completed course is reopened.
            result = {
                "schema": SCHEMA, "state": "complete", "completed_at": now(),
                "operation": str(root), "source_workspace": str(workspace.root),
                "project": restored.project, "snapshot_id": capture["snapshot_id"],
                "archive": capture["archive"], "receiving": received,
                "original_studies": [original[key] for key in selection["study_ids"]],
                "reopened_studies": reopened, "exports": exports,
                "captured_studies_file": str(root / "captured-studies.json"),
                "reused_receiving": bool(received.get("reused")),
            }
            write(root / "receiving.json", result)
            checkpoint("complete", result=str(root / "receiving.json"),
                       reopened_studies=len(reopened), export_files=len(exports))
            return result
        except Exception as exc:
            state.update(phase="failed", updated_at=now(),
                         error={"type": type(exc).__name__, "message": str(exc)})
            write(root / "state.json", state)
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--study-id", action="append", dest="study_ids",
                        help="Original saved study ID; repeat to select several, omit for all currently saved studies")
    args = parser.parse_args(argv)
    try:
        result = run(args.workspace, args.operation, study_ids=args.study_ids)
    except Exception:
        traceback.print_exc()
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

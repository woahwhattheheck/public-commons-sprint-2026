"""Receive an original Implementation plan through a complete native Workspace.

Run from a fixed cumulative application checkout. Reuses the native Implementation,
report and Project transfers APIs; the original Workspace is required.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import sys
import traceback

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model.common import held
from model.implementation import ImplementationStore, _atomic_bytes, _same_json
from model.implementation_schema import read_document, document_digest
from model.portable_implementation import report_edition, verify_implementation
from model.project_transfer_workspace import NativeProjectTransfer
from model.workspace import Workspace

SCHEMA = "upstate.implementation-native-course/v1"
PLAN_ID = "greenwood-original-parcel-source-review-20261013"
ORIGINALS = {
    "plan": (
        "source/implementation/20261013/greenwood-review-plan.json",
        89214, "28ace942d3dcf9f32b10e3f51fcc5a90e31cb371dd0e6712c97992e9382583a8"),
    "parcel": (
        "source/keowee-native-receiving-20261013/greenwood-native-feature.json",
        1709, "e4fd893f7ab655d1a9fd8e2944d9122a7786abb26d55ec85310b04ed39f49fab"),
    "source_interval": (
        "source/keowee-native-receiving-20261013/source-interval-journey.json",
        60852, "864d7d51bf0893d1c26d159ca55417432422bc8ddffd897dc2df87003e080bb4"),
}
CODE = (
    "source_tools/receive_implementation.py", "model/implementation.py",
    "model/implementation_schema.py", "model/implementation_reporting.py",
    "model/portable_implementation.py", "model/portable.py",
    "model/project_transfer.py", "model/project_transfer_workspace.py",
    "model/workspace.py",
)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def identity(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Select an ordinary retained file: " + str(path))
    before = path.stat()
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    after = path.stat()
    fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
    if any(getattr(before, key) != getattr(after, key) for key in fields):
        raise ValueError("Original file changed while being read: " + str(path))
    return {"bytes": after.st_size, "sha256": h.hexdigest()}


def read(path):
    with Path(path).open("r", encoding="utf-8") as stream:
        return json.load(stream)


def write(path, value, *, immutable=False):
    body = (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")
    path = Path(path)
    if immutable and path.exists():
        if not _same_json(read(path), value):
            raise ValueError("The retained receiving selection belongs to another operation")
        return
    _atomic_bytes(path, body, replace=path.exists())


def _separate(left, right, label):
    if left == right or left in right.parents or right in left.parents:
        raise ValueError(label + " must use separate directory trees")


def _original_sources():
    sources = {}
    for key, (relative, size, digest) in ORIGINALS.items():
        actual = identity(APPLICATION / relative)
        if actual != {"bytes": size, "sha256": digest}:
            raise ValueError("The original Greenwood source edition differs: " + relative)
        sources[key] = {"path": relative, **actual}
    return sources


def _checkpoint(root, state, phase, **values):
    state.update(values, phase=phase, updated_at=now())
    write(root / "state.json", state)
    print(json.dumps({"phase": phase, "operation": str(root), **values},
                     ensure_ascii=False, default=str), flush=True)


def _capture(transfer, root, state, checkpoint):
    # Each attempt is retained. A synchronous process interrupted during the
    # original ZIP write may leave its incomplete staging file. Preserve it and
    # use a new capture task under this course's exclusive process lock.
    attempts = state.setdefault("capture_attempts", [])
    if not attempts:
        attempts.append({"operation_id": state["operation_id"] + ":capture:1"})
    current = attempts[-1]
    key = hashlib.sha256(current["operation_id"].encode("utf-8")).hexdigest()
    archive = transfer.archives / (key + ".zip")
    pending = transfer.archives / (".archive-" + archive.name + ".pending")
    if pending.exists() and not archive.exists():
        current.update(state="interrupted", retained_pending=str(pending))
        current = {"operation_id": state["operation_id"] + ":capture:" + str(len(attempts) + 1)}
        attempts.append(current)
    checkpoint("capturing", capture_attempts=attempts)
    capture = transfer.capture(current["operation_id"], progress=lambda row:
                               print(json.dumps(row, default=str), flush=True))
    current.update(state="complete", snapshot_id=capture["snapshot_id"])
    checkpoint("captured", capture_attempts=attempts, snapshot_id=capture["snapshot_id"],
               archive=capture["archive"])
    return capture


def run(workspace_path, operation, *, as_of="2026-10-13", plan_id=None, revision=None):
    dt.date.fromisoformat(as_of)
    original_greenwood = plan_id is None
    active_plan_id = PLAN_ID if original_greenwood else plan_id
    if revision is not None and (original_greenwood or isinstance(revision, bool) or not isinstance(revision, int) or revision < 1):
        raise ValueError("Select a positive revision of an existing native plan")
    workspace_path = Path(workspace_path).expanduser().resolve(strict=True)
    root = Path(operation).expanduser().resolve()
    _separate(root, workspace_path, "Receiving operation and original Workspace")
    _separate(root, APPLICATION, "Receiving operation and installed application")
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".receiving.lock", blocking=False):
        workspace = Workspace(workspace_path)
        sources = _original_sources() if original_greenwood else {}
        selection = {
            "schema": SCHEMA, "workspace": str(workspace.root),
            "project": workspace.project, "plan_id": active_plan_id, "as_of": as_of,
            "sources": sources,
        }
        if not original_greenwood:
            selection.update(source_kind="existing_native_plan", requested_revision=revision)
        write(root / "selection.json", selection, immutable=True)
        state_path = root / "state.json"
        state = read(state_path) if state_path.exists() else {
            "schema": SCHEMA, "operation_id": "FIELD12:" + hashlib.sha256(
                str(root).encode("utf-8")).hexdigest(), "created_at": now(),
        }
        state.setdefault("code_editions", [])
        code = {relative: identity(APPLICATION / relative) for relative in CODE}
        if not state["code_editions"] or state["code_editions"][-1]["files"] != code:
            state["code_editions"].append({"application": str(APPLICATION),
                                           "observed_at": now(), "files": code})

        def checkpoint(phase, **values):
            _checkpoint(root, state, phase, **values)

        try:
            checkpoint("opening_original_plan")
            store = ImplementationStore(workspace)
            if original_greenwood:
                original = read_document(APPLICATION / sources["plan"]["path"])
                if original["id"] != PLAN_ID:
                    raise ValueError("The original Greenwood plan identity differs")
                imported = store.import_document(original, expected_revision=0,
                                                 actor="FIELD12 original-source receiving")
                checkpoint("imported", import_status=imported["status"],
                           original_document_digest=imported["source_document_digest"])
            else:
                original = store.get(active_plan_id, state.get("selected_revision",
                    state.get("original_selected_revision", revision)))
                checkpoint("original_plan_opened", original_selected_revision=original["revision"],
                           original_document_digest=document_digest(original))

            if "selected_revision" not in state:
                attached = []
                if original_greenwood:
                    for key, label in (
                        ("parcel", "Original Greenwood County parcel response"),
                        ("source_interval", "Original Greenwood published-method interval result"),
                    ):
                        current = store.get(active_plan_id)
                        result = store.attach_file(
                            active_plan_id, APPLICATION / sources[key]["path"],
                            expected_revision=current["revision"],
                            actor="FIELD12 original-source receiving", label=label)
                        attached.append(result["source_link"])
                        checkpoint("retaining_originals", attachments=attached)
                    selected = store.get(active_plan_id)
                else:
                    selected = store.get(active_plan_id, original["revision"])
                    attached = [link for link in selected["source_links"]
                                if link.get("kind") == "local_file"]
                checkpoint("selected_revision", selected_revision=selected["revision"],
                           selected_document_digest=document_digest(selected),
                           attachments=attached)
            selected = store.get(active_plan_id, state["selected_revision"])
            if document_digest(selected) != state["selected_document_digest"]:
                raise ValueError("The selected original native revision differs")
            # Opening a pre-existing imported plan preserves all actual later work.
            # This course attaches sources; it does not create observations or mark
            # source-review tasks, visits or measurements as completed.
            report = None
            for retained in store.list_reports(active_plan_id):
                if (retained["revision"] == selected["revision"]
                        and retained["as_of"] == as_of):
                    report = retained
                    break
            if report is None:
                attempts = state.setdefault("report_attempts", [])
                attempt = Path(attempts[-1]) if attempts else None
                if attempt is not None and (attempt / "manifest.json").is_file():
                    report_edition(store, attempt)
                else:
                    attempt = root / ("report-" + str(len(attempts) + 1))
                    if attempt.exists():
                        raise ValueError("The receiving report destination is already occupied")
                    attempts.append(str(attempt))
                    checkpoint("reporting", report_attempts=attempts)
                    store.report(active_plan_id, attempt, as_of, revision=selected["revision"])
                report = store.retain_report(attempt)
            if (report["revision"] != selected["revision"] or report["as_of"] != as_of
                    or report["document_digest"] != document_digest(selected)):
                raise ValueError("The retained report names another original selection")
            checkpoint("report_retained", report=report)
            source_history = store.history(active_plan_id)

            transfer = NativeProjectTransfer(workspace, root / "transfer")
            capture = _capture(transfer, root, state, checkpoint)
            snapshot = capture["snapshot"]
            captured_plan = next((row for row in snapshot["archive"]["implementation"]["plans"]
                                  if row["id"] == active_plan_id), None)
            if (captured_plan is None or not any(
                    row["id"] == report["id"] for row in captured_plan["reports"])):
                raise ValueError("The captured Workspace does not contain the selected report")
            destination = root / "received"
            checkpoint("receiving", receiving_directory=str(destination))
            received = transfer.restore(capture["snapshot_id"], destination,
                                        progress=lambda row: print(json.dumps(row, default=str), flush=True))
            restored = Workspace(received["workspace"])
            restored_store = ImplementationStore(restored)
            reopened = restored_store.get(active_plan_id, selected["revision"])
            if not _same_json(reopened, selected):
                raise ValueError("Fresh receiving changed the selected original plan revision")
            # Native restore verifies all original archived members. Verify this
            # selected plan's current retained history/attachment/report semantics
            # again through the original public store, allowing subsequent native
            # edits when this same completed receiving operation is reopened.
            summary = verify_implementation(restored.root)
            restored_report = next((row for row in restored_store.list_reports(active_plan_id)
                                    if row["id"] == report["id"]), None)
            if restored_report is None:
                raise ValueError("Fresh receiving lacks the retained original report")
            restored_history = restored_store.history(active_plan_id)
            selected_history = [{key: value for key, value in row.items()
                                 if key != "revision_ref"} for row in source_history
                                if row["revision"] <= selected["revision"]]
            received_history = [{key: value for key, value in row.items()
                                 if key != "revision_ref"} for row in restored_history
                                if row["revision"] <= selected["revision"]]
            if not _same_json(selected_history, received_history):
                raise ValueError("Fresh receiving changed the selected original revision history")
            for link in state["attachments"]:
                path = restored.root / link["reference"]
                if identity(path) != {"bytes": link["size_bytes"], "sha256": link["sha256"]}:
                    raise ValueError("Fresh receiving changed an original source attachment")
            result = {
                "schema": SCHEMA, "state": "complete", "completed_at": now(),
                "operation": str(root), "source_workspace": str(workspace.root),
                "project": restored.project, "plan_id": active_plan_id,
                "revision": selected["revision"], "document_digest": document_digest(reopened),
                "original_sources": sources, "snapshot_id": capture["snapshot_id"],
                "archive": capture["archive"], "receiving": received,
                "implementation": summary, "report": restored_report,
                "report_files": {name: str(Path(restored_report["directory"]) / name)
                                 for name in restored_report["members"]},
                "open_saved_plan": {"plan_id": active_plan_id, "revision": selected["revision"]},
            }
            write(root / "receiving.json", result)
            checkpoint("complete", result=str(root / "receiving.json"))
            return result
        except Exception as exc:
            state.update(phase="failed", updated_at=now(),
                         error={"type": type(exc).__name__, "message": str(exc)})
            write(root / "state.json", state)
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True,
                        help="Existing original scientific Workspace; identity is preserved")
    parser.add_argument("--operation", required=True,
                        help="Owned output directory outside the Workspace and application")
    parser.add_argument("--as-of", default="2026-10-13")
    parser.add_argument("--plan-id", help="Existing native Implementation plan; omit for the original Greenwood course")
    parser.add_argument("--revision", type=int, help="Exact saved revision for --plan-id; defaults to the current revision")
    args = parser.parse_args(argv)
    try:
        result = run(args.workspace, args.operation, as_of=args.as_of,
                     plan_id=args.plan_id, revision=args.revision)
    except Exception:
        traceback.print_exc()
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

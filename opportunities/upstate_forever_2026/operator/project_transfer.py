"""Original queued project transfer operations and registered browser desk.

The original TransferStore, block protocol, native restore and file tickets remain
the authorities. Completed study capture resolves its server-owned export task.
"""
from __future__ import annotations
from contextlib import contextmanager
import os
from pathlib import Path
import time
import zipfile

from model.common import atomic_json, held, now, read_json
from model.project_transfer import (
    TransferStore, TransferError, canonical, digest_id, file_hash, load_json, integer, _atomic,
)
from model.project_transfer_workspace import NativeProjectTransfer
from model.project_transfer_cli import export_report

ACTIONS = frozenset({
    "project.transfer.capture", "project.transfer.capture-study",
    "project.transfer.accept", "project.transfer.receive", "project.transfer.parts",
    "project.transfer.archive", "project.transfer.restore", "project.transfer.report",
    "project.transfer.inspect", "project.transfer.diff",
})


class ProjectTransfers:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault
        self.stores = {}
        # The maintained descriptor and continuity use this same original provider.
        operator.project_transfers = self

    def store(self, workspace_key):
        key = digest_id(workspace_key)
        self.operator.ws(key)
        if key not in self.stores:
            self.stores[key] = TransferStore(self.operator.root / "project-transfers" / key)
        return self.stores[key]

    def _output(self, task_id):
        return self.operator.root / "outputs" / "project-transfers" / digest_id(task_id)

    def _progress(self, task):
        destination = self._output(task["id"]) / "progress.json"
        started, last = now(), {"time": 0.0, "phase": None}
        def report(value):
            current = time.monotonic()
            phase = value.get("phase", last["phase"])
            if phase == last["phase"] and current - last["time"] < 0.3:
                return
            atomic_json(destination, {"task_id": task["id"], "workspace_key": task["workspace"],
                                     "started_at": started, "updated_at": now(), **value})
            last.update(time=current, phase=phase)
        return report

    def _task(self, workspace_key, task_id):
        task = self.operator.task(digest_id(task_id))
        if task.get("workspace") != workspace_key or task.get("action") not in ACTIONS:
            raise self.Fault("TRANSFER_TASK", "Choose a transfer task from this workspace.", 404)
        return task

    def read(self, workspace_key, operation, value=None):
        value = value or {}
        store = self.store(workspace_key)
        try:
            offset = int(value.get("offset", 0))
            limit = int(value.get("limit", 100))
        except (TypeError, ValueError) as error:
            raise ValueError("Use a whole-number page offset and size.") from error
        if offset < 0 or not 1 <= limit <= 1000:
            raise ValueError("Use a nonnegative offset and page size from 1 to 1000.")
        if operation == "catalog":
            exports = []
            for task in self.operator.task_list(workspace_key):
                result = task.get("result") or {}
                if task.get("action") != "study.export" or task.get("state") != "complete":
                    continue
                exports.append({
                    "task_id": task["id"], "study_id": result.get("id"),
                    "title": task.get("payload", {}).get("title", "Selected scientific study"),
                    "bytes": result.get("bytes"), "sha256": result.get("sha256"),
                    "created_at": task.get("created_at"), "ended_at": task.get("ended_at"),
                    "source_files": result.get("source_files"),
                    "source_bytes": result.get("source_bytes"),
                })
            page = exports[offset:offset + limit]
            end = offset + len(page)
            return {"snapshots": store.list_snapshots(), "study_exports": page,
                    "exports_total": len(exports), "offset": offset, "limit": limit,
                    "next_offset": end if end < len(exports) else None}
        if operation == "snapshot":
            report = store.report(digest_id(value["snapshot_id"]))
            files = report.pop("files")
            request = report["request"]
            report["request"] = {key: item for key, item in request.items() if key != "missing"}
            selected = files[offset:offset + limit]
            end = offset + len(selected)
            return {**report, "files": selected, "offset": offset, "limit": limit,
                    "total_files": len(files), "next_offset": end if end < len(files) else None}
        if operation == "tasks":
            identities = value.get("task_ids", [])
            if not isinstance(identities, list):
                raise ValueError("Choose the retained transfer task identifiers.")
            return {"items": [self.decorate_task(self._task(workspace_key, identity))
                              for identity in dict.fromkeys(digest_id(item) for item in identities)]}
        if operation == "progress":
            task = self._task(workspace_key, value["task_id"])
            path = self._output(task["id"]) / "progress.json"
            detail = read_json(path) if path.is_file() else {"phase": task["state"]}
            return {"task_id": task["id"], "task_state": task["state"], **detail}
        raise self.Fault("TRANSFER_ROUTE", "Choose an existing project transfer view.", 404)

    def _capture_study(self, task, store, progress):
        value, workspace_key = task["payload"], task["workspace"]
        source = self.operator.task(digest_id(value["source_task_id"]))
        if (source.get("workspace") != workspace_key or source.get("action") != "study.export"
                or source.get("state") != "complete"):
            raise self.Fault("STUDY_EXPORT", "Choose a completed study export from this workspace.", 409)
        result = source.get("result") or {}
        study_id = digest_id(result.get("id"))
        if value.get("study_id") is not None and value["study_id"] != study_id:
            raise self.Fault("STUDY_EXPORT", "The completed export belongs to another selected study.", 409)
        ws = self.operator.ws(workspace_key)
        if (result.get("study") or {}).get("identity", {}).get("project_id") != ws.project["id"]:
            raise self.Fault("STUDY_PROJECT", "The retained export belongs to another original project.", 409)
        expected = self.operator.root / "outputs" / (source["id"] + ".study.zip")
        path = Path(result.get("path", ""))
        if path.is_symlink() or path.resolve() != expected.resolve():
            raise self.Fault("STUDY_ARCHIVE", "Choose the original retained archive of this export task.", 409)
        # The browser's archive ticket/path/hash is presentation data. Resolve the
        # completed original task, then verify its authoritative bytes and hash.
        ticket = self.operator._ticket(workspace_key, path, result, "Editable scientific study")
        stream, checked = self.operator.open_download(ticket["id"])
        stream.close()
        progress({"phase": "indexing_study", "source_task_id": source["id"],
                  "study_id": study_id, "archive_bytes": checked["bytes"]})
        snapshot = store.capture_archive(path, chunk_bytes=value.get("chunk_bytes", 4 * 1024**2),
                                         progress=progress)
        stream, _ = self.operator.open_download(ticket["id"])
        stream.close()
        member = "workspace/study-transfers/" + study_id + ".json"
        if member not in snapshot["members"]:
            raise self.Fault("STUDY_ARCHIVE", "The archive does not retain this selected-study receipt.", 409)
        if snapshot["archive"]["project"].get("id") != ws.project["id"]:
            raise self.Fault("STUDY_PROJECT", "The archive's original project identity differs.", 409)
        return snapshot, {
            "source_task_id": source["id"], "study_id": study_id,
            "study_title": source.get("payload", {}).get("title", "Selected scientific study"),
            "source_archive": {key: checked[key] for key in ("bytes", "sha256", "filename")},
        }

    def invoke(self, task):
        if task.get("action") not in ACTIONS:
            raise self.Fault("TRANSFER_ACTION", "Choose a supported project transfer operation.")
        store = self.store(task["workspace"])
        ws = self.operator.ws(task["workspace"])
        out = self._output(task["id"])
        out.mkdir(parents=True, exist_ok=True)
        progress = self._progress(task)
        progress({"phase": "starting", "action": task["action"]})
        try:
            result = self._invoke(task, store, ws, out, progress)
            progress({"phase": "complete", "snapshot_id": result.get("snapshot_id")})
            return result
        except BaseException as error:
            progress({"phase": "failed", "error": {"type": type(error).__name__, "message": str(error)}})
            raise

    def _invoke(self, task, store, ws, out, progress):
        value, action = task["payload"], task["action"]
        native = NativeProjectTransfer(ws, store.root)
        if action in {"project.transfer.capture", "project.transfer.capture-study"}:
            chunk_bytes = integer(value.get("chunk_bytes", 4 * 1024**2), minimum=65536, maximum=64 * 1024**2)
            if action.endswith("capture-study"):
                snapshot, extra = self._capture_study(task, store, progress)
            else:
                @contextmanager
                def saved_view():
                    try:
                        with held(ws.root / ".operator-session.lock", blocking=False):
                            self.operator._save_operator_session(task["workspace"], {
                                "journey": value["journey"],
                                "expected_revision": value.get("journey_revision")})
                            yield
                    except BlockingIOError as error:
                        raise self.Fault("JOURNEY_BUSY", "The project view is being saved. Resume this capture when the current save finishes.", 409) from error
                captured = native.capture(
                    task["id"], include_intermediates=value.get("include_intermediates", True),
                    include_deliveries=value.get("include_deliveries", True),
                    chunk_bytes=chunk_bytes, progress=progress,
                    backup_context=saved_view if value.get("journey") is not None else None)
                snapshot, extra = captured["snapshot"], {}
            path = out / "project.transfer.json"
            _atomic(path, canonical(snapshot) + b"\n")
            return {"snapshot_id": snapshot["id"], "project": snapshot["archive"]["project"],
                    "files": len(snapshot["members"]) - 1, **extra,
                    **({"source_acquisitions": snapshot["archive"]["source_acquisitions"]}
                       if "source_acquisitions" in snapshot["archive"] else {}),
                    **({"implementation": snapshot["archive"]["implementation"]}
                       if "implementation" in snapshot["archive"] else {}),
                    "artifacts": [self.describe(path, "Transfer manifest")]}
        if action in {"project.transfer.accept", "project.transfer.receive"}:
            uploaded = self.operator.upload(digest_id(value["upload_id"]))
            if action.endswith("accept"):
                identity = store.accept_snapshot(load_json(Path(uploaded["path"])))
                return {"snapshot_id": identity, "request": store.needs(identity)}
            return store.receive_pack(uploaded["path"], progress=progress)
        if action == "project.transfer.parts":
            request = value.get("request")
            if value.get("request_upload_id"):
                if request is not None:
                    raise TransferError("Choose one original receiver request")
                request = load_json(Path(self.operator.upload(digest_id(value["request_upload_id"]))["path"]))
            parts = store.write_parts(value["snapshot_id"], out, request=request,
                                      payload_bytes=value.get("payload_bytes", 64 * 1024**2),
                                      progress=progress)
            artifacts = [self.describe(out / (value["snapshot_id"] + ".transfer.json"), "Complete transfer manifest")]
            artifacts += [self.describe(part["path"], "Transfer part " + str(index + 1))
                          for index, part in enumerate(parts)]
            return {"snapshot_id": value["snapshot_id"], "parts": len(parts),
                    "payload_bytes": sum(part["payload_bytes"] for part in parts), "artifacts": artifacts}
        if action == "project.transfer.archive":
            result = store.materialize_archive(value["snapshot_id"], out / "scientific-workspace.zip",
                                               progress=progress)
            return {**result, "artifacts": [self.describe(result["path"], "Complete original workspace archive")]}
        if action == "project.transfer.restore":
            from model.workspace import Workspace
            result = native.restore(value["snapshot_id"], self.operator.restore_root / digest_id(task["id"]),
                                    progress=progress)
            restored_workspace = Workspace(result["workspace"])
            self.operator.extensions.verify_workspace(restored_workspace)
            key = self.operator.register(restored_workspace, received=result)
            return {**result, "workspace_key": key}
        if action == "project.transfer.inspect":
            if not value.get("snapshot_id"):
                return {"snapshots": store.list_snapshots()}
            report = store.report(value["snapshot_id"])
            manifest, request = out / "project.transfer.json", out / "receiver.missing.json"
            _atomic(manifest, canonical(store.snapshot(value["snapshot_id"])) + b"\n")
            _atomic(request, canonical(report["request"]) + b"\n", replace=True)
            return {**{key: item for key, item in report.items() if key != "files"},
                    "artifacts": [self.describe(manifest, "Complete transfer manifest"),
                                  self.describe(request, "Missing-block request")]}
        if action == "project.transfer.diff":
            result = store.difference(value["before_id"], value["after_id"])
            path = out / "edition-difference.json"
            _atomic(path, canonical(result) + b"\n")
            return {**result, "artifacts": [self.describe(path, "Complete original-file difference")]}
        if action == "project.transfer.report":
            export_report(store, value["snapshot_id"], out / "report")
            path = out / "transfer-inventory.zip"
            if not path.exists():
                pending = out / ".report.pending.zip"
                with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    for member in sorted((out / "report").iterdir()):
                        archive.write(member, member.name)
                os.link(pending, path)
                pending.unlink()
            return {"snapshot_id": value["snapshot_id"],
                    "artifacts": [self.describe(path, "Complete HTML, CSV and JSON file inventory")]}
        raise self.Fault("TRANSFER_ACTION", "Choose a supported project transfer operation.")

    @staticmethod
    def describe(path, label):
        path = Path(path)
        return {"path": str(path), "bytes": path.stat().st_size, "sha256": file_hash(path),
                "filename": path.name, "label": label}

    def decorate_task(self, task):
        """Keep the existing original authenticated download mechanism."""
        if task.get("action") not in ACTIONS:
            return task
        progress = self._output(task["id"]) / "progress.json"
        if progress.is_file():
            task["_transfer_progress"] = read_json(progress)
        if task.get("state") != "complete":
            return task
        expected = self._output(task["id"])
        tickets = []
        for row in (task.get("result") or {}).get("artifacts", []):
            path = Path(row["path"])
            if path.is_symlink() or not path.resolve().is_relative_to(expected.resolve()):
                raise self.Fault("TRANSFER_FILE", "Choose a retained output of this transfer task.", 409)
            tickets.append(self.operator._ticket(task["workspace"], path, row, row["label"]))
        task["_downloads"] = tickets
        return task

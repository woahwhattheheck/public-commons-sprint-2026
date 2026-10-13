"""Original Workspace backup/restore integration for incremental transfer.

TokenJunkieLabs. This module imports the maintained native modules only when a
native action is explicitly requested; standalone transport remains stdlib-only.
"""
from __future__ import annotations
from contextlib import nullcontext
from pathlib import Path
import os
import stat
import time
from .project_transfer import (TransferStore, TransferError, _atomic, canonical,
                               digest_id, load_json, sha)


class NativeProjectTransfer:
    def __init__(self, workspace, store_root):
        self.workspace = workspace
        self.store = TransferStore(store_root)
        wsroot = Path(workspace.root).resolve()
        cache = self.store.root.resolve()
        if cache == wsroot or wsroot in cache.parents or cache in wsroot.parents:
            raise TransferError("Keep transfer cache separate from the scientific workspace")
        self.archives = self.store.root / "native-archives"
        self.archives.mkdir(exist_ok=True)

    def capture(self, operation_id: str, *, include_intermediates=True,
                include_deliveries=True, chunk_bytes=4 * 1024**2, progress=None, cancel=None,
                backup_context=None):
        """Freeze with the ORIGINAL backup before indexing. Same task ID replays.

        An optional context saves operator selections under their existing lock
        only for a new native archive. Replay reuses the already frozen edition.
        """
        from . import portable
        if not isinstance(operation_id, str) or not operation_id:
            raise TransferError("Capture requires its original operation ID")
        key = sha(operation_id.encode("utf-8"))
        selection = {"operation_id": operation_id, "project_id": self.workspace.project["id"],
                     "workspace": str(Path(self.workspace.root).resolve()),
                     "include_intermediates": bool(include_intermediates),
                     "include_deliveries": bool(include_deliveries), "chunk_bytes": chunk_bytes}
        record_path = self.store.root / "operations" / (key + ".capture.json")
        archive = self.archives / (key + ".zip")
        with self.store._block_lock(key):
            record = load_json(record_path) if record_path.exists() else None
            if record and record["selection"] != selection:
                raise TransferError("Operation ID is already bound to another capture selection")
            if record and record["state"] == "complete":
                return {**record, "snapshot": self.store.snapshot(record["snapshot_id"]), "reused": True}
            record = record or {"schema": "upstate.project-transfer-capture/v1", "selection": selection,
                                "state": "capturing", "created_at": time.time()}
            _atomic(record_path, canonical(record) + b"\n", replace=record_path.exists())
            if archive.exists():
                original = portable.inspect_archive(archive, verify=True)
                if original["project"]["id"] != self.workspace.project["id"] or original["selection"] != {
                    "include_intermediates": bool(include_intermediates),
                    "include_deliveries": bool(include_deliveries)}:
                    raise TransferError("Retained native archive differs from the capture task")
            else:
                if progress:
                    progress({"phase": "native_backup", "meaning": "Freezing the original complete project"})
                with backup_context() if backup_context is not None else nullcontext():
                    portable.backup(self.workspace, archive, include_intermediates=include_intermediates,
                                    include_deliveries=include_deliveries)
            record.update(state="indexing", archive=str(archive))
            _atomic(record_path, canonical(record) + b"\n", replace=True)
            snapshot = self.store.capture_archive(archive, chunk_bytes=chunk_bytes, progress=progress, cancel=cancel)
            record.update(state="complete", snapshot_id=snapshot["id"], completed_at=time.time())
            _atomic(record_path, canonical(record) + b"\n", replace=True)
            return {**record, "snapshot": snapshot, "reused": False}

    def restore(self, snapshot_id: str, destination, *, progress=None):
        """Invoke original portable.restore, then register its preserved identity.

        The transported application is never imported. The installed, maintained
        native validator performs the semantic checks. Original outputs remain
        byte-identical through the transfer.
        """
        from . import portable
        snapshot_id = digest_id(snapshot_id)
        target = Path(destination).absolute()
        if target.is_symlink():
            raise TransferError("Receiving destination is a symlink")
        key = sha(canonical({"native_restore": snapshot_id, "destination": str(target)}))
        record_path = self.store.root / "operations" / (key + ".native-restore.json")
        with self.store._block_lock(key):
            record = load_json(record_path) if record_path.exists() else None
            if record and record["state"] == "complete":
                identity = target / "workspace" / "workspace.json"
                if target.exists():
                    # Receiving is create-only. Preserve subsequent recipient edits,
                    # while refusing to report a deleted or substituted project.
                    if identity.is_symlink() or not identity.is_file() or load_json(identity).get("id") != record["result"]["project"]["id"]:
                        raise TransferError("The previously received project identity is no longer present")
                    return {**record["result"], "reused": True}
                record["state"] = "assembling"
            if record is None and target.exists():
                raise TransferError("Choose a new native receiving directory")
            record = record or {"schema": "upstate.project-transfer-native-restore/v1",
                                "snapshot_id": snapshot_id, "destination": str(target), "state": "assembling"}
            _atomic(record_path, canonical(record) + b"\n", replace=record_path.exists())
            # Earlier reconstructions omitted original Unix modes. Keep that cache
            # file intact and rebuild the same immutable snapshot in the current edition.
            archive = self.archives / (snapshot_id + ".received-modes-v2.zip")
            self.store.materialize_archive(snapshot_id, archive, progress=progress)
            if target.exists():
                if record["state"] != "restoring":
                    raise TransferError("Native destination appeared during archive assembly")
                # The original receiver doesn't retain ARCHIVE.json on disk.
                from .project_transfer import archive_member_mode, file_hash, member_name
                snapshot = self.store.snapshot(snapshot_id)
                for name, expected in snapshot["archive"]["members"].items():
                    p = target.joinpath(*Path(member_name(name)).parts)
                    if p.is_symlink() or not p.is_file() or p.stat().st_size != expected["bytes"] or file_hash(p) != expected["sha256"]:
                        raise TransferError("Interrupted native receiving differs from its original files")
                    mode = archive_member_mode(snapshot, name)
                    if mode is not None and os.name == "posix" and stat.S_IMODE(p.stat().st_mode) != (mode & 0o777):
                        raise TransferError("Interrupted native receiving differs from its original file mode: " + name)
                # Recover the same receiving summary as portable.restore after a
                # lost reply, using the original files verified above.
                from .workspace import Workspace
                from .portable_acquisitions import verify_acquisitions
                restored = Workspace(target / "workspace")
                source_acquisitions = verify_acquisitions(
                    restored.root, snapshot["archive"]["members"],
                    source_ids={row["id"] for row in restored._list("sources")})
                retained_acquisitions = snapshot["archive"].get("source_acquisitions")
                if retained_acquisitions is not None and retained_acquisitions != source_acquisitions:
                    raise TransferError("Receiving changed the original source acquisition lineage")
                from .portable_implementation import verify_implementation
                implementation = verify_implementation(restored.root, snapshot["archive"]["members"])
                retained_implementation = snapshot["archive"].get("implementation")
                if retained_implementation is not None and retained_implementation != implementation:
                    raise TransferError("Receiving changed the original fieldwork plan history")
                from .portable_parameter_studies import verify_parameter_studies
                parameter_studies = verify_parameter_studies(restored, snapshot["archive"]["members"])
                retained_studies = snapshot["archive"].get("parameter_studies")
                if retained_studies is not None and retained_studies != parameter_studies:
                    raise TransferError("Receiving changed the original parameter study results")
                result = {"project": snapshot["archive"]["project"], "directory": str(target),
                          "workspace": str(target / "workspace"), "application": str(target / "application"),
                          "identity": "MATCH", "recovered_after_lost_reply": True,
                          "source_acquisitions": source_acquisitions,
                          "implementation": implementation,
                          "parameter_studies": parameter_studies}
            else:
                record["state"] = "restoring"
                _atomic(record_path, canonical(record) + b"\n", replace=True)
                result = portable.restore(archive, target)
            result.update(snapshot_id=snapshot_id, transport="incremental-original-members")
            record.update(state="complete", result=result, completed_at=time.time())
            _atomic(record_path, canonical(record) + b"\n", replace=True)
            return result

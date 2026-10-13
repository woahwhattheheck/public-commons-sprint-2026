"""Retain complete study exports once, choosing the smaller portable layout.

Reports retain their original relative paths. A complete member manifest permits
omitting a nested study ZIP when carrying its scientific files directly uses no
more logical bytes. Original standalone study ZIPs stay in the workspace.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import stat

from .common import atomic_json, digest, file_digest, identifier, now, read_json, verify_file
from .parameter_exports import EDITION, MEMBER_SCHEMA, member_descriptors
from .reuse import copy_verified, destination_file

SCHEMA = "upstate.parameter-suite-export-checkpoint/v2"
LEGACY_SCHEMA = "upstate.parameter-suite-export-checkpoint/v1"


def _identity(path):
    value = path.stat()
    if not stat.S_ISREG(value.st_mode) or path.is_symlink():
        raise ValueError("A retained suite export must be an original regular file")
    return [value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns]


def _layout(workspace, key, current):
    """Select complete direct members only when their logical byte count is smaller."""
    directory = workspace.root / "experiments" / key
    originals = current.get("artifacts", {})
    original_members = member_descriptors(directory, originals.values())
    nested_bytes = sum(value["bytes"] for value in original_members.values())
    plan = {
        "schema": "upstate.parameter-suite-study-layout/v1",
        "mode": "nested", "complete_member_manifest": False,
        "nested_logical_bytes": nested_bytes, "flat_logical_bytes": None,
        "selected_logical_bytes": nested_bytes, "logical_bytes_avoided": 0,
        "members": len(original_members),
        "basis": "Unique file lengths; independent of compression and filesystem allocation.",
    }
    manifest_descriptor = originals.get("export_manifest")
    if not manifest_descriptor:
        return dict(originals), plan
    manifest = read_json(verify_file(directory, manifest_descriptor))
    if (manifest.get("schema") != MEMBER_SCHEMA or manifest.get("edition") != EDITION
            or manifest.get("workspace_id") != workspace.project["id"]
            or manifest.get("study_id") != key
            or manifest.get("selection_sha256") != digest(current["selection"])
            or not isinstance(manifest.get("files"), list)):
        raise ValueError("The complete parameter member manifest belongs to another study or edition")
    members = member_descriptors(directory, manifest["files"])
    if (len(members) != len(manifest["files"])
            or manifest.get("members") != len(members)
            or manifest.get("logical_bytes") != sum(value["bytes"] for value in members.values())
            or "export-manifest.json" in members or "experiment-results.zip" in members
            or manifest_descriptor["path"] != "export-manifest.json"):
        raise ValueError("The complete parameter member manifest has inconsistent file totals")
    archive = originals.get("archive")
    if not archive or archive["path"] != "experiment-results.zip":
        raise ValueError("The study member manifest requires its original standalone archive")
    selected = {name: dict(value) for name, value in originals.items() if name != "archive"}
    for name, value in selected.items():
        if name != "export_manifest" and members.get(value["path"]) != value:
            raise ValueError("A visible study export differs from its complete member manifest")
    represented = {value["path"] for value in selected.values()}
    for path, value in sorted(members.items()):
        if path not in represented:
            name = "member_" + digest({"path": path})
            if name in selected:
                raise ValueError("A retained scientific member collides with a named study export")
            selected[name] = value
            represented.add(path)
    flat_members = member_descriptors(directory, selected.values())
    flat_bytes = sum(value["bytes"] for value in flat_members.values())
    plan.update(complete_member_manifest=True, flat_logical_bytes=flat_bytes,
                standalone_archive_bytes=archive["bytes"],
                scientific_member_count=len(members))
    if flat_bytes <= nested_bytes:
        plan.update(mode="flat", selected_logical_bytes=flat_bytes,
                    logical_bytes_avoided=nested_bytes - flat_bytes,
                    members=len(flat_members))
        return selected, plan
    return dict(originals), plan


class SuiteExports:
    """Retain each changed study once; keep reports current between native cases."""

    def __init__(self, workspace, directory, suite_id):
        self.workspace = workspace
        self.directory = Path(directory)
        self.suite_id = identifier(suite_id)
        self.implementation = file_digest(Path(__file__))
        self.records = {}
        self.result_rows = {}
        self.retired = []
        self.counts = {"study_reuse_hits": 0, "study_refreshes": 0,
                       "files_verified": 0, "logical_bytes_verified": 0,
                       "obsolete_copies_removed": 0, "obsolete_logical_bytes_removed": 0}

    def _reusable(self, record, key, source_record, originals, selected, layout):
        if (not isinstance(record, dict) or record.get("schema") != SCHEMA
                or record.get("suite_id") != self.suite_id
                or record.get("workspace_id") != self.workspace.project["id"]
                or record.get("study_id") != key
                or record.get("implementation_sha256") != self.implementation
                or record.get("source_record_sha256") != source_record
                or record.get("source_artifacts") != originals
                or record.get("layout") != layout):
            return False
        expected = {
            name: {**item, "path": (Path("studies") / key / item["path"]).as_posix()}
            for name, item in selected.items()}
        if record.get("artifacts") != expected:
            return False
        identities = record.get("verified_local_identities", {})
        if not isinstance(identities, dict):
            return False
        try:
            return all(_identity(destination_file(self.directory, item["path"]))
                       == identities.get(name) for name, item in expected.items())
        except (OSError, ValueError):
            return False

    def _remove_obsolete_copies(self, previous, key, current):
        """Remove only unchanged, previously verified copies owned by this suite."""
        if (not isinstance(previous, dict)
                or previous.get("schema") not in (SCHEMA, LEGACY_SCHEMA)
                or previous.get("suite_id") != self.suite_id
                or previous.get("workspace_id") != self.workspace.project["id"]
                or previous.get("study_id") != key):
            return
        retained = {item["path"] for item in current.values()}
        prefix = "studies/" + key + "/"
        seen = set()
        for name, item in previous.get("artifacts", {}).items():
            path = item.get("path", "")
            if (path in retained or path in seen or not path.startswith(prefix)):
                continue
            seen.add(path)
            expected_identity = previous.get("verified_local_identities", {}).get(name)
            try:
                candidate = destination_file(self.directory, path)
                if _identity(candidate) != expected_identity:
                    continue
                # Verify again before removal; a changed copy remains untouched.
                verify_file(self.directory, item)
                if _identity(candidate) != expected_identity:
                    continue
                candidate.unlink()
            except (OSError, ValueError):
                continue
            self.counts["obsolete_copies_removed"] += 1
            self.counts["obsolete_logical_bytes_removed"] += item["bytes"]

    def retain(self, item):
        """Return the saved study's current checkpoint, exports and original rows."""
        from . import parameter_studies
        key = identifier(item["study_id"])
        # Native case inspection stays with study execution; publication only
        # binds retained study selection, source bodies and independent copies.
        current = parameter_studies._read(self.workspace, key)
        source_record = digest(current)
        originals = current.get("artifacts", {})
        selected, layout = _layout(self.workspace, key, current)
        checkpoint = destination_file(self.directory, "studies/" + key + "/export-checkpoint.json")
        record = self.records.get(key)
        if record is None and checkpoint.is_file():
            try:
                record = read_json(checkpoint)
            except (ValueError, TypeError):
                record = None
        if self._reusable(record, key, source_record, originals, selected, layout):
            self.counts["study_reuse_hits"] += 1
        else:
            previous = record
            transfer = {"files": 0, "bytes": 0, "methods": {}}
            exported, identities = {}, {}
            for name, descriptor in selected.items():
                relative = (Path("studies") / key / descriptor["path"]).as_posix()
                exported[name] = copy_verified(
                    self.workspace.root / "experiments" / key, descriptor,
                    self.directory, path=relative, replace_mismatch=True,
                    transfer=transfer)
                identities[name] = _identity(destination_file(self.directory, relative))
            record = {
                "schema": SCHEMA, "suite_id": self.suite_id,
                "workspace_id": self.workspace.project["id"], "study_id": key,
                "implementation_sha256": self.implementation,
                "source_record_sha256": source_record, "source_artifacts": originals,
                "artifacts": exported, "verified_local_identities": identities,
                "layout": layout, "verified_at": now(), "transfer": transfer,
                "verification": "Original SHA256 and length checked during independent copy; "
                                "unchanged local body identities are reused for interim reports.",
            }
            atomic_json(checkpoint, record)
            self.counts["study_refreshes"] += 1
            self.counts["files_verified"] += transfer["files"]
            self.counts["logical_bytes_verified"] += transfer["bytes"]
            # The suite index and manifest must be published before removing
            # any old body that their preceding edition may still reference.
            self.retired.append((previous, key))
        self.records[key] = record
        descriptor = record["artifacts"].get("results")
        rows = []
        if descriptor:
            token = (key, descriptor["sha256"], descriptor["bytes"])
            if token not in self.result_rows:
                result = read_json(verify_file(self.directory, descriptor))
                if (result.get("experiment_id") != key
                        or result.get("workspace_id") != self.workspace.project["id"]):
                    raise ValueError("A study result belongs to another retained operation")
                self.result_rows[token] = result["rows"]
            rows = self.result_rows[token]
        return current, deepcopy(record["artifacts"]), rows

    def prune(self):
        """Retire unchanged old copies after the new suite publication succeeds."""
        for previous, key in self.retired:
            self._remove_obsolete_copies(previous, key, self.records[key]["artifacts"])
        self.retired.clear()

    def layout(self, key):
        return deepcopy(self.records[identifier(key)]["layout"])

    def progress(self):
        layouts = [record["layout"] for record in self.records.values()]
        return {
            **self.counts,
            "flat_studies": sum(value["mode"] == "flat" for value in layouts),
            "nested_studies": sum(value["mode"] == "nested" for value in layouts),
            "logical_bytes_selected": sum(value["selected_logical_bytes"] for value in layouts),
            "logical_bytes_avoided": sum(value["logical_bytes_avoided"] for value in layouts),
        }

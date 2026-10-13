"""Reuse verified study exports while publishing a growing native suite.

Each saved study retains its original model/result selection. This module only
remembers independent exported copies and the metadata of their last verified
local bodies; final archive streaming verifies every selected body again.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import stat

from .common import atomic_json, digest, file_digest, identifier, now, read_json, verify_file
from .reuse import copy_verified, destination_file

SCHEMA = "upstate.parameter-suite-export-checkpoint/v1"


def _identity(path):
    value = path.stat()
    if not stat.S_ISREG(value.st_mode) or path.is_symlink():
        raise ValueError("A retained suite export must be an original regular file")
    return [value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns]


class SuiteExports:
    """Retain each changed study once; keep reports current between native cases."""

    def __init__(self, workspace, directory, suite_id):
        self.workspace = workspace
        self.directory = Path(directory)
        self.suite_id = identifier(suite_id)
        self.implementation = file_digest(Path(__file__))
        self.records = {}
        self.result_rows = {}
        self.counts = {"study_reuse_hits": 0, "study_refreshes": 0,
                       "files_verified": 0, "logical_bytes_verified": 0}

    def _reusable(self, record, key, source_record, originals):
        if (not isinstance(record, dict) or record.get("schema") != SCHEMA
                or record.get("suite_id") != self.suite_id
                or record.get("workspace_id") != self.workspace.project["id"]
                or record.get("study_id") != key
                or record.get("implementation_sha256") != self.implementation
                or record.get("source_record_sha256") != source_record
                or record.get("source_artifacts") != originals):
            return False
        expected = {
            name: {**item, "path": (Path("studies") / key / item["path"]).as_posix()}
            for name, item in originals.items()}
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

    def retain(self, item):
        """Return the saved study's current checkpoint, exports and original rows."""
        from . import parameter_studies
        key = identifier(item["study_id"])
        # _read binds the saved checkpoint to its retained selection/project.
        # Native case inspection stays with the actual study execution, avoiding
        # a repeated scan of every earlier case for each growing suite report.
        current = parameter_studies._read(self.workspace, key)
        source_record = digest(current)
        originals = current.get("artifacts", {})
        checkpoint = destination_file(self.directory, "studies/" + key + "/export-checkpoint.json")
        record = self.records.get(key)
        if record is None and checkpoint.is_file():
            try:
                record = read_json(checkpoint)
            except (ValueError, TypeError):
                record = None
        if self._reusable(record, key, source_record, originals):
            self.counts["study_reuse_hits"] += 1
        else:
            transfer = {"files": 0, "bytes": 0, "methods": {}}
            exported, identities = {}, {}
            for name, descriptor in originals.items():
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
                "verified_at": now(), "transfer": transfer,
                "verification": "Original SHA256 and length checked during independent copy; "
                                "unchanged local body identities are reused for interim reports.",
            }
            atomic_json(checkpoint, record)
            self.counts["study_refreshes"] += 1
            self.counts["files_verified"] += transfer["files"]
            self.counts["logical_bytes_verified"] += transfer["bytes"]
        self.records[key] = record
        descriptor = record["artifacts"].get("results")
        rows = []
        if descriptor:
            token = (key, descriptor["sha256"], descriptor["bytes"])
            # Small quantitative JSON is verified when first admitted to this
            # writer. The large GIS/ZIP bodies remain independently retained.
            if token not in self.result_rows:
                result = read_json(verify_file(self.directory, descriptor))
                if (result.get("experiment_id") != key
                        or result.get("workspace_id") != self.workspace.project["id"]):
                    raise ValueError("A study result belongs to another retained operation")
                self.result_rows[token] = result["rows"]
            rows = self.result_rows[token]
        return current, deepcopy(record["artifacts"]), rows

    def progress(self):
        return dict(self.counts)

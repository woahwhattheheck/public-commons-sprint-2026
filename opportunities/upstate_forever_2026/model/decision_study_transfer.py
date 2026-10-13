"""Selected original decision history for editable scientific study transfer.

Read the maintained decision store without migrating it. Capture a filtered
SQLite online backup with original study, revision, calculation and operation
identities; native ecological dependencies come from its explicit bridge.
"""
from __future__ import annotations

from contextlib import closing, contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import time

from .common import digest, identifier
from . import portable

KIND = "robust-decisions"
MEMBER = "robust_decisions/robust_decisions.sqlite3"
SCHEMA = "upstate.selected-decision-history/v1"
CONTRACT = "ES-EXP-2319/landcover-metrics"
DIAGNOSTIC_CONTRACT = "ES26/diagnostic-common-support/v1"


def study_id(value):
    if not isinstance(value, str) or re.fullmatch(r"study_[0-9a-f]{32}", value) is None:
        raise ValueError("Select an original saved decision study.")
    return value


def _run_id(value):
    if not isinstance(value, str) or re.fullmatch(r"run_[0-9a-f]{32}", value) is None:
        raise ValueError("The decision calculation identity is unreadable.")
    return value


def _path(workspace):
    root = Path(workspace.root).resolve()
    path = root / MEMBER
    if path.parent.is_symlink() or path.is_symlink():
        raise ValueError("The original decision store must retain its workspace path.")
    if not path.is_file():
        raise ValueError("The selected decision study needs its original SQLite history.")
    return path


def _connection(path):
    db = sqlite3.connect(Path(path).absolute().as_uri() + "?mode=ro", uri=True, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("BEGIN")
    return db


def _native_numbers(value):
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Decision inputs must contain finite original numbers.")
        return int(value) if value.is_integer() else value
    if isinstance(value, dict):
        return {key: _native_numbers(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_native_numbers(item) for item in value]
    return value


def _native_hash(value):
    return hashlib.sha256(json.dumps(_native_numbers(value), sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode("utf-8")).hexdigest()


def _records(db, ids):
    result = {}
    has_operations = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='operator_operations'").fetchone()
    for sid in sorted(set(study_id(value) for value in ids)):
        row = db.execute("SELECT * FROM studies WHERE id=?", (sid,)).fetchone()
        if row is None:
            raise ValueError("The original decision study is missing: " + sid)
        study = dict(row)
        if type(study["head"]) is not int or study["head"] < 1:
            raise ValueError("The original decision revision head is unreadable.")
        revisions = [dict(row) for row in db.execute(
            "SELECT * FROM revisions WHERE study_id=? ORDER BY revision", (sid,))]
        if [row["revision"] for row in revisions] != list(range(1, study["head"] + 1)):
            raise ValueError("The selected decision study lost its complete revision history.")
        hashes = {}
        for row in revisions:
            row["input"] = json.loads(row["input"])
            if _native_hash(row["input"]) != row["sha256"]:
                raise ValueError("A selected decision revision changed its original input.")
            hashes[row["revision"]] = row["sha256"]
        runs = [dict(row) for row in db.execute(
            "SELECT * FROM runs WHERE study_id=? ORDER BY id", (sid,))]
        for row in runs:
            _run_id(row["id"])
            if row["revision"] not in hashes:
                raise ValueError("A decision calculation lost its original revision.")
            row["result"] = json.loads(row["result"]) if row["result"] is not None else None
            if row["result"] is not None and row["result"].get("study_sha256") != hashes[row["revision"]]:
                raise ValueError("A decision calculation differs from its saved revision.")
        imported = db.execute("SELECT provenance FROM imports WHERE study_id=?", (sid,)).fetchone()
        operations = []
        if has_operations:
            operations = [dict(row) for row in db.execute(
                """SELECT * FROM operator_operations
                   WHERE (kind IN ('create','revise','receive') AND result_id=?)
                      OR (kind='calculation' AND result_id IN
                          (SELECT id FROM runs WHERE study_id=?))
                   ORDER BY operation_id""", (sid, sid))]
            run_rows = {row["id"]: row for row in runs}
            for row in operations:
                expected = (run_rows[row["result_id"]]["revision"] if row["kind"] == "calculation"
                            else row["result_revision"])
                if expected not in hashes or row["result_revision"] != expected:
                    raise ValueError("A decision operation lost its original saved revision.")
        result[sid] = {"study": study, "revisions": revisions, "runs": runs,
                       "import_provenance": None if imported is None else json.loads(imported["provenance"]),
                       "operations": operations}
    return result


def read(workspace, ids, *, database=None):
    with closing(_connection(_path(workspace) if database is None else database)) as db:
        return _records(db, ids)



@contextmanager
def source_snapshot(workspace, *, directory):
    """Freeze one SQL generation before resolving its scientific dependencies."""
    source_path = _path(workspace)
    with tempfile.TemporaryDirectory(prefix=".decision-source-", dir=directory) as temporary:
        private = Path(temporary) / "source.sqlite3"
        busy_since = None
        def progress(status, remaining, total):
            nonlocal busy_since
            if status in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
                current = time.monotonic()
                if busy_since is None:
                    busy_since = current
                elif current - busy_since >= 30:
                    raise ValueError("The decision store remained busy during history capture.")
            else:
                busy_since = None
        with closing(_connection(source_path)) as source, closing(sqlite3.connect(private)) as target:
            source.backup(target, pages=256, progress=progress)
            target.execute("PRAGMA journal_mode=DELETE")
            target.commit()
        yield private


def catalogue(workspace):
    path = Path(workspace.root) / MEMBER
    if not path.exists():
        return []
    with closing(_connection(_path(workspace))) as db:
        rows = [dict(row) for row in db.execute("SELECT * FROM studies ORDER BY created DESC")]
        result = []
        for row in rows:
            sid = study_id(row["id"])
            latest = db.execute(
                "SELECT status,created FROM runs WHERE study_id=? ORDER BY created DESC,id DESC LIMIT 1",
                (sid,)).fetchone()
            updated = db.execute(
                "SELECT created FROM revisions WHERE study_id=? AND revision=?", (sid, row["head"])).fetchone()
            result.append({"kind": KIND, "id": sid, "title": row["title"],
                           "state": latest["status"] if latest else "saved",
                           "updated_at": max(row["created"], updated["created"] if updated else "",
                                             latest["created"] if latest else ""),
                           "selection": {"revision": row["head"]},
                           "counts": {"revisions": row["head"]}, "error": None})
        return result


def dependencies(record, project_id, *, external=False):
    """Interpret only the original native bridge's declared ecological references."""
    found = {}
    source_project = None
    revision_number = None
    def add(kind, value, reason):
        key = identifier(value)
        token = (kind, key, source_project, revision_number) if external else (kind, key)
        found[token] = {"kind": kind, "id": key, "reason": reason, "required": True}
        if external:
            found[token].update(source_workspace_id=source_project, revision=revision_number,
                                study_id=record["study"]["id"])

    for revision in record["revisions"]:
        value = revision["input"]
        source = value.get("source") or {}
        contract = source.get("pair_contract")
        if contract not in {CONTRACT, DIAGNOSTIC_CONTRACT}:
            continue
        source_project = source.get("workspace_id")
        revision_number = revision["revision"]
        if (source_project != project_id) != external:
            continue
        reason = "Original ecological inputs for decision revision " + str(revision["revision"])
        if contract == CONTRACT or source.get("experiment_id") is not None:
            add("experiments", source.get("experiment_id"), reason)
        if contract == DIAGNOSTIC_CONTRACT:
            binding = _diagnostic_binding(source)
            add("experiment-diagnostics", binding["diagnostic_id"], reason)
        add("grids", source.get("grid_id"), reason)
        for candidate in value.get("candidates", []):
            binding = candidate.get("source") or {}
            add("scenarios", binding.get("scenario_id", candidate["id"]), reason)
        for profile in value.get("profiles", []):
            binding = profile.get("source") or {}
            add("profiles", binding.get("profile_id", profile["id"]), reason)
        for cell in value.get("cells", []):
            add("profiles", cell["profile_id"], reason)
            add("scenarios", cell["candidate_id"], reason)
            binding = cell.get("source") or {}
            add("runs", binding.get("baseline_run_id"), reason)
            add("runs", binding.get("alternative_run_id"), reason)
            add("scenarios", binding.get("scenario_id", cell["candidate_id"]), reason)
            add("grids", binding.get("grid_id", source["grid_id"]), reason)
            native_case = binding.get("native_case") or {}
            selection = native_case.get("selection") or {}
            for field, kind in (("grid_id", "grids"), ("profile_id", "profiles"), ("scenario_id", "scenarios")):
                if field in selection:
                    add(kind, selection[field], reason)
            if native_case.get("comparison_id") is not None:
                add("comparisons", native_case["comparison_id"], reason)
    return sorted(found.values(), key=lambda row: (row["kind"], row["id"],
                                                   str(row.get("source_workspace_id", "")),
                                                   row.get("revision", 0)))



def _diagnostic_binding(source):
    binding = source.get("diagnostic_binding")
    if (not isinstance(binding, dict)
            or binding.get("schema") != "upstate.decision-diagnostic-binding/v1"
            or binding.get("project_id") != source.get("workspace_id")):
        raise ValueError("The decision needs its original diagnostic report binding.")
    identifier(binding.get("diagnostic_id"))
    identifier(binding.get("report_sha256"))
    if (source.get("diagnostic_id") != binding["diagnostic_id"]
            or source.get("diagnostic_report_sha256") != binding["report_sha256"]):
        raise ValueError("The decision source has conflicting diagnostic revision identities.")
    prefix = ("robust_decisions/diagnostic-revisions/" + binding["diagnostic_id"]
              + "/" + binding["report_sha256"] + "/")
    for field in ("report", "manifest"):
        descriptor = binding.get(field)
        if (not isinstance(descriptor, dict)
                or descriptor.get("path") != prefix + field + ".json"
                or type(descriptor.get("bytes")) is not int or descriptor["bytes"] < 0):
            raise ValueError("The decision report revision lost its original retained file.")
        identifier(descriptor.get("sha256"))
    if binding["report"]["sha256"] != binding["report_sha256"]:
        raise ValueError("The decision report differs from its pinned original revision.")
    return binding


def diagnostic_members(workspace, record):
    """Include an original pinned diagnostic even without an Investigation session."""
    root = Path(workspace.root).resolve()
    members = {}
    for revision in record["revisions"]:
        source = revision["input"].get("source") or {}
        if (source.get("pair_contract") != DIAGNOSTIC_CONTRACT
                or source.get("workspace_id") != workspace.project["id"]):
            continue
        binding = _diagnostic_binding(source)
        manifest_descriptor = binding["manifest"]
        for descriptor in (binding["report"], manifest_descriptor):
            relative = descriptor["path"]
            path = root
            for part in portable.member_name(relative).parts:
                path = path / part
                if path.is_symlink():
                    raise ValueError("A decision report revision changed its original path.")
            if not path.is_file() or path.stat().st_size != descriptor["bytes"]:
                raise ValueError("A selected decision needs its original diagnostic revision: " + relative)
            previous = members.get(relative)
            if previous is not None and previous != descriptor:
                raise ValueError("Selected decisions disagree about a diagnostic revision.")
            members[relative] = descriptor
        manifest_path = root / manifest_descriptor["path"]
        raw = manifest_path.read_bytes()
        if (len(raw) != manifest_descriptor["bytes"]
                or hashlib.sha256(raw).hexdigest() != manifest_descriptor["sha256"]):
            raise ValueError("The selected decision revision manifest changed.")
        manifest = json.loads(raw)
        if (manifest.get("schema") != "upstate.decision-diagnostic-revision/v1"
                or manifest.get("project_id") != workspace.project["id"]
                or manifest.get("diagnostic_id") != binding["diagnostic_id"]
                or manifest.get("report_sha256") != binding["report_sha256"]
                or manifest.get("report") != binding["report"]):
            raise ValueError("The decision revision manifest differs from its retained binding.")
    return members


def operation_members(workspace, ids):
    """Return original operation receipts and their exact retained export files."""
    selected = set(ids)
    root = Path(workspace.root).resolve()
    result = {}
    for path in sorted((root / "robust-operator-operations").glob("*/operation.json")):
        if path.is_symlink() or path.parent.is_symlink():
            raise ValueError("A decision operation changed its original workspace path.")
        raw = path.read_bytes()
        record = json.loads(raw)
        if record.get("selection", {}).get("study_id") not in selected:
            continue
        key = identifier(path.parent.name)
        if (record.get("schema") != "upstate.robust-operator-operation/v1"
                or record.get("id") != key or record.get("workspace_id") != workspace.project["id"]
                or record.get("result_sha256") != digest(record.get("result"))):
            raise ValueError("A selected decision operation changed its original identity.")
        result[path.relative_to(root).as_posix()] = {
            "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        for descriptor in record.get("files", {}).values():
            relative = portable.member_name(descriptor["path"]).as_posix()
            if not relative.startswith("robust-operator-operations/" + key + "/"):
                raise ValueError("A decision export must retain its original operation directory.")
            result[relative] = descriptor
    return result


def capture(workspace, staged, records, *, database=None):
    """Capture the selected original SQL rows once, with no receiving-ID remap."""
    ids = sorted(records)
    if not ids:
        return None, {}
    source_path = _path(workspace) if database is None else Path(database)
    destination = Path(staged.root) / MEMBER
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        raise ValueError("The selected decision snapshot already exists.")
    expected = digest(records)
    with tempfile.TemporaryDirectory(prefix=".decision-snapshot-", dir=destination.parent) as temporary:
        private = Path(temporary) / "selected.sqlite3"
        busy_since = None
        def progress(status, remaining, total):
            nonlocal busy_since
            if status in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
                current = time.monotonic()
                if busy_since is None:
                    busy_since = current
                elif current - busy_since >= 30:
                    raise ValueError("The decision store remained busy during its selected capture.")
            else:
                busy_since = None
        with closing(_connection(source_path)) as source, closing(sqlite3.connect(private)) as target:
            source.backup(target, pages=256, progress=progress)
            target.row_factory = sqlite3.Row
            if digest(_records(target, ids)) != expected:
                raise ValueError("The selected decision history changed before capture.")
            target.execute("CREATE TEMP TABLE selected_studies(id TEXT PRIMARY KEY)")
            target.executemany("INSERT INTO selected_studies VALUES(?)", [(sid,) for sid in ids])
            if target.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='operator_operations'").fetchone():
                target.execute("""DELETE FROM operator_operations WHERE NOT (
                    (kind IN ('create','revise','receive') AND result_id IN (SELECT id FROM selected_studies))
                    OR (kind='calculation' AND result_id IN
                        (SELECT id FROM runs WHERE study_id IN (SELECT id FROM selected_studies))))""")
            for table in ("revisions", "runs", "imports"):
                target.execute("DELETE FROM " + table + " WHERE study_id NOT IN (SELECT id FROM selected_studies)")
            target.execute("DELETE FROM studies WHERE id NOT IN (SELECT id FROM selected_studies)")
            target.commit()
            target.execute("DROP TABLE selected_studies")
            target.execute("PRAGMA journal_mode=DELETE")
            target.execute("VACUUM")
            if [row[0] for row in target.execute("PRAGMA quick_check")] != ["ok"]:
                raise ValueError("The selected decision snapshot is unreadable.")
            if digest(_records(target, ids)) != expected:
                raise ValueError("The selected decision snapshot changed its original history.")
            target.commit()
        for suffix in ("-wal", "-shm", "-journal"):
            if private.with_name(private.name + suffix).exists():
                raise ValueError("The selected decision snapshot retained a live journal.")
        with private.open("rb") as stream:
            os.fsync(stream.fileno())
        os.link(private, destination)
    body = destination.read_bytes()
    member = {"path": MEMBER, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(), "mutable": True}
    receipt = {"schema": SCHEMA, "project_id": workspace.project["id"], "study_ids": ids,
               "studies": [{"id": sid, "head": records[sid]["study"]["head"],
                            "created": records[sid]["study"]["created"],
                            "import_sha256": digest(records[sid]["import_provenance"]),
                            "revisions": [{"revision": row["revision"], "sha256": row["sha256"]}
                                          for row in records[sid]["revisions"]],
                            "runs": [{"id": row["id"], "revision": row["revision"],
                                      "sha256": digest(row), "status": row["status"],
                                      "binding_sha256": digest(_run_binding(row))}
                                     for row in records[sid]["runs"]],
                            "operations": records[sid]["operations"]}
                           for sid in ids],
               "members": [member]}
    return receipt, {MEMBER: {key: value for key, value in member.items() if key != "path"}}


def _run_binding(row):
    return {key: row[key] for key in ("id", "study_id", "revision", "objective", "created")}


def verify_received(workspace, receipt):
    """Reopen original identities while allowing new revisions and calculations."""
    if receipt.get("schema") != SCHEMA or receipt.get("project_id") != workspace.project["id"]:
        raise ValueError("The selected decision history belongs to another scientific workspace.")
    records = read(workspace, receipt["study_ids"])
    for selected in receipt["studies"]:
        record = records[study_id(selected["id"])]
        if record["study"]["head"] < selected["head"]:
            raise ValueError("The received decision study lost its retained revision head.")
        if (record["study"]["created"] != selected["created"]
                or digest(record["import_provenance"]) != selected["import_sha256"]):
            raise ValueError("The received decision study changed its original provenance.")
        revisions = {row["revision"]: row["sha256"] for row in record["revisions"]}
        for row in selected["revisions"]:
            if revisions.get(row["revision"]) != row["sha256"]:
                raise ValueError("The received decision study lost an immutable revision.")
        runs = {row["id"]: row for row in record["runs"]}
        for row in selected["runs"]:
            current = runs.get(row["id"])
            if current is None or current["revision"] != row["revision"]:
                raise ValueError("The received decision study lost an original calculation.")
            if digest(_run_binding(current)) != row["binding_sha256"]:
                raise ValueError("A retained decision calculation changed its original inputs.")
            if row["status"] == "running":
                if current["status"] not in {"running", "completed", "failed", "interrupted", "interrupted_on_transfer"}:
                    raise ValueError("A received decision calculation has an unknown continuation state.")
            elif digest(current) != row["sha256"]:
                raise ValueError("A completed decision attempt changed after capture.")
        operations = {row["operation_id"]: row for row in record["operations"]}
        for original in selected["operations"]:
            current = operations.get(original["operation_id"])
            if current is None or any(current[key] != original[key] for key in
                                      ("kind", "request_sha256", "result_revision")):
                raise ValueError("A received decision operation changed its original request.")
            if current["result_id"] == original["result_id"]:
                continue
            old_run, new_run = runs.get(original["result_id"]), runs.get(current["result_id"])
            if (original["kind"] != "calculation" or old_run is None or new_run is None
                    or old_run["status"] not in {"failed", "interrupted", "interrupted_on_transfer"}
                    or new_run["revision"] != old_run["revision"]
                    or new_run["objective"] != old_run["objective"]):
                raise ValueError("A received decision operation lost its original calculation lineage.")
    return {"studies": len(records), "revisions": sum(len(row["revisions"]) for row in records.values()),
            "runs": sum(len(row["runs"]) for row in records.values()), "identity": "MATCH"}

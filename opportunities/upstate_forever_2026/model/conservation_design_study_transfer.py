"""Selected original Scenario design projects in the existing study transfer.

The original SQLite Store owns project IDs, schema, revision numbers and bodies.
Capture uses its existing portable online backup; only the selected original
Conservation projects enter the receiving Workspace. No project is cloned.
"""
from __future__ import annotations

from contextlib import closing, contextmanager
from copy import deepcopy
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
import sqlite3

from .common import describe_file, digest, identifier, read_json, verify_file

SCHEMA = "upstate.conservation-design-study-history/v1"
DATABASE = "conservation-design/editor/projects.sqlite"
EDITOR = "conservation-design/editor"
ARCHIVE_DATABASE = "workspace/" + DATABASE
PROJECT_COLUMNS = ("id", "title", "revision", "updated", "body")
REVISION_COLUMNS = ("project_id", "revision", "saved", "body")


def _modules():
    from .conservation_design_editor import _modules as original_modules
    return original_modules()


def _readonly(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True, timeout=30)


def _schema(db):
    expected = {"projects": PROJECT_COLUMNS, "revisions": REVISION_COLUMNS}
    tables = {row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    if tables != set(expected):
        raise ValueError("Receive the matching original Scenario design Store schema")
    for table, names in expected.items():
        if tuple(row[1] for row in db.execute("PRAGMA table_info(" + table + ")")) != names:
            raise ValueError("The original editor Store columns differ: " + table)
    result = [row[0] for row in db.execute("PRAGMA quick_check")]
    if result != ["ok"]:
        raise ValueError("The original editor snapshot is not a complete SQLite database")


def _body(value):
    if isinstance(value, str):
        return value.encode("utf-8"), "text"
    if isinstance(value, bytes):
        return value, "blob"
    raise ValueError("Retain the original editor project body as text or bytes")


def _body_identity(value):
    raw, kind = _body(value)
    return {"body_bytes": len(raw), "body_sha256": hashlib.sha256(raw).hexdigest(),
            "body_storage": kind}


def _project(value):
    raw, unused = _body(value)
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError("The original editor project body must be an object")
    return result


def _positive(value):
    return type(value) is int and value >= 1


@contextmanager
def source_snapshot(workspace, *, directory=None):
    """Freeze the source Store once, before discovering the selected closure.

    Enter this alongside the existing decision/investigation source snapshots.
    Retain this context until capture has finished. The returned path is private
    and temporary; no original project or database is changed.
    """
    from . import portable_databases

    path = Path(workspace.root) / DATABASE
    if not path.exists():
        if path.is_symlink():
            raise ValueError("The original editor database link is unavailable")
        yield None
        return
    if path.is_symlink() or not path.resolve().is_relative_to(Path(workspace.root).resolve()):
        raise ValueError("Keep the original editor Store within its Workspace")
    identity = portable_databases._identity(path)
    inputs = [(ARCHIVE_DATABASE, path, identity)]
    directory = Path(directory) if directory is not None else Path(workspace.root).parent
    with portable_databases.snapshot_databases(inputs, directory) as (files, records, originals):
        matches = [item for item in files if item[0] == ARCHIVE_DATABASE]
        if len(matches) != 1 or records.get(ARCHIVE_DATABASE, {}).get("method") != "sqlite-online-backup":
            raise ValueError("Capture the original editor through its maintained online backup")
        retained = Path(matches[0][1])
        with closing(_readonly(retained)) as db:
            _schema(db)
        yield {"path": retained, "source": deepcopy(records[ARCHIVE_DATABASE]),
               "descriptor": describe_file(retained.parent, retained)}
        portable_databases.verify_database_sources(originals)


def _selected(closure):
    plans = {}
    for kind, key in closure.nodes:
        if kind != "conservation-plans":
            continue
        key = identifier(key)
        plan = closure.read("conservation-plans/" + key + "/plan.json")
        study_id = identifier(plan["study_id"])
        study = closure.read("conservation/" + study_id + "/study.json")
        from .conservation_study_transfer import _identity, _reference
        _identity("conservation-plans", key, plan)
        _identity("conservation", study_id, study)
        plans[key] = {"plan": plan, "study": study,
                      "reference": _reference(closure, plan, study)}
    return plans


def _project_record(db, row, plans, workspace_id):
    engine, design, unused = _modules()
    project_id, title, revision, updated, body = row
    project = _project(body)
    envelope = project.get("baseline", {}).get("source", {}).get("conservation")
    if not isinstance(envelope, dict):
        return None
    reference = envelope.get("source_reference") or {}
    plan_id = reference.get("plan_id")
    if reference.get("workspace_id") != workspace_id or plan_id not in plans:
        return None
    engine._key(project_id, "project id")
    if (project.get("id") != project_id or project.get("title") != title
            or not _positive(revision) or not isinstance(updated, str)):
        raise ValueError("The original editor current row differs from its saved project")
    binding = design.binding_for(project)
    if binding is None or binding["source_reference"] != plans[plan_id]["reference"]:
        raise ValueError("The edited project differs from its original selected portfolio")
    engine.validate_project(project)
    baseline = digest(project["baseline"])
    history = []
    for saved_revision, saved, historical_body in db.execute(
            "SELECT revision,saved,body FROM revisions WHERE project_id=? ORDER BY revision",
            (project_id,)):
        historical = _project(historical_body)
        if (not _positive(saved_revision) or saved_revision != len(history) + 1
                or historical.get("id") != project_id
                or digest(historical.get("baseline")) != baseline):
            raise ValueError("The original editor history changed its project, baseline or revision sequence")
        history.append({"revision": saved_revision, "saved": saved,
                        **_body_identity(historical_body)})
        if saved_revision == revision and (historical_body != body or saved != updated):
            raise ValueError("The original editor current row differs from its retained final revision")
    if len(history) != revision:
        raise ValueError("Keep every original editor revision through the captured current row")
    return {
        "id": project_id, "title": title, "revision": revision, "updated": updated,
        **_body_identity(body), "baseline_sha256": baseline,
        "binding_id": binding["id"], "source_reference": deepcopy(binding["source_reference"]),
        "geometry_role": envelope["geometry_role"],
        "alternative_ids": [item["id"] for item in project["alternatives"]],
        "history": history,
    }


def _retained_editor_files(workspace, staged, records):
    """Copy original project references and completed operations through capture."""
    source_root, target_root = Path(workspace.root), Path(staged.root)
    retained = {}
    by_id = {row["id"]: row for row in records}
    engine, design, unused = _modules()

    def retain(path, descriptor=None):
        path = Path(path)
        relative = path.relative_to(source_root).as_posix()
        item = descriptor or describe_file(source_root, path)
        if item["path"] != relative:
            raise ValueError("An editor companion descriptor names another original file")
        original = verify_file(source_root, item)
        target = target_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            pending = None
            try:
                with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".editor-transfer-", delete=False) as out:
                    pending = Path(out.name)
                    with original.open("rb") as incoming:
                        shutil.copyfileobj(incoming, out, 1024 * 1024)
                    out.flush()
                    os.fsync(out.fileno())
                verify_file(pending.parent, {**item, "path": pending.name})
                verify_file(source_root, item)
                try:
                    os.link(pending, target)
                except FileExistsError:
                    pass
            finally:
                if pending is not None:
                    pending.unlink(missing_ok=True)
        verify_file(target_root, item)
        retained[relative] = {**item, "mutable": False}

    def retain_preparation(reference, row):
        # The original editor's open endpoint begins with get_preparation().
        # Keep that immutable parent even when related-result discovery is off.
        key = identifier(reference["preparation_id"])
        directory = source_root / "conservation-design" / "preparations" / key
        path = directory / "preparation.json"
        value = read_json(path)
        if (value.get("schema") != "upstate.conservation-design/v1"
                or value.get("kind") != "preparation" or value.get("state") != "complete"
                or value.get("id") != key or digest(value.get("selection")) != key
                or value.get("workspace_id") != workspace.project["id"]
                or value.get("project_id") != row["id"]
                or value.get("plan_id") != row["source_reference"]["plan_id"]
                or value.get("study_id") != row["source_reference"]["study_id"]
                or value.get("binding_id") != row["binding_id"]
                or value.get("geometry_role") != row["geometry_role"]
                or value["selection"].get("source_reference") != row["source_reference"]):
            raise ValueError("The original editor preparation lost its selected project binding")
        files = value.get("files") or {}
        if not {"binding", "project", "editable_project"}.issubset(files):
            raise ValueError("Retain the complete original editable preparation packet")
        prepared = read_json(verify_file(source_root, files["project"]))
        engine.validate_project(prepared)
        binding = design.binding_for(prepared)
        if (prepared["id"] != row["id"]
                or digest(prepared["baseline"]) != row["baseline_sha256"]
                or binding is None or binding["id"] != row["binding_id"]
                or binding["source_reference"] != row["source_reference"]
                or read_json(verify_file(source_root, files["binding"])) != binding):
            raise ValueError("The prepared original project differs from its captured editor baseline")
        retain(path)
        for descriptor in files.values():
            original = verify_file(source_root, descriptor)
            if not original.resolve().is_relative_to(directory.resolve()):
                raise ValueError("An editor preparation names a file outside its original packet")
            retain(original, descriptor)

    for path in sorted((source_root / EDITOR / "preparations").glob("*.json")):
        value = read_json(path)
        project_id = value.get("project_id")
        if project_id not in by_id:
            continue
        row = by_id[project_id]
        if (value.get("schema") != "upstate.conservation-design-editor/v1"
                or value.get("workspace_id") != workspace.project["id"]
                or value.get("preparation_id") != path.stem
                or value.get("plan_id") != row["source_reference"]["plan_id"]
                or value.get("study_id") != row["source_reference"]["study_id"]
                or value.get("binding_id") != row["binding_id"]):
            raise ValueError("The original editor preparation reference differs from its captured project")
        identifier(path.stem)
        retain_preparation(value, row)
        retain(path)
    for path in sorted((source_root / EDITOR / "operations").glob("*/operation.json")):
        value = read_json(path)
        response = value.get("response") or {}
        project = response.get("project") or {}
        project_id = response.get("project_id") or project.get("id")
        if project_id not in by_id:
            continue
        row = by_id[project_id]
        response_revision = response.get("revision")
        if not _positive(response_revision) or response_revision > row["revision"]:
            continue  # A later committed operation is outside this earlier frozen Store snapshot.
        if (value.get("schema") != "upstate.conservation-design-editor/v1"
                or value.get("state") != "complete" or value.get("id") != path.parent.name
                or value.get("workspace_id") != workspace.project["id"]
                or value.get("selection_digest") != digest(value.get("selection"))):
            raise ValueError("The original editor operation changed its retained identity")
        identifier(value["id"])
        if project and (project.get("id") != project_id
                        or digest(project.get("baseline")) != row["baseline_sha256"]):
            raise ValueError("An original editor operation contains another baseline")
        if project:
            expected = row["history"][response_revision - 1]
            if hashlib.sha256(engine.encode(project)).hexdigest() != expected["body_sha256"]:
                raise ValueError("An original editor operation differs from its captured revision")
        retain(path)
        for descriptor in value.get("files", {}).values():
            original = verify_file(source_root, descriptor)
            retain(original, descriptor)
    return retained


def capture(workspace, staged, closure, *, database=None):
    """Return (history, members) for the existing selected-study archive writer.

    Call after ordinary closure files have been staged. Use the source_snapshot
    captured before closure resolution. The only new Store is in the private
    staged Workspace; original source UUIDs, BLOBs and revision rows are retained.
    """
    if database is None:
        return None, {}
    if staged.project["id"] != workspace.project["id"]:
        raise ValueError("The staged editor history belongs to another original Workspace")
    plans = _selected(closure)
    if not plans:
        return None, {}
    source = Path(database["path"])
    verify_file(source.parent, database["descriptor"])
    records = []
    with closing(_readonly(source)) as db:
        _schema(db)
        for row in db.execute("SELECT id,title,revision,updated,body FROM projects ORDER BY id"):
            record = _project_record(db, row, plans, workspace.project["id"])
            if record is not None:
                records.append(record)
        if not records:
            return None, {}
        target = Path(staged.root) / DATABASE
        if target.exists() or target.is_symlink():
            raise ValueError("Stage the selected editor history once before writing its archive")
        unused_engine, unused_design, server = _modules()
        target_store = server.Store(target)
        with target_store.connect() as output:
            output.execute("BEGIN IMMEDIATE")
            for record in records:
                project_id = record["id"]
                original = db.execute(
                    "SELECT id,title,revision,updated,body FROM projects WHERE id=?", (project_id,)).fetchone()
                output.execute("INSERT INTO projects VALUES (?,?,?,?,?)", original)
                output.executemany("INSERT INTO revisions VALUES (?,?,?,?)", db.execute(
                    "SELECT project_id,revision,saved,body FROM revisions WHERE project_id=? ORDER BY revision",
                    (project_id,)))
        # This private closed copy becomes one exact frozen SQLite archive member.
        with closing(sqlite3.connect(target)) as output:
            output.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            mode = output.execute("PRAGMA journal_mode=DELETE").fetchone()[0]
            if mode.lower() != "delete":
                raise ValueError("The selected editor snapshot must be self-contained")
            _schema(output)
        for suffix in ("-wal", "-shm", "-journal"):
            if target.with_name(target.name + suffix).exists():
                raise ValueError("Close the original selected editor snapshot before archive capture")
    members = _retained_editor_files(workspace, staged, records)
    item = describe_file(staged.root, Path(staged.root) / DATABASE)
    members[DATABASE] = {**item, "mutable": True}
    history = {
        "schema": SCHEMA, "project_id": workspace.project["id"],
        "method": "sqlite-online-backup-selected-original-projects",
        "source_snapshot": deepcopy(database["source"]),
        "source_snapshot_file": {key: database["descriptor"][key] for key in ("bytes", "sha256")},
        "selected_plan_ids": sorted(plans),
        "editor_project_ids": [row["id"] for row in records],
        "projects": records, "database": deepcopy(item),
        "members": [members[name] for name in sorted(members)],
        "receiving": "Original Store UUID/current body/all captured revisions; later live saves may extend history",
    }
    verify(staged, history)
    return history, members


def verify(workspace, history):
    """Verify the captured original revision prefix while allowing later saves."""
    if history is None:
        return None
    if (not isinstance(history, dict) or history.get("schema") != SCHEMA
            or history.get("project_id") != workspace.project["id"]
            or history.get("method") != "sqlite-online-backup-selected-original-projects"):
        raise ValueError("The received original editor history belongs to another capture")
    rows = history.get("projects")
    if (not isinstance(rows, list) or not rows
            or history.get("editor_project_ids") != [row["id"] for row in rows]
            or len({row["id"] for row in rows}) != len(rows)
            or history["database"].get("path") != DATABASE):
        raise ValueError("Retain the original selected editor project inventory")
    for item in history["members"]:
        if item["path"] != DATABASE:
            verify_file(workspace.root, item)
    path = Path(workspace.root) / DATABASE
    if path.is_symlink() or not path.resolve().is_relative_to(Path(workspace.root).resolve()):
        raise ValueError("Keep the received original editor Store within its Workspace")
    engine, design, unused = _modules()
    with closing(_readonly(path)) as db:
        _schema(db)
        for retained in rows:
            project_id = engine._key(retained["id"], "project id")
            current = db.execute("SELECT title,revision,updated,body FROM projects WHERE id=?",
                                 (project_id,)).fetchone()
            if current is None or not _positive(current[1]) or current[1] < retained["revision"]:
                raise ValueError("The received editor lost an original captured project revision")
            project = _project(current[3])
            engine.validate_project(project)
            tip = db.execute(
                "SELECT saved,body FROM revisions WHERE project_id=? AND revision=?",
                (project_id, current[1])).fetchone()
            if (project.get("title") != current[0] or tip is None
                    or tip[0] != current[2] or tip[1] != current[3]):
                raise ValueError("The received editor current pointer differs from its atomic saved revision")
            binding = design.binding_for(project)
            if (project.get("id") != project_id or digest(project.get("baseline")) != retained["baseline_sha256"]
                    or binding is None or binding["id"] != retained["binding_id"]
                    or binding["source_reference"] != retained["source_reference"]):
                raise ValueError("The received editor project changed its original baseline or portfolio")
            if current[1] == retained["revision"] and (
                    current[0] != retained["title"] or current[2] != retained["updated"]
                    or _body_identity(current[3]) != {
                        name: retained[name] for name in ("body_bytes", "body_sha256", "body_storage")}):
                raise ValueError("The received current editor row differs from the captured revision")
            historical = list(db.execute(
                "SELECT revision,saved,body FROM revisions WHERE project_id=? AND revision<=? ORDER BY revision",
                (project_id, retained["revision"])))
            if len(historical) != len(retained["history"]) or len(historical) != retained["revision"]:
                raise ValueError("The received editor lost original captured revision history")
            for (revision, saved, body), expected in zip(historical, retained["history"]):
                if (revision != expected["revision"] or saved != expected["saved"]
                        or _body_identity(body) != {
                            name: expected[name] for name in ("body_bytes", "body_sha256", "body_storage")}):
                    raise ValueError("The received original editor revision body changed")
            captured = _project(historical[-1][2])
            if [item["id"] for item in captured["alternatives"]] != retained["alternative_ids"]:
                raise ValueError("The received editor lost an original captured alternative")
    return deepcopy(history)

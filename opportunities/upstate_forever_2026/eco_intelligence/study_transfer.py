"""Selected-study snapshots of the original investigation Store.

Authored by TokenJunkieLabs. Preparation runs before the caller takes the original
Workspace lock. The returned callback runs while that lock is held exclusively.
It uses SQLite.backup against the original database, preserves complete selected
sessions, and filters only the private snapshot assembled for portable export.
"""
from __future__ import annotations

from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import uuid

from .common import IntelligenceError, digest as evidence_digest, file_digest, now
from model.common import atomic_bytes, digest as native_digest, read_json, verify_file

FORMAT = "upstate.selected-study-investigations/v1"
_SCHEMA_TABLES = frozenset({
    "sessions", "events", "evidence", "plans", "requests",
    "upstate_native_bindings", "upstate_native_task_receipts",
})
_ID = re.compile(r"^[0-9a-f]{64}$")
_SESSION = re.compile(r"^(?:[0-9a-f]{32}|[0-9a-f]{64})$")
_DATASET = re.compile(r"^es26:([0-9a-f]{64}):[^:]+$")
_REVISION = re.compile(r"^es26:([0-9a-f]{64}):report_revision_([0-9a-f]{64})$")


def snapshot_project_state(
    workspace, source_connection, destination, *, namespace, workspace_key=None,
    snapshot_format=FORMAT + "/state-snapshot", transform=None,
):
    """Shared implementation of the original consistent SQLite snapshot."""
    destination = Path(destination).absolute()
    if destination.exists() or destination.is_symlink():
        raise IntelligenceError("Select a new investigation snapshot destination.", 409)
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    selection = None
    try:
        handle, name = tempfile.mkstemp(prefix=".investigations-", dir=destination.parent)
        os.close(handle)
        pending = Path(name)
        with closing(sqlite3.connect(str(pending))) as dst:
            source_connection.backup(dst)
            # The exported state is one complete database. Restored ProjectStore
            # connections establish their normal WAL mode on first opening.
            if dst.execute("PRAGMA journal_mode=DELETE").fetchone()[0].lower() != "delete":
                raise IntelligenceError("The snapshot could not close its journal.", 409)
            if transform is not None:
                selection = transform(dst)
            if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise IntelligenceError("The investigation snapshot could not be received.", 409)
            bindings = [json.loads(row[0]) for row in dst.execute(
                "SELECT body FROM upstate_native_bindings WHERE tenant=? ORDER BY plan_id",
                (namespace,),
            )]
            captured_tasks = []
            for binding in bindings:
                saved = dst.execute(
                    "SELECT body,observed_at FROM upstate_native_task_receipts "
                    "WHERE tenant=? AND task_id=? "
                    "ORDER BY observed_at DESC,source_sha256 DESC LIMIT 1",
                    (namespace, binding["native_task_id"]),
                ).fetchone()
                task = json.loads(saved[0]) if saved else None
                captured_tasks.append({
                    "plan_id": binding["plan_id"], "task_id": binding["native_task_id"],
                    "operation_id": binding["native_operation_id"],
                    "native_state": task.get("state") if task else None,
                    "task_source": "snapshot_record" if task else "pending_admission",
                    "observed_at": saved[1] if saved else None,
                })
            dst.commit()
        with pending.open("rb") as handle:
            os.fsync(handle.fileno())
        os.link(pending, destination)
        descriptor = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        result = {
            "format": snapshot_format, "workspace_key": workspace_key,
            "project_id": workspace.project["id"],
            "project_sha256": native_digest(workspace.project),
            "path": str(destination), "bytes": destination.stat().st_size,
            "sha256": file_digest(destination), "native_tasks": captured_tasks,
            "state_file": "investigations.sqlite3", "created_at": now(),
        }
        if selection is not None:
            result["selection"] = selection
        return result
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _body(value):
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise IntelligenceError("A retained investigation record is not an object.", 409)
    return parsed


def _source_reasons(value, diagnostics, runs, experiments):
    reasons = set()
    if isinstance(value, list):
        for item in value:
            reasons.update(_source_reasons(item, diagnostics, runs, experiments))
    elif isinstance(value, dict):
        kind, key = value.get("kind"), value.get("id")
        if kind == "dataset" and isinstance(key, str):
            match = _DATASET.fullmatch(key)
            if match and match[1] in diagnostics:
                reasons.add("diagnostic:" + match[1])
        if kind == "artifact" and key in runs:
            reasons.add("run:" + key)
        if value.get("registry") == "job" and key in runs:
            reasons.add("run:" + key)
        if value.get("operation") == "job" and value.get("object_id") in runs:
            reasons.add("run:" + value["object_id"])
        if kind in {"run_job", "ensemble"} and value.get("job_id") in runs:
            reasons.add("run:" + value["job_id"])
        if value.get("operation") == "ensemble" and value.get("object_id") in experiments:
            reasons.add("experiment:" + value["object_id"])
        if value.get("native_experiment_id") in experiments:
            reasons.add("experiment:" + value["native_experiment_id"])
        native = value.get("native_experiment")
        if isinstance(native, dict) and native.get("id") in experiments:
            reasons.add("experiment:" + native["id"])
        for child in value.values():
            if isinstance(child, (dict, list)):
                reasons.update(_source_reasons(child, diagnostics, runs, experiments))
    return reasons


def _safe_member(root, path):
    path = Path(path)
    resolved = path.resolve()
    if path.is_symlink() or not resolved.is_relative_to(root):
        raise IntelligenceError("An investigation member leaves its original workspace.", 409)
    return resolved.relative_to(root).as_posix()


def _associations(root, project_id, diagnostics):
    records = []
    base = root / "intelligence" / "diagnostic-sessions"
    for key in sorted(diagnostics):
        candidates = [base / (key + ".json")]
        directory = base / key
        if directory.is_dir():
            candidates.extend(sorted(directory.glob("*.json")))
        for path in candidates:
            if not path.is_file():
                continue
            member = _safe_member(root, path)
            value = read_json(path)
            sid = value.get("session_id")
            if (
                value.get("schema") != "upstate.diagnostic-investigation/v1"
                or value.get("project_id") != project_id
                or value.get("diagnostic_id") != key
                or value.get("dataset_id") != "es26:" + key + ":report_json"
                or not isinstance(sid, str) or not _SESSION.fullmatch(sid)
            ):
                raise IntelligenceError("A selected diagnostic association is invalid.", 409)
            records.append({"path": path, "member": member, "value": value})
    return records


def _select_sessions(db, namespace, diagnostics, runs, experiments, associations):
    sessions = {
        row[0]: {"id": row[0], "title": row[1], "created": row[2], "reasons": set()}
        for row in db.execute(
            "SELECT id,title,created FROM sessions WHERE tenant=? ORDER BY created,id",
            (namespace,),
        )
    }
    for record in associations:
        value = record["value"]
        if value["session_id"] not in sessions:
            raise IntelligenceError("A selected diagnostic session is absent from its Store.", 409)
        sessions[value["session_id"]]["reasons"].add("diagnostic:" + value["diagnostic_id"])
    for table in ("evidence", "plans"):
        for sid, body in db.execute(
            "SELECT session,body FROM " + table + " WHERE tenant=?", (namespace,)
        ):
            value = _body(body)
            # Inspect only the retained source/operation graph. Numerical report
            # contents and arbitrary conversation prose do not select sessions.
            context = ({"operation": value.get("operation"), "sources": value.get("sources")}
                       if table == "evidence" else value)
            reasons = _source_reasons(context, diagnostics, runs, experiments)
            if reasons:
                if sid not in sessions:
                    raise IntelligenceError("Investigation evidence has no original session.", 409)
                sessions[sid]["reasons"].update(reasons)
    return [
        {**row, "reasons": sorted(row["reasons"])}
        for _, row in sorted(sessions.items()) if row["reasons"]
    ]



def _scientific_dependencies(db, namespace, sessions, workspace_root):
    """Resolve only typed original source references from the frozen cohort.

    Conversation text and inventory result snapshots do not select scientific
    objects. The original repository metadata provides the source-edition
    bindings for its content-addressed dataset IDs.
    """
    dependencies = {}
    unsupported = set()
    root = Path(workspace_root)

    def add(kind, key, reason):
        if not isinstance(key, str) or not _ID.fullmatch(key):
            raise IntelligenceError("A retained investigation has an invalid scientific identity.", 409)
        token = (kind, key)
        dependencies.setdefault(token, {
            "kind": kind, "id": key, "reason": reason, "required": True,
        })

    def metadata_dependencies(metadata, reason):
        if not isinstance(metadata, dict):
            return False
        matched = False
        binding = metadata.get("source_binding")
        if isinstance(binding, dict) and binding.get("collection_id") is not None:
            add("sources", binding["collection_id"], reason)
            matched = True
        kind = metadata.get("native_kind")
        if kind == "retained_observation_table":
            add("observations", metadata.get("observation_id"), reason)
            matched = True
        elif kind == "prepared_grid":
            # The installed science catalogue binds each role to its retained
            # grid edition. Resolve that typed grid through the original study
            # graph so its selected sources and alignment metadata travel too.
            add("grids", metadata.get("grid_id"), reason)
            matched = True
        elif kind in {"grids", "comparisons", "observation_comparisons"}:
            add(kind.replace("_", "-"), metadata.get("native_id"), reason)
            matched = True
        elif kind == "scenario_experiment":
            key = metadata.get("experiment_id")
            if key is not None:
                add("experiments", key, reason)
                matched = True
        if metadata.get("native_run_id") is not None:
            add("runs", metadata["native_run_id"], reason)
            matched = True
        return matched

    def source_reference(ref, metadata, reason):
        if not isinstance(ref, dict):
            return
        kind, key = ref.get("kind"), ref.get("id")
        if kind == "artifact":
            add("runs", key, reason)
            return
        if kind != "dataset":
            return
        if not isinstance(key, str):
            raise IntelligenceError("A retained investigation dataset reference is invalid.", 409)
        match = _DATASET.fullmatch(key)
        if match:
            add("experiment-diagnostics", match[1], reason)
            return
        if key.startswith("observation-") and _ID.fullmatch(key[len("observation-"):]):
            add("observations", key[len("observation-"):], reason)
            return
        if metadata_dependencies(metadata, reason):
            return
        unsupported.add(key)

    def ensemble_reference(key, metadata, reason):
        if not isinstance(key, str) or not _ID.fullmatch(key):
            raise IntelligenceError("A retained native ensemble identity is invalid.", 409)
        if ((root / "experiments" / key / "plan.json").is_file()
                or (isinstance(metadata, dict)
                    and metadata.get("native_kind") == "scenario_experiment")):
            add("experiments", key, reason)
        else:
            unsupported.add("ensemble:" + key)

    def sources_and_refs(sources, refs, reason):
        known = {}
        for source in sources or []:
            if not isinstance(source, dict):
                raise IntelligenceError("A retained investigation source is not an original descriptor.", 409)
            ref = source.get("ref")
            if isinstance(ref, dict):
                known[json.dumps(ref, sort_keys=True, separators=(",", ":"))] = source.get("metadata")
                source_reference(ref, source.get("metadata"), reason)
            registry = source.get("registry")
            if registry == "job":
                add("runs", source.get("id"), reason)
            elif registry == "ensemble":
                ensemble_reference(source.get("id"), source.get("metadata"), reason)
        for ref in refs:
            if not isinstance(ref, dict):
                continue
            key = json.dumps(ref, sort_keys=True, separators=(",", ":"))
            # Prepared plans and inspections retain the exact source metadata
            # alongside their typed references. Do not parse dataset hashes.
            if key not in known:
                source_reference(ref, None, reason)

    for session in sessions:
        sid = session["id"]
        reason = "Original investigation " + sid
        for body, in db.execute(
            "SELECT body FROM evidence WHERE tenant=? AND session=? ORDER BY id", (namespace, sid)
        ):
            evidence = _body(body)
            operation = evidence.get("operation") or {}
            refs = [operation.get("ref"), operation.get("other")]
            sources_and_refs(evidence.get("sources"), refs, reason)
            if operation.get("operation") == "job":
                add("runs", operation.get("object_id"), reason)
            elif operation.get("operation") == "ensemble":
                result = evidence.get("result") or {}
                ensemble_reference(operation.get("object_id"), result.get("metadata"), reason)
        for plan_id, body in db.execute(
            "SELECT id,body FROM plans WHERE tenant=? AND session=? ORDER BY id", (namespace, sid)
        ):
            plan = _body(body)
            action = plan.get("action") or {}
            refs = list(action.get("refs") or []) + [action.get("observed"), action.get("predicted")]
            sources_and_refs(plan.get("sources"), refs, reason)
            if action.get("kind") in {"run_job", "ensemble"} and action.get("job_id") is not None:
                add("runs", action["job_id"], reason)
            if action.get("native_experiment_id") is not None:
                add("experiments", action["native_experiment_id"], reason)
            context = plan.get("context") or {}
            native = context.get("native_experiment")
            if isinstance(native, dict) and native.get("id") is not None:
                add("experiments", native["id"], reason)
            for native_body, in db.execute(
                "SELECT body FROM upstate_native_bindings WHERE tenant=? AND plan_id=?",
                (namespace, plan_id),
            ):
                binding = _body(native_body)
                payload = binding.get("native_payload") or {}
                if binding.get("native_action") == "run.start":
                    add("runs", payload.get("run_id"), reason)
                elif binding.get("native_action") == "experiment.run":
                    add("experiments", payload.get("experiment_id"), reason)
        for body, in db.execute(
            "SELECT body FROM events WHERE session=? AND kind='diagnostic_context'", (sid,)
        ):
            value = _body(body)
            if value.get("diagnostic_id") is not None:
                add("experiment-diagnostics", value["diagnostic_id"], reason)
            for diagnostic_id, _ in _revision_references(value):
                add("experiment-diagnostics", diagnostic_id, reason)
    if unsupported:
        raise IntelligenceError(
            "The selected investigation needs the original scientific dependency binding for: "
            + ", ".join(sorted(unsupported)), 409,
        )
    return [dependencies[key] for key in sorted(dependencies)]


def _filter_snapshot(db, namespace, selected):
    tables = {row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )}
    if tables != _SCHEMA_TABLES:
        raise IntelligenceError("The investigation snapshot schema needs its matching transfer adapter.", 409)
    db.execute("PRAGMA secure_delete=ON")
    db.execute("CREATE TEMP TABLE selected_sessions(id TEXT PRIMARY KEY)")
    db.executemany(
        "INSERT INTO selected_sessions(id) VALUES (?)", ((row["id"],) for row in selected)
    )
    try:
        db.execute(
            "DELETE FROM sessions WHERE tenant<>? OR id NOT IN (SELECT id FROM selected_sessions)",
            (namespace,),
        )
        db.execute("DELETE FROM events WHERE session NOT IN (SELECT id FROM sessions)")
        for table in ("evidence", "plans", "requests"):
            db.execute(
                "DELETE FROM " + table +
                " WHERE tenant<>? OR session NOT IN (SELECT id FROM sessions)", (namespace,),
            )
        db.execute(
            "DELETE FROM upstate_native_bindings "
            "WHERE tenant<>? OR plan_id NOT IN (SELECT id FROM plans)", (namespace,),
        )
        task_ids = set()
        for body, in db.execute("SELECT body FROM upstate_native_bindings WHERE tenant=?", (namespace,)):
            value = _body(body)
            task_id = value.get("native_task_id")
            if not isinstance(task_id, str) or not _ID.fullmatch(task_id):
                raise IntelligenceError("A native investigation binding has an invalid task ID.", 409)
            task_ids.add(task_id)
        db.execute("CREATE TEMP TABLE selected_tasks(id TEXT PRIMARY KEY)")
        db.executemany("INSERT INTO selected_tasks(id) VALUES (?)", ((key,) for key in sorted(task_ids)))
        db.execute(
            "DELETE FROM upstate_native_task_receipts "
            "WHERE tenant<>? OR task_id NOT IN (SELECT id FROM selected_tasks)", (namespace,),
        )
        db.commit()
        # Remove the excluded rows from free database pages as well as indexes.
        db.execute("VACUUM")
        counts = {table: db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
                  for table in sorted(_SCHEMA_TABLES)}
        evidence = [
            {"session_id": row[0], "evidence_id": row[1]}
            for row in db.execute("SELECT session,id FROM evidence ORDER BY session,id")
        ]
        plans = [
            {"session_id": row[0], "plan_id": row[1], "status": row[2]}
            for row in db.execute("SELECT session,id,status FROM plans ORDER BY session,id")
        ]
        return {"sessions": selected, "evidence": evidence, "plans": plans, "counts": counts,
                "native_task_ids": sorted(task_ids)}
    except Exception:
        db.rollback()
        raise


def _copy_member(root, staged_root, path, descriptors):
    member = _safe_member(root, path)
    target = staged_root / member
    if not target.resolve().is_relative_to(staged_root):
        raise IntelligenceError("An investigation export leaves the selected study.", 409)
    body = Path(path).read_bytes()
    source_sha = hashlib.sha256(body).hexdigest()
    if file_digest(path) != source_sha:
        raise IntelligenceError("An investigation member changed during transfer.", 409)
    if target.is_symlink():
        raise IntelligenceError("The selected study member is a symbolic link.", 409)
    if target.is_file():
        if target.stat().st_size != len(body) or file_digest(target) != source_sha:
            raise IntelligenceError("The selected study already contains different investigation state.", 409)
    else:
        atomic_bytes(target, body, immutable=True)
    if file_digest(target) != source_sha:
        raise IntelligenceError("The investigation copy does not match its retained source.", 409)
    descriptors[member] = {"path": member, "bytes": len(body), "sha256": source_sha}
    if member.startswith("intelligence/diagnostic-sessions/"):
        descriptors[member]["mutable"] = True


def _revision_references(value):
    found = set()
    if isinstance(value, list):
        for child in value:
            found.update(_revision_references(child))
    elif isinstance(value, dict):
        candidates = [value.get("report_dataset_id")]
        if value.get("kind") == "dataset":
            candidates.append(value.get("id"))
        for candidate in candidates:
            if isinstance(candidate, str):
                match = _REVISION.fullmatch(candidate)
                if match:
                    found.add((match[1], match[2]))
        for child in value.values():
            if isinstance(child, (dict, list)):
                found.update(_revision_references(child))
    return found


def _selected_revisions(db, namespace, sessions):
    revisions = set()
    for session in sessions:
        for table in ("evidence", "plans"):
            for body, in db.execute(
                "SELECT body FROM " + table + " WHERE tenant=? AND session=?",
                (namespace, session["id"]),
            ):
                revisions.update(_revision_references(_body(body)))
        for body, in db.execute(
            "SELECT body FROM events WHERE session=? AND kind='diagnostic_context'",
            (session["id"],),
        ):
            revisions.update(_revision_references(_body(body)))
    return sorted(revisions)


def _copy_revision_members(root, staged_root, project_id, revisions, descriptors):
    for diagnostic_id, sha in revisions:
        folder = root / "intelligence" / "diagnostic-revisions" / diagnostic_id / sha
        manifest_path = folder / "manifest.json"
        _safe_member(root, manifest_path)
        manifest = read_json(manifest_path)
        descriptor = manifest.get("report") or {}
        if (
            manifest.get("schema") != "upstate.diagnostic-report-revision/v1"
            or manifest.get("project_id") != project_id
            or manifest.get("diagnostic_id") != diagnostic_id
            or manifest.get("source_sha256") != sha
            or manifest.get("dataset_id") != "es26:" + diagnostic_id + ":report_revision_" + sha
            or descriptor.get("sha256") != sha
        ):
            raise IntelligenceError("A saved investigation revision has another source identity.", 409)
        path = verify_file(root, descriptor)
        if path.resolve() != (folder / "report.json").resolve():
            raise IntelligenceError("The saved report revision names another member.", 409)
        _copy_member(root, staged_root, path, descriptors)
        _copy_member(root, staged_root, manifest_path, descriptors)


def _copy_session_members(root, staged_root, project_id, selected, associations):
    ids = {row["id"] for row in selected}
    descriptors = {}
    for record in associations:
        if record["value"]["session_id"] in ids:
            _copy_member(root, staged_root, record["path"], descriptors)
    receipts = root / "intelligence" / "operator-receipts"
    if receipts.is_dir():
        for path in sorted(receipts.glob("*.json")):
            value = read_json(path)
            if (value.get("result") or {}).get("session_id") not in ids:
                continue
            if value.get("project_id") != project_id:
                raise IntelligenceError("A selected operator receipt belongs to another project.", 409)
            _copy_member(root, staged_root, path, descriptors)
    exports = root / "intelligence" / "operator-exports"
    if exports.is_dir():
        for manifest in sorted(exports.glob("*/manifest.json")):
            record = read_json(manifest)
            if record.get("session_id") not in ids:
                continue
            files = record.get("files") or {}
            if (record.get("schema") != "upstate.intelligence-export/v1"
                    or record.get("id") != manifest.parent.name
                    or set(files) != {"json", "html"}
                    or record.get("snapshot_sha256") != files["json"].get("sha256")):
                raise IntelligenceError("A selected investigation export is invalid.", 409)
            for format_name, descriptor in files.items():
                path = verify_file(root, descriptor)
                expected = manifest.parent / ("investigation." + format_name)
                if path.resolve() != expected.resolve():
                    raise IntelligenceError("A selected investigation export names another member.", 409)
                _copy_member(root, staged_root, path, descriptors)
            _copy_member(root, staged_root, manifest, descriptors)
    return descriptors


def prepare_workspace_study_snapshot(
    workspace, *, database_path=None, workspace_key=None, validate_binding=None,
    snapshot_format=FORMAT + "/state-snapshot",
):
    """Prepare the original default Store without constructing an Operator.

    Returns None when the selected workspace has no default investigation DB.
    Call before acquiring the exclusive Workspace lock. Invoke the returned
    callback(staged_workspace, plan) inside the original selected-study guard.
    A configured UpstateInvestigations may supply its actual bound Store path.
    """
    root = workspace.root.resolve()
    project = dict(workspace.project)
    project_id = project.get("id")
    try:
        valid = isinstance(project_id, str) and str(uuid.UUID(project_id)) == project_id
    except (ValueError, AttributeError):
        valid = False
    if not valid:
        raise IntelligenceError("The original workspace project UUID is invalid.", 409)
    project_sha = native_digest(project)
    namespace = "project:" + project_id
    path = Path(database_path) if database_path is not None else root / "intelligence" / "investigations.sqlite3"
    if not path.is_file():
        if database_path is not None:
            raise IntelligenceError("The bound original investigation database is unavailable.", 409)
        return None
    path = path.resolve()

    prepared = None

    def validate_plan(plan):
        if validate_binding is not None:
            validate_binding()
        if (workspace.root.resolve() != root or native_digest(workspace.project) != project_sha
                or native_digest(plan.get("project")) != project_sha):
            raise IntelligenceError("The study snapshot belongs to another original project.", 409)
        if plan.get("schema") != "upstate.study-transfer-plan/v1":
            raise IntelligenceError("Use the original selected-study plan.", 409)

    def prepare(plan):
        """Freeze the initial session cohort and return its typed native roots.

        The caller holds the original exclusive Workspace lock throughout this
        call, native closure expansion and capture. Expanded science does not
        select more sessions.
        """
        nonlocal prepared
        validate_plan(plan)
        selection_sha = native_digest(plan.get("selection"))
        if prepared is not None:
            if prepared["selection_sha256"] != selection_sha:
                raise IntelligenceError("The selected investigation cohort belongs to another study.", 409)
            return json.loads(json.dumps(prepared["public"]))
        nodes = plan.get("nodes", [])

        def selected(kind):
            result = {row["id"] for row in nodes if row.get("kind") == kind}
            if any(not isinstance(key, str) or not _ID.fullmatch(key) for key in result):
                raise IntelligenceError("The study contains an invalid native identity.", 409)
            return result

        diagnostics, runs, experiments = (
            selected("experiment-diagnostics"), selected("runs"), selected("experiments")
        )
        initial_associations = _associations(root, project_id, diagnostics)
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=30)) as src:
            src.execute("BEGIN")
            sessions = _select_sessions(
                src, namespace, diagnostics, runs, experiments, initial_associations
            )
            dependencies = _scientific_dependencies(src, namespace, sessions, root)
            src.rollback()
        session_ids = {row["id"] for row in sessions}
        # Copy associations for additional diagnostics used within these exact
        # sessions; their other sessions are deliberately outside the cohort.
        for dependency in dependencies:
            if dependency["kind"] == "experiment-diagnostics":
                diagnostics.add(dependency["id"])
            elif dependency["kind"] == "runs":
                runs.add(dependency["id"])
            elif dependency["kind"] == "experiments":
                experiments.add(dependency["id"])
        associations = [
            row for row in _associations(root, project_id, diagnostics)
            if row["value"]["session_id"] in session_ids
        ]
        public = {
            "schema": FORMAT + "/science-dependencies", "project_id": project_id,
            "session_ids": sorted(session_ids), "scientific_dependencies": dependencies,
        }
        prepared = {
            "selection_sha256": selection_sha, "sessions": sessions,
            "diagnostics": diagnostics, "runs": runs, "experiments": experiments,
            "associations": associations, "public": public,
        }
        return json.loads(json.dumps(public))

    def capture(staged_workspace, plan):
        validate_plan(plan)
        if prepared is None:
            raise IntelligenceError("Prepare the selected investigation cohort before scientific staging.", 409)
        if prepared["selection_sha256"] != native_digest(plan.get("selection")):
            raise IntelligenceError("The selected investigation cohort belongs to another study.", 409)
        if native_digest(staged_workspace.project) != project_sha:
            raise IntelligenceError("The receiving investigation project has another identity.", 409)
        staged_root = staged_workspace.root.resolve()
        if staged_root == root:
            raise IntelligenceError("Select a private receiving directory for the study.", 409)
        sessions = prepared["sessions"]
        if not sessions:
            return None
        diagnostics, runs, experiments = (
            prepared["diagnostics"], prepared["runs"], prepared["experiments"]
        )
        associations = prepared["associations"]

        destination = staged_root / "intelligence" / "investigations.sqlite3"
        # The caller already holds the original exclusive .workspace.lock.
        # Opening this read-only connection never reacquires ProjectStore's SH lock.
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=30)) as src:
            src.execute("BEGIN")
            if (_scientific_dependencies(src, namespace, sessions, root)
                    != prepared["public"]["scientific_dependencies"]):
                raise IntelligenceError("The selected investigation science changed during capture.", 409)
            revisions = set(_selected_revisions(src, namespace, sessions))
            selected_session_ids = {row["id"] for row in sessions}
            for association in associations:
                if association["value"]["session_id"] in selected_session_ids:
                    revisions.update(_revision_references(association["value"]))
            revisions = sorted(revisions)
            snapshot = snapshot_project_state(
                workspace, src, destination, namespace=namespace, workspace_key=workspace_key,
                snapshot_format=snapshot_format,
                transform=lambda db: _filter_snapshot(db, namespace, sessions),
            )
        descriptors = _copy_session_members(root, staged_root, project_id, sessions, associations)
        _copy_revision_members(root, staged_root, project_id, revisions, descriptors)
        member = destination.relative_to(staged_root).as_posix()
        descriptors[member] = {
            "path": member, "bytes": snapshot["bytes"], "sha256": snapshot["sha256"], "mutable": True,
        }
        selection = snapshot["selection"]
        return {
            "schema": FORMAT, "project_id": project_id, "project_sha256": project_sha,
            "storage_namespace": namespace, "included": True,
            "diagnostic_ids": sorted(diagnostics), "run_ids": sorted(runs),
            "experiment_ids": sorted(experiments), "sessions": selection["sessions"],
            "evidence": selection["evidence"], "plans": selection["plans"],
            "counts": selection["counts"], "native_tasks": snapshot["native_tasks"],
            "members": [descriptors[key] for key in sorted(descriptors)],
            "session_ids": [row["id"] for row in selection["sessions"]],
            "scientific_dependencies": prepared["public"]["scientific_dependencies"],
            "evidence_ids": sorted({row["evidence_id"] for row in selection["evidence"]}),
            "plan_ids": [row["plan_id"] for row in selection["plans"]],
            "native_task_ids": selection["native_task_ids"],
            "report_revisions": [{"diagnostic_id": key, "sha256": sha} for key, sha in revisions],
            "associations": [row["value"] for row in associations
                             if row["value"]["session_id"] in {item["id"] for item in sessions}],
            "created_at": snapshot["created_at"],
        }

    capture.prepare = prepare
    return capture


def verify_received_investigations(workspace, receipt, *, database_path=None):
    """Verify retained identities while allowing later conversation history.

    The archive's initial member hashes are verified by original portable receive.
    A live Store may gain rows and an interrupted association may gain its evidence.
    Immutable report revisions, receipts and exported reports keep their hashes.
    """
    if receipt is None:
        return None
    root = workspace.root.resolve()
    project_id = workspace.project["id"]
    namespace = "project:" + project_id
    if (receipt.get("schema") != FORMAT or receipt.get("project_id") != project_id
            or receipt.get("storage_namespace") != namespace):
        raise IntelligenceError("The investigation handover belongs to another project.", 409)
    for member in receipt.get("members", []):
        path = root / member["path"]
        if not path.resolve().is_relative_to(root):
            raise IntelligenceError("A received investigation member leaves its workspace.", 409)
        if not member.get("mutable"):
            verify_file(root, member)
    path = Path(database_path) if database_path is not None else root / "intelligence" / "investigations.sqlite3"
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=30)) as db:
        db.execute("BEGIN")
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise IntelligenceError("The received investigation Store is inconsistent.", 409)
        tables = {row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )}
        if not _SCHEMA_TABLES.issubset(tables):
            raise IntelligenceError("The received Store lacks its original investigation schema.", 409)
        for sid in receipt.get("session_ids", []):
            if db.execute("SELECT 1 FROM sessions WHERE tenant=? AND id=?", (namespace, sid)).fetchone() is None:
                raise IntelligenceError("A retained investigation session is missing.", 409)
        for item in receipt.get("evidence", []):
            row = db.execute(
                "SELECT body FROM evidence WHERE tenant=? AND session=? AND id=?",
                (namespace, item["session_id"], item["evidence_id"]),
            ).fetchone()
            if row is None or "E" + evidence_digest(_body(row[0]))[:24] != item["evidence_id"]:
                raise IntelligenceError("The received investigation evidence has changed.", 409)
        for item in receipt.get("plans", []):
            if db.execute(
                "SELECT 1 FROM plans WHERE tenant=? AND session=? AND id=?",
                (namespace, item["session_id"], item["plan_id"]),
            ).fetchone() is None:
                raise IntelligenceError("An original investigation plan is missing.", 409)
        for task in receipt.get("native_tasks", []):
            row = db.execute(
                "SELECT body FROM upstate_native_bindings WHERE tenant=? AND plan_id=?",
                (namespace, task["plan_id"]),
            ).fetchone()
            value = _body(row[0]) if row else {}
            if (value.get("native_task_id") != task["task_id"]
                    or value.get("native_operation_id") != task["operation_id"]):
                raise IntelligenceError("An original native task binding has changed.", 409)
            if task.get("task_source") == "snapshot_record" and db.execute(
                "SELECT 1 FROM upstate_native_task_receipts WHERE tenant=? AND task_id=?",
                (namespace, task["task_id"]),
            ).fetchone() is None:
                raise IntelligenceError("An original native task receipt is missing.", 409)
        for expected in receipt.get("associations", []):
            member = (root / "intelligence" / "diagnostic-sessions"
                      / expected["diagnostic_id"] / (expected["source_sha256"] + ".json"))
            if not member.is_file():
                member = root / "intelligence" / "diagnostic-sessions" / (expected["diagnostic_id"] + ".json")
            current = read_json(member)
            for key in ("schema", "project_id", "diagnostic_id", "dataset_id", "source_sha256",
                        "report_dataset_id", "session_id", "original_task_id", "original_operation_id"):
                if current.get(key) != expected.get(key):
                    raise IntelligenceError("The received report association has changed identity.", 409)
            if expected.get("evidence_id") and current.get("evidence_id") != expected["evidence_id"]:
                raise IntelligenceError("The received report association changed its saved evidence.", 409)
            if current.get("evidence_id"):
                row = db.execute(
                    "SELECT body FROM evidence WHERE tenant=? AND session=? AND id=?",
                    (namespace, current["session_id"], current["evidence_id"]),
                ).fetchone()
                if row is None:
                    raise IntelligenceError("The report association has no retained evidence.", 409)
                evidence = _body(row[0])
                if not any(
                    source.get("ref", {}).get("id") == current.get("report_dataset_id")
                    and source.get("sha256") == current["source_sha256"]
                    for source in evidence.get("sources", [])
                ):
                    raise IntelligenceError("The report association refers to different evidence.", 409)
        db.rollback()
    return {
        "schema": FORMAT + "/received", "project_id": project_id, "storage_namespace": namespace,
        "session_ids": receipt.get("session_ids", []), "evidence_ids": receipt.get("evidence_ids", []),
        "plan_ids": receipt.get("plan_ids", []), "native_task_ids": receipt.get("native_task_ids", []),
        "report_revisions": receipt.get("report_revisions", []),
        "scientific_dependencies": receipt.get("scientific_dependencies", []),
    }

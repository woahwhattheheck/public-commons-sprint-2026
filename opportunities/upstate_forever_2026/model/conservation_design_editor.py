"""Retain the original Scenario Design editor inside an existing native Workspace."""
from __future__ import annotations

import base64
import hashlib
import importlib
import json
from pathlib import Path
import re
import uuid

from . import conservation_design
from .common import atomic_json, describe_file, digest, held, identifier, now, read_json, verify_file

SCHEMA = "upstate.conservation-design-editor/v1"
MAX_INPUT_BYTES = 100 * 1024 * 1024


class RevisionConflict(ValueError):
    pass


def _modules():
    engine, design = conservation_design._editor()
    server = importlib.import_module(conservation_design.EDITOR_PACKAGE + ".server")
    return engine, design, server


def _root(workspace):
    return workspace.root / "conservation-design" / "editor"


def _store(workspace):
    return _modules()[2].Store(_root(workspace) / "projects.sqlite")


def _project_key(value):
    return _modules()[0]._key(value, "project id")


def _path(value):
    if not isinstance(value, str) or len(value) > 2000 or not value.startswith("/api/"):
        raise ValueError("Choose an original editor endpoint")
    path, _, query = value.partition("?")
    parts = path.strip("/").split("/")
    if any(not item or item in {".", ".."} or "\\" in item for item in parts):
        raise ValueError("Choose a canonical original editor endpoint")
    return path, parts, query


def _body(workspace, descriptor):
    path = verify_file(workspace.root, descriptor)
    if not 0 < path.stat().st_size <= MAX_INPUT_BYTES:
        raise ValueError("Supply the complete original editor request up to 100 MiB")
    return path.read_bytes()


def _check_revision(current, expected):
    if isinstance(expected, bool) or not isinstance(expected, int) or expected < 1:
        raise ValueError("Supply the original editor revision being exported")
    if current["revision"] != expected:
        raise RevisionConflict(
            "This project now has revision %s; the open editor has %s. Save a recovery copy and reopen the current project."
            % (current["revision"], expected))


def read(workspace, value):
    """Original read and pure geometry operations; all saved changes use execute."""
    if not isinstance(value, dict):
        raise ValueError("Supply an original editor request")
    path, parts, query = _path(value.get("path"))
    engine, design, server = _modules()
    store = _store(workspace)
    data = value.get("data")
    if path == "/api/health":
        return {"status": "ready", "schema": engine.SCHEMA,
                "geometry_cache": engine.geometry_cache_stats(),
                "workspace_id": workspace.project["id"]}
    if path == "/api/projects":
        return store.list()
    if path == "/api/geometry":
        if not isinstance(data, dict):
            raise ValueError("Supply the original geometry")
        return engine.geometry_info(data["geometry"])
    if path == "/api/validate":
        if not isinstance(data, dict):
            raise ValueError("Supply the complete original project")
        return engine.validate_project(data["project"])
    if len(parts) >= 3 and parts[:2] == ["api", "projects"]:
        project_id = _project_key(parts[2])
        if len(parts) == 3:
            return store.get(project_id)
        if parts[3:] == ["conservation-source"]:
            return {"source": design.source_summary(store.get(project_id)["project"])}
        if parts[3:] == ["history"]:
            return store.history(project_id)
        if len(parts) == 5 and parts[3] == "revisions":
            if not re.fullmatch(r"[1-9][0-9]*", parts[4]):
                raise ValueError("Choose an original positive revision number")
            return store.revision(project_id, int(parts[4]))
    raise ValueError("Use the original read, history or geometry endpoint")


def open_preparation(workspace, preparation_id):
    """Reopen the exact project created for a retained original portfolio."""
    original = conservation_design.get_preparation(workspace, preparation_id)
    project = read_json(verify_file(workspace.root, original["files"]["project"]))
    engine, design, server = _modules()
    store = _store(workspace)
    root = _root(workspace)
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".open.lock", blocking=False):
        try:
            current = store.get(project["id"])
        except KeyError:
            current = store.save(project, 0, create=True)
        if current["project"]["baseline"] != project["baseline"]:
            raise ValueError("The editor project original baseline differs from this retained preparation")
        reference = {"schema": SCHEMA, "preparation_id": original["id"],
                     "project_id": project["id"], "plan_id": original["plan_id"],
                     "study_id": original["study_id"], "workspace_id": workspace.project["id"],
                     "binding_id": original["binding_id"]}
        (root / "preparations").mkdir(parents=True, exist_ok=True)
        atomic_json(root / "preparations" / (identifier(original["id"]) + ".json"),
                    reference, immutable=True)
    return {**current, "_editor": reference}


def execute(workspace, value, operation_id):
    """Original transactional Store writes and complete file exports in the native queue."""
    if not isinstance(value, dict):
        raise ValueError("Supply the retained editor request")
    operation_id = identifier(operation_id)
    directory = _root(workspace) / "operations" / operation_id
    directory.mkdir(parents=True, exist_ok=True)
    selection = dict(value)
    selection_digest = digest(selection)
    with held(directory / ".operation.lock", blocking=False):
        complete = directory / "operation.json"
        if complete.exists():
            record = read_json(complete)
            if record["selection_digest"] != selection_digest:
                raise ValueError("This editor operation already belongs to another original request")
            for descriptor in record.get("files", {}).values():
                verify_file(workspace.root, descriptor)
            return record
        engine, design, server = _modules()
        store = _store(workspace)
        if value.get("operation") == "open":
            response = open_preparation(workspace, identifier(value.get("preparation_id")))
            files = {}
        else:
            path, parts, query = _path(value.get("path"))
            raw = _body(workspace, value["input"]) if value.get("input") else None
            data = json.loads(raw) if raw is not None and path != "/api/receive-bundle" else {}
            files = {"request": value["input"]} if value.get("input") else {}
            if path in {"/api/geometry", "/api/validate"}:
                response = engine.geometry_info(data["geometry"]) if path == "/api/geometry" else engine.validate_project(data["project"])
            elif path in {"/api/import", "/api/import-conservation", "/api/receive-bundle", "/api/receive-project"}:
                staged = directory / "original-project.json"
                if staged.exists():
                    project = read_json(staged)
                else:
                    if path == "/api/import":
                        source_text = data.get("source_text")
                        if not isinstance(source_text, str):
                            raise ValueError("source_text must contain the original GeoJSON text")
                        project = engine.new_project(
                            json.loads(source_text), data.get("title", "Field scenario project"),
                            data.get("filename", "fields.geojson"), source_text.encode("utf-8"))
                    elif path == "/api/import-conservation":
                        if isinstance(data.get("source_base64"), str):
                            original = base64.b64decode(data["source_base64"], validate=True)
                        elif isinstance(data.get("source_text"), str):
                            original = data["source_text"].encode("utf-8")
                        else:
                            raise ValueError("Supply the complete original conservation binding")
                        project = design.import_binding(
                            original, title=data.get("title"),
                            geometry_role=data.get("geometry_role", "reporting_units"))
                    else:
                        project = engine.receive_bundle(raw) if path == "/api/receive-bundle" else data["project"]
                        engine.validate_project(project)
                        source_id = project["id"]
                        identity = {"bundle_sha256": hashlib.sha256(raw).hexdigest()} if path == "/api/receive-bundle" else {
                            "project_canonical_sha256": engine.digest(project)}
                        project["id"] = str(uuid.uuid4())
                        project["received_from"] = {
                            "project_id": source_id, "received_at": engine.now(), **identity}
                    atomic_json(staged, project, immutable=True)
                try:
                    response = store.get(project["id"])
                    if engine.digest(response["project"]) != engine.digest(project):
                        raise ValueError("The interrupted editor import now has a different saved project")
                except KeyError:
                    response = store.save(project, 0, create=True)
                files["original_project"] = describe_file(workspace.root, staged)
            elif len(parts) == 3 and parts[:2] == ["api", "projects"]:
                project_id = _project_key(parts[2])
                project = data["project"]
                if project["id"] != project_id:
                    raise ValueError("The edited project ID differs from the original path")
                expected = data["revision"]
                if isinstance(expected, bool) or not isinstance(expected, int) or expected < 0:
                    raise ValueError("Use the original nonnegative revision")
                current = store.get(project_id)
                if current["revision"] == expected + 1 and engine.digest(current["project"]) == engine.digest(project):
                    response = current
                else:
                    try:
                        response = store.save(project, expected)
                    except server.Conflict as error:
                        raise RevisionConflict(str(error)) from error
            elif len(parts) == 4 and parts[:2] == ["api", "projects"]:
                project_id = _project_key(parts[2])
                current = store.get(project_id)
                _check_revision(current, value.get("expected_revision"))
                project = current["project"]
                export = parts[3]
                if export == "export":
                    output, filename, mime = engine.export_bundle(project), "eco-scenario-design.zip", "application/zip"
                elif export == "geojson":
                    from urllib.parse import parse_qs
                    alternative = parse_qs(query).get("alternative", [None])[0]
                    output, filename, mime = engine.encode(engine.realize(project, alternative)), "scenario.geojson", "application/geo+json"
                elif export == "upstate-plan":
                    output = design.export_landcover(
                        project, data["alternative"], from_codes=data["from_codes"], to_code=data["to_code"],
                        reason=data["reason"], prepare_run=data.get("prepare_run"))
                    filename, mime = "eco-conservation-design.zip", "application/zip"
                elif export == "native-plan":
                    response = server.compile_plan(
                        project, data["alternative"], data["factor_map"],
                        selector=data.get("selector", "field_id"), layer=data.get("layer", "fields"),
                        materialized_inputs=bool(data.get("materialized_inputs", False)))
                    output, filename, mime = engine.encode(response), "eco-native-scenario-plan.json", "application/json"
                else:
                    raise ValueError("Choose an original editor export")
                target = directory / filename
                design._retain(target, output)
                descriptor = describe_file(workspace.root, target)
                files["export"] = descriptor
                response = {"file": descriptor, "mime_type": mime, "filename": filename,
                            "project_id": project_id, "revision": current["revision"]}
            else:
                raise ValueError("Choose an original editor write or export endpoint")
        record = {"schema": SCHEMA, "id": operation_id, "state": "complete",
                  "workspace_id": workspace.project["id"], "selection": selection,
                  "selection_digest": selection_digest, "created_at": now(),
                  "response": response, "files": files}
        atomic_json(complete, record, immutable=True)
        return record


def frame_assets(workspace):
    """Serve the original browser with only its authenticated transport adapted."""
    engine, design, server = _modules()
    app_root = Path(__file__).resolve().parents[1]
    source = app_root / "scenario-design" / "web"
    html = (source / "index.html").read_text(encoding="utf-8")
    before = '<link rel="stylesheet" href="/style.css"><script src="/app.js" defer></script>'
    after = '<link rel="stylesheet" href="style.css"><script src="transport.js" defer></script><script src="app.js" defer></script>'
    if html.count(before) != 1:
        raise ValueError("Join the current original editor HTML transport before receiving this edition")
    html = html.replace(before, after)
    app = (source / "app.js").read_text(encoding="utf-8")
    boot = "initialize().catch(e=>notice(e.message,true));"
    if app.count(boot) != 1:
        raise ValueError("Join the current original editor initialization before receiving this edition")
    storage_guards = (
        ("localStorage.setItem('eco-design-recovery',",
         "localStorage.setItem(window.ecoDesignTransport.recoveryKey(state.project.id),"),
        ("localStorage.removeItem('eco-design-recovery');",
         "localStorage.removeItem(window.ecoDesignTransport.recoveryKey(pid));"),
        ("localStorage.getItem('eco-design-recovery')",
         "localStorage.getItem(window.ecoDesignTransport.recoveryKey())"),
        ("localStorage.removeItem('eco-design-recovery');",
         "localStorage.removeItem(window.ecoDesignTransport.recoveryKey());"),
    )
    if app.count("'eco-design-recovery'") != 4:
        raise ValueError("Join the current original editor recovery contract")
    for before, after in storage_guards:
        if before not in app:
            raise ValueError("Join the current original editor recovery storage")
        app = app.replace(before, after, 1)
    app = app.replace(boot, """window.ecoDesignIntegration = {
  flush, openProject,
  snapshot: () => ({project_id:state.project?.id||null,revision:state.revision,dirty:state.dirty}),
};
initialize().then(()=>window.ecoDesignTransport.ready()).catch(e=>notice(e.message,true));""")
    bodies = {
        "index.html": html.encode("utf-8"),
        "app.js": app.encode("utf-8"),
        "style.css": (source / "style.css").read_bytes(),
        "transport.js": (app_root / "operator" / "web" / "conservation_design_frame.js").read_bytes(),
    }
    identity = {name: {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                for name, raw in bodies.items()}
    key = digest(identity)
    directory = _root(workspace) / "assets" / key
    directory.mkdir(parents=True, exist_ok=True)
    for name, raw in bodies.items():
        design._retain(directory / name, raw)
    return {name: describe_file(workspace.root, directory / name) for name in bodies}

"""Retain a new scientific presentation of one completed original Chemistry run.

The original run, project, request, result and artifacts remain unchanged.
Preparing this report calls the renderer and the original editable exporter only.
"""
from __future__ import annotations

from copy import deepcopy
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import zipfile

from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, identifier, now, read_json, verify_file)
from .chemistry import Chemistry
from .reach_chemistry.model import Project
from .reach_chemistry.reporting import REPORT_EDITION, report, summary

SCHEMA = "upstate.chemistry-scientific-report/v1"
FOLDER = "chemistry-reports"


def _member(name):
    if not isinstance(name, str):
        raise ValueError("Chemical report member must be a relative path")
    value = PurePosixPath(name)
    if (not value.parts or value.is_absolute() or ".." in value.parts
            or value.as_posix() != name or "\\" in name or "\0" in name):
        raise ValueError("Nonportable chemical report member")
    return value


def _copy(source, target):
    source, target = Path(source), Path(target)
    expected = {"bytes": source.stat().st_size, "sha256": file_digest(source)}
    if target.exists():
        if target.stat().st_size != expected["bytes"] or file_digest(target) != expected["sha256"]:
            raise ValueError("Retained chemical report member differs")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with source.open("rb") as original, tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as out:
            pending = Path(out.name)
            shutil.copyfileobj(original, out, 1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        if pending.stat().st_size != expected["bytes"] or file_digest(pending) != expected["sha256"]:
            raise ValueError("Original chemical file changed while retaining its report")
        try:
            os.link(pending, target)
        except FileExistsError:
            if target.stat().st_size != expected["bytes"] or file_digest(target) != expected["sha256"]:
                raise ValueError("Concurrent chemical report member differs")
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _basis(workspace, run_id):
    service = Chemistry(workspace)
    native = service.get_run(identifier(run_id))
    if native.get("state") != "complete":
        raise ValueError("Choose a completed retained chemical analysis")
    case = service.get_case(native["case_id"])
    directory = service._verified_artifacts(native["id"], native)
    named = {item["path"]: item for item in native["artifacts"]}
    required = ("artifacts/project.json", "artifacts/request.json", "artifacts/result.json")
    if any(name not in named for name in required):
        raise ValueError("Completed chemical run is missing its original project, request or result")
    project = Project(read_json(verify_file(directory, named[required[0]])))
    request = read_json(verify_file(directory, named[required[1]]))
    result = read_json(verify_file(directory, named[required[2]]))
    if (project.fingerprint != case["project_sha256"]
            or project.raw != case["project"]
            or request != native["selection"]["request"]
            or native["selection"]["project_sha256"] != project.fingerprint):
        raise ValueError("Completed chemical inputs differ from their retained run selection")
    result_project = result.get("original_project_sha256", result.get("project_sha256"))
    if result_project != project.fingerprint:
        raise ValueError("Chemical result identifies another original project")
    stamp = {"run_id": native["id"], "case_id": case["id"], "project_sha256": project.fingerprint,
             "engine_version": native["selection"]["engine_version"],
             "request_sha256": named[required[1]]["sha256"], "result_sha256": named[required[2]]["sha256"],
             "artifacts": deepcopy(native["artifacts"]), "source_refs": deepcopy(case["source_refs"])}
    return service, native, case, project, request, result, stamp


def _record_hash(value):
    return digest({key: item for key, item in value.items() if key != "record_sha256"})


def _archive(directory, paths):
    archive = directory / "scientific-report.zip"
    # A completed ZIP is verified against every original member before adoption.
    expected = {path: describe_file(directory, directory / path) for path in paths}
    if archive.exists():
        _verify_archive(archive, expected)
        return archive
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=directory, prefix=".report-", suffix=".zip", delete=False) as stream:
            pending = Path(stream.name)
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED) as target:
            for path in sorted(paths):
                target.write(directory / path, path)
        _verify_archive(pending, expected)
        os.replace(pending, archive)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)
    return archive


def _verify_archive(path, expected):
    import hashlib
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != set(expected):
            raise ValueError("Chemical scientific archive member inventory differs")
        for name, item in expected.items():
            _member(name)
            if archive.getinfo(name).file_size != item["bytes"]:
                raise ValueError("Chemical scientific archive member length differs")
            checksum = hashlib.sha256()
            with archive.open(name) as stream:
                for body in iter(lambda: stream.read(1024 * 1024), b""):
                    checksum.update(body)
            if checksum.hexdigest() != item["sha256"]:
                raise ValueError("Chemical scientific archive member changed")


def prepare(workspace, run_id):
    service, native, case, project, request, result, stamp = _basis(workspace, run_id)
    renderer = Path(__file__).with_name("reach_chemistry") / "reporting.py"
    selection = {"workspace_id": workspace.project["id"], "run_id": native["id"],
                 "edition": REPORT_EDITION, "producer_sha256": file_digest(Path(__file__)),
                 "renderer_sha256": file_digest(renderer), "source_stamp": stamp}
    key = digest(selection)
    directory = workspace.root / FOLDER / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".report.lock", blocking=False):
        record_path = directory / "report.json"
        if record_path.exists():
            return inspect(workspace, key)
        intent_path = directory / "intent.json"
        if intent_path.exists():
            intent = read_json(intent_path)
            if intent["selection"] != selection:
                raise ValueError("Chemical report preparation identifies another source")
        else:
            intent = {"selection": selection, "created_at": now()}
            atomic_json(intent_path, intent, immutable=True)
        for item in native["artifacts"]:
            path = _member(item["path"])
            source = verify_file(service.root / native["id"], item)
            _copy(source, directory / "original" / path)
        atomic_json(directory / "original" / "run.json", native, immutable=True)
        atomic_json(directory / "original" / "case.json", case, immutable=True)
        # Preserve the original complete source bodies and companions through
        # the maintained Chemistry transfer, not a second source-copy protocol.
        exported = service.export({"case_id": case["id"], "run_ids": [native["id"]]})
        editable = verify_file(workspace.root, exported["artifact"])
        _copy(editable, directory / "editable-chemistry.zip")
        description = summary(project, result, request)
        atomic_json(directory / "scientific-summary.json", description, immutable=True)
        links = [("Complete original editable Chemistry project", "editable-chemistry.zip"),
                 ("Original result JSON", "original/artifacts/result.json"),
                 ("Original request JSON", "original/artifacts/request.json"),
                 ("Original project JSON", "original/artifacts/project.json"),
                 ("Original saved run", "original/run.json"), ("Original saved case and source references", "original/case.json"),
                 ("Report source manifest", "manifest.json")]
        links.extend(("Original " + item["path"], "original/" + item["path"])
                     for item in native["artifacts"]
                     if item["path"] not in {"artifacts/result.json", "artifacts/request.json", "artifacts/project.json"})
        rendered = report(project, result, request, identity={
            "Workspace": workspace.project["id"], "Run": native["id"], "Case": case["id"],
            "Producing engine version": stamp["engine_version"],
            "Native attempt started": native.get("started_at"), "Native attempt completed": native.get("ended_at"),
            "Original result SHA256": stamp["result_sha256"],
            "Original request SHA256": stamp["request_sha256"], "Original source references": stamp["source_refs"],
        }, links=links)
        atomic_bytes(directory / "report.html", rendered.encode("utf-8"), immutable=True)
        # Preserve all same-named original artifacts in their original subdirectory.
        files = [describe_file(directory, path) for path in sorted(directory.rglob("*"))
                 if path.is_file() and not path.name.startswith(".")
                 and path not in {directory / name for name in ("intent.json", "manifest.json", "report.json", "scientific-report.zip")}]
        manifest = {"schema": SCHEMA, "id": key, "selection": selection, "files": files,
                    "interpretation": "Presentation of one completed original result; no numerical model is run."}
        atomic_json(directory / "manifest.json", manifest, immutable=True)
        archive = _archive(directory, [item["path"] for item in files] + ["manifest.json"])
        # Recheck the original selection after copying, rendering and export.
        if _basis(workspace, native["id"])[-1] != stamp:
            raise ValueError("Original chemical source changed during report preparation")
        artifacts = [describe_file(workspace.root, directory / item["path"]) for item in files]
        artifacts += [describe_file(workspace.root, directory / "manifest.json"),
                      describe_file(workspace.root, archive)]
        record = {"schema": SCHEMA, "id": key, "state": "complete", "created_at": intent["created_at"],
                  "title": project.title, "run_id": native["id"], "case_id": case["id"],
                  "edition": REPORT_EDITION, "selection": selection, "summary": description,
                  "report": describe_file(workspace.root, directory / "report.html"),
                  "artifact": describe_file(workspace.root, archive), "artifacts": artifacts}
        record["record_sha256"] = _record_hash(record)
        atomic_json(record_path, record, immutable=True)
        return record


def inspect(workspace, report_id, *, verify=True):
    key = identifier(report_id)
    directory = workspace.root / FOLDER / key
    record = read_json(directory / "report.json")
    if (record.get("schema") != SCHEMA or record.get("id") != key
            or record.get("state") != "complete" or digest(record["selection"]) != key
            or record["selection"].get("workspace_id") != workspace.project["id"]
            or record.get("record_sha256") != _record_hash(record)
            or record["run_id"] != record["selection"]["run_id"]):
        raise ValueError("Saved chemical scientific report identity differs")
    if verify:
        for item in record["artifacts"]:
            verify_file(workspace.root, item)
        stamp = _basis(workspace, record["run_id"])[-1]
        if stamp != record["selection"]["source_stamp"]:
            raise ValueError("Saved chemical report original sources differ")
        manifest = read_json(directory / "manifest.json")
        if manifest.get("id") != key or manifest.get("selection") != record["selection"]:
            raise ValueError("Chemical report source manifest differs")
        for item in manifest["files"]:
            verify_file(directory, item)
    return record


def catalog(workspace, run_id=None):
    if run_id is not None:
        run_id = identifier(run_id)
    return [{name: value.get(name) for name in
             ("id", "run_id", "case_id", "title", "edition", "state", "created_at", "summary")}
            for path in sorted((workspace.root / FOLDER).glob("*/report.json"))
            for value in [inspect(workspace, path.parent.name, verify=False)]
            if run_id is None or value["run_id"] == run_id]


def verify_all(workspace):
    records = [inspect(workspace, path.parent.name) for path in
               sorted((workspace.root / FOLDER).glob("*/report.json"))]
    return {"reports": len(records)}

"""Receive the original geographic source-loading report into the existing course.

The maintained JavaScript producer owns every calculation. This module retains
its exact input/source/runtime request, invocation and complete output, imports
the ordinary source manifest, and reopens that same source after full restoration.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid

from model.common import atomic_bytes, atomic_json, digest, file_digest, held, identifier, now, read_json

SCHEMA = "upstate.geographic-scenario-context/v1"
FOLDER = "geographic-scenario-contexts"
APP = Path(__file__).resolve().parents[1]
PRODUCER = "source_tools/geographic_scenario_interpretation.mjs"
INPUTS = (
    ("prepared", "geographic-prepared.json", "prepared.json"),
    ("matching-summary", "matching-summary.json", "inputs/matched-control/matching-summary.json"),
    ("biophysical", "biophysical.csv", "inputs/biophysical.csv"),
    ("input-receipt", "input-receipt.json", "inputs/input-receipt.json"),
)


def _identity(path):
    path = Path(path)
    if not path.is_file() or path.is_symlink():
        raise ValueError("Select a complete original ordinary file: " + str(path))
    return {"bytes": path.stat().st_size, "sha256": file_digest(path)}


def _copy(source, target, expected):
    raw = Path(source).read_bytes()
    if {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()} != expected:
        raise ValueError("Original interpretation input changed: " + str(source))
    atomic_bytes(target, raw, immutable=True)


def _member(root, name):
    value = Path(name)
    if (not isinstance(name, str) or not value.parts or value.is_absolute() or ".." in value.parts
            or value.as_posix() != name or "\\" in name or "\0" in name):
        raise ValueError("Use the complete original relative source member")
    path = root.joinpath(*value.parts)
    if not path.resolve().is_relative_to(root.resolve()) or path.is_symlink():
        raise ValueError("Original source member escapes the retained edition")
    return path


def _inputs(workspace, prepared):
    ident = identifier(prepared["id"])
    directory = workspace.root / "geographic-headwaters" / ident
    if (prepared.get("project_id") != workspace.project["id"]
            or read_json(directory / "prepared.json") != prepared):
        raise ValueError("Use the exact saved geographic preparation")
    return directory, {
        name: {"path": relative, **_identity(directory / relative)}
        for _flag, name, relative in INPUTS
    }


def _output(directory, result, request):
    if (result.get("schema") != "upstate.geographic-scenario-interpretation/v1"
            or result.get("geographic_preparation_id") != request["prepared_id"]):
        raise ValueError("Interpretation producer returned another geographic edition")
    files = result.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("Retain the complete produced source files")
    by_name = {}
    for item in files:
        name = item["path"]
        if name in by_name or _identity(_member(directory, name)) != {k: item[k] for k in ("bytes", "sha256")}:
            raise ValueError("Original source-loading output changed or repeated: " + name)
        by_name[name] = item
    actual = {p.relative_to(directory).as_posix() for p in directory.rglob("*") if p.is_file()}
    if actual != set(by_name):
        raise ValueError("Source-loading edition contains missing or unlisted files")
    for key, filename in (("source_manifest", "sources.json"), ("report", "interpretation.json"),
                          ("recipe", "observed-report.json")):
        if Path(result[key]).resolve() != (directory / filename).resolve() or filename not in by_name:
            raise ValueError("Interpretation output points outside its complete original edition")
    for name, expected in request["inputs"].items():
        if {k: by_name.get("originals/" + name, {}).get(k) for k in ("bytes", "sha256")} != {
                k: expected[k] for k in ("bytes", "sha256")}:
            raise ValueError("Produced source omitted an original geographic input: " + name)
    if {k: by_name.get("geographic_scenario_interpretation.mjs", {}).get(k) for k in ("bytes", "sha256")} != request["producer"]:
        raise ValueError("Produced source omitted its original calculation implementation")
    report = read_json(directory / "interpretation.json")
    if (report["project_id"] != request["project_id"] or report["ensemble_id"] != request["ensemble_id"]
            or report["geographic_preparation_id"] != request["prepared_id"]):
        raise ValueError("The complete source interpretation belongs to another original project")
    manifest = read_json(directory / "sources.json")
    candidates = [row for row in manifest["entries"] if row.get("role") == "OBSERVED_CONTEXT"
                  and row.get("kind") == "document"]
    if len(candidates) != 1 or candidates[0]["path"] != "observed-report.json":
        raise ValueError("Select the actual sole original report entry")
    return {"source_id": candidates[0]["id"], "files": files,
            "manifest": _identity(directory / "sources.json"),
            "recipe": _identity(directory / "observed-report.json")}


def prepare(workspace, prepared, output, *, node, receiving_lock_fd, receiving_lock_path):
    from source_tools.geographic_headwaters_reopen import _lock_identity
    original, inputs = _inputs(workspace, prepared)
    binary = shutil.which(str(node)) if not Path(str(node)).is_absolute() else str(node)
    if not binary:
        raise ValueError("Supply the actual equipped Node executable with --node")
    binary = Path(binary).resolve(strict=True)
    request = {"schema": SCHEMA, "project_id": workspace.project["id"],
               "prepared_id": prepared["id"], "ensemble_id": prepared["ensemble_id"],
               "inputs": inputs, "producer": _identity(APP / PRODUCER),
               "receiver": _identity(Path(__file__)),
               "runtime": {"file": str(binary), **_identity(binary)}}
    ident = digest(request)
    root = Path(output).resolve() / ident
    if (root.is_relative_to(workspace.root.resolve()) or workspace.root.resolve().is_relative_to(root)
            or root.is_relative_to(APP) or APP.is_relative_to(root)):
        raise ValueError("Keep invocation history outside the original Workspace and application")
    root.mkdir(parents=True, exist_ok=True)
    atomic_json(root / "request.json", request, immutable=True)
    lock = _lock_identity(receiving_lock_fd, receiving_lock_path)
    completed = root / "complete.json"
    result, directory = None, None
    if completed.exists():
        saved = read_json(completed)
        if saved["request"] != request:
            raise ValueError("Retained interpretation operation changed")
        directory = _member(root, saved["attempt"]) / "edition"
        result = saved["result"]
        _output(directory, result, request)
    else:
        # A child that finished while its parent disappeared retains the same
        # inherited flock. Recover its complete stdout only after that lock is
        # available, without overwriting any partial earlier invocation.
        for attempt in sorted((root / "attempts").glob("*")):
            intent = attempt / "intent.json"
            stdout = attempt / "stdout.json"
            if not intent.is_file() or not stdout.is_file():
                continue
            if read_json(intent).get("request") != request:
                raise ValueError("An original invocation names a different source request")
            returned = attempt / "process.json"
            if returned.is_file() and read_json(returned).get("returncode") != 0:
                continue
            try:
                candidate = read_json(stdout)
                _output(attempt / "edition", candidate, request)
            except (OSError, ValueError, KeyError, TypeError):
                continue
            directory, result = attempt / "edition", candidate
            break
        if result is None:
            attempt = root / "attempts" / uuid.uuid4().hex
            attempt.mkdir(parents=True, exist_ok=False)
            directory = attempt / "edition"
            for _flag, name, relative in INPUTS:
                _copy(original / relative, attempt / "inputs" / name,
                      {k: inputs[name][k] for k in ("bytes", "sha256")})
            _copy(APP / PRODUCER, attempt / "geographic_scenario_interpretation.mjs", request["producer"])
            command = [str(binary), str(attempt / "geographic_scenario_interpretation.mjs")]
            for flag, name, _relative in INPUTS:
                command.extend(["--" + flag, str(attempt / "inputs" / name)])
            command.extend(["--output", str(directory)])
            atomic_json(attempt / "intent.json",
                        {"request": request, "command": command, "started_at": now(), "receiving_lock": lock},
                        immutable=True)
            process = None
            try:
                _lock_identity(receiving_lock_fd, receiving_lock_path)
                if _identity(binary) != {k: request["runtime"][k] for k in ("bytes", "sha256")}:
                    raise ValueError("The actual Node executable changed before source execution")
                with (attempt / "stdout.json").open("xb", buffering=0) as stdout, \
                        (attempt / "stderr.log").open("xb", buffering=0) as stderr:
                    process = subprocess.Popen(command, stdout=stdout, stderr=stderr,
                                               pass_fds=(receiving_lock_fd,), cwd=attempt)
                    code = process.wait()
                    os.fsync(stdout.fileno()); os.fsync(stderr.fileno())
                atomic_json(attempt / "process.json", {"returncode": code, "finished_at": now()}, immutable=True)
                if code:
                    raise RuntimeError("Original interpretation producer exited " + str(code) + ": " + str(attempt / "stderr.log"))
                result = read_json(attempt / "stdout.json")
                _output(directory, result, request)
            except BaseException as error:
                if process is not None and process.poll() is None:
                    try:
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill(); process.wait()
                    except OSError as cleanup:
                        if hasattr(error, "add_note"):
                            error.add_note("Owned interpretation child cleanup: " + str(cleanup))
                try:
                    atomic_json(attempt / "failure.json", {
                        "state": "failed" if isinstance(error, Exception) else "interrupted",
                        "error": {"type": type(error).__name__, "message": str(error)}, "at": now()})
                except OSError as secondary:
                    if hasattr(error, "add_note"):
                        error.add_note("Retain original interpretation failure: " + str(secondary))
                raise
        atomic_json(completed, {"request": request, "attempt": directory.parent.relative_to(root).as_posix(),
                                "result": result}, immutable=True)
    checked = _output(directory, result, request)
    with held(workspace.root / ".workspace.lock", blocking=False):
        collection = workspace.import_sources(directory / "sources.json")
        source = {"source_collection_id": collection["id"], "source_id": checked["source_id"]}
        record = {"schema": SCHEMA, "id": ident, "state": "complete",
                  "request": request, "project_id": workspace.project["id"],
                  "prepared_id": prepared["id"], "ensemble_id": prepared["ensemble_id"],
                  "source": source, "source_manifest": checked["manifest"],
                  "recipe": checked["recipe"], "files": checked["files"]}
        atomic_json(workspace.root / FOLDER / ident / "context.json", record, immutable=True)
    inspect(workspace, ident)
    return record


def inspect(workspace, ident):
    record = read_json(workspace.root / FOLDER / identifier(ident) / "context.json")
    if (record.get("schema") != SCHEMA or record.get("state") != "complete"
            or record["id"] != ident or ident != digest(record["request"])
            or record["project_id"] != workspace.project["id"]
            or record["request"]["project_id"] != record["project_id"]
            or record["request"]["prepared_id"] != record["prepared_id"]
            or record["request"]["ensemble_id"] != record["ensemble_id"]):
        raise ValueError("Retained interpretation source context changed")
    prepared = read_json(workspace.root / "geographic-headwaters" / identifier(record["prepared_id"]) / "prepared.json")
    _root, inputs = _inputs(workspace, prepared)
    if inputs != record["request"]["inputs"] or prepared["ensemble_id"] != record["ensemble_id"]:
        raise ValueError("Original interpreted geographic inputs changed")
    source = record["source"]
    collection = workspace._get("sources", source["source_collection_id"])
    if {k: collection["original_manifest"][k] for k in ("bytes", "sha256")} != record["source_manifest"]:
        raise ValueError("Original interpretation manifest changed")
    path, entry = workspace.source_file(source["source_collection_id"], source["source_id"])
    if entry.get("role") != "OBSERVED_CONTEXT" or _identity(path) != record["recipe"]:
        raise ValueError("Original interpretation report selection changed")
    bodies = {item.get("source_path"): item for item in [entry["body"], *entry["companions"]]}
    for item in record["files"]:
        if item["path"] == "sources.json":
            continue
        body = bodies.get(item["path"])
        if body is None or {k: body[k] for k in ("bytes", "sha256")} != {k: item[k] for k in ("bytes", "sha256")}:
            raise ValueError("Original interpretation companion changed: " + item["path"])
    return record


def append_source(selection, context):
    from model import observed_context
    selected = deepcopy(selection)
    choices = observed_context.source_choices(selected)
    if context["source"] not in choices:
        choices.append(deepcopy(context["source"]))
    selected["observed_context_sources"] = choices
    if choices:
        selected.setdefault("source_roles", {})[observed_context.ROLE] = deepcopy(choices[0])
    selected.pop("observed_context_binding", None)
    return selected

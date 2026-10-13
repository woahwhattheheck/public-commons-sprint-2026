"""Retain the original editable Chemistry cohort of a selected scientific report.

Only a saved report's declared Chemistry producer activates this resolver. All
reads use the maintained selected-study closure and its contained-file checks.
No numerical calculation, rendering, source intake or foreign-ID lookup occurs.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import PurePosixPath

from .common import digest, identifier

EDITION = "native-chemistry-scientific-source-v1"
READABLE_EDITIONS = (EDITION, "native-chemistry-scientific-source-v2")
REPORT_SCHEMA = "upstate.chemistry-scientific-report/v1"
SOURCE_KIND = "chemistry-report-sources"
SOURCE_DIRECTORY = "chemistry-report-source-exports"
SOURCE_ID = "native-chemistry-report"
IMMUTABLE_KINDS = ("chemistry-cases", SOURCE_KIND)
DOCUMENTS = {"chemistry-runs": "run.json", "chemistry-reports": "report.json"}
LOCKS = {"chemistry-runs": ".run.lock", "chemistry-reports": ".report.lock"}
LABELS = {
    "chemistry-cases": "Original editable Chemistry cases",
    "chemistry-runs": "Completed original Chemistry runs",
    "chemistry-reports": "Saved Chemistry scientific reports",
    SOURCE_KIND: "Chemistry scientific-source editions",
    SOURCE_DIRECTORY: "Chemistry scientific-source files",
}


def _same(actual, expected, label):
    if actual != expected:
        raise ValueError("Chemistry study " + label + " differs from the original source")


def _name(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Chemistry study members require canonical relative paths")
    path = PurePosixPath(value)
    if (not path.parts or path.is_absolute() or ".." in path.parts
            or path.as_posix() != value or any(":" in part for part in path.parts)):
        raise ValueError("Chemistry study member leaves its original directory")
    return value


def _within(value, prefix):
    value = _name(value)
    try:
        result = PurePosixPath(value).relative_to(PurePosixPath(prefix)).as_posix()
    except ValueError as error:
        raise ValueError("Chemistry artifact has another original directory") from error
    return _name(result)


def _project_hash(project):
    # Exact reach_chemistry.model.canonical_bytes; avoids importing its solver
    # dependencies merely to receive an already completed scientific study.
    return hashlib.sha256(json.dumps(
        project, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        allow_nan=False).encode("utf-8")).hexdigest()


def _record_hash(report):
    return digest({key: value for key, value in report.items() if key != "record_sha256"})


def _path(kind, key):
    key = identifier(key)
    if kind in IMMUTABLE_KINDS or kind == "sources":
        return kind + "/" + key + ".json"
    if kind in DOCUMENTS:
        return kind + "/" + key + "/" + DOCUMENTS[kind]
    raise ValueError("Unsupported original Chemistry dependency")


def record(closure, kind, key, reason):
    key = identifier(key)
    closure.need(kind, key, reason)
    value = closure.read(_path(kind, key))
    if kind in IMMUTABLE_KINDS or kind == "sources":
        if value.get("schema") != "upstate." + kind + "/v1" or digest(value) != key:
            raise ValueError("Original Chemistry immutable dependency changed: " + kind)
        return {**value, "id": key}
    _same(value.get("id"), key, "saved record identity")
    return value


def _entry(closure, choice, reason):
    source = record(closure, "sources", choice["source_collection_id"], reason)
    selected = [row for row in source["entries"] if row["id"] == choice["source_id"]]
    if len(selected) != 1:
        raise ValueError("Original Chemistry source entry is missing or ambiguous")
    entry = selected[0]
    closure._body(source["original_manifest"])
    for item in [entry["body"], *entry.get("companions", [])]:
        closure._body(item)
    return entry


def _case_identity(case):
    key = identifier(case.get("id"))
    original = {name: value for name, value in case.items() if name != "id"}
    if case.get("schema") != "upstate.chemistry-cases/v1" or digest(original) != key:
        raise ValueError("Captured Chemistry case changed its immutable identity")
    _same(_project_hash(case["project"]), case["project_sha256"], "project fingerprint")
    return key


def _case(closure, case, reason):
    _case_identity(case)
    expected = []
    seen = set()
    for row in case["source_refs"]:
        choice = (row["source_collection_id"], row["source_id"])
        if choice in seen:
            raise ValueError("Original Chemistry case repeats a source selection")
        seen.add(choice)
        entry = _entry(closure, row, reason)
        expected.append({
            "source_collection_id": choice[0], "source_id": choice[1],
            "sha256": entry["body"]["sha256"], "bytes": entry["body"]["bytes"],
            "title": entry["title"], "uri": entry["uri"], "vintage": entry["vintage"],
        })
    _same(case["source_refs"], expected, "case source editions")
    if case.get("parent_id"):
        record(closure, "chemistry-cases", case["parent_id"], "Original Chemistry case ancestry")


def _run_identity(native, case):
    if (native.get("schema") != "upstate.chemistry-run/v1"
            or native.get("state") != "complete"
            or digest(native["selection"]) != identifier(native.get("id"))):
        raise ValueError("Retain the original completed Chemistry run")
    _same(native.get("case_id"), case["id"], "run case")
    _same(native["selection"].get("case_id"), case["id"], "run selected case")
    _same(native["selection"].get("project_sha256"), case["project_sha256"], "run project")
    _same(native.get("mode"), native["selection"]["request"].get("mode", "simulate"), "run mode")


def _stamp(native, case, project, request, result):
    _case_identity(case)
    _run_identity(native, case)
    _same(project, case["project"], "original input project")
    _same(_project_hash(project), case["project_sha256"], "original input fingerprint")
    _same(request, native["selection"]["request"], "original input request")
    _same(result.get("original_project_sha256", result.get("project_sha256")),
          case["project_sha256"], "numerical result project")
    artifacts = {}
    for item in native["artifacts"]:
        name = _name(item["path"])
        if name in artifacts:
            raise ValueError("Original Chemistry run repeats an artifact")
        artifacts[name] = item
    for required in ("artifacts/project.json", "artifacts/request.json", "artifacts/result.json"):
        if required not in artifacts:
            raise ValueError("Original Chemistry run is missing " + required)
    return {
        "run_id": native["id"], "case_id": case["id"], "project_sha256": case["project_sha256"],
        "engine_version": native["selection"]["engine_version"],
        "request_sha256": artifacts["artifacts/request.json"]["sha256"],
        "result_sha256": artifacts["artifacts/result.json"]["sha256"],
        "artifacts": deepcopy(native["artifacts"]), "source_refs": deepcopy(case["source_refs"]),
    }


def _native_basis(closure, run_id, reason):
    native = record(closure, "chemistry-runs", run_id, reason)
    case = record(closure, "chemistry-cases", native["case_id"], reason)
    _run_identity(native, case)
    prefix = "chemistry-runs/" + native["id"]
    items = {}
    for item in native["artifacts"]:
        name = _name(item["path"])
        if name in items:
            raise ValueError("Original Chemistry run repeats an artifact")
        items[name] = item
        closure.add_file(prefix + "/" + name, item)
    required = ("artifacts/project.json", "artifacts/request.json", "artifacts/result.json")
    if any(name not in items for name in required):
        raise ValueError("Completed Chemistry study is missing its original numerical inputs")
    project, request, result = [closure.read(prefix + "/" + name) for name in required]
    return native, case, result, _stamp(native, case, project, request, result)


def _run(closure, native, reason):
    original, case, result, unused_stamp = _native_basis(closure, native["id"], reason)
    _same(native, original, "run record")
    prefix = "chemistry-runs/" + native["id"]
    closure.tree(prefix)
    if native.get("checkpoint"):
        item = native["checkpoint"]
        closure.add_file(prefix + "/" + _name(item["path"]), item)
    fitted = native.get("calibrated_case_id")
    if fitted is not None:
        child = record(closure, "chemistry-cases", fitted, "Original retained fitted Chemistry case")
        _same(child.get("parent_id"), case["id"], "fitted case parent")
        _same(child["project"], result.get("calibrated_project"), "fitted project")
        _same(child["source_refs"], case["source_refs"], "fitted source editions")


def _report_identity(report, source_project, stamp):
    if (report.get("schema") != REPORT_SCHEMA or report.get("state") != "complete"
            or digest(report["selection"]) != identifier(report.get("id"))
            or report.get("record_sha256") != _record_hash(report)):
        raise ValueError("Original Chemistry scientific report identity changed")
    _same(report["selection"].get("workspace_id"), source_project, "report workspace")
    _same(report["selection"].get("source_stamp"), stamp, "report original source stamp")
    _same(report.get("run_id"), stamp["run_id"], "report run")
    _same(report["selection"].get("run_id"), stamp["run_id"], "report selected run")
    _same(report.get("case_id"), stamp["case_id"], "report case")


def _report(closure, report, reason):
    native, case, unused_result, stamp = _native_basis(closure, report["run_id"], reason)
    _report_identity(report, closure.workspace.project["id"], stamp)
    prefix = "chemistry-reports/" + report["id"]
    closure.tree(prefix)
    files = {}
    for item in report["artifacts"]:
        name = _within(item["path"], prefix)
        if name in files:
            raise ValueError("Original Chemistry report repeats an artifact")
        files[name] = item
        closure.add_file(item["path"], item)
    for field, expected in (("report", "report.html"), ("artifact", "scientific-report.zip")):
        _same(report[field], files.get(expected), "report " + field + " descriptor")
    if "manifest.json" not in files:
        raise ValueError("Original Chemistry report lost its source manifest")
    manifest = closure.read(prefix + "/manifest.json")
    _same(manifest.get("schema"), REPORT_SCHEMA, "report manifest schema")
    _same(manifest.get("id"), report["id"], "report manifest identity")
    _same(manifest.get("selection"), report["selection"], "report manifest selection")
    seen = set()
    for item in manifest["files"]:
        name = _name(item["path"])
        if name in seen or name not in files:
            raise ValueError("Original Chemistry report manifest has missing or repeated members")
        seen.add(name)
        for field in ("bytes", "sha256"):
            _same(item[field], files[name][field], "report manifest " + field)
    _same(set(files), seen | {"manifest.json", "scientific-report.zip"}, "report artifact roster")
    _same(closure.read(prefix + "/original/run.json"), native, "captured original run")
    _same(closure.read(prefix + "/original/case.json"), case, "captured original case")
    for item in native["artifacts"]:
        name = "original/" + _name(item["path"])
        if name not in files:
            raise ValueError("Chemistry report lost an original native artifact")
        for field in ("bytes", "sha256"):
            _same(files[name][field], item[field], "captured native artifact " + field)
    intent = prefix + "/intent.json"
    if (closure.root / intent).exists() or (closure.root / intent).is_symlink():
        _same(closure.read(intent).get("selection"), report["selection"], "report recovery intent")


def _selection(native):
    return {key: native[key] for key in (
        "edition", "workspace_id", "report_id", "report_record_sha256",
        "source_stamp", "producer_sha256")}


def _producer(closure, value, reason):
    if (value.get("version") != 1 or value.get("edition") not in READABLE_EDITIONS
            or value.get("state") != "complete"
            or value.get("workspace_id") != closure.workspace.project["id"]
            or digest(value["selection"]) != identifier(value.get("selection_id"))):
        raise ValueError("Choose the original completed Chemistry scientific source")
    report = record(closure, "chemistry-reports", value["report_id"], reason)
    expected = {
        "edition": value["edition"], "workspace_id": closure.workspace.project["id"],
        "report_id": report["id"], "report_record_sha256": report["record_sha256"],
        "source_stamp": report["selection"]["source_stamp"],
        "producer_sha256": identifier(value["selection"]["producer_sha256"]),
    }
    _same(value["selection"], expected, "source producer selection")
    _same(value["source_stamp"], expected["source_stamp"], "source producer stamp")
    for field in ("run_id", "case_id"):
        _same(value[field], report[field], "source producer " + field)
    _same(value["mode"], report["summary"]["mode"], "source producer mode")
    _same(value["source_id"], SOURCE_ID, "source producer document")
    prefix = SOURCE_DIRECTORY + "/" + value["selection_id"]
    _same(value["directory"], prefix, "source producer directory")
    closure.tree(prefix)
    for name, item in value["files"].items():
        _same(_name(name), item.get("path"), "source member path")
        closure.add_file(prefix + "/" + name, item)
    manifest = value["manifest"]
    _same(manifest.get("path"), "sources.json", "source manifest path")
    closure.add_file(prefix + "/sources.json", manifest)
    entry = _entry(closure, value, reason)
    _same(entry["body"]["sha256"], value["files"]["observed-report.json"]["sha256"], "source recipe")
    _same(entry["body"]["bytes"], value["files"]["observed-report.json"]["bytes"], "source recipe length")
    companions = _members(entry)
    _same(set(companions), set(value["files"]) - {"observed-report.json"}, "source companion roster")
    for name, item in companions.items():
        for field in ("bytes", "sha256"):
            _same(item[field], value["files"][name][field], "source companion " + field)
    pointer = prefix + "/result.json"
    if (closure.root / pointer).exists() or (closure.root / pointer).is_symlink():
        _same(closure.read(pointer), value, "source recovery pointer")


def visit(closure, kind, key, value, reason):
    """Join the original selected-study dispatcher for these four record kinds."""
    if kind not in (*IMMUTABLE_KINDS, *DOCUMENTS):
        return False
    original = record(closure, kind, key, reason)
    expected = {name: item for name, item in original.items() if name != "id"} if kind in IMMUTABLE_KINDS else original
    _same(value, expected, "closure record")
    {"chemistry-cases": _case, "chemistry-runs": _run,
     "chemistry-reports": _report, SOURCE_KIND: _producer}[kind](closure, original, reason)
    closure.nodes[(kind, key)]["state"] = original.get("state", "retained")
    return True


def lock_paths(closure):
    """The native run/report locks are in LOCKS; source exports use this hook."""
    paths = []
    for kind, key in closure.nodes:
        if kind == SOURCE_KIND:
            value = closure.read(_path(kind, key))
            paths.append(SOURCE_DIRECTORY + "/" + identifier(value["selection_id"]) + "/.source.lock")
    return sorted(set(paths))


def _members(entry):
    result = {}
    for item in entry.get("companions", []):
        name = _name(item.get("view_path", item["filename"]))
        if name in result:
            raise ValueError("Chemistry report source repeats a companion")
        result[name] = item
    return result


def _captured(closure, entry, recipe):
    native = recipe.get("native_chemistry_report")
    if not isinstance(native, dict):
        raise ValueError("Chemistry report recipe lost its original native identity")
    selection = _selection(native)
    if (selection["edition"] not in READABLE_EDITIONS
            or not isinstance(selection["workspace_id"], str) or not selection["workspace_id"]):
        raise ValueError("Chemistry report source lost its producing project or readable edition")
    _same(selection["edition"], recipe.get("edition"), "captured producer edition")
    for field in ("report_id", "run_id", "case_id", "report_record_sha256", "producer_sha256"):
        identifier(native.get(field))
    members = _members(entry)
    inputs = recipe.get("inputs")
    if not isinstance(inputs, list):
        raise ValueError("Chemistry report source lost its original input inventory")
    seen = set()
    for item in inputs:
        name = _name(item["path"])
        member = members.get(name)
        if name in seen or member is None:
            raise ValueError("Chemistry source input is missing or repeated")
        seen.add(name)
        for field in ("bytes", "sha256"):
            _same(member[field], item[field], "declared companion " + field)
        closure.add_file(member["object"], member)
    _same(set(members), seen, "declared source companion roster")

    def body(name):
        if name not in seen:
            raise ValueError("Chemistry source lacks original member " + name)
        return closure.read(members[name]["object"])

    report = body("dossier/report.json")
    case = body("dossier/original/case.json")
    run = body("dossier/original/run.json")
    project = body("dossier/original/artifacts/project.json")
    request = body("dossier/original/artifacts/request.json")
    result = body("dossier/original/artifacts/result.json")
    stamp = _stamp(run, case, project, request, result)
    _report_identity(report, native["workspace_id"], stamp)
    _same(report["record_sha256"], native["report_record_sha256"], "captured report revision")
    _same(report["id"], native["report_id"], "captured report")
    _same(run["id"], native["run_id"], "captured run")
    _same(case["id"], native["case_id"], "captured case")
    _same(stamp, native["source_stamp"], "captured source stamp")
    _same(report["summary"]["mode"], native["mode"], "captured analysis mode")
    manifest = body("dossier/manifest.json")
    _same(manifest.get("schema"), REPORT_SCHEMA, "captured report manifest schema")
    _same(manifest.get("id"), report["id"], "captured report manifest")
    _same(manifest.get("selection"), report["selection"], "captured report selection")
    report_members = {}
    prefix = "chemistry-reports/" + report["id"]
    for item in report["artifacts"]:
        name = "dossier/" + _within(item["path"], prefix)
        if name in report_members or name not in seen:
            raise ValueError("Captured Chemistry report lost or repeated an original artifact")
        report_members[name] = item
        for field in ("bytes", "sha256"):
            _same(members[name][field], item[field], "captured report artifact " + field)
    for item in manifest["files"]:
        name = "dossier/" + _name(item["path"])
        if name not in report_members:
            raise ValueError("Captured Chemistry report manifest lost an original member")
        for field in ("bytes", "sha256"):
            _same(item[field], members[name][field], "captured manifest member " + field)
    for item in run["artifacts"]:
        name = "dossier/original/" + _name(item["path"])
        if name not in seen:
            raise ValueError("Captured Chemistry source lost an original numerical artifact")
        for field in ("bytes", "sha256"):
            _same(members[name][field], item[field], "captured run artifact " + field)
    return native, selection, report, run, case


def include_source(closure, collection_id, entry):
    """Follow Chemistry only when a saved scientific report selects this source."""
    metadata = entry.get("metadata") or {}
    producer_edition = metadata.get("producer")
    if producer_edition not in READABLE_EDITIONS:
        if (entry.get("id") == SOURCE_ID or (isinstance(producer_edition, str)
                and producer_edition.startswith("native-chemistry-scientific-source-"))):
            raise ValueError("Receive the Chemistry study resolver for this source producer edition")
        return
    if (entry.get("kind") != "document" or entry.get("id") != SOURCE_ID
            or metadata.get("report_schema") != "upstate.observed-report/v1"):
        raise ValueError("Original Chemistry report source has another document identity")
    closure.add_file(entry["body"]["object"], entry["body"])
    recipe = closure.read(entry["body"]["object"])
    if recipe.get("schema") != "upstate.observed-report/v1" or recipe.get("edition") != producer_edition:
        raise ValueError("Original Chemistry report source has another recipe edition")
    native, selection, report, run, case = _captured(closure, entry, recipe)
    for field, expected in (
        ("chemistry_report_id", report["id"]), ("chemistry_run_id", run["id"]),
        ("chemistry_case_id", case["id"]), ("mode", native["mode"]),
    ):
        _same(metadata.get(field), expected, "source metadata " + field)
    local = native["workspace_id"] == closure.workspace.project["id"]
    required = []
    if local:
        reason = "Original editable Chemistry cohort for saved scientific report"
        original_report = record(closure, "chemistry-reports", report["id"], reason)
        _same(original_report, report, "local and captured report")
        original_run = record(closure, "chemistry-runs", run["id"], reason)
        original_case = record(closure, "chemistry-cases", case["id"], reason)
        _same(original_run, run, "local and captured run")
        _same(original_case, case, "local and captured case")
        required.extend({"kind": kind, "id": key} for kind, key in (
            ("chemistry-cases", case["id"]), ("chemistry-runs", run["id"]),
            ("chemistry-reports", report["id"])))
        prefix = SOURCE_DIRECTORY + "/" + digest(selection)
        pointer = prefix + "/result.json"
        if (closure.root / pointer).exists() or (closure.root / pointer).is_symlink():
            retained = closure.read(pointer)
            producers = [record(closure, SOURCE_KIND, retained.get("id"), reason)]
            _same(producers[0], retained, "local source pointer")
        else:
            producers = [record(closure, SOURCE_KIND, row["id"], reason)
                         for row in closure.workspace._list(SOURCE_KIND)
                         if row.get("selection") == selection]
        if not producers:
            raise ValueError("The local Chemistry report source lost its immutable producer record")
        for producer in producers:
            _same(producer["selection"], selection, "local producer selection")
            _same(producer["files"]["observed-report.json"]["sha256"],
                  entry["body"]["sha256"], "local producer recipe")
            _same(producer["files"]["observed-report.json"]["bytes"],
                  entry["body"]["bytes"], "local producer recipe length")
            required.append({"kind": SOURCE_KIND, "id": producer["id"]})
    binding = {
        "schema": "upstate.study-report-lineage/v1",
        "source_collection_id": collection_id, "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"],
        "source_project_id": native["workspace_id"],
        "report_context_kind": "chemistry_report", "producer": producer_edition,
        "report_id": report["id"], "report_record_sha256": report["record_sha256"],
        "run_id": run["id"], "case_id": case["id"], "mode": native["mode"],
        "source_stamp": deepcopy(native["source_stamp"]),
        "relationship": "same_project" if local else "external_project",
        "required_records": sorted(required, key=lambda row: (row["kind"], row["id"])),
    }
    key = (collection_id, entry["id"])
    previous = closure.report_source_records.get(key)
    if previous is not None and previous != binding:
        raise ValueError("Chemistry scientific report lineage changed during study capture")
    closure.report_source_records[key] = binding

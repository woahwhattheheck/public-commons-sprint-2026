"""Editable Climate forcing roots in the original selected-Study archive.

All native datasets use the maintained dependency visitors. Report-directory
membership is captured once in the original receipt; later reports are never
silently added while verifying an older received Study.
"""
from __future__ import annotations

from copy import deepcopy

from .common import digest, identifier
from . import climate_forcing

KIND = climate_forcing.ROOT
ROOT_KINDS = (KIND,)
DOCUMENTS = {KIND: "study.json"}
LOCKS = {KIND: ".study.lock"}
LABELS = {KIND: "Climate forcing studies"}
SCHEMA = "upstate.climate-forcing-study-lineage/v1"


def _file(closure, name):
    item = closure.files[name]
    return {"path": name, "bytes": item["bytes"], "sha256": item["sha256"]}


def _case(value):
    return {name: deepcopy(value[name]) for name in (
        "id", "label", "baseline", "grid_id", "run_id", "run_selection",
        "overrides", "source_preview_id", "source_collection_id", "forcing_diagnostics")
        if name in value}


def _capture_selection(closure, key):
    frozen = closure.climate_forcing_selection
    if frozen is None:
        return None
    matches = [item for item in frozen if item.get("study_id") == key]
    if len(matches) != 1:
        raise ValueError("The received Study lost its captured Climate forcing selection")
    return matches[0]


def _report(closure, study_id, report_id, identity, cases, retained=None):
    prefix = KIND + "/" + study_id + "/reports/" + identifier(report_id)
    if retained is None:
        members = closure._tree_members(prefix)
        if not members:
            return None
        complete = prefix + "/record.json" in members
    else:
        if (retained.get("id") != report_id or type(retained.get("complete")) is not bool
                or not isinstance(retained.get("members"), list)):
            raise ValueError("The captured forcing report directory is unreadable")
        members = retained["members"]
        complete = retained["complete"]
        if (len(set(members)) != len(members)
                or any(not name.startswith(prefix + "/") for name in members)):
            raise ValueError("A captured forcing member escaped its original report")
    for member in members:
        closure.add_file(member)
    snapshot_name = prefix + "/snapshot.json"
    if snapshot_name not in members:
        raise ValueError("The retained forcing report lost its original run snapshot")
    snapshot = closure.read(snapshot_name)
    if (digest(snapshot) != report_id or snapshot.get("schema") != climate_forcing.REPORT_SCHEMA
            or snapshot.get("study_id") != study_id
            or snapshot.get("workspace_id") != closure.workspace.project["id"]
            or snapshot.get("study_identity") != identity):
        raise ValueError("The report snapshot belongs to another original forcing selection")
    case_runs = {case["run_id"]: case["run_selection"] for case in cases}
    if (identity["baseline"]["run_id"] not in snapshot["runs"]
            or len(snapshot["runs"]) < 2
            or not set(snapshot["runs"]).issubset(case_runs)):
        raise ValueError("The forcing report changed its original selected native cohort")
    for run_id, run in snapshot["runs"].items():
        if run.get("selection") != case_runs[run_id] or run.get("state") != "complete":
            raise ValueError("The forcing report changed a completed prepared case")
        if run.get("id") != run_id or digest(run["selection"]) != run_id:
            raise ValueError("The report changed a captured original native run")
        closure.need("runs", run_id, "Original completed forcing report cohort")
        closure._native_selection(run["selection"], "Original completed forcing report inputs")
        current = closure.read("runs/" + identifier(run_id) + "/run.json")
        if current["selection"] != run["selection"]:
            raise ValueError("The report's native selection changed after capture")
        for name, artifact in run.get("artifacts", {}).items():
            actual = current.get("artifacts", {}).get(name)
            if actual is None or any(actual.get(field) != artifact.get(field) for field in ("bytes", "sha256")):
                raise ValueError("The report lost an original completed annual mass artifact")
            closure.add_file("runs/" + run_id + "/" + artifact["path"], artifact)
    record_descriptor = None
    if complete:
        record_name = prefix + "/record.json"
        if record_name not in members:
            raise ValueError("The complete forcing report lost its original record")
        if retained is not None:
            closure.add_file(record_name, retained["record"])
        value = closure.read(record_name)
        checked = climate_forcing.get_report(closure.workspace, study_id, report_id, verify=False)
        if value != checked or value["identity"] != snapshot:
            raise ValueError("The complete forcing report changed during capture")
        for item in value["files"].values():
            name = prefix + "/" + item["path"]
            if name not in members:
                raise ValueError("The captured forcing report omitted a declared download")
            closure.add_file(name, item)
        source = value["source"]
        closure.need("sources", source["source_collection_id"], "Complete forcing report and editable maps")
        collection = closure.read("sources/" + source["source_collection_id"] + ".json")
        original = collection["original_manifest"]
        closure.add_file(original["object"], original)
        # The immutable original manifest anchors complete source companion
        # ordering; the normal sources visitor retains every native object.
        original_manifest = closure.read(original["object"])
        saved_manifest = closure.read(prefix + "/sources.json")
        if original_manifest != saved_manifest:
            raise ValueError("The forcing report changed its original source manifest")
        record_descriptor = _file(closure, record_name)
    snapshot_descriptor = _file(closure, snapshot_name)
    if retained is not None and snapshot_descriptor != retained["snapshot"]:
        raise ValueError("The captured forcing report snapshot changed")
    result = {"id": report_id, "complete": complete, "members": list(members),
              "snapshot": snapshot_descriptor, "record": record_descriptor}
    if retained is not None and result != retained:
        raise ValueError("The captured forcing report changed its original directory binding")
    if retained is None:
        # Discovery is checked again under the original report/study locks.
        closure.trees[prefix] = list(members)
    return result


def visit(closure, kind, key, value):
    if kind != KIND:
        return False
    key = identifier(key)
    prefix = KIND + "/" + key
    identity = closure.read(prefix + "/selection.json")
    if (digest(identity) != key or identity.get("schema") != climate_forcing.SCHEMA
            or identity.get("workspace_id") != closure.workspace.project["id"]
            or value.get("schema") != climate_forcing.SCHEMA or value.get("id") != key
            or value.get("workspace_id") != closure.workspace.project["id"]
            or value.get("selection") != identity["selection"]):
        raise ValueError("The selected forcing design changed its original scientific identity")
    if climate_forcing._read(closure.workspace, key) != value:
        raise ValueError("The forcing checkpoint changed during Study selection")
    retained = _capture_selection(closure, key)
    cases = [_case(case) for case in value["cases"]]
    if retained is not None:
        if (retained.get("schema") != SCHEMA or retained.get("workspace_id") != value["workspace_id"]
                or retained.get("selection") != identity["selection"]
                or retained.get("selection_file") != _file(closure, prefix + "/selection.json")):
            raise ValueError("The captured forcing design changed its original source edition")
        chosen = retained.get("cases")
        if not isinstance(chosen, list) or not chosen:
            raise ValueError("The captured forcing design lost its prepared reference")
        indexed = {case["id"]: case for case in cases}
        if len(indexed) != len(cases) or any(indexed.get(case["id"]) != case for case in chosen):
            raise ValueError("A captured forcing case changed its original prepared identity")
        cases = deepcopy(chosen)
    if not cases or cases[0]["id"] != "baseline" or len({case["id"] for case in cases}) != len(cases):
        raise ValueError("The forcing design needs its unique original baseline and case order")
    expected_order = ["baseline", *[case["id"] for case in identity["selection"]["cases"]]]
    if [case["id"] for case in cases] != expected_order[:len(cases)]:
        raise ValueError("The captured forcing cases changed their original preparation order")
    for case in cases:
        climate_forcing._check_case(closure.workspace, identity, case)
        closure.need("runs", case["run_id"], "Original forcing case, including unfinished native work")
        closure._native_selection(case["run_selection"], "Original forcing grid, profile and scenario")
        if case.get("source_collection_id"):
            closure.need("sources", case["source_collection_id"], "Original composed forcing grid sources")
    # Includes exact baseline and future case source editions even when preparation
    # stopped before creating a native grid/run. No unmaterialized run is invented.
    closure._source_refs(identity, "Original forcing and reporting source editions")
    closure._native_selection(identity["baseline"]["run_selection"], "Original forcing comparison reference")
    source_names = {"forcing-sources-" + source["source"]["id"] + ".json"
                    for source in identity["sources"]}
    manifests = []
    if retained is None:
        for name in sorted(source_names):
            if (closure.root / name).exists():
                closure.read(name)
                manifests.append(_file(closure, name))
    else:
        saved_manifests = retained.get("source_manifests")
        if not isinstance(saved_manifests, list):
            raise ValueError("The captured forcing source-manifest list is missing")
        names = set()
        for item in saved_manifests:
            name = item["path"]
            if name not in source_names or name in names:
                raise ValueError("The captured forcing source manifest changed selection")
            names.add(name)
            closure.add_file(name, item)
            closure.read(name)
            descriptor = _file(closure, name)
            if descriptor != item:
                raise ValueError("The original forcing source manifest changed")
            manifests.append(descriptor)
    if retained is None:
        # Track discovery against concurrent report publication as well as the
        # selected report trees. No source data is copied by this metadata pass.
        closure.trees[prefix] = closure._tree_members(prefix)
        report_ids = sorted(path.name for path in (closure.root / prefix / "reports").iterdir()
                            if path.is_dir()) if (closure.root / prefix / "reports").is_dir() else []
        reports = [_report(closure, key, report_id, identity, cases) for report_id in report_ids]
        reports = [report for report in reports if report is not None]
    else:
        reports = []
        seen = set()
        for report in retained.get("reports", []):
            report_id = identifier(report["id"])
            if report_id in seen:
                raise ValueError("The received forcing Study repeats a saved report")
            seen.add(report_id)
            reports.append(_report(closure, key, report_id, identity, cases, report))
    record = {"schema": SCHEMA, "study_id": key, "workspace_id": value["workspace_id"],
              "selection": deepcopy(identity["selection"]),
              "selection_file": _file(closure, prefix + "/selection.json"),
              "cases": cases, "reports": reports, "source_manifests": manifests}
    if retained is not None and record != retained:
        raise ValueError("The received forcing Study changed its captured family")
    closure.climate_forcing_records[key] = record
    node = closure.nodes[(KIND, key)]
    node.update(state=value.get("state"), planned_cases=len(expected_order),
                prepared_cases=len(cases), completed_reports=sum(report["complete"] for report in reports))
    return True


def receipt(closure):
    return [deepcopy(value) for _, value in sorted(closure.climate_forcing_records.items())]


def verify_receipt(closure, retained):
    if receipt(closure) != retained:
        raise ValueError("The received Study changed its original forcing selection")


def lock_paths(closure):
    paths = set()
    for key, record in closure.climate_forcing_records.items():
        prefix = KIND + "/" + identifier(key)
        paths.add(prefix + "/.study.lock")
        for report in record["reports"]:
            paths.add(prefix + "/reports/" + identifier(report["id"]) + "/.report.lock")
    return sorted(paths)


def catalogue(workspace):
    result = []
    for path in sorted((workspace.root / KIND).glob("*/study.json")):
        key = identifier(path.parent.name)
        try:
            study = climate_forcing.get(workspace, key)
            result.append({"kind": KIND, "id": key, "title": study["title"],
                           "state": study["state"], "updated_at": study.get("updated_at") or study["created_at"],
                           "selection": {"baseline_run_id": study["selection"]["baseline_run_id"],
                                         "models": study["models"]},
                           "counts": deepcopy(study["progress"]),
                           "view": "climate-forcing", "error": study.get("error")})
        except (OSError, ValueError, KeyError, TypeError) as error:
            result.append({"kind": KIND, "id": key, "title": key[:16], "state": "unreadable",
                           "updated_at": "", "error": {"message": str(error)}})
    return result

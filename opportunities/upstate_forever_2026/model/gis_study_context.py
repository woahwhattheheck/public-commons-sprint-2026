"""Original saved-report and native-history context for a selected native GIS cohort."""
from __future__ import annotations

from copy import deepcopy
from importlib import import_module
import json

from .common import identifier, verify_file
from . import gis_project as gis

VERSION = "native-study-context/v1"


def _pair(row):
    return row.get("source_collection_id"), row.get("source_id")


def report_choices(workspace, collection_id, source_id):
    from . import scientific_report_editions as reports
    result = []
    for path in sorted((workspace.root / reports.KIND).glob("*/edition.json")):
        record, _ = reports.record(workspace, path.parent.name)
        if record.get("state") == "complete" and any(
                _pair(row) == (collection_id, source_id) for row in record.get("sources", [])):
            result.append({"id": record["id"], "title": record["title"],
                           "source_count": record["source_count"]})
    return result


def _files(workspace, directory, descriptors):
    result = {}
    for item in descriptors.values():
        path = verify_file(directory, item)
        value = gis.record(workspace.root, path)
        old = result.get(value["path"])
        if old is not None and old != value:
            raise ValueError("Saved context files disagree about original identity")
        result[value["path"]] = value
    if not result:
        raise ValueError("The selected saved context contains no retained files")
    return result


def _context(workspace, title, kind, identity, files, primary):
    first = primary
    if first not in files or not first.lower().endswith(".html"):
        raise ValueError("The selected saved context lacks its original readable HTML")
    binding = {"id": identity["id"], "files_sha256": gis.fingerprint(files)}
    return {"binding": binding, "title": title, "file_count": len(files),
            "attachment": {"id": kind + ":" + identity["id"], "title": title,
                           "kind": "document", "file": files[first],
                           "companions": [files[name] for name in sorted(files) if name != first],
                           "source": {"kind": kind, "context_version": VERSION,
                                      "source_project_id": workspace.project["id"],
                                      **deepcopy(identity), "files_sha256": binding["files_sha256"]}}}


def report_context(workspace, collection_id, source_id, report_id):
    from . import scientific_report_editions as reports
    record, directory, _ = reports.inspect(workspace, identifier(report_id))
    if not any(_pair(row) == (collection_id, source_id) for row in record["sources"]):
        raise ValueError("The saved scientific report does not contain this exact native-study source")
    files = _files(workspace, directory, reports.files(record, directory))
    return _context(workspace, record["title"], "original saved scientific report",
                    {"id": record["id"], "operation_id": record["operation_id"],
                     "source_collection_id": collection_id, "source_id": source_id,
                     "ordered_sources": deepcopy(record["sources"]),
                     "render_identity": deepcopy(record["render_identity"])}, files,
                    gis.record(workspace.root, verify_file(directory, record["files"]["report_html"]))["path"])


def _history(required=False):
    name = __package__ + ".native_run_history"
    try:
        return import_module(name)
    except ModuleNotFoundError as error:
        if error.name != name:
            raise
        if required:
            raise ValueError("Install the original native execution-history component for this selected history") from error
        return None


def history_choices(workspace, run_ids):
    history = _history()
    if history is None:
        return {"available": False, "histories": [],
                "message": "Execution-history sources are not installed in this application."}
    wanted = set(run_ids)
    return {"available": True, "histories": [
        {"id": row["id"], "title": row["title"], "captured_at": row["captured_at"],
         "run_ids": list(row["selection"]["run_ids"]), "summary": deepcopy(row["summary"])}
        for row in history.catalog(workspace)
        if len(row["selection"]["run_ids"]) == len(wanted)
        and set(row["selection"]["run_ids"]) == wanted]}


def history_context(workspace, captured, history_id):
    history = _history(required=True)
    record = history.inspect(workspace, identifier(history_id))
    basis, operation, recipe, members, selected, plan, runs, grid, collections, comparisons, content = captured
    if (record["project_id"] != workspace.project["id"]
            or len(record["selection"]["run_ids"]) != len(runs)
            or set(record["selection"]["run_ids"]) != set(runs)):
        raise ValueError("Choose a saved execution history for this exact original native cohort")
    directory = workspace.root / history.ROOT / record["id"]
    with verify_file(directory, record["files"]["originals.json"]).open("r", encoding="utf-8") as stream:
        originals = json.load(stream)
    frozen = {row["id"]: row for row in originals["runs"]}
    if len(frozen) != len(originals["runs"]) or set(frozen) != set(runs):
        raise ValueError("The saved execution history changed its original run identities")
    contexts = originals["contexts"]
    for run_id, captured_run in runs.items():
        observed = frozen[run_id]
        if observed.get("state") != "complete" or observed["selection"] != captured_run["selection"]:
            raise ValueError("The saved execution history precedes or differs from the completed scientific cohort")
        if observed.get("stages", {}).get("landcover") != captured_run.get("stages", {}).get("landcover"):
            raise ValueError("Execution history and scientific study retain different land-cover inputs")
        for metric, descriptor in captured_run.get("artifacts", {}).items():
            if observed.get("artifacts", {}).get(metric) != descriptor:
                raise ValueError("Execution history and scientific study retain different original results: " + metric)
        selection = captured_run["selection"]
        if contexts["grids"].get(selection["grid_id"]) != grid:
            raise ValueError("Execution history and scientific study retain different original grids")
        for family, field in (("profiles", "profile_id"), ("scenarios", "scenario_id")):
            key = selection[field]
            # _selected already verified these immutable inputs against the
            # captured source. The history must bind the very same records.
            if contexts[family].get(key) != workspace._get(family, key):
                raise ValueError("Execution history and scientific study retain different " + family)
    files = _files(workspace, directory, record["files"])
    result = _context(workspace, record["title"], "original native execution history",
                      {"id": record["id"], "captured_at": record["captured_at"],
                       "run_ids": list(record["selection"]["run_ids"]),
                       "originals_sha256": record["files"]["originals.json"]["sha256"],
                       "summary": deepcopy(record["summary"]),
                       "interpretation": "Observed retained execution snapshot, with its own capture time. Later unrelated stages may be present; selected scientific artifacts and inputs match the saved study."}, files,
                      gis.record(workspace.root, verify_file(directory, record["files"]["index.html"]))["path"])
    result["captured_at"] = record["captured_at"]
    result["summary"] = deepcopy(record["summary"])
    return result


def selected_contexts(workspace, collection_id, source_id, captured, chosen):
    result = []
    for field in ("scientific_report", "execution_history"):
        if field not in chosen:
            continue
        binding = chosen[field]
        if (not isinstance(binding, dict) or set(binding) != {"id", "files_sha256"}):
            raise ValueError("Preview the exact selected saved context before GIS export")
        context = (report_context(workspace, collection_id, source_id, binding["id"])
                   if field == "scientific_report"
                   else history_context(workspace, captured, binding["id"]))
        if context["binding"] != binding:
            raise ValueError("The selected saved context changed; reopen its original preview")
        result.append(context)
    return result

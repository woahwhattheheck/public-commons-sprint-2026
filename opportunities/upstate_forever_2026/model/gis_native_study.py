"""Saved native-study source -> original editable GIS handover, without a model run."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

from .common import file_digest, identifier, relative_file
from . import gis_project as gis
from . import ensemble_study_transfer as producer

VERSION = "native-study-gis/v1"


class _SourceReader:
    """The original captured-source reader protocol, scoped to retained CAS."""
    def __init__(self, workspace):
        self.root = workspace.root
        self.expected = {}

    def add_file(self, relative, expected=None):
        path = relative_file(self.root, relative)
        if expected is not None:
            value = {"bytes": expected["bytes"], "sha256": expected["sha256"]}
            old = self.expected.get(relative)
            if old is not None and old != value:
                raise ValueError("Native-study source members disagree about original bytes")
            self.expected[relative] = value
        value = self.expected.get(relative)
        if value is not None and (path.stat().st_size != value["bytes"]
                                  or file_digest(path) != value["sha256"]):
            raise ValueError("The retained native-study source member changed: " + relative)
        return path

    def read(self, relative):
        path = self.add_file(relative)
        raw = path.read_bytes()
        import hashlib
        value = self.expected.get(relative)
        if value is not None and (len(raw) != value["bytes"]
                                  or hashlib.sha256(raw).hexdigest() != value["sha256"]):
            raise ValueError("The selected native-study record changed during reading")
        return json.loads(raw)


def choices(workspace):
    """Only registered collection metadata; selected input bodies stay lazy."""
    result = []
    for collection in workspace.sources():
        for entry in collection["entries"]:
            metadata = entry.get("metadata") or {}
            if metadata.get("source_basis") != producer.BASIS:
                continue
            result.append({
                "source_collection_id": collection["id"], "source_id": entry["id"],
                "title": entry["title"], "source_sha256": entry["body"]["sha256"],
                "ensemble_id": metadata.get("ensemble_id"),
                "report_id": metadata.get("report_id"),
                "source_project_id": metadata.get("workspace_id"),
                "local_project": metadata.get("workspace_id") == workspace.project["id"],
            })
    return result


def _selected(workspace, selection):
    if not isinstance(selection, dict):
        raise ValueError("Choose the original saved native-study source")
    collection_id = identifier(selection["source_collection_id"])
    collection = workspace._get("sources", collection_id)
    found = [row for row in collection["entries"]
             if row["id"] == selection.get("source_id")]
    if len(found) != 1 or (found[0].get("metadata") or {}).get("source_basis") != producer.BASIS:
        raise ValueError("Choose one registered saved native-study source")
    entry = found[0]
    if selection.get("source_sha256") and selection["source_sha256"] != entry["body"]["sha256"]:
        raise ValueError("The selected native-study source has another original identity")
    reader = _SourceReader(workspace)
    captured = producer._captured(reader, entry)
    basis, operation, recipe, members, selected, plan, runs, grid, collections, comparisons, content = captured
    if basis["workspace_id"] != workspace.project["id"]:
        raise ValueError("Open the source study's restored original project to export its native raster results")
    if workspace._get("ensembles", plan["id"]) != plan:
        raise ValueError("The original native design differs from the saved study source")
    current_grid = workspace.get_grid(grid["id"])
    if current_grid != grid:
        raise ValueError("The prepared grid differs from the saved native-study source")
    for member in plan["members"]:
        for key in {member["profile_id"], member.get("parent_profile_id")} - {None}:
            original = reader.read(members["original/profiles/" + key + ".json"]["object"])
            if workspace._get("profiles", key) != original:
                raise ValueError("A native profile differs from its report-bound original")
        for selected_run in member["runs"]:
            key = selected_run["scenario_id"]
            original = reader.read(members["original/scenarios/" + key + ".json"]["object"])
            if workspace._get("scenarios", key) != original:
                raise ValueError("A native scenario differs from its report-bound original")
    for key, snapshot in runs.items():
        current = workspace.inspect_run(key)
        if snapshot["state"] != "complete" or current["state"] != "complete":
            raise ValueError("Complete this source's original native cohort before GIS handover: " + key)
        if current["selection"] != snapshot["selection"]:
            raise ValueError("A native run differs from its captured scientific selection")
        if snapshot.get("stages", {}).get("landcover") != current.get("stages", {}).get("landcover"):
            raise ValueError("The native land-cover stage differs from its report-bound original")
        for metric, artifact in snapshot.get("artifacts", {}).items():
            if current.get("artifacts", {}).get(metric) != artifact:
                raise ValueError("A native result differs from its captured report: " + key + "/" + metric)
    for key, captured_comparison in comparisons.items():
        current = gis.load(relative_file(workspace.root, "comparisons/" + key + "/comparison.json"))
        if current != captured_comparison:
            raise ValueError("A saved native comparison differs from its report-bound original")
    return collection, entry, captured



def _rendered(workspace, basis, operation_id):
    path = workspace.root / producer.DIRECTORY / operation_id / "operation.json"
    if not path.exists():
        return None
    value = gis.load(relative_file(workspace.root, path.relative_to(workspace.root).as_posix()))
    if (value.get("selection") != basis or value.get("id") != operation_id
            or value.get("workspace_id") != workspace.project["id"]):
        raise ValueError("The original native-study rendering belongs to another captured source")
    if value.get("state") != "complete":
        return None
    files = value.get("files") or {}
    if not files or not any(Path(item["path"]).suffix.lower() in {".html", ".pdf"} for item in files.values()):
        return None
    descriptors = {}
    for item in files.values():
        gis.checked(workspace.root, item)
        previous = descriptors.get(item["path"])
        if previous is not None and previous != item:
            raise ValueError("Native-study rendered files disagree about original identity")
        descriptors[item["path"]] = deepcopy(item)
    return {"source_operation_id": operation_id, "files": descriptors,
            "files_sha256": gis.fingerprint(descriptors)}

def preview(workspace, selection):
    collection, entry, captured = _selected(workspace, selection)
    basis, operation, recipe, members, selected, plan, runs, grid, collections, comparisons, content = captured
    quantities = {}
    for run in runs.values():
        for metric, artifact in run.get("artifacts", {}).items():
            if Path(artifact.get("path", "")).suffix.lower() in {".tif", ".tiff"}:
                key = (metric, artifact.get("units"))
                quantities[key] = {"metric": metric, "units": artifact.get("units")}
    from . import gis_study_context as context
    saved_report = (context.report_context(workspace, collection["id"], entry["id"],
                                          selection["scientific_report_id"])
                    if selection.get("scientific_report_id") else None)
    saved_history = (context.history_context(workspace, captured, selection["execution_history_id"])
                     if selection.get("execution_history_id") else None)
    return {
        "scientific_reports": context.report_choices(workspace, collection["id"], entry["id"]),
        "execution_histories": context.history_choices(workspace, runs),
        "selected_scientific_report": ({k: v for k, v in saved_report.items() if k != "attachment"}
                                      if saved_report else None),
        "selected_execution_history": ({k: v for k, v in saved_history.items() if k != "attachment"}
                                      if saved_history else None),
        "schema": "upstate.native-study-gis-selection/v1", "version": VERSION,
        "source_collection_id": collection["id"], "source_id": entry["id"],
        "source_sha256": entry["body"]["sha256"], "source_title": entry["title"],
        "ensemble_id": plan["id"], "report_id": basis["report_id"],
        "project_id": workspace.project["id"], "title": plan["title"],
        "grid_id": grid["id"], "project_crs": grid["grid"].get("crs_name") or grid["grid"].get("crs"),
        "grid": deepcopy(grid["grid"]), "scope": deepcopy(grid["spec"]),
        "members": deepcopy(plan["members"]), "run_count": len(runs),
        "comparison_count": len(comparisons),
        "quantities": [quantities[key] for key in sorted(quantities, key=str)],
        "report_rows": {field: len(content.get(field, [])) for field in ("paired_rows", "parameter_rows")},
        "source_companions": len(entry.get("companions", [])),
        "rendered_report": _rendered(workspace, basis, operation),
        "interpretation": "Original annual cell mass reaching the modeled stream. Original comparisons retain their reported direction and common-cell support. These are not concentrations or measured intake delivery.",
    }


def request(workspace, selection):
    """Compose the existing request from one frozen cohort and all its source context."""
    from . import gis_workspace
    chosen = selection["native_study"]
    collection, entry, captured = _selected(workspace, chosen)
    basis, operation, recipe, members, selected, plan, runs, grid, collections, comparisons, content = captured
    if any(selection.get(name) for name in ("delivery_id", "grid_id", "baseline_run_id",
                                            "scenario_run_ids", "comparison_ids", "sources",
                                            "source_collection_id")):
        raise ValueError("Use the saved native-study cohort or manual selections as separate GIS handovers")
    ids = list(dict.fromkeys(row["run_id"] for member in plan["members"] for row in member["runs"]))
    normal = {"title": selection.get("title") or entry["title"] + " · editable GIS",
              "scenario_run_ids": ids, "comparison_ids": list(comparisons),
              "include_grid": True, "notes": list(selection.get("notes", [])),
              "sources": [{"source_collection_id": collection["id"], "source_id": entry["id"]}]}
    if selection.get("project_crs"):
        normal["project_crs"] = selection["project_crs"]
    result = gis_workspace.request(workspace, normal)
    # A run may acquire an unrelated stage after this report. Keep only the
    # actual captured physical rasters; later results require their own source edition.
    result["layers"] = [row for row in result["layers"]
        if not (row.get("run_id") in runs and row.get("purpose") == "physical")
        or row.get("metric") in runs[row["run_id"]].get("artifacts", {})]
    context_id = "source:" + collection["id"] + ":" + entry["id"]
    originals = next(row for row in result["attachments"] if row["id"] == context_id)
    originals["group"] = "Original native-study report and numerical context"
    originals["source"]["metadata"] = deepcopy(entry["metadata"])
    # The original complete report hierarchy travels once as ordinary originals.
    # Typed CSV attachments expose its complete tables in the offline source desk.
    view, unused = workspace.source_file(collection["id"], entry["id"])
    view_root = view
    for unused in Path(entry["body"].get("view_path", entry["body"]["filename"])).parts:
        view_root = view_root.parent
    for name in sorted(selected):
        if not name.startswith("numeric/") or Path(name).suffix.lower() != ".csv":
            continue
        body = members[name]
        path = gis.checked(view_root, {"path": name, "bytes": body["bytes"], "sha256": body["sha256"]})
        result["attachments"].append({
            "id": "native-study-table:" + collection["id"] + ":" + name,
            "title": "Original native study · " + Path(name).name, "kind": "table",
            "file": gis.record(workspace.root, path), "companions": [],
            "units": None,
            "source": {"kind": "original native-study numeric table",
                       "collection_id": collection["id"], "id": entry["id"], "member": name,
                       "sha256": body["sha256"], "uri": entry["uri"], "vintage": entry["vintage"],
                       "source_project_id": basis["workspace_id"], "ensemble_id": plan["id"],
                       "report_id": basis["report_id"], "context_attachment_id": context_id,
                       "quantities_note": "Heterogeneous original columns retain their declared units in the numerical report.",
                       "scope": "Original numerical rows and full/common/excluded support, unchanged"},
        })
    selected_render = chosen.get("rendered_report")
    if selected_render is not None:
        rendered = _rendered(workspace, basis, operation)
        if rendered is None or selected_render != {
                "source_operation_id": rendered["source_operation_id"],
                "files_sha256": rendered["files_sha256"]}:
            raise ValueError("The selected native-study report files changed; inspect their current edition")
        files = rendered["files"]
        first = next((name for name in sorted(files) if name.lower().endswith(".html")), None)
        if first is None:
            first = next(name for name in sorted(files) if name.lower().endswith(".pdf"))
        result["attachments"].append({
            "id": "native-study-rendered:" + operation,
            "title": "Original rendered native-study report and complete declared files",
            "kind": "document", "file": files[first],
            "companions": [files[name] for name in sorted(files) if name != first],
            "source": {"kind": "original completed native-study rendering",
                       "source_operation_id": operation, "selection": deepcopy(basis),
                       "files_sha256": rendered["files_sha256"],
                       "source_collection_id": collection["id"], "source_id": entry["id"]},
        })
    from . import gis_study_context as context
    saved_contexts = context.selected_contexts(workspace, collection["id"], entry["id"], captured, chosen)
    result["attachments"].extend(row["attachment"] for row in saved_contexts)
    by_run = {}
    for member in plan["members"]:
        for row in member["runs"]:
            by_run[row["run_id"]] = {"member_id": member["id"], "member_label": member.get("label"),
                "profile_id": member["profile_id"], "scenario_id": row["scenario_id"],
                "role": row.get("role"), "run_id": row["run_id"],
                "run_record_member": "original/native-runs.json",
                "run_selection": deepcopy(runs[row["run_id"]]["selection"])}
    for layer in result["layers"]:
        layer.setdefault("source", {})["native_study"] = {
            "source_collection_id": collection["id"], "source_id": entry["id"],
            "source_sha256": entry["body"]["sha256"], "ensemble_id": plan["id"],
            "report_id": basis["report_id"], "context_attachment_id": context_id,
            "grid_id": grid["id"], "reporting_support": deepcopy(grid["files"].get("reporting_mask")),
        }
        if layer.get("run_id") in by_run:
            layer["source"]["native_study"]["member"] = deepcopy(by_run[layer["run_id"]])
    result["provenance"]["native_study"] = {
        "version": VERSION, "source_collection_id": collection["id"], "source_id": entry["id"],
        "source_sha256": entry["body"]["sha256"], "selection": deepcopy(basis),
        "source_title": entry["title"], "design_title": plan["title"],
        "scope": deepcopy(grid["spec"]), "runs": ids, "comparisons": list(comparisons),
        "context_attachment_id": context_id,
        "saved_contexts": [{"binding": row["binding"], "title": row["title"],
                            "attachment_id": row["attachment"]["id"]} for row in saved_contexts],
        "interpretation": "Retained native model artifacts and original numerical report. Source simulation and geography remain those of this selected edition. No values are recomputed or converted.",
    }
    return result

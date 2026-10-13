"""Prepare an actual description-only successor of the completed 5156 case.

This command uses retained sources and maintained Source Updates APIs. It never
executes a native model unless --complete explicitly invokes the maintained
native reuse coordinator. Run from the installed application with python -m.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import tempfile

from model import source_refresh
from model.common import atomic_json, digest, file_digest, held, now, read_json, relative_file
from model.native_versions import model_versions
from types import SimpleNamespace
from model.workspace import Workspace

PROJECT = "1b6a344c-df5a-4986-a5e4-47a2d158324b"
PROFILE = "6a24d29ad5adc6adb5dc1806fe2229045132e44549e0ea71f828a460b83fe6c3"
DEMO = "upstate-simulated-piedmont-headwaters-v1"
TITLE = "Original simulated headwaters: explicit geographic scope"
CLARIFICATION = (
    "Geographic scope clarification for the original 5156 teaching case: "
    "this entry belongs to a 120 by 120 cell, 30 m simulated square whose "
    "model-domain and reporting-area extents coincide. It is not an observed "
    "Upper Savannah input layer or the separate successor case on original "
    "catchment and utility geometry. The original SIMULATED classifications "
    "and assumptions remain authoritative. This edition changes descriptive "
    "provenance only; source bodies, companions, reader paths, units and "
    "computational metadata are retained."
)
RATIONALE = (
    "Keep the completed original simulated-square demonstration distinguishable "
    "from the separate case using original Upper Savannah geography. Inspect "
    "the retained source descriptions, actual native-stage reuse and comparison "
    "support before handing over the editable source update. No conservation "
    "benefit or physical change is asserted by this provenance clarification."
)


def _outside(path, root):
    if path.is_relative_to(root) or root.is_relative_to(path):
        raise ValueError("Keep the preparation output separate from Workspace and application")


def _member(root, name):
    if (not isinstance(name, str) or not name or "\\" in name or "\0" in name
            or Path(name).is_absolute() or ".." in Path(name).parts
            or Path(name).as_posix() != name):
        raise ValueError("Original manifest has a nonportable member path")
    target = root / name
    if not target.parent.resolve().is_relative_to(root.resolve()) or target.is_symlink():
        raise ValueError("Source intake member escapes its owned directory")
    return target


def _verified(workspace, item):
    path = relative_file(workspace.root, item["object"])
    if path.stat().st_size != item["bytes"] or file_digest(path) != item["sha256"]:
        raise ValueError("Retained original input bytes changed: " + item["object"])
    return path


def _copy(workspace, item, target):
    source = _verified(workspace, item)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.stat().st_size != item["bytes"] or file_digest(target) != item["sha256"]:
            raise ValueError("Existing clarification intake member differs: " + str(target))
        return
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".clarification-", delete=False) as out:
            pending = Path(out.name)
            with source.open("rb") as incoming:
                shutil.copyfileobj(incoming, out, 1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        if pending.stat().st_size != item["bytes"] or file_digest(pending) != item["sha256"]:
            raise ValueError("Original source changed during clarification intake")
        os.replace(pending, target)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _original(workspace, expected_collection=None):
    if workspace.project["id"] != PROJECT:
        raise ValueError("Choose the independently received original completed 5156 project")
    profile = workspace._get("profiles", PROFILE)
    collection_id = profile["source_collection_id"]
    if expected_collection is not None and collection_id != expected_collection:
        raise ValueError("The actual original profile binds source collection " + collection_id)
    collection = workspace._get("sources", collection_id)
    manifest_path = _verified(workspace, collection["original_manifest"])
    manifest = read_json(manifest_path)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("The original retained import manifest is unavailable")
    entries = {row["id"]: row for row in collection["entries"]}
    if len(entries) != len(collection["entries"]):
        raise ValueError("The original collection has duplicate source IDs")
    recipe_entry = entries.get("SIM_RECIPE")
    if recipe_entry is None:
        raise ValueError("The profile does not bind the original retained simulated recipe")
    recipe = read_json(_verified(workspace, recipe_entry["body"]))
    grid = recipe.get("grid", {})
    if (recipe.get("demo_id") != DEMO
            or recipe.get("classification") != "SIMULATED DEMONSTRATION INPUTS"
            or (grid.get("width"), grid.get("height"), grid.get("resolution_m"), grid.get("crs"))
               != (120, 120, 30, "EPSG:26917")):
        raise ValueError("This preparation belongs only to the original simulated-square case")
    features = recipe.get("features", {})
    if (not features.get("model_domain", {}).get("geometry")
            or features["model_domain"]["geometry"]
            != features.get("reporting_area", {}).get("geometry")):
        raise ValueError("The original recipe no longer has coincident model/reporting extents")
    return profile, collection, manifest, recipe


def _intake(workspace, collection, manifest, directory):
    successor = deepcopy(manifest)
    successor["title"] = TITLE
    indexed = {row["id"]: row for row in collection["entries"]}
    manifest_rows = successor.get("entries", [])
    if (len(manifest_rows) != len(indexed)
            or {row.get("id") for row in manifest_rows} != set(indexed)):
        raise ValueError("Retained collection and original manifest enumerate different sources")
    proof, paths = [], {}
    for row in manifest_rows:
        original = indexed[row["id"]]
        metadata = {key: value for key, value in row.items() if key not in ("path", "sha256", "companions")}
        retained = {key: value for key, value in original.items() if key not in ("body", "companions")}
        if metadata != retained:
            raise ValueError("Original manifest metadata differs from its imported record: " + row["id"])
        originals = [original["body"], *original.get("companions", [])]
        supplied = [{"path": row["path"], "sha256": row.get("sha256")},
                    *row.get("companions", [])]
        if len(originals) != len(supplied):
            raise ValueError("Original companion inventory differs")
        for member, item in zip(supplied, originals):
            name = member["path"]
            if item.get("source_path") != name:
                raise ValueError("Original source path differs from its retained reader tree")
            if member.get("sha256") not in (None, item["sha256"]):
                raise ValueError("Original manifest checksum differs")
            target = _member(directory, name)
            if name in paths and paths[name] != (item["bytes"], item["sha256"]):
                raise ValueError("Different original bodies share an intake path")
            paths[name] = (item["bytes"], item["sha256"])
            _copy(workspace, item, target)
            proof.append({"source_id": row["id"], "path": name,
                          "view_path": item.get("view_path", item["filename"]),
                          "bytes": item["bytes"], "sha256": item["sha256"]})
        description = row.get("description", "")
        if not isinstance(description, str):
            raise ValueError("Original description must remain plain text: " + row["id"])
        if CLARIFICATION not in description:
            row["description"] = description + ("\n\n" if description else "") + CLARIFICATION
    manifest_name = "source-clarification-" + digest(CLARIFICATION) + ".json"
    if manifest_name in paths:
        raise ValueError("Clarification manifest name collides with an original member")
    path = directory / manifest_name
    atomic_json(path, successor, immutable=True)
    return path, proof


def _checked_preview(workspace, preview):
    if preview["problems"]:
        raise ValueError("Resolve original Source Updates problems before this receiving course")
    if any(row.get(field) for row in preview["changes"] for field in (
            "body_changed", "companions_changed", "semantic_metadata_changed",
            "native_reader_layout_changed", "requires_native_rerun")):
        raise ValueError("The proposed clarification changes scientific bytes or computational metadata")
    if not preview["summary"]["lineage_metadata_changed_count"]:
        raise ValueError("This source edition already carries the proposed clarification")
    originals = []
    for row in preview["affected"]["runs"]:
        run = workspace.inspect_run(row["id"])
        if run.get("state") != "complete":
            raise ValueError("Finish or explicitly select another completed case; affected run is " +
                             run["id"] + " / " + str(run.get("state")))
        grid = workspace.get_grid(run["selection"]["grid_id"])
        if (grid["grid"].get("width"), grid["grid"].get("height")) != (120, 120):
            raise ValueError("An affected saved run is outside the original 120 by 120 cell case")
        originals.append({"id": run["id"], "selection": run["selection"],
                          "completed_at": run.get("completed_at"),
                          "model_versions": model_versions(run),
                          "artifacts": run.get("artifacts", {})})
    if not originals:
        raise ValueError("The original collection has no completed native run dependency")
    return originals


def prepare(args):
    workspace = Workspace(Path(args.workspace).resolve(strict=True))
    output = Path(args.output_dir).resolve()
    _outside(output, workspace.root)
    _outside(output, Path(__file__).resolve().parent.parent)
    profile, collection, manifest, recipe = _original(workspace, args.source_collection)
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".headwaters-source-clarification.lock", blocking=False):
        identity = {"schema": "upstate.headwaters-source-clarification/v1",
                    "project_id": workspace.project["id"], "profile_id": profile["id"],
                    "original_source_collection_id": collection["id"],
                    "original_manifest_sha256": collection["original_manifest"]["sha256"],
                    "clarification": CLARIFICATION}
        admission_path = output / "admission.json"
        if admission_path.exists():
            if read_json(admission_path)["identity"] != identity:
                raise ValueError("This output directory belongs to another source clarification")
        else:
            atomic_json(admission_path, {"id": digest(identity), "identity": identity,
                                        "created_at": now()}, immutable=True)
        atomic_json(output / "original-source-collection.json", collection, immutable=True)
        atomic_json(output / "original-profile.json", profile, immutable=True)
        path, inputs = _intake(workspace, collection, manifest, output / "intake")
        atomic_json(output / "retained-inputs.json", inputs, immutable=True)
        with held(workspace.root / ".workspace.lock", blocking=False):
            replacement = workspace.import_sources(path)
            selection = {"from_collection_id": collection["id"],
                         "to_collection_id": replacement["id"],
                         "source_id_map": {row["id"]: row["id"] for row in collection["entries"]},
                         "title": TITLE}
            saved_path = output / "plan.json"
            if saved_path.exists():
                retained_plan = read_json(saved_path)
                plan = source_refresh.get_plan(workspace, retained_plan["id"])
                if plan["selection"] != selection or plan["preview"] != retained_plan["preview"]:
                    raise ValueError("Retained clarification plan changed")
                preview = plan["preview"]
                originals = _checked_preview(workspace, preview)
            else:
                preview = source_refresh.preview(workspace, selection)
                originals = _checked_preview(workspace, preview)
                frozen_path = output / "preview.json"
                if frozen_path.exists() and read_json(frozen_path) != preview:
                    raise ValueError("Original dependency selections advanced; retain this intake and choose a new output")
                atomic_json(frozen_path, preview, immutable=True)
                plan = source_refresh.save_plan(workspace, selection)
                if plan["preview"] != preview:
                    raise ValueError("Original dependency selections advanced while saving the plan")
                atomic_json(saved_path, plan, immutable=True)
        atomic_json(output / "original-completed-runs.json", originals, immutable=True)
        # Original Workspace methods acquire their own write locks.
        # Do not hold .workspace.lock across the maintained plan application.
        state = source_refresh.apply_plan(workspace, plan["id"], run_models=False)
        if state.get("state") not in ("prepared", "complete"):
            raise ValueError("Original source plan preparation did not complete: " + str(state.get("state")))
        report_selection = {"plan_id": plan["id"], "title": TITLE,
                            "rationale": RATIONALE,
                            "notes": ["This is the original simulated-square case. The separate original-geography case and its native runs remain unchanged."]}
        atomic_json(output / "report-selection.json", report_selection, immutable=True)
        try:
            runtime = importlib.metadata.version("natcap.invest")
        except importlib.metadata.PackageNotFoundError:
            runtime = None
        result = {"schema": identity["schema"], "state": "prepared",
                  "project_id": workspace.project["id"], "workspace": str(workspace.root),
                  "original_source_collection_id": collection["id"],
                  "replacement_source_collection_id": replacement["id"], "plan_id": plan["id"],
                  "original_profile_id": profile["id"], "original_run_count": len(originals),
                  "preview_summary": preview["summary"], "run_models_requested": False,
                  "native_state": state["state"], "installed_invest_version": runtime,
                  "report_selection": str(output / "report-selection.json"),
                  "member_count": len(inputs), "member_bytes": sum(row["bytes"] for row in inputs),
                  "next_step": "Open this actual plan in the maintained Source Updates browser course with explicit --run-models --expect-reuse, then report/export/cold reopen.",
                  "prepared_at": now()}
        atomic_json(output / "receiving.json", result)
        if args.complete:
            required_versions = {row["comparison_version"]
                                 for original in originals
                                 for row in original["model_versions"].values()}
            if runtime is None or required_versions != {runtime}:
                raise ValueError("Use the original qualified InVEST runtime for this reuse course; "
                                 "prepared selections remain retained")
            completed = source_refresh.apply_plan(workspace, plan["id"], run_models=True)
            if completed.get("state") != "complete":
                raise ValueError("The maintained source update has incomplete native results")
            receipts = {}
            for original_id, row in completed["run_results"].items():
                models = row.get("model_results") or {}
                if not models or any(value.get("mode") != "reused"
                                     or not value.get("source_run_id")
                                     for value in models.values()):
                    raise ValueError("Inspect the retained native results: this course did not reuse every selected original model stage")
                receipts[original_id] = {key: deepcopy(row.get(key)) for key in (
                    "from_run_id", "to_run_id", "state", "model_results", "artifacts",
                    "completed_at", "reused_model_count", "selected_model_count")}
            if not receipts:
                raise ValueError("The source update has no actual completed run receipts")
            atomic_json(output / "completed-native-receipts.json", receipts, immutable=True)
            continued = source_refresh.apply_plan(workspace, plan["id"], run_models=False)
            actual = {key: {name: deepcopy(row.get(name)) for name in receipts[key]}
                      for key, row in continued["run_results"].items()}
            if actual != receipts:
                raise ValueError("Preparation-only continuation changed actual native provenance")
            from source_tools.receive_source_refresh_report import run as receive_report
            received = receive_report(SimpleNamespace(
                workspace=str(workspace.root), selection=str(output / "report-selection.json"),
                review_selection=None, output_dir=str(output / "report-receiving")))
            result.update(state="complete", native_state=continued["state"],
                          completed_run_count=len(receipts), report_receiving=received,
                          completed_at=now(),
                          next_step="Open and inspect the actual report HTML/PDF and retained files; the authenticated desktop/phone browser course remains separate.")
            atomic_json(output / "receiving.json", result)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--source-collection", help="Optional extra assertion of the original profile's actual source collection")
    parser.add_argument("--complete", action="store_true", help="Explicitly complete original native reuse and report/review/Study receiving after the Workspace writer has finished")
    args = parser.parse_args(argv)
    print(json.dumps(prepare(args), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

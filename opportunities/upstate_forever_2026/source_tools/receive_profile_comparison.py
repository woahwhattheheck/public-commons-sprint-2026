"""Receive original source profiles, a saved comparison and its study handoff.

The original Workspace and experiment_profiles APIs own retained identities.
The source-only path requires Python's standard library and the installed app.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import platform
import socket
import sys

from model.common import (atomic_bytes, atomic_json, digest, file_digest, held,
                          identifier, now, read_json, verify_file)
from model.workspace import Workspace
from model import experiment_profiles
from model.profile_comparison import ProfileComparisons

APPLICATION = Path(__file__).resolve().parents[1]
EXAMPLE = APPLICATION / "source/biophysical-regional-20261012/working-profile-intake.json"
UPPER_FLINT = APPLICATION / "source/upper-flint-2024/profile-combined.json"


def _original(path):
    path = Path(path).resolve(strict=True)
    raw = path.read_bytes()
    value = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError("A retained profile request must be a JSON object.")
    return path, raw, value, {"path": str(path), "bytes": len(raw),
                              "sha256": file_digest(path)}


def _relative(parent, name):
    member = Path(name)
    if member.is_absolute() or not member.parts or ".." in member.parts or "\\" in name:
        raise ValueError("A source-profile intake path must be relative to its selection file.")
    path = (parent / member).resolve(strict=True)
    if not path.is_relative_to(parent.resolve()):
        raise ValueError("A source-profile intake path escapes its selection directory.")
    return path


def receive(workspace, *, baseline_profile_id=None, baseline_spec=None,
            workflow_receipt=None, profile_specs=(), candidate_profile_ids=(),
            grid_id=None, title="Published regional source-profile comparison",
            backup_directory=None):
    """Retain original source choices and emit an immediately readable report."""
    if sum(value is not None for value in
           (baseline_profile_id, baseline_spec, workflow_receipt)) != 1:
        raise ValueError("Choose one existing baseline, source-profile intake spec or original workflow receipt.")
    ws = workspace
    originals = []
    candidates = [identifier(value) for value in candidate_profile_ids]
    specs = []
    for selected in profile_specs:
        path, raw, spec, identity = _original(selected)
        if not isinstance(spec, dict):
            raise ValueError("A source-backed profile specification must be a JSON object.")
        specs.append((path, raw, spec, identity))
        originals.append((path, raw, identity))

    collection = None
    if workflow_receipt is not None:
        path, raw, receipt, identity = _original(workflow_receipt)
        originals.append((path, raw, identity))
        if receipt.get("workspace_id") != ws.project["id"]:
            raise ValueError("The original source-profile receipt belongs to another Workspace.")
        baseline_profile_id = identifier(receipt["baseline_profile_id"])
        candidates.extend(identifier(value) for value in receipt["profile_ids"]
                          if value != baseline_profile_id)
    elif baseline_spec is not None:
        path, raw, intake, identity = _original(baseline_spec)
        originals.append((path, raw, identity))
        if intake.get("schema") != "upstate.profile-intake-spec/v1":
            raise ValueError("The baseline intake specification requires upstate.profile-intake-spec/v1.")
        source_manifest = _relative(path.parent, intake["source_manifest"])
        manifest_path, manifest_raw, _, manifest_identity = _original(source_manifest)
        originals.append((manifest_path, manifest_raw, manifest_identity))
        collection = ws.import_sources(source_manifest)
        entries = [entry for entry in collection["entries"]
                   if entry["id"] == intake["source_id"] and entry["kind"] == "table"]
        if len(entries) != 1:
            raise ValueError("Choose the original retained biophysical table in the imported source edition.")
        entry = entries[0]
        if intake.get("table_sha256") and entry["body"]["sha256"] != intake["table_sha256"]:
            raise ValueError("The received biophysical table differs from the selected baseline source.")
        profile = copy.deepcopy(intake["profile"])
        for name in ("id", "schema", "table_summary"):
            profile.pop(name, None)
        profile.update(source_collection_id=collection["id"],
                       biophysical_source_id=entry["id"])
        source_references = entry.get("references", [])
        references = list(profile.get("references") or [])
        for reference in [entry["uri"], *source_references]:
            if reference not in references:
                references.append(reference)
        profile["references"] = references
        profile["source_intake"] = {
            "schema": intake["schema"], "selection_sha256": identity["sha256"],
            "source_manifest_sha256": manifest_identity["sha256"],
            "attribution": intake.get("attribution"),
        }
        baseline_profile_id = ws.save_profile(profile)["id"]
    else:
        baseline_profile_id = identifier(baseline_profile_id)

    base = ws._get("profiles", baseline_profile_id)
    if grid_id:
        grid_id = identifier(grid_id)
        ws.get_grid(grid_id)
    for value in candidates:
        ws._get("profiles", value)
    if not specs and not candidates:
        raise ValueError("Choose a source profile specification or an existing candidate profile.")

    request = {
        "schema": "upstate.profile-comparison-intake/v1",
        "workspace_id": ws.project["id"], "baseline_profile_id": baseline_profile_id,
        "baseline_table_sha256": base["table_summary"]["sha256"],
        "specification_hashes": [item[3]["sha256"] for item in specs],
        "candidate_profile_ids": sorted(set(candidates)),
        "grid_id": grid_id, "title": str(title).strip(),
        "originals": [{"sha256": item[2]["sha256"], "bytes": item[2]["bytes"]}
                      for item in originals],
    }
    if not request["title"]:
        raise ValueError("Name the original source comparison.")
    key = digest(request)
    directory = ws.root / "profile-comparison-intakes" / key
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "state.json"

    with held(directory / ".receive.lock", blocking=False):
        atomic_json(directory / "selection.json", request, immutable=True)
        state = read_json(path) if path.exists() else {
            "schema": "upstate.profile-comparison-intake-state/v1",
            "id": key, "workspace_id": ws.project["id"], "created_at": now(),
            "comparison_ids": [], "archives": [],
        }
        if state["id"] != key or state["workspace_id"] != ws.project["id"]:
            raise ValueError("The retained source-profile intake belongs to another selection.")
        state.update(state="materializing", updated_at=now(), source_files=[],
                     profile_sets=[], baseline_profile_id=baseline_profile_id,
                     runtime={"hostname": socket.gethostname(), "python": sys.executable,
                              "python_version": platform.python_version(),
                              "application": str(APPLICATION), "workspace": str(ws.root)})
        state.pop("error", None)

        def save(phase=None, **values):
            state.update(values)
            if phase:
                state["state"] = phase
            state["updated_at"] = now()
            atomic_json(path, state)

        save()
        try:
            for index, (original_path, raw, identity) in enumerate(originals):
                name = "original-selections/" + str(index).zfill(3) + "-" + original_path.name
                atomic_bytes(directory / name, raw, immutable=True)
                state["source_files"].append({"path": name, "bytes": identity["bytes"],
                                             "sha256": identity["sha256"],
                                             "original_path": str(original_path)})
            save()
            for _, _, original_spec, identity in specs:
                spec = copy.deepcopy(original_spec)
                original_binding = spec.get("baseline_profile_id")
                if original_binding not in (None, "", "BASELINE_PROFILE_ID", baseline_profile_id):
                    raise ValueError("The source specification is already bound to a different original baseline.")
                spec["baseline_profile_id"] = baseline_profile_id
                proposed = experiment_profiles.preview(ws, spec)
                result = experiment_profiles.materialize(ws, spec)
                if result.get("state") != "complete":
                    raise ValueError("The original source-profile materialization did not complete.")
                candidates.extend(result["profile_ids"])
                state["profile_sets"].append({
                    "id": result["id"], "source_spec_sha256": identity["sha256"],
                    "original_baseline_binding": original_binding,
                    "profile_ids": result["all_profile_ids"],
                    "profile_count": proposed["profile_count"],
                    "state": result["state"],
                })
                save()
            candidates = sorted(set(candidates) - {baseline_profile_id})
            if not candidates:
                raise ValueError("The selected source alternatives are identical to the original baseline.")
            selection = {"title": request["title"], "reference_profile_id": baseline_profile_id,
                         "candidate_profile_ids": candidates, "grid_id": grid_id}
            atomic_json(directory / "comparison-selection.json", selection, immutable=True)
            save("comparing", candidate_profile_ids=candidates)
            manager = ProfileComparisons(ws)
            comparison = manager.create(selection)
            comparison_id = comparison["id"]
            if comparison_id not in state["comparison_ids"]:
                state["comparison_ids"].append(comparison_id)
            save("exporting", comparison_id=comparison_id)
            release = manager.export(comparison_id)
            report_root = ws.root / "profile-comparison-reports" / comparison_id
            for expected in release["files"].values():
                verify_file(report_root, expected)
            study = manager.study_selection(comparison_id, candidates)
            study_path = directory / ("study-selection-" + comparison_id + ".json")
            atomic_json(study_path, study, immutable=True)
            save("reported", report_root=str(report_root),
                 report_html=str(report_root / "index.html"),
                 report_zip=str(report_root / "profile-comparison.zip"),
                 release=release, study_selection_path=str(study_path),
                 study_selection=study, model_scope=study["models"])
            if backup_directory is not None:
                target_root = Path(backup_directory).resolve()
                if target_root == ws.root or target_root.is_relative_to(ws.root):
                    raise ValueError("Choose the original Workspace backup directory outside that Workspace.")
                target_root.mkdir(parents=True, exist_ok=True)
                destination = target_root / ("source-profiles-" + key + "-" + comparison_id + ".zip")
                existing = next((item for item in state["archives"]
                                 if item["path"] == str(destination)), None)
                if destination.exists():
                    if existing is None or destination.stat().st_size != existing["bytes"] or file_digest(destination) != existing["sha256"]:
                        raise FileExistsError("The selected backup path contains a different retained archive.")
                    archive = existing
                else:
                    ws.backup(destination, include_intermediates=False)
                    archive = {"path": str(destination), "bytes": destination.stat().st_size,
                               "sha256": file_digest(destination), "comparison_id": comparison_id}
                    state["archives"].append(archive)
                save(backup=archive)
            save("complete", completed_at=now())
            return state
        except BaseException as exc:
            save("failed" if isinstance(exc, Exception) else "interrupted",
                 error={"type": type(exc).__name__, "message": str(exc)})
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--create", action="store_true", help="Create the selected Workspace if it does not exist.")
    baseline = parser.add_mutually_exclusive_group(required=True)
    baseline.add_argument("--baseline-profile")
    baseline.add_argument("--baseline-spec", type=Path)
    baseline.add_argument("--workflow-receipt", type=Path)
    baseline.add_argument("--working-regional-example", action="store_true",
                          help="Select the retained source owner's visible working parameters and Upper Flint alternative.")
    parser.add_argument("--profile-spec", type=Path, action="append", default=[])
    parser.add_argument("--candidate-profile", action="append", default=[])
    parser.add_argument("--grid")
    parser.add_argument("--title", default="Published regional source-profile comparison")
    parser.add_argument("--backup-directory", type=Path)
    args = parser.parse_args(argv)
    try:
        specs = args.profile_spec
        baseline_spec = args.baseline_spec
        if args.working_regional_example:
            baseline_spec = EXAMPLE
            if not specs and not args.candidate_profile:
                specs = [UPPER_FLINT]
        ws = Workspace(args.workspace, create=args.create,
                       title="Upper Savannah source and model workspace")
        result = receive(ws, baseline_profile_id=args.baseline_profile,
                         baseline_spec=baseline_spec, workflow_receipt=args.workflow_receipt,
                         profile_specs=specs, candidate_profile_ids=args.candidate_profile,
                         grid_id=args.grid, title=args.title, backup_directory=args.backup_directory)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False), flush=True)
        return 0
    except (ValueError, KeyError, OSError, RuntimeError) as exc:
        print(json.dumps({"state": "failed", "type": type(exc).__name__, "message": str(exc),
                          "python": sys.executable, "workspace": str(args.workspace)}), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

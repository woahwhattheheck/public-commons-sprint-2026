"""Find completed native zone reports for the saved ECO13 run population.

This module follows the existing decision-analysis reader. It returns original
report and zone identities for the Economic desk; no physical result is adapted,
recomputed or copied from the ECO13 grid summary.
"""
from __future__ import annotations

from collections import Counter
import hashlib
import json
from pathlib import Path
import re

_ID = re.compile(r"^[0-9a-f]{64}$")
class CatalogueChanged(ValueError):
    """Original report directory population changed between source pages."""


_METRICS = {"nitrogen": "nitrogen_export", "phosphorus": "phosphorus_export",
            "sediment": "sediment_export"}


def _id(value):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError("The retained native identity must be complete.")
    return value


def _within(root, path):
    root = Path(root).resolve()
    path = Path(path).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("The original scenario report must remain in its saved directory.")
    return path


def _native_pairs(comparison):
    pairs = {}
    grid = _id(comparison["grid_id"])
    experiment = _id(comparison["original_experiment_id"])
    for row in comparison.get("rows", []):
        if row.get("case_kind") != "landcover":
            continue
        if row.get("grid_id") != grid or row.get("original_experiment_id") != experiment:
            raise ValueError("A retained outcome belongs to another original grid or experiment.")
        key = (_id(row["original_baseline_run_id"]), _id(row["original_scenario_run_id"]))
        identity = {
            "profile_id": _id(row["case_id"]),
            "scenario_id": _id(row["original_scenario_id"]),
            "grid_id": grid,
        }
        current = pairs.setdefault(key, {**identity, "case_ids": set(), "metrics": set()})
        if any(current[name] != value for name, value in identity.items()):
            raise ValueError("The saved native run pair has conflicting source selections.")
        current["case_ids"].add(_id(row["original_case_id"]))
        current["metrics"].add(row["metric"])
    return pairs


def catalog(workspace, record, comparison, *, offset=0, limit=25, listing_sha256=None):
    """Read one stable ordered page of actual saved S1 report candidates."""
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("Choose a nonnegative offset and 1 to 100 source reports.")
    if comparison.get("plan_sha256") != record["plan_sha256"]:
        raise ValueError("The comparison belongs to another retained report edition.")
    pairs = _native_pairs(comparison)
    root = (Path(workspace.root) / "scenario-decisions").resolve()
    if not root.is_relative_to(Path(workspace.root).resolve()):
        raise ValueError("The scenario report collection leaves the original Workspace.")
    candidates = sorted(
        path for path in root.iterdir()
        if path.is_dir() and not path.is_symlink() and _ID.fullmatch(path.name)
    ) if root.is_dir() else []
    names = [path.name for path in candidates]
    listing_sha256_current = hashlib.sha256(
        json.dumps(names, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    if listing_sha256 is not None and _id(listing_sha256) != listing_sha256_current:
        raise CatalogueChanged("The native report collection changed. Reload its first source page.")
    output = {
        "schema": "upstate.eco13-economic-sources/v1",
        "record_id": record["id"],
        "original_experiment_id": record["original_experiment_id"],
        "source_workspace_id": record["source_workspace_id"],
        "plan_sha256": record["plan_sha256"],
        "grid_id": comparison["grid_id"],
        "offset": offset, "limit": limit,
        "total_report_directories": len(candidates),
        "listing_sha256": listing_sha256_current,
        "scanned": 0, "next_offset": None,
        "adapter_available": True, "reports": [], "issues": [], "skipped": {},
        "interpretation": (
            "These completed zone reports use the same original native run pairs. "
            "Their Economic desk retains its original reporting zones and all-run common valid support. "
            "The selected ECO13 grid-paired summary remains its own physical population."
        ),
    }
    try:
        from model import decision_analysis as decision
    except ImportError:
        output["adapter_available"] = False
        output["availability_message"] = "Install the existing Economic desk companion to open native zone reports."
        return output
    skipped = Counter()
    end = min(len(candidates), offset + limit)
    for directory in candidates[offset:end]:
        output["scanned"] += 1
        try:
            selected = directory / "decision.json"
            if not selected.is_file():
                selected = directory / "report.json"
            selected = _within(directory, selected)
            inspected = decision.inspect_scenario_report(selected)
            if inspected["producer_report_id"] != directory.name:
                raise ValueError("The native report directory and original report identity differ.")
            if inspected.get("project", {}).get("id") != record["source_workspace_id"]:
                skipped["different_source_workspace"] += 1
                continue
            source = inspected["source"]
            source_path = _within(directory, source["path"])
            raw = source_path.read_bytes()
            if len(raw) != source["bytes"] or hashlib.sha256(raw).hexdigest() != _id(source["sha256"]):
                raise ValueError("The original native report changed while its continuation was selected.")
            native = json.loads(raw)
            if native.get("grid_id") != comparison["grid_id"]:
                skipped["different_reporting_grid"] += 1
                continue
            baseline = _id(inspected["baseline_run_id"])
            run_ids = native["selection"]["run_ids"]
            if not run_ids or run_ids[0] != baseline:
                raise ValueError("The original native report changed its selected baseline.")
            if any((baseline, _id(run_id)) not in pairs for run_id in run_ids[1:]):
                skipped["different_native_run_population"] += 1
                continue
            selected_alternatives = inspected["alternatives"]
            if not selected_alternatives:
                skipped["no_compatible_landcover_alternatives"] += 1
                continue
            actual_ids = {item["run_id"] for item in selected_alternatives}
            if len(actual_ids) != len(selected_alternatives) or actual_ids != set(run_ids[1:]):
                skipped["incompatible_original_alternative"] += 1
                continue
            matches = []
            metrics = {_METRICS[name] for name in inspected["pollutants"]}
            for alternative in selected_alternatives:
                pair = pairs[(baseline, alternative["run_id"])]
                if (pair["profile_id"] != alternative["profile_id"]
                        or pair["scenario_id"] != alternative["scenario_id"]):
                    raise ValueError("The original native report and experiment assign different run selections.")
                if not metrics <= pair["metrics"]:
                    raise ValueError("The selected zone report includes a metric outside this saved native pair.")
                matches.append({
                    "run_id": alternative["run_id"], "baseline_run_id": baseline,
                    "scenario_id": alternative["scenario_id"],
                    "profile_id": alternative["profile_id"], "label": alternative["label"],
                    "original_case_ids": sorted(pair["case_ids"]),
                })
            output["reports"].append({
                "report_id": inspected["producer_report_id"],
                "title": inspected["title"],
                "report_sha256": source["sha256"], "report_bytes": source["bytes"],
                "baseline_run_id": baseline, "run_ids": list(run_ids),
                "pollutants": list(inspected["pollutants"]),
                "matched_alternatives": matches,
                "zones": inspected["zones"],
                "ready_zones": sum(bool(zone["common_support_available"])
                                   for zone in inspected["zones"]),
                "open_extension": "economic-desk", "open_method": "openReport",
            })
        except (OSError, ValueError, KeyError, TypeError) as error:
            output["issues"].append({
                "report_id": directory.name, "message": str(error),
                "error_type": type(error).__name__,
            })
    output["reports"].sort(key=lambda item: (item["title"].casefold(), item["report_id"]))
    output["skipped"] = dict(sorted(skipped.items()))
    output["next_offset"] = end if end < len(candidates) else None
    return output

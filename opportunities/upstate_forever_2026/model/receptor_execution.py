"""Bind source-water quantities to their retained producing native stages."""
from __future__ import annotations

from copy import deepcopy
from html import escape
import json

from .common import digest
from .model_selection import common_comparison_outputs, validate_completed_run
from . import native_versions, rasters

SCHEMA = "upstate.receptor-native-execution/v1"
PRODUCT_VERSION = "2"
CSV_FIELDS = (
    "native_model", "native_version", "baseline_version_basis", "alternative_version_basis",
    "baseline_requested_version", "alternative_requested_version",
    "baseline_observed_stage_version", "alternative_observed_stage_version",
    "baseline_observed_run_version", "alternative_observed_run_version",
    "baseline_stage_completed_at", "alternative_stage_completed_at",
    "baseline_reused_from", "alternative_reused_from",
    "baseline_artifact_sha256", "alternative_artifact_sha256",
)


def bind(runs, *, grid_id=None, pollutants=None):
    """Resolve the full selected cohort before checking producing-model versions.

    Original output descriptors are retained here. Their bytes are verified by
    the inventory reader before aggregation; this read-only binding needs no GIS.
    """
    if not runs or len({run["id"] for run in runs}) != len(runs):
        raise ValueError("Select distinct completed source-water native runs")
    grids = {run["selection"]["grid_id"] for run in runs}
    if len(grids) != 1 or (grid_id is not None and grids != {grid_id}):
        raise ValueError("Source-water comparisons require one retained native grid")
    common = common_comparison_outputs(runs)
    if pollutants is None:
        selected = common
    else:
        if (not isinstance(pollutants, (list, tuple)) or not pollutants
                or len(set(pollutants)) != len(pollutants) or set(pollutants) - set(common)):
            raise ValueError("Choose distinct outputs shared by every selected completed run")
        selected = tuple(name for name in common if name in pollutants)
    versions = native_versions.comparison_versions(
        runs, native_versions.models_for_outputs(selected))
    sources = {}
    for run in runs:
        artifacts = {}
        for name in selected:
            item = run["artifacts"][name]
            if item.get("units") != rasters.MASS_UNITS[name]:
                raise ValueError("Source-water " + name + " requires retained " + rasters.MASS_UNITS[name])
            if not item.get("path") or not item.get("sha256") or not isinstance(item.get("bytes"), int):
                raise ValueError("Retain the original native output path, length and SHA-256")
            artifacts[name] = deepcopy(item)
        sources[run["id"]] = {"selection": deepcopy(run["selection"]),
                             "scope": validate_completed_run(run),
                             "artifacts": artifacts}
    return {"schema": SCHEMA, "grid_id": next(iter(grids)), "pollutants": list(selected),
            "native_version_provenance": versions, "runs": sources}


def signature(binding):
    return digest(binding)


def pair_fields(binding, baseline_id, alternative_id, pollutant):
    """Readable CSV columns accompany the complete immutable execution JSON."""
    model = native_versions.models_for_outputs((pollutant,))[0]
    versions = binding["native_version_provenance"]
    result = {"native_model": model, "native_version": versions["versions"][model]}
    for label, key in (("baseline", baseline_id), ("alternative", alternative_id)):
        info = versions["runs"][key][model]
        for output, source in (("version_basis", "basis"), ("requested_version", "requested_version"),
                               ("observed_stage_version", "observed_stage_version"),
                               ("observed_run_version", "observed_run_version"),
                               ("stage_completed_at", "stage_completed_at")):
            result[label + "_" + output] = info.get(source)
        reused = info.get("reused_from")
        result[label + "_reused_from"] = (json.dumps(reused, sort_keys=True, ensure_ascii=False)
                                          if reused is not None else None)
        result[label + "_artifact_sha256"] = binding["runs"][key]["artifacts"][pollutant]["sha256"]
    return result


def report_section(binding):
    if binding is None:
        return ""
    provenance = binding["native_version_provenance"]
    rows = []
    for run_id, versions in provenance["runs"].items():
        selection = binding["runs"][run_id]["selection"]
        for model, info in versions.items():
            reused = info.get("reused_from")
            values = (run_id, selection["profile_id"], model.upper(),
                      native_versions.version_label(info), info.get("stage_completed_at") or "Unavailable",
                      json.dumps(reused, sort_keys=True, ensure_ascii=False) if reused is not None else "Original run")
            rows.append("<tr>" + "".join("<td>" + escape(str(value)) + "</td>" for value in values) + "</tr>")
    return ("<section><h2>Producing native executions</h2><p>Each compared output retains its original run, "
            "parameter profile, model, physical units and SHA-256. Compatibility uses that model's completed "
            "stage runtime first. The table labels observed-run and requested-legacy fallbacks explicitly. "
            "NDR and SDR can retain different versions when each model is consistent across the selected cohort.</p>"
            '<p><a href="native-execution.json">Complete execution and original-output bindings</a></p>'
            "<table><thead><tr><th>Run</th><th>Profile</th><th>Model</th><th>Version and source</th>"
            "<th>Stage completed</th><th>Stage reuse source</th></tr></thead><tbody>"
            + "".join(rows) + "</tbody></table></section>")

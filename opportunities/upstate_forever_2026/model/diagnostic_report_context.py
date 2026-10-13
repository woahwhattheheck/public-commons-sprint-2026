"""Publish a saved Scientific interpretation as an original report source.

TokenJunkieLabs. Copies the exact committed diagnostic revision and its original
exports, then uses the maintained ordered observed-report delivery contract.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile

from . import experiment_diagnostics as diagnostics, observed_context
from .common import (
    atomic_json, describe_file, digest, file_digest, held, identifier,
    read_json, verify_file,
)

SCHEMA = "upstate.diagnostic-report-context/v1"
VERSION = "1"
RECIPE = "diagnostic-report.json"
MANIFEST = "diagnostic-report.sources.json"


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Diagnostic report members need canonical relative paths")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts or path.as_posix() != value:
        raise ValueError("Diagnostic report members must stay inside their retained revision")
    return path


def _copy(source, target, descriptor):
    target.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".report-member-", delete=False) as receiving:
            pending = Path(receiving.name)
            with source.open("rb") as original:
                shutil.copyfileobj(original, receiving, 1024 * 1024)
            receiving.flush()
            os.fsync(receiving.fileno())
        if pending.stat().st_size != descriptor["bytes"] or file_digest(pending) != descriptor["sha256"]:
            raise ValueError("Original diagnostic member changed during report capture")
        os.replace(pending, target)
        pending = None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _verify_capture(workspace, directory, diagnostic_id, report_sha256):
    capture = read_json(directory / "capture.json")
    if (capture.get("schema") != SCHEMA + "/capture"
            or capture.get("project_id") != workspace.project["id"]
            or capture.get("diagnostic_id") != diagnostic_id
            or capture.get("report_sha256") != report_sha256):
        raise ValueError("Retained diagnostic report capture belongs to another original revision")
    members = capture.get("members", [])
    names = [row["path"] for row in members]
    if len(names) != len(set(names)):
        raise ValueError("A retained diagnostic capture repeats a source member")
    for row in members:
        _relative(row["path"])
        verify_file(directory, row)
    report_member = next((row for row in members if row["path"] == "retained/report.json"), None)
    if report_member is None or report_member["sha256"] != report_sha256:
        raise ValueError("Retained diagnostic capture has a different report revision")
    report = read_json(verify_file(directory, report_member))
    if report.get("schema") != diagnostics.SCHEMA or report.get("id") != diagnostic_id:
        raise ValueError("Choose the original saved scientific report")
    if capture.get("source_stamp") != report.get("source_stamp"):
        raise ValueError("Retained report source stamp differs from its capture")
    by_path = {row["path"]: row for row in members}
    origin = PurePosixPath("experiment-diagnostics") / diagnostic_id
    for key, item in report.get("artifacts", {}).items():
        try:
            relative = _relative(item["path"]).relative_to(origin)
        except (KeyError, ValueError) as error:
            raise ValueError("Original report export has a different diagnostic root") from error
        copied = by_path.get((PurePosixPath("retained") / relative).as_posix())
        if (copied is None or copied["sha256"] != item["sha256"]
                or copied["bytes"] != item["bytes"]):
            raise ValueError("Retained report capture lost an original export: " + key)
    return capture, report


def _capture(workspace, diagnostic_id, report_sha256, directory):
    if directory.exists():
        return _verify_capture(workspace, directory, diagnostic_id, report_sha256)
    original = workspace.root / "experiment-diagnostics" / diagnostic_id
    if not (original / "manifest.json").is_file():
        raise ValueError("Select a retained scientific analysis in this Workspace")
    # The native writer holds this same lock while replacing a partial report.
    with held(original / ".diagnostics.lock", blocking=False):
        current = diagnostics.inspect(workspace, diagnostic_id)
        descriptor = current.get("artifacts", {}).get("report_json")
        if not descriptor or descriptor.get("sha256") != report_sha256:
            raise ValueError("The saved scientific report changed. Reopen its current revision before preparing a report.")
        path = verify_file(workspace.root, descriptor)
        report = read_json(path)
        if report.get("schema") != diagnostics.SCHEMA or report.get("id") != diagnostic_id:
            raise ValueError("The committed diagnostic report identity differs")
        artifacts = dict(report.get("artifacts", {}))
        artifacts["report_json"] = descriptor
        archive = current.get("artifacts", {}).get("analysis_zip")
        if archive:
            artifacts["analysis_zip"] = archive
        indexed = {}
        for key, item in sorted(artifacts.items()):
            if not isinstance(item, dict) or "path" not in item:
                raise ValueError("A diagnostic export has no original descriptor: " + key)
            source = verify_file(workspace.root, item)
            try:
                name = source.resolve().relative_to(original.resolve()).as_posix()
            except ValueError as error:
                raise ValueError("Diagnostic export is outside its original analysis directory") from error
            _relative(name)
            if name in ("state.json", "capture.json") or any(part.startswith(".") for part in PurePosixPath(name).parts):
                raise ValueError("Diagnostic report source must name a committed export")
            if name in indexed:
                previous = indexed[name][1]
                if previous["sha256"] != item["sha256"] or previous["bytes"] != item["bytes"]:
                    raise ValueError("Diagnostic descriptors disagree on a retained member")
                indexed[name][2].append(key)
            else:
                indexed[name] = (source, item, [key])
        directory.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".diagnostic-report-", dir=directory.parent) as temporary:
            pending = Path(temporary) / "capture"
            pending.mkdir()
            members = []
            for name, (source, item, keys) in sorted(indexed.items()):
                target = pending / "retained" / _relative(name)
                _copy(source, target, item)
                members.append(describe_file(pending, target, artifact_keys=keys,
                    original_path=item["path"]))
            capture = {
                "schema": SCHEMA + "/capture", "project_id": workspace.project["id"],
                "diagnostic_id": diagnostic_id, "report_sha256": report_sha256,
                "generated_at": report.get("generated_at"), "source_stamp": report["source_stamp"],
                "members": members,
            }
            atomic_json(pending / "capture.json", capture, immutable=True)
            # Only a complete independently readable capture becomes visible.
            os.rename(pending, directory)
    return _verify_capture(workspace, directory, diagnostic_id, report_sha256)


def _text(value):
    if value is None:
        return "Unavailable"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False)
    return str(value)


def _table(columns, rows):
    return {"kind": "table", "columns": columns,
            "rows": [[_text(value) for value in row] for row in rows]}


def _sections(report, report_sha256):
    selection = report["selection"]
    profiles = {row["profile_id"]: row.get("title") or row["profile_id"] for row in report.get("profiles", [])}
    scenarios = report.get("scenario_titles", {})
    group_ids = sorted({row.get("structural_group_id") for row in report.get("profiles", [])
                        if row.get("structural_group_id")})
    groups = {key: "Group " + str(index + 1) for index, key in enumerate(group_ids)}
    profile = lambda key: profiles.get(key, key or "Unavailable")
    scenario = lambda key: scenarios.get(key, key or "Unavailable")
    group = lambda key: groups.get(key, key or "Unavailable")
    coverage = report.get("coverage", {})
    sections = [
        ["Scientific interpretation: selected revision", [
            selection.get("purpose") or "Interpretation of the explicitly selected original scientific run cohort.",
            "Results state: " + str(report.get("results_state", report.get("state"))) +
            ". Analysis " + report["id"] + "; exact report SHA-256 " + report_sha256 + ".",
            "Working scientific diagnostics retain the selected design, missing members, native model scopes "
            "and original observation membership. Results are descriptive comparisons of these retained cases.",
            _table(["Selection", "Original value"], [
                ["Title", selection.get("title")], ["Generated", report.get("generated_at")],
                ["Grid", selection.get("grid_id")],
                ["Baseline", scenario(selection.get("baseline_scenario_id"))],
                ["Reference profile", profile(selection.get("reference_profile_id"))],
                ["Design", selection.get("design")], ["Experiment programme", selection.get("campaign_id")],
                ["Completed / expected runs", str(coverage.get("complete_runs")) + " / " + str(coverage.get("expected_runs"))],
                ["Completed / expected profiles", str(coverage.get("complete_profiles")) + " / " + str(coverage.get("expected_profiles"))],
                ["Selected native models", coverage.get("selected_models")],
                ["Missing / failed / unfinished runs", [coverage.get("missing_runs"), coverage.get("failed_runs"), coverage.get("unfinished_runs")]],
            ]),
        ]],
        ["Original parameter profiles and structural groups", [
            "The profile register identifies the actual model scopes, routing algorithms and periods. "
            "Group labels below are local report labels; their exact original identifiers, parameter values "
            "and biophysical table hashes remain in the retained report JSON.",
            _table(["Profile", "Reference", "Group", "NDR routing", "SDR routing", "Model period", "Models"], [
                [profile(row.get("profile_id")), row.get("is_reference"), group(row.get("structural_group_id")),
                 (row.get("structural_factors") or {}).get("ndr_flow_dir_algorithm"),
                 (row.get("structural_factors") or {}).get("sdr_flow_dir_algorithm"),
                 (row.get("structural_factors") or {}).get("model_period"), row.get("models")]
                for row in report.get("profiles", [])
            ]),
            _table(["Profile", "Parameter", "Retained value"], [
                [profile(row.get("profile_id")), key, value]
                for row in report.get("profiles", [])
                for key, value in sorted(row.get("parameter_values", {}).items())
            ]),
        ]],
        ["Shared spatial support and annual mass", [
            "Each metric uses the intersection of finite valid cells across its exact completed source-run roster. "
            "The retained support mask, raster descriptors and original roster define the comparison footprint. "
            "A zero-cell or unavailable support yields unavailable mass; it does not mean zero export.",
            "Annual nitrogen and phosphorus masses are kg/year; sediment mass is metric tonnes/year (t/year). "
            "Native per-hectare rates were converted by the original model adapter before these sums. "
            "Explicitly unselected model families remain separate from missing selected outputs.",
            _table(["Metric", "Support state", "Common cells", "Grid cells", "Selected runs", "Inactive runs"], [
                [row.get("metric"), row.get("state"), row.get("valid_cells"), row.get("grid_cells"),
                 row.get("selected_run_count", len(row.get("run_ids", []))),
                 row.get("model_not_selected_run_count", len(row.get("model_not_selected_run_ids", [])))]
                for row in report.get("common_support", [])
            ]),
        ]],
        ["Matched scenario effects and parameter interactions", [
            "The canonical scenario response is alternative minus baseline within the same parameter profile. "
            "A negative value is a reduction. A positive reduction in a Decision or delivery table uses the opposite sign. "
            "Profile effect compares the same landscape with the reference profile; interaction compares paired "
            "landscape responses between the chosen profile and the reference.",
            _table(["Metric / units", "Profile", "Scenario", "Paired response", "Profile effect", "Interaction", "Pair complete"], [
                [str(row.get("metric")) + " / " + str(row.get("units")), profile(row.get("profile_id")),
                 scenario(row.get("scenario_id")), row.get("scenario_delta"), row.get("profile_effect"),
                 row.get("scenario_parameter_interaction"), row.get("paired_complete")]
                for row in report.get("parameter_effects", [])
            ]),
        ]],
        ["Sampled scenario-response envelopes", [
            "Minimum, median and maximum summarize distinct scientific parameter configurations in each retained "
            "structural group. They are design spread, not confidence intervals or probabilities. Equivalent "
            "parameter aliases do not receive extra weight. Routing algorithms, model periods and native model "
            "scopes remain explicit structural factors.",
            _table(["Metric / units", "Scenario", "Structural group", "Complete / expected", "Minimum", "Median", "Maximum", "Coverage"], [
                [str(row.get("metric")) + " / " + str(row.get("units")), scenario(row.get("scenario_id")),
                 group(row.get("structural_group_id")), str(row.get("delta_n_complete")) + " / " + str(row.get("delta_n_expected")),
                 row.get("delta_minimum"), row.get("delta_median"), row.get("delta_maximum"), row.get("coverage_state")]
                for row in report.get("scenario_summaries", [])
            ]),
        ]],
        ["Ranking stability across the chosen design", [
            "Lower paired export response ranks first within the fixed candidate scenario universe. Only profiles "
            "with every required candidate pair contribute. Ties receive average ranks; top-k inclusion divides "
            "a boundary tie fractionally. The recorded fraction is frequency within the selected design.",
            _table(["Metric", "Scenario", "Structural group", "Eligible / expected", "Rank min / median / max",
                    "Top-k", "Top-k design fraction", "Complete ranking"], [
                [row.get("metric"), scenario(row.get("scenario_id")), group(row.get("structural_group_id")),
                 str(row.get("rank_n_complete")) + " / " + str(row.get("rank_n_expected")),
                 [row.get("rank_minimum"), row.get("rank_median"), row.get("rank_maximum")],
                 row.get("top_k"), row.get("top_k_design_fraction"), row.get("ranking_complete")]
                for row in report.get("rank_stability", [])
            ]),
        ]],
        ["Original observation cohort coverage", [
            "The expected observation roster comes from the admitted original source rows, including observations "
            "omitted by every model comparison. Full-cohort scores require every expected applicable profile and "
            "observation. Shared-cohort scores use the separately retained common subset. Explicitly inactive "
            "model families do not become missing-profile failures.",
            _table(["Source / request", "Parameter / units", "Common / expected", "Coverage", "Omitted observations",
                    "Missing profiles", "Inactive profiles"], [
                [str(row.get("observation_source_id")) + " / " + str(row.get("request_id")),
                 str(row.get("parameter")) + " / " + str(row.get("units")),
                 str(row.get("n_common_observations")) + " / " + str(row.get("n_expected_observations")),
                 row.get("coverage_state"), row.get("omitted_observation_ids"), row.get("missing_profile_ids"),
                 row.get("model_not_selected_profile_ids")]
                for row in report.get("observation_cohort_coverage", [])
            ]),
        ]],
    ]
    scores = report.get("observation_diagnostics", {}).get("scores", [])
    for key, heading, explanation in (
        ("full_expected_cohort_score", "Fit on the complete expected observation cohort",
         "Unavailable full-cohort values mean the expected cohort is incomplete or the metric is undefined. "
         "They are not silently replaced by a smaller observation subset."),
        ("common_cohort_score", "Fit on the explicitly shared observation subset",
         "These values use the exact shared-cohort hash in the original exports. Compare them only with "
         "profiles using that same source and shared subset; they do not certify full-cohort coverage."),
    ):
        sections.append([heading, [
            explanation,
            _table(["Request", "Profile", "Parameter / units", "Rows", "Mean bias", "RMSE", "NSE", "Undefined reasons"], [
                [row.get("request_id"), profile(row.get("profile_id")),
                 str(row.get("parameter")) + " / " + str(row.get("units")),
                 (row.get(key) or {}).get("n"), (row.get(key) or {}).get("mean_bias"),
                 (row.get(key) or {}).get("rmse"), (row.get(key) or {}).get("nash_sutcliffe_efficiency"),
                 (row.get(key) or {}).get("undefined_reasons")]
                for row in scores
            ]),
        ]])
    sections += [
        ["Original run matrix", [
            _table(["Profile", "Scenario", "Native models", "State", "Original run"], [
                [profile(row.get("profile_id")), scenario(row.get("scenario_id")),
                 row.get("models"), row.get("state"), row.get("run_id")]
                for row in report.get("run_matrix", [])
            ]),
        ]],
        ["Recorded scientific issues and provenance", [
            "Every original numerical export, source wrapper and common-support mask accompanies this report. "
            "The source-stamped HTML and CSV files retain full precision and all diagnostic fields.",
            _table(["Stage", "Metric / profile", "Original issue"], [
                [row.get("stage"), str(row.get("metric") or row.get("profile_id") or ""),
                 row.get("message", row)]
                for row in report.get("errors", [])
            ]),
            _table(["Provenance", "Original value"], [
                ["Diagnostic source stamp", report.get("source_stamp")],
                ["Original interpretation", report.get("interpretation")],
            ]),
        ]],
    ]
    return sections


def delivery_selection(workspace, source, delivery_id=None):
    selection = {}
    if delivery_id:
        original = workspace.retained_item("deliveries", identifier(delivery_id))
        selection = copy.deepcopy(original["selection"])
    choices = observed_context.source_choices(selection)
    if source not in choices:
        choices.append(source)
    selection["observed_context_sources"] = choices
    selection.setdefault("source_roles", {})[observed_context.ROLE] = choices[0]
    selection.pop("observed_context_binding", None)
    return selection


def prepare(workspace, diagnostic_id, *, report_sha256, delivery_id=None, import_source=True):
    """Freeze an explicit committed revision and register its full report source."""
    diagnostic_id, report_sha256 = identifier(diagnostic_id), identifier(report_sha256)
    capture_directory = workspace.root / "diagnostic-report-context" / diagnostic_id / report_sha256
    lock = workspace.root / "locks" / ("diagnostic-report-" + digest({
        "diagnostic_id": diagnostic_id, "report_sha256": report_sha256}) + ".lock")
    with held(lock):
        capture, report = _capture(workspace, diagnostic_id, report_sha256, capture_directory)
        identity = {
            "schema": SCHEMA, "version": VERSION, "project_id": workspace.project["id"],
            "diagnostic_id": diagnostic_id, "report_sha256": report_sha256,
            "producer_sha256": file_digest(Path(__file__)),
            "report_loader_edition": observed_context.EDITION,
            "capture_sha256": file_digest(capture_directory / "capture.json"),
        }
        operation_id = digest(identity)
        directory = capture_directory / "reports" / operation_id
        directory.mkdir(parents=True, exist_ok=True)
        # Source companions need a common directory with the recipe. Copies stay
        # independent of the mutable original diagnostic export location.
        for item in capture["members"]:
            target = directory / _relative(item["path"])
            if target.exists():
                verify_file(directory, item)
            else:
                _copy(verify_file(capture_directory, item), target, item)
        inputs = [describe_file(directory, directory / _relative(item["path"]),
                                artifact_keys=item.get("artifact_keys", []))
                  for item in capture["members"]]
        title = (report.get("selection", {}).get("title") or "Scientific interpretation") + " — saved diagnostic report"
        recipe = {
            "schema": observed_context.SCHEMA, "title": title,
            "edition": "scientific-diagnostics-" + VERSION,
            "report_context_kind": "experiment_diagnostics",
            "project_id": workspace.project["id"], "diagnostic_id": diagnostic_id,
            "report_sha256": report_sha256, "results_state": report.get("results_state", report.get("state")),
            "original_selection": report["selection"], "source_stamp": report["source_stamp"],
            "inputs": inputs, "sections": _sections(report, report_sha256),
            "source_links": [row["path"] for row in inputs], "figures": [],
        }
        atomic_json(directory / RECIPE, recipe, immutable=True)
        source_id = "scientific-diagnostic-report-" + operation_id[:20]
        manifest = {
            "schema": "upstate.sources/v1", "title": title, "captured_at": report["generated_at"],
            "scope": {"project_id": workspace.project["id"], "diagnostic_id": diagnostic_id,
                      "report_sha256": report_sha256, "results_state": recipe["results_state"]},
            "entries": [{
                "id": source_id, "kind": "document", "title": title,
                "role": "scientific-diagnostic-report-context", "path": RECIPE,
                "uri": "workspace://" + workspace.project["id"] + "/experiment-diagnostics/" +
                       diagnostic_id + "/reports/" + report_sha256,
                "vintage": report["generated_at"], "sha256": file_digest(directory / RECIPE),
                "metadata": {"report_schema": observed_context.SCHEMA,
                             "report_context_kind": "experiment_diagnostics",
                             "diagnostic_id": diagnostic_id, "report_sha256": report_sha256},
                "companions": inputs,
            }],
        }
        atomic_json(directory / MANIFEST, manifest, immutable=True)
        result = {
            "schema": SCHEMA, "id": operation_id, "title": title,
            "project_id": workspace.project["id"], "diagnostic_id": diagnostic_id,
            "report_sha256": report_sha256, "results_state": recipe["results_state"],
            "member_count": len(inputs) + 1, "source_id": source_id,
            "files": [describe_file(workspace.root, directory / name) for name in (MANIFEST, RECIPE)] +
                     [describe_file(workspace.root, directory / item["path"]) for item in inputs
                      if item["path"] in ("retained/report.html", "retained/diagnostics_bundle.zip")],
        }
        if import_source:
            collection = workspace.import_sources(directory / MANIFEST)
            source = {"source_collection_id": collection["id"], "source_id": source_id}
            binding = observed_context.bind(workspace, {"observed_context_sources": [source]})
            result.update(source=source, observed_context_binding=binding)
            atomic_json(directory / "registered-context.json", result, immutable=True)
            result["delivery_selection"] = delivery_selection(workspace, source, delivery_id)
            result["selected_delivery_id"] = delivery_id
        return result


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--diagnostic-id", required=True)
    parser.add_argument("--report-sha256", required=True)
    parser.add_argument("--delivery-id")
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args(argv)
    if args.prepare_only and args.delivery_id:
        parser.error("--delivery-id requires native source import")
    result = prepare(Workspace(args.workspace), args.diagnostic_id,
                     report_sha256=args.report_sha256, delivery_id=args.delivery_id,
                     import_source=not args.prepare_only)
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()

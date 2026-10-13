"""Bind a completed original Decision to one explicitly selected native map profile.

TokenJunkieLabs. The original OPT12 selection and report implementations remain
authoritative. This module reads saved calculations, verifies local native pairs,
and retains their complete decision context in the original delivery pipeline.
"""
from __future__ import annotations

from contextlib import closing
from copy import deepcopy
import json
import math
from pathlib import Path
import re
import sqlite3

from model.common import (atomic_bytes, canonical, describe_file, digest,
                          identifier, read_json, verify_file)
from model.model_selection import require_complete_delivery
from model.native_versions import native_version, comparison_versions
from model.reuse import copy_verified
from .engine import canonical_hash
from .integration import selection_packet
from .reports import html_report, csv_report
from .schema import Study

SCHEMA = "upstate.decision-delivery/v1"
SOURCE_CONTRACTS = {"ES-EXP-2319/landcover-metrics", "ES26/diagnostic-common-support/v1"}
POLLUTANTS = ("nitrogen_export", "phosphorus_export", "sediment_export")
PIN_FIELDS = ("study_id", "revision", "study_sha256", "run_id", "result_sha256",
              "profile_id", "candidate_id", "point_index",
              "selected_study_sha256", "selected_result_sha256")
INTERPRETATION = {
    "maps": "The maps show one explicitly selected parameter profile and its original baseline and whole land-cover package.",
    "profiles": "The decision retains every supplied profile. The mapped profile is a display choice; it does not replace the across-profile objective, constraints, or outcomes.",
    "sign": "Positive decision gain means baseline minus alternative annual export. Signed future-service maps retain their original alternative-minus-baseline convention.",
    "support": "Decision outcomes retain the saved paired common support. Delivery maps retain their own native map support; their totals may differ and are not substituted into the decision.",
    "weights": "Decision weights, scales, costs, probabilities, and budgets are the saved assumptions. Atlas priority settings remain separate display and planning choices.",
}


def _id(value, prefix):
    if not isinstance(value, str) or not re.fullmatch(prefix + r"_[0-9a-f]{32}", value):
        raise ValueError("Choose an original Decision " + prefix + " ID")
    return value


def _json(value):
    def invalid(text):
        raise ValueError("Nonfinite retained JSON number: " + text)
    return json.loads(value, parse_constant=invalid)


def _database(workspace):
    path = workspace.root / "robust_decisions" / "robust_decisions.sqlite3"
    if not path.is_file() or path.is_symlink():
        raise ValueError("Restore the original saved Decision database in this workspace")
    path.resolve().relative_to(workspace.root.resolve())
    return path


def _load(workspace, study_id, run_id, *, project=False):
    """Read a single SQLite snapshot without Store construction or migration."""
    _id(study_id, "study"); _id(run_id, "run")
    path = _database(workspace)
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        db.execute("BEGIN")
        study_row = db.execute("SELECT * FROM studies WHERE id=?", (study_id,)).fetchone()
        run_row = db.execute("SELECT * FROM runs WHERE study_id=? AND id=?", (study_id, run_id)).fetchone()
        if study_row is None or run_row is None:
            raise ValueError("Reopen the original saved study and calculation in this workspace")
        run = dict(run_row)
        if run["status"] != "completed" or not run.get("result"):
            raise ValueError("Choose a completed original Decision calculation with retained results")
        revision = db.execute("SELECT * FROM revisions WHERE study_id=? AND revision=?",
                              (study_id, run["revision"])).fetchone()
        if revision is None:
            raise ValueError("The completed calculation lost its original study revision")
        study = _json(revision["input"])
        normalized = Study.model_validate(study).model_dump()
        if canonical_hash(study) != revision["sha256"] or canonical_hash(normalized) != revision["sha256"]:
            raise ValueError("The retained Decision study revision differs from its original identity")
        answer = _json(run["result"])
        if answer.get("study_sha256") != revision["sha256"]:
            raise ValueError("The saved calculation belongs to different Decision inputs")
        run["result"] = answer
        value = {"study_id": study_id, "run_id": run_id, "revision": run["revision"],
                 "study_sha256": revision["sha256"], "result_sha256": canonical_hash(answer),
                 "study": normalized, "answer": answer, "run": run}
        if project:
            revisions = []
            for row in db.execute("SELECT * FROM revisions WHERE study_id=? ORDER BY revision", (study_id,)):
                item = dict(row); item["input"] = _json(item["input"]); revisions.append(item)
            runs = []
            for row in db.execute("SELECT * FROM runs WHERE study_id=? ORDER BY created", (study_id,)):
                item = dict(row); item["result"] = _json(item["result"]) if item["result"] else None; runs.append(item)
            imported = db.execute("SELECT provenance FROM imports WHERE study_id=?", (study_id,)).fetchone()
            payload = {"study": dict(study_row), "revisions": revisions, "runs": runs,
                       "import_provenance": _json(imported["provenance"]) if imported else None}
            value["project"] = {"schema_version": "ecosci.robust-project/1",
                                "sha256": canonical_hash(payload), "payload": payload}
    return value


def _issue(code, message):
    return {"code": code, "message": str(message)}


def _point(value, point_index):
    study, answer = value["study"], value["answer"]
    schema = answer.get("schema_version")
    if schema == "ecosci.robust-result/1":
        if point_index is not None:
            raise ValueError("This saved calculation is a single decision, not a frontier")
        return study, answer
    if schema != "ecosci.robust-frontier/1":
        raise ValueError("Choose an original Decision result or budget frontier")
    points = answer.get("points")
    if not isinstance(points, list):
        raise ValueError("The original budget frontier lacks its retained points")
    if type(point_index) is not int or point_index < 0 or point_index >= len(points):
        raise ValueError("Choose one explicit retained budget-frontier point")
    point = points[point_index]
    if not isinstance(point, dict) or point.get("schema_version") != "ecosci.robust-result/1":
        raise ValueError("This frontier point has no completed decision result")
    budget = point.get("budget")
    if isinstance(budget, bool) or not isinstance(budget, (int, float)) or not math.isfinite(budget) or budget < 0:
        raise ValueError("The selected frontier point has an invalid original budget")
    selected_study = deepcopy(study); selected_study["budget"] = budget
    selected_study = Study.model_validate(selected_study).model_dump()
    if canonical_hash(selected_study) != point.get("study_sha256"):
        raise ValueError("The frontier point does not match its original budget-adjusted study")
    return selected_study, point


def _selection(study, answer):
    if study.get("mode") != "native_packages":
        raise ValueError("Choose a saved whole native package for the native map release")
    packet = selection_packet(study, answer)
    if len(packet.get("selected_ids", [])) != 1:
        raise ValueError("A native map release requires exactly one result-selected whole package")
    if study.get("source", {}).get("pair_contract") not in SOURCE_CONTRACTS:
        raise ValueError("Choose a Decision received from original native experiment or diagnostic outcomes")
    return packet




def _verify_source(workspace, study):
    """Verify shared source provenance once for the whole profile catalogue."""
    source = study.get("source") or {}
    if source.get("workspace_id") not in (None, workspace.project["id"]):
        raise ValueError("Restore this Decision's original scientific project before making its native maps")
    if source.get("pair_contract") == "ES26/diagnostic-common-support/v1":
        from .diagnostics import verify_binding
        diagnostic = verify_binding(workspace, source)
        if not diagnostic or diagnostic.get("state") != "local":
            raise ValueError("Restore the exact local diagnostic report revision before making its native maps")


def _pair(workspace, study, packet, profile_id, *, verify=False):
    source = study.get("source") or {}
    candidate_id = packet["selected_ids"][0]
    cells = [row for row in packet["selected_original_cells"]
             if row["profile_id"] == profile_id and row["candidate_id"] == candidate_id]
    if len(cells) != 1:
        raise ValueError("The mapped profile lacks its exact selected original outcome cell")
    cell = cells[0]; original = cell.get("source") or {}
    baseline_id = identifier(original.get("baseline_run_id"))
    alternative_id = identifier(original.get("alternative_run_id"))
    grid_id = identifier(original.get("grid_id"))
    identifier(profile_id); identifier(candidate_id)
    if baseline_id == alternative_id or original.get("scenario_id") != candidate_id:
        raise ValueError("The original outcome cell has conflicting native scenario identities")
    if source.get("grid_id") != grid_id:
        raise ValueError("The selected native cell differs from the retained Decision grid")
    profile = workspace._get("profiles", profile_id)
    grid = workspace.get_grid(grid_id)
    if profile.get("id") != profile_id or grid.get("id") != grid_id:
        raise ValueError("Restore the selected native profile and grid")
    runs, native_runs = [], []
    for role, run_id in (("baseline", baseline_id), ("alternative", alternative_id)):
        run = workspace.inspect_run(run_id)
        if run.get("id") != run_id or run.get("state") != "complete":
            raise ValueError("Complete the original " + role + " run retained by this Decision")
        require_complete_delivery(run)
        chosen = run["selection"]
        if digest(chosen) != run_id or chosen["grid_id"] != grid_id or chosen["profile_id"] != profile_id:
            raise ValueError("The original native run differs from the selected grid/profile")
        scenario = workspace._get("scenarios", chosen["scenario_id"])
        if role == "baseline" and scenario.get("kind") != "baseline":
            raise ValueError("The retained reference is not an original baseline scenario")
        if role == "alternative" and (scenario.get("kind") != "landcover" or chosen["scenario_id"] != candidate_id):
            raise ValueError("The selected package is not its original land-cover alternative")
        artifacts = {}
        for name in POLLUTANTS:
            artifact = run.get("artifacts", {}).get(name)
            if not isinstance(artifact, dict):
                raise ValueError("The original " + role + " run lacks " + name)
            identifier(artifact.get("sha256"))
            if type(artifact.get("bytes")) is not int or artifact["bytes"] < 1:
                raise ValueError("Retain the original complete native raster descriptors")
            if verify:
                verify_file(workspace.root / "runs" / run_id, artifact)
            artifacts[name] = deepcopy(artifact)
        native_runs.append(run)
        runs.append({"id": run_id, "role": role, "selection": deepcopy(chosen),
                     "native_version": native_version(run), "artifacts": artifacts})
    producing_versions = comparison_versions(native_runs, ("ndr", "sdr"))
    for row in runs:
        row["model_versions"] = deepcopy(producing_versions["runs"][row["id"]])
    native_selection = (original.get("native_case") or {}).get("selection")
    if native_selection is not None and digest(native_selection) != alternative_id:
        raise ValueError("The saved Decision cell differs from its original native case selection")
    for metric in study["metrics"]:
        name = metric["id"]
        if name not in POLLUTANTS:
            raise ValueError("The saved Decision metric has no original native export map")
        allowed_units = ("t/year", "metric_tonnes/year") if name == "sediment_export" else ("kg/year",)
        if metric["units"] not in allowed_units:
            raise ValueError("Retain the native annual-mass units before attaching Decision outcomes")
        mass = (original.get("metrics") or {}).get(name)
        support = (source.get("support_by_metric") or {}).get(name)
        if not isinstance(mass, dict) or not isinstance(support, dict) or mass.get("units") != metric["units"]:
            raise ValueError("Restore the selected cell's original physical units and common support")
        identifier(mass.get("support_sha256"))
        count, coverage = mass.get("paired_cells"), mass.get("coverage_fraction")
        if type(count) is not int or count <= 0 or isinstance(coverage, bool) or not isinstance(coverage, (int, float)) or not math.isfinite(coverage) or not 0 < coverage <= 1:
            raise ValueError("The retained native metric lacks positive common-support coverage")
        for field in ("baseline_total", "alternative_total", "reduction"):
            item = mass.get(field)
            if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item):
                raise ValueError("The retained native metric has a nonfinite physical value")
        if mass["baseline_total"] < 0 or mass["alternative_total"] < 0:
            raise ValueError("The retained native export mass is negative")
        if not math.isclose(mass["baseline_total"] - mass["alternative_total"], mass["reduction"], rel_tol=1e-8, abs_tol=1e-8):
            raise ValueError("The retained native reduction has a conflicting sign")
        if not math.isclose(cell["gains"][name], mass["reduction"], rel_tol=1e-8, abs_tol=1e-8):
            raise ValueError("This Decision changed the native physical gains; map a revision retaining the original outcome cells")
        if any(mass.get(field) != support.get(other) for field, other in
               (("support_sha256", "sha256"), ("paired_cells", "paired_cells"), ("coverage_fraction", "coverage_fraction"))):
            raise ValueError("The selected cell differs from the saved across-profile comparison support")
        for role, key, run in (("baseline", "source_baseline_artifact_sha256", runs[0]),
                               ("alternative", "source_alternative_artifact_sha256", runs[1])):
            expected = mass.get(key)
            if expected is not None and (name not in run["artifacts"] or run["artifacts"][name]["sha256"] != expected):
                raise ValueError("Restore the original " + role + " raster edition retained by the diagnostic")
    return {"profile_id": profile_id, "profile_title": profile.get("title") or profile_id,
            "candidate_id": candidate_id, "grid_id": grid_id,
            "baseline_run_id": baseline_id, "alternative_run_id": alternative_id,
            "runs": runs, "native_versions": producing_versions, "selected_cell": deepcopy(cell)}


def _pin(value, study, answer, packet, profile_id, point_index):
    return {name: item for name, item in {
        "study_id": value["study_id"], "revision": value["revision"],
        "study_sha256": value["study_sha256"], "run_id": value["run_id"],
        "result_sha256": value["result_sha256"], "profile_id": profile_id,
        "candidate_id": packet["selected_ids"][0], "point_index": point_index,
        "selected_study_sha256": canonical_hash(study),
        "selected_result_sha256": canonical_hash(answer),
    }.items()}


def describe(workspace, study_id, run_id, profile_id=None, *, point_index=None):
    """Describe saved results and require explicit frontier and map-profile choices."""
    value = _load(workspace, study_id, run_id)
    output = {name: value[name] for name in ("study_id", "run_id", "revision", "study_sha256", "result_sha256")}
    output.update(schema=SCHEMA, title=value["study"]["title"], mode=value["study"]["mode"],
                  point_index=point_index, selected_ids=[], candidate_id=None,
                  profiles=[], points=[], ready=False, issues=[])
    if value["answer"].get("schema_version") == "ecosci.robust-frontier/1":
        for index, point in enumerate(value["answer"].get("points", [])):
            issue = []
            try:
                point_study, point_answer = _point(value, index)
                _selection(point_study, point_answer)
            except (ValueError, KeyError, TypeError) as error:
                issue.append(_issue("frontier_point", error))
            output["points"].append({"point_index": index, "budget": point.get("budget"),
                "status": point.get("result", {}).get("status", point.get("status")),
                "ready": not issue, "issues": issue})
        if point_index is None:
            output["issues"].append(_issue("choose_point", "Choose one explicit retained budget-frontier point."))
            return output
    study, answer = _point(value, point_index)
    try:
        packet = _selection(study, answer)
        _verify_source(workspace, study)
    except (ValueError, KeyError, TypeError, OSError) as error:
        output["issues"].append(_issue("native_selection", error)); return output
    output.update(selected_ids=packet["selected_ids"], candidate_id=packet["selected_ids"][0],
                  candidates=packet["candidates"], metrics=packet["metrics"],
                  profile_outcomes=packet["profile_outcomes"],
                  solver_status=packet["solver_status"], objective=packet["objective"],
                  cost=packet["cost"], cost_units=packet["cost_units"])
    pairs = {}
    for profile in study["profiles"]:
        row = {"id": profile["id"], "label": profile.get("label") or profile["id"],
               "ready": False, "issues": []}
        try:
            pair = _pair(workspace, study, packet, profile["id"])
            pairs[profile["id"]] = pair
            row.update(ready=True, **{name: pair[name] for name in ("baseline_run_id", "alternative_run_id", "grid_id")})
        except (ValueError, KeyError, TypeError, OSError) as error:
            row["issues"].append(_issue("native_pair", error))
        output["profiles"].append(row)
    if profile_id is None:
        output["issues"].append(_issue("choose_profile", "Choose the native parameter profile to show in the maps."))
        return output
    if profile_id not in pairs:
        selected = next((row for row in output["profiles"] if row["id"] == profile_id), None)
        output["issues"].extend(selected["issues"] if selected else [_issue("profile", "Choose an original profile included in this saved result.")])
        return output
    pair = pairs[profile_id]
    pin = _pin(value, study, answer, packet, profile_id, point_index)
    output.update(ready=True, profile_id=profile_id, source_decision=pin,
                  interpretation=deepcopy(INTERPRETATION),
                  selection={"source_decision": pin, "baseline_run_id": pair["baseline_run_id"],
                             "scenario_run_ids": [pair["alternative_run_id"]],
                             "title": study["title"] + " — " + pair["profile_title"]})
    return output


def bind_decision(workspace, selection):
    """Bind exact saved inputs before their stable identity enters the delivery."""
    requested = selection.get("source_decision")
    if requested is None:
        return None
    if not isinstance(requested, dict) or set(requested) != set(PIN_FIELDS):
        raise ValueError("Reopen the saved Decision map continuation to retain its complete source identity")
    value = _load(workspace, requested["study_id"], requested["run_id"])
    study, answer = _point(value, requested["point_index"])
    packet = _selection(study, answer)
    _verify_source(workspace, study)
    pin = _pin(value, study, answer, packet, requested["profile_id"], requested["point_index"])
    if canonical(requested) != canonical(pin):
        raise ValueError("The selected Decision revision or calculation changed; reopen its saved continuation")
    pair = _pair(workspace, study, packet, pin["profile_id"], verify=True)
    if selection.get("baseline_run_id") != pair["baseline_run_id"] or selection.get("scenario_run_ids") != [pair["alternative_run_id"]]:
        raise ValueError("Keep the saved Decision's exact reference and selected whole-package run")
    return {"schema": SCHEMA, "source_decision": pin, "project_id": workspace.project["id"],
            "title": study["title"], "parent_study": value["study"], "parent_answer": value["answer"],
            "study": study, "answer": answer, "selection_packet": packet,
            "native_pair": pair, "interpretation": deepcopy(INTERPRETATION)}


def _verify_project(bundle, binding):
    if bundle.get("schema_version") != "ecosci.robust-project/1":
        raise ValueError("Retain the original complete Decision project format")
    payload = bundle.get("payload")
    if not isinstance(payload, dict) or canonical_hash(payload) != bundle.get("sha256"):
        raise ValueError("The retained Decision project export digest differs")
    pin = binding["source_decision"]
    if payload.get("study", {}).get("id") != pin["study_id"]:
        raise ValueError("The retained project belongs to another Decision")
    revisions = payload.get("revisions", [])
    if [row.get("revision") for row in revisions] != list(range(1, payload["study"]["head"] + 1)):
        raise ValueError("The native project export lost its complete revision history")
    indexed = {}
    for revision in revisions:
        if revision.get("study_id") != pin["study_id"] or canonical_hash(revision.get("input")) != revision.get("sha256"):
            raise ValueError("A retained project revision identity differs")
        Study.model_validate(revision["input"]); indexed[revision["revision"]] = revision
    target = indexed.get(pin["revision"])
    if target is None or target["sha256"] != pin["study_sha256"]:
        raise ValueError("The project export lacks the map's exact saved Decision revision")
    found = None
    for run in payload.get("runs", []):
        if run.get("study_id") != pin["study_id"] or run.get("revision") not in indexed:
            raise ValueError("The project export has a calculation outside its revision history")
        answer = run.get("result")
        if answer is not None and answer.get("study_sha256") != indexed[run["revision"]]["sha256"]:
            raise ValueError("A project calculation has a conflicting input identity")
        if run.get("id") == pin["run_id"]:
            if found is not None:
                raise ValueError("Duplicate retained Decision calculation")
            found = run
    if found is None or found.get("status") != "completed" or canonical_hash(found.get("result")) != pin["result_sha256"]:
        raise ValueError("The project export lacks the exact completed calculation")


def retain_decision(workspace, directory, state, binding):
    """Retain native exports once; subsequent history cannot rewrite a release."""
    if binding is None:
        return None
    directory = Path(directory)
    pin = binding["source_decision"]
    prefix = "decision/" + digest(pin) + "/"
    target = directory / prefix
    target.mkdir(parents=True, exist_ok=True)
    files = state.setdefault("files", {})
    def retain(name, filename, body, media_type):
        path = target / filename
        atomic_bytes(path, body, immutable=True)
        descriptor = {**describe_file(directory, path), "media_type": media_type}
        key = "decision_" + name
        if key in files and any(files[key].get(field) != descriptor[field] for field in ("path", "bytes", "sha256")):
            raise ValueError("The retained Decision release member differs: " + name)
        files[key] = descriptor
        return descriptor
    project_path = target / "decision-project.json"
    if project_path.exists():
        project = read_json(project_path)
    else:
        project = _load(workspace, pin["study_id"], pin["run_id"], project=True)["project"]
    _verify_project(project, binding)
    retain("project", "decision-project.json", canonical(project) + b"\n", "application/json")
    records = {
        "binding": ("delivery-binding.json", binding),
        "selection": ("implementation-selection.json", binding["selection_packet"]),
        "study": ("selected-study.json", binding["study"]),
        "result": ("selected-result.json", binding["answer"]),
        "parent_study": ("original-study-revision.json", binding["parent_study"]),
        "parent_result": ("original-calculation.json", binding["parent_answer"]),
    }
    for name, (filename, value) in records.items():
        retain(name, filename, canonical(value) + b"\n", "application/json")
    retain("report_html", "decision-report.html", html_report(binding["parent_study"], binding["parent_answer"]).encode("utf-8"), "text/html")
    retain("report_csv", "decision-report.csv", csv_report(binding["parent_study"], binding["parent_answer"]).encode("utf-8"), "text/csv")
    if pin["point_index"] is not None:
        retain("point_report_html", "selected-point-report.html", html_report(binding["study"], binding["answer"]).encode("utf-8"), "text/html")
        retain("point_report_csv", "selected-point-report.csv", csv_report(binding["study"], binding["answer"]).encode("utf-8"), "text/csv")
    source = binding["study"].get("source", {})
    diagnostic = source.get("diagnostic_binding")
    if diagnostic:
        for name in ("report", "manifest"):
            copied = copy_verified(workspace.root, diagnostic[name], directory,
                                   path=prefix + "diagnostic-" + name + ".json")
            key = "decision_diagnostic_" + name
            if key in files and any(files[key].get(field) != copied.get(field) for field in ("path", "bytes", "sha256")):
                raise ValueError("The attached diagnostic revision differs")
            files[key] = copied
    state["source_decision"] = binding
    return {"binding": binding, "files": {name: deepcopy(value) for name, value in files.items() if name.startswith("decision_")}}


def _number(value):
    return format(value, ",.7g") if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else "Unavailable"


def _sections(product):
    if product is None:
        return []
    binding = product["binding"]; pin = binding["source_decision"]
    packet, pair = binding["selection_packet"], binding["native_pair"]
    candidate = packet["candidates"][0]
    labels = {row["id"]: row.get("label") or row["id"] for row in packet["profiles"]}
    paragraphs = [
        "Saved Decision: " + binding["title"] + "; revision " + str(pin["revision"]) + ".",
        "Selected whole package: " + (candidate.get("label") or candidate["id"]) + ".",
        "Mapped parameter profile: " + pair["profile_title"] + ".",
        "Original calculation: " + pin["run_id"] + "; result SHA-256: " + pin["result_sha256"] + ".",
        INTERPRETATION["maps"], INTERPRETATION["profiles"], INTERPRETATION["sign"],
        INTERPRETATION["support"], INTERPRETATION["weights"],
    ]
    if pin["point_index"] is not None:
        paragraphs.append("Explicit frontier point " + str(pin["point_index"] + 1) +
                          "; budget " + _number(binding["study"].get("budget")) + " " + packet["cost_units"] + ".")
    assumptions = [["Objective", packet["objective"]], ["Solver status", packet["solver_status"]],
                   ["Package cost", _number(packet["cost"]) + " " + packet["cost_units"]],
                   ["Capacity used", _number(packet["capacity_used"])]]
    outcomes = []
    for profile in packet["profile_outcomes"]:
        for metric in profile["metrics"]:
            outcomes.append([labels.get(profile["id"], profile["id"]), metric["id"],
                             _number(metric["gain"]), metric["units"],
                             _number(metric.get("guaranteed_gain")), _number(metric.get("target_shortfall"))])
    return [
        {"id": "saved-decision", "title": "Saved Decision and mapped native profile", "paragraphs": paragraphs,
         "tables": [{"columns": ["Assumption", "Retained value"], "rows": assumptions}], "assets": []},
        {"id": "decision-profiles", "title": "Selected package across every retained profile",
         "paragraphs": ["All physical outcomes below retain their original annual units and common support. Supplied profile probabilities are decision assumptions; this finite profile design is not a probability distribution unless the user explicitly supplied one."],
         "tables": [{"columns": ["Profile", "Metric", "Annual export reduction", "Unit", "Guaranteed target", "Shortfall"],
                     "rows": outcomes}], "assets": []},
    ]


def report_sections(product):
    result = []
    for section in _sections(product):
        blocks = list(section["paragraphs"])
        blocks.extend({"kind": "table", "columns": table["columns"], "rows": table["rows"],
                       "widths": None, "caption": None} for table in section["tables"])
        result.append((section["title"], blocks))
    return result


def client_sections(product):
    sections = _sections(product)
    if sections:
        sections[-1]["paragraphs"].append("Complete original decision reports, editable all-revision project, selected cells, calculation record, and source binding are retained with this delivery.")
    return sections


def extend_assets(manifest, state):
    binding = state.get("source_decision")
    if binding is None:
        return manifest
    artifact = state.get("files", {}).get("decision_binding")
    if not artifact:
        raise ValueError("Retain the original Decision binding before packaging")
    manifest["source_decision"] = {
        "schema": SCHEMA, "project_id": binding["project_id"],
        **deepcopy(binding["source_decision"]),
        "grid_id": binding["native_pair"]["grid_id"],
        "baseline_run_id": binding["native_pair"]["baseline_run_id"],
        "scenario_run_ids": [binding["native_pair"]["alternative_run_id"]],
        "binding_artifact": deepcopy(artifact),
    }
    assets = manifest.setdefault("project_assets", [])
    existing = set(assets)
    for name, descriptor in state.get("files", {}).items():
        if name.startswith("decision_") and descriptor["path"] not in existing:
            assets.append(descriptor["path"]); existing.add(descriptor["path"])
    return manifest

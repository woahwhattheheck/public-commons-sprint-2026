"""Adopt completed original geographic headwaters runs into a saved Programme.

The geographic producer remains authoritative for input construction and run
identity. This adapter uses the existing Programme comparison/report pathway
with a completed-output-only Workspace; it never dispatches a native model.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import time

from .common import describe_file, digest, held, identifier, read_json, verify_file
from .compute_programme import ComputeProgrammes, POLLUTANTS
from .model_selection import run_models, validate_completed_run
from .native_study import retained_runtimes
from .workspace import Workspace

SCHEMA = "upstate.geographic-programme-adoption/v1"
PREPARED_SCHEMA = "upstate.geographic-headwaters-prepared/v1"
KEYS = ("baseline", "restoration", "matched-control")


class CompletedWorkspace(Workspace):
    """Verify original completed outputs through the maintained run interface."""

    def run(self, key, **options):
        if options:
            raise ValueError("Geographic Programme adoption does not select native execution options")
        key = identifier(key)
        directory = self.root / "runs" / key
        with held(directory / ".run.lock", blocking=False):
            run = self.inspect_run(key)
            scope = validate_completed_run(run)
            if run["state"] != "complete" or not scope["full_model_outputs"]:
                raise ValueError("Complete the original geographic native stages first: " + key)
            if tuple(run_models(run)) != ("ndr", "sdr"):
                raise ValueError("The original geographic case requires both NDR and SDR")
            retained_runtimes(run)
            for artifact in run["artifacts"].values():
                verify_file(directory, artifact)
            return {**run, "reused": True, "model_scope": scope}


def _workspace(workspace):
    return CompletedWorkspace(workspace.root if isinstance(workspace, Workspace) else workspace)


def _original(ws, geographic_id):
    key = identifier(geographic_id)
    directory = ws.root / "geographic-headwaters" / key
    prepared_path = directory / "prepared.json"
    prepared = read_json(prepared_path)
    inputs = read_json(directory / "inputs" / "input-receipt.json")
    identity = inputs.get("identity", {})
    if (prepared.get("schema") != PREPARED_SCHEMA or prepared.get("id") != key
            or prepared.get("state") != "prepared"
            or prepared.get("project_id") != ws.project["id"]
            or prepared.get("directory") != directory.relative_to(ws.root).as_posix()
            or identity.get("id") != key
            or digest({name: value for name, value in identity.items() if name != "id"}) != key
            or identity.get("project_id") != ws.project["id"]
            or identity.get("selection") != prepared.get("selection")
            or identity.get("geographic_binding") != prepared.get("geography")
            or inputs.get("geography") != prepared.get("geography")
            or inputs.get("input_summary") != prepared.get("input_summary")):
        raise ValueError("Select the unchanged original geographic preparation in this Workspace")
    collection = identifier(prepared["source_collection_id"])
    ws._get("sources", collection)
    grid = ws.get_grid(identifier(prepared["grid_id"]))
    grid_spec = grid["spec"]
    if (grid_spec.get("source_collection_id") != collection
            or grid_spec.get("resolution_m") != 30
            or grid_spec.get("input_sources") != {
                role: "GEOGRAPHIC_" + role
                for role in ("DEM", "NLCD", "PRECIPITATION", "R_FACTOR", "K_FACTOR")}
            or grid_spec.get("reporting_area") != {
                "source_id": "GEOGRAPHIC_REPORTING_AREA", "layer": "reporting_area"}
            or grid_spec.get("model_domain") != {
                "source_id": "GEOGRAPHIC_MODEL_DOMAIN", "layer": "model_domain"}):
        raise ValueError("The native grid differs from its original 30 m geographic source selection")
    profile = ws._get("profiles", identifier(prepared["profile_id"]))
    if (profile.get("source_collection_id") != collection
            or profile.get("biophysical_source_id") != "GEOGRAPHIC_BIOPHYSICAL"):
        raise ValueError("The original geographic coefficient profile differs")
    alternatives = prepared.get("alternative_run_ids")
    scenarios = prepared.get("alternative_scenario_ids")
    if (not isinstance(alternatives, list) or len(alternatives) != 2
            or not isinstance(scenarios, list) or len(scenarios) != 2):
        raise ValueError("Retain the original baseline, restoration and matched-control cohort")
    run_ids = [identifier(prepared["baseline_run_id"]), *[identifier(value) for value in alternatives]]
    scenario_ids = [identifier(prepared["baseline_scenario_id"]), *[identifier(value) for value in scenarios]]
    if len(set(run_ids)) != 3 or len(set(scenario_ids)) != 3:
        raise ValueError("The three original geographic native cases must be distinct")
    rows, cases = [], []
    for index, (run_id, scenario_id) in enumerate(zip(run_ids, scenario_ids)):
        run = ws.inspect_run(run_id)
        native_selection = run.get("selection")
        if (run.get("id") != run_id or digest(native_selection) != run_id
                or tuple(run_models(run)) != ("ndr", "sdr")
                or any(native_selection.get(name) != expected for name, expected in (
                    ("grid_id", grid["id"]), ("profile_id", profile["id"]),
                    ("scenario_id", scenario_id)))):
            raise ValueError("An original native run differs from the geographic preparation")
        scenario = ws._get("scenarios", scenario_id)
        patches = scenario.get("patches", [])
        if (scenario.get("source_collection_id") != collection
                or scenario.get("kind") != ("baseline" if index == 0 else "landcover")):
            raise ValueError("The geographic native scenario has another source or kind")
        if index == 0:
            if patches:
                raise ValueError("The original geographic baseline has no land-cover patches")
        else:
            mask_id = "GEOGRAPHIC_" + ("RESTORATION_MASK" if index == 1 else "CONTROL_MASK")
            if (len(patches) != 1 or patches[0].get("mask_source_id") != mask_id
                    or patches[0].get("from_codes") != [81, 82]
                    or patches[0].get("to_code") != 41):
                raise ValueError("The original geographic conversion or matched-control mask differs")
        rows.append({"key": KEYS[index], "title": scenario["title"],
                     "profile_id": profile["id"], "scenario_id": scenario_id,
                     "models": ["ndr", "sdr"], "native_run_id": run_id,
                     "reason": scenario["reason"]})
        cases.append({"key": KEYS[index], "title": scenario["title"], "run_id": run_id,
                      "scenario_id": scenario_id, "state": run["state"],
                      "completed_at": run.get("completed_at")})
    binding = {"geographic_id": key, "project_id": ws.project["id"],
               "prepared": describe_file(ws.root, prepared_path),
               "input_receipt": describe_file(ws.root, directory / "inputs" / "input-receipt.json"),
               "source_collection_id": collection, "grid_id": grid["id"],
               "profile_id": profile["id"], "run_ids": run_ids,
               "scenario_ids": scenario_ids}
    source_reference = "geographic-edition:" + key + " / prepared-sha256:" + binding["prepared"]["sha256"]
    selection = {"schema": "upstate.compute-programme-selection/v1",
        "title": prepared["selection"]["title"] + " — native run programme",
        "description": ("Actual retained Upper Savannah geography with explicitly simulated physical inputs. "
            "Original completed baseline, riparian restoration and matched control; upstream model domain, "
            "South Carolina reporting area and utility focus retain their separate original supports."),
        "source_reference": source_reference, "grid_id": grid["id"],
        "baseline_run": "baseline", "runs": rows}
    return prepared, inputs, binding, selection, cases


def _delivery_selection(ws, prepared, delivery_id=None):
    if delivery_id is None:
        return {"delivery_mode": "native_study",
            "native_study": {"title": prepared["selection"]["title"],
                            "purpose": prepared["selection"]["question"],
                            "reference": "geographic-edition:" + prepared["id"]},
            "baseline_run": "baseline", "scenario_runs": list(KEYS[1:]),
            "source_roles": {},
            "overlays": {"drinking_water": {
                "source_collection_id": prepared["source_collection_id"],
                "source_id": "GEOGRAPHIC_UTILITY_FOCUS",
                "label": prepared["selection"]["utility_label"] + ": original reporting-area intersection"}},
            "notes": ["Actual original geography; declared simulated physical inputs and coefficients.",
                      "Annual export reaches modeled streams; it is not intake delivery or concentration."]}
    original = ws.retained_item("deliveries", identifier(delivery_id))
    selected = original.get("selection", {})
    selected_ids = selected.get("scenario_run_ids")
    alternatives = dict(zip(prepared["alternative_run_ids"], KEYS[1:]))
    if (original.get("state") != "complete"
            or selected.get("baseline_run_id") != prepared["baseline_run_id"]
            or not isinstance(selected_ids, list) or not selected_ids
            or any(not isinstance(run_id, str) for run_id in selected_ids)
            or len(selected_ids) != len(set(selected_ids))
            or any(run_id not in alternatives for run_id in selected_ids)):
        raise ValueError("Select a completed mapped delivery with this baseline and original geographic alternatives")
    result = deepcopy(selected)
    result.pop("baseline_run_id")
    result.pop("scenario_run_ids")
    result.update(baseline_run="baseline",
                  scenario_runs=[alternatives[run_id] for run_id in selected_ids])
    return result


def preview(workspace, geographic_id, *, delivery_id=None):
    """Read original bindings and show readiness without preparing or running models."""
    ws = _workspace(workspace)
    prepared, inputs, binding, selection, cases = _original(ws, geographic_id)
    manager = ComputeProgrammes(ws)
    programme = manager.preview(selection)
    if [row["run_id"] for row in programme["runs"]] != binding["run_ids"]:
        raise ValueError("Programme preview would replace an original native run")
    issues = []
    for case in cases:
        run = ws.inspect_run(case["run_id"])
        try:
            scope = validate_completed_run(run)
            if run["state"] != "complete" or not scope["full_model_outputs"]:
                raise ValueError("Native stages are not complete")
            retained_runtimes(run)
        except ValueError as error:
            issues.append({"run_id": case["run_id"], "key": case["key"], "message": str(error)})
    delivery_selection = _delivery_selection(ws, prepared, delivery_id)
    return {"schema": "upstate.geographic-programme-preview/v1",
            "id": digest({"binding": binding, "selection": selection,
                          "delivery_selection": delivery_selection}),
            "ready": not issues, "issues": issues, "binding": binding,
            "selection": selection, "runs": cases, "geography": prepared["geography"],
            "input_summary": prepared["input_summary"],
            "native_study_selection": delivery_selection,
            "programme_preview": programme}


def _verified_report(ws, manager, programme_id, binding, selection):
    status = manager.status(programme_id, include_ensemble_candidates=False)
    report = manager.read_report(programme_id)
    expected_rows = {(run_id, pollutant) for run_id in binding["run_ids"] for pollutant in POLLUTANTS}
    rows = report.get("rows", [])
    actual_rows = [(row.get("run_id"), row.get("pollutant")) for row in rows]
    if (status["state"] != "complete" or report.get("programme_state") != "complete"
            or report.get("programme_id") != programme_id
            or report.get("workspace_id") != ws.project["id"]
            or report.get("grid_id") != binding["grid_id"]
            or report.get("source_reference") != selection["source_reference"]
            or [row["run_id"] for row in status["runs"]] != binding["run_ids"]
            or len(actual_rows) != len(expected_rows) or set(actual_rows) != expected_rows
            or any(row.get("state") != "complete" or not isinstance(row.get("artifact"), dict) for row in rows)):
        raise ValueError("The retained Programme report differs from the original geographic native cases")
    for row in rows:
        for field in ("artifact", "comparison_artifact"):
            if row.get(field) is not None:
                verify_file(ws.root, row[field])
    for item in report.get("files", []):
        verify_file(ws.root, item)
    return status, report


def _verify_inputs(ws, geographic_id, inputs):
    """Verify retained science while omitting portable runtime lock markers."""
    from .portable import member_name
    directory = ws.root / "geographic-headwaters" / identifier(geographic_id) / "inputs"
    for item in inputs["files"]:
        relative = member_name(item["path"])
        if relative.name.endswith(".lock"):
            # held() creates empty runtime markers; portable backup omits them.
            # Keep their original receipt entries, without requiring recreation.
            if item.get("bytes") != 0 or item.get("sha256") != hashlib.sha256(b"").hexdigest():
                raise ValueError("A declared runtime lock contains retained input data")
            continue
        verify_file(directory, item)


def adopt(workspace, geographic_id, *, delivery_id=None, expected_preview_id=None, previous=None):
    """Create or reopen the existing Programme around three completed originals."""
    ws = _workspace(workspace)
    if previous is not None:
        if (not isinstance(previous, dict) or previous.get("schema") != SCHEMA
                or previous.get("geographic_id") != identifier(geographic_id)
                or previous.get("existing_delivery_id") != delivery_id
                or (expected_preview_id is not None
                    and previous.get("preview_id") != identifier(expected_preview_id))):
            raise ValueError("The retained adoption belongs to another geographic selection")
        verify(ws, previous)
        return deepcopy(previous)
    reviewed = preview(ws, geographic_id, delivery_id=delivery_id)
    if expected_preview_id is not None and reviewed["id"] != identifier(expected_preview_id):
        raise ValueError("The selected geographic Programme preview changed")
    if not reviewed["ready"]:
        raise ValueError("Complete the original geographic runs before adoption: " +
                         "; ".join(row["key"] + ": " + row["message"] for row in reviewed["issues"]))
    binding, selection = reviewed["binding"], reviewed["selection"]
    directory = ws.root / "geographic-headwaters" / binding["geographic_id"]
    # This is the original geographic preparation lock. No new journal/store is
    # introduced; the maintained Programme owns its own execution/report locks.
    with held(directory / ".prepare.lock", blocking=False):
        prepared, inputs, current_binding, current_selection, cases = _original(ws, geographic_id)
        if current_binding != binding or current_selection != selection:
            raise ValueError("The original geographic preparation changed during adoption")
        started = time.perf_counter()
        _verify_inputs(ws, binding["geographic_id"], inputs)
        for run_id in binding["run_ids"]:
            ws.run(run_id)
        native_verification_seconds = time.perf_counter() - started
        manager = ComputeProgrammes(ws)
        started = time.perf_counter()
        programme = manager.create(selection)
        status = manager.status(programme["id"], include_ensemble_candidates=False)
        reused = status["state"] == "complete"
        if not reused:
            status = manager.execute(programme["id"])
        status, report = _verified_report(ws, manager, programme["id"], binding, selection)
        if not reused:
            for row in status["runs"]:
                attempts = row.get("attempts", [])
                if not attempts or attempts[-1].get("reused") is not True:
                    raise ValueError("Programme adoption must verify and reuse the completed originals")
        programme_seconds = time.perf_counter() - started
        maps = manager.delivery_preview(programme["id"], reviewed["native_study_selection"])
        if not maps["ready"]:
            raise ValueError("Open the original Programme to resolve its mapped delivery: " + programme["id"])
        return {"schema": SCHEMA, "project_id": ws.project["id"], "preview_id": reviewed["id"],
                "geographic_id": binding["geographic_id"], "binding": binding,
                "programme_id": programme["id"], "programme_state": status["state"],
                "programme_reused": reused, "native_runs": cases,
                "geography": prepared["geography"], "input_summary": prepared["input_summary"],
                "classification": prepared["classification"],
                "original_ensemble_id": prepared["ensemble_id"],
                "report": {"id": report["id"], "schema": report["schema"],
                           "rows": report["rows"], "files": report.get("files", [])},
                "native_study_selection": reviewed["native_study_selection"],
                "delivery_preview": maps, "existing_delivery_id": delivery_id,
                "timings": {"native_original_verification_seconds": native_verification_seconds,
                            "programme_reconciliation_seconds": programme_seconds},
                "meaning": ("Original completed geographic native outputs retained in the maintained Programme. "
                    "N/P annual kg and sediment annual metric tonnes reach streams on original reporting support; "
                    "utility polygons are separate original focus context, not intake-load predictions.")}


def verify(workspace, value):
    """Reopen this adopted Programme and its original source/quantity bindings."""
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ValueError("Select an original geographic Programme adoption result")
    ws = _workspace(workspace)
    prepared, inputs, binding, selection, cases = _original(ws, value["geographic_id"])
    if (value.get("project_id") != ws.project["id"] or value.get("binding") != binding
            or value.get("geography") != prepared["geography"]
            or value.get("input_summary") != prepared["input_summary"]
            or value.get("classification") != prepared["classification"]
            or value.get("original_ensemble_id") != prepared["ensemble_id"]
            or value.get("native_runs") != cases):
        raise ValueError("Geographic Programme lineage differs in the received project")
    _verify_inputs(ws, binding["geographic_id"], inputs)
    for run_id in binding["run_ids"]:
        ws.run(run_id)
    status, report = _verified_report(ws, ComputeProgrammes(ws),
                                     identifier(value["programme_id"]), binding, selection)
    if (value["report"]["id"] != report["id"]
            or value["report"]["rows"] != report["rows"]
            or value["report"]["files"] != report.get("files", [])):
        raise ValueError("The received Programme report differs from its retained adoption")
    expected_delivery = _delivery_selection(ws, prepared, value.get("existing_delivery_id"))
    if (expected_delivery != value.get("native_study_selection")
            or value.get("preview_id") != digest({"binding": binding, "selection": selection,
                                                "delivery_selection": expected_delivery})):
        raise ValueError("The retained geographic Programme map selection differs")
    return {"identity": "MATCH", "project_id": ws.project["id"],
            "geographic_id": binding["geographic_id"], "programme_id": status["id"],
            "report_id": report["id"], "run_ids": binding["run_ids"]}


def operator_opening(workspace, adoption):
    """Bind the maintained Guided journey to an original mapped alternative."""
    ws = _workspace(workspace)
    verify(ws, adoption)
    status = ComputeProgrammes(ws).status(adoption["programme_id"],
                                          include_ensemble_candidates=False)
    by_key = {row["key"]: row for row in status["runs"]}
    focus_key = adoption["native_study_selection"]["scenario_runs"][0]
    focus = by_key[focus_key]
    run = ws.inspect_run(focus["run_id"])
    baseline_id = adoption["binding"]["run_ids"][0]
    comparison_id = status["comparisons"][focus_key]["id"]
    comparison = ws.retained_item("comparisons", identifier(comparison_id))
    if (comparison["baseline_run_id"] != baseline_id
            or focus["run_id"] not in [row["run_id"] for row in comparison["alternatives"]]):
        raise ValueError("The geographic opening comparison differs from its original cases")
    selected = {
        "baseline_run_id": baseline_id, "grid_id": run["selection"]["grid_id"],
        "profile_id": run["selection"]["profile_id"], "scenario_id": run["selection"]["scenario_id"],
        "run_id": run["id"], "models": ["ndr", "sdr"], "comparison_id": comparison["id"],
        "spatial_review_id": "", "spatial_export_id": "",
        "delivery_id": adoption.get("existing_delivery_id") or "",
        "calibration_review_id": "",
    }
    context = {"project_id": ws.project["id"], "geographic_id": adoption["geographic_id"],
        "programme_id": adoption["programme_id"], "adoption_preview_id": adoption["preview_id"],
        "source_collection_id": adoption["binding"]["source_collection_id"],
        "alternative_run_ids": adoption["binding"]["run_ids"][1:], "selection": selected}
    key = digest(context)
    journey = {
        "schema": "upstate.operating-journey/v1", "project_id": ws.project["id"],
        "step": "compare", "selection": selected, "regional": None, "community": None,
        "notes": (
            "Actual retained Upper Savannah geography; explicitly simulated terrain, forcing, "
            "land cover and coefficients. Original completed InVEST 3.20 NDR/SDR results. "
            "Inspect the selected baseline and mapped alternative on their common valid support. "
            "Annual N/P export is kg/year and sediment is metric tonnes/year reaching modeled streams. "
            "The upstream model domain, South Carolina reporting mask and utility focus remain distinct. "
            "Programme: " + adoption["programme_id"] + ". "
            "Geographic source edition: " + adoption["geographic_id"] + "."),
        "note_versions": [],
        "recorded_context": {"project_title": ws.project["title"],
                             "operator_opening": {"id": key, **context}},
    }
    if isinstance(run.get("completed_at"), str):
        journey["started_at"] = run["completed_at"]
    return {"schema": "upstate.geographic-operator-opening/v1", "id": key,
            "project_id": ws.project["id"], "geographic_id": adoption["geographic_id"],
            "programme_id": adoption["programme_id"], "entry_view": "journey",
            "programme_view": "programmes", "journey": journey}


def save_operator_opening(operator, workspace_key, adoption, *, expected_revision):
    """Save an explicitly reviewed opening through the existing live Operator.

    Pass the revision observed before the opening request, including None for a
    genuinely new session. A retry must keep that original revision. Later user
    choices are preserved; this function never creates a server or native run.
    """
    if expected_revision is not None:
        identifier(expected_revision)
    ws = operator.ws(workspace_key)
    opening = operator_opening(ws, adoption)
    current = operator.operator_session(workspace_key)
    previous = (current or {}).get("journey", {})
    prior_context = previous.get("recorded_context", {}).get("operator_opening", {})
    wanted = opening["journey"]["selection"]
    same_opening = prior_context.get("id") == opening["id"]
    if same_opening and previous.get("selection") == wanted:
        saved, state = current, "already_selected"
    elif same_opening or (current or {}).get("revision") != expected_revision:
        # Keep both manual changes after this opening and a different view
        # saved while its original reviewed request was waiting.
        saved, state = current, "preserved_current"
    else:
        journey = deepcopy(opening["journey"])
        # These are other retained views in the same project, not replacements
        # for this comparison. Keep them while selecting the original runs.
        for name in ("regional", "community"):
            if name in previous:
                journey[name] = deepcopy(previous[name])
        saved = operator.save_operator_session(workspace_key, {
            "journey": journey, "expected_revision": expected_revision})
        state = "saved"
    readback = operator.operator_session(workspace_key)
    if readback != saved:
        raise ValueError("The operator view changed during opening; retain its current revision")
    descriptor = None
    path = ws.root / "operator-session.json"
    if saved is not None:
        body = path.read_bytes()
        if json.loads(body) != saved:
            raise ValueError("The saved operator file differs from its current view")
        descriptor = {"path": "operator-session.json", "bytes": len(body),
                      "sha256": hashlib.sha256(body).hexdigest()}
    elif path.exists():
        raise ValueError("An operator session appeared during receiving; retain its current view")
    applied = (saved or {}).get("journey", {}).get("selection") == wanted and state != "preserved_current"
    return {"schema": "upstate.geographic-operator-opening-receipt/v1",
            "project_id": ws.project["id"], "geographic_id": adoption["geographic_id"],
            "programme_id": adoption["programme_id"], "opening_id": opening["id"],
            "state": state, "selection_applied": applied,
            "observed_revision": expected_revision,
            "revision": (saved or {}).get("revision"), "operator_session": saved,
            "operator_session_file": descriptor, "requested_selection": wanted,
            "selection": (saved or {}).get("journey", {}).get("selection"),
            "entry_view": opening["entry_view"], "programme_view": opening["programme_view"]}


def verify_operator_opening(workspace, adoption, receipt):
    """Verify the exact saved or preserved operator view in the received project."""
    ws = _workspace(workspace)
    opening = operator_opening(ws, adoption)
    if (not isinstance(receipt, dict)
            or receipt.get("schema") != "upstate.geographic-operator-opening-receipt/v1"
            or any(receipt.get(key) != opening[key]
                   for key in ("project_id", "geographic_id", "programme_id"))
            or receipt.get("opening_id") != opening["id"]
            or receipt.get("requested_selection") != opening["journey"]["selection"]
            or receipt.get("state") not in {"saved", "already_selected", "preserved_current"}):
        raise ValueError("The operator opening receipt differs from the original geographic adoption")
    descriptor, saved = receipt.get("operator_session_file"), receipt.get("operator_session")
    if saved is None:
        if (descriptor is not None or (ws.root / "operator-session.json").exists()
                or receipt["state"] != "preserved_current" or receipt.get("selection") is not None
                or receipt.get("revision") is not None or receipt.get("selection_applied") is not False):
            raise ValueError("The received project differs from its preserved empty operator view")
    else:
        if (not isinstance(descriptor, dict) or descriptor.get("path") != "operator-session.json"
                or saved.get("schema") != "upstate.operator-session/v1"
                or saved.get("project_id") != ws.project["id"]
                or saved.get("revision") != receipt.get("revision")
                or digest(saved.get("journey")) != saved.get("revision")
                or saved.get("journey", {}).get("selection") != receipt.get("selection")
                or read_json(verify_file(ws.root, descriptor)) != saved):
            raise ValueError("The received operator selection differs from its retained session")
        applied = (receipt["state"] != "preserved_current"
                   and receipt["selection"] == opening["journey"]["selection"])
        if receipt.get("selection_applied") is not applied:
            raise ValueError("The operator opening status differs from its actual saved selection")
        if receipt["state"] != "preserved_current" and not applied:
            raise ValueError("The saved geographic opening selects another original case")
    return {"identity": "MATCH", "project_id": ws.project["id"],
            "geographic_id": adoption["geographic_id"], "programme_id": adoption["programme_id"],
            "opening_id": opening["id"], "state": receipt["state"],
            "selection_applied": receipt["selection_applied"], "revision": receipt["revision"]}

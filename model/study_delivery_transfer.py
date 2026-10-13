"""Typed dependencies for completed Decision map releases in selected studies.

This is an extension of model.study_transfer's original closure. It reads saved
records and original descriptors; it does not render, recalculate, migrate a
database, or interpret arbitrary paths in user metadata as transferable files.
"""
from __future__ import annotations

from copy import deepcopy

from .common import canonical, digest, identifier, read_json

DOCUMENTS = {
    "deliveries": "delivery-state.json",
    "scenario-decisions": "decision.json",
    "analyses": "analysis.json",
    "economic-editions": "edition.json",
    "receiving-water-plans": "plan.json",
    "receiving-water-analyses": "analysis.json",
    "water-designations": "selection.json",
    "spatial-exports": "export.json",
}
IMMUTABLE_KINDS = ("spatial-reviews", "water-designation-specs")
LOCKS = {
    "deliveries": ".delivery.lock", "scenario-decisions": ".decisions.lock",
    "analyses": ".analysis.lock", "receiving-water-plans": ".plan.lock",
    "receiving-water-analyses": ".analysis.lock", "spatial-exports": ".export.lock",
}
LABELS = {
    "deliveries": "Completed map and client releases",
    "scenario-decisions": "Watershed reports", "analyses": "Scenario analyses",
    "economic-editions": "Economic report editions",
    "receiving-water-plans": "Receiving-water source plans",
    "receiving-water-analyses": "Receiving-water analyses",
    "water-designations": "Saved water designations",
    "water-designation-specs": "Original water-designation selections",
    "spatial-reviews": "Saved map reviews", "spatial-exports": "Saved map exports",
}


def _prefix(kind, key):
    return kind + "/" + identifier(key) + "/"


def _document(closure, kind, key):
    return (kind + "/" + identifier(key) + ".json" if kind in IMMUTABLE_KINDS
            else _prefix(kind, key) + DOCUMENTS[kind])


def _expect(closure, kind, key, sha256):
    """Pin an original typed record by its already-declared source hash."""
    key = identifier(key)
    sha256 = identifier(sha256)
    relative = _document(closure, kind, key)
    path = closure.add_file(relative)
    closure.add_file(relative, {"bytes": path.stat().st_size, "sha256": sha256})


def _file_json(closure, prefix, descriptor):
    closure._descriptors(descriptor, prefix)
    return closure.read(prefix + descriptor["path"])


def _tree(closure, kind, key, value):
    prefix = _prefix(kind, key)
    closure.tree(prefix.rstrip("/"))
    closure._descriptors(value.get("files", {}), prefix)
    return prefix


def _project(closure, value):
    key = value.get("project_id") or value.get("project", {}).get("id")
    if key is not None and key != closure.workspace.project["id"]:
        raise ValueError("The retained release dependency belongs to another project.")


def _run_ids(closure, ids, reason):
    if not isinstance(ids, list) or any(not isinstance(key, str) for key in ids):
        raise ValueError("A retained report needs its original native run IDs.")
    for key in ids:
        closure.need("runs", key, reason)


def _decision_binding(closure, selection, retained):
    """Use the original pure Decision export functions on the frozen SQL rows."""
    from . import decision_study_transfer as decisions
    from .robust_decisions.eco_robust import decision_delivery as release
    from .robust_decisions.eco_robust.schema import Study
    from .robust_decisions.eco_robust.engine import canonical_hash

    requested = selection.get("source_decision")
    if not isinstance(requested, dict) or set(requested) != set(release.PIN_FIELDS):
        raise ValueError("Keep the completed release's exact saved Decision binding.")
    sid = decisions.study_id(requested["study_id"])
    record = closure.decision_records.get(sid)
    if record is None:
        record = decisions.read(closure.workspace, [sid], database=closure.decision_database)[sid]
    revisions = {row["revision"]: row for row in record["revisions"]}
    run = next((row for row in record["runs"] if row["id"] == requested["run_id"]), None)
    if (run is None or run["status"] != "completed" or run["result"] is None
            or run["revision"] != requested["revision"]):
        raise ValueError("The completed map release lost its original Decision calculation.")
    revision = revisions[run["revision"]]
    study = Study.model_validate(revision["input"]).model_dump()
    if canonical_hash(study) != revision["sha256"]:
        raise ValueError("The released Decision revision differs from its saved input.")
    value = {
        "study_id": sid, "run_id": run["id"], "revision": run["revision"],
        "study_sha256": revision["sha256"], "result_sha256": canonical_hash(run["result"]),
        "study": study, "answer": run["result"], "run": run,
    }
    selected_study, answer = release._point(value, requested["point_index"])
    packet = release._selection(selected_study, answer)
    if selected_study.get("source", {}).get("workspace_id") != closure.workspace.project["id"]:
        raise ValueError("The released Decision's native sources belong to another original project.")
    pin = release._pin(value, selected_study, answer, packet,
                       requested["profile_id"], requested["point_index"])
    if canonical(pin) != canonical(requested):
        raise ValueError("The released Decision pin differs from its exact revision or frontier point.")
    if (not isinstance(retained, dict)
            or retained.get("project_id") != closure.workspace.project["id"]
            or retained.get("source_decision") != pin):
        raise ValueError("The completed release lost its original retained Decision binding.")
    # This reads native record descriptors only. The original portable writer
    # verifies all selected file bytes after the native owner locks are held.
    pair = release._pair(closure.workspace, selected_study, packet,
                         requested["profile_id"], verify=False)
    if (selection.get("baseline_run_id") != pair["baseline_run_id"]
            or selection.get("scenario_run_ids") != [pair["alternative_run_id"]]):
        raise ValueError("The release changed its original result-selected whole native package.")
    if (retained.get("parent_study") != study or retained.get("parent_answer") != run["result"]
            or retained.get("study") != selected_study or retained.get("answer") != answer
            or retained.get("selection_packet") != packet or retained.get("native_pair") != pair):
        raise ValueError("The retained release report differs from the saved Decision calculation.")
    closure.need("robust-decisions", sid, "Original Decision calculation for completed map release")
    return pin


def related(closure):
    """Discover only completed releases bound to an already selected Decision."""
    selected = set(closure.decision_records)
    if not selected:
        return
    for path in sorted((closure.root / "deliveries").glob("*/delivery-state.json")):
        if ("deliveries", path.parent.name) in closure.nodes:
            continue
        try:
            value = read_json(path)
            if not isinstance(value, dict):
                continue
            selection = value.get("selection") or {}
            pin = selection.get("source_decision")
            if (value.get("state") != "complete" or not isinstance(pin, dict)
                    or pin.get("study_id") not in selected):
                continue
            identifier(path.parent.name)
            if value.get("schema") != "upstate.delivery/v1" or value.get("id") != path.parent.name:
                raise ValueError("The selected Decision's completed map release changed its identity.")
            closure.need("deliveries", path.parent.name,
                         "Completed release of the selected Decision calculation")
        except (ValueError, TypeError, OSError) as error:
            issue = {"path": path.relative_to(closure.root).as_posix(), "message": str(error)}
            if issue not in closure.related_issues:
                closure.related_issues.append(issue)


def _delivery(closure, key, value):
    if value.get("schema") != "upstate.delivery/v1" or value.get("state") not in ("complete", "received_snapshot"):
        raise ValueError("Retain a completed original map release or its original received snapshot.")
    selection = value["selection"]
    prefix = _tree(closure, "deliveries", key, value)
    closure._descriptors(value.get("maps", {}), prefix)
    _run_ids(closure, [selection["baseline_run_id"], *selection.get("scenario_run_ids", [])],
             "Original completed map-release cohort")
    closure._source_refs(selection, "Original map-release source editions")
    pin = None
    if selection.get("source_decision") is not None:
        pin = _decision_binding(closure, selection, value.get("source_decision"))
        binding = value["files"].get("decision_binding")
        if binding is None or _file_json(closure, prefix, binding) != value["source_decision"]:
            raise ValueError("The completed release lost its exact retained Decision report binding.")
    for field, kind, hash_field in (
        ("source_report_id", "scenario-decisions", None),
        ("source_scenario_analysis_id", "analyses", "source_scenario_analysis_sha256"),
        ("economic_edition_id", "economic-editions", "economic_edition_sha256"),
    ):
        if selection.get(field):
            closure.need(kind, selection[field], "Original report linked to the completed release")
            if hash_field and selection.get(hash_field):
                _expect(closure, kind, selection[field], selection[hash_field])
    if selection.get("source_report_id"):
        report = closure.read(_document(closure, "scenario-decisions", selection["source_report_id"]))
        expected = selection.get("source_report_sha256")
        if expected is not None and report["files"]["json"]["sha256"] != expected:
            raise ValueError("The map release names a different watershed report edition.")
    for field, kind in (("spatial_review_ids", "spatial-reviews"),
                        ("spatial_export_ids", "spatial-exports")):
        for original in selection.get(field, []):
            closure.need(kind, original, "Original saved-map review or export")
    for choice in selection.get("overlays", {}).values():
        if isinstance(choice, dict) and choice.get("selection_id"):
            closure.need("water-designations", choice["selection_id"],
                         "Original saved water designation")
    water = value.get("receiving_waters") or {}
    water_identity = water.get("identity") or {}
    if water_identity.get("analysis_id"):
        analysis = closure.read(_document(
            closure, "receiving-water-analyses", water_identity["analysis_id"]))
        plan = closure.read(_document(
            closure, "receiving-water-plans", water_identity["plan_id"]))
        if (analysis.get("record_sha256") != water_identity.get("analysis_record_sha256")
                or analysis.get("plan_id") != water_identity["plan_id"]
                or plan.get("record_sha256") != water_identity.get("plan_record_sha256")):
            raise ValueError("The completed release lost its exact receiving-water analysis or source-plan edition.")
        closure.need("receiving-water-analyses", water_identity["analysis_id"],
                     "Original receiving-water quantities for completed release")
        closure.need("receiving-water-plans", water_identity["plan_id"],
                     "Original receiving-water source plan for completed release")
    elif selection.get("receiving_waters") is not None:
        raise ValueError("The completed release lacks its original receiving-water analysis identity.")
    for comparison_id in selection.get("observation_comparison_ids", []):
        closure.need("observation-comparisons", comparison_id, "Original release observation comparison")
    run_ids = [selection["baseline_run_id"], *selection.get("scenario_run_ids", [])]
    if len(run_ids) > 1:
        closure.need("comparisons", digest({"runs": run_ids, "direction": "alternative minus baseline"}),
                     "Original signed map-release comparison")
    # These are the original producer's retained report references, not inferred
    # paths extracted from HTML or arbitrary user strings.
    closure.delivery_records[key] = {
        "id": key, "selection_sha256": digest(selection),
        "record_sha256": closure.files[prefix + "delivery-state.json"]["sha256"],
        "source_decision": deepcopy(pin),
        "files": deepcopy(value.get("files", {})), "maps": deepcopy(value.get("maps", {})),
    }


def _scenario_report(closure, key, value):
    if value.get("schema") != "upstate.scenario-decisions/v1":
        raise ValueError("Retain the original watershed report record.")
    prefix = _tree(closure, "scenario-decisions", key, value)
    report = _file_json(closure, prefix, value["files"]["json"])
    _project(closure, report)
    if (report.get("id") != key or report.get("schema") != value["schema"]
            or report.get("selection") != value["selection"]):
        raise ValueError("The original watershed report and its saved selection differ.")
    _run_ids(closure, value["selection"]["run_ids"], "Original watershed report cohort")
    closure.need("grids", report["grid_id"], "Original watershed report grid")
    closure._source_refs(value["selection"], "Original watershed report zones")


def _analysis(closure, key, value):
    if value.get("schema") != "upstate.scenario-analysis/v1" or value.get("state") != "complete":
        raise ValueError("Retain the completed original scenario analysis.")
    _tree(closure, "analyses", key, value)
    _run_ids(closure, value["run_ids"], "Original scenario-analysis cohort")
    closure.need("grids", value["grid_id"], "Original scenario-analysis grid")
    closure._source_refs(value["selection"], "Original scenario-analysis source areas")
    for region in value.get("regions", []):
        source = region.get("source") or {}
        choice = source.get("selection") or {}
        for details in (choice, choice.get("metadata") or {}):
            if details.get("source_plan_id"):
                closure.need("receiving-water-plans", details["source_plan_id"],
                             "Original prepared scenario-analysis source area")


def _economic(closure, key, value):
    if (value.get("schema") != "upstate.economic-edition/v1"
            or digest({"input": value["input"], "implementation": value["implementation"]}) != key):
        raise ValueError("The original Economic desk edition changed.")
    prefix = _tree(closure, "economic-editions", key, value)
    manifest = _file_json(closure, prefix, value["files"]["manifest"])
    for item in manifest["members"]:
        closure._descriptors(item, prefix)
    report = _file_json(closure, prefix, value["files"]["report"])
    _project(closure, report)
    original = value["input"]
    closure.need("scenario-decisions", original["report_id"],
                 "Original native watershed report for the Economic desk edition")
    source = closure.read(_document(closure, "scenario-decisions", original["report_id"]))
    if source["files"]["json"]["sha256"] != original["report_sha256"]:
        raise ValueError("The economic edition lost its original watershed report bytes.")
    _run_ids(closure, report["physical_source"]["selection"]["run_ids"],
             "Original economic physical-input cohort")


def _receiving_water(closure, kind, key, value):
    expected = ("upstate.receiving-water-plan/v1" if kind == "receiving-water-plans"
                else "upstate.receiving-water-analysis/v1")
    if (value.get("schema") != expected or value.get("state") != "complete"
            or digest(value["identity"]) != key
            or digest({name: item for name, item in value.items()
                       if name not in ("record_sha256", "reused")}) != value.get("record_sha256")):
        raise ValueError("The retained receiving-water record changed.")
    _project(closure, value["identity"])
    _tree(closure, kind, key, value)
    closure._source_refs(value["identity"]["selection"], "Original receiving-water sources")
    if kind == "receiving-water-analyses":
        plan = closure.read(_document(closure, "receiving-water-plans", value["plan_id"]))
        if plan.get("record_sha256") != value["identity"].get("plan_record_sha256"):
            raise ValueError("The receiving-water analysis lost its exact original source-plan edition.")
        closure.need("receiving-water-plans", value["plan_id"], "Original receiving-water source plan")
        closure.need("grids", value["identity"]["grid_id"], "Original receiving-water grid")
        _run_ids(closure, [value["baseline_run_id"], *value["alternative_run_ids"]],
                 "Original receiving-water cohort")
    elif value["identity"]["selection"].get("grid_id"):
        closure.need("grids", value["identity"]["selection"]["grid_id"],
                     "Original receiving-water source-plan grid")


def _water_designation(closure, key, value):
    if value.get("schema") != "upstate.water-designation/v1" or value.get("state") != "complete":
        raise ValueError("Retain the original completed water designation.")
    _tree(closure, "water-designations", key, value)
    closure.need("water-designation-specs", key, "Original immutable water-designation selection")
    spec = closure.read("water-designation-specs/" + key + ".json")
    if value.get("selection") != spec.get("selection") or value.get("source") != spec.get("source"):
        raise ValueError("The water designation differs from its original selection.")
    closure._source_refs(value.get("source", {}), "Original water-designation source")
    closure._source_refs(value.get("delivery_overlay", {}), "Prepared water-designation source edition")


def _spatial_review(closure, key, value):
    _project(closure, value)
    if digest(value) != key or value.get("schema") != "upstate.spatial-reviews/v1":
        raise ValueError("The saved map review changed its content identity.")
    groups = {"source": "sources", "grid": "grids", "run": "runs",
              "comparison": "comparisons", "delivery": "deliveries"}
    for binding in value.get("bindings", []):
        kind = groups.get(binding.get("group"))
        if kind:
            closure.need(kind, binding["owner_id"], "Original saved-map layer")
        elif binding.get("receiving_water_analysis_id"):
            closure.need("receiving-water-analyses", binding["receiving_water_analysis_id"],
                         "Original saved-map receiving-water layer")
        elif binding.get("receiving_water_plan_id"):
            closure.need("receiving-water-plans", binding["receiving_water_plan_id"],
                         "Original saved-map receiving-water source layer")
        else:
            raise ValueError("The saved review needs its original typed layer provider: " + str(binding.get("group")))
        closure._source_refs(binding, "Original saved-map source editions")
    if value.get("previous_review_id"):
        closure.need("spatial-reviews", value["previous_review_id"], "Original saved-map review history")
    origin = (value.get("atlas_review") or {}).get("origin")
    if origin is not None:
        if (origin.get("schema") != "upstate.atlas-review-origin/v1"
                or origin.get("project_id") != closure.workspace.project["id"]):
            raise ValueError("The saved atlas review belongs to another original project.")
        closure.need("deliveries", origin["delivery_id"], "Original reviewed atlas release")


def visit(closure, kind, key, value):
    """Handle only named original record kinds; return whether one was handled."""
    if kind not in LABELS:
        return False
    if value.get("id", key) != key:
        raise ValueError("The original release dependency changed its record identity.")
    if kind == "deliveries":
        _delivery(closure, key, value)
    elif kind == "scenario-decisions":
        _scenario_report(closure, key, value)
    elif kind == "analyses":
        _analysis(closure, key, value)
    elif kind == "economic-editions":
        _economic(closure, key, value)
    elif kind in ("receiving-water-plans", "receiving-water-analyses"):
        _receiving_water(closure, kind, key, value)
    elif kind == "water-designations":
        _water_designation(closure, key, value)
    elif kind == "water-designation-specs":
        if value.get("schema") != "upstate.water-designation-specs/v1" or digest(value) != key:
            raise ValueError("The original water-designation specification changed.")
        closure._source_refs(value, "Original water-designation source")
    elif kind == "spatial-reviews":
        _spatial_review(closure, key, value)
    elif kind == "spatial-exports":
        from .spatial_exports import _identity, FORMAT
        _project(closure, value)
        if (value.get("schema") != FORMAT or value.get("state") != "complete"
                or digest(_identity(value)) != key):
            raise ValueError("The completed saved-map export changed its original identity.")
        _tree(closure, kind, key, value)
        closure.need("spatial-reviews", value["review_id"], "Original printed-map review")
        _expect(closure, "spatial-reviews", value["review_id"], value["review_sha256"])
    return True


def receipt(closure):
    return [deepcopy(value) for _, value in sorted(closure.delivery_records.items())]


def verify_receipt(closure, records):
    if not isinstance(records, list):
        raise ValueError("The selected-study delivery history is unreadable.")
    for expected in records:
        key = identifier(expected["id"])
        actual = closure.delivery_records.get(key)
        if actual != expected:
            raise ValueError("The received completed map release lost its exact source binding or file inventory.")

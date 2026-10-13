"""Freeze one completed economic scenario into the existing FIELD12 source importer.

The operator first verifies the original edition and every retained member.
This adapter then binds exactly one native alternative to its original report,
reporting zone, cost input and physical support. It does not execute models,
combine scenarios, convert currency or create an implementation budget.
"""
from __future__ import annotations

from copy import deepcopy
import re
from collections.abc import Mapping

from model.implementation_sources import SourceImportError, import_selection

SCHEMA = "upstate.implementation-economic-source/v1"
MAPPING = {
    "rows": "/selected_scenarios", "id": "/run_id", "label": "/label",
    "source_title": "/title", "modeled_benefits": "/modeled_benefits",
}
HEX = re.compile(r"^[0-9a-f]{64}$")
LABELS = {
    "nitrogen_export": "Nitrogen export",
    "phosphorus_export": "Phosphorus export",
    "sediment_export": "Sediment export",
}


def _require(condition, message):
    if not condition:
        raise SourceImportError(message)


def _record(value, name):
    _require(isinstance(value, Mapping), name + " must be a retained JSON object.")
    return value


def _hex(value, name):
    _require(isinstance(value, str) and HEX.fullmatch(value),
             name + " must be the original SHA-256 identity.")
    return value


def _text(value, name):
    _require(isinstance(value, str) and bool(value.strip()),
             name + " must be a nonempty original identity.")
    return value


def _unique(rows, key, name):
    _require(isinstance(rows, list), name + " must be the original array.")
    indexed = {}
    for row in rows:
        _record(row, name + " row")
        value = _text(row.get(key), name + " " + key)
        _require(value not in indexed, name + " repeats " + value + ".")
        indexed[value] = row
    return indexed


def import_economic_selection(edition, report, manifest, native_report, binding):
    """Import the operator-verified edition as one frozen whole-scenario candidate.

    binding contains edition_id, run_id, report_id, report_sha256 and zone_id.
    The returned object is the existing implementation-source-import/v1 contract.
    Its full snapshot preserves input costs, scope and original source metadata.
    """
    edition = _record(edition, "Economic edition")
    report = _record(report, "Economic report")
    manifest = _record(manifest, "Economic manifest")
    native_report = _record(native_report, "Original native report")
    binding = _record(binding, "Economic selection")
    for field in ("edition_id", "run_id", "report_id", "report_sha256"):
        _hex(binding.get(field), field)
    zone_id = _text(binding.get("zone_id"), "zone_id")
    run_id = binding["run_id"]
    _require(edition.get("schema") == "upstate.economic-edition/v1",
             "Choose a completed native economic edition.")
    _require(edition.get("id") == binding["edition_id"],
             "The selected economic edition has another identity.")
    original = _record(edition.get("input"), "Original economic input")
    selection = _record(original.get("selection"), "Original decision selection")
    _require(all(original.get(key) == binding[key]
                 for key in ("report_id", "report_sha256", "zone_id")),
             "The handoff differs from the edition's original report, source hash or zone.")
    _require(edition.get("producer_report_id") == binding["report_id"]
             and edition.get("zone_id") == zone_id
             and edition.get("report_id") == report.get("id"),
             "The economic edition and completed report do not match.")
    _hex(report.get("id"), "Economic report ID")
    _require(report.get("selection") == selection,
             "The economic report differs from the frozen decision selection.")
    physical = _record(report.get("physical_source"), "Physical source")
    source = _record(physical.get("source"), "Native source descriptor")
    zone = _record(physical.get("zone"), "Native reporting zone")
    _require(source.get("sha256") == binding["report_sha256"]
             and zone.get("id") == zone_id,
             "The economic result names another physical source or zone.")
    _require(manifest.get("schema") == "upstate.decision-delivery/v1"
             and manifest.get("report_id") == report["id"],
             "The retained manifest belongs to another economic report.")
    members = _unique(manifest.get("members"), "path", "Edition members")
    native_member = _record(members.get("source-inputs/scenario-report.json"),
                            "Original native report member")
    _require(native_member.get("sha256") == binding["report_sha256"],
             "The retained native report body differs from the selected source hash.")
    _require(native_report.get("schema") == "upstate.scenario-decisions/v1"
             and native_report.get("id") == binding["report_id"],
             "The native source is not the selected completed physical report.")
    native_zones = _unique(native_report.get("zones"), "id", "Native zones")
    _require(zone_id in native_zones, "The selected zone is absent from the native report.")
    native_runs = _unique(native_report.get("runs"), "id", "Native runs")
    baseline = _record(report.get("baseline"), "Original baseline")
    baseline_id = _text(baseline.get("run_id"), "Baseline run ID")
    _require(native_report.get("baseline_run_id") == baseline_id,
             "The economic and native baseline identities differ.")
    _require(run_id != baseline_id and run_id in native_runs and baseline_id in native_runs,
             "Choose one modeled alternative from the original native cohort.")
    alternatives = _unique(report.get("alternatives"), "run_id", "Economic alternatives")
    _require(run_id in alternatives, "The selected run is absent from this economic edition.")
    alternative = alternatives[run_id]
    outputs = _record(alternative.get("outputs"), "Selected physical outputs")
    _require(bool(outputs), "The selected scenario has no retained physical outputs.")
    costs = _unique(selection.get("costs", []), "run_id", "Original cost inputs")
    original_cost = costs.get(run_id)
    cost = alternative.get("cost")
    _require((cost is None) == (original_cost is None),
             "The scenario's economic summary and original cost input differ.")
    if original_cost is not None:
        cost = _record(cost, "Calculated source cost")
        _require(cost.get("currency") == str(original_cost.get("currency")).strip().upper()
                 and all(cost.get(key) == original_cost.get(key)
                         for key in ("capital", "annual_operating", "horizon_years", "discount_rate")),
                 "The retained cost summary does not match its original input.")
        scope = original_cost.get("scope")
        if scope is not None:
            _record(scope, "Original cost scope")
            _require(scope.get("kind") in {"whole_scenario", "reporting_zone", "retained"},
                     "The original cost footprint kind is unavailable.")
            if scope["kind"] in {"reporting_zone", "retained"}:
                _require(scope.get("zone_id") == zone_id
                         and scope.get("producer_report_id") == binding["report_id"],
                         "The original implementation estimate belongs to another reporting zone.")

    # Full signed outputs, common-mask support, sensitivity and screening stay
    # intact. No scalar score or positive-only filtering replaces physical axes.
    units = _record(report.get("scope", {}), "Report scope").get("units", {})
    _record(units, "Physical units")
    benefits = []
    for metric, output in outputs.items():
        _record(output, "Physical output " + metric)
        benefits.append({
            "metric": metric, "label": LABELS.get(metric, metric),
            "units": units.get(metric, output.get("units")),
            "baseline_run_id": baseline_id, "scenario_run_id": run_id,
            "reporting_zone_id": zone_id,
            "quantity": "avoided_export",
            "sign_convention": "baseline minus selected scenario; negative values retained",
            "output": deepcopy(output),
        })
    row = {
        "run_id": run_id, "label": alternative.get("label") or run_id,
        "scenario_id": alternative.get("scenario_id"),
        "baseline_run_id": baseline_id,
        "reporting_area_ha": zone.get("area_ha"),
        "area_basis": "source_reporting_zone_not_intervention_footprint",
        "modeled_benefits": benefits,
        "original_alternative": deepcopy(alternative),
        "original_cost": deepcopy(original_cost),
        "source_cost_summary": deepcopy(cost),
        "implementation_interpretation": {
            "candidate_basis": "one complete jointly modeled scenario",
            "budget_basis": "source cost context; no automatic ledger entry",
            "area_basis": "reporting support only; intervention area not inferred",
        },
    }
    source_document = {
        "schema": SCHEMA,
        "title": (edition.get("title") or report.get("title") or edition["id"])
                 + " / " + row["label"],
        "binding": {key: deepcopy(binding[key]) for key in
                    ("edition_id", "run_id", "report_id", "report_sha256", "zone_id")},
        "edition": deepcopy(edition),
        "economic_report": deepcopy(report),
        "manifest": deepcopy(manifest),
        "native_source": {
            "descriptor": deepcopy(native_member),
            "schema": native_report["schema"], "id": native_report["id"],
            "project": deepcopy(native_report.get("project")),
            "grid_id": native_report.get("grid_id"),
            "selection": deepcopy(native_report.get("selection")),
            "implementation": deepcopy(native_report.get("implementation")),
            "baseline_run_id": baseline_id,
            "runs": deepcopy(native_report["runs"]),
            "outputs": deepcopy(native_report.get("outputs")),
            "zone": deepcopy(native_zones[zone_id]),
        },
        "selected_scenarios": [row],
    }
    source_ref = "economic-editions/" + edition["id"] + "/edition.json"
    imported = import_selection(
        source_document, edition["id"], "mapped_selection",
        source_ref=source_ref, selected_ids=[run_id], field_mapping=MAPPING,
    )
    candidate = imported["candidates"][0]
    candidate["reporting_area_ha"] = row["reporting_area_ha"]
    candidate["area_basis"] = row["area_basis"]
    imported["proposed_task_inputs"][0]["source_planning_context"] = {
        "economic_edition_id": edition["id"], "selected_run_id": run_id,
        "reporting_zone_id": zone_id,
        "original_cost": deepcopy(original_cost),
        "source_cost_summary": deepcopy(cost),
        "screening": deepcopy(alternative.get("decision")),
        "instruction": "Choose implementation tasks, methods and actual ledger costs separately.",
    }
    imported["selection"]["economic_binding"] = deepcopy(source_document["binding"])
    return imported

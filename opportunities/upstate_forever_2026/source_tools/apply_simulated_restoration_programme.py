"""Bind an explicitly simulated restoration programme to one actual native scenario.

Reuses the original footprint compiler, EconomicWorkbench and ImplementationStore.
No NDR/SDR model is run and no modeled pollutant quantity is recalculated.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
import re
import sys

APP = Path(__file__).resolve().parents[1]
for location in (str(APP), str(APP / "operator")):
    if location not in sys.path:
        sys.path.insert(0, location)

from model.common import held, describe_file, verify_file
from model.implementation import ImplementationStore, _atomic_bytes
from model.implementation_schema import canonical_bytes, document_digest, make_plan, validate_plan
from model.implementation_economics import import_economic_selection
from model.implementation_cost_review import preview_cost_review
from model import implementation_cost_review as cost_review_module
from model import decision_analysis, scenario_footprint
from economic_workbench import EconomicWorkbench

SCHEMA = "upstate.simulated-restoration-binding/v1"
EDITION = "simulated-restoration-programme-20261013-v1"
DEFAULT = "source_data/simulated_restoration_programme_20261013/programme.json"
CATALOGUE = "source_data/sc_conservation_costs_20261013/catalogue.json"
ACRE_M2 = Decimal("4046.8564224")
FOOT_M = Decimal("0.3048")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value, name, positive=False):
    require(not isinstance(value, bool), name + " must be numeric.")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError(name + " must be finite numeric text.")
    require(result.is_finite() and (result > 0 if positive else result >= 0),
            name + " must be positive." if positive else name + " must be nonnegative.")
    return result


def integer(value, name, positive=False):
    n = number(value, name, positive)
    require(n == n.to_integral_value() and n <= 9007199254740991,
            name + " must be a safe whole number.")
    return int(n)


def cents(value):
    result = int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    require(0 <= result <= 9007199254740991, "Cost exceeds the supported USD-cent range.")
    return result


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save(path, value):
    data = canonical_bytes(value) + b"\n"
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        require(path.read_bytes() == data, "The retained programme member differs: " + str(path))
    else:
        try:
            _atomic_bytes(path, data)
        except FileExistsError:
            require(path.read_bytes() == data, "A different programme member was concurrently saved.")


def pricing(programme, catalogue):
    """Price only authored design quantities; return integer cents and full sources."""
    require(programme.get("schema") == "upstate.simulated-restoration-programme/v1",
            "Choose the complete authored simulated programme.")
    require(catalogue.get("id") == programme["source_catalogue"]["id"]
            and catalogue.get("digest") == programme["source_catalogue"]["sha256"],
            "The selected source catalogue identity changed.")
    body = deepcopy(catalogue)
    body.pop("digest", None)
    require(document_digest(body) == programme["source_catalogue"]["canonical_content_sha256"],
            "The complete source catalogue content differs from the reviewed edition.")
    rows = {r["id"]: r for r in catalogue["rows"]}
    require(len(rows) == len(catalogue["rows"]), "The source catalogue repeats a row ID.")
    p, a, f = programme["planting"], programme["cost_assumptions"], programme["expected_footprint"]
    require(a["currency"] == "USD" and a["assistance_in_capital"] is False,
            "Use USD planning costs; unconfirmed assistance must remain separate.")
    require(programme.get("scenario_role") in {"riparian_restoration", "matched_control"},
            "Declare riparian restoration or matched control explicitly.")
    require(p["method"] in {"hand", "machine"}, "Choose hand or machine planting.")
    area = number(f["net_changed_hectares"], "Treatment hectares", True)
    acres = area * 10000 / ACRE_M2
    sx, sy = number(p["spacing_x_ft"], "Spacing X", True), number(p["spacing_y_ft"], "Spacing Y", True)
    planting_positions = int((area * 10000 / (sx * sy * FOOT_M * FOOT_M)).to_integral_value(rounding=ROUND_CEILING))
    density_factor = Decimal("144") / (sx * sy)
    price_factor = number(a["historical_price_factor"], "Historical price factor", True)
    contingency = number(a["contingency_fraction"], "Capital contingency fraction")
    require(contingency <= 1, "Review a capital contingency greater than 100% explicitly outside this programme.")
    horizon = integer(a["horizon_years"], "Horizon years", True)
    rate = number(a["real_discount_rate"], "Real discount rate")
    preparation = cents(acres * integer(a["site_preparation_cents_per_acre"], "Site preparation cents/acre"))
    layout = cents(acres * integer(a["design_layout_cents_per_acre"], "Design/layout cents/acre"))
    annual = cents(acres * integer(a["annual_maintenance_cents_per_acre"], "Annual maintenance cents/acre"))
    alternatives = {}
    selected_rows = []
    for method in ("hand", "machine"):
        row = rows[a[method + "_planting_row_id"]]
        require(row["price_kind"] == "historical_scenario_benchmark" and row["practice_code"] == "391"
                and row["quantity_unit"] == "acre" and row["pricing"]["type"] == "linear",
                "Select the original 391 per-acre planting benchmark.")
        planting = cents(acres * row["rate_cents"] * density_factor * price_factor)
        reserve = cents(Decimal(planting + preparation + layout) * contingency)
        lines = [
            {"id": "planting", "label": row["title"], "amount_minor": planting,
             "basis": "Historical FY25 benchmark, authored density/price factors",
             "catalogue_row_id": row["id"]},
            {"id": "site-preparation", "label": "Site preparation allowance", "amount_minor": preparation,
             "basis": "Authored simulated allowance; planting benchmark assumes a prepared site"},
            {"id": "design-layout", "label": "Design and layout allowance", "amount_minor": layout,
             "basis": "Authored simulated allowance"},
            {"id": "contingency", "label": "Capital contingency", "amount_minor": reserve,
             "basis": "Authored fraction of planting, preparation and layout"},
        ]
        alternatives[method] = {"capital_minor": sum(r["amount_minor"] for r in lines),
                                "annual_operating_minor": annual, "capital_lines": lines}
        selected_rows.append(deepcopy(row))
    species = p["species"]
    require(isinstance(species, list) and species, "Choose an explicit simulated species allocation.")
    require(len({s["catalogue_row_id"] for s in species}) == len(species), "Species rows must be unique.")
    weights = [integer(s["share_parts"], "Species share", True) for s in species]
    total_weight = sum(weights)
    counts = [planting_positions * w // total_weight for w in weights]
    remainder = planting_positions - sum(counts)
    order = sorted(range(len(species)), key=lambda i: (-(planting_positions * weights[i] % total_weight), i))
    for i in order[:remainder]:
        counts[i] += 1
    materials = []
    for spec, count in zip(species, counts):
        row = rows[spec["catalogue_row_id"]]
        require(row["price_kind"] == "material_component" and row["quantity_unit"] == "each"
                and row["pricing"]["type"] == "per_thousand", "Use actual SCFC seedling material rows.")
        ordered = max(count, integer(row["pricing"].get("minimum_quantity", 0), "Minimum order")) if count else 0
        materials.append({"catalogue_row_id": row["id"], "species": row["title"],
                          "planting_count": count, "order_count": ordered, "surplus_count": ordered - count,
                          "amount_minor": cents(Decimal(ordered) * row["rate_cents"] / row["pricing"]["divisor"])})
        selected_rows.append(deepcopy(row))
    assistance = rows[a["assistance_row_id"]]
    require(assistance["price_kind"] == "assistance_payment" and assistance["quantity_unit"] == "each"
            and assistance["pricing"]["type"] == "linear",
            "Use the selected actual per-seedling assistance row.")
    selected_rows.append(deepcopy(assistance))
    require(a.get("assistance_eligibility_confirmed") is False,
            "This demonstration does not admit or establish programme eligibility.")
    return {"schema": "upstate.simulated-restoration-pricing/v1",
            "currency": "USD", "treatment_hectares": str(area), "treatment_acres": str(acres),
            "planting_positions": planting_positions, "density_multiplier": str(density_factor),
            "historical_price_factor": str(price_factor), "selected_method": p["method"],
            "selected": deepcopy(alternatives[p["method"]]), "alternatives": alternatives,
            "material_comparison": {"lines": materials, "total_minor": sum(r["amount_minor"] for r in materials),
                "included_in_capital": False, "meaning": "Separate stock-only check; never added to the complete planting benchmark."},
            "assistance_comparison": {"catalogue_row_id": assistance["id"],
                "amount_minor": planting_positions * assistance["rate_cents"],
                "eligible_quantity": None, "eligibility_confirmed": False, "deducted_from_costs": False,
                "meaning": "Hypothetical schedule multiplication only; no FY2027 availability, eligibility, payment or stacking claim."},
            "horizon_years": horizon, "real_discount_rate": str(rate),
            "original_source_rows": selected_rows, "original_publishers": deepcopy(catalogue["sources"]),
            "unpriced_excluded_scopes": deepcopy(programme["programme"]["exclusions"]),
            "quantity_rounding": "Decimal arithmetic; USD totals half-up to cents. Planting positions ceil; species use largest remainder, ties in listed order.",
            "measurement_status": "Authored simulated implementation quantities, gated by actual native treatment footprint on binding."}


class _NativeEconomic(EconomicWorkbench):
    """Keep native build semantics; CLI returns local descriptors, no HTTP tickets."""
    def _with_files(self, workspace_key, record, root):
        return deepcopy(record)


class _Context:
    def __init__(self, workspace):
        self.workspace = workspace
    def ws(self, key):
        require(key == self.workspace.project["id"], "The native Workspace identity changed.")
        return self.workspace


def _footprint(workspace, run_id, programme, footprint_id):
    footprint = (scenario_footprint.get_footprint(workspace, footprint_id)
                 if footprint_id else scenario_footprint.preview_run(workspace, run_id))
    run = workspace.inspect_run(run_id)
    require(footprint["run_id"] == run_id and footprint["selection"] == run["selection"],
            "The retained footprint differs from the selected native run.")
    expected, summary = programme["expected_footprint"], footprint["summary"]
    grid = workspace.get_grid(run["selection"]["grid_id"])
    require(number(grid["grid"]["resolution_m"], "Native grid resolution") ==
            number(expected["resolution_m"], "Expected grid resolution"),
            "The original run is not on the authored programme resolution.")
    require(summary["net_changed_cells"] == integer(expected["net_changed_cells"], "Expected changed cells"),
            "Native changed cells differ; revise the programme against this actual run.")
    require(abs(number(summary["net_changed_hectares"], "Native treatment hectares") -
                number(expected["net_changed_hectares"], "Expected hectares")) <= Decimal("0.000000001"),
            "Native treatment hectares differ; reporting-zone area cannot substitute.")
    transitions = [r for r in footprint["transitions"] if r["from_code"] != r["to_code"] and r["cells"]]
    actual_transitions = sorted((r["from_code"], r["to_code"], r["cells"]) for r in transitions)
    expected_transitions = sorted((r["from_code"], r["to_code"], r["cells"]) for r in expected["changed_transitions"])
    require(actual_transitions == expected_transitions,
            "Native class codes, destinations or cell counts differ from the authored whole-scenario treatment.")
    require(len({r["to_code"] for r in transitions}) == 1,
            "Review a multi-target land-cover design separately.")
    require(sum(r["cells"] for r in transitions) == summary["net_changed_cells"],
            "The retained transition table does not equal its changed-cell summary.")
    return footprint


def prepare(workspace, programme, *, report_id, zone_id, run_id,
            catalogue=None, footprint_id=None, existing_selection=None):
    catalogue = catalogue or read(APP / CATALOGUE)
    priced = pricing(programme, catalogue)
    engine = _NativeEconomic(_Context(workspace), ValueError)
    report_path, inspected = engine._source(workspace, report_id)
    require(inspected.get("project", {}).get("id") == workspace.project["id"],
            "The retained native report belongs to another original project.")
    packet = decision_analysis.scenario_report_packet(report_path, zone_id)
    comparison = packet["comparisons"][0]
    alternative = next((r for r in comparison["alternatives"] if r["run_id"] == run_id), None)
    require(alternative is not None, "The selected native run is not an alternative in this actual report/zone.")
    footprint = _footprint(workspace, run_id, programme, footprint_id)
    require(all(alternative[k] == footprint["selection"][k] for k in ("grid_id", "profile_id", "scenario_id")),
            "The original physical report and footprint use different source selections.")
    source = inspected["source"]
    binding = {"project_id": workspace.project["id"], "report_id": report_id, "zone_id": zone_id,
               "run_id": run_id, "report_sha256": source["sha256"], "footprint_id": footprint["id"],
               "footprint_report": deepcopy(footprint["files"]["report"]),
               "scenario_lulc": deepcopy(footprint["files"]["scenario_lulc"]),
               "net_change_mask": deepcopy(footprint["files"]["net_change_mask"]),
               "grid_id": alternative["grid_id"], "profile_id": alternative["profile_id"],
               "scenario_id": alternative["scenario_id"]}
    scope = {"kind": "whole_scenario", "producer_report_id": report_id, "zone_id": zone_id,
             "run_id": run_id, "area_ha": float(priced["treatment_hectares"]),
             "footprint_id": footprint["id"], "scenario_role": programme["scenario_role"],
             "note": "Whole selected scenario treatment cells; reporting-zone area is not used as intervention extent."}
    cost = {"run_id": run_id, "currency": "USD",
            "capital": priced["selected"]["capital_minor"] / 100,
            "annual_operating": priced["selected"]["annual_operating_minor"] / 100,
            "horizon_years": priced["horizon_years"], "discount_rate": float(priced["real_discount_rate"]),
            "scope": scope,
            "source": {"title": "Explicit simulated restoration programme with retained SC/NRCS source rows",
                       "uri": "https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/opportunities/upstate_forever_2026/source_data/simulated_restoration_programme_20261013",
                       "as_of": "2026-10-13"},
            "note": "Planning simulation; FY25 benchmark plus explicitly authored allowances. Assistance and stock-only comparison are separate; no observed expenditure.",
            "programme": deepcopy(programme), "priced_basis": deepcopy(priced), "native_binding": binding}
    if existing_selection is not None:
        selection = deepcopy(existing_selection)
        require(selection.get("comparison_id") == comparison["id"],
                "The retained decision selection belongs to another native comparison.")
    else:
        selection = {"schema": decision_analysis.SELECTION_SCHEMA,
                     "title": programme["title"], "comparison_id": comparison["id"], "costs": [], "targets": {}, "notes": []}
    original_costs = selection.get("costs", [])
    require(len({r["run_id"] for r in original_costs}) == len(original_costs), "Original costs repeat a run.")
    selection["costs"] = [r for r in original_costs if r["run_id"] != run_id] + [cost]
    selection.setdefault("notes", []).append("Selected run receives the explicitly simulated restoration programme; original physical quantities remain unchanged.")
    payload = {"report_id": report_id, "report_sha256": source["sha256"], "zone_id": zone_id, "selection": selection}
    retained, _, _, economic = engine._input(workspace, payload)
    actual = next(r for r in economic["alternatives"] if r["run_id"] == run_id)
    # Original adapter may add economic display support fields; masses are exact.
    for metric, output in alternative["outputs"].items():
        for key in ("baseline", "alternative", "delta", "reduction", "reduction_percent"):
            require(actual["outputs"][metric].get(key) == output.get(key),
                    "The retained Economic adapter changed an original physical quantity.")
    identity = {"schema": SCHEMA, "edition": EDITION, "project_id": workspace.project["id"],
                "scenario_role": programme["scenario_role"],
                "original_scenario_definition": deepcopy(alternative.get("scenario_definition")),
                "binding": binding, "programme": programme, "catalogue_sha256": document_digest(catalogue),
                "economic_input": retained, "adapter_sha256": sha(__file__),
                "cost_review_adapter_sha256": sha(cost_review_module.__file__)}
    return {"schema": SCHEMA, "state": "preview", "operation_id": document_digest(identity),
            "identity": identity, "binding": binding, "programme": deepcopy(programme),
            "pricing": priced, "footprint": footprint, "economic_input": retained,
            "original_physical_outputs": deepcopy(alternative["outputs"]),
            "original_scenario_definition": deepcopy(alternative.get("scenario_definition")),
            "economic_preview": economic,
            "replaced_original_cost": next((deepcopy(r) for r in original_costs if r["run_id"] == run_id), None)}


def _economic_build(engine, workspace, directory, payload):
    attempts = directory / "economic-attempts"
    attempts.mkdir(exist_ok=True)
    # A completed exact original edition survives a later authored engine upgrade.
    for path in sorted(attempts.glob("*.json")):
        attempt = read(path)
        require(attempt["input"] == payload, "An existing economic attempt has different frozen inputs.")
        candidate = workspace.root / "economic-editions" / attempt["edition_id"] / "edition.json"
        if candidate.is_file():
            _, record, _ = engine._edition(workspace, attempt["edition_id"], full=True)
            require(record["input"] == payload, "A completed edition has different reviewed input.")
            return record
    import economic_workbench as module
    implementation = {"decision_analysis_sha256": sha(decision_analysis.__file__),
                      "decision_desk_sha256": sha(Path(decision_analysis.__file__).with_name("decision_desk.html")),
                      "economic_workbench_sha256": sha(module.__file__)}
    key = document_digest({"input": payload, "implementation": implementation})
    save(attempts / (key + ".json"), {"edition_id": key, "input": payload, "implementation": implementation})
    engine.invoke({"workspace": workspace.project["id"], "action": "economic.draft.save", "payload": payload})
    record = engine.invoke({"workspace": workspace.project["id"], "action": "economic.edition.build", "payload": payload})
    require(record["id"] == key, "The native Economic implementation uses another edition identity contract.")
    return record


def apply(workspace, programme, *, report_id, zone_id, run_id, expected_operation_id=None,
          catalogue=None, footprint_id=None, existing_selection=None, actor=""):
    preview = prepare(workspace, programme, report_id=report_id, zone_id=zone_id, run_id=run_id,
                      catalogue=catalogue, footprint_id=footprint_id, existing_selection=existing_selection)
    if expected_operation_id is not None:
        require(preview["operation_id"] == expected_operation_id, "The reviewed programme, footprint or source changed.")
    key = preview["operation_id"]
    directory = workspace.root / "implementation" / "restoration-programmes" / key
    with held(workspace.root / "implementation" / "restoration-programmes" / (key + ".lock")):
        receipt = directory / "result.json"
        engine = _NativeEconomic(_Context(workspace), ValueError)
        store = ImplementationStore(workspace)
        if receipt.is_file():
            result = read(receipt)
            require(result["operation_id"] == key and result["binding"] == preview["binding"], "The retained programme receipt differs.")
            for item in result["files"]:
                verify_file(workspace.root, item)
            engine._edition(workspace, result["economic_edition_id"], full=True)
            applied = store.get(result["plan_id"], result["applied_revision"])
            require(document_digest(applied) == result["applied_document_digest"], "The original applied revision changed.")
            result["latest_revision"] = store.get(result["plan_id"])["revision"]
            return result
        directory.mkdir(parents=True, exist_ok=True)
        # Exclude timestamped calculated preview from the immutable operation identity.
        save(directory / "identity.json", preview["identity"])
        for name, value in (("programme.json", programme), ("pricing.json", preview["pricing"]),
                            ("footprint.json", preview["footprint"]),
                            ("scenario-definition.json", preview["original_scenario_definition"]), ("economic-input.json", preview["economic_input"]),
                            ("selection.json", preview["economic_input"]["selection"]),
                            ("physical-outputs.json", preview["original_physical_outputs"])):
            save(directory / name, value)
        edition = _economic_build(engine, workspace, directory, preview["economic_input"])
        edition_root, edition, report = engine._edition(workspace, edition["id"], full=True)
        imported = import_economic_selection(edition, report, read(edition_root / "manifest.json"),
                    read(edition_root / "source-inputs" / "scenario-report.json"),
                    {**{k: preview["binding"][k] for k in ("run_id", "report_id", "report_sha256", "zone_id")},
                     "edition_id": edition["id"]})
        plan_path = directory / "implementation-seed.json"
        if plan_path.exists():
            plan = read(plan_path)
        else:
            plan = make_plan("sim-restoration-" + key[:32], programme["programme"]["title"],
                             programme["programme"]["start_date"],
                             description="Explicit simulated work and budget proposal tied to one completed original scenario; no fieldwork, commitments or expenditure claimed.")
            plan["source_links"] = imported["source_links"]
            plan["candidates"] = imported["candidates"]
            require(len(plan["candidates"]) == 1, "The original economic import did not yield one complete scenario.")
            candidate = plan["candidates"][0]
            candidate["area_ha"] = float(preview["pricing"]["treatment_hectares"])
            candidate["area_basis"] = "verified_scenario_intervention_footprint"
            candidate["intervention_area_basis"] = deepcopy(preview["binding"])
            source_id = plan["source_links"][0]["id"]
            definitions = [
                ("review", "Review original footprint, site suitability and access", "design", [], 2),
                ("design-layout", "Design and mark the simulated planting layout", "design", ["review"], 3),
                ("site-preparation", "Prepare the selected treatment cells", "establishment", ["design-layout"], 5),
                ("planting", "Plant the selected hardwood mix", "establishment", ["site-preparation"], 10),
                ("contingency", "Review contingency use; retain actual supporting evidence", "management", ["review"], 0),
                ("maintenance", "Initial inspection; schedule recurring maintenance separately", "maintenance", ["planting"], 1),
            ]
            for tid, title, phase, deps, duration in definitions:
                plan["tasks"].append({"id": tid, "title": title, "phase": phase, "assignee": "",
                    "candidate_id": candidate["id"], "status": "planned", "duration_days": integer(programme["programme"]["task_duration_days"].get(tid, duration), "Task duration"),
                    "progress_pct": 0, "depends_on": deps, "evidence_refs": [source_id],
                    "notes": "Authored simulated schedule; duration is an editable allowance, not completed work."})
            for row in preview["pricing"]["selected"]["capital_lines"]:
                plan["budget_lines"].append({"id": "budget-" + row["id"], "task_id": row["id"],
                    "kind": "budget", "label": row["label"], "amount_minor": row["amount_minor"],
                    "date": programme["programme"]["start_date"], "reference": key,
                    "original_source": {"source_link_id": source_id, "programme_operation_id": key,
                                        "basis": deepcopy(row), "classification": "authored_simulated_capital_forecast"}})
            plan["budget_lines"].append({"id": "budget-maintenance-year-1", "task_id": "maintenance",
                "kind": "budget", "label": "One year recurring maintenance allowance",
                "amount_minor": preview["pricing"]["selected"]["annual_operating_minor"],
                "date": programme["programme"]["start_date"], "reference": key,
                "original_source": {"source_link_id": source_id, "programme_operation_id": key,
                    "classification": "authored_simulated_annual_forecast", "years_in_ledger": 1,
                    "note": "One annual allowance only; not all lifetime operating costs or an actual expense."}})
            plan["simulated_restoration_programme"] = {"operation_id": key, "binding": preview["binding"],
                "programme": deepcopy(programme), "pricing": preview["pricing"],
                "capital_budget_minor": preview["pricing"]["selected"]["capital_minor"],
                "annual_forecast_minor": preview["pricing"]["selected"]["annual_operating_minor"],
                "native_physical_outputs": preview["original_physical_outputs"]}
            validate_plan(plan)
            save(plan_path, plan)
        committed = store.import_document(plan, expected_revision=0, actor=actor)
        applied = store.get(plan["id"], committed["applied_revision"])
        require(applied["simulated_restoration_programme"]["operation_id"] == key,
                "The imported native plan changed its original programme binding.")
        alternate_method = "machine" if programme["planting"]["method"] == "hand" else "hand"
        alternate_price = preview["pricing"]["alternatives"][alternate_method]
        source_reference = directory.relative_to(workspace.root).as_posix() + "/pricing.json#alternatives/" + alternate_method
        review = {
            "schema": "upstate.implementation-cost-review-selection/v1",
            "as_of": "2026-10-13",
            "row_decisions": {row["id"]: {
                "classification": "exclude",
                "reason": "Original simulated budget retained as context; it is not an actual expense."
            } for row in applied["budget_lines"]},
            "remaining_capital": {
                "amount_minor": alternate_price["capital_minor"],
                "source": {"title": "Explicit simulated " + alternate_method + "-planting option",
                           "uri": source_reference, "as_of": "2026-10-13"},
                "note": "Full remaining capital for the alternate planting method. No actual expense has occurred. Full source rows and both methods are retained in the original candidate's economic source snapshot."},
            "annual_operating": {
                "amount_minor": alternate_price["annual_operating_minor"],
                "source": {"title": "Authored constant annual restoration maintenance forecast",
                           "uri": source_reference, "as_of": "2026-10-13"},
                "note": programme["cost_assumptions"]["annual_forecast_basis"]},
            "financial_parameters": {"horizon_years": preview["pricing"]["horizon_years"],
                                     "discount_rate": float(preview["pricing"]["real_discount_rate"]),
                                     "reason": "Retain the original selected Economic horizon and real discount rate."},
            "scope": {"kind": "whole_scenario",
                      "note": "Same verified original scenario footprint and physical outputs; change only the explicit planting-method forecast."},
            "note": "Compare the authored " + programme["planting"]["method"] + " option with the authored " +
                    alternate_method + " option. This is a forecast-only simulation, with no actual expenses, commitments or assistance deduction.",
            "acknowledge_currency_change": False,
        }
        reviewed = preview_cost_review(applied, applied["candidates"][0]["id"], review)
        require(reviewed["can_apply"], "The maintained cost-review adapter rejected the authored forecast: " +
                json.dumps(reviewed.get("issues"), ensure_ascii=False))
        require(reviewed["summary"]["selected_actual_capital_minor"] == 0
                and reviewed["summary"]["selected_actual_operating_minor"] == 0
                and reviewed["summary"]["capital_minor"] == alternate_price["capital_minor"],
                "The reviewed forecast introduced an actual expense or changed the alternate capital.")
        save(directory / "cost-review.json", review)
        save(directory / "cost-review-preview.json", reviewed)
        result = {"schema": SCHEMA, "state": "complete", "operation_id": key, "binding": preview["binding"],
                  "economic_edition_id": edition["id"], "economic_report_id": edition["report_id"],
                  "plan_id": applied["id"], "candidate_id": applied["candidates"][0]["id"],
                  "applied_revision": applied["revision"], "applied_document_digest": document_digest(applied),
                  "latest_revision": store.get(applied["id"])["revision"],
                  "capital_budget_minor": preview["pricing"]["selected"]["capital_minor"],
                  "annual_forecast_minor": preview["pricing"]["selected"]["annual_operating_minor"],
                  "actual_expenditure_minor": 0, "committed_expenditure_minor": 0,
                  "ledger_totals_basis": "Original applied revision; later working revisions are not substituted",
                  "cost_review_path": (directory / "cost-review.json").relative_to(workspace.root).as_posix(),
                  "cost_review_operation_id": reviewed["operation_id"],
                  "alternate_planting_method": alternate_method,
                  "alternate_capital_minor": alternate_price["capital_minor"],
                  "capital_change_minor": alternate_price["capital_minor"] - preview["pricing"]["selected"]["capital_minor"],
                  "files": [describe_file(workspace.root, p) for p in sorted(directory.rglob("*.json"))],
                  "directory": directory.relative_to(workspace.root).as_posix(),
                  "meaning": "Native original Economic edition and saved candidate/work/budget plan; simulated forecasts, unchanged original physical results."}
        save(receipt, result)
        return result


def main(argv=None):
    from model.workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--programme", default=str(APP / DEFAULT))
    parser.add_argument("--report-id", required=True)
    parser.add_argument("--zone-id", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--footprint-id")
    parser.add_argument("--scenario-role", choices=("riparian_restoration", "matched_control"),
                        help="Explicit authored role; control receives a comparative planting benchmark, never riparian eligibility")
    parser.add_argument("--planting-method", choices=("hand", "machine"))
    parser.add_argument("--selection", help="Optional original Economic selection; other cohort costs and screening retained")
    parser.add_argument("--apply", action="store_true", help="Save original Economic edition and one native implementation plan")
    parser.add_argument("--expected-operation-id")
    parser.add_argument("--actor", default="")
    args = parser.parse_args(argv)
    options = dict(report_id=args.report_id, zone_id=args.zone_id, run_id=args.run_id,
                   footprint_id=args.footprint_id,
                   existing_selection=read(args.selection) if args.selection else None)
    ws, programme = Workspace(args.workspace), read(args.programme)
    if args.scenario_role:
        programme["scenario_role"] = args.scenario_role
    if args.planting_method:
        programme["planting"]["method"] = args.planting_method
    if args.apply:
        result = apply(ws, programme, **options, expected_operation_id=args.expected_operation_id, actor=args.actor)
    else:
        result = prepare(ws, programme, **options)
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

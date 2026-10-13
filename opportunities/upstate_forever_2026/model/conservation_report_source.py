"""Publish an original saved Conservation portfolio into the existing report composer.

This producer reads retained results and prepares an observed-context source
document. It creates neither a new portfolio nor a native model execution.
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path, PurePosixPath
import tempfile
import zipfile

from . import conservation, conservation_reporting, observed_context
from .common import (
    atomic_json, canonical, describe_file, digest, file_digest, held, identifier,
    now, read_json, verify_file,
)
from .reuse import copy_verified, destination_file

SCHEMA = "upstate.conservation-report-source/v1"
EDITION = "conservation-saved-plan-report/6"
DIRECTORY = "conservation-report-sources"


def _copy(value):
    return deepcopy(value)


def _title(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Supply a scientific report source title")
    return value.strip()


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Retained report members need canonical relative names")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or any(p in (".", "..") for p in path.parts)
            or path.as_posix() != value):
        raise ValueError("Report source members must remain inside their source")
    return path.as_posix()


def _identity_file(item):
    return {key: item[key] for key in ("path", "bytes", "sha256")}


def _same_file(actual, expected):
    return all(actual.get(key) == expected.get(key) for key in ("bytes", "sha256"))


def _text(value):
    if value is None:
        return "Not available"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    if isinstance(value, float):
        return format(value, ".10g")
    return str(value)


# These names are presentation labels only. Original keys, choices and full
# precision remain in the unchanged records attached to every report.
_LABELS = {
    "area_basis": "Area-budget footprint",
    "maximum_area_ha": "Maximum area (ha)",
    "minimum_area_ha": "Minimum reporting area (ha)",
    "maximum_cost": "Maximum supplied cost",
    "maximum_parcels": "Maximum planning-unit count",
    "minimum_coverage_fraction": "Minimum valid coverage fraction",
    "maximum_protected_fraction": "Maximum protected-source fraction",
    "minimum_source_water_fraction": "Minimum source-water overlap fraction",
    "require_high_quality_context": "Require high-quality-water context",
    "context_weights": "Geographic-context weight",
    "source_water_fraction": "Source-water overlap fraction",
    "unprotected_fraction": "Fraction outside selected protected-source footprint",
    "high_quality_context": "High-quality-water context indicator",
    "protected_lands": "Protected lands",
    "drinking_water": "Drinking-water source context",
    "high_quality_waters": "High-quality waters",
    "nitrogen_export": "Nitrogen export",
    "phosphorus_export": "Phosphorus export",
    "sediment_export": "Sediment export",
    "source_uri": "Source URI",
    "huc12": "HUC12",
    "HUC12": "HUC12",
}
_CHOICES = {
    "whole_units": "Complete original planning units",
    "reporting": "Intersection with the reporting boundary",
    "source_context": "Original geographic source context",
    "native_model": "Native model quantities",
    "manual": "Saved selection of original unit IDs",
    "source-context": "Original geographic source context",
    "current-export": "Baseline modeled export",
    "avoided-conversion": "Avoided conversion",
    "matched-restoration": "Restoration within matched model families",
    "matched-disturbance": "Disturbance within matched model families",
    "published-method": "Published method",
    "source-attribute": "Original source attribute",
    "source_water": "Source-water overlap",
    "score_per_ha": "Score per reporting hectare",
}


def _label(value):
    """Name schema fields without changing arbitrary user text or identifiers."""
    if not isinstance(value, str):
        return _text(value)
    return _LABELS.get(value, value.replace("_", " ").replace(".", " / ").capitalize())


def _choice(value):
    return _CHOICES.get(value, value) if isinstance(value, str) else value


def _area(value):
    """Display hectares to six decimals, keeping nonzero subprecision values visible."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return _text(value)
    if 0 < value < 0.000001:
        return "Less than 0.000001"
    if -0.000001 < value < 0:
        return "Between -0.000001 and 0"
    return format(value, ",.6f").rstrip("0").rstrip(".") if value else "0"


def _rule_value(name, value):
    if name.endswith("_area_ha"):
        return _area(value)
    return _choice(value) if name in {"basis", "area_basis", "kind"} else value


def _table(columns, rows):
    return {"kind": "table", "columns": list(columns),
            "rows": [[_text(cell) for cell in row] for row in rows]}


def _links(items):
    return {"kind": "links", "items": [
        {"title": title, "path": _relative(path)} for title, path in items
    ]}


def _source_entries(workspace, state):
    """Resolve every selected planning/criterion source to its actual original."""
    references = conservation_reporting.source_register(state)
    sources = {}
    for reference in references:
        collection = identifier(reference.get("source_collection_id"))
        source_id = reference.get("source_id")
        if not isinstance(source_id, str) or not source_id:
            raise ValueError("A retained planning source lacks its actual source ID")
        key = (collection, source_id)
        if key not in sources:
            unused, entry = workspace.source_file(collection, source_id)
            sources[key] = {"source_collection_id": collection, "source_id": source_id,
                            "entry": _copy(entry), "references": []}
        resolved = sources[key]
        if not _same_file(resolved["entry"]["body"], reference["body"]):
            raise ValueError("A selected original source body differs from the saved study")
        # source_file verifies the immutable collection ID and all original
        # companions. Older study snapshots bind that collection and body but do
        # not duplicate companion descriptors; retain the actual source edition.
        expected = reference.get("companions")
        if expected:
            actual = resolved["entry"].get("companions", [])
            def member_keys(values):
                return sorted((item.get("view_path", item.get("filename")),
                               item["bytes"], item["sha256"]) for item in values)
            if member_keys(actual) != member_keys(expected):
                raise ValueError("Original source companions differ from the saved study")
        resolved["references"].append(_copy(reference))
    return [sources[key] for key in sorted(sources)]


def _retained_rows(workspace, state, plan):
    portfolio = read_json(verify_file(workspace.root, plan["files"]["portfolio"]))
    if (portfolio.get("schema") != "upstate.conservation-portfolio/v1"
            or portfolio.get("id") != plan["id"]
            or portfolio.get("study_id") != state["id"]
            or portfolio.get("selected_ids") != plan["selected_ids"]
            or portfolio.get("summary") != plan["summary"]):
        raise ValueError("The original portfolio artifact and saved plan differ")
    rows = portfolio.get("selected_candidates")
    if (not isinstance(rows, list) or [row.get("id") for row in rows] != plan["selected_ids"]
            or len(set(plan["selected_ids"])) != len(rows)):
        raise ValueError("The original selected candidate rows differ from the saved plan")
    return rows


def _retained_optimization(workspace, state, plan):
    """Reopen the original saved decision analysis without solving it again."""
    reference = plan["selection"].get("optimization")
    if reference is None:
        return None
    from . import conservation_optimization
    if (not isinstance(reference, dict)
            or reference.get("schema") != conservation_optimization.REFERENCE_SCHEMA
            or reference.get("study_id") != state["id"]):
        raise ValueError("Retain the original saved optimization reference")
    retained = conservation_optimization.get_analysis(
        workspace, state["id"], identifier(reference.get("analysis_id")))
    analysis = retained["analysis"]
    selected = analysis.get("selected_ids")
    if (retained["state"]["files"] != reference.get("files")
            or analysis.get("request") != reference.get("request")
            or analysis.get("engine") != reference.get("engine")
            or analysis.get("normalization") != reference.get("normalization")
            or analysis.get("optimization") != reference.get("solver_result")
            or analysis.get("input", {}).get("study_id") != state["id"]
            or not isinstance(selected, list)
            or selected != reference.get("selected_ids")
            or len(selected) != len(set(selected))
            or set(selected) != set(plan["selected_ids"])):
        raise ValueError("The original optimization and selected portfolio differ")
    return retained



def _joint_comparison_blocks(analysis, units):
    """Render retained Cartesian results without rescoring or rerunning a model."""
    joint = analysis.get("joint_comparison")
    if joint is None:
        return []
    cells = {row["id"]: row for row in joint["cells"]}
    name = lambda key: cells[key]["case"] + " / " + cells[key]["preference"]
    blocks = [
        joint["interpretation"],
        _table(["Included native cases", "Included preferences", "Evaluated combinations", "New maintained-solver calls"],
               [[joint["case_count"], joint["preference_count"], joint["cell_count"], joint["new_solver_calls"]]]),
        _table(["Case / preference", "Normalized weights", "Eligible units", "Selected original units",
                "Original solver objective", "Solver status", "Original upper bound", "Best known feasible score"],
               [[name(cell["id"]), cell["weights"], cell["eligible_count"], units(cell["selected_ids"]),
                 cell["optimization"]["objective_score"], cell["optimization"].get("status"),
                 cell["optimization"].get("upper_bound"), cell["best_known_feasible_score"]]
                for cell in joint["cells"]]),
        joint["regret"],
        "The original selected portfolio remains selected. These are the distinct portfolios found "
        "in the declared cells, not an enumeration of every feasible or globally robust portfolio. "
        "A portfolio unsupported in any cell has no full-grid loss bound; eligible-only values are "
        "not substituted. Different weight choices define different dimensionless objectives.",
        _table(["Portfolio", "Original units", "Supported combinations", "Maximum loss lower bound",
                "Maximum loss upper bound"],
               [[portfolio["id"] + (" (original selection)" if portfolio["id"] == joint["selected_portfolio_id"] else ""),
                 units(portfolio["selected_ids"]), str(portfolio["eligible_cells"]) + " / " + str(portfolio["cell_count"]),
                 portfolio["maximum_regret_lower_bound"], portfolio["maximum_regret_upper_bound"]]
                for portfolio in joint["portfolios"]]),
    ]
    for portfolio in joint["portfolios"]:
        blocks += [
            portfolio["id"] + ": " + units(portfolio["selected_ids"]) + ". Found in: "
            + "; ".join(name(key) for key in portfolio["origin_cells"]),
            _table(["Case / preference", "Cross-evaluated score", "Loss lower bound", "Loss upper bound",
                    "Support and original exclusions"],
                   [[name(value["cell_id"]), value["objective_score"], value["regret_lower_bound"],
                     value["regret_upper_bound"],
                     "Complete" if value["eligible"] else "; ".join(
                         units([item["feature_id"]]) + ": " + "; ".join(item["reasons"])
                         for item in value["unavailable_units"])]
                    for value in portfolio["evaluations"]]),
        ]
    blocks += [
        joint["physical_scope"],
        "The three complete CSVs retain every cell, every cross-evaluated portfolio, and every "
        "candidate's rank, weighted contributions, selection or exclusion. Original physical "
        "quantities, units, native run/family definitions and source footprints remain in the "
        "unchanged analysis and original case sections.",
        _links([("Every joint cell and solver result", "optimization/joint-cells.csv"),
                ("Every portfolio across every cell", "optimization/joint-portfolios.csv"),
                ("Every candidate and original exclusion", "optimization/joint-candidates.csv")]),
    ]
    return blocks

def _optimization_section(retained):
    """Explain the retained decision in the original structured report format."""
    analysis = retained["analysis"]
    request = analysis["request"]
    objective = request["objective"]
    candidates = {row["feature_id"]: row for row in analysis["candidates"]}
    selected = [candidates[key] for key in analysis["selected_ids"]]
    criteria = {row["id"]: row for row in objective.get("criteria", [])}
    labels = {axis: criteria.get(axis, {}).get("label", axis.replace("_", " "))
              for axis in request["axes"]}

    def units(keys):
        return "; ".join((candidates[key].get("label") or key) + " [" + key + "]"
                         for key in keys) or "None"

    def rank_range(value):
        if not value or value.get("minimum_rank") is None:
            return "Not available"
        return str(value["minimum_rank"]) + " to " + str(value["maximum_rank"])

    def frequency(value, selected_key, total_key):
        if not value:
            return "Not compared"
        return str(value[selected_key]) + " / " + str(value[total_key])

    rows = [
        ["Original analysis ID", analysis["id"]],
        ["Objective kind", _choice(objective.get("kind"))],
        ["Objective basis", _choice(objective.get("basis"))],
        ["Objective scope", analysis["methods"].get("objective_scope")],
        ["Original candidate count", analysis["counts"].get("inventory")],
        ["Eligible candidate count", analysis["counts"].get("eligible")],
        ["Selected candidate count", analysis["counts"].get("selected")],
        ["Normalized objective score", analysis["selection"].get("objective_score")],
        ["Original solver module", analysis["engine"].get("module")],
        ["Original solver SHA-256", analysis["engine"].get("sha256")],
    ]
    for group, values in (("Constraint", request.get("constraints", {})),
                          ("Solver result", analysis.get("optimization", {}))):
        rows.extend([group + ": " + _label(name), _rule_value(name, value)] for name, value in values.items()
                    if not isinstance(value, (dict, list)))
    blocks = [
        "This portfolio was selected by its retained optimization analysis and then stored "
        "through the original manual-ID plan interface. The storage mode does not replace "
        "its original objective, solver or constraints.",
        _table(["Decision record", "Retained value"], rows),
        _text(analysis["methods"].get("optimality_scope")),
        _text(analysis["methods"].get("selected_result")),
    ]
    meanings = {
        "source-context": "Original geographic overlap or designation context; not pollutant removal",
        "current-export": "Baseline modeled export; not an intervention benefit",
        "restoration": "Baseline minus the retained alternative on common valid native support",
        "avoided-conversion": "Retained disturbance alternative minus baseline on common valid native support",
        "matched-restoration": "Own-family baseline minus treatment on one common footprint across all declared families",
        "matched-disturbance": "Own-family treatment minus baseline on one common footprint across all declared families",
        "published-method": "Original method/category priority points with their retained prerequisites",
        "source-attribute": "Unchanged numeric source attribute with analyst-declared unit/reference; no inferred connectivity or unit conversion",
    }
    definitions, source_rows, weighted = [], [], []
    for axis in request["axes"]:
        criterion = criteria.get(axis, {})
        kind = criterion.get("kind", objective["kind"])
        first = next((row for row in candidates.values() if axis in row["objective_units"]), None)
        unit = first["objective_units"][axis] if first else criterion.get("unit")
        basis = criterion.get("basis", objective.get("basis", "total"))
        direction = criterion.get("direction", "maximize")
        definitions.append([labels[axis] + " [" + axis + "]",
                            criterion.get("field") or criterion.get("axis") or axis,
                            unit, basis, direction])
        description = meanings.get(kind, kind)
        references = []
        if criterion.get("reference"):
            references.append(criterion["reference"])
        source = criterion.get("source") or {}
        if source.get("source_id"):
            references.append("Original source " + source["source_id"])
        if source.get("source_collection_id"):
            references.append("Collection " + source["source_collection_id"])
        baseline = source.get("baseline_run_id")
        if baseline:
            references.append("Baseline " + baseline)
        family_id = criterion.get("family_id", objective.get("family_id"))
        if family_id:
            references.append("Matched family " + family_id)
        alternative = criterion.get("scenario_run_id", objective.get("scenario_run_id")) or source.get("alternative_run_id")
        if alternative:
            references.append("Alternative " + alternative)
        method = criterion.get("published_method") or analysis["request"].get("published_method") or {}
        if method:
            references += [str(method[name]) for name in ("method_id", "category_id", "reference", "source_uri")
                           if method.get(name)]
        source_rows.append([labels[axis], description,
                            "; ".join(references) or "Original study/source bindings in the attached analysis"])
        weighted.append([labels[axis], request["weights"].get(axis, 0),
                         analysis["normalization"]["scales"].get(axis),
                         "Negated normalized value" if direction == "minimize" else "Signed normalized value"])
    blocks += [
        "The following criteria are the scientist's explicit decision choices. Each keeps its "
        "own units and original source meaning; only their normalized weighted contributions "
        "are combined into a dimensionless score.",
        _table(["Criterion / ID", "Original axis or field", "Unit", "Quantity basis", "Direction"], definitions),
        _table(["Criterion", "Source meaning", "Original reference"], source_rows),
        _table(["Criterion", "Normalized weight", "Fixed absolute scale", "Score direction"], weighted),
        "A supported value is divided by its criterion's maximum absolute scale. Minimize negates "
        "that normalized value. Weights total one and weighted contributions sum to the score. "
        "A supported zero has zero contribution; unavailable positive-weight support excludes a "
        "candidate. Missing values are not credited as zeros.",
        ("Scales are fixed across the selected case and every distinct enabled native comparison "
         "case, then reused across all named preference profiles. Adding a case defines a new analysis."
         if analysis["normalization"].get("fixed_across_scenario_cases") else
         "Scales are fixed across the selected source-qualified candidate universe and reused for "
         "the preference comparisons."),
    ]
    preference = analysis["stability"]
    preference_compared = bool(preference["enabled"] and len(preference["profiles"]) > 1)
    preference_rows = []
    for profile in preference["profiles"]:
        weights = "; ".join(labels.get(key, key) + ": " + _text(value)
                            for key, value in profile["weights"].items() if value > 0)
        preference_rows.append([profile["name"], weights, profile["eligible_count"],
                                units(profile["selected_ids"]), profile["optimization"]["objective_score"]])
    blocks += [
        ("Preference comparison changes weights within the selected case; it does not vary the "
         "native inputs. The rows below retain each explicit profile's feasible selection."
         if preference_compared else
         "No distinct preference comparison is enabled. The following row retains the selected "
         "weights and their feasible selection."),
        _table(["Preference", "Positive normalized weights", "Eligible units", "Selected original units", "Objective score"],
               preference_rows),
        _text(preference.get("interpretation")),
    ]
    scenario = analysis.get("scenario_stability") or {}
    compared = bool(scenario.get("enabled") and len(scenario.get("cases", [])) > 1)
    if compared:
        case_rows = []
        for case in scenario["cases"]:
            mappings = [labels.get(key, key) + ": alternative " + value
                        for key, value in case.get("scenario_run_ids", {}).items()]
            mappings += [labels.get(key, key) + ": matched family " + value
                         for key, value in case.get("family_ids", {}).items()]
            mapping = "; ".join(mappings) or "No paired criterion"
            case_rows.append([case["name"], mapping, case["eligible_count"],
                              units(case["selected_ids"]), case["optimization"]["objective_score"]])
        blocks += [
            "Native-case comparisons use the explicitly mapped original alternatives or matched "
            "baseline/treatment families at the same selected weights and resource limits. A matched "
            "family keeps its own baseline; fixed-baseline criteria keep the original study baseline. "
            "Context and source attributes retain their original meaning.",
            _table(["Retained case", "Criterion / original alternative", "Eligible units", "Selected original units", "Objective score"],
                   case_rows),
            _text(scenario.get("interpretation")),
            "Fixed-baseline criteria retain their original pairwise support. Matched-family criteria "
            "use one shared footprint per pollutant across every declared family, with the same "
            "parameter profile inside each pair. The full family definitions and support areas below "
            "describe their scientific setting. These case comparisons are separate from named "
            "decision-weight preferences and do not assign a joint probability.",
        ]
    else:
        blocks.append("No distinct native-case comparison is enabled in this decision. The "
                      "selected case alone does not establish scenario robustness.")
    stability_rows, contribution_rows = [], []
    for row in selected:
        name = (row.get("label") or row["feature_id"]) + " [" + row["feature_id"] + "]"
        pref = row["preference_stability"] if preference_compared else None
        case = row.get("scenario_stability") if compared else None
        stability_rows.append([name, row["rank"], row["score"],
                               ("Selected " + frequency(pref, "selected_profiles", "profile_count")
                                + "; eligible " + frequency(pref, "eligible_profiles", "profile_count")
                                + "; rank " + rank_range(pref)) if pref else "Not compared",
                               ("Selected " + frequency(case, "selected_cases", "case_count")
                                + "; eligible " + frequency(case, "eligible_cases", "case_count")
                                + "; rank " + rank_range(case))
                               if case else "Not compared"])
        for axis in request["axes"]:
            support = row["axis_support"][axis]
            contribution = row.get("score_contributions", {}).get(axis)
            if "score_contributions" not in row and support["eligible_support"]:
                contribution = request["weights"][axis] * row["normalized_metrics"][axis]
            detail = str(support["availability"])
            if support.get("coverage_fraction") is not None:
                detail += "; coverage " + _text(support["coverage_fraction"])
            if support.get("valid_area_ha") is not None:
                detail += "; valid area " + _area(support["valid_area_ha"]) + " ha"
            if support.get("availability_reason"):
                detail += "; " + support["availability_reason"]
            if support.get("profile_changed"):
                detail += "; parameter profile changed"
            contribution_rows.append([name, labels[axis],
                                      _text(row["objective_values"][axis]) + " " + row["objective_units"][axis],
                                      contribution, detail])
    blocks += [
        "The following detail is limited to the land selected in this saved portfolio. All "
        "unselected candidates and case-specific values remain in the unchanged attached analysis.",
        _table(["Selected original unit", "Rank", "Score", "Preference selection / eligibility / rank",
                "Case selection / eligibility / rank"], stability_rows),
        _table(["Selected original unit", "Criterion", "Original value and unit",
                "Weighted score contribution", "Source support"], contribution_rows),
        "Selection frequencies describe only the included preferences and cases; they are not "
        "probabilities or calibrated confidence levels. Original quantities, points and hectares "
        "remain separate. Additive candidate scores and density sums are not basin totals, and "
        "overlapping source units can repeat support. The authoritative saved plan recomputes "
        "physical quantities on the selected reporting union.",
        "The full normalized candidate table, original source references, all declared preference "
        "profiles, native-case quantities and solver details are attached unchanged.",
        _links([
            ("Original complete optimization analysis", "optimization/analysis.json"),
            ("Original full optimization candidate table", "optimization/candidates.csv"),
            ("Original optimization report", "optimization/index.html"),
        ]),
    ]
    blocks += _joint_comparison_blocks(analysis, units)
    return ["Original saved optimization", blocks]

def _matched_family_sections(state, plan):
    """Explain original matched quantities without recomputing model results."""
    families = state["selection"]["spec"].get("matched_families", [])
    if not families:
        return []
    support = state.get("matched_family_support") or {}
    sections = [["Matched native family definitions", [
        "Each treatment is compared with its own completed baseline under the same retained "
        "parameter profile and grid. The analyst's original scientific setting identifies the "
        "family. Each pollutant uses one common footprint across all declared families. Original "
        "study eligibility rules continue to apply before the explicit decision criteria.",
        _table(["Family", "Original baseline", "Original treatment", "Scientific setting", "Reference"],
               [[row["label"] + " [" + row["id"] + "]", row["baseline_run_id"],
                 row["alternative_run_id"], row["reason"], row.get("reference")]
                for row in families]),
    ]]]
    coverage = []
    for name, item in support.get("metrics", {}).items():
        mask = item.get("mask") or {}
        coverage.append([_label(name), item.get("state"), item.get("unit"),
                         _area(item.get("grid_valid_area_ha")), _area(item.get("grid_structural_area_ha")),
                         _area(item.get("grid_covered_area_ha")), item.get("reason"),
                         ", ".join(item.get("missing_run_ids", [])), mask.get("sha256")])
    sections.append(["Common coverage across declared model families", [
        "The following areas describe the complete common grid, before clipping to planning units. "
        "Code 1 identifies cells valid in every selected run; code 2 identifies structural stream "
        "omission in every selected run; code 0 excludes other cells, including mixed valid/structural "
        "support. A pollutant missing in any selected run is unavailable for the family comparison. "
        "Structural-only support has no modeled mass. Missing and structural areas remain separate.",
        _table(["Quantity", "Availability", "Physical unit", "Valid grid area (ha)",
                "Structural grid area (ha)", "Supported grid area (ha)", "Reason",
                "Runs missing the output", "Original support raster SHA-256"], coverage),
        "Original support selection: " + _text(support.get("id")),
    ]])
    pollutants = plan.get("summary", {}).get("pollutants", {})
    for family in families:
        values = []
        for name, metric in pollutants.items():
            item = metric.get("matched_families", {}).get(family["id"])
            if item is None:
                continue
            values.append([_label(name), item.get("unit"), item.get("common_baseline"),
                           item.get("common_alternative"), item.get("reduction"), item.get("delta"),
                           item.get("common_coverage_fraction"), _area(item.get("common_valid_area_ha")),
                           _area(item.get("common_structural_stream_area_ha")), _area(item.get("missing_area_ha")),
                           item.get("comparison_availability"), item.get("comparison_availability_reason")])
        sections.append(["Selected-union matched quantities: " + family["label"], [
            "These values are recomputed on the saved portfolio's original reporting union, "
            "with overlapping units counted once. Reduction is baseline minus treatment; increase "
            "is treatment minus baseline. Negative effects retain their sign. Model routing outside "
            "the selected footprint remains part of each complete original model run.",
            _table(["Quantity", "Unit", "Own baseline", "Treatment", "Reduction", "Increase",
                    "Coverage fraction", "Valid area (ha)", "Structural area (ha)",
                    "Missing area (ha)", "Availability", "Reason"], values),
        ]])
    return sections


def _sections(state, plan, rows, packet, sources, optimization=None):
    spec, summary = state["selection"]["spec"], plan["summary"]
    context = state["mode"] == "source_context"
    from pyproj import CRS
    analysis_crs = CRS.from_user_input(plan["analysis_crs"]).to_string()
    normalization = state.get("normalization", {})
    decision_rows = [
        ["Saved-plan selection mode", _choice(plan.get("algorithm"))],
        ["Ordering objective", _choice(plan["selection"].get("objective"))],
        ["Include ineligible units", plan["selection"].get("include_ineligible")],
    ]
    for group, values in (("Limit", plan["selection"].get("limits", {})),
                          ("Eligibility", spec.get("rules", {})),
                          ("Score", spec.get("score", {}))):
        for name, value in values.items():
            if isinstance(value, dict):
                decision_rows.extend([group + ": " + _label(name) + " / " + _label(key),
                                      _rule_value(key, item)]
                                     for key, item in value.items()
                                     if not isinstance(item, (dict, list)))
            elif not isinstance(value, list):
                decision_rows.append([group + ": " + _label(name), _rule_value(name, value)])
    for name in ("basis", "scale", "title", "unit", "maximum", "formula",
                 "normalization_population", "source_uri"):
        if name in normalization:
            decision_rows.append(["Normalization: " + _label(name), _rule_value(name, normalization[name])])
    sections = [["Saved conservation portfolio", [
        "This report presents the original completed Conservation study and selected portfolio. "
        "All tables use retained results; the attached decision packet contains the full candidate "
        "inventory, editable geodata, original scoring details and source register.",
        _table(["Selection", "Retained value"], [
            ["Portfolio", plan["title"]], ["Original portfolio ID", plan["id"]],
            ["Original study", state["title"]], ["Original study ID", state["id"]],
            ["Purpose", state["purpose"]], ["Planning units", state["planning_unit_label"]],
            ["Unit type", _label(state["unit_type"])], ["Study mode", _choice(state["mode"])],
            ["Analysis CRS", analysis_crs],
            ["Selected original units", len(plan["selected_ids"])],
            ["Decision packet ID", packet["id"]],
        ]),
        ("The saved source-context study measures geographic relationships to the selected original "
         "boundaries. Nitrogen, phosphorus and sediment values are unavailable in this study because "
         "it has no bound native modeled case."
         if context else
         "Native quantities describe the selected footprint within each complete original modeled case. "
         "A whole-scenario difference over that footprint is not automatically the effect of treating "
         "only those units. The selected baseline, alternatives and their execution provenance remain explicit."),
    ]]]
    areas = [
        ["Selected reporting footprint", summary.get("union_area_ha"), "ha"],
        ["Full original selected-unit union", summary.get("whole_unit_union_area_ha"), "ha"],
        ["Reporting overlap counted once", summary.get("overlap_area_ha"), "ha"],
        ["Full-unit overlap counted once", summary.get("whole_unit_overlap_area_ha"), "ha"],
        ["Selected protected-source intersection", summary.get("protected_area_ha"), "ha"],
        ["Selected source-water intersection", summary.get("source_water_area_ha"), "ha"],
        ["Selected high-quality-water area intersection", summary.get("high_quality_overlap_area_ha"), "ha"],
        ["Selected high-quality-water line contact", summary.get("high_quality_contact_length_m"), "m"],
        ["Budget footprint", summary.get("budget_area_ha"), "ha"],
        ["Budget footprint basis", _choice(summary.get("area_budget_basis")), "declared choice"],
        ["Supplied whole-unit cost", summary.get("cost_total"), summary.get("currency")],
        ["Known supplied-cost subtotal", summary.get("known_cost_subtotal"), summary.get("currency")],
        ["Units without supplied costs", summary.get("units_without_cost"), "units"],
    ]
    sections.append(["Selected land and geographic context", [
        "Area totals use the original selected union in its saved analysis CRS. Overlapping planning "
        "units and overlapping context polygons are counted once in the union. Whole original units "
        "and their intersection with the reporting boundary remain separate quantities.",
        _table(["Retained quantity", "Value", "Unit or basis"],
               [[name, _area(value) if unit == "ha" else value, unit]
                for name, value, unit in areas]),
        "Area displays use up to six decimal places in hectares. A nonzero value smaller than "
        "0.000001 ha is shown as an inequality; zero and unavailable values remain distinct. "
        "This is display precision, not a statement of measurement accuracy. The attached original "
        "portfolio and analysis retain every full-precision quantity.",
        "The source-water and designated-water relations below retain their actual declared selection. "
        "Geographic overlap, published protection footprints and an upstream connectivity analysis have "
        "different meanings. A blank source quantity remains unavailable.",
    ]])
    relations = []
    for name, choice in spec.get("contexts", {}).items():
        relations.append([_label(name), choice.get("source_id"), _choice(choice.get("relation")),
                          choice.get("meaning"), choice.get("reference")])
    if relations:
        sections.append(["Declared geographic relations", [
            _table(["Context", "Original source", "Relation", "Meaning", "Reference"], relations),
        ]])
    sections.append(["Saved decision rules", [
        _table(["Rule", "Saved value"], decision_rows),
        _text(plan.get("algorithm_detail")),
        "The complete original eligibility lists, scoring selection, normalization and "
        "criterion table remain in records/study-inspection.json and the decision packet.",
        "Costs are the supplied amounts for complete original units. An unknown cost remains unknown; "
        "the known subtotal is shown separately from an unavailable total. Original score inputs, "
        "normalization, weights, method prerequisites and missing evidence remain in the attached records.",
    ]])
    if optimization is not None:
        sections.append(_optimization_section(optimization))
    sections.append(["Complete selected planning-unit inventory", [
        _table(["Original unit ID", "Label", "Whole area (ha)", "Reporting area (ha)",
                "Source-water area (ha)"], [
            [row["id"], row.get("label"), _area(row.get("area_ha")), _area(row.get("reporting_area_ha")),
             _area(row.get("source_water_area_ha"))] for row in rows]),
        _table(["Original unit ID", "Eligible", "Retained score", "Score units",
                "Supplied cost", "Currency"], [
            [row["id"], row.get("eligible"), row.get("score"), row.get("score_unit") or (
                 "Dimensionless context score" if spec.get("score", {}).get("basis") == "context" else None),
             row.get("cost"), row.get("currency")] for row in rows]),
        "The selected inventory is complete. The attached candidate table also preserves every "
        "unselected candidate, exclusion reason and original attribute for reviewing other choices.",
    ]])
    pollutants = summary.get("pollutants", {})
    if pollutants:
        baseline = []
        for name, metric in pollutants.items():
            baseline.append([_label(name), metric.get("baseline"), metric.get("unit"),
                             metric.get("coverage_fraction"), _area(metric.get("valid_area_ha")),
                             metric.get("availability_reason") or metric.get("availability")])
        sections.append(["Original baseline quantities and support", [
            _table(["Quantity", "Value", "Physical unit", "Coverage fraction",
                    "Valid area (ha)", "Availability"], baseline),
            "Coverage fractions are between zero and one. Valid areas, structural stream areas "
            "and missing areas are retained separately in the original portfolio JSON. Nitrogen, "
            "phosphorus and sediment keep distinct physical units; absent outputs are not zero.",
        ]])
        for run_id in spec.get("alternative_run_ids", []):
            blocks = ["Original alternative run: " + run_id]
            for name, metric in pollutants.items():
                alternative = metric.get("alternatives", {}).get(run_id)
                if alternative is None:
                    continue
                blocks.append(_table(["Quantity or support", _label(name) + " / " + str(metric.get("unit", ""))], [
                    ["Alternative value on its own support", alternative.get("value")],
                    ["Alternative coverage fraction", alternative.get("coverage_fraction")],
                    ["Alternative valid area (ha)", _area(alternative.get("valid_area_ha"))],
                    ["Alternative availability", alternative.get("availability_reason") or alternative.get("availability")],
                    ["Baseline on common support", alternative.get("common_baseline")],
                    ["Alternative on common support", alternative.get("common_alternative")],
                    ["Alternative minus baseline on common support", alternative.get("delta")],
                    ["Common coverage fraction", alternative.get("common_coverage_fraction")],
                    ["Common valid area (ha)", _area(alternative.get("common_valid_area_ha"))],
                    ["Common structural stream area (ha)", _area(alternative.get("common_structural_stream_area_ha"))],
                    ["Comparison availability", alternative.get("comparison_availability_reason") or alternative.get("comparison_availability")],
                    ["Parameter profile changed", alternative.get("profile_changed")],
                ]))
            blocks.append("Differences use only common retained support. The alternative's own total "
                          "and coverage remain separate from paired values. Model routing beyond the "
                          "selected footprint remains part of the original complete scenario.")
            sections.append(["Original alternative comparison", blocks])
    sections.extend(_matched_family_sections(state, plan))
    executions = state.get("native_execution", {})
    if executions:
        versions = []
        for run_id, execution in executions.items():
            for model, value in execution.get("model_versions", {}).items():
                versions.append([run_id, model.upper(), value.get("comparison_version"),
                                 value.get("basis"), value.get("requested_version"),
                                 value.get("stage_completed_at")])
        sections.append(["Native execution provenance", [
            _table(["Original run ID", "Model", "Execution version", "Recorded basis",
                    "Requested version", "Stage completed"], versions),
            "Each completed model stage retains its own execution provenance. An observed run fallback "
            "or requested-only legacy record is labelled explicitly. Full observed runtime, stage reuse, "
            "unit contract and compatibility records are attached in the original study snapshot.",
        ]])
    source_rows = []
    for original in sources:
        entry = original["entry"]
        source_rows.append([", ".join(_label(role) for role in sorted({ref["role"] for ref in original["references"]})),
                            entry["title"], entry["vintage"], entry["uri"],
                            entry["body"]["sha256"]])
    sections.append(["Original planning and criterion sources", [
        _table(["Selected role", "Original title", "Edition", "Original URI", "Body SHA-256"], source_rows),
        "Every selected planning or criterion source body and its declared companions are retained "
        "with this report source. Original native raster references and producing-model provenance "
        "remain in the complete study and decision packet; recomputation uses the original Workspace.",
    ]])
    sections.append(["Complete original decision records", [
        _links([
            ("Complete existing Conservation decision packet", "decision-packet.zip"),
            ("Original saved plan", "records/plan.json"),
            ("Original saved study", "records/study.json"),
            ("Report's verified study metadata and execution provenance", "records/study-inspection.json"),
            ("Complete original selected portfolio and quantities", "records/portfolio.json"),
            ("Original source entries and selected bindings", "records/source-bindings.json"),
            ("Complete retained candidate inventory", "records/candidates.json"),
        ]),
    ]])
    return sections


def _write_bundle(directory, files, target):
    """Write the source manifest and every companion without extracting a packet."""
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=directory, prefix=".source-", suffix=".zip",
                                         delete=False) as temporary:
            pending = Path(temporary.name)
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED,
                             compresslevel=5, allowZip64=True) as archive:
            for name, descriptor in sorted(files.items()):
                source = verify_file(directory, descriptor)
                info = zipfile.ZipInfo(_relative(name), date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                with source.open("rb") as stream, archive.open(info, "w", force_zip64=True) as out:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        out.write(block)
                verify_file(directory, descriptor)
        if target.exists():
            if target.stat().st_size != pending.stat().st_size or file_digest(target) != file_digest(pending):
                raise ValueError("Retained report-source bundle differs")
            pending.unlink()
        else:
            pending.replace(target)
        pending = None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _verify_source(workspace, value):
    choice = value["source"]
    unused, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    if (entry.get("kind") != "document" or entry.get("role") != observed_context.ROLE
            or not _same_file(entry["body"], value["files"]["recipe"])):
        raise ValueError("The original report recipe source differs from its receipt")
    actual = {item.get("view_path", item["filename"]): item
              for item in entry.get("companions", [])}
    expected = value["members"]
    if len(actual) != len(entry.get("companions", [])) or set(actual) != set(expected):
        raise ValueError("Original report source companion membership differs")
    for name, item in expected.items():
        if not _same_file(actual[name], item):
            raise ValueError("Original report source companion differs: " + name)
    current = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
    if current != value["observed_binding"]:
        raise ValueError("Original scientific-report source binding differs")
    return value


def get(workspace, key):
    """Reopen the same completed imported source and verify all retained members."""
    key = identifier(key)
    value = read_json(workspace.root / DIRECTORY / key / "receipt.json")
    if (value.get("schema") != SCHEMA or value.get("state") != "complete"
            or value.get("id") != key or digest(value.get("selection")) != key):
        raise ValueError("The retained Conservation report-source identity differs")
    for item in value["files"].values():
        verify_file(workspace.root, item)
    for item in value["members"].values():
        verify_file(workspace.root, item)
    return _verify_source(workspace, value)


def list_sources(workspace, plan_id=None):
    """Return completed receipt metadata without re-reading source bodies."""
    if plan_id is not None:
        plan_id = identifier(plan_id)
    root = workspace.root / DIRECTORY
    if not root.exists():
        return []
    rows = []
    for path in sorted(root.glob("*/receipt.json")):
        value = read_json(path)
        if (value.get("schema") != SCHEMA or value.get("state") != "complete"
                or path.parent.name != value.get("id")
                or digest(value.get("selection")) != value["id"]):
            raise ValueError("A Conservation report-source receipt differs")
        if plan_id is not None and value["plan_id"] != plan_id:
            continue
        rows.append({key: _copy(value[key]) for key in (
            "id", "study_id", "plan_id", "title", "state", "source", "created_at", "files",
        )})
    return rows


def prepare(workspace, spec):
    """Retain a source document for the current Scientific Reports composer."""
    if not isinstance(spec, dict) or set(spec) - {"plan_id", "title", "include_maps"}:
        raise ValueError("Supply the original plan_id, optional title and include_maps choice")
    include_maps = spec.get("include_maps", True)
    if not isinstance(include_maps, bool):
        raise ValueError("include_maps must be true or false")
    map_implementation = None
    if include_maps:
        from . import conservation_report_maps
        map_implementation = conservation_report_maps.implementation()
    plan = conservation.get_plan(workspace, identifier(spec.get("plan_id")))
    if plan.get("state") != "complete":
        raise ValueError("Choose a completed original Conservation portfolio")
    state = conservation.inspect(workspace, plan["study_id"], include_candidates=False)
    if state.get("state") != "complete" or state["id"] != plan["study_id"]:
        raise ValueError("The original Conservation study must be complete")
    title = _title(spec.get("title", plan["title"]))
    rows = _retained_rows(workspace, state, plan)
    for item in plan["files"].values():
        verify_file(workspace.root, item)
    optimization = _retained_optimization(workspace, state, plan)
    if optimization is not None:
        from . import conservation_optimization
        packet = conservation_optimization.export(workspace, plan["id"])
    else:
        packet = conservation.export_packet(workspace, state["id"], plan["id"])
    originals = _source_entries(workspace, state)
    plan_file = describe_file(workspace.root, workspace.root / "conservation-plans" / plan["id"] / "plan.json")
    study_file = describe_file(workspace.root, workspace.root / "conservation" / state["id"] / "study.json")
    identity = {
        "edition": EDITION, "producer_sha256": file_digest(__file__),
        "project_id": workspace.project["id"], "plan_id": plan["id"], "study_id": state["id"],
        "title": title, "plan": plan_file, "study": study_file,
        "packet": {**_identity_file(packet), "id": packet["id"],
                   "schema": packet["schema"], "presentation": packet.get("presentation")},
        "optimization": ({"id": optimization["analysis"]["id"],
                          "files": optimization["state"]["files"]}
                         if optimization is not None else None),
        "source_entries": originals,
        "native_execution": state.get("native_execution", {}),
        "maps": map_implementation,
    }
    key = digest(identity)
    directory = workspace.root / DIRECTORY / key
    with held(directory / ".source.lock", blocking=False):
        receipt = directory / "receipt.json"
        if receipt.exists():
            return {**get(workspace, key), "reused": True}
        members = {}
        def retain(name, descriptor):
            name = _relative(name)
            if name in members:
                if not _same_file(members[name], descriptor):
                    raise ValueError("Report source members collide: " + name)
                return
            copied = copy_verified(workspace.root, descriptor, directory, path=name)
            members[name] = describe_file(directory, directory / copied["path"])
        def write(name, value):
            name = _relative(name)
            if name in members:
                raise ValueError("Report source member names collide")
            path = destination_file(directory, name)
            atomic_json(path, value, immutable=True)
            members[name] = describe_file(directory, path)
        retain("decision-packet.zip", packet)
        retain("records/plan.json", plan_file)
        retain("records/study.json", study_file)
        retain("records/portfolio.json", plan["files"]["portfolio"])
        retain("records/candidates.json", state["files"]["candidates"])
        if optimization is not None:
            names = {"analysis": "analysis.json", "candidates": "candidates.csv",
                     "report": "index.html", "joint-cells.csv": "joint-cells.csv",
                     "joint-portfolios.csv": "joint-portfolios.csv",
                     "joint-candidates.csv": "joint-candidates.csv"}
            for role, item in optimization["state"]["files"].items():
                retain("optimization/" + names[role], item)
        write("records/study-inspection.json", state)
        write("records/source-bindings.json", {"schema": "upstate.conservation-report-originals/v1",
                                              "study_id": state["id"], "sources": originals})
        for role, item in sorted(plan["files"].items()):
            if role == "footprint":
                continue
            retain("portfolio/" + _relative(role) + "/" + Path(item["path"]).name, item)
        for original in originals:
            prefix = "originals/" + original["source_collection_id"] + "/" + digest(original["source_id"]) + "/"
            for item in [original["entry"]["body"]] + original["entry"].get("companions", []):
                native_name = _relative(item.get("view_path", item["filename"]))
                retain(prefix + native_name, {"path": item["object"], "bytes": item["bytes"],
                                              "sha256": item["sha256"]})
        maps = None
        if include_maps:
            maps = conservation_report_maps.prepare(workspace, state, plan, directory)
            for item in maps["files"]:
                name = _relative(item["path"])
                if name in members:
                    raise ValueError("Original map companion names collide: " + name)
                verify_file(directory, item)
                members[name] = item
        recipe = {
            "schema": observed_context.SCHEMA, "edition": EDITION, "title": title,
            "origin": {"schema": SCHEMA, "id": key, "project_id": workspace.project["id"],
                       "study_id": state["id"], "plan_id": plan["id"], "packet_id": packet["id"],
                       "mode": state["mode"], "purpose": state["purpose"],
                       "unit_type": state["unit_type"], "planning_unit_label": state["planning_unit_label"]},
            "inputs": [members[name] for name in sorted(members)],
            "sections": _sections(state, plan, rows, packet, originals, optimization),
            "source_links": ["records/source-bindings.json", "records/study-inspection.json",
                             "records/plan.json", "records/candidates.json", "decision-packet.zip"],
        }
        if maps is not None:
            recipe.update(figure_spec=maps["figure_spec"], figures=maps["figures"])
            recipe["source_links"] += [conservation_report_maps.INPUTS,
                                       conservation_report_maps.SPEC,
                                       conservation_report_maps.INVENTORY,
                                       conservation_report_maps.CONTEXT_REGISTER]
            recipe["sections"].append(["Original geographic figures", [
                "The geographic panels preserve saved original and reporting-clipped planning "
                "geometry, selected unions and declared context boundaries. Saved planning vertices "
                "and holes remain intact. Contexts use the same bound reader, projected CRS and "
                "declared clipping/buffer; the renderer applies no reprojection or simplification. "
                "Scale and north refer to the saved projected grid.",
                "Grey and outlines represent the exact roles printed in each frame. An overlap "
                "area remains separate from the entire selected footprint. Cartographic shapes "
                "do not stand for a measured concentration, model output or inferred flow path.",
                _links([
                    ("Complete original geographic input and area checks", conservation_report_maps.INPUTS),
                    ("Original geographic figure specification", conservation_report_maps.SPEC),
                    ("Verified geographic figure inventory", conservation_report_maps.INVENTORY),
                    ("Complete original context-feature register", conservation_report_maps.CONTEXT_REGISTER),
                ]),
            ]])
            if maps["context_register"]:
                recipe["sections"].append(["Original context features", [
                    "These are original source attributes. Blank values mean the field is absent or null. "
                    "Cartographic map labels identify these features; they are not monitoring or intake sites.",
                    {"kind": "table", "columns": ["Context", "Source ID", "Native feature ID",
                                                   "NAME", "FACILITY", "INTAKE", "BUFFER_FT"],
                     "rows": [[_label(row[name]) if name == "context" else row[name]
                               for name in ("context", "source_id", "native_feature_id",
                                                       "NAME", "FACILITY", "INTAKE", "BUFFER_FT")]
                              for row in maps["context_register"]]},
                ]])
        recipe_path = directory / "conservation-report.json"
        atomic_json(recipe_path, recipe, immutable=True)
        recipe_file = describe_file(directory, recipe_path)
        source_id = "conservation-portfolio-" + key
        manifest = {
            "schema": "upstate.sources/v1", "title": title,
            "scope": "Original saved Conservation portfolio as a retained scientific-report source",
            "entries": [{
                "id": source_id, "kind": "document", "role": observed_context.ROLE,
                "title": title, "uri": "workspace://" + str(workspace.project["id"]) + "/conservation-plans/" + plan["id"],
                "vintage": "Saved portfolio " + str(plan.get("completed_at") or plan.get("created_at")),
                **recipe_file,
                "companions": [members[name] for name in sorted(members)],
                "metadata": {"origin": recipe["origin"], "source_kind": "saved_conservation_portfolio",
                             "original_output_scope": "Original selected footprint, with every planning source retained"},
            }],
        }
        manifest_path = directory / "sources.json"
        atomic_json(manifest_path, manifest, immutable=True)
        manifest_file = describe_file(directory, manifest_path)
        bundle = directory / "conservation-report-source.zip"
        _write_bundle(directory, {**members, recipe_file["path"]: recipe_file,
                                  manifest_file["path"]: manifest_file}, bundle)
        collection = workspace.import_sources(manifest_path)
        choice = {"source_collection_id": collection["id"], "source_id": source_id}
        binding = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
        result = {
            "schema": SCHEMA, "edition": EDITION, "id": key, "state": "complete",
            "plan_id": plan["id"], "study_id": state["id"], "title": title,
            "selection": identity, "source": choice, "observed_binding": binding,
            "packet": _copy(packet), "created_at": now(),
            "files": {
                "recipe": describe_file(workspace.root, recipe_path),
                "manifest": describe_file(workspace.root, manifest_path),
                "source_bundle": describe_file(workspace.root, bundle),
            },
            "members": {name: describe_file(workspace.root, directory / name)
                        for name in sorted(members)},
        }
        if maps is not None:
            result["maps"] = {"summary": _copy(maps["summary"]),
                              "figure_spec": maps["figure_spec"], "figures": _copy(maps["figures"])}
            for index, item in enumerate(maps["files"]):
                result["files"]["geography_%03d" % index] = describe_file(
                    workspace.root, directory / item["path"])
        _verify_source(workspace, result)
        atomic_json(receipt, result, immutable=True)
        return result

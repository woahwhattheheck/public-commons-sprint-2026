"""Retain saved Economic comparisons as ordered scientific-report sources."""
from __future__ import annotations

import argparse
from copy import deepcopy
from decimal import Decimal
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

from . import observed_context
from .common import atomic_json, describe_file, digest, file_digest, held, read_json, verify_file
from .workspace import Workspace

SCHEMA = "upstate.economic-comparison-source/v1"
EDITION = "economic-comparison-scientific-source-20261013-v2-programme"
ROOT = "economic-comparison-report-sources"
RECIPE_NAME = "observed-report.json"
MANIFEST_NAME = "model-sources.json"
RECEIPT_NAME = "source-receipt.json"
HEX = re.compile(r"^[0-9a-f]{64}$")


def require(value, message):
    if not value:
        raise ValueError(message)


def _id(value):
    require(isinstance(value, str) and HEX.fullmatch(value), "Select an original saved Economic identity.")
    return value


def _workspace(value):
    return value if hasattr(value, "import_sources") and hasattr(value, "root") else Workspace(value)


def _inside(root, *parts):
    root = Path(root).resolve()
    path = root.joinpath(*parts)
    require(path.resolve().is_relative_to(root), "Keep the comparison source inside its original Workspace.")
    cursor = root
    for part in path.relative_to(root).parts:
        cursor /= part
        require(not cursor.is_symlink(), "Retain ordinary comparison source paths.")
    return path


def _member(root, item):
    name = item.get("path")
    require(isinstance(name, str) and "\\" not in name and "\0" not in name
            and not name.startswith("/") and all(part not in {"", ".", ".."} for part in name.split("/")),
            "Retain a canonical comparison member path.")
    return verify_file(root, {**item, "path": _inside(root, *name.split("/")).relative_to(root).as_posix()})


def _text(value):
    if value is None:
        return "Unstated"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    return str(value)


def _table(columns, rows, caption=None):
    result = {"kind": "table", "columns": list(columns),
              "rows": [[_text(value) for value in row] for row in rows]}
    if caption:
        result["caption"] = caption
    return result


def _field_rows(value, prefix=""):
    if isinstance(value, dict):
        rows = []
        for key in sorted(value):
            path = prefix + "/" + key.replace("~", "~0").replace("/", "~1")
            rows.extend(_field_rows(value[key], path))
        return rows or [[prefix or "/", "{}"]]
    return [[prefix or "/", _text(value)]]


def _changed_rows(changes):
    def display(value, present):
        if not present:
            return "Field absent"
        text = _text(value)
        return text if len(text) <= 400 else text[:397] + "... [complete value in comparison.json]"
    return [[row["path"], row["kind"], display(row["first"], row["first_present"]),
             display(row["second"], row["second_present"])] for row in changes]



def _money_minor(value):
    """Format retained integer cents; never estimate or recalculate a cost."""
    if value is None:
        return "Unstated"
    require(type(value) is int, "Retained cost source amounts must remain whole cents.")
    sign = "-" if value < 0 else ""
    whole, cents = divmod(abs(value), 100)
    return sign + str(whole) + "." + format(cents, "02d")


def _retained_editions(directory, comparison, record, members):
    """Read the original captured inputs, including their complete review audits."""
    by_name = {item["path"]: item for item in members}
    result = {}
    for side in ("first", "second"):
        name = side + "-edition.json"
        require(name in by_name, "The comparison omits an original saved Economic input.")
        edition = read_json(_member(directory, by_name[name]))
        require(edition.get("schema") == "upstate.economic-edition/v1"
                and edition.get("id") == comparison[side]["id"]
                and digest(edition) == record["identity"][side + "_record_sha256"],
                "The captured Economic input differs from its original comparison identity.")
        original = edition["input"]
        require(original["report_id"] == comparison[side]["producer_report_id"]
                and original["report_sha256"] == comparison[side]["report_sha256"]
                and original["zone_id"] == comparison[side]["zone_id"],
                "The captured Economic input names a different physical source.")
        result[side] = edition
    return result


def _review_audit(cost, edition, run_id):
    pointer = cost.get("field12_cost_review")
    if not pointer:
        return None
    require(isinstance(pointer, dict), "Retain the complete FIELD12 review pointer.")
    key = _id(pointer.get("operation_id"))
    require(pointer.get("source_pointer") == "/field12_cost_reviews/" + key,
            "The reviewed cost points to a different original audit.")
    audit = edition["input"]["selection"].get("field12_cost_reviews", {}).get(key)
    require(isinstance(audit, dict)
            and audit.get("schema") == "upstate.implementation-cost-review-source/v1"
            and audit.get("operation_id") == key,
            "The original reviewed cost audit is absent from its saved selection.")
    binding = audit.get("binding") or {}
    summary, review = audit.get("summary") or {}, audit.get("review") or {}
    require(digest({"schema": "upstate.implementation-cost-review-operation/v1",
                    "edition": audit.get("edition"), "binding": binding, "review": review}) == key,
            "The retained review operation identity differs from its original binding or decisions.")
    source_match = (binding.get("run_id") == run_id
                    and all(binding.get(k) == edition["input"].get(k)
                            for k in ("report_id", "report_sha256", "zone_id")))
    def same_cents(value, minor):
        try:
            return type(minor) is int and Decimal(str(value)) == Decimal(minor) / 100
        except (ValueError, ArithmeticError):
            return False
    def same_number(first, second):
        try:
            return Decimal(str(first)) == Decimal(str(second))
        except (ValueError, ArithmeticError):
            return False
    amounts_match = (cost.get("currency") == "USD"
                     and same_cents(cost.get("capital"), summary.get("capital_minor"))
                     and same_cents(cost.get("annual_operating"), summary.get("annual_operating_forecast_minor"))
                     and same_number(cost.get("horizon_years"), summary.get("horizon_years"))
                     and same_number(cost.get("discount_rate"), summary.get("discount_rate")))
    original_scope = review.get("scope") or {}
    current_scope = cost.get("scope") or {}
    scope_match = (original_scope.get("kind") == current_scope.get("kind")
                   and original_scope.get("kind") in {"whole_scenario", "reporting_zone"})
    if original_scope.get("kind") == "reporting_zone":
        scope_match = bool(scope_match and current_scope.get("producer_report_id") == binding.get("report_id")
                           and current_scope.get("zone_id") == binding.get("zone_id"))
    reference = cost.get("source") or {}
    expected_uri = ("implementation/plans/" + str(binding.get("plan_id")) + "/revisions/" +
                    ("%016d.json" % binding["revision"]) + "#cost-review-" + key)
    reference_match = (reference.get("uri") == expected_uri
                       and reference.get("as_of") == review.get("as_of"))
    return {"audit": audit, "current_source_matches": source_match,
            "current_review_reference_matches": reference_match,
            "current_amounts_and_finance_match": amounts_match,
            "current_scope_matches": scope_match,
            "current_basis_matches": bool(source_match and amounts_match and scope_match and reference_match)}


def _programme_blocks(cost, labels, row, editions):
    programme, priced, bound = (cost.get(key) for key in ("programme", "priced_basis", "native_binding"))
    if not isinstance(programme, dict) or not isinstance(priced, dict):
        return []
    if (programme.get("schema") != "upstate.simulated-restoration-programme/v1"
            or priced.get("schema") != "upstate.simulated-restoration-pricing/v1"):
        return ["Additional original design metadata is retained in the saved Economic input; "
                "its schema has no derived interpretation in this report."]
    bound = bound if isinstance(bound, dict) else {}
    binding_matches = {}
    for side in labels:
        original_row = row.get(side) or {}
        binding_matches[side] = bool(
            bound.get("run_id") == row["run_id"]
            and all(bound.get(k) == editions[side]["input"].get(k)
                    for k in ("report_id", "report_sha256", "zone_id"))
            and all(bound.get(k) == original_row.get(k)
                    for k in ("grid_id", "profile_id", "scenario_id")))
    planting, schedule = programme.get("planting") or {}, programme.get("programme") or {}
    source_rows = {item["id"]: item for item in priced.get("original_source_rows", [])}
    require(priced.get("currency") == "USD", "Retain the original programme pricing currency.")
    original_method = priced.get("selected_method")
    selected = priced.get("selected") or {}
    materials = priced.get("material_comparison") or {}
    assistance = priced.get("assistance_comparison") or {}
    species = [
        str(item.get("species", item.get("catalogue_row_id"))) + ": " +
        str(item.get("planting_count")) + " positions"
        for item in materials.get("lines", [])
    ]
    heading = " / ".join(side.capitalize() for side in labels)
    blocks = [
        heading + " original implementation design. This is the retained basis supplied with "
        "the original cost input. A later FIELD12 forecast can replace its financial amounts "
        "while preserving this design and pricing metadata as provenance.",
        _table(["Retained design field", "Original value"], [
            ["Authored role", programme.get("scenario_role")],
            ["Original title", programme.get("title")],
            ["Binding matches current edition", binding_matches],
            ["Treatment footprint", str(priced.get("treatment_hectares")) + " ha; " +
             str(programme.get("expected_footprint", {}).get("net_changed_cells")) +
             " changed cells; native footprint " + str(bound.get("footprint_id"))],
            ["Original class transitions", programme.get("expected_footprint", {}).get("changed_transitions")],
            ["Planting layout", str(planting.get("spacing_x_ft")) + " × " +
             str(planting.get("spacing_y_ft")) + " ft; " +
             str(priced.get("planting_positions")) + " positions; original method " + str(original_method)],
            ["Species quantities", "; ".join(species)],
            ["Proposed start", schedule.get("start_date")],
            ["Authored task durations (days)", schedule.get("task_duration_days")],
            ["Recurring maintenance", schedule.get("maintenance_recurrence")],
        ], "Implementation hectares are the retained treatment quantity. Shared model support and "
           "reporting-zone area are separate quantities. Dates and durations are planning assumptions, "
           "not evidence of completed fieldwork. A nonmatching binding means this is historical "
           "design context, not a verified treatment quantity for the current physical source."),
    ]
    components = []
    for line in selected.get("capital_lines", []):
        source = source_rows.get(line.get("catalogue_row_id")) or {}
        reference = (str(source.get("title")) + "; " + str(source.get("source_id")) +
                     "; page " + str(source.get("source_page"))) if source else "Authored allowance"
        components.append([line.get("label"), _money_minor(line.get("amount_minor")),
                           line.get("basis"), reference])
    components.extend([
        ["Original capital total", _money_minor(selected.get("capital_minor")),
         "Retained original " + str(original_method) + " option", "Original basis, not a later reviewed forecast"],
        ["Original annual maintenance", _money_minor(selected.get("annual_operating_minor")),
         "Authored recurring forecast per year", programme.get("cost_assumptions", {}).get("annual_forecast_basis")],
        ["Separate stock-only comparison", _money_minor(materials.get("total_minor")),
         "Included in capital: " + _text(materials.get("included_in_capital")), materials.get("meaning")],
        ["Separate assistance multiplication", _money_minor(assistance.get("amount_minor")),
         "Deducted from costs: " + _text(assistance.get("deducted_from_costs")) +
         "; eligibility confirmed: " + _text(assistance.get("eligibility_confirmed")), assistance.get("meaning")],
    ])
    blocks.append(_table(["Original component", "USD", "Price meaning", "Source or qualification"], components,
                         "Amounts are copied from the original priced basis. No component is added, "
                         "subtracted, annualized or repriced by this report."))
    sources = []
    for source in source_rows.values():
        sources.append([source.get("title"), source.get("price_kind"),
                        _money_minor(source.get("rate_cents")) + " USD / " + str(source.get("source_unit")),
                        source.get("source_page"), source.get("scope"), source.get("exclusions")])
    blocks.append(_table(["Published item", "Price type", "Original rate/unit", "Page", "Scope", "Exclusions"],
                         sources, "FY25 benchmark costs, FY26 assistance and material quotes have distinct "
                         "meanings. Original publisher references and complete rows are retained in the "
                         "saved Economic input; no eligibility or current quotation is inferred."))
    blocks.extend([
        "Design limitations: " + _text(planting.get("species_interpretation")) + " " +
        _text(schedule.get("monitoring_note")),
        "Benchmark applicability: " + _text(schedule.get("benchmark_applicability")),
        "Unpriced scope: " + _text(priced.get("unpriced_excluded_scopes")),
    ])
    return blocks


def _review_blocks(context, side):
    audit = context["audit"]
    review, summary, binding = audit["review"], audit["summary"], audit["binding"]
    forecasts = []
    for key, label in (("remaining_capital", "Remaining capital forecast"),
                       ("annual_operating", "Recurring annual operating forecast")):
        value = review[key]
        source = value["source"]
        forecasts.append([label, _money_minor(value["amount_minor"]),
                          source.get("title"), source.get("as_of"),
                          source.get("uri"), value.get("note")])
    blocks = [
        side.capitalize() + (" matching reviewed cost basis: saved plan " if context["current_basis_matches"]
                             else " historical reviewed cost context: saved plan ") + str(binding.get("plan_id")) +
        ", revision " + str(binding.get("revision")) + ", as of " + str(review.get("as_of")) + ". " +
        str(review.get("note") or ""),
        _table(["Reviewed amount", "USD", "Source", "Source date", "Reference", "Rationale"], forecasts,
               ("The current saved cost retains these reviewed amounts and financial assumptions."
                if context["current_basis_matches"] else
                "The current saved cost or physical binding differs from this retained review. Read the "
                "current edition amounts in the original comparison table; these forecasts are historical context.") +
               " Inherited programme metadata is not recalculated or relabeled as the successor option."),
        _table(["Review correspondence", "Matches current edition"], [
            ["Physical source and scenario", context["current_source_matches"]],
            ["Currency, amounts, horizon and rate", context["current_amounts_and_finance_match"]],
            ["Declared cost scope", context["current_scope_matches"]],
            ["Review source reference and date", context["current_review_reference_matches"]],
        ]),
        _table(["Original ledger / reviewed basis", "USD"], [
            ["Candidate budget (context)", _money_minor(summary.get("budget_minor"))],
            ["Candidate commitments (context)", _money_minor(summary.get("commitment_minor"))],
            ["Candidate actual ledger total (context)", _money_minor(summary.get("actual_minor"))],
            ["Selected actual capital", _money_minor(summary.get("selected_actual_capital_minor"))],
            ["Selected actual operating history", _money_minor(summary.get("selected_actual_operating_minor"))],
            ["Remaining capital forecast", _money_minor(summary.get("remaining_capital_minor"))],
            ["Resulting reviewed capital", _money_minor(summary.get("capital_minor"))],
            ["Explicit annual operating forecast", _money_minor(summary.get("annual_operating_forecast_minor"))],
        ], "Budget, commitment and actual are separate ledger classifications. Selected operating history "
           "is context; it is not automatically added to or annualized into the explicit annual forecast."),
        _table(["Ledger row / kind", "Original USD", "Reviewed classification", "Selected USD",
                "Attribution / allocation", "Reason"], [
            [str(item["id"]) + " / " + str(item["kind"]), _money_minor(item["amount_minor"]),
             item["decision"]["classification"], _money_minor(item["decision"]["amount_minor"]),
             "; ".join(str(item["decision"].get(key) or "")
                       for key in ("attribution_reason", "allocation_reason")).strip("; "),
             item["decision"].get("reason")]
            for item in audit.get("ledger_rows", [])
        ], "Every original row and full source/attachment association remains in the saved selection audit."),
        "Reviewed financial assumptions: " + str(summary.get("horizon_years")) + " years; real discount rate " +
        str(summary.get("discount_rate")) + ". Scope: " + _text(review.get("scope")) + ".",
    ]
    return blocks


def _implementation_sections(row, editions):
    if not editions:
        return []
    cc, blocks, groups = row["cost_comparison"], [], {}
    for side in ("first", "second"):
        cost = cc.get(side + "_input")
        if not isinstance(cost, dict):
            continue
        retained = editions[side]["input"]["selection"]
        originals = [item for item in retained.get("costs", []) if item.get("run_id") == row["run_id"]]
        require(len(originals) == 1 and originals[0] == cost,
                "The comparison cost differs from the original captured Economic selection.")
        if isinstance(cost.get("programme"), dict):
            key = digest({name: cost.get(name) for name in ("programme", "priced_basis", "native_binding")})
            groups.setdefault(key, {"cost": cost, "sides": []})["sides"].append(side)
    for item in groups.values():
        blocks.extend(_programme_blocks(item["cost"], item["sides"], row, editions))
    for side in ("first", "second"):
        cost = cc.get(side + "_input")
        if isinstance(cost, dict):
            audit = _review_audit(cost, editions[side], row["run_id"])
            if audit:
                blocks.extend(_review_blocks(audit, side))
    if not blocks:
        return []
    blocks.append({"kind": "links", "items": [
        {"title": "First complete saved input and original source audit", "path": "comparison/first-edition.json"},
        {"title": "Second complete saved input and reviewed source audit", "path": "comparison/second-edition.json"},
    ]})
    return [[row["label"] + " — implementation design and reviewed costs", blocks]]


def report_sections(comparison, *, retained_editions=None):
    first, second = comparison["first"], comparison["second"]
    sections = [[comparison["title"], [
        "The first and second columns follow the saved editions selected by the operator. "
        "Every financial delta is second minus first. Original calculations, physical quantities "
        "and decisions are retained without recalculation.",
        _table(["Saved edition", "First", "Second"], [
            ["Title", first["title"], second["title"]],
            ["Created", first["created_at"], second["created_at"]],
            ["Edition ID", first["id"], second["id"]],
            ["Native report", first["producer_report_id"], second["producer_report_id"]],
            ["Reporting zone", first.get("zone_title") or first["zone_id"],
                               second.get("zone_title") or second["zone_id"]],
            ["Original physical source SHA256", first["report_sha256"], second["report_sha256"]],
        ]),
        _table(["Comparison result", "Count"], [
            [label, comparison["summary"][key]] for key, label in
            (("scenario_count", "Scenarios in either edition"), ("matched_count", "Matched scenarios"),
             ("added_count", "Added scenarios"), ("removed_count", "Removed scenarios"),
             ("cost_changed_count", "Changed cost inputs or amounts"),
             ("decision_changed_count", "Changed saved decisions"))
        ]),
    ]]]
    sections.append(["Physical source and comparison support", [
        ("Both editions retain the same original physical comparison and quantities."
         if comparison["comparability"]["physical"] else
         "The editions retain different physical comparison context; read each original column with its source."),
        _table(["Source check", "Same original value"], [
            [row["label"], row["equal"]] for row in comparison["comparability"]["checks"]
        ]),
        "Original report identity, source bytes, project, reporting zone, baseline, "
        "whole alternative cohort, physical scope and complete output/support fields "
        "must all agree for the physical comparison flag. The complete values are in comparison.json.",
    ]])
    for side, label in (("first", "First"), ("second", "Second")):
        sections.append([label + " saved budget and target criteria", [
            _table(["Original field", "Retained value"], _field_rows(comparison["criteria"][side])),
        ]])
    labels = (("capital", "Upfront capital"), ("annual_operating", "Annual operating"),
              ("annualized", "Annualized"), ("present_value", "Present value"))
    for row in comparison["scenarios"]:
        originals = [row.get("first") or {}, row.get("second") or {}]
        decisions = [item.get("decision") or {} for item in originals]
        costs = [item.get("cost") or {} for item in originals]
        cc = row["cost_comparison"]
        blocks = [
            "Scenario " + row["run_id"] + ". Saved comparison status: " + row["status"] + ".",
            _table(["Saved decision", "First", "Second"], [
                [label, decisions[0].get(key), decisions[1].get(key)] for key, label in
                (("budget_status", "Budget"), ("target_status", "Targets"),
                 ("eligible", "Eligible"), ("pareto", "Pareto frontier"),
                 ("reasons", "Recorded reasons"), ("dominated_by", "Dominated by"))
            ]),
            _table(["Original amount", "First", "Second", "Second minus first", "Comparison basis"], [
                [label, cc["deltas"][key]["first"], cc["deltas"][key]["second"],
                 cc["deltas"][key]["delta_decimal"],
                 "Comparable original amounts" if cc["deltas"][key]["comparable"] else cc["deltas"][key]["reason"]]
                for key, label in labels
            ], "Currencies are retained below. Annual operating and annualized amounts are per year; "
               "capital and present value are amounts at their original declared financial basis."),
            _table(["Financial basis", "First", "Second"], [
                [label, costs[0].get(key), costs[1].get(key)] for key, label in
                (("currency", "Currency"), ("horizon_years", "Horizon (years)"),
                 ("discount_rate", "Real discount rate"))
            ]),
        ]
        for side in ("first", "second"):
            cost_input = cc[side + "_input"] or {}
            source, scope = cost_input.get("source") or {}, cost_input.get("scope") or {}
            blocks.append(_table([side.capitalize() + " cost provenance", "Original value"], [
                ["Source title", source.get("title")], ["Source reference", source.get("uri")],
                ["Source as of", source.get("as_of")], ["Declared footprint", scope.get("kind")],
                ["Footprint note", scope.get("note")],
                ["Complete original cost input", "Open comparison.json for all retained fields and lineage."],
            ]))
        physical = []
        left, right = (item.get("outputs") or {} for item in originals)
        for metric in list(left) + [key for key in right if key not in left]:
            for side, output in (("First", left.get(metric)), ("Second", right.get(metric))):
                if output is None:
                    physical.append([metric, side, None, None, None, "Scenario/quantity absent"])
                else:
                    physical.append([metric, side, output.get("baseline"), output.get("alternative"),
                                     output.get("reduction"), output.get("units")])
        blocks.append(_table(["Original quantity", "Edition", "Baseline", "Alternative",
                              "Avoided export", "Units"], physical,
                             "Avoided export is the original baseline-minus-alternative value. "
                             "Separate pollutant axes and original annual units are preserved."))
        support = []
        for side, original in zip(("First", "Second"), originals):
            for metric, output in (original.get("outputs") or {}).items():
                original_support = output.get("support") or {}
                support.append([side, metric, original_support,
                                output.get("comparison_valid_cells", original_support.get("valid_cells")),
                                original_support.get("area_ha")])
        blocks.append(_table(["Edition", "Original quantity", "Support", "Valid cells", "Shared area (ha)"],
                             support, "Shared model support is not an implementation treatment quantity. "
                                      "Complete original output fields remain in comparison.json."))
        cost_effectiveness = []
        for side, original in zip(("First", "Second"), originals):
            for metric, result in (original.get("economics") or {}).items():
                cost_effectiveness.append([
                    side, metric, result.get("annualized_cost_per_unit"),
                    result.get("units"), result.get("basis"),
                ])
        if cost_effectiveness:
            blocks.append(_table(["Edition", "Original quantity", "Saved cost per avoided mass",
                                  "Units", "Original basis"], cost_effectiveness,
                                 "Values are copied from the completed Economic report. Unavailable values "
                                 "remain unstated; no new benefit or unit-cost calculation is performed."))

        if row["changes"]:
            blocks.append(_table(["Original field", "Change", "First", "Second"],
                                 _changed_rows(row["changes"]),
                                 "Long values are shortened for this table and retained in full in comparison.json."))
        sections.append([row["label"] + " — original scenario comparison", blocks])
        sections.extend(_implementation_sections(row, retained_editions))
    sections.append(["Financial interpretation and complete original files", [
        *comparison["interpretation"],
        {"kind": "links", "items": [
            {"title": "Readable original comparison", "path": "comparison/index.html"},
            {"title": "Complete original comparison JSON", "path": "comparison/comparison.json"},
            {"title": "All original scenario changes CSV", "path": "comparison/scenarios.csv"},
            {"title": "Complete comparison and both Economic packages", "path": "comparison/comparison-package.zip"},
            {"title": "First complete Economic package", "path": "comparison/first-economic-package.zip"},
            {"title": "Second complete Economic package", "path": "comparison/second-economic-package.zip"},
        ]},
    ]])
    return sections


def _comparison(workspace, comparison_id):
    comparison_id = _id(comparison_id)
    root = _inside(workspace.root, "economic-comparisons", comparison_id)
    record = read_json(_inside(root, "comparison-record.json"))
    identity = record.get("identity")
    require(record.get("schema") == "upstate.economic-comparison-result/v1"
            and record.get("id") == comparison_id and digest(identity) == comparison_id
            and record.get("input") == identity.get("input"), "The original comparison identity changed.")
    files = record["files"]
    by_name = {item["path"]: item for item in files}
    require(len(by_name) == len(files), "The comparison repeats an original file.")
    manifest = read_json(_member(root, by_name["manifest.json"]))
    require(manifest.get("schema") == "upstate.economic-comparison-package/v1"
            and manifest.get("id") == comparison_id and manifest.get("identity") == identity,
            "The comparison manifest names another saved pair.")
    comparison = read_json(_member(root, by_name["comparison.json"]))
    require(digest(comparison) == identity["comparison_sha256"] == record["comparison_sha256"]
            and comparison["first"]["id"] == record["input"]["first_edition_id"]
            and comparison["second"]["id"] == record["input"]["second_edition_id"]
            and comparison["title"] == record["title"], "The original comparison values changed.")
    require(by_name["index.html"]["sha256"] == identity["html_sha256"]
            and by_name["scenarios.csv"]["sha256"] == identity["csv_sha256"],
            "The original readable comparison or CSV changed.")
    members = {}
    for item in [*manifest["members"], *files]:
        name = item["path"]
        descriptor = {key: item[key] for key in ("path", "bytes", "sha256")}
        require(name not in members or members[name] == descriptor,
                "The comparison contains conflicting original member descriptors.")
        _member(root, descriptor)
        members[name] = descriptor
    members["comparison-record.json"] = describe_file(root, root / "comparison-record.json")
    return root, record, comparison, [members[name] for name in sorted(members)]


def _selection(workspace, selection):
    require(selection is None or isinstance(selection, dict), "Supply the original ordered report selection.")
    selected = deepcopy(selection) if selection is not None else {"source_roles": {}}
    require(isinstance(selected.get("source_roles", {}), dict), "Report source roles must be an object.")
    selected.setdefault("source_roles", {})
    choices = observed_context.source_choices(selected)
    binding = observed_context.bind(workspace, selected)
    require(selected.get("observed_context_binding", binding) == binding,
            "The selected original report sources changed; reopen their current selection.")
    return selected, choices, binding


def _context(workspace, comparison_id, selection, *, retained_source_key=None):
    directory, record, comparison, members = _comparison(workspace, comparison_id)
    identity = {"schema": SCHEMA, "edition": EDITION, "project_id": workspace.project["id"],
                "comparison_id": comparison_id, "comparison_identity_sha256": digest(record["identity"]),
                "comparison_sha256": record["comparison_sha256"],
                "first_edition_id": comparison["first"]["id"], "second_edition_id": comparison["second"]["id"],
                "members": members, "adapter_sha256": file_digest(Path(__file__))}
    retained_path = (_inside(workspace.root, ROOT, _id(retained_source_key), "intent.json")
                     if retained_source_key is not None else None)
    if retained_path is not None and retained_path.is_file():
        # Reconnect the captured presentation before evaluating any newer source interpretation.
        intent = read_json(retained_path)
        retained_identity = intent.get("source_identity")
        require(intent.get("schema") == SCHEMA and intent.get("source_key") == retained_source_key
                and digest({"identity": retained_identity, "recipe": intent["recipe"]}) == retained_source_key,
                "The retained original source intent changed.")
        require(all(retained_identity.get(key) == identity.get(key)
                    for key in identity if key not in {"edition", "adapter_sha256"}),
                "The retained source names another original comparison or project.")
        identity, recipe, source_key = retained_identity, intent["recipe"], retained_source_key
    else:
        editions = _retained_editions(directory, comparison, record, members)
        recipe = {"schema": observed_context.SCHEMA, "edition": EDITION,
                  "title": comparison["title"], "sections": report_sections(comparison, retained_editions=editions),
                  "inputs": [{"path": "comparison/" + item["path"], "bytes": item["bytes"],
                              "sha256": item["sha256"]} for item in members],
                  "source_links": ["comparison/index.html", "comparison/comparison.json"],
                  "report_context_kind": "economic-comparison",
                  "economic_comparison_identity": deepcopy(identity)}
        source_key = digest({"identity": identity, "recipe": recipe})
        require(retained_source_key is None or retained_source_key == source_key,
                "The comparison presentation changed; preview its current source before importing.")
    selected, choices, binding = _selection(workspace, selection)
    handoff = {"schema": SCHEMA + "/handoff", "source_identity": identity, "source_key": source_key,
               "original_delivery_selection": selected if selection is not None else None,
               "original_observed_context_binding": binding}
    return {"directory": directory, "record": record, "comparison": comparison, "members": members,
            "source_identity": identity, "source_key": source_key, "recipe": recipe,
            "operation_id": digest(handoff), "handoff_identity": handoff,
            "selection": selected, "choices": choices, "previous_binding": binding,
            "selection_supplied": selection is not None}


def _preview(context):
    return {"schema": SCHEMA, "source_key": context["source_key"], "operation_id": context["operation_id"],
            "comparison_id": context["record"]["id"], "title": context["comparison"]["title"],
            "source_identity": deepcopy(context["source_identity"]),
            "first": deepcopy(context["comparison"]["first"]), "second": deepcopy(context["comparison"]["second"]),
            "summary": deepcopy(context["comparison"]["summary"]),
            "section_count": len(context["recipe"]["sections"]), "source_member_count": len(context["members"]),
            "existing_observed_sources": deepcopy(context["choices"]),
            "original_observed_context_binding": deepcopy(context["previous_binding"]),
            "delivery_selection_supplied": context["selection_supplied"], "state": "preview"}


def preview_report_source(workspace, comparison_id, *, existing_report_selection=None):
    workspace = _workspace(workspace)
    return _preview(_context(workspace, comparison_id, existing_report_selection))


def _retain(source, destination, expected):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        require(not destination.is_symlink() and destination.is_file()
                and destination.stat().st_size == expected["bytes"]
                and file_digest(destination) == expected["sha256"], "A retained comparison source copy changed.")
        return
    temporary = None
    try:
        with source.open("rb") as incoming, tempfile.NamedTemporaryFile(
                dir=destination.parent, prefix=".economic-source-", delete=False) as outgoing:
            temporary = Path(outgoing.name)
            shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
            outgoing.flush()
            os.fsync(outgoing.fileno())
        require(temporary.stat().st_size == expected["bytes"]
                and file_digest(temporary) == expected["sha256"], "An original comparison file changed during capture.")
        os.replace(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _source(workspace, context, root):
    receipt_path = root / RECEIPT_NAME
    if receipt_path.is_file():
        receipt = read_json(receipt_path)
        require(receipt.get("schema") == SCHEMA and receipt.get("source_key") == context["source_key"]
                and receipt.get("source_identity") == context["source_identity"],
                "The comparison source receipt names another original edition.")
        for item in receipt["files"]:
            verify_file(workspace.root, item)
        return receipt
    intent = {"schema": SCHEMA, "source_key": context["source_key"],
              "source_identity": context["source_identity"], "recipe": context["recipe"]}
    atomic_json(root / "intent.json", intent, immutable=True)
    for item in context["members"]:
        _retain(_member(context["directory"], item), _inside(root, "comparison", *item["path"].split("/")), item)
    recipe = context["recipe"]
    atomic_json(root / RECIPE_NAME, recipe, immutable=True)
    companions = [describe_file(root, _inside(root, *item["path"].split("/"))) for item in recipe["inputs"]]
    entry = {"id": "economic-comparison-" + context["source_key"], "kind": "document",
             "role": observed_context.ROLE, "title": recipe["title"],
             "uri": "urn:upstate:economic-comparison:" + workspace.project["id"] + ":" + context["record"]["id"],
             "vintage": "Saved Economic editions " + context["comparison"]["first"]["created_at"] + " / "
                        + context["comparison"]["second"]["created_at"],
             "units": "Original separate monetary currencies and annual physical pollutant units",
             **describe_file(root, root / RECIPE_NAME), "companions": companions,
             "metadata": {"report_schema": observed_context.SCHEMA, "report_context_kind": "economic-comparison",
                          "economic_comparison_identity": context["source_identity"]}}
    atomic_json(root / MANIFEST_NAME, {"schema": "upstate.sources/v1", "title": recipe["title"], "entries": [entry]},
                immutable=True)
    imported = workspace.import_sources(root / MANIFEST_NAME)
    choice = {"source_collection_id": imported["id"], "source_id": entry["id"]}
    binding = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
    receipt = {"schema": SCHEMA, "source_key": context["source_key"], "source_identity": context["source_identity"],
               **choice, "source_role": observed_context.ROLE, "binding": binding,
               "files": [describe_file(workspace.root, _inside(root, *name.split("/")))
                         for name in [RECIPE_NAME, MANIFEST_NAME, "intent.json", *[item["path"] for item in companions]]]}
    atomic_json(receipt_path, receipt, immutable=True)
    return receipt


def import_report_source(workspace, comparison_id, *, existing_report_selection=None,
                         expected_operation_id=None, expected_source_key=None):
    workspace = _workspace(workspace)
    with held(workspace.root / ".workspace.lock"):
        context = _context(workspace, comparison_id, existing_report_selection,
                           retained_source_key=expected_source_key)
        require(expected_operation_id is None or expected_operation_id == context["operation_id"],
                "The original comparison or ordered report selection changed; preview it again.")
        root = _inside(workspace.root, ROOT, context["source_key"])
        root.mkdir(parents=True, exist_ok=True)
        with held(root / "source.lock"):
            source = _source(workspace, context, root)
            selected, choices = deepcopy(context["selection"]), deepcopy(context["choices"])
            choice = {key: source[key] for key in ("source_collection_id", "source_id")}
            if choice not in choices:
                choices.append(choice)
            selected["observed_context_sources"] = choices
            selected["source_roles"][observed_context.ROLE] = deepcopy(choices[0])
            selected["observed_context_binding"] = observed_context.bind(workspace, selected)
            value = {"schema": SCHEMA, "state": "imported", "operation_id": context["operation_id"],
                     "identity": context["handoff_identity"], "source_key": context["source_key"],
                     "comparison_id": comparison_id, "title": context["comparison"]["title"],
                     **choice, "source_role": observed_context.ROLE, "source_binding": source["binding"],
                     "binding": selected["observed_context_binding"], "delivery_selection": selected,
                     "report_preview": _preview(context)}
            path = _inside(root, "handoffs", context["operation_id"], "handoff.json")
            atomic_json(path, value, immutable=True)
            return get_report_source(workspace, context["source_key"], context["operation_id"])


def get_report_source(workspace, source_key, operation_id):
    workspace = _workspace(workspace)
    root = _inside(workspace.root, ROOT, _id(source_key))
    receipt_path = _inside(root, RECEIPT_NAME)
    handoff_path = _inside(root, "handoffs", _id(operation_id), "handoff.json")
    receipt, value = read_json(receipt_path), read_json(handoff_path)
    require(receipt.get("schema") == SCHEMA and receipt.get("source_key") == source_key
            and value.get("schema") == SCHEMA and value.get("source_key") == source_key
            and value.get("operation_id") == operation_id and digest(value["identity"]) == operation_id
            and value["identity"]["source_identity"] == receipt["source_identity"]
            and value["identity"]["source_key"] == source_key
            and receipt["source_identity"]["project_id"] == workspace.project["id"],
            "The saved comparison source handoff changed.")
    intent = read_json(_inside(root, "intent.json"))
    require(digest({"identity": intent["source_identity"], "recipe": intent["recipe"]}) == source_key
            and intent["source_identity"] == receipt["source_identity"],
            "The original frozen source recipe changed.")
    for item in receipt["files"]:
        path = verify_file(workspace.root, item)
        require(path.resolve().is_relative_to(root.resolve()), "A comparison source member leaves its original directory.")
    choice = {key: receipt[key] for key in ("source_collection_id", "source_id")}
    require(all(value.get(key) == selected for key, selected in choice.items()),
            "The source handoff names another imported collection.")
    actual = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
    require(all(actual.get(key) == receipt["binding"].get(key)
                for key in ("source_collection_id", "source_id", "body_sha256", "member_sha256")),
            "The original imported comparison source changed.")
    selected = value["delivery_selection"]
    require(observed_context.bind(workspace, selected) == value["binding"],
            "The original ordered report source selection changed.")
    files = receipt["files"] + [describe_file(workspace.root, receipt_path),
                                describe_file(workspace.root, handoff_path)]
    return {**value, "files": files}


def list_report_sources(workspace, comparison_id):
    workspace = _workspace(workspace)
    _id(comparison_id)
    base = _inside(workspace.root, ROOT)
    result = []
    if not base.is_dir():
        return result
    for root in sorted(base.iterdir()):
        if not HEX.fullmatch(root.name) or not (root / RECEIPT_NAME).is_file():
            continue
        receipt = read_json(_inside(base, root.name, RECEIPT_NAME))
        if receipt.get("source_identity", {}).get("comparison_id") != comparison_id:
            continue
        handoffs = _inside(root, "handoffs")
        if not handoffs.is_dir():
            continue
        for handoff in sorted(handoffs.iterdir()):
            if not HEX.fullmatch(handoff.name) or not (handoff / "handoff.json").is_file():
                continue
            item = get_report_source(workspace, root.name, handoff.name)
            result.append({key: deepcopy(item[key]) for key in
                           ("source_key", "operation_id", "comparison_id", "title", "source_collection_id", "source_id")})
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--comparison-id", required=True)
    parser.add_argument("--delivery-selection", type=Path)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--expected-operation-id")
    parser.add_argument("--expected-source-key")
    args = parser.parse_args(argv)
    selection = read_json(args.delivery_selection) if args.delivery_selection else None
    if args.preview:
        value = preview_report_source(args.workspace, args.comparison_id, existing_report_selection=selection)
    else:
        value = import_report_source(args.workspace, args.comparison_id, existing_report_selection=selection,
                                     expected_operation_id=args.expected_operation_id,
                                     expected_source_key=args.expected_source_key)
    print(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

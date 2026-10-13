"""Review retained FIELD12 spending and forecasts for one original economic scenario.

This pure consumer preserves the saved plan and original physical model results.
It prepares a source-bound decision selection for the maintained EconomicWorkbench;
it neither edits the ledger nor executes a model or commits an economic edition.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date
from decimal import Decimal
import math
import re

from .common import digest
from .implementation import _source_references
from .implementation_evidence import _links as evidence_links, _safe_name
from .decision_analysis import _costs
from .implementation_schema import (
    ImplementationError, SAFE_INTEGER, document_digest, validate_plan)
from .implementation_sources import SourceImportError, import_selection

EDITION = "implementation-cost-review-20261013-v1"
CONTEXT_SCHEMA = "upstate.implementation-cost-context/v1"
REVIEW_SCHEMA = "upstate.implementation-cost-review-selection/v1"
PREVIEW_SCHEMA = "upstate.implementation-cost-review/v1"
SOURCE_SCHEMA = "upstate.implementation-economic-source/v1"
HEX = re.compile(r"^[0-9a-f]{64}$")
KINDS = ("budget", "commitment", "actual")
CLASSES = ("capital", "operating", "exclude")


def _require(condition, message):
    if not condition:
        raise ImplementationError(message)


def _object(value, label):
    _require(isinstance(value, dict), label + " must be an original JSON object")
    return value


def _text(value, label, *, blank=False):
    _require(isinstance(value, str) and (blank or bool(value.strip())),
             label + " must be " + ("text" if blank else "nonblank text"))
    return value


def _day(value, label):
    _require(isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value),
             label + " must be an explicit ISO calendar date")
    try:
        date.fromisoformat(value)
    except ValueError as error:
        raise ImplementationError(label + " is not a valid calendar date") from error
    return value


def _minor(value, label):
    _require(type(value) is int and 0 <= value <= SAFE_INTEGER,
             label + " must be nonnegative exact USD cents within the native integer range")
    return value


def _number(value, label, *, positive=False):
    _require(not isinstance(value, bool) and isinstance(value, (int, float))
             and math.isfinite(value) and (value > 0 if positive else value >= 0),
             label + " must be a finite " + ("positive" if positive else "nonnegative") + " number")
    return value


def _dollars(cents):
    value = float(Decimal(cents) / Decimal(100))
    _require(math.isfinite(value) and Decimal(str(value)) * 100 == cents,
             "The selected cents exceed the decision engine's exact monetary number precision")
    return value


def _index(rows, label):
    _require(isinstance(rows, list), label + " must be an original array")
    result = {}
    for row in rows:
        _object(row, label + " row")
        key = _text(row.get("id"), label + " row ID")
        _require(key not in result, label + " repeats an original ID")
        result[key] = row
    return result


def _binding(plan, candidate_id):
    _text(candidate_id, "Candidate ID")
    candidate = _index(plan["candidates"], "Candidates").get(candidate_id)
    _require(candidate is not None, "Select an actual candidate in the saved plan")
    source = _object(candidate.get("source"), "Original candidate source")
    links = _index(plan["source_links"], "Source links")
    link = links.get(source.get("source_link_id"))
    _require(link is not None, "The candidate's original economic source link is unavailable")
    snapshot = _object(link.get("snapshot"), "Original economic source snapshot")
    _require(snapshot.get("schema") == SOURCE_SCHEMA,
             "Select a candidate imported from an original economic edition")
    _require(link.get("source_digest") == digest(snapshot)
             and source.get("source_digest") == link["source_digest"],
             "The original economic snapshot differs from its retained source digest")
    try:
        imported = import_selection(
            snapshot, link["source_id"], link["kind"],
            source_ref=link.get("reference"),
            selected_ids=[source.get("source_row_id")],
            field_mapping=link.get("field_mapping"))
    except (SourceImportError, KeyError) as error:
        raise ImplementationError("The retained economic source selection differs: " + str(error)) from error
    _require(len(imported["candidates"]) == 1
             and imported["source_links"][0] == link
             and imported["candidates"][0]["source"] == source
             and imported["candidates"][0]["id"] == candidate["id"],
             "The selected candidate no longer matches its frozen original source row")
    binding = _object(snapshot.get("binding"), "Original economic binding")
    for key in ("edition_id", "run_id", "report_id", "report_sha256"):
        _require(isinstance(binding.get(key), str) and HEX.fullmatch(binding[key]),
                 "The original economic " + key + " is unavailable")
    _text(binding.get("zone_id"), "Original reporting zone")
    edition = _object(snapshot.get("edition"), "Original economic edition")
    original_input = _object(edition.get("input"), "Original economic input")
    selection = _object(original_input.get("selection"), "Original economic selection")
    report = _object(snapshot.get("economic_report"), "Original economic report")
    row = _object(source.get("row_snapshot"), "Original selected scenario")
    _require(edition.get("schema") == "upstate.economic-edition/v1"
             and edition.get("id") == binding["edition_id"]
             and all(original_input.get(key) == binding[key]
                     for key in ("report_id", "report_sha256", "zone_id"))
             and report.get("selection") == selection
             and row.get("run_id") == binding["run_id"],
             "The frozen scenario, report, zone and original decision selection disagree")
    _require(edition.get("report_id") == report.get("id"),
             "The retained economic report belongs to another edition")
    _require(digest({"input": original_input, "implementation": edition.get("implementation")}) == edition["id"],
             "The original economic edition identity differs from its retained input")
    _require(candidate.get("modeled_benefits") == row.get("modeled_benefits"),
             "The candidate's physical benefits differ from its original economic source")
    original_costs = selection.get("costs", [])
    _require(isinstance(original_costs, list), "Original cost inputs must remain an array")
    costs = {}
    for cost in original_costs:
        _object(cost, "Original cost")
        run = _text(cost.get("run_id"), "Original cost run")
        _require(run not in costs, "Original selection repeats a cost run")
        costs[run] = cost
    original_cost = costs.get(binding["run_id"])
    _require(original_cost == row.get("original_cost"),
             "The frozen selected cost differs from the original edition input")
    return candidate, link, snapshot, binding, original_cost



def _attachments(plan, links):
    """Declare exact original evidence aliases; the provider verifies actual bytes."""
    local = [deepcopy(link) for link in links if link["kind"] == "local_file"]
    checked = evidence_links({"id": plan["id"], "source_links": local})
    members = {}
    for key in sorted(checked):
        link = checked[key]
        path = "evidence/" + link["sha256"] + "/" + _safe_name(link["original_filename"])
        descriptor = members.setdefault(path, {
            "path": path, "bytes": link["size_bytes"], "sha256": link["sha256"],
            "source_link_ids": [], "sources": [],
        })
        _require(descriptor["bytes"] == link["size_bytes"]
                 and descriptor["sha256"] == link["sha256"],
                 "Associated evidence aliases disagree about their original bytes")
        descriptor["source_link_ids"].append(key)
        descriptor["sources"].append({
            "source_link_id": key, "reference": link["reference"],
            "original_filename": link["original_filename"],
        })
    return [members[path] for path in sorted(members)]


def cost_context(saved_plan, candidate_id):
    """Return exact saved source/ledger context for an operator cost review."""
    plan = validate_plan(saved_plan)
    candidate, link, snapshot, original_binding, original_cost = _binding(plan, candidate_id)
    _require(plan.get("currency") == "USD", "The native ledger must retain its declared USD currency")
    tasks = _index(plan["tasks"], "Tasks")
    totals = {kind: 0 for kind in KINDS}
    attributed = {kind: 0 for kind in KINDS}
    rows = []
    source_links = _index(plan["source_links"], "Plan source links")
    associated_source_ids = set()
    for row in plan["budget_lines"]:
        kind = row["kind"]
        task = tasks.get(row.get("task_id"))
        task_candidate = task.get("candidate_id") if task else None
        attribution = ("candidate" if task_candidate == candidate_id else
                       "other_candidate" if task_candidate else "unattributed")
        totals[kind] += row["amount_minor"]
        if attribution == "candidate":
            attributed[kind] += row["amount_minor"]
        references = _source_references(row) | _source_references(task)
        retained_ids = sorted(references.intersection(source_links))
        associated_source_ids.update(retained_ids)
        rows.append({
            "id": row["id"], "kind": kind, "amount_minor": row["amount_minor"],
            "date": row.get("date"), "reference": row.get("reference"),
            "label": row["label"], "task_id": row.get("task_id"),
            "task_candidate_id": task_candidate, "attribution": attribution,
            "original_row": deepcopy(row), "original_task": deepcopy(task),
            "source_link_ids": retained_ids,
            "unresolved_source_references": sorted(references.difference(source_links)),
            "decision_required": kind == "actual" and attribution == "candidate",
            "available_classifications": list(CLASSES) if kind == "actual" else ["exclude"],
            "attribution_reason_required": kind == "actual" and attribution != "candidate",
        })
    associated_links = [deepcopy(source_links[key]) for key in sorted(associated_source_ids)]
    attachments = _attachments(plan, associated_links)
    binding = {
        "plan_id": plan["id"], "revision": plan["revision"],
        "document_digest": document_digest(plan), "candidate_id": candidate_id,
        "source_link_id": link["id"], "source_digest": link["source_digest"],
        **deepcopy(original_binding),
    }
    return {
        "schema": CONTEXT_SCHEMA, "edition": EDITION, "binding": binding,
        "plan": {"id": plan["id"], "revision": plan["revision"], "title": plan["title"],
                 "document_digest": binding["document_digest"], "currency": "USD"},
        "candidate": deepcopy(candidate), "source_link": deepcopy(link),
        "original_economic_input": deepcopy(snapshot["edition"]["input"]),
        "original_cost": deepcopy(original_cost),
        "original_cost_summary": deepcopy(candidate["source"]["row_snapshot"].get("source_cost_summary")),
        "original_physical_outputs": deepcopy(candidate["source"]["row_snapshot"].get("original_alternative", {}).get("outputs")),
        "ledger_rows": rows,
        "ledger_source_links": associated_links,
        "ledger_attachments": attachments,
        "ledger_totals_minor": totals,
        "candidate_ledger_totals_minor": attributed,
        "interpretation": {
            "ledger": "Budget, commitment and actual are separate records; their amounts are never added together",
            "capital": "Explicitly allocated actual capital plus an entered remaining-capital estimate",
            "operating": "Observed operating expenses remain dated context; a constant annual forecast is entered separately",
            "time": "The existing economic model treats capital as one upfront amount; dated historical spending is not re-discounted",
            "scope": "Task attribution is retained; shared or unattributed rows require an explicit reviewed attribution",
        },
    }


def _forecast(value, name, as_of):
    value = _object(value, name)
    _require(not (set(value) - {"amount_minor", "source", "note"}), name + " contains unknown fields")
    source = _object(value.get("source"), name + " source")
    _require(not (set(source) - {"title", "uri", "as_of"}), name + " source contains unknown fields")
    original = {
        "title": _text(source.get("title"), name + " source title"),
        "uri": _text(source.get("uri"), name + " source reference"),
        "as_of": _day(source.get("as_of"), name + " source as-of"),
    }
    _require(original["as_of"] <= as_of, name + " source date is after the reviewed as-of date")
    return {
        "amount_minor": _minor(value.get("amount_minor"), name + " amount"),
        "source": original, "note": _text(value.get("note", ""), name + " note", blank=True),
    }


def _review(context, supplied):
    value = _object(supplied, "Cost review")
    known = {"schema", "as_of", "row_decisions", "remaining_capital", "annual_operating",
             "financial_parameters", "scope", "note", "acknowledge_currency_change"}
    _require(not (set(value) - known), "The cost review contains unknown fields")
    _require(value.get("schema", REVIEW_SCHEMA) == REVIEW_SCHEMA, "The cost review schema differs")
    as_of = _day(value.get("as_of"), "Review as-of")
    note = _text(value.get("note"), "Review rationale")
    decisions = _object(value.get("row_decisions"), "Actual-row decisions")
    rows = {row["id"]: row for row in context["ledger_rows"]}
    normalized = {}
    for key, decision in decisions.items():
        _require(key in rows, "A reviewed row is absent from this original saved ledger")
        decision = _object(decision, "Row decision " + key)
        _require(not (set(decision) - {"classification", "reason", "amount_minor",
                    "allocation_reason", "attribution_reason", "acknowledge_undated"}),
                 "Row decision " + key + " contains unknown fields")
        classification = decision.get("classification")
        _require(classification in CLASSES, "Choose capital, operating or exclude for row " + key)
        reason = _text(decision.get("reason", ""), "Row reason " + key, blank=True)
        allocation = _text(decision.get("allocation_reason", ""), "Allocation reason " + key, blank=True)
        attribution = _text(decision.get("attribution_reason", ""), "Attribution reason " + key, blank=True)
        _require(type(decision.get("acknowledge_undated", False)) is bool,
                 "Undated acknowledgement must be explicit true or false")
        row = rows[key]
        amount = _minor(decision.get("amount_minor", row["amount_minor"]), "Allocated row " + key)
        _require(amount <= row["amount_minor"], "The selected allocation exceeds original row " + key)
        if classification == "exclude":
            _require(bool(reason.strip()), "Record the exclusion reason for row " + key)
            _require("amount_minor" not in decision or amount == 0,
                     "An excluded row cannot contribute an allocated amount")
            amount = 0
        else:
            _require(row["kind"] == "actual", "Only actual expenses can supply observed cost; budget and commitment remain context")
            _require(not row["date"] or row["date"] <= as_of,
                     "Actual row " + key + " is dated after the review; exclude it or select its actual as-of")
            _require(bool(row["date"]) or decision.get("acknowledge_undated") is True,
                     "Explicitly acknowledge the absent date before including actual row " + key)
            _require(row["attribution"] == "candidate" or bool(attribution.strip()),
                     "Shared or unattributed row " + key + " needs its reviewed candidate attribution")
            _require(amount == row["amount_minor"] or bool(allocation.strip()),
                     "A partial allocation needs its reason for row " + key)
        normalized[key] = {
            "classification": classification, "reason": reason, "amount_minor": amount,
            "allocation_reason": allocation, "attribution_reason": attribution,
            "acknowledge_undated": decision.get("acknowledge_undated", False),
        }
    for row in rows.values():
        _require(not row["decision_required"] or row["id"] in normalized,
                 "Classify or explicitly exclude candidate-linked actual row " + row["id"])
    scope = _object(value.get("scope"), "Reviewed cost footprint")
    _require(not (set(scope) - {"kind", "note"}), "The reviewed cost footprint contains unknown fields")
    _require(scope.get("kind") in ("whole_scenario", "reporting_zone"),
             "Explicitly choose whole_scenario or reporting_zone for the reviewed cost")
    scope = {"kind": scope["kind"], "note": _text(scope.get("note"), "Cost footprint rationale")}
    original_cost = context["original_cost"]
    financial = value.get("financial_parameters")
    if financial is None:
        _require(original_cost is not None, "An originally uncosted scenario needs an explicit horizon and real discount rate")
        financial = {
            "horizon_years": original_cost["horizon_years"],
            "discount_rate": original_cost["discount_rate"],
            "reason": "Retained unchanged from the original selected economic cost",
        }
    else:
        financial = _object(financial, "Financial parameters")
        _require(not (set(financial) - {"horizon_years", "discount_rate", "reason"}),
                 "Financial parameters contain unknown fields")
        financial = {
            "horizon_years": _number(financial.get("horizon_years"), "Cost horizon", positive=True),
            "discount_rate": _number(financial.get("discount_rate"), "Real discount rate"),
            "reason": _text(financial.get("reason"), "Financial parameter review reason"),
        }
    _number(financial["horizon_years"], "Cost horizon", positive=True)
    _number(financial["discount_rate"], "Real discount rate")
    acknowledgement = value.get("acknowledge_currency_change", False)
    _require(type(acknowledgement) is bool, "Currency acknowledgement must be explicit true or false")
    if original_cost is not None and str(original_cost.get("currency", "")).strip().upper() != "USD":
        _require(acknowledgement, "The original cost uses another currency; explicitly acknowledge replacement with the reviewed USD basis")
    return {
        "schema": REVIEW_SCHEMA, "as_of": as_of, "row_decisions": normalized,
        "remaining_capital": _forecast(value.get("remaining_capital"), "Remaining capital", as_of),
        "annual_operating": _forecast(value.get("annual_operating"), "Annual operating forecast", as_of),
        "financial_parameters": financial, "scope": scope, "note": note,
        "acknowledge_currency_change": acknowledgement,
    }


def _issue(code, message, severity="error", **fields):
    return {"code": code, "message": message, "severity": severity, **fields}


def preview_cost_review(saved_plan, candidate_id, review):
    """Prepare one reviewed original EconomicWorkbench input without mutations.

    Returns can_apply=false and a precise review issue for incomplete choices.
    Original-source identity errors raise ImplementationError before any review.
    """
    context = cost_context(saved_plan, candidate_id)
    issues = []
    try:
        selected = _review(context, review)
    except ImplementationError as error:
        return {
            "schema": PREVIEW_SCHEMA, "edition": EDITION, "binding": context["binding"],
            "context": context, "review": deepcopy(review), "operation_id": None,
            "summary": None, "issues": [_issue("review_selection", str(error))],
            "can_apply": False, "proposed_input": None,
        }
    rows, total_capital, total_operating = [], 0, 0
    dated_totals = {kind: {"through_as_of_minor": 0, "undated_minor": 0,
                          "after_as_of_minor": 0} for kind in KINDS}
    duplicates = {}
    for original in context["ledger_rows"]:
        key, kind = original["id"], original["kind"]
        chosen = selected["row_decisions"].get(key)
        if chosen is None:
            chosen = {
                "classification": "exclude", "amount_minor": 0,
                "reason": ("Budget or commitment retained separately; not an actual expense" if kind != "actual"
                           else "Not selected for this original candidate cost review"),
                "allocation_reason": "", "attribution_reason": "", "acknowledge_undated": False,
            }
        else:
            chosen = deepcopy(chosen)
        bucket = ("undated_minor" if not original["date"] else
                  "through_as_of_minor" if original["date"] <= selected["as_of"] else "after_as_of_minor")
        dated_totals[kind][bucket] += original["amount_minor"]
        if chosen["classification"] == "capital":
            total_capital += chosen["amount_minor"]
        elif chosen["classification"] == "operating":
            total_operating += chosen["amount_minor"]
        if chosen["classification"] != "exclude" and original["reference"]:
            duplicate_key = (original["task_id"], original["date"], original["reference"], original["amount_minor"])
            duplicates.setdefault(duplicate_key, []).append(key)
        rows.append({**deepcopy(original), "decision": chosen,
                     "excluded_minor": original["amount_minor"] - chosen["amount_minor"]})
    capital = total_capital + selected["remaining_capital"]["amount_minor"]
    try:
        _minor(capital, "Capital total")
        _minor(total_operating, "Selected observed operating total")
        capital_dollars = _dollars(capital)
        annual_dollars = _dollars(selected["annual_operating"]["amount_minor"])
    except ImplementationError as error:
        issues.append(_issue("cost_capacity", str(error)))
        capital_dollars, annual_dollars = None, None
    for ids in duplicates.values():
        if len(ids) > 1:
            issues.append(_issue(
                "repeated_actual_reference",
                "Included original rows share task, date, reference and amount; their separate selected IDs remain explicit",
                "warning", row_ids=ids))
    inherited = context["original_cost"]
    if inherited is not None and str(inherited.get("currency", "")).strip().upper() != "USD":
        issues.append(_issue("currency_replaced", "Reviewed USD costs replace this scenario's original currency; no currency conversion is applied", "warning"))
    original_input = context["original_economic_input"]
    original_selection = original_input["selection"]
    budget = original_selection.get("budget")
    if isinstance(budget, dict) and str(budget.get("currency", "")).strip().upper() != "USD":
        issues.append(_issue("original_budget_currency", "The original budget keeps its own currency and is not converted to the reviewed USD cost basis", "warning"))
    identity = {
        "schema": "upstate.implementation-cost-review-operation/v1", "edition": EDITION,
        "binding": deepcopy(context["binding"]), "review": deepcopy(selected),
    }
    operation_id = digest(identity)
    audit = {
        "schema": "upstate.implementation-cost-review-source/v1",
        "operation_id": operation_id, "edition": EDITION,
        "binding": deepcopy(context["binding"]), "review": deepcopy(selected),
        "source_link": deepcopy(context["source_link"]),
        "candidate": deepcopy(context["candidate"]),
        "ledger_rows": rows,
        "ledger_source_links": deepcopy(context["ledger_source_links"]),
        "associated_source_links": deepcopy(context["ledger_source_links"]),
        "companions": {
            "directory": "implementation/cost-reviews/" + operation_id,
            "path_basis": "Paths are relative to the retained review directory",
            "files": deepcopy(context["ledger_attachments"]),
        },
        "ledger_totals_minor": deepcopy(context["ledger_totals_minor"]),
        "candidate_ledger_totals_minor": deepcopy(context["candidate_ledger_totals_minor"]),
        "dated_ledger_totals_minor": dated_totals,
        "original_economic_input": deepcopy(original_input),
        "interpretation": deepcopy(context["interpretation"]),
    }
    summary = {
        "currency": "USD", "as_of": selected["as_of"],
        "selected_actual_capital_minor": total_capital,
        "selected_actual_operating_minor": total_operating,
        "remaining_capital_minor": selected["remaining_capital"]["amount_minor"],
        "capital_minor": capital,
        "annual_operating_forecast_minor": selected["annual_operating"]["amount_minor"],
        "included_actual_rows": sum(row["decision"]["classification"] != "exclude" for row in rows),
        "excluded_rows": sum(row["decision"]["classification"] == "exclude" for row in rows),
        "budget_minor": context["candidate_ledger_totals_minor"]["budget"],
        "commitment_minor": context["candidate_ledger_totals_minor"]["commitment"],
        "actual_minor": context["candidate_ledger_totals_minor"]["actual"],
        "horizon_years": selected["financial_parameters"]["horizon_years"],
        "discount_rate": selected["financial_parameters"]["discount_rate"],
        "scope": deepcopy(selected["scope"]), "calculated_cost": None,
        "original_cost_summary": deepcopy(context["original_cost_summary"]),
    }
    proposed = deepcopy(original_input)
    proposed_cost = deepcopy(inherited) if inherited is not None else {}
    bound_scope = deepcopy(selected["scope"])
    if bound_scope["kind"] == "reporting_zone":
        bound_scope.update(producer_report_id=context["binding"]["report_id"],
                           zone_id=context["binding"]["zone_id"])
    proposed_cost.update({
        "run_id": context["binding"]["run_id"], "currency": "USD",
        "capital": capital_dollars, "annual_operating": annual_dollars,
        "horizon_years": selected["financial_parameters"]["horizon_years"],
        "discount_rate": selected["financial_parameters"]["discount_rate"],
        "scope": bound_scope,
        "source": {
            "title": "Reviewed FIELD12 costs — " + context["plan"]["title"],
            "uri": ("implementation/plans/" + context["binding"]["plan_id"] +
                    "/revisions/" + ("%016d.json" % context["binding"]["revision"]) +
                    "#cost-review-" + operation_id),
            "as_of": selected["as_of"],
        },
        "note": selected["note"],
        "field12_cost_review": {"operation_id": operation_id,
                               "source_pointer": "/field12_cost_reviews/" + operation_id},
    })
    costs = proposed["selection"].setdefault("costs", [])
    replaced = False
    for index, cost in enumerate(costs):
        if cost["run_id"] == proposed_cost["run_id"]:
            costs[index] = proposed_cost
            replaced = True
            break
    if not replaced:
        costs.append(proposed_cost)
    reviews = proposed["selection"].setdefault("field12_cost_reviews", {})
    if not isinstance(reviews, dict):
        issues.append(_issue("retained_review_shape", "The original selection has an incompatible field12_cost_reviews value"))
    elif operation_id in reviews and reviews[operation_id] != audit:
        issues.append(_issue("retained_review_identity", "This review identity already names another retained source record"))
    else:
        reviews[operation_id] = audit
    if capital_dollars is not None:
        try:
            summary["calculated_cost"] = _costs(
                {"costs": [proposed_cost]}, {proposed_cost["run_id"]})[proposed_cost["run_id"]]
        except (ValueError, KeyError, OverflowError) as error:
            issues.append(_issue("economic_cost_input", str(error)))
    audit["summary"] = deepcopy(summary)
    audit["issues"] = deepcopy(issues)
    can_apply = not any(issue["severity"] == "error" for issue in issues)
    return {
        "schema": PREVIEW_SCHEMA, "edition": EDITION, "operation_id": operation_id,
        "binding": deepcopy(context["binding"]), "context": context,
        "review": selected, "summary": summary, "issues": issues,
        "can_apply": can_apply, "proposed_input": proposed if can_apply else None,
        "source_audit": audit,
    }

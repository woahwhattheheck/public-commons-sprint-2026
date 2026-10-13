"""MIT. Customer-portfolio source basis for the original finite review cycle.
No store, case mutation or provider operation is introduced here.
"""
from __future__ import annotations
from copy import deepcopy
from model import InputError, stable, load_json
import portfolio_refresh as refresh

KIND = "portfolio_refresh"


def _need(condition, message):
    if not condition:
        raise InputError(message)


def selected_cases(domain, comparison_id):
    comparison = refresh._comparison(domain, comparison_id)
    entity_ids = {row["entityId"] for row in comparison["rows"]}
    cases = [load_json(row[0]) for row in domain.db.execute("SELECT body FROM os_cases ORDER BY id")]
    return [case for case in cases if not case.get("mergedInto") and
            case["portfolioKey"] == comparison["portfolioKey"] and
            case["portfolio"] in {comparison["before"], comparison["after"]} and
            case["counterpartyId"] in entity_ids]


def basis(domain, comparison_id, cases, verified=None):
    from review_cycles import case_event
    comparison = refresh._comparison(domain, comparison_id)
    rows = {row["entityId"]: row for row in comparison["rows"]}
    result = []
    for case in cases:
        _need(not case.get("mergedInto") and case["portfolioKey"] == comparison["portfolioKey"] and
              case["portfolio"] in {comparison["before"], comparison["after"]} and case["counterpartyId"] in rows,
              "Cycle cases must belong to the exact selected customer portfolio pair")
        _need(stable(case_event(domain, case["revision"], verified)["value"]) == stable(case),
              "The customer cycle lost its complete original case history")
        row = deepcopy(rows[case["counterpartyId"]])
        result.append({"case": deepcopy(case), "customerChange": row,
                       "changes": [row["entityId"]], "currentIds": deepcopy(case.get("resolvedCurrentIds", [])),
                       "identityReview": False, "relevanceReview": False,
                       "reasons": ["Customer portfolio attributes: " + row["kind"],
                                   "Complete this assignment with an explicit original portfolio retain or continue review. "
                                   "Cycle completion does not decide identity or relevance."]})
    return {"sourceKind": KIND, "comparison": comparison,
            "beforePortfolio": deepcopy(comparison["originalSources"][0]["portfolio"]),
            "afterPortfolio": deepcopy(comparison["originalSources"][1]["portfolio"]),
            "populationScope": {"portfolioKey": comparison["portfolioKey"],
                                "selection": "All retained unmerged cases on either selected portfolio at creation",
                                "counterpartyPopulation": comparison["population"]},
            "caseSnapshots": sorted(deepcopy(cases), key=lambda case: case["id"]),
            "population": {"comparison": comparison_id, "rows": sorted(result, key=lambda row: row["case"]["id"])}}


def observe_completion(domain, request_id):
    if request_id is None:
        return None
    value = refresh.operation(domain, request_id)
    _need(value["committed"], "Save the explicit original portfolio review before completing its assignment")
    return value["event"]


def verify_completion(domain, state, item, command, observed, case):
    body = command["body"]
    request_id = body["portfolioReviewRequestId"]
    if request_id is None:
        _need(body["disposition"] == "FOLLOW_UP" and observed is None,
              "A completed customer review must name its original portfolio review request")
        return
    event = observe_completion(domain, request_id)
    _need(stable(event) == stable(observed), "The original portfolio review observation changed")
    request = event["request"]
    _need(request["comparisonId"] == state["basis"]["comparison"]["id"] and
          request.get("caseId") == item["caseId"] and
          request["entityId"] == case["counterpartyId"] and
          request["decision"] in {"retain", "continue"},
          "Use the original retain or continue decision for this exact customer case and portfolio pair")
    reviewed_case = event["afterCase"] or event["beforeCase"]
    _need(stable(reviewed_case) == stable(case),
          "The case changed after its portfolio review; review that exact current revision before completion")
    _need(request["reviewer"] == command["actor"]["name"],
          "The assigned reviewer's name must match the original attributed portfolio review")
    from review_cycles import instant
    _need(event["createdAt"] <= instant(command["at"]),
          "Cycle completion cannot precede the original portfolio review")
    frozen = item["impact"]["case"]
    if body["disposition"] == "REVIEWED":
        _need(case["edition"] == frozen["edition"] and case["candidateId"] == frozen["candidateId"] and
              stable(case["monitoring"]) == stable(frozen["monitoring"]),
              "The source candidate or monitoring scope changed; retain follow-up or create an explicitly selected new cycle")
    _need(case["portfolioKey"] == frozen["portfolioKey"] and case["counterpartyId"] == frozen["counterpartyId"],
          "The original customer identity differs from the frozen cycle")


def choices(domain, comparison_id):
    """Compact original event choices; full records remain in their native history."""
    with domain.mutex:
        comparison = refresh._comparison(domain, comparison_id)
        result = []
        for event in refresh._events(domain, comparison_id):
            request = event["request"]
            if request["decision"] not in {"retain", "continue"}:
                continue
            refresh._verify_event(domain, event, {comparison_id: comparison})
            case = event["afterCase"] or event["beforeCase"]
            result.append({"requestId": request["requestId"], "caseId": request["caseId"],
                           "caseRevision": case["revision"], "entityId": request["entityId"],
                           "decision": request["decision"], "reviewer": request["reviewer"],
                           "createdAt": event["createdAt"], "reason": request["reason"]})
        return {"comparisonId": comparison_id, "rows": result}

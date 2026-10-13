"""Accepted SF74 task meaning for the original Installation effort engine.

This is a source adapter. Original Operations Work, Installation snapshots and
the existing decimal effort report remain the quantity and persistence engines.
Commercial prices or task quantities are never converted into quoted hours.
"""
from __future__ import annotations

from copy import deepcopy

from model import Problem, digest

SOURCE_KIND = "COMMERCIAL"


def fail(message):
    raise Problem(message, 422, "INVALID_COMMERCIAL_INSTALLATION_EFFORT")


def selected(document):
    return document.get("commercial") is not None


def is_source(source):
    return source.get("sourceKind") == SOURCE_KIND


def phase_ids(document):
    binding = document.get("commercial")
    if not binding or document.get("workshare") is not None:
        fail("Select one original accepted quotation Installation.")
    return [row["taskId"] for row in binding["taskChecks"]]


def links(document):
    return {row["taskId"]: row["checkId"] for row in document["commercial"]["taskChecks"]}


def identity(source):
    return {key: deepcopy(source[key]) for key in (
        "caseId", "caseKey", "quoteId", "quoteSha256", "acceptanceId",
        "acceptanceSha256", "scopeSha256", "sourceId", "sourceSha256")}


def source_value(original, document):
    if not original or not isinstance(original.get("selected"), dict):
        fail("Retain the complete original accepted quotation before reviewing its delivery effort.")
    binding, native = document["commercial"], original["selected"]
    quote, scope = native["quote"], native["scope"]
    tasks = scope["tasks"]
    if {row["id"] for row in tasks} != set(phase_ids(document)):
        fail("Retain every native accepted task in its original Installation.")
    # verify_document/resolve_binding already validated the complete source and
    # native task definitions. Copy those meanings without deriving effort.
    return {"sourceKind": SOURCE_KIND, "caseId": quote["originCaseId"],
        **{key: deepcopy(binding[key]) for key in (
            "caseKey", "quoteId", "quoteSha256", "acceptanceId",
            "acceptanceSha256", "scopeSha256", "sourceId", "sourceSha256")},
        "title": scope["title"], "customer": scope["payer"],
        "tasks": deepcopy(tasks), "scope": deepcopy(scope)}


def phase_source(source, document):
    checks = {row["id"]: row for row in document["checks"]}
    bindings = links(document)
    phases = []
    for task in source["tasks"]:
        check = checks[bindings[task["id"]]]
        phases.append({"phaseId": task["id"], "taskId": task["id"],
            "title": task["title"], "quotedHours": None,
            "owner": deepcopy(task["definition"].get("owner", "")),
            "dependsOn": deepcopy(task["dependencies"]), "businessDays": None,
            "terms": deepcopy(task), "definitionSha256": task["definitionSha256"],
            "checkId": check["id"], "checkState": check["state"],
            "checkOperator": check["operator"], "checkObservedAt": check["observedAt"]})
    return {"sourceKind": SOURCE_KIND, "commercial": identity(source),
        "caseId": source["caseId"], "title": source["title"],
        "customer": source["customer"], "quotedHours": None,
        "sourceId": source["sourceId"], "sourceSha256": source["sourceSha256"],
        "phases": phases, "scope": deepcopy(source["scope"]),
        "effortBasis": "The accepted quotation retains task definitions and fees; it does not bind task effort. Select a separate sealed private assessment to compare planned hours."}


def retained_source_context(source, document, previous, snapshot_key):
    if document["effort"]["supportWindows"]:
        fail("Commercial task effort has no quoted support-phase allowance. Keep original recurring service terms in their own workflow; do not infer support hours or dates from fees.")
    before = previous["preview"] if previous else None
    frozen = before["snapshot"].get(snapshot_key, {}) if before else {}
    old_source = frozen.get("source")
    if old_source is not None and (not is_source(old_source) or old_source["caseKey"] != source["caseKey"]):
        fail("Keep this effort review with its original accepted quotation family.")
    retired_index = {row["phaseId"]: deepcopy(row) for row in frozen.get("retiredPhases", [])}
    if old_source is not None:
        old_checks = {row["id"]: row for row in before["document"]["checks"]}
        for phase in phase_source(old_source, before["document"])["phases"]:
            retired_index[phase["phaseId"]] = {
                "phaseId": phase["phaseId"], "title": phase["title"],
                "quotedHours": None, "terms": deepcopy(phase["terms"]),
                "sourceId": old_source["sourceId"], "sourceSha256": old_source["sourceSha256"],
                "scopeSha256": old_source["scopeSha256"],
                "check": deepcopy(old_checks[phase["checkId"]]),
                "commercialPhase": deepcopy(phase), "commercial": identity(old_source)}
    used = {row["phaseId"] for row in document["effort"]["allocations"]}
    used.update(row["phaseId"] for row in document["effort"]["reviews"])
    current = {row["id"] for row in source["tasks"]}
    retired = []
    for ident in sorted(used - current):
        if ident not in retired_index:
            fail("A retained commercial task must come from this Installation's saved accepted source history.")
        retired.append(deepcopy(retired_index[ident]))
    return retired, []


def retired_phase(row):
    value = deepcopy(row["commercialPhase"])
    value.update({"retired": True, "originalScopeSha256": row["scopeSha256"],
                  "originalCommercial": deepcopy(row["commercial"])})
    return value


def review_basis(source, document, phase_id, selected_work):
    task = next((row for row in source["tasks"] if row["id"] == phase_id), None)
    return digest({"schema": "stellar-forge.sf47-installation-effort.v1",
        "sourceKind": SOURCE_KIND, "commercial": identity(source),
        "phaseId": phase_id, "definitionSha256": task["definitionSha256"] if task else None,
        "asOfDate": document["effort"]["asOfDate"], "allocations": selected_work})


def report_identity(source):
    return {"sourceKind": SOURCE_KIND, "commercial": identity(source),
        "effortBasis": "Quoted task effort is unspecified. Recorded Work, internally accepted Work and reviewed remaining estimates retain separate meanings."}

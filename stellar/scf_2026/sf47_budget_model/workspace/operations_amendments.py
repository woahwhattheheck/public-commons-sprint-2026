"""Reviewed baseline amendments in the existing SF47 operations transaction.

The native planner remains the calculation and revision authority. This module
selects its saved revisions and retains complete amendment decisions. Explicit
package mappings change only budget attribution on existing work, invoice and
deployment records; original observations remain in the complete case history.
"""
from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
import io
import json
import re
import uuid
import zipfile

from model import Problem, canonical, digest, now, text, csv_bytes, MAX_BUNDLE
import operations_domain as domain
import operations_completion as completion

SCHEMA = "stellar-forge.sf47-plan-amendment.v1"
PREVIEW_SCHEMA = SCHEMA + ".preview"
MAX_AMENDMENTS = 50
MAX_EDITIONS = 300
MAX_HISTORY_BYTES = 12 * 1024 * 1024
MAX_CHANGES = 10000
ACTIONS = ("amendment.save", "amendment.review", "amendment.apply")
PLAN_FIELDS = ("source", "revision", "scenario", "planning", "report",
               "savedAt", "note", "contentSha256")
INPUT_FIELDS = ("selectedRevision", "expectedContentSha256", "asOfDate",
                "reason", "basis", "packageMappings")
BASIS_FIELDS = ("kind", "reference", "date", "sourceIds", "note")
DECISIONS = ("APPROVE", "RETURN_FOR_CHANGES")
STATES = ("PROPOSED", "REVIEWED", "CHANGES_REQUESTED", "APPLIED")


def fail(message, code="INVALID_AMENDMENT", status=422):
    raise Problem(message, status, code)


def obj(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        fail("Use the declared " + label + " object.")
    return value


def identity(value):
    if not isinstance(value, str) or not re.fullmatch(r"amendment-[a-f0-9]{32}", value):
        fail("Select the original retained amendment identity.")
    return value


def seal(value):
    result = {key: deepcopy(item) for key, item in value.items() if key != "sha256"}
    return {**result, "sha256": digest(result)}


def plan_core(plan):
    if not isinstance(plan, dict) or any(key not in plan for key in PLAN_FIELDS):
        fail("Keep the complete selected native planning revision.", "AMENDMENT_PLAN_SOURCE")
    domain.integer(plan["revision"], "Selected planning revision", 1, 1000000)
    domain.sha(plan["contentSha256"], "Selected planning content", False)
    if digest({"scenario": plan["scenario"], "planning": plan["planning"]}) != plan["contentSha256"]:
        fail("The selected native planning content changed.", "AMENDMENT_PLAN_SOURCE", 409)
    if not isinstance(plan["source"], dict):
        fail("Keep the original planning source identity.", "AMENDMENT_PLAN_SOURCE")
    domain.sha(plan["source"].get("sha256"), "Original planning source", False)
    return {key: deepcopy(plan[key]) for key in PLAN_FIELDS}


def same_plan(left, right):
    return plan_core(left) == plan_core(right)


def plan_pin(plan):
    plan_core(plan)
    return {"revision": plan["revision"], "contentSha256": plan["contentSha256"],
            "sourceSha256": plan["source"]["sha256"]}


def stable_plan(plan):
    """A selected revision is independent of the mutable latest-revision label."""
    plan_core(plan)
    result = deepcopy(plan)
    result["currentRevision"] = result["revision"]
    return result


def install(db):
    db.execute("""CREATE TABLE IF NOT EXISTS ops_plan_amendments(
        program_id TEXT NOT NULL REFERENCES ops_programs(id),id TEXT NOT NULL,
        revision INTEGER NOT NULL,version INTEGER NOT NULL,body_json TEXT NOT NULL,
        PRIMARY KEY(program_id,id,revision),UNIQUE(program_id,version))""")


def load(ops, program_id):
    return [json.loads(row[0]) for row in ops.db.execute(
        "SELECT body_json FROM ops_plan_amendments WHERE program_id=? ORDER BY version",
        (program_id,))]


def heads(rows):
    current = {}
    for row in rows:
        old = current.get(row["id"])
        if old is None or row["revision"] > old["revision"]:
            current[row["id"]] = row
    return sorted(current.values(), key=lambda row: (row["version"], row["id"]), reverse=True)


def selected(ops, program_id, amendment_id, revision=None):
    amendment_id = identity(amendment_id)
    if revision is None:
        row = ops.db.execute(
            "SELECT body_json FROM ops_plan_amendments WHERE program_id=? AND id=? ORDER BY revision DESC LIMIT 1",
            (program_id, amendment_id)).fetchone()
    else:
        revision = domain.integer(revision, "Amendment edition", 1, MAX_EDITIONS)
        row = ops.db.execute(
            "SELECT body_json FROM ops_plan_amendments WHERE program_id=? AND id=? AND revision=?",
            (program_id, amendment_id, revision)).fetchone()
    if not row:
        fail("The selected amendment edition is unavailable.", "AMENDMENT_NOT_FOUND", 404)
    value = json.loads(row[0])
    if seal(value)["sha256"] != value.get("sha256"):
        fail("The retained amendment edition changed.", "AMENDMENT_CHANGED", 409)
    return value


def summary(row, context=None, business=None):
    result = {key: deepcopy(row[key]) for key in
              ("id", "revision", "version", "state", "createdAt", "updatedAt", "actor", "note", "sha256")}
    original = row["preview"]
    result.update({"fromPlan": plan_pin(original["snapshot"]["plan"]),
                   "selectedPlan": plan_pin(original["selectedPlan"]),
                   "reason": original["inputs"]["reason"],
                   "basis": deepcopy(original["inputs"]["basis"]),
                   "previewSha256": original["previewSha256"],
                   "compatible": original["compatibility"]["compatible"],
                   "blockerCount": len(original["compatibility"]["blockers"])})
    if context is not None:
        result["current"] = {
            "caseVersion": context["program"]["version"],
            "baselineMatches": same_plan(context["plan"], original["snapshot"]["plan"]),
            "businessMatches": business == original["source"]["businessSha256"],
            "isCurrentBaseline": row["state"] == "APPLIED"
                and same_plan(context["plan"], original["selectedPlan"])}
    return result


def normalize_inputs(context, value):
    value = obj(value, INPUT_FIELDS, "amendment selection")
    basis = obj(value.get("basis"), BASIS_FIELDS, "amendment basis")
    kind = domain.enum(basis.get("kind"), ("INTERNAL_PLAN", "ISSUER_DECISION", "CUSTOMER_DECISION", "WALKTHROUGH"),
                       "Amendment basis")
    if kind == "WALKTHROUGH" and context["program"]["mode"] != "WALKTHROUGH":
        fail("Use a labelled walkthrough case for a walkthrough decision.")
    source_ids = domain.reference_list(basis.get("sourceIds", []), context["sources"], "Amendment sources")
    reference = text(basis.get("reference", ""), "Original decision reference", 4000)
    decision_date = domain.calendar(basis.get("date"), "Original decision date", True)
    if kind in ("ISSUER_DECISION", "CUSTOMER_DECISION") and (not source_ids or not reference or not decision_date):
        fail("Select the retained decision document, its original reference and decision date.",
             "AMENDMENT_DECISION_SOURCE")
    result = {
        "selectedRevision": domain.integer(value.get("selectedRevision"), "Selected native revision", 1, 1000000),
        "expectedContentSha256": domain.sha(value.get("expectedContentSha256"), "Reviewed native planning content", False),
        "asOfDate": domain.calendar(value.get("asOfDate"), "Amendment comparison date"),
        "reason": text(value.get("reason"), "Reason for this planning amendment", 12000, True),
        "basis": {"kind": kind, "reference": reference, "date": decision_date,
                  "sourceIds": source_ids, "note": text(basis.get("note", ""), "Decision source note", 12000)}}
    # Omission preserves the exact original proposal contract and saved hashes.
    # An explicit collection selects the reviewed attribution/reconciliation flow.
    if "packageMappings" in value:
        mappings = value["packageMappings"]
        costs = {row["id"] for row in context["plan"]["scenario"]["future_costs"]}
        if not isinstance(mappings, list) or len(mappings) > len(costs):
            fail("Map each original package at most once.", "INVALID_AMENDMENT_MAPPING")
        prepared, seen = [], set()
        for mapping in mappings:
            obj(mapping, ("fromCostId", "toCostId", "note"), "package attribution")
            old, new = mapping.get("fromCostId"), mapping.get("toCostId")
            if (not isinstance(old, str) or old not in costs or old in seen
                    or "toCostId" not in mapping or not (new is None or isinstance(new, str))):
                fail("Choose a distinct original package and an explicit target or null for unassigned attribution.",
                     "INVALID_AMENDMENT_MAPPING")
            seen.add(old)
            prepared.append({"fromCostId": old, "toCostId": new,
                             "note": text(mapping.get("note"), "Package attribution reason", 4000, True)})
        result["packageMappings"] = sorted(prepared, key=lambda row: row["fromCostId"])
    return result


def changes(before, after):
    result = []
    missing = object()
    def visit(left, right, pointer):
        if left is not missing and right is not missing and left == right:
            return
        if isinstance(left, dict) and isinstance(right, dict):
            for key in sorted(set(left) | set(right)):
                visit(left.get(key, missing), right.get(key, missing),
                      pointer + "/" + key.replace("~", "~0").replace("/", "~1"))
            return
        if isinstance(left, list) and isinstance(right, list):
            for index in range(max(len(left), len(right))):
                visit(left[index] if index < len(left) else missing,
                      right[index] if index < len(right) else missing, pointer + "/" + str(index))
            return
        if len(result) >= MAX_CHANGES:
            fail("The amendment exceeds the complete change-table bound.", "AMENDMENT_LIMIT", 413)
        result.append({"path": pointer, "beforePresent": left is not missing,
                       "afterPresent": right is not missing,
                       "before": None if left is missing else deepcopy(left),
                       "after": None if right is missing else deepcopy(right)})
    visit(before, after, "")
    return result


def compatibility(context, target):
    before = {row["id"]: row for row in context["plan"]["scenario"]["future_costs"]}
    after = {row["id"]: row for row in target["scenario"]["future_costs"]}
    blockers, references = [], {}
    def reference(cost_id, kind, record_id):
        if cost_id:
            references.setdefault(cost_id, []).append({"kind": kind, "id": record_id})
    for row in context["records"]["work"]:
        reference(row.get("costId"), "work", row["id"])
    for row in context["records"]["invoices"]:
        for line in row["lines"]:
            reference(line.get("costId"), "invoice", row["id"] + "/" + line["id"])
    for row in context["records"]["deployments"]:
        for cost_id in row["costIds"]:
            reference(cost_id, "deployment", row["id"])
    for row in context.get("completionPlans", []):
        expected = [item["costId"] for item in row["inputs"]["items"]]
        supplied = [item["id"] for item in target["scenario"]["future_costs"] if item["tranche"] == row["tranche"]]
        if expected != supplied:
            blockers.append({"code": "COMPLETION_PACKAGE_SET", "tranche": row["tranche"], "id": row["id"],
                             "message": "The saved completion assignment needs its original ordered package set.",
                             "before": expected, "after": supplied})
        for item in row["inputs"]["items"]:
            reference(item["costId"], "completion", row["id"])
            if item["state"] == "COMPLETE" and item["costId"] in after:
                fields = ("remaining_work", "measurable_proof")
                if any(before.get(item["costId"], {}).get(key) != after[item["costId"]].get(key) for key in fields):
                    blockers.append({"code": "COMPLETED_SCOPE", "id": item["costId"],
                        "message": "The new scope would reinterpret an already completed deliverable.",
                        "references": [{"kind": "completion", "id": row["id"]}]})
    for cost_id, links in sorted(references.items()):
        if cost_id not in after:
            blockers.append({"code": "REFERENCED_PACKAGE_REMOVED", "id": cost_id, "references": links,
                             "message": "Keep the work package referenced by these retained records."})
        elif cost_id not in before or after[cost_id]["tranche"] != before[cost_id]["tranche"]:
            blockers.append({"code": "REFERENCED_PACKAGE_TRANCHE", "id": cost_id, "references": links,
                             "message": "A retained package cannot silently change its tranche."})
    before_milestones = {row["tranche"]: row for row in context["plan"]["scenario"]["milestones"]}
    after_milestones = {row["tranche"]: row for row in target["scenario"]["milestones"]}
    for outcome in context["records"]["outcomes"]:
        if outcome["state"] not in ("SUBMITTED", "ACCEPTED"):
            continue
        number = outcome["tranche"]
        fields = ("deliverable", "measurable_proof")
        old_costs = [(item["id"], item.get("remaining_work"), item.get("measurable_proof"))
                     for item in before.values() if item["tranche"] == number]
        new_costs = [(item["id"], item.get("remaining_work"), item.get("measurable_proof"))
                     for item in after.values() if item["tranche"] == number]
        if (old_costs != new_costs or any(before_milestones[number].get(key) !=
                after_milestones[number].get(key) for key in fields)):
            blockers.append({"code": "SUBMITTED_SCOPE", "tranche": number, "id": outcome["id"],
                "message": "The selected scope differs from this submitted or accepted outcome. Resolve its original delivery decision first."})
    revised_context = {**context, "plan": target, "restoring": True}
    for kind, values in context["records"].items():
        for row in values:
            try:
                prepared = domain.prepare(kind, row, revised_context, row)
                if any(key != "state" and row.get(key) != value for key, value in prepared.items()):
                    blockers.append({"code": "RECORD_BINDING_CHANGED", "kind": kind, "id": row["id"],
                                     "message": "This retained record would change under the selected plan."})
            except Problem as exc:
                blockers.append({"code": "RECORD_BINDING_UNRESOLVED", "kind": kind, "id": row["id"],
                                 "message": str(exc)})
    return {"compatible": not blockers, "blockers": blockers,
            "references": [{"costId": key, "records": links} for key, links in sorted(references.items())],
            "recordCounts": {kind: len(values) for kind, values in context["records"].items()},
            "recordsSha256": digest(context["records"]),
            "caseCalendarStart": context["program"].get("calendarStart"),
            "selectedPlanningCalendarStart": target["planning"].get("calendarStart")}


def mapped_records(context, target, mappings):
    """Project only explicitly reviewed attribution; retain all observation fields."""
    costs = {row["id"] for row in target["scenario"]["future_costs"]}
    mapping = {row["fromCostId"]: row["toCostId"] for row in mappings}
    if any(ident is not None and ident not in costs for ident in mapping.values()):
        fail("Every mapped destination must exist in the selected native revision.", "INVALID_AMENDMENT_MAPPING")
    records = deepcopy(context["records"])
    changes = []
    for kind in ("work", "invoices", "deployments"):
        for index, before in enumerate(context["records"][kind]):
            after = deepcopy(before)
            if kind == "work" and after.get("costId") in mapping:
                after["costId"] = mapping[after["costId"]]
            elif kind == "invoices":
                for line in after["lines"]:
                    if line.get("costId") in mapping:
                        line["costId"] = mapping[line["costId"]]
            elif kind == "deployments":
                after["costIds"] = list(dict.fromkeys(mapping.get(ident, ident)
                    for ident in after["costIds"] if mapping.get(ident, ident) is not None))
            if after != before:
                records[kind][index] = after
                changes.append({"kind": kind, "recordId": before["id"],
                                "before": deepcopy(before), "after": after})
    return records, changes


def mapped_compatibility(context, target, mappings, records, record_changes):
    before = {row["id"]: row for row in context["plan"]["scenario"]["future_costs"]}
    after = {row["id"]: row for row in target["scenario"]["future_costs"]}
    mapping = {row["fromCostId"]: row["toCostId"] for row in mappings}
    # Keep the original complete references and submitted/accepted scope rules.
    # Saved completion assignments remain historical and receive a new draft.
    original = compatibility(context, target)
    replaced = {"COMPLETION_PACKAGE_SET", "COMPLETED_SCOPE", "REFERENCED_PACKAGE_REMOVED",
                "REFERENCED_PACKAGE_TRANCHE", "RECORD_BINDING_CHANGED", "RECORD_BINDING_UNRESOLVED"}
    blockers = [item for item in original["blockers"] if item["code"] not in replaced]
    for reference in original["references"]:
        ident = reference["costId"]
        actual = [row for row in reference["records"] if row["kind"] != "completion"]
        if not actual or ident in mapping:
            continue
        if ident not in after:
            blockers.append({"code": "PACKAGE_MAPPING_REQUIRED", "id": ident, "references": actual,
                             "message": "Map this retired package to a selected package or explicitly choose unassigned attribution."})
        elif ident not in before or after[ident]["tranche"] != before[ident]["tranche"]:
            blockers.append({"code": "PACKAGE_TRANCHE_MAPPING_REQUIRED", "id": ident, "references": actual,
                             "message": "Record an explicit mapping for this tranche change; select the same package to retain its identity."})
    revised = {**context, "plan": target, "records": records, "restoring": True}
    for kind, values in records.items():
        for row in values:
            try:
                prepared = domain.prepare(kind, row, revised, row)
                if any(key != "state" and row.get(key) != value for key, value in prepared.items()):
                    blockers.append({"code": "RECORD_BINDING_CHANGED", "kind": kind, "id": row["id"],
                                     "message": "The selected attribution would change another original record field."})
            except Problem as exc:
                blockers.append({"code": "RECORD_BINDING_UNRESOLVED", "kind": kind, "id": row["id"],
                                 "message": str(exc)})
    return {**original, "compatible": not blockers, "blockers": blockers,
            "projectedRecordsSha256": digest(records),
            "attributionRecordCount": len(record_changes)}


def retained_selection_reviews(context, target, mappings):
    after = {row["id"]: row for row in target["scenario"]["future_costs"]}
    before = {row["id"]: row for row in context["plan"]["scenario"]["future_costs"]}
    mapping = {row["fromCostId"]: row["toCostId"] for row in mappings}
    result = []
    for row in context.get("completionPlans", []):
        ids = [item["costId"] for item in row["inputs"]["items"]]
        result.append({"kind": "completion", "id": row["id"], "version": row["version"],
            "tranche": row["tranche"], "originalCostIds": ids,
            "currentCostIds": [item["id"] for item in target["scenario"]["future_costs"]
                               if item["tranche"] == row["tranche"]],
            "retiredCostIds": [ident for ident in ids if ident not in after],
            "changedCostIds": [ident for ident in ids if ident in after and before.get(ident) != after[ident]],
            "message": "The saved assignments retain their original plan. Open Completion to review and save the draft for this revision."})
    for row in context.get("installationRefs", []):
        result.append({"kind": "installation", "id": row["id"], "revision": row["revision"],
            "message": "This exact saved installation edition retains its original plan. Review its package and phase assignments when preparing a subsequent edition."})
    return result


def applied_record_changes(candidate, version, stamp):
    return [{**deepcopy(change), "after": {**deepcopy(change["after"]), "version": version, "updatedAt": stamp}}
            for change in candidate.get("recordChanges", [])]


def event_summary(row):
    result = summary(row)
    application = row.get("application") or {}
    if application.get("recordChanges"):
        result["recordChanges"] = deepcopy(application["recordChanges"])
    return result


def exposure(report):
    """Native recorded invoices/payments compared with this selected plan.

    These quantities do not infer unrecorded contracts, unpaid future work or
    spendable cash. Unknown planned hours remain unknown.
    """
    result = []
    for package in report["packages"]:
        planned = Decimal(package["plannedUsd"])
        invoiced = Decimal(package["invoicedUsd"])
        paid = Decimal(package["paidUsd"])
        planned_hours = (None if package.get("plannedHours") in (None, "")
                         else Decimal(str(package["plannedHours"])))
        recorded_hours = Decimal(str(package["recordedHours"]))
        result.append({
            "costId": package["id"], "tranche": package["tranche"],
            "plannedUsd": format(planned, ".2f"), "recordedInvoiceUsd": format(invoiced, ".2f"),
            "recordedPaidUsd": format(paid, ".2f"),
            "remainingBeforeRecordedInvoicesUsd": format(max(Decimal(0), planned - invoiced), ".2f"),
            "recordedInvoicesOverPlanUsd": format(max(Decimal(0), invoiced - planned), ".2f"),
            "remainingBeforeRecordedPaymentsUsd": format(max(Decimal(0), planned - paid), ".2f"),
            "recordedPaymentsOverPlanUsd": format(max(Decimal(0), paid - planned), ".2f"),
            "plannedHours": None if planned_hours is None else str(planned_hours),
            "recordedHours": str(recorded_hours),
            "remainingBeforeRecordedHours": None if planned_hours is None else str(max(Decimal(0), planned_hours - recorded_hours)),
            "recordedHoursOverPlan": None if planned_hours is None else str(max(Decimal(0), recorded_hours - planned_hours))})
    return result


def _without_version(report):
    return {key: deepcopy(value) for key, value in report.items() if key != "version"}


def _preview(ops, context, inputs, target):
    original = normalize_inputs(context, inputs)
    target = stable_plan(target)
    if (target["revision"] != original["selectedRevision"]
            or target["contentSha256"] != original["expectedContentSha256"]
            or target["source"] != context["plan"]["source"]):
        fail("The selected native revision differs from the reviewed planning source.",
             "AMENDMENT_PLAN_SOURCE", 409)
    if same_plan(context["plan"], target):
        fail("Select a different saved planning revision.", "AMENDMENT_UNCHANGED", 409)
    amended_context = {**deepcopy(context), "plan": target,
                       "program": {**deepcopy(context["program"]), "planRevision": target["revision"]}}
    record_changes = []
    if "packageMappings" in original:
        amended_context["records"], record_changes = mapped_records(context, target, original["packageMappings"])
    native_before = domain.report(**context)
    native_after = domain.report(**amended_context)
    clocks_before = completion.dashboard(context, original["asOfDate"])["clocks"]
    clocks_after = completion.dashboard(amended_context, original["asOfDate"])["clocks"]
    if clocks_before != clocks_after:
        fail("The amendment would change an original payment-derived clock.",
             "AMENDMENT_CLOCK_CHANGED", 409)
    source = {"programId": context["program"]["id"],
              "businessSha256": digest(ops._business(context)),
              "plan": plan_pin(context["plan"]),
              "decisionSources": [deepcopy(context["sources"][ident]) for ident in original["basis"]["sourceIds"]]}
    result = {"schema": PREVIEW_SCHEMA, "observedVersion": context["program"]["version"],
              "inputs": original, "source": source,
              "snapshot": deepcopy(context), "selectedPlan": target,
              "changes": changes(
                  {"scenario": context["plan"]["scenario"], "planning": context["plan"]["planning"]},
                  {"scenario": target["scenario"], "planning": target["planning"]}),
              "compatibility": (mapped_compatibility(context, target, original["packageMappings"],
                    amended_context["records"], record_changes) if "packageMappings" in original
                    else compatibility(context, target)),
              "reports": {"before": native_before, "selected": native_after},
              "exposure": {"before": exposure(native_before), "selected": exposure(native_after)},
              "paymentClocks": deepcopy(clocks_before)}
    if "packageMappings" in original:
        result["recordChanges"] = record_changes
        result["retainedSelectionReviews"] = retained_selection_reviews(context, target, original["packageMappings"])
    # Saving and reviewing an amendment advances the case version without changing
    # its business data. Such own workflow events must not implicitly rebase a
    # changed case, or invalidate an otherwise identical reviewed selection.
    fingerprint = {key: deepcopy(result[key]) for key in
                   ("schema", "inputs", "source", "changes", "compatibility", "paymentClocks", "exposure")}
    if "packageMappings" in original:
        fingerprint["recordChanges"] = deepcopy(result["recordChanges"])
        fingerprint["retainedSelectionReviews"] = deepcopy(result["retainedSelectionReviews"])
    fingerprint["selectedPlan"] = plan_core(target)
    fingerprint["reports"] = {key: _without_version(value) for key, value in result["reports"].items()}
    result["previewSha256"] = digest(fingerprint)
    return result


def preview(ops, context, inputs):
    chosen = normalize_inputs(context, inputs)
    for source_id in chosen["basis"]["sourceIds"]:
        ops.source(context["program"]["id"], source_id)
    target = ops.workspace._read(context["program"]["planId"], chosen["selectedRevision"])
    return _preview(ops, context, chosen, target)


def view(ops, context):
    rows = load(ops, context["program"]["id"])
    business = digest(ops._business(context))
    return {"schema": SCHEMA, "program": deepcopy(context["program"]),
            "currentPlan": plan_pin(context["plan"]),
            "revisions": ops.workspace.history(context["program"]["planId"]),
            "amendments": [summary(row, context, business) for row in heads(rows)],
            "applied": [summary(row) for row in rows if row["state"] == "APPLIED"],
            "sources": list(deepcopy(context["sources"]).values())}


def _save_row(ops, program_id, value):
    raw = canonical(value)
    size, count = ops.db.execute(
        "SELECT COALESCE(SUM(length(CAST(body_json AS BLOB))),0),COUNT(*) FROM ops_plan_amendments WHERE program_id=?",
        (program_id,)).fetchone()
    if count >= MAX_EDITIONS or size + len(raw.encode()) > MAX_HISTORY_BYTES:
        fail("The retained amendment history exceeds its complete handover bound.", "AMENDMENT_LIMIT", 413)
    ops.db.execute("INSERT INTO ops_plan_amendments VALUES(?,?,?,?,?)",
                   (program_id, value["id"], value["revision"], value["version"], raw))


def command(ops, context, action, data, actor, next_version, note):
    program_id = context["program"]["id"]
    if action == "amendment.save":
        obj(data, ("amendmentId", "expectedRevision", "inputs", "expectedPreviewSha256"), "amendment save")
        old = selected(ops, program_id, data["amendmentId"]) if data.get("amendmentId") else None
        expected_revision = domain.integer(data.get("expectedRevision", 0), "Original amendment edition", 0, MAX_EDITIONS)
        if expected_revision != (old["revision"] if old else 0):
            fail("The amendment was edited elsewhere. Compare its retained edition.", "AMENDMENT_CONFLICT", 409)
        if old and old["state"] == "APPLIED":
            fail("This amendment is already applied. Prepare a separate selected amendment.", "AMENDMENT_APPLIED", 409)
        if old is None and len(heads(load(ops, program_id))) >= MAX_AMENDMENTS:
            fail("This case has reached its amendment bound.", "AMENDMENT_LIMIT", 413)
        candidate = preview(ops, context, data.get("inputs"))
        if candidate["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed amendment preview", False):
            fail("The case or selected amendment inputs changed after preview.", "AMENDMENT_PREVIEW_CONFLICT", 409)
        ident, stamp = (old["id"] if old else "amendment-" + uuid.uuid4().hex), now()
        row = {"schema": SCHEMA, "id": ident, "revision": expected_revision + 1, "version": next_version,
               "state": "PROPOSED", "createdAt": old["createdAt"] if old else stamp, "updatedAt": stamp,
               "actor": actor, "note": note, "preview": candidate, "review": None, "application": None,
               "previous": None if old is None else {"revision": old["revision"], "sha256": old["sha256"]}}
    else:
        allowed = ("amendmentId", "expectedRevision", "expectedAmendmentSha256",
                   "expectedPreviewSha256", "decision", "statement", "sourceIds") if action == "amendment.review" else (
                   "amendmentId", "expectedRevision", "expectedAmendmentSha256", "acknowledgeBaselineChange")
        obj(data, allowed, "amendment decision")
        old = selected(ops, program_id, data.get("amendmentId"))
        if (domain.integer(data.get("expectedRevision"), "Reviewed amendment edition", 1, MAX_EDITIONS) != old["revision"]
                or domain.sha(data.get("expectedAmendmentSha256"), "Reviewed amendment edition hash", False) != old["sha256"]):
            fail("The selected amendment edition changed.", "AMENDMENT_CONFLICT", 409)
        if old["state"] == "APPLIED":
            fail("This amendment has already changed the selected baseline.", "AMENDMENT_APPLIED", 409)
        if not note:
            fail("Retain the reason for this amendment decision.")
        fresh = preview(ops, context, old["preview"]["inputs"])
        if fresh["previewSha256"] != old["preview"]["previewSha256"]:
            fail("The case changed after this proposal. Save a newly reviewed amendment edition.",
                 "AMENDMENT_SOURCE_CONFLICT", 409)
        row = {**deepcopy(old), "revision": old["revision"] + 1, "version": next_version,
               "updatedAt": now(), "actor": actor, "note": note,
               "previous": {"revision": old["revision"], "sha256": old["sha256"]}}
        if action == "amendment.review":
            if data.get("expectedPreviewSha256") != fresh["previewSha256"]:
                fail("Select the exact reviewed amendment preview.", "AMENDMENT_PREVIEW_CONFLICT", 409)
            decision = domain.enum(data.get("decision"), DECISIONS, "Amendment review decision")
            if decision == "APPROVE" and not fresh["compatibility"]["compatible"]:
                fail("Resolve the listed retained-record conflicts before approving this amendment.",
                     "AMENDMENT_INCOMPATIBLE", 409)
            source_ids = domain.reference_list(data.get("sourceIds", []), context["sources"], "Review sources")
            for source_id in source_ids:
                ops.source(program_id, source_id)
            row["review"] = {"decision": decision, "actor": actor, "recordedAt": row["updatedAt"],
                             "statement": text(data.get("statement"), "Amendment review statement", 12000, True),
                             "previewSha256": fresh["previewSha256"],
                             "sourceIds": source_ids,
                             "sources": [deepcopy(context["sources"][ident]) for ident in source_ids]}
            row["state"] = "REVIEWED" if decision == "APPROVE" else "CHANGES_REQUESTED"
        elif action == "amendment.apply":
            if old["state"] != "REVIEWED" or old.get("review", {}).get("decision") != "APPROVE":
                fail("Record an explicit review of this exact amendment before applying it.", "AMENDMENT_REVIEW_REQUIRED", 409)
            if data.get("acknowledgeBaselineChange") is not True:
                fail("Explicitly select applying this reviewed baseline to the existing case.")
            if not fresh["compatibility"]["compatible"]:
                fail("Resolve the retained-record conflicts before applying this amendment.", "AMENDMENT_INCOMPATIBLE", 409)
            for source_id in old["review"]["sourceIds"]:
                ops.source(program_id, source_id)
            target = stable_plan(ops.workspace._read(context["program"]["planId"],
                                                    fresh["inputs"]["selectedRevision"]))
            if not same_plan(target, old["preview"]["selectedPlan"]):
                fail("The original selected planning revision changed.", "AMENDMENT_PLAN_SOURCE", 409)
            row["state"] = "APPLIED"
            row["application"] = {"recordedAt": row["updatedAt"], "actor": actor, "version": next_version,
                "previousCaseVersion": context["program"]["version"], "previousPlan": plan_pin(context["plan"]),
                "selectedPlan": plan_pin(target), "reviewedAmendmentRevision": old["revision"],
                "reviewedAmendmentSha256": old["sha256"], "previewSha256": fresh["previewSha256"],
                "preservedRecordsSha256": digest(context["records"]),
                "preservedSourcesSha256": digest(context["sources"]),
                "caseCalendarStart": context["program"].get("calendarStart")}
            changed_records = applied_record_changes(fresh, next_version, row["updatedAt"])
            if changed_records:
                projected = deepcopy(context["records"])
                for change in changed_records:
                    ops._save(program_id, change["kind"], change["after"])
                    for index, original in enumerate(projected[change["kind"]]):
                        if original["id"] == change["recordId"]:
                            projected[change["kind"]][index] = change["after"]
                            break
                del row["application"]["preservedRecordsSha256"]
                row["application"].update({"previousRecordsSha256": digest(context["records"]),
                    "appliedRecordsSha256": digest(projected), "recordChanges": changed_records})
            ops.db.execute("UPDATE ops_programs SET plan_revision=?,plan_json=? WHERE id=?",
                           (target["revision"], canonical(target), program_id))
        else:
            fail("Unknown amendment action.")
    row = seal(row)
    _save_row(ops, program_id, row)
    return {"before": event_summary(old) if old else None, "after": event_summary(row),
            "kind": "amendment", "recordId": row["id"], "amendmentRevision": row["revision"],
            "amendmentSha256": row["sha256"], "previewSha256": row["preview"]["previewSha256"],
            **({"planRevision": row["application"]["selectedPlan"]["revision"]} if row["state"] == "APPLIED" else {})}


def plan_at(rows, current_plan, version):
    applications = sorted((row for row in rows if row["state"] == "APPLIED"), key=lambda row: row["version"])
    if not applications:
        return current_plan
    chosen = applications[0]["preview"]["snapshot"]["plan"]
    for row in applications:
        if row["version"] > version:
            break
        chosen = row["preview"]["selectedPlan"]
    return chosen


def completion_basis(plan, rows, events, completion_row):
    versions = [event["version"] for event in events if event["version"] <= completion_row["version"]
                and event.get("action") == "completion.save" and event.get("recordId") == completion_row["id"]]
    return plan_at(rows, plan, (max(versions) if versions else completion_row["version"]) - 1)


def last_applied_version(ops, program_id):
    for version, raw in ops.db.execute(
            "SELECT version,body_json FROM ops_plan_amendments WHERE program_id=? ORDER BY version DESC",
            (program_id,)):
        if json.loads(raw).get("state") == "APPLIED":
            return version
    return 0


def native_plan_rows(raw):
    """Inspect the already-selected nested archive; original import still validates it."""
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            if (len(infos) > 20 or len({item.filename for item in infos}) != len(infos)
                    or sum(item.file_size for item in infos) > MAX_BUNDLE):
                fail("The original planning archive exceeds its native bound.")
            document = json.loads(archive.read("workspace.json"))
        return native_document_rows(document)
    except (zipfile.BadZipFile, KeyError, UnicodeError, ValueError, TypeError, RuntimeError) as exc:
        raise Problem("The selected original planning history is unreadable.", 422, "AMENDMENT_PLAN_SOURCE") from exc


def native_document_rows(document):
    """Select the same immutable revision cores from an already validated native history."""
    values = document.get("revisions")
    if not isinstance(values, list) or not 1 <= len(values) <= 10000:
        fail("Keep the complete native planning history.")
    result = {}
    for value in values:
        core = plan_core(value)
        number = core["revision"]
        if number in result:
            fail("The original planning history repeats a revision.")
        result[number] = core
    return result


def _records_at(events, version, work_intakes=()):
    result = {kind: {} for kind in domain.KINDS}
    intakes = {row["caseVersion"]: row for row in work_intakes if row.get("state") == "APPLIED"}
    for event in events[:version]:
        kind, after = event.get("kind"), event.get("after")
        if event.get("action") == "work-intake.apply":
            intake = intakes.get(event.get("version"))
            if (not intake or intake.get("id") != event.get("recordId")
                    or digest({key: value for key, value in intake.items() if key != "sha256"}) != intake.get("sha256")):
                fail("Retain the original applied work/invoice intake and its native record snapshots.", "AMENDMENT_HISTORY")
            for link in intake["applied"]["links"]:
                linked_kind, ident, snapshot = link.get("kind"), link.get("recordId"), link.get("snapshot")
                if linked_kind not in ("work", "invoices") or not isinstance(snapshot, dict) or snapshot.get("id") != ident:
                    fail("The applied intake lost an original work/invoice record.", "AMENDMENT_HISTORY")
                if link.get("operation") == "CREATED":
                    if ident in result[linked_kind] or snapshot.get("version") != event["version"]:
                        fail("An intake-created record conflicts with earlier native work.", "AMENDMENT_HISTORY")
                    result[linked_kind][ident] = snapshot
                elif link.get("operation") != "REUSED" or result[linked_kind].get(ident) != snapshot:
                    fail("The intake reuse differs from the actual prior native record.", "AMENDMENT_HISTORY")
            continue
        if event.get("action") == "amendment.apply" and isinstance(after, dict) and "recordChanges" in after:
            changes = after["recordChanges"]
            if not isinstance(changes, list):
                fail("Retain the complete applied package attribution changes.", "AMENDMENT_HISTORY")
            for change in changes:
                obj(change, ("kind", "recordId", "before", "after"), "retained record attribution")
                linked_kind, ident = change.get("kind"), change.get("recordId")
                original, revised = change.get("before"), change.get("after")
                if (linked_kind not in ("work", "invoices", "deployments") or not isinstance(ident, str)
                        or not isinstance(original, dict) or not isinstance(revised, dict)
                        or result[linked_kind].get(ident) != original
                        or original.get("id") != ident or revised.get("id") != ident
                        or revised.get("version") != event["version"]):
                    fail("The applied attribution differs from its original case record.", "AMENDMENT_HISTORY")
                result[linked_kind][ident] = revised
            continue
        if kind not in result:
            continue
        if not isinstance(after, dict) or not isinstance(after.get("id"), str):
            fail("Retain each original record mutation in the native case history.", "AMENDMENT_HISTORY")
        result[kind][after["id"]] = after
    return {kind: sorted(values.values(), key=lambda row: row["id"]) for kind, values in result.items()}


def _record_set(records):
    return {kind: sorted(values, key=lambda row: row["id"]) for kind, values in records.items()}


def validate_import(ops, context, rows, events, planning_raw, *, work_intakes=(), planning_document=None):
    if not isinstance(rows, list) or len(rows) > MAX_EDITIONS or len(canonical(rows).encode()) > MAX_HISTORY_BYTES:
        fail("The complete amendment history exceeds its supported bound.", "AMENDMENT_LIMIT", 413)
    if not isinstance(work_intakes, (list, tuple)) or any(not isinstance(row, dict) for row in work_intakes):
        fail("Retain the complete native work/invoice intake history.", "AMENDMENT_HISTORY")
    expected_events = [event for event in events if event.get("action") in ACTIONS]
    if not rows:
        if expected_events:
            fail("The case is missing its original amendment decisions.", "AMENDMENT_HISTORY")
        return []
    if len(expected_events) != len(rows):
        fail("Retain every original amendment edition and event.", "AMENDMENT_HISTORY")
    native = native_plan_rows(planning_raw) if planning_document is None else native_document_rows(planning_document)
    grouped, versions = {}, set()
    ordered = sorted(rows, key=lambda row: row.get("version", 0))
    original_sources = context["sources"]
    applied = []
    for row in ordered:
        obj(row, ("schema", "id", "revision", "version", "state", "createdAt", "updatedAt",
                  "actor", "note", "preview", "review", "application", "previous", "sha256"), "retained amendment edition")
        if row.get("schema") != SCHEMA or seal(row)["sha256"] != row.get("sha256"):
            fail("A retained amendment edition differs from its complete identity.", "AMENDMENT_CHANGED", 409)
        ident = identity(row.get("id"))
        revision = domain.integer(row.get("revision"), "Original amendment edition", 1, MAX_EDITIONS)
        version = domain.integer(row.get("version"), "Original case version", 2, context["program"]["version"])
        if version in versions:
            fail("The case repeats an amendment event version.", "AMENDMENT_HISTORY")
        versions.add(version)
        domain.enum(row.get("state"), STATES, "Retained amendment state")
        for key in ("createdAt", "updatedAt"):
            domain.timestamp(row.get(key), "Original amendment time")
        text(row.get("actor"), "Original amendment operator", 300, True)
        text(row.get("note", ""), "Original amendment note", 12000)
        previous = grouped.get(ident)
        if (revision != (previous["revision"] + 1 if previous else 1)
                or row.get("previous") != ({"revision": previous["revision"], "sha256": previous["sha256"]} if previous else None)
                or previous and (previous["state"] == "APPLIED" or previous["createdAt"] != row["createdAt"])):
            fail("The original amendment edition sequence is incomplete.", "AMENDMENT_HISTORY")
        event = events[version - 1]
        if (event.get("action") not in ACTIONS or event.get("recordId") != ident
                or event.get("kind") != "amendment" or event.get("after") != event_summary(row)
                or event.get("before") != (event_summary(previous) if previous else None)
                or event.get("actor") != row["actor"] or event.get("note") != row["note"]):
            fail("The amendment does not match its original native event.", "AMENDMENT_HISTORY")
        candidate = row["preview"]
        snapshot = candidate["snapshot"]
        for plan in (snapshot["plan"], candidate["selectedPlan"]):
            if native.get(plan.get("revision")) != plan_core(plan):
                fail("An amendment plan is missing from the exact original planner history.", "AMENDMENT_PLAN_SOURCE")
        if not same_plan(snapshot["plan"], plan_at(applied, context["plan"], version - 1)):
            # Before the first application, the first applied proposal supplies
            # the original baseline; later applications must continue its chain.
            first_application = next((item for item in ordered if item.get("state") == "APPLIED"), None)
            initial = first_application["preview"]["snapshot"]["plan"] if first_application else context["plan"]
            if applied or not same_plan(snapshot["plan"], initial):
                fail("The amendment proposal belongs to a different case baseline.", "AMENDMENT_HISTORY")
        if _record_set(snapshot["records"]) != _records_at(events, candidate["observedVersion"], work_intakes):
            fail("The amendment omitted or changed an original case record.", "AMENDMENT_HISTORY")
        for source_id, metadata in snapshot["sources"].items():
            if original_sources.get(source_id) != metadata:
                fail("An amendment source differs from the complete retained case.", "AMENDMENT_DECISION_SOURCE")
        rebuilt = _preview(ops, snapshot, candidate["inputs"], candidate["selectedPlan"])
        if rebuilt != candidate:
            fail("The amendment differs from its complete native preview.", "AMENDMENT_CHANGED", 409)
        if event["action"] == "amendment.save":
            if (row["state"] != "PROPOSED" or row.get("review") is not None or row.get("application") is not None
                    or candidate["observedVersion"] != version - 1):
                fail("The proposal lacks its original selected case version.", "AMENDMENT_HISTORY")
        else:
            if not previous or candidate != previous["preview"]:
                fail("The decision changed its original reviewed amendment.", "AMENDMENT_HISTORY")
            if event["action"] == "amendment.review":
                review = obj(row.get("review"), ("decision", "actor", "recordedAt", "statement",
                    "previewSha256", "sourceIds", "sources"), "retained amendment review")
                decision = domain.enum(review.get("decision"), DECISIONS, "Retained review decision")
                if (row["state"] != ("REVIEWED" if decision == "APPROVE" else "CHANGES_REQUESTED")
                        or row.get("application") is not None or review.get("actor") != row["actor"]
                        or review.get("recordedAt") != row["updatedAt"]
                        or review.get("previewSha256") != candidate["previewSha256"]
                        or decision == "APPROVE" and not candidate["compatibility"]["compatible"]):
                    fail("The amendment review differs from its exact proposal.", "AMENDMENT_HISTORY")
                text(review.get("statement"), "Original amendment review statement", 12000, True)
                source_ids = domain.reference_list(review.get("sourceIds"), original_sources, "Original review sources")
                if review.get("sources") != [original_sources[ident] for ident in source_ids]:
                    fail("The review is missing its exact original source metadata.", "AMENDMENT_DECISION_SOURCE")
            else:
                application = obj(row.get("application"), ("recordedAt", "actor", "version", "previousCaseVersion",
                    "previousPlan", "selectedPlan", "reviewedAmendmentRevision", "reviewedAmendmentSha256",
                    "previewSha256", "preservedRecordsSha256", "previousRecordsSha256", "appliedRecordsSha256",
                    "recordChanges", "preservedSourcesSha256", "caseCalendarStart"),
                    "retained baseline application")
                if (row["state"] != "APPLIED" or previous["state"] != "REVIEWED"
                        or row["review"] != previous["review"]
                        or application.get("version") != version or application.get("previousCaseVersion") != version - 1
                        or application.get("actor") != row["actor"] or application.get("recordedAt") != row["updatedAt"]
                        or application.get("reviewedAmendmentRevision") != previous["revision"]
                        or application.get("reviewedAmendmentSha256") != previous["sha256"]
                        or application.get("previewSha256") != candidate["previewSha256"]
                        or application.get("previousPlan") != plan_pin(snapshot["plan"])
                        or application.get("selectedPlan") != plan_pin(candidate["selectedPlan"])
                        or (not candidate.get("recordChanges") and application.get("preservedRecordsSha256") != digest(snapshot["records"]))
                        or application.get("preservedSourcesSha256") != digest(snapshot["sources"])
                        or application.get("caseCalendarStart") != snapshot["program"].get("calendarStart")):
                    fail("The applied baseline differs from its original review.", "AMENDMENT_HISTORY")
                expected_changes = applied_record_changes(candidate, version, row["updatedAt"])
                if expected_changes:
                    projected = deepcopy(snapshot["records"])
                    for change in expected_changes:
                        for index, original in enumerate(projected[change["kind"]]):
                            if original["id"] == change["recordId"]:
                                projected[change["kind"]][index] = change["after"]
                                break
                    if (application.get("recordChanges") != expected_changes
                            or application.get("previousRecordsSha256") != digest(snapshot["records"])
                            or application.get("appliedRecordsSha256") != digest(projected)
                            or "preservedRecordsSha256" in application):
                        fail("The applied package attribution changed another retained observation.", "AMENDMENT_HISTORY")
                elif any(key in application for key in ("recordChanges", "previousRecordsSha256", "appliedRecordsSha256")):
                    fail("The baseline receipt contains unreviewed package attribution.", "AMENDMENT_HISTORY")
                if _records_at(events, version - 1, work_intakes) != _record_set(snapshot["records"]):
                    fail("Recorded work changed between review and baseline application.", "AMENDMENT_HISTORY")
                if applied and not same_plan(applied[-1]["preview"]["selectedPlan"], snapshot["plan"]):
                    fail("The applied baseline chain is incomplete.", "AMENDMENT_HISTORY")
                applied.append(row)
        grouped[ident] = row
    if len(grouped) > MAX_AMENDMENTS:
        fail("The case exceeds its amendment bound.", "AMENDMENT_LIMIT", 413)
    if applied:
        initial = applied[0]["preview"]["snapshot"]["plan"]
        created = events[0].get("after", {})
        if (created.get("revision") != initial["revision"]
                or created.get("contentSha256") != initial["contentSha256"]
                or created.get("sourceSha256") != initial["source"]["sha256"]
                or not same_plan(context["plan"], applied[-1]["preview"]["selectedPlan"])):
            fail("The amendment lineage does not bind the original and current case plans.", "AMENDMENT_HISTORY")
    return ordered


def import_rows(ops, program_id, rows):
    for row in rows:
        ops.db.execute("INSERT INTO ops_plan_amendments VALUES(?,?,?,?,?)",
                       (program_id, row["id"], row["revision"], row["version"], canonical(row)))


def export_files(rows):
    if not rows:
        return {}
    summaries = [summary(row) for row in rows]
    history = {"schema": SCHEMA + ".history", "editions": summaries,
               "completeEditions": "operations.json#amendments",
               "note": "The complete case retains every original proposal, decision, selected plan, and source attachment."}
    table = []
    for row in rows:
        if row["state"] != "PROPOSED":
            continue
        for change in row["preview"]["changes"]:
            table.append({"amendmentId": row["id"], "amendmentRevision": row["revision"],
                "caseVersion": row["version"], "path": change["path"],
                "beforePresent": change["beforePresent"], "afterPresent": change["afterPresent"],
                "before": canonical(change["before"]), "after": canonical(change["after"])})
    return {"amendment-history.json": (canonical(history) + "\n").encode(),
            "amendment-changes.csv": csv_bytes(
                ["amendmentId", "amendmentRevision", "caseVersion", "path", "beforePresent", "afterPresent", "before", "after"], table)}


def validate_files(rows, files):
    expected = export_files(rows)
    names = {"amendment-history.json", "amendment-changes.csv"}
    if (set(files) & names) != set(expected) or any(files[name] != raw for name, raw in expected.items()):
        fail("The exported amendment history differs from its complete native editions.", "AMENDMENT_HISTORY")

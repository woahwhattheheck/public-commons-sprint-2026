"""Original saved Installation checks in the existing Completion assignment lifecycle.

No independent acceptance, payment or issuer state is owned here. Exact source
editions are frozen with the original completion plan and prepared form.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import html
import json

from model import canonical, digest, csv_bytes
import operations_domain as domain
import operations_installations as installations

SCHEMA = "stellar-forge.sf47-completion-installations.v1"
SELECTION_KEY = "installationSelections"
MAX_SELECTIONS = 200
MAX_INSTALLATIONS = 20
FIELDS = ("costId", "installationId", "revision", "sha256", "checkId", "requirePaidPurchase")


def fail(message, code="COMPLETION_INSTALLATION", status=422):
    domain.fail(message, code, status)


def selections(context, raw, tranche):
    if not isinstance(raw, list) or len(raw) > MAX_SELECTIONS:
        fail("Select up to two hundred complete original Installation checks.")
    costs = {row["id"] for row in context["plan"]["scenario"]["future_costs"] if row["tranche"] == tranche}
    result, seen, editions = [], set(), {}
    for item in raw:
        if not isinstance(item, dict) or set(item) != set(FIELDS):
            fail("Retain the exact package, Installation edition, check and paid-result requirement.")
        cost = item["costId"]
        if cost not in costs:
            fail("Select an original package in this tranche.")
        ident, number = installations.identity(item["installationId"]), installations.revision(item["revision"])
        sha = domain.sha(item["sha256"], "Original Installation SHA-256", False)
        check = installations.short_text(item["checkId"], "Original check identity", 80, True)
        paid = item["requirePaidPurchase"]
        if not isinstance(paid, bool):
            fail("The useful paid-purchase requirement must be explicitly true or false.")
        key = (cost, ident, check)
        if key in seen or ident in editions and editions[ident] != (number, sha):
            fail("Keep each package/check once and choose one exact edition of an Installation.")
        seen.add(key)
        editions[ident] = (number, sha)
        result.append({"costId": cost, "installationId": ident, "revision": number,
                       "sha256": sha, "checkId": check, "requirePaidPurchase": paid})
    if len(editions) > MAX_INSTALLATIONS:
        fail("Select at most twenty complete Installation editions.")
    return sorted(result, key=lambda row: (row["costId"], row["installationId"], row["checkId"]))


def verify_row(row):
    if not isinstance(row, dict) or digest({k: v for k, v in row.items() if k != "sha256"}) != row.get("sha256"):
        fail("An Installation edition differs from its original complete body.", status=409)
    value = row.get("preview", {})
    if digest({k: v for k, v in value.items() if k != "previewSha256"}) != value.get("previewSha256"):
        fail("The original Installation preview changed.", status=409)
    return row


def selected_check(row, selection, tranche):
    document = row["preview"]["document"]
    check = next((item for item in document["checks"] if item["id"] == selection["checkId"]), None)
    if check is None:
        fail("The selected check is not in its original Installation edition.")
    if selection["costId"] not in document["assignments"]["costIds"]:
        fail("The selected Installation is not assigned to that original funded package.")
    if check["tranche"] not in (None, tranche):
        fail("The selected Installation check belongs to a different tranche.")
    return check


def capture(ops, context, inputs):
    chosen = selections(context, inputs.get(SELECTION_KEY, []), inputs["tranche"])
    bodies = {}
    for selection in chosen:
        ident = selection["installationId"]
        if ident not in bodies:
            row = installations.get(ops, context["program"]["id"], ident, selection["revision"])
            head = installations.get(ops, context["program"]["id"], ident)
            if row["sha256"] != selection["sha256"] or head["sha256"] != row["sha256"]:
                fail("The Installation edition changed. Review its current checks before saving these assignments.",
                     "COMPLETION_INSTALLATION_CHANGED", 409)
            bodies[ident] = verify_row(row)
        selected_check(bodies[ident], selection, inputs["tranche"])
    result = {"schema": SCHEMA, "selections": chosen,
              "installations": [deepcopy(bodies[key]) for key in sorted(bodies)]}
    result["sha256"] = digest(result)
    return result


def validate_evidence(context, inputs, evidence):
    if not isinstance(evidence, dict) or set(evidence) != {"schema", "selections", "installations", "sha256"}:
        fail("Retain the complete Installation selection and original editions.")
    if evidence["schema"] != SCHEMA or digest({k: v for k, v in evidence.items() if k != "sha256"}) != evidence["sha256"]:
        fail("The frozen Installation evidence differs from its original identity.")
    chosen = selections(context, inputs.get(SELECTION_KEY, []), inputs["tranche"])
    if evidence["selections"] != chosen:
        fail("The Installation evidence differs from the saved assignment selection.")
    rows = evidence["installations"]
    if not isinstance(rows, list) or len(rows) > MAX_INSTALLATIONS:
        fail("The complete original Installation editions are missing.")
    indexed = {}
    for row in rows:
        verify_row(row)
        ident = installations.identity(row["id"])
        if ident in indexed:
            fail("The frozen source repeats an Installation.")
        indexed[ident] = row
    if set(indexed) != {item["installationId"] for item in chosen}:
        fail("Keep precisely the complete Installation editions selected by these assignments.")
    for selection in chosen:
        row = indexed[selection["installationId"]]
        if (row["revision"], row["sha256"]) != (selection["revision"], selection["sha256"]):
            fail("The frozen Installation reference differs from its full edition.")
        selected_check(row, selection, inputs["tranche"])
    return indexed


def paid_result(row):
    return (row.get("state") != "VOID" and row.get("settlementStatus") == "SETTLED"
            and row.get("outputStatus") == "COMPLETE" and row.get("orderStatus") in ("NOT_APPLICABLE", "FULFILLED")
            and bool(row.get("transactionHash")) and int(row.get("amountStroops", "0")) > 0
            and bool(row.get("deliveredSha256")))


def civil_day(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).date().isoformat()


def evaluate(context, inputs, evidence, as_of):
    indexed = validate_evidence(context, inputs, evidence)
    current = {kind: {row["id"]: row for row in context["records"][kind]}
               for kind in ("work", "purchases", "deployments", "outcomes", "contributors")}
    heads = {row["id"]: row for row in context.get("installationRefs", [])}
    rows, issues, all_paid = [], [], {}
    def issue(selection, code, message):
        issues.append({"code": code, "costId": selection["costId"],
                       "installationId": selection["installationId"], "checkId": selection["checkId"], "message": message})
    for selection in evidence["selections"]:
        row = indexed[selection["installationId"]]
        value, document = row["preview"], row["preview"]["document"]
        check = selected_check(row, selection, inputs["tranche"])
        retained = {kind: {item["id"]: item for item in value["snapshot"]["records"][kind]}
                    for kind in current}
        head = heads.get(row["id"])
        if not head or (head["revision"], head["sha256"]) != (row["revision"], row["sha256"]):
            issue(selection, "INSTALLATION_EDITION_CHANGED", "Review the current Installation edition; this exact earlier edition remains retained.")
        if check["state"] not in ("ACCEPTED", "NOT_APPLICABLE"):
            issue(selection, "INSTALLATION_CHECK_OPEN", "The selected check retains " + check["state"] + ".")
        if check["observedAt"] and civil_day(check["observedAt"]) > as_of:
            issue(selection, "INSTALLATION_CHECK_AFTER_CUTOFF", "The actual acceptance observation follows this preparation date.")
        if row["createdAt"][:10] > as_of:
            issue(selection, "INSTALLATION_SAVED_AFTER_CUTOFF", "The original Installation was recorded after this preparation date.")
        links = {"work": check["workIds"], "purchases": check["purchaseIds"], "outcomes": check["outcomeIds"],
                 "deployments": sorted(set(document["buyerDeploymentIds"] + ([document["merchantDeploymentId"]] if document["merchantDeploymentId"] else [])))}
        links["contributors"] = sorted({retained["work"][wid]["contributorId"] for wid in check["workIds"]})
        source_ids = set(check["sourceIds"])
        for kind, ids in links.items():
            for ident in ids:
                original, live = retained[kind].get(ident), current[kind].get(ident)
                if original is None or live != original:
                    issue(selection, "INSTALLATION_RECORD_CHANGED", "The selected original " + kind + " record changed or is unavailable: " + ident)
                if original:
                    source_ids.update(original.get("sourceIds", []))
                    if original.get("state") == "VOID":
                        issue(selection, "INSTALLATION_RECORD_VOID", "The selected original " + kind + " record is void: " + ident)
        original_sources = value["snapshot"]["sources"]
        for ident in sorted(source_ids):
            if original_sources.get(ident) != context["sources"].get(ident):
                issue(selection, "INSTALLATION_SOURCE_CHANGED", "The selected original source changed or is unavailable: " + ident)
        purchases = [deepcopy(retained["purchases"][ident]) for ident in check["purchaseIds"]]
        useful = []
        for purchase in purchases:
            times = [purchase.get(k) for k in ("observedAt", "settledAt", "outputCompletedAt") if purchase.get(k)]
            if any(civil_day(stamp) > as_of for stamp in times):
                issue(selection, "INSTALLATION_PURCHASE_AFTER_CUTOFF", "A selected paid-result observation follows this preparation date.")
            if paid_result(purchase):
                useful.append(purchase["id"])
                all_paid[purchase["id"]] = purchase
        if selection["requirePaidPurchase"] and not useful:
            issue(selection, "INSTALLATION_PAID_RESULT_REQUIRED",
                  "This selection requires an original settled positive payment with a complete hashed output and fulfilled or inapplicable order.")
        rows.append({"selection": deepcopy(selection), "installationName": document["name"],
                     "check": deepcopy(check), "sourceIds": sorted(source_ids), "purchases": purchases,
                     "usefulPaidPurchaseIds": useful, "currentEdition": deepcopy(head)})
    summary = {"selectedChecks": len(rows), "acceptedChecks": sum(r["check"]["state"] == "ACCEPTED" for r in rows),
               "notApplicableChecks": sum(r["check"]["state"] == "NOT_APPLICABLE" for r in rows),
               "distinctUsefulPaidPurchases": len(all_paid),
               "purchaseObservations": [deepcopy(all_paid[key]) for key in sorted(all_paid)],
               "meaning": "Exact observed transactions and outputs; neither independent commercial adoption nor issuer acceptance is inferred."}
    return {"schema": SCHEMA, "evidence": deepcopy(evidence), "asOfDate": as_of,
            "rows": rows, "summary": summary, "issues": issues, "ready": not issues}


def catalog(ops, context, tranche):
    tranche = domain.integer(tranche, "Completion tranche", 1, 3)
    costs = {row["id"] for row in context["plan"]["scenario"]["future_costs"] if row["tranche"] == tranche}
    result = []
    for row in installations.load_heads(ops, context["program"]["id"]):
        verify_row(row)
        document = row["preview"]["document"]
        assigned = sorted(set(document["assignments"]["costIds"]) & costs)
        if assigned:
            result.append({"id": row["id"], "revision": row["revision"], "sha256": row["sha256"],
                           "name": document["name"], "stage": document["stage"], "costIds": assigned,
                           "checks": deepcopy([item for item in document["checks"] if item["tranche"] in (None, tranche)])})
    return {"schema": SCHEMA, "caseId": context["program"]["id"], "version": context["program"]["version"],
            "tranche": tranche, "installations": result}


def transfer(ops, context, body):
    from operations_completion import normalize_inputs, day, today
    if set(body) - {"expectedVersion", "inputs", "asOfDate"}:
        fail("Use the complete existing assignment draft and selected original checks.")
    inputs = normalize_inputs(context, body.get("inputs"))
    as_of = day(body.get("asOfDate") or today(), "Installation acceptance cutoff")
    evidence = capture(ops, context, inputs)
    report = evaluate(context, inputs, evidence, as_of)
    proposed, suggestions = deepcopy(inputs), []
    snapshots = {row["id"]: row["preview"]["snapshot"] for row in evidence["installations"]}
    by_cost = {item["costId"]: item for item in proposed["items"]}
    for cost_id, item in by_cost.items():
        selected = [row for row in report["rows"] if row["selection"]["costId"] == cost_id]
        if not selected:
            continue
        work, owners, deployments, source_ids = set(item["workIds"]), set(item["ownerIds"]), set(item["deploymentIds"]), set(item["sourceIds"])
        notes, dates, excluded = [], [], []
        for row in selected:
            selected_snapshot = snapshots[row["selection"]["installationId"]]
            original = {kind: {entry["id"]: entry for entry in entries} for kind, entries in selected_snapshot["records"].items()}
            check = row["check"]
            notes.append(row["installationName"] + " / " + check["title"] + " [" + check["state"] + "]: " + check["note"])
            if check["state"] == "ACCEPTED" and check["observedAt"]:
                dates.append(civil_day(check["observedAt"]))
            for ident in check["workIds"]:
                native = original["work"][ident]
                if native["costId"] == cost_id:
                    work.add(ident)
                    owners.add(native["contributorId"])
                else:
                    excluded.append({"kind": "work", "id": ident, "reason": "Different original package"})
            for native in original["deployments"].values():
                if native.get("tranche") in (None, inputs["tranche"]) and (not native["costIds"] or cost_id in native["costIds"]):
                    deployments.add(native["id"])
                else:
                    excluded.append({"kind": "deployment", "id": native["id"], "reason": "Different original package or tranche"})
            source_ids.update(row["sourceIds"])
        item.update(workIds=sorted(work), ownerIds=sorted(owners), deploymentIds=sorted(deployments), sourceIds=sorted(source_ids))
        complete = bool(dates) and all(r["check"]["state"] in ("ACCEPTED", "NOT_APPLICABLE") for r in selected)
        suggestions.append({"costId": cost_id, "completedOn": max(dates) if dates else None,
                            "completionNote": "\n\n".join(notes), "acceptanceRecorded": complete,
                            "excludedLinks": excluded,
                            "meaning": "Apply only after reviewing the complete package; selected customer checks do not establish unselected package work."})
    result = {"schema": SCHEMA, "source": {"caseId": context["program"]["id"], "version": context["program"]["version"],
              "planContentSha256": context["plan"]["contentSha256"]}, "originalInputs": deepcopy(inputs),
              "proposedInputs": proposed, "suggestions": suggestions, "report": report}
    result["previewSha256"] = digest(result)
    return result


def validate_import(plans, reviews, events, saved_installations):
    available = {(row["id"], row["revision"], row["sha256"]): row for row in saved_installations}
    candidates = [row for row in plans]
    candidates += [event["after"] for event in events if event.get("action") in ("completion.save", "completion.extension")
                   and isinstance(event.get("after"), dict)]
    candidates += [review["completion"]["completionPlan"] for review in reviews if review.get("purpose") == "TRANCHE_COMPLETION"]
    for plan in candidates:
        evidence = plan.get("installationEvidence")
        if evidence is None:
            continue
        for row in evidence["installations"]:
            if available.get((row["id"], row["revision"], row["sha256"])) != row or row["version"] >= plan["version"]:
                fail("A Completion assignment lost its exact earlier Installation edition.", "COMPLETION_INSTALLATION_IMPORT")


def file_map(candidate, read_source):
    value = candidate.get("installationEvidence")
    if not value:
        return {}
    evidence, files = value["evidence"], {}
    files["installation-evidence.json"] = (canonical(value) + "\n").encode()
    rows = []
    for selected in value["rows"]:
        check, selection = selected["check"], selected["selection"]
        rows.append({"costId": selection["costId"], "installationId": selection["installationId"],
                     "revision": selection["revision"], "checkId": check["id"], "criterion": check["criterion"],
                     "state": check["state"], "operator": check["operator"], "observedAt": check["observedAt"],
                     "result": check["note"], "requirePaidPurchase": selection["requirePaidPurchase"],
                     "usefulPaidPurchaseIds": ", ".join(selected["usefulPaidPurchaseIds"])})
    files["installation-checks.csv"] = csv_bytes(
        ["costId", "installationId", "revision", "checkId", "criterion", "state", "operator",
         "observedAt", "result", "requirePaidPurchase", "usefulPaidPurchaseIds"], rows)
    for row in evidence["installations"]:
        key = row["id"] + "-r" + str(row["revision"])
        prefix = "installation-editions/" + key + "/"
        files[prefix + "installation.json"] = (canonical(row) + "\n").encode()
        sources = {}
        for ident, pinned in row["preview"]["snapshot"]["sources"].items():
            metadata, raw = read_source(ident)
            if metadata["sha256"] != pinned["sha256"] or len(raw) != pinned["bytes"] or hashlib.sha256(raw).hexdigest() != pinned["sha256"]:
                fail("An exact original Installation source is unavailable.", "COMPLETION_INSTALLATION_SOURCE", 409)
            sources["sources/" + ident] = raw
            files[prefix + "sources/" + ident] = raw
        for name, raw in installations.selected_files(
                row["preview"]["snapshot"], [row], row["id"], row["revision"], sources).items():
            files[prefix + name] = raw
    e = lambda value: html.escape(str(value if value is not None else ""), quote=True)
    files["installation-evidence.html"] = ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        '<title>Original Installation acceptance</title><style>body{font:16px system-ui;color:#222;max-width:1100px;margin:2rem auto;padding:0 1rem}'
        'table{border-collapse:collapse}td,th{border:1px solid #999;padding:.6rem;vertical-align:top}td{white-space:pre-wrap}</style>'
        '<h1>Original Installation acceptance</h1><p>Exact customer observations selected for the original tranche. '
        'Package completion, customer payment and issuer approval retain their separate recorded meaning.</p>'
        '<table><thead><tr><th>Package / source</th><th>Criterion</th><th>Observed result</th><th>Paid result requirement</th></tr></thead><tbody>' +
        ''.join('<tr><td>' + e(row["costId"]) + '<br><a href="installation-editions/' + e(row["installationId"]) + '-r' +
                str(row["revision"]) + '/installation.html">' + e(row["installationId"]) + ' / ' + str(row["revision"]) +
                '</a></td><td>' + e(row["criterion"]) + '</td><td>' + e(row["state"]) + '<br>' + e(row["operator"]) +
                ' / ' + e(row["observedAt"]) + '<br>' + e(row["result"]) + '</td><td>' + e(row["requirePaidPurchase"]) +
                '<br>' + e(row["usefulPaidPurchaseIds"]) + '</td></tr>' for row in rows) + '</tbody></table></html>').encode()
    return files

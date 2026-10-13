"""Issuer-requested corrections in the original paid-tranche Completion journal.

No new case, payment clock or submission engine is introduced. Every saved edition
is an immutable native review and the existing case exporter retains its history.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import html
import io
import json
import re
import uuid
import zipfile
import operations_domain as domain
from model import canonical, digest, now, text, csv_bytes, MAX_BUNDLE

PURPOSE = "TRANCHE_CORRECTIONS"
SCHEMA = "stellar-forge.sf47-completion-corrections.v1"
MAX_FINDINGS = 100
MAX_EDITIONS = 100
INPUT_KEYS = ("roundId", "previousReviewId", "outcomeId", "expectedOutcomeSha256", "document")
FINDING_KEYS = ("id", "request", "basis", "costIds", "ownerIds", "state", "dueOn",
                "completedOn", "response", "workIds", "deploymentIds", "sourceIds")
STATES = ("OPEN", "IN_PROGRESS", "ADDRESSED", "NOT_APPLICABLE")


def fail(message, code="COMPLETION_CORRECTIONS", status=422):
    domain.fail(message, code, status)


def obj(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        fail("Retain every declared " + label + " field.")
    return value


def ident(value, prefix):
    if not isinstance(value, str) or not re.fullmatch(prefix + r"-[a-f0-9]{32}", value):
        fail("Retain the original " + prefix + " identity.")
    return value


def reviews(ops, program_id):
    return [row for row in (json.loads(raw[0]) for raw in ops.db.execute(
        "SELECT body_json FROM ops_reviews WHERE program_id=? ORDER BY rowid", (program_id,)))
        if row.get("purpose") == PURPOSE]


def snapshot_context(review):
    from operations_completion import business_snapshot
    context = {**deepcopy(review["snapshot"]), "sources": {x["id"]: x for x in review["snapshot"]["sources"]}}
    context["program"]["version"] = review["corrections"]["caseVersion"]
    if digest(business_snapshot(context)) != review["businessSha256"]:
        fail("The retained correction source differs.", status=409)
    return context


def source_outcome(context, outcome_id, expected=None):
    row = next((x for x in context["records"]["outcomes"] if x["id"] == outcome_id), None)
    if not row or not row.get("completion") or row["state"] != "CHANGES_REQUESTED":
        fail("Select an actual changes-requested decision on its original completion form.", status=409)
    if expected is not None and digest(row) != expected:
        fail("The original issuer outcome changed. Review its actual current edition.", "COMPLETION_CORRECTIONS_SOURCE_CHANGED", 409)
    return row


def normalize(context, inputs, source, previous=None):
    obj(inputs, INPUT_KEYS, "correction input")
    ident(inputs["roundId"], "corrections")
    if inputs["previousReviewId"] is not None:
        ident(inputs["previousReviewId"], "review")
    if inputs["outcomeId"] != source["id"] or inputs["expectedOutcomeSha256"] != digest(source):
        fail("The correction inputs must retain their exact original issuer decision.")
    if previous and previous.get("purpose") != PURPOSE:
        fail("Continue an original correction edition, not another review.")
    if previous and (inputs["roundId"] != previous["corrections"]["inputs"]["roundId"]
                     or inputs["previousReviewId"] != previous["id"]):
        fail("Continue the selected original correction round.")
    document = obj(inputs["document"], ("title", "findings", "note"), "correction document")
    result = {"title": text(document["title"], "Correction round title", 300, True),
              "findings": [], "note": text(document["note"], "Correction note", 12000)}
    findings = document["findings"]
    if not isinstance(findings, list) or not 1 <= len(findings) <= MAX_FINDINGS:
        fail("Retain one to 100 explicit issuer findings.")
    available = {kind: {x["id"]: x for x in context["records"][kind]} for kind in domain.KINDS}
    costs = {x["id"]: x for x in context["plan"]["scenario"]["future_costs"]}
    seen = set()
    for raw in findings:
        obj(raw, FINDING_KEYS, "issuer finding")
        fid = ident(raw["id"], "finding")
        if fid in seen:
            fail("A correction finding identity is repeated.")
        seen.add(fid)
        state = domain.enum(raw["state"], STATES, "Correction work state")
        completed = domain.calendar(raw["completedOn"], "Actual correction completion", True)
        due = domain.calendar(raw["dueOn"], "Internal correction target", True)
        response = text(raw["response"], "Correction response or non-applicability basis", 12000)
        if state == "ADDRESSED" and (not completed or not response.strip()):
            fail("An addressed finding needs its actual completion date and response.")
        if state == "NOT_APPLICABLE" and not response.strip():
            fail("Explain the operator's non-applicability assessment; it is not issuer acceptance.")
        if state != "ADDRESSED" and completed:
            fail("Only an addressed finding has an actual completion date.")
        result["findings"].append({
            "id": fid, "request": text(raw["request"], "Original issuer finding", 12000, True),
            "basis": text(raw["basis"], "Original finding source/attribution", 12000, True),
            "costIds": domain.reference_list(raw["costIds"], costs, "Current original work packages"),
            "ownerIds": domain.reference_list(raw["ownerIds"], available["contributors"], "Accountable original contributors"),
            "state": state, "dueOn": due, "completedOn": completed, "response": response,
            "workIds": domain.reference_list(raw["workIds"], available["work"], "Correction work"),
            "deploymentIds": domain.reference_list(raw["deploymentIds"], available["deployments"], "Correction deployments"),
            "sourceIds": domain.reference_list(raw["sourceIds"], context["sources"], "Original correction sources")})
    if previous:
        if source != previous["corrections"]["sourceOutcome"]:
            fail("Retain the original issuer decision throughout this correction round.")
        old = {x["id"] for x in previous["corrections"]["inputs"]["document"]["findings"]}
        if not old.issubset(seen):
            fail("Retain every previously saved finding; explain a corrected or non-applicable item in a new edition.")
    return {**deepcopy(inputs), "document": result}


def head(rows, round_id):
    same = [x for x in rows if x["corrections"]["inputs"]["roundId"] == round_id]
    return max(same, key=lambda x: x["corrections"]["revision"]) if same else None


def original_review(ops, program_id, outcome):
    row = ops.db.execute("SELECT body_json FROM ops_reviews WHERE program_id=? AND id=?",
                         (program_id, outcome["completion"]["reviewId"])).fetchone()
    value = json.loads(row[0]) if row else None
    if not value or value.get("purpose") != "TRANCHE_COMPLETION":
        fail("The original submitted preparation is unavailable.", status=409)
    validate_original(outcome, value)
    return value


def validate_original(outcome, review):
    from operations_completion import validate_preparation
    validate_preparation(review)
    link = outcome["completion"]
    if (review["id"] != link["reviewId"] or review["businessSha256"] != link["reviewSha256"]
            or review["completion"]["previewSha256"] != link["previewSha256"]
            or review["completion"]["receipt"]["id"] != link["receiptId"]):
        fail("The correction source differs from the original submitted preparation.", status=409)


def seed(ops, context, outcome_id, review_id=None):
    retained = reviews(ops, context["program"]["id"])
    if review_id:
        selected = next((x for x in retained if x["id"] == review_id), None)
        if not selected or selected["corrections"]["sourceOutcome"]["id"] != outcome_id:
            fail("Select the original correction edition.", status=404)
        inputs = deepcopy(selected["corrections"]["inputs"])
        inputs["previousReviewId"] = selected["id"]
        source = selected["corrections"]["sourceOutcome"]
        original = selected["corrections"]["originalPreparation"]
        current_head = head(retained, inputs["roundId"])
    else:
        source = source_outcome(context, outcome_id)
        original = original_review(ops, context["program"]["id"], source)
        inputs = {"roundId": "corrections-" + uuid.uuid4().hex, "previousReviewId": None,
                  "outcomeId": source["id"], "expectedOutcomeSha256": digest(source),
                  "document": {"title": "Tranche " + str(source["tranche"]) + " corrections",
                               "findings": [], "note": ""}}
        current_head = None
    return {"schema": SCHEMA, "caseId": context["program"]["id"], "caseVersion": context["program"]["version"],
            "inputs": inputs, "sourceOutcome": deepcopy(source), "originalPreparation": deepcopy(original),
            "currentOutcome": deepcopy(next((x for x in context["records"]["outcomes"] if x["id"] == outcome_id), None)),
            "currentHeadReviewId": current_head["id"] if current_head else None,
            "packages": deepcopy(context["plan"]["scenario"]["future_costs"])}


def comparison(context, original):
    old = {x["costId"]: x for x in original["completion"]["packages"]}
    from operations_completion import package_rows, selected_plan
    tranche = original["completion"]["clock"]["tranche"]
    current = {x["costId"]: x for x in package_rows(context, tranche)}
    prior_items = {x["costId"]: x for x in original["completion"]["completionPlan"]["inputs"]["items"]}
    plan = selected_plan(context, tranche)
    current_items = {x["costId"]: x for x in (plan["inputs"]["items"] if plan else [])}
    return {"originalPlanContentSha256": original["snapshot"]["plan"]["contentSha256"],
            "currentPlanContentSha256": context["plan"]["contentSha256"],
            "packages": [{"costId": key, "original": deepcopy(old.get(key)), "current": deepcopy(current.get(key)),
                          "originalAssignment": deepcopy(prior_items.get(key)), "currentAssignment": deepcopy(current_items.get(key)),
                          "changed": old.get(key) != current.get(key) or prior_items.get(key) != current_items.get(key)}
                         for key in sorted(set(old) | set(current))]}


def assess(context, inputs, source, original, as_of):
    available = {kind: {x["id"]: x for x in context["records"][kind]} for kind in domain.KINDS}
    current = available["outcomes"].get(source["id"])
    issues = []
    def issue(code, message, finding=None):
        issues.append({"code": code, "findingId": finding, "costId": None, "message": message})
    if current != source:
        issue("CORRECTION_ISSUER_SOURCE_CHANGED", "The current issuer outcome differs from the selected changes-requested edition.")
    if source["date"] > as_of:
        issue("CORRECTION_BEFORE_DECISION", "The selected preparation date precedes the actual issuer decision.")
    costs = {x["id"] for x in context["plan"]["scenario"]["future_costs"]}
    for row in inputs["document"]["findings"]:
        fid = row["id"]
        if not set(row["costIds"]).issubset(costs) or not set(row["ownerIds"]).issubset(available["contributors"]):
            issue("CORRECTION_BINDINGS_CHANGED", "Review missing current work packages or contributors.", fid)
        if row["state"] not in ("ADDRESSED", "NOT_APPLICABLE"):
            issue("CORRECTION_OPEN", "Resolve the entered finding before re-preparation.", fid)
        if not row["ownerIds"]:
            issue("CORRECTION_OWNER", "Select an accountable original contributor.", fid)
        if not row["costIds"]:
            issue("CORRECTION_PACKAGE", "Select the original current work package(s) addressed by this finding.", fid)
        if row["completedOn"] and (row["completedOn"] > as_of or row["completedOn"] < source["date"]):
            issue("CORRECTION_DATE", "The actual correction date must follow the issuer decision and not exceed preparation.", fid)
        for wid in row["workIds"]:
            work = available["work"].get(wid)
            if (not work or work["state"] == "VOID" or work["costId"] not in row["costIds"]
                    or work["contributorId"] not in row["ownerIds"] or work["endDate"] > as_of):
                issue("CORRECTION_WORK_CHANGED", "Review the selected original work and its package, contributor and date.", fid)
        for did in row["deploymentIds"]:
            dep = available["deployments"].get(did)
            if not dep or dep.get("tranche") not in (None, source["tranche"]) or (
                    dep["costIds"] and not set(dep["costIds"]).intersection(row["costIds"])):
                issue("CORRECTION_DEPLOYMENT_CHANGED", "Review the selected original deployment's package and tranche.", fid)
        for sid in row["sourceIds"]:
            if sid not in context["sources"]:
                issue("CORRECTION_SOURCE_MISSING", "The selected original attachment is unavailable.", fid)
    return {"readyForPreparation": not issues, "sourceCurrent": current == source, "issues": issues,
            "comparison": comparison(context, original), "findingCount": len(inputs["document"]["findings"]),
            "addressed": sum(x["state"] == "ADDRESSED" for x in inputs["document"]["findings"]),
            "notApplicable": sum(x["state"] == "NOT_APPLICABLE" for x in inputs["document"]["findings"])}


def preview(ops, context, inputs, as_of=None):
    from operations_completion import today, business_snapshot
    as_of = domain.calendar(as_of or today(), "Correction review date")
    if context["program"]["mode"] != "WALKTHROUGH" and as_of > today():
        fail("Use an actual correction review date.")
    obj(inputs, INPUT_KEYS, "correction input")
    selected = reviews(ops, context["program"]["id"])
    latest = head(selected, inputs["roundId"])
    previous = next((x for x in selected if x["id"] == inputs["previousReviewId"]), None)
    if (latest["id"] if latest else None) != inputs["previousReviewId"]:
        fail("The correction round has a newer edition. Compare it with the preserved draft.", "COMPLETION_CORRECTIONS_HEAD_CHANGED", 409)
    if previous:
        source = previous["corrections"]["sourceOutcome"]
        original = previous["corrections"]["originalPreparation"]
    else:
        source = source_outcome(context, inputs["outcomeId"], inputs["expectedOutcomeSha256"])
        original = original_review(ops, context["program"]["id"], source)
    normalized = normalize(context, inputs, source, previous)
    result = {"schema": SCHEMA, "caseId": context["program"]["id"], "caseVersion": context["program"]["version"],
              "sourceSha256": digest(business_snapshot(context)), "asOfDate": as_of,
              "revision": (previous["corrections"]["revision"] + 1) if previous else 1,
              "inputs": normalized, "sourceOutcome": deepcopy(source), "originalPreparation": deepcopy(original),
              "report": assess(context, normalized, source, original, as_of)}
    result["previewSha256"] = digest(result)
    return result


def save(ops, context, data, actor, next_version):
    from operations_completion import business_snapshot
    obj(data, ("inputs", "asOfDate", "expectedPreviewSha256"), "correction save")
    candidate = preview(ops, context, data["inputs"], data["asOfDate"])
    if candidate["previewSha256"] != data["expectedPreviewSha256"]:
        fail("The correction preview changed. Review the complete current source.", "COMPLETION_CORRECTIONS_PREVIEW_CHANGED", 409)
    if candidate["revision"] > MAX_EDITIONS:
        fail("This correction round has reached its retained-edition bound.", status=413)
    snapshot = business_snapshot(context)
    after = {"id": "review-" + uuid.uuid4().hex, "version": next_version, "createdAt": now(),
             "actor": actor, "note": "Saved correction round: " + candidate["inputs"]["document"]["title"],
             "businessSha256": digest(snapshot), "snapshot": snapshot, "report": domain.report(**context),
             "purpose": PURPOSE, "corrections": candidate}
    ops.db.execute("INSERT INTO ops_reviews VALUES(?,?,?)", (context["program"]["id"], after["id"], canonical(after)))
    event_after = {key: after[key] for key in ("id", "version", "businessSha256", "purpose")}
    event_after.update({"correctionRoundId": candidate["inputs"]["roundId"],
                        "correctionRevision": candidate["revision"], "correctionPreviewSha256": candidate["previewSha256"]})
    return {"before": None, "after": event_after,
            "kind": "review", "recordId": after["id"], "unchanged": False,
            "roundId": candidate["inputs"]["roundId"], "revision": candidate["revision"],
            "previewSha256": candidate["previewSha256"]}


def summary(review):
    c = review["corrections"]
    return {"correctionRoundId": c["inputs"]["roundId"], "correctionRevision": c["revision"],
            "correctionOutcomeId": c["sourceOutcome"]["id"], "completionTranche": c["sourceOutcome"]["tranche"],
            "correctionTitle": c["inputs"]["document"]["title"], "correctionReady": c["report"]["readyForPreparation"]}


def evidence(context, review, as_of, receipt_id):
    validate_review(review)
    c = review["corrections"]
    if c["asOfDate"] > as_of:
        fail("The correction edition was reviewed after this preparation date.", status=409)
    if c["sourceOutcome"]["completion"]["receiptId"] != receipt_id:
        fail("The correction round belongs to a different original payment.", status=409)
    report = assess(context, c["inputs"], c["sourceOutcome"], c["originalPreparation"], as_of)
    return {"reviewId": review["id"], "review": deepcopy(review), "report": report}


def validate_review(review, previous=None):
    c = review.get("corrections")
    if review.get("purpose") != PURPOSE or not isinstance(c, dict) or c.get("schema") != SCHEMA:
        fail("Retain a complete native correction review.", status=409)
    context = snapshot_context(review)
    if c["caseId"] != context["program"]["id"] or c["caseVersion"] != review["version"] - 1:
        fail("The correction edition differs from its original case/version.", status=409)
    domain.calendar(c["asOfDate"], "Frozen correction review date")
    if previous and c["originalPreparation"] != previous["corrections"]["originalPreparation"]:
        fail("Retain the original submitted preparation throughout the correction round.", status=409)
    source = c["sourceOutcome"]
    if source.get("state") != "CHANGES_REQUESTED" or not source.get("completion"):
        fail("The frozen correction lacks its actual issuer decision.", status=409)
    validate_original(source, c["originalPreparation"])
    normalized = normalize(context, c["inputs"], source, previous)
    expected = {key: deepcopy(value) for key, value in c.items() if key != "previewSha256"}
    if (normalized != c["inputs"] or digest(expected) != c["previewSha256"]
            or c["sourceSha256"] != review["businessSha256"]
            or assess(context, normalized, source, c["originalPreparation"], c["asOfDate"]) != c["report"]):
        fail("The frozen correction differs from its full original source.", status=409)
    domain.integer(c["revision"], "Correction edition", 1, MAX_EDITIONS)


def validate_import(reviews_, events):
    by_id = {x["id"]: x for x in reviews_}
    heads = {}
    for row in sorted((x for x in reviews_ if x.get("purpose") == PURPOSE), key=lambda x: x["version"]):
        c = row["corrections"]
        previous = by_id.get(c["inputs"]["previousReviewId"])
        validate_review(row, previous)
        rid = c["inputs"]["roundId"]
        if c["inputs"]["previousReviewId"] != heads.get(rid):
            fail("The correction revision chain is missing, reordered or branched.", status=409)
        if c["revision"] != (previous["corrections"]["revision"] + 1 if previous else 1):
            fail("The correction edition number differs from its original chain.", status=409)
        original = c["originalPreparation"]
        if by_id.get(original["id"]) != original or original["version"] >= row["version"]:
            fail("Retain the exact earlier submitted preparation.", status=409)
        source = c["sourceOutcome"]
        if not any(e.get("after") == source and e["version"] < row["version"] for e in events):
            fail("The original issuer decision is missing its retained case event.", status=409)
        event = events[row["version"] - 1]
        expected_after = {k: row[k] for k in ("id", "version", "businessSha256", "purpose")}
        expected_after.update({"correctionRoundId": rid, "correctionRevision": c["revision"],
                               "correctionPreviewSha256": c["previewSha256"]})
        if (event.get("action") != "completion.corrections.save" or event.get("recordId") != row["id"]
                or event.get("after") != expected_after):
            fail("The correction review lacks its exact original save event.", status=409)
        heads[rid] = row["id"]
    for row in reviews_:
        evidence_ = row.get("completion", {}).get("correctionEvidence")
        if evidence_:
            original = by_id.get(evidence_["reviewId"])
            if original != evidence_["review"] or original["version"] >= row["version"]:
                fail("The re-preparation is missing its earlier complete correction edition.", status=409)


def file_map(review, read_source):
    validate_review(review)
    from operations_completion import review_files
    c = review["corrections"]
    source_ids = set(c["sourceOutcome"]["sourceIds"])
    for row in c["inputs"]["document"]["findings"]:
        source_ids.update(row["sourceIds"])
        for kind, key in (("work", "workIds"), ("deployments", "deploymentIds")):
            selected = {x["id"]: x for x in review["snapshot"]["records"][kind]}
            for ident_ in row[key]:
                source_ids.update(selected[ident_]["sourceIds"])
    metadata = {x["id"]: x for x in review["snapshot"]["sources"]}
    files = {"corrections.json": (canonical(review) + "\n").encode(),
             "original-preparation.zip": review_files(c["originalPreparation"], read_source)}
    for sid in sorted(source_ids):
        actual, raw = read_source(sid)
        if (sid not in metadata or actual["sha256"] != metadata[sid]["sha256"]
                or len(raw) != metadata[sid]["bytes"] or hashlib.sha256(raw).hexdigest() != metadata[sid]["sha256"]):
            fail("An original correction source changed.", status=409)
        files["sources/" + sid] = raw
    e = lambda x: html.escape(str(x if x is not None else ""), quote=True)
    rows = c["inputs"]["document"]["findings"]
    csv_rows = [{**x, "costIds": "; ".join(x["costIds"]), "ownerIds": "; ".join(x["ownerIds"])} for x in rows]
    files["findings.csv"] = csv_bytes(["id", "request", "basis", "costIds", "ownerIds", "state", "dueOn", "completedOn", "response"], csv_rows)
    files["comparison.json"] = (canonical(c["report"]["comparison"]) + "\n").encode()
    files["corrections.html"] = ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        '<title>Tranche correction round</title><style>body{font:16px system-ui;color:#222;max-width:1100px;margin:2rem auto;padding:0 1rem}'
        'table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:.6rem;text-align:left;vertical-align:top;white-space:pre-wrap}'
        '.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>' + e(c["inputs"]["document"]["title"]) +
        '</h1><p>Original issuer outcome ' + e(c["sourceOutcome"]["id"]) + ' · ' + e(c["sourceOutcome"]["date"]) +
        '</p><p>Operator correction assessment; issuer acceptance remains a separate actual decision. Internal target dates do not extend the original payment clock.</p>'
        '<div class="scroll"><table><thead><tr><th>Finding / source</th><th>Package / owner</th><th>State / date</th><th>Response</th></tr></thead><tbody>' +
        ''.join('<tr><td>' + e(x["request"]) + '<br>' + e(x["basis"]) + '</td><td>' + e(', '.join(x["costIds"])) +
                '<br>' + e(', '.join(x["ownerIds"])) + '</td><td>' + e(x["state"]) + '<br>' + e(x["completedOn"]) +
                '</td><td>' + e(x["response"]) + '</td></tr>' for x in rows) +
        '</tbody></table></div><h2>Original and current packages</h2><pre>' + e(json.dumps(c["report"]["comparison"], indent=2)) +
        '</pre><p><a href="original-preparation.zip">Complete original submitted preparation</a></p></html>').encode()
    return files


def export(review, read_source):
    files = file_map(review, read_source)
    if sum(map(len, files.values())) > MAX_BUNDLE:
        fail("The complete correction package exceeds the original archive bound.", status=413)
    files["MANIFEST.json"] = (canonical({"schema": SCHEMA, "reviewId": review["id"], "files": [
        {"path": path, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()} for path, raw in sorted(files.items())]}) + "\n").encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, raw in sorted(files.items()):
            info = zipfile.ZipInfo(path, (2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    return output.getvalue()

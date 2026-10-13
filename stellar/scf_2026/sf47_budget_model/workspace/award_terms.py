"""Issuer correspondence, explicit award terms and native planning receiving.

Original attachments, source history, awards, planner and amendments remain in
the existing Operations workspace. An acknowledgement records an application
stage; unissued award terms remain empty.
"""
from __future__ import annotations

import base64
from copy import deepcopy
from datetime import date
from decimal import Decimal
import hashlib
import html
import json
import re
import uuid

from model import Problem, canonical, digest, now, text, csv_bytes
import operations_domain as domain
import operations_amendments as amendments

SCHEMA = "stellar-forge.sf47-award-terms.v1"
MARKER = "awardTerms"
COMMISSION_MARKER = "awardTermsCommissioning"
COMMISSION_SCHEMA = SCHEMA + ".commissioning"
MEDIA = "application/json"
STAGES = ("UNRECORDED", "INTEREST_ACKNOWLEDGED", "INVITED", "SUBMITTED", "AWARDED", "DECLINED", "WITHDRAWN")
TRACKS = ("OPEN", "INTEGRATION", "RFP")
ACTIONS = ("award-terms.save", "award-terms.plan-bind")
MAX_EDITIONS = 100
SELECTION_FILES = {"award-terms-selection.json", "award-terms.html", "award-terms.csv"}
DOCUMENT_FIELDS = ("title", "proposalTrack", "issuerTrack", "stage", "issuer", "round",
                   "sourceIds", "guidanceSourceIds", "fieldSources", "award", "note")


def fail(message, code="INVALID_AWARD_TERMS", status=422):
    raise Problem(message, status, code)


def obj(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        fail("Use the documented " + label + " fields.")
    return value


def ident(value):
    if not isinstance(value, str) or not re.fullmatch(r"terms-[a-f0-9]{32}", value):
        fail("Select the original issuer-terms identity.")
    return value


def refs(value, context, label):
    return domain.reference_list(value or [], context["sources"], label)


def optional_integer(value, label, minimum=1, maximum=1000000):
    return domain.integer(value, label, minimum, maximum, True)


def normalized(context, value):
    value = obj(value, DOCUMENT_FIELDS, "issuer terms")
    issuer = obj(value.get("issuer", {}), ("name", "reference", "messageId", "issuedOn", "subject"), "issuer message")
    round_value = obj(value.get("round", {}), ("label", "deadlineOn", "deadlineBasis", "formUrl"), "round selection")
    stage = domain.enum(value.get("stage", "UNRECORDED"), STAGES, "Observed application stage")
    issuer_track = value.get("issuerTrack")
    if issuer_track is not None:
        issuer_track = domain.enum(issuer_track, TRACKS, "Issuer-selected track")
    result = {
        "title": text(value.get("title"), "Terms workspace name", 500, True),
        "proposalTrack": domain.enum(value.get("proposalTrack", "OPEN"), TRACKS, "Proposed track"),
        "issuerTrack": issuer_track, "stage": stage,
        "issuer": {
            "name": text(issuer.get("name", ""), "Issuer name", 500),
            "reference": text(issuer.get("reference", ""), "Original issuer reference", 1000),
            "messageId": text(issuer.get("messageId", ""), "Original message identity", 2000),
            "issuedOn": domain.calendar(issuer.get("issuedOn"), "Issuer message date", True),
            "subject": text(issuer.get("subject", ""), "Original message subject", 2000),
        },
        "round": {
            "label": text(round_value.get("label", ""), "Round name", 300),
            "deadlineOn": domain.calendar(round_value.get("deadlineOn"), "Full-submission deadline", True),
            "deadlineBasis": domain.enum(round_value.get("deadlineBasis", "UNSTATED"),
                                         ("UNSTATED", "PUBLIC_SCHEDULE", "ISSUER_MESSAGE"), "Deadline source"),
            "formUrl": domain.url(round_value.get("formUrl", ""), "Issuer submission URL"),
        },
        "sourceIds": refs(value.get("sourceIds"), context, "Original issuer sources"),
        "guidanceSourceIds": refs(value.get("guidanceSourceIds"), context, "Selected published guidance"),
        "fieldSources": [],
        "award": None,
        "note": text(value.get("note", ""), "Receiving note", 20000),
    }
    mappings = value.get("fieldSources", [])
    if not isinstance(mappings, list) or len(mappings) > 100:
        fail("Keep at most 100 explicit field-to-source selections.")
    for mapping in mappings:
        obj(mapping, ("field", "sourceIds", "excerpt", "note"), "field source")
        result["fieldSources"].append({
            "field": text(mapping.get("field"), "Selected term or field", 300, True),
            "sourceIds": refs(mapping.get("sourceIds"), context, "Field source"),
            "excerpt": text(mapping.get("excerpt", ""), "Selected source passage", 12000),
            "note": text(mapping.get("note", ""), "Field interpretation", 12000),
        })
    if stage != "UNRECORDED":
        if not result["issuer"]["reference"] or not result["issuer"]["issuedOn"]:
            fail("Enter the original reference and date for the selected application observation.")
        if not result["sourceIds"]:
            fail("Select the original issuer message or document for this observation.")
    if result["round"]["deadlineOn"] is not None and result["round"]["deadlineBasis"] == "UNSTATED":
        fail("Choose whether the deadline comes from the published schedule or an issuer message.")
    if result["round"]["deadlineOn"] is not None:
        if result["round"]["deadlineBasis"] == "PUBLIC_SCHEDULE" and not result["guidanceSourceIds"]:
            fail("Select the retained published schedule for this deadline.")
        if result["round"]["deadlineBasis"] == "ISSUER_MESSAGE" and not result["sourceIds"]:
            fail("Select the original issuer source for this deadline.")
    supplied_award = value.get("award")
    if supplied_award is not None:
        if stage != "AWARDED":
            fail("Keep award terms empty until the selected observation is an issuer award decision.")
        award = obj(supplied_award, ("reference", "amountUsd", "acceptedOn", "durationDays", "conditions",
                                     "tranches", "metric"), "issued award")
        tranches = award.get("tranches", [])
        if not isinstance(tranches, list) or len(tranches) > 3:
            fail("Retain at most the three stated delivery tranches.")
        retained, seen = [], set()
        for tranche in tranches:
            obj(tranche, ("tranche", "submitDay", "deliverable", "successCriteria", "sourceIds"), "issued tranche")
            number = domain.integer(tranche.get("tranche"), "Issued tranche", 1, 3)
            if number in seen:
                fail("Select each issued tranche once.")
            seen.add(number)
            retained.append({
                "tranche": number,
                "submitDay": optional_integer(tranche.get("submitDay"), "Issued relative submission day", 0, 500),
                "deliverable": text(tranche.get("deliverable", ""), "Issued deliverable", 12000),
                "successCriteria": text(tranche.get("successCriteria", ""), "Issued completion condition", 16000),
                "sourceIds": refs(tranche.get("sourceIds"), context, "Issued tranche sources"),
            })
        metric = award.get("metric")
        if metric is not None:
            metric = obj(metric, ("name", "target", "unit", "aggregation", "comparison", "network",
                                  "windowStart", "windowEnd", "calendarDays", "ratification",
                                  "sourceIds", "definition"), "issued outcome metric")
            metric = {
                "name": text(metric.get("name"), "Metric name", 1000, True),
                "target": None if metric.get("target") in (None, "") else
                          domain.quantity(metric["target"], "Metric target", 7),
                "unit": text(metric.get("unit", ""), "Metric unit", 300),
                "aggregation": domain.enum(metric.get("aggregation", "CUSTOM"),
                                           ("TOTAL", "AVERAGE", "MINIMUM", "COUNT", "CUSTOM"), "Metric aggregation"),
                "comparison": domain.enum(metric.get("comparison", "AT_LEAST"),
                                          ("AT_LEAST", "AT_MOST", "EQUAL", "CUSTOM"), "Metric comparison"),
                "network": text(metric.get("network", ""), "Metric network", 500),
                "windowStart": domain.calendar(metric.get("windowStart"), "Metric window start", True),
                "windowEnd": domain.calendar(metric.get("windowEnd"), "Metric window end", True),
                "calendarDays": optional_integer(metric.get("calendarDays"), "Metric window days", 1, 366),
                "ratification": domain.enum(metric.get("ratification", "UNSTATED"),
                                             ("UNSTATED", "PROPOSED", "RATIFIED"), "Recorded ratification"),
                "sourceIds": refs(metric.get("sourceIds"), context, "Metric decision sources"),
                "definition": text(metric.get("definition", ""), "Complete metric definition", 16000),
            }
            if metric["ratification"] == "RATIFIED" and not metric["sourceIds"]:
                fail("Select the original source for the recorded metric ratification.")
            if metric["windowStart"] and metric["windowEnd"]:
                duration = (date.fromisoformat(metric["windowEnd"]) - date.fromisoformat(metric["windowStart"])).days + 1
                if duration <= 0:
                    fail("Keep the metric window in chronological order.")
                if metric["calendarDays"] is not None and metric["calendarDays"] != duration:
                    fail("The metric dates and inclusive calendar-day count must agree.")
        result["award"] = {
            "reference": text(award.get("reference", ""), "Award agreement reference", 1000),
            "amountUsd": None if award.get("amountUsd") in (None, "") else domain.usd(award["amountUsd"], "Issued award amount", True),
            "acceptedOn": domain.calendar(award.get("acceptedOn"), "Actual award acceptance", True),
            "durationDays": optional_integer(award.get("durationDays"), "Issued delivery duration", 1, 500),
            "conditions": text(award.get("conditions", ""), "Complete award conditions", 24000),
            "tranches": sorted(retained, key=lambda row: row["tranche"]),
            "metric": metric,
        }
    return result


def source_ids(document):
    chosen = set(document["sourceIds"] + document["guidanceSourceIds"])
    for row in document["fieldSources"]:
        chosen.update(row["sourceIds"])
    if document["award"]:
        for row in document["award"]["tranches"]:
            chosen.update(row["sourceIds"])
        if document["award"]["metric"]:
            chosen.update(document["award"]["metric"]["sourceIds"])
    return sorted(chosen)


def plan_comparison(document, plan):
    scenario = plan["scenario"]
    award = document["award"]
    proposed = {
        "track": document["proposalTrack"],
        "amountUsd": domain.usd(scenario["award_request_usd"], "Proposed award"),
        "durationDays": scenario["project_end_day"],
        "packages": deepcopy(scenario["future_costs"]),
        "milestones": deepcopy(scenario["milestones"]),
        "payouts": deepcopy(plan["report"].get("originalModel", {}).get("payouts", [])),
        "planRevision": plan["revision"],
        "contentSha256": plan["contentSha256"],
    }
    differences = []
    def compare(field, original, issued, issued_state=True):
        state = "UNISSUED" if not issued_state else "UNSTATED" if issued is None else "MATCH" if original == issued else "DIFFERENT"
        differences.append({"field": field, "proposed": original, "issued": issued, "state": state})
    compare("Track", proposed["track"], document["issuerTrack"], document["issuerTrack"] is not None)
    compare("Award amount (USD)", proposed["amountUsd"], award["amountUsd"] if award else None, award is not None)
    compare("Delivery duration (days)", proposed["durationDays"], award["durationDays"] if award else None, award is not None)
    by_tranche = {row["tranche"]: row for row in (award["tranches"] if award else [])}
    for milestone in scenario["milestones"]:
        issued = by_tranche.get(milestone["tranche"])
        for field, key, actual_key in (("submission day", "submit_day", "submitDay"),
                                        ("deliverable", "deliverable", "deliverable"),
                                        ("completion condition", "measurable_proof", "successCriteria")):
            observed = issued.get(actual_key) if issued else None
            compare("Tranche " + str(milestone["tranche"]) + " " + field,
                    milestone.get(key), observed if observed not in ("", None) else None, award is not None)
    metric = award["metric"] if award else None
    selected_track = document["issuerTrack"] or document["proposalTrack"]
    return {
        "proposal": proposed,
        "applicationStage": document["stage"],
        "selectedTrack": selected_track,
        "awardTermsIssued": award is not None,
        "differences": differences,
        "changedFields": sum(row["state"] == "DIFFERENT" for row in differences),
        "unissuedFields": sum(row["state"] == "UNISSUED" for row in differences),
        "amountDifferenceUsd": format(Decimal(award["amountUsd"]) - Decimal(proposed["amountUsd"]), ".2f")
                              if award and award["amountUsd"] is not None else None,
        "metric": deepcopy(metric),
        "metricScope": "Integration Track final-tranche outcome" if selected_track == "INTEGRATION"
                       else "Selected issuer outcome condition" if metric else "Existing proposed delivery and adoption outcomes",
        "acceptanceOn": award["acceptedOn"] if award else None,
    }


def seed(context):
    return {
        "id": "terms-" + uuid.uuid4().hex, "expectedRevision": 0,
        "document": {
            "title": "SCF issuer correspondence and award terms",
            "proposalTrack": "OPEN", "issuerTrack": None, "stage": "UNRECORDED",
            "issuer": {"name": "", "reference": "", "messageId": "", "issuedOn": None, "subject": ""},
            "round": {"label": "", "deadlineOn": None, "deadlineBasis": "UNSTATED", "formUrl": ""},
            "sourceIds": [], "guidanceSourceIds": [], "fieldSources": [], "award": None, "note": "",
        },
        "plan": deepcopy(context["plan"]),
    }


def snapshot(context, document):
    return {
        "case": {key: context["program"][key] for key in ("id", "version", "mode", "planId", "planRevision")},
        "plan": deepcopy(context["plan"]),
        "sources": [deepcopy(context["sources"][key]) for key in source_ids(document)],
    }


def read_record(metadata, raw):
    if metadata.get("mediaType") != MEDIA or len(raw) != metadata.get("bytes") or hashlib.sha256(raw).hexdigest() != metadata.get("sha256"):
        fail("The retained issuer-terms source differs from its original complete bytes.", "AWARD_TERMS_SOURCE", 409)
    try:
        row = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise Problem("The retained issuer-terms edition cannot be read.", 422, "AWARD_TERMS_SOURCE") from exc
    if not isinstance(row, dict) or row.get("schema") != SCHEMA:
        fail("Select a complete supported issuer-terms edition.", "AWARD_TERMS_SOURCE")
    ident(row.get("id"))
    domain.integer(row.get("revision"), "Original terms revision", 1, MAX_EDITIONS)
    domain.integer(row.get("caseVersion"), "Original case version", 2, 10000000)
    domain.timestamp(row.get("savedAt"), "Terms save time")
    text(row.get("actor"), "Recording operator", 300, True)
    text(row.get("note", ""), "Terms save note", 12000)
    captured = obj(row.get("source"), ("case", "plan", "sources"), "original terms source")
    if not isinstance(captured.get("sources"), list):
        fail("Retain the complete original issuer source selection.")
    selected = {item["id"]: item for item in captured["sources"]}
    if len(selected) != len(captured["sources"]):
        fail("The issuer edition repeats a source identity.")
    document = normalized({"sources": selected}, row.get("document"))
    if (document != row["document"] or plan_comparison(document, captured["plan"]) != row.get("comparison")
            or digest({key: value for key, value in row.items() if key != "sha256"}) != row.get("sha256")
            or metadata.get(MARKER) != {"schema": SCHEMA, "id": row["id"], "revision": row["revision"], "sha256": row["sha256"]}):
        fail("The complete issuer terms or planning comparison have changed.", "AWARD_TERMS_SOURCE", 409)
    return {"source": metadata, "edition": row}


def checked_chain(rows):
    grouped = {}
    for row in rows:
        grouped.setdefault(row["edition"]["id"], []).append(row)
    for selected in grouped.values():
        selected.sort(key=lambda row: row["edition"]["revision"])
        previous = None
        for revision, row in enumerate(selected, 1):
            expected = None if previous is None else {"sourceId": previous["source"]["id"],
                        "sha256": previous["source"]["sha256"], "revision": previous["edition"]["revision"]}
            if row["edition"]["revision"] != revision or row["edition"].get("previous") != expected:
                fail("Retain every original issuer-terms edition in its complete revision chain.", "AWARD_TERMS_HISTORY", 409)
            previous = row
    return sorted(rows, key=lambda row: (row["edition"]["id"], row["edition"]["revision"]))


def records(operations, program_id):
    found = []
    for metadata_raw, raw in operations.db.execute(
            "SELECT metadata_json,content FROM ops_sources WHERE program_id=? ORDER BY id", (program_id,)):
        metadata = json.loads(metadata_raw)
        if MARKER in metadata:
            found.append(read_record(metadata, bytes(raw)))
    return checked_chain(found)


def heads(rows):
    found = {}
    for row in rows:
        found[row["edition"]["id"]] = row
    return list(found.values())


def summary(row):
    edition = row["edition"]
    return {"id": edition["id"], "revision": edition["revision"], "title": edition["document"]["title"],
            "stage": edition["document"]["stage"], "track": edition["document"]["issuerTrack"] or edition["document"]["proposalTrack"],
            "issuedOn": edition["document"]["issuer"]["issuedOn"], "savedAt": edition["savedAt"],
            "caseVersion": edition["caseVersion"], "sourceId": row["source"]["id"],
            "sourceSha256": row["source"]["sha256"], "sha256": edition["sha256"],
            "nativeAwardId": edition.get("nativeAwardId"),
            "awardAmountUsd": (edition["document"]["award"] or {}).get("amountUsd"),
            "changedFields": edition["comparison"]["changedFields"]}


def get(operations, program_id, terms_id, revision=None):
    ident(terms_id)
    matches = [row for row in records(operations, program_id) if row["edition"]["id"] == terms_id]
    if revision is not None:
        revision = domain.integer(revision, "Selected terms revision", 1, MAX_EDITIONS)
        matches = [row for row in matches if row["edition"]["revision"] == revision]
    if not matches:
        fail("The selected issuer-terms edition is unavailable.", "AWARD_TERMS_NOT_FOUND", 404)
    return matches[-1]


def preview(operations, context, body):
    obj(body, ("expectedVersion", "inputs"), "issuer-terms preview")
    if domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000) != context["program"]["version"]:
        fail("The case changed. Keep this draft and review its current source.", "OPERATIONS_CONFLICT", 409)
    inputs = obj(body.get("inputs"), ("id", "expectedRevision", "document"), "terms input")
    terms_id = ident(inputs.get("id"))
    revision = domain.integer(inputs.get("expectedRevision"), "Prior terms revision", 0, MAX_EDITIONS - 1)
    prior = next((row for row in heads(records(operations, context["program"]["id"])) if row["edition"]["id"] == terms_id), None)
    if revision != (prior["edition"]["revision"] if prior else 0):
        fail("A later issuer-terms edition exists. Compare it while retaining your draft.", "AWARD_TERMS_CONFLICT", 409)
    document = normalized(context, inputs.get("document"))
    if prior and prior["edition"].get("nativeAwardId") and document["stage"] == "UNRECORDED":
        fail("Retain the observed issuer event in this edition. Start a new terms workspace for an unrecorded draft.")
    captured = snapshot(context, document)
    result = {"schema": SCHEMA + ".preview", "inputs": {"id": terms_id, "expectedRevision": revision, "document": document},
              "source": captured, "comparison": plan_comparison(document, context["plan"])}
    result["previewSha256"] = digest(result)
    return result


def save(operations, context, data, actor, version, note):
    obj(data, ("inputs", "expectedPreviewSha256"), "reviewed issuer terms")
    candidate = preview(operations, context, {"expectedVersion": context["program"]["version"], "inputs": data.get("inputs")})
    if candidate["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed issuer terms", False):
        fail("The issuer terms differ from the reviewed complete preview.", "AWARD_TERMS_PREVIEW", 409)
    inputs = candidate["inputs"]
    prior = next((row for row in heads(records(operations, context["program"]["id"])) if row["edition"]["id"] == inputs["id"]), None)
    old_award_id = prior["edition"].get("nativeAwardId") if prior else None
    before = next((row for row in context["records"]["awards"] if row["id"] == old_award_id), None)
    observed = inputs["document"]["stage"] != "UNRECORDED"
    award_id = (old_award_id or "award-" + uuid.uuid4().hex) if observed else None
    row = {"schema": SCHEMA, "id": inputs["id"], "revision": inputs["expectedRevision"] + 1,
           "previous": None if prior is None else {"sourceId": prior["source"]["id"], "sha256": prior["source"]["sha256"],
                                                   "revision": prior["edition"]["revision"]},
           "caseVersion": version, "savedAt": now(), "actor": actor, "note": note,
           "document": inputs["document"], "source": candidate["source"], "comparison": candidate["comparison"],
           "previewSha256": candidate["previewSha256"], "nativeAwardId": award_id}
    row["sha256"] = digest(row)
    raw = (canonical(row) + "\n").encode()
    metadata = operations._source_add(context["program"]["id"], {
        "filename": row["id"] + "-r" + str(row["revision"]) + ".json", "mediaType": MEDIA, "kind": "grant",
        "observedAt": row["savedAt"], "contentBase64": base64.b64encode(raw).decode("ascii")})
    metadata[MARKER] = {"schema": SCHEMA, "id": row["id"], "revision": row["revision"], "sha256": row["sha256"]}
    operations.db.execute("UPDATE ops_sources SET metadata_json=? WHERE program_id=? AND id=?",
                          (canonical(metadata), context["program"]["id"], metadata["id"]))
    if observed:
        if before is None and operations.db.execute("SELECT COUNT(*) FROM ops_records WHERE program_id=?",
                (context["program"]["id"],)).fetchone()[0] >= 5000:
            fail("The case has reached its retained-record bound.", "OPERATIONS_LIMIT", 413)
        document = row["document"]
        native_source_ids = list(dict.fromkeys(document["sourceIds"] + [metadata["id"]]))
        native_context = {**context, "sources": {**context["sources"], metadata["id"]: metadata}}
        native = domain.prepare("awards", {
            "stage": document["stage"], "reference": document["issuer"]["reference"], "date": document["issuer"]["issuedOn"],
            "amountUsd": (document["award"] or {}).get("amountUsd"), "sourceIds": native_source_ids,
            "sourceNote": "Original issuer terms " + row["id"] + " revision " + str(row["revision"]),
        }, native_context, before)
        after = {**native, "id": award_id, "version": version, "createdAt": before["createdAt"] if before else row["savedAt"],
                 "updatedAt": row["savedAt"], "recordedBy": actor}
        operations._save(context["program"]["id"], "awards", after)
        kind, record_id = "awards", award_id
    else:
        before, after, kind, record_id = None, metadata, "source", metadata["id"]
    return {"before": before, "after": after, "kind": kind, "recordId": record_id,
            "sourceChange": {"issuerTermsSource": metadata}, "awardTerms": summary({"source": metadata, "edition": row})}



def commission_seed(operations, context, terms_id, revision=None):
    selected = get(operations, context["program"]["id"], terms_id, revision)
    latest = operations.workspace._read(context["program"]["planId"])
    return {
        "termsId": selected["edition"]["id"], "termsRevision": selected["edition"]["revision"],
        "expectedTermsSha256": selected["edition"]["sha256"],
        "basis": "PROPOSAL", "asOfDate": date.today().isoformat(), "reason": "",
        "expectedPlanRevision": latest["currentRevision"],
        "expectedPlanContentSha256": latest["contentSha256"],
        "patch": {}, "planning": deepcopy(latest["planning"]),
    }


def commission_inputs(context, value):
    value = obj(value, ("termsId", "termsRevision", "expectedTermsSha256", "basis", "asOfDate", "reason",
                       "expectedPlanRevision", "expectedPlanContentSha256", "patch", "planning", "packageMappings"),
                "reviewed planning inputs")
    result = {
        "termsId": ident(value.get("termsId")),
        "termsRevision": domain.integer(value.get("termsRevision"), "Selected terms edition", 1, MAX_EDITIONS),
        "expectedTermsSha256": domain.sha(value.get("expectedTermsSha256"), "Selected terms edition", False),
        "basis": domain.enum(value.get("basis"), ("PROPOSAL", "ISSUER_TERMS"), "Planning basis"),
        "asOfDate": domain.calendar(value.get("asOfDate"), "Planning review date"),
        "reason": text(value.get("reason"), "Planning change reason", 4000, True),
        "expectedPlanRevision": domain.integer(value.get("expectedPlanRevision"), "Reviewed native planning revision", 1, 1000000),
        "expectedPlanContentSha256": domain.sha(value.get("expectedPlanContentSha256"), "Reviewed native planning content", False),
        "patch": deepcopy(obj(value.get("patch", {}), ("scenario_name", "award_request_usd", "project_end_day",
                                                     "milestones", "future_costs"), "native scenario patch")),
        "planning": deepcopy(value.get("planning")),
    }
    if not isinstance(result["planning"], dict):
        fail("Retain the complete selected native planning settings.")
    if "packageMappings" in value:
        # The original amendment writer normalizes and applies these selections.
        if not isinstance(value["packageMappings"], list):
            fail("Use an explicit original amendment package-mapping list.")
        result["packageMappings"] = deepcopy(value["packageMappings"])
    return result


def amendment_inputs(inputs, selected, target):
    document = selected["edition"]["document"]
    observed = inputs["basis"] == "ISSUER_TERMS"
    value = {
        "selectedRevision": target["revision"], "expectedContentSha256": target["contentSha256"],
        "asOfDate": inputs["asOfDate"], "reason": inputs["reason"],
        "basis": {
            "kind": "ISSUER_DECISION" if observed else "INTERNAL_PLAN",
            "reference": document["issuer"]["reference"] if observed else document["title"],
            "date": document["issuer"]["issuedOn"] if observed else inputs["asOfDate"],
            "sourceIds": list(dict.fromkeys(document["sourceIds"] + [selected["source"]["id"]])),
            "note": inputs["reason"],
        },
    }
    if "packageMappings" in inputs:
        value["packageMappings"] = deepcopy(inputs["packageMappings"])
    return value


def commission_preview(operations, context, body):
    obj(body, ("expectedVersion", "inputs"), "planning commissioning preview")
    if domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000) != context["program"]["version"]:
        fail("The case changed. Retain your plan draft and review the current case.", "OPERATIONS_CONFLICT", 409)
    if context["program"]["state"] != "OPEN":
        fail("Reopen the case before preparing a new planning selection.", "OPERATIONS_CLOSED", 409)
    inputs = commission_inputs(context, body.get("inputs"))
    selected = get(operations, context["program"]["id"], inputs["termsId"], inputs["termsRevision"])
    if selected["edition"]["sha256"] != inputs["expectedTermsSha256"]:
        fail("The selected complete issuer edition differs.", "AWARD_TERMS_CONFLICT", 409)
    document = selected["edition"]["document"]
    if inputs["basis"] == "ISSUER_TERMS" and (document["stage"] != "AWARDED" or document["award"] is None):
        fail("Select an original issued award decision before using issued terms as the planning basis.")
    latest = operations.workspace._read(context["program"]["planId"])
    if latest["currentRevision"] != inputs["expectedPlanRevision"] or latest["contentSha256"] != inputs["expectedPlanContentSha256"]:
        fail("A newer native planning revision exists. Retain this draft and compare the current source.",
             "REVISION_CONFLICT", 409)
    native = operations.workspace.estimate(latest["id"], inputs["expectedPlanRevision"], inputs["patch"], inputs["planning"])
    changed = digest({"scenario": native["scenario"], "planning": native["planning"]}) != latest["contentSha256"]
    target = deepcopy(latest)
    if changed:
        target.update(native)
        target.update({"revision": latest["currentRevision"] + 1, "currentRevision": latest["currentRevision"] + 1,
                       "contentSha256": digest({"scenario": native["scenario"], "planning": native["planning"]}),
                       "note": inputs["reason"]})
        # Its native save time is assigned only by Workspace.save. This temporary
        # target exists solely for the original arithmetic/compatibility preview.
    original_amendment = None
    if not amendments.same_plan(context["plan"], target):
        original_amendment = amendments._preview(operations, context, amendment_inputs(inputs, selected, target), target)
    compared = {key: deepcopy(original_amendment[key]) for key in
                ("changes", "compatibility", "reports", "exposure", "paymentClocks")} if original_amendment else {
        "changes": [], "compatibility": {"compatible": True, "conflicts": []},
        "reports": {"before": domain.report(**context), "selected": domain.report(**context)},
        "exposure": None, "paymentClocks": None,
    }
    if original_amendment:
        for key in ("recordChanges", "retainedSelectionReviews"):
            if key in original_amendment:
                compared[key] = deepcopy(original_amendment[key])
    result = {
        "schema": COMMISSION_SCHEMA + ".preview", "inputs": inputs,
        "source": {
            "case": {key: context["program"][key] for key in ("id", "version", "mode", "planId", "planRevision")},
            "businessSha256": digest(operations._business(context)),
            "selectedTerms": deepcopy(selected), "nativePlan": deepcopy(latest),
            "operatingPlan": deepcopy(context["plan"]),
        },
        "nativeSaveRequired": changed, "amendmentRequired": original_amendment is not None,
        "selectedPlan": target, "comparison": plan_comparison(document, target),
        "amendment": compared,
        "cash": {"recordedReceipts": deepcopy(context["records"]["cash"]),
                 "calendarStart": context["program"].get("calendarStart")},
    }
    result["previewSha256"] = digest(result)
    return result


def binding_summary(row):
    value = row["edition"]
    return {"id": value["id"], "sourceId": row["source"]["id"], "sourceSha256": row["source"]["sha256"],
            "sha256": value["sha256"], "termsId": value["terms"]["id"], "termsRevision": value["terms"]["revision"],
            "caseVersion": value["caseVersion"], "planRevision": value["selectedPlan"]["revision"],
            "planContentSha256": value["selectedPlan"]["contentSha256"],
            "basis": value["preview"]["inputs"]["basis"], "savedAt": value["savedAt"],
            "amendment": value["amendment"]}


def read_binding(metadata, raw):
    if metadata.get("mediaType") != MEDIA or len(raw) != metadata.get("bytes") or hashlib.sha256(raw).hexdigest() != metadata.get("sha256"):
        fail("The complete planning commissioning source differs.", "AWARD_TERMS_SOURCE", 409)
    try:
        value = json.loads(raw)
        if (value.get("schema") != COMMISSION_SCHEMA
                or not re.fullmatch(r"terms-plan-[a-f0-9]{32}", value.get("id", ""))
                or digest({k: v for k, v in value.items() if k != "sha256"}) != value.get("sha256")
                or metadata.get(COMMISSION_MARKER) != {"schema": COMMISSION_SCHEMA, "id": value["id"], "sha256": value["sha256"]}):
            fail("Retain the complete original terms-to-plan commissioning.", "AWARD_TERMS_SOURCE", 409)
        preview_value = value["preview"]
        if digest({k: v for k, v in preview_value.items() if k != "previewSha256"}) != preview_value.get("previewSha256"):
            fail("The commissioning differs from its complete reviewed preview.")
        domain.integer(value["caseVersion"], "Commissioning case version", 2, 10000000)
        domain.timestamp(value["savedAt"], "Commissioning time")
        text(value["actor"], "Commissioning operator", 300, True)
        text(value["reviewStatement"], "Complete planning review", 12000, True)
        amendments.plan_core(value["selectedPlan"])
        return {"source": metadata, "edition": value}
    except (KeyError, TypeError, ValueError, UnicodeError) as exc:
        if isinstance(exc, Problem):
            raise
        raise Problem("The retained planning commissioning cannot be read.", 422, "AWARD_TERMS_SOURCE") from exc


def bindings(operations, program_id):
    values = []
    for metadata_raw, raw in operations.db.execute(
            "SELECT metadata_json,content FROM ops_sources WHERE program_id=? ORDER BY id", (program_id,)):
        metadata = json.loads(metadata_raw)
        if COMMISSION_MARKER in metadata:
            values.append(read_binding(metadata, bytes(raw)))
    return sorted(values, key=lambda row: row["edition"]["caseVersion"])


def bind(operations, context, data, actor, version, note):
    obj(data, ("preview", "selectedPlan", "amendment", "reviewStatement"), "original planning commissioning")
    candidate = data["preview"]
    selected = get(operations, context["program"]["id"], candidate["inputs"]["termsId"], candidate["inputs"]["termsRevision"])
    if (candidate["source"]["selectedTerms"] != selected
            or not amendments.same_plan(context["plan"], data["selectedPlan"])
            or data["selectedPlan"]["scenario"] != candidate["selectedPlan"]["scenario"]
            or data["selectedPlan"]["planning"] != candidate["selectedPlan"]["planning"]
            or data["selectedPlan"]["report"] != candidate["selectedPlan"]["report"]):
        fail("The saved native plan differs from the reviewed commissioning.", "AWARD_TERMS_PLAN_CONFLICT", 409)
    value = {
        "schema": COMMISSION_SCHEMA, "id": "terms-plan-" + uuid.uuid4().hex,
        "caseVersion": version, "savedAt": now(), "actor": actor, "note": note,
        "terms": {"id": selected["edition"]["id"], "revision": selected["edition"]["revision"],
                  "sourceId": selected["source"]["id"], "sourceSha256": selected["source"]["sha256"],
                  "sha256": selected["edition"]["sha256"]},
        "preview": deepcopy(candidate), "selectedPlan": deepcopy(context["plan"]),
        "amendment": deepcopy(data["amendment"]),
        "reviewStatement": text(data.get("reviewStatement"), "Complete planning review", 12000, True),
    }
    value["sha256"] = digest(value)
    raw = (canonical(value) + "\n").encode()
    metadata = operations._source_add(context["program"]["id"], {
        "filename": value["id"] + ".json", "mediaType": MEDIA, "kind": "grant",
        "observedAt": value["savedAt"], "contentBase64": base64.b64encode(raw).decode("ascii")})
    metadata[COMMISSION_MARKER] = {"schema": COMMISSION_SCHEMA, "id": value["id"], "sha256": value["sha256"]}
    operations.db.execute("UPDATE ops_sources SET metadata_json=? WHERE program_id=? AND id=?",
                          (canonical(metadata), context["program"]["id"], metadata["id"]))
    return {"before": None, "after": metadata, "kind": "source", "recordId": metadata["id"],
            "sourceChange": {"issuerTermsCommissioning": metadata},
            "commissioning": binding_summary({"source": metadata, "edition": value})}


def commission(operations, program_id, body):
    obj(body, ("requestId", "expectedVersion", "actor", "note", "inputs", "expectedPreviewSha256",
               "reviewStatement", "acknowledgeBaselineChange"), "planning commissioning")
    actor = text(body.get("actor"), "Recording operator", 300, True)
    note = text(body.get("note"), "Commissioning note", 12000, True)
    statement = text(body.get("reviewStatement"), "Complete planning review", 12000, True)
    if body.get("acknowledgeBaselineChange") is not True:
        fail("Select applying this reviewed plan to the existing case.")
    expected = domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000)
    payload = {"domain": COMMISSION_SCHEMA, "programId": program_id, "body": body}
    def action():
        context = operations._context(program_id)
        candidate = commission_preview(operations, context, {"expectedVersion": expected, "inputs": body.get("inputs")})
        if candidate["previewSha256"] != domain.sha(body.get("expectedPreviewSha256"), "Reviewed complete commissioning", False):
            fail("The case, original source or planning selections changed after review.", "AWARD_TERMS_PLAN_CONFLICT", 409)
        if not candidate["amendment"]["compatibility"]["compatible"]:
            fail("Resolve the retained-record conflicts in the complete plan comparison.", "AMENDMENT_INCOMPATIBLE", 409)
        inputs = candidate["inputs"]
        saved = operations.workspace.save(context["program"]["planId"], inputs["expectedPlanRevision"],
                    inputs["patch"], inputs["planning"], inputs["reason"], body["requestId"], _within_transaction=True)
        if (saved["scenario"] != candidate["selectedPlan"]["scenario"]
                or saved["planning"] != candidate["selectedPlan"]["planning"]
                or saved["report"] != candidate["selectedPlan"]["report"]
                or saved["contentSha256"] != candidate["selectedPlan"]["contentSha256"]):
            fail("The original native calculation differs from the complete reviewed plan.", "AWARD_TERMS_PLAN_CONFLICT", 409)
        current_version = expected
        source_id = candidate["source"]["selectedTerms"]["source"]["id"]
        receipts = []
        def original(command, data):
            nonlocal current_version
            child = {"requestId": "terms-plan-" + digest({"outer": body["requestId"], "action": command})[:64],
                     "expectedVersion": current_version, "actor": actor, "note": note,
                     "action": command, "data": data}
            receipt = operations.command(program_id, child, _within_transaction=True)
            current_version = receipt["version"]
            receipts.append(receipt)
            return receipt
        applied = None
        if not amendments.same_plan(context["plan"], saved):
            original_inputs = amendment_inputs(inputs, candidate["source"]["selectedTerms"], saved)
            reviewed = amendments.preview(operations, context, original_inputs)
            first = original("amendment.save", {"expectedRevision": 0, "inputs": original_inputs,
                                               "expectedPreviewSha256": reviewed["previewSha256"]})
            second = original("amendment.review", {"amendmentId": first["recordId"],
                "expectedRevision": first["amendmentRevision"], "expectedAmendmentSha256": first["amendmentSha256"],
                "expectedPreviewSha256": first["previewSha256"], "decision": "APPROVE",
                "statement": statement, "sourceIds": list(dict.fromkeys([source_id] + inputs_sources(candidate)))})
            third = original("amendment.apply", {"amendmentId": second["recordId"],
                "expectedRevision": second["amendmentRevision"], "expectedAmendmentSha256": second["amendmentSha256"],
                "acknowledgeBaselineChange": True})
            applied = {"id": third["recordId"], "revision": third["amendmentRevision"],
                       "sha256": third["amendmentSha256"], "caseVersion": third["version"]}
        final = original("award-terms.plan-bind", {"preview": candidate, "selectedPlan": saved,
                                                 "amendment": applied, "reviewStatement": statement})
        operations.export(program_id)
        return {"id": program_id, "version": current_version, "action": "award-terms.commission",
                "planId": saved["id"], "planRevision": saved["revision"], "planContentSha256": saved["contentSha256"],
                "commissioning": final["commissioning"], "commands": receipts}
    return operations.workspace._transaction(body.get("requestId"), payload, action)


def inputs_sources(candidate):
    return candidate["source"]["selectedTerms"]["edition"]["document"]["sourceIds"]


def validate_import(context, events, files, *, plan_for_version=None, saved_amendments=()):
    rows, commission_rows = [], []
    for metadata in context["sources"].values():
        if MARKER in metadata:
            rows.append(read_record(metadata, files["sources/" + metadata["id"]]))
        if COMMISSION_MARKER in metadata:
            commission_rows.append(read_binding(metadata, files["sources/" + metadata["id"]]))
    checked_chain(rows)
    selected_by_source = {row["source"]["id"]: row for row in rows}
    matched_sources = set()
    for row in rows:
        edition, metadata = row["edition"], row["source"]
        version = edition["caseVersion"]
        if version > len(events):
            fail("An issuer edition is missing its original case save.")
        event = events[version - 1]
        if (event.get("action") != "award-terms.save" or event.get("actor") != edition["actor"]
                or event.get("note", "") != edition["note"]
                or event.get("sourceChange", {}).get("issuerTermsSource") != metadata):
            fail("The issuer edition differs from its original native event.")
        captured = edition["source"]
        selected_plan = plan_for_version(version - 1) if plan_for_version is not None else context["plan"]
        if (captured["case"]["version"] != version - 1
                or captured["case"]["planRevision"] != selected_plan["revision"]
                or not amendments.same_plan(captured["plan"], selected_plan)
                or captured["sources"] != [context["sources"][key] for key in source_ids(edition["document"])]):
            fail("The issuer edition differs from its selected historical plan or original sources.")
        candidate = {"schema": SCHEMA + ".preview", "inputs": {"id": edition["id"],
                     "expectedRevision": edition["revision"] - 1, "document": edition["document"]},
                     "source": captured, "comparison": edition["comparison"]}
        if digest(candidate) != edition["previewSha256"]:
            fail("The original issuer comparison differs from its complete reviewed preview.")
        if edition["document"]["stage"] != "UNRECORDED":
            after = event.get("after") or {}
            document = edition["document"]
            if (event.get("kind") != "awards" or event.get("recordId") != edition.get("nativeAwardId")
                    or after.get("id") != edition.get("nativeAwardId")
                    or after.get("stage") != document["stage"]
                    or after.get("reference") != document["issuer"]["reference"]
                    or after.get("date") != document["issuer"]["issuedOn"]
                    or after.get("amountUsd") != (document["award"] or {}).get("amountUsd")
                    or after.get("sourceIds") != list(dict.fromkeys(document["sourceIds"] + [metadata["id"]]))):
                fail("The observed application stage differs from its original native issuer record.")
        elif (event.get("kind") != "source" or event.get("recordId") != metadata["id"] or event.get("after") != metadata):
            fail("The original terms draft differs from its retained source event.")
        matched_sources.add(metadata["id"])
    recorded_sources = {event.get("sourceChange", {}).get("issuerTermsSource", {}).get("id")
                        for event in events if event.get("action") == "award-terms.save"}
    if matched_sources != recorded_sources:
        fail("The complete case is missing an original issuer-terms edition.")
    applied = {(row["id"], row["revision"]): row for row in saved_amendments}
    matched_bindings = set()
    for row in commission_rows:
        value, metadata = row["edition"], row["source"]
        version = value["caseVersion"]
        if version > len(events):
            fail("A terms commissioning is missing its original case save.")
        event = events[version - 1]
        if (event.get("action") != "award-terms.plan-bind" or event.get("kind") != "source"
                or event.get("recordId") != metadata["id"] or event.get("after") != metadata
                or event.get("actor") != value["actor"] or event.get("note", "") != value["note"]
                or event.get("sourceChange", {}).get("issuerTermsCommissioning") != metadata):
            fail("The terms commissioning differs from its original native event.")
        selected = selected_by_source.get(value["terms"]["sourceId"])
        candidate = value["preview"]
        if (selected is None or candidate["source"]["selectedTerms"] != selected
                or value["terms"] != {"id": selected["edition"]["id"], "revision": selected["edition"]["revision"],
                    "sourceId": selected["source"]["id"], "sourceSha256": selected["source"]["sha256"],
                    "sha256": selected["edition"]["sha256"]}):
            fail("The commissioning lost its exact original issuer edition.")
        before_version = candidate["source"]["case"]["version"]
        if not 1 <= before_version < version:
            fail("The commissioning lacks its reviewed case revision.")
        prior_plan = plan_for_version(before_version) if plan_for_version is not None else context["plan"]
        final_plan = plan_for_version(version - 1) if plan_for_version is not None else context["plan"]
        if (not amendments.same_plan(candidate["source"]["operatingPlan"], prior_plan)
                or not amendments.same_plan(value["selectedPlan"], final_plan)
                or value["selectedPlan"]["scenario"] != candidate["selectedPlan"]["scenario"]
                or value["selectedPlan"]["planning"] != candidate["selectedPlan"]["planning"]
                or value["selectedPlan"]["report"] != candidate["selectedPlan"]["report"]
                or candidate["comparison"] != plan_comparison(selected["edition"]["document"], value["selectedPlan"])):
            fail("The retained native planning history differs from the reviewed terms commissioning.")
        reference = value["amendment"]
        if reference is not None:
            original = applied.get((reference["id"], reference["revision"]))
            if (not original or original["state"] != "APPLIED" or original["sha256"] != reference["sha256"]
                    or original["version"] != reference["caseVersion"]
                    or original["version"] != version - 1 or before_version != version - 4
                    or not amendments.same_plan(original["preview"]["selectedPlan"], value["selectedPlan"])):
                fail("The commissioning lost its original reviewed and applied native amendment.")
        elif before_version != version - 1 or not amendments.same_plan(prior_plan, final_plan):
            fail("The unchanged commissioning must retain the same selected original plan.")
        matched_bindings.add(metadata["id"])
    if matched_bindings != {e.get("recordId") for e in events if e.get("action") == "award-terms.plan-bind"}:
        fail("The complete case is missing an original terms-to-plan commissioning.")
    return {"editions": rows, "commissioning": commission_rows}


def html_report(row):
    edition, metadata = row["edition"], row["source"]
    document, comparison = edition["document"], edition["comparison"]
    esc = lambda value: html.escape(str(value if value is not None else "Unstated"), quote=True)
    def table(labels, records):
        return "<div class='table'><table><thead><tr>" + "".join("<th>" + esc(v) + "</th>" for v in labels) + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + esc(v) + "</td>" for v in record) + "</tr>" for record in records) + "</tbody></table></div>"
    content = "<h1>" + esc(document["title"]) + "</h1><p>" + esc(document["stage"].replace("_", " ").title()) + " · " + esc(comparison["selectedTrack"]) + " Track · edition " + str(edition["revision"]) + "</p>"
    content += "<h2>Original issuer observation</h2>" + table(["Field", "Retained value"], list(document["issuer"].items()))
    content += "<h2>Selected round</h2>" + table(["Field", "Retained value"], list(document["round"].items()))
    content += "<h2>Proposal and issued terms</h2>" + table(["Field", "Proposal", "Issued", "Comparison"],
        [(v["field"], v["proposed"], v["issued"], v["state"]) for v in comparison["differences"]])
    if document["award"]:
        content += "<h2>Complete award terms</h2><pre>" + esc(json.dumps(document["award"], ensure_ascii=False, indent=2)) + "</pre>"
    else:
        content += "<p>Award terms have not been recorded. Continue the selected proposal programme and retain the next issuer message in this workspace.</p>"
    content += "<h2>Source selections</h2>" + table(["Field", "Source references", "Passage", "Receiving interpretation"],
        [(v["field"], ", ".join(v["sourceIds"]), v["excerpt"], v["note"]) for v in document["fieldSources"]])
    content += "<h2>Original attachments</h2>" + table(["Filename", "Type", "Bytes", "Observed", "Source URL"],
        [(v["filename"], v["mediaType"], v["bytes"], v["observedAt"], v.get("sourceUrl", "")) for v in edition["source"]["sources"]])
    content += "<h2>Retained planning selection</h2><p>Revision " + str(edition["source"]["plan"]["revision"]) + " · USD " + esc(comparison["proposal"]["amountUsd"]) + " · " + str(comparison["proposal"]["durationDays"]) + " days.</p>"
    content += "<p>" + esc(document["note"]) + "</p><p>Saved " + esc(edition["savedAt"]) + " by " + esc(edition["actor"]) + ". " + esc(edition["note"]) + "</p>"
    content += "<details><summary>Original source identity</summary><pre>" + esc(json.dumps({"source": metadata, "sha256": edition["sha256"]}, indent=2)) + "</pre></details>"
    return ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + esc(document["title"]) + "</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#191919;background:#fff;max-width:1100px;margin:24px auto;padding:0 20px}h1,h2{line-height:1.2}p,td,pre{white-space:pre-wrap;overflow-wrap:anywhere}.table{overflow-x:auto}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #aaa;padding:8px;text-align:left;vertical-align:top}th{background:#eee}pre{font:12px/1.4 monospace;border:1px solid #aaa;padding:12px}@media print{body{max-width:none;margin:0}h2{break-after:avoid}tr{break-inside:avoid}.table{overflow:visible}}</style><body>" + content + "</body></html>\n").encode()


def selection_values(row):
    edition, metadata = row["edition"], row["source"]
    return {"schema": SCHEMA + ".selection", "id": edition["id"], "revision": edition["revision"],
            "sourceId": metadata["id"], "sourceSha256": metadata["sha256"], "editionSha256": edition["sha256"]}


def files_for(row):
    return {"award-terms-selection.json": (canonical(selection_values(row)) + "\n").encode(),
            "award-terms.html": html_report(row),
            "award-terms.csv": csv_bytes(["field", "proposed", "issued", "state"], row["edition"]["comparison"]["differences"])}


def selected_files(operations, program_id, terms_id, revision):
    if revision is None:
        fail("Select the saved issuer-terms edition for complete receiving.")
    return files_for(get(operations, program_id, terms_id, revision))


def selection_from_files(document, files):
    present = SELECTION_FILES.intersection(files)
    if not present:
        return None
    if present != SELECTION_FILES:
        fail("The complete issuer-terms handover selection is required.")
    try:
        selection = json.loads(files["award-terms-selection.json"])
        metadata = next(row for row in document["sources"] if row["id"] == selection["sourceId"])
        row = read_record(metadata, files["sources/" + metadata["id"]])
        if any(files[name] != raw for name, raw in files_for(row).items()):
            fail("The complete issuer handover differs from its original saved edition.")
        return selection_values(row)
    except (KeyError, TypeError, ValueError, StopIteration, UnicodeError) as exc:
        if isinstance(exc, Problem):
            raise
        raise Problem("The complete issuer-terms handover cannot be received.", 422, "AWARD_TERMS_SOURCE") from exc

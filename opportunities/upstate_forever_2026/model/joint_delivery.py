"""Joint delivery allocation on the original immutable Customer reviews authority.

Copyright 2026 TokenJunkieLabs. Proposed scope stays proposed; scientific
decisions and actual returned review remain with their existing owners.
"""
from __future__ import annotations
import copy
import csv
from datetime import date
import html
import io
import json
import math
from pathlib import Path
from . import reviews, review_handback
from .common import digest, held, identifier, read_json

DEFINITION_SCHEMA = "upstate.joint-delivery-definition/v1"
PROFILE_SCHEMA = "upstate.joint-delivery-profile/v1"
BINDING_SCHEMA = "upstate.joint-delivery-binding/v1"
SNAPSHOT_SCHEMA = "upstate.joint-delivery-snapshot/v1"
PROFILE_PATH = Path(__file__).resolve().parents[1] / "source/joint-delivery/20261013/profile.json"
FIELDS = ("source_collection_ids", "run_ids", "delivery_ids", "spatial_export_ids")
PHASES = ("proposal", "source-method", "modeled-review", "correction-receiving")
UNSPECIFIED = object()


def _object(value, fields, label):
    if not isinstance(value, dict) or set(value) - set(fields):
        raise ValueError(label + " has unsupported fields")
    return value


def _text(value, label, required=False, maximum=20000):
    return reviews._text(value, label, required=required, maximum=maximum)


def _keys(value, label):
    return reviews._unique([reviews._key(item, label) for item in reviews._list(value, label)], label)


def _ids(value, label):
    return reviews._unique([identifier(item) for item in reviews._list(value, label)], label)


def _number(value, label, integer=False):
    if value is None:
        return None
    try:
        finite = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise ValueError(label + " must be a finite number or left unfilled")
    if value < (1 if integer else 0) or (integer and int(value) != value):
        raise ValueError(label + " must be a positive whole active day" if integer else label + " cannot be negative")
    return int(value) if integer else value


def _hours(rows):
    try:
        total = math.fsum(row["effort_hours"] for row in rows if row["effort_hours"] is not None)
    except OverflowError as error:
        raise ValueError("The entered hours exceed the supported numeric range") from error
    if not math.isfinite(total):
        raise ValueError("The entered hours exceed the supported numeric range")
    return total


def _day(value):
    value = _text(value, "Target date", maximum=10)
    if value and date.fromisoformat(value).isoformat() != value:
        raise ValueError("Use a complete YYYY-MM-DD target date")
    return value


def _profile(value):
    _object(value, ("schema", "id", "title", "sources", "scope_note", "terms", "requirements", "inputs"), "Joint delivery profile")
    if value.get("schema") != PROFILE_SCHEMA:
        raise ValueError("Open the complete original joint delivery profile")
    reviews._key(value.get("id"), "Profile ID")
    _text(value.get("title"), "Profile title", True, 500)
    _text(value.get("scope_note"), "Scope note", True)
    if not isinstance(value.get("sources"), dict) or not value["sources"]:
        raise ValueError("Retain the original issuer and workshare source identities")
    terms = value.get("terms")
    if not isinstance(terms, dict) or terms.get("status") != "proposed":
        raise ValueError("This planning profile keeps commercial terms proposed")
    if terms.get("currency") != "USD" or any(isinstance(terms.get(k), bool) or not isinstance(terms.get(k), int)
            or terms[k] <= 0 for k in ("fee_cents", "engineering_hours", "active_business_days", "issuer_ceiling_cents")):
        raise ValueError("Keep complete original proposed fee, currency and allowance values")
    if sum(m["fee_cents"] for m in terms["milestones"]) != terms["fee_cents"]:
        raise ValueError("Original proposed milestone fees differ from the total")
    if sum(m["hours"] for m in terms["effort_allowances"]) != terms["engineering_hours"]:
        raise ValueError("Original effort allowances differ from the total")
    rows = reviews._list(value.get("requirements"), "Original requirements")
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError("Each original requirement must be a complete record")
    ids = _keys([r.get("id") for r in rows], "Requirement IDs")
    if not ids:
        raise ValueError("Keep the original full requirement inventory")
    for row in rows:
        _object(row, ("id", "title", "detail", "allocation"), "Original requirement")
        _text(row.get("title"), "Original title", True, 500)
        _text(row.get("detail"), "Original detail", True)
        if not isinstance(row.get("allocation"), dict) or row["allocation"].get("id") != row["id"]:
            raise ValueError("Keep the original proposed allocation with its requirement")
    inputs = reviews._list(value.get("inputs"), "Original inputs")
    if any(not isinstance(row, dict) for row in inputs):
        raise ValueError("Each original prime input must be a complete record")
    _keys([r.get("id") for r in inputs], "Input IDs")
    for row in inputs:
        for key in ("title", "needed", "public_context", "owner"):
            _text(row.get(key), "Original input " + key, True)
    return copy.deepcopy(value)


def profile():
    return _profile(read_json(PROFILE_PATH))


def draft(selected_profile=None):
    p = profile() if selected_profile is None else _profile(selected_profile)
    return {"schema": DEFINITION_SCHEMA, "title": p["title"], "notes": "",
            "selection": {name: [] for name in FIELDS},
            "allocations": [copy.deepcopy(row["allocation"]) for row in p["requirements"]],
            "inputs": [{key: copy.deepcopy(value) for key, value in row.items() if key != "requirement_ids"}
                       for row in p["inputs"]]}


def selection(value):
    _object(value, FIELDS, "Original source selection")
    result = {key: _ids(value.get(key, []), key) for key in FIELDS}
    if not any(result.values()):
        raise ValueError("Choose an actual retained source, completed run, delivery or map export before saving this review")
    return result


def definition(value, selected_profile=None):
    p = profile() if selected_profile is None else _profile(selected_profile)
    _object(value, ("schema", "title", "notes", "selection", "allocations", "inputs"), "Joint delivery definition")
    if value.get("schema") != DEFINITION_SCHEMA:
        raise ValueError("Open the whole joint delivery definition")
    allowed_inputs = {row["id"] for row in p["inputs"]}
    input_rows = {}
    for row in reviews._list(value.get("inputs"), "Prime-only inputs"):
        _object(row, ("id", "title", "needed", "public_context", "owner", "status", "decision", "evidence_ids"), "Prime-only input")
        key = reviews._key(row.get("id"), "Input ID")
        if key in input_rows or key not in allowed_inputs:
            raise ValueError("Keep each original prime input once")
        status = row.get("status")
        if status not in ("needed", "supplied", "not-applicable"):
            raise ValueError("Choose needed, supplied or not-applicable for the input")
        item = {"id": key, **{k: _text(row.get(k, ""), "Input " + k, k != "decision")
                for k in ("title", "needed", "public_context", "owner", "decision")},
                "status": status, "evidence_ids": _ids(row.get("evidence_ids", []), "Input evidence")}
        if status == "supplied" and not (item["evidence_ids"] or item["decision"]):
            raise ValueError("A supplied input needs its exact original evidence or an attributed authored decision")
        if status == "not-applicable" and not item["decision"]:
            raise ValueError("Record the reason an input does not apply to this selected delivery")
        input_rows[key] = item
    if set(input_rows) != allowed_inputs:
        raise ValueError("Keep the whole original prime-only input register")
    rows = {}
    for row in reviews._list(value.get("allocations"), "Requirement allocations"):
        _object(row, ("id", "prime", "engineering", "receiving", "milestone_id", "target_date",
                      "active_start_day", "active_end_day", "effort_hours", "input_ids", "evidence_ids", "note"), "Allocation")
        key = reviews._key(row.get("id"), "Requirement ID")
        if key in rows:
            raise ValueError("Keep each original requirement once")
        phase = row.get("milestone_id")
        if phase not in PHASES:
            raise ValueError("Choose an original proposal or engineering milestone")
        start = _number(row.get("active_start_day"), "Active start day", True)
        end = _number(row.get("active_end_day"), "Active end day", True)
        if (start is None) != (end is None) or (start is not None and end < start):
            raise ValueError("Enter both active-day endpoints in order, or leave both unfilled")
        inputs = _keys(row.get("input_ids", []), "Required input IDs")
        if set(inputs) - allowed_inputs:
            raise ValueError("An allocation names an input outside the complete register")
        rows[key] = {"id": key, **{k: _text(row.get(k, ""), "Allocation " + k, False)
                    for k in ("prime", "engineering", "receiving", "note")},
                    "milestone_id": phase, "target_date": _day(row.get("target_date", "")),
                    "active_start_day": start, "active_end_day": end,
                    "effort_hours": _number(row.get("effort_hours"), "Entered engineering hours"),
                    "input_ids": inputs, "evidence_ids": _ids(row.get("evidence_ids", []), "Requirement evidence")}
    if set(rows) != {row["id"] for row in p["requirements"]}:
        raise ValueError("Retain every original requirement, including unfinished allocations")
    result = {"schema": DEFINITION_SCHEMA, "title": _text(value.get("title"), "Delivery title", True, 300),
              "notes": _text(value.get("notes", ""), "Delivery notes"),
              "selection": selection(value.get("selection")),
              "allocations": [rows[row["id"]] for row in p["requirements"]],
              "inputs": [input_rows[row["id"]] for row in p["inputs"]]}
    entered = _hours(result["allocations"])
    if not math.isfinite(entered):
        raise ValueError("The entered engineering hours exceed the supported numeric range")
    return result, p


def _selection(selected, title="Selected joint delivery", purpose="Joint delivery allocation and prime-input review"):
    return reviews._selection({"schema": reviews.SELECTION_SCHEMA, "title": title, "purpose": purpose,
                               **selected, "requirements": [], "notes": []})


def evidence(workspace, supplied):
    chosen = selection(supplied)
    with held(workspace.root / ".workspace.lock", blocking=False):
        pins, artifacts = reviews._gather(workspace, _selection(chosen))
        return {"project": copy.deepcopy(workspace.project), "selection": chosen, "selections": pins,
                "artifacts": artifacts, "source_fingerprint": digest({"selections": pins, "artifacts": artifacts})}


def _assembled(workspace, value, p, pins, artifacts):
    d, p = definition(value, p)
    indexed = {row["id"]: row for row in artifacts}
    def files(ids):
        if set(ids) - set(indexed):
            raise ValueError("The authored evidence must come from the exact selected original files")
        return [copy.deepcopy(indexed[key]) for key in ids]
    inputs = [{**copy.deepcopy(row), "evidence": files(row["evidence_ids"]),
               "requirement_ids": [a["id"] for a in d["allocations"] if row["id"] in a["input_ids"]]}
              for row in d["inputs"]]
    by_input = {row["id"]: row for row in inputs}
    allocations, requirements = [], []
    for original, authored in zip(p["requirements"], d["allocations"]):
        item = {**copy.deepcopy(authored), "title": original["title"], "detail": original["detail"],
                "evidence": files(authored["evidence_ids"]),
                "inputs": [copy.deepcopy(by_input[key]) for key in authored["input_ids"]]}
        allocations.append(item)
        lines = [original["detail"], "Prime scientific / client responsibility: " + (item["prime"] or "Unassigned"),
                 "TJLabs engineering output: " + (item["engineering"] or "Unassigned"),
                 "Receiving responsibility: " + (item["receiving"] or "Unassigned"),
                 "Proposed phase: " + item["milestone_id"] + "; target date: " + (item["target_date"] or "Unscheduled"),
                 "Entered active days: " + str(item["active_start_day"]) + " through " + str(item["active_end_day"]),
                 "Entered engineering hours: " + str(item["effort_hours"])]
        lines += ["Prime input " + r["title"] + " — " + r["status"] + " — owner: " + r["owner"]
                  + "\nNeeded: " + r["needed"] + "\nAvailable public context: " + r["public_context"]
                  + "\nAuthored decision: " + r["decision"] for r in item["inputs"]]
        lines += ["Exact selected evidence:\n" + ("\n".join(a["label"] + " — " + a["original_path"] +
                  " — SHA256 " + a["sha256"] for a in item["evidence"]) or "No evidence assigned")]
        if item["note"]:
            lines.append(item["note"])
        detail = "\n\n".join(lines)
        _text(detail, "Complete allocation review requirement")
        requirements.append({"id": item["id"], "title": item["title"], "detail": detail})
    selected = _selection(d["selection"], d["title"])
    selected["requirements"] = requirements
    selected["notes"] = [p["scope_note"], "The complete original profile, allocation and prime-only inputs travel with this review.",
                         d["notes"]]
    fingerprint = digest({"selections": pins, "artifacts": artifacts})
    preview_id = digest({"schema": BINDING_SCHEMA, "project": workspace.project, "definition": d,
                         "profile": p, "source_fingerprint": fingerprint})
    entered = _hours(allocations)
    return {"project": copy.deepcopy(workspace.project), "definition": d, "profile": p,
            "preview_sha256": preview_id, "source_fingerprint": fingerprint, "selection": selected,
            "artifacts": copy.deepcopy(artifacts), "allocations": allocations, "inputs": inputs,
            "summary": {"requirements": len(allocations), "without_evidence": sum(not r["evidence"] for r in allocations),
                "unassigned_responsibilities": sum(not r[k] for r in allocations for k in ("prime", "engineering", "receiving")),
                "needed_inputs": sum(r["status"] == "needed" and bool(r["requirement_ids"]) for r in inputs),
                "selected_files": len(artifacts), "entered_effort_hours": entered,
                "unfilled_effort_rows": sum(r["effort_hours"] is None for r in allocations),
                "proposed_allowance_hours": p["terms"]["engineering_hours"],
                "entered_effort_exceeds_allowance": entered > p["terms"]["engineering_hours"],
                "active_day_end": max((r["active_end_day"] for r in allocations if r["active_end_day"] is not None), default=None),
                "commercial_status": "proposed"}}


def preview(workspace, value):
    d, p = definition(value)
    with held(workspace.root / ".workspace.lock", blocking=False):
        pins, artifacts = reviews._gather(workspace, _selection(d["selection"]))
        return _assembled(workspace, d, p, pins, artifacts)


def create(workspace, value, expected_preview_sha256, *, created_at):
    expected_preview_sha256 = identifier(expected_preview_sha256)
    selected_time = reviews._date(created_at, "Original operation creation time")
    d, p = definition(value)
    with held(workspace.root / ".workspace.lock", blocking=False):
        pins, artifacts = reviews._gather(workspace, _selection(d["selection"]))
        result = _assembled(workspace, d, p, pins, artifacts)
        if result["preview_sha256"] != expected_preview_sha256:
            raise ValueError("Original files or allocation changed. Open their current preview before saving.")
        record = {"project": copy.deepcopy(workspace.project), "created_at": selected_time,
                  **{key: result["selection"][key] for key in ("title", "purpose", "notes", "requirements")},
                  "selection": result["selection"], "selections": pins, "artifacts": artifacts,
                  "joint_delivery": {"schema": BINDING_SCHEMA, "definition": d, "profile": p,
                      "profile_sha256": digest(p), "preview_sha256": expected_preview_sha256,
                      "source_fingerprint": result["source_fingerprint"]}}
        reviews._validate_bindings(workspace, {**record, "schema": "upstate.reviews/v1"})
        return workspace._save("reviews", record)


def _checked(workspace, review):
    reviews._validate_bindings(workspace, review)
    binding = _object(review.get("joint_delivery"),
        ("schema", "definition", "profile", "profile_sha256", "preview_sha256", "source_fingerprint"), "Original joint delivery binding")
    if binding.get("schema") != BINDING_SCHEMA or binding.get("profile_sha256") != digest(binding.get("profile")):
        raise ValueError("The original joint delivery profile identity changed")
    result = _assembled(workspace, binding["definition"], binding["profile"], review["selections"], review["artifacts"])
    if (result["selection"] != review["selection"] or result["preview_sha256"] != binding.get("preview_sha256")
            or result["source_fingerprint"] != binding.get("source_fingerprint")):
        raise ValueError("The complete joint allocation no longer matches its original review")
    return result


def catalogue(workspace):
    items, issues = [], []
    with held(workspace.root / ".workspace.lock", blocking=False):
        for record in workspace._list("reviews"):
            if "joint_delivery" not in record:
                continue
            try:
                result = _checked(workspace, record)
                history = reviews.history(workspace, record["id"])
                response = history[-1] if history else None
                items.append({"id": record["id"], "title": record["title"], "created_at": record["created_at"],
                    "latest_response_id": response["id"] if response else None,
                    "disposition": response["response"]["disposition"] if response else "not-returned",
                    "summary": result["summary"]})
            except (ValueError, OSError, KeyError, TypeError) as error:
                issues.append({"id": record["id"], "message": str(error)})
    return {"reviews": items, "issues": issues}


def snapshot(workspace, review_id, response_id=UNSPECIFIED):
    with held(workspace.root / ".workspace.lock", blocking=False):
        packet = reviews.show_review(workspace, identifier(review_id), previews=False)
        review = packet["review"]
        result = _checked(workspace, review)
        selected = reviews.response_prefix(packet["responses"]) if response_id is UNSPECIFIED else reviews.response_prefix(packet["responses"], response_id)
        response = selected[-1] if selected else None
        decisions = {r["requirement_id"]: r for r in response["response"]["requirement_decisions"]} if response else {}
        for row in result["allocations"]:
            row["decision"] = copy.deepcopy(decisions.get(row["id"]))
        handbacks = review_handback.history(workspace, review_id, response["id"]) if response else []
        return {"schema": SNAPSHOT_SCHEMA, **result, "review_id": review_id, "review": review,
                "response": response, "responses": selected, "latest_response_id": packet["latest_response_id"],
                "selected_response_id": response["id"] if response else None, "handbacks": handbacks,
                "summary": {**result["summary"], "reviewer_disposition": response["response"]["disposition"] if response else "not-returned",
                    "returned_corrections": len(response["response"]["corrections"]) if response else 0,
                    "engineering_editions": len(handbacks)}}


def _csv(headers, rows):
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(headers)
    def safe(value):
        value = "" if value is None else str(value)
        return "'" + value if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else value
    for row in rows:
        writer.writerow([safe(value) for value in row])
    return out.getvalue()


def csv_document(result):
    rows = []
    for row in result["allocations"]:
        decision = row.get("decision") or {}
        rows.append([result.get("review_id", ""), result.get("selected_response_id", ""), row["id"], row["title"],
            row["detail"], row["prime"], row["engineering"], row["receiving"], row["milestone_id"], row["target_date"],
            row["active_start_day"], row["active_end_day"], row["effort_hours"], "\n".join(row["input_ids"]),
            "\n".join(a["label"] + " | " + a["original_path"] + " | " + a["sha256"] for a in row["evidence"]),
            row["note"], decision.get("decision", "not-returned"), decision.get("comment", ""), decision.get("requested_change", "")])
    return _csv(("review_id", "response_id", "requirement_id", "requirement", "source_detail", "prime", "engineering", "receiving",
                 "proposed_milestone", "target_date", "active_start_day", "active_end_day", "entered_hours", "input_ids",
                 "exact_evidence", "authored_note", "returned_decision", "returned_comment", "returned_requested_change"), rows)


def inputs_csv(result):
    return _csv(("input_id", "title", "needed", "available_public_context", "owner", "authored_status", "authored_decision",
                 "unlocked_requirements", "exact_evidence"), [
        [r["id"], r["title"], r["needed"], r["public_context"], r["owner"], r["status"], r["decision"],
         "\n".join(r["requirement_ids"]),
         "\n".join(a["label"] + " | " + a["original_path"] + " | " + a["sha256"] for a in r["evidence"])]
        for r in result["inputs"]])


def html_document(result):
    e = lambda value: html.escape(str(value if value is not None else ""))
    para = lambda value: "<p>" + e(value).replace("\n", "<br>") + "</p>"
    def table(headers, rows):
        return '<div class="scroll" tabindex="0"><table><thead><tr>' + ''.join('<th scope="col">'+e(x)+'</th>' for x in headers) + '</tr></thead><tbody>' + ''.join('<tr>'+''.join('<td>'+e(x)+'</td>' for x in row)+'</tr>' for row in rows) + '</tbody></table></div>'
    terms = result["profile"]["terms"]
    body = ["<h1>"+e(result["definition"]["title"])+"</h1>", para(result["profile"]["scope_note"]),
            "<h2>Proposed workshare</h2>", para("USD "+format(terms["fee_cents"]/100, ",.2f")+"; "+
            str(terms["engineering_hours"])+" engineering hours; "+str(terms["active_business_days"])+" active business days."),
            para(terms["included"]), para("Issuer final delivery: "+terms["delivery_date"]+"; proposal deadline: "+terms["proposal_deadline"]),
            table(("Milestone", "Proposed fee, USD", "Active days"), [
                (m["title"], format(m["fee_cents"]/100, ",.2f"), str(m["active_start_day"])+"–"+str(m["active_end_day"]))
                for m in terms["milestones"]]),
            para("Entered row hours: "+str(result["summary"]["entered_effort_hours"])+"; unfilled effort rows: "+
                 str(result["summary"]["unfilled_effort_rows"])+". Entered values are not a complete estimate while rows are unfilled."),
            "<h2>Prime-only inputs and scientific decisions</h2>"]
    for r in result["inputs"]:
        body += ['<section id="input-'+e(r["id"])+'"><h3>'+e(r["title"])+'</h3>',
            para("Owner: "+r["owner"]+" · Authored status: "+r["status"]), para(r["needed"]),
            para("Available public context: "+r["public_context"]), para("Authored decision: "+r["decision"]),
            para("Unlocks: "+", ".join(r["requirement_ids"])),
            table(("Original evidence", "Path", "Bytes", "SHA256"), [
                (a["label"], a["original_path"], a["bytes"], a["sha256"]) for a in r["evidence"]]), "</section>"]
    body.append("<h2>Complete requirement allocation</h2>")
    for r in result["allocations"]:
        decision = r.get("decision") or {}
        body += ['<section id="requirement-'+e(r["id"])+'"><h3>'+e(r["id"]+" · "+r["title"])+'</h3>',
            para(r["detail"]), table(("Responsibility", "Selected allocation"), [
                ("Prime / scientific", r["prime"] or "Unassigned"), ("TJLabs engineering", r["engineering"] or "Unassigned"),
                ("Receiving", r["receiving"] or "Unassigned"), ("Proposed phase", r["milestone_id"]),
                ("Target date", r["target_date"] or "Unscheduled"),
                ("Entered active days", "Unfilled" if r["active_start_day"] is None else str(r["active_start_day"])+"–"+str(r["active_end_day"])),
                ("Entered engineering hours", "Unfilled" if r["effort_hours"] is None else r["effort_hours"])]),
            para("Dependent inputs: "+", ".join(r["input_ids"])), para(r["note"]),
            table(("Exact evidence", "Original path", "Bytes", "SHA256"), [
                (a["label"],a["original_path"],a["bytes"],a["sha256"]) for a in r["evidence"]]),
            para("Returned requirement decision: "+decision.get("decision","not-returned")),
            para(decision.get("comment","")), para(decision.get("requested_change","")), "</section>"]
    body += ["<h2>Original review and receiving</h2>", para("Project: "+str(result["project"].get("id"))),
             para("Review: "+str(result.get("review_id","Preview"))+"; selected response: "+str(result.get("selected_response_id") or "not-returned")),
             para("Reviewer disposition: "+result["summary"].get("reviewer_disposition","not-returned")),
             para("The complete companion JSON preserves the original review, exact source/file identities, selected response and engineering handback history. Use Customer reviews for the original evidence package and real returned decisions.")]
    if result.get("response"):
        response = result["response"]["response"]
        who = response["reviewer"]
        body += [para("Returned by "+who["name"]+" — "+who["role"]+" — "+who["organization"]), para(response["summary"])]
        for row in response["corrections"]:
            body += ["<h3>"+e(row["title"])+"</h3>", para(row["description"]),
                     para("State: "+row["state"]+" · Assignee: "+row["assignee"]), para(row["resolution"])]
    for record in result.get("handbacks",[]):
        body += ["<h3>Engineering edition "+e(record["id"])+"</h3>", para(record["state"]),
            table(("Request", "Disposition", "Owner", "Note"), [
                [r.get(k,"") for k in ("request_id","disposition","owner","note")] for r in record["items"]])]
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+e(result["definition"]["title"])+'</title><style>html{color:#20252b;background:#f4f5f6;font:16px/1.55 system-ui,sans-serif}body{max-width:1120px;margin:auto;padding:24px}h1{font-size:1.8rem}h2{font-size:1.4rem}h3{font-size:1.1rem}section{background:white;border:1px solid #bfc4ca;padding:18px;margin:18px 0}p,td,th{overflow-wrap:anywhere}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.9rem}td,th{border:1px solid #c5c9ce;text-align:left;vertical-align:top;padding:9px}th{background:#e9ebed}a{color:#243f57}@media(max-width:600px){body{padding:12px}section{padding:10px}}@media print{html{background:white}body{padding:0}.scroll{overflow:visible}table{font-size:8pt}h2,h3{break-after:avoid}}</style><main>'+''.join(body)+'</main></html>'

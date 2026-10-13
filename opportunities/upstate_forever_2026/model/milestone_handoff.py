"""Milestone evidence on the original customer-review authority.

No commercial agreement, invoice, payment or acceptance state is written here.
The whole binding is an additive member of the original immutable review and
travels through its existing packet, response, handback and Project protocols.
"""
from __future__ import annotations

import copy
import csv
import html
import io
import json
from pathlib import Path
from urllib.parse import urlsplit

from . import reviews, review_handback
from .common import canonical, digest, held, identifier, read_json

DEFINITION_SCHEMA = "upstate.milestone-handoff-definition/v1"
BINDING_SCHEMA = "upstate.milestone-handoff-binding/v1"
SNAPSHOT_SCHEMA = "upstate.milestone-handoff-snapshot/v1"
PROFILE_PATH = Path(__file__).resolve().parents[1] / "source/milestones/20261013/milestone-profile.json"
FIELDS = ("source_collection_ids", "run_ids", "delivery_ids", "spatial_export_ids")
_UNSPECIFIED = object()


def _object(value, fields, label):
    if not isinstance(value, dict) or set(value) - set(fields):
        raise ValueError(label + " has unsupported fields")
    return value


def _text(value, label, required=False, maximum=20000):
    return reviews._text(value, label, required=required, maximum=maximum)


def profile():
    return _profile(read_json(PROFILE_PATH))


def _profile(value):
    _object(value, ("schema", "id", "title", "source", "scope_note", "milestones"), "Milestone profile")
    if value.get("schema") != "upstate.milestone-handoff-profile/v1":
        raise ValueError("Choose the original milestone criteria profile")
    reviews._key(value.get("id"), "Profile ID")
    _text(value.get("title"), "Profile title", True, 500)
    _text(value.get("scope_note"), "Commercial scope note", True)
    source = _object(value.get("source"), ("title", "url", "section", "observed_at", "workshare"), "Profile source")
    for key in source:
        _text(source[key], "Profile source " + key, True)
    for key in ("url", "workshare"):
        address = urlsplit(source.get(key, ""))
        if address.scheme not in ("https", "http") or not address.netloc:
            raise ValueError("Milestone source links must identify their original public or workspace page")
    seen = set()
    for milestone in reviews._list(value.get("milestones"), "Milestones"):
        _object(milestone, ("id", "title", "criteria"), "Milestone")
        key = reviews._key(milestone.get("id"), "Milestone ID")
        if key in seen:
            raise ValueError("Milestone IDs must be unique")
        seen.add(key)
        _text(milestone.get("title"), "Milestone title", True, 500)
        ids = []
        for row in reviews._list(milestone.get("criteria"), "Milestone criteria"):
            _object(row, ("id", "title", "detail"), "Criterion")
            ids.append(reviews._key(row.get("id"), "Criterion ID"))
            _text(row.get("title"), "Criterion title", True, 500)
            _text(row.get("detail"), "Criterion detail", True)
        reviews._unique(ids, "Milestone criteria")
        if not ids:
            raise ValueError("A milestone needs its original criteria")
    if not seen:
        raise ValueError("A profile needs milestones")
    return copy.deepcopy(value)


def selection(value):
    _object(value, FIELDS, "Original source selection")
    result = {}
    for field in FIELDS:
        result[field] = reviews._unique(
            [identifier(key) for key in reviews._list(value.get(field, []), field)], field)
    if not any(result.values()):
        raise ValueError("Choose an actual retained source, completed run, delivery or map export")
    return result


def definition(value, selected_profile=None):
    p = profile() if selected_profile is None else _profile(selected_profile)
    _object(value, ("schema", "title", "milestone_id", "notes", "selection", "criteria"), "Milestone definition")
    if value.get("schema") != DEFINITION_SCHEMA:
        raise ValueError("Open the complete milestone handoff definition")
    milestone = next((row for row in p["milestones"] if row["id"] == value.get("milestone_id")), None)
    if milestone is None:
        raise ValueError("Choose a milestone from this retained profile")
    result = {"schema": DEFINITION_SCHEMA,
              "title": _text(value.get("title"), "Handoff title", True, 300),
              "milestone_id": milestone["id"],
              "notes": _text(value.get("notes", ""), "Handoff note"),
              "selection": selection(value.get("selection")), "criteria": []}
    supplied = {}
    for row in reviews._list(value.get("criteria"), "Criterion evidence"):
        _object(row, ("id", "evidence_ids", "note", "exceptions"), "Criterion evidence")
        key = reviews._key(row.get("id"), "Criterion ID")
        if key in supplied:
            raise ValueError("Retain each criterion exactly once")
        exceptions = []
        for item in reviews._list(row.get("exceptions", []), "Source exceptions"):
            _object(item, ("title", "detail", "owner"), "Source exception")
            exceptions.append({"title": _text(item.get("title"), "Exception title", True, 500),
                               "detail": _text(item.get("detail", ""), "Exception detail"),
                               "owner": _text(item.get("owner", ""), "Exception owner", maximum=500)})
        supplied[key] = {"id": key, "evidence_ids": reviews._unique(
            [identifier(k) for k in reviews._list(row.get("evidence_ids", []), "Evidence IDs")], "Evidence IDs"),
            "note": _text(row.get("note", ""), "Criterion note"), "exceptions": exceptions}
    if set(supplied) != {row["id"] for row in milestone["criteria"]}:
        raise ValueError("Keep all criteria from the selected milestone, including unfinished ones")
    result["criteria"] = [supplied[row["id"]] for row in milestone["criteria"]]
    return result, p, milestone


def _selection(selected, title="Selected milestone evidence", purpose="Prepare an original milestone review"):
    return reviews._selection({"schema": reviews.SELECTION_SCHEMA, "title": title, "purpose": purpose,
                              **selected, "requirements": [], "notes": []})


def evidence(workspace, supplied):
    chosen = selection(supplied)
    with held(workspace.root / ".workspace.lock", blocking=False):
        pins, artifacts = reviews._gather(workspace, _selection(chosen))
        return {"project": copy.deepcopy(workspace.project), "selection": chosen,
                "selections": pins, "artifacts": artifacts,
                "source_fingerprint": digest({"selections": pins, "artifacts": artifacts})}


def _assembled(workspace, value, p, pins, artifacts):
    d, p, milestone = definition(value, p)
    indexed = {row["id"]: row for row in artifacts}
    criteria, requirements = [], []
    for original, authored in zip(milestone["criteria"], d["criteria"]):
        if set(authored["evidence_ids"]) - set(indexed):
            raise ValueError("Criterion evidence is outside the exact selected original files")
        selected = [copy.deepcopy(indexed[key]) for key in authored["evidence_ids"]]
        criteria.append({**copy.deepcopy(original), "evidence": selected,
                         "note": authored["note"], "exceptions": copy.deepcopy(authored["exceptions"])})
        parts = [original["detail"]]
        if selected:
            parts.append("Selected original evidence:\n" + "\n".join(
                "- " + row["label"] + " — " + row["original_path"] + " — SHA256 " + row["sha256"]
                for row in selected))
        else:
            parts.append("No evidence is assigned to this criterion yet.")
        if authored["note"]:
            parts.append("Engineering note:\n" + authored["note"])
        if authored["exceptions"]:
            parts.append("Source / assumption exceptions:\n" + "\n".join(
                "- " + row["title"] + ": " + row["detail"] + " (owner: " + (row["owner"] or "unassigned") + ")"
                for row in authored["exceptions"]))
        detail = "\n\n".join(parts)
        _text(detail, "Original review requirement detail")
        requirements.append({"id": original["id"], "title": original["title"], "detail": detail})
    selected = _selection(d["selection"], d["title"],
        milestone["title"] + " — recipient scientific and engineering review")
    selected["requirements"] = requirements
    selected["notes"] = [p["scope_note"], "Criteria source: " + p["source"].get("url", ""),
                         "Exact selected files and complete milestone definition remain in this original review."]
    if d["notes"]:
        selected["notes"].append(d["notes"])
    fingerprint = digest({"selections": pins, "artifacts": artifacts})
    preview_id = digest({"schema": BINDING_SCHEMA, "project": workspace.project, "definition": d,
                         "profile": p, "source_fingerprint": fingerprint})
    return {"project": copy.deepcopy(workspace.project), "definition": d, "profile": p,
            "milestone": copy.deepcopy(milestone), "preview_sha256": preview_id,
            "source_fingerprint": fingerprint, "selection": selected,
            "artifacts": copy.deepcopy(artifacts), "criteria": criteria,
            "summary": {"criteria": len(criteria),
                        "criteria_without_evidence": sum(not row["evidence"] for row in criteria),
                        "authored_exceptions": sum(len(row["exceptions"]) for row in criteria),
                        "selected_files": len(artifacts)}}


def preview(workspace, value):
    d, p, _ = definition(value)
    with held(workspace.root / ".workspace.lock", blocking=False):
        pins, artifacts = reviews._gather(workspace, _selection(d["selection"]))
        return _assembled(workspace, d, p, pins, artifacts)


def create(workspace, value, expected_preview_sha256, *, created_at):
    expected_preview_sha256 = identifier(expected_preview_sha256)
    selected_time = reviews._date(created_at, "Original operation creation time")
    d, p, _ = definition(value)
    with held(workspace.root / ".workspace.lock", blocking=False):
        pins, artifacts = reviews._gather(workspace, _selection(d["selection"]))
        result = _assembled(workspace, d, p, pins, artifacts)
        if result["preview_sha256"] != expected_preview_sha256:
            raise ValueError("Original evidence or definition changed. Reopen the exact source preview before saving.")
        record = {"project": copy.deepcopy(workspace.project), "created_at": selected_time,
                  **{key: result["selection"][key] for key in ("title", "purpose", "notes", "requirements")},
                  "selection": result["selection"], "selections": pins, "artifacts": artifacts,
                  "milestone_handoff": {"schema": BINDING_SCHEMA, "definition": d, "profile": p,
                      "profile_sha256": digest(p), "preview_sha256": expected_preview_sha256,
                      "source_fingerprint": result["source_fingerprint"]}}
        # Same original review schema, same immutable Workspace identity; no parallel store.
        reviews._validate_bindings(workspace, {**record, "schema": "upstate.reviews/v1"})
        return workspace._save("reviews", record)


def _checked(workspace, review):
    reviews._validate_bindings(workspace, review)
    binding = _object(review.get("milestone_handoff"),
        ("schema", "definition", "profile", "profile_sha256", "preview_sha256", "source_fingerprint"),
        "Original milestone binding")
    if binding.get("schema") != BINDING_SCHEMA or binding.get("profile_sha256") != digest(binding.get("profile")):
        raise ValueError("The original milestone profile identity changed")
    result = _assembled(workspace, binding["definition"], binding["profile"],
                        review["selections"], review["artifacts"])
    if (result["selection"] != review["selection"]
            or result["preview_sha256"] != binding.get("preview_sha256")
            or result["source_fingerprint"] != binding.get("source_fingerprint")):
        raise ValueError("The milestone evidence no longer matches its original review")
    return result


def catalogue(workspace):
    items, issues = [], []
    with held(workspace.root / ".workspace.lock", blocking=False):
        for record in workspace._list("reviews"):
            if "milestone_handoff" not in record:
                continue
            try:
                result = _checked(workspace, record)
                history = reviews.history(workspace, record["id"])
                response = history[-1] if history else None
                items.append({"id": record["id"], "title": record["title"], "created_at": record["created_at"],
                    "milestone_id": result["milestone"]["id"], "latest_response_id": response["id"] if response else None,
                    "disposition": response["response"]["disposition"] if response else "not-returned"})
            except (ValueError, OSError, KeyError, TypeError) as error:
                issues.append({"id": record["id"], "message": str(error)})
    return {"reviews": items, "issues": issues}


def snapshot(workspace, review_id, response_id=_UNSPECIFIED):
    with held(workspace.root / ".workspace.lock", blocking=False):
        packet = reviews.show_review(workspace, identifier(review_id), previews=False)
        review = packet["review"]
        result = _checked(workspace, review)
        selected = reviews.response_prefix(packet["responses"]) if response_id is _UNSPECIFIED else \
                   reviews.response_prefix(packet["responses"], response_id)
        response = selected[-1] if selected else None
        decisions = {row["requirement_id"]: row for row in response["response"]["requirement_decisions"]} if response else {}
        artifact_decisions = {row["artifact_id"]: row for row in response["response"]["artifact_decisions"]} if response else {}
        for criterion in result["criteria"]:
            criterion["decision"] = copy.deepcopy(decisions.get(criterion["id"]))
            criterion["evidence_decisions"] = [
                {"artifact_id": row["id"], "decision": copy.deepcopy(artifact_decisions.get(row["id"]))}
                for row in criterion["evidence"]]
        handbacks = review_handback.history(workspace, review_id, response["id"]) if response else []
        return {"schema": SNAPSHOT_SCHEMA, **result, "review_id": review_id, "review": review,
                "response": response, "responses": selected,
                "latest_response_id": packet["latest_response_id"],
                "selected_response_id": response["id"] if response else None,
                "handbacks": handbacks,
                "summary": {**result["summary"],
                    "reviewer_disposition": response["response"]["disposition"] if response else "not-returned",
                    "returned_corrections": len(response["response"]["corrections"]) if response else 0,
                    "open_returned_corrections": sum(row["state"] == "open" for row in response["response"]["corrections"]) if response else 0,
                    "engineering_editions": len(handbacks)},
                "commercial_status": "Not determined by this scientific and engineering review."}


def csv_document(result):
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(("review_id", "response_id", "milestone", "criterion_id", "criterion", "evidence",
                     "engineering_note", "source_exceptions", "reviewer_decision", "reviewer_comment",
                     "requested_change", "assignee"))
    def safe(value):
        value = "" if value is None else str(value)
        return "'" + value if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else value
    for row in result["criteria"]:
        decision = row["decision"] or {}
        evidence = "\n".join(item["label"] + " | " + item["original_path"] + " | SHA256 " + item["sha256"] for item in row["evidence"])
        exceptions = "\n".join(item["title"] + ": " + item["detail"] + " | owner: " + (item["owner"] or "unassigned") for item in row["exceptions"])
        writer.writerow([safe(value) for value in (
            result["review_id"], result["selected_response_id"], result["milestone"]["title"], row["id"], row["title"],
            evidence, row["note"], exceptions, decision.get("decision", "not-returned"),
            decision.get("comment", ""), decision.get("requested_change", ""), decision.get("assignee", ""))])
    return out.getvalue()


def html_document(result):
    e = lambda value: html.escape(str(value if value is not None else ""))
    paras = lambda value: "<p>" + e(value).replace("\n", "<br>") + "</p>"
    body = ['<h1>' + e(result["review"]["title"]) + '</h1>',
            paras(result["milestone"]["title"]), paras(result["profile"]["scope_note"]),
            '<dl><dt>Original review</dt><dd>' + e(result["review_id"]) + '</dd><dt>Selected response</dt><dd>' +
            e(result["selected_response_id"] or "No returned response selected") + '</dd><dt>Reviewer disposition</dt><dd>' +
            e(result["summary"]["reviewer_disposition"]) + '</dd></dl>']
    if result["response"]:
        who = result["response"]["response"]["reviewer"]
        body += [paras("Returned by " + who["name"] + " — " + who["role"] + " — " + who["organization"]),
                 paras(result["response"]["response"]["summary"])]
    for row in result["criteria"]:
        decision = row["decision"] or {}
        body += ['<section><h2>' + e(row["id"] + " · " + row["title"]) + '</h2>', paras(row["detail"]),
                 paras(row["note"]), '<h3>Exact original evidence</h3>']
        if row["evidence"]:
            body.append('<div class="scroll"><table><thead><tr><th>File / role</th><th>Original path</th><th>Bytes / SHA256</th></tr></thead><tbody>')
            for item in row["evidence"]:
                body.append('<tr><td>' + e(item["label"]) + '<br>' + e(item["role"]) + '</td><td>' + e(item["original_path"]) +
                            '</td><td>' + e(item["bytes"]) + '<br><code>' + e(item["sha256"]) + '</code></td></tr>')
            body.append('</tbody></table></div>')
        else:
            body.append('<p>No original evidence assigned to this criterion.</p>')
        for item in row["exceptions"]:
            body.append(paras("Exception — " + item["title"] + ": " + item["detail"] + " · Owner: " + (item["owner"] or "unassigned")))
        body += ['<h3>Returned criterion decision</h3>', paras(decision.get("decision", "not-returned")),
                 paras(decision.get("comment", "")), paras(decision.get("requested_change", "")),
                 paras("Requested assignee: " + decision.get("assignee", "")), '</section>']
    if result["response"]:
        body.append('<h2>Returned corrections</h2>')
        for row in result["response"]["response"]["corrections"]:
            body += ['<h3>' + e(row["title"]) + '</h3>', paras(row["description"]),
                     paras("State: " + row["state"] + " · Assignee: " + row["assignee"]),
                     paras("Resolution: " + row["resolution"])]
    body.append('<h2>Retained engineering editions</h2>')
    for record in result["handbacks"]:
        body += [paras("Edition " + record["id"] + " · " + record["state"] + " · " + record["created_at"]),
                 '<div class="scroll"><table><tr><th>Request</th><th>Disposition</th><th>Owner</th><th>Engineering note</th></tr>']
        for row in record["items"]:
            body.append('<tr>' + ''.join('<td>' + e(row.get(key, "")) + '</td>' for key in
                        ("request_id", "disposition", "owner", "note")) + '</tr>')
        body.append('</table></div>')
    source = result["profile"]["source"]
    body += ['<h2>Criteria source</h2>', paras(source["title"] + " — " + source["section"]),
             '<p><a href="' + e(source["url"]) + '">Original proposal and production package</a></p>',
             paras("The companion JSON retains the complete original review, selected response history, evidence bindings and engineering editions. Use the original review package to open the exact source files and return decisions.")]
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + e(result["review"]["title"]) + '</title><style>html{color:#20252b;background:#f3f4f5;font:16px/1.55 system-ui,sans-serif}body{max-width:1120px;margin:0 auto;padding:28px}h1{font-size:1.9rem}h2{font-size:1.35rem}h3{font-size:1.05rem}section{background:#fff;border:1px solid #bdc3c9;border-radius:4px;padding:20px;margin:24px 0}p,dd,td{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 20px}dd{margin:0}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{border:1px solid #c5c9cd;text-align:left;vertical-align:top;padding:10px}th{background:#e8ebee;color:#1c242b}.scroll{overflow:auto}code{word-break:break-all}a{color:#174a70}@media(max-width:600px){body{padding:14px}section{padding:12px}dl{display:block}dt{font-weight:700}dd{margin-bottom:10px}}@media print{html{background:white}body{padding:0}section{break-inside:auto}th{background:#eee}.scroll{overflow:visible}table{font-size:8pt}}</style><main>' + ''.join(body) + '</main></html>'

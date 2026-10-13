"""Engineering dispositions and complete handbacks of retained customer reviews.

Customer responses remain immutable customer-authored records.  Engineering
editions assign those actual requests, describe their treatment, and reference
actual selected replacement artifacts and requirements in a revised review.
"""
from __future__ import annotations

import copy
import csv
import hashlib
import html
import io
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import urllib.parse
import zipfile

from .common import atomic_json, digest, file_digest, held, identifier, now, read_json
from . import reviews

SCHEMA = "upstate.customer-review-handback/v1"
RECORD_SCHEMA = "upstate.review-handbacks/v1"
PACKAGE_SCHEMA = "upstate.customer-review-handback-package/v1"
KIND = "review-handbacks"
MANIFEST = "handback-manifest.json"
FIELDS = {"schema", "review_id", "response_id", "previous_handback_id",
          "revised_review_id", "prepared_by", "state", "summary", "items"}
DISPOSITIONS = ("planned", "addressed", "deferred")


def _text(value, label, **kwargs):
    return reviews._text(value, label, **kwargs)


def _source(workspace, review_id, response_id):
    review = workspace._get("reviews", identifier(review_id))
    chain = reviews.history(workspace, review_id)
    response_id = identifier(response_id)
    found = next((row for row in chain if row["id"] == response_id), None)
    if found is None:
        raise ValueError("Choose an actual retained response from this original review")
    return review, found, chain


def requests_for(review, response):
    """Extract complete original request identities without inventing decisions."""
    response_id = response["id"]
    value = response["response"]
    artifacts = {row["id"]: row for row in review["artifacts"]}
    requirements = {row["id"]: row for row in review["requirements"]}
    result = []

    def append(kind, key, title, description, artifact_ids, requirement_ids, priority, owner):
        result.append({
            "id": digest({"response_id": response_id, "kind": kind, "source_id": key}),
            "kind": kind, "source_id": key, "title": title,
            "description": description, "artifact_ids": artifact_ids,
            "requirement_ids": requirement_ids, "priority": priority, "owner": owner,
        })

    for row in value["corrections"]:
        if row["state"] == "open":
            append("correction", row["id"], row["title"], row["description"],
                   row["artifact_ids"], row["requirement_ids"], row["priority"], row["assignee"])
    for field, kind, key_field, originals in (
            ("artifact_decisions", "artifact", "artifact_id", artifacts),
            ("requirement_decisions", "requirement", "requirement_id", requirements)):
        for row in value[field]:
            if (row["decision"] in ("accepted", "not-applicable")
                    or (row["decision"] not in ("changes-requested", "question") and not row["requested_change"].strip())):
                continue
            key = row[key_field]
            source = originals[key]
            append(kind, key, source.get("label") or source.get("title") or key,
                   row["requested_change"] or row["comment"] or row["decision"],
                   [key] if kind == "artifact" else [],
                   [key] if kind == "requirement" else [], "normal", row["assignee"])
    return sorted(result, key=lambda row: (row["kind"], row["source_id"]))


def _check(value, review, response, revision):
    if not isinstance(value, dict) or value.get("schema") != SCHEMA or set(value) - FIELDS:
        raise ValueError("Use an original upstate.customer-review-handback/v1 draft")
    if value.get("review_id") != review["id"] or value.get("response_id") != response["id"]:
        raise ValueError("Engineering draft belongs to a different original review response")
    previous = value.get("previous_handback_id")
    if previous is not None:
        identifier(previous)
    revised_id = value.get("revised_review_id")
    if revised_id is not None:
        identifier(revised_id)
        if revision is None or revision["id"] != revised_id:
            raise ValueError("Choose the actual saved revised review")
        if revised_id == review["id"] or revision["project"]["id"] != review["project"]["id"]:
            raise ValueError("Choose a different revised review from this same scientific project")
    elif revision is not None:
        raise ValueError("Unexpected revised review")
    author = value.get("prepared_by")
    if not isinstance(author, dict) or set(author) - {"name", "role", "organization"}:
        raise ValueError("Engineering author needs name, role and organization")
    author = {"name": _text(author.get("name"), "Engineering author", required=True, maximum=300),
              "role": _text(author.get("role", ""), "Engineering role", maximum=300),
              "organization": _text(author.get("organization", ""), "Engineering organization", maximum=500)}
    state = value.get("state")
    if state not in ("planning", "ready"):
        raise ValueError("Choose planning or ready for the engineering handback")
    requests = requests_for(review, response)
    if not requests:
        raise ValueError("This response contains no open correction, question or requested change")
    allowed = {row["id"] for row in requests}
    artifact_ids = {row["id"] for row in revision["artifacts"]} if revision else set()
    requirement_ids = {row["id"] for row in revision["requirements"]} if revision else set()
    items = []
    for row in reviews._list(value.get("items"), "Engineering request items"):
        fields = {"request_id", "disposition", "owner", "note",
                  "replacement_artifact_ids", "replacement_requirement_ids"}
        if not isinstance(row, dict) or set(row) - fields or row.get("request_id") not in allowed:
            raise ValueError("Engineering item must identify an actual request in the selected response")
        disposition = row.get("disposition")
        if disposition not in DISPOSITIONS:
            raise ValueError("Choose planned, addressed or deferred for every request")
        artifacts = reviews._unique(reviews._list(row.get("replacement_artifact_ids", []),
                                                  "Replacement artifacts"), "Replacement artifacts")
        requirements = reviews._unique(reviews._list(row.get("replacement_requirement_ids", []),
                                                     "Replacement requirements"), "Replacement requirements")
        if any(not isinstance(key, str) for key in artifacts + requirements):
            raise ValueError("Replacement references must be original identifiers")
        if set(artifacts) - artifact_ids or set(requirements) - requirement_ids:
            raise ValueError("Replacement evidence must belong to the selected revised review")
        note = _text(row.get("note", ""), "Engineering resolution")
        owner = _text(row.get("owner", ""), "Assigned engineer", maximum=500)
        if disposition in ("addressed", "deferred") and not note.strip():
            raise ValueError("An addressed or deferred request needs its actual engineering explanation")
        if disposition == "addressed" and not (artifacts or requirements):
            raise ValueError("An addressed request needs a selected replacement artifact or requirement")
        if state == "ready" and (disposition == "planned" or not owner.strip()):
            raise ValueError("Assign every request and finish its engineering disposition before handback")
        items.append({"request_id": row["request_id"], "disposition": disposition,
                      "owner": owner, "note": note,
                      "replacement_artifact_ids": sorted(artifacts),
                      "replacement_requirement_ids": sorted(requirements)})
    if len(items) != len(allowed) or {row["request_id"] for row in items} != allowed:
        raise ValueError("Include every actual requested item exactly once")
    if state == "ready" and revision is None:
        raise ValueError("A ready engineering handback needs its actual saved revised review")
    return {"schema": SCHEMA, "review_id": review["id"], "response_id": response["id"],
            "previous_handback_id": previous, "revised_review_id": revised_id,
            "prepared_by": author, "state": state,
            "summary": _text(value.get("summary", ""), "Engineering summary"),
            "items": sorted(items, key=lambda row: row["request_id"])}


def _draft(record):
    return {**{key: copy.deepcopy(record[key]) for key in FIELDS if key != "schema"}, "schema": SCHEMA}


def _check_record(record, review, response, revision, project_id):
    if (record.get("schema") != RECORD_SCHEMA or record.get("project_id") != project_id
            or digest({key: value for key, value in record.items() if key != "id"}) != record.get("id")):
        raise ValueError("Retained engineering handback identity differs")
    checked = _check(_draft(record), review, response, revision)
    if _draft(record) != checked:
        raise ValueError("Retained engineering handback differs from its normalized input")
    reviews._date(record.get("created_at"))
    revised_response_id = record.get("revised_response_id")
    if revised_response_id is not None:
        identifier(revised_response_id)
    if revision is None and revised_response_id is not None:
        raise ValueError("Planning edition cannot refer to an absent revised response")
    return checked


def _chain(records):
    by_previous = {}
    for row in records:
        previous = row.get("previous_handback_id")
        if previous in by_previous:
            raise ValueError("Engineering history has concurrent branches; reopen the current edition")
        by_previous[previous] = row
    result, key, seen = [], None, set()
    while key in by_previous:
        row = by_previous[key]
        if row["id"] in seen:
            raise ValueError("Engineering history contains a cycle")
        seen.add(row["id"])
        result.append(row)
        key = row["id"]
    if len(result) != len(records):
        raise ValueError("Engineering history lacks its original predecessor")
    return result


def history(workspace, review_id, response_id):
    review, response, _ = _source(workspace, review_id, response_id)
    records = [row for row in workspace._list(KIND)
               if row.get("review_id") == review_id and row.get("response_id") == response_id]
    for row in records:
        revision = workspace._get("reviews", row["revised_review_id"]) if row.get("revised_review_id") else None
        _check_record(row, review, response, revision, workspace.project["id"])
        if revision is not None:
            reviews.response_prefix(reviews.history(workspace, revision["id"]), row["revised_response_id"])
    return _chain(records)


def summary(row):
    return {key: row[key] for key in ("id", "review_id", "response_id", "previous_handback_id",
                                      "revised_review_id", "revised_response_id", "state",
                                      "prepared_by", "summary", "created_at")}


def list_handbacks(workspace, review_id=None):
    if review_id is not None:
        workspace._get("reviews", identifier(review_id))
    groups = {(row["review_id"], row["response_id"]) for row in workspace._list(KIND)
              if review_id is None or row.get("review_id") == review_id}
    result = []
    for original, response in sorted(groups):
        result.extend(summary(row) for row in history(workspace, original, response))
    return sorted(result, key=lambda row: (row["created_at"], row["id"]), reverse=True)


def _revision(row):
    return {"review_id": row["id"], "id": row["id"], "title": row["title"], "purpose": row["purpose"],
            "artifacts": row["artifacts"], "requirements": row["requirements"]}


def template(workspace, review_id, *, response_id=None, handback_id=None,
             revised_review_id=reviews._UNSPECIFIED):
    if handback_id is not None:
        current = workspace._get(KIND, identifier(handback_id))
        if current["review_id"] != review_id or (response_id is not None and current["response_id"] != response_id):
            raise ValueError("Selected engineering edition belongs to another original response")
        response_id = current["response_id"]
    else:
        current = None
    if response_id is None:
        responses = reviews.history(workspace, review_id)
        if not responses:
            raise ValueError("Record the actual customer response before assigning engineering work")
        response_id = responses[-1]["id"]
    review, response, _ = _source(workspace, review_id, response_id)
    chain = history(workspace, review_id, response_id)
    if current is None and chain:
        current = chain[-1]
    if current is not None and chain[-1]["id"] != current["id"]:
        raise ValueError("Reopen the latest engineering edition before editing")
    requests = requests_for(review, response)
    if current is None:
        draft = {"schema": SCHEMA, "review_id": review_id, "response_id": response_id,
                 "previous_handback_id": None, "revised_review_id": None,
                 "prepared_by": {"name": "", "role": "", "organization": ""},
                 "state": "planning", "summary": "", "items": [
                     {"request_id": row["id"], "disposition": "planned", "owner": row["owner"], "note": "",
                      "replacement_artifact_ids": [], "replacement_requirement_ids": []} for row in requests]}
    else:
        draft = _draft(current)
        draft["previous_handback_id"] = current["id"]
        draft["state"] = "planning"
    if revised_review_id is not reviews._UNSPECIFIED:
        if revised_review_id != draft["revised_review_id"]:
            for row in draft["items"]:
                row["replacement_artifact_ids"], row["replacement_requirement_ids"] = [], []
                if row["disposition"] == "addressed":
                    row["disposition"] = "planned"
        draft["revised_review_id"] = revised_review_id
    revision = workspace._get("reviews", identifier(draft["revised_review_id"])) if draft["revised_review_id"] else None
    if revision and (revision["id"] == review_id or revision["project"]["id"] != workspace.project["id"]):
        raise ValueError("Choose a different revised review from this same project")
    return {"draft": draft, "requests": requests, "revision": _revision(revision) if revision else None,
            "revised_choices": [row for row in reviews.list_reviews(workspace) if row["id"] != review_id],
            "history": [summary(row) for row in chain]}


def save(workspace, value, *, created_at=None):
    if not isinstance(value, dict):
        raise ValueError("Provide the complete original engineering handback draft")
    with held(workspace.root / ".workspace.lock", blocking=False):
        review, response, responses = _source(workspace, value.get("review_id"), value.get("response_id"))
        revision = workspace._get("reviews", identifier(value["revised_review_id"])) if value.get("revised_review_id") else None
        checked = _check(value, review, response, revision)
        chain = history(workspace, review["id"], response["id"])
        # Identical retry remains the original edition, including its pinned
        # revised response.  A later customer reply does not invalidate retry.
        for row in chain:
            if _draft(row) == checked and (created_at is None or row["created_at"] == created_at):
                return row
        expected = chain[-1]["id"] if chain else None
        if checked["previous_handback_id"] != expected:
            raise ValueError("Another engineering edition was saved; reopen it before applying this work")
        revised_history = reviews.history(workspace, revision["id"]) if revision else []
        payload = {**checked, "project_id": workspace.project["id"],
                   "created_at": reviews._date(created_at or now()),
                   "revised_response_id": revised_history[-1]["id"] if revised_history else None}
        return workspace._save(KIND, payload)


def show(workspace, handback_id):
    row = workspace._get(KIND, identifier(handback_id))
    chain = history(workspace, row["review_id"], row["response_id"])
    if row["id"] not in {item["id"] for item in chain}:
        raise ValueError("Engineering edition is absent from its original history")
    original, response, _ = _source(workspace, row["review_id"], row["response_id"])
    revision = workspace._get("reviews", row["revised_review_id"]) if row["revised_review_id"] else None
    return {"handback": row, "requests": requests_for(original, response),
            "original": _revision(original), "revised": _revision(revision) if revision else None,
            "history": [summary(item) for item in chain]}


def validate_workspace(workspace):
    rows = list_handbacks(workspace)
    return {"engineering_handbacks": len(rows),
            "source_responses": len({(row["review_id"], row["response_id"]) for row in rows})}


def _tree(directory):
    directory = Path(directory)
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Open an ordinary engineering handback directory")
    result = {}

    def failed(error):
        raise ValueError("Cannot inventory the complete handback: " + str(error)) from error

    for root, folders, names in os.walk(directory, followlinks=False, onerror=failed):
        for name in folders:
            path = Path(root) / name
            if path.is_symlink():
                raise ValueError("Handback directory contains a symbolic link")
        for name in names:
            path = Path(root) / name
            relative = path.relative_to(directory).as_posix()
            reviews._regular(directory, relative)
            result[relative] = {"bytes": path.stat().st_size, "sha256": file_digest(path)}
    return result


def _manifest(value):
    if not isinstance(value, dict) or value.get("schema") != PACKAGE_SCHEMA:
        raise ValueError("Choose a complete customer review engineering handback")
    identifier(value.get("review_id"))
    identifier(value.get("handback_id"))
    if digest({key: item for key, item in value.items() if key != "package_sha256"}) != value.get("package_sha256"):
        raise ValueError("Engineering handback inventory identity differs")
    if not isinstance(value.get("members"), dict):
        raise ValueError("Engineering handback needs its complete member inventory")
    for name, row in value["members"].items():
        reviews._relative(name)
        if name == MANIFEST or not isinstance(row, dict) or set(row) != {"bytes", "sha256"}:
            raise ValueError("Invalid engineering handback member descriptor")
        if type(row["bytes"]) is not int or row["bytes"] < 0:
            raise ValueError("Handback member length must be a nonnegative integer")
        identifier(row["sha256"])
    if not {"index.html", "handback.json", "request-resolutions.csv"} <= set(value["members"]):
        raise ValueError("Engineering handback lacks its complete report or source document")
    return value


def _packet_response(packet):
    review = packet["review"]
    previous = None
    for row in packet["responses"]:
        if digest({key: value for key, value in row.items() if key != "id"}) != row.get("id"):
            raise ValueError("Packaged customer response identity differs")
        checked = reviews._checked_response(row["response"], review)
        if (checked != row["response"] or row.get("review_id") != review["id"]
                or row.get("project_id") != review["project"]["id"]
                or row.get("request_sha256") != digest(checked)
                or row.get("previous_response_id") != previous
                or checked["previous_response_id"] != previous):
            raise ValueError("Packaged original customer response history differs")
        previous = row["id"]
    if packet.get("latest_response_id") != previous:
        raise ValueError("Packaged response generation differs from its full history")
    return previous


def _inspect_directory(directory):
    directory = Path(directory)
    manifest = _manifest(reviews._read_json_file(reviews._regular(directory, MANIFEST)))
    actual = _tree(directory)
    if set(actual) != set(manifest["members"]) | {MANIFEST}:
        raise ValueError("Handback files differ from the complete original inventory")
    for name, descriptor in manifest["members"].items():
        if actual[name] != descriptor:
            raise ValueError("Engineering handback member changed: " + name)
    document = reviews._read_json_file(reviews._regular(directory, "handback.json"))
    if (document.get("schema") != "upstate.customer-review-handback-packet/v1"
            or document.get("handback_id") != manifest["handback_id"]):
        raise ValueError("Engineering handback document identity differs")
    contexts, packets = {}, []
    for item in document["reviews"]:
        relative = reviews._relative(item["path"])
        # Each selected desk is under a deterministic identity-derived prefix.
        expected_path = "reviews/" + identifier(item["review_id"]) + "/" + (
            identifier(item["response_id"]) if item["response_id"] is not None else "original")
        if relative != expected_path:
            raise ValueError("Handback review path differs from its selected generation")
        inspected = reviews.inspect_packet(directory / relative)
        packet = inspected["packet"]
        response_id = _packet_response(packet)
        if packet["review"]["id"] != item["review_id"] or response_id != item["response_id"]:
            raise ValueError("Handback refers to a different original review generation")
        if packet["review"]["project"]["id"] != manifest["project_id"]:
            raise ValueError("Handback combines reviews from different original projects")
        key = (item["review_id"], response_id)
        if key in contexts:
            raise ValueError("Handback repeats an original review generation")
        contexts[key] = packet
        packets.append(packet)
    records = document["history"]
    ordered = _chain(records)
    if not ordered or ordered[-1]["id"] != manifest["handback_id"]:
        raise ValueError("Handback lacks the complete selected engineering history")
    last = ordered[-1]
    if last["review_id"] != manifest["review_id"] or last["state"] != "ready":
        raise ValueError("Package must contain its ready engineering edition")
    original_key = (last["review_id"], last["response_id"])
    if original_key not in contexts:
        raise ValueError("Handback lacks its original selected customer response")
    original = contexts[original_key]
    if not original["responses"]:
        raise ValueError("Engineering handback has no original customer response")
    response = original["responses"][-1]
    needed = {original_key}
    for row in ordered:
        if row["review_id"] != last["review_id"] or row["response_id"] != last["response_id"]:
            raise ValueError("Engineering history crosses original customer responses")
        revision_key = (row["revised_review_id"], row["revised_response_id"])
        if row["revised_review_id"] is not None:
            needed.add(revision_key)
            if revision_key not in contexts:
                raise ValueError("Handback lacks an earlier engineering edition's actual replacement review")
            revision = contexts[revision_key]["review"]
        else:
            revision = None
        _check_record(row, original["review"], response, revision, manifest["project_id"])
    if set(contexts) != needed:
        raise ValueError("Handback contains a review unrelated to its selected engineering history")
    return {"manifest": manifest, "document": document, "handback": last, "review_packets": packets}


def _extract(path, directory):
    """Extract only exact ordinary inventory members; caller owns fresh staging."""
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        names = [row.filename for row in infos]
        if len(names) != len(set(names)):
            raise ValueError("Engineering archive repeats a member")
        for row in infos:
            reviews._relative(row.filename)
            mode = stat.S_IFMT(row.external_attr >> 16)
            if row.is_dir() or mode not in (0, stat.S_IFREG) or row.flag_bits & 1:
                raise ValueError("Engineering archive contains a nonordinary or encrypted member")
        if archive.getinfo(MANIFEST).file_size > reviews.JSON_BYTES:
            raise ValueError("Engineering handback inventory exceeds the document limit")
        manifest = _manifest(json.loads(archive.read(MANIFEST)))
        if set(names) != set(manifest["members"]) | {MANIFEST}:
            raise ValueError("Engineering archive differs from its complete inventory")
        for row in infos:
            expected = manifest["members"].get(row.filename)
            if expected is not None and row.file_size != expected["bytes"]:
                raise ValueError("Engineering archive member length differs: " + row.filename)
            target = directory / row.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            count, hashed = 0, hashlib.sha256()
            with archive.open(row) as source, target.open("xb") as output:
                while True:
                    block = source.read(1024 * 1024)
                    if not block:
                        break
                    count += len(block)
                    if count > row.file_size:
                        raise ValueError("Engineering archive member exceeded its retained length")
                    hashed.update(block)
                    output.write(block)
            if count != row.file_size or (expected is not None and hashed.hexdigest() != expected["sha256"]):
                raise ValueError("Engineering archive member differs: " + row.filename)
    return _inspect_directory(directory)


def inspect_packet(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Choose the original ordinary handback package")
    if path.is_dir():
        return _inspect_directory(path)
    with tempfile.TemporaryDirectory(prefix="upstate-handback-inspect-") as pending:
        return _extract(path, Path(pending))


def _csv(document, requests):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["request_id", "kind", "source_id", "request", "disposition", "owner", "engineering_note",
                     "replacement_artifact_ids", "replacement_requirement_ids"])
    lookup = {row["id"]: row for row in requests}

    def cell(value):
        text = str(value)
        return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text

    for item in document["history"][-1]["items"]:
        source = lookup[item["request_id"]]
        writer.writerow([cell(value) for value in (
            source["id"], source["kind"], source["source_id"], source["description"],
            item["disposition"], item["owner"], item["note"],
            " ".join(item["replacement_artifact_ids"]), " ".join(item["replacement_requirement_ids"]))])
    return output.getvalue()


def _html(document, original, revision):
    row = document["history"][-1]
    requests = {item["id"]: item for item in requests_for(original["review"], original["responses"][-1])}
    links = {(item["review_id"], item["response_id"]): item["path"] + "/index.html" for item in document["reviews"]}
    esc = lambda value: html.escape(str(value), quote=True)
    items = []
    for item in row["items"]:
        source = requests[item["request_id"]]
        artifacts = {value["id"]: value for value in revision["review"]["artifacts"]}
        requirements = {value["id"]: value for value in revision["review"]["requirements"]}
        revision_path = links[(row["revised_review_id"], row["revised_response_id"])].rsplit("/", 1)[0]
        refs = ['<a href="' + esc(urllib.parse.quote(revision_path + "/" + artifacts[key]["path"], safe="/")) + '">' +
                esc(artifacts[key].get("label") or artifacts[key]["original_path"]) + "</a>"
                for key in item["replacement_artifact_ids"]]
        refs.extend(esc(requirements[key]["title"]) + "<small> (" + esc(key) + ")</small>"
                    for key in item["replacement_requirement_ids"])
        items.append("<tr><td>" + esc(source["title"]) + "<p>" + esc(source["description"]) +
                     "</p><small>" + esc(source["kind"] + " / " + source["source_id"]) + "</small></td><td>" +
                     esc(item["disposition"]) + "</td><td>" + esc(item["owner"]) + "</td><td>" +
                     esc(item["note"]) + "</td><td>" + "<br>".join(refs) + "</td></tr>")
    history_rows = "".join("<li>" + esc(item["created_at"]) + " · " + esc(item["prepared_by"]["name"]) +
                           " · " + esc(item["state"]) + "<br><code>" + esc(item["id"]) + "</code></li>"
                           for item in document["history"])
    return """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Engineering handback</title><style>
*{box-sizing:border-box}body{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#fff;margin:32px;max-width:1500px;overflow-wrap:anywhere}
h1,h2{line-height:1.2}a{color:inherit;text-decoration:underline}nav{display:flex;gap:24px;flex-wrap:wrap}
table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #bbb;text-align:left;vertical-align:top;padding:12px}
th{background:#eee;overflow-wrap:normal}td p{white-space:pre-wrap}code,small{overflow-wrap:anywhere}li{margin:10px 0}
.table-wrap{max-width:100%;overflow-x:auto}@media(max-width:620px){body{margin:16px}.table-wrap table{min-width:900px}.table-wrap th,.table-wrap td{min-width:140px}}
@media print{body{margin:12px;font-size:10pt}.table-wrap{overflow:visible}.table-wrap table,.table-wrap th,.table-wrap td{min-width:0}thead{display:table-header-group}tr{break-inside:avoid}}
</style><h1>Engineering handback</h1><p>""" + esc(original["review"]["title"]) + """</p><p>Prepared by """ + esc(row["prepared_by"]["name"]) + \
        " · " + esc(row["prepared_by"]["organization"]) + " · " + esc(row["created_at"]) + \
        "</p><p>" + esc(row["summary"]) + "</p><p>These are engineering dispositions of the retained customer requests. " + \
        "The original customer decisions and both selected response histories remain available in their complete review desks.</p><nav>" + \
        '<a href="' + esc(links[(row["review_id"], row["response_id"])]) + '">Original customer response and files</a>' + \
        '<a href="' + esc(links[(row["revised_review_id"], row["revised_response_id"])]) + '">Revised review and replacement files</a>' + \
        '<a href="request-resolutions.csv">Complete resolutions CSV</a><a href="handback.json">Complete engineering history JSON</a></nav>' + \
        "<h2>Requested changes and engineering treatment</h2><div class='table-wrap' tabindex='0' role='region' aria-label='Engineering treatment'><table><thead><tr><th>Original request</th><th>Disposition</th>" + \
        "<th>Assigned engineer</th><th>Resolution or deferral</th><th>Selected replacement work</th></tr></thead><tbody>" + \
        "".join(items) + "</tbody></table></div><h2>Engineering editions</h2><ol>" + history_rows + "</ol></html>"


def _export_result(directory, inspected):
    manifest, row = inspected["manifest"], inspected["handback"]
    return {"schema": PACKAGE_SCHEMA, "project_id": manifest["project_id"],
            "review_id": row["review_id"], "response_id": row["response_id"], "handback_id": row["id"],
            "revised_review_id": row["revised_review_id"], "directory": str(directory),
            "index": str(directory / "index.html"), "package_sha256": manifest["package_sha256"],
            "members": len(manifest["members"])}


def describe_export(directory, *, archive=None):
    directory = Path(directory).absolute()
    inspected = inspect_packet(directory)
    result = _export_result(directory, inspected)
    if archive is not None:
        archive = Path(archive).absolute()
        archived = inspect_packet(archive)
        if archived["manifest"] != inspected["manifest"]:
            raise ValueError("Engineering archive differs from its retained exported desk")
        result["archive"] = {"path": str(archive), "bytes": archive.stat().st_size,
                             "sha256": file_digest(archive), "package_sha256": result["package_sha256"]}
    return result


def export_handback(workspace, handback_id, destination, *, archive=None):
    selected = show(workspace, handback_id)["handback"]
    if selected["state"] != "ready":
        raise ValueError("Finish the engineering dispositions and save a ready edition before handback")
    chain = history(workspace, selected["review_id"], selected["response_id"])
    chain = chain[:next(index + 1 for index, row in enumerate(chain) if row["id"] == selected["id"])]
    destination = Path(destination).absolute()
    if (destination.resolve().is_relative_to(workspace.root.resolve()) or
            destination.resolve().is_relative_to(Path(__file__).resolve().parents[1])):
        raise ValueError("Choose a fresh handback destination outside the workspace and application")
    if destination.exists() or destination.is_symlink():
        raise ValueError("Choose a new engineering handback destination")
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = Path(tempfile.mkdtemp(prefix=".handback-export-", dir=destination.parent))
    try:
        pairs = {(selected["review_id"], selected["response_id"])}
        pairs.update((row["revised_review_id"], row["revised_response_id"])
                     for row in chain if row["revised_review_id"] is not None)
        snapshots, contexts = [], {}
        for review_id, response_id in sorted(pairs, key=lambda pair: (pair[0], pair[1] or "")):
            relative = "reviews/" + review_id + "/" + (response_id or "original")
            reviews.export_review(workspace, review_id, pending / relative, through_response_id=response_id)
            packet = reviews.inspect_packet(pending / relative)["packet"]
            contexts[(review_id, response_id)] = packet
            snapshots.append({"review_id": review_id, "response_id": response_id, "path": relative})
        document = {"schema": "upstate.customer-review-handback-packet/v1",
                    "handback_id": selected["id"], "history": chain, "reviews": snapshots}
        original = contexts[(selected["review_id"], selected["response_id"])]
        revision = contexts[(selected["revised_review_id"], selected["revised_response_id"])]
        atomic_json(pending / "handback.json", document, immutable=True)
        (pending / "request-resolutions.csv").write_text(
            _csv(document, requests_for(original["review"], original["responses"][-1])), encoding="utf-8")
        (pending / "index.html").write_text(_html(document, original, revision), encoding="utf-8")
        (pending / "README.md").write_text(
            "# Engineering handback\n\nOpen index.html. Each linked review desk contains its actual files and "
            "pinned customer response history. The revised desk can export a new customer response against "
            "that precise generation. Import it through the original customer review response flow.\n\n"
            "Inspect: python -m model.review_cli handback-inspect PATH\n"
            "Receive independently: python -m model.review_cli handback-receive PATH DESTINATION\n"
            "Join restored source project: python -m model.review_cli --workspace WORKSPACE "
            "handback-receive PATH DESTINATION --join\n", encoding="utf-8")
        manifest = {"schema": PACKAGE_SCHEMA, "project_id": workspace.project["id"],
                    "review_id": selected["review_id"], "handback_id": selected["id"],
                    "created_at": now(), "members": _tree(pending)}
        manifest["package_sha256"] = digest(manifest)
        atomic_json(pending / MANIFEST, manifest, immutable=True)
        inspected = _inspect_directory(pending)
        if destination.exists() or destination.is_symlink():
            raise ValueError("Engineering destination appeared during export")
        os.rename(pending, destination)
        pending = None
        result = _export_result(destination, inspected)
        if archive is not None:
            result["archive"] = archive_packet(destination, archive)
        return result
    finally:
        if pending is not None:
            shutil.rmtree(pending)


def archive_packet(directory, destination):
    directory, destination = Path(directory).resolve(), Path(destination).absolute()
    inspected = _inspect_directory(directory)
    if destination.exists() or destination.is_symlink() or destination.resolve().is_relative_to(directory):
        raise ValueError("Choose a fresh engineering archive path outside the desk")
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=".handback-archive-", suffix=".zip", dir=destination.parent)
    pending = Path(name)
    try:
        with os.fdopen(descriptor, "w+b") as target:
            with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=3,
                                 allowZip64=True) as archive:
                for member in sorted(set(inspected["manifest"]["members"]) | {MANIFEST}):
                    archive.write(reviews._regular(directory, member), member)
            target.flush()
            os.fsync(target.fileno())
        verified = inspect_packet(pending)
        if verified["manifest"] != inspected["manifest"]:
            raise ValueError("Engineering desk changed while its archive was written")
        os.link(pending, destination)
        return {"path": str(destination), "bytes": destination.stat().st_size,
                "sha256": file_digest(destination), "package_sha256": inspected["manifest"]["package_sha256"]}
    finally:
        pending.unlink(missing_ok=True)


def _join(workspace, inspected):
    if inspected["manifest"]["project_id"] != workspace.project["id"]:
        raise ValueError("Receive this handback into its actual restored scientific project")
    incoming = inspected["document"]["history"]
    first = incoming[0]
    # Preflight every original scientific binding before publishing any review.
    # The original review importer performs the same checks under its own lock.
    for packet in inspected["review_packets"]:
        try:
            workspace._get("reviews", packet["review"]["id"])
        except FileNotFoundError:
            retained_responses = []
        else:
            retained_responses = reviews.history(workspace, packet["review"]["id"])
        received_responses = packet["responses"]
        shared = min(len(retained_responses), len(received_responses))
        if [row["id"] for row in retained_responses[:shared]] != [row["id"] for row in received_responses[:shared]]:
            raise ValueError("Received customer response history conflicts with the retained original")
        reviews._validate_bindings(workspace, packet["review"])
        for artifact in packet["review"]["artifacts"]:
            path = reviews._resolve(workspace, artifact, {})
            if path.stat().st_size != artifact["bytes"] or file_digest(path) != artifact["sha256"]:
                raise ValueError("Restored original artifact differs from the handback selection")
    existing = [row for row in workspace._list(KIND)
                if row.get("review_id") == first["review_id"] and row.get("response_id") == first["response_id"]]
    existing = _chain(existing)
    if [row["id"] for row in existing[:len(incoming)]] != [row["id"] for row in incoming[:len(existing)]]:
        raise ValueError("Received engineering history conflicts with retained work; preserve both editions")
    for packet in inspected["review_packets"]:
        reviews.import_packet(workspace, packet)
    with held(workspace.root / ".workspace.lock", blocking=False):
        current = history(workspace, first["review_id"], first["response_id"])
        if [row["id"] for row in current[:len(incoming)]] != [row["id"] for row in incoming[:len(current)]]:
            raise ValueError("Engineering history changed during receiving")
        for row in incoming[len(current):]:
            retained = workspace._save(KIND, row)
            if retained["id"] != row["id"]:
                raise ValueError("Received engineering edition changed during retention")
    return {"review_id": first["review_id"], "handback_id": incoming[-1]["id"],
            "engineering_editions": len(incoming), "review_generations": len(inspected["review_packets"])}


def receive_packet(path, destination, *, workspace=None):
    path, destination = Path(path).absolute(), Path(destination).absolute()
    if destination.exists() or destination.is_symlink():
        raise ValueError("Receive into a new engineering handback directory")
    if path.is_dir() and destination.resolve().is_relative_to(path.resolve()):
        raise ValueError("Receive into a directory outside the source handback")
    if workspace is not None and destination.resolve().is_relative_to(workspace.root.resolve()):
        raise ValueError("Receive handback files outside the scientific workspace; join retains their original records")
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = Path(tempfile.mkdtemp(prefix=".handback-receive-", dir=destination.parent))
    try:
        if path.is_dir():
            inspected = _inspect_directory(path)
            for name in sorted(set(inspected["manifest"]["members"]) | {MANIFEST}):
                source = reviews._regular(path, name)
                expected = inspected["manifest"]["members"].get(name) or {
                    "bytes": source.stat().st_size, "sha256": file_digest(source)}
                reviews._copy_file(source, pending / name, expected)
            inspected = _inspect_directory(pending)
        else:
            inspected = _extract(path, pending)
        joined = _join(workspace, inspected) if workspace is not None else None
        if destination.exists() or destination.is_symlink():
            raise ValueError("Engineering receiving destination appeared during intake")
        os.rename(pending, destination)
        pending = None
        return {**_export_result(destination, inspected), "joined": joined}
    finally:
        if pending is not None:
            shutil.rmtree(pending)

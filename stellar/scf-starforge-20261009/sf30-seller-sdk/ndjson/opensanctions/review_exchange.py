"""MIT. Independent reviewer copies over original Source Monitoring cases/cycles.

All business writes use the existing case writer and finite-cycle reducer. The
exchange retains complete originals; it supplies no screening/provider decision.
"""
from __future__ import annotations

import base64
import binascii
import copy
from datetime import datetime, timezone
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path
import time
import uuid

from model import (InputError, MAX_SOURCE, RESOLUTION, RELEVANCE, MONITORING_DEFAULT,
                   exact_id, text, sha, stable, json_bytes, load_json, file_digest, sync_dir)
import review_cycles as cycles

ISSUE = "starforge.opensanctions-review-issue.v1"
RETURN = "starforge.opensanctions-review-return.v1"
EVENT = "starforge.opensanctions-review-exchange-event.v1"
RESULT = "starforge.opensanctions-review-exchange-result.v1"
MAX_DOCUMENT = MAX_SOURCE
MAX_EDITOR = 4 * 1024 * 1024
MAX_EDITIONS = 1000
MAX_EVENTS = 50000
FIELDS = ("candidateId", "editionId", "resolution", "relevance", "reason", "monitoring", "completion")
COMPLETION = ("disposition", "note", "evidence", "portfolioReviewRequestId")
COPY_NAMESPACE = uuid.NAMESPACE_URL


def need(ok, message):
    if not ok:
        raise InputError(message)


def keys(value, fields, label):
    need(isinstance(value, dict) and set(value) == set(fields), label + " fields differ")
    return value


def uid(value):
    try:
        need(isinstance(value, str) and str(uuid.UUID(value)) == value, "Use a canonical original UUID")
    except (ValueError, TypeError, AttributeError):
        raise InputError("Use a canonical original UUID") from None
    return value


def event_id(value):
    return sha(("review-exchange-request:" + uid(value)).encode())


def issue_id(value):
    return sha(("review-exchange-issue:" + uid(value)).encode())


def _json(raw):
    need(isinstance(raw, bytes) and len(raw) <= MAX_DOCUMENT, "Complete document exceeds 256 MiB")
    return load_json(raw)


def _raw(value):
    raw = json_bytes(value)
    need(len(raw) <= MAX_DOCUMENT, "Complete document exceeds 256 MiB; reduce explicit selected scope")
    return raw


def _b64(raw):
    return base64.b64encode(raw).decode("ascii")


def _un64(value, maximum=MAX_DOCUMENT):
    need(isinstance(value, str) and len(value) <= ((maximum + 2) // 3) * 4, "Encoded original exceeds capacity")
    try:
        raw = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise InputError("Original file is not strict Base64") from None
    need(len(raw) <= maximum and _b64(raw) == value, "Original Base64 or size differs")
    return raw


def _descriptor(raw, name, media, role=None):
    text(name, "File name", 240); text(media, "Media type", 200)
    need(not any(c in media for c in ("\r", "\n")), "Media type must not contain header newlines")
    need(name not in {".", ".."} and Path(name).name == name and not any(x in name for x in ("/", "\\", "\r", "\n")),
         "Use a plain original file name")
    value = {"sha256": sha(raw), "bytes": len(raw), "name": name, "mediaType": media}
    if role is not None:
        value["role"] = role
    return value


def _file(value, origins=False):
    fields = ("sha256", "bytes", "name", "mediaType", "base64") + (("origins",) if origins else ())
    keys(value, fields, "Complete file")
    raw = _un64(value["base64"])
    need(_descriptor(raw, value["name"], value["mediaType"]) ==
         {k: value[k] for k in ("sha256", "bytes", "name", "mediaType")}, "Complete file identity differs")
    if origins:
        need(isinstance(value["origins"], list) and value["origins"], "Original file provenance is required")
        for origin in value["origins"]:
            keys(origin, ("kind", "id"), "Original file provenance")
            need(origin["kind"] in {"object", "native_source"}, "Unknown original file kind")
            exact_id(origin["id"])
    return raw


def _files(values, origins=False):
    need(isinstance(values, list) and len(values) <= 8192, "File inventory exceeds original archive capacity")
    seen, total, result = set(), 0, {}
    for value in values:
        raw = _file(value, origins)
        need(value["sha256"] not in seen, "Complete file inventory repeats an identity")
        seen.add(value["sha256"]); total += len(raw)
        need(total <= MAX_DOCUMENT, "Complete file population exceeds 256 MiB")
        result[value["sha256"]] = raw
    return result


def _object(domain, descriptor):
    need(isinstance(descriptor, dict) and {"sha256", "bytes"} <= set(descriptor), "Select retained original bytes")
    ident = exact_id(descriptor["sha256"])
    need(type(descriptor["bytes"]) is int and 0 <= descriptor["bytes"] <= MAX_DOCUMENT,
         "Original document size is invalid")
    original = domain._one("objects", ident)
    need(original["bytes"] == descriptor["bytes"], "Original object descriptor differs")
    raw = domain.object_path(ident).read_bytes()
    need(len(raw) == descriptor["bytes"] and sha(raw) == ident, "Original object bytes changed")
    return raw


def _retain(domain, raw, name, media, provenance):
    """Stage complete immutable bytes; SQL insertion joins the caller transaction."""
    need(domain.db.in_transaction, "Exchange object retention requires its original transaction")
    need(len(raw) <= MAX_DOCUMENT, "Original object exceeds 256 MiB")
    descriptor = _descriptor(raw, name, media)
    ident = descriptor["sha256"]
    row = domain.db.execute("SELECT body FROM os_objects WHERE id=?", (ident,)).fetchone()
    if row is not None:
        body = load_json(row[0])
        need(body["bytes"] == len(raw) and domain.object_path(ident).read_bytes() == raw,
             "Retained immutable object differs")
        return descriptor
    target = domain.objects / ident
    if target.exists():
        need(file_digest(target) == ident and target.stat().st_size == len(raw), "Original object path differs")
    else:
        with domain.ws.scratch() as temp:
            pending = temp / "review-original"
            with os.fdopen(os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                out.write(raw); out.flush(); os.fsync(out.fileno())
            os.replace(pending, target); sync_dir(domain.objects)
    domain._put("objects", {"id": ident, "bytes": len(raw), "name": name, "media": media,
                           "provenance": provenance, "receivedAt": time.time()})
    return descriptor


def _cycle_at(domain, ident, version):
    exact_id(ident)
    need(type(version) is int and version > 0, "Select the exact saved cycle version")
    rows = []
    for row in domain.db.execute("SELECT body FROM os_cycle_events"):
        event = load_json(row[0])
        if event["cycleId"] == ident and event["version"] <= version:
            rows.append(event)
    result = cycles.replay(domain, rows).get(ident)
    need(result is not None and result["version"] == version, "Original cycle history is incomplete")
    return result


def _completion(item):
    done = item.get("completion")
    if done is None:
        return {"disposition": None, "note": "", "evidence": [], "portfolioReviewRequestId": None}
    return {"disposition": done["disposition"], "note": done["note"], "evidence": list(done["evidence"]),
            "portfolioReviewRequestId": done.get("portfolioReviewRequestId")}


def _values(case, item):
    return {**{k: copy.deepcopy(case[k]) for k in ("candidateId", "resolution", "relevance", "reason", "monitoring")},
            "editionId": case["edition"], "completion": _completion(item)}


def _evidence_ids(value):
    need(isinstance(value, list) and len(value) <= 128 and len(set(value)) == len(value),
         "Use at most 128 distinct complete evidence object IDs")
    for ident in value:
        exact_id(ident)
    return value


def _prepare_fields(body):
    keys(body, ("requestId", "cycleId", "expectedVersion", "caseIds", "reviewer", "label", "actor", "at", "evidenceIds"),
         "Issue selection")
    uid(body["requestId"]); exact_id(body["cycleId"])
    cycles.actor(body["actor"]); cycles.actor(body["reviewer"]); cycles.instant(body["at"])
    text(body["label"], "Reviewer issue label", 240); _evidence_ids(body["evidenceIds"])
    need(type(body["expectedVersion"]) is int and body["expectedVersion"] > 0, "Select the exact cycle version")
    ids = body["caseIds"]
    need(isinstance(ids, list) and 0 < len(ids) <= cycles.MAX_CASES and len(set(ids)) == len(ids),
         "Select 1–10,000 distinct assigned cases")
    for ident in ids:
        exact_id(ident)


def _prepare_from_issue(issue):
    return {"requestId": issue["requestId"], "cycleId": issue["cycle"]["id"],
            "expectedVersion": issue["cycle"]["version"], "caseIds": issue["caseOrder"],
            "reviewer": issue["reviewer"], "label": issue["label"], "actor": issue["issuer"],
            "at": issue["issuedAt"], "evidenceIds": issue["evidenceIds"]}


def _build_issue(domain, body, state, cases, frozen_items=None):
    _prepare_fields(body)
    need(state["version"] == body["expectedVersion"] and state["status"] == "OPEN",
         "Issue from the exact open review-cycle version")
    need(body["actor"]["id"] in {state["supervisor"]["id"], body["reviewer"]["id"]},
         "The assigned reviewer or cycle supervisor issues this selected work")
    when = cycles.instant(body["at"])
    need(when >= cycles.instant(state["updatedAt"]), "Issue time precedes its saved cycle")
    files, source_ids, object_ids = {}, set(), set(body["evidenceIds"])
    def add_file(kind, ident):
        target = source_ids if kind == "native_source" else object_ids
        target.add(ident)
    basis = state["basis"]
    customer = basis.get("sourceKind") == "portfolio_refresh"
    before = basis.get("beforeEdition"); after = basis.get("afterEdition")
    before_p = basis.get("beforePortfolio"); after_p = basis.get("afterPortfolio")
    statement_sets = []
    if not customer:
        for set_id in basis["comparison"].get("statements", []):
            if set_id is not None:
                statement = domain._one("statement_sets", set_id)
                statement_sets.append(statement)
                add_file("object", statement["original"])
    for selected in (before, after, before_p, after_p):
        if selected is not None:
            add_file("native_source", selected["source"])
            if selected.get("metadata"):
                add_file("object", selected["metadata"])
    cycle = {"id": state["id"], "version": state["version"], "revision": state["revision"],
             "label": state["label"], "scopeNote": state["scopeNote"],
             "sourceKind": "portfolio_refresh" if customer else "source_comparison",
             "comparison": copy.deepcopy(basis["comparison"]),
             "beforeEdition": copy.deepcopy(before), "afterEdition": copy.deepcopy(after),
             "beforePortfolio": copy.deepcopy(before_p), "afterPortfolio": copy.deepcopy(after_p),
             "populationScope": copy.deepcopy(basis["populationScope"]), "statementSets": statement_sets}
    items = {}
    for ident in body["caseIds"]:
        need(ident in state["items"], "A case is outside this exact cycle")
        item, case = state["items"][ident], cases[ident]
        assignment = item["assignment"]
        need(assignment is not None and assignment["reviewer"]["id"] == body["reviewer"]["id"],
             "Every issued case must be assigned to the selected reviewer")
        need(case["id"] == ident and not case.get("mergedInto") and
             all(case[k] == item["impact"]["case"][k] for k in ("portfolioKey", "counterpartyId", "dataset")),
             "Original case identity differs from the selected cycle")
        need(case["updatedAt"] <= when, "Issue time precedes its saved case")
        event = cycles.case_event(domain, case["revision"])
        need(stable(event["value"]) == stable(case), "Issued case differs from original saved history")
        portfolio = domain._one("portfolios", case["portfolio"])
        edition = domain._one("editions", case["edition"])
        add_file("native_source", portfolio["source"]); add_file("native_source", edition["source"])
        add_file("object", edition["metadata"])
        request = domain._one("requests", case["matchRequest"]) if case.get("matchRequest") else None
        if request is not None:
            need(request.get("state") == "RECEIVED", "An issued native match request must be received")
            add_file("object", request["request"])
            add_file("object", request["response"]["object"])
        candidates = []
        scopes = sorted({case["edition"], *([after["id"]] if after else [])})
        ids = sorted({case["candidateId"], *item["impact"].get("currentIds", [])})
        for scope in scopes:
            for candidate in ids:
                try:
                    record = domain.entity(scope, candidate)
                except InputError:
                    record = None
                candidates.append({"scope": scope, "id": candidate, "record": record})
        reviews = []
        if customer:
            import portfolio_review_cycles
            if frozen_items is None:
                for choice in portfolio_review_cycles.choices(domain, basis["comparison"]["id"])["rows"]:
                    if choice["caseId"] == ident:
                        observed = portfolio_review_cycles.observe_completion(domain, choice["requestId"])
                        need(observed["createdAt"] <= when, "Issue time precedes an included original portfolio review")
                        reviews.append(observed)
            else:
                retained = frozen_items[ident]["portfolioReviews"]
                need(isinstance(retained, list), "Retain the complete issued portfolio review list")
                seen_reviews = set()
                for selected_review in retained:
                    request_id = selected_review["request"]["requestId"]
                    need(request_id not in seen_reviews, "Original portfolio review identity repeats")
                    seen_reviews.add(request_id)
                    original_review = portfolio_review_cycles.observe_completion(domain, request_id)
                    req = original_review["request"]
                    need(stable(original_review) == stable(selected_review) and req["caseId"] == ident and
                         req["comparisonId"] == basis["comparison"]["id"] and req["decision"] in {"retain", "continue"} and
                         original_review["createdAt"] <= when, "Frozen original portfolio review changed")
                    reviews.append(original_review)
        findings = []
        if not customer:
            frozen_findings = None
            if frozen_items is not None:
                frozen_findings = frozen_items[ident]["findings"]
                need(isinstance(frozen_findings, list) and [f["id"] for f in frozen_findings] ==
                     sorted(item["impact"]["changes"]), "Frozen source finding population differs")
            for index, finding_id in enumerate(sorted(item["impact"]["changes"])):
                row = domain.db.execute("SELECT body FROM os_changes WHERE id=? AND comparison=?",
                                        (finding_id, basis["comparison"]["id"])).fetchone()
                need(row is not None, "Original selected source finding is absent")
                finding = load_json(row[0])
                if frozen_findings is None:
                    captured = [load_json(r[0]) for r in domain.db.execute(
                        "SELECT body FROM os_reviews WHERE change_id=? ORDER BY rowid", (finding_id,))]
                else:
                    captured = frozen_findings[index]["reviews"]
                    need(isinstance(captured, list), "Retain the full captured authority-review list")
                verified_reviews, previous = [], None
                for captured_review in captured:
                    saved = domain.db.execute("SELECT body FROM os_reviews WHERE id=? AND change_id=?",
                                              (captured_review["id"], finding_id)).fetchone()
                    need(saved is not None, "Captured original authority review is absent")
                    actual = load_json(saved[0])
                    need(stable(actual) == stable(captured_review) and actual["at"] <= when and
                         actual["previous"] == previous and
                         actual["id"] == sha(json_bytes({k: v for k, v in actual.items() if k != "id"})),
                         "Frozen authority review history changed or has a missing predecessor")
                    verified_reviews.append(actual); previous = actual["id"]
                finding["reviews"] = verified_reviews
                findings.append(finding)
        completion = _completion(item)
        for evidence in completion["evidence"]:
            add_file("object", evidence)
        values = _values(case, item)
        if item.get("completion") and item["completion"]["caseRevision"] != case["revision"]:
            values["completion"] = _completion({})
        items[ident] = {"case": copy.deepcopy(case), "caseEvent": event, "assignment": copy.deepcopy(assignment),
                       "impact": copy.deepcopy(item["impact"]), "counterparty": domain.entity(case["portfolio"], case["counterpartyId"]),
                       "candidates": candidates, "matchRequest": copy.deepcopy(request),
                       "portfolioReviews": reviews, "findings": findings, "values": values}
    def capture_file(raw, name, media, origin):
        digest = sha(raw)
        if digest not in files:
            files[digest] = {**_descriptor(raw, name, media), "base64": _b64(raw), "origins": []}
        if origin not in files[digest]["origins"]:
            files[digest]["origins"].append(origin)
    sizes = {}
    for ident in sorted(source_ids):
        descriptor = domain.ws.source(ident)
        sizes[ident] = descriptor["bytes"]
    for ident in sorted(object_ids):
        descriptor = domain._one("objects", ident)
        need(ident not in sizes or sizes[ident] == descriptor["bytes"], "Original source/object size identity differs")
        sizes[ident] = descriptor["bytes"]
    need(len(sizes) <= 8192 and all(type(n) is int and 0 <= n <= MAX_DOCUMENT for n in sizes.values()),
         "Complete original file population exceeds the native supported capacity")
    need(sum(sizes.values()) <= MAX_DOCUMENT and sum(((n + 2) // 3) * 4 for n in sizes.values()) <= MAX_DOCUMENT,
         "Complete original byte population cannot fit the 256 MiB issued document; select a smaller explicit assignment")
    for ident in sorted(source_ids):
        row = domain.ws.source(ident)
        raw = domain._source_path(ident).read_bytes()
        capture_file(raw, row["name"], "application/x-ndjson", {"kind": "native_source", "id": ident})
    for ident in sorted(object_ids):
        obj = domain._one("objects", ident)
        capture_file(domain.object_path(ident).read_bytes(), obj["name"], obj["media"], {"kind": "object", "id": ident})
    issue = {"schema": ISSUE, "id": issue_id(body["requestId"]), "requestId": body["requestId"],
             "label": body["label"], "issuedAt": body["at"], "issuer": copy.deepcopy(body["actor"]),
             "reviewer": copy.deepcopy(body["reviewer"]), "cycle": cycle, "caseOrder": list(body["caseIds"]),
             "evidenceIds": list(body["evidenceIds"]), "items": items, "files": [files[k] for k in sorted(files)]}
    _files(issue["files"], True); _raw(issue)
    return issue


def prepare_issue(domain, body):
    """Read-only preparation. The host retains exact JSON/HTML before command."""
    body = load_json(json_bytes(body))
    _prepare_fields(body)
    with domain.mutex:
        need(cycles.instant(body["at"]) <= time.time() + 1, "Issue time cannot be in the future")
        state = cycles.replay(domain).get(body["cycleId"])
        need(state is not None, "Select an existing original review cycle")
        cases = {ident: domain._one("cases", ident) for ident in body["caseIds"]}
        issue = _build_issue(domain, body, state, cases)
        raw = _raw(issue)
        return {"issue": issue, "issued": {"sha256": sha(raw), "bytes": len(raw), "base64": _b64(raw)}}


def _validate_issue(domain, raw, current=False):
    issue = _json(raw)
    keys(issue, ("schema", "id", "requestId", "label", "issuedAt", "issuer", "reviewer", "cycle",
                 "caseOrder", "evidenceIds", "items", "files"), "Issued review")
    need(issue["schema"] == ISSUE and issue["id"] == issue_id(issue["requestId"]), "Issued review identity differs")
    body = _prepare_from_issue(issue); _prepare_fields(body)
    need(isinstance(issue["items"], dict) and set(issue["items"]) == set(issue["caseOrder"]), "Complete issued case population differs")
    state = cycles.replay(domain).get(body["cycleId"]) if current else _cycle_at(domain, body["cycleId"], body["expectedVersion"])
    need(state is not None, "The original review cycle is absent")
    cases = {ident: domain._one("cases", ident) if current else issue["items"][ident]["case"] for ident in body["caseIds"]}
    expected = _build_issue(domain, body, state, cases, None if current else issue["items"])
    need(stable(issue) == stable(expected), "Complete issue source, assignment or case selection differs")
    return issue


def _policy(value):
    keys(value, MONITORING_DEFAULT, "Original monitoring policy")
    for key in ("resolutionProperties", "programIds", "topics", "datasets"):
        need(isinstance(value[key], list) and len(value[key]) <= 128 and all(type(v) is str for v in value[key]),
             "Monitoring fields must be original bounded string arrays")
    need(type(value["reviewConfirmedIdentityChanges"]) is bool, "Identity monitoring requires an explicit boolean")


def _validate_values(value, item, issue, files, draft=False):
    keys(value, FIELDS, "Reviewer case values")
    case = item["case"]
    need(value["candidateId"] in {case["candidateId"], *item["impact"].get("currentIds", [])},
         "Reviewer candidate is outside the issued original identity chain")
    allowed_editions = {case["edition"]}
    if issue["cycle"]["afterEdition"] is not None:
        allowed_editions.add(issue["cycle"]["afterEdition"]["id"])
    need(value["editionId"] in allowed_editions, "Reviewer edition is outside the exact issued source")
    need(value["resolution"] in RESOLUTION and value["relevance"] in RELEVANCE,
         "Use separate native identity and relevance decisions")
    text(value["reason"], "Case reason", 8000, blank=draft); _policy(value["monitoring"])
    done = keys(value["completion"], COMPLETION, "Reviewer completion")
    need(done["disposition"] in {None, "REVIEWED", "FOLLOW_UP"}, "Use reviewed, follow-up or unfinished")
    text(done["note"], "Completion note", 8000, blank=draft or done["disposition"] is None)
    _evidence_ids(done["evidence"])
    need(set(done["evidence"]) <= files, "Review evidence is missing complete original bytes")
    ref = done["portfolioReviewRequestId"]
    if ref is not None:
        text(ref, "Original portfolio review request", 160)
    if issue["cycle"]["sourceKind"] == "source_comparison":
        need(ref is None, "A source comparison does not select a customer portfolio review")
    else:
        available = {event["request"]["requestId"] for event in item["portfolioReviews"]}
        need(ref is None or ref in available, "Select an actual original issued portfolio review")
        need(draft or done["disposition"] != "REVIEWED" or ref is not None,
             "Reviewed customer-portfolio work requires its original retain or continue decision")


class _ReturnHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.active = False; self.parts = []; self.count = 0
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag.lower() == "script" and attrs.get("id") == "source-review-data":
            need(not self.active and self.count == 0 and attrs.get("type") == "application/json",
                 "Select one inert original review return data block")
            self.active = True; self.count += 1
    def handle_endtag(self, tag):
        if tag.lower() == "script" and self.active:
            self.active = False
    def handle_data(self, data):
        if self.active:
            self.parts.append(data)
    def handle_entityref(self, name):
        if self.active:
            self.parts.append("&" + name + ";")
    def handle_charref(self, name):
        if self.active:
            self.parts.append("&#" + name + ";")


def _parse_return(raw, media=None):
    need(isinstance(raw, bytes) and len(raw) <= MAX_DOCUMENT, "Complete returned JSON/HTML exceeds 256 MiB")
    try:
        source = raw.decode("utf-8-sig")
    except UnicodeError:
        raise InputError("Return must contain complete UTF-8 JSON or HTML") from None
    if source.lstrip().startswith("<"):
        parser = _ReturnHTML()
        try:
            parser.feed(source); parser.close()
        except (ValueError, RecursionError):
            raise InputError("Returned HTML data is malformed") from None
        need(parser.count == 1 and not parser.active, "Returned HTML lacks its complete inert review data")
        result = load_json("".join(parser.parts))
    else:
        result = load_json(source)
    return result


def initial_return(issued_raw):
    issue = _json(issued_raw)
    need(issue.get("schema") == ISSUE, "Select the complete original issue")
    return {"schema": RETURN, "issued": {"sha256": sha(issued_raw), "bytes": len(issued_raw), "base64": _b64(issued_raw)},
            "workingCopyId": str(uuid.uuid5(COPY_NAMESPACE, "starforge.opensanctions-review-copy:" + sha(issued_raw))),
            "editions": [], "selectedEditionId": None,
            "draft": {"basedOn": None, "actor": copy.deepcopy(issue["reviewer"]), "updatedMs": 0,
                      "items": {ident: copy.deepcopy(issue["items"][ident]["values"]) for ident in issue["caseOrder"]}},
            "files": []}


def _validate_return(domain, raw):
    value = _parse_return(raw)
    keys(value, ("schema", "issued", "workingCopyId", "editions", "selectedEditionId", "draft", "files"), "Returned review")
    need(value["schema"] == RETURN, "Select the complete reviewer-copy return")
    uid(value["workingCopyId"])
    issued = keys(value["issued"], ("sha256", "bytes", "base64"), "Original issued bytes")
    issued_raw = _un64(issued["base64"])
    need(issued["sha256"] == sha(issued_raw) and type(issued["bytes"]) is int and issued["bytes"] == len(issued_raw),
         "Original issued document identity differs")
    issue = _validate_issue(domain, issued_raw)
    file_data = _files(value["files"])
    original_files = _files(issue["files"], True)
    for ident in set(file_data) & set(original_files):
        need(file_data[ident] == original_files[ident], "A reviewer file changes original evidence")
    evidence_ids = set(file_data) | set(original_files)
    editions = value["editions"]
    need(isinstance(editions, list) and len(editions) <= MAX_EDITIONS, "Saved reviewer editions exceed 1,000")
    seen, parent, previous_at = set(), None, cycles.instant(issue["issuedAt"])
    for edition in editions:
        keys(edition, ("id", "parent", "name", "actor", "at", "items"), "Named reviewer edition")
        uid(edition["id"]); text(edition["name"], "Edition name", 240); cycles.actor(edition["actor"])
        need(edition["id"] not in seen and edition["parent"] == parent, "Named editions must retain their complete ordered parent chain")
        need(edition["actor"]["id"] == issue["reviewer"]["id"], "Saved editions must identify the assigned reviewer")
        when = cycles.instant(edition["at"])
        need(when >= previous_at, "Named reviewer edition precedes its original issue or parent")
        need(isinstance(edition["items"], dict) and set(edition["items"]) == set(issue["caseOrder"]),
             "Every saved edition must include the complete issued case population")
        for ident, item in edition["items"].items():
            _validate_values(item, issue["items"][ident], issue, evidence_ids)
        seen.add(edition["id"]); parent = edition["id"]; previous_at = when
    need((value["selectedEditionId"] is None and not editions) or value["selectedEditionId"] in seen, "Select a retained named edition")
    draft = value["draft"]
    if draft is not None:
        need(isinstance(draft, dict) and set(draft) in (
            {"basedOn", "actor", "updatedMs", "items"}, {"basedOn", "actor", "updatedMs", "items", "editor"}), "Draft fields differ")
        need(draft["basedOn"] is None or draft["basedOn"] in seen, "Draft baseline edition is absent")
        keys(draft["actor"], ("id", "name"), "Draft actor")
        text(draft["actor"]["id"], "Draft actor ID", 160, True); text(draft["actor"]["name"], "Draft actor name", 160, True)
        need(type(draft["updatedMs"]) is int and 0 <= draft["updatedMs"] <= 9007199254740991, "Draft time must be a safe nonnegative integer")
        need(isinstance(draft["items"], dict) and set(draft["items"]) == set(issue["caseOrder"]), "Draft case population differs")
        if "editor" in draft:
            need(len(json_bytes(draft["editor"])) - 1 <= MAX_EDITOR, "Unfinished raw controls exceed 4 MiB")
        for ident, item in draft["items"].items():
            _validate_values(item, issue["items"][ident], issue, evidence_ids, True)
    _raw(value)
    return value, issue, issued_raw


def prepare_return(domain, raw, name, media_type):
    descriptor = _descriptor(raw, name, media_type)
    with domain.mutex:
        value, issue, _ = _validate_return(domain, raw)
        return {"issueId": issue["id"], "workingCopyId": value["workingCopyId"],
                "selectedEditionId": value["selectedEditionId"],
                "editions": [{k: e[k] for k in ("id", "parent", "name", "actor", "at")} for e in value["editions"]],
                "draftPresent": value["draft"] is not None, "original": descriptor}


def _envelope(value):
    keys(value, ("requestId", "action", "actor", "at", "body"), "Exchange command")
    uid(value["requestId"]); cycles.actor(value["actor"]); cycles.instant(value["at"])
    need(value["action"] in {"issue", "receive", "apply"} and isinstance(value["body"], dict), "Select an exchange operation")
    if value["action"] == "issue":
        keys(value["body"], ("issued", "html"), "Issue command")
        for descriptor in value["body"].values():
            keys(descriptor, ("sha256", "bytes"), "Issued original descriptor")
    elif value["action"] == "receive":
        keys(value["body"], ("file",), "Return command")
        keys(value["body"]["file"], ("sha256", "bytes", "name", "mediaType"), "Returned original descriptor")
    else:
        keys(value["body"], ("returnId", "editionId", "reviewSha256", "expectedCycleVersion", "expectedCases", "choices"), "Adoption command")
        exact_id(value["body"]["returnId"]); uid(value["body"]["editionId"]); exact_id(value["body"]["reviewSha256"])


def _read_events(domain):
    events, ids, requests = [], set(), set()
    for row in domain.db.execute("SELECT id,body FROM os_exchange_events ORDER BY rowid"):
        event = load_json(row[1])
        keys(event, ("schema", "id", "sequence", "request", "inputSha256", "observations", "result", "sha256"), "Exchange event")
        _envelope(event["request"])
        need(event["schema"] == EVENT and event["id"] == row[0] == event_id(event["request"]["requestId"]) and
             event["id"] not in ids and event["request"]["requestId"] not in requests, "Exchange original request identity differs")
        need(type(event["sequence"]) is int and event["sequence"] == len(events) + 1, "Exchange history sequence is incomplete")
        need(event["inputSha256"] == sha(json_bytes(event["request"])) and
             event["sha256"] == sha(json_bytes({k: v for k, v in event.items() if k != "sha256"})),
             "Exchange request or event bytes differ")
        ids.add(event["id"]); requests.add(event["request"]["requestId"]); events.append(event)
    need(len(events) <= MAX_EVENTS, "Complete reviewer exchange history exceeds 50,000 operations")
    return events


def _indices(events):
    issues, returns = {}, {}
    for event in events:
        result = event["result"]
        if event["request"]["action"] == "issue":
            need(result["issueId"] not in issues, "An issued review identity repeats")
            issues[result["issueId"]] = event
        elif event["request"]["action"] == "receive":
            previous = returns.get(result["returnId"])
            if previous is not None:
                need(previous["result"]["issueId"] == result["issueId"], "A returned original is bound to another issue")
            else:
                returns[result["returnId"]] = event
    return issues, returns


def _issue_original(domain, event):
    return _object(domain, event["request"]["body"]["issued"])


def _return_original(domain, event):
    return _object(domain, event["request"]["body"]["file"])


def _edition(value, ident):
    selected = next((e for e in value["editions"] if e["id"] == ident), None)
    need(selected is not None, "Select a complete saved named edition; unfinished draft is retained but not adopted")
    return selected


def _compare_values(baseline, current, returned):
    fields = {}
    for key in FIELDS:
        b, c, r = baseline[key], current[key], returned[key]
        if stable(c) == stable(r):
            status, value = ("unchanged" if stable(b) == stable(c) else "same"), c
        elif stable(r) == stable(b):
            status, value = "current", c
        elif stable(c) == stable(b):
            status, value = "returned", r
        else:
            status, value = "conflict", None
        fields[key] = {"baseline": b, "current": c, "returned": r, "status": status, "value": copy.deepcopy(value)}
    return fields


def _comparison(domain, event, edition_id, _state=None, _cases=None):
    value, issue, _ = _validate_return(domain, _return_original(domain, event))
    edition = _edition(value, edition_id)
    state = _state if _state is not None else cycles.replay(domain).get(issue["cycle"]["id"])
    need(state is not None, "The original review cycle is absent")
    rows, expected = [], {}
    for ident in issue["caseOrder"]:
        original = issue["items"][ident]
        current = _cases[ident] if _cases is not None else domain._one("cases", ident)
        native_item = state["items"].get(ident)
        blocked = []
        if native_item is None:
            blocked.append("The case is absent from the current cycle")
            native_item = {"assignment": None, "completion": None}
        if current.get("mergedInto"):
            blocked.append("The current case has been merged; issue its current original assignment")
        if any(current[k] != original["case"][k] for k in ("portfolioKey", "portfolio", "counterpartyId", "dataset", "matchRequest")):
            blocked.append("Original customer/source request binding changed; issue the current selection")
        if stable(native_item.get("assignment")) != stable(original["assignment"]):
            blocked.append("The original assignment changed; issue the current assignment")
        if state["status"] != "OPEN":
            blocked.append("The cycle is signed; reopen through the original cycle workflow")
        now_values = _values(current, native_item)
        if native_item.get("completion") and native_item["completion"]["caseRevision"] != current["revision"]:
            now_values["completion"] = _completion({})
        expected[ident] = current["revision"]
        rows.append({"caseId": ident, "baselineCaseRevision": original["case"]["revision"],
                     "currentCase": current, "baseline": original["values"], "current": now_values,
                     "returned": edition["items"][ident], "assignment": native_item.get("assignment"),
                     "fields": _compare_values(original["values"], now_values, edition["items"][ident]), "blocked": blocked})
    result = {"schema": "starforge.opensanctions-review-comparison.v1", "issueId": issue["id"],
              "returnId": event["result"]["returnId"], "editionId": edition_id,
              "cycle": {k: state[k] for k in ("id", "version", "revision", "status")},
              "expectedCases": expected, "rows": rows}
    result["reviewSha256"] = sha(json_bytes(result))
    return result, value, issue, edition


def _selected_values(comparison, choices):
    need(isinstance(choices, dict) and set(choices) == set(comparison["expectedCases"]),
         "Record an explicit keep/apply choice for every issued case")
    results = {}
    for row in comparison["rows"]:
        choice = keys(choices[row["caseId"]], ("action", "fields"), "Case adoption choice")
        need(choice["action"] in {"keep", "apply"} and isinstance(choice["fields"], dict), "Choose keep or apply for each case")
        if choice["action"] == "keep":
            need(choice["fields"] == {}, "A kept current case has no field adoption choices")
            continue
        need(not row["blocked"], "; ".join(row["blocked"]))
        conflicts = {key for key, field in row["fields"].items() if field["status"] == "conflict"}
        need(set(choice["fields"]) == conflicts and all(v in {"current", "returned"} for v in choice["fields"].values()),
             "Resolve every displayed conflict explicitly using current or returned")
        selected = {}
        for key, field in row["fields"].items():
            selected[key] = copy.deepcopy(field[choice["fields"][key]] if key in conflicts else field["value"])
        results[row["caseId"]] = selected
    return results


def compare(domain, return_id, edition_id, adoption_request_id=None):
    with domain.mutex:
        events = _read_events(domain); _, returns = _indices(events)
        need(return_id in returns, "Select a retained complete return")
        if adoption_request_id is None:
            return _view_bound(_comparison(domain, returns[return_id], edition_id)[0])
        selected = next((e for e in events if e["request"]["requestId"] == uid(adoption_request_id)), None)
        need(selected is not None and selected["request"]["action"] == "apply" and
             selected["request"]["body"]["returnId"] == return_id and selected["request"]["body"]["editionId"] == edition_id,
             "Select the original adoption request for this return and edition")
        comparison = selected["observations"]["comparison"]
        state = cycles.replay(domain)[comparison["cycle"]["id"]]
        return _view_bound({"readOnly": True, "event": selected, "comparison": comparison,
                "current": {"cycleVersion": state["version"], "cycleRevision": state["revision"],
                            "cases": {ident: domain._one("cases", ident)["revision"] for ident in comparison["expectedCases"]}}})


def _retain_document_files(domain, issue, returned=None):
    files = list(issue["files"]) + (list(returned["files"]) if returned is not None else [])
    for file in files:
        raw = _file(file, "origins" in file)
        _retain(domain, raw, file["name"], file["mediaType"], {"kind": "review-exchange-original", "issueId": issue["id"]})


def _result(value, issue, return_id=None):
    return {"schema": RESULT, "requestId": value["requestId"], "action": value["action"], "issueId": issue["id"],
            "returnId": return_id, "cycleId": issue["cycle"]["id"], "files": [], "adopted": []}


def _native_completion(domain, value, issue, edition, ident, case, selected):
    done = selected["completion"]
    if done["disposition"] is None:
        return None
    state = cycles.replay(domain)[issue["cycle"]["id"]]
    # This is an observation after the original case writer has saved its real
    # time.time() timestamp. The caller's supplied time remains in exchange.request.
    observed = time.time()
    need(observed >= case["updatedAt"] and observed >= cycles.instant(state["updatedAt"]) and
         observed >= cycles.instant(edition["at"]), "Actual clock precedes the saved decision or review")
    import math
    at = datetime.fromtimestamp(math.ceil(observed * 1000000) / 1000000, timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")
    body = {"caseId": ident, "caseRevision": case["revision"], "disposition": done["disposition"],
            "note": done["note"], "evidence": done["evidence"]}
    if issue["cycle"]["sourceKind"] == "portfolio_refresh":
        body["portfolioReviewRequestId"] = done["portfolioReviewRequestId"]
    command_value = {"requestId": str(uuid.uuid5(uuid.UUID(value["requestId"]), "review-exchange-completion:" + ident)),
                     "cycleId": issue["cycle"]["id"], "expectedVersion": state["version"], "action": "complete",
                     "actor": copy.deepcopy(edition["actor"]), "at": at, "body": body}
    return cycles.command(domain, command_value, _commit=False)


def command(domain, value):
    """One original request; case/cycle/exchange SQL share one transaction."""
    value = load_json(json_bytes(value)); _envelope(value)
    ident = event_id(value["requestId"])
    with domain.mutex:
        events = _read_events(domain)
        old = next((e for e in events if e["id"] == ident), None)
        if old is not None:
            need(stable(old["request"]) == stable(value), "This original request UUID has different complete command bytes")
            verify_all(domain, through_request_id=value["requestId"])
            return copy.deepcopy(old["result"])
        need(not domain.db.in_transaction, "Exchange command owns one original SQLite transaction")
        need(len(events) < MAX_EVENTS, "Complete reviewer exchange history exceeds 50,000 operations")
        need(cycles.instant(value["at"]) <= time.time() + 1, "Exchange request time cannot be in the future")
        issues, returns = _indices(events)
        observations = {}
        with domain.db:
            domain.db.execute("BEGIN IMMEDIATE")
            action, body = value["action"], value["body"]
            if action == "issue":
                issued_raw = _object(domain, body["issued"])
                html_raw = _object(domain, body["html"])
                issue = _validate_issue(domain, issued_raw, current=True)
                need(issue["requestId"] == value["requestId"] and stable(issue["issuer"]) == stable(value["actor"]) and
                     issue["issuedAt"] == value["at"], "Issued request identity/actor/time differs")
                initial, parsed_issue, html_issued = _validate_return(domain, html_raw)
                need(stable(initial) == stable(initial_return(issued_raw)) and html_issued == issued_raw and
                     parsed_issue["id"] == issue["id"], "Issued HTML must contain the exact untouched initial reviewer copy")
                need(issue["id"] not in issues, "This original issued review already exists")
                _retain_document_files(domain, issue)
                result = _result(value, issue)
                result["files"] = [_descriptor(issued_raw, "Source_Review_Issued.json", "application/json", "issued_json"),
                                   _descriptor(html_raw, "Source_Review_Reviewer_Copy.html", "text/html", "issued_html")]
                observations = {"issueRequest": _prepare_from_issue(issue)}
            elif action == "receive":
                raw = _object(domain, body["file"])
                _descriptor(raw, body["file"]["name"], body["file"]["mediaType"])
                returned, issue, issued_raw = _validate_return(domain, raw)
                need(issue["id"] in issues and _issue_original(domain, issues[issue["id"]]) == issued_raw,
                     "Return must carry the exact original locally issued review bytes")
                need(cycles.instant(value["at"]) >= cycles.instant(issue["issuedAt"]), "Receiving precedes the original issue")
                need(all(cycles.instant(e["at"]) <= cycles.instant(value["at"]) for e in returned["editions"]),
                     "Receiving time precedes a saved reviewer edition")
                _retain_document_files(domain, issue, returned)
                result = _result(value, issue, sha(raw))
                result["files"] = [dict(body["file"], role="returned_file")]
                result.update({"workingCopyId": returned["workingCopyId"], "selectedEditionId": returned["selectedEditionId"],
                               "editions": [{k: e[k] for k in ("id", "parent", "name", "actor", "at")} for e in returned["editions"]],
                               "draftPresent": returned["draft"] is not None})
                observations = {"issuedSha256": sha(issued_raw)}
            else:
                need(body["returnId"] in returns, "Select a retained returned file before adoption")
                comparison, returned, issue, edition = _comparison(domain, returns[body["returnId"]], body["editionId"])
                need(body["reviewSha256"] == comparison["reviewSha256"] and
                     body["expectedCycleVersion"] == comparison["cycle"]["version"] and
                     stable(body["expectedCases"]) == stable(comparison["expectedCases"]),
                     "The displayed comparison changed; review the current complete comparison before a new request")
                state = cycles.replay(domain)[issue["cycle"]["id"]]
                need(value["actor"]["id"] in {state["supervisor"]["id"], issue["reviewer"]["id"]},
                     "The selected supervisor or assigned reviewer adopts this return")
                need(cycles.instant(value["at"]) >= cycles.instant(edition["at"]), "Adoption request precedes the named reviewer edition")
                selected = _selected_values(comparison, body["choices"])
                result = _result(value, issue, body["returnId"])
                observations = {"comparison": comparison, "editionActor": edition["actor"], "decisions": []}
                for row in comparison["rows"]:
                    case_id = row["caseId"]
                    if case_id not in selected:
                        continue
                    proposed, current = selected[case_id], row["currentCase"]
                    # Complete existing evidence remains valid when the current side
                    # supplied it; returned additions must already have been retained.
                    evidence_ids = set(f["sha256"] for f in issue["files"] + returned["files"]) | set(proposed["completion"]["evidence"])
                    for evidence in proposed["completion"]["evidence"]:
                        domain.object_path(evidence)
                    _validate_values(proposed, issue["items"][case_id], issue, evidence_ids)
                    decision_fields = tuple(k for k in FIELDS if k != "completion")
                    changed = any(stable(proposed[k]) != stable(row["current"][k]) for k in decision_fields)
                    case = current
                    if changed:
                        case = domain._save_case(portfolio_id=current["portfolio"], counterparty_id=current["counterpartyId"],
                            candidate_id=proposed["candidateId"], edition_id=proposed["editionId"],
                            resolution=proposed["resolution"], relevance=proposed["relevance"], reason=proposed["reason"],
                            reviewer=edition["actor"]["name"], match_request=current.get("matchRequest"), case_id=case_id,
                            expected=current["revision"], monitoring=proposed["monitoring"], _commit=False)
                    completion = _native_completion(domain, value, issue, edition, case_id, case, proposed)
                    result["adopted"].append({"caseId": case_id, "beforeRevision": current["revision"],
                                              "caseRevision": case["revision"], "cycleResult": completion})
                    observations["decisions"].append({"caseId": case_id, "values": proposed,
                                                      "beforeEvent": cycles.case_event(domain, current["revision"]),
                                                      "afterEvent": cycles.case_event(domain, case["revision"])})
            event = {"schema": EVENT, "id": ident, "sequence": len(events) + 1, "request": value,
                     "inputSha256": sha(json_bytes(value)), "observations": observations, "result": result}
            event["sha256"] = sha(json_bytes(event))
            # Keep a committed original result and its full historical comparison
            # readable through the maintained 128 MiB client JSON boundary. This
            # check is inside the same transaction, before any association commits.
            _view_bound({"requestId": value["requestId"], "committed": True, "event": event})
            if action == "apply":
                current_state = cycles.replay(domain)[issue["cycle"]["id"]]
                _view_bound({"readOnly": True, "event": event, "comparison": observations["comparison"],
                             "current": {"cycleVersion": current_state["version"], "cycleRevision": current_state["revision"],
                                         "cases": {case_id: domain._one("cases", case_id)["revision"]
                                                   for case_id in observations["comparison"]["expectedCases"]}}})
            domain.db.execute("INSERT INTO os_exchange_events(id,body) VALUES(?,?)", (ident, json_bytes(event).decode()))
        return copy.deepcopy(result)


def request(domain, ident):
    ident = uid(ident)
    with domain.mutex:
        events = _read_events(domain)
        event = next((e for e in events if e["request"]["requestId"] == ident), None)
        if event is not None:
            verify_all(domain, through_request_id=ident)
        return _view_bound({"requestId": ident, "committed": event is not None, "event": event})


def _file_rows(domain, ident, events=None):
    events = _read_events(domain) if events is None else events
    issues, returns = _indices(events)
    if ident in issues:
        return issues[ident]["result"]["files"]
    need(ident in returns, "Select an issued or returned review record")
    return returns[ident]["result"]["files"]


def document(domain, ident, role):
    with domain.mutex:
        exact_id(ident)
        files = _file_rows(domain, ident)
        descriptor = next((f for f in files if f["role"] == role), None)
        need(descriptor is not None, "Select an original file role from this retained record")
        return {"bytes": _object(domain, descriptor), "descriptor": descriptor}



def _metadata_document(value, returned=False):
    result = copy.deepcopy(value)
    result["files"] = [{k: v for k, v in f.items() if k != "base64"} for f in result["files"]]
    if returned:
        result["issued"] = {k: v for k, v in result["issued"].items() if k != "base64"}
    return result


def _view_bound(value):
    need(len(json_bytes(value)) <= 128 * 1024 * 1024,
         "Complete review metadata exceeds the original 128 MiB JSON response; retain exact documents and select a smaller explicit assignment")
    return value

def view(domain, ident=None, offset=0, limit=50):
    need(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 250, "Use a bounded complete review page")
    with domain.mutex:
        events = _read_events(domain)
        issues, returns = _indices(events)
        if ident is None:
            rows = [{"id": e["result"]["returnId"] or e["result"]["issueId"],
                     "requestId": e["request"]["requestId"], "action": e["request"]["action"],
                     "at": e["request"]["at"], "actor": e["request"]["actor"], "sequence": e["sequence"],
                     "issueId": e["result"]["issueId"], "returnId": e["result"]["returnId"],
                     "cycleId": e["result"]["cycleId"], "adopted": len(e["result"]["adopted"])}
                    for e in reversed(events)]
            return {"rows": rows[offset:offset + limit], "total": len(rows), "offset": offset,
                    "nextOffset": offset + limit if offset + limit < len(rows) else None}
        exact_id(ident)
        if ident in issues:
            issue = _validate_issue(domain, _issue_original(domain, issues[ident]))
            relevant = [e for e in events if e["result"]["issueId"] == ident]
            return _view_bound({"id": ident, "kind": "issue", "issue": _metadata_document(issue),
                    "files": issues[ident]["result"]["files"], "requests": [e["request"]["requestId"] for e in relevant],
                    "returns": [e["result"] for e in relevant if e["request"]["action"] == "receive"]})
        need(ident in returns, "Select a retained exchange record")
        event = returns[ident]
        returned, issue, _ = _validate_return(domain, _return_original(domain, event))
        return _view_bound({"id": ident, "kind": "return", "issueId": issue["id"], "return": _metadata_document(returned, True), "issue": _metadata_document(issue),
                "files": event["result"]["files"],
                "adoptions": [e["result"] for e in events if e["request"]["action"] == "apply" and e["result"]["returnId"] == ident]})


def _verify_retained_files(domain, issue, returned=None):
    for file in list(issue["files"]) + (list(returned["files"]) if returned is not None else []):
        raw = _file(file, "origins" in file)
        need(_object(domain, file) == raw, "Complete exchange evidence is missing from the original object collection")


def _verify_case_result(domain, before, after, proposed, reviewer):
    fields = tuple(k for k in FIELDS if k != "completion")
    before_values = {**{k: before[k] for k in fields if k != "editionId"}, "editionId": before["edition"]}
    changed = any(stable(proposed[k]) != stable(before_values[k]) for k in fields)
    if not changed:
        need(stable(after) == stable(before), "An unchanged original decision must preserve its exact case revision")
        return
    request_id = before.get("matchRequest")
    if request_id:
        original = domain._one("requests", request_id)
        need(original.get("state") == "RECEIVED" and original.get("portfolio") == before["portfolio"],
             "Adopted case lost its original received match request")
        candidates = (original.get("response") or {}).get("summary", {}).get("candidates", {}).get(before["counterpartyId"], [])
        need(proposed["candidateId"] in candidates, "Adopted candidate was not returned for this original counterparty")
    portfolio = domain._one("portfolios", before["portfolio"])
    domain.entity(before["portfolio"], before["counterpartyId"])
    edition = domain._one("editions", proposed["editionId"])
    expected = {"id": before["id"], "portfolioKey": portfolio["key"], "portfolio": before["portfolio"],
                "counterpartyId": before["counterpartyId"], "candidateId": proposed["candidateId"], "edition": proposed["editionId"],
                "dataset": edition["dataset"],
                "resolvedCurrentIds": sorted({r["canonical"] for r in domain.aliases(proposed["editionId"], proposed["candidateId"])}),
                "resolution": proposed["resolution"], "relevance": proposed["relevance"], "reason": proposed["reason"],
                "reviewer": reviewer, "matchRequest": request_id, "monitoring": proposed["monitoring"],
                "previousRevision": before["revision"], "updatedAt": after["updatedAt"]}
    need(type(after["updatedAt"]) in (int, float) and after["updatedAt"] >= before["updatedAt"],
         "Adopted case observation time precedes its original predecessor")
    expected["revision"] = sha(json_bytes(expected))
    need(stable(expected) == stable(after), "Adopted case differs from the original native writer's full contract")


def verify_all(domain, *, through_request_id=None):
    """Validate complete received evidence and replay every exchange association.

    The original cycle replay and original case events remain authoritative.
    No case is rewritten and no provider or reviewer operation is dispatched.
    """
    with domain.mutex:
        events = _read_events(domain)
        if through_request_id is not None:
            through_request_id = uid(through_request_id)
            boundary = next((i for i, e in enumerate(events) if e["request"]["requestId"] == through_request_id), None)
            need(boundary is not None, "The retained original request is absent")
            events = events[:boundary + 1]
        issues, returns = {}, {}
        for event in events:
            request_value, observed = event["request"], event["observations"]
            body, action = request_value["body"], request_value["action"]
            if action == "issue":
                keys(observed, ("issueRequest",), "Issue observations")
                raw = _object(domain, body["issued"]); html_raw = _object(domain, body["html"])
                issue = _validate_issue(domain, raw)
                need(issue["id"] not in issues and issue["requestId"] == request_value["requestId"] and
                     stable(issue["issuer"]) == stable(request_value["actor"]) and issue["issuedAt"] == request_value["at"] and
                     stable(observed["issueRequest"]) == stable(_prepare_from_issue(issue)), "Issued request/history binding differs")
                returned, html_issue, embedded = _validate_return(domain, html_raw)
                need(embedded == raw and html_issue["id"] == issue["id"] and
                     stable(returned) == stable(initial_return(raw)), "Original issued HTML/JSON pair differs")
                _verify_retained_files(domain, issue)
                result = _result(request_value, issue)
                result["files"] = [_descriptor(raw, "Source_Review_Issued.json", "application/json", "issued_json"),
                                   _descriptor(html_raw, "Source_Review_Reviewer_Copy.html", "text/html", "issued_html")]
                issues[issue["id"]] = event
            elif action == "receive":
                keys(observed, ("issuedSha256",), "Return observations")
                raw = _object(domain, body["file"])
                _descriptor(raw, body["file"]["name"], body["file"]["mediaType"])
                returned, issue, issued_raw = _validate_return(domain, raw)
                need(issue["id"] in issues and _issue_original(domain, issues[issue["id"]]) == issued_raw and
                     observed["issuedSha256"] == sha(issued_raw), "Return has no exact earlier original issue")
                need(cycles.instant(request_value["at"]) >= cycles.instant(issue["issuedAt"]) and
                     all(cycles.instant(e["at"]) <= cycles.instant(request_value["at"]) for e in returned["editions"]),
                     "Returned edition chronology differs")
                _verify_retained_files(domain, issue, returned)
                result = _result(request_value, issue, sha(raw))
                result["files"] = [dict(body["file"], role="returned_file")]
                result.update({"workingCopyId": returned["workingCopyId"], "selectedEditionId": returned["selectedEditionId"],
                               "editions": [{k: e[k] for k in ("id", "parent", "name", "actor", "at")} for e in returned["editions"]],
                               "draftPresent": returned["draft"] is not None})
                previous = returns.get(sha(raw))
                need(previous is None or previous["result"]["issueId"] == issue["id"], "Returned file identity changed issue")
                returns.setdefault(sha(raw), event)
            else:
                keys(observed, ("comparison", "editionActor", "decisions"), "Adoption observations")
                need(body["returnId"] in returns, "Adoption precedes its complete returned file")
                returned_event = returns[body["returnId"]]
                comparison = observed["comparison"]
                state = _cycle_at(domain, comparison["cycle"]["id"], comparison["cycle"]["version"])
                current_cases = {}
                for row in comparison["rows"]:
                    case = cycles.case_event(domain, row["currentCase"]["revision"])["value"]
                    need(stable(case) == stable(row["currentCase"]), "Historical comparison changed its native case")
                    current_cases[row["caseId"]] = case
                expected, returned, issue, edition = _comparison(domain, returned_event, body["editionId"], state, current_cases)
                need(stable(expected) == stable(comparison) and body["reviewSha256"] == comparison["reviewSha256"] and
                     body["expectedCycleVersion"] == state["version"] and stable(body["expectedCases"]) == stable(comparison["expectedCases"]),
                     "Historical adoption is not bound to its complete original comparison")
                need(request_value["actor"]["id"] in {state["supervisor"]["id"], issue["reviewer"]["id"]} and
                     stable(observed["editionActor"]) == stable(edition["actor"]) and
                     cycles.instant(request_value["at"]) >= cycles.instant(edition["at"]),
                     "Historical adoption attribution or chronology differs")
                selected = _selected_values(comparison, body["choices"])
                decisions = observed["decisions"]
                need(isinstance(decisions, list) and [d["caseId"] for d in decisions] ==
                     [i for i in issue["caseOrder"] if i in selected], "Adoption must retain every selected case decision in original order")
                result = _result(request_value, issue, body["returnId"])
                cycle_version = state["version"]
                evidence_ids = {f["sha256"] for f in issue["files"] + returned["files"]}
                for decision in decisions:
                    keys(decision, ("caseId", "values", "beforeEvent", "afterEvent"), "Adopted decision")
                    ident = decision["caseId"]; proposed = selected[ident]
                    need(stable(decision["values"]) == stable(proposed), "Adopted values differ from displayed conflict choices")
                    before_event = cycles.case_event(domain, decision["beforeEvent"]["id"])
                    after_event = cycles.case_event(domain, decision["afterEvent"]["id"])
                    need(stable(before_event) == stable(decision["beforeEvent"]) and
                         stable(after_event) == stable(decision["afterEvent"]) and
                         stable(before_event["value"]) == stable(current_cases[ident]), "Adoption lost exact original case history")
                    for evidence in proposed["completion"]["evidence"]:
                        domain.object_path(evidence)
                    _validate_values(proposed, issue["items"][ident], issue,
                                     evidence_ids | set(proposed["completion"]["evidence"]))
                    _verify_case_result(domain, before_event["value"], after_event["value"], proposed, edition["actor"]["name"])
                    completion = None
                    done = proposed["completion"]
                    if done["disposition"] is not None:
                        native_id = str(uuid.uuid5(uuid.UUID(request_value["requestId"]), "review-exchange-completion:" + ident))
                        native = cycles.request(domain, native_id)
                        need(native["committed"], "Adopted completion lacks its original cycle command")
                        cycle_event = native["event"]; native_request = cycle_event["command"]
                        native_body = {"caseId": ident, "caseRevision": after_event["value"]["revision"],
                                       "disposition": done["disposition"], "note": done["note"], "evidence": done["evidence"]}
                        if issue["cycle"]["sourceKind"] == "portfolio_refresh":
                            native_body["portfolioReviewRequestId"] = done["portfolioReviewRequestId"]
                        need(native_request["requestId"] == native_id and native_request["action"] == "complete" and
                             native_request["cycleId"] == issue["cycle"]["id"] and native_request["expectedVersion"] == cycle_version and
                             stable(native_request["actor"]) == stable(edition["actor"]) and stable(native_request["body"]) == stable(native_body) and
                             cycles.instant(native_request["at"]) >= cycles.instant(edition["at"]) and
                             cycles.instant(native_request["at"]) >= after_event["value"]["updatedAt"],
                             "Original cycle completion differs from adopted case/evidence")
                        completion = cycle_event["result"]; cycle_version += 1
                    result["adopted"].append({"caseId": ident, "beforeRevision": before_event["value"]["revision"],
                                              "caseRevision": after_event["value"]["revision"], "cycleResult": completion})
            need(stable(result) == stable(event["result"]), "Original exchange result differs on full replay")
            _view_bound({"requestId": request_value["requestId"], "committed": True, "event": event})
            if action == "apply":
                observed_state = _cycle_at(domain, issue["cycle"]["id"], cycle_version)
                after_cases = {ident: case["revision"] for ident, case in current_cases.items()}
                after_cases.update({decision["caseId"]: decision["afterEvent"]["value"]["revision"]
                                    for decision in decisions})
                _view_bound({"readOnly": True, "event": event, "comparison": comparison,
                             "current": {"cycleVersion": observed_state["version"], "cycleRevision": observed_state["revision"],
                                         "cases": after_cases}})
        return {"schema": EVENT, "events": len(events), "issues": len(issues), "returns": len(returns)}

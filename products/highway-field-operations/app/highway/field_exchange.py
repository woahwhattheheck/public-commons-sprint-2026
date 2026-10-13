"""Complete named field-copy issue, return review and original inspection adoption.

Pure functions; the original Workspace owns bytes, request replay and atomic CAS.
No provider writes, replacement inspection model, or secondary persistence.
"""
from __future__ import annotations
import base64
import copy
import re
from . import domain as D
from .common import canonical, loads, sha, MAX_BLOB

ISSUE = "geocove.highway-field-issue.v1"
RETURN = "geocove.highway-field-return.v1"
STATE = "geocove.highway-field-exchange.v1"
MAX_ITEMS = 1000
MAX_EDITIONS = 1000
MAX_DRAFT = 4 * 1024 * 1024
MAX_DOCUMENT = MAX_BLOB
MAX_TOTAL = 256 * 1024 * 1024

def _need(ok, code, message, details=None):
    D._need(ok, "field_" + code, message, details)

def _exact(value, keys, label):
    _need(isinstance(value, dict) and set(value) == set(keys),
          "shape", label + " needs its complete original fields.")

def _list(value, label, maximum, minimum=0):
    _need(isinstance(value, list) and minimum <= len(value) <= maximum,
          "capacity", label + " count is outside its complete-file allowance.")
    return value

def _actor(value):
    _exact(value, ("id", "name"), "Named operator")
    return D._actor(value)

def _ref(value):
    _exact(value, ("sha256", "bytes"), "Original document reference")
    _need(isinstance(value["sha256"], str) and
          re.fullmatch(r"[0-9a-f]{64}", value["sha256"]) is not None,
          "identity", "A complete original SHA-256 is required.")
    D._integer(value["bytes"], "Document bytes", 1, MAX_DOCUMENT)
    return value

def _raw(ref, read_blob):
    _ref(ref)
    data = read_blob(ref["sha256"])
    _need(isinstance(data, bytes) and len(data) == ref["bytes"] and
          sha(data) == ref["sha256"], "bytes", "Original document bytes differ.")
    return data

def _binary(value):
    _exact(value, ("sha256", "bytes", "base64"), "Complete original byte member")
    ref = {k: value[k] for k in ("sha256", "bytes")}
    _need(isinstance(ref["sha256"], str) and
          re.fullmatch(r"[0-9a-f]{64}", ref["sha256"]) is not None,
          "identity", "Original byte member identity is invalid.")
    D._integer(ref["bytes"], "Member bytes", 0, MAX_BLOB)
    _need(isinstance(value["base64"], str) and
          len(value["base64"]) <= ((MAX_BLOB + 2) // 3) * 4,
          "capacity", "Complete original byte member exceeds its allowance.")
    try:
        data = base64.b64decode(value["base64"], validate=True)
    except (ValueError, TypeError) as exc:
        raise D.DomainError("field_base64", "Original bytes are not complete Base64.") from exc
    _need(len(data) == ref["bytes"] and sha(data) == ref["sha256"],
          "bytes", "Complete original byte member does not match its identity.")
    return data

def _blob_map(rows):
    _list(rows, "Original byte members", 20000)
    out = {}
    total = 0
    for item in rows:
        data = _binary(item)
        _need(item["sha256"] not in out, "duplicate_blob", "Byte inventory repeats an identity.")
        total += len(data)
        _need(total <= MAX_TOTAL, "capacity", "The complete byte population exceeds its allowance.")
        out[item["sha256"]] = data
    return out

def _encode_blobs(data):
    return [{"sha256": key, "bytes": len(value),
             "base64": base64.b64encode(value).decode("ascii")}
            for key, value in sorted(data.items())]

def _plain(raw):
    _need(isinstance(raw, bytes) and 0 < len(raw) <= MAX_DOCUMENT,
          "capacity", "Read the complete field document within its allowance.")
    try:
        return loads(raw)
    except (ValueError, UnicodeError):
        raise D.DomainError("field_json", "Field document is not complete UTF-8 JSON.")

def parse_document(raw):
    """Read full JSON or the one inert JSON payload in its complete HTML export."""
    _need(isinstance(raw, bytes) and 0 < len(raw) <= MAX_DOCUMENT,
          "capacity", "Read the complete field document within its allowance.")
    if raw.lstrip().startswith(b"{"):
        return _plain(raw)
    try:
        text = raw.decode("utf-8")
    except UnicodeError as exc:
        raise D.DomainError("field_utf8", "Field HTML is not complete UTF-8.") from exc
    matches = list(re.finditer(r'<script\b(?P<attrs>[^>]*)>(?P<body>.*?)</script\s*>',
                              text, re.I | re.S))
    bodies = []
    for match in matches:
        attrs = match.group("attrs")
        if re.search(r'\bid\s*=\s*(["\x27])highway-field-data\1', attrs, re.I):
            _need(re.search(r'\btype\s*=\s*(["\x27])application/json\1', attrs, re.I),
                  "html", "Field payload must be inert application/json.")
            bodies.append(match.group("body"))
    _need(len(bodies) == 1, "html", "Choose the whole exported field file with one original data payload.")
    return _plain(bodies[0].encode("utf-8"))

def _collection(state):
    value = state.get("fieldExchange")
    if value is None:
        return {"schema": STATE, "issues": [], "returns": [], "adoptions": []}
    _exact(value, ("schema", "issues", "returns", "adoptions"), "Field exchange history")
    _need(value["schema"] == STATE, "schema", "Unsupported field exchange history.")
    for key in ("issues", "returns", "adoptions"):
        _list(value[key], key, 10000)
        _need(all(isinstance(row, dict) and isinstance(row.get("id"), str)
                  for row in value[key]), "history", "Field history contains an invalid record.")
        _need(len({row["id"] for row in value[key]}) == len(value[key]),
              "history", "Field history repeats a record identity.")
    return value

def _find(state, kind, identity):
    row = next((row for row in _collection(state)[kind] if row["id"] == identity), None)
    _need(row is not None, "missing", "Choose a retained field " + kind + " record.")
    return row

def _read_issue(state, identity, read_blob):
    row = _find(state, "issues", identity)
    value = _plain(_raw(row["document"], read_blob))
    _need(value.get("schema") == ISSUE and value.get("id") == identity and
          value.get("workspaceId") == state["id"],
          "issue", "Issued document differs from its original workspace.")
    return row, value

def prepare_issue(state, request, read_blob):
    """Prepare the complete selected issue; caller stores bytes before field.issue."""
    _exact(request, ("id", "recipient", "inspectionIds", "workspaceRevision",
                     "stateSha256", "note", "actor", "at"), "Field issue preparation")
    D._id(request["id"], "Field issue ID")
    _actor(request["recipient"])
    _actor(request["actor"])
    D._time(request["at"])
    _need(D._time(request["at"]) >= D._time(state["updatedAt"]),
          "time", "Field issue precedes its selected saved workspace edition.")
    D._integer(request["workspaceRevision"], "Selected workspace revision", 0, 10000)
    _need(request["stateSha256"] == D.digest(state),
          "stale_issue", "The workspace changed before preparing this field copy.")
    D._text(request["note"], "Field instructions", 30000, empty=True)
    wanted = _list(request["inspectionIds"], "Selected inspections", MAX_ITEMS, 1)
    _need(all(isinstance(i, str) for i in wanted) and len(set(wanted)) == len(wanted),
          "selection", "Select each actual inspection once.")
    source = D.Source(read_blob)
    items = []
    capture_ids = set()
    field = state.get("dispatch") or {}
    for iid in wanted:
        item = D.inspection_view(state, iid, read_blob)
        inspection = item["inspection"]
        for version in inspection["versions"]:
            capture_ids.add(version["binding"]["captureId"])
            capture_ids.add(D._form(state, version["formId"])["captureId"])
            for attachment in version["attachments"]:
                source.raw({"sha256": attachment["sha256"], "bytes": attachment["bytes"],
                            "path": "local/" + attachment["id"] + "/" + attachment["name"],
                            "mediaType": attachment["mediaType"]})
        assignment = field.get("assignments", {}).get(inspection.get("assignmentId"))
        item["assignment"] = copy.deepcopy(assignment)
        item["crew"] = copy.deepcopy(field.get("crews", {}).get(assignment.get("crewId"))) if assignment else None
        item["package"] = copy.deepcopy(field.get("packages", {}).get(assignment.get("packageId"))) if assignment else None
        # Prior form editions travel with the original inspection history.
        item["forms"] = [copy.deepcopy(f) for f in state["forms"]
                         if f["key"] == item["form"]["key"]]
        for form in item["forms"]:
            capture_ids.add(form["captureId"])
        for proposal in item["proposals"]:
            capture_ids.add(proposal["captureId"])
            for candidate in proposal["candidates"]:
                capture_ids.add(candidate["source"]["captureId"])
                for attachment in candidate["attachmentAdds"]:
                    source.raw({"sha256": attachment["sha256"], "bytes": attachment["bytes"],
                                "path": "local/" + attachment["id"] + "/" + attachment["name"],
                                "mediaType": attachment["mediaType"]})
        items.append(item)
    captures = [copy.deepcopy(c) for c in state["captures"] if c["id"] in capture_ids]
    _need(len(captures) == len(capture_ids), "source", "A selected original capture is absent.")
    for capture in captures:
        D._validate_manifest(capture["manifest"], source)
    value = {"schema": ISSUE, "id": request["id"], "workspaceId": state["id"],
             "title": state["title"], **copy.deepcopy({k: v for k, v in request.items() if k != "id"}),
             "items": items, "captures": captures, "blobs": _encode_blobs(source.raw_cache)}
    _need(len(canonical(value)) <= MAX_DOCUMENT, "capacity",
          "The complete selected field copy exceeds 64 MiB. Select fewer inspections/source captures without truncating them.")
    return value

def _editable(item):
    value = item["version"]
    return {"inspectionId": item["inspection"]["id"],
            **{k: copy.deepcopy(value[k]) for k in ("answers", "geometry", "attachments", "note")}}

def initial_return(issue_raw):
    """Original issue bytes are retained exactly, independently of browser numbers."""
    issue = _plain(issue_raw)
    _need(issue.get("schema") == ISSUE, "issue", "Choose the original field issue.")
    result = {"schema": RETURN, "issueId": issue["id"],
            "issued": {"sha256": sha(issue_raw), "bytes": len(issue_raw),
                       "base64": base64.b64encode(issue_raw).decode("ascii")},
            "editions": [], "selectedEditionId": None,
            "draft": {"items": [_editable(item) for item in issue["items"]]},
            "blobs": []}
    _need(len(canonical(result["draft"])) <= MAX_DRAFT, "draft_capacity",
          "The complete starting field draft exceeds 4 MiB. Select fewer complete inspections for this issue.")
    _need(len(canonical(result)) <= MAX_DOCUMENT, "capacity",
          "The complete initial return exceeds 64 MiB. Select fewer complete inspections for this issue.")
    return result

def _return_document(state, issue_row, raw, read_blob):
    value = parse_document(raw)
    _exact(value, ("schema", "issueId", "issued", "editions",
                   "selectedEditionId", "draft", "blobs"), "Complete returned field document")
    _need(value["schema"] == RETURN and value["issueId"] == issue_row["id"],
          "return", "Returned file belongs to another field issue.")
    issue_raw = _binary(value["issued"])
    _need({k: value["issued"][k] for k in ("sha256", "bytes")} == issue_row["document"] and
          issue_raw == _raw(issue_row["document"], read_blob),
          "issue_changed", "Returned file must carry the exact originally issued bytes.")
    issue = _plain(issue_raw)
    _need(issue.get("schema") == ISSUE and issue.get("workspaceId") == state["id"],
          "issue", "Returned original issue belongs to another workspace.")
    blobs = _blob_map(issue["blobs"])
    additions = _blob_map(value["blobs"])
    for key, data in additions.items():
        _need(key not in blobs or blobs[key] == data, "blob_collision", "Returned source identity differs.")
        blobs[key] = data
    _need(sum(map(len, blobs.values())) <= MAX_TOTAL, "capacity", "Complete field source bytes exceed capacity.")
    def reader(key):
        _need(key in blobs, "attachment_missing", "The returned file omits an original attachment.", {"sha256": key})
        return blobs[key]
    source = D.Source(reader)
    baseline = {item["inspection"]["id"]: item for item in issue["items"]}
    captures = {"captures": issue["captures"], "activeCaptureId": None}
    editions = _list(value["editions"], "Named field editions", MAX_EDITIONS, 0)
    seen = set()
    previous = None
    previous_time = D._time(issue["at"])
    for edition in editions:
        _exact(edition, ("id", "parentId", "label", "actor", "at", "items"), "Named field edition")
        D._id(edition["id"], "Field edition ID")
        _need(edition["id"] not in seen and edition["parentId"] == previous,
              "edition_history", "Named editions must retain their complete ordered parent history.")
        seen.add(edition["id"])
        previous = edition["id"]
        _actor(edition["actor"])
        D._text(edition["label"], "Edition label", 300)
        at = D._time(edition["at"])
        _need(at >= previous_time, "time", "A field edition precedes its original issue or parent edition.")
        previous_time = at
        rows = _list(edition["items"], "Complete field edition items", MAX_ITEMS, 1)
        _need(len(rows) == len(baseline) and
              {row.get("inspectionId") for row in rows if isinstance(row, dict)} == set(baseline),
              "selection", "Every named edition must preserve every issued inspection exactly once.")
        for row in rows:
            _exact(row, ("inspectionId", "answers", "geometry", "attachments", "note"), "Returned inspection")
            original = baseline[row["inspectionId"]]
            version, form = original["version"], original["form"]
            binding = version["binding"]
            dataset = source.dataset(D._capture(captures, binding["captureId"]), binding["layerId"])
            normalized = D._answers(form, row["answers"], binding, dataset)
            _need(D._same(normalized, row["answers"]), "answers",
                  "Save all complete typed answers before naming the field edition.")
            D._text(row["note"], "Field note", 30000, empty=True)
            if not D._same(row["geometry"], binding["feature"].get("geometry")):
                _need(form["geometryEditable"], "geometry", "This form retains original geometry.")
                D._geometry(row["geometry"], dataset["metadata"])
            _need(D._same(D._attachments(form, row["attachments"], source), row["attachments"]),
                  "attachments", "Returned attachment descriptors differ from their original bytes.")
    _need((value["selectedEditionId"] in seen) if editions else value["selectedEditionId"] is None,
          "edition", "Select an actual saved named edition; an unfinished copy has no selected edition.")
    _need(isinstance(value["draft"], dict) and len(canonical(value["draft"])) <= MAX_DRAFT,
          "draft", "Preserve unfinished form text as a complete draft within 4 MiB.")
    return value, issue, blobs

def prepare_return(state, raw, read_blob):
    """Validate every original field edition/member before native blob retention."""
    parsed = parse_document(raw)
    _need(isinstance(parsed, dict), "return", "Choose a complete returned field document.")
    issue_row = _find(state, "issues", parsed.get("issueId"))
    value, issue, blobs = _return_document(state, issue_row, raw, read_blob)
    return {"document": value, "issue": issue, "blobs": blobs}

def read_document(state, kind, identity, read_blob):
    """Return the complete original issue/return document and its exact descriptor."""
    _need(kind in ("issues", "returns"), "kind", "Choose issues or returns.")
    row = _find(state, kind, identity)
    raw = _raw(row["document"], read_blob)
    return {"record": copy.deepcopy(row), "document": parse_document(raw)}

def _comparison(state, return_row, read_blob, edition_id=None):
    issue_row = _find(state, "issues", return_row["issueId"])
    value, issue, blobs = _return_document(state, issue_row,
                                          _raw(return_row["document"], read_blob), read_blob)
    chosen = value["selectedEditionId"] if edition_id is None else edition_id
    selected = next((e for e in value["editions"] if e["id"] == chosen), None)
    _need(selected is not None, "edition", "Select an actual named edition retained in this returned file.")
    returned = {r["inspectionId"]: r for r in selected["items"]}
    items = []
    for original in issue["items"]:
        iid = original["inspection"]["id"]
        current = D._inspection(state, iid)
        version = D._version(current)
        before = original["version"]
        incoming = returned[iid]
        same_source = (version["formId"] == before["formId"] and
                       version["formRevision"] == before["formRevision"] and
                       D._same(version["binding"], before["binding"]))
        fields = []
        triples = [("answer:" + f["key"], f["label"],
                    before["answers"].get(f["key"]), version["answers"].get(f["key"]),
                    incoming["answers"].get(f["key"])) for f in original["form"]["fields"]]
        triples += [("$geometry", "Geometry", before["geometry"], version["geometry"], incoming["geometry"]),
                    ("$attachments", "Complete added attachments", before["attachments"],
                     version["attachments"], incoming["attachments"]),
                    ("$note", "Field note", before["note"], version["note"], incoming["note"])]
        for key, label, base, now, proposed in triples:
            changed = not D._same(proposed, base)
            current_changed = not D._same(now, base)
            conflict = changed and current_changed and not D._same(now, proposed)
            recommended = proposed if changed and not conflict else now
            fields.append({"key": key, "label": label, "issued": copy.deepcopy(base),
                           "current": copy.deepcopy(now), "returned": copy.deepcopy(proposed),
                           "returnedChanged": changed, "currentChanged": current_changed,
                           "conflict": conflict, "proposed": copy.deepcopy(recommended)})
        items.append({"inspectionId": iid, "issuedVersion": before["number"],
                      "currentVersion": version["number"], "currentSha256": version["sha256"],
                      "currentStatus": version["status"], "sameSource": same_source,
                      "sourceMessage": "" if same_source else
                      "The form/source binding advanced. Keep this return as evidence and issue the current form; do not apply old-schema answers.",
                      "assignment": copy.deepcopy(original["assignment"]),
                      "currentAssignment": copy.deepcopy((state.get("dispatch") or {}).get("assignments", {}).get(current.get("assignmentId"))),
                      "fields": fields, "conflicts": [f["key"] for f in fields if f["conflict"]],
                      "sourceAssessment": D._assessment(state, current, D.Source(read_blob))})
    result = {"schema": "geocove.highway-field-comparison.v1", "returnId": return_row["id"],
              "issueId": issue["id"], "document": copy.deepcopy(return_row["document"]),
              "workspaceId": state["id"], "stateSha256": D.digest(state),
              "selectedEdition": {k: copy.deepcopy(selected[k]) for k in ("id", "label", "actor", "at")},
              "draft": copy.deepcopy(value["draft"]), "items": items}
    return D._seal(result), blobs

def compare_return(state, return_id, read_blob, edition_id=None):
    return _comparison(state, _find(state, "returns", return_id), read_blob, edition_id)[0]

def view(state, read_blob):
    history = _collection(state)
    return {"schema": STATE, "issues": copy.deepcopy(history["issues"]),
            "returns": copy.deepcopy(history["returns"]),
            "adoptions": copy.deepcopy(history["adoptions"]),
            "limits": {"documentBytes": MAX_DOCUMENT, "inspections": MAX_ITEMS,
                       "editions": MAX_EDITIONS, "draftBytes": MAX_DRAFT}}

def apply_field_exchange(state, command, read_blob):
    body = command["body"]
    actor = _actor(command["actor"])
    at = command["at"]
    D._time(at)
    work = copy.deepcopy(state)
    history = copy.deepcopy(_collection(state))
    kind = command["kind"]
    if kind == "field.issue":
        _exact(body, ("id", "document", "html"), "Issue command")
        D._id(body["id"])
        _need(not any(r["id"] == body["id"] for r in history["issues"]),
              "duplicate_issue", "Field issue identity already exists.")
        issue = _plain(_raw(body["document"], read_blob))
        _need(issue.get("schema") == ISSUE and issue.get("id") == body["id"],
              "issue", "Select the complete prepared issue document.")
        request = {k: issue[k] for k in ("id", "recipient", "inspectionIds",
                    "workspaceRevision", "stateSha256", "note", "actor", "at")}
        _need(request["actor"] == actor and request["at"] == at,
              "actor", "Issue command must retain its original prepared operator and time.")
        expected = prepare_issue(state, request, read_blob)
        _need(canonical(expected) == _raw(body["document"], read_blob),
              "issue_changed", "Issued file differs from the complete original preparation.")
        original_html = _raw(body["html"], read_blob)
        _need(parse_document(original_html) == initial_return(_raw(body["document"], read_blob)),
              "issued_html", "The outgoing field HTML must retain the exact original initial field copy.")
        row = D._seal({"id": body["id"], "document": copy.deepcopy(body["document"]),
                       "html": copy.deepcopy(body["html"]),
                       "recipient": copy.deepcopy(issue["recipient"]),
                       "inspectionIds": copy.deepcopy(issue["inspectionIds"]),
                       "sourceStateSha256": issue["stateSha256"],
                       "workspaceRevision": issue["workspaceRevision"],
                       "actor": actor, "at": at, "requestId": command["requestId"]})
        history["issues"].append(row)
        result = {"issue": copy.deepcopy(row)}
    elif kind == "field.receive":
        _exact(body, ("id", "issueId", "document"), "Returned field command")
        D._id(body["id"])
        _need(not any(r["id"] == body["id"] for r in history["returns"]),
              "duplicate_return", "Returned file identity already exists.")
        issue_row = _find(state, "issues", body["issueId"])
        value, issue, blobs = _return_document(state, issue_row,
                                              _raw(body["document"], read_blob), read_blob)
        _need(D._time(at) >= D._time(issue["at"]) and
              all(D._time(e["at"]) <= D._time(at) for e in value["editions"]),
              "time", "A returned edition is dated after its actual receiving.")
        # Upload complete original members before the atomic command. Validation
        # requires exact original bytes, including unused historical attachments.
        for key, data in blobs.items():
            _need(read_blob(key) == data, "attachment_missing",
                  "Retain every complete returned byte member before receiving.")
        row = D._seal({"id": body["id"], "issueId": body["issueId"],
                       "document": copy.deepcopy(body["document"]),
                       "selectedEditionId": value["selectedEditionId"],
                       "editionCount": len(value["editions"]),
                       "editions": [{k: copy.deepcopy(e[k]) for k in ("id", "label", "actor", "at")}
                                    for e in value["editions"]], "actor": actor,
                       "at": at, "requestId": command["requestId"]})
        history["returns"].append(row)
        result = {"return": copy.deepcopy(row)}
    elif kind == "field.adopt":
        _need(D._time(at) >= D._time(state["updatedAt"]),
              "time", "An adoption cannot precede its selected current workspace.")
        _exact(body, ("id", "returnId", "editionId", "reviewSha256", "items", "note"), "Field adoption command")
        D._id(body["id"])
        _need(not any(r["id"] == body["id"] for r in history["adoptions"]),
              "duplicate_adoption", "Adoption identity already exists.")
        _need(not any(r["returnId"] == body["returnId"] for r in history["adoptions"]),
              "already_adopted", "This exact returned file already has its retained decision.")
        D._text(body["note"], "Supervisor receiving reason", 30000)
        review, blobs = _comparison(state, _find(state, "returns", body["returnId"]), read_blob, body["editionId"])
        _need(D._time(at) >= D._time(_find(state, "returns", body["returnId"])["at"]),
              "time", "An adoption cannot precede actual receiving of its field file.")
        _need(body["reviewSha256"] == review["sha256"],
              "stale_review", "The workspace changed after comparison. Keep choices and review the current inspection.")
        decisions = _list(body["items"], "Complete receiving decisions", MAX_ITEMS, 1)
        ids = [r["inspectionId"] for r in review["items"]]
        _need(len(decisions) == len(ids) and
              {r.get("inspectionId") for r in decisions if isinstance(r, dict)} == set(ids),
              "decisions", "Choose apply or keep for every issued inspection.")
        by_id = {r["inspectionId"]: r for r in decisions}
        outcomes = []
        for item in review["items"]:
            choice = by_id[item["inspectionId"]]
            _exact(choice, ("inspectionId", "action", "choices", "reason"), "Inspection receiving decision")
            _need(choice["action"] in ("apply", "keep"), "decision", "Choose apply or keep.")
            D._text(choice["reason"], "Inspection receiving reason", 10000)
            _need(isinstance(choice["choices"], dict), "choices", "Field choices must be a complete object.")
            field_keys = {f["key"] for f in item["fields"]}
            _need(set(choice["choices"]) <= field_keys and
                  all(v in ("current", "returned") for v in choice["choices"].values()),
                  "choices", "Select current or returned for actual original fields.")
            if choice["action"] == "keep":
                _need(not choice["choices"], "choices", "Keep-current decisions have no field replacements.")
                outcomes.append({"inspectionId": item["inspectionId"], "action": "keep",
                                 "reason": choice["reason"], "version": item["currentVersion"],
                                 "sha256": item["currentSha256"]})
                continue
            _need(item["sameSource"], "source_changed", item["sourceMessage"])
            _need(set(item["conflicts"]) <= set(choice["choices"]), "conflict",
                  "Choose every conflicting field before applying the returned observations.",
                  {"inspectionId": item["inspectionId"], "conflicts": item["conflicts"]})
            values = {}
            for f in item["fields"]:
                selected = choice["choices"].get(f["key"])
                values[f["key"]] = copy.deepcopy(f[selected] if selected else f["proposed"])
            inspection = D._inspection(work, item["inspectionId"])
            previous = D._version(inspection)
            proposed = {"id": inspection["id"], "expectedVersion": previous["number"],
                        "answers": {f["key"][7:]: values[f["key"]] for f in item["fields"]
                                    if f["key"].startswith("answer:")},
                        "geometry": values["$geometry"], "attachments": values["$attachments"],
                        "note": values["$note"]}
            unchanged = all(D._same(proposed[k], previous[k])
                            for k in ("answers", "geometry", "attachments", "note"))
            if unchanged:
                outcomes.append({"inspectionId": inspection["id"], "action": "unchanged",
                                 "reason": choice["reason"], "version": previous["number"],
                                 "sha256": previous["sha256"]})
                continue
            correction = previous["status"] not in ("draft", "returned")
            if correction:
                proposed["reason"] = choice["reason"]
            native = {"requestId": command["requestId"],
                      "kind": "inspection.correct" if correction else "inspection.save",
                      "actor": actor, "at": at, "body": proposed}
            work, outcome = D.apply(work, native, read_blob)
            outcomes.append({**outcome, "action": "applied", "reason": choice["reason"],
                             "originalKind": native["kind"]})
        row = D._seal({"id": body["id"], "returnId": body["returnId"],
                       "editionId": review["selectedEdition"]["id"],
                       "reviewSha256": review["sha256"], "sourceStateSha256": review["stateSha256"],
                       "decisions": copy.deepcopy(decisions), "outcomes": outcomes,
                       "note": body["note"], "actor": actor, "at": at,
                       "requestId": command["requestId"]})
        history["adoptions"].append(row)
        result = {"adoption": copy.deepcopy(row)}
    else:
        raise D.DomainError("field_command", "Unknown field exchange command.")
    work["fieldExchange"] = history
    work["updatedAt"] = max((state["updatedAt"], at), key=D._time)
    return work, result

def validate(state, read_blob):
    history = _collection(state)
    for row in history["issues"]:
        D._check_seal(row, "Issued field copy")
        _, issue = _read_issue(state, row["id"], read_blob)
        _need(issue["inspectionIds"] == row["inspectionIds"] and
              issue["stateSha256"] == row["sourceStateSha256"] and
              issue["recipient"] == row["recipient"] and
              issue["workspaceRevision"] == row["workspaceRevision"] and
              issue["actor"] == row["actor"] and issue["at"] == row["at"],
              "history", "Issued copy differs from its retained original record.")
        _blob_map(issue["blobs"])
        _need(parse_document(_raw(row["html"], read_blob)) ==
              initial_return(_raw(row["document"], read_blob)),
              "history", "The exact original outgoing HTML must remain bound to its issue.")
        for item in issue["items"]:
            current = D._inspection(state, item["inspection"]["id"])
            original = item["inspection"]
            _need(current["versions"][:len(original["versions"])] == original["versions"] and
                  current["submissions"][:len(original["submissions"])] == original["submissions"] and
                  current["decisions"][:len(original["decisions"])] == original["decisions"],
                  "history", "Issued inspection history is not a complete original prefix.")
    for row in history["returns"]:
        D._check_seal(row, "Received field file")
        issue = _find(state, "issues", row["issueId"])
        value, issue_document, blobs = _return_document(state, issue, _raw(row["document"], read_blob), read_blob)
        _need(row["selectedEditionId"] == value["selectedEditionId"] and
              row["editionCount"] == len(value["editions"]) and
              D._time(row["at"]) >= D._time(issue_document["at"]) and
              row["editions"] == [{k: e[k] for k in ("id", "label", "actor", "at")} for e in value["editions"]] and
              all(D._time(e["at"]) <= D._time(row["at"]) for e in value["editions"]),
              "history", "Received edition selection or chronology differs.")
        for key, data in blobs.items():
            _need(read_blob(key) == data, "history", "Full returned bytes must remain in original workspace history.")
    seen_returns = set()
    for row in history["adoptions"]:
        D._check_seal(row, "Field adoption")
        returned = _find(state, "returns", row["returnId"])
        _need(any(e["id"] == row["editionId"] for e in returned["editions"]),
              "history", "Adoption names an absent returned edition.")
        _need(row["returnId"] not in seen_returns, "history", "A returned file has repeated adoption decisions.")
        seen_returns.add(row["returnId"])
        _actor(row["actor"])
        D._time(row["at"])
        for outcome in row["outcomes"]:
            inspection = D._inspection(state, outcome["inspectionId"])
            version = D._integer(outcome["version"], "Adopted version", 1, len(inspection["versions"]))
            _need(inspection["versions"][version - 1]["sha256"] == outcome["sha256"],
                  "history", "Adoption differs from the retained inspection result.")

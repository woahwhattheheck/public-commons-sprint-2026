"""Saved recipient review queues over the original Audit records and export store."""
from __future__ import annotations
import copy
import html
import io
import json
import tempfile
import uuid
import zipfile
from pathlib import Path
from common import canonical, digest, now, require
import audit_recipient_review as recipient

READ_ACTIONS = {"recipient.queue.get", "recipient.queue.inspect"}
WRITE_ACTIONS = {"recipient.queue.save", "recipient.queue.export"}
FORMAT = "commons.audit-recipient-queue.v1"
LIMIT = 16 * 1024 * 1024
MAX_RETURNS = 128
BUNDLE_LIMIT = 1024 * 1024 * 1024

def _keys(value, keys):
    require(isinstance(value, dict) and set(value) == set(keys), "recipient_queue_shape",
            "Retain the complete declared queue fields.")

def _json(raw):
    return recipient.checked_json(raw, LIMIT)

def _value(raw):
    value = _json(raw)
    _keys(value, {"schema", "workspaceId", "queueId", "edition", "previousSha256", "title", "actor",
                  "note", "createdAt", "entries", "selectedReturnSha256"})
    require(value["schema"] == FORMAT and isinstance(value["workspaceId"], str)
            and isinstance(value["edition"], int) and not isinstance(value["edition"], bool)
            and value["edition"] > 0, "recipient_queue_shape", "The complete original queue identity differs.")
    try:
        uuid.UUID(value["queueId"])
    except (ValueError, TypeError, AttributeError):
        require(False, "recipient_queue_shape", "The original queue UUID differs.")
    recipient.string(value["title"], 500, False)
    recipient.string(value["actor"], 240, False)
    recipient.string(value["note"], 6000)
    recipient.string(value["createdAt"], 100, False)
    def sha(item, optional=False):
        return item is None and optional or isinstance(item, str) and len(item) == 64 and all(c in "0123456789abcdef" for c in item)
    require(sha(value["previousSha256"], True) and isinstance(value["entries"], list)
            and 0 < len(value["entries"]) <= MAX_RETURNS, "recipient_queue_shape", "The original queue selection differs.")
    seen = set()
    for item in value["entries"]:
        _keys(item, {"returnId", "returnSha256", "manuscriptId", "editionSha256", "note", "disposition", "preview"})
        require(sha(item["returnSha256"]) and sha(item["editionSha256"])
                and item["returnSha256"] not in seen and item["disposition"] in ("review", "deferred"),
                "recipient_queue_shape", "An original queue entry differs.")
        seen.add(item["returnSha256"])
        recipient.string(item["returnId"], 200, False)
        recipient.string(item["manuscriptId"], 200, False)
        recipient.string(item["note"], 6000)
        preview = item["preview"]
        if preview is not None:
            require(isinstance(preview, dict) and sha(preview.get("sha256"))
                    and preview.get("returnSha256") == item["returnSha256"]
                    and preview.get("manuscriptId") == item["manuscriptId"]
                    and preview.get("editionSha256") == item["editionSha256"]
                    and digest(canonical({k: v for k, v in preview.items() if k != "sha256"}).encode()) == preview["sha256"],
                    "recipient_queue_preview", "The complete retained queue preview differs.")
    require(value["selectedReturnSha256"] is None or value["selectedReturnSha256"] in seen,
            "recipient_queue_selection", "The original selected return is absent.")
    return value

def _record(workspace, db, identity, kind):
    record = workspace._get(db, "export", identity)
    require(record["kind"] == kind, "recipient_queue_export", "Select the original complete " + kind + " export.")
    raw = workspace._bytes(db, record["sha256"])
    require(len(raw) == record["bytes"], "recipient_queue_export", "The complete retained export length differs.")
    return record, raw

def _matching(workspace, db, sha, kind):
    rows = [row for row in workspace._all(db, "export") if row["kind"] == kind and row["sha256"] == sha]
    require(rows, "recipient_queue_source", "A complete original queue source is unavailable.", {"sha256": sha})
    row = rows[0]
    require(len(workspace._bytes(db, sha)) == row["bytes"], "recipient_queue_source", "The original source length differs.")
    return row

def _return(workspace, db, identity):
    record, raw = _record(workspace, db, identity, "recipient-return")
    with tempfile.TemporaryDirectory(prefix="recipient-queue-", dir=workspace.directory) as temporary:
        path = Path(temporary) / "return.zip"
        recipient.publish(path, raw)
        _, original, draft, manuscript, kinds = recipient.read_return(path)
    return record, raw, draft, manuscript

def _queues(workspace, db, queue_id, local=False, origin=None):
    values = []
    for record in workspace._all(db, "export"):
        if record["kind"] != "recipient-queue" or record.get("queueId") != queue_id:
            continue
        value = _value(workspace._bytes(db, record["sha256"]))
        require(value["queueId"] == queue_id, "recipient_queue_history", "The queue metadata and full body differ.")
        if (not local or not record.get("receivedFrom") and value["workspaceId"] == workspace._meta(db)["workspaceId"]) and (origin is None or value["workspaceId"] == origin):
            values.append((record, value))
    values.sort(key=lambda pair: pair[1]["edition"])
    # Receiving the same complete archive can produce several native export IDs.
    unique = {}
    for record, value in values:
        key = value["edition"]
        require(key not in unique or unique[key][0]["sha256"] == record["sha256"],
                "recipient_queue_history", "A queue edition has conflicting original bodies.")
        unique[key] = (record, value)
    return list(unique.values())

def _bind_entries(workspace, db, value, cache):
    for item in value["entries"]:
        sha = item["returnSha256"]
        if sha not in cache:
            retained = _matching(workspace, db, sha, "recipient-return")
            record, raw, draft, manuscript = _return(workspace, db, retained["id"])
            cache[sha] = {"bytes": len(raw), "draftSha256": digest(draft), "manuscriptId": manuscript["manuscriptId"],
                "editionSha256": manuscript["editions"][-1]["sha256"], "source": manuscript["source"],
                "reviews": [{"localId": row["localId"], "inputs": recipient.native_inputs(row)}
                            for row in manuscript["editions"][-1]["reviews"]]}
        original = cache[sha]
        require(original["source"]["workspaceId"] == value["workspaceId"]
                and original["manuscriptId"] == item["manuscriptId"]
                and original["editionSha256"] == item["editionSha256"],
                "recipient_queue_source", "An original queue entry relabels its complete retained return.")
        preview = item["preview"]
        if preview is not None:
            require(preview.get("schema") == recipient.PREVIEW and preview.get("workspaceId") == value["workspaceId"]
                    and preview.get("draftSha256") == original["draftSha256"]
                    and preview.get("originalSource") == original["source"] and preview.get("returnBytes") == original["bytes"]
                    and type(preview.get("expectedVersion")) is int and preview["expectedVersion"] >= 0
                    and isinstance(preview.get("reviews"), list) and len(preview["reviews"]) == len(original["reviews"]),
                    "recipient_queue_preview", "The retained preview differs from the whole original manuscript.")
            expected = preview["expectedVersion"]
            for authored, proposed in zip(original["reviews"], preview["reviews"]):
                _keys(proposed, {"localId", "accepted", "request", "result"})
                request = proposed["request"]
                _keys(request, {"requestId", "expectedVersion", "action", "inputs"})
                require(proposed["localId"] == authored["localId"] and type(proposed["accepted"]) is bool
                        and request["action"] == "review.save" and request["inputs"] == authored["inputs"]
                        and type(request["expectedVersion"]) is int and request["expectedVersion"] >= 0,
                        "recipient_queue_preview", "A retained preview changed an original review request body.")
                identity = recipient.request_id({"manuscriptId": original["manuscriptId"],
                    "editions": [{"sha256": original["editionSha256"]}]}, authored["localId"], request["expectedVersion"])
                require(request["requestId"] == identity, "recipient_queue_preview", "An original request identity differs.")
                if not proposed["accepted"]:
                    require(request["expectedVersion"] == expected and proposed["result"] is None,
                            "recipient_queue_preview", "The original pending request sequence differs.")
                    expected += 1

def _history(workspace, db, record, value):
    by_sha = {r["sha256"]: (r, v) for r, v in _queues(workspace, db, value["queueId"], origin=value["workspaceId"])}
    history = []
    bindings = {}
    selected = (record, value)
    seen = set()
    while selected:
        r, v = selected
        require(r["sha256"] not in seen and v.get("schema") == FORMAT
                and v["workspaceId"] == value["workspaceId"] and v["queueId"] == value["queueId"],
                "recipient_queue_history", "The retained queue ancestry differs.")
        _bind_entries(workspace, db, v, bindings)
        seen.add(r["sha256"])
        history.append({"export": r, "queue": v})
        previous = v["previousSha256"]
        if previous is None:
            require(v["edition"] == 1, "recipient_queue_history", "The first queue edition is absent.")
            break
        require(previous in by_sha and by_sha[previous][1]["edition"] == v["edition"] - 1,
                "recipient_queue_history", "The complete preceding queue edition is unavailable.")
        selected = by_sha[previous]
    return list(reversed(history))

def _progress(workspace, db, record, manuscript):
    rows = []
    current = {item["id"]: item for item in workspace._all(db, "review")}
    requests = [dict(row) for row in db.execute(
        "SELECT id,input_record,result,version FROM requests WHERE action='review.save'")]
    authored = manuscript["editions"][-1]["reviews"]
    inherited = manuscript["source"]["workspaceId"] != workspace._meta(db)["workspaceId"]
    for item in authored:
        matched = []
        for request in requests:
            expected = request["version"] - 1
            if request["id"] == recipient.request_id(manuscript, item["localId"], expected):
                require(json.loads(request["input_record"]) == recipient.native_inputs(item),
                        "recipient_queue_request", "An accepted original review has different inputs.")
                matched.append(request)
        require(len(matched) <= 1, "recipient_queue_request", "Reconcile multiple accepted original review requests.")
        accepted = matched[0] if matched else None
        changed = bool(item["id"] and (item["id"] not in current or
            digest(canonical(current[item["id"]]).encode()) != item["baseReviewSha256"]))
        rows.append({"localId": item["localId"], "title": item["title"], "sourceId": item["sourceId"],
                     "revisionId": item["revisionId"], "requestId": accepted["id"] if accepted else None,
                     "result": json.loads(accepted["result"]) if accepted else None,
                     "status": "received-history" if inherited else "accepted" if accepted else
                               "current-review-changed" if changed else "pending"})
    accepted_count = sum(row["status"] == "accepted" for row in rows)
    custody = [item for item in workspace._all(db, "export")
               if item["kind"] == "recipient-custody" and item.get("returnSha256") == record["sha256"]
               and (inherited or not item.get("receivedFrom"))]
    return {"return": record, "manuscriptId": manuscript["manuscriptId"],
            "editionSha256": manuscript["editions"][-1]["sha256"],
            "authoredEditions": len(manuscript["editions"]), "reviews": rows,
            "accepted": accepted_count, "total": len(rows), "custody": custody, "inherited": inherited,
            "status": "received-history" if inherited else
                      "accepted" if accepted_count == len(rows) and custody else
                      "custody-pending" if accepted_count == len(rows) else
                      "current-review-changed" if any(row["status"] == "current-review-changed" for row in rows) else
                      "partial" if accepted_count else "pending"}

def read(workspace, db, action, inputs):
    if action == "recipient.queue.inspect":
        _keys(inputs, {"returnId"})
        record, raw, draft, manuscript = _return(workspace, db, inputs["returnId"])
        return _progress(workspace, db, record, manuscript)
    _keys(inputs, {"exportId"})
    record, raw = _record(workspace, db, inputs["exportId"], "recipient-queue")
    value = _value(raw)
    history = _history(workspace, db, record, value)
    entries = []
    for item in value["entries"]:
        retained = _matching(workspace, db, item["returnSha256"], "recipient-return")
        entries.append({**item, "retainedReturnId": retained["id"]})
    return {"export": record, "queue": value, "entries": entries, "history": history,
            "readOnly": bool(record.get("receivedFrom")) or value["workspaceId"] != workspace._meta(db)["workspaceId"]}

def _checked(workspace, db, inputs):
    _keys(inputs, {"queueId", "expectedQueueSha256", "title", "entries", "selectedReturnSha256", "actor", "note"})
    try:
        uuid.UUID(inputs["queueId"])
    except (ValueError, TypeError, AttributeError):
        require(False, "recipient_queue_id", "Supply the original queue UUID.")
    actor = recipient.string(inputs["actor"], 240, False)
    title = recipient.string(inputs["title"], 500, False)
    note = recipient.string(inputs["note"], 6000)
    entries = inputs["entries"]
    require(isinstance(entries, list) and 0 < len(entries) <= MAX_RETURNS, "recipient_queue_capacity",
            "Choose one to 128 complete retained returns.")
    previous = _queues(workspace, db, inputs["queueId"], local=True)
    prior = previous[-1] if previous else None
    require(inputs["expectedQueueSha256"] == (prior[0]["sha256"] if prior else None),
            "recipient_queue_changed", "This queue changed. Preserve the unfinished working file and reopen its current edition.", status=409)
    rows, seen = [], set()
    for item in entries:
        _keys(item, {"returnId", "returnSha256", "note", "disposition", "previewSha256"})
        require(item["returnSha256"] not in seen and item["disposition"] in {"review", "deferred"},
                "recipient_queue_selection", "Keep unique original returns and an explicit review/deferred choice.")
        seen.add(item["returnSha256"])
        record, raw, draft, manuscript = _return(workspace, db, item["returnId"])
        require(record["sha256"] == item["returnSha256"]
                and manuscript["source"]["workspaceId"] == workspace._meta(db)["workspaceId"],
                "recipient_queue_source", "Select exact returns belonging to this original author workspace.")
        preview = None
        if item["previewSha256"] is not None:
            sha = item["previewSha256"]
            require(isinstance(sha, str) and len(sha) == 64 and all(c in "0123456789abcdef" for c in sha),
                    "recipient_queue_preview", "Select the original complete preview SHA256.")
            path = workspace.directory / "recipient-reviews" / record["sha256"] / "previews" / (sha + ".json")
            preview = recipient.checked_json(recipient.read_file(path, recipient.MAX_DRAFT))
            plain = {k: v for k, v in preview.items() if k != "sha256"}
            require(preview["sha256"] == sha == digest(canonical(plain).encode())
                    and preview["returnSha256"] == record["sha256"]
                    and preview["manuscriptId"] == manuscript["manuscriptId"]
                    and preview["editionSha256"] == manuscript["editions"][-1]["sha256"],
                    "recipient_queue_preview", "The saved preview does not belong to this complete return.")
        rows.append({"returnId": record["id"], "returnSha256": record["sha256"],
                     "manuscriptId": manuscript["manuscriptId"], "editionSha256": manuscript["editions"][-1]["sha256"],
                     "note": recipient.string(item["note"], 6000), "disposition": item["disposition"], "preview": preview})
    require(inputs["selectedReturnSha256"] is None or inputs["selectedReturnSha256"] in seen,
            "recipient_queue_selection", "The selected return must be in this complete queue.")
    value = {"schema": FORMAT, "workspaceId": workspace._meta(db)["workspaceId"],
             "queueId": inputs["queueId"], "edition": prior[1]["edition"] + 1 if prior else 1,
             "previousSha256": prior[0]["sha256"] if prior else None, "title": title, "actor": actor,
             "note": note, "createdAt": now(), "entries": rows,
             "selectedReturnSha256": inputs["selectedReturnSha256"]}
    require(len(recipient.encoded(value)) <= LIMIT, "recipient_queue_capacity",
            "The whole saved queue exceeds 16 MiB. Preserve its complete working file.")
    return value

def _bundle(workspace, db, selected):
    record, raw = _record(workspace, db, selected, "recipient-queue")
    value = _value(raw)
    history = _history(workspace, db, record, value)
    members = {"queue.json": raw}
    total = len(raw)
    def add(name, sha, size):
        nonlocal total
        if name in members:
            require(digest(members[name]) == sha and len(members[name]) == size,
                    "recipient_queue_source", "Two selected original files conflict.")
            return
        require(isinstance(size, int) and 0 <= size <= BUNDLE_LIMIT - total,
                "recipient_queue_capacity", "The complete selected queue exceeds 1 GiB; preserve the native workspace.")
        body = workspace._bytes(db, sha)
        require(len(body) == size, "recipient_queue_source", "The original file length differs.")
        members[name] = body
        total += size
    selected_shas = set()
    for observation in history:
        r, v = observation["export"], observation["queue"]
        add("history/" + str(v["edition"]).zfill(6) + "-" + r["sha256"] + ".json", r["sha256"], r["bytes"])
        selected_shas.update(row["returnSha256"] for row in v["entries"])
    # Earlier queue editions retain their complete original selections too.
    for sha in sorted(selected_shas):
        item = _matching(workspace, db, sha, "recipient-return")
        add("returns/" + sha + ".zip", sha, item["bytes"])
        for custody in workspace._all(db, "export"):
            if custody["kind"] == "recipient-custody" and custody.get("returnSha256") == sha:
                add("custody/" + custody["sha256"] + ".zip", custody["sha256"], custody["bytes"])
    esc = lambda value: html.escape(str(value), quote=True)
    rows = "".join("<tr><td>" + esc(index + 1) + "</td><td>" + esc(item["manuscriptId"]) +
                   "</td><td>" + esc(item["disposition"]) + "</td><td><pre>" + esc(item["note"]) +
                   "</pre></td><td><a href='returns/" + item["returnSha256"] + ".zip'>Complete original return</a></td></tr>"
                   for index, item in enumerate(value["entries"]))
    links = "".join("<li><a href='" + esc(name) + "'>" + esc(name) + "</a></li>" for name in sorted(members))
    page = "<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + esc(value["title"]) + "</title><style>body{font:16px/1.5 system-ui;color:#171717;background:#fff;max-width:80rem;margin:2rem auto;padding:0 1rem}h1{font-size:1.7rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:.6rem;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#222}li{overflow-wrap:anywhere}.scroll{overflow:auto}</style><main><h1>" + esc(value["title"]) + "</h1><p>Original author " + esc(value["workspaceId"]) + "; saved queue edition " + str(value["edition"]) + ". Review/deferred are staff workflow choices. Native acceptance is recorded only in the original custody files; reopen the author to inspect current progress.</p><pre>" + esc(value["note"]) + "</pre><div class='scroll'><table><thead><tr><th>Order</th><th>Manuscript</th><th>Workflow</th><th>Staff note</th><th>Original file</th></tr></thead><tbody>" + rows + "</tbody></table></div><h2>Complete original files and history</h2><ul>" + links + "</ul><p>Extract this entire archive before using its links. Each return ZIP contains its original author package and complete manuscript. Retain every file. The ordinary full Audit application export additionally carries the editable native workspace and original request history.</p></main></html>"
    members["OPEN.html"] = page.encode()
    require(sum(map(len, members.values())) <= BUNDLE_LIMIT, "recipient_queue_capacity",
            "The whole selected source/history/custody exceeds 1 GiB; preserve the native workspace.")
    manifest = {"schema": "commons.audit-recipient-queue-package.v1",
                "workspaceId": value["workspaceId"], "queueSha256": record["sha256"],
                "files": {name: {"bytes": len(body), "sha256": digest(body)} for name, body in members.items()}}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        for name, body in members.items():
            recipient.zip_member(archive, name, body, zipfile.ZIP_DEFLATED)
        recipient.zip_member(archive, "manifest.json", recipient.encoded(manifest), zipfile.ZIP_DEFLATED)
    body = buffer.getvalue()
    require(len(body) <= BUNDLE_LIMIT, "recipient_queue_capacity", "The complete queue package exceeds 1 GiB.")
    return body, value, record

def write(workspace, db, action, inputs):
    if action == "recipient.queue.save":
        value = _checked(workspace, db, inputs)
        raw = recipient.encoded(value)
        record = workspace._export_record(db, raw, "recipient-queue",
            "Audit_Recipient_Queue_" + value["queueId"] + "_r" + str(value["edition"]) + ".json",
            mime="application/json", queueId=value["queueId"], queueEdition=value["edition"])
        return {"archive": record, "queue": value}
    _keys(inputs, {"exportId", "actor", "note"})
    recipient.string(inputs["actor"], 240, False)
    recipient.string(inputs["note"], 6000)
    raw, value, selected = _bundle(workspace, db, inputs["exportId"])
    record = workspace._export_record(db, raw, "recipient-queue-package", "Audit_Recipient_Queue_Complete.zip",
        mime="application/zip", queueId=value["queueId"], originalQueueSha256=selected["sha256"])
    return {"archive": record, "queueSha256": selected["sha256"], "queueId": value["queueId"]}

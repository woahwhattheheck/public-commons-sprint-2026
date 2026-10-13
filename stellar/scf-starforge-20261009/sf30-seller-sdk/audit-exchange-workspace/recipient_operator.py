"""Installed recipient workflows; all review writes use the original native API."""
from __future__ import annotations
import copy
import io
import json
import re
import tempfile
import uuid
import zipfile
from pathlib import Path
from common import AuditError, canonical, decode64, digest, now, require, text
import audit_recipient_review as recipient

UPLOAD_LIMIT = 256 * 1024 * 1024
ARTIFACT_LIMIT = recipient.MAX_PACKAGE + recipient.MAX_DRAFT + 1024 * 1024
SPECIAL_ACTIONS = {"recipient.preview", "recipient.apply"}
WRITE_ACTIONS = {"recipient.prepare", "recipient.stage"}

def _sha(value):
    require(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value),
            "recipient_identity", "Supply the complete original SHA256.")
    return value

def _keys(value, keys):
    require(isinstance(value, dict) and set(value) <= set(keys),
            "recipient_input", "Use only the declared complete recipient fields.")

def _returned(workspace, return_id):
    record, raw = workspace.download(return_id)
    require(record["kind"] == "recipient-return", "recipient_return",
            "Choose a complete recipient return retained in this workspace.")
    require(len(raw) <= UPLOAD_LIMIT, "recipient_capacity", "The retained return exceeds 256 MiB.")
    root = workspace.directory / "recipient-reviews" / record["sha256"]
    with recipient.held(root):
        recipient.publish(root / "recipient-return.zip", raw)
    return root, record

def _restore_requests(workspace, root, returned):
    """Recover missing local leaves only from exact accepted original native requests."""
    raw, original, draft, value, kinds = recipient.read_return(returned)
    selected = recipient.scope(raw, value)
    recipient.publish(root / "SOURCE.json", recipient.encoded(selected))
    with workspace.connect() as db:
        db.execute("BEGIN")
        # Original review.save input_record has no binary summaries. The commit's
        # version is exactly its request.expectedVersion + 1 in Workspace.perform.
        operations = [dict(row) for row in db.execute(
            "SELECT id,input_record,result,version FROM requests WHERE action='review.save'")]
    for authored in value["editions"][-1]["reviews"]:
        inputs = recipient.native_inputs(authored)
        matches = []
        for row in operations:
            expected = row["version"] - 1
            if (type(expected) is int and expected >= 0
                    and row["id"] == recipient.request_id(value, authored["localId"], expected)):
                require(json.loads(row["input_record"]) == inputs,
                        "recipient_recovery", "The original native review request has different complete inputs.")
                request = {"requestId": row["id"], "expectedVersion": expected,
                           "action": "review.save", "inputs": inputs}
                matches.append((request, json.loads(row["result"])))
        require(len(matches) <= 1, "recipient_recovery",
                "More than one accepted request names this manuscript review; reconcile the original store.")
        for request, result in matches:
            # Publish only source-proven request bodies. Existing files must match.
            recipient.publish(root / "requests" / (request["requestId"] + ".json"),
                recipient.encoded({"source": selected, "localId": authored["localId"], "request": request}))
            # Unchanged native replay verifies the original request's saved hash.
            outcome = workspace.perform(request)
            require(outcome["result"] == result, "recipient_recovery", "The accepted native result differs.")
            recipient.publish(root / "results" / (request["requestId"] + ".json"),
                recipient.encoded({"request": request, "result": result}))
    return selected

def native_write(workspace, db, action, inputs):
    """Called inside the existing Workspace.perform request/CAS transaction."""
    if action == "recipient.prepare":
        _keys(inputs, {"exportId", "expectedSha256", "actor", "note"})
        source = workspace._get(db, "export", inputs.get("exportId"))
        require(source["kind"] in {"workspace", "application"}
                and source["sha256"] == _sha(inputs.get("expectedSha256")),
                "recipient_source", "Choose this original complete workspace/application export.")
        raw = workspace._bytes(db, source["sha256"])
        require(len(raw) == source["bytes"], "recipient_source", "The original export length differs.")
        with tempfile.TemporaryDirectory(prefix="recipient-prepare-", dir=workspace.directory) as temporary:
            root = Path(temporary)
            recipient.publish(root / "source.zip", raw)
            receipt = recipient.prepare(root / "source.zip", root / "prepared")
            archive = recipient.read_file(root / "prepared" / "Audit_Recipient_Complete.zip", ARTIFACT_LIMIT)
        export = workspace._export_record(db, archive, "recipient-editor", "Audit_Recipient_Complete.zip",
            mime="application/zip", originalExportId=source["id"], originalSha256=source["sha256"],
            recipientInputSha256=receipt["inputSha256"])
        return {"archive": export, "source": receipt["source"], "delivery": receipt}

    require(action == "recipient.stage", "recipient_action", "Select an original recipient action.")
    _keys(inputs, {"name", "contentBase64", "expectedSha256", "actor", "note"})
    raw = decode64(inputs.get("contentBase64"), maximum=UPLOAD_LIMIT)
    require(digest(raw) == _sha(inputs.get("expectedSha256")), "recipient_source",
            "The complete returned bytes differ from the reviewed file.")
    name = text(inputs.get("name"), "name", blank=False)
    with tempfile.TemporaryDirectory(prefix="recipient-stage-", dir=workspace.directory) as temporary:
        path = Path(temporary) / "return.zip"
        recipient.publish(path, raw)
        _, original, draft, value, kinds = recipient.read_return(path)
    require(value["source"]["workspaceId"] == workspace._meta(db)["workspaceId"],
            "recipient_workspace", "Receive this manuscript in its original author workspace.", status=409)
    # A valid supplied archive is not proof that this author issued it.
    original_sha = digest(original)
    retained = [item for item in workspace._all(db, "export")
                if item["kind"] in {"workspace", "application"} and item["sha256"] == original_sha]
    require(retained and workspace._bytes(db, original_sha) == original,
            "recipient_origin", "The return must include an exact complete export retained by this author.")
    export = workspace._export_record(db, raw, "recipient-return", name, mime="application/zip",
        manuscriptId=value["manuscriptId"], editionSha256=value["editions"][-1]["sha256"],
        originalSha256=original_sha, originalExportId=retained[0]["id"])
    return {"archive": export, "source": value["source"], "manuscriptId": value["manuscriptId"],
            "editionSha256": value["editions"][-1]["sha256"],
            "editions": len(value["editions"]), "reviews": len(value["editions"][-1]["reviews"])}

def _request(envelope):
    require(set(envelope) == {"action", "inputs", "requestId", "expectedVersion"},
            "recipient_request", "Retain the entire original apply envelope.")
    request_id = envelope.get("requestId")
    try:
        require(isinstance(request_id, str), "recipient_request", "Supply the original UUID.")
        uuid.UUID(request_id)
    except (ValueError, AttributeError) as error:
        raise AuditError("recipient_request", "Supply the original apply UUID.") from error
    require(type(envelope.get("expectedVersion")) is int and envelope["expectedVersion"] >= 0,
            "recipient_version", "Supply the exact reviewed native version.")
    return request_id, digest(canonical({"action": envelope["action"], "inputs": envelope["inputs"],
                                         "expectedVersion": envelope["expectedVersion"]}).encode())

def _prior(workspace, db, request_id, identity):
    row = db.execute("SELECT envelope_sha256,result FROM requests WHERE id=?", (request_id,)).fetchone()
    if row:
        require(row["envelope_sha256"] == identity, "request_reused",
                "This original UUID already names different complete inputs.", status=409)
        return {"ok": True, "result": json.loads(row["result"]),
                "state": workspace._state(db), "replayed": True}
    return None

def perform(workspace, envelope):
    action, inputs = envelope["action"], envelope.get("inputs", {})
    require(isinstance(inputs, dict), "recipient_input", "Use complete recipient inputs.")
    if action == "recipient.preview":
        _keys(inputs, {"returnId", "operator"})
        operator = recipient.string(inputs.get("operator"), 240, False)
        root, record = _returned(workspace, inputs.get("returnId"))
        # One service lease per return, distinct from the original helper's own lock.
        with recipient.held(root / "service"):
            _restore_requests(workspace, root, root / "recipient-return.zip")
            preview = recipient.plan(workspace, root / "recipient-return.zip", operator, root)
            recipient.publish(root / "previews" / (preview["sha256"] + ".json"), recipient.encoded(preview))
        return {"ok": True, "result": {"returnId": record["id"], "preview": preview}}

    require(action == "recipient.apply", "recipient_action", "Choose an original recipient action.")
    _keys(inputs, {"returnId", "previewSha256", "preview", "actor", "note"})
    actor = recipient.string(inputs.get("actor"), 240, False)
    text(inputs.get("note", ""), "note")
    preview_sha = _sha(inputs.get("previewSha256"))
    request_id, identity = _request(envelope)
    with workspace.connect() as db:
        db.execute("BEGIN")
        prior = _prior(workspace, db, request_id, identity)
        if prior: return prior
    root, record = _returned(workspace, inputs.get("returnId"))
    with recipient.held(root / "service"):
        with workspace.connect() as db:
            db.execute("BEGIN")
            prior = _prior(workspace, db, request_id, identity)
            if prior: return prior
        preview_path = root / "previews" / (preview_sha + ".json")
        preview = recipient.checked_json(recipient.encoded(inputs.get("preview")), recipient.MAX_DRAFT)
        require(preview.get("sha256") == preview_sha
                and preview.get("expectedVersion") == envelope["expectedVersion"]
                and preview.get("operator") == actor,
                "recipient_preview", "Apply the exact saved preview, operator and original version.")
        require(all(item.get("request", {}).get("requestId") != request_id for item in preview.get("reviews", [])),
                "recipient_request", "Use a distinct outer request UUID from every original review request.")
        _restore_requests(workspace, root, root / "recipient-return.zip")
        # Reuse the original helper\'s complete pure validation before an immutable
        # preview or outer intent can occupy its identity. Accepted replay is unchanged.
        raw_return, original, draft, manuscript, kinds = recipient.read_return(root / "recipient-return.zip")
        with recipient.held(root):
            accepted_prior = recipient.discover(workspace, root, recipient.scope(raw_return, manuscript), manuscript)
            recipient.validate_preview(workspace, raw_return, draft, manuscript, preview, accepted_prior)
            recipient.publish(preview_path, recipient.encoded(preview))
            operation = root / "service" / "operations" / request_id
            recipient.publish(operation / "REQUEST.json", recipient.encoded(envelope))
        # The original helper retains every request before its first native write.
        # Each review commits/replays through Workspace.perform and native CAS.
        accepted = recipient.apply(workspace, root / "recipient-return.zip", preview_path, root)
        recipient.publish(operation / "ACCEPTED.json", recipient.encoded(accepted))
        # Freeze a complete bounded selection. Never export active lock files or paths.
        members = {}
        for name in ("SOURCE.json", "recipient-return.zip", "ACCEPTED.json"):
            members[name] = recipient.read_file(root / name, ARTIFACT_LIMIT)
        members["application-request.json"] = recipient.encoded(envelope)
        members["selected-preview.json"] = recipient.read_file(preview_path, recipient.MAX_DRAFT)
        for folder in ("requests", "results", "previews"):
            for path in sorted((root / folder).glob("*.json")):
                members[folder + "/" + path.name] = recipient.read_file(path, recipient.MAX_DRAFT)
        require(sum(map(len, members.values())) <= ARTIFACT_LIMIT, "recipient_capacity",
                "The complete returned source and native custody exceed the delivery limit.")
        manifest = {"schema": "commons.audit-recipient-native-custody.v1",
                    "workspaceId": accepted["workspaceId"], "requestId": request_id,
                    "returnId": record["id"], "returnSha256": record["sha256"],
                    "previewSha256": preview_sha, "accepted": accepted,
                    "files": {name: {"bytes": len(raw), "sha256": digest(raw)}
                              for name, raw in members.items()}}
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
            for name, raw in members.items():
                recipient.zip_member(archive, name, raw, zipfile.ZIP_DEFLATED)
            recipient.zip_member(archive, "manifest.json", recipient.encoded(manifest), zipfile.ZIP_DEFLATED)
        raw = buffer.getvalue()
        require(len(raw) <= ARTIFACT_LIMIT, "recipient_capacity", "The complete custody ZIP exceeds its capacity.")
        # Publish the finished custody and original outer request through the SAME
        # native tables. Its creation is additive after the exact review writes.
        # Later unrelated native edits remain intact; no old global version is rebased.
        with workspace.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = _prior(workspace, db, request_id, identity)
            if prior: return prior
            exported = workspace._export_record(db, raw, "recipient-custody", "Audit_Recipient_Accepted.zip",
                mime="application/zip", originalReturnId=record["id"], returnSha256=record["sha256"],
                manuscriptId=accepted["manuscriptId"], editionSha256=accepted["editionSha256"])
            result = {"accepted": accepted, "archive": exported, "returnId": record["id"],
                      "previewSha256": preview_sha}
            version = workspace._bump(db)
            db.execute("INSERT INTO requests VALUES(?,?,?,?,?,?,?)",
                (request_id, action, identity, canonical(inputs), canonical(result), version, now()))
            state = workspace._state(db)
            db.commit()
        return {"ok": True, "result": result, "state": state}

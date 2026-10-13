#!/usr/bin/env python3
"""Borrow the existing Operations owner; preserve original native commands across retry."""
from __future__ import annotations
import copy
import pathlib
import uuid
if __package__:
    from . import customer_return as C
    from . import customer_reporting as R
else:
    import customer_return as C
    import customer_reporting as R

SCHEMA = "commons.scf-company-return-native-bridge.v1"
require, packed, digest = R.require, R.packed, R.digest


def original(out, name):
    path = out / name
    return R.document(R.regular_bytes(path), name) if path.exists() or path.is_symlink() else None


def native_version(ops, case_id):
    value = ops.read(case_id)
    require(value["program"]["id"] == case_id, "Use the original selected native Operations case.")
    return value["program"]["version"]


def source_identity():
    return [{"path": name, "bytes": len(raw), "sha256": digest(raw)}
            for name, raw in sorted(C.software_files().items())]


def keep_selection(out, selection):
    require(isinstance(selection["case_id"], str) and selection["case_id"].startswith("operation-"),
            "Select an existing native Operations case.")
    C.string(selection["operation_id"], "original bridge operation", 300, True)
    C.string(selection["actor"], "actual recording operator", 300, True)
    C.string(selection["note"], "recording note", 12000, True)
    R.retain(out, "selection.json", packed(selection))


def command(ops, out, selection, phase, action, prepare):
    """Freeze once, then call the native request ledger before any current-version read."""
    filename = phase + ".request.json"
    request = original(out, filename)
    if request is None:
        version, data = prepare()
        request = {"expectedVersion": version,
                   "requestId": str(uuid.uuid5(uuid.NAMESPACE_URL, SCHEMA + "/" +
                                              selection["operation_id"] + "/" + selection["case_id"] + "/" + selection["return_id"] + "/" + phase)),
                   "actor": selection["actor"], "note": selection["note"],
                   "action": action, "data": data}
        R.retain(out, filename, packed(request))
    require(request["action"] == action and request["actor"] == selection["actor"] and
            request["note"] == selection["note"], "The original native command selection changed.")
    receipt = ops.command(selection["case_id"], copy.deepcopy(request))
    require(receipt.get("id") == selection["case_id"] and receipt.get("action") == action,
            "The original native receipt belongs to another case or action.")
    R.retain(out, phase + ".receipt.json", packed(receipt))
    return receipt


def original_installation(ops, case_id, binding, document):
    row = ops.installation(case_id, binding["installation_id"], binding["revision"])
    require(row["id"] == binding["installation_id"] and row["revision"] == binding["revision"] and
            row["sha256"] == binding["native_installation_sha256"] and
            R.equal(row["preview"]["document"], document), "The original report is not this case's retained saved edition.")
    # show() adds volatile current-case availability; the saved native row remains immutable.
    return {key: value for key, value in row.items() if key != "current"}


def receive_proposal(ops, case_id, archive_raw, archive_sha256, output, *, operation_id, actor, note):
    """Record a proposed return, without owner APPLY choices or an Installation save."""
    selected = C.read_return(archive_raw, archive_sha256)
    described = C.submission(archive_raw, archive_sha256)
    selection = {"schema": SCHEMA + ".receive-selection", "case_id": case_id, "operation_id": operation_id,
                 "actor": actor, "note": note, "archive_sha256": digest(archive_raw), "archive_bytes": len(archive_raw),
                 "binding": described["binding"], "return_id": described["return_id"], "software": source_identity()}
    with R.operation_directory(output) as out:
        keep_selection(out, selection)
        R.retain(out, "original-return.zip", archive_raw)
        baseline = original_installation(ops, case_id, described["binding"], selected["report"]["document"])
        R.retain(out, "original-installation.json", packed(baseline))
        R.retain(out, "submission.json", packed(described))
        source_receipt = command(ops, out, selection, "01-source", "source.add",
                                 lambda: (native_version(ops, case_id), described["source"]))
        source_id = source_receipt["recordId"]
        metadata, source_raw = ops.source(case_id, source_id)
        require(source_raw == selected["files"]["RETURN.json"] and metadata["sha256"] == described["returned_json_sha256"],
                "The native original-return source differs.")
        R.retain(out, "original-return-source.json", packed(metadata))
        linked = C.submission(archive_raw, archive_sha256, source_id)
        R.retain(out, "linked-submission.json", packed(linked))

        def prepare():
            version = native_version(ops, case_id)
            preview = ops.preview_installation_return(case_id, {"expectedVersion": version, "inputs": linked["inputs"]})
            R.retain(out, "02-return.preview.json", packed(preview))
            return version, {"inputs": linked["inputs"], "expectedPreviewSha256": preview["previewSha256"]}

        receipt = command(ops, out, selection, "02-return", "installation.return", prepare)
        review = ops.review(case_id, receipt["recordId"])
        require(review["purpose"] == "INSTALLATION_RETURN" and review["sha256"] == receipt["reviewSha256"] and
                R.equal(review["installationReturn"]["inputs"], original(out, "02-return.preview.json")["inputs"]),
                "The native proposed-return review differs.")
        R.retain(out, "native-return-review.json", packed(review))
        result = {"schema": SCHEMA + ".receive-result", "selection": selection, "source": metadata,
                  "review_id": review["id"], "review_sha256": review["sha256"],
                  "native_receipt": receipt, "native_preview_sha256": receipt["previewSha256"],
                  "returned_json_sha256": described["returned_json_sha256"], "state": "PROPOSAL_RECORDED"}
        R.retain(out, "complete-result.json", packed(result))
        return result


def received_selection(ops, received_output):
    out = pathlib.Path(received_output).expanduser().resolve()
    selected = original(out, "selection.json")
    result = original(out, "complete-result.json")
    require(selected and result and selected.get("schema") == SCHEMA + ".receive-selection" and
            R.equal(result.get("selection"), selected),
            "Select the completed original native proposal.")
    raw = R.regular_bytes(out / "original-return.zip")
    require(len(raw) == selected["archive_bytes"], "The original received ZIP size differs.")
    returned = C.read_return(raw, selected["archive_sha256"])
    require(R.equal(returned["returned"]["binding"], selected["binding"]) and
            returned["returned"]["return_id"] == selected["return_id"],
            "The retained proposal selection differs.")
    receipt = original(out, "02-return.receipt.json")
    require(R.equal(receipt, result["native_receipt"]), "Retain the native original return receipt.")
    review = ops.review(selected["case_id"], result["review_id"])
    require(review["sha256"] == result["review_sha256"] and
            R.equal(review, original(out, "native-return-review.json")),
            "The native original proposal has changed.")
    return selected, result, returned


def preview_owner_review(ops, case_id, received_output, choices, output, *, operation_id, actor, note, name):
    """Freeze all explicit KEEP/APPLY choices and the native current-owner preview."""
    received, result, returned = received_selection(ops, received_output)
    selected_ids = [row["id"] for row in returned["returned"]["inputs"]["observations"]]
    require(isinstance(choices, list) and len(choices) == len(selected_ids), "Review every original check.")
    seen = set()
    for row in choices:
        require(isinstance(row, dict) and set(row) == {"id", "action", "note"} and row["id"] in selected_ids and
                row["id"] not in seen and row["action"] in ("KEEP", "APPLY"), "Make one explicit KEEP/APPLY choice per check.")
        C.string(row["note"], "check review reason", 8000, True)
        seen.add(row["id"])
    C.string(name, "owner review name", 300, True)
    selection = {"schema": SCHEMA + ".owner-selection", "case_id": case_id, "operation_id": operation_id,
                 "actor": actor, "note": note, "name": name, "choices": copy.deepcopy(choices),
                 "proposal_operation_id": received["operation_id"], "return_id": received["return_id"],
                 "archive_sha256": received["archive_sha256"], "binding": received["binding"],
                 "returned_case_id": received["case_id"], "review_id": result["review_id"], "review_sha256": result["review_sha256"],
                 "software": source_identity()}
    with R.operation_directory(output) as out:
        keep_selection(out, selection)
        R.retain(out, "original-return.zip", R.regular_bytes(pathlib.Path(received_output).resolve() / "original-return.zip"))
        R.retain(out, "proposal-receipt.json", packed(result))
        existing = original(out, "owner-preview.json")
        if existing is not None:
            # Preserve the previously reviewed version, even if the owner case has since changed.
            require(existing.get("selection_sha256") == digest(packed(selection)), "The owner preview selection changed.")
            return existing
        current = ops.installation(case_id, received["binding"]["installation_id"])
        version = native_version(ops, case_id)
        inputs = {"returnedCaseId": received["case_id"], "reviewId": result["review_id"], "reviewSha256": result["review_sha256"],
                  "installationId": current["id"], "expectedRevision": current["revision"],
                  "name": name, "note": note, "choices": copy.deepcopy(choices)}
        preview = ops.preview_installation_return_review(case_id, {"expectedVersion": version, "inputs": inputs})
        value = {"schema": SCHEMA + ".owner-preview", "selection_sha256": digest(packed(selection)),
                 "expected_version": version, "inputs": inputs, "preview": preview,
                 "preview_sha256": preview["previewSha256"], "state": "OWNER_CHOICES_PREVIEWED"}
        R.retain(out, "owner-preview.json", packed(value))
        return value


def owner_selection(out, case_id):
    selected = original(out, "selection.json")
    preview = original(out, "owner-preview.json")
    require(selected and preview and selected.get("schema") == SCHEMA + ".owner-selection" and
            selected["case_id"] == case_id and preview["selection_sha256"] == digest(packed(selected)),
            "Select the original full owner review and preview.")
    require(R.equal(selected["software"], source_identity()), "Use the original selected bridge source.")
    returned = C.read_return(R.regular_bytes(out / "original-return.zip"), selected["archive_sha256"])
    require(returned["returned"]["return_id"] == selected["return_id"] and
            R.equal(returned["returned"]["binding"], selected["binding"]), "The owner return selection differs.")
    return selected, preview


def stage_owner_review(ops, case_id, review_output, *, expected_preview_sha256):
    """Explicitly stage the selected owner decisions, then retain its ordinary save preview."""
    with R.operation_directory(review_output) as out:
        selected, preview = owner_selection(out, case_id)
        require(preview["preview_sha256"] == expected_preview_sha256, "Select the exact reviewed owner preview hash.")
        receipt = command(ops, out, selected, "03-owner-stage", "installation.return-stage",
                          lambda: (preview["expected_version"], {"inputs": preview["inputs"],
                                    "expectedPreviewSha256": preview["preview_sha256"]}))
        review = ops.review(case_id, receipt["recordId"])
        require(review["purpose"] == "INSTALLATION_RETURN_REVIEW" and review["sha256"] == receipt["reviewSha256"],
                "The native owner-stage receipt differs.")
        R.retain(out, "native-owner-stage.json", packed(review))
        saved = original(out, "installation-preview.json")
        if saved is None:
            # Do not silently move to a later case version after the reviewed stage.
            expected = receipt["version"]
            body = {"expectedVersion": expected, "installationId": receipt["installationId"],
                    "expectedRevision": receipt["expectedRevision"], "document": receipt["document"]}
            native = ops.preview_installation(case_id, body)
            saved = {"schema": SCHEMA + ".installation-preview", "body": body, "preview": native,
                     "preview_sha256": native["previewSha256"], "stage_review_id": receipt["recordId"],
                     "stage_review_sha256": receipt["reviewSha256"], "state": "INSTALLATION_SAVE_PREVIEWED"}
            R.retain(out, "installation-preview.json", packed(saved))
        require(saved["stage_review_id"] == receipt["recordId"] and saved["stage_review_sha256"] == receipt["reviewSha256"],
                "The original native save preview belongs to another owner stage.")
        return saved


def save_owner_revision(ops, case_id, review_output, *, expected_preview_sha256):
    """Save one explicitly selected native preview; exact original commands replay first."""
    with R.operation_directory(review_output) as out:
        selected, owner_preview = owner_selection(out, case_id)
        preview = original(out, "installation-preview.json")
        require(preview and preview["preview_sha256"] == expected_preview_sha256,
                "Select the complete staged Installation save preview.")
        stage = original(out, "03-owner-stage.receipt.json")
        require(stage and stage["recordId"] == preview["stage_review_id"] and
                stage["reviewSha256"] == preview["stage_review_sha256"], "Retain the exact owner-stage receipt.")

        def prepare():
            body, native = preview["body"], preview["preview"]
            return body["expectedVersion"], {"installationId": body["installationId"],
                   "expectedRevision": body["expectedRevision"], "document": native["document"],
                   "expectedPreviewSha256": native["previewSha256"]}

        receipt = command(ops, out, selected, "04-installation-save", "installation.save", prepare)
        row = ops.installation(case_id, receipt["recordId"], receipt["revision"])
        saved = {key: value for key, value in row.items() if key != "current"}
        require(saved["id"] == selected["binding"]["installation_id"] and
                saved["revision"] == preview["body"]["expectedRevision"] + 1 and
                R.equal(saved["preview"]["document"], preview["preview"]["document"]),
                "The saved native successor differs from the explicitly reviewed preview.")
        R.retain(out, "saved-installation.json", packed(saved))
        original_installation(ops, case_id, selected["binding"],
                              C.read_return(R.regular_bytes(out / "original-return.zip"),
                                            selected["archive_sha256"])["report"]["document"])
        result = {"schema": SCHEMA + ".owner-result", "selection": selected, "native_receipt": receipt,
                  "installation_id": saved["id"], "revision": saved["revision"], "native_installation_sha256": saved["sha256"],
                  "stage": saved["preview"]["document"]["stage"], "owner_stage_review_id": stage["recordId"],
                  "original_revision": selected["binding"]["revision"],
                  "original_native_installation_sha256": selected["binding"]["native_installation_sha256"],
                  "state": "NATIVE_SUCCESSOR_SAVED"}
        R.retain(out, "complete-result.json", packed(result))
        return result

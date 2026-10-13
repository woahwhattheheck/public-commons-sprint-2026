"""Receive complete original merchant commissioning USTAR files in Source Desk.

The existing source draft owns the archive, member blobs, journal and editions.
Members are read in memory with Python's standard tar reader. The original
merchant manifest and capture verifier remain the document authority.
"""
from __future__ import annotations

from copy import deepcopy
import io
import re
import tarfile

from model import Problem, digest
import operations_installation_commissioning as commissioning

SCHEMA = "stellar-forge.installation-commissioning-archive.v1"
MAX_FILE = 8 * 1024 * 1024
MAX_INPUTS = 64 * 1024 * 1024
MAX_STORED = 256 * 1024 * 1024
SELECTION = ("archiveFileId", "expectedArchiveSha256", "replaceFileIds")
MEMBER = re.compile(r"(?:documents/)?[A-Za-z0-9._-]+")
MEDIA = re.compile(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+")
need, exact, sha = commissioning.need, commissioning.exact, commissioning.sha


def read_archive(raw):
    """Read the exact original USTAR shape without extracting filesystem paths."""
    need(isinstance(raw, bytes) and 0 < len(raw) <= MAX_FILE,
         "The complete original archive must fit the existing 8 MiB Source Desk file limit.", status=413)
    files, position = {}, 0
    try:
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
            for member in archive:
                need(member.type == tarfile.REGTYPE and not member.pax_headers and
                     member.offset == position and member.offset_data == position + 512,
                     "Retain the original ordinary USTAR files without links, directories or extension records.")
                need(raw[position + 257:position + 265] == b"ustar\x0000",
                     "Select the original uncompressed merchant USTAR handover.")
                name = member.name
                need(isinstance(name, str) and MEMBER.fullmatch(name) is not None and
                     name.rsplit("/", 1)[-1] not in (".", "..") and name not in files,
                     "Keep each safe original member name once.")
                need(0 <= member.size <= MAX_FILE and member.offset_data + member.size <= len(raw),
                     "A complete original archive member exceeds the retained file bound.", status=413)
                selected = archive.extractfile(member)
                need(selected is not None, "Retain the complete ordinary archive member.")
                with selected:
                    content = selected.read(MAX_FILE + 1)
                need(len(content) == member.size, "The archive member is incomplete.")
                end = member.offset_data + member.size
                position = end + (-member.size % 512)
                need(raw[end:position] == bytes(position - end),
                     "Keep the original zero-filled USTAR member alignment.")
                files[name] = content
    except (tarfile.TarError, OSError, EOFError) as error:
        raise Problem("The complete original merchant archive is unreadable: " + str(error),
                      422, "INSTALLATION_COMMISSIONING_ARCHIVE") from error
    need(files and raw[position:] == bytes(1024),
         "Keep the complete single original USTAR archive with its two final zero blocks.")
    return files


def native_filename(member_name):
    if "/" not in member_name:
        return member_name
    extension = member_name.rsplit(".", 1)[-1].lower()
    if re.fullmatch(r"[a-z0-9]{1,8}", extension) is None:
        extension = "bin"
    return "Commissioning_Member_" + sha(member_name.encode("utf-8")) + "." + extension


def archive_bundle(original, raw):
    bodies = read_archive(raw)
    need(all(name in bodies for name in commissioning.REQUIRED),
         "Keep the complete merchant capture, manifest, review and Workshare files in this archive.")
    manifest = commissioning.object_json(bodies["commissioning-manifest.json"], "capture manifest")
    descriptors = manifest.get("files")
    need(isinstance(descriptors, list) and all(isinstance(row, dict) and isinstance(row.get("name"), str)
         for row in descriptors), "Retain the original complete manifest member inventory.")
    by_name = {row["name"]: row for row in descriptors}
    need(len(by_name) == len(descriptors) and
         set(bodies) == set(by_name) | {"commissioning-manifest.json"} and
         "commissioning-manifest.json" not in by_name,
         "The original archive must contain every manifest member once, plus its complete manifest.")
    metadata, retained_bodies, filenames = [], {}, set()
    for member_name in sorted(bodies):
        content = bodies[member_name]
        descriptor = by_name.get(member_name, {"type": "application/json",
                                             "role": "commissioning-capture-manifest"})
        original_type = descriptor.get("type")
        need(isinstance(original_type, str) and MEDIA.fullmatch(original_type.split(";", 1)[0].strip()),
             "Retain the original manifest MIME media type for each member.")
        filename = native_filename(member_name)
        need(filename not in filenames and filename != original["filename"] and
             re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,199}", filename),
             "The exact archive members must map to distinct native receiving filenames.")
        filenames.add(filename)
        content_sha = sha(content)
        row = {"id": "input-" + digest({"filename": filename, "sha256": content_sha}),
               "filename": filename, "bytes": len(content), "sha256": content_sha,
               "mediaType": original_type.split(";", 1)[0].strip(),
               "sourceUrl": original["sourceUrl"], "observedAt": original["observedAt"],
               "originalMemberName": member_name,
               "originalArchive": {"fileId": original["id"], "filename": original["filename"],
                                   "bytes": original["bytes"], "sha256": original["sha256"],
                                   "memberName": member_name},
               "originalType": original_type, "originalRole": descriptor.get("role"),
               "containsCompleteAccount": member_name == commissioning.SNAPSHOT}
        metadata.append(row)
        retained_bodies[filename] = content
    capture = next(row for row in metadata if row["originalMemberName"] == "commissioning-capture.json")
    verified = commissioning.verify_bundle(metadata, retained_bodies, capture["id"])
    return verified


def _preview(desk, state, value):
    exact(value, SELECTION, SELECTION)
    selected = next((row for row in state["files"] if row["id"] == value["archiveFileId"]), None)
    need(selected is not None and isinstance(value["expectedArchiveSha256"], str) and
         selected["sha256"] == value["expectedArchiveSha256"],
         "Select the exact complete original archive retained in this draft.",
         "INSTALLATION_SOURCE_CHANGED", 409)
    raw = desk._blob(state["caseId"], state["id"], selected["sha256"])
    need(len(raw) == selected["bytes"], "The complete retained archive length changed.",
         "INSTALLATION_SOURCE_CHANGED", 409)
    bundle = archive_bundle(selected, raw)
    replacement_ids = value["replaceFileIds"]
    need(isinstance(replacement_ids, list) and all(isinstance(ident, str) for ident in replacement_ids)
         and len(set(replacement_ids)) == len(replacement_ids),
         "Select each exact conflicting current file once for replacement.")
    current_by_name = {row["filename"]: row for row in state["files"]}
    members, conflicts, removable, additions = [], [], {}, []
    for source in bundle["files"]:
        member = deepcopy(source)
        previous = current_by_name.get(source["filename"])
        same = previous is not None and all(previous.get(key) == source.get(key) for key in
                    ("filename", "bytes", "sha256", "mediaType", "sourceUrl", "observedAt")) and (
                    previous.get("originalMemberName", previous["filename"]) == source["originalMemberName"])
        # An empty original still travels byte-exact in the full archive; the
        # original Source Desk deliberately retains only nonempty standalone files.
        materialize = member["bytes"] > 0
        if not materialize:
            disposition = "ARCHIVE_ONLY"
        elif same:
            disposition = "REUSED"
            member["id"] = previous["id"]
        elif previous is not None:
            disposition = "CONFLICT"
            removable[previous["id"]] = previous
            conflicts.append({"filename": member["filename"], "originalMemberName": member["originalMemberName"],
                              "existing": deepcopy(previous), "incoming": deepcopy(source),
                              "replaceSelected": previous["id"] in replacement_ids})
        else:
            disposition = "NEW"
        if materialize and not same:
            additions.append(member)
        member.update({"disposition": disposition, "existingFileId": previous["id"] if previous else None,
                       "replaceSelected": previous is not None and previous["id"] in replacement_ids,
                       "retainedInArchive": True, "materialized": materialize,
                       "archiveOnlyReason": None if materialize else "EMPTY_ORIGINAL_MEMBER"})
        members.append(member)
    need(set(replacement_ids) <= set(removable) and selected["id"] not in replacement_ids,
         "Replace only the exact conflicting original file selections shown by this archive review.")
    removed = [deepcopy(removable[ident]) for ident in sorted(replacement_ids)]
    unresolved = [row for row in conflicts if not row["replaceSelected"]]
    new_bytes = sum(row["bytes"] for row in additions)
    selected_bytes = sum(row["bytes"] for row in state["files"]
                         if row["id"] not in replacement_ids) + new_bytes
    stored = desk.db.execute("SELECT COALESCE(SUM(bytes),0) FROM ops_installation_source_blobs "
                             "WHERE program_id=? AND draft_id=?", (state["caseId"], state["id"])).fetchone()[0]
    new_blobs = {}
    for row in additions:
        existing_blob = desk.db.execute("SELECT bytes FROM ops_installation_source_blobs "
                                       "WHERE program_id=? AND draft_id=? AND sha256=?",
                                       (state["caseId"], state["id"], row["sha256"])).fetchone()
        if existing_blob is None:
            new_blobs[row["sha256"]] = row["bytes"]
        else:
            need(desk._blob(state["caseId"], state["id"], row["sha256"]) == bundle["bodies"][row["filename"]],
                 "An original retained member blob changed.", "INSTALLATION_SOURCE_CHANGED", 409)
    stored_after = stored + sum(new_blobs.values())
    suggested_names = set(commissioning.REQUIRED) | set(commissioning.REPORTS)
    suggested = [row["id"] for row in members if row["materialized"] and
                 row["originalMemberName"] in suggested_names]
    capture = next(row for row in members if row["originalMemberName"] == "commissioning-capture.json")
    selection = {"archiveFileId": selected["id"], "expectedArchiveSha256": selected["sha256"],
                 "replaceFileIds": sorted(replacement_ids)}
    preview = {"schema": SCHEMA, "caseId": state["caseId"], "draftId": state["id"],
               "draftRevision": state["revision"], "selection": selection, "archive": deepcopy(selected),
               "capture": commissioning._capture_view(bundle), "members": members,
               "conflicts": conflicts, "removedFiles": removed,
               "newBytes": new_bytes, "selectedBytes": selected_bytes, "storedBytesAfter": stored_after,
               "limits": {"archiveBytes": MAX_FILE, "memberBytes": MAX_FILE,
                          "selectedBytes": MAX_INPUTS, "storedBytes": MAX_STORED},
               "ready": not unresolved and selected_bytes <= MAX_INPUTS and stored_after <= MAX_STORED,
               "receivingSelection": {"captureFileId": capture["id"], "fileIds": sorted(suggested)},
               "scope": "PRIVATE_COMPLETE_CAPTURE_ARCHIVE"}
    preview["previewSha256"] = digest(preview)
    return preview, bundle


def inspect(desk, case_id, draft_id, body):
    exact(body, ("expectedRevision", "archiveFileId", "replaceFileIds"),
          ("expectedRevision", "archiveFileId"))
    with desk.workspace.mutex:
        state = commissioning._state(desk, case_id, draft_id, body["expectedRevision"])
        selected = next((row for row in state["files"] if row["id"] == body["archiveFileId"]), None)
        need(selected is not None, "Select an existing complete original archive file.")
        return _preview(desk, state, {"archiveFileId": selected["id"],
                        "expectedArchiveSha256": selected["sha256"],
                        "replaceFileIds": body.get("replaceFileIds", [])})[0]


def receive(desk, state, context, data):
    exact(data, (*SELECTION, "expectedPreviewSha256"), (*SELECTION, "expectedPreviewSha256"))
    preview, bundle = _preview(desk, state, {key: data[key] for key in SELECTION})
    need(isinstance(data["expectedPreviewSha256"], str) and
         preview["previewSha256"] == data["expectedPreviewSha256"],
         "The original archive, member replacement selection or draft changed. Review it again.",
         "INSTALLATION_COMMISSIONING_ARCHIVE_CHANGED", 409)
    need(preview["ready"], "Resolve the exact original filename conflicts and native draft capacity shown in this review.",
         "INSTALLATION_COMMISSIONING_ARCHIVE_REVIEW", 409)
    removed = set(preview["selection"]["replaceFileIds"])
    state["files"] = [row for row in state["files"] if row["id"] not in removed]
    existing = {row["id"]: row for row in state["files"]}
    received = []
    for member in preview["members"]:
        if not member["materialized"]:
            continue
        if member["disposition"] == "REUSED":
            row = existing[member["id"]]
        else:
            row = {key: deepcopy(member[key]) for key in
                   ("id", "filename", "bytes", "sha256", "mediaType", "sourceUrl", "observedAt",
                    "originalMemberName", "originalArchive", "originalType", "originalRole",
                    "containsCompleteAccount")}
            kept = desk._keep_blob(state["caseId"], state["id"], bundle["bodies"][row["filename"]])
            need(kept == {"bytes": row["bytes"], "sha256": row["sha256"]},
                 "The original member retention changed its full byte identity.",
                 "INSTALLATION_SOURCE_CHANGED", 409)
            state["files"].append(row)
        received.append(deepcopy(row))
    result = {"schema": SCHEMA, "state": "RECEIVED_COMMISSIONING_ARCHIVE",
              "caseId": state["caseId"], "draftId": state["id"], "draftRevision": state["revision"],
              "receivedAt": context["at"], "actor": context["actor"],
              "previewSha256": preview["previewSha256"], "selection": preview["selection"],
              "archive": preview["archive"], "capture": preview["capture"],
              "members": preview["members"], "files": received, "removedFiles": preview["removedFiles"],
              "receivingSelection": preview["receivingSelection"], "scope": preview["scope"]}
    # This is source receiving history, not an Installation attachment. A later
    # original commissioning.attach request records the reviewed phase references.
    state.setdefault("commissioningArchives", []).append(deepcopy(result))
    return result


def verify_receipt(desk, receipt):
    need(receipt.get("schema") == SCHEMA and receipt.get("state") == "RECEIVED_COMMISSIONING_ARCHIVE",
         "Keep the original complete commissioning archive receiving receipt.")
    archive = receipt["archive"]
    raw = desk._blob(receipt["caseId"], receipt["draftId"], archive["sha256"])
    bundle = archive_bundle(archive, raw)
    need(commissioning._capture_view(bundle) == receipt["capture"],
         "The original capture archive differs from its saved receiving receipt.",
         "INSTALLATION_SOURCE_CHANGED", 409)
    for file in receipt["files"]:
        original = desk._blob(receipt["caseId"], receipt["draftId"], file["sha256"])
        need(len(original) == file["bytes"] and
             original == bundle["bodies"][file["filename"]],
             "A received original archive member differs from its retained receipt.",
             "INSTALLATION_SOURCE_CHANGED", 409)
    return receipt

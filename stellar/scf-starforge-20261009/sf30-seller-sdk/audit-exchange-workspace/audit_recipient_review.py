"""Offline Audit recipient reviews, accepted by the original Workspace.perform API."""
from __future__ import annotations
import argparse
import base64
import copy
import fcntl
import hashlib
import io
import json
import os
import stat
import tempfile
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse
from common import AuditError, canonical, digest, require, now
from exchange import unpack_package, APPLICATION_ROOT

DRAFT = "commons.audit-recipient-manuscript.v1"
INPUT = "commons.audit-recipient-input.v1"
PREVIEW = "commons.audit-recipient-preview.v1"
MAX_DRAFT = 32 * 1024 * 1024
MAX_PACKAGE = 1024 * 1024 * 1024
FIELDS = {"localId", "id", "baseReviewSha256", "sourceId", "revisionId", "sourceSha256",
          "entityKey", "title", "status", "assignee", "dueDate", "actor", "note", "evidence"}
ASSETS = ("audit-recipient.html", "audit-recipient.js", "audit-recipient.css", "local-file-hash.js")

def encoded(value):
    return (canonical(value) + "\n").encode("utf-8")

def exact_keys(value, keys):
    require(isinstance(value, dict) and set(value) == set(keys), "recipient_shape",
            "Retain every original recipient field, without extra fields.")

def string(value, maximum, blank=True):
    require(isinstance(value, str) and len(value) <= maximum and (blank or bool(value.strip()))
            and not any(ord(c) < 32 and c not in "\n\r\t" for c in value),
            "recipient_text", "Complete the bounded recipient text.")
    try:
        value.encode("utf-8")
    except UnicodeError as error:
        raise AuditError("recipient_text", "Use complete Unicode characters.") from error
    return value

def checked_json(raw, maximum=MAX_DRAFT):
    require(isinstance(raw, bytes) and len(raw) <= maximum, "recipient_capacity",
            "The complete recipient document exceeds its declared capacity.")
    def pairs(rows):
        value = {}
        for key, item in rows:
            require(key not in value, "recipient_json", "Repeated JSON keys are not accepted.")
            value[key] = item
        return value
    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError("finite JSON required")))
    except (ValueError, UnicodeError, RecursionError) as error:
        raise AuditError("recipient_json", "Use one complete finite UTF-8 JSON document.") from error

def read_file(path, maximum):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "recipient_file", "Select an ordinary complete file.")
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum,
                "recipient_capacity", "The selected complete file exceeds its capacity.")
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
    require(len(raw) == before.st_size and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
            "recipient_file", "The selected file changed while being read.")
    return raw

def publish(path, raw):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    fd, pending = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        try:
            os.link(pending, path)
        except FileExistsError:
            require(read_file(path, max(len(raw), 1)) == raw, "recipient_existing",
                    "This retained output already names different complete bytes.", {"path": str(path)}, 409)
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        os.unlink(pending)

@contextmanager
def held(directory):
    directory = Path(directory); directory.mkdir(parents=True, exist_ok=True)
    lock = directory / "recipient.lock"
    require(not lock.is_symlink(), "recipient_lock", "Use the original ordinary recipient lock.")
    with lock.open("a+b") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield

def package(raw):
    manifest, members = unpack_package(raw)
    require(manifest.get("kind") in {"workspace", "application"} and "workspace.json" in members,
            "recipient_package", "Select the complete original Audit workspace or application ZIP.")
    snapshot = checked_json(members["workspace.json"], MAX_PACKAGE)
    require(snapshot.get("format") == "commons.audit-exchange.snapshot.v1"
            and isinstance(snapshot.get("workspace"), dict) and isinstance(snapshot.get("records"), list),
            "recipient_package", "The original native workspace snapshot is absent.")
    by_kind = {}
    for record in snapshot["records"]:
        require(isinstance(record, dict) and isinstance(record.get("payload"), dict)
                and record.get("id") == record["payload"].get("id"), "recipient_record",
                "An original native record identity is invalid.")
        group = by_kind.setdefault(record.get("kind"), {})
        require(record["id"] not in group, "recipient_record", "An original record identity is repeated.")
        group[record["id"]] = record["payload"]
    workspace = snapshot["workspace"]
    require(isinstance(workspace.get("workspaceId"), str) and type(workspace.get("version")) is int,
            "recipient_workspace", "Retain the exact original native workspace identity.")
    objects = {row["sha256"]: row for row in snapshot["objects"]}
    for revision in by_kind.get("revision", {}).values():
        require(revision["sourceId"] in by_kind.get("source", {}), "recipient_source",
                "A retained source revision has no original source.")
        obj = objects.get(revision["sha256"])
        require(obj is not None and obj["path"] in members
                and digest(members[obj["path"]]) == revision["sha256"]
                and len(members[obj["path"]]) == revision["bytes"],
                "recipient_source", "A complete original source revision is absent.")
    return manifest, snapshot, by_kind, members

def original_identity(raw, snapshot):
    return {"archiveSha256": digest(raw), "archiveBytes": len(raw),
            "workspaceId": snapshot["workspace"]["workspaceId"],
            "workspaceVersion": snapshot["workspace"]["version"],
            "selectedEditionId": snapshot.get("selectedEditionId")}

def prepare_input(raw):
    manifest, snapshot, kinds, members = package(raw)
    objects = {row["sha256"]: row for row in snapshot["objects"]}
    sources = []
    for source in kinds.get("source", {}).values():
        revisions = []
        for revision in sorted((r for r in kinds.get("revision", {}).values()
                                if r["sourceId"] == source["id"]), key=lambda r: r["number"]):
            model = revision["model"]; body = members[objects[revision["sha256"]]["path"]]
            revisions.append({"id": revision["id"], "number": revision["number"],
                "sha256": revision["sha256"], "bytes": revision["bytes"],
                "entities": [{"key": e["key"], "label": e.get("label", e["key"]),
                              "kind": e.get("semanticKind") or e.get("kind", ""), "path": e.get("path", "")}
                             for e in model["entities"]],
                "fields": model["fields"], "validation": revision["validation"],
                "xml": body.decode(model.get("encoding") or "utf-8", errors="replace")})
        sources.append({"id": source["id"], "name": source["name"],
                        "currentRevisionId": source["currentRevisionId"], "revisions": revisions})
    return {"schema": INPUT, "source": original_identity(raw, snapshot), "sources": sources,
            "reviews": list(kinds.get("review", {}).values()),
            "editions": list(kinds.get("edition", {}).values()), "manifest": manifest}

def prepare(archive, output):
    raw = read_file(archive, MAX_PACKAGE); document = prepare_input(raw)
    output = Path(output).resolve(); body = encoded(document)
    require(len(body) <= 128 * 1024 * 1024, "recipient_capacity",
            "This complete offline source projection exceeds 128 MiB; use the native Audit application.")
    publish(output / "original-review.zip", raw)
    template = (APPLICATION_ROOT / "public" / ASSETS[0]).read_text("utf-8")
    html = template.replace("<!--AUDIT_RECIPIENT_INPUT-->",
        '<script type="application/octet-stream" id="recipient-input" data-sha256="' + digest(body) + '">' +
        base64.b64encode(body).decode("ascii") + "</script>")
    publish(output / "Audit_Recipient_Review.html", html.encode("utf-8"))
    for name in ASSETS[1:]:
        publish(output / name, (APPLICATION_ROOT / "public" / name).read_bytes())
    publish(output / "RECIPIENT_INPUT.json", body)
    receipt = {"schema": "commons.audit-recipient-delivery.v1", "source": document["source"],
               "inputSha256": digest(body), "files": [{"path": p.name, "bytes": p.stat().st_size,
                       "sha256": digest(read_file(p, MAX_PACKAGE))}
                       for p in [output / name for name in ("original-review.zip", "Audit_Recipient_Review.html", *ASSETS[1:], "RECIPIENT_INPUT.json")]]}
    publish(output / "RECIPIENT_DELIVERY.json", encoded(receipt))
    complete = io.BytesIO()
    with zipfile.ZipFile(complete, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as zipped:
        for item in receipt["files"]:
            zip_member(zipped, item["path"], read_file(output / item["path"], MAX_PACKAGE), zipfile.ZIP_DEFLATED)
        zip_member(zipped, "RECIPIENT_DELIVERY.json", encoded(receipt), zipfile.ZIP_DEFLATED)
    publish(output / "Audit_Recipient_Complete.zip", complete.getvalue())
    return receipt

def zip_member(archive, name, raw, compression=zipfile.ZIP_STORED):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | 0o600) << 16
    info.compress_type = compression
    archive.writestr(info, raw)

def validate_review(row, kinds):
    exact_keys(row, FIELDS)
    try: uuid.UUID(row["localId"])
    except (ValueError, TypeError, AttributeError) as error:
        raise AuditError("recipient_id", "Retain the original manuscript review UUID.") from error
    string(row["id"], 160); string(row["baseReviewSha256"], 64)
    revision = kinds.get("revision", {}).get(row["revisionId"])
    require(revision and revision["sourceId"] == row["sourceId"]
            and revision["sha256"] == row["sourceSha256"], "recipient_source",
            "The review must select one exact original source revision.")
    require(not row["entityKey"] or any(e["key"] == row["entityKey"] for e in revision["model"]["entities"]),
            "recipient_entity", "The review selected an entity outside its original revision.")
    if row["id"]:
        prior = kinds.get("review", {}).get(row["id"])
        require(prior and prior["sourceId"] == row["sourceId"]
                and row["baseReviewSha256"] == digest(canonical(prior).encode()),
                "recipient_review", "The existing review must retain its complete original head identity.")
    else:
        require(row["baseReviewSha256"] == "", "recipient_review", "A new review has no existing native head.")
    for name, maximum, blank in (("title", 500, False), ("actor", 240, False), ("assignee", 500, True),
                                  ("dueDate", 100, True), ("note", 32000, True)):
        string(row[name], maximum, blank)
    require(row["status"] in {"open", "investigating", "resolved", "accepted"},
            "recipient_status", "Select an original native review status.")
    require(isinstance(row["evidence"], list) and len(row["evidence"]) <= 100,
            "recipient_evidence", "Retain at most 100 complete evidence references.")
    for item in row["evidence"]:
        exact_keys(item, {"label", "url"}); string(item["label"], 500, False); string(item["url"], 4000, False)
        require(urlparse(item["url"]).scheme in {"http", "https"} and bool(urlparse(item["url"]).netloc),
                "recipient_evidence", "Evidence links must be complete HTTP or HTTPS references.")

def validate_draft(raw, original):
    value = checked_json(raw); _, snapshot, kinds, _ = package(original)
    exact_keys(value, {"schema", "manuscriptId", "source", "editions"})
    require(value["schema"] == DRAFT and value["source"] == original_identity(original, snapshot),
            "recipient_source", "The manuscript must retain this exact whole original archive.")
    try: uuid.UUID(value["manuscriptId"])
    except (ValueError, TypeError, AttributeError) as error:
        raise AuditError("recipient_id", "Retain the original manuscript UUID.") from error
    require(isinstance(value["editions"], list) and 1 <= len(value["editions"]) <= 1000,
            "recipient_editions", "Retain all authored editions and at least one complete saved edition.")
    previous = None
    for index, edition in enumerate(value["editions"]):
        exact_keys(edition, {"revision", "previousSha256", "createdAt", "reviews", "sha256"})
        plain = {key: item for key, item in edition.items() if key != "sha256"}
        require(type(edition["revision"]) is int and edition["revision"] == index + 1
                and edition["previousSha256"] == previous and edition["sha256"] == digest(canonical(plain).encode()),
                "recipient_history", "A complete authored edition or its predecessor changed.")
        string(edition["createdAt"], 100, False)
        require(isinstance(edition["reviews"], list) and 1 <= len(edition["reviews"]) <= 1000,
                "recipient_reviews", "Each authored edition contains 1..1000 complete reviews.")
        ids = set(); native_ids = set()
        for row in edition["reviews"]:
            validate_review(row, kinds)
            require(row["localId"] not in ids and (not row["id"] or row["id"] not in native_ids),
                    "recipient_duplicate", "An authored edition repeats a logical or native review.")
            ids.add(row["localId"]); native_ids.add(row["id"])
        previous = edition["sha256"]
    return value, kinds

def make_return(archive, draft, output):
    original = read_file(archive, MAX_PACKAGE); raw = read_file(draft, MAX_DRAFT)
    value, _ = validate_draft(raw, original)
    members = {"original-review.zip": original, "AUDIT_RECIPIENT_MANUSCRIPT.json": raw}
    manifest = {"schema": "commons.audit-recipient-return.v1", "source": value["source"],
                "manuscriptId": value["manuscriptId"], "editionSha256": value["editions"][-1]["sha256"],
                "files": {name: {"bytes": len(body), "sha256": digest(body)} for name, body in members.items()}}
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zipped:
        for name, body in members.items(): zip_member(zipped, name, body)
        zip_member(zipped, "manifest.json", encoded(manifest))
    publish(output, stream.getvalue()); return manifest

def read_return(path):
    raw = read_file(path, MAX_PACKAGE + MAX_DRAFT + 1024 * 1024)
    with zipfile.ZipFile(io.BytesIO(raw)) as zipped:
        infos = zipped.infolist()
        require(len(infos) == 3 and {i.filename for i in infos}
                == {"original-review.zip", "AUDIT_RECIPIENT_MANUSCRIPT.json", "manifest.json"}
                and all(not i.is_dir() and not stat.S_ISLNK(i.external_attr >> 16) and not i.flag_bits & 1 for i in infos)
                and sum(i.file_size for i in infos) <= MAX_PACKAGE + MAX_DRAFT + 1024 * 1024,
                "recipient_return", "Retain the complete three-member recipient return.")
        original = zipped.read("original-review.zip"); draft = zipped.read("AUDIT_RECIPIENT_MANUSCRIPT.json")
        manifest = checked_json(zipped.read("manifest.json"), 1024 * 1024)
    value, kinds = validate_draft(draft, original)
    expected = {"schema": "commons.audit-recipient-return.v1", "source": value["source"],
                "manuscriptId": value["manuscriptId"], "editionSha256": value["editions"][-1]["sha256"],
                "files": {"original-review.zip": {"bytes": len(original), "sha256": digest(original)},
                          "AUDIT_RECIPIENT_MANUSCRIPT.json": {"bytes": len(draft), "sha256": digest(draft)}}}
    require(manifest == expected, "recipient_return", "The full return manifest differs from its original bodies.")
    return raw, original, draft, value, kinds

def native_inputs(row):
    result = {key: copy.deepcopy(row[key]) for key in
              ("sourceId", "revisionId", "entityKey", "title", "status", "assignee",
               "dueDate", "actor", "note", "evidence")}
    if row["id"]: result["id"] = row["id"]
    return result

def scope(raw, value):
    return {"returnSha256": digest(raw), "manuscriptId": value["manuscriptId"],
            "editionSha256": value["editions"][-1]["sha256"],
            "workspaceId": value["source"]["workspaceId"]}

def request_id(value, local_id, expected):
    return str(uuid.uuid5(uuid.UUID(value["manuscriptId"]),
               value["editions"][-1]["sha256"] + ":" + local_id + ":" + str(expected)))

def discover(workspace, root, selected, value):
    """Recover only original saved requests, validating accepted bodies by native replay."""
    result = {}
    rows = {row["localId"]: row for row in value["editions"][-1]["reviews"]}
    if root is None or not root.exists(): return result
    anchor = root / "SOURCE.json"
    require(anchor.is_file() and checked_json(read_file(anchor, MAX_DRAFT)) == selected,
            "recipient_journal", "This journal belongs to another complete recipient return.")
    for path in sorted((root / "requests").glob("*.json")):
        saved = checked_json(read_file(path, MAX_DRAFT))
        exact_keys(saved, {"source", "localId", "request"})
        row = rows.get(saved["localId"]); request = saved["request"]
        require(saved["source"] == selected and row is not None and isinstance(request, dict),
                "recipient_journal", "A retained request belongs to another manuscript.")
        exact_keys(request, {"requestId", "expectedVersion", "action", "inputs"})
        require(type(request["expectedVersion"]) is int and request["expectedVersion"] >= 0
                and request["requestId"] == request_id(value, row["localId"], request["expectedVersion"])
                and path.name == request["requestId"] + ".json"
                and request["action"] == "review.save" and request["inputs"] == native_inputs(row),
                "recipient_journal", "A retained original native request changed.")
        receipt_path = root / "results" / path.name
        try:
            workspace.perform({"action": "operation.get", "inputs": {"requestId": request["requestId"]}})
        except AuditError as error:
            if error.code != "not_found": raise
            require(not receipt_path.exists(), "recipient_outcome",
                    "A retained successful operation is absent from the original workspace; reconcile its store before another write.")
            continue
        # operation.get establishes existence; unchanged perform verifies the whole body.
        outcome = workspace.perform(request)
        receipt = {"request": request, "result": outcome["result"]}
        publish(receipt_path, encoded(receipt))
        require(row["localId"] not in result or result[row["localId"]]["request"] == request,
                "recipient_duplicate", "More than one accepted native request names this authored review.")
        result[row["localId"]] = {"request": request, "result": outcome["result"]}
    return result

def plan(workspace, return_path, operator, journal=None):
    string(operator, 240, False)
    raw, original, draft, value, kinds = read_return(return_path)
    selected = scope(raw, value)
    require(workspace.state()["workspaceId"] == selected["workspaceId"], "recipient_workspace",
            "Accept this return only in its original author workspace.", status=409)
    root = Path(journal).resolve() if journal else None
    if root is not None:
        with held(root):
            publish(root / "SOURCE.json", encoded(selected))
            accepted = discover(workspace, root, selected, value)
    else: accepted = {}
    state = workspace.state()
    current = {r["id"]: r for r in state["reviews"]}; commands = []; expected = state["version"]
    for row in value["editions"][-1]["reviews"]:
        detail = workspace.perform({"action": "source.get", "inputs": {
            "sourceId": row["sourceId"], "revisionId": row["revisionId"]}})["result"]
        require(detail["revision"]["sha256"] == row["sourceSha256"], "recipient_source",
                "The selected original native source differs.", status=409)
        if row["localId"] in accepted:
            prior = accepted[row["localId"]]
            commands.append({"localId": row["localId"], "accepted": True,
                             "request": prior["request"], "result": prior["result"]})
            continue
        if row["id"]:
            require(row["id"] in current and digest(canonical(current[row["id"]]).encode()) == row["baseReviewSha256"],
                    "recipient_review_changed", "An original review has changed; preserve this return and review the current head.",
                    {"reviewId": row["id"]}, 409)
        request = {"requestId": request_id(value, row["localId"], expected),
                   "expectedVersion": expected, "action": "review.save", "inputs": native_inputs(row)}
        commands.append({"localId": row["localId"], "accepted": False, "request": request, "result": None})
        expected += 1
    result = {"schema": PREVIEW, "workspaceId": state["workspaceId"], "expectedVersion": state["version"],
              "operator": operator, "returnSha256": digest(raw), "returnBytes": len(raw),
              "manuscriptId": value["manuscriptId"], "editionSha256": value["editions"][-1]["sha256"],
              "draftSha256": digest(draft), "originalSource": value["source"], "reviews": commands}
    result["sha256"] = digest(canonical(result).encode()); return result

def apply(workspace, return_path, preview_path, journal):
    raw, original, draft, manuscript, kinds = read_return(return_path)
    preview = checked_json(read_file(preview_path, MAX_DRAFT))
    plain = {key: item for key, item in preview.items() if key != "sha256"}
    require(preview.get("schema") == PREVIEW and preview.get("sha256") == digest(canonical(plain).encode())
            and preview.get("returnSha256") == digest(raw), "recipient_preview",
            "Select the complete unchanged preview for this exact returned archive.")
    selected = scope(raw, manuscript); root = Path(journal).resolve()
    with held(root):
        require(workspace.state()["workspaceId"] == selected["workspaceId"], "recipient_workspace",
                "This return belongs to another original workspace.")
        publish(root / "SOURCE.json", encoded(selected))
        publish(root / "recipient-return.zip", raw)
        accepted = discover(workspace, root, selected, manuscript)
        # Derive and verify the complete authored bodies independently of preview JSON.
        rows = manuscript["editions"][-1]["reviews"]
        require(len(preview.get("reviews", [])) == len(rows)
                and preview["workspaceId"] == selected["workspaceId"]
                and preview["manuscriptId"] == selected["manuscriptId"]
                and preview["editionSha256"] == selected["editionSha256"]
                and preview["draftSha256"] == digest(draft) and preview["originalSource"] == manuscript["source"],
                "recipient_preview", "The preview does not contain this whole manuscript edition.")
        pending_expected = preview["expectedVersion"]
        require(type(pending_expected) is int and pending_expected >= 0, "recipient_preview", "Retain the native expected version.")
        for row, proposed in zip(rows, preview["reviews"]):
            exact_keys(proposed, {"localId", "accepted", "request", "result"})
            request = proposed["request"]
            require(proposed["localId"] == row["localId"] and type(proposed["accepted"]) is bool
                    and isinstance(request, dict) and request.get("inputs") == native_inputs(row),
                    "recipient_preview", "A preview changed the complete authored review body.")
            exact_keys(request, {"requestId", "expectedVersion", "action", "inputs"})
            require(request["action"] == "review.save" and type(request["expectedVersion"]) is int
                    and request["requestId"] == request_id(manuscript, row["localId"], request["expectedVersion"]),
                    "recipient_preview", "The preview changed an original native request identity.")
            if proposed["accepted"]:
                prior = accepted.get(row["localId"])
                require(prior == {"request": request, "result": proposed["result"]},
                        "recipient_outcome", "The preview's accepted original operation is absent or different.")
            else:
                require(request["expectedVersion"] == pending_expected and proposed["result"] is None,
                        "recipient_preview", "The pending native versions are not contiguous.")
                pending_expected += 1
                if row["localId"] in accepted:
                    require(accepted[row["localId"]]["request"] == request,
                            "recipient_outcome", "This review has a different accepted original request.")
        # Before any first write validate untouched original review heads against the preview.
        state = workspace.state(); heads = {r["id"]: r for r in state["reviews"]}
        for row in rows:
            if row["localId"] not in accepted and row["id"]:
                require(row["id"] in heads and digest(canonical(heads[row["id"]]).encode()) == row["baseReviewSha256"],
                        "recipient_review_changed", "The existing native review changed after preview.", status=409)
        publish(root / "previews" / (preview["sha256"] + ".json"), encoded(preview))
        for proposed in preview["reviews"]:
            request = proposed["request"]
            publish(root / "requests" / (request["requestId"] + ".json"),
                    encoded({"source": selected, "localId": proposed["localId"], "request": request}))
        results = []
        for proposed in preview["reviews"]:
            request = proposed["request"]
            # Native replay checks the original body before version CAS. Any unaccepted
            # stale request stops here; a deliberate fresh preview keeps accepted originals.
            outcome = workspace.perform(request)
            receipt = {"request": request, "result": outcome["result"]}
            publish(root / "results" / (request["requestId"] + ".json"), encoded(receipt))
            results.append({"localId": proposed["localId"], "requestId": request["requestId"],
                            "reviewId": outcome["result"]["reviewId"]})
        result = {"schema": "commons.audit-recipient-accepted.v1", **selected,
                  "operator": preview["operator"], "reviews": results}
        publish(root / "ACCEPTED.json", encoded(result)); return result

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("prepare"); p.add_argument("--archive", required=True); p.add_argument("--out", required=True)
    p = sub.add_parser("pack"); p.add_argument("--archive", required=True); p.add_argument("--draft", required=True); p.add_argument("--out", required=True)
    for name in ("preview", "apply"):
        p = sub.add_parser(name); p.add_argument("--return", dest="returned", required=True)
        p.add_argument("--workspace", required=True)
        if name == "preview": p.add_argument("--operator", required=True); p.add_argument("--out", required=True); p.add_argument("--journal")
        else: p.add_argument("--preview", required=True); p.add_argument("--journal", required=True)
    args = parser.parse_args(argv)
    if args.command == "prepare": result = prepare(args.archive, args.out)
    elif args.command == "pack": result = make_return(args.archive, args.draft, args.out)
    else:
        from workspace import Workspace
        directory = Path(args.workspace)
        require((directory / "audit-exchange.sqlite").is_file(), "recipient_workspace",
                "Open the existing original Audit workspace; do not create a new destination.")
        workspace = Workspace(directory)
        if args.command == "preview":
            result = plan(workspace, args.returned, args.operator, args.journal); publish(args.out, encoded(result))
        else: result = apply(workspace, args.returned, args.preview, args.journal)
    print(canonical(result))
    return 0

if __name__ == "__main__":
    try: raise SystemExit(main())
    except AuditError as error:
        print(canonical({"ok": False, "error": {"code": error.code, "message": str(error),
                                             "details": error.details}}))
        raise SystemExit(1)

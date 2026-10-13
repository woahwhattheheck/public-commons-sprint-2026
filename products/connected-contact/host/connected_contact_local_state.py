#!/usr/bin/env python3
"""Private, single-host state custody for the original connected contact controller.

This program never contacts Gmail or GitHub. initialize is an explicit deployment
action; receive imports exact original state. Every subsequent mutation is a CAS
in one shared SQLite database. Local receipts are never Git receipts.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import uuid
from datetime import datetime, timezone

KIND = "commons.connected-contact-local-state/v1"
RECEIPT = "commons.connected-contact-local-receipt/v1"
MAX_BYTES = 256 * 1024 * 1024
NAMESPACES = {"account", "intent", "recipient", "checkpoint", "journal", "source-selection"}
HEX = re.compile(r"^[0-9a-f]{64}$")
GIT = re.compile(r"^[0-9a-f]{40}$")

class StateError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status

def need(value, code, message, status=400):
    if not value:
        raise StateError(code, message, status)

def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")

def response_bytes(result):
    data = encoded({"ok": True, "result": result}) + b"\n"
    need(len(data) <= MAX_BYTES, "LOCAL_STATE_RESPONSE_SIZE",
         "The complete original response exceeds 256 MiB; no new state was committed.", 413)
    return data

def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode("utf-8")).hexdigest()

def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def identity(request):
    ns, key = request.get("namespace"), request.get("key")
    need(ns in NAMESPACES and isinstance(key, str) and 0 < len(key.encode("utf-8")) <= 4096
         and not any(ord(c) < 32 or ord(c) == 127 for c in key),
         "LOCAL_STATE_IDENTITY", "Select an original namespace and complete stable key.")
    return ns, key

def operation(request):
    op = request.get("operation_id")
    need(isinstance(op, str) and 0 < len(op.encode("utf-8")) <= 1024
         and not any(ord(c) < 32 or ord(c) == 127 for c in op),
         "LOCAL_STATE_OPERATION", "Retain one original state operation ID.")
    return op

def content(request):
    text = request.get("content")
    need(isinstance(text, str) and len(text.encode("utf-8")) <= MAX_BYTES,
         "LOCAL_STATE_CONTENT", "Supply the complete bounded UTF-8 state.")
    try:
        value = json.loads(text)
    except (ValueError, TypeError):
        raise StateError("LOCAL_STATE_JSON", "State must be complete JSON.")
    need(isinstance(value, dict), "LOCAL_STATE_JSON", "State must be a JSON object.")
    return text, value

def host_identity():
    # Directory binding prevents an accidental independent clone on this host.
    # This is an ownership locator, not evidence that any provider operation ran.
    machine = Path("/etc/machine-id")
    value = machine.read_text().strip() if machine.is_file() else ""
    return {"hostname": os.uname().nodename, "machine_id_sha256": sha(value) if value else None}

def directory(path, create=False):
    root = Path(path)
    need(root.is_absolute(), "LOCAL_STATE_DIRECTORY", "Use the selected absolute coordinator directory.")
    current = Path(root.anchor)
    for part in root.parts[1:]:
        current = current / part
        if current == root and create:
            try:
                current.mkdir(mode=0o700)
            except FileExistsError:
                pass
        try:
            item = current.lstat()
        except FileNotFoundError:
            raise StateError("LOCAL_STATE_NOT_INITIALIZED", "Initialize the selected coordinator explicitly.", 404)
        need(stat.S_ISDIR(item.st_mode) and not stat.S_ISLNK(item.st_mode),
             "LOCAL_STATE_DIRECTORY", "Coordinator components must be real directories.")
    item = root.stat()
    need(item.st_uid == os.getuid() and stat.S_IMODE(item.st_mode) == 0o700,
         "LOCAL_STATE_PERMISSIONS", "Coordinator directory must be owned by the operator and mode 0700.")
    return root

def fsync_directory(root):
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def connection(root, create=False):
    path = root / "contact-state.sqlite"
    if create:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        except FileExistsError:
            pass
        else:
            os.fsync(fd)
            os.close(fd)
            fsync_directory(root)
    try:
        item = path.lstat()
    except FileNotFoundError:
        raise StateError("LOCAL_STATE_NOT_INITIALIZED", "The selected coordinator is not initialized.", 404)
    need(stat.S_ISREG(item.st_mode) and not stat.S_ISLNK(item.st_mode)
         and item.st_uid == os.getuid() and stat.S_IMODE(item.st_mode) == 0o600 and item.st_nlink == 1,
         "LOCAL_STATE_PERMISSIONS", "The original database must be a private regular file.")
    db = sqlite3.connect(path, timeout=30, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA synchronous=FULL")
    db.execute("PRAGMA foreign_keys=ON")
    return db

def schema(db):
    db.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    db.execute("""CREATE TABLE IF NOT EXISTS revisions (
        namespace TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL,
        sha256 TEXT NOT NULL, content TEXT NOT NULL, receipt TEXT NOT NULL,
        PRIMARY KEY(namespace,key,revision))""")
    db.execute("""CREATE TABLE IF NOT EXISTS heads (
        namespace TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL,
        PRIMARY KEY(namespace,key),
        FOREIGN KEY(namespace,key,revision) REFERENCES revisions(namespace,key,revision))""")
    db.execute("""CREATE TABLE IF NOT EXISTS operations (
        operation_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
        namespace TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL,
        FOREIGN KEY(namespace,key,revision) REFERENCES revisions(namespace,key,revision))""")
    db.execute("""CREATE TABLE IF NOT EXISTS batches (
        operation_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, records TEXT NOT NULL)""")

def metadata(db, root, requested):
    row = db.execute("SELECT value FROM metadata WHERE key='coordinator'").fetchone()
    need(row is not None, "LOCAL_STATE_NOT_INITIALIZED", "Explicit coordinator initialization is required.", 404)
    value = json.loads(row["value"])
    need(value["kind"] == KIND and value["coordinator_id"] == requested,
         "LOCAL_STATE_COORDINATOR", "Use the selected original coordinator identity.")
    need(value["directory"] == str(root) and value["host"] == host_identity(),
         "LOCAL_STATE_PLACEMENT", "Use the original shared coordinator placement; do not run a cloned independent account.")
    return value

def snapshot(meta, row):
    if row is None:
        return None
    receipt = json.loads(row["receipt"])
    need(sha(row["content"]) == row["sha256"] and receipt["sha256"] == row["sha256"]
         and receipt["revision"] == row["revision"] and receipt["coordinator_id"] == meta["coordinator_id"],
         "LOCAL_STATE_CORRUPTION", "Original state or receipt bytes changed.")
    return {"kind": "commons.connected-contact-local-snapshot/v1", "coordinator_id": meta["coordinator_id"],
            "namespace": row["namespace"], "key": row["key"], "revision": row["revision"],
            "sha256": row["sha256"], "content": row["content"], "receipt": receipt}

def head(db, ns, key):
    return db.execute("""SELECT r.* FROM revisions r JOIN heads h
        ON r.namespace=h.namespace AND r.key=h.key AND r.revision=h.revision
        WHERE h.namespace=? AND h.key=?""", (ns,key)).fetchone()

def authority(meta, ns, key, value=None):
    binding = meta["authority"]
    if ns == "account":
        selected = next((a for a in binding["accounts"] if a["account_key"] == key), None)
        need(selected is not None, "LOCAL_STATE_ACCOUNT", "This account belongs to another coordinator.")
        if value is not None:
            need(value.get("account_key") == key and str(value.get("profile_id")) == selected["profile_id"]
                 and value.get("provider") == "gmail" and value.get("activity") == "Mail sending",
                 "LOCAL_STATE_ACCOUNT", "Keep the original Gmail account identity and complete state.")

def session_journal_source(source, text, namespace, key):
    """Bind exact original in-session bytes without inventing Git provenance."""
    need(namespace == "checkpoint" and isinstance(key, str),
         "LOCAL_STATE_ORIGIN", "Original session receiving belongs to its checkpoint identity.")
    need(not any(name in source for name in ("commit_sha", "blob_sha", "repository", "path")),
         "LOCAL_STATE_ORIGIN", "Session provenance must not claim an unobserved Git source.")
    value=json.loads(text)
    journal_text=source.get("journal_content")
    input_text=source.get("runtime_input_content")
    need(isinstance(journal_text,str) and isinstance(input_text,str),
         "LOCAL_STATE_ORIGIN", "Keep the complete original session and input bytes.")
    journal=json.loads(journal_text)
    runtime_input=json.loads(input_text)
    source_ref=source.get("source")
    iso_pattern=r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$"
    def original_iso(value):
        if not isinstance(value,str) or not re.fullmatch(iso_pattern,value):
            return False
        try:
            parsed=datetime.fromisoformat(value.replace("Z","+00:00"))
            return parsed.isoformat(timespec="milliseconds").replace("+00:00","Z")==value
        except ValueError:
            return False
    need(isinstance(source_ref,dict) and isinstance(source_ref.get("reference"),str)
         and source_ref["reference"] and isinstance(source_ref.get("custodian"),str)
         and source_ref["custodian"] and original_iso(source_ref.get("observed_at"))
         and original_iso(source.get("observed_at")),
         "LOCAL_STATE_ORIGIN", "Keep the actual source custody and capture time.")
    input_id=source.get("input_sha256")
    lease=source.get("operation_lease")
    state_key=source.get("state_key")
    need(isinstance(input_id,str) and HEX.fullmatch(input_id)
         and isinstance(lease,str) and lease and isinstance(state_key,str) and state_key
         and key==sha(encoded({"input_sha256":input_id,"lease":lease}))
         and source.get("operation_key")==key and source.get("sha256")==sha(text),
         "LOCAL_STATE_ORIGIN", "The original input, lease and checkpoint key changed.")
    journal_identity={"sha256":sha(journal_text),"bytes":len(journal_text.encode("utf-8"))}
    input_identity={"sha256":sha(input_text),"bytes":len(input_text.encode("utf-8"))}
    need(source.get("journal")==journal_identity and source.get("runtime_input")==input_identity
         and isinstance(runtime_input,dict) and isinstance(journal,dict)
         and journal.get("schema")=="commons.connected-first-contact/v1"
         and journal.get("input_sha256")==input_id and journal.get("lease")==lease
         and isinstance(journal.get("input"),dict) and isinstance(journal.get("events"),list),
         "LOCAL_STATE_ORIGIN", "Retain all original session events and exact source hashes.")
    payload_text=value.get("payload_text")
    need(isinstance(payload_text,str),"LOCAL_STATE_ORIGIN","Complete derived checkpoint payload required.")
    payload=json.loads(payload_text)
    measured={"sha256":sha(payload_text),"bytes":len(payload_text.encode("utf-8"))}
    metadata={"schema":"commons.connected-contact-checkpoint/v1","operation_key":key,
              "input_sha256":input_id,"operation_lease":lease,"state_key":state_key,
              "revision":1,"updated_at":source["observed_at"],"active":None,
              "payload":{**measured,"chunks":[{"kind":"local-inline",**measured}]}}
    location={"kind":"commons.connected-contact-session-origin/v1","source":source_ref,
              "operation_key":key,"input_sha256":input_id,"operation_lease":lease,
              "state_key":state_key,"runtime_input":input_identity,"journal":journal_identity}
    expected_payload={"schema":"commons.connected-contact-checkpoint-payload/v1",
                      "runtime_input":runtime_input,"journal":journal,"transports":[]}
    selected=journal.get("returned_mailbox_revision")
    if isinstance(selected,dict) and selected.get("revision_kind")=="draft":
        expected_payload["session_input_revision_source"]={
            "schema":"commons.contact-checkpoint-session-input-revision-source/v1",
            "operation_key":key,"input_sha256":input_id,"operation_lease":lease,"state_key":state_key,
            "source":source_ref,"runtime_input":input_identity,"journal":journal_identity,
            "original_event_count":len(journal["events"]),"selection_sha256":sha(encoded(selected))}
    need(value.get("metadata")==metadata and value.get("original_location")==location
         and payload==expected_payload,
         "LOCAL_STATE_ORIGIN", "The new checkpoint must contain the unchanged entire original session.")
    return source

def original_source(source, text, namespace=None, key=None):
    if isinstance(source,dict) and source.get("kind")=="original-session-journal-readback":
        return session_journal_source(source,text,namespace,key)
    if isinstance(source, dict) and source.get("kind") == "git-original-ref-readback":
        value=json.loads(text)
        need(isinstance(source.get("repository"),str) and "/" in source["repository"]
             and isinstance(source.get("branch"),str) and GIT.fullmatch(source.get("ref_sha",""))
             and source.get("sha256")==sha(text) and isinstance(source.get("receipt"),dict)
             and value.get("schema")=="commons.local-contact-intent/v1"
             and value.get("branch")==source["branch"] and value.get("reference")==source["ref_sha"],
             "LOCAL_STATE_ORIGIN","Keep the original intent ref and its exact received identity.")
        receipt=source["receipt"]
        need(receipt.get("status")=="ALREADY_RESERVED" and receipt.get("branch")==source["branch"]
             and receipt.get("ref_sha")==source["ref_sha"],
             "LOCAL_STATE_ORIGIN","Original intent readback does not match the selected source.")
        return source
    if isinstance(source,dict) and source.get("kind")=="git-original-checkpoint-readback":
        value=json.loads(text)
        metadata_text=source.get("metadata_content")
        need(isinstance(metadata_text,str),"LOCAL_STATE_ORIGIN","Keep the complete original checkpoint pointer.")
        original_source({**source,"kind":"git-original-readback",
                         "sha256":sha(metadata_text)},metadata_text)
        metadata=json.loads(metadata_text)
        need(value.get("metadata")==metadata and isinstance(value.get("payload_text"),str)
             and sha(value["payload_text"])==metadata.get("payload",{}).get("sha256")
             and len(value["payload_text"].encode("utf-8"))==metadata["payload"].get("bytes")
             and source.get("sha256")==sha(text),
             "LOCAL_STATE_ORIGIN","Retain the exact original checkpoint payload bound by its original pointer.")
        return source
    need(isinstance(source, dict) and source.get("kind") == "git-original-readback",
         "LOCAL_STATE_ORIGIN", "Receive an exact original Git state readback with its source identity.")
    need(isinstance(source.get("repository"), str) and "/" in source["repository"]
         and isinstance(source.get("path"), str) and source["path"]
         and GIT.fullmatch(source.get("commit_sha", "")) and GIT.fullmatch(source.get("blob_sha", "")),
         "LOCAL_STATE_ORIGIN", "Original repository, path, commit and blob identities are required.")
    raw = text.encode("utf-8")
    blob = hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()
    need(source["blob_sha"] == blob and source.get("sha256") == sha(raw),
         "LOCAL_STATE_ORIGIN", "Imported bytes must match the original Git blob and full SHA-256.")
    need(isinstance(source.get("observed_at"), str) and isinstance(source.get("receipt"), dict),
         "LOCAL_STATE_ORIGIN", "Retain the actual original readback envelope and observation.")
    # The complete envelope is retained as evidence, not presented as a local
    # provider invocation or a newly created Git commit.
    return source

def receive_batch(db, meta, request):
    """Adopt one complete original selection under one immutable batch ID."""
    entries = request.get("entries")
    need(isinstance(entries, list) and 0 < len(entries) <= 10000,
         "LOCAL_STATE_ADOPTION", "Supply all selected original entries in one receiving request.")
    needed = set()
    normalized = []
    for entry in entries:
        ns, key = identity(entry)
        need((ns,key) not in needed, "LOCAL_STATE_ADOPTION", "Duplicate original adoption identity.")
        needed.add((ns,key))
        text, value = content(entry)
        authority(meta, ns, key, value)
        need(entry.get("expected_sha256") is None, "LOCAL_STATE_ADOPTION", "Initial adoption is create-only.")
        origin = original_source(entry.get("origin"), text, ns, key)
        normalized.append({"namespace":ns,"key":key,"content":text,"origin":origin})
    op = operation(request)
    fingerprint = sha(encoded({"action":"receive-batch","entries":normalized}))
    accepted = db.execute("SELECT * FROM batches WHERE operation_id=?", (op,)).fetchone()
    if accepted:
        need(accepted["fingerprint"] == fingerprint, "LOCAL_STATE_OPERATION_CHANGED",
             "The original batch operation ID names a different complete selection.", 409)
        results=[]
        for row in json.loads(accepted["records"]):
            retained=db.execute("SELECT * FROM revisions WHERE namespace=? AND key=? AND revision=?",
                                (row["namespace"],row["key"],row["revision"])).fetchone()
            need(retained is not None, "LOCAL_STATE_CORRUPTION", "An original batch revision is missing.")
            results.append(snapshot(meta,retained))
    else:
        results=[]
        for i, entry in enumerate(normalized):
            item={**entry,"operation_id":op+":"+str(i),"action":"receive"}
            results.append(write(db,meta,item,receive=True,record_operation=False))
        refs=[{k:row[k] for k in ("namespace","key","revision")} for row in results]
        db.execute("INSERT INTO batches VALUES(?,?,?)",(op,fingerprint,encoded(refs).decode("utf-8")))
    result={"kind":KIND,"coordinator_id":meta["coordinator_id"],"operation_id":op,
            "status":"ORIGINAL_STATE_RECEIVED","records":results}
    response_bytes(result)
    return result

def write(db, meta, request, receive=False, record_operation=True):
    ns, key = identity(request)
    op = operation(request)
    text, value = content(request)
    authority(meta, ns, key, value)
    digest = sha(text)
    before = head(db, ns, key)
    expected = request.get("expected_sha256")
    if receive:
        origin = original_source(request.get("origin"), text, ns, key)
        need(expected is None, "LOCAL_STATE_ADOPTION", "Initial adoption is create-only.")
    else:
        need(expected is None or isinstance(expected,str) and HEX.fullmatch(expected),
             "LOCAL_STATE_CAS", "Select the complete prior state SHA-256 or explicit null.")
        origin = None
    normalized = {"action": "receive" if receive else "compareAndSwap", "namespace": ns,
                  "key": key, "expected_sha256": expected, "content": text, "origin": origin}
    fingerprint = sha(encoded(normalized))
    accepted = db.execute("SELECT * FROM operations WHERE operation_id=?", (op,)).fetchone() if record_operation else None
    if accepted:
        need(accepted["fingerprint"] == fingerprint, "LOCAL_STATE_OPERATION_CHANGED",
             "The original state operation ID names different bytes.", 409)
        row = db.execute("SELECT * FROM revisions WHERE namespace=? AND key=? AND revision=?",
                         (accepted["namespace"],accepted["key"],accepted["revision"])).fetchone()
        return snapshot(meta,row)
    if receive:
        need(before is None, "LOCAL_STATE_CONFLICT", "Original state was already adopted; receive its original receipt.", 409)
    else:
        need((before["sha256"] if before else None) == expected,
             "LOCAL_STATE_CONFLICT", "The selected original state advanced; reread before changing it.", 409)
        need(before is not None or ns in {"intent","recipient","journal","source-selection","checkpoint"},
             "LOCAL_STATE_ORIGINAL_REQUIRED", "Import the complete original account instead of creating an empty replacement.")
    revision = before["revision"] + 1 if before else 1
    prior_receipt = json.loads(before["receipt"]) if before else None
    receipt = {"schema": RECEIPT, "coordinator_id": meta["coordinator_id"], "namespace": ns, "key": key,
               "revision": revision, "sha256": digest, "bytes": len(text.encode("utf-8")),
               "previous_sha256": before["sha256"] if before else None,
               "operation_id": op, "action": normalized["action"], "created_at": now(),
               "origin": origin if receive else prior_receipt["origin"] if prior_receipt else None}
    db.execute("INSERT INTO revisions VALUES(?,?,?,?,?,?)",
               (ns,key,revision,digest,text,encoded(receipt).decode("utf-8")))
    db.execute("""INSERT INTO heads VALUES(?,?,?) ON CONFLICT(namespace,key)
               DO UPDATE SET revision=excluded.revision""", (ns,key,revision))
    if record_operation:
        db.execute("INSERT INTO operations VALUES(?,?,?,?,?)", (op,fingerprint,ns,key,revision))
    result=snapshot(meta,head(db,ns,key))
    response_bytes(result)
    return result

def execute(root_path, request):
    need(sys.platform == "linux" and hasattr(os,"getuid") and hasattr(os,"O_NOFOLLOW")
         and hasattr(os,"O_DIRECTORY"), "LOCAL_STATE_PLATFORM",
         "Run the original controller and coordinator together in the selected Linux environment; native Windows is unsupported.")
    need(isinstance(request,dict) and request.get("kind") == KIND,
         "LOCAL_STATE_REQUEST", "Use the original typed local-state request.")
    action = request.get("action")
    root = directory(root_path, create=action=="initialize")
    db = connection(root, create=action=="initialize")
    try:
        db.execute("BEGIN IMMEDIATE" if action in {"initialize","receive","receive-batch","compare-and-swap"} else "BEGIN")
        schema(db)
        if action == "initialize":
            authority_value = request.get("authority")
            need(isinstance(authority_value,dict) and isinstance(authority_value.get("accounts"),list)
                 and authority_value["accounts"] and isinstance(authority_value.get("scope_id"),str)
                 and authority_value["scope_id"],
                 "LOCAL_STATE_AUTHORITY", "Bind the one shared coordinator to its original account-wide scope.")
            keys=set()
            for account in authority_value["accounts"]:
                need(isinstance(account,dict) and HEX.fullmatch(account.get("account_key",""))
                     and isinstance(account.get("profile_id"),str) and account["profile_id"].isdigit()
                     and account["account_key"] not in keys,
                     "LOCAL_STATE_AUTHORITY", "Each original account must have one complete key and profile identity.")
                keys.add(account["account_key"])
            selected = request.get("coordinator_id")
            need(isinstance(selected,str) and str(uuid.UUID(selected)) == selected,
                 "LOCAL_STATE_COORDINATOR", "Select and retain the original coordinator UUID before initializing.")
            existing = db.execute("SELECT value FROM metadata WHERE key='coordinator'").fetchone()
            if existing:
                result = metadata(db,root,selected)
                need(result["authority"] == authority_value,
                     "LOCAL_STATE_AUTHORITY", "Existing coordinator authority cannot be replaced.")
            else:
                result={"kind":KIND,"coordinator_id":selected,"directory":str(root),"host":host_identity(),
                        "authority":authority_value,"created_at":now()}
                db.execute("INSERT INTO metadata VALUES('coordinator',?)",(encoded(result).decode("utf-8"),))
        else:
            meta=metadata(db,root,request.get("coordinator_id"))
            if action == "verify":
                result=meta
            elif action in {"receive","compare-and-swap"}:
                result=write(db,meta,request,receive=action=="receive")
            elif action == "receive-batch":
                result=receive_batch(db,meta,request)
            elif action in {"read","history"}:
                ns,key=identity(request)
                authority(meta,ns,key)
                if action == "read":
                    result=snapshot(meta,head(db,ns,key))
                else:
                    after,limit=request.get("after_revision",0),request.get("limit",100)
                    need(type(after) is int and after >= 0 and type(limit) is int and 1 <= limit <= 100,
                         "LOCAL_STATE_PAGE","Select a bounded history page.")
                    cursor=db.execute("""SELECT * FROM revisions WHERE namespace=? AND key=?
                        AND revision>? ORDER BY revision LIMIT ?""",(ns,key,after,limit+1))
                    records=[]
                    used=0
                    more=False
                    for row in cursor:
                        if len(records)==limit:
                            more=True
                            break
                        item=snapshot(meta,row)
                        item_bytes=len(encoded(item))
                        # Reserve the exact largest cursor envelope for this row;
                        # bodies are fetched one at a time, never all revisions.
                        overhead=len(encoded({"ok":True,"result":{"records":[],
                                                   "next_revision":item["revision"]}}))+1
                        candidate=overhead+used+item_bytes+(1 if records else 0)
                        if candidate>MAX_BYTES:
                            need(bool(records),"LOCAL_STATE_RESPONSE_SIZE",
                                 "One complete original history record exceeds the response limit.",413)
                            more=True
                            break
                        records.append(item)
                        used+=item_bytes+(1 if len(records)>1 else 0)
                    result={"records":records,
                            "next_revision":records[-1]["revision"] if more else None}
            else:
                raise StateError("LOCAL_STATE_ACTION","Unsupported local coordinator action.")
        response_bytes(result)
        db.execute("COMMIT")
        if action in {"initialize","receive","receive-batch","compare-and-swap"}:
            fsync_directory(root)
        return result
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise
    finally:
        db.close()

def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory",required=True)
    args=parser.parse_args()
    raw=sys.stdin.buffer.read(MAX_BYTES+1)
    need(len(raw)<=MAX_BYTES,"LOCAL_STATE_REQUEST_SIZE","Complete local request exceeds 256 MiB.")
    try:
        request=json.loads(raw.decode("utf-8"))
    except (UnicodeError,ValueError):
        raise StateError("LOCAL_STATE_REQUEST","Use a complete UTF-8 JSON request.")
    result=execute(args.directory,request)
    sys.stdout.buffer.write(response_bytes(result))
    sys.stdout.buffer.flush()

if __name__=="__main__":
    try:
        main()
    except StateError as error:
        sys.stdout.buffer.write(encoded({"ok":False,"error":{"code":error.code,"status":error.status,
                                                           "message":str(error)}})+b"\n")
        sys.stdout.buffer.flush()
        raise SystemExit(1)
    except Exception:
        # Native details and private payload snippets are not printed.
        sys.stdout.buffer.write(encoded({"ok":False,"error":{"code":"LOCAL_STATE_FAILURE","status":500,
                                                           "message":"The original coordinator did not complete; retain this operation ID and inspect its private host."}})+b"\n")
        sys.stdout.buffer.flush()
        raise SystemExit(1)

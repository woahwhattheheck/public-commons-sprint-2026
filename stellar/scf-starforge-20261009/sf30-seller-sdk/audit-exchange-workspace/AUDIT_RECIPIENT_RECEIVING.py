#!/usr/bin/env python3
"""Continue one existing Audit case through offline recipient authoring and native receiving."""
from __future__ import annotations
import argparse
import base64
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime
import zipfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import AuditError, canonical, digest, require
from workspace import Workspace
import audit_recipient_review as recipient

OPERATION = "AUDIT-RECIPIENT-REVIEW-24EA-20261013"
_INTERRUPTED = None
_DRAINING = False

class ReceivingInterrupted(KeyboardInterrupt): pass

def interrupted(number, _frame):
    global _INTERRUPTED
    if _INTERRUPTED is None:
        _INTERRUPTED = number
        if not _DRAINING:
            raise ReceivingInterrupted("The original receiving was interrupted by signal " + str(number))


def data(value): return (canonical(value) + "\n").encode()
def read_json(path): return recipient.checked_json(recipient.read_file(path, recipient.MAX_PACKAGE), recipient.MAX_PACKAGE)
def put(path, value): recipient.publish(path, data(value))
def identity(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "receiving_file", "Retain an ordinary complete file.")
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno()); h = hashlib.sha256(); size = 0
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""): h.update(chunk); size += len(chunk)
        after = os.fstat(stream.fileno())
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) and size == before.st_size,
            "receiving_file", "A selected file changed during its complete read.")
    return {"bytes": size, "sha256": h.hexdigest()}

def native(workspace, root, label, action, inputs):
    path = root / "native-requests" / (label + ".json")
    if path.exists():
        request = read_json(path)
        require(request["action"] == action and request["inputs"] == inputs,
                "receiving_request", "Retain the complete original native request.")
    else:
        import uuid
        request = {"requestId": str(uuid.uuid4()), "expectedVersion": workspace.state()["version"],
                   "action": action, "inputs": inputs}
        put(path, request)
    result_path = root / "native-results" / (label + ".json")
    if result_path.exists():
        # A retained success cannot be turned into a fresh request after store loss.
        workspace.perform({"action": "operation.get", "inputs": {"requestId": request["requestId"]}})
    outcome = workspace.perform(request)
    result = {"request": request, "result": outcome["result"]}
    put(result_path, result)
    return outcome["result"]

def process_identity(pid):
    try:
        raw = Path("/proc") / str(pid) / "stat"
        fields = raw.read_text().rsplit(")", 1)[1].split()
        return {"pid": pid, "parent": int(fields[1]), "start": fields[19], "state": fields[0]}
    except (OSError, ValueError, IndexError): return None

def collect_children(known):
    rows = []
    for entry in Path("/proc").iterdir():
        if entry.name.isdigit():
            row = process_identity(int(entry.name))
            if row: rows.append(row)
    changed = True
    while changed:
        changed = False
        for row in rows:
            if row["parent"] in known and row["pid"] not in known:
                parent = process_identity(row["parent"])
                if parent and parent["start"] == known[row["parent"]]["start"]:
                    known[row["pid"]] = row; changed = True
    return [row for pid, prior in known.items()
            if (row := process_identity(pid)) and row["start"] == prior["start"] and row["state"] != "Z"]

def signal_owned(rows, number):
    for row in rows:
        current = process_identity(row["pid"])
        if current and current["start"] == row["start"] and current["state"] != "Z":
            try: os.kill(row["pid"], number)
            except ProcessLookupError: pass

def drain_owned(child, known):
    # Playwright may put Chromium in another process group. Track the actual
    # descendant PID/start identity as well as the original Node parent.
    deadline = time.monotonic() + 20
    first = True
    while True:
        live = collect_children(known)
        if not live: break
        if first or time.monotonic() >= deadline:
            signal_owned(live, signal.SIGTERM if first else signal.SIGKILL)
            first = False
        try: child.wait(timeout=0.2)
        except subprocess.TimeoutExpired: pass
        time.sleep(0.05)
    child.wait()

def owned_child(command, cwd, log, lock_fd):
    """Release the inherited lease only after every observed owned child exits."""
    global _DRAINING
    with log.open("ab", buffering=0) as output:
        child = None; known = {}
        previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT})
        try:
            child = subprocess.Popen(command, cwd=cwd, stdin=subprocess.DEVNULL, stdout=output,
                                     stderr=subprocess.STDOUT, pass_fds=(lock_fd,), start_new_session=True)
            row = process_identity(child.pid)
            require(row is not None, "receiving_process", "The original child identity did not return.")
            known[child.pid] = row
            signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
            print(canonical({"stage": "recipient-browser-started", "pid": child.pid}), flush=True)
            while True:
                collect_children(known)
                try: code = child.wait(timeout=0.2); break
                except subprocess.TimeoutExpired: pass
        finally:
            # A latched parent handler cannot interrupt this drain a second time.
            _DRAINING = True
            try:
                if child is not None: drain_owned(child, known)
                signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
            finally: _DRAINING = False
        if _INTERRUPTED is not None:
            raise ReceivingInterrupted("The original receiving was interrupted after its owned children drained.")
        require(code == 0, "receiving_browser", "Continue the same saved browser course and log.",
                {"returncode": code, "log": str(log)}, 409)

def validate_plan(plan, original):
    require(isinstance(plan, dict) and set(plan) == {"schema", "reviews"}
            and plan["schema"] == "commons.audit-recipient-receiving-plan.v1"
            and isinstance(plan["reviews"], list) and 1 <= len(plan["reviews"]) <= 1000,
            "receiving_plan", "Supply explicit complete recipient proposals.")
    _, _, kinds, _ = recipient.package(original)
    import uuid
    expected = recipient.FIELDS - {"localId", "baseReviewSha256", "sourceSha256"}
    seen = set()
    for row in plan["reviews"]:
        require(isinstance(row, dict) and set(row) == expected, "receiving_plan",
                "Every proposal keeps all native review fields, including blank id for a new review.")
        require(not row["id"] or row["id"] not in seen, "receiving_plan", "Select each existing native review once.")
        seen.add(row["id"])
        rev = kinds.get("revision", {}).get(row["revisionId"])
        require(rev is not None, "receiving_plan", "Select a retained original revision.")
        prior = kinds.get("review", {}).get(row["id"])
        full = {**copy.deepcopy(row), "localId": str(uuid.uuid4()), "sourceSha256": rev["sha256"],
                "baseReviewSha256": digest(canonical(prior).encode()) if prior else ""}
        recipient.validate_review(full, kinds)

def compare_received(original_snapshot, received_snapshot, author_id, package_sha, original_members):
    originals = {(r["kind"], r["id"]): r["payload"] for r in original_snapshot["records"]}
    received = {(r["kind"], r["payload"].get("receivedFrom", {}).get("recordId")): r["payload"]
                for r in received_snapshot["records"]
                if r["payload"].get("receivedFrom", {}).get("workspaceId") == author_id
                and r["payload"].get("receivedFrom", {}).get("packageSha256") == package_sha}
    require(set(originals) == set(received), "receiving_records", "The native receiving omitted an original record.")
    id_map = {old["id"]: received[key]["id"] for key, old in originals.items()}
    export_map = {row["receivedFrom"]["exportId"]: row for row in received_snapshot["priorExports"]
                  if row.get("receivedFrom", {}).get("workspaceId") == author_id
                  and row["receivedFrom"].get("packageSha256") == package_sha}
    preserved = {"original", "receivedFrom", "receivedHistory", "derivedHistory", "receivedValidation",
                 "nativeIdentity", "selection", "selectionSummary"}
    def remapped(value, field=None):
        # Compare the unchanged original receiver's documented identity projection.
        if field in preserved: return copy.deepcopy(value)
        if isinstance(value, list): return [remapped(item, field) for item in value]
        if isinstance(value, dict): return {key: remapped(item, key) for key, item in value.items()}
        if isinstance(value, str):
            if field in {"id", "sourceId", "revisionId", "parentId", "currentRevisionId", "editionId", "analysisId", "projectionId", "exportId"}:
                return id_map.get(value, export_map.get(value, {}).get("id", value))
            if field == "downloadUrl" and value.startswith("/api/download/"):
                return export_map.get(value[len("/api/download/"):], {}).get("downloadUrl", value)
        return value
    for key, old in originals.items():
        new = received[key]
        require(new["id"] != old["id"], "receiving_identity", "Independent receiving requires its original remapped identities.")
        rebuilt = copy.deepcopy(old)
        if key[0] == "revision":
            from model import validate_document
            source = originals[("source", old["sourceId"])]
            obj = next(row for row in original_snapshot["objects"] if row["sha256"] == old["sha256"])
            model, validation = validate_document(original_members[obj["path"]], source["nativeIdentity"],
                                                  old.get("selectedSchema"), old.get("profileIds"))
            history = new.get("derivedHistory", [])
            prefix = old.get("derivedHistory", [])
            require(len(history) == len(prefix) + 1 and history[:-1] == prefix,
                    "receiving_history", "Original native validation history was lost.")
            addition = history[-1]
            require(addition == {"workspaceId": author_id, "revisionId": old["id"],
                    "packageSha256": package_sha, "receivedAt": addition.get("receivedAt"),
                    "model": old["model"], "validation": old["validation"], "declaredVersion": old.get("declaredVersion")},
                    "receiving_history", "The original revalidation receipt lost its full predecessor.")
            timestamps = [addition["receivedAt"], new["validation"]["startedAt"], new["validation"]["endedAt"]]
            require(all(isinstance(value, str) and value.endswith("Z") for value in timestamps),
                    "receiving_timestamp", "The original revalidation times are incomplete.")
            parsed = [datetime.fromisoformat(value.replace("Z", "+00:00")) for value in timestamps]
            require(parsed[1] <= parsed[2] <= parsed[0], "receiving_timestamp", "Original revalidation time order differs.")
            # Native timestamp values are observational; every computed field is
            # still compared to the unchanged original validation engine.
            validation["startedAt"], validation["endedAt"] = timestamps[1], timestamps[2]
            rebuilt.update({"model": model, "validation": validation,
                            "declaredVersion": model["declaredVersion"], "derivedHistory": history})
        expected = remapped(rebuilt)
        previous = copy.deepcopy(old.get("receivedHistory", []))
        if old.get("receivedFrom"): previous.append(copy.deepcopy(old["receivedFrom"]))
        if previous: expected["receivedHistory"] = previous
        expected["receivedFrom"] = new["receivedFrom"]
        if key[0] == "analysis" and old["status"] in {"queued", "running"}:
            expected["status"] = "received-" + old["status"]
        require(new == expected, "receiving_record", "The complete native received record differs beyond its original identity projection.",
                {"kind": key[0], "recordId": key[1]})
    source_objects = {(r["sha256"], r["bytes"]) for r in original_snapshot["objects"]}
    received_objects = {(r["sha256"], r["bytes"]) for r in received_snapshot["objects"]}
    require(source_objects <= received_objects, "receiving_objects", "Full native receiving omitted original source/output bytes.")
    original_ops = {o["id"]: o for o in original_snapshot["operations"]}
    received_ops = {r["payload"]["original"]["id"]: r["payload"]["original"]
                    for r in received_snapshot["records"] if r["kind"] == "received-operation"
                    and r["payload"].get("originWorkspaceId") == author_id
                    and r["payload"].get("packageSha256") == package_sha}
    require(received_ops == original_ops, "receiving_operations", "The receiving lost original accepted request history.")
    return {"records": len(originals), "objects": len(source_objects), "operations": len(original_ops)}

def complete_archive(root, result):
    put(root / "RUN_RESULT.json", result)
    paths = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if not path.is_file() or path.is_symlink() or path.name.endswith(".lock") or "/profile/" in "/" + relative:
            continue
        if relative in {"ARCHIVE_INDEX.json", "COMPLETE.json"} or path.name.startswith("."):
            continue
        paths.append((relative, path))
    index = {"schema": "commons.audit-recipient-complete-archive.v1", "operation": OPERATION,
             "members": [{"path": name, **identity(path)} for name, path in paths],
             "exclusions": ["Live lock files and reproducible browser profile; complete downloaded working copies, manuscript, original bytes and native receiving are included."]}
    put(root / "ARCHIVE_INDEX.json", index)
    paths.append(("ARCHIVE_INDEX.json", root / "ARCHIVE_INDEX.json"))
    output = root.parent / ("Audit_Recipient_Operated_" + digest(data(result["input"]))[:16] + ".zip")
    fd, pending = tempfile.mkstemp(prefix=".audit-recipient-", dir=root.parent)
    try:
        with os.fdopen(fd, "w+b") as stream:
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                for name, path in paths:
                    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                    info.create_system = 3; info.external_attr = (stat.S_IFREG | 0o600) << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    with archive.open(info, "w", force_zip64=True) as out, path.open("rb") as source:
                        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""): out.write(chunk)
            stream.flush(); os.fsync(stream.fileno())
        with zipfile.ZipFile(pending) as archive:
            require(set(archive.namelist()) == {name for name, _ in paths}, "receiving_archive", "The full archive inventory changed.")
            for name, path in paths:
                h = hashlib.sha256(); size = 0
                with archive.open(name) as source:
                    for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""): h.update(chunk); size += len(chunk)
                require({"bytes": size, "sha256": h.hexdigest()} == identity(path), "receiving_archive", "An archived complete member differs.")
        try: os.link(pending, output)
        except FileExistsError:
            require(identity(output) == identity(pending), "receiving_archive", "Preserve a differing earlier whole archive.")
    finally:
        os.unlink(pending)
    receipt = {"schema": "commons.audit-recipient-complete.v1", "operation": OPERATION,
               "input": result["input"], "archive": {"path": str(output), **identity(output)},
               "renderedRecipientReady": False,
               "remaining": "Producing operator must open and inspect the captured desktop/narrow images and every outgoing recipient attachment, then repair any concrete issue before claiming ready."}
    put(root / "COMPLETE.json", receipt)
    return receipt

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("workspace", "archive", "archive-sha256", "review-plan", "directory", "operator", "chromium", "playwright-module"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--node", default="node")
    args = parser.parse_args(argv)
    root = Path(args.directory).expanduser().resolve()
    require(root != HERE and HERE not in root.parents, "receiving_directory", "Keep this original receiving outside installed source.")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / "operation.lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        original = recipient.read_file(args.archive, recipient.MAX_PACKAGE)
        require(digest(original) == args.archive_sha256, "receiving_input", "The selected original export differs.")
        plan_raw = recipient.read_file(args.review_plan, recipient.MAX_DRAFT)
        plan = recipient.checked_json(plan_raw); validate_plan(plan, original)
        _, snapshot, _, _ = recipient.package(original)
        directory = Path(args.workspace).expanduser().resolve()
        require((directory / "audit-exchange.sqlite").is_file(), "receiving_workspace", "Use the existing original author workspace.")
        require(directory != root and root not in directory.parents and directory not in root.parents,
                "receiving_directory", "Keep the receiving journal separate from the original native store.")
        declared = read_json(HERE / "SOURCE_FILES.json")["files"]
        require(len(declared) == len(set(declared)), "receiving_source", "The source inventory repeats a member.")
        source_rows = []
        for name in declared:
            relative = Path(name)
            require(not relative.is_absolute() and ".." not in relative.parts, "receiving_source", "Use the original complete source inventory.")
            source_rows.append({"path": name, **identity(HERE / relative)})
        selected = {"operation": OPERATION, "applicationSource": source_rows, "workspace": str(directory), "workspaceId": snapshot["workspace"]["workspaceId"],
                    "originalArchive": {"bytes": len(original), "sha256": digest(original)},
                    "reviewPlan": {"bytes": len(plan_raw), "sha256": digest(plan_raw)},
                    "operator": recipient.string(args.operator, 240, False)}
        put(root / "INPUT.json", selected)
        recipient.publish(root / "original-review.zip", original)
        recipient.publish(root / "REVIEW_PLAN.json", plan_raw)
        if (root / "COMPLETE.json").exists():
            receipt = read_json(root / "COMPLETE.json")
            require(receipt["input"] == selected and identity(receipt["archive"]["path"])
                    == {k: receipt["archive"][k] for k in ("bytes", "sha256")},
                    "receiving_complete", "The retained full receiving result differs.")
            print(canonical(receipt), flush=True); return 0
        if (root / "RUN_RESULT.json").exists():
            result = read_json(root / "RUN_RESULT.json")
            require(result["input"] == selected, "receiving_complete", "The completed native run belongs to another source.")
            # Native and browser work are already closed. Preserve the exact
            # original index/files through a packaging-only continuation.
            receipt = complete_archive(root, result)
            print(canonical({"stage": "recipient-archive-resumed", **receipt}), flush=True)
            return 0
        for name in declared:
            relative = Path(name)
            require(not relative.is_absolute() and ".." not in relative.parts, "receiving_source", "Use the original complete source inventory.")
            recipient.publish(root / "application" / relative, recipient.read_file(HERE / relative, recipient.MAX_PACKAGE))
        author = Workspace(directory)
        try:
            require(author.state()["workspaceId"] == selected["workspaceId"], "receiving_workspace",
                    "The original author workspace identity differs.")
            require(not any(r["status"] in {"running", "queued"} for r in author.state()["analysisRuns"]),
                    "receiving_active", "Continue the recipient course after the existing original analysis owner completes.")
            delivery = root / "recipient"
            receipt = recipient.prepare(root / "original-review.zip", delivery)
            put(root / "PREPARED.json", receipt)
            # Repeat the same prepared publication to demonstrate exact-byte reopen.
            require(recipient.prepare(root / "original-review.zip", delivery) == receipt,
                    "receiving_prepare", "The repeated complete original preparation changed.")
            browser = root / "browser"
            if not (browser / "BROWSER_RESULT.json").exists():
                owned_child([args.node, str(HERE / "AUDIT_RECIPIENT_BROWSER.mjs"),
                         "--directory", str(browser), "--delivery", str(delivery),
                         "--plan", str(root / "REVIEW_PLAN.json"), "--chromium", args.chromium,
                         "--playwright-module", args.playwright_module],
                        HERE, root / "browser.log", lock.fileno())
            browser_result = read_json(browser / "BROWSER_RESULT.json")
            for member in browser_result["files"]:
                name = Path(member["path"])
                require(not name.is_absolute() and ".." not in name.parts,
                        "receiving_browser", "The retained browser member path differs.")
                require(identity(browser / name) == {k: member[k] for k in ("bytes", "sha256")},
                        "receiving_browser", "A completed browser output changed.")
            require(browser_result["input"]["inputSha256"] == receipt["inputSha256"]
                    and browser_result["input"]["planSha256"] == digest(plan_raw),
                    "receiving_browser", "The whole operated browser selected another source.")
            returned = browser / "Audit_Recipient_Return.zip"
            raw, source_raw, draft_raw, manuscript, _ = recipient.read_return(returned)
            require(source_raw == original, "receiving_original", "The recipient return changed original archive bytes.")
            require(manuscript["manuscriptId"] == browser_result["manuscriptId"], "receiving_manuscript", "Browser and native selected different manuscripts.")
            for row, wanted in zip(manuscript["editions"][-1]["reviews"], plan["reviews"]):
                require(recipient.native_inputs(row) == {k: v for k, v in wanted.items() if k != "id" or v},
                        "receiving_proposal", "The complete returned proposal differs from the selected explicit plan.")
            require(len(manuscript["editions"][-1]["reviews"]) == len(plan["reviews"]),
                    "receiving_proposal", "The complete returned proposal count differs.")
            journal = root / "acceptance"
            if (root / "ACCEPTANCE_PREVIEW.json").exists():
                preview = read_json(root / "ACCEPTANCE_PREVIEW.json")
            else:
                preview = recipient.plan(author, returned, args.operator, journal)
                put(root / "ACCEPTANCE_PREVIEW.json", preview)
            # Persist the same complete native intent, accept its first request once,
            # and recover it through operation.get with the original local result absent.
            # The actual returned reply is retained separately, never discarded.
            if not (root / "FIRST_ACCEPTED_REPLY.json").exists():
                with recipient.held(journal):
                    selected_return = recipient.scope(raw, manuscript)
                    recipient.publish(journal / "SOURCE.json", recipient.encoded(selected_return))
                    recipient.publish(journal / "recipient-return.zip", raw)
                    for proposed in preview["reviews"]:
                        request = proposed["request"]
                        recipient.publish(journal / "requests" / (request["requestId"] + ".json"),
                                          recipient.encoded({"source": selected_return, "localId": proposed["localId"], "request": request}))
                    first = preview["reviews"][0]["request"]
                    result = author.perform(first)
                    put(root / "FIRST_ACCEPTED_REPLY.json", {"request": first, "result": result["result"]})
            accepted = recipient.apply(author, returned, root / "ACCEPTANCE_PREVIEW.json", journal)
            version = author.state()["version"]
            repeated = recipient.apply(author, returned, root / "ACCEPTANCE_PREVIEW.json", journal)
            require(repeated == accepted and author.state()["version"] == version,
                    "receiving_replay", "The exact accepted recipient replay created another native version.")
            put(root / "ACCEPTED.json", accepted)
            export = native(author, root, "complete-original-application", "export.create",
                            {"kind": "application", "actor": args.operator,
                             "note": "Complete original Audit source, all revisions and recipient review acceptance."})
            record, body = author.download(export["id"])
            require(identity(root / "original-review.zip") == selected["originalArchive"],
                    "receiving_original", "The whole original archive changed.")
            recipient.publish(root / "Audit_Exchange_Application.zip", body)
            _, original_snapshot, _, members = recipient.package(body)
            require(all(members["application/" + name] == (root / "application" / name).read_bytes() for name in declared),
                    "receiving_application", "The complete application export differs from selected full source.")
            received = Workspace(root / "received-workspace", "Received original Audit recipient review")
            try:
                accepted_receive = native(received, root, "receive-complete-application", "workspace.receive",
                    {"contentBase64": base64.b64encode(body).decode("ascii"), "name": "Audit_Exchange_Application.zip",
                     "actor": args.operator, "note": "Independent complete receiving of the same original application."})
                with received.connect() as db:
                    db.execute("BEGIN"); received_snapshot, _ = received._snapshot(db)
                compared = compare_received(original_snapshot, received_snapshot, selected["workspaceId"], digest(body), members)
                put(root / "RECEIVED_SNAPSHOT.json", received_snapshot)
                second = native(received, root, "reexport-complete-received-application", "export.create",
                                {"kind": "application", "actor": args.operator, "note": "Reopen and retain the complete received application and original history."})
                second_record, second_body = received.download(second["id"])
                recipient.publish(root / "Audit_Exchange_Received_Application.zip", second_body)
                _, cold_snapshot, _, _ = recipient.package(second_body)
                require(cold_snapshot["workspace"]["workspaceId"] == received.state()["workspaceId"],
                        "receiving_reopen", "The cold receiving package lost its actual native identity.")
                reopened = Workspace(root / "received-workspace")
                try: require(reopened.state() == received.state(), "receiving_reopen", "The actual receiving workspace did not reopen unchanged.")
                finally: reopened.close()
            finally: received.close()
            result = {"schema": "commons.audit-recipient-native-result.v1", "operation": OPERATION, "input": selected,
                      "browser": browser_result, "accepted": accepted, "sameRequestReplayVersion": version,
                      "application": record, "received": accepted_receive, "comparison": compared,
                      "receivedApplication": second_record, "native": "complete",
                      "renderedRecipientReady": False}
        finally: author.close()
        receipt = complete_archive(root, result)
        print(canonical({"stage": "recipient-native-complete", **receipt}), flush=True)
        return 0

if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try: raise SystemExit(main())
    except AuditError as error:
        print(canonical({"ok": False, "error": {"code": error.code, "message": str(error),
                                             "details": error.details}}), flush=True)
        raise SystemExit(1)

#!/usr/bin/env python3
"""Whole original Gravitee source desk, native Installation and case receiving."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import threading
import uuid
import zipfile

HERE = Path(__file__).resolve().parent
SCHEMA = "stellar-forge.gravitee-source-desk-receiving.v1"


def need(ok, message):
    if not ok:
        raise ValueError(message)


def raw(path, limit=64 * 1024 * 1024):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= limit, "Select a complete bounded regular input.")
        parts = []
        size = 0
        while True:
            part = os.read(fd, min(262144, limit + 1 - size))
            if not part:
                break
            parts.append(part)
            size += len(part)
            need(size <= limit, "Original input exceeds its full-file bound.")
        after = os.fstat(fd)
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), "Original file changed during receiving.")
        return b"".join(parts)
    finally:
        os.close(fd)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def identity(path):
    data = raw(path, 512 * 1024 * 1024)
    return {"path": str(Path(path).resolve()), "bytes": len(data), "sha256": sha(data)}


def write(path, value, immutable=False):
    path = Path(path)
    data = value if isinstance(value, bytes) else encoded(value)
    if path.exists() and immutable:
        need(raw(path, 512 * 1024 * 1024) == data, "The original immutable receiving file differs: " + path.name)
        return identity(path)
    temp = path.with_name("." + path.name + "." + uuid.uuid4().hex)
    try:
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if immutable:
            try:
                os.link(temp, path)
            except FileExistsError:
                need(raw(path, 512 * 1024 * 1024) == data, "Original file changed while it was saved.")
        else:
            os.replace(temp, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temp.unlink(missing_ok=True)
    return identity(path)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--node", required=True, type=Path)
    parser.add_argument("--playwright", required=True, type=Path)
    parser.add_argument("--chromium", required=True, type=Path)
    parser.add_argument("--scenario", type=Path, default=HERE.parent / "sf10_current_candidate.json")
    args = parser.parse_args(argv)
    root = args.directory.expanduser().resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    need(not root.stat().st_mode & 0o077, "Keep this whole original receiving case private.")
    lock = os.open(root / "receiving.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    input_raw = raw(args.input)
    source = json.loads(input_raw)
    need(source.get("schema") == "stellar-forge.gravitee-source-desk-input.v1", "Select the full original private desk input.")
    need(isinstance(source.get("actor"), str) and source["actor"].strip(), "Name the actual receiving operator.")
    need(isinstance(source.get("cohort"), list) and source["cohort"], "Select the whole real native cohort.")
    report_path = root / "Gravitee_Source_Desk_Receiving.json"
    report = json.loads(raw(report_path)) if report_path.exists() else {
        "schema": SCHEMA, "inputSha256": sha(input_raw), "state": "PREPARED", "phases": {}, "artifacts": {}}
    need(report["inputSha256"] == sha(input_raw), "Resume the same complete original input.")
    report["state"] = "RUNNING"
    server = thread = child = workspace = None
    failure = None
    old_handlers = {}

    def save():
        write(report_path, report)

    def keep(name, data, immutable=True):
        result = write(root / name, data, immutable)
        report["artifacts"][name] = result
        save()
        return result

    def stop(signum, frame):
        raise InterruptedError("The original receiving lifetime was interrupted.")

    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            old_handlers[sig] = signal.signal(sig, stop)
        os.environ["GRANT_GRAVITEE_NODE"] = str(args.node.resolve())
        from model import Workspace
        from operations import Operations
        from operations_gravitee import perform
        from server import create_server
        keep("Original_Desk_Input.json", input_raw)
        # Completed artifact hashes remain authoritative on a later receiving lifetime.
        for record in report["artifacts"].values():
            need(identity(record["path"]) == record, "A retained full artifact changed.")
        workspace = Workspace(args.workspace, args.scenario)
        ops = Operations(workspace)
        case = ops.read(source["caseId"])
        need(case["program"]["planId"] == source["planId"], "The original selected case belongs to another plan.")
        if "native-source" not in report["phases"]:
            need(case["program"]["version"] == source["expectedVersion"], "Read the actual current original case before first receiving.")
            body = {"expectedVersion": case["program"]["version"], "sourceId": source["sourceId"],
                    "expectedSourceSha256": source["sourceSha256"]}
            inspected = perform(ops, source["caseId"], "inspect", body)
            template = perform(ops, source["caseId"], "template", {**body, "document": source["document"]})
            refs = [row["reference"] for row in inspected["result"]["cohort"]]
            need(len(source["cohort"]) == len(refs) and
                 sorted(json.dumps(x["reference"], sort_keys=True) for x in source["cohort"]) ==
                 sorted(json.dumps(x, sort_keys=True) for x in refs), "Keep every original native cohort head exactly once.")
            source_meta, full_source = ops.source(source["caseId"], source["sourceId"])
            keep("Original_Gravitee_Handover.json", full_source)
            keep("Original_Native_Inspection.json", inspected)
            keep("Original_Commercial_Template.json", template)
            keep("Original_Commercial_Document.json", encoded(source["document"]))
            # Read every complete text/binary member through the actual adapter.
            members = []
            for member in inspected["result"]["members"]:
                offset = 0
                count = 0
                while True:
                    page = perform(ops, source["caseId"], "member", {**body, "path": member["path"], "offset": offset, "limit": 32000})["result"]
                    need(page["file"] == member, "Native member identity changed while paging.")
                    count += 1
                    if page["encoding"] != "utf8" or page["nextOffset"] is None:
                        break
                    offset = page["nextOffset"]
                members.append({"file": member, "pages": count})
            keep("Complete_Source_Read.json", {"members": members})
            report["phases"]["native-source"] = {"cohort": len(refs), "members": len(members)}
            save()
        workspace.close()
        workspace = None
        access_path = root / "private-browser-access.json"
        listener_path = root / "Original_Listener.json"
        listener = json.loads(raw(listener_path)) if listener_path.exists() else None
        server = create_server(args.workspace, args.scenario, port=listener["port"] if listener else 0)
        if listener:
            need(server.origin == listener["origin"], "Keep the original browser storage origin.")
        else:
            write(listener_path, {"port": server.server_port, "origin": server.origin}, True)
        write(access_path, {"origin": server.origin, "token": server.token})
        thread = threading.Thread(target=server.serve_forever, daemon=False)
        thread.start()
        browser_input = {**source, "directory": str(root), "inputSha256": sha(input_raw),
                         "playwright": str(args.playwright.resolve()), "chromium": str(args.chromium.resolve()),
                         "documentPath": str(root / "Original_Commercial_Document.json")}
        keep("Browser_Input.json", browser_input)
        child = subprocess.Popen([str(args.node.resolve()), str(HERE / "gravitee-source-desk-browser.mjs"),
                                  str(root / "Browser_Input.json"), str(access_path)],
                                 cwd=HERE, start_new_session=True)
        need(child.wait() == 0, "Preserve the original browser report and continue its unfinished phase.")
        child = None
        browser = json.loads(raw(root / "Gravitee_Source_Desk_Browser.json"))
        need(browser["state"] == "COMPLETE" and browser["inputSha256"] == sha(input_raw), "Receive the complete actual original browser course.")
        report["phases"]["browser"] = {"phases": browser["phases"], "installation": browser["installation"]}
        save()
        server.shutdown()
        thread.join()
        thread = None
        server.server_close()
        server.workspace.close()
        server = None
        workspace = Workspace(args.workspace, args.scenario)
        ops = Operations(workspace)
        selected = browser["installation"]
        saved = ops.installation(source["caseId"], selected["id"], selected["revision"])
        need(saved["sha256"] == selected["sha256"], "The actual saved Installation changed.")
        selected_ids = set(saved["preview"]["document"]["source"]["sourceIds"])
        need(source["sourceId"] in selected_ids and browser["cohortSourceId"] in selected_ids,
             "Both complete source attachments must survive the native save.")
        keep("Original_Saved_Installation.json", saved)
        case_export_path = root / "Complete_Operations_Case.zip"
        if case_export_path.exists():
            case_export = raw(case_export_path, 512 * 1024 * 1024)
        else:
            case_export = ops.export(source["caseId"])
            keep(case_export_path.name, case_export)
        workspace.close()
        workspace = None
        receiver = root / "independent-recipient"
        workspace = Workspace(receiver, args.scenario)
        received = Operations(workspace)
        request = str(uuid.uuid5(uuid.NAMESPACE_URL, source["operationId"] + "/independent-case-receiving"))
        receipt = received.import_bundle(case_export, "Gravitee source desk independent receiving", request, source["actor"])
        keep("Independent_Case_Receiving.json", receipt)
        receiving_id = receipt["id"]
        received_row = received.installation(receiving_id, selected["id"], selected["revision"])
        need(received_row["sha256"] == saved["sha256"], "Independent receiving changed the complete saved Installation.")
        for ident in (source["sourceId"], browser["cohortSourceId"]):
            metadata, data = received.source(receiving_id, ident)
            need(metadata["sha256"] == sha(data), "Independent receiving changed the original attachment.")
        workspace.close()
        workspace = Workspace(receiver, args.scenario)
        cold = Operations(workspace).installation(receiving_id, selected["id"], selected["revision"])
        need(cold["sha256"] == saved["sha256"], "Cold reopen changed the complete original Installation.")
        keep("Independent_Cold_Installation.json", cold)
        report["phases"]["independent-receiving"] = {"caseId": receiving_id, "installationId": selected["id"], "revision": selected["revision"], "sha256": saved["sha256"]}
        report["state"] = "COMPLETE"
    except BaseException as exc:
        failure = exc
        report["state"] = "INTERRUPTED"
        report["error"] = {"type": type(exc).__name__, "message": str(exc), "code": getattr(exc, "code", None)}
    finally:
        if child is not None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
                child.wait(timeout=15)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()
        if thread is not None and thread.is_alive():
            server.shutdown()
            thread.join()
        if server is not None:
            server.server_close()
            server.workspace.close()
        if workspace is not None:
            workspace.close()
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
        (root / "private-browser-access.json").unlink(missing_ok=True)
        report["lifetimes"] = "CLOSED"
        save()
        # Keep every actual report/download/image and the complete authored source.
        output = root / "Gravitee_Source_Desk_Complete.zip"
        temp = root / ".Gravitee_Source_Desk_Complete.zip"
        with zipfile.ZipFile(temp, "w", zipfile.ZIP_STORED) as z:
            for path in sorted(root.iterdir()):
                if path.is_file() and not path.name.startswith(".") and path.name not in (output.name, "receiving.lock", "Original_Listener.json"):
                    z.write(path, "receiving/" + path.name)
            for path in sorted((root / "artifacts").glob("*")):
                if path.is_file():
                    z.write(path, "artifacts/" + path.name)
            for name in ("operations_gravitee.py", "operations_gravitee_engine.mjs", "operations_gravitee_model.mjs",
                         "operations_gravitee.mjs", "operations_gravitee.css", "GRAVITEE_SOURCE_DESK.md",
                         "operations_installations.mjs", "operations_http.py", "staff_http.py", "managed-source.json",
                         "gravitee-source-desk-receiving.py", "gravitee-source-desk-browser.mjs"):
                z.write(HERE / name, "source/" + name)
        os.replace(temp, output)
        print(json.dumps({"state": report["state"], "report": identity(report_path),
                          "completeArchive": identity(output), "phases": list(report["phases"])}), flush=True)
        os.close(lock)
    if failure:
        raise failure
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

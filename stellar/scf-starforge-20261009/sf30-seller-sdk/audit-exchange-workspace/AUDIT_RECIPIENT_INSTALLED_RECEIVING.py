#!/usr/bin/env python3
"""Continue the completed original recipient case through its installed author controls."""
from __future__ import annotations
import argparse
import base64
import copy
import fcntl
import hashlib
import os
from pathlib import Path
import signal
import sys
import threading
import zipfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import AUDIT_RECIPIENT_RECEIVING as original
import audit_recipient_review as recipient
from application import AuditServer
from common import AuditError, canonical, digest, require
from workspace import Workspace

OPERATION = "AUDIT-RECIPIENT-INSTALLED-OPERATOR-24EA-20261013"
class OwnedServer(AuditServer):
    # Keep the original handler but drain accepted request threads before native close.
    daemon_threads = False
    block_on_close = True

def retain_file(source, target):
    source, target = Path(source), Path(target)
    expected = original.identity(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        require(original.identity(target) == expected, "installed_file", "Preserve the different original file.")
        return expected
    temporary = target.with_name("." + target.name + ".pending-" + str(os.getpid()))
    try:
        with temporary.open("xb") as output, source.open("rb") as stream:
            for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
                output.write(chunk)
            output.flush(); os.fsync(output.fileno())
        require(original.identity(temporary) == expected and original.identity(source) == expected,
                "installed_file", "A complete original selected file changed.")
        try: os.link(temporary, target)
        except FileExistsError:
            require(original.identity(target) == expected, "installed_file", "An earlier complete file differs.")
        fd = os.open(target.parent, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    finally:
        if temporary.exists(): temporary.unlink()
    return expected

def verify_browser(root, selection):
    result = original.read_json(root / "BROWSER_RESULT.json")
    require(result["input"] == {"schema": "commons.audit-recipient-installed-browser-input.v1",
            "selectionSha256": digest(original.data(selection)), "workspaceId": selection["workspaceId"]},
            "installed_browser", "The completed browser used another selected original.")
    for row in result["files"]:
        name = Path(row["path"])
        require(not name.is_absolute() and ".." not in name.parts, "installed_browser", "Keep safe original member paths.")
        require(original.identity(root / name) == {key: row[key] for key in ("bytes", "sha256")},
                "installed_browser", "A completed browser member differs.")
    return result

def snapshot(workspace):
    with workspace.connect() as db:
        db.execute("BEGIN")
        value, objects = workspace._snapshot(db)
    return value

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("completed-recipient", "directory", "chromium", "playwright-module"):
        p.add_argument("--" + name, required=True)
    p.add_argument("--node", default="node")
    args = p.parse_args(argv)
    predecessor = Path(args.completed_recipient).expanduser().resolve()
    root = Path(args.directory).expanduser().resolve()
    require(root != HERE and HERE not in root.parents and predecessor != root
            and predecessor not in root.parents and root not in predecessor.parents,
            "installed_directory", "Use a separate following journal and preserve the completed predecessor.")
    require((predecessor / "operation.lock").is_file(), "installed_predecessor", "Use the completed original receiving directory.")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (predecessor / "operation.lock").open("a+b") as predecessor_lock, (root / "operation.lock").open("a+b") as lock:
        fcntl.flock(predecessor_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        prior = original.read_json(predecessor / "COMPLETE.json")
        run = original.read_json(predecessor / "RUN_RESULT.json")
        require(prior["operation"] == original.OPERATION and run["native"] == "complete"
                and prior["input"] == run["input"], "installed_predecessor", "Wait for the complete original recipient operation.")
        require(original.identity(prior["archive"]["path"]) == {k: prior["archive"][k] for k in ("bytes", "sha256")},
                "installed_predecessor", "The whole completed original archive differs.")
        directory = Path(run["input"]["workspace"]).resolve()
        require((directory / "audit-exchange.sqlite").is_file() and directory != root
                and root not in directory.parents and directory not in root.parents,
                "installed_workspace", "Continue the same original native author.")
        return_path = predecessor / "browser" / "Audit_Recipient_Return.zip"
        raw, source, draft, manuscript, kinds = recipient.read_return(return_path)
        require(manuscript["manuscriptId"] == run["accepted"]["manuscriptId"]
                and manuscript["source"]["workspaceId"] == run["input"]["workspaceId"],
                "installed_predecessor", "The original complete return belongs to another case.")
        declared = original.read_json(HERE / "SOURCE_FILES.json")["files"]
        require(isinstance(declared, list) and len(declared) == len(set(declared)),
                "installed_source", "Use the full original application inventory.")
        rows = []
        for name in declared:
            relative = Path(name)
            require(not relative.is_absolute() and ".." not in relative.parts, "installed_source", "Use safe complete source members.")
            rows.append({"path": name, **original.identity(HERE / relative)})
        selected = {"operation": OPERATION, "predecessor": str(predecessor),
            "predecessorArchive": {k: prior["archive"][k] for k in ("bytes", "sha256")},
            "workspace": str(directory), "workspaceId": run["input"]["workspaceId"],
            "return": {"bytes": len(raw), "sha256": digest(raw)}, "applicationSource": rows,
            "operator": run["input"]["operator"]}
        original.put(root / "INPUT.json", selected)
        original.OPERATION = OPERATION
        if (root / "COMPLETE.json").exists():
            complete = original.read_json(root / "COMPLETE.json")
            require(complete["input"] == selected and original.identity(complete["archive"]["path"])
                    == {k: complete["archive"][k] for k in ("bytes", "sha256")},
                    "installed_complete", "The retained complete result differs.")
            print(canonical(complete), flush=True); return 0
        if (root / "RUN_RESULT.json").exists():
            require(original.read_json(root / "RUN_RESULT.json")["input"] == selected,
                    "installed_complete", "Keep the original following source selection.")
            print(canonical(original.complete_archive(root, original.read_json(root / "RUN_RESULT.json"))), flush=True)
            return 0
        retain_file(prior["archive"]["path"], root / "Original_Recipient_Complete.zip")
        retain_file(predecessor / "COMPLETE.json", root / "predecessor" / "COMPLETE.json")
        retain_file(predecessor / "RUN_RESULT.json", root / "predecessor" / "RUN_RESULT.json")
        retain_file(return_path, root / "Audit_Recipient_Return.zip")
        for row in rows: retain_file(HERE / row["path"], root / "application" / row["path"])
        author = Workspace(directory)
        try:
            state = author.state()
            require(state["workspaceId"] == selected["workspaceId"]
                    and not any(row["status"] in {"queued", "running"} for row in state["analysisRuns"]),
                    "installed_workspace", "Continue the original idle author after its native owner completes.")
            matches = [row for row in state["exports"] if row["kind"] in {"workspace", "application"} and row["sha256"] == digest(source)]
            require(matches, "installed_source", "The author must retain the exact original recipient export.")
            before_path = root / "AUTHOR_BEFORE.json"
            if not before_path.exists(): original.put(before_path, snapshot(author))
            before = original.read_json(before_path)
            # Original record identities may gain unrelated edits; preserve every earlier
            # accepted request. The following programme itself never changes review records.
            before_ops = {row["id"]: row for row in before["operations"]}
            current_ops = {row["id"]: row for row in snapshot(author)["operations"]}
            require(all(current_ops.get(k) == v for k, v in before_ops.items()),
                    "installed_history", "The current author lost earlier accepted request history.")
            browser_selection = {"workspaceId": state["workspaceId"], "operator": selected["operator"],
                "originalExportId": matches[0]["id"], "returnPath": str(root / "Audit_Recipient_Return.zip"),
                "returnSha256": digest(raw), "returnBytes": len(raw)}
            original.put(root / "BROWSER_SELECTION.json", browser_selection)
            browser_root = root / "browser"
            if not (browser_root / "BROWSER_RESULT.json").exists():
                port_path = root / "SERVER.json"
                port = original.read_json(port_path)["port"] if port_path.exists() else 0
                server = OwnedServer(("127.0.0.1", port), author)
                try:
                    original.put(port_path, {"port": server.server_port, "workspaceId": state["workspaceId"]})
                    thread = threading.Thread(target=server.serve_forever)
                    thread.start()
                    try:
                        original.owned_child([args.node, str(HERE / "AUDIT_RECIPIENT_INSTALLED_BROWSER.mjs"),
                            "--directory", str(browser_root), "--selection", str(root / "BROWSER_SELECTION.json"),
                            "--url", server.url, "--chromium", args.chromium, "--playwright-module", args.playwright_module],
                            HERE, root / "browser.log", (lock.fileno(), predecessor_lock.fileno()))
                    finally:
                        server.shutdown(); thread.join()
                finally: server.server_close()
            browser_result = verify_browser(browser_root, browser_selection)
            for label in ("prepare", "stage", "apply"):
                accepted = original.read_json(browser_root / (label + "-accepted.json"))
                # Exact original replay must leave current version and all histories unchanged.
                version = author.state()["version"]
                replay = author.perform(accepted["request"])
                require(replay["result"] == accepted["result"] and author.state()["version"] == version,
                        "installed_replay", "The original installed request replay changed native history.")
            prepared = browser_result["prepared"]["result"]["archive"]
            prepared_row, prepared_raw = author.download(prepared["id"])
            require(prepared_raw == recipient.read_file(browser_root / "Audit_Recipient_Complete.zip", recipient.MAX_PACKAGE),
                    "installed_download", "The downloaded complete editor differs from native retained bytes.")
            with zipfile.ZipFile(browser_root / "Audit_Recipient_Complete.zip") as complete_editor:
                require(complete_editor.read("original-review.zip") == source,
                        "installed_source", "The complete installed editor lost the exact original source.")
            applied = browser_result["applied"]["result"]
            record, custody = author.download(applied["archive"]["id"])
            require(custody == recipient.read_file(browser_root / "Audit_Recipient_Accepted.zip", recipient.MAX_PACKAGE),
                    "installed_download", "The full installed custody download differs.")
            with zipfile.ZipFile(browser_root / "Audit_Recipient_Accepted.zip") as archive:
                manifest = recipient.checked_json(archive.read("manifest.json"))
                require(set(archive.namelist()) == set(manifest["files"]) | {"manifest.json"},
                        "installed_custody", "The full custody inventory differs.")
                for name, row in manifest["files"].items():
                    body = archive.read(name)
                    require({"bytes": len(body), "sha256": digest(body)} == row,
                            "installed_custody", "A complete custody member differs.")
                require(archive.read("recipient-return.zip") == raw
                        and manifest["workspaceId"] == state["workspaceId"], "installed_custody", "The native custody selected another source.")
            current_after = snapshot(author)
            old_reviews = {row["id"]: row for row in before["records"] if row["kind"] == "review"}
            new_reviews = {row["id"]: row for row in current_after["records"] if row["kind"] == "review"}
            require(old_reviews == new_reviews, "installed_replay", "Reusing original accepted reviews changed their identities or content.")
            after_path = root / "AUTHOR_AFTER.json"
            if not after_path.exists(): original.put(after_path, current_after)
            after = original.read_json(after_path)
            retained_reviews = {row["id"]: row for row in after["records"] if row["kind"] == "review"}
            retained_ops = {row["id"]: row for row in after["operations"]}
            current_ops = {row["id"]: row for row in current_after["operations"]}
            require(after["workspace"]["workspaceId"] == selected["workspaceId"]
                    and retained_reviews == old_reviews
                    and all(retained_ops.get(k) == v for k, v in before_ops.items())
                    and all(current_ops.get(k) == v for k, v in retained_ops.items()),
                    "installed_history", "The frozen original author outcome lost its review or accepted-request ancestry.")
            export = original.native(author, root, "installed-complete-application", "export.create",
                {"kind": "application", "actor": selected["operator"], "note": "Complete original Audit with installed recipient requests and custody."})
            exported, body = author.download(export["id"])
            recipient.publish(root / "Audit_Installed_Application.zip", body)
            _, exported_snapshot, _, members = recipient.package(body)
            require(all(members["application/" + row["path"]] == (root / "application" / row["path"]).read_bytes() for row in rows),
                    "installed_source", "The complete outgoing application differs from selected source.")
            received = Workspace(root / "received-workspace", "Received installed Audit recipient")
            try:
                outcome = original.native(received, root, "receive-installed-application", "workspace.receive",
                    {"contentBase64": base64.b64encode(body).decode("ascii"), "name": "Audit_Installed_Application.zip",
                     "actor": selected["operator"], "note": "Independent full installed recipient application receiving."})
                comparison = original.compare_received(exported_snapshot, snapshot(received), selected["workspaceId"], digest(body), members)
                next_export = original.native(received, root, "reexport-installed-application", "export.create",
                    {"kind": "application", "actor": selected["operator"], "note": "Whole received application, original native history and all recipient custody."})
                received_record, received_raw = received.download(next_export["id"])
                recipient.publish(root / "Audit_Installed_Received_Application.zip", received_raw)
                reopened = Workspace(root / "received-workspace")
                try: require(reopened.state() == received.state(), "installed_reopen", "The original received workspace did not reopen exactly.")
                finally: reopened.close()
            finally: received.close()
            result = {"schema": "commons.audit-recipient-installed-native-result.v1", "operation": OPERATION,
                "input": selected, "browser": browser_result, "application": exported, "received": outcome,
                "comparison": comparison, "receivedApplication": received_record, "native": "complete", "renderedRecipientReady": False}
        finally: author.close()
        print(canonical(original.complete_archive(root, result)), flush=True)
        return 0

if __name__ == "__main__":
    signal.signal(signal.SIGTERM, original.interrupted)
    signal.signal(signal.SIGINT, original.interrupted)
    try: raise SystemExit(main())
    except AuditError as error:
        print(canonical({"ok": False, "error": {"code": error.code, "message": str(error), "details": error.details}}), flush=True)
        raise SystemExit(1)

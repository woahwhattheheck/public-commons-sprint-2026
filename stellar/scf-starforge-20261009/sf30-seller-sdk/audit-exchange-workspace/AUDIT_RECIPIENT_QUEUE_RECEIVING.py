#!/usr/bin/env python3
"""Continue the completed installed Audit case with an ordered queue of its original returns."""
from __future__ import annotations
import argparse
import base64
import fcntl
import signal
import sys
import threading
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import AUDIT_RECIPIENT_RECEIVING as original
import AUDIT_RECIPIENT_INSTALLED_RECEIVING as installed
import audit_recipient_review as recipient
from common import AuditError, canonical, digest, require
from workspace import Workspace

OPERATION = "AUDIT-RECIPIENT-REVIEW-QUEUE-24EA-20261013"

def verified_browser(root, selection):
    value = original.read_json(root / "BROWSER_RESULT.json")
    require(value["input"] == {"schema": "commons.audit-recipient-queue-browser-input.v1",
            "selectionSha256": digest(original.data(selection)), "workspaceId": selection["workspaceId"]},
            "queue_browser", "The browser selected another original queue.")
    for row in value["files"]:
        path = Path(row["path"])
        require(not path.is_absolute() and ".." not in path.parts and original.identity(root / path)
                == {k: row[k] for k in ("bytes", "sha256")}, "queue_browser", "A complete browser output differs.")
    return value

def archive_members(path):
    with zipfile.ZipFile(path) as archive:
        manifest = recipient.checked_json(archive.read("manifest.json"))
        require(set(archive.namelist()) == set(manifest["files"]) | {"manifest.json"},
                "queue_package", "The complete queue archive inventory differs.")
        for name, row in manifest["files"].items():
            body = archive.read(name)
            require({"bytes": len(body), "sha256": digest(body)} == row,
                    "queue_package", "A complete queue original differs.")
        return manifest

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("completed-installed", "directory", "selection", "chromium", "playwright-module"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--node", default="node")
    args = parser.parse_args(argv)
    prior_root = Path(args.completed_installed).expanduser().resolve()
    root = Path(args.directory).expanduser().resolve()
    require(root != HERE and HERE not in root.parents and root != prior_root
            and root not in prior_root.parents and prior_root not in root.parents,
            "queue_directory", "Use a separate following journal and preserve the original completed case.")
    require((prior_root / "operation.lock").is_file(), "queue_predecessor", "Use the completed original installed course.")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (prior_root / "operation.lock").open("a+b") as prior_lock, (root / "operation.lock").open("a+b") as lock:
        fcntl.flock(prior_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        prior = original.read_json(prior_root / "COMPLETE.json")
        run = original.read_json(prior_root / "RUN_RESULT.json")
        require(prior["operation"] == installed.OPERATION and run["native"] == "complete"
                and prior["input"] == run["input"] and original.identity(prior["archive"]["path"])
                == {k: prior["archive"][k] for k in ("bytes", "sha256")},
                "queue_predecessor", "Preserve the complete original installed programme and archive.")
        specification = original.read_json(Path(args.selection))
        require(isinstance(specification, dict) and set(specification) == {"workspaceId", "returnIds", "title", "note", "operator"}
                and specification["workspaceId"] == run["input"]["workspaceId"]
                and isinstance(specification["returnIds"], list) and 1 <= len(specification["returnIds"]) <= 128
                and len(set(specification["returnIds"])) == len(specification["returnIds"]),
                "queue_selection", "Select complete retained return IDs in this original author.")
        recipient.string(specification["title"], 500, False)
        recipient.string(specification["note"], 5000)
        recipient.string(specification["operator"], 240, False)
        directory = Path(run["input"]["workspace"]).resolve()
        require((directory / "audit-exchange.sqlite").is_file() and directory != root
                and root not in directory.parents and directory not in root.parents,
                "queue_workspace", "Continue the exact original author outside its receiving journal.")
        rows = []
        declared = original.read_json(HERE / "SOURCE_FILES.json")["files"]
        require(len(declared) == len(set(declared)), "queue_source", "Keep the exact whole source selection.")
        for name in declared:
            relative = Path(name)
            require(not relative.is_absolute() and ".." not in relative.parts, "queue_source", "Use original safe source paths.")
            rows.append({"path": name, **original.identity(HERE / name)})
        selected = {"operation": OPERATION, "predecessor": str(prior_root),
            "predecessorArchive": {k: prior["archive"][k] for k in ("bytes", "sha256")},
            "workspace": str(directory), "workspaceId": specification["workspaceId"], "specification": specification,
            "applicationSource": rows}
        original.put(root / "INPUT.json", selected)
        original.OPERATION = OPERATION
        if (root / "COMPLETE.json").exists():
            complete = original.read_json(root / "COMPLETE.json")
            require(complete["input"] == selected and original.identity(complete["archive"]["path"])
                    == {k: complete["archive"][k] for k in ("bytes", "sha256")}, "queue_complete", "The original complete archive differs.")
            print(canonical(complete), flush=True)
            return 0
        if (root / "RUN_RESULT.json").exists():
            result = original.read_json(root / "RUN_RESULT.json")
            require(result["input"] == selected, "queue_complete", "Preserve the original frozen source and inputs.")
            print(canonical(original.complete_archive(root, result)), flush=True)
            return 0
        installed.retain_file(prior["archive"]["path"], root / "Original_Installed_Complete.zip")
        installed.retain_file(prior_root / "COMPLETE.json", root / "predecessor" / "COMPLETE.json")
        for row in rows:
            installed.retain_file(HERE / row["path"], root / "application" / row["path"])
        author = Workspace(directory)
        try:
            state = author.state()
            require(state["workspaceId"] == specification["workspaceId"]
                    and not any(r["status"] in {"queued", "running"} for r in state["analysisRuns"]),
                    "queue_workspace", "Use this original idle author after its preceding course finishes.")
            returned = []
            for identity in specification["returnIds"]:
                row = next((r for r in state["exports"] if r["id"] == identity and r["kind"] == "recipient-return"), None)
                require(row is not None and not row.get("receivedFrom"), "queue_return", "Use exact original author returns.")
                progress = author.perform({"action": "recipient.queue.inspect", "inputs": {"returnId": identity}})["result"]
                require(not progress["inherited"], "queue_return", "Keep the original author identity.")
                returned.append({"id": row["id"], "sha256": row["sha256"], "bytes": row["bytes"]})
            require(len({r["sha256"] for r in returned}) == len(returned),
                    "queue_return", "Each selected full return must be unique by its original bytes.")
            before_path = root / "AUTHOR_BEFORE.json"
            if not before_path.exists():
                original.put(before_path, installed.snapshot(author))
            before = original.read_json(before_path)
            current = installed.snapshot(author)
            old_ops = {r["id"]: r for r in before["operations"]}
            require(all({r["id"]: r for r in current["operations"]}.get(k) == v for k, v in old_ops.items()),
                    "queue_history", "Earlier native request history differs.")
            selection = {**{k: specification[k] for k in ("workspaceId", "operator", "title", "note")}, "returns": returned}
            original.put(root / "BROWSER_SELECTION.json", selection)
            browser_root = root / "browser"
            if not (browser_root / "BROWSER_RESULT.json").exists():
                port_path = root / "SERVER.json"
                port = original.read_json(port_path)["port"] if port_path.exists() else 0
                server = installed.OwnedServer(("127.0.0.1", port), author)
                try:
                    original.put(port_path, {"port": server.server_port, "workspaceId": state["workspaceId"]})
                    thread = threading.Thread(target=server.serve_forever)
                    thread.start()
                    try:
                        original.owned_child([args.node, str(HERE / "AUDIT_RECIPIENT_QUEUE_BROWSER.mjs"),
                            "--directory", str(browser_root), "--selection", str(root / "BROWSER_SELECTION.json"),
                            "--url", server.url, "--chromium", args.chromium, "--playwright-module", args.playwright_module],
                            HERE, root / "browser.log", (lock.fileno(), prior_lock.fileno()))
                    finally:
                        server.shutdown()
                        thread.join()
                finally:
                    server.server_close()
            browser = verified_browser(browser_root, selection)
            for name in ("first", "following", "export"):
                accepted = original.read_json(browser_root / (name + "-accepted.json"))
                version = author.state()["version"]
                replay = author.perform(accepted["request"])
                require(replay["result"] == accepted["result"] and author.state()["version"] == version,
                        "queue_replay", "The exact original queue request replay changed history.")
            queue_record = browser["following"]["result"]["archive"]
            queue = author.perform({"action": "recipient.queue.get", "inputs": {"exportId": queue_record["id"]}})["result"]
            require(len(queue["history"]) == 2 and queue["history"][0]["export"] == browser["first"]["result"]["archive"]
                    and queue["queue"]["edition"] == 2, "queue_history", "Both complete queue editions must remain.")
            package_record, package_bytes = author.download(browser["exported"]["result"]["archive"]["id"])
            require(package_bytes == (browser_root / "Audit_Recipient_Queue_Complete.zip").read_bytes(),
                    "queue_download", "The complete browser download differs from original native bytes.")
            manifest = archive_members(browser_root / "Audit_Recipient_Queue_Complete.zip")
            require(manifest["queueSha256"] == queue_record["sha256"] and all(
                manifest["files"].get("returns/" + r["sha256"] + ".zip") == {"bytes": r["bytes"], "sha256": r["sha256"]}
                for r in returned), "queue_source", "The original complete return selection was lost.")
            after = installed.snapshot(author)
            reviews = lambda value: {r["id"]: r for r in value["records"] if r["kind"] == "review"}
            require(reviews(before) == reviews(after), "queue_scope", "Queue management changed native review decisions.")
            exported = original.native(author, root, "queue-full-application", "export.create",
                {"kind": "application", "actor": specification["operator"], "note": "Complete original Audit with ordered review queue and every selected return."})
            record, body = author.download(exported["id"])
            recipient.publish(root / "Audit_Queue_Application.zip", body)
            _, exported_snapshot, _, members = recipient.package(body)
            require(all(members["application/" + row["path"]] == (root / "application" / row["path"]).read_bytes() for row in rows),
                    "queue_source", "The outgoing complete application source differs.")
            received = Workspace(root / "received-workspace", "Received original Audit queue")
            try:
                outcome = original.native(received, root, "queue-receive-application", "workspace.receive",
                    {"contentBase64": base64.b64encode(body).decode("ascii"), "name": "Audit_Queue_Application.zip",
                     "actor": specification["operator"], "note": "Independent complete ordered-queue receiving."})
                comparison = original.compare_received(exported_snapshot, installed.snapshot(received),
                    state["workspaceId"], digest(body), members)
                received_queues = [r for r in received.state()["exports"] if r["kind"] == "recipient-queue" and r["sha256"] == queue_record["sha256"]]
                require(received_queues, "queue_received", "The complete original queue is absent in receiving.")
                reopened_queue = received.perform({"action": "recipient.queue.get", "inputs": {"exportId": received_queues[0]["id"]}})["result"]
                require(reopened_queue["readOnly"] and reopened_queue["queue"] == queue["queue"]
                        and [r["queue"] for r in reopened_queue["history"]] == [r["queue"] for r in queue["history"]],
                        "queue_received", "The original received queue or ancestry differs.")
                following = original.native(received, root, "queue-reexport-application", "export.create",
                    {"kind": "application", "actor": specification["operator"], "note": "Complete received queue and original native custody."})
                following_record, following_bytes = received.download(following["id"])
                recipient.publish(root / "Audit_Queue_Received_Application.zip", following_bytes)
                reopened = Workspace(root / "received-workspace")
                try:
                    require(reopened.state() == received.state(), "queue_reopen", "The full received workspace did not reopen exactly.")
                finally:
                    reopened.close()
            finally:
                received.close()
            result = {"schema": "commons.audit-recipient-queue-native-result.v1", "operation": OPERATION,
                "input": selected, "browser": browser, "queue": queue, "queuePackage": package_record,
                "application": record, "received": outcome, "comparison": comparison,
                "receivedApplication": following_record, "native": "complete", "renderedRecipientReady": False}
        finally:
            author.close()
        print(canonical(original.complete_archive(root, result)), flush=True)
        return 0

if __name__ == "__main__":
    signal.signal(signal.SIGTERM, original.interrupted)
    signal.signal(signal.SIGINT, original.interrupted)
    try:
        raise SystemExit(main())
    except AuditError as error:
        print(canonical({"ok": False, "error": {"code": error.code, "message": str(error), "details": error.details}}), flush=True)
        raise SystemExit(1)

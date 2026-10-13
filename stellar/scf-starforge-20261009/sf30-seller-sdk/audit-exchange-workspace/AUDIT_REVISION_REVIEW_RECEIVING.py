#!/usr/bin/env python3
"""Continue a completed original Audit queue with explicit revision-impact review."""
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
import AUDIT_RECIPIENT_QUEUE_RECEIVING as queue
from exchange import unpack_package
import json
import audit_recipient_review as recipient
from common import AuditError, canonical, digest, require
from workspace import Workspace

OPERATION = "AUDIT-REVISION-IMPACT-REVIEW-24EA-20261013"

def verified_browser(root, selection):
    value = original.read_json(root / "BROWSER_RESULT.json")
    require(value["input"] == {"schema": "commons.audit-review-transition-browser-input.v1",
            "selectionSha256": digest(original.data(selection)), "workspaceId": selection["workspaceId"]},
            "revision_browser", "The browser selected another original revision review.")
    for row in value["files"]:
        path = Path(row["path"])
        require(not path.is_absolute() and ".." not in path.parts and original.identity(root / path)
                == {k: row[k] for k in ("bytes", "sha256")}, "revision_browser", "A complete browser output differs.")
    return value

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("completed-queue", "directory", "selection", "chromium", "playwright-module"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--node", default="node")
    args = parser.parse_args(argv)
    prior_root = Path(args.completed_queue).expanduser().resolve()
    root = Path(args.directory).expanduser().resolve()
    require(root != HERE and HERE not in root.parents and root != prior_root
            and root not in prior_root.parents and prior_root not in root.parents,
            "revision_directory", "Use a separate following journal and preserve the original completed case.")
    require((prior_root / "operation.lock").is_file(), "revision_predecessor", "Use the completed original queue course.")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (prior_root / "operation.lock").open("a+b") as prior_lock, (root / "operation.lock").open("a+b") as lock:
        fcntl.flock(prior_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        prior = original.read_json(prior_root / "COMPLETE.json")
        run = original.read_json(prior_root / "RUN_RESULT.json")
        require(prior["operation"] == queue.OPERATION and run["native"] == "complete"
                and prior["input"] == run["input"] and original.identity(prior["archive"]["path"])
                == {k: prior["archive"][k] for k in ("bytes", "sha256")},
                "revision_predecessor", "Preserve the complete original queue programme and archive.")
        specification = original.read_json(Path(args.selection))
        require(isinstance(specification, dict) and set(specification) == {
            "workspaceId", "sourceId", "toRevisionId", "reviewIds", "decisions", "title", "note", "actor"}
            and specification["workspaceId"] == run["input"]["workspaceId"],
            "revision_selection", "Select complete explicit review decisions in the original author.")
        for name, maximum in (("title", 500), ("note", 5000), ("actor", 240)):
            recipient.string(specification[name], maximum, name == "note")
        require(isinstance(specification["reviewIds"], list) and 1 <= len(specification["reviewIds"]) <= 250
                and len(set(specification["reviewIds"])) == len(specification["reviewIds"])
                and isinstance(specification["decisions"], list)
                and [row.get("reviewId") for row in specification["decisions"]] == specification["reviewIds"],
                "revision_selection", "Preserve every selected review and complete decision order.")
        directory = Path(run["input"]["workspace"]).resolve()
        require((directory / "audit-exchange.sqlite").is_file() and directory != root
                and root not in directory.parents and directory not in root.parents,
                "revision_workspace", "Continue the exact original author outside its receiving journal.")
        rows = []
        declared = original.read_json(HERE / "SOURCE_FILES.json")["files"]
        require(len(declared) == len(set(declared)), "revision_source", "Keep the exact whole source selection.")
        for name in declared:
            relative = Path(name)
            require(not relative.is_absolute() and ".." not in relative.parts, "revision_source", "Use original safe source paths.")
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
                    == {k: complete["archive"][k] for k in ("bytes", "sha256")}, "revision_complete", "The original complete archive differs.")
            print(canonical(complete), flush=True)
            return 0
        if (root / "RUN_RESULT.json").exists():
            result = original.read_json(root / "RUN_RESULT.json")
            require(result["input"] == selected, "revision_complete", "Preserve the original frozen source and inputs.")
            print(canonical(original.complete_archive(root, result)), flush=True)
            return 0
        installed.retain_file(prior["archive"]["path"], root / "Original_Queue_Complete.zip")
        installed.retain_file(prior_root / "COMPLETE.json", root / "predecessor" / "COMPLETE.json")
        for row in rows:
            installed.retain_file(HERE / row["path"], root / "application" / row["path"])
        author = Workspace(directory)
        try:
            state = author.state()
            require(state["workspaceId"] == specification["workspaceId"]
                    and not any(r["status"] in {"queued", "running"} for r in state["analysisRuns"]),
                    "revision_workspace", "Use this original idle author after its preceding course finishes.")
            before_path = root / "AUTHOR_BEFORE.json"
            if not before_path.exists():
                original.put(before_path, installed.snapshot(author))
            before = original.read_json(before_path)
            current = installed.snapshot(author)
            old_ops = {r["id"]: r for r in before["operations"]}
            require(all({r["id"]: r for r in current["operations"]}.get(k) == v for k, v in old_ops.items()),
                    "revision_history", "Earlier native request history differs.")
            selection_path = root / "BROWSER_SELECTION.json"
            if selection_path.exists():
                selection = original.read_json(selection_path)
                require(selection["specification"] == specification and selection["workspaceId"] == state["workspaceId"],
                        "revision_selection", "Preserve the first complete selected preview and decisions.")
            else:
                preview = author.perform({"action": "review.transition.preview", "inputs": {
                    name: specification[name] for name in ("sourceId", "toRevisionId", "reviewIds")}})["result"]
                selection = {"workspaceId": state["workspaceId"], "specification": specification, "preview": preview}
                original.put(selection_path, selection)
            require(selection["preview"]["version"] == before["workspace"]["version"]
                    and selection["preview"]["workspaceId"] == before["workspace"]["workspaceId"],
                    "revision_before", "The selected preview differs from the first retained author observation.")
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
                        original.owned_child([args.node, str(HERE / "AUDIT_REVISION_REVIEW_BROWSER.mjs"),
                            "--directory", str(browser_root), "--selection", str(root / "BROWSER_SELECTION.json"),
                            "--url", server.url, "--chromium", args.chromium, "--playwright-module", args.playwright_module],
                            HERE, root / "browser.log", (lock.fileno(), prior_lock.fileno()))
                    finally:
                        server.shutdown()
                        thread.join()
                finally:
                    server.server_close()
            browser = verified_browser(browser_root, selection)
            accepted = original.read_json(browser_root / "apply-accepted.json")
            version = author.state()["version"]
            replay = author.perform(accepted["request"])
            require(replay["result"] == accepted["result"] and author.state()["version"] == version,
                    "revision_replay", "The complete original decision replay changed the native history.")
            archive = accepted["result"]["archive"]
            record, archive_body = author.download(archive["id"])
            require(archive_body == (browser_root / "Audit_Revision_Review.zip").read_bytes()
                    == (browser_root / "Audit_Revision_Review_Reopened.zip").read_bytes(),
                    "revision_download", "The two installed downloads differ from complete native bytes.")
            manifest, decision_members = unpack_package(archive_body)
            decision = json.loads(decision_members["review-transition.json"])
            require(manifest["kind"] == "review-transition" and decision["preview"] == selection["preview"]
                    and decision["decisions"] == specification["decisions"] and decision["actor"] == specification["actor"],
                    "revision_archive", "The complete original preview and explicit decisions differ.")
            reviews = lambda snapshot: {r["id"]: r["payload"] for r in snapshot["records"] if r["kind"] == "review"}
            before_reviews = reviews(before)
            after_path = root / "AUTHOR_AFTER.json"
            if not after_path.exists():
                original.put(after_path, installed.snapshot(author))
            after = original.read_json(after_path)
            current = installed.snapshot(author)
            require(all({r["id"]: r for r in current["operations"]}.get(r["id"]) == r for r in after["operations"]),
                    "revision_history", "The retained accepted operation history differs.")
            require(after["records"] == current["records"], "revision_history", "The original author records changed after the retained decision.")
            after_reviews = reviews(after)
            selected_ids = set(specification["reviewIds"])
            require({k: v for k, v in before_reviews.items() if k not in selected_ids}
                    == {k: v for k, v in after_reviews.items() if k not in selected_ids},
                    "revision_scope", "An unrelated review was changed.")
            require(decision["before"] == [before_reviews[k] for k in specification["reviewIds"]]
                    and decision["after"] == [after_reviews[k] for k in specification["reviewIds"]],
                    "revision_archive", "The complete before/after archive differs from the original native rows.")
            for choice in specification["decisions"]:
                old, new = before_reviews[choice["reviewId"]], after_reviews[choice["reviewId"]]
                if choice["mode"] == "retain":
                    require(old == new, "revision_scope", "A retained earlier review was changed.")
                else:
                    require(new["revisionId"] == specification["toRevisionId"] and new["sourceId"] == old["sourceId"]
                            and all(new[k] == v for k, v in choice["review"].items())
                            and new["history"] == old.get("history", []) + [{k: v for k, v in old.items() if k != "history"}],
                            "revision_scope", "An explicit native update lost its prior review or complete selected fields.")
            original_rows = {r["id"]: r for r in before["records"] if r["kind"] != "review"}
            require(all({r["id"]: r for r in after["records"]}.get(k) == v for k, v in original_rows.items()),
                    "revision_scope", "A prior original source, edition, analysis or received record changed.")
            for revision_id in set(selection["preview"]["fromRevisions"]) | {specification["toRevisionId"]}:
                with author.connect() as db:
                    revision = author._get(db, "revision", revision_id)
                    require(decision_members["sources/" + revision_id + ".xml"] == author._bytes(db, revision["sha256"]),
                            "revision_source", "Complete original XML differs in the applied archive.")
            exported = original.native(author, root, "revision-full-application", "export.create",
                {"kind": "application", "actor": specification["actor"], "note": "Complete original Audit with explicit revision review and all original source history."})
            record, body = author.download(exported["id"])
            recipient.publish(root / "Audit_Revision_Review_Application.zip", body)
            _, exported_snapshot, _, members = recipient.package(body)
            require(all(members["application/" + row["path"]] == (root / "application" / row["path"]).read_bytes() for row in rows),
                    "revision_source", "The outgoing complete application source differs.")
            received = Workspace(root / "received-workspace", "Received original Audit revision review")
            try:
                outcome = original.native(received, root, "revision-receive-application", "workspace.receive",
                    {"contentBase64": base64.b64encode(body).decode("ascii"), "name": "Audit_Revision_Review_Application.zip",
                     "actor": specification["actor"], "note": "Independent complete revision-review receiving."})
                comparison = original.compare_received(exported_snapshot, installed.snapshot(received),
                    state["workspaceId"], digest(body), members)
                received_archives = [r for r in received.state()["exports"] if r["kind"] == "review-transition" and r["sha256"] == archive["sha256"]]
                require(received_archives and all(r.get("receivedFrom") for r in received_archives),
                        "revision_received", "The original decision archive and origin are absent after receiving.")
                for item in received_archives:
                    require(received.download(item["id"])[1] == archive_body,
                            "revision_received", "The received original decision archive differs.")
                following = original.native(received, root, "revision-reexport-application", "export.create",
                    {"kind": "application", "actor": specification["actor"], "note": "Complete received revision review and original native custody."})
                following_record, following_bytes = received.download(following["id"])
                recipient.publish(root / "Audit_Revision_Review_Received_Application.zip", following_bytes)
                reopened = Workspace(root / "received-workspace")
                try:
                    require(reopened.state() == received.state(), "revision_reopen", "The full received workspace did not reopen exactly.")
                finally:
                    reopened.close()
            finally:
                received.close()
            result = {"schema": "commons.audit-review-transition-native-result.v1", "operation": OPERATION,
                "input": selected, "browser": browser, "decisionArchive": archive,
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

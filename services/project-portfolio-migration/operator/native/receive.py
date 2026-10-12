"""Run the original portfolio source/target desk and receive its complete archive.

This is one retained receiving operation. Source intake, correction, MSPDI
writing, comparison and portable receiving use the original PortfolioWorkspace.
No Project Operations service is imitated by this file-target journey.
"""
from __future__ import annotations

import argparse
import fcntl
import inspect
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading

HERE = Path(__file__).resolve().parent
SERVICE = HERE.parent.parent
sys.path.insert(0, str(SERVICE))
sys.path.insert(0, str(SERVICE / "operator"))

from portfolio import PortfolioWorkspace
from portfolio_target import TargetWorkspace, start_desk
from portfolio_target.target import canonical, utcnow
from portfolio_target.storage import write_bytes

SCHEMA = "portfolio.operator-native-receiving.v1"


def sha_file(path):
    count, result = 0, hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            count += len(chunk)
            result.update(chunk)
    return {"bytes": count, "sha256": result.hexdigest()}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save_json(path, value):
    write_bytes(Path(path), canonical(value))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_artifacts(result):
    for item in result["artifacts"]:
        actual = sha_file(item["path"])
        require(actual["sha256"] == item["sha256"] and actual["bytes"] == item["bytes"],
                "A retained completed artifact changed: " + item["path"])
    return result


def retain_source(source, destination):
    source = Path(source).resolve(strict=True)
    before = source.stat()
    expected = sha_file(source)
    after = source.stat()
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
            "The selected original fixture changed during intake.")
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.exists():
        require(sha_file(destination) == expected, "The original retained fixture differs.")
        return expected
    temporary = destination.with_name("." + destination.name + ".receiving")
    with open(source, "rb") as incoming, open(temporary, "wb") as output:
        shutil.copyfileobj(incoming, output, length=1024 * 1024)
        output.flush()
        os.fsync(output.fileno())
    require(sha_file(temporary) == expected, "The original fixture copy is incomplete.")
    try:
        os.link(temporary, destination)
    except FileExistsError:
        require(sha_file(destination) == expected, "The retained fixture destination changed.")
    finally:
        temporary.unlink(missing_ok=True)
    os.chmod(destination, 0o600)
    return expected


@contextmanager
def running_desk(workspace, native):
    desk = start_desk(workspace, native=native, port=0)
    thread = threading.Thread(target=desk.server.serve_forever,
                              kwargs={"poll_interval": 0.25}, name="portfolio-native-receiving-http")
    thread.start()
    try:
        yield desk
    finally:
        desk.close()
        thread.join()


def browser_receive(desk, entry, *, node, browser_directory, directory):
    private = Path(directory) / "browser-entry.json"
    value = {**entry, "url": desk.origin + "/#token=" + desk.token,
             "browser_directory": str(browser_directory)}
    save_json(private, value)
    try:
        result = subprocess.run([str(node), str(HERE / "browser.mjs"), str(private)],
                                cwd=SERVICE, check=False)
        require(result.returncode == 0,
                "The original browser receiving is retained in browser-progress.json; exit " + str(result.returncode))
        return verify_artifacts(read_json(Path(entry["output"]) / "browser-result.json"))
    finally:
        private.unlink(missing_ok=True)


def _receive(directory, source_path, output, *, node, playwright, chromium,
            operation_id="SENSEI-PORTFOLIO-TARGET-RECEIVING-20261012-B9D2-V1",
            native=None, review_decisions=None, reviewer="Original source receiving operator",
            resume_failed=False):
    directory, output = Path(directory).resolve(), Path(output).resolve()
    require(directory != output and directory not in output.parents,
            "Keep receiving outputs outside the selected business workspace.")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(output, 0o700)
    result_path = output / "result.json"
    source_path = Path(source_path).resolve()
    source_copy = output / "selected-input" / source_path.name
    saved_input = source_copy.with_name(source_copy.name + ".retained")
    intent_path = output / "operation.json"
    selected = source_path if source_path.is_file() else (
        source_copy if source_copy.is_file() else saved_input if intent_path.exists() and saved_input.is_file() else None)
    require(selected is not None, "Reopen the original selected fixture or its retained input bytes.")
    source_metadata = sha_file(selected)
    control = {"schema": SCHEMA, "operation_id": operation_id, "workspace": str(directory),
               "source_sha256": source_metadata["sha256"], "source_bytes": source_metadata["bytes"],
               "source_filename": source_path.name, "review_decisions": review_decisions or {},
               "reviewer": reviewer}
    if intent_path.exists():
        previous = read_json(intent_path)
        require(previous["input"] == control, "Resume this exact original receiving operation and selected source.")
    else:
        save_json(intent_path, {"input": control, "created_at": utcnow()})
    if result_path.exists():
        return verify_artifacts(read_json(result_path))
    retain_source(selected, source_copy)
    workspace = TargetWorkspace(directory, native=native)
    native = workspace.portfolio.native
    runtime = native.ensure()
    save_json(output / "native-runtime.json", runtime)
    manifest = read_json(SERVICE / "operator" / "source-manifest.json")
    require(manifest["schema"] == "portfolio.operator-source.v1", "Use the complete selected operator source manifest.")
    source_selection = {"schema": "portfolio.operator-receiving-source.v1",
                        "operation_id": operation_id, "files": []}
    for selected_file in manifest["files"]:
        file = (SERVICE / "operator" / selected_file["path"]).resolve(strict=True)
        require((SERVICE / "operator").resolve() in file.parents, "An operator source entry leaves its original subtree.")
        actual = sha_file(file)
        require(actual["sha256"] == selected_file["sha256"] and actual["bytes"] == selected_file["bytes"],
                "The selected operator source differs from its complete manifest: " + selected_file["path"])
        source_selection["files"].append({"path": str(file.relative_to(SERVICE)), **actual})
    original_package = Path(inspect.getfile(PortfolioWorkspace)).resolve().parent
    for file in sorted(original_package.glob("*.py")):
        source_selection["files"].append({"path": "portfolio/" + file.name, **sha_file(file)})
    selection_path = output / "source-selection.json"
    if selection_path.exists():
        previous = read_json(selection_path)
        if previous != source_selection:
            history = read_json(output / "source-selection-history.json") if (output / "source-selection-history.json").exists() else []
            history.append(previous)
            save_json(output / "source-selection-history.json", history)
    save_json(selection_path, source_selection)
    entry = {
        "operation_id": operation_id, "source": str(source_copy),
        "source_sha256": source_metadata["sha256"], "source_label": source_path.name,
        "playwright": str(Path(playwright).resolve(strict=True)),
        "chromium": str(Path(chromium).resolve(strict=True)),
        "reviewer": reviewer, "review_decisions": review_decisions or {},
        "resume_failed": bool(resume_failed),
    }
    with tempfile.TemporaryDirectory(prefix="portfolio-receiving-", dir="/dev") as browser_root:
        with running_desk(directory, native) as desk:
            original = browser_receive(desk, {**entry, "phase": "original", "output": str(output / "original")},
                node=Path(node).resolve(strict=True), browser_directory=Path(browser_root) / "original", directory=output)
        archive = Path(original["archive"]["path"]).resolve(strict=True)
        require(sha_file(archive) == {key: original["archive"][key] for key in ("sha256", "bytes")},
                "The complete original workspace archive changed.")
        restored = output / "received-workspace"
        restore_intent = {"schema": "portfolio.operator-receiving-restore.v1",
                          "operation_id": operation_id, "archive_sha256": original["archive"]["sha256"],
                          "archive_bytes": original["archive"]["bytes"], "destination": str(restored)}
        restore_intent_path, restore_receipt_path = output / "restore-intent.json", output / "restore-receipt.json"
        if restore_intent_path.exists():
            require(read_json(restore_intent_path) == restore_intent, "Keep the original cold-restore destination.")
        else:
            save_json(restore_intent_path, restore_intent)
        # Only our private selected-input copy is moved. The original upstream
        # fixture remains untouched, and the complete copied bytes are retained.
        saved_input = source_copy.with_name(source_copy.name + ".retained")
        if source_copy.exists():
            if saved_input.exists():
                require(sha_file(saved_input) == source_metadata, "The saved original input differs.")
                source_copy.unlink()
            else:
                source_copy.rename(saved_input)
        require(not source_copy.exists() and sha_file(saved_input) == source_metadata,
                "The source-absent receiving boundary did not preserve the original bytes.")
        if restore_receipt_path.exists():
            restore_receipt = read_json(restore_receipt_path)
        else:
            restore_receipt = PortfolioWorkspace.receive_workspace(archive, restored)
            save_json(restore_receipt_path, restore_receipt)
        received = TargetWorkspace(restored, native=native)
        actual = received.deployment(original["deployment_id"])
        require(actual["state"] == "ACCEPTED" and actual["acceptance_sha256"] == original["acceptance_sha256"],
                "The actual cold-restored workspace did not preserve the original target acceptance.")
        for request_id in original["original_request_ids"][:-1]:
            retained = received.request_result(request_id)
            require(retained["state"] == "COMPLETE",
                    "An original completed business action was not retained by the workspace archive.")
        with running_desk(restored, native) as desk:
            reopened = browser_receive(desk, {**entry, "phase": "restored", "original": original,
                "output": str(output / "restored-browser")},
                node=Path(node).resolve(strict=True), browser_directory=Path(browser_root) / "restored", directory=output)
    artifacts = [*original["artifacts"], *reopened["artifacts"]]
    for name in ("native-runtime.json", "source-selection.json", "restore-receipt.json"):
        path = output / name
        artifacts.append({"path": str(path), "filename": name, **sha_file(path)})
    result = {
        "schema": "portfolio.operator-native-receiving-result.v1", "operation_id": operation_id,
        "state": "COMPLETE", "source_fixture": source_metadata, "native_runtime": runtime,
        "original": original, "restored": reopened,
        "source_absent_receiving": {"selected_input": str(source_copy), "retained_bytes": str(saved_input),
                                    "archive_sha256": original["archive"]["sha256"]},
        "restore": restore_receipt, "artifacts": artifacts, "completed_at": utcnow(),
    }
    save_json(result_path, result)
    return verify_artifacts(result)


def receive(directory, source_path, output, **options):
    """Join one exact retained operation; another live receiver keeps its lease."""
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(output / ".receiving.lock", "a+b") as lease:
        try:
            fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError("The original receiving operation is already active.") from exc
        try:
            return _receive(directory, source_path, output, **options)
        finally:
            fcntl.flock(lease.fileno(), fcntl.LOCK_UN)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Receive one original source-native portfolio migration through its complete target desk.")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--source", required=True, help="Selected exact upstream project fixture or authorized project file.")
    parser.add_argument("--output", required=True)
    parser.add_argument("--operation-id", default="SENSEI-PORTFOLIO-TARGET-RECEIVING-20261012-B9D2-V1")
    parser.add_argument("--node", default="/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node")
    parser.add_argument("--playwright", default="/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")
    parser.add_argument("--chromium", required=True, help="Actual existing Chromium executable.")
    parser.add_argument("--review-decisions", help="Exact original finding decisions JSON, if the selected source requires them.")
    parser.add_argument("--reviewer", default="Original source receiving operator")
    parser.add_argument("--resume-failed", action="store_true", help="Reopen the same failed local request after its source correction.")
    args = parser.parse_args(argv)
    result = receive(args.workspace, args.source, args.output, node=args.node, playwright=args.playwright,
                     chromium=args.chromium, operation_id=args.operation_id, reviewer=args.reviewer,
                     review_decisions=read_json(args.review_decisions) if args.review_decisions else None,
                     resume_failed=args.resume_failed)
    print(json.dumps({"state": result["state"], "operation_id": result["operation_id"],
                      "result_file": str(Path(args.output).resolve() / "result.json"),
                      "archive_sha256": result["original"]["archive"]["sha256"],
                      "acceptance_sha256": result["original"]["acceptance_sha256"]}), flush=True)


if __name__ == "__main__":
    main()

"""Join the original native portfolio receiving operation with its archive workflow."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

SERVICE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SERVICE))
sys.path.insert(0, str(SERVICE / "operator"))

from portfolio_target import TargetWorkspace
from portfolio_target.storage import file_lock, write_bytes
from portfolio_target.target import canonical, utcnow

_original_spec = importlib.util.spec_from_file_location(
    "portfolio_original_native_receiving", SERVICE / "operator" / "native" / "receive.py")
_original = importlib.util.module_from_spec(_original_spec)
_original_spec.loader.exec_module(_original)

SCHEMA = "portfolio.archive-native-receiving.v1"


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save(path, value):
    write_bytes(Path(path), canonical(value))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def profile_for(workspace, members):
    coverage = workspace.archives.fields([row["edition_id"] for row in members])
    actual = {row["field"]: row for row in coverage["tasks"]}
    selected = []
    for name, field, kind, allowed in (
            ("current_cost", "COST", "money", {"CURRENCY"}),
            ("actual_cost", "ACTUAL_COST", "money", {"CURRENCY"}),
            ("planned_work", "WORK", "work", {"WORK", "DURATION", "DELAY"})):
        definition = actual.get(field)
        if definition and all(item.get("data_type") in allowed for item in definition["definitions"].values()):
            selected.append({"name": name, "field": field, "kind": kind})
    return {"metrics": {"grain": "leaf_tasks", "measures": selected}}


def members_for(workspace, edition_ids):
    require(edition_ids and len(edition_ids) == len(set(edition_ids)),
            "Select distinct actual native editions from the parent operation.")
    result = []
    for ordinal, identity in enumerate(edition_ids):
        edition = workspace.portfolio.read_edition(identity)
        require(edition["model"].get("schema") == "project-portfolio-model.v1",
                "Select the actual original native portfolio model.")
        value = edition["model"]["project"].get("fields", {}).get("NAME", {})
        label = value.get("value") if isinstance(value, dict) else None
        result.append({"project_key": "native-project-" + str(ordinal + 1),
                       "label": label if isinstance(label, str) and label.strip() else "Original native project " + str(ordinal + 1),
                       "edition_id": edition["id"]})
    return result


def receive_archive(directory, edition_ids, output, *, operation_id, node, playwright, chromium,
                    native=None, reviewer="Original portfolio receiving operator", resume_failed=False):
    """Continue actual saved native editions; acquire no source or target service."""
    directory, output = Path(directory).resolve(), Path(output).resolve()
    require(directory != output and directory not in output.parents,
            "Keep the receiving output outside the customer workspace.")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    with file_lock(output / ".receiving.lock"):
        workspace = TargetWorkspace(directory, native=native)
        native = workspace.portfolio.native
        members = members_for(workspace, edition_ids)
        control = {"schema": SCHEMA, "operation_id": operation_id, "workspace": str(directory),
                   "members": members, "reviewer": reviewer}
        intent = output / "operation.json"
        if intent.exists():
            require(read(intent)["input"] == control, "Resume the exact selected original archive receiving phase.")
        else:
            save(intent, {"input": control, "created_at": utcnow()})
        result_path = output / "result.json"
        if result_path.exists():
            return _original.verify_artifacts(read(result_path))
        profile_path = output / "selected-profile.json"
        if profile_path.exists():
            profile = read(profile_path)
        else:
            profile = profile_for(workspace, members)
            save(profile_path, profile)
        source_path = output / "source-selection.json"
        selected_sources = []
        for root in (SERVICE / "archive", SERVICE / "operator" / "portfolio_target"):
            for path in sorted(root.rglob("*")):
                if path.is_file() and path.suffix in (".py", ".js", ".mjs", ".html", ".css", ".md", ".json") and "__pycache__" not in path.parts:
                    selected_sources.append({"path": str(path.relative_to(SERVICE)), **_original.sha_file(path)})
        for path in (SERVICE / "operator" / "native" / "browser.mjs", SERVICE / "operator" / "native" / "receive.py"):
            selected_sources.append({"path": str(path.relative_to(SERVICE)), **_original.sha_file(path)})
        selection = {"schema": "portfolio.archive-receiving-source.v1", "operation_id": operation_id,
                     "files": selected_sources}
        if source_path.exists() and read(source_path) != selection:
            history_path = output / "source-selection-history.json"
            history = read(history_path) if history_path.exists() else []
            history.append(read(source_path)); save(history_path, history)
        save(source_path, selection)
        entry = {"operation_id": operation_id, "name": "Original native portfolio archive",
                 "members": members, "profile": profile, "reviewer": reviewer,
                 "playwright": str(Path(playwright).resolve(strict=True)),
                 "chromium": str(Path(chromium).resolve(strict=True)), "resume_failed": bool(resume_failed)}
        with tempfile.TemporaryDirectory(prefix="portfolio-archive-receiving-", dir="/dev") as browser_root:
            with _original.running_desk(directory, native) as desk:
                published = _original.browser_receive(desk,
                    {**entry, "phase": "archive", "output": str(output / "original")},
                    node=Path(node).resolve(strict=True), browser_directory=Path(browser_root) / "original", directory=output)
            archive = Path(published["archive"]["path"]).resolve(strict=True)
            require(_original.sha_file(archive) == {key: published["archive"][key] for key in ("sha256", "bytes")},
                    "The original complete reporting archive changed.")
            receiving_directory = output / "received-workspace"
            with _original.running_desk(receiving_directory, native) as desk:
                received = _original.browser_receive(desk,
                    {**entry, "phase": "archive-restored", "original": published, "output": str(output / "received")},
                    node=Path(node).resolve(strict=True), browser_directory=Path(browser_root) / "received", directory=output)
            received_workspace = TargetWorkspace(receiving_directory, native=native)
            selected = received["selected_upload"]
            selected_upload = received_workspace.store.root / "uploads" / selected["sha256"] / selected["filename"]
            retained_upload = selected_upload.with_name(selected_upload.name + ".retained")
            if selected_upload.exists():
                if retained_upload.exists():
                    require(_original.sha_file(retained_upload) == {key: selected[key] for key in ("sha256", "bytes")},
                            "The selected original receiving input changed.")
                    selected_upload.unlink()
                else:
                    selected_upload.rename(retained_upload)
            require(not selected_upload.exists() and _original.sha_file(retained_upload) == {
                key: selected[key] for key in ("sha256", "bytes")},
                "The original source-absent receiving boundary did not preserve its bytes.")
            original_request = received_workspace.request_result(received["receiving_request_id"])
            require(original_request["state"] == "COMPLETE", "The original receiving request is incomplete.")
            # Exercise the original A durable action directly after the uploaded
            # filename disappears. It must return its completed same-ID receipt.
            replay = received_workspace.archives.run(original_request["id"], original_request["kind"], original_request["arguments"])
            require(replay == original_request["result"], "Source-absent replay changed the original receiving result.")
            for member in members:
                original_edition = workspace.portfolio.read_edition(member["edition_id"])
                received_edition = received_workspace.portfolio.read_edition(member["edition_id"])
                require(original_edition["sha256"] == received_edition["sha256"]
                        and original_edition["model"] == received_edition["model"],
                        "Cold receiving changed the complete original native project model.")
            with _original.running_desk(receiving_directory, native) as desk:
                reopened = _original.browser_receive(desk,
                    {**entry, "phase": "archive-reopened", "original": received, "output": str(output / "reopened")},
                    node=Path(node).resolve(strict=True), browser_directory=Path(browser_root) / "reopened", directory=output)
        replay_path = output / "source-absent-replay.json"
        save(replay_path, {"request_id": original_request["id"], "kind": original_request["kind"],
                          "result": replay, "original_upload": str(selected_upload),
                          "retained_upload": str(retained_upload)})
        artifacts = [*published["artifacts"], *received["artifacts"], *reopened["artifacts"]]
        for path in (intent, profile_path, source_path, replay_path):
            artifacts.append({"path": str(path), "filename": path.name, **_original.sha_file(path)})
        result = {"schema": "portfolio.archive-native-receiving-result.v1", "state": "COMPLETE",
                  "operation_id": operation_id, "members": members, "profile": profile,
                  "original": published, "received": received, "reopened": reopened,
                  "source_absent_replay": replay, "artifacts": artifacts, "completed_at": utcnow()}
        save(result_path, result)
        return _original.verify_artifacts(result)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Continue the original native portfolio job through its complete archive desk.")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--edition", action="append", required=True, help="Actual retained native edition ID; repeat for another original project.")
    parser.add_argument("--output", required=True)
    parser.add_argument("--operation-id", required=True, help="The original parent receiving operation identity.")
    parser.add_argument("--node", default="/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node")
    parser.add_argument("--playwright", default="/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")
    parser.add_argument("--chromium", required=True)
    parser.add_argument("--resume-failed", action="store_true")
    args = parser.parse_args(argv)
    result = receive_archive(args.workspace, args.edition, args.output, operation_id=args.operation_id,
                             node=args.node, playwright=args.playwright, chromium=args.chromium,
                             resume_failed=args.resume_failed)
    print(json.dumps({"state": result["state"], "operation_id": result["operation_id"],
                      "result_file": str(Path(args.output).resolve() / "result.json"),
                      "archive_sha256": result["original"]["archive"]["sha256"],
                      "cohort_id": result["original"]["cohort_id"]}), flush=True)


if __name__ == "__main__":
    main()

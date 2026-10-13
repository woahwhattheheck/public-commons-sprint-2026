"""Resume a complete private application preparation in the installed workbench.

Usage: python application-receiving.py /absolute/private/config.json
Run in the existing equipped receiving environment. Configuration and generated
application documents contain private inputs and remain in the operator's custody.
"""
from __future__ import annotations
import base64
import hashlib
import json
import os
import sys
from pathlib import Path

from scc_workbench import engine, exports
from scc_workbench.workspace import Workspace, json_read


def read_json(path):
    return json_read(Path(path).read_bytes())


def atomic(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".pending")
    with temporary.open("wb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def save_json(path, value):
    atomic(path, (engine.canonical(value) + "\n").encode())


def main(config_path):
    config_path = Path(config_path).resolve()
    config = read_json(config_path)
    required = {"schema", "operation_id", "workspace", "project_id", "selection",
                "reviewed_input", "output", "title", "actor"}
    if not isinstance(config, dict) or not required <= set(config) or config["schema"] != "standards-application-receiving/v1":
        raise ValueError("Use the complete private receiving configuration in APPLICATION-WORKBENCH.md.")
    operation_id = engine.identity(config["operation_id"], "Receiving operation")
    project_id = engine.identity(config["project_id"], "Original project")
    def local(value):
        path = Path(value)
        return (config_path.parent / path).resolve() if not path.is_absolute() else path.resolve()
    output = local(config["output"])
    output.mkdir(parents=True, exist_ok=True)
    ledger_path = output / "original-operation.json"
    configuration_sha = engine.digest(config)
    ledger = read_json(ledger_path) if ledger_path.exists() else {
        "schema": "standards-application-receiving-ledger/v1",
        "operation_id": operation_id, "configuration_sha256": configuration_sha,
        "project_id": project_id, "commands": {}, "results": {}}
    if ledger.get("operation_id") != operation_id or ledger.get("configuration_sha256") != configuration_sha:
        raise ValueError("Continue this operation with its exact original config; use a successor output directory for changed selections.")
    workspace = Workspace(local(config["workspace"]) / "projects.sqlite3")
    workspace.full_state(project_id)

    def execute(step, operation, payload):
        existing = ledger["commands"].get(step)
        if existing is None:
            request_id = "application-receive-" + hashlib.sha256((operation_id + ":" + step).encode()).hexdigest()
            existing = {"operation": operation, "payload": payload,
                        "expected_revision": workspace.full_state(project_id)["revision"],
                        "request_id": request_id, "actor": config["actor"]}
            ledger["commands"][step] = existing
            save_json(ledger_path, ledger)
        elif existing["operation"] != operation or engine.canonical(existing["payload"]) != engine.canonical(payload):
            raise ValueError("This receiving step has different input from its original retained command.")
        result = workspace.apply(project_id, **existing)
        ledger["results"][step] = result
        save_json(ledger_path, ledger)
        return result

    # Source additions are optional: prefer IDs already retained in this project.
    for index, source in enumerate(config.get("sources", [])):
        raw = local(source["path"]).read_bytes()
        if hashlib.sha256(raw).hexdigest() != source["sha256"]:
            raise ValueError("Configured original source bytes differ.")
        execute("source-" + str(index), "source.add", {
            "source_id": source["source_id"], "filename": local(source["path"]).name,
            "content_base64": base64.b64encode(raw).decode(),
            "metadata": source["metadata"]})

    reviewed = read_json(local(config["reviewed_input"]))
    selection = config["selection"]
    if "save-draft" not in ledger["commands"]:
        inspected = workspace.application_inspect(project_id, {
            "selection": selection, "reviewed": reviewed,
            "include_source_ids": config.get("include_source_ids", [])})
        save_json(output / "selected-input-inspection.json", inspected)
    suffix = hashlib.sha256(operation_id.encode()).hexdigest()[:28]
    draft_id, application_id = "application-draft-" + suffix, "application-edition-" + suffix
    draft_payload = {"id": draft_id, "title": config["title"], "selection": selection,
                     "reviewed": reviewed, "include_source_ids": config.get("include_source_ids", []),
                     "predecessor_id": config.get("predecessor_id", "")}
    execute("save-draft", "application.save", draft_payload)
    execute("freeze", "application.freeze", {
        "id": application_id, "draft_id": draft_id, "title": config["title"],
        "review_note": config.get("review_note", "")})
    application, manifest = exports.export_project(
        workspace, project_id, "application", application_id=application_id)
    atomic(output / "application.zip", application)
    save_json(output / "application-manifest.json", manifest)
    private, private_manifest = exports.export_project(workspace, project_id, "private_restore")
    atomic(output / "complete-private-workspace.zip", private)
    cold = Workspace(output / ("cold-received-" + hashlib.sha256(private).hexdigest()[:24]) / "projects.sqlite3")
    exports.import_project(cold, private)
    original_state = workspace.full_state(project_id)
    restored_state = cold.full_state(project_id)
    if engine.digest(original_state) != engine.digest(restored_state):
        raise ValueError("Cold-received project differs from its complete original.")
    replay = cold.apply(project_id, **ledger["commands"]["save-draft"])
    if not replay.get("replayed"):
        raise ValueError("Cold-received original request did not resolve to its retained result.")
    current = engine.record(restored_state, "application_editions", application_id)
    result = {"schema": "standards-application-native-result/v1", "operation_id": operation_id,
              "project_id": project_id, "revision": restored_state["revision"],
              "application_id": application_id, "input_sha256": current["input_sha256"],
              "application_bytes": len(application), "application_sha256": hashlib.sha256(application).hexdigest(),
              "private_workspace_bytes": len(private), "private_workspace_sha256": hashlib.sha256(private).hexdigest(),
              "cold_restore": "identical_complete_state", "original_request": "recovered_after_cold_restore",
              "visual_review": "Inspect every PDF page and both DOCX documents in the original browser/native course."}
    save_json(output / "native-result.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python application-receiving.py /absolute/private/config.json")
    main(sys.argv[1])

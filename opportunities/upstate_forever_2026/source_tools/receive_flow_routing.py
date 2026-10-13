"""Receive saved native routing explanations and reopen their complete Workspace.

Run after the same application's browser course, with its actual operation JSON.
This command reads the two saved reports and their original completed native
runs. It performs no scientific solve and creates no routing selection.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import platform
import socket
import sys

from model.common import atomic_bytes, atomic_json, file_digest, held, now, read_json, verify_file
from model.workspace import Workspace
from model import portable, flow_routing
from model.flow_routing_source import retained_source


def _receive_report(ws, key, directory):
    record, document = flow_routing.inspect(ws, key)
    source = retained_source(ws, record["selection"]["run_id"], record["selection"]["model"])
    original_root = ws.root / flow_routing.ROOT / key
    originals = read_json(original_root / "originals.json")
    if source != originals["source"] or record["source_id"] != source["id"]:
        raise ValueError("The actual completed native source changed for saved route " + key)
    if document["binding"]["native_source_id"] != source["id"]:
        raise ValueError("The saved route no longer identifies its original native source")
    directory.mkdir(parents=True, exist_ok=True)
    copied = {}
    for name, descriptor in record["files"].items():
        original = verify_file(original_root, descriptor)
        target = directory / name
        atomic_bytes(target, original.read_bytes(), immutable=True)
        if target.stat().st_size != descriptor["bytes"] or file_digest(target) != descriptor["sha256"]:
            raise ValueError("A received original route attachment changed: " + name)
        copied[name] = descriptor
    atomic_json(directory / "report.json", record, immutable=True)
    return record, document, source, copied


def _run(args):
    ws = Workspace(Path(args.workspace).resolve(strict=True))
    browser_path = Path(args.browser_operation).resolve(strict=True)
    browser = read_json(browser_path)
    identity = browser.get("identity") or {}
    if (identity.get("schema") != "upstate.flow-routing-browser/v1"
            or identity.get("workspace_directory") != str(ws.root)
            or not browser.get("completed_at")):
        raise ValueError("Open the completed original browser operation for this actual Workspace")
    stages = browser.get("selections")
    if not isinstance(stages, list) or len(stages) != 2 or not all(row.get("report_id") for row in stages):
        raise ValueError("Receive both original saved routing selections from the same browser course")
    keys = [row["report_id"] for row in stages]
    if len(set(keys)) != 2:
        raise ValueError("The two separately selected source points must retain distinct saved reports")
    output = Path(args.output_dir).resolve()
    application = Path(__file__).resolve().parents[1]
    for root in (ws.root, application):
        if output == root or output.is_relative_to(root):
            raise ValueError("Place receiving exports outside the actual Workspace and application")
    output.mkdir(parents=True, exist_ok=True)
    original_identity = {"schema": "upstate.flow-routing-receiving/v1",
                         "workspace": str(ws.root), "project_id": ws.project["id"],
                         "browser_identity": identity, "report_ids": keys,
                         "selections": [{"report_id": row["report_id"],
                                         "source_id": row["source_id"],
                                         "selection": row["selection"]} for row in stages]}
    invocation_path = output / "invocation.json"
    if invocation_path.exists():
        invocation = read_json(invocation_path)
        if invocation["identity"] != original_identity:
            raise ValueError("This receiving directory belongs to another original route selection")
    else:
        invocation = {"identity": original_identity, "started_at": now(),
                      "accepting_host": socket.gethostname(), "interpreter": sys.executable,
                      "python": platform.python_version(), "application": str(application)}
        atomic_json(invocation_path, invocation, immutable=True)
    # Keep the first complete original browser journal; later receiving attempts
    # may add capture timestamps, while the stable selected report identities stay exact.
    received_browser = output / "original-browser-operation.json"
    if not received_browser.exists():
        atomic_json(received_browser, browser, immutable=True)
    originals = []
    for row in stages:
        record, document, source, files = _receive_report(ws, row["report_id"], output / row["report_id"])
        if (record["selection"] != row["selection"] or record["source_id"] != row["source_id"]
                or record["project_id"] != ws.project["id"]):
            raise ValueError("The saved report differs from the actual browser selection")
        originals.append((record, document, source, files))

    transfer = output / "workspace-transfer.zip"
    transfer_record = output / "workspace-transfer.json"
    if not transfer.exists():
        result = portable.backup(ws, transfer, include_intermediates=True, include_deliveries=True)
        atomic_json(transfer_record, result, immutable=True)
    elif not transfer_record.exists():
        manifest = portable.inspect_archive(transfer, verify=True)
        if manifest["project"]["id"] != ws.project["id"]:
            raise ValueError("The retained original archive belongs to another project")
        atomic_json(transfer_record, {"path": str(transfer), "bytes": transfer.stat().st_size,
                    "sha256": file_digest(transfer), "recovered_archive": True}, immutable=True)
    saved_transfer = read_json(transfer_record)
    if (saved_transfer["bytes"] != transfer.stat().st_size
            or saved_transfer["sha256"] != file_digest(transfer)):
        raise ValueError("The complete original Workspace transfer changed")

    reopen = output / "reopened"
    if not reopen.exists():
        restored = portable.restore(transfer, reopen)
    else:
        restored = portable.resume_restore(
            transfer, reopen, expected_archive_sha256=saved_transfer["sha256"])
    restore_path = output / "restore.json"
    if restore_path.exists():
        original_restore = read_json(restore_path)
        # The maintained receiver adds this observation only on a completed
        # replay; every original archive/destination/application field stays exact.
        comparable = lambda value: {key: item for key, item in value.items()
                                    if key != "reused_completed_output"}
        if comparable(original_restore) != comparable(restored):
            raise ValueError("The original complete Workspace receiving result changed")
    else:
        atomic_json(restore_path, restored, immutable=True)
    received = Workspace(reopen / "workspace")
    if received.project["id"] != ws.project["id"]:
        raise ValueError("Cold reopen changed the original project identity")
    summaries = []
    for record, document, source, files in originals:
        reopened_record, reopened_document = flow_routing.inspect(received, record["id"])
        reopened_source = retained_source(received, record["selection"]["run_id"], record["selection"]["model"])
        if (reopened_record != record or reopened_document != document or reopened_source != source):
            raise ValueError("Cold reopen changed a saved route, its full graph or original native source")
        for name, descriptor in files.items():
            reopened_file = verify_file(received.root / flow_routing.ROOT / record["id"], descriptor)
            if file_digest(reopened_file) != file_digest(output / record["id"] / name):
                raise ValueError("Cold reopen changed an original outgoing route attachment")
        summaries.append({"report_id": record["id"], "source_id": source["id"],
                          "selection": record["selection"], "summary": record["summary"],
                          "files": files})
    result = {"schema": "upstate.flow-routing-receiving-result/v1",
              "started_at": invocation["started_at"], "completed_at": now(),
              "source_workspace": str(ws.root), "reopened_workspace": str(received.root),
              "project_id": ws.project["id"], "reports": summaries,
              "original_browser_operation": str(received_browser),
              "workspace_transfer": {"path": str(transfer), "bytes": transfer.stat().st_size,
                                     "sha256": file_digest(transfer)},
              "receiving_directory": str(output),
              "operator_instruction": "Open the original report HTML/SVG/PNG, all tabular and GIS attachments, and the restored Workspace in the same application; personally view desktop and narrow layouts."}
    atomic_json(output / "receiving-result.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def run(args):
    output = Path(args.output_dir).resolve()
    for root in (Path(args.workspace).resolve(), Path(__file__).resolve().parents[1]):
        if output == root or output.is_relative_to(root):
            raise ValueError("Keep the receiving directory outside the Workspace and application")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".receiving.lock", blocking=False):
        return _run(args)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--browser-operation", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    try:
        return run(args)
    except Exception as error:
        output = Path(args.output_dir).resolve()
        invocation = output / "invocation.json"
        if invocation.exists():
            retained = read_json(invocation)
            if retained.get("identity", {}).get("workspace") == str(Path(args.workspace).resolve()):
                atomic_json(output / "receiving-error.json", {"at": now(),
                            "error_type": type(error).__name__, "message": str(error)})
        raise


if __name__ == "__main__":
    raise SystemExit(main())

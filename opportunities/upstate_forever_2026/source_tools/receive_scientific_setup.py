"""Receive an actual saved scientific setup, export its review, and reopen its project.

Run from the maintained application root. This command selects only existing
Workspace objects supplied in an actual selection document. It creates no model
inputs, scenarios, reviewer identities or review decisions.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import shutil
import socket
import sys

from model.common import atomic_json, digest, file_digest, now, read_json, verify_file
from model.workspace import Workspace
from model import portable, reviews, setup_review


def _head(ws, review_id):
    chain = reviews.history(ws, review_id)
    return chain[-1]["id"] if chain else None


def _same_selection(ws, original):
    """Resolve every captured original selection after opening the real transfer."""
    selection = original["setup"]["selection"]
    current = setup_review.detail(ws, original["setup_id"])
    if current["setup"] != original["setup"]:
        raise ValueError("Reopened setup record differs from its retained original")
    if current["specification"] != original["specification"]:
        raise ValueError("Reopened specification differs from the captured original")
    grid = ws.get_grid(selection["grid_id"])
    if grid["spec"] != original["specification"]["grid"]["spec"] or grid["grid"] != original["specification"]["grid"]["definition"]:
        raise ValueError("Reopened native grid differs from the captured definition")
    for body in grid["files"].values():
        verify_file(ws.root / "grids" / grid["id"], body)
    profile = ws._get("profiles", selection["profile_id"])
    if profile != original["specification"]["method"]["profile"]:
        raise ValueError("Reopened parameter profile differs from the selected original")
    scenarios = [ws._get("scenarios", key) for key in
                 [selection["baseline_scenario_id"], *selection["alternative_scenario_ids"]]]
    if scenarios != [original["specification"]["baseline"], *original["specification"]["alternatives"]]:
        raise ValueError("Reopened baseline or alternatives differ from the selected originals")
    sources = {key: ws._get("sources", key) for key in original["specification"]["source_collection_ids"]}
    for row in original["specification"]["source_inventory"]:
        key = row["collection_id"]
        collection = sources.setdefault(key, ws._get("sources", key))
        entry = next((item for item in collection["entries"] if item["id"] == row["source_id"]), None)
        if entry is None or entry["body"] != row["body"] or entry.get("companions", []) != row["companions"]:
            raise ValueError("Reopened original source edition differs")
        ws.source_file(key, row["source_id"])
    for row in original["specification"]["observations"]:
        observation = ws._get("observations", row["id"])
        if observation["original"] != row["original"] or observation["metadata"] != row["metadata"]:
            raise ValueError("Reopened observations differ from their original record")
    return {"grid_id": grid["id"], "profile_id": profile["id"],
            "baseline_scenario_id": scenarios[0]["id"],
            "alternative_scenario_ids": [row["id"] for row in scenarios[1:]],
            "source_collection_ids": sorted(sources),
            "observation_ids": selection["observation_ids"],
            "setup_id": current["setup_id"], "review_id": current["review_id"],
            "source_collection_id": current["source_collection_id"],
            "specification_sha256": current["setup"]["specification_sha256"],
            "latest_response_id": _head(ws, current["review_id"])}


def run(args):
    started = now()
    ws = Workspace(Path(args.workspace))
    if args.catalog:
        value = {"workspace": str(ws.root), **setup_review.catalog(ws)}
        if args.output_dir:
            output = Path(args.output_dir).resolve()
            output.mkdir(parents=True, exist_ok=True)
            atomic_json(output / "setup-catalog.json", value)
        print(json.dumps(value, ensure_ascii=False, indent=2))
        return 0
    if not args.selection or not args.output_dir:
        raise ValueError("Capture requires an actual --selection JSON and an owned --output-dir")
    selection_path = Path(args.selection).resolve(strict=True)
    original_selection_bytes = selection_path.read_bytes()
    selection = json.loads(original_selection_bytes)
    original_selection_sha256 = hashlib.sha256(original_selection_bytes).hexdigest()
    output = Path(args.output_dir).resolve()
    if output == ws.root or output.is_relative_to(ws.root):
        raise ValueError("Place receiving exports outside the source Workspace")
    application = Path(__file__).resolve().parents[1]
    if output == application or output.is_relative_to(application):
        raise ValueError("Place receiving exports outside the application source")
    output.mkdir(parents=True, exist_ok=True)
    invocation_path = output / "invocation.json"
    identity = {"project_id": ws.project["id"], "workspace": str(ws.root),
                "selection_sha256": original_selection_sha256,
                "selection": setup_review.normalize(selection)}
    if invocation_path.exists():
        invocation = read_json(invocation_path)
        if invocation["identity"] != identity:
            raise ValueError("Receiving output already belongs to a different actual selection")
    else:
        invocation = {
            "schema": "upstate.scientific-setup-receiving-invocation/v1",
            "identity": identity, "started_at": started,
            "operation_id": args.operation_id or digest(identity),
            "accepting_host": socket.gethostname(), "interpreter": sys.executable,
            "python": platform.python_version(), "application": str(application),
            "argv": sys.argv,
        }
        atomic_json(invocation_path, invocation, immutable=True)
    incoming = output / "original-selection.json"
    if incoming.exists():
        if incoming.read_bytes() != original_selection_bytes:
            raise ValueError("Original receiving selection changed")
    else:
        temporary_selection = output / ".original-selection.pending"
        temporary_selection.write_bytes(original_selection_bytes)
        if incoming.exists():
            raise ValueError("Original selection appeared during admission")
        temporary_selection.replace(incoming)
    captured = setup_review.create(ws, selection, operation_id=invocation["operation_id"],
                                   created_at=invocation["started_at"])
    atomic_json(output / "captured-setup.json", captured["setup"], immutable=True)
    atomic_json(output / "specification.json", captured["specification"], immutable=True)
    review_id = captured["review_id"]
    current_head = _head(ws, review_id)
    atomic_json(output / "response-template.json", reviews.response_template(ws, review_id))
    review_directory = output / "customer-review"
    if review_directory.exists():
        exported = reviews.describe_export(review_directory)
        if exported["review_id"] != review_id:
            raise ValueError("Existing review export belongs to a different setup")
        # The exact selected response generation is retained in the export.
        exported_head = exported.get("latest_response_id")
        if exported_head != current_head:
            raise ValueError("Existing review export has another response generation; select a new output directory")
    else:
        exported = reviews.export_review(ws, review_id, review_directory,
                                         expected_response_id=current_head)
    atomic_json(output / "review-export.json", exported)
    transfer_path = output / "workspace-transfer.zip"
    if not transfer_path.exists():
        transferred = portable.backup(ws, transfer_path,
                                      include_intermediates=True, include_deliveries=True)
        atomic_json(output / "workspace-transfer.json", transferred, immutable=True)
    elif not (output / "workspace-transfer.json").exists():
        # Recover a post-archive interruption by inspecting the complete original archive.
        archive_manifest = portable.inspect_archive(transfer_path, verify=True)
        if archive_manifest["project"] != ws.project:
            raise ValueError("Existing Workspace archive belongs to a different project")
        atomic_json(output / "workspace-transfer.json", {
            "path": str(transfer_path), "bytes": transfer_path.stat().st_size,
            "sha256": file_digest(transfer_path), "recovered_archive": True}, immutable=True)
    retained_transfer = read_json(output / "workspace-transfer.json")
    if (retained_transfer["sha256"] != file_digest(transfer_path)
            or retained_transfer["bytes"] != transfer_path.stat().st_size):
        raise ValueError("Retained Workspace archive changed after its original capture")
    reopen_root = output / "reopened"
    if not reopen_root.exists():
        restored = portable.restore(transfer_path, reopen_root)
        atomic_json(output / "restore.json", restored, immutable=True)
    reopened = Workspace(reopen_root / "workspace")
    if reopened.project != ws.project:
        raise ValueError("Reopened project identity differs")
    selected = _same_selection(reopened, captured)
    if selected["latest_response_id"] != current_head:
        raise ValueError("Reopened customer-review response generation differs")
    validation = reviews.validate_workspace(reopened, verify_files=True)
    setup_validation = setup_review.verify_all(reopened)
    reopened_review = reviews.show_review(reopened, review_id, previews=False)
    atomic_json(output / "reopened-review.json", reopened_review)
    report = {
        "schema": "upstate.scientific-setup-receiving/v1",
        "started_at": invocation["started_at"], "completed_at": now(),
        "accepting_host": invocation["accepting_host"], "interpreter": invocation["interpreter"],
        "python": invocation["python"], "application": invocation["application"],
        "source_workspace": str(ws.root), "reopened_workspace": str(reopened.root),
        "original_selection_sha256": identity["selection_sha256"],
        "selected": selected, "checks": captured["checks"],
        "review_validation": validation, "setup_validation": setup_validation,
        "review_packet": str(review_directory),
        "workspace_transfer": {"path": str(transfer_path), "bytes": transfer_path.stat().st_size,
                               "sha256": file_digest(transfer_path)},
        "result": "Original setup, source inventory, native selections and review reopened",
    }
    atomic_json(output / "receiving-result.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--selection", help="Actual upstate.scientific-setup-selection/v1 JSON")
    parser.add_argument("--output-dir", help="Owned output directory outside Workspace/application")
    parser.add_argument("--operation-id", help="Optional retained 64-hex operation identity")
    parser.add_argument("--catalog", action="store_true", help="List existing source, grid, profile and scenario choices")
    args = parser.parse_args()
    try:
        return run(args)
    except Exception as error:
        if args.output_dir:
            output = Path(args.output_dir).resolve()
            retained_invocation = output / "invocation.json"
            owned = read_json(retained_invocation) if retained_invocation.is_file() else {}
            if (owned.get("schema") == "upstate.scientific-setup-receiving-invocation/v1"
                    and owned.get("identity", {}).get("workspace") == str(Path(args.workspace).resolve())):
                atomic_json(output / "receiving-error.json", {
                    "at": now(), "error_type": type(error).__name__, "message": str(error),
                    "accepting_host": socket.gethostname(), "interpreter": sys.executable})
        raise


if __name__ == "__main__":
    raise SystemExit(main())

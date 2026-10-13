"""Receive an actual profile review, export it, and reopen its original project.

Run from the maintained application root with -B -m
source_tools.receive_profile_customer_review. The capture selection refers to an
existing profile. Response files are original authored responses.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import socket
import sys

from model.common import atomic_bytes, atomic_json, digest, file_digest, held, now, read_json
from model.workspace import Workspace
from model import portable, profile_customer_review as bridge, reviews


def _original(path):
    body = Path(path).read_bytes()
    return body, json.loads(body), hashlib.sha256(body).hexdigest()


def receive(args):
    ws = Workspace(Path(args.workspace).resolve())
    if args.catalog:
        return bridge.catalog(ws, args.profile_id)
    if not args.selection or not args.output_directory:
        raise ValueError("Choose an actual capture selection and output directory, or use --catalog")
    if args.response_file and args.response_id:
        raise ValueError("Choose one original response file or one imported response ID")
    if args.apply_response and not (args.response_file or args.response_id):
        raise ValueError("Applying a response requires its actual file or imported ID")
    original, selection, checksum = _original(args.selection)
    output = Path(args.output_directory).resolve()
    app = Path(__file__).resolve().parents[1]
    for protected in (ws.root.resolve(), app):
        if output == protected or output in protected.parents or protected in output.parents:
            raise ValueError("Receiving output must be separate from the original Workspace and application")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".receiving.lock"):
        admission_path = output / "admission.json"
        if admission_path.exists():
            admission = read_json(admission_path)
            if admission["project_id"] != ws.project["id"] or admission["selection_sha256"] != checksum:
                raise ValueError("This receiving directory belongs to another original profile selection")
        else:
            admission = {"schema": "upstate.profile-customer-review-receiving-admission/v1",
                         "project_id": ws.project["id"], "selection_sha256": checksum,
                         "started_at": now(), "accepting_host": socket.gethostname(),
                         "interpreter": sys.executable, "python": platform.python_version(),
                         "application": str(app), "workspace": str(ws.root.resolve()),
                         "operation_id": digest({"project_id": ws.project["id"], "selection_sha256": checksum})}
            atomic_json(admission_path, admission, immutable=True)
        atomic_bytes(output / "original-selection.json", original, immutable=True)
        captured = bridge.create(ws, selection, operation_id=admission["operation_id"],
                                 created_at=admission["started_at"])
        response_id = args.response_id
        if args.response_file:
            body, response, response_sha = _original(args.response_file)
            atomic_bytes(output / "original-responses" / (response_sha + ".json"), body, immutable=True)
            if response.get("review_id") != captured["customer_review_id"]:
                raise ValueError("The actual response belongs to another original customer review")
            response_id = reviews.import_response(ws, response)["id"]
            captured = bridge.inspect(ws, captured["capture_id"])
        decision, applied = None, None
        if response_id:
            selected = {"capture_id": captured["capture_id"], "response_id": response_id,
                        "reviewer_role": args.reviewer_role or ""}
            decision = bridge.preview(ws, selected)
            if args.apply_response:
                request_path = output / "application-requests" / (response_id + ".json")
                if request_path.exists():
                    apply_selection = read_json(request_path)
                    if any(apply_selection.get(key) != value for key, value in selected.items()):
                        raise ValueError("The retained explicit application request uses another response or reviewer role")
                else:
                    apply_selection = {**selected,
                        "expected_profile_review_id": decision["current_profile_review_id"]}
                    atomic_json(request_path, apply_selection, immutable=True)
                applied = bridge.apply(ws, apply_selection,
                    operation_id=admission["operation_id"] + ":" + response_id)
                captured = bridge.inspect(ws, captured["capture_id"])
        head = captured["latest_response_id"]
        generation = digest({"capture_id": captured["capture_id"], "response_id": head,
                             "applications": [row["id"] for row in captured["applications"]],
                             "profile_review_id": captured["profile_review_state"]["review_id"]})
        directory = output / "generations" / generation
        directory.mkdir(parents=True, exist_ok=True)
        packet = directory / "customer-review"
        if packet.exists():
            exported = reviews.describe_export(packet)
            if exported["review_id"] != captured["customer_review_id"] or exported.get("latest_response_id") != head:
                raise ValueError("Existing export has a different original response generation")
        else:
            exported = reviews.export_review(ws, captured["customer_review_id"], packet,
                                             expected_response_id=head)
        atomic_json(directory / "capture.json", captured, immutable=True)
        atomic_json(directory / "export.json", exported, immutable=True)
        if decision is not None:
            atomic_json(directory / "selected-response-preview.json", decision)
        if applied is not None:
            atomic_json(directory / "application.json", applied, immutable=True)
        archive = directory / "workspace-transfer.zip"
        transfer_path = directory / "workspace-transfer.json"
        if not archive.exists():
            transferred = portable.backup(ws, archive, include_intermediates=True, include_deliveries=True)
            atomic_json(transfer_path, transferred, immutable=True)
        elif not transfer_path.exists():
            original_archive = portable.inspect_archive(archive, verify=True)
            if original_archive["project"] != ws.project:
                raise ValueError("Existing transfer belongs to another original project")
            atomic_json(transfer_path, {"path": str(archive), "bytes": archive.stat().st_size,
                                      "sha256": file_digest(archive), "recovered_archive": True}, immutable=True)
        transferred = read_json(transfer_path)
        if transferred["sha256"] != file_digest(archive) or transferred["bytes"] != archive.stat().st_size:
            raise ValueError("Retained original project archive changed")
        receiving_root = directory / "reopened"
        if not receiving_root.exists():
            restored = portable.restore(archive, receiving_root)
            atomic_json(directory / "restore.json", restored, immutable=True)
        reopened = Workspace(receiving_root / "workspace")
        actual = bridge.inspect(reopened, captured["capture_id"])
        fields = ("capture", "profile", "table", "specification", "latest_response_id",
                  "applications", "profile_review_state")
        if reopened.project != ws.project or any(actual[key] != captured[key] for key in fields):
            raise ValueError("Reopened original profile, sources, customer response or applied history differ")
        validation = bridge.verify_all(reopened)
        review_validation = reviews.validate_workspace(reopened, verify_files=True)
        report = {"schema": "upstate.profile-customer-review-receiving/v1",
                  "admission": admission, "completed_at": now(), "generation": generation,
                  "capture_id": captured["capture_id"], "profile_id": captured["profile_id"],
                  "customer_review_id": captured["customer_review_id"], "latest_response_id": head,
                  "profile_review_state": actual["profile_review_state"],
                  "application_id": applied["application_id"] if applied else None,
                  "table_sha256": captured["table"]["sha256"], "review_export": exported,
                  "transfer": transferred, "reopened_workspace": str(reopened.root),
                  "validation": validation, "review_validation": review_validation}
        atomic_json(directory / "receiving.json", report)
        atomic_json(output / "receiving.json", report)
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--catalog", action="store_true")
    parser.add_argument("--profile-id")
    parser.add_argument("--selection")
    parser.add_argument("--output-directory")
    parser.add_argument("--response-file")
    parser.add_argument("--response-id")
    parser.add_argument("--reviewer-role")
    parser.add_argument("--apply-response", action="store_true")
    args = parser.parse_args()
    if args.catalog and any((args.selection, args.response_file, args.response_id, args.apply_response)):
        parser.error("Use --catalog separately from a receiving invocation")
    print(json.dumps(receive(args), indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()

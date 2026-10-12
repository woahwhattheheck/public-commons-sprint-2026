#!/usr/bin/env python3
"""Run one complete property workflow against retained original survey inputs."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
from application import call
from delivery import archive_package, extract_package, import_package, receive_package, verify_package
from model import dump, encoded, parse, private_directory, read
from workspace import Workspace, file_identity


def run(args):
    out = private_directory(Path(args.out).expanduser())
    packet = parse(read(Path(args.intake).expanduser().resolve(), 64 * 1024 * 1024))
    originals = parse(read(Path(args.documents).expanduser().resolve(), 1024 * 1024))
    plan = parse(read(Path(args.selections).expanduser().resolve(), 16 * 1024 * 1024))
    operator = plan["operator"]
    result = {"schema": "stellar-forge.property-source-journey.v1",
              "started": datetime.now(timezone.utc).isoformat(), "phases": [],
              "input": {"bytes": Path(args.intake).stat().st_size,
                        "sha256": hashlib.sha256(Path(args.intake).read_bytes()).hexdigest()}}
    def record(phase, **values):
        result["phases"].append({"phase": phase, **values})
        dump(out / "native-result.json", result)
        print(json.dumps({"phase": phase, **values}, ensure_ascii=False), flush=True)
    workspace = Workspace(out / "workspace")
    selections, exports = [], []
    try:
        binding = {}
        for metadata in packet["documents"]:
            if metadata["key"] in originals:
                document = call(workspace, "property.document.import",
                                {"path": originals[metadata["key"]], "metadata": metadata})
                binding[metadata["key"]] = document["id"]
                record("original-document", key=metadata["key"], document_id=document["id"], files=document["files"])
        edition = call(workspace, "property.intake",
                       {"path": str(Path(args.intake).resolve()), "document_ids": binding,
                        "operator": operator, "label": plan["label"]})
        if plan.get("expected_counts"):
            for key, value in plan["expected_counts"].items():
                if edition["counts"].get(key) != value:
                    raise ValueError("Original survey count differs: " + key)
        record("frozen-source-edition", edition_id=edition["id"], counts=edition["counts"], issues=edition["issues"])
        workspace.close()
        workspace = Workspace(out / "workspace")
        reopened = call(workspace, "property.edition.packet", {"edition_id": edition["id"]})
        if reopened != packet:
            raise ValueError("Reopened intake differs")
        record("original-workspace-reopened", edition_id=edition["id"])
        review = call(workspace, "property.comparison.create",
                      {"candidate_id": edition["id"], "operator": operator,
                       "label": plan["label"] + " source review"})
        review = call(workspace, "property.comparison.read", {"review_id": review["id"], "limit": 10000})
        pending = [row["key"] for row in review["rows"] if row["key"] not in review["decisions"]]
        if pending:
            review = call(workspace, "property.review.apply",
                          {"review_id": review["id"], "expected_version": review["version"],
                           "keys": pending, "action": "accept", "operator": operator, "note": plan["review_note"]})
        record("reviewed-source", review_id=review["id"], version=review["version"], pending=review["pending"])
        for index, purpose in enumerate(plan["purposes"]):
            selection = call(workspace, "property.selection.freeze",
                             {"review_id": review["id"], "expected_version": review["version"],
                              "operator": operator, "purpose": purpose["purpose"], "label": purpose["label"],
                              "items": purpose["items"], "note": purpose.get("note", "")})
            report = call(workspace, "property.selection.report", {"selection_id": selection["id"]})
            for key, value in purpose.get("expected_summary", {}).items():
                if report["summary"].get(key) != value:
                    raise ValueError("Published comparison differs: " + key)
            package = call(workspace, "property.selection.export",
                           {"selection_id": selection["id"], "operator": operator, "label": purpose["label"]})
            manifest = verify_package(package["directory"])
            archive = call(workspace, "export.archive", {"export_id": package["id"]})
            selections.append(selection)
            exports.append(package)
            record("purpose-delivered", purpose=purpose["purpose"], selection_id=selection["id"],
                   package_id=package["id"], summary=report["summary"], archive=archive,
                   retained_files=len(manifest["files"]))
        if args.updated_intake:
            revised_packet = parse(read(Path(args.updated_intake).expanduser().resolve(), 64 * 1024 * 1024))
            revised = call(workspace, "property.edition.revise",
                           {"edition_id": edition["id"], "packet": revised_packet, "operator": operator,
                            "label": plan["revision_label"], "note": plan["revision_note"]})
            changed = call(workspace, "property.comparison.create",
                           {"candidate_id": revised["id"], "baseline_id": edition["id"], "operator": operator,
                            "label": plan["revision_label"], "note": plan["revision_note"], "unchanged": "accept"})
            changed = call(workspace, "property.comparison.read", {"review_id": changed["id"], "limit": 10000})
            pending = [row["key"] for row in changed["rows"] if row["key"] not in changed["decisions"]]
            changed_keys = [row["key"] for row in changed["rows"] if row["kind"] != "unchanged"]
            if "expected_changed_keys" in plan and sorted(changed_keys) != sorted(plan["expected_changed_keys"]):
                raise ValueError("Source correction differs from its original locator")
            if pending:
                changed = call(workspace, "property.review.apply",
                               {"review_id": changed["id"], "expected_version": changed["version"],
                                "keys": pending, "action": "accept", "operator": operator, "note": plan["revision_note"]})
            original_choice = plan["purposes"][0]
            revised_selection = call(workspace, "property.selection.freeze",
                                     {"review_id": changed["id"], "expected_version": changed["version"],
                                      "operator": operator, "purpose": original_choice["purpose"],
                                      "label": plan["revision_label"], "items": original_choice["items"],
                                      "note": plan["revision_note"]})
            revised_package = call(workspace, "property.selection.export",
                                   {"selection_id": revised_selection["id"], "operator": operator, "label": plan["revision_label"]})
            verify_package(revised_package["directory"])
            revision_archive = call(workspace, "export.archive", {"export_id": revised_package["id"]})
            record("source-correction-delivered", edition_id=revised["id"], changed_keys=changed_keys,
                   selection_id=revised_selection["id"], package_id=revised_package["id"],
                   archive=revision_archive, ancestry=revised_package["property_bundle"]["edition_ids"])
        # A real subsequent review remains separate from the already delivered selection.
        changed_review = call(workspace, "property.review.apply",
                              {"review_id": review["id"], "expected_version": review["version"],
                               "keys": [edition["properties"][0]["key"]], "action": "accept",
                               "operator": operator, "note": plan["later_review_note"]})
        for selected, package in zip(selections, exports):
            before = call(workspace, "property.selection.report", {"selection_id": selected["id"]})
            received = import_package(workspace, package["directory"])
            if call(workspace, "property.selection.report", {"selection_id": selected["id"]}) != before:
                raise ValueError("Earlier frozen report changed during receiving")
            if call(workspace, "property.comparison.read", {"review_id": review["id"]})["version"] != changed_review["version"]:
                raise ValueError("Later local review was replaced")
            record("earlier-selection-received", selection_id=selected["id"],
                   frozen_review_version=selected["review_version"],
                   current_review_version=changed_review["version"], preserved=received["preserved_local_reviews"])
        archive = call(workspace, "export.archive", {"export_id": exports[0]["id"]})
        extracted = out / "received-package"
        extract_package(archive["path"], extracted)
        received = receive_package(extracted, out / "received-workspace")
        repeat = receive_package(extracted, out / "received-workspace")
        if repeat["package_id"] != received["package_id"]:
            raise ValueError("Receiving changed the package")
        other = Workspace(out / "received-workspace")
        try:
            actual = call(other, "property.selection.report", {"selection_id": selections[0]["id"]})
            expected = call(workspace, "property.selection.report", {"selection_id": selections[0]["id"]})
            if actual != expected:
                raise ValueError("Fresh receiving report differs")
            for document_id in binding.values():
                call(other, "property.document.read", {"document_id": document_id})
        finally:
            other.close()
        record("full-archive-extracted-received-reopened", package_id=received["package_id"],
               workspace=received["workspace"], retained_directory=received["directory"])
        arguments = out / "selection-arguments.json"
        dump(arguments, {"selection_id": selections[0]["id"]})
        child = subprocess.run([sys.executable, "-B", str(APP / "cli.py"), "--workspace",
                                str(out / "received-workspace"), "call", "property.selection.report",
                                "--arguments", str(arguments)], capture_output=True, text=True)
        if child.returncode:
            raise RuntimeError(child.stderr)
        if json.loads(child.stdout)["summary"] != expected["summary"]:
            raise ValueError("Original CLI receiving differs")
        record("original-cli-reopened", selection_id=selections[0]["id"], summary=expected["summary"])
        result["completed"] = datetime.now(timezone.utc).isoformat()
        result["state"] = "COMPLETE"
        result["workspace"] = str(out / "workspace")
        result["selections"] = [x["id"] for x in selections]
        dump(out / "native-result.json", result)
        return result
    finally:
        workspace.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--intake", required=True)
    parser.add_argument("--documents", required=True, help="JSON mapping source keys to retained original file paths")
    parser.add_argument("--selections", required=True, help="Source-reviewed purpose decisions and original count expectations")
    parser.add_argument("--updated-intake")
    parser.add_argument("--out", required=True)
    try:
        run(parser.parse_args())
    except Exception as error:
        print(json.dumps({"state": "FAILED", "code": getattr(error, "code", type(error).__name__),
                          "details": getattr(error, "details", {}), "message": str(error)}), file=sys.stderr)
        raise

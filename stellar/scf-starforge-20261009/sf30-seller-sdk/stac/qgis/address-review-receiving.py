#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Receive one complete original address cohort through the maintained evidence API.

This foreground course uses original QgisWorkspace operations. It does not run
QGIS, mutate issuer data, contact a provider or claim browser inspection.
"""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import uuid

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--application", required=True)
    parser.add_argument("--inputs", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--complete-export", action="store_true")
    args = parser.parse_args()
    app = Path(args.application).resolve(strict=True)
    sys.path.insert(0, str(app))
    from starforge_stac.model import QgisWorkspace, require, json_bytes, sha_bytes, retain_bytes, retain_copy, file_digest, member, receive_package, opened_package_archive, read_package_manifest
    from starforge_stac import parcel_evidence as evidence
    from starforge_stac import address_review
    from starforge_stac.parcel_evidence_operator import execute

    root = Path(args.directory).absolute()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(not root.is_symlink(), "ADDRESS_COURSE_DIRECTORY", "Use an ordinary private directory.")
    lock = (root / "course.lock").open("a+b")
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    input_path = Path(args.inputs).resolve(strict=True)
    raw = input_path.read_bytes()
    inputs = json.loads(raw)
    require(inputs.get("schema") == "starforge.address-review-inputs.v1", "ADDRESS_COURSE_INPUT", "Use the complete original cohort input manifest.")
    operation = str(uuid.UUID(inputs["operationId"]))
    reviewer = args.reviewer.strip()
    require(bool(reviewer), "ADDRESS_COURSE_REVIEWER", "Name the actual operator performing this review.")
    source_names = ["starforge_stac/model.py", "starforge_stac/parcel_evidence.py", "starforge_stac/parcel_evidence_reports.py",
                    "starforge_stac/parcel_evidence_operator.py", "starforge_stac/address_review.py", "starforge_stac/analyst_state.py",
                    "starforge_stac/parcels/state.py"]
    source_binding = {name: file_digest(app / name) for name in source_names}
    selected = {"schema": "starforge.address-review-course.v1", "operationId": operation,
                "inputSha256": sha_bytes(raw), "reviewer": reviewer,
                "application": str(app), "completeExport": args.complete_export,
                "sourceBinding": source_binding, "controllerSha256": sha_bytes(Path(__file__).read_bytes())}
    retain_bytes(root, "selection.json", json_bytes(selected))
    retain_bytes(root, "original-inputs.json", raw)
    def save(name, value):
        retain_bytes(root, name, json_bytes(value))
        return value
    def step_id(name):
        return "address-" + uuid.uuid5(uuid.UUID(operation), name).hex
    workspace_path = root / "workspace"
    intent = root / "workspace-intent.json"
    if not intent.exists():
        require(not (workspace_path / "workspace.sqlite").exists(), "ADDRESS_COURSE_WORKSPACE", "Do not adopt an unrelated existing workspace.")
        save("workspace-intent.json", {"selection": selected, "directory": str(workspace_path)})
    workspace = QgisWorkspace(workspace_path, create=True, title=inputs["title"])
    binding = root / "workspace-binding.json"
    if not binding.exists():
        require(workspace.read()["revision"] == 0 and not workspace.snapshot()["requests"], "ADDRESS_COURSE_WORKSPACE", "An unbound workspace has already changed.")
        save("workspace-binding.json", {"workspaceId": workspace.read()["id"], "selection": selected})
    require(json.loads(binding.read_text())["workspaceId"] == workspace.read()["id"], "ADDRESS_COURSE_WORKSPACE", "Continue the same original workspace.")
    def call(name, action, payload):
        path = "requests/" + name + ".json"
        if (root / path).exists():
            request = json.loads((root / path).read_text())
            require(request["action"] == action and request["payload"] == payload, "ADDRESS_COURSE_REPLAY", "The original request content changed.")
        else:
            request = save(path, {"action": action, "payload": payload, "common": {
                "revision": workspace.read()["revision"], "request_id": step_id(name), "actor": reviewer}})
        result = execute(workspace, action, request["payload"], request["common"])
        return save("results/" + name + ".json", result)

    source_ids = {}
    for item in inputs["sources"]:
        path = (input_path.parent / item["path"]).resolve(strict=True)
        file_digest(path, expected={"bytes": item["bytes"], "sha256": item["sha256"]})
        result = call("source-" + item["key"], "source.save",
                      {"file": str(path), "bytes": item["bytes"], "sha256": item["sha256"], "definition": item["definition"]})
        source_ids[item["key"]] = result["sourceId"]
    profile = json.loads(json.dumps(address_review.PROFILE))
    payload = {"title": inputs["title"], "jurisdiction": inputs["jurisdiction"], "asOf": inputs["asOf"],
               "scope": inputs["scope"], "sourceIds": [source_ids[key] for key in inputs["featureKeys"]],
               "metadataSourceId": source_ids[inputs["metadataKey"]],
               "inventory": {key: source_ids[value] for key, value in inputs["inventoryKeys"].items()},
               "mapping": profile["mapping"], "required": profile["required"], "rules": profile["rules"]}
    result = call("initial-analysis", "address.analyze", payload)
    original_analysis = address_review.read_analysis(workspace, result["analysisSourceId"])
    expected = inputs.get("expected", {})
    require(not expected or all(original_analysis["summary"].get(k) == v for k, v in expected.get("summary", {}).items()),
            "ADDRESS_COURSE_EXPECTATION", "The actual selected cohort differs from its recorded source observation.")
    require(original_analysis["inventory"]["objectIdSetsMatch"] is True, "ADDRESS_COURSE_INVENTORY", "The complete original cohort inventory does not reconcile.")
    candidate = next((c for c in original_analysis["candidates"] if c["rule"] == "ADDRESS_SIGNATURE"), None)
    require(candidate is not None, "ADDRESS_COURSE_CANDIDATE", "Select a source-backed candidate for this named-review course.")
    rows = {r["id"]: r for r in original_analysis["rows"]}
    candidate_oids = sorted(rows[r]["objectId"] for r in candidate["rowIds"])
    require(not expected.get("signatureObjectIds") or candidate_oids == expected["signatureObjectIds"],
            "ADDRESS_COURSE_CANDIDATE", "The original candidate membership differs.")
    definition = {"title": "Matching address signature — source-owner interpretation remains open",
                  "classification": "PROFESSIONAL_QUESTION", "status": "OPEN",
                  "statement": "The recorded normalization groups original object IDs " + ", ".join(map(str, candidate_oids)) +
                               ". This is a candidate, not a duplicate verdict.",
                  "applicability": inputs["scope"], "assumptions": address_review.LIMITATION,
                  "subjectIds": ["address-cohort"],
                  "sourceReferences": [{"sourceId": result["analysisSourceId"], "locator": "candidates[id=" + candidate["id"] + "]"}],
                  "reviewer": reviewer, "reviewedAt": inputs["reviewedAt"],
                  "nextAction": "Ask the responsible address data steward to verify separate legitimate address records, original unit designations and source lineage.",
                  "responsibleRole": "Address data steward"}
    finding = call("named-question", "finding.save", {"caseId": result["caseId"], "caseVersionId": result["caseVersionId"],
                                                     "definition": definition})
    report = call("frozen-report", "report.build", {"caseId": result["caseId"], "caseVersionId": result["caseVersionId"],
                         "title": inputs["title"] + " — original recorded review",
                         "interpretation": "This frozen report retains all original sources, the exact screening policy, complete record and candidate matrices, and the named open question. No address correction, duplicate determination or emergency-service certification has been made.",
                         "mapRequestIds": []})
    # Explicit same-input later analysis is a new case/source edition, never a rewrite.
    later = call("later-analysis", "address.analyze", {**payload, "caseId": result["caseId"], "caseVersionId": result["caseVersionId"]})
    snapshot = evidence.case_snapshot(workspace.read(), result["caseId"])
    require(any(r["findingVersionId"] == finding["findingVersionId"] and r["state"] == "REVIEW_REQUIRED"
                for r in snapshot["findingReview"]), "ADDRESS_COURSE_REVIEW", "A later case edition must not silently upgrade an earlier named review.")
    replay = call("initial-analysis", "address.analyze", payload)
    require(replay == result, "ADDRESS_COURSE_REPLAY", "The original request must return its exact original result after later work.")
    archive = report["report"]["archive"] if "report" in report else evidence.get(workspace.read(), "reports", report["reportId"])["archive"]
    file_digest(member(workspace.root, archive["path"]), expected=archive)
    save("final-snapshot.json", workspace.snapshot())

    # Consistent original SQLite backup plus every retained source/report file.
    restored_path = root / "restored"
    if not (root / "restore-complete.json").exists():
        restore_intent = {"workspaceId": workspace.read()["id"], "directory": str(restored_path),
                          "snapshotSha256": sha_bytes(json_bytes(workspace.snapshot())), "selection": selected}
        if not (root / "restore-intent.json").exists():
            require(not restored_path.exists(), "ADDRESS_COURSE_RESTORE", "Do not adopt an unrelated receiving directory.")
        save("restore-intent.json", restore_intent)
        restored_path.mkdir(mode=0o700, exist_ok=True)
        for item in evidence.evidence_file_refs({"state": workspace.read()}):
            retain_copy(member(workspace.root, item["path"]), restored_path, item["path"], item)
        if not (restored_path / "workspace.sqlite").exists():
            temporary_db = root / "restore-database.partial.sqlite"
            require(not temporary_db.is_symlink(), "ADDRESS_COURSE_RESTORE", "Keep the original private backup path.")
            temporary_db.unlink(missing_ok=True)
            with sqlite3.connect(workspace.db_path) as original, sqlite3.connect(temporary_db) as dest:
                original.backup(dest)
            with temporary_db.open("rb") as stream:
                os.fsync(stream.fileno())
            os.link(temporary_db, restored_path / "workspace.sqlite")
            temporary_db.unlink()
        restored = QgisWorkspace(restored_path)
        require(restored.snapshot() == workspace.snapshot(), "ADDRESS_COURSE_RESTORE", "The complete original snapshot changed on cold reopen.")
        saved_request = json.loads((root / "requests/initial-analysis.json").read_text())
        require(execute(restored, "address.analyze", saved_request["payload"], saved_request["common"]) == result,
                "ADDRESS_COURSE_REPLAY", "Cold-received original request replay changed.")
        save("restore-complete.json", {"workspaceId": restored.read()["id"], "revision": restored.read()["revision"],
                                       "snapshotSha256": sha_bytes(json_bytes(restored.snapshot()))})
    restored = QgisWorkspace(restored_path)
    require(restored.snapshot() == workspace.snapshot(), "ADDRESS_COURSE_RESTORE", "Preserve the unchanged course snapshot for its original continuation.")
    package = None
    if args.complete_export:
        # Requires the complete maintained application, including all original source inventories.
        archive_path = root / "complete-project.zip"
        if not archive_path.exists():
            workspace.export_package(archive_path, expected_revision=workspace.read()["revision"])
        with opened_package_archive(archive_path) as (zip_file, measured, unchanged):
            manifest, manifest_raw, records = read_package_manifest(zip_file)
            require(manifest["workspaceId"] == workspace.read()["id"] and manifest["revision"] == workspace.read()["revision"]
                    and json.loads(zip_file.read("workspace-snapshot.json")) == workspace.snapshot(),
                    "ADDRESS_COURSE_EXPORT", "Keep the original complete project snapshot.")
            for name, descriptor in records.items():
                digest, count = hashlib.sha256(), 0
                with zip_file.open(name) as stream:
                    while True:
                        block = stream.read(1024 * 1024)
                        if not block:
                            break
                        count += len(block)
                        digest.update(block)
                require(count == descriptor["bytes"] and digest.hexdigest() == descriptor["sha256"],
                        "ADDRESS_COURSE_EXPORT", "An original exported project member changed.", path=name)
            unchanged()
            package = {"path": str(archive_path), **measured, "manifestSha256": sha_bytes(manifest_raw),
                       "workspaceId": manifest["workspaceId"], "revision": manifest["revision"],
                       "fileCount": len(records)+1, "totalDecodedBytes": manifest["totalBytes"]}
        save("complete-project-export.json", package)
        received = receive_package(archive_path, root / "received-project", expected_sha256=package["sha256"])
        require(received["workspace"].snapshot() == workspace.snapshot(), "ADDRESS_COURSE_EXPORT", "The original complete project changed on receipt.")
        save("complete-project-receipt.json", received["receipt"])
    outcome = {"schema": "starforge.address-review-course-result.v1", "operationId": operation,
               "workspaceId": workspace.read()["id"], "revision": workspace.read()["revision"],
               "workspace": str(workspace_path), "restored": str(restored_path),
               "caseId": result["caseId"], "analysisSourceId": result["analysisSourceId"],
               "laterAnalysisSourceId": later["analysisSourceId"], "summary": original_analysis["summary"],
               "inventory": original_analysis["inventory"], "signatureObjectIds": candidate_oids,
               "findingId": finding["findingId"], "report": report, "package": package,
               "browserStatus": "NOT_RUN", "literalInspection": "REQUIRED_BEFORE_DELIVERY"}
    save("COMPLETE.json", outcome)
    print(json.dumps(outcome, ensure_ascii=False, sort_keys=True))
    lock.close()

if __name__ == "__main__":
    main()

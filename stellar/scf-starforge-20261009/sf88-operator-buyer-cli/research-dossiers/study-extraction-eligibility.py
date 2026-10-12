#!/usr/bin/env python3
"""Complete customer archive and receiving through the original EligibilityDelivery."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from stellar_forge_buyer.research_workspace import ResearchWorkspace
from stellar_forge_buyer.research_eligibility_delivery import EligibilityDelivery
from stellar_forge_buyer.storage import parse, read, write, private_directory
from stellar_forge_buyer.errors import StateError

SCHEMA = "sf88-study-extraction-eligibility-receiving/v1"
LIMIT = 512 * 1024 * 1024


def require(value, code):
    if not value:
        raise StateError(code)


def pin(file, root):
    file, root = Path(file).absolute(), Path(root).absolute()
    require(file.is_relative_to(root) and file != root, "STUDY_ELIGIBILITY_ARTIFACT_SCOPE")
    with os.fdopen(os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= LIMIT,
                "STUDY_ELIGIBILITY_ARTIFACT_TYPE")
        count, checksum = 0, hashlib.sha256()
        while block := stream.read(1024 * 1024):
            count += len(block)
            require(count <= LIMIT, "STUDY_ELIGIBILITY_ARTIFACT_SIZE")
            checksum.update(block)
        after = os.fstat(stream.fileno())
        require(count == before.st_size and all(getattr(before, key) == getattr(after, key)
                for key in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")),
                "STUDY_ELIGIBILITY_ARTIFACT_CHANGED")
    return {"file": str(file), "relative": file.relative_to(root).as_posix(),
            "bytes": count, "sha256": checksum.hexdigest()}


def run(value):
    require(isinstance(value, dict), "STUDY_ELIGIBILITY_INPUT_REQUIRED")
    for key in ("checkout", "connectionFile", "runDirectory", "reviewRequestFile"):
        require(isinstance(value.get(key), str) and Path(value[key]).is_absolute() and
                os.path.normpath(value[key]) == value[key], "STUDY_ELIGIBILITY_ABSOLUTE_PATH")
    require(re.fullmatch(r"research_[a-f0-9]{64}", value.get("expectedWorkspaceId", "")) and
            isinstance(value.get("revision"), int) and value["revision"] > 0,
            "STUDY_ELIGIBILITY_SELECTION_REQUIRED")
    root = private_directory(Path(value["runDirectory"]))
    dossier_id, revision = value["dossierId"], value["revision"]
    request = parse(read(Path(value["reviewRequestFile"]), 16 * 1024 * 1024))
    require(isinstance(request, dict) and set(request) ==
            {"requestId", "expectedRevision", "actor", "action", "reviewId", "data"} and
            request["reviewId"] == value["reviewId"], "STUDY_ELIGIBILITY_ORIGINAL_REQUEST")
    with ResearchWorkspace(checkout=value["checkout"], node=value["node"],
            connection_file=value["connectionFile"], directory=root / "client",
            expected_workspace_id=value["expectedWorkspaceId"], timeout=900,
            request_timeout_ms=900000) as workspace:
        eligibility = workspace.eligibility(dossier_id)
        before = workspace.metadata(dossier_id)
        require(before["revision"] == revision, "STUDY_ELIGIBILITY_CURRENT_REVISION_CHANGED")
        replay = eligibility.submit(request, resume=True)
        require(replay.get("duplicate") is True and replay["operation"]["request"] == request and
                replay["operation"]["reviewId"] == value["reviewId"] and
                workspace.metadata(dossier_id)["revision"] == revision,
                "STUDY_ELIGIBILITY_REPLAY_CHANGED_HEAD")
        delivery = eligibility.delivery(root / "delivery", review_id=value["reviewId"],
                                        work_set_id=value["workSetId"], revision=revision)
        manifest = delivery.export(eligibility)
        require(len(manifest["files"]) == 12, "STUDY_ELIGIBILITY_COMPLETE_DELIVERY_REQUIRED")
        archive = delivery.archive(root / "original-eligibility-customer.zip")
        received = EligibilityDelivery.from_archive(archive["file"], root / "customer",
                                                    expected_sha256=archive["sha256"])
        require(received.verify() == manifest, "STUDY_ELIGIBILITY_ARCHIVE_DELIVERY_CHANGED")
        receiving = received.receive(root / "receiving", checkout=value["checkout"],
                                     node=value["node"], timeout=900)
        require(workspace.metadata(dossier_id)["revision"] == revision,
                "STUDY_ELIGIBILITY_SOURCE_CHANGED")
    files = [pin(delivery.selection_file, root), pin(delivery.directory / "delivery.json", root)]
    files.extend(pin(delivery.files / row["name"], root) for row in manifest["files"])
    files.append(pin(archive["file"], root))
    files.append(pin(received.directory / "receiving.json", root))
    return {"schema": SCHEMA, "state": "COMPLETE", "workspaceId": value["expectedWorkspaceId"],
            "dossierId": dossier_id, "reviewId": value["reviewId"], "workSetId": value["workSetId"],
            "revision": revision, "files": files, "archive": pin(archive["file"], root),
            "selectionFile": pin(delivery.selection_file, root),
            "jsonDirectory": receiving["json-reader"]["directory"],
            "streamDirectory": receiving["stream-reader"]["directory"],
            "receiving": receiving,
            "replay": {"requestId": request["requestId"], "operationId": replay["operation"]["id"],
                       "revision": replay["operation"]["revision"], "duplicate": True}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = run(parse(read(Path(args.input), 16 * 1024 * 1024)))
    output = Path(args.output)
    raw = (json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    if output.exists():
        require(parse(read(output, 16 * 1024 * 1024)) == result, "STUDY_ELIGIBILITY_RESULT_CHANGED")
    else:
        write(output, raw, exclusive=True)
    print(json.dumps({"state": result["state"], "dossierId": result["dossierId"],
                      "revision": result["revision"], "file": str(output)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": getattr(error, "code", "STUDY_ELIGIBILITY_RECEIVING_FAILED"),
                          "type": type(error).__name__}), file=sys.stderr)
        sys.exit(1)

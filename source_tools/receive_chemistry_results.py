#!/usr/bin/env python3
"""Receive the complete original REACT12 operated reports into a scientific Workspace."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import sys
import zipfile

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))

from model.common import atomic_bytes, atomic_json, digest, file_digest, held, read_json
from model.workspace import Workspace

ARCHIVE_SHA256 = "950a6eb4b9780c3ba0ea6e7522b06c65c7945442bef5a0d2835eccd50c4b75c3"
ARCHIVE_BYTES = 1055186
SOURCE_SHA256 = "d70c9429d5c0eac055af890ee4136f6a7217792cf1f39a5fac443efbb6828e10"
ARCHIVE_URL = "https://drive.google.com/file/d/1KTjnVjuG4xqe89MJvWfY_8YY83vJKwuJ/view"
SCHEMA = "upstate.chemistry-operated-source/v1"
REPORTS = {
    "simulation": ("20-day four-reach transport and reaction", "simulation-request.json"),
    "calibration": ("36-observation known-parameter recovery", "calibration-request.json"),
    "ensemble": ("512-draw uncertainty ensemble", "uncertainty-request.json"),
    "monitoring": ("Eight-observation information-based design", "monitoring-request.json"),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def original_archive(path):
    """Read the selected original archive and every member before importing source."""
    raw = Path(path).read_bytes()
    require(len(raw) == ARCHIVE_BYTES and hashlib.sha256(raw).hexdigest() == ARCHIVE_SHA256,
            "Select the complete original ASTRA_REACT12_Operated_Results_2026-10-12.zip")
    files = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for item in archive.infolist():
            name = item.filename
            member = PurePosixPath(name)
            require(not item.is_dir() and not item.flag_bits & 1
                    and (item.external_attr >> 16) & 0o170000 in (0, 0o100000)
                    and not member.is_absolute() and ".." not in member.parts
                    and str(member) == name and "\\" not in name and "\0" not in name
                    and name not in files, "Original archive has an invalid or repeated member")
            files[name] = archive.read(item)
    require(len(files) == 59, "Original operated archive must contain its complete 59 members")
    manifest = json.loads(files["MANIFEST.json"])
    require(manifest.get("schema") == "react12.operated-results/v1"
            and manifest.get("source_sha256") == SOURCE_SHA256,
            "Select the operated release tied to the original REACT12 source")
    rows = manifest["files"]
    require(isinstance(rows, list) and len(rows) == 58, "Original manifest inventory differs")
    names = [row["path"] for row in rows]
    require(len(set(names)) == len(names) and set(names) | {"MANIFEST.json"} == set(files),
            "Original operated member inventory differs")
    for row in rows:
        body = files[row["path"]]
        require(len(body) == row["bytes"] and hashlib.sha256(body).hexdigest() == row["sha256"],
                "Original operated member changed: " + row["path"])
    # The original result writer serialized JSON compactly. Compare the complete
    # parsed inputs with the unchanged authored example, preserving both byte forms.
    examples = APPLICATION / "integration" / "reach_chemistry" / "examples"
    original_project = read_json(examples / "network.json")
    require(original_project.get("provenance", {}).get("kind") == "constructed-reference",
            "Retain the original authored project provenance")
    for mode, (_, request_name) in REPORTS.items():
        require(json.loads(files["results/" + mode + "/project.json"]) == original_project,
                "Operated project differs from its retained original example: " + mode)
        require(json.loads(files["results/" + mode + "/request.json"]) == read_json(examples / request_name),
                "Operated request differs from its retained original example: " + mode)
    return raw, files, manifest


def receive(workspace_path, archive_path, output):
    raw, files, original_manifest = original_archive(archive_path)
    workspace = Workspace(Path(workspace_path).resolve(strict=True))
    output = Path(output).resolve()
    require(not output.is_relative_to(workspace.root),
            "Keep the original-source receiving directory outside the scientific Workspace")
    output.mkdir(parents=True, exist_ok=True)
    request = {"workspace": str(workspace.root), "workspace_id": workspace.project["id"],
               "archive_sha256": ARCHIVE_SHA256}
    receipt_path = output / "opening.json"
    with held(output / ".operated-results.lock", blocking=False):
        if receipt_path.exists():
            require(read_json(receipt_path).get("request") == request,
                    "This receiving directory belongs to a different original Workspace")
        atomic_bytes(output / "original" / "operated-results.zip", raw, immutable=True)
        descriptors = []
        for name, body in files.items():
            atomic_bytes(output / "original" / name, body, immutable=True)
            descriptors.append({"path": "original/" + name, "bytes": len(body),
                                "sha256": hashlib.sha256(body).hexdigest()})
        descriptors.append({"path": "original/operated-results.zip", "bytes": len(raw),
                            "sha256": ARCHIVE_SHA256})
        entries = []
        for mode, (description, _) in REPORTS.items():
            primary = "original/results/" + mode + "/report.html"
            body = next(row for row in descriptors if row["path"] == primary)
            entries.append({
                "id": "react12-original-" + mode + "-results",
                "title": "REACT12 authored reference: " + description,
                "kind": "document", "path": primary,
                "sha256": body["sha256"], "bytes": body["bytes"],
                "uri": ARCHIVE_URL,
                "vintage": "Original operated REACT12 0.1.0 release, 2026-10-13",
                "metadata": {
                    "scientific_purpose": "authored numerical-method reference",
                    "engine_version": "0.1.0",
                    "report_format": "html",
                    "original_archive_sha256": ARCHIVE_SHA256,
                    "original_source_sha256": SOURCE_SHA256,
                    "analysis": mode,
                    "project_provenance": json.loads(files["results/" + mode + "/project.json"])["provenance"],
                },
                "companions": [row for row in descriptors if row["path"] != primary],
            })
        source_manifest = {
            "schema": "upstate.sources/v1",
            "title": "Original operated REACT12 numerical-method references",
            "captured_at": "2026-10-13T00:32:58.530Z",
            "scope": {"purpose": "authored numerical-method reference",
                      "release": "ASTRA-REACT12 0.1.0",
                      "original_member_count": len(files),
                      "archive_sha256": ARCHIVE_SHA256,
                      "original_source_sha256": original_manifest["source_sha256"]},
            "entries": entries,
            "notes": [
                "Each original report retains the complete 59-member archive family and the original ZIP.",
                "Original source, wheel, reports, numerical tables, inputs and author-recorded results keep their exact bytes.",
                "The authored project and requests are compared with their original examples before import.",
                "The scientific application retains its Upper Savannah field studies as separate source editions.",
            ],
        }
        manifest_path = output / "sources.json"
        atomic_json(manifest_path, source_manifest, immutable=True)
        collection = workspace.import_sources(manifest_path)
        receiver = Workspace(workspace.root)
        opened = []
        for entry in entries:
            path, stored = receiver.source_file(collection["id"], entry["id"])
            require(file_digest(path) == entry["sha256"]
                    and len(stored["companions"]) == len(descriptors) - 1,
                    "Reopened original report or its companion inventory differs")
            opened.append({"source_id": entry["id"], "title": entry["title"],
                           "report_sha256": stored["body"]["sha256"],
                           "report_view_path": str(path),
                           "companion_count": len(stored["companions"])})
        receipt = {
            "schema": SCHEMA,
            "request": request,
            "source_manifest": str(manifest_path),
            "source_manifest_sha256": file_digest(manifest_path),
            "source_collection_id": collection["id"],
            "operator_workspace_key": digest({"directory": str(workspace.root)}),
            "original_archive_bytes": len(raw),
            "original_archive_sha256": ARCHIVE_SHA256,
            "original_members": len(files),
            "original_source_sha256": SOURCE_SHA256,
            "reports": opened,
        }
        atomic_json(receipt_path, receipt, immutable=True)
        return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--archive", required=True, type=Path,
                        help="Complete original operated-results ZIP from the retained source delivery")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(receive(args.workspace, args.archive, args.output), indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Retain the original REACT12 authored example and select its native browser journey."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model.common import atomic_bytes, atomic_json, digest, file_digest, held
from model.workspace import Workspace
from model.chemistry import Chemistry, ENGINE_VERSION

SOURCE_COMMIT = "cb893ce32804f344b502f2d5a64725e23a03e9f5"
SOURCE_MANIFEST_SHA256 = "0085740aa371b70f1ae5e9c9635aa6a2ea02701e1cad36009521d08b30f21e6d"
SOURCE_ID = "react12-authored-reference-project"
EXAMPLES = (
    "network.json", "simulation-request.json", "calibration-request.json",
    "monitoring-candidates.json", "monitoring-request.json", "parameters.json",
    "uncertainty-request.json",
)
REQUESTS = {
    "simulate": "simulation-request.json",
    "calibrate": "calibration-request.json",
    "monitoring": "monitoring-request.json",
    "uncertainty": "uncertainty-request.json",
}


def original_inputs():
    """Read and verify the unchanged authored input edition before any workspace write."""
    original = APPLICATION / "integration" / "reach_chemistry"
    manifest_bytes = (original / "SOURCE_MANIFEST.json").read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest() != SOURCE_MANIFEST_SHA256:
        raise ValueError("Select the retained REACT12 0.1.0 original source manifest")
    manifest = json.loads(manifest_bytes)
    if manifest.get("schema") != "react12.source/v1" or manifest.get("version") != "0.1.0":
        raise ValueError("The source manifest is not the original authored reference edition")
    rows = {row["path"]: row for row in manifest["files"]}
    files = {}
    for name in EXAMPLES:
        path = "examples/" + name
        expected = rows[path]
        body = (original / path).read_bytes()
        if len(body) != expected["bytes"] or hashlib.sha256(body).hexdigest() != expected["sha256"]:
            raise ValueError("Original authored input changed: " + path)
        json.loads(body)
        files[name] = body
    project = json.loads(files["network.json"])
    if project.get("provenance", {}).get("kind") != "constructed-reference":
        raise ValueError("Keep the original mathematical reference provenance")
    files["SOURCE_MANIFEST.json"] = manifest_bytes
    return files, project


def prepare(workspace, output, *, mode="calibrate"):
    if mode not in REQUESTS:
        raise ValueError("Choose one of the original retained analysis requests")
    files, project = original_inputs()
    ws = Workspace(Path(workspace).resolve(strict=True))
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    # This guards the complete source-copy/import/selection preparation for this
    # receiving output. Native Workspace remains the only source/case writer.
    with held(output / ".prepare-reference.lock", blocking=False):
        for name, body in files.items():
            atomic_bytes(output / "inputs" / name, body, immutable=True)
        companions = [
            {"path": "inputs/" + name, "sha256": hashlib.sha256(body).hexdigest()}
            for name, body in files.items() if name != "network.json"
        ]
        source_manifest = {
            "schema": "upstate.sources/v1",
            "title": "REACT12 authored four-reach chemical reference",
            "captured_at": "2026-10-12",
            "scope": {
                "purpose": "original authored mathematical recovery and receiving exercise",
                "source_component": "ASTRA-REACT12 0.1.0",
                "geography": "authored four-reach reference",
            },
            "notes": [
                "Original project, request, parameter and source-manifest bytes are unchanged.",
                "Every physical object and reference observation retains its original authored provenance.",
            ],
            "entries": [{
                "id": SOURCE_ID,
                "title": project["title"],
                "uri": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/"
                       + SOURCE_COMMIT
                       + "/opportunities/upstate_forever_2026/integration/reach_chemistry/examples/network.json",
                "vintage": "2026-10-12",
                "kind": "document",
                "path": "inputs/network.json",
                "sha256": hashlib.sha256(files["network.json"]).hexdigest(),
                "companions": companions,
            }],
        }
        manifest_path = output / "sources.json"
        atomic_json(manifest_path, source_manifest, immutable=True)
        collection = ws.import_sources(manifest_path)
        case = Chemistry(ws).from_source({
            "source_collection_id": collection["id"],
            "source_id": SOURCE_ID,
            "reason": "Original REACT12 authored four-reach recovery and portable receiving exercise.",
        })
        reopened = Chemistry(Workspace(ws.root)).get_case(case["id"])
        if reopened["project"] != project:
            raise ValueError("The retained original project changed while reopening")
        retained_path, retained_entry = ws.source_file(collection["id"], SOURCE_ID)
        if file_digest(retained_path) != source_manifest["entries"][0]["sha256"]:
            raise ValueError("Retained native project bytes differ from the original source")
        selected_name = REQUESTS[mode]
        request = json.loads(files[selected_name])
        if request.get("mode") != mode:
            raise ValueError("Original analysis request does not match its selected mode")
        request_path = output / "inputs" / selected_name
        selection = {
            "case-id": case["id"],
            "request": "inputs/" + selected_name,
            "receive": True,
        }
        selection_path = output / "chemistry-selection.json"
        atomic_json(selection_path, selection, immutable=True)
        observations = request.get("observations", [])
        roles = {}
        for observation in observations:
            role = observation.get("role", "fit")
            roles[role] = roles.get(role, 0) + 1
        receipt = {
            "schema": "upstate.chemistry-reference-opening/v1",
            "prepared_by": "TokenJunkieLabs engineering",
            "purpose": "Original authored chemical recovery and independent receiving",
            "source_component": "ASTRA-REACT12 0.1.0",
            "source_manifest_sha256": SOURCE_MANIFEST_SHA256,
            "workspace_id": ws.project["id"],
            "operator_workspace_key": digest({"directory": str(ws.root)}),
            "source_collection_id": collection["id"],
            "source_id": SOURCE_ID,
            "source_sha256": retained_entry["body"]["sha256"],
            "case_id": case["id"],
            "project_sha256": case["project_sha256"],
            "project_title": project["title"],
            "project_provenance": project["provenance"],
            "engine_version": ENGINE_VERSION,
            "mode": mode,
            "request_path": str(request_path),
            "request_sha256": hashlib.sha256(files[selected_name]).hexdigest(),
            "observation_count": len(observations),
            "observation_roles": roles,
            "selection_path": str(selection_path),
            "selection_sha256": file_digest(selection_path),
            "browser_arguments": [
                "--workspace", digest({"directory": str(ws.root)}),
                "--case-id", case["id"], "--request", str(request_path),
                "--receive", "--transfer", "--output", str(output / "browser"),
            ],
        }
        atomic_json(output / "chemistry-reference-opening.json", receipt, immutable=True)
        return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, help="Existing original scientific Workspace directory")
    parser.add_argument("--output", required=True, help="Dedicated retained reference inputs and opening selection")
    parser.add_argument("--mode", choices=tuple(REQUESTS), default="calibrate")
    args = parser.parse_args()
    print(json.dumps(prepare(args.workspace, args.output, mode=args.mode), indent=2))


if __name__ == "__main__":
    main()

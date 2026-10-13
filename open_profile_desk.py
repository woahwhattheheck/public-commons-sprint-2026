#!/usr/bin/env python3
"""Open the native profile edition desk with the retained regional source table."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

APP = Path(__file__).resolve().parent
NDR_REFERENCE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html"
SDR_REFERENCE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html"

# These are the original 85E65 working source-profile workflow choices.
# They are editable model settings, retained separately from published coefficients.
REFERENCE_PARAMETERS = {
    "ndr": {
        "threshold_flow_accumulation": 1000,
        "k_param": 2,
        "flow_dir_algorithm": "mfd",
        "subsurface_critical_length_n": 200,
        "subsurface_eff_n": 0.5,
    },
    "sdr": {
        "threshold_flow_accumulation": 1000,
        "k_param": 2,
        "flow_dir_algorithm": "mfd",
        "sdr_max": 0.8,
        "ic_0_param": 0.5,
        "l_max": 122,
    },
}


def prepare(workspace_path, *, source_manifest=None, profile_id=None, parameters_path=None):
    from model.workspace import Workspace
    from model.common import atomic_json, digest

    root = Path(workspace_path).resolve()
    ws = Workspace(root, create=True, title="Upper Savannah profile editions")
    if profile_id:
        if parameters_path:
            raise ValueError("Select an existing profile or supply parameters for the retained source.")
        profile = ws._get("profiles", profile_id)
        table, entry = ws.source_file(
            profile["source_collection_id"], profile["biophysical_source_id"])
    else:
        manifest = Path(source_manifest or APP / "source/biophysical-regional-20261012/source-manifest.json").resolve()
        collection = ws.import_sources(manifest)
        tables = [entry for entry in collection["entries"]
                  if entry["id"] == "regional-biophysical" and entry["kind"] == "table"]
        if len(tables) != 1:
            raise ValueError("The selected manifest must contain the retained regional-biophysical table.")
        entry = tables[0]
        parameters = REFERENCE_PARAMETERS
        if parameters_path:
            parameters = json.loads(Path(parameters_path).read_text(encoding="utf-8"))
            if not isinstance(parameters, dict):
                raise ValueError("The parameter file must be a JSON object.")
            unsupported = set(parameters) - {"ndr", "sdr", "models"}
            if unsupported:
                raise ValueError("Unsupported parameter fields: " + ", ".join(sorted(unsupported)))
        profile = ws.save_profile({
            "title": "Regional reference coefficients — working profile",
            "scientific_status": "working",
            "source_collection_id": collection["id"],
            "biophysical_source_id": entry["id"],
            "references": [NDR_REFERENCE, SDR_REFERENCE, entry["uri"]],
            "notes": [
                "Published Georgia 2019 A1 nutrient and Duke Forest 2022 Table 4 sediment coefficients.",
                "Editable working algorithm settings from the retained 85E65 profile-source workflow.",
                "Use the profile desk to record local scientific review against this exact edition.",
            ],
            **parameters,
        })
        table, entry = ws.source_file(collection["id"], entry["id"])
    result = {
        "schema": "upstate.profile-desk-opening/v1",
        "workspace_id": ws.project["id"],
        "operator_workspace_key": digest({"directory": str(ws.root)}),
        "workspace": str(ws.root),
        "profile_id": profile["id"],
        "source_collection_id": profile["source_collection_id"],
        "biophysical_source_id": profile["biophysical_source_id"],
        "source_table_sha256": entry["body"]["sha256"],
        "source_table": str(table),
        "operator_command": [
            sys.executable, "-B", str(APP / "operator/server.py"),
            "--workspace", str(ws.root),
        ],
    }
    atomic_json(ws.root / "profile-desk-opening.json", result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--source-manifest", type=Path)
    parser.add_argument("--profile-id")
    parser.add_argument("--parameters", type=Path,
                        help="Explicit native ndr/sdr parameters for the original regional table")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("Port must be between 0 and 65535.")
    result = prepare(args.workspace, source_manifest=args.source_manifest,
                     profile_id=args.profile_id, parameters_path=args.parameters)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    if args.prepare_only:
        return 0
    command = result["operator_command"] + ["--port", str(args.port)]
    print("Open the operator URL below and choose Profile workbench.", flush=True)
    return subprocess.call(command)


if __name__ == "__main__":
    raise SystemExit(main())

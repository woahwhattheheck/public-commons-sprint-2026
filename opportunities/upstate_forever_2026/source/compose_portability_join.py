#!/usr/bin/env python3
"""Emit the exact Current195/R5 portability join as an ordinary full-source packet.

Read an already-received C47F R2 packet or a complete current source directory.
Write JSON to stdout. This authoring operation does not install source, alter a
Workspace, fetch dependencies, or change the maintained installer's checks.
"""
from __future__ import annotations

import argparse
import ast
import base64
import hashlib
import json
from pathlib import Path
import re
import sys

JOBS = "operator/native_jobs.py"
INSTALLER = "source/install_robust_workbench.py"
JOBS_BLOB = "fb2548b1f9b6b50b6e8566d2a762bd3e3bf41cd7"
C47F_INSTALLER = "d87812c83e3abd959e8ddd69114d9a5780c48b99"
PR5021_INSTALLER = "fee31b1fa3ee5a202efbb95b727fd35bc9cbd3cd"
JOINED_INSTALLER = "50ac07131c2ecb74e33c31b2e2ef09ed1a6dc209"
ORIGINALS = {
    JOBS: "357b637d098f808cb8fc821a74b7cccc3b5deab60e6cc0221fcd47c5ea92f981",
    INSTALLER: "192a48f1e693519d9ee917ffc4c58053d74ff9c5a172e74d8518f7514ba4311d",
}
ENTRYPOINT = '\n\nif __name__ == "__main__":\n    main()\n'
PAIRED_BLOCK = '''

# Complete published Investigations and paired-report portability cohorts.
# Optional source admission only; REQUIRED and predecessor checks stay unchanged.
ALLOWED = ALLOWED | frozenset({
    "eco_intelligence/install_upstate.py",
    "eco_intelligence/UPSTATE_BINDING.md",
    "operator/web/investigations.css",
    "model/paired_ensemble/__init__.py",
    "model/paired_ensemble/ensemble_cli.py",
    "model/paired_ensemble/ensemble_report.py",
    "model/paired_ensemble/ensemble_report_cli.py",
    "model/paired_ensemble/ensemble_report_source.py",
    "model/paired_ensemble/ensemble_rasters.py",
    "model/paired_ensemble/ensemble_source_receiving.py",
    "integration/component_fragments/paired-ensemble-report.json",
    "docs/PAIRED_ENSEMBLE_PORTABILITY.md",
})
'''
PAYLOAD_BLOCK = '''

# Complete native packing, original-output and root dependency cohorts.
# These remain optional source paths under the existing exact layer checks.
ALLOWED = ALLOWED | frozenset({
    "source_tools/native_runtime/windows_packing.py",
    "source_tools/WINDOWS_CLOUD_PACKING.md",
    "source_tools/native_runtime/conda_sources.py",
    "source_tools/CONDA_CACHE_PACKING.md",
    "source_tools/native_runtime/conda_cache.py",
    "source_tools/NATIVE_CONDA_ACQUISITION.md",
    "source_tools/collection_opening/compose_runtime_dependencies.py",
    "model/parameter_exports.py",
    "model/receiving_water_report_maps.py",
    "model/delivery_archive.py",
})
'''


def git_blob(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def source_records(document: dict) -> dict[str, dict]:
    """Select the two full bodies from the existing packet record forms."""
    if not isinstance(document, dict):
        raise ValueError("Expected a full source packet object")
    files = document.get("files")
    if isinstance(files, dict):
        metadata = document.get("file_metadata", {})
        records = []
        for name in (JOBS, INSTALLER):
            value = files.get(name)
            if isinstance(value, str):
                records.append(dict(metadata.get(name, {}), path=name, content=value))
            elif isinstance(value, dict):
                if value.get("path", name) != name:
                    raise ValueError("Conflicting source name: " + name)
                records.append(dict(value, path=name))
    elif isinstance(files, list):
        records = files
    else:
        raise ValueError("The existing packet has no files collection")
    selected = {}
    for record in records:
        if not isinstance(record, dict) or record.get("path") not in ORIGINALS:
            continue
        name = record["path"]
        if name in selected:
            raise ValueError("Duplicate selected source: " + name)
        selected[name] = record
    if set(selected) != set(ORIGINALS):
        raise ValueError("Supply both complete C47F/current native_jobs and installer bodies")
    return selected


def decode(record: dict) -> bytes:
    if "content_base64" in record:
        if "content" in record:
            raise ValueError("Select one full source encoding")
        data = base64.b64decode(record["content_base64"], validate=True)
    else:
        value = record.get("content")
        if not isinstance(value, str):
            raise ValueError("Full UTF-8 source is required: " + record["path"])
        data = value.encode("utf-8")
    if "bytes" in record and (type(record["bytes"]) is not int or len(data) != record["bytes"]):
        raise ValueError("Source byte length differs: " + record["path"])
    if "sha256" in record and hashlib.sha256(data).hexdigest() != record["sha256"]:
        raise ValueError("Source SHA-256 differs: " + record["path"])
    ast.parse(data.decode("utf-8"), filename=record["path"])
    return data


def joined_installer(data: bytes) -> bytes:
    identity = git_blob(data)
    if identity == JOINED_INSTALLER:
        return data
    if identity not in (C47F_INSTALLER, PR5021_INSTALLER):
        raise ValueError("Retain and compose the different installer edition: " + identity)
    text = data.decode("utf-8")
    if not text.endswith(ENTRYPOINT):
        raise ValueError("The complete original installer entrypoint differs")
    prefix = text[:-len(ENTRYPOINT)]
    if identity == C47F_INSTALLER:
        prefix += PAIRED_BLOCK
    result = (prefix + PAYLOAD_BLOCK + ENTRYPOINT).encode("utf-8")
    if git_blob(result) != JOINED_INSTALLER:
        raise ValueError("Composed installer differs from the complete published source")
    return result


def compose(document: dict) -> dict:
    records = source_records(document)
    sources = {name: decode(record) for name, record in records.items()}
    if git_blob(sources[JOBS]) != JOBS_BLOB:
        raise ValueError("Retain and compose the different native supervisor edition")
    outputs = {JOBS: sources[JOBS], INSTALLER: joined_installer(sources[INSTALLER])}
    files = []
    for name in (JOBS, INSTALLER):
        previous = {ORIGINALS[name], hashlib.sha256(sources[name]).hexdigest()}
        for key in ("before_sha256", "base_sha256", "replaces_sha256"):
            values = records[name].get(key, [])
            if isinstance(values, str):
                values = [values]
            if not isinstance(values, list) or any(
                    not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None
                    for value in values):
                raise ValueError("Malformed retained preimages: " + name)
            previous.update(values)
        data = outputs[name]
        ast.parse(data.decode("utf-8"), filename=name)
        files.append({"path": name, "bytes": len(data),
                      "sha256": hashlib.sha256(data).hexdigest(),
                      "git_blob": git_blob(data), "before_sha256": sorted(previous),
                      "content": data.decode("utf-8")})
    return {"schema": "commons.source-map/1",
            "source_reference": "ECO-CURRENT195-PORTABILITY-J76/2",
            "description": "Final explicit source layer after the original full portability cohorts.",
            "files": files}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--packet", type=Path, help="Already-received C47F R2 full-content JSON")
    source.add_argument("--source-root", type=Path, help="Complete current application source directory")
    args = parser.parse_args(argv)
    try:
        if args.packet:
            document = json.loads(args.packet.read_text(encoding="utf-8-sig"))
        else:
            document = {"files": [{"path": name, "content":
                         (args.source_root / name).read_bytes().decode("utf-8")}
                         for name in (JOBS, INSTALLER)]}
        result = (json.dumps(compose(document), ensure_ascii=True, indent=2) + "\n").encode("utf-8")
    except (OSError, UnicodeError, ValueError, SyntaxError) as error:
        print("Portability source join: " + str(error), file=sys.stderr)
        return 2
    sys.stdout.buffer.write(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

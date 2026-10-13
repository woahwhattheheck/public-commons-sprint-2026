#!/usr/bin/env python3
"""Receive an original source edition and exercise its existing native views.

Uses only the original Workspace importer/materializer; no GIS calculation or
synthetic scientific data. A fresh Python child checks cold reopening.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model.common import atomic_json, file_digest, read_json
from model.workspace import Workspace
from model.verified_files import verified_files


def checked_collection(workspace, collection_id):
    collection = workspace._get("sources", collection_id)
    original = collection["original_manifest"]
    manifest_path = workspace.root / original["object"]
    if (manifest_path.stat().st_size != original["bytes"]
            or file_digest(manifest_path) != original["sha256"]):
        raise ValueError("Original source manifest changed")
    return collection


def inspect_views(workspace, collection):
    result = []
    for entry in collection["entries"]:
        primary, retained = workspace.source_file(collection["id"], entry["id"])
        if retained != entry:
            raise ValueError("Native source entry changed")
        view = workspace.root / "source-views" / collection["id"]
        from model.common import digest
        view = view / digest(entry["id"])
        for body in [entry["body"]] + entry["companions"]:
            path = view / body.get("view_path", body["filename"])
            if (path.stat().st_size != body["bytes"]
                    or file_digest(path) != body["sha256"]):
                raise ValueError("Original native view bytes changed: " + str(path))
        result.append({"source_id": entry["id"], "primary": str(primary.relative_to(workspace.root)),
                       "members": len(entry["companions"]) + 1})
    return result


def reopen(directory):
    directory = Path(directory).resolve(strict=True)
    received = read_json(directory / "source-receiving.json")
    workspace = Workspace(directory / "workspace")
    if workspace.project != received["project"]:
        raise ValueError("Cold reopen selected another original workspace")
    collection = checked_collection(workspace, received["source_collection_id"])
    if collection != received["collection"]:
        raise ValueError("Cold reopen changed the complete original source collection")
    before = time.perf_counter()
    with verified_files() as operation:
        views = inspect_views(workspace, collection)
        observed = operation.observation()
    if collection["entries"] and observed["source_hash_reads"] == 0:
        raise ValueError("A cold process must read its original retained source bodies")
    result = {"schema": "upstate.source-materialization-cold-reopen/v1",
              "source_collection_id": collection["id"], "project_id": workspace.project["id"],
              "views": views, "verification": observed,
              "elapsed_seconds": time.perf_counter() - before,
              "runtime": {"python": sys.version, "executable": sys.executable,
                          "pid": os.getpid()}, "identity": "MATCH"}
    atomic_json(directory / "cold-reopen.json", result, immutable=True)
    return result


def receive(manifest, output):
    manifest = Path(manifest).resolve(strict=True)
    output = Path(output).resolve()
    if output == manifest.parent or output.is_relative_to(manifest.parent):
        raise ValueError("Choose a new receiving directory outside the original source folder")
    output.mkdir(parents=True, exist_ok=False)
    # Keep partial work and its failure record for diagnosis; never remove a
    # receiver or source tree owned by another operation.
    initial_sha = file_digest(manifest)
    start = time.perf_counter()
    try:
        workspace = Workspace(output / "workspace", create=True,
                              title="Original source materialization receiving")
        with verified_files() as operation:
            collection = workspace.import_sources(manifest)
            imported = operation.observation()
            first = [workspace.source_file(collection["id"], entry["id"])[0]
                     for entry in collection["entries"]]
            materialized = operation.observation()
            # A first second-pass source may hash the final ctime after other
            # aliases were created. A completed third pass must reuse all exact
            # unchanged identities; none of these calls creates a new alias.
            for _ in range(2):
                for entry in collection["entries"]:
                    workspace.source_file(collection["id"], entry["id"])
                observed = operation.observation()
                if _ == 0:
                    stabilized = observed
            if observed["source_hash_reads"] != stabilized["source_hash_reads"]:
                raise ValueError("Repeated unchanged native source selection reread full bodies")
        if file_digest(manifest) != initial_sha:
            raise ValueError("Original manifest changed during receiving")
        verified_views = inspect_views(workspace, collection)
        checked_collection(workspace, collection["id"])
        record = {"schema": "upstate.source-materialization-receiving/v1",
                  "source_manifest": {"filename": manifest.name, "sha256": initial_sha,
                                      "bytes": manifest.stat().st_size},
                  "project": workspace.project, "source_collection_id": collection["id"],
                  "collection": collection, "views": verified_views,
                  "observations": {"import": imported, "first_materialization": materialized,
                                   "stable_materialization": stabilized, "repeat": observed},
                  "elapsed_seconds": time.perf_counter() - start,
                  "runtime": {"python": sys.version, "executable": sys.executable,
                              "pid": os.getpid()},
                  "scope": "Original full source import and native view materialization only; no scientific model or browser operation."}
        atomic_json(output / "source-receiving.json", record, immutable=True)
        completed = subprocess.run(
            [sys.executable, "-B", str(Path(__file__).resolve()), "--reopen", str(output)],
            check=False, capture_output=True, text=True)
        (output / "cold-reopen.stdout.txt").write_text(completed.stdout, encoding="utf-8")
        (output / "cold-reopen.stderr.txt").write_text(completed.stderr, encoding="utf-8")
        if completed.returncode:
            raise RuntimeError("Cold original-source reopen failed: " + completed.stderr.strip())
        cold = read_json(output / "cold-reopen.json")
        if cold["source_collection_id"] != collection["id"]:
            raise ValueError("Cold process changed original source identity")
        result = {"source_collection_id": collection["id"], "project_id": workspace.project["id"],
                  "directory": str(output), "identity": "MATCH",
                  "entries": len(collection["entries"]),
                  "repeat_source_bytes_read": observed["source_hashed_bytes"] - stabilized["source_hashed_bytes"],
                  "cold_source_bytes_read": cold["verification"]["source_hashed_bytes"],
                  "elapsed_seconds": time.perf_counter() - start,
                  "scope": record["scope"]}
        atomic_json(output / "complete.json", result, immutable=True)
        return result
    except Exception as error:
        atomic_json(output / "failure.json", {"type": type(error).__name__, "message": str(error)})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--reopen", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.reopen:
        if args.manifest or args.output:
            parser.error("--reopen selects the already-received original directory")
        result = reopen(args.reopen)
    else:
        if not args.manifest or not args.output:
            parser.error("choose --manifest ORIGINAL/sources.json and --output NEW_DIRECTORY")
        result = receive(args.manifest, args.output)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()

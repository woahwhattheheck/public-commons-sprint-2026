#!/usr/bin/env python3
"""Retain exact published SCVO originals and the original 360Giving production mappings."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy

EDITIONS = [
    {"id": "digital-ethics-fund-2022", "rows": 5, "bytes": 11280,
     "sha256": "50c77b94091f5c642b7da04973335dde39d2334780b2716ee57e378cdd6eaf34",
     "gitBlob": "90d1f626977f45a552a8920077d92fb819191b3d",
     "mappingSha256": "904e3a51670824df931efc4b0cbbd0cf3bbf620bec70e00faa760fbead583769",
     "title": "SCVO Digital Ethics Fund 2022", "baseline": True},
    {"id": "connecting-to-care-fund-2024", "rows": 7, "bytes": 37456,
     "sha256": "9ff39c6391a1ba484e9a25ece3f08c3b20151ad443901c84098a3e1ca6d42d9d",
     "gitBlob": "92e6e5f16ce95f3060a8f980c1ae4fa9cc77779d",
     "mappingSha256": "cbc61965dbeef509ef361b80875b7f3a0ae24ac04471a388238a5e871b131753",
     "title": "SCVO Connecting to Care Fund 2024", "baseline": False},
]


def write(path, body):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())


def prepare(profile, directory):
    original = runpy.run_path(str(profile / "publisher.py"))
    result = {"schema": "scf.ndjson-file-jobs-original-inputs.v1", "editions": []}
    for edition in EDITIONS:
        path = profile / "examples" / (edition["id"] + ".json")
        body = path.read_bytes()
        if len(body) != edition["bytes"] or hashlib.sha256(body).hexdigest() != edition["sha256"]:
            raise ValueError("Selected publisher source differs from its exact original HTTP bytes")
        if hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest() != edition["gitBlob"]:
            raise ValueError("Selected publisher original Git blob differs")
        package = original["parse"](body.decode("utf-8"))
        if len(package["grants"]) != edition["rows"]:
            raise ValueError("The complete publisher package has changed")
        registry_path = profile / "examples" / (edition["id"] + "-registry.json")
        registry_bytes = registry_path.read_bytes()
        registry = json.loads(registry_bytes)
        mapping = original["mapping"](registry)
        if len(mapping["columns"]) != 26:
            raise ValueError("Select the complete original publisher mapping")
        source = directory / path.name
        mapped = directory / (edition["id"] + "-mapping.json")
        mapping_bytes = (profile / "examples" / mapped.name).read_bytes()
        if hashlib.sha256(mapping_bytes).hexdigest() != edition["mappingSha256"] or json.loads(mapping_bytes) != mapping:
            raise ValueError("Retain the exact published production mapping and its original choices")
        write(source, body)
        write(mapped, mapping_bytes)
        write(directory / registry_path.name, registry_bytes)
        result["editions"].append({
            "id": edition["id"], "title": edition["title"], "rows": edition["rows"],
            "baseline": edition["baseline"], "source": str(source), "mapping": str(mapped),
            "sourceSha256": edition["sha256"], "sourceBytes": len(body),
            "originalGitBlob": edition["gitBlob"],
            "mappingSha256": hashlib.sha256(mapping_bytes).hexdigest(),
            "registrySha256": hashlib.sha256(registry_bytes).hexdigest(),
        })
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.profile.resolve(strict=True), args.out.resolve(strict=True)),
                     ensure_ascii=False), flush=True)

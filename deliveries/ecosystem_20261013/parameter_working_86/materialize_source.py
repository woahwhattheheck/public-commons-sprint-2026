#!/usr/bin/env python3
"""Materialize the exact complete Parameter working installer source cohort."""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath

def checked(data, expected, label):
    if len(data) != expected["bytes"] or hashlib.sha256(data).hexdigest() != expected["sha256"]:
        raise ValueError(label + " differs from the retained source")
    return data

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bank", type=Path, required=True, help="Original source-bank.json.gz or its complete UTF-8 Base64 file")
    parser.add_argument("--output", type=Path, required=True, help="A new source directory; an existing path is never replaced")
    args = parser.parse_args()
    incoming = args.bank.read_bytes()
    if incoming.startswith(b"\x1f\x8b"):
        packed = incoming
    else:
        checked(incoming, {"bytes":639340,"sha256":"ea567b6dd6279c6d55851b82e5315ff85ff6904d7c70322ffa6ea7c7963e84b9","git_blob":"100e35b6cdc8292dc708dacf3f5caa0a6c15cc73"}, "Base64 carrier")
        packed = base64.b64decode(incoming, validate=True)
    checked(packed, {"bytes":479504,"sha256":"75708bbe75515b1417c3b18d07f72c2cb5b69d50a955a5bbdda280cb4bba40b0","git_blob":"097ffaa7df0924d28817f79d017a070a6b719c6e"}, "Gzip carrier")
    data = checked(gzip.decompress(packed), {"bytes":1871333,"sha256":"feb6a9e3ce918cef4426b0c8f669d706b70b5ac5bd94a438ca945b784515bb83"}, "Complete source bank")
    bank = json.loads(data)
    if bank.get("schema") != "upstate.source-bank/v1" or bank.get("commit") != "bdf18bc7cf4375689d1a3746f32f6038e0b74efe" or len(bank.get("files", [])) != 86:
        raise ValueError("Select the complete original 86-file cohort")
    members = []
    names = set()
    for row in bank["files"]:
        path = PurePosixPath(row["path"])
        if path.is_absolute() or ".." in path.parts or path.as_posix() != row["path"] or row["path"] in names:
            raise ValueError("Invalid or repeated original source path")
        names.add(row["path"])
        members.append((path, checked(row["content"].encode("utf-8"), row, row["path"])))
    output = args.output.absolute()
    if output.exists() or output.is_symlink():
        raise ValueError("Choose a new source directory; existing source stays intact")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.mkdir(mode=0o700)
    for path, body in members:
        target = output.joinpath(*path.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as handle:
            handle.write(body)
    print(json.dumps({"state": "materialized", "source": str(output), "files": len(members),
                      "commit": bank["commit"], "installer": str(output / bank["installer"])}, indent=2))

if __name__ == "__main__":
    main()

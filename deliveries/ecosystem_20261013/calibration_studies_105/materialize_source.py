#!/usr/bin/env python3
"""Materialize the exact complete direct Calibration Study installer source cohort."""
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
        checked(incoming, {"bytes":751784,"sha256":"235b6d703385ce6339512ca9aade082dc024845696aa72f428cede00a6560651","git_blob":"af1f92070d115475180c2702cb24d5ca2fe59389"}, "Base64 carrier")
        packed = base64.b64decode(incoming, validate=True)
    checked(packed, {"bytes":563837,"sha256":"cbac362f3a6c07e591ec9ea3c075e69c31180ea0715c4d1d010ad86915c2f221","git_blob":"2016becd99a507c470e48af7c4b14847fd1cfc0a"}, "Gzip carrier")
    data = checked(gzip.decompress(packed), {"bytes":2222134,"sha256":"94c26e2c781aa2d2659e6095fa06f31e54e5bd3043ca83fa3b8f9545fec2fff6"}, "Complete source bank")
    bank = json.loads(data)
    if bank.get("schema") != "upstate.source-bank/v1" or bank.get("commit") != "81120739440bdaf152182e0a35c29cd83b119545" or len(bank.get("files", [])) != 105:
        raise ValueError("Select the complete original 105-file cohort")
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

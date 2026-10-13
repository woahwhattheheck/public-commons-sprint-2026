#!/usr/bin/env python3
"""Materialize the exact complete F7 tributary preparation source cohort."""
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
        checked(incoming, {"bytes":122000,"sha256":"4fec31cbd6c85f91c16109a3671da0bfe6860e51e64e1df23f9bcb391949f1f1","git_blob":"4a4fa4f7f7eb73f6ec40c6421f1330389ab9cea7"}, "Base64 carrier")
        packed = base64.b64decode(incoming, validate=True)
    checked(packed, {"bytes":91500,"sha256":"7868c0735ab6e6c2f081bebf786856a703e678aca13865ad94d32eec0de9cc2b","git_blob":"76d8530905b301c5e3351ee02bbd1a7c1a23a15f"}, "Gzip carrier")
    data = checked(gzip.decompress(packed), {"bytes":322489,"sha256":"053aa6d7d0873b215b8b16addc07f714850ae592aae9e1f5780cb441ec5484ed"}, "Complete source bank")
    bank = json.loads(data)
    if bank.get("schema") != "upstate.source-bank/v1" or bank.get("commit") != "2b6cbbf4910743302fd065a395b010f60d784564" or len(bank.get("files", [])) != 15:
        raise ValueError("Select the complete original 15-file cohort")
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
                      "commit": bank["commit"], "entrypoint": str(output / bank["entrypoint"])}, indent=2))

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Stage the complete C5AE source cohort; leave the installed application and Workspace untouched."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile

OPERATION = "ECO-264B-C5AE-CUMULATIVE-GIS-REVIEW-20261013"
EXPECTED_JSON_SHA256 = "3b2331a3579ca0dc6e5594611616114174345301712ab6a8a5dc5af787abd0bb"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stage(bank_path, destination):
    bank_path = Path(bank_path).resolve(strict=True)
    text = bank_path.read_text(encoding="utf-8-sig")
    # read_text's universal newline handling removes only document formatting.
    # Every original source body is a JSON string and is verified independently.
    if digest(text.encode("utf-8")) != EXPECTED_JSON_SHA256:
        raise ValueError("Use the complete unchanged current C5AE public source bank.")
    bank = json.loads(text)
    if bank.get("schema") != "commons.source-bank/v1" or bank.get("operation_id") != OPERATION:
        raise ValueError("This source bank belongs to another operation.")
    rows, files = bank["manifest"], bank["files"]
    if not isinstance(rows, list) or not isinstance(files, dict) or len(rows) != 41:
        raise ValueError("The complete 41-file source cohort is required.")
    pending = {}
    for row in rows:
        name = row["path"]
        relative = PurePosixPath(name)
        if (not isinstance(name, str) or "\\" in name or "\0" in name
                or relative.is_absolute() or not relative.parts
                or any(part in {".", ".."} for part in relative.parts)
                or relative.as_posix() != name or name in pending):
            raise ValueError("Noncanonical or duplicated source path: " + str(name))
        value = files[name]
        if not isinstance(value, str):
            raise ValueError("Source member is not complete UTF-8 text: " + name)
        body = value.encode("utf-8")
        if len(body) != row["bytes"] or digest(body) != row["sha256"]:
            raise ValueError("Source identity changed: " + name)
        if name.endswith(".py"):
            compile(body, name, "exec")
        elif name.endswith(".json"):
            json.loads(body)
        pending[name] = body
    if set(pending) != set(files) or sum(map(len, pending.values())) != bank["source_bytes"]:
        raise ValueError("The source inventory is incomplete or has undeclared files.")
    destination = Path(destination).absolute()
    if destination.is_symlink() or destination.exists():
        raise ValueError("Use a new owned staging directory, separate from the application and Workspace.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.parent.resolve() != destination.parent:
        raise ValueError("The staging parent must use its resolved original path.")
    temporary = Path(tempfile.mkdtemp(prefix=".eco264b-source-", dir=destination.parent))
    try:
        for name, body in pending.items():
            target = temporary / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as stream:
                stream.write(body)
        (temporary / "RECEIVING.md").write_text(bank["receiving_guide"], encoding="utf-8")
        receipt = {
            "schema": "upstate.county-source-staging/v1",
            "operation_id": OPERATION,
            "source_bank": str(bank_path),
            "source_bank_bytes": bank_path.stat().st_size,
            "source_bank_sha256": digest(bank_path.read_bytes()),
            "canonical_json_sha256": EXPECTED_JSON_SHA256,
            "directory": str(destination),
            "source_bytes": bank["source_bytes"],
            "files": rows,
            "scope": "source_staging_only",
        }
        (temporary / "SOURCE_RECEIPT.json").write_text(
            json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        # A new sibling directory publishes the complete preflighted cohort at once.
        if destination.exists() or destination.is_symlink():
            raise ValueError("The selected staging destination appeared during source preparation.")
        os.rename(temporary, destination)
        return receipt
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-bank", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    arguments = parser.parse_args()
    print(json.dumps(stage(arguments.source_bank, arguments.destination),
                     ensure_ascii=False, indent=2))

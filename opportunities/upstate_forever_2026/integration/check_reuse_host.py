"""Exercise the original verified-copy path on the current host."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from model.reuse import copy_verified


def run():
    with tempfile.TemporaryDirectory(prefix="reuse-host-", dir=ROOT) as directory:
        root = Path(directory)
        source = root / "source"
        source.mkdir()
        original = source / "original.csv"
        body = b"station,value\nA,2.5\n"
        original.write_bytes(body)
        descriptor = {"path": "original.csv", "bytes": len(body),
                      "sha256": hashlib.sha256(body).hexdigest()}
        receiving = root / "receiving"
        receiving.mkdir()
        transfer = {}
        result = copy_verified(source, descriptor, receiving, transfer=transfer)
        saved = receiving / result["path"]
        assert saved.read_bytes() == body
        assert saved.stat().st_ino != original.stat().st_ino
        method = next(iter(transfer["methods"]))
        assert method == "copy" if os.name == "nt" else method in ("copy", "reflink")
        original_stat = saved.stat()
        copy_verified(source, descriptor, receiving, transfer=transfer)
        assert transfer["methods"]["retained"] == 1
        assert saved.stat().st_mtime_ns == original_stat.st_mtime_ns
        saved.write_bytes(body.replace(b"2.5", b"9.5"))
        assert original.read_bytes() == body
        try:
            copy_verified(source, descriptor, receiving)
        except ValueError:
            pass
        else:
            raise AssertionError("Changed retained body was accepted")
        copy_verified(source, descriptor, receiving, replace_mismatch=True)
        assert saved.read_bytes() == body
        invalid = {**descriptor, "sha256": "0" * 64}
        try:
            copy_verified(source, invalid, receiving, path="incorrect.csv")
        except ValueError:
            pass
        else:
            raise AssertionError("Incorrect source hash was published")
        assert not (receiving / "incorrect.csv").exists()
        assert not list(receiving.glob(".write-*"))
        try:
            copy_verified(source, descriptor, receiving, path="../outside.csv")
        except ValueError:
            pass
        else:
            raise AssertionError("Destination escaped its owned operation")
        assert not (root / "outside.csv").exists()
        return {"independent_copy": "PASS", "existing_body_reopen": "PASS",
                "changed_body_repair": "PASS", "incorrect_hash_rejected": "PASS",
                "destination_boundary": "PASS", "method": method}


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))

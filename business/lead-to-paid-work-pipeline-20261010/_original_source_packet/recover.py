#!/usr/bin/env python3
"""Restore the author's two exact original reply-triage sources. Python stdlib only."""
import base64
import hashlib
import json
import lzma
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEST = HERE.parent
PACK_SHA = "f609a91f14c51940cffb18c1e369e54597da8bc640858752abdde63acedfdb56"
JSON_SHA = "cb9f5bc2a858fe4f06be8c373dc9e646de09228bac8c8c9e1f58d4dd74cab569"
EXPECTED = {
    "reply-triage.mjs": "2d87ae4412748701b659ba0c493e8ad019a120115db0053b68d5607177224545",
    "REPLY-TRIAGE.md": "430ee407f10d596d16504149b6a4db0053b8e3df2cc94d578784898fd18ab57f",
}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def main():
    payload = "".join((HERE / f"part0{i}.b64").read_text(encoding="ascii").strip()
                      for i in range(1, 4))
    if len(payload) != 7720:
        raise ValueError("original Slack source envelope truncated")
    packed = base64.b64decode(payload, validate=True)
    if sha(packed) != PACK_SHA:
        raise ValueError("original XZ SHA256 mismatch")
    raw = lzma.decompress(packed)
    if sha(raw) != JSON_SHA:
        raise ValueError("original JSON SHA256 mismatch")
    files = json.loads(raw)
    if set(files) != set(EXPECTED):
        raise ValueError("unexpected source files")
    verified = {}
    for name, digest in EXPECTED.items():
        if not isinstance(files[name], str):
            raise ValueError("non-text source")
        content = files[name].encode("utf-8")
        if sha(content) != digest:
            raise ValueError(f"original source digest mismatch: {name}")
        verified[name] = content
    # Preflight both names before writing either. Never silently replace peer edits.
    for name in verified:
        if (DEST / name).exists():
            raise FileExistsError(f"refusing to replace existing source: {name}")
    for name, content in verified.items():
        with (DEST / name).open("xb") as output:
            output.write(content)
        print(f"restored {name}: {len(content)} bytes SHA256 {sha(content)}")

if __name__ == "__main__":
    main()

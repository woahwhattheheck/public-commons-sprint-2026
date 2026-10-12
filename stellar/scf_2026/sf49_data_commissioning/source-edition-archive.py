#!/usr/bin/env python3
"""Original streaming source archive, with the SF49 envelope and limits."""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import sys

SCHEMA = "stellar-forge.sf49.source-edition-archive.v1"
MAX_META = 2 * 1024 * 1024
MAX_EXPANDED = 16 * 1024 ** 3 + 256 * 1024 ** 2


def module():
    original = Path(__file__).resolve().parents[2] / "scf-starforge-20261009" / "sf30-seller-sdk" / "source_bundle_archive.py"
    spec = importlib.util.spec_from_file_location("sf49_source_bundle_archive", original)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_META + 1)
        if len(raw) > MAX_META:
            raise ValueError("Archive request exceeds the retained metadata limit")
        request = json.loads(raw)
        if not isinstance(request, dict) or request.get("action") not in ("archive", "extract", "inspect"):
            raise ValueError("Use a native source archive action")
        shared = module()
        policy = shared.ArchivePolicy(SCHEMA, max_expanded_bytes=MAX_EXPANDED,
                                      max_members=72, max_manifest_bytes=MAX_META,
                                      max_file_bytes=8 * 1024 ** 3,
                                      receipt_name=None, prefix="SF49")
        result = getattr(shared, request["action"])(request, policy=policy)
        sys.stdout.write(json.dumps({"ok": True, "result": result}, ensure_ascii=False,
                                    separators=(",", ":"), allow_nan=False) + "\n")
        return 0
    except Exception as error:
        code = getattr(error, "code", "SF49_ARCHIVE_INPUT_OR_IO_FAILED")
        sys.stdout.write(json.dumps({"ok": False, "error": code,
                                    "errno": getattr(error, "errno", None),
                                    "message": getattr(error, "message", "The original source archive operation could not complete.")},
                                   ensure_ascii=False, separators=(",", ":")) + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

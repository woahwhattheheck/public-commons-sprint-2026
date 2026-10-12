#!/usr/bin/env python3
"""SEC operator policy over the maintained complete source archive engine."""
from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from source_bundle_archive import ArchiveFault, ArchivePolicy, archive, extract, inspect

POLICY = ArchivePolicy(
    "stellar-forge.sec-edgar-operator-archive.v1",
    max_expanded_bytes=8 * 1024 * 1024 * 1024,
    max_members=100000,
    max_manifest_bytes=64 * 1024 * 1024,
    max_file_bytes=32 * 1024 * 1024,
    receipt_name="received-handover.json",
    prefix="EDGAR_PORTABLE",
)


def main():
    request = json.load(sys.stdin)
    action = request.pop("action", None)
    if action not in ("archive", "inspect", "extract"):
        raise ArchiveFault("EDGAR_PORTABLE_ACTION_INVALID")
    result = {"archive": archive, "inspect": inspect, "extract": extract}[action](request, policy=POLICY)
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(json.dumps({
            "error": getattr(error, "code", "EDGAR_PORTABLE_ARCHIVE_FAILED"),
            "message": str(error),
        }) + "\n")
        sys.exit(1)

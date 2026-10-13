#!/usr/bin/env python3
"""Compare the full native report with the report retained inside its original handover."""
import base64
import io
import json
import sys
import zipfile

MAX_CASE = 32 * 1024 * 1024
MAX_REPORT = 64 * 1024 * 1024
MAX_INPUT = 128 * 1024 * 1024

def inspect(request):
    raw = base64.b64decode(request["archiveBase64"], validate=True)
    if not raw or len(raw) > MAX_CASE:
        raise ValueError("Keep the complete native performance archive, up to 32 MiB.")
    report = request["report"]
    if not isinstance(report, dict) or report.get("schema") != "stellar-forge.sf47-performance.v1":
        raise ValueError("Use the complete native Budget performance report.")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("The native performance archive contains duplicate member names.")
        for name in ("report.json", "period.json", "operations-case.zip", "MANIFEST.json"):
            if name not in names:
                raise ValueError("Keep the complete native performance handover: missing " + name)
        entry = archive.getinfo("report.json")
        if entry.file_size > MAX_REPORT:
            raise ValueError("The native report exceeds 64 MiB.")
        retained = json.loads(archive.read(entry).decode("utf-8"))
        if retained != report:
            raise ValueError("The full report and the original native archive contain different reporting editions.")
        return {
            "case": report["case"],
            "selection": report["selection"],
            "reportSha256": report["reportSha256"],
            "archiveMembers": len(names),
        }

def main():
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        raise ValueError("The complete reporting input exceeds 128 MiB.")
    value = inspect(json.loads(raw.decode("utf-8")))
    sys.stdout.write(json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n")

if __name__ == "__main__":
    try:
        main()
    except (ValueError, TypeError, KeyError, UnicodeError, zipfile.BadZipFile, RuntimeError) as error:
        sys.stderr.write(json.dumps({"error": str(error)}, ensure_ascii=False) + "\n")
        sys.exit(1)

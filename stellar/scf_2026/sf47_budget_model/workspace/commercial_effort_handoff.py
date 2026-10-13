#!/usr/bin/env python3
"""Verify a complete saved SF47 commercial Installation for private economics.
MIT. Uses the original Workspace/Operations receiving and effort report engines.
It creates only an isolated temporary receiving workspace and never edits the
selected operating case, merchant quotation, customer acceptance or Forecast.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import tempfile
import zipfile

from model import Workspace
from operations import Operations
import operations_installation_effort as effort
from model import canonical

SCHEMA = "stellar-forge.sf47-commercial-effort-handoff.v1"
MAX_BYTES = 32 * 1024 * 1024
HASH = re.compile(r"^[a-f0-9]{64}$")


def fail(message):
    raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def private_bytes(path):
    path = Path(path)
    if not path.is_absolute() or str(path) != os.path.normpath(str(path)):
        fail("Use an absolute normalized private archive path.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.geteuid()
                or before.st_mode & 0o077 or before.st_nlink != 1
                or before.st_size > MAX_BYTES):
            fail("The complete archive must be a private owned regular file up to 32 MiB.")
        chunks, count = [], 0
        while True:
            chunk = os.read(fd, min(1024 * 1024, MAX_BYTES + 1 - count))
            if not chunk:
                break
            chunks.append(chunk)
            count += len(chunk)
            if count > MAX_BYTES:
                fail("The complete archive exceeds 32 MiB.")
        after = os.fstat(fd)
        named = os.stat(path, follow_symlinks=False)
        keys = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        if any(getattr(before, key) != getattr(after, key) for key in keys) or \
                (named.st_dev, named.st_ino) != (before.st_dev, before.st_ino):
            fail("The selected archive changed while being read.")
        return b"".join(chunks)
    finally:
        os.close(fd)


def verify(raw, *, archive_sha256, installation_id, revision,
           installation_sha256, report_sha256):
    for value in (archive_sha256, installation_sha256, report_sha256):
        if not isinstance(value, str) or not HASH.fullmatch(value):
            fail("Select every exact original SHA-256.")
    if len(raw) > MAX_BYTES or sha(raw) != archive_sha256:
        fail("The complete archive differs from the selected original bytes.")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        fail("Select the original positive Installation revision.")
    # This is the original complete operations parser, not a reduced report reader.
    document, files = Operations._unpack(raw)
    if "installation-selection.json" not in files or "installation-effort.json" not in files:
        fail("Export the complete case with the selected saved Installation and effort.")
    selected = json.loads(files["installation-selection.json"])
    expected = {"id": installation_id, "revision": revision, "sha256": installation_sha256}
    if {"id": selected.get("installationId"), "revision": selected.get("revision"),
            "sha256": selected.get("sha256")} != expected:
        fail("The archive selects a different Installation.")
    original = next((row for row in document.get("installations", [])
        if row.get("id") == installation_id and row.get("revision") == revision), None)
    if original is None or original.get("sha256") != installation_sha256:
        fail("The original saved Installation is absent.")
    # Seed only our isolated reader from the archive's own source. The complete
    # native import below independently validates the nested planner and history.
    with zipfile.ZipFile(io.BytesIO(files["planning.zip"])) as archive:
        infos = archive.infolist()
        names = [item.filename for item in infos]
        if (len(names) != len(set(names)) or len(names) > 220
                or sum(item.file_size for item in infos) > MAX_BYTES):
            fail("The original planner archive is duplicate or excessive.")
        source = archive.read("original-source.json")
    with tempfile.TemporaryDirectory(prefix="sf47-commercial-effort-") as root:
        root = Path(root)
        source_path = root / "original-source.json"
        with source_path.open("xb") as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(source)
        workspace = Workspace(root / "workspace", source_path)
        try:
            ops = Operations(workspace)
            received = ops.import_bundle(raw, "Private commercial effort receiving",
                "effort-" + archive_sha256[:48], "Private economics source verifier")
            if received.get("selectedInstallation") != expected:
                fail("The native receiver selected a different Installation.")
            row = ops.installation(received["id"], installation_id, revision)
            if {key: value for key, value in row.items() if key != "current"} != original:
                fail("The native received Installation differs from its complete original.")
            report = effort.report(row["preview"]["snapshot"], row["preview"]["document"])
            if report.get("schema") != "stellar-forge.sf47-installation-effort.v1" or \
                    report.get("sourceKind") != "COMMERCIAL":
                fail("Install the commercial-effort engine and select its saved commercial report.")
            if report.get("reportSha256") != report_sha256:
                fail("The recomputed report differs from the selected original report.")
            report_bytes = (canonical(report) + "\n").encode("utf-8")
            if files["installation-effort.json"] != report_bytes or \
                    row["preview"]["report"].get("effort") != report:
                fail("The selected report differs from the native saved edition.")
            binding = report.get("commercial")
            if not isinstance(binding, dict):
                fail("The complete original commercial binding is required.")
            metadata, source_bytes = ops.source(received["id"], binding["sourceId"])
            if metadata["sha256"] != binding["sourceSha256"]:
                fail("The selected commercial source differs from its binding.")
            current = row.get("current")
            reader = []
            for name in ("commercial_effort_handoff.py", "operations.py", "model.py",
                         "operations_installations.py", "operations_installation_effort.py",
                         "operations_commercial_installations.py", "operations_commercial_effort.py"):
                body = (Path(__file__).resolve().parent / name).read_bytes()
                reader.append({"path": name, "bytes": len(body), "sha256": sha(body)})
            return {"schema": SCHEMA, "state": "VERIFIED",
                "archive": {"bytes": len(raw), "sha256": archive_sha256},
                "originalCase": {"id": document["program"]["id"],
                    "version": document["program"]["version"],
                    "mode": document["program"]["mode"]},
                "selection": {**expected, "reportSha256": report_sha256},
                "installation": original, "report": report, "current": current,
                "commercialSource": metadata,
                "reportFile": {"path": "installation-effort.json",
                    "bytes": len(report_bytes), "sha256": sha(report_bytes)},
                "reader": reader}
        finally:
            workspace.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--installation", required=True)
    parser.add_argument("--revision", type=int, required=True)
    parser.add_argument("--installation-sha", required=True)
    parser.add_argument("--report-sha", required=True)
    args = parser.parse_args()
    result = verify(private_bytes(args.archive), archive_sha256=args.sha256,
        installation_id=args.installation, revision=args.revision,
        installation_sha256=args.installation_sha, report_sha256=args.report_sha)
    sys.stdout.write(canonical(result) + "\n")


if __name__ == "__main__":
    def cancelled(signum, frame):
        # Raising through the original subprocess.run context drains its owned
        # Node reader before our Workspace/temporary receiving cleanup executes.
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        raise RuntimeError("Original commercial effort receiving was cancelled.")
    signal.signal(signal.SIGINT, cancelled)
    signal.signal(signal.SIGTERM, cancelled)
    try:
        main()
    except Exception as error:
        sys.stderr.write(json.dumps({"error": getattr(error, "code", "COMMERCIAL_EFFORT_HANDOFF"),
            "detail": str(error)}, ensure_ascii=False) + "\n")
        sys.exit(1)

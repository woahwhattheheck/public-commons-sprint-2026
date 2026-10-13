#!/usr/bin/env python3
"""Receive complete native amendment calendars in the original operated case.

Reuse --root from amendment_receiving.py, or supply one complete amended case
with --archive and its original --archive-sha256. Browser work uses the same
native server and saved edition; all output remains in this original root.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import zipfile

OPERATION = "SCF-DELIVERY-AMENDMENTS-55F0-20261012"
RECEIVING = "CEDAR-8047-SCF-AMENDMENT-CALENDAR"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def put(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".incoming")
    with temporary.open("wb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


def document(path, value):
    put(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def inspect_export(raw, expected_impact):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        manifest = json.loads(archive.read("MANIFEST.json"))
        if manifest["impactSha256"] != expected_impact:
            raise RuntimeError("The received calendar ZIP selected a different native comparison.")
        descriptors = manifest["files"]
        if {item["path"] for item in descriptors} != set(archive.namelist()) - {"MANIFEST.json"}:
            raise RuntimeError("The calendar ZIP does not contain its complete declared payload.")
        for item in descriptors:
            body = archive.read(item["path"])
            if len(body) != item["bytes"] or sha(body) != item["sha256"]:
                raise RuntimeError("A complete calendar file differs: " + item["path"])
        counts = {}
        for side in ("before", "selected"):
            report = json.loads(archive.read(side + "/calendar.json"))
            rows = list(csv.DictReader(io.StringIO(archive.read(side + "/calendar.csv").decode("utf-8-sig"))))
            if {row["id"] for row in rows} != {row["id"] for row in report["entries"] + report["undated"]}:
                raise RuntimeError("The " + side + " calendar CSV lost an original entry.")
            count = archive.read(side + "/calendar.ics").count(b"BEGIN:VEVENT\r\n")
            if count != len(report["entries"]):
                raise RuntimeError("The " + side + " calendar ICS lost a dated event.")
            counts[side] = {"dated": count, "undated": len(report["undated"])}
        return counts


def main(args):
    from model import Workspace
    from operations import Operations
    from managed_launch import selection
    from server import create_server
    import amendment_receiving

    app = Path(__file__).resolve().parent
    source = app.parent / "sf10_current_candidate.json"
    root = args.root.expanduser().resolve()
    output = root / "output" / "calendar-impact"
    output.mkdir(parents=True, exist_ok=True)
    node = args.node or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    playwright = args.playwright or (str(Path(os.environ["CODEX_PRIMARY_RUNTIME_NODE_MODULES"]) / "playwright")
                                     if os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES") else "playwright")
    chromium = args.chromium or "/workspace/scratch/5403360e55a4/fleet-lightweight/shared/swarm/toolchains/browser/chromium-153.0.0/chromium"
    if not node or not Path(chromium).is_file():
        raise RuntimeError("Select this receiving host's installed Node and Chromium executable.")

    if args.archive:
        if not args.archive_sha256 or sha(args.archive.read_bytes()) != args.archive_sha256:
            raise RuntimeError("Select the complete original amended case with its exact SHA-256.")
        workspace_path = root / "data-calendar-receiver"
        workspace = Workspace(workspace_path, source)
        try:
            ops = Operations(workspace)
            receipt = ops.import_bundle(args.archive.read_bytes(), "Received original amendment calendar case",
                                        "cedar8047-calendar-" + args.archive_sha256[:32], RECEIVING)
            case_id = receipt["id"]
        finally:
            workspace.close()
    else:
        amendment_receiving.main(root)
        checkpoint = json.loads((root / "output" / "amendment-receiving-checkpoint.json").read_bytes())
        case_id = checkpoint["caseId"]
        workspace_path = root / "data-original"

    workspace = Workspace(workspace_path, source)
    try:
        ops = Operations(workspace)
        current = ops.read(case_id)
        heads = ops.amendments(case_id)["amendments"]
        chosen = next((row for row in heads if row["id"] == args.amendment), None) if args.amendment else next(iter(heads), None)
        if chosen is None:
            raise RuntimeError("Select an original saved amendment in this retained case.")
        detail = ops.amendment(case_id, chosen["id"], chosen["revision"])
        impact = detail["calendarImpact"]
        export_selection = {"amendmentId": chosen["id"], "revision": chosen["revision"],
                            "expectedAmendmentSha256": detail["amendment"]["sha256"],
                            "expectedImpactSha256": impact["impactSha256"]}
        document(output / "native-amendment.json", detail)
        document(output / "calendar-selection.json", export_selection)
        raw = ops.export_amendment_calendar(case_id, export_selection)
        counts = inspect_export(raw, impact["impactSha256"])
        put(output / "native-amendment-calendars.zip", raw)
        case_archive = output / (case_id + "-v" + str(current["program"]["version"]) + ".zip")
        if not case_archive.exists():
            put(case_archive, ops.export(case_id))
        retained_case, _ = ops._unpack(case_archive.read_bytes())
        if retained_case["program"]["id"] != case_id or retained_case["program"]["version"] != current["program"]["version"]:
            raise RuntimeError("The retained case archive differs from this operated version.")
        selected, selected_sha = selection(workspace_path, source, app)
        document(output / "source-selection.json", {"declaredSourceCommit": args.source_commit,
                 "selectionSha256": selected_sha, "selection": selected,
                 "driverFiles": {name: sha((app / name).read_bytes()) for name in
                                 ("amendment_calendar_receiving.py", "amendment_calendar_receiving.mjs")}})
        case = {"id": case_id, "planId": current["program"]["planId"], "version": current["program"]["version"]}
        if ops.read(case_id)["program"]["version"] != case["version"]:
            raise RuntimeError("The read-only calendar export changed the operated case.")
    finally:
        workspace.close()

    cold = Workspace(root / "data-calendar-cold", source)
    try:
        received_ops = Operations(cold)
        archive_bytes = case_archive.read_bytes()
        received = received_ops.import_bundle(archive_bytes, "Calendar receiving of complete amended case",
                                             "cedar8047-calendar-cold-" + sha(archive_bytes)[:32], RECEIVING)
        reopened = received_ops.amendment(received["id"], chosen["id"], chosen["revision"])
        if reopened["calendarImpact"]["impactSha256"] != impact["impactSha256"]:
            raise RuntimeError("Cold receiving changed the original frozen calendar comparison.")
        document(output / "cold-received-amendment.json", reopened)
        document(output / "cold-receiving.json", received)
    finally:
        cold.close()

    server = create_server(workspace_path, source)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .2}, daemon=True)
    thread.start()
    runtime = output / "runtime"
    runtime.mkdir(exist_ok=True)
    config = runtime / "browser-config.json"
    document(config, {"operationId": OPERATION, "url": server.origin, "workspace": str(workspace_path),
                     "output": str(output), "playwright": playwright, "chromium": chromium,
                     "case": case, "amendment": {"id": chosen["id"], "revision": chosen["revision"]},
                     "impactSha256": impact["impactSha256"]})
    try:
        process = subprocess.run([node, str(app / "amendment_calendar_receiving.mjs"), str(config)],
                                 cwd=app, env={**os.environ, "TMPDIR": str(runtime)}, text=True, capture_output=True)
        put(output / "browser-process.log", (process.stdout + process.stderr).encode("utf-8"))
    finally:
        server.shutdown()
        thread.join(timeout=10)
        server.server_close()
        server.workspace.close()
    browser = json.loads((output / "browser-result.json").read_bytes())
    if process.returncode or browser["status"] != "COMPLETE":
        raise RuntimeError("Continue the retained case from browser-result.json and browser-process.log.")
    browser_counts = inspect_export((output / "browser-amendment-calendars.zip").read_bytes(), impact["impactSha256"])
    result = {"operationId": OPERATION, "receivingId": RECEIVING, "status": "COMPLETE", "case": case,
              "amendment": export_selection, "nativeCalendars": counts, "browserCalendars": browser_counts,
              "coldReceivedCaseId": received["id"], "screenshots": browser["screenshots"],
              "sourceCommit": args.source_commit}
    document(output / "receiving-result.json", result)
    files = sorted(path for path in output.iterdir() if path.is_file()
                   and path.name not in ("MANIFEST.json", "amendment-calendar-receiving.zip")
                   and not path.name.endswith(".incoming"))
    document(output / "MANIFEST.json", {"operationId": OPERATION, "files": [
        {"path": path.name, "bytes": path.stat().st_size, "sha256": sha(path.read_bytes())} for path in files]})
    bundle = io.BytesIO()
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in files + [output / "MANIFEST.json"]:
            archive.writestr(path.name, path.read_bytes())
    put(output / "amendment-calendar-receiving.zip", bundle.getvalue())
    print(json.dumps({"status": "COMPLETE", "path": str(output / "amendment-calendar-receiving.zip"),
                      "bytes": len(bundle.getvalue()), "sha256": sha(bundle.getvalue()), "case": case}), flush=True)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--archive-sha256")
    parser.add_argument("--amendment")
    parser.add_argument("--node")
    parser.add_argument("--playwright")
    parser.add_argument("--chromium")
    main(parser.parse_args())

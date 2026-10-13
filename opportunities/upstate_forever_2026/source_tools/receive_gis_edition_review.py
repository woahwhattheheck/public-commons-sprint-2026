#!/usr/bin/env python3
"""Open an actual retained GIS pair through the maintained working-edition review."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid
import zipfile

OPERATION = "ES-20261013-GIS-REVIEW-GEOGRAPHY"
SCHEMA = "upstate.gis-edition-review-receiving/v1"


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def select_pairs(workspace, gis):
    """Read retained identity records; full native verification follows selection."""
    groups, issues = {"export": [], "received": []}, []
    for kind, pattern in (("export", "gis-exports/*/export.json"),
                          ("received", "gis-received/*/receipt.json")):
        for path in sorted(workspace.root.glob(pattern)):
            try:
                record = gis.load(path)
                if (record.get("state") != "complete"
                        or record.get("project_id") != workspace.project["id"]):
                    continue
                if record.get("id") != path.parent.name:
                    raise ValueError("Record ID differs from its managed directory")
                manifest = gis.load(path.parent / "project" / "project.json")
                expected = gis.fingerprint({"request": manifest["source_request"],
                                            "builder_version": manifest["builder_version"]})
                if (expected != manifest["selection_id"]
                        or expected != record["result"]["selection_id"]):
                    raise ValueError("Manifest selection differs from its own builder/request")
                layers = manifest["layers"]
                groups[kind].append({"id": record["id"], "title": record.get("title"),
                    "selection_id": expected, "source_request": manifest["source_request"],
                    "edition_id": manifest["edition_id"],
                    "fingerprint": record["result"]["fingerprint"],
                    "raster_layers": sum(x["data"]["kind"] == "raster" for x in layers),
                    "vector_layers": sum(x["data"]["kind"] == "vector" for x in layers),
                    "created_at": record.get("created_at")})
            except (OSError, ValueError, KeyError, TypeError) as exc:
                issues.append({"path": path.relative_to(workspace.root).as_posix(),
                               "error": type(exc).__name__, "message": str(exc)})
    by_selection = {}
    for row in groups["export"]:
        by_selection.setdefault(row["selection_id"], []).append(row)
    pairs = []
    for received in groups["received"]:
        for original in by_selection.get(received["selection_id"], []):
            if original["source_request"] == received["source_request"]:
                pairs.append({"export_id": original["id"], "receipt_id": received["id"],
                    "selection_id": received["selection_id"],
                    "exported_edition_id": original["edition_id"],
                    "received_edition_id": received["edition_id"],
                    "exported_fingerprint": original["fingerprint"],
                    "received_fingerprint": received["fingerprint"],
                    "title": received["title"], "raster_layers": received["raster_layers"],
                    "vector_layers": received["vector_layers"]})
    pairs.sort(key=lambda row: (-int(row["raster_layers"] > 0),
                               -row["raster_layers"], row["export_id"], row["receipt_id"]))
    return {"project_id": workspace.project["id"], "pairs": pairs, "record_issues": issues,
            "complete_exports": len(groups["export"]),
            "complete_received": len(groups["received"])}


def reopen_archive(folder, review, target, gis):
    """Extract only the original declared report members, retaining all hierarchy."""
    archive = gis.checked(folder, review["files"]["review.zip"])
    expected = {name: rec for name, rec in review["files"].items() if name != "review.zip"}
    target.mkdir(parents=True, exist_ok=True)
    required = sum(rec["bytes"] for name, rec in expected.items()
                   if not (target / name).exists())
    if shutil.disk_usage(target).free < required:
        raise OSError("The original review needs %d free bytes for independent reopening" % required)
    with zipfile.ZipFile(archive) as stream:
        members = stream.infolist()
        names = [item.filename for item in members]
        if len(names) != len(set(names)) or set(names) != set(expected):
            raise ValueError("Review ZIP membership differs from the completed native report")
        for item in members:
            gis.member(item.filename)
            if item.is_dir() or stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError("Review ZIP contains a non-file member")
            rec = expected[item.filename]
            if item.file_size != rec["bytes"]:
                raise ValueError("Review ZIP member size differs from its retained descriptor")
            destination = gis.local(target, item.filename, exists=False)
            if destination.exists():
                gis.checked(target, rec)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            pending = destination.with_name(destination.name + ".receiving-" + uuid.uuid4().hex)
            try:
                count, digest = 0, hashlib.sha256()
                with stream.open(item) as source, pending.open("xb") as output:
                    for block in iter(lambda: source.read(1024 * 1024), b""):
                        count += len(block)
                        if count > rec["bytes"]:
                            raise ValueError("Review ZIP member exceeds its retained size")
                        digest.update(block)
                        output.write(block)
                    output.flush()
                    os.fsync(output.fileno())
                if count != rec["bytes"] or digest.hexdigest() != rec["sha256"]:
                    raise ValueError("Review ZIP member differs from its retained original bytes")
                os.replace(pending, destination)
            finally:
                pending.unlink(missing_ok=True)
    actual = {p.relative_to(target).as_posix() for p in target.rglob("*") if p.is_file()}
    if actual != set(expected):
        raise ValueError("Reopened report contains unexpected files; use its dedicated output directory")
    for rec in expected.values():
        gis.checked(target, rec)
    document = gis.load(target / "review.json")
    if document["id"] != review["id"] or document["selection"] != review["selection"]:
        raise ValueError("Reopened report differs from the selected native comparison")
    return {"directory": str(target), "html": str(target / "REVIEW.html"),
            "files": len(expected), "bytes": sum(x["bytes"] for x in expected.values()),
            "archive": gis.record(folder, archive)}


def source_map(application, gis):
    paths = ["AGENTS.md", "CURRENT_OWNER_DIRECTION.md", "model/gis_project.py", "model/gis_edition_review.py",
             "model/gis_review_raster.py", "model/gis_review_raster_view.html",
             "operator/gis_projects.py", "operator/server.py",
             "source_tools/receive_gis_edition_review.py",
             "source_tools/receive_gis_edition_review_browser.mjs"]
    return [gis.record(application, application / name) for name in paths
            if (application / name).is_file()]


def browser_course(application, workspace, output, report, folder, reopened, gis, *,
                   node, playwright_module, operator_url_file, timeout):
    """Use the actual installed browser client and existing operator file transport."""
    from model.common import digest
    browser_output = output / "browser" / (timestamp().replace(":", "-") + "-" + uuid.uuid4().hex[:8])
    browser_output.mkdir(parents=True)
    server = None
    worker = None
    request_path = browser_output / ".private-request.json"
    try:
        key = digest({"directory": str(workspace.root)})
        if operator_url_file:
            operator_url = Path(operator_url_file).read_text(encoding="utf-8").strip()
            parsed = urllib.parse.urlsplit(operator_url)
            if (parsed.scheme not in {"http", "https"} or parsed.hostname not in
                    {"127.0.0.1", "localhost", "::1"} or parsed.username or parsed.password):
                raise ValueError("Use the existing local operator URL, including its original fragment")
            origin = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
        else:
            from server import start_server
            server, opened = start_server(workspace.root,
                state_directory=output / "operator-state")
            operator_url, origin, key = opened["operator_url"], opened["origin"], opened["workspace_key"]
            if opened["project"]["id"] != workspace.project["id"]:
                raise ValueError("The operator opened a different original scientific project")
            worker = threading.Thread(target=server.serve_forever,
                                      kwargs={"poll_interval": .2}, daemon=True)
            worker.start()
        selection = report["selection"]
        prefix = "/api/file/gis-project/" + "/".join(urllib.parse.quote(str(x), safe="")
            for x in (key, "review", selection["receipt_id"], report["id"])) + "/"
        raster_layers = [{"layer_id": row["layer_id"], "title": row["title"],
                          "units": row["units"], "view_path": (row.get("raster_view") or {}).get("path"),
                          "comparison": row["comparison"].get("comparison"),
                          "physical_available": bool(row["comparison"].get("difference"))}
                         for row in report["layers"] if row["kind"] == "raster"]
        request = {"schema": "upstate.gis-edition-review-browser-request/v1",
            "operation_id": OPERATION, "output_directory": str(browser_output),
            "workspace_key": key, "original_directory": str(folder),
            "reopened_directory": str(reopened),
            "report": {"id": report["id"], "receipt_id": selection["receipt_id"],
                       "export_id": selection["export_id"], "title": report["title"],
                       "layer_count": len(report["layers"]), "raster_layers": raster_layers,
                       "files": list(report["files"].values())},
            "locations": {"offline": (folder / "REVIEW.html").as_uri(),
                          "reopened": (reopened / "REVIEW.html").as_uri(),
                          "operator_origin": origin, "operator_url": operator_url,
                          "operator_review_path": prefix + "REVIEW.html"}}
        descriptor = os.open(request_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(request, stream, ensure_ascii=False, allow_nan=False)
        command = [node, str(application / "source_tools/receive_gis_edition_review_browser.mjs"),
                   "--request", str(request_path)]
        if playwright_module:
            command += ["--playwright-module", str(playwright_module)]
        # Browser output may contain an authenticated URL. Keep its log private;
        # returned source/result maps never carry the operator capability.
        log_path = browser_output / "browser-process.log"
        descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as log:
            completed = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT,
                                       timeout=timeout, check=False)
        result_path = browser_output / "result.json"
        if completed.returncode != 0:
            raise RuntimeError("The browser course reported an actual failure; inspect " + str(log_path))
        result = gis.load(result_path)
        if result.get("report_id") != report["id"]:
            raise ValueError("The browser result belongs to a different GIS review")
        for artifact in result.get("artifacts", []):
            gis.checked(browser_output, artifact)
        return {"directory": str(browser_output), "result": result,
                "result_file": gis.record(browser_output, result_path)}
    finally:
        request_path.unlink(missing_ok=True)
        if server is not None:
            if worker is not None:
                server.shutdown()
                worker.join(timeout=10)
            server.server_close()
            server.operator.close()


def receive(application, workspace, output, *, export_id=None, receipt_id=None,
            require_raster=False, inspect=False, native_only=False, node="node",
            playwright_module=None, operator_url_file=None, browser_timeout=900):
    application, output = Path(application).resolve(), Path(output).resolve()
    sys.path[:0] = [str(application / "operator"), str(application)]
    from model.workspace import Workspace
    from model import gis_project as gis, gis_edition_review as reviews
    workspace = Workspace(Path(workspace).resolve())
    if (output == workspace.root or workspace.root.is_relative_to(output)
            or output.is_relative_to(workspace.root)):
        raise ValueError("Keep receiving output in a separate sibling directory outside the scientific Workspace")
    if bool(export_id) != bool(receipt_id):
        raise ValueError("Supply both original export and received IDs, or select a retained compatible pair")
    output.mkdir(parents=True, exist_ok=True)
    journal_path, result_path = output / "receiving.json", output / "result.json"
    with gis.locked(output / ".receiving.lock"):
        choices = select_pairs(workspace, gis)
        gis.save(output / "pair-catalogue.json", choices)
        if inspect:
            return choices
        previous = gis.load(journal_path) if journal_path.exists() else {}
        if previous:
            selected = previous["selection"]
            if export_id and (export_id, receipt_id) != (selected["export_id"], selected["receipt_id"]):
                raise ValueError("This output already retains another pair; use its original IDs or a new output")
            export_id, receipt_id = selected["export_id"], selected["receipt_id"]
        elif not export_id:
            candidates = [row for row in choices["pairs"] if not require_raster or row["raster_layers"]]
            if not candidates:
                raise ValueError("No compatible retained " + ("raster " if require_raster else "") +
                                 "GIS pair exists here; actual pair-catalogue.json records the current Workspace")
            export_id, receipt_id = candidates[0]["export_id"], candidates[0]["receipt_id"]
        selection = {"export_id": export_id, "receipt_id": receipt_id,
                     "review_version": reviews.VERSION}
        original, received, binding = reviews._pair(workspace, selection)
        if require_raster and not any(row["data"]["kind"] == "raster" for row in received[2]["layers"]):
            raise ValueError("The selected actual pair has no raster layer; keep its vector result as a separate course")
        if previous and previous.get("binding") != binding:
            raise ValueError("The selected pair or installed review producer changed; preserve this output and use a new directory")
        state = previous or {"schema": SCHEMA, "operation_id": OPERATION,
            "project_id": workspace.project["id"], "workspace": str(workspace.root),
            "application": str(application), "selection": selection, "binding": binding,
            "created_at": timestamp(), "history": []}
        state["sources"] = source_map(application, gis)
        instructions = output / "instructions"
        instructions.mkdir(exist_ok=True)
        for name in ("AGENTS.md", "CURRENT_OWNER_DIRECTION.md"):
            source = gis.record(application, application / name)
            # A source change gets its own retained instruction edition.
            destination = instructions / source["sha256"] / name
            gis.copy_checked(application, source, destination)
        state["instruction_files"] = [gis.record(output, p) for p in sorted(instructions.rglob("*.md"))]
        state["state"] = "running"
        state.pop("error", None)
        gis.save(journal_path, state)

        def phase(name, action):
            started, clock = timestamp(), time.monotonic()
            item = {"phase": name, "started_at": started}
            state["history"].append(item)
            gis.save(journal_path, state)
            try:
                value = action()
                item["state"] = "complete"
                return value
            except Exception as exc:
                item["state"] = "failed"
                item["error"] = {"type": type(exc).__name__, "message": str(exc)}
                raise
            finally:
                item["finished_at"], item["elapsed_seconds"] = timestamp(), time.monotonic() - clock
                gis.save(journal_path, state)
        try:
            report = phase("native_review", lambda: reviews.review(workspace, selection))
            folder, verified = phase("read_complete_report", lambda:
                reviews.read(workspace, receipt_id, report["id"]))
            if verified["selection"] != binding:
                raise ValueError("Completed report does not preserve the chosen actual editions")
            reopened = output / "reopened" / report["id"]
            reopened_result = phase("reopen_complete_archive", lambda:
                reopen_archive(folder, verified, reopened, gis))
            # A fresh Workspace object reopens the original managed report as well.
            phase("reopen_managed_report", lambda: reviews.read(
                Workspace(workspace.root), receipt_id, report["id"]))
            artifacts = [{**rec, "absolute_path": str(folder / rec["path"])}
                         for rec in verified["files"].values()]
            state.update({"state": "native_complete", "review_id": report["id"],
                "report_directory": str(folder), "reopened": reopened_result,
                "artifacts": artifacts, "layer_summary": [
                    {key: row.get(key) for key in ("layer_id", "title", "kind", "units",
                                                 "working_files_changed")} |
                    {"comparison": row["comparison"].get("comparison"),
                     "counts": row["comparison"].get("counts", {}),
                     "raster_view": row.get("raster_view")}
                    for row in verified["layers"]],
                "producer_visual_inspection": "Open and LOOK at actual desktop and narrow screenshots, "
                    "the operator preview, reopened report and original downloadable files before client handoff."})
            gis.save(journal_path, state)
            gis.save(result_path, state)
            if not native_only:
                state["browser"] = phase("actual_browser_course", lambda:
                    browser_course(application, workspace, output, verified, folder, reopened, gis,
                        node=node, playwright_module=playwright_module,
                        operator_url_file=operator_url_file, timeout=browser_timeout))
                state["state"] = "browser_course_complete"
            state["finished_at"] = timestamp()
            gis.save(journal_path, state)
            gis.save(result_path, state)
            return state
        except Exception as exc:
            state["state"] = "failed"
            state["error"] = {"type": type(exc).__name__, "message": str(exc)}
            gis.save(journal_path, state)
            gis.save(result_path, state)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--export-id")
    parser.add_argument("--receipt-id")
    parser.add_argument("--require-raster", action="store_true")
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--native-only", action="store_true",
                        help="Retain native report/reopening for an existing separate browser worker")
    parser.add_argument("--node", default="node")
    parser.add_argument("--playwright-module")
    parser.add_argument("--operator-url-file", type=Path,
                        help="Private file holding the existing loopback operator login URL")
    parser.add_argument("--browser-timeout", type=float, default=900)
    args = parser.parse_args()
    if not 1 <= args.browser_timeout <= 86400:
        parser.error("Choose a finite browser timeout between 1 and 86400 seconds")
    result = receive(args.application, args.workspace, args.output,
        export_id=args.export_id, receipt_id=args.receipt_id, require_raster=args.require_raster,
        inspect=args.inspect, native_only=args.native_only, node=args.node,
        playwright_module=args.playwright_module, operator_url_file=args.operator_url_file,
        browser_timeout=args.browser_timeout)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()

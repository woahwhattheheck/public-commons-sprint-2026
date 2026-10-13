#!/usr/bin/env python3
"""Operate the original RFP Communities workspace, then reopen its delivered application."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
from model.common import file_digest, held, identifier
from model.workspace import Workspace
from model.communities import verify_plan_context
from model import portable

def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

original_receiving = module(APP / "operator/receiving.py", "upstate_original_receiving")
atomic = original_receiving.atomic
record = original_receiving.record
run_command = original_receiving.run_command

def browser(args, application, receipt, output, mode, attempt):
    private = output / "private"
    private.mkdir(exist_ok=True, mode=0o700)
    control = private / ("community-" + mode + ".json")
    atomic(control, {
        "operator_url": receipt["operator_url"], "workspace_key": receipt["workspace_key"],
        "output": str(output / "browser"), "node_modules": str(args.node_modules.resolve()),
        "chromium": str(args.chromium.resolve()), "python": sys.executable,
        "resume_failed_tasks": args.resume_failed_tasks, "source_revision": args.source_revision,
        "context": json.loads(args.context.read_text()) if args.context else {},
    })
    try:
        return run_command([str(args.node), str(application / "operator/community_receiving.mjs"),
                            "--control", str(control), "--mode", mode], attempt, mode + "-browser",
                           timeout=args.browser_timeout_seconds)
    finally:
        control.unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--context", type=Path,
                        help="Existing original source/grid/run/delivery selection for this same workspace")
    parser.add_argument("--node", required=True, type=Path)
    parser.add_argument("--node-modules", required=True, type=Path)
    parser.add_argument("--chromium", required=True, type=Path)
    parser.add_argument("--browser-timeout-seconds", type=int, default=1800)
    parser.add_argument("--resume-failed-tasks", action="store_true",
                        help="Resume the same retained task after its concrete source/input repair")
    args = parser.parse_args()
    for runtime in (args.node, args.chromium, args.node_modules / "playwright/index.mjs"):
        if not runtime.is_file():
            raise ValueError("Select the installed receiving runtime: " + str(runtime))
    if args.browser_timeout_seconds < 1:
        raise ValueError("The browser observation interval must be positive")
    os.umask(0o077)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    private = output / "private"
    private.mkdir(exist_ok=True, mode=0o700)
    manifest = APP / "source/communities-rfp-20261012/source-manifest.json"
    if not manifest.is_file():
        raise ValueError("Select the complete original Communities application and source")
    workspace_path = (args.workspace or output / "workspace").resolve()
    workspace = Workspace(workspace_path, create=True,
                          title="Upper Savannah utility and community work program")
    result_path = output / "community-receiving-result.json"
    with held(output / ".community-receiving.lock", blocking=False):
        previous = json.loads(result_path.read_text()) if result_path.exists() else None
        if previous and previous["workspace_id"] != workspace.project["id"]:
            raise ValueError("The retained receiving belongs to another original workspace")
        attempts = list(previous.get("attempts", [])) if previous else []
        attempt_number = max((row["number"] for row in attempts), default=0) + 1
        attempt = output / ("attempt-" + str(attempt_number).zfill(3))
        # Preserve an earlier directory whose process ended before journal publication.
        while attempt.exists():
            attempt_number += 1
            attempt = output / ("attempt-" + str(attempt_number).zfill(3))
        attempt.mkdir(exist_ok=False)
        attempts.append({"number": attempt_number, "source_revision": args.source_revision,
                         "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        result = {"schema": "upstate.community-receiving/v1", "complete": False,
                  "source_revision": args.source_revision, "workspace_id": workspace.project["id"],
                  "workspace_path": str(workspace.root), "source_manifest": record(manifest),
                  "attempts": attempts}
        atomic(result_path, result)
        server = None
        original_thread = None
        reopened = None
        try:
            progress_path = output / "browser/community-browser-progress.json"
            browser_result_path = output / "browser/community-browser-result.json"
            stage = json.loads(progress_path.read_text()) if progress_path.exists() else {}
            continue_delivered = (
                stage.get("project_id") == workspace.project["id"]
                and stage.get("operated_application_revision") == args.source_revision
                and stage.get("received") and stage.get("workspace_archive"))
            if not continue_delivered:
                server_module = module(APP / "operator/server.py", "upstate_community_operator")
                server, receipt = server_module.start_server(
                    workspace.root, state_directory=private / "original-operator",
                    source_manifests=[manifest], restore_directory=output / "received",
                    upload_limit=1024**3, extraction_limit=8*1024**3)
                original_thread = threading.Thread(target=server.serve_forever, daemon=True)
                original_thread.start()
                browser(args, APP, receipt, output, "operate", attempt)
                stage = json.loads(progress_path.read_text())
            operated = {name: identifier(stage.get(name + "_id") or stage.get(name, {}).get("id"))
                        for name in ("table", "initial_plan", "revised_plan", "report")}
            received = stage["received"]
            archive = stage["workspace_archive"]
            archive_path = Path(archive["path"])
            checked_archive = portable.inspect_archive(archive_path, verify=True)
            if checked_archive["project"]["id"] != workspace.project["id"]:
                raise ValueError("The browser's archive belongs to another original project")
            if archive_path.stat().st_size != archive["bytes"] or file_digest(archive_path) != archive["sha256"]:
                raise ValueError("The browser's downloaded workspace archive differs")
            application = Path(received["application"]).resolve(strict=True)
            received_workspace = Path(received["workspace"]).resolve(strict=True)
            expected_application = {
                "model/communities.py", "model/community_reports.py", "model/community_cli.py",
                "model/COMMUNITIES.md", "operator/web/community.mjs", "operator/web/community.css",
                "operator/community_receiving.py", "operator/community_receiving.mjs", "operator/server.py",
                "operator/web/app.mjs", "operator/web/journey.mjs",
                "operator/web/regional_journey.mjs", "operator/web/extension_host.mjs",
                "source/communities-rfp-20261012/rfp-table1.csv",
                "source/communities-rfp-20261012/source-manifest.json",
            }
            for relative in expected_application:
                path = application / relative
                if not path.is_file() or path.read_bytes() != (APP / relative).read_bytes():
                    raise ValueError("The delivered application differs: " + relative)
            if server is not None:
                server.shutdown()
                original_thread.join()
                server.server_close()
                server.operator.close()
                server = None
            cli_log = run_command([sys.executable, "-B", str(application / "model/cli.py"),
                                   "--workspace", str(received_workspace), "overview"],
                                  attempt, "delivered-cli", timeout=120)
            overview = json.loads(cli_log.read_text())
            if overview["project"]["id"] != workspace.project["id"]:
                raise ValueError("The delivered original CLI opened another workspace")
            def selected(kind, key):
                value = next((row for row in overview[kind] if row["id"] == key), None)
                if value is None:
                    raise ValueError("The received application lost its operated " + kind + " / " + key)
                return value
            table = selected("community_tables", operated["table"])
            if (table["source"]["source_id"] != "RFP_COMMUNITIES_2024_ACS"
                    or table["source"]["collection_id"] != stage["source"]["collection_id"]):
                raise ValueError("The delivered table differs from the operated original source edition")
            initial_plan = selected("community_plans", operated["initial_plan"])
            revised_plan = selected("community_plans", operated["revised_plan"])
            report = selected("community_reports", operated["report"])
            if (initial_plan["table_id"] != table["id"] or revised_plan["table_id"] != table["id"]
                    or revised_plan["previous_plan_id"] != initial_plan["id"]
                    or report["table_id"] != table["id"] or report["plan_id"] != revised_plan["id"]):
                raise ValueError("The delivered source/plan/revision/report lineage differs")
            total = table["summaries"]["all"]
            expected_totals = {"geoid_count": 17, "population_total": 27448, "households_total": 11001,
                               "poverty_households_total": 1014, "below_state_median_count": 10}
            if any(total[name] != value for name, value in expected_totals.items()):
                raise ValueError("The received RFP table totals differ from the complete original rows")
            restored = Workspace(received_workspace)
            for plan in (initial_plan, revised_plan):
                verify_plan_context(restored, plan)
            reopened = original_receiving.OperatorProcess(
                application, received_workspace, private / "received-operator",
                output / "received-again", attempt, "delivered", 1024)
            browser(args, application, reopened.receipt, output, "reopened", attempt)
            final_browser = json.loads(browser_result_path.read_text())
            if not final_browser.get("complete"):
                raise ValueError("The delivered original browser did not complete its reopening")
            result.update(
                complete=True, completed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                original_totals=expected_totals, community_table_id=table["id"],
                source_collection_id=stage["source"]["collection_id"],
                original_plan_ids=[initial_plan["id"], revised_plan["id"]],
                original_report_ids=[report["id"]],
                received=received, workspace_archive=archive,
                browser_result=record(browser_result_path), browser_progress=record(progress_path),
                delivered_cli=record(cli_log))
            attempts[-1]["complete"] = True
            atomic(result_path, result)
            print(json.dumps({"complete": True, "workspace_id": workspace.project["id"],
                              "result": record(result_path), "workspace_archive": archive,
                              "original_totals": expected_totals}), flush=True)
        except BaseException as error:
            attempts[-1]["complete"] = False
            result["error"] = {"type": type(error).__name__, "message": str(error)}
            for name in ("community-browser-result.json", "community-browser-progress.json"):
                path = output / "browser" / name
                if path.exists():
                    result[name.removesuffix(".json").replace("-", "_")] = record(path)
            atomic(result_path, result)
            raise
        finally:
            if server is not None:
                server.shutdown()
                if original_thread is not None:
                    original_thread.join()
                server.server_close()
                server.operator.close()
            if reopened is not None:
                reopened.close()

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""One complete original tourism browser, export and cold receiving operation."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import selectors
import shutil
import subprocess
import sys
import threading
import time
import traceback
import zipfile
from xml.etree import ElementTree

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    data = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()
    with path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    return sha(data)


def original_browser(requested):
    candidates = [requested, os.environ.get("CHROMIUM_EXECUTABLE"),
        "/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell",
        "/workspace/scratch/dba55fe4658b/kzfr-source-review/chromium/chrome-headless-shell-linux64/chrome-headless-shell",
        "/workspace/scratch/26b120a29715/clark-capacity-completed-operation/chromium"]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(Path(candidate).resolve())
    raise ValueError("Supply the existing complete Chromium executable with --chromium.")


class LiveWorkspace:
    def __init__(self, directory):
        from bi_operator.host import WorkspaceLease, Server
        from bi_operator.service import Service
        self.lease = WorkspaceLease(directory)
        self.lease.__enter__()
        self.service = None
        self.server = None
        self.thread = None
        try:
            self.service = Service(directory)
            self.server = Server(self.service)
            self.thread = threading.Thread(target=self.server.serve_forever,
                                           kwargs={"poll_interval": 0.1}, daemon=True)
            self.thread.start()
            self.url = "http://127.0.0.1:" + str(self.server.server_address[1]) + "/#token=" + self.service.store.setting("access_token")
        except Exception:
            self.close()
            raise

    def close(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None
        if self.thread:
            self.thread.join(timeout=10)
            self.thread = None
        if self.service:
            self.service.close()
            self.service = None
        if self.lease:
            self.lease.__exit__(None, None, None)
            self.lease = None


def inspect_reporting_package(filename, original_source):
    with zipfile.ZipFile(filename) as package:
        names = package.namelist()
        if len(names) != len(set(names)) or any(Path(n).is_absolute() or ".." in Path(n).parts for n in names):
            raise ValueError("The reporting package contains a duplicate or unsafe member.")
        manifest = json.loads(package.read("manifest.json"))
        if manifest["schema"] != "commons.tourism-export.v1":
            raise ValueError("The original export manifest differs.")
        for item in manifest["files"]:
            data = package.read(item["name"])
            if len(data) != item["bytes"] or sha(data) != item["sha256"]:
                raise ValueError("A retained member differs: " + item["name"])
        if set(names) != {"manifest.json", *(item["name"] for item in manifest["files"])}:
            raise ValueError("The manifest does not inventory the full reporting package.")
        report = json.loads(package.read("report.json"))
        period = json.loads(package.read("period.json"))
        source = report["sources"][0]
        prefix = "sources/" + source["id"] + "-r" + str(source["revision"]) + "/"
        if package.read(prefix + "original/record.json") != original_source:
            raise ValueError("The reserved-name original input did not retain its exact bytes.")
        retained_record = json.loads(package.read(prefix + "record.json"))
        if retained_record["kind"] != "tourism_source" or retained_record["payload"]["original"]["digest"] != sha(original_source):
            raise ValueError("Original source bytes overwrote their retained source record.")
        normalized = json.loads(package.read(prefix + "normalised.json"))
        if len(normalized["tables"]["collections"]) != 26 or len(normalized["tables"]["distributions"]) != 10 or len(normalized["tables"]["budgets"]) != 4:
            raise ValueError("The complete original public source tables were not retained.")
        observed = next(row for row in report["forecast"]["months"] if row["period"] == "2026-08")
        if observed["observed_minor"] != 152842331:
            raise ValueError("The original published August 2026 amount differs.")
        statuses = {(row["year"], row["status"]) for row in report["budgets"]}
        if statuses != {(2024, "ACTUAL"), (2025, "BUDGET"), (2025, "ESTIMATE"), (2026, "PROPOSED")}:
            raise ValueError("Original published budget status differs.")
        if report["cash"]["opening_cash_minor"] != 110178000 or report["cash"]["recorded_reserve_minor"] != 29300000 or report["cash"]["rows"]:
            raise ValueError("The proposed-budget opening basis or public cash coverage differs.")
        if period["payload"]["state"] != "FINALIZED" or sha(package.read("report.json")) != period["payload"]["report"]["digest"]:
            raise ValueError("The export did not retain its exact finalized report.")
        with zipfile.ZipFile(__import__("io").BytesIO(package.read("Tourism_Reporting.xlsx"))) as workbook:
            root = ElementTree.fromstring(workbook.read("xl/workbook.xml"))
            sheets = root.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheets/{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet")
            if len(sheets) != 11:
                raise ValueError("The complete operating workbook must contain eleven original schedules.")
            sheet_names = [sheet.attrib["name"] for sheet in sheets]
        quarters = json.loads(package.read("quarterly.json"))
        return {"files": len(names), "bytes": Path(filename).stat().st_size,
            "sha256": sha(Path(filename).read_bytes()), "manifest_sha256": sha(package.read("manifest.json")),
            "report_sha256": period["payload"]["report"]["digest"], "workbook_sheets": sheet_names,
            "source_counts": {name: len(rows) for name, rows in normalized["tables"].items()},
            "reported_budget_statuses": sorted([list(item) for item in statuses]),
            "forecast": {"known_through": report["plan"]["payload"]["as_of"],
                "months": len(report["forecast"]["months"]), "totals_minor": report["forecast"]["totals"],
                "factor": report["forecast"]["factor"], "historical_rows": len(report["forecast"]["backtest"]),
                "historical_wape": report["forecast"]["backtest_wape"],
                "source_differences": len(report["issues"])},
            "quarterly_rows": len(quarters), "source_filename_preserved": "record.json"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="Fresh private operation directory")
    parser.add_argument("--node", default=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node"))
    parser.add_argument("--chromium")
    args = parser.parse_args()
    output = Path(args.output).expanduser().resolve()
    if output.exists():
        if (output / "result.json").is_file():
            previous = json.loads((output / "result.json").read_text(encoding="utf-8"))
            if previous.get("state") == "COMPLETE":
                for key in ("reporting_package", "receiving_package"):
                    expected = previous["files"][key]
                    data = (output / expected["name"]).read_bytes()
                    if sha(data) != expected["sha256"]:
                        raise ValueError("The original completed output differs: " + expected["name"])
                print(json.dumps({"state": "COMPLETE", "reopened_original": True, "result": str(output / "result.json")}))
                return
        raise ValueError("Use the retained original operation or choose a fresh output directory.")
    output.mkdir(parents=True, mode=0o700)
    (output / "tmp").mkdir(mode=0o700)
    if not args.node:
        raise ValueError("Supply the existing installed Node executable with --node.")
    chromium = original_browser(args.chromium)
    initial = receiving = process = stderr = None
    stages = []
    try:
        initial = LiveWorkspace(output / "original-workspace")
        passphrase = "tourism-original-" + secrets.token_hex(20)
        source_path = ROOT / "examples/overland-park/public-source.json"
        source_bytes = source_path.read_bytes()
        configuration_path = ROOT / "examples/overland-park/operating-input.json"
        env = {**os.environ, "TMPDIR": str(output / "tmp")}
        stderr = (output / "browser.stderr.log").open("w", encoding="utf-8")
        process = subprocess.Popen([args.node, str(ROOT / "tools/tourism_browser_journey.mjs")],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr,
            text=True, encoding="utf-8", bufsize=1, env=env)
        def send(value):
            process.stdin.write(json.dumps(value) + "\n")
            process.stdin.flush()
        def await_phase(wanted, timeout=180):
            deadline = time.monotonic() + timeout
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while time.monotonic() < deadline:
                    if selector.select(timeout=min(5, max(0.1, deadline - time.monotonic()))):
                        line = process.stdout.readline()
                        if not line:
                            break
                        event = json.loads(line)
                        stage = {key: value for key, value in event.items() if key in
                            ("phase", "tables", "as_of", "issues", "files", "original_sha256", "report_sha256", "package_sha256", "browser_version")}
                        stages.append(stage)
                        print(json.dumps(stage), flush=True)
                        if event.get("phase") == wanted:
                            return event
                    elif process.poll() is not None:
                        break
            stderr.flush()
            raise RuntimeError("Original browser phase " + wanted + " did not complete. " +
                (output / "browser.stderr.log").read_text(encoding="utf-8")[-5000:])
        send({"url": initial.url, "output": str(output), "sourcePath": str(source_path),
              "configurationPath": str(configuration_path), "chromium": chromium, "passphrase": passphrase})
        produced = await_phase("INITIAL_COMPLETE")
        reporting = inspect_reporting_package(output / "Tourism_Reporting_Complete.zip", source_bytes)
        actions = json.loads((output / "browser-actions.private.json").read_text(encoding="utf-8"))
        export_request = next(item for item in reversed(actions) if item["action"] == "tourism.period.export")
        original_record = initial.service.store.get("tourism_export", produced["export"]["id"])
        if sha(initial.service.store.bytes(original_record["payload"]["package"]["digest"])) != reporting["sha256"]:
            raise ValueError("The downloaded report differs from the original saved package.")
        from bi_operator.tourism import parse_source, forecast
        signed_source = {"schema": "commons.tourism-source.v1", "currency": "USD", "minor_unit": 2,
            "tables": {"collections": [{"period": "2025-06", "amount": "-110.38", "jurisdiction": "ABILENE",
                "basis": "KDOR net collection (98%; state retains 2% administration)",
                "source_ref": "https://www.ksrevenue.gov/pdf/tgfy25.pdf#location=ABILENE&month=2025-06"}]}}
        signed = parse_source(json.dumps(signed_source).encode(), "original-signed-source.json", {})
        signed_row = signed["tables"]["collections"][0]
        if signed_row["amount_minor"] != -11038:
            raise ValueError("The original signed publisher adjustment did not survive source import.")
        signed_plan = {"start": "2025-07", "as_of": "2026-05", "method": "fixed_growth",
            "growth_bps": 0, "comparison_months": 6, "downside_bps": -500, "upside_bps": 500,
            "adjustments": [{"period": "2026-06", "amount_minor": 20000,
                "basis": "Explicit numerical sensitivity example; no actual cash or revenue event.",
                "source_ref": signed_row["source_ref"]}]}
        signed_forecast = forecast(signed_plan, {"2025-06": signed_row})
        signed_scenario = signed_forecast["months"][-1]
        if tuple(signed_scenario[key] for key in ("downside_minor", "base_minor", "upside_minor")) != (8410, 8962, 9514):
            raise ValueError("The original signed baseline reversed the named growth sensitivities.")
        signed_sensitivity = {"published_baseline_minor": -11038, "explicit_example_adjustment_minor": 20000,
            "downside_minor": 8410, "base_minor": 8962, "upside_minor": 9514,
            "source_ref": signed_row["source_ref"], "adjustment_is_assumption": True}
        initial.close()
        initial = None
        from bi_operator.archive import restore
        destination = output / "received-workspace"
        restore(output / "Tourism_Workspace.bi-backup", destination, passphrase)
        receiving = LiveWorkspace(destination)
        retained_source = receiving.service.store.get(produced["source"]["kind"], produced["source"]["id"], produced["source"]["revision"])
        if receiving.service.store.bytes(retained_source["payload"]["original"]["digest"]) != source_bytes:
            raise ValueError("The receiving workspace lost the original public source bytes.")
        replay = receiving.service.dispatch(export_request["action"], export_request["body"])
        if not replay["replayed"] or replay["record"]["id"] != produced["export"]["id"]:
            raise ValueError("The original completed export did not replay after cold restoration.")
        print(json.dumps({"phase": "ORIGINAL_BACKUP_RESTORED", "source_sha256": sha(source_bytes),
                          "saved_export_replayed": True}), flush=True)
        send({"phase": "COLD_REOPEN", "url": receiving.url})
        received = await_phase("COLD_COMPLETE", timeout=90)
        process.stdin.close()
        process.wait(timeout=20)
        if process.returncode:
            raise RuntimeError("The original browser exited with " + str(process.returncode))
        current = receiving.service.store.get(produced["period"]["kind"], produced["period"]["id"])
        old = receiving.service.store.get(produced["period"]["kind"], produced["period"]["id"], produced["period"]["revision"])
        if current["payload"]["state"] != "PREPARED" or old["payload"]["state"] != "FINALIZED" or current["payload"]["prior_finalized"]["revision"] != old["revision"]:
            raise ValueError("Receiving report history does not retain the finalized predecessor.")
        receiving_report = inspect_reporting_package(output / "Tourism_Reporting_Received.zip", source_bytes)
        if receiving_report["sha256"] != reporting["sha256"]:
            raise ValueError("The received reporting file differs from the original.")
        receiving.close()
        receiving = None
        names = ["Tourism_Reporting_Complete.zip", "Tourism_Reporting_Received.zip", "Tourism_Report.png"]
        file_info = {name: {"name": name, "bytes": (output / name).stat().st_size,
                           "sha256": sha((output / name).read_bytes())} for name in names}
        source_files = ["bi_operator/tourism.py", "bi_operator/tourism_export.py",
            "bi_operator/tourism_example.py", "bi_operator/service.py", "bi_operator/host.py",
            "web/tourism.js", "web/tourism.css", "web/app.js", "web/index.html",
            "examples/overland-park/public-source.json", "examples/overland-park/operating-input.json",
            "tools/tourism_operating_journey.py", "tools/tourism_browser_journey.mjs"]
        result = {"schema": "commons.tourism-native-operation.v1", "state": "COMPLETE",
            "operation": "ASTRA-D76C-OVERLAND-TOURISM-20261012",
            "runtime": {"python": sys.version.split()[0], "node": subprocess.check_output([args.node, "--version"], text=True).strip(),
                        "chromium": received["browser_version"]},
            "behaviors": ["original_source_upload_and_review", "fund_and_plan_staff_screens",
                "monthly_quarterly_forecast_and_source_controls", "exact_review_and_finalization",
                "workbook_and_full_original_source_download", "original_encrypted_workspace_backup",
                "cold_restore_and_saved_export_replay", "receiving_browser_reopen_and_unchanged_download"],
            "reporting": reporting, "signed_original_collection_preserved": True,
            "signed_baseline_sensitivity": signed_sensitivity,
            "original_filename_namespace_preserved": True, "browser_errors": [],
            "files": {"reporting_package": file_info[names[0]], "receiving_package": file_info[names[1]],
                      "screen": file_info[names[2]]},
            "source_files": [{"path": name, "bytes": (ROOT / name).stat().st_size,
                             "sha256": sha((ROOT / name).read_bytes())} for name in source_files]}
        digest = write_json(output / "result.json", result)
        print(json.dumps({"state": "COMPLETE", "result": str(output / "result.json"), "sha256": digest,
            "reporting": reporting, "files": result["files"]}), flush=True)
    except Exception as error:
        failure = {"state": "FAILED", "error": str(error), "completed_stages": stages,
                   "traceback": traceback.format_exc()}
        write_json(output / "failure.json", failure)
        print(json.dumps({"state": "FAILED", "error": str(error), "failure": str(output / "failure.json")}), flush=True)
        raise
    finally:
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
        if receiving:
            receiving.close()
        if initial:
            initial.close()
        if stderr:
            stderr.close()


if __name__ == "__main__":
    main()

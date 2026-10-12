#!/usr/bin/env python3
"""Operate actual PJM source editions through the original review, package and restored workspace."""
from __future__ import annotations
import argparse
import base64
from decimal import Decimal
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import selectors
import shutil
import subprocess
import sys
import time
import traceback
from urllib.request import Request, urlopen
from xml.etree import ElementTree
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.tourism_operating_journey import LiveWorkspace, original_browser
from bi_operator.load_forecast_sources import inspect_file, map_source, sheet_rows, strict_json, decimal, number, MAX_BYTES
from bi_operator.load_forecast_receive import inspect_delivery

OPERATION = "GRID-STRATEGIES-LOAD-FORECAST-REVIEW-20261012"
DATA_ROOT = "https://www.pjm.com/-/media/DotCom/library/reports-notices/load-forecast/"
CURRENT_SHA = "35083a04c6c423ff9cdc006b77dc46783e46e157b53ecd1db8982f54b30111c4"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def save_json(path, value):
    data = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()
    save(path, data)
    return sha(data)


def original_source(year, provided, directory):
    filename = str(year) + "-load-report-data.xlsx"
    url = DATA_ROOT + filename
    if provided:
        data = Path(provided).expanduser().resolve().read_bytes()
        method = "operator_supplied_original"
    else:
        with urlopen(Request(url, headers={"User-Agent": "Commons Load Analyst/1.0"}), timeout=30) as response:
            data = response.read(MAX_BYTES + 1)
        method = "original_publisher_download"
    if len(data) > MAX_BYTES:
        raise ValueError("The original workbook exceeds the supported complete-source size.")
    if year == 2026 and sha(data) != CURRENT_SHA:
        raise ValueError("The current publisher file differs from the source already inspected; review that new source edition before this operation.")
    inspection = inspect_file(data, filename)
    if inspection["format"] != "xlsx":
        raise ValueError("The publisher did not return its original XLSX workbook.")
    path = directory / filename
    save(path, data)
    identity = {"year": year, "url": url, "filename": filename, "bytes": len(data), "sha256": sha(data),
                "method": method, "sheets": len(inspection["sheets"])}
    save_json(directory / (str(year) + "-source.json"), identity)
    print(json.dumps({"phase": "ORIGINAL_SOURCE_RETAINED", **identity}), flush=True)
    return data, inspection, identity


def mappings_for(data, inspection, geographies):
    inventory = {sheet["name"]: sheet for sheet in inspection["sheets"]}
    result = []
    for geography in geographies:
        head = sheet_rows(data, inspection, geography, 1, 1, 5)
        # Use the reader's original row representation, never assumed workbook values.
        if isinstance(head, dict):
            rows = head["rows"]
            cells = rows[0]["cells"] if isinstance(rows[0], dict) else rows[0]
        else:
            cells = head[0]
        if [str(value).strip() for value in cells[:5]] != ["ZONE_NAME", "YEAR", "MONTH", "PEAK_MW", "ENERGY_GWH"]:
            raise ValueError("Review the original column mapping for " + geography + ".")
        result.append({"id": "energy-" + geography.lower().replace("_", "-"), "sheet": geography,
            "layout": "long", "first_row": 2, "last_row": inventory[geography]["rows"],
            "geography_column": 1, "period_column": 2, "month_column": 3, "value_column": 5, "aliases": {},
            "defaults": {"area": "PJM published area", "geography": geography, "metric": "energy",
                "signal": "forecast", "season": "monthly", "period_basis": "calendar_month",
                "single_year": "end", "unit": "GWh", "coincidence": "not_applicable",
                "basis": "Original published monthly energy forecast for this named area"}})
    return result


def inspect_complete(filename, originals):
    data = Path(filename).read_bytes()
    inspected, members = inspect_delivery(data)
    report = inspected["report"]
    for source in report["sources"]:
        p = source["payload"]
        original = originals[p["original"]["digest"]]
        prefix = "sources/" + source["id"] + "-r" + str(source["revision"]) + "/original/"
        selected = [raw for name, raw in members.items() if name.startswith(prefix)]
        if selected != [original]:
            raise ValueError("The complete original publisher bytes did not survive export.")
    for comparison in report["comparison"]:
        for side in ("baseline", "current"):
            row = comparison[side]
            if row is None:
                continue
            if (row["year_cell"][:1] != "B" or row["month_cell"][:1] != "C" or
                    row["period_label"] != row["source_year"] + "-" + str(int(row["source_month"])).zfill(2) or
                    Decimal(row["canonical_value"]) != Decimal(row["value"]) * 1000 or
                    row["canonical_unit"] != "MWh"):
                raise ValueError("The original split year/month or exact energy conversion differs.")
    with zipfile.ZipFile(io.BytesIO(members["Load_Forecast_Review.xlsx"])) as workbook:
        tree = ElementTree.fromstring(workbook.read("xl/workbook.xml"))
        ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
        sheets = [sheet.attrib["name"] for sheet in tree.find(ns + "sheets")]
        if len(sheets) != 10:
            raise ValueError("The complete analyst workbook must contain its ten original schedules.")
    return {"bytes": len(data), "sha256": sha(data), "files": len(members) + 1,
        "manifest_sha256": sha(json.dumps(inspected["manifest"], ensure_ascii=False, sort_keys=True,
            separators=(",", ":")).encode() + b"\n"),
        "report_sha256": inspected["manifest"]["report_sha256"],
        "summary": report["summary"], "workbook_sheets": sheets,
        "geographies": sorted({row["geography"] for row in report["comparison"]})}, inspected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="Fresh private directory; retain it for receiving continuation")
    parser.add_argument("--node", default=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node"))
    parser.add_argument("--chromium")
    parser.add_argument("--baseline-file", help="Complete original 2025 PJM load-report-data.xlsx, if already retained")
    parser.add_argument("--current-file", help="Complete original 2026 PJM load-report-data.xlsx, if already retained")
    args = parser.parse_args()
    output = Path(args.output).expanduser().resolve()
    if output.exists():
        prior = output / "result.json"
        if prior.is_file():
            saved_result = json.loads(prior.read_text())
            if saved_result.get("state") == "COMPLETE":
                for f in saved_result["files"].values():
                    data = (output / f["name"]).read_bytes()
                    if len(data) != f["bytes"] or sha(data) != f["sha256"]:
                        raise ValueError("The retained completed output differs: " + f["name"])
                print(json.dumps({"state": "COMPLETE", "reopened_original": True, "result": str(prior)}))
                return
        raise ValueError("Continue the retained operation or select a fresh private directory.")
    output.mkdir(parents=True, mode=0o700)
    (output / "tmp").mkdir(mode=0o700)
    initial = receiving = restored = process = stderr = None
    stages = []
    try:
        if not args.node:
            raise ValueError("Supply the original installed Node executable.")
        chromium = original_browser(args.chromium)
        baseline_bytes, baseline_inspection, baseline_identity = original_source(2025, args.baseline_file, output / "original-sources")
        current_bytes, current_inspection, current_identity = original_source(2026, args.current_file, output / "original-sources")
        shared = {s["name"] for s in baseline_inspection["sheets"]} & {s["name"] for s in current_inspection["sheets"]}
        geographies = [name for name in ("PJM_RTO", "PECO", "PL", "METED_FE_EAST") if name in shared]
        if not {"PJM_RTO", "PECO"}.issubset(geographies):
            raise ValueError("The original source editions do not contain the selected PJM and Pennsylvania-area sheets.")
        baseline_mapping = mappings_for(baseline_bytes, baseline_inspection, geographies)
        current_mapping = mappings_for(current_bytes, current_inspection, geographies)
        initial = LiveWorkspace(output / "original-workspace")
        def action(name, step, body):
            return initial.service.dispatch(name, {**body, "operation_id": "load-native-" + step, "actor": "Original PJM source review"})["record"]
        def source(year, data):
            uploaded = action("load.source.upload", str(year) + "-upload", {"filename": str(year) + "-load-report-data.xlsx",
                "base64": base64.b64encode(data).decode(), "label": "PJM " + str(year) + " original load forecast data",
                "publisher": "PJM Interconnection", "vintage": str(year) + " annual forecast",
                "published": "2025-01-24" if year == 2025 else "2026-01-14",
                "source_url": DATA_ROOT + str(year) + "-load-report-data.xlsx", "status": "annual_forecast"})
            return action("load.source.map", str(year) + "-map", {"id": uploaded["id"], "expected": uploaded["revision"],
                "mappings": baseline_mapping if year == 2025 else current_mapping})
        baseline = source(2025, baseline_bytes)
        baseline = action("load.source.accept", "2025-accept", {"id": baseline["id"], "expected": baseline["revision"],
            "note": "Reviewed the original selected PJM monthly energy tables, explicit YEAR/MONTH labels and complete source workbook.",
            "acknowledge_missing": True})
        current = source(2026, current_bytes)
        current_rows = strict_json(initial.service.store.bytes(current["payload"]["normalised"]["digest"]))["rows"]
        row = current_rows[0]
        packet = {"schema": "commons.load-forecast-source.v1", "rows": [{**row, "period": row["period_label"],
            "source_ref": current_identity["url"] + "#" + row["sheet"] + "!" + row["cell"]}]}
        packet_bytes = json.dumps(packet, ensure_ascii=False).encode()
        packet_source = action("load.source.upload", "packet-upload", {"filename": "record.json",
            "base64": base64.b64encode(packet_bytes).decode(), "label": "Structured view of one retained PJM observation",
            "publisher": "Local analyst view of the named PJM source cell", "vintage": "2026 source-cell view",
            "published": "2026-01-14", "source_url": packet["rows"][0]["source_ref"], "status": "annual_forecast"})
        packet_source = action("load.source.map", "packet-map", {"id": packet_source["id"], "expected": packet_source["revision"], "mappings": []})
        precise = "0.12345678901234567890123456789"
        if number(decimal(strict_json('{"value":' + precise + '}')["value"])) != precise:
            raise ValueError("The structured source lost its exact decimal digits.")
        try:
            decimal("1e-999999999")
        except ValueError:
            pass
        else:
            raise ValueError("An unbounded decimal exponent reached formatting.")
        print(json.dumps({"phase": "ORIGINAL_SOURCE_MAPPINGS_READY", "geographies": geographies,
            "baseline_rows": baseline["payload"]["row_count"], "current_rows": current["payload"]["row_count"],
            "split_period_cells": True, "exact_json_decimal": True}), flush=True)
        passphrase = "load-review-" + secrets.token_hex(20)
        stderr = (output / "browser.stderr.log").open("w", encoding="utf-8")
        process = subprocess.Popen([args.node, str(ROOT / "tools/load_forecast_browser_journey.mjs")],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, text=True, encoding="utf-8", bufsize=1,
            env={**os.environ, "TMPDIR": str(output / "tmp")})
        def send(value):
            process.stdin.write(json.dumps(value) + "\n")
            process.stdin.flush()
        def await_phase(wanted, timeout=240):
            deadline = time.monotonic() + timeout
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while time.monotonic() < deadline:
                    if selector.select(timeout=min(5, max(0.1, deadline - time.monotonic()))):
                        line = process.stdout.readline()
                        if not line:
                            break
                        event = json.loads(line)
                        stage = {key: event[key] for key in ("phase", "rows", "files", "package_sha256",
                            "report_sha256", "browser_version") if key in event}
                        stages.append(stage)
                        print(json.dumps(stage), flush=True)
                        if event.get("phase") == wanted:
                            return event
                    elif process.poll() is not None:
                        break
            stderr.flush()
            raise RuntimeError("Original browser phase " + wanted + " did not complete. " +
                (output / "browser.stderr.log").read_text()[-6000:])
        ref = lambda r: {k: r[k] for k in ("kind", "id", "revision")}
        send({"url": initial.url, "output": str(output), "chromium": chromium, "passphrase": passphrase,
            "baseline": ref(baseline), "current": ref(current), "packet": ref(packet_source)})
        produced = await_phase("INITIAL_COMPLETE")
        originals = {sha(baseline_bytes): baseline_bytes, sha(current_bytes): current_bytes}
        reporting, inspected = inspect_complete(output / "Load_Forecast_Review_Complete.zip", originals)
        original_export = initial.service.store.get("load_export", produced["export"]["id"])
        if original_export["payload"]["package"]["digest"] != reporting["sha256"]:
            raise ValueError("The browser download differs from the original saved export.")
        receiving = LiveWorkspace(output / "receiving-workspace")
        send({"phase": "RECEIVE_PACKAGE", "url": receiving.url})
        received = await_phase("RECEIVING_COMPLETE")
        receiving_report = strict_json(receiving.service.store.bytes(
            receiving.service.store.get("load_review", received["review"]["id"])["payload"]["report"]["digest"]))
        if receiving_report["comparison"] != inspected["report"]["comparison"]:
            raise ValueError("The original adopted source editions changed the prepared comparison.")
        actions = json.loads((output / "browser-actions.private.json").read_text())
        adoption_request = next(a for a in reversed(actions) if a["action"] == "load.delivery.adopt")
        initial.close()
        initial = None
        receiving.close()
        receiving = None
        from bi_operator.archive import restore
        restore(output / "Load_Analyst_Workspace.bi-backup", output / "restored-workspace", passphrase)
        restored = LiveWorkspace(output / "restored-workspace")
        replay = restored.service.dispatch(adoption_request["action"], adoption_request["body"])
        if not replay["replayed"] or ref(replay["record"]) != received["adopted"]:
            raise ValueError("Cold restoration did not replay the original completed adoption.")
        print(json.dumps({"phase": "ORIGINAL_BACKUP_RESTORED", "saved_adoption_replayed": True}), flush=True)
        send({"phase": "COLD_REOPEN", "url": restored.url})
        cold = await_phase("COLD_COMPLETE")
        process.stdin.close()
        process.wait(timeout=20)
        if process.returncode or cold["browser_errors"]:
            raise ValueError("The original receiving browser did not close cleanly.")
        names = {"reporting_package": "Load_Forecast_Review_Complete.zip",
            "receiving_package": "Load_Forecast_Review_Received.zip", "cold_package": "Load_Forecast_Review_Cold.zip",
            "review_screen": "Load_Forecast_Review.png", "receiving_screen": "Load_Forecast_Receiving.png"}
        file_info = {}
        for key, name in names.items():
            raw = (output / name).read_bytes()
            file_info[key] = {"name": name, "bytes": len(raw), "sha256": sha(raw)}
            if key.endswith("package") and sha(raw) != reporting["sha256"]:
                raise ValueError("The receiving or restored complete package differs.")
        restored.close()
        restored = None
        result = {"schema": "commons.load-forecast-native-operation.v1", "state": "COMPLETE", "operation": OPERATION,
            "runtime": {"python": sys.version.split()[0],
                "node": subprocess.check_output([args.node, "--version"], text=True).strip(), "chromium": cold["browser_version"]},
            "behaviors": ["original_pjm_workbook_and_split_year_month_mapping", "mapped_packet_visible_in_staff_screen",
                "saved_source_and_mapping_draft_identity", "native_analyst_plan_review_and_finalization",
                "complete_ten_sheet_workbook_and_exact_original_sources", "fresh_package_receive_and_editable_source_adoption",
                "encrypted_backup_cold_restore_and_original_adoption_replay", "restored_staff_plan_edit_and_unchanged_delivery"],
            "reporting": reporting, "sources": [baseline_identity, current_identity], "files": file_info,
            "browser_errors": cold["browser_errors"]}
        result_sha = save_json(output / "result.json", result)
        print(json.dumps({"state": "COMPLETE", "result": str(output / "result.json"), "sha256": result_sha,
            "reporting": reporting, "files": file_info}), flush=True)
    except Exception as error:
        failure = {"state": "FAILED", "error": str(error), "completed_stages": stages, "traceback": traceback.format_exc()}
        save_json(output / "failure.json", failure)
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
        for host in (restored, receiving, initial):
            if host:
                host.close()
        if stderr:
            stderr.close()


if __name__ == "__main__":
    main()

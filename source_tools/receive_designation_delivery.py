#!/usr/bin/env python3
"""Receive original water selections and build their complete native delivery.

Uses the existing public-water, utility, river, delivery and optional browser
commands in one actual model Workspace. Every issued command and its output is
retained. Re-running the same input resumes through those engines' saved objects.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

APPLICATION = Path(__file__).resolve().parents[1]
PUBLIC_SOURCE = "source/water_context/20261012/public-water"
RIVER_SOURCE = "source/water-designations-case"
PROTECTION_NAME = "raw/scdes-arjws-prwd-source-water-protection-original.json"
PROTECTION_SHA = "ddac0feb1c704ca5e95336e21961e08beede1f83b6b820423dffa5a63bd8e285"
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))
from model.common import held


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path,
                        help="Existing native model Workspace with the selected completed runs.")
    parser.add_argument("--delivery", required=True, type=Path,
                        help="Complete existing native delivery selection, including actual source roles.")
    parser.add_argument("--output", required=True, type=Path,
                        help="Retained operation directory; the same input reuses its request subdirectory.")
    parser.add_argument("--public-sources", type=Path, default=APPLICATION / PUBLIC_SOURCE)
    parser.add_argument("--river-sources", type=Path, default=APPLICATION / RIVER_SOURCE)
    parser.add_argument("--operator-start", type=Path,
                        help="Existing operator startup JSON for this model Workspace; adds browser receiving.")
    parser.add_argument("--workspace-key",
                        help="Actual registered model Workspace key when the operator exposes several.")
    parser.add_argument("--browser", type=Path,
                        help="Existing Chromium executable for the optional browser journey.")
    parser.add_argument("--playwright-path", type=Path,
                        help="Existing Playwright Python package path for the optional browser journey.")
    parser.add_argument("--timeout-seconds", type=int, default=1800,
                        help="Native delivery wait in the optional browser journey.")
    args = parser.parse_args(argv)
    workspace = args.workspace.resolve()
    delivery_path = args.delivery.resolve()
    public_sources = args.public_sources.resolve()
    river_sources = args.river_sources.resolve()
    if not workspace.is_dir():
        parser.error("--workspace must be the existing model Workspace directory.")
    if args.timeout_seconds < 1:
        parser.error("--timeout-seconds must be positive.")
    if any((args.workspace_key, args.browser, args.playwright_path)) and not args.operator_start:
        parser.error("Browser options require the original --operator-start file.")
    if args.operator_start and not args.operator_start.resolve().is_file():
        parser.error("--operator-start must be the retained startup JSON from the actual operator.")
    input_bytes = delivery_path.read_bytes()
    original_delivery = json.loads(input_bytes.decode("utf-8-sig"))
    if not isinstance(original_delivery, dict) or not original_delivery.get("baseline_run_id"):
        parser.error("--delivery must retain its actual baseline_run_id and complete native choices.")
    protection_path = public_sources / PROTECTION_NAME
    if sha256(protection_path) != PROTECTION_SHA:
        raise ValueError("Use the retained original four-polygon protection source edition.")

    identity = {
        "workspace": str(workspace),
        "delivery_sha256": hashlib.sha256(input_bytes).hexdigest(),
        "public_manifest_sha256": sha256(public_sources / "sources.public-native.json"),
        "river_source_sha256": sha256(river_sources / "chattooga_chauga_classified_water.geojson"),
    }
    key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode("utf-8")).hexdigest()[:20]
    output = args.output.resolve() / ("request-" + key)
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".designation-delivery-operation.lock", blocking=False):
        journal_path = output / "designation-delivery-operation.json"
        journal = read_json(journal_path) if journal_path.exists() else {
            "schema": "upstate.designation-delivery-operation/v1",
            "id": key, "created_at": now(), "identity": identity, "attempts": [],
        }
        if journal.get("identity") != identity:
            raise ValueError("The retained operation belongs to different original inputs.")
        attempt = {
            "started_at": now(), "state": "running",
            "application": str(APPLICATION), "python": sys.executable,
            "input_delivery": str(delivery_path), "steps": [],
        }
        journal["attempts"].append(attempt)
        journal["state"] = "running"
        write_json(journal_path, journal)
        logs = output / ("attempt-" + str(len(journal["attempts"])).zfill(3))
        logs.mkdir()
        delivery_copy = logs / "input-delivery.json"
        delivery_copy.write_bytes(input_bytes)

        def run_stage(name, filename, arguments, result_path):
            script = APPLICATION / "source_tools" / filename
            command = [sys.executable, "-B", str(script), *map(str, arguments)]
            row = {
                "name": name, "state": "running", "started_at": now(),
                "command": command, "script_sha256": sha256(script),
                "stdout": str(logs / (name + ".stdout.json")),
                "stderr": str(logs / (name + ".stderr.txt")),
                "result": str(result_path),
            }
            attempt["steps"].append(row)
            write_json(journal_path, journal)
            print(json.dumps({"stage": name, "state": "running", "journal": str(journal_path)}),
                  file=sys.stderr, flush=True)
            with Path(row["stdout"]).open("wb") as stdout, Path(row["stderr"]).open("wb") as stderr:
                result = subprocess.run(command, cwd=APPLICATION, stdout=stdout, stderr=stderr)
            row["returncode"] = result.returncode
            row["finished_at"] = now()
            row["state"] = "running" if result.returncode == 0 else "failed"
            write_json(journal_path, journal)
            if result.returncode:
                raise RuntimeError(name + " failed; retained native stderr: " + row["stderr"])
            value = read_json(result_path)
            row["result_sha256"] = sha256(result_path)
            row["state"] = "complete"
            write_json(journal_path, journal)
            print(json.dumps({"stage": name, "state": "complete", "result": str(result_path)}),
                  file=sys.stderr, flush=True)
            return value

        public_out = output / "public-water"
        utility_out = output / "utility-designations"
        river_out = output / "river-receiving"
        river_workspace = output / "river-workspace"
        delivery_out = output / "native-delivery"
        try:
            public = run_stage("public-water", "prepare_public_source_water.py", [
                "--model-root", APPLICATION, "--workspace", workspace,
                "--source-dir", public_sources, "--out", public_out,
            ], public_out / "public-water-preparation.json")
            utility = run_stage("utility-designations", "prepare_utility_designations.py", [
                "--model-root", APPLICATION, "--workspace", workspace,
                "--preparation", public_out / "public-water-preparation.json", "--out", utility_out,
            ], utility_out / "utility-designations.json")
            river = run_stage("river-receiving", "receive_water_designations.py", [
                "--sources", river_sources, "--workspace", river_workspace, "--output", river_out,
            ], river_out / "water-designation-receiving.json")
            river_selection = (Path(river["workspace"]) / "water-designations"
                               / river["selection_id"] / "selection.json")
            delivery = run_stage("native-delivery", "prepare_designation_delivery.py", [
                "--workspace", workspace, "--delivery", delivery_copy,
                "--source-manifest", river_out / "intake/sources.json",
                "--selection", river_selection,
                "--selection", utility_out / "both-utilities.selection.json",
                "--output", delivery_out, "--build-delivery",
            ], delivery_out / "designation-delivery-receiving.json")
            if delivery.get("delivery", {}).get("state") != "complete":
                raise ValueError("The original delivery engine did not complete this selected build.")
            result = {
                "schema": "upstate.designation-delivery-operation-result/v1",
                "operation_id": key, "operation_directory": str(output),
                "workspace": str(workspace), "journal": str(journal_path),
                "public_water_plan_id": public["plan_id"],
                "utility_selection_ids": {name: item["selection_id"]
                                          for name, item in utility["cases"].items()},
                "original_river_selection_id": river["selection_id"],
                "delivery_selection": delivery["delivery_selection"],
                "source_records": delivery["source_records"],
                "final_selections": delivery["final_selections"],
                "delivery": delivery["delivery"],
            }
            if args.operator_start:
                browser_out = output / "browser"
                browser_args = [
                    "--operator-start", args.operator_start.resolve(),
                    "--native-result", river_out / "water-designation-receiving.json",
                    "--source-geojson", river_sources / "chattooga_chauga_classified_water.geojson",
                    "--application", APPLICATION, "--output", browser_out,
                    "--delivery-selection", delivery_out / "delivery-selection.json",
                    "--require-delivery-form", "--timeout-seconds", args.timeout_seconds,
                ]
                for flag, value in (("--workspace-key", args.workspace_key),
                                    ("--browser", args.browser),
                                    ("--playwright-path", args.playwright_path)):
                    if value is not None:
                        browser_args.extend([flag, value.resolve() if isinstance(value, Path) else value])
                run_stage("browser", "receive_water_designations_browser.py", browser_args,
                          browser_out / "water-designation-browser.json")
                result["browser_result"] = str(browser_out / "water-designation-browser.json")
            result_path = output / "designation-delivery-result.json"
            write_json(result_path, result)
            attempt.update({"state": "complete", "finished_at": now(),
                            "result": str(result_path), "result_sha256": sha256(result_path)})
            journal["state"] = "complete"
            write_json(journal_path, journal)
            print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
            return 0
        except BaseException as error:
            attempt.update({"state": "interrupted" if isinstance(error, KeyboardInterrupt) else "failed",
                            "finished_at": now(), "error": type(error).__name__ + ": " + str(error)})
            for step in attempt["steps"]:
                if step["state"] == "running":
                    step.update({"state": attempt["state"], "finished_at": now(),
                                 "error": attempt["error"]})
            journal["state"] = attempt["state"]
            write_json(journal_path, journal)
            raise


if __name__ == "__main__":
    raise SystemExit(main())

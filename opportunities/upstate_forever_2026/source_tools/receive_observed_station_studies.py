#!/usr/bin/env python3
"""Resume the original nine observed-station studies in the existing regional project.

Run with the received application's verified Python/GIS environment. Each study
uses the maintained prepared_studies/operate APIs in its own Python process.
Original manifest data can live outside the application via --source-root.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import traceback

PROJECT_ID = "b9d5d257-c6bb-4f07-b975-8e8c63705db3"
OPERATION = "ECO-SCI-ROOT-OBSERVED-STATIONS-20261013"
SCHEMA = "upstate.observed-station-course/v1"
RECIPE_SHA256 = "09a115bf5b7341fcc2f1d0f80a58d6cc7cf5017fda454ea2e1f8744a2655143a"
STUDIES = (
    ("upper-savannah-usgs-inventory-67", 67),
    ("upper-savannah-usgs-observed-17", 17),
    ("eighteenmile-lake-study-5", 5),
    ("eighteenmile-observed-context-agency-10", 10),
    ("eighteenmile-observed-context-network-10", 10),
    ("huc05-07-calibration-gauges-13-nwis", 13),
    ("huc05-07-calibration-gauges-13-nldi", 13),
    ("upper-savannah-usgs-flow-29", 29),
    ("upper-savannah-usgs-observed-30", 30),
)
MANIFESTS = (
    "observations/station_context.sources.json",
    "calibration_station_geography.sources.json",
    "regional_station_context.sources.json",
    "observations/wbd_station_join_20261013/station-context.sources.json",
)
REPLAYS = (
    "observations/wbd_station_join_20261013/rebuild.mjs",
    "observations/wbd_station_join_20261013/rebuild_station_context.mjs",
)
MODULES = (
    "model/observed_station_studies.py", "model/observed_station_studies.json",
    "model/station_study.py", "model/station_geography.py",
    "model/station_wbd_context.py",
)


def now():
    return datetime.now(timezone.utc).isoformat()


def identity(path):
    data = Path(path).read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def write_json(path, value, *, immutable=False):
    from model.common import atomic_json
    atomic_json(path, value, immutable=immutable)


def read_json(path):
    with Path(path).open(encoding="utf-8") as stream:
        return json.load(stream)


def original_catalogue(workspace):
    from model.observed_station_studies import prepared_studies, specification
    recipes = specification()["studies"]
    if [(r["id"], len(r["sites"])) for r in recipes] != list(STUDIES):
        raise ValueError("The retained nine-study recipe IDs, order or original counts changed")
    studies = prepared_studies(workspace)
    if [(s["id"], s["source_summary"]["station_count"]) for s in studies] != list(STUDIES):
        raise ValueError("The prepared catalogue differs from the original nine-study course")
    problems = {}
    for study, recipe in zip(studies, recipes):
        summary, selection = study["source_summary"], study["selection"]
        missing = list(study["missing"]) + list(summary.get("station_context_missing", []))
        if not study["ready"]:
            missing.append("Original required sources are not ready")
        if summary["watershed_count"] != 217:
            missing.append("The original 217-watershed domain is missing")
        expected_context = [specification()["sources"][key]["sha256"]
                            for key in recipe.get("site_tables", [])]
        actual_context = [ref.get("source_sha256") for ref in selection["site_tables"]]
        if actual_context != expected_context:
            missing.append("Original WBD context source selection differs")
        if missing:
            problems[study["id"]] = missing
    if problems:
        raise ValueError(json.dumps({"original_source_problems": problems}, ensure_ascii=False))
    return studies


def child(args, app, output):
    from model.workspace import Workspace
    from model.observed_station_studies import operate
    workspace = Workspace(args.workspace)
    if workspace.project["id"] != PROJECT_ID:
        raise ValueError("Open the original b9d5 regional Workspace")
    requested = read_json(output / "request.json")
    if requested["project_id"] != PROJECT_ID or requested["operation"] != OPERATION:
        raise ValueError("The retained receiving request belongs to another operation")
    selected = next(s for s in original_catalogue(workspace) if s["id"] == args.study_id)
    original = next(s for s in read_json(output / "nine-study-catalog.json")
                    if s["id"] == args.study_id)
    if selected != original:
        raise ValueError("The original prepared selection changed before study execution")
    receiving = Workspace(output / "station-geography-received", create=True,
                          title="Upper Savannah received original station studies")
    result = operate(workspace, args.study_id, receiving_workspace=receiving)
    if (not result["study"]["ready"] or result["study"] != original
            or result["workspace"]["project_id"] != PROJECT_ID
            or "edition" not in result or "received" not in result
            or result["received"]["workspace"]["project_id"] == PROJECT_ID):
        raise ValueError("The operated study did not retain independent original receiving")
    # operate() inspects both editions, verifies the original ZIP, and compares
    # every portable station/geometry/observation fact and complete summary.
    write_json(output / (args.study_id + ".json"), result)
    print(json.dumps({"state": "complete", "study_id": args.study_id,
                      "edition_id": result["edition"]["id"],
                      "received_edition_id": result["received"]["edition"]["id"],
                      "archive": result["archive"]}, ensure_ascii=False), flush=True)
    return 0


def run_logged(command, cwd, path, progress, progress_path, lock_fd):
    with path.open("ab") as log:
        log.write(("\n--- " + now() + " ---\n").encode("utf-8"))
        log.flush()
        process = subprocess.Popen(command, cwd=cwd, stdout=log,
                                   stderr=subprocess.STDOUT, pass_fds=(lock_fd,))
        progress.update(child_pid=process.pid, command=command,
                        current_log=str(path), updated_at=now())
        write_json(progress_path, progress)
        print(json.dumps({"state": progress["state"], "study_id": progress.get("study_id"),
                          "pid": process.pid, "log": str(path)}, ensure_ascii=False), flush=True)
        code = process.wait()
    if code:
        with path.open("rb") as stream:
            stream.seek(max(0, path.stat().st_size - 16000))
            tail = stream.read().decode("utf-8", errors="replace")
        print(tail, file=sys.stderr, flush=True)
        raise RuntimeError("Native command exited " + str(code) + "; original log: " + str(path))
    progress.pop("child_pid", None)


def receive(args, app, source_root, output):
    from model.workspace import Workspace
    from model.station_study import _import_once
    from model.common import digest
    workspace = Workspace(args.workspace)
    if workspace.project["id"] != PROJECT_ID:
        raise ValueError("Preserve the existing original project " + PROJECT_ID)
    if identity(app / "model/observed_station_studies.json")["sha256"] != RECIPE_SHA256:
        raise ValueError("Install the original nine-study recipe edition before receiving")
    # Bind executable consumers and exact original manifests, not host paths.
    request = {
        "schema": SCHEMA, "operation": OPERATION, "project_id": PROJECT_ID,
        "studies": [{"id": key, "stations": count} for key, count in STUDIES],
        "runner": identity(Path(__file__).resolve()),
        "modules": {name: identity(app / name) for name in MODULES},
        "manifests": {name: identity(source_root / name) for name in MANIFESTS},
        "source_replays": {name: identity(source_root / name) for name in REPLAYS},
    }
    request["id"] = digest(request)
    original = output / "request.json"
    if original.exists():
        if read_json(original) != request:
            raise ValueError("Preserve this output's original receiving request; choose a new owned output for changed source")
    elif any(p.name != "receiving.lock" for p in output.iterdir()):
        raise ValueError("Choose an empty output directory or this operation's retained output")
    write_json(original, request, immutable=True)
    progress_path = output / "progress.json"
    prior = read_json(progress_path) if progress_path.exists() else {}
    progress = {"schema": SCHEMA, "operation": OPERATION, "request_id": request["id"],
                "project_id": PROJECT_ID, "application": str(app),
                "source_root": str(source_root), "workspace": str(workspace.root),
                "output": str(output), "started_at": prior.get("started_at", now()),
                "state": "source-replay", "completed": prior.get("completed", []),
                "updated_at": now()}
    output.joinpath("logs").mkdir(exist_ok=True)
    lock_fd = args.lock_fd
    try:
        node = shutil.which("node")
        if not node:
            raise RuntimeError("Use the already accepted original Node/Python/GIS runtime; node is unavailable")
        for relative in REPLAYS:
            run_logged([node, str(source_root / relative), "--check"], source_root,
                       output / "logs" / (Path(relative).stem + ".log"),
                       progress, progress_path, lock_fd)
        imported = [_import_once(workspace, source_root / name)["id"] for name in MANIFESTS]
        studies = original_catalogue(workspace)
        write_json(output / "nine-study-catalog.json", studies, immutable=True)
        write_json(output / "source-import.json",
                   {"request_id": request["id"], "collection_ids": imported}, immutable=True)
        for key, count in STUDIES:
            progress.update(state="running", study_id=key, expected_stations=count, updated_at=now())
            command = [sys.executable, str(Path(__file__).resolve()),
                       "--application", str(app), "--workspace", str(workspace.root),
                       "--output", str(output), "--source-root", str(source_root),
                       "--study-id", key, "--child"]
            run_logged(command, app, output / "logs" / (key + ".log"),
                       progress, progress_path, lock_fd)
            result = read_json(output / (key + ".json"))
            completed = {"study_id": key, "stations": count,
                         "edition_id": result["edition"]["id"],
                         "received_edition_id": result["received"]["edition"]["id"],
                         "result": {"path": key + ".json", **identity(output / (key + ".json"))}}
            progress["completed"] = [r for r in progress["completed"] if r["study_id"] != key] + [completed]
            progress.update(state="study-complete", updated_at=now())
            write_json(progress_path, progress)
        progress.update(state="complete", completed_at=now(), updated_at=now())
        progress.pop("study_id", None)
        progress.pop("expected_stations", None)
        write_json(progress_path, progress)
        write_json(output / "result.json", progress)
        print(json.dumps(progress, ensure_ascii=False, indent=2), flush=True)
        return 0
    except BaseException as error:
        progress.update(state="interrupted" if isinstance(error, KeyboardInterrupt) else "failed",
                        error_type=type(error).__name__, error=str(error), updated_at=now())
        write_json(progress_path, progress)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-root", help="Complete retained original source tree; defaults to application")
    parser.add_argument("--study-id", choices=[key for key, unused in STUDIES], help=argparse.SUPPRESS)
    parser.add_argument("--child", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    app = Path(args.application).resolve(strict=True)
    workspace = Path(args.workspace).resolve(strict=True)
    source_root = Path(args.source_root or app).resolve(strict=True)
    output = Path(args.output).resolve()
    if any(output == root or output.is_relative_to(root) or root.is_relative_to(output)
           for root in (app, workspace, source_root)):
        raise ValueError("Keep the owned receiving output separate from the application, original Workspace and source tree")
    sys.path.insert(0, str(app))
    if args.child:
        if not args.study_id or not output.is_dir():
            raise ValueError("The child needs the original retained study and output")
        return child(args, app, output)
    if args.study_id:
        parser.error("--study-id is an internal child argument")
    output.mkdir(parents=True, exist_ok=True)
    fd = os.open(output / "receiving.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        args.lock_fd = fd
        return receive(args, app, source_root, output)
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

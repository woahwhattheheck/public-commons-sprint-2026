#!/usr/bin/env python3
"""Run a frozen public comparison serially inside one existing compute allocation."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "runner"))
from run_recorded import ENVIRONMENT_KEYS
from compare_native import compare

SCHEMA = "tjlabs.l2d.serial-phase/v1"


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def atomic_json(path, value, *, create=False):
    path = Path(path)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".phase-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(canonical(value))
            stream.flush()
            os.fsync(stream.fileno())
        if create:
            os.link(temporary, path)
        else:
            os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def read(path):
    return json.loads(Path(path).read_text())


def freeze(args):
    sources, plan = read(ROOT / "SOURCES.json"), read(ROOT / "RUN_PLAN.json")
    phases = {value["id"]: value for value in plan["phases"]}
    phase = phases[args.phase]
    candidates = {value["id"]: value for value in sources["candidates"]}
    required = phase["candidates"]
    if isinstance(required, list):
        selected = required
        if args.candidate and args.candidate != selected:
            raise ValueError("The matched-development phase retains all four original selected sources")
    else:
        selected = args.candidate
        if not selected or len(selected) != 2 or len(set(selected)) != 2:
            raise ValueError("Select two distinct frozen --candidate IDs for this broader phase")
    if any(value not in candidates for value in selected) or args.baseline not in selected:
        raise ValueError("Every selected source and the baseline must belong to this frozen phase")
    pinned = {
        "SOURCES.json": sha(ROOT / "SOURCES.json"),
        "RUN_PLAN.json": sha(ROOT / "RUN_PLAN.json"),
        "run_phase.py": sha(__file__), "compare_native.py": sha(ROOT / "compare_native.py"),
        sources["native_runner"]["path"]: sources["native_runner"]["sha256"],
        sources["runtime_capture"]["path"]: sources["runtime_capture"]["sha256"],
        sources["runtime_capture"]["cpu_launcher"]: sources["runtime_capture"]["cpu_launcher_sha256"],
    }
    for key in selected:
        candidate = candidates[key]
        pinned[candidate["submission"]] = candidate["submission_sha256"]
        pinned[candidate["requirements"]] = candidate["requirements_sha256"]
    for name, expected in pinned.items():
        if sha(ROOT / name) != expected:
            raise ValueError("Frozen source differs: " + name)
    cells = []
    # Interleave methods within each topology, retaining the original order.
    for topology in phase["public_topology_seeds"]:
        for seed in phase["algorithm_seeds"]:
            for key in selected:
                cells.append({"id": f"{key}-t{topology}-s{seed}-{phase['max_time_seconds']}",
                              "candidate": key, "submission": candidates[key]["submission"],
                              "topology_seed": topology, "algorithm_seed": seed,
                              "max_time_seconds": phase["max_time_seconds"]})
    return sources, {"schema": SCHEMA, "phase": args.phase, "baseline": args.baseline,
                     "candidates": selected, "cells": cells, "source_sha256": pinned,
                     "container_cap_seconds": phase.get("container_cap_seconds", 16200),
                     "physics": plan["common_objective"]}


def executable(value):
    found = shutil.which(value)
    if not found:
        raise ValueError("Select an existing equipped Python executable")
    return str(Path(found).absolute())


def command_for(cell, intent, cell_root):
    native = ["--candidate", str(ROOT / cell["submission"]),
              "--topology-seed", str(cell["topology_seed"]),
              "--algorithm-seed", str(cell["algorithm_seed"]),
              "--seconds", str(cell["max_time_seconds"]),
              "--out", str(cell_root / "native.json")]
    environment = dict(os.environ)
    cache = str(Path(intent["runtime"]["cache_dir"]) / cell["id"])
    if intent["runtime"]["mode"] == "cpu":
        environment.update(L2D_PYTHON=intent["runtime"]["python"],
                           L2D_CPUS=intent["runtime"]["cpu_affinity"],
                           L2D_CPU_CACHE_DIR=cache)
        command = ["bash", str(ROOT / "runner/run_recorded_cpu.sh"), *native]
    else:
        environment.update(JAX_COMPILATION_CACHE_DIR=cache,
                           JAX_COMPILATION_CACHE_MAX_SIZE="134217728",
                           JAX_PERSISTENT_CACHE_MIN_COMPILE_TIME_SECS="1")
        command = [intent["runtime"]["python"], str(ROOT / "runner/run_recorded.py"), "--", *native]
    return command, environment


def terminate_owned(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def execute_cell(cell, intent, directory, lock_descriptor, cancelled):
    cell_root = directory / "cells" / cell["id"]
    cell_root.mkdir(parents=True, exist_ok=True)
    completion = cell_root / "completion.json"
    if completion.exists():
        return read(completion)
    attempt = cell_root / "attempt.json"
    if attempt.exists():
        # A surviving child inherits the phase lock, preventing this branch until
        # it ends. A prior launch is never silently replayed or scored as a win.
        outcome = {"cell": cell["id"], "state": "interrupted_previous_attempt",
                   "observed_at": now(), "native_report_exists": (cell_root / "native.json").exists()}
        atomic_json(completion, outcome, create=True)
        return outcome
    for name, expected in intent["source_sha256"].items():
        if sha(ROOT / name) != expected:
            raise ValueError("Source changed before the next native cell: " + name)
    if sha(intent["runtime"]["python"]) != intent["runtime"]["python_sha256"]:
        raise ValueError("Selected Python changed during this retained phase")
    cache = Path(intent["runtime"]["cache_dir"]) / cell["id"]
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.mkdir(mode=0o700)
    cache_identity = (cache.stat().st_dev, cache.stat().st_ino)
    command, environment = command_for(cell, intent, cell_root)
    started_at = now()
    atomic_json(attempt, {"cell": cell, "started_at": started_at, "command": command,
                          "container_cap_seconds": intent["container_cap_seconds"],
                          "compilation_cache": {"path": str(cache), "initial_state": "new_empty_directory",
                                                "max_bytes": 134217728}}, create=True)
    print(json.dumps({"event": "native_cell_start", "cell": cell["id"], "at": started_at}), flush=True)
    process, reason, code = None, None, None
    try:
        with (cell_root / "console.log").open("xb", buffering=0) as console:
            # A process group belongs only to this cell. Keep the allocation's
            # session and inherit the lock, even if this phase controller dies.
            process = subprocess.Popen(command, cwd=ROOT, env=environment,
                                       stdin=subprocess.DEVNULL, stdout=console, stderr=subprocess.STDOUT,
                                       preexec_fn=os.setpgrp, pass_fds=(lock_descriptor,))
            atomic_json(cell_root / "process.json", {"pid": process.pid, "started_at": now()}, create=True)
            deadline = time.monotonic() + intent["container_cap_seconds"]
            while process.poll() is None:
                if cancelled[0]:
                    reason = "operator_interrupted"
                    terminate_owned(process)
                    break
                if time.monotonic() >= deadline:
                    reason = "original_container_limit_reached"
                    terminate_owned(process)
                    break
                try:
                    process.wait(timeout=min(1, max(0.01, deadline - time.monotonic())))
                except subprocess.TimeoutExpired:
                    pass
            code = process.wait()
    except OSError as exc:
        reason = {"type": type(exc).__name__, "errno": exc.errno, "message": str(exc)}
        if process is not None:
            terminate_owned(process)
            code = process.returncode
    outcome = {"cell": cell["id"], "state": "process_ended", "started_at": started_at,
               "ended_at": now(), "exit_code": code, "termination": reason,
               "native_report_exists": (cell_root / "native.json").exists()}
    atomic_json(completion, outcome, create=True)
    # This directory was created exclusively for this cell, and its child has
    # exited. Retain diagnostics and reports; release reproducible compiled data.
    try:
        if not cache.is_symlink() and (cache.stat().st_dev, cache.stat().st_ino) == cache_identity:
            shutil.rmtree(cache)
            outcome["completed_cache_removed"] = True
        else:
            outcome["completed_cache_removed"] = False
    except OSError as exc:
        outcome["cache_cleanup_error"] = {"type": type(exc).__name__, "errno": exc.errno}
    atomic_json(completion, outcome)
    print(json.dumps({"event": "native_cell_end", **outcome}), flush=True)
    return outcome


def summarize(directory, intent, sources, *, publish=True):
    rows, accepted = [], []
    for cell in intent["cells"]:
        cell_root = directory / "cells" / cell["id"]
        report = cell_root / "native.json"
        row = {"cell": cell["id"], "candidate": cell["candidate"], "state": "not_started"}
        if (cell_root / "completion.json").exists():
            row.update(read(cell_root / "completion.json"))
        elif (cell_root / "attempt.json").exists():
            row["state"] = "attempt_retained"
        if report.exists():
            row.update(native_report=str(report.relative_to(directory)), native_sha256=sha(report))
            try:
                classified = compare([report], sources, intent["baseline"])["records"][0]
                raw = read(report)
                actual = raw["cell"]
                if (classified["candidate"] != cell["candidate"] or
                        actual.get("topology_seed") != cell["topology_seed"] or
                        actual.get("algorithm_seed") != cell["algorithm_seed"] or
                        actual.get("max_time_s") != cell["max_time_seconds"] or
                        actual.get("population_size_override") is not None):
                    raise ValueError("Retained original report differs from this planned cell")
                row.update(native_status=classified["status"], native_error=classified["error"],
                           best_feasible_loss=classified["best_feasible_loss"])
                accepted.append(report)
            except (OSError, ValueError, KeyError, TypeError) as exc:
                row["report_problem"] = {"type": type(exc).__name__, "message": str(exc)}
        rows.append(row)
    comparison = compare(accepted, sources, intent["baseline"]) if accepted else None
    result = {"schema": SCHEMA, "phase": intent["phase"], "updated_at": now(),
              "planned_cells": len(rows), "retained_native_reports": len(accepted),
              "all_cells_ended": all((directory / "cells" / c["id"] / "completion.json").exists()
                                     for c in intent["cells"]),
              "cells": rows, "comparison": comparison}
    if publish:
        atomic_json(directory / "result.json", result)
    return result


def archive(directory, target):
    target = Path(target).expanduser().absolute()
    if target.exists():
        raise FileExistsError("Use a new phase archive destination")
    target.parent.mkdir(parents=True, exist_ok=True)
    files = [directory / "phase.json", directory / "result.json"]
    files.extend(sorted((directory / "cells").rglob("*")) if (directory / "cells").exists() else [])
    files = [path for path in files if path.is_file() and not path.name.startswith(".phase-")]
    descriptor, name = tempfile.mkstemp(dir=target.parent, prefix=".phase-archive-")
    os.close(descriptor)
    temporary = Path(name)
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
            inventory = []
            for path in files:
                relative = str(path.relative_to(directory))
                bundle.write(path, relative)
                inventory.append({"path": relative, "bytes": path.stat().st_size, "sha256": sha(path)})
            bundle.writestr("ARCHIVE-MANIFEST.json", canonical({"schema": SCHEMA, "files": inventory}))
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        os.link(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return {"path": str(target), "bytes": target.stat().st_size, "sha256": sha(target)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("plan", "run", "status", "export"))
    parser.add_argument("--phase", choices=("matched-development", "broad-public", "full-objective-budget"),
                        default="matched-development")
    parser.add_argument("--candidate", action="append", help="Two frozen IDs for a broader phase")
    parser.add_argument("--baseline", default="099")
    parser.add_argument("--mode", choices=("cpu", "gpu"), default="gpu")
    parser.add_argument("--python", dest="python_executable", default=sys.executable)
    parser.add_argument("--cpu-affinity", help="Granted CPU list, passed to the unchanged CPU launcher")
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--run-dir", type=Path)
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    sources = read(ROOT / "SOURCES.json")
    template = None
    if args.action in ("plan", "run"):
        sources, template = freeze(args)
    if args.action == "plan":
        print(json.dumps(template, indent=2))
        return 0
    if args.run_dir is None:
        parser.error("--run-dir is required")
    directory = args.run_dir.expanduser().absolute()
    if args.action != "run" and not (directory / "phase.json").is_file():
        raise ValueError("Select an existing retained phase")
    if args.action == "status":
        intent = read(directory / "phase.json")["intent"]
        for name, expected in intent["source_sha256"].items():
            if sha(ROOT / name) != expected:
                raise ValueError("Select the original retained phase source: " + name)
        result = summarize(directory, intent, sources, publish=False)
        print(json.dumps(result, indent=2))
        return 0
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / ".phase.lock").open("a") as lock:
        os.chmod(lock.name, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("This same phase or its original native child is already alive")
        if args.action == "run":
            if args.mode == "cpu" and not args.cpu_affinity:
                parser.error("CPU mode requires the granted --cpu-affinity")
            python = executable(args.python_executable)
            intent = {**template, "runtime": {
                "mode": args.mode, "python": python, "python_sha256": sha(python),
                "cpu_affinity": args.cpu_affinity if args.mode == "cpu" else None,
                "cache_dir": str((args.cache_dir or directory / "compilation-caches").expanduser().absolute()),
                "cache_policy": "new_empty_per_cell; bounded128MiB; remove_after_retained_process_completion",
                "environment": {key: os.environ.get(key) for key in ENVIRONMENT_KEYS}}}
            if (directory / "phase.json").exists():
                if read(directory / "phase.json")["intent"] != intent:
                    raise ValueError("The retained phase has a different source, selection or runtime declaration")
            else:
                if any(path.name != ".phase.lock" for path in directory.iterdir()):
                    raise ValueError("A new phase requires an empty owned run directory")
                atomic_json(directory / "phase.json", {"created_at": now(), "intent": intent}, create=True)
            summarize(directory, intent, sources)
            cancelled = [False]
            previous = {}
            for number in (signal.SIGINT, signal.SIGTERM):
                previous[number] = signal.signal(number, lambda *_: cancelled.__setitem__(0, True))
            try:
                for cell in intent["cells"]:
                    if cancelled[0]:
                        break
                    execute_cell(cell, intent, directory, lock.fileno(), cancelled)
                    summarize(directory, intent, sources)
            finally:
                for number, handler in previous.items():
                    signal.signal(number, handler)
        else:
            intent = read(directory / "phase.json")["intent"]
            for name, expected in intent["source_sha256"].items():
                if sha(ROOT / name) != expected:
                    raise ValueError("Use the original retained phase source for status/export: " + name)
        result = summarize(directory, intent, sources)
        output = {"phase": intent["phase"], "result": str(directory / "result.json"),
                  "planned_cells": result["planned_cells"],
                  "retained_native_reports": result["retained_native_reports"],
                  "all_cells_ended": result["all_cells_ended"]}
        if args.archive or args.action == "export":
            if args.archive is None:
                parser.error("export requires a new --archive path")
            output["archive"] = archive(directory, args.archive)
        print(json.dumps(output), flush=True)
        return 0 if args.action != "run" or result["retained_native_reports"] == result["planned_cells"] else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, RuntimeError) as exc:
        print(json.dumps({"state": "phase_not_completed", "error": type(exc).__name__,
                          "message": str(exc)}), file=sys.stderr)
        raise SystemExit(2)

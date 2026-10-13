"""Freeze original inputs, execute native paired cases, retain recoverable jobs."""
from __future__ import annotations
import copy
import datetime as dt
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import uuid
from typing import Any, Callable
from . import __version__
from .store import (ScenarioError, atomic_json, canonical, digest, exclusive,
                    dataset_hash, file_hash, inside, read_json, snapshot)
from .results import binding_for, read_results

MODELS = {"ndr": "natcap.invest.ndr.ndr", "sdr": "natcap.invest.sdr.sdr",
          "annual_water_yield": "natcap.invest.annual_water_yield"}


def stamp() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def safe_id(value: Any, label: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", value):
        raise ScenarioError(f"{label} must be a portable identifier, at most 80 characters")
    return value


def cost(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ScenarioError("Scenario cost_cents must be a nonnegative integer")
    return value


def _freeze_args(args: dict, base: Path, root: Path, inventory: dict) -> dict:
    result = copy.deepcopy(args)
    for key, value in args.items():
        if key.endswith("_path") and value not in (None, ""):
            if not isinstance(value, str):
                raise ScenarioError(f"Input argument {key} must be a file path")
            path = (base / value).resolve()
            relative, items = snapshot(path, root)
            result[key] = relative
            for entry in items:
                inventory[entry["path"]] = entry
    return result


def freeze(plan_path: Path, destination: Path) -> dict:
    """Create a new independently editable plan and retain every original input."""
    if destination.exists():
        raise ScenarioError("New plan receiving is create-only")
    source = read_json(plan_path)
    plan = copy.deepcopy(source)
    if plan.get("schema") != 1:
        raise ScenarioError("Unsupported plan schema")
    for field in ("project_id", "setup_id"):
        safe_id(plan.get(field), field)
    if plan.get("currency") not in {"USD", "EUR", "GBP", "CAD", "AUD", "NZD"}:
        raise ScenarioError("Use an explicit supported two-decimal currency code")
    if not plan.get("source_manifest"):
        raise ScenarioError("Plan needs original source provenance")
    native = plan.setdefault("native", {})
    native.setdefault("invest_version", "3.15.0")
    native.setdefault("python", sys.executable)
    if not isinstance(native["invest_version"], str) or not native["invest_version"].strip():
        raise ScenarioError("An exact native InVEST version is required")
    if not plan.get("models") or not set(plan["models"]).issubset(MODELS):
        raise ScenarioError("Select NDR, SDR and/or annual_water_yield native models")
    scenarios = plan.get("scenarios", [])
    if not scenarios:
        raise ScenarioError("Provide at least one complete intervention scenario")
    ids = {"baseline"}
    for scenario in scenarios:
        identifier = safe_id(scenario.get("id"), "scenario id")
        if identifier in ids:
            raise ScenarioError("Scenario IDs must be unique; baseline is reserved")
        ids.add(identifier)
        scenario["cost_cents"] = cost(scenario.get("cost_cents"))
        if not scenario.get("interventions"):
            raise ScenarioError("An alternative needs explicit interventions")
    cases = plan.setdefault("cases", [{"id": "central", "overrides": {}}])
    if not cases:
        raise ScenarioError("Provide at least one matched case")
    case_ids = set()
    for case in cases:
        identifier = safe_id(case.get("id"), "case id")
        if identifier in case_ids:
            raise ScenarioError("Case IDs must be unique")
        case_ids.add(identifier)
        for model, overrides in case.get("overrides", {}).items():
            if model not in plan["models"]:
                raise ScenarioError("Case overrides name an unselected model")
            if any(k in overrides for k in ("workspace_dir", "results_suffix", "lulc_path", "watersheds_path", "sub_watersheds_path")):
                raise ScenarioError("Cases may vary scientific parameters/forcing, not run directories, LULC or watershed boundaries")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".planning-", dir=destination.parent))
    inventory: dict[str, dict] = {}
    base = plan_path.resolve().parent
    try:
        for field in ("lulc_path", "parcels_path"):
            if field not in plan:
                raise ScenarioError(f"Plan needs {field}")
            plan[field], files = snapshot((base / plan[field]).resolve(), staging)
            inventory.update({f["path"]: f for f in files})
        expected_lulc = file_hash(inside(staging, plan["lulc_path"]))
        for model, entry in plan["models"].items():
            if native["invest_version"] not in {"3.15.0", "3.20.0"} and not {"path", "id_field", "metrics"}.issubset(entry.get("result", {})):
                raise ScenarioError("Non-default InVEST versions need complete explicit result bindings")
            args = entry.get("args", {})
            for needed in ("lulc_path", "watersheds_path", "biophysical_table_path"):
                if not args.get(needed):
                    raise ScenarioError(f"{model} requires {needed}")
            if args.get("results_suffix"):
                raise ScenarioError("Result suffixes are owned by separate run directories; omit results_suffix")
            entry["args"] = _freeze_args(args, base, staging, inventory)
            entry["args"].pop("workspace_dir", None)
            entry["args"].pop("results_suffix", None)
            if file_hash(inside(staging, entry["args"]["lulc_path"])) != expected_lulc:
                raise ScenarioError("All selected models must start from the same retained LULC")
            entry["result"] = binding_for(model, entry)
        for case in cases:
            for model, args in list(case.get("overrides", {}).items()):
                case["overrides"][model] = _freeze_args(args, base, staging, inventory)
        plan["inputs"] = sorted(inventory.values(), key=lambda x: x["path"])
        plan["created_at"] = stamp()
        plan["package_version"] = __version__
        plan.pop("plan_sha256", None)
        plan["plan_sha256"] = digest(plan)
        atomic_json(staging / "plan.json", plan)
        atomic_json(staging / "state.json", {"schema": 1, "jobs": {}, "prepared": {}})
        atomic_json(staging / "original-plan.json", source)
        # The spatial runtime is needed when creating interventions; received
        # native summaries can be inspected and reported with standard Python.
        from .spatial import prepare_lulc
        # Prepare every alternative before publishing a runnable plan.
        state = read_json(staging / "state.json")
        for scenario in scenarios:
            output = staging / "prepared" / scenario["id"] / "lulc.tif"
            details = prepare_lulc(plan, staging, scenario, output)
            state["prepared"][scenario["id"]] = {"path": output.relative_to(staging).as_posix(), **details}
        atomic_json(staging / "state.json", state)
        staging.rename(destination)
        return {"workspace": str(destination), "plan_sha256": plan["plan_sha256"],
                "scenarios": len(scenarios), "cases": len(cases), "models": len(plan["models"]),
                "planned_native_runs": (len(scenarios)+1)*len(cases)*len(plan["models"]),
                "retained_files": len(inventory)}
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def verify_plan(root: Path) -> tuple[dict, dict]:
    plan = read_json(root / "plan.json")
    expected = plan["plan_sha256"]
    content = {k: v for k, v in plan.items() if k != "plan_sha256"}
    if digest(content) != expected:
        raise ScenarioError("The retained plan was edited in place; create a new plan revision")
    for entry in plan["inputs"]:
        p = inside(root, entry["path"])
        if p.stat().st_size != entry["bytes"] or file_hash(p) != entry["sha256"]:
            raise ScenarioError(f"Original input changed: {entry['path']}")
    state = read_json(root / "state.json")
    for scenario in state["prepared"].values():
        if file_hash(inside(root, scenario["path"])) != scenario["lulc_sha256"]:
            raise ScenarioError("Prepared intervention raster changed")
    return plan, state


def native_run(model: str, args: dict, expected_version: str, python: str, log: Path) -> dict:
    """Call the original native model in a retained process, never a substitute."""
    from . import native_worker
    request = log.with_suffix(".request.json")
    receipt = log.with_suffix(".native.json")
    atomic_json(request, {"model": model, "args": args, "invest_version": expected_version,
                          "receipt": str(receipt)})
    command = [python, str(Path(native_worker.__file__).resolve()), str(request)]
    with log.open("wb") as out:
        process = subprocess.Popen(command, stdout=out, stderr=subprocess.STDOUT,
                                   start_new_session=(os.name == "posix"))
        try:
            code = process.wait()
        except BaseException:
            if process.poll() is None:
                if os.name == "posix":
                    os.killpg(process.pid, signal.SIGTERM)
                else:
                    process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    if os.name == "posix":
                        os.killpg(process.pid, signal.SIGKILL)
                    else:
                        process.kill()
                    process.wait()
            raise
    if code != 0 or not receipt.exists():
        raise ScenarioError(f"Native {model} process exited {code}; full log: {log}")
    result = read_json(receipt)
    if result.get("invest_version") != expected_version or result.get("model") != model:
        raise ScenarioError("Native process receipt does not match requested model/version")
    return result


def run_workspace(root: Path, *, python: str | None = None,
                  executor: Callable[..., dict] | None = None,
                  engine_identity: str = "native-invest", stop_after: int | None = None) -> dict:
    """Resume all retained jobs. Inject the original application's driver to compose.

    The CLI uses native_run. Integrators may supply their already-loaded native
    runner with this function signature and a pinned engine_identity. Alternative
    executors are recorded verbatim so their provenance cannot masquerade as the
    built-in native process. stop_after is for explicit process/service shutdown.
    """
    root = root.resolve()
    built_in_native = executor is None
    executor = executor or native_run
    with exclusive(root):
        plan, state = verify_plan(root)
        if plan.get("mode") in {"adopted-experiment", "adopted-upstate-experiment"}:
            raise ScenarioError("This workspace receives original experiment results; execute or revise through the original experiment queue")
        python = python or plan["native"]["python"]
        if built_in_native:
            from . import native_worker
            try:
                described = subprocess.run([python, str(Path(native_worker.__file__).resolve()),
                                            "--describe", plan["native"]["invest_version"]],
                                           capture_output=True, text=True, check=True, timeout=60)
                import json
                runtime = json.loads(described.stdout)
                state["runtime"] = runtime
                state["preflight"] = {"status": "ready", "at": stamp()}
            except (subprocess.SubprocessError, OSError, ValueError) as exc:
                details = getattr(exc, "stderr", None) or str(exc)
                state["preflight"] = {"status": "failed", "at": stamp(), "error": details}
                atomic_json(root / "state.json", state)
                raise ScenarioError("Native runtime preflight failed; complete details retained in state.json") from exc
        else:
            if engine_identity == "native-invest":
                raise ScenarioError("An injected driver needs an explicit engine_identity")
            runtime = {"injected_engine": engine_identity}
            state["runtime"] = runtime
        state.setdefault("active_jobs", {})
        atomic_json(root / "state.json", state)
        source_code = {p.name: file_hash(p) for p in Path(__file__).parent.glob("*.py")}
        input_hashes = {i["path"]: i["sha256"] for i in plan["inputs"]}
        alternatives = [{"id": "baseline", "cost_cents": 0, "interventions": []}] + plan["scenarios"]
        processed = 0
        for case in plan["cases"]:
            for scenario in alternatives:
                for model, config in plan["models"].items():
                    args = {**config["args"], **case.get("overrides", {}).get(model, {})}
                    unchanged = {k: v for k, v in args.items() if k not in {"lulc_path", "n_workers", "workspace_dir", "results_suffix"}}
                    comparison_key = digest({"unchanged": unchanged, "inputs": input_hashes,
                                             "engine": engine_identity, "version": plan["native"]["invest_version"],
                                             "source_code": source_code, "runtime": runtime, "project": plan["project_id"],
                                             "setup": plan["setup_id"], "model": model, "case": case["id"]})
                    scenario_source = (plan["lulc_path"] if scenario["id"] == "baseline"
                                       else state["prepared"][scenario["id"]]["path"])
                    lulc_sha = file_hash(inside(root, scenario_source))
                    key = digest({"comparison": comparison_key, "lulc": lulc_sha,
                                  "scenario": scenario["id"], "binding": config["result"]})
                    job_id = key[:32]
                    state["active_jobs"]["/".join([case["id"], scenario["id"], model])] = job_id
                    previous = state["jobs"].get(job_id)
                    if previous and previous["status"] == "complete":
                        # Cache hits still authenticate the exact native table and derived rows.
                        for path_key, hash_key in [("result_path", "result_sha256"), ("native_table_path", "native_dataset_sha256")]:
                            if (dataset_hash if path_key == "native_table_path" else file_hash)(inside(root, previous[path_key])) != previous[hash_key]:
                                raise ScenarioError("Completed job output changed; preserve it and start a new plan revision")
                        continue
                    if stop_after is not None and processed >= stop_after:
                        return state
                    attempt = len(previous.get("attempts", [])) + 1 if previous else 1
                    run_dir = root / "runs" / job_id / (str(attempt) + "-" + uuid.uuid4().hex[:12])
                    run_dir.mkdir(parents=True)
                    job = {"id": job_id, "key": key, "project_id": plan["project_id"],
                           "setup_id": plan["setup_id"], "case_id": case["id"],
                           "scenario_id": scenario["id"], "model": model, "status": "running",
                           "comparison_key": comparison_key, "engine_identity": engine_identity,
                           "invest_version": plan["native"]["invest_version"],
                           "started_at": stamp(), "attempts": previous.get("attempts", []) if previous else []}
                    attempt_info = {"workspace": run_dir.relative_to(root).as_posix(), "started_at": stamp()}
                    job["attempts"].append(attempt_info)
                    state["jobs"][job_id] = job
                    atomic_json(root / "state.json", state)
                    args["lulc_path"] = scenario_source
                    relative_args = copy.deepcopy(args)
                    for key_arg, value in list(args.items()):
                        if key_arg.endswith("_path") and value not in (None, ""):
                            args[key_arg] = str(inside(root, value))
                    args["workspace_dir"] = str(run_dir / "native")
                    args["results_suffix"] = ""
                    args.setdefault("n_workers", -1)
                    atomic_json(run_dir / "relative-args.json", relative_args)
                    try:
                        receipt = executor(model, args, plan["native"]["invest_version"], python, run_dir / "process.log")
                        table = inside(run_dir / "native", config["result"]["path"])
                        ws_sha = input_hashes[relative_args["watersheds_path"]]
                        values = read_results(table, config["result"], watershed_source_sha256=ws_sha)
                        result_path = run_dir / "results.json"
                        atomic_json(result_path, values)
                        job.update(status="complete", completed_at=stamp(),
                                   native_table_path=table.relative_to(root).as_posix(),
                                   native_dataset_sha256=dataset_hash(table),
                                   result_path=result_path.relative_to(root).as_posix(),
                                   result_sha256=file_hash(result_path), engine_receipt=receipt)
                        attempt_info["status"] = "complete"
                    except BaseException as exc:
                        job.update(status="interrupted" if isinstance(exc, (KeyboardInterrupt, SystemExit)) else "failed",
                                   finished_at=stamp(), error=f"{type(exc).__name__}: {exc}")
                        attempt_info.update(status=job["status"], error=job["error"])
                        atomic_json(root / "state.json", state)
                        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                            raise
                    atomic_json(root / "state.json", state)
                    processed += 1
        verify_plan(root)
        atomic_json(root / "state.json", state)
        return state


def revise(root: Path, revision: Path, changes_path: Path) -> dict:
    """Receive an independent revision with retained inputs; never edit the sender."""
    with exclusive(root):
        plan, _ = verify_plan(root)
        if plan.get("mode") in {"adopted-experiment", "adopted-upstate-experiment"}:
            raise ScenarioError("Revise the original experiment and receive its new completed edition")
        changes = read_json(changes_path)
        allowed = {"setup_id", "scenarios", "cases", "source_manifest", "native"}
        if set(changes) - allowed:
            raise ScenarioError(f"Revision fields must be in {sorted(allowed)}")
        original = {k: copy.deepcopy(v) for k, v in plan.items()
                    if k not in {"inputs", "created_at", "package_version", "plan_sha256"}}
        original.update(changes)
        for key in ("lulc_path", "parcels_path"):
            original[key] = str(inside(root, original[key]))
        for entry in original["models"].values():
            for key, value in list(entry["args"].items()):
                if key.endswith("_path") and value not in (None, ""):
                    entry["args"][key] = str(inside(root, value))
        # Existing cases reference retained inputs; replacement cases are resolved
        # against the revision specification's directory instead.
        case_base = changes_path.resolve().parent if "cases" in changes else root
        for case in original["cases"]:
            for overrides in case.get("overrides", {}).values():
                for key, value in list(overrides.items()):
                    if key.endswith("_path") and value not in (None, ""):
                        overrides[key] = str((case_base / value).resolve())
        fd, name = tempfile.mkstemp(suffix=".json", dir=changes_path.resolve().parent)
        os.close(fd)
        temporary = Path(name)
        try:
            atomic_json(temporary, original)
            return freeze(temporary, revision)
        finally:
            temporary.unlink(missing_ok=True)

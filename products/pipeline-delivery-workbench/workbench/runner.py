"""Original Dagster execution of the installed dbt CLI; one request, one native run."""
from __future__ import annotations
import argparse, contextlib, importlib.metadata, json, os, re, shutil, signal, subprocess, sys, traceback
from pathlib import Path
from common import FileLease, Problem, durable_write, packed, process_identity, read_json, sha, utc
from artifacts import ARTIFACT_NAMES, evaluate, load_artifacts

def versions():
    out = {"python": sys.version}
    for name in ("dagster", "dbt-core", "dbt-duckdb", "duckdb"):
        try: out[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError: out[name] = None
    return out

def execute(request_path, *, attempt_id, lease_fd=None):
    request_path = Path(request_path).resolve()
    request = read_json(request_path)
    run, contract = request["run"], request["contract"]
    root, workspace = Path(request["run_root"]), Path(request["workspace_root"])
    if root.name != run["id"] or root.parent != workspace / "native-runs":
        raise Problem("invalid_native_path", "The selected original native request path is inconsistent")
    outcome_path = root / "outcome.json"
    if outcome_path.exists():
        # A repeated process invocation never executes a retained successful or failed command again.
        print(packed({"status": "retained_outcome", "path": str(outcome_path)}), flush=True)
        return 0
    try:
        lease = FileLease.adopt(workspace / "native.lock", lease_fd) if lease_fd is not None else FileLease(workspace / "native.lock")
    except BlockingIOError:
        durable_write(root / "setup-failure.json", packed({"code": "native_in_use", "message": "Another original native operation owns this workspace", "request_dispatched": False, "attempt_id": attempt_id, "observed_at": utc()}), replace=True)
        return 2
    try:
        attempt_root = root / "attempts" / attempt_id
        attempt_root.mkdir(parents=True, exist_ok=True)
        worker = {"run_id": run["id"], "attempt_id": attempt_id, "identity": process_identity(), "started_at": utc()}
        durable_write(attempt_root / "worker.json", packed(worker))
        durable_write(root / "worker.json", packed(worker), replace=True)
        try:
            from dagster import DagsterInstance, Failure, job, op
            import yaml
            native_versions = versions()
            for entry in request["edition"]["files"]:
                p = root / "project" / entry["path"]
                if not p.is_file() or p.stat().st_size != entry["bytes"] or sha(p.read_bytes()) != entry["sha256"]:
                    raise Problem("source_changed", "Original project source no longer matches its selected edition")
            if (root / "stop.json").exists():
                raise Problem("stopped_before_dispatch", "The operator stopped this operation before original native dispatch")
            profile_source = request.get("profiles")
            if profile_source:
                profiles = Path(profile_source["directory"])
                if sha((profiles / "profiles.yml").read_bytes()) != profile_source["sha256"]:
                    raise Problem("profiles_changed", "The selected external profile changed after preparation")
            else:
                config = yaml.safe_load((root / "project" / "dbt_project.yml").read_text("utf-8"))
                profile_name = config.get("profile") if isinstance(config, dict) else None
                if not isinstance(profile_name, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", profile_name):
                    raise Problem("profile_name_required", "Managed DuckDB requires a literal profile name in original dbt_project.yml")
                profiles = root / "profiles"
                target = request["binding"]["target"]
                native_profile = {profile_name: {"target": target, "outputs": {target: {
                    "type": "duckdb", "path": str(root / "warehouse.duckdb"), "schema": "main",
                    "threads": contract["threads"]}}}}
                durable_write(profiles / "profiles.yml", yaml.safe_dump(native_profile, sort_keys=False))
                if request.get("baseline"):
                    original = Path(request["baseline"]["path"])
                    if not original.is_file() or sha(original.read_bytes()) != request["baseline"]["sha256"]:
                        raise Problem("baseline_changed", "The selected original database baseline changed")
                    target_db = root / "warehouse.duckdb"
                    if not target_db.exists():
                        durable_write(target_db, original.read_bytes())
            # Configure the regular persistent native Dagster store once. No ephemeral test instance.
            native_home = workspace / "dagster"
            native_home.mkdir(parents=True, exist_ok=True)
            config_file = native_home / "dagster.yaml"
            if not config_file.exists():
                durable_write(config_file, "telemetry:\n  enabled: false\n")
            os.environ["DAGSTER_HOME"] = str(native_home)
            instance = DagsterInstance.get()
        except BaseException as exc:
            error = {"code": getattr(exc, "code", "native_setup_failed"), "message": str(exc),
                     "request_dispatched": False, "attempt_id": attempt_id, "observed_at": utc(), "runtime_versions": versions()}
            durable_write(attempt_root / "setup-failure.json", packed(error))
            durable_write(root / "setup-failure.json", packed(error), replace=True)
            print(packed(error), flush=True)
            return 2

        stages = []
        started = utc()
        def invoke(context, name, tokens, selected=False):
            if (root / "stop.json").exists():
                raise Failure("The operator requested stop before " + name)
            if profile_source and sha((profiles / "profiles.yml").read_bytes()) != profile_source["sha256"]:
                raise Failure("The selected external profile changed before " + name)
            directory = root / "stages" / name
            directory.mkdir(parents=True, exist_ok=True)
            args = [request["dbt_executable"], "--log-format", "json", *tokens,
                    "--project-dir", str(root / "project"), "--profiles-dir", str(profiles),
                    "--target", request["binding"]["target"],
                    "--log-path", str(directory / "logs"), "--no-partial-parse",
                    "--vars", packed(contract["vars"])]
            # v1.12.5's actual deps CLI has no target_path/threads options; all other selected commands do.
            if tokens != ["deps"]:
                args.extend(["--target-path", str(directory / "target"), "--threads", str(contract["threads"])])
            if selected and tokens[0] in {"build", "run", "seed", "compile", "source", "docs"}:
                if contract.get("select"): args.extend(["--select", contract["select"]])
                if contract.get("exclude"): args.extend(["--exclude", contract["exclude"]])
                if contract.get("full_refresh"): args.append("--full-refresh")
                if contract.get("fail_fast"): args.append("--fail-fast")
            stage = {"name": name, "argv": args, "started_at": utc(), "finished_at": None, "returncode": None}
            durable_write(directory / "invocation.json", packed(stage))
            context.log.info("Starting original dbt stage " + name)
            env = os.environ.copy()
            env["DBT_PROFILES_DIR"] = str(profiles)
            env["DBT_SEND_ANONYMOUS_USAGE_STATS"] = "false"
            # Original dbt stdout/stderr remain in this stage and the parent native log.
            with open(directory / "output.log", "ab", buffering=0) as log:
                child = subprocess.Popen(args, cwd=root / "project", env=env, stdin=subprocess.DEVNULL,
                                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, pass_fds=(lease.fd,))
                durable_write(directory / "process.json", packed({"identity": process_identity(child.pid), "started_at": utc()}))
                try:
                    while True:
                        chunk = child.stdout.read(65536)
                        if not chunk: break
                        log.write(chunk)
                        sys.stdout.buffer.write(chunk); sys.stdout.buffer.flush()
                    code = child.wait()
                except BaseException:
                    if child.poll() is None:
                        child.send_signal(signal.SIGINT)
                        try: child.wait(timeout=15)
                        except subprocess.TimeoutExpired:
                            child.terminate(); child.wait(timeout=15)
                    raise
            stage.update(returncode=code, finished_at=utc())
            stages.append(stage)
            durable_write(directory / "result.json", packed(stage))
            if code != 0:
                raise Failure("Original dbt " + name + " returned exit code " + str(code))
            return stage

        @op(name="prepare_client_project")
        def prepare_client_project(context):
            if contract.get("install_dependencies"):
                invoke(context, "dependencies", ["deps"])
            if contract["command"] != "parse":
                invoke(context, "parse", ["parse"])
            return True

        @op(name="execute_client_workload")
        def execute_client_workload(context, ready):
            invoke(context, "selected", contract["command"].split(" "), selected=True)
            return True

        @op(name="retain_client_catalog")
        def retain_client_catalog(context, ready):
            if contract.get("generate_catalog") and contract["command"] != "docs generate":
                invoke(context, "catalog", ["docs", "generate"])
            return True

        @job(name="client_pipeline_delivery")
        def client_pipeline_delivery():
            retain_client_catalog(execute_client_workload(prepare_client_project()))

        existing = instance.get_run_by_id(run["dagster_run_id"])
        if existing is not None:
            # Its original run storage is the authority; this process is a recovery reader only.
            print(packed({"status": "existing_native_run", "dagster_run_id": existing.run_id,
                          "native_status": existing.status.value}), flush=True)
            instance.dispose()
            return 3
        marker = root / "dagster-run.json"
        marker_identity = {"run_id": run["id"], "dagster_run_id": run["dagster_run_id"],
                           "request_sha256": sha(request_path.read_bytes())}
        if marker.exists():
            original_marker = read_json(marker)
            if any(original_marker.get(k) != value for k, value in marker_identity.items()):
                raise Problem("native_marker_changed", "The retained original native identity changed", 409)
        else:
            durable_write(marker, packed({**marker_identity, "starting_at": utc()}))
        result = None
        error = None
        try:
            result = client_pipeline_delivery.execute_in_process(instance=instance, run_id=run["dagster_run_id"],
                raise_on_error=False, tags={"tjlabs/workspace_id": request["workspace_id"],
                "tjlabs/operation_id": run["id"], "tjlabs/project_id": run["project_id"],
                "tjlabs/source_sha256": run["source_sha256"], "tjlabs/contract_sha256": run["contract_sha256"]})
        except BaseException as exc:
            error = {"type": type(exc).__name__, "message": str(exc)}
        native_run = instance.get_run_by_id(run["dagster_run_id"])
        native_status = native_run.status.value if native_run else None
        instance.dispose()
        # Keep the selected invocation's artifacts distinct from later catalog generation.
        artifact_root = root / "artifacts"
        for stage_name in ("selected", "parse", "catalog"):
            for name in sorted(ARTIFACT_NAMES):
                p = root / "stages" / stage_name / "target" / name
                if p.is_file():
                    target = artifact_root / name
                    if not target.exists(): durable_write(target, p.read_bytes())
        entries = load_artifacts(artifact_root)
        state = {"SUCCESS": "succeeded", "FAILURE": "failed", "CANCELED": "cancelled"}.get(native_status, "interrupted")
        warehouse = None
        warehouse_file = root / "warehouse.duckdb"
        if warehouse_file.is_file():
            warehouse = {"bytes": warehouse_file.stat().st_size, "sha256": sha(warehouse_file.read_bytes())}
        outcome = {"schema": "tjlabs.dagster-native-outcome/v1", "run_id": run["id"],
                   "dagster_run_id": run["dagster_run_id"], "source_sha256": run["source_sha256"],
                   "contract_sha256": run["contract_sha256"], "state": state,
                   "request_dispatched": True, "native_status": native_status, "native_success": bool(result and result.success),
                   "runtime_versions": native_versions, "started_at": started, "finished_at": utc(),
                   "stages": stages, "error": error, "warehouse": warehouse, "evaluation": evaluate(entries, contract)}
        if native_status not in {"SUCCESS", "FAILURE", "CANCELED"}:
            # Preserve the observation without sealing an unknown lifecycle as a completed outcome.
            durable_write(root / "interrupted-observation.json", packed(outcome), replace=True)
            print(packed({"status": "original_native_unfinished", "run_id": run["id"],
                          "dagster_run_id": run["dagster_run_id"], "native_status": native_status}), flush=True)
            return 4
        durable_write(outcome_path, packed(outcome))
        print(packed({"status": "retained_native_outcome", "run_id": run["id"],
                      "dagster_run_id": run["dagster_run_id"], "state": state,
                      "outcome_sha256": sha(outcome_path.read_bytes())}), flush=True)
        return 0 if state == "succeeded" else 1
    finally:
        lease.close()

def reconcile(request_path):
    """Read the same original Dagster record; never invoke dbt or execute a job."""
    request_path = Path(request_path).resolve()
    request = read_json(request_path)
    run, root = request["run"], Path(request["run_root"])
    workspace = Path(request["workspace_root"])
    try:
        lease = FileLease(workspace / "native.lock")
    except BlockingIOError:
        return 4
    try:
        if (root / "outcome.json").exists(): return 0
        from dagster import DagsterInstance
        os.environ["DAGSTER_HOME"] = str(workspace / "dagster")
        # A native store never created by this operation is a definite pre-dispatch observation.
        if not (workspace / "dagster" / "dagster.yaml").is_file():
            durable_write(root / "native-absence.json", packed({"run_id": run["id"], "dagster_run_id": run["dagster_run_id"],
                "native_store_exists": False, "observed_at": utc()}), replace=True)
            return 0
        instance = DagsterInstance.get()
        original = instance.get_run_by_id(run["dagster_run_id"])
        if original is None:
            instance.dispose()
            durable_write(root / "native-absence.json", packed({"run_id": run["id"], "dagster_run_id": run["dagster_run_id"],
                "native_store_exists": True, "native_run_exists": False, "observed_at": utc()}), replace=True)
            return 0
        status = original.status.value
        instance.dispose()
        if status not in {"SUCCESS", "FAILURE", "CANCELED"}:
            durable_write(root / "native-observation.json", packed({"run_id": run["id"],
                "dagster_run_id": run["dagster_run_id"], "native_status": status, "observed_at": utc()}), replace=True)
            return 4
        stages = []
        for name in ("dependencies", "parse", "selected", "catalog"):
            file = root / "stages" / name / "result.json"
            if file.exists(): stages.append(read_json(file))
        for stage_name in ("selected", "parse", "catalog"):
            for name in sorted(ARTIFACT_NAMES):
                p = root / "stages" / stage_name / "target" / name
                target = root / "artifacts" / name
                if p.is_file() and not target.exists(): durable_write(target, p.read_bytes())
        entries = load_artifacts(root / "artifacts")
        record_file = root / "dagster-run.json"
        start = read_json(record_file).get("starting_at") if record_file.exists() else run["created_at"]
        database = root / "warehouse.duckdb"
        warehouse = {"bytes": database.stat().st_size, "sha256": sha(database.read_bytes())} if database.is_file() else None
        outcome = {"schema": "tjlabs.dagster-native-outcome/v1", "run_id": run["id"],
            "dagster_run_id": run["dagster_run_id"], "source_sha256": run["source_sha256"],
            "contract_sha256": run["contract_sha256"], "state": {"SUCCESS": "succeeded", "FAILURE": "failed", "CANCELED": "cancelled"}[status],
            "request_dispatched": True, "native_status": status, "native_success": status == "SUCCESS",
            "runtime_versions": versions(), "started_at": start, "finished_at": utc(), "stages": stages,
            "error": None, "warehouse": warehouse, "evaluation": evaluate(entries, request["contract"]),
            "recovered_from_original_native_record": True}
        durable_write(root / "outcome.json", packed(outcome))
        return 0
    finally:
        lease.close()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["execute", "reconcile"])
    parser.add_argument("--request", required=True)
    parser.add_argument("--attempt")
    parser.add_argument("--lease-fd", type=int)
    args = parser.parse_args()
    if args.action == "reconcile": return reconcile(args.request)
    if not args.attempt: parser.error("--attempt is required for execution")
    return execute(args.request, attempt_id=args.attempt, lease_fd=args.lease_fd)

if __name__ == "__main__":
    raise SystemExit(main())

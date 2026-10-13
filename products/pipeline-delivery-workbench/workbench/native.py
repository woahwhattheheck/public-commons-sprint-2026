"""One retained native caller per workspace, with exact outcome reconciliation."""
from __future__ import annotations
import base64, contextlib, json, os, shutil, signal, subprocess, threading, uuid
from pathlib import Path
from common import (FileLease, Problem, clone, durable_write, native_available, packed,
                    path_name, process_alive, process_identity, read_json, sha, utc)

class Runtime:
    def __init__(self, workspace):
        self.workspace = workspace
        self.lock = workspace.operation_lock
        self.children = {}
        self.closing = False
        self.idle_depth = 0

    def close(self):
        # The original worker owns its native lease/output. A browser server restart is not cancellation.
        with self.lock:
            self.closing = True

    @contextlib.contextmanager
    def idle_guard(self):
        """Keep the same writer transition and native lease idle for backup or a real switch."""
        with self.lock:
            if self.closing:
                raise Problem("workspace_closed", "The selected workspace writer has closed", 409)
            if self.idle_depth:
                self.idle_depth += 1
                try: yield
                finally: self.idle_depth -= 1
                return
            try:
                lease = FileLease(self.workspace.root / "native.lock")
            except BlockingIOError as exc:
                raise Problem("native_in_use", "The original native operation still owns this workspace", 409) from exc
            self.idle_depth = 1
            try:
                yield
            finally:
                self.idle_depth = 0
                lease.close()

    def status(self):
        with self.workspace.lock:
            runs = self.workspace._list("run", limit=100)["items"]
        return {"native_available": native_available(self.workspace.root), "closing": self.closing,
                "runs": [{"id": r["id"], "state": r["state"], "dagster_run_id": r["dagster_run_id"],
                          "request_dispatched": r["request_dispatched"]} for r in runs
                         if r["state"] in {"prepared", "launching", "running", "interrupted", "setup_failed"}]}

    def submit(self, action, run_id):
        try:
            if action == "start": self.start(run_id)
            elif action == "reconcile": self.reconcile(run_id)
            elif action == "cancel": self.cancel(run_id)
            else: raise Problem("unknown_native_action", "Unknown native continuation")
        except Exception as exc:
            # Never turn an accepted request into an implicit second native attempt.
            with self.workspace.lock:
                run = self.workspace._body("run", run_id)
            update = {"last_control_error": {"action": action, "message": str(exc), "at": utc()}}
            if action == "start" and run["state"] == "prepared":
                update.update(state="setup_failed", request_dispatched=False)
            self.workspace.native_update(run_id, update, event="native.control_error")

    def root(self, run_id):
        return self.workspace.root / "native-runs" / run_id

    def _record(self, run_id):
        with self.workspace.lock:
            return clone(self.workspace._body("run", run_id))

    def _belongs_here(self, run_id):
        path = self.root(run_id) / "request.json"
        if not path.exists(): return True
        request = read_json(path)
        return request.get("workspace_root") == str(self.workspace.root) and request.get("run_root") == str(self.root(run_id))

    def _prepare(self, run):
        w, root = self.workspace, self.root(run["id"])
        with w.lock:
            edition = clone(w._body("edition", run["edition_id"]))
            contract = clone(w._body("contract", run["contract_id"]))
            binding = clone(w._body("binding", run["binding_id"]))
            source_files = [(entry, w.blob(entry["sha256"])) for entry in edition["files"]]
        config = binding["binding"]
        py = shutil.which(config["python_executable"])
        dbt = shutil.which(config["dbt_executable"])
        if not py or not dbt:
            raise Problem("runtime_missing", "Configure the installed Python and original dbt executables before this run", 409,
                          {"python_found": bool(py), "dbt_found": bool(dbt)})
        root.mkdir(parents=True, exist_ok=True)
        for entry, raw in source_files:
            durable_write(root / "project" / entry["path"], raw)
        selected_profiles = None
        if config["mode"] == "external_profiles":
            path = Path(config["profiles_dir"]).expanduser().resolve()
            selected = path / "profiles.yml"
            if not selected.is_file():
                raise Problem("profiles_missing", "The selected external profiles.yml is unavailable", 409)
            selected_profiles = {"directory": str(path), "sha256": sha(selected.read_bytes())}
        baseline = None
        if run.get("base_run_id"):
            old = self._record(run["base_run_id"])
            original = self.root(old["id"]) / "warehouse.duckdb"
            descriptor = (old.get("outcome") or {}).get("warehouse")
            if not descriptor or not original.is_file() or sha(original.read_bytes()) != descriptor["sha256"]:
                raise Problem("baseline_missing", "The original managed database baseline is unavailable or changed", 409)
            baseline = {"run_id": old["id"], "path": str(original), **descriptor}
        # Keep the selected venv entry point: resolving its Python symlink would
        # launch the base interpreter without the configured environment.
        request = {"schema": "tjlabs.dagster-native-request/v1",
                   "workspace_id": w.meta()["workspace_id"], "run": run,
                   "edition": edition, "contract": contract["contract"],
                   "binding": config, "python_executable": str(Path(py).absolute()),
                   "dbt_executable": str(Path(dbt).absolute()), "profiles": selected_profiles,
                   "baseline": baseline, "workspace_root": str(w.root), "run_root": str(root),
                   "source_root": str(w.source_root)}
        # The first prepared input is authoritative; retrying known-before-launch setup does not change it.
        file = root / "request.json"
        if file.exists():
            previous = read_json(file)
            comparable = lambda x: {k: v for k, v in x.items() if k != "run"}
            if packed(comparable(previous)) != packed(comparable(request)):
                raise Problem("native_input_changed", "The prepared native input changed; select a new explicit operation", 409)
            request = previous
        else:
            durable_write(file, packed(request))
        return request, file

    def start(self, run_id):
        with self.lock:
            if self.closing:
                raise Problem("workspace_closed", "The selected workspace writer has closed", 409)
            run = self._record(run_id)
            if run["state"] not in {"prepared", "setup_failed"}:
                raise Problem("run_not_dispatchable", "This run has already crossed native launch; reconcile it", 409)
            if run.get("request_dispatched"):
                raise Problem("native_dispatch_retained", "An accepted native run is never dispatched again", 409)
            if not native_available(self.workspace.root):
                raise Problem("native_in_use", "The workspace's original native operation is still active", 409)
            # Exclude simultaneous host starts without holding this lock inside the native subprocess.
            try:
                start_lease = FileLease(self.workspace.root / "native-start.lock")
            except BlockingIOError as exc:
                raise Problem("native_start_in_use", "Another caller is preparing native execution", 409) from exc
            try:
                request, request_file = self._prepare(run)
                root = self.root(run_id)
                prior_launch = root / "launch.json"
                if prior_launch.exists():
                    self.reconcile(run_id)
                    current = self._record(run_id)
                    if current["state"] != "setup_failed" or current.get("request_dispatched"):
                        raise Problem("launch_already_recorded", "The original launch must be reconciled before any new operation", 409)
                attempt_id = uuid.uuid4().hex
                attempt_root = root / "attempts" / attempt_id
                attempt_root.mkdir(parents=True, exist_ok=True)
                inherited_lease = FileLease(self.workspace.root / "native.lock")
                log = None
                try:
                    self.workspace.native_update(run_id, {"state": "launching", "launch_requested_at": utc(), "launch_attempt": attempt_id}, event="native.launch_requested")
                    log = open(root / "output.log", "ab", buffering=0)
                    child = subprocess.Popen([request["python_executable"], str(self.workspace.source_root / "runner.py"),
                                              "execute", "--request", str(request_file), "--attempt", attempt_id, "--lease-fd", str(inherited_lease.fd)],
                                             cwd=self.workspace.source_root, stdin=subprocess.DEVNULL,
                                             stdout=log, stderr=subprocess.STDOUT, start_new_session=True, pass_fds=(inherited_lease.fd,))
                except BaseException:
                    if log is not None: log.close()
                    self.workspace.native_update(run_id, {"state": "setup_failed", "request_dispatched": False},
                                                 event="native.process_creation_failed")
                    raise
                finally:
                    inherited_lease.close()
                self.children[run_id] = (child, log)
                launch = {"schema": "tjlabs.dagster-worker-launch/v1", "run_id": run_id, "attempt_id": attempt_id,
                          "identity": process_identity(child.pid), "started_at": utc(),
                          "request_sha256": sha(request_file.read_bytes())}
                # If this write fails, the worker still publishes its own identity before Dagster starts.
                try:
                    durable_write(attempt_root / "launch.json", packed(launch))
                    durable_write(prior_launch, packed(launch), replace=True)
                except Exception:
                    pass
                thread = threading.Thread(target=self._follow, args=(run_id, attempt_id, child, log, launch.get("identity")), daemon=True)
                thread.start()
            finally:
                start_lease.close()

    def _follow(self, run_id, attempt_id, child, log, identity):
        returncode = child.wait()
        log.close()
        root = self.root(run_id)
        observed = {"run_id": run_id, "attempt_id": attempt_id,
                    "worker_returncode": returncode, "observed_at": utc(), "identity": identity}
        # A late original follower keeps its own wait result even if an explicit
        # known-before-dispatch successor already owns this same run.
        try: durable_write(root / "attempts" / attempt_id / "worker-exit.json", packed(observed))
        except Exception: pass
        with self.lock:
            current = self.children.get(run_id)
            if current is not None and current[0] is child:
                self.children.pop(run_id, None)
            if self.closing: return
            try:
                launch = read_json(root / "launch.json")
                if launch.get("attempt_id") != attempt_id:
                    return
                durable_write(root / "worker-exit.json", packed(observed), replace=True)
                self.reconcile(run_id)
            except Exception as exc:
                try:
                    self.workspace.native_update(run_id, {"last_control_error": {"action": "reconcile", "message": str(exc), "at": utc()}},
                                                 event="native.reconcile_error")
                except Exception:
                    pass

    def reconcile(self, run_id):
        with self.lock:
            run, root = self._record(run_id), self.root(run_id)
            result = root / "outcome.json"
            if run["state"] == "prepared" and not (root / "request.json").exists() and not (root / "launch.json").exists():
                return run
            if result.exists():
                raw = result.read_bytes()
                outcome = json.loads(raw)
                if outcome.get("run_id") != run_id or outcome.get("dagster_run_id") != run["dagster_run_id"]:
                    raise Problem("native_identity_mismatch", "The outcome belongs to a different original operation", 409)
                if outcome.get("source_sha256") != run["source_sha256"] or outcome.get("contract_sha256") != run["contract_sha256"]:
                    raise Problem("native_input_mismatch", "The original outcome does not match the selected source/contract", 409)
                for entry in outcome.get("evaluation", {}).get("artifact_files", []):
                    p = root / "artifacts" / path_name(entry["path"])
                    if not p.is_file() or p.stat().st_size != entry["bytes"] or sha(p.read_bytes()) != entry["sha256"]:
                        raise Problem("native_artifact_changed", "A completed original artifact is missing or changed", 409, {"path": entry["path"]})
                if run.get("outcome_sha256") == sha(raw) and run.get("state") == outcome["state"]:
                    return run
                return self.workspace.native_update(run_id, {"state": outcome["state"],
                       "request_dispatched": bool(outcome["request_dispatched"]), "outcome": outcome,
                       "outcome_sha256": sha(raw)}, event="native.outcome_adopted")
            if not self._belongs_here(run_id):
                return self.workspace.native_update(run_id, {"recovery_note": "Received history keeps the originating runtime and native identities. Select a new run with this machine's binding; this receiver does not signal or redispatch the original machine."}, event="native.received_history")
            worker_file = root / "worker.json"
            worker = read_json(worker_file) if worker_file.exists() else None
            launch_file = root / "launch.json"
            launch = read_json(launch_file) if launch_file.exists() else None
            identity = (worker or launch or {}).get("identity")
            if process_alive(identity):
                dispatched = (root / "dagster-run.json").exists()
                return self.workspace.native_update(run_id, {"state": "running" if dispatched else "launching",
                    "request_dispatched": dispatched, "worker": worker or launch}, event="native.observed_alive")
            setup = root / "setup-failure.json"
            if setup.exists() and not (root / "dagster-run.json").exists():
                error = read_json(setup)
                if error.get("attempt_id") == run.get("launch_attempt"):
                    return self.workspace.native_update(run_id, {"state": "setup_failed", "request_dispatched": False,
                        "setup_error": error}, event="native.setup_failed")
            if (root / "request.json").exists() and native_available(self.workspace.root):
                request = read_json(root / "request.json")
                try:
                    reader = subprocess.run([request["python_executable"], str(self.workspace.source_root / "runner.py"),
                                             "reconcile", "--request", str(root / "request.json")],
                                            cwd=self.workspace.source_root, stdin=subprocess.DEVNULL,
                                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
                    if result.exists():
                        return self.reconcile(run_id)
                    no_run = root / "native-absence.json"
                    if reader.returncode == 0 and no_run.exists():
                        observation = read_json(no_run)
                        if observation.get("dagster_run_id") == run["dagster_run_id"]:
                            return self.workspace.native_update(run_id, {"state": "setup_failed", "request_dispatched": False,
                                "native_absence": observation}, event="native.original_run_absent")
                except (OSError, subprocess.TimeoutExpired):
                    pass
            # No final worker response is not proof that the database operation failed or never ran.
            return self.workspace.native_update(run_id, {"state": "interrupted",
                "request_dispatched": bool(run.get("request_dispatched") or (root / "dagster-run.json").exists()),
                "recovery_note": "The original worker has ended without a retained final outcome. Inspect its original Dagster run; no replacement command was started."},
                event="native.interrupted")

    def cancel(self, run_id):
        with self.lock:
            run, root = self._record(run_id), self.root(run_id)
            if not self._belongs_here(run_id):
                raise Problem("origin_runtime_required", "Received native history cannot signal its originating machine; select new local work", 409)
            if run["state"] in {"succeeded", "failed", "cancelled"}:
                return run
            root.mkdir(parents=True, exist_ok=True)
            stop = root / "stop.json"
            if not stop.exists():
                durable_write(stop, packed({"run_id": run_id, "requested_at": utc()}))
            worker_file, launch_file = root / "worker.json", root / "launch.json"
            selected = read_json(worker_file) if worker_file.exists() else read_json(launch_file) if launch_file.exists() else {}
            identity = selected.get("identity")
            if process_alive(identity):
                # The worker was created in its own process group; verify the same process still owns it.
                pid = identity["pid"]
                if os.getpgid(pid) == pid and process_alive(identity):
                    os.killpg(pid, signal.SIGINT)
            update = {"stop_requested": True}
            if not process_alive(identity) and not (root / "dagster-run.json").exists() and not run.get("request_dispatched") and native_available(self.workspace.root):
                update.update(state="cancelled", request_dispatched=False, cancelled_before_dispatch=True)
            return self.workspace.native_update(run_id, update, event="native.stop_requested")

    def logs(self, run_id, *, offset=0, limit=65536):
        run = self._record(run_id)
        offset, limit = int(offset), int(limit)
        if offset < 0 or not 1 <= limit <= 262144: raise Problem("invalid_page", "Invalid native log page")
        path = self.root(run_id) / "output.log"
        if not path.exists():
            return {"id": run_id, "offset": offset, "next_offset": offset, "content": "", "content_base64": "",
                    "bytes": 0, "has_more": False, "finished": run["state"] in {"succeeded", "failed", "cancelled", "setup_failed", "interrupted"}}
        with open(path, "rb") as f:
            f.seek(offset); data = f.read(limit)
        return {"id": run_id, "offset": offset, "next_offset": offset + len(data), "bytes": len(data),
                "content": data.decode("utf-8", "replace"), "content_base64": base64.b64encode(data).decode("ascii"),
                "finished": run["state"] in {"succeeded", "failed", "cancelled", "setup_failed", "interrupted"},
                "has_more": offset + len(data) < path.stat().st_size}

    def artifact(self, run_id, name):
        run = self._record(run_id)
        name = path_name(name)
        entry = next((x for x in (run.get("outcome") or {}).get("evaluation", {}).get("artifact_files", []) if x["path"] == name), None)
        if not entry: raise Problem("artifact_missing", "Select an artifact retained by this original outcome", 404)
        data = (self.root(run_id) / "artifacts" / name).read_bytes()
        if len(data) != entry["bytes"] or sha(data) != entry["sha256"]:
            raise Problem("artifact_changed", "The selected original artifact changed", 409)
        return {**entry, "content_base64": base64.b64encode(data).decode("ascii")}

#!/usr/bin/env python3
"""Observe the existing SCF native process and preserve its complete continuation.

Both SCF producers use this controller in their own process. Each phase launches
one original command in an owned process group. The controller streams the full
log, records actual host/process identity and keeps a portable atomic journal.
"""
from __future__ import annotations

import argparse
import codecs
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import uuid

SCHEMA = "stellar-forge.native-process.v1"


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")



class ContinuationConsole:
    """Keep producer output writable when its original terminal disconnects."""
    def __init__(self, original, path):
        self.original = original
        self.fallback_path = Path(path)
        self.fallback = None
        self.encoding = getattr(original, "encoding", "utf-8")

    def write(self, value):
        if self.fallback is not None:
            return self.fallback.write(value)
        try:
            written = self.original.write(value)
            self.original.flush()
            return written
        except (BrokenPipeError, OSError):
            self.fallback_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.fallback = self.fallback_path.open("a", encoding="utf-8", buffering=1)
            self.fallback_path.chmod(0o600)
            return self.fallback.write(value)

    def flush(self):
        if self.fallback is not None:
            self.fallback.flush()
        else:
            try:
                self.original.flush()
            except (BrokenPipeError, OSError):
                pass

    def isatty(self):
        return self.fallback is None and self.original.isatty()

    def fileno(self):
        return (self.fallback or self.original).fileno()


def preserve_console(path):
    if not isinstance(sys.stdout, ContinuationConsole):
        sys.stdout = ContinuationConsole(sys.stdout, path)


def file_identity(path):
    digest = hashlib.sha256()
    size = 0
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return {"bytes": size, "sha256": digest.hexdigest()}


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".new")
    try:
        with temporary.open("x", encoding="utf-8") as out:
            os.chmod(temporary, 0o600)
            json.dump(value, out, ensure_ascii=False, indent=2, allow_nan=False)
            out.write("\n")
            out.flush()
            os.fsync(out.fileno())
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def process_identity(pid):
    result = {"pid": pid, "host_id": socket.gethostname()}
    try:
        result["boot_id"] = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        result["pid_namespace"] = os.readlink("/proc/%s/ns/pid" % pid)
        raw = Path("/proc/%s/stat" % pid).read_text()
        # The process name can itself contain spaces and closing parentheses.
        fields = raw[raw.rfind(")") + 2:].split()
        result["start_ticks"] = fields[19]
        result["process_state"] = fields[0]
    except (OSError, IndexError):
        pass
    return result


def memory_observation(pid=None):
    result = {}
    for name in ("memory.events", "memory.current", "memory.max", "memory.peak"):
        try:
            result[name] = (Path("/sys/fs/cgroup") / name).read_text().strip()
        except OSError:
            pass
    if pid is not None:
        try:
            for row in Path("/proc/%s/status" % pid).read_text().splitlines():
                if row.startswith("VmRSS:"):
                    result["process_rss_kib"] = int(row.split()[1])
        except (OSError, ValueError):
            pass
    return result


def runtime_manifest(runtime):
    runtime = Path(runtime)
    rows = []
    for path in sorted(runtime.rglob("*")):
        if "__pycache__" in path.parts or path.suffix == ".pyc":
            continue
        if path.is_symlink():
            raise ValueError("Retain ordinary runtime files: " + str(path))
        if path.is_file():
            rows.append({"path": path.relative_to(runtime).as_posix(), **file_identity(path)})
    return rows


def retain_runtime_edition(runtime, case_root):
    """Keep the complete prior runtime once for each distinct source edition."""
    runtime, case_root = Path(runtime), Path(case_root)
    rows = runtime_manifest(runtime)
    encoded = json.dumps(rows, sort_keys=True, separators=(",", ":")).encode("utf-8")
    edition = hashlib.sha256(encoded).hexdigest()
    root = case_root / "runtime-editions" / edition
    if not root.exists():
        stage = root.with_name(edition + "." + uuid.uuid4().hex + ".new")
        stage.mkdir(parents=True, mode=0o700)
        try:
            for row in rows:
                target = stage / "files" / row["path"]
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                shutil.copyfile(runtime / row["path"], target)
                target.chmod(0o600)
            write_json(stage / "manifest.json", {
                "schema": "stellar-forge.receiving-runtime-edition.v1",
                "edition": edition, "files": rows,
            })
            stage.rename(root)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
    return {"edition": edition, "path": root.relative_to(case_root).as_posix(),
            "files": len(rows)}


def record_runtime_selection(runtime, case_root, previous_edition):
    rows = runtime_manifest(runtime)
    value = {"schema": "stellar-forge.receiving-runtime-selection.v1",
             "previous_edition": previous_edition, "files": rows}
    path = Path(case_root) / "runtime-selection.json"
    write_json(path, value)
    return {"path": str(path), **file_identity(path),
            "previous_edition": previous_edition}


class NativeProcessController:
    def __init__(self, operation_id, root, record_path, source_context, stream=True):
        if not isinstance(operation_id, str) or not operation_id:
            raise ValueError("Keep the complete original operation ID")
        self.root = Path(root).resolve()
        self.record_path = Path(record_path).resolve()
        self.stream = stream
        self.started = time.monotonic()
        self.record = {
            "schema": SCHEMA, "operation_id": operation_id,
            "native_root": str(self.root), "record": str(self.record_path),
            "host_id": socket.gethostname(), "bootstrap_pid": os.getpid(),
            "controller_identity": process_identity(os.getpid()),
            "started_utc": utc_now(), "state": "PREPARING",
            "source_commit": source_context.get("source_commit"),
            "source": copy.deepcopy(source_context), "phases": {},
            "memory_before": memory_observation(), "artifacts": [],
        }
        self._save()

    def _save(self):
        self.record["observed_at"] = utc_now()
        console = getattr(sys.stdout, "fallback_path", None)
        if console is not None and console.is_file():
            self.record["detached_console"] = str(console)
        write_json(self.record_path, self.record)

    def _emit(self, text):
        if not self.stream:
            return
        try:
            print(text, end="", flush=True)
        except (BrokenPipeError, OSError):
            # A detached terminal must not abandon an already accepted process.
            self.stream = False

    def _stop_owned(self, process, phase):
        if process.poll() is not None:
            return
        phase["termination"] = {"requested_at": utc_now(), "signal": "SIGTERM"}
        self._save()
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            phase["termination"]["signal"] = "SIGKILL"
            phase["termination"]["forced_at"] = utc_now()
            self._save()
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                return
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                phase["termination"]["state"] = "process_exit_pending"
                self._save()

    def run(self, name, command, log_path, *, cwd, env, timeout_seconds, progress_path=None):
        if name in self.record["phases"]:
            raise ValueError("Keep each original command phase once: " + name)
        if not isinstance(command, (list, tuple)) or not command or any(
                not isinstance(part, str) or not part for part in command):
            raise ValueError("Supply the original command as a complete argument array")
        if timeout_seconds <= 0:
            raise ValueError("Use a positive native phase timeout")
        log_path = Path(log_path)
        log_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        phase = {
            "state": "STARTING", "command": list(command), "cwd": str(cwd),
            "started_utc": utc_now(), "stdout": str(log_path), "stderr": str(log_path),
            "timeout_seconds": timeout_seconds, "timed_out": False,
            "pid": None, "exit_code": None,
        }
        self.record["phases"][name] = phase
        self.record["state"] = "RUNNING"
        self.record["current_phase"] = name
        self._save()
        process, interrupted, failure = None, False, None
        began = time.monotonic()
        maximum_rss = None
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        progress_signature = None
        if progress_path is not None:
            try:
                previous_progress = Path(progress_path).stat()
                progress_signature = (previous_progress.st_mtime_ns, previous_progress.st_size)
            except OSError:
                pass
        next_heartbeat = began + 10
        next_memory = began

        def drain(reader, complete=False):
            count = 0
            while complete or count < 4:
                chunk = reader.read(65536)
                if not chunk:
                    break
                self._emit(decoder.decode(chunk))
                count += 1

        def progress():
            nonlocal progress_signature
            if progress_path is None:
                return False
            try:
                selected = Path(progress_path)
                stat = selected.stat()
                signature = (stat.st_mtime_ns, stat.st_size)
                if signature == progress_signature:
                    return False
                value = json.loads(selected.read_text(encoding="utf-8"))
                if not isinstance(value, dict):
                    return False
                operations = [value[key] for key in ("operation", "operationId", "operation_id")
                              if value.get(key) is not None]
                if any(operation != self.record["operation_id"] for operation in operations):
                    phase["progress_issue"] = "The progress file names a different operation"
                    return False
                phase["progress"] = value
                phase["progress_source"] = str(selected)
                progress_signature = signature
                return True
            except (OSError, UnicodeError, json.JSONDecodeError):
                # The browser may be between truncate and write. Its complete
                # next version is read without replacing the last good version.
                return False

        with log_path.open("xb") as log:
            log_path.chmod(0o600)
            try:
                process = subprocess.Popen(
                    list(command), cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                    stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                )
                phase.update(state="RUNNING", pid=process.pid,
                             process_identity=process_identity(process.pid))
                self._save()
                self._emit("SCF_NATIVE_PROCESS " + json.dumps({
                    "operation_id": self.record["operation_id"], "phase": name,
                    "host_id": self.record["host_id"], "pid": process.pid,
                    "record": str(self.record_path),
                }) + "\n")
                with log_path.open("rb") as reader:
                    while process.poll() is None:
                        drain(reader)
                        changed = progress()
                        now = time.monotonic()
                        if now >= next_memory:
                            sample = memory_observation(process.pid)
                            phase["memory"] = sample
                            if "process_rss_kib" in sample:
                                maximum_rss = max(maximum_rss or 0, sample["process_rss_kib"])
                            next_memory = now + 2
                        if changed or now >= next_heartbeat:
                            self._save()
                            next_heartbeat = now + 10
                        if now - began >= timeout_seconds:
                            phase["timed_out"] = True
                            self._stop_owned(process, phase)
                            break
                        time.sleep(0.4)
                    drain(reader, complete=True)
                    progress()
                    self._emit(decoder.decode(b"", final=True))
            except KeyboardInterrupt:
                interrupted = True
            except Exception as exc:
                failure = {"type": type(exc).__name__, "message": str(exc)}
            finally:
                if process is not None and process.poll() is None:
                    self._stop_owned(process, phase)
                if process is not None:
                    phase["exit_code"] = process.poll()
        if failure:
            phase["error"] = failure
        phase["interrupted"] = interrupted
        phase["completed_utc"] = utc_now()
        phase["duration_seconds"] = round(time.monotonic() - began, 3)
        phase["maximum_observed_rss_kib"] = maximum_rss
        phase["stdout_identity"] = file_identity(log_path)
        phase["stderr_identity"] = phase["stdout_identity"]
        phase["state"] = (
            "INTERRUPTED" if interrupted else
            "TIMED_OUT" if phase["timed_out"] else
            "LAUNCH_FAILED" if process is None else
            "FAILED" if failure or phase["exit_code"] != 0 else "COMPLETE"
        )
        self.record["state"] = "PHASE_COMPLETE" if phase["state"] == "COMPLETE" else "INCOMPLETE"
        self._save()
        return copy.deepcopy(phase)

    def finish(self, state, application_result=None, error=None):
        if state not in ("COMPLETE", "INCOMPLETE", "INTERRUPTED"):
            raise ValueError("Use the observed application completion state")
        self.record["state"] = state
        self.record["completed_utc"] = utc_now()
        self.record["duration_seconds"] = round(time.monotonic() - self.started, 3)
        self.record["memory_after"] = memory_observation()
        if application_result:
            self.record["application_result"] = {
                "path": str(application_result), **file_identity(application_result),
            }
        if error:
            self.record["error"] = copy.deepcopy(error)
        self._save()
        return copy.deepcopy(self.record)


def run_receiving_program(operation_id, root, output, source_context, node, chromium,
                          driver, config_path, cwd, env, timeout_seconds, phase_name,
                          engine="browser"):
    """Run the original browser or prepared-model programme with one controller."""
    if engine not in ("browser", "native"):
        raise ValueError("Select the original browser or native review engine")
    root, output = Path(root), Path(output)
    controller = NativeProcessController(
        operation_id, root, output / "native-process.json", source_context)
    controller.record["engine"] = engine
    commands = [
        ("javascript-parse", [str(node), "--check", str(driver)], 30, False),
        ("node-version", [str(node), "--version"], 30, False),
    ]
    execution_names = [phase_name]
    if engine == "browser":
        if chromium is None:
            raise ValueError("The original browser programme requires its selected Chromium")
        commands.append(("browser-version", [str(chromium), "--version"], 30, False))
        commands.append((phase_name, [str(node), str(driver), str(config_path)], timeout_seconds, True))
        progress_name = "progress.json"
    else:
        native_command = [
            str(node), "--max-old-space-size=256", "--expose-gc", str(driver), str(config_path),
        ]
        verification_name = "independent-native-receiving"
        execution_names.append(verification_name)
        commands.extend([
            (phase_name, native_command, timeout_seconds, True),
            (verification_name, native_command + ["--verify"], timeout_seconds, True),
        ])
        progress_name = "prepared-native-progress.json"
    deadline = None
    for name, command, timeout, execution in commands:
        if execution:
            if deadline is None:
                deadline = time.monotonic() + timeout_seconds
            timeout = deadline - time.monotonic()
            if timeout <= 0:
                phase = {
                    "state": "NOT_STARTED", "command": command, "pid": None,
                    "exit_code": None, "timed_out": True,
                    "reason": "The original receiving timeout elapsed before this phase",
                    "observed_at": utc_now(),
                }
                controller.record["phases"][name] = phase
                controller.record["current_phase"] = name
                controller._save()
                break
        log = output / ("native-process.log" if name == phase_name else name + ".log")
        phase = controller.run(
            name, command, log, cwd=cwd, env=env, timeout_seconds=timeout,
            progress_path=output / progress_name if execution else None)
        if phase["state"] != "COMPLETE":
            break
    result_path = output / "RESULT.json"
    result, result_error = None, None
    if phase_name in controller.record["phases"] and result_path.is_file():
        try:
            result = json.loads(result_path.read_text(encoding="utf-8"))
            if not isinstance(result, dict):
                raise ValueError("The original receiving result must be a JSON object")
            identifiers = [result[key] for key in ("operation", "operationId", "operation_id")
                           if result.get(key) is not None]
            if any(identifier != operation_id for identifier in identifiers):
                raise ValueError("The receiving result names a different original operation")
        except (OSError, ValueError, UnicodeError) as exc:
            result_error = {"type": type(exc).__name__, "message": str(exc)}
            result = None
    complete = (
        all(controller.record["phases"].get(name, {}).get("state") == "COMPLETE"
            for name in execution_names)
        and result is not None and result.get("state") == "COMPLETE"
    )
    state = "COMPLETE" if complete else "INCOMPLETE"
    native = controller.finish(
        state, application_result=result_path if result_path.is_file() else None,
        error=result_error)
    native["processExit"] = phase["exit_code"]
    native["timedOut"] = any(row.get("timed_out") for row in native["phases"].values())
    native["durationSeconds"] = native["duration_seconds"]
    observations = [native["phases"].get(name, {}).get("maximum_observed_rss_kib")
                    for name in execution_names]
    native["nodeMaxObservedRssKiB"] = max(
        (value for value in observations if value is not None), default=None)
    native["nodeVersion"] = (
        (output / "node-version.log").read_text(errors="replace").strip()
        if (output / "node-version.log").is_file() else None)
    native["browserVersion"] = (
        (output / "browser-version.log").read_text(errors="replace").strip()
        if engine == "browser" and (output / "browser-version.log").is_file() else None)
    return native, result


def inspect_record(path):
    """Read an existing record and observe only identities from this same host."""
    record = json.loads(Path(path).read_text(encoding="utf-8"))
    if record.get("schema") != SCHEMA:
        raise ValueError("Select an original SCF native process record")
    live = []
    for name, phase in record.get("phases", {}).items():
        expected = phase.get("process_identity")
        if not expected:
            continue
        current = process_identity(expected["pid"])
        keys = ("host_id", "boot_id", "pid_namespace", "start_ticks")
        if not all(key in expected for key in keys):
            state = "identity_unavailable"
        elif not all(key in current for key in keys):
            state = "not_observed_in_current_namespace"
        elif all(current[key] == expected[key] for key in keys):
            state = ("same_process_exited_zombie" if current.get("process_state") == "Z"
                     else "same_process_observed")
        else:
            state = "different_process_or_namespace"
        live.append({"phase": name, "identity_state": state,
                     "expected": expected, "observed": current})
    return {"record": record, "observed_at": utc_now(), "process_observations": live}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inspect", type=Path, required=True,
                        help="Read an existing native-process.json and its current process identity")
    args = parser.parse_args()
    print(json.dumps(inspect_record(args.inspect), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

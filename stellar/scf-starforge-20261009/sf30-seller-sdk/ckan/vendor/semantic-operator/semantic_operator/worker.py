"""One durable native RDF operation. Every attempt consumes the same pinned inputs."""
from __future__ import annotations
import argparse
import contextlib
import fcntl
import os
from pathlib import Path
import resource
import signal
import socket
import sys
import time
import traceback
from .security import atomic_write, canonical, digest, private_directory, private_read, read_json, MAX_FILE
from .store import identifier, now

JOB_SCHEMA = "commons-semantic-native-job/1"
DATASET_JOB_SCHEMA = "commons-semantic-native-job/2"
RESULT_SCHEMA = "commons-semantic-native-result/1"
TERMINAL = {"complete", "failed", "cancelled", "interrupted"}

def job_schema(job):
    if not isinstance(job, dict) or not isinstance(job.get("parameters"), dict):
        raise ValueError("A native job must retain its original parameter object.")
    schema = job.get("schema")
    if schema == JOB_SCHEMA and job["parameters"].get("data_model") != "dataset":
        return schema
    if schema == DATASET_JOB_SCHEMA and job["parameters"].get("data_model") == "dataset":
        return schema
    raise ValueError("The native job schema and graph/dataset model do not agree.")

def relative(name):
    if (not isinstance(name, str) or not name or "\\" in name or "\0" in name
        or Path(name).is_absolute() or any(x in ("", ".", "..") for x in name.split("/"))):
        raise ValueError("A native member requires a normalized relative path.")
    return name

def load_state(operation):
    path = Path(operation) / "state.json"
    return read_json(private_read(path)) if path.exists() else None

def verified_result(operation):
    operation = Path(operation)
    state = load_state(operation)
    if not state or state.get("status") != "complete":
        return None
    raw = private_read(operation / "result.json")
    if digest(raw) != state.get("result_sha256"):
        raise ValueError("The original completed native result changed.")
    result = read_json(raw)
    job_raw = private_read(operation / "job.json")
    job = read_json(job_raw)
    job_schema(job)
    if (result.get("schema") != RESULT_SCHEMA or result.get("job_id") != job["job_id"]
        or result.get("job_sha256") != digest(job_raw)
        or result.get("generation") != state.get("generation")
        or result.get("action") != job["action"]):
        raise ValueError("The native result does not belong to this original job.")
    outputs = operation / "attempts" / str(result["generation"]) / "outputs"
    seen = set()
    for item in result["files"]:
        name = relative(item["path"])
        if name in seen:
            raise ValueError("The native result repeats an output.")
        seen.add(name)
        body = private_read(outputs / name)
        if len(body) != item["bytes"] or digest(body) != item["sha256"]:
            raise ValueError("A completed native output changed or is incomplete.")
    actual = {str(path.relative_to(outputs)) for path in outputs.rglob("*") if path.is_file()}
    if actual != seen:
        raise ValueError("The original result manifest does not describe all native outputs.")
    return result

def _prevent_network():
    def denied(*args, **kwargs):
        raise PermissionError("Native semantic jobs read only their pinned local inputs.")
    socket.create_connection = denied
    socket.socket.connect = denied
    socket.socket.connect_ex = denied

def _parent_lifecycle():
    if sys.platform.startswith("linux"):
        import ctypes
        parent = os.getppid()
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
            raise OSError(ctypes.get_errno(), "Cannot bind the native worker to its supervisor.")
        if os.getppid() != parent or parent == 1:
            raise InterruptedError("The original native supervisor has closed.")

def run(operation):
    operation = private_directory(operation, create=False)
    fd = os.open(operation / "native.lock", os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    os.chmod(operation / "native.lock", 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 75
        # The state is read only after ownership is acquired.
        existing = verified_result(operation)
        if existing:
            return 0
        raw = private_read(operation / "job.json")
        job = read_json(raw)
        if job_schema(job) not in (JOB_SCHEMA, DATASET_JOB_SCHEMA) or job.get("action") not in ("inspect", "snapshot", "validate", "query", "compare"):
            raise ValueError("Choose a supported original semantic job.")
        identifier(job["job_id"], "Native job ID")
        prior = load_state(operation) or {}
        if prior and (prior.get("job_id") != job["job_id"] or prior.get("job_sha256") != digest(raw)):
            raise ValueError("The saved native operation belongs to different inputs.")
        if (operation / "cancel.json").exists():
            state = {**prior, "job_id":job["job_id"], "job_sha256":digest(raw), "status":"cancelled", "updated_at":now()}
            atomic_write(operation / "state.json", canonical(state))
            return 130
        generation = int(prior.get("generation", 0)) + 1
        attempt = private_directory(operation / "attempts" / str(generation))
        outputs = private_directory(attempt / "outputs")
        if any(outputs.iterdir()):
            raise ValueError("The next native attempt directory already contains unadopted output.")
        state = {"schema":"commons-semantic-native-state/1", "job_id":job["job_id"],
                 "job_sha256":digest(raw), "status":"running", "generation":generation,
                 "started_at":now(), "updated_at":now(), "action":job["action"]}
        atomic_write(operation / "state.json", canonical(state))
        old_handlers = {}
        def interrupted(signum, frame):
            if signum == getattr(signal, "SIGXCPU", -1):
                raise TimeoutError("The native operation reached its CPU time budget.")
            raise InterruptedError("The original native operation was interrupted.")
        for sig in (signal.SIGTERM, signal.SIGINT, getattr(signal, "SIGXCPU", signal.SIGTERM)):
            if sig not in old_handlers:
                old_handlers[sig] = signal.signal(sig, interrupted)
        started = time.monotonic()
        try:
            _parent_lifecycle()
            limits = job.get("limits", {})
            seconds = limits.get("timeout_seconds", 120)
            memory = limits.get("memory_mib", 1024)
            if type(seconds) is not int or not 5 <= seconds <= 600 or type(memory) is not int or not 256 <= memory <= 4096:
                raise ValueError("Choose a timeout from 5–600 seconds and memory from 256–4,096 MiB.")
            resource.setrlimit(resource.RLIMIT_CPU, (seconds, seconds + 5))
            resource.setrlimit(resource.RLIMIT_AS, (memory * 1024 * 1024, memory * 1024 * 1024))
            input_paths = {}
            for item in job["inputs"]:
                key = identifier(item["key"], "Native input key")
                if key in input_paths:
                    raise ValueError("Native input keys must be unique.")
                if job.get("input_storage") != "workspace-content-addressed/1" or operation.parent.name != "native-jobs":
                    raise ValueError("The native job must use its original workspace source store.")
                source_root = private_directory(operation.parent.parent / "sources", create=False)
                sha = item["sha256"]
                if not isinstance(sha, str) or len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
                    raise ValueError("A native source SHA-256 is invalid.")
                path = source_root / (sha + ".bin")
                data = private_read(path)
                if len(data) != item["bytes"] or digest(data) != item["sha256"]:
                    raise ValueError("A native input differs from its original pinned bytes.")
                input_paths[key] = path
            if not input_paths:
                raise ValueError("A native job requires its complete original input set.")
            _prevent_network()
            from .rdf_engine import execute
            native = execute(job, input_paths, outputs)
            expected_engine_schema = "commons-semantic-native-engine-result/" + ("2" if job["schema"] == DATASET_JOB_SCHEMA else "1")
            if (not isinstance(native, dict) or native.get("schema") != expected_engine_schema
                or native.get("action") != job["action"] or not isinstance(native.get("summary"), dict)
                or not isinstance(native.get("files"), list) or not native["files"]):
                raise ValueError("The native RDF engine did not return a complete result.")
            files, seen = [], set()
            for item in native["files"]:
                name = relative(item["path"])
                if name in seen:
                    raise ValueError("The native engine repeated an output.")
                seen.add(name)
                body = private_read(outputs / name)
                if not isinstance(item.get("media_type"), str) or not isinstance(item.get("role"), str):
                    raise ValueError("Each native output needs its media type and role.")
                files.append({**item, "bytes":len(body), "sha256":digest(body)})
            actual = {str(path.relative_to(outputs)) for path in outputs.rglob("*") if path.is_file()}
            if actual != seen:
                raise ValueError("The native engine must name every retained output.")
            if (operation / "cancel.json").exists():
                raise InterruptedError("Cancellation was recorded before native result adoption.")
            result = {"schema":RESULT_SCHEMA, "job_id":job["job_id"], "job_sha256":digest(raw),
                      "generation":generation, "action":job["action"], "summary":native["summary"],
                      "warnings":native.get("warnings", []), "files":files,
                      "started_at":state["started_at"], "completed_at":now(),
                      "elapsed_seconds":round(time.monotonic()-started, 6)}
            if job["schema"] == DATASET_JOB_SCHEMA:
                result.update(engine_schema=native["schema"], engine_source=native.get("engine_source", {}))
            encoded = canonical(result)
            atomic_write(operation / "result.json", encoded)
            atomic_write(attempt / "result.json", encoded)
            state.update(status="complete", result_sha256=digest(encoded), updated_at=now())
            atomic_write(operation / "state.json", canonical(state))
            return 0
        except BaseException as exc:
            # Keep any partial attempt outputs. A continuation uses a new generation
            # of this original job and consumes the identical pinned inputs.
            state.update(status="cancelled" if (operation / "cancel.json").exists()
                         else "interrupted" if isinstance(exc, InterruptedError) else "failed",
                         error={"type":type(exc).__name__, "message":str(exc)[:3000]},
                         updated_at=now(), elapsed_seconds=round(time.monotonic()-started, 6))
            with contextlib.suppress(Exception):
                atomic_write(attempt / "error.json", canonical(state))
                atomic_write(operation / "state.json", canonical(state))
            return 130 if state["status"] == "cancelled" else 1
        finally:
            for sig, handler in old_handlers.items():
                signal.signal(sig, handler)
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    raise SystemExit(run(args.operation))

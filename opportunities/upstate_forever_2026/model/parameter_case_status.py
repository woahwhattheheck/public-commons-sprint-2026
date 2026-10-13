"""Read original native case attempts and logs through a saved study binding."""
from __future__ import annotations

import os
import re

from .common import digest, file_digest, identifier, read_json, relative_file
from .native_execution import inspect_execution
from .native_worker import identity_matches
from .parameter_views import DEFAULT_VIEWS, _study_active, _bind_case

SCHEMA = "upstate.parameter-case-console/v1"


def _json(workspace, directory, name, *, optional=True):
    path = directory / name
    if optional and not path.exists():
        return None
    selected = relative_file(workspace.root, path.relative_to(workspace.root).as_posix())
    value = read_json(selected)
    if not isinstance(value, dict):
        raise ValueError("The original native receipt must contain an object: " + name)
    return value


def _worker_receipt(workspace, directory, name, request):
    value = _json(workspace, directory, name)
    if value is None:
        return None
    if (value.get("execution_id") != request["execution_id"]
            or value.get("request_sha256", request["request_sha256"]) != request["request_sha256"]):
        raise ValueError("The retained worker receipt belongs to another original request: " + name)
    return value


def _supervised(workspace, run, directory):
    request = _json(workspace, directory, "request.json", optional=False)
    if (request.get("schema") != "upstate.native-worker-request/v1"
            or request.get("execution_id") != directory.name
            or request.get("project_id") != workspace.project["id"]
            or request.get("run_id") != run["id"]
            or request.get("selection") != run["selection"]):
        raise ValueError("The worker request differs from this original native case")
    wanted = digest({name: value for name, value in request.items() if name != "request_sha256"})
    if request.get("request_sha256") != wanted:
        raise ValueError("The retained worker request identity changed")
    records = {name: _worker_receipt(workspace, directory, name + ".json", request)
               for name in ("worker", "launch", "heartbeat", "failure", "finished",
                            "supervision", "result")}
    interruption = _worker_receipt(workspace, directory, "completed-interruption.json", request)
    if interruption is not None:
        failure = interruption.get("error")
        process = failure.get("process") if isinstance(failure, dict) else None
        if (interruption.get("schema") != "upstate.completed-native-interruption/v1"
                or interruption.get("request_sha256") != request["request_sha256"]
                or interruption.get("run_id") != run["id"]
                or not isinstance(failure, dict) or failure.get("run_id") != run["id"]
                or failure.get("completed_result_retained") is not True
                or type(failure.get("return_code")) is not int or failure["return_code"] >= 0
                or not isinstance(process, dict)
                or process.get("execution_id") != request["execution_id"]
                or process.get("request_sha256") != request["request_sha256"]):
            raise ValueError("The retained completed-worker interruption differs from its original request")
    records["completed_interruption"] = interruption
    worker = records["worker"] or records["launch"] or {}
    identity = worker.get("identity")
    alive = bool(isinstance(identity, dict) and identity_matches(identity))
    supervision = records["supervision"] or {}
    failure = records["failure"] or {}
    result = records["result"]
    if result and (result.get("result", {}).get("id") != run["id"]
                   or result["result"].get("selection") != run["selection"]
                   or result["result"].get("state") != "complete"):
        raise ValueError("The saved worker result differs from this original native case")
    # Process history survives a later successful verification of the same result.
    # The native result and latest supervision remain separately available.
    original_failure = interruption["error"] if interruption is not None else None
    status = ("interrupted_after_completion" if original_failure else
              "complete" if result else "running" if alive else
              supervision.get("state") or ("failed" if failure else "ended_without_receipt"))
    heartbeat = records["heartbeat"] or {}
    resources = None
    for label, record in (("worker heartbeat", heartbeat), ("worker start", worker)):
        if (record.get("identity") == identity and isinstance(record.get("resources"), dict)):
            resources = {"source": label, "observed_at": record.get("at") or record.get("started_at"),
                         "values": record["resources"]}
            break
    return {"id": "worker:" + directory.name, "kind": "operator_worker",
            "created_at": request.get("created_at"), "state": status, "alive": alive,
            "pid": (identity or {}).get("pid", worker.get("pid")),
            "task_id": request.get("task_id"), "execution_id": request["execution_id"],
            "request_sha256": request["request_sha256"],
            "request_body_sha256": file_digest(directory / "request.json"),
            "return_code": (original_failure["return_code"] if original_failure
                            else supervision.get("returncode")),
            "error": original_failure or supervision.get("error") or failure or None,
            "completed_result_retained": bool(result),
            "latest_supervision_state": supervision.get("state"),
            "resources": resources, "request": request, "records": records,
            "directory": directory.relative_to(workspace.root).as_posix(),
            "logs": {"process": "process.log"}}


def _isolated_receipt(workspace, directory, name, run_id, request_sha256, pid=None):
    value = _json(workspace, directory, name)
    if value is None:
        return None
    if (value.get("run_id") != run_id
            or value.get("request_sha256", request_sha256) != request_sha256
            or (pid is not None and value.get("pid", pid) != pid)):
        raise ValueError("The retained isolated-process receipt belongs to another case: " + name)
    return value


def _isolated(workspace, run, directory):
    request = _json(workspace, directory, "request.json", optional=False)
    if (request.get("schema") != "upstate.gura-isolated-native-case/v1"
            or request.get("workspace_id") != workspace.project["id"]
            or request.get("run_id") != run["id"]):
        raise ValueError("The retained Gura process selects another original native case")
    # Resolve the physical location within this Workspace; retain the original
    # request's absolute path as provenance after a portable restore.
    sha256 = file_digest(relative_file(
        workspace.root, (directory / "request.json").relative_to(workspace.root).as_posix()))
    process = _isolated_receipt(workspace, directory, "process.json", run["id"], sha256)
    pid = (process or {}).get("pid")
    returned = _isolated_receipt(workspace, directory, "return.json", run["id"], sha256, pid)
    interruption = _json(workspace, directory, "interruption.json")
    if interruption and (interruption.get("run_id") != run["id"]
                         or interruption.get("process", {}).get("request_sha256", sha256) != sha256
                         or (pid is not None and interruption.get("process", {}).get("pid") != pid)):
        raise ValueError("The saved Gura interruption differs from its original process")
    code = returned.get("return_code") if returned else None
    status = ("interrupted" if interruption else
              "returned" if returned else "awaiting_return_receipt")
    resources = None
    if returned and isinstance(returned.get("resources_after"), dict):
        resources = {"source": "isolated-process supervisor after return",
                     "observed_at": returned.get("returned_at"),
                     "values": returned["resources_after"]}
    return {"id": "isolated:" + directory.name, "kind": "gura_isolated",
            "created_at": request.get("created_at"), "state": status, "alive": None,
            "pid": pid, "return_code": code, "error": interruption,
            "request_sha256": sha256, "request_body_sha256": sha256,
            "resources": resources, "request": request,
            "records": {"process": process, "return": returned, "interruption": interruption},
            "directory": directory.relative_to(workspace.root).as_posix(),
            "logs": {"stdout": "stdout.log", "stderr": "stderr.log"}}


def _attempts(workspace, run):
    result = []
    roots = (("worker", workspace.root / "runs" / run["id"] / "supervision", 64, _supervised),
             ("isolated", workspace.root / "gura-receiving" / "native-case-processes" / run["id"],
              32, _isolated))
    for prefix, root, length, reader in roots:
        for path in root.glob("*/request.json"):
            if not re.fullmatch("[0-9a-f]{" + str(length) + "}", path.parent.name):
                continue
            key = prefix + ":" + path.parent.name
            try:
                record = reader(workspace, run, path.parent)
                result.append(record)
            except (OSError, ValueError, KeyError, TypeError) as error:
                result.append({"id": key, "kind": prefix, "state": "unavailable",
                               "created_at": None, "error": {"type": type(error).__name__,
                                                           "message": str(error)}})
    return sorted(result, key=lambda row: (row.get("created_at") or "", row["id"]), reverse=True)


def _coordinator_active(workspace):
    """Observe the maintained batch lease without creating or changing its file."""
    path = workspace.root / ".native-model-batch.lock"
    if not path.exists():
        return False
    try:
        import fcntl
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return False
            except BlockingIOError:
                return True
        finally:
            os.close(fd)
    except (ImportError, OSError):
        return None


def _page_number(value, name, default, *, maximum=None):
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        raise ValueError(name + " must be a nonnegative whole number")
    try:
        number = int(value)
    except (ValueError, TypeError, OverflowError):
        raise ValueError(name + " must be a nonnegative whole number") from None
    if number < 0 or str(number) != str(value) or (maximum is not None and number > maximum):
        raise ValueError(name + " must be a nonnegative whole number"
                         + (" no greater than " + str(maximum) if maximum is not None else ""))
    return number


def _log(workspace, run_id, attempt, stream, offset, expected_attempt):
    streams = {"native": "runs/" + run_id + "/native.log"}
    if attempt and attempt.get("directory"):
        streams.update({name: attempt["directory"] + "/" + filename
                        for name, filename in attempt["logs"].items()})
    selected = stream or "native"
    selected_id = attempt["id"] if attempt else None
    reset = bool(expected_attempt and expected_attempt != selected_id)
    if selected not in streams:
        if reset:
            selected = "native"
        else:
            raise ValueError("Choose a log stream retained by this original attempt")
    start = None if reset else _page_number(offset, "Log offset", None)
    relative = streams[selected]
    if not (workspace.root / relative).exists():
        return {"stream": selected, "attempt_id": selected_id, "path": relative,
                "bytes": 0, "offset": 0, "next_offset": 0, "text": "", "reset": reset,
                "available_streams": list(streams)}
    path = relative_file(workspace.root, relative)
    with path.open("rb") as incoming:
        length = os.fstat(incoming.fileno()).st_size
        if start is None:
            start = max(0, length - 65536)
        elif start > length:
            start, reset = 0, True
        incoming.seek(start)
        body = incoming.read(65536)
    return {"stream": selected, "attempt_id": selected_id, "path": relative,
            "bytes": length, "offset": start, "next_offset": start + len(body),
            "text": body.decode("utf-8", "replace"), "reset": reset,
            "available_streams": list(streams)}


def read_run(workspace, run_id, *, attempt_id=None, stream="native",
             log_offset=None, expected_attempt_id=None, history_offset=0, limit=25):
    """Read the common original native receipts after the caller binds its case."""
    run_id = identifier(run_id)
    native = inspect_execution(workspace, run_id, log_bytes=0)
    run = workspace.inspect_run(run_id)
    records = _attempts(workspace, run)
    chosen = (next((record for record in records if record["id"] == attempt_id), None)
              if attempt_id else next((record for record in records
                                       if record["state"] != "unavailable"), None))
    if attempt_id and chosen is None:
        raise ValueError("Choose an attempt retained for this original native case")
    if chosen and chosen["state"] == "unavailable":
        raise ValueError(chosen["error"]["message"])
    offset = _page_number(history_offset, "Attempt offset", 0)
    size = _page_number(limit, "Attempt page size", 25, maximum=100)
    if size == 0:
        raise ValueError("Attempt page size must be positive")
    offset = min(offset, max(0, ((len(records) - 1) // size) * size))
    columns = ("id", "kind", "created_at", "state", "alive", "pid", "task_id",
               "execution_id", "return_code", "request_sha256", "error",
               "completed_result_retained", "latest_supervision_state")
    history = [{name: row.get(name) for name in columns}
               for row in records[offset:offset + size]]
    return {"schema": "upstate.native-case-attempts/v1", "workspace_id": workspace.project["id"],
            "coordinator_active": _coordinator_active(workspace), "native": native,
            "attempt": chosen, "history": {"offset": offset, "limit": size,
                                           "total": len(records), "rows": history},
            "log": _log(workspace, run_id, chosen, stream, log_offset, expected_attempt_id),
            "resource_basis": "Saved observations retain their original observing process. "
                              "Cgroup counters include other processes; a group event does not identify its victim."}


def read(workspace, study_id, run_id, **options):
    """Read one exact saved study case without changing its original state."""
    study_id, run_id = identifier(study_id), identifier(run_id)
    study, matches, context = DEFAULT_VIEWS.case_context(workspace, study_id, run_id)
    cases = [{name: case.get(name) for name in ("id", "label", "run_id", "profile_id", "overrides")}
             for case in matches]
    value = read_run(workspace, run_id, **options)
    # The selected native receipt must still match the original case after reading.
    for case in matches:
        _bind_case(study, case, {"selection": value["native"]["selection"]})
    active = _study_active(workspace.root / "experiments" / study_id)
    visible = "interrupted" if study["state"] == "running" and not active else study["state"]
    return {**value, "schema": SCHEMA, "study_id": study_id,
            "title": study["selection"]["title"], "study_state": visible,
            "study_recorded_state": study["state"], "study_active": active,
            "case_bindings": cases, "context": context,
            "continuation": {"action": "parameter-study.run", "payload": {"experiment_id": study_id},
                             "scope": "The original saved study and its remaining cases",
                             "native_run_argv": value["native"]["continue_argv"]}}

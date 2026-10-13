"""Saved native-run revisions through the original task queue and Workspace."""
from __future__ import annotations

from copy import deepcopy
import re

from model.common import atomic_json, digest, held, identifier, now, read_json
from model.model_selection import normalize_selection, selected

SCHEMA = "upstate.run-revision/v1"
HANDOVER = "upstate.run-revision-handover/v1"
ACTIONS = {"profile": "profile.save", "scenario": "scenario.save",
           "prepare": "run.prepare", "compare": "run.compare"}
KINDS = {"profile": "profiles", "scenario": "scenarios",
         "prepare": "runs", "compare": "comparisons"}
ACTIVE = {"submitting", "queued", "running"}
ERRORS = (ValueError, TypeError, KeyError, OSError)


def _operation(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", value):
        raise ValueError("Retain the original operation identity.")
    return value


def _folder(ws):
    return ws.root / "run-revisions"


def _path(ws, key):
    return _folder(ws) / (identifier(key) + ".json")


def _base(record):
    return {name: record[name] for name in
            ("schema", "project_id", "baseline_run_id", "baseline_selection",
             "title", "operation_id")}


def _selection(value):
    result = {name: value[name] for name in ("grid_id", "profile_id", "scenario_id")}
    result["models"] = list(selected(value))
    return result


def _baseline(ws, record):
    if record["schema"] != SCHEMA or record["project_id"] != ws.project["id"]:
        raise ValueError("Open this revision in its original scientific project.")
    if digest(_base(record)) != record["id"]:
        raise ValueError("The original run revision identity changed.")
    run = ws.inspect_run(record["baseline_run_id"])
    if (run.get("id") != record["baseline_run_id"] or run["state"] != "complete"
            or run["selection"] != record["baseline_selection"]):
        raise ValueError("Retain the original completed reference run and its exact selection.")
    ws.get_grid(run["selection"]["grid_id"])
    ws._get("profiles", run["selection"]["profile_id"])
    ws._get("scenarios", run["selection"]["scenario_id"])
    return run


def _load(ws, key):
    record = read_json(_path(ws, key))
    if record.get("id") != key:
        raise ValueError("The saved revision has another identity.")
    _baseline(ws, record)
    if not isinstance(record.get("operations"), list):
        raise ValueError("Retain the original ordered revision operations.")
    return record


def _request(entry):
    return {"workspace": entry["workspace"], "action": entry["action"],
            "payload": entry["payload"]}


def _validate_entry(entry):
    if entry.get("step") not in ACTIONS or entry.get("action") != ACTIONS[entry["step"]]:
        raise ValueError("Choose an original profile, scenario, run preparation or comparison.")
    _operation(entry["operation_id"])
    if not isinstance(entry.get("payload"), dict):
        raise ValueError("Retain the complete original task request.")
    if digest(_request(entry)) != entry.get("request_sha256"):
        raise ValueError("The retained original task request changed.")
    if entry.get("task_id") is not None:
        identifier(entry["task_id"])


def _task_for(operator, workspace_key, entry):
    """Resolve exactly the submitted operation, including original task aliases."""
    _validate_entry(entry)
    if entry["workspace"] != workspace_key:
        return None
    key = digest({"workspace": workspace_key, "operation_id": entry["operation_id"]})
    direct = operator.root / "tasks" / (key + ".json")
    alias = operator.root / "task-operation-aliases" / (key + ".json")
    if direct.exists() and alias.exists():
        raise ValueError("The original operation has conflicting task and alias records.")
    if alias.exists():
        binding = read_json(alias)
        if (binding.get("schema") != "upstate.operator-operation-alias/v1"
                or binding.get("workspace") != workspace_key
                or binding.get("operation_id") != entry["operation_id"]
                or binding.get("request_sha256") != entry["request_sha256"]):
            raise ValueError("The original task alias differs from this revision.")
        key = identifier(binding["task_id"])
    elif not direct.exists():
        return None
    try:
        task = operator.task(key)
    except FileNotFoundError:
        return None
    if (task.get("id") != key or task.get("workspace") != workspace_key
            or task.get("request_sha256") != entry["request_sha256"]
            or digest({"workspace": task["workspace"], "action": task["action"],
                       "payload": task["payload"]}) != entry["request_sha256"]):
        raise ValueError("The accepted task does not match this exact revision request.")
    if entry.get("task_id") not in (None, key):
        raise ValueError("This revision already retains a different accepted task.")
    return task


def _accept(entry, task):
    entry["task_id"] = task["id"]
    entry["task_available"] = True
    entry["state"] = task["state"]
    entry["accepted_task"] = {key: deepcopy(task[key]) for key in
        ("schema", "id", "operation_id", "workspace", "action", "payload",
         "request_sha256", "created_at", "started_at", "ended_at", "state", "result", "error")
        if key in task}
    entry["result_id"] = (task.get("result") or {}).get("id") if task["state"] == "complete" else None
    if task.get("error"):
        entry["error"] = deepcopy(task["error"])
    else:
        entry.pop("error", None)


def _check_snapshot(entry):
    snapshot = entry.get("accepted_task")
    if snapshot is None:
        if entry.get("state") == "complete" or entry.get("result_id") is not None:
            raise ValueError("Retain the original completed task result for this revision.")
        return
    if (snapshot.get("schema") != "upstate.operator-task/v1"
            or digest({"workspace": snapshot["workspace"],
                       "operation_id": _operation(snapshot["operation_id"])}) != snapshot["id"]
            or snapshot.get("id") != entry.get("task_id")
            or snapshot.get("state") != entry.get("state")
            or snapshot.get("workspace") != entry["workspace"]
            or snapshot.get("request_sha256") != entry["request_sha256"]
            or digest({"workspace": snapshot["workspace"], "action": snapshot["action"],
                       "payload": snapshot["payload"]}) != entry["request_sha256"]):
        raise ValueError("The retained accepted task snapshot changed.")
    result_id = (snapshot.get("result") or {}).get("id") if snapshot["state"] == "complete" else None
    if result_id != entry.get("result_id"):
        raise ValueError("The retained task result identity changed.")


def _derive(ws, record):
    baseline = _baseline(ws, record)
    selection = _selection(record["baseline_selection"])
    revised = comparison = None
    records = {"baseline": baseline}
    for entry in record["operations"]:
        _validate_entry(entry)
        _check_snapshot(entry)
        if entry["state"] != "complete":
            continue
        key = identifier(entry["result_id"])
        step, payload = entry["step"], entry["payload"]
        if entry.get("selection_before") != selection:
            raise ValueError("A saved revision operation belongs to another input selection.")
        if step in ("profile", "scenario"):
            saved = ws._get(KINDS[step], key)
            original = entry["accepted_task"]["result"]
            if saved != original:
                raise ValueError("The saved immutable revision input differs from its accepted result.")
            if step == "profile" and not set(selection["models"]).issubset(selected(saved)):
                raise ValueError("The revised profile must support the reference run's native models.")
            selection[step + "_id"] = key
            revised = comparison = None
        elif step == "prepare":
            expected = _selection(payload)
            if expected != selection:
                raise ValueError("The prepared revision changed its original grid or selected inputs.")
            run = ws.inspect_run(key)
            if run.get("id") != key or _selection(run["selection"]) != selection:
                raise ValueError("The retained revised run differs from its accepted selection.")
            revised, comparison = key, None
        else:
            if not revised or payload.get("run_ids") != [record["baseline_run_id"], revised]:
                raise ValueError("Compare the reference first and its exact revised run second.")
            saved = ws.retained_item("comparisons", key)
            if (saved.get("baseline_run_id") != record["baseline_run_id"]
                    or [row["run_id"] for row in saved.get("alternatives", [])] != [revised]
                    or saved != entry["accepted_task"]["result"]):
                raise ValueError("The saved comparison differs from the accepted original comparison.")
            comparison = key
    records["profile"] = ws._get("profiles", selection["profile_id"])
    records["scenario"] = ws._get("scenarios", selection["scenario_id"])
    records["grid"] = ws.get_grid(selection["grid_id"])
    if revised:
        records["run"] = ws.inspect_run(revised)
    if comparison:
        records["comparison"] = ws.retained_item("comparisons", comparison)
    return {**deepcopy(record), "selection": selection,
            "selection_sha256": digest(selection), "revised_run_id": revised,
            "comparison_id": comparison, "records": records}


def _reconcile(operator, workspace_key, record):
    record = deepcopy(record)
    # Submission holds this same RLock through intent, queue acceptance and binding.
    # A missing task observed here is never an in-flight local acknowledgement.
    with operator.lock:
        for entry in record["operations"]:
            task = _task_for(operator, workspace_key, entry)
            entry["task_available"] = task is not None
            if task is not None:
                _accept(entry, task)
            elif entry.get("state") in ACTIVE:
                entry["source_task_state"] = entry["state"]
                if entry.get("accepted_task"):
                    entry["source_accepted_task"] = entry.pop("accepted_task")
                entry["state"] = "unavailable"
                entry["error"] = {"code": "REVISION_SOURCE_QUEUE",
                                  "message": "The original task is unavailable in this operator. Open the retained inputs to continue here."}
    return record

def _persist(ws, record):
    record = deepcopy(record)
    record["updated_at"] = now()
    atomic_json(_path(ws, record["id"]), record)
    return record


def _writable(operator, workspace_key):
    operator.ws(workspace_key)
    operator.team.check_workspace(workspace_key, write=True)
    operator.team.set_workspace(workspace_key)


def _create(operator, workspace_key, payload):
    _writable(operator, workspace_key)
    ws = operator.ws(workspace_key)
    run = ws.inspect_run(identifier(payload["baseline_run_id"]))
    if run["state"] != "complete":
        raise ValueError("Choose a completed native run as the revision reference.")
    title = payload.get("title", "").strip()
    if not title or len(title) > 240:
        raise ValueError("Name the revised run in 1 to 240 characters.")
    base = {"schema": SCHEMA, "project_id": ws.project["id"],
            "baseline_run_id": run["id"], "baseline_selection": deepcopy(run["selection"]),
            "title": title, "operation_id": _operation(payload["operation_id"])}
    key = digest(base)
    with operator.lock, held(_folder(ws) / ".revision.lock"):
        path = _path(ws, key)
        if path.exists():
            record = _load(ws, key)
        else:
            record = {**base, "id": key, "created_at": now(), "updated_at": now(), "operations": []}
            _derive(ws, record)
            atomic_json(path, record, immutable=True)
    return _derive(ws, record)


def _validate_submission(ws, review, step, action, payload):
    if ACTIONS.get(step) != action or not isinstance(payload, dict):
        raise ValueError("Use the existing revision profile, scenario, run or comparison form.")
    if any(entry["state"] in ACTIVE for entry in review["operations"]):
        raise ValueError("Finish the accepted revision task before preparing its dependent step.")
    selection = review["selection"]
    if step == "profile":
        if not set(selection["models"]).issubset(selected(payload)):
            raise ValueError("Preserve the native models selected by the reference run.")
    elif step == "scenario":
        if not isinstance(payload.get("patches", []), list):
            raise ValueError("Retain the scenario's ordered land-cover patches.")
    elif step == "prepare":
        if _selection(payload) != selection:
            raise ValueError("Prepare the exact saved profile and scenario on the original grid and models.")
        normalized, _ = normalize_selection(payload)
        if set(normalized) - {"grid_id", "profile_id", "scenario_id", "models"}:
            raise ValueError("Use the original run preparation selection.")
        if selection == _selection(review["baseline_selection"]):
            raise ValueError("Save a revised profile or scenario before preparing a distinct run.")
    else:
        revised = review.get("revised_run_id")
        if (not revised or set(payload) != {"run_ids"}
                or payload["run_ids"] != [review["baseline_run_id"], revised]):
            raise ValueError("Compare this reference first and its exact revised run second.")
        if ws.inspect_run(revised)["state"] != "complete":
            raise ValueError("Finish the revised native run before comparing its outputs.")


def _submit(operator, workspace_key, payload):
    _writable(operator, workspace_key)
    ws = operator.ws(workspace_key)
    with operator.lock, held(_folder(ws) / ".revision.lock"):
        record = _reconcile(operator, workspace_key, _load(ws, payload["id"]))
        operation_id = _operation(payload["operation_id"])
        existing = next((entry for entry in record["operations"]
                         if entry["operation_id"] == operation_id), None)
        request = {"workspace": workspace_key, "action": payload["action"],
                   "payload": payload["payload"]}
        if existing is not None:
            if (existing["step"] != payload["step"]
                    or existing["request_sha256"] != digest(request)):
                raise ValueError("This operation already belongs to another revision request.")
            # Reconcile accepted aliases before resubmission; an original task is never duplicated.
            task = _task_for(operator, workspace_key, existing)
            if task is not None:
                _bind_task(ws, record["id"], task["id"])
                _persist(ws, record)
                return task
            review = _derive(ws, record)
            if existing["selection_before"] != review["selection"]:
                raise ValueError("This unfinished request has older inputs. Open the current revision form.")
            pending_review = {**review, "operations": [
                row for row in review["operations"] if row["operation_id"] != operation_id]}
            _validate_submission(ws, pending_review, payload["step"], payload["action"], payload["payload"])
        else:
            review = _derive(ws, record)
            if payload.get("expected_selection_sha256") != review["selection_sha256"]:
                raise ValueError("The saved revision inputs changed. Reopen the current revision form.")
            _validate_submission(ws, review, payload["step"], payload["action"], payload["payload"])
            existing = {"step": payload["step"], "action": payload["action"],
                        "workspace": workspace_key, "payload": deepcopy(payload["payload"]),
                        "operation_id": operation_id, "request_sha256": digest(request),
                        "selection_before": deepcopy(review["selection"]), "task_id": None,
                        "state": "submitting", "result_id": None, "created_at": now()}
            record["operations"].append(existing)
        # Preserve complete intent before the original queue can acknowledge or execute.
        _persist(ws, record)
        try:
            task = operator.submit(workspace_key, payload["action"], payload["payload"], operation_id)
        except Exception as error:
            task = _task_for(operator, workspace_key, existing)
            if task is None:
                existing["state"] = "failed"
                existing["error"] = {"code": getattr(error, "code", type(error).__name__),
                                     "message": str(error)}
                _persist(ws, record)
                raise
            # A task accepted before an interrupted acknowledgement remains the same operation.
        _accept(existing, task)
        _bind_task(ws, record["id"], task["id"])
        _derive(ws, record)
        _persist(ws, record)
        return task


def _bind_task(ws, revision_id, task_id):
    binding_path = _folder(ws) / "task-bindings" / (identifier(task_id) + ".json")
    binding = read_json(binding_path) if binding_path.exists() else {"revision_ids": []}
    if revision_id not in binding["revision_ids"]:
        binding["revision_ids"].append(revision_id)
    atomic_json(binding_path, binding)


def capture_task(operator, task):
    """Called after the original queue persists a task; does nothing for unrelated tasks."""
    ws = operator.ws(task["workspace"])
    binding_path = _folder(ws) / "task-bindings" / (identifier(task["id"]) + ".json")
    if not binding_path.exists():
        return
    with operator.lock, held(_folder(ws) / ".revision.lock"):
        for key in read_json(binding_path)["revision_ids"]:
            record = _reconcile(operator, task["workspace"], _load(ws, key))
            _derive(ws, record)
            _persist(ws, record)


def _capture(operator, workspace_key, key):
    _writable(operator, workspace_key)
    ws = operator.ws(workspace_key)
    with operator.lock, held(_folder(ws) / ".revision.lock"):
        record = _reconcile(operator, workspace_key, _load(ws, key))
        _derive(ws, record)
        return _derive(ws, _persist(ws, record))


def _export(ws, record):
    review = _derive(ws, record)
    body = {"schema": HANDOVER, "project_id": ws.project["id"],
            "record": record, "records": review["records"]}
    return {**body, "sha256": digest(body)}


def _import(operator, workspace_key, value):
    _writable(operator, workspace_key)
    ws = operator.ws(workspace_key)
    if not isinstance(value, dict) or value.get("schema") != HANDOVER:
        raise ValueError("Open the complete exported run revision JSON.")
    body = {key: val for key, val in value.items() if key != "sha256"}
    if digest(body) != value.get("sha256") or value.get("project_id") != ws.project["id"]:
        raise ValueError("The revision handover changed or belongs to another project.")
    incoming = deepcopy(value["record"])
    review = _derive(ws, incoming)
    # Mutable run state may progress after export; scientific selection must remain exact.
    for kind, saved in value["records"].items():
        current = review["records"].get(kind)
        if kind in ("baseline", "run"):
            equal = current is not None and current["id"] == saved["id"] and current["selection"] == saved["selection"]
        else:
            equal = current == saved
        if not equal:
            raise ValueError("The retained " + kind + " record differs from this revision handover.")
    if set(value["records"]) != set(review["records"]):
        raise ValueError("Retain all original scientific records in the revision handover.")
    with operator.lock, held(_folder(ws) / ".revision.lock"):
        path = _path(ws, incoming["id"])
        if path.exists():
            current = _load(ws, incoming["id"])
            # Preserve local progress while accepting a complete extension of the same history.
            old, new = current["operations"], incoming["operations"]
            def intent(entry):
                return {key: entry[key] for key in
                        ("step", "action", "workspace", "payload", "operation_id",
                         "request_sha256", "selection_before")}
            for left, right in zip(old, new):
                if intent(left) != intent(right):
                    raise ValueError("This project already has a different revision history.")
            merged = deepcopy(old if len(old) >= len(new) else new)
            for index, (left, right) in enumerate(zip(old, new)):
                merged[index] = deepcopy(left if left["state"] == "complete"
                                          or right["state"] != "complete" else right)
            incoming = {**current, "operations": merged}
            _derive(ws, incoming)
            incoming = _persist(ws, incoming)
        else:
            atomic_json(path, incoming, immutable=True)
    return _derive(ws, _reconcile(operator, workspace_key, incoming))


def read(operator, workspace_key, operation, payload=None):
    value = payload or {}
    ws = operator.ws(workspace_key)
    if not isinstance(value, dict):
        raise ValueError("Select a saved run revision.")
    if operation == "catalog":
        rows = []
        for path in sorted(_folder(ws).glob("*.json")):
            review = _derive(ws, _reconcile(operator, workspace_key, _load(ws, path.stem)))
            rows.append({key: review[key] for key in ("id", "title", "baseline_run_id",
                         "selection", "revised_run_id", "comparison_id", "created_at", "updated_at")})
        return {"workspace_key": workspace_key, "reviews": rows}
    if operation == "create":
        review = _create(operator, workspace_key, value)
    elif operation == "submit":
        return _submit(operator, workspace_key, value)
    elif operation == "capture":
        review = _capture(operator, workspace_key, value["id"])
    elif operation == "import":
        review = _import(operator, workspace_key, value["review"])
    elif operation in ("review", "export"):
        record = _reconcile(operator, workspace_key, _load(ws, value["id"]))
        if operation == "export":
            return {"workspace_key": workspace_key, "review": _export(ws, record)}
        review = _derive(ws, record)
    else:
        raise ValueError("Choose a saved revision, its original tasks or its complete handover.")
    return {"workspace_key": workspace_key, "review": review}


def verify_workspace(workspace):
    count = 0
    for path in sorted(_folder(workspace).glob("*.json")):
        _derive(workspace, _load(workspace, path.stem))
        count += 1
    return {"run_revisions": count}

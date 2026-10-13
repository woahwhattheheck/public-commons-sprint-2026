"""Focused run-revision persistence receiving; uses the original queue methods.

This small temporary record fixture exercises state and handover contracts only.
It does not calculate or represent scientific model outputs.
"""
from __future__ import annotations
import argparse
import ast
from copy import deepcopy
import contextlib
import hashlib
import importlib
import json
from pathlib import Path
import re
import shutil
import sys
import threading
import traceback


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    app = Path(args.application).resolve(strict=True)
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    sys.path[:0] = [str(app / "operator"), str(app)]
    from model.common import atomic_json, digest, held, identifier, now, read_json
    from task_requests import TaskRequests
    import run_revision as revision

    source = (app / "operator" / "server.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    original = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Operator")
    names = {"submit", "_perform", "_invoke", "task", "task_view"}
    methods = [deepcopy(node) for node in original.body
               if isinstance(node, ast.FunctionDef) and node.name in names]
    if ({node.name for node in methods} != names or "capture_task(self, task)" not in source
            or "task.update(revision_task_links(self, task))" not in source):
        raise ValueError("Use the complete original queue and revision completion hook")
    class_node = ast.ClassDef(name="OriginalQueue", bases=[], keywords=[], body=methods, decorator_list=[])
    module = ast.fix_missing_locations(ast.Module(body=[class_node], type_ignores=[]))

    class Fault(Exception):
        def __init__(self, code, message, status=422):
            super().__init__(message)
            self.code, self.status = code, status

    class NativeJobDetached(Exception):
        pass

    class NativeJobCancelled(Exception):
        pass

    scope = {
        "atomic_json": atomic_json, "read_json": read_json, "digest": digest,
        "now": now, "re": re, "Fault": Fault, "token": identifier,
        "ACTIVE": {"queued", "running"},
        "ACTIONS": {"profile.save", "scenario.save", "run.prepare", "run.compare", "run.start"},
        "NativeJobDetached": NativeJobDetached, "NativeJobCancelled": NativeJobCancelled,
        "summary_error": lambda error: ({"code": type(error).__name__, "message": str(error)}, 422),
        "contextlib": contextlib, "traceback": traceback,
        "REHEARSAL_ACTIONS": set(), "PARAMETER_STUDY_ACTIONS": set(),
        "EXPERIMENT_ACTIONS": set(), "PROGRAMME_ACTIONS": set(), "CUSTOMER_REVIEW_ACTIONS": set(),
    }
    exec(compile(module, str(app / "operator" / "server.py"), "exec"), scope)
    OriginalQueue = scope["OriginalQueue"]

    class RecordFixture:
        def __init__(self, root, *, create=False):
            self.root = Path(root)
            if create:
                self.root.mkdir(parents=True)
                atomic_json(self.root / "project.json", {"id": "revision-persistence-fixture", "title": "Queue record fixture"})
            self.project = read_json(self.root / "project.json")

        def save(self, kind, value):
            value = deepcopy(value)
            key = digest(value)
            path = self.root / kind / (key + ".json")
            if path.exists():
                assert read_json(path) == value
            else:
                atomic_json(path, value, immutable=True)
            return {**value, "id": key}

        def _get(self, kind, key):
            value = read_json(self.root / kind / (identifier(key) + ".json"))
            if digest(value) != key:
                raise ValueError("Fixture immutable record changed")
            return {**value, "id": key}

        def get_grid(self, key):
            return self._get("grids", key)

        def inspect_run(self, key):
            value = read_json(self.root / "runs" / identifier(key) / "run.json")
            if value["id"] != key or digest(value["selection"]) != key:
                raise ValueError("Fixture native selection changed")
            return value

        def save_profile(self, value):
            return self.save("profiles", value)

        def save_scenario(self, value):
            return self.save("scenarios", value)

        def retained_item(self, kind, key):
            return self._get(kind, key)

        def prepare_run(self, value):
            selection = deepcopy(value)
            key = digest(selection)
            result = {"id": key, "selection": selection, "state": "prepared",
                      "fixture": "prepared state only; no scientific calculation"}
            atomic_json(self.root / "runs" / key / "run.json", result, immutable=True)
            return result

    class FixtureTeam:
        def check_workspace(self, *args, **kwargs): pass
        def set_workspace(self, *args, **kwargs): pass
        def require_action(self, *args, **kwargs): pass
        def current(self): return None
        def actor(self): return None
        def record(self, *args, **kwargs): pass
        def task_principal(self, task): return None
        def scope(self, *args): return contextlib.nullcontext()

    class DeferredPool:
        def __init__(self):
            self.pending = []
        def submit(self, callback, *args):
            self.pending.append((callback, args))
        def drain(self):
            while self.pending:
                callback, args = self.pending.pop(0)
                callback(*args)

    class PeerDecorator:
        def __init__(self, name):
            self.name = name
        def handles_action(self, action): return False
        def decorate_task(self, task):
            task.setdefault("_fixture_peer_chain", []).append(self.name)
            task["_fixture_peer_" + self.name] = {"original": True}
            return task

    class NativeMetadata:
        def supports(self, task): return False

    def operator(workspace, root, key):
        op = OriginalQueue()
        op.root = Path(root)
        for name in ("tasks", "task-operation-aliases"):
            (op.root / name).mkdir(parents=True, exist_ok=True)
        op.lock = threading.RLock()
        op.team = FixtureTeam()
        op.pool = DeferredPool()
        op.extensions = PeerDecorator("extensions")
        op.customer_reviews = PeerDecorator("customer_reviews")
        op.programmes = PeerDecorator("programmes")
        op.experiments = PeerDecorator("experiments")
        op.rehearsals = PeerDecorator("rehearsals")
        op.native_jobs = NativeMetadata()
        op.item = lambda workspace, kind, item_id: {
            "_downloads": [{"fixture": "original item download",
                            "workspace": workspace, "kind": kind, "id": item_id}]} 
        op.task_requests = TaskRequests(op.root)
        op.closing = False
        op.gates = {key: threading.RLock()}
        def ws(requested):
            if requested != key:
                raise ValueError("Wrong fixture Workspace")
            return workspace
        op.ws = ws
        return op

    cases = []
    def rejected(action, phrase):
        try:
            action()
        except (ValueError, Fault) as error:
            if phrase not in str(error):
                raise
            return str(error)
        raise AssertionError("Expected rejection: " + phrase)

    ws = RecordFixture(output / "workspace", create=True)
    grid = ws.save("grids", {"fixture": "grid"})
    profile = ws.save("profiles", {"title": "Original record fixture", "models": ["ndr", "sdr"],
                                  "ndr": {"k_param": 2}, "sdr": {"l_max": 122}})
    scenario = ws.save("scenarios", {"title": "Original scenario fixture", "kind": "baseline", "patches": []})
    selection = {"grid_id": grid["id"], "profile_id": profile["id"],
                 "scenario_id": scenario["id"], "models": ["ndr", "sdr"]}
    run_id = digest(selection)
    atomic_json(ws.root / "runs" / run_id / "run.json",
                {"id": run_id, "selection": selection, "state": "complete",
                 "fixture": "completed state only; no scientific calculation"})
    key = digest({"directory": str(ws.root)})
    op = operator(ws, output / "operator", key)
    review = revision.read(op, key, "create", {
        "baseline_run_id": run_id, "title": "Original queue persistence course",
        "operation_id": "revision_fixture_create_20261013"})["review"]
    original_selection_sha = review["selection_sha256"]

    def submission(current, operation_id, value, expected=None):
        return {"id": current["id"], "operation_id": operation_id, "step": "profile",
                "action": "profile.save", "payload": deepcopy(value),
                "expected_selection_sha256": expected or current["selection_sha256"]}

    edited = {name: deepcopy(value) for name, value in profile.items() if name != "id"}
    edited["title"] = "Revised record fixture"
    rejected(lambda: revision.read(op, key, "submit",
        submission(review, "revision_stale_initial_20261013", edited, "0" * 64)), "changed")
    assert read_json(revision._path(ws, review["id"]))["operations"] == []
    cases.append("stale selection rejected before intent mutation")

    original_task = op.submit(key, "profile.save", edited, "original_profile_task_20261013")
    request = submission(review, "revision_profile_alias_20261013", edited)
    alias_task = revision.read(op, key, "submit", request)
    assert alias_task["id"] == original_task["id"] and len(op.pool.pending) == 1
    alias_key = digest({"workspace": key, "operation_id": request["operation_id"]})
    alias = read_json(op.root / "task-operation-aliases" / (alias_key + ".json"))
    assert alias["task_id"] == original_task["id"]
    queued_view = op.task_view(original_task["id"])
    assert [row["id"] for row in queued_view["_run_revisions"]] == [review["id"]]
    op.pool.drain()
    persisted = read_json(revision._path(ws, review["id"]))
    assert persisted["operations"][0]["state"] == "complete"
    assert persisted["operations"][0]["accepted_task"]["operation_id"] == "original_profile_task_20261013"
    assert "run_revision_capture_error" not in op.task(original_task["id"])
    review = revision.read(op, key, "review", {"id": review["id"]})["review"]
    assert review["selection"]["profile_id"] == digest(edited)
    completed_view = op.task_view(original_task["id"])
    assert [row["id"] for row in completed_view["_run_revisions"]] == [review["id"]]
    assert completed_view["_item"] == {"kind": "profiles", "id": digest(edited)}
    assert completed_view["_downloads"] == op.item(key, "profiles", digest(edited))["_downloads"]
    assert completed_view["_fixture_peer_chain"] == [
        "customer_reviews", "programmes", "experiments", "extensions", "rehearsals"]
    assert all(completed_view["_fixture_peer_" + name] == {"original": True}
               for name in completed_view["_fixture_peer_chain"])
    assert "_run_revision_link_errors" not in completed_view
    cases.append("original active alias, completion persistence and actual task_view with all peer fields")

    original_export = revision.read(op, key, "export", {"id": review["id"]})["review"]
    rejected(lambda: revision.read(op, key, "submit",
        submission(review, "revision_stale_changed_20261013", edited, original_selection_sha)), "changed")
    cases.append("stale edit rejected after accepted immutable profile change")

    second = deepcopy(edited)
    second["title"] = "Second retained record fixture"
    op.closing = True
    failed_request = submission(review, "revision_rejected_retry_20261013", second)
    rejected(lambda: revision.read(op, key, "submit", failed_request), "finishing")
    persisted = read_json(revision._path(ws, review["id"]))
    assert persisted["operations"][-1]["state"] == "failed"
    op.closing = False
    revision.read(op, key, "submit", failed_request)
    op.pool.drain()
    review = revision.read(op, key, "review", {"id": review["id"]})["review"]
    assert review["selection"]["profile_id"] == digest(second)
    cases.append("unaccepted queue intent records failure and retries exactly once")

    third = deepcopy(second)
    third["title"] = "Interrupted acknowledgement fixture"
    actual_submit = op.submit
    def lost_ack(*args, **kwargs):
        result = actual_submit(*args, **kwargs)
        raise OSError("Fixture interrupted acknowledgement after original acceptance")
    op.submit = lost_ack
    accepted = revision.read(op, key, "submit",
        submission(review, "revision_lost_ack_20261013", third))
    op.submit = actual_submit
    assert accepted["state"] == "queued" and len(op.pool.pending) == 1
    op.pool.drain()
    review = revision.read(op, key, "review", {"id": review["id"]})["review"]
    assert review["selection"]["profile_id"] == digest(third)
    imported = revision.read(op, key, "import", {"review": original_export})["review"]
    assert imported["selection"] == review["selection"]
    assert len(imported["operations"]) == 3
    cases.append("accepted task survives interrupted acknowledgement and older reimport preserves local progress")

    completed_export = revision.read(op, key, "export", {"id": review["id"]})["review"]
    cold_same = operator(ws, output / "cold-same-key-operator", key)
    cold_review = revision.read(cold_same, key, "review", {"id": review["id"]})["review"]
    assert cold_review["selection"] == review["selection"]
    assert all(not row["task_available"] and row["accepted_task"]["state"] == "complete"
               for row in cold_review["operations"])
    revision.read(cold_same, key, "import", {"review": completed_export})
    cases.append("completed source snapshots reopen without the original same-key queue")

    fourth = deepcopy(third)
    fourth["title"] = "Unfinished source queue fixture"
    revision.read(op, key, "submit", submission(review, "revision_unfinished_20261013", fourth))
    assert len(op.pool.pending) == 1
    for name, same_key in (("same-key", True), ("new-key", False)):
        destination = output / ("cold-" + name + "-workspace")
        shutil.copytree(ws.root, destination)
        restored = RecordFixture(destination)
        restored_key = key if same_key else digest({"directory": str(destination)})
        cold_op = operator(restored, output / ("cold-" + name + "-state"), restored_key)
        loaded = revision.read(cold_op, restored_key, "capture", {"id": review["id"]})["review"]
        entry = loaded["operations"][-1]
        assert entry["state"] == "unavailable" and entry["source_task_state"] == "queued"
        assert entry["source_accepted_task"]["id"] and not entry["task_available"]
        assert loaded["selection"] == review["selection"]
        assert not cold_op.pool.pending
        handover = revision.read(cold_op, restored_key, "export", {"id": review["id"]})["review"]
        imported = revision.read(cold_op, restored_key, "import", {"review": handover})["review"]
        assert imported["selection"] == loaded["selection"]
    cases.append("unfinished same-key and new-key cold reopen retain source snapshots without submitting")

    # Finish the already queued profile fixture, then use the original preparation
    # queue. A run.start task is retained for metadata viewing only, never executed.
    op.pool.drain()
    review = revision.read(op, key, "review", {"id": review["id"]})["review"]
    prepare_task = revision.read(op, key, "submit", {
        "id": review["id"], "operation_id": "revision_prepare_view_20261013",
        "step": "prepare", "action": "run.prepare",
        "payload": deepcopy(review["selection"]),
        "expected_selection_sha256": review["selection_sha256"]})
    op.pool.drain()
    review = revision.read(op, key, "review", {"id": review["id"]})["review"]
    prepared_id = review["revised_run_id"]
    prepared_view = op.task_view(prepare_task["id"])
    assert prepared_view["_item"] == {"kind": "runs", "id": prepared_id}
    assert [row["id"] for row in prepared_view["_run_revisions"]] == [review["id"]]
    native_task = op.submit(key, "run.start", {"run_id": prepared_id},
                            "revision_native_view_20261013")
    native_view = op.task_view(native_task["id"])
    assert native_view["state"] == "queued" and len(op.pool.pending) == 1
    assert native_view["payload"] == {"run_id": prepared_id}
    assert native_view["_run_revisions"] == [{
        "id": review["id"], "title": review["title"],
        "baseline_run_id": run_id, "run_id": prepared_id}]
    assert native_view["_fixture_peer_chain"] == completed_view["_fixture_peer_chain"]
    assert "_run_revision_link_errors" not in native_view
    cases.append("actual task_view links the retained prepared run and unexecuted native task")

    source_files = {}
    for relative in ("operator/run_revision.py", "operator/server.py", "operator/task_requests.py",
                     "model/common.py", "model/model_selection.py"):
        body = (app / relative).read_bytes()
        source_files[relative] = {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(),
            "git_blob": hashlib.sha1(b"blob " + str(len(body)).encode("ascii") + b"\0" + body).hexdigest()}
    result = {"schema": "upstate.run-revision-persistence-receiving/v1",
              "scope": "original queue and persistence methods over temporary record fixtures",
              "scientific_models_executed": 0, "cases": cases, "passed": len(cases),
              "source_files": source_files, "output": str(output), "completed_at": now()}
    atomic_json(output / "result.json", result)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

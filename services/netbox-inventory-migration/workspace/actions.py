"""Retained browser actions over the original NetBox operator and job journal."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import threading

from model import DeskError, REQUEST_SCHEMA, SHA, need, request_id
from inventory_migration import InventoryError, digest, keys
from prepare_inventory import json_bytes, now, read_json, workspace_lock, write_atomic
from operate_inventory import current_attempt, operate

KINDS = ("review", "apply", "recover", "retry-current", "report", "handover")
TERMINAL = ("COMPLETE", "FAILED")


def result_summary(result):
    names = ("state", "operation_id", "execution_reference", "phase", "review_digest", "receipt_sha256",
             "counts", "journal", "error", "provider_status", "bytes", "sha256", "members", "objects",
             "job_id", "job_status", "completed", "matching_job_ids", "current_native_jobs")
    return {key: result[key] for key in names if key in result}


class NativeActions:
    def __init__(self, desk, *, wait_seconds=30, workers=2):
        need(type(wait_seconds) is int and 0 <= wait_seconds <= 600,
             "native_wait", "Use an original native follow duration between 0 and 600 seconds.")
        self.desk, self.wait_seconds = desk, wait_seconds
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="inventory-native")
        self.lock = threading.RLock()
        self.running, self.closed = set(), False

    def _intent(self, identity):
        intent = self.desk.request(identity)
        need(intent.get("schema") == REQUEST_SCHEMA and intent.get("kind") == "native_action",
             "action_kind", "This request belongs to another original workspace action.", 409)
        need(intent.get("sha256") == digest({"kind": intent["kind"], "payload": intent["payload"]}),
             "action_changed", "The retained native action changed.", 409)
        return intent

    def _base(self, intent):
        payload = intent["payload"]
        return {"id": intent["id"], "kind": payload["action"], "project_id": payload["project_id"],
                "edition_id": payload["edition_id"], "created_at": intent["created_at"]}

    def _active(self, edition):
        path = edition / "active-action.json"
        if not path.exists():
            return None
        value = read_json(path)
        identity = request_id(value.get("id"))
        original = self._intent(identity)
        payload = original["payload"]
        need(payload["project_id"] == value.get("project_id") and payload["edition_id"] == value.get("edition_id"),
             "active_action_changed", "The edition's active action binding changed.", 409)
        complete = self.desk.request_root(identity) / "complete.json"
        return None if complete.exists() else identity

    def _clear(self, edition, identity):
        path = edition / "active-action.json"
        if path.exists() and read_json(path).get("id") == identity:
            path.unlink()
            from prepare_inventory import sync_directory
            sync_directory(path.parent)

    def get(self, identity):
        intent = self._intent(identity)
        root = self.desk.request_root(identity)
        if (root / "complete.json").exists():
            value = read_json(root / "complete.json")
        elif (root / "action.json").exists():
            value = read_json(root / "action.json")
        else:
            value = {**self._base(intent), "state": "RECOVERY_REQUIRED", "updated_at": intent["created_at"],
                     "error": {"code": "admission_interrupted",
                               "message": "Continue this exact saved request to finish its original admission."}}
        need(value.get("id") == identity and value.get("project_id") == intent["payload"]["project_id"]
             and value.get("edition_id") == intent["payload"]["edition_id"],
             "action_changed", "The retained action result belongs to another request.", 409)
        with self.lock:
            running = identity in self.running
        if value["state"] in ("QUEUED", "RUNNING") and not running:
            value = dict(value, state="RECOVERY_REQUIRED",
                         error={"code": "operator_reopened",
                                "message": "The operator reopened. Continue the same request to read its original native execution."})
        return value

    def list(self, project, edition):
        rows = []
        for path in (self.desk.root / "requests").glob("*/request.json"):
            intent = read_json(path)
            if (intent.get("kind") == "native_action" and intent.get("payload", {}).get("project_id") == project
                    and intent["payload"].get("edition_id") == edition):
                rows.append(self.get(intent["id"]))
        return sorted(rows, key=lambda row: (row["created_at"], row["id"]), reverse=True)

    def response(self, identity):
        action = self.get(identity)
        return {"action": action, "project": self.desk.project(action["project_id"]),
                "edition": self.desk.edition(action["project_id"], action["edition_id"])}

    def start(self, project, edition, body):
        keys(body, ("request_id", "action", "expected_status_sha256", "review_digest", "refresh"),
             "Native inventory action")
        identity = request_id(body.get("request_id"))
        action = body.get("action")
        need(action in KINDS, "native_action", "Select an original native inventory action.")
        expected = body.get("expected_status_sha256")
        need(isinstance(expected, str) and SHA.fullmatch(expected), "native_status",
             "Use the exact displayed original edition status.")
        review = body.get("review_digest", "")
        need(isinstance(review, str) and (review == "" or SHA.fullmatch(review)), "review_digest",
             "Use the original native review digest.")
        refresh = body.get("refresh", False)
        need(type(refresh) is bool and (not refresh or action == "review"), "refresh",
             "A refreshed native dry-run belongs to the review action.")
        if action == "apply":
            need(bool(review), "review_digest", "Select the completed original review digest before applying.")
        payload = {"project_id": project, "edition_id": edition, "action": action,
                   "expected_status_sha256": expected, "review_digest": review, "refresh": refresh}
        root = self.desk.request_root(identity)
        if (root / "request.json").exists():
            intent = self._intent(identity)
            need(intent["payload"] == payload, "request_conflict",
                 "This request ID belongs to a different exact native action.", 409)
            return self.response(identity)
        self._admit(identity, payload, resume=False)
        return self.response(identity)

    def resume(self, identity, body):
        keys(body, ("request_id",), "Native action continuation")
        need(request_id(body.get("request_id")) == request_id(identity), "request_conflict",
             "Continue the original action with its same saved request ID.", 409)
        intent = self._intent(identity)
        with self.lock:
            running = identity in self.running
        if running or (self.desk.request_root(identity) / "complete.json").exists():
            return self.response(identity)
        self._admit(identity, intent["payload"], resume=True)
        return self.response(identity)

    def _admit(self, identity, payload, *, resume):
        with self.lock:
            need(not self.closed, "operator_closing", "The operator is closing. Reopen this same workspace.", 409)
        root = self.desk.request_root(identity)
        edition = self.desk.edition_root(payload["project_id"], payload["edition_id"])
        with workspace_lock(root), workspace_lock(edition / ".desk-actions"):
            path = root / "request.json"
            if path.exists():
                intent = self._intent(identity)
                need(intent["payload"] == payload, "request_conflict",
                     "This request ID belongs to a different exact native action.", 409)
            else:
                intent = {"schema": REQUEST_SCHEMA, "id": identity, "kind": "native_action", "payload": payload,
                          "sha256": digest({"kind": "native_action", "payload": payload}), "created_at": now()}
            if (root / "complete.json").exists():
                return
            active = self._active(edition)
            need(active in (None, identity), "active_action",
                 "Continue the original active action before starting another on this edition.", 409,
                 {"active_action_id": active})
            baseline_path = root / "baseline.json"
            if not baseline_path.exists():
                selected = self.desk.edition(payload["project_id"], payload["edition_id"])
                need(selected["status_sha256"] == payload["expected_status_sha256"], "stale_native_status",
                     "The original native edition changed. Read its current result before choosing another action.", 409,
                     {"current_status_sha256": selected["status_sha256"]})
                if payload["action"] == "apply":
                    need(selected.get("review_digest") == payload["review_digest"], "review_digest_changed",
                         "Apply requires the exact completed review digest displayed for this native edition.", 409)
                _, current = current_attempt(edition / "native")
                baseline = {"schema": "tjlabs.netbox.customer-action-basis/v1", "request_id": identity,
                            "project_id": payload["project_id"], "edition_id": payload["edition_id"],
                            "operation_id": selected["operation_id"], "status_sha256": selected["status_sha256"],
                            "execution_reference": current["execution_reference"] if current else None,
                            "phase": current["phase"] if current else None, "observed_at": intent["created_at"]}
                write_atomic(path, json_bytes(intent), immutable=True)
                write_atomic(baseline_path, json_bytes(baseline), immutable=True)
            else:
                baseline = read_json(baseline_path)
                need(baseline["request_id"] == identity and baseline["project_id"] == payload["project_id"]
                     and baseline["edition_id"] == payload["edition_id"],
                     "action_basis_changed", "The retained action basis belongs to another original edition.", 409)
            write_atomic(path, json_bytes(intent), immutable=True)
            write_atomic(edition / "active-action.json",
                         json_bytes({"id": identity, "project_id": payload["project_id"],
                                     "edition_id": payload["edition_id"]}))
            prior = read_json(root / "action.json") if (root / "action.json").exists() else {}
            queued = {**self._base(intent), **prior, "state": "QUEUED", "updated_at": now(),
                      "continuation_requested": resume}
            queued.pop("error", None)
            write_atomic(root / "action.json", json_bytes(queued))
        self._enqueue(identity)

    def _enqueue(self, identity):
        with self.lock:
            if identity in self.running:
                return
            need(not self.closed, "operator_closing",
                 "The request is retained. Reopen the operator and continue this same request.", 409)
            self.running.add(identity)
            try:
                self.pool.submit(self._run, identity)
            except BaseException:
                self.running.discard(identity)
                raise

    def _run(self, identity):
        root = self.desk.request_root(identity)
        try:
            intent = self._intent(identity)
            payload = intent["payload"]
            edition = self.desk.edition_root(payload["project_id"], payload["edition_id"])
            with workspace_lock(root), workspace_lock(edition / ".desk-actions"):
                if (root / "complete.json").exists():
                    self._clear(edition, identity)
                    return
                need(self._active(edition) == identity, "active_action_changed",
                     "Another original request owns this native edition.", 409)
                baseline = read_json(root / "baseline.json")
                selected = self.desk.edition(payload["project_id"], payload["edition_id"])
                need(selected["operation_id"] == baseline["operation_id"], "action_basis_changed",
                     "The native source operation changed after action admission.", 409)
                old = read_json(root / "action.json")
                resumed = old.get("continuation_requested") is True or old.get("started_at") is not None
                active = {**self._base(intent), **old, "state": "RUNNING", "updated_at": now(),
                          "started_at": old.get("started_at", now())}
                active.pop("error", None)
                write_atomic(root / "action.json", json_bytes(active))
                _, current = current_attempt(edition / "native")
                current_reference = current["execution_reference"] if current else None
                chosen = payload["action"]
                continuation = "original_action"
                # The original operator publishes current.json and INVOKING before
                # its only POST. A changed current reference after interruption is
                # therefore read through recover, never submitted again by this
                # browser request. A distinct later CLI execution is reported as
                # the actual current native operation, with its own identity.
                if resumed and chosen not in ("report", "handover", "recover"):
                    if current_reference != baseline["execution_reference"]:
                        chosen = "recover"
                        continuation = "recovered_original_current"
                write_atomic(root / "action.json", json_bytes(dict(active, continuation=continuation)))
                result = operate(chosen, edition / "native", config=self.desk.config_path,
                                 review_digest=payload["review_digest"],
                                 refresh=payload["refresh"] if chosen == "review" else False,
                                 wait=self.wait_seconds if chosen not in ("report", "handover") else 0)
                result_sha = digest(result)
                value = {**self._base(intent), "state": "COMPLETE", "updated_at": now(),
                         "started_at": active["started_at"], "continuation": continuation,
                         "result": result_summary(result), "native_result_sha256": result_sha,
                         "edition_status_sha256": self.desk.edition(payload["project_id"], payload["edition_id"])["status_sha256"]}
                write_atomic(root / "complete.json", json_bytes(value), immutable=True)
                write_atomic(root / "action.json", json_bytes(value))
                self._clear(edition, identity)
        except (InventoryError, OSError, ValueError, KeyError, TypeError) as exc:
            # Keep the exact request and original attempt. A provider reply may
            # already have been committed to the native journal.
            try:
                intent = self._intent(identity)
                old = read_json(root / "action.json") if (root / "action.json").exists() else self._base(intent)
                if not (root / "complete.json").exists():
                    error = {"code": getattr(exc, "code", "native_action_interrupted"), "message": str(exc)}
                    if getattr(exc, "details", None) is not None:
                        error["details"] = exc.details
                    value = {**old, "state": "RECOVERY_REQUIRED", "updated_at": now(), "error": error}
                    baseline_path = root / "baseline.json"
                    if baseline_path.exists():
                        payload = intent["payload"]
                        edition = self.desk.edition_root(payload["project_id"], payload["edition_id"])
                        baseline = read_json(baseline_path)
                        try:
                            with workspace_lock(edition / "native"):
                                _, current = current_attempt(edition / "native")
                                reference = current["execution_reference"] if current else None
                                if reference == baseline["execution_reference"]:
                                    # Every original POST first publishes a new
                                    # current reference. This request never reached
                                    # that point, so a corrected decision can be
                                    # admitted without retaining an impossible
                                    # immutable preflight as the active action.
                                    value.update(state="FAILED", review_required=True, dispatched=False)
                                    write_atomic(root / "complete.json", json_bytes(value), immutable=True)
                                    self._clear(edition, identity)
                        except (InventoryError, OSError, ValueError, KeyError, TypeError):
                            pass
                    write_atomic(root / "action.json", json_bytes(value))
            except (InventoryError, OSError, ValueError, KeyError, TypeError):
                pass
        finally:
            with self.lock:
                self.running.discard(identity)

    def close(self):
        with self.lock:
            self.closed = True
        self.pool.shutdown(wait=True, cancel_futures=False)

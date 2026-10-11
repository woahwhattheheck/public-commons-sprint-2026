"""One retained Mercury notification → canonical event → customer delivery engine."""
from __future__ import annotations

import base64
from dataclasses import asdict, is_dataclass
import json
import math
import time
import uuid

from .config import CONTRACT_ID
from .delivery import deliver as deliver_event, retry_safe
from .provider import MercuryProvider, ProviderError, tx_hash, validate_row, verify_webhook
from .store import OpsError, Store, decode_row, digest, encoded, operation_id


class Engine:
    def __init__(self, config, *, provider=None, deliver=None):
        self.config = config
        self.scope = {"network": config.network, "provider_scope": config.provider_scope,
                      "provider_base": config.api_base.rstrip("/")}
        destination = {key: value for key, value in config.destination.items()
                       if key in {"kind", "path", "url", "schema", "table", "dsn_env"}}
        self.store = Store(config.workspace, self.scope | {"destination": destination})
        self.provider = provider if provider is not None else MercuryProvider(config)
        self.deliver = deliver if deliver is not None else deliver_event

    def _contracts(self, contracts=None):
        if contracts is not None and not isinstance(contracts, (list, tuple)):
            raise OpsError("INVALID_CONTRACTS", "Supply a list of configured contract addresses.")
        selected = tuple(self.config.contracts if contracts is None else contracts)
        if not selected or any(not isinstance(value, str) or not CONTRACT_ID.fullmatch(value) for value in selected) or len(set(selected)) != len(selected):
            raise OpsError("INVALID_CONTRACTS", "Choose one or more distinct configured contract addresses.")
        if not set(selected).issubset(self.config.contracts):
            raise OpsError("CONTRACT_OUTSIDE_SCOPE", "Every selected contract must belong to this workspace's configured scope.", 403)
        return sorted(selected)

    def _tx_task(self, transaction, contracts, filters, operation=None):
        if operation is not None:
            return "manual-" + digest(operation)
        return "tx-" + digest({"tx": transaction, "contracts": contracts, "topic_filters": filters})

    def receive_webhook(self, raw_body, signature, timestamp=""):
        if not isinstance(raw_body, bytes) or not raw_body or len(raw_body) > self.config.max_body_bytes:
            raise OpsError("INVALID_BODY", "The notification needs a nonempty body within max_body_bytes.", 413)
        verify_webhook(raw_body, signature, self.config.webhook_secret())
        try:
            body = json.loads(raw_body)
            transaction = tx_hash(body["tx_hash"])
            contract = body["event"]["contract_id"]
        except (ValueError, TypeError, KeyError, UnicodeError):
            raise OpsError("INVALID_NOTIFICATION", "The authenticated notification needs event.contract_id and tx_hash.") from None
        contracts = self._contracts()
        if contract not in contracts:
            raise OpsError("CONTRACT_OUTSIDE_SCOPE", "This authenticated notification belongs to an unconfigured contract.", 403)
        notification_id = digest(self.scope | {"body_sha256": digest(raw_body)})
        filters = dict(self.config.topic_filters)
        task_id = self._tx_task(transaction, contracts, filters)
        moment = time.time()
        with self.store.transaction() as db:
            previous = db.execute("SELECT notification_id FROM notifications WHERE notification_id=?", (notification_id,)).fetchone()
            self.store.enqueue(db, task_id, "bytx", {"tx_hash": transaction, "contracts": contracts, "topic_filters": filters})
            db.execute("UPDATE tasks SET generation=generation+1 WHERE task_id=?", (task_id,))
            # A later notification can reveal an additional same-looking event in
            # the transaction. Query again; the canonical row ID owns deduplication.
            db.execute("UPDATE tasks SET state='queued',failures=0,due_at=?,updated_at=?,error=NULL WHERE task_id=? AND state='succeeded'",
                       (moment + self.config.retry_base_seconds, moment, task_id))
            current = db.execute("SELECT state,error FROM tasks WHERE task_id=?", (task_id,)).fetchone()
            state = "failed" if current["state"] == "failed" else "queued"
            if previous:
                db.execute("UPDATE notifications SET arrivals=arrivals+1,last_received_at=?,provider_timestamp=?,state=?,task_id=?,error=? WHERE notification_id=?",
                           (moment, str(timestamp)[:100], state, task_id, current["error"], notification_id))
            else:
                db.execute("INSERT INTO notifications(notification_id,body,body_sha,tx_hash,contract_id,provider_timestamp,received_at,last_received_at,arrivals,state,task_id,error) VALUES(?,?,?,?,?,?,?,?,1,?,?,?)",
                           (notification_id, raw_body, digest(raw_body), transaction, contract, str(timestamp)[:100], moment, moment, state, task_id, current["error"]))
        return {"notification_id": notification_id, "state": state, "reused": bool(previous), "task_id": task_id}

    def reconcile_tx(self, transaction=None, operation_id=None, **kwargs):
        # tx_hash is also accepted by keyword for the operator HTTP contract.
        transaction = tx_hash(transaction if transaction is not None else kwargs.get("tx_hash"))
        if operation_id is not None:
            from .store import operation_id as check_operation
            check_operation(operation_id)
        contracts = self._contracts()
        filters = dict(self.config.topic_filters)
        task_id = self._tx_task(transaction, contracts, filters, operation_id)
        with self.store.transaction() as db:
            self.store.enqueue(db, task_id, "bytx", {"tx_hash": transaction, "contracts": contracts, "topic_filters": filters})
        return self.get_task(task_id)

    def create_catchup(self, job_id, *, contracts=None, ledger_from, ledger_to, page_size=None):
        operation_id(job_id)
        selected = self._contracts(contracts)
        filters = dict(self.config.topic_filters)
        size = self.config.page_size if page_size is None else page_size
        if type(ledger_from) is not int or type(ledger_to) is not int or not 0 <= ledger_from <= ledger_to <= 2147483647:
            raise OpsError("INVALID_LEDGER_RANGE", "Use an explicit inclusive ledger range between 0 and 2147483647.")
        if type(size) is not int or not 1 <= size <= 1000:
            raise OpsError("INVALID_PAGE_SIZE", "Classic catch-up page size must be between 1 and 1000.")
        moment = time.time()
        with self.store.transaction() as db:
            prior = db.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            if prior:
                if (prior["contracts"], prior["topic_filters"], prior["ledger_from"], prior["ledger_to"], prior["page_size"]) != (encoded(selected), encoded(filters), ledger_from, ledger_to, size):
                    raise OpsError("JOB_INPUT_CONFLICT", "This job ID already pins a different contract set, topic family, ledger range or page size.", 409)
            else:
                db.execute("INSERT INTO jobs(job_id,contracts,topic_filters,ledger_from,ledger_to,page_size,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'queued',?,?)",
                           (job_id, encoded(selected), encoded(filters), ledger_from, ledger_to, size, moment, moment))
                self.store.enqueue(db, self._page_id(job_id, None), "catchup", {"job_id": job_id, "cursor": None})
        return self.get_job(job_id)

    @staticmethod
    def _page_id(job_id, cursor):
        return "page-" + digest([job_id, cursor])

    def _envelope(self, row):
        return {"schema": "mercury-ops.event.v1", "event_id": row["event_id"], **self.scope,
                "provider_row_id": row["provider_row_id"], "canonical": row["canonical"]}

    def list_events(self, limit=100, after=None):
        return self.store.page("events", limit=limit, after=after)

    def get_event(self, event_id):
        row = self.store.one("events", "event_id", event_id)
        with self.store.connect() as db:
            sources = [dict(source) for source in db.execute("""
                SELECT s.source_kind,s.source_id,s.task_id,s.attempt,s.observed_at,
                       n.body_sha AS notification_body_sha256,o.body_sha AS provider_response_sha256
                FROM event_sources s LEFT JOIN notifications n ON s.source_kind='notification' AND n.notification_id=s.source_id
                LEFT JOIN observations o ON o.task_id=s.task_id AND o.attempt=s.attempt
                WHERE s.event_id=? ORDER BY s.observed_at,s.source_kind,s.source_id
                """, (event_id,))]
        return self._envelope(row) | {"first_seen_at": row["first_seen_at"], "last_seen_at": row["last_seen_at"], "sources": sources}

    def list_notifications(self, limit=100, after=None, state=None):
        return self.store.page("notifications", limit=limit, after=after, state=state)

    def get_notification(self, notification_id):
        return self.store.notification_detail(notification_id)

    def list_jobs(self, limit=100, after=None, state=None):
        return self.store.page("jobs", limit=limit, after=after, state=state)

    def get_job(self, job_id):
        return self.store.one("jobs", "job_id", job_id)

    @staticmethod
    def _task_view(task):
        return task | {key: value for key, value in task["payload"].items() if key in {"job_id", "tx_hash", "event_id"}}

    def list_tasks(self, limit=100, after=None, state=None):
        page = self.store.page("tasks", limit=limit, after=after, state=state)
        page["items"] = [self._task_view(row) for row in page["items"]]
        return page

    def get_task(self, task_id):
        task = self._task_view(self.store.one("tasks", "task_id", task_id))
        task["attempt_history"] = self.store.attempts(task_id)
        return task

    def list_deliveries(self, limit=100, after=None, state=None):
        return self.store.page("deliveries", limit=limit, after=after, state=state)

    def get_delivery(self, event_id):
        row = self.store.one("deliveries", "event_id", event_id)
        return row | {"event": self.get_event(event_id), "attempt_history": self.store.attempts(row["task_id"])}

    def status(self):
        with self.store.connect() as db:
            counts = {table: dict(db.execute(f"SELECT state,count(*) FROM {table} GROUP BY state"))
                      for table in ("notifications", "jobs", "tasks", "deliveries")}
            counts["events"] = db.execute("SELECT count(*) FROM events").fetchone()[0]
            due = db.execute("SELECT min(due_at) FROM tasks WHERE state IN ('queued','retry')").fetchone()[0]
        with self.store.worker_lock() as acquired:
            busy = not acquired
        return {"counts": counts, "worker": {"busy": busy, "running_tasks": counts["tasks"].get("running", 0), "next_due_at": due},
                "scope": self.scope, "updated_at": time.time()}

    summary = status

    def retry_task(self, task_id):
        with self.store.transaction() as db:
            task = decode_row(db.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone())
            if not task:
                raise OpsError("NOT_FOUND", "The retained task was not found.", 404)
            if task["state"] == "running":
                raise OpsError("TASK_RUNNING", "The original worker still owns this task.", 409)
            if task["state"] in {"succeeded", "cancelled"}:
                raise OpsError("TASK_FINAL", "Create a new operation for completed or cancelled work.", 409)
            if task["kind"] == "catchup":
                job = db.execute("SELECT state FROM jobs WHERE job_id=?", (task["payload"]["job_id"],)).fetchone()
                if job[0] == "cancelled":
                    raise OpsError("JOB_CANCELLED", "A cancelled catch-up retains its completed pages; create a new job to continue.", 409)
            moment = time.time()
            db.execute("UPDATE tasks SET state='queued',failures=0,due_at=?,updated_at=?,error=NULL,lease_token=NULL,lease_until=NULL WHERE task_id=?", (moment, moment, task_id))
            self._related_state(db, task, "queued", None)
        return self.get_task(task_id)

    def retry_delivery(self, event_id):
        row = self.store.one("deliveries", "event_id", event_id)
        self.retry_task(row["task_id"])
        return self.get_delivery(event_id)

    def retry_job(self, job_id):
        job = self.get_job(job_id)
        if job["state"] in {"completed", "cancelled"}:
            raise OpsError("JOB_FINAL", "This catch-up is complete or cancelled; use a new ID for a new query.", 409)
        self.retry_task(self._page_id(job_id, job["cursor"]))
        return self.get_job(job_id)

    def cancel_job(self, job_id):
        with self.store.transaction() as db:
            job = db.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            if not job:
                raise OpsError("NOT_FOUND", "The catch-up was not found.", 404)
            if job["state"] == "completed":
                raise OpsError("JOB_FINAL", "This catch-up has already completed.", 409)
            moment = time.time()
            db.execute("UPDATE jobs SET state='cancelled',updated_at=? WHERE job_id=?", (moment, job_id))
            task_id = self._page_id(job_id, job["cursor"])
            db.execute("UPDATE tasks SET state='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE task_id=? AND state!='succeeded'", (moment, task_id))
            db.execute("UPDATE attempts SET state='cancelled',finished_at=? WHERE task_id=? AND finished_at IS NULL", (moment, task_id))
        return self.get_job(job_id)

    def _related_state(self, db, task, state, error):
        body = encoded(error) if error else None
        moment, payload = time.time(), task["payload"]
        if task["kind"] == "bytx":
            status = {"running": "reconciling", "succeeded": "reconciled", "failed": "failed"}.get(state, "queued")
            db.execute("UPDATE notifications SET state=?,error=? WHERE task_id=?", (status, body, task["task_id"]))
        elif task["kind"] == "catchup":
            status = "failed" if state == "failed" else "running" if state == "running" else "queued"
            db.execute("UPDATE jobs SET state=?,error=?,updated_at=? WHERE job_id=? AND state NOT IN ('completed','cancelled')", (status, body, moment, payload["job_id"]))
        else:
            status = "delivered" if state == "succeeded" else state
            db.execute("UPDATE deliveries SET state=?,attempts=?,error=?,updated_at=? WHERE event_id=?", (status, task["attempts"], body, moment, payload["event_id"]))

    def _recover_locked(self):
        recovered = []
        with self.store.transaction() as db:
            rows = [decode_row(row) for row in db.execute("SELECT * FROM tasks WHERE state='running'")]
            for task in rows:
                uncertain = task["kind"] == "delivery" and not retry_safe(self.config)
                state = "uncertain" if uncertain else "retry" if task["failures"] + 1 < self.config.max_attempts else "failed"
                error = {"code": "DELIVERY_OUTCOME_UNKNOWN" if uncertain else "WORKER_INTERRUPTED",
                         "message": "The previous worker ended during the attempt; its original input and attempt record are retained."}
                moment = time.time()
                db.execute("UPDATE tasks SET state=?,failures=failures+1,lease_token=NULL,lease_until=NULL,due_at=?,updated_at=?,error=? WHERE task_id=?", (state, moment, moment, encoded(error), task["task_id"]))
                db.execute("UPDATE attempts SET state='interrupted',finished_at=?,error=? WHERE task_id=? AND finished_at IS NULL", (moment, encoded(error), task["task_id"]))
                self._related_state(db, task, state, error)
                recovered.append({"task_id": task["task_id"], "state": state})
        return recovered

    def recover(self):
        with self.store.worker_lock() as acquired:
            if not acquired:
                return {"recovered": [], "worker_busy": True}
            return {"recovered": self._recover_locked(), "worker_busy": False}

    def _claim(self):
        with self.store.transaction() as db:
            task = decode_row(db.execute("SELECT * FROM tasks WHERE state IN ('queued','retry') AND due_at<=? ORDER BY due_at,seq LIMIT 1", (time.time(),)).fetchone())
            if not task:
                return None
            moment, token = time.time(), uuid.uuid4().hex
            task.update(state="running", attempts=task["attempts"] + 1, lease_token=token, lease_until=None, claimed_at=moment)
            db.execute("UPDATE tasks SET state='running',attempts=?,lease_token=?,lease_until=NULL,updated_at=? WHERE task_id=?", (task["attempts"], token, moment, task["task_id"]))
            db.execute("INSERT INTO attempts(task_id,number,token,state,started_at) VALUES(?,?,?,'running',?)", (task["task_id"], task["attempts"], token, moment))
            self._related_state(db, task, "running", None)
        return task

    @staticmethod
    def _current(db, task):
        row = db.execute("SELECT state,lease_token FROM tasks WHERE task_id=?", (task["task_id"],)).fetchone()
        return row and row["state"] == "running" and row["lease_token"] == task["lease_token"]

    def _finish(self, db, task, state, result=None, error=None, delay=0):
        moment = time.time()
        attempt_state = state
        if task["kind"] == "bytx" and state == "succeeded":
            generation = db.execute("SELECT generation FROM tasks WHERE task_id=?", (task["task_id"],)).fetchone()[0]
            if generation != task["generation"]:
                state, delay = "queued", self.config.retry_base_seconds
        db.execute("UPDATE tasks SET state=?,result=?,error=?,due_at=?,updated_at=?,lease_token=NULL,lease_until=NULL,failures=failures+? WHERE task_id=?",
                   (state, encoded(result) if result is not None else None, encoded(error) if error else None,
                    moment + delay, moment, int(bool(error)), task["task_id"]))
        db.execute("UPDATE attempts SET state=?,finished_at=?,result=?,error=? WHERE task_id=? AND number=?",
                   (attempt_state, moment, encoded(result) if result is not None else None, encoded(error) if error else None, task["task_id"], task["attempts"]))
        self._related_state(db, task, state, error)

    def _failure(self, task, error, *, retryable=False, retry_after=None, uncertain=False, observation=None, result=None):
        failure = {"code": error.code, "message": error.message}
        attempts_left = task["failures"] + 1 < self.config.max_attempts
        state = "uncertain" if uncertain else "retry" if retryable and attempts_left else "failed"
        delay = min(self.config.retry_max_seconds, self.config.retry_base_seconds * 2 ** min(task["failures"], 30))
        if isinstance(retry_after, (int, float)) and math.isfinite(retry_after):
            delay = max(delay, min(max(0, retry_after), 86400))
        with self.store.transaction() as db:
            if not self._current(db, task):
                return
            if observation is not None:
                self.store.retain_observation(db, task, observation)
            self._finish(db, task, state, result, failure, delay)
            if task["kind"] == "delivery" and result is not None:
                db.execute("UPDATE deliveries SET last_result=? WHERE event_id=?", (encoded(result), task["payload"]["event_id"]))

    def _canonical(self, db, task, rows, sources):
        moment, added = time.time(), 0
        for canonical in rows:
            ident = digest(self.scope | {"provider_row_id": canonical["id"]})
            body, body_sha = encoded(canonical), digest(canonical)
            old = db.execute("SELECT canonical_sha FROM events WHERE event_id=?", (ident,)).fetchone()
            if old and old["canonical_sha"] != body_sha:
                raise ProviderError("CANONICAL_EVENT_CONFLICT", "A Mercury row ID returned different canonical bytes; its original event and delivery remain retained.")
            if not old:
                db.execute("INSERT INTO events(event_id,provider_row_id,canonical,canonical_sha,contract_id,tx_hash,event_index,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?)",
                           (ident, canonical["id"], body, body_sha, canonical["contract_id"], canonical["tx"].lower(), canonical.get("event_index"), moment, moment))
                delivery_id = "delivery-" + ident
                self.store.enqueue(db, delivery_id, "delivery", {"event_id": ident})
                db.execute("INSERT INTO deliveries(event_id,task_id,state,updated_at) VALUES(?,?,'queued',?)", (ident, delivery_id, moment))
                added += 1
            else:
                db.execute("UPDATE events SET last_seen_at=? WHERE event_id=?", (moment, ident))
            for kind, source_id in sources:
                db.execute("INSERT OR IGNORE INTO event_sources VALUES(?,?,?,?,?,?)", (ident, kind, source_id, task["task_id"], task["attempts"], moment))
        return added

    def _read_task(self, task):
        payload = task["payload"]
        if task["kind"] == "bytx":
            page = self.provider.by_tx(payload["tx_hash"])
            job = None
        else:
            job = self.get_job(payload["job_id"])
            if job["state"] == "cancelled":
                return
            if job["cursor"] != payload["cursor"]:
                raise ProviderError("CURSOR_CONFLICT", "The retained page task does not match its job cursor.")
            page = self.provider.catchup_page(contracts=job["contracts"], ledger_from=job["ledger_from"], ledger_to=job["ledger_to"], page_size=job["page_size"], cursor=job["cursor"])
        try:
            rows = [validate_row(row) for row in page.rows]
            if task["kind"] == "bytx":
                if any(row["tx"].lower() != payload["tx_hash"] for row in rows):
                    raise ProviderError("PROVIDER_SCOPE_MISMATCH", "The transaction query returned a different transaction.")
                visible = [row for row in rows if row["contract_id"] in payload["contracts"]]
                if not visible:
                    raise ProviderError("INDEX_NOT_VISIBLE", "The transaction's configured contract events are not yet visible in Mercury; retrying the retained notification.", retryable=True)
                filters = payload.get("topic_filters", {})
                selected = [row for row in visible if all(row.get(key) == value for key, value in filters.items())]
            else:
                filters = job.get("topic_filters", {})
                selected = [row for row in rows if all(row.get(key) == value for key, value in filters.items())]
                ids = [row["id"] for row in rows]
                if len(rows) > job["page_size"] or any(row["contract_id"] not in job["contracts"] for row in rows):
                    raise ProviderError("PROVIDER_SCOPE_MISMATCH", "The page exceeded its frozen contract scope or page size.")
                if ids != sorted(set(ids)) or (ids and job["cursor"] is not None and ids[0] <= job["cursor"]):
                    raise ProviderError("NONADVANCING_CURSOR", "Mercury returned an overlapping or unordered cursor page; the previous checkpoint is retained.")
            with self.store.transaction() as db:
                if not self._current(db, task):
                    return
                self.store.retain_observation(db, task, page)
                sources = [("catchup", job["job_id"])] if job else [("transaction", task["task_id"])]
                if job is None:
                    sources += [("notification", row[0]) for row in db.execute("SELECT notification_id FROM notifications WHERE task_id=? AND received_at<=?", (task["task_id"], task["claimed_at"]))]
                added = self._canonical(db, task, selected, sources)
                result = {"rows_observed": len(rows), "events_in_scope": len(selected), "new_events": added,
                          "provider_response_sha256": digest(page.raw_body)}
                if job is not None:
                    cursor = rows[-1]["id"] if rows else job["cursor"]
                    state = "queued" if rows else "completed"
                    db.execute("UPDATE jobs SET cursor=?,pages=pages+1,events_seen=events_seen+?,state=?,updated_at=?,error=NULL WHERE job_id=?",
                               (cursor, len(rows), state, time.time(), job["job_id"]))
                    if rows:
                        self.store.enqueue(db, self._page_id(job["job_id"], cursor), "catchup", {"job_id": job["job_id"], "cursor": cursor})
                    result.update(cursor=cursor, job_state=state)
                self._finish(db, task, "succeeded", result)
        except ProviderError as error:
            if error.observation is None:
                error.observation = page
            raise

    def _delivery_task(self, task):
        row = self.store.one("events", "event_id", task["payload"]["event_id"])
        envelope = self._envelope(row)
        outcome = self.deliver(self.config, envelope, row["event_id"])
        result = asdict(outcome) if is_dataclass(outcome) else dict(outcome)
        state = result.get("status")
        if state == "delivered":
            with self.store.transaction() as db:
                if self._current(db, task):
                    self._finish(db, task, "succeeded", result)
                    db.execute("UPDATE deliveries SET last_result=? WHERE event_id=?", (encoded(result), row["event_id"]))
        elif state in {"retry", "unknown", "failed"}:
            error = OpsError("DELIVERY_OUTCOME_UNKNOWN" if state == "unknown" else "DELIVERY_RETRY" if state == "retry" else "DELIVERY_FAILED",
                             str(result.get("detail") or "The destination did not acknowledge delivery."))
            self._failure(task, error, retryable=state == "retry", uncertain=state == "unknown",
                          retry_after=result.get("retry_after"), result=result)
        else:
            raise OpsError("INVALID_DELIVERY_RESULT", "The destination adapter returned an unsupported result.")

    def run_once(self):
        with self.store.worker_lock() as acquired:
            if not acquired:
                return {"worked": False, "state": "worker_busy"}
            self._recover_locked()
            task = self._claim()
            if task is None:
                return {"worked": False, "state": "idle"}
            try:
                if task["kind"] == "delivery":
                    self._delivery_task(task)
                else:
                    self._read_task(task)
            except ProviderError as error:
                self._failure(task, error, retryable=error.retryable, retry_after=error.retry_after, observation=error.observation)
            except OpsError as error:
                self._failure(task, error, uncertain=task["kind"] == "delivery")
            except Exception:
                self._failure(task, OpsError("TASK_EXECUTION_FAILED", "The attempt stopped unexpectedly; its input and previous result remain available."), uncertain=task["kind"] == "delivery")
            current = self.store.one("tasks", "task_id", task["task_id"])
            return {"worked": True, "task_id": task["task_id"], "kind": task["kind"], "state": current["state"], "error": current["error"]}

    def run_forever(self, stop_event):
        while not stop_event.is_set():
            result = self.run_once()
            if not result["worked"]:
                stop_event.wait(self.config.worker_poll_seconds)

    def iter_event_export(self):
        with self.store.connect() as db:
            db.execute("BEGIN")
            try:
                for row in db.execute("SELECT * FROM events ORDER BY seq"):
                    yield (encoded(self._envelope(decode_row(row))) + "\n").encode()
            finally:
                db.execute("ROLLBACK")

    def iter_operations_export(self):
        tables = ("metadata", "notifications", "jobs", "tasks", "attempts", "observations", "events", "deliveries", "event_sources")
        with self.store.connect() as db:
            db.execute("BEGIN")
            try:
                # The first read pins one WAL snapshot for the entire export.
                db.execute("SELECT value FROM metadata ORDER BY key").fetchall()
                yield (encoded({"schema": "mercury-ops.export.v1", "kind": "header", "scope": self.scope, "exported_at": time.time()}) + "\n").encode()
                counts = {}
                for table in tables:
                    count = 0
                    for original in db.execute(f"SELECT * FROM {table}"):
                        row = decode_row(original)
                        for key, value in list(row.items()):
                            if isinstance(value, bytes):
                                row[key + "_base64"] = base64.b64encode(value).decode("ascii")
                                del row[key]
                        yield (encoded({"schema": "mercury-ops.export.v1", "kind": table, "record": row}) + "\n").encode()
                        count += 1
                    counts[table] = count
                yield (encoded({"schema": "mercury-ops.export.v1", "kind": "complete", "counts": counts}) + "\n").encode()
            finally:
                db.execute("ROLLBACK")

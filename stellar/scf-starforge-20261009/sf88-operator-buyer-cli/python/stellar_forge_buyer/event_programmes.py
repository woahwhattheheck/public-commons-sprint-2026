"""Private browser operations around the original EventFeedAnalysis programme.

Exact upload chunks and action requests live in the existing workspace database.
The coordinator is outside the native Analysis executor, whose existing jobs own
imports, exports, reports, workbooks and whole-workspace archives.
"""
from __future__ import annotations
import base64
import binascii
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import tempfile
import threading
from .errors import StateError

CHUNK = 256 * 1024
LIMITS = {"ndjson": 32 * 1024 * 1024, "manifest": 4 * 1024 * 1024}
ID = re.compile(r"[a-f0-9]{32}")
HASH = re.compile(r"[a-f0-9]{64}")
NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,23}")


def need(ok, message):
    if not ok:
        raise StateError("EVENT_PROGRAMME_" + message)


def identifier(value):
    need(isinstance(value, str) and ID.fullmatch(value), "ORIGINAL_ID_REQUIRED")
    return value


def name(value):
    need(isinstance(value, str) and NAME.fullmatch(value), "NAME_REQUIRED")
    return value


def now():
    return datetime.now(timezone.utc).isoformat()


def raw(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      allow_nan=False, separators=(",", ":"))


class EventProgrammes:
    def __init__(self, workspace, *, source_cli=None):
        self.workspace, self.database = workspace, workspace.database
        self.source_cli = Path(source_cli).expanduser().absolute() if source_cli else (
            Path(__file__).resolve().parents[2] / "event-feed" / "analysis-source-cli.mjs")
        self._lock = threading.RLock()
        self._active = None
        self._closed = False
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("CREATE TABLE IF NOT EXISTS sf_event_browser_inputs(sequence INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,record TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS sf_event_browser_chunks(input_id TEXT NOT NULL,kind TEXT NOT NULL,offset INTEGER NOT NULL,body BLOB NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(input_id,kind,offset))")
            db.execute("CREATE TABLE IF NOT EXISTS sf_event_browser_actions(sequence INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,programme TEXT NOT NULL,record TEXT NOT NULL)")
            for row in db.execute("SELECT id,record FROM sf_event_browser_actions").fetchall():
                value = json.loads(row["record"])
                if value["status"] == "RUNNING":
                    value.update(status="INTERRUPTED", updated_at=now(),
                                 error="Continue this original saved action.")
                    db.execute("UPDATE sf_event_browser_actions SET record=? WHERE id=?", (raw(value), row["id"]))
            db.commit()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="event-programmes")

    def close(self):
        with self._lock:
            self._closed = True
        self._executor.shutdown(wait=True)

    def _core(self, programme, *, progress=None):
        # Lazy import avoids a cycle through AnalysisWorkspace at package startup.
        from .event_feed_analysis import EventFeedAnalysis
        return EventFeedAnalysis(self.workspace, name(programme), progress=progress)

    def _input(self, db, input_id):
        row = db.execute("SELECT record FROM sf_event_browser_inputs WHERE id=?", (identifier(input_id),)).fetchone()
        need(row is not None, "INPUT_NOT_FOUND")
        return json.loads(row[0])

    def create_input(self, body):
        input_id = identifier(body.get("id"))
        files = body.get("files")
        need(isinstance(files, dict) and set(files) == set(LIMITS), "BOTH_ORIGINAL_FILES_REQUIRED")
        selected = {}
        for kind, maximum in LIMITS.items():
            item = files[kind]
            need(isinstance(item, dict) and type(item.get("bytes")) is int and
                 0 <= item["bytes"] <= maximum and
                 isinstance(item.get("sha256"), str) and HASH.fullmatch(item["sha256"]), "FILE_IDENTITY_INVALID")
            label = item.get("name")
            need(isinstance(label, str) and 0 < len(label) <= 240 and not any(ord(c) < 32 for c in label),
                 "FILE_LABEL_INVALID")
            selected[kind] = {"name": label, "bytes": item["bytes"], "sha256": item["sha256"]}
        value = {"id": input_id, "files": selected, "created_at": now()}
        with self._lock, self.database._connection() as db:
            need(not self._closed, "CLOSED")
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT record FROM sf_event_browser_inputs WHERE id=?", (input_id,)).fetchone()
            if old:
                need(json.loads(old[0])["files"] == selected, "INPUT_ID_REUSED")
            else:
                db.execute("INSERT INTO sf_event_browser_inputs(id,record) VALUES(?,?)", (input_id, raw(value)))
            db.commit()
        return self.input_status(input_id)

    def input_status(self, input_id):
        from .event_feed_analysis import sha
        with self.database._connection(readonly=True) as db:
            value = self._input(db, input_id)
            received = {}
            for kind, item in value["files"].items():
                count = db.execute("SELECT COALESCE(SUM(length(body)),0) FROM sf_event_browser_chunks WHERE input_id=? AND kind=?", (input_id, kind)).fetchone()[0]
                need(count <= item["bytes"], "RECEIVING_SIZE_CHANGED")
                received[kind] = count
        return {**value, "received": received, "complete": all(received[k] == v["bytes"] for k, v in value["files"].items()),
                "chunk_bytes": CHUNK, "workspace_id": self.workspace.identity}

    def chunk(self, input_id, kind, body):
        from .event_feed_analysis import sha
        need(kind in LIMITS, "FILE_KIND_INVALID")
        offset = body.get("offset")
        need(type(offset) is int and offset >= 0, "OFFSET_REQUIRED")
        try:
            binary = base64.b64decode(body.get("base64", ""), validate=True)
        except (ValueError, TypeError, binascii.Error):
            raise StateError("EVENT_PROGRAMME_CHUNK_ENCODING_INVALID") from None
        need(0 < len(binary) <= CHUNK and sha(binary) == body.get("sha256"), "CHUNK_CHANGED")
        with self._lock, self.database._connection() as db:
            need(not self._closed, "CLOSED")
            db.execute("BEGIN IMMEDIATE")
            value = self._input(db, input_id)
            old = db.execute("SELECT body,sha256 FROM sf_event_browser_chunks WHERE input_id=? AND kind=? AND offset=?", (input_id, kind, offset)).fetchone()
            if old:
                need(old["body"] == binary and old["sha256"] == body["sha256"], "ORIGINAL_CHUNK_REQUIRED")
            else:
                received = db.execute("SELECT COALESCE(SUM(length(body)),0) FROM sf_event_browser_chunks WHERE input_id=? AND kind=?", (input_id, kind)).fetchone()[0]
                need(offset == received and received + len(binary) <= value["files"][kind]["bytes"],
                     "CONTIGUOUS_ORIGINAL_CHUNK_REQUIRED")
                db.execute("INSERT INTO sf_event_browser_chunks VALUES(?,?,?,?,?)", (input_id, kind, offset, binary, body["sha256"]))
            db.commit()
        return self.input_status(input_id)

    def _originals(self, input_id):
        from .event_feed_analysis import sha
        result = {}
        with self.database._connection(readonly=True) as db:
            value = self._input(db, input_id)
            for kind, item in value["files"].items():
                pieces, offset = [], 0
                for row in db.execute("SELECT offset,body,sha256 FROM sf_event_browser_chunks WHERE input_id=? AND kind=? ORDER BY offset", (input_id, kind)):
                    need(row["offset"] == offset and sha(row["body"]) == row["sha256"], "RETAINED_CHUNK_CHANGED")
                    pieces.append(row["body"])
                    offset += len(row["body"])
                content = b"".join(pieces)
                need(len(content) == item["bytes"] and sha(content) == item["sha256"], "COMPLETE_ORIGINAL_FILE_REQUIRED")
                result[kind] = content
        return result

    def inspect_input(self, input_id, *, pointer=None, offset=0, limit=25):
        """Read complete original payloads through the trusted installed receiver."""
        input_id = identifier(input_id)
        need(pointer is None or isinstance(pointer, str) and len(pointer) <= 2000,
             "PAYLOAD_POINTER_REQUIRED")
        need(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 100,
             "FIELD_PAGE_INVALID")
        with self._lock:
            need(not self._closed, "CLOSED")
            future = self._executor.submit(self._inspect_input, input_id, pointer, offset, limit)
        return future.result()

    def _inspect_input(self, input_id, pointer, offset, limit):
        from .event_feed_analysis import exact_file, regular, sha
        originals = self._originals(input_id)
        source_cli = self.source_cli.resolve(strict=True)
        source_core = source_cli.with_name("analysis-source.mjs")
        need(source_cli.name == "analysis-source-cli.mjs" and source_core.is_file(),
             "ORIGINAL_SOURCE_RECEIVER_REQUIRED")
        cli_raw, core_raw = regular(source_cli), regular(source_core)
        with tempfile.TemporaryDirectory(prefix="event-payload-inspection-") as temporary:
            root = Path(temporary)
            for name_, content in (("analysis-source-cli.mjs", cli_raw), ("analysis-source.mjs", core_raw),
                                   ("events.ndjson", originals["ndjson"]), ("manifest.json", originals["manifest"])):
                exact_file(root / name_, content)
            args = [self.workspace.node, str(root / "analysis-source-cli.mjs"),
                    "--ndjson", str(root / "events.ndjson"), "--manifest", str(root / "manifest.json")]
            args += (["--inspect-fields", "true"] if pointer is None else
                     ["--field-values", pointer, "--offset", str(offset), "--limit", str(limit)])
            completed = subprocess.run(args, capture_output=True, check=False, timeout=120)
        need(completed.returncode == 0,
             completed.stderr.decode("utf-8", "replace")[:8000] or "SOURCE_INSPECTION_FAILED")
        need(0 < len(completed.stdout) <= 49 * 1024 * 1024, "SOURCE_INSPECTION_TOO_LARGE")
        result = json.loads(completed.stdout)
        expected = "stellar-forge.event-feed-payload-" + ("fields" if pointer is None else "values") + ".v1"
        need(result.get("schema") == expected and
             result.get("original_files") == {kind: {"bytes": len(value), "sha256": sha(value)}
                                               for kind, value in originals.items()},
             "SOURCE_INSPECTION_CHANGED")
        if pointer is not None:
            need(result.get("pointer") == pointer and result.get("offset") == offset and result.get("limit") == limit,
                 "SOURCE_INSPECTION_SELECTION_CHANGED")
        return {**result, "workspace_id": self.workspace.identity, "input_id": input_id,
                "receiver": {"cli_sha256": sha(cli_raw), "core_sha256": sha(core_raw)}}

    def overview(self, *, actions_before=None, inputs_before=None, limit=25):
        need(type(limit) is int and 1 <= limit <= 100 and
             all(value is None or type(value) is int and value > 0 for value in (actions_before, inputs_before)), "PAGE_INVALID")
        # Initialise the original programme tables even before its first review.
        self._core("event_workspace")
        with self.database._connection(readonly=True) as db:
            programmes = [json.loads(r[0]) for r in db.execute("SELECT record FROM sf_analysis_event_programmes ORDER BY name")]
            rows = db.execute("SELECT sequence,record FROM sf_event_browser_actions WHERE (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?", (actions_before, actions_before, limit + 1)).fetchall()
            inputs = db.execute("SELECT sequence,record FROM sf_event_browser_inputs WHERE (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?", (inputs_before, inputs_before, limit + 1)).fetchall()
        # Input and action pagination have distinct cursors.
        return {"workspace_id": self.workspace.identity, "active": self._active,
                "source_receiver_available": self.source_cli.is_file() and self.source_cli.with_name("analysis-source.mjs").is_file(),
                "programmes": programmes, "actions": [json.loads(r["record"]) for r in rows[:limit]],
                "next_actions": rows[limit-1]["sequence"] if len(rows)>limit else None,
                "inputs": [json.loads(r["record"]) for r in inputs[:limit]],
                "next_inputs": inputs[limit-1]["sequence"] if len(inputs)>limit else None}

    def programme(self, programme):
        return self._core(programme).status()

    def _action(self, action_id):
        with self.database._connection(readonly=True) as db:
            row = db.execute("SELECT record FROM sf_event_browser_actions WHERE id=?", (identifier(action_id),)).fetchone()
        need(row is not None, "ACTION_NOT_FOUND")
        return json.loads(row[0])

    def _store(self, value):
        value["updated_at"] = now()
        with self.database._connection() as db:
            db.execute("UPDATE sf_event_browser_actions SET record=? WHERE id=?", (raw(value), value["id"]))

    def action(self, action_id):
        return self._action(action_id)

    def start(self, programme, body):
        programme = name(programme)
        action_id = identifier(body.get("id"))
        operation_id = identifier(body.get("operation_id"))
        action = body.get("action")
        need(action in {"review", "apply", "refresh-review", "deliver"}, "ACTION_INVALID")
        request = {"action": action, "operation_id": operation_id}
        if action == "review":
            request["input_id"] = identifier(body.get("input_id"))
            mapping = body.get("mapping")
            need(isinstance(mapping, dict) and isinstance(mapping.get("fields"), list) and
                 len(mapping["fields"]) <= 100 and len(raw(mapping).encode()) <= 1024 * 1024, "FIELD_MAPPING_REQUIRED")
            request["mapping"] = mapping
        if action in {"apply", "refresh-review"}:
            digest = body.get("review_sha256")
            note = body.get("note")
            need(isinstance(digest, str) and HASH.fullmatch(digest), "REVIEW_REQUIRED")
            need(isinstance(note, str) and note.strip() and len(note.encode()) <= 8000, "DECISION_NOTE_REQUIRED")
            request.update(review_sha256=digest, note=note)
            if action == "apply":
                columns = body.get("columns", {})
                need(isinstance(columns, dict) and len(raw(columns).encode()) <= 512 * 1024, "WORKBOOK_COLUMNS_INVALID")
                request["columns"] = columns
        resume = body.get("resume", False)
        need(type(resume) is bool, "RESUME_INVALID")
        with self._lock:
            need(not self._closed, "CLOSED")
            with self.database._connection(readonly=True) as db:
                row = db.execute("SELECT programme,record FROM sf_event_browser_actions WHERE id=?", (action_id,)).fetchone()
            if row:
                value = json.loads(row["record"])
                need(row["programme"] == programme and value["request"] == request, "ACTION_ID_REUSED")
                if value["status"] in {"RUNNING", "COMPLETE"}:
                    return value
                need(resume, "EXPLICIT_CONTINUATION_REQUIRED")
            else:
                value = {"id": action_id, "programme": programme, "request": request,
                         "workspace_id": self.workspace.identity, "created_at": now(),
                         "status": "READY", "attempts": 0}
                with self.database._connection() as db:
                    db.execute("INSERT INTO sf_event_browser_actions(id,programme,record) VALUES(?,?,?)",
                               (action_id, programme, raw(value)))
            need(self._active is None, "ANOTHER_ACTION_RUNNING")
            # One browser request has one retained engine identity. Later retries
            # do not reinterpret paths, selected files or a reviewed decision.
            value.update(status="RUNNING", error=None, attempts=value["attempts"]+1)
            self._active = action_id
            self._store(value)
            try:
                self._executor.submit(self._run, action_id, resume)
            except BaseException:
                self._active = None
                value.update(status="INTERRUPTED", error="Continue the retained action.")
                self._store(value)
                raise
        return value

    def _run(self, action_id, resume):
        from .event_feed_analysis import encoded, exact_file, regular
        value = self._action(action_id)
        try:
            def progress(event):
                current = self._action(action_id)
                current["progress"] = event
                self._store(current)
            core = self._core(value["programme"], progress=progress)
            request = value["request"]
            operation = request["operation_id"]
            if request["action"] == "review":
                originals = self._originals(request["input_id"])
                # Executable source is chosen by the local launch configuration.
                # Browser inputs are data only, never an executable source path.
                with tempfile.TemporaryDirectory(prefix="event-browser-source-") as temporary:
                    root = Path(temporary)
                    exact_file(root / "events.ndjson", originals["ndjson"])
                    exact_file(root / "manifest.json", originals["manifest"])
                    exact_file(root / "mapping.json", encoded(request["mapping"]))
                    result = core.review(root / "events.ndjson", root / "manifest.json",
                        mapping=root / "mapping.json", source_cli=self.source_cli,
                        node=self.workspace.node, operation_id=operation, resume=resume)
            elif request["action"] == "apply":
                result = core.apply(operation, request["review_sha256"], note=request["note"],
                                    columns=request["columns"], resume=resume)
            elif request["action"] == "refresh-review":
                # A restart after core save must reopen the same refreshed review,
                # rather than append another generation to the original operation.
                saved = core.operation(operation)
                review = saved.get("review", {})
                if review.get("review_sha256") != request["review_sha256"]:
                    prior = saved.get("prior_customer_attempts", [])
                    need(prior and prior[-1]["review"]["review_sha256"] == request["review_sha256"] and
                         prior[-1]["note"] == request["note"] and
                         review.get("customer_review_note") == request["note"], "REFRESHED_REVIEW_CHANGED")
                    result = review
                else:
                    result = core.refresh_review(operation, request["review_sha256"], note=request["note"])
            else:
                # The native engine owns the immutable archive/delivery plan.
                destination = self.database.directory / "event-browser-deliveries" / action_id
                result = core.deliver(operation, destination, resume=resume, delivery_id=action_id)
            value = self._action(action_id)
            value.update(status="COMPLETE", result=result, error=None)
            self._store(value)
        except Exception as error:
            value = self._action(action_id)
            value.update(status="ERROR", error=str(error))
            self._store(value)
        finally:
            with self._lock:
                self._active = None

    def download(self, programme, operation_id, filename):
        core = self._core(programme)
        operation = core.operation(identifier(operation_id))
        delivery = operation.get("delivery")
        need(delivery is not None, "DELIVERY_REQUIRED")
        need(isinstance(filename, str) and Path(filename).name == filename, "FILE_NAME_INVALID")
        item = next((r for r in delivery["files"] if r["name"] == filename), None)
        need(item is not None, "DELIVERY_FILE_NOT_FOUND")
        # Do not follow an absolute path retained by a sender after archive restore.
        path = self.database.directory / "event-browser-deliveries" / operation_id / filename
        mime = ("application/zip" if filename.endswith(".zip") else
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if filename.endswith(".xlsx") else
                "text/html;charset=utf-8" if filename.endswith(".html") else
                "application/json" if filename.endswith(".json") else
                "application/x-ndjson" if filename.endswith((".jsonl", ".ndjson")) else "text/plain;charset=utf-8")
        return path, {**item, "filename": filename, "mime": mime}

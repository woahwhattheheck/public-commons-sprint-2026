"""Persistent agent customer workflows over the original Buyer and readers.

The graph checkpoints application progress. Original Buyer intents, reviews,
attempts, file transfers and response receipts remain the effect authority.
Optional framework imports occur only when a CustomerWorkflow is opened.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import tempfile
from typing import TypedDict
from urllib.parse import urlsplit, urlunsplit

from .client import Buyer, Review, intent
from .errors import BuyerError, DeliveryError, StateError
from .storage import digest, dump, lock, parse, private_directory, read, sync_directory, write
from .streams import StreamDelivery, export_saved_stream

SCHEMA = "stellar-forge.agent-workflow.v1"
ARTIFACT_SCHEMA = "stellar-forge.agent-artifact.v1"
FORMATS = {"auto", "json", "csv", "binary", "sse", "ndjson", "paid-file"}
MAX_EXPORT_BYTES = 256 * 1024 * 1024


def _json(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False,
                       separators=(",", ":")) + "\n").encode("utf-8")


def _time():
    return datetime.now(timezone.utc).isoformat()


def _error(error):
    return {"code": getattr(error, "code", None) or type(error).__name__,
            "returncode": getattr(error, "returncode", None)}


def _url(value):
    """Model-visible route; credentials and query values stay in native state."""
    try:
        parsed = urlsplit(value or "")
        host = parsed.hostname or ""
        if ":" in host:
            host = "[" + host + "]"
        if parsed.port:
            host += ":" + str(parsed.port)
        return {"url": urlunsplit((parsed.scheme, host, parsed.path, "", "")),
                "query_present": bool(parsed.query)}
    except ValueError:
        return {"url": "", "query_present": False}


def _review_summary(review):
    native = review.native
    return {"intent_id": review.intent_id, "configuration_sha256": review.config_sha256,
            "body_sha256": review.body_sha256, "body_bytes": native.get("bodyBytes"),
            "method": native.get("method"), **_url(native.get("sellerUrl")),
            "terms": native.get("acceptedTerms"), "request_timeout_ms": native.get("requestTimeoutMs"),
            "file_promise": review.file_promise,
            "operation_ticket_sha256": review.operation_ticket_sha256}


def _file(path, *, name, content_type=None):
    path = Path(path)
    checksum = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise DeliveryError("ARTIFACT_FILE_TYPE_INVALID")
        total = 0
        while data := source.read(65536):
            checksum.update(data)
            total += len(data)
        if total != info.st_size:
            raise DeliveryError("ARTIFACT_FILE_CHANGED")
    return {"name": name, "path": str(path), "bytes": total, "sha256": checksum.hexdigest(),
            "content_type": content_type}


@contextmanager
def _open_file(metadata):
    """Hash the retained file before exposing that same descriptor."""
    fd = os.open(metadata["path"], os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size != metadata["bytes"]:
            raise DeliveryError("ARTIFACT_FILE_CHANGED")
        checksum = hashlib.sha256()
        while data := source.read(65536):
            checksum.update(data)
        if checksum.hexdigest() != metadata["sha256"]:
            raise DeliveryError("ARTIFACT_FILE_CHANGED")
        source.seek(0)
        yield source


def _pointer(value, pointer):
    if not pointer:
        return value
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        raise StateError("JSON_POINTER_REQUIRED")
    for part in pointer[1:].split("/"):
        index = 0
        while index < len(part):
            if part[index] == "~":
                if index + 1 == len(part) or part[index + 1] not in "01":
                    raise StateError("JSON_POINTER_INVALID")
                index += 1
            index += 1
        part = part.replace("~1", "/").replace("~0", "~")
        try:
            if isinstance(value, list):
                if not part.isdigit() or (len(part) > 1 and part.startswith("0")):
                    raise ValueError()
                value = value[int(part)]
            elif isinstance(value, dict):
                value = value[part]
            else:
                raise ValueError()
        except (KeyError, IndexError, ValueError):
            raise StateError("JSON_POINTER_NOT_FOUND") from None
    return value


def _read_artifact(artifact, *, offset=0, limit=20, pointer="", event_json=False):
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 100:
        raise StateError("AGENT_RECORD_PAGE_INVALID")
    files = {item["name"]: item for item in artifact["files"]}
    format = artifact["format"]
    if type(event_json) is not bool or (event_json and format != "sse"):
        raise StateError("EVENT_JSON_REQUIRES_SSE")
    if format in ("binary", "paid-file"):
        with _open_file(files["response.bin"]):
            pass
        return {"format": format, "complete": artifact["complete"], "file": files["response.bin"]}
    if format == "json":
        with _open_file(files["data.json"]) as source:
            value = _pointer(parse(source.read()), pointer)
        if isinstance(value, list):
            if offset > len(value):
                raise StateError("AGENT_RECORD_PAGE_INVALID")
            selected = value[offset:offset + limit]
            return {"format": format, "pointer": pointer, "offset": offset, "records": selected,
                    "total": len(value), "next_offset": offset + len(selected) if offset + len(selected) < len(value) else None}
        if offset:
            raise StateError("AGENT_RECORD_PAGE_INVALID")
        return {"format": format, "pointer": pointer, "value": value, "next_offset": None}
    count = artifact["records"]
    if offset > count:
        raise StateError("AGENT_RECORD_PAGE_INVALID")
    selected = []
    if format in ("sse", "ndjson"):
        stream = StreamDelivery(Path(files["records.jsonl"]["path"]).parent, artifact["stream_manifest"])
        records = stream.records(start=offset)
        try:
            for record in records:
                if len(selected) == limit:
                    break
                if format == "sse":
                    if event_json:
                        value = {"index": record.index, "event": record.event, "id": record.id,
                                 "value": _pointer(record.json(), pointer)}
                    else:
                        value = asdict(record) if not pointer else {
                            "index": record.index, "value": _pointer(asdict(record), pointer)}
                else:
                    value = {"index": record.index, "value": _pointer(record.value, pointer)}
                selected.append(value)
        finally:
            records.close()
    else:
        with _open_file(files["records.jsonl"]) as source:
            for index, raw in enumerate(source):
                if index < offset:
                    continue
                if len(selected) == limit:
                    break
                value = parse(raw)
                if value.get("index") != index:
                    raise DeliveryError("AGENT_RECORD_INDEX_CHANGED")
                selected.append({"index": index, "value": _pointer(value["value"], pointer)})
    return {"format": format, "complete": artifact["complete"], "offset": offset, "records": selected,
            "total": count, "next_offset": offset + len(selected) if offset + len(selected) < count else None}


class _State(TypedDict, total=False):
    run_id: str
    status: str
    review_key: str | None
    review: dict | None
    action: str | None
    error: dict | None
    native: dict | None
    artifact: dict | None


class CustomerWorkflow:
    """One persistent LangGraph customer application using an existing Buyer.

    Registration selects an existing original intent, or an original SF31
    response-writer receipt. It never creates or replaces a payment attempt.
    Native request preparation remains available through ``workflow.buyer``.
    """

    def __init__(self, buyer: Buyer, *, directory=None):
        try:
            from langgraph.checkpoint.sqlite import SqliteSaver
            from langgraph.graph import END, START, StateGraph
            from langgraph.types import Command, interrupt
        except ImportError:
            raise StateError("INSTALL_STELLAR_FORGE_BUYER_AGENTS_EXTRA") from None
        self.buyer = buyer
        self.directory = private_directory(Path(directory) if directory else buyer.state_dir / "agents")
        self.runs = private_directory(self.directory / "runs")
        self.Command, self.interrupt = Command, interrupt
        binding = {"schema": SCHEMA, "buyer_state": str(buyer.state_dir)}
        with lock(self.directory):
            identity = self.directory / "workspace.json"
            if identity.exists():
                if parse(read(identity, 65536)) != binding:
                    raise StateError("AGENT_WORKSPACE_BUYER_CHANGED")
            else:
                dump(identity, binding, exclusive=True)
            database = self.directory / "checkpoints.sqlite3"
            fd = os.open(database, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
                    raise StateError("PRIVATE_CHECKPOINT_FILE_REQUIRED")
            finally:
                os.close(fd)
            self.connection = sqlite3.connect(str(database), timeout=30, check_same_thread=False)
            self.connection.execute("PRAGMA synchronous=FULL")
            self.checkpointer = SqliteSaver(self.connection)
            self.checkpointer.setup()
        graph = StateGraph(_State)
        graph.add_node("assess", self._assess)
        graph.add_node("review", self._decision)
        graph.add_node("execute", self._execute)
        graph.add_node("consume", self._consume)
        graph.add_node("recover", self._recovery)
        graph.add_edge(START, "assess")
        graph.add_conditional_edges("assess", lambda s: s["status"], {
            "REVIEW_REQUIRED": "review", "CONSUMING": "consume", "RECOVERY_REQUIRED": "recover"})
        graph.add_conditional_edges("review", lambda s: s["status"], {
            "EXECUTING": "execute", "CANCELLED": END})
        graph.add_conditional_edges("execute", lambda s: s["status"], {
            "CONSUMING": "consume", "RECOVERY_REQUIRED": "recover"})
        graph.add_conditional_edges("consume", lambda s: s["status"], {
            "AVAILABLE": END, "RECOVERY_REQUIRED": "recover"})
        graph.add_conditional_edges("recover", lambda s: s["status"], {
            "ASSESSING": "assess", "CANCELLED": END})
        self.graph = graph.compile(checkpointer=self.checkpointer)

    def close(self):
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _directory(self, run_id):
        return self.runs / digest(intent(run_id).encode("utf-8"))

    def _record(self, run_id):
        directory = private_directory(self._directory(run_id), create=False)
        value = parse(read(directory / "run.json", 4 * 1024 * 1024))
        if value.get("schema") != SCHEMA or value.get("run_id") != run_id:
            raise StateError("AGENT_RUN_IDENTITY_INVALID")
        return value

    def _config(self, run_id):
        # Explicit coordinates make this a separate checkpointed workflow when
        # invoked by a tool inside another LangGraph. Never merge an ambient
        # parent's configurable/__pregel_* values into this configuration.
        return {"configurable": {"thread_id": "stellar-forge:" + digest(run_id.encode("utf-8")),
                                  "checkpoint_ns": ""}, "recursion_limit": 32}

    def _register(self, run_id, source, options):
        record = {"schema": SCHEMA, "run_id": intent(run_id), "source": source, "options": options}
        directory = private_directory(self._directory(run_id))
        with lock(directory):
            path = directory / "run.json"
            if path.exists():
                if parse(read(path, 4 * 1024 * 1024)) != record:
                    raise StateError("AGENT_RUN_ALREADY_BOUND_TO_DIFFERENT_SOURCE")
            else:
                dump(path, record, exclusive=True)
                private_directory(directory / "reviews")
        return self.inspect(run_id)

    def register(self, run_id, *, intent_id, format="auto", allow_partial=False,
                 file_options=None, max_export_bytes=MAX_EXPORT_BYTES):
        if format not in FORMATS or type(allow_partial) is not bool:
            raise StateError("AGENT_CONSUMPTION_OPTIONS_INVALID")
        self._validate_limit(max_export_bytes)
        operation = self.buyer.operation(intent_id)
        operation.inspect()
        file_options = dict(file_options or {})
        if set(file_options) - {"destination", "claim_env", "timeout_ms"}:
            raise StateError("ORIGINAL_FILE_OPTIONS_INVALID")
        if "destination" in file_options:
            file_options["destination"] = os.path.abspath(os.path.expanduser(os.fspath(file_options["destination"])))
        return self._register(run_id, {"kind": "operation", "intent_id": intent_id}, {
            "format": format, "allow_partial": allow_partial, "file_options": file_options,
            "max_export_bytes": max_export_bytes})

    def register_saved_stream(self, run_id, *, response_file, saved, source=None,
                              allow_partial=False, max_export_bytes=MAX_EXPORT_BYTES):
        if not isinstance(response_file, dict) or not isinstance(saved, dict) or type(allow_partial) is not bool:
            raise StateError("ORIGINAL_RESPONSE_FILE_REQUIRED")
        self._validate_limit(max_export_bytes)
        format = (response_file.get("stream") or saved.get("stream") or {}).get("format")
        if format not in ("sse", "ndjson"):
            raise StateError("ORIGINAL_STREAM_FORMAT_REQUIRED")
        return self._register(run_id, {"kind": "native-stream", "response_file": response_file,
            "saved": saved, "provenance": source}, {"format": format, "allow_partial": allow_partial,
            "file_options": {}, "max_export_bytes": max_export_bytes})

    @staticmethod
    def _validate_limit(value):
        if type(value) is not int or not 1 <= value <= 1024 * 1024 * 1024:
            raise StateError("AGENT_EXPORT_BYTE_LIMIT_INVALID")

    def _snapshot(self, run_id):
        snapshot = self.graph.get_state(self._config(run_id))
        pending = []
        for task in snapshot.tasks:
            for item in task.interrupts:
                pending.append({"id": item.id, "value": item.value})
        return snapshot, pending

    def inspect(self, run_id):
        record = self._record(run_id)
        snapshot, pending = self._snapshot(run_id)
        return {"schema": SCHEMA, "run_id": run_id, "source_kind": record["source"]["kind"],
                "intent_id": record["source"].get("intent_id"),
                **dict(snapshot.values), "status": snapshot.values.get("status", "REGISTERED"),
                "pending": pending, "next": list(snapshot.next),
                "checkpoint_id": snapshot.config.get("configurable", {}).get("checkpoint_id") if snapshot.config else None}

    def list_runs(self):
        for directory in sorted(self.runs.iterdir()):
            if directory.is_dir() and (directory / "run.json").is_file():
                record = parse(read(directory / "run.json", 4 * 1024 * 1024))
                yield self.inspect(record["run_id"])

    def start(self, run_id):
        self._record(run_id)
        with lock(self._directory(run_id)):
            snapshot, pending = self._snapshot(run_id)
            if not snapshot.values:
                self.graph.invoke({"run_id": run_id, "status": "ASSESSING"}, self._config(run_id), durability="sync")
            elif snapshot.next and not pending:
                self.graph.invoke(None, self._config(run_id), durability="sync")
        return self.inspect(run_id)

    def resume(self, run_id, *, action="recover", review_key=None):
        self._record(run_id)
        with lock(self._directory(run_id)):
            snapshot, pending = self._snapshot(run_id)
            if not pending:
                if action != "recover":
                    raise StateError("AGENT_RUN_HAS_NO_PENDING_DECISION")
                if snapshot.next:
                    self.graph.invoke(None, self._config(run_id), durability="sync")
            else:
                if len(pending) != 1:
                    raise StateError("AGENT_PENDING_DECISION_COUNT_INVALID")
                kind = pending[0]["value"]["kind"]
                allowed = {"execute", "cancel"} if kind == "original-review" else {"recover", "review", "cancel"}
                if action not in allowed:
                    raise StateError("AGENT_DECISION_INVALID")
                if action == "execute" and review_key != snapshot.values.get("review_key"):
                    raise StateError("ORIGINAL_REVIEW_SELECTION_CHANGED")
                self.graph.invoke(self.Command(resume={"action": action, "review_key": review_key}),
                                 self._config(run_id), durability="sync")
        return self.inspect(run_id)

    def _assess(self, state):
        record = self._record(state["run_id"])
        if record["source"]["kind"] == "native-stream":
            return {"status": "CONSUMING", "error": None}
        operation = self.buyer.operation(record["source"]["intent_id"])
        try:
            if record["options"]["format"] == "paid-file" and operation.recover_file() is not None:
                return {"status": "CONSUMING", "error": None}
            result = operation.recover()
            if result is not None:
                return {"status": "CONSUMING", "error": None}
            inspected = operation.inspect()
            if inspected["state"] != "PREPARED":
                return {"status": "RECOVERY_REQUIRED", "error": {"code": "ORIGINAL_ATTEMPT_RESULT_NOT_YET_RECORDED"},
                        "native": {"state": inspected["state"]}}
            review = operation.review()
            raw = _json(asdict(review))
            key = digest(raw)
            path = self._directory(state["run_id"]) / "reviews" / (key + ".json")
            if not path.exists():
                write(path, raw, exclusive=True)
            return {"status": "REVIEW_REQUIRED", "review_key": key,
                    "review": _review_summary(review), "error": None}
        except BuyerError as error:
            return {"status": "RECOVERY_REQUIRED", "error": _error(error)}

    def _decision(self, state):
        # This entire node restarts on resume. All native review/prepare work is
        # in the preceding checkpointed node; no effect occurs before interrupt.
        answer = self.interrupt({"kind": "original-review", "run_id": state["run_id"],
                                 "review_key": state["review_key"], "review": state["review"]})
        if answer["action"] == "cancel":
            return {"status": "CANCELLED", "action": "cancel"}
        if answer["action"] != "execute" or answer.get("review_key") != state["review_key"]:
            raise StateError("ORIGINAL_REVIEW_SELECTION_CHANGED")
        return {"status": "EXECUTING", "action": "execute"}

    def _execute(self, state):
        record = self._record(state["run_id"])
        operation = self.buyer.operation(record["source"]["intent_id"])
        try:
            # A node may restart after the native process finished but before
            # LangGraph checkpointed. Recover the same original result first.
            result = operation.recover()
            if result is None:
                inspected = operation.inspect()
                if inspected["state"] != "PREPARED":
                    return {"status": "RECOVERY_REQUIRED", "error": {"code": "ORIGINAL_ATTEMPT_RESULT_NOT_YET_RECORDED"}}
                raw = read(self._directory(state["run_id"]) / "reviews" / (state["review_key"] + ".json"), 4 * 1024 * 1024)
                if digest(raw) != state["review_key"]:
                    raise StateError("ORIGINAL_REVIEW_SNAPSHOT_CHANGED")
                result = operation.execute(review=Review(**parse(raw)))
            return {"status": "CONSUMING", "error": None}
        except BuyerError as error:
            return {"status": "RECOVERY_REQUIRED", "error": _error(error)}

    def _recovery(self, state):
        answer = self.interrupt({"kind": "original-recovery", "run_id": state["run_id"],
                                 "error": state.get("error"), "native": state.get("native"),
                                 "actions": ["recover", "review", "cancel"]})
        if answer["action"] not in ("recover", "review", "cancel"):
            raise StateError("AGENT_DECISION_INVALID")
        return {"status": "CANCELLED" if answer["action"] == "cancel" else "ASSESSING",
                "action": answer["action"]}

    def _artifact(self, run_id):
        directory = self._directory(run_id) / "artifact"
        value = parse(read(directory / "manifest.json", 4 * 1024 * 1024))
        if (value.get("schema") != ARTIFACT_SCHEMA or value.get("run_id") != run_id
                or value.get("run_sha256") != digest(_json(self._record(run_id)))):
            raise DeliveryError("AGENT_ARTIFACT_BINDING_CHANGED")
        return value

    def _consume(self, state):
        run_id = state["run_id"]
        record = self._record(run_id)
        directory = self._directory(run_id) / "artifact"
        try:
            if (directory / "manifest.json").exists():
                artifact = self._artifact(run_id)
            else:
                artifact = self._create_artifact(run_id, record)
            return {"status": "AVAILABLE", "error": None, "native": artifact["native"],
                    "artifact": {key: artifact[key] for key in ("format", "complete", "records", "generated_at")}}
        except (BuyerError, OSError) as error:
            return {"status": "RECOVERY_REQUIRED", "error": _error(error)}

    def _create_artifact(self, run_id, record):
        run_directory = self._directory(run_id)
        temporary = Path(tempfile.mkdtemp(prefix=".artifact-", dir=run_directory))
        destination = run_directory / "artifact"
        source, options = record["source"], record["options"]
        maximum = options["max_export_bytes"]
        files = []
        stream = None
        try:
            if source["kind"] == "native-stream":
                stream = export_saved_stream(checkout=self.buyer.runtime.checkout,
                    response_file=source["response_file"], saved=source["saved"],
                    cache_dir=run_directory / "native-stream", node=self.buyer.runtime.node,
                    timeout=self.buyer.runtime.timeout, allow_partial=options["allow_partial"],
                    max_export_bytes=maximum)
                native_record = {"source_kind": "SF31_RESPONSE_FILE", "responseFile": source["saved"],
                                 "source": source.get("provenance")}
                native = {"source_kind": "SF31_RESPONSE_FILE", "status": source["saved"].get("status"),
                          "error": source["saved"].get("error")}
                original = source["saved"]
                format = stream.format
                result = None
            else:
                operation = self.buyer.operation(source["intent_id"])
                format = options["format"]
                delivered_file = operation.recover_file() if format == "paid-file" else None
                result = operation.recover()
                if result is None and delivered_file is None:
                    raise StateError("ORIGINAL_ATTEMPT_RESULT_NOT_YET_RECORDED")
                native_record = result.record if result is not None else None
                native = {"source_kind": "ORIGINAL_BUYER_OPERATION" if result is not None else "ORIGINAL_FILE_DELIVERY",
                          "intent_id": operation.intent_id, "purchase_attempt_recorded": result is not None}
                if result is not None:
                    native.update(status=result.status, http_status=result.native.get("httpStatus"),
                                  returncode=result.record.get("returncode"),
                                  runtime_error=result.record.get("runtimeError"), ok=result.ok,
                                  configuration_sha256=result.record.get("configSha256"))
                if format == "paid-file":
                    result = delivered_file or operation.retrieve_file(resume=True, **options["file_options"])
                    native_record = {"purchase": native_record, "file_delivery": result.record}
                    native["file_delivery_status"] = result.status
                    native["file_http_requests"] = result.http_requests
                original = result.delivery
                if format == "auto":
                    content_type = (original.get("contentType") or "").split(";", 1)[0].strip().lower()
                    format = (original.get("stream") or {}).get("format") or (
                        "json" if content_type == "application/json" or content_type.endswith("+json") else
                        "csv" if content_type in ("text/csv", "application/csv") else "binary")
                if format in ("sse", "ndjson"):
                    stream = result.export_stream(format=format, allow_partial=options["allow_partial"],
                                                  max_export_bytes=maximum)
            dump(temporary / "native.json", native_record, exclusive=True)
            files.append(_file(temporary / "native.json", name="native.json", content_type="application/json"))
            count = None
            complete = original.get("status") == "SAVED"
            stream_manifest = None
            if stream is not None:
                # The native reader has validated full retained bytes, framing,
                # and the published prefix before the typed export is returned.
                stream_manifest = stream.manifest
                complete, count = stream.complete, stream.count
                files.append({"name": "records.jsonl", "path": str(stream.directory / "records.jsonl"),
                              "bytes": stream.manifest["file"]["bytes"], "sha256": stream.manifest["file"]["sha256"],
                              "content_type": "application/x-ndjson"})
                raw_source = stream.source
                files.append({"name": "response.bin", "path": raw_source["path"], "bytes": raw_source["bytes"],
                              "sha256": raw_source["sha256"], "content_type": raw_source.get("contentType")})
            else:
                with result.open():
                    pass
                files.append({"name": "response.bin", "path": original["path"], "bytes": original["bytes"],
                              "sha256": original["sha256"], "content_type": original.get("contentType")})
                if format == "json":
                    raw = _json(result.json(limit=min(result.max_bytes, maximum)))
                    if len(raw) > maximum:
                        raise DeliveryError("AGENT_EXPORT_BYTE_LIMIT_EXCEEDED")
                    write(temporary / "data.json", raw, exclusive=True)
                    files.append(_file(temporary / "data.json", name="data.json", content_type="application/json"))
                elif format == "csv":
                    count = 0
                    with (temporary / "records.jsonl").open("xb") as target:
                        os.chmod(target.name, 0o600)
                        total = 0
                        for index, row in enumerate(result.csv_rows()):
                            raw = _json({"index": index, "value": row})
                            total += len(raw)
                            if total > maximum:
                                raise DeliveryError("AGENT_EXPORT_BYTE_LIMIT_EXCEEDED")
                            target.write(raw)
                            count += 1
                        target.flush()
                        os.fsync(target.fileno())
                    files.append(_file(temporary / "records.jsonl", name="records.jsonl", content_type="application/x-ndjson"))
            for item in files:
                if Path(item["path"]).parent == temporary:
                    item["path"] = str(destination / Path(item["path"]).name)
            manifest = {"schema": ARTIFACT_SCHEMA, "run_id": run_id, "run_sha256": digest(_json(record)),
                        "format": format, "complete": complete, "records": count, "native": native,
                        "generated_at": _time(), "files": files, "stream_manifest": stream_manifest}
            dump(temporary / "manifest.json", manifest, exclusive=True)
            os.rename(temporary, destination)
            sync_directory(run_directory)
            return manifest
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)

    def read(self, run_id, *, offset=0, limit=20, pointer="", event_json=False):
        return _read_artifact(self._artifact(run_id), offset=offset, limit=limit,
                              pointer=pointer, event_json=event_json)

    def export(self, run_id, destination=None):
        artifact = self._artifact(run_id)
        identity = digest(_json(artifact))
        parent = private_directory(self._directory(run_id) / "deliveries")
        target = Path(os.path.abspath(os.path.expanduser(os.fspath(destination)))) if destination else parent / identity
        if target.exists():
            delivery = CustomerDelivery.open(target)
            saved = delivery.manifest
            if saved.get("artifact_sha256") != identity:
                raise StateError("AGENT_DELIVERY_DESTINATION_ALREADY_EXISTS")
            return {**saved, "manifest_sha256": delivery.manifest_sha256,
                    "directory": str(delivery.directory), "reused": True}
        private_directory(target.parent, create=False)
        temporary = Path(tempfile.mkdtemp(prefix=".delivery-", dir=target.parent))
        try:
            files = []
            for item in artifact["files"]:
                path = temporary / item["name"]
                with _open_file(item) as source:
                    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                    with os.fdopen(fd, "wb") as output:
                        shutil.copyfileobj(source, output, 65536)
                        output.flush()
                        os.fsync(output.fileno())
                files.append({key: value for key, value in item.items() if key != "path"})
            manifest = {"schema": "stellar-forge.agent-delivery.v1", "run_id": run_id,
                        "artifact_sha256": identity, "format": artifact["format"], "complete": artifact["complete"],
                        "records": artifact["records"], "native": artifact["native"], "files": files,
                        "stream_manifest": artifact["stream_manifest"], "source_manifest": artifact,
                        "generated_at": artifact["generated_at"]}
            dump(temporary / "delivery.json", manifest, exclusive=True)
            os.rename(temporary, target)
            sync_directory(target.parent)
            return {**manifest, "manifest_sha256": digest(read(target / "delivery.json", 4 * 1024 * 1024)),
                    "directory": str(target), "reused": False}
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)


class CustomerDelivery:
    """Portable retained data; reopening needs neither Node nor LangGraph.

    The optional expected manifest digest binds the exact package chosen by its
    sender. Source/record hashes detect changed files; they do not identify a
    trusted sender on their own. Original native status is retained separately
    from whether a response or its explicit complete-record prefix is readable.
    """

    def __init__(self, directory, manifest, manifest_sha256):
        self.directory = directory
        self.manifest = manifest
        self.manifest_sha256 = manifest_sha256
        self.artifact = {**manifest["source_manifest"], "files": [
            {**item, "path": str(directory / item["name"])} for item in manifest["files"]]}

    @classmethod
    def open(cls, directory, *, expected_manifest_sha256=None):
        root = private_directory(Path(directory), create=False)
        raw = read(root / "delivery.json", 4 * 1024 * 1024)
        fingerprint = digest(raw)
        if expected_manifest_sha256 is not None and fingerprint != expected_manifest_sha256:
            raise DeliveryError("AGENT_DELIVERY_MANIFEST_CHANGED")
        value = parse(raw)
        if not isinstance(value, dict):
            raise DeliveryError("AGENT_DELIVERY_MANIFEST_INVALID")
        source = value.get("source_manifest")
        if (value.get("schema") != "stellar-forge.agent-delivery.v1" or not isinstance(source, dict)
                or source.get("schema") != ARTIFACT_SCHEMA
                or digest(_json(source)) != value.get("artifact_sha256")
                or any(value.get(key) != source.get(key) for key in
                       ("run_id", "format", "complete", "records", "native", "stream_manifest", "generated_at"))):
            raise DeliveryError("AGENT_DELIVERY_MANIFEST_INVALID")
        files = value.get("files")
        originals = source.get("files")
        if (not isinstance(files, list) or not isinstance(originals, list)
                or not 2 <= len(files) <= 4 or len(files) != len(originals)):
            raise DeliveryError("AGENT_DELIVERY_MANIFEST_INVALID")
        seen = set()
        for item, original in zip(files, originals):
            if (not isinstance(item, dict) or not isinstance(original, dict)
                    or item != {key: val for key, val in original.items() if key != "path"}
                    or item.get("name") not in {"native.json", "response.bin", "records.jsonl", "data.json"}
                    or item["name"] in seen or type(item.get("bytes")) is not int or item["bytes"] < 0):
                raise DeliveryError("AGENT_DELIVERY_MANIFEST_INVALID")
            seen.add(item["name"])
            with _open_file({**item, "path": str(root / item["name"])}):
                pass
        required = {"native.json", "response.bin"}
        if value["format"] == "json":
            required.add("data.json")
        elif value["format"] in {"csv", "sse", "ndjson"}:
            required.add("records.jsonl")
        elif value["format"] not in {"binary", "paid-file"}:
            raise DeliveryError("AGENT_DELIVERY_MANIFEST_INVALID")
        if seen != required:
            raise DeliveryError("AGENT_DELIVERY_MANIFEST_INVALID")
        return cls(root, value, fingerprint)

    def read(self, *, offset=0, limit=20, pointer="", event_json=False):
        return _read_artifact(self.artifact, offset=offset, limit=limit,
                              pointer=pointer, event_json=event_json)

    def metadata(self):
        return {key: self.manifest[key] for key in
                ("schema", "run_id", "format", "complete", "records", "native", "artifact_sha256")}


def main(argv=None):
    """The installed CLI drives the same graph and portable data reader."""
    import argparse
    parser = argparse.ArgumentParser(description="Persistent customer workflow on the original Stellar Forge Buyer")
    parser.add_argument("--checkout", help="Original Stellar Forge checkout root")
    parser.add_argument("--state", help="Existing private Python Buyer state directory")
    parser.add_argument("--directory", help="Private graph/checkpoint directory; defaults to STATE/agents")
    parser.add_argument("--node", default="node")
    parser.add_argument("--timeout", type=int, default=360, help="Native parent process timeout in seconds")
    commands = parser.add_subparsers(dest="command", required=True)
    register = commands.add_parser("register", help="Bind an existing original intent to a stable customer run")
    register.add_argument("run_id")
    register.add_argument("intent_id")
    register.add_argument("--format", choices=sorted(FORMATS), default="auto")
    register.add_argument("--allow-partial", action="store_true")
    register.add_argument("--file-options", help="JSON with original destination/claim_env/timeout_ms options")
    attach = commands.add_parser("attach-stream", help="Register an actual retained native SF31 writer response")
    attach.add_argument("run_id")
    attach.add_argument("native_response", help="JSON containing writerOptions, responseFile and optional source")
    attach.add_argument("--allow-partial", action="store_true")
    for name in ("start", "inspect"):
        commands.add_parser(name).add_argument("run_id")
    commands.add_parser("list")
    resume = commands.add_parser("resume")
    resume.add_argument("run_id")
    resume.add_argument("--action", choices=("execute", "recover", "review", "cancel"), default="recover")
    resume.add_argument("--review-key")
    read_command = commands.add_parser("read")
    read_command.add_argument("run_id")
    delivery = commands.add_parser("read-delivery", help="Read an exported package without Node, Buyer or LangGraph")
    delivery.add_argument("delivery")
    delivery.add_argument("--manifest-sha256")
    for command in (read_command, delivery):
        command.add_argument("--offset", type=int, default=0)
        command.add_argument("--limit", type=int, default=20)
        command.add_argument("--pointer", default="")
        command.add_argument("--event-json", action="store_true")
    export = commands.add_parser("export")
    export.add_argument("run_id")
    export.add_argument("--destination")
    arguments = parser.parse_args(argv)
    try:
        if arguments.command == "read-delivery":
            customer = CustomerDelivery.open(arguments.delivery,
                expected_manifest_sha256=arguments.manifest_sha256)
            result = {"delivery": customer.metadata(), "manifest_sha256": customer.manifest_sha256,
                      "page": customer.read(offset=arguments.offset, limit=arguments.limit,
                                            pointer=arguments.pointer, event_json=arguments.event_json)}
        else:
            if not arguments.checkout or not arguments.state:
                parser.error("--checkout and --state are required for a customer graph")
            buyer = Buyer(checkout=arguments.checkout, state_dir=arguments.state,
                          node=arguments.node, timeout=arguments.timeout)
            with CustomerWorkflow(buyer, directory=arguments.directory) as workflow:
                command = arguments.command
                if command == "register":
                    options = parse(read(Path(arguments.file_options), 65536)) if arguments.file_options else None
                    result = workflow.register(arguments.run_id, intent_id=arguments.intent_id,
                        format=arguments.format, allow_partial=arguments.allow_partial, file_options=options)
                elif command == "attach-stream":
                    response = parse(read(Path(arguments.native_response), 4 * 1024 * 1024))
                    result = workflow.register_saved_stream(arguments.run_id,
                        response_file=response["writerOptions"], saved=response["responseFile"],
                        source=response.get("source"), allow_partial=arguments.allow_partial)
                elif command == "list":
                    result = {"runs": list(workflow.list_runs())}
                elif command == "resume":
                    result = workflow.resume(arguments.run_id, action=arguments.action,
                                             review_key=arguments.review_key)
                elif command == "read":
                    result = workflow.read(arguments.run_id, offset=arguments.offset, limit=arguments.limit,
                                           pointer=arguments.pointer, event_json=arguments.event_json)
                elif command == "export":
                    result = workflow.export(arguments.run_id, arguments.destination)
                else:
                    result = getattr(workflow, command)(arguments.run_id)
        print(json.dumps(result, ensure_ascii=True, allow_nan=False, indent=2))
        return 0
    except (BuyerError, OSError, KeyError) as error:
        print(json.dumps({"status": "ERROR", "error": _error(error)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

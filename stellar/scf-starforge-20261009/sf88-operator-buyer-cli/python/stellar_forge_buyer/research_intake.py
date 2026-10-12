"""Reviewed Research documents in the original Analysis workspace.

Only saved document and retained managed-output reads are available here.
The original Research client, source-document producer, response registration,
Analysis jobs and portable workspace exporter own their respective records.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime
from pathlib import Path
import re
import shutil
import threading

from .errors import BuyerError, StateError
from .research_workspace import ResearchWorkspace
from .research_documents import ResearchDocumentSource, ResearchSelection
from .response_documents import document_path, validate_manifest
from .storage import dump, parse, private_directory, read

SCHEMA = "stellar-forge.analysis-research-intake.v1"
CONFIG_SCHEMA = "stellar-forge.analysis-research-connections.v1"
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}")
_JOB = re.compile(r"[a-f0-9]{32}")
_HASH = re.compile(r"[a-f0-9]{64}")
_WORKSPACE = re.compile(r"research_[a-f0-9]{64}")
_DOSSIER = re.compile(r"d_[a-f0-9-]{36}")
_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})")
_MAX_RECORD = 1024 * 1024


def _need(condition, code):
    if not condition:
        raise StateError("ANALYSIS_RESEARCH_" + code)


def _fields(value, required, optional=()):
    _need(isinstance(value, dict) and set(required) <= set(value)
          and not set(value) - set(required) - set(optional), "FIELDS_INVALID")
    return value


def _string(value, pattern, code):
    _need(isinstance(value, str) and pattern.fullmatch(value), code)
    return value


def _text(value, maximum, code, *, empty=False):
    _need(isinstance(value, str) and len(value) <= maximum
          and (empty or value.strip()) and all(ord(char) >= 32 and ord(char) != 127 for char in value), code)
    return value


def _integer(value, minimum, maximum, code):
    _need(type(value) is int and minimum <= value <= maximum, code)
    return value


def _timestamp(value):
    _string(value, _TIME, "CAPTURE_TIME_INVALID")
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise StateError("ANALYSIS_RESEARCH_CAPTURE_TIME_INVALID") from None
    _need(stamp.tzinfo is not None, "CAPTURE_TIME_INVALID")
    return value


def _selection(family, value):
    _need(family in {"documents", "pipelines"} and isinstance(value, dict), "SELECTION_INVALID")
    keys = set(value)
    if keys == {"editionId"}:
        _string(value["editionId"], re.compile(r"e_[a-f0-9]{64}"), "EDITION_ID_INVALID")
    elif family == "documents" and keys == {"purchaseId"}:
        _string(value["purchaseId"], re.compile(r"u_[a-f0-9]{64}"), "PURCHASE_ID_INVALID")
    elif family == "pipelines" and keys == {"operationId", "outputId"}:
        _string(value["operationId"], re.compile(r"up_[a-f0-9]{64}"), "OPERATION_ID_INVALID")
        _string(value["outputId"], re.compile(r"out_[a-f0-9]{64}"), "OUTPUT_ID_INVALID")
    else:
        raise StateError("ANALYSIS_RESEARCH_ONE_SELECTION_REQUIRED")
    return deepcopy(value)


def read_connections(value):
    """Load launcher-selected aliases; private connection paths stay server-side."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        value = parse(read(Path(value).expanduser().absolute(), _MAX_RECORD))
    _fields(value, {"schema", "connections"})
    _need(value["schema"] == CONFIG_SCHEMA and isinstance(value["connections"], list)
          and len(value["connections"]) <= 64, "CONNECTION_CONFIGURATION_INVALID")
    result = {}
    for item in value["connections"]:
        _fields(item, {"name", "label", "connection_file", "expected_workspace_id"}, {"request_timeout_ms"})
        name = _string(item["name"], _NAME, "CONNECTION_NAME_INVALID")
        _need(name not in result, "CONNECTION_NAME_DUPLICATED")
        path = item["connection_file"]
        _need(isinstance(path, str) and Path(path).is_absolute(), "CONNECTION_FILE_ABSOLUTE_REQUIRED")
        result[name] = {
            "name": name,
            "label": _text(item["label"], 160, "CONNECTION_LABEL_INVALID"),
            "connection_file": str(Path(path).expanduser().absolute()),
            "workspace_id": _string(item["expected_workspace_id"], _WORKSPACE, "WORKSPACE_ID_INVALID"),
            "request_timeout_ms": _integer(item.get("request_timeout_ms", 120000), 1000, 900000,
                                           "REQUEST_TIMEOUT_INVALID"),
        }
    return result


class ResearchIntake:
    def __init__(self, workspace, *, connections=None):
        self.workspace = workspace
        self.database = workspace.database
        self.root = self.database.directory / "analysis-research"
        self.connections = read_connections(connections)
        self._condition = threading.Condition()
        self._active = {}
        self._job_events = {}
        self._cancelled = set()
        self._closed = False

    def configuration(self):
        return {
            "schema": SCHEMA, "configured": bool(self.connections),
            "can_capture": bool(self.connections) and self.workspace.checkout is not None,
            "connections": [{key: value[key] for key in ("name", "label", "workspace_id")}
                            for value in self.connections.values()],
        }

    def _profile(self, name, expected):
        _string(name, _NAME, "CONNECTION_NAME_INVALID")
        _string(expected, _WORKSPACE, "WORKSPACE_ID_INVALID")
        profile = self.connections.get(name)
        _need(profile is not None, "CONNECTION_NOT_CONFIGURED")
        _need(profile["workspace_id"] == expected, "WORKSPACE_CHANGED")
        _need(self.workspace.checkout is not None, "ORIGINAL_RUNTIME_REQUIRED")
        return profile

    @contextmanager
    def _owned(self, *, job_id=None):
        event, token = threading.Event(), object()
        with self._condition:
            _need(not self._closed, "CLOSED")
            if job_id in self._cancelled:
                event.set()
            if job_id is not None:
                _need(job_id not in self._job_events, "CAPTURE_ALREADY_RUNNING")
                self._job_events[job_id] = event
            self._active[token] = {"event": event, "client": None, "job_id": job_id}
        try:
            yield token, event
        finally:
            with self._condition:
                self._active.pop(token, None)
                if job_id is not None:
                    self._job_events.pop(job_id, None)
                self._condition.notify_all()

    def _check(self, event):
        if event.is_set():
            raise StateError("ANALYSIS_RESEARCH_CANCELLED")
        with self._condition:
            _need(not self._closed, "CANCELLED")

    @contextmanager
    def _client(self, name, expected, *, owned=None):
        if owned is None:
            with self._owned() as ownership:
                with self._client(name, expected, owned=ownership) as client:
                    yield client
            return
        token, event = owned
        self._check(event)
        profile = self._profile(name, expected)
        private_directory(self.root)
        clients = private_directory(self.root / "clients")
        directory = private_directory(clients / (name + "-" + expected.removeprefix("research_")))
        client = None
        try:
            client = ResearchWorkspace(
                checkout=self.workspace.checkout, connection_file=profile["connection_file"],
                directory=directory, node=self.workspace.node,
                expected_workspace_id=expected,
                request_timeout_ms=profile["request_timeout_ms"],
                timeout=max(360, profile["request_timeout_ms"] / 1000 + 30))
            with self._condition:
                _need(token in self._active, "CALL_OWNERSHIP_LOST")
                self._active[token]["client"] = client
            # close/cancel may have won while the original client was opening.
            self._check(event)
            yield client
            _need(client.workspace_id == expected, "WORKSPACE_CHANGED")
        finally:
            if client is not None:
                client.close()
            with self._condition:
                if token in self._active:
                    self._active[token]["client"] = None

    def close(self):
        """Drain complete local calls; the original Research service stays open."""
        with self._condition:
            self._closed = True
            for owned in self._active.values():
                owned["event"].set()
            clients = [owned["client"] for owned in self._active.values() if owned["client"] is not None]
        for client in clients:
            client.close()
        with self._condition:
            while self._active:
                self._condition.wait(0.5)

    @staticmethod
    def _common(body):
        return {
            "connection": _string(body.get("connection"), _NAME, "CONNECTION_NAME_INVALID"),
            "workspace_id": _string(body.get("expected_workspace_id"), _WORKSPACE, "WORKSPACE_ID_INVALID"),
        }

    @staticmethod
    def _pipeline_list(value):
        """Select existing job/output identities without launcher configuration."""
        operations = []
        for item in value.get("operations", []):
            plan, operation = item["plan"], item["operation"]
            request, profile = plan["payload"]["request"], plan["payload"]["profile"]
            operations.append({
                "plan": {"id": plan["id"], "sha256": plan["sha256"], "preparedAt": plan["preparedAt"],
                         "payload": {"request": {key: deepcopy(request.get(key)) for key in ("label", "context")},
                                     "profile": {key: deepcopy(profile.get(key)) for key in ("id", "label")},
                                     "inputs": deepcopy(plan["payload"]["inputs"])}},
                "operation": {key: deepcopy(operation.get(key)) for key in
                              ("id", "revision", "phase", "providerJobId", "providerStatus", "outputs",
                               "updatedAt", "jobObservedAt", "detailsObservedAt")},
            })
        return {
            "configured": value["configured"], "workspaceId": value.get("workspaceId"),
            "operations": operations,
            "editions": [{key: deepcopy(item.get(key)) for key in
                          ("id", "label", "questionId", "createdAt", "sha256", "bytes")}
                         for item in value.get("editions", [])],
            "nextAfter": value.get("nextAfter"), "revision": value["revision"],
        }

    def read(self, action, body):
        """Read original dossiers, saved selections and reviewed element pages."""
        common_fields = {"connection", "expected_workspace_id"}
        if action == "dossiers":
            _fields(body, common_fields, {"offset", "limit", "snapshot"})
        elif action == "sources":
            _fields(body, common_fields | {"dossier_id", "family"}, {"after", "limit"})
        elif action == "review":
            _fields(body, common_fields | {"dossier_id", "family", "selection"})
        elif action == "elements":
            _fields(body, common_fields | {"dossier_id", "family", "selection", "expected_edition_sha256"},
                    {"offset", "limit", "page", "type", "query"})
        else:
            raise StateError("ANALYSIS_RESEARCH_READ_INVALID")
        common = self._common(body)
        selection = None
        if action != "dossiers":
            _string(body["dossier_id"], _DOSSIER, "DOSSIER_ID_INVALID")
            _need(body["family"] in {"documents", "pipelines"}, "FAMILY_INVALID")
        if action in {"review", "elements"}:
            selection = _selection(body["family"], body["selection"])
        with self._client(common["connection"], common["workspace_id"]) as client:
            if action == "dossiers":
                options = {
                    "offset": _integer(body.get("offset", 0), 0, 2**53 - 1, "PAGE_INVALID"),
                    "limit": _integer(body.get("limit", 20), 1, 100, "PAGE_INVALID"),
                }
                if "snapshot" in body:
                    options["snapshot"] = _string(body["snapshot"], _HASH, "INVENTORY_SNAPSHOT_INVALID")
                _need(options["offset"] == 0 or "snapshot" in options, "INVENTORY_SNAPSHOT_REQUIRED")
                result = client.dossiers(**options)
            elif action == "sources":
                after = body.get("after", "")
                _need(isinstance(after, str), "CURSOR_INVALID")
                if after:
                    _string(after, re.compile(r"u_[a-f0-9]{64}" if body["family"] == "documents"
                                              else r"up_[a-f0-9]{64}"), "CURSOR_INVALID")
                owner = client.documents(body["dossier_id"]) if body["family"] == "documents" else client.pipelines(body["dossier_id"])
                result = owner.list(after=after, limit=_integer(body.get("limit", 20), 1, 100, "PAGE_INVALID"))
                if body["family"] == "pipelines":
                    result = self._pipeline_list(result)
            else:
                selected = ResearchSelection(client, body["dossier_id"], body["family"], selection)
                if action == "review":
                    result = selected.review()
                else:
                    result = selected.elements(
                        expected_edition_sha256=_string(body["expected_edition_sha256"], _HASH, "EDITION_DIGEST_REQUIRED"),
                        offset=_integer(body.get("offset", 0), 0, 2**53 - 1, "PAGE_INVALID"),
                        limit=_integer(body.get("limit", 25), 1, 100, "PAGE_INVALID"),
                        page=_text(body.get("page", ""), 100, "PAGE_FILTER_INVALID", empty=True),
                        type=_text(body.get("type", ""), 200, "TYPE_FILTER_INVALID", empty=True),
                        query=_text(body.get("query", ""), 2000, "TEXT_FILTER_INVALID", empty=True))
        return {**common, **({key: body[key] for key in ("dossier_id", "family")} if action != "dossiers" else {}),
                "result": result}

    def prepare(self, request):
        _fields(request, {"id", "connection", "expected_workspace_id", "dossier_id", "family", "selection",
                          "expected_edition_sha256", "name", "expected_revision", "title", "captured_at"})
        _string(request["id"], _JOB, "CAPTURE_ID_INVALID")
        _string(request["connection"], _NAME, "CONNECTION_NAME_INVALID")
        _string(request["expected_workspace_id"], _WORKSPACE, "WORKSPACE_ID_INVALID")
        _string(request["dossier_id"], _DOSSIER, "DOSSIER_ID_INVALID")
        selection = _selection(request["family"], request["selection"])
        return {
            "connection": request["connection"], "expected_workspace_id": request["expected_workspace_id"],
            "dossier_id": request["dossier_id"], "family": request["family"], "selection": selection,
            "expected_edition_sha256": _string(request["expected_edition_sha256"], _HASH, "EDITION_DIGEST_REQUIRED"),
            "name": _string(request["name"], _NAME, "SOURCE_NAME_INVALID"),
            "expected_revision": _integer(request["expected_revision"], 0, 2**53 - 1, "SOURCE_REVISION_INVALID"),
            "title": _text(request["title"], 160, "TITLE_INVALID"),
            "captured_at": _timestamp(request["captured_at"]),
        }

    @staticmethod
    def _matches(source, spec):
        identity = source.receipt.get("identity", {})
        return (identity.get("editionSha256") == spec["expected_edition_sha256"]
                and identity.get("provider") == ("unstructured" if spec["family"] == "documents" else "unstructured-pipelines")
                and identity.get("title") == spec["title"]
                and identity.get("capturedAt") == spec["captured_at"])

    def _registered(self, spec, db=None):
        if db is None:
            with self.database._connection(readonly=True) as connection:
                return self._registered(spec, connection)
        rows = db.execute("SELECT record FROM sf_analysis_response_sources WHERE name=? ORDER BY revision DESC",
                          (spec["name"],)).fetchall()
        for row in rows:
            registration = parse(row[0].encode())
            if registration.get("input_kind") != "document":
                continue
            path = document_path(self.database.directory, registration["document_id"])
            manifest = validate_manifest(parse(read(path, _MAX_RECORD)))
            if not any(record["role"] == "analysis-receipt" for record in manifest["originals"]):
                continue
            source = ResearchDocumentSource(path.parent)
            if self._matches(source, spec):
                return source, registration
        return None

    def _stage(self, job_id, *, create=False):
        _string(job_id, _JOB, "CAPTURE_ID_INVALID")
        if create:
            private_directory(self.root)
            private_directory(self.root / "captures")
            return private_directory(self.root / "captures" / job_id)
        return self.root / "captures" / job_id

    def validate(self, db, spec):
        if self._registered(spec, db) is not None:
            return
        row = db.execute("SELECT revision FROM sf_analysis_sources WHERE name=?", (spec["name"],)).fetchone()
        _need((row[0] if row else 0) == spec["expected_revision"], "SOURCE_CHANGED")
        stage = self._stage(spec["id"])
        if (stage / "source" / "source.json").is_file():
            source = ResearchDocumentSource(stage / "source")
            _need(self._matches(source, spec), "CAPTURE_SOURCE_CHANGED")
        else:
            self._profile(spec["connection"], spec["expected_workspace_id"])

    def _progress(self, job_id, phase, **values):
        path = self._stage(job_id, create=True) / "progress.json"
        from datetime import timezone
        dump(path, {"schema": SCHEMA, "id": job_id, "phase": phase,
                    "observed_at": datetime.now(timezone.utc).isoformat(), **values})

    def progress(self, job_id):
        path = self._stage(job_id) / "progress.json"
        if not path.is_file():
            return None
        value = parse(read(path, _MAX_RECORD))
        _need(value.get("schema") == SCHEMA and value.get("id") == job_id, "PROGRESS_CHANGED")
        return value

    def _result(self, spec, source, registration, verification):
        with self.database._connection(readonly=True) as db:
            current = db.execute("SELECT revision FROM sf_analysis_sources WHERE name=?", (spec["name"],)).fetchone()
        return {
            "schema": SCHEMA, "connection": spec["connection"], "workspace_id": spec["expected_workspace_id"],
            "dossier_id": spec["dossier_id"], "family": spec["family"], "selection": deepcopy(spec["selection"]),
            "edition_sha256": spec["expected_edition_sha256"], "document_id": source.document_id,
            "source": deepcopy(registration), "registration_current": current is not None and current[0] == registration["revision"],
            "mapping": source.mapping, "receipt": deepcopy(source.receipt), "verification": verification,
        }

    def run(self, job_id, spec):
        with self._owned(job_id=job_id) as ownership:
            _, event = ownership
            try:
                self._check(event)
                # A captured source lives in the original portable source closure.
                # Reconcile it before consulting this host's current connection.
                retained = self._registered(spec)
                if retained is not None:
                    source, registration = retained
                    verification = source.verify()
                    result = self._result(spec, source, registration, verification)
                    try:
                        self._progress(job_id, "COMPLETE", document_id=source.document_id, recovered_registration=True)
                    except OSError as error:
                        result["progress_error"] = type(error).__name__
                    return result
                stage = self._stage(job_id, create=True)
                source_directory = stage / "source"
                if (source_directory / "source.json").is_file():
                    source = ResearchDocumentSource(source_directory)
                    _need(self._matches(source, spec), "CAPTURE_SOURCE_CHANGED")
                else:
                    self._progress(job_id, "CAPTURING_EDITION")
                    with self._client(spec["connection"], spec["expected_workspace_id"], owned=ownership) as client:
                        selected = ResearchSelection(client, spec["dossier_id"], spec["family"], spec["selection"])
                        source = selected.analysis_source(
                            source_directory, expected_edition_sha256=spec["expected_edition_sha256"],
                            title=spec["title"], captured_at=spec["captured_at"])
                _need(self._matches(source, spec), "CAPTURE_SOURCE_CHANGED")
                self._check(event)
                self._progress(job_id, "VERIFYING_ORIGINALS", document_id=source.document_id)
                verification = source.verify()
                self._check(event)
                self._progress(job_id, "REGISTERING_SOURCE", document_id=source.document_id,
                               files=verification["files"], bytes=verification["bytes"])
                registration = source.register(self.workspace, spec["name"], expected_revision=spec["expected_revision"])
                # Registration is the authoritative completion. Cancellation after
                # this point cannot turn a retained successful source into a failure.
                result = self._result(spec, source, registration, verification)
                try:
                    if source_directory.is_dir():
                        shutil.rmtree(source_directory)
                except OSError as error:
                    result["source_cleanup_error"] = type(error).__name__
                try:
                    self._progress(job_id, "COMPLETE", document_id=source.document_id,
                                   source_revision=registration["revision"])
                except OSError as error:
                    result["progress_error"] = type(error).__name__
                return result
            except BaseException as error:
                code = getattr(error, "code", None) or type(error).__name__
                if event.is_set() and code != "ANALYSIS_RESEARCH_CANCELLED":
                    code = "ANALYSIS_RESEARCH_CANCELLED"
                    error = StateError(code)
                try:
                    self._progress(job_id, "CANCELLED" if code == "ANALYSIS_RESEARCH_CANCELLED" else "ATTENTION", error=code)
                except OSError:
                    pass
                raise error

    def resume(self, job_id):
        _string(job_id, _JOB, "CAPTURE_ID_INVALID")
        with self._condition:
            _need(not self._closed and job_id not in self._job_events, "CAPTURE_ALREADY_RUNNING")
            self._cancelled.discard(job_id)

    def cancel(self, job_id):
        job = self.workspace._job(job_id)
        _need(job["kind"] == "research-capture", "CAPTURE_REQUIRED")
        if job["status"] != "RUNNING":
            return job
        with self._condition:
            self._cancelled.add(job_id)
            event = self._job_events.get(job_id)
            if event is not None:
                event.set()
            clients = [entry["client"] for entry in self._active.values()
                       if entry["job_id"] == job_id and entry["client"] is not None]
        for client in clients:
            client.close()
        return self.workspace.job(job_id)

    def captures(self, *, before=None, limit=20):
        _integer(limit, 1, 100, "PAGE_INVALID")
        if before is not None:
            _integer(before, 1, 2**53 - 1, "PAGE_INVALID")
        with self.database._connection(readonly=True) as db:
            rows = db.execute(
                "SELECT sequence,id,kind,status,created_at,finished_at,error,request,result "
                "FROM sf_analysis_jobs WHERE kind='research-capture' AND (? IS NULL OR sequence<?) "
                "ORDER BY sequence DESC LIMIT ?", (before, before, limit + 1)).fetchall()
        captures = []
        for row in rows[:limit]:
            item = dict(row)
            item["request"] = parse(item["request"].encode())
            result = parse(item["result"].encode()) if item["result"] else None
            item["result"] = None if result is None else {
                key: deepcopy(result[key]) for key in
                ("document_id", "edition_sha256", "registration_current", "verification")}
            item["progress"] = self.progress(item["id"])
            captures.append(item)
        return {"captures": captures, "next_before": rows[limit - 1]["sequence"] if len(rows) > limit else None}

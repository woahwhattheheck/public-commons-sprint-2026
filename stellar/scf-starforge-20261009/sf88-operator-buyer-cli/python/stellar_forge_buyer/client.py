"""Python buyer applications use original SF88 discovery, review and execution."""
from __future__ import annotations

from dataclasses import dataclass
from contextlib import contextmanager
from datetime import datetime, timezone
import os
from pathlib import Path
import re
import shutil
import tempfile
import uuid

from .errors import DeliveryError, NativeError, StateError
from .result import AccountingResult, BuyerResult, FileDelivery
from .runtime import Runtime
from .storage import digest, dump, lock, parse, private_directory, read, sync_directory, write

SCHEMA = "stellar-forge.python-buyer.v1"
ACCOUNTING_SCHEMA = "stellar-forge.python-buyer-accounting.v1"


def now():
    return datetime.now(timezone.utc).isoformat()


def intent(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", value):
        raise StateError("STABLE_INTENT_ID_REQUIRED")
    return value


def file_json(path, limit=65536):
    value = parse(read(Path(path).expanduser().absolute(), limit))
    if not isinstance(value, dict):
        raise StateError("JSON_OBJECT_REQUIRED")
    return value


@dataclass(frozen=True)
class Review:
    intent_id: str
    config_sha256: str
    body_sha256: str
    native: dict
    workspace_directory: str | None = None
    handoff_sha256: str | None = None
    file_promise: dict | None = None
    operation_ticket_sha256: str | None = None


class Buyer:
    def __init__(self, *, checkout, state_dir, node="node", environment=None, timeout=360):
        self.runtime = Runtime(checkout, node=node, environment=environment, timeout=timeout)
        self.state_dir = private_directory(Path(state_dir))

    def operation(self, intent_id: str):
        return Operation(self, intent(intent_id))

    def _new(self, intent_id: str, *, workspace=None, handoff_sha256=None):
        op = self.operation(intent_id)
        try:
            op.directory.mkdir(mode=0o700)
        except FileExistsError:
            raise StateError("INTENT_ALREADY_EXISTS_USE_OPERATION", operation=op) from None
        sync_directory(self.state_dir)
        try:
            dump(op.directory / "operation.json", {"schema": SCHEMA, "intentId": intent_id,
                 "createdAt": now(), "runtimeCheckout": str(self.runtime.checkout),
                 **({"nativeWorkspace": workspace} if workspace else {}),
                 **({"handoffSha256": handoff_sha256} if handoff_sha256 else {})}, exclusive=True)
            if workspace is None:
                private_directory(op.directory / "evidence")
        except BaseException:
            shutil.rmtree(op.directory)
            raise
        return op

    def discover(self, catalog: dict, *, destination=None) -> dict:
        """Unsigned original catalog GET. Catalog options are validated by SF88."""
        with tempfile.TemporaryDirectory(prefix="catalog-", dir=self.state_dir) as directory:
            config = Path(directory) / "config.json"
            dump(config, {"catalog": catalog}, exclusive=True)
            result = self.runtime.checked(["--discover", "--config", config],
                                          mode="ORIGINAL_UNSIGNED_CATALOG")
            if destination is not None:
                dump(Path(destination).expanduser().absolute(), result, exclusive=True)
            return result

    def from_config(self, config_file, *, body: bytes | None = None):
        """Snapshot an existing private SF88 config and request body without a call."""
        config = file_json(config_file)
        op = self._new(intent(config.get("operation", {}).get("intentId")))
        with op._initializing():
            op._store_config(config, body=body)
        return op

    def _workspace(self, directory, intent_id=None):
        path = private_directory(Path(directory), create=False)
        native = self.runtime.checked(["workspace-read", "--dir", path],
            mode="ORIGINAL_PYTHON_WORKSPACE", target="application")
        config = native["configuration"]
        if intent_id is not None:
            config["operation"]["intentId"] = intent(intent_id)
        return native["directory"], config

    def from_workspace(self, directory, *, intent_id=None, body: bytes | None = None):
        """Snapshot the original validated workspace; its keys stay in Node."""
        workspace, config = self._workspace(directory, intent_id)
        op = self._new(intent(config["operation"]["intentId"]), workspace=workspace)
        with op._initializing():
            op._store_config(config, body=body)
        return op

    def from_paid_file(self, handoff_file, *, workspace, intent_id=None):
        """Prepare the exact original SF101 order against an existing workspace."""
        directory, config = self._workspace(workspace, intent_id)
        raw = read(Path(handoff_file).expanduser().absolute(), 131072)
        op = self._new(intent(config["operation"]["intentId"]),
                       workspace=directory, handoff_sha256=digest(raw))
        with op._initializing():
            write(op.directory / "file-handoff.json", raw, exclusive=True)
            with tempfile.TemporaryDirectory(prefix=".prepare-", dir=op.directory) as temporary:
                base = Path(temporary) / "workspace-source.json"
                prepared = Path(temporary) / "prepared-file.json"
                dump(base, config, exclusive=True)
                self.runtime.checked(["prepare-file", "--config", base,
                    "--handoff", op.directory / "file-handoff.json", "--out", prepared],
                    mode="ORIGINAL_PYTHON_PAID_FILE_PREPARED", target="application")
                op._store_config(file_json(prepared))
        return op

    def prepare(self, discovery_file, *, row: int, accept: int, intent_id: str,
                url: str, method="GET", body: bytes | None = None, headers=None):
        """Select exact saved source terms using original SF88 --prepare."""
        if type(row) is not int or row < 0 or type(accept) is not int or accept < 0:
            raise StateError("EXPLICIT_SELECTION_INDEX_REQUIRED")
        raw = read(Path(discovery_file).expanduser().absolute(), 1_048_576)
        op = self._new(intent(intent_id))
        with op._initializing():
            source = op.directory / "discovery.json"
            write(source, raw, exclusive=True)
            headers_file = op.directory / "request.headers.json"
            if headers is not None:
                dump(headers_file, dict(headers), exclusive=True)
            result = self.runtime.checked(["--prepare", "--discovery", source,
                "--row", row, "--accept", accept, "--intent-id", intent_id,
                "--url", url, "--method", method, "--out", op.config_path,
                *(["--headers-file", headers_file] if headers is not None else [])],
                mode="OFFLINE_CONFIG_PREPARED")
            dump(op.directory / "prepared.json", result, exclusive=True)
            config = file_json(op.config_path)
            op._store_config(config, body=body)
        return op

    def list_operations(self):
        for directory in sorted(self.state_dir.iterdir()):
            if directory.is_dir() and re.fullmatch(r"[0-9a-f]{64}", directory.name):
                meta = file_json(directory / "operation.json")
                yield self.operation(meta["intentId"])

    def history(self, *, destination=None):
        """Private purchase/accounting/product history from retained local files."""
        rows = []
        for directory in sorted(self.state_dir.iterdir()):
            if not re.fullmatch(r"[0-9a-f]{64}", directory.name):
                continue
            try:
                private_directory(directory, create=False)
                meta = file_json(directory / "operation.json")
                op = self.operation(meta["intentId"])
                if op.directory != directory:
                    raise StateError("OPERATION_ID_MISMATCH")
                rows.append(op.inspect())
            except (StateError, KeyError, TypeError):
                rows.append({"directory": str(directory), "state": "LOCAL_RECORD_UNAVAILABLE"})
        result = {"schema": "stellar-forge.python-buyer-history.v1", "generatedAt": now(),
                  "operations": rows, "source": "RETAINED_LOCAL_OPERATION_VIEWS"}
        if destination is not None:
            dump(Path(destination).expanduser().absolute(), result, exclusive=True)
        return result


class Operation:
    def __init__(self, buyer: Buyer, intent_id: str):
        self.buyer = buyer
        self.intent_id = intent_id
        self.directory = buyer.state_dir / digest(intent_id.encode())
        self.config_path = self.directory / "config.json"

    @contextmanager
    def _initializing(self):
        # Only the creating call uses this; no payment has been launched.
        with lock(self.directory):
            try:
                yield
            except BaseException:
                if not (self.directory / "attempt.json").exists():
                    shutil.rmtree(self.directory)
                    sync_directory(self.buyer.state_dir)
                raise

    def _check(self):
        private_directory(self.directory, create=False)
        meta = file_json(self.directory / "operation.json")
        if meta.get("schema") != SCHEMA or meta.get("intentId") != self.intent_id:
            raise StateError("OPERATION_ID_MISMATCH", operation=self)
        return meta

    def _context(self):
        meta = self._check()
        workspace = meta.get("nativeWorkspace")
        if workspace is not None and (not isinstance(workspace, str) or
                not Path(workspace).is_absolute()):
            raise StateError("ORIGINAL_WORKSPACE_PATH_INVALID", operation=self)
        handoff_sha = meta.get("handoffSha256")
        handoff = None
        if handoff_sha is not None:
            raw = read(self.directory / "file-handoff.json", 131072)
            if not isinstance(handoff_sha, str) or digest(raw) != handoff_sha:
                raise StateError("PAID_FILE_HANDOFF_CHANGED", operation=self)
            handoff = parse(raw)
            if not isinstance(handoff, dict):
                raise StateError("PAID_FILE_HANDOFF_INVALID", operation=self)
            operation = file_json(self.config_path).get("operation", {})
            if (operation.get("orderReference") != handoff.get("orderReference") or
                    operation.get("url") != handoff.get("purchaseUrl") or operation.get("method") != "GET"):
                raise StateError("PAID_FILE_OPERATION_CHANGED", operation=self)
        return workspace, handoff_sha, handoff

    def _unattempted(self):
        self._check()
        if (self.directory / "attempt.json").exists():
            raise StateError("ATTEMPT_ALREADY_RECORDED_USE_RECOVER", operation=self)

    def _store_config(self, config: dict, *, body=None):
        self._unattempted()
        request = config.get("operation")
        if not isinstance(request, dict) or request.get("intentId") != self.intent_id:
            raise StateError("OPERATION_ID_MISMATCH", operation=self)
        if body is not None and not isinstance(body, bytes):
            raise StateError("BODY_BYTES_REQUIRED")
        if body is None and request.get("bodyFile"):
            body = read(Path(request["bodyFile"]), 1_048_576)
        if body is not None:
            if len(body) > 1_048_576:
                raise StateError("REQUEST_BODY_LIMIT")
            path = self.directory / ("request." + digest(body) + ".body")
            try:
                write(path, body, exclusive=True)
            except FileExistsError:
                if read(path, 1_048_576) != body:
                    raise StateError("REQUEST_BODY_CHANGED") from None
            request["bodyFile"] = str(path)
        # Original workspace binds this directory to its ledger/operator. Keep
        # that native value; independent configurations retain the old behavior.
        if self._check().get("nativeWorkspace") is None:
            config["evidenceDir"] = str(self.directory / "evidence")
        config["captureBody"] = False
        config.setdefault("responseFile", {"destination": str(self.directory / "response.bin"),
                                           "maxBytes": 67_108_864, "timeoutMs": 30000})
        fd, name = tempfile.mkstemp(prefix=".config-", suffix=".json", dir=self.directory)
        os.close(fd)
        candidate = Path(name)
        try:
            dump(candidate, config)
            # Keep the old valid configuration if an update fails native review.
            self.buyer.runtime.checked(["--review", "--config", candidate], mode="OFFLINE_REVIEW")
            os.replace(candidate, self.config_path)
            sync_directory(self.directory)
        finally:
            candidate.unlink(missing_ok=True)

    def configure(self, operator_profile, *, body=None, headers=None,
                  max_response_bytes=None, response_timeout_ms=None):
        """Attach trusted original operator PATHS/settings; secrets stay in env."""
        profile = file_json(operator_profile) if isinstance(operator_profile, (str, os.PathLike)) else dict(operator_profile)
        allowed = {"operator", "signerModule", "trustedPayer", "bodyCaptureTimeoutMs"}
        if set(profile) - allowed:
            raise StateError("OPERATOR_PROFILE_FIELDS_INVALID")
        with lock(self.directory):
            self._unattempted()
            config = file_json(self.config_path)
            config.update(profile)
            if headers is not None:
                config["operation"]["headers"] = dict(headers)
            if max_response_bytes is not None:
                config["responseFile"]["maxBytes"] = max_response_bytes
            if response_timeout_ms is not None:
                config["responseFile"]["timeoutMs"] = response_timeout_ms
            self._store_config(config, body=body)
        return self

    def _fingerprints(self):
        raw = read(self.config_path, 65536)
        config = parse(raw)
        path = config.get("operation", {}).get("bodyFile")
        body = read(Path(path), 1_048_576) if path else b""
        return digest(raw), digest(body)

    def review(self) -> Review:
        self._check()
        with lock(self.directory):
            config_sha, body_sha = self._fingerprints()
            workspace, handoff_sha, handoff = self._context()
            result = self.buyer.runtime.checked(["--review", "--config", self.config_path],
                                                mode="OFFLINE_REVIEW")
            if result.get("intentId") != self.intent_id or result.get("bodySha256") != body_sha:
                raise StateError("NATIVE_REVIEW_MISMATCH")
            promise = None if handoff is None else {
                "orderReference": handoff["orderReference"], "purchaseUrl": handoff["purchaseUrl"],
                "deliveryUrl": handoff["deliveryUrl"], "file": handoff["file"]}
            ticket_sha = (result.get("operationTicket") or {}).get("sha256")
            review = Review(self.intent_id, config_sha, body_sha, result, workspace, handoff_sha, promise, ticket_sha)
            dump(self.directory / "review.json", {"intentId": review.intent_id,
                "configSha256": config_sha, "bodySha256": body_sha, "native": result, "reviewedAt": now(),
                "nativeWorkspace": workspace, "handoffSha256": handoff_sha, "filePromise": promise,
                "operationTicketSha256": ticket_sha})
            return review

    def execute(self, *, review: Review) -> BuyerResult:
        """One original attempt. Existing SF62 terminal approval remains intact."""
        with lock(self.directory):
            self._unattempted()
            fingerprints = self._fingerprints()
            workspace, handoff_sha, _ = self._context()
            if (review.intent_id != self.intent_id or fingerprints !=
                    (review.config_sha256, review.body_sha256) or
                    (workspace, handoff_sha) != (review.workspace_directory, review.handoff_sha256)):
                raise StateError("REVIEW_CHANGED_REVIEW_AGAIN", operation=self)
            config = file_json(self.config_path)
            for field in ("operator", "signerModule", "evidenceDir"):
                if field not in config:
                    raise StateError("ORIGINAL_OPERATOR_CONFIGURATION_REQUIRED", operation=self)
            native_args = ["--execute", "--config", self.config_path]
            target = "buyer"
            if workspace is not None or review.operation_ticket_sha256 is not None:
                # Original prerequisites and exact binding run before the Python
                # permanent attempt, just as they do in the native inbox.
                try:
                    setup = ["workspace-check", "--dir", workspace] if workspace else ["config-check"]
                    ticket_args = ["--ticket-sha", review.operation_ticket_sha256 or "none"]
                    self.buyer.runtime.checked([*setup, "--config", self.config_path, *ticket_args],
                        mode="ORIGINAL_PYTHON_WORKSPACE_READY" if workspace else "ORIGINAL_PYTHON_CONFIG_READY",
                        target="application")
                except NativeError as error:
                    raise NativeError(error.code, returncode=error.returncode, operation=self) from None
                native_args = (["execute-workspace", "--dir", workspace] if workspace else ["execute-config"])
                native_args += ["--config", self.config_path, *ticket_args]
                target = "application"
            attempt = {"schema": SCHEMA, "intentId": self.intent_id, "state": "STARTING",
                       "createdAt": now(), "configSha256": fingerprints[0],
                       "bodySha256": fingerprints[1], "retry": "NO_AUTOMATIC_RETRY"}
            dump(self.directory / "attempt.json", attempt, exclusive=True)

            def started(pid):
                attempt.update(state="STARTED", pid=pid, startedAt=now())
                dump(self.directory / "attempt.json", attempt)

            try:
                run = self.buyer.runtime.run(native_args, logs=self.directory, started=started, target=target)
            except BaseException:
                attempt.update(state="INTERRUPTED_OR_START_FAILED", endedAt=now())
                dump(self.directory / "attempt.json", attempt)
                raise
            native = run.output
            if (not isinstance(native, dict) or native.get("mode") != "ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT"
                    or native.get("intentId") != self.intent_id):
                attempt.update(state="NATIVE_RESULT_UNAVAILABLE", returncode=run.returncode,
                               error=run.error or "NATIVE_RESULT_INVALID", endedAt=now())
                dump(self.directory / "attempt.json", attempt)
                raise NativeError(attempt["error"], returncode=run.returncode, operation=self)
            record = {"schema": SCHEMA, "intentId": self.intent_id, "recordedAt": now(),
                      "configSha256": fingerprints[0], "returncode": run.returncode,
                      "runtimeError": run.error, "native": native, "recovered": False}
            dump(self.directory / "result.json", record, exclusive=True)
            attempt.update(state="RECORDED", returncode=run.returncode, endedAt=now())
            dump(self.directory / "attempt.json", attempt)
            return self._result(record)

    def _result(self, record):
        config = file_json(self.config_path)
        if record.get("intentId") != self.intent_id or record.get("configSha256") != digest(read(self.config_path, 65536)):
            raise StateError("RESULT_CONFIG_MISMATCH", operation=self)
        output = config.get("responseFile") or {}
        return BuyerResult(record, Path(output["destination"]) if output.get("destination") else None,
                           output.get("maxBytes", 67_108_864))

    def recover(self) -> BuyerResult | None:
        """Read recorded output; never spawn a buyer or repeat an attempted call."""
        self._check()
        result = self.directory / "result.json"
        if result.exists():
            return self._result(file_json(result, self.buyer.runtime.output_limit))
        if not (self.directory / "attempt.json").exists():
            return None
        attempt = file_json(self.directory / "attempt.json")
        stdout = self.directory / "stdout.json"
        if not stdout.exists():
            return None
        try:
            native = file_json(stdout, self.buyer.runtime.output_limit)
        except StateError:
            return None
        if native.get("mode") != "ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT" or native.get("intentId") != self.intent_id:
            return None
        # No exit code was durably recorded: preserve that uncertainty even if
        # a complete saved data file can be recovered and consumed immediately.
        record = {"schema": SCHEMA, "intentId": self.intent_id, "recordedAt": now(),
                  "configSha256": attempt["configSha256"], "returncode": None,
                  "runtimeError": "PROCESS_EXIT_NOT_RECORDED", "native": native, "recovered": True}
        return self._result(record)

    def _accounting_context(self):
        meta = self._check()
        workspace = meta.get("nativeWorkspace")
        if not isinstance(workspace, str) or not Path(workspace).is_absolute():
            raise StateError("ORIGINAL_ACCOUNTING_WORKSPACE_REQUIRED", operation=self)
        if not (self.directory / "attempt.json").exists():
            raise StateError("ORIGINAL_ACCOUNTING_ATTEMPT_REQUIRED", operation=self)
        attempt = file_json(self.directory / "attempt.json")
        config_sha, body_sha = self._fingerprints()
        if (attempt.get("schema") != SCHEMA or attempt.get("intentId") != self.intent_id or
                (attempt.get("configSha256"), attempt.get("bodySha256")) != (config_sha, body_sha) or
                not isinstance(attempt.get("createdAt"), str)):
            raise StateError("ORIGINAL_ACCOUNTING_ATTEMPT_CHANGED", operation=self)
        return attempt, config_sha

    def _accounting_result(self, record, attempt, config_sha):
        if (record.get("schema") != ACCOUNTING_SCHEMA or record.get("intentId") != self.intent_id or
                record.get("configSha256") != config_sha or
                record.get("attemptCreatedAt") != attempt["createdAt"]):
            raise StateError("ORIGINAL_ACCOUNTING_VIEW_MISMATCH", operation=self)
        native = record.get("native")
        if native is not None:
            if (not isinstance(native, dict) or native.get("mode") != "ORIGINAL_PYTHON_FINALIZATION" or
                    native.get("intentId") != self.intent_id or native.get("configSha256") != config_sha or
                    not isinstance(native.get("result"), dict) or native["result"].get("outcome") not in
                    ("FINALIZED", "IDEMPOTENT_FINALIZED", "NOT_FINALIZED", "WORKER_ERROR")):
                raise StateError("ORIGINAL_ACCOUNTING_RESULT_MISMATCH", operation=self)
            original = native["result"]
            if original["outcome"] in ("FINALIZED", "IDEMPOTENT_FINALIZED") and (
                    original.get("request_id") != self.intent_id or
                    original.get("request_sha256") != native.get("approvedRequestSha256")):
                raise StateError("ORIGINAL_ACCOUNTING_RESULT_MISMATCH", operation=self)
        return AccountingResult(record)

    def _saved_accounting(self, attempt, config_sha):
        path = self.directory / "accounting.json"
        if not path.exists():
            return None
        return self._accounting_result(file_json(path, self.buyer.runtime.output_limit), attempt, config_sha)

    def finalize(self, *, outbox=None, merchant_route=None) -> AccountingResult:
        """Finalize the SAME original reservation; never sign or repeat a purchase."""
        if bool(outbox) != bool(merchant_route):
            raise StateError("OUTBOX_AND_ORIGINAL_MERCHANT_ROUTE_REQUIRED_TOGETHER", operation=self)
        with lock(self.directory):
            attempt, config_sha = self._accounting_context()
            try:
                previous = self._saved_accounting(attempt, config_sha)
            except StateError:
                # A damaged display record must not prevent the original ledger
                # from rebuilding its own result on an explicit accounting run.
                previous = None
            runs = private_directory(self.directory / "accounting-runs")
            run_dir = private_directory(runs / uuid.uuid4().hex)
            record = {"schema": ACCOUNTING_SCHEMA, "intentId": self.intent_id,
                      "configSha256": config_sha, "attemptCreatedAt": attempt["createdAt"],
                      "recordedAt": now(), "runDirectory": str(run_dir),
                      "native": None, "returncode": None, "runtimeError": "PROCESS_RESULT_NOT_RECORDED"}
            if previous is not None and previous.last_finalized:
                record["lastFinalized"] = previous.last_finalized
            dump(run_dir / "context.json", record, exclusive=True)
            args = ["finalize-operation", "--operation-dir", self.directory]
            if outbox:
                args += ["--outbox", Path(outbox).expanduser().absolute(), "--merchant-route", merchant_route]
            try:
                run = self.buyer.runtime.run(args, target="application", logs=run_dir)
                record.update(returncode=run.returncode, runtimeError=run.error, recordedAt=now())
                candidate = {**record, "native": run.output}
                try:
                    result = self._accounting_result(candidate, attempt, config_sha)
                    if run.output is not None:
                        record = candidate
                    if result.finalized:
                        record["lastFinalized"] = {"recordedAt": record["recordedAt"], "native": run.output}
                except StateError:
                    record["runtimeError"] = "ORIGINAL_ACCOUNTING_RESULT_MISMATCH"
            except NativeError as error:
                record.update(runtimeError=error.code, returncode=error.returncode, recordedAt=now())
            # A successful ledger result survives failure to save this local view.
            # Its original workspace report and ledger can rebuild it on rerun.
            record["viewStatus"] = "SAVED"
            try:
                dump(run_dir / "result.json", record)
                dump(self.directory / "accounting.json", record)
            except OSError:
                record["viewStatus"] = "SAVE_FAILED"
            return self._accounting_result(record, attempt, config_sha)

    def recover_finalization(self) -> AccountingResult | None:
        """Read original accounting views locally; never start a process or RPC."""
        self._check()
        if not (self.directory / "attempt.json").exists():
            return None
        with lock(self.directory):
            attempt, config_sha = self._accounting_context()
            saved = self._saved_accounting(attempt, config_sha)
            runs = self.directory / "accounting-runs"
            if not runs.exists():
                return saved
            # Recover output left by a completed native command if its parent
            # stopped before saving accounting.json. No new finality is inferred.
            candidates = [saved] if saved else []
            for directory in runs.iterdir():
                if not re.fullmatch(r"[0-9a-f]{32}", directory.name):
                    continue
                try:
                    context = file_json(directory / "context.json")
                    path = directory / "result.json"
                    if path.exists():
                        record = file_json(path, self.buyer.runtime.output_limit)
                    else:
                        native = file_json(directory / "stdout.json", self.buyer.runtime.output_limit)
                        record = {**context, "native": native, "viewStatus": "RECOVERED_NATIVE_OUTPUT",
                                  "runtimeError": "PROCESS_EXIT_NOT_RECORDED", "recovered": True}
                    candidate = self._accounting_result(record, attempt, config_sha)
                    if candidate.native:
                        candidates.append(candidate)
                except StateError:
                    continue
            if not candidates:
                return None
            latest = max(candidates, key=lambda result: result.record.get("recordedAt", ""))
            earlier = [result for result in candidates if result.finalized]
            if earlier and not latest.last_finalized:
                prior = max(earlier, key=lambda result: result.record.get("recordedAt", ""))
                latest = AccountingResult({**latest.record, "lastFinalized": {
                    "recordedAt": prior.record["recordedAt"], "native": prior.native}})
            return latest

    def _file_result(self, record, handoff_sha, handoff):
        native = record.get("native") or {}
        saved = native.get("file") or {}
        if (record.get("intentId") != self.intent_id or record.get("handoffSha256") != handoff_sha or
                native.get("mode") != "ORIGINAL_PYTHON_FILE_DELIVERY" or
                native.get("status") not in ("APPROVED_FILE_SAVED", "EXISTING_LOCAL_BYTES_MATCH") or
                native.get("orderReference") != handoff["orderReference"] or
                saved.get("path") != record.get("destination") or
                saved.get("sha256") != handoff["file"]["sha256"] or
                saved.get("bytes") != handoff["file"]["bytes"]):
            raise StateError("PAID_FILE_RESULT_MISMATCH", operation=self)
        return FileDelivery(record, Path(saved["path"]), handoff["file"]["bytes"])

    def retrieve_file(self, *, destination=None, claim_env="SF101_CLAIM_TOKEN") -> FileDelivery:
        """One explicit original entitlement GET; never starts a payment."""
        self._check()
        if not isinstance(claim_env, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{1,64}", claim_env):
            raise StateError("CLAIM_ENV_NAME_INVALID", operation=self)
        with lock(self.directory):
            _, handoff_sha, handoff = self._context()
            if handoff is None:
                raise StateError("PAID_FILE_HANDOFF_REQUIRED", operation=self)
            path = self.directory / "file-delivery.json"
            old = file_json(path) if path.exists() else None
            target = Path(destination).expanduser().absolute() if destination is not None else (
                Path(old["destination"]) if old else self.directory / "product.bin")
            if old and old.get("destination") != str(target):
                raise StateError("FILE_DESTINATION_ALREADY_SELECTED_USE_SAVE_AS", operation=self)
            # Node reads the named private value only for an actual HTTP GET.
            # Matching original local bytes recover without any credential.
            run = self.buyer.runtime.run(["retrieve-file", "--handoff", self.directory / "file-handoff.json",
                "--out", target, "--claim-env", claim_env], target="application")
            record = {"schema": "stellar-forge.python-file-delivery.v1", "intentId": self.intent_id,
                "handoffSha256": handoff_sha, "destination": str(target), "recordedAt": now(),
                "returncode": run.returncode, "runtimeError": run.error, "native": run.output}
            dump(path, record)
            if (run.returncode or run.error or not isinstance(run.output, dict) or
                    run.output.get("status") not in ("APPROVED_FILE_SAVED", "EXISTING_LOCAL_BYTES_MATCH")):
                code = run.error or (run.output or {}).get("error") or "ORIGINAL_FILE_DELIVERY_FAILED"
                if not isinstance(code, str) or not re.fullmatch(r"[A-Z0-9_]{1,120}", code):
                    code = "ORIGINAL_FILE_DELIVERY_FAILED"
                raise DeliveryError(code, operation=self)
            return self._file_result(record, handoff_sha, handoff)

    def recover_file(self) -> FileDelivery | None:
        """Consume a retained product locally, without starting Node or HTTP."""
        self._check()
        with lock(self.directory):
            _, handoff_sha, handoff = self._context()
            path = self.directory / "file-delivery.json"
            if handoff is None or not path.exists():
                return None
            record = file_json(path)
            if ((record.get("native") or {}).get("status") not in
                    ("APPROVED_FILE_SAVED", "EXISTING_LOCAL_BYTES_MATCH")):
                return None
            return self._file_result(record, handoff_sha, handoff)

    def inspect(self) -> dict:
        meta = self._check()
        record = {"intentId": self.intent_id, "directory": str(self.directory), "state": "PREPARED"}
        config = file_json(self.config_path)
        original = config.get("operation") or {}
        record["request"] = {key: original.get(key) for key in ("url", "method", "expect", "orderReference")}
        if meta.get("nativeWorkspace"):
            record["nativeWorkspace"] = meta["nativeWorkspace"]
        if meta.get("handoffSha256"):
            record["handoffSha256"] = meta["handoffSha256"]
            _, _, handoff = self._context()
            record["filePromise"] = {"orderReference": handoff["orderReference"], "file": handoff["file"]}
            delivery = self.directory / "file-delivery.json"
            if delivery.exists():
                file_record = file_json(delivery)
                record["fileDelivery"] = {"destination": file_record["destination"],
                    "returncode": file_record.get("returncode"), "runtimeError": file_record.get("runtimeError"),
                    "native": file_record.get("native")}
        attempt = self.directory / "attempt.json"
        if attempt.exists():
            record.update(file_json(attempt))
        saved = self.recover()
        if saved:
            record["nativeStatus"] = saved.status
            record["deliveryStatus"] = saved.delivery.get("status")
            record["resultRecoverable"] = True
        if meta.get("nativeWorkspace") and attempt.exists():
            accounting = self.recover_finalization()
            if accounting:
                record["accounting"] = accounting.record
        return record

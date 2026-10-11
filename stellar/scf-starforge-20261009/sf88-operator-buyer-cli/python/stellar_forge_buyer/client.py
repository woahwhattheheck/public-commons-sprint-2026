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

from .errors import NativeError, StateError
from .result import BuyerResult
from .runtime import Runtime
from .storage import digest, dump, lock, parse, private_directory, read, sync_directory, write

SCHEMA = "stellar-forge.python-buyer.v1"


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


class Buyer:
    def __init__(self, *, checkout, state_dir, node="node", environment=None, timeout=360):
        self.runtime = Runtime(checkout, node=node, environment=environment, timeout=timeout)
        self.state_dir = private_directory(Path(state_dir))

    def operation(self, intent_id: str):
        return Operation(self, intent(intent_id))

    def _new(self, intent_id: str):
        op = self.operation(intent_id)
        try:
            op.directory.mkdir(mode=0o700)
        except FileExistsError:
            raise StateError("INTENT_ALREADY_EXISTS_USE_OPERATION", operation=op) from None
        sync_directory(self.state_dir)
        try:
            dump(op.directory / "operation.json", {"schema": SCHEMA, "intentId": intent_id,
                 "createdAt": now(), "runtimeCheckout": str(self.runtime.checkout)}, exclusive=True)
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
            result = self.runtime.checked(["--prepare", "--discovery", source,
                "--row", row, "--accept", accept, "--intent-id", intent_id,
                "--url", url, "--method", method, "--out", op.config_path],
                mode="OFFLINE_CONFIG_PREPARED")
            dump(op.directory / "prepared.json", result, exclusive=True)
            config = file_json(op.config_path)
            if headers is not None:
                config["operation"]["headers"] = dict(headers)
            op._store_config(config, body=body)
        return op

    def list_operations(self):
        for directory in sorted(self.state_dir.iterdir()):
            if directory.is_dir() and re.fullmatch(r"[0-9a-f]{64}", directory.name):
                meta = file_json(directory / "operation.json")
                yield self.operation(meta["intentId"])


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
            result = self.buyer.runtime.checked(["--review", "--config", self.config_path],
                                                mode="OFFLINE_REVIEW")
            if result.get("intentId") != self.intent_id or result.get("bodySha256") != body_sha:
                raise StateError("NATIVE_REVIEW_MISMATCH")
            review = Review(self.intent_id, config_sha, body_sha, result)
            dump(self.directory / "review.json", {"intentId": review.intent_id,
                "configSha256": config_sha, "bodySha256": body_sha, "native": result, "reviewedAt": now()})
            return review

    def execute(self, *, review: Review) -> BuyerResult:
        """One original attempt. Existing SF62 terminal approval remains intact."""
        with lock(self.directory):
            self._unattempted()
            fingerprints = self._fingerprints()
            if (review.intent_id != self.intent_id or fingerprints !=
                    (review.config_sha256, review.body_sha256)):
                raise StateError("REVIEW_CHANGED_REVIEW_AGAIN", operation=self)
            config = file_json(self.config_path)
            for field in ("operator", "signerModule", "evidenceDir"):
                if field not in config:
                    raise StateError("ORIGINAL_OPERATOR_CONFIGURATION_REQUIRED", operation=self)
            attempt = {"schema": SCHEMA, "intentId": self.intent_id, "state": "STARTING",
                       "createdAt": now(), "configSha256": fingerprints[0],
                       "bodySha256": fingerprints[1], "retry": "NO_AUTOMATIC_RETRY"}
            dump(self.directory / "attempt.json", attempt, exclusive=True)

            def started(pid):
                attempt.update(state="STARTED", pid=pid, startedAt=now())
                dump(self.directory / "attempt.json", attempt)

            try:
                run = self.buyer.runtime.run(["--execute", "--config", self.config_path],
                                             logs=self.directory, started=started)
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

    def inspect(self) -> dict:
        self._check()
        record = {"intentId": self.intent_id, "directory": str(self.directory), "state": "PREPARED"}
        attempt = self.directory / "attempt.json"
        if attempt.exists():
            record.update(file_json(attempt))
        saved = self.recover()
        if saved:
            record["nativeStatus"] = saved.status
            record["deliveryStatus"] = saved.delivery.get("status")
            record["resultRecoverable"] = True
        return record

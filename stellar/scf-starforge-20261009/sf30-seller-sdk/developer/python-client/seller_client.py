"""Python application adapter for the original generated Starforge seller client.

Request construction delegates to seller-client.mjs. Preparation, review,
execution, receipts and recovery belong to the original stellar_forge_buyer.
Importing this module performs no I/O and starts no process.
"""
from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import stat
import subprocess
import tempfile
from typing import Any, Mapping

MAX_BODY = 16 * 1024 * 1024
MAX_INPUT = 64 * 1024 * 1024
SCHEMA = "stellar-forge.python-seller-request.v1"
PACKAGE_SCHEMA = "stellar-forge.python-seller-client.v1"
LINEAGE = "seller-client-source.json"
ORIGINAL_FILES = ("seller-client.mjs", "seller-client.d.mts", "seller-openapi.json", "package.json", "README.md")
PYTHON_FILES = ("seller_client.py", "seller_client.pyi", "seller-client-bridge.mjs", "seller-contract.json", "PYTHON.md")


class SellerClientError(ValueError):
    """A local source, request, or recovery mismatch; never a payment retry."""


def _sha(raw: bytes) -> str:
    return sha256(raw).hexdigest()


def _json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":")) + "\n").encode("ascii")


def _parse(raw: bytes) -> Any:
    def duplicate(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise SellerClientError("Duplicate JSON key")
            result[key] = value
        return result
    def constant(value):
        raise SellerClientError("Non-finite JSON number")
    return json.loads(raw.decode("utf-8"), object_pairs_hook=duplicate, parse_constant=constant)


def _read(path: Path, limit=MAX_INPUT) -> bytes:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise SellerClientError("Expected a complete regular file within the documented size limit")
        raw = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
        if len(raw) != before.st_size or len(raw) > limit or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise SellerClientError("Retained file changed while reading")
        return raw


def _directory(path: Path) -> Path:
    path = path.expanduser().absolute()
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode):
        raise SellerClientError("Select a real directory, not a symbolic link")
    return path


def _sync(path: Path):
    if os.name == "nt":
        return
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _write_once(path: Path, raw: bytes):
    """Recover exact interrupted output; never overwrite a different saved file."""
    fd, temporary = tempfile.mkstemp(prefix=".seller-client-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
            _sync(path.parent)
        except FileExistsError:
            if _read(path, max(MAX_INPUT, len(raw))) != raw:
                raise SellerClientError("Saved destination contains different source or request bytes") from None
    finally:
        Path(temporary).unlink(missing_ok=True)


def _values(value: Any):
    """Reject Python values that JSON/JavaScript would silently coerce or round."""
    active = set()
    count = 0
    def visit(item, depth):
        nonlocal count
        count += 1
        if depth > 64 or count > 200000:
            raise SellerClientError("Request JSON is too complex")
        if item is None or type(item) in (str, bool):
            return
        if type(item) is int:
            if abs(item) > 9007199254740991:
                raise SellerClientError("JSON integer is not exactly representable by the original JavaScript request builder; use the API's declared string representation")
            return
        if type(item) is float:
            if not math.isfinite(item):
                raise SellerClientError("Request numbers must be finite")
            return
        if type(item) not in (dict, list) or id(item) in active:
            raise SellerClientError("Use ordinary acyclic JSON records and lists")
        active.add(id(item))
        if isinstance(item, dict):
            if any(type(key) is not str for key in item):
                raise SellerClientError("JSON object keys must be strings")
            for child in item.values():
                visit(child, depth + 1)
        else:
            for child in item:
                visit(child, depth + 1)
        active.remove(id(item))
    visit(value, 0)


@dataclass(frozen=True)
class BoundRequest:
    """Immutable exact native request plus its source-building inputs."""
    _input: bytes
    _record: bytes
    body: bytes | None

    @property
    def source_sha256(self) -> str:
        return _parse(self._record)["sourceSha256"]

    @property
    def operation_id(self) -> str:
        return _parse(self._record)["operationId"]

    @property
    def intent_id(self) -> str:
        return _parse(self._record)["request"]["intentId"]

    def describe(self) -> dict:
        """Fresh metadata copy; complete payload bytes stay in body."""
        return _parse(self._record)

    def configuration(self) -> dict:
        return {"operation": self.describe()["request"], "captureBody": False}

    def save(self, directory) -> Path:
        """Save a private portable request; repeat only completes identical bytes."""
        path = Path(directory).expanduser().absolute()
        try:
            path.mkdir(mode=0o700)
            _sync(path.parent)
        except FileExistsError:
            _directory(path)
        payloads = [("request-input.json", self._input), ("request.json", self._record)]
        if self.body is not None:
            payloads.append(("request.body", self.body))
        for name, raw in payloads:
            _write_once(path / name, raw)
        manifest = {"schema": "stellar-forge.python-seller-request-plan.v1", "sourceSha256": self.source_sha256,
                    "files": [{"name": name, "bytes": len(raw), "sha256": _sha(raw)} for name, raw in payloads]}
        _write_once(path / "request-plan.json", _json(manifest))
        return path


class SellerClient:
    def __init__(self, directory=None, *, node="node", timeout=60, environment: Mapping[str, str] | None = None):
        self.directory = _directory(Path(directory) if directory is not None else Path(__file__).parent)
        if not isinstance(node, (str, os.PathLike)) or not str(node):
            raise SellerClientError("Select the existing Node executable")
        if type(timeout) not in (int, float) or not math.isfinite(timeout) or timeout <= 0:
            raise SellerClientError("Use a positive native request timeout")
        self.node, self.timeout = str(node), timeout
        self.environment = None if environment is None else dict(environment)
        self._manifest_bytes = _read(self.directory / "python-client.json", 131072)
        self._manifest = _parse(self._manifest_bytes)
        self._verify_package()
        self._snapshot = _parse(_read(self.directory / "seller-contract.json", MAX_INPUT))
        if self._snapshot.get("sourceSha256") != self._manifest["sourceSha256"]:
            raise SellerClientError("Original seller contract differs from its export")

    def _verify_package(self):
        if _read(self.directory / "python-client.json", 131072) != self._manifest_bytes:
            raise SellerClientError("Reopen the client after deliberately replacing its source package")
        manifest = self._manifest
        if not isinstance(manifest, dict) or manifest.get("schema") != PACKAGE_SCHEMA:
            raise SellerClientError("Expected a completed original Python customer package")
        base_raw = _read(self.directory / "client-export.json", 131072)
        base = _parse(base_raw)
        if (_sha(base_raw) != manifest.get("originalManifestSha256") or
                base.get("sourceSha256") != manifest.get("sourceSha256")):
            raise SellerClientError("Original JavaScript export changed")
        for names, entries in ((ORIGINAL_FILES, base.get("files")), (PYTHON_FILES, manifest.get("files"))):
            if not isinstance(entries, list) or [item.get("name") for item in entries] != list(names):
                raise SellerClientError("Customer package has an incomplete file list")
            for item in entries:
                raw = _read(self.directory / item["name"])
                if type(item.get("bytes")) is not int or len(raw) != item["bytes"] or _sha(raw) != item.get("sha256"):
                    raise SellerClientError("Customer package file differs from its completed export")

    @property
    def source(self) -> dict:
        return {key: self._snapshot[key] for key in ("schema", "sourceSha256", "mode", "title", "origin")}

    @property
    def operations(self) -> list[dict]:
        return _parse(_json(self._snapshot["operations"]))

    def _build(self, payload: bytes) -> BoundRequest:
        self._verify_package()
        if len(payload) > MAX_INPUT:
            raise SellerClientError("Request input exceeds 64 MiB")
        env = dict(os.environ if self.environment is None else self.environment)
        # The bridge is a finite offline program, not a caller-selected loader.
        env.pop("NODE_OPTIONS", None)
        env.pop("NODE_PATH", None)
        try:
            run = subprocess.run([self.node, str(self.directory / "seller-client-bridge.mjs")], input=payload,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=self.timeout, env=env, check=False)
        except subprocess.TimeoutExpired:
            raise SellerClientError("Original offline request construction timed out") from None
        if run.returncode:
            try:
                error = _parse(run.stderr[:16384])
                message = error["message"]
            except (ValueError, KeyError, TypeError):
                message = "Original request builder failed; inspect the installed Node executable and customer package"
            raise SellerClientError(str(message))
        if len(run.stdout) > MAX_INPUT:
            raise SellerClientError("Original request reply exceeds its complete output limit")
        result = _parse(run.stdout)
        supplied = _parse(payload)
        if (result.get("schema") != SCHEMA or result.get("sourceSha256") != self.source["sourceSha256"] or
                result.get("operationId") != supplied.get("operationId")):
            raise SellerClientError("Original request reply does not match the selected source")
        content = result.get("body")
        body = None
        if content is not None:
            try:
                encoded = content.pop("base64")
                body = base64.b64decode(encoded, validate=True)
            except (ValueError, KeyError, TypeError):
                raise SellerClientError("Original request body is incomplete") from None
            if (len(body) > MAX_BODY or len(body) != content.get("bytes") or _sha(body) != content.get("sha256") or
                    base64.b64encode(body).decode("ascii") != encoded):
                raise SellerClientError("Original request body bytes do not match")
        return BoundRequest(payload, _json(result), body)

    def build_request(self, operation_id: str, inputs: dict, *, intent_id: str, max_atomic: str,
                      accept_index: int | None = None, payment_flow: str | None = None) -> BoundRequest:
        if type(inputs) is not dict:
            raise SellerClientError("Inputs must be an ordinary JSON object")
        converted = dict(inputs)
        if "multipart" in converted:
            part = converted["multipart"]
            if type(part) is not dict or set(part) != {"body", "contentType"} or type(part["body"]) is not bytes:
                raise SellerClientError("Multipart input needs exact bytes in body and the original contentType")
            if len(part["body"]) > MAX_BODY:
                raise SellerClientError("Multipart body exceeds 16 MiB")
            converted["multipart"] = {"bodyBase64": base64.b64encode(part["body"]).decode("ascii"), "contentType": part["contentType"]}
        authorization = {"intentId": intent_id, "maxAtomic": max_atomic}
        if accept_index is not None:
            if type(accept_index) is not int:
                raise SellerClientError("Select an integer accept_index explicitly")
            authorization["acceptIndex"] = accept_index
        if payment_flow is not None:
            authorization["paymentFlow"] = payment_flow
        payload = {"sourceSha256": self.source["sourceSha256"], "operationId": operation_id,
                   "inputs": converted, "authorization": authorization}
        _values(payload)
        return self._build(_json(payload))

    def load_request(self, directory) -> BoundRequest:
        path = _directory(Path(directory))
        manifest = _parse(_read(path / "request-plan.json", 131072))
        if manifest.get("schema") != "stellar-forge.python-seller-request-plan.v1" or manifest.get("sourceSha256") != self.source["sourceSha256"]:
            raise SellerClientError("Request plan belongs to a different original seller source")
        files = manifest.get("files")
        if not isinstance(files, list) or [item.get("name") for item in files] not in (
                ["request-input.json", "request.json"], ["request-input.json", "request.json", "request.body"]):
            raise SellerClientError("Request plan is incomplete")
        saved = {}
        for item in files:
            raw = _read(path / item["name"])
            if len(raw) != item.get("bytes") or _sha(raw) != item.get("sha256"):
                raise SellerClientError("Request plan bytes changed")
            saved[item["name"]] = raw
        # Validate even a consistently edited plan against the ORIGINAL builder.
        payload = _parse(saved["request-input.json"])
        _values(payload)
        rebuilt = self._build(saved["request-input.json"])
        if rebuilt._record != saved["request.json"] or rebuilt.body != saved.get("request.body"):
            raise SellerClientError("Saved request does not match original source construction")
        return rebuilt

    def _lineage(self, bound: BoundRequest) -> bytes:
        if not isinstance(bound, BoundRequest) or bound.source_sha256 != self.source["sourceSha256"]:
            raise SellerClientError("Use a request bound to this original seller export")
        rebuilt = self._build(bound._input)
        if rebuilt._record != bound._record or rebuilt.body != bound.body:
            raise SellerClientError("Bound request differs from its original construction")
        return _json({"schema": "stellar-forge.python-seller-operation.v1", "sourceSha256": bound.source_sha256,
                      "operationId": bound.operation_id, "requestSha256": _sha(bound._record),
                      "inputSha256": _sha(bound._input), "bound": bound.describe()})

    @staticmethod
    def _matches(operation, record: dict):
        config = _parse(_read(Path(operation.config_path), 65536))
        request = dict(config.get("operation", {}))
        body_file = request.pop("bodyFile", None)
        body_bytes = request.pop("bodyBytes", None)
        body_sha = request.pop("bodySha256", None)
        if request != record["request"]:
            raise SellerClientError("Existing native operation has different request or spending terms")
        expected = record["body"]
        if expected is None:
            if body_file is not None or body_bytes is not None or body_sha is not None:
                raise SellerClientError("Existing native operation has an unexpected body")
        else:
            if not isinstance(body_file, str):
                raise SellerClientError("Existing native operation lost its original body")
            body = _read(Path(body_file), MAX_BODY)
            if len(body) != expected["bytes"] or _sha(body) != expected["sha256"] or body_bytes != len(body) or body_sha != _sha(body):
                raise SellerClientError("Existing native operation body differs from the prepared request")

    def prepare(self, buyer, bound: BoundRequest):
        """Create one original Buyer Operation; no execution or approval occurs."""
        lineage = self._lineage(bound)
        with tempfile.TemporaryDirectory(prefix=".seller-client-", dir=buyer.state_dir) as temporary:
            config = Path(temporary) / "config.json"
            _write_once(config, _json(bound.configuration()))
            operation = buyer.from_config(config, body=bound.body)
        _write_once(Path(operation.directory) / LINEAGE, lineage)
        return operation

    def resume_preparation(self, buyer, bound: BoundRequest):
        """Recover a lost preparation reply without creating or executing an operation."""
        lineage = self._lineage(bound)
        operation = buyer.operation(bound.intent_id)
        self._matches(operation, bound.describe())
        path = Path(operation.directory) / LINEAGE
        if not path.exists() and (Path(operation.directory) / "attempt.json").exists():
            raise SellerClientError("Attempted operation has no matching client lineage; recover it with the original buyer")
        operation.review()  # Original validator and original review identity.
        _write_once(path, lineage)
        return operation

    def reopen(self, buyer, intent_id: str):
        """Return the same native Operation, including its original recover() path."""
        operation = buyer.operation(intent_id)
        lineage = _parse(_read(Path(operation.directory) / LINEAGE, MAX_INPUT))
        bound = lineage.get("bound")
        if (lineage.get("schema") != "stellar-forge.python-seller-operation.v1" or
                lineage.get("sourceSha256") != self.source["sourceSha256"] or not isinstance(bound, dict) or
                bound.get("operationId") not in {item["id"] for item in self._snapshot["operations"]} or
                bound.get("sourceSha256") != lineage["sourceSha256"] or
                bound.get("operationId") != lineage.get("operationId") or
                _sha(_json(bound)) != lineage.get("requestSha256") or bound.get("request", {}).get("intentId") != intent_id):
            raise SellerClientError("Native operation belongs to another seller source or request")
        self._matches(operation, bound)
        return operation


def main(argv=None):
    parser = argparse.ArgumentParser(description="Original seller's Python request and native buyer handoff")
    parser.add_argument("--directory", type=Path, default=Path(__file__).parent)
    parser.add_argument("--node", default="node")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("inspect")
    build = sub.add_parser("request")
    build.add_argument("--operation", required=True)
    build.add_argument("--inputs", required=True, type=Path)
    build.add_argument("--authorization", required=True, type=Path)
    build.add_argument("--out", required=True, type=Path)
    review = sub.add_parser("review")
    review.add_argument("--plan", required=True, type=Path)
    review.add_argument("--checkout", required=True, type=Path)
    review.add_argument("--state-dir", required=True, type=Path)
    review.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    client = SellerClient(args.directory, node=args.node)
    if args.command == "inspect":
        print(_json({"source": client.source, "operations": client.operations}).decode(), end="")
    elif args.command == "request":
        authorization = _parse(_read(args.authorization, 16384))
        inputs = _parse(_read(args.inputs))
        if not isinstance(authorization, dict) or set(authorization) - {"intent_id", "max_atomic", "accept_index", "payment_flow"}:
            raise SellerClientError("Use intent_id, max_atomic and explicit optional accept_index/payment_flow")
        if isinstance(inputs, dict) and isinstance(inputs.get("multipart"), dict):
            part = inputs["multipart"]
            if set(part) != {"body_file", "contentType"}:
                raise SellerClientError("CLI multipart input needs body_file and original contentType")
            file = Path(part["body_file"])
            if not file.is_absolute():
                file = args.inputs.absolute().parent / file
            inputs["multipart"] = {"body": _read(file, MAX_BODY), "contentType": part["contentType"]}
        request = client.build_request(args.operation, inputs, **authorization)
        directory = request.save(args.out)
        print(_json({"directory": str(directory), **request.describe()}).decode(), end="")
    else:
        from stellar_forge_buyer import Buyer
        buyer = Buyer(checkout=args.checkout, state_dir=args.state_dir, node=args.node)
        bound = client.load_request(args.plan)
        operation = client.resume_preparation(buyer, bound) if args.resume else client.prepare(buyer, bound)
        reviewed = operation.review()
        print(_json({"source": client.source, "intentId": reviewed.intent_id, "configurationSha256": reviewed.config_sha256,
                     "bodySha256": reviewed.body_sha256, "native": reviewed.native}).decode(), end="")


if __name__ == "__main__":
    try:
        main()
    except (SellerClientError, OSError, ValueError) as error:
        raise SystemExit(str(error)) from None

from __future__ import annotations

import hashlib
import json
import posixpath
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Protocol


class EvidenceError(ValueError):
    """Raised when untrusted agent output violates the evidence/authority contract."""


def _reject_constant(value: str) -> None:
    raise EvidenceError(f"non-finite JSON number rejected: {value}")


def _pairs_no_duplicates(pairs: Iterable[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise EvidenceError(f"duplicate JSON key rejected: {key}")
        result[key] = value
    return result


def strict_json_loads(raw: str) -> Any:
    try:
        return json.loads(
            raw,
            object_pairs_hook=_pairs_no_duplicates,
            parse_constant=_reject_constant,
        )
    except EvidenceError:
        raise
    except (json.JSONDecodeError, TypeError) as exc:
        raise EvidenceError(f"invalid JSON: {exc}") from exc


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _safe_relpath(path: str) -> str:
    if not isinstance(path, str) or not path:
        raise EvidenceError("path must be a non-empty string")
    if "\x00" in path or "\\" in path:
        raise EvidenceError("path must be a normalized POSIX relative path")
    normalized = posixpath.normpath(path)
    if path.startswith("/") or normalized in {".", ".."} or normalized.startswith("../"):
        raise EvidenceError("path escapes workspace")
    if normalized != path:
        raise EvidenceError("path must already be normalized")
    return path


def _require_exact_keys(obj: Mapping[str, Any], expected: set[str], where: str) -> None:
    actual = set(obj)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise EvidenceError(f"{where} keys mismatch; missing={missing}, extra={extra}")


class Sandbox(Protocol):
    def read(self, path: str) -> str: ...
    def write(self, path: str, content: str) -> None: ...
    def run_test(self, name: str) -> tuple[int, str]: ...
    def snapshot(self) -> Mapping[str, str]: ...


@dataclass
class MemorySandbox:
    """Deterministic offline sandbox used for replay and tests.

    It intentionally does not execute a shell. Production adapters may map
    `run_test()` to Nebius Token Factory Sandboxes or other isolated runners,
    but must preserve the same predeclared-test contract.
    """

    files: dict[str, str]
    tests: dict[str, tuple[int, str]]

    def __init__(
        self,
        files: Mapping[str, str] | None = None,
        tests: Mapping[str, tuple[int, str]] | None = None,
    ) -> None:
        self.files = dict(files or {})
        self.tests = dict(tests or {})
        for path in self.files:
            _safe_relpath(path)

    def read(self, path: str) -> str:
        path = _safe_relpath(path)
        if path not in self.files:
            raise EvidenceError(f"missing sandbox file: {path}")
        return self.files[path]

    def write(self, path: str, content: str) -> None:
        path = _safe_relpath(path)
        if not isinstance(content, str):
            raise EvidenceError("write content must be text")
        self.files[path] = content

    def run_test(self, name: str) -> tuple[int, str]:
        if name not in self.tests:
            raise EvidenceError(f"test is not declared by the human policy: {name}")
        code, output = self.tests[name]
        if not isinstance(code, int) or not isinstance(output, str):
            raise EvidenceError("invalid sandbox test fixture")
        return code, output

    def snapshot(self) -> Mapping[str, str]:
        return dict(sorted(self.files.items()))


def _validate_request(request: Mapping[str, Any]) -> dict[str, Any]:
    _require_exact_keys(
        request,
        {"request_id", "goal", "allowed_paths", "required_tests", "max_writes"},
        "request",
    )
    request_id = request["request_id"]
    goal = request["goal"]
    allowed_paths = request["allowed_paths"]
    required_tests = request["required_tests"]
    max_writes = request["max_writes"]

    if not isinstance(request_id, str) or not request_id.strip():
        raise EvidenceError("request_id must be non-empty")
    if not isinstance(goal, str) or not goal.strip():
        raise EvidenceError("goal must be non-empty")
    if not isinstance(allowed_paths, list) or not allowed_paths:
        raise EvidenceError("allowed_paths must be a non-empty list")
    normalized_paths = [_safe_relpath(p) for p in allowed_paths]
    if len(set(normalized_paths)) != len(normalized_paths):
        raise EvidenceError("allowed_paths contains duplicates")
    if not isinstance(required_tests, list):
        raise EvidenceError("required_tests must be a list")
    if any(not isinstance(x, str) or not x for x in required_tests):
        raise EvidenceError("required_tests entries must be non-empty strings")
    if len(set(required_tests)) != len(required_tests):
        raise EvidenceError("required_tests contains duplicates")
    if not isinstance(max_writes, int) or isinstance(max_writes, bool) or not (0 <= max_writes <= 32):
        raise EvidenceError("max_writes must be an integer in [0, 32]")

    return {
        "request_id": request_id,
        "goal": goal,
        "allowed_paths": normalized_paths,
        "required_tests": list(required_tests),
        "max_writes": max_writes,
    }


def _validate_plan(plan: Mapping[str, Any], policy: Mapping[str, Any]) -> dict[str, Any]:
    _require_exact_keys(plan, {"summary", "operations"}, "plan")
    if not isinstance(plan["summary"], str) or not plan["summary"].strip():
        raise EvidenceError("plan summary must be non-empty")
    operations = plan["operations"]
    if not isinstance(operations, list):
        raise EvidenceError("operations must be a list")
    if len(operations) > 64:
        raise EvidenceError("too many operations")

    allowed_paths = set(policy["allowed_paths"])
    allowed_tests = set(policy["required_tests"])
    writes = 0
    normalized: list[dict[str, Any]] = []

    for index, op in enumerate(operations):
        if not isinstance(op, dict):
            raise EvidenceError(f"operation {index} must be an object")
        kind = op.get("kind")
        if kind == "read":
            _require_exact_keys(op, {"kind", "path"}, f"operation {index}")
            path = _safe_relpath(op["path"])
            if path not in allowed_paths:
                raise EvidenceError(f"read outside allowed_paths: {path}")
            normalized.append({"kind": "read", "path": path})
        elif kind == "write":
            _require_exact_keys(op, {"kind", "path", "content"}, f"operation {index}")
            path = _safe_relpath(op["path"])
            if path not in allowed_paths:
                raise EvidenceError(f"write outside allowed_paths: {path}")
            content = op["content"]
            if not isinstance(content, str):
                raise EvidenceError("write content must be text")
            writes += 1
            if writes > policy["max_writes"]:
                raise EvidenceError("plan exceeds max_writes")
            normalized.append({"kind": "write", "path": path, "content": content})
        elif kind == "test":
            _require_exact_keys(op, {"kind", "name"}, f"operation {index}")
            name = op["name"]
            if not isinstance(name, str) or name not in allowed_tests:
                raise EvidenceError(f"test outside required_tests: {name!r}")
            normalized.append({"kind": "test", "name": name})
        else:
            raise EvidenceError(f"unsupported operation kind: {kind!r}")

    planned_tests = [op["name"] for op in normalized if op["kind"] == "test"]
    if planned_tests != policy["required_tests"]:
        raise EvidenceError(
            "plan must run every required test exactly once and in human-declared order"
        )
    return {"summary": plan["summary"], "operations": normalized}


def _snapshot_digest(snapshot: Mapping[str, str]) -> str:
    serial = [{"path": path, "sha256": sha256_hex(text.encode("utf-8"))}
              for path, text in sorted(snapshot.items())]
    return sha256_hex(canonical_bytes(serial))


def _execute_plan(
    plan: Mapping[str, Any],
    sandbox: Sandbox,
) -> tuple[list[dict[str, Any]], bool]:
    events: list[dict[str, Any]] = []
    all_tests_green = True
    sequence = 0
    for op in plan["operations"]:
        sequence += 1
        if op["kind"] == "read":
            content = sandbox.read(op["path"])
            events.append({
                "seq": sequence,
                "kind": "read",
                "path": op["path"],
                "content_sha256": sha256_hex(content.encode("utf-8")),
            })
        elif op["kind"] == "write":
            before = None
            try:
                before = sandbox.read(op["path"])
            except EvidenceError:
                pass
            sandbox.write(op["path"], op["content"])
            events.append({
                "seq": sequence,
                "kind": "write",
                "path": op["path"],
                "before_sha256": None if before is None else sha256_hex(before.encode("utf-8")),
                "after_sha256": sha256_hex(op["content"].encode("utf-8")),
            })
        elif op["kind"] == "test":
            code, output = sandbox.run_test(op["name"])
            all_tests_green = all_tests_green and code == 0
            events.append({
                "seq": sequence,
                "kind": "test",
                "name": op["name"],
                "exit_code": code,
                "output_sha256": sha256_hex(output.encode("utf-8")),
            })
        else:
            raise AssertionError("validated operation became unsupported")
    return events, all_tests_green


def compile_change(
    request_raw: str,
    model_plan_raw: str,
    sandbox: Sandbox,
    *,
    provider_evidence: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Validate a human request and untrusted model plan, execute in a sandbox,
    and return a tamper-evident receipt.

    `provider_evidence` is data, never authority. A model response or provider
    receipt cannot approve a change. The returned authority always requires
    a separate human decision before any real-repository mutation.
    """

    request_obj = strict_json_loads(request_raw)
    plan_obj = strict_json_loads(model_plan_raw)
    if not isinstance(request_obj, dict) or not isinstance(plan_obj, dict):
        raise EvidenceError("request and plan must be JSON objects")

    request = _validate_request(request_obj)
    plan = _validate_plan(plan_obj, request)
    before = sandbox.snapshot()
    before_digest = _snapshot_digest(before)
    events, tests_green = _execute_plan(plan, sandbox)
    after = sandbox.snapshot()
    after_digest = _snapshot_digest(after)

    provider = dict(provider_evidence or {})
    # No provider field is trusted as approval, and arbitrary nested objects are
    # fine because they are only hashed as evidence.
    provider_digest = sha256_hex(canonical_bytes(provider))

    body = {
        "schema": "evidenceforge-receipt/v1",
        "request": request,
        "request_sha256": sha256_hex(canonical_bytes(request)),
        "plan": plan,
        "plan_sha256": sha256_hex(canonical_bytes(plan)),
        "workspace_before_sha256": before_digest,
        "workspace_after_sha256": after_digest,
        "events": events,
        "required_tests_green": tests_green,
        "provider_evidence_sha256": provider_digest,
        "authority": {
            "sandbox_execution": True,
            "real_repository_mutation": False,
            "deployment": False,
            "external_outbound": False,
            "payment_or_spend": False,
            "human_approval_required": True,
        },
    }
    receipt_sha256 = sha256_hex(canonical_bytes(body))
    return {**body, "receipt_sha256": receipt_sha256}


def verify_receipt(receipt: Mapping[str, Any]) -> bool:
    if not isinstance(receipt, dict) or receipt.get("schema") != "evidenceforge-receipt/v1":
        return False
    digest = receipt.get("receipt_sha256")
    if not isinstance(digest, str) or len(digest) != 64:
        return False
    body = dict(receipt)
    body.pop("receipt_sha256", None)
    try:
        expected = sha256_hex(canonical_bytes(body))
    except (TypeError, ValueError):
        return False
    if expected != digest:
        return False
    authority = receipt.get("authority")
    if authority != {
        "sandbox_execution": True,
        "real_repository_mutation": False,
        "deployment": False,
        "external_outbound": False,
        "payment_or_spend": False,
        "human_approval_required": True,
    }:
        return False
    request = receipt.get("request")
    plan = receipt.get("plan")
    try:
        if not isinstance(request, dict) or not isinstance(plan, dict):
            return False
        normalized_request = _validate_request(request)
        normalized_plan = _validate_plan(plan, normalized_request)
    except EvidenceError:
        return False
    if normalized_request != request or normalized_plan != plan:
        return False
    if receipt.get("request_sha256") != sha256_hex(canonical_bytes(request)):
        return False
    if receipt.get("plan_sha256") != sha256_hex(canonical_bytes(plan)):
        return False
    return True

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict, deque
from pathlib import PurePosixPath
from typing import Any

SCHEMA = "repoatlas-input/v1"
PACKET_SCHEMA = "repoatlas-review-packet/v1"
RECEIPT_SCHEMA = "repoatlas-receipt/v1"
MAX_FILES = 5000
MAX_EDGES = 20000
MAX_TEXT = 200_000
_ALLOWED_KINDS = {"source", "test", "doc", "config", "workflow", "asset"}
_RISK_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4}
_HEX64 = re.compile(r"^[0-9a-f]{64}$")


class RepoAtlasError(ValueError):
    pass


def _pairs(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise RepoAtlasError(f"duplicate_key:{key}")
        out[key] = value
    return out


def parse_json_bytes(data: bytes) -> Any:
    if len(data) > MAX_TEXT:
        raise RepoAtlasError("input_too_large")
    try:
        text = data.decode("utf-8", "strict")
        return json.loads(text, object_pairs_hook=_pairs, parse_constant=lambda x: (_ for _ in ()).throw(RepoAtlasError("nonfinite_json")))
    except UnicodeDecodeError as exc:
        raise RepoAtlasError("invalid_utf8") from exc
    except json.JSONDecodeError as exc:
        raise RepoAtlasError("invalid_json") from exc


def _canonical(obj: Any) -> bytes:
    try:
        text = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        return text.encode("utf-8", "strict")
    except (TypeError, ValueError, UnicodeEncodeError) as exc:
        raise RepoAtlasError("not_canonical_json") from exc


def _sha(obj: Any) -> str:
    return hashlib.sha256(_canonical(obj)).hexdigest()


def _expect_dict(value: Any, name: str) -> dict[str, Any]:
    if type(value) is not dict:
        raise RepoAtlasError(f"{name}:object_required")
    return value


def _expect_list(value: Any, name: str) -> list[Any]:
    if type(value) is not list:
        raise RepoAtlasError(f"{name}:array_required")
    return value


def _text(value: Any, name: str, maximum: int = 512) -> str:
    if type(value) is not str or not value or len(value) > maximum or "\x00" in value:
        raise RepoAtlasError(f"{name}:text")
    value.encode("utf-8", "strict")
    return value


def _bool(value: Any, name: str) -> bool:
    if type(value) is not bool:
        raise RepoAtlasError(f"{name}:bool")
    return value


def _path(value: Any, name: str) -> str:
    raw = _text(value, name, 512)
    p = PurePosixPath(raw)
    if p.is_absolute() or raw != p.as_posix() or ".." in p.parts or "." in p.parts or raw.startswith("/"):
        raise RepoAtlasError(f"{name}:unsafe_path")
    return raw


def _digest(value: Any, name: str) -> str:
    text = _text(value, name, 64)
    if not _HEX64.fullmatch(text):
        raise RepoAtlasError(f"{name}:sha256")
    return text


def _only(obj: dict[str, Any], allowed: set[str], name: str) -> None:
    extra = set(obj) - allowed
    if extra:
        raise RepoAtlasError(f"{name}:unknown_fields:{','.join(sorted(extra))}")


def _validate(raw: Any) -> dict[str, Any]:
    root = _expect_dict(raw, "root")
    _only(root, {"schema", "repository", "baseline", "files", "dependencies", "changes", "adrs", "runbooks", "provider"}, "root")
    if root.get("schema") != SCHEMA:
        raise RepoAtlasError("schema")
    repository = _text(root.get("repository"), "repository", 200)
    baseline = _digest(root.get("baseline"), "baseline")

    files_in = _expect_list(root.get("files"), "files")
    if not files_in or len(files_in) > MAX_FILES:
        raise RepoAtlasError("files:cardinality")
    files: list[dict[str, Any]] = []
    paths: set[str] = set()
    for i, item in enumerate(files_in):
        row = _expect_dict(item, f"files[{i}]")
        _only(row, {"path", "kind", "owner", "sha256", "public_api", "tests", "module"}, f"files[{i}]")
        path = _path(row.get("path"), f"files[{i}].path")
        if path in paths:
            raise RepoAtlasError("files:duplicate_path")
        paths.add(path)
        kind = _text(row.get("kind"), f"files[{i}].kind", 32)
        if kind not in _ALLOWED_KINDS:
            raise RepoAtlasError("files:kind")
        tests = []
        for j, test in enumerate(_expect_list(row.get("tests", []), f"files[{i}].tests")):
            tests.append(_path(test, f"files[{i}].tests[{j}]"))
        files.append({
            "path": path,
            "kind": kind,
            "owner": _text(row.get("owner", "UNOWNED"), f"files[{i}].owner", 120),
            "sha256": _digest(row.get("sha256"), f"files[{i}].sha256"),
            "public_api": _bool(row.get("public_api", False), f"files[{i}].public_api"),
            "tests": sorted(set(tests)),
            "module": _text(row.get("module", path.split("/", 1)[0]), f"files[{i}].module", 120),
        })

    deps_in = _expect_list(root.get("dependencies", []), "dependencies")
    if len(deps_in) > MAX_EDGES:
        raise RepoAtlasError("dependencies:cardinality")
    dependencies: list[dict[str, str]] = []
    seen_edges = set()
    for i, item in enumerate(deps_in):
        row = _expect_dict(item, f"dependencies[{i}]")
        _only(row, {"from", "to", "kind"}, f"dependencies[{i}]")
        src = _path(row.get("from"), f"dependencies[{i}].from")
        dst = _path(row.get("to"), f"dependencies[{i}].to")
        if src not in paths or dst not in paths:
            raise RepoAtlasError("dependencies:unknown_path")
        kind = _text(row.get("kind"), f"dependencies[{i}].kind", 40)
        edge = (src, dst, kind)
        if edge in seen_edges:
            raise RepoAtlasError("dependencies:duplicate")
        seen_edges.add(edge)
        dependencies.append({"from": src, "to": dst, "kind": kind})

    changes_in = _expect_list(root.get("changes", []), "changes")
    changes: list[dict[str, Any]] = []
    changed_paths = set()
    for i, item in enumerate(changes_in):
        row = _expect_dict(item, f"changes[{i}]")
        _only(row, {"path", "change", "before_sha256", "after_sha256"}, f"changes[{i}]")
        path = _path(row.get("path"), f"changes[{i}].path")
        if path in changed_paths:
            raise RepoAtlasError("changes:duplicate_path")
        changed_paths.add(path)
        change = _text(row.get("change"), f"changes[{i}].change", 24)
        if change not in {"added", "modified", "deleted"}:
            raise RepoAtlasError("changes:change")
        before = row.get("before_sha256")
        after = row.get("after_sha256")
        if change == "added":
            if before is not None or after is None:
                raise RepoAtlasError("changes:added_hashes")
            after = _digest(after, f"changes[{i}].after_sha256")
        elif change == "deleted":
            if before is None or after is not None:
                raise RepoAtlasError("changes:deleted_hashes")
            before = _digest(before, f"changes[{i}].before_sha256")
        else:
            before = _digest(before, f"changes[{i}].before_sha256")
            after = _digest(after, f"changes[{i}].after_sha256")
            if before == after:
                raise RepoAtlasError("changes:no_op")
        changes.append({"path": path, "change": change, "before_sha256": before, "after_sha256": after})

    def docs(name: str) -> list[dict[str, Any]]:
        rows = []
        for i, item in enumerate(_expect_list(root.get(name, []), name)):
            row = _expect_dict(item, f"{name}[{i}]")
            _only(row, {"id", "covers", "sha256"}, f"{name}[{i}]")
            covers = sorted({_path(x, f"{name}[{i}].covers") for x in _expect_list(row.get("covers"), f"{name}[{i}].covers")})
            if any(x not in paths for x in covers):
                raise RepoAtlasError(f"{name}:unknown_path")
            rows.append({"id": _text(row.get("id"), f"{name}[{i}].id", 120), "covers": covers, "sha256": _digest(row.get("sha256"), f"{name}[{i}].sha256")})
        return sorted(rows, key=lambda x: x["id"])

    provider = _expect_dict(root.get("provider"), "provider")
    _only(provider, {"bob_execution_verified", "registration_verified", "submission_verified", "tracks_published"}, "provider")
    provider_out = {k: _bool(provider.get(k), f"provider.{k}") for k in ("bob_execution_verified", "registration_verified", "submission_verified", "tracks_published")}

    return {
        "schema": SCHEMA,
        "repository": repository,
        "baseline": baseline,
        "files": sorted(files, key=lambda x: x["path"]),
        "dependencies": sorted(dependencies, key=lambda x: (x["from"], x["to"], x["kind"])),
        "changes": sorted(changes, key=lambda x: x["path"]),
        "adrs": docs("adrs"),
        "runbooks": docs("runbooks"),
        "provider": provider_out,
    }


def _distance_to_tests(path: str, reverse: dict[str, set[str]], tests: set[str]) -> int | None:
    if path in tests:
        return 0
    q = deque([(path, 0)])
    seen = {path}
    while q:
        node, distance = q.popleft()
        for nxt in sorted(reverse.get(node, ())):
            if nxt in tests:
                return distance + 1
            if nxt not in seen and distance < 8:
                seen.add(nxt)
                q.append((nxt, distance + 1))
    return None


def _analyze(data: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    by_path = {x["path"]: x for x in data["files"]}
    changed = {x["path"]: x for x in data["changes"]}
    forward: dict[str, set[str]] = defaultdict(set)
    reverse: dict[str, set[str]] = defaultdict(set)
    for edge in data["dependencies"]:
        forward[edge["from"]].add(edge["to"])
        reverse[edge["to"]].add(edge["from"])
    tests = {p for p, row in by_path.items() if row["kind"] == "test"}
    adr_cover = {p for row in data["adrs"] for p in row["covers"]}
    runbook_cover = {p for row in data["runbooks"] for p in row["covers"]}
    findings: list[dict[str, Any]] = []

    def add(path: str, risk: str, code: str, detail: str) -> None:
        findings.append({"path": path, "risk": risk, "code": code, "detail": detail})

    for path, change in sorted(changed.items()):
        row = by_path.get(path)
        if change["change"] == "deleted":
            if row is None:
                add(path, "CRITICAL", "DELETED_FILE_MISSING_FROM_BASELINE", "deleted path is not present in admitted baseline manifest")
            else:
                dependents = sorted(reverse.get(path, ()))
                if dependents:
                    add(path, "HIGH", "DELETED_WITH_DEPENDENTS", f"deleted path retains {len(dependents)} admitted dependents")
            continue
        if row is None:
            add(path, "CRITICAL", "CHANGED_FILE_MISSING_FROM_MANIFEST", "changed path is not present in admitted file manifest")
            continue
        if row["owner"] == "UNOWNED":
            add(path, "MEDIUM", "OWNERSHIP_GAP", "changed path has no admitted owner")
        if row["kind"] == "source" and row["public_api"] and path not in adr_cover:
            add(path, "HIGH", "PUBLIC_API_WITHOUT_ADR_COVERAGE", "changed public surface has no admitted ADR coverage")
        direct_tests = [t for t in row["tests"] if t in tests]
        distance = _distance_to_tests(path, reverse, tests)
        if row["kind"] == "source" and not direct_tests and distance is None:
            add(path, "HIGH", "NO_TEST_EVIDENCE", "changed source has no direct or dependency-reachable admitted test")
        elif row["kind"] == "source" and not direct_tests:
            add(path, "MEDIUM", "INDIRECT_TEST_ONLY", f"nearest admitted dependent test distance is {distance}")
        if row["kind"] in {"source", "config", "workflow"} and path not in runbook_cover:
            add(path, "LOW", "RUNBOOK_COVERAGE_GAP", "changed operational path has no admitted runbook coverage")
        fanout = len(reverse.get(path, ()))
        if fanout >= 5:
            add(path, "MEDIUM", "HIGH_DEPENDENT_FANOUT", f"changed path has {fanout} direct dependents")

    provider = data["provider"]
    if not provider["tracks_published"]:
        add("<competition>", "INFO", "TRACKS_UNPUBLISHED", "event tracks are not yet published; track-specific readiness is HOLD")
    if not provider["bob_execution_verified"]:
        add("<provider>", "MEDIUM", "BOB_EXECUTION_REQUIRED", "no retained IBM Bob execution evidence is admitted")
    if not provider["registration_verified"]:
        add("<provider>", "INFO", "REGISTRATION_NOT_VERIFIED", "registration is not claimed")
    if not provider["submission_verified"]:
        add("<provider>", "INFO", "SUBMISSION_NOT_VERIFIED", "submission is not claimed")

    findings.sort(key=lambda x: (_RISK_ORDER[x["risk"]], x["path"], x["code"], x["detail"]))

    modules: dict[str, dict[str, Any]] = {}
    for row in data["files"]:
        entry = modules.setdefault(row["module"], {"files": 0, "tests": 0, "owners": set(), "changed": 0, "public_api": 0})
        entry["files"] += 1
        entry["tests"] += int(row["kind"] == "test")
        entry["owners"].add(row["owner"])
        entry["changed"] += int(row["path"] in changed)
        entry["public_api"] += int(row["public_api"])
    module_rows = []
    for module, row in sorted(modules.items()):
        module_rows.append({**{k: row[k] for k in ("files", "tests", "changed", "public_api")}, "module": module, "owners": sorted(row["owners"])})

    counts = Counter(x["risk"] for x in findings)
    summary = {
        "files": len(data["files"]),
        "dependencies": len(data["dependencies"]),
        "changed_paths": len(data["changes"]),
        "modules": len(module_rows),
        "finding_counts": {key: counts.get(key, 0) for key in _RISK_ORDER},
    }
    return findings, summary, module_rows


def _recommendations(findings: list[dict[str, Any]]) -> list[dict[str, str]]:
    mapping = {
        "CHANGED_FILE_MISSING_FROM_MANIFEST": "Rebuild the admitted file/change manifest before review.",
        "DELETED_FILE_MISSING_FROM_BASELINE": "Rebuild the baseline manifest; a claimed deletion must exist in that baseline evidence.",
        "DELETED_WITH_DEPENDENTS": "Inspect dependents and provide an explicit migration or removal plan.",
        "PUBLIC_API_WITHOUT_ADR_COVERAGE": "Add or update an ADR that covers the changed public contract.",
        "NO_TEST_EVIDENCE": "Add direct or dependency-reachable tests before considering release.",
        "INDIRECT_TEST_ONLY": "Add a focused regression for the changed source path.",
        "OWNERSHIP_GAP": "Assign a human owner for review and follow-up.",
        "RUNBOOK_COVERAGE_GAP": "Update an operational runbook covering this changed path.",
        "HIGH_DEPENDENT_FANOUT": "Run dependent-impact review across the direct fanout.",
        "TRACKS_UNPUBLISHED": "Wait for published competition tracks before claiming track fit.",
        "BOB_EXECUTION_REQUIRED": "Capture a real IBM Bob build-session/provider receipt before competition readiness.",
        "REGISTRATION_NOT_VERIFIED": "Keep registration state false until a provider receipt exists.",
        "SUBMISSION_NOT_VERIFIED": "Keep submission state false until a provider receipt exists.",
    }
    seen = set()
    out = []
    for finding in findings:
        code = finding["code"]
        key = (finding["path"], code)
        if key not in seen:
            seen.add(key)
            out.append({"path": finding["path"], "code": code, "action": mapping[code]})
    return out


def compile_packet(raw: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    data = _validate(raw)
    findings, summary, modules = _analyze(data)
    blocking = any(x["risk"] in {"CRITICAL", "HIGH"} for x in findings)
    competition_hold = any(x["code"] in {"BOB_EXECUTION_REQUIRED", "TRACKS_UNPUBLISHED", "REGISTRATION_NOT_VERIFIED", "SUBMISSION_NOT_VERIFIED"} for x in findings)
    packet = {
        "schema": PACKET_SCHEMA,
        "state": "HOLD_EVIDENCE_GAPS" if blocking else "READY_FOR_HUMAN_REVIEW",
        "competition_state": "PROVIDER_GATE_HOLD" if competition_hold else "PROVIDER_EVIDENCE_PRESENT",
        "repository": data["repository"],
        "baseline": data["baseline"],
        "input_sha256": _sha(data),
        "summary": summary,
        "modules": modules,
        "findings": findings,
        "recommendations": _recommendations(findings),
        "authority": {
            "auto_merge": False,
            "deploy": False,
            "external_send": False,
            "account_or_terms": False,
            "competition_submit": False,
            "award_or_payment": False,
            "human_review_required": True,
        },
    }
    packet["packet_sha256"] = _sha(packet)
    receipt = {
        "schema": RECEIPT_SCHEMA,
        "input_sha256": packet["input_sha256"],
        "packet_sha256": packet["packet_sha256"],
        "authority_external_action": False,
    }
    receipt["receipt_sha256"] = _sha(receipt)
    return packet, receipt


def verify_bundle(raw: Any, packet: Any, receipt: Any) -> bool:
    expected_packet, expected_receipt = compile_packet(raw)
    if packet != expected_packet:
        raise RepoAtlasError("verify:packet_mismatch")
    if receipt != expected_receipt:
        raise RepoAtlasError("verify:receipt_mismatch")
    return True

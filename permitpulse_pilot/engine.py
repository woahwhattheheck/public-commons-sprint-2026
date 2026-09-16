"""PermitPulse paid-pilot commercialization carrier. Offline owner-review only."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA = "permitpulse-paid-pilot/v1"
SCHEMA_PACKET = "permitpulse-paid-pilot-packet/v1"
SCHEMA_RECEIPT = "permitpulse-paid-pilot-receipt/v1"
READINESS_PATH = Path("permitpulse-all-gas/submission/READINESS.json")
SAFE_INT = 9_007_199_254_740_991
MAX_FILE_BYTES = 1_000_000
REF_RE = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
HTTPS_RE = re.compile(r"^https://[A-Za-z0-9.-]+(?:/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=-]*)?$")
LABEL_RE = re.compile(r"^[A-Za-z0-9 .,_-]{1,120}$")
FORBIDDEN = (
    "accepted-price",
    "accepted price",
    "customer-result",
    "customer result",
    "live-provider",
    "live provider",
    "prize claim",
    "prize-claim",
    "compliant",
    "compliance conclusion",
    "legal advice",
    "legal-advice",
    "outbound send",
    "payment received",
    "payment link",
    "revenue recognized",
    "readyforsubmission\": true",
)
CEILING = (
    "COMMERCIALIZATION_CARRIER_ONLY_NO_BUYER_CONTACT_NO_LIVE_PROVIDER_"
    "NO_SUBMISSION_NO_PRIZE_NO_PAYMENT_NO_REVENUE_NO_COMPLIANCE_CONCLUSION"
)


class ValidationError(ValueError):
    pass


def _dup(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise ValidationError(f"duplicate JSON key: {key}")
        out[key] = value
    return out


def _reject_float(value: str) -> None:
    raise ValidationError("JSON floats rejected")


def _reject_const(value: str) -> None:
    raise ValidationError(f"non-finite JSON number rejected: {value}")


def loads_strict(raw: str) -> Any:
    try:
        return json.loads(raw, object_pairs_hook=_dup, parse_float=_reject_float, parse_constant=_reject_const)
    except ValidationError:
        raise
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        raise ValidationError(f"invalid JSON: {exc}") from exc


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_json_file(path: str | os.PathLike[str]) -> Any:
    p = Path(path)
    if p.is_symlink() or not p.is_file():
        raise ValidationError("input must be an ordinary regular file")
    st = p.lstat()
    if st.st_size <= 0 or st.st_size > MAX_FILE_BYTES:
        raise ValidationError("input size out of bounds")
    text = p.read_text(encoding="utf-8")
    if text.startswith("\ufeff"):
        raise ValidationError("BOM rejected")
    return loads_strict(text)


def _exact(obj: Any, keys: set[str], where: str) -> dict[str, Any]:
    if not isinstance(obj, dict) or set(obj) != keys:
        raise ValidationError(f"{where} fields mismatch")
    return obj


def _str(value: Any, where: str, pattern: re.Pattern[str], max_len: int = 160) -> str:
    if not isinstance(value, str) or not value or len(value) > max_len:
        raise ValidationError(f"{where} must be bounded text")
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise ValidationError(f"{where} control characters")
    if "@" in value and "https://" not in value:
        raise ValidationError(f"{where} contact material rejected")
    if not pattern.fullmatch(value):
        raise ValidationError(f"{where} invalid format")
    return value


def _int(value: Any, where: str, *, minimum: int = 0, maximum: int = SAFE_INT) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError(f"{where} must be an integer")
    if value < minimum or value > maximum:
        raise ValidationError(f"{where} out of bounds")
    return value


def _utc(value: Any, where: str) -> str:
    if not isinstance(value, str) or not UTC_RE.fullmatch(value):
        raise ValidationError(f"{where} must be canonical UTC")
    datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    return value


def _sha(value: Any, where: str) -> str:
    if not isinstance(value, str) or not SHA_RE.fullmatch(value):
        raise ValidationError(f"{where} must be lowercase SHA-256")
    return value


def _list(value: Any, where: str, *, maximum: int = 50) -> list[Any]:
    if not isinstance(value, list) or not value or len(value) > maximum:
        raise ValidationError(f"{where} must be a non-empty bounded array")
    return value


def _scan_forbidden(value: Any, where: str) -> None:
    blob = json.dumps(value).lower()
    for token in FORBIDDEN:
        if token in blob:
            raise ValidationError(f"forbidden promotion in {where}: {token}")


def normalize(raw: Any) -> dict[str, Any]:
    obj = _exact(
        raw,
        {"schema", "pilotId", "asOfUtc", "intake", "snapshots", "changes", "commercial", "researchAccounts"},
        "source",
    )
    if obj["schema"] != SCHEMA:
        raise ValidationError("schema mismatch")
    _scan_forbidden(obj, "source")
    intake = _exact(obj["intake"], {"jurisdictions", "sources", "reviewOwners", "retentionDays"}, "intake")
    jurisdictions = []
    jids: set[str] = set()
    for i, row in enumerate(_list(intake["jurisdictions"], "jurisdictions")):
        rec = _exact(row, {"id", "label"}, f"jurisdictions[{i}]")
        jid = _str(rec["id"], f"jurisdictions[{i}].id", REF_RE)
        if jid in jids:
            raise ValidationError("duplicate jurisdiction")
        jids.add(jid)
        jurisdictions.append({"id": jid, "label": _str(rec["label"], f"jurisdictions[{i}].label", LABEL_RE)})
    sources = []
    sids: set[str] = set()
    for i, row in enumerate(_list(intake["sources"], "sources")):
        rec = _exact(row, {"id", "jurisdictionId", "httpsUrl", "refreshCadenceHours"}, f"sources[{i}]")
        sid = _str(rec["id"], f"sources[{i}].id", REF_RE)
        if sid in sids:
            raise ValidationError("duplicate source")
        sids.add(sid)
        jid = _str(rec["jurisdictionId"], f"sources[{i}].jurisdictionId", REF_RE)
        if jid not in jids:
            raise ValidationError("source unknown jurisdiction")
        url = _str(rec["httpsUrl"], f"sources[{i}].httpsUrl", HTTPS_RE, max_len=240)
        if "example.invalid" not in url:
            raise ValidationError("pilot fixture sources must stay on example.invalid")
        sources.append(
            {
                "id": sid,
                "jurisdictionId": jid,
                "httpsUrl": url,
                "refreshCadenceHours": _int(rec["refreshCadenceHours"], f"sources[{i}].refreshCadenceHours", minimum=1, maximum=168),
            }
        )
    owners = []
    for i, row in enumerate(_list(intake["reviewOwners"], "reviewOwners", maximum=10)):
        rec = _exact(row, {"id", "role"}, f"reviewOwners[{i}]")
        owners.append(
            {
                "id": _str(rec["id"], f"reviewOwners[{i}].id", REF_RE),
                "role": _str(rec["role"], f"reviewOwners[{i}].role", LABEL_RE),
            }
        )
    snapshots = []
    snap_ids: set[str] = set()
    for i, row in enumerate(_list(obj["snapshots"], "snapshots")):
        rec = _exact(row, {"id", "sourceId", "capturedAt", "digest"}, f"snapshots[{i}]")
        sid = _str(rec["sourceId"], f"snapshots[{i}].sourceId", REF_RE)
        if sid not in sids:
            raise ValidationError("snapshot unknown source")
        snap_id = _str(rec["id"], f"snapshots[{i}].id", REF_RE)
        if snap_id in snap_ids:
            raise ValidationError("duplicate snapshot")
        snap_ids.add(snap_id)
        snapshots.append(
            {
                "id": snap_id,
                "sourceId": sid,
                "capturedAt": _utc(rec["capturedAt"], f"snapshots[{i}].capturedAt"),
                "digest": _sha(rec["digest"], f"snapshots[{i}].digest"),
            }
        )
    changes = []
    for i, row in enumerate(_list(obj["changes"], "changes")):
        rec = _exact(row, {"id", "sourceId", "beforeDigest", "afterDigest", "laborMinutes"}, f"changes[{i}]")
        if rec["beforeDigest"] == rec["afterDigest"]:
            raise ValidationError("change requires distinct before/after digests")
        sid = _str(rec["sourceId"], f"changes[{i}].sourceId", REF_RE)
        if sid not in sids:
            raise ValidationError("change unknown source")
        changes.append(
            {
                "id": _str(rec["id"], f"changes[{i}].id", REF_RE),
                "sourceId": sid,
                "beforeDigest": _sha(rec["beforeDigest"], f"changes[{i}].beforeDigest"),
                "afterDigest": _sha(rec["afterDigest"], f"changes[{i}].afterDigest"),
                "laborMinutes": _int(rec["laborMinutes"], f"changes[{i}].laborMinutes", minimum=1, maximum=10_080),
            }
        )
    commercial = _exact(
        obj["commercial"],
        {"status", "hypothesisMinor", "currency", "paymentLink"},
        "commercial",
    )
    if commercial["status"] != "PROPOSED_NOT_ACCEPTED":
        raise ValidationError("commercial.status must be PROPOSED_NOT_ACCEPTED")
    if commercial["paymentLink"] is not False:
        raise ValidationError("paymentLink must be false")
    if commercial["currency"] != "USD":
        raise ValidationError("currency must be USD")
    research = []
    for i, row in enumerate(_list(obj["researchAccounts"], "researchAccounts", maximum=20)):
        rec = _exact(row, {"id", "label", "firstPartyUrl", "posture"}, f"researchAccounts[{i}]")
        if rec["posture"] != "RESEARCH_ONLY_NO_OUTBOUND":
            raise ValidationError("research posture must be RESEARCH_ONLY_NO_OUTBOUND")
        url = _str(rec["firstPartyUrl"], f"researchAccounts[{i}].firstPartyUrl", HTTPS_RE, max_len=240)
        if "example.invalid" not in url:
            raise ValidationError("research URLs must stay synthetic")
        research.append(
            {
                "id": _str(rec["id"], f"researchAccounts[{i}].id", REF_RE),
                "label": _str(rec["label"], f"researchAccounts[{i}].label", LABEL_RE),
                "firstPartyUrl": url,
                "posture": "RESEARCH_ONLY_NO_OUTBOUND",
            }
        )
    return {
        "schema": SCHEMA,
        "pilotId": _str(obj["pilotId"], "pilotId", REF_RE),
        "asOfUtc": _utc(obj["asOfUtc"], "asOfUtc"),
        "intake": {
            "jurisdictions": jurisdictions,
            "sources": sources,
            "reviewOwners": owners,
            "retentionDays": _int(intake["retentionDays"], "retentionDays", minimum=1, maximum=365),
        },
        "snapshots": snapshots,
        "changes": changes,
        "commercial": {
            "status": "PROPOSED_NOT_ACCEPTED",
            "hypothesisMinor": _int(commercial["hypothesisMinor"], "hypothesisMinor", minimum=1),
            "currency": "USD",
            "paymentLink": False,
            "acceptedPriceMinor": 0,
        },
        "researchAccounts": research,
    }


def load_predecessor_readiness(root: Path | None = None) -> dict[str, Any]:
    path = (root or Path.cwd()) / READINESS_PATH
    data = load_json_file(path)
    if data.get("readyForSubmission") is not False:
        raise ValidationError("predecessor readyForSubmission must remain false")
    receipts = data.get("externalReceipts")
    if not isinstance(receipts, list) or not receipts:
        raise ValidationError("predecessor receipts missing")
    if any(r.get("status") != "OPEN" for r in receipts if r.get("required") is True):
        raise ValidationError("required predecessor receipts must remain OPEN")
    return {
        "readyForSubmission": False,
        "truthBoundary": data.get("truthBoundary"),
        "requiredReceiptsOpen": True,
    }


def compile_packet(raw: Any, *, repo_root: Path | None = None) -> dict[str, Any]:
    src = normalize(raw)
    predecessor = load_predecessor_readiness(repo_root)
    worksheet = []
    total_minutes = 0
    for change in src["changes"]:
        total_minutes += change["laborMinutes"]
        worksheet.append(
            {
                "changeId": change["id"],
                "sourceId": change["sourceId"],
                "beforeDigest": change["beforeDigest"],
                "afterDigest": change["afterDigest"],
                "laborMinutes": change["laborMinutes"],
                "kind": "SCENARIO_ONLY_NO_SAVINGS_NO_COMPLIANCE",
            }
        )
    snapshot_digests = sorted(s["digest"] for s in src["snapshots"])
    packet = {
        "schema": SCHEMA_PACKET,
        "pilotId": src["pilotId"],
        "asOfUtc": src["asOfUtc"],
        "intake": src["intake"],
        "acceptanceContract": {
            "boundSnapshotDigests": snapshot_digests,
            "ownerReviewRequired": True,
            "legalOrComplianceConclusion": False,
        },
        "laborWorksheet": {
            "rows": worksheet,
            "totalLaborMinutes": total_minutes,
            "savingsInferred": False,
            "complianceLossInferred": False,
        },
        "commercial": src["commercial"],
        "researchAccounts": src["researchAccounts"],
        "truthLedger": {
            "source": "SYNTHETIC_FIXTURE",
            "provider": "NOT_INVOKED",
            "deployment": "NOT_DEPLOYED",
            "customer": "NONE",
            "submission": "NOT_SUBMITTED",
            "prize": "NOT_CLAIMED",
            "outbound": "NOT_AUTHORIZED",
            "predecessor": predecessor,
        },
        "stopConditions": [
            "NO_LIVE_FIRECRAWL",
            "NO_LIVE_OPENAI",
            "NO_LIVE_AGENTMAIL",
            "NO_CONVEX_DEPLOY",
            "NO_BUYER_CONTACT",
            "NO_PAYMENT_LINK",
            "NO_SUBMISSION_OR_PRIZE",
        ],
        "authorityCeiling": CEILING,
        "commercialFlags": {
            "accepted": False,
            "paymentLink": False,
            "revenueRecognized": False,
            "savingsClaimed": False,
            "buyerContact": False,
            "liveProvider": False,
        },
    }
    _scan_forbidden(packet, "packet")
    if any(packet["commercialFlags"].values()):
        raise ValidationError("commercial flags must stay false")
    return packet


def build_artifacts(packet: dict[str, Any]) -> dict[str, bytes]:
    report = canonical_bytes(packet) + b"\n"
    receipt = canonical_bytes(
        {
            "schema": SCHEMA_RECEIPT,
            "packetSha256": sha256_hex(report),
            "packetDigest": sha256_hex(canonical_bytes(packet)),
            "readyForSubmission": False,
        }
    ) + b"\n"
    return {"packet.json": report, "receipt.json": receipt}


def write_exclusive(output_dir: str | os.PathLike[str], artifacts: dict[str, bytes]) -> None:
    root = Path(output_dir)
    if root.exists() and root.is_symlink():
        raise ValidationError("output symlink refused")
    root.mkdir(parents=True, exist_ok=True)
    created: list[Path] = []
    try:
        for name, data in artifacts.items():
            path = root / name
            if path.exists() or path.is_symlink():
                raise ValidationError(f"refusing overwrite: {name}")
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append(path)
            try:
                os.write(fd, data)
                os.fsync(fd)
            finally:
                os.close(fd)
    except Exception:
        for path in created:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
        raise


def verify(raw: Any, output_dir: str | os.PathLike[str], *, repo_root: Path | None = None) -> bool:
    try:
        expected = build_artifacts(compile_packet(raw, repo_root=repo_root))
        root = Path(output_dir)
        got = {name: (root / name).read_bytes() for name in expected}
        if got != expected:
            return False
        receipt = loads_strict(got["receipt.json"].decode("utf-8"))
        return receipt.get("readyForSubmission") is False
    except (ValidationError, OSError, UnicodeDecodeError, KeyError):
        return False


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="permitpulse_pilot")
    sub = p.add_subparsers(dest="command", required=True)
    c = sub.add_parser("compile")
    c.add_argument("input")
    c.add_argument("output_dir")
    v = sub.add_parser("verify")
    v.add_argument("input")
    v.add_argument("output_dir")
    args = p.parse_args(argv)
    try:
        raw = load_json_file(args.input)
        root = Path.cwd()
        if args.command == "compile":
            write_exclusive(args.output_dir, build_artifacts(compile_packet(raw, repo_root=root)))
        else:
            if not verify(raw, args.output_dir, repo_root=root):
                raise ValidationError("verify failed")
        return 0
    except (ValidationError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

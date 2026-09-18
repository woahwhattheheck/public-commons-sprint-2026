from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_EVEN, getcontext
from typing import Any, Iterable

getcontext().prec = 40

SCHEMA = "circularvalue.case/v1"
PACKET_SCHEMA = "circularvalue.packet/v1"
GENERATION = "circularvalue-2026-09-18.2"
CATEGORIES = {
    "direct_cash",
    "supply_chain_resilience",
    "resource_security",
    "customer_retention",
    "market_shock_exposure",
}
CONFIDENCE = {"observed", "modeled", "hypothesis"}
MAX_ABS_MINOR = 10**15
MAX_HORIZON_YEARS = 20


class CircularValueError(ValueError):
    pass


def _no_dupes(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise CircularValueError(f"duplicate key: {key}")
        out[key] = value
    return out


def loads_strict(text: str) -> Any:
    def reject_float(_: str) -> Any:
        raise CircularValueError("JSON floats are forbidden; use integer minor units/basis points")

    def reject_constant(_: str) -> Any:
        raise CircularValueError("non-finite JSON values are forbidden")

    try:
        return json.loads(
            text,
            object_pairs_hook=_no_dupes,
            parse_float=reject_float,
            parse_constant=reject_constant,
        )
    except CircularValueError:
        raise
    except Exception as exc:
        raise CircularValueError(f"invalid JSON: {exc}") from exc


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _exact_keys(obj: dict[str, Any], required: set[str], *, where: str) -> None:
    got = set(obj)
    if got != required:
        missing = sorted(required - got)
        extra = sorted(got - required)
        raise CircularValueError(f"{where} keys mismatch missing={missing} extra={extra}")


def _str(v: Any, *, where: str, max_len: int = 500) -> str:
    if type(v) is not str or not v.strip() or len(v) > max_len:
        raise CircularValueError(f"{where} must be non-empty string <= {max_len}")
    return v


def _int(v: Any, *, where: str, lo: int, hi: int) -> int:
    if type(v) is not int or not (lo <= v <= hi):
        raise CircularValueError(f"{where} must be integer in [{lo},{hi}]")
    return v


def _date(v: Any, *, where: str) -> date:
    s = _str(v, where=where, max_len=10)
    try:
        parsed = date.fromisoformat(s)
    except ValueError as exc:
        raise CircularValueError(f"{where} must be ISO date") from exc
    if parsed.isoformat() != s:
        raise CircularValueError(f"{where} must be canonical ISO date")
    return parsed


def _sha256(v: Any, *, where: str) -> str:
    s = _str(v, where=where, max_len=64)
    if len(s) != 64 or any(ch not in "0123456789abcdef" for ch in s):
        raise CircularValueError(f"{where} must be 64 lowercase hex characters")
    return s


def _money(v: Any, *, where: str, allow_negative: bool = True) -> int:
    lo = -MAX_ABS_MINOR if allow_negative else 0
    return _int(v, where=where, lo=lo, hi=MAX_ABS_MINOR)


def _decimal_money(d: Decimal) -> int:
    if not d.is_finite():
        raise CircularValueError("non-finite decimal")
    q = d.quantize(Decimal("1"), rounding=ROUND_HALF_EVEN)
    if q < -MAX_ABS_MINOR or q > MAX_ABS_MINOR:
        raise CircularValueError("computed monetary value exceeds bound")
    return int(q)


@dataclass(frozen=True)
class Evidence:
    evidence_id: str
    source_type: str
    locator: str
    sha256: str
    observed_on: date
    note: str


@dataclass(frozen=True)
class Lever:
    lever_id: str
    label: str
    category: str
    confidence: str
    low_minor: int
    central_minor: int
    high_minor: int
    evidence_ids: tuple[str, ...]


def _parse_case(raw: dict[str, Any]) -> dict[str, Any]:
    _exact_keys(
        raw,
        {
            "schema",
            "caseId",
            "evaluatedOn",
            "currency",
            "horizonYears",
            "discountRateBps",
            "maxEvidenceAgeDays",
            "oneOffCostMinor",
            "annualRecurringCostMinor",
            "evidence",
            "levers",
        },
        where="case",
    )
    if raw["schema"] != SCHEMA:
        raise CircularValueError("unsupported schema")
    case_id = _str(raw["caseId"], where="caseId", max_len=120)
    evaluated_on = _date(raw["evaluatedOn"], where="evaluatedOn")
    currency = _str(raw["currency"], where="currency", max_len=3)
    if len(currency) != 3 or currency.upper() != currency or not currency.isalpha():
        raise CircularValueError("currency must be 3 uppercase letters")
    horizon = _int(raw["horizonYears"], where="horizonYears", lo=1, hi=MAX_HORIZON_YEARS)
    rate_bps = _int(raw["discountRateBps"], where="discountRateBps", lo=0, hi=5000)
    max_age = _int(raw["maxEvidenceAgeDays"], where="maxEvidenceAgeDays", lo=0, hi=3650)
    one_off = _money(raw["oneOffCostMinor"], where="oneOffCostMinor", allow_negative=False)
    recurring = _money(raw["annualRecurringCostMinor"], where="annualRecurringCostMinor", allow_negative=False)

    if type(raw["evidence"]) is not list or not raw["evidence"]:
        raise CircularValueError("evidence must be non-empty list")
    evidence: dict[str, Evidence] = {}
    for idx, item in enumerate(raw["evidence"]):
        if type(item) is not dict:
            raise CircularValueError(f"evidence[{idx}] must be object")
        _exact_keys(item, {"id", "sourceType", "locator", "sha256", "observedOn", "note"}, where=f"evidence[{idx}]")
        eid = _str(item["id"], where=f"evidence[{idx}].id", max_len=100)
        if eid in evidence:
            raise CircularValueError(f"duplicate evidence id: {eid}")
        ev = Evidence(
            evidence_id=eid,
            source_type=_str(item["sourceType"], where=f"evidence[{idx}].sourceType", max_len=80),
            locator=_str(item["locator"], where=f"evidence[{idx}].locator", max_len=500),
            sha256=_sha256(item["sha256"], where=f"evidence[{idx}].sha256"),
            observed_on=_date(item["observedOn"], where=f"evidence[{idx}].observedOn"),
            note=_str(item["note"], where=f"evidence[{idx}].note", max_len=1000),
        )
        if ev.observed_on > evaluated_on:
            raise CircularValueError(f"future evidence: {eid}")
        evidence[eid] = ev

    if type(raw["levers"]) is not list or not raw["levers"]:
        raise CircularValueError("levers must be non-empty list")
    levers: list[Lever] = []
    seen_lever: set[str] = set()
    for idx, item in enumerate(raw["levers"]):
        if type(item) is not dict:
            raise CircularValueError(f"levers[{idx}] must be object")
        _exact_keys(
            item,
            {"id", "label", "category", "confidence", "lowMinor", "centralMinor", "highMinor", "evidenceIds"},
            where=f"levers[{idx}]",
        )
        lid = _str(item["id"], where=f"levers[{idx}].id", max_len=100)
        if lid in seen_lever:
            raise CircularValueError(f"duplicate lever id: {lid}")
        seen_lever.add(lid)
        cat = _str(item["category"], where=f"levers[{idx}].category", max_len=80)
        if cat not in CATEGORIES:
            raise CircularValueError(f"unsupported category: {cat}")
        confidence = _str(item["confidence"], where=f"levers[{idx}].confidence", max_len=20)
        if confidence not in CONFIDENCE:
            raise CircularValueError(f"unsupported confidence: {confidence}")
        low = _money(item["lowMinor"], where=f"levers[{idx}].lowMinor")
        central = _money(item["centralMinor"], where=f"levers[{idx}].centralMinor")
        high = _money(item["highMinor"], where=f"levers[{idx}].highMinor")
        if not (low <= central <= high):
            raise CircularValueError(f"lever {lid} requires low<=central<=high")
        refs = item["evidenceIds"]
        if type(refs) is not list or not refs:
            raise CircularValueError(f"lever {lid} must cite evidence")
        normalized: list[str] = []
        for ref in refs:
            ref_s = _str(ref, where=f"lever {lid}.evidenceId", max_len=100)
            if ref_s not in evidence:
                raise CircularValueError(f"lever {lid} cites unknown evidence {ref_s}")
            if ref_s in normalized:
                raise CircularValueError(f"lever {lid} repeats evidence {ref_s}")
            normalized.append(ref_s)
        levers.append(
            Lever(
                lever_id=lid,
                label=_str(item["label"], where=f"levers[{idx}].label", max_len=160),
                category=cat,
                confidence=confidence,
                low_minor=low,
                central_minor=central,
                high_minor=high,
                evidence_ids=tuple(normalized),
            )
        )

    return {
        "case_id": case_id,
        "evaluated_on": evaluated_on,
        "currency": currency,
        "horizon": horizon,
        "rate_bps": rate_bps,
        "max_age": max_age,
        "one_off": one_off,
        "recurring": recurring,
        "evidence": evidence,
        "levers": tuple(levers),
    }


def _pv_factor(year: int, rate_bps: int) -> Decimal:
    rate = Decimal(rate_bps) / Decimal(10_000)
    return Decimal(1) / ((Decimal(1) + rate) ** year)


def _npv(annual_minor: int, recurring_minor: int, one_off_minor: int, horizon: int, rate_bps: int) -> int:
    total = Decimal(-one_off_minor)
    annual_net = Decimal(annual_minor - recurring_minor)
    for year in range(1, horizon + 1):
        total += annual_net * _pv_factor(year, rate_bps)
    return _decimal_money(total)


def _simple_payback_months(annual_minor: int, recurring_minor: int, one_off_minor: int) -> int | None:
    annual_net = annual_minor - recurring_minor
    if one_off_minor == 0:
        return 0 if annual_net >= 0 else None
    if annual_net <= 0:
        return None
    months = (Decimal(one_off_minor) * Decimal(12) / Decimal(annual_net)).quantize(Decimal("1"), rounding=ROUND_HALF_EVEN)
    return int(months)


def compile_case(raw: dict[str, Any]) -> dict[str, Any]:
    parsed = _parse_case(raw)
    evaluated_on: date = parsed["evaluated_on"]
    evidence: dict[str, Evidence] = parsed["evidence"]
    levers: tuple[Lever, ...] = parsed["levers"]

    stale_ids = sorted(
        eid
        for eid, ev in evidence.items()
        if (evaluated_on - ev.observed_on).days > parsed["max_age"]
    )
    hypothesis_levers = sorted(x.lever_id for x in levers if x.confidence == "hypothesis")
    modeled_levers = sorted(x.lever_id for x in levers if x.confidence == "modeled")

    low_annual = sum(x.low_minor for x in levers)
    central_annual = sum(x.central_minor for x in levers)
    high_annual = sum(x.high_minor for x in levers)
    low_npv = _npv(low_annual, parsed["recurring"], parsed["one_off"], parsed["horizon"], parsed["rate_bps"])
    central_npv = _npv(central_annual, parsed["recurring"], parsed["one_off"], parsed["horizon"], parsed["rate_bps"])
    high_npv = _npv(high_annual, parsed["recurring"], parsed["one_off"], parsed["horizon"], parsed["rate_bps"])

    sensitivity = sorted(
        (
            {
                "leverId": x.lever_id,
                "category": x.category,
                "spreadMinor": x.high_minor - x.low_minor,
                "lowMinor": x.low_minor,
                "centralMinor": x.central_minor,
                "highMinor": x.high_minor,
                "confidence": x.confidence,
            }
            for x in levers
        ),
        key=lambda row: (-row["spreadMinor"], row["leverId"]),
    )

    if stale_ids:
        state = "HUMAN_REVIEW_STALE_EVIDENCE"
    elif hypothesis_levers:
        state = "HUMAN_REVIEW_HYPOTHESIS"
    elif low_npv > 0:
        state = "EVIDENCE_POSITIVE_ACROSS_RANGE"
    elif central_npv > 0:
        state = "EXPLORE_SENSITIVITY"
    else:
        state = "HOLD_NO_POSITIVE_CENTRAL_CASE"

    category_totals = {}
    for category in sorted(CATEGORIES):
        rows = [x for x in levers if x.category == category]
        if rows:
            category_totals[category] = {
                "lowMinor": sum(x.low_minor for x in rows),
                "centralMinor": sum(x.central_minor for x in rows),
                "highMinor": sum(x.high_minor for x in rows),
                "leverIds": sorted(x.lever_id for x in rows),
            }

    evidence_rows = [
        {
            "id": ev.evidence_id,
            "sourceType": ev.source_type,
            "locator": ev.locator,
            "sha256": ev.sha256,
            "observedOn": ev.observed_on.isoformat(),
            "note": ev.note,
        }
        for _, ev in sorted(evidence.items())
    ]
    lever_rows = [
        {
            "id": x.lever_id,
            "label": x.label,
            "category": x.category,
            "confidence": x.confidence,
            "lowMinor": x.low_minor,
            "centralMinor": x.central_minor,
            "highMinor": x.high_minor,
            "evidenceIds": list(x.evidence_ids),
        }
        for x in sorted(levers, key=lambda row: row.lever_id)
    ]

    source_digest = digest_json(raw)
    payload = {
        "schema": PACKET_SCHEMA,
        "generation": GENERATION,
        "caseId": parsed["case_id"],
        "evaluatedOn": evaluated_on.isoformat(),
        "currency": parsed["currency"],
        "sourceCaseSha256": source_digest,
        "assumptions": {
            "horizonYears": parsed["horizon"],
            "discountRateBps": parsed["rate_bps"],
            "maxEvidenceAgeDays": parsed["max_age"],
            "oneOffCostMinor": parsed["one_off"],
            "annualRecurringCostMinor": parsed["recurring"],
        },
        "evidence": evidence_rows,
        "levers": lever_rows,
        "categoryTotals": category_totals,
        "annualValue": {"lowMinor": low_annual, "centralMinor": central_annual, "highMinor": high_annual},
        "npv": {"lowMinor": low_npv, "centralMinor": central_npv, "highMinor": high_npv},
        "simplePaybackMonthsCentral": _simple_payback_months(central_annual, parsed["recurring"], parsed["one_off"]),
        "sensitivity": sensitivity,
        "quality": {
            "staleEvidenceIds": stale_ids,
            "hypothesisLeverIds": hypothesis_levers,
            "modeledLeverIds": modeled_levers,
        },
        "decisionSupportState": state,
        "authority": {
            "investmentRecommendation": False,
            "environmentalCertification": False,
            "accountingConclusion": False,
            "externalAction": False,
            "fundsMovement": False,
        },
    }
    packet = dict(payload)
    packet["packetSha256"] = digest_json(payload)
    return packet


def verify_packet(raw_case: dict[str, Any], packet: dict[str, Any]) -> bool:
    if type(packet) is not dict:
        return False
    if set(packet) != {
        "schema", "generation", "caseId", "evaluatedOn", "currency", "sourceCaseSha256", "assumptions",
        "evidence", "levers", "categoryTotals", "annualValue", "npv", "simplePaybackMonthsCentral",
        "sensitivity", "quality", "decisionSupportState", "authority", "packetSha256"
    }:
        return False
    supplied = packet.get("packetSha256")
    if type(supplied) is not str or len(supplied) != 64:
        return False
    body = dict(packet)
    body.pop("packetSha256", None)
    if digest_json(body) != supplied:
        return False
    try:
        rebuilt = compile_case(raw_case)
    except CircularValueError:
        return False
    return rebuilt == packet


def _build_verifier_generation():
    from types import FunctionType

    frozen_globals: dict[str, Any] = {
        "__builtins__": __builtins__,
        "hashlib": hashlib,
        "json": json,
        "date": date,
        "datetime": datetime,
        "Decimal": Decimal,
        "ROUND_HALF_EVEN": ROUND_HALF_EVEN,
        "CircularValueError": CircularValueError,
        "Evidence": Evidence,
        "Lever": Lever,
        "SCHEMA": SCHEMA,
        "PACKET_SCHEMA": PACKET_SCHEMA,
        "GENERATION": GENERATION,
        "CATEGORIES": frozenset(CATEGORIES),
        "CONFIDENCE": frozenset(CONFIDENCE),
        "MAX_ABS_MINOR": MAX_ABS_MINOR,
        "MAX_HORIZON_YEARS": MAX_HORIZON_YEARS,
    }

    def clone(fn):
        cloned = FunctionType(
            fn.__code__,
            frozen_globals,
            name=fn.__name__,
            argdefs=fn.__defaults__,
            closure=fn.__closure__,
        )
        if fn.__kwdefaults__:
            cloned.__kwdefaults__ = dict(fn.__kwdefaults__)
        frozen_globals[fn.__name__] = cloned
        return cloned

    for fn in (
        canonical_json,
        digest_json,
        _exact_keys,
        _str,
        _int,
        _date,
        _sha256,
        _money,
        _decimal_money,
        _parse_case,
        _pv_factor,
        _npv,
        _simple_payback_months,
    ):
        clone(fn)
    frozen_compile = clone(compile_case)
    frozen_digest = frozen_globals["digest_json"]
    return frozen_compile, frozen_digest


def _make_frozen_verifier(frozen_compile, frozen_digest, error_type):
    expected_keys = frozenset({
        "schema", "generation", "caseId", "evaluatedOn", "currency", "sourceCaseSha256", "assumptions",
        "evidence", "levers", "categoryTotals", "annualValue", "npv", "simplePaybackMonthsCentral",
        "sensitivity", "quality", "decisionSupportState", "authority", "packetSha256",
    })

    def frozen_verify(raw_case: dict[str, Any], packet: dict[str, Any]) -> bool:
        if type(packet) is not dict or frozenset(packet) != expected_keys:
            return False
        supplied = packet.get("packetSha256")
        if type(supplied) is not str or len(supplied) != 64:
            return False
        body = dict(packet)
        body.pop("packetSha256", None)
        if frozen_digest(body) != supplied:
            return False
        try:
            rebuilt = frozen_compile(raw_case)
        except error_type:
            return False
        return rebuilt == packet

    return frozen_verify


_frozen_compile_generation, _frozen_digest_generation = _build_verifier_generation()
verify_packet = _make_frozen_verifier(
    _frozen_compile_generation,
    _frozen_digest_generation,
    CircularValueError,
)
del _frozen_compile_generation, _frozen_digest_generation

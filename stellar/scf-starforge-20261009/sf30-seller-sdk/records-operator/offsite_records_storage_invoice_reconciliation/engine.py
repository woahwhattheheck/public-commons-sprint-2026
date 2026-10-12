from __future__ import annotations

import hashlib
import json
import math
import os
import re
import stat
from fractions import Fraction
from datetime import datetime, timezone
from typing import Any, Callable, Optional, Union

SCHEMA = "OFFSITE_RECORDS_STORAGE_INVOICE_RECONCILIATION_V1"
PACKET_SCHEMA = "OFFSITE_RECORDS_STORAGE_INVOICE_RECONCILIATION_PACKET_V1"
SCHEMA_V2 = "OFFSITE_RECORDS_STORAGE_INVOICE_RECONCILIATION_V2"
PACKET_SCHEMA_V2 = "OFFSITE_RECORDS_STORAGE_INVOICE_RECONCILIATION_PACKET_V2"
MODE_CURRENT = "CURRENT_OWNER_REVIEW"
MODE_HISTORICAL = "HISTORICAL_INTEGRITY_ONLY"
MAX_FILE_BYTES = 12 * 1024 * 1024
MAX_ROWS = 10_000
MAX_CARTONS = 2_500
MAX_SITES = 100
MAX_RATES = 512
MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAX_REVIEW_DAYS = 90
CURRENT_PACKET_MAX_AGE_SECONDS = 900
_REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$")
_CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{0,47}$")
_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
_SHA_RE = re.compile(r"^[0-9a-f]{64}$")
_UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_SCOPE_VALUES = {"CARTON", "ACCOUNT"}
_TERMINATION_VALUES = {"WITHDRAWN", "DESTROYED"}


class InputError(ValueError):
    pass


def _bind_time_primitives() -> tuple[Callable[[str, str], str], Callable[[str], Any], Callable[[], str]]:
    dt_cls = datetime
    utc = timezone.utc

    def parse_utc(value: str, label: str) -> str:
        if type(value) is not str or not _UTC_RE.fullmatch(value):
            raise InputError(f"{label} must be canonical whole-second UTC")
        try:
            parsed = dt_cls.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=utc)
        except ValueError as exc:
            raise InputError(f"{label} invalid UTC") from exc
        if parsed.strftime("%Y-%m-%dT%H:%M:%SZ") != value:
            raise InputError(f"{label} noncanonical UTC")
        return value

    def as_dt(value: str) -> Any:
        return dt_cls.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=utc)

    def now_utc() -> str:
        return dt_cls.now(utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")

    return parse_utc, as_dt, now_utc


_utc, _dt, _process_now_utc = _bind_time_primitives()


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _pairs_no_dupes(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise InputError(f"duplicate JSON key: {key}")
        out[key] = value
    return out


def _reject_constant(value: str) -> None:
    raise InputError(f"non-finite JSON number: {value}")


def parse_json_strict(text: str) -> Any:
    try:
        return json.loads(text, object_pairs_hook=_pairs_no_dupes, parse_constant=_reject_constant)
    except InputError:
        raise
    except (json.JSONDecodeError, UnicodeError) as exc:
        raise InputError(f"invalid JSON: {exc}") from exc


def read_json_file(path: Union[str, os.PathLike[str]]) -> Any:
    p = os.fspath(path)
    try:
        before = os.lstat(p)
    except OSError as exc:
        raise InputError(f"input unavailable: {exc}") from exc
    if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise InputError("input must be a single-link ordinary file")
    if before.st_size <= 0 or before.st_size > MAX_FILE_BYTES:
        raise InputError("input file size outside allowed bounds")
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    if hasattr(os, "O_NONBLOCK"):
        flags |= os.O_NONBLOCK
    try:
        fd = os.open(p, flags)
    except OSError as exc:
        raise InputError(f"cannot open input safely: {exc}") from exc
    try:
        first = os.fstat(fd)
        if not stat.S_ISREG(first.st_mode) or first.st_nlink != 1:
            raise InputError("input descriptor must remain a single-link ordinary file")
        if (first.st_dev, first.st_ino, first.st_size) != (before.st_dev, before.st_ino, before.st_size):
            raise InputError("input path changed before capture")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(fd, min(65536, MAX_FILE_BYTES + 1 - total))
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_FILE_BYTES:
                raise InputError("input exceeds size bound")
            chunks.append(chunk)
        after = os.fstat(fd)
        before_id = (first.st_dev, first.st_ino, first.st_mode, first.st_nlink, first.st_size, first.st_mtime_ns, first.st_ctime_ns)
        after_id = (after.st_dev, after.st_ino, after.st_mode, after.st_nlink, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
        if before_id != after_id or total != first.st_size:
            raise InputError("input changed during capture")
    finally:
        os.close(fd)
    try:
        visible = os.lstat(p)
    except OSError as exc:
        raise InputError(f"input path disappeared after capture: {exc}") from exc
    if stat.S_ISLNK(visible.st_mode) or not stat.S_ISREG(visible.st_mode) or (visible.st_dev, visible.st_ino, visible.st_size) != (first.st_dev, first.st_ino, first.st_size):
        raise InputError("input path changed after capture")
    try:
        return parse_json_strict(b"".join(chunks).decode("utf-8", errors="strict"))
    except UnicodeDecodeError as exc:
        raise InputError("input is not valid UTF-8") from exc


def _write_exclusive_bytes(path: Union[str, os.PathLike[str]], data: bytes) -> tuple[int, int]:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(os.fspath(path), flags, 0o600)
    try:
        offset = 0
        while offset < len(data):
            offset += os.write(fd, data[offset:])
        os.fsync(fd)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise InputError("output did not remain a single-link ordinary file")
        return info.st_dev, info.st_ino
    finally:
        os.close(fd)


def write_outputs_exclusive(outputs: list[tuple[Union[str, os.PathLike[str]], str]]) -> None:
    if not outputs:
        raise InputError("no outputs requested")
    canonical_paths = [os.path.abspath(os.fspath(path)) for path, _ in outputs]
    if len(set(canonical_paths)) != len(canonical_paths):
        raise InputError("output paths must be distinct")
    for path in canonical_paths:
        if os.path.lexists(path):
            raise InputError(f"output already exists: {path}")
        parent = os.path.dirname(path) or "."
        if not os.path.isdir(parent) or os.path.islink(parent):
            raise InputError(f"output parent must be an ordinary directory: {parent}")
    created: list[tuple[str, tuple[int, int]]] = []
    try:
        for (path, text), canonical_path in zip(outputs, canonical_paths):
            ident = _write_exclusive_bytes(path, text.encode("utf-8"))
            created.append((canonical_path, ident))
    except (OSError, InputError) as exc:
        for path, ident in reversed(created):
            try:
                info = os.lstat(path)
                if stat.S_ISREG(info.st_mode) and (info.st_dev, info.st_ino) == ident:
                    os.unlink(path)
            except OSError:
                pass
        if isinstance(exc, InputError):
            raise
        raise InputError(f"output publication failed: {exc}") from exc


def _exact_keys(value: dict[str, Any], required: set[str], optional: set[str] = frozenset()) -> None:
    keys = set(value)
    missing = required - keys
    extra = keys - required - optional
    if missing or extra:
        raise InputError(f"schema keys mismatch; missing={sorted(missing)}, extra={sorted(extra)}")


def _dict(value: Any, label: str) -> dict[str, Any]:
    if type(value) is not dict:
        raise InputError(f"{label} must be an object")
    return value


def _list(value: Any, label: str, maximum: int) -> list[Any]:
    if type(value) is not list or len(value) > maximum:
        raise InputError(f"{label} must be an array of at most {maximum}")
    return value


def _bool(value: Any, label: str) -> bool:
    if type(value) is not bool:
        raise InputError(f"{label} must be boolean")
    return value


def _int(value: Any, label: str, minimum: int = 0, maximum: int = MAX_SAFE_INTEGER) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise InputError(f"{label} must be an integer in [{minimum}, {maximum}]")
    return value


def _ref(value: Any, label: str) -> str:
    if type(value) is not str or not _REF_RE.fullmatch(value):
        raise InputError(f"{label} must be a bounded opaque reference")
    low = value.lower()
    if any(word in low for word in ("password", "secret", "apikey", "api_key", "bearer", "token=")):
        raise InputError(f"{label} looks secret-shaped")
    return value


def _code(value: Any, label: str) -> str:
    if type(value) is not str or not _CODE_RE.fullmatch(value):
        raise InputError(f"{label} must be an uppercase code")
    return value


def _currency(value: Any) -> str:
    if type(value) is not str or not _CURRENCY_RE.fullmatch(value):
        raise InputError("currency must be a three-letter uppercase code")
    return value


def _sha(value: Any, label: str) -> str:
    if type(value) is not str or not _SHA_RE.fullmatch(value):
        raise InputError(f"{label} must be lowercase SHA-256")
    return value


def _optional_ref(value: Any, label: str) -> Optional[str]:
    return None if value is None else _ref(value, label)


def _evidence(value: Any, label: str) -> dict[str, str]:
    obj = _dict(value, label)
    _exact_keys(obj, {"evidence_ref", "evidence_sha256"})
    return {
        "evidence_ref": _ref(obj["evidence_ref"], f"{label}.evidence_ref"),
        "evidence_sha256": _sha(obj["evidence_sha256"], f"{label}.evidence_sha256"),
    }


def _checked_add(a: int, b: int) -> int:
    value = a + b
    if abs(value) > MAX_SAFE_INTEGER:
        raise InputError("money arithmetic exceeds safe integer")
    return value


def _checked_product(a: int, b: int) -> int:
    value = a * b
    if abs(value) > MAX_SAFE_INTEGER:
        raise InputError("money arithmetic exceeds safe integer")
    return value


def _active(at: str, start: str, end: Optional[str]) -> bool:
    point = _dt(at)
    return _dt(start) <= point and (end is None or point < _dt(end))


def _normalize_common_generation(raw: Any, label: str) -> dict[str, Any]:
    obj = _dict(raw, label)
    return obj



# V2 keeps V1's custody/event reconciliation and adds exact contract arithmetic.
# Values stay decimal text until Fraction calculation; no binary float is used.
_ROUNDING_MODES = {"EXACT", "HALF_UP", "HALF_EVEN", "DOWN", "UP"}
_DECIMAL_RE = re.compile(r"^\d+(?:\.\d{1,18})?$")


def _decimal(value: Any, label: str, positive: bool = False) -> str:
    if type(value) is int:
        value = str(value)
    if type(value) is not str or len(value) > 80 or not _DECIMAL_RE.fullmatch(value):
        raise InputError(f"{label} must be unsigned decimal text with at most 18 fractional places")
    whole, dot, fraction = value.partition(".")
    whole = whole.lstrip("0") or "0"
    fraction = fraction.rstrip("0")
    normalized = whole + ("." + fraction if fraction else "")
    number = Fraction(normalized)
    if number > MAX_SAFE_INTEGER or (positive and number <= 0):
        raise InputError(f"{label} is outside its declared numeric bounds")
    return normalized


def _rounding_mode(value: Any) -> str:
    if type(value) is not str or value not in _ROUNDING_MODES:
        raise InputError("rounding_mode must be EXACT, HALF_UP, HALF_EVEN, DOWN or UP")
    return value


def _fraction_text(value: Fraction) -> str:
    if not value:
        return "0"
    sign = "-" if value < 0 else ""
    n, d = abs(value.numerator), value.denominator
    whole, remainder = divmod(n, d)
    places: list[str] = []
    while remainder:
        if len(places) >= 80:
            return f"{value.numerator}/{value.denominator}"
        digit, remainder = divmod(remainder * 10, d)
        places.append(str(digit))
    return sign + str(whole) + ("." + "".join(places) if places else "")


def _round_minor(value: Fraction, mode: str) -> Optional[int]:
    negative = value < 0
    whole, remainder = divmod(abs(value.numerator), value.denominator)
    if remainder and mode == "EXACT":
        return None
    increase = remainder and (
        mode == "UP"
        or mode == "HALF_UP" and remainder * 2 >= value.denominator
        or mode == "HALF_EVEN" and (
            remainder * 2 > value.denominator
            or remainder * 2 == value.denominator and whole % 2 == 1
        )
    )
    result = (whole + int(bool(increase))) * (-1 if negative else 1)
    if abs(result) > MAX_SAFE_INTEGER:
        raise InputError("rounded money exceeds safe integer")
    return result


def _normalize_pricing(raw: Any) -> dict[str, Any]:
    p = _dict(raw, "rate.pricing")
    _exact_keys(p, {"kind"}, {"minimum_minor", "maximum_minor", "percent", "basis_scope", "basis_charge_codes", "tiers", "credit_method"})
    kind = p["kind"]
    if type(kind) is not str or kind not in {"unit", "fixed", "percentage", "graduated", "volume"}:
        raise InputError("unsupported original pricing kind")
    result = {"kind": kind,
              "minimum_minor": None if p.get("minimum_minor") is None else _int(p["minimum_minor"], "pricing.minimum_minor"),
              "maximum_minor": None if p.get("maximum_minor") is None else _int(p["maximum_minor"], "pricing.maximum_minor")}
    result["credit_method"] = p.get("credit_method", "UNSPECIFIED")
    if type(result["credit_method"]) is not str or result["credit_method"] not in {"UNSPECIFIED", "CONTRACT_QUANTITY", "ORIGINAL_PROPORTION"}:
        raise InputError("pricing.credit_method must explicitly select CONTRACT_QUANTITY or ORIGINAL_PROPORTION when applicable")
    if result["minimum_minor"] is not None and result["maximum_minor"] is not None and result["minimum_minor"] > result["maximum_minor"]:
        raise InputError("pricing minimum exceeds maximum")
    if kind == "percentage":
        if "percent" not in p or "basis_charge_codes" not in p:
            raise InputError("percentage pricing needs its declared percent and included charge codes")
        result["percent"] = _decimal(p["percent"], "pricing.percent")
        result["basis_scope"] = p.get("basis_scope", "INVOICE")
        if type(result["basis_scope"]) is not str or result["basis_scope"] not in {"INVOICE", "PERIOD"}:
            raise InputError("percentage basis_scope must be INVOICE or PERIOD")
        codes = [_code(x, "pricing.basis_charge_codes") for x in _list(p["basis_charge_codes"], "pricing.basis_charge_codes", MAX_RATES)]
        if not codes or len(set(codes)) != len(codes):
            raise InputError("percentage pricing needs distinct explicit included charge codes")
        result["basis_charge_codes"] = sorted(codes)
    elif any(key in p for key in ("percent", "basis_scope", "basis_charge_codes")):
        raise InputError("percentage fields require percentage pricing")
    if kind in {"graduated", "volume"}:
        tiers = []
        previous = Fraction(0)
        for index, item in enumerate(_list(p.get("tiers"), "pricing.tiers", MAX_RATES)):
            row = _dict(item, "pricing.tier")
            _exact_keys(row, {"upto", "rate_minor"})
            upper = None if row["upto"] is None else _decimal(row["upto"], "tier.upto", positive=True)
            if upper is None and index != len(p["tiers"]) - 1:
                raise InputError("an unbounded tier must be last")
            if upper is not None and Fraction(upper) <= previous:
                raise InputError("tier bounds must strictly increase")
            tiers.append({"upto": upper, "rate_minor": _decimal(row["rate_minor"], "tier.rate_minor")})
            if upper is not None:
                previous = Fraction(upper)
        if not tiers:
            raise InputError("tier pricing needs actual tiers")
        result["tiers"] = tiers
    elif "tiers" in p:
        raise InputError("tiers require graduated or volume pricing")
    return result


def _invoice_extension(row: dict[str, Any]) -> dict[str, Any]:
    kind = row.get("line_kind", "CHARGE")
    role = row.get("row_role", "BILLED")
    if type(kind) is not str or type(role) is not str or kind not in {"CHARGE", "CREDIT"} or role not in {"BILLED", "REFERENCE"}:
        raise InputError("invoice line_kind or row_role is unsupported")
    amount = _int(row["amount_minor"], "invoice.amount_minor", -MAX_SAFE_INTEGER)
    if kind == "CHARGE" and amount < 0 or kind == "CREDIT" and amount > 0:
        raise InputError("invoice amount sign differs from its explicit line_kind")
    credit_of = _optional_ref(row.get("credit_of"), "invoice.credit_of")
    if kind != "CREDIT" and credit_of is not None:
        raise InputError("credit_of requires line_kind CREDIT")
    ids = [_ref(x, "invoice.basis_row_ids") for x in _list(row.get("basis_row_ids", []), "invoice.basis_row_ids", MAX_ROWS)]
    if len(set(ids)) != len(ids):
        raise InputError("invoice percentage basis repeats a row")
    return {
        "line_kind": kind, "row_role": role, "credit_of": credit_of,
        "basis_row_ids": sorted(ids),
        "billed_at": _utc(row.get("billed_at", row["service_at"]), "invoice.billed_at"),
        "billed_percent": None if row.get("billed_percent") is None else _decimal(row["billed_percent"], "invoice.billed_percent"),
    }


def _price_calculation(row: dict[str, Any], rate: dict[str, Any], policy: dict[str, Any],
                       invoices: dict[str, dict[str, Any]]) -> tuple[dict[str, Any], list[str]]:
    p = rate["pricing"]
    kind = p["kind"]
    quantity = Fraction(row["quantity"])
    states: list[str] = []
    basis = []
    exact: Optional[Fraction] = None
    credit_method = p["credit_method"]
    proportional_credit = row["line_kind"] == "CREDIT" and credit_method == "ORIGINAL_PROPORTION"
    proportional_basis = None
    if proportional_credit:
        original = invoices.get(row["credit_of"])
        if original is None or original.get("line_kind", "CHARGE") != "CHARGE":
            states.append("CREDIT_ORIGINAL_NOT_INCLUDED_REVIEW")
        else:
            proportional_basis = {"row_id": original["row_id"], "amount_minor": original["amount_minor"],
                                  "quantity": original["quantity"]}
            exact = Fraction(original["amount_minor"]) * quantity / Fraction(original["quantity"])
    elif kind == "percentage":
        if not row["basis_row_ids"]:
            states.append("PERCENTAGE_BASIS_MISSING_REVIEW")
        for ref in row["basis_row_ids"]:
            original = invoices.get(ref)
            if original is None:
                states.append("PERCENTAGE_BASIS_ROW_MISSING_REVIEW")
                continue
            if ref == row["row_id"] or original.get("basis_row_ids"):
                # Nested fee bases need their own explicitly agreed pricing rule;
                # do not silently count circular or fee-on-fee billing.
                states.append("PERCENTAGE_NESTED_BASIS_REVIEW")
            if original.get("row_role", "BILLED") != "BILLED":
                states.append("PERCENTAGE_REFERENCE_BASIS_REVIEW")
            if original["charge_code"] not in p["basis_charge_codes"]:
                states.append("PERCENTAGE_BASIS_CODE_REVIEW")
            if p["basis_scope"] == "INVOICE" and original["invoice_ref"] != row["invoice_ref"]:
                states.append("PERCENTAGE_INVOICE_SCOPE_REVIEW")
            at = original.get("billed_at", original["service_at"])
            if not (_dt(policy["period_start"]) <= _dt(at) < _dt(policy["period_end"])):
                states.append("PERCENTAGE_PERIOD_SCOPE_REVIEW")
            basis.append({"row_id": ref, "amount_minor": original["amount_minor"]})
        base = _checked_sum(item["amount_minor"] for item in basis)
        if base < 0:
            states.append("NEGATIVE_PERCENTAGE_BASIS_REVIEW")
        if not states:
            fee = calculate_percentage_fee(basis, p["percent"], policy["rounding_mode"])
            exact = Fraction(fee["unrounded_minor"])
        if row["billed_percent"] is not None and Fraction(row["billed_percent"]) != Fraction(p["percent"]):
            states.append("PERCENTAGE_RATE_VARIANCE_REVIEW")
    elif kind == "fixed":
        exact = Fraction(rate["rate_minor"])
    elif kind == "unit":
        exact = quantity * Fraction(rate["rate_minor"])
    else:
        previous = Fraction(0)
        amount = Fraction(0)
        remaining = quantity
        for tier in p["tiers"]:
            upper = None if tier["upto"] is None else Fraction(tier["upto"])
            if kind == "volume":
                if upper is None or quantity <= upper:
                    amount = quantity * Fraction(tier["rate_minor"])
                    remaining = Fraction(0)
                    break
            else:
                units = remaining if upper is None else min(remaining, upper - previous)
                amount += units * Fraction(tier["rate_minor"])
                remaining -= units
                if not remaining:
                    break
            if upper is not None:
                previous = upper
        if remaining:
            states.append("PRICING_TIER_COVERAGE_REVIEW")
        else:
            exact = amount
    if row["line_kind"] == "CREDIT" and credit_method == "UNSPECIFIED":
        states.append("CREDIT_METHOD_UNDECLARED_REVIEW")
        exact = None
    bounded = exact
    if bounded is not None:
        if not proportional_credit and p["minimum_minor"] is not None:
            bounded = max(bounded, Fraction(p["minimum_minor"]))
        if not proportional_credit and p["maximum_minor"] is not None:
            bounded = min(bounded, Fraction(p["maximum_minor"]))
        if row["line_kind"] == "CREDIT":
            bounded = -bounded
    expected = None if bounded is None else _round_minor(bounded, policy["rounding_mode"])
    if bounded is not None and expected is None:
        states.append("FRACTIONAL_MINOR_UNIT_REVIEW")
    calculation = {
        "pricing_kind": kind, "credit_method": credit_method if row["line_kind"] == "CREDIT" else None,
        "quantity": row["quantity"], "contract_rate_minor": rate["rate_minor"],
        "percent": p.get("percent"), "basis_rows": basis, "proportional_basis": proportional_basis,
        "unrounded_minor": None if exact is None else _fraction_text(exact),
        "after_limits_and_sign_minor": None if bounded is None else _fraction_text(bounded),
        "rounding_mode": policy["rounding_mode"], "expected_amount_minor": expected,
        "rounding_applied": bounded is not None and expected is not None and bounded != expected,
        "minimum_minor": p["minimum_minor"], "maximum_minor": p["maximum_minor"],
    }
    if kind == "unit" and row["rate_minor"] is not None and not proportional_credit:
        invoice_exact = quantity * Fraction(row["rate_minor"]) * (-1 if row["line_kind"] == "CREDIT" else 1)
        invoice_rounded = _round_minor(invoice_exact, policy["rounding_mode"])
        calculation["billed_extension_unrounded_minor"] = _fraction_text(invoice_exact)
        calculation["billed_extension_minor"] = invoice_rounded
        if invoice_rounded is None:
            states.append("FRACTIONAL_INVOICE_EXTENSION_REVIEW")
        elif p["minimum_minor"] is None and p["maximum_minor"] is None and row["amount_minor"] != invoice_rounded:
            states.append("EXTENSION_VARIANCE_REVIEW")
    if expected is not None and row["amount_minor"] != expected:
        states.append("EXTENSION_VARIANCE_REVIEW")
    if kind in {"unit", "fixed"} and not proportional_credit:
        if row["rate_minor"] is None:
            states.append("INVOICE_RATE_MISSING_REVIEW")
        elif Fraction(row["rate_minor"]) != Fraction(rate["rate_minor"]):
            states.append("RATE_VARIANCE_REVIEW")
    return calculation, states


def _normalize_policy(raw: Any, extended: bool = False) -> dict[str, Any]:
    p = _normalize_common_generation(raw, "policy")
    _exact_keys(p, {"authority_id", "entity_ref", "provider_ref", "currency", "period_start", "period_end", "captured_at", "max_authority_age_days", "complete", "sites", "rates", "evidence"} | ({"minor_unit_digits", "rounding_mode"} if extended else set()))
    period_start = _utc(p["period_start"], "policy.period_start")
    period_end = _utc(p["period_end"], "policy.period_end")
    if _dt(period_end) <= _dt(period_start):
        raise InputError("review period must be nonempty")
    if (_dt(period_end) - _dt(period_start)).total_seconds() > MAX_REVIEW_DAYS * 86400:
        raise InputError(f"review period exceeds {MAX_REVIEW_DAYS} days")

    sites: list[dict[str, Any]] = []
    seen_sites: set[str] = set()
    for idx, item in enumerate(_list(p["sites"], "policy.sites", MAX_SITES)):
        row = _dict(item, f"policy.sites[{idx}]")
        _exact_keys(row, {"site_ref", "active_from", "active_until"})
        site_ref = _ref(row["site_ref"], "site.site_ref")
        if site_ref in seen_sites:
            raise InputError("duplicate site_ref")
        seen_sites.add(site_ref)
        start = _utc(row["active_from"], "site.active_from")
        end = None if row["active_until"] is None else _utc(row["active_until"], "site.active_until")
        if end is not None and _dt(end) <= _dt(start):
            raise InputError("invalid site active interval")
        sites.append({"site_ref": site_ref, "active_from": start, "active_until": end})

    rates: list[dict[str, Any]] = []
    for idx, item in enumerate(_list(p["rates"], "policy.rates", MAX_RATES)):
        row = _dict(item, f"policy.rates[{idx}]")
        _exact_keys(row, {"charge_code", "unit", "scope", "rate_minor", "event_required", "effective_from", "effective_until"}, {"pricing"} if extended else set())
        pricing = _normalize_pricing(row.get("pricing", {"kind": "unit"})) if extended else None
        scope = row["scope"]
        if type(scope) is not str or scope not in _SCOPE_VALUES:
            raise InputError("rate.scope must be CARTON or ACCOUNT")
        start = _utc(row["effective_from"], "rate.effective_from")
        end = None if row["effective_until"] is None else _utc(row["effective_until"], "rate.effective_until")
        if end is not None and _dt(end) <= _dt(start):
            raise InputError("invalid rate interval")
        rates.append({
            "charge_code": _code(row["charge_code"], "rate.charge_code"),
            "unit": _code(row["unit"], "rate.unit"),
            "scope": scope,
            "rate_minor": (None if row["rate_minor"] is None and pricing["kind"] == "percentage" else _decimal(row["rate_minor"], "rate.rate_minor")) if extended else _int(row["rate_minor"], "rate.rate_minor"),
            **({"pricing": pricing} if extended else {}),
            "event_required": _bool(row["event_required"], "rate.event_required"),
            "effective_from": start,
            "effective_until": end,
        })
    for i, left in enumerate(rates):
        for right in rates[i + 1:]:
            if (left["charge_code"], left["unit"], left["scope"]) != (right["charge_code"], right["unit"], right["scope"]):
                continue
            a0 = _dt(left["effective_from"])
            a1 = _dt(left["effective_until"]) if left["effective_until"] else None
            b0 = _dt(right["effective_from"])
            b1 = _dt(right["effective_until"]) if right["effective_until"] else None
            left_before_right_end = b1 is None or a0 < b1
            right_before_left_end = a1 is None or b0 < a1
            if left_before_right_end and right_before_left_end:
                raise InputError("overlapping rate authority")
    return {
        "authority_id": _ref(p["authority_id"], "policy.authority_id"),
        "entity_ref": _ref(p["entity_ref"], "policy.entity_ref"),
        "provider_ref": _ref(p["provider_ref"], "policy.provider_ref"),
        "currency": _currency(p["currency"]),
        "period_start": period_start,
        "period_end": period_end,
        "captured_at": _utc(p["captured_at"], "policy.captured_at"),
        "max_authority_age_days": _int(p["max_authority_age_days"], "policy.max_authority_age_days", 1, 3650),
        "complete": _bool(p["complete"], "policy.complete"),
        "sites": sorted(sites, key=canonical_json),
        "rates": sorted(rates, key=canonical_json),
        "evidence": _evidence(p["evidence"], "policy.evidence"),
        **({"minor_unit_digits": _int(p["minor_unit_digits"], "policy.minor_unit_digits", 0, 9), "rounding_mode": _rounding_mode(p["rounding_mode"])} if extended else {}),
    }


def _normalize_custody(raw: Any) -> dict[str, Any]:
    c = _normalize_common_generation(raw, "custody")
    _exact_keys(c, {"authority_id", "entity_ref", "provider_ref", "period_start", "period_end", "captured_at", "complete", "cartons", "evidence"})
    cartons: list[dict[str, Any]] = []
    seen: dict[str, str] = {}
    for idx, item in enumerate(_list(c["cartons"], "custody.cartons", MAX_CARTONS)):
        row = _dict(item, f"custody.cartons[{idx}]")
        _exact_keys(row, {"carton_ref", "site_ref", "admitted_at", "terminated_at", "termination_kind", "evidence_ref", "evidence_sha256"})
        terminated_at = None if row["terminated_at"] is None else _utc(row["terminated_at"], "carton.terminated_at")
        termination_kind = row["termination_kind"]
        if terminated_at is None:
            if termination_kind is not None:
                raise InputError("termination_kind requires terminated_at")
        elif type(termination_kind) is not str or termination_kind not in _TERMINATION_VALUES:
            raise InputError("terminated carton requires WITHDRAWN or DESTROYED termination_kind")
        admitted_at = _utc(row["admitted_at"], "carton.admitted_at")
        if terminated_at is not None and _dt(terminated_at) <= _dt(admitted_at):
            raise InputError("carton termination must follow admission")
        normalized = {
            "carton_ref": _ref(row["carton_ref"], "carton.carton_ref"),
            "site_ref": _ref(row["site_ref"], "carton.site_ref"),
            "admitted_at": admitted_at,
            "terminated_at": terminated_at,
            "termination_kind": termination_kind,
            "evidence_ref": _ref(row["evidence_ref"], "carton.evidence_ref"),
            "evidence_sha256": _sha(row["evidence_sha256"], "carton.evidence_sha256"),
        }
        key = normalized["carton_ref"]
        blob = canonical_json(normalized)
        if key in seen and seen[key] != blob:
            raise InputError("changed same carton_ref")
        if key not in seen:
            cartons.append(normalized)
        seen[key] = blob
    return {
        "authority_id": _ref(c["authority_id"], "custody.authority_id"),
        "entity_ref": _ref(c["entity_ref"], "custody.entity_ref"),
        "provider_ref": _ref(c["provider_ref"], "custody.provider_ref"),
        "period_start": _utc(c["period_start"], "custody.period_start"),
        "period_end": _utc(c["period_end"], "custody.period_end"),
        "captured_at": _utc(c["captured_at"], "custody.captured_at"),
        "complete": _bool(c["complete"], "custody.complete"),
        "cartons": sorted(cartons, key=canonical_json),
        "evidence": _evidence(c["evidence"], "custody.evidence"),
    }


def _normalize_services(raw: Any, extended: bool = False) -> dict[str, Any]:
    s = _normalize_common_generation(raw, "services")
    _exact_keys(s, {"authority_id", "entity_ref", "provider_ref", "period_start", "period_end", "captured_at", "complete", "events", "evidence"})
    events: list[dict[str, Any]] = []
    seen: dict[str, str] = {}
    evidence_use: dict[str, str] = {}
    for idx, item in enumerate(_list(s["events"], "services.events", MAX_ROWS)):
        row = _dict(item, f"services.events[{idx}]")
        _exact_keys(row, {"event_id", "site_ref", "carton_ref", "charge_code", "occurred_at", "quantity", "unit", "evidence_ref", "evidence_sha256"})
        normalized = {
            "event_id": _ref(row["event_id"], "event.event_id"),
            "site_ref": _optional_ref(row["site_ref"], "event.site_ref"),
            "carton_ref": _optional_ref(row["carton_ref"], "event.carton_ref"),
            "charge_code": _code(row["charge_code"], "event.charge_code"),
            "occurred_at": _utc(row["occurred_at"], "event.occurred_at"),
            "quantity": _decimal(row["quantity"], "event.quantity", positive=True) if extended else _int(row["quantity"], "event.quantity", 1),
            "unit": _code(row["unit"], "event.unit"),
            "evidence_ref": _ref(row["evidence_ref"], "event.evidence_ref"),
            "evidence_sha256": _sha(row["evidence_sha256"], "event.evidence_sha256"),
        }
        blob = canonical_json(normalized)
        eid = normalized["event_id"]
        if eid in seen and seen[eid] != blob:
            raise InputError("changed same event_id")
        if eid in seen:
            continue
        seen[eid] = blob
        evidence_key = normalized["evidence_ref"] + ":" + normalized["evidence_sha256"]
        semantic = canonical_json({k: normalized[k] for k in normalized if k not in {"event_id", "evidence_ref", "evidence_sha256"}})
        if evidence_key in evidence_use and evidence_use[evidence_key] != semantic:
            raise InputError("service evidence reused for incompatible semantics")
        if evidence_key in evidence_use:
            raise InputError("service evidence reused under different event_id")
        evidence_use[evidence_key] = semantic
        events.append(normalized)
    return {
        "authority_id": _ref(s["authority_id"], "services.authority_id"),
        "entity_ref": _ref(s["entity_ref"], "services.entity_ref"),
        "provider_ref": _ref(s["provider_ref"], "services.provider_ref"),
        "period_start": _utc(s["period_start"], "services.period_start"),
        "period_end": _utc(s["period_end"], "services.period_end"),
        "captured_at": _utc(s["captured_at"], "services.captured_at"),
        "complete": _bool(s["complete"], "services.complete"),
        "events": sorted(events, key=canonical_json),
        "evidence": _evidence(s["evidence"], "services.evidence"),
    }


def _normalize_invoices(raw: Any, extended: bool = False) -> dict[str, Any]:
    inv = _normalize_common_generation(raw, "invoices")
    _exact_keys(inv, {"authority_id", "entity_ref", "provider_ref", "currency", "period_start", "period_end", "captured_at", "complete", "rows", "evidence"})
    rows: list[dict[str, Any]] = []
    seen: dict[str, str] = {}
    for idx, item in enumerate(_list(inv["rows"], "invoices.rows", MAX_ROWS)):
        row = _dict(item, f"invoices.rows[{idx}]")
        _exact_keys(row, {"row_id", "invoice_ref", "site_ref", "carton_ref", "event_id", "charge_code", "service_at", "quantity", "unit", "rate_minor", "amount_minor", "evidence_ref", "evidence_sha256"}, {"line_kind", "row_role", "credit_of", "basis_row_ids", "billed_at", "billed_percent"} if extended else set())
        normalized = {
            "row_id": _ref(row["row_id"], "invoice.row_id"),
            "invoice_ref": _ref(row["invoice_ref"], "invoice.invoice_ref"),
            "site_ref": _optional_ref(row["site_ref"], "invoice.site_ref"),
            "carton_ref": _optional_ref(row["carton_ref"], "invoice.carton_ref"),
            "event_id": _optional_ref(row["event_id"], "invoice.event_id"),
            "charge_code": _code(row["charge_code"], "invoice.charge_code"),
            "service_at": _utc(row["service_at"], "invoice.service_at"),
            "quantity": _decimal(row["quantity"], "invoice.quantity", positive=True) if extended else _int(row["quantity"], "invoice.quantity", 1),
            "unit": _code(row["unit"], "invoice.unit"),
            "rate_minor": (None if row["rate_minor"] is None else _decimal(row["rate_minor"], "invoice.rate_minor")) if extended else _int(row["rate_minor"], "invoice.rate_minor"),
            "amount_minor": _int(row["amount_minor"], "invoice.amount_minor", -MAX_SAFE_INTEGER if extended else 0),
            "evidence_ref": _ref(row["evidence_ref"], "invoice.evidence_ref"),
            "evidence_sha256": _sha(row["evidence_sha256"], "invoice.evidence_sha256"),
            **(_invoice_extension(row) if extended else {}),
        }
        blob = canonical_json(normalized)
        rid = normalized["row_id"]
        if rid in seen and seen[rid] != blob:
            raise InputError("changed same invoice row_id")
        if rid not in seen:
            rows.append(normalized)
        seen[rid] = blob
    return {
        "authority_id": _ref(inv["authority_id"], "invoices.authority_id"),
        "entity_ref": _ref(inv["entity_ref"], "invoices.entity_ref"),
        "provider_ref": _ref(inv["provider_ref"], "invoices.provider_ref"),
        "currency": _currency(inv["currency"]),
        "period_start": _utc(inv["period_start"], "invoices.period_start"),
        "period_end": _utc(inv["period_end"], "invoices.period_end"),
        "captured_at": _utc(inv["captured_at"], "invoices.captured_at"),
        "complete": _bool(inv["complete"], "invoices.complete"),
        "rows": sorted(rows, key=canonical_json),
        "evidence": _evidence(inv["evidence"], "invoices.evidence"),
    }


def normalize_request(raw: Any) -> dict[str, Any]:
    request = _dict(raw, "request")
    _exact_keys(request, {"schema", "policy", "custody", "services", "invoices"})
    if type(request["schema"]) is not str or request["schema"] not in {SCHEMA, SCHEMA_V2}:
        raise InputError("unsupported schema")
    extended = request["schema"] == SCHEMA_V2
    policy = _normalize_policy(request["policy"], extended)
    custody = _normalize_custody(request["custody"])
    services = _normalize_services(request["services"], extended)
    invoices = _normalize_invoices(request["invoices"], extended)
    return {"schema": request["schema"], "policy": policy, "custody": custody, "services": services, "invoices": invoices}


def trusted_roots_for_request(raw_request: Any) -> dict[str, str]:
    n = normalize_request(raw_request)
    return {name: sha256_json(n[name]) for name in ("policy", "custody", "services", "invoices")}


def _normalize_roots(raw: Any) -> dict[str, str]:
    roots = _dict(raw, "trusted_roots")
    _exact_keys(roots, {"policy", "custody", "services", "invoices"})
    return {name: _sha(roots[name], f"trusted_roots.{name}") for name in ("policy", "custody", "services", "invoices")}


def _rate_for(policy: dict[str, Any], code: str, unit: str, at: str) -> Optional[dict[str, Any]]:
    matches = [r for r in policy["rates"] if r["charge_code"] == code and r["unit"] == unit and _active(at, r["effective_from"], r["effective_until"])]
    return matches[0] if len(matches) == 1 else None


def _scope_tuple(generation: dict[str, Any]) -> tuple[str, str, str, str]:
    return (generation["entity_ref"], generation["provider_ref"], generation["period_start"], generation["period_end"])


def _authority_holds(n: dict[str, Any], roots: dict[str, str], evaluated_at: str, mode: str) -> list[str]:
    reasons: list[str] = []
    policy = n["policy"]
    actual = trusted_roots_for_request(n)
    for name in ("policy", "custody", "services", "invoices"):
        if actual[name] != roots[name]:
            reasons.append(f"{name.upper()}_RETAINED_ROOT_MISMATCH")
    base_scope = _scope_tuple(policy)
    for name in ("custody", "services", "invoices"):
        if _scope_tuple(n[name]) != base_scope:
            reasons.append(f"{name.upper()}_SCOPE_MISMATCH")
    if n["invoices"]["currency"] != policy["currency"]:
        reasons.append("INVOICE_CURRENCY_MISMATCH")
    if _dt(policy["period_end"]) > _dt(evaluated_at):
        reasons.append("REVIEW_PERIOD_NOT_CLOSED")
    for name in ("policy", "custody", "services", "invoices"):
        generation = n[name]
        if not generation["complete"]:
            reasons.append(f"{name.upper()}_AUTHORITY_INCOMPLETE")
        if _dt(generation["captured_at"]) > _dt(evaluated_at):
            reasons.append(f"{name.upper()}_AUTHORITY_FROM_FUTURE")
    for name in ("custody", "services", "invoices"):
        if _dt(n[name]["captured_at"]) < _dt(policy["period_end"]):
            reasons.append(f"{name.upper()}_CAPTURE_PRECEDES_PERIOD_END")
    if mode == MODE_CURRENT:
        age_seconds = (_dt(evaluated_at) - _dt(policy["captured_at"])).total_seconds()
        if age_seconds > policy["max_authority_age_days"] * 86400:
            reasons.append("POLICY_AUTHORITY_STALE")
    return sorted(set(reasons))


def _carton_active(carton: dict[str, Any], at: str) -> bool:
    return _active(at, carton["admitted_at"], carton["terminated_at"])


def _checked_sum(values: Any) -> int:
    result = sum(values)
    if abs(result) > MAX_SAFE_INTEGER:
        raise InputError("money total exceeds safe integer; use a smaller explicit period")
    return result


def calculate_percentage_fee(raw_rows: Any, percent: Any, rounding_mode: Any) -> dict[str, Any]:
    """Exact original percentage calculation, also reused by prepared monthly reports."""
    rate = _decimal(percent, "fee.percent")
    rounding = _rounding_mode(rounding_mode)
    rows = []
    seen: set[str] = set()
    for item in _list(raw_rows, "fee.basis_rows", MAX_ROWS):
        row = _dict(item, "fee.basis_row")
        _exact_keys(row, {"row_id", "amount_minor"})
        ref = _ref(row["row_id"], "fee.basis_row.row_id")
        if ref in seen:
            raise InputError("fee basis repeats an invoice row")
        seen.add(ref)
        rows.append({"row_id": ref, "amount_minor": _int(row["amount_minor"], "fee.basis_row.amount_minor", -MAX_SAFE_INTEGER)})
    total = _checked_sum(row["amount_minor"] for row in rows)
    exact = Fraction(total) * Fraction(rate) / 100
    rounded = _round_minor(exact, rounding)
    return {"percent": rate, "rounding_mode": rounding, "basis_rows": rows,
            "basis_amount_minor": total, "unrounded_minor": _fraction_text(exact),
            "amount_minor": rounded, "rounding_applied": rounded is not None and exact != rounded,
            "complete": rounded is not None}


def _compile_result(n: dict[str, Any], roots: dict[str, str], evaluated_at: str, mode: str) -> dict[str, Any]:
    holds = _authority_holds(n, roots, evaluated_at, mode)
    policy = n["policy"]
    extended = n["schema"] == SCHEMA_V2
    if holds:
        return {
            "overall_state": "HOLD",
            "hold_reasons": holds,
            "findings": [],
            "summary": {"currency": policy["currency"], "finding_count": 0, "matched_amount_minor": 0, "review_amount_minor": 0},
        }

    sites = {row["site_ref"]: row for row in policy["sites"]}
    cartons = {row["carton_ref"]: row for row in n["custody"]["cartons"]}
    events = {row["event_id"]: row for row in n["services"]["events"]}
    consumed_events: set[str] = set()
    findings: list[dict[str, Any]] = []
    matched_amount = 0
    review_amount = 0
    seen_economics: dict[str, str] = {}
    invoice_by_id = {row["row_id"]: row for row in n["invoices"]["rows"]}
    credit_groups: dict[str, list[dict[str, Any]]] = {}

    for row in n["invoices"]["rows"]:
        if extended and row["row_role"] == "REFERENCE":
            continue
        states: list[str] = []
        calculation = None
        credit = extended and row["line_kind"] == "CREDIT"
        rate = _rate_for(policy, row["charge_code"], row["unit"], row["service_at"])
        if not (_dt(policy["period_start"]) <= _dt(row["billed_at"] if extended else row["service_at"]) < _dt(policy["period_end"])):
            states.append("OUT_OF_PERIOD_INVOICE_REVIEW")
        if rate is None:
            states.append("UNADMITTED_CHARGE_REVIEW")
        expected_scope = None if rate is None else rate["scope"]
        if expected_scope == "CARTON" and (row["carton_ref"] is None or row["site_ref"] is None):
            states.append("CHARGE_SCOPE_MISMATCH_REVIEW")
        if expected_scope == "ACCOUNT" and (row["carton_ref"] is not None or row["site_ref"] is not None):
            states.append("CHARGE_SCOPE_MISMATCH_REVIEW")

        carton = cartons.get(row["carton_ref"]) if row["carton_ref"] else None
        if row["carton_ref"] is not None:
            if carton is None:
                states.append("UNKNOWN_CARTON_REVIEW")
            else:
                if carton["site_ref"] != row["site_ref"]:
                    states.append("CARTON_SITE_MISMATCH_REVIEW")
                site = sites.get(carton["site_ref"])
                if site is None:
                    states.append("UNKNOWN_SITE_REVIEW")
                elif not _active(row["service_at"], site["active_from"], site["active_until"]):
                    states.append("SITE_OUTSIDE_AUTHORITY_WINDOW_REVIEW")
                if not _carton_active(carton, row["service_at"]):
                    if row["charge_code"] == "STORAGE":
                        states.append("STORAGE_OUTSIDE_CUSTODY_REVIEW")
                    else:
                        states.append("SERVICE_OUTSIDE_CUSTODY_REVIEW")

        event = events.get(row["event_id"]) if row["event_id"] else None
        event_required = False if rate is None or credit else rate["event_required"]
        if event_required and event is None:
            states.append("BILLED_WITHOUT_EVENT_EVIDENCE_REVIEW")
        if event is not None:
            if not credit:
                consumed_events.add(event["event_id"])
            expected = (row["site_ref"], row["carton_ref"], row["charge_code"], row["unit"])
            observed = (event["site_ref"], event["carton_ref"], event["charge_code"], event["unit"])
            if observed != expected:
                states.append("EVENT_BINDING_MISMATCH_REVIEW")
            if event["occurred_at"] != row["service_at"]:
                states.append("EVENT_DATE_MISMATCH_REVIEW")
            if not credit and event["quantity"] != row["quantity"]:
                states.append("QUANTITY_VARIANCE_REVIEW")

        if rate is not None:
            if extended:
                calculation, pricing_states = _price_calculation(row, rate, policy, invoice_by_id)
                states.extend(pricing_states)
            else:
                if row["rate_minor"] != rate["rate_minor"]:
                    states.append("RATE_VARIANCE_REVIEW")
                admitted_amount = _checked_product(row["quantity"], rate["rate_minor"])
                invoiced_extension = _checked_product(row["quantity"], row["rate_minor"])
                if row["amount_minor"] != invoiced_extension or row["amount_minor"] != admitted_amount:
                    states.append("EXTENSION_VARIANCE_REVIEW")

        if credit:
            original = invoice_by_id.get(row["credit_of"])
            if original is None:
                states.append("CREDIT_ORIGINAL_NOT_INCLUDED_REVIEW")
            elif original.get("line_kind", "CHARGE") != "CHARGE":
                states.append("CREDIT_ORIGINAL_KIND_REVIEW")
            else:
                binding = ("site_ref", "carton_ref", "charge_code", "unit", "service_at")
                if any(original[key] != row[key] for key in binding):
                    states.append("CREDIT_ORIGINAL_BINDING_REVIEW")
                credit_groups.setdefault(original["row_id"], []).append(row)
                if original.get("row_role") == "REFERENCE":
                    original_rate = _rate_for(policy, original["charge_code"], original["unit"], original["service_at"])
                    if original_rate is None:
                        states.append("CREDIT_REFERENCE_RATE_UNADMITTED_REVIEW")
                    else:
                        _, original_pricing_states = _price_calculation(original, original_rate, policy, invoice_by_id)
                        if original_pricing_states:
                            states.append("CREDIT_REFERENCE_PRICING_REVIEW")

        economic_fields = ("site_ref", "carton_ref", "event_id", "charge_code", "service_at", "quantity", "unit", "rate_minor", "amount_minor")
        if extended:
            economic_fields += ("line_kind", "credit_of", "billed_at", "basis_row_ids")
        econ_key = canonical_json({k: row[k] for k in economic_fields})
        if econ_key in seen_economics:
            states.append("DUPLICATE_ECONOMIC_INVOICE_ROW_REVIEW")
        else:
            seen_economics[econ_key] = row["row_id"]

        states = sorted(set(states))
        if not states:
            states = ["MATCHED_REFERENCE"]
            if not extended:
                matched_amount = _checked_add(matched_amount, row["amount_minor"])
        elif not extended:
            review_amount = _checked_add(review_amount, row["amount_minor"])
        findings.append({
            "finding_id": f"invoice:{row['row_id']}",
            "source_kind": "INVOICE_ROW",
            "source_id": row["row_id"],
            "invoice_ref": row["invoice_ref"],
            "site_ref": row["site_ref"],
            "carton_ref": row["carton_ref"],
            "event_id": row["event_id"],
            "charge_code": row["charge_code"],
            "amount_minor": row["amount_minor"],
            "states": states,
            **({"line_kind": row["line_kind"], "credit_of": row["credit_of"],
                "billed_at": row["billed_at"], "quantity": row["quantity"], "unit": row["unit"],
                "billed_rate_minor": row["rate_minor"], "calculation": calculation} if extended else {}),
        })

    if extended:
        by_source = {finding["source_id"]: finding for finding in findings}
        def add_review(source_id: str, state: str) -> None:
            finding = by_source[source_id]
            finding["states"] = sorted((set(finding["states"]) - {"MATCHED_REFERENCE"}) | {state})
        for original_id, credits in credit_groups.items():
            original = invoice_by_id[original_id]
            quantity = sum((Fraction(row["quantity"]) for row in credits), Fraction(0))
            amount = sum(abs(row["amount_minor"]) for row in credits)
            if quantity > Fraction(original["quantity"]) or amount > original["amount_minor"]:
                for row in credits:
                    add_review(row["row_id"], "CUMULATIVE_CREDIT_EXCEEDS_ORIGINAL_REVIEW")
            original_finding = by_source.get(original_id)
            if original_finding and original_finding["states"] != ["MATCHED_REFERENCE"]:
                for row in credits:
                    add_review(row["row_id"], "CREDIT_ORIGINAL_UNRESOLVED_REVIEW")
        for row in n["invoices"]["rows"]:
            if row["row_role"] == "REFERENCE" or not row["basis_row_ids"]:
                continue
            if any(ref in by_source and by_source[ref]["states"] != ["MATCHED_REFERENCE"] for ref in row["basis_row_ids"]):
                add_review(row["row_id"], "PERCENTAGE_BASIS_UNRESOLVED_REVIEW")
        matched_amount = _checked_sum(f["amount_minor"] for f in findings if f["states"] == ["MATCHED_REFERENCE"])
        review_amount = _checked_sum(f["amount_minor"] for f in findings if f["states"] != ["MATCHED_REFERENCE"])

    for event in n["services"]["events"]:
        if extended and not (_dt(policy["period_start"]) <= _dt(event["occurred_at"]) < _dt(policy["period_end"])):
            continue
        rate = _rate_for(policy, event["charge_code"], event["unit"], event["occurred_at"])
        if rate is not None and rate["event_required"] and event["event_id"] not in consumed_events:
            findings.append({
                "finding_id": f"event:{event['event_id']}",
                "source_kind": "SERVICE_EVENT",
                "source_id": event["event_id"],
                "invoice_ref": None,
                "site_ref": event["site_ref"],
                "carton_ref": event["carton_ref"],
                "event_id": event["event_id"],
                "charge_code": event["charge_code"],
                "amount_minor": 0,
                "states": ["ADMITTED_EVENT_WITHOUT_INVOICE_REVIEW"],
            })

    findings.sort(key=canonical_json)
    review_findings = [f for f in findings if f["states"] != ["MATCHED_REFERENCE"]]
    return {
        "overall_state": "REVIEW_REQUIRED" if review_findings else "MATCHED_REFERENCE",
        "hold_reasons": [],
        "findings": findings,
        "summary": {
            "currency": policy["currency"],
            "finding_count": len(review_findings),
            "matched_amount_minor": matched_amount,
            "review_amount_minor": review_amount,
            **({
                "minor_unit_digits": policy["minor_unit_digits"], "rounding_mode": policy["rounding_mode"],
                "billed_row_count": sum(row["row_role"] == "BILLED" for row in n["invoices"]["rows"]),
                "reference_row_count": sum(row["row_role"] == "REFERENCE" for row in n["invoices"]["rows"]),
                "matched_debit_minor": _checked_sum(max(f["amount_minor"], 0) for f in findings if f["states"] == ["MATCHED_REFERENCE"]),
                "matched_credit_minor": _checked_sum(min(f["amount_minor"], 0) for f in findings if f["states"] == ["MATCHED_REFERENCE"]),
                "review_debit_minor": _checked_sum(max(f["amount_minor"], 0) for f in review_findings),
                "review_credit_minor": _checked_sum(min(f["amount_minor"], 0) for f in review_findings),
                "review_gross_minor": _checked_sum(abs(f["amount_minor"]) for f in review_findings),
                "interpretation": "Signed billed amounts; review gross is exposure to review, not confirmed overcharge or cash."
            } if extended else {}),
        },
    }


def _compile_at(raw_request: Any, trusted_roots: Any, evaluated_at: str, mode: str) -> dict[str, Any]:
    if mode not in {MODE_CURRENT, MODE_HISTORICAL}:
        raise InputError("unsupported compile mode")
    evaluated_at = _utc(evaluated_at, "evaluated_at")
    n = normalize_request(raw_request)
    roots = _normalize_roots(trusted_roots)
    packet = {
        "schema": PACKET_SCHEMA_V2 if n["schema"] == SCHEMA_V2 else PACKET_SCHEMA,
        "mode": mode,
        "evaluated_at": evaluated_at,
        "request_sha256": sha256_json(n),
        "trusted_roots": roots,
        "authority_statement": "OWNER_RETAINED_ROOTS_REQUIRED_NOT_PROVIDER_AUTHENTICATED",
        "result": _compile_result(n, roots, evaluated_at, mode),
    }
    packet["packet_sha256"] = sha256_json(packet)
    return packet


def _bind_current_compile() -> Callable[[Any, Any], dict[str, Any]]:
    now = _process_now_utc

    def compile_current(raw_request: Any, trusted_roots: Any) -> dict[str, Any]:
        return _compile_at(raw_request, trusted_roots, now(), MODE_CURRENT)

    return compile_current


compile_current = _bind_current_compile()


def compile_historical(raw_request: Any, trusted_roots: Any, evaluated_at: str) -> dict[str, Any]:
    return _compile_at(raw_request, trusted_roots, evaluated_at, MODE_HISTORICAL)


def _normalize_packet(raw_packet: Any) -> dict[str, Any]:
    p = _dict(raw_packet, "packet")
    _exact_keys(p, {"schema", "mode", "evaluated_at", "request_sha256", "trusted_roots", "authority_statement", "result", "packet_sha256"})
    if type(p["schema"]) is not str or p["schema"] not in {PACKET_SCHEMA, PACKET_SCHEMA_V2}:
        raise InputError("unsupported packet schema")
    if p["mode"] not in {MODE_CURRENT, MODE_HISTORICAL}:
        raise InputError("unsupported packet mode")
    if p["authority_statement"] != "OWNER_RETAINED_ROOTS_REQUIRED_NOT_PROVIDER_AUTHENTICATED":
        raise InputError("unexpected authority statement")
    normalized = {
        "schema": p["schema"],
        "mode": p["mode"],
        "evaluated_at": _utc(p["evaluated_at"], "packet.evaluated_at"),
        "request_sha256": _sha(p["request_sha256"], "packet.request_sha256"),
        "trusted_roots": _normalize_roots(p["trusted_roots"]),
        "authority_statement": p["authority_statement"],
        "result": _dict(p["result"], "packet.result"),
        "packet_sha256": _sha(p["packet_sha256"], "packet.packet_sha256"),
    }
    unsigned = {k: normalized[k] for k in normalized if k != "packet_sha256"}
    if sha256_json(unsigned) != normalized["packet_sha256"]:
        raise InputError("packet digest mismatch")
    return normalized


def _verification_projection(packet: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": packet["schema"],
        "mode": packet["mode"],
        "request_sha256": packet["request_sha256"],
        "trusted_roots": packet["trusted_roots"],
        "authority_statement": packet["authority_statement"],
        "result": packet["result"],
    }


def verify_historical(raw_request: Any, trusted_roots: Any, raw_packet: Any) -> dict[str, Any]:
    try:
        packet = _normalize_packet(raw_packet)
        if packet["mode"] != MODE_HISTORICAL:
            return {"valid": False, "scope": "HISTORICAL", "reason": "PACKET_MODE_NOT_HISTORICAL"}
        expected = compile_historical(raw_request, trusted_roots, packet["evaluated_at"])
        if canonical_json(expected) != canonical_json(packet):
            return {"valid": False, "scope": "HISTORICAL", "reason": "SEMANTIC_RECOMPILE_MISMATCH"}
        return {"valid": True, "scope": "HISTORICAL", "reason": "VERIFIED"}
    except InputError as exc:
        return {"valid": False, "scope": "HISTORICAL", "reason": str(exc)}


def _bind_current_verify() -> Callable[[Any, Any, Any], dict[str, Any]]:
    now = _process_now_utc

    def verify_current(raw_request: Any, trusted_roots: Any, raw_packet: Any) -> dict[str, Any]:
        try:
            packet = _normalize_packet(raw_packet)
            if packet["mode"] != MODE_CURRENT:
                return {"valid": False, "scope": "CURRENT", "reason": "PACKET_MODE_NOT_CURRENT"}
            current_at = now()
            packet_at = _dt(packet["evaluated_at"])
            current_dt = _dt(current_at)
            if packet_at > current_dt:
                return {"valid": False, "scope": "CURRENT", "reason": "PACKET_FROM_FUTURE"}
            if (current_dt - packet_at).total_seconds() > CURRENT_PACKET_MAX_AGE_SECONDS:
                return {"valid": False, "scope": "CURRENT", "reason": "CURRENT_PACKET_STALE"}
            expected = _compile_at(raw_request, trusted_roots, current_at, MODE_CURRENT)
            if canonical_json(_verification_projection(expected)) != canonical_json(_verification_projection(packet)):
                return {"valid": False, "scope": "CURRENT", "reason": "CURRENT_SEMANTIC_RECOMPILE_MISMATCH"}
            return {"valid": True, "scope": "CURRENT", "reason": "VERIFIED"}
        except InputError as exc:
            return {"valid": False, "scope": "CURRENT", "reason": str(exc)}

    return verify_current


verify_current = _bind_current_verify()


def render_markdown(packet: Any) -> str:
    p = _normalize_packet(packet)
    result = p["result"]
    lines = [
        "# Offsite Records Storage Invoice Reconciliation",
        "",
        f"- mode: `{p['mode']}`",
        f"- evaluated_at: `{p['evaluated_at']}`",
        f"- overall_state: **{result.get('overall_state', 'UNKNOWN')}**",
        f"- currency: `{result.get('summary', {}).get('currency', 'UNKNOWN')}`",
        f"- finding_count: `{result.get('summary', {}).get('finding_count', 0)}`",
        f"- matched_amount_minor: `{result.get('summary', {}).get('matched_amount_minor', 0)}`",
        f"- review_amount_minor: `{result.get('summary', {}).get('review_amount_minor', 0)}`",
        f"- packet_sha256: `{p['packet_sha256']}`",
        "",
        "> Owner-review evidence reconciliation only. No records-retention, legal-hold, privacy, compliance, destruction-adequacy, provider-contact, invoice-dispute, payment, savings, or revenue authority.",
        "",
    ]
    holds = result.get("hold_reasons", [])
    if holds:
        lines.append("## HOLD reasons")
        lines.extend(f"- `{reason}`" for reason in holds)
        lines.append("")
    lines.append("## Findings")
    for finding in result.get("findings", []):
        states = ", ".join(finding.get("states", []))
        lines.append(f"- `{finding.get('finding_id')}` · `{finding.get('charge_code')}` · `{states}` · amount_minor `{finding.get('amount_minor')}`")
    if not result.get("findings"):
        lines.append("- none")
    lines.append("")
    return "\n".join(lines)


def serialize_packet(packet: Any) -> str:
    return canonical_json(_normalize_packet(packet)) + "\n"


def publish_packet_and_markdown(packet: Any, packet_path: Union[str, os.PathLike[str]], markdown_path: Union[str, os.PathLike[str]]) -> None:
    write_outputs_exclusive([(packet_path, serialize_packet(packet)), (markdown_path, render_markdown(packet))])

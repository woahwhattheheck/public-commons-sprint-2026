"""Exact, source-preserving IANZ fee calculation and original-line reconciliation.

Standard library only. This module performs no I/O, mutation, billing dispatch or
currency conversion. Inputs and the returned independent calculation are retained
by the original application request. See BILLING.md for the selected policy ABI.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from decimal import Decimal, InvalidOperation
from fractions import Fraction
import hashlib
import json
import re

SCHEMA = "tjlabs.ianz-billing.v1"
MAX_LINES = 20000
MAX_PROFILES = 500
MAX_NUMBER_CHARS = 160
CANONICAL_FIELDS = (
    "charge_line_key", "billing_account_key", "accreditation_key",
    "assessment_key", "facility_key", "fee_profile_id", "tariff_key",
    "quantity", "quantity_unit", "rate", "currency", "net_amount",
    "tax_amount", "gross_amount", "billing_period", "credit_of_line_key",
    "source_document_key", "cap_group_key",
)
IDENTITY_FIELDS = (
    "invoice_key", "billing_account_key", "accreditation_key", "assessment_key",
    "facility_key", "fee_profile_id", "tariff_key", "currency", "tax_basis",
    "billing_period", "quantity_unit", "credit_of_line_key", "source_document_key",
    "cap_group_key", "group_scope", "quantity_origin",
)
NUMBER_FIELDS = ("quantity", "rate", "net_amount", "tax_amount", "gross_amount")
ROUND_MODES = {"HALF_UP", "HALF_EVEN", "UP", "DOWN", "FLOOR", "CEILING"}
MISSING = object()


class BillingError(ValueError):
    def __init__(self, message, code="BILLING_INPUT", details=None):
        super().__init__(message)
        self.code = code
        self.details = details


def _json(value):
    try:
        return json.dumps(value, sort_keys=True, ensure_ascii=False,
                          separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise BillingError("Keep the original inputs as finite JSON values.") from exc


def _sha(value):
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def _text(value, label, maximum=1000):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise BillingError("Select the original " + label + ".")
    return value


def _list(value, label, maximum=MAX_LINES):
    if not isinstance(value, list) or len(value) > maximum:
        raise BillingError("Select the complete bounded " + label + ".")
    return value


def _number(value, label):
    # Binary floats are not an exact original decimal representation.
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise BillingError(label + " must retain its original decimal string or integer.")
    text = str(value)
    if len(text) > MAX_NUMBER_CHARS or not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)", text):
        raise BillingError(label + " must be a bounded finite decimal, without a binary float or exponent.")
    try:
        decimal = Decimal(text)
    except InvalidOperation as exc:
        raise BillingError(label + " is not a finite decimal.") from exc
    return Fraction(decimal)


def _decimal(value):
    """Exact terminating decimal, otherwise None; never a rounded approximation."""
    if value is None:
        return None
    n, d = value.numerator, value.denominator
    twos = fives = 0
    while d % 2 == 0:
        d //= 2
        twos += 1
    while d % 5 == 0:
        d //= 5
        fives += 1
    if d != 1:
        return None
    places = max(twos, fives)
    scaled = abs(n) * 2 ** (places - twos) * 5 ** (places - fives)
    digits = str(scaled)
    sign = "-" if n < 0 else ""
    if not places:
        return sign + digits
    digits = digits.rjust(places + 1, "0")
    text = sign + digits[:-places] + "." + digits[-places:]
    return text.rstrip("0").rstrip(".") if "." in text else text


def _exact(value):
    if value is None:
        return None
    return {"numerator": str(value.numerator), "denominator": str(value.denominator),
            "decimal": _decimal(value)}


def _display(value, places):
    if value is None:
        return None
    scaled = value * 10 ** places
    if scaled.denominator != 1:
        raise BillingError("A calculated invoice amount is not on the selected rounding quantum.",
                           "BILLING_ROUNDING")
    n = scaled.numerator
    digits = str(abs(n)).rjust(places + 1, "0")
    sign = "-" if n < 0 else ""
    return sign + (digits if places == 0 else digits[:-places] + "." + digits[-places:])


def _units(value, mode):
    sign = -1 if value < 0 else 1
    value = abs(value)
    whole, remainder = divmod(value.numerator, value.denominator)
    if mode == "UP":
        whole += bool(remainder)
    elif mode == "FLOOR":
        whole += bool(remainder) and sign < 0
    elif mode == "CEILING":
        whole += bool(remainder) and sign > 0
    elif mode in {"HALF_UP", "HALF_EVEN"}:
        twice = remainder * 2
        whole += twice > value.denominator or (
            twice == value.denominator and (mode == "HALF_UP" or whole % 2 == 1))
    elif mode != "DOWN":
        raise BillingError("Use a supported explicitly selected rounding mode.")
    return sign * whole


def _round(value, rounding):
    unit = Fraction(1, 10 ** rounding["decimal_places"])
    return _units(value / unit, rounding["mode"]) * unit


def _allocate(values, total, rounding, caps=None):
    """Largest remainder, including signed credits, with explicit cap ceilings."""
    unit = Fraction(1, 10 ** rounding["decimal_places"])
    target = total / unit
    if target.denominator != 1:
        raise BillingError("The selected allocation total is not a whole rounding unit.",
                           "BILLING_ROUNDING")
    floors = {key: (value / unit).numerator // (value / unit).denominator
              for key, value in values.items()}
    remaining = target.numerator - sum(floors.values())
    if remaining < 0 or remaining > len(values):
        raise BillingError("The selected rounding total cannot be allocated to these exact original lines.",
                           "BILLING_ROUNDING")
    memberships = {}
    limits = {}
    totals = {}
    for cap_id, (keys, limit) in (caps or {}).items():
        limit_units = limit / unit
        if limit_units.denominator != 1:
            raise BillingError("Receive a rounding quantum that represents the selected cap exactly.",
                               "BILLING_CAP_QUANTUM", {"cap_id": cap_id, "cap": _exact(limit)})
        limits[cap_id] = limit_units.numerator
        totals[cap_id] = sum(floors[key] for key in keys)
        for key in keys:
            if key in memberships:
                raise BillingError("One charge line cannot enter overlapping cap allocations.")
            memberships[key] = cap_id
    order = sorted(values, key=lambda key: (-(values[key] / unit - floors[key]), key))
    for key in order:
        if not remaining:
            break
        cap_id = memberships.get(key)
        if cap_id is not None and totals[cap_id] >= limits[cap_id]:
            continue
        floors[key] += 1
        remaining -= 1
        if cap_id is not None:
            totals[cap_id] += 1
    if remaining:
        raise BillingError("The selected invoice rounding and cap constraints cannot both be satisfied.",
                           "BILLING_ROUNDING")
    return {key: units * unit for key, units in floors.items()}


def _scope(line):
    scope = line.get("group_scope")
    if (not isinstance(scope, dict) or set(scope) != {"kind", "key"}
            or not isinstance(scope.get("kind"), str) or not isinstance(scope.get("key"), str)):
        raise BillingError("Select group_scope {kind,key} from the original site or assessment-unit group.",
                           "BILLING_GROUP_REQUIRED")
    for key in ("kind", "key"):
        _text(scope[key], "billing group " + key)
    values = [_text(line.get(k), k) for k in
              ("invoice_key", "currency", "tax_basis", "fee_profile_id",
               "billing_account_key", "billing_period")]
    values += [scope["kind"], scope["key"]]
    return tuple(values)


def _scope_value(key):
    return dict(zip(("invoice_key", "currency", "tax_basis", "fee_profile_id",
                     "billing_account_key", "billing_period", "group_kind", "group_key"), key))


def _rounding(value):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise BillingError("Receive the original rounding rule as an object.")
    places = value.get("decimal_places")
    if isinstance(places, bool) or not isinstance(places, int) or not 0 <= places <= 12:
        raise BillingError("Select decimal_places from 0 through 12 in the original rounding policy.")
    if value.get("mode") not in ROUND_MODES:
        raise BillingError("Select HALF_UP, HALF_EVEN, UP, DOWN, FLOOR or CEILING explicitly.")
    if value.get("net_scope") not in {"line", "group"} or value.get("tax_scope") not in {"line", "group"}:
        raise BillingError("Select line or group independently for net and tax rounding.")
    return {key: value[key] for key in ("decimal_places", "mode", "net_scope", "tax_scope")}


def _policies(policy):
    if not isinstance(policy, dict):
        raise BillingError("Receive the complete selected billing policy object.")
    rows = _list(policy.get("rules", []), "currency and tax-basis policies", 500)
    if rows and policy.get("origin") not in {"received_finance_policy", "authored_operating_choice"}:
        raise BillingError("Identify the policy as received finance policy or an authored operating choice.")
    if rows and not str(policy.get("note", "")).strip():
        raise BillingError("Retain the original policy selection note.")
    if policy.get("origin") == "received_finance_policy" and not policy.get("source_refs"):
        raise BillingError("Retain the actual source references for the received finance policy.")
    allocation = policy.get("cap_allocation")
    if allocation not in {None, "proportional", "line_key_order"}:
        raise BillingError("Select proportional or line_key_order cap allocation explicitly.")
    output = {}
    for row in rows:
        if not isinstance(row, dict):
            raise BillingError("Each finance policy rule must be an object.")
        ident = _text(row.get("policy_id"), "policy ID")
        key = (_text(row.get("currency"), "policy currency"),
               _text(row.get("tax_basis"), "policy tax basis"))
        if key in output:
            raise BillingError("More than one policy matches the same original currency and tax basis.")
        rounding = _rounding(row.get("rounding"))
        tax = row.get("tax")
        if tax is not None:
            if not isinstance(tax, dict) or tax.get("basis") not in {"rounded_net", "unrounded_net"}:
                raise BillingError("Select the received tax basis as rounded_net or unrounded_net.")
            rate = _number(tax.get("rate"), "Received tax rate")
            if rate < 0:
                raise BillingError("A received tax rate must be nonnegative.")
            tax = {**deepcopy(tax), "_rate": rate}
        output[key] = {"policy_id": ident, "rounding": rounding, "tax": tax,
                       "original": deepcopy(row)}
    return output


def _profiles(profiles):
    output = {}
    for profile in _list(profiles, "fee profiles", MAX_PROFILES):
        if not isinstance(profile, dict):
            raise BillingError("Each original fee profile must be an object.")
        pid = _text(profile.get("fee_profile_id"), "fee profile ID")
        if pid in output:
            raise BillingError("Select only one exact edition per fee_profile_id.")
        for name in ("source_edition_id", "programme_key", "currency", "tax_basis"):
            _text(profile.get(name), "fee profile " + name)
        rules = {}
        for rule in _list(profile.get("charge_rules"), "complete profile charge rules", 5000):
            if not isinstance(rule, dict):
                raise BillingError("Each original charge rule must be an object.")
            rid = _text(rule.get("tariff_key"), "tariff key")
            if rid in rules:
                raise BillingError("The selected profile repeats a tariff key.")
            if rule.get("profile", pid) != pid:
                raise BillingError("A charge rule names a different original fee profile.")
            if rule.get("tax_basis", profile["tax_basis"]) != profile["tax_basis"]:
                raise BillingError("A charge rule has a different source tax classification.")
            mode = rule.get("mode")
            if mode not in {"fixed", "rate", "site_administration", "pass_through", "cap"}:
                raise BillingError("Retain a supported original charge mode for " + rid + ".")
            amount = rule.get("amount_nzd_ex_gst", rule.get("amount"))
            if mode == "pass_through":
                rate = None
                if amount not in (None, ""):
                    raise BillingError("An actual-cost rule cannot acquire an invented fixed source rate.")
            else:
                rate = _number(amount, "Original rate " + rid)
                if rate < 0:
                    raise BillingError("A tariff rate or cap must be nonnegative.")
            if "amount_nzd_ex_gst" in rule and profile["currency"] != "NZD":
                raise BillingError("The published NZD amount cannot be reclassified as another currency.")
            rules[rid] = {"original": deepcopy(rule), "rate": rate, "mode": mode}
        caps = {}
        for rid, rule in rules.items():
            if rule["mode"] != "cap":
                continue
            targets = rule["original"].get("applies_to")
            if targets is None and pid in {"AS19-2026-07", "AS14-2026-07"} and rid == pid + ":recognition-cap":
                targets = [pid + ":international-recognition"]
            if targets is None:
                raise BillingError("Retain explicit applies_to tariff keys for the selected cap " + rid + ".")
            for target in _list(targets, "cap tariff keys", 5000):
                if target not in rules or rules[target]["mode"] in {"cap", "pass_through"}:
                    raise BillingError("The cap must name an actual selected charge rule.")
                if target in caps:
                    raise BillingError("Overlapping caps need a separately received rule; they cannot be guessed.")
                caps[target] = rid
        output[pid] = {"original": deepcopy(profile), "rules": rules, "caps": caps,
                       "sha256": _sha(profile)}
    return output


def _warning(warnings, code, message, *, line=None, group=None, details=None, unresolved=True):
    row = {"code": code, "message": message, "unresolved": unresolved}
    if line is not None:
        row["charge_line_key"] = line
    if group is not None:
        row["group_id"] = group
    if details is not None:
        row["details"] = details
    warnings.append(row)


def _applicability(line, profile, policy, warnings):
    key = line["charge_line_key"]
    decision = line.get("applicability")
    if not isinstance(decision, dict) or decision.get("decision") not in {"apply", "not_applicable", "unresolved"}:
        _warning(warnings, "APPLICABILITY_REQUIRED", "Review the selected line's applicability explicitly.", line=key)
        return None
    if decision["decision"] == "unresolved":
        _warning(warnings, "APPLICABILITY_UNRESOLVED", "The selected applicability decision remains unresolved.", line=key)
        return None
    if not isinstance(decision.get("note"), str) or not decision["note"].strip():
        _warning(warnings, "APPLICABILITY_NOTE_REQUIRED", "Retain the reason for the selected applicability.", line=key)
        return None
    if decision["decision"] == "apply":
        return True
    if not decision.get("source_refs"):
        _warning(warnings, "APPLICABILITY_SOURCE_REQUIRED", "Retain the source supporting the not-applicable decision.", line=key)
        return None
    pid = profile["original"]["fee_profile_id"]
    if line["tariff_key"] == pid + ":initial-application":
        links = [r for r in _list(policy.get("account_programme_links", []), "original account/programme links")
                 if isinstance(r, dict) and r.get("link_id") == decision.get("account_programme_link_id")]
        valid = len(links) == 1
        link = links[0] if valid else {}
        valid = valid and all((
            decision.get("reason") == "existing_other_ianz_programme",
            bool(str(decision.get("reviewed_by", "")).strip()),
            link.get("issuer_namespace") == "IANZ",
            bool(str(line.get("issuer_account_key", "")).strip()),
            link.get("issuer_account_key") == line.get("issuer_account_key"),
            link.get("billing_account_key") == line["billing_account_key"],
            isinstance(link.get("programme_key"), str) and bool(link.get("programme_key")),
            link.get("programme_key") != profile["original"]["programme_key"],
            link.get("qualifies_for_application_exception") is True,
            bool(link.get("source_refs")),
        ))
        if not valid:
            _warning(warnings, "INITIAL_APPLICATION_LINK_REQUIRED",
                     "Review the original same-account link to the other IANZ programme before applying this exception.",
                     line=key)
            return None
    return False


def _metric(values, keys):
    known = [(key, values.get(key)) for key in keys if values.get(key) is not None]
    missing = [key for key in keys if values.get(key) is None]
    subtotal = sum((value for _, value in known), Fraction(0))
    return {"total": _exact(subtotal) if not missing else None,
            "known_subtotal": _exact(subtotal), "complete": not missing,
            "known_lines": len(known), "missing_line_keys": missing}


def _published_controls(profiles):
    controls = []
    for pid in ("AS19-2026-07", "AS14-2026-07"):
        if pid not in profiles:
            continue
        rules = profiles[pid]["rules"]
        expected = {"advice-work": "282", "assessment-work": "282", "travel": "141",
                    "initial-application": "1197", "annual-administration": "1380",
                    "international-recognition": "276", "recognition-cap": "1380",
                    "information": "0"}
        for name, amount in expected.items():
            actual = rules.get(pid + ":" + name, {}).get("rate")
            wanted = Fraction(amount)
            controls.append({"id": pid + ":" + name, "kind": "published_rate",
                             "status": "PASS" if actual == wanted else "MISMATCH",
                             "expected": _exact(wanted), "actual": _exact(actual),
                             "source_id": "S11" if pid.startswith("AS19") else "S12"})
        levy = rules.get(pid + ":international-recognition", {}).get("rate")
        cap = rules.get(pid + ":recognition-cap", {}).get("rate")
        actual = min(levy * 6, cap) if levy is not None and cap is not None else None
        controls.append({"id": pid + ":six-accreditation-control", "kind": "authored_arithmetic_control",
                         "quantity_origin": "authored_operating_choice", "quantity": "6",
                         "status": "PASS" if actual == 1380 else "MISMATCH",
                         "actual": _exact(actual), "expected": _exact(Fraction(1380))})
        if pid.startswith("AS14"):
            base = rules.get(pid + ":annual-administration", {}).get("rate")
            for name, factor, amount in (("main", "2", "2760"), ("branch", "0.5", "690"),
                                         ("satellite", "0.05", "69")):
                rule = rules.get(pid + ":annual-" + name)
                observed_factor = None
                if rule is not None:
                    observed_factor = _number(rule["original"].get("assessment_unit_factor"), "Published site factor")
                actual = None if base is None or observed_factor is None else base * observed_factor
                controls.append({"id": pid + ":site-" + name, "kind": "published_site_factor",
                                 "factor": _exact(observed_factor), "actual": _exact(actual),
                                 "expected": _exact(Fraction(amount)),
                                 "status": "PASS" if observed_factor == Fraction(factor) and actual == Fraction(amount)
                                 and rule["rate"] == Fraction(amount) else "MISMATCH"})
    return controls


def _credit_audit(selected, calculated, policy):
    """Compare credits with selected original charges; never invent unseen history."""
    warnings, receipts = [], []
    originals = {}
    for row in _list(policy.get("credit_originals", []), "original historical credited lines"):
        if not isinstance(row, dict):
            raise BillingError("Retain each original credited line as a complete object.")
        key = _text(row.get("charge_line_key"), "original credited line key")
        if key in originals:
            raise BillingError("The selected credit origin is duplicated.")
        if key in selected:
            if _json(row) != _json(selected[key]):
                raise BillingError("The selected credit origin has two different retained editions.")
            continue
        originals[key] = row
    credits = defaultdict(list)
    for key, line in selected.items():
        ref = line.get("credit_of_line_key")
        if ref is not None:
            _text(ref, "original credited line key")
            credits[ref].append(key)

    def amount(row, key, field):
        if row.get("quantity_origin") == "authored_operating_choice" and key in calculated.get(field, {}):
            return calculated[field][key], "independent_authored_calculation"
        value = row.get(field, MISSING)
        if value is not MISSING and value is not None and value != "":
            try:
                return _number(value, "Original credit comparison " + field), "retained_original"
            except BillingError:
                return None, "invalid_original"
        return None, "missing" if value is MISSING else "null" if value is None else "blank"

    for origin, keys in sorted(credits.items()):
        keys = sorted(keys)
        target = selected.get(origin) or originals.get(origin)
        details = {"credit_of_line_key": origin, "line_keys": keys}
        if target is None or target.get("credit_of_line_key") is not None:
            _warning(warnings, "CREDIT_ORIGINAL_REQUIRED",
                     "Retain the original positive charge behind each selected credit.", details=details)
            receipts.append({**details, "complete": False, "original": deepcopy(target), "amounts": {},
                             "scope": "Only the selected credit history is known."})
            continue
        basis_fields = ("billing_account_key", "currency", "tax_basis", "fee_profile_id",
                        "tariff_key", "quantity_unit", "group_scope", "cap_group_key")
        differences = [{"charge_line_key": key, "field": field,
                        "original_charge": deepcopy(target.get(field)),
                        "credit": deepcopy(selected[key].get(field))}
                       for key in keys for field in basis_fields
                       if selected[key].get(field, MISSING) != target.get(field, MISSING)]
        if differences:
            _warning(warnings, "CREDIT_IDENTITY_DIFFERENCE",
                     "The selected credit differs from the referenced charge's original account, tariff or site/unit.",
                     details={**details, "differences": differences})
        source_ok = isinstance(target.get("source_document_key"), str) and bool(target["source_document_key"].strip())
        if not source_ok:
            _warning(warnings, "CREDIT_ORIGINAL_SOURCE_REQUIRED",
                     "Retain the original credited charge's source document.", details=details)
        metrics = {}
        for field in ("net_amount", "tax_amount", "gross_amount"):
            original_value, original_kind = amount(target, origin, field)
            parts = {key: amount(selected[key], key, field) for key in keys}
            missing = [key for key, (value, _) in parts.items() if value is None]
            total = None if missing else sum((value for value, _ in parts.values()), Fraction(0))
            complete = original_value is not None and total is not None
            invalid_sign = original_value is not None and original_value < 0
            invalid_sign = invalid_sign or any(value is not None and value > 0 for value, _ in parts.values())
            over = None if not complete else -total > original_value
            if not complete:
                _warning(warnings, "CREDIT_AMOUNT_UNRESOLVED",
                         "Keep missing original credit components distinct from zero.",
                         details={**details, "field": field, "original_state": original_kind,
                                  "missing_line_keys": missing})
            if invalid_sign:
                _warning(warnings, "CREDIT_SIGN_DIFFERENCE",
                         "The selected positive-charge/credit component signs need an explicit source correction.",
                         details={**details, "field": field})
            if over:
                _warning(warnings, "CREDIT_EXCEEDS_SELECTED_ORIGINAL",
                         "Selected credits exceed the retained original component.",
                         details={**details, "field": field})
            metrics[field] = {"original": _exact(original_value), "original_basis": original_kind,
                              "selected_credits": _exact(total),
                              "remaining_selected": _exact(None if not complete else original_value + total),
                              "credit_lines": [{"charge_line_key": key, "amount": _exact(value), "basis": basis}
                                               for key, (value, basis) in parts.items()],
                              "over_credit": over, "invalid_sign": invalid_sign, "complete": complete}
        receipts.append({**details, "original": deepcopy(target),
                         "original_invoice_key": target.get("invoice_key"),
                         "credit_invoice_keys": sorted({selected[key]["invoice_key"] for key in keys}),
                         "same_source_identity": not differences, "identity_differences": differences,
                         "source_document_retained": source_ok, "amounts": metrics,
                         "complete": source_ok and not differences and all(
                             v["complete"] and not v["over_credit"] and not v["invalid_sign"] for v in metrics.values()),
                         "scope": "Only the explicitly selected original and credit lines; no unseen credit history inferred."})
    return receipts, warnings


def calculate_bill(lines: list[dict], profiles: list[dict], policy: dict) -> dict:
    """Return original lines, exact calculations, scoped totals and unresolved controls."""
    _json({"lines": lines, "profiles": profiles, "policy": policy})
    _list(lines, "original charge lines")
    pmap = _profiles(profiles)
    policies = _policies(policy)
    warnings = []
    items = {}
    groups = defaultdict(list)
    cap_groups = {}
    raw_net = {}
    rounded_net = {}
    raw_tax = {}
    rounded_tax = {}
    gross = {}
    for index, original in enumerate(lines):
        if not isinstance(original, dict):
            raise BillingError("Each original charge line must be an object.")
        line = deepcopy(original)
        key = _text(line.get("charge_line_key"), "charge line key")
        if key in items:
            raise BillingError("The selected input repeats an original charge_line_key.", "BILLING_DUPLICATE_LINE",
                               {"charge_line_key": key})
        scope = _scope(line)
        pid = line["fee_profile_id"]
        if pid not in pmap:
            raise BillingError("Select the complete original profile for " + key + ".")
        profile = pmap[pid]
        tariff = _text(line.get("tariff_key"), "tariff key")
        if tariff not in profile["rules"] or profile["rules"][tariff]["mode"] == "cap":
            raise BillingError("Select an actual charge tariff; a cap row is a control, not another charge.")
        rule = profile["rules"][tariff]
        quantity = _number(line.get("quantity"), "Original quantity " + key)
        _text(line.get("quantity_unit"), "quantity unit")
        if line["quantity_unit"] != rule["original"].get("charge_unit"):
            raise BillingError("The original quantity unit differs from the selected tariff.", "BILLING_UNIT",
                               {"charge_line_key": key, "source_unit": rule["original"].get("charge_unit")})
        if line.get("quantity_origin") not in {"authored_operating_choice", "received_invoice"}:
            raise BillingError("Keep each quantity identified as authored_operating_choice or received_invoice.")
        if line["quantity_origin"] == "received_invoice":
            _text(line.get("source_document_key"), "received invoice source_document_key")
        elif not line.get("source_document_key"):
            _warning(warnings, "AUTHORED_SOURCE_DOCUMENT_REQUIRED",
                     "Create and retain the authored calculation-source document before saving this canonical line.", line=key)
        if rule["mode"] != "pass_through":
            if line["currency"] != profile["original"]["currency"] or line["tax_basis"] != profile["original"]["tax_basis"]:
                raise BillingError("Keep the selected tariff's original currency and tax classification.",
                                   "BILLING_SOURCE_BASIS")
        elif line["currency"] != profile["original"]["currency"]:
            _warning(warnings, "ACTUAL_COST_ORIGINAL_CURRENCY",
                     "The actual cost retains its original currency in its own group.", line=key, unresolved=False)
        credit_ref = line.get("credit_of_line_key")
        if credit_ref is not None:
            _text(credit_ref, "original credited line key")
        is_credit = credit_ref is not None
        applies = _applicability(line, profile, policy, warnings)
        before = None
        if is_credit:
            _text(line.get("credit_of_line_key"), "original credited line key")
            _text(line.get("source_document_key"), "original credit source document")
            before = _number(line.get("net_amount"), "Original credit net amount")
            if before > 0:
                raise BillingError("A credit line must retain a nonpositive original net amount.")
            if line["credit_of_line_key"] == key:
                raise BillingError("A credit cannot refer to itself.")
        elif quantity < 0:
            raise BillingError("A negative charge needs its explicit original credit_of_line_key.")
        elif rule["mode"] == "pass_through":
            if quantity != 1:
                raise BillingError("Retain one original actual-cost total per line; do not multiply a total again.")
            _text(line.get("source_document_key"), "actual-cost source document")
            before = _number(line.get("net_amount"), "Original actual-cost net amount")
            if before < 0:
                raise BillingError("A negative actual cost needs its original credit link.")
        else:
            before = quantity * rule["rate"]
            if rule["mode"] == "site_administration":
                factor = _number(rule["original"].get("assessment_unit_factor"), "Selected assessment-unit factor")
                base = profile["rules"].get(pid + ":annual-administration")
                if base is None or base["rate"] * factor != rule["rate"]:
                    raise BillingError("The site factor does not reconcile to its original administration rate.",
                                       "BILLING_SITE_FACTOR")
        if line.get("rate") not in (None, "") and rule["rate"] is not None:
            if _number(line["rate"], "Original received rate") != rule["rate"]:
                _warning(warnings, "ORIGINAL_RATE_DIFFERENCE",
                         "The original line rate differs from the selected source tariff; both are retained.", line=key, unresolved=False)
        raw_net[key] = None if applies is None else (before if applies else Fraction(0))
        gid = "bill-group-" + _sha(list(scope))
        groups[scope].append(key)
        selected_policy = policies.get((line["currency"], line["tax_basis"]))
        cap_id = None
        cap_tariff = profile["caps"].get(tariff)
        if cap_tariff and not is_credit:
            cap_key = _text(line.get("cap_group_key"), "explicit cap_group_key")
            cap_rule = profile["rules"][cap_tariff]
            if line["group_scope"]["kind"] != cap_rule["original"].get("charge_unit"):
                raise BillingError("The selected cap scope must retain the published laboratory or inspection-body unit.",
                                   "BILLING_CAP_SCOPE")
            cap_id = "cap-" + _sha([*scope, cap_key, cap_tariff])
            cap_groups.setdefault(cap_id, {"keys": [], "scope": scope, "tariff_key": cap_tariff,
                                          "cap_group_key": cap_key, "limit": cap_rule["rate"]})["keys"].append(key)
        items[key] = {"index": index, "original": line, "scope": scope, "group_id": gid,
                      "rule": rule, "profile": profile, "policy": selected_policy,
                      "quantity": quantity, "before": before, "applies": applies,
                      "after_applicability": raw_net[key],
                      "credit": is_credit, "cap_id": cap_id}
    cap_receipts = []
    cap_constraints = {}
    for cap_id, cap in sorted(cap_groups.items()):
        keys = sorted(cap["keys"])
        known = all(raw_net[key] is not None for key in keys)
        before = sum((raw_net[key] for key in keys), Fraction(0)) if known else None
        target = min(before, cap["limit"]) if known else None
        active = known and before > cap["limit"]
        allocation = policy.get("cap_allocation")
        if not known or (active and allocation is None):
            for key in keys:
                raw_net[key] = None
            _warning(warnings, "CAP_INPUTS_UNRESOLVED" if not known else "CAP_ALLOCATION_REQUIRED",
                     "Retain complete cap-group decisions and the explicit allocation choice.",
                     group=items[keys[0]]["group_id"], details={"cap_id": cap_id, "line_keys": keys})
        elif active and allocation == "proportional":
            for key in keys:
                raw_net[key] = raw_net[key] * target / before
        elif active:
            available = target
            for key in keys:
                retained = min(raw_net[key], available)
                raw_net[key] = retained
                available -= retained
        cap_constraints[cap_id] = (keys, cap["limit"])
        cap_receipts.append({"cap_id": cap_id, "tariff_key": cap["tariff_key"],
                             "cap_group_key": cap["cap_group_key"], "scope": _scope_value(cap["scope"]),
                             "line_keys": keys, "uncapped": _exact(before), "limit": _exact(cap["limit"]),
                             "capped": _exact(target), "reduction": _exact(None if before is None else before - target),
                             "active": active if known else None, "allocation": allocation if active else "not_required",
                             "complete": all(raw_net[key] is not None for key in keys)})
    for scope, keys in groups.items():
        gid = items[keys[0]]["group_id"]
        selected = items[keys[0]]["policy"]
        rounding = selected["rounding"] if selected else None
        if rounding is None:
            _warning(warnings, "ROUNDING_POLICY_REQUIRED",
                     "Retain the original invoice rounding policy before producing rounded charge amounts.", group=gid)
            continue
        if not all(raw_net[key] is not None for key in keys):
            _warning(warnings, "GROUP_CALCULATION_UNRESOLVED",
                     "An unresolved original line keeps this complete billing group unresolved.", group=gid)
            continue
        caps = {cap_id: value for cap_id, value in cap_constraints.items() if value[0][0] in keys}
        if rounding["net_scope"] == "group":
            rounded_net.update(_allocate({key: raw_net[key] for key in keys},
                                         _round(sum((raw_net[key] for key in keys), Fraction(0)), rounding),
                                         rounding, caps))
        else:
            candidate = {key: _round(raw_net[key], rounding) for key in keys}
            unresolved_cap_rounding = False
            for cap_id, (cap_keys, limit) in caps.items():
                if sum((candidate[key] for key in cap_keys), Fraction(0)) <= limit:
                    continue
                if policy.get("cap_allocation") is None:
                    unresolved_cap_rounding = True
                    _warning(warnings, "CAP_ROUNDING_ALLOCATION_REQUIRED",
                             "The selected line rounding exceeds the cap; retain an explicit allocation choice.",
                             group=gid, details={"cap_id": cap_id, "line_keys": cap_keys})
                    continue
                values = {key: raw_net[key] for key in cap_keys}
                candidate.update(_allocate(values, limit, rounding, {cap_id: (cap_keys, limit)}))
            if unresolved_cap_rounding:
                continue
            rounded_net.update(candidate)
        tax = selected["tax"]
        if tax is None:
            _warning(warnings, "TAX_POLICY_REQUIRED",
                     "Retain the original tax rate and calculation basis; missing tax is not numerical zero.", group=gid)
            continue
        for key in keys:
            basis = rounded_net[key] if tax["basis"] == "rounded_net" else raw_net[key]
            raw_tax[key] = basis * tax["_rate"]
        if rounding["tax_scope"] == "group":
            rounded_tax.update(_allocate({key: raw_tax[key] for key in keys},
                                         _round(sum((raw_tax[key] for key in keys), Fraction(0)), rounding),
                                         rounding))
        else:
            rounded_tax.update({key: _round(raw_tax[key], rounding) for key in keys})
        gross.update({key: rounded_net[key] + rounded_tax[key] for key in keys})
    for receipt in cap_receipts:
        keys = receipt["line_keys"]
        total = sum((rounded_net[key] for key in keys), Fraction(0)) if all(key in rounded_net for key in keys) else None
        raw_total = sum((raw_net[key] for key in keys), Fraction(0)) if all(raw_net[key] is not None for key in keys) else None
        selected = items[keys[0]]["policy"]
        receipt["rounded_net"] = _exact(total)
        receipt["rounding_adjustment"] = _exact(None if total is None or raw_total is None else total - raw_total)
        receipt["rounding"] = deepcopy(selected["rounding"]) if selected else None
        receipt["rounding_allocation"] = "largest_remainder_by_original_line_key_when_required_by_received_scope_or_cap"
        receipt["rounded_within_cap"] = None if total is None else total <= cap_groups[receipt["cap_id"]]["limit"]
        receipt["complete"] = receipt["complete"] and total is not None
    credit_receipts, credit_warnings = _credit_audit(
        {key: item["original"] for key, item in items.items()},
        {"net_amount": rounded_net, "tax_amount": rounded_tax, "gross_amount": gross}, policy)
    warnings.extend(credit_warnings)
    line_outputs = []
    for key, item in sorted(items.items(), key=lambda entry: entry[1]["index"]):
        original = item["original"]
        rounding = item["policy"]["rounding"] if item["policy"] else None
        places = rounding["decimal_places"] if rounding else None
        canonical = {field: deepcopy(original[field]) for field in CANONICAL_FIELDS if field in original}
        canonical["quantity"] = _decimal(item["quantity"])
        if item["rule"]["rate"] is not None and not item["credit"]:
            canonical["rate"] = _decimal(item["rule"]["rate"])
        for field, amounts in (("net_amount", rounded_net), ("tax_amount", rounded_tax), ("gross_amount", gross)):
            if key in amounts:
                canonical[field] = _display(amounts[key], places)
            else:
                canonical.pop(field, None)
        trace = {"profile_id": original["fee_profile_id"], "profile_sha256": item["profile"]["sha256"],
                 "source_edition_id": item["profile"]["original"]["source_edition_id"],
                 "tariff_key": original["tariff_key"], "tariff_sha256": _sha(item["rule"]["original"]),
                 "mode": item["rule"]["mode"], "quantity": _exact(item["quantity"]),
                 "source_rate": _exact(item["rule"]["rate"]), "uncapped_net": _exact(item["before"]),
                 "net_after_applicability": _exact(item["after_applicability"]),
                 "applicability_reduction": _exact(None if item["after_applicability"] is None else
                                                  item["before"] - item["after_applicability"]),
                 "net_after_applicability_and_cap": _exact(raw_net.get(key)),
                 "cap_reduction": _exact(None if raw_net.get(key) is None or item["after_applicability"] is None
                                        else item["after_applicability"] - raw_net[key]),
                 "unrounded_tax": _exact(raw_tax.get(key)), "rounded_net": _exact(rounded_net.get(key)),
                 "rounded_tax": _exact(rounded_tax.get(key)), "gross": _exact(gross.get(key)),
                 "cap_id": item["cap_id"], "policy_id": item["policy"]["policy_id"] if item["policy"] else None,
                 "rounding": deepcopy(rounding), "tax": None if item["policy"] is None else
                    ({k: deepcopy(v) for k, v in item["policy"]["tax"].items() if k != "_rate"}
                     if item["policy"]["tax"] else None),
                 "net_rounding_adjustment": _exact(None if key not in rounded_net else rounded_net[key] - raw_net[key]),
                 "tax_rounding_adjustment": _exact(None if key not in rounded_tax else rounded_tax[key] - raw_tax[key])}
        differences = []
        for field in ("net_amount", "tax_amount", "gross_amount"):
            if field in original and original[field] not in (None, "") and field in canonical:
                actual = _number(original[field], "Original " + field)
                expected = _number(canonical[field], "Calculated " + field)
                if actual != expected:
                    differences.append({"field": field, "original": deepcopy(original[field]),
                                        "calculated": canonical[field], "difference": _exact(expected - actual)})
        complete = key in rounded_net and key in rounded_tax and key in gross
        line_outputs.append({"charge_line_key": key, "group_id": item["group_id"], "original": deepcopy(original),
                             "canonical": canonical, "calculation": trace, "original_amount_differences": differences,
                             "calculation_complete": complete,
                             "needs_authored_source": original["quantity_origin"] == "authored_operating_choice"
                                                      and not canonical.get("source_document_key")})
    group_outputs = []
    for scope, keys in sorted(groups.items()):
        first = items[keys[0]]
        group_outputs.append({"group_id": first["group_id"], "scope": _scope_value(scope), "line_keys": list(keys),
                              "uncapped_net": _metric({key: items[key]["before"] for key in keys}, keys),
                              "net_after_cap": _metric(raw_net, keys), "net": _metric(rounded_net, keys),
                              "tax": _metric(rounded_tax, keys), "gross": _metric(gross, keys),
                              "policy_id": first["policy"]["policy_id"] if first["policy"] else None,
                              "rounding": deepcopy(first["policy"]["rounding"]) if first["policy"] else None})
    totals = []
    for currency in sorted({item["original"]["currency"] for item in items.values()}):
        keys = [key for key, item in items.items() if item["original"]["currency"] == currency]
        totals.append({"currency": currency, "line_count": len(keys), "net": _metric(rounded_net, keys),
                       "tax": _metric(rounded_tax, keys), "gross": _metric(gross, keys),
                       "group_ids": [g["group_id"] for g in group_outputs if g["scope"]["currency"] == currency],
                       "aggregation": "Exact selected group totals in this currency; no currency conversion."})
    controls = _published_controls(pmap)
    if any(row["status"] != "PASS" for row in controls):
        _warning(warnings, "PUBLISHED_CONTROL_DIFFERENCE",
                 "The selected dated public profile differs from its retained published arithmetic control.")
    for row in line_outputs:
        key, gid = row["charge_line_key"], row["group_id"]
        relevant = [w for w in warnings if w["unresolved"] and (
            w.get("charge_line_key") == key or w.get("group_id") == gid or
            key in (w.get("details") or {}).get("line_keys", []) or
            (not w.get("charge_line_key") and not w.get("group_id") and
             not (w.get("details") or {}).get("line_keys")))]
        row["unresolved_controls"] = [w["code"] for w in relevant]
        row["calculated_ready_for_authored_source"] = row["calculation_complete"] and row["needs_authored_source"] and all(
            w["code"] == "AUTHORED_SOURCE_DOCUMENT_REQUIRED" for w in relevant)
        row["canonical_ready"] = row["calculation_complete"] and not relevant and bool(
            row["canonical"].get("source_document_key"))
    ready = bool(line_outputs) and all(row["canonical_ready"] for row in line_outputs)
    return {"schema": SCHEMA, "inputs_sha256": _sha({"lines": lines, "profiles": profiles, "policy": policy}),
            "lines": line_outputs, "groups": group_outputs, "totals": totals, "warnings": warnings,
            "controls": {"calculation_complete": all(row["calculation_complete"] for row in line_outputs),
                         "canonical_ready": ready, "original_lines": len(lines), "calculated_lines": len(line_outputs),
                         "published": controls, "caps": cap_receipts, "credits": credit_receipts,
                         "rounding_policy_origin": policy.get("origin"), "policy_sha256": _sha(policy)}}


def _observed(row, field, numeric=False):
    value = row.get(field, MISSING)
    if value is MISSING:
        return {"state": "missing"}, None
    if value is None:
        return {"state": "null", "value": None}, None
    if value == "":
        return {"state": "blank", "value": ""}, None
    if not numeric:
        return {"state": "value", "value": deepcopy(value)}, None
    try:
        number = _number(value, "Original comparison " + field)
        return {"state": "value", "value": deepcopy(value), "exact": _exact(number)}, number
    except BillingError as exc:
        return {"state": "invalid", "value": deepcopy(value), "error": str(exc)}, None


def _reconcile_rows(value, label):
    rows = value.get("lines") if isinstance(value, dict) else value
    rows = _list(rows, label)
    result = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise BillingError("Every selected " + label + " row must be an object.")
        if "canonical" in row or "original" in row:
            if not isinstance(row.get("canonical"), dict) or not isinstance(row.get("original"), dict):
                raise BillingError("A calculated comparison row must retain both original and canonical objects.")
            # Missing calculated money never falls back to a stale original amount.
            selected = {key: deepcopy(v) for key, v in row["original"].items() if key not in CANONICAL_FIELDS}
            selected.update(deepcopy(row["canonical"]))
            unresolved = row.get("calculation_complete") is not True
        else:
            selected, unresolved = deepcopy(row), False
        result.append({"index": index, "line": selected, "calculation_unresolved": unresolved,
                       "retained": deepcopy(row)})
    return result


def _comparison_groups(rows, duplicate_keys):
    buckets, unassigned = defaultdict(list), []
    for entry in rows:
        try:
            scope = _scope(entry["line"])
        except BillingError as exc:
            unassigned.append({"index": entry["index"], "line": deepcopy(entry["line"]),
                               "error": str(exc), "code": exc.code})
            continue
        buckets[scope].append(entry)
    groups = {}
    for scope, selected in sorted(buckets.items()):
        line_refs = [{"index": r["index"], "charge_line_key": r["line"].get("charge_line_key")} for r in selected]
        identity_unresolved = [r["index"] for r in selected if (
            not isinstance(r["line"].get("charge_line_key"), str) or
            not r["line"]["charge_line_key"].strip() or r["line"]["charge_line_key"] in duplicate_keys or
            r["calculation_unresolved"])]
        metrics = {}
        for field in ("net_amount", "tax_amount", "gross_amount"):
            total, known, missing = Fraction(0), 0, []
            for row in selected:
                observed, amount = _observed(row["line"], field, True)
                if amount is None:
                    missing.append({"index": row["index"], "charge_line_key": row["line"].get("charge_line_key"),
                                    "observed": observed})
                else:
                    total += amount
                    known += 1
            complete = not missing and not identity_unresolved
            metrics[field] = {"total": _exact(total) if complete else None, "known_subtotal": _exact(total),
                              "complete": complete, "known_lines": known, "missing": missing,
                              "unresolved_identity_indices": list(identity_unresolved)}
        gid = "bill-group-" + _sha(list(scope))
        groups[gid] = {"group_id": gid, "scope": _scope_value(scope), "line_count": len(selected),
                       "line_refs": line_refs, "amounts": metrics,
                       "complete": all(metric["complete"] for metric in metrics.values())}
    return groups, unassigned


def _reconcile_caps(rows, pmap):
    selected, unresolved = {}, []
    for entry in rows:
        line = entry["line"]
        profile = pmap.get(line.get("fee_profile_id"))
        if profile is None or line.get("credit_of_line_key") is not None:
            continue
        cap_tariff = profile["caps"].get(line.get("tariff_key"))
        if cap_tariff is None:
            continue
        try:
            scope = _scope(line)
            cap_key = _text(line.get("cap_group_key"), "original cap_group_key")
            rule = profile["rules"][cap_tariff]
            if line["group_scope"]["kind"] != rule["original"].get("charge_unit"):
                raise BillingError("The selected cap unit differs from the original laboratory/inspection-body unit.")
        except BillingError as exc:
            unresolved.append({"index": entry["index"], "charge_line_key": line.get("charge_line_key"),
                               "error": str(exc)})
            continue
        cid = "cap-" + _sha([*scope, cap_key, cap_tariff])
        item = selected.setdefault(cid, {"cap_id": cid, "scope": _scope_value(scope), "cap_group_key": cap_key,
                                        "tariff_key": cap_tariff, "limit": rule["rate"], "rows": []})
        item["rows"].append(entry)
    output = []
    for cid, item in sorted(selected.items()):
        subtotal, missing, observed_rows = Fraction(0), [], []
        seen, ambiguous, negative = set(), [], []
        for entry in item["rows"]:
            line, index = entry["line"], entry["index"]
            key = line.get("charge_line_key")
            observed, value = _observed(line, "net_amount", True)
            observed_rows.append({"index": index, "charge_line_key": key, "net": observed})
            if not isinstance(key, str) or not key.strip() or key in seen or entry["calculation_unresolved"]:
                ambiguous.append(index)
            if isinstance(key, str):
                seen.add(key)
            if value is None:
                missing.append(index)
            else:
                subtotal += value
                if value < 0:
                    negative.append(index)
        complete = not missing and not ambiguous and not negative
        output.append({k: deepcopy(v) for k, v in item.items() if k not in {"limit", "rows"}} | {
            "limit": _exact(item["limit"]), "line_amounts": observed_rows, "known_net": _exact(subtotal),
            "net": _exact(subtotal) if complete else None, "complete": complete,
            "over_cap": subtotal > item["limit"] if complete else None,
            "excess": _exact(max(Fraction(0), subtotal - item["limit"])) if complete else None,
            "missing_indices": missing, "ambiguous_indices": ambiguous, "negative_noncredit_indices": negative,
            "basis": "Positive original charges are checked before credits; credits do not enlarge the cap."})
    return {"groups": output, "unassigned": unresolved,
            "complete": not unresolved and all(row["complete"] for row in output)}


def reconcile_billing(expected, returned, profiles, policy) -> dict:
    """Compare full original lines first, then explicit groups, caps and credit lineage.

    Pass plain received records to compare their retained amounts. Pass a
    calculate_bill result to compare its independently calculated canonical
    amounts. This function never rerates or mutates either selected record set.
    """
    inputs = {"expected": expected, "returned": returned, "profiles": profiles, "policy": policy}
    _json(inputs)
    pmap, selected_policies = _profiles(profiles), _policies(policy)
    left, right = _reconcile_rows(expected, "expected charge lines"), _reconcile_rows(returned, "returned charge lines")
    differences, representations, unresolved = [], [], []

    def difference(kind, expected_value, returned_value, **context):
        body = {"kind": kind, **context, "expected": deepcopy(expected_value), "returned": deepcopy(returned_value)}
        row = {"difference_id": "bill-difference-" + _sha(body), **body}
        differences.append(row)
        return row

    def index_rows(rows, side):
        index, duplicates = defaultdict(list), set()
        for row in rows:
            key = row["line"].get("charge_line_key")
            if not isinstance(key, str) or not key.strip():
                issue = {"side": side, "index": row["index"], "line": deepcopy(row["line"]),
                         "reason": "Original charge_line_key is missing or invalid."}
                unresolved.append(issue)
                difference("invalid_line_identity", issue if side == "expected" else None,
                           issue if side == "returned" else None, side=side, row_index=row["index"])
                continue
            index[key].append(row)
            if row["calculation_unresolved"]:
                unresolved.append({"side": side, "index": row["index"], "charge_line_key": key,
                                   "reason": "The selected independent calculation is unresolved."})
            profile = pmap.get(row["line"].get("fee_profile_id"))
            if profile is None or row["line"].get("tariff_key") not in profile["rules"]:
                issue = {"side": side, "index": row["index"], "charge_line_key": key,
                         "reason": "Select the complete original fee profile and tariff for this line."}
                unresolved.append(issue)
                difference("profile_selection", issue if side == "expected" else None,
                           issue if side == "returned" else None, side=side, charge_line_key=key)
        for key, values in index.items():
            if len(values) > 1:
                duplicates.add(key)
                full = [deepcopy(v["retained"]) for v in values]
                difference("duplicate_original_line", full if side == "expected" else None,
                           full if side == "returned" else None, charge_line_key=key, side=side)
                unresolved.append({"side": side, "charge_line_key": key,
                                   "indices": [v["index"] for v in values],
                                   "reason": "All duplicate original rows remain retained; none is chosen automatically."})
        return index, duplicates

    lindex, lduplicate = index_rows(left, "expected")
    rindex, rduplicate = index_rows(right, "returned")
    matched_lines = missing_lines = extra_lines = 0
    for key in sorted(set(lindex) | set(rindex)):
        lrows, rrows = lindex.get(key, []), rindex.get(key, [])
        if len(lrows) > 1 or len(rrows) > 1:
            continue
        if not lrows:
            extra_lines += 1
            difference("extra_original_line", None, rrows[0]["retained"], charge_line_key=key)
            continue
        if not rrows:
            missing_lines += 1
            difference("missing_original_line", lrows[0]["retained"], None, charge_line_key=key)
            continue
        lrow, rrow = lrows[0]["line"], rrows[0]["line"]
        before = len(differences)
        unresolved_before = len(unresolved)
        for field in IDENTITY_FIELDS:
            lv, _ = _observed(lrow, field)
            rv, _ = _observed(rrow, field)
            if _json(lv) != _json(rv):
                difference("line_identity", lv, rv, charge_line_key=key, field=field)
        for field in NUMBER_FIELDS:
            lv, ln = _observed(lrow, field, True)
            rv, rn = _observed(rrow, field, True)
            optional_rate = field == "rate" and lv["state"] == rv["state"] == "missing"
            if optional_rate:
                continue
            if ln is None or rn is None:
                if field != "rate" or lv["state"] == "invalid" or rv["state"] == "invalid":
                    unresolved.append({"charge_line_key": key, "field": field,
                                       "expected": lv, "returned": rv, "reason": "A required original numeric value is unavailable."})
                if _json(lv) != _json(rv) or lv["state"] == "invalid" or rv["state"] == "invalid":
                    difference("line_numeric_state", lv, rv, charge_line_key=key, field=field)
            elif ln != rn:
                difference("line_amount" if field.endswith("_amount") else "line_quantity_or_rate",
                           lv, rv, charge_line_key=key, field=field, difference=_exact(rn - ln))
            elif _json(lv["value"]) != _json(rv["value"]):
                representations.append({"charge_line_key": key, "field": field, "expected": lv["value"],
                                        "returned": rv["value"], "exact_value": _exact(ln)})
        if len(differences) == before and len(unresolved) == unresolved_before:
            matched_lines += 1
    # No grouped aggregation occurs until every selected original line is indexed and compared.
    lgroups, lunassigned = _comparison_groups(left, lduplicate)
    rgroups, runassigned = _comparison_groups(right, rduplicate)
    for side, rows in (("expected", lunassigned), ("returned", runassigned)):
        for row in rows:
            issue = {"side": side, **row}
            unresolved.append(issue)
            difference("billing_group_unresolved", row if side == "expected" else None,
                       row if side == "returned" else None, side=side, row_index=row["index"])
    groups = []
    for gid in sorted(set(lgroups) | set(rgroups)):
        le, ri = lgroups.get(gid), rgroups.get(gid)
        before = len(differences)
        if le is None or ri is None:
            difference("extra_billing_group" if le is None else "missing_billing_group", le, ri, group_id=gid)
        else:
            for field in ("net_amount", "tax_amount", "gross_amount"):
                lv, rv = le["amounts"][field], ri["amounts"][field]
                if not lv["complete"] or not rv["complete"]:
                    unresolved.append({"group_id": gid, "field": field, "expected": lv, "returned": rv,
                                       "reason": "Group totals cannot conceal incomplete original lines."})
                elif lv["total"] != rv["total"]:
                    ln = Fraction(int(lv["total"]["numerator"]), int(lv["total"]["denominator"]))
                    rn = Fraction(int(rv["total"]["numerator"]), int(rv["total"]["denominator"]))
                    difference("billing_group_amount", lv, rv, group_id=gid, field=field, difference=_exact(rn - ln))
        scope = (le or ri)["scope"]
        rule = selected_policies.get((scope["currency"], scope["tax_basis"]))
        groups.append({"group_id": gid, "scope": deepcopy(scope), "expected": le, "returned": ri,
                       "same_totals": le is not None and ri is not None and le["complete"] and ri["complete"]
                                      and all(le["amounts"][f]["total"] == ri["amounts"][f]["total"]
                                              for f in ("net_amount", "tax_amount", "gross_amount")),
                       "difference_count": len(differences) - before,
                       "rounding_basis": deepcopy(rule["original"]) if rule else None,
                       "aggregation": "Exact original line values; no extra rounding, currency conversion or netting."})
    caps = {"expected": _reconcile_caps(left, pmap), "returned": _reconcile_caps(right, pmap)}
    credits = {}
    for side, index in (("expected", lindex), ("returned", rindex)):
        unique = {key: rows[0]["line"] for key, rows in index.items() if len(rows) == 1}
        try:
            receipts, warnings = _credit_audit(unique, {}, policy)
        except BillingError as exc:
            receipts, warnings = [], [{"code": exc.code, "message": str(exc), "unresolved": True}]
        credits[side] = {"groups": receipts, "warnings": warnings, "complete": not any(w["unresolved"] for w in warnings)}
        for warning in warnings:
            if warning["unresolved"]:
                unresolved.append({"side": side, "reason": "Original credit lineage remains unresolved.", "control": warning})
        for group in caps[side]["groups"]:
            if group["over_cap"]:
                difference("original_cap_exceeded", group if side == "expected" else None,
                           group if side == "returned" else None, side=side, cap_id=group["cap_id"])
        if not caps[side]["complete"]:
            unresolved.append({"side": side, "reason": "Original cap allocation remains unresolved.", "control": caps[side]})
    published = _published_controls(pmap)
    if any(row["status"] != "PASS" for row in published):
        unresolved.append({"reason": "The selected public profile differs from the retained published controls.",
                           "controls": published})
    complete = not unresolved
    return {"schema": "tjlabs.ianz-billing-reconciliation.v1", "inputs_sha256": _sha(inputs),
            "differences": differences, "representations": representations, "groups": groups,
            "cap_allocations": caps, "credits": credits, "published_controls": published,
            "summary": {"expected_lines": len(left), "returned_lines": len(right),
                        "matched_line_values_and_identity": matched_lines, "missing_lines": missing_lines,
                        "extra_lines": extra_lines, "duplicate_expected_keys": sorted(lduplicate),
                        "duplicate_returned_keys": sorted(rduplicate), "difference_count": len(differences),
                        "representation_changes": len(representations), "comparison_complete": complete,
                        "matches": complete and not differences, "unresolved": unresolved,
                        "comparison_order": ["original_lines", "billing_groups", "cap_allocations", "original_credit_lineage"],
                        "profile_sha256": _sha(profiles), "policy_sha256": _sha(policy)}}

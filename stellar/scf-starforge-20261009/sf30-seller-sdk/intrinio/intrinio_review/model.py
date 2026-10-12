"""Exact retained Intrinio statement interpretation; no acquisition or storage."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
from urllib.parse import parse_qsl, urlsplit

SDK_COMMIT = "b5918a9123f0ccbe624f559e8ab5a6c8e73c01c6"
SCHEMA = "intrinio.review.response.v1"
OPERATIONS = {
    "reported_financials": ("reported_financials", "reported"),
    "standardized_financials": ("standardized_financials", "standardized"),
    "standardized_dimensions": ("dimensions", "dimensions"),
    "fundamental": (None, "fundamental"),
    "filing": (None, "filing"),
    "company_fundamentals": ("fundamentals", "fundamentals"),
    "filing_fundamentals": ("fundamentals", "fundamentals"),
    "company_filings": ("filings", "filings"),
    "filings": ("filings", "filings"),
    "company": (None, "company"),
    "bulk_index": ("bulk_downloads", "bulk"),
}
ALIASES = {
    "get_fundamental_reported_financials": "reported_financials",
    "get_fundamental_standardized_financials": "standardized_financials",
    "get_fundamental_standardized_financials_dimensions": "standardized_dimensions",
    "get_fundamental_by_id": "fundamental",
    "get_filing_by_id": "filing",
    "get_company_fundamentals": "company_fundamentals",
    "get_filing_fundamentals": "filing_fundamentals",
    "get_company_filings": "company_filings",
    "get_all_filings": "filings",
    "get_company": "company", "lookup_fundamental": "fundamental",
    "get_bulk_download_links": "bulk_index",
    "fundamental_lookup": "fundamental",
}
SOURCE_KINDS = {"provider_api", "documentation_example", "sdk_export", "customer_export"}
NUMBER = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\Z")
SECRET_KEYS = {"api_key", "apikey", "authorization", "access_token", "password", "secret", "token"}
MAX_RESPONSE_BYTES = 32 * 1024 * 1024


class ReviewError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


class NumberLexeme(str):
    """JSON number token retained before any binary floating-point conversion."""


def _pairs(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ReviewError("DUPLICATE_JSON_KEY", "A response contains a repeated JSON object key.")
        value[key] = item
    return value


def load_json(raw):
    if not isinstance(raw, bytes):
        raise ReviewError("BODY_REQUIRED", "Import the complete original response as bytes.")
    if not raw or len(raw) > MAX_RESPONSE_BYTES:
        raise ReviewError("BODY_SIZE", "A response must contain 1 to 33,554,432 bytes; it is never clipped.")
    try:
        return json.loads(
            raw.decode("utf-8-sig"), parse_int=NumberLexeme, parse_float=NumberLexeme,
            parse_constant=lambda _value: (_ for _ in ()).throw(
                ReviewError("NONFINITE_JSON", "Nonfinite JSON numbers are not supported.")),
            object_pairs_hook=_pairs,
        )
    except ReviewError:
        raise
    except (UnicodeError, ValueError, RecursionError) as error:
        raise ReviewError("INVALID_JSON", "The response is not a complete supported UTF-8 JSON document.") from error


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def _obj(value, label):
    if not isinstance(value, dict):
        raise ReviewError("RESPONSE_SHAPE", label + " must be an object.")
    return value


def _text(value):
    return str(value) if isinstance(value, str) else None


def _source(source, raw):
    if isinstance(source, dict) and "sourceKind" in source:
        original = source
        kinds = {"provider-api-response": "provider_api",
                 "customer-retained-provider-response": "customer_export",
                 "provider-published-documentation-example": "documentation_example"}
        provenance, request = original.get("provenance") or {}, original.get("request") or {}
        kind = kinds.get(original.get("sourceKind"))
        if original.get("originalWireBytes") is True and kind == "customer_export":
            kind = "provider_api"
        source = {**original, "kind": kind, "original_kind": original.get("kind"),
                  "parameters": {"path": request.get("pathParams", {}), "query": request.get("query", {})},
                  "url": request.get("url") or provenance.get("url"),
                  "retrieved_at": original.get("capturedAt")}
    if not isinstance(source, dict) or source.get("kind") not in SOURCE_KINDS:
        raise ReviewError("SOURCE_KIND", "Choose provider_api, documentation_example, sdk_export or customer_export.")
    try:
        result = json.loads(canonical(source), object_pairs_hook=_pairs)
    except (TypeError, ValueError) as error:
        raise ReviewError("SOURCE_METADATA", "Source metadata must be finite JSON values.") from error
    parameters = result.get("parameters", {})
    if not isinstance(parameters, dict):
        raise ReviewError("SOURCE_PARAMETERS", "Source parameters must be an object.")
    if any(str(key).lower().replace("-", "_") in SECRET_KEYS for key in parameters):
        raise ReviewError("CREDENTIAL_METADATA", "Keep credentials outside request metadata.")
    url = result.get("url")
    if url:
        if not isinstance(url, str):
            raise ReviewError("SOURCE_URL", "The source URL must be text.")
        parsed = urlsplit(url)
        if parsed.scheme not in ("https", "http") or not parsed.netloc or parsed.username or parsed.password:
            raise ReviewError("SOURCE_URL", "Use a complete HTTP(S) source URL without embedded credentials.")
        if any(key.lower().replace("-", "_") in SECRET_KEYS for key, _ in parse_qsl(parsed.query)):
            raise ReviewError("CREDENTIAL_URL", "Keep API keys and credentials out of retained source URLs.")
    result["parameters"] = parameters
    result["body_sha256"] = hashlib.sha256(raw).hexdigest()
    result["body_bytes"] = len(raw)
    result.setdefault("sdk_commit", SDK_COMMIT)
    return result


def _fundamental(body, family):
    if family == "fundamental":
        return body
    candidate = body.get("fundamental")
    return candidate if isinstance(candidate, dict) else None


def _coverage(body, family):
    if family in ("fundamental", "filing", "dimensions", "company", "bulk"):
        return {"status": "single_response", "complete": True, "next_page": None,
                "scope": "This original response only; it does not assert coverage of other statements or filings."}
    if "next_page" not in body:
        return {"status": "continuation_not_declared", "complete": False, "next_page": None,
                "scope": "The response did not declare a terminal cursor."}
    next_page = body["next_page"]
    if next_page is not None and not isinstance(next_page, str):
        raise ReviewError("CURSOR_SHAPE", "next_page must be text or null.")
    terminal = next_page is None
    result = {"status": "terminal_response" if terminal else "continuation_present",
              "complete": terminal, "next_page": next_page,
              "scope": "This original endpoint response; completeness of an entire paged capture is evaluated separately."}
    if not terminal and family in ("reported", "standardized"):
        result["continuation_support"] = "The pinned SDK financial endpoint has no next_page argument."
    return result


def _dimensions(value):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ReviewError("DIMENSION_SHAPE", "Reported dimensions must be an array or null.")
    retained = []
    for item in value:
        item = _obj(item, "A reported dimension")
        axis, member = _text(item.get("axis")), _text(item.get("member"))
        if not axis or not member:
            raise ReviewError("DIMENSION_IDENTITY", "Each reported dimension needs an exact axis and member.")
        retained.append({"axis": axis, "member": member, "provider_dimension": item})
    # The original order is retained in provider_row. Identity is order-independent.
    return sorted(retained, key=lambda item: (item["axis"], item["member"], canonical(item["provider_dimension"])))


def _value(raw):
    if raw is None:
        return None, "null"
    if isinstance(raw, NumberLexeme):
        return str(raw), "json_number"
    if isinstance(raw, str) and NUMBER.fullmatch(raw):
        return raw, "decimal_text"
    # Preserve an unusual provider value without inventing a numerical interpretation.
    return raw, "non_numeric"


def _fact(item, family, source_sha, index, fundamental):
    tag_field = "xbrl_tag" if family == "reported" else "data_tag"
    tag = _obj(item.get(tag_field), "The " + tag_field)
    tag_code = _text(tag.get("tag"))
    tag_id = _text(tag.get("id"))
    if not tag_code and not tag_id:
        raise ReviewError("FACT_IDENTITY", "Each financial row needs its original tag or data-tag ID.")
    dimensions = _dimensions(item.get("dimensions")) if family == "reported" else []
    identity = {
        "family": family, "tag": tag_code or tag_id, "tag_id": tag_id,
        "unit": _text(tag.get("unit")),
        "dimensions": [{"axis": item["axis"], "member": item["member"]} for item in dimensions],
    }
    value, value_kind = _value(item.get("value")) if "value" in item else (None, "missing")
    pointer = "/" + ("reported_financials" if family == "reported" else "standardized_financials") + "/" + str(index)
    return {
        "id": hashlib.sha256((source_sha + ":" + pointer).encode()).hexdigest(),
        "identity": digest(identity), "identity_fields": identity, "source_pointer": pointer,
        "record_identity": digest({"fundamental_id": (fundamental or {}).get("id"), **identity}),
        "tag": tag_code, "tag_id": tag_id, "name": _text(tag.get("name")) or tag_code or tag_id,
        "unit": _text(tag.get("unit")), "balance": _text(tag.get("balance")),
        "abstract": tag.get("abstract") is True, "sequence": tag.get("sequence"),
        "depth": tag.get("depth"), "parent": tag.get("parent"), "factor": tag.get("factor"),
        "value": value, "value_kind": value_kind, "dimensions": dimensions, "provider_row": item,
    }



def _dimension_fact(item, tag, source_sha, index):
    tag = _obj(tag, "The original standardized data_tag")
    dimension = item.get("dimension")
    if dimension is not None and not isinstance(dimension, str):
        raise ReviewError("DIMENSION_SHAPE", "A standardized dimension label must remain its original text or null.")
    dimension_present = "dimension" in item
    dimension_label = dimension if isinstance(dimension, str) else ("dimension: null" if dimension_present else "dimension not supplied")
    tag_code, tag_id = _text(tag.get("tag")), _text(tag.get("id"))
    if not tag_code and not tag_id:
        raise ReviewError("FACT_IDENTITY", "A standardized dimension needs its original data-tag identity.")
    unit = _text(tag.get("unit"))
    dimensions = [{"dimension": dimension}] if dimension_present else [{"dimension_missing": True}]
    identity = {"family": "dimensions", "tag": tag_code or tag_id, "tag_id": tag_id,
                "unit": unit, "dimensions": dimensions}
    value, kind = _value(item.get("value")) if "value" in item else (None, "missing")
    pointer = "/dimensions/" + str(index)
    return {"id": hashlib.sha256((source_sha + ":" + pointer).encode()).hexdigest(),
            "identity": digest(identity), "identity_fields": identity, "source_pointer": pointer,
            "tag": tag_code, "tag_id": tag_id, "name": (_text(tag.get("name")) or tag_code or tag_id) + " · " + dimension_label,
            "unit": unit, "balance": _text(tag.get("balance")), "abstract": tag.get("abstract") is True,
            "sequence": tag.get("sequence"), "depth": tag.get("depth"), "parent": tag.get("parent"),
            "factor": tag.get("factor"), "value": value, "value_kind": kind, "dimensions": dimensions,
            "provider_row": item, "provider_data_tag": tag}

def parse_response(raw_bytes, operation, source):
    """Interpret one complete retained body. Numbers remain their original JSON tokens."""
    operation = operation.removesuffix("_v2").replace("-", "_")
    operation = ALIASES.get(operation, operation)
    if operation not in OPERATIONS:
        raise ReviewError("OPERATION", "The response operation is not a supported pinned Intrinio endpoint.")
    body = _obj(load_json(raw_bytes), "The response")
    field, family = OPERATIONS[operation]
    source = _source(source, raw_bytes)
    source["operation"] = operation
    items = body.get(field) if field else []
    if field and not isinstance(items, list):
        raise ReviewError("RESPONSE_SHAPE", "The response needs its complete " + field + " array.")
    if any(not isinstance(item, dict) for item in items):
        raise ReviewError("RESPONSE_SHAPE", "Every " + (field or "response") + " row must be an object.")
    fundamental = _fundamental(body, family)
    if family in ("reported", "standardized", "dimensions") and fundamental is None:
        raise ReviewError("FUNDAMENTAL_REQUIRED", "Financial data needs its original fundamental object.")
    company = body if family == "company" else (fundamental or {}).get("company") or body.get("company")
    if company is not None and not isinstance(company, dict):
        raise ReviewError("COMPANY_SHAPE", "The original company must be an object or null.")
    facts = [_fact(item, family, source["body_sha256"], index, fundamental) for index, item in enumerate(items)] if family in ("reported", "standardized") else []
    if family == "dimensions":
        facts = [_dimension_fact(item, body.get("data_tag"), source["body_sha256"], index) for index, item in enumerate(items)]
    groups = defaultdict(list)
    for fact in facts:
        groups[fact["identity"]].append(fact["id"])
    duplicate_identities = [{"identity": key, "row_ids": values} for key, values in groups.items() if len(values) > 1]
    warnings = []
    if duplicate_identities:
        warnings.append("Some tag/dimension identities repeat; comparisons retain every row and mark those groups ambiguous.")
    if source["kind"] in ("sdk_export", "customer_export"):
        warnings.append("Numeric precision before the supplied export cannot be recovered from its JSON text.")
    if source["kind"] == "documentation_example":
        warnings.append("This is an explicitly identified provider documentation example, not an account acquisition.")
    if any(fact["value_kind"] == "non_numeric" for fact in facts):
        warnings.append("Unusual values are retained without numerical comparison.")
    filing = body if family == "filing" else (body.get("filing") if isinstance(body.get("filing"), dict) else None)
    result = {
        "schema": SCHEMA, "operation": operation, "family": family, "source": source,
        "fundamental": fundamental, "company": company, "filing": filing,
        "data_tag": body.get("data_tag"), "facts": facts,
        "catalog": items if not facts else [],
        "coverage": _coverage(body, family), "duplicate_identities": duplicate_identities,
        "warnings": warnings, "provider_metadata": {key: value for key, value in body.items() if key != field},
    }
    published = source.get("provenance", {}).get("observedCoverage", {})
    if source["kind"] == "documentation_example" and published.get("basis") == "complete-published-example" \
            and published.get("bodyComplete") is True and source.get("provenance", {}).get("documentationExcerpt") is False:
        result["coverage"]["published_scope"] = {"status": "complete", "basis": "complete-published-example",
                                                "api_collection": "not asserted"}
    # The original worker accepts ordinary JSON primitives, not custom scalar subclasses.
    return json.loads(canonical(result))


def _instant(value):
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result if result.tzinfo else result.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _numeric_delta(left, right):
    if not isinstance(left, str) or not isinstance(right, str) or not NUMBER.fullmatch(left) or not NUMBER.fullmatch(right):
        return {"status": "not_numeric", "value": None, "direction": None}
    try:
        a, b = Decimal(left), Decimal(right)
        at, bt = a.as_tuple(), b.as_tuple()
        lower = min(at.exponent, bt.exponent, 0)
        upper = max(a.adjusted(), b.adjusted(), 0)
        precision = upper - lower + 4
        if precision > 20000 or len(at.digits) > 20000 or len(bt.digits) > 20000:
            return {"status": "retained_outside_calculation_bound", "value": None, "direction": None}
        with localcontext() as context:
            context.prec = max(precision, 32)
            context.Emax = max(999999, upper + 10)
            context.Emin = min(-999999, lower - 10)
            difference = b - a
        return {"status": "exact", "value": str(difference),
                "direction": "increase" if difference > 0 else "decrease" if difference < 0 else "equal"}
    except (InvalidOperation, ValueError, OverflowError):
        return {"status": "retained_outside_calculation_bound", "value": None, "direction": None}


def compare_responses(left, right, *, mode="revision", binding=None):
    """Compare exact source editions; a missing row is never treated as zero."""
    if mode not in ("revision", "period"):
        raise ReviewError("COMPARE_MODE", "Choose revision or explicit period comparison.")
    if left.get("family") not in ("reported", "standardized", "dimensions") or left.get("family") != right.get("family"):
        return {"compatible": False, "reason": "Choose two responses from the same reported, standardized or standardized-dimension family.", "changes": []}
    a, b = left.get("fundamental") or {}, right.get("fundamental") or {}
    ac, bc = left.get("company") or {}, right.get("company") or {}
    if not ac.get("id") or ac.get("id") != bc.get("id"):
        return {"compatible": False, "reason": "The original company IDs must be present and equal.", "changes": []}
    fields = ["statement_code", "type"]
    if mode == "revision":
        fields += ["fiscal_year", "fiscal_period", "start_date", "end_date"]
    missing = [key for key in fields if a.get(key) is None or b.get(key) is None]
    changed = [key for key in fields if a.get(key) != b.get(key)]
    if missing or changed:
        return {"compatible": False, "reason": "Statement context differs or is missing.", "context_fields": sorted(set(missing + changed)), "changes": []}
    cross_identity = a.get("id") != b.get("id")
    if not a.get("id") or not b.get("id"):
        return {"compatible": False, "reason": "Both original fundamental IDs must be present.", "changes": []}
    if cross_identity and (not isinstance(binding, dict) or binding.get("fromFundamentalId") != a["id"]
                           or binding.get("toFundamentalId") != b["id"] or not binding.get("reviewer")
                           or not binding.get("note")):
        return {"compatible": False, "reason": "Different fundamental IDs require an explicit named comparison binding.",
                "binding_required": True, "changes": []}
    def request_scope(snapshot):
        parameters = snapshot["source"].get("parameters", {})
        query = dict(parameters.get("query", parameters)) if isinstance(parameters, dict) else {}
        path = dict(parameters.get("path", {})) if isinstance(parameters, dict) else {}
        if cross_identity:
            path.pop("id", None)
        # A comparison of individual retained pages must retain the actual cursor.
        return {"query": query, "path": path}
    if request_scope(left) != request_scope(right):
        return {"compatible": False, "reason": "The exact retained request queries or path bindings differ.", "changes": []}
    if left.get("coverage", {}).get("status") != right.get("coverage", {}).get("status"):
        return {"compatible": False, "reason": "The retained response coverage states differ.", "changes": []}
    ag, bg = defaultdict(list), defaultdict(list)
    for row in left.get("facts", []):
        ag[row["identity"]].append(row)
    for row in right.get("facts", []):
        bg[row["identity"]].append(row)
    changes = []
    counts = defaultdict(int)
    for key in sorted(ag.keys() | bg.keys()):
        before, after = ag[key], bg[key]
        row = (after or before)[0]
        item = {"identity": key, "tag": row["tag"], "name": row["name"],
                "dimensions": row["identity_fields"]["dimensions"], "before": before, "after": after,
                "delta": {"status": "not_applicable", "value": None, "direction": None}, "changed_fields": []}
        if len(before) > 1 or len(after) > 1:
            item["status"] = "ambiguous"
        elif not before:
            item["status"] = "newly_observed"
        elif not after:
            item["status"] = "not_observed_in_right"
        else:
            aa, bb = before[0], after[0]
            changed_fields = [field for field in ("value", "value_kind", "unit", "name", "abstract", "balance", "sequence", "depth", "parent", "factor") if aa.get(field) != bb.get(field)]
            item["changed_fields"] = changed_fields
            item["status"] = "changed" if changed_fields else "unchanged"
            if aa["unit"] != bb["unit"]:
                item["delta"]["status"] = "unit_changed"
            elif aa["unit"] is None or bb["unit"] is None:
                item["delta"]["status"] = "unit_unknown"
            elif aa["abstract"] or bb["abstract"]:
                item["delta"]["status"] = "abstract"
            elif aa["value"] is None or bb["value"] is None:
                item["delta"]["status"] = "null_value"
            else:
                item["delta"] = _numeric_delta(aa["value"], bb["value"])
        counts[item["status"]] += 1
        changes.append(item)
    signature = "reported_signature" if left["family"] == "reported" else "standardized_signature"
    ai, bi = _instant(a.get("updated_date")), _instant(b.get("updated_date"))
    chronology = "unknown" if ai is None or bi is None else "same_instant" if ai == bi else "forward" if bi > ai else "reverse"
    return {
        "compatible": True, "mode": mode, "family": left["family"], "company": ac,
        "binding": binding if cross_identity else None,
        "left": {"source_sha256": left["source"]["body_sha256"], "fundamental": a, "coverage": left["coverage"]},
        "right": {"source_sha256": right["source"]["body_sha256"], "fundamental": b, "coverage": right["coverage"]},
        "chronology": chronology, "signature": {"field": signature, "before": a.get(signature), "after": b.get(signature),
                                                "changed": a.get(signature) != b.get(signature)},
        "counts": dict(counts), "changes": changes,
        "interpretation": "Arithmetic changes between retained observations. Missing rows are not zero; signatures and dates remain the provider's metadata.",
    }


def csv_cell(value, *, exact_number=False):
    text = "" if value is None else str(value)
    if exact_number and text:
        return "'" + text
    if text and (text[0] in "=+-@\t\r\n" or text.lstrip().startswith(("=", "+", "-", "@"))):
        return "'" + text
    return text


def statement_csv(snapshot, row_ids=None):
    selected = set(row_ids) if row_ids is not None else None
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(["row_id", "tag", "name", "value_exact_text", "unit", "dimensions", "source_sha256", "source_pointer"])
    for row in snapshot["facts"]:
        if selected is not None and row["id"] not in selected:
            continue
        writer.writerow([
            csv_cell(row["id"]), csv_cell(row["tag"]), csv_cell(row["name"]),
            csv_cell(row["value"], exact_number=True), csv_cell(row["unit"]),
            csv_cell(canonical(row["identity_fields"]["dimensions"])),
            snapshot["source"]["body_sha256"], row["source_pointer"],
        ])
    return output.getvalue()

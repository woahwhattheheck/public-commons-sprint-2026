"""Account-statement receiving into the original SF47 cash observations.

CSV interpretation is explicit. Every accepted batch uses the existing case
transaction, cash validator, source store and immutable history.
"""
from __future__ import annotations

import base64
from copy import deepcopy
import csv
from datetime import datetime
from decimal import Decimal
import hashlib
import io
import json
import re
import uuid

from model import Problem, canonical, digest, now, text
import operations_domain as domain
import operations_statement_formats as bank_formats

SCHEMA = "stellar-forge.sf47-statements.v1"
MAX_SOURCE = 8 * 1024 * 1024
MAX_ROWS = 5000
CATEGORIES = ("GRANT", "INVOICE", "CUSTOMER", "CAPITAL", "REFUND", "OTHER")
DATE_FORMATS = {
    "YYYY-MM-DD": ("%Y-%m-%d", r"[0-9]{4}-[0-9]{2}-[0-9]{2}"),
    "MM/DD/YYYY": ("%m/%d/%Y", r"[0-9]{2}/[0-9]{2}/[0-9]{4}"),
    "DD/MM/YYYY": ("%d/%m/%Y", r"[0-9]{2}/[0-9]{2}/[0-9]{4}"),
    "YYYY/MM/DD": ("%Y/%m/%d", r"[0-9]{4}/[0-9]{2}/[0-9]{2}"),
}
CASH_FACTS = ("direction", "category", "date", "currency", "network", "asset",
              "amount", "usdValue", "externalRef", "referenceKey", "tranche")
ZERO = Decimal(0)


def fail(message, code="INVALID_STATEMENT", status=422):
    raise Problem(message, status, code)


def object_value(value, allowed, label, required=()):
    if not isinstance(value, dict) or set(value) - set(allowed) or set(required) - set(value):
        fail(label + ": use the declared fields and include every required field.")
    return value


def amount_string(value):
    value = format(value, "f")
    result = value.rstrip("0").rstrip(".") if "." in value else value
    return "0" if result in ("", "-0") else result


def number(value, fmt, label, empty=False):
    if not isinstance(value, str):
        fail(label + ": retain the decimal text from the original source.")
    value = value.strip()
    if not value and empty:
        return ZERO
    if not value or len(value) > 100:
        fail(label + ": enter an original decimal amount.")
    negative = value.startswith("(") and value.endswith(")")
    if negative:
        value = value[1:-1]
        if value.startswith(("+", "-")):
            fail(label + ": use one sign or a parenthesized negative amount.")
    elif value.startswith(("+", "-")):
        negative = value[0] == "-"
        value = value[1:]
    mark, group = fmt["decimalMark"], fmt["groupMark"]
    pieces = value.split(mark)
    if len(pieces) > 2 or not pieces[0]:
        fail(label + ": the amount does not match the selected decimal format.")
    whole = pieces[0]
    if group and group in whole:
        if not re.fullmatch(r"[0-9]{1,3}(?:" + re.escape(group) + r"[0-9]{3})+", whole):
            fail(label + ": the thousands groups do not match the selected format.")
        whole = whole.replace(group, "")
    if not re.fullmatch(r"[0-9]+", whole):
        fail(label + ": use digits and the selected separators; omit currency symbols.")
    fraction = pieces[1] if len(pieces) == 2 else None
    if fraction is not None and not re.fullmatch(r"[0-9]{1,12}", fraction):
        fail(label + ": use one through twelve fractional digits.")
    result = Decimal(whole + ("." + fraction if fraction is not None else ""))
    if result > Decimal("1000000000000"):
        fail(label + ": the amount exceeds the supported cash-record limit.")
    return -result if negative else result


def source_input(value, decode_csv=True):
    object_value(value, ("filename", "contentBase64", "sourceUrl", "observedAt"),
                 "Statement source", ("filename", "contentBase64", "observedAt"))
    filename = text(value["filename"], "Original statement filename", 240, True)
    if "/" in filename or "\\" in filename or filename in (".", "..") or any(ord(c) < 32 for c in filename):
        fail("Use a plain original statement filename.")
    encoded = value["contentBase64"]
    if not isinstance(encoded, str) or len(encoded) > (MAX_SOURCE + 2) * 4 // 3 + 16:
        fail("Attach the original statement file up to 8 MiB.", "STATEMENT_SOURCE_LIMIT", 413)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as exc:
        raise Problem("The original statement encoding is invalid.", 422, "INVALID_STATEMENT_SOURCE") from exc
    if not raw or len(raw) > MAX_SOURCE:
        fail("Attach a nonempty original statement file up to 8 MiB.", "STATEMENT_SOURCE_LIMIT", 413)
    decoded = None
    if decode_csv:
        try:
            decoded = raw.decode("utf-8-sig")
        except UnicodeError as exc:
            raise Problem("Use an original UTF-8 CSV, including an optional UTF-8 BOM.",
                          422, "STATEMENT_ENCODING") from exc
        if "\x00" in decoded:
            fail("The statement contains a NUL character; select its original UTF-8 CSV export.")
    metadata = {"filename": filename, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                "sourceUrl": domain.url(value.get("sourceUrl", ""), "Statement source URL"),
                "observedAt": domain.timestamp(value["observedAt"], "Statement observation")}
    return raw, decoded, metadata


def configuration(inputs):
    object_value(inputs, ("source", "accountId", "accountLabel", "currency", "format", "columns",
                         "defaultCategory", "openingBalance", "closingBalance", "decisions", "valuationNote",
                         "sourceFormat", "statementId", "statementOptions", "sourceReviewNote", "statementSetup"),
                 "Statement inputs", ("source", "accountId", "currency", "format", "columns"))
    account = text(inputs["accountId"], "Stable statement account ID", 100, True)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", account):
        fail("Use a stable nonsecret account ID containing letters, digits, dots, underscores or hyphens.")
    currency = text(inputs["currency"], "Statement currency or asset", 40, True).upper()
    fmt = object_value(inputs["format"], ("delimiter", "decimalMark", "groupMark", "dateFormat",
                         "amountMode", "positiveDirection"), "Statement format",
                         ("delimiter", "decimalMark", "groupMark", "dateFormat", "amountMode", "positiveDirection"))
    fmt = dict(fmt)
    domain.enum(fmt["delimiter"], (",", ";", "\t", "|"), "CSV delimiter")
    domain.enum(fmt["decimalMark"], (".", ","), "Decimal mark")
    domain.enum(fmt["groupMark"], ("", ".", ",", " ", "\u00a0", "'"), "Thousands separator")
    if fmt["decimalMark"] == fmt["groupMark"]:
        fail("The decimal mark and thousands separator must differ.")
    domain.enum(fmt["dateFormat"], tuple(DATE_FORMATS), "Date order")
    domain.enum(fmt["amountMode"], ("SIGNED", "DEBIT_CREDIT"), "Amount columns")
    domain.enum(fmt["positiveDirection"], ("IN", "OUT"), "Positive amount direction")
    columns = object_value(inputs["columns"], ("date", "reference", "description", "amount",
                               "debit", "credit", "currency", "usdValue"), "Column mapping",
                               ("date", "reference"))
    for value in columns.values():
        if not isinstance(value, str) or len(value) > 300 or "\x00" in value:
            fail("Original column headings must be text up to 300 characters.")
    # Headings are source identities. Keep their original surrounding spaces.
    columns = dict(columns)
    required = ("date", "reference", "amount") if fmt["amountMode"] == "SIGNED" else ("date", "reference", "debit", "credit")
    if any(not columns.get(key) for key in required):
        fail("Map the original date, stable transaction reference and selected amount columns.")
    selected = [columns[key] for key in required]
    if len(selected) != len(set(selected)):
        fail("Date, transaction reference and each amount must use distinct source columns.")
    category = domain.enum(inputs.get("defaultCategory", "OTHER"), CATEGORIES, "Default cash category")
    decisions = inputs.get("decisions", [])
    if not isinstance(decisions, list) or len(decisions) > MAX_ROWS:
        fail("Use at most 5,000 explicit source-row decisions.")
    mapped = {}
    for row in decisions:
        object_value(row, ("rowNumber", "action", "reason", "category", "tranche", "allocations"),
                     "Statement row decision", ("rowNumber", "action"))
        line = domain.integer(row["rowNumber"], "Original source line", 2, 10000000)
        if line in mapped:
            fail("Choose one decision for source row " + str(line) + ".")
        action = domain.enum(row["action"], ("IMPORT", "EXCLUDE"), "Source-row decision")
        reason = text(row.get("reason", ""), "Exclusion or classification reason", 4000)
        if action == "EXCLUDE" and not reason:
            fail("Source row " + str(line) + ": retain the reason for excluding it.")
        if "category" in row:
            domain.enum(row["category"], CATEGORIES, "Cash category")
        if "tranche" in row:
            domain.integer(row["tranche"], "Original grant tranche", 0, 3, True)
        if "allocations" in row and (not isinstance(row["allocations"], list) or len(row["allocations"]) > 200):
            fail("Source row " + str(line) + ": use the original invoice allocation rows.")
        mapped[line] = {**row, "reason": reason}
    return {"accountId": account, "accountLabel": text(inputs.get("accountLabel", ""), "Account label", 300),
            "currency": currency, "format": fmt, "columns": columns, "defaultCategory": category,
            "valuationNote": text(inputs.get("valuationNote", ""), "Statement USD valuation basis", 4000),
            "sourceReviewNote": text(inputs.get("sourceReviewNote", ""), "Original source review note", 4000),
            "decisions": mapped}


def read_csv(decoded, config):
    fmt, columns = config["format"], config["columns"]
    reader = csv.reader(io.StringIO(decoded, newline=""), delimiter=fmt["delimiter"], strict=True)
    try:
        headers = next(reader)
        if not 1 <= len(headers) <= 200 or any(not h.strip() or len(h) > 300 for h in headers):
            fail("The first CSV record must contain one through 200 nonempty unique column headings.")
        if len(set(headers)) != len(headers):
            fail("The original CSV repeats a column heading; select an export with distinct headings.")
        selected = ("date", "reference", "amount") if fmt["amountMode"] == "SIGNED" else ("date", "reference", "debit", "credit")
        selected += tuple(k for k in ("description", "currency", "usdValue") if columns.get(k))
        for key in selected:
            if columns.get(key) not in headers:
                fail("Mapped " + key + " heading is absent from the original CSV: " + str(columns.get(key)))
        rows = []
        while True:
            line = reader.line_num + 1
            try:
                cells = next(reader)
            except StopIteration:
                break
            if not cells or all(not cell.strip() for cell in cells):
                continue
            if len(rows) >= MAX_ROWS:
                fail("The original statement exceeds 5,000 data records.", "STATEMENT_ROW_LIMIT", 413)
            if any(len(cell) > 32000 for cell in cells):
                fail("Source row " + str(line) + " has a cell longer than 32,000 characters.")
            rows.append((line, cells, dict(zip(headers, cells))))
    except (csv.Error, StopIteration) as exc:
        raise Problem("Read the original CSV header and quoted records: " + str(exc),
                      422, "STATEMENT_CSV") from exc
    if not rows:
        fail("The original CSV contains no data records.")
    unknown = set(config["decisions"]) - {line for line, _, _ in rows}
    if unknown:
        fail("A decision names an absent or blank source row: " + ", ".join(map(str, sorted(unknown))))
    return headers, rows


def cash_facts(row):
    allocations = row.get("allocations", [])
    if (not isinstance(allocations, list)
            or any(not isinstance(item, dict) or not isinstance(item.get("invoiceId"), str)
                   for item in allocations)):
        fail("The statement cash facts have an invalid original invoice allocation.", "STATEMENT_CASH_RECORD")
    return {**{key: row.get(key) for key in CASH_FACTS},
            "allocations": sorted(allocations, key=lambda item: item["invoiceId"])}


def reference_key(account, currency, reference):
    original = reference.lower() if re.fullmatch(r"[a-fA-F0-9]{64}", reference) else reference
    return digest({"network": "statement/" + account, "asset": currency, "reference": original})


def corrected_observation(context, retained, prepared, previous):
    """Resolve only the original cash engine's source-validated successor chain."""
    corrections = context.get("cashCorrections", {})
    if not isinstance(corrections, dict):
        fail("Use the original validated cash correction selection.", "STATEMENT_CASH_CONFLICT", 409)
    cash = {row["id"]: row for row in context["records"]["cash"]}
    matches = []
    for original in retained:
        if original["state"] != "VOID" or cash_facts(original) != cash_facts(prepared):
            continue
        selected = corrections.get(original["id"])
        if selected is None:
            continue
        if (not isinstance(selected, dict) or not isinstance(selected.get("original"), dict)
                or not isinstance(selected.get("replacement"), dict) or not isinstance(selected.get("chain"), list)
                or cash_facts(selected["original"]) != cash_facts(original)):
            fail("The original correction selection differs from its retained observation.", "STATEMENT_CASH_CONFLICT", 409)
        current = cash.get(selected["replacement"].get("id"))
        if current is None or cash_facts(current) != cash_facts(selected["replacement"]):
            fail("The correction's current original observation is unavailable.", "STATEMENT_CASH_CONFLICT", 409)
        if current["state"] == "VOID":
            continue
        if previous is not None and current["id"] != previous["id"]:
            fail("The earlier observation was corrected to another original payment identity, while this reference also has a live record. Review both in Cash accounts.",
                 "STATEMENT_CASH_CONFLICT", 409)
        matches.append({"recordId": current["id"], "originalRecordId": original["id"], "corrected": True,
                        "correctionSourceIds": [item["sourceId"] for item in selected["chain"]],
                        "correctedRecord": deepcopy(current)})
    if len({item["recordId"] for item in matches}) > 1:
        fail("This source row matches more than one retained cash correction.", "STATEMENT_CASH_CONFLICT", 409)
    # Several predecessors can carry the same original facts; they must resolve
    # to one current observation. Prefer the complete longest retained chain.
    return max(matches, key=lambda item: len(item["correctionSourceIds"])) if matches else None


def inspect(context, inputs):
    object_value(inputs, ("sourceFormat", "source", "statementOptions"), "Original statement inspection",
                 ("sourceFormat", "source"))
    raw, _, metadata = source_input(inputs["source"], False)
    return bank_formats.inspect(raw, metadata, inputs, context)


def preview(context, inputs):
    return _preview(context, inputs)[0]


def _preview(context, inputs):
    if not isinstance(inputs, dict):
        fail("Use one complete original statement input object.")
    source_format = domain.enum(inputs.get("sourceFormat", "CSV"), ("CSV", "OFX", "MT940"), "Original statement format")
    bank = None
    if source_format == "CSV":
        if inputs.get("statementId") or inputs.get("statementOptions"):
            fail("Choose the original bank source format for its account selection and native format options.")
        effective = inputs
    else:
        if "format" in inputs or "columns" in inputs:
            fail("Original bank formats use their native fields. Omit the CSV format and column mapping.")
        effective = {**inputs, "format": bank_formats.FORMAT, "columns": bank_formats.COLUMNS}
    config = configuration(effective)
    raw, decoded, source = source_input(inputs["source"], source_format == "CSV")
    source.update({key: config[key] for key in ("accountId", "accountLabel", "currency")})
    if source_format == "CSV":
        headers, original_rows = read_csv(decoded, config)
        bank_controls = {}
    else:
        bank = bank_formats.select(raw, source, {**inputs, "currency": config["currency"]})
        headers, original_rows = bank["headers"], bank["rows"]
        source["sourceFormat"] = source_format
        unknown = set(config["decisions"]) - set(bank["details"])
        if unknown:
            fail("A bank decision names an absent original movement: " + ", ".join(map(str, sorted(unknown))))
        bank_controls = bank_formats.row_controls(config, context, bank["details"], reference_key)
    from operations_statement_profiles import validate_selection
    selected_setup = validate_selection(context.get("statementSetups", []), inputs, bank["summary"] if bank else None)
    fmt, columns = config["format"], config["columns"]
    edition = digest({"sourceSha256": source["sha256"],
                      "inputs": {key: value for key, value in inputs.items() if key != "source"}})
    source["editionSha256"] = edition
    previous_sources = [row for row in context["sources"].values()
                        if isinstance(row.get("statement"), dict)
                        and row["statement"].get("schema") == SCHEMA
                        and row["statement"].get("role") in ("CSV", "ORIGINAL")
                        and row["statement"].get("editionSha256") == edition]
    staged = deepcopy(context)
    placeholder = "source-" + source["sha256"][:32]
    while placeholder in staged["sources"]:
        placeholder = "source-" + digest(placeholder)[:32]
    staged["sources"][placeholder] = {"id": placeholder, **source}
    by_reference = {}
    for cash in context["records"]["cash"]:
        by_reference.setdefault(cash.get("referenceKey"), []).append(cash)
    result_rows, findings, seen_references = [], [], {}
    if bank:
        findings.extend({"code": row["code"], "message": row["message"]}
                        for row in bank["summary"]["findings"] if row["severity"] == "ERROR")
        native = bank["summary"]
        active_sources = {ident for cash in context["records"]["cash"] if cash["state"] != "VOID"
                          for ident in cash.get("sourceIds", [])}
        for retained_source in context["sources"].values():
            marker = retained_source.get("statement")
            if not isinstance(marker, dict) or not isinstance(marker.get("nativeAccount"), dict):
                continue
            original = marker["nativeAccount"]
            same_alias = marker.get("accountId") == config["accountId"] and original.get("currency") == config["currency"]
            if same_alias and (original.get("accountReference") != native["accountReference"]
                    or original.get("bankId") and native.get("bankId") and original["bankId"] != native["bankId"]
                    or original.get("identitySha256") and native.get("nativeAccountSha256")
                       and original["identitySha256"] != native["nativeAccountSha256"]):
                findings.append({"code": "BANK_ACCOUNT_BINDING_CONFLICT",
                    "message": "Account ID " + config["accountId"] + " already retains a different original bank account. Select its stable account ID."})
            if retained_source["id"] not in active_sources or retained_source["sha256"] != source["sha256"]:
                continue
            if marker.get("statementId") == native["statementId"] and not same_alias:
                findings.append({"code": "BANK_SOURCE_ACCOUNT_ALIAS_CONFLICT",
                    "message": "This original bank section already has active cash under account ID " + str(marker.get("accountId")) + "."})
            if same_alias and marker.get("statementOptionsSha256") != digest(bank_formats.options(inputs)[1]):
                findings.append({"code": "BANK_SOURCE_INTERPRETATION_CONFLICT",
                    "message": "This original bank file already has active cash under different native format options. Retain the original Cash corrections before changing its interpretation."})
    inflow, outflow, import_in, import_out = ZERO, ZERO, ZERO, ZERO
    complete_amounts = True
    for line, cells, original in original_rows:
        decision = config["decisions"].get(line, {"action": "IMPORT", "reason": ""})
        row = {"rowNumber": line, "reference": "", "date": None, "description": "",
               "direction": None, "amount": None, "currency": config["currency"],
               "usdValue": None, "category": decision.get("category", config["defaultCategory"]),
               "tranche": decision.get("tranche"), "allocations": decision.get("allocations", []),
               "action": decision["action"], "reason": decision.get("reason", ""),
               "status": "EXCLUDED" if decision["action"] == "EXCLUDE" else "NEW",
               "recordId": None, "problems": [], "original": original}
        if bank:
            detail = bank["details"][line]
            row.update({key: deepcopy(detail[key]) for key in ("sourceLine", "identityBasis", "providerReference", "nativeIdentity")})
            row["problems"].extend(bank_controls.get(line, []))
        value = None
        try:
            if len(cells) != len(headers):
                fail("The record has " + str(len(cells)) + " cells; its header has " + str(len(headers)) + ".")
            if columns.get("currency"):
                native_currency = text(original[columns["currency"]], "Source currency", 40, True).upper()
                if native_currency != config["currency"]:
                    fail("The source currency is " + native_currency + "; this account import selects " + config["currency"] + ".")
            if fmt["amountMode"] == "SIGNED":
                value = number(original[columns["amount"]], fmt, "Source amount")
                if fmt["positiveDirection"] == "OUT":
                    value = -value
            else:
                debit = number(original[columns["debit"]], fmt, "Source debit", empty=True)
                credit = number(original[columns["credit"]], fmt, "Source credit", empty=True)
                if debit < ZERO or credit < ZERO or debit and credit:
                    fail("Debit and credit columns require nonnegative values and at most one nonzero amount.")
                value = credit - debit
            if config["currency"] == "USD" and abs(value) != abs(value).quantize(Decimal(".01")):
                fail("USD statement amounts may have no more than two decimal places.")
            row["direction"] = "OUT" if value < ZERO else "IN"
            row["amount"] = amount_string(abs(value))
            if value >= ZERO:
                inflow += value
            else:
                outflow -= value
        except Problem as problem:
            complete_amounts = False
            row["problems"].append(str(problem))
        try:
            row["reference"] = text(original.get(columns["reference"], ""), "Original provider transaction reference", 1000, True)
            date_raw = original.get(columns["date"], "").strip()
            date_fmt, date_shape = DATE_FORMATS[fmt["dateFormat"]]
            if not re.fullmatch(date_shape, date_raw):
                fail("The source date does not match the selected " + fmt["dateFormat"] + " order.")
            try:
                row["date"] = datetime.strptime(date_raw, date_fmt).date().isoformat()
            except ValueError as exc:
                raise Problem("The original source date is not a valid calendar date.", 422, "STATEMENT_DATE") from exc
            row["description"] = text(original.get(columns.get("description"), ""), "Original statement description", 12000)
            if config["currency"] == "USD" and value is not None:
                row["usdValue"] = format(abs(value), ".2f")
            elif columns.get("usdValue") and original.get(columns["usdValue"], "").strip():
                valuation = number(original[columns["usdValue"]], fmt, "Explicit source USD valuation")
                row["usdValue"] = domain.usd(valuation, "Explicit source USD valuation", True)
                if not config["valuationNote"]:
                    fail("Retain the explicit USD valuation basis for the selected source valuation column.")
            if row["tranche"] is not None and (row["category"] != "GRANT" or row["direction"] != "IN"):
                fail("A tranche belongs to an observed grant inflow.")
            key = reference_key(config["accountId"], config["currency"], row["reference"])
            row["referenceKey"] = key
            if row["action"] == "IMPORT":
                if key in seen_references:
                    fail("The provider transaction reference repeats source row " + str(seen_references[key]) + ". Exclude the duplicate explicitly or select distinct original references.",
                         "DUPLICATE_STATEMENT_REFERENCE")
                seen_references[key] = line
                if value == ZERO:
                    fail("A zero statement movement cannot create a cash observation; retain an explicit exclusion if it is an informational row.")
            if row["problems"] or row["action"] == "EXCLUDE":
                raise Problem("Source row requires its retained decision.", 422, "STATEMENT_ROW_REVIEW")
            native = {"direction": row["direction"], "category": row["category"], "date": row["date"],
                      "currency": config["currency"], "network": "statement/" + config["accountId"],
                      "asset": config["currency"], "amount": row["amount"], "usdValue": row["usdValue"],
                      "externalRef": row["reference"], "tranche": row["tranche"], "allocations": row["allocations"],
                      "sourceIds": [placeholder],
                      "sourceNote": "Account " + config["accountId"] + " (" + config["accountLabel"] + "), original statement row " + str(line) + ". " + row["description"] + (" Decision: " + row["reason"] if row["reason"] else ""),
                      "valuationSourceIds": [placeholder] if config["currency"] != "USD" and row["usdValue"] is not None else [],
                      "valuationNote": config["valuationNote"]}
            retained = by_reference.get(key, [])
            live = [cash for cash in retained if cash["state"] != "VOID"]
            if len(live) > 1:
                row["recordId"] = live[0]["id"]
                fail("Multiple retained cash records use this original payment identity.", "STATEMENT_CASH_CONFLICT", 409)
            previous = live[0] if live else None
            # Normalize the complete original row before resolving a retained
            # correction. Only the selected live duplicate leaves this scan.
            validation = staged
            if previous:
                validation = {**staged, "records": {**staged["records"],
                    "cash": [cash for cash in staged["records"]["cash"] if cash["id"] != previous["id"]]}}
            prepared = domain.prepare("cash", native, validation)
            corrected = corrected_observation(context, retained, prepared, previous)
            if corrected:
                row.update(corrected)
                row["status"] = "EXISTING"
            elif previous:
                row["recordId"] = previous["id"]
                if cash_facts(previous) != cash_facts(prepared):
                    fail("The original payment reference has different retained cash facts. Reconcile record " + previous["id"] + ".",
                         "STATEMENT_CASH_CONFLICT", 409)
                row["status"] = "EXISTING"
            elif retained:
                row["recordId"] = retained[0]["id"]
                fail("The original cash observation was voided. Review its correction in Cash accounts instead of recreating it from a statement.",
                     "STATEMENT_VOIDED_CASH", 409)
            else:
                prepared["id"] = "cash-" + digest({"edition": edition, "rowNumber": line})[:32]
                staged["records"]["cash"].append(prepared)
                if row["direction"] == "IN":
                    import_in += abs(value)
                else:
                    import_out += abs(value)
            if row["status"] == "EXISTING" and any(
                    previous_row["status"] == "EXISTING" and previous_row["recordId"] == row["recordId"]
                    for previous_row in result_rows):
                fail("Two source rows resolve to the same current cash observation. Retain an explicit exclusion for the duplicate source movement.",
                     "STATEMENT_CASH_CONFLICT", 409)
            row["record"] = prepared
            row["allocations"] = prepared["allocations"]
        except Problem as problem:
            if problem.code != "STATEMENT_ROW_REVIEW":
                row["problems"].append(str(problem))
        if row["action"] == "IMPORT" and row["problems"]:
            row["status"] = "CONFLICT"
        if row["status"] == "CONFLICT":
            findings.append({"code": "STATEMENT_ROW_CONFLICT", "rowNumber": line, "recordId": row["recordId"],
                             "message": "Source row " + str(line) + ": " + " ".join(row["problems"])})
        result_rows.append(row)
    counts = {status: sum(row["status"] == status for row in result_rows) for status in ("NEW", "EXISTING", "EXCLUDED", "CONFLICT")}
    opening_raw, closing_raw = inputs.get("openingBalance"), inputs.get("closingBalance")
    opening = None if opening_raw in (None, "") else number(opening_raw, fmt, "Original opening balance")
    closing = None if closing_raw in (None, "") else number(closing_raw, fmt, "Original closing balance")
    if (opening is None) != (closing is None):
        fail("Enter the original opening and closing balances together, or leave both unentered.")
    balance = {"status": "NOT_PROVIDED", "openingBalance": None, "closingBalance": None,
               "calculatedBalance": None, "difference": None}
    if opening is not None:
        if config["currency"] == "USD" and any(v != v.quantize(Decimal(".01")) for v in (opening, closing)):
            fail("Original USD balances may have no more than two decimal places.")
        balance.update({"openingBalance": amount_string(opening), "closingBalance": amount_string(closing)})
        if not complete_amounts:
            balance["status"] = "UNAVAILABLE"
            findings.append({"code": "STATEMENT_BALANCE_UNAVAILABLE", "message": "Read every original movement amount in the selected currency before reconciling the supplied balances."})
        else:
            calculated = opening + inflow - outflow
            difference = calculated - closing
            balance.update({"status": "MATCH" if difference == ZERO else "MISMATCH",
                            "calculatedBalance": amount_string(calculated), "difference": amount_string(difference)})
            if difference != ZERO:
                findings.append({"code": "STATEMENT_BALANCE_MISMATCH", "message": "Opening balance plus every original statement movement differs from closing balance by " + amount_string(difference) + " " + config["currency"] + "."})
    total_records = sum(len(values) for values in context["records"].values())
    if total_records + counts["NEW"] > MAX_ROWS:
        findings.append({"code": "STATEMENT_RECORD_LIMIT", "message": "This import would exceed the original case's 5,000 retained-record limit."})
    known_edition = next((source for source in previous_sources
                          if isinstance(source["statement"].get("reviewSourceId"), str)
                          and source["statement"]["reviewSourceId"] in context["sources"]), None)
    if known_edition and counts["NEW"]:
        findings.append({"code": "STATEMENT_RETAINED_EDITION_CONFLICT", "message": "A retained statement edition is missing an original cash observation. Reopen its complete case before receiving this edition again."})
    unchanged = bool(known_edition and not counts["NEW"] and not counts["CONFLICT"])
    retained_bytes = sum(row["bytes"] for row in context["sources"].values())
    if not unchanged and (len(context["sources"]) + 2 > 200 or retained_bytes + len(raw) >= 24 * 1024 * 1024):
        findings.append({"code": "STATEMENT_SOURCE_LIMIT", "message": "The original statement and complete review require two available source slots within the case's 24 MiB / 200-source limit."})
    if context["program"]["state"] != "OPEN":
        findings.append({"code": "OPERATIONS_CLOSED", "message": "Reopen this closed operations case before receiving a statement."})
    result = {"schema": SCHEMA, "caseId": context["program"]["id"], "expectedVersion": context["program"]["version"],
              "inputsSha256": digest(inputs), "source": source, "headers": headers, "rows": result_rows,
              "summary": {"rows": len(result_rows), "newCount": counts["NEW"], "existingCount": counts["EXISTING"],
                          "excludedCount": counts["EXCLUDED"], "conflictCount": counts["CONFLICT"],
                          "inflow": amount_string(inflow), "outflow": amount_string(outflow),
                          "net": amount_string(inflow - outflow), "importInflow": amount_string(import_in),
                          "importOutflow": amount_string(import_out), "completeAmounts": complete_amounts},
              "balance": balance, "findings": findings, "canImport": not findings,
              "unchanged": unchanged, "retainedSourceId": known_edition["id"] if known_edition else None}
    if selected_setup is not None:
        result["statementSetup"] = selected_setup
    if bank:
        result["bank"] = bank["summary"]
    # Account for the retained complete interpretation and original native report.
    estimated_envelope = {
        "schema": SCHEMA + ".review", "caseId": context["program"]["id"], "caseVersion": context["program"]["version"] + 1,
        "recordedBy": "x" * 1800, "recordedAt": "2000-01-01T00:00:00.000000+00:00",
        "sourceId": "source-" + "0" * 32, "sourceSha256": source["sha256"], "editionSha256": edition,
        "inputs": {k: v for k, v in inputs.items() if k != "source"},
        "sourceObservation": {k: v for k, v in inputs["source"].items() if k != "contentBase64"},
        "preview": {**result, "previewSha256": "0" * 64},
        "cashRows": [{"rowNumber": row["rowNumber"], "cashId": "cash-" + "0" * 32}
                     for row in result_rows if row["status"] == "NEW"],
        "existingCashIds": [row["recordId"] for row in result_rows if row["status"] == "EXISTING"]}
    if bank:
        estimated_envelope["bankParserReport"] = bank["parserReport"]
    estimated_review = len((canonical(estimated_envelope) + "\n").encode())
    if not unchanged and (estimated_review > MAX_SOURCE or retained_bytes + len(raw) + estimated_review > 24 * 1024 * 1024):
        result["findings"].append({"code": "STATEMENT_REVIEW_LIMIT", "message": "The complete statement review and original source exceed the original case's source capacity."})
        result["canImport"] = False
    result["previewSha256"] = digest(result)
    return result, bank


def annotate_source(ops, program_id, metadata, statement):
    metadata = {**metadata, "statement": statement}
    ops.db.execute("UPDATE ops_sources SET metadata_json=? WHERE program_id=? AND id=?",
                   (canonical(metadata), program_id, metadata["id"]))
    return metadata


def receive(ops, context, data, actor, version):
    object_value(data, ("inputs", "expectedPreviewSha256"), "Statement receiving",
                 ("inputs", "expectedPreviewSha256"))
    inputs = data["inputs"]
    candidate, bank = _preview(context, inputs)
    if candidate["previewSha256"] != domain.sha(data["expectedPreviewSha256"], "Reviewed statement preview", False):
        fail("The original statement, mapping, decisions or case changed after review.", "STATEMENT_PREVIEW_CONFLICT", 409)
    if not candidate["canImport"]:
        fail("Resolve the statement review before receiving: " + candidate["findings"][0]["message"],
             "STATEMENT_REVIEW_CONFLICT", 409)
    program_id = context["program"]["id"]
    existing = [row["recordId"] for row in candidate["rows"] if row["status"] == "EXISTING"]
    source = candidate["source"]
    if candidate["unchanged"]:
        csv_source = context["sources"][candidate["retainedSourceId"]]
        return {"before": None, "after": None, "kind": "statement", "recordId": csv_source["id"],
                "sourceIds": [csv_source["id"], csv_source["statement"]["reviewSourceId"]],
                "cashIds": [], "existingCashIds": existing, "unchanged": True,
                "statementSha256": source["sha256"], "previewSha256": candidate["previewSha256"]}
    media_type = "text/csv" if not bank else "application/x-ofx" if inputs["sourceFormat"] == "OFX" else "text/plain"
    csv_source = ops._source_add(program_id, {**inputs["source"], "kind": "payment", "mediaType": media_type})
    created = [{"rowNumber": row["rowNumber"], "cashId": "cash-" + uuid.uuid4().hex}
               for row in candidate["rows"] if row["status"] == "NEW"]
    review = {"schema": SCHEMA + ".review", "caseId": program_id, "caseVersion": version,
              "recordedBy": actor, "recordedAt": now(), "sourceId": csv_source["id"],
              "sourceSha256": source["sha256"], "editionSha256": source["editionSha256"],
              "inputs": {key: value for key, value in inputs.items() if key != "source"},
              "sourceObservation": {key: value for key, value in inputs["source"].items() if key != "contentBase64"},
              "preview": candidate, "cashRows": created, "existingCashIds": existing}
    if bank:
        review["bankParserReport"] = bank["parserReport"]
    review_bytes = (canonical(review) + "\n").encode()
    review_source = ops._source_add(program_id, {"filename": "statement-review-" + source["editionSha256"][:16] + ".json",
        "kind": "payment", "mediaType": "application/json", "observedAt": source["observedAt"],
        "sourceUrl": source["sourceUrl"], "contentBase64": base64.b64encode(review_bytes).decode("ascii")})
    marker = {"schema": SCHEMA, "role": "ORIGINAL" if bank else "CSV",
        "accountId": source["accountId"], "editionSha256": source["editionSha256"],
        "reviewSourceId": review_source["id"]}
    if bank:
        marker.update({"sourceFormat": inputs["sourceFormat"], "statementId": bank["summary"]["statementId"],
            "statementOptionsSha256": digest(bank_formats.options(inputs)[1]),
            "nativeAccount": {**{key: bank["summary"].get(key) for key in ("accountReference", "bankId", "kind")},
                              "currency": candidate["source"]["currency"],
                              "identitySha256": bank["summary"].get("nativeAccountSha256")}})
    csv_source = annotate_source(ops, program_id, csv_source, marker)
    review_source = annotate_source(ops, program_id, review_source, {"schema": SCHEMA, "role": "REVIEW",
        "accountId": source["accountId"], "editionSha256": source["editionSha256"], "csvSourceId": csv_source["id"]})
    staged = deepcopy(context)
    staged["sources"].update({row["id"]: row for row in (csv_source, review_source)})
    identities = {row["rowNumber"]: row["cashId"] for row in created}
    for row in candidate["rows"]:
        if row["status"] != "NEW":
            continue
        native = {**row["record"], "sourceIds": [csv_source["id"], review_source["id"]],
                  "valuationSourceIds": [csv_source["id"]] if row["currency"] != "USD" and row["usdValue"] is not None else []}
        native.pop("id", None)
        prepared = domain.prepare("cash", native, staged)
        recorded = {**prepared, "id": identities[row["rowNumber"]], "version": version,
                    "createdAt": now(), "updatedAt": now(), "recordedBy": actor}
        ops._save(program_id, "cash", recorded)
        staged["records"]["cash"].append(recorded)
    after = {"sourceId": csv_source["id"], "reviewSourceId": review_source["id"],
             "accountId": source["accountId"], "statementSha256": source["sha256"],
             "editionSha256": source["editionSha256"], "previewSha256": candidate["previewSha256"],
             "cashRows": created, "existingCashIds": existing, "summary": candidate["summary"], "balance": candidate["balance"]}
    return {"before": None, "after": after, "kind": "statement", "recordId": csv_source["id"],
            "sourceChange": {"added": [csv_source, review_source]},
            "sourceIds": [csv_source["id"], review_source["id"]],
            "cashIds": [row["cashId"] for row in created], "existingCashIds": existing,
            "unchanged": False, "statementSha256": source["sha256"], "previewSha256": candidate["previewSha256"]}


def validate_import(context, events, files):
    """Keep the exact statement/source/cash closure in ordinary case receiving."""
    cash = {row["id"]: row for row in context["records"]["cash"]}
    sources = context["sources"]
    for metadata in sources.values():
        marker = metadata.get("statement")
        if not isinstance(marker, dict) or marker.get("schema") != SCHEMA or marker.get("role") not in ("CSV", "ORIGINAL"):
            continue
        review_id = marker.get("reviewSourceId")
        if not isinstance(review_id, str) or not review_id:
            fail("The original statement is missing its retained review identity.", "STATEMENT_IMPORT_SOURCE")
        review_source = sources.get(review_id)
        if (not review_source or not isinstance(review_source.get("statement"), dict)
                or review_source["statement"].get("csvSourceId") != metadata["id"]):
            fail("The original statement is missing its complete retained review.", "STATEMENT_IMPORT_SOURCE")
        try:
            review = json.loads(files["sources/" + review_id])
        except (KeyError, ValueError, UnicodeError) as exc:
            raise Problem("The retained statement review cannot be read.", 422, "STATEMENT_IMPORT_SOURCE") from exc
        if not isinstance(review, dict):
            fail("The retained statement review must be an object.", "STATEMENT_IMPORT_REVIEW")
        if (review.get("schema") != SCHEMA + ".review" or review.get("sourceId") != metadata["id"]
                or review.get("sourceSha256") != metadata["sha256"] or review.get("editionSha256") != marker.get("editionSha256")):
            fail("The statement review differs from its original source identity.", "STATEMENT_IMPORT_SOURCE")
        candidate = review.get("preview", {})
        if not isinstance(candidate, dict):
            fail("The retained statement preview must be an object.", "STATEMENT_IMPORT_REVIEW")
        if candidate.get("schema") != SCHEMA or digest({k: v for k, v in candidate.items() if k != "previewSha256"}) != candidate.get("previewSha256"):
            fail("The statement preview differs from its retained interpretation.", "STATEMENT_IMPORT_REVIEW")
        if not isinstance(candidate.get("rows"), list) or not isinstance(review.get("cashRows"), list):
            fail("The retained statement row selection is incomplete.", "STATEMENT_IMPORT_REVIEW")
        if any(not isinstance(row, dict)
               or isinstance(row.get("rowNumber"), bool) or not isinstance(row.get("rowNumber"), int)
               or row["rowNumber"] < 2
               or row.get("status") not in ("NEW", "EXISTING", "EXCLUDED", "CONFLICT")
               for row in candidate["rows"]):
            fail("The retained preview has an invalid original row selection.", "STATEMENT_IMPORT_REVIEW")
        if marker.get("sourceFormat") in ("OFX", "MT940"):
            bank_formats.validate_review(metadata, review, candidate, files["sources/" + metadata["id"]])
        elif "bank" in candidate or "bankParserReport" in review:
            fail("The bank review differs from its original source format.", "BANK_IMPORT_REVIEW")
        rows = {row["rowNumber"]: row for row in candidate["rows"]}
        selected_rows = review["cashRows"]
        if (len(rows) != len(candidate["rows"])
                or any(not isinstance(row, dict) or set(row) != {"rowNumber", "cashId"}
                       or isinstance(row.get("rowNumber"), bool) or not isinstance(row.get("rowNumber"), int)
                       or row["rowNumber"] < 2 or not isinstance(row.get("cashId"), str) or not row["cashId"]
                       for row in selected_rows)
                or len({row["cashId"] for row in selected_rows}) != len(selected_rows)
                or len({row["rowNumber"] for row in selected_rows}) != len(selected_rows)
                or {row["rowNumber"] for row in selected_rows} != {number for number, row in rows.items() if row["status"] == "NEW"}):
            fail("The statement review must retain one original cash identity for every new source row.", "STATEMENT_IMPORT_CASH")
        expected_existing = [row.get("recordId") for row in candidate["rows"] if row["status"] == "EXISTING"]
        if (any(not isinstance(ident, str) or not ident for ident in expected_existing)
                or review.get("existingCashIds") != expected_existing or len(set(expected_existing)) != len(expected_existing)):
            fail("The statement review differs from its selected existing cash identities.", "STATEMENT_IMPORT_CASH")
        for selected in selected_rows:
            original = rows.get(selected.get("rowNumber"))
            retained = cash.get(selected.get("cashId"))
            if (not original or not retained or original.get("status") != "NEW"
                    or not isinstance(original.get("record"), dict)
                    or cash_facts(retained) != cash_facts(original["record"])):
                fail("An imported statement cash observation differs from its original review.", "STATEMENT_IMPORT_CASH")
            if not {metadata["id"], review_id}.issubset(retained.get("sourceIds", [])):
                fail("A statement cash observation is missing its original source and review.", "STATEMENT_IMPORT_CASH")
        if any(ident not in cash for ident in review.get("existingCashIds", [])):
            fail("A statement review is missing an already retained cash observation.", "STATEMENT_IMPORT_CASH")

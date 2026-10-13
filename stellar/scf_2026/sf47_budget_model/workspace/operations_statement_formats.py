"""Project maintained OFX/MT940 source readers into the original grant cash desk."""
from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
import hashlib

from model import Problem, canonical, digest, text
import operations_domain as domain
from statement_parsers import ofx_intake as ofx
from statement_parsers import mt940_engine as mt940

SCHEMA = "stellar-forge.sf47-bank-statements.v1"
HEADERS = ["Date", "Reference", "Description", "Amount", "Currency", "Source line", "Original fields"]
COLUMNS = {"date": "Date", "reference": "Reference", "description": "Description",
           "amount": "Amount", "currency": "Currency"}
FORMAT = {"delimiter": ",", "decimalMark": ".", "groupMark": "", "dateFormat": "YYYY-MM-DD",
          "amountMode": "SIGNED", "positiveDirection": "IN"}
MT_ERRORS = {"BOOKED_BALANCE_DIFFERENCE", "BALANCE_DATE_REVERSED", "STATEMENT_IDENTITY_CONFLICT",
             "INTERMEDIATE_BALANCE_CHAIN_DIFFERENCE", "MULTIPART_CLOSE_DATE_DIFFERENCE"}
MT_MESSAGES = {
    "BOOKED_BALANCE_DIFFERENCE": "An original MT940 page does not reconcile its opening balance, movements and closing balance.",
    "BALANCE_DATE_REVERSED": "An original opening balance is dated after its closing balance.",
    "STATEMENT_IDENTITY_CONFLICT": "The source contains different pages under the same original statement identity.",
    "INTERMEDIATE_BALANCE_CHAIN_DIFFERENCE": "Adjacent original statement pages have different connecting balances.",
    "MULTIPART_CLOSE_DATE_DIFFERENCE": "Parts of one original statement have different closing dates.",
    "MULTIPART_INCOMPLETE_OR_CONFLICTING": "Review the supplied original statement parts and their sequence.",
    "SUPPLIED_STATEMENT_CHAIN_BREAK": "The supplied statements have a gap or difference between closing and following opening balances.",
    "SAME_ACCOUNT_CLOSE_DATE_AMBIGUOUS": "Several supplied statements have the same account closing date.",
    "AVAILABLE_DATE_DIFFERS": "The available balance is observed on a different date from the booked closing balance.",
    "FORWARD_DATE_BEFORE_CLOSE": "An original forward balance is dated before the booked closing balance.",
    "EXPORT_SET_NOT_DECLARED_COMPLETE": "This file supplies its original pages; the source report retains their coverage."
}


def fail(message, code="INVALID_BANK_STATEMENT", status=422):
    raise Problem(message, status, code)


def issue(code, message, severity="REVIEW"):
    return {"code": code, "message": message, "severity": severity}


def plain_amount(value):
    result = format(Decimal(value), "f")
    if "." in result:
        result = result.rstrip("0").rstrip(".")
    return "0" if result in ("", "-0") else result


def amount_minor(value, scale):
    return plain_amount(Decimal(value).scaleb(-scale))


def options(inputs):
    kind = inputs.get("sourceFormat")
    if kind not in ("OFX", "MT940"):
        fail("Choose OFX / QFX or MT940 for original bank statement inspection.")
    value = inputs.get("statementOptions")
    if kind == "OFX":
        if value not in (None, {}):
            fail("OFX retains its original declared encoding and posted-date fields.")
        return kind, None
    keys = {"profile", "encoding", "debitCreditProfile", "yearWindowStart", "dateBasis", "currencyScales"}
    if not isinstance(value, dict) or set(value) != keys:
        fail("Choose the original MT940 transport, encoding, reversal profile, century window and currency precision.")
    domain.enum(value["profile"], ("TEXT_BODY", "FIN_ENVELOPE"), "Original MT940 transport")
    domain.enum(value["encoding"], ("ASCII", "UTF-8", "ISO-8859-1"), "Original MT940 encoding")
    domain.enum(value["debitCreditProfile"], ("CD_ONLY", "CD_REVERSALS"), "Original MT940 debit / reversal profile")
    domain.integer(value["yearWindowStart"], "MT940 century window start", 1900, 2000)
    if value["dateBasis"] != "VALUE_DATE":
        fail("Use the original complete MT940 value date; the entry MMDD has no supplied year.")
    scales = value["currencyScales"]
    if not isinstance(scales, dict) or not 1 <= len(scales) <= 32:
        fail("Declare the exact decimal precision for each source currency.")
    for currency, scale in scales.items():
        if not isinstance(currency, str) or len(currency) != 3 or not currency.isascii() or not currency.isalpha() or currency != currency.upper():
            fail("Use an uppercase three-letter original MT940 currency code.")
        domain.integer(scale, "Original " + currency + " decimal precision", 0, 6)
    return kind, deepcopy(value)


def _section(kind, account, currency, bank_id=None):
    identity = {"kind": kind, "accountReference": account, "currency": currency, "bankId": bank_id}
    return {"id": digest(identity), **identity, "label": currency + " · " + account,
            "from": None, "until": None, "openingBalance": None, "closingBalance": None,
            "cashEligible": kind == "BANK", "pendingCount": 0, "findings": [], "_rows": [], "_pages": []}


def _ofx_sections(report):
    sections = []
    parsed = report["sources"][0]["parsed"]
    for account_key, retained in report["accounts"].items():
        native = retained["identity"]
        account = native["account"]
        for currency in retained["currencies"]:
            section = _section(native["kind"], account["ACCTID"], currency, account.get("BANKID"))
            section["nativeAccountSha256"] = account_key
            section["id"] = digest({"sourceFormat": "OFX", "nativeAccountSha256": account_key, "currency": currency})
            section["accountType"] = account.get("ACCTTYPE")
            section["label"] += "".join(" · " + account[key] for key in ("ACCTTYPE", "BRANCHID") if account.get(key))
            section["cashEligible"] = native["kind"] == "BANK" and account.get("ACCTTYPE") != "CREDITLINE"
            if not section["cashEligible"]:
                section["findings"].append(issue("BANK_ACCOUNT_IS_LIABILITY",
                    "This original credit account records liabilities. Use Supplier accounts for its obligations.", "ERROR"))
            statements, statement_refs = [], set()
            for index, statement in enumerate(parsed["statements"]):
                identity = dict(statement["account"])
                if statement["kind"] == "BANK":
                    identity.pop("ACCTKEY", None)
                if statement["kind"] == native["kind"] and identity == account and statement["currency"] == currency:
                    statements.append(statement)
                    statement_refs.add("source.ofx:statement:" + str(index + 1))
            windows = [s["download_window"] for s in statements if "download_window" in s]
            section["from"] = min((w["start"]["local_date"] for w in windows), default=None)
            section["until"] = max((w["end"]["local_date"] for w in windows), default=None)
            section["balanceSnapshots"] = [deepcopy(snapshot) for snapshot in retained["snapshots"]
                                           if snapshot["source"] in statement_refs]
            if len(statements) == 1:
                balance = statements[0]["ledger_balance"]
                section["closingBalance"] = {"date": balance["asof"]["local_date"], "amount": balance["amount"]}
            posted = [row for row in report["occurrences"] if row["account_key"] == account_key and row["currency"] == currency]
            section["pendingCount"] = sum(row["account_key"] == account_key and row["currency"] == currency
                                          for row in report["pending_observations"])
            if section["pendingCount"]:
                section["findings"].append(issue("BANK_PENDING_OBSERVATIONS",
                    str(section["pendingCount"]) + " original pending observations remain in the full source report.", "INFO"))
            if not posted:
                section["findings"].append(issue("BANK_NO_POSTED_MOVEMENTS", "This original account section has no posted movements.", "INFO"))
            for occurrence in posted:
                row, original = occurrence["row"], occurrence["row"]["raw"]
                dates = row["dates"]
                metadata = {"sourceFormat": "OFX", "fitid": original["FITID"],
                    "correctionAction": original.get("CORRECTACTION"), "correctsFitid": original.get("CORRECTFITID"),
                    "sourceOccurrence": occurrence["ref"], "sourceStatusOk": occurrence["source_status_ok"],
                    "typedRowSha256": ofx.digest({key: value for key, value in row.items() if key != "source_line"}),
                    "originalDates": deepcopy(dates), "originalFields": deepcopy(original)}
                problems = []
                if not occurrence["source_status_ok"]:
                    problems.append("The original bank response for this movement is not a successful statement response.")
                if "CURRENCY" in original or "ORIGCURRENCY" in original:
                    problems.append("The original movement contains a currency override. Resolve its original account-currency amount before receiving cash.")
                if original.get("CORRECTACTION") == "DELETE":
                    problems.append("The original bank record deletes an earlier FITID. Void its matching Cash observation and exclude this deletion record with its reason.")
                section["_rows"].append({"date": dates["DTPOSTED"]["local_date"], "reference": original["FITID"],
                    "description": "\n".join(value for value in (original.get("NAME", original.get("PAYEE", {}).get("NAME", "")),
                                               original.get("MEMO", "")) if value),
                    "amount": row["amount"], "currency": currency, "sourceLine": row["source_line"],
                    "identityBasis": "PROVIDER_REFERENCE", "providerReference": original.get("REFNUM", original.get("SRVRTID", original.get("CHECKNUM", ""))),
                    "nativeIdentity": metadata, "problems": problems})
            source_refs = {item["ref"] for item in posted}
            source_refs.update(item["ref"].split(":posted:", 1)[0] for item in posted)
            source_refs.update(statement_refs)
            source_refs.update("source.ofx:" + str(statement["response"]["line"]) for statement in statements)
            source_refs.update((account_key, "source.ofx"))
            for finding in report["findings"]:
                if source_refs.intersection(finding["refs"]):
                    code = finding["code"]
                    section["findings"].append(issue(code, code.replace("_", " ").capitalize() + " in the original OFX source.",
                        "ERROR" if code in {"BALANCE_SNAPSHOT_CONFLICT", "SIGNON_STATUS_REVIEW", "RESPONSE_STATUS_REVIEW"} else
                        "INFO" if finding["level"] == "INFO" else "REVIEW"))
            if any(r["nativeIdentity"]["correctionAction"] for r in section["_rows"]):
                section["findings"].append(issue("BANK_ORIGINAL_CORRECTIONS",
                    "Review the original replacement and deletion records against retained Cash observations."))
            sections.append(section)
    return sections


def _mt_sections(report, settings):
    sections = {}
    for page in report["pages"]:
        data = page["data"]
        section = _section("BANK", data["account"], data["opening"]["currency"])
        current = sections.setdefault(section["id"], section)
        current["_pages"].append(page)
    for section in sections.values():
        pages = sorted(section["_pages"], key=lambda p: (p["data"]["closing"]["date"],
                        int(p["data"]["statement_number"]), p["data"]["sequence_number"] or 0, p["page_sha256"]))
        section["from"] = min(p["data"]["opening"]["date"] for p in pages)
        section["until"] = max(p["data"]["closing"]["date"] for p in pages)
        scale = settings["currencyScales"][section["currency"]]
        affected = {p["page_sha256"] for p in pages}
        for finding in report["findings"]:
            if not finding["pages"] or affected.intersection(finding["pages"]):
                code = finding["code"]
                section["findings"].append(issue(code, MT_MESSAGES.get(code, code.replace("_", " ").capitalize()),
                                                 "ERROR" if code in MT_ERRORS else "INFO" if code == "EXPORT_SET_NOT_DECLARED_COMPLETE" else "REVIEW"))
        controls = {r["code"] for r in section["findings"]}
        if len(pages) == 1 or not controls - {"EXPORT_SET_NOT_DECLARED_COMPLETE", "AVAILABLE_DATE_DIFFERS", "FORWARD_DATE_BEFORE_CLOSE"}:
            left, right = pages[0]["data"]["opening"], pages[-1]["data"]["closing"]
            section["openingBalance"] = {"date": left["date"], "amount": amount_minor(left["minor"], scale)}
            section["closingBalance"] = {"date": right["date"], "amount": amount_minor(right["minor"], scale)}
        section["balanceSnapshots"] = []
        for page in pages:
            data = page["data"]
            occurrence = page["occurrences"][0]
            section["balanceSnapshots"].append({"pageSha256": page["page_sha256"], "identity": deepcopy(page["identity"]),
                "opening": {"date": data["opening"]["date"], "amount": amount_minor(data["opening"]["minor"], scale)},
                "closing": {"date": data["closing"]["date"], "amount": amount_minor(data["closing"]["minor"], scale)}})
            for row in data["transactions"]:
                native = {"sourceFormat": "MT940", "statementIdentity": deepcopy(page["identity"]),
                    "ordinal": row["ordinal"], "pageSha256": page["page_sha256"],
                    "originalEntryMonthDay": row["entry_mmdd"], "originalFields": deepcopy(row),
                    "originalSourceOccurrences": [
                        {**{key: deepcopy(value) for key, value in original.items()
                            if key not in ("transaction_lines", "transport")},
                         "transaction_line": original["transaction_lines"][row["ordinal"] - 1],
                         "transportSha256": digest(original["transport"])}
                        for original in page["occurrences"]]}
                # Page identity and ordinal are supplied positions, independent of money or descriptions.
                positional = {"statementIdentity": page["identity"], "ordinal": row["ordinal"]}
                reference = "mt940:" + digest(positional)
                section["_rows"].append({"date": row["value_date"], "reference": reference,
                    "description": "\n".join(value for value in (row["owner_reference"], row.get("supplementary"),
                                                                 "\n".join(row["narrative_lines"])) if value),
                    "amount": amount_minor(row["amount_minor"], scale), "currency": section["currency"],
                    "sourceLine": occurrence["transaction_lines"][row["ordinal"] - 1],
                    "identityBasis": "STATEMENT_POSITION", "providerReference": row.get("bank_reference") or row["owner_reference"],
                    "nativeIdentity": native, "problems": []})
    return list(sections.values())


def compile_source(raw, inputs):
    kind, settings = options(inputs)
    try:
        if kind == "OFX":
            plan = {"schema": "ofx-intake-plan/v1",
                    "sources": [{"file": "source.ofx", "institution": "grant-bank-source"}]}
            report = ofx.compile_report(plan, {"source.ofx": raw})
            sections = _ofx_sections(report)
            profile = ofx.PROFILE
        else:
            plan = {"schema": "mt940-intake-plan/2", "institution_scope": "grant-bank-source",
                "year_window_start": settings["yearWindowStart"], "currency_scales": settings["currencyScales"],
                "complete_export_set": False, "sources": [{"id": "source", "file": "source.mt940",
                    "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "profile": settings["profile"],
                    "encoding": settings["encoding"], "debit_credit_profile": settings["debitCreditProfile"]}]}
            report = mt940.compile_report(plan, {"source": raw})
            sections = _mt_sections(report, settings)
            profile = mt940.VERSION
    except (ofx.IntakeError, mt940.IntakeError) as error:
        detail = getattr(error, "line", None) or getattr(error, "location", None)
        fail("The original " + kind + " reader reported " + error.code + (" at " + str(detail) if detail else "") + ".",
             "BANK_SOURCE_" + error.code)
    for section in sections:
        section["rowCount"] = len(section["_rows"])
        for index, row in enumerate(section["_rows"]):
            row["rowNumber"] = index + 2
    return {"sourceFormat": kind, "statementOptions": settings, "parserProfile": profile,
            "parserReport": report, "parserReportSha256": digest(report), "sections": sections}


def inspect(raw, metadata, inputs, context):
    compiled = compile_source(raw, inputs)
    source = {**metadata, "sourceFormat": compiled["sourceFormat"]}
    result = {"schema": SCHEMA, "caseId": context["program"]["id"], "expectedVersion": context["program"]["version"],
        "source": source, "statements": [{k: deepcopy(v) for k, v in row.items() if not k.startswith("_")}
                                        for row in compiled["sections"]]}
    result["inspectionSha256"] = digest(result)
    return result


def select(raw, metadata, inputs):
    compiled = compile_source(raw, inputs)
    selected = inputs.get("statementId")
    if not isinstance(selected, str) or not selected:
        fail("Inspect the original file and select its exact account and currency section.")
    section = next((row for row in compiled["sections"] if row["id"] == selected), None)
    if section is None:
        fail("The selected account section differs from this original source. Inspect it again.", "BANK_STATEMENT_SELECTION", 409)
    if not section["cashEligible"]:
        fail("This original credit account records liabilities. Continue its obligations in Supplier accounts.", "BANK_ACCOUNT_IS_LIABILITY")
    if section["currency"] != text(inputs.get("currency"), "Original account currency", 40, True).upper():
        fail("The selected account currency differs from the original statement section.", "BANK_STATEMENT_CURRENCY")
    if not section["_rows"]:
        fail("The selected original account has no posted movements to receive.", "BANK_NO_POSTED_MOVEMENTS")
    if len(section["_rows"]) > 5000:
        fail("The selected original account exceeds 5,000 posted source movements.", "STATEMENT_ROW_LIMIT", 413)
    rows, details = [], {}
    for row in section["_rows"]:
        original = dict(zip(HEADERS, [row["date"], row["reference"], row["description"], row["amount"],
                                     row["currency"], str(row["sourceLine"]), canonical(row["nativeIdentity"]["originalFields"])]))
        rows.append((row["rowNumber"], [original[key] for key in HEADERS], original))
        details[row["rowNumber"]] = deepcopy(row)
    summary = {"sourceFormat": compiled["sourceFormat"], "statementId": selected, "parserProfile": compiled["parserProfile"],
        "parserReportSha256": compiled["parserReportSha256"], "accountReference": section["accountReference"],
        "bankId": section["bankId"], "kind": section["kind"],
        "nativeAccountSha256": section.get("nativeAccountSha256"), "dateBasis": "OFX_DTPOSTED" if compiled["sourceFormat"] == "OFX" else "MT940_VALUE_DATE",
        "sourceOpeningBalance": section["openingBalance"], "sourceClosingBalance": section["closingBalance"],
        "pendingCount": section["pendingCount"], "balanceSnapshots": section.get("balanceSnapshots", []),
        "findings": section["findings"]}
    return {"headers": list(HEADERS), "rows": rows, "details": details, "summary": summary,
            "parserReport": compiled["parserReport"]}



def row_controls(config, context, details, reference_key):
    """Index original corrections once for this complete source selection."""
    problems = {number: list(row["problems"]) for number, row in details.items()}
    selected, by_target, active = {}, {}, {}
    for cash in context["records"]["cash"]:
        if cash["state"] != "VOID":
            active.setdefault(cash.get("referenceKey"), cash)
    for number, row in details.items():
        native = row["nativeIdentity"]
        if (native.get("sourceFormat") == "OFX" and native.get("correctionAction") == "REPLACE"
                and config["decisions"].get(number, {}).get("action", "IMPORT") == "IMPORT"):
            selected[number] = native
            by_target.setdefault(native["correctsFitid"], []).append(number)
    graph = {native["fitid"]: native["correctsFitid"] for native in selected.values()}
    cycles = {}
    for first in graph:
        path, positions, current = [], set(), first
        while current in graph and current not in cycles and current not in positions:
            path.append(current)
            positions.add(current)
            current = graph[current]
        cyclic = current in positions or cycles.get(current, False)
        for member in path:
            cycles[member] = cyclic
    for number, row in details.items():
        native = row["nativeIdentity"]
        if native.get("sourceFormat") != "OFX":
            continue
        original_id = native["fitid"]
        if original_id in by_target:
            problems[number].append("This original FITID is superseded by selected replacement source row " +
                str(by_target[original_id][0]) + ". Exclude the superseded occurrence with its reason.")
        if native.get("correctionAction") != "REPLACE":
            continue
        target = native["correctsFitid"]
        if target == original_id or cycles.get(original_id, cycles.get(target, False)):
            problems[number].append("The original selected replacement chain contains a cycle or self-reference.")
        if len(by_target.get(target, [])) > 1:
            problems[number].append("Several selected replacements address this original FITID. Select one and retain the other exclusions.")
        retained = active.get(reference_key(config["accountId"], config["currency"], target))
        if retained:
            problems[number].append("The replacement addresses active cash record " + retained["id"] +
                                   ". Retain its original Cash correction before receiving the replacement.")
        if not config.get("sourceReviewNote") and not config["decisions"].get(number, {}).get("reason"):
            problems[number].append("Retain the replacement decision in the source review note or this row's reason.")
    return problems


def validate_review(metadata, review, candidate, raw):
    if not isinstance(candidate.get("bank"), dict) or not isinstance(review.get("bankParserReport"), dict):
        fail("The original bank statement review is incomplete.", "BANK_IMPORT_REVIEW")
    inputs = review.get("inputs")
    if not isinstance(inputs, dict):
        fail("The original bank statement interpretation is incomplete.", "BANK_IMPORT_REVIEW")
    retained = select(raw, metadata, inputs)
    marker, source = metadata.get("statement"), candidate.get("source")
    account = text(inputs.get("accountId"), "Stable statement account ID", 100, True)
    currency = text(inputs.get("currency"), "Original account currency", 40, True).upper()
    native_account = {**{key: retained["summary"].get(key) for key in ("accountReference", "bankId", "kind")},
                      "currency": currency, "identitySha256": retained["summary"].get("nativeAccountSha256")}
    if (not isinstance(marker, dict) or not isinstance(source, dict)
            or marker.get("role") != "ORIGINAL"
            or marker.get("sourceFormat") != inputs.get("sourceFormat")
            or source.get("sourceFormat") != inputs.get("sourceFormat")
            or marker.get("accountId") != account or source.get("accountId") != account
            or source.get("currency") != currency or source.get("sha256") != metadata["sha256"]
            or marker.get("nativeAccount") != native_account
            or marker.get("statementId") != retained["summary"]["statementId"]
            or marker.get("statementOptionsSha256") != digest(options(inputs)[1])
            or marker.get("editionSha256") != digest({"sourceSha256": metadata["sha256"], "inputs": inputs})
            or source.get("editionSha256") != marker.get("editionSha256")):
        fail("The original bank source marker differs from its retained account and interpretation.", "BANK_IMPORT_SOURCE")
    if (digest(review["bankParserReport"]) != candidate["bank"].get("parserReportSha256")
            or digest(review["bankParserReport"]) != digest(retained["parserReport"])
            or candidate["bank"] != retained["summary"]):
        fail("The bank statement review differs from its original native reader output.", "BANK_IMPORT_REVIEW")
    originals = {number: fields for number, _, fields in retained["rows"]}
    rows = candidate.get("rows")
    if not isinstance(rows, list) or len(rows) != len(originals):
        fail("The bank statement review has an incomplete original row set.", "BANK_IMPORT_REVIEW")
    for row in rows:
        if (not isinstance(row, dict) or isinstance(row.get("rowNumber"), bool)
                or not isinstance(row.get("rowNumber"), int)):
            fail("The bank statement review has an invalid original row.", "BANK_IMPORT_REVIEW")
        number = row["rowNumber"]
        native = retained["details"].get(number)
        if (not native or row.get("original") != originals[number]
                or any(row.get(key) != native[key] for key in ("sourceLine", "identityBasis", "providerReference", "nativeIdentity"))):
            fail("A received bank movement differs from its original source position and fields.", "BANK_IMPORT_REVIEW")

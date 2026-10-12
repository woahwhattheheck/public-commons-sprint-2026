"""MIT. IATI 2.03 associations projected through the original hardened XML source engine."""
from __future__ import annotations

from collections import Counter
from datetime import date
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import json
from pathlib import Path
import re
import sys

XML_ROOT = Path(__file__).resolve().parent.parent / "xml"
if str(XML_ROOT) not in sys.path:
    sys.path.insert(0, str(XML_ROOT))
from xml_source import (
    InputError, MAX_SOURCE, MAX_RECORD, MAX_DEPTH, Node, parser, parse_stream,
    expanded, utf16_length, dataset_spec as original_dataset_spec,
)

SCHEMA = "stellar-forge.iati-mapping.v1"
DOMAIN_VERSION = "iati-2.03-associations-2"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
TRANSACTION_TYPES = {
    "1": "Incoming funds", "2": "Outgoing commitment", "3": "Disbursement",
    "4": "Expenditure", "5": "Interest payment", "6": "Loan repayment",
    "7": "Reimbursement", "8": "Purchase of equity", "9": "Sale of equity",
    "10": "Credit guarantee", "11": "Incoming commitment",
    "12": "Outgoing pledge", "13": "Incoming pledge",
}
BUDGET_TYPES = {"1": "Original", "2": "Revised"}
BUDGET_STATUSES = {"1": "Indicative", "2": "Committed"}
# Exact IATI 2.03 Currency page snapshot, retrieved 2026-10-12:
# https://iatistandard.org/en/iati-standard/203/codelists/currency/
CURRENCY_CATALOG_DATE = "2026-10-12"
CURRENCY_CODES = frozenset("AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYR BYN BZD CAD CDF CHF CLF CLP CNY COP COU CRC CUC CUP CVE CZK DJF DKK DOP DZD EEK EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LTL LVL LYD MAD MDL MGA MKD MMK MNT MOP MRO MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SSP SRD STD STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN USS UYI UYU UZS VED VEF VES VND VUV WST XAF XBT XCD XDR XOF XPF YER ZAR ZMK ZMW ZWL".split())
WITHDRAWN_CURRENCIES = frozenset("BYR EEK LTL LVL MRO STD USS VEF ZMK".split())
COMMON = [
    "row_id", "identity_basis", "activity_id", "title", "reporting_org_ref",
    "reporting_org_json", "activity_status", "hierarchy", "humanitarian",
    "activity_dates_json", "activity_sectors_json", "activity_countries_json",
    "activity_regions_json", "participating_orgs_json",
]
FINANCIAL = [
    "value", "value_decimal", "currency", "currency_source", "currency_status", "currency_catalog_date", "value_date", "value_day",
    "financial_eligible", "financial_issues_json",
]
FIELDS = {
    "activities": COMMON + [
        "default_currency", "default_language", "title_narratives_json", "descriptions_json",
        "transaction_count", "budget_count", "planned_disbursement_count", "related_activities_json",
        "document_links_json", "default_finance_json", "issues_json",
    ],
    "transactions": COMMON + [
        "transaction_ref", "transaction_type", "transaction_type_label",
        "transaction_date", "transaction_day",
    ] + FINANCIAL + [
        "descriptions_json", "provider_orgs_json", "receiver_orgs_json", "sectors_json",
        "countries_json", "regions_json", "finance_json", "record_json", "issues_json",
    ],
    "budgets": COMMON + [
        "budget_type", "budget_type_label", "budget_type_source", "budget_status",
        "budget_status_label", "budget_status_source", "period_start", "period_start_day",
        "period_end", "period_end_day",
    ] + FINANCIAL + ["record_json", "issues_json"],
}

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def fingerprint(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()

def children(node, name):
    return [child for child in node.children if child.name == name]

def child(node, name):
    items = children(node, name)
    return items[0] if items else None

def attr_child(node, name, attr):
    element = child(node, name)
    return element.attrs.get(attr, "") if element else ""

def text_child(node, name):
    element = child(node, name)
    return element.text("descendant").strip() if element else ""

def node_object(node, preserve_space=False):
    # Expat callback boundaries depend on stream chunks. Coalesce adjacent text
    # before deriving content identity; one logical text node has one value.
    space = node.attrs.get("{http://www.w3.org/XML/1998/namespace}space")
    preserve_space = True if space == "preserve" else False if space == "default" else preserve_space
    containers = {"iati-activity", "transaction", "budget", "title", "description",
                  "reporting-org", "participating-org", "provider-org", "receiver-org",
                  "sector", "recipient-country", "recipient-region", "document-link",
                  "planned-disbursement"}
    keep_whitespace = (preserve_space or not node.children or node.name not in containers
                       or any(isinstance(item, str) and item.strip() for item in node.content))
    content, text_parts = [], []
    for item in node.content:
        if isinstance(item, str):
            text_parts.append(item)
        else:
            if text_parts:
                value = "".join(text_parts)
                if value.strip() or keep_whitespace:
                    content.append(value)
                text_parts = []
            content.append(node_object(item, preserve_space))
    if text_parts:
        value = "".join(text_parts)
        if value.strip() or keep_whitespace:
            content.append(value)
    return {"name": node.name, "attributes": dict(node.attrs), "content": content}

def objects(node, name):
    return [node_object(n) for n in children(node, name)]

def narratives(node, default_language=""):
    if node is None:
        return []
    return [{"language": n.attrs.get(XML_LANG, default_language),
             "languageSource": "narrative" if XML_LANG in n.attrs else "activity",
             "text": n.text("descendant"), "attributes": dict(n.attrs)}
            for n in children(node, "narrative")]

def preferred(node, default_language="", requested_language=""):
    values = narratives(node, default_language)
    for wanted in (requested_language, default_language):
        if wanted:
            match = next((n for n in values if n["language"].lower() == wanted.lower()), None)
            if match:
                return match["text"].strip()
    return values[0]["text"].strip() if values else ""

def day(value):
    """Keep the reported calendar date; do not shift XML date timezones to UTC."""
    if not isinstance(value, str):
        return ""
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})(?:Z|([+-])(\d{2}):(\d{2}))?", value.strip())
    if not match:
        return ""
    try:
        date.fromisoformat(match.group(1))
        if match.group(2):
            hours, minutes = int(match.group(3)), int(match.group(4))
            if hours > 14 or minutes > 59 or (hours == 14 and minutes):
                return ""
        return match.group(1)
    except ValueError:
        return ""

def decimal(value):
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if len(value) > 256 or not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)", value):
        return ""
    try:
        result = Decimal(value)
        return format(result, "f") if result.is_finite() else ""
    except InvalidOperation:
        return ""

def issue(code, message):
    return {"code": code, "message": message}

def money(node, activity):
    problems = []
    values = children(node, "value")
    value = values[0] if values else None
    if len(values) != 1:
        problems.append(issue("value-cardinality", "Exactly one financial value is required"))
    raw = value.text("descendant") if value else ""
    parsed = decimal(raw)
    if not parsed:
        problems.append(issue("value-decimal", "Value must be an exact XML decimal"))
    explicit = value is not None and "currency" in value.attrs
    currency = value.attrs.get("currency", activity.attrs.get("default-currency", "")) if value else ""
    if not re.fullmatch(r"[A-Z]{3}", currency):
        problems.append(issue("value-currency", "A three-letter currency is required on value or activity default-currency"))
    currency_status = "withdrawn" if currency in WITHDRAWN_CURRENCIES else "listed" if currency in CURRENCY_CODES else "unlisted"
    if currency and currency_status == "unlisted":
        problems.append(issue("value-currency-unlisted", "Currency is absent from the retained IATI Currency codelist snapshot"))
    value_date = value.attrs.get("value-date", "") if value else ""
    value_day = day(value_date)
    if not value_day:
        problems.append(issue("value-date", "The financial value needs a valid value-date"))
    return {"value": raw, "value_decimal": parsed, "currency": currency,
            "currency_source": "value" if explicit else "activity-default",
            "currency_status": currency_status, "currency_catalog_date": CURRENCY_CATALOG_DATE,
            "value_date": value_date, "value_day": value_day}, problems

def associations(node, name, language="", default_vocabulary=None):
    result = []
    for entry in children(node, name):
        item = {"attributes": dict(entry.attrs), "narratives": narratives(entry, language),
                "record": node_object(entry)}
        if default_vocabulary:
            item["vocabulary"] = entry.attrs.get("vocabulary", default_vocabulary)
            item["vocabularySource"] = "reported" if "vocabulary" in entry.attrs else "standard-default"
        result.append(item)
    return result

def sector_issues(sectors):
    result = []
    groups = {}
    for sector in sectors:
        vocabulary = sector.attrs.get("vocabulary", "1")
        groups.setdefault(vocabulary, []).append(sector)
        if not sector.attrs.get("code"):
            result.append(issue("sector-code", "Each sector requires a code"))
        if vocabulary in {"98", "99"} and not children(sector, "narrative"):
            result.append(issue("sector-narrative", "Publisher-defined sector vocabulary requires a narrative"))
    with localcontext() as context:
        context.prec = 1024
        for vocabulary, entries in groups.items():
            percentages = [decimal(s.attrs.get("percentage", "")) for s in entries]
            if len(entries) == 1 and "percentage" not in entries[0].attrs:
                continue
            if any(not p or not Decimal(0) <= Decimal(p) <= Decimal(100) for p in percentages):
                result.append(issue("sector-percentage", f"Vocabulary {vocabulary} needs valid percentage allocations"))
            elif sum((Decimal(p) for p in percentages), Decimal(0)) != Decimal(100):
                result.append(issue("sector-percentage-total", f"Vocabulary {vocabulary} percentages must total 100"))
    return result

def activity_context(activity, requested_language=""):
    language = activity.attrs.get(XML_LANG, "")
    ident = text_child(activity, "iati-identifier")
    reporting = child(activity, "reporting-org")
    problems = []
    if len(children(activity, "iati-identifier")) != 1 or not ident:
        problems.append(issue("activity-identifier", "Exactly one nonempty IATI activity identifier is required"))
    if len(children(activity, "reporting-org")) != 1 or not reporting or not reporting.attrs.get("ref"):
        problems.append(issue("reporting-organisation", "Exactly one reporting organisation with a reference is required"))
    sectors = children(activity, "sector")
    transactions = children(activity, "transaction")
    if sectors and any(children(t, "sector") for t in transactions):
        problems.append(issue("sector-level", "Sector classification occurs at both activity and transaction level"))
    if not sectors and any(not children(t, "sector") for t in transactions):
        problems.append(issue("sector-coverage", "Without activity sectors, every transaction needs its sector classification"))
    problems.extend(sector_issues(sectors))
    def narrative_languages(node):
        for item in node.children:
            if item.name == "narrative" and not item.attrs.get(XML_LANG, language):
                return True
            if narrative_languages(item):
                return True
        return False
    if narrative_languages(activity):
        problems.append(issue("narrative-language", "Narratives require their own language or the activity default language"))
    common = {
        "row_id": fingerprint(["activity", ident]), "identity_basis": "activity-identifier",
        "activity_id": ident, "title": preferred(child(activity, "title"), language, requested_language),
        "reporting_org_ref": reporting.attrs.get("ref", "") if reporting else "",
        "reporting_org_json": canonical(objects(activity, "reporting-org")),
        "activity_status": attr_child(activity, "activity-status", "code"),
        "hierarchy": activity.attrs.get("hierarchy", "1"),
        "humanitarian": activity.attrs.get("humanitarian", ""),
        "activity_dates_json": canonical(objects(activity, "activity-date")),
        "activity_sectors_json": canonical(associations(activity, "sector", language, "1")),
        "activity_countries_json": canonical(associations(activity, "recipient-country", language)),
        "activity_regions_json": canonical(associations(activity, "recipient-region", language, "1")),
        "participating_orgs_json": canonical(objects(activity, "participating-org")),
    }
    return common, language, problems

def activity_row(activity, requested_language=""):
    common, language, problems = activity_context(activity, requested_language)
    return {**common, "default_currency": activity.attrs.get("default-currency", ""),
        "default_language": language,
        "title_narratives_json": canonical(narratives(child(activity, "title"), language)),
        "descriptions_json": canonical(objects(activity, "description")),
        "transaction_count": str(len(children(activity, "transaction"))),
        "budget_count": str(len(children(activity, "budget"))),
        "planned_disbursement_count": str(len(children(activity, "planned-disbursement"))),
        "related_activities_json": canonical(objects(activity, "related-activity")),
        "document_links_json": canonical(objects(activity, "document-link")),
        "default_finance_json": canonical({name: objects(activity, name) for name in
            ("default-flow-type", "default-finance-type", "default-aid-type", "default-tied-status")}),
        "issues_json": canonical(problems),
    }

def financial_rows(activity, collection, requested_language=""):
    common, language, context_problems = activity_context(activity, requested_language)
    name = "transaction" if collection == "transactions" else "budget"
    records = children(activity, name)
    candidates = []
    for record in records:
        if collection == "transactions":
            candidates.append(record.attrs.get("ref", "").strip())
        else:
            candidates.append(canonical([record.attrs.get("type", "1"),
                attr_child(record, "period-start", "iso-date"), attr_child(record, "period-end", "iso-date")]))
    unique = Counter(candidates)
    occurrences = Counter()
    for record, candidate in zip(records, candidates):
        content_hash = fingerprint(node_object(record))
        occurrences[content_hash] += 1
        stable = bool(candidate) and unique[candidate] == 1
        identity_basis = ("publisher-transaction-ref" if collection == "transactions" else "budget-type-period") if stable else "complete-content-occurrence"
        identity = ["iati", name, common["activity_id"], identity_basis, candidate if stable else content_hash]
        if not stable:
            identity.append(occurrences[content_hash])
        values, financial_problems = money(record, activity)
        review_problems = list(context_problems)
        if values["currency_status"] == "withdrawn":
            review_problems.append(issue("currency-withdrawn", "The retained codelist marks this currency withdrawn; review its historical value-date"))
        if candidate and unique[candidate] > 1:
            review_problems.append(issue("ambiguous-record-identity", "Repeated publisher reference or budget type/period uses complete-content occurrence identity"))
        if collection == "transactions":
            typ = attr_child(record, "transaction-type", "code")
            when = attr_child(record, "transaction-date", "iso-date")
            if len(children(record, "transaction-type")) != 1 or typ not in TRANSACTION_TYPES:
                financial_problems.append(issue("transaction-type", "Exactly one IATI transaction type 1–13 is required"))
            if len(children(record, "transaction-date")) != 1 or not day(when):
                financial_problems.append(issue("transaction-date", "Exactly one valid transaction date is required"))
            sectors = children(record, "sector")
            review_problems.extend(sector_issues(sectors))
            row = {"transaction_ref": record.attrs.get("ref", ""), "transaction_type": typ,
                "transaction_type_label": TRANSACTION_TYPES.get(typ, ""),
                "transaction_date": when, "transaction_day": day(when),
                "descriptions_json": canonical(objects(record, "description")),
                "provider_orgs_json": canonical(objects(record, "provider-org")),
                "receiver_orgs_json": canonical(objects(record, "receiver-org")),
                "sectors_json": canonical(associations(record, "sector", language, "1")),
                "countries_json": canonical(associations(record, "recipient-country", language)),
                "regions_json": canonical(associations(record, "recipient-region", language, "1")),
                "finance_json": canonical({name: objects(record, name) for name in
                    ("flow-type", "finance-type", "aid-type", "tied-status", "disbursement-channel")}),
            }
        else:
            typ, status = record.attrs.get("type", "1"), record.attrs.get("status", "1")
            start, end = attr_child(record, "period-start", "iso-date"), attr_child(record, "period-end", "iso-date")
            start_day, end_day = day(start), day(end)
            if typ not in BUDGET_TYPES:
                financial_problems.append(issue("budget-type", "Budget type must be original 1 or revised 2"))
            if status not in BUDGET_STATUSES:
                financial_problems.append(issue("budget-status", "Budget status must be indicative 1 or committed 2"))
            if (len(children(record, "period-start")) != 1 or len(children(record, "period-end")) != 1
                or not start_day or not end_day or start_day >= end_day):
                financial_problems.append(issue("budget-period", "Budget requires one valid start and end, with start before end"))
            elif start_day:
                a, b = date.fromisoformat(start_day), date.fromisoformat(end_day)
                try:
                    anniversary = a.replace(year=a.year + 1)
                except ValueError:
                    anniversary = date(a.year + 1, 2, 28) if a.year < 9999 else date.max
                if anniversary is None or b > anniversary:
                    financial_problems.append(issue("budget-duration", "A reported budget period cannot exceed one year"))
            row = {"budget_type": typ, "budget_type_label": BUDGET_TYPES.get(typ, ""),
                "budget_type_source": "reported" if "type" in record.attrs else "standard-default",
                "budget_status": status, "budget_status_label": BUDGET_STATUSES.get(status, ""),
                "budget_status_source": "reported" if "status" in record.attrs else "standard-default",
                "period_start": start, "period_start_day": start_day,
                "period_end": end, "period_end_day": end_day,
            }
        yield {**common, **row, **values, "row_id": fingerprint(identity), "identity_basis": identity_basis,
               "financial_eligible": "false" if financial_problems else "true",
               "financial_issues_json": canonical(financial_problems),
               "record_json": canonical(node_object(record)),
               "issues_json": canonical(review_problems + financial_problems)}

def financial_dimensions(row, collection):
    dimensions = {"collection": collection, "currency": row["currency"],
                  "reportingOrgRef": row["reporting_org_ref"], "hierarchy": row["hierarchy"],
                  "valueDate": row["value_day"]}
    if collection == "transactions":
        return {**dimensions, "transactionType": row["transaction_type"],
                "transactionTypeLabel": row["transaction_type_label"]}
    return {**dimensions, "budgetType": row["budget_type"], "budgetTypeLabel": row["budget_type_label"],
            "budgetStatus": row["budget_status"], "budgetStatusLabel": row["budget_status_label"],
            "periodStart": row["period_start_day"], "periodEnd": row["period_end_day"]}

def walk(stream, on_activity, cancel=None, on_root=None):
    """One publisher activity at a time using the original Expat/Node source adapter."""
    p = parser()
    stack, active = [], []
    root = {}
    count = size = nodes = 0
    def start(raw, attrs):
        nonlocal size, nodes
        name = expanded(raw)
        if len(stack) >= MAX_DEPTH or len(name) > 2048 or len(attrs) > 256:
            raise InputError("IATI XML exceeds supported depth, name or attribute limits")
        stack.append(name)
        if len(stack) == 1:
            if name != "iati-activities":
                raise InputError("Use an unqualified IATI iati-activities publisher document")
            root.update({expanded(k): v for k, v in attrs.items()})
            if on_root:
                on_root(root)
        if active or stack == ["iati-activities", "iati-activity"]:
            node = Node(name, {expanded(k): v for k, v in attrs.items()})
            size += len(name.encode()) + sum(len(k.encode()) + len(v.encode()) for k, v in node.attrs.items()) + 128
            nodes += 1
            if size > MAX_RECORD or nodes > 100000:
                raise InputError("One IATI activity exceeds 16 MiB working text or 100,000 nodes")
            if active:
                active[-1].children.append(node)
                active[-1].content.append(node)
            active.append(node)
    def text(value):
        nonlocal size
        if active:
            size += len(value.encode())
            if size > MAX_RECORD:
                raise InputError("One IATI activity exceeds 16 MiB working text")
            active[-1].content.append(value)
    def end(_):
        nonlocal count, size, nodes
        if active:
            node = active.pop()
            if not active:
                count += 1
                on_activity(node, count)
                size = nodes = 0
        stack.pop()
    p.StartElementHandler, p.EndElementHandler, p.CharacterDataHandler = start, end, text
    byte_count = parse_stream(p, stream, cancel)
    return {"attributes": root, "version": root.get("version", ""), "activities": count, "bytes": byte_count}

def inventory(stream, cancel=None):
    counts = {"activities": 0, "transactions": 0, "budgets": 0, "plannedDisbursements": 0,
              "reviewRecords": 0, "reviewIssues": 0, "excludedFinancialRecords": 0}
    activity_ids, reporting_orgs, currencies = set(), set(), set()
    groups, examples, reviews = {}, [], []
    def record_issues(row, collection, ordinal):
        problems = json.loads(row["issues_json"])
        if problems:
            counts["reviewRecords"] += 1
            counts["reviewIssues"] += len(problems)
            if len(reviews) < 100:
                reviews.append({"activity": ordinal, "activityId": row["activity_id"],
                                "collection": collection, "rowId": row["row_id"], "issues": problems})
    def record(activity, ordinal):
        row = activity_row(activity)
        counts["activities"] += 1
        counts["plannedDisbursements"] += int(row["planned_disbursement_count"])
        if row["activity_id"] in activity_ids:
            problems = json.loads(row["issues_json"])
            problems.append(issue("duplicate-activity-identifier", "This source repeats an activity identifier"))
            row["issues_json"] = canonical(problems)
        activity_ids.add(row["activity_id"])
        if len(activity_ids) > 1000000:
            raise InputError("Publisher inventory exceeds one million distinct activities")
        reporting_orgs.add(row["reporting_org_ref"])
        record_issues(row, "activities", ordinal)
        if len(examples) < 30:
            examples.append({key: row[key] for key in ("activity_id", "title", "reporting_org_ref", "default_currency", "transaction_count", "budget_count", "issues_json")})
        for collection in ("transactions", "budgets"):
            for financial in financial_rows(activity, collection):
                counts[collection] += 1
                record_issues(financial, collection, ordinal)
                if financial["currency"]:
                    currencies.add(financial["currency"])
                if financial["financial_eligible"] != "true":
                    counts["excludedFinancialRecords"] += 1
                    continue
                dimensions = financial_dimensions(financial, collection)
                key = canonical(dimensions)
                if key not in groups:
                    groups[key] = {**dimensions, "count": 0, "amount": Decimal(0)}
                groups[key]["count"] += 1
                groups[key]["amount"] += Decimal(financial["value_decimal"])
                if len(groups) > 250000:
                    raise InputError("Publisher inventory exceeds 250,000 financial groups")
    with localcontext() as context:
        context.prec = 1024
        metadata = walk(stream, record, cancel)
    source_issues = []
    if metadata["version"] != "2.03":
        source_issues.append(issue("iati-version", "This operator projects IATI version 2.03"))
    if counts["activities"] == 0:
        source_issues.append(issue("empty-activities", "Publisher source contains no IATI activities"))
    financial_groups = [{**groups[key], "amount": format(groups[key]["amount"], "f")} for key in sorted(groups)]
    return {"schema": "stellar-forge.iati-inventory.v1", "standard": "2.03",
            "source": metadata, "counts": counts, "reportingOrgRefs": sorted(reporting_orgs),
            "currencies": sorted(currencies), "financialGroups": financial_groups,
            "sourceIssues": source_issues, "reviewExamples": reviews, "activityExamples": examples,
            "reviewExamplesShown": len(reviews), "activityExamplesShown": len(examples),
            "completeReview": "Native full editions and portfolio review.jsonl retain all selected record findings",
            "semantics": "Whole publisher reported amounts by reporting organisation, hierarchy, collection, currency, type and value date; budget status and periods remain distinct"}

def validate_plan(raw):
    allowed = {"schema", "domainVersion", "collection", "name", "language", "fields", "selection",
               "columns", "keys", "filters", "ranges", "sorts", "allowEmpty",
               "defaultLimit", "maxLimit", "maxBytes", "maxRows", "maxCellChars"}
    if not isinstance(raw, dict) or set(raw) - allowed:
        raise InputError("IATI mapping contains unknown fields")
    if raw.get("schema", SCHEMA) != SCHEMA or raw.get("domainVersion", DOMAIN_VERSION) != DOMAIN_VERSION:
        raise InputError("Use the current IATI 2.03 mapping schema and domain version")
    collection = raw.get("collection")
    if collection not in FIELDS:
        raise InputError("Choose activities, transactions or budgets")
    name = raw.get("name", "IATI " + collection)
    if not isinstance(name, str) or not name.strip() or utf16_length(name) > 128 or re.search(r"[\x00-\x1f\x7f]", name):
        raise InputError("Dataset name must be printable text of 1–128 UTF-16 code units")
    language = raw.get("language", "")
    if not isinstance(language, str) or len(language) > 64 or (language and not re.fullmatch(r"[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*", language)):
        raise InputError("Preferred narrative language must be a short language tag")
    fields = raw.get("fields", FIELDS[collection])
    if (not isinstance(fields, list) or not fields or any(not isinstance(v, str) or v not in FIELDS[collection] for v in fields)
        or len(set(fields)) != len(fields) or "row_id" not in fields):
        raise InputError("Select distinct known collection fields including row_id")
    fields = list(fields)
    selection = raw.get("selection", {})
    permitted = {"activityIds"}
    if collection != "activities":
        permitted |= {"currencies", "dateFrom", "dateTo",
                      "transactionTypes" if collection == "transactions" else "budgetTypes"}
    if not isinstance(selection, dict) or set(selection) - permitted:
        raise InputError("Selection field is not applicable to this collection")
    selected = {}
    for key, values in selection.items():
        if key in {"dateFrom", "dateTo"}:
            if not isinstance(values, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", values) or not day(values):
                raise InputError(f"{key} must be a complete YYYY-MM-DD date")
            selected[key] = values
        else:
            if not isinstance(values, list) or len(values) > 10000 or any(not isinstance(v, str) or not v or len(v) > 1024 for v in values):
                raise InputError(f"{key} requires at most 10,000 nonempty exact string values")
            if key == "currencies" and any(not re.fullmatch(r"[A-Z]{3}", v) for v in values):
                raise InputError("Selected currencies must be three-letter codes")
            if key == "transactionTypes" and any(v not in TRANSACTION_TYPES for v in values):
                raise InputError("Select IATI transaction type codes 1–13")
            if key == "budgetTypes" and any(v not in BUDGET_TYPES for v in values):
                raise InputError("Select original 1 and/or revised 2 budgets")
            if values:
                selected[key] = sorted(set(values))
    if selected.get("dateFrom", "0000") > selected.get("dateTo", "9999"):
        raise InputError("Selection start date follows its end date")
    filters = sorted(v for v in ("activity_id", "reporting_org_ref", "currency", "transaction_type", "budget_type", "budget_status", "financial_eligible") if v in fields)
    range_candidates = ("transaction_day", "period_start_day", "period_end_day")
    ranges = sorted(v for v in range_candidates if v in fields)
    sorts = sorted(v for v in ("row_id", "activity_id", "title", "transaction_day", "period_start_day") if v in fields)
    computed = {"columns": [{"name": field, "type": "string", "nullable": False} for field in fields],
                "keys": ["row_id"], "filters": filters, "ranges": ranges, "sorts": sorts}
    for key, value in computed.items():
        if key in raw and raw[key] != value:
            raise InputError(f"{key} is fixed by the selected IATI fields")
    result = {"schema": SCHEMA, "domainVersion": DOMAIN_VERSION, "collection": collection,
              "name": name, "language": language, "fields": fields, "selection": selected, **computed}
    result["allowEmpty"] = raw.get("allowEmpty", False)
    if type(result["allowEmpty"]) is not bool:
        raise InputError("allowEmpty must be an explicit boolean")
    def limit(name, default, maximum):
        value = raw.get(name, default)
        if type(value) is not int or not 1 <= value <= maximum:
            raise InputError(f"{name} must be an integer from 1 to {maximum}")
        return value
    result["maxLimit"] = limit("maxLimit", 250, 1000)
    result["defaultLimit"] = limit("defaultLimit", 50, result["maxLimit"])
    result["maxBytes"] = limit("maxBytes", 64 * 1024 * 1024, MAX_SOURCE)
    result["maxRows"] = limit("maxRows", 250000, 1000000)
    result["maxCellChars"] = limit("maxCellChars", 1048576, 1048576)
    return result

def preset(collection, name=None, **options):
    raw = {"schema": SCHEMA, "collection": collection, **options}
    if name is not None:
        raw["name"] = name
    return validate_plan(raw)

def presets():
    return {"schema": "stellar-forge.iati-presets.v1", "standard": "2.03",
            "collections": [{"collection": collection, "label": collection.title(),
                             "fields": FIELDS[collection], "plan": preset(collection)}
                            for collection in FIELDS],
            "transactionTypes": TRANSACTION_TYPES, "budgetTypes": BUDGET_TYPES,
            "budgetStatuses": BUDGET_STATUSES,
            "currencyCatalog": {"asOf": CURRENCY_CATALOG_DATE, "codes": sorted(CURRENCY_CODES),
                                "withdrawn": sorted(WITHDRAWN_CURRENCIES),
                                "source": "https://iatistandard.org/en/iati-standard/203/codelists/currency/"}}

def selected(row, plan):
    selection, collection = plan["selection"], plan["collection"]
    for key, column in (("activityIds", "activity_id"), ("currencies", "currency"),
                        ("transactionTypes", "transaction_type"), ("budgetTypes", "budget_type")):
        if key in selection and row.get(column) not in selection[key]:
            return False
    start, end = selection.get("dateFrom"), selection.get("dateTo")
    if start or end:
        if collection == "transactions":
            reported_start = reported_end = row["transaction_day"]
        else:
            reported_start, reported_end = row["period_start_day"], row["period_end_day"]
        if not reported_start or not reported_end or reported_start > reported_end:
            raise InputError(f"Activity {row['activity_id']} has an invalid date in a dated selection; review its unfiltered edition")
        if (start and reported_end < start) or (end and reported_start > end):
            return False
    return True

def extract(stream, plan, on_record, cancel=None):
    plan = validate_plan(plan)
    count = 0
    activity_ids = set()
    def version(root):
        if root.get("version") != "2.03":
            raise InputError("IATI native editions require publisher XML version 2.03")
    def record(activity, ordinal):
        nonlocal count
        ident = text_child(activity, "iati-identifier")
        if not ident or len(children(activity, "iati-identifier")) != 1 or ident in activity_ids:
            raise InputError(f"Publisher activity {ordinal} has a missing or repeated IATI identifier")
        activity_ids.add(ident)
        if len(activity_ids) > 1000000:
            raise InputError("Publisher source exceeds one million distinct activities")
        if plan["collection"] == "activities":
            rows = [activity_row(activity, plan["language"])]
        else:
            rows = financial_rows(activity, plan["collection"], plan["language"])
        for row in rows:
            if not selected(row, plan):
                continue
            count += 1
            if count > plan["maxRows"]:
                raise InputError("Selected complete edition exceeds maxRows")
            cells = [row[field] for field in plan["fields"]]
            if any(utf16_length(cell) > plan["maxCellChars"] for cell in cells):
                raise InputError(f"Activity {ident} contains a projected cell larger than maxCellChars")
            on_record(count, cells, list(cells))
    walk(stream, record, cancel, version)
    return count

def dataset_spec(plan):
    return original_dataset_spec(validate_plan(plan))

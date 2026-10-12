"""Agency usage, monthly allocation and retained bill-back in the BI workspace."""
from __future__ import annotations

import base64
import copy
import csv
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_FLOOR, ROUND_HALF_UP, localcontext
import io
import json
from pathlib import PurePosixPath
import re
import zipfile

from .store import Conflict, digest, encoded, identifier, now

KINDS = ("billing_agency", "billing_import", "billing_policy", "billing_period", "billing_delivery")
MAX_INPUT = 64 * 1024 * 1024
MAX_ROWS = 250000
COST_FIELDS = {
    "amount": ("CostInBillingCurrency", "Cost", "PreTaxCost"),
    "currency": ("BillingCurrency", "BillingCurrencyCode", "Currency"),
    "resource_id": ("ResourceId", "InstanceId"),
    "resource_group": ("ResourceGroup", "ResourceGroupName"),
    "subscription_id": ("SubscriptionId", "SubscriptionGuid"),
    "service": ("ConsumedService", "ServiceName", "MeterCategory"),
    "date": ("Date", "UsageDateTime", "UsageDate"),
    "charge_type": ("ChargeType",),
    "tags": ("Tags",),
    "billing_period_start": ("BillingPeriodStartDate", "BillingPeriodStart"),
    "cost_allocation_rule": ("CostAllocationRuleName",),
    "invoice_id": ("InvoiceId",),
    "description": ("ProductName", "MeterName", "Description"),
    "billing_account_id": ("BillingAccountId", "AccountId"),
    "billing_profile_id": ("BillingProfileId",),
}
USAGE_FIELDS = {
    "agency_id": ("agency_id",), "usage_key": ("usage_key", "resource_id"),
    "quantity": ("quantity", "runs"), "metric": ("metric",),
    "source_id": ("source_id",), "period": ("period",),
}
MATCH_FIELDS = {"resource_id", "resource_prefix", "resource_group", "subscription_id",
                "service", "charge_type", "tag_key", "tag_value",
                "billing_account_id", "billing_profile_id"}
MONEY_DESCRIPTION = "Azure cost details before provider credits and taxes; separately entered adjustments remain explicit."


def text(value, maximum=10000):
    return str(value if value is not None else "").strip()[:maximum]


def month(value):
    value = text(value, 20)
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value):
        raise ValueError("Use a billing period in YYYY-MM form.")
    return value


def decimal(value, title="Amount", nonnegative=False):
    raw = text(value, 120)
    if not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d{1,3})?", raw):
        raise ValueError(title + " must be a finite decimal, without currency symbols or grouping.")
    try:
        result = Decimal(raw)
    except InvalidOperation:
        raise ValueError(title + " is not a decimal.") from None
    if not result.is_finite() or result.copy_abs() >= Decimal("1e18") or result.as_tuple().exponent < -24:
        raise ValueError(title + " exceeds the supported precision or magnitude.")
    if nonnegative and result < 0:
        raise ValueError(title + " cannot be negative.")
    return result


def number(value):
    value = Decimal(value)
    return format(value, "f") if value else "0"


def currency(value):
    value = text(value, 10).upper()
    if not re.fullmatch(r"[A-Z]{3}", value):
        raise ValueError("Each cost row needs a three-letter billing currency.")
    return value


def normalized_header(value):
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def minor_text(value, units):
    return format(Decimal(value).scaleb(-units), "." + str(units) + "f")


def balanced_round(values, units):
    """Round the complete sum once, then distribute its row-level residual."""
    scale = Decimal(10) ** units
    with localcontext() as context:
        context.prec = 64
        exact = [amount * scale for _, amount in values]
        rounded = [int(value.to_integral_value(rounding=ROUND_FLOOR)) for value in exact]
        target = int(sum(exact, Decimal(0)).to_integral_value(rounding=ROUND_HALF_UP))
        residual = target - sum(rounded)
        order = sorted(range(len(values)), key=lambda i: (-(exact[i] - rounded[i]), values[i][0]))
        if not 0 <= residual <= len(order):
            raise ValueError("The monthly rounding residual could not be reconciled.")
        for index in order[:residual]:
            rounded[index] += 1
    return dict(zip((key for key, _ in values), rounded)), target


def split_minor(total, shares):
    """Allocate a signed row's minor units without losing refunds or pennies."""
    if not shares:
        return []
    with localcontext() as context:
        context.prec = 64
        weights = [(s["agency_id"], decimal(s["weight"], "Allocation weight", True)) for s in shares]
        denominator = sum((weight for _, weight in weights), Decimal(0))
        if denominator <= 0:
            raise ValueError("Allocation weights need a positive total.")
        exact = [(agency, Decimal(abs(total)) * weight / denominator) for agency, weight in weights]
        floors = {agency: int(value.to_integral_value(rounding=ROUND_FLOOR)) for agency, value in exact}
        residual = abs(total) - sum(floors.values())
        for agency, _ in sorted(exact, key=lambda item: (-(item[1] - floors[item[0]]), item[0]))[:residual]:
            floors[agency] += 1
        sign = -1 if total < 0 else 1
        return [{"agency_id": agency, "weight": number(weight), "minor": floors[agency] * sign}
                for agency, weight in weights]


def upload(request):
    try:
        data = base64.b64decode(request["base64"], validate=True)
    except Exception:
        raise ValueError("Choose a complete input file.") from None
    if not data or len(data) > MAX_INPUT:
        raise ValueError("Each complete input must contain 1 byte through 64 MiB.")
    filename = PurePosixPath(text(request.get("filename", "input.csv"), 500).replace("\\", "/")).name
    if not filename or any(ord(c) < 32 for c in filename):
        raise ValueError("The input filename is invalid.")
    return data, filename


def csv_parts(data, filename):
    """Keep exact original member identities; never deduplicate similar rows."""
    if filename.lower().endswith(".zip"):
        try:
            package = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile:
            raise ValueError("The selected ZIP is incomplete or invalid.") from None
        with package:
            infos = package.infolist()
            names = [entry.filename for entry in infos]
            if len(names) != len(set(names)) or len(names) > 1000:
                raise ValueError("The input ZIP has duplicate member names or more than 1000 entries.")
            if sum(entry.file_size for entry in infos) > MAX_INPUT:
                raise ValueError("The expanded input ZIP exceeds 64 MiB.")
            parts = []
            for entry in infos:
                name = entry.filename
                if entry.is_dir() or not name.lower().endswith(".csv"):
                    continue
                path = PurePosixPath(name)
                if path.is_absolute() or ".." in path.parts or "\\" in name:
                    raise ValueError("The ZIP has an invalid CSV member path.")
                if (entry.external_attr >> 16) & 0o170000 not in (0, 0o100000):
                    raise ValueError("ZIP CSV members must be regular files.")
                parts.append((name, package.read(entry)))
            if not parts:
                raise ValueError("The ZIP must contain at least one complete CSV export.")
            return parts
    if not filename.lower().endswith(".csv"):
        raise ValueError("Choose a CSV export or a ZIP containing complete CSV partitions.")
    return [(filename, data)]


def csv_rows(data, aliases, supplied):
    try:
        body = data.decode("utf-16") if data.startswith((b"\xff\xfe", b"\xfe\xff")) else data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError("Use UTF-8 or BOM-marked UTF-16 CSV exports.") from None
    reader = csv.DictReader(io.StringIO(body, newline=""), strict=True)
    headers = reader.fieldnames or []
    normal = [normalized_header(header) for header in headers]
    if not headers or any(not key for key in normal) or len(set(normal)) != len(normal):
        raise ValueError("Each CSV needs distinct, nonempty column headers.")
    header_lookup = dict(zip(normal, headers))
    supplied = supplied or {}
    if not isinstance(supplied, dict) or set(supplied) - set(aliases):
        raise ValueError("The column mapping contains unsupported fields.")
    mapping = {}
    for field, defaults in aliases.items():
        if field in supplied:
            candidate = supplied[field]
            if candidate in (None, ""):
                continue
            if candidate not in headers:
                raise ValueError("Mapped column was not found: " + str(candidate))
            mapping[field] = candidate
        else:
            found = next((header_lookup[normalized_header(item)] for item in defaults
                          if normalized_header(item) in header_lookup), None)
            if found:
                mapping[field] = found
    rows = []
    for ordinal, row in enumerate(reader, 1):
        if None in row or any(value is None for value in row.values()):
            raise ValueError("CSV record " + str(ordinal) + " has a different number of fields from its header.")
        if ordinal > MAX_ROWS:
            raise ValueError("One import may contain at most 250000 data records.")
        rows.append((ordinal, {key: row[column] for key, column in mapping.items()}))
    if not rows:
        raise ValueError("The CSV export has no data records.")
    return headers, mapping, rows


def parse_tags(raw):
    raw = text(raw, 100000)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw if raw.startswith("{") else "{" + raw + "}")
    except ValueError:
        return None
    if not isinstance(parsed, dict):
        return None
    return {str(key): str(value) for key, value in parsed.items()}


def date_month(value, date_format):
    value = text(value, 60)
    if not value:
        return None
    formats = {"iso": ("%Y-%m-%d", "%Y%m%d", "%Y-%m", "%Y%m"),
               "month_first": ("%m/%d/%Y",), "day_first": ("%d/%m/%Y",)}
    if date_format not in formats:
        raise ValueError("Choose iso, month_first or day_first for billing-period dates.")
    for candidate in formats[date_format]:
        try:
            # Native ISO date-time exports retain their full value in the source.
            parsed = datetime.strptime(value[:10] if candidate == "%Y-%m-%d" else value, candidate)
            return parsed.strftime("%Y-%m")
        except ValueError:
            pass
    raise ValueError("Billing-period date " + value + " does not match " + date_format + ".")


class Billing:
    def __init__(self, service):
        self.service = service
        self.store = service.store
        self.actions = {
            "billing.agency.save": self.agency_save,
            "billing.cost.import": self.cost_import,
            "billing.usage.import": self.usage_import,
            "billing.policy.save": self.policy_save,
            "billing.period.prepare": self.period_prepare,
            "billing.period.review": self.period_review,
            "billing.period.finalize": self.period_finalize,
            "billing.period.reopen": self.period_reopen,
            "billing.period.export": self.period_export,
        }

    def write(self, kind, payload, entity_id=None, expected=0):
        return self.service.write(kind, payload, entity_id, expected)

    def ref(self, record):
        return self.service.reference(record)

    def existing(self, kind, entity_id):
        try:
            return self.store.get(kind, entity_id)
        except KeyError:
            return None

    def json_blob(self, value, filename):
        return self.store.blob(encoded(value).encode("utf-8"), filename, "application/json")

    def records(self, imported):
        return json.loads(self.store.bytes(imported["payload"]["records"]["digest"]))["rows"]

    def agency_save(self, request):
        existing = self.store.get("billing_agency", request["id"]) if request.get("id") and request.get("expected", 0) else None
        previous = existing["payload"] if existing else {}
        name = text(request.get("label", previous.get("label")), 300)
        if not name:
            raise ValueError("Enter the agency's billing name.")
        active = request.get("active", previous.get("active", True))
        if type(active) is not bool:
            raise ValueError("Agency active must be true or false.")
        payload = {"label": name, "code": text(request.get("code", previous.get("code")), 100),
                   "active": active, "notes": text(request.get("notes", previous.get("notes")), 10000)}
        return self.write("billing_agency", payload, request.get("id"), request.get("expected", 0))

    def cost_import(self, request):
        try:
            with localcontext() as context:
                context.prec = 64
                return self._cost_import(request)
        except csv.Error as error:
            raise ValueError("The cost CSV could not be parsed: " + str(error)) from error

    def _cost_import(self, request):
        data, filename = upload(request)
        period = month(request.get("period"))
        basis = request.get("basis", "actual")
        view = request.get("allocation_view", "supplier")
        invoice_status = request.get("invoice_status", "provisional")
        if basis not in {"actual", "amortized"} or view not in {"supplier", "allocated"}:
            raise ValueError("Choose actual or amortized costs, and supplier or allocated view.")
        if invoice_status not in {"provisional", "closed"}:
            raise ValueError("Choose provisional or closed for the supplier's invoice period.")
        date_format = request.get("date_format", "iso")
        original_hash = digest(data)
        rows, parts, warnings, currencies = [], [], [], set()
        invalid_tags, excluded, total = 0, 0, Decimal(0)
        for part_name, part_data in csv_parts(data, filename):
            headers, mapping, values = csv_rows(part_data, COST_FIELDS, request.get("columns"))
            if not {"amount", "currency"} <= set(mapping):
                raise ValueError("Map the billing-currency amount and currency to actual CSV headers.")
            part_hash = digest(part_data)
            parts.append({"name": part_name, "sha256": part_hash, "bytes": len(part_data),
                          "row_count": len(values), "headers": headers, "columns": mapping})
            for ordinal, mapped in values:
                if len(rows) >= MAX_ROWS:
                    raise ValueError("One import may contain at most 250000 total data records.")
                amount = decimal(mapped["amount"], "Cost record " + str(ordinal))
                code = currency(mapped["currency"])
                currencies.add(code)
                period_value = date_month(mapped.get("billing_period_start"), date_format)
                if period_value and period_value != period:
                    raise ValueError("CSV billing period " + period_value + " differs from selected " + period + ".")
                tags = parse_tags(mapped.get("tags"))
                invalid_tags += tags is None
                excluded_row = bool(mapped.get("cost_allocation_rule", "").strip()) and view == "supplier"
                excluded += excluded_row
                if not excluded_row:
                    total += amount
                row_id = digest((original_hash + ":" + part_name + ":" + str(ordinal)).encode())
                rows.append({**{key: text(value, 10000) for key, value in mapped.items() if key != "tags"},
                    "id": row_id, "source_file": part_name, "source_sha256": part_hash,
                    "source_row": ordinal, "source_line": ordinal + 1,
                    "amount": number(amount), "currency": code, "tags": tags,
                    "excluded": excluded_row,
                    "excluded_reason": "Provider internal allocation row excluded in supplier view." if excluded_row else ""})
        if len(currencies) != 1:
            raise ValueError("Import one billing currency at a time; this file contains " + ", ".join(sorted(currencies)) + ".")
        if excluded:
            warnings.append(str(excluded) + " provider internal allocation rows retained and excluded in supplier view.")
        if invalid_tags:
            warnings.append(str(invalid_tags) + " tag fields could not be parsed; tag rules leave them for review.")
        if not any(row.get("billing_period_start") for row in rows):
            warnings.append("The source has no billing-period field; the selected month is the operator's explicit import scope.")
        if invoice_status == "provisional":
            warnings.append("Supplier period is provisional; a later export may add charges, refunds or rounding adjustments.")
        identity = {"file": original_hash, "period": period, "basis": basis, "view": view,
            "invoice_status": invoice_status, "invoice_id": text(request.get("invoice_id"), 200),
            "parts": parts, "date_format": date_format}
        azure_origin = (self.service.azure.billing_origin(request["azure_origin"], data, request)
                        if "azure_origin" in request else None)
        if azure_origin is not None:
            identity["azure_origin"] = azure_origin
        fingerprint = digest(encoded(identity).encode())
        entity_id = "cost_" + fingerprint[:40]
        previous = self.existing("billing_import", entity_id)
        if previous:
            return previous
        return self.write("billing_import", {"label": text(request.get("label", filename), 300), "type": "cost",
            "period": period, "basis": basis, "allocation_view": view, "currency": next(iter(currencies)),
            "invoice_status": invoice_status, "invoice_id": text(request.get("invoice_id"), 200),
            "date_format": date_format, "money_description": MONEY_DESCRIPTION,
            "file": self.store.blob(data, filename, "application/zip" if filename.lower().endswith(".zip") else "text/csv"),
            "records": self.json_blob({"schema": "commons-bi-cost-input/1", "rows": rows}, entity_id + ".json"),
            "parts": parts, "columns": parts[0]["columns"], "row_count": len(rows),
            "included_rows": len(rows) - excluded, "excluded_rows": excluded,
            "total": number(total), "warnings": warnings, "imported": now(),
            **({"azure_origin": azure_origin} if azure_origin is not None else {})}, entity_id)

    def usage_import(self, request):
        try:
            return self._usage_import(request)
        except csv.Error as error:
            raise ValueError("The usage CSV could not be parsed: " + str(error)) from error

    def _usage_import(self, request):
        data, filename = upload(request)
        period = month(request.get("period"))
        original_hash = digest(data)
        rows, parts, missing_agencies = [], [], set()
        agencies = {item["id"]: item for item in self.store.list("billing_agency")}
        for part_name, part_data in csv_parts(data, filename):
            headers, mapping, values = csv_rows(part_data, USAGE_FIELDS, request.get("columns"))
            if not {"agency_id", "usage_key", "quantity", "metric"} <= set(mapping):
                raise ValueError("Map agency_id, usage_key, quantity and metric to actual usage headers.")
            part_hash = digest(part_data)
            parts.append({"name": part_name, "sha256": part_hash, "bytes": len(part_data),
                          "row_count": len(values), "headers": headers, "columns": mapping})
            for ordinal, mapped in values:
                if len(rows) >= MAX_ROWS:
                    raise ValueError("One import may contain at most 250000 total usage records.")
                agency_id = identifier(mapped["agency_id"].strip())
                if agency_id not in agencies:
                    missing_agencies.add(agency_id)
                if mapped.get("period") and month(mapped["period"]) != period:
                    raise ValueError("A usage record belongs to a different selected month.")
                usage_key = text(mapped["usage_key"], 2000)
                metric = text(mapped["metric"], 100).casefold()
                if not usage_key or not metric:
                    raise ValueError("Each usage record needs an explicit resource/pool and metric.")
                source_id = text(mapped.get("source_id"), 100)
                source = self.store.get("source", source_id) if source_id else None
                rows.append({"id": digest((original_hash + ":" + part_name + ":" + str(ordinal)).encode()),
                    "source_file": part_name, "source_sha256": part_hash, "source_row": ordinal,
                    "agency_id": agency_id, "usage_key": usage_key, "metric": metric,
                    "quantity": number(decimal(mapped["quantity"], "Usage quantity", True)),
                    "source": self.ref(source) if source else None, "period": period})
        fingerprint = digest(encoded({"period": period, "file": digest(data), "parts": parts}).encode())
        entity_id = "usage_" + fingerprint[:40]
        previous = self.existing("billing_import", entity_id)
        if previous:
            return previous
        warnings = (["Define the billing agencies for retained usage IDs: " + ", ".join(sorted(missing_agencies))]
                    if missing_agencies else [])
        return self.write("billing_import", {"label": text(request.get("label", filename), 300),
            "type": "usage", "period": period,
            "file": self.store.blob(data, filename, "application/zip" if filename.lower().endswith(".zip") else "text/csv"),
            "records": self.json_blob({"schema": "commons-bi-usage-input/1", "rows": rows}, entity_id + ".json"),
            "parts": parts, "columns": parts[0]["columns"], "row_count": len(rows),
            "metrics": sorted({row["metric"] for row in rows}), "warnings": warnings, "imported": now()}, entity_id)

    def agency(self, agency_id):
        record = self.store.get("billing_agency", identifier(agency_id))
        if not record["payload"]["active"]:
            raise ValueError("The selected billing agency is inactive: " + agency_id)
        return {"id": record["id"], "revision": record["revision"], **{
            key: record["payload"][key] for key in ("label", "code", "active")}}

    def shares(self, values, agencies):
        if not isinstance(values, list):
            raise ValueError("Allocation shares must be a list of agencies and decimal weights.")
        result, seen = [], set()
        for item in values:
            if not isinstance(item, dict):
                raise ValueError("Each share needs agency_id and weight.")
            agency_id = identifier(item.get("agency_id"))
            if agency_id in seen:
                raise ValueError("An agency may appear only once in an allocation share list.")
            seen.add(agency_id)
            weight = decimal(item.get("weight"), "Allocation weight", True)
            if not weight:
                continue
            agencies[agency_id] = self.agency(agency_id)
            result.append({"agency_id": agency_id, "weight": number(weight)})
        return result

    def policy_save(self, request):
        existing = self.store.get("billing_policy", request["id"]) if request.get("id") else None
        label = text(request.get("label"), 300)
        rules_input = request.get("rules")
        if not label or not isinstance(rules_input, list) or not 1 <= len(rules_input) <= 1000:
            raise ValueError("Name the allocation policy and provide 1 through 1000 ordered rules.")
        rules, agencies, seen = [], {}, set()
        for supplied in rules_input:
            if not isinstance(supplied, dict):
                raise ValueError("Each allocation rule must be an object.")
            rule_id = identifier(supplied.get("id"))
            if rule_id in seen:
                raise ValueError("Each allocation rule needs a distinct ID.")
            seen.add(rule_id)
            match = supplied.get("match", {})
            if not isinstance(match, dict) or set(match) - MATCH_FIELDS:
                raise ValueError("The rule has an unsupported resource matcher.")
            match = {key: text(value, 2000) for key, value in match.items() if value is not None}
            if bool(match.get("tag_key")) != ("tag_value" in match):
                raise ValueError("A tag rule needs both tag_key and tag_value.")
            method = supplied.get("method")
            rule = {"id": rule_id, "label": text(supplied.get("label", rule_id), 300),
                    "match": match, "method": method}
            if method == "direct":
                agency_id = identifier(supplied.get("agency_id"))
                agencies[agency_id] = self.agency(agency_id)
                rule.update({"agency_id": agency_id, "shares": [{"agency_id": agency_id, "weight": "1"}]})
            elif method == "fixed":
                rule["shares"] = self.shares(supplied.get("shares", []), agencies)
                if not rule["shares"]:
                    raise ValueError("A fixed rule needs at least one positive agency weight.")
            elif method == "usage":
                metric = text(supplied.get("metric"), 100).casefold()
                if not metric:
                    raise ValueError("A usage rule needs one declared metric.")
                rule.update({"metric": metric, "usage_key": text(supplied.get("usage_key"), 2000),
                    "fallback_shares": self.shares(supplied.get("fallback_shares", []), agencies)})
            else:
                raise ValueError("Choose direct, fixed or usage for every rule.")
            rules.append(rule)
        return self.write("billing_policy", {"label": label, "notes": text(request.get("notes"), 20000),
            "rules": rules, "agencies": list(agencies.values()), "method": "ordered-first-match"},
            existing["id"] if existing else None, request.get("expected", 0))

    @staticmethod
    def matches(row, match):
        for key, wanted in match.items():
            if key in {"tag_key", "tag_value"}:
                continue
            if key == "resource_prefix":
                if not str(row.get("resource_id", "")).casefold().startswith(wanted.casefold()):
                    return False
            elif str(row.get(key, "")).casefold() != wanted.casefold():
                return False
        if "tag_key" in match:
            tags = row.get("tags")
            if tags is None or match["tag_key"] not in tags or tags[match["tag_key"]] != match["tag_value"]:
                return False
        return True

    def selected_imports(self, ids, kind, period, allow_duplicate_partitions=False):
        if not isinstance(ids, list) or len(ids) != len(set(ids)):
            raise ValueError("Select each original input once.")
        result, seen_members = [], set()
        for entity_id in ids:
            record = self.store.get("billing_import", entity_id)
            payload = record["payload"]
            if payload["type"] != kind or payload["period"] != period:
                raise ValueError("Every selected input must have the same type and billing period.")
            # Named members inside one original ZIP stay distinct, including
            # byte-identical partitions. Across selected exports, repeated bytes
            # require an explicit source decision rather than row deletion.
            current_members = {part["sha256"] for part in payload["parts"]}
            if current_members & seen_members and not allow_duplicate_partitions:
                raise ValueError("Selected inputs repeat an exact CSV partition. Select one export, or explain why these are distinct billable partitions.")
            seen_members.update(current_members)
            result.append(record)
        return result

    def period_prepare(self, request):
        with localcontext() as context:
            context.prec = 64
            return self._prepare(request)

    def _prepare(self, request):
        period = month(request.get("period"))
        existing = self.store.get("billing_period", request["id"]) if request.get("id") else None
        if existing and existing["payload"]["status"] != "draft":
            raise ValueError("Open a correction on this reviewed or finalized period before changing its inputs.")
        policy = self.store.get("billing_policy", request["policy_id"], request.get("policy_revision"))
        allow_duplicates = request.get("allow_duplicate_partitions", False)
        duplicate_note = text(request.get("duplicate_partition_note"), 10000)
        if type(allow_duplicates) is not bool or (allow_duplicates and not duplicate_note):
            raise ValueError("An explicit duplicate-partition selection needs its source explanation.")
        costs = self.selected_imports(request.get("cost_import_ids", []), "cost", period, allow_duplicates)
        usage = self.selected_imports(request.get("usage_import_ids", []), "usage", period, allow_duplicates)
        if not costs:
            raise ValueError("Select at least one complete cost input for the period.")
        scopes = {(r["payload"]["currency"], r["payload"]["basis"], r["payload"]["allocation_view"]) for r in costs}
        if len(scopes) != 1:
            raise ValueError("One period must use one currency, one actual/amortized basis and one provider allocation view.")
        code, basis, allocation_view = next(iter(scopes))
        units = request.get("minor_units", 2)
        if type(units) is not int or units not in range(5):
            raise ValueError("Choose zero through four statement decimal places for the billing currency.")
        rules = policy["payload"]["rules"]
        agencies = {item["id"]: copy.deepcopy(item) for item in policy["payload"]["agencies"]}
        # The policy's explicit agency revisions are retained; usage recipients are
        # pinned when the selected monthly inputs are calculated.
        drivers = {}
        for imported in usage:
            for row in self.records(imported):
                key = (row["usage_key"].casefold(), row["metric"])
                by_agency = drivers.setdefault(key, {})
                by_agency[row["agency_id"]] = by_agency.get(row["agency_id"], Decimal(0)) + decimal(row["quantity"])
        rows, excluded_rows = [], []
        source_total = Decimal(0)
        for imported in costs:
            for row in self.records(imported):
                row = {**row, "input": self.ref(imported)}
                if row["excluded"]:
                    excluded_rows.append(row)
                    continue
                source_total += decimal(row["amount"])
                rows.append(row)
        adjustments = request.get("adjustments", [])
        if not isinstance(adjustments, list) or len(adjustments) > 10000:
            raise ValueError("Adjustments must be a list with at most 10000 entries.")
        adjustment_total, normalized_adjustments, adjustment_ids = Decimal(0), [], set()
        for item in adjustments:
            if not isinstance(item, dict):
                raise ValueError("Each adjustment needs an ID, amount and description.")
            entry_id = identifier(item.get("id"))
            if entry_id in adjustment_ids:
                raise ValueError("Each explicit adjustment needs a distinct ID.")
            adjustment_ids.add(entry_id)
            amount = decimal(item.get("amount"), "Adjustment")
            description = text(item.get("description"), 10000)
            if not description:
                raise ValueError("Describe the source and reason for each explicit adjustment.")
            agency_id = item.get("agency_id") or None
            if agency_id:
                agencies[agency_id] = self.agency(agency_id)
            normalized = {"id": entry_id, "amount": number(amount), "description": description,
                "agency_id": agency_id, "resource_id": text(item.get("resource_id"), 2000),
                "charge_type": text(item.get("charge_type", "ManualAdjustment"), 100)}
            normalized_adjustments.append(normalized)
            rows.append({**normalized, "id": "adjustment_" + entry_id, "currency": code, "tags": {},
                "source_file": "Explicit period adjustments", "source_sha256": None,
                "source_row": len(normalized_adjustments), "input": None, "service": "Adjustment",
                "excluded": False, "manual": True})
            adjustment_total += amount
        if not rows:
            raise ValueError("The selected inputs have no supplier rows in this allocation view.")
        row_ids = [row["id"] for row in rows]
        if len(row_ids) != len(set(row_ids)):
            raise ValueError("Selected inputs repeat an original source row identity.")
        rounded, total_minor = balanced_round([(row["id"], decimal(row["amount"])) for row in rows], units)
        lines, agency_totals, agency_counts = [], {}, {}
        unallocated_minor, unallocated_count = 0, 0
        warnings = sorted({warning for imported in costs + usage for warning in imported["payload"].get("warnings", [])})
        if allow_duplicates:
            warnings.append("Explicit duplicate-partition selection: " + duplicate_note)
        for row in rows:
            original_amount, row_minor = decimal(row["amount"]), rounded[row["id"]]
            rule = next((r for r in rules if self.matches(row, r["match"])), None)
            shares, reason, method = [], "", ""
            if row.get("agency_id"):
                shares = [{"agency_id": row["agency_id"], "weight": "1"}]
                method, rule_id = "explicit-adjustment", "explicit-adjustment"
            elif not original_amount:
                method, rule_id = "zero-cost", ""
            elif rule is None:
                reason, rule_id = "No allocation rule matches this source row.", ""
            elif rule["method"] == "usage":
                rule_id = rule["id"]
                key = (rule["usage_key"] or row.get("resource_id", "")).casefold()
                weights = drivers.get((key, rule["metric"]), {})
                shares = [{"agency_id": agency_id, "weight": number(weight)}
                          for agency_id, weight in sorted(weights.items()) if weight > 0]
                method = "usage"
                if not shares:
                    shares = copy.deepcopy(rule["fallback_shares"])
                    method = "explicit-usage-fallback"
                    if not shares:
                        reason = "No positive " + rule["metric"] + " usage for " + (key or "(blank resource)") + "."
            else:
                shares, method, rule_id = copy.deepcopy(rule["shares"]), rule["method"], rule["id"]
            if shares:
                try:
                    for share in shares:
                        if share["agency_id"] not in agencies:
                            agencies[share["agency_id"]] = self.agency(share["agency_id"])
                except (KeyError, ValueError) as error:
                    reason, shares = "A usage recipient needs an active agency definition: " + str(error), []
            allocations = split_minor(row_minor, shares) if shares else []
            for allocation in allocations:
                agency_id = allocation["agency_id"]
                agency_totals[agency_id] = agency_totals.get(agency_id, 0) + allocation["minor"]
                agency_counts[agency_id] = agency_counts.get(agency_id, 0) + 1
                allocation["amount"] = minor_text(allocation.pop("minor"), units)
            if reason:
                unallocated_minor += row_minor
                unallocated_count += 1
            lines.append({**row, "source_amount": number(original_amount), "amount": minor_text(row_minor, units),
                "rounding": number(Decimal(row_minor).scaleb(-units) - original_amount),
                "rule_id": rule_id, "method": method, "reason": reason, "allocations": allocations})
        if sum(agency_totals.values()) + unallocated_minor != total_minor:
            raise ValueError("Agency and unallocated totals differ from the complete monthly amount.")
        agency_summary = [{**item, "amount": minor_text(agency_totals.get(key, 0), units),
                           "line_count": agency_counts.get(key, 0)}
                          for key, item in sorted(agencies.items())]
        totals = {"source": number(source_total), "adjustments": number(adjustment_total),
            "total": minor_text(total_minor, units), "allocated": minor_text(sum(agency_totals.values()), units),
            "unallocated": minor_text(unallocated_minor, units),
            "rounding": number(Decimal(total_minor).scaleb(-units) - source_total - adjustment_total)}
        calculation = {"schema": "commons-bi-allocation/1", "period": period, "currency": code,
            "basis": basis, "allocation_view": allocation_view, "minor_units": units,
            "totals": totals, "lines": lines, "excluded_rows": excluded_rows,
            "agencies": agency_summary, "policy": self.ref(policy),
            "rounding_method": "round-month-total-half-up; signed-largest-remainder-rows; signed-largest-remainder-agency-shares",
            "money_description": MONEY_DESCRIPTION}
        previous = existing["payload"] if existing else {}
        payload = {"label": text(request.get("label", period + " agency allocation"), 300),
            "period": period, "currency": code, "basis": basis, "allocation_view": allocation_view,
            "minor_units": units, "status": "draft", "policy": self.ref(policy),
            "cost_imports": [self.ref(record) for record in costs], "usage_imports": [self.ref(record) for record in usage],
            "adjustments": normalized_adjustments, "notes": text(request.get("notes"), 20000),
            "allow_duplicate_partitions": allow_duplicates, "duplicate_partition_note": duplicate_note,
            "agencies": agency_summary, "totals": totals, "row_count": len(lines),
            "excluded_rows": len(excluded_rows), "unallocated_count": unallocated_count,
            "calculation": self.json_blob(calculation, period + "-allocation.json"),
            "invoice_status": "closed" if all(r["payload"]["invoice_status"] == "closed" for r in costs) else "provisional",
            "warnings": warnings, "money_description": MONEY_DESCRIPTION,
            "corrections": previous.get("corrections", []), "supersedes": previous.get("supersedes"),
            "correction_reason": previous.get("correction_reason", ""), "calculated": now()}
        return self.write("billing_period", payload, existing["id"] if existing else None, request.get("expected", 0))

    def period_review(self, request):
        record = self.store.get("billing_period", request["id"])
        payload = record["payload"]
        if payload["status"] != "draft":
            raise ValueError("Review the current draft period.")
        if payload["unallocated_count"]:
            raise ValueError("Resolve " + str(payload["unallocated_count"]) + " unallocated source rows before reviewing the period.")
        self.store.bytes(payload["calculation"]["digest"])
        payload["status"] = "reviewed"
        payload["review"] = {"at": now(), "actor": self.service.actor,
            "note": text(request.get("note"), 10000), "calculation_digest": payload["calculation"]["digest"]}
        return self.write("billing_period", payload, record["id"], request["expected"])

    def period_finalize(self, request):
        record = self.store.get("billing_period", request["id"])
        payload = record["payload"]
        if payload["status"] != "reviewed" or payload["review"]["calculation_digest"] != payload["calculation"]["digest"]:
            raise ValueError("Review this exact allocation before finalizing its statements.")
        payload["status"] = "finalized"
        payload["finalization"] = {"at": now(), "actor": self.service.actor, "note": text(request.get("note"), 10000)}
        return self.write("billing_period", payload, record["id"], request["expected"])

    def period_reopen(self, request):
        record = self.store.get("billing_period", request["id"])
        payload = record["payload"]
        reason = text(request.get("reason"), 10000)
        if payload["status"] not in {"reviewed", "finalized"} or not reason:
            raise ValueError("Open a correction on a reviewed/finalized period with its reason.")
        correction = {"from": self.ref(record), "reason": reason, "actor": self.service.actor, "at": now()}
        if payload["status"] == "finalized":
            payload["supersedes"] = self.ref(record)
        payload.update({"status": "draft", "correction_reason": reason,
                        "corrections": payload.get("corrections", []) + [correction]})
        payload.pop("review", None)
        payload.pop("finalization", None)
        return self.write("billing_period", payload, record["id"], request["expected"])

    def period_export(self, request):
        from .billing_export import export_period
        record = self.store.get("billing_period", request["id"], request.get("revision"))
        if record["payload"]["status"] != "finalized":
            raise ValueError("Finalize this reviewed period before building the agency statement handoff.")
        entity_id = "billback_" + digest(encoded(self.ref(record)).encode())[:40]
        previous = self.existing("billing_delivery", entity_id)
        if previous:
            return previous
        result = export_period(self, record)
        return self.write("billing_delivery", {"label": record["payload"]["label"] + " statements",
            "period": self.ref(record), "archive": result["archive"], "files": result["files"],
            "agencies": len(record["payload"]["agencies"]), "totals": record["payload"]["totals"],
            "currency": record["payload"]["currency"], "built": now()}, entity_id)

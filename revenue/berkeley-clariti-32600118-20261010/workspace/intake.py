"""Original CSV/JSON intake and explicit mappings for the existing case comparator."""
from __future__ import annotations

import csv
import io
import json
import re
from collections import Counter
from datetime import date, datetime, timezone

FIELDS = ["id", "type", "department", "status", "relatedIds", "reviewStates", "reviewAssignments", "reviewDueAt", "attachments", "paymentMinor"]
REQUIRED = ["id", "type", "department", "status", "attachments"]
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")
TYPES = {"permit", "license", "inspection", "special_event"}
MAX_RECORDS = 500000


def captured_time(value):
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None or dt.utcoffset() is None:
            raise ValueError()
        return dt.isoformat()
    except (ValueError, TypeError):
        raise ValueError("Record the export capture time as an ISO date/time with a UTC offset.") from None


def load_export(raw, filename):
    text = raw.decode("utf-8-sig")
    if filename.lower().endswith(".csv"):
        reader = csv.reader(io.StringIO(text, newline=""))
        headers = next(reader, None)
        if not headers or any(not h.strip() for h in headers) or len(set(headers)) != len(headers):
            raise ValueError("CSV needs unique, nonblank column headings.")
        rows = []
        for number, values in enumerate(reader, 2):
            if not values:
                continue
            if len(values) != len(headers):
                raise ValueError("CSV row %d does not match the header width." % number)
            rows.append({"line": number, "data": dict(zip(headers, values))})
        cohort = None
    elif filename.lower().endswith(".json"):
        def reject_nonfinite(value):
            raise ValueError("JSON contains a nonfinite number: " + value)
        doc = json.loads(text, parse_constant=reject_nonfinite)
        cohort = doc.get("cohort") if isinstance(doc, dict) else None
        values = doc.get("records") if isinstance(doc, dict) else doc
        if not isinstance(values, list) or any(not isinstance(row, dict) for row in values):
            raise ValueError("JSON needs a records array of objects, or an array of record objects.")
        rows = [{"line": i + 1, "data": row} for i, row in enumerate(values)]
        paths = set()

        def discover(value, prefix=""):
            for key, child in value.items():
                path = prefix + str(key)
                paths.add(path)
                if isinstance(child, dict):
                    discover(child, path + ".")
        for row in values:
            discover(row)
        headers = sorted(paths)
    else:
        raise ValueError("Upload a UTF-8 CSV or JSON export.")
    if len(rows) > MAX_RECORDS:
        raise ValueError("The original comparator supports at most 500,000 records per snapshot.")
    return {"headers": headers, "rows": rows, "cohort": cohort}


def default_mapping(headers):
    return {"fields": {f: f if f in headers else "" for f in FIELDS}, "related_separator": "json", "reviews": {}, "reviewers": {}, "review_due_dates": {}, "type_aliases": {}, "department_aliases": {}, "status_aliases": {}, "review_aliases": {}, "reviewer_aliases": {}, "payment_format": "minor"}


def validate_mapping(mapping, headers):
    if not isinstance(mapping, dict):
        raise ValueError("Supply a field mapping object.")
    result = {**default_mapping(headers), **mapping}
    fields = result["fields"]
    if not isinstance(fields, dict) or set(fields) - set(FIELDS):
        raise ValueError("Mapping contains an unsupported canonical field.")
    for field in REQUIRED:
        if not fields.get(field) or fields[field] not in headers:
            raise ValueError("Map required field " + field + ".")
    if any(not isinstance(v, str) or (v and v not in headers) for v in fields.values()):
        raise ValueError("Every mapped field must name an original column or JSON path.")
    if result["related_separator"] not in ("json", "|", ";"):
        raise ValueError("Select JSON, pipe or semicolon for related identifiers.")
    if result["payment_format"] not in ("minor", "decimal"):
        raise ValueError("Choose minor units or a dot-decimal payment format.")
    for name in ("reviews", "reviewers", "review_due_dates", "type_aliases", "department_aliases", "status_aliases", "review_aliases", "reviewer_aliases"):
        values = result[name]
        if not isinstance(values, dict) or any(not isinstance(k, str) or not isinstance(v, str) or not k.strip() or not v.strip() for k, v in values.items()):
            raise ValueError(name + " must contain nonblank text pairs.")
        result[name] = {k.strip(): v.strip() for k, v in values.items()}
    for name in ("reviews", "reviewers", "review_due_dates"):
        if any(path not in headers for path in result[name].values()):
            raise ValueError("A department " + name + " mapping refers to an absent column.")
    return result


def value_at(row, path):
    if path in row:
        return row[path]
    value = row
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def short_text(value, label):
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        raise ValueError(label + " must be nonempty text.")
    value = str(value).strip()
    if not value or len(value) > 256 or any(ord(c) < 32 for c in value):
        raise ValueError(label + " must be short nonempty text without control characters.")
    return value


def identifier(value):
    value = short_text(value, "Identifier")
    if not IDENTIFIER.fullmatch(value):
        raise ValueError("Use an authoritative normalized ID containing letters, numbers, dot, underscore, colon or hyphen, up to 128 characters.")
    return value


def minor_units(value, mode, scale):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError("Payment values must be exact text or integer units, not floating point.")
    value = str(value).strip()
    if mode == "minor":
        if not re.fullmatch(r"\d+", value):
            raise ValueError("Minor-unit payment must be a nonnegative whole number.")
        units = int(value)
    else:
        match = re.fullmatch(r"(\d+)(?:\.(\d+))?", value)
        if not match:
            raise ValueError("Payment requires a nonnegative dot decimal without grouping or a currency symbol.")
        fraction = match.group(2) or ""
        if len(fraction) > scale and any(c != "0" for c in fraction[scale:]):
            raise ValueError("Payment has more decimal places than the configured currency scale.")
        units = int(match.group(1)) * (10 ** scale) + int(fraction[:scale].ljust(scale, "0") or "0")
    if len(str(units)) > 19:
        raise ValueError("Payment exceeds the original comparator's 19-digit minor-unit contract.")
    return str(units)


def review_due_date(value):
    value = short_text(value, "Review due date")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return date.fromisoformat(value).isoformat()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value):
        raise ValueError("Review due date must be an ISO date or ISO timestamp with a UTC offset.")
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def load_crosswalk(raw):
    parsed = load_export(raw, "crosswalk.csv")
    if set(parsed["headers"]) != {"source_id", "target_id"}:
        raise ValueError("Crosswalk columns must be source_id and target_id.")
    targets, sources = {}, set()
    for row in parsed["rows"]:
        source, target = identifier(row["data"]["source_id"]), identifier(row["data"]["target_id"])
        if source in sources or target in targets:
            raise ValueError("Crosswalk must map each source and target ID only once.")
        sources.add(source)
        targets[target] = source
    if not targets:
        raise ValueError("Crosswalk needs at least one identifier pair.")
    return targets


def normalize_export(export, settings, crosswalk=None):
    parsed = load_export(export["raw"], export["filename"])
    mapping = validate_mapping(export["mapping"], parsed["headers"])
    records, contexts, errors, previews = [], {}, [], []
    if parsed["cohort"] is not None and parsed["cohort"] != settings["cohort"]:
        errors.append({"dataset_id": export["id"], "line": 0, "message": "Embedded export cohort differs from the selected workspace cohort."})
    crosswalk = crosswalk or {}
    for original in parsed["rows"]:
        row = original["data"]
        values = {field: value_at(row, path) for field, path in mapping["fields"].items() if path}
        normalized, row_errors = None, []
        try:
            def mapped_id(value):
                value = identifier(value)
                if export["side"] == "target" and crosswalk:
                    if value not in crosswalk:
                        raise ValueError("Target identifier " + value + " is absent from the selected crosswalk.")
                    value = crosswalk[value]
                return value

            key = mapped_id(values.get("id"))
            record_type = short_text(values.get("type"), "Type")
            record_type = mapping["type_aliases"].get(record_type, record_type)
            if record_type not in TYPES:
                raise ValueError("Map type to permit, license, inspection or special_event.")
            department = short_text(values.get("department"), "Department")
            department = mapping["department_aliases"].get(department, department)
            status = short_text(values.get("status"), "Status")
            status = mapping["status_aliases"].get(status, status)
            raw_links = values.get("relatedIds")
            if raw_links is None or raw_links == "":
                links = []
            elif isinstance(raw_links, list):
                links = raw_links
            elif mapping["related_separator"] == "json":
                links = json.loads(raw_links)
            else:
                links = str(raw_links).split(mapping["related_separator"])
            if not isinstance(links, list) or len(links) > 4000:
                raise ValueError("Related identifiers must be an array of at most 4,000 items.")
            links = [mapped_id(link) for link in links]
            if len(set(links)) != len(links):
                raise ValueError("Related identifiers contain a duplicate after mapping.")
            raw_reviews = values.get("reviewStates")
            reviews = {} if raw_reviews in (None, "") else (json.loads(raw_reviews) if isinstance(raw_reviews, str) else raw_reviews)
            if not isinstance(reviews, dict):
                raise ValueError("Review states must be a department-to-status object.")
            reviews = dict(reviews)
            for dept, path in mapping["reviews"].items():
                value = value_at(row, path)
                if value not in (None, ""):
                    if dept in reviews:
                        raise ValueError("Department review is mapped twice: " + dept)
                    reviews[dept] = value
            normalized_reviews = {}
            for dept, state in reviews.items():
                dept = short_text(dept, "Review department")
                dept = mapping["department_aliases"].get(dept, dept)
                state = short_text(state, "Review status")
                state = mapping["review_aliases"].get(state, state)
                if dept in normalized_reviews:
                    raise ValueError("Department aliases collapse two distinct review entries.")
                normalized_reviews[dept] = state
            if len(normalized_reviews) > 100:
                raise ValueError("The original comparator supports at most 100 reviewing departments.")
            attachments = values.get("attachments")
            if isinstance(attachments, bool) or not re.fullmatch(r"\d+", str(attachments).strip()):
                raise ValueError("Attachment count must be an explicit nonnegative whole number.")
            attachments = int(attachments)
            if attachments > 100000:
                raise ValueError("Attachment count exceeds the comparator contract.")
            normalized = {"id": key, "type": record_type, "department": department, "status": status, "relatedIds": sorted(links), "reviewStates": normalized_reviews, "attachments": attachments}
            for field, column_map, alias_name in (("reviewAssignments", "reviewers", "reviewer_aliases"), ("reviewDueAt", "review_due_dates", None)):
                raw_entries = values.get(field)
                entries = {} if raw_entries in (None, "") else (json.loads(raw_entries) if isinstance(raw_entries, str) else raw_entries)
                if not isinstance(entries, dict):
                    raise ValueError(field + " must be a department-to-value object.")
                entries = dict(entries)
                for dept, path in mapping[column_map].items():
                    value = value_at(row, path)
                    if value not in (None, ""):
                        if dept in entries:
                            raise ValueError(field + " is mapped twice for " + dept)
                        entries[dept] = value
                mapped_entries = {}
                for dept, value in entries.items():
                    dept = short_text(dept, "Review department")
                    dept = mapping["department_aliases"].get(dept, dept)
                    if dept in mapped_entries:
                        raise ValueError("Department aliases collapse two distinct " + field + " entries.")
                    value = review_due_date(value) if field == "reviewDueAt" else short_text(value, "Assigned reviewer")
                    mapped_entries[dept] = mapping[alias_name].get(value, value) if alias_name else value
                if len(mapped_entries) > 100:
                    raise ValueError(field + " supports at most 100 reviewing departments.")
                if mapped_entries:
                    normalized[field] = mapped_entries
            payment = values.get("paymentMinor")
            if payment not in (None, ""):
                normalized["paymentMinor"] = minor_units(payment, mapping["payment_format"], settings["currency_scale"])
            records.append(normalized)
            contexts[key] = {"dataset_id": export["id"], "line": original["line"], "values": row}
        except (ValueError, TypeError, KeyError) as error:
            row_errors.append(str(error))
            errors.append({"dataset_id": export["id"], "line": original["line"], "message": str(error), "values": row})
        previews.append({**original, "normalized": normalized, "errors": row_errors})
    duplicates = {key for key, count in Counter(r["id"] for r in records).items() if count > 1}
    for key in sorted(duplicates):
        errors.append({"dataset_id": export["id"], "line": 0, "message": "Duplicate normalized case identifier: " + key})
    return {"cohort": settings["cohort"], "records": records, "contexts": contexts, "errors": errors, "previews": previews, "rows": len(parsed["rows"])}

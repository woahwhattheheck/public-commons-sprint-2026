"""Exact survey values, original field labels and explicit comparison purposes."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
import re
from urllib.parse import urlsplit

from model import clone, decimal, encoded, fail, hash_id, identity, integer, text

SCHEMA = "stellar-forge.property-survey-intake.v1"
EXTENSION = "stellar-forge.property-research.v1"
TABLES = ("property_documents", "property_studies", "property_editions", "property_reviews", "property_selections")
DDL = "\n".join("CREATE TABLE IF NOT EXISTS " + table + " (id TEXT PRIMARY KEY,body TEXT NOT NULL,created TEXT NOT NULL);" for table in TABLES)
CRITERIA = [
    {"key": key, "label": label} for key, label in (
        ("target", "Target population and programme"), ("location", "Location and market area"),
        ("design", "Building and unit design"), ("bedrooms", "Bedroom and bathroom types"),
        ("size", "Floor area"), ("amenities", "Property and unit amenities"),
        ("age", "Age and renovations"), ("quality", "Quality and neighborhood"),
        ("parking", "Parking"), ("utilities", "Utility responsibility and rent basis"),
        ("occupancy", "Occupancy and availability"))]


def object_value(value, field, maximum=256000):
    if not isinstance(value, dict) or len(encoded(value)) > maximum:
        fail("PROPERTY_OBJECT_REQUIRED", field=field)
    return clone(value)


def key(value, field="key"):
    value = text(value, field, maximum=160)
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.:-]*", value):
        fail("PROPERTY_KEY_INVALID", field=field)
    return value


def optional_text(value, field, maximum=4000):
    return None if value is None or value == "" else text(value, field, maximum=maximum)


def date_value(value, field):
    if value is None or value == "":
        return None
    try:
        if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
            raise ValueError()
    except ValueError:
        fail("PROPERTY_DATE_INVALID", field=field)
    return value


def dates(value):
    value["observation_start"] = date_value(value.get("observation_start"), "observation_start")
    value["observation_end"] = date_value(value.get("observation_end"), "observation_end")
    if value["observation_start"] and value["observation_end"] and value["observation_start"] > value["observation_end"]:
        fail("PROPERTY_OBSERVATION_INTERVAL_REVERSED")
    value["observation_label"] = optional_text(value.get("observation_label"), "observation_label")
    return value


def texts(value, field):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 500:
        fail("PROPERTY_TEXT_LIST_REQUIRED", field=field)
    return [text(x, field, maximum=2000) for x in value]


def citations(value, documents=None, required=True):
    if not isinstance(value, list) or (required and not value) or len(value) > 1000:
        fail("PROPERTY_CITATIONS_REQUIRED")
    result = []
    for item in value:
        item = object_value(item, "citation")
        item["document_key"] = key(item.get("document_key"), "document_key")
        page = item.get("pdf_page")
        if page is not None:
            item["pdf_page"] = integer(page, "pdf_page", minimum=1, maximum=100000)
        item["printed_page"] = optional_text(item.get("printed_page"), "printed_page", 100)
        item["locator"] = text(item.get("locator"), "locator", maximum=2000)
        if documents is not None:
            doc = documents.get(item["document_key"])
            if doc is None:
                fail("PROPERTY_DOCUMENT_NOT_BOUND", document_key=item["document_key"])
            if page and doc.get("pages") and page > doc["pages"]:
                fail("PROPERTY_CITATION_PAGE_OUTSIDE_DOCUMENT", page=page, document_key=item["document_key"])
        result.append(item)
    return result


def document(value):
    value = object_value(value, "document")
    value.pop("local_path", None)
    value["key"] = key(value.get("key"))
    value["title"] = text(value.get("title"), "title", maximum=1000)
    value["publisher"] = optional_text(value.get("publisher"), "publisher", 1000)
    url = text(value.get("url"), "url", maximum=8000)
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        fail("PROPERTY_SOURCE_URL_INVALID")
    value["url"] = url
    value["published_date"] = date_value(value.get("published_date"), "published_date")
    value["pages"] = None if value.get("pages") is None else integer(value["pages"], "pages", minimum=1, maximum=100000)
    return dates(value)


def study(value, documents=None):
    value = object_value(value, "study")
    for reserved in ("schema", "id", "created", "reopened", "document_ids"):
        value.pop(reserved, None)
    value["key"] = key(value.get("key"))
    value["name"] = text(value.get("name"), "name", maximum=1000)
    value["effective_date"] = date_value(value.get("effective_date"), "effective_date")
    value["currency"] = text(value.get("currency", "USD"), "currency", maximum=16)
    value["subject"] = object_value(value.get("subject", {}), "subject")
    area = object_value(value.get("market_area", {}), "market_area")
    area["name"] = text(area.get("name"), "market_area.name", maximum=1000)
    area["boundary_description"] = text(area.get("boundary_description"), "boundary_description", maximum=12000)
    area["selection_notes"] = optional_text(area.get("selection_notes"), "selection_notes", 16000)
    area["citations"] = citations(area.get("citations", []), documents, required=False)
    value["market_area"] = area
    return value


def number(value, field, maximum=None):
    result = decimal(value, field, nullable=True)
    if result is not None and (Decimal(result) < 0 or maximum is not None and Decimal(result) > maximum):
        fail("PROPERTY_NUMBER_OUTSIDE_RANGE", field=field)
    return result


def count(value, field):
    return None if value is None else integer(value, field, maximum=10000000)


def unit(value, documents):
    value = object_value(value, "unit")
    value["key"] = key(value.get("key"))
    for field in ("bedrooms", "bathrooms", "sqft_min", "sqft_max", "rent_min", "rent_max", "ami_percent"):
        value[field] = number(value.get(field), field)
    for field in ("unit_count", "vacant_units"):
        value[field] = count(value.get(field), field)
    for field in ("sqft", "rent"):
        lo, hi = value[field + "_min"], value[field + "_max"]
        if lo is not None and hi is not None and Decimal(lo) > Decimal(hi):
            fail("PROPERTY_RANGE_REVERSED", field=field, unit_key=value["key"])
    if value["unit_count"] is not None and value["vacant_units"] is not None and value["vacant_units"] > value["unit_count"]:
        fail("PROPERTY_VACANCY_EXCEEDS_UNITS", unit_key=value["key"])
    for field in ("style", "rent_raw", "ami_raw", "utility_note"):
        value[field] = optional_text(value.get(field), field)
    for field in ("rent_basis", "rent_period", "currency"):
        value[field] = optional_text(value.get(field), field, 100)
    if any(value[field] is not None for field in ("rent_min", "rent_max")) and any(not value[field] for field in ("rent_basis", "rent_period", "currency")):
        fail("PROPERTY_RENT_BASIS_REQUIRED", unit_key=value["key"])
    for field in ("utilities_owner", "utilities_tenant"):
        value[field] = texts(value.get(field), field)
    value["citations"] = citations(value.get("citations"), documents)
    value["original_fields"] = object_value(value.get("original_fields", {}), "original_fields")
    return value


def property_value(value, documents):
    value = dates(object_value(value, "property", maximum=2 * 1024 * 1024))
    value["key"] = key(value.get("key"))
    value["name"] = text(value.get("name"), "name", maximum=1000)
    for field in ("address", "city", "state", "postal_code", "target_population", "status", "market_area_membership", "quality", "neighborhood"):
        value[field] = optional_text(value.get(field), field)
    for field in ("programs", "amenities"):
        value[field] = texts(value.get(field), field)
    for field in ("year_built", "year_renovated"):
        # Original mixed/range year expressions stay in original_fields.
        value[field] = None if value.get(field) is None else integer(value[field], field, minimum=1000, maximum=9999)
    for field in ("unit_count", "vacant_units"):
        value[field] = count(value.get(field), field)
    value["occupancy_pct_reported"] = number(value.get("occupancy_pct_reported"), "occupancy_pct_reported", 100)
    if value["unit_count"] is not None and value["vacant_units"] is not None and value["vacant_units"] > value["unit_count"]:
        fail("PROPERTY_VACANCY_EXCEEDS_UNITS", property_key=value["key"])
    value["citations"] = citations(value.get("citations"), documents)
    value["original_fields"] = object_value(value.get("original_fields", {}), "original_fields")
    units = value.get("units", [])
    if not isinstance(units, list) or len(units) > 2000:
        fail("PROPERTY_UNIT_SCHEDULE_REQUIRED")
    value["units"] = sorted([unit(item, documents) for item in units], key=lambda item: item["key"])
    if len({item["key"] for item in value["units"]}) != len(units):
        fail("PROPERTY_DUPLICATE_UNIT_KEY", property_key=value["key"])
    return value


def intake(value, documents):
    value = object_value(value, "intake", maximum=64 * 1024 * 1024)
    if value.get("schema") != SCHEMA:
        fail("PROPERTY_INTAKE_SCHEMA_REQUIRED")
    value["study"] = study(value.get("study"), documents)
    properties = value.get("properties")
    if not isinstance(properties, list) or not 1 <= len(properties) <= 10000:
        fail("PROPERTY_SURVEY_ROWS_REQUIRED")
    value["properties"] = sorted([property_value(item, documents) for item in properties], key=lambda item: item["key"])
    keys = {item["key"] for item in value["properties"]}
    if len(keys) != len(properties):
        fail("PROPERTY_DUPLICATE_KEY")
    result, seen = [], set()
    for source in value.get("source_comparables", []):
        source = object_value(source, "source_comparable")
        source["property_key"] = key(source.get("property_key"), "property_key")
        source["purpose"] = text(source.get("purpose"), "comparison purpose", maximum=1000)
        pair = (source["purpose"], source["property_key"])
        if source["property_key"] not in keys or pair in seen or type(source.get("selected")) is not bool:
            fail("PROPERTY_SOURCE_SELECTION_INVALID")
        seen.add(pair)
        source["reason"] = text(source.get("reason"), "reason", maximum=16000)
        source["citations"] = citations(source.get("citations"), documents)
        result.append(source)
    value["source_comparables"] = sorted(result, key=lambda x: (x["purpose"], x["property_key"]))
    return value


def issues(prop):
    result = []
    for field in ("unit_count", "vacant_units"):
        total = prop.get(field)
        values = [u.get(field) for u in prop["units"]]
        if values and all(v is not None for v in values) and total is not None and sum(values) != total:
            result.append({"code": "schedule_total_differs", "field": field, "property_value": total, "schedule_sum": sum(values)})
    for note in prop.get("original_fields", {}).get("source_notes", []):
        if isinstance(note, dict) and note.get("kind") == "source_difference":
            result.append({"code": "source_difference", "detail": clone(note)})
    if not prop.get("observation_label") and not prop.get("observation_start"):
        result.append({"code": "observation_period_unspecified"})
    return result


def changed_paths(before, after, prefix=""):
    if before == after:
        return []
    if isinstance(before, dict) and isinstance(after, dict):
        return [path for k in sorted(set(before) | set(after)) for path in changed_paths(before.get(k), after.get(k), prefix + "/" + k)]
    if isinstance(before, list) and isinstance(after, list) and all(isinstance(x, dict) and "key" in x for x in before + after):
        return changed_paths({x["key"]: x for x in before}, {x["key"]: x for x in after}, prefix)
    return [prefix or "/"]

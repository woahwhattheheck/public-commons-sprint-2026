#!/usr/bin/env python3
"""Load and register the complete retained Upper Savannah watershed source edition."""
from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
import csv
import gzip
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
import math
from pathlib import Path
import re
from typing import Any
from urllib.parse import parse_qs, urlsplit

CONTEXT_NAME = "full-domain-water-context.json"
DOMAIN_NAME = "domain-huc12s.json"
NRCS_NAME = "nrcs-domain-fy26.csv"
COVERAGE_NAME = "scdes-domain217-source-coverage.json"
IDS_NAME = "scdes-original-domain217-classified-objectids.json"
ZERO_NAME = "scdes-huc8-03060104-to-07-target-class-count.json"
CLASSIFIED_NAME = "classified-reaches.csv"
MANIFEST_NAME = "complete-sources.json"
NATIVE_MANIFEST_NAME = "complete-native-sources.json"
OPTIONAL_NAMES = ("source-context-run.json", "classified-full-domain-query.json")
NETWORK_NAME = "native-network.json"
NETWORK_SOURCE_NAME = "native-network-source.json"
DEFAULT_SOURCE_DIR = Path(__file__).resolve().parent.parent / "source" / "water_context" / "20261013"
TARGET_CLASSES = {"ORW", "ONRW", "TN", "TPGT", "TPT"}


class _SourceReader:
    """Read and hash every original file at most once during source validation."""

    def __init__(self, directory: str | Path):
        self.directory = Path(directory).expanduser().resolve()
        if not self.directory.is_dir():
            raise FileNotFoundError(f"Source edition directory does not exist: {self.directory}")
        self.cache: dict[Path, bytes] = {}
        self.descriptors: dict[Path, dict] = {}

    def read(self, name: str, override: str | Path | None = None) -> bytes:
        path = (Path(override).expanduser() if override is not None else self.directory / name).resolve()
        if path not in self.cache:
            if not path.is_file():
                raise FileNotFoundError(f"Required source file does not exist: {path}")
            payload = path.read_bytes()
            self.cache[path] = payload
            self.descriptors[path] = {
                "name": name, "path": str(path), "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
        return self.cache[path]

    def descriptor(self, name: str, override: str | Path | None = None) -> dict:
        path = (Path(override).expanduser() if override is not None else self.directory / name).resolve()
        self.read(name, override)
        return self.descriptors[path]

    def json(self, name: str) -> Any:
        try:
            body = self.read(name)
            if body[:2] == b"\x1f\x8b":
                body = gzip.decompress(body)
            return json.loads(body.decode("utf-8-sig"))
        except (UnicodeError, json.JSONDecodeError, OSError, EOFError) as exc:
            raise ValueError(f"{name} is not valid UTF-8 JSON: {exc}") from exc

    def csv(self, name: str, override: str | Path | None = None) -> list[dict[str, str]]:
        try:
            stream = io.StringIO(self.read(name, override).decode("utf-8-sig"), newline="")
            reader = csv.DictReader(stream)
            if not reader.fieldnames:
                raise ValueError(f"{name} has no CSV header")
            if len(reader.fieldnames) != len(set(reader.fieldnames)):
                raise ValueError(f"{name} has duplicate CSV columns")
            rows = list(reader)
            if any(None in row for row in rows):
                raise ValueError(f"{name} contains rows wider than its CSV header")
            return rows
        except (UnicodeError, csv.Error) as exc:
            raise ValueError(f"{name} is not valid UTF-8 CSV: {exc}") from exc

    def bind_hash(self, name: str, expected: Any, label: str,
                  override: str | Path | None = None) -> None:
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", expected):
            raise ValueError(f"{label} does not contain a SHA-256 digest")
        actual = self.descriptor(name, override)["sha256"]
        if actual != expected.lower():
            raise ValueError(f"{name} SHA-256 does not match {label}: {actual} != {expected}")

    def bind_response(self, name: str, response: Mapping, label: str) -> None:
        if response.get("path") != name:
            raise ValueError(f"{label}.path must identify {name}")
        self.bind_hash(name, response.get("sha256"), f"{label}.sha256")
        if response.get("bytes") != self.descriptor(name)["bytes"]:
            raise ValueError(f"{name} byte length disagrees with {label}.bytes")

    def files(self) -> list[dict]:
        return sorted(self.descriptors.values(), key=lambda row: (row["name"], row["path"]))


def _huc12(value: Any, label: str) -> str:
    text = str(value).strip()
    if not re.fullmatch(r"\d{12}", text):
        raise ValueError(f"{label} must preserve all twelve HUC12 digits: {value!r}")
    return text


def _integer(value: Any, label: str) -> int:
    if isinstance(value, bool) or value is None:
        raise ValueError(f"{label} must be a nonnegative integer")
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation as exc:
        raise ValueError(f"{label} must be a nonnegative integer") from exc
    if not number.is_finite() or number < 0 or number != number.to_integral_value():
        raise ValueError(f"{label} must be a nonnegative integer")
    return int(number)


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _field(row: Mapping, *names: str) -> Any:
    values = {str(key).casefold(): value for key, value in row.items() if key is not None}
    for name in names:
        if name.casefold() in values:
            return values[name.casefold()]
    raise ValueError(f"Required source field is missing: {' / '.join(names)}")


def _expect_count(record: Mapping, key: str, actual: int, label: str) -> None:
    if _integer(record.get(key), f"{label}.{key}") != actual:
        raise ValueError(f"{label}.{key} disagrees with the retained source count {actual}")


def _domain_ids(value: Any) -> list[str]:
    if isinstance(value, Mapping):
        value = value.get("huc12s", value.get("model_domain_huc12s"))
    if not isinstance(value, list):
        raise ValueError(f"{DOMAIN_NAME} must contain a HUC12 array")
    result = [_huc12(item, DOMAIN_NAME) for item in value]
    if not result or len(result) != len(set(result)):
        raise ValueError(f"{DOMAIN_NAME} must contain distinct HUC12 identifiers")
    return result


def _same_area(left: Any, right: Any, label: str) -> None:
    if _text(left) == "" or _text(right) == "":
        if _text(left) != _text(right):
            raise ValueError(f"NRCS source/context area mismatch: {label}")
        return
    try:
        a, b = float(left), float(right)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"NRCS source/context area is not numeric: {label}") from exc
    if not all(math.isfinite(value) and value >= 0 for value in (a, b)):
        raise ValueError(f"NRCS source/context area must be finite and nonnegative: {label}")
    if not math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-7):
        raise ValueError(f"NRCS source/context area mismatch: {label}")


def _check_nrcs(context: Mapping, coverage: Mapping, rows: list[dict], domain: set[str]) -> dict:
    embedded: dict[tuple[str, str], Mapping] = {}
    embedded_hucs: set[str] = set()
    for huc in context.get("hucs", []):
        huc12 = _huc12(huc.get("huc12"), "source context HUC12")
        if huc12 in embedded_hucs:
            raise ValueError(f"Duplicate HUC12 in source context: {huc12}")
        embedded_hucs.add(huc12)
        for row in huc.get("nrcs_state_rows", []):
            if _huc12(row.get("huc12_code"), "NRCS embedded huc12_code") != huc12:
                raise ValueError(f"NRCS row is attached to the wrong HUC12: {huc12}")
            state = _text(row.get("st_usps")).upper()
            if not re.fullmatch(r"[A-Z]{2}", state):
                raise ValueError(f"NRCS state code is invalid for {huc12}")
            key = (huc12, state)
            if key in embedded:
                raise ValueError(f"Duplicate NRCS embedded state/HUC pair: {key}")
            embedded[key] = row
    if embedded_hucs != domain:
        raise ValueError("Source context HUC12 records do not equal the original model domain")
    source: dict[tuple[str, str], Mapping] = {}
    priority_hucs: set[str] = set()
    priority_rows = 0
    system_types: Counter = Counter()
    for row in rows:
        key = (_huc12(_field(row, "huc12_code"), "NRCS CSV huc12_code"),
               _text(_field(row, "st_usps")).upper())
        if key[0] not in domain:
            raise ValueError(f"Matched NRCS CSV contains a HUC12 outside the domain: {key[0]}")
        if key in source:
            raise ValueError(f"Duplicate NRCS CSV state/HUC pair: {key}")
        source[key] = row
        if key not in embedded:
            raise ValueError(f"NRCS CSV state/HUC pair is absent from the source context: {key}")
        comparison = embedded[key]
        for field in ("fy26_status", "system_type", "resource_concern", "huc12_name", "huc12_states"):
            if _text(_field(row, field)) != _text(comparison.get(field)):
                raise ValueError(f"NRCS source/context mismatch for {key} field {field}")
        for field in ("st_ac", "huc12_ac"):
            _same_area(_field(row, field), comparison.get(field), f"{key}/{field}")
        if _integer(_field(row, "OBJECTID"), f"NRCS {key} OBJECTID") != _integer(
                comparison.get("OBJECTID"), f"context {key} OBJECTID"):
            raise ValueError(f"NRCS source/context OBJECTID mismatch for {key}")
        if _text(_field(row, "fy26_status")).casefold() == "high priority area":
            priority_rows += 1
            priority_hucs.add(key[0])
            system_types[_text(_field(row, "system_type"))] += 1
    if set(source) != set(embedded):
        raise ValueError("Matched NRCS CSV and embedded context have different state/HUC pairs")
    if {huc for huc, _ in source} != domain:
        raise ValueError("Matched NRCS CSV does not cover every model-domain HUC12")
    metadata = coverage.get("nrcs_context") or {}
    _expect_count(metadata, "matched_hucs", len(domain), "coverage.nrcs_context")
    _expect_count(metadata, "matched_state_rows", len(rows), "coverage.nrcs_context")
    _expect_count(metadata, "high_priority_hucs", len(priority_hucs), "coverage.nrcs_context")
    _expect_count(metadata, "high_priority_state_rows", priority_rows, "coverage.nrcs_context")
    _expect_count(context.get("nrcs_inventory") or {}, "matched_state_huc_rows",
                  len(rows), "source_context.nrcs_inventory")
    expected_systems = {key: _integer(value, f"priority system type {key}")
                        for key, value in (metadata.get("system_type_counts") or {}).items()}
    if dict(system_types) != expected_systems:
        raise ValueError("NRCS priority system-type counts disagree with the coverage companion")
    return {"matched_nrcs_rows": len(rows), "priority_hucs": len(priority_hucs),
            "priority_state_rows": priority_rows}


def _class_totals(mapping: Mapping, label: str) -> dict[str, int]:
    return {str(key).strip().upper(): _integer(value, f"{label}.{key}")
            for key, value in mapping.items() if _integer(value, f"{label}.{key}") != 0}


def _check_classifications(
        context: Mapping, coverage: Mapping, id_response: Mapping,
        zero_response: Mapping, rows: list[dict], domain: set[str],
) -> dict:
    values = id_response.get("objectIds")
    if not isinstance(values, list):
        raise ValueError("Original classified ID response has no objectIds array")
    ids = [_integer(value, "classification OBJECTID") for value in values]
    if len(ids) != len(set(ids)):
        raise ValueError("Original classification response contains duplicate OBJECTIDs")
    if id_response.get("objectIdFieldName", "OBJECTID").upper() != "OBJECTID":
        raise ValueError("Original classification response does not identify the OBJECTID field")
    native_ids = set(ids)
    retained_ids: set[int] = set()
    class_counts: Counter = Counter()
    huc_class_counts: Counter = Counter()
    publisher_hucs: set[str] = set()
    for row in rows:
        object_id = _integer(_field(row, "OBJECTID"), "retained classification OBJECTID")
        if object_id in retained_ids:
            raise ValueError(f"Retained classified CSV repeats OBJECTID {object_id}")
        retained_ids.add(object_id)
        huc12 = _huc12(_field(row, "HUC_12", "publisher_huc12"), "classified publisher HUC12")
        if huc12 not in domain:
            raise ValueError(f"Classified publisher HUC12 lies outside the original domain: {huc12}")
        code = _text(_field(row, "H2OCLASS", "class_code")).upper()
        if code not in TARGET_CLASSES:
            raise ValueError(f"Retained CSV has a class outside the selected class query: {code}")
        class_counts[code] += 1
        huc_class_counts[(huc12, code)] += 1
        publisher_hucs.add(huc12)
    if native_ids != retained_ids:
        missing = len(native_ids - retained_ids)
        extra = len(retained_ids - native_ids)
        raise ValueError(f"Retained classified OBJECTIDs differ from the full query: missing={missing}, extra={extra}")
    inventory = context.get("classified_source_inventory") or {}
    comparison = coverage.get("comparison") or {}
    membership = coverage.get("full_domain_id_response") or {}
    _expect_count(inventory, "feature_count", len(rows), "context.classified_source_inventory")
    _expect_count(inventory, "unique_source_hucs", len(publisher_hucs), "context.classified_source_inventory")
    _expect_count(membership, "count", len(ids), "coverage.full_domain_id_response")
    _expect_count(membership, "unique_ids", len(native_ids), "coverage.full_domain_id_response")
    _expect_count(coverage.get("captured_geometry") or {}, "features", len(rows), "coverage.captured_geometry")
    _expect_count(comparison, "publisher_huc12_count", len(publisher_hucs), "coverage.comparison")
    if dict(class_counts) != _class_totals(inventory.get("class_counts") or {}, "context class_counts"):
        raise ValueError("Retained classified CSV class counts differ from the source context")
    if dict(class_counts) != _class_totals(comparison.get("class_counts") or {}, "coverage class_counts"):
        raise ValueError("Retained classified CSV class counts differ from the coverage companion")
    expected_pairs: Counter = Counter()
    for item in inventory.get("source_huc_class_counts", []):
        pair = (_huc12(item.get("publisher_huc12"), "inventory publisher HUC12"),
                _text(item.get("class_code")).upper())
        if pair in expected_pairs:
            raise ValueError(f"Duplicate publisher HUC/class inventory pair: {pair}")
        expected_pairs[pair] = _integer(item.get("feature_count"), "inventory feature_count")
    if huc_class_counts != expected_pairs:
        raise ValueError("Retained CSV publisher HUC/class counts differ from the source context")
    if comparison.get("same_complete_object_id_set") is not True:
        raise ValueError("Coverage companion does not report a complete matching object-ID set")
    if comparison.get("all_publisher_hucs_in_selected_domain") is not True:
        raise ValueError("Coverage companion does not bind publisher HUCs to the selected domain")
    if comparison.get("added_ids") != [] or comparison.get("retained_ids_outside_exact_selection") != []:
        raise ValueError("Coverage comparison contains unresolved ID-set differences")
    where = parse_qs(urlsplit(membership.get("request_url", "")).query).get("where", [""])[0]
    huc_clause = re.search(r"\bHUC_12\s+IN\s*\((.*?)\)", where, re.I | re.S)
    class_clause = re.search(r"\bH2OCLASS\s+IN\s*\((.*?)\)", where, re.I | re.S)
    query_hucs = re.findall(r"'(\d{12})'", huc_clause.group(1)) if huc_clause else []
    query_classes = re.findall(r"'([^']+)'", class_clause.group(1)) if class_clause else []
    if len(query_hucs) != len(domain) or set(query_hucs) != domain:
        raise ValueError("Original classified query does not select the exact original HUC12 domain")
    if set(query_classes) != TARGET_CLASSES:
        raise ValueError("Original classified query does not select the five expected water classes")
    if _integer(zero_response.get("count"), "additional HUC8 count") != 0:
        raise ValueError("Additional HUC8 response contains selected classified features")
    additional = coverage.get("additional_huc8_response") or {}
    _expect_count(additional, "count", 0, "coverage.additional_huc8_response")
    zero_huc8s = set(additional.get("huc8") or [])
    if zero_huc8s != {"03060104", "03060105", "03060106", "03060107"}:
        raise ValueError("Additional HUC8 response does not cover the retained four-region query")
    if any(huc12[:8] in zero_huc8s for huc12 in publisher_hucs):
        raise ValueError("Retained classifications contradict the additional HUC8 zero-count response")
    return {"classification_object_ids": len(native_ids),
            "retained_classified_ids_matched": True,
            "retained_classified_id_count": len(retained_ids)}



def _check_native_network(network: Any, domain: set[str], *, source_reference: Any = None) -> dict:
    """Preserve original native attributes while checking domain/role assignments."""
    if not isinstance(network, Mapping):
        raise ValueError(f"{NETWORK_NAME} must contain a native network object")
    rows = network.get("rows", network.get("hucs", network.get("features")))
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"{NETWORK_NAME} must contain native HUC12/ToHUC records")
    native_hucs: set[str] = set()
    roles: Counter = Counter()
    for item in rows:
        if not isinstance(item, Mapping):
            raise ValueError(f"{NETWORK_NAME} has a non-object native record")
        row = item.get("attributes", item.get("properties", item))
        if not isinstance(row, Mapping):
            raise ValueError(f"{NETWORK_NAME} has invalid native attributes")
        huc12 = _huc12(_field(row, "huc12", "huc12_code", "HUC_12"), "native network HUC12")
        if huc12 in native_hucs:
            raise ValueError(f"{NETWORK_NAME} repeats native HUC12 {huc12}")
        native_hucs.add(huc12)
        raw_to_huc = _field(row, "ToHUC", "to_huc12", "downstream_huc12")
        to_huc = _text(raw_to_huc)
        if to_huc.upper() not in {
            "", "NULL", "NONE", "UNKNOWN", "0", "000000000000",
            "OCEAN", "CLOSED BASIN", "CLOSED_BASIN",
        }:
            _huc12(to_huc, f"native ToHUC for {huc12}")
        if huc12 in domain:
            role = row.get("role", "model_domain")
            if role not in {"reporting", "upstream", "model_domain"}:
                raise ValueError(f"Unsupported explicit domain role for {huc12}: {role}")
            roles[role] += 1
    missing = domain - native_hucs
    if missing:
        raise ValueError(f"{NETWORK_NAME} is missing {len(missing)} original model-domain HUC12s")
    declared_domain = network.get("model_domain_huc12s")
    if declared_domain is not None and set(_domain_ids(declared_domain)) != domain:
        raise ValueError(f"{NETWORK_NAME} declares a different model domain")
    if not network.get("source_reference") and not source_reference:
        raise ValueError(f"{NETWORK_NAME} needs its embedded source reference or a bound {NETWORK_SOURCE_NAME}")
    for key, actual in (("native_record_count", len(native_hucs)),
                        ("model_domain_huc_count", len(domain))):
        if key in network:
            _expect_count(network, key, actual, NETWORK_NAME)
    declared_roles = network.get("role_counts")
    if declared_roles is not None:
        if not isinstance(declared_roles, Mapping):
            raise ValueError(f"{NETWORK_NAME}.role_counts must contain counts by source role")
        normalized_roles = {str(role): _integer(count, f"native role {role}")
                            for role, count in declared_roles.items() if count != 0}
        if normalized_roles != {role: count for role, count in roles.items() if count}:
            raise ValueError(f"{NETWORK_NAME} saved role counts differ from native records")
    return {
        "native_network_records": len(native_hucs),
        "native_network_domain_records": len(native_hucs & domain),
        "native_network_reporting_hucs": roles["reporting"],
        "native_network_upstream_hucs": roles["upstream"],
        "native_network_unassigned_domain_hucs": roles["model_domain"],
    }


def _native_source_reference(reader: _SourceReader, network: Mapping, name: str) -> tuple[Any, dict]:
    """Bind separate provenance to unchanged publisher network bytes."""
    embedded = network.get("source_reference")
    companion_path = reader.directory / NETWORK_SOURCE_NAME
    if not companion_path.is_file():
        return embedded, {}
    provenance = reader.json(NETWORK_SOURCE_NAME)
    if not isinstance(provenance, Mapping) or provenance.get("schema") != "upstate.native-network-source/v1":
        raise ValueError(f"{NETWORK_SOURCE_NAME} must use upstate.native-network-source/v1")
    if provenance.get("source_member") != name:
        raise ValueError(f"{NETWORK_SOURCE_NAME}.source_member must identify {name}")
    uri = provenance.get("source_uri")
    if not isinstance(uri, str) or not uri.strip():
        raise ValueError(f"{NETWORK_SOURCE_NAME} must retain the original source_uri")
    reader.bind_hash(name, provenance.get("body_sha256"),
                     f"{NETWORK_SOURCE_NAME}.body_sha256")
    if _integer(provenance.get("body_bytes"), f"{NETWORK_SOURCE_NAME}.body_bytes") != reader.descriptor(name)["bytes"]:
        raise ValueError(f"{NETWORK_SOURCE_NAME} source byte length disagrees with {name}")
    checks = {
        "native_network_source_member": name,
        "native_network_source_uri": uri,
        "native_network_source_sha256": reader.descriptor(name)["sha256"],
        "native_network_provenance_sha256": reader.descriptor(NETWORK_SOURCE_NAME)["sha256"],
    }
    return embedded or provenance, checks


def _manifest_network_source_reference(
        reader: _SourceReader, name: str, source_manifest: str | Path | None = None,
) -> tuple[Mapping, dict | None]:
    """Bind provenance without adding fields to the original publisher response."""
    # The maintained regional edition keeps publisher provenance on its source
    # entry. Its original ESRI JSON deliberately retains only publisher fields.
    if source_manifest is not None:
        candidates = [Path(source_manifest).expanduser().resolve(strict=True)]
    else:
        candidates = [
            reader.directory / NATIVE_MANIFEST_NAME,
            reader.directory / MANIFEST_NAME,
            reader.directory / "sources.json",
            reader.directory.parent / f"sources-{reader.directory.name}.json",
        ]
    context_path = (reader.directory / CONTEXT_NAME).resolve()
    network_path = (reader.directory / name).resolve()
    bound = []
    for manifest_path in dict.fromkeys(candidates):
        if not manifest_path.is_file():
            continue
        payload = manifest_path.read_bytes()
        try:
            manifest = json.loads(payload.decode("utf-8-sig"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"Native source manifest is not valid JSON: {manifest_path}") from exc
        if not isinstance(manifest, Mapping) or manifest.get("schema") != "upstate.sources/v1":
            raise ValueError(f"Native source manifest must use upstate.sources/v1: {manifest_path}")
        entries = manifest.get("entries")
        if not isinstance(entries, list):
            raise ValueError(f"Native source manifest must list entries: {manifest_path}")

        def resolved_member(value: Any) -> Path:
            if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
                raise ValueError("Native source manifest paths must be portable relative names")
            relative = Path(value)
            if relative.is_absolute() or ".." in relative.parts or relative.as_posix() != value:
                raise ValueError("Native source manifest paths must stay inside its edition")
            resolved = (manifest_path.parent / relative).resolve()
            if not resolved.is_relative_to(manifest_path.parent.resolve()):
                raise ValueError("Native source manifest member escapes its edition")
            return resolved

        matching_entries = 0
        for entry in entries:
            if not isinstance(entry, Mapping) or entry.get("role") != "SOURCE_WATER_CONTEXT":
                continue
            if resolved_member(entry.get("path")) != context_path:
                continue
            companions = entry.get("companions", [])
            if not isinstance(companions, list):
                raise ValueError("Native source context companions must be a list")
            matches = [item for item in companions
                       if isinstance(item, Mapping)
                       and resolved_member(item.get("path")) == network_path]
            if not matches:
                continue
            if len(matches) != 1:
                raise ValueError("Native source context must retain the network exactly once")
            matching_entries += 1
            if matching_entries > 1:
                raise ValueError("Native source manifest has ambiguous matching context entries")
            if not isinstance(entry.get("id"), str) or not entry["id"]:
                raise ValueError("Native source manifest context needs a stable source ID")
            reader.bind_hash(CONTEXT_NAME, entry.get("sha256"), "native source context.sha256")
            companion = matches[0]
            reader.bind_hash(name, companion.get("sha256"), "native source companion.sha256")
            if "bytes" in companion and (
                    _integer(companion["bytes"], "native source companion.bytes")
                    != reader.descriptor(name)["bytes"]):
                raise ValueError("Native source companion byte length differs")
            reference = entry.get("native_network_reference")
            if not isinstance(reference, Mapping) or not reference:
                if source_manifest is not None:
                    raise ValueError("Native source entry must retain native_network_reference")
                continue
            if not isinstance(reference.get("uri"), str) or not reference["uri"].strip():
                raise ValueError("Native source reference must retain its original publisher URI")
            reader.bind_hash(name, reference.get("sha256"), "native_network_reference.sha256")
            bound.append((reference, {
                "path": str(manifest_path), "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "source_id": entry.get("id"),
                "reference_location": "native_network_reference",
            }))
    if bound:
        identities = {
            (record["source_id"], json.dumps(reference, sort_keys=True, ensure_ascii=False))
            for reference, record in bound
        }
        if len(identities) != 1:
            raise ValueError("Retained source manifests give ambiguous native network provenance")
        return bound[0]
    raise ValueError(
        f"{name} requires an embedded source_reference, a bound origin companion, or a matching retained "
        "source manifest with native_network_reference; supply --source-manifest if needed"
    )


def load_source_edition(
        directory: str | Path = DEFAULT_SOURCE_DIR, *,
        classified_reaches_csv: str | Path | None = None,
        native_network_name: str | None = None,
        source_manifest: str | Path | None = None,
) -> dict:
    """Read original source bytes, bind the complete edition, and preserve its values."""
    reader = _SourceReader(directory)
    context = reader.json(CONTEXT_NAME)
    coverage = reader.json(COVERAGE_NAME)
    if not isinstance(context, Mapping) or context.get("schema") != "upstate.water-context/v1":
        raise ValueError(f"{CONTEXT_NAME} must use upstate.water-context/v1")
    if not isinstance(coverage, Mapping) or coverage.get("schema") != "upstate.classification-source-coverage/v1":
        raise ValueError(f"{COVERAGE_NAME} must use upstate.classification-source-coverage/v1")
    domain = _domain_ids(reader.json(DOMAIN_NAME))
    domain_set = set(domain)
    source_domain = context.get("source_reference", {}).get("domain", {})
    coverage_domain = coverage.get("model_domain") or {}
    reader.bind_hash(DOMAIN_NAME, source_domain.get("selected_huc12_sha256"),
                     "source_context.source_reference.domain.selected_huc12_sha256")
    reader.bind_hash(DOMAIN_NAME, coverage_domain.get("huc12_sha256"),
                     "coverage.model_domain.huc12_sha256")
    context_domain = [_huc12(value, "context model_domain_huc12s")
                      for value in context.get("model_domain_huc12s", [])]
    if len(context_domain) != len(domain) or set(context_domain) != domain_set:
        raise ValueError("Source context domain does not equal the original HUC12 file")
    _expect_count(context, "model_domain_huc_count", len(domain), "source_context")
    _expect_count(coverage_domain, "huc12_count", len(domain), "coverage.model_domain")
    nrcs_rows = reader.csv(NRCS_NAME)
    reader.bind_hash(NRCS_NAME, (coverage.get("nrcs_context") or {}).get("csv_sha256"),
                     "coverage.nrcs_context.csv_sha256")
    nrcs_validation = _check_nrcs(context, coverage, nrcs_rows, domain_set)
    id_response = reader.json(IDS_NAME)
    zero_response = reader.json(ZERO_NAME)
    reader.bind_response(IDS_NAME, coverage.get("full_domain_id_response") or {},
                         "coverage.full_domain_id_response")
    reader.bind_response(ZERO_NAME, coverage.get("additional_huc8_response") or {},
                         "coverage.additional_huc8_response")
    classified_rows = reader.csv(CLASSIFIED_NAME, classified_reaches_csv)
    reader.bind_hash(CLASSIFIED_NAME,
                     (coverage.get("captured_geometry") or {}).get("attribute_csv_sha256"),
                     "coverage.captured_geometry.attribute_csv_sha256", classified_reaches_csv)
    classified_validation = _check_classifications(
        context, coverage, id_response, zero_response, classified_rows, domain_set)
    native_network = None
    network_validation = {}
    network_reference = None
    network_manifest = None
    candidates = [name for name in (NETWORK_NAME, NETWORK_NAME + ".gz")
                  if (reader.directory / name).is_file()]
    if native_network_name is None:
        if len(candidates) > 1:
            raise ValueError("Choose the exact native_network_name when both original network encodings are retained")
        native_network_name = candidates[0] if candidates else None
    if native_network_name is not None:
        relative = Path(native_network_name)
        if relative.is_absolute() or ".." in relative.parts or "\\" in native_network_name:
            raise ValueError("Native network member must stay inside its edition")
        resolved = (reader.directory / relative).resolve()
        if not resolved.is_relative_to(reader.directory):
            raise ValueError("Native network member must stay inside its edition")
        native_network = reader.json(native_network_name)
        if not isinstance(native_network, Mapping):
            raise ValueError("Original native network must contain a native feature or row object")
        references, source_checks = _native_source_reference(reader, native_network, native_network_name)
        manifest_reference = None
        if source_manifest is not None or not references:
            manifest_reference, network_manifest = _manifest_network_source_reference(
                reader, native_network_name, source_manifest)
        if references is not None and (not isinstance(references, Mapping) or not references):
            raise ValueError("Native network source reference must be a nonempty object")
        if references and manifest_reference:
            source_uri = references.get("source_uri", references.get("uri"))
            if source_uri and source_uri != manifest_reference["uri"]:
                raise ValueError("Native origin companion and selected manifest give different publisher URIs")
        effective_reference = manifest_reference or references
        # Preserve source-manifest or embedded reference shape. The standalone
        # origin companion remains its own checked file, not a rewritten entry.
        network_reference = (dict(manifest_reference or native_network.get("source_reference"))
                             if manifest_reference or native_network.get("source_reference") else None)
        network_validation = _check_native_network(
            native_network, domain_set, source_reference=effective_reference)
        network_validation.update(source_checks)
        for reference in (references, manifest_reference):
            if not reference:
                continue
            for key, actual in (
                    ("native_huc_rows", network_validation["native_network_records"]),
                    ("selected_domain_huc_rows", network_validation["native_network_domain_records"]),
                    ("selected_domain_huc_rows_missing", 0)):
                if key in reference:
                    _expect_count(reference, key, actual, "native network source reference")
        network_validation["native_network_reference_location"] = (
            "source_manifest" if network_manifest else
            "origin_companion" if source_checks else "embedded"
        )
        references = references or manifest_reference or {}
        originals = references.get("originals", {}) if isinstance(references, Mapping) else {}
        if not isinstance(originals, Mapping):
            raise ValueError(f"{NETWORK_NAME} original references must be keyed records")
        for label, reference in originals.items():
            if not isinstance(reference, Mapping) or not reference.get("path"):
                raise ValueError(f"Native original reference {label} has no edition path")
            relative = Path(reference["path"])
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError(f"Native original reference {label} must stay inside the source edition")
            name = relative.as_posix()
            reader.bind_hash(name, reference.get("sha256"), f"native source {label}.sha256")
            if _integer(reference.get("bytes"), f"native source {label}.bytes") != reader.descriptor(name)["bytes"]:
                raise ValueError(f"Native original reference {label} has a different byte length")
    for name in OPTIONAL_NAMES:
        if (reader.directory / name).is_file():
            reader.read(name)
    manifest_name = (NATIVE_MANIFEST_NAME if native_network is not None
                     and (reader.directory / NATIVE_MANIFEST_NAME).is_file() else MANIFEST_NAME)
    manifest_path = reader.directory / manifest_name
    if manifest_path.is_file():
        manifest = reader.json(manifest_name)
        if not isinstance(manifest, Mapping):
            raise ValueError(f"{manifest_name} must contain a source manifest object")
        manifest_value: str | None = str(manifest_path)
    else:
        manifest_value = None
    if network_manifest is not None:
        manifest_value = network_manifest["path"]
    elif source_manifest is not None:
        selected = Path(source_manifest).expanduser().resolve(strict=True)
        if not selected.is_file():
            raise ValueError("Choose a retained source manifest file")
        manifest_value = str(selected)
    return {
        "source_context": context,
        "classification_coverage": coverage,
        "native_network": native_network,
        "native_network_source_reference": network_reference,
        "native_network_source_manifest": network_manifest,
        "source_files": [item for item in reader.files()
                         if item["name"] not in (MANIFEST_NAME, NATIVE_MANIFEST_NAME)],
        "manifest_path": manifest_value,
        "validation": {"domain_hucs": len(domain), **nrcs_validation, **classified_validation,
                       **network_validation},
    }


def import_source_edition(
        workspace: Any, directory: str | Path = DEFAULT_SOURCE_DIR, *,
        classified_reaches_csv: str | Path | None = None,
        source_manifest: str | Path | None = None,
        native_network_name: str | None = None,
) -> dict:
    """Register the complete manifest in an existing workspace after source binding."""
    edition = load_source_edition(directory, classified_reaches_csv=classified_reaches_csv,
                                  source_manifest=source_manifest,
                                  native_network_name=native_network_name)
    if edition["manifest_path"] is None:
        raise FileNotFoundError(f"Import requires {Path(directory) / MANIFEST_NAME}")
    if not callable(getattr(workspace, "import_sources", None)):
        raise TypeError("workspace must provide Workspace.import_sources")
    from source_tools.prepare_watershed_context import _validate_import_manifest
    _validate_import_manifest(Path(directory).expanduser().resolve(strict=True), edition)
    collection = workspace.import_sources(Path(edition["manifest_path"]))
    return {"collection": collection, **edition}


def main(argv: list[str] | None = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--classified-reaches-csv", type=Path)
    parser.add_argument("--source-manifest", type=Path)
    parser.add_argument("--native-network-name", choices=(NETWORK_NAME, NETWORK_NAME + ".gz"))
    parser.add_argument("--workspace", type=Path)
    args = parser.parse_args(argv)
    if args.workspace is None:
        result = load_source_edition(args.source_dir,
                                     classified_reaches_csv=args.classified_reaches_csv,
                                     source_manifest=args.source_manifest,
                                     native_network_name=args.native_network_name)
        output = result["validation"]
    else:
        workspace_path = args.workspace.expanduser().resolve()
        marker = workspace_path / "workspace.json"
        if not workspace_path.is_dir() or not marker.is_file():
            raise FileNotFoundError(f"Existing scientific workspace required: {workspace_path}")
        config = json.loads(marker.read_text(encoding="utf-8"))
        if config.get("schema") != "upstate.scientific-workbench/v1":
            raise ValueError(f"Unsupported existing workspace schema in {marker}")
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from model.workspace import Workspace
        result = import_source_edition(
            Workspace(workspace_path), args.source_dir,
            classified_reaches_csv=args.classified_reaches_csv,
            source_manifest=args.source_manifest,
            native_network_name=args.native_network_name)
        collection = result["collection"]
        output = {"collection_id": collection.get("id") if isinstance(collection, Mapping) else collection,
                  "validation": result["validation"]}
    print(json.dumps(output, ensure_ascii=False, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

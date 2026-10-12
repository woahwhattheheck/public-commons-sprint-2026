"""Exact retained-edition contracts for the original Datasette -> NLD workflow.

This module has no network, NLD import, database writer or credential reader.
The original Datasette Analysis version is the input authority; NLD owns flow
execution and its incremental state. Numeric source spellings stay text.
"""
from __future__ import annotations

from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import zipfile

SCHEMA = "stellar-forge.datasette-nld.v1"
PROJECTION_SCHEMA = SCHEMA + "/projection"
SPEC_SCHEMA = SCHEMA + "/specification"
PROJECT_SCHEMA = SCHEMA + "/project"
RUN_SCHEMA = SCHEMA + "/run"
NLD_COMMIT = "15db818176ce0c2ed825b2be4bb1714273b14f85"
NLD_VERSION = "0.1.2a5"
NLD_REQUIRED_SOURCES = [{"path":"flow/sql/sql_flow_task.py","bytes":18411,"sha256":"48e4057a853d134968089573194007f060c70fd9948fc541005ae5b02c540b5a"},{"path":"flow/task/data_flow_executor.py","bytes":18511,"sha256":"df33153316e17ebf72bfa76f4b2dac8390f25e02b620c939cbfb93e1dae1cd05"},{"path":"flow/task/data_flow_exec_task.py","bytes":13488,"sha256":"c73a208b84bf07232e255f6ce7f47e0a29c68603b2ff484e48b13637d255feca"},{"path":"flow/task/data_flow_task.py","bytes":38039,"sha256":"c65fc21448ac48909e599a01c20de3d62fd0f1a937736c207ecc9f7912b4711d"},{"path":"flow/definition/flow_definition.py","bytes":31681,"sha256":"02a11823648b54dcbb57016356b4f69a14e4e3aad6fb19f83fb57283e8e701c9"},{"path":"flow/incremental/impl/by_key/logic.py","bytes":5559,"sha256":"052e78b14ef846686a45b41f3d9ed16423c04b9140af3b2922deb36104042ec0"},{"path":"flow/incremental/impl/by_key/manager.py","bytes":14755,"sha256":"dae3fdcf621f4f6d277d8da6c212cad94e17a441d2040be7e44930b46fb5b2fd"},{"path":"flow/incremental/impl/by_key/state.py","bytes":11505,"sha256":"809bc50d34b54d6be155219bc654fe4fa23edefd4e70ed741aa6bed8b1b94979"},{"path":"flow/incremental/impl/by_key/sql_filter_manager.py","bytes":2989,"sha256":"04b46022817ed4cd68fd6b684a51704837c140999d0178c492d42d4ccfe92426"},{"path":"flow/incremental/impl/by_key/backend/local_with_pydantic.py","bytes":7867,"sha256":"d9f3232fefb12462a0e810c46985b46744b568f6e381dd32eb9f8052176cc38a"},{"path":"flow/execution/backend/local_with_pydantic.py","bytes":5153,"sha256":"3bfe90e6f4d2c1128b09fd724f4df00ffc10a76b5289d7cf2a1a434c7e74e9eb"},{"path":"flow/state/manager/base.py","bytes":10613,"sha256":"a4351678f60dbc6cd7df2a3a9efa4750067d1f580f9d975a9397209961b1ca6b"},{"path":"task/context/context.py","bytes":11245,"sha256":"474ed946d826ac6ccca3c7fa6e8303af02e41c32d9379b1054d43143d7e009e7"},{"path":"task/context/request.py","bytes":4543,"sha256":"c929fa1562d71b3e3889849851bf465d5a2aad46ba0fb880ed580993a8b83c21"},{"path":"connector/sqlite/sqlglot/dml.py","bytes":512,"sha256":"5668b67dec6d751841c0e0dd1096e7d9b812495f0fa4a02d3a3af921001a9fd1"},{"path":"connector/sqlite/sqlite_credential.py","bytes":570,"sha256":"420b7e4437216f5b06c79fbda11dcee23ee216aaaf43bc544d2b1cb916ed5cd2"}]
MAX_JSON = 64 * 1024 * 1024
MAX_MEMBER = 512 * 1024 * 1024
ID = re.compile(r"[a-f0-9]{32}\Z")
HASH = re.compile(r"[a-f0-9]{64}\Z")
NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,47}\Z")
DECIMAL = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\Z")
META = ["_sf_business_key", "_sf_source_key", "_sf_source_edition",
        "_sf_analysis_version", "_sf_original_row", "_sf_types",
        "_sf_presence", "_sf_original_values"]
MEANING = {
    "input": "One complete selected original Datasette Analysis plants version, with its retained publisher edition and original response closure.",
    "target": "SQLite reference target operated by the original pinned NLD SQLFlowTask and reviewed Structure.",
    "business_key": "SHA256 of the explicitly reviewed ordered source keys and their source kinds/canonical values; never the local row locator.",
    "processing_key": "SHA256 of mapping meaning, business key, exact selected values, source kinds and presence. Changed values become new native by_key inventory keys.",
    "numeric_storage": "Exact source numeric lexemes remain TEXT with their original kind; no SQLite REAL conversion or inferred units.",
    "incremental": "Native NLD by_key outcomes and original execution history are authoritative. FULL/backfill re-attempt explicitly; DELTA skips terminal content keys.",
    "deletion": "An absent selected row never deletes or flags an existing target row. Retained target rows outside the current selection are counted separately.",
    "time": "Source years and capture time keep their original meanings. No source update timestamp or time watermark is invented.",
    "empty_selection": "An empty native processing-key selection performs no target SQL write; it does not execute the upstream unfiltered fallback.",
    "execution": "A durable dispatch without a returned terminal receipt is uncertain. Reopen reads the same native UID and files; it never automatically re-executes that UID.",
    "portable": "Complete original Analysis archive plus exact NLD project, target SQLite backup, native state/history and run files; credentials are not accepted in this local reference configuration.",
}

class NldError(ValueError):
    def __init__(self, code, detail=""):
        self.code, self.detail = code, detail
        super().__init__(code + (": " + detail if detail else ""))

def need(value, code, detail=""):
    if not value:
        raise NldError(code, detail)

def now():
    return datetime.now(timezone.utc).isoformat()

def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def identity(value):
    return sha(encoded(value))

def parse(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, "NLD_DUPLICATE_JSON_KEY", key)
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda x: (_ for _ in ()).throw(NldError("NLD_NONFINITE_JSON", x)))

def identifier(value, *, full=False):
    need(isinstance(value, str) and (HASH if full else ID).fullmatch(value),
         "NLD_IDENTIFIER_INVALID")
    return value

def name(value):
    need(isinstance(value, str) and NAME.fullmatch(value), "NLD_NAME_INVALID", str(value))
    return value

def quote(value):
    need(isinstance(value, str) and value and "\0" not in value, "NLD_SQL_IDENTIFIER")
    return '"' + value.replace('"', '""') + '"'

def relative(value):
    need(isinstance(value, str) and value and "\\" not in value and "\0" not in value,
         "NLD_MEMBER_PATH")
    p = Path(value)
    need(not p.is_absolute() and all(x not in ("", ".", "..") for x in value.split("/")),
         "NLD_MEMBER_PATH", value)
    return value

def private_directory(path):
    path = Path(path).expanduser().absolute()
    for parent in [*reversed(path.parents), path]:
        need(not parent.is_symlink(), "NLD_DIRECTORY_SYMLINK", str(parent))
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    need(path.is_dir(), "NLD_DIRECTORY_REQUIRED")
    return path

def sync(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

@contextmanager
def held(path, *, maximum=MAX_MEMBER):
    path = Path(path).absolute()
    for parent in path.parents:
        need(not parent.is_symlink(), "NLD_SOURCE_SYMLINK", str(parent))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= maximum, "NLD_FILE_CAPACITY_OR_TYPE", str(path))
        with os.fdopen(fd, "rb", closefd=False) as stream:
            yield stream, before
        after = os.fstat(fd)
        current = path.stat(follow_symlinks=False)
        signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        need(signature(before) == signature(after) == signature(current), "NLD_FILE_CHANGED", str(path))
    finally:
        os.close(fd)

def read(path, *, maximum=MAX_JSON):
    with held(path, maximum=maximum) as (stream, before):
        raw = stream.read(maximum + 1)
        need(len(raw) == before.st_size and len(raw) <= maximum, "NLD_FILE_CHANGED")
        return raw

def file_identity(path, *, relative_to=None):
    digest, count = hashlib.sha256(), 0
    with held(path) as (stream, before):
        while chunk := stream.read(65536):
            digest.update(chunk)
            count += len(chunk)
        need(count == before.st_size, "NLD_FILE_CHANGED")
    return {"path": Path(path).relative_to(relative_to).as_posix() if relative_to else Path(path).name,
            "bytes": count, "sha256": digest.hexdigest()}

def check_file(root, record):
    path = Path(root) / relative(record["path"])
    actual = file_identity(path, relative_to=root)
    need(all(actual[k] == record[k] for k in ("path", "bytes", "sha256")), "NLD_MEMBER_CHANGED", record["path"])
    return path

def publish(path, raw):
    """Create-only publication; a failed write prefix remains for diagnosis."""
    path = Path(path)
    private_directory(path.parent)
    if path.exists():
        need(read(path, maximum=max(MAX_JSON, len(raw))) == raw, "NLD_PUBLISHED_FILE_CHANGED", str(path))
        return file_identity(path)
    fd, prefix = tempfile.mkstemp(prefix=".nld-pending-", dir=path.parent)
    complete = False
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(prefix, path, follow_symlinks=False)
        except FileExistsError:
            need(read(path, maximum=max(MAX_JSON, len(raw))) == raw, "NLD_PUBLISHED_FILE_CHANGED", str(path))
        sync(path.parent)
        complete = True
        return file_identity(path)
    finally:
        if complete:
            Path(prefix).unlink(missing_ok=True)
            sync(path.parent)

def publish_json(path, value):
    return publish(path, encoded(value))

def load(path):
    return parse(read(path))

def exact_decimal(value):
    need(isinstance(value, str) and len(value) <= 10000 and DECIMAL.fullmatch(value),
         "NLD_DECIMAL_LEXEME_REQUIRED")
    try:
        number = Decimal(value)
    except InvalidOperation as error:
        raise NldError("NLD_DECIMAL_INVALID") from error
    need(number.is_finite() and abs(number.as_tuple().exponent) <= 4096
         and (not number or abs(number.adjusted()) <= 4096), "NLD_DECIMAL_RANGE")
    return number

def decimal_text(value):
    if not value:
        return "0"
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text

def exact_sum(values):
    if not values:
        return None
    low = min(v.as_tuple().exponent for v in values)
    high = max(v.adjusted() for v in values)
    with localcontext() as context:
        context.prec = max(1, high - low + 1) + len(str(len(values))) + 2
        return decimal_text(sum(values, Decimal(0)))

def hints(row, source):
    value = row.get(source.get("type_column", "_datasette_types"))
    if isinstance(value, str):
        value = parse(value)
    if value is None:
        return {}
    need(isinstance(value, dict), "NLD_SOURCE_KIND_MAP_REQUIRED")
    mapping = source.get("type_mapping", source.get("column_mapping", {}))
    aliases = {"int": "integer", "real": "number", "float": "number",
               "str": "text", "string": "text", "bool": "boolean", "none": "null"}
    return {mapping.get(k, k): aliases.get(str(v).lower(), str(v).lower()) for k, v in value.items()}

def cell(row, field, kind_map):
    if field not in row or kind_map.get(field) == "absent":
        return {"presence": "absent", "kind": "absent", "text": None}
    value = row[field]
    if value is None:
        return {"presence": "null", "kind": "null", "text": None}
    kind = kind_map.get(field)
    if kind is None:
        kind = ("boolean" if type(value) is bool else "integer" if type(value) is int
                else "number" if type(value) is float else "text" if isinstance(value, str)
                else "object" if isinstance(value, dict) else "array" if isinstance(value, list) else "unsupported")
    need(type(value) is not float, "NLD_ORIGINAL_NUMERIC_LEXEME_REQUIRED", field)
    if kind in ("integer", "number"):
        text = str(value)
        number = exact_decimal(text)
        if kind == "integer":
            need(number == number.to_integral_value(), "NLD_INTEGER_KIND_MISMATCH", field)
    elif kind == "boolean":
        text = "true" if value is True else "false" if value is False else value
        need(text in ("true", "false"), "NLD_BOOLEAN_KIND_MISMATCH", field)
    elif kind in ("array", "object"):
        if isinstance(value, str):
            decoded = parse(value)
            need(isinstance(decoded, list if kind == "array" else dict), "NLD_STRUCTURE_KIND_MISMATCH", field)
            text = value
        else:
            need(isinstance(value, list if kind == "array" else dict), "NLD_STRUCTURE_KIND_MISMATCH", field)
            text = encoded(value).decode().rstrip("\n")
    else:
        need(kind == "text" and isinstance(value, str), "NLD_SOURCE_KIND_UNSUPPORTED", field)
        text = value
    return {"presence": "blank" if kind == "text" and not text.strip() else "present",
            "kind": kind, "text": text}

def specification(value, columns, source):
    need(isinstance(value, dict) and value.get("schema") == SPEC_SCHEMA, "NLD_SPECIFICATION_REQUIRED")
    allowed = {"schema", "name", "title", "namespace", "keys", "mapping", "reviewer", "note", "measures"}
    need(not set(value) - allowed, "NLD_SPECIFICATION_FIELDS", ", ".join(sorted(set(value) - allowed)))
    spec = dict(value)
    spec["name"] = name(spec.get("name"))
    need(spec["name"].casefold() != "retained_input", "NLD_TARGET_RESERVED", "Choose a target name distinct from the internal retained_input staging table.")
    spec["namespace"] = name(spec.get("namespace", "datasette"))
    for field in ("title", "reviewer", "note"):
        need(isinstance(spec.get(field), str) and 0 < len(spec[field].strip()) <= (4000 if field == "note" else 200),
             "NLD_REVIEW_REQUIRED", field)
    keys = spec.get("keys")
    need(isinstance(keys, list) and 0 < len(keys) <= 8 and len(keys) == len(set(keys))
         and all(k in columns for k in keys), "NLD_REVIEWED_KEYS_REQUIRED")
    locators = {"rowid", "_rowid_", "oid"} | set(source.get("local_locator_aliases", []))
    mapping = source.get("column_mapping", {})
    locators |= {alias for original, alias in mapping.items() if original.lower() in locators}
    need(not locators.intersection(keys), "NLD_LOCAL_LOCATOR_NOT_BUSINESS_KEY")
    bindings = spec.get("mapping")
    need(isinstance(bindings, list) and 0 < len(bindings) <= 128, "NLD_MAPPING_REQUIRED")
    targets, origins = [], []
    normalized = []
    for binding in bindings:
        need(isinstance(binding, dict) and not set(binding) - {"source", "target", "description", "unit", "time_basis"},
             "NLD_MAPPING_FIELDS")
        source_name, target = binding.get("source"), name(binding.get("target"))
        need(source_name in columns and target not in META, "NLD_MAPPING_COLUMN", str(source_name))
        need(target.casefold() not in [x.casefold() for x in targets], "NLD_MAPPING_DUPLICATE_TARGET")
        targets.append(target)
        origins.append(source_name)
        for k in ("description", "unit", "time_basis"):
            if k in binding:
                need(binding[k] is None or isinstance(binding[k], str), "NLD_MAPPING_CONTEXT", k)
        normalized.append(dict(binding))
    need(len(origins) == len(set(origins)) and set(keys).issubset(origins), "NLD_MAPPING_KEYS_OR_DUPLICATES")
    spec["mapping"] = normalized
    measures = spec.get("measures", [])
    need(isinstance(measures, list) and len(measures) <= 32, "NLD_MEASURES_INVALID")
    for measure in measures:
        need(isinstance(measure, dict) and set(measure).issubset({"target", "unit", "time_basis", "nonnegative", "note"})
             and measure.get("target") in targets and isinstance(measure.get("unit"), str)
             and isinstance(measure.get("time_basis"), str) and isinstance(measure.get("note"), str),
             "NLD_MEASURE_MEANING_REQUIRED")
        need(type(measure.get("nonnegative", False)) is bool, "NLD_MEASURE_NONNEGATIVE_INVALID")
    need(len({m["target"] for m in measures}) == len(measures), "NLD_MEASURE_DUPLICATE")
    spec["measures"] = measures
    return spec

def project_rows(edition, version, columns, rows, requested):
    need(edition.get("status") == "COMPLETE" and edition.get("version_id") == version.get("version_id"),
         "NLD_COMPLETE_ORIGINAL_VERSION_REQUIRED")
    need(len(rows) == version["row_count"] == edition["row_count"], "NLD_ORIGINAL_ROWS_INCOMPLETE")
    source = edition["source"]
    spec = specification(requested, columns, source)
    meaning = {"schema": PROJECTION_SCHEMA, "mapping": spec["mapping"], "keys": spec["keys"],
               "native_target": {"namespace": spec["namespace"], "name": spec["name"]},
               "types": "exact-text-with-kind-and-presence.v1", "target_semantics": MEANING}
    meaning_id = identity(meaning)
    projected, identities = [], set()
    column_context = {b["target"]: Counter() for b in spec["mapping"]}
    for ordinal, row in enumerate(rows, 1):
        kinds = hints(row, source)
        selected = {b["target"]: cell(row, b["source"], kinds) for b in spec["mapping"]}
        key_cells = [cell(row, field, kinds) for field in spec["keys"]]
        need(all(c["presence"] == "present" and c["kind"] not in ("array", "object") for c in key_cells),
             "NLD_BUSINESS_KEY_NULL_OR_UNSUPPORTED", str(ordinal))
        key_values = [[field, c["kind"], decimal_text(exact_decimal(c["text"])) if c["kind"] in ("number", "integer")
                       else c["text"]] for field, c in zip(spec["keys"], key_cells)]
        business_key = identity(key_values)
        need(business_key not in identities, "NLD_BUSINESS_KEY_DUPLICATE", str(ordinal))
        identities.add(business_key)
        content_key = identity({"meaning": meaning_id, "business_key": business_key, "cells": selected})
        result = {target: c["text"] for target, c in selected.items()}
        result.update(_sf_business_key=business_key, _sf_source_key=content_key,
                      _sf_source_edition=edition["edition_id"], _sf_analysis_version=version["version_id"],
                      _sf_original_row=str(ordinal),
                      _sf_types=encoded({k: c["kind"] for k, c in selected.items()}).decode().rstrip("\n"),
                      _sf_presence=encoded({k: c["presence"] for k, c in selected.items()}).decode().rstrip("\n"),
                      _sf_original_values=encoded(row).decode().rstrip("\n"))
        projected.append(result)
        for target, c in selected.items():
            column_context[target][c["presence"]] += 1
    body = {"schema": PROJECTION_SCHEMA, "edition_id": edition["edition_id"],
            "version_id": version["version_id"], "workspace_input": {
                "source": source, "source_review": edition.get("source_review"),
                "analysis_review": edition.get("review"),
                "original_columns": columns, "row_count": len(rows),
                "original_rows_sha256": identity(rows),
                "version": {k: version.get(k) for k in ("version_id", "row_count", "column_types", "source_revision", "source")}},
            "specification": spec, "meaning_id": meaning_id, "meaning": meaning,
            "columns": [b["target"] for b in spec["mapping"]] + META,
            "rows": projected, "column_presence": {k: dict(v) for k, v in column_context.items()},
            "disclosures": MEANING}
    return {"id": identity(body), **body}

def verify_projection(value):
    body = {k: v for k, v in value.items() if k != "id"}
    need(value.get("schema") == PROJECTION_SCHEMA and identity(body) == value.get("id"),
         "NLD_PROJECTION_IDENTITY")
    need(isinstance(value.get("rows"), list) and value["workspace_input"]["row_count"] == len(value["rows"]),
         "NLD_PROJECTION_ROWS")
    need(identity(value["meaning"]) == value["meaning_id"], "NLD_MEANING_CHANGED")
    business = set()
    mapping = value["specification"]["mapping"]
    for row in value["rows"]:
        need(set(row) == set(value["columns"]), "NLD_PROJECTION_ROW_FIELDS")
        kinds, presence = parse(row["_sf_types"]), parse(row["_sf_presence"])
        cells = {b["target"]: {"kind": kinds[b["target"]], "presence": presence[b["target"]],
                               "text": row[b["target"]]} for b in mapping}
        need(row["_sf_source_key"] == identity({"meaning": value["meaning_id"],
             "business_key": row["_sf_business_key"], "cells": cells}), "NLD_CONTENT_KEY_CHANGED")
        need(row["_sf_business_key"] not in business, "NLD_PROJECTION_DUPLICATE")
        business.add(row["_sf_business_key"])
    originals = [parse(row["_sf_original_values"]) for row in value["rows"]]
    need(identity(originals) == value["workspace_input"]["original_rows_sha256"],
         "NLD_ORIGINAL_VERSION_ROWS_CHANGED")
    version = {**value["workspace_input"]["version"], "row_count": len(originals),
               "version_id": value["version_id"]}
    edition = {"status": "COMPLETE", "version_id": value["version_id"],
               "edition_id": value["edition_id"], "row_count": len(originals),
               "source": value["workspace_input"]["source"],
               "source_review": value["workspace_input"]["source_review"],
               "review": value["workspace_input"]["analysis_review"]}
    rebuilt = project_rows(edition, version, value["workspace_input"]["original_columns"],
                           originals, value["specification"])
    need(rebuilt == value, "NLD_PROJECTION_ORIGINAL_BINDING_CHANGED")
    return value

def target_report(projection, target_rows, selected_keys):
    """Compare every target/source occurrence; no absence/deletion inference."""
    verify_projection(projection)
    target = {}
    for row in target_rows:
        key = row.get("_sf_business_key")
        need(isinstance(key, str) and HASH.fullmatch(key) and key not in target, "NLD_TARGET_KEYS_INVALID")
        target[key] = row
    source = {row["_sf_business_key"]: row for row in projection["rows"]}
    outcomes, matched = [], []
    for original in projection["rows"]:
        actual = target.get(original["_sf_business_key"])
        state = "missing" if actual is None else "matches" if all(
            actual.get(c) == original[c] for c in
            [b["target"] for b in projection["specification"]["mapping"]] + ["_sf_source_key", "_sf_types", "_sf_presence"]
        ) else "different"
        if state == "matches":
            matched.append(original)
        outcomes.append({"business_key": original["_sf_business_key"], "source_key": original["_sf_source_key"],
                         "original_row": int(original["_sf_original_row"]), "state": state,
                         "selected_in_run": original["_sf_source_key"] in selected_keys,
                         "target_source_edition": actual.get("_sf_source_edition") if actual else None,
                         "target_analysis_version": actual.get("_sf_analysis_version") if actual else None,
                         "target_original_row": actual.get("_sf_original_row") if actual else None,
                         "source_values": original, "target_values": actual})
    extra = [row for key, row in target.items() if key not in source]
    measures = []
    for definition in projection["specification"]["measures"]:
        for scope, selected in (("selected-source", projection["rows"]), ("matching-target", matched)):
            values, states = [], Counter()
            for row in selected:
                field = definition["target"]
                presence, kinds = parse(row["_sf_presence"]), parse(row["_sf_types"])
                p = presence[field]
                if p != "present":
                    states[p] += 1
                    continue
                if kinds[field] not in ("integer", "number"):
                    states["not_source_numeric"] += 1
                    continue
                try:
                    value = exact_decimal(row[field])
                    if definition.get("nonnegative", False) and value < 0:
                        states["negative"] += 1
                    else:
                        values.append(value)
                        states["known"] += 1
                except NldError:
                    states["unsupported_numeric_range"] += 1
            measures.append({**definition, "scope": scope, "row_count": len(selected),
                             "known_count": len(values), "states": dict(states),
                             "exact_known_sum": exact_sum(values),
                             "minimum": decimal_text(min(values)) if values else None,
                             "maximum": decimal_text(max(values)) if values else None,
                             "aggregation": "Unweighted disclosed sample sum; source years/units remain those in the selected definition."})
    counts = Counter(row["state"] for row in outcomes)
    return {"schema": SCHEMA + "/target-review", "projection_id": projection["id"],
            "source_rows": len(source), "target_rows": len(target), "selected_processing_keys": len(selected_keys),
            "matching_rows": counts["matches"], "missing_rows": counts["missing"], "different_rows": counts["different"],
            "retained_outside_selection": len(extra), "coverage_denominator": len(source),
            "coverage": "complete-selected-values" if counts["matches"] == len(source) else "partial-or-different-selected-values",
            "outcomes": outcomes, "outside_selection": extra, "measures": measures,
            "source": projection["workspace_input"]["source"], "meaning": MEANING}

def compile_project(projection, task_bytes, contract_bytes, worker_bytes, *, project_id):
    """Return complete native JSON-as-YAML Structures/flow/project; no execution."""
    verify_projection(projection)
    identifier(project_id)
    spec = projection["specification"]
    flow_name, namespace = spec["name"], spec["namespace"]
    need(flow_name.casefold() != "retained_input", "NLD_TARGET_RESERVED")
    fields = {c: {"data_type": "TEXT", "description": "Exact retained source representation; see source.json and the ordered mapping."}
              for c in projection["columns"]}
    for c in META:
        fields[c]["description"] = {
            "_sf_business_key": MEANING["business_key"], "_sf_source_key": MEANING["processing_key"],
            "_sf_types": "Original source kind for every selected target field.",
            "_sf_presence": "Original retained representation presence: absent/null/blank/present.",
            "_sf_original_values": "Complete original imported version row, not a rewritten publisher response.",
        }.get(c, "Exact original input location; does not imply a source update timestamp.")
    pk = [{"name": "pk_" + flow_name, "characterisation": "primary_key",
           "linked_fields": ["_sf_business_key"], "attributes": {}}]
    target_structure = {"name": flow_name, "connector_type": "sqlite", "structure_type": "TABLE",
                        "description": spec["title"], "fields": fields, "characterisations": pk}
    staging = {"name": "retained_input", "connector_type": "sqlite", "structure_type": "TABLE",
               "description": "Complete frozen input for this native run.", "fields": fields,
               "characterisations": [{"name": "pk_retained_input", "characterisation": "primary_key",
                                       "linked_fields": ["_sf_business_key"], "attributes": {}}]}
    flow = {"name": flow_name, "task": "nld_task.RetainedEditionSQLFlowTask",
            "target_structure": namespace + "." + flow_name, "write_strategy": "UPSERT",
            "incremental": {"type": "by_key", "persist_initial_processing_state": True,
                            "immediate_step_persistence": True},
            "state_backend_connector": {"primary": {"connector": "sf_state",
                "params": {"backend_root_path": "../../native-state", "file_format": "json"}}},
            "data_connectors": {"target": "sf_target"},
            "predecessors": {"retained": {"full_path": namespace + ".retained_input",
                                        "role": "MASTER", "key_field": "_sf_source_key"}},
            "params": {"target_schema": "main", "retained_input_file": "source.json"}}
    project = {"name": "sf_datasette_" + project_id[:16], "version": "1",
               "entity_path": "entities", "python_additional_paths": {"flows": ["nld_task"]},
               "namespaces": {namespace: {"structure": {"default_connection_name": "sf_target",
                                "database_name": "reference", "schema_name": "main"},
                              "flow": {"default_state_backend_connector": "sf_state"}}}}
    sql = "SELECT " + ", ".join("i." + quote(c) for c in projection["columns"]) + " FROM main.retained_input AS i WHERE true"
    paths = {
        "nld_project.yml": encoded(project),
        "entities/structure/" + namespace + "/" + flow_name + ".yml": encoded(target_structure),
        "entities/structure/" + namespace + "/retained_input.yml": encoded(staging),
        "entities/flows/" + namespace + "/" + flow_name + ".yml": encoded(flow),
        "entities/flows/" + namespace + "/" + flow_name + ".sql": (sql + "\n").encode(),
        "source.json": encoded(projection), "nld_task.py": task_bytes,
        "nld_contract.py": contract_bytes, "nld_worker.py": worker_bytes,
    }
    members = [{"path": p, "bytes": len(raw), "sha256": sha(raw)} for p, raw in sorted(paths.items())]
    manifest = {"schema": PROJECT_SCHEMA, "project_id": project_id, "projection_id": projection["id"],
                "meaning_id": projection["meaning_id"], "flow_name": flow_name, "namespace": namespace,
                "upstream": {"repository": "nexuslab-data/nld-core", "commit": NLD_COMMIT, "version": NLD_VERSION,
                             "python": ">=3.12,<3.14", "extras": ["pyarrow"], "required_sources": NLD_REQUIRED_SOURCES},
                "files": members, "native_execution": "not_performed_by_compile", "meaning": MEANING}
    manifest["id"] = identity(manifest)
    paths["project-manifest.json"] = encoded(manifest)
    return manifest, paths

def verify_project(root):
    manifest = load(Path(root) / "project-manifest.json")
    need(manifest.get("schema") == PROJECT_SCHEMA and manifest.get("id") ==
         identity({k: v for k, v in manifest.items() if k != "id"}), "NLD_PROJECT_MANIFEST")
    need(name(manifest.get("flow_name")).casefold() != "retained_input", "NLD_TARGET_RESERVED")
    for member in manifest["files"]:
        check_file(root, member)
    projection = verify_projection(load(Path(root) / "source.json"))
    need(projection["id"] == manifest["projection_id"], "NLD_PROJECT_SOURCE_CHANGED")
    return manifest, projection

def closure(root, *, exclude=()):
    root = Path(root)
    result = []
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        need(not path.is_symlink(), "NLD_CLOSURE_SYMLINK", rel)
        if path.is_dir():
            continue
        if any(rel == x or rel.startswith(x.rstrip("/") + "/") for x in exclude):
            continue
        need(path.is_file(), "NLD_CLOSURE_SPECIAL_FILE", rel)
        result.append(file_identity(path, relative_to=root))
    return result

def export_zip(root, destination, members, *, source_files=None):
    """Bounded complete archive with held original files and create-only publication."""
    root, destination = Path(root), Path(destination)
    private_directory(destination.parent)
    if destination.exists():
        with zipfile.ZipFile(destination) as archive:
            need(archive.namelist() == [m["path"] for m in members], "NLD_ARCHIVE_CLOSURE_CHANGED")
            for item in members:
                with archive.open(item["path"]) as source:
                    digest, count = hashlib.sha256(), 0
                    while chunk := source.read(65536):
                        digest.update(chunk); count += len(chunk)
                need(count == item["bytes"] and digest.hexdigest() == item["sha256"], "NLD_ARCHIVE_MEMBER_CHANGED")
        return file_identity(destination)
    fd, pending = tempfile.mkstemp(prefix=".nld-archive-", dir=destination.parent)
    os.close(fd)
    complete = False
    try:
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for item in members:
                source_path = (source_files or {}).get(item["path"], root / item["path"])
                actual_source = file_identity(source_path)
                need(actual_source["bytes"] == item["bytes"] and actual_source["sha256"] == item["sha256"],
                     "NLD_ARCHIVE_INPUT_CHANGED", item["path"])
                info = zipfile.ZipInfo(relative(item["path"]), (2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                count, digest = 0, hashlib.sha256()
                with held(source_path) as (source, before), archive.open(info, "w", force_zip64=True) as output:
                    while chunk := source.read(65536):
                        output.write(chunk); count += len(chunk); digest.update(chunk)
                need(count == item["bytes"] and digest.hexdigest() == item["sha256"], "NLD_ARCHIVE_INPUT_CHANGED")
        with open(pending, "rb") as source:
            os.fsync(source.fileno())
        os.link(pending, destination, follow_symlinks=False)
        sync(destination.parent)
        complete = True
        return file_identity(destination)
    finally:
        if complete:
            Path(pending).unlink(missing_ok=True)
            sync(destination.parent)

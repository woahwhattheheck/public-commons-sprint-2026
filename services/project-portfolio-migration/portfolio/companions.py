"""Retain enterprise companion files and apply explicit source-column mappings."""
from __future__ import annotations

import csv
from decimal import Decimal, InvalidOperation
import io
import json
from pathlib import Path

from .native import FAMILY_TYPES
from .storage import PortfolioError, digest, require

ROLES = {"enterprise_fields", "lookup_tables", "resource_pool", "project_metadata",
         "portfolio_metadata", "attachment", "target_exceptions"}
KINDS = {"key", "uid", "guid"}


def descriptor(value):
    require(isinstance(value, dict) and isinstance(value.get("path"), (str, Path)),
            "companion_source", "Choose the original companion file.")
    allowed = {"path", "label", "format", "role", "encoding", "delimiter", "json_pointer"}
    require(set(value) <= allowed, "companion_options", "Choose the named companion input controls.", sorted(allowed))
    path = Path(value["path"]).absolute()
    result = {"path": str(path), "label": value.get("label", path.name),
              "format": value.get("format", "auto"), "role": value.get("role", "attachment"),
              "encoding": value.get("encoding", "utf-8-sig"), "delimiter": value.get("delimiter", ","),
              "json_pointer": value.get("json_pointer", "")}
    require(result["format"] in {"auto", "csv", "tsv", "json", "jsonl", "binary"},
            "companion_format", "Choose CSV, TSV, JSON, JSONL or an original binary attachment.")
    require(result["role"] in ROLES and isinstance(result["label"], str) and bool(result["label"].strip()),
            "companion_role", "Give the original companion a label and a named role.")
    require(isinstance(result["encoding"], str) and isinstance(result["delimiter"], str)
            and len(result["delimiter"]) == 1 and isinstance(result["json_pointer"], str),
            "companion_options", "Choose an explicit source encoding, delimiter and JSON pointer.")
    if result["format"] == "auto":
        result["format"] = {".csv": "csv", ".tsv": "tsv", ".json": "json", ".jsonl": "jsonl", ".ndjson": "jsonl"}.get(path.suffix.lower(), "binary")
    return result


def pointer(value, path):
    require(path == "" or path.startswith("/"), "json_pointer", "Use an empty or slash-delimited JSON pointer.")
    for part in path.split("/")[1:]:
        part = part.replace("~1", "/").replace("~0", "~")
        try:
            value = value[int(part)] if isinstance(value, list) else value[part]
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise PortfolioError("json_pointer", "The selected source JSON pointer is absent.", path) from error
    return value


def capture(raw, selected, source_id):
    """The original bytes remain authoritative; rows retain source lexical values."""
    require(isinstance(raw, bytes), "companion_bytes", "Read the complete retained companion bytes.")
    result = {"schema": "project-portfolio-companion.v1", "source_id": source_id,
              "label": selected["label"], "role": selected["role"], "format": selected["format"],
              "profile": {k: v for k, v in selected.items() if k != "path"}, "rows": [], "columns": [], "findings": []}
    if selected["format"] == "binary":
        return result
    try:
        text = raw.decode(selected["encoding"])
    except (UnicodeError, LookupError) as error:
        raise PortfolioError("companion_encoding", "Read this original companion using its actual encoding.", str(error)) from error
    if selected["format"] in {"csv", "tsv"}:
        reader = csv.reader(io.StringIO(text, newline=""), delimiter="\t" if selected["format"] == "tsv" else selected["delimiter"])
        header = next(reader, [])
        rows, ends = [], []
        prior_line = reader.line_num
        for values in reader:
            rows.append(values)
            ends.append((prior_line + 1, reader.line_num))
            prior_line = reader.line_num
        result["columns"] = [{"key": "column:" + str(index), "name": name, "ordinal": index} for index, name in enumerate(header)]
        for index, row in enumerate(rows):
            result["rows"].append({"key": "row:" + str(index + 2), "ordinal": index,
                                   "source_record": index + 2, "source_line": ends[index][0], "source_end_line": ends[index][1], "cells": {"column:" + str(i): value for i, value in enumerate(row)}})
            if len(row) != len(header):
                item = {"code": "companion_row_width", "severity": "review",
                        "path": source_id + "/row:" + str(index + 2),
                        "message": "This source record has a different number of cells from its header.",
                        "details": {"expected": len(header), "actual": len(row)}}
                result["findings"].append({"id": digest(item), **item})
    else:
        def unique_object(pairs):
            result = {}
            for key, value in pairs:
                require(key not in result, "companion_json_key", "A JSON object contains a repeated property; select an unambiguous original export.", key)
                result[key] = value
            return result
        parse = lambda value: json.loads(value, parse_float=lambda x: {"json_number": x},
                                        parse_int=lambda x: {"json_number": x}, object_pairs_hook=unique_object,
                                        parse_constant=lambda x: (_ for _ in ()).throw(ValueError("Non-finite JSON number: " + x)))
        if selected["format"] == "jsonl":
            original = [{"line": index + 1, "value": parse(line)} for index, line in enumerate(text.splitlines()) if line.strip()]
            values = [(row["line"], pointer(row["value"], selected["json_pointer"])) for row in original]
        else:
            selected_value = pointer(parse(text), selected["json_pointer"])
            values = list(enumerate(selected_value, 1)) if isinstance(selected_value, list) else [(1, selected_value)]
        columns = {}
        for ordinal, (line, value) in enumerate(values):
            cells = value if isinstance(value, dict) and set(value) != {"json_number"} else {"value": value}
            for key in cells:
                columns.setdefault(str(key), len(columns))
            result["rows"].append({"key": "row:" + str(line), "ordinal": ordinal, "source_line": line, "cells": cells})
        result["columns"] = [{"key": key, "name": key, "ordinal": ordinal} for key, ordinal in columns.items()]
    result["row_count"] = len(result["rows"])
    return result


def lexical(value):
    if isinstance(value, dict) and set(value) == {"json_number"}:
        return value["json_number"]
    return value


def typed(value, spec):
    value = lexical(value)
    kind = spec.get("type", "string")
    if value is None or value == "":
        if spec.get("clear_blank") is True:
            return None
        return {"type": "string", "value": ""} if value == "" and kind == "string" else "skip"
    if kind == "string":
        require(isinstance(value, (str, int, float, bool)), "mapping_text", "Map a scalar source cell to native text.")
        return {"type": kind, "value": str(value) if not isinstance(value, str) else value}
    if kind == "boolean":
        true_values, false_values = spec.get("true_values", [True, "true"]), spec.get("false_values", [False, "false"])
        def exact_member(candidate, values):
            return any(type(candidate) is type(item) and candidate == item for item in values)
        require(exact_member(value, true_values) != exact_member(value, false_values),
                "mapping_boolean", "Define an unambiguous source boolean value.", value)
        return {"type": kind, "value": exact_member(value, true_values)}
    if kind in {"integer", "number", "duration", "rate"}:
        require(isinstance(value, str), "mapping_number", "Retain the exact numeric source text.", value)
        text = value
        thousands, decimal = spec.get("thousands_separator"), spec.get("decimal_separator", ".")
        require(isinstance(decimal, str) and len(decimal) == 1 and
                (thousands is None or isinstance(thousands, str) and len(thousands) == 1 and thousands != decimal),
                "mapping_number_format", "Choose the original decimal and grouping separators explicitly.")
        if thousands and thousands in text:
            whole = text.split(decimal, 1)[0]
            if whole.startswith(("+", "-")):
                whole = whole[1:]
            groups = whole.split(thousands)
            require(groups[0].isdigit() and 1 <= len(groups[0]) <= 3
                    and all(group.isdigit() and len(group) == 3 for group in groups[1:])
                    and thousands not in (text.split(decimal, 1)[1] if decimal in text else ""),
                    "mapping_number_grouping", "The source value does not use the selected three-digit grouping.", value)
            text = text.replace(thousands, "")
        if decimal != ".":
            text = text.replace(decimal, ".")
        try:
            amount = Decimal(text)
            require(amount.is_finite(), "mapping_number", "Choose a finite native amount.", value)
        except InvalidOperation as error:
            raise PortfolioError("mapping_number", "The source cell is not a number in the selected source format.", value) from error
        require(kind != "integer" or amount == amount.to_integral_value(),
                "mapping_integer", "An integer target requires an exact whole source value.", value)
        result = {"type": kind, "value": str(int(amount)) if kind == "integer" else text}
        if kind in {"duration", "rate"}:
            require(isinstance(spec.get("units"), str), "mapping_units", "Select the original MPXJ TimeUnit name.")
            result["units"] = spec["units"]
        return result
    require(kind in {"local_datetime", "local_date", "local_time", "enum"},
            "mapping_type", "Choose a supported native scalar type.", kind)
    require(isinstance(value, str), "mapping_type", "Use the original ISO date/time or native enum text.", value)
    result = {"type": kind, "value": value}
    if spec.get("java_class"):
        result["java_class"] = spec["java_class"]
    return result


def capture_selections(companions):
    """Describe exact captures without changing an original retained model."""
    require(isinstance(companions, list), "companion_captures", "Retain the original companion capture list.")
    result = []
    for ordinal, source in enumerate(companions):
        require(isinstance(source, dict) and isinstance(source.get("source_id"), str)
                and isinstance(source.get("profile"), dict),
                "companion_capture", "Retain the original companion source and complete profile.", ordinal)
        profile = source["profile"]
        identity = {"schema": "project-portfolio-companion-selection.v1",
                    "source_id": source["source_id"], "ordinal": ordinal, "profile": profile}
        result.append({"capture_id": digest(identity), "ordinal": ordinal, "source_id": source["source_id"],
                       "label": source.get("label"), "role": source.get("role"), "format": source.get("format"),
                       "profile": dict(profile), "profile_sha256": digest(profile),
                       "columns": [dict(column) for column in source.get("columns", [])],
                       "row_count": len(source.get("rows", []))})
    return result


def compile_mappings(model, companions, mappings):
    """Resolve every mapped source cell against one original native entity."""
    require(isinstance(mappings, list), "companion_mappings", "Supply the explicit companion mapping list.")
    selections = capture_selections(companions)
    by_capture = {item["capture_id"]: item for item in selections}
    by_source = {}
    for item in selections:
        by_source.setdefault(item["source_id"], []).append(item)
    corrections, links, findings = [], [], []
    seen = set()
    for mapping in mappings:
        require(isinstance(mapping, dict) and set(mapping) <= {"source_id", "capture_id", "family", "identity", "columns"},
                "companion_mapping", "Use the original source, optional capture selector, native family and column mappings.")
        source_id, family = mapping.get("source_id"), mapping.get("family")
        require(isinstance(source_id, str) and isinstance(family, str)
                and source_id in by_source and family in FAMILY_TYPES,
                "companion_mapping", "Choose an original companion and native family.")
        selected_id = mapping.get("capture_id")
        if selected_id is None:
            candidates = by_source[source_id]
            require(len(candidates) == 1, "companion_capture_ambiguous",
                    "This original file has several captures; select its exact label, role and profile.",
                    {"source_id": source_id, "captures": candidates})
            selection = candidates[0]
        else:
            require(isinstance(selected_id, str) and selected_id in by_capture
                    and by_capture[selected_id]["source_id"] == source_id,
                    "companion_capture", "Choose a capture from this original edition and source.", selected_id)
            selection = by_capture[selected_id]
        source = companions[selection["ordinal"]]
        identity = mapping.get("identity", {})
        require(isinstance(identity, dict) and identity.get("kind") in KINDS
                and isinstance(identity.get("column"), str), "companion_identity", "Choose an original identity column and key, UID or GUID.")
        rows = [model["project"]] if family == "project" else model[family]
        index = {}
        for row in rows:
            key = row.get(identity["kind"])
            if key is not None:
                index.setdefault(str(key), []).append(row)
        columns = mapping.get("columns", [])
        require(isinstance(columns, list) and columns, "companion_columns", "Choose at least one original source-column mapping.")
        actual_columns = {column["key"] for column in source["columns"]}
        require(identity["column"] in actual_columns, "companion_identity", "Select the source column key from the original capture.")
        for selected in columns:
            require(isinstance(selected, dict) and selected.get("column") in actual_columns
                    and isinstance(selected.get("field"), str), "companion_column", "Select a captured column and declared native field.")
        for row in source["rows"]:
            source_identity = lexical(row["cells"].get(identity["column"]))
            matches = index.get(str(source_identity), []) if source_identity is not None else []
            if len(matches) != 1:
                item = {"code": "companion_entity_unmatched" if not matches else "companion_entity_ambiguous",
                        "severity": "review", "path": selection["capture_id"] + "/" + row["key"],
                        "message": "Select one original native entity for this companion record.",
                        "details": {"identity": source_identity, "kind": identity["kind"], "matches": [v["key"] for v in matches],
                                    "source_id": source_id, "capture_id": selection["capture_id"],
                                    "capture_ordinal": selection["ordinal"], "profile_sha256": selection["profile_sha256"]}}
                findings.append({"id": digest(item), **item})
                continue
            target = matches[0]
            for spec in columns:
                require(spec["field"] in model["field_catalogue"].get(family, {}),
                        "companion_field", "Choose the declared native field from the selected edition.", spec["field"])
                # A short CSV row has no cell. It must never become an implicit clear.
                if spec["column"] not in row["cells"]:
                    continue
                after = typed(row["cells"][spec["column"]], spec)
                if after == "skip":
                    continue
                key = (family, target["key"], spec["field"])
                require(key not in seen, "companion_duplicate_target", "Two source cells target the same native field; resolve the mapping first.", key)
                seen.add(key)
                before = target["fields"].get(spec["field"])
                if before != after:
                    corrections.append({"family": family, "key": target["key"], "field": spec["field"],
                                        "before": before, "after": after})
                links.append({"source_id": source_id, "capture_id": selection["capture_id"],
                              "capture_ordinal": selection["ordinal"], "profile_sha256": selection["profile_sha256"],
                              "source_row": row["key"], "source_column": spec["column"],
                              "family": family, "key": target["key"], "field": spec["field"], "before": before, "after": after})
    return {"corrections": corrections, "links": links, "findings": findings}

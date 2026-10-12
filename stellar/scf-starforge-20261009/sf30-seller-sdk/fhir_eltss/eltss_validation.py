"""MIT. Typed eLTSS operator input, exact source citations and reviewed selectors."""
from __future__ import annotations
import json
from pathlib import Path
import re
from eltss_runtime import InputError, fhir
from eltss_source import jbytes, json_value, text, identity, integer, exact, RESOURCE_TYPE

HERE = Path(__file__).resolve().parent


def catalogue():
    value = json_value((HERE / "catalogue.json").read_bytes())
    if value.get("schema") != "stellar-forge.eltss-catalogue.v1":
        raise InputError("Installed eLTSS catalogue has another schema")
    return value


def path_tokens(value, label="Selected path"):
    if not isinstance(value, list) or len(value) > 64 or any(type(t) is not str or len(t) > 2048 for t in value):
        raise InputError(label + " requires exact JSON string tokens")
    return list(value)


def strings(value, label, maximum=256):
    if not isinstance(value, list) or len(value) > maximum:
        raise InputError(label + " must be an array within its supported count")
    result = []
    for item in value:
        text(item, label, 4096, False)
        if item in result:
            raise InputError(label + " repeats an original identity")
        result.append(item)
    return result


def source_ref(value):
    exact(value, {"sourceId", "recordId", "pointer"}, "Original source reference")
    result = {"sourceId": identity(value.get("sourceId")), "recordId": identity(value.get("recordId"))}
    if "pointer" in value:
        p = text(value["pointer"], "Original JSON pointer", 8192)
        if p and not p.startswith("/") or re.search(r"~(?![01])", p):
            raise InputError("Source citation requires an exact JSON pointer")
        result["pointer"] = p
    return result


def value_json(value, label):
    text(value, label, 2 * 1024 * 1024, False)
    if len(value.encode()) > 2 * 1024 * 1024:
        raise InputError(label + " exceeds 2 MiB")
    json_value(value, lexical=True)
    return value


def typed_value(value, definition, label, definitions):
    kind = definition["type"]
    if value is None and definition.get("nullable"):
        return None
    if kind in {"string", "text"}:
        return text(value, label, definition.get("maxLength", 16384 if kind == "text" else 2048))
    if kind == "url":
        if value == "" and definition.get("allowEmpty"):
            return ""
        return fhir.http_url(value, label)
    if kind == "boolean":
        if type(value) is not bool:
            raise InputError(label + " must be true or false")
        return value
    if kind == "integer":
        return integer(value, 0, 512 * 1024 * 1024, label)
    if kind == "enum":
        if value not in definition["choices"]:
            raise InputError(label + " must be one of " + ", ".join(definition["choices"]))
        return value
    if kind in {"reference", "resource"}:
        return identity(value)
    if kind in {"reference-list", "resource-list"}:
        return [identity(v) for v in strings(value, label, definition.get("maxItems", 5000))]
    if kind in {"profile", "source-field"}:
        return text(value, label, 160, False)
    if kind in {"auth-profile", "operation-id"}:
        return fhir.operation_id(value)
    if kind == "instant":
        return fhir.instant(value, label, optional=definition.get("nullable", False))
    if kind == "string-list":
        return strings(value, label, definition.get("maxItems", 512))
    if kind == "source-field-list":
        return strings(value, label, 56)
    if kind == "path-tokens":
        return path_tokens(value, label)
    if kind == "source-reference-list":
        if not isinstance(value, list) or len(value) > 512:
            raise InputError(label + " requires at most 512 original source references")
        return [source_ref(v) for v in value]
    if kind == "resource-type":
        if type(value) is not str or not RESOURCE_TYPE.fullmatch(value):
            raise InputError(label + " must be an exact FHIR resource type")
        return value
    if kind == "json-value":
        return value_json(value, label)
    if kind == "object":
        return typed_object(value, {"fields": definition["fields"]}, label, definitions)
    if kind == "object-list":
        if not isinstance(value, list) or len(value) > definition.get("maxItems", 512):
            raise InputError(label + " has too many entries")
        return [typed_object(v, {"fields": definition["fields"]}, label, definitions) for v in value]
    if kind == "selector-list":
        if not isinstance(value, list) or len(value) > 32:
            raise InputError(label + " requires at most 32 reviewed selectors")
        return [typed_object(v, definitions["selector"], "Field selector", definitions) for v in value]
    if kind == "field-reviews":
        if not isinstance(value, list) or len(value) != 56:
            raise InputError("A review set retains all 56 dataset fields, including draft and nonapplicable rows")
        return [typed_object(v, definitions["fieldReview"], "Field review", definitions) for v in value]
    raise InputError("Unsupported installed field type: " + kind)


def typed_object(value, definition, label, definitions):
    fields = definition["fields"]
    exact(value, fields, label)
    result = {}
    for key, field in fields.items():
        if key in value:
            result[key] = typed_value(value[key], field, label + " " + key, definitions)
        elif "default" in field:
            result[key] = typed_value(field["default"], field, label + " " + key, definitions)
        elif key in definition.get("required", []):
            raise InputError(label + " requires " + key)
    for key in definition.get("required", []):
        if key in result and isinstance(result[key], str) and not result[key].strip():
            raise InputError(label + " requires nonempty " + key)
    return result


def typed(name, value):
    definitions = catalogue()["schemas"]
    if name not in definitions:
        raise InputError("Unknown installed eLTSS record schema")
    if len(jbytes(value)) > 4 * 1024 * 1024:
        raise InputError("An operator request must fit the documented 4 MiB limit")
    return typed_object(value, definitions[name], name, definitions)


def checked_selectors(selectors):
    for selector in selectors:
        steps = selector.get("steps")
        if not isinstance(steps, list) or not 1 <= len(steps) <= 32:
            raise InputError("A field selector requires 1–32 explicit ordered steps")
        for step in steps:
            if "direction" not in step or "path" not in step:
                raise InputError("Every field step requires a direction and exact path")
            if step["direction"] == "value" and any(not isinstance(t, str) for t in step["path"]):
                raise InputError("Value selection requires exact JSON tokens")
            predicates = step.get("where", [])
            if len(predicates) > 32:
                raise InputError("A step supports at most 32 explicit predicates")
            for predicate in predicates:
                if "path" not in predicate or "operator" not in predicate:
                    raise InputError("Every predicate requires a selected path and operator")
                operator = predicate["operator"]
                if operator != "exists" and "valueJson" not in predicate:
                    raise InputError("A comparison predicate requires complete valueJson")
                value = json_value(predicate.get("valueJson", "true"), lexical=True)
                if operator == "one-of" and not isinstance(value, list):
                    raise InputError("A one-of predicate requires an original JSON array")
                if operator == "exists" and type(value) is not bool:
                    raise InputError("An exists predicate requires true or false")
    return selectors

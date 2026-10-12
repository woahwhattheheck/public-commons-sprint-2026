"""Lossless source-to-source PRS XML / ClinicalTrials.gov v2 reconciliation."""
from __future__ import annotations
import datetime
import json
import re
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from .errors import PrsError
from . import schema as s

class NumberLexeme(str):
    """An original JSON number token; it is never converted through binary float."""

def _pairs(items):
    out = {}
    for key, value in items:
        if key in out:
            raise PrsError("Native JSON contains a duplicate object key.", "JSON_DUPLICATE_KEY", {"key": key})
        out[key] = value
    return out

def parse_native_json(value):
    if isinstance(value, bytes):
        data = value
        try:
            text = value.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise PrsError("Native study JSON must be UTF-8.", "JSON_ENCODING") from exc
    elif isinstance(value, str):
        data = value.encode("utf-8")
        text = value.removeprefix("\ufeff")
    else:
        raise PrsError("rawJson must be the complete original JSON text or bytes.", "JSON_SOURCE")
    if not data or len(data) > 64 * 1024 * 1024:
        raise PrsError("One native study JSON must contain 1 to 67108864 bytes.", "JSON_SIZE")
    try:
        native = json.loads(text, parse_int=NumberLexeme, parse_float=NumberLexeme,
                            parse_constant=lambda x: (_ for _ in ()).throw(PrsError("Nonfinite JSON number.", "JSON_NUMBER")),
                            object_pairs_hook=_pairs)
    except (ValueError, RecursionError) as exc:
        if isinstance(exc, PrsError):
            raise
        raise PrsError("The retained study JSON cannot be parsed.", "JSON_PARSE", str(exc)) from exc
    if not isinstance(native, dict):
        raise PrsError("Each rawJson must be a complete native study object.", "JSON_SOURCE")
    return native, data

def _pointer(tokens):
    return "".join("/" + str(k).replace("~", "~0").replace("/", "~1") for k in tokens)

def _tokens(pointer):
    if not isinstance(pointer, str) or (pointer and not pointer.startswith("/")):
        raise PrsError("apiPointer must be an RFC 6901 JSON pointer.", "RECORD_LINK")
    if re.search(r"~(?![01])", pointer):
        raise PrsError("JSON pointer has an invalid escape.", "RECORD_LINK")
    return [t.replace("~1", "/").replace("~0", "~") for t in pointer.split("/")[1:]] if pointer else []

def _at(value, pointer):
    for token in _tokens(pointer):
        if isinstance(value, list):
            if not re.fullmatch(r"0|[1-9][0-9]*", token) or int(token) >= len(value):
                raise PrsError("The selected API occurrence does not exist.", "RECORD_LINK", {"apiPointer": pointer})
            value = value[int(token)]
        elif isinstance(value, dict) and token in value:
            value = value[token]
        else:
            raise PrsError("The selected API occurrence does not exist.", "RECORD_LINK", {"apiPointer": pointer})
    return value

def _raw(value):
    if isinstance(value, NumberLexeme):
        return {"kind": "number", "numericLexeme": str(value)}
    if value is None:
        return {"kind": "null", "value": None}
    if isinstance(value, bool):
        return {"kind": "boolean", "value": value}
    if isinstance(value, str):
        return {"kind": "string", "value": value}
    if isinstance(value, list):
        return {"kind": "array", "items": [_raw(v) for v in value]}
    if isinstance(value, dict):
        return {"kind": "object", "properties": {k: _raw(v) for k, v in value.items()}}
    raise PrsError("Unsupported native JSON value.", "JSON_TYPE")

def _api_entries(root, path):
    entries = [(root, [], "present")]
    for step in path:
        next_entries = []
        for value, tokens, state in entries:
            if state != "present":
                next_entries.append((value, tokens, state))
            elif step == "*":
                if not isinstance(value, list):
                    next_entries.append((value, tokens, "null" if value is None else "type_error"))
                elif not value:
                    next_entries.append((value, tokens, "empty_array"))
                else:
                    next_entries.extend((v, [*tokens, i], "present") for i, v in enumerate(value))
            elif isinstance(value, dict):
                next_entries.append((value.get(step), [*tokens, step], "present" if step in value else "missing"))
            elif isinstance(value, list) and isinstance(step, int) and 0 <= step < len(value):
                next_entries.append((value[step], [*tokens, step], "present"))
            else:
                next_entries.append((value, tokens, "null" if value is None else "type_error"))
        entries = next_entries
    return [{"apiPointer": _pointer(tokens),
             "state": "null" if state == "present" and value is None else
                      "empty" if state == "present" and value == "" else state,
             "raw": _raw(value) if state != "missing" else {"kind": "missing"},
             "_value": value}
            for value, tokens, state in entries]

def _xml_entries(study, field, *, standalone=False):
    path = list(field["xmlPath"])
    if standalone:
        if not path or path[0] != "{" + s.RRS + "}result":
            return [{"state": "outside_standalone_results", "path": [], "raw": {"kind": "missing"}, "_value": None}]
        path = path[1:]
    nodes = [study]
    for part in path:
        if part.startswith("@"):
            entries = []
            for node in nodes:
                value = node.get(part[1:])
                entries.append({"path": [*s.path_of(node), {"attribute": part[1:]}], "line": node.sourceline,
                                "state": "missing" if value is None else "empty" if value == "" else "present",
                                "raw": {"kind": "string", "value": value} if value is not None else {"kind": "missing"},
                                "_value": value})
            return entries
        nodes = [child for parent in nodes for child in s.children(parent) if child.tag == part]
    if field.get("xmlValueChild"):
        nodes = [n for parent in nodes for n in s.select_xml(parent, (field["xmlValueChild"],))]
    if not nodes:
        return [{"state": "missing", "path": [], "requestedPath": list(field["xmlPath"]),
                 "raw": {"kind": "missing"}, "_value": None}]
    return [{"path": s.path_of(node), "line": node.sourceline,
             "state": "empty" if s.text_value(node) == "" else "present",
             "raw": {"kind": "string", "value": s.text_value(node)},
             "_value": s.text_value(node)} for node in nodes]

def _yes_no(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and not isinstance(value, NumberLexeme):
        if value.lower() in ("yes", "true", "1"):
            return True
        if value.lower() in ("no", "false", "0"):
            return False
    raise ValueError("Expected an explicit yes/no or boolean value.")

_PHASES = {"N/A": ["NA"], "Phase 0": ["EARLY_PHASE1"], "Early Phase 1": ["EARLY_PHASE1"],
           "Phase 1": ["PHASE1"], "Phase 1/2": ["PHASE1", "PHASE2"], "Phase 2": ["PHASE2"],
           "Phase 2/3": ["PHASE2", "PHASE3"], "Phase 3": ["PHASE3"], "Phase 4": ["PHASE4"]}
_NUMBER = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")
_DATE = re.compile(r"([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2}))?)?\Z")

def _normalise(entry, field, side):
    if entry["state"] != "present":
        return {"state": entry["state"]}
    value, kind = entry["_value"], field["type"]
    try:
        if kind in ("integer", "number"):
            if side == "api" and field.get("apiNativeType") == "number" and not isinstance(value, NumberLexeme):
                raise ValueError("The captured OpenAPI field must be a native JSON number.")
            if not isinstance(value, str) or not _NUMBER.fullmatch(value.strip()):
                raise ValueError("Expected an exact finite decimal number.")
            number = Decimal(value.strip())
            if not number.is_finite() or (kind == "integer" and number != number.to_integral_value()):
                raise ValueError("The number does not satisfy the declared integer/decimal type.")
            # Canonical exponent-free exact decimal; retain the original lexical
            # representation separately in entry.raw, including negative zero.
            if abs(number.adjusted()) > 10000:
                raise ValueError("Numeric exponent exceeds the supported exact-display bound.")
            normalized = format(number, "f")
            if "." in normalized:
                normalized = normalized.rstrip("0").rstrip(".")
            if number == 0:
                normalized = "0"
            return {"state": "present", "kind": kind, "value": normalized}
        if kind == "boolean":
            if side == "api" and not isinstance(value, bool):
                raise ValueError("The captured OpenAPI field must be a native JSON boolean.")
            return {"state": "present", "kind": "boolean", "value": _yes_no(value)}
        if kind == "membership":
            if side == "xml":
                result = _yes_no(value)
            else:
                if not isinstance(value, list) or any(type(v) is not str for v in value):
                    raise ValueError("Expected the native array of declared recipient/category values.")
                result = field["member"] in value
            return {"state": "present", "kind": "boolean", "value": result}
        if kind == "no-masking":
            if side == "xml":
                result = _yes_no(value)
            else:
                if value not in ("NONE", "SINGLE", "DOUBLE", "TRIPLE", "QUADRUPLE"):
                    raise ValueError("Expected a native DesignMasking enumeration.")
                result = value == "NONE"
            return {"state": "present", "kind": "boolean", "value": result}
        if kind == "phases":
            if side == "xml":
                if value not in _PHASES:
                    raise ValueError("The source phase spelling has no explicit selected mapping.")
                result = _PHASES[value]
            else:
                if not isinstance(value, list) or any(v not in {"NA", "EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4"} for v in value):
                    raise ValueError("Expected a native Phase array.")
                result = value
            return {"state": "present", "kind": "array", "value": result}
        if not isinstance(value, str) or isinstance(value, NumberLexeme):
            raise ValueError("Expected a native string; numbers and strings remain distinct.")
        if kind == "partial-date":
            match = _DATE.fullmatch(value)
            if not match:
                raise ValueError("Expected a source date with explicit year, month or day precision.")
            year, month, day = match.groups()
            datetime.date(int(year), int(month or 1), int(day or 1))
            return {"state": "present", "kind": "partial-date", "value": value,
                    "precision": "day" if day else "month" if month else "year"}
        if kind == "enum":
            choices = field.get("enumMap", {})
            if side == "xml":
                if value not in choices:
                    raise ValueError("The source spelling has no explicit selected enum mapping.")
                value = choices[value]
            elif value not in set(choices.values()):
                raise ValueError("The API value is outside this selected source mapping.")
            return {"state": "present", "kind": "enum", "value": value}
        return {"state": "present", "kind": kind, "value": value}
    except (ValueError, InvalidOperation, OverflowError) as exc:
        return {"state": "invalid_type", "expected": kind, "message": str(exc)}

def catalog(schema_dir=None):
    source = s.schemas(schema_dir)
    if not source.profile_matches:
        raise PrsError("The typed mapping profile is bound to the selected original NLM editions.", "PROFILE_SOURCE")
    path = Path(__file__).parent / "profiles" / "nlm-20261012.json"
    try:
        data = path.read_bytes()
        profile = json.loads(data)
    except (OSError, ValueError) as exc:
        raise PrsError("The retained typed field profile cannot be read.", "PROFILE_SOURCE") from exc
    expected = {"ProtocolRecordSchema": s.BUNDLED_HASHES["ProtocolRecordSchema.xsd"],
                "RRSUploadSchema": s.BUNDLED_HASHES["RRSUploadSchema.xsd"],
                "OpenAPI": s.BUNDLED_HASHES["clinicaltrials-openapi.yaml"]}
    if profile.get("sourceHashes") != expected:
        raise PrsError("The typed profile source hashes do not match its original contracts.", "PROFILE_SOURCE")
    ids = [f.get("id") for f in profile.get("fields", [])]
    if len(ids) != len(set(ids)) or not ids:
        raise PrsError("The typed profile must declare unique field IDs.", "PROFILE_SOURCE")
    return {**profile, "profileSha256": s.sha256(data), "schemaSetSha256": source.set_sha256,
            "schemaSources": source.sources}

def _path_prefix(prefix, path):
    return len(prefix) <= len(path) and path[:len(prefix)] == prefix

def _pointer_prefix(prefix, pointer):
    return prefix == pointer or (pointer.startswith(prefix + "/") if prefix else True)

def _scope_for_id(pointer):
    for marker in ("/eventGroups/", "/groups/"):
        if marker in pointer:
            return pointer.rsplit(marker, 1)[0]
    return pointer.rsplit("/", 1)[0]

def _record_links(study_index, study, native, doc, plan):
    links, seen_xml, seen_api, ids = [], set(), set(), []
    for i, link in enumerate(plan.get("recordLinks", [])):
        if link.get("studyIndex") != study_index:
            continue
        path, pointer, reason = link.get("xmlPath"), link.get("apiPointer"), link.get("reason")
        if not isinstance(path, list) or not path or not isinstance(reason, str) or not reason.strip():
            raise PrsError("Record links need exact source paths and a reason.", "RECORD_LINK", {"index": i})
        node = s.node_at(doc, path)
        if not _path_prefix(s.path_of(study), path):
            raise PrsError("A record link points outside its selected XML study.", "RECORD_LINK")
        value = _at(native, pointer)
        if not isinstance(value, dict) or not s.children(node):
            raise PrsError("Record links pair an original XML record element with a native JSON object.", "RECORD_LINK")
        xmlkey = s.path_key(path)
        if xmlkey in seen_xml or pointer in seen_api:
            raise PrsError("Record links must be one-to-one within the selected study.", "RECORD_LINK")
        seen_xml.add(xmlkey); seen_api.add(pointer)
        row = {"studyIndex": study_index, "xmlPath": path, "apiPointer": pointer, "reason": reason,
               "xmlDeclaredId": node.get("id"), "apiDeclaredId": value.get("id") if type(value.get("id")) is str else None}
        links.append(row)
        if row["xmlDeclaredId"] and row["apiDeclaredId"]:
            ids.append({"xmlId": row["xmlDeclaredId"], "apiId": row["apiDeclaredId"],
                        "apiScope": _scope_for_id(pointer), "reason": reason, "basis": "explicit_record_link"})
    for row in plan.get("idLinks", []):
        if row.get("studyIndex") != study_index:
            continue
        if any(not isinstance(row.get(k), str) or not row[k].strip() for k in ("xmlId", "apiId", "reason")):
            raise PrsError("ID links require explicit XML ID, API ID and reason.", "RECORD_LINK")
        scope = row.get("apiScope")
        if not isinstance(scope, str) or not isinstance(_at(native, scope), (dict, list)):
            raise PrsError("ID links need an existing native API scope.", "RECORD_LINK")
        declared = [n for n in study.iter() if isinstance(n.tag, str) and n.get("id") == row["xmlId"]]
        if len(declared) != 1:
            raise PrsError("An ID link must resolve one original XML declaration.", "RECORD_LINK")
        ids.append({**row, "basis": "explicit_id_link"})
    grouped = defaultdict(set)
    for row in ids:
        grouped[(row["xmlId"], row["apiScope"])].add(row["apiId"])
    if any(len(v) != 1 for v in grouped.values()):
        raise PrsError("Conflicting source-to-public group identity links.", "RECORD_LINK")
    return links, ids

def _public_entry(entry, field, side):
    out = {k: v for k, v in entry.items() if k != "_value"}
    out["normalised"] = _normalise(entry, field, side)
    return out

def _compare_values(left, right, field, ids):
    a, b = [_normalise(e, field, "xml") for e in left], [_normalise(e, field, "api") for e in right]
    if any(v["state"] == "invalid_type" for v in [*a, *b]):
        return {"equal": None, "status": "invalid_type"}
    if field["type"] == "reference":
        if len(a) != len(b):
            return {"equal": False, "status": "different"}
        for i, (x, y) in enumerate(zip(a, b)):
            if x.get("state") != "present" or y.get("state") != "present":
                if x != y:
                    return {"equal": False, "status": "different"}
                continue
            matches = [m for m in ids if m["xmlId"] == x.get("value")
                       and _pointer_prefix(m["apiScope"], right[i].get("apiPointer", ""))]
            if not matches:
                return {"equal": None, "status": "group_identity_link_required"}
            best_len = max(len(m["apiScope"]) for m in matches)
            mapped = {m["apiId"] for m in matches if len(m["apiScope"]) == best_len}
            if len(mapped) != 1:
                return {"equal": None, "status": "group_identity_ambiguous"}
            if y.get("value") not in mapped:
                return {"equal": False, "status": "different"}
        return {"equal": True, "status": "equivalent"}
    equal = a == b
    absent = all(v.get("state") == "missing" for v in [*a, *b])
    return {"equal": equal, "status": "both_absent" if equal and absent else "equivalent" if equal else "different"}

def _field_comparison(left, right, field, links, ids):
    if not field.get("repeated"):
        return {**_compare_values(left, right, field, ids), "matchBasis": "selected_typed_field"}
    present_left = [e for e in left if e["state"] not in ("missing", "empty_array")]
    present_right = [e for e in right if e["state"] not in ("missing", "empty_array")]
    if not present_left and not present_right:
        return {**_compare_values(left, right, field, ids), "matchBasis": "explicit_absence_states"}
    relevant = [link for link in links if any(_path_prefix(link["xmlPath"], e.get("path", [])) for e in present_left)
                or any(_pointer_prefix(link["apiPointer"], e.get("apiPointer", "")) for e in present_right)]
    if not relevant:
        comparison = _compare_values(left, right, field, ids)
        if field.get("requiresRecordLinks"):
            return {"equal": None, "status": "record_link_required", "matchBasis": "unlinked_original_records",
                    "orderedValueComparison": comparison}
        return {**comparison, "matchBasis": "original_document_order",
                "identityNote": "Ordered field equality retains occurrence order; it does not establish cross-array row identity."}
    batches = defaultdict(lambda: [[], []])
    unlinked = [[], []]
    for side, entries in enumerate((present_left, present_right)):
        for entry in entries:
            matching = [l for l in relevant if _path_prefix(l["xmlPath"], entry.get("path", []))] if side == 0 else [
                l for l in relevant if _pointer_prefix(l["apiPointer"], entry.get("apiPointer", ""))]
            if not matching:
                unlinked[side].append(entry)
                continue
            selected = max(matching, key=lambda l: len(l["xmlPath"]) if side == 0 else len(_tokens(l["apiPointer"])))
            batches[s.path_key(selected["xmlPath"])][side].append(entry)
    comparisons = []
    for key, (a, b) in batches.items():
        link = next(l for l in relevant if s.path_key(l["xmlPath"]) == key)
        comparisons.append({"link": link, **_compare_values(a, b, field, ids)})
    if any(unlinked):
        status, equal = "record_link_required", None
    elif any(c["equal"] is None for c in comparisons):
        status, equal = "unresolved_record_comparison", None
    else:
        equal = all(c["equal"] for c in comparisons)
        status = "equivalent" if equal else "different"
    return {"status": status, "equal": equal, "matchBasis": "explicit_source_record_links",
            "recordComparisons": comparisons,
            "unlinkedXmlPaths": [e.get("path") for e in unlinked[0]],
            "unlinkedApiPointers": [e.get("apiPointer") for e in unlinked[1]]}

def _effect(study, field, standalone):
    path = field["xmlPath"]
    result_name = "{" + s.RRS + "}result"
    if path[0] == result_name:
        result = study if standalone else next(iter(s.select_xml(study, (result_name,))), None)
        if result is not None and s.boolean_attribute(result, "partialUpload")["value"] is True:
            if len(path) > 1 and not s.select_xml(result, (path[1],)):
                return "retained_from_previous"
        if result is None and not standalone and s.boolean_attribute(study, "partial_upload")["value"] is True:
            return "retained_from_previous"
        return None
    if standalone:
        return "outside_standalone_results"
    if s.boolean_attribute(study, "partial_upload")["value"] is not True:
        return None
    nodes = s.select_xml(study, (path[0],))
    if not nodes:
        return "retained_from_previous"
    if path[0] == "id_info":
        if len(path) > 1 and path[1] == "secondary_id":
            entries = s.select_xml(nodes[0], ("secondary_id",))
            if not entries or all(s._empty(n) and s.boolean_attribute(n, "delete")["value"] is not True for n in entries):
                return "retained_from_previous"
            if any(s.boolean_attribute(n, "delete")["value"] is True for n in entries):
                return "deletion_requested"
        return None
    if any(s.boolean_attribute(n, "delete")["value"] is True for n in nodes):
        return "deletion_requested"
    if all(s._empty(n) for n in nodes):
        return "retained_from_previous"
    if path[0] not in s.PROTOCOL_PARTIAL_UNITS:
        return "unresolved_source_semantics"
    return None

def _xml_leaves(study):
    for node in study.iter():
        if not isinstance(node.tag, str):
            continue
        if not s.children(node):
            yield {"path": s.path_of(node), "line": node.sourceline, "value": s.text_value(node)}
        for name, value in node.attrib.items():
            yield {"path": [*s.path_of(node), {"attribute": name}], "line": node.sourceline, "value": value}

def _api_leaves(value, tokens=()):
    if isinstance(value, dict) and value:
        for key, item in value.items():
            yield from _api_leaves(item, (*tokens, key))
    elif isinstance(value, list) and value:
        for i, item in enumerate(value):
            yield from _api_leaves(item, (*tokens, i))
    else:
        yield {"apiPointer": _pointer(tokens), "raw": _raw(value)}

def reconcile(xml_bytes, api_records, plan, schema_dir=None):
    if not isinstance(plan, dict) or not isinstance(api_records, list):
        raise PrsError("Reconciliation requires an explicit plan object and original API record array.", "RECONCILE_PLAN")
    data = s.xml_bytes(xml_bytes)
    doc = s.parse_document(data)
    standalone = doc.getroot().tag == "{" + s.RRS + "}result"
    source_kind = "results" if standalone else "protocol"
    inspection = s.inspect(data, source_kind, schema_dir)
    studies = [doc.getroot()] if standalone else s.study_nodes(doc)
    if not studies:
        raise PrsError("Reconciliation requires PRS studies or one standalone RRS result.", "RECONCILE_SOURCE")
    profile = catalog(schema_dir)
    fields = {f["id"]: f for f in profile["fields"]}
    selected_ids = plan.get("fieldIds", [f["id"] for f in profile["fields"] if not standalone or f["section"] == "results"])
    if not isinstance(selected_ids, list) or any(k not in fields for k in selected_ids) or len(set(selected_ids)) != len(selected_ids):
        raise PrsError("fieldIds must select unique IDs from catalog().", "RECONCILE_FIELDS")
    if plan.get("inputSha256") and plan["inputSha256"] != s.sha256(data):
        raise PrsError("Reconciliation plan belongs to different XML bytes.", "PLAN_SOURCE")
    records, source_rows = {}, []
    for index, record in enumerate(api_records):
        if not isinstance(record, dict) or not isinstance(record.get("source", {}), dict):
            raise PrsError("Each API record requires rawJson and source metadata.", "JSON_SOURCE")
        native, original = parse_native_json(record.get("rawJson"))
        entries = _api_entries(native, ("protocolSection", "identificationModule", "nctId"))
        nct = entries[0]["_value"]
        if entries[0]["state"] != "present" or type(nct) is not str or not re.fullmatch(r"NCT[0-9]{8}", nct):
            raise PrsError("The original study must carry its own native NCT identifier.", "JSON_IDENTITY", {"recordIndex": index})
        if nct in records:
            raise PrsError("Select one exact retained edition for each NCT identifier.", "JSON_IDENTITY", {"nctId": nct})
        row = {"recordIndex": index, "nctId": nct, "inputSha256": s.sha256(original), "bytes": len(original),
               "source": record.get("source", {})}
        if row["source"].get("sha256") and row["source"]["sha256"] != row["inputSha256"]:
            raise PrsError("The retained API source hash differs from rawJson bytes.", "JSON_HASH", row)
        records[nct] = (native, row)
        source_rows.append(row)
    study_links = plan.get("studyLinks", [])
    if not isinstance(study_links, list):
        raise PrsError("studyLinks must be an array.", "STUDY_LINK")
    linked_indexes, linked_ncts, findings, joins = set(), set(), [], []
    decision_map = {}
    decisions = plan.get("decisions", [])
    if not isinstance(decisions, list):
        raise PrsError("decisions must be an array.", "RECONCILE_REVIEW")
    if decisions and (not isinstance(plan.get("reviewer"), str) or not plan["reviewer"].strip()):
        raise PrsError("Reconciliation dispositions require their actual reviewer.", "RECONCILE_REVIEW")
    for d in decisions:
        if not isinstance(d, dict) or d.get("findingId") in decision_map or d.get("decision") not in (
                "accept_difference", "revise_xml", "revise_source", "investigate", "accept_equivalence"):
            raise PrsError("Each finding disposition must have one supported explicit decision.", "RECONCILE_REVIEW")
        if not isinstance(d.get("note"), str) or not d["note"].strip():
            raise PrsError("A reconciliation disposition needs its source-aware note.", "RECONCILE_REVIEW")
        decision_map[d["findingId"]] = d
    for link in study_links:
        if not isinstance(link, dict):
            raise PrsError("Each study link must be an object.", "STUDY_LINK")
        index, nct, reason = link.get("studyIndex"), link.get("nctId"), link.get("reason")
        if not isinstance(index, int) or isinstance(index, bool) or not 1 <= index <= len(studies) or index in linked_indexes:
            raise PrsError("Study links select one unique original 1-based XML study index.", "STUDY_LINK")
        if nct not in records or not isinstance(reason, str) or not reason.strip():
            raise PrsError("Study links need a retained native NCT record and explicit reason.", "STUDY_LINK")
        linked_indexes.add(index); linked_ncts.add(nct)
        study, (native, source_row) = studies[index - 1], records[nct]
        record_links, id_links = _record_links(index, study, native, doc, plan)
        linked_findings, mapped_xml, mapped_api = [], set(), set()
        for ident in selected_ids:
            field = fields[ident]
            left, right = _xml_entries(study, field, standalone=standalone), _api_entries(native, field["apiPath"])
            mapped_xml.update(s.path_key(e["path"]) for e in left if e.get("path"))
            mapped_api.update(e["apiPointer"] for e in right if e["state"] != "missing")
            result = _field_comparison(left, right, field, record_links, id_links)
            effect = _effect(study, field, standalone)
            if effect:
                result = {"equal": None, "status": effect, "observedValueComparison": result,
                          "matchBasis": "original_upload_scope"}
            finding = {
                "studyIndex": index, "nctId": nct, "fieldId": ident, "label": field["label"],
                "type": field["type"], "xmlPath": field["xmlPath"], "apiPath": field["apiPath"],
                "xml": [_public_entry(e, field, "xml") for e in left],
                "api": [_public_entry(e, field, "api") for e in right],
                **result,
            }
            finding["findingId"] = "finding-" + s.digest({"xmlSha256": s.sha256(data),
                "apiSha256": source_row["inputSha256"], "profileSha256": profile["profileSha256"],
                "studyIndex": index, "fieldId": ident, "recordLinks": record_links, "idLinks": id_links,
                "result": finding})[:32]
            if finding["findingId"] in decision_map:
                finding["review"] = decision_map[finding["findingId"]]
            linked_findings.append(finding); findings.append(finding)
        unmapped_xml = [e for e in _xml_leaves(study) if s.path_key(e["path"]) not in mapped_xml]
        unmapped_api = [e for e in _api_leaves(native) if not any(_pointer_prefix(p, e["apiPointer"]) for p in mapped_api)]
        joins.append({"studyIndex": index, "nctId": nct, "reason": reason,
                      "xmlIdentity": None if standalone else s.identity(study),
                      "apiSource": source_row, "recordLinks": record_links, "idLinks": id_links,
                      "findingIds": [r["findingId"] for r in linked_findings],
                      "unmappedXml": unmapped_xml, "unmappedApi": unmapped_api})
    known_ids = {f["findingId"] for f in findings}
    if set(decision_map) - known_ids:
        raise PrsError("A review disposition belongs to a different source/profile/link selection.",
                       "RECONCILE_REVIEW", {"unknownFindingIds": sorted(set(decision_map) - known_ids)})
    statuses = dict(Counter(f["status"] for f in findings))
    result = {
        "schema": "stellar-forge.prs-reconciliation.v1", "inputSha256": s.sha256(data),
        "schemaKind": source_kind, "inspection": inspection, "schemaSources": profile["schemaSources"],
        "profileId": profile["id"], "profileSha256": profile["profileSha256"],
        "schemaSetSha256": profile["schemaSetSha256"], "selectedFieldIds": selected_ids,
        "apiSources": source_rows, "studyLinks": joins, "findings": findings,
        "summary": {"linkedStudies": len(joins), "findingCount": len(findings), "statuses": statuses,
                    "reviewedFindings": sum("review" in f for f in findings)},
        "unlinkedXmlStudies": [{"studyIndex": i, "identity": None if standalone else s.identity(n)}
                               for i, n in enumerate(studies, 1) if i not in linked_indexes],
        "unlinkedApiSources": [r for r in source_rows if r["nctId"] not in linked_ncts],
        "reviewer": plan.get("reviewer", ""), "rationale": plan.get("rationale", ""),
        "plan": plan, "notes": profile["notes"],
    }
    result["reportSha256"] = s.digest(result)
    return result

"""Exact component verification and analysis over original SensorThings documents.

This module has no storage, network, workspace or job implementation. The existing
sensorthings_analysis programme owns all imports, queries, workbooks and receiving.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from decimal import Decimal, localcontext
from fractions import Fraction
import hashlib
import json
import math
import re
from urllib.parse import quote, unquote, urljoin, urlsplit

from .errors import StateError

INTAKE_SCHEMA = "stellar-forge.sensorthings-python-component-intake.v1"
BINDINGS_SCHEMA = "stellar-forge.sensorthings-python-component-bindings.v1"
TABLES = ("selected_components", "component_index", "component_eligibility", "component_bindings")
OM = "http://www.opengis.net/def/observationType/OGC-OM/2.0/"
_OM_TYPES = {OM + name for name in ("OM_CategoryObservation", "OM_CountObservation",
                                   "OM_Measurement", "OM_Observation", "OM_TruthObservation")}
_HASH = re.compile(r"[a-f0-9]{64}")
_NUMBER = re.compile(r"(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?")
_UTC = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})\.([0-9]{9})Z")
_MISSING = object()
_METHOD = "original-componentExactEligibility+componentNumericEligibility"


def _need(condition, code):
    if not condition:
        raise StateError("SENSORTHINGS_COMPONENT_" + code)


class _Number(str):
    """An original JSON numeric token, never a browser float."""


def _reject_constant(value):
    raise ValueError("Non-JSON numeric constant: " + value)


def _pairs(pairs):
    value = {}
    for key, item in pairs:
        _need(key not in value, "DUPLICATE_JSON_MEMBER")
        value[key] = item
    return value


def _loads(text):
    return json.loads(text, parse_int=_Number, parse_float=_Number,
                      parse_constant=_reject_constant, object_pairs_hook=_pairs)


def _quote(value):
    # JSON.stringify emits real Unicode except unpaired surrogates.
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return "".join(("\\u%04x" % ord(c)) if 0xD800 <= ord(c) <= 0xDFFF else c for c in encoded)


def _keys(value, canonical):
    # JavaScript own-key order places array-index names before other names,
    # including when its canonicalizer inserted lexically sorted properties.
    indices, others = [], []
    for key in value:
        _need(isinstance(key, str), "JSON_KEY")
        if re.fullmatch(r"0|[1-9][0-9]{0,9}", key) and int(key) < 4294967295:
            indices.append(key)
        else:
            others.append(key)
    indices.sort(key=int)
    if canonical:
        others.sort(key=lambda x: x.encode("utf-16-be", "surrogatepass"))
    return indices + others


def _emit(value, canonical=False):
    if isinstance(value, _Number):
        _need(_NUMBER.fullmatch(value), "JSON_NUMBER")
        return str(value)
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _quote(value)
    if type(value) is int:
        return _intstr(value)
    if isinstance(value, list):
        return "[" + ",".join(_emit(x, canonical) for x in value) + "]"
    _need(isinstance(value, dict), "LOSSLESS_JSON_REQUIRED")
    return "{" + ",".join(_quote(k) + ":" + _emit(value[k], canonical)
                          for k in _keys(value, canonical)) + "}"


def _identity(value):
    return hashlib.sha256(_emit(value, True).encode("utf-8")).hexdigest()


def _same(left, right):
    return _emit(left, True) == _emit(right, True)


def _intstr(value):
    # Do not change the process-wide integer conversion limit. Source exact
    # arithmetic can legitimately exceed 4,300 decimal digits.
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    value = abs(value)
    chunks = []
    while value:
        value, tail = divmod(value, 1000000000)
        chunks.append(tail)
    return sign + str(chunks[-1]) + "".join(str(x).zfill(9) for x in reversed(chunks[:-1]))


def _fraction(value):
    return _intstr(value.numerator) + "/" + _intstr(value.denominator)


def _cell(value):
    if value is _MISSING:
        return {"state": "missing", "type": "missing", "value": ""}
    if value is None:
        return {"state": "null", "type": "null", "value": ""}
    if isinstance(value, _Number):
        return {"state": "value", "type": "number", "value": str(value)}
    kind = ("string" if isinstance(value, str) else "array" if isinstance(value, list)
            else "boolean" if type(value) is bool else "object")
    return {"state": "value", "type": kind,
            "value": value if kind == "string" else _emit(value)}


def _canonical_number(text):
    _need(isinstance(text, str) and len(text) <= 4096, "NUMBER_CAPACITY")
    match = _NUMBER.fullmatch(text)
    _need(match is not None, "JSON_NUMBER")
    sign, whole, fraction, exponent = match.groups()
    fraction = fraction or ""
    coefficient = (whole + fraction).lstrip("0")
    if not coefficient:
        return "0", 0
    power = int(exponent or "0") - len(fraction)
    trimmed = len(coefficient) - len(coefficient.rstrip("0"))
    coefficient = coefficient.rstrip("0")
    power += trimmed
    return sign + coefficient, power


def eligibility(row):
    """Recheck both declared source-owned classifiers without aggregating floats."""
    reason = None
    if row["component_alignment"] != "aligned":
        reason = "original_component_alignment_unresolved"
    elif row["result_state"] != "value" or row["result_type"] != "number":
        reason = "not_an_original_json_number"
    elif (row["component_interpretation"] == "source-declared" and
          row["component_observation_type"] not in {OM + "OM_Measurement", OM + "OM_CountObservation"}):
        reason = "component_type_not_declared_numeric"
    elif row["component_interpretation"] not in {"source-declared", "numeric-json"}:
        reason = "component_interpretation_unavailable"
    elif row["phenomenon_time_kind"] != "explicit_instant":
        reason = "phenomenon_time_not_an_explicit_instant"
    coefficient, exponent = "0", 0
    if reason is None:
        try:
            coefficient, exponent = _canonical_number(row["result"])
        except (ValueError, StateError):
            reason = "invalid_original_number"
    if (reason is None and row["component_interpretation"] == "source-declared" and
        row["component_observation_type"] == OM + "OM_CountObservation" and
        coefficient != "0" and exponent < 0):
        reason = "declared_count_is_not_integral"
    if reason:
        return {"exact_eligible": "false", "exact_reason": reason,
                "browser_eligible": "false", "browser_reason": reason}
    exact_reason = ("outside_exact_decimal_exponent_range"
                    if exponent < -4096 or exponent > 4096 else "eligible")
    try:
        plotted = float(row["result"])
    except (ValueError, OverflowError):
        plotted = math.inf
    browser_reason = ("outside_finite_browser_range" if not math.isfinite(plotted)
                      else "nonzero_result_underflows_in_browser"
                      if plotted == 0 and coefficient != "0" else "eligible")
    return {"exact_eligible": str(exact_reason == "eligible").lower(), "exact_reason": exact_reason,
            "browser_eligible": str(browser_reason == "eligible").lower(), "browser_reason": browser_reason}


def _selected(parent, selection):
    if not selection["period"]:
        return True
    period = selection["period"]
    start, end = parent["phenomenon_start_utc"], parent["phenomenon_end_utc"]
    kind = parent["phenomenon_time_kind"]
    if not start or kind not in {"explicit_instant", "explicit_interval"}:
        return True
    if kind == "explicit_interval":
        return start < period["endUtc"] and end > period["startUtc"]
    return start >= period["startUtc"] and start < period["endUtc"]


def _unit_valid(value):
    return isinstance(value, dict) and all(
        name in value and (value[name] is None or
                           isinstance(value[name], str) and not isinstance(value[name], _Number))
        for name in ("name", "symbol", "definition"))


def _browser_json_projection(value):
    """The existing descriptor display uses JSON.parse/JSON.stringify.
    Preserve that explicit display view while original sourceJson stays exact.
    """
    if isinstance(value, _Number):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, list):
        return [_browser_json_projection(x) for x in value]
    if isinstance(value, dict):
        return {k: _browser_json_projection(v) for k, v in value.items()}
    return value


_RELATIONSHIPS = (
    ("Thing", "Things"), ("Sensor", "Sensors"),
    ("ObservedProperty", "ObservedProperties"), ("ObservedProperties", "ObservedProperties"),
    ("Locations", "Locations"), ("HistoricalLocations", "HistoricalLocations"),
    ("FeatureOfInterest", "FeaturesOfInterest"), ("Datastream", "Datastreams"),
    ("MultiDatastream", "MultiDatastreams"))
_ROOT_POINTER = re.compile(r"/value/(0|[1-9][0-9]*)")


def _source_url(value, source, base=None):
    """Resolve retained HTTP(S) links only; this function never performs I/O.

    Match the original sourceURL scope and the HTTP URL normalization used by
    graphIndex. Invalid/out-of-scope links remain unresolvable source evidence.
    """
    def canonical(raw, against=None):
        _need(isinstance(raw, str) and not isinstance(raw, _Number) and
              0 < len(raw.encode("utf-16-le", "surrogatepass")) // 2 <= 16384 and
              raw.strip() and not re.search(r"[\x00-\x1f\x7f]", raw), "SOURCE_LINK")
        # For special HTTP URLs, a literal backslash is a path separator.
        # Encoded backslashes are still rejected by the decoded scope check.
        raw = raw.strip(" ")
        before, separator, after = raw.partition("?")
        raw = before.replace("\\", "/") + (separator + after if separator else "")
        joined = urljoin(against, raw) if against is not None else raw
        parts = urlsplit(joined)
        _need(parts.scheme.lower() in {"http", "https"} and parts.hostname and
              parts.username is None and parts.password is None and "#" not in joined,
              "SOURCE_LINK")
        scheme = parts.scheme.lower()
        host = parts.hostname.lower()
        host = ("[" + host + "]") if ":" in host else host.encode("idna").decode("ascii")
        port = parts.port
        origin = scheme + "://" + host + (
            ":" + str(port) if port is not None and port != (443 if scheme == "https" else 80) else "")
        path = parts.path or "/"
        # WHATWG special URLs remove dot segments, including their percent
        # encoded spellings. Preserve every other original escaped path byte.
        segments = []
        source_segments = path.split("/")
        for ordinal, segment in enumerate(source_segments):
            dots = re.sub(r"(?i)%2e", ".", segment)
            if dots == ".":
                if ordinal == len(source_segments) - 1:
                    segments.append("")
                continue
            if dots == "..":
                if len(segments) > 1:
                    segments.pop()
                if ordinal == len(source_segments) - 1:
                    segments.append("")
                continue
            segments.append(segment)
        path = "/".join(segments) or "/"
        path = quote(path, safe="/!$&'()*+,-.:;=@_~%[]|")
        query = quote(parts.query, safe="!$&()*+,-./:;=?@_~%[]|\\^`{}")
        query_present = "?" in joined
        return origin + path + (("?" + query) if query_present else ""), origin, path
    try:
        root_url, root_origin, root_path = canonical(source["serviceUrl"])
        url, origin, path = canonical(value, base if base is not None else root_url)
        _need(not re.search(r"%(?![0-9a-fA-F]{2})", path + root_path), "SOURCE_LINK")
        decoded, root_decoded = unquote(path, errors="strict"), unquote(root_path, errors="strict")
        _need(origin == root_origin and
              (decoded == root_decoded.rstrip("/") or decoded.startswith(root_decoded)) and
              not any(piece in {".", ".."} for piece in decoded.split("/")) and
              not re.search(r"[\x00-\x1f\x7f\\]", decoded), "SOURCE_LINK")
        return url
    except (KeyError, ValueError, UnicodeError, StateError):
        return None


def _retained_graph(document, edition):
    """Rebuild graphIndex from retained roots, not the supplied binding order.

    Page order comes from the immutable edition. Root ordinals come from
    /value/N pointers, and nested relation order comes from each original
    entity JSON. Table row order and membership alone confer no relation.
    """
    by_occurrence, roots_by_hash = {}, defaultdict(list)
    for row in document["entities"]:
        occurrence = row["occurrence_id"]
        _need(occurrence not in by_occurrence, "ENTITY_OCCURRENCE_REPEATED")
        by_occurrence[occurrence] = row
        if row["source_pointer"] == "" or _ROOT_POINTER.fullmatch(row["source_pointer"]):
            roots_by_hash[row["source_page_sha256"]].append(row)
    urls, streams = defaultdict(list), {}
    def walk(record, kind, pointer, depth=0):
        if not isinstance(record, dict) or depth > 8:
            return
        yield record, kind, pointer
        for name, next_kind in _RELATIONSHIPS:
            child = record.get(name)
            child_pointer = pointer + "/" + name.replace("~", "~0").replace("/", "~1")
            if isinstance(child, list):
                for ordinal, value in enumerate(child):
                    yield from walk(value, next_kind, child_pointer + "/" + str(ordinal), depth + 1)
            elif isinstance(child, dict):
                yield from walk(child, next_kind, child_pointer, depth + 1)
    for page in edition["pages"]:
        if page["kind"] == "Observations" or page["phase"] == "stream-end":
            continue
        receipt = page["receipt"]
        captured = receipt.get("sourceCapturedAt")
        if captured is None:
            captured = receipt["completedAt"]
        roots = []
        for row in roots_by_hash.get(receipt["sha256"], []):
            pointer = row["source_pointer"]
            if (row["entity_kind"] != page["kind"] or row["capture_phase"] != page["phase"] or
                bool(_ROOT_POINTER.fullmatch(pointer)) != bool(page.get("collection"))):
                continue
            expected_id = _identity({"taskId": page["taskId"], "sha256": receipt["sha256"],
                                     "pointer": pointer})
            if row["occurrence_id"] == expected_id:
                roots.append(row)
        roots.sort(key=lambda row: int(row["source_pointer"].rsplit("/", 1)[-1])
                   if page.get("collection") else 0)
        for root in roots:
            for record, kind, pointer in walk(_loads(root["entity_json"]), page["kind"],
                                              root["source_pointer"]):
                occurrence = _identity({"taskId": page["taskId"], "sha256": receipt["sha256"],
                                        "pointer": pointer})
                row = by_occurrence.get(occurrence)
                _need(row is not None and row["entity_kind"] == kind and
                      row["source_page_sha256"] == receipt["sha256"] and
                      row["source_pointer"] == pointer and row["capture_phase"] == page["phase"] and
                      row["source_observed_at"] == captured and row["entity_json"] == _emit(record),
                      "ENTITY_ROOT_RELATION_CHANGED")
                ref = {"sha256": receipt["sha256"], "bytes": receipt["bytes"],
                       "jsonPointer": pointer, "requestId": receipt["requestId"],
                       "url": page["url"], "capturedAt": captured}
                item = {"record": record, "kind": kind, "page": page, "sourceRef": ref}
                keys = []
                link = record.get("@iot.selfLink")
                if isinstance(link, str) and not isinstance(link, _Number):
                    resolved = _source_url(link, edition["source"], page["url"])
                    if resolved is not None:
                        keys.append(resolved)
                if pointer == "" or _ROOT_POINTER.fullmatch(pointer):
                    keys.extend([page["url"] if page.get("originUrl") is None else page["originUrl"],
                                 page["url"]])
                for key in dict.fromkeys(keys):
                    urls[key].append(item)
                if page["phase"] == "stream-start" and pointer == "":
                    streams[page["streamKey"]] = item
    def relation(item, name):
        inline = item["record"].get(name)
        if isinstance(inline, list):
            return [{"record": record, "kind": dict(_RELATIONSHIPS)[name], "page": item["page"],
                     "sourceRef": {**item["sourceRef"],
                                   "jsonPointer": item["sourceRef"]["jsonPointer"] + "/" + name + "/" + str(i)}}
                    for i, record in enumerate(inline)]
        if isinstance(inline, dict):
            return [{"record": inline, "kind": dict(_RELATIONSHIPS)[name], "page": item["page"],
                     "sourceRef": {**item["sourceRef"],
                                   "jsonPointer": item["sourceRef"]["jsonPointer"] + "/" + name}}]
        link = item["record"].get(name + "@iot.navigationLink")
        if not isinstance(link, str) or isinstance(link, _Number):
            return []
        base = item["page"]["url"]
        self_link = item["record"].get("@iot.selfLink")
        if isinstance(self_link, str) and not isinstance(self_link, _Number):
            base = _source_url(self_link, edition["source"], base)
            if base is None:
                return []
        resolved = _source_url(link, edition["source"], base)
        return urls.get(resolved, []) if resolved is not None else []
    return streams, relation


def _binding(item, edition, entity_index, raw_item, original_streams, original_relation):
    choice, descriptor = item["choice"], item["descriptor"]
    binding_text = item["bindingJson"]
    _need(isinstance(binding_text, str) and
          hashlib.sha256(binding_text.encode()).hexdigest() == choice["bindingId"] == descriptor["bindingId"],
          "BINDING_IDENTITY_CHANGED")
    binding = _loads(binding_text)
    _need(_same(binding, _loads(_emit(descriptor["binding"]))) and
          binding["schema"] == "stellar-forge.sensorthings-component-selection.v1" and
          binding["sourceIdentity"] == {"kind": "native-edition", "id": edition["id"]},
          "NATIVE_BINDING_CHANGED")
    index = int(choice["index"])
    _need(str(index) == str(choice["index"]) and 0 <= index <= 4095 and
          int(binding["index"]) == index == int(descriptor["index"]), "POSITION_CHANGED")
    plan = next((x for x in edition["plan"]["streams"] if x["key"] == choice["streamKey"]), None)
    _need(plan is not None and plan["kind"] == "MultiDatastreams" and
          binding["streamKey"] == plan["key"] and _same(binding["streamId"], plan["id"]),
          "ORIGINAL_STREAM_CHANGED")
    source = binding["streamSourceRef"]
    original = binding["streamSourceJson"]
    candidates = entity_index.get((source["sha256"], source["jsonPointer"]), [])
    _need(any(x["entity_kind"] == "MultiDatastreams" and x["capture_phase"] == "stream-start" and
              x["entity_json"] == original for x in candidates), "STREAM_SOURCE_NOT_RETAINED")
    actual_stream = original_streams.get(plan["key"])
    _need(actual_stream is not None and actual_stream["kind"] == "MultiDatastreams" and
          _emit(actual_stream["record"]) == original and
          _same(actual_stream["sourceRef"], source), "SELECTED_STREAM_SOURCE_CHANGED")
    stream = _loads(original)
    properties = binding["orderedProperties"]
    actual_properties = [{"sourceJson": _emit(prop["record"]), "sourceRef": prop["sourceRef"]}
                         for prop in original_relation(actual_stream, "ObservedProperties")]
    _need(_same(properties, actual_properties), "ORIGINAL_PROPERTY_RELATION_ORDER_CHANGED")
    for prop in properties:
        ref = prop["sourceRef"]
        _need(any(x["entity_kind"] == "ObservedProperties" and x["entity_json"] == prop["sourceJson"]
                  for x in entity_index.get((ref["sha256"], ref["jsonPointer"]), [])),
              "ORDERED_PROPERTY_SOURCE_NOT_RETAINED")
    units = stream.get("unitOfMeasurements")
    kinds = stream.get("multiObservationDataTypes")
    units_array, types_array = isinstance(units, list), isinstance(kinds, list)
    units, kinds = units if units_array else [], kinds if types_array else []
    counts = {"properties": len(properties), "units": len(units), "types": len(kinds)}
    aligned = len(units) == len(kinds) == len(properties) and bool(properties)
    unit, declared = (units[index] if index < len(units) else _MISSING,
                      kinds[index] if index < len(kinds) else _MISSING)
    prop = properties[index] if index < len(properties) else None
    issues = []
    if not units_array:
        issues.append("COMPONENT_UNITS_NOT_ARRAY")
    if not types_array:
        issues.append("COMPONENT_TYPES_NOT_ARRAY")
    if stream.get("observationType") != OM + "OM_ComplexObservation":
        issues.append("COMPLEX_OBSERVATION_TYPE_NOT_DECLARED")
    if not properties:
        issues.append("COMPONENT_PROPERTIES_UNAVAILABLE")
    if not aligned:
        issues.append("COMPONENT_METADATA_LENGTH_MISMATCH")
    if prop is None or not isinstance(_loads(prop["sourceJson"]), dict):
        issues.append("COMPONENT_PROPERTY_UNAVAILABLE")
    if not _unit_valid(unit):
        issues.append("COMPONENT_UNIT_DECLARATION_MALFORMED")
    if not (isinstance(declared, str) and not isinstance(declared, _Number) and declared in _OM_TYPES):
        issues.append("COMPONENT_TYPE_NOT_TABLE12_VALUE")
    meaning = {"index": index, "propertyJson": prop["sourceJson"] if prop else None,
               "unit": _cell(unit), "declaredType": _cell(declared),
               "complexObservationType": _cell(stream.get("observationType", _MISSING)),
               "metadataCounts": counts}
    meaning_id = _identity(meaning)
    series = "component-" + _identity({"streamKey": plan["key"], "index": index,
                                       "meaningId": meaning_id})[:40]
    _need(binding["meaningId"] == descriptor["meaningId"] == meaning_id and
          descriptor["seriesKey"] == series and descriptor["metadataAligned"] == aligned and
          int(descriptor["declaredComponentCount"]) == len(units) and
          descriptor["issues"] == issues and descriptor["unitState"] == _cell(unit)["state"] and
          descriptor["unitJson"] == (None if unit is _MISSING else _emit(unit)) and
          descriptor["declaredTypeState"] == _cell(declared)["state"] and
          _same(raw_item["descriptor"]["declaredType"], None if declared is _MISSING else declared),
          "COMPONENT_MEANING_CHANGED")
    if prop is None:
        _need(descriptor["property"] is None, "COMPONENT_PROPERTY_CHANGED")
    else:
        _need(descriptor["property"]["sourceJson"] == prop["sourceJson"] and
              descriptor["property"]["entity"] == _browser_json_projection(_loads(prop["sourceJson"])) and
              _same(descriptor["property"]["sourceRef"], prop["sourceRef"]),
              "COMPONENT_PROPERTY_CHANGED")
    interpretation = choice["interpretation"]
    acknowledged = interpretation["acknowledgedIssues"]
    _need(interpretation["mode"] in {"source-declared", "numeric-json"} and
          isinstance(interpretation["note"], str) and len(interpretation["note"]) <= 8000 and
          len(set(acknowledged)) == len(acknowledged) and all(x in issues for x in acknowledged),
          "INTERPRETATION_CHANGED")
    if interpretation["mode"] == "numeric-json":
        _need(interpretation["note"].strip() and aligned and prop is not None and
              unit is not _MISSING and all(x in acknowledged for x in issues),
              "EXPLICIT_NUMERIC_INTERPRETATION_REQUIRED")
    prop_record = _loads(prop["sourceJson"]) if prop else {}
    prop_name = prop_record.get("name")
    expected_name = (prop_name if isinstance(prop_name, str) and not isinstance(prop_name, _Number)
                     else "Component " + str(index))
    _need(descriptor["name"] == expected_name and
          descriptor["declaredTypeRecognized"] == (isinstance(declared, str) and declared in _OM_TYPES) and
          descriptor["numericTypeDeclared"] == (declared in {OM + "OM_Measurement", OM + "OM_CountObservation"}
                                                if isinstance(declared, str) else False),
          "COMPONENT_DISPLAY_MEANING_CHANGED")
    _need(item["stream"]["sourceJson"] == original and
          _same(item["stream"]["sourceRef"], source) and
          item["stream"]["streamKey"] == plan["key"] and
          _same(item["stream"]["streamId"], plan["id"]) and
          item["stream"]["sourceIdentity"] == {"kind": "native-edition", "id": edition["id"]},
          "STREAM_CONTEXT_CHANGED")
    return {"choice": choice, "descriptor": descriptor, "stream": item["stream"],
            "plan": plan, "index": index, "property": prop,
            "raw_descriptor": raw_item["descriptor"], "raw_stream": raw_item["stream"]}


def verify_component_document(intake, document, edition, version_bytes, binding_bytes, edition_bytes):
    """Validate complete component coverage and every value against retained raw rows."""
    retained_edition = _loads(edition_bytes)
    retained_edition_id = retained_edition.pop("id")
    _need(_identity(retained_edition) == retained_edition_id == edition["id"] and
          json.loads(edition_bytes) == edition, "RETAINED_EDITION_IDENTITY_CHANGED")
    version_raw, manifest_raw = _loads(version_bytes), _loads(binding_bytes)
    version = json.loads(version_bytes)
    manifest = json.loads(binding_bytes)
    selection = manifest["selection"]
    version_id = version_raw.pop("id")
    component = intake.get("componentAnalysis", {})
    _need(component.get("schema") == "stellar-forge.sensorthings-python-component-selection.v1" and
          component.get("editionId") == edition["id"] and
          _identity(version_raw) == version_id == version["id"] == component.get("analysisVersionId") and
          version["schema"] == "stellar-forge.sensorthings-analysis-version.v1" and
          version["editionId"] == intake["editionId"] == edition["id"] and
          manifest["schema"] == BINDINGS_SCHEMA and manifest["analysisVersionId"] == version_id and
          manifest["editionId"] == edition["id"] and
          version["projectId"] == manifest["projectId"] == component.get("projectId") and
          _identity(manifest_raw) == component.get("bindingManifestId") and
          version["selection"] == component.get("selection") == selection and
          component.get("tables") == list(TABLES), "SAVED_SELECTION_CHANGED")
    choices = selection.get("componentSelections")
    _need(isinstance(choices, list) and 1 <= len(choices) <= 80 and
          len({(x["streamKey"], x["index"]) for x in choices}) == len(choices) and
          len(manifest["bindings"]) == len(choices) and
          selection.get("componentPolicy") == "explicit-original-position" and
          selection.get("timeBasis") == "phenomenonTime" and
          selection.get("instantPolicy") == "events-only" and
          selection.get("intervalPolicy") == "source-explicit-only" and
          selection.get("unresolvedTimePolicy") == "retain-unplaced", "SELECTION_CONTRACT")
    entity_index = defaultdict(list)
    for entity in document["entities"]:
        entity_index[(entity["source_page_sha256"], entity["source_pointer"])].append(entity)
    original_streams, original_relation = _retained_graph(document, edition)
    bound = []
    for index, item in enumerate(manifest["bindings"]):
        _need(item["choice"] == choices[index], "CHOICE_ORDER_CHANGED")
        bound.append(_binding(item, edition, entity_index, manifest_raw["bindings"][index],
                              original_streams, original_relation))
    _need(component.get("bindingIds") == [b["descriptor"]["bindingId"] for b in bound],
          "ORDERED_BINDING_IDS_CHANGED")
    binding_rows = document["component_bindings"]
    _need(len(binding_rows) == len(bound), "BINDING_ROW_COVERAGE")
    for row, item in zip(binding_rows, bound):
        d, choice = item["descriptor"], item["choice"]
        expected = {"source_stream_key": choice["streamKey"], "component_series_key": d["seriesKey"],
                    "component_index": str(item["index"]), "component_binding_id": d["bindingId"],
                    "component_meaning_id": d["meaningId"], "component_name": d["name"]}
        # Compare complete JSON values independently of property serialization order.
        _need(all(row[k] == v for k, v in expected.items()) and
              _same(_loads(row["choice_json"]), _loads(json.dumps(choice, separators=(",", ":")))) and
              _same(_loads(row["descriptor_json"]), item["raw_descriptor"]) and
              hashlib.sha256(row["binding_json"].encode()).hexdigest() == d["bindingId"] and
              _same(_loads(row["stream_json"]), item["raw_stream"]),
              "BINDING_ROW_CHANGED")
    parents = {x["occurrence_id"]: x for x in document["observations"]}
    parent_index = {x["occurrence_id"]: x for x in document["observation_index"]}
    index_rows = {x["component_occurrence_id"]: x for x in document["component_index"]}
    eligible_rows = {x["component_occurrence_id"]: x for x in document["component_eligibility"]}
    rows = document["selected_components"]
    _need(len(index_rows) == len(document["component_index"]) == len(rows) and
          len(eligible_rows) == len(document["component_eligibility"]) == len(rows),
          "COMPONENT_OCCURRENCE_COVERAGE")
    expected_pairs = set()
    by_binding = {x["descriptor"]["bindingId"]: x for x in bound}
    for parent in parents.values():
        for item in bound:
            plan = item["plan"]
            if (parent["stream_kind"] == plan["kind"] and parent["stream_id_type"] == plan["id"]["type"] and
                parent["stream_id"] == plan["id"]["value"] and _selected(parent, selection)):
                expected_pairs.add((parent["occurrence_id"], item["descriptor"]["bindingId"]))
    _need(len(expected_pairs) == len(rows) <= 250000, "COMPLETE_SELECTED_COVERAGE")
    seen = set()
    overwritten = {"result", "result_state", "result_type", "observation_type",
                   "observed_property", "unit", "issues"}
    for row in rows:
        parent = parents.get(row["occurrence_id"])
        item = by_binding.get(row["component_binding_id"])
        _need(parent is not None and item is not None, "ORIGINAL_PARENT_REQUIRED")
        d, choice, index = item["descriptor"], item["choice"], item["index"]
        pair = (parent["occurrence_id"], d["bindingId"])
        _need(pair in expected_pairs and pair not in seen, "SELECTED_OCCURRENCE_CHANGED")
        seen.add(pair)
        _need(all(row[k] == value for k, value in parent.items() if k not in overwritten),
              "ORIGINAL_PARENT_CELL_CHANGED")
        original = _loads(parent["observation_json"])
        result = original.get("result", _MISSING)
        array = isinstance(result, list)
        supplied = array and index < len(result)
        value = result[index] if supplied else _MISSING
        cell = _cell(value) if array else {"state": "unavailable", "type": "unavailable", "value": ""}
        aligned = array and d["metadataAligned"] and len(result) == d["declaredComponentCount"]
        requested = parent["source_pointer"] + "/result/" + str(index)
        pointer_state = ("present" if supplied else "missing" if array else
                         "parent_not_array" if result is not _MISSING else "result_missing")
        pointer = requested if supplied else parent["source_pointer"] + ("/result" if result is not _MISSING else "")
        cid = _identity({"observationOccurrenceId": parent["occurrence_id"], "index": index, "bindingId": d["bindingId"]})
        property_value = ([{"entity": d["property"]["entity"],
                            "source": d["property"]["sourceRef"]}] if d["property"] else [])
        declared = d["declaredType"] if isinstance(d["declaredType"], str) else ""
        expected = {
            "source_result": parent["result"], "source_result_state": parent["result_state"],
            "source_result_type": parent["result_type"], "source_observation_type": parent["observation_type"],
            "source_observed_property": parent["observed_property"], "source_unit": parent["unit"],
            "result": cell["value"], "result_state": cell["state"], "result_type": cell["type"],
            "observation_type": declared, "unit": d["unitJson"] or "",
            "source_stream_key": choice["streamKey"], "component_series_key": d["seriesKey"],
            "component_index": str(index), "component_name": d["name"], "component_binding_id": d["bindingId"],
            "component_meaning_id": d["meaningId"], "component_occurrence_id": cid,
            "component_property": d["property"]["sourceJson"] if d["property"] else "",
            "component_unit": d["unitJson"] or "", "component_observation_type": declared,
            "component_value": cell["value"], "component_value_state": cell["state"],
            "component_value_type": cell["type"], "component_result_pointer": requested,
            "component_source_pointer": pointer, "component_pointer_state": pointer_state,
            "component_alignment": "aligned" if aligned else "unresolved",
            "component_interpretation": choice["interpretation"]["mode"],
            "component_interpretation_note": choice["interpretation"]["note"],
            "component_numeric_basis": ("explicit_original_json_number_interpretation"
                                       if choice["interpretation"]["mode"] == "numeric-json"
                                       else "original_declared_observation_type")}
        _need(all(row[k] == value for k, value in expected.items()), "PROJECTED_COMPONENT_CHANGED")
        _need(json.loads(row["observed_property"]) == property_value and
              json.loads(row["component_acknowledged_issues"]) == choice["interpretation"]["acknowledgedIssues"] and
              json.loads(row["component_declaration_issues"]) == d["issues"], "PROJECTED_METADATA_CHANGED")
        issues = list(dict.fromkeys([*json.loads(parent["issues"]), *d["issues"],
                  *([] if array else ["MULTIDATASTREAM_RESULT_NOT_ARRAY"]),
                  *(["SELECTED_COMPONENT_MISSING"] if array and not supplied else []),
                  *(["COMPONENT_RESULT_LENGTH_MISMATCH"] if array and not aligned else [])]))
        _need(json.loads(row["issues"]) == issues, "COMPONENT_ISSUES_CHANGED")
        semantic = _identity({"observation": {**original, "result": value if supplied else None},
                              "originalResultState": _cell(result)["state"],
                              "originalArrayLength": len(result) if array else None,
                              "componentMeaningId": d["meaningId"], "index": index, "value": cell,
                              "interpretation": choice["interpretation"]})
        pindex = parent_index[parent["occurrence_id"]]
        key = pindex["original_key"] + "/component/" + str(index) if pindex["original_key_state"] == "value" else ""
        expected_index = {
            "component_occurrence_id": cid, "parent_occurrence_id": parent["occurrence_id"],
            "original_key": key, "original_key_state": pindex["original_key_state"],
            "semantic_sha256": semantic, "parent_semantic_sha256": pindex["semantic_sha256"],
            "component_series_key": d["seriesKey"], "component_binding_id": d["bindingId"],
            "component_meaning_id": d["meaningId"], "source_stream_key": choice["streamKey"],
            "component_index": str(index), "source_page_sha256": parent["source_page_sha256"],
            "source_pointer": parent["source_pointer"], "component_source_pointer": pointer}
        _need(index_rows.get(cid) == expected_index, "SELECTED_IDENTITY_CHANGED")
        _need(eligible_rows.get(cid) == {"component_occurrence_id": cid, **eligibility(row), "method": _METHOD},
              "ELIGIBILITY_CHANGED")
    _need(seen == expected_pairs and set(index_rows) == set(eligible_rows) ==
          {row["component_occurrence_id"] for row in rows}, "COMPLETE_COMPONENT_COVERAGE")
    return {"schema": "stellar-forge.sensorthings-python-component-verification.v1",
            "analysis_version_id": version["id"], "project_id": version["projectId"],
            "binding_manifest_id": component["bindingManifestId"], "selection": selection,
            "bindings": [{k: v for k, v in item.items() if not k.startswith("raw_")} for item in bound],
            "selected_occurrences": len(rows), "complete_parent_binding": True,
            "source_rows_changed": False}


_CONTEXT = ["edition_label", "edition_id", "analysis_version_id", "source_stream_key",
            "component_series_key", "component_index", "component_name",
            "component_binding_id", "component_meaning_id"]
_TABLE_COLUMNS = {
    "component_inventory": [*_CONTEXT, "interpretation", "interpretation_note", "acknowledged_issues",
        "declaration_issues", "original_type", "original_property", "original_unit", "metadata_aligned",
        "retained_selected_occurrences", "exact_numeric_occurrences", "browser_numeric_occurrences",
        "selected_period_json", "source_query_json", "source_complete", "source_archive_sha256"],
    "component_exact_statistics": [*_CONTEXT, "original_type", "original_property", "original_unit",
        "eligible_occurrences", "minimum_original_literal", "maximum_original_literal", "sum_fraction",
        "mean_fraction", "mean_decimal_34", "median_fraction", "first_source_time", "last_source_time", "method"],
    "component_time_summary": [*_CONTEXT, "retained_occurrences", "explicit_instant_occurrences",
        "explicit_interval_occurrences", "unplaced_occurrences", "distinct_instants",
        "duplicate_instants", "extra_coincident_occurrences", "first_source_instant", "last_source_instant",
        "observed_span_nanoseconds", "inter_instant_separations", "maximum_separation_nanoseconds",
        "maximum_separation_seconds_fraction", "coverage_interpretation"],
    "component_duplicate_instants": [*_CONTEXT, "source_instant", "retained_occurrences",
        "original_occurrences_json", "meaning"],
    "component_separations": [*_CONTEXT, "left_source_instant", "right_source_instant",
        "elapsed_nanoseconds", "elapsed_seconds_fraction", "left_occurrences", "right_occurrences",
        "left_originals_json", "right_originals_json", "meaning"],
    "component_separation_counts": [*_CONTEXT, "elapsed_nanoseconds", "elapsed_seconds_fraction",
        "observed_separations", "meaning"],
    "component_category_counts": [*_CONTEXT, "original_type", "result_state", "result_type",
        "result", "retained_occurrences", "meaning"],
    "component_category_changes": [*_CONTEXT, "left_source_instant", "right_source_instant",
        "left_result_type", "left_result", "right_result_type", "right_result",
        "left_original_json", "right_original_json", "meaning"],
    "component_quality_counts": [*_CONTEXT, "result_quality_state", "result_quality",
        "result_state", "result_type", "phenomenon_time_kind", "component_alignment", "issues",
        "retained_occurrences", "meaning"],
    "component_eligibility_counts": [*_CONTEXT, "exact_eligible", "exact_reason", "browser_eligible",
        "browser_reason", "retained_occurrences", "method"],
    "component_daily_counts": [*_CONTEXT, "source_utc_day", "explicit_instant_occurrences",
        "distinct_source_instants", "extra_coincident_occurrences", "exact_numeric_occurrences",
        "browser_numeric_occurrences", "meaning"]
}
_TIME_MEANING = ("Observed source instants are events. Their separations and span do not establish "
                 "sample duration, continuous coverage, interpolation, uptime or time-weighted exposure.")


def _json_text(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _source_context(source, binding):
    d, choice = binding["descriptor"], binding["choice"]
    return {
        "edition_label": source["name"], "edition_id": source["intake"]["editionId"],
        "analysis_version_id": source["component"]["analysis_version_id"],
        "source_stream_key": choice["streamKey"], "component_series_key": d["seriesKey"],
        "component_index": str(choice["index"]), "component_name": d["name"],
        "component_binding_id": d["bindingId"], "component_meaning_id": d["meaningId"]
    }


def _instant_ns(value):
    match = _UTC.fullmatch(value)
    _need(match is not None, "NORMALIZED_TIME_CHANGED")
    year, month, day, hour, minute, second, fraction = map(int, match.groups())
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    lengths = (31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
    _need(1 <= month <= 12 and 1 <= day <= lengths[month - 1] and
          hour < 24 and minute < 60 and second < 60, "NORMALIZED_TIME_CHANGED")
    # Astronomical year zero is permitted by the source's UTC normalization.
    # This Gregorian ordinal also handles that boundary without datetime loss.
    previous = year - 1
    days = 365 * previous + previous // 4 - previous // 100 + previous // 400
    days += sum(lengths[:month - 1]) + day - 1
    return ((days * 24 + hour) * 3600 + minute * 60 + second) * 1000000000 + fraction


def _citation(row):
    return {
        "parent_occurrence_id": row["occurrence_id"], "component_occurrence_id": row["component_occurrence_id"],
        "original_observation_id": row["observation_id"], "original_observation_id_type": row["observation_id_type"],
        "component_index": row["component_index"], "source_page_sha256": row["source_page_sha256"],
        "parent_pointer": row["source_pointer"], "component_pointer": row["component_source_pointer"],
        "component_pointer_state": row["component_pointer_state"], "original_phenomenon_time": row["phenomenon_time"],
        "result_state": row["result_state"], "result_type": row["result_type"], "result": row["result"],
        "result_quality_state": row["result_quality_state"], "result_quality": row["result_quality"]
    }


def _original_declared_type(binding):
    stream = _loads(binding["descriptor"]["binding"]["streamSourceJson"])
    declarations = stream.get("multiObservationDataTypes", [])
    index = binding["index"]
    value = declarations[index] if isinstance(declarations, list) and index < len(declarations) else _MISSING
    if value is _MISSING:
        return ""
    return value if isinstance(value, str) and not isinstance(value, _Number) else _emit(value)


def analysis_tables(sources):
    """All derived rows are exact text and remain full-query exportable."""
    result = {name: [] for name in _TABLE_COLUMNS}
    for source in sources:
        component = source.get("component")
        if not component:
            continue
        rows_by_binding = defaultdict(list)
        for row in source["document"]["selected_components"]:
            rows_by_binding[row["component_binding_id"]].append(row)
        eligible = {x["component_occurrence_id"]: x for x in source["document"]["component_eligibility"]}
        for binding in component["bindings"]:
            d, choice = binding["descriptor"], binding["choice"]
            rows = rows_by_binding[d["bindingId"]]
            context = _source_context(source, binding)
            exact_rows = [x for x in rows if eligible[x["component_occurrence_id"]]["exact_eligible"] == "true"]
            browser_rows = [x for x in rows if eligible[x["component_occurrence_id"]]["browser_eligible"] == "true"]
            inventory = {
                **context, "interpretation": choice["interpretation"]["mode"],
                "interpretation_note": choice["interpretation"]["note"],
                "acknowledged_issues": _json_text(choice["interpretation"]["acknowledgedIssues"]),
                "declaration_issues": _json_text(d["issues"]),
                "original_type": _original_declared_type(binding),
                "original_property": d["property"]["sourceJson"] if d["property"] else "",
                "original_unit": d["unitJson"] or "", "metadata_aligned": str(d["metadataAligned"]).lower(),
                "retained_selected_occurrences": str(len(rows)), "exact_numeric_occurrences": str(len(exact_rows)),
                "browser_numeric_occurrences": str(len(browser_rows)),
                "selected_period_json": _json_text(component["selection"]["period"]),
                "source_query_json": _json_text(source["intake"]["comparisonScope"]),
                "source_complete": str(source["source"]["complete"]).lower(),
                "source_archive_sha256": source["intake"]["archive"]["sha256"]
            }
            result["component_inventory"].append(inventory)
            if exact_rows:
                values = sorted(((Decimal(x["result"]), x) for x in exact_rows),
                                key=lambda pair: (pair[0], pair[1]["component_occurrence_id"]))
                total = sum((Fraction(x[0]) for x in values), Fraction())
                count = len(values)
                mean = total / count
                middle = count // 2
                median = (Fraction(values[middle][0]) if count % 2 else
                          (Fraction(values[middle - 1][0]) + Fraction(values[middle][0])) / 2)
                with localcontext() as ctx:
                    ctx.prec = 34
                    rounded = str(Decimal(mean.numerator) / Decimal(mean.denominator))
                result["component_exact_statistics"].append({
                    **context, "original_type": inventory["original_type"],
                    "original_property": inventory["original_property"], "original_unit": inventory["original_unit"],
                    "eligible_occurrences": str(count), "minimum_original_literal": values[0][1]["result"],
                    "maximum_original_literal": values[-1][1]["result"], "sum_fraction": _fraction(total),
                    "mean_fraction": _fraction(mean), "mean_decimal_34": rounded, "median_fraction": _fraction(median),
                    "first_source_time": min(x["phenomenon_start_utc"] for x in exact_rows),
                    "last_source_time": max(x["phenomenon_start_utc"] for x in exact_rows),
                    "method": ("Original componentExactEligibility, independently verified against original vectors "
                               "and declarations; Decimal tokens and exact Fraction arithmetic. Browser range is "
                               "a separate classifier. Samples, including coincident occurrences, have equal "
                               "weight; this is not a duration-weighted mean.")})
            instants = defaultdict(list)
            interval_count = unplaced_count = 0
            quality, classifications, categories = Counter(), Counter(), Counter()
            daily = defaultdict(list)
            for row in rows:
                kind = row["phenomenon_time_kind"]
                if kind == "explicit_instant":
                    _instant_ns(row["phenomenon_start_utc"])
                    instants[row["phenomenon_start_utc"]].append(row)
                    daily[row["phenomenon_start_utc"][:10]].append(row)
                elif kind == "explicit_interval":
                    _need(_instant_ns(row["phenomenon_end_utc"]) >= _instant_ns(row["phenomenon_start_utc"]),
                          "EXPLICIT_INTERVAL_CHANGED")
                    interval_count += 1
                else:
                    unplaced_count += 1
                quality[tuple(row[k] for k in ("result_quality_state", "result_quality", "result_state",
                    "result_type", "phenomenon_time_kind", "component_alignment", "issues"))] += 1
                e = eligible[row["component_occurrence_id"]]
                classifications[tuple(e[k] for k in ("exact_eligible", "exact_reason", "browser_eligible",
                                                     "browser_reason"))] += 1
                if row["component_observation_type"] == OM + "OM_CategoryObservation":
                    categories[(row["result_state"], row["result_type"], row["result"])] += 1
            ordered_times = sorted(instants)
            for values in instants.values():
                values.sort(key=lambda x: x["component_occurrence_id"])
            duplicates = {time: values for time, values in instants.items() if len(values) > 1}
            for time, values in sorted(duplicates.items()):
                result["component_duplicate_instants"].append({
                    **context, "source_instant": time, "retained_occurrences": str(len(values)),
                    "original_occurrences_json": _json_text([_citation(x) for x in values]),
                    "meaning": "Every original occurrence is retained; no first/last/mean or duplicate removal is selected."})
            separations = Counter()
            for left, right in zip(ordered_times, ordered_times[1:]):
                nanos = _instant_ns(right) - _instant_ns(left)
                _need(nanos > 0, "INSTANT_ORDER_CHANGED")
                separations[nanos] += 1
                lrows, rrows = instants[left], instants[right]
                result["component_separations"].append({
                    **context, "left_source_instant": left, "right_source_instant": right,
                    "elapsed_nanoseconds": _intstr(nanos), "elapsed_seconds_fraction": _fraction(Fraction(nanos, 1000000000)),
                    "left_occurrences": str(len(lrows)), "right_occurrences": str(len(rrows)),
                    "left_originals_json": _json_text([_citation(x) for x in lrows]),
                    "right_originals_json": _json_text([_citation(x) for x in rrows]), "meaning": _TIME_MEANING})
                if (len(lrows) == len(rrows) == 1 and
                    lrows[0]["component_observation_type"] == OM + "OM_CategoryObservation" and
                    rrows[0]["component_observation_type"] == OM + "OM_CategoryObservation" and
                    lrows[0]["result_state"] == rrows[0]["result_state"] == "value" and
                    (lrows[0]["result_type"], lrows[0]["result"]) != (rrows[0]["result_type"], rrows[0]["result"])):
                    lrow, rrow = lrows[0], rrows[0]
                    result["component_category_changes"].append({
                        **context, "left_source_instant": left, "right_source_instant": right,
                        "left_result_type": lrow["result_type"], "left_result": lrow["result"],
                        "right_result_type": rrow["result_type"], "right_result": rrow["result"],
                        "left_original_json": _json_text(_citation(lrow)), "right_original_json": _json_text(_citation(rrow)),
                        "meaning": ("Observed different literal categories at two unique adjacent source instants. "
                                    "The change instant and elapsed categorical state are not established.")})
            for nanos, count in sorted(separations.items()):
                result["component_separation_counts"].append({
                    **context, "elapsed_nanoseconds": _intstr(nanos),
                    "elapsed_seconds_fraction": _fraction(Fraction(nanos, 1000000000)),
                    "observed_separations": str(count), "meaning": _TIME_MEANING})
            maximum = max(separations, default=None)
            result["component_time_summary"].append({
                **context, "retained_occurrences": str(len(rows)),
                "explicit_instant_occurrences": str(sum(len(x) for x in instants.values())),
                "explicit_interval_occurrences": str(interval_count), "unplaced_occurrences": str(unplaced_count),
                "distinct_instants": str(len(instants)), "duplicate_instants": str(len(duplicates)),
                "extra_coincident_occurrences": str(sum(len(x) - 1 for x in duplicates.values())),
                "first_source_instant": ordered_times[0] if ordered_times else "",
                "last_source_instant": ordered_times[-1] if ordered_times else "",
                "observed_span_nanoseconds": (_intstr(_instant_ns(ordered_times[-1]) -
                                                     _instant_ns(ordered_times[0])) if ordered_times else ""),
                "inter_instant_separations": str(sum(separations.values())),
                "maximum_separation_nanoseconds": "" if maximum is None else _intstr(maximum),
                "maximum_separation_seconds_fraction": "" if maximum is None else _fraction(Fraction(maximum, 1000000000)),
                "coverage_interpretation": _TIME_MEANING})
            for values, count in sorted(categories.items()):
                result["component_category_counts"].append({
                    **context, "original_type": OM + "OM_CategoryObservation",
                    **dict(zip(("result_state", "result_type", "result"), values)),
                    "retained_occurrences": str(count), "meaning": "Literal declared category occurrences, including missing/null states. No numeric encoding or elapsed state."})
            for values, count in sorted(quality.items()):
                result["component_quality_counts"].append({
                    **context, **dict(zip(("result_quality_state", "result_quality", "result_state", "result_type",
                                          "phenomenon_time_kind", "component_alignment", "issues"), values)),
                    "retained_occurrences": str(count),
                    "meaning": "Original provider quality and absence remain separate from operator interpretation; neither is automatic approval."})
            for values, count in sorted(classifications.items()):
                result["component_eligibility_counts"].append({
                    **context, **dict(zip(("exact_eligible", "exact_reason", "browser_eligible", "browser_reason"), values)),
                    "retained_occurrences": str(count), "method": _METHOD})
            for day, values in sorted(daily.items()):
                distinct = len({x["phenomenon_start_utc"] for x in values})
                result["component_daily_counts"].append({
                    **context, "source_utc_day": day, "explicit_instant_occurrences": str(len(values)),
                    "distinct_source_instants": str(distinct), "extra_coincident_occurrences": str(len(values) - distinct),
                    "exact_numeric_occurrences": str(sum(eligible[x["component_occurrence_id"]]["exact_eligible"] == "true" for x in values)),
                    "browser_numeric_occurrences": str(sum(eligible[x["component_occurrence_id"]]["browser_eligible"] == "true" for x in values)),
                    "meaning": "UTC date groups of actual source instants; no local-day convention, duration or time-zone inference."})
    for name, rows in result.items():
        _need(all(set(row) == set(_TABLE_COLUMNS[name]) and
                  all(isinstance(value, str) for value in row.values()) for row in rows),
              "DERIVED_TEXT_TABLE_CONTRACT")
    return result, {name: {"collection": "/" + name, "rows": len(rows), "columns": _TABLE_COLUMNS[name]}
                    for name, rows in result.items()}


def _qi(value):
    _need(isinstance(value, str) and value and "\0" not in value, "SQL_IDENTIFIER")
    return '"' + value.replace('"', '""') + '"'


def _qs(value):
    return "'" + str(value).replace("'", "''") + "'"


def component_comparison_sql(left, right):
    """Compare retained selected and parent identities without collapsing duplicates."""
    return """
WITH left_keys AS (
 SELECT original_key,COUNT(*) AS n,MIN(semantic_sha256) AS selected_sha,
        MIN(parent_semantic_sha256) AS parent_sha,MIN(component_meaning_id) AS meaning_id
 FROM """ + _qi(left) + """ WHERE original_key_state='value' GROUP BY original_key
),right_keys AS (
 SELECT original_key,COUNT(*) AS n,MIN(semantic_sha256) AS selected_sha,
        MIN(parent_semantic_sha256) AS parent_sha,MIN(component_meaning_id) AS meaning_id
 FROM """ + _qi(right) + """ WHERE original_key_state='value' GROUP BY original_key
),keys AS (
 SELECT original_key FROM left_keys UNION SELECT original_key FROM right_keys
)
SELECT k.original_key,
 CASE WHEN COALESCE(l.n,0)>1 OR COALESCE(r.n,0)>1 THEN 'ambiguous'
      WHEN l.n IS NULL THEN 'observedOnlyRight'
      WHEN r.n IS NULL THEN 'observedOnlyLeft'
      WHEN l.meaning_id<>r.meaning_id THEN 'componentMeaningChanged'
      WHEN l.selected_sha<>r.selected_sha THEN 'selectedComponentChanged'
      WHEN l.parent_sha<>r.parent_sha THEN 'unselectedParentContextChanged'
      ELSE 'same' END AS classification,
 COALESCE(l.n,0) AS left_occurrences,COALESCE(r.n,0) AS right_occurrences,
 CASE WHEN l.n=1 THEN l.selected_sha END AS left_selected_sha256,
 CASE WHEN r.n=1 THEN r.selected_sha END AS right_selected_sha256,
 CASE WHEN l.n=1 THEN l.parent_sha END AS left_parent_sha256,
 CASE WHEN r.n=1 THEN r.parent_sha END AS right_parent_sha256,
 CASE WHEN l.n=1 THEN l.meaning_id END AS left_meaning_id,
 CASE WHEN r.n=1 THEN r.meaning_id END AS right_meaning_id,
 NULL AS unkeyed_side,NULL AS component_occurrence_id
FROM keys k LEFT JOIN left_keys l USING(original_key) LEFT JOIN right_keys r USING(original_key)
UNION ALL
SELECT NULL,'unkeyed',1,0,semantic_sha256,NULL,parent_semantic_sha256,NULL,
 component_meaning_id,NULL,'left',component_occurrence_id
FROM """ + _qi(left) + """ WHERE original_key_state='missing'
UNION ALL
SELECT NULL,'unkeyed',0,1,NULL,semantic_sha256,NULL,parent_semantic_sha256,
 NULL,component_meaning_id,'right',component_occurrence_id
FROM """ + _qi(right) + """ WHERE original_key_state='missing'
"""


def selected_scope(source):
    """An explicit comparison scope; native binding IDs remain independently retained."""
    if not source.get("component"):
        return None
    selected = source["component"]["selection"]
    return {"source": source["intake"]["comparisonScope"],
            "period": selected["period"], "timeBasis": selected["timeBasis"],
            "components": [{"streamKey": item["streamKey"], "index": item["index"],
                             "interpretation": item["interpretation"]}
                            for item in selected["componentSelections"]]}


def install_queries(programme, sources, registered, method_views):
    """Use only the original programme's saved query/export owner."""
    if not any(x.get("component") for x in sources):
        return {"summary_keys": [], "comparison_keys": [], "receiving_sql": None}
    descriptions = [
        ("component_selection", "component_inventory", "Explicit component selection and original meaning",
         "Each row binds one original zero-based position, complete ordered metadata, saved version and attributed interpretation. No property sorting, unit conversion or source conformance repair."),
        ("component_time_coverage", "component_time_summary", "Component events, coincidences and observed separations",
         _TIME_MEANING),
        ("component_statistics", "component_exact_statistics", "Exact selected-component sample statistics",
         "Exact sample arithmetic is independent of finite-browser rendering. All eligible occurrences, including duplicates, contribute equally; the mean is not duration weighted."),
        ("component_categories", "component_category_counts", "Literal selected-component categories",
         "Original declared categorical results stay typed literal codes. Counts are observations, not elapsed states."),
        ("component_quality", "component_quality_counts", "Component quality, missing values and alignment",
         "Source quality, missing/null/non-array results and positional issues remain original declarations, not automatic validity decisions."),
        ("component_eligibility", "component_eligibility_counts", "Exact arithmetic and browser plotting eligibility",
         "Separate source-owned classifiers retain every excluded reason. Exact finite decimal arithmetic may include values that a finite browser number cannot display."),
        ("component_time_separations", "component_separation_counts", "Observed inter-instant separation distribution",
         _TIME_MEANING),
        ("component_code_changes", "component_category_changes", "Observed selected-component code changes",
         "Only unique adjacent explicit source instants with actual different category values enter this table. Every endpoint retains its original citation.")
    ]
    summary, comparisons = [], []
    for key, table, title, note in descriptions:
        view = method_views[table]
        sql = "SELECT * FROM " + _qi(view) + " ORDER BY edition_label,source_stream_key,component_index"
        programme.query(key, sql, title=title, note=note)
        summary.append(key)
    by_name = {x["name"]: x for x in sources}
    union = []
    for number, pair in enumerate(programme.request.get("comparisons", []), 1):
        left, right = by_name[pair["left"]], by_name[pair["right"]]
        if not left.get("component") or not right.get("component"):
            continue
        key = "component_comparison_" + str(number)
        lview = registered[left["name"]]["tables"]["component_index"]["view"]
        rview = registered[right["name"]]["tables"]["component_index"]["view"]
        sql = component_comparison_sql(lview, rview)
        compatible = selected_scope(left) == selected_scope(right)
        label = left["name"] + " → " + right["name"]
        programme.query(key, sql, title="Selected component comparison: " + label,
                        note=("Both sides retain independently selected native bindings. Selected observation semantic context "
                              "(including value, time, quality, parameters and attributed interpretation), original "
                              "metadata meaning and unselected parent context are separate classifications. "
                              "Duplicate original keys stay ambiguous and unkeyed occurrences remain distinct. "
                              "Source/query/position/interpretation scopes " +
                              ("match." if compatible else "differ; observed-only rows are not deletion or insertion.")))
        comparisons.append(key)
        union.append("SELECT " + _qs(label) + " AS comparison," + _qs(str(compatible).lower()) +
                     " AS scope_compatible,classification,COUNT(*) AS original_key_groups,"
                     "SUM(left_occurrences) AS left_occurrences,SUM(right_occurrences) AS right_occurrences FROM (" +
                     sql + ") GROUP BY classification")
    if union:
        programme.query("component_comparison_summary", " UNION ALL ".join(union) + " ORDER BY comparison,classification",
                        title="Selected versus parent component differences",
                        note="Observed-only, changed meaning, selected value and unselected parent context remain distinct. The source archive is complete; an atomic provider snapshot is not asserted.")
        summary.append("component_comparison_summary")
    receiving_sql = ("SELECT * FROM " + _qi(method_views["component_daily_counts"]) +
                     " ORDER BY edition_label,source_stream_key,component_index,source_utc_day")
    return {"summary_keys": summary, "comparison_keys": comparisons, "receiving_sql": receiving_sql}

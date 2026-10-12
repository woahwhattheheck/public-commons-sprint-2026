"""MIT. Lossless SDMX 2.1 structures, generic/specific observations and ECB CSV."""
from __future__ import annotations

import csv
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlparse, parse_qs, unquote

XML = Path(__file__).resolve().parent.parent / "xml"
if str(XML) not in sys.path:
    sys.path.insert(0, str(XML))
from xml_source import InputError, MAX_SOURCE, MAX_RECORD, MAX_DEPTH, parser, parse_stream, expanded

NS = "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/"
LANG = "{http://www.w3.org/XML/1998/namespace}lang"
MAINTAINABLES = {"Dataflow", "DataStructure", "Codelist", "ConceptScheme", "CategoryScheme",
                "ContentConstraint", "ProvisionAgreement", "AgencyScheme", "HierarchicalCodelist"}
MAX_OBSERVATIONS = 1000000
MAX_METADATA = 32 * 1024 * 1024
MAX_CELL = 1048576


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sha(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def local(name):
    return name.rsplit("}", 1)[-1]


def children(node, name):
    return [n for n in node["children"] if local(n["tag"]) == name]


def descendants(node, name):
    found = []
    for child in node["children"]:
        if local(child["tag"]) == name:
            found.append(child)
        found.extend(descendants(child, name))
    return found


def first(node, name):
    rows = descendants(node, name)
    return rows[0] if rows else None


def names(node):
    return [{"lang": n["attrs"].get(LANG, ""), "text": n["text"]}
            for n in children(node, "Name")]


def reference(node):
    if node is None:
        return {}
    ref = node if local(node["tag"]) == "Ref" else first(node, "Ref")
    if ref is not None:
        a = ref["attrs"]
        return {"id": a.get("id", ""), "agency_id": a.get("agencyID", ""),
                "version": a.get("version", a.get("maintainableParentVersion", "")),
                "parent_id": a.get("maintainableParentID", ""), "class": a.get("class", ""),
                "package": a.get("package", "")}
    urn_node = node if local(node["tag"]) == "URN" else first(node, "URN")
    if urn_node is None:
        return {}
    urn = urn_node["text"].strip()
    match = re.fullmatch(
        r"urn:sdmx:org\.sdmx\.infomodel\.([A-Za-z][A-Za-z0-9_.]*)\."
        r"([A-Za-z][A-Za-z0-9_]*)=([^:\s]+):([^()]+)\(([^()]+)\)(?:\.(.+))?", urn)
    if not match:
        return {"urn": urn}
    package, kind, agency, maintainable_id, version, item_id = match.groups()
    return {"id": item_id if item_id is not None else maintainable_id,
            "agency_id": agency, "version": version,
            "parent_id": maintainable_id if item_id is not None else "",
            "class": kind, "package": package, "urn": urn}


def descriptor(node):
    a, n = node["attrs"], names(node)
    return {"id": a["id"], "agency_id": a.get("agencyID", ""),
            "version": a.get("version", ""), "name": next(
                (x["text"] for x in n if x["lang"] == "en"), n[0]["text"] if n else a["id"]),
            "names": n, "attributes": dict(a), "raw_attributes": dict(a),
            "descriptions": [{"lang": d["attrs"].get(LANG, ""), "text": d["text"]}
                             for d in children(node, "Description")]}


def component(node, role=None):
    a = node["attrs"]
    out = {"id": a.get("id", ""), "concept": reference(first(node, "ConceptIdentity")),
           "codelist": reference(first(node, "Enumeration"))}
    if role:
        out.update(position=int(a.get("position", "0")), role=role)
    if local(node["tag"]) == "Attribute":
        relation = first(node, "AttributeRelationship")
        out.update(assignment_status=a.get("assignmentStatus", ""),
                   relationship={"kind": local(relation["children"][0]["tag"]) if relation and relation["children"] else "",
                                 "dimensions": [reference(x).get("id") for x in children(relation, "Dimension")] if relation else [],
                                 "content": relation})
    formats = descendants(node, "TextFormat")
    if formats:
        out["text_format"] = formats[0]["attrs"]
    return out


def maintained(node, result):
    kind = local(node["tag"])
    item = descriptor(node)
    if kind == "Dataflow":
        item["structure"] = reference(first(node, "Structure"))
        result["flows"].append(item)
    elif kind == "DataStructure":
        dims = first(node, "DimensionList")
        item["dimensions"] = sorted(
            [component(n, {"TimeDimension": "time", "MeasureDimension": "measure"}.get(local(n["tag"]), "dimension"))
             for n in dims["children"] if local(n["tag"]) in {"Dimension", "TimeDimension", "MeasureDimension"}] if dims else [],
            key=lambda x: x["position"])
        attrs = first(node, "AttributeList")
        measures = first(node, "MeasureList")
        item["attributes"] = [component(n) for n in attrs["children"] if local(n["tag"]) == "Attribute"] if attrs else []
        item["measures"] = [component(n) for n in measures["children"] if local(n["tag"]) in {"PrimaryMeasure", "MeasureDimension"}] if measures else []
        item["groups"] = [{"id": n["attrs"].get("id", ""),
                           "dimensions": [reference(x).get("id") for x in children(n, "GroupDimension")]}
                          for n in descendants(node, "Group")]
        result["structures"].append(item)
        result["dimensions"].extend(item["dimensions"])
    elif kind == "Codelist":
        item["codes"] = []
        for code in children(node, "Code"):
            ns = names(code)
            item["codes"].append({"id": code["attrs"].get("id", ""),
                "name": next((x["text"] for x in ns if x["lang"] == "en"), ns[0]["text"] if ns else code["attrs"].get("id", "")),
                "names": ns, "parent": reference(first(code, "Parent")),
                "descriptions": [{"lang": d["attrs"].get(LANG, ""), "text": d["text"]} for d in children(code, "Description")]})
        result["codelists"].append(item)
    else:
        result["other_structures"].append({"kind": kind, **item, "content": node})


def coverage(origin, supplied=None):
    result = {"origin": origin, "selection": {}, "completeness": "unspecified",
              "start_period": None, "end_period": None, "updated_after": None}
    if origin:
        url = urlparse(origin)
        args = parse_qs(url.query, keep_blank_values=True)
        selection = {k: v for k, v in sorted(args.items()) if k not in {"format", "updatedAfter"}}
        parts = url.path.rstrip("/").split("/")
        if "data" in parts:
            at = parts.index("data")
            result["flow"] = unquote(parts[at + 1]) if len(parts) > at + 1 else ""
            raw = unquote(parts[at + 2]) if len(parts) > at + 2 else ""
            result["key"] = ".".join("+".join(sorted(p.split("+"))) for p in raw.split("."))
            result["selection"] = {"flow": result["flow"], "key": result["key"], "query": selection}
            result["start_period"] = (args.get("startPeriod") or [None])[0]
            result["end_period"] = (args.get("endPeriod") or [None])[0]
            result["updated_after"] = (args.get("updatedAfter") or [None])[0]
            result["completeness"] = "partial_update" if result["updated_after"] else "selected_response"
            if any(k in args for k in ("firstNObservations", "lastNObservations")):
                result["completeness"] = "limited_response"
    if supplied is not None:
        if not isinstance(supplied, dict) or set(supplied) - {"start_period", "end_period", "updated_after", "completeness", "selection", "receipt"}:
            raise InputError("Unsupported source coverage fields")
        result.update(supplied)
    return result


def period_bounds(value, frequency):
    """Return declared calendar bounds without resampling or altering a source value."""
    try:
        if re.fullmatch(r"\d{4}", value) and frequency == "A":
            y = int(value)
            return date(y, 1, 1).isoformat(), date(y, 12, 31).isoformat()
        match = re.fullmatch(r"(\d{4})-([QS])([1-4])", value)
        if match:
            y, kind, n = int(match[1]), match[2], int(match[3])
            if (kind == "Q" and frequency == "Q") or (kind == "S" and frequency in {"H", "S"} and n <= 2):
                width = 3 if kind == "Q" else 6
                month = (n - 1) * width + 1
                start = date(y, month, 1)
                end = date(y + (month + width > 12), (month + width - 1) % 12 + 1, 1) - timedelta(days=1)
                return start.isoformat(), end.isoformat()
        if re.fullmatch(r"\d{4}-\d{2}", value) and frequency == "M":
            y, m = map(int, value.split("-"))
            start = date(y, m, 1)
            end = date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)
            return start.isoformat(), end.isoformat()
        match = re.fullmatch(r"(\d{4})-W(\d{2})", value)
        if match and frequency == "W":
            start = date.fromisocalendar(int(match[1]), int(match[2]), 1)
            return start.isoformat(), (start + timedelta(days=6)).isoformat()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) and frequency in {"D", "B"}:
            day = date.fromisoformat(value).isoformat()
            return day, day
    except (ValueError, OverflowError):
        pass
    return None, None


def parse_xml(path, on_series, on_observation, on_group):
    result = {"format": None, "kind": "data", "flows": [], "structures": [], "codelists": [],
              "dimensions": [], "other_structures": [], "header": None, "header_references": [], "datasets": [],
              "observation_count": 0}
    p, stack = parser(), []
    captured = []
    capture_bytes = 0
    metadata_bytes = 0
    dataset = series = group = obs = None
    serial = 0
    root_name = None

    def put(target, key, value):
        if not key or len(key) > 2048 or not isinstance(value, str) or len(value) > MAX_CELL:
            raise InputError("SDMX component exceeds the supported identifier or value size")
        if key in target and target[key] != value:
            raise InputError("SDMX repeats a component with different values: " + key)
        target[key] = value

    def series_record(active, count):
        dims = active["dimensions"]
        raw = active["raw_attributes"]
        ident = sha({"dataset": dataset["id"], "dimensions": dims, "raw": raw if not dims else {}})
        return {"id": ident, "dataset_id": dataset["id"],
                "series_key": ".".join(dims.values()) if dims else ident,
                "dimensions": dict(dims), "attributes": dict(active["attributes"]),
                "raw_attributes": dict(raw), "observation_count": count,
                "format": result["format"]}

    def start(raw_name, raw_attrs):
        nonlocal dataset, series, group, obs, capture_bytes, root_name
        name = expanded(raw_name)
        tag = local(name)
        attrs = {expanded(k): v for k, v in raw_attrs.items()}
        if len(stack) >= MAX_DEPTH or len(attrs) > 256 or len(name) > 2048:
            raise InputError("SDMX exceeds the XML depth or component limits")
        if any(len(k) > 2048 or len(v) > MAX_CELL for k, v in attrs.items()):
            raise InputError("SDMX XML attribute exceeds the supported size")
        if not stack:
            if name != "{" + NS + "message}" + tag or tag not in {"Structure", "GenericData", "StructureSpecificData"}:
                raise InputError("Use SDMX 2.1 Structure, GenericData or StructureSpecificData XML")
            root_name = tag
            result["format"] = {"Structure": "sdmx-structure-2.1", "GenericData": "sdmx-generic-2.1",
                                "StructureSpecificData": "sdmx-specific-2.1"}[tag]
            result["kind"] = "structure" if tag == "Structure" else "data"
        parent = stack[-1] if stack else None
        stack.append(tag)
        if captured or (tag == "Header" and len(stack) == 2) or (tag in MAINTAINABLES and attrs.get("id") and attrs.get("agencyID")):
            node = {"tag": name, "attrs": attrs, "text": "", "children": []}
            if captured:
                captured[-1]["children"].append(node)
            captured.append(node)
            capture_bytes += len(name) + sum(len(k) + len(v) for k, v in attrs.items()) + 64
            if capture_bytes > MAX_METADATA:
                raise InputError("A maintained SDMX metadata component exceeds 32 MiB")
        if root_name == "Structure":
            return
        if tag == "DataSet":
            if dataset is not None:
                raise InputError("Nested SDMX datasets are invalid")
            def dataset_control(key, default=""):
                qualified = "{" + NS + "data/structurespecific}" + key
                value = attrs.get(qualified) if result["format"] == "sdmx-specific-2.1" else None
                if value is not None:
                    if key in attrs and attrs[key] != value:
                        raise InputError("SDMX repeats a dataset control with different values: " + key)
                    return value
                return attrs.get(key, default)
            dataset = {"id": str(len(result["datasets"]) + 1), "attributes": {},
                       "raw_attributes": attrs, "action": dataset_control("action", "Replace")}
            structure_ref = dataset_control("structureRef")
            links = [link for link in result["header_references"]
                     if link["structure_id"] == structure_ref]
            if not structure_ref and len(result["header_references"]) == 1:
                links = result["header_references"]
            if len(links) == 1:
                dataset["structure_reference"] = dict(links[0]["reference"])
                dataset["dimension_at_observation"] = links[0]["dimension_at_observation"]
            if dataset["action"] not in {"Append", "Replace", "Delete", "Information"}:
                raise InputError("Unknown SDMX dataset action: " + dataset["action"])
            result["datasets"].append(dataset)
        elif tag == "Series":
            if dataset is None or series is not None:
                raise InputError("SDMX Series is outside its dataset")
            series = {"dimensions": {}, "attributes": {}, "raw_attributes": attrs, "count": 0}
        elif tag == "Group":
            if dataset is None:
                raise InputError("SDMX Group is outside its dataset")
            group = {"dataset_id": dataset["id"], "key": {}, "attributes": {}, "raw_attributes": attrs}
        elif tag == "Obs":
            if dataset is None:
                raise InputError("SDMX observation is outside its dataset")
            obs = {"time_period": attrs.get("TIME_PERIOD"), "value": attrs.get("OBS_VALUE"),
                   "value_present": "OBS_VALUE" in attrs, "attributes": {}, "raw_attributes": attrs, "key": {}}
        elif tag == "Value" and parent in {"SeriesKey", "GroupKey", "ObsKey", "DataSetKey", "Attributes"}:
            key, value = attrs.get("id"), attrs.get("value", "")
            if parent == "SeriesKey" and series is not None:
                if series["count"]:
                    raise InputError("Series dimensions must precede observations")
                put(series["dimensions"], key, value)
            elif parent == "GroupKey" and group is not None:
                put(group["key"], key, value)
            elif parent == "ObsKey" and obs is not None:
                put(obs["key"], key, value)
            elif parent == "DataSetKey" and dataset is not None:
                put(dataset.setdefault("dimensions", {}), key, value)
            elif parent == "Attributes":
                target = obs if obs is not None else group if group is not None else series if series is not None else dataset
                if target is not None:
                    put(target["attributes"], key, value)
        elif tag == "ObsDimension" and obs is not None:
            obs["time_period"] = attrs.get("value")
        elif tag == "ObsValue" and obs is not None:
            obs["value_present"] = "value" in attrs
            obs["value"] = attrs.get("value")
            if attrs.get("{http://www.w3.org/2001/XMLSchema-instance}nil") in {"true", "1"}:
                obs["value"] = None

    def text(value):
        nonlocal capture_bytes
        if captured:
            captured[-1]["text"] += value
            capture_bytes += len(value.encode("utf-8"))
            if capture_bytes > MAX_METADATA:
                raise InputError("A maintained SDMX metadata component exceeds 32 MiB")

    def end(raw_name):
        nonlocal dataset, series, group, obs, serial, capture_bytes, metadata_bytes
        tag = local(expanded(raw_name))
        if root_name != "Structure":
            if tag == "Obs" and obs is not None:
                serial += 1
                if serial > MAX_OBSERVATIONS:
                    raise InputError("Source exceeds one million observations")
                dims = dict(series["dimensions"] if series else dataset.get("dimensions", {}))
                dims.update({k: v for k, v in obs["key"].items() if k != "TIME_PERIOD"})
                period = obs["time_period"] or obs["key"].get("TIME_PERIOD")
                if not isinstance(period, str) or not period or len(period) > 160:
                    raise InputError("Each observation needs its original TIME_PERIOD")
                active = series or {"dimensions": dims, "attributes": {}, "raw_attributes": {}}
                sr = series_record(active, 1)
                if not series:
                    on_series(sr)
                observation_attrs = dict(obs["attributes"])
                if result["format"] == "sdmx-specific-2.1":
                    observation_attrs.update({k: v for k, v in obs["raw_attributes"].items()
                                              if k not in {"TIME_PERIOD", "OBS_VALUE"}})
                on_observation({"ordinal": serial, "series_id": sr["id"], "dataset_id": dataset["id"],
                    "series_key": sr["series_key"], "time_period": period, "value": obs["value"],
                    "value_present": obs["value_present"], "attributes": observation_attrs,
                    "raw_attributes": dict(obs["raw_attributes"]), "action": dataset["action"],
                    "dimensions": dims, "format": result["format"]})
                if series:
                    series["count"] += 1
                obs = None
            elif tag == "Series" and series is not None:
                on_series(series_record(series, series["count"]))
                series = None
            elif tag == "Group" and group is not None:
                on_group(group)
                group = None
            elif tag == "DataSet":
                dataset = None
        if captured:
            node = captured.pop()
            if not captured:
                if tag == "Header":
                    result["header"] = node
                    result["header_references"] = [
                        {"structure_id": link["attrs"].get("structureID", ""),
                         "dimension_at_observation": link["attrs"].get("dimensionAtObservation", ""),
                         "reference": reference(link), "raw_attributes": dict(link["attrs"])}
                        for link in children(node, "Structure")]
                else:
                    maintained(node, result)
                metadata_bytes += capture_bytes
                capture_bytes = 0
                if metadata_bytes > MAX_METADATA:
                    raise InputError("Derived SDMX metadata exceeds 32 MiB")
        stack.pop()

    p.StartElementHandler, p.EndElementHandler, p.CharacterDataHandler = start, end, text
    with path.open("rb") as stream:
        parse_stream(p, stream)
    result["observation_count"] = serial
    if result["kind"] == "structure" and result["flows"] and not result["structures"]:
        result["kind"] = "catalog"
    return result


def parse_csv(path, on_series, on_observation, on_group):
    csv.field_size_limit(MAX_CELL)
    result = {"format": "sdmx-csv", "kind": "data", "flows": [], "structures": [], "codelists": [],
              "dimensions": [], "other_structures": [], "header": None, "header_references": [], "datasets": [],
              "observation_count": 0}
    structural = {"KEY", "DATAFLOW", "STRUCTURE", "STRUCTURE_ID", "ACTION"}
    datasets = {}
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.reader(stream)
        try:
            header = next(reader)
        except StopIteration:
            raise InputError("SDMX CSV is empty")
        if not header or len(header) != len(set(header)) or len(header) > 256:
            raise InputError("SDMX CSV needs distinct column names")
        if "TIME_PERIOD" not in header or "OBS_VALUE" not in header:
            raise InputError("SDMX CSV must contain TIME_PERIOD and OBS_VALUE")
        if any(not c or len(c) > 2048 for c in header):
            raise InputError("Invalid SDMX CSV column")
        time_at = header.index("TIME_PERIOD")
        dimension_names = [c for c in header[:time_at] if c not in structural and c != "OBS_VALUE"]
        if not dimension_names or "FREQ" not in dimension_names:
            raise InputError("SDMX CSV must place its declared series dimensions before TIME_PERIOD, including FREQ")
        result["csv_columns"] = header
        result["dimensions"] = [{"id": key, "position": i + 1, "role": "dimension", "codelist": {}}
                                for i, key in enumerate(dimension_names)]
        for ordinal, cells in enumerate(reader, 1):
            if ordinal > MAX_OBSERVATIONS:
                raise InputError("Source exceeds one million observations")
            if len(cells) != len(header):
                raise InputError(f"CSV row {ordinal + 1} has the wrong number of fields")
            row = dict(zip(header, cells))
            dims = {k: row[k] for k in dimension_names}
            if any(not v for v in dims.values()) or not row["TIME_PERIOD"]:
                raise InputError(f"CSV row {ordinal + 1} has an empty dimension or period")
            key = ".".join(dims.values())
            original_key = row.get("KEY", "")
            flow = row.get("STRUCTURE_ID") or row.get("DATAFLOW") or (
                original_key[:-(len(key) + 1)] if original_key.endswith("." + key) else "")
            if original_key and original_key not in {key, flow + "." + key}:
                raise InputError(f"CSV row {ordinal + 1}: KEY differs from its dimension columns")
            action = row.get("ACTION") or "Replace"
            action = {"A": "Append", "R": "Replace", "D": "Delete", "I": "Information"}.get(action, action)
            if action not in {"Append", "Replace", "Delete", "Information"}:
                raise InputError(f"CSV row {ordinal + 1}: unknown SDMX action")
            dataset_key = (flow, action)
            if dataset_key not in datasets:
                ds = {"id": str(len(datasets) + 1), "attributes": {},
                      "raw_attributes": {"flow": flow, "structure": row.get("STRUCTURE", "dataflow")},
                      "action": action}
                datasets[dataset_key] = ds
                result["datasets"].append(ds)
            ds = datasets[dataset_key]
            attrs = {k: v for k, v in row.items() if k not in structural and k not in dims
                     and k not in {"TIME_PERIOD", "OBS_VALUE"}}
            ident = sha({"dataset": ds["id"], "dimensions": dims, "raw": {}})
            on_series({"id": ident, "dataset_id": ds["id"], "series_key": key,
                       "dimensions": dims, "attributes": {}, "raw_attributes": {},
                       "observation_count": 1, "format": result["format"]})
            on_observation({"ordinal": ordinal, "series_id": ident, "dataset_id": ds["id"],
                            "series_key": key, "dimensions": dims, "time_period": row["TIME_PERIOD"],
                            "value": row["OBS_VALUE"], "value_present": True,
                            "attributes": attrs, "raw_attributes": {}, "action": action,
                            "format": result["format"]})
            result["observation_count"] = ordinal
    return result


def parse_source(path, metadata, on_series, on_observation, on_group):
    with path.open("rb") as stream:
        prefix = stream.read(4096).lstrip(b"\xef\xbb\xbf \t\r\n")
    if prefix.startswith(b"<"):
        result = parse_xml(path, on_series, on_observation, on_group)
    else:
        result = parse_csv(path, on_series, on_observation, on_group)
    requested = metadata.get("kind", "auto")
    if requested not in {"auto", "data", "structure", "catalog"}:
        raise InputError("Source kind must be auto, data, structure or catalog")
    if requested != "auto" and requested != result["kind"] and not (
            requested == "catalog" and result["kind"] == "structure" and result["flows"]):
        raise InputError("Uploaded source does not match its declared kind")
    result["coverage"] = coverage(metadata.get("origin", ""), metadata.get("coverage"))
    result["coverage"]["actions"] = sorted({d["action"] for d in result["datasets"]})
    return result


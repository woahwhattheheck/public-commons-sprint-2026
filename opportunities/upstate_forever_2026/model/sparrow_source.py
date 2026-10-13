"""Retain exact USGS Southeast SPARROW reach references for a saved study.

Run from the project root:
    python -m model.sparrow_source acquire selection.json output-directory
    python -m model.sparrow_source verify output-directory

Only public read-only USGS requests are made. The source manifest can be imported
by the existing Workspace.import_sources method. Scientific field selection is
explicit in the comparison editor; this module never relabels a river load as a
landscape export and never substitutes a model prediction for a measurement.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path
import re
from urllib.parse import urlencode, urlsplit, parse_qs
from urllib.request import Request, urlopen

from .common import atomic_bytes

SERVICE = "https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer"
SCHEMA = "upstate.sparrow-source-selection/v1"
BUNDLE = "upstate.sparrow-source-bundle/v1"
LAYERS = {
    "nitrogen": {"prediction": 9, "calibration": 37, "sources": 5},
    "phosphorus": {"prediction": 0, "calibration": 36, "sources": 6},
    "sediment": {"prediction": 27, "calibration": 39, "sources": 11},
}
VINTAGE = "2012 source conditions; 1999-2014 long-term hydrology; publisher data update 2019-10-06"
SOURCE_URLS = [
    "https://doi.org/10.5066/P9A682GW",
    "https://pubs.usgs.gov/publication/sir20195135",
    SERVICE,
]
RESERVED = ("reference_id", "reference_parameter", "reference_evidence_kind",
            "reference_role", "reference_layer", "reference_response_path",
            "reference_response_sha256")


def _sha(body):
    return hashlib.sha256(body).hexdigest()


def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _json(body):
    return json.loads(body.decode("utf-8-sig"), parse_float=Decimal)


def _bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True,
                       allow_nan=False, default=_decimal_text) + "\n").encode("utf-8")


def _decimal_text(value):
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(type(value).__name__)


def _write(path, body):
    atomic_bytes(path, body, immutable=True)


def _member(root, relative):
    p = Path(relative)
    if p.is_absolute() or not p.parts or ".." in p.parts or "\\" in relative:
        raise ValueError("Retained member must use a relative portable path")
    target = root / p
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError("Retained member escapes its original directory")
    return target


def _selection(body):
    value = _json(body)
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ValueError("Use " + SCHEMA)
    allowed = {"schema", "title", "comids", "parameters", "source_bindings", "context_sources", "notes"}
    if set(value) - allowed:
        raise ValueError("Unsupported source selection field")
    if not isinstance(value.get("title"), str) or not value["title"].strip():
        raise ValueError("State the source collection title")
    comids = value.get("comids")
    if (not isinstance(comids, list) or not comids
            or any(not isinstance(v, str) or not re.fullmatch(r"[1-9][0-9]*", v) for v in comids)
            or len(set(comids)) != len(comids)):
        raise ValueError("Select distinct original numeric COMIDs as strings")
    parameters = value.get("parameters", list(LAYERS))
    if (not isinstance(parameters, list) or not parameters
            or any(v not in LAYERS for v in parameters)
            or len(set(parameters)) != len(parameters)):
        raise ValueError("Select nitrogen, phosphorus and/or sediment")
    bindings = value.get("source_bindings")
    if not isinstance(bindings, list) or not bindings:
        raise ValueError("Retain the original source bindings for selected reaches")
    covered = set()
    for item in bindings:
        if not isinstance(item, dict) or item.get("comid") not in comids:
            raise ValueError("Source binding needs a selected original COMID")
        for key in ("source_url", "source_path", "source_sha256", "rationale"):
            if not isinstance(item.get(key), str) or not item[key].strip():
                raise ValueError("Retain the source binding " + key)
        if not re.fullmatch(r"[0-9a-f]{64}", item["source_sha256"]):
            raise ValueError("Retain the original source response SHA-256")
        covered.add(item["comid"])
    if covered != set(comids):
        raise ValueError("Every selected COMID needs its original source binding")
    for item in value.get("context_sources", []):
        if (not isinstance(item, dict) or not all(isinstance(item.get(k), str) and item[k]
                for k in ("source_url", "source_path", "source_sha256", "title"))
                or not re.fullmatch(r"[0-9a-f]{64}", item["source_sha256"])):
            raise ValueError("Retain each original context source and its exact SHA-256")
    return value, comids, parameters


class Capture:
    def __init__(self, root, retained_index=None):
        self.root = root
        self.receipts = []
        self.retained = {}
        if retained_index is not None:
            index_path = Path(retained_index).resolve(strict=True)
            index = json.loads(index_path.read_text(encoding="utf-8"))
            if index.get("schema") != "upstate.sparrow-retained-responses/v1":
                raise ValueError("Select the original retained-response index")
            for item in index.get("responses", []):
                url = item.get("url")
                if (not isinstance(url, str)
                        or not (url.startswith(SERVICE + "/") or url == SERVICE + "?f=pjson")):
                    raise ValueError("Retained response does not identify this public USGS service")
                if url in self.retained or not isinstance(item.get("source_reference"), str):
                    raise ValueError("Retained original response needs a unique URL and source reference")
                path = (index_path.parent / item["path"]).resolve(strict=True)
                self.retained[url] = (path, item)

    def get(self, relative, url):
        body_path = _member(self.root, "original/" + relative + ".json")
        receipt_path = _member(self.root, "original/" + relative + ".receipt.json")
        if receipt_path.exists():
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            body = body_path.read_bytes()
            if (receipt.get("url") != url or receipt.get("bytes") != len(body)
                    or receipt.get("sha256") != _sha(body)):
                raise ValueError("Captured HTTP response differs: " + str(body_path))
        else:
            if body_path.exists():
                raise ValueError("Original body has no completed receipt: " + str(body_path))
            if url in self.retained:
                original_path, original = self.retained[url]
                body = original_path.read_bytes()
                if original.get("bytes") != len(body) or original.get("sha256") != _sha(body):
                    raise ValueError("Retained original response changed: " + str(original_path))
                receipt = {
                    "url": url, "resolved_url": original.get("resolved_url"),
                    "retrieved_at": original.get("retrieved_at"),
                    "received_at": _now(), "transport": "retained-original-response",
                    "source_reference": original["source_reference"],
                    "status": original.get("status"), "bytes": len(body), "sha256": _sha(body),
                    "content_type": original.get("content_type"),
                    "etag": original.get("etag"), "last_modified": original.get("last_modified"),
                    "path": body_path.relative_to(self.root).as_posix(),
                }
            else:
                request = Request(url, headers={"Accept": "application/json",
                                               "User-Agent": "TJLabs-Upstate-Source-Reader/1.0"})
                with urlopen(request, timeout=45) as response:
                    body = response.read()
                    captured = _now()
                    receipt = {
                        "url": url, "resolved_url": response.geturl(),
                        "retrieved_at": captured, "received_at": captured,
                        "transport": "direct-public-https", "status": response.status,
                        "bytes": len(body), "sha256": _sha(body),
                        "content_type": response.headers.get("Content-Type"),
                        "etag": response.headers.get("ETag"),
                        "last_modified": response.headers.get("Last-Modified"),
                        "path": body_path.relative_to(self.root).as_posix(),
                    }
            _write(body_path, body)
            _write(receipt_path, _bytes(receipt))
        self.receipts.append(receipt)
        value = _json(body)
        if not isinstance(value, dict) or value.get("error"):
            raise ValueError("USGS returned an original error response: " + str(body_path))
        return value, receipt


def _query(layer, values):
    return SERVICE + "/" + str(layer) + "/query?" + urlencode(values)


def _numeric_id(value):
    if isinstance(value, bool):
        raise ValueError("Boolean is not a published object identifier")
    number = Decimal(str(value))
    if not number.is_finite() or number != number.to_integral_value():
        raise ValueError("Published object identifier is not an integer")
    return int(number)


def _layer(capture, parameter, role, comids):
    layer = LAYERS[parameter][role]
    prefix = parameter + "-" + role
    metadata, metadata_receipt = capture.get(prefix + "-metadata", SERVICE + "/" + str(layer) + "?f=pjson")
    fields = [x["name"] for x in metadata.get("fields", [])]
    attribute_fields = {x["name"] for x in metadata.get("fields", [])
                        if x.get("type") != "esriFieldTypeGeometry"}
    oid_fields = [x["name"] for x in metadata.get("fields", []) if x.get("type") == "esriFieldTypeOID"]
    key = "COMID_ORIG" if role == "prediction" else "COMID"
    expected = {"COMID", key}
    if role == "prediction":
        expected.update(("ACCL", "INCL", "ACCY", "INCY", "INCAREAK_1", "CUMAREAKM2"))
    else:
        expected.update(("STATION_ID", "STATION_NM"))
        expected.update(("CONSTITUEN", "ACTUAL_MT", "TSS_CONV", "PLOAD_MT")
                        if parameter == "sediment" else ("ACTUAL", "PLOAD_TOTA"))
    if not expected.issubset(fields) or len(oid_fields) != 1 or set(RESERVED) & set(fields):
        raise ValueError("Original USGS layer schema changed: " + prefix)
    oid = oid_fields[0]
    where = key + " IN (" + ",".join(comids) + ")"
    ids_response, ids_receipt = capture.get(prefix + "-ids", _query(layer, {
        "where": where, "returnIdsOnly": "true", "f": "pjson",
    }))
    original_ids = ids_response.get("objectIds")
    if original_ids is None and ids_response.get("objectIdFieldName") == oid:
        original_ids = []
    if not isinstance(original_ids, list) or ids_response.get("objectIdFieldName") != oid:
        raise ValueError("USGS did not return its complete object-ID selection: " + prefix)
    ids = [_numeric_id(v) for v in original_ids]
    if len(ids) != len(set(ids)) or ids_response.get("exceededTransferLimit"):
        raise ValueError("Original object-ID selection is incomplete or duplicated")
    ids.sort()
    rows, seen, pages = [], set(), []
    # Query exact enumerated IDs: no result-offset drift and no scientific row
    # sample. Every selected object is collected, even duplicate source COMIDs.
    for start in range(0, len(ids), 100):
        selected = ids[start:start + 100]
        page, receipt = capture.get(prefix + "-page-" + str(start // 100 + 1).zfill(5), _query(layer, {
            "objectIds": ",".join(str(v) for v in selected),
            "outFields": "*", "returnGeometry": "true", "f": "pjson",
        }))
        features = page.get("features")
        if not isinstance(features, list) or page.get("exceededTransferLimit"):
            raise ValueError("USGS feature page is incomplete: " + receipt["path"])
        page_ids = []
        for feature in features:
            attrs = feature.get("attributes")
            if (not isinstance(attrs, dict) or set(attrs) - set(fields)
                    or not attribute_fields.issubset(attrs)):
                raise ValueError("Original attribute schema changed during acquisition")
            item_id = _numeric_id(attrs.get(oid))
            if item_id in seen:
                raise ValueError("Duplicate original feature in retained pages")
            if str(_numeric_id(attrs.get(key))) not in comids:
                raise ValueError("USGS returned a feature outside selected original reaches")
            page_ids.append(item_id)
            seen.add(item_id)
            rows.append({
                **{name: attrs.get(name) for name in fields if name != "Shape"},
                "reference_id": "usgs-sparrow-se2012-" + str(layer) + "-" + str(item_id),
                "reference_parameter": parameter,
                "reference_evidence_kind": "external_model_estimate" if role == "prediction" else "calibration_reference",
                "reference_role": role,
                "reference_layer": str(layer),
                "reference_response_path": receipt["path"],
                "reference_response_sha256": receipt["sha256"],
            })
        if set(page_ids) != set(selected):
            raise ValueError("USGS feature page differs from its enumerated original IDs")
        pages.append(receipt)
    if seen != set(ids):
        raise ValueError("Some selected original USGS features were not retained")
    columns = list(RESERVED) + [x for x in fields if x not in ("Shape",) + RESERVED]
    text = io.StringIO(newline="")
    writer = csv.DictWriter(text, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: "" if row[k] is None else str(row[k]) for k in columns})
    csv_path = "tables/" + prefix + ".csv"
    _write(_member(capture.root, csv_path), text.getvalue().encode("utf-8"))
    matched = sorted({str(_numeric_id(r[key])) for r in rows}, key=int)
    return {
        "parameter": parameter, "role": role, "layer": layer, "table": csv_path,
        "metadata": metadata_receipt, "id_selection": ids_receipt, "pages": pages,
        "rows": len(rows), "selected_comids": comids, "matched_comids": matched,
        "unmatched_comids": [v for v in comids if v not in matched],
        "selection_field": key, "columns": columns,
        "quantities": "All original columns retained unchanged; select an original field and its documented quantity/unit in the comparison editor.",
        "geometry": "Exact original JSON query responses retain the returned geometry and spatialReference; no local geometry transformation is applied.",
    }


def acquire(selection_path, output, *, retained_index=None):
    selection_path = Path(selection_path).resolve(strict=True)
    body = selection_path.read_bytes()
    value, comids, parameters = _selection(body)
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    complete = root / "source-manifest.json"
    if complete.exists():
        if (root / "selection.json").read_bytes() != body:
            raise ValueError("Select a new output directory for another source edition")
        return verify(root)
    _write(root / "selection.json", body)
    producer_paths = []
    for name in ("sparrow_source.py", "SPARROW_SOURCES.md", "common.py", "verified_files.py"):
        relative = "producer/" + name
        _write(_member(root, relative), Path(__file__).with_name(name).read_bytes())
        producer_paths.append(relative)
    binding_files = []
    for binding in value["source_bindings"]:
        original = (selection_path.parent / binding["source_path"]).resolve(strict=True)
        original_body = original.read_bytes()
        if _sha(original_body) != binding["source_sha256"]:
            raise ValueError("Original selected reach source changed: " + str(original))
        relative = "bindings/" + binding["comid"] + "-" + binding["source_sha256"] + original.suffix
        _write(_member(root, relative), original_body)
        binding_files.append({"path": relative, "sha256": binding["source_sha256"],
                              "bytes": len(original_body), "binding": binding})
    context_files = []
    for item in value.get("context_sources", []):
        original = (selection_path.parent / item["source_path"]).resolve(strict=True)
        original_body = original.read_bytes()
        if _sha(original_body) != item["source_sha256"]:
            raise ValueError("Original context source changed: " + str(original))
        relative = "context/" + item["source_sha256"] + "-" + original.name
        _write(_member(root, relative), original_body)
        context_files.append({"path": relative, "sha256": item["source_sha256"],
                              "bytes": len(original_body), "source": item})
    capture = Capture(root, retained_index)
    service, service_receipt = capture.get("service-metadata", SERVICE + "?f=pjson")
    available = {item["id"] for item in service.get("layers", [])}
    if any(LAYERS[p][role] not in available for p in parameters for role in ("prediction", "calibration")):
        raise ValueError("Original public USGS service no longer exposes selected layers")
    layers = [_layer(capture, parameter, role, comids)
              for parameter in parameters for role in ("prediction", "calibration")]
    # The publisher does not offer historic-moment queries. Retain each actual
    # retrieval time, original ID set and complete body rather than claim an
    # atomic database snapshot across requests.
    bundle = {
        "schema": BUNDLE, "title": value["title"], "service": SERVICE,
        "source_urls": SOURCE_URLS, "vintage": VINTAGE,
        "selection_sha256": _sha(body), "selection": value, "source_binding_files": binding_files, "context_files": context_files,
        "service_metadata": service_receipt, "layers": layers,
        "http_responses": capture.receipts,
        "lineage": "Prediction rows are the Southeast SPARROW model. Calibration rows retain nitrogen/phosphorus ACTUAL and PLOAD_TOTA, sediment ACTUAL_MT and PLOAD_MT, plus unchanged CONSTITUEN and TSS_CONV separately; source use in calibration remains explicit.",
        "capture_period": {"start": min(r["received_at"] for r in capture.receipts),
                           "end": max(r["received_at"] for r in capture.receipts)},
        "notes": [
            "COMID_ORIG selects published prediction reaches; current NLDI identities are retained in selection.source_bindings.",
            "Missing matches remain listed; no nearby or similarly named reach is substituted.",
            "Original JSON null becomes an empty CSV cell; every exact original HTTP body remains a companion.",
            "CSV decimals retain their parsed decimal text. The original HTTP number spelling remains in the unchanged response.",
            "The collection retains all selected object IDs and geometries. It is not a rerun of SPARROW or the local native model.",
        ],
    }
    _write(root / "bundle.json", _bytes(bundle))
    common_paths = ["selection.json", "bundle.json", service_receipt["path"],
                    service_receipt["path"].replace(".json", ".receipt.json")]
    common_paths.extend(item["path"] for item in binding_files)
    common_paths.extend(producer_paths)
    common_paths.extend(item["path"] for item in context_files)
    all_paths = list(common_paths)
    for collected in layers:
        all_paths.append(collected["table"])
        for receipt in [collected["metadata"], collected["id_selection"]] + collected["pages"]:
            all_paths.extend((receipt["path"], receipt["path"].replace(".json", ".receipt.json")))
    entries = []
    for layer in layers:
        # A single selected prediction table reopens with the complete collection,
        # including the other original calibration/reference rows it cites.
        companions = [name for name in dict.fromkeys(all_paths) if name != layer["table"]]
        table = root / layer["table"]
        entries.append({
            "id": "usgs-sparrow-se2012-" + layer["parameter"] + "-" + layer["role"],
            "kind": "table", "title": "USGS Southeast SPARROW " + layer["parameter"] + " " + layer["role"],
            "uri": SERVICE + "/" + str(layer["layer"]), "vintage": VINTAGE,
            "path": layer["table"], "sha256": _sha(table.read_bytes()),
            "companions": [{"path": name, "sha256": _sha((root / name).read_bytes())}
                           for name in dict.fromkeys(companions)],
        })
    manifest = {
        "schema": "upstate.sources/v1", "title": value["title"],
        "captured_at": bundle["capture_period"]["end"], "entries": entries,
        "scope": {"selected_comids": comids, "parameters": parameters,
                  "source_bindings": value["source_bindings"]},
        "notes": bundle["notes"] + [bundle["lineage"]],
    }
    _write(complete, _bytes(manifest))
    return verify(root)


def receive(packet_path, selection_path, output):
    """Open the complete five-reach publisher packet without another HTTP call."""
    packet_path = Path(packet_path).resolve(strict=True)
    packet_body = packet_path.read_bytes()
    packet = _json(packet_body)
    if packet.get("schema") != "commons.original-public-source-bundle.v1":
        raise ValueError("Select the complete original public-source packet")
    selection_path = Path(selection_path).resolve(strict=True)
    selection_body = selection_path.read_bytes()
    value, comids, parameters = _selection(selection_body)
    selected = packet.get("selection", {})
    expected_ids = {int(v) for v in comids}
    if (not isinstance(selected.get("ids"), list)
            or {_numeric_id(v) for v in selected["ids"]} != expected_ids
            or len(selected["ids"]) != len(comids)
            or selected.get("returnGeometry") is not False):
        raise ValueError("Received original packet has a different reach/geometry selection")
    required = {(LAYERS[p]["prediction"], kind) for p in parameters
                for kind in ("layer", "prediction")}
    supplied = {}
    for item in packet.get("files", []):
        key = (_numeric_id(item.get("layer")), item.get("kind"))
        if key in supplied:
            raise ValueError("Duplicate original packet layer/role")
        body = item.get("content")
        if not isinstance(body, str):
            raise ValueError("Packet must contain each complete original response body")
        raw = body.encode("utf-8")
        if item.get("bytes") != len(raw) or item.get("sha256") != _sha(raw):
            raise ValueError("Received original response body/hash differs")
        supplied[key] = item
    if set(supplied) != required:
        raise ValueError("Receive the complete selected prediction/schema set")
    # Preflight every response and retain decoded Decimal values for the CSVs.
    decoded = {}
    for parameter in parameters:
        layer = LAYERS[parameter]["prediction"]
        metadata_item = supplied[(layer, "layer")]
        if metadata_item.get("source_url") != SERVICE + "/" + str(layer) + "?f=pjson":
            raise ValueError("Original layer metadata URL differs")
        metadata = _json(metadata_item["content"].encode("utf-8"))
        if metadata.get("id") != layer or metadata.get("error"):
            raise ValueError("Original layer metadata differs")
        fields = [f["name"] for f in metadata.get("fields", [])
                  if f.get("type") != "esriFieldTypeGeometry"]
        oid_fields = [f["name"] for f in metadata.get("fields", [])
                      if f.get("type") == "esriFieldTypeOID"]
        if (len(fields) != len(set(fields)) or len(oid_fields) != 1
                or set(fields) & set(RESERVED)
                or not {"COMID", "COMID_ORIG", "ACCL", "INCL"}.issubset(fields)):
            raise ValueError("Received publisher attribute schema differs")
        item = supplied[(layer, "prediction")]
        url = urlsplit(item.get("source_url", ""))
        query = parse_qs(url.query, keep_blank_values=True)
        expected_where = "COMID_ORIG IN (" + ",".join(str(_numeric_id(v)) for v in selected["ids"]) + ")"
        if (url._replace(query="", fragment="").geturl() != SERVICE + "/" + str(layer) + "/query"
                or url.fragment or query.get("where") != [expected_where]
                or query.get("outFields") != ["*"] or query.get("returnGeometry") != ["false"]):
            raise ValueError("Original query does not select the complete intended attributes/reaches")
        page = _json(item["content"].encode("utf-8"))
        rows = page.get("features")
        if (page.get("error") or page.get("exceededTransferLimit")
                or not isinstance(rows, list) or len(rows) != len(comids)):
            raise ValueError("Received selected response is incomplete")
        seen_ids, seen_comids = set(), set()
        for feature in rows:
            attrs = feature.get("attributes")
            if not isinstance(attrs, dict) or set(attrs) != set(fields):
                raise ValueError("Received feature lacks an original publisher field")
            ident = _numeric_id(attrs.get(oid_fields[0]))
            comid = _numeric_id(attrs.get("COMID_ORIG"))
            if ident in seen_ids or comid in seen_comids or comid not in expected_ids:
                raise ValueError("Duplicate or unexpected received original feature")
            if any(isinstance(v, Decimal) and not v.is_finite() for v in attrs.values()):
                raise ValueError("Received original numeric field is nonfinite")
            seen_ids.add(ident)
            seen_comids.add(comid)
        if seen_comids != expected_ids:
            raise ValueError("Received packet does not cover every selected original reach")
        decoded[parameter] = (fields, oid_fields[0], rows)

    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    if (root / "source-manifest.json").exists():
        if ((root / "selection.json").read_bytes() != selection_body
                or (root / "original/received-packet.json").read_bytes() != packet_body):
            raise ValueError("Use a new output directory for another received source edition")
        return verify(root)
    _write(root / "selection.json", selection_body)
    _write(root / "original/received-packet.json", packet_body)
    all_paths = ["selection.json", "original/received-packet.json", "bundle.json"]
    binding_files, context_files = [], []
    for category, items in (("bindings", value["source_bindings"]),
                            ("context", value.get("context_sources", []))):
        for item in items:
            original = (selection_path.parent / item["source_path"]).resolve(strict=True)
            raw = original.read_bytes()
            if _sha(raw) != item["source_sha256"]:
                raise ValueError("Original selected source changed: " + str(original))
            relative = category + "/" + item["source_sha256"] + "-" + original.name
            _write(_member(root, relative), raw)
            record = {"path": relative, "bytes": len(raw), "sha256": _sha(raw), "source": item}
            (binding_files if category == "bindings" else context_files).append(record)
            all_paths.append(relative)
    for name in ("sparrow_source.py", "SPARROW_SOURCES.md", "common.py", "verified_files.py"):
        relative = "producer/" + name
        _write(_member(root, relative), Path(__file__).with_name(name).read_bytes())
        all_paths.append(relative)
    receipts, layers = [], []
    for parameter in parameters:
        layer = LAYERS[parameter]["prediction"]
        originals = {}
        for kind in ("layer", "prediction"):
            item = supplied[(layer, kind)]
            relative = "original/" + parameter + "-" + kind + ".json"
            raw = item["content"].encode("utf-8")
            _write(_member(root, relative), raw)
            receipt = {
                "path": relative, "url": item["source_url"], "bytes": len(raw),
                "sha256": _sha(raw), "transport": "retained-original-response",
                "source_reference": packet.get("source_claim"),
                "file_upload_id": item.get("file_upload_id"),
                "query_started_before": item.get("query_started_before"),
                "query_completed_after": item.get("query_completed_after"),
                "status": item.get("http_status"), "response_headers": item.get("response_headers"),
                "received_packet_sha256": _sha(packet_body),
            }
            _write(_member(root, relative.replace(".json", ".receipt.json")), _bytes(receipt))
            all_paths.extend((relative, relative.replace(".json", ".receipt.json")))
            originals[kind] = receipt
            receipts.append(receipt)
        fields, oid, rows = decoded[parameter]
        columns = list(RESERVED) + fields
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        for feature in rows:
            attrs = feature["attributes"]
            row = dict(attrs)
            row.update({
                "reference_id": "usgs-sparrow-se2012-" + str(layer) + "-" + str(_numeric_id(attrs[oid])),
                "reference_parameter": parameter, "reference_evidence_kind": "external_model_estimate",
                "reference_role": "prediction", "reference_layer": str(layer),
                "reference_response_path": originals["prediction"]["path"],
                "reference_response_sha256": originals["prediction"]["sha256"],
            })
            writer.writerow({key: "" if row[key] is None else str(row[key]) for key in columns})
        relative = "tables/" + parameter + "-prediction.csv"
        _write(_member(root, relative), stream.getvalue().encode("utf-8"))
        all_paths.append(relative)
        layers.append({
            "parameter": parameter, "role": "prediction", "layer": layer, "table": relative,
            "metadata": originals["layer"], "id_selection": None, "pages": [originals["prediction"]],
            "rows": len(rows), "columns": columns, "selected_comids": comids,
            "matched_comids": comids, "unmatched_comids": [], "selection_field": "COMID_ORIG",
            "geometry": "Original query explicitly requested returnGeometry=false; original reach bindings accompany this table.",
            "completeness": "One original feature for every exact requested COMID_ORIG; no transfer-limit flag. No object-ID enumeration response was supplied or invented.",
        })
    bundle = {
        "schema": BUNDLE, "title": value["title"], "service": SERVICE,
        "source_urls": SOURCE_URLS, "vintage": VINTAGE, "selection": value,
        "selection_sha256": _sha(selection_body), "source_binding_files": binding_files,
        "context_files": context_files, "layers": layers, "http_responses": receipts,
        "received_packet_sha256": _sha(packet_body),
        "original_packet_operation": packet.get("operation"),
        "lineage": "These are the received current mapper predictions. Original older calibration files remain a distinct edition; no prediction, target, unit or measurement-method adjustment is substituted.",
        "notes": [
            "All source attributes and complete original response bodies are retained.",
            "Original request times and unknown response headers remain as delivered in the source packet.",
            "CSV decimal values avoid binary floating-point rounding; JSON null becomes an empty cell.",
            "The original source packet records all eleven differences between old PLOAD and received ACCL values.",
            "Select documented original field, unit, spatial support and period in the comparison editor.",
        ],
    }
    _write(root / "bundle.json", _bytes(bundle))
    entries = []
    for layer in layers:
        entries.append({
            "id": "usgs-sparrow-se2012-received-" + layer["parameter"] + "-prediction",
            "kind": "table", "title": "USGS Southeast SPARROW received " + layer["parameter"] + " predictions",
            "uri": SERVICE + "/" + str(layer["layer"]), "vintage": VINTAGE,
            "path": layer["table"], "sha256": _sha((root / layer["table"]).read_bytes()),
            "companions": [{"path": name, "sha256": _sha((root / name).read_bytes())}
                           for name in dict.fromkeys(all_paths) if name != layer["table"]],
        })
    _write(root / "source-manifest.json", _bytes({
        "schema": "upstate.sources/v1", "title": value["title"], "entries": entries,
        "scope": {"selected_comids": comids, "parameters": parameters},
        "notes": bundle["notes"] + [bundle["lineage"]],
    }))
    return verify(root)


def verify(output):
    root = Path(output).resolve(strict=True)
    manifest = json.loads((root / "source-manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Retain the original Workspace source manifest")
    selection_body = (root / "selection.json").read_bytes()
    selection, comids, parameters = _selection(selection_body)
    bundle = json.loads((root / "bundle.json").read_text(encoding="utf-8"))
    if (bundle.get("schema") != BUNDLE or bundle.get("selection_sha256") != _sha(selection_body)
            or bundle.get("selection") != selection):
        raise ValueError("Retained source selection changed")
    received = "received_packet_sha256" in bundle
    roles = ("prediction",) if received else ("prediction", "calibration")
    expected_layers = {(parameter, role, LAYERS[parameter][role])
                       for parameter in parameters for role in roles}
    layers = bundle.get("layers")
    if (not isinstance(layers, list) or len(layers) != len(expected_layers)
            or {(v.get("parameter"), v.get("role"), v.get("layer")) for v in layers} != expected_layers):
        raise ValueError("Retain every selected original constituent and source-role table")
    paths = {"selection.json", "bundle.json", "producer/sparrow_source.py", "producer/SPARROW_SOURCES.md", "producer/common.py", "producer/verified_files.py"}
    if received:
        paths.add("original/received-packet.json")
        if _sha((root / "original/received-packet.json").read_bytes()) != bundle["received_packet_sha256"]:
            raise ValueError("Original received packet changed")
    originals = []
    if not received:
        originals.append(bundle["service_metadata"])
    for key in ("source_binding_files", "context_files"):
        items = bundle.get(key, [])
        if len(items) != len(selection["source_bindings"] if key == "source_binding_files" else selection.get("context_sources", [])):
            raise ValueError("Retain every original reach binding and context document")
        for item in items:
            body = _member(root, item["path"]).read_bytes()
            if len(body) != item["bytes"] or _sha(body) != item["sha256"]:
                raise ValueError("Original selected source differs: " + item["path"])
            paths.add(item["path"])
    for layer in layers:
        paths.add(layer["table"])
        originals.append(layer["metadata"])
        if layer.get("id_selection") is not None:
            originals.append(layer["id_selection"])
        elif not received:
            raise ValueError("Retain the original complete object-ID response")
        originals.extend(layer["pages"])
    response_paths = [r["path"] for r in originals]
    captured = bundle.get("http_responses", [])
    if (len(response_paths) != len(set(response_paths))
            or len(captured) != len(originals)
            or {r["path"] for r in captured} != set(response_paths)):
        raise ValueError("Retain the complete original response set")
    by_path = {r["path"]: r for r in captured}
    for receipt in originals:
        if by_path[receipt["path"]] != receipt:
            raise ValueError("Original response and layer receipt differ")
        paths.update((receipt["path"], receipt["path"].replace(".json", ".receipt.json")))
    entries = manifest.get("entries")
    if (not isinstance(entries, list) or len(entries) != len(layers)
            or len({e.get("id") for e in entries}) != len(entries)
            or {e.get("path") for e in entries} != {v["table"] for v in layers}):
        raise ValueError("Source manifest must contain each complete original table exactly once")
    verified = {}
    for entry in entries:
        if entry.get("kind") != "table":
            raise ValueError("Original source entry must remain a table")
        companions = entry.get("companions", [])
        names = [item["path"] for item in companions]
        if len(names) != len(set(names)) or set(names) != paths - {entry["path"]}:
            raise ValueError("A selected table lacks its complete original companion collection")
        for item in [entry] + companions:
            if item["path"] not in verified:
                verified[item["path"]] = _sha(_member(root, item["path"]).read_bytes())
            if verified[item["path"]] != item["sha256"]:
                raise ValueError("Retained source member changed: " + item["path"])
    for receipt in originals:
        response = _member(root, receipt["path"]).read_bytes()
        saved = json.loads(_member(root, receipt["path"].replace(".json", ".receipt.json")).read_text(encoding="utf-8"))
        if len(response) != receipt["bytes"] or _sha(response) != receipt["sha256"] or saved != receipt:
            raise ValueError("Retained original response or receipt changed")
    for layer in layers:
        with _member(root, layer["table"]).open(encoding="utf-8", newline="") as stream:
            reader = csv.reader(stream)
            if next(reader, None) != layer["columns"] or sum(1 for _ in reader) != layer["rows"]:
                raise ValueError("Original CSV view differs from its complete recorded table")
    return {"schema": "upstate.sparrow-source-summary/v1", "manifest": str(root / "source-manifest.json"),
            "comids": comids, "parameters": parameters, "http_responses": len(originals),
            "tables": [{"parameter": v["parameter"], "role": v["role"], "rows": v["rows"],
                        "matched_comids": v["matched_comids"], "unmatched_comids": v["unmatched_comids"]}
                       for v in layers]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    get = sub.add_parser("acquire", help="Retain all original selected USGS reach rows and source geometry")
    get.add_argument("selection")
    get.add_argument("output")
    get.add_argument("--retained-responses", help="Reuse exact original provider response bodies from a retained index")
    received = sub.add_parser("receive", help="Open a complete original received prediction packet without HTTP")
    received.add_argument("packet")
    received.add_argument("selection")
    received.add_argument("output")
    check = sub.add_parser("verify", help="Read and verify an existing complete retained source edition")
    check.add_argument("output")
    args = parser.parse_args()
    result = (acquire(args.selection, args.output, retained_index=args.retained_responses)
              if args.command == "acquire" else
              receive(args.packet, args.selection, args.output)
              if args.command == "receive" else verify(args.output))
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

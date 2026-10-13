"""Receive retained ThinkGIS indexes and original whole-feature overlay geometry.

Uses the existing upstate.sources/v1 intake. Acquisition is explicit and resumable;
preparation is offline. Native IDs and source strings are never inferred from PINs.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from model.common import (
    atomic_bytes, atomic_json, describe_file, digest, held, now, read_json,
    relative_file, retain_file, verify_file,
)

INDEX_SCHEMA = "upstate.thinkgis-original-index/v1"
PREPARED_SCHEMA = "upstate.thinkgis-prepared-index/v1"
CAPTURE_SCHEMA = "upstate.thinkgis-feature-capture/v1"
PREFIX = "_thinkgis_"
METHOD = "upstate.thinkgis/z19-original-overlay/v1"
WORLD = 256 * (2 ** 19)
MAX_RESPONSE = 16 * 1024 * 1024


def _integer(value, label, minimum=0):
    if isinstance(value, bool):
        raise ValueError(label + " must be an integer")
    text = str(value)
    if not re.fullmatch(r"\d+", text) or int(text) < minimum:
        raise ValueError(label + " must be a nonnegative integer")
    return int(text)


def _https_origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ("", "/")):
        raise ValueError("The county viewer must be its exact public HTTPS origin")
    return parsed.scheme + "://" + parsed.netloc


def _source_name(item):
    name = item.get("path")
    if name:
        return name
    names = parse_qs(urlsplit(item.get("file_uri", "")).query).get("name", [])
    if len(names) != 1 or Path(names[0]).name != names[0]:
        raise ValueError("Retain each original page under its manifest filename or path")
    return names[0]


def _bank(root, source, relative, expected=None):
    obj = retain_file(root, source, expected)
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    record = {"path": relative, "sha256": obj["sha256"], "bytes": obj["bytes"]}
    if target.exists():
        verify_file(root, record)
    else:
        try:
            os.link(root / obj["object"], target)
        except FileExistsError:
            verify_file(root, record)
    return record


def _emit_csv(path, fields, rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="raise")
    writer.writeheader()
    writer.writerows(rows)
    atomic_bytes(path, stream.getvalue().encode("utf-8"), immutable=True)


def _entry(root, path, *, source_id, title, kind, role, uri, vintage, companions, metadata):
    return {
        "id": source_id, "title": title, "kind": kind, "role": role,
        "uri": uri, "vintage": vintage, **describe_file(root, path),
        "companions": companions, "metadata": metadata,
    }


def read_index(manifest, original_root):
    """Verify the complete retained ordinal sequence and yield original records."""
    manifest, original_root = Path(manifest).resolve(strict=True), Path(original_root).resolve(strict=True)
    manifest_body = manifest.read_bytes()
    value = json.loads(manifest_body)
    manifest_sha256 = hashlib.sha256(manifest_body).hexdigest()
    if value.get("schema") != INDEX_SCHEMA:
        raise ValueError("Select the complete original ThinkGIS index manifest")
    source = value["source"]
    dsid = _integer(source["county_dsid"], "DSID")
    origin = _https_origin(source["county_viewer"])
    fields = value.get("fields")
    if (not isinstance(fields, list) or not fields
            or any(not isinstance(f, str) or not f or f.startswith(PREFIX) for f in fields)
            or len(set(fields)) != len(fields)):
        raise ValueError("Preserve unique original field names, without adapter-reserved prefixes")
    expected = _integer(value["inventory"]["records"], "Original record count", 1)
    pages = source.get("original_capture_pages")
    if not isinstance(pages, list) or not pages:
        raise ValueError("The original index manifest has no retained response pages")
    records, retained, seen, next_ordinal = [], [], set(), 0
    for item in pages:
        first = _integer(item["ordinal"], "First ordinal")
        count = _integer(item["count"], "Page count", 1)
        if first != next_ordinal or _integer(item["last"], "Last ordinal") != first + count - 1:
            raise ValueError("Original index pages must cover every ordinal exactly once in order")
        path = relative_file(original_root, _source_name(item))
        verified = {"path": path.relative_to(original_root).as_posix(),
                    "bytes": item["bytes"], "sha256": item["sha256"]}
        verify_file(original_root, verified)
        text = path.read_bytes().decode("utf-8")
        rows = text.split("\x1e")
        if rows and rows[-1] == "":
            rows.pop()
        if len(rows) != count:
            raise ValueError("Original index response count differs at ordinal " + str(first))
        for offset, row in enumerate(rows):
            values = row.split("\x1f")
            if len(values) != len(fields) + 2:
                raise ValueError("Original index field count differs at ordinal " + str(first + offset))
            ordinal = _integer(values[0], "Native source ordinal")
            fid = str(_integer(values[1], "Native feature ID"))
            if ordinal != first + offset or fid in seen:
                raise ValueError("Original index repeats a FID or changes its ordinal sequence")
            seen.add(fid)
            records.append({"fid": fid, "ordinal": ordinal,
                            "attributes": dict(zip(fields, values[2:])),
                            "page_sha256": item["sha256"]})
        retained.append({"source": path, "record": item})
        next_ordinal += count
    if next_ordinal != expected:
        raise ValueError("Retained index is incomplete: " + str(next_ordinal) + "/" + str(expected))
    return value, {"dsid": dsid, "origin": origin, "fields": fields,
                   "records": records, "retained": retained, "manifest_sha256": manifest_sha256}


def prepare_index(manifest, original_root, output, *, vintage):
    """Export every original attribute, complete identity map, and portable source entry."""
    if not vintage or not isinstance(vintage, str):
        raise ValueError("Record the original source capture edition")
    value, parsed = read_index(manifest, original_root)
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with held(root / "prepare.lock", blocking=False):
        source = _bank(root, Path(manifest), "original/index-manifest.json", parsed["manifest_sha256"])
        companions = [source]
        for item in parsed["retained"]:
            record = item["record"]
            companions.append(_bank(root, item["source"],
                "original/index/" + str(record["ordinal"]).zfill(6) + ".txt", record["sha256"]))
        identity_fields = [PREFIX + name for name in ("dsid", "fid", "source_ordinal", "index_page_sha256")]
        rows = [{identity_fields[0]: parsed["dsid"], identity_fields[1]: r["fid"],
                 identity_fields[2]: r["ordinal"], identity_fields[3]: r["page_sha256"],
                 **r["attributes"]} for r in parsed["records"]]
        _emit_csv(root / "county-index.csv", identity_fields + parsed["fields"], rows)
        atomic_bytes(root / "county-index.jsonl", b"".join(
            (json.dumps(row, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode("utf-8")
            for row in rows), immutable=True)
        pins = {}
        for record in parsed["records"]:
            for field in ("PIN", "taxMapNumber"):
                original = record["attributes"].get(field, "")
                key = original.strip().rstrip(".")
                if key:
                    matches = pins.setdefault(key, {})
                    matches.setdefault(record["fid"], []).append(field)
        summary = {
            "schema": PREPARED_SCHEMA, "source_manifest_sha256": source["sha256"],
            "dsid": parsed["dsid"], "origin": parsed["origin"], "fields": parsed["fields"],
            "records": len(rows), "distinct_feature_ids": len(rows), "vintage": vintage,
            "original_pages": companions[1:],
            "nullable_PIN_count": sum(not r["attributes"].get("PIN", "").strip() for r in parsed["records"]),
            "multiple_reference_features": {pin: matches for pin, matches in sorted(pins.items()) if len(matches) > 1},
            "reference_matching": "Trim surrounding whitespace and trailing full stops only; original strings remain unchanged.",
            "geometry_coverage": "Attribute index only; no polygon coverage inferred.",
        }
        atomic_json(root / "index.json", summary, immutable=True)
        companions.extend(describe_file(root, root / name) for name in ("county-index.jsonl", "index.json"))
        entry = _entry(root, root / "county-index.csv",
            source_id="thinkgis-index-" + digest(summary)[:20],
            title="Original ThinkGIS county parcel attribute index",
            kind="table", role="PARCEL_INDEX", uri=parsed["origin"] + "/",
            vintage=vintage, companions=companions, metadata=summary)
        atomic_json(root / "sources.json", {"schema": "upstate.sources/v1",
            "title": entry["title"], "entries": [entry]}, immutable=True)
        return {"manifest": str(root / "sources.json"), "source_id": entry["id"],
                "records": len(rows), "index": str(root / "index.json")}


def _prepared_index(directory):
    root = Path(directory).resolve(strict=True)
    index = read_json(root / "index.json")
    if index.get("schema") != PREPARED_SCHEMA:
        raise ValueError("Select an existing prepared ThinkGIS index")
    source_manifest = read_json(root / "sources.json")
    if source_manifest.get("schema") != "upstate.sources/v1" or len(source_manifest["entries"]) != 1:
        raise ValueError("Original index source collection differs")
    entry = source_manifest["entries"][0]
    for item in [entry, *entry["companions"]]:
        verify_file(root, item)
    with (root / "county-index.jsonl").open(encoding="utf-8") as stream:
        rows = [json.loads(line) for line in stream if line.strip()]
    by_id = {row[PREFIX + "fid"]: row for row in rows}
    if len(by_id) != index["records"] or len(rows) != len(by_id):
        raise ValueError("Retained native index identities differ")
    return root, index, by_id, entry


def _xml(body):
    if re.search(br"<!\s*(?:DOCTYPE|ENTITY)\b", body, re.I):
        raise ValueError("Original overlay must not contain external entity declarations")
    tree = ET.fromstring(body)
    if tree.tag != "overlay":
        raise ValueError("Expected the county's original overlay response")
    return tree


def _feature_url(index, fid):
    return index["origin"] + "/tgis/getftr.aspx?" + urlencode({"D": index["dsid"], "F": fid, "Z": 1})


def _save_capture(root, status, complete, ids):
    candidate = {**status, "features": [complete[key] for key in ids if key in complete],
                 "complete_features": len(complete), "selected_features": len(ids),
                 "state": "complete" if len(complete) == len(ids) else "incomplete"}
    path = root / "capture.json"
    previous = read_json(path) if path.exists() else None
    # A completed replay must not change the immutable preparation's source hash.
    if previous is not None and (
            {key: value for key, value in previous.items() if key != "updated_at"}
            == {key: value for key, value in candidate.items() if key != "updated_at"}):
        status.clear()
        status.update(previous)
        return
    candidate["updated_at"] = now()
    status.clear()
    status.update(candidate)
    atomic_json(path, status)


def _reject_overlay(root, status, fid, uri, body, error, record, receipt_path=None):
    """Preserve unusable original bytes and provenance before freeing a retry path."""
    rejected_root = root / "rejected" / fid
    body_sha = hashlib.sha256(body).hexdigest()
    body_path = rejected_root / (body_sha + ".xml")
    atomic_bytes(body_path, body, immutable=True)
    receipt = None
    if receipt_path is not None and receipt_path.exists():
        original_receipt = receipt_path.read_bytes()
        receipt_copy = rejected_root / (hashlib.sha256(original_receipt).hexdigest() + ".receipt.json")
        atomic_bytes(receipt_copy, original_receipt, immutable=True)
        receipt = describe_file(root, receipt_copy)
    rejection = {"fid": fid, "source_url": uri, "observed_at": now(),
                 "error": {"type": type(error).__name__, "message": str(error)},
                 "body": describe_file(root, body_path), "original_record": record,
                 "original_receipt": receipt}
    attempt_path = rejected_root / (digest(rejection) + ".attempt.json")
    atomic_json(attempt_path, rejection, immutable=True)
    status.setdefault("rejected_attempts", []).append({
        "fid": fid, "body": rejection["body"],
        "original_receipt": receipt, "attempt": describe_file(root, attempt_path)})
    return rejection["error"]


def capture_features(index_directory, output, feature_ids, *, retry_failed=False, interval=1.0, timeout=60.0):
    """Continue explicit FIDs, admitting only original responses with usable paths."""
    _, index, records, _ = _prepared_index(index_directory)
    ids = [str(_integer(fid, "Selected FID")) for fid in feature_ids]
    if not ids or len(set(ids)) != len(ids) or set(ids) - set(records):
        raise ValueError("Select unique actual FIDs from the retained index")
    if not math.isfinite(interval) or interval < 0 or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("Use a nonnegative provider interval and positive timeout")
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    plan = {"schema": CAPTURE_SCHEMA, "index_manifest_sha256": index["source_manifest_sha256"],
            "dsid": index["dsid"], "origin": index["origin"], "feature_ids": ids}
    with held(root / "capture.lock", blocking=False):
        atomic_json(root / "plan.json", plan, immutable=True)
        status = read_json(root / "capture.json") if (root / "capture.json").exists() else {
            **plan, "started_at": now(), "features": [], "failures": {}}
        if any(status.get(k) != v for k, v in plan.items()):
            raise ValueError("Capture state belongs to a different retained FID selection")
        complete = {r["fid"]: r for r in status["features"]}
        if len(complete) != len(status["features"]) or set(complete) - set(ids):
            raise ValueError("Capture repeats or introduces an unselected FID")
        # Reconcile bodies left by an interrupted receive and older receipts which
        # admitted an empty overlay. Preserve rejected originals before removing
        # their successful-path names; only --retry-failed starts another request.
        for fid in ids:
            uri = _feature_url(index, fid)
            path = root / "original" / (fid + ".xml")
            receipt_path = root / "receipts" / (fid + ".json")
            record = complete.get(fid)
            if receipt_path.exists():
                receipt = read_json(receipt_path)
                if record is not None and receipt != record:
                    raise ValueError("Completed feature differs from its retained receipt")
                record = receipt
            if record is not None:
                if (record.get("fid") != fid or record.get("source_url") != uri
                        or record.get("path") != "original/" + fid + ".xml"):
                    raise ValueError("Retained feature receipt belongs to another native request")
                body = verify_file(root, record).read_bytes()
            elif path.exists():
                body = path.read_bytes()
                record = {"fid": fid, "source_url": uri, "received_at": None,
                          "headers": {}, "recovered_original_body": True,
                          **describe_file(root, path)}
            else:
                continue
            try:
                decode_overlay(body)
            except (ValueError, ET.ParseError) as exc:
                error = _reject_overlay(root, status, fid, uri, body, exc, record, receipt_path)
                complete.pop(fid, None)
                status["failures"][fid] = {**error, "source_url": uri, "observed_at": now()}
                _save_capture(root, status, complete, ids)
                # These exact bytes and the original receipt are already banked.
                receipt_path.unlink(missing_ok=True)
                path.unlink(missing_ok=True)
            else:
                atomic_json(receipt_path, record, immutable=True)
                complete[fid] = record
                status["failures"].pop(fid, None)
        _save_capture(root, status, complete, ids)
        last_request = 0.0
        for fid in ids:
            if fid in complete or fid in status["failures"] and not retry_failed:
                continue
            time.sleep(max(0.0, interval - (time.monotonic() - last_request)))
            uri = _feature_url(index, fid)
            received_at = now()
            try:
                path = root / "original" / (fid + ".xml")
                receipt_path = root / "receipts" / (fid + ".json")
                last_request = time.monotonic()
                request = Request(uri, headers={"User-Agent": "UpperSavannah-OriginalSource/1.0",
                                               "Accept-Encoding": "identity"})
                with urlopen(request, timeout=timeout) as response:
                    if response.status != 200 or response.geturl() != uri:
                        raise ValueError("Original feature response changed status or redirected")
                    body = response.read(MAX_RESPONSE + 1)
                    headers = {key: response.headers.get(key) for key in
                               ("Content-Type", "ETag", "Last-Modified", "Content-Length")}
                if len(body) > MAX_RESPONSE:
                    raise ValueError("Original feature response exceeds 16 MiB")
                record = {"fid": fid, "source_url": uri, "received_at": received_at,
                          "headers": headers, "path": "original/" + fid + ".xml",
                          "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                try:
                    decode_overlay(body)
                except (ValueError, ET.ParseError) as exc:
                    _reject_overlay(root, status, fid, uri, body, exc, record)
                    raise
                atomic_bytes(path, body, immutable=True)
                atomic_json(receipt_path, record, immutable=True)
                complete[fid] = record
                status["failures"].pop(fid, None)
            except Exception as exc:
                error = {"type": type(exc).__name__, "message": str(exc),
                         "source_url": uri, "observed_at": now()}
                if isinstance(exc, HTTPError):
                    error["http_status"] = exc.code
                    error["retry_after"] = exc.headers.get("Retry-After")
                status["failures"][fid] = error
            _save_capture(root, status, complete, ids)
            print(json.dumps({"stage": "original-thinkgis-feature", "fid": fid,
                              "state": status["state"], "complete": len(complete), "selected": len(ids)}), flush=True)
            if status["failures"].get(fid, {}).get("http_status") in (429, 503):
                break
        return status


def decode_overlay(body):
    """Return complete original z19 paths and decoded WGS84 coordinates."""
    tree = _xml(body)
    paths = []
    for number, element in enumerate(tree.findall("poly")):
        values = (element.text or "").split(",")
        if len(values) < 6 or (len(values) - 2) % 2:
            raise ValueError("Original poly command has an invalid coordinate count")
        integers = []
        for value in values[2:]:
            if not re.fullmatch(r"-?\d+", value.strip()):
                raise ValueError("Original poly coordinates must be integer world pixels")
            integers.append(int(value))
        x, y = integers[:2]
        world = [[x, y]]
        for offset in range(2, len(integers), 2):
            x += integers[offset]
            y += integers[offset + 1]
            world.append([x, y])
        if any(not (0 <= x <= WORLD and 0 <= y <= WORLD) for x, y in world):
            raise ValueError("Original z19 coordinate is outside the supported world")
        coordinates = []
        for x, y in world:
            lon = (x / (2 ** 19) - 128.0) / (256.0 / 360.0)
            rad = (y / (2 ** 19) - 128.0) / (-256.0 / (2 * math.pi))
            lat = (2 * math.atan(math.exp(rad)) - math.pi / 2) * 180 / math.pi
            coordinates.append([lon, lat])
        paths.append({"path_index": number, "original_style": values[:2],
                      "world_pixels_z19": world, "coordinates": coordinates,
                      "closed": len(world) >= 4 and world[0] == world[-1]})
    if not paths:
        raise ValueError("Original overlay contains no poly boundary commands")
    return paths


def _polygon_geometry(paths, assignments=None):
    """Use whole simple disjoint rings, or an explicit original ring assignment."""
    from shapely.geometry import MultiPolygon, Polygon, mapping
    if any(not path["closed"] for path in paths):
        return None, "original_open_boundary"
    rings = [path["coordinates"] for path in paths]
    polygons = [Polygon(ring) for ring in rings]
    if any(p.is_empty or not p.is_valid or p.area <= 0 for p in polygons):
        return None, "original_boundary_not_a_simple_valid_ring"
    if assignments is None:
        for i, a in enumerate(polygons):
            for b in polygons[i + 1:]:
                if a.intersection(b).area > 0:
                    return None, "ring_role_assignment_required_for_nested_or_overlapping_boundaries"
        result = polygons[0] if len(polygons) == 1 else MultiPolygon(polygons)
        basis = "simple_closed_mutually_disjoint_original_rings"
    else:
        if not isinstance(assignments, list) or not assignments:
            raise ValueError("Ring assignments must list original exterior and hole indices")
        used, prepared = [], []
        for assignment in assignments:
            if not isinstance(assignment, dict) or set(assignment) != {"exterior", "holes"}:
                raise ValueError("Each assignment requires exterior and holes")
            outer = _integer(assignment["exterior"], "Exterior ring index")
            holes = assignment["holes"]
            if not isinstance(holes, list):
                raise ValueError("Original hole indices must be a list")
            indices = [outer] + [_integer(h, "Hole ring index") for h in holes]
            if any(i >= len(rings) for i in indices):
                raise ValueError("Assigned ring is absent from original geometry")
            used.extend(indices)
            geometry = Polygon(rings[outer], [rings[i] for i in indices[1:]])
            if not geometry.is_valid or geometry.is_empty or geometry.area <= 0:
                raise ValueError("Explicit ring roles do not form valid original polygon topology")
            prepared.append(geometry)
        if sorted(used) != list(range(len(rings))):
            raise ValueError("Assign every original ring exactly once")
        result = prepared[0] if len(prepared) == 1 else MultiPolygon(prepared)
        basis = "explicit_retained_original_ring_assignment"
    if not result.is_valid:
        return None, "original_parts_do_not_form_valid_multipolygon"
    return mapping(result), basis


def prepare_geometry(index_directory, capture_directory, output, *,
                     ring_assignments=None, allow_partial=False, boundary_only=False):
    """Retain whole original boundaries and prepare unambiguous parcel polygons."""
    index_root, index, indexed, index_entry = _prepared_index(index_directory)
    capture_root, root = Path(capture_directory).resolve(strict=True), Path(output).resolve()
    plan = read_json(capture_root / "plan.json")
    capture = read_json(capture_root / "capture.json")
    if (plan.get("schema") != CAPTURE_SCHEMA or capture.get("schema") != CAPTURE_SCHEMA
            or any(capture.get(key) != value for key, value in plan.items())
            or plan["index_manifest_sha256"] != index["source_manifest_sha256"]
            or plan["dsid"] != index["dsid"] or plan["origin"] != index["origin"]):
        raise ValueError("The geometry capture must belong to this exact original index")
    selected = plan["feature_ids"]
    if not selected or len(set(selected)) != len(selected) or set(selected) - set(indexed):
        raise ValueError("Capture selection must contain unique retained native FIDs")
    received = capture["features"]
    ids = [record["fid"] for record in received]
    if len(set(ids)) != len(ids) or set(ids) - set(selected):
        raise ValueError("Original geometry capture repeats or introduces a feature")
    if not received or not allow_partial and set(ids) != set(selected):
        raise ValueError("Finish selected original features or explicitly prepare the received subset")
    roles = read_json(ring_assignments) if ring_assignments else {}
    if not isinstance(roles, dict) or set(roles) - set(ids):
        raise ValueError("Ring assignments must use original received FID keys")
    root.mkdir(parents=True, exist_ok=True)
    with held(root / "prepare.lock", blocking=False):
        selection = {"schema": METHOD, "index_sha256": index["source_manifest_sha256"],
                     "capture_sha256": hashlib.sha256((capture_root / "capture.json").read_bytes()).hexdigest(),
                     "ring_assignments": roles, "allow_partial": bool(allow_partial),
                     "boundary_only": bool(boundary_only)}
        atomic_json(root / "selection.json", selection, immutable=True)
        companions = [
            _bank(root, capture_root / "capture.json", "original/capture.json"),
            _bank(root, capture_root / "plan.json", "original/capture-plan.json"),
            _bank(root, index_root / "index.json", "original/index.json"),
            _bank(root, index_root / "county-index.jsonl", "original/county-index.jsonl"),
            _bank(root, index_root / "original/index-manifest.json", "original/index-manifest.json"),
        ]
        for i, item in enumerate(index["original_pages"]):
            companions.append(_bank(root, verify_file(index_root, item),
                "original/index-pages/" + str(i).zfill(4) + ".txt", item["sha256"]))
        retained_rejected = set()
        for rejected in capture.get("rejected_attempts", []):
            if rejected.get("fid") not in selected:
                raise ValueError("Rejected response belongs to an unselected native FID")
            for kind in ("body", "original_receipt", "attempt"):
                item = rejected.get(kind)
                if item is not None:
                    source = verify_file(capture_root, item)
                    relative = "original/rejected/" + rejected["fid"] + "/" + kind + "-" + source.name
                    if relative not in retained_rejected:
                        companions.append(_bank(root, source, relative, item["sha256"]))
                        retained_rejected.add(relative)
        if ring_assignments:
            companions.append(_bank(root, Path(ring_assignments), "original/ring-assignments.json"))
        boundaries, parcels, geometry_records, coverage = [], [], [], []
        for record in received:
            fid = record["fid"]
            if record["source_url"] != _feature_url(index, fid):
                raise ValueError("Original geometry URL does not bind this exact DSID/FID")
            source = verify_file(capture_root, record)
            retained = _bank(root, source, "original/features/" + fid + ".xml", record["sha256"])
            companions.append(retained)
            receipt = capture_root / "receipts" / (fid + ".json")
            if receipt.exists():
                companions.append(_bank(root, receipt, "original/receipts/" + fid + ".json"))
            reserved = {"native_dsid", "native_fid", "source_uri", "source_sha256",
                        "original_xml_path", "source_index_sha256", "reference_fields",
                        "feature_role", "topology_basis"}
            if reserved.intersection(index["fields"]):
                raise ValueError("Original field collides with the documented GeoJSON metadata contract")
            paths = decode_overlay(source.read_bytes())
            identity = "thinkgis:" + str(index["dsid"]) + ":" + fid
            properties = {**indexed[fid], "native_dsid": index["dsid"], "native_fid": fid,
                          "source_uri": record["source_url"], "source_sha256": record["sha256"],
                          "original_xml_path": retained["path"],
                          "source_index_sha256": index["source_manifest_sha256"],
                          "reference_fields": "PIN|taxMapNumber"}
            if len(paths) == 1:
                line = {"type": "LineString", "coordinates": paths[0]["coordinates"]}
            else:
                line = {"type": "MultiLineString", "coordinates": [p["coordinates"] for p in paths]}
            boundaries.append({"type": "Feature", "id": identity,
                "properties": {**properties, "feature_role": "county_parcel_boundary"},
                "geometry": line})
            if boundary_only:
                polygon, basis = None, "original_boundary_only_requested"
            else:
                polygon, basis = _polygon_geometry(paths, roles.get(fid))
            if polygon:
                parcels.append({"type": "Feature", "id": identity,
                    "properties": {**properties, "feature_role": "county_parcel",
                                   "topology_basis": basis},
                    "geometry": polygon})
            coverage.append({"native_fid": fid, "original_path_count": len(paths),
                             "original_positions": sum(len(p["coordinates"]) for p in paths),
                             "polygon_prepared": polygon is not None, "topology_status": basis})
            geometry_records.append({"native_fid": fid, "original_xml": retained,
                                     "paths": paths, "topology_status": basis})
        atomic_json(root / "original-paths.json", {"schema": METHOD, "features": geometry_records}, immutable=True)
        atomic_json(root / "boundaries.geojson", {"type": "FeatureCollection", "features": boundaries}, immutable=True)
        if parcels:
            atomic_json(root / "parcels.geojson", {"type": "FeatureCollection", "features": parcels}, immutable=True)
        summary = {"schema": METHOD, "dsid": index["dsid"], "index_records": index["records"],
                   "selected_features": len(selected), "received_features": len(received),
                   "polygon_features": len(parcels), "boundary_features": len(boundaries),
                   "missing_selected_fids": [fid for fid in selected if fid not in set(ids)],
                   "selection_complete": set(ids) == set(selected), "features": coverage,
                   "geometry_source": "Original county overlay world-pixel commands; all published positions retained",
                   "ring_roles": "Viewer draws polylines. Nested boundaries require explicit retained roles; no fill rule is invented.",
                   "area_semantics": "Original county acreage strings are preserved. No geometric acreage is inferred from them.",
                   "coverage": "Only the explicitly selected and actually received whole native features",
                   "crs": "OGC:CRS84", "coordinate_operation": "County viewer drawPoly delta decoding followed by original z192LL"}
        atomic_json(root / "geometry.json", summary, immutable=True)
        companions.extend(describe_file(root, root / name) for name in
                          ("selection.json", "original-paths.json", "geometry.json"))
        suffix = digest(selection)[:20]
        entries = [_entry(root, root / "boundaries.geojson",
            source_id="thinkgis-boundaries-" + suffix, title="Original ThinkGIS whole parcel boundaries",
            kind="vector", role="PARCEL_BOUNDARY", uri=index["origin"] + "/", vintage=index["vintage"],
            companions=companions, metadata=summary)]
        if parcels:
            entries.append(_entry(root, root / "parcels.geojson",
                source_id="thinkgis-parcels-" + suffix, title="Original ThinkGIS whole county parcels",
                kind="vector", role="PARCEL", uri=index["origin"] + "/", vintage=index["vintage"],
                companions=[describe_file(root, root / "boundaries.geojson"), *companions], metadata=summary))
        for entry in entries:
            entry["id_field"] = "native_fid"
        atomic_json(root / "sources.json", {"schema": "upstate.sources/v1",
            "title": "Original ThinkGIS parcel features", "entries": entries,
            "scope": {"selected_native_fids": selected, **summary}}, immutable=True)
        return {"manifest": str(root / "sources.json"), "source_ids": [e["id"] for e in entries], **summary}



def join_screen(index_directory, screen_path, output, *, county,
                reference_field="T_Map_Number", county_field="County"):
    """Reproduce the whole grouped-screen/native-index join without collapsing FIDs."""
    index_root, index, records, index_entry = _prepared_index(index_directory)
    source = Path(screen_path).resolve(strict=True)
    body = source.read_bytes()
    screen = json.loads(body)
    if screen.get("exceededTransferLimit"):
        raise ValueError("Complete the original grouped screen before joining its rows")
    features = screen.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("Select the retained original grouped screen response")
    if not isinstance(county, str) or not county.strip():
        raise ValueError("Select the screen's exact original county value")
    canonical = lambda value: value.strip().rstrip(".")
    by_reference = {}
    for fid, record in records.items():
        for field in ("PIN", "taxMapNumber"):
            original = record.get(field, "")
            reference = canonical(original)
            if reference:
                by_reference.setdefault(reference, {}).setdefault(fid, []).append(field)
    joined, matches, seen = [], [], set()
    for ordinal, feature in enumerate(features):
        attributes = feature.get("attributes")
        if not isinstance(attributes, dict) or attributes.get(county_field) != county:
            raise ValueError("Every original screen row must name the selected county")
        reference = attributes.get(reference_field)
        if not isinstance(reference, str) or not canonical(reference):
            raise ValueError("An original screen row lacks its native string reference")
        key = canonical(reference)
        if key in seen:
            raise ValueError("The original screen must have one grouped row per native reference")
        seen.add(key)
        selected = by_reference.get(key, {})
        county_rows = []
        for fid, fields in selected.items():
            original = records[fid]
            row = {"native_fid": fid, "match_fields": fields,
                   "source_ordinal": original[PREFIX + "source_ordinal"],
                   "index_page_sha256": original[PREFIX + "index_page_sha256"],
                   "original_feature_uri": _feature_url(index, fid),
                   "original_attributes": {field: original[field] for field in index["fields"]}}
            county_rows.append(row)
            matches.append({"screen_data_row": ordinal + 1, "screen_reference": reference,
                            "native_fid": fid, "match_fields": "|".join(fields),
                            "source_ordinal": row["source_ordinal"],
                            "index_page_sha256": row["index_page_sha256"],
                            "original_feature_uri": row["original_feature_uri"],
                            **row["original_attributes"]})
        joined.append({"screen_data_row": ordinal + 1, "original_screen_attributes": attributes,
                       "county_matches": county_rows})
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with held(root / "prepare.lock", blocking=False):
        retained_screen = _bank(root, source, "original/grouped-screen.json",
                                hashlib.sha256(body).hexdigest())
        companions = [retained_screen,
            _bank(root, index_root / "index.json", "original/index.json"),
            _bank(root, index_root / "county-index.jsonl", "original/county-index.jsonl"),
            _bank(root, index_root / "original/index-manifest.json", "original/index-manifest.json")]
        for i, item in enumerate(index["original_pages"]):
            companions.append(_bank(root, verify_file(index_root, item),
                "original/index-pages/" + str(i).zfill(4) + ".txt", item["sha256"]))
        summary = {"schema": "upstate.thinkgis-grouped-screen-join/v1",
                   "county": county, "reference_field": reference_field,
                   "county_field": county_field, "index_records": index["records"],
                   "screen_rows": len(joined), "matched_screen_rows": sum(bool(r["county_matches"]) for r in joined),
                   "native_match_rows": len(matches),
                   "multiple_match_rows": sum(len(r["county_matches"]) > 1 for r in joined),
                   "unmatched_references": [r["original_screen_attributes"][reference_field]
                                            for r in joined if not r["county_matches"]],
                   "original_screen": retained_screen,
                   "index_manifest_sha256": index["source_manifest_sha256"],
                   "method": "Match original PIN or taxMapNumber after whitespace/trailing-full-stop normalization; preserve every native FID and source attribute.",
                   "acreage": "Distinct county recorded-acreage strings are listed, never added across same-reference FIDs.",
                   "screen_selection": "All rows of the original grouped response are retained; no new forestry selection criterion is applied."}
        atomic_json(root / "joined-screen.json", {**summary, "rows": joined}, immutable=True)
        queue = []
        for record in joined:
            attrs, county_rows = record["original_screen_attributes"], record["county_matches"]
            distinct = lambda field: "|".join(sorted({r["original_attributes"].get(field, "")
                                                     for r in county_rows} - {""}))
            queue.append({
                "screen_data_row": record["screen_data_row"], "original_reference": attrs[reference_field],
                "county_feature_count": len(county_rows),
                "native_fids": "|".join(r["native_fid"] for r in county_rows),
                "county_use_classes": distinct("taxUseClass"),
                "distinct_county_recorded_acres": distinct("taxTotNumberAcres"),
                "match_status": "unmatched" if not county_rows else "multiple" if len(county_rows) > 1 else "single",
                "original_screen_attributes_json": json.dumps(attrs, ensure_ascii=False, separators=(",", ":")),
            })
        queue_fields = ["screen_data_row", "original_reference", "county_feature_count", "native_fids",
                        "county_use_classes", "distinct_county_recorded_acres", "match_status",
                        "original_screen_attributes_json"]
        _emit_csv(root / "screen-queue.csv", queue_fields, queue)
        match_fields = ["screen_data_row", "screen_reference", "native_fid", "match_fields",
                        "source_ordinal", "index_page_sha256", "original_feature_uri", *index["fields"]]
        if len(set(match_fields)) != len(match_fields):
            raise ValueError("Original county attribute collides with the native match-table identity fields")
        _emit_csv(root / "county-matches.csv", match_fields, matches)
        atomic_json(root / "join.json", summary, immutable=True)
        companions.extend(describe_file(root, root / name) for name in
                          ("joined-screen.json", "county-matches.csv", "join.json"))
        entry = _entry(root, root / "screen-queue.csv",
            source_id="thinkgis-screen-" + digest(summary)[:20],
            title="Original grouped forestry screen joined to native county features",
            kind="table", role="PARCEL_SCREEN", uri=index["origin"] + "/", vintage=index["vintage"],
            companions=companions, metadata=summary)
        atomic_json(root / "sources.json", {"schema": "upstate.sources/v1",
            "title": entry["title"], "entries": [entry], "scope": summary}, immutable=True)
        return {"manifest": str(root / "sources.json"), "source_id": entry["id"], **summary}


def receive_index(transfer_path, output, *, timeout=60.0, interval=1.0):
    """Materialize the existing original file bank from private temporary download URLs."""
    transfer = transfer_path if isinstance(transfer_path, dict) else read_json(transfer_path)
    if transfer.get("schema") != "upstate.thinkgis-original-index-transfer/v1":
        raise ValueError("Select the private original-index transfer descriptor")
    if (not math.isfinite(timeout) or timeout <= 0
            or not math.isfinite(interval) or interval < 0):
        raise ValueError("Use a positive transfer timeout and nonnegative request interval")
    manifest = transfer["manifest"]
    content = manifest["content"].encode("utf-8")
    if len(content) != manifest["bytes"] or hashlib.sha256(content).hexdigest() != manifest["sha256"]:
        raise ValueError("Transferred original manifest bytes differ")
    original = json.loads(content)
    if original.get("schema") != INDEX_SCHEMA:
        raise ValueError("Transfer does not carry the original ThinkGIS index manifest")
    pages = original["source"]["original_capture_pages"]
    expected = {_source_name(page): page for page in pages}
    files = transfer.get("files")
    if len(expected) != len(pages) or not isinstance(files, list):
        raise ValueError("Original response filenames must be unique")
    descriptors = {item["filename"]: item for item in files}
    if len(descriptors) != len(files) or set(descriptors) != set(expected):
        raise ValueError("The private transfer must cover exactly the original response pages")
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with held(root / "receive.lock", blocking=False):
        manifest_path = root / "mccormick-original-index-manifest.json"
        atomic_bytes(manifest_path, content, immutable=True)
        results, last_request = [], 0.0
        for filename, page in expected.items():
            member = Path(filename)
            if member.name != filename or filename in ("", ".", "..") or "\\" in filename:
                raise ValueError("Original response filename must be a simple local name")
            item = descriptors[filename]
            if item.get("sha256") != page["sha256"] or item.get("bytes") != page["bytes"]:
                raise ValueError("Download descriptor differs from the original source hash")
            if type(item["bytes"]) is not int or not 0 < item["bytes"] <= MAX_RESPONSE:
                raise ValueError("Original index page size is outside the supported response range")
            path = root / "original" / filename
            record = {"path": path.relative_to(root).as_posix(), "bytes": page["bytes"], "sha256": page["sha256"]}
            if path.exists():
                verify_file(root, record)
                reused = True
            else:
                url = item["url"]
                parsed = urlsplit(url)
                if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
                    raise ValueError("Use the original provider's HTTPS file download URL")
                time.sleep(max(0.0, interval - (time.monotonic() - last_request)))
                last_request = time.monotonic()
                try:
                    with urlopen(Request(url, headers={"Accept-Encoding": "identity"}), timeout=timeout) as response:
                        if (response.status != 200 or transfer.get("mode") == "original-public-pages"
                                and response.geturl() != url):
                            raise ValueError("Original file response changed status or redirected")
                        body = response.read(page["bytes"] + 1)
                except HTTPError as exc:
                    # A signed file URL is a temporary capability, never a log field.
                    delay = exc.headers.get("Retry-After", "")
                    delay = delay if re.fullmatch(r"\d{1,8}", delay) else "provider interval"
                    raise ValueError("Original file download returned HTTP " + str(exc.code)
                                     + "; retry after " + delay
                                     + " or renew the original file descriptor") from None
                except OSError as exc:
                    raise ValueError("Original file transfer failed: " + type(exc).__name__) from None
                if len(body) != page["bytes"] or hashlib.sha256(body).hexdigest() != page["sha256"]:
                    raise ValueError("Downloaded original response differs: " + filename)
                atomic_bytes(path, body, immutable=True)
                reused = False
            results.append({**record, "reused": reused})
            # The receipt deliberately excludes temporary authenticated download URLs.
            atomic_json(root / "received-index.json", {
                "schema": "upstate.thinkgis-original-index-receiving/v1",
                "manifest_sha256": manifest["sha256"], "files": results,
                "received_pages": len(results), "expected_pages": len(pages),
                "state": "complete" if len(results) == len(pages) else "receiving"})
            print(json.dumps({"stage": "original-index-receiving", "filename": filename,
                              "complete_pages": len(results), "selected_pages": len(pages),
                              "received_bytes": sum(row["bytes"] for row in results)}), flush=True)
        # Validate actual retained rows, original IDs and the complete ordinal sequence.
        _, decoded = read_index(manifest_path, root / "original")
        return {"manifest": str(manifest_path), "original_root": str(root / "original"),
                "received_pages": len(results), "records": len(decoded["records"]),
                "state": "complete", "receipt": str(root / "received-index.json")}

def receive_index_origin(manifest_path, output, *, timeout=60.0, interval=1.0):
    """Receive public original pages only when all bytes still match the retained edition."""
    body = Path(manifest_path).read_bytes()
    original = json.loads(body)
    if original.get("schema") != INDEX_SCHEMA:
        raise ValueError("Select the original retained index manifest")
    source = original["source"]
    origin = _https_origin(source["county_viewer"])
    dsid = str(_integer(source["county_dsid"], "Original DSID"))
    files = []
    for page in source["original_capture_pages"]:
        url = page["source_url"]
        parsed = urlsplit(url)
        query = parse_qs(parsed.query, keep_blank_values=True)
        expected = {"action": ["getFtrs"], "dsid": [dsid],
                    "i1": [str(_integer(page["ordinal"], "First ordinal"))],
                    "cnt": [str(_integer(page["count"], "Page count", 1))]}
        if (parsed.scheme + "://" + parsed.netloc != origin or parsed.fragment
                or parsed.path.lower() != "/tgis/index.ashx" or query != expected):
            raise ValueError("Original page URL does not bind the exact retained county interval")
        files.append({"filename": _source_name(page), "bytes": page["bytes"],
                      "sha256": page["sha256"], "url": url})
    transfer = {"schema": "upstate.thinkgis-original-index-transfer/v1",
                "mode": "original-public-pages",
                "manifest": {"content": body.decode("utf-8"), "bytes": len(body),
                             "sha256": hashlib.sha256(body).hexdigest()},
                "files": files}
    return receive_index(transfer, output, timeout=timeout, interval=interval)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    index = sub.add_parser("index", help="Prepare every retained original index record")
    index.add_argument("--manifest", required=True)
    index.add_argument("--original-root", required=True)
    index.add_argument("--output", required=True)
    index.add_argument("--vintage", required=True)
    capture = sub.add_parser("capture", help="Receive or resume exact whole native features")
    capture.add_argument("--index", required=True)
    capture.add_argument("--output", required=True)
    capture.add_argument("--fids", required=True, help="Comma-separated original FIDs or @file with one FID per line")
    capture.add_argument("--retry-failed", action="store_true")
    capture.add_argument("--interval", type=float, default=1.0)
    capture.add_argument("--timeout", type=float, default=60.0)
    prepare = sub.add_parser("prepare", help="Prepare portable whole boundaries and parcel polygons")
    prepare.add_argument("--index", required=True)
    prepare.add_argument("--capture", required=True)
    prepare.add_argument("--output", required=True)
    prepare.add_argument("--ring-assignments")
    prepare.add_argument("--allow-partial", action="store_true")
    prepare.add_argument("--boundary-only", action="store_true")
    joining = sub.add_parser("join-screen", help="Join an original grouped screen to every matching native FID")
    joining.add_argument("--index", required=True)
    joining.add_argument("--screen", required=True)
    joining.add_argument("--output", required=True)
    joining.add_argument("--county", required=True)
    joining.add_argument("--reference-field", default="T_Map_Number")
    joining.add_argument("--county-field", default="County")
    receive = sub.add_parser("receive-index", help="Materialize the retained original index bank")
    receive_input = receive.add_mutually_exclusive_group(required=True)
    receive_input.add_argument("--transfer", help="Local private original-file transfer descriptor")
    receive_input.add_argument("--manifest", help="Original manifest: fetch exact public page URLs and verify original hashes")
    receive.add_argument("--output", required=True)
    receive.add_argument("--timeout", type=float, default=60.0)
    receive.add_argument("--interval", type=float, default=1.0)
    args = parser.parse_args(argv)
    if args.command == "receive-index":
        result = (receive_index(args.transfer, args.output, timeout=args.timeout, interval=args.interval)
                  if args.transfer else receive_index_origin(args.manifest, args.output,
                      timeout=args.timeout, interval=args.interval))
    elif args.command == "index":
        result = prepare_index(args.manifest, args.original_root, args.output, vintage=args.vintage)
    elif args.command == "capture":
        ids = (Path(args.fids[1:]).read_text(encoding="utf-8").splitlines()
               if args.fids.startswith("@") else args.fids.split(","))
        result = capture_features(args.index, args.output, [f.strip() for f in ids if f.strip()],
                                  retry_failed=args.retry_failed, interval=args.interval, timeout=args.timeout)
    elif args.command == "join-screen":
        result = join_screen(args.index, args.screen, args.output, county=args.county,
                            reference_field=args.reference_field, county_field=args.county_field)
    else:
        result = prepare_geometry(args.index, args.capture, args.output,
            ring_assignments=args.ring_assignments, allow_partial=args.allow_partial, boundary_only=args.boundary_only)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    if args.command == "capture" and result.get("state") != "complete":
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

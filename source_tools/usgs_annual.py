"""Receive and import USGS F7DN436B published annual-load estimates.

The released final-method field selects the published Beale or Fluxmaster
estimate. Original national archives, exact table rows, source periods and
standard errors remain available beside the imported Workspace observations.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import datetime as dt
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
import math
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit
import re
import zipfile

from model.common import (atomic_bytes, atomic_json, describe_file, digest,
                          file_digest, held, now, read_json, relative_file,
                          verify_file)

DOI = "10.5066/F7DN436B"
URI = "https://doi.org/" + DOI
ITEM = "583f2f21e4b04fc80e3bd227"
FILE_ROOT = "https://www.sciencebase.gov/catalog/file/get/" + ITEM + "?f="
SOURCE_SCHEMA = "upstate.usgs-annual2012-source/v1"
SELECTION_SCHEMA = "upstate.usgs-annual2012-selection/v1"
NLDI_ROOT = "https://api.water.usgs.gov/nldi/linked-data"
FILES = {
    "load_est.zip": {
        "bytes": 781822,
        "uri": FILE_ROOT + "__disk__db%2Fc0%2Feb%2Fdbc0eb88fd9ac0f75c7a9f1db596ff1fe5c8d20c",
    },
    "sitegage.zip": {
        "bytes": 519872,
        "uri": FILE_ROOT + "__disk__25%2F05%2F35%2F25053524b62d41bc13b8994bba13ad54be4fab1f",
    },
    "F7DN436B-original-metadata.xml": {
        "bytes": 40293,
        "sha256": "ca82b16ed8d383f866919e1743d91e617b2cfe4de24cc715d8919b1f564d9572",
        "uri": FILE_ROOT + "__disk__b6%2F4f%2Fef%2Fb64fef492fc756e83625b860c8921f9ee6f29a63",
    },
}
SERIES = {
    "tn": {"code": "00600", "parameter": "nitrogen", "title": "total nitrogen"},
    "tp": {"code": "00665", "parameter": "phosphorus", "title": "total phosphorus"},
    "ssc": {"code": "80154", "parameter": "sediment", "title": "suspended sediment"},
    "tss": {"code": "00530", "parameter": "sediment", "title": "total suspended solids"},
}
COLUMNS = ["record_id", "station_id", "catchment_id", "parameter", "value",
           "unit", "period_start", "period_end", "qualifier", "method",
           "uncertainty", "source_records"]


def _number(value, label, *, optional=False):
    token = str(value).strip()
    if optional and token in ("", ".", "NA", "NaN", "nan"):
        return None
    try:
        number = Decimal(token)
    except InvalidOperation as error:
        raise ValueError(label + " is not an original numeric value") from error
    if not number.is_finite() or number < 0 or not math.isfinite(float(number)):
        raise ValueError(label + " must be a finite nonnegative value")
    return number


def _date(value):
    token = str(value).strip()
    for pattern in ("%Y-%m-%d", "%Y%m%d", "%d%b%Y", "%m/%d/%Y"):
        try:
            return dt.datetime.strptime(token, pattern).date()
        except ValueError:
            pass
    raise ValueError("Unrecognized original calendar date: " + token)


def _huc(value):
    """Keep the source token separately; pad its explicitly numeric HUC8 view."""
    token = str(value).strip()
    return token.zfill(8) if re.fullmatch(r"\d{1,8}", token) else token


def _file(root, item):
    path = relative_file(root, item["path"])
    actual = describe_file(root, path)
    if actual["sha256"] != item["sha256"] or actual["bytes"] != item["bytes"]:
        raise ValueError("Retained original file changed: " + item["path"])
    return path


def receive(directory):
    """Capture the three small published entities once using the shared receiver."""
    from .raster_sources import capture
    root = Path(directory).resolve()
    root.mkdir(parents=True, exist_ok=True)
    for name, expected in FILES.items():
        path = root / name
        if path.exists() and not path.with_name(name + ".capture.json").exists():
            actual = describe_file(root, path)
            if actual["bytes"] != expected["bytes"] or (
                    expected.get("sha256") and actual["sha256"] != expected["sha256"]):
                raise ValueError("Previously received original differs: " + name)
            continue
        capture(expected["uri"], path, maximum_bytes=expected["bytes"])
    source = _source(root)
    atomic_json(root / "annual-source.json", source, immutable=True)
    return source


def _source(directory):
    root = Path(directory).resolve(strict=True)
    records = {}
    for name, expected in FILES.items():
        path = relative_file(root, name)
        actual = describe_file(root, path)
        if actual["bytes"] != expected["bytes"]:
            raise ValueError("Original published byte length differs for " + name)
        if expected.get("sha256") and actual["sha256"] != expected["sha256"]:
            raise ValueError("The published source dictionary differs")
        item = {**actual, "uri": expected["uri"]}
        capture_path = path.with_name(name + ".capture.json")
        if capture_path.exists():
            receipt = read_json(capture_path)
            if (receipt.get("sha256") != actual["sha256"]
                    or receipt.get("bytes") != actual["bytes"]
                    or receipt.get("state") != "complete"
                    or receipt.get("url") != expected["uri"]):
                raise ValueError("Original HTTP receipt differs for " + name)
            item["http_receipt"] = describe_file(root, capture_path)
        records[name] = item
    value = {"schema": SOURCE_SCHEMA, "release": {"doi": DOI, "reference_base_year": 2012},
             "files": records}
    value["id"] = digest(value)
    return value


def _member(archive, basename):
    names = [name for name in archive.namelist()
             if Path(name).name == basename and not name.endswith("/")]
    if len(names) != 1:
        raise ValueError("Expected one original archive member " + basename)
    info = archive.getinfo(names[0])
    body = archive.read(info)  # zipfile checks the original member CRC.
    if len(body) != info.file_size:
        raise ValueError("Original archive member is incomplete")
    return body, {"member": info.filename, "bytes": len(body),
                  "sha256": hashlib.sha256(body).hexdigest(),
                  "crc32": f"{info.CRC:08x}"}


def _table(body, member):
    text = body.decode("utf-8-sig")
    first = text.splitlines()[0] if text else ""
    # load_est members are CSV according to the exact publisher dictionary;
    # the paired site table's literal header determines comma versus tab.
    delimiter = "\t" if "\t" in first else ","
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=delimiter)
    if (not reader.fieldnames or "station_id" not in reader.fieldnames
            or len(reader.fieldnames) != len(set(reader.fieldnames))):
        raise ValueError("Original station table has invalid headers: " + member)
    rows = []
    for number, row in enumerate(reader, 1):
        if None in row or any(value is None for value in row.values()):
            raise ValueError("Original table row has an unexpected cell count: "
                             + member + " / " + str(number))
        rows.append({"record_number": number, "ending_line": reader.line_num, "row": row})
    return reader.fieldnames, delimiter, rows


def _estimate(series, record, member, site_index):
    definition = SERIES[series]
    row = record["row"]
    code = definition["code"]
    result = {
        "record_id": digest({"doi": DOI, "series": series, "member": member,
                             "record_number": record["record_number"]}),
        "series": series, "parameter_code": code, "parameter": definition["parameter"],
        "station_id": row.get("station_id", "").strip(),
        "station_name": row.get("station_name", "").strip(),
        "flow_station_id": row.get("flow_station_id", "").strip(),
        "comid": row.get("comid", "").strip(),
        "member": member, **record, "issues": [],
    }
    paired = site_index.get((result["station_id"], result["flow_station_id"]), [])
    result["paired_site_records"] = paired
    result["huc8_original"] = sorted({item["row"].get("huc8", "").strip() for item in paired})
    result["huc8"] = sorted({_huc(value) for value in result["huc8_original"] if value})
    method_field = "flux_" + code + "_final_method"
    required = ["station_id", "station_name", "lat", "lon", "comid",
                "flow_station_id", "area", "flow_station_area", method_field,
                "dflow_start_date_predpd", "dflow_end_date_predpd"]
    missing = set(required) - set(row)
    if missing:
        raise ValueError("Original load table lacks publisher fields: " + ", ".join(sorted(missing)))
    method = row[method_field].strip()
    result["final_method_field"] = method_field
    result["final_method"] = method
    try:
        if not result["station_id"]:
            raise ValueError("Original water-quality station identifier is empty")
        if method not in ("beale", "flux5pkd"):
            raise ValueError("No published final Beale/Fluxmaster method was selected")
        prefix, se_prefix = ("rload_a_", "serload_a_") if method == "beale" else ("LOAD_A_", "SLOAD_A_")
        field, se_field = prefix + code, se_prefix + code
        if field not in row or se_field not in row:
            raise ValueError("The selected publisher estimator columns are absent")
        value = _number(row[field], field)
        se = _number(row[se_field], se_field, optional=True)
        start = _date(row["dflow_start_date_predpd"])
        last = _date(row["dflow_end_date_predpd"])
        if last < start:
            raise ValueError("Original included flow period is reversed")
        end = last + dt.timedelta(days=1)
        longitude, latitude = float(row["lon"]), float(row["lat"])
        if (not math.isfinite(longitude) or not math.isfinite(latitude)
                or not -180 <= longitude <= 180 or not -90 <= latitude <= 90):
            raise ValueError("Original station coordinates are outside geographic limits")
        result.update(
            value=float(value), value_exact=str(value), unit="kg/year",
            period_start=start.isoformat(), period_end=end.isoformat(),
            longitude=longitude, latitude=latitude,
            selected_load_field=field, selected_standard_error_field=se_field,
            uncertainty={"kind": "published standard error", "value": float(se) if se is not None else None,
                         "value_exact": str(se) if se is not None else None, "unit": "kg/year",
                         "original_field": se_field, "original_value": row[se_field]},
            temporal_basis={
                "kind": "published long-term average annual mass rate",
                "flow_start_inclusive": row["dflow_start_date_predpd"],
                "flow_end_inclusive": row["dflow_end_date_predpd"],
                "water_quality_start": row.get("wq_start_date_" + code),
                "water_quality_end": row.get("wq_end_date_" + code),
                "reference_base_year": 2012,
                "detrended": method == "flux5pkd",
                "complete_anniversary_period": (start.month, start.day) == (end.month, end.day),
            },
        )
    except (ValueError, InvalidOperation, OverflowError) as error:
        result["issues"].append(str(error))
    return result


def inventory(directory, *, huc8=None):
    """Enumerate original records; HUC selection is an explicit source-field view."""
    root = Path(directory).resolve(strict=True)
    source = _source(root)
    desired = {_huc(value) for value in huc8 or []}
    if any(not re.fullmatch(r"\d{8}", value) for value in desired):
        raise ValueError("HUC8 selection requires the actual eight-digit codes")
    tables, records = [], []
    with zipfile.ZipFile(root / "load_est.zip") as loads, zipfile.ZipFile(root / "sitegage.zip") as sites:
        for series in SERIES:
            site_body, site_member = _member(sites, "sitegage_" + series + ".txt")
            site_columns, site_delimiter, site_rows = _table(site_body, site_member["member"])
            load_body, load_member = _member(loads, "load_est_" + series + ".txt")
            load_columns, load_delimiter, load_rows = _table(load_body, load_member["member"])
            site_index = defaultdict(list)
            for item in site_rows:
                pair = (item["row"]["station_id"].strip(),
                        item["row"].get("flow_station_id", "").strip())
                site_index[pair].append(item)
            for record in load_rows:
                item = _estimate(series, record, load_member, site_index)
                item["paired_site_member"] = site_member
                if not desired or desired.intersection(item["huc8"]):
                    records.append(item)
            tables.append({"series": series,
                           "loads": {**load_member, "columns": load_columns, "delimiter": load_delimiter,
                                     "records": len(load_rows)},
                           "sites": {**site_member, "columns": site_columns, "delimiter": site_delimiter,
                                     "records": len(site_rows)}})
    counts = Counter(row["series"] for row in records)
    usable = Counter(row["series"] for row in records if not row["issues"])
    return {"schema": "upstate.usgs-annual2012-inventory/v1", "source": source,
            "selected_huc8": sorted(desired), "tables": tables, "records": records,
            "record_counts": dict(counts), "usable_counts": dict(usable),
            "station_count": len({row["station_id"] for row in records}),
            "selection_basis": "Exact original paired station/flow-station records and HUC8 fields; "
                               "original coordinate and upstream geometry qualification accompanies preparation."}


def _copy_source(directory, source_root, source):
    copies = {}
    for name, item in source["files"].items():
        path = _file(source_root, item)
        target = directory / "original" / name
        atomic_bytes(target, path.read_bytes(), immutable=True)
        copies[name] = {**describe_file(directory, target), "uri": item["uri"]}
        if item.get("http_receipt"):
            original_receipt = _file(source_root, item["http_receipt"])
            receipt_target = directory / "original" / original_receipt.name
            atomic_bytes(receipt_target, original_receipt.read_bytes(), immutable=True)
    return copies


def _catchment(directory, record, choice, retained_files):
    """Use the shared original NLDI feature/whole-basin receiver."""
    from .usgs_loads import _catchment as receive_catchment, _nldi_json
    spec = dict(choice)
    expected_keys = {"source", "identifier", "station_role", "split_catchment"}
    if set(spec) != expected_keys:
        raise ValueError("Catchment selection needs source, identifier, station_role and split_catchment")
    evidence = [{"file_id": "load_est.zip", "location":
                 record["member"]["member"] + " record " + str(record["record_number"])
                 + "; original station_id, flow_station_id and comid fields"}]
    spec["identity_evidence"] = evidence
    catchment_id = digest({"source": spec["source"], "identifier": spec["identifier"],
                           "split_catchment": spec["split_catchment"]})
    catalog, _ = _nldi_json(NLDI_ROOT + "?f=json", directory / "nldi/source-catalog.json", 4 * 1024 * 1024)
    if not isinstance(catalog, list):
        raise ValueError("The original NLDI catalog is not a list")
    station = {key: record.get(key) for key in ("station_id", "station_name", "flow_station_id", "comid")}
    station.update(area=record["row"].get("area"), flow_station_area=record["row"].get("flow_station_area"))
    feature, context = receive_catchment(
        directory, station, {"catchment_id": catchment_id, "catchment": spec}, retained_files, catalog)
    context["annual_release"] = DOI
    context["annual_record_id"] = record["record_id"]
    return feature, context


def _retained_catchment(directory, original_root, record, selection):
    """Adopt retained NLDI sources and an explicit original component selection."""
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    from pyproj import Geod
    required = {"source", "identifier", "station_role", "split_catchment", "feature", "basin"}
    if set(selection) - required - {"component_indices", "component_selection_reason"} or not required <= set(selection):
        raise ValueError("Retained catchment needs its exact NLDI feature/basin file identities and original role")
    source, identifier, role = selection["source"], selection["identifier"], selection["station_role"]
    if not isinstance(selection["split_catchment"], bool):
        raise ValueError("Retain the original full/split local-catchment convention")
    if role == "water_quality_station":
        expected = "USGS-" + record["station_id"].removeprefix("USGS-")
        if source != "nwissite" or identifier != expected:
            raise ValueError("Retained NLDI water-quality station differs from the original load record")
    elif role == "published_flow_station":
        expected = "USGS-" + record["flow_station_id"].removeprefix("USGS-")
        if source != "nwissite" or not record["flow_station_id"] or identifier != expected:
            raise ValueError("Retained NLDI flow station differs from the original load record")
    elif role == "published_reach":
        if source != "comid" or identifier != record["comid"]:
            raise ValueError("Retained NLDI reach differs from the original load record")
    else:
        raise ValueError("Select the original station or published reach role")
    bodies, saved = {}, {}
    for kind in ("feature", "basin"):
        item = selection[kind]
        path = _file(original_root, item)
        if not item.get("uri"):
            raise ValueError("Retain the original NLDI response URL")
        original_url = urlsplit(item["uri"])
        expected_path = urlsplit(NLDI_ROOT).path + "/" + quote(source, safe="") + "/" + quote(identifier, safe="")
        if kind == "basin":
            expected_path += "/basin"
        query = parse_qs(original_url.query)
        if (original_url.scheme != "https" or original_url.netloc != "api.water.usgs.gov"
                or original_url.path != expected_path or query.get("f") != ["json"]):
            raise ValueError("Retained NLDI response URL differs from the selected feature")
        if kind == "basin" and (
                query.get("simplified") != ["false"]
                or query.get("splitCatchment") != ["true" if selection["split_catchment"] else "false"]):
            raise ValueError("Retained NLDI basin uses a different full/split geometry convention")
        bodies[kind] = read_json(path)
        destination = directory / "nldi/original" / (item["sha256"] + ".json")
        atomic_bytes(destination, path.read_bytes(), immutable=True)
        saved[kind] = {**describe_file(directory, destination), "uri": item["uri"]}
    feature_rows = bodies["feature"].get("features", [])
    if (bodies["feature"].get("type") != "FeatureCollection" or len(feature_rows) != 1
            or str(feature_rows[0].get("properties", {}).get("identifier")) != identifier):
        raise ValueError("Retained original NLDI feature does not identify the selected station/reach")
    if bodies["basin"].get("type") != "FeatureCollection" or not bodies["basin"].get("features"):
        raise ValueError("Retained original NLDI basin has no complete feature collection")
    returned_source = feature_rows[0].get("properties", {}).get("source")
    if returned_source not in (None, source):
        raise ValueError("Retained original NLDI feature source differs")
    for kind, value in bodies.items():
        declared = (value.get("crs") or {}).get("properties", {}).get("name")
        if declared not in (None, "EPSG:4326", "urn:ogc:def:crs:OGC:1.3:CRS84",
                            "urn:ogc:def:crs:EPSG::4326"):
            raise ValueError("Retained NLDI " + kind + " declares an unexpected GeoJSON CRS")
    components = []
    for row in bodies["basin"]["features"]:
        geometry = shape(row["geometry"])
        if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("Original NLDI basin contains invalid polygon geometry")
        components.extend(list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry])
    indices = selection.get("component_indices", list(range(len(components))))
    if (not isinstance(indices, list) or not indices
            or any(type(i) is not int or not 0 <= i < len(components) for i in indices)
            or len(indices) != len(set(indices))):
        raise ValueError("Select exact original basin component indices")
    omitted = [i for i in range(len(components)) if i not in indices]
    if omitted and not str(selection.get("component_selection_reason", "")).strip():
        raise ValueError("A basin component selection needs its specific geographic explanation")
    geometry = unary_union([components[i] for i in indices])
    anchor = shape(feature_rows[0]["geometry"])
    if not geometry.intersects(anchor):
        raise ValueError("Selected original basin components do not meet the retained NLDI station/reach")
    geod = Geod(ellps="WGS84")
    area = abs(geod.geometry_area_perimeter(geometry)[0])
    if not math.isfinite(area) or area <= 0:
        raise ValueError("Selected upstream catchment has no measurable area")
    catchment_id = digest({"source": source, "identifier": identifier,
                           "split_catchment": selection["split_catchment"],
                           "original_basin_sha256": selection["basin"]["sha256"],
                           "component_indices": indices})
    context = {"catchment_id": catchment_id, "annual_record_id": record["record_id"], "annual_release": DOI,
               "source": source, "identifier": identifier, "station_role": role,
               "station_id": record["station_id"], "flow_station_id": record["flow_station_id"],
               "published_comid": record["comid"], "original_feature": feature_rows[0],
               "split_catchment": selection["split_catchment"], "simplified": False,
               "original_sources": saved, "original_component_count": len(components),
               "selected_component_indices": indices, "omitted_component_indices": omitted,
               "component_selection_reason": selection.get("component_selection_reason"),
               "omitted_components": [{"index": i, "geometry": mapping(components[i]),
                                       "area_m2": abs(geod.geometry_area_perimeter(components[i])[0])}
                                      for i in omitted],
               "upstream_area_km2": area / 1000000}
    return {"type": "Feature", "id": catchment_id, "geometry": mapping(geometry),
            "properties": {"catchment_id": catchment_id, "station_id": record["station_id"],
                           "station_name": record["station_name"], "nldi_source": source,
                           "nldi_identifier": identifier, "upstream_area_km2": area / 1000000}}, context


def prepare(directory, *, original_root, selection_path):
    root = Path(original_root).resolve(strict=True)
    destination = Path(directory).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    selection = read_json(selection_path)
    if (selection.get("schema") != SELECTION_SCHEMA or not selection.get("title")
            or not isinstance(selection.get("records"), list) or not selection["records"]):
        raise ValueError("Select the actual inventory record IDs with " + SELECTION_SCHEMA)
    inventory_value = inventory(root)
    if selection.get("source_id") != inventory_value["source"]["id"]:
        raise ValueError("Selection belongs to another original annual source edition")
    by_id = {row["record_id"]: row for row in inventory_value["records"]}
    plan = {"schema": "upstate.usgs-annual2012-plan/v1", "source": inventory_value["source"],
            "selection": selection}
    with held(destination / ".prepare.lock"):
        atomic_json(destination / "plan.json", plan, immutable=True)
        result_path = destination / "result.json"
        if result_path.exists():
            result = read_json(result_path)
            identity = dict(result)
            if identity.pop("id", None) != digest(identity) or result.get("plan_id") != digest(plan):
                raise ValueError("Prepared annual reference identity differs")
            for item in result["files"]:
                verify_file(destination, item)
            return result
        copies = _copy_source(destination, root, inventory_value["source"])
        retained_files = {name: {"path": destination / item["path"], "definition": item, "identity": item}
                          for name, item in copies.items()}
        compact_inventory = {key: value for key, value in inventory_value.items() if key != "records"}
        compact_inventory["selected_original_records"] = [
            by_id[item["record_id"]] for item in selection["records"] if item.get("record_id") in by_id]
        atomic_json(destination / "inventory.json", compact_inventory, immutable=True)
        features, contexts, annual, seen, catchment_parameters = {}, [], [], set(), set()
        for selected in selection["records"]:
            key = selected.get("record_id")
            if key in seen or key not in by_id:
                raise ValueError("Select each original annual record once from this inventory")
            seen.add(key)
            record = by_id[key]
            if record["issues"]:
                raise ValueError("Original selected annual record needs correction: " + "; ".join(record["issues"]))
            if "retained_catchment" in selected:
                feature, context = _retained_catchment(destination, root, record, selected["retained_catchment"])
            else:
                feature, context = _catchment(destination, record, selected["catchment"], retained_files)
            catchment_id = feature["properties"]["catchment_id"]
            pair = (catchment_id, record["parameter"])
            if pair in catchment_parameters:
                raise ValueError("Select one original constituent/estimator series for each catchment and native parameter")
            catchment_parameters.add(pair)
            if catchment_id in features and features[catchment_id]["geometry"] != feature["geometry"]:
                raise ValueError("One catchment identity resolved to different original geometry")
            features[catchment_id] = feature
            contexts.append(context)
            method = ("USGS published Beale long-term average annual load" if record["final_method"] == "beale"
                      else "USGS published Fluxmaster five-parameter Kalman-smoothed, detrended long-term average annual load")
            source_record = {**record, "archive": copies["load_est.zip"], "paired_station_archive": copies["sitegage.zip"],
                             "dictionary": copies["F7DN436B-original-metadata.xml"],
                             "catchment_source": context, "comparability_note": selected.get("comparability_note")}
            annual.append({"record_id": key, "station_id": record["station_id"],
                           "catchment_id": catchment_id, "parameter": record["parameter"],
                           "value": record["value"], "unit": record["unit"],
                           "period_start": record["period_start"], "period_end": record["period_end"],
                           "qualifier": "published_final_estimator", "method": method,
                           "uncertainty": record["uncertainty"], "source_records": source_record})
        atomic_json(destination / "annual-records.json", annual, immutable=True)
        atomic_json(destination / "catchments.geojson",
                    {"type": "FeatureCollection", "features": list(features.values())}, immutable=True)
        atomic_json(destination / "catchment-sources.json", {"catchments": contexts}, immutable=True)
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=COLUMNS, lineterminator="\n")
        writer.writeheader()
        for row in annual:
            writer.writerow({key: json.dumps(row[key], ensure_ascii=False, sort_keys=True,
                                             separators=(",", ":"), allow_nan=False)
                             if isinstance(row[key], (dict, list)) else row[key] for key in COLUMNS})
        atomic_bytes(destination / "annual-loads.csv", stream.getvalue().encode(), immutable=True)
        metadata = {
            "title": selection["title"], "source_uri": URI, "release": inventory_value["source"]["release"],
            "value_basis": "annual_mass_rate", "accepted_qualifiers": ["published_final_estimator"],
            "annualization_method": "Use the release's exact flux_XXXXX_final_method selector: Beale rload_a_XXXXX "
                                    "or Fluxmaster LOAD_A_XXXXX, already kg/year. Preserve its paired published standard error. "
                                    "The included original flow period defines period_start and period_end; the last included "
                                    "source date becomes an exclusive end by adding one calendar day. The estimate is already "
                                    "a long-term annual rate and is not multiplied by that period's days or years.",
            "recommended_temporal_weighting": "whole_years" if all(
                by_id[row["record_id"]]["temporal_basis"]["complete_anniversary_period"] for row in annual
            ) else "elapsed_days",
            "sha256": file_digest(destination / "annual-loads.csv"),
            "constituents": sorted({by_id[row["record_id"]]["parameter_code"] for row in annual}),
            "notes": [
                "Fluxmaster's original trend-adjusted 2012 reference and Beale's long-term average remain distinct.",
                "Suspended sediment 80154 and total suspended solids 00530 retain their original identity; "
                "the selection chooses one source series per catchment/native parameter.",
            ],
        }
        atomic_json(destination / "observation-metadata.json", metadata, immutable=True)
        companions = [describe_file(destination, path) for path in sorted(destination.rglob("*"))
                      if path.is_file() and not path.is_symlink()
                      and path.name not in ("annual-loads.csv", "catchments.geojson", "source-manifest.json", "result.json")
                      and not path.name.endswith((".lock", ".partial"))]
        prefix = "usgs-annual2012-" + digest(plan)[:16]
        entries = [
            {"id": prefix + "-loads", "kind": "table", "role": "OBSERVED_LOADS",
             "title": selection["title"], "uri": URI, "vintage": "2012 base-year national load-estimation release",
             **describe_file(destination, destination / "annual-loads.csv"),
             "observation_metadata": metadata, "companions": companions},
            {"id": prefix + "-catchments", "kind": "vector", "role": "OBSERVATION_CATCHMENTS",
             "title": "Upstream catchments for the selected published annual loads",
             "uri": NLDI_ROOT, "vintage": "Original retained NLDI response edition",
             **describe_file(destination, destination / "catchments.geojson"),
             "id_field": "catchment_id", "companions": companions},
        ]
        manifest_path = destination / "source-manifest.json"
        captured_at = read_json(manifest_path)["captured_at"] if manifest_path.exists() else now()
        manifest = {"schema": "upstate.sources/v1", "title": selection["title"], "captured_at": captured_at,
                    "scope": selection.get("scope", {}), "entries": entries,
                    "notes": metadata["notes"]}
        atomic_json(destination / "source-manifest.json", manifest, immutable=True)
        files = [describe_file(destination, destination / name)
                 for name in ("source-manifest.json", "annual-loads.csv", "catchments.geojson")]
        files.extend(companions)
        result = {"schema": "upstate.usgs-annual2012-preparation/v1", "plan_id": digest(plan),
                  "records": len(annual), "stations": len({r["station_id"] for r in annual}),
                  "catchments": len(features), "parameters": sorted({r["parameter"] for r in annual}),
                  "source_manifest": "source-manifest.json", "observation_csv": "annual-loads.csv",
                  "observation_metadata": "observation-metadata.json", "files": files}
        result["id"] = digest(result)
        atomic_json(result_path, result, immutable=True)
        return result


def bind(workspace_path, prepared_directory):
    """Import the actual prepared edition and annual rows into the live catalog."""
    from model.workspace import Workspace
    root = Path(prepared_directory).resolve(strict=True)
    result = read_json(root / "result.json")
    identity = dict(result)
    if identity.pop("id", None) != digest(identity):
        raise ValueError("Prepared annual source identity differs")
    for item in result["files"]:
        verify_file(root, item)
    workspace = Workspace(workspace_path)
    collection = workspace.import_sources(root / result["source_manifest"])
    observations = workspace.import_observations(root / result["observation_csv"],
                                                 read_json(root / result["observation_metadata"]))
    if observations["admitted_count"] != result["records"]:
        raise ValueError("Prepared original annual rows did not all enter the native comparison")
    entries = [row for row in collection["entries"] if row.get("role") == "OBSERVATION_CATCHMENTS"]
    if len(entries) != 1:
        raise ValueError("Prepared source does not identify one upstream catchment edition")
    binding = {"schema": "upstate.usgs-annual2012-binding/v1",
               "workspace_id": workspace.project["id"], "source_collection_id": collection["id"],
               "observation_id": observations["id"], "admitted_count": observations["admitted_count"],
               "catchments": {"source_collection_id": collection["id"], "source_id": entries[0]["id"],
                              "id_field": "catchment_id"},
               "recommended_temporal_weighting": observations["metadata"]["recommended_temporal_weighting"],
               "original_preparation_id": result["id"]}
    atomic_json(root / ("binding-" + workspace.project["id"] + ".json"), binding, immutable=True)
    return binding


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    receiver = commands.add_parser("receive")
    receiver.add_argument("--output", required=True)
    catalog = commands.add_parser("inventory")
    catalog.add_argument("--original-root", required=True)
    catalog.add_argument("--huc8", action="append")
    catalog.add_argument("--output", required=True)
    preparation = commands.add_parser("prepare")
    preparation.add_argument("--original-root", required=True)
    preparation.add_argument("--selection", required=True)
    preparation.add_argument("--output", required=True)
    adoption = commands.add_parser("bind")
    adoption.add_argument("--workspace", required=True)
    adoption.add_argument("--prepared", required=True)
    args = parser.parse_args(argv)
    if args.command == "receive":
        result = receive(args.output)
    elif args.command == "inventory":
        result = inventory(args.original_root, huc8=args.huc8)
        atomic_json(args.output, result, immutable=True)
    elif args.command == "prepare":
        result = prepare(args.output, original_root=args.original_root, selection_path=args.selection)
    else:
        result = bind(args.workspace, args.prepared)
    summary = {key: result[key] for key in ("schema", "id", "record_counts", "usable_counts", "records",
                                            "stations", "catchments", "parameters", "observation_id",
                                            "admitted_count") if key in result and key != "records"}
    if isinstance(result.get("records"), int):
        summary["records"] = result["records"]
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()

"""Prepare source-bound USGS seasonal loads and original upstream catchments.

The supplied contract records the actual released table/dictionary semantics.
No station, season calendar, unit or preferred estimator is inferred from a
filename. Original source bytes and row-level method/uncertainty are retained.
"""
from __future__ import annotations
import argparse
from collections import defaultdict
import csv
import datetime as dt
from decimal import Decimal, InvalidOperation, localcontext
import gzip
import io
import json
import math
import os
from pathlib import Path
import re
from urllib.parse import quote, urlencode
import xml.etree.ElementTree as ET

from model.common import (atomic_bytes, atomic_json, canonical, describe_file,
                          digest, file_digest, held, now, read_json,
                          relative_file, retain_file, verify_file)
from model.rasters import polygon_union, vector_geometry
from .raster_sources import capture

SCHEMA = "upstate.usgs-seasonal-loads-contract/v1"
RELEASE_DOI = "10.5066/P13YSTHM"
RELEASE_URL = "https://doi.org/" + RELEASE_DOI
NLDI_ROOT = "https://api.water.usgs.gov/nldi/linked-data"
NLDI_REFERENCE = "https://api.water.usgs.gov/docs/nldi/basin/"
PARAMETERS = {"nitrogen": "00600", "phosphorus": "00665"}
MASS_TO_KG = {"kg": Decimal(1), "g": Decimal("0.001"),
              "metric_tonnes": Decimal(1000), "lb": Decimal("0.45359237")}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _json(path):
    def reject(value):
        raise ValueError("Nonfinite JSON source value: " + value)
    with Path(path).open("rb") as raw:
        gzip_encoded = raw.read(2) == b"\x1f\x8b"
    opener = gzip.open if gzip_encoded else open
    with opener(path, "rt", encoding="utf-8-sig") as source:
        return json.load(source, parse_constant=reject)


def _text_stream(path, specification):
    with Path(path).open("rb") as source:
        compressed = source.read(2) == b"\x1f\x8b"
    opener = gzip.open if compressed else open
    return opener(path, "rt", encoding=specification.get("encoding", "utf-8-sig"), newline="")


def _rows(path, specification):
    delimiter = specification.get("delimiter", ",")
    if not isinstance(delimiter, str) or len(delimiter) != 1:
        raise ValueError("Select the actual single-character table delimiter")
    with _text_stream(path, specification) as source:
        reader = csv.DictReader(source, delimiter=delimiter)
        if (not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames))
                or any(name is None or name == "" for name in reader.fieldnames)):
            raise ValueError("The original table requires distinct nonempty headers")
        for number, row in enumerate(reader, 1):
            if None in row or any(value is None for value in row.values()):
                raise ValueError("The original table has an incomplete or oversized record: " + str(number))
            yield {"record_number": number, "ending_line": reader.line_num,
                   "columns": reader.fieldnames, "row": row}


def _cell(row, column):
    if not isinstance(column, str) or column not in row:
        raise ValueError("The selected original column is absent: " + str(column))
    return row[column].strip()


def _decimal(token, label, *, nonnegative=False):
    try:
        value = Decimal(str(token))
    except InvalidOperation as error:
        raise ValueError(label + " is not a decimal number") from error
    if not value.is_finite() or (nonnegative and value < 0):
        raise ValueError(label + " is outside its physical range")
    return value


def _integer(token, label):
    value = _decimal(token, label)
    if value != value.to_integral_value():
        raise ValueError(label + " must be an original integer")
    return int(value)


def _evidence(value, files, label):
    if not isinstance(value, list) or not value:
        raise ValueError(label + " must reference the retained original metadata or method")
    for reference in value:
        if (not isinstance(reference, dict) or reference.get("file_id") not in files
                or not isinstance(reference.get("location"), str) or not reference["location"].strip()):
            raise ValueError(label + " requires file_id and an exact metadata/table/code location")
    return value


def _load_contract(contract_path, original_root):
    value = read_json(contract_path)
    if value.get("schema") != SCHEMA or value.get("release", {}).get("doi") != RELEASE_DOI:
        raise ValueError("Select the original USGS P13YSTHM source contract")
    definitions = value.get("files")
    if not isinstance(definitions, dict) or not definitions:
        raise ValueError("The source contract must bind actual retained files")
    root = Path(original_root).resolve(strict=True)
    files = {}
    for identifier, entry in definitions.items():
        if (not isinstance(identifier, str) or not identifier
                or not isinstance(entry, dict) or not entry.get("uri")
                or not re.fullmatch(r"[0-9a-f]{64}", str(entry.get("sha256", "")))):
            raise ValueError("Each original source needs an ID, URI and exact SHA256")
        path = relative_file(root, entry["path"])
        actual = describe_file(root, path)
        if actual["sha256"] != entry["sha256"] or (
                entry.get("bytes") is not None and actual["bytes"] != entry["bytes"]):
            raise ValueError("Original source bytes differ: " + identifier)
        files[identifier] = {"path": path, "definition": entry, "identity": actual}
    return value, files


def inventory(contract_path, original_root):
    """Read actual headers and source dictionaries without selecting stations."""
    contract, files = _load_contract(contract_path, original_root)
    tables = [("stations", contract["station_table"])]
    tables.extend(("loads-" + str(i + 1), table)
                  for i, table in enumerate(contract.get("load_tables", [])))
    result = {"schema": "upstate.usgs-load-table-inventory/v1",
              "contract_sha256": file_digest(contract_path), "files": {},
              "tables": [], "metadata_attributes": []}
    for identifier, entry in files.items():
        result["files"][identifier] = entry["identity"]
        if entry["definition"].get("kind") == "metadata_xml":
            with _text_stream(entry["path"], entry["definition"]) as stream:
                document = ET.parse(stream)
            # Original FGDC labels/definitions/enumerations remain verbatim.
            for element in document.getroot().iter():
                if element.tag.rsplit("}", 1)[-1] != "attr":
                    continue
                fields = {}
                for child in element.iter():
                    name = child.tag.rsplit("}", 1)[-1]
                    text = " ".join(child.itertext()).strip()
                    if name in ("attrlabl", "attrdef", "attrdefs", "attrunit", "edomv", "edomvd", "rdommin", "rdommax") and text:
                        fields.setdefault(name, []).append(text)
                result["metadata_attributes"].append({"file_id": identifier, "fields": fields})
    for label, table in tables:
        file_id = table["file_id"]
        if file_id not in files:
            raise ValueError("Table file is absent from the retained source: " + file_id)
        count, header = 0, []
        values = {name: set() for name in table.get("inspect_columns", [])}
        overflow = set()
        for item in _rows(files[file_id]["path"], table):
            header, count = item["columns"], count + 1
            for name, seen in values.items():
                token = _cell(item["row"], name)
                if len(seen) < 1000:
                    seen.add(token)
                elif token not in seen:
                    overflow.add(name)
        result["tables"].append({"name": label, "file_id": file_id, "rows": count,
                                 "headers": header,
                                 "observed_values": {k: sorted(v) for k, v in values.items()},
                                 "value_inventories_over_1000": sorted(overflow)})
    return result


def _reporting(contract, files):
    spec = contract["reporting_area"]
    _evidence(spec.get("evidence"), files, "Reporting-area selection")
    original = files[spec["file_id"]]
    rows, crs = vector_geometry(original["path"], layer=spec.get("layer"),
                                where=spec.get("where"), target_crs="EPSG:4326")
    return polygon_union(rows), {
        "source_file_id": spec["file_id"], "source_sha256": original["identity"]["sha256"],
        "layer": spec.get("layer"), "where": spec.get("where"), "crs": crs.to_string(),
        "original_feature_ids": [row["id"] for row in rows],
        "evidence": spec["evidence"],
    }


def _station_rows(contract, files):
    spec = contract["station_table"]
    _evidence(spec.get("coordinate_evidence"), files, "Station coordinate definition")
    columns = spec["columns"]
    for key in ("station_id", "station_name", "longitude", "latitude"):
        if not columns.get(key):
            raise ValueError("The original station mapping is missing " + key)
    from pyproj import CRS, Transformer
    source_crs = CRS.from_user_input(spec["coordinate_crs"])
    transform = Transformer.from_crs(source_crs, "EPSG:4326", always_xy=True)
    for item in _rows(files[spec["file_id"]]["path"], spec):
        row = item["row"]
        station_id = _cell(row, columns["station_id"])
        if not station_id:
            raise ValueError("The original station catalog contains an empty station ID")
        value = {**item, "station_id": station_id,
                 "station_name": _cell(row, columns["station_name"]),
                 "file_id": spec["file_id"], "coordinates": None, "issues": []}
        try:
            x = float(_decimal(_cell(row, columns["longitude"]), "Station longitude"))
            y = float(_decimal(_cell(row, columns["latitude"]), "Station latitude"))
            lon, lat = transform.transform(x, y)
            if not math.isfinite(lon) or not math.isfinite(lat) or not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError("Station coordinates fall outside the declared geographic range")
            value["coordinates"] = [lon, lat]
        except (ValueError, OverflowError) as error:
            value["issues"].append(str(error))
        for key in ("flow_station_id", "comid", "area", "flow_station_area", "huc8"):
            if columns.get(key):
                value[key] = _cell(row, columns[key])
        yield value


def qualify(contract_path, original_root):
    """Retain every original station and its measured study-area membership."""
    contract, files = _load_contract(contract_path, original_root)
    region, region_source = _reporting(contract, files)
    from shapely.geometry import Point
    records, counts = [], defaultdict(int)
    for item in _station_rows(contract, files):
        inside = region.covers(Point(item["coordinates"])) if item["coordinates"] else None
        records.append({**item, "inside_reporting_area": inside})
        counts["inside" if inside else "outside" if inside is False else "unknown"] += 1
    return {"schema": "upstate.usgs-station-qualification/v1",
            "release": contract["release"], "contract_sha256": file_digest(contract_path),
            "reporting_area": region_source, "counts": dict(counts), "stations": records,
            "selection_basis": "Actual published station coordinates against the selected original reporting polygon. "
                               "Flow-gauge identity remains separate from the water-quality station."}


def _month(year, month, increment):
    total = year * 12 + month - 1 + increment
    return dt.date(total // 12, total % 12 + 1, 1)


def _period(row, table, files):
    definition = table["period_definition"]
    _evidence(definition.get("evidence"), files, "Native season calendar")
    columns = table["columns"]
    year = _integer(_cell(row, columns["year"]), "Original annual-period label")
    start_month = _integer(definition["annual_start_month"], "Annual starting month")
    labels = definition["quarter_values"]
    if (not 1 <= start_month <= 12 or not isinstance(labels, list) or len(labels) != 4
            or len(set(labels)) != 4 or any(not isinstance(v, str) for v in labels)):
        raise ValueError("Retain four distinct original quarter values in native annual order")
    year_label = definition["year_label"]
    if year_label not in ("start", "end"):
        raise ValueError("Declare whether the native annual label names its starting or ending year")
    start_year = year - 1 if year_label == "end" and start_month != 1 else year
    annual_start = dt.date(start_year, start_month, 1)
    quarter = _cell(row, columns["quarter"])
    if quarter not in labels:
        raise ValueError("Original quarter is outside the retained definition: " + quarter)
    index = labels.index(quarter)
    start, end = _month(start_year, start_month, index * 3), _month(start_year, start_month, index * 3 + 3)
    for key, expected in (("period_start", start), ("period_end", end)):
        if columns.get(key):
            token = _cell(row, columns[key])
            if not DATE.fullmatch(token):
                raise ValueError("Native explicit period date requires its source-normalized ISO date")
            actual = dt.date.fromisoformat(token)
            if key == "period_end" and definition.get("source_end_inclusive") is True:
                actual += dt.timedelta(days=1)
            if actual != expected:
                raise ValueError("Native quarter date disagrees with its retained calendar definition")
    days = (end - start).days
    if columns.get("days") and _integer(_cell(row, columns["days"]), "Native season day count") != days:
        raise ValueError("Native season is missing days or uses a different period definition")
    return {"annual_label": _cell(row, columns["year"]), "quarter": quarter,
            "quarter_index": index, "start": start.isoformat(), "end": end.isoformat(),
            "days": days, "annual_start": annual_start.isoformat(),
            "annual_end": _month(start_year, start_month, 12).isoformat()}


def _rules(row, rules, files):
    failures = []
    for rule in rules:
        _evidence(rule.get("evidence"), files, "Original qualifier interpretation")
        allowed = rule.get("allowed_values")
        if not isinstance(allowed, list) or not allowed or any(not isinstance(v, str) for v in allowed):
            raise ValueError("Use the actual native string values for an accepted source qualifier")
        token = _cell(row, rule["column"])
        if token not in allowed:
            failures.append({"column": rule["column"], "value": token,
                             "accepted_values": allowed, "meaning": rule["meaning"]})
    return failures


def annualize(contract, files, selections):
    """Sum exactly four admitted native quarters; retain every selected source row."""
    selected_ids = set(selections)
    groups, excluded = defaultdict(list), []
    for table_index, table in enumerate(contract["load_tables"]):
        file_id = table["file_id"]
        columns = table["columns"]
        series_id = table.get("series_id")
        if not isinstance(series_id, str) or not series_id.strip():
            raise ValueError("Retain the original native series/basis identity for each selected load table")
        _evidence(table.get("series_evidence"), files, "Native load series and flow basis")
        source_identity = files[file_id]["identity"]
        for item in _rows(files[file_id]["path"], table):
            row = item["row"]
            station_id = _cell(row, columns["station_id"])
            if station_id not in selected_ids:
                continue
            base = {"file_id": file_id, "file_sha256": source_identity["sha256"],
                    "record_number": item["record_number"], "ending_line": item["ending_line"],
                    "original": row, "station_id": station_id, "table_index": table_index,
                    "series_id": series_id, "series_evidence": table["series_evidence"]}
            try:
                period = _period(row, table, files)
            except ValueError as error:
                excluded.append({**base, "issues": [str(error)]})
                continue
            for parameter in table["parameters"]:
                name = parameter["parameter"]
                if name not in PARAMETERS or parameter.get("parameter_code") != PARAMETERS[name]:
                    raise ValueError("Use the original total nitrogen00600 or total phosphorus00665 definition")
                _evidence(parameter.get("evidence"), files, "Native load units and estimator")
                if parameter.get("mass_unit") not in MASS_TO_KG:
                    raise ValueError("Retain an explicit supported original mass unit")
                basis = parameter.get("value_basis")
                if basis not in ("season_total_mass", "mean_daily_mass"):
                    raise ValueError("The source must define seasonal mass or mean daily mass")
                source = {**base, "parameter": name, "period": period,
                          "source_mass_unit": parameter["mass_unit"], "source_value_basis": basis,
                          "unit_evidence": parameter["evidence"]}
                failures = _rules(row, table.get("row_rules", []) + parameter.get("row_rules", []), files)
                method = _cell(row, parameter["method_column"])
                accepted_methods = parameter.get("accepted_methods")
                if (not isinstance(accepted_methods, list) or not accepted_methods
                        or any(not isinstance(value, str) for value in accepted_methods)):
                    raise ValueError("Retain the actually selected native estimator names")
                if method not in accepted_methods:
                    failures.append({"column": parameter["method_column"], "value": method,
                                     "accepted_values": accepted_methods, "meaning": "Native estimator selection"})
                source["method"] = method
                source["allow_mixed_estimators"] = parameter.get("allow_mixed_estimators") is True
                source["uncertainty"] = {column: _cell(row, column)
                                         for column in parameter.get("uncertainty_columns", [])}
                source["uncertainty_evidence"] = parameter.get("uncertainty_evidence", [])
                if source["uncertainty"]:
                    _evidence(source["uncertainty_evidence"], files, "Native uncertainty columns")
                try:
                    mass = _decimal(_cell(row, parameter["load_column"]), "Native seasonal load", nonnegative=True)
                    with localcontext() as context:
                        context.prec = 40
                        kg = mass * MASS_TO_KG[parameter["mass_unit"]]
                        if basis == "mean_daily_mass":
                            kg *= period["days"]
                    source["mass_kg"] = str(kg)
                    source["original_load"] = _cell(row, parameter["load_column"])
                except ValueError as error:
                    failures.append({"meaning": str(error), "column": parameter["load_column"],
                                     "value": row.get(parameter["load_column"])})
                source["issues"] = failures
                key = (station_id, name, period["annual_start"], period["annual_end"])
                groups[key].append(source)
    annual, review = [], []
    for key, records in sorted(groups.items()):
        station_id, parameter, start, end = key
        by_quarter = defaultdict(list)
        for record in records:
            by_quarter[record["period"]["quarter_index"]].append(record)
        # Rejected alternative methods remain in source review, while an
        # unambiguous admitted estimator for that same quarter can be selected.
        admitted = {quarter: [record for record in values if not record["issues"]]
                    for quarter, values in by_quarter.items()}
        issues = []
        if any(len(admitted.get(quarter, [])) != 1 for quarter in range(4)):
            issues.append("The source does not supply exactly one admitted estimate for every native quarter")
        chosen = [admitted[quarter][0] for quarter in range(4)
                  if len(admitted.get(quarter, [])) == 1]
        if len(chosen) == 4:
            if (chosen[0]["period"]["start"] != start or chosen[-1]["period"]["end"] != end
                    or any(a["period"]["end"] != b["period"]["start"]
                           for a, b in zip(chosen, chosen[1:]))):
                issues.append("The four native quarters do not form one continuous complete annual period")
            if len({record["series_id"] for record in chosen}) != 1:
                issues.append("The native annual selection mixes source series or flow bases")
            if (len({record["method"] for record in chosen}) != 1
                    and not all(record["allow_mixed_estimators"] for record in chosen)):
                issues.append("The source contract does not permit combining these quarter estimators")
        item = {"station_id": station_id, "parameter": parameter,
                "period_start": start, "period_end": end, "issues": issues,
                "original_quarter_records": records}
        if issues:
            review.append(item)
            continue
        with localcontext() as context:
            context.prec = 40
            mass = sum((Decimal(record["mass_kg"]) for record in chosen), Decimal(0))
        uncertainty = {
            "annual_interval": None,
            "reason": "Original quarter uncertainty is retained. No annual interval is formed "
                      "without a source-supported covariance or annual uncertainty method.",
            "quarters": [{"period": record["period"], "values": record["uncertainty"],
                          "evidence": record["uncertainty_evidence"]} for record in chosen],
        }
        value = {"station_id": station_id, "catchment_id": selections[station_id]["catchment_id"],
                 "parameter": parameter, "value": str(mass), "unit": "kg/year",
                 "period_start": start, "period_end": end,
                 "qualifier": "complete_four_native_quarters",
                 "method": " + ".join(sorted({record["method"] for record in chosen})),
                 "uncertainty": uncertainty, "source_records": chosen}
        value["record_id"] = digest(value)
        annual.append(value)
        rejected = [record for record in records if record["issues"]]
        if rejected:
            review.append({**item, "issues": ["Excluded alternative native records are retained"],
                           "admitted_record_id": value["record_id"],
                           "excluded_quarter_records": rejected})
    return annual, review, excluded


def _retain_sources(directory, contract_path, contract, files):
    """Retain every original relative tree and its source contract once."""
    copies = {}
    for identifier, item in files.items():
        saved = retain_file(directory, item["path"], item["identity"]["sha256"])
        original_relative = Path(item["definition"]["path"])
        destination = directory / "original" / original_relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            if file_digest(destination) != saved["sha256"] or destination.stat().st_size != saved["bytes"]:
                raise ValueError("Retained original source changed: " + str(destination))
        else:
            os.link(directory / saved["object"], destination)
        copies[identifier] = {**item, "path": destination,
                              "identity": describe_file(directory, destination)}
    atomic_bytes(directory / "source-contract.json", Path(contract_path).read_bytes(), immutable=True)
    return copies


def _nldi_json(url, path, maximum_bytes):
    receipt = capture(url, path, maximum_bytes=maximum_bytes)
    if receipt.get("status") != 200:
        raise ValueError("The original NLDI response did not succeed")
    return _json(path), receipt


def _catchment(directory, station, selection, files, catalog):
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    from pyproj import Geod
    spec = selection["catchment"]
    source, identifier = spec["source"], spec["identifier"]
    if not isinstance(source, str) or not source or not isinstance(identifier, str) or not identifier:
        raise ValueError("Select the actual original NLDI source and feature identifier")
    available = [row for row in catalog if row.get("source") == source]
    if len(available) != 1:
        raise ValueError("The selected feature source is absent or ambiguous in the current NLDI catalog")
    _evidence(spec.get("identity_evidence"), files, "Water-quality station to catchment identity")
    split = spec.get("split_catchment")
    if not isinstance(split, bool):
        raise ValueError("Choose the actual NLDI full or split local-catchment convention explicitly")
    # Actual flow-gauge identity is distinct; it is never selected implicitly.
    role = spec.get("station_role")
    if role not in ("water_quality_station", "published_flow_station", "published_reach"):
        raise ValueError("Retain the selected catchment's original station or reach role")
    if role == "water_quality_station":
        if source != "nwissite" or identifier != "USGS-" + station["station_id"].removeprefix("USGS-"):
            raise ValueError("NLDI gauge identifier differs from the selected water-quality station")
    elif role == "published_flow_station":
        flow = station.get("flow_station_id", "").removeprefix("USGS-")
        if not flow or source != "nwissite" or identifier != "USGS-" + flow:
            raise ValueError("NLDI flow-gauge identifier differs from the original published flow station")
    elif source != "comid" or identifier != station.get("comid"):
        raise ValueError("NLDI reach differs from the original published COMID")
    prefix = NLDI_ROOT + "/" + quote(source, safe="") + "/" + quote(identifier, safe="")
    query = urlencode({"f": "json", "simplified": "false",
                       "splitCatchment": "true" if split else "false"})
    selected_root = directory / "nldi" / digest({"source": source, "identifier": identifier,
                                               "split_catchment": split})[:24]
    selected_root.mkdir(parents=True, exist_ok=True)
    feature, feature_receipt = _nldi_json(prefix + "?f=json", selected_root / "feature.json", 4*1024*1024)
    basin, basin_receipt = _nldi_json(prefix + "/basin?" + query, selected_root / "basin.json", 64*1024*1024)
    original_features = feature.get("features") if isinstance(feature, dict) else None
    if (not isinstance(feature, dict) or feature.get("type") != "FeatureCollection" or not isinstance(original_features, list)
            or len(original_features) != 1):
        raise ValueError("The original NLDI feature lookup is not one identifiable feature")
    properties = original_features[0].get("properties", {})
    if str(properties.get("identifier", "")) != identifier:
        raise ValueError("The returned NLDI feature identifier differs from the selected source")
    if properties.get("source") not in (None, source):
        raise ValueError("The returned NLDI feature source differs")
    basin_features = basin.get("features") if isinstance(basin, dict) else None
    if (not isinstance(basin, dict) or basin.get("type") != "FeatureCollection"
            or not isinstance(basin_features, list) or not basin_features):
        raise ValueError("The original NLDI response contains no upstream catchment")
    if basin.get("crs"):
        name = basin["crs"].get("properties", {}).get("name", "")
        if name not in ("EPSG:4326", "urn:ogc:def:crs:OGC:1.3:CRS84", "urn:ogc:def:crs:EPSG::4326"):
            raise ValueError("The original NLDI basin declares an unexpected GeoJSON CRS")
    geometries = [shape(row["geometry"]) for row in basin_features]
    if any(g.is_empty or not g.is_valid or g.geom_type not in ("Polygon", "MultiPolygon") for g in geometries):
        raise ValueError("The original NLDI basin requires source geometry review")
    geometry = unary_union(geometries)
    if geometry.is_empty or not geometry.is_valid:
        raise ValueError("The complete original NLDI catchment cannot form a valid union")
    area_m2 = abs(Geod(ellps="WGS84").geometry_area_perimeter(geometry)[0])
    if not math.isfinite(area_m2) or area_m2 <= 0:
        raise ValueError("The original upstream catchment has no measurable area")
    catchment_id = selection["catchment_id"]
    context = {"catchment_id": catchment_id, "station_id": station["station_id"],
               "station_name": station["station_name"], "station_role": role,
               "published_comid": station.get("comid"), "nldi_comid": properties.get("comid"),
               "published_reach_matches_nldi": (
                   str(station["comid"]) == str(properties["comid"])
                   if station.get("comid") and properties.get("comid") is not None else None),
               "flow_station_id": station.get("flow_station_id"),
               "published_area": station.get("area"), "published_flow_station_area": station.get("flow_station_area"),
               "source": source, "identifier": identifier, "split_catchment": split,
               "simplified": False, "upstream_area_km2": area_m2 / 1000000,
               "identity_evidence": spec["identity_evidence"],
               "feature_response": describe_file(directory, selected_root / "feature.json"),
               "basin_response": describe_file(directory, selected_root / "basin.json"),
               "feature_http": feature_receipt, "basin_http": basin_receipt,
               "definition": NLDI_REFERENCE, "original_feature": original_features[0]}
    return {"type": "Feature", "id": catchment_id, "geometry": mapping(geometry),
            "properties": {"catchment_id": catchment_id, "station_id": station["station_id"],
                           "station_name": station["station_name"], "nldi_source": source,
                           "nldi_identifier": identifier, "upstream_area_km2": area_m2 / 1000000}}, context


def prepare(directory, *, contract_path, original_root):
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".prepare.lock"):
        contract, files = _load_contract(contract_path, original_root)
        plan = {"schema": "upstate.usgs-annual-load-preparation/v1",
                "contract_sha256": file_digest(contract_path),
                "original_files": {key: value["identity"]["sha256"] for key, value in files.items()}}
        atomic_json(directory / "plan.json", plan, immutable=True)
        result_path = directory / "result.json"
        if result_path.exists():
            result = read_json(result_path)
            identity = dict(result)
            recorded_id = identity.pop("id", None)
            if digest(identity) != recorded_id:
                raise ValueError("The retained observation preparation identity changed")
            if result.get("plan_sha256") != digest(plan):
                raise ValueError("The retained observation preparation belongs to another source selection")
            for item in result["files"]:
                verify_file(directory, item)
            return result
        retained = _retain_sources(directory, contract_path, contract, files)
        qualification = qualify(contract_path, original_root)
        atomic_json(directory / "station-qualification.json", qualification, immutable=True)
        choices = contract.get("selections")
        if not isinstance(choices, list) or not choices:
            raise ValueError("Select actual qualified station records and their original catchment identities")
        by_id = defaultdict(list)
        for station in qualification["stations"]:
            by_id[station["station_id"]].append(station)
        selected, stations = {}, {}
        for item in choices:
            station_id = item["station_id"]
            if station_id in selected:
                raise ValueError("Select each original station once")
            candidates = by_id.get(station_id, [])
            if item.get("catalog_record_number") is not None:
                candidates = [row for row in candidates if row["record_number"] == item["catalog_record_number"]]
            if len(candidates) != 1 or candidates[0]["issues"]:
                raise ValueError("Select one valid original catalog row for station " + station_id)
            _evidence(item.get("selection_evidence"), retained, "Station study selection")
            if not item.get("selection_reason"):
                raise ValueError("Retain the station's actual study relationship")
            catchment_id = digest({"station_id": station_id, "catchment": item["catchment"]})
            selected[station_id] = {**item, "catchment_id": catchment_id}
            stations[station_id] = candidates[0]
        annual, review, excluded = annualize(contract, retained, selected)
        if not annual:
            atomic_json(directory / "annual-review.json", {"groups": review, "excluded_records": excluded})
            raise ValueError("The selected native rows contain no complete admitted four-quarter annual load")
        catalog_path = directory / "nldi/source-catalog.json"
        catalog, catalog_receipt = _nldi_json(NLDI_ROOT + "?f=json", catalog_path, 4*1024*1024)
        if not isinstance(catalog, list):
            raise ValueError("The original NLDI feature-source catalog is not a list")
        features, contexts = [], []
        active = {row["station_id"] for row in annual}
        for station_id in sorted(active):
            feature, context = _catchment(directory, stations[station_id], selected[station_id], retained, catalog)
            features.append(feature)
            contexts.append(context)
        atomic_json(directory / "catchments.geojson", {"type": "FeatureCollection", "features": features}, immutable=True)
        atomic_json(directory / "catchment-sources.json",
                    {"source_catalog": describe_file(directory, catalog_path), "http": catalog_receipt,
                     "catchments": contexts, "selected_stations": selected}, immutable=True)
        atomic_json(directory / "annual-records.json", annual, immutable=True)
        atomic_json(directory / "annual-review.json",
                    {"groups": review, "excluded_records": excluded}, immutable=True)
        columns = ["record_id", "station_id", "catchment_id", "parameter", "value", "unit",
                   "period_start", "period_end", "qualifier", "method", "uncertainty", "source_records"]
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        for row in annual:
            writer.writerow({key: json.dumps(row[key], ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
                             if isinstance(row[key], (dict, list)) else row[key] for key in columns})
        annual_path = directory / "annual-loads.csv"
        atomic_bytes(annual_path, stream.getvalue().encode("utf-8"), immutable=True)
        metadata = {
            "title": contract.get("title") or "USGS observed-source annual nitrogen and phosphorus loads",
            "source_uri": RELEASE_URL, "value_basis": "annual_mass_rate",
            "annualization_method": "Sum exactly one admitted original estimate from each of four contiguous "
                                    "native seasons. Mean daily mass, when explicitly defined in the source, "
                                    "is multiplied by the actual days in that season. Original mass units "
                                    "are converted to kilograms; period endpoints are start-inclusive/end-exclusive.",
            "accepted_qualifiers": ["complete_four_native_quarters"],
            "sha256": file_digest(annual_path), "release": contract["release"],
            "source_contract_sha256": file_digest(contract_path),
            "uncertainty": "Original quarter uncertainty is retained; no annual confidence interval is invented.",
            "catchment_layer": {"path": "catchments.geojson", "id_field": "catchment_id",
                               "source": NLDI_REFERENCE, "simplified": False},
        }
        atomic_json(directory / "observation-metadata.json", metadata, immutable=True)
        companions = []
        for path in sorted(directory.rglob("*")):
            if (path.is_file() and not path.is_symlink() and "objects" not in path.relative_to(directory).parts
                    and path.name not in ("annual-loads.csv", "catchments.geojson", "source-manifest.json", "result.json")
                    and not path.name.endswith((".lock", ".partial"))):
                companions.append(describe_file(directory, path))
        prefix = "usgs-seasonal-loads-" + digest(plan)[:16]
        entries = [
            {"id": prefix + "-annual", "title": metadata["title"], "kind": "table",
             "role": "OBSERVED_LOADS", "uri": RELEASE_URL, "vintage": "1999-2020 original seasonal load release",
             **describe_file(directory, annual_path), "companions": companions,
             "observation_metadata": metadata},
            {"id": prefix + "-catchments", "title": "Original selected USGS upstream catchments",
             "kind": "vector", "role": "OBSERVATION_CATCHMENTS", "uri": NLDI_ROOT,
             "vintage": catalog_receipt["observed_at"], "id_field": "catchment_id",
             **describe_file(directory, directory / "catchments.geojson"),
             "companions": companions,
             "lineage": "Union of the retained original full-resolution NLDI basin features for each explicitly selected station/reach."},
        ]
        manifest = {"schema": "upstate.sources/v1", "title": metadata["title"],
                    "captured_at": catalog_receipt["observed_at"],
                    "scope": qualification["reporting_area"], "entries": entries}
        atomic_json(directory / "source-manifest.json", manifest, immutable=True)
        paths = [directory / "annual-loads.csv", directory / "catchments.geojson",
                 directory / "source-manifest.json"]
        paths.extend(relative_file(directory, item["path"]) for item in companions)
        result = {"schema": "upstate.usgs-annual-load-preparation-result/v1", "prepared_at": now(),
                  "plan_sha256": digest(plan), "annual_records": len(annual),
                  "stations": len(active), "parameters": sorted({row["parameter"] for row in annual}),
                  "review_groups": len(review), "excluded_records": len(excluded),
                  "source_manifest": "source-manifest.json", "observation_csv": "annual-loads.csv",
                  "observation_metadata": "observation-metadata.json",
                  "catchments": {"path": "catchments.geojson", "id_field": "catchment_id"},
                  "files": [describe_file(directory, path) for path in paths]}
        result["id"] = digest(result)
        atomic_json(result_path, result, immutable=True)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("inventory", "qualify", "prepare"):
        entry = sub.add_parser(command)
        entry.add_argument("--contract", required=True)
        entry.add_argument("--original-root", required=True)
        entry.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    if args.command == "prepare":
        result = prepare(args.output, contract_path=args.contract, original_root=args.original_root)
    else:
        result = globals()[args.command](args.contract, args.original_root)
        atomic_json(args.output, result, immutable=True)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()

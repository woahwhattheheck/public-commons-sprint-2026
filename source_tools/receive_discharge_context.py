"""Receive the retained thirteen-gauge discharge cohort into the existing Workspace.

Consumes A74F's original 2020-2025 packet without network acquisition. Original
daily rows, series identifiers, source qualifiers, and all source bodies travel
with the selected observation edition. Spatial selection uses the retained WBD
polygons and explicit station datum; contributing basins are a separate input.
"""
from __future__ import annotations
import argparse
import collections
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import zipfile

from model.common import atomic_bytes, atomic_json, digest, file_digest, held, read_json
from source_tools.nlcd_wcs import _domain_geometry, _retain

EDITION = "upstate.discharge-context-receiving/v1"
PACKET = "upstate.original-discharge-source/v1"
DOMAIN_DECODED_SHA256 = "2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af"
CFS_TO_CMS = 0.028316846592
SOURCE_FILES = {
    "original/usgs-stations-expanded.tsv": {
        "bytes": 22544,
        "sha256": "b770a323c67e91a328098aad3132da9fda7a83466875c6dc6855527475009c60"
    },
    "original/usgs-discharge-series-catalog.tsv": {
        "bytes": 17523,
        "sha256": "c9e2cf137da39cb1871b09bf6f99893a25dc83e1fe62f5607f07440d26dedaba"
    },
    "original/usgs-huc05-07-daily-discharge-2020.tsv": {
        "bytes": 133043,
        "sha256": "54460e938caffff76a364b3a46b5867a42d6a40be894aac0ca0fbc90930dc75f"
    },
    "original/usgs-huc05-07-daily-discharge-2021.tsv": {
        "bytes": 140830,
        "sha256": "f1c46f795512254222d0ecf872b81502b27a4007e638bdc659bb7b61feab5fea"
    },
    "original/usgs-huc05-07-daily-discharge-2022.tsv": {
        "bytes": 150441,
        "sha256": "95f94a96ca5cc8e911f63b138a220a741e626feaf25d6036091cd1bd15b7ff8c"
    },
    "original/usgs-huc05-07-daily-discharge-2023.tsv": {
        "bytes": 158068,
        "sha256": "df191ed9cb57638595c25f7a3c2eafd1727bb790d35f25f068f5f791feeb0c5d"
    },
    "original/usgs-huc05-07-daily-discharge-2024.tsv": {
        "bytes": 156274,
        "sha256": "76f1693c81b47590567acab378073323025823b2bfe06d90f6206d0d8f8e94a0"
    },
    "original/usgs-huc05-07-daily-discharge-2025.tsv": {
        "bytes": 147925,
        "sha256": "168459c0c71eadbcd43bcd10ecd5a9809013c3be1ffbfa01f27794b132841c3c"
    },
    "source-manifest.json": {
        "bytes": 19443,
        "sha256": "1db072352acd22b55148fc8378d2c6b4b045804bb7cb43dd0589b816deab7797"
    },
    "derived/daily-discharge.csv": {
        "bytes": 2399079,
        "sha256": "d2bf012d49325226b2c5c4fb3bf365ce1f2cf46b798949d1eaef23506957d964"
    },
    "derived/station-year-coverage.csv": {
        "bytes": 9682,
        "sha256": "e24b4545a30712f390702315832ea2197d7b6c908b405e095dd8228747c327b7"
    },
    "derived/station-year-coverage.json": {
        "bytes": 65562,
        "sha256": "c1387806f3e6a8c26b8f3adb57ff7b601438b5c0c97c70e219af536752ca0247"
    },
    "derive-discharge.mjs": {
        "bytes": 8245,
        "sha256": "e74fd12b74d3a5da67e5a4ad6c37699f0fed2f5e3b817e2e58358240ec38ae05"
    },
    "README.md": {
        "bytes": 5941,
        "sha256": "d620a30d4cdef3af44beeae7e68871844fe8f860fb9513349d7b4ab5c0746115"
    }
}

def _csv_bytes(rows, fields):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")

def _csv(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames)):
            raise ValueError("Retain the original distinct CSV headers: " + str(path))
        rows = list(reader)
    if any(None in row or None in row.values() for row in rows):
        raise ValueError("An original CSV row has a different field count: " + str(path))
    return reader.fieldnames, rows

def _packet(root):
    root = Path(root).resolve(strict=True)
    for relative, descriptor in SOURCE_FILES.items():
        path = (root / relative).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("Retain each original packet member within its source directory")
        if path.stat().st_size != descriptor["bytes"] or file_digest(path) != descriptor["sha256"]:
            raise ValueError("The original discharge packet member differs: " + relative)
    manifest = read_json(root / "source-manifest.json")
    if manifest.get("schema") != PACKET:
        raise ValueError("Select the retained A74F thirteen-gauge source packet")
    selection = manifest["selection"]
    if (selection["parameter_cd"], selection["statistic_cd"], selection["unit"]) != (
            "00060", "00003", "cubic feet per second"):
        raise ValueError("The source is not the selected original daily-mean discharge")
    series = selection["selected_series"]
    identities = [(item["site_no"], item["ts_id"]) for item in series]
    if len(set(identities)) != len(identities) or len({x[0] for x in identities}) != len(identities):
        raise ValueError("The original station and time-series identities are ambiguous")
    for item in series:
        if (item["data_type_cd"], item["parm_cd"], item["stat_cd"]) != ("dv", "00060", "00003"):
            raise ValueError("A selected source series has a different parameter/statistic")
    return root, manifest, series

def _daily(root, manifest, series):
    fields, rows = _csv(root / "derived/daily-discharge.csv")
    if fields != ["site_no", "ts_id", "date", "reported_value", "value_cfs",
                  "qualifiers", "source_path", "source_line"]:
        raise ValueError("Select the unchanged original daily-discharge table")
    allowed = {(s["site_no"], s["ts_id"]) for s in series}
    sources = {s["path"]: s for s in manifest["originals"]}
    seen, counts = set(), collections.Counter()
    values = collections.defaultdict(list)
    first = dt.date.fromisoformat(manifest["period"]["start"])
    last = dt.date.fromisoformat(manifest["period"]["end"])
    for row in rows:
        identity = (row["site_no"], row["ts_id"])
        date = dt.date.fromisoformat(row["date"])
        key = (*identity, row["date"])
        if identity not in allowed or key in seen or not first <= date <= last:
            raise ValueError("Original daily station/series/date selection differs")
        seen.add(key)
        if row["source_path"] not in sources or int(row["source_line"]) < 1:
            raise ValueError("An original daily row lacks its retained response and line")
        number = None
        if row["value_cfs"] != "":
            number = float(row["value_cfs"])
            if not math.isfinite(number) or float(row["reported_value"]) != number:
                raise ValueError("Original numeric discharge differs from its reported text")
        group = (*identity, date.year)
        counts[group] += 1
        if number is not None:
            values[group].append((number, row["qualifiers"]))
    return fields, rows, counts, values

def _annual(root, series, counts, values):
    coverage = read_json(root / "derived/station-year-coverage.json")
    if {(x["site_no"], x["ts_id"]) for x in coverage} != {
            (x["site_no"], x["ts_id"]) for x in series}:
        raise ValueError("Coverage and original station/series selections differ")
    rows, seen = [], set()
    for station in coverage:
        for year in station["years"]:
            number = year["year"]
            start, end = dt.date(number, 1, 1), dt.date(number + 1, 1, 1)
            identity = (station["site_no"], station["ts_id"], number)
            if identity in seen:
                raise ValueError("Original station-year coverage repeats an identity")
            seen.add(identity)
            quantified = values[identity]
            days = (end - start).days
            if (year["calendar_days"] != days
                    or year["source_record_count"] != counts[identity]
                    or year["numeric_day_count"] != len(quantified)
                    or year["missing_date_count"] + year["source_record_count"] != days
                    or year["non_numeric_count"] + len(quantified) != counts[identity]):
                raise ValueError("Original daily values and station-year coverage disagree")
            mean = math.fsum(value for value, _ in quantified) / len(quantified) if quantified else None
            if mean is not None and not math.isclose(
                    mean, year["mean_observed_daily_cfs"], rel_tol=1e-12, abs_tol=1e-12):
                raise ValueError("Original station-year mean differs from its daily support")
            volume = math.fsum(value for value, _ in quantified) * CFS_TO_CMS * 86400
            rows.append({
                "record_id": "/".join(map(str, identity)),
                "site_no": station["site_no"], "ts_id": station["ts_id"],
                "station_nm": station["station_nm"], "source_huc8": station["source_huc8"],
                "period_start": start.isoformat(), "period_end_exclusive": end.isoformat(),
                "source_record_count": counts[identity], "numeric_day_count": len(quantified),
                "calendar_days": days, "missing_date_count": year["missing_date_count"],
                "non_numeric_count": year["non_numeric_count"],
                "approved_numeric_days": year["approved_numeric_days"],
                "estimated_numeric_days": year["estimated_numeric_days"],
                "provisional_numeric_days": year["provisional_numeric_days"],
                "mean_observed_daily_cfs": year["mean_observed_daily_cfs"],
                "numeric_day_coverage_pct": len(quantified) * 100 / days,
                "observed_numeric_days_volume_m3": volume if quantified else None,
                "complete_calendar_volume_m3": volume if len(quantified) == days else None,
                "minimum_observed_daily_cfs": year["minimum_observed_daily_cfs"],
                "maximum_observed_daily_cfs": year["maximum_observed_daily_cfs"],
                "missing_date_ranges": json.dumps(year["missing_date_ranges"], separators=(",", ":")),
                "non_numeric_date_ranges": json.dumps(year["non_numeric_date_ranges"], separators=(",", ":")),
                "qualifier_counts": json.dumps(year["qualifier_counts"], sort_keys=True, separators=(",", ":")),
                "source_coverage_path": "derived/station-year-coverage.json",
                "source_coverage_sha256": SOURCE_FILES["derived/station-year-coverage.json"]["sha256"],
            })
    expected = {(s["site_no"], s["ts_id"], year) for s in series for year in range(2020, 2026)}
    if seen != expected:
        raise ValueError("Retain every original station-year, including years without observations")
    return rows

def _domain(path, output, expected_compressed_sha256):
    path = Path(path).resolve(strict=True)
    original_sha = file_digest(path)
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            names = [n for n in archive.namelist() if Path(n).name == "model-domain.esri.json.gz"]
            if len(names) != 1:
                raise ValueError("Select the original archive with one model-domain.esri.json.gz")
            info = archive.getinfo(names[0])
            if info.file_size > 64 * 1024 * 1024:
                raise ValueError("The original retained domain member exceeds its source contract")
            raw = archive.read(names[0])
            member = names[0]
    else:
        raw, member = path.read_bytes(), None
    if hashlib.sha256(raw).hexdigest() != expected_compressed_sha256:
        raise ValueError("The source packet and selected original domain bytes differ")
    decoded = gzip.decompress(raw)
    if hashlib.sha256(decoded).hexdigest() != DOMAIN_DECODED_SHA256:
        raise ValueError("Retain the original complete 217-feature WBD domain")
    target = output / "original/model-domain.esri.json.gz"
    atomic_bytes(target, raw, immutable=True)
    rows, reader = _domain_geometry(target, layer=None, where=None, target_crs="EPSG:5070")
    if len(rows) != 217:
        raise ValueError("The original model domain must retain all 217 features")
    available = set.intersection(*(set(row["properties"]) for row in rows))
    keys = [key for key in available if key.casefold() == "huc12"]
    if len(keys) != 1:
        raise ValueError("Select the actual unique original HUC12 field")
    field = keys[0]
    hucs = [row["properties"][field] for row in rows]
    if (len(set(hucs)) != 217 or any(not isinstance(h, str) or len(h) != 12
                                   or not h.isdigit() for h in hucs)):
        raise ValueError("Retain unique original string HUC12 identities")
    return rows, field, {
        "original_input_sha256": original_sha, "archive_member": member,
        "retained_member": "original/model-domain.esri.json.gz",
        "retained_sha256": hashlib.sha256(raw).hexdigest(),
        "decoded_sha256": DOMAIN_DECODED_SHA256, "feature_count": len(rows),
        "huc_field": field, "reader": reader,
        "point_membership": "Exact unbuffered original polygons; polygon covers includes boundary points",
    }

def _stations(series, domain, field, selected_hucs):
    from pyproj import CRS, Transformer
    from shapely.geometry import Point
    all_hucs = {row["properties"][field] for row in domain}
    if not selected_hucs or not set(selected_hucs) <= all_hucs:
        raise ValueError("The packet's selected HUC12 subset must exist in the original domain")
    result, transforms = [], {}
    for source in series:
        datum = source["dec_coord_datum_cd"]
        if datum not in ("NAD83", "NAD27", "WGS84"):
            raise ValueError("Retain an explicit supported station datum: " + str(datum))
        crs = {"NAD83": "EPSG:4269", "NAD27": "EPSG:4267", "WGS84": "EPSG:4326"}[datum]
        if crs not in transforms:
            transforms[crs] = Transformer.from_crs(CRS.from_user_input(crs), "EPSG:5070",
                                                   always_xy=True, allow_ballpark=False)
        projection = transforms[crs]
        lon, lat = float(source["dec_long_va"]), float(source["dec_lat_va"])
        if not all(math.isfinite(v) for v in (lon, lat)) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
            raise ValueError("Original station coordinates are invalid")
        x, y = projection.transform(lon, lat, errcheck=True)
        point = Point(x, y)
        matches = [row for row in domain if row["geometry"].covers(point)]
        hucs = sorted({row["properties"][field] for row in matches})
        selected = sorted(set(hucs) & set(selected_hucs))
        result.append({
            "site_no": source["site_no"], "ts_id": source["ts_id"],
            "station_nm": source["station_nm"], "source_huc8": source["huc_cd"],
            "source_latitude": source["dec_lat_va"], "source_longitude": source["dec_long_va"],
            "source_coordinate_datum": datum, "source_crs": crs,
            "analysis_x": x, "analysis_y": y, "analysis_crs": "EPSG:5070",
            "coordinate_operation": projection.description,
            "coordinate_operation_accuracy_m": projection.accuracy,
            "model_domain_huc12": hucs, "selected_parent_huc12": selected,
            "original_domain_feature_ids": sorted(str(row["id"]) for row in matches),
            "point_in_model_domain": bool(hucs), "point_in_selected_parent_domain": bool(selected),
            "contributing_basin_binding": None,
            "spatial_meaning": "Station-point membership only; upstream drainage footprint is a separate original source",
        })
    return result

def _descriptor(root, path):
    path = Path(path)
    return {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size,
            "sha256": file_digest(path)}

def _write_sources(root, manifest, selection, stations):
    source_uri = "https://waterservices.usgs.gov/nwis/dv/"
    companions = [_descriptor(root, root / "retained" / name) for name in SOURCE_FILES]
    companions += [_descriptor(root, root / name) for name in
                   ("selection.json", "station-domain.json", "original/model-domain.esri.json.gz")]
    title = {"selected49": "Selected 49 HUC12 station points",
             "model217": "Full 217 HUC12 station points",
             "all-candidates": "All thirteen source-candidate stations"}[selection["scope"]]
    entries = []
    for identifier, name, path, units, kind in (
        ("daily", title + ": original daily discharge 2020-2025",
         "selected-daily.csv", "ft3/s", "table"),
        ("annual", title + ": observed daily-flow calendar-year summaries",
         "selected-annual.csv", "ft3/s; m3; coverage percent; original counts", "table"),
        ("coverage", "All thirteen stations: original yearly coverage",
         "retained/derived/station-year-coverage.csv", "days; ft3/s", "table"),
        ("station-membership", "Original station membership in model and selected HUC12 domains",
         "station-membership.csv", "source coordinates; explicit projected coordinates; HUC12 IDs", "table"),
        ("station-points", "All original candidate discharge stations and selected-domain membership",
         "station-points.geojson", "source point locations", "vector"),
    ):
        item = {"id": "usgs-huc05-07-2020-2025-" + identifier + "-" + digest(selection)[:16],
                "title": name, "kind": kind, "uri": source_uri,
                "vintage": manifest["period"]["start"] + "/" + manifest["period"]["end"],
                "units": units, "role": "OBSERVED_DISCHARGE_CONTEXT",
                **_descriptor(root, root / path),
                "companions": [item for item in companions if item["path"] != path]}
        if kind == "vector":
            item["crs"] = "EPSG:4326"
        entries.append(item)
    value = {"schema": "upstate.sources/v1",
             "title": title + ": retained original USGS discharge context",
             "entries": entries, "selection": selection,
             "interpretation": "Original daily volumetric discharge and its supported calendar summaries. "
                               "Point membership and original contributing-basin identity are separate."}
    destination = root / "model-sources.json"
    if destination.exists():
        saved = read_json(destination)
        if saved != value:
            # The original authored coverage entry repeated its body as a companion.
            # Preserve exactly that prepared manifest and migrate only this known shape.
            legacy = json.loads(json.dumps(value))
            for entry in legacy["entries"]:
                entry["companions"] = companions
            if saved != legacy:
                raise ValueError("The prepared source manifest differs from this original selection")
            _retain(destination, root / "preparation-history" /
                    ("model-sources-" + file_digest(destination) + ".json"))
        atomic_json(destination, value)
    else:
        atomic_json(destination, value, immutable=True)
    return value

def prepare(source_root, domain_path, output, *, scope="selected49"):
    if scope not in ("selected49", "model217", "all-candidates"):
        raise ValueError("Select the explicit source-station footprint")
    root, manifest, series = _packet(source_root)
    fields, daily, counts, values = _daily(root, manifest, series)
    annual = _annual(root, series, counts, values)
    domain_sha = file_digest(Path(domain_path).resolve(strict=True))
    identity = {"schema": EDITION, "source_manifest_sha256": SOURCE_FILES["source-manifest.json"]["sha256"],
                "source_files": SOURCE_FILES, "domain_input_sha256": domain_sha, "scope": scope}
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    with held(output / "receiving.lock"):
        ledger = output / "operation.json"
        if ledger.exists() and read_json(ledger)["identity"] != identity:
            raise ValueError("This output directory belongs to another source/domain selection")
        atomic_json(ledger, {"identity": identity, "state": "preparing"})
        for relative, expected in SOURCE_FILES.items():
            _retain(root / relative, output / "retained" / relative, expected["sha256"])
        domain, huc_field, domain_binding = _domain(
            domain_path, output, manifest["domain_context"]["original_domain_body_sha256"])
        if file_digest(Path(domain_path).resolve(strict=True)) != domain_sha:
            raise ValueError("The original domain changed during source intake")
        stations = _stations(series, domain, huc_field,
                             manifest["domain_context"]["selected_parent_huc12s"])
        chosen = {station["site_no"] for station in stations
                  if scope == "all-candidates"
                  or station["point_in_model_domain" if scope == "model217"
                             else "point_in_selected_parent_domain"]}
        selected_daily = [row for row in daily if row["site_no"] in chosen]
        selected_annual = [row for row in annual if row["site_no"] in chosen]
        selection = {
            **identity, "domain": domain_binding, "source_period": manifest["period"],
            "parameter_cd": "00060", "statistic_cd": "00003",
            "selected_parent_huc12s": manifest["domain_context"]["selected_parent_huc12s"],
            "station_ids": sorted(chosen),
            "station_series": [{"site_no": s["site_no"], "ts_id": s["ts_id"]}
                               for s in series if s["site_no"] in chosen],
            "candidate_stations": len(series), "selected_stations": len(chosen),
            "source_daily_records": len(daily), "selected_daily_records": len(selected_daily),
            "selected_numeric_records": sum(row["value_cfs"] != "" for row in selected_daily),
            "selected_non_numeric_records": sum(row["value_cfs"] == "" for row in selected_daily),
            "annual_rows": len(selected_annual),
            "spatial_selection": "Original station-point covers on unbuffered WBD polygons; "
                                 "multiple boundary memberships retained; no upstream basin inferred",
            "contributing_basins": "A74F's separately retained NLDI basin operation supplies full catchment identity",
        }
        atomic_json(output / "selection.json", selection, immutable=True)
        atomic_json(output / "station-domain.json", {"selection": selection, "stations": stations}, immutable=True)
        atomic_bytes(output / "selected-daily.csv", _csv_bytes(selected_daily, fields), immutable=True)
        atomic_bytes(output / "selected-annual.csv", _csv_bytes(selected_annual, list(annual[0])), immutable=True)
        station_fields = list(stations[0])
        flattened = [{key: json.dumps(value, separators=(",", ":")) if isinstance(value, (list, dict))
                      else value for key, value in row.items()} for row in stations]
        atomic_bytes(output / "station-membership.csv", _csv_bytes(flattened, station_fields), immutable=True)
        from pyproj import Transformer
        points = []
        for row in stations:
            transform = Transformer.from_crs(row["source_crs"], "EPSG:4326",
                                             always_xy=True, allow_ballpark=False)
            x, y = transform.transform(float(row["source_longitude"]),
                                       float(row["source_latitude"]), errcheck=True)
            points.append({"type": "Feature", "id": row["site_no"],
                           "geometry": {"type": "Point", "coordinates": [x, y]},
                           "properties": {**{key: json.dumps(value, separators=(",", ":"))
                                             if isinstance(value, (list, dict)) else value
                                             for key, value in row.items()},
                                          "selected_for_observation_import": row["site_no"] in chosen}})
        atomic_json(output / "station-points.geojson",
                    {"type": "FeatureCollection", "features": points}, immutable=True)
        source_manifest = _write_sources(output, manifest, selection, stations)
        owned = ["retained/" + name for name in SOURCE_FILES] + [
            "original/model-domain.esri.json.gz", "selection.json", "station-domain.json",
            "selected-daily.csv", "selected-annual.csv", "station-membership.csv",
            "station-points.geojson", "model-sources.json"]
        history = output / "preparation-history"
        if history.exists():
            owned += [path.relative_to(output).as_posix()
                      for path in sorted(history.glob("model-sources-*.json")) if path.is_file()]
        files = [_descriptor(output, output / name) for name in sorted(owned)]
        result = {"schema": EDITION, "identity": identity, "state": "prepared",
                  "selection": selection, "source_manifest": "model-sources.json",
                  "source_manifest_sha256": file_digest(output / "model-sources.json"), "files": files}
        atomic_json(ledger, result)
        return result


def _report_number(value):
    if value in (None, ""):
        return ""
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("A retained discharge summary has a nonfinite number")
    return format(number, ".6g")

def _report_sections(root, receipt):
    selection = receipt["selection"]
    unused, annual = _csv(root / "selected-annual.csv")
    unused, daily = _csv(root / "selected-daily.csv")
    station_source = read_json(root / "station-domain.json")
    chosen = set(selection["station_ids"])
    stations = [row for row in station_source["stations"] if row["site_no"] in chosen]
    coverage_rows, quantity_rows = [], []
    for row in annual:
        label = row["period_start"][:4]
        coverage_rows.append([
            row["site_no"], row["ts_id"], label, row["numeric_day_count"],
            row["calendar_days"], _report_number(row["numeric_day_coverage_pct"]),
            row["missing_date_count"], row["non_numeric_count"],
            "/".join(row[key] for key in (
                "approved_numeric_days", "estimated_numeric_days", "provisional_numeric_days"))])
        quantity_rows.append([
            row["site_no"], row["ts_id"], label, _report_number(row["mean_observed_daily_cfs"]),
            _report_number(row["minimum_observed_daily_cfs"]),
            _report_number(row["maximum_observed_daily_cfs"]),
            _report_number(row["observed_numeric_days_volume_m3"]),
            _report_number(row["complete_calendar_volume_m3"])])
    blocks = [
        "%s of %s original candidate station points are selected using %s. "
        "The original period is 2020-01-01 through 2025-12-31 inclusive. "
        "%s original daily rows contain %s numeric daily means and %s nonnumeric source records."
        % (selection["selected_stations"], selection["candidate_stations"], selection["scope"],
           selection["selected_daily_records"], selection["selected_numeric_records"],
           selection["selected_non_numeric_records"]),
        "USGS parameter 00060 / statistic 00003 reports daily mean volumetric discharge in ft3/s. "
        "The selected stations use their original TS_ID series. Each reported qualifier and "
        "original response line remains in the accompanying selected-daily.csv and source responses.",
        {"kind": "table",
         "columns": ["Observation view", "Actual Workspace observation ID", "Source ID",
                     "Rows", "Context rows"],
         "rows": [[item["title"], item["id"], item["source_id"], item["rows"],
                   item["context_count"]] for item in receipt["observations"]]},
        "Station membership uses the original unbuffered WBD polygons, including holes and "
        "shared-boundary memberships, after transforming the station's declared coordinate datum. "
        "Point membership identifies a gauge location; its upstream contributing basin is a "
        "separately retained source. Full 217-feature and selected 49-HUC12 memberships remain separate.",
        {"kind": "table",
         "columns": ["Station", "TS_ID", "Original station name", "Source HUC8",
                     "Coordinate datum", "Full-domain HUC12", "Selected-parent HUC12"],
         "rows": [[row["site_no"], row["ts_id"], row["station_nm"], row["source_huc8"],
                   row["source_coordinate_datum"], ", ".join(row["model_domain_huc12"]),
                   ", ".join(row["selected_parent_huc12"])] for row in stations]},
    ]
    if not stations:
        blocks.append("No source-candidate station point meets this explicit footprint. "
                      "The complete original candidate table and domain remain available for "
                      "an explicitly broader selection.")
    support = [
        "Every station/calendar-year row retains its original numeric support, missing dates, "
        "nonnumeric values and qualifiers. Coverage equals numeric days divided by the actual "
        "Gregorian calendar-day count. A/e/P columns report approved, estimated and provisional "
        "numeric values; source qualifier flags may overlap and these counts must not be summed "
        "as mutually exclusive categories.",
        {"kind": "table",
         "columns": ["Station", "TS_ID", "Year", "Numeric days", "Calendar days",
                     "Coverage (%)", "Missing dates", "Nonnumeric", "A/e/P numeric counts"],
         "rows": coverage_rows},
        "Year intervals in the retained observation metadata are January 1 inclusive to the "
        "following January 1 exclusive. Missing-date ranges and nonnumeric-date ranges remain "
        "in selected-annual.csv; the original daily plot breaks across missing dates.",
    ]
    quantities = [
        "The mean, minimum and maximum use only the original numeric daily means observed in "
        "that station/year. Observed-days volume sums those daily means multiplied by "
        "0.028316846592 m3/ft3 and 86,400 seconds/day. Complete-year volume is populated only "
        "when every calendar day has a numeric value. Displayed quantities use six significant "
        "digits; the accompanying CSV preserves the complete calculated values.",
        {"kind": "table",
         "columns": ["Station", "TS_ID", "Year", "Observed mean (ft3/s)",
                     "Observed minimum (ft3/s)", "Observed maximum (ft3/s)",
                     "Observed-days volume (m3)", "Complete-year volume (m3)"],
         "rows": quantity_rows},
        "These measured flow quantities supply hydrologic context for the selected study. "
        "They do not supply observed nitrogen, phosphorus or sediment mass. Annual pollutant "
        "comparison continues through its existing original load, period and catchment binding.",
    ]
    nonnumeric = [row for row in daily if row["value_cfs"] == ""]
    if nonnumeric:
        support.append({"kind": "table",
                        "columns": ["Station", "TS_ID", "Date", "Original value", "Qualifier",
                                    "Original response", "Original line"],
                        "rows": [[row[key] for key in ("site_no", "ts_id", "date", "reported_value",
                                                      "qualifiers", "source_path", "source_line")]
                                 for row in nonnumeric]})
    return [
        ["Original daily discharge: selected observation editions", blocks],
        ["Original daily discharge: calendar support and source qualifiers", support],
        ["Original daily discharge: supported water quantities", quantities],
    ]

def _compose_existing_report(ws, selection, directory):
    from model import observed_context
    source = observed_context._source(ws, selection)
    if source is None:
        return {}, None, []
    prefix = "existing-context/"
    for relative, member in source["members"].items():
        _retain(member["path"], directory / (prefix + relative), member["sha256"])
    recipe = json.loads(json.dumps(source["recipe"]))
    for unused, blocks in recipe["sections"]:
        for block in blocks:
            if isinstance(block, dict) and block.get("kind") == "links":
                for item in block.get("items", []):
                    relative = observed_context._relative(item["path"]).as_posix()
                    if relative not in source["members"]:
                        raise ValueError("An existing report link names an unretained member")
                    item["path"] = prefix + relative
    for item in recipe.get("inputs", []):
        item["path"] = prefix + item["path"]
    if recipe.get("figures"):
        relative = observed_context._relative(recipe["figure_spec"]).as_posix()
        if relative not in source["members"]:
            raise ValueError("The existing figure specification is not retained")
        recipe["figure_spec"] = prefix + relative
        for choice in recipe["figures"]:
            relative = observed_context._relative(choice["path"]).as_posix()
            if relative not in source["members"]:
                raise ValueError("An existing scientific figure is not retained")
            choice["path"] = prefix + relative
    links = []
    for relative in recipe.get("source_links", []):
        relative = observed_context._relative(relative).as_posix()
        if relative not in source["members"]:
            raise ValueError("An existing report source link is not retained")
        links.append(prefix + relative)
    recipe["source_links"] = links
    return recipe, source["binding"], sorted(prefix + name for name in source["members"])


def _original_report_selection(ws, selected, receipt):
    """Reconnect an already composed identical discharge source without nesting it."""
    from model import observed_context
    seen = set()
    while True:
        source = observed_context._source(ws, selected)
        if source is None:
            return selected
        declared = selected.get("observed_context_binding")
        if declared is not None and declared != source["binding"]:
            raise ValueError("The selected original observed-report binding differs")
        recipe = source["recipe"]
        if (recipe.get("discharge_source_collection_id") != receipt["source_collection_id"]
                or recipe.get("discharge_observation_ids") != receipt["observation_ids"]):
            return selected
        identity = recipe.get("discharge_report_identity", {})
        if identity.get("schema") != "upstate.discharge-report-source/v1":
            return selected
        key = source["binding"]["body_sha256"]
        if key in seen:
            raise ValueError("An existing composed discharge source repeats its original binding")
        seen.add(key)
        original = identity["original_delivery_selection"]
        roles = dict(selected.get("source_roles", {}))
        original_choice = original.get("source_roles", {}).get(observed_context.ROLE)
        if original_choice is None:
            roles.pop(observed_context.ROLE, None)
        else:
            roles[observed_context.ROLE] = original_choice
        selected = {**selected, "source_roles": roles}
        selected.pop("observed_context_binding", None)
        expected = recipe.get("original_observed_context_binding")
        actual = observed_context.bind(ws, selected)
        if actual != expected:
            raise ValueError("The composed report's original observed source changed")
        if actual is not None:
            selected["observed_context_binding"] = actual


def _report_source(ws, root, prepared, receipt, editions, *, report_selection=None):
    from model import observed_context
    selected = json.loads(json.dumps(report_selection or {}))
    if not isinstance(selected, dict) or not isinstance(selected.get("source_roles", {}), dict):
        raise ValueError("Select an original delivery selection JSON object with source_roles")
    selected.setdefault("source_roles", {})
    selected = _original_report_selection(ws, selected, receipt)
    original_binding = observed_context.bind(ws, selected)
    if (selected.get("observed_context_binding") is not None
            and selected["observed_context_binding"] != original_binding):
        raise ValueError("The selected existing observed-report binding differs from its original source")
    if original_binding is None:
        selected.pop("observed_context_binding", None)
    else:
        selected["observed_context_binding"] = original_binding
    identity = {
        "schema": "upstate.discharge-report-source/v1",
        "receiver_edition": "20261013-source-report-v3",
        "project_id": ws.project["id"], "selection": prepared["selection"],
        "discharge_source_collection_id": receipt["source_collection_id"],
        "observation_ids": receipt["observation_ids"],
        "original_observed_context_binding": original_binding,
        "original_delivery_selection": selected,
    }
    directory = root / "report-editions" / digest(identity)
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / "receiving.lock"):
        atomic_json(directory / "identity.json", identity, immutable=True)
        recipe, retained_binding, existing_names = _compose_existing_report(ws, selected, directory)
        if retained_binding != original_binding:
            raise ValueError("The selected original report changed during composition")
        source_names = []
        for item in prepared["files"]:
            relative = "discharge/" + item["path"]
            _retain(root / item["path"], directory / relative, item["sha256"])
            source_names.append(relative)
        metadata_records = []
        for edition in editions:
            # Full original rows remain in their retained CSV and in Workspace observations.
            # The report carries the exact metadata and complete-record digest without
            # multiplying the large daily row representation in each source companion.
            metadata_records.append({
                **{key: value for key, value in edition.items() if key != "rows"},
                "row_count": len(edition["rows"]), "complete_record_sha256": digest(edition),
                "row_source": "discharge/" + edition["metadata"]["source_table_path"],
            })
        atomic_json(directory / "observation-editions.json", {
            "schema": "upstate.discharge-report-observations/v1",
            "project_id": ws.project["id"], "source_collection_id": receipt["source_collection_id"],
            "observation_ids": receipt["observation_ids"], "editions": metadata_records,
        }, immutable=True)
        atomic_json(directory / "original-delivery-selection.json", selected, immutable=True)
        companion_names = sorted(set(existing_names + source_names + [
            "identity.json", "observation-editions.json", "original-delivery-selection.json"]))
        companions = [_descriptor(directory, directory / name) for name in companion_names]
        sections = list(recipe.get("sections", [])) + _report_sections(root, receipt)
        links = list(recipe.get("source_links", [])) + [
            "observation-editions.json", "discharge/selected-daily.csv",
            "discharge/selected-annual.csv", "discharge/station-membership.csv",
            "discharge/station-points.geojson", "discharge/selection.json",
            "discharge/retained/source-manifest.json"]
        recipe.update({
            "schema": observed_context.SCHEMA,
            "title": "Original observed water context and selected USGS daily discharge"
                     if original_binding else "Selected original USGS daily discharge and calendar support",
            "sections": sections, "inputs": companions,
            "source_links": list(dict.fromkeys(links)),
            "discharge_observation_ids": receipt["observation_ids"],
            "discharge_source_collection_id": receipt["source_collection_id"],
            "original_observed_context_binding": original_binding,
            "discharge_report_identity": identity,
        })
        atomic_json(directory / "observed-report.json", recipe, immutable=True)
        entry = {
            "id": "usgs-discharge-scientific-report-" + digest(identity)[:24],
            "title": recipe["title"], "kind": "document", "role": observed_context.ROLE,
            "metadata": {"report_schema": observed_context.SCHEMA},
            "uri": "https://waterservices.usgs.gov/nwis/dv/", "vintage": "2020-01-01/2025-12-31",
            "units": "original discharge ft3/s; observed water volume m3; calendar support",
            **_descriptor(directory, directory / "observed-report.json"),
            "companions": companions,
        }
        manifest = {"schema": "upstate.sources/v1", "entries": [entry]}
        atomic_json(directory / "model-sources.json", manifest, immutable=True)
        collection = ws.import_sources(directory / "model-sources.json")
        choice = {"source_collection_id": collection["id"], "source_id": entry["id"]}
        output_selection = {**selected,
                            "source_roles": {**selected.get("source_roles", {}),
                                             observed_context.ROLE: choice}}
        # Bind through the maintained verifier after actual Workspace source intake.
        output_selection["observed_context_binding"] = observed_context.bind(ws, output_selection)
        atomic_json(directory / "delivery-selection.json", output_selection, immutable=True)
        output = {
            "schema": "upstate.discharge-context-report-import/v1",
            "directory": str(directory), "source_collection_id": collection["id"],
            "source_id": entry["id"], "source_role": observed_context.ROLE,
            "body_sha256": entry["sha256"], "binding": output_selection["observed_context_binding"],
            "observation_ids": receipt["observation_ids"], "original_binding": original_binding,
            "source_manifest": str(directory / "model-sources.json"),
            "delivery_selection": str(directory / "delivery-selection.json"),
            "retained_members": len(companions) + 1,
            "retained_bytes": entry["bytes"] + sum(item["bytes"] for item in companions),
            "state": "imported",
        }
        atomic_json(directory / "report-import.json", output, immutable=True)
        return output


def import_workspace(workspace, prepared, *, report_selection=None):
    from model.workspace import Workspace
    from model.observations import ingest
    if "context_kind" not in ingest.__code__.co_consts:
        raise RuntimeError("Install the existing observed-context v3 ingest before importing "
                           "these context views; preparation remains available in model-sources.json")
    root = Path(prepared).resolve(strict=True)
    with held(root / "workspace-import.lock"):
        result = read_json(root / "operation.json")
        if result.get("state") != "prepared":
            raise ValueError("Complete the original source preparation first")
        for item in result["files"]:
            path = (root / item["path"]).resolve(strict=True)
            if (not path.is_relative_to(root) or path.stat().st_size != item["bytes"]
                    or file_digest(path) != item["sha256"]):
                raise ValueError("A prepared source member changed: " + item["path"])
        ws = Workspace(Path(workspace).resolve(strict=True), create=False)
        collection = ws.import_sources(root / "model-sources.json")
        manifest = read_json(root / "model-sources.json")
        by_path = {entry["path"]: entry for entry in manifest["entries"]}
        views, editions = [], []
        common = {
            "schema": "upstate.observed-source-context/v1", "value_basis": "context",
            "source_uri": "https://waterservices.usgs.gov/nwis/dv/",
            "series_dimensions": ["ts_id"],
            "source_collection_id": collection["id"],
            "source_manifest_sha256": result["source_manifest_sha256"],
            "source_vintage": "2020-01-01/2025-12-31",
            "source_selection": result["selection"],
            "station_domain_source_id": by_path["station-membership.csv"]["id"],
            "method": "Original USGS parameter00060 statistic00003 daily means; original flags retained",
        }
        recipes = [
            ("selected-daily.csv", "Original USGS daily discharge, selected station domain",
             "receiving_water_discharge", "daily_mean",
             {"station_id": "site_no", "value": "reported_value", "qualifier": "qualifiers",
              "period_start": "date"}, "Daily mean discharge", "ft3/s",
             "Each value is an original reported daily mean. The original Rat/P cell remains "
             "unquantified and visible. Missing calendar dates break dated traces. Original TS_ID, "
             "response path and line accompany every row; station points do not define catchments."),
            ("selected-annual.csv", "Observed discharge means with original calendar coverage",
             "receiving_water_discharge_summary", "calendar_year",
             {"record_id": "record_id", "station_id": "site_no",
              "value": "mean_observed_daily_cfs", "period_start": "period_start",
              "period_end": "period_end_exclusive"}, "Mean of observed daily discharge", "ft3/s",
             "Mean of the available original numeric daily values within each calendar year. "
             "Original missing days, nonnumeric cells and A/e/P counts remain in each row. "
             "Partial-year means retain their support and are not complete annual discharge."),
            ("selected-annual.csv", "Original daily-discharge calendar coverage",
             "receiving_water_discharge_coverage", "calendar_year",
             {"record_id": "record_id", "station_id": "site_no",
              "value": "numeric_day_coverage_pct", "period_start": "period_start",
              "period_end": "period_end_exclusive"}, "Calendar days with numeric discharge", "%",
             "Numeric daily support divided by the actual Gregorian calendar-day count. "
             "Source records with Rat or other nonnumeric text remain a separate count. "
             "No missing day is filled or annualized."),
        ]
        if result["selection"]["selected_daily_records"]:
            for relative, title, kind, support, columns, parameter, unit, interpretation in recipes:
                source = by_path[relative]
                path, entry = ws.source_file(collection["id"], source["id"])
                metadata = {**common, "title": title, "observation_kind": kind,
                            "time_support": support, "columns": columns,
                            "constants": {"parameter": parameter, "unit": unit},
                            "source_id": source["id"], "sha256": entry["body"]["sha256"],
                            "source_table_path": relative, "interpretation": interpretation,
                            "source_records": {"source_id": source["id"], "sha256": source["sha256"],
                                               "original_packet_manifest_sha256": SOURCE_FILES["source-manifest.json"]["sha256"]}}
                edition = ws.import_observations(path, metadata)
                if edition["admitted_count"]:
                    raise RuntimeError("A discharge context edition was admitted as annual pollutant load")
                # v3's maintained context importer preserves nonnumeric originals without load issues.
                if any(row.get("context_kind") != kind for row in edition["rows"]):
                    raise RuntimeError("Install the existing observed-context v3 ingest in this application")
                editions.append(edition)
                views.append({"id": edition["id"], "title": title, "source_id": source["id"],
                              "rows": len(edition["rows"]), "context_count": edition["context_count"],
                              "admitted_count": edition["admitted_count"]})
        receipt = {"schema": "upstate.discharge-context-workspace-import/v1",
                   "workspace": str(ws.root.resolve()), "project_id": ws.project["id"],
                   "source_collection_id": collection["id"],
                   "source_manifest_sha256": result["source_manifest_sha256"],
                   "selection": result["selection"], "observations": views,
                   "observation_ids": [view["id"] for view in views],
                   "state": "imported" if views else "source_imported_no_station_points_selected"}
        receipt["scientific_report"] = _report_source(
            ws, root, result, receipt, editions, report_selection=report_selection)
        atomic_json(root / "workspace-import.json", receipt)
        return receipt

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True,
                        help="Retained source/hydrology-huc05-07-20261013 directory")
    parser.add_argument("--domain", required=True, help="Original domain gzip or its original archive")
    parser.add_argument("--scope", choices=("selected49", "model217", "all-candidates"), default="selected49")
    parser.add_argument("--output", required=True)
    parser.add_argument("--workspace", help="Existing Workspace; imports the same prepared sources and dated views")
    parser.add_argument("--report-selection", help="Existing delivery selection JSON; preserves its original observed report source")
    args = parser.parse_args(argv)
    if args.report_selection and not args.workspace:
        parser.error("--report-selection requires the existing --workspace")
    result = prepare(args.source_root, args.domain, args.output, scope=args.scope)
    if args.workspace:
        result = import_workspace(args.workspace, args.output,
                                  report_selection=read_json(args.report_selection) if args.report_selection else None)
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))

if __name__ == "__main__":
    main()

"""Attach dated WBD source records to the exact selected station geometry."""
from __future__ import annotations

import html
import math

VERSION = "1.0.0"
CONTEXT_KIND = "original_point_wbd_polygon_match"


def _key(crs, coordinates):
    from pyproj import CRS
    if not crs or not isinstance(coordinates, (list, tuple)) or len(coordinates) < 2:
        return None
    try:
        epsg = CRS.from_user_input(crs).to_epsg()
        x, y = float(coordinates[0]), float(coordinates[1])
        if epsg is None or not math.isfinite(x) or not math.isfinite(y):
            return None
        return epsg, x, y
    except (TypeError, ValueError):
        return None


def _candidate_key(candidate):
    # Native coordinates have already passed the original point reader. Do not
    # reproject, round or compare WGS84 display coordinates across source datums.
    return _key(candidate.get("native_crs"), candidate.get("native_coordinates"))


def enrich(stations):
    counts = {"wbd_context_station_count": 0, "wbd_selected_geometry_station_count": 0,
              "wbd_alternative_only_station_count": 0, "wbd_context_record_count": 0}
    for station in stations:
        selected = next((candidate for candidate in station.get("candidates", [])
                         if candidate.get("candidate_id") == station.get("selected_candidate_id")), None)
        selected_key = _candidate_key(selected) if selected else None
        source_sha = (selected or {}).get("source_ref", {}).get("source_sha256")
        records = []
        seen = set()
        for reference in station.get("source_references", []):
            original = reference.get("original", {})
            if original.get("context_kind") != CONTEXT_KIND:
                continue
            identity = original.get("context_record_id")
            if not identity or identity in seen:
                raise ValueError("WBD station context has an absent or repeated original row identity")
            seen.add(identity)
            native_key = _key("EPSG:" + str(original.get("native_epsg", "")),
                              [original.get("native_x"), original.get("native_y")])
            if native_key is None or not original.get("point_id") or not original.get("coordinate_variant"):
                raise ValueError("WBD station context requires its exact original point and native coordinates")
            matches = selected_key is not None and native_key == selected_key
            records.append({
                "context_record_id": identity,
                "point_id": original["point_id"],
                "coordinate_variant": original["coordinate_variant"],
                "native_epsg": original["native_epsg"],
                "native_x": original["native_x"], "native_y": original["native_y"],
                "selected_geometry_match": matches,
                "selected_original_source_match": bool(matches and source_sha
                    and original.get("point_source_sha256") == source_sha),
                "geometry_relation": ("exact_selected_native_coordinate" if matches else
                    "alternative_original_coordinate" if selected_key is not None else
                    "selected_geometry_unresolved"),
                "current_huc12": original.get("current_huc12", ""),
                "current_huc10": original.get("current_huc10", ""),
                "source_study_huc10": original.get("source_study_huc10", ""),
                "current_huc_in_retained_domain": original.get("current_huc_in_retained_domain", ""),
                "source_table_sha256": reference.get("source_sha256"),
                "original_row_number": reference.get("row_number"),
                "original": dict(original),
            })
        if not records:
            continue
        records.sort(key=lambda row: (row["point_id"], row["context_record_id"]))
        matches = [row for row in records if row["selected_geometry_match"]]
        status = ("exact_selected_native_coordinate" if matches else
                  "alternative_original_coordinates_only" if selected_key is not None else
                  "selected_geometry_unresolved")
        station.update(wbd_source_context=records, wbd_context_status=status,
                       selected_current_huc12s=sorted({row["current_huc12"] for row in matches
                                                     if row["current_huc12"]}),
                       selected_wbd_point_ids=[row["point_id"] for row in matches])
        counts["wbd_context_station_count"] += 1
        counts["wbd_context_record_count"] += len(records)
        counts["wbd_selected_geometry_station_count"] += bool(matches)
        counts["wbd_alternative_only_station_count"] += status == "alternative_original_coordinates_only"
    return counts


def report_section(result):
    stations = [station for station in result.get("stations", []) if station.get("wbd_source_context")]
    if not stations:
        return ""
    esc = lambda value: html.escape(str(value if value is not None else ""))
    rows = []
    for station in stations:
        for context in station["wbd_source_context"]:
            original = context["original"]
            rows.append("<tr><td>" + esc(station["station_id"]) + "</td><td>" +
                esc(context["point_id"]) + "</td><td>" + esc(context["geometry_relation"]) +
                "</td><td>" + esc(context["current_huc12"]) + "</td><td>" +
                esc(context["source_study_huc10"]) + "</td><td>" +
                esc(original.get("published_huc8", "")) + "</td><td>" +
                esc(context["current_huc_in_retained_domain"]) + "</td></tr>")
    return ("<h2>Dated WBD context at original station coordinates</h2>"
        "<p>Exact matches require the same native EPSG code and both native coordinate values. "
        "Alternative agency, network and study points remain separate original records. "
        "Study-scope and inventory HUCs retain their original meanings. "
        "The saved selection's retained-domain polygon calculation is shown separately above.</p>"
        '<div class="scroll"><table><thead><tr><th>Station</th><th>Original point variant</th>'
        "<th>Relation to selected geometry</th><th>Current HUC12</th><th>Source study HUC10</th>"
        "<th>Inventory HUC8</th><th>Current HUC in retained domain</th></tr></thead><tbody>" +
        "".join(rows) + "</tbody></table></div>")

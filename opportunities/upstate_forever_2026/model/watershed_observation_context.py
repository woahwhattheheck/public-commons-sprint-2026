"""Bind selected HUC12s and their unique upstream union to original observations."""
from __future__ import annotations

import copy
import csv
import hashlib
import io
import json
import math
import re
from pathlib import Path

from . import utility_observed_context as original_sources
from .watershed_context import _csv_bytes
from .common import atomic_bytes, describe_file

MANIFEST = "landcover_observation_profiles.sources.json"
DIRECTORY = "observations/landcover_observation_profiles_20261013/"
EDITION = "2026-10-13-profiles-1"
SCHEMA = "upstate.watershed-observation-selection/v1"
GROUPS = ("water", "snow_ice", "developed", "barren", "forest", "shrub_grass", "agriculture", "wetlands")
GROUP_MEASURES = ("area_2023_ha", "area_2025_ha", "net_change_ha", "gross_gain_ha", "gross_loss_ha")
PRIMARY = ("watershed-profiles.csv", "landcover-groups.csv", "original-location-context.csv", "summary.json")


def _hash(body):
    return hashlib.sha256(body).hexdigest()


def _load(application):
    root = Path(application).resolve(strict=True)
    path = root / MANIFEST
    if not path.is_file():
        return None
    if not path.resolve(strict=True).is_relative_to(root):
        raise ValueError("The profile manifest leaves its application")
    manifest_body = path.read_bytes()
    manifest = json.loads(manifest_body)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Choose the original watershed observation source manifest")
    indexed = {}
    for entry in manifest.get("entries", []):
        if entry.get("role") == "LANDCOVER_OBSERVED_CONTEXT":
            name = entry.get("path")
            if name in indexed:
                raise ValueError("The profile manifest repeats a primary source")
            indexed[name] = entry
    if set(indexed) != {DIRECTORY + name for name in PRIMARY}:
        raise ValueError("The profile source needs its four complete original tables")
    bodies = {}
    for entry in indexed.values():
        for row in [entry, *entry.get("companions", [])]:
            name = original_sources._relative(row.get("path"))
            if name not in bodies:
                member = (root / name).resolve(strict=True)
                if not member.is_relative_to(root) or not member.is_file():
                    raise ValueError("The original profile member leaves its application: " + name)
                bodies[name] = member.read_bytes()
            body = bodies[name]
            if len(body) != row.get("bytes") or _hash(body) != row.get("sha256"):
                raise ValueError("The retained original profile member changed: " + name)
    summary = json.loads(bodies[DIRECTORY + "summary.json"])
    if summary.get("schema") != "upstate.landcover-observation-profiles/v1":
        raise ValueError("Choose the complete original watershed profile edition")
    metadata = indexed[DIRECTORY + "watershed-profiles.csv"]["metadata"]
    if summary["source_years"] != metadata["source_years"]:
        raise ValueError("The annual source periods differ within the profile edition")
    choice = {
        "schema": "upstate.watershed-observation-choice/v1",
        "sha256": _hash(manifest_body), "edition": EDITION,
        "title": "Observed land cover and original station context",
        "source_years": summary["source_years"],
        "assessment_edition": metadata["assessment_edition"],
        "watershed_count": summary["watershed_count"],
        "geography": "Original HUC12 polygons; dated local station points",
    }
    bodies["_source-manifest.json"] = manifest_body
    return choice, summary, bodies


def catalog(application):
    loaded = _load(application)
    return loaded[0] if loaded is not None else None


def _rows(body, kind):
    reader = csv.DictReader(io.StringIO(body.decode("utf-8"), newline=""))
    if not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames)):
        raise ValueError("Original profile columns must be unique")
    rows = []
    for original in reader:
        if None in original or any(value is None for value in original.values()):
            raise ValueError("The original profile row has a different column count")
        row = dict(original)
        for key, value in original.items():
            if value.startswith("["):
                decoded = json.loads(value)
                if not isinstance(decoded, list):
                    raise ValueError("The profile list cell needs its original JSON array")
                row[key] = decoded
            elif kind in ("profile", "group") and (
                key.endswith(("_ha", "_percent", "_count", "_cells"))
                or key in ("selected_cells", "changed_class_cells")
            ):
                number = float(value)
                if not math.isfinite(number):
                    raise ValueError("Profile quantities must be finite")
                if key.endswith(("_count", "_cells")):
                    if number < 0 or not number.is_integer():
                        raise ValueError("Original profile counts must be nonnegative integers")
                    row[key] = int(number)
                else:
                    row[key] = number
            elif kind == "location" and key in ("native_x", "native_y"):
                row[key] = float(value)
                if not math.isfinite(row[key]):
                    raise ValueError("Original station coordinates must be finite")
            elif kind == "location" and key == "in_landcover_domain":
                if value not in ("true", "false"):
                    raise ValueError("Retain the original station membership flag")
                row[key] = value == "true"
        huc = row.get("current_huc12") if kind == "location" else row.get("huc12")
        if not isinstance(huc, str) or not re.fullmatch(r"[0-9]{12}", huc):
            raise ValueError("Retain each original twelve-digit watershed identifier")
        rows.append(row)
    return rows


def _selection(keys, profiles, group_rows, locations):
    if (not isinstance(keys, list) or not keys
            or any(not isinstance(key, str) or not re.fullmatch(r"[0-9]{12}", key) for key in keys)):
        raise ValueError("Choose original twelve-digit watershed identifiers")
    selected = sorted(set(keys))
    missing = set(selected) - profiles.keys()
    if missing:
        raise ValueError("The observation edition does not cover selected watersheds: " + ", ".join(sorted(missing)))
    rows = [copy.deepcopy(profiles[key]) for key in selected]
    groups = [copy.deepcopy(row) for row in group_rows if row["huc12"] in selected]
    points = [copy.deepcopy(row) for row in locations if row["current_huc12"] in selected]
    totals = []
    area = math.fsum(row["area_ha"] for row in rows)
    for group in GROUPS:
        members = [row for row in groups if row["group"] == group]
        if len(members) != len(selected) or len({row["huc12"] for row in members}) != len(selected):
            raise ValueError("Every selected watershed needs each original land-cover group exactly once")
        codes = members[0]["class_codes"]
        if any(row["class_codes"] != codes for row in members):
            raise ValueError("The original class groups differ within this selection")
        result = {"group": group, "class_codes": codes}
        for column in GROUP_MEASURES:
            result[column] = math.fsum(row[column] for row in members)
        for year in (2023, 2025):
            result[f"share_{year}_percent"] = 100 * result[f"area_{year}_ha"] / area if area else None
        totals.append(result)
    cells = sum(row["selected_cells"] for row in rows)
    changed = sum(row["changed_class_cells"] for row in rows)
    assessments = sorted({site for row in rows for site in row["draft2026_assessment_station_ids"]})
    gauges = sorted({site for row in rows for site in row["local_observed_flow_gauge_ids"]})
    point_assessments = {row["entity_id"] for row in points if row["point_kind"] == "assessment_station"}
    point_gauges = {row["entity_id"] for row in points if row["gauge_observation_role"] == "observed_flow"}
    if point_assessments != set(assessments) or point_gauges != set(gauges):
        raise ValueError("The original station locations and selected profile identities differ")
    summary = {
        "watershed_count": len(selected), "area_ha": area, "selected_cells": cells,
        "changed_cells": changed,
        "changed_area_ha": math.fsum(row["changed_class_area_ha"] for row in rows),
        "changed_percent": 100 * changed / cells if cells else None,
        "assessment_station_count": len(assessments),
        "assessment_station_ids": assessments,
        "local_observed_flow_gauge_count": len(gauges),
        "local_observed_flow_gauge_ids": gauges,
        "original_coordinate_variant_count": len(points),
    }
    return {"huc12s": selected, "summary": summary, "groups": totals,
            "profiles": rows, "watershed_groups": groups, "original_locations": points}


def load_for_selection(application, selection, expected_manifest_sha256):
    loaded = _load(application)
    if loaded is None:
        raise ValueError("Install the original observation profiles, then refresh this watershed report")
    choice, regional, bodies = loaded
    if expected_manifest_sha256 != choice["sha256"]:
        raise ValueError("The selected observation edition changed; refresh the watershed report")
    profile_rows = _rows(bodies[DIRECTORY + "watershed-profiles.csv"], "profile")
    profiles = {row["huc12"]: row for row in profile_rows}
    groups = _rows(bodies[DIRECTORY + "landcover-groups.csv"], "group")
    locations = _rows(bodies[DIRECTORY + "original-location-context.csv"], "location")
    if len(profiles) != len(profile_rows) or len(profiles) != regional["watershed_count"]:
        raise ValueError("The complete observation edition needs each original watershed exactly once")
    chosen = _selection(selection["selected_huc12s"], profiles, groups, locations)
    contributing = selection.get("contributing_context")
    union = None
    if contributing is not None:
        members = contributing["member_huc12s"]
        if not set(chosen["huc12s"]).issubset(members):
            raise ValueError("The retained contributing union must include its selected watersheds")
        union = _selection(members, profiles, groups, locations)
    source = {key: copy.deepcopy(choice[key]) for key in
              ("title", "edition", "source_years", "assessment_edition", "geography")}
    source.update(manifest_sha256=choice["sha256"], domain_sha256=regional["domain_sha256"])
    context = {
        "schema": SCHEMA, "source": source, "selected": chosen, "contributing_union": union,
        "methods": {
            "landcover": "Original 2023 and 2025 annual classifications on the same retained native grid; cell-centre membership in the original HUC12 polygons.",
            "changed_percent": "Changed original class cells divided by all selected cells; each unique HUC12 contributes once.",
            "group_balance": "Gross gains and losses cross group boundaries; net change is 2025 area minus 2023 area. Within-group class changes remain in total changed-class area.",
            "station_membership": "Dated local station points joined to current official WBD HUC12; coordinate variants retain one entity count.",
            "contributing_union": "Unique members from this saved watershed report's original upstream network, including selected focal watersheds; overlapping upstream areas are counted once.",
            "assessment": "South Carolina 2026 draft assessment station cohort; absence of a selected station does not establish absence of impairment or of monitoring.",
            "interpretation": "Annual class differences describe mapped land cover. A local station's placement does not delineate its upstream drainage area or attribute a measured water-quality change to land cover.",
        },
        "retained_files": {
            name: {"path": "watershed-observation-sources/" + name, "bytes": len(body), "sha256": _hash(body)}
            for name, body in sorted(bodies.items())
        },
    }
    return context, bodies


def compact(context):
    def part(value):
        if value is None:
            return None
        return {key: copy.deepcopy(value[key]) for key in ("huc12s", "summary", "groups")}
    return {"schema": SCHEMA, "source": copy.deepcopy(context["source"]),
            "selected": part(context["selected"]),
            "contributing_union": part(context["contributing_union"])}


def retain(directory, context, bodies):
    files = original_sources.retain(directory, context, bodies)
    root = Path(directory)
    for scope in ("selected", "contributing_union"):
        part = context[scope]
        if part is None:
            continue
        for key, suffix in (("profiles", "profiles"), ("watershed_groups", "groups"), ("original_locations", "locations")):
            rows = part[key]
            if not rows:
                continue
            filename = scope.replace("_", "-") + "-observation-" + suffix + ".csv"
            atomic_bytes(root / filename, _csv_bytes(rows, tuple(rows[0])), immutable=True)
            files[filename] = describe_file(root, root / filename)
    return files


def brief_lines(selection, table, number):
    context = selection.get("landcover_observation_context")
    if context is None:
        return []
    if context.get("schema") != SCHEMA:
        raise ValueError("Select the saved original watershed observation context")
    source = context["source"]
    lines = ["## Observed land cover and original station context", "",
             "Annual classifications: " + " and ".join(map(str, source["source_years"])) +
             ". Assessment station cohort: " + source["assessment_edition"] + ".", ""]
    for scope, title in (("selected", "Selected watershed area"),
                         ("contributing_union", "Unique upstream contributing area")):
        part = context[scope]
        if part is None:
            continue
        s = part["summary"]
        lines += ["### " + title, "",
                  f"{s['watershed_count']} unique HUC12s; {number(s['area_ha'])} hectares of native-cell support. "
                  f"{number(s['changed_area_ha'])} hectares ({number(s['changed_percent'])}%) changed original class. "
                  f"{s['assessment_station_count']} assessment stations and "
                  f"{s['local_observed_flow_gauge_count']} observed-flow gauge entities have local points in this area.", ""]
        lines += table(["Land-cover group", "2023 area (ha)", "2025 area (ha)", "Gross gain (ha)", "Gross loss (ha)", "Net change (ha)"], [
            [row["group"].replace("_", " "), number(row["area_2023_ha"]), number(row["area_2025_ha"]),
             number(row["gross_gain_ha"]), number(row["gross_loss_ha"]), number(row["net_change_ha"])]
            for row in part["groups"]])
        lines += [""]
    lines += ["### Selected watershed observations", ""]
    lines += table(["HUC12", "Watershed", "Changed class (%)", "Developed net (ha)", "Forest net (ha)", "Draft assessment stations", "Local observed-flow gauges"], [
        [row["huc12"], row["name"], number(row["changed_class_percent"]),
         number(row["developed_net_change_ha"]), number(row["forest_net_change_ha"]),
         ", ".join(row["draft2026_assessment_station_ids"]) or "0",
         ", ".join(row["local_observed_flow_gauge_ids"]) or "0"]
        for row in context["selected"]["profiles"]])
    lines += ["", *context["methods"].values(), "", "### Saved original observation sources", ""]
    for name, descriptor in sorted(context["retained_files"].items()):
        if name.endswith((".csv", "README.md", "_source-manifest.json", "input-manifest.json")):
            lines.append("- [" + name + "](<" + descriptor["path"] + ">)")
    lines += ["", "Original profile manifest SHA-256: " + source["manifest_sha256"] + ".", ""]
    return lines

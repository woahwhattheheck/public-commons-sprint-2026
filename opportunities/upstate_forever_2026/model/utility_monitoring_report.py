"""Explain an actual utility Monitoring decision with its original source context."""
from __future__ import annotations
from copy import deepcopy
import csv
from html import escape
import io
import json
import re

from .common import canonical, digest, file_digest, verify_file
from . import utility_monitoring
from .monitoring_packet import bytes_member, file_member

SCHEMA = "upstate.utility-monitoring-report/v1"


def source_snapshot(workspace, network):
    """Load each original utility edition once for one native report operation."""
    output = []
    for candidate in utility_monitoring.catalog(workspace):
        if candidate["network_id"] != network["id"]:
            continue
        prepared = utility_monitoring.inspect(workspace, candidate["id"])
        if prepared["network_id"] != network["id"] or prepared["method"]["target_units"] != "ha":
            raise ValueError("Use the original utility overlap-hectare preparation for this network")
        directory, exported, selection, utility, _ = utility_monitoring.export_selection(
            workspace, prepared["export_id"])
        for descriptor in exported["files"].values():
            verify_file(directory, descriptor)
        observed = selection.get("observed_context")
        if observed is not None and (
                observed["utility_id"] != utility["utility_id"]
                or observed["profile_sha256"] != utility["profile_source"]["sha256"]
                or sorted(observed["utility"]["huc12s"]) != sorted(utility["huc12s"])):
            raise ValueError("Original observation context belongs to another utility selection")
        output.append({
            "export_id": exported["id"], "preparation": deepcopy(prepared),
            "utility": deepcopy(utility), "observations": deepcopy(observed),
            "original_files": deepcopy(exported["files"]),
        })
    return output


def contexts(workspace, plan, network, visits):
    """Join only preparations bound to this exact saved native network."""
    if plan["network_id"] != network["id"] or plan["source_bindings"] != network["source_bindings"]:
        raise ValueError("The utility report must use the design's original native network")
    return [_context_from_source(workspace, plan, network, visits, original)
            for original in source_snapshot(workspace, network)]


def _context_from_source(workspace, plan, network, visits, original):
    """Derive one plan's metadata from this operation's loaded original edition."""
    if plan["network_id"] != network["id"] or plan["source_bindings"] != network["source_bindings"]:
        raise ValueError("The utility report must use the design's original native network")
    prepared, utility, observed = original["preparation"], original["utility"], original["observations"]
    if prepared["network_id"] != network["id"] or prepared["identity"]["workspace_id"] != workspace.project["id"]:
        raise ValueError("The loaded original utility edition belongs to another Workspace/network")
    exported = {"id": original["export_id"], "files": original["original_files"]}
    original_stations = {
        row["station_id"]: row for row in observed["utility"]["station_summaries"]
    } if observed is not None else {}
    native_stations = {row["id"]: row for row in network["stations"]}
    existing_ids = set(plan.get("existing_station_ids", []))
    visits_by_station, effective_visits = {}, {}
    for visit in visits:
        planned = (visit.get("planned_station_id") if "planned_station_id" in visit
                   else visit.get("station_id"))
        if planned:
            visits_by_station.setdefault(planned, []).append(visit["visit_key"])
        if visit.get("station_id"):
            effective_visits.setdefault(visit["station_id"], []).append(visit["visit_key"])
    rows = []
    for station_id in sorted(set(original_stations) | set(native_stations)):
        original, native = original_stations.get(station_id), native_stations.get(station_id)
        rows.append({
            "station_id": station_id,
            "source_record_state": "retained_original_summary" if original is not None else "not_in_selected_observed_summary",
            "original_membership_basis": original.get("selection_basis") if original else None,
            "original_matched_huc12": (original.get("matched_huc12") or None) if original else None,
            "original_huc8": original.get("source_huc8") if original else None,
            "native_assignment": native["assignment"] if native else "station_source_not_selected",
            "native_huc12": native["huc_id"] if native else None,
            "outlet_verified": native["outlet_verified"] if native else None,
            "explicit_existing_credit": station_id in existing_ids,
            "scheduled_visit_ids": visits_by_station.get(station_id, []),
            "effective_visit_ids": effective_visits.get(station_id, []),
            "original_summary": deepcopy(original) if original else None,
            "native_source_properties": deepcopy(native["source_properties"]) if native else None,
            "source_membership_differs_from_native": (
                original.get("matched_huc12") != native["huc_id"]
                if original and original.get("matched_huc12") and native and native["huc_id"] else None),
        })
    selected_ids, covered_ids = set(plan["selected_ids"]), set(plan["covered_ids"])
    utility_ids = set(utility["huc12s"])
    ambiguities = {}
    for issue in network["station_assignment_issues"]:
        for huc in issue["candidate_catchments"]:
            ambiguities.setdefault(huc, []).append(issue["station_id"])
    stations_selected = prepared["identity"]["include_microbial"]
    catchments = []
    for huc in sorted(utility_ids | selected_ids):
        node = network["nodes"][huc]
        assigned = [row["station_id"] for row in rows if row["native_huc12"] == huc]
        catchments.append({
            "huc12": huc, "utility_target": huc in utility_ids,
            "selected_search_area": huc in selected_ids, "covered_in_plan": huc in covered_ids,
            "target_overlap_ha": node["weight"], "native_geodesic_area_km2": node["area_km2"],
            "native_historical_station_ids": assigned if stations_selected else None,
            "native_station_count": len(assigned) if stations_selected else None,
            "ambiguous_station_ids": sorted(ambiguities.get(huc, [])) if stations_selected else None,
            "station_inventory_state": (
                "original_station_source_not_selected" if not stations_selected
                else "boundary_assignment_unresolved" if ambiguities.get(huc)
                else "selected_original_station_source"),
            "scheduled_visits": sum(visit["site_id"] == huc for visit in visits),
        })
    binding = {
        "workspace_id": workspace.project["id"], "plan_id": plan["id"],
        "network_id": network["id"], "utility_preparation_id": prepared["id"],
        "utility_preparation_record_sha256": prepared["record_sha256"],
        "utility_export_id": exported["id"], "original_selection": exported["files"]["selected-watersheds.json"],
        "original_files": deepcopy(exported["files"]),
        "actual_visits_sha256": digest(visits), "implementation_sha256": file_digest(__file__),
    }
    value = {
        "schema": SCHEMA, "id": digest(binding), "binding": binding,
        "utility": deepcopy(utility), "method": deepcopy(prepared["method"]),
        "original_observations": deepcopy(observed),
        "plan": {"id": plan["id"], "title": plan["title"], "status": plan["status"],
                 "coverage_mode": plan["coverage_mode"], "coverage_meaning": plan["coverage_meaning"],
                 "coverage": deepcopy(plan["coverage"]), "target_units": "ha",
                 "configuration": deepcopy(plan["configuration"]),
                 "selected_context_huc12s": sorted(selected_ids - utility_ids)},
        "catchments": catchments, "stations": rows,
        "station_assignment_issues": deepcopy(network["station_assignment_issues"]),
        "interpretation": [
            "Coverage weights are EPSG:5070 vector overlap hectares with the original whole-HUC utility footprint.",
            "Historical sample summaries describe their retained cohort, methods, dates and original units.",
            "Source utility membership, native point-in-polygon assignment, existing-programme credit and scheduled station binding remain separate.",
            "Unselected station sources retain unknown per-catchment inventory rather than a zero count.",
            "Regional stream nutrient and flow observations retain their regional geographic scope.",
        ],
    }
    value["record_sha256"] = digest(value)
    return value


def _text(value):
    if value is None:
        return "Not available"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def _table(headers, rows):
    return ("<div class='utility-context-table' style='max-width:100%;overflow:auto'><table><thead><tr>"
            + "".join("<th>" + escape(str(value)) + "</th>" for value in headers)
            + "</tr></thead><tbody>"
            + "".join("<tr>" + "".join("<td>" + escape(_text(value)) + "</td>" for value in row)
                      + "</tr>" for row in rows) + "</tbody></table></div>")


def _briefing_member(record):
    files = record["binding"]["original_files"]
    return next((name for name in ("source-context-report-briefing.html", "watershed-selection-brief.html")
                 if name in files), "selected-watersheds.json")

def fragment(record, *, source_prefix=None):
    u, plan = record["utility"], record["plan"]
    parts = ["<section class='utility-monitoring-context'><h2>Original utility context — "
             + escape(u["title"]) + "</h2>",
             "<p>" + escape(record["method"]["geographic_basis"]) + ". "
             + escape(record["method"]["description"]) + "</p>"]
    parts.append(_table(
        ["Original utility HUC12s", "Saved plan", "Coverage mode", "Covered target (ha)", "Total target (ha)"],
        [[len(u["huc12s"]), plan["id"], plan["coverage_mode"],
          plan["coverage"]["covered_weight"], plan["coverage"]["total_weight"]]]))
    parts.append("<p>" + escape(plan["coverage_meaning"])
                 + ". The hectare objective describes this planning footprint.</p>")
    if plan["selected_context_huc12s"]:
        parts.append("<p>Selected contextual search areas outside the original utility target: "
                     + escape(", ".join(plan["selected_context_huc12s"])) + ".</p>")
    parts.append(_table(
        ["HUC12", "Utility target", "Selected search area", "Covered", "Target overlap (ha)",
         "Historical stations assigned by native geometry", "Unresolved boundary stations", "Scheduled visits"],
        [[row["huc12"], row["utility_target"], row["selected_search_area"], row["covered_in_plan"],
          row["target_overlap_ha"], row["native_historical_station_ids"], row["ambiguous_station_ids"],
          row["scheduled_visits"]] for row in record["catchments"]]))
    parts.append("<p>Historical station inventories are from the selected original station source. "
                 "The table retains unavailable inventory when that source was not selected. "
                 "Catchments and scheduled search areas do not assert an actual station commitment.</p>")
    observed = record["original_observations"]
    if observed is not None:
        original, period = observed["utility"], observed["microbial_query_period"]
        summary = original["summary"]
        parts.append("<h3>Original sampled context</h3><p>"
                     + escape(original["geographic_basis"]) + ". Query period "
                     + escape(period["start"]) + " to " + escape(period["end"]) + ".</p>")
        parts.append(_table(["Original records", "Stations", "Sampling dates", "First sample", "Last sample",
                             "Original concentration units", "Detection states", "Information Only", "Activity types"],
                           [[summary["records"], summary["stations"], summary["unique_dates"],
                             summary["first_date"], summary["last_date"], summary["source_units"],
                             summary["detection_status"], summary["information_only_records"],
                             summary["activity_types"]]]))
        parts.append(_table(["Year", "Stations", "Records", "Sampling dates", "Observed months",
                             "Detection states", "Information Only"],
                           [[row["year"], row["stations"], row["records"], row["unique_dates"],
                             row["observed_months"], row["detection_status"], row["information_only_records"]]
                            for row in original["years"]]))
        parts.append("<p>" + escape(observed["methods"]["summaries"]) + " "
                     + escape(observed["methods"]["temporal"]) + "</p>")
        region = observed["regional_stream"]
        parts.append("<h3>Regional nutrient and flow context</h3><p>"
                     + escape(region["geographic_meaning"]) + "</p><p>"
                     + escape(region["quantity_meaning"]) + "</p><p>"
                     + escape(region["interpretation"]) + "</p>")
    parts.append("<h3>Original station evidence and actual programme choices</h3>")
    parts.append(_table(
        ["Station", "Original HUC12", "Original membership basis", "Native HUC12", "Native assignment",
         "Verified outlet", "Explicit existing credit", "Planned visit IDs", "Effective visit IDs", "Original records", "Original period"],
        [[row["station_id"], row["original_matched_huc12"], row["original_membership_basis"],
          row["native_huc12"], row["native_assignment"], row["outlet_verified"], row["explicit_existing_credit"],
          row["scheduled_visit_ids"], row["effective_visit_ids"],
          row["original_summary"]["records"] if row["original_summary"] else None,
          [row["original_summary"]["first_date"], row["original_summary"]["last_date"]]
          if row["original_summary"] else None] for row in record["stations"]]))
    parts.append("<p>Planned visit IDs use the saved campaign's station bindings. Effective visit IDs use "
                 "the station on the latest retained field event when one exists. Their difference remains visible.</p>")
    if record["station_assignment_issues"]:
        parts.append("<h3>Native station assignment findings</h3><pre>"
                     + escape(json.dumps(record["station_assignment_issues"], ensure_ascii=False, indent=2)) + "</pre>")
    parts.append("<h3>Original geography and reference</h3><p>" + escape(u["interpretation"])
                 + "</p><pre>" + escape(_text(u["reference"])) + "</pre>")
    differences = {name: record["method"][name] for name in (
        "selected_not_reachable_in_retained_graph", "reachable_outside_selected_utility",
        "known_external_upstream_huc12s")}
    parts.append("<p>The original source report uses its 303-record topology. "
                 "The Monitoring decision retains its original 217-polygon graph.</p><pre>"
                 + escape(json.dumps(differences, ensure_ascii=False, indent=2)) + "</pre>")
    if source_prefix is not None:
        parts.append('<p><a href="' + escape(source_prefix + _briefing_member(record), quote=True)
                     + '">Open the complete original utility source briefing</a> · <a href="'
                     + escape(source_prefix + "selected-watersheds.json", quote=True)
                     + '">Original selected watershed record</a></p>')
    parts.append("<p>Original preparation " + escape(record["binding"]["utility_preparation_id"])
                 + "; utility export " + escape(record["binding"]["utility_export_id"]) + ".</p></section>")
    return "".join(parts)


def attach(report, records, *, links=False):
    if not records:
        return report
    addition = "".join(fragment(row, source_prefix=(
        "utility-context/" + row["id"] + "/original-report/" if links else None)) for row in records)
    if "</main>" not in report:
        raise ValueError("The native Monitoring report no longer has its original content container")
    return report.replace("</main>", addition + "</main>", 1)


def _csv(rows):
    fields = list(dict.fromkeys(key for row in rows for key in row))
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow(fields)
    for row in rows:
        values = []
        for field in fields:
            value = row.get(field)
            cell = "" if value is None else _text(value)
            if cell.lstrip().startswith(("=", "+", "-", "@")):
                cell = "'" + cell
            values.append(cell)
        writer.writerow(values)
    return stream.getvalue().encode("utf-8-sig")


def _context_members(record, prepared):
    """Render one retained plan context without reopening its shared source files."""
    if (prepared["id"] != record["binding"]["utility_preparation_id"]
            or prepared["record_sha256"] != record["binding"]["utility_preparation_record_sha256"]):
        raise ValueError("The utility preparation changed during Monitoring export")
    prefix = "utility-context/" + record["id"] + "/"
    yield prefix + "preparation.json", bytes_member(canonical(prepared) + b"\n")
    yield prefix + "context.json", bytes_member(canonical(record) + b"\n")
    yield prefix + "catchment-context.csv", bytes_member(_csv(record["catchments"]))
    yield prefix + "station-context.csv", bytes_member(_csv(record["stations"]))
    report = ("<!doctype html><html lang='en'><meta charset='utf-8'><title>Utility monitoring context</title>"
              "<style>body{font:15px/1.5 system-ui,sans-serif;color:#222;background:white;max-width:1200px;margin:24px auto;padding:16px}"
              "table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #aaa;text-align:left;vertical-align:top;overflow-wrap:anywhere}"
              ".utility-context-table{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>"
              + fragment(record, source_prefix="original-report/") + "</html>")
    yield prefix + "report.html", bytes_member(report.encode("utf-8"))


def export_members(workspace, records):
    """Stream exact original source-report members with the native field package."""
    for record in records:
        prefix = "utility-context/" + record["id"] + "/"
        prepared = utility_monitoring.inspect(workspace, record["binding"]["utility_preparation_id"])
        yield from _context_members(record, prepared)
        directory, exported, _, _, _ = utility_monitoring.export_selection(
            workspace, record["binding"]["utility_export_id"])
        if exported["files"] != record["binding"]["original_files"]:
            raise ValueError("The utility source report changed during Monitoring export")
        for name, descriptor in exported["files"].items():
            # Native source companions already retain the original complete ZIP.
            # Ordinary relative files make its original briefing usable without a nested extraction.
            if name == "utility-watershed-packet.zip":
                continue
            path = verify_file(directory, descriptor)
            yield prefix + "original-report/" + name, file_member(path, descriptor["bytes"], descriptor["sha256"])


def _visits(plan, campaign, events):
    """Rebuild the original native campaign calendar without changing its choices."""
    if campaign is None:
        return plan["calendar"]["visits"]
    recent = {event["visit_key"]: event for event in events
              if event["plan_id"] == plan["id"] and event["status"] != "note"}
    rows = []
    for visit in plan["calendar"]["visits"]:
        event = recent.get(visit["visit_key"])
        planned = campaign["site_bindings"].get(visit["site_id"])
        rows.append({
            **visit, "planned_station_id": planned,
            "station_id": event.get("station_id") if event else planned,
            "status": event["status"] if event else "planned",
            "latest_event_id": event["id"] if event else None,
        })
    return rows


def read_bundle(archive, manifest, plan, network, campaign, events, *,
                context_ids=None, original_prefixes=None):
    """Read contexts from the already byte-verified original native ZIP.

    The report producer verifies every manifest member before calling this
    function. Original preparation, utility selection and all source members are
    checked here against the same plan, network and exact campaign calendar.
    Older native archives without utility context retain their existing meaning.
    """
    files = {row["path"]: row for row in manifest["files"]}
    contexts_found = []
    wanted = None if context_ids is None else set(context_ids)
    if wanted is not None and (len(wanted) != len(context_ids)
                              or any(not re.fullmatch(r"[0-9a-f]{64}", key) for key in wanted)):
        raise ValueError("Select distinct original utility context IDs")
    visits = _visits(plan, campaign, events)
    for name in sorted(files):
        if not re.fullmatch(r"utility-context/[0-9a-f]{64}/context\.json", name):
            continue
        key = name.split("/")[1]
        if wanted is not None and key not in wanted:
            continue
        record = json.loads(archive.read(name))
        binding = record.get("binding", {})
        if (record.get("schema") != SCHEMA or record.get("id") != key
                or digest(binding) != key
                or record.get("record_sha256") != digest({
                    k: v for k, v in record.items() if k != "record_sha256"})
                or binding.get("plan_id") != plan["id"]
                or binding.get("network_id") != network["id"]
                or binding.get("actual_visits_sha256") != digest(visits)
                or plan["source_bindings"] != network["source_bindings"]):
            raise ValueError("Utility context differs from the original native plan/calendar")
        prefix = "utility-context/" + key + "/"
        preparation = json.loads(archive.read(prefix + "preparation.json"))
        if (preparation.get("schema") != utility_monitoring.SCHEMA
                or preparation.get("state") != "complete"
                or preparation.get("id") != binding["utility_preparation_id"]
                or digest(preparation["identity"]) != preparation["id"]
                or preparation["identity"]["workspace_id"] != binding["workspace_id"]
                or preparation.get("network_id") != network["id"]
                or preparation.get("export_id") != binding["utility_export_id"]
                or preparation.get("record_sha256") != binding["utility_preparation_record_sha256"]
                or digest({k: v for k, v in preparation.items() if k != "record_sha256"})
                   != preparation["record_sha256"]
                or preparation["method"] != record["method"]):
            raise ValueError("Utility context differs from its retained original preparation")
        original_prefix = (original_prefixes or {}).get(key, prefix + "original-report/")
        originals = binding["original_files"]
        if binding["original_selection"] != originals["selected-watersheds.json"]:
            raise ValueError("Utility context selected-watershed descriptor differs")
        for original_name, descriptor in originals.items():
            if original_name == "utility-watershed-packet.zip":
                continue
            member = files.get(original_prefix + original_name)
            if member is None or any(member[field] != descriptor[field] for field in ("bytes", "sha256")):
                raise ValueError("Utility context is missing an unchanged original: " + original_name)
        selected = json.loads(archive.read(original_prefix + "selected-watersheds.json"))
        utility = selected["utility_selection"]
        if (selected.get("export_id") != binding["utility_export_id"]
                or utility != record["utility"]
                or selected.get("selected_huc12s") != utility["huc12s"]
                or selected.get("observed_context") != record["original_observations"]
                or digest({k: v for k, v in utility.items() if k != "key"}) != utility["key"]):
            raise ValueError("Utility context differs from its retained source selection")
        expected = {key: plan[key] for key in (
            "id", "title", "status", "coverage_mode", "coverage_meaning", "coverage", "configuration")}
        expected.update(target_units="ha", selected_context_huc12s=sorted(
            set(plan["selected_ids"]) - set(utility["huc12s"])))
        if record["plan"] != expected:
            raise ValueError("Utility report objective differs from its saved Monitoring decision")
        contexts_found.append(record)
    if wanted is not None and {row["id"] for row in contexts_found} != wanted:
        raise ValueError("The native packet omits a selected original utility context")
    return contexts_found


def source_links(records):
    return [name for row in records for name in (
        "native/utility-context/" + row["id"] + "/context.json",
        "native/utility-context/" + row["id"] + "/preparation.json",
        "native/utility-context/" + row["id"] + "/catchment-context.csv",
        "native/utility-context/" + row["id"] + "/station-context.csv",
        "native/utility-context/" + row["id"] + "/report.html",
        "native/utility-context/" + row["id"] + "/original-report/" + _briefing_member(row),
        "native/utility-context/" + row["id"] + "/original-report/selected-watersheds.json",
    )]


def scientific_sections(records, *, package_prefix="native/", original_prefixes=None):
    """Use the current ordered SourceReports blocks and exact native ZIP members."""
    def table(columns, rows):
        return {"kind": "table", "columns": columns,
                "rows": [[_text(value) for value in row] for row in rows]}
    def links(items):
        return {"kind": "links", "items": [{"title": title, "path": path} for title, path in items]}
    sections = []
    for record in records:
        utility, plan = record["utility"], record["plan"]
        prefix = package_prefix + "utility-context/" + record["id"] + "/"
        original_prefix = package_prefix + (original_prefixes or {}).get(
            record["id"], "utility-context/" + record["id"] + "/original-report/")
        sections.append(["Utility planning objective: " + utility["title"], [
            record["method"]["geographic_basis"] + ". " + record["method"]["description"],
            table(["Saved value", "Meaning"], [
                ["Original utility HUC12 count", len(utility["huc12s"])],
                ["Covered target overlap (ha)", plan["coverage"]["covered_weight"]],
                ["Total target overlap (ha)", plan["coverage"]["total_weight"]],
                ["Coverage mode", plan["coverage_mode"]],
                ["Saved plan", plan["id"]],
                ["Selected contextual HUC12s", plan["selected_context_huc12s"]],
            ]),
            plan["coverage_meaning"] + ". " + record["interpretation"][0],
            "Native geodesic catchment area and the EPSG:5070 overlap-hectare objective use distinct area definitions. "
            "Whole-HUC utility membership remains the original source selection; contextual search areas remain explicit.",
            table(["HUC12", "Utility target", "Selected search area", "Covered",
                   "Target overlap (ha)", "Native geodesic area (km²)", "Historical station count",
                   "Inventory state", "Scheduled visits"],
                  [[row["huc12"], row["utility_target"], row["selected_search_area"], row["covered_in_plan"],
                    row["target_overlap_ha"], row["native_geodesic_area_km2"], row["native_station_count"],
                    row["station_inventory_state"], row["scheduled_visits"]]
                   for row in record["catchments"]]),
            links([("Complete catchment-context CSV", prefix + "catchment-context.csv"),
                   ("Complete exact utility decision context", prefix + "context.json")]),
        ]])
        sections.append(["Historical station evidence and programme choices: " + utility["title"], [
            "Original source membership, native geometry assignment, verified-outlet status, explicit "
            "existing-programme credit and saved field bindings remain separate. A historical source station "
            "does not acquire programme credit merely by appearing in the inventory.",
            "Planned visits use the saved campaign station binding; effective visits use the station on its "
            "latest retained field event when present. Unselected station sources retain unavailable "
            "catchment inventories. Boundary ambiguity remains explicit.",
            table(["Station", "Original HUC12", "Original membership", "Native HUC12", "Native assignment",
                   "Verified outlet", "Existing credit", "Planned visits", "Effective visits"],
                  [[row["station_id"], row["original_matched_huc12"], row["original_membership_basis"],
                    row["native_huc12"], row["native_assignment"], row["outlet_verified"],
                    row["explicit_existing_credit"], row["scheduled_visit_ids"], row["effective_visit_ids"]]
                   for row in record["stations"]]),
            table(["Station", "Possible native catchments", "Native finding"],
                  [[row["station_id"], row["candidate_catchments"], row["reason"]]
                   for row in record["station_assignment_issues"]]),
            links([("Complete original and native station context CSV", prefix + "station-context.csv")]),
        ]])
        observed = record["original_observations"]
        if observed is not None:
            original, period = observed["utility"], observed["microbial_query_period"]
            summary, region = original["summary"], observed["regional_stream"]
            sections.append(["Original sampled context: " + utility["title"], [
                original["geographic_basis"] + ". Original query period: " + period["start"] + " to " + period["end"] + ".",
                table(["Original cohort quantity", "Retained value"], [
                    ["Source records", summary["records"]], ["Stations", summary["stations"]],
                    ["Unique sampling dates", summary["unique_dates"]],
                    ["First sample", summary["first_date"]], ["Last sample", summary["last_date"]],
                    ["Original concentration units", summary["source_units"]],
                    ["Original reporting-limit units", summary["limit_units"]],
                    ["Detection states", summary["detection_status"]],
                    ["Information Only records", summary["information_only_records"]],
                    ["Activity types", summary["activity_types"]],
                    ["Records with original source comments", summary["records_with_source_comments"]],
                ]),
                observed["methods"]["records"], observed["methods"]["summaries"], observed["methods"]["temporal"],
                table(["Year", "Stations", "Records", "Sample dates", "Observed months",
                       "Detection states", "Information Only"],
                      [[row["year"], row["stations"], row["records"], row["unique_dates"],
                        row["observed_months"], row["detection_status"], row["information_only_records"]]
                       for row in original["years"]]),
                "Regional nutrient and flow context: " + region["geographic_meaning"],
                region["quantity_meaning"], region["interpretation"], observed["methods"]["model_endpoint"],
                links([("Original station/year/method/activity/unit groups and source records",
                        original_prefix + "selected-watersheds.json")]),
            ]])
        sections.append(["Original source and graph scope: " + utility["title"], [
            utility["interpretation"],
            "The original utility source report uses its 303-record topology; the native Monitoring decision "
            "uses its retained 217-polygon graph. The following differences are preserved independently.",
            table(["Relationship", "Original HUC12s"], [
                ["Utility selected but not reachable in retained graph", record["method"]["selected_not_reachable_in_retained_graph"]],
                ["Graph-reachable outside selected utility", record["method"]["reachable_outside_selected_utility"]],
                ["Known external upstream", record["method"]["known_external_upstream_huc12s"]],
            ]),
            table(["Original source identity", "Value"], [
                ["Utility reference", utility["reference"]],
                ["Utility preparation", record["binding"]["utility_preparation_id"]],
                ["Original utility export", record["binding"]["utility_export_id"]],
                ["Original profile SHA256", utility["profile_source"]["sha256"]],
            ]),
            links([("Complete original utility source briefing", original_prefix + _briefing_member(record)),
                   ("Retained native preparation", prefix + "preparation.json"),
                   ("Portable utility decision report", prefix + "report.html")]),
        ]])
    return sections

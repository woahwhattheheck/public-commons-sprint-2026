"""Original utility context across saved Monitoring budget choices.

The existing comparison owns every solver result and baseline. This module adds
source and area interpretation, retaining each original utility report once.
"""
from __future__ import annotations

from copy import deepcopy
from html import escape
import json

from .common import canonical, digest, file_digest, verify_file
from . import utility_monitoring, utility_monitoring_report as single
from .monitoring_packet import bytes_member, file_member

SCHEMA = "upstate.utility-monitoring-comparison/v1"
FEASIBLE = {"optimal", "feasible"}


def implementation():
    from . import monitoring_frontier_comparison
    return {"comparison_context_sha256": file_digest(__file__),
            "utility_context_sha256": file_digest(single.__file__),
            "comparison_exporter_sha256": file_digest(monitoring_frontier_comparison.__file__)}


def _source(workspace, prepared):
    if prepared["method"]["target_units"] != "ha":
        raise ValueError("Use the original utility overlap-hectare preparation for this report")
    directory, export, selection, utility, _ = utility_monitoring.export_selection(
        workspace, prepared["export_id"])
    for descriptor in export["files"].values():
        verify_file(directory, descriptor)
    return {
        "export_id": export["id"], "preparation": deepcopy(prepared),
        "utility": deepcopy(utility), "observations": deepcopy(selection.get("observed_context")),
        "original_files": deepcopy(export["files"]),
    }


def prepare(workspace, comparison, network, plans):
    """Present already saved plans without solving or assigning a station."""
    if (comparison["network_id"] != network["id"]
            or comparison["project_id"] != workspace.project["id"]
            or [plan["id"] for plan in plans] != comparison["plan_ids"]
            or any(plan["network_id"] != network["id"] for plan in plans)):
        raise ValueError("Utility budget context needs the original comparison/network/ordered plans")
    originals = {}
    for row in utility_monitoring.catalog(workspace):
        if row["network_id"] == network["id"]:
            prepared = utility_monitoring.inspect(workspace, row["id"])
            original = _source(workspace, prepared)
            originals[prepared["id"]] = original
    if not originals:
        return None
    contexts, by_plan, rows = [], {}, []
    comparison_rows = {row["plan_id"]: row for row in comparison["rows"]}
    for plan in plans:
        available = plan["status"] in FEASIBLE
        found = single.contexts(workspace, plan, network, plan["calendar"]["visits"]) if available else []
        if available and {row["binding"]["utility_preparation_id"] for row in found} != set(originals):
            raise ValueError("Utility preparation inventory changed during comparison export")
        contexts.extend(found)
        by_plan[plan["id"]] = [row["id"] for row in found]
        result = comparison_rows[plan["id"]]
        for original in originals.values():
            utility = original["utility"]
            target = set(utility["huc12s"])
            selected = set(plan["selected_ids"]) if available else set()
            context = next((row for row in found if row["binding"]["utility_preparation_id"]
                            == original["preparation"]["id"]), None)
            rows.append({
                "utility_id": utility["utility_id"], "utility_title": utility["title"],
                "utility_export_id": original["export_id"],
                "utility_preparation_id": original["preparation"]["id"],
                "plan_id": plan["id"], "plan_title": result["title"], "status": plan["status"],
                "available": available, "is_baseline": result["is_baseline"],
                "budget_cents": result["budget_cents"], "currency": result["currency"],
                "coverage_mode": plan["coverage_mode"], "target_units": "ha",
                "total_target_ha": plan["coverage"]["total_weight"] if available else None,
                "covered_target_ha": plan["coverage"]["covered_weight"] if available else None,
                "existing_target_ha": plan["coverage"]["baseline_weight"] if available else None,
                "new_target_ha": result["new_covered_weight"],
                "change_from_baseline_ha": result["delta"]["covered_weight"] if result["delta"] else None,
                "original_utility_huc12s": utility["huc12s"],
                "selected_target_huc12s": sorted(selected & target) if available else None,
                "selected_context_huc12s": sorted(selected - target) if available else None,
                "covered_target_huc12s": sorted(set(plan["covered_ids"]) & target) if available else None,
                "historical_stations_in_selected_areas": (
                    sum(row["native_huc12"] in selected for row in context["stations"])
                    if context is not None and original["preparation"]["identity"]["include_microbial"] else None),
                "planned_visits": len(plan["calendar"]["visits"]) if available else None,
                "context_id": context["id"] if context else None,
            })
    identity = {
        "workspace_id": workspace.project["id"], "comparison_id": comparison["id"],
        "comparison_sha256": digest(comparison), "network_id": network["id"],
        "network_sha256": digest(network),
        "plan_digests": {plan["id"]: digest(plan) for plan in plans},
        "plan_order": [plan["id"] for plan in plans],
        "source_digests": {key: digest(value) for key, value in sorted(originals.items())},
        "context_digests": {row["id"]: row["record_sha256"] for row in contexts},
        **implementation(),
    }
    value = {
        "schema": SCHEMA, "id": digest(identity), "identity": identity,
        "baseline_plan_id": comparison["baseline_plan_id"],
        "sources": originals, "plan_context_ids": by_plan, "rows": rows,
        "context_ids": [row["id"] for row in contexts],
        "interpretation": [
            "Every budget row retains the original solver result and selected baseline.",
            "Utility target coverage is projected EPSG:5070 overlap hectares; geodesic catchment area remains separate.",
            "Unavailable solver results retain unavailable cost/coverage/calendar quantities, rather than zero coverage.",
            "Original observation cohorts stay distinct from source stations inside selected search areas and from future field commitments.",
            "Each original utility source report is included once; its exact plan contexts reference that same source edition.",
            "Different utility selections and overlapping catchment sets are not additive.",
        ],
    }
    value["record_sha256"] = digest(value)
    return {"record": value, "contexts": contexts}


def _original_prefix(context):
    return "utility-sources/" + context["binding"]["utility_export_id"] + "/"


def members(workspace, prepared):
    record, contexts = prepared["record"], prepared["contexts"]
    yield "utility-comparison.json", bytes_member(canonical(record) + b"\n")
    yield "utility-budget-context.csv", bytes_member(single._csv(record["rows"]))
    # Plan metadata remains separate; shared original source bytes are streamed once.
    for context in contexts:
        prefix = "utility-context/" + context["id"] + "/"
        for name, member in single.export_members(workspace, [context]):
            if name.startswith(prefix + "original-report/"):
                continue
            if name == prefix + "report.html":
                original = member["content"].decode("utf-8")
                original = original.replace('href="original-report/',
                                            'href="../../' + _original_prefix(context))
                member = bytes_member(original.encode("utf-8"))
            yield name, member
    seen = {}
    for original in record["sources"].values():
        directory, export, _, _, _ = utility_monitoring.export_selection(workspace, original["export_id"])
        if export["files"] != original["original_files"]:
            raise ValueError("Original utility source files changed during comparison export")
        for name, descriptor in export["files"].items():
            if name == "utility-watershed-packet.zip":
                continue
            member_name = "utility-sources/" + export["id"] + "/" + name
            identity = (descriptor["bytes"], descriptor["sha256"])
            if member_name in seen:
                if seen[member_name] != identity:
                    raise ValueError("Original utility comparison source members conflict")
                continue
            seen[member_name] = identity
            path = verify_file(directory, descriptor)
            yield member_name, file_member(path, descriptor["bytes"], descriptor["sha256"])


def read_bundle(archive, manifest, comparison, network, plans):
    """Validate the utility edition after the producer verifies the full native ZIP."""
    files = {row["path"]: row for row in manifest["members"]}
    if "utility-comparison.json" not in files:
        return None
    record = json.loads(archive.read("utility-comparison.json"))
    identity = record.get("identity", {})
    if (record.get("schema") != SCHEMA or record.get("id") != digest(identity)
            or manifest.get("utility_presentation_id") != record.get("id")
            or record.get("record_sha256") != digest({
                key: value for key, value in record.items() if key != "record_sha256"})
            or identity.get("workspace_id") != comparison["project_id"]
            or identity.get("comparison_id") != comparison["id"]
            or identity.get("comparison_sha256") != digest(comparison)
            or identity.get("network_id") != network["id"]
            or identity.get("network_sha256") != digest(network)
            or identity.get("plan_order") != [plan["id"] for plan in plans]
            or identity.get("plan_digests") != {plan["id"]: digest(plan) for plan in plans}
            or record.get("baseline_plan_id") != comparison["baseline_plan_id"]
            or set(record["plan_context_ids"]) != {plan["id"] for plan in plans}
            or identity.get("source_digests") != {
                key: digest(value) for key, value in sorted(record["sources"].items())}):
        raise ValueError("Utility budget context differs from its original comparison and plans")
    for key, original in record["sources"].items():
        preparation = original["preparation"]
        if (preparation.get("schema") != utility_monitoring.SCHEMA or preparation.get("state") != "complete"
                or preparation.get("id") != key or digest(preparation["identity"]) != key
                or preparation["identity"]["workspace_id"] != comparison["project_id"]
                or preparation["network_id"] != network["id"]
                or preparation["export_id"] != original["export_id"]
                or preparation["record_sha256"] != digest({
                    k: v for k, v in preparation.items() if k != "record_sha256"})):
            raise ValueError("Original utility comparison preparation differs")
        prefix = "utility-sources/" + original["export_id"] + "/"
        for name, descriptor in original["original_files"].items():
            if name == "utility-watershed-packet.zip":
                continue
            item = files.get(prefix + name)
            if item is None or any(item[field] != descriptor[field] for field in ("bytes", "sha256")):
                raise ValueError("Original utility comparison source member is absent or changed: " + name)
        selection = json.loads(archive.read(prefix + "selected-watersheds.json"))
        if (selection["export_id"] != original["export_id"]
                or selection["utility_selection"] != original["utility"]
                or selection.get("observed_context") != original["observations"]
                or selection.get("selected_huc12s") != original["utility"]["huc12s"]
                or digest({k: v for k, v in original["utility"].items() if k != "key"})
                   != original["utility"]["key"]):
            raise ValueError("Original utility comparison source selection differs")
    contexts = []
    expected_names = set()
    for plan in plans:
        ids = record["plan_context_ids"][plan["id"]]
        if plan["status"] not in FEASIBLE:
            if ids:
                raise ValueError("An unavailable solver result cannot have feasible utility plan metrics")
            continue
        prefixes = {}
        for key in ids:
            value = json.loads(archive.read("utility-context/" + key + "/context.json"))
            prefixes[key] = _original_prefix(value)
        found = single.read_bundle(archive, {"files": manifest["members"]}, plan, network, None, [],
                                   context_ids=ids, original_prefixes=prefixes)
        by_id = {row["id"]: row for row in found}
        found = [by_id[key] for key in ids]
        if {row["binding"]["utility_preparation_id"] for row in found} != set(record["sources"]):
            raise ValueError("A feasible comparison plan omits an original utility source context")
        contexts.extend(found)
        expected_names.update("utility-context/" + row["id"] + "/context.json" for row in found)
    actual_names = {name for name in files if name.startswith("utility-context/") and name.endswith("/context.json")}
    if (actual_names != expected_names or [row["id"] for row in contexts] != record["context_ids"]
            or identity["context_digests"] != {row["id"]: row["record_sha256"] for row in contexts}):
        raise ValueError("Original utility budget contexts differ from their retained inventory")
    return {"record": record, "contexts": contexts}


def _budget_rows(record):
    return [[row["utility_title"], row["plan_title"], row["status"],
             str(row["budget_cents"] // 100) + "." + str(row["budget_cents"] % 100).zfill(2) + " " + row["currency"],
             row["covered_target_ha"], row["existing_target_ha"], row["new_target_ha"],
             row["change_from_baseline_ha"], row["historical_stations_in_selected_areas"],
             row["planned_visits"]] for row in record["rows"]]


HEADERS = ["Original utility source", "Saved plan", "Solver status", "Budget",
           "Total covered (ha)", "Existing credit (ha)", "New covered (ha)",
           "Change from baseline (ha)", "Historical stations in selected search areas", "Planned visits"]


def _source_blocks(record, *, package_prefix=""):
    """Shared original context appears once for each retained utility preparation."""
    blocks = []
    for original in record["sources"].values():
        utility, prepared = original["utility"], original["preparation"]
        prefix = package_prefix + "utility-sources/" + original["export_id"] + "/"
        files = original["original_files"]
        briefing = next((name for name in ("source-context-report-briefing.html",
                                           "watershed-selection-brief.html") if name in files),
                        "selected-watersheds.json")
        values = [
            ("Original utility", utility["title"]),
            ("Original selected HUC12s", utility["huc12s"]),
            ("Area objective", prepared["method"]["target_quantity"]),
            ("Original geography", prepared["method"]["geographic_basis"]),
            ("Original source reference", utility["reference"]),
            ("Original profile SHA256", utility["profile_source"]["sha256"]),
            ("Preparation", prepared["id"]), ("Utility export", original["export_id"]),
        ]
        text = [utility["interpretation"], *prepared["method"]["interpretation"]]
        observed = original["observations"]
        if observed:
            cohort, region = observed["utility"]["summary"], observed["regional_stream"]
            values.extend([
                ("Original query period", observed["microbial_query_period"]),
                ("Original sample records", cohort["records"]), ("Original source stations", cohort["stations"]),
                ("Original unique sample dates", cohort["unique_dates"]),
                ("Original sampling dates", [cohort["first_date"], cohort["last_date"]]),
                ("Original concentration units", cohort["source_units"]),
                ("Original reporting-limit units", cohort["limit_units"]),
                ("Detection states", cohort["detection_status"]),
                ("Information Only records", cohort["information_only_records"]),
                ("Original activity types", cohort["activity_types"]),
            ])
            text.extend([observed["utility"]["geographic_basis"], observed["methods"]["records"],
                         observed["methods"]["summaries"], observed["methods"]["temporal"],
                         region["geographic_meaning"], region["quantity_meaning"], region["interpretation"]])
        blocks.append({"title": utility["title"], "values": values, "paragraphs": text,
                       "links": [("Original utility source report", prefix + briefing),
                                 ("Complete original utility selection and observation groups",
                                  prefix + "selected-watersheds.json")]})
    return blocks


def attach(report, prepared):
    """Enrich the original native comparison HTML without replacing its calculation."""
    if prepared is None:
        return report
    record, contexts = prepared["record"], prepared["contexts"]
    parts = ["<section class='utility-budget-context'><h2>Original utility scope across saved budgets</h2>",
             single._table(HEADERS, _budget_rows(record)),
             "<p>Area columns use the original EPSG:5070 overlap-hectare objective. "
             "Existing credit, new coverage and changes from the selected baseline remain separate. "
             "An unavailable solver result retains unavailable quantities. Historical source stations inside a "
             "selected search area do not identify a future station commitment.</p>"]
    parts.append('<p><a href="utility-budget-context.csv">Complete utility budget table</a> · '
                 '<a href="utility-comparison.json">Retained utility comparison source record</a></p>')
    for source in _source_blocks(record):
        parts.append("<h3>" + escape(source["title"]) + "</h3>")
        parts.append(single._table(["Original source quantity", "Retained value"], source["values"]))
        parts.extend("<p>" + escape(value) + "</p>" for value in source["paragraphs"])
        parts.append("<p>" + " · ".join(
            '<a href="' + escape(path, quote=True) + '">' + escape(title) + "</a>"
            for title, path in source["links"]) + "</p>")
    if contexts:
        parts.append("<h3>Complete original utility context for each feasible choice</h3><ul>")
        for context in contexts:
            prefix = "utility-context/" + context["id"] + "/"
            parts.append("<li>" + escape(context["utility"]["title"] + " — " + context["plan"]["title"])
                         + ': <a href="' + prefix + 'report.html">Area and station report</a> · '
                         + '<a href="' + prefix + 'catchment-context.csv">Catchment CSV</a> · '
                         + '<a href="' + prefix + 'station-context.csv">Station CSV</a></li>')
        parts.append("</ul>")
    parts.extend("<p>" + escape(value) + "</p>" for value in record["interpretation"])
    parts.append("</section>")
    if "</main>" not in report:
        raise ValueError("The original comparison report content container changed")
    return report.replace("</main>", "".join(parts) + "</main>", 1)


def scientific_sections(prepared):
    if prepared is None:
        return []
    record, contexts = prepared["record"], prepared["contexts"]
    def table(headers, rows):
        return {"kind": "table", "columns": headers,
                "rows": [[single._text(value) for value in row] for row in rows]}
    def links(items):
        return {"kind": "links", "items": [{"title": title, "path": path} for title, path in items]}
    sections = [["Utility source area across saved budget choices", [
        *record["interpretation"], table(HEADERS, _budget_rows(record)),
        "Historical station counts use the original source inventory assigned by the saved native network. "
        "They are unavailable when that station source was not selected. Planned visits keep the original "
        "plan calendar and do not assign station coordinates.",
        links([("Full utility comparison record", "native-comparison/utility-comparison.json"),
               ("Original utility budget table", "native-comparison/utility-budget-context.csv")]),
    ]]]
    for source in _source_blocks(record, package_prefix="native-comparison/"):
        sections.append(["Original utility evidence: " + source["title"], [
            table(["Original source quantity", "Retained value"], source["values"]),
            *source["paragraphs"], links(source["links"]),
        ]])
    prefixes = {row["id"]: _original_prefix(row) for row in contexts}
    for context in contexts:
        # These two blocks explain the actual selected/covered geometry and source
        # stations. Shared original cohort and topology evidence is above, once.
        own = single.scientific_sections(
            [context], package_prefix="native-comparison/", original_prefixes=prefixes)
        for heading, paragraphs in own[:2]:
            sections.append([heading + " — " + context["plan"]["title"], paragraphs])
    return sections


def source_links(prepared):
    if prepared is None:
        return []
    paths = ["native-comparison/utility-comparison.json",
             "native-comparison/utility-budget-context.csv"]
    for source in _source_blocks(prepared["record"], package_prefix="native-comparison/"):
        paths.extend(path for _, path in source["links"])
    for context in prepared["contexts"]:
        prefix = "native-comparison/utility-context/" + context["id"] + "/"
        paths.extend(prefix + leaf for leaf in (
            "context.json", "preparation.json", "catchment-context.csv", "station-context.csv", "report.html"))
    return list(dict.fromkeys(paths))

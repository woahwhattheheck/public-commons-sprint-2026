"""Saved budget comparisons over original Monitoring plans and source contexts.

This module reads completed native designs. It never executes an optimizer or
changes the original scientific source, plan, campaign or observed context.
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

from .monitoring_common import ContractError, canonical_bytes, digest, atomic_json, load_json
from .monitoring_campaign import money_cents, dollars
from .monitoring_workspace import MonitoringWorkspace, csv_text
from .monitoring_packet import add_member, bytes_member, retain_packet
from .monitoring_sources import source_export_members, verify_retained_binding

COLLECTION = "monitoring_frontier_comparisons"
SCHEMA = "upstate." + COLLECTION + "/v1"
RECIPE = "upstate.monitoring-frontier-comparison/1"
FEASIBLE = {"optimal", "feasible"}


def _ids(value, label):
    if not isinstance(value, list) or any(not isinstance(v, str) or not v for v in value):
        raise ContractError(label + " must contain original record IDs")
    if len(set(value)) != len(value):
        raise ContractError(label + " contains a repeated original record")
    return value


def _configuration(plan):
    return {key: value for key, value in plan["configuration"].items() if key != "budget"}


def _records(workspace, frontier_id, *, retained=False):
    service = MonitoringWorkspace(workspace)
    frontier = service.get("frontiers", frontier_id)
    ids = _ids(frontier.get("plan_ids"), "Saved frontier plans")
    if not ids or frontier.get("budgets_completed") != len(ids):
        raise ContractError("The original frontier has no complete ordered plan inventory")
    network = service.get("networks", frontier["network_id"])
    if retained:
        for binding in network["source_bindings"].values():
            if binding:
                verify_retained_binding(workspace, binding)
    else:
        service.verify_sources(network)
    plans, configuration, seen_budgets = [], None, set()
    for identity in ids:
        plan = service.get("plans", identity)
        if (plan["network_id"] != network["id"]
                or plan.get("frontier_job_id") != frontier.get("job_id")):
            raise ContractError("A saved plan belongs to another original frontier or network")
        budget = money_cents(plan["configuration"]["budget"], "Original plan budget")
        if plan.get("frontier_budget_cents") != budget or budget in seen_budgets:
            raise ContractError("Original frontier budget identity differs or repeats")
        seen_budgets.add(budget)
        options = _configuration(plan)
        if configuration is not None and options != configuration:
            raise ContractError("Saved frontier plans differ beyond their original budget")
        configuration = options
        if (plan.get("weight_basis") != network["weight_basis"]
                or plan.get("source_bindings") != network["source_bindings"]):
            raise ContractError("Original plan objective or source edition differs from its network")
        if plan.get("status") in FEASIBLE and plan.get("cost", {}).get("budget_cents") != budget:
            raise ContractError("Original feasible plan cost uses another budget")
        plans.append(plan)
    return service, frontier, network, plans


def _contexts(workspace, context_ids, network_id, plan_ids):
    from .monitoring_observed_context import inspect as inspect_context
    by_plan, records = {}, []
    for identity in _ids(context_ids, "Observed context IDs"):
        record = inspect_context(workspace, identity)
        if record["network_id"] != network_id or record.get("plan_id") not in plan_ids:
            raise ContractError("Observed context must name an exact plan of this saved frontier")
        if record["plan_id"] in by_plan:
            raise ContractError("Choose one retained observed context for each original plan")
        by_plan[record["plan_id"]] = record
        records.append(record)
    return by_plan, records


def _observed(record):
    if record is None:
        return None
    selected = [row for row in record["station_matches"] if row["selected_search_area"]]
    return {
        "context_id": record["id"], "source_binding": record["source_binding"],
        "source_period": record["source_period"], "source_edition": record.get("source_edition"),
        "station_mapping": record["station_mapping"], "flow_scope": record.get("flow_scope"),
        "campaign_id": record.get("campaign_id"),
        "campaign_revision_id": record.get("campaign_revision_id"),
        "selected_source_station_ids": [row["source_station_id"] for row in selected],
        "selected_search_area_source_stations": len(selected),
        "selected_search_area_activities": sum(row["activities"] for row in selected),
        "selected_search_area_observations": sum(row.get("observations", 0) for row in selected),
        "selected_station_matches": selected, "summary": record["summary"],
        "interpretation": record["interpretation"],
    }


def preview(workspace, *, frontier_id, baseline_plan_id=None, context_ids=None,
            title="Saved monitoring budget comparison"):
    if not isinstance(title, str) or not title.strip():
        raise ContractError("Name the saved budget comparison")
    service, frontier, network, plans = _records(workspace, frontier_id)
    baseline_plan_id = baseline_plan_id or plans[0]["id"]
    plan_by_id = {plan["id"]: plan for plan in plans}
    if baseline_plan_id not in plan_by_id:
        raise ContractError("Choose an original frontier plan as the comparison baseline")
    contexts, context_records = _contexts(
        workspace, [] if context_ids is None else context_ids, network["id"], plan_by_id)
    baseline = plan_by_id[baseline_plan_id]
    baseline_ready = baseline["status"] in FEASIBLE
    rows = []
    for plan in plans:
        available = plan["status"] in FEASIBLE
        cost = plan.get("cost") if available else None
        coverage = plan.get("coverage") if available else None
        selected = set(plan["selected_ids"])
        covered = set(plan.get("covered_ids", []))
        can_compare = available and baseline_ready
        source_context = _observed(contexts.get(plan["id"]))
        base_context = _observed(contexts.get(baseline_plan_id))
        same_observed_basis = bool(source_context and base_context and
            source_context["source_binding"] == base_context["source_binding"] and
            source_context["station_mapping"] == base_context["station_mapping"] and
            source_context["flow_scope"] == base_context["flow_scope"])
        visits = plan.get("calendar", {}).get("visits", []) if available else []
        row = {
            "plan_id": plan["id"], "title": plan.get("title", plan["id"]),
            "status": plan["status"], "available": available,
            "is_baseline": plan["id"] == baseline_plan_id,
            "budget_cents": plan["frontier_budget_cents"],
            "budget_display": dollars(plan["frontier_budget_cents"]),
            "currency": plan["configuration"].get("currency", "USD"),
            "cost": cost, "coverage": coverage,
            "selected_sites": len(selected) if available else None,
            "selected_ids": plan["selected_ids"],
            "covered_ids": plan.get("covered_ids") if available else None,
            "baseline_covered_ids": plan.get("baseline_covered_ids", []),
            "new_covered_weight": (coverage["covered_weight"] - coverage["baseline_weight"]
                                   if coverage is not None else None),
            "weight_basis": plan["weight_basis"], "coverage_mode": plan["coverage_mode"],
            "coverage_meaning": plan["coverage_meaning"],
            "max_sites": plan["configuration"].get("max_sites", len(network["nodes"])),
            "calendar_site_capacity": plan["calendar_site_capacity"],
            "solver": plan.get("solver"), "diagnostics": plan.get("diagnostics", []),
            "warnings": plan.get("warnings", []),
            "calendar": {"visits": len(visits),
                         "first_date": min((v["date"] for v in visits), default=None),
                         "last_date": max((v["date"] for v in visits), default=None)}
                        if available else None,
            "delta": {
                "total_cost_cents": cost["total_cents"] - baseline["cost"]["total_cents"],
                "covered_weight": coverage["covered_weight"] - baseline["coverage"]["covered_weight"],
                "selected_sites": len(selected) - len(baseline["selected_ids"]),
                "added_search_area_ids": sorted(selected - set(baseline["selected_ids"])),
                "removed_search_area_ids": sorted(set(baseline["selected_ids"]) - selected),
                "retained_search_area_ids": sorted(selected.intersection(baseline["selected_ids"])),
                "added_covered_ids": sorted(covered - set(baseline["covered_ids"])),
                "removed_covered_ids": sorted(set(baseline["covered_ids"]) - covered),
            } if can_compare else None,
            "observed": source_context,
            "same_observed_source_as_baseline": same_observed_basis,
        }
        rows.append(row)
    return {
        "schema": SCHEMA, "recipe": RECIPE, "title": title.strip(),
        "project_id": workspace.project["id"],
        "selection": {"frontier_id": frontier_id, "baseline_plan_id": baseline_plan_id,
                      "context_ids": [record["id"] for record in context_records]},
        "frontier_id": frontier_id, "frontier_digest": digest(frontier),
        "network_id": network["id"], "network_digest": digest(network),
        "network_title": network.get("title", network["id"]),
        "source_bindings": network["source_bindings"],
        "baseline_plan_id": baseline_plan_id,
        "plan_ids": [plan["id"] for plan in plans],
        "plan_digests": {plan["id"]: digest(plan) for plan in plans},
        "context_digests": {record["id"]: digest(record) for record in context_records},
        "configuration_without_budget": _configuration(plans[0]),
        "weight_basis": network["weight_basis"], "rows": rows,
        "interpretation": [
            "Each row reopens an original completed frontier plan; solver status and diagnostics remain unchanged.",
            "Coverage uses the retained source objective and units. Total coverage includes the original existing-station baseline; new covered weight excludes it.",
            "Costs retain integer cents, currency, overhead and the original existing-station cost scope.",
            "Catchment area and coverage refer to the retained model network; a separate reporting-boundary intersection requires its own original geography.",
            "Each budget was optimized independently. Added and removed search areas show the exact selected-set change from the chosen baseline.",
            "A selected catchment is a field search area. Original station coordinates and campaign bindings determine any actual field location.",
            "Observed support is attached only through a context for that exact saved plan. Source-period, station mapping, flow scope and retained campaign revision remain explicit.",
            "Original calendar dates remain unchanged. Historical sampling and daily flow are not shifted onto future field visits.",
        ],
    }


def prepare(workspace, **selection):
    return workspace._save(COLLECTION, preview(workspace, **selection))


def inspect(workspace, comparison_id):
    record = workspace._get(COLLECTION, comparison_id)
    if record.get("schema") != SCHEMA or record.get("recipe") != RECIPE:
        raise ContractError("Select an original saved monitoring budget comparison")
    if record.get("project_id") != workspace.project["id"]:
        raise ContractError("Saved comparison belongs to another original scientific project")
    _, frontier, network, plans = _records(workspace, record["frontier_id"], retained=True)
    if (digest(frontier) != record["frontier_digest"] or digest(network) != record["network_digest"]
            or [plan["id"] for plan in plans] != record["plan_ids"]
            or {plan["id"]: digest(plan) for plan in plans} != record["plan_digests"]):
        raise ContractError("Original frontier, source network or saved plans changed")
    _, contexts = _contexts(workspace, record["selection"]["context_ids"],
                            network["id"], record["plan_ids"])
    if {item["id"]: digest(item) for item in contexts} != record["context_digests"]:
        raise ContractError("The retained observed-support selection changed")
    return record


def list_saved(workspace, *, frontier_id=None):
    if frontier_id is not None:
        MonitoringWorkspace(workspace).get("frontiers", frontier_id)
    records = []
    for path in sorted((workspace.root / COLLECTION).glob("*.json")):
        value = workspace._get(COLLECTION, path.stem)
        if value.get("schema") != SCHEMA:
            raise ContractError("Saved budget comparison has an unsupported schema")
        if frontier_id is None or value["frontier_id"] == frontier_id:
            records.append({key: value[key] for key in (
                "id", "title", "frontier_id", "network_id", "baseline_plan_id", "plan_ids", "selection")})
    return {"records": records}


def _summary_rows(record):
    rows = []
    for row in record["rows"]:
        cost, coverage, delta = row["cost"] or {}, row["coverage"] or {}, row["delta"] or {}
        observed = row["observed"] or {}
        rows.append({
            "plan_id": row["plan_id"], "baseline_plan_id": record["baseline_plan_id"],
            "status": row["status"], "currency": row["currency"],
            "budget_cents": row["budget_cents"], "total_cost_cents": cost.get("total_cents"),
            "program_overhead_cents": cost.get("program_overhead_cents"),
            "remaining_cents": cost.get("remaining_cents"),
            "selected_sites": row["selected_sites"], "covered_weight": coverage.get("covered_weight"),
            "new_covered_weight": row["new_covered_weight"],
            "existing_baseline_weight": coverage.get("baseline_weight"), "weight_basis": row["weight_basis"],
            "coverage_mode": row["coverage_mode"], "coverage_fraction": coverage.get("fraction"),
            "delta_total_cost_cents": delta.get("total_cost_cents"),
            "delta_covered_weight": delta.get("covered_weight"),
            "added_search_area_ids": delta.get("added_search_area_ids"),
            "removed_search_area_ids": delta.get("removed_search_area_ids"),
            "calendar_visits": row["calendar"]["visits"] if row["calendar"] else None,
            "observed_context_id": observed.get("context_id"),
            "selected_search_area_source_stations": observed.get("selected_search_area_source_stations"),
            "selected_search_area_activities": observed.get("selected_search_area_activities"),
            "selected_search_area_observations": observed.get("selected_search_area_observations"),
            "same_observed_source_as_baseline": row["same_observed_source_as_baseline"],
        })
    return rows


def report_html(record):
    escape = lambda value: html.escape(str(value), quote=True)
    def show(value):
        if value is None:
            return "Unavailable"
        if isinstance(value, float):
            return escape(format(value, ".4g") if value and abs(value) < 0.0001
                          else format(value, ",.4f").rstrip("0").rstrip("."))
        if isinstance(value, int) and not isinstance(value, bool):
            return escape(format(value, ","))
        return escape(value)
    def table(headers, rows):
        return ("<table><thead><tr>" + "".join("<th>" + escape(v) + "</th>" for v in headers)
                + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + show(v) + "</td>" for v in row)
                + "</tr>" for row in rows) + "</tbody></table>")
    summary = []
    for row in record["rows"]:
        cost, coverage, delta = row["cost"] or {}, row["coverage"] or {}, row["delta"] or {}
        summary.append([row["budget_display"] + " " + row["currency"], row["status"],
                        row["selected_sites"], cost.get("total_display"), coverage.get("covered_weight"),
                        row["new_covered_weight"], delta.get("covered_weight"),
                        row["calendar"]["visits"] if row["calendar"] else None])
    pieces = [
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
        "<title>" + escape(record["title"]) + "</title>",
        "<style>body{font:15px/1.5 system-ui,sans-serif;color:#171717;background:#fff;max-width:1120px;margin:32px auto;padding:0 24px}h1{font-size:25px}h2{font-size:19px;margin-top:30px}h3{font-size:16px}table{border-collapse:collapse;width:100%;margin:16px 0;font-size:13px}th,td{padding:8px;border:1px solid #ccc;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f2f2f2}code{overflow-wrap:anywhere}li{margin:6px 0}.identity{font-size:12px;color:#444;overflow-wrap:anywhere}@media print{body{margin:0;max-width:none;padding:0}tr{break-inside:avoid}h2,h3{break-after:avoid}}</style>",
        "<main><h1>" + escape(record["title"]) + "</h1>",
        "<p>" + escape(record["network_title"]) + ". Objective: " + escape(record["weight_basis"]) + ".</p>",
        "<p class=\"identity\">Project " + escape(record["project_id"]) + "<br>Saved frontier "
        + escape(record["frontier_id"]) + "<br>Comparison baseline " + escape(record["baseline_plan_id"]) + "</p>",
        "<h2>Budget choices</h2>",
        table(["Budget", "Solver status", "Selected search areas", "Total cost", "Total covered weight",
               "New covered weight", "Change from baseline", "Planned visits"], summary),
        "<h2>Original plans and search-area changes</h2>",
    ]
    for row in record["rows"]:
        pieces.append("<h3>" + escape(row["title"]) + "</h3><p class=\"identity\">Plan " + escape(row["plan_id"]) + "</p>")
        pieces.append("<p>Coverage: " + escape(row["coverage_meaning"]) + ". Units: " + escape(row["weight_basis"]) + ".</p>")
        if row["delta"] is not None:
            delta = row["delta"]
            pieces.append(table(["Change", "Original catchment IDs"], [
                ["Added", ", ".join(delta["added_search_area_ids"]) or "None"],
                ["Removed", ", ".join(delta["removed_search_area_ids"]) or "None"],
                ["Retained", ", ".join(delta["retained_search_area_ids"]) or "None"]]))
        if row["cost"]:
            pieces.append("<p>Cost scope: " + escape(row["cost"]["scope"]) + ". "
                          + escape(row["cost"]["existing_station_costs"]) + ".</p>")
        if row["calendar"]:
            pieces.append("<p>Original calendar: " + show(row["calendar"]["first_date"]) + " to "
                          + show(row["calendar"]["last_date"]) + "; " + show(row["calendar"]["visits"]) + " visits.</p>")
        if row["diagnostics"] or row["warnings"]:
            pieces.append("<ul>" + "".join("<li>" + escape(v) + "</li>" for v in row["diagnostics"] + row["warnings"]) + "</ul>")
        observed = row["observed"]
        if observed:
            pieces.append("<h3>Retained observed support</h3><p class=\"identity\">Context " + escape(observed["context_id"])
                          + "<br>Source edition " + escape(observed["source_binding"]["source_collection_id"])
                          + " / " + escape(observed["source_binding"]["source_id"]) + "</p>")
            pieces.append("<p>Original source period: " + escape(json.dumps(observed["source_period"], ensure_ascii=False))
                          + ". Selected search areas contain " + str(observed["selected_search_area_source_stations"])
                          + " matched source stations, " + str(observed["selected_search_area_activities"])
                          + " original activities and " + str(observed["selected_search_area_observations"]) + " observations.</p>")
            pieces.append(table(["Source station", "Native station", "Catchment", "Activities", "Observations", "Coordinate review"],
                [[r["source_station_id"], r["network_station_id"], r["catchment_id"], r["activities"],
                  r.get("observations", 0), r["coordinate_review"]] for r in observed["selected_station_matches"]]))
            pieces.append("<ul>" + "".join("<li>" + escape(v) + "</li>" for v in observed["interpretation"]) + "</ul>")
        else:
            pieces.append("<p>Observed support: no saved context selected for this original plan.</p>")
    pieces.append("<h2>Reading this comparison</h2><ul>" + "".join("<li>" + escape(v) + "</li>" for v in record["interpretation"]) + "</ul></main></html>")
    return "\n".join(pieces) + "\n"


def export_comparison(workspace, *, comparison_id, export_root=None):
    """Stream the full original comparison, source members and editable records."""
    record = inspect(workspace, comparison_id)
    service, frontier, network, plans = _records(workspace, record["frontier_id"], retained=True)
    files = {}
    def add_json(name, value):
        add_member(files, name, bytes_member(canonical_bytes(value)))
    add_json("comparison.json", record)
    add_json("selection.json", {**record["selection"], "title": record["title"]})
    add_member(files, "report.html", bytes_member(report_html(record).encode("utf-8")))
    rows = _summary_rows(record)
    add_member(files, "comparison.csv", bytes_member(csv_text(rows, list(rows[0])).encode("utf-8")))
    add_json("native/frontier.json", frontier)
    add_json("native/network.json", network)
    for plan in plans:
        add_json("native/plans/" + plan["id"] + ".json", plan)
    for label, binding in network["source_bindings"].items():
        if binding:
            for name, member in source_export_members(workspace, label, binding):
                add_member(files, name, member)
    from .monitoring_observed_context import export_members, inspect as inspect_context
    for identity in record["selection"]["context_ids"]:
        context = inspect_context(workspace, identity)
        binding_key = digest(context["source_binding"])
        for name, member in export_members(workspace, identity, plan_id=context["plan_id"], network_id=network["id"]):
            prefix = "observed-sources/" + binding_key if name.startswith("sources/") else "contexts/" + identity
            add_member(files, prefix + "/" + name, member)
    add_member(files, "README.txt", bytes_member((
        "Saved Monitoring budget comparison\n\n"
        "Open report.html for the printable report and comparison.csv for its exact table.\n"
        "comparison.json and native/ retain the original immutable comparison, frontier, network and every plan.\n"
        "sources/ and observed-sources/ retain the exact original source editions and members.\n"
        "contexts/ retains the complete selected observed-support records, reports and tables.\n"
        "The selection.json recipe reopens these exact IDs in the original full editable Workspace.\n"
        "Use the application's complete Workspace backup/restore to receive that editable project; "
        "this source/report packet accompanies it.\n"
    ).encode("utf-8")))
    add_json("manifest.json", {
        "schema": "upstate.monitoring-frontier-comparison-export/v1",
        "comparison_id": comparison_id, "project_id": record["project_id"],
        "frontier_id": record["frontier_id"],
        "members": [{"path": name, "bytes": member["bytes"], "sha256": member["sha256"]}
                    for name, member in sorted(files.items())],
    })
    base = Path(export_root).resolve() if export_root else workspace.root.parent / (workspace.root.name + "-monitoring-exports")
    service.export_root = base
    path = base / ("monitoring-budget-comparison-" + comparison_id) / "monitoring-budget-comparison.zip"
    retain_packet(path, files)
    return service._download(path, {"format": "budget-comparison", "comparison_id": comparison_id,
                                    "frontier_id": frontier["id"], "network_id": network["id"],
                                    "files": len(files)})


def verify_workspace(workspace):
    identities = [path.stem for path in sorted((workspace.root / COLLECTION).glob("*.json"))]
    for identity in identities:
        inspect(workspace, identity)
    return {"monitoring_budget_comparisons": len(identities)}


def main():
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("preview", "prepare"):
        command = commands.add_parser(name)
        command.add_argument("--selection", type=Path, required=True)
        command.add_argument("--output", type=Path)
    command = commands.add_parser("inspect")
    command.add_argument("--id", required=True)
    command = commands.add_parser("export")
    command.add_argument("--id", required=True)
    command.add_argument("--output", type=Path)
    args = parser.parse_args()
    workspace = Workspace(args.workspace)
    if args.command in {"preview", "prepare"}:
        result = (preview if args.command == "preview" else prepare)(workspace, **load_json(args.selection))
        if args.output:
            atomic_json(args.output, result)
    elif args.command == "export":
        result = export_comparison(workspace, comparison_id=args.id, export_root=args.output)
    else:
        result = inspect(workspace, args.id)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

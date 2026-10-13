"""Join a retained economic decision edition to the original client delivery.

Uses the existing decision edition and native report. All financial and physical
quantities are taken from that completed edition; no model is launched here.
"""
from __future__ import annotations

from pathlib import Path

from .common import (atomic_json, describe_file, digest, identifier, read_json,
                     verify_file)
from .reuse import copy_verified

SCHEMA = "upstate.client-economic-link/v1"
EDITION_SCHEMA = "upstate.economic-edition/v1"
REPORT_SCHEMA = "upstate.decision-report/v1"
METRICS = (("nitrogen_export", "Nitrogen"), ("phosphorus_export", "Phosphorus"),
           ("sediment_export", "Sediment"))


def inspect_edition(workspace, edition_id):
    """Read the complete original edition and check its retained identity."""
    key = identifier(edition_id)
    root = workspace.root / "economic-editions" / key
    record_path = root / "edition.json"
    record = read_json(record_path)
    if record.get("schema") != EDITION_SCHEMA or record.get("id") != key:
        raise ValueError("Choose an original completed Economic desk edition")
    if digest({"input": record["input"], "implementation": record["implementation"]}) != key:
        raise ValueError("The economic edition differs from its retained input or implementation")
    files = record["files"]
    for descriptor in files.values():
        verify_file(root, descriptor)
    manifest = read_json(verify_file(root, files["manifest"]))
    if (manifest.get("schema") != "upstate.decision-delivery/v1"
            or manifest.get("report_id") != record["report_id"]):
        raise ValueError("Economic package manifest belongs to another report")
    members = manifest.get("members")
    if not isinstance(members, list):
        raise ValueError("Retain the complete economic edition member manifest")
    by_path = {item["path"]: item for item in members}
    if len(by_path) != len(members):
        raise ValueError("Economic package repeats a member path")
    required = {"index.html", "report.json", "selection.json", "physical-input.json",
                "source-inputs/scenario-report.json", "application/decision_desk.html"}
    if not required <= set(by_path):
        raise ValueError("Retain the original economic report and its source companions")
    for descriptor in members:
        verify_file(root, descriptor)
    for name in ("report", "selection"):
        expected_path = name + ".json"
        descriptor = files[name]
        if (descriptor["path"] != expected_path or any(
                descriptor[field] != by_path[expected_path][field]
                for field in ("bytes", "sha256"))):
            raise ValueError("Economic record and member manifest differ: " + name)
    report = read_json(root / "report.json")
    chosen = read_json(root / "selection.json")
    physical = read_json(root / "physical-input.json")
    native = read_json(root / "source-inputs" / "scenario-report.json")
    native_descriptor = by_path["source-inputs/scenario-report.json"]
    original_input = record["input"]
    if (report.get("schema") != REPORT_SCHEMA
            or report.get("id") != record["report_id"]
            or report.get("selection") != original_input["selection"]
            or chosen != original_input["selection"]
            or digest({"packet": physical, "selection": chosen}) != report["id"]):
        raise ValueError("Economic report differs from its retained physical input or selection")
    if report.get("project", {}).get("id") != workspace.project["id"]:
        raise ValueError("Use the economic edition from this original project")
    if physical.get("project") != report["project"] or native.get("project") != report["project"]:
        raise ValueError("Economic and native reports have different original project identities")
    source = report.get("physical_source") or {}
    if (source.get("schema") != "upstate.scenario-decisions/v1"
            or source.get("id") != original_input["report_id"]
            or native.get("id") != original_input["report_id"]
            or source.get("selection") != native.get("selection")
            or source.get("source", {}).get("sha256") != original_input["report_sha256"]
            or native_descriptor["sha256"] != original_input["report_sha256"]
            or physical.get("physical_source") != source):
        raise ValueError("The economic edition names another original native report")
    zone = source.get("zone") or {}
    if (zone.get("id") != original_input["zone_id"]
            or record.get("zone_id") != original_input["zone_id"]
            or report.get("scope", {}).get("reporting_unit") != zone):
        raise ValueError("Keep the economic edition's original reporting zone")
    return root, record, manifest, report


def bind_economic(workspace, selection):
    """Bind an optional selected economic edition before delivery identity."""
    key = selection.get("economic_edition_id")
    if key is None:
        if selection.get("economic_edition_sha256") is not None:
            raise ValueError("Choose the original economic edition for this delivery")
        return None
    root, record, _, report = inspect_edition(workspace, key)
    source = report["physical_source"]
    native_ids = source["selection"]["run_ids"]
    requested = [selection["baseline_run_id"], *selection.get("scenario_run_ids", [])]
    if native_ids != requested:
        raise ValueError("Use the economic edition with this exact ordered baseline and alternatives")
    if (report["scope"]["baseline_run_id"] != requested[0]
            or report["baseline"]["run_id"] != requested[0]):
        raise ValueError("Economic report and GIS delivery have different baselines")
    baseline = workspace.inspect_run(requested[0])
    if (report["scope"]["grid_id"] != baseline["selection"]["grid_id"]
            or report["scope"]["reference_profile_id"] != baseline["selection"]["profile_id"]):
        raise ValueError("Economic report has a different native grid or parameter profile")
    if selection.get("source_report_id") not in (None, source["id"]):
        raise ValueError("Choose the economic edition for the linked watershed report")
    native_sha = source["source"]["sha256"]
    if selection.get("source_report_sha256") not in (None, native_sha):
        raise ValueError("Economic and GIS editions refer to different native report bytes")
    descriptor = describe_file(root, root / "edition.json")
    if selection.get("economic_edition_sha256") not in (None, descriptor["sha256"]):
        raise ValueError("The selected economic edition record changed; reopen the original selection")
    return {"schema": SCHEMA, "edition_id": record["id"],
            "edition_sha256": descriptor["sha256"],
            "report_id": report["id"], "report_sha256": record["files"]["report"]["sha256"],
            "project_id": workspace.project["id"],
            "source_report_id": source["id"], "source_report_sha256": native_sha,
            "zone_id": record["zone_id"], "zone_title": record["zone_title"],
            "baseline_run_id": requested[0], "scenario_run_ids": requested[1:],
            "grid_id": report["scope"]["grid_id"],
            "profile_id": report["scope"]["reference_profile_id"],
            "title": report["title"]}


def catalog(workspace, *, source_report_id=None, source_report_sha256=None,
            baseline_run_id=None, scenario_run_ids=None):
    """List retained compatible editions for the existing release selection."""
    editions, issues = [], []
    root = workspace.root / "economic-editions"
    for path in sorted(root.glob("*/edition.json")):
        try:
            record = read_json(path)
            original = record.get("input") or {}
            if source_report_id is not None and original.get("report_id") != source_report_id:
                continue
            if source_report_sha256 is not None and original.get("report_sha256") != source_report_sha256:
                continue
            _, record, _, report = inspect_edition(workspace, path.parent.name)
            cohort = report["physical_source"]["selection"]["run_ids"]
            if baseline_run_id is not None and cohort[0] != baseline_run_id:
                continue
            if scenario_run_ids is not None and cohort[1:] != scenario_run_ids:
                continue
            editions.append({"id": record["id"], "title": record["title"],
                "zone_id": record["zone_id"], "zone_title": record["zone_title"],
                "created_at": record["created_at"],
                "costed_count": record["costed_count"],
                "candidate_count": record["candidate_count"],
                "budget": report["assessment"]["budget"],
                "targets": report["assessment"]["targets"],
                "report_id": report["id"],
                "edition_sha256": describe_file(path.parent, path)["sha256"]})
        except (ValueError, OSError, KeyError, TypeError) as error:
            issues.append({"edition_id": path.parent.name, "message": str(error)})
    editions.sort(key=lambda row: (row["created_at"], row["id"]), reverse=True)
    return {"editions": editions, "issues": issues}


def retain_economic(workspace, directory, state, binding):
    """Keep the original standalone desk and all source files in the GIS package."""
    if binding is None:
        return None
    root, record, manifest, report = inspect_edition(workspace, binding["edition_id"])
    actual = describe_file(root, root / "edition.json")
    if actual["sha256"] != binding["edition_sha256"]:
        raise ValueError("Selected economic edition changed before report packaging")
    if record["files"]["report"]["sha256"] != binding["report_sha256"]:
        raise ValueError("Selected economic report changed before report packaging")
    prefix = "economics/" + binding["edition_id"] + "/"
    descriptors = {item["path"]: item for item in manifest["members"]}
    for item in record["files"].values():
        existing = descriptors.get(item["path"])
        if existing is not None and any(existing[k] != item[k] for k in ("bytes", "sha256")):
            raise ValueError("Economic file descriptor differs from its complete member manifest")
        descriptors[item["path"]] = item
    descriptors["edition.json"] = actual
    files, copied_files = state.setdefault("files", {}), {}
    for name, descriptor in sorted(descriptors.items()):
        copied = copy_verified(root, descriptor, directory, path=prefix + name)
        key = "economic_member_" + digest(name)
        previous = files.get(key)
        if previous is not None and any(previous[field] != copied[field] for field in ("bytes", "sha256")):
            raise ValueError("Retained economic delivery member differs: " + name)
        files[key] = copied
        copied_files[name] = copied
    links = [
        {"title": "Open the complete decision desk", "path": prefix + "index.html"},
        {"title": "Download the complete economic edition", "path": prefix + record["files"]["complete_package"]["path"]},
        {"title": "Original economic inputs", "path": prefix + "selection.json"},
        {"title": "Original economic report", "path": prefix + "report.json"},
        {"title": "Original native watershed report", "path": prefix + "source-inputs/scenario-report.json"},
    ]
    value = {"binding": binding, "report": report, "links": links,
             "files": copied_files, "original_edition": record}
    state["economic_decision"] = value
    link_path = Path(directory) / "economic-decision.json"
    atomic_json(link_path, binding, immutable=True)
    files["economic_link"] = describe_file(directory, link_path,
                                           title="Selected economic decision edition")
    return value


def report_sections(value, *, number, text):
    """Create ordinary client-report sections from the completed decision report."""
    if value is None:
        return [], []
    report, binding = value["report"], value["binding"]
    alternatives = report["alternatives"]
    selection = report["selection"]
    supplied = {row["run_id"]: row for row in selection.get("costs", [])}

    def table(columns, rows, caption=None):
        return {"columns": columns, "rows": rows, "caption": caption}

    def section(key, title, paragraphs, tables):
        return {"id": key, "title": title, "paragraphs": paragraphs, "tables": tables}

    def label(item):
        return str(item.get("label") or item["run_id"])

    def status(value):
        return {"not_set": "Not selected", "unknown_cost": "Cost required for budget",
                "over_budget": "Over budget", "within_budget": "Within budget",
                "unavailable": "Selected output unavailable", "unsupported": "Shared support required",
                "unmet": "Target unmet", "met": "Target met"}.get(value, text(value))

    physical, costs, assumptions, footprints, outcomes, unit_costs = [], [], [], [], [], []
    for item in alternatives:
        name = label(item)
        for metric, metric_label in METRICS:
            output = item["outputs"].get(metric)
            if output is None:
                continue
            support = output["support"]
            physical.append([name, metric_label, number(output["baseline"]),
                number(output["alternative"]), number(output["reduction"]), output["units"],
                number(support.get("area_ha"))])
            economic = item.get("economics", {}).get(metric, {})
            if economic.get("annualized_cost_per_unit") is not None:
                unit_costs.append([name, metric_label,
                    number(economic["annualized_cost_per_unit"]), text(economic.get("units"))])
        cost = item.get("cost")
        if cost is None:
            costs.append([name, "Unentered", "", "", "", ""])
        else:
            costs.append([name, cost["currency"], number(cost["capital"]),
                number(cost["annual_operating"]), number(cost["present_value"]),
                number(cost["annualized"])])
            assumptions.append([name, number(cost["horizon_years"]),
                number(100 * cost["discount_rate"]) + "%"])
            original = supplied[item["run_id"]]
            scope = original.get("scope") or {}
            scope_title = {"whole_scenario": "Complete modeled scenario",
                           "reporting_zone": "Selected reporting zone",
                           "retained": "Original retained footprint"}.get(scope.get("kind"), "Original estimate")
            source = original.get("source") or cost["source"]
            zone_title = (scope.get("zone_title") or scope.get("zone_id") or
                          ("Complete scenario" if scope.get("kind") == "whole_scenario" else None))
            footprints.extend([
                [name, "Implementation footprint", scope_title + "; " + text(zone_title)],
                [name, "Estimate source", text(source.get("title"))],
                [name, "Original reference", text(source.get("uri"))],
                [name, "As of", text(source.get("as_of"))],
                [name, "Scope note", text(original.get("scope_note") or original.get("note") or cost.get("note"))],
            ])
        decision = item["decision"]
        basis = ("Physical response and annualized cost" if decision.get("pareto_basis") ==
                 "annualized_cost_and_selected_exports" else "Physical response")
        frontier = ("On frontier" if decision.get("pareto") is True else
                    "Dominated" if decision.get("pareto") is False else "Shared support required")
        outcomes.append([name, status(decision["budget_status"]), status(decision["target_status"]),
                         "Eligible" if decision["eligible"] else "Review criteria",
                         frontier + " / " + basis, "; ".join(decision.get("reasons", []))])

    assessment = report["assessment"]
    criteria = []
    for metric, label_text in METRICS:
        if metric in assessment["targets"]:
            criteria.append([label_text + " avoided-export target",
                             number(assessment["targets"][metric]), report["scope"]["units"].get(metric, "Unmodeled output")])
    budget = assessment.get("budget")
    if budget:
        for key, label_text in (("capital_limit", "Capital budget"), ("annualized_limit", "Annualized budget")):
            if key in budget:
                criteria.append([label_text, number(budget[key]),
                                 budget["currency"] + ("/year" if key == "annualized_limit" else "")])
    for key, label_text in (("zone_title", "Selected reporting zone"), ("zone_id", "Original zone ID"),
                           ("source_report_id", "Original watershed report"),
                           ("edition_id", "Economic decision edition")):
        criteria.append([label_text, binding[key], ""])
    first = section("economic-decision", "Implementation choices and selected-zone economics", [
        "This section uses the completed economic decision edition for " + binding["zone_title"] +
        ". Its quantities describe this original reporting zone and the selected native cohort.",
        "Each candidate remains one complete modeled land-cover scenario. Avoided export is baseline minus alternative on the edition's retained common support. A negative value remains an increase in modeled export.",
        "The chosen budget and physical targets screen the complete alternatives. The frontier compares separate physical responses and includes annualized cost only where the compared costs share a known currency."
    ], [table(["Criterion", "Selected value", "Units"], criteria),
        table(["Alternative", "Budget", "Targets", "Criteria", "Frontier basis", "Review reason"], outcomes)])
    physical_section = section("economic-response", "Physical response for the selected economic zone", [
        "These already aggregated annual masses are copied from the original decision edition. Their common-support area accompanies each pollutant; they receive no second cell-area conversion."
    ], [table(["Alternative", "Pollutant", "Baseline", "Alternative", "Avoided export", "Units", "Common area (ha)"], physical)])
    cost_section = section("implementation-costs", "Implementation costs and original estimate footprint", [
        "Capital and annual operating estimates, horizon and discount rate retain their original source. Present value and annualized cost are the completed edition's calculated values. Unentered estimates stay unentered.",
        "Read each cost with its original implementation footprint below. A whole-scenario estimate and a reporting-zone estimate retain their different extents."
    ], [table(["Alternative", "Currency", "Capital", "Annual operations", "Present value", "Annualized/year"], costs)])
    if assumptions:
        cost_section["tables"].append(table(["Alternative", "Cost horizon (years)", "Annual discount rate"], assumptions))
    if footprints:
        cost_section["tables"].append(table(["Alternative", "Estimate attribute", "Original value"], footprints))
    if unit_costs:
        cost_section["tables"].append(table(["Alternative", "Pollutant", "Annualized cost per avoided mass", "Units"], unit_costs,
            "Only positive avoided export on retained shared support has a unit-cost value."))
    if report.get("notes"):
        cost_section["paragraphs"].extend(str(note) for note in report["notes"])
    unavailable = report.get("unavailable_alternatives") or []
    if unavailable:
        first["tables"].append(table(["Retained alternative", "Source reason"],
            [[text(row.get("run_id")), text(row.get("reason"))] for row in unavailable]))
    return [first, physical_section, cost_section], value["links"]


MAP_GUIDE = (
    ("future_sediment_loss", "Future sediment loss",
     "Select land where a defined development or disturbance alternative increases sediment delivery.",
     "Read the signed change against the saved baseline. Positive values identify greater modeled delivery under that alternative; the scenario name and shared valid area identify the comparison."),
    ("future_nutrient_runoff", "Future nutrient runoff",
     "Select land where an explicit land-cover change increases nitrogen or phosphorus delivery.",
     "Read nitrogen and phosphorus separately with their annual mass units. Use the retained change polygons and replacement land-cover classes to explain the cause of each modeled difference."),
    ("critical_drinking_water", "Critical drinking-water protection",
     "Review land protection and restoration opportunities in relation to the retained source-water geography.",
     "Combine the selected utility/source-water overlay with physical exports and the relevant alternatives. This connects an upstream land decision to the source-water area that it influences."),
    ("high_quality_waters", "High-quality water resources",
     "Review land influencing waters identified by the selected high-quality-water designation source.",
     "Read the original designation, mapped water feature and selected spatial relationship together. The designation source and any analysis buffer appear in the methods and source records."),
    ("current_nutrient_export", "Current nutrient exports",
     "Locate existing nitrogen and phosphorus delivery hotspots for restoration review.",
     "Each physical raster represents modeled annual export for the selected current land cover. Larger values identify more modeled annual mass delivered from a valid cell on the original model grid."),
    ("current_sediment_export", "Current sediment export",
     "Locate existing sediment-delivery hotspots for erosion and land-management review.",
     "Read the annual metric tonnes per pixel alongside the retained terrain, rainfall, soil and land-cover assumptions. The delivered reporting totals are summarized in this report."),
    ("combined_pollutant_export", "Combined pollutant priority",
     "Compare locations under the saved multi-pollutant planning priorities.",
     "The combined layer is a dimensionless planning index. Read its normalization and weights with the separate nitrogen, phosphorus and sediment layers when explaining why an area ranks highly."),
)

CLIENT_REPORT_EDITION = "2026-10-13-client-economics-3"


def scientific_sections(value, state):
    """Join the existing scientific tuple/table formatter without replacing it."""
    from . import scientific_report

    authored, links = report_sections(
        value, number=scientific_report._number, text=scientific_report._plain)
    sections = []
    for section in authored:
        blocks = list(section["paragraphs"])
        for table in section["tables"]:
            columns = [
                {"Annual operations": "Annual operations (currency/year)",
                 "Annualized/year": "Annualized cost (currency/year)",
                 "Annual discount rate": "Real annual discount rate"}.get(column, column)
                for column in table["columns"]
            ]
            rows = []
            for original_row in table["rows"]:
                row = list(original_row)
                if len(row) == 3 and row[1] == "Original reference":
                    target = row[2]
                    linked = scientific_report.link("Open original estimate", target)
                    row[2] = linked if isinstance(linked, dict) else target
                rows.append(row)
            widths = ([1.0, 1.0, 2.3] if columns == ["Alternative", "Estimate attribute", "Original value"]
                      else None)
            blocks.append(scientific_report._table(
                columns, rows, widths=widths, caption=table.get("caption")))
        sections.append((section["title"], blocks))

    map_rows, map_links = [], []
    for family, title, decision, reading in MAP_GUIDE:
        paths = []
        for key, descriptor in state.get("maps", {}).items():
            if key == family or key.startswith(family + "-"):
                if isinstance(descriptor, str):
                    descriptor = state.get("files", {}).get(descriptor, {"path": descriptor})
                path = descriptor.get("path")
                if path and path not in paths:
                    paths.append(path)
                    map_links.append({"title": title + " / " + key, "path": path})
        map_rows.append([title, decision, reading, "; ".join(paths) or "Unavailable"])
    sections.append(("Seven-map decision guide", [
        "The current-export maps show physical annual quantities on the original grid. Future maps retain each complete selected alternative. The combined planning map uses the saved normalization and weights.",
        scientific_report._table(
            ["Map family", "Decision", "Reading", "Original files"], map_rows,
            widths=[.9, 1.2, 1.7, 1.2]),
    ]))
    if links:
        sections.append(("Open the original economic edition", [{"kind": "links", "items": links}]))
    if map_links:
        sections.append(("Open the publication maps", [{"kind": "links", "items": map_links}]))
    return sections

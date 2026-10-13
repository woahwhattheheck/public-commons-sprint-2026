"""Complete editable utility/community reports from retained source and plan."""
from __future__ import annotations

import csv
from decimal import Decimal
from html import escape
import io
import json
from pathlib import Path
import re
import zipfile

from .common import atomic_bytes, canonical, describe_file, digest, held, verify_file
from .communities import (PLAN_KIND, TABLE_KIND, REPORT_KIND, PHYSICAL_NAMES,
                          get_plan, get_table, text, verify_plan_context, INTERVENTION_FIELDS)

FORMAT_VERSION = 7

SCIENTIFIC_SCOPE_NOTES = (
    "Community summaries describe the selected whole source block groups. "
    "Native model totals retain each run's original reporting-area valid cells; "
    "the community and intervention selections do not clip or allocate those totals.",
    "Alternative-minus-baseline changes use only the original comparison raster's "
    "common valid cells. That support can differ from either run's total support, "
    "so subtracting the separately reported full-run totals can give another value.",
    "A negative signed change means lower modeled export on the common support; "
    "a positive change means higher modeled export. A parameter-profile change "
    "is retained as a sensitivity comparison.",
    "Valid-cell counts and cell areas are retained from the original raster records. "
    "Missing coverage metadata remains unspecified. These model results provide "
    "scientific context alongside the selected communities.",
)


def _cell(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, bool):
        return "true" if value else "false"
    value = str(value)
    if (value.lstrip().startswith(("=", "+", "@"))
            or value.lstrip().startswith("-") and not re.fullmatch(r"-\d+(?:\.\d+)?", value.strip())):
        return "'" + value
    return value


def csv_text(columns, rows):
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([_cell(row.get(key)) for key in columns])
    return out.getvalue()


def _number(value, suffix=""):
    if value is None:
        return "Unspecified"
    if isinstance(value, int):
        return format(value, ",") + suffix
    return str(value) + suffix


def _table(headings, rows):
    return ("<div class=\"table-wrap\"><table><thead><tr>"
            + "".join("<th scope=\"col\">" + escape(str(x)) + "</th>" for x in headings)
            + "</tr></thead><tbody>"
            + "".join("<tr>" + "".join("<td>" + escape(str(x)) + "</td>" for x in row) + "</tr>"
                      for row in rows)
            + "</tbody></table></div>")


def _md_table(headings, rows):
    def cell(value):
        return str(value).replace("|", r"\|").replace("\n", " ").replace("<", "&lt;").replace(">", "&gt;")
    return "\n".join(["| " + " | ".join(map(cell, headings)) + " |",
                      "| " + " | ".join("---" for _ in headings) + " |"]
                     + ["| " + " | ".join(map(cell, row)) + " |" for row in rows])


def _community_rows(plan):
    return [{
        "geoid": group["geoid"],
        "utility_ids": ";".join(sorted({x["utility_id"] for x in group["memberships"]})),
        "watershed_ids": ";".join(sorted({x["watershed_id"] for x in group["memberships"]})),
        "watershed_names": "; ".join(sorted({x["watershed_name"] for x in group["memberships"]})),
        "population": group["population"], "households": group["households"],
        "median_household_income": group["median_household_income"],
        "below_state_median_income": group["below_state_median_income"],
        "households_below_poverty": group["households_below_poverty"],
        "reported_poverty_percent": group["reported_poverty_percent"],
        "calculated_poverty_percent": group["calculated_poverty_percent"],
        "source_notes": group["source_notes"],
    } for group in plan["selected_groups"]]


def _intervention_rows(plan):
    rows = []
    for item in plan["interventions"]:
        row = dict(item)
        row["geoids"] = ";".join(item["geoids"])
        row["population_context"] = item["community_context"]["population_total"]
        row["household_context"] = item["community_context"]["households_total"]
        rows.append(row)
    return rows


def _physical_rows(plan):
    rows = []
    context = plan["context"]
    differences = {}
    for comparison in context["snapshots"].get("comparisons", []):
        for alternative in comparison.get("alternatives", []):
            if alternative.get("run_id") not in context["scenario_run_ids"]:
                continue
            for pollutant, artifact in alternative.get("artifacts", {}).items():
                key = (alternative["run_id"], pollutant)
                candidate = {"comparison_id": comparison["id"], "artifact": artifact,
                             "profile_changed": alternative.get("profile_changed", False)}
                if key in differences and differences[key]["artifact"] != artifact:
                    left = differences[key]["artifact"]
                    comparable = ("sum_change", "valid_cells", "units")
                    if any(left.get(name) != artifact.get(name) for name in comparable):
                        raise ValueError("Retained native comparisons disagree for a selected run/pollutant")
                differences.setdefault(key, candidate)
    for row in context["physical_totals"]:
        value = dict(row)
        artifact = row.get("artifact") or {}
        value["run_valid_cells"] = artifact.get("valid_cells")
        value["pixel_area_ha"] = artifact.get("pixel_area_ha")
        original = differences.get((row["run_id"], row["pollutant"]))
        if original:
            difference_unit = str(original["artifact"].get("units") or "").replace("/pixel", "")
            if not difference_unit or difference_unit != row["unit"]:
                raise ValueError("Original comparison and run total use different physical units")
        value["alternative_minus_baseline"] = (
            original["artifact"].get("sum_change") if original else None)
        value["comparison_kind"] = (
            "parameter sensitivity" if original and original["profile_changed"]
            else "land-cover alternative" if original else "original run total")
        value["comparison_id"] = original["comparison_id"] if original else None
        value["comparison_valid_cells"] = original["artifact"].get("valid_cells") if original else None
        value["comparison_spatial_basis"] = (
            "The original native difference raster's common valid cells" if original else None)
        rows.append(value)
    return rows

WATERSHED_SCOPE_NOTES = (
    "Watershed areas are the original NRCS huc12_ac values, counted once per HUC12. "
    "State areas retain each original st_ac value and its FY26 designation; published rounding "
    "differences between whole-HUC and state totals remain visible.",
    "Ground, Surface and Both are the original NRCS programme labels on state-HUC records. "
    "Use the separate state rows when planning work across a state boundary.",
    "Class counts are matches for the named South Carolina target classes under the publisher's "
    "HUC12 assignment. A complete query with zero matches describes those target classes. "
    "Use water-quality assessment sources for condition and impairment decisions.",
    "Whole-watershed planning units and whole census block groups keep their respective source "
    "boundaries. The selected regional source accompanies the intervention work programme.",
)


def _regional_rows(plan):
    context = plan["context"]["snapshots"].get("watershed_context")
    rows, states = [], []
    if context is None:
        return None, rows, states
    utilities = {}
    for group in plan["selected_groups"]:
        for member in group["memberships"]:
            utilities.setdefault(member["watershed_id"], set()).add(member["utility_id"])
    for original in context["hucs"]:
        huc12 = original["huc12"]
        shared = {"regional_report_id": context["report_id"], "huc12": huc12,
                  "watershed_name": original["name"],
                  "utility_ids": ";".join(sorted(utilities.get(huc12, set())))}
        rows.append({
            **shared, **{key: original.get(key) for key in (
                "area_acres", "area_km2", "state_portion_acres",
                "state_area_minus_huc_area_acres", "states", "priority",
                "priority_states", "priority_statuses", "priority_state_portion_acres",
                "system_types", "resource_concerns", "nrcs_edition",
                "selected_classification_count", "class_counts",
                "classification_assignment", "classification_coverage",
                "classification_query_coverage", "classification_scope",
            )},
        })
        for state in original.get("nrcs_state_rows", []):
            states.append({**shared, "nrcs_edition": original.get("nrcs_edition"), **state})
    return context, rows, states


def _area(value):
    return "Unspecified" if value is None else format(Decimal(str(value)), ",.2f")


def _plan_revision(workspace, plan):
    """Compare the saved plan with its actual immutable parent edition."""
    previous_id = plan.get("previous_plan_id")
    if not previous_id:
        return None, None
    previous = get_plan(workspace, previous_id)
    if (previous["table_id"] != plan["table_id"] or previous["source"] != plan["source"]
            or plan["revision_number"] != previous["revision_number"] + 1):
        raise ValueError("The plan revision must retain its original table and immediate parent")
    left = {row["id"]: row for row in previous["interventions"]}
    right = {row["id"]: row for row in plan["interventions"]}
    fields = ("position",) + tuple(field for field in INTERVENTION_FIELDS if field != "id")
    changes, changed_ids = [], set()
    for item in plan["interventions"]:
        key = item["id"]
        if key not in left:
            changes.append({"change": "added", "intervention_id": key, "title": item["title"],
                            "field": "intervention", "before": None, "after": item})
            continue
        for field in fields:
            before, after = left[key].get(field), item.get(field)
            if before != after:
                changes.append({"change": "changed", "intervention_id": key, "title": item["title"],
                                "field": field, "before": before, "after": after})
                changed_ids.add(key)
    for item in previous["interventions"]:
        if item["id"] not in right:
            changes.append({"change": "removed", "intervention_id": item["id"], "title": item["title"],
                            "field": "intervention", "before": item, "after": None})
    before_geoids = {row["geoid"] for row in previous["selected_groups"]}
    after_geoids = {row["geoid"] for row in plan["selected_groups"]}

    def cost_context(saved):
        cost = saved["cost_summary"]
        return {"entered_total_usd": cost["known_estimate_total"],
                "known_estimate_count": cost["known_estimate_count"],
                "unknown_estimate_count": cost["intervention_count"] - cost["known_estimate_count"]}

    before_cost, after_cost = cost_context(previous), cost_context(plan)
    context_fields = ("source_collection_ids", "grid_id", "baseline_run_id", "scenario_run_ids",
                      "delivery_id", "watershed_context_id")
    before_context, after_context = previous["context"], plan["context"]
    before_import = previous.get("intervention_import") or {}
    after_import = plan.get("intervention_import") or {}
    summary = {
        "schema": "upstate.community-plan-revision/v1",
        "plan_id": plan["id"], "previous_plan_id": previous["id"],
        "revision_number": plan["revision_number"],
        "previous_revision_number": previous["revision_number"],
        "table_id": plan["table_id"], "source_sha256": plan["source"]["sha256"],
        "counts": {
            "added_interventions": len(set(right) - set(left)),
            "removed_interventions": len(set(left) - set(right)),
            "changed_interventions": len(changed_ids),
            "unchanged_interventions": len((set(left) & set(right)) - changed_ids),
            "changed_fields": sum(row["change"] == "changed" for row in changes),
        },
        "changes": changes,
        "plan_changes": [
            {"field": field, "before": previous.get(field), "after": plan.get(field)}
            for field in ("title", "purpose", "notes") if previous.get(field) != plan.get(field)],
        "selection": {
            "before": previous["selection"], "after": plan["selection"],
            "added_geoids": sorted(after_geoids - before_geoids),
            "removed_geoids": sorted(before_geoids - after_geoids),
            "before_summary": previous["summaries"]["all"], "after_summary": plan["summaries"]["all"],
            "basis": "Selected whole source block groups; changes describe membership, not population trends.",
        },
        "costs": {
            "currency": "USD", "before": before_cost, "after": after_cost,
            "entered_estimate_difference_usd": format(
                Decimal(after_cost["entered_total_usd"]) - Decimal(before_cost["entered_total_usd"]), ".2f"),
            "basis": "Change in entered planning estimates only. Unknown estimates remain unspecified; "
                     "this difference does not estimate programme savings or environmental benefit.",
        },
        "scientific_context": {
            "before_snapshot_sha256": before_context["snapshot_sha256"],
            "after_snapshot_sha256": after_context["snapshot_sha256"],
            "snapshot_changed": before_context["snapshot_sha256"] != after_context["snapshot_sha256"],
            "identifier_changes": [
                {"field": field, "before": before_context.get(field), "after": after_context.get(field)}
                for field in context_fields if before_context.get(field) != after_context.get(field)],
        },
        "received_csv": {
            "before_sha256": before_import.get("source", {}).get("sha256"),
            "after_sha256": after_import.get("source", {}).get("sha256"),
            "before_import_plan_id": before_import.get("previous_plan_id"),
            "after_import_plan_id": after_import.get("previous_plan_id"),
        },
    }
    return summary, previous


def _revision_value(value):
    if value is None:
        return "Unspecified"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    return str(value)


def _contents(plan, table, title, revision=None, previous_plan=None):
    aggregate = plan["summaries"]["all"]
    communities = _community_rows(plan)
    interventions = _intervention_rows(plan)
    physical = _physical_rows(plan)
    regional, regional_rows, regional_states = _regional_rows(plan)
    utility_metadata = {row["id"]: row for row in plan["metadata"]["utilities"]}
    utility_rows = []
    for row in plan["summaries"]["utilities"]:
        source = utility_metadata[row["scope_id"]]
        utility_rows.append({**row, "approximate_service_population": source["approximate_service_population"],
                             "service_population_basis": source["service_population_basis"],
                             "service_population_source": source["source_reference"]})
    summary_columns = ["scope_id", "label", "geoid_count", "population_total", "households_total",
                       "poverty_households_total", "household_poverty_percent", "below_state_median_count",
                       "income_known_groups", "median_income_min", "median_income_max",
                       "shared_membership_groups"]
    community_columns = ["geoid", "utility_ids", "watershed_ids", "watershed_names", "population",
                         "households", "median_household_income", "below_state_median_income",
                         "households_below_poverty", "reported_poverty_percent",
                         "calculated_poverty_percent", "source_notes"]
    intervention_columns = ["position", "id", "title", "priority", "strategy", "status", "utility_id",
                            "watershed_id", "geoids", "population_context", "household_context",
                            "reason", "owner", "next_step", "cost_estimate_usd", "notes"]
    physical_columns = ["run_id", "run_state", "pollutant", "value", "unit", "alternative_minus_baseline",
                        "comparison_kind", "comparison_id", "comparison_valid_cells", "comparison_spatial_basis",
                        "grid_id", "profile_id", "scenario_id", "spatial_basis",
                        "run_valid_cells", "pixel_area_ha"]
    payload = {"schema": "upstate.community-report/v1", "title": title,
               "project_basis": "Saved utility/community plan in the original Upper Savannah workspace",
               "plan": plan, "original_table": table, "communities": communities,
               "utility_summaries": utility_rows, "watershed_summaries": plan["summaries"]["watersheds"],
               "interventions": interventions, "physical_context": physical,
               "regional_watershed_context": regional,
               "plan_revision": revision,
               "watershed_scope_notes": list(WATERSHED_SCOPE_NOTES) if regional else [],
               "scientific_scope_notes": list(SCIENTIFIC_SCOPE_NOTES) if physical else [],
               "csv_text_handling": "Formula-like free text is prefixed with an apostrophe in derived CSV; JSON preserves original text."}
    summary_headings = ["Utility", "Block groups", "Block-group population", "Households",
                        "Households below poverty", "Below state income", "Approx. utility service population"]
    summary_display = [[row["label"], row["geoid_count"], _number(row["population_total"]),
                        _number(row["households_total"]), _number(row["poverty_households_total"]),
                        str(row["below_state_median_count"]) + " / " + str(row["income_known_groups"]),
                        _number(row["approximate_service_population"])] for row in utility_rows]
    group_headings = ["Block group", "Utility / watershed", "Population", "Households",
                      "Median income", "Poverty households", "Printed poverty %"]
    group_display = [[row["geoid"], row["utility_ids"] + " / " + row["watershed_names"],
                      _number(row["population"]), _number(row["households"]),
                      _number(row["median_household_income"]), _number(row["households_below_poverty"]),
                      _number(row["reported_poverty_percent"])] for row in communities]
    watershed_headings = ["HUC12 / watershed", "Block groups", "Population", "Households",
                          "Households below poverty", "Poverty %", "Below state income"]
    watershed_display = [[row["scope_id"] + " / " + row["label"], row["geoid_count"],
                          _number(row["population_total"]), _number(row["households_total"]),
                          _number(row["poverty_households_total"]), _number(row["household_poverty_percent"]),
                          str(row["below_state_median_count"]) + " / " + str(row["income_known_groups"])]
                         for row in plan["summaries"]["watersheds"]]
    intervention_headings = ["Order", "Intervention", "Priority / status", "Utility / HUC12",
                             "Strategy", "Estimate USD", "Owner / reason / next step"]
    intervention_display = [[row["position"], row["title"], row["priority"] + " / " + row["status"],
                            row["utility_id"] + " / " + row["watershed_id"], row["strategy"],
                            _number(row["cost_estimate_usd"]),
                            (row["owner"] or "Unassigned") + "\n" + row["reason"] + "\n" + row["next_step"]]
                           for row in interventions]
    physical_headings = ["Run", "State", "Pollutant", "Reporting-area total", "Unit",
                         "Run valid cells", "Cell area (ha)"]
    physical_display = [[row["run_id"], row["run_state"], row["pollutant"], _number(row["value"]),
                         row["unit"] or "Unspecified", _number(row["run_valid_cells"]),
                         _number(row["pixel_area_ha"])] for row in physical]
    change_headings = ["Alternative run", "Pollutant", "Alternative − baseline",
                       "Unit", "Common valid cells", "Comparison"]
    change_display = [[row["run_id"], row["pollutant"],
                       _number(row["alternative_minus_baseline"]), row["unit"] or "Unspecified",
                       _number(row["comparison_valid_cells"]), row["comparison_kind"]]
                      for row in physical if row["comparison_id"]]
    intro = (
        str(aggregate["geoid_count"]) + " selected whole census block groups; "
        + _number(aggregate["population_total"]) + " people; "
        + _number(aggregate["households_total"]) + " households; "
        + _number(aggregate["poverty_households_total"]) + " households below poverty. "
        + str(aggregate["below_state_median_count"]) + " of "
        + str(aggregate["income_known_groups"]) + " known block-group medians fall below the source's "
        + _number(plan["metadata"]["income_reference"]["threshold"]) + " "
        + plan["metadata"]["income_reference"]["currency"] + " reference."
    )
    sections = [
        ("Utility and community context", summary_headings, summary_display),
        ("Watershed context", watershed_headings, watershed_display),
        ("Original community rows", group_headings, group_display),
        ("Selected interventions", intervention_headings, intervention_display),
        ("Original run exports on their reporting areas", physical_headings, physical_display),
        ("Native changes on common valid cells", change_headings, change_display),
    ]
    if regional:
        regional_heads = ["Utility / HUC12", "Watershed", "Whole-HUC acres",
                          "State-portion acres", "NRCS edition / priority states",
                          "Selected SC class records", "Query coverage / jurisdiction"]
        regional_display = [
            [row["utility_ids"] + " / " + row["huc12"], row["watershed_name"],
             _area(row["area_acres"]), _area(row["state_portion_acres"]),
             str(row["nrcs_edition"] or "Unspecified") + " / " + (
                 ", ".join(row["priority_states"] or []) or "; ".join(row["priority_statuses"] or []) or "Unspecified"),
             _number(row["selected_classification_count"]),
             str(row["classification_query_coverage"] or "Unspecified").replace("_", " ")
             + " / " + str(row["classification_scope"] or "Unspecified").replace("_", " ")]
            for row in regional_rows]
        state_heads = ["HUC12", "State", "State acres", "NRCS edition / designation",
                       "Programme type", "Resource concern"]
        state_display = [
            [row["huc12"], row["st_usps"], _area(row.get("st_ac")),
             str(row.get("nrcs_edition") or "Unspecified") + " / " + (row.get("fy26_status") or "Unspecified"),
             row.get("system_type") or "Unspecified",
             row.get("resource_concern") or "Unspecified"]
            for row in regional_states]
        sections[2:2] = [
            ("Watershed planning evidence", regional_heads, regional_display),
            ("NRCS state portions", state_heads, state_display),
        ]
    if revision:
        revision_rows = [
            [row["change"], row["intervention_id"] + " / " + row["title"], row["field"],
             _revision_value(row["before"]), _revision_value(row["after"])]
            for row in revision["changes"]]
        sections.insert(0, ("Saved plan changes",
                           ["Change", "Intervention", "Field", "Previous saved value", "Current saved value"],
                           revision_rows))
        plan_changes = revision["plan_changes"] + revision["scientific_context"]["identifier_changes"]
        if plan_changes:
            sections.insert(1, ("Plan and scientific selection changes",
                               ["Field", "Previous saved value", "Current saved value"],
                               [[row["field"], _revision_value(row["before"]), _revision_value(row["after"])]
                                for row in plan_changes]))
        before_summary, after_summary = (revision["selection"][key]
                                         for key in ("before_summary", "after_summary"))
        before_cost, after_cost = (revision["costs"][key] for key in ("before", "after"))
        sections.insert(2, ("Revision selection and entered estimates",
                            ["Recorded measure", "Previous edition", "Current edition"],
                            [
                                ["Utility filters", _revision_value(revision["selection"]["before"]["utility_ids"]),
                                 _revision_value(revision["selection"]["after"]["utility_ids"])],
                                ["Watershed filters", _revision_value(revision["selection"]["before"]["watershed_ids"]),
                                 _revision_value(revision["selection"]["after"]["watershed_ids"])],
                                ["Selected whole block-group GEOIDs", _revision_value(before_summary["geoids"]),
                                 _revision_value(after_summary["geoids"])],
                                ["Whole block groups", before_summary["geoid_count"], after_summary["geoid_count"]],
                                ["Whole-block-group population", _number(before_summary["population_total"]),
                                 _number(after_summary["population_total"])],
                                ["Whole-block-group households", _number(before_summary["households_total"]),
                                 _number(after_summary["households_total"])],
                                ["Entered planning estimates (USD)", before_cost["entered_total_usd"],
                                 after_cost["entered_total_usd"]],
                                ["Interventions with estimates", before_cost["known_estimate_count"],
                                 after_cost["known_estimate_count"]],
                                ["Interventions with unspecified estimates", before_cost["unknown_estimate_count"],
                                 after_cost["unknown_estimate_count"]],
                            ]))
    imported = plan.get("intervention_import")
    if imported:
        import_summary = imported["summary"]
        sections.insert(3, (
            "Received intervention programme",
            ["Original edited CSV", "Rows", "Added", "Changed", "Removed"],
            [[imported["source"]["filename"], import_summary["row_count"],
              len(import_summary["added_ids"]), len(import_summary["changed_ids"]), len(import_summary["removed_ids"])]],
        ))
    if imported and imported.get("field_provenance"):
        meanings = {"original-column": "Original received value; native field validation",
                    "generated-source-row-id": "Stable identifier from original file SHA256 and row",
                    "native-default": "Original native default; blank cost remains unspecified"}
        sections.insert(4, (
            "Original intervention field mapping",
            ["Plan field", "Original CSV column", "Column number", "Interpretation"],
            [[row["field"], row["source_column"] or "Unmapped",
              row["source_column_number"] if row["source_column_number"] is not None else "",
              meanings[row["basis"]]] for row in imported["field_provenance"]],
        ))
    estimate = plan["cost_summary"]
    cost_statement = (
        str(estimate["known_estimate_count"]) + " of " + str(estimate["intervention_count"])
        + " interventions have entered planning estimates, totaling "
        + _number(estimate["known_estimate_total"]) + " USD. Unspecified costs remain open planning inputs."
        if estimate["known_estimate_count"] else "Intervention cost estimates are open planning inputs.")
    notes = plan["metadata"].get("limitations", []) + plan["notes"]
    if regional:
        notes.extend(WATERSHED_SCOPE_NOTES)
    for source_note in table.get("source_notes", []):
        label = ("Block group " + source_note["geoid"] + ": ") if source_note.get("geoid") else ""
        notes.extend(label + note for note in source_note.get("notes", []))
    source_line = (
        table["source"]["title"] + "; " + table["source"]["vintage"] + "; " + table["source"]["uri"]
        + "\nOriginal table SHA-256: " + table["source"]["sha256"]
        + "\nSaved plan: " + plan["id"] + " (revision " + str(plan["revision_number"]) + ")"
        + "\nScientific context: " + plan["context"]["snapshot_sha256"]
    )
    if regional:
        source_line += (
            "\nRegional source: " + regional["title"] + " / " + regional["report_id"]
            + "\nOriginal regional JSON SHA-256: " + regional["report_file"]["sha256"]
            + "\nSelected HUC12s: " + ", ".join(regional["selected_huc12s"]))
    html_sections = []
    markdown_sections = []
    for heading, heads, rows in sections:
        if heading == "Saved plan changes":
            counts = revision["counts"]
            explanation = (
                "Saved revision " + str(revision["previous_revision_number"]) + " to "
                + str(revision["revision_number"]) + ": "
                + str(counts["added_interventions"]) + " added, "
                + str(counts["removed_interventions"]) + " removed, "
                + str(counts["changed_interventions"]) + " changed and "
                + str(counts["unchanged_interventions"]) + " unchanged interventions. "
                + str(counts["changed_fields"]) + " individual saved fields changed. "
                + "Entered-estimate difference: " + revision["costs"]["entered_estimate_difference_usd"]
                + " USD. " + revision["costs"]["basis"] + " " + revision["selection"]["basis"]
                + " Previous plan: " + revision["previous_plan_id"] + ".")
            html_sections.append("<section><h2>Reading this saved revision</h2><p>"
                                 + escape(explanation) + "</p></section>")
            markdown_sections.append("## Reading this saved revision\n\n" + explanation)
        if heading == "Watershed planning evidence":
            coverage = regional.get("classification_coverage") or {}
            codes = ", ".join(coverage.get("selected_classes") or [])
            explanation = (
                "Selected regional context: " + str(regional["summary"]["huc_count"])
                + " whole HUC12 watersheds, "
                + _area(regional["summary"]["area_acres"]) + " acres; "
                + str(regional["summary"]["priority_huc_count"]) + " with an NRCS FY26 priority state record. "
                + ("The source query covers target classes " + codes + ". " if codes else "")
                + " ".join(WATERSHED_SCOPE_NOTES))
            html_sections.append("<section><h2>Reading the watershed evidence</h2><p>"
                                 + escape(explanation) + "</p></section>")
            markdown_sections.append("## Reading the watershed evidence\n\n" + explanation)
        if heading == "Original run exports on their reporting areas" and physical:
            scope = " ".join(SCIENTIFIC_SCOPE_NOTES)
            baseline_id = plan["context"].get("baseline_run_id")
            if baseline_id:
                scope += " Retained comparison baseline: " + baseline_id + "."
            html_sections.append("<section><h2>Scientific coverage and interpretation</h2><p>"
                                 + escape(scope) + "</p></section>")
            markdown_sections.append("## Scientific coverage and interpretation\n\n" + scope)
        body = _table(heads, rows) if rows else "<p>No selection has been entered for this section.</p>"
        html_sections.append("<section><h2>" + escape(heading) + "</h2>" + body + "</section>")
        markdown_sections.append("## " + heading + "\n\n" +
                                 (_md_table(heads, rows) if rows else "No selection has been entered for this section."))
    css = (
        ":root{font:15px/1.55 system-ui,sans-serif;color:#202020;background:#fff}"
        "body{margin:0}main{max-width:1300px;margin:auto;padding:32px}"
        "h1{font-size:30px;line-height:1.2;margin:0 0 18px}h2{font-size:21px;margin:30px 0 14px}"
        ".eyebrow{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#555}"
        ".lead{font-size:17px}.summary{border:1px solid #777;padding:18px;background:#f5f5f5}"
        ".table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}"
        "th,td{text-align:left;vertical-align:top;padding:10px;border:1px solid #bbb;overflow-wrap:anywhere}"
        "th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 monospace}"
        "section{margin-bottom:28px}li{margin:8px 0}footer{border-top:1px solid #999;margin-top:30px;padding-top:15px}"
        "@media(max-width:600px){main{padding:16px}h1{font-size:24px}}"
        "@media print{main{max-width:none;padding:0}.table-wrap{overflow:visible}thead{display:table-header-group}"
        "tr{break-inside:avoid}h2{break-after:avoid}body{font-size:10pt}th,td{padding:5px;font-size:9pt}}"
    )
    html = ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>" + escape(title) + "</title><style>" + css + "</style></head><body><main>"
            "<header><p class=\"eyebrow\">Upper Savannah · Utility and community planning</p><h1>"
            + escape(title) + "</h1><p class=\"lead\">" + escape(plan["purpose"]) + "</p>"
            "<p class=\"summary\">" + escape(intro) + "</p><p>" + escape(cost_statement) + "</p></header>"
            + "".join(html_sections)
            + "<section><h2>Reading the results</h2><ul>"
            + "".join("<li>" + escape(note) + "</li>" for note in notes) + "</ul></section>"
            + "<footer><h2>Original source and saved selection</h2><pre>" + escape(source_line)
            + "</pre><p>Editable companion files include the complete JSON, Markdown, original source table "
              "and separate community, utility, watershed, intervention and scientific-context CSVs.</p></footer>"
              "</main></body></html>\n")
    markdown = ("# " + title.replace("\n", " ").replace("<", "&lt;") + "\n\n"
                + plan["purpose"] + "\n\n" + intro + "\n\n" + cost_statement + "\n\n"
                + "\n\n".join(markdown_sections)
                + "\n\n## Reading the results\n\n" + "\n".join("- " + note for note in notes)
                + "\n\n## Original source and saved selection\n\n" + source_line + "\n")
    outputs = {
        "community-report.json": json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True,
                                             allow_nan=False) + "\n",
        "community-report.html": html,
        "community-report.md": markdown,
        "communities.csv": csv_text(community_columns, communities),
        "utilities.csv": csv_text(summary_columns + ["approximate_service_population",
                                "service_population_basis", "service_population_source"], utility_rows),
        "watersheds.csv": csv_text(summary_columns, plan["summaries"]["watersheds"]),
        "interventions.csv": csv_text(intervention_columns, interventions),
        "scientific-context.csv": csv_text(physical_columns, physical),
        "plan.json": json.dumps(plan, indent=2, ensure_ascii=False, sort_keys=True, allow_nan=False) + "\n",
    }
    if revision:
        outputs["plan-revision-summary.json"] = json.dumps(
            revision, indent=2, ensure_ascii=False, sort_keys=True, allow_nan=False) + "\n"
        outputs["previous-plan.json"] = json.dumps(
            previous_plan, indent=2, ensure_ascii=False, sort_keys=True, allow_nan=False) + "\n"
        change_rows = [{**row,
                        "before_json": json.dumps(row["before"], ensure_ascii=False, sort_keys=True, allow_nan=False),
                        "after_json": json.dumps(row["after"], ensure_ascii=False, sort_keys=True, allow_nan=False)}
                       for row in revision["changes"]]
        outputs["plan-revision-changes.csv"] = csv_text(
            ["change", "intervention_id", "title", "field", "before_json", "after_json"], change_rows)
    if regional:
        regional_columns = [
            "regional_report_id", "utility_ids", "huc12", "watershed_name",
            "area_acres", "area_km2", "state_portion_acres", "state_area_minus_huc_area_acres",
            "states", "priority", "priority_states", "priority_statuses",
            "priority_state_portion_acres", "system_types", "resource_concerns", "nrcs_edition",
            "selected_classification_count", "class_counts", "classification_assignment",
            "classification_coverage", "classification_query_coverage", "classification_scope"]
        state_columns = ["regional_report_id", "utility_ids", "huc12", "watershed_name"]
        state_columns.extend(sorted({key for row in regional_states for key in row}
                                    - set(state_columns)))
        outputs["watershed-planning-context.csv"] = csv_text(regional_columns, regional_rows)
        outputs["watershed-state-portions.csv"] = csv_text(state_columns, regional_states)
        outputs["selected-watershed-context.json"] = json.dumps(
            regional, indent=2, ensure_ascii=False, sort_keys=True, allow_nan=False) + "\n"
    if imported:
        outputs["received-interventions.csv"] = imported["source"]["text"]
        import_record = {**imported, "source": {
            key: value for key, value in imported["source"].items() if key != "text"}}
        outputs["INTERVENTION_IMPORT.json"] = json.dumps(
            import_record, indent=2, ensure_ascii=False, sort_keys=True, allow_nan=False) + "\n"
    return outputs, payload


def build(workspace, selection):
    plan = get_plan(workspace, selection.get("plan_id"))
    table = get_table(workspace, plan["table_id"])
    verify_plan_context(workspace, plan)
    revision, previous_plan = _plan_revision(workspace, plan)
    title = text(selection.get("title") or plan["title"], "Report title", required=True, maximum=300)
    key = digest({"schema": "upstate.community-report-selection/v1", "plan_id": plan["id"],
                  "title": title, "format_version": FORMAT_VERSION})
    directory = workspace.root / REPORT_KIND / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".report.lock"):
        outputs, payload = _contents(plan, table, title, revision, previous_plan)
        original, _ = workspace.source_file(table["source"]["collection_id"], table["source"]["source_id"])
        records = {}
        for name, body in outputs.items():
            path = directory / name
            atomic_bytes(path, body.encode("utf-8"), immutable=True)
            records[name] = describe_file(workspace.root, path, title=name,
                                           media_type="text/html" if name.endswith(".html")
                                           else "application/json" if name.endswith(".json")
                                           else "text/csv" if name.endswith(".csv") else "text/markdown")
        source_path = directory / "original-community-source.csv"
        atomic_bytes(source_path, original.read_bytes(), immutable=True)
        records[source_path.name] = describe_file(workspace.root, source_path,
                                                   title="Original community table", media_type="text/csv")
        regional = plan["context"]["snapshots"].get("watershed_context")
        if regional:
            original_regional = verify_file(workspace.root, regional["report_file"])
            regional_path = directory / "original-watershed-context.json"
            atomic_bytes(regional_path, original_regional.read_bytes(), immutable=True)
            records[regional_path.name] = describe_file(
                workspace.root, regional_path, title="Original completed regional watershed context",
                media_type="application/json")
        packet = {"schema": "upstate.community-report-files/v1", "plan_id": plan["id"],
                  "table_id": table["id"], "title": title, "files": records}
        packet_path = directory / "REPORT.json"
        atomic_bytes(packet_path, canonical(packet) + b"\n", immutable=True)
        records["REPORT.json"] = describe_file(workspace.root, packet_path, title="Complete report file index",
                                                 media_type="application/json")
        archive_path = directory / "community-report.zip"
        if not archive_path.exists():
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for name in sorted(records):
                    body = verify_file(workspace.root, records[name]).read_bytes()
                    info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o100644 << 16
                    archive.writestr(info, body)
            atomic_bytes(archive_path, buffer.getvalue(), immutable=True)
        with zipfile.ZipFile(archive_path) as archive:
            if set(archive.namelist()) != set(records):
                raise ValueError("The retained complete report ZIP inventory changed")
            for name, record in records.items():
                import hashlib
                body = archive.read(name)
                if len(body) != record["bytes"] or hashlib.sha256(body).hexdigest() != record["sha256"]:
                    raise ValueError("The retained complete report ZIP differs: " + name)
        records["community-report.zip"] = describe_file(workspace.root, archive_path,
                                                          title="Complete editable community report",
                                                          media_type="application/zip")
        value = {"title": title, "plan_id": plan["id"], "table_id": table["id"],
                 "selection_id": key, "format_version": FORMAT_VERSION,
                 "source": plan["source"], "summaries": plan["summaries"],
                 "context_snapshot_sha256": plan["context"]["snapshot_sha256"],
                 "plan_revision": revision, "files": records}
        return workspace._save(REPORT_KIND, value)

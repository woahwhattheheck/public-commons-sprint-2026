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
                          get_plan, get_table, text, verify_plan_context)

FORMAT_VERSION = 2


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

def _contents(plan, table, title):
    aggregate = plan["summaries"]["all"]
    communities = _community_rows(plan)
    interventions = _intervention_rows(plan)
    physical = _physical_rows(plan)
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
                        "grid_id", "profile_id", "scenario_id", "spatial_basis"]
    payload = {"schema": "upstate.community-report/v1", "title": title,
               "project_basis": "Saved utility/community plan in the original Upper Savannah workspace",
               "plan": plan, "original_table": table, "communities": communities,
               "utility_summaries": utility_rows, "watershed_summaries": plan["summaries"]["watersheds"],
               "interventions": interventions, "physical_context": physical,
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
    physical_headings = ["Run", "State", "Pollutant", "Original total", "Unit",
                         "Alternative − baseline", "Comparison"]
    physical_display = [[row["run_id"], row["run_state"], row["pollutant"], _number(row["value"]),
                         row["unit"] or "Unspecified", _number(row["alternative_minus_baseline"]),
                         row["comparison_kind"]] for row in physical]
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
        ("Original scientific context", physical_headings, physical_display),
    ]
    imported = plan.get("intervention_import")
    if imported:
        revision = imported["summary"]
        sections.insert(3, (
            "Received intervention programme",
            ["Original edited CSV", "Rows", "Added", "Changed", "Removed"],
            [[imported["source"]["filename"], revision["row_count"],
              len(revision["added_ids"]), len(revision["changed_ids"]), len(revision["removed_ids"])]],
        ))
    estimate = plan["cost_summary"]
    cost_statement = (
        str(estimate["known_estimate_count"]) + " of " + str(estimate["intervention_count"])
        + " interventions have entered planning estimates, totaling "
        + _number(estimate["known_estimate_total"]) + " USD. Unspecified costs remain open planning inputs."
        if estimate["known_estimate_count"] else "Intervention cost estimates are open planning inputs.")
    notes = plan["metadata"].get("limitations", []) + plan["notes"]
    for source_note in table.get("source_notes", []):
        label = ("Block group " + source_note["geoid"] + ": ") if source_note.get("geoid") else ""
        notes.extend(label + note for note in source_note.get("notes", []))
    source_line = (
        table["source"]["title"] + "; " + table["source"]["vintage"] + "; " + table["source"]["uri"]
        + "\nOriginal table SHA-256: " + table["source"]["sha256"]
        + "\nSaved plan: " + plan["id"] + " (revision " + str(plan["revision_number"]) + ")"
        + "\nScientific context: " + plan["context"]["snapshot_sha256"]
    )
    html_sections = []
    markdown_sections = []
    for heading, heads, rows in sections:
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
    title = text(selection.get("title") or plan["title"], "Report title", required=True, maximum=300)
    key = digest({"schema": "upstate.community-report-selection/v1", "plan_id": plan["id"],
                  "title": title, "format_version": FORMAT_VERSION})
    directory = workspace.root / REPORT_KIND / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".report.lock"):
        outputs, payload = _contents(plan, table, title)
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
                 "context_snapshot_sha256": plan["context"]["snapshot_sha256"], "files": records}
        return workspace._save(REPORT_KIND, value)

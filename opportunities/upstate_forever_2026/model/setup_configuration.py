"""Readable scientific choices beside the unchanged setup/review workflow.

Copyright TokenJunkieLabs. Values, original columns and observation support are
retained from their saved records; this module does not choose or fit parameters.
"""
from __future__ import annotations
import copy
import csv
import hashlib
import html
import io
import json

from . import experiment_profiles
from .model_selection import selected

SCHEMA = "upstate.setup-configuration/v1"
OBSERVATION_FIELDS = (
    "id", "line", "station_id", "catchment_id", "parameter", "species",
    "original_parameter", "value_text", "unit", "qualifier", "period_start",
    "period_end", "measurement_support", "quantity_basis", "time_support",
    "coverage_days", "expected_days", "coverage_complete", "method",
    "uncertainty", "source_records", "admitted", "issues",
    "native_comparison_issues", "comparison_units", "annual_mass",
)


def profile_configuration(workspace, profile, active_models):
    path, entry = workspace.source_file(
        profile["source_collection_id"], profile["biophysical_source_id"])
    body = path.read_bytes()
    sha = hashlib.sha256(body).hexdigest()
    if (entry["kind"] != "table" or len(body) != entry["body"]["bytes"]
            or sha != entry["body"]["sha256"]
            or sha != profile["table_summary"]["sha256"]):
        raise ValueError("Reopen the original coefficient table bound to this saved profile")
    reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig"), newline=""))
    columns = reader.fieldnames
    if not columns or len(columns) != len(set(columns)) or any(not name for name in columns):
        raise ValueError("The original coefficient table requires distinct named columns")
    rows = list(reader)
    if any(set(row) != set(columns) or any(value is None for value in row.values()) for row in rows):
        raise ValueError("Retain every original coefficient cell without missing or extra columns")
    rules = {row["target"]: row for row in experiment_profiles.catalog()["parameters"]}
    models = list(selected(profile))
    parameters = []
    for model in models:
        for name, value in profile.get(model, {}).items():
            target = model + "." + name
            rule = rules.get(target, {})
            parameters.append({
                "target": target, "model": model, "name": name,
                "label": rule.get("label", name.replace("_", " ")),
                "value": copy.deepcopy(value), "units": rule.get("units"),
                "description": rule.get("description"),
                "reference": rule.get("reference"),
                "selected_for_grid": model in active_models,
            })
    descriptions = []
    for name in columns:
        rule = rules.get("table." + name, {})
        descriptions.append({
            "name": name, "label": rule.get("label", name.replace("_", " ")),
            "units": rule.get("units"), "description": rule.get("description"),
            "reference": rule.get("reference"),
            "choices": copy.deepcopy(rule.get("choices", [])),
            "kind": "native coefficient" if rule else "original source column",
        })
    return {
        "schema": SCHEMA, "profile_id": profile["id"], "title": profile["title"],
        "selected_models": list(active_models), "profile_models": models,
        "parameters": parameters, "table": {
            "columns": list(columns), "rows": rows, "column_descriptions": descriptions,
            "sha256": sha, "bytes": len(body),
            "source_collection_id": profile["source_collection_id"],
            "source_id": profile["biophysical_source_id"],
            "source": copy.deepcopy(entry),
        },
        "model_period": copy.deepcopy(profile.get("model_period")),
        "references": copy.deepcopy(profile.get("references", [])),
        "interpretation": (
            "These are the saved model inputs selected by the scientist. Their values "
            "remain separate from observations and completed model outputs. Nutrient "
            "load values retain each original application-rate or measured-runoff basis; "
            "a load coefficient alone is not routed stream export."
        ),
    }


def observation_configuration(record):
    """Keep all retained rows, species, qualifiers and support without regrouping."""
    return {
        "id": record["id"], "metadata": copy.deepcopy(record["metadata"]),
        "admitted_count": record["admitted_count"],
        "context_count": record["context_count"], "row_count": len(record["rows"]),
        "original": copy.deepcopy(record["original"]),
        "support_summary": copy.deepcopy(record.get("support_summary")),
        "support_rows": [
            {key: copy.deepcopy(row[key]) for key in OBSERVATION_FIELDS if key in row}
            for row in record["rows"]
        ],
    }


def display(value):
    if value is None or value == "":
        return "Not recorded"
    if value is True:
        return "Yes"
    if value is False:
        return "No"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, allow_nan=False)
    return str(value)


def _e(value):
    return html.escape(display(value), quote=True)


def _table(headings, rows):
    return ('<div class="configuration-table"><table><thead><tr>'
            + "".join("<th scope='col'>" + _e(x) + "</th>" for x in headings)
            + "</tr></thead><tbody>"
            + "".join("<tr>" + "".join("<td>" + _e(x) + "</td>" for x in row) + "</tr>" for row in rows)
            + "</tbody></table></div>")


def fields_html(value, prefix=""):
    """Present nested original metadata as labeled fields, with no invented units."""
    if not isinstance(value, (dict, list)):
        return "<p>" + _e(value) + "</p>"
    rows = []
    def visit(item, path):
        if isinstance(item, dict):
            if not item:
                rows.append((path, "No entries"))
            for key, child in item.items():
                visit(child, (path + " / " if path else "") + str(key).replace("_", " "))
        elif isinstance(item, list):
            if not item:
                rows.append((path, "No entries"))
            for index, child in enumerate(item, 1):
                visit(child, (path + " / " if path else "") + str(index))
        else:
            rows.append((path, display(item)))
    visit(value, prefix)
    return _table(("Original field", "Retained value"), rows)


def configuration_html(configuration):
    if not configuration:
        return ("<p>This retained setup predates the readable configuration sheet. "
                "Its original profile and coefficient source remain in the saved package. "
                "Open its selections and preview a new setup to capture this sheet.</p>")
    table = configuration["table"]
    labels = {row["name"]: row for row in table["column_descriptions"]}
    parameters = configuration["parameters"]
    return (
        "<p>" + _e(configuration["interpretation"]) + "</p>"
        + _table(("Parameter", "Saved value", "Units", "Selected model", "Meaning / original method"),
                 [(row["label"], row["value"], row["units"],
                   row["model"].upper() + (" (selected)" if row["selected_for_grid"] else " (profile only)"),
                   row["description"]) for row in parameters])
        + "<h3>Original coefficient table</h3><p>"
        + _e(table["source"].get("title", table["source_id"])) + " · "
        + _e(table["source"].get("vintage")) + " · " + str(len(table["rows"])) + " land-cover rows.</p>"
        + "<p>Every original column and cell is retained. Load-basis columns must be read beside their nutrient values. "
          "Original descriptive columns remain unchanged.</p>"
        + _table([labels[name]["label"] + (" (" + labels[name]["units"] + ")" if labels[name]["units"] else "")
                  for name in table["columns"]],
                 [[row[name] for name in table["columns"]] for row in table["rows"]])
        + "<details><summary>Column names, native meaning and method references</summary>"
        + _table(("Original column", "Meaning", "Units", "Original method"),
                 [(row["name"], row["description"] or row["kind"], row["units"], row["reference"])
                  for row in table["column_descriptions"]])
        + _table(("Native parameter", "Original method reference"),
                 [(row["target"], row["reference"]) for row in parameters])
        + "</details><details><summary>Original coefficient source and model period</summary>"
        + fields_html({"source": table["source"], "model_period": configuration["model_period"],
                       "references": configuration["references"]})
        + "</details>"
    )


def observations_html(observations):
    parts = ["<p>Measurements retain their original species, units, qualifiers, periods and physical support. "
             "An admitted annual-load row is eligible for the existing comparison; this status does not establish "
             "model validation or scientific acceptance. Context rows remain available.</p>"]
    if not observations:
        parts.append("<p>No observation editions are selected.</p>")
    for record in observations:
        parts += ["<h3>" + _e(record["metadata"].get("title", record["id"])) + "</h3>",
                  _table(("Retained rows", "Eligible annual-load rows", "Context rows"),
                         [(record["row_count"], record["admitted_count"], record["context_count"])]),
                  "<details><summary>Original metadata and measurement meaning</summary>",
                  fields_html(record["metadata"]), "</details>"]
        if "support_rows" not in record:
            parts.append("<p>Open the retained original observation record for every measurement and its support.</p>")
            continue
        parts += ["<details><summary>Every retained measurement and comparison context</summary>",
                  _table(("Record / station", "Parameter / species", "Original quantity", "Period",
                          "Physical support", "Comparison role / issues"),
                         [(display(row.get("id")) + " / " + display(row.get("station_id")),
                           display(row.get("original_parameter", row.get("parameter"))) + " / " + display(row.get("species")),
                           display(row.get("value_text")) + " " + display(row.get("unit"))
                           + (" (" + str(row["qualifier"]) + ")" if row.get("qualifier") else ""),
                           display(row.get("period_start")) + " — " + display(row.get("period_end")),
                           row.get("measurement_support"),
                           ("Eligible annual-load input" if row.get("admitted") is True else "Context")
                           + " · " + "; ".join(str(x) for x in row.get("issues", [])))
                          for row in record["support_rows"]]),
                  "</details>"]
    return "".join(parts)


def parameter_csv(configuration):
    stream = io.StringIO(newline="")
    fields = ("target", "label", "value", "units", "model", "selected_for_grid", "description", "reference")
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for row in configuration["parameters"]:
        values = {key: display(row[key]) for key in fields}
        for key, value in values.items():
            if value.startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
                values[key] = "'" + value
        writer.writerow(values)
    return stream.getvalue()

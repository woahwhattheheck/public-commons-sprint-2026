"""Original source-cell comparisons for the retained published-study report.

The existing study_interpretation owns numerical contrasts. This companion
keeps source text, original CSV bytes and source-edition/case bindings visible.
It reads saved profiles and never dispatches a model or changes a selection.
"""
from __future__ import annotations

import base64
from copy import deepcopy
import csv
from hashlib import sha256
import html
import io
import json

from .model_selection import selected
from .profiles import inspect_table

SCHEMA = "upstate.study-original-profile-comparison/v1"
FIELDS = {
    "lucode": ("Land-cover code", ""),
    "load_n": ("Nitrogen loading", "kg/ha/year"),
    "load_p": ("Phosphorus loading", "kg/ha/year"),
    "load_type_n": ("Nitrogen loading basis", ""),
    "load_type_p": ("Phosphorus loading basis", ""),
    "eff_n": ("Maximum nitrogen retention", "fraction"),
    "eff_p": ("Maximum phosphorus retention", "fraction"),
    "crit_len_n": ("Nitrogen critical retention length", "m"),
    "crit_len_p": ("Phosphorus critical retention length", "m"),
    "proportion_subsurface_n": ("Subsurface nitrogen share", "fraction"),
    "usle_c": ("USLE cover-management factor C", "dimensionless"),
    "usle_p": ("USLE support-practice factor P", "dimensionless"),
}
ABSENT = {
    "row_absent": "Land-cover code absent",
    "field_absent": "Field absent",
    "cell_absent": "Source cell absent",
}


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def _field_keys(headers, width):
    """Preserve repeated column names and unheaded original cells by position."""
    result, seen = [], {}
    for index in range(width):
        name = headers[index] if index < len(headers) else None
        seen[name] = seen.get(name, 0) + 1
        result.append({"name": name, "occurrence": seen[name], "position": index})
    return result


def _key(field):
    return field["name"], field["occurrence"]


def _parse(body, native):
    reader = csv.reader(io.StringIO(body.decode("utf-8-sig"), newline=""))
    headers = next(reader)
    code_column = max(index for index, name in enumerate(headers) if name == "lucode")
    rows = []
    for cells in reader:
        if not cells:
            continue
        rows.append({"lucode": int(cells[code_column].strip()),
                     "record": len(rows) + 1, "line_end": reader.line_num,
                     "cells": cells})
    if (len(rows) != len(native["rows"])
            or sorted(row["lucode"] for row in rows) != native["lucodes"]):
        raise ValueError("Original source rows differ from the maintained profile reader")
    width = max([len(headers)] + [len(row["cells"]) for row in rows])
    return {"headers": headers, "fields": _field_keys(headers, width), "rows": rows}


def _cell(table, row, field):
    if row is None:
        return {"state": "row_absent", "value": None}
    source_field = next((item for item in table["fields"] if _key(item) == _key(field)), None)
    if source_field is None:
        return {"state": "field_absent", "value": None}
    index = source_field["position"]
    if index >= len(row["cells"]):
        return {"state": "cell_absent", "value": None}
    return {"state": "present", "value": row["cells"][index]}


def _loading_basis(table, row, field):
    if field["name"] not in ("load_n", "load_p"):
        return None
    name = "load_type_" + field["name"][-1]
    matches = [item for item in table["fields"] if item["name"] == name]
    # The maintained DictReader uses the last occurrence of a repeated header.
    source_field = matches[-1] if matches else {"name": name, "occurrence": 1}
    return _cell(table, row, source_field)


def _compare(before, after):
    fields = list(before["fields"])
    keys = {_key(field) for field in fields}
    fields.extend(field for field in after["fields"] if _key(field) not in keys)
    a = {row["lucode"]: row for row in before["rows"]}
    b = {row["lucode"]: row for row in after["rows"]}
    codes = list(a) + [code for code in b if code not in a]
    result = []
    for code in codes:
        for field in fields:
            old, new = _cell(before, a.get(code), field), _cell(after, b.get(code), field)
            old_basis = _loading_basis(before, a.get(code), field)
            new_basis = _loading_basis(after, b.get(code), field)
            if ((old == new and old_basis == new_basis)
                    or (old["state"] != "present" and new["state"] != "present")):
                continue
            if old["state"] != "present":
                change = "Original " + ABSENT[old["state"]].lower()
            elif new["state"] != "present":
                change = "Alternative " + ABSENT[new["state"]].lower()
            elif old == new and old_basis != new_basis:
                change = "Loading basis changed"
            else:
                change = "Source text changed"
            result.append({"lucode": code, "field": field["name"],
                           "field_occurrence": field["occurrence"],
                           "baseline": old, "alternative": new,
                           "baseline_loading_basis": old_basis,
                           "alternative_loading_basis": new_basis, "change": change})
    return result


def collect(workspace, summary):
    """Read every selected original profile once and each CSV edition once."""
    baseline_id = summary["baseline"]["profile_id"]
    ids = list(dict.fromkeys([baseline_id]
        + list(summary.get("selection", {}).get("profile_ids", []))
        + [row["profile_id"] for row in summary.get("rows", [])]))
    tables, profiles = {}, []
    for key in ids:
        profile = workspace._get("profiles", key)
        active = selected(profile)
        path, entry = workspace.source_file(
            profile["source_collection_id"], profile["biophysical_source_id"])
        if entry["kind"] != "table":
            raise ValueError("A study profile must retain its original biophysical CSV")
        native = inspect_table(path, selected_models=active)
        body = path.read_bytes()
        checksum = sha256(body).hexdigest()
        if (checksum != profile["table_summary"]["sha256"]
                or checksum != entry["body"]["sha256"]
                or len(body) != entry["body"]["bytes"]):
            raise ValueError("Original CSV differs from the saved profile/source edition")
        table = _parse(body, native)
        if checksum not in tables:
            tables[checksum] = {
                "sha256": checksum, "bytes": len(body),
                "filename": "original-biophysical-" + checksum + ".csv",
                "content_base64": base64.b64encode(body).decode("ascii"),
                **table,
            }
        elif table != {name: tables[checksum][name] for name in ("headers", "fields", "rows")}:
            raise ValueError("The same original CSV identity produced different source rows")
        profiles.append({
            "profile_id": key, "profile": deepcopy(profile),
            "models": list(active), "table_sha256": checksum,
            "source": deepcopy(entry),
        })
    by_id = {row["profile_id"]: row for row in profiles}
    baseline_sha = by_id[baseline_id]["table_sha256"]
    comparisons = {}
    for profile in profiles:
        checksum = profile["table_sha256"]
        if checksum not in comparisons:
            before, after = tables[baseline_sha], tables[checksum]
            before_codes = {row["lucode"] for row in before["rows"]}
            after_codes = {row["lucode"] for row in after["rows"]}
            before_fields = {_key(field) for field in before["fields"]}
            after_fields = {_key(field) for field in after["fields"]}
            comparisons[checksum] = {
                "baseline_sha256": baseline_sha, "alternative_sha256": checksum,
                "profile_ids": [], "same_original_bytes": baseline_sha == checksum,
                "added_codes": [row["lucode"] for row in after["rows"]
                                if row["lucode"] not in before_codes],
                "removed_codes": [row["lucode"] for row in before["rows"]
                                  if row["lucode"] not in after_codes],
                "added_fields": [field for field in after["fields"]
                                 if _key(field) not in before_fields],
                "removed_fields": [field for field in before["fields"]
                                   if _key(field) not in after_fields],
                "cell_changes": _compare(before, after),
            }
        comparisons[checksum]["profile_ids"].append(profile["profile_id"])
    return {
        "schema": SCHEMA, "workspace_id": summary["workspace_id"],
        "experiment_id": summary["id"], "baseline_profile_id": baseline_id,
        "baseline": deepcopy(summary["baseline"]),
        "experiment_selection": deepcopy(summary.get("selection", {})),
        "case_bindings": [
            {name: deepcopy(row[name]) for name in (
                "profile_id", "scenario_id", "scenario_title", "kind", "state",
                "run_id", "baseline_run_id", "comparison_id") if name in row}
            for row in summary.get("rows", [])
        ],
        "profiles": profiles, "tables": tables,
        "comparisons": list(comparisons.values()),
        "method": (
            "Columns match by exact original name and occurrence; land-cover rows "
            "match by the maintained reader's integer lucode. Original row/column "
            "order, raw code spelling, empty strings, missing cells and additional "
            "fields are retained. A source-text change is not a computed physical "
            "effect. Existing numerical study contrasts retain their own loading "
            "basis, units and native paired-cell support."
        ),
    }


def _h(value):
    return html.escape(str(value), quote=True)


def _field_label(name, occurrence=1):
    title, unit = FIELDS.get(name, (name if name is not None else "Unheaded source field", ""))
    return (str(title) + (" [" + name + "]" if name in FIELDS else "")
            + (" (" + unit + ")" if unit else "")
            + (" [occurrence " + str(occurrence) + "]" if occurrence > 1 else ""))


def _cell_html(cell):
    if cell["state"] != "present":
        return "<em>" + _h(ABSENT[cell["state"]]) + "</em>"
    if cell["value"] == "":
        return "<em>Empty original source cell</em>"
    return '<span class="source-cell">' + _h(cell["value"]) + "</span>"


def _comparison_cell(row, side):
    result = _cell_html(row[side])
    basis = row[side + "_loading_basis"]
    if basis is not None:
        result += "<br><small>Original loading basis: " + _cell_html(basis) + "</small>"
    return result


def _html_table(headers, rows):
    return ('<div class="table-wrap"><table><thead><tr>'
            + "".join('<th scope="col">' + _h(name) + "</th>" for name in headers)
            + "</tr></thead><tbody>"
            + "".join("<tr>" + "".join("<td>" + cell + "</td>" for cell in row) + "</tr>"
                      for row in rows) + "</tbody></table></div>")


def _metadata_rows(value, prefix=""):
    if isinstance(value, dict) and value:
        for key, child in value.items():
            yield from _metadata_rows(child, (prefix + " / " if prefix else "") + str(key))
    elif isinstance(value, list) and value:
        for index, child in enumerate(value, 1):
            yield from _metadata_rows(child, prefix + " [" + str(index) + "]")
    else:
        yield [_h(prefix), _h(_json(value))]


def html_section(value):
    """Render the complete original-cell/source comparison without scripts."""
    if not value:
        return ""
    names = {row["profile_id"]: row["profile"]["title"] for row in value["profiles"]}
    baseline_name = names[value["baseline_profile_id"]]
    output = [
        '<section id="original-profile-assumptions"><h2>Original profile assumptions</h2>',
        "<p>Compare each retained source edition with " + _h(baseline_name) + ". "
        "Every displayed input is the original CSV text. Changed spelling or precision "
        "is distinguished from the numerical coefficient changes reported above. "
        "Repeated source bytes appear once; all selected profile and case bindings remain in the downloads. "
        "Nitrogen and phosphorus loads retain kg/ha/year under both application-rate and measured-runoff bases; "
        "the native engine applies its on-pixel retention adjustment only to application-rate inputs. "
        "The original values below are unadjusted source cells.</p>",
    ]
    for comparison in value["comparisons"]:
        titles = [names[key] for key in comparison["profile_ids"]]
        output.append("<h3>" + _h("; ".join(titles)) + "</h3>")
        output.append("<p>Baseline CSV <code>" + _h(comparison["baseline_sha256"])
                      + "</code>; selected CSV <code>" + _h(comparison["alternative_sha256"])
                      + "</code>.</p>")
        if comparison["same_original_bytes"]:
            output.append("<p>This selection uses the baseline's exact original CSV bytes. "
                          "Profile references and native settings remain separately retained below.</p>")
        else:
            output.append("<p>Added land-cover codes: " + _h(", ".join(map(str, comparison["added_codes"])) or "None")
                          + ". Removed codes: " + _h(", ".join(map(str, comparison["removed_codes"])) or "None") + ".</p>")
            for label, key in (("Added fields", "added_fields"), ("Removed fields", "removed_fields")):
                output.append("<p>" + label + ": "
                              + _h("; ".join(_field_label(item["name"], item["occurrence"])
                                             for item in comparison[key]) or "None") + ".</p>")
            if comparison["cell_changes"]:
                output.append(_html_table(
                    ["Land-cover code", "Original field", "Baseline source", "Selected source", "Source difference"],
                    [[_h(row["lucode"]), _h(_field_label(row["field"], row["field_occurrence"])),
                      _comparison_cell(row, "baseline"), _comparison_cell(row, "alternative"), _h(row["change"])]
                     for row in comparison["cell_changes"]]))
            else:
                output.append("<p>The original CSV bytes differ, while every matched source cell is unchanged. "
                              "The exact downloaded originals retain encoding, order and record formatting.</p>")
    output.append("<details><summary>Complete original tables and source references</summary>")
    for checksum, table in value["tables"].items():
        associated = [row for row in value["profiles"] if row["table_sha256"] == checksum]
        output.append("<h3>" + _h("; ".join(names[row["profile_id"]] for row in associated)) + "</h3>")
        output.append("<p>Original CSV: <code>" + _h(checksum) + "</code>; "
                      + str(table["bytes"]) + " bytes; " + str(len(table["rows"]))
                      + " original records.</p>")
        output.append(_html_table(
            ["Original record", "Land-cover code", "Original field", "Original source cell"],
            [[_h(row["record"]), _h(row["lucode"]), _h(_field_label(field["name"], field["occurrence"])),
              _cell_html(_cell(table, row, field))]
             for row in table["rows"] for field in table["fields"]]))
    for profile in value["profiles"]:
        output.append("<h3>" + _h(profile["profile"]["title"]) + "</h3>")
        metadata = {
            "profile_id": profile["profile_id"], "selected_models": profile["models"],
            "saved_profile": profile["profile"], "original_source_entry": profile["source"],
        }
        output.append(_html_table(["Original profile/source property", "Retained value"],
                                  list(_metadata_rows(metadata))))
    output.append("</details><p class=\"definition\">" + _h(value["method"]) + "</p></section>")
    return "".join(output)


def comparison_csv(value):
    """Use JSON-encoded cell strings so blanks/missing values remain distinct."""
    fields = (
        "profile_ids_json", "lucode", "field_json", "field_occurrence",
        "baseline_state", "baseline_value_json", "alternative_state", "alternative_value_json",
        "baseline_loading_basis_json", "alternative_loading_basis_json",
        "source_difference", "baseline_sha256", "alternative_sha256",
    )
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for comparison in value["comparisons"]:
        for row in comparison["cell_changes"]:
            writer.writerow({
                "profile_ids_json": _json(comparison["profile_ids"]),
                "lucode": row["lucode"], "field_json": _json(row["field"]),
                "field_occurrence": row["field_occurrence"],
                "baseline_state": row["baseline"]["state"],
                "baseline_value_json": _json(row["baseline"]["value"]),
                "alternative_state": row["alternative"]["state"],
                "alternative_value_json": _json(row["alternative"]["value"]),
                "baseline_loading_basis_json": _json(row["baseline_loading_basis"]),
                "alternative_loading_basis_json": _json(row["alternative_loading_basis"]),
                "source_difference": row["change"],
                "baseline_sha256": comparison["baseline_sha256"],
                "alternative_sha256": comparison["alternative_sha256"],
            })
    return output.getvalue().encode("utf-8")


def downloads(value):
    """Return exact source/download tuples consumed by study_report.build."""
    if value.get("schema") != SCHEMA:
        raise ValueError("Select the retained original profile comparison")
    result = {
        "study-original-profile-comparison.json": (
            "Original profile/source comparison", "application/json",
            (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")),
        "study-original-profile-cells.csv": (
            "Original source-cell changes", "text/csv", comparison_csv(value)),
    }
    for checksum, table in value["tables"].items():
        body = base64.b64decode(table["content_base64"], validate=True)
        if sha256(body).hexdigest() != checksum or len(body) != table["bytes"]:
            raise ValueError("Original CSV download differs from its retained source")
        result[table["filename"]] = (
            "Original biophysical CSV " + checksum[:12], "text/csv", body)
    return result

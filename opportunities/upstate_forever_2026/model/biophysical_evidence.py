"""Source-bound coefficient evidence and endpoint choices in the original profile workflow.

The maintained experiment_profiles engine owns profile/table materialization.
This module records original coefficient sources and composes explicit selected
cells into that engine; it does not transform loads or start native models.
"""
from __future__ import annotations

import copy
import csv
import io
from pathlib import Path

from .common import canonical, digest, file_digest, identifier, selected_models
from . import experiment_profiles as sourced

EVIDENCE_KIND = "biophysical-evidence"
RANGES_KIND = "biophysical-ranges"
EDITION = "biophysical-evidence/1"
NUMERIC_FIELDS = ("load_n", "load_p", "eff_n", "eff_p", "crit_len_n", "crit_len_p",
                  "proportion_subsurface_n", "usle_c", "usle_p")
CSV_FIELDS = (
    "lucode", "parameter", "value", "units", "load_type",
    "source_title", "source_uri", "source_locator", "source_period",
    "lower", "upper", "range_basis", "notes",
)
SOURCE_FIELDS = ("source_title", "source_uri", "source_locator", "source_period", "notes")
METHODS = {
    "edition": EDITION,
    "native_guides": [sourced.NDR_REFERENCE, sourced.SDR_REFERENCE],
    "load_basis": "Application-rate values remain application rates. The original native NDR "
                  "model applies load * (1 - efficiency); measured-runoff values enter directly. "
                  "The evidence and range adapter never pre-reduces or retags loads.",
    "ranges": "Lower and upper are sourced coefficient endpoints. They are not confidence "
              "limits or automatically lower and higher pollution outcomes.",
    "selection": "Only explicitly selected lucode/parameter cells move. All other original "
                 "coefficient values remain unchanged.",
    "unknown": "Absent or unattributed cell evidence remains unknown. General profile "
               "references are retained separately and do not imply cell-specific attribution.",
    "materializer": "model.experiment_profiles.materialize",
}


def _text(value, label, *, required=True):
    if not isinstance(value, str) or (required and not value.strip()):
        raise ValueError(label + " must be " + ("nonempty " if required else "") + "text")
    return value.strip()


def _object(value, fields, label):
    if not isinstance(value, dict) or set(value) - set(fields):
        raise ValueError("Select the supported " + label + " fields: " + ", ".join(fields))
    return value


def _proposed(kind, payload):
    value = {**payload, "schema": "upstate." + kind + "/v1"}
    return {**value, "id": digest(value)}


def _context(workspace, profile_id):
    profile, entry, table = sourced._base(workspace, identifier(profile_id))
    active = selected_models(profile)
    fields = [field for field in NUMERIC_FIELDS
              if field in table["columns"] and sourced._target_model("table." + field) in active]
    cells = {}
    for row in table["rows"]:
        code = int(row["lucode"])
        for field in fields:
            key = (code, field)
            cells[key] = {
                "lucode": code, "parameter": field,
                "units": sourced.PARAMETERS["table." + field]["units"],
                "value": sourced._value("table." + field, row[field]),
                "table_value_text": row[field],
                "load_type": (row["load_type_" + field[-1]].strip()
                              if field in ("load_n", "load_p") else None),
                "source_status": "unknown", "source": None, "range": None,
                "range_eligible": False,
            }
    return profile, entry, table, cells


def _table_record(profile, entry, table):
    return {
        "source_collection_id": profile["source_collection_id"],
        "source_id": profile["biophysical_source_id"],
        "sha256": entry["body"]["sha256"], "bytes": entry["body"]["bytes"],
        "uri": entry["uri"], "title": entry["title"], "vintage": entry["vintage"],
        "columns": table["columns"], "lucodes": table["lucodes"], "rows": len(table["rows"]),
    }


def _coverage(cells):
    values = list(cells)
    loads = [row for row in values if row["parameter"] in ("load_n", "load_p")]
    documented = sum(row["source_status"] == "documented" for row in values)
    load_documented = sum(row["source_status"] == "documented" for row in loads)
    return {
        "total": len(values), "documented": documented, "unknown": len(values) - documented,
        "ranged": sum(row["range"] is not None for row in values),
        "range_eligible": sum(row["range_eligible"] for row in values),
        "load_cells": len(loads), "documented_load_cells": load_documented,
        "unknown_load_cells": len(loads) - load_documented,
        "meaning": "Counts of selected-model coefficient cells, not geographic area or confidence.",
    }


def _source_rows(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        columns = reader.fieldnames or []
        required = {"lucode", "parameter", "value", "units", "load_type", "source_title", "source_uri"}
        if len(columns) != len(set(columns)) or set(columns) - set(CSV_FIELDS):
            raise ValueError("Evidence CSV headers must be distinct documented field names")
        if required - set(columns):
            raise ValueError("Evidence CSV requires columns: " + ", ".join(sorted(required - set(columns))))
        rows = []
        for line, raw in enumerate(reader, 2):
            if None in raw or any(value is None for value in raw.values()):
                raise ValueError("Evidence CSV line " + str(line) + " has the wrong number of cells")
            row = {name: str(raw.get(name, "")).strip() for name in CSV_FIELDS}
            if not any(row.values()):
                continue
            rows.append((line, row))
    if not rows:
        raise ValueError("The original evidence CSV has no coefficient rows")
    return rows


def preview_evidence(workspace, selection):
    """Read original coefficient and evidence sources; create no profile or evidence record."""
    value = _object(selection, ("profile_id", "source_collection_id", "source_id"),
                    "coefficient evidence")
    profile, table_entry, table, cells = _context(workspace, value.get("profile_id"))
    collection_id = identifier(value.get("source_collection_id"))
    source_id = _text(value.get("source_id"), "Evidence source ID")
    path, source = workspace.source_file(collection_id, source_id)
    if source["kind"] != "table":
        raise ValueError("Select a retained coefficient evidence CSV source")
    if file_digest(path) != source["body"]["sha256"]:
        raise ValueError("The retained evidence CSV body changed")
    seen = set()
    for line, row in _source_rows(path):
        try:
            code = int(row["lucode"])
        except ValueError as exc:
            raise ValueError("Evidence CSV line " + str(line) + " needs an integer lucode") from exc
        field = row["parameter"]
        key = (code, field)
        if key in seen:
            raise ValueError("Duplicate evidence for land-cover " + str(code) + " / " + field)
        seen.add(key)
        if key not in cells:
            raise ValueError("Evidence selects a coefficient outside the original profile's model scope: "
                             + str(code) + " / " + field)
        cell = cells[key]
        actual = sourced._value("table." + field, row["value"])
        if actual != cell["value"]:
            raise ValueError("Evidence value differs from the original CSV for " + str(code) + " / " + field)
        if row["units"] != cell["units"]:
            raise ValueError("Evidence units for " + field + " must be " + cell["units"])
        if field in ("load_n", "load_p"):
            if row["load_type"] != cell["load_type"]:
                raise ValueError("Evidence load type differs from the original " + field + " tag for " + str(code))
        elif row["load_type"]:
            raise ValueError("Only nutrient load cells have a load_type evidence tag")
        has_source = bool(row["source_title"] or row["source_uri"])
        if has_source and not (row["source_title"] and row["source_uri"]):
            raise ValueError("Documented evidence needs both source_title and source_uri")
        if not has_source and any(row[name] for name in ("source_locator", "source_period", "notes",
                                                       "lower", "upper", "range_basis")):
            raise ValueError("Attach the actual title and citation before supplying coefficient source details or ranges")
        cell["evidence_line"] = line
        cell["evidence_value_text"] = row["value"]
        if has_source:
            cell.update(source_status="documented",
                        source={name.removeprefix("source_"): row[name] or None for name in SOURCE_FIELDS})
        has_range = bool(row["lower"] or row["upper"] or row["range_basis"])
        if has_range:
            if not has_source or not row["lower"] or not row["upper"] or not row["range_basis"]:
                raise ValueError("A coefficient range needs both endpoints, its source and range_basis")
            lower = sourced._value("table." + field, row["lower"])
            upper = sourced._value("table." + field, row["upper"])
            if not lower <= actual <= upper:
                raise ValueError("Sourced lower/central/upper coefficient values must be ordered for "
                                 + str(code) + " / " + field)
            cell["range"] = {"lower": lower, "upper": upper, "lower_text": row["lower"],
                             "upper_text": row["upper"], "basis": row["range_basis"]}
            cell["range_eligible"] = lower < upper
    ordered = list(cells.values())
    return _proposed(EVIDENCE_KIND, {
        "edition": EDITION, "workspace_id": workspace.project["id"],
        "profile_id": profile["id"], "profile_title": profile["title"],
        "models": selected_models(profile), "table": _table_record(profile, table_entry, table),
        "source": {"source_collection_id": collection_id, "source_id": source_id,
                   "sha256": source["body"]["sha256"], "bytes": source["body"]["bytes"],
                   "uri": source["uri"], "title": source["title"], "vintage": source["vintage"]},
        "cells": ordered, "coverage": _coverage(ordered),
        "profile_references": copy.deepcopy(profile.get("references", [])), "methods": METHODS,
    })


def save_evidence(workspace, selection):
    record = preview_evidence(workspace, selection)
    saved = workspace._save(EVIDENCE_KIND, record)
    if saved["id"] != record["id"]:
        raise ValueError("Coefficient evidence changed during retention")
    return saved


def inspect_evidence(workspace, evidence_id):
    record = workspace._get(EVIDENCE_KIND, identifier(evidence_id))
    source = record["source"]
    observed = preview_evidence(workspace, {
        "profile_id": record["profile_id"],
        "source_collection_id": source["source_collection_id"], "source_id": source["source_id"],
    })
    if canonical(record) != canonical(observed):
        raise ValueError("Original profile or evidence selection differs from its retained evidence record")
    return record


def catalog(workspace, profile_id):
    profile, entry, table, cells = _context(workspace, profile_id)
    evidence = []
    for record in workspace._list(EVIDENCE_KIND):
        if record["profile_id"] == profile["id"]:
            evidence.append({key: record[key] for key in
                             ("id", "profile_id", "profile_title", "source", "table", "coverage", "edition")})
    ranges = []
    for record in workspace._list(RANGES_KIND):
        if record["profile_id"] == profile["id"]:
            ranges.append({key: record[key] for key in
                           ("id", "profile_id", "title", "reason", "evidence_id", "profiles",
                            "selected_cells", "coverage", "edition")})
    return {
        "schema": "upstate.biophysical-evidence-catalog/v1",
        "workspace_id": workspace.project["id"],
        "profile": {"id": profile["id"], "title": profile["title"], "models": selected_models(profile)},
        "table": _table_record(profile, entry, table), "evidence": evidence, "ranges": ranges,
        "cells": list(cells.values()), "coverage": _coverage(cells.values()),
        "csv_columns": list(CSV_FIELDS), "methods": METHODS,
    }


def template(workspace, profile_id):
    profile, entry, table, cells = _context(workspace, profile_id)
    rows = [{name: "" for name in CSV_FIELDS} for _ in cells]
    for row, cell in zip(rows, cells.values()):
        row.update(lucode=cell["lucode"], parameter=cell["parameter"], value=cell["table_value_text"],
                   units=cell["units"], load_type=cell["load_type"] or "")
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=CSV_FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return {
        "schema": "upstate.biophysical-evidence-template/v1",
        "profile_id": profile["id"], "table_sha256": entry["body"]["sha256"],
        "filename": "biophysical-evidence-" + profile["id"][:12] + ".csv",
        "columns": list(CSV_FIELDS), "rows": rows, "csv_text": buffer.getvalue(),
        "instructions": "Keep original values, units and load_type. Add actual source title and citation "
                        "for documented cells. Enter sourced lower/upper and range_basis only where "
                        "available. Unattributed rows may stay blank in those fields or be omitted.",
        "methods": METHODS,
    }


def _range_selection(workspace, value):
    value = _object(value, ("evidence_id", "title", "reason", "parameters"), "coefficient endpoints")
    evidence = inspect_evidence(workspace, value.get("evidence_id"))
    title = _text(value.get("title"), "Endpoint profile title")
    reason = _text(value.get("reason"), "Endpoint scientific purpose")
    parameters = value.get("parameters")
    if not isinstance(parameters, list) or not parameters:
        raise ValueError("Select the exact land-cover coefficient cells to vary")
    by_key = {(row["lucode"], row["parameter"]): row for row in evidence["cells"]}
    chosen, seen = [], set()
    for item in parameters:
        item = _object(item, ("lucode", "parameter"), "selected coefficient")
        if type(item.get("lucode")) is not int or not isinstance(item.get("parameter"), str):
            raise ValueError("Select an integer lucode and its original parameter name")
        key = (item["lucode"], item["parameter"])
        if key in seen:
            raise ValueError("A coefficient cell was selected more than once")
        seen.add(key)
        cell = by_key.get(key)
        if cell is None or not cell["range_eligible"]:
            raise ValueError("Selected coefficient lacks documented distinct range endpoints: "
                             + str(key[0]) + " / " + key[1])
        chosen.append(copy.deepcopy(cell))
    chosen.sort(key=lambda row: (row["lucode"], row["parameter"]))
    selection = {"evidence_id": evidence["id"], "title": title, "reason": reason,
                 "parameters": [{"lucode": row["lucode"], "parameter": row["parameter"]} for row in chosen]}
    return selection, evidence, chosen


def _endpoint_spec(selection, evidence, chosen, position):
    factors = []
    for cell in chosen:
        source = cell["source"]
        citation = source["title"] + " — " + source["uri"]
        if source.get("locator"):
            citation += " — " + source["locator"]
        if source.get("period"):
            citation += " — " + source["period"]
        factors.append({
            "name": str(cell["lucode"]) + " / " + cell["parameter"],
            "target": "table." + cell["parameter"], "lucodes": [cell["lucode"]],
            "levels": [{
                "label": position + " endpoint", "value": cell["range"][position],
                "references": [citation,
                               "Retained coefficient evidence " + evidence["id"]
                               + " / source SHA256 " + evidence["source"]["sha256"]],
                "reason": cell["range"]["basis"] + " Selected purpose: " + selection["reason"],
            }],
        })
    return {
        "title": selection["title"] + " / " + position + " parameter endpoints",
        "reason": selection["reason"] + " " + METHODS["ranges"],
        "baseline_profile_id": evidence["profile_id"], "design": "factorial", "factors": factors,
    }


def preview_ranges(workspace, value):
    selection, evidence, chosen = _range_selection(workspace, value)
    endpoints = []
    for position in ("lower", "upper"):
        spec = _endpoint_spec(selection, evidence, chosen, position)
        proposed = sourced.preview(workspace, spec)
        if proposed["profile_count"] > 2 or proposed["derived_profile_count"] > 1:
            raise ValueError("An endpoint must compose exactly one selected coefficient configuration")
        endpoints.append({"position": position, "source_profile_spec": spec, "proposed": proposed})
    return {
        "schema": "upstate.biophysical-range-preview/v1", "edition": EDITION,
        "selection": selection, "evidence_id": evidence["id"], "profile_id": evidence["profile_id"],
        "central": {"profile_id": evidence["profile_id"], "title": evidence["profile_title"],
                    "table_sha256": evidence["table"]["sha256"], "table_bytes": evidence["table"]["bytes"]},
        "selected_cells": chosen, "coverage": evidence["coverage"], "endpoints": endpoints,
        "methods": METHODS,
    }



def _verify_endpoint(profile, table, central_profile, central_table, selected, position):
    """Keep all scientific inputs except the explicitly selected table cells fixed."""
    active = selected_models(central_profile)
    if selected_models(profile) != active:
        raise ValueError("Endpoint materialization changed the original native model scope")
    for model in active:
        if canonical(profile[model]) != canonical(central_profile[model]):
            raise ValueError("Endpoint materialization changed an original native algorithm parameter")
    if table["columns"] != central_table["columns"] or len(table["rows"]) != len(central_table["rows"]):
        raise ValueError("Endpoint materialization changed the original table shape")
    for before, after in zip(central_table["rows"], table["rows"]):
        if after["lucode"] != before["lucode"]:
            raise ValueError("Endpoint materialization changed the original land-cover row order or codes")
        code = int(before["lucode"])
        for field in central_table["columns"]:
            chosen = selected.get((code, field)) if position != "central" else None
            if chosen is None:
                if after[field] != before[field]:
                    raise ValueError("Endpoint materialization changed untouched original table text")
            elif sourced._value("table." + field, after[field]) != chosen["range"][position]:
                raise ValueError("Endpoint materialization differs from the selected sourced coefficient")


def prepare_ranges(workspace, value):
    """Create endpoint profiles using the existing sourced-profile materializer."""
    proposed = preview_ranges(workspace, value)
    evidence = inspect_evidence(workspace, proposed["evidence_id"])
    profiles = {"central": proposed["central"]}
    preparations = {}
    for endpoint in proposed["endpoints"]:
        state = sourced.materialize(workspace, endpoint["source_profile_spec"])
        options = [row for row in state["profiles"] if not row["is_baseline"]]
        if len(options) > 1 or state.get("state") != "complete":
            raise ValueError("The original endpoint profile materialization is incomplete")
        profile_id = options[0]["profile_id"] if options else evidence["profile_id"]
        profile, entry, table, cells = _context(workspace, profile_id)
        position = endpoint["position"]
        central_profile, _, central_table, _ = _context(workspace, evidence["profile_id"])
        selected = {(row["lucode"], row["parameter"]): row for row in proposed["selected_cells"]}
        _verify_endpoint(profile, table, central_profile, central_table, selected, position)
        profiles[position] = {"profile_id": profile_id, "title": profile["title"],
                              "table_sha256": entry["body"]["sha256"],
                              "table_bytes": entry["body"]["bytes"],
                              "source_profile_set_id": state["id"]}
        preparations[position] = {
            "source_profile_set_id": state["id"], "spec": endpoint["source_profile_spec"],
            "profile_id": profile_id,
        }
    # The central profile and table were read, never rewritten or cloned.
    central, central_entry, _, _ = _context(workspace, evidence["profile_id"])
    if central_entry["body"]["sha256"] != evidence["table"]["sha256"]:
        raise ValueError("The original central biophysical table changed")
    return workspace._save(RANGES_KIND, {
        "edition": EDITION, "workspace_id": workspace.project["id"],
        "title": proposed["selection"]["title"], "reason": proposed["selection"]["reason"],
        "profile_id": central["id"], "evidence_id": evidence["id"],
        "selection": proposed["selection"], "profiles": profiles,
        "profile_ids": list(dict.fromkeys(row["profile_id"] for name, row in profiles.items()
                                         if name != "central" and row["profile_id"] != central["id"])),
        "selected_cells": proposed["selected_cells"], "coverage": evidence["coverage"],
        "preparations": preparations, "methods": METHODS,
    })


def inspect_ranges(workspace, range_id):
    record = workspace._get(RANGES_KIND, identifier(range_id))
    evidence = inspect_evidence(workspace, record["evidence_id"])
    if record["profile_id"] != evidence["profile_id"]:
        raise ValueError("The endpoint set is bound to another central profile")
    selection, checked_evidence, chosen = _range_selection(workspace, record["selection"])
    if (checked_evidence["id"] != evidence["id"]
            or canonical(chosen) != canonical(record["selected_cells"])
            or canonical(record["coverage"]) != canonical(evidence["coverage"])):
        raise ValueError("The endpoint cells or coverage differ from their original evidence")
    if set(record["profiles"]) != {"central", "lower", "upper"}:
        raise ValueError("Retain the original central and both endpoint profile bindings")
    if record["profiles"]["central"]["profile_id"] != evidence["profile_id"]:
        raise ValueError("The central endpoint is not the original saved profile")
    central_profile, _, central_table, _ = _context(workspace, evidence["profile_id"])
    selected = {(row["lucode"], row["parameter"]): row for row in chosen}
    for position, item in record["profiles"].items():
        profile, entry, table, cells = _context(workspace, item["profile_id"])
        if entry["body"]["sha256"] != item["table_sha256"] or entry["body"]["bytes"] != item["table_bytes"]:
            raise ValueError("A retained endpoint table differs from its original body")
        _verify_endpoint(profile, table, central_profile, central_table, selected, position)
    expected_ids = list(dict.fromkeys(row["profile_id"] for name, row in record["profiles"].items()
                                     if name != "central" and row["profile_id"] != evidence["profile_id"]))
    if set(record["profile_ids"]) != set(expected_ids) or len(record["profile_ids"]) != len(expected_ids):
        raise ValueError("The native experiment profile selection differs from the saved endpoints")
    return record


def prepare_experiment(workspace, value):
    """Prepare the original native experiment; normal queue/run actions execute it."""
    value = _object(value, ("range_id", "baseline_run_id", "scenario_ids", "source_run_ids"),
                    "endpoint native experiment")
    record = inspect_ranges(workspace, value.get("range_id"))
    baseline = workspace.inspect_run(identifier(value.get("baseline_run_id")))
    if baseline["selection"]["profile_id"] != record["profile_id"]:
        raise ValueError("Select the original central profile's native baseline run")
    scenario = workspace._get("scenarios", baseline["selection"]["scenario_id"])
    if scenario.get("kind") != "baseline":
        raise ValueError("Select the original land-cover baseline for the endpoint experiment")
    if selected_models(baseline["selection"]) != selected_models(workspace._get("profiles", record["profile_id"])):
        raise ValueError("The endpoint experiment must select the central profile's original model scope")
    from . import experiments
    selection = {
        "title": record["title"], "reason": record["reason"] + " "
                 + METHODS["ranges"] + " Retained range selection: " + record["id"],
        "baseline_run_id": baseline["id"], "scenario_ids": value.get("scenario_ids", []),
        "profile_ids": record["profile_ids"], "design": "one_at_a_time", "axes": [],
    }
    if value.get("source_run_ids"):
        selection["source_run_ids"] = value["source_run_ids"]
    return experiments.prepare(workspace, selection)



def verify_all(workspace):
    """Validate retained source evidence and endpoint bindings during normal receiving."""
    evidence = workspace._list(EVIDENCE_KIND)
    ranges = workspace._list(RANGES_KIND)
    for record in evidence:
        inspect_evidence(workspace, record["id"])
    for record in ranges:
        inspect_ranges(workspace, record["id"])
    return {"evidence_records": len(evidence), "range_records": len(ranges)}


def main(argv=None):
    import argparse
    import json
    import sys
    from .common import read_json
    from .workspace import Workspace

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("catalog", "template"):
        command = commands.add_parser(name)
        command.add_argument("--profile", required=True)
    for name in ("inspect-evidence", "inspect-ranges"):
        command = commands.add_parser(name)
        command.add_argument("--id", required=True)
    for name in ("preview-evidence", "save-evidence", "preview-ranges",
                 "prepare-ranges", "prepare-experiment"):
        command = commands.add_parser(name)
        command.add_argument("--selection", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        workspace = Workspace(args.workspace)
        function = globals()[args.command.replace("-", "_")]
        if args.command in ("catalog", "template"):
            result = function(workspace, args.profile)
        elif args.command in ("inspect-evidence", "inspect-ranges"):
            result = function(workspace, args.id)
        else:
            result = function(workspace, read_json(args.selection))
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (ValueError, KeyError, OSError, RuntimeError, csv.Error) as exc:
        print(json.dumps({"state": "failed", "type": type(exc).__name__, "message": str(exc)}),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Explain retained coefficient choices beside actual native study comparisons."""
from __future__ import annotations

import csv
import hashlib
import io
import math

FIELDS = {
    "load_n": "kg/ha/year", "load_p": "kg/ha/year",
    "load_type_n": "basis", "load_type_p": "basis",
    "eff_n": "ratio", "eff_p": "ratio",
    "crit_len_n": "m", "crit_len_p": "m",
    "proportion_subsurface_n": "ratio",
    "usle_c": "dimensionless", "usle_p": "dimensionless",
}


def _value(value):
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if not math.isfinite(number):
        raise ValueError("Retained coefficients must be finite")
    return number


def _table(body):
    reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig")))
    rows = {}
    for row in reader:
        code = int(row["lucode"])
        if code in rows:
            raise ValueError("Retained profile table repeats a land-cover code")
        rows[code] = {field: _value(row.get(field)) for field in FIELDS}
    return rows


def _delta(first, second):
    return second - first if isinstance(first, (int, float)) and isinstance(second, (int, float)) else None


def _ratio(first, second):
    return second / first if isinstance(first, (int, float)) and isinstance(second, (int, float)) and first else None


def _cp(row):
    c, p = row.get("usle_c"), row.get("usle_p")
    return c * p if isinstance(c, (int, float)) and isinstance(p, (int, float)) else None


def from_profiles(summary, records, tables, *, spatial=None, sources=()):
    """Interpret exact supplied profile records and table bytes without GIS."""
    baseline_id = summary["baseline"]["profile_id"]
    baseline = records[baseline_id]
    base_rows = tables[baseline_id]
    profile_rows, changes, parameter_changes, transitions = [], [], [], []
    for key, profile in records.items():
        rows = tables[key]
        start = len(changes)
        for code in sorted(set(base_rows) | set(rows)):
            before, after = base_rows.get(code, {}), rows.get(code, {})
            for field, units in FIELDS.items():
                old, new = before.get(field), after.get(field)
                basis_field = "load_type_" + field[-1] if field in ("load_n", "load_p") else None
                before_basis = before.get(basis_field) if basis_field else None
                after_basis = after.get(basis_field) if basis_field else None
                comparable = (before_basis is not None and before_basis == after_basis) if basis_field else None
                if old != new:
                    changes.append({
                        "profile_id": key, "profile": profile["title"], "lucode": code,
                        "field": field, "units": units, "baseline": old, "alternative": new,
                        "baseline_basis": before_basis, "alternative_basis": after_basis,
                        "comparable_basis": comparable,
                        "delta": _delta(old, new) if not basis_field or comparable else None,
                        "ratio": _ratio(old, new) if not basis_field or comparable else None,
                        "baseline_profile_id": baseline_id,
                    })
        pstart = len(parameter_changes)
        for model in ("ndr", "sdr"):
            before, after = baseline.get(model, {}), profile.get(model, {})
            for field in sorted(set(before) | set(after)):
                if before.get(field) != after.get(field):
                    parameter_changes.append({
                        "profile_id": key, "profile": profile["title"], "model": model,
                        "parameter": field, "baseline": before.get(field),
                        "alternative": after.get(field), "baseline_profile_id": baseline_id,
                    })
        profile_rows.append({
            "profile_id": key, "title": profile["title"], "class_count": len(rows),
            "changed_coefficient_cells": len(changes) - start,
            "changed_native_parameters": len(parameter_changes) - pstart,
            "references": profile.get("references", []),
            "source_collection_id": profile["source_collection_id"],
            "biophysical_source_id": profile["biophysical_source_id"],
        })
    scenarios = {
        item["scenario_id"]: item for item in (spatial or {}).get("scenarios", {}).values()
    }
    seen = set()
    for case in summary.get("rows", []):
        key = (case["profile_id"], case["scenario_id"])
        if case.get("kind") != "landcover" or key in seen or key[1] not in scenarios:
            continue
        seen.add(key)
        item = scenarios[key[1]]
        statistics = item["statistics"]
        converted = statistics["converted_cells"]
        area = statistics.get("converted_area_ha")
        if type(converted) is not int or converted < 0:
            raise ValueError("Retain actual nonnegative converted-cell counts")
        if sum(value["cells"] for value in statistics.get("transitions", [])) != converted:
            raise ValueError("Scenario transitions differ from its actual converted-cell count")
        if area is not None and (isinstance(area, bool) or not isinstance(area, (int, float))
                                 or not math.isfinite(area) or area < 0):
            raise ValueError("Actual converted area must be finite and nonnegative")
        area_per_cell = (area / converted if converted and area is not None else None)
        rows = tables[key[0]]
        for change in statistics.get("transitions", []):
            old, new, cells = change["from_code"], change["to_code"], change["cells"]
            if type(cells) is not int or cells < 0:
                raise ValueError("Actual scenario transition counts must be nonnegative integers")
            if old not in rows or new not in rows:
                raise ValueError("Actual scenario transition is absent from its retained profile table")
            a, b = rows[old], rows[new]
            n_basis = a.get("load_type_n") is not None and a.get("load_type_n") == b.get("load_type_n")
            p_basis = a.get("load_type_p") is not None and a.get("load_type_p") == b.get("load_type_p")
            transitions.append({
                "profile_id": key[0], "profile": records[key[0]]["title"],
                "scenario_id": key[1], "scenario": item["title"], "run_id": case["run_id"],
                "case_state": case["state"], "from_lucode": old, "to_lucode": new,
                "changed_cells": cells,
                "changed_area_ha": cells * area_per_cell if area_per_cell is not None else None,
                "load_n_before": a.get("load_n"), "load_n_after": b.get("load_n"),
                "load_n_delta": _delta(a.get("load_n"), b.get("load_n")) if n_basis else None,
                "load_basis_n_comparable": n_basis,
                "load_p_before": a.get("load_p"), "load_p_after": b.get("load_p"),
                "load_p_delta": _delta(a.get("load_p"), b.get("load_p")) if p_basis else None,
                "load_basis_p_comparable": p_basis,
                "load_type_n_before": a.get("load_type_n"), "load_type_n_after": b.get("load_type_n"),
                "load_type_p_before": a.get("load_type_p"), "load_type_p_after": b.get("load_type_p"),
                "usle_cp_before": _cp(a), "usle_cp_after": _cp(b),
                "usle_cp_ratio": _ratio(_cp(a), _cp(b)),
                "eff_n_before": a.get("eff_n"), "eff_n_after": b.get("eff_n"),
                "eff_p_before": a.get("eff_p"), "eff_p_after": b.get("eff_p"),
            })
    return {
        "schema": "upstate.study-source-interpretation/v1",
        "experiment_id": summary["id"], "workspace_id": summary["workspace_id"],
        "baseline_profile_id": baseline_id,
        "profiles": profile_rows, "coefficient_changes": changes,
        "native_parameter_changes": parameter_changes, "transitions": transitions,
        "table_sources": list(sources),
        "definitions": {
            "coefficient_changes": "Actual retained profile table cells compared with the experiment's original baseline profile.",
            "transitions": "Actual saved scenario class transitions evaluated with each selected profile's retained coefficients.",
            "load": "Published local loading coefficients and their retained basis, in kg/ha/year. Routed export also depends on runoff and downslope transport.",
            "cp": "Dimensionless local USLE C times P. Native sediment export additionally depends on terrain, erosivity, soil and sediment delivery.",
            "effects": "Completed comparison rows retain the routed annual export and actual paired support; input coefficient ratios are explanatory quantities.",
            "direction": "Coefficient deltas use destination minus source; coefficient ratios use destination divided by source, with zero-source ratios null.",
            "loading_basis": "Load values retain their application-rate or measured-runoff basis. Numeric load deltas and ratios are null when the two bases differ or are unknown.",
        },
    }


def collect(workspace, summary, *, profiles=None):
    if profiles and (profiles.get("workspace_id") != summary["workspace_id"]
                     or profiles.get("baseline_profile_id") != summary["baseline"]["profile_id"]):
        raise ValueError("Select this experiment's retained source-profile programme")
    ids = list(dict.fromkeys([summary["baseline"]["profile_id"]]
        + list(summary.get("selection", {}).get("profile_ids", []))
        + [row["profile_id"] for row in summary.get("rows", [])]))
    records, tables, sources = {}, {}, []
    for key in ids:
        record = workspace._get("profiles", key)
        path, _ = workspace.source_file(record["source_collection_id"], record["biophysical_source_id"])
        body = path.read_bytes()
        digest = hashlib.sha256(body).hexdigest()
        if digest != record["table_summary"]["sha256"]:
            raise ValueError("Retained table differs from the selected profile binding")
        records[key], tables[key] = record, _table(body)
        sources.append({
            "profile_id": key, "source_collection_id": record["source_collection_id"],
            "source_id": record["biophysical_source_id"],
            "bytes": len(body), "sha256": digest,
        })
    spatial = (profiles or {}).get("spatial_programme", {})
    if spatial and (spatial.get("workspace_id") != summary["workspace_id"]
                    or spatial.get("grid_id") != summary["grid_id"]):
        raise ValueError("Scenario interpretation must use this experiment's actual workspace and grid")
    return from_profiles(summary, records, tables, spatial=spatial, sources=sources)


def csv_bytes(rows, columns):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        values = {name: row.get(name) for name in columns}
        for name in ("profile", "scenario"):
            if isinstance(values.get(name), str) and values[name].startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
                values[name] = "\'" + values[name]
        writer.writerow(values)
    return stream.getvalue().encode("utf-8")


def coefficient_csv(value):
    return csv_bytes(value["coefficient_changes"], (
        "profile", "lucode", "field", "units", "baseline", "alternative",
        "baseline_basis", "alternative_basis", "comparable_basis", "delta",
        "ratio", "profile_id", "baseline_profile_id"))


def parameter_csv(value):
    return csv_bytes(value["native_parameter_changes"], (
        "profile", "model", "parameter", "baseline", "alternative",
        "profile_id", "baseline_profile_id"))


def transition_csv(value):
    return csv_bytes(value["transitions"], (
        "profile", "scenario", "case_state", "from_lucode", "to_lucode",
        "changed_cells", "changed_area_ha", "load_n_before", "load_n_after", "load_n_delta",
        "load_p_before", "load_p_after", "load_p_delta",
        "load_basis_n_comparable", "load_basis_p_comparable",
        "load_type_n_before", "load_type_n_after", "load_type_p_before", "load_type_p_after",
        "usle_cp_before", "usle_cp_after", "usle_cp_ratio",
        "eff_n_before", "eff_n_after", "eff_p_before", "eff_p_after",
        "profile_id", "scenario_id", "run_id"))

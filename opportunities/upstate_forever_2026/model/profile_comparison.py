"""Compare retained original biophysical profiles on their declared model scope.

Original CSVs and native model outputs remain under their Workspace identities.
This module reads coefficient/source differences; native execution uses Ensembles.
"""
from __future__ import annotations

from pathlib import Path
import csv
import html
import io
import json
import math
import zipfile

from .common import atomic_bytes, atomic_json, digest, file_digest, held, identifier, selected_models, verify_file
from .profiles import inspect_table

KIND = "profile-comparisons"
NDR_GUIDE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html"
SDR_GUIDE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html"
FIELDS = {
    "load_n": ("ndr", "Nitrogen load", "kg/ha/year"),
    "load_p": ("ndr", "Phosphorus load", "kg/ha/year"),
    "load_type_n": ("ndr", "Nitrogen load definition", "category"),
    "load_type_p": ("ndr", "Phosphorus load definition", "category"),
    "eff_n": ("ndr", "Maximum nitrogen retention efficiency", "fraction"),
    "eff_p": ("ndr", "Maximum phosphorus retention efficiency", "fraction"),
    "crit_len_n": ("ndr", "Nitrogen retention length", "m"),
    "crit_len_p": ("ndr", "Phosphorus retention length", "m"),
    "proportion_subsurface_n": ("ndr", "Nitrogen subsurface fraction", "fraction"),
    "usle_c": ("sdr", "USLE cover factor", "dimensionless"),
    "usle_p": ("sdr", "USLE support-practice factor", "dimensionless"),
    "load_before_runoff_n": ("ndr", "Nitrogen load before runoff adjustment", "kg/ha/year"),
    "load_before_runoff_p": ("ndr", "Phosphorus load before runoff adjustment", "kg/ha/year"),
    "usle_cp": ("sdr", "USLE cover times practice factor", "dimensionless"),
}
DERIVED = {"load_before_runoff_n", "load_before_runoff_p", "usle_cp"}
METHODS = [
    {"id": "ndr-loading", "model": "ndr", "url": NDR_GUIDE,
     "version": "3.20.0", "section": "Data Needs / Biophysical Table",
     "rule": "For application-rate, load before runoff adjustment = load * (1 - eff). For measured-runoff, use load directly."},
    {"id": "ndr-routing", "model": "ndr", "url": NDR_GUIDE,
     "version": "3.20.0", "section": "Nutrient Loads / Nutrient export",
     "rule": "Native execution applies the runoff index and delivery ratios after this coefficient step. Stream export comes from the completed native run."},
    {"id": "sdr-cp", "model": "sdr", "url": SDR_GUIDE,
     "version": "3.20.0", "section": "Model / Data Needs",
     "rule": "C times P is a dimensionless USLE factor. Native sediment export additionally uses terrain, erosivity, erodibility and delivery."},
]


def _number(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _value(row, name):
    value = row.get(name)
    if value is None or str(value).strip() == "":
        return None
    return _number(value) if name in FIELDS and FIELDS[name][2] != "category" else value


def _derived(row, active):
    result = {}
    if "ndr" in active:
        for nutrient in ("n", "p"):
            load = _number(row.get("load_" + nutrient))
            efficiency = _number(row.get("eff_" + nutrient))
            basis = str(row.get("load_type_" + nutrient, "")).strip()
            if load is not None and basis == "measured-runoff":
                result["load_before_runoff_" + nutrient] = load
            elif load is not None and efficiency is not None and basis == "application-rate":
                result["load_before_runoff_" + nutrient] = load * (1 - efficiency)
    if "sdr" in active:
        c, p = _number(row.get("usle_c")), _number(row.get("usle_p"))
        if c is not None and p is not None:
            result["usle_cp"] = c * p
    return result


def _change(before, after):
    if before is None or after is None:
        return {"changed": before != after, "difference": None, "relative_change_percent": None,
                "status": "missing_reference" if before is None else "missing_candidate"}
    a, b = _number(before), _number(after)
    if a is not None and b is not None:
        return {"changed": a != b, "difference": b - a,
                "relative_change_percent": None if a == 0 else 100 * (b - a) / abs(a),
                "status": "same" if a == b else "changed"}
    return {"changed": before != after, "difference": None, "relative_change_percent": None,
            "status": "same" if before == after else "changed"}


def field_catalog():
    return [{"id": name, "model": model, "title": title, "units": units,
             "derived": name in DERIVED, "reference": NDR_GUIDE if model == "ndr" else SDR_GUIDE}
            for name, (model, title, units) in FIELDS.items()]


class ProfileComparisons:
    def __init__(self, workspace):
        self.workspace = workspace

    def catalog(self):
        ws = self.workspace
        overview = ws.overview()
        profiles = []
        for entry in overview.get("profiles", []):
            value = ws._get("profiles", identifier(entry["id"]))
            profiles.append({key: value.get(key) for key in (
                "id", "title", "references", "scientific_status", "table_summary",
                "source_collection_id", "biophysical_source_id")} | {"models": selected_models(value)})
        return {"schema": "upstate.profile-comparison-catalog/v1",
                "workspace_id": ws.project["id"], "profiles": profiles,
                "grids": overview.get("grids", []), "scenarios": overview.get("scenarios", []),
                "comparisons": self.list(), "fields": field_catalog(), "methods": METHODS}

    def _profile(self, key):
        ws = self.workspace
        profile = ws._get("profiles", identifier(key))
        active = selected_models(profile)
        path, entry = ws.source_file(profile["source_collection_id"], profile["biophysical_source_id"])
        table = inspect_table(path, selected_models=active)
        actual_sha = file_digest(path)
        if actual_sha != profile["table_summary"]["sha256"] or actual_sha != entry["body"]["sha256"]:
            raise ValueError("The original biophysical source differs from the retained profile.")
        rows = {str(int(row["lucode"])): {name: row.get(name) for name in table["columns"]}
                for row in table["rows"]}
        return {"id": key, "title": profile["title"], "models": active,
                "profile": profile, "source": entry,
                "table": {"sha256": actual_sha, "bytes": Path(path).stat().st_size,
                          "columns": table["columns"], "rows": rows,
                          "lucodes": table["lucodes"]}}

    def preview(self, selection):
        if not isinstance(selection, dict):
            raise ValueError("Choose a source-profile comparison object.")
        reference_id = identifier(selection["reference_profile_id"])
        candidates = selection.get("candidate_profile_ids")
        if not isinstance(candidates, list) or not candidates:
            raise ValueError("Choose at least one other retained source profile.")
        candidates = [identifier(key) for key in candidates]
        if reference_id in candidates or len(candidates) != len(set(candidates)):
            raise ValueError("Choose distinct reference and candidate profiles.")
        title = selection.get("title")
        if not isinstance(title, str) or not title.strip():
            raise ValueError("Name this source-profile comparison.")
        grid_id = selection.get("grid_id") or None
        grid = self.workspace.get_grid(identifier(grid_id)) if grid_id else None
        counts = {}
        coverage = None
        if grid is not None:
            raw_counts = grid["inputs"]["NLCD"].get("class_counts")
            if not isinstance(raw_counts, dict):
                raise ValueError("The selected grid lacks its retained aligned land-cover class counts.")
            for code, count in raw_counts.items():
                key = str(int(code))
                if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                    raise ValueError("A retained land-cover class count is invalid.")
                counts[key] = count
            definition = grid["grid"]
            coverage = {
                "grid_id": grid_id, "models": selected_models(grid["spec"]),
                "class_counts": counts, "valid_cells": sum(counts.values()),
                "scope": "All valid NLCD cells in the aligned rectangular prepared grid",
                "reporting_mask_applied": False,
                "grid_definition": {key: definition.get(key) for key in
                                    ("crs_name", "resolution_m", "pixel_area_ha", "width", "height", "bounds")},
                "nlcd_source": grid["inputs"]["NLCD"],
                "nlcd_artifact": grid["files"]["NLCD"],
            }
        profiles = [self._profile(key) for key in [reference_id] + sorted(candidates)]
        reference = profiles[0]
        all_codes = sorted({int(code) for profile in profiles for code in profile["table"]["rows"]} |
                           {int(code) for code in counts})
        fields = [name for name in FIELDS if name in DERIVED or
                  any(name in profile["table"]["columns"] for profile in profiles)]
        coefficient_rows, parameter_rows, contrasts = [], [], []
        for candidate in profiles[1:]:
            shared_models = [name for name in reference["models"] if name in candidate["models"]]
            missing = {}
            for profile in (reference, candidate):
                absent = [code for code in counts if code not in profile["table"]["rows"] and counts[code] > 0]
                missing[profile["id"]] = {"lucodes": sorted(map(int, absent)),
                                         "cells": sum(counts[code] for code in absent)}
            changed_codes, basis_changes = set(), set()
            for code in all_codes:
                key = str(code)
                before = reference["table"]["rows"].get(key, {})
                after = candidate["table"]["rows"].get(key, {})
                before_values = {name: _value(before, name) for name in fields if name not in DERIVED}
                after_values = {name: _value(after, name) for name in fields if name not in DERIVED}
                before_values.update(_derived(before, reference["models"]))
                after_values.update(_derived(after, candidate["models"]))
                for name in fields:
                    model, label, units = FIELDS[name]
                    a, b = before_values.get(name), after_values.get(name)
                    if a is None and b is None:
                        continue
                    change = _change(a, b)
                    model_active = model in shared_models
                    basis_same = True
                    if name in ("load_n", "load_p"):
                        nutrient = name[-1]
                        basis_same = str(before.get("load_type_" + nutrient) or "").strip() == str(after.get("load_type_" + nutrient) or "").strip()
                        if not basis_same:
                            change.update(changed=True, difference=None, relative_change_percent=None, status="definition_changed")
                    if change["changed"] and model_active:
                        changed_codes.add(code)
                    if name in ("load_type_n", "load_type_p") and change["changed"] and model_active:
                        basis_changes.add(code)
                    coefficient_rows.append({
                        "reference_profile_id": reference_id, "candidate_profile_id": candidate["id"],
                        "lucode": code, "reference_description": before.get("description") or before.get("name"),
                        "candidate_description": after.get("description") or after.get("name"),
                        "field": name, "title": label, "model": model, "units": units,
                        "reference_value": a, "candidate_value": b,
                        **change, "model_active_in_both": model_active,
                        "load_definition_matches": basis_same,
                        "derived": name in DERIVED, "prepared_grid_cells": counts.get(key) if grid else None,
                    })
            parameter_changes = 0
            for model in ("ndr", "sdr"):
                a_values, b_values = reference["profile"].get(model, {}), candidate["profile"].get(model, {})
                for field in sorted(set(a_values) | set(b_values)):
                    a, b = a_values.get(field), b_values.get(field)
                    change = _change(a, b)
                    if change["changed"] and model in shared_models:
                        parameter_changes += 1
                    parameter_rows.append({
                        "reference_profile_id": reference_id, "candidate_profile_id": candidate["id"],
                        "model": model, "field": field, "reference_value": a, "candidate_value": b,
                        **change, "model_active_in_both": model in shared_models,
                    })
            runnable = shared_models
            if grid:
                runnable = [model for model in shared_models if model in coverage["models"]]
                if any(value["cells"] for value in missing.values()):
                    runnable = []
            contrasts.append({
                "candidate_profile_id": candidate["id"], "shared_models": shared_models,
                "study_models": runnable, "missing_grid_codes": missing,
                "changed_lucodes": sorted(changed_codes), "load_definition_changed_lucodes": sorted(basis_changes),
                "changed_prepared_grid_cells": sum(counts.get(str(code), 0) for code in changed_codes) if grid else None,
                "changed_parameter_count": parameter_changes,
                "same_table_bytes": reference["table"]["sha256"] == candidate["table"]["sha256"],
            })
        selected_ids = {profile["id"] for profile in profiles}
        native_runs = []
        for row in self.workspace.overview().get("runs", []):
            run = self.workspace.inspect_run(identifier(row["id"]))
            original = run["selection"]
            if original["profile_id"] not in selected_ids or (grid_id and original["grid_id"] != grid_id):
                continue
            native_runs.append({
                "id": run["id"], "state": run["state"], "selection": original,
                "model_scope": run.get("model_scope"), "completed_at": run.get("completed_at"),
                "artifacts": {name: {key: item.get(key) for key in
                                    ("sha256", "bytes", "units", "sum", "sum_units", "valid_cells")}
                              for name, item in run.get("artifacts", {}).items()
                              if name in ("nitrogen_export", "phosphorus_export", "sediment_export")},
            })
        return {
            "schema": "upstate.profile-comparison-preview/v1", "title": title.strip(),
            "workspace_id": self.workspace.project["id"],
            "selection": {"title": title.strip(), "reference_profile_id": reference_id,
                          "candidate_profile_ids": sorted(candidates), "grid_id": grid_id},
            "invest_version": "3.20.0", "profiles": profiles, "coverage": coverage,
            "contrasts": contrasts, "coefficients": coefficient_rows, "parameters": parameter_rows,
            "native_runs": sorted(native_runs, key=lambda row: row["id"]),
            "fields": field_catalog(), "methods": METHODS,
            "difference_direction": "candidate minus reference",
            "interpretation": [
                "Original code numbers are compared exactly; source descriptions remain beside both values.",
                "Load-definition changes are shown separately from raw coefficient differences.",
                "Prepared-grid counts describe the aligned input rectangle. Saved native artifacts retain their own valid output cells.",
                "Parameter and coefficient changes are separate. Completed native studies provide the resulting routed annual effects.",
            ],
        }

    def create(self, selection):
        return self.workspace._save(KIND, self.preview(selection))

    def inspect(self, key):
        return self.workspace._get(KIND, identifier(key))

    def list(self):
        result = []
        for path in sorted((self.workspace.root / KIND).glob("*.json")):
            value = self.inspect(path.stem)
            result.append({"id": value["id"], "title": value["title"],
                           "profile_count": len(value["profiles"]),
                           "grid_id": value["selection"]["grid_id"]})
        return result

    def study_selection(self, key, candidate_ids=None):
        record = self.inspect(key)
        candidates = record["selection"]["candidate_profile_ids"] if candidate_ids is None else candidate_ids
        if not isinstance(candidates, list) or not candidates or len(candidates) != len(set(candidates)):
            raise ValueError("Choose distinct candidate profiles from this retained comparison.")
        by_id = {row["candidate_profile_id"]: row for row in record["contrasts"]}
        if any(identifier(value) not in by_id for value in candidates):
            raise ValueError("The selected source profile belongs to another comparison.")
        active = {"ndr", "sdr"}
        for value in candidates:
            active &= set(by_id[value]["study_models"])
        if not active:
            raise ValueError("Choose source profiles with shared model scope and full selected-grid land-cover coverage.")
        return {
            "grid_id": record["selection"]["grid_id"],
            "base_profile_ids": [record["selection"]["reference_profile_id"]] + sorted(candidates),
            "models": [name for name in ("ndr", "sdr") if name in active],
            "title": record["title"] + " — native source-profile study",
            "reason": "Compare the retained source alternatives from profile comparison " + record["id"] +
                      " using the same actual grid, scenarios and native study.",
        }

    def export(self, key):
        record = self.inspect(key)
        root = self.workspace.root / "profile-comparison-reports" / record["id"]
        root.mkdir(parents=True, exist_ok=True)
        with held(root / ".export.lock"):
            files = _report_files(record)
            for profile in record["profiles"]:
                original = profile["profile"]
                path, _ = self.workspace.source_file(original["source_collection_id"], original["biophysical_source_id"])
                if file_digest(path) != profile["table"]["sha256"]:
                    raise ValueError("A retained original table changed before export.")
                files["original-tables/" + profile["id"] + ".csv"] = Path(path).read_bytes()
                for body in [profile["source"]["body"]] + profile["source"].get("companions", []):
                    name = body.get("view_path", body["filename"])
                    member = Path(name)
                    if member.is_absolute() or ".." in member.parts or member.as_posix() != name or "\\" in name:
                        raise ValueError("An original source companion has an invalid relative name.")
                    original_path = verify_file(self.workspace.root, {
                        "path": body["object"], "bytes": body["bytes"], "sha256": body["sha256"]})
                    files["original-sources/" + profile["id"] + "/" + name] = original_path.read_bytes()

            for name, body in files.items():
                atomic_bytes(root / name, body)
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as out:
                for name in sorted(files):
                    item = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                    item.compress_type = zipfile.ZIP_DEFLATED
                    item.external_attr = 0o100644 << 16
                    out.writestr(item, files[name])
            atomic_bytes(root / "profile-comparison.zip", archive.getvalue())
            names = sorted([*files, "profile-comparison.zip"])
            manifest = {"schema": "upstate.profile-comparison-release/v1", "id": record["id"],
                        "comparison_id": record["id"], "files": {
                            name: {"path": name, "bytes": (root / name).stat().st_size,
                                   "sha256": file_digest(root / name)}
                            for name in names}}
            atomic_json(root / "release.json", manifest)
            return manifest


def _csv(rows, fields):
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(fields)
    for row in rows:
        values = []
        for name in fields:
            value = row.get(name)
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False, sort_keys=True)
            if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
                value = "'" + value
            values.append("" if value is None else value)
        writer.writerow(values)
    return out.getvalue().encode("utf-8")


def _report_files(record):
    def escaped(value):
        if value is None:
            return "—"
        if isinstance(value, (dict, list)):
            value = json.dumps(value, ensure_ascii=False, sort_keys=True)
        return html.escape(str(value), quote=True)
    def table(rows, fields):
        return "<table><thead><tr>" + "".join("<th>" + escaped(name) + "</th>" for name in fields) + \
               "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + escaped(row.get(name)) + "</td>" for name in fields) + "</tr>" for row in rows) + "</tbody></table>"
    profiles = record["profiles"]
    names = {value["id"]: value["title"] for value in profiles}
    coefficient_rows = [{**row, "candidate": names[row["candidate_profile_id"]]} for row in record["coefficients"]]
    parameter_rows = [{**row, "candidate": names[row["candidate_profile_id"]]} for row in record["parameters"]]
    coefficient_fields = ("candidate", "lucode", "reference_description", "candidate_description", "field", "units",
                          "reference_value", "candidate_value", "difference", "relative_change_percent",
                          "status", "model_active_in_both", "load_definition_matches", "derived", "prepared_grid_cells")
    parameter_fields = ("candidate", "model", "field", "reference_value", "candidate_value",
                        "difference", "relative_change_percent", "status", "model_active_in_both")
    report = ['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
              "<title>" + escaped(record["title"]) + "</title>",
              "<style>body{font:15px/1.5 system-ui;color:#202020;background:#fff;max-width:1400px;margin:32px auto;padding:0 20px}h1,h2,h3{line-height:1.2}table{border-collapse:collapse;width:100%;margin:16px 0;font-size:12px}th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}code{overflow-wrap:anywhere}section{overflow-x:auto}a{color:#333}@media print{body{max-width:none;margin:0;font-size:10px}thead{display:table-header-group}tr{break-inside:avoid}}</style>",
              "<h1>" + escaped(record["title"]) + "</h1><p>Reference: <strong>" + escaped(profiles[0]["title"]) +
              "</strong>. Difference direction: candidate minus reference. InVEST 3.20.0.</p>",
              "<p>Saved comparison <code>" + escaped(record["id"]) + "</code>.</p>"]
    report.extend("<p>" + escaped(value) + "</p>" for value in record["interpretation"])
    report.append("<h2>Original source profiles</h2>")
    for value in profiles:
        original = value["profile"]
        report.extend(["<h3>" + escaped(value["title"]) + "</h3>",
                       "<p>Models: " + escaped(value["models"]) + ". Source table SHA256: <code>" +
                       value["table"]["sha256"] + "</code>.</p>",
                       "<p>Scientific status: " + escaped(original.get("scientific_status")) + "</p>",
                       "<p>References: " + escaped(original.get("references")) + "</p>",
                       '<p><a href="original-tables/' + value["id"] + '.csv">Download original CSV</a></p>'])
    if record["coverage"]:
        coverage = record["coverage"]
        report.extend(["<h2>Prepared input coverage</h2><p>" + escaped(coverage["scope"]) +
                       "; reporting mask applied: false.</p>", table(
                           [{"lucode": key, "cells": count} for key, count in coverage["class_counts"].items()],
                           ("lucode", "cells"))])
    report.extend(["<h2>Source contrast summary</h2>", table(record["contrasts"],
                   ("candidate_profile_id", "shared_models", "study_models", "same_table_bytes", "changed_lucodes",
                    "changed_prepared_grid_cells", "changed_parameter_count", "missing_grid_codes")),
                   "<h2>Biophysical coefficients</h2><section>", table(coefficient_rows, coefficient_fields), "</section>",
                   "<h2>Native model parameters</h2><section>", table(parameter_rows, parameter_fields), "</section>",
                   "<h2>Native run snapshot retained with this comparison</h2>", table(record["native_runs"], ("id", "state", "selection", "artifacts")),
                   "<h2>Method references</h2>"])
    report.extend("<p><a href=" + json.dumps(method["url"]) + ">" + escaped(method["section"]) +
                  "</a>: " + escaped(method["rule"]) + "</p>" for method in METHODS)
    report.append("</html>")
    return {
        "index.html": "".join(report).encode("utf-8"),
        "comparison.json": (json.dumps(record, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8"),
        "coefficients.csv": _csv(coefficient_rows, coefficient_fields),
        "parameters.csv": _csv(parameter_rows, parameter_fields),
        "source-profiles.json": (json.dumps(profiles, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8"),
    }

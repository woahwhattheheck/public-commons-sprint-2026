"""Calibration operations and portable results for the original scientific operator."""
from __future__ import annotations

import csv
import html
import io
import json
from pathlib import Path
import zipfile

from model.common import (atomic_bytes, atomic_json, describe_file,
                          held, identifier, read_json, verify_file)
from model import calibration as science

ACTIONS = frozenset({"calibration.prepare", "calibration.analyze", "calibration.export"})
READS = frozenset({"catalog", "plan", "report"})
UNITS = {"nitrogen": "kg/year", "phosphorus": "kg/year", "sediment": "metric_tonnes/year"}
COLUMNS = {
    "ranking": ("rank", "run_id", "profile_id", "title", "selected_models", "available_parameters",
                "objective_score", "status", "reason"),
    "metrics": ("partition", "run_id", "profile_id", "profile_title", "parameter", "units",
                "groups", "n", "rmse", "mean_bias", "nash_sutcliffe_efficiency"),
    "validation": ("partition", "run_id", "profile_id", "parameter", "units",
                   "groups", "n", "rmse", "mean_bias", "nash_sutcliffe_efficiency"),
    "observations": ("partition", "group_id", "catchment_id", "station_ids", "parameter", "units",
                     "observed", "modeled", "native_modeled", "delivered_external_annual_mass", "residual",
                     "periods", "covered_days", "records", "included_in_metrics", "coverage_status", "method"),
    "groups": ("id", "partition", "catchment_ids", "station_ids", "observation_count", "parameters"),
    "envelope": ("parameter", "units", "group_id", "catchment_id", "minimum", "median", "maximum",
                 "candidate_count", "distinct_profile_count", "expected_profiles"),
    "stability": ("group_id", "selected_run_id", "selected_profile_id", "same_as_full_selection",
                  "same_profile_as_full_selection", "objective_score"),
    "exclusions": ("run_id", "observation_id", "catchment_id", "parameter", "reason"),
}
TABLE_TITLES = {"ranking": "Candidate ranking", "metrics": "Calibration fit",
                "validation": "Independent validation", "observations": "Catchment annual reference and modeled load",
                "groups": "Catchment groups", "envelope": "Candidate envelope",
                "stability": "Selection stability", "exclusions": "Retained exclusions"}


def _first(value, *keys):
    for key in keys:
        if key in value:
            return value[key]
    return None


def _rows(value):
    if isinstance(value, list):
        return [row if isinstance(row, dict) else {"value": row} for row in value]
    if isinstance(value, dict):
        return [{"key": key, **row} if isinstance(row, dict) else {"key": key, "value": row}
                for key, row in value.items()]
    return []


def _metrics(value, *, partition, run_id=None, profile_id=None, title=None):
    rows = []
    for metric in _rows(value):
        parameter = _first(metric, "parameter", "pollutant", "key")
        rows.append({**metric, "partition": partition, "run_id": run_id,
                     "profile_id": profile_id, "profile_title": title, "parameter": parameter,
                     "units": metric.get("units", UNITS.get(parameter)),
                     "groups": _first(metric, "spatial_groups", "groups", "group_count", "n_groups"),
                     "n": _first(metric, "catchments", "n", "catchment_count", "unique_catchments"),
                     "rmse": _first(metric, "rmse", "root_mean_squared_error"),
                     "mean_bias": _first(metric, "mean_bias", "bias"),
                     "nash_sutcliffe_efficiency": _first(metric, "nash_sutcliffe_efficiency", "nse")})
    return rows


def _presentation(workspace, plan, report):
    selection = plan["selection"]
    validation_ids = set(selection.get("validation_group_ids", []))
    groups = [{**group, "partition": "validation" if group["id"] in validation_ids else "calibration",
               "observation_count": group["observation_records"]}
              for group in plan["spatial_groups"]["groups"]]
    ranking, metrics, exclusions = [], [], []
    for row in report["ranked_candidates"]:
        ranking.append({**row, "status": "selected" if row["run_id"] == report["selected_run_id"] else "ranked",
                        "reason": None})
        metrics.extend(_metrics(row["pollutant_metrics"], partition="calibration",
                                run_id=row["run_id"], profile_id=row["profile_id"], title=row["title"]))
    candidate_by_run = {row["run_id"]: row for row in plan["candidates"]}
    for failure in report["candidate_failures"]:
        reasons = []
        if failure.get("error"):
            reasons.append(failure["error"])
        if failure.get("missing_units"):
            reasons.append(str(len(failure["missing_units"])) + " catchment/pollutant units have incomplete native support")
        if failure.get("parameters_without_reference"):
            reasons.append("Missing pollutant references: " + ", ".join(failure["parameters_without_reference"]))
        reason = "; ".join(reasons) or failure.get("phase", "Candidate is outside the complete calibration set")
        original = candidate_by_run[failure["run_id"]]
        ranking.append({**original, **failure, "rank": None, "objective_score": None,
                        "status": "excluded", "reason": reason})
        exclusions.append({"run_id": failure["run_id"], "reason": reason, "detail": failure})
        for unit in failure.get("missing_units", []):
            exclusions.append({**unit, "run_id": failure["run_id"],
                               "reason": json.dumps(unit.get("issues", []), ensure_ascii=False, sort_keys=True)})
    validation = report["selected_validation"]
    validation_metrics = _metrics(validation["pollutant_metrics"], partition="validation",
                                  run_id=report["selected_run_id"], profile_id=report["selected_profile_id"])
    references = {unit["id"]: unit for unit in report["reference_units"]}
    observations = []
    for prediction in report["prediction_rows"]:
        if prediction["run_id"] != report["selected_run_id"]:
            continue
        reference = references[prediction["unit_id"]]
        row = {**reference, **prediction, "observed": reference["observed_annual_mass"],
               "modeled": prediction.get("predicted_annual_mass"),
               "native_modeled": prediction.get("native_annual_mass"),
               "records": reference["observation_record_ids"],
               "station_ids": reference["station_ids"], "method": reference["reference_methods"],
               "included_in_metrics": prediction["included"],
               "coverage_status": "complete" if prediction["included"] else "incomplete"}
        observations.append(row)
        if not prediction["included"]:
            exclusions.append({**prediction, "reason": json.dumps(prediction.get("issues", []),
                                                                  ensure_ascii=False, sort_keys=True)})
    for excluded in report["excluded_reference_records"]:
        exclusions.append({**excluded, "observation_id": excluded["observation_record_id"],
                           "reason": "; ".join(map(str, excluded["issues"]))})
    stability = []
    for row in report["group_stability"].get("folds", []):
        selected_run = row.get("selected_run_id")
        stability.append({**row, "group_id": row["held_group_id"], "selected_run_id": selected_run,
                          "same_as_full_selection": selected_run == report["selected_run_id"] if selected_run else None,
                          "same_profile_as_full_selection":
                              row.get("selected_profile_id") == report["selected_profile_id"]
                              if row.get("selected_profile_id") else None,
                          "objective_score": row.get("training_objective_score")})
    notes = [
        "The selected candidate minimizes the retained calibration objective. Validation groups remain outside that selection.",
        "Physical errors retain pollutant-specific annual mass units; normalized objective values are dimensionless.",
        report["temporal_method"],
        "Modeled load includes an explicitly retained delivered external load only when the selection names its original source reference.",
        report["envelope_meaning"],
        report["reference_interpretation"],
    ]
    candidate_count = report.get("candidate_count", len(plan["candidates"]))
    profile_count = report.get("distinct_profile_count",
                               len({row["profile_id"] for row in plan["candidates"]}))
    selected_models = report.get("selected_models", [])
    notes.append(str(candidate_count) + " original candidate runs represent " + str(profile_count) +
                 " distinct parameter profiles. Run variants retain their own modeled outputs and original IDs.")
    notes.extend(selection["notes"])
    return {"title": report["title"], "candidate_count": candidate_count,
            "distinct_profile_count": profile_count, "selected_models": selected_models,
            "predicted_parameters": report.get("predicted_parameters", []), "ranking": ranking, "metrics": metrics,
            "validation": validation_metrics, "validation_state": validation["state"],
            "validation_missing_units": validation.get("missing_units", []),
            "validation_parameters_without_reference": validation.get("parameters_without_reference", []),
            "observations": observations, "groups": groups, "envelope": report["candidate_envelope"],
            "stability": stability, "stability_state": report["group_stability"]["state"],
            "winner_frequencies": report["group_stability"].get("winner_frequencies", []),
            "profile_winner_frequencies": report["group_stability"].get("profile_winner_frequencies", []),
            "exclusions": exclusions, "pareto_run_ids": report["pareto_run_ids"], "notes": notes,
            "normalization": plan["normalization"], "source_vintages": plan["source_vintages"]}


def _cell(value):
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True)
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def _csv_bytes(fields, rows):
    extra = sorted(set().union(*(set(row) for row in rows)) - set(fields)) if rows else []
    fields = tuple(fields) + tuple(extra)
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        writer.writerow({field: _cell(row.get(field)) for field in fields})
    return stream.getvalue().encode("utf-8")


def _display(value):
    if value is None:
        return "—"
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    if isinstance(value, float):
        return format(value, ".9g")
    return str(value)


def _html_table(fields, rows):
    head = "".join("<th>" + html.escape(field.replace("_", " ")) + "</th>" for field in fields)
    body = "".join("<tr>" + "".join("<td>" + html.escape(_display(row.get(field))) + "</td>"
                                    for field in fields) + "</tr>" for row in rows)
    return '<div class="scroll"><table><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>"


def _html_report(view, plan_id, report_id):
    nav = "".join('<a href="#' + key + '">' + html.escape(title) + "</a> "
                  for key, title in TABLE_TITLES.items())
    sections = []
    for key, title in TABLE_TITLES.items():
        sections.append('<section id="' + key + '"><h2>' + html.escape(title) + '</h2><p><a href="'
                        + key + '.csv">Download all ' + str(len(view[key])) + ' rows as CSV</a></p>'
                        + _html_table(COLUMNS[key], view[key]) + "</section>")
    notes = "<ul>" + "".join("<li>" + html.escape(note) + "</li>" for note in view["notes"]) + "</ul>"
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" '
            'content="width=device-width,initial-scale=1"><title>' + html.escape(view["title"]) + '</title>'
            '<style>body{font:15px system-ui,sans-serif;color:#202020;background:#fff;max-width:1200px;'
            'margin:0 auto;padding:32px}h1{font-size:30px}h2{font-size:21px}p,li{line-height:1.5}'
            'a{color:#222;text-decoration:underline}nav{display:flex;gap:14px;flex-wrap:wrap;padding:18px 0;'
            'border-block:1px solid #bbb}section{padding:24px 0;border-bottom:1px solid #bbb}.scroll{overflow:auto}'
            'table{border-collapse:collapse;width:100%}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd;'
            'vertical-align:top}th{background:#f1f1f1;font-size:13px}td{font-variant-numeric:tabular-nums}'
            '.ids{font:12px ui-monospace,monospace;overflow-wrap:anywhere}footer{padding-top:24px}'
            '@media print{body{padding:0;font-size:10px}nav{display:none}section{break-inside:avoid}a{color:#222}}'
            '</style></head><body><header><p>UPPER SAVANNAH · SCIENTIFIC WORKBENCH</p><h1>'
            + html.escape(view["title"]) + '</h1><p>Completed baseline parameter profiles compared with the '
            'original annual loads and retained catchment groups.</p><p><a href="report.json">Complete analysis JSON</a> · '
            '<a href="selection.json">Original calibration selection</a> · <a href="manifest.json">File inventory</a>'
            '</p></header><nav>' + nav + "</nav>" + "".join(sections)
            + "<section><h2>Interpretation</h2>" + notes + "</section><footer><p class=\"ids\">Selection "
            + html.escape(plan_id) + "<br>Analysis " + html.escape(report_id) + "</p></footer></body></html>")


class CalibrationOperations:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _id(self, value, name):
        try:
            return identifier(value.get(name))
        except (ValueError, TypeError) as error:
            raise self.Fault("CALIBRATION_SELECTION", "Choose the retained " + name.replace("_", " ") + ".") from error

    def _document(self, workspace, kind, key, label):
        ws = self.operator.ws(workspace)
        ws._get(kind, key)
        path = ws.root / kind / (key + ".json")
        expected = describe_file(ws.root, path)
        return self.operator._ticket(workspace, path, expected, label)

    def state(self, workspace):
        ws = self.operator.ws(workspace)
        plans = []
        for plan in ws._list("calibration-plans"):
            state = science.inspect(ws, plan["id"])
            selection = plan["selection"]
            plans.append({"id": plan["id"], "title": selection["title"], "state": state["state"],
                          "created_at": plan.get("created_at"), "result_id": state.get("result_id"),
                          "candidate_count": len(selection["candidate_run_ids"]),
                          "distinct_profile_count": plan.get("distinct_profile_count",
                              len({row["profile_id"] for row in plan.get("candidates", [])})),
                          "predicted_parameters": plan.get("predicted_parameters", []),
                          "calibration_groups": len(selection.get("calibration_group_ids", [])),
                          "validation_groups": len(selection.get("validation_group_ids", [])),
                          "selection": selection})
        reports = [{"id": row["id"], "plan_id": row["plan_id"], "title": row.get("title"),
                    "selected_run_id": row.get("selected_run_id"), "selected_profile_id": row.get("selected_profile_id"),
                    "created_at": row.get("created_at"), "state": row.get("state", "complete")}
                   for row in ws._list("calibrations")]
        return {"calibration_plans": plans, "calibrations": reports}

    def read(self, workspace, operation, value=None):
        value = value or {}
        ws = self.operator.ws(workspace)
        if operation == "preview":
            selection = value.get("selection")
            if not isinstance(selection, dict):
                raise self.Fault("CALIBRATION_SELECTION", "Supply the original calibration selection.")
            return self.preview(workspace, selection)
        if operation == "catalog":
            return {"workspace_key": workspace, **science.catalog(ws)}
        if operation == "plan":
            key = self._id(value, "id")
            return {"workspace_key": workspace, "plan": ws._get("calibration-plans", key),
                    "progress": science.inspect(ws, key),
                    "_downloads": [self._document(workspace, "calibration-plans", key, "Original calibration selection")]}
        if operation == "report":
            key = self._id(value, "id")
            report = ws._get("calibrations", key)
            plan = ws._get("calibration-plans", report["plan_id"])
            downloads = [self._document(workspace, "calibrations", key, "Complete calibration results"),
                         self._document(workspace, "calibration-plans", report["plan_id"], "Original calibration selection")]
            manifest_path = ws.root / "calibration-exports" / key / "manifest.json"
            if manifest_path.exists():
                downloads.extend(self._export_downloads(workspace, key))
            return {"workspace_key": workspace, "report": report, "plan": plan,
                    "view": _presentation(ws, plan, report), "_downloads": downloads}
        raise self.Fault("CALIBRATION_READ", "Choose a supported calibration view.", 404)

    def preview(self, workspace, selection):
        ws = self.operator.ws(workspace)
        gate = self.operator.gates[workspace]
        if not gate.acquire(blocking=False):
            raise self.Fault("NATIVE_BUSY", "The current model operation is using this workspace. "
                             "Inspect calibration catchments after it finishes.", 409)
        try:
            return {"workspace_key": workspace, **science.preview(ws, selection)}
        finally:
            gate.release()

    def invoke(self, task):
        workspace, payload = task["workspace"], task["payload"]
        ws = self.operator.ws(workspace)
        if task["action"] == "calibration.prepare":
            plan = science.prepare(ws, payload["selection"])
            return {"plan_id": plan["id"], "plan": plan}
        if task["action"] == "calibration.analyze":
            plan_id = self._id(payload, "plan_id")
            report = science.analyze(ws, plan_id)
            if report["state"] != "complete":
                raise self.Fault("CALIBRATION_NO_ELIGIBLE_CANDIDATE",
                                 "No candidate has complete calibration support. The retained result "
                                 + report["id"] + " records each candidate outcome; open the selection to inspect it.", 422)
            return {"plan_id": plan_id, "report_id": report["id"],
                    "selected_run_id": report["selected_run_id"], "selected_profile_id": report["selected_profile_id"]}
        if task["action"] == "calibration.export":
            return self._export(workspace, self._id(payload, "report_id"))
        raise self.Fault("CALIBRATION_ACTION", "Choose a supported calibration operation.")

    def _export(self, workspace, report_id):
        ws = self.operator.ws(workspace)
        report = ws._get("calibrations", report_id)
        plan_id = report["plan_id"]
        plan = ws._get("calibration-plans", plan_id)
        directory = ws.root / "calibration-exports" / report_id
        directory.mkdir(parents=True, exist_ok=True)
        manifest_path = directory / "manifest.json"
        archive_path = directory / "calibration-results.zip"
        archive_record = directory / "archive.json"
        with held(directory / ".export.lock", blocking=False):
            if manifest_path.exists() and archive_record.exists():
                manifest = read_json(manifest_path)
                if (manifest.get("report_id") != report_id or manifest.get("plan_id") != plan_id
                        or manifest.get("workspace_id") != ws.project["id"]):
                    raise ValueError("The retained result package belongs to a different calibration")
                for expected in manifest["files"].values():
                    verify_file(directory, expected)
                archive_item = read_json(archive_record)
                verify_file(directory, archive_item)
                return {"report_id": report_id, "plan_id": plan_id,
                        "archive": archive_item, "files": manifest["files"]}
            view = _presentation(ws, plan, report)
            atomic_bytes(directory / "report.json", (ws.root / "calibrations" / (report_id + ".json")).read_bytes(),
                         immutable=True)
            atomic_bytes(directory / "selection.json", (ws.root / "calibration-plans" / (plan_id + ".json")).read_bytes(),
                         immutable=True)
            for key, fields in COLUMNS.items():
                atomic_bytes(directory / (key + ".csv"), _csv_bytes(fields, view[key]), immutable=True)
            atomic_bytes(directory / "index.html", _html_report(view, plan_id, report_id).encode("utf-8"), immutable=True)
            names = ["report.json", "selection.json", "index.html"] + [key + ".csv" for key in COLUMNS]
            files = {name: describe_file(directory, directory / name) for name in names}
            manifest = {"schema": "upstate.calibration-export/v1", "workspace_id": ws.project["id"],
                        "report_id": report_id, "plan_id": plan_id, "title": view["title"],
                        "files": files, "content": "Original calibration and observation results",
                        "reading": "Open index.html; complete scientific records remain in report.json and selection.json"}
            atomic_json(manifest_path, manifest, immutable=True)
            pending = directory / ".calibration-results.pending"
            pending.unlink(missing_ok=True)
            try:
                with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                    for name in names + ["manifest.json"]:
                        archive.write(directory / name, name)
                with pending.open("rb") as stream:
                    import os
                    os.fsync(stream.fileno())
                pending.replace(archive_path)
            finally:
                pending.unlink(missing_ok=True)
            archive_item = describe_file(directory, archive_path)
            atomic_json(archive_record, archive_item, immutable=True)
            return {"report_id": report_id, "plan_id": plan_id,
                    "archive": archive_item, "files": files}

    def _export_downloads(self, workspace, report_id):
        ws = self.operator.ws(workspace)
        directory = ws.root / "calibration-exports" / report_id
        manifest = read_json(directory / "manifest.json")
        if manifest.get("report_id") != report_id or manifest.get("workspace_id") != ws.project["id"]:
            raise ValueError("The result package belongs to another original calibration")
        downloads = []
        archive_record = directory / "archive.json"
        if archive_record.exists():
            expected = read_json(archive_record)
            archive = verify_file(directory, expected)
            downloads.append(self.operator._ticket(workspace, archive, expected,
                                                   "Complete calibration results ZIP"))
        for name, expected in manifest["files"].items():
            path = verify_file(directory, expected)
            downloads.append(self.operator._ticket(workspace, path, expected,
                                                   TABLE_TITLES.get(name.removesuffix(".csv"), name)))
        return downloads

    def decorate_task(self, task):
        if task["state"] != "complete" or task["action"] not in ACTIONS:
            return task
        result = task.get("result", {})
        downloads = []
        if result.get("plan_id"):
            downloads.append(self._document(task["workspace"], "calibration-plans",
                                            result["plan_id"], "Original calibration selection"))
        if result.get("report_id"):
            downloads.append(self._document(task["workspace"], "calibrations",
                                            result["report_id"], "Complete calibration results"))
        if task["action"] == "calibration.export":
            downloads.extend(self._export_downloads(task["workspace"], result["report_id"]))
        return {**task, "_downloads": downloads}

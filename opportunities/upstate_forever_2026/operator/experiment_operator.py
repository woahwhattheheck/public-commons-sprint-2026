"""Scenario experiments on the existing operator queue and retained workspace."""
from __future__ import annotations

import contextlib
import html
import json
import math
import os
from pathlib import Path
import re
import tempfile

from model import experiments
from model.common import atomic_json, digest, file_digest, held, now, read_json

ACTIONS = {"experiment.save", "experiment.run", "experiment.summarize"}
READS = {"catalog", "inspect", "summary", "axes", "methods"}
POLLUTANTS = (
    ("nitrogen_export", "Nitrogen"),
    ("phosphorus_export", "Phosphorus"),
    ("sediment_export", "Sediment"),
)


def _id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("Choose a saved experiment.")
    return value


def _integer(value, default, minimum=0, maximum=None):
    if value is None:
        return default
    if isinstance(value, bool) or not re.fullmatch(r"[0-9]+", str(value)):
        raise ValueError("Use a nonnegative whole number for the result page.")
    result = int(value)
    if result < minimum or (maximum is not None and result > maximum):
        raise ValueError("The requested result page is outside the supported range.")
    return result


def _exact_counts(value):
    result = dict(value)
    for name in ("counts", "progress"):
        if isinstance(result.get(name), dict):
            result[name + "_exact"] = {key: str(item) for key, item in result[name].items()
                                      if type(item) is int}
    for name in ("total_cases", "offset", "limit", "next_offset"):
        if type(result.get(name)) is int:
            result[name + "_exact"] = str(result[name])
    return result


def _text(value):
    return html.escape(str(value if value is not None else ""), quote=True)


def _number(value):
    if isinstance(value, bool):
        return "—"
    if type(value) is int:
        return format(value, ",d")
    if not isinstance(value, float) or not math.isfinite(value):
        return "—"
    return format(value, ",.6g")


def _error(value):
    if isinstance(value, dict):
        return value.get("message") or value.get("type") or json.dumps(value, ensure_ascii=False)
    return str(value or "")


def _native_provenance_report(summary):
    """Explain retained original sources and producing versions without run IO."""
    rows = summary.get("rows", [])
    selection = summary.get("selection") or {}
    selected = selection.get("source_run_ids", [])
    bindings, versions, policies = {}, {}, set()
    for row in rows:
        case_id = row.get("id", "")
        for field, role in (("native_source", "Result"),
                            ("native_baseline_source", "Paired baseline")):
            binding = row.get(field)
            if not isinstance(binding, dict):
                continue
            token = json.dumps(binding, ensure_ascii=False, sort_keys=True)
            item = bindings.setdefault(token, {"source": binding, "uses": set()})
            item["uses"].add((str(case_id), role))
        cohort = row.get("native_versions")
        if not isinstance(cohort, dict):
            continue
        if cohort.get("policy"):
            policies.add(str(cohort["policy"]))
        for run_id, models in (cohort.get("runs") or {}).items():
            for model, info in models.items():
                role = ("Reference" if run_id == row.get("run_id") == row.get("baseline_run_id")
                        else "Paired baseline" if run_id == row.get("baseline_run_id") else "Result")
                token = (str(run_id), str(model),
                         json.dumps(info, ensure_ascii=False, sort_keys=True))
                item = versions.setdefault(token, {
                    "run_id": run_id, "model": model, "info": info, "uses": set()})
                item["uses"].add((str(case_id), role))
    if not selected and not bindings and not versions:
        return ""
    pieces = [
        '<h2>Original native sources and execution</h2>',
        '<p>This register uses the source bindings and producing-model metadata saved with these '
        'experiment cases. It preserves each original native run and its requested selection. '
        'The current selection address identifies the same grid, profile, scenario and models '
        'under the current requested version. Adoption reuses the original completed outputs.</p>',
    ]
    if selected:
        pieces.append('<details><summary>Selected original run cohort</summary><ul>' +
                      ''.join('<li><code>' + _text(run_id) + '</code></li>' for run_id in selected) +
                      '</ul></details>')
    if bindings:
        pieces.append('<h3>Retained original output bindings</h3>')
        for item in sorted(bindings.values(), key=lambda value: (
                str(value["source"].get("run_id")), str(value["source"].get("canonical_run_id")))):
            source = item["source"]
            original = source.get("selection") or {}
            producing = source.get("producing_versions") or {}
            pieces.append(
                '<section><h4>Original run <code>' + _text(source.get("run_id")) + '</code></h4>'
                '<p>Current selection address <code>' + _text(source.get("canonical_run_id")) +
                '</code><br>Requested native version: <code>' + _text(original.get("invest_version") or "Not recorded") +
                '</code><br>Retained producing versions: ' +
                '; '.join(_text(str(model).upper()) + ' <code>' + _text(version) + '</code>'
                          for model, version in producing.items()) + '</p>')
            pieces.append('<div class="scroll"><table><caption>Original output descriptors</caption>'
                          '<thead><tr><th>Output</th><th>Units</th><th>Bytes</th><th>SHA-256</th>'
                          '<th>Original run-relative path</th></tr></thead><tbody>')
            for name, artifact in (source.get("artifacts") or {}).items():
                pieces.append('<tr><th scope="row">' + _text(name) + '</th><td>' +
                              _text(artifact.get("units") or "Not recorded") + '</td><td class="num">' +
                              _number(artifact.get("bytes")) + '</td><td><code>' +
                              _text(artifact.get("sha256")) + '</code></td><td><code>' +
                              _text(artifact.get("path")) + '</code></td></tr>')
            pieces.append('</tbody></table></div><details><summary>Original selection and source binding</summary>'
                          '<pre>' + _text(json.dumps(source, ensure_ascii=False, indent=2, sort_keys=True)) +
                          '</pre></details><details><summary>Cases using these outputs</summary><ul>' +
                          ''.join('<li>' + _text(role) + ' · <code>' + _text(case_id) + '</code></li>'
                                  for case_id, role in sorted(item["uses"])) + '</ul></details></section>')
    if versions:
        labels = {
            "completed_stage_runtime": "Recorded on the completed model stage",
            "observed_run_fallback": "Observed run runtime; completed-stage version unavailable",
            "observed_runtime": "Observed run runtime",
            "requested_legacy": "Requested version retained by a legacy record",
            "unavailable": "No version recorded",
        }
        pieces.append('<h3>Producing model versions</h3><p>A completed stage takes precedence over '
                      'the observed run runtime. A requested-only legacy record is labelled explicitly. '
                      'NDR and SDR retain separate version records and source histories.</p>')
        if policies:
            pieces.append('<p>Retained comparison policy: ' +
                          '; '.join('<code>' + _text(policy) + '</code>' for policy in sorted(policies)) +
                          '.</p>')
        pieces.append('<div class="scroll"><table><thead><tr><th>Original run / model</th>'
                      '<th>Producing version</th><th>Version source</th><th>Requested version</th>'
                      '<th>Observed run version</th><th>Stage completed</th><th>Retained record</th>'
                      '</tr></thead><tbody>')
        for item in sorted(versions.values(), key=lambda value: (
                str(value["run_id"]), str(value["model"]),
                json.dumps(value["info"], sort_keys=True))):
            info = item["info"]
            pieces.append(
                '<tr><td><code>' + _text(item["run_id"]) + '</code><br>' +
                _text(str(item["model"]).upper()) + '</td><td>' +
                _text(info.get("comparison_version") or "Not recorded") + '</td><td>' +
                _text(labels.get(info.get("basis"), info.get("basis") or "Not recorded")) +
                '</td><td>' + _text(info.get("requested_version") or "Not recorded") +
                '</td><td>' + _text(info.get("observed_run_version") or "Not recorded") +
                '</td><td>' + _text(info.get("stage_completed_at") or "Not recorded") +
                '</td><td><details><summary>Execution source and reuse</summary><pre>' +
                _text(json.dumps(info, ensure_ascii=False, indent=2, sort_keys=True)) +
                '</pre></details><details><summary>Case uses</summary><ul>' +
                ''.join('<li>' + _text(role) + ' · <code>' + _text(case_id) + '</code></li>'
                        for case_id, role in sorted(item["uses"])) +
                '</ul></details></td></tr>')
        pieces.append('</tbody></table></div>')
    else:
        pieces.append('<p>Per-model execution metadata was not recorded for these retained cases. '
                      'The register preserves the available original source bindings.</p>')
    return "".join(pieces)


def render_report(summary):
    """Readable offline report; figures use the same retained paired-mass rows."""
    rows = summary.get("rows", [])
    progress = summary.get("progress", {})
    pieces = [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="color-scheme" content="light">',
        '<title>' + _text(summary.get("title", "Scenario experiment")) + '</title>',
        '<style>body{font:15px/1.55 system-ui,sans-serif;color:#202326;background:#fff;'
        'max-width:1280px;margin:36px auto;padding:0 24px}h1{font-size:30px;line-height:1.2}'
        'h2{font-size:21px;margin-top:32px}p{max-width:90ch}.muted{color:#525a61}'
        'table{width:100%;border-collapse:collapse;font-size:13px;margin:16px 0}'
        'th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #d5d8db}'
        'th{background:#f0f1f2}td.num{font-variant-numeric:tabular-nums;white-space:nowrap}'
        'code{overflow-wrap:anywhere;font-size:11px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}'
        '.scroll{overflow:auto}.meta{display:flex;gap:24px;flex-wrap:wrap}'
        '.notice{border:1px solid #bfc5cb;background:#f5f6f7;padding:12px}'
        '@media print{body{margin:0;max-width:none;padding:0;font-size:10pt}'
        'thead{display:table-header-group}tr{break-inside:avoid}.scroll{overflow:visible}'
        'h2{break-after:avoid}table{font-size:8pt}th,td{padding:5px}}</style></head><body>',
        '<p class="muted">UPPER SAVANNAH · SCENARIO EXPERIMENT</p>',
        '<h1>' + _text(summary.get("title", "Scenario experiment")) + '</h1>',
        '<div class="meta"><span>State: <strong>' + _text(summary.get("state")) + '</strong></span>',
        '<span>Complete: ' + _number(progress.get("complete", 0)) + '</span>',
        '<span>Failed: ' + _number(progress.get("failed", 0)) + '</span>',
        '<span>Pending: ' + _number(progress.get("pending", 0)) + '</span></div>',
        '<p class="muted">Report generated ' + _text(now()) + '. Experiment <code>' + _text(summary.get("id")) + '</code>.</p>',
        '<p>Each land-cover alternative is compared with the baseline using the same parameter profile. '
        'Parameter cases show how changing the profile affects the baseline landscape. '
        'Signed change is alternative minus its paired baseline; positive reduction means less exported mass.</p>',
        '<p>Totals are annual exported mass over the retained reporting mask. Comparisons use the cells '
        'valid in both runs. Read paired cells and coverage with every result. Parameter ranges describe '
        'the selected experiment and are not probability intervals or observed measurements.</p>',
    ]
    if summary.get("state") != "complete":
        pieces.append('<p class="notice">This report contains the completed cases available in this saved experiment. '
                      'Pending and failed totals remain visible above; unfinished selections can be resumed in the workbench.</p>')
    pieces.append('<h2>Paired native model results</h2><div class="scroll"><table><thead><tr>'
                  '<th>Scenario / profile</th><th>Case</th><th>Export</th><th>Units</th>'
                  '<th>Paired baseline</th><th>Alternative</th><th>Signed change</th>'
                  '<th>Reduction</th><th>Change %</th><th>Paired cells / coverage</th>'
                  '</tr></thead><tbody>')
    rendered = 0
    for row in rows:
        for key, label in POLLUTANTS:
            value = row.get("metrics", {}).get(key)
            if not isinstance(value, dict):
                continue
            coverage = value.get("coverage_fraction")
            coverage_text = _number(coverage * 100) + "%" if isinstance(coverage, (int, float)) else "—"
            pieces.append(
                '<tr><td>' + _text(row.get("scenario_title") or row.get("scenario_id")) +
                '<br><span class="muted">' + _text(row.get("profile_title") or row.get("profile_id")) +
                '</span></td><td>' + _text(row.get("kind")) + '</td><td>' + label +
                '</td><td>' + _text(value.get("units")) + '</td>' +
                ''.join('<td class="num">' + _number(value.get(field)) + '</td>'
                        for field in ("baseline_total", "alternative_total", "delta", "reduction", "relative_change_pct")) +
                '<td class="num">' + _number(value.get("paired_cells")) + ' / ' + coverage_text + '</td></tr>')
            rendered += 1
    if not rendered:
        pieces.append('<tr><td colspan="10">Completed paired results will appear after the selected native runs finish.</td></tr>')
    pieces.append('</tbody></table></div>')
    pieces.append('<h2>Case register</h2><div class="scroll"><table><thead><tr>'
                  '<th>Scenario</th><th>Profile</th><th>State</th><th>Changes</th>'
                  '<th>Native run / paired baseline</th><th>Recovery detail</th></tr></thead><tbody>')
    for row in rows:
        pieces.append('<tr><td>' + _text(row.get("scenario_title") or row.get("scenario_id")) +
                      '</td><td>' + _text(row.get("profile_title") or row.get("profile_id")) +
                      '</td><td>' + _text(row.get("state")) +
                      '</td><td><code>' + _text(json.dumps(row.get("changes", {}), ensure_ascii=False, sort_keys=True)) +
                      '</code></td><td><code>' + _text(row.get("run_id")) +
                      '<br>' + _text(row.get("baseline_run_id")) +
                      '</code></td><td>' + _text(_error(row.get("error"))) + '</td></tr>')
    pieces.append('</tbody></table></div>')
    pieces.append(_native_provenance_report(summary))
    pieces.append('<h2>Interpretation and continued work</h2><p>Use the same-profile land-cover comparisons '
                  'to assess the response of an alternative. Keep the individual nutrient and sediment '
                  'quantities available when combining priorities. Run identifiers reopen the native '
                  'outputs, maps and logs in this workspace. The complete workspace archive carries the '
                  'original sources, scenarios, profiles, experiment design and completed models.</p>')
    pieces.append('<p class="muted">Source methods: InVEST 3.20.0 nutrient and sediment delivery models; '
                  'Upstate Forever EC-SDC Mapping RFP dated October 2, 2026. '
                  'Read each selected profile and scenario for its own references and assumptions.</p>')
    pieces.append('</body></html>')
    return "".join(pieces)


def _native_execution(workspace, case, cache):
    """Read existing stage results; never invoke a native model during a page read."""
    key = _id(case["run_id"])
    if key in cache:
        return cache[key]
    path = workspace.root / "runs" / key / "run.json"
    if not path.is_file():
        result = {"run_id": key, "state": "unprepared", "stages": []}
        cache[key] = result
        return result
    run = workspace.inspect_run(key)
    result = {"run_id": key, "state": run.get("state"), "stages": [],
              "started_at": run.get("started_at"), "completed_at": run.get("completed_at")}
    for model, stage in run.get("stages", {}).items():
        reuse = stage.get("reuse") or {}
        shared = stage.get("reused_from")
        if isinstance(shared, dict):
            reuse = {
                "mode": "reused", "source_run_id": shared.get("run_id"),
                "source_stage_started_at": stage.get("started_at"),
                "source_stage_completed_at": shared.get("stage_completed_at", stage.get("completed_at")),
                "origin": {"run_id": shared.get("run_id"), "model": shared.get("model", model),
                           "started_at": stage.get("started_at"), "completed_at": stage.get("completed_at")},
                "transfer": stage.get("reuse_transfer", stage.get("transfer")),
            }
        mode = reuse.get("mode")
        if mode is None and isinstance(stage.get("input_signature"), dict):
            mode = "executed"
        item = {"model": model, "mode": mode if mode in ("executed", "reused", "recovered") else "complete",
                "started_at": stage.get("reuse_started_at") if isinstance(shared, dict) else stage.get("started_at"),
                "completed_at": stage.get("reused_at") if isinstance(shared, dict) else stage.get("completed_at")}
        for field in ("source_run_id", "source_stage_started_at", "source_stage_completed_at"):
            if reuse.get(field) is not None:
                item[field] = reuse[field]
        origin = reuse.get("origin")
        if isinstance(origin, dict):
            item["origin"] = {field: origin[field] for field in
                              ("run_id", "model", "started_at", "completed_at") if field in origin}
        transfer = reuse.get("transfer")
        if isinstance(transfer, dict):
            item["transfer"] = {field: transfer[field] for field in
                                ("files", "bytes", "methods") if field in transfer}
        result["stages"].append(item)
    cache[key] = result
    return result


def _case_ids(value):
    if value is None or value == "":
        return []
    if not isinstance(value, str):
        raise ValueError("Select case IDs from this saved experiment.")
    values = list(dict.fromkeys(value.split(",")))
    if len(values) > 1000:
        raise ValueError("Request at most 1,000 case details on one result page.")
    return [_id(key) for key in values]


def _retained_case_for_page(workspace, experiment_id, key):
    scope = workspace.root / "experiments" / _id(experiment_id)
    path = scope / "cases" / (_id(key) + ".json")
    if not path.is_file():
        return None
    ordinal = read_json(path).get("ordinal")
    if type(ordinal) is not int or ordinal < 0:
        raise ValueError("A saved experiment case changed while opening its native execution.")
    # Rebuild this ordinal from the verified immutable plan. The maintained
    # reader validates retained native bindings and preserves legacy case IDs
    # when an old partial-model plan acquires its canonical native selection.
    page = experiments.expanded_cases(workspace, experiment_id, offset=ordinal, limit=1)
    rows = page["cases"]
    if len(rows) != 1 or rows[0]["id"] != key:
        raise ValueError("The requested case differs from its retained experiment ordinal.")
    return rows[0]


class ExperimentOperator:
    def __init__(self, operator, fault):
        self.app = operator
        self.Fault = fault

    def catalog(self, workspace, *, catalogue=None):
        ws = self.app.ws(workspace)
        rows = experiments.list_experiments(ws) if catalogue is None else catalogue.experiments(ws)
        return [_exact_counts(item) for item in rows]

    def axes(self):
        provider = getattr(experiments, "supported_axes", None)
        return provider() if callable(provider) else getattr(experiments, "SUPPORTED_AXES", {})

    def preview(self, value):
        key = value.get("workspace", self.app.primary)
        ws = self.app.ws(key)
        selection = value.get("selection")
        if not isinstance(selection, dict):
            raise ValueError("Supply an experiment selection.")
        return _exact_counts(experiments.preview(ws, selection))

    def _decorate(self, workspace, value, requested_cases=()):
        result = _exact_counts(json.loads(json.dumps(value)))
        key = _id(result["id"])
        ws = self.app.ws(workspace)
        scope = ws.root / "experiments" / key
        execution, cache = {}, {}
        cases = {row["id"]: row for row in result.get("cases", [])}
        for case_id in requested_cases:
            if case_id not in cases:
                row = _retained_case_for_page(ws, key, case_id)
                if row is not None:
                    cases[case_id] = row
        for case_id, row in cases.items():
            execution[case_id] = _native_execution(ws, row, cache)
        if "cases" in result or requested_cases:
            result["native_execution_by_case"] = execution
        # Native binding recovery can invalidate a summary without deleting
        # its prior bytes. The maintained reader applies the current plan and
        # binding rules before any result is presented as downloadable.
        current_summary = experiments.read_summary(ws, key)
        result["_downloads"] = (self.app._files(workspace, result, scope)
                                if current_summary is not None else [])
        marker = scope / "operator-report.json"
        summary_path = scope / "summary.json"
        if marker.is_file() and current_summary is not None:
            retained = read_json(marker)
            if retained.get("summary_sha256") == file_digest(summary_path):
                extra = self.app._files(workspace, {"files": {"report": retained["report"]}}, scope)
                seen = {row["id"] for row in result["_downloads"]}
                result["_downloads"].extend(row for row in extra if row["id"] not in seen)
        study_marker = scope / "study-report.json"
        if study_marker.is_file() and summary_path.is_file():
            retained = read_json(study_marker)
            if (retained.get("schema") == "upstate.study-report-downloads/v1"
                    and retained.get("experiment_id") == key
                    and retained.get("workspace_id") == ws.project["id"]):
                current = (current_summary is not None
                           and retained.get("summary_sha256") == file_digest(summary_path))
                result["study_report"] = {
                    "state": "current" if current else "stale",
                    "generated_at": retained.get("generated_at"),
                    "summary_sha256": retained.get("summary_sha256"),
                }
                if current:
                    extra = self.app._files(workspace, retained, scope)
                    seen = {row["id"] for row in result["_downloads"]}
                    result["_downloads"].extend(row for row in extra if row["id"] not in seen)
        return result

    def read(self, workspace, operation, value):
        ws = self.app.ws(workspace)
        if operation == "catalog":
            return {"experiments": self.catalog(workspace), "axes": self.axes()}
        if operation == "axes":
            return {"axes": self.axes()}
        if operation == "methods":
            path = Path(__file__).resolve().parent.parent / "source" / "experiment-methods-20261012.json"
            return read_json(path) if path.is_file() else {"methods": []}
        key = _id(value.get("experiment_id"))
        if operation == "inspect":
            record = experiments.inspect(
                ws, key,
                offset=_integer(value.get("offset"), 0),
                limit=_integer(value.get("limit"), 100, minimum=1, maximum=1000))
        elif operation == "summary":
            record = experiments.read_summary(ws, key)
            if record is None:
                raise self.Fault("EXPERIMENT_SUMMARY", "Run the experiment or build a report from available cases.", 404)
        else:
            raise self.Fault("EXPERIMENT_READ", "Choose a supported experiment view.", 404)
        requested = _case_ids(value.get("case_ids")) if operation == "inspect" else ()
        return self._decorate(workspace, record, requested)

    def _report(self, workspace, key, summary=None):
        ws = self.app.ws(workspace)
        scope = ws.root / "experiments" / _id(key)
        with held(scope / ".experiment.lock", blocking=False):
            # Read the retained summary while its original writer is excluded.
            summary = experiments.read_summary(ws, key)
            if summary is None:
                raise ValueError("Build an updated experiment summary before creating its report.")
            summary_path = scope / "summary.json"
            summary_sha256 = file_digest(summary_path)
            text = render_report(summary)
            output = scope / "report.html"
            fd, temporary = tempfile.mkstemp(prefix=".write-report-", dir=scope)
            try:
                with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
                    handle.write(text)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, output)
            finally:
                with contextlib.suppress(FileNotFoundError):
                    os.unlink(temporary)
            record = {"path": output.name, "bytes": output.stat().st_size,
                      "sha256": file_digest(output)}
            atomic_json(scope / "operator-report.json",
                        {"summary_sha256": summary_sha256, "report": record})
            result = dict(summary)
            result["files"] = dict(result.get("files", {}), report=record)
        # The complete report takes the same summary lock. Refresh it only
        # after this writer releases that lock, retaining its original context.
        from model.study_report import refresh_existing
        refresh_existing(ws, key)
        return result

    def invoke(self, task):
        ws = self.app.ws(task["workspace"])
        value = task["payload"]
        action = task["action"]
        if action == "experiment.save":
            return experiments.prepare(ws, value.get("selection", value))
        key = value.get("experiment_id")
        if key is None and action == "experiment.run":
            selection = value.get("selection")
            if not isinstance(selection, dict):
                raise ValueError("Choose a saved experiment or provide its selection.")
            key = experiments.prepare(ws, selection)["id"]
        key = _id(key)
        # The queue retains this exact identity even when execution or report
        # rendering raises before a result can be returned.
        task["experiment_id"] = key
        task.pop("study_report_error", None)
        if action == "experiment.run":
            try:
                experiments.execute(ws, key)
            except Exception:
                try:
                    self._report(task["workspace"], key)
                except Exception as report_error:
                    task["study_report_error"] = {
                        "type": type(report_error).__name__, "message": str(report_error)}
                raise
            summary = experiments.read_summary(ws, key)
        elif action == "experiment.summarize":
            summary = experiments.summarize(ws, key)
        else:
            raise ValueError("Unknown experiment operation.")
        return self._report(task["workspace"], key, summary)

    def retained_result(self, workspace, key):
        """Expose current retained files without starting or resuming a model."""
        ws = self.app.ws(workspace)
        key = _id(key)
        summary = experiments.read_summary(ws, key)
        if summary is None:
            return None
        try:
            return self._decorate(workspace, summary)
        except (OSError, ValueError, KeyError) as error:
            # A damaged report must remain actionable without hiding the
            # separately retained scientific summary and comparison CSV.
            return {**summary,
                    "_downloads": self.app._files(
                        workspace, summary, ws.root / "experiments" / key),
                    "_report_error": str(error)}

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS:
            return task
        result = task.get("result") or {}
        key = (task.get("experiment_id") or result.get("id")
               or task.get("payload", {}).get("experiment_id"))
        if not key:
            return task
        task["experiment"] = {"id": _id(key)}
        if task.get("study_report_error"):
            task["experiment"]["report_error"] = task["study_report_error"]["message"]
        if task.get("state") not in {"complete", "failed", "interrupted", "cancelled"}:
            return task
        try:
            record = self.retained_result(task["workspace"], key)
            if record is not None:
                task["experiment"].update(
                    {name: record[name] for name in
                     ("title", "state", "progress", "study_report") if name in record})
                if record.get("_report_error"):
                    task["experiment"]["report_error"] = record["_report_error"]
                task["_downloads"] = record["_downloads"]
        except (OSError, ValueError, KeyError) as error:
            task["experiment"]["report_error"] = str(error)
        return task

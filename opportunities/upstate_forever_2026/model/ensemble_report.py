"""Physical scenario-ensemble reports for the Upper Savannah workbench.

TokenJunkieLabs. Uses the original paired native results retained by Ensembles.
"""
from __future__ import annotations
import csv
import html
import io
import math
from collections import defaultdict
from pathlib import Path
import zipfile
from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     held, identifier, now, read_json, relative_file, verify_file)
from .ensembles import Ensembles

SCHEMA = "upstate.ensemble-report-release/v1"
RENDERER_VERSION = 5
POLLUTANTS = {"nitrogen_export": "Nitrogen", "phosphorus_export": "Phosphorus",
              "sediment_export": "Sediment"}
PAIR_FIELDS = (
    "member_id", "member_label", "profile_id", "scenario_id", "scenario_label",
    "pollutant", "total_units", "baseline_run_id", "alternative_run_id",
    "baseline_total", "alternative_total", "baseline_common", "alternative_common",
    "delta_common", "percent_change", "baseline_valid_cells", "alternative_valid_cells",
    "common_cells", "baseline_only_cells", "alternative_only_cells",
    "common_support_sha256", "comparison_id")
SENSITIVITY_FIELDS = ("reference_member_id", "reference_member_label", "reference_profile_id") + PAIR_FIELDS
RANGE_FIELDS = (
    "scenario_id", "scenario_label", "pollutant", "total_units",
    "common_support_sha256", "members", "common_cells", "minimum_delta",
    "maximum_delta", "minimum_percent", "maximum_percent", "reductions",
    "increases", "unchanged", "direction", "coverage_complete")

def _number(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("A retained ensemble quantity is not a finite number")
    return value

def _labels(report):
    members, scenarios = {}, {}
    for member in report.get("members", []):
        members[member["id"]] = member.get("label") or member["id"][:12]
        for run in member.get("runs", []):
            scenarios[run["scenario_id"]] = run.get("label") or run["scenario_id"][:12]
    return members, scenarios

def _pairs(report, kind="rows"):
    member_labels, scenario_labels = _labels(report)
    rows = []
    for original in report.get(kind, []):
        row = dict(original)
        for key in ("baseline_total", "alternative_total", "baseline_common",
                    "alternative_common", "delta_common", "percent_change"):
            row[key] = _number(row.get(key))
        for key in ("baseline_valid_cells", "alternative_valid_cells", "common_cells",
                    "baseline_only_cells", "alternative_only_cells"):
            value = row.get(key)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError("The paired report requires actual nonnegative cell counts")
        if row.get("pollutant") not in POLLUTANTS:
            raise ValueError("Unknown physical pollutant in the paired report")
        expected_units = "t/year" if row["pollutant"] == "sediment_export" else "kg/year"
        if row.get("total_units") != expected_units:
            raise ValueError("The paired report needs original annual mass units")
        if row["common_cells"] == 0 and any(row[k] is not None for k in
                ("baseline_common", "alternative_common", "delta_common", "percent_change")):
            raise ValueError("A pair without common valid cells cannot have a numerical contrast")
        if row["common_cells"] and any(row[k] is None for k in
                ("baseline_common", "alternative_common", "delta_common")):
            raise ValueError("A covered pair requires complete physical contrast quantities")
        if row["baseline_common"] == 0 and row["percent_change"] is not None:
            raise ValueError("Percentage change is undefined for a zero baseline")
        support = row.get("common_support_sha256")
        if support:
            identifier(support)
        row["member_label"] = member_labels.get(row["member_id"], row["member_id"][:12])
        row["scenario_label"] = scenario_labels.get(row["scenario_id"], row["scenario_id"][:12])
        if kind == "sensitivity":
            row["reference_member_id"] = identifier(row.get("reference_member_id"))
            row["reference_profile_id"] = identifier(row.get("reference_profile_id"))
            row["reference_member_label"] = member_labels.get(
                row["reference_member_id"], row["reference_member_id"][:12])
        rows.append(row)
    return rows

def summarize_ranges(rows):
    """Group only genuinely matching geographic support and physical units."""
    groups = defaultdict(list)
    for row in rows:
        if row["delta_common"] is None or not row["common_cells"]:
            continue
        support = row.get("common_support_sha256")
        # An older source without mask identity remains a separate case.
        grouping = support or "unidentified-" + row["member_id"]
        groups[(row["scenario_id"], row["pollutant"], row["total_units"], grouping)].append(row)
    result = []
    for (scenario, pollutant, units, support), members in sorted(groups.items()):
        deltas = [r["delta_common"] for r in members]
        percentages = [r["percent_change"] for r in members if r["percent_change"] is not None]
        lower = sum(v < 0 for v in deltas)
        higher = sum(v > 0 for v in deltas)
        unchanged = sum(v == 0 for v in deltas)
        direction = ("reduction throughout" if lower == len(deltas) else
                     "increase throughout" if higher == len(deltas) else
                     "unchanged throughout" if unchanged == len(deltas) else "mixed direction")
        counts = {r["common_cells"] for r in members}
        if len(counts) != 1:
            raise ValueError("An identical common-support mask has inconsistent cell counts")
        result.append({
            "scenario_id": scenario, "scenario_label": members[0]["scenario_label"],
            "pollutant": pollutant, "total_units": units,
            "common_support_sha256": support if not support.startswith("unidentified-") else None,
            "members": len(members), "common_cells": next(iter(counts)),
            "minimum_delta": min(deltas), "maximum_delta": max(deltas),
            "minimum_percent": min(percentages) if percentages else None,
            "maximum_percent": max(percentages) if percentages else None,
            "reductions": lower, "increases": higher, "unchanged": unchanged,
            "direction": direction,
            "coverage_complete": all(r["baseline_only_cells"] == 0 and
                                     r["alternative_only_cells"] == 0 for r in members)})
    return result

def _csv(rows, fields):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore",
                            lineterminator="\n")
    writer.writeheader()
    for row in rows:
        safe = {}
        for key in fields:
            value = row.get(key)
            # Protect human-opened spreadsheets while leaving numeric signs intact.
            if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
                value = "'" + value
            safe[key] = value
        writer.writerow(safe)
    return output.getvalue().encode("utf-8")

def _h(value):
    return html.escape(str(value if value is not None else ""), quote=True)

def _n(value):
    return "\u2014" if value is None else format(value, ",.6g")

def _table(headers, rows):
    return '<div class="table-wrap"><table><thead><tr>' + "".join(
        "<th>" + _h(head) + "</th>" for head in headers) + "</tr></thead><tbody>" + "".join(
        "<tr>" + "".join("<td>" + _h(cell) + "</td>" for cell in row) + "</tr>"
        for row in rows) + "</tbody></table></div>"

def _diagnostics(report):
    result, seen = [], set()
    execution = report.get("execution_error")
    for category, entries in (("Native run", report.get("run_errors", [])),
                              ("Paired result", report.get("errors", [])),
                              ("Execution", [execution] if execution else [])):
        if not isinstance(entries, list):
            entries = [entries] if entries else []
        for entry in entries:
            value = entry if isinstance(entry, dict) else {"message": str(entry)}
            problem = value.get("error", value)
            if isinstance(problem, dict):
                message = problem.get("message") or canonical(problem).decode("utf-8")
            else:
                message = str(problem)
            origin = value.get("run_id") or value.get("comparison_id") or value.get("member_id") or ""
            key = (category, str(origin), message)
            if key not in seen:
                result.append(key)
                seen.add(key)
    return result

def render_html(report, rows, ranges, sensitivity, release_id):
    title = report.get("title") or "Scenario and parameter comparison"
    members = report.get("members", [])
    native_runs = {r.get("run_id") for m in members for r in m.get("runs", []) if r.get("run_id")}
    complete_pairs = {("land_cover", r["member_id"], r["scenario_id"]) for r in rows}
    complete_pairs.update(("parameter", r["member_id"], r["scenario_id"]) for r in sensitivity)
    body = '<header><p class="eyebrow">TOKENJUNKIELABS / UPPER SAVANNAH</p><h1>' + _h(title) + (
        '</h1><p class="lede">How modeled export changes with land-cover alternatives and '
        'retained scientific parameter choices.</p></header>')
    body += '<div class="facts">' + "".join(
        "<section><span>" + _h(label) + "</span><strong>" + _h(value) + "</strong></section>"
        for label, value in (("Run state", report.get("state", "pending")),
                             ("Parameter members", len(members)),
                             ("Selected native runs", len(native_runs)),
                             ("Reported complete pairs", len(complete_pairs)))) + "</div>"
    reference = report.get("scenario_reference")
    reference_word = "Reference" if reference else "Baseline"
    if reference:
        body += ("<h2>Explicit scenario reference</h2><p><strong>" + _h(reference["reference_title"])
                 + "</strong> is the reference for every same-profile pair below. Signed change is "
                 "alternative minus this reference on their common valid cells. The native CSV fields "
                 "named baseline identify this selected pair reference. The original design baseline remains "
                 + _h(reference["original_baseline_scenario_id"]) + ".</p>")
    selected_models = (report.get("model_scope") or {}).get("selected_models") or report.get("models") or ["ndr", "sdr"]
    body += "<p><strong>Selected models:</strong> " + _h(
        " and ".join("Nutrients" if name == "ndr" else "Sediment" for name in selected_models)) + ".</p>"
    body += (
        "<h2>Reading the comparison</h2>"
        "<p>Land-cover alternatives use a baseline with the same parameter profile and model grid. "
        "The separate parameter comparison holds the retained baseline land cover fixed and compares "
        "each varied profile with the first selected reference profile. A negative change means "
        "lower modeled annual export. The physical change uses only "
        "cells with valid results in both runs. Each run's total over its own valid reporting-mask cells is "
        "also available in the detailed table.</p>"
        "<p>Ranges describe the explicitly selected parameter choices. The report groups "
        "matching geographic masks together. Identical pair masks do not establish complete reporting-area coverage. It preserves cases with different coverage "
        "as separate groups. A percentage requires a nonzero baseline on the same cells.</p>")
    if rows:
        body += "<h2>Direction across the selected parameter choices</h2>"
        body += _table(
            ["Alternative", "Pollutant", "Parameter cases", "Annual change range", "Units",
             "Percentage range", "Direction", "Common cells", "Pair coverage"],
            [(r["scenario_label"], POLLUTANTS[r["pollutant"]], r["members"],
              _n(r["minimum_delta"]) + " to " + _n(r["maximum_delta"]), r["total_units"],
              (_n(r["minimum_percent"]) + "% to " + _n(r["maximum_percent"]) + "%")
              if r["minimum_percent"] is not None else "\u2014",
              r["direction"], format(r["common_cells"], ","),
              "Same coverage in each pair" if r["coverage_complete"] else "See unmatched cells")
             for r in ranges])
        body += "<h2>Every paired physical result</h2>"
        body += _table(
            ["Parameter case", "Alternative", "Pollutant", "Units",
             reference_word + " / common cells", "Alternative / common cells", "Annual change",
             "Change %", "Common cells", reference_word + "-only cells", "Alternative-only cells"],
            [(r["member_label"], r["scenario_label"], POLLUTANTS[r["pollutant"]], r["total_units"],
              _n(r["baseline_common"]), _n(r["alternative_common"]), _n(r["delta_common"]),
              _n(r["percent_change"]), format(r["common_cells"], ","),
              format(r["baseline_only_cells"], ","), format(r["alternative_only_cells"], ","))
             for r in rows])
        body += "<h2>Reporting-mask totals for each run</h2>"
        body += _table(
            ["Parameter case", "Alternative", "Pollutant", "Units",
             reference_word + " total", "Alternative total", reference_word + " valid cells", "Alternative valid cells"],
            [(r["member_label"], r["scenario_label"], POLLUTANTS[r["pollutant"]], r["total_units"],
              _n(r["baseline_total"]), _n(r["alternative_total"]),
              format(r["baseline_valid_cells"], ","), format(r["alternative_valid_cells"], ","))
             for r in rows])
    if sensitivity:
        body += ("<h2>Parameter sensitivity with baseline land cover held fixed</h2>"
                 "<p>Annual change is the varied profile minus the reference profile on the same "
                 "valid cells. These comparisons show the effect of changing scientific parameters "
                 "on the retained baseline. The original input records retain their source and simulation labels.</p>")
        body += _table(
            ["Reference profile", "Varied profile", "Scenario", "Pollutant", "Units",
             "Reference / common cells", "Varied / common cells", "Annual change", "Change %",
             "Common cells", "Reference-only cells", "Varied-only cells"],
            [(r["reference_member_label"], r["member_label"], r["scenario_label"],
              POLLUTANTS[r["pollutant"]], r["total_units"],
              _n(r["baseline_common"]), _n(r["alternative_common"]), _n(r["delta_common"]),
              _n(r["percent_change"]), format(r["common_cells"], ","),
              format(r["baseline_only_cells"], ","), format(r["alternative_only_cells"], ","))
             for r in sensitivity])
        body += "<h2>Reporting-mask totals for the parameter comparison</h2>"
        body += _table(
            ["Reference profile", "Varied profile", "Scenario", "Pollutant", "Units",
             "Reference total", "Varied total", "Reference valid cells", "Varied valid cells"],
            [(r["reference_member_label"], r["member_label"], r["scenario_label"],
              POLLUTANTS[r["pollutant"]], r["total_units"],
              _n(r["baseline_total"]), _n(r["alternative_total"]),
              format(r["baseline_valid_cells"], ","), format(r["alternative_valid_cells"], ","))
             for r in sensitivity])
    if not rows and not sensitivity:
        body += ("<h2>Run progress</h2><p>The design and selected native runs are retained. "
                 "Completed pairs will appear here as they finish. "
                 "Open the run history to continue the saved selection.</p>")
    diagnostics = _diagnostics(report)
    if diagnostics:
        body += ("<h2>Run and comparison messages</h2>"
                 "<p>Completed results remain available. Use the original run history to correct "
                 "the reported input or execution problem, then continue the saved design.</p>")
        body += _table(["Stage", "Original run or comparison", "Message"], diagnostics)
    body += "<h2>Selected scientific profiles and native runs</h2>"
    body += _table(
        ["Parameter case", "Profile", "Scenario", "Role", "Native run"],
        [(m.get("label", m["id"][:12]), m["profile_id"], r.get("label", r["scenario_id"]),
          r.get("role", ""), r["run_id"]) for m in members for r in m.get("runs", [])])
    body += "<h2>Method and source choices</h2><p>" + _h(
        "The selected InVEST production models supply these quantities. "
        "Nitrogen and phosphorus totals are kilograms per year; sediment totals are tonnes per year. "
        "The retained model cell grid, source editions, profile parameters, run identities and "
        "valid-cell masks determine the comparison. Profile ranges require explicit source "
        "references and reasons. Their endpoints represent the explored choices.") + "</p>"
    body += '<details><summary>Retained source and parameter context</summary><pre>' + _h(
        canonical({"sources": report.get("sources", []),
                   "members": members, "grid_id": report.get("grid_id"),
                   "model_scope": report.get("model_scope"),
                   "baseline_scenario_id": report.get("baseline_scenario_id")}).decode("utf-8")) + (
        "</pre></details>")
    body += '<footer><p>Report release <code>' + _h(release_id) + (
        "</code></p><p>Use pairs.csv for land-cover contrasts, sensitivity.csv for the baseline "
        "parameter comparison, robustness.csv for grouped land-cover ranges, and report.json for "
        "the original retained report. Transfer the entire working project with "
        "the operator's Back up workspace action.</p></footer>")
    style = """
:root{color-scheme:light;font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#202326;background:#fff}
*{box-sizing:border-box}body{max-width:1440px;margin:0 auto;padding:42px 32px}
h1{font-size:32px;line-height:1.2;max-width:1000px;margin:10px 0 16px}h2{font-size:21px;margin:34px 0 14px}
.eyebrow{font-size:12px;letter-spacing:.1em;font-weight:700}.lede{font-size:18px;color:#505458;max-width:920px}
.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:26px 0}
.facts section{border:1px solid #cdd0d2;padding:18px}.facts span{display:block;font-size:12px;color:#505458}
.facts strong{display:block;font-size:22px;margin-top:8px}.table-wrap{overflow-x:auto;border:1px solid #d0d2d4}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:12px}
th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #dedfe1}
th{background:#f3f4f5;font-weight:650;white-space:normal}td{overflow-wrap:anywhere}
details{border:1px solid #d0d2d4;padding:14px}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}
footer{margin-top:32px;border-top:1px solid #999;padding-top:16px;color:#505458;font-size:12px}code{overflow-wrap:anywhere}
@media(max-width:700px){body{padding:20px 14px}.facts{grid-template-columns:repeat(2,1fr)}h1{font-size:25px}}
@media print{body{max-width:none;margin:0;padding:12mm}h2,thead{break-after:avoid}tr{break-inside:avoid}.table-wrap{overflow:visible}details{break-before:page}}
"""
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>' + _h(title) + '</title><style>' + style +
            '</style></head><body>' + body + '</body></html>\n').encode("utf-8")

def summary_signature(report):
    """Identify exported scientific data and execution state without cache timestamps."""
    return digest({key: value for key, value in report.items()
                   if key not in {"generated_at", "report_state", "current_run_signature"}})

def export_state(release, summary):
    """Distinguish current on-screen results from a retained downloadable release."""
    if release is None:
        return "missing"
    if summary.get("report_state") in {"pending", "stale"}:
        return "stale"
    if release.get("renderer_version") != RENDERER_VERSION:
        return "stale"
    return ("current" if release.get("summary_signature") == summary_signature(summary)
            else "stale")

def build(workspace, ensemble_id):
    ensemble_id = identifier(ensemble_id)
    manager = Ensembles(workspace)
    report = manager.report_data(ensemble_id, refresh=False)
    if report.get("report_state") != "current":
        report = manager.report_data(ensemble_id, refresh=True)
    return _build(workspace, report)


def _build(workspace, report, *, publish_pointer=True):
    """Publish an already-bound native report without changing its numerical rows."""
    ensemble_id = identifier(report["id"])
    rows = _pairs(report)
    sensitivity = _pairs(report, "sensitivity")
    ranges = summarize_ranges(rows)
    content = {"schema": SCHEMA, "renderer_version": RENDERER_VERSION,
               "ensemble_id": ensemble_id, "report": report,
               "paired_rows": rows, "parameter_rows": sensitivity, "support_groups": ranges}
    release_id = digest(content)
    directory = workspace.root / "ensemble_reports" / release_id
    directory.mkdir(parents=True, exist_ok=True)
    state_path = directory / "release.json"
    with held(directory / ".report.lock", blocking=False):
        if state_path.exists():
            previous = read_json(state_path)
            if previous.get("id") != release_id or previous.get("ensemble_id") != ensemble_id:
                raise ValueError("The selected ensemble report identity differs")
            for item in previous["files"].values():
                verify_file(directory, item)
            result = previous
        else:
            methods = (
                "# Scenario and parameter comparison\n\n"
                "Each alternative is paired with a baseline using the same retained parameter profile "
                "and reporting/model grid. Annual changes are alternative minus baseline on the "
                "intersection of valid raster cells inside the reporting mask. Totals over each run's own valid cells are separate "
                "columns. Missing cells remain missing; zero baseline makes percentage change "
                "undefined. Cells invalid in both runs remain outside those paired totals; matching pair masks "
                "do not establish complete reporting-area coverage. Baseline means the retained source "
                "scenario, and does not classify its inputs as observed or simulated.\n\n"
                "Ranges are grouped by scenario, pollutant, units and exact common-valid mask. "
                "They describe the selected parameter cases. An identical cell count alone is "
                "insufficient to join geographic support.\n\n"
                "pairs.csv contains every land-cover pair and its native run IDs. sensitivity.csv "
                "holds land cover fixed and compares each varied profile with the first selected "
                "reference profile; annual change is varied minus reference on the common mask. "
                "robustness.csv contains the grouped land-cover case ranges and direction counts. "
                "report.json preserves "
                "the source context, selected members and numeric result. report.html is a "
                "self-contained printable report. release.json lists each member's identity.\n\n"
                "The original operator retains native logs, inputs, profiles, scenarios and "
                "outputs. Use Back up workspace to transfer the complete project and application; "
                "this report package is its printable numeric companion.\n")
            if report.get("scenario_reference"):
                reference = report["scenario_reference"]
                methods = ("# Explicit scenario reference\n\nReference: " + reference["reference_title"]
                           + " (" + reference["reference_scenario_id"] + ").\n\n"
                           "Every native baseline field below identifies this selected same-profile reference. "
                           "The original ensemble baseline and earlier baseline reports remain retained. "
                           "The direct contrast is computed by the maintained native pair reducer on its "
                           "actual common valid cells, rather than subtracting separate baseline effects.\n\n"
                           + methods)
            contents = {
                "report.html": render_html(report, rows, ranges, sensitivity, release_id),
                "pairs.csv": _csv(rows, PAIR_FIELDS),
                "sensitivity.csv": _csv(sensitivity, SENSITIVITY_FIELDS),
                "robustness.csv": _csv(ranges, RANGE_FIELDS),
                "report.json": canonical(content) + b"\n",
                "METHODS.md": methods.encode("utf-8")}
            files = {}
            for name, data in contents.items():
                path = directory / name
                atomic_bytes(path, data, immutable=True)
                files[name] = describe_file(directory, path)
            package_manifest = {"schema": SCHEMA, "renderer_version": RENDERER_VERSION, "id": release_id,
                                "ensemble_id": ensemble_id, "files": files,
                                "summary_signature": summary_signature(report),
                                "run_signature": report.get("run_signature"),
                                "report_state": report.get("report_state"), "state": report.get("state")}
            bundle = directory / "ensemble-report.zip"
            temporary = directory / ".report-archive.pending"
            try:
                with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                                     compresslevel=6) as archive:
                    payloads = {**contents, "release.json": canonical(package_manifest) + b"\n"}
                    for name in sorted(payloads):
                        member = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                        member.compress_type = zipfile.ZIP_DEFLATED
                        member.external_attr = 0o100644 << 16
                        archive.writestr(member, payloads[name])
                atomic_bytes(bundle, temporary.read_bytes(), immutable=True)
            finally:
                temporary.unlink(missing_ok=True)
            files["ensemble-report.zip"] = describe_file(directory, bundle)
            result = {**package_manifest, "files": files, "created_at": now(),
                      "title": report.get("title"), "state": report.get("state"),
                      "paired_results": len(rows), "parameter_results": len(sensitivity),
                      "support_groups": len(ranges)}
            atomic_json(state_path, result, immutable=True)
        if publish_pointer:
            pointer = workspace.root / "ensemble_results" / ensemble_id / "latest-report.json"
            atomic_json(pointer, {"schema": SCHEMA, "ensemble_id": ensemble_id, "report_id": release_id})
    return result

def latest(workspace, ensemble_id, *, verify=False):
    ensemble_id = identifier(ensemble_id)
    pointer = workspace.root / "ensemble_results" / ensemble_id / "latest-report.json"
    if not pointer.exists():
        return None
    selected = read_json(pointer)
    if selected.get("ensemble_id") != ensemble_id:
        raise ValueError("The report pointer belongs to another ensemble")
    key = identifier(selected["report_id"])
    directory = workspace.root / "ensemble_reports" / key
    result = read_json(directory / "release.json")
    if result.get("id") != key or result.get("ensemble_id") != ensemble_id:
        raise ValueError("The report release belongs to another ensemble")
    if verify:
        for item in result["files"].values():
            verify_file(directory, item)
    return result

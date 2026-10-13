"""Complete scientific figures and a portable report for a saved synthesis."""
from __future__ import annotations

import csv
import hashlib
import html
import io
import json
import math
import textwrap
from urllib.parse import urlsplit
import zipfile

from .evidence_synthesis import canonical, content_sha256

_MEASURE = {"RR": "Risk ratio", "OR": "Odds ratio", "RD": "Risk difference",
            "MD": "Mean difference", "SMD": "Standardized mean difference", "HR": "Hazard ratio"}


def _h(value):
    return html.escape("" if value is None else str(value), quote=True)


def _n(value, digits=5):
    return "Not estimable" if value is None else format(value, "." + str(digits) + "g")


def _json(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def _csv(headers, rows):
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(headers)
    for row in rows:
        writer.writerow(["" if x is None else ("'" + x if isinstance(x, str) and x[:1] in {"=", "+", "-", "@", "\t", "\r"} else x) for x in row])
    return out.getvalue().encode("utf-8")


def _label(value):
    return "\n".join(textwrap.wrap(str(value), width=48, break_long_words=False))


def _figure_bytes(figure, salt):
    import matplotlib
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    FigureCanvasAgg(figure)
    out = io.BytesIO()
    with matplotlib.rc_context({"svg.fonttype": "none", "svg.hashsalt": salt,
                                "font.family": "DejaVu Sans", "font.size": 9}):
        figure.savefig(out, format="svg", bbox_inches="tight",
                       metadata={"Creator": "Stellar Forge Analysis / matplotlib", "Date": None})
    return out.getvalue()


def _axis_label(measure):
    return _MEASURE[measure] + (" (log scale)" if measure in {"RR", "OR", "HR"} else "")


def forest_figures(result, cancelled=lambda: None):
    """Every selected estimable row appears; long cohorts span complete pages."""
    from matplotlib.figure import Figure
    from matplotlib.ticker import FuncFormatter
    from matplotlib.patches import Polygon

    rows = [r for r in result["review"]["rows"] if r["state"] == "ESTIMABLE"]
    primary, p = result["primary"], result["review"]["protocol"]
    measure = p["measure"]
    weights = {v["result_id"]: v["weight"] for v in primary.get("weights", [])}
    chunks = [rows[i:i + 35] for i in range(0, len(rows), 35)] or [[]]
    outputs = {}
    for page, part in enumerate(chunks, 1):
        cancelled()
        height = max(3.5, sum(max(1, len(_label(r["label"]).split("\n"))) for r in part) * 0.35 + 2)
        figure = Figure(figsize=(11, height), facecolor="white")
        axis = figure.subplots()
        positions, cursor = [], 0
        for row in part:
            positions.append(cursor)
            cursor -= max(1, len(_label(row["label"]).split("\n"))) * 1.15
        for y, row in zip(positions, part):
            effect = row["effect"]
            x, (lo, hi) = effect["estimate"], effect["interval"]
            axis.plot([lo, hi], [y, y], color="#555555", linewidth=1)
            axis.scatter([x], [y], s=24 + 220 * weights.get(row["result_id"], 0),
                         marker="s", color="#333333", edgecolors="#111111", linewidths=0.5, zorder=3)
        labels = [_label(r["label"]) for r in part]
        if primary.get("status") == "ESTIMATED":
            y = cursor - 0.7
            lo, hi = primary["interval"]
            x = primary["estimate"]
            axis.add_patch(Polygon([(lo, y), (x, y + .3), (hi, y), (x, y - .3)],
                                   closed=True, facecolor="#111111"))
            positions.append(y); labels.append("Pooled estimate")
        if not part:
            axis.text(.5, .5, "No estimable study rows", transform=axis.transAxes,
                      ha="center", va="center", color="#555555")
        axis.axvline(0, color="#999999", linewidth=.8, linestyle="--")
        axis.set_yticks(positions, labels, fontsize=8)
        axis.tick_params(axis="y", length=0, pad=8)
        axis.set_xlabel(_axis_label(measure))
        axis.set_title("Study estimates" + (f" — page {page} of {len(chunks)}" if len(chunks) > 1 else ""),
                       loc="left", fontweight="bold", fontsize=12)
        if measure in {"RR", "OR", "HR"}:
            axis.xaxis.set_major_formatter(FuncFormatter(
                lambda x, _: _n(math.exp(x), 4) if -700 < x < 700 else f"exp({x:.3g})"))
        axis.spines[["top", "right", "left"]].set_visible(False)
        axis.grid(axis="x", color="#e4e4e4", linewidth=.6)
        axis.set_axisbelow(True)
        axis.margins(y=.1)
        figure.subplots_adjust(left=.44, bottom=.2, right=.98)
        name = "forest.svg" if len(chunks) == 1 else f"forest-{page:03d}.svg"
        outputs[name] = _figure_bytes(figure, result["review"]["protocol_sha256"] + name)
    return outputs


def funnel_figure(result):
    from matplotlib.figure import Figure
    from scipy import stats
    rows = [r for r in result["review"]["rows"] if r["state"] == "ESTIMABLE"]
    figure = Figure(figsize=(7.5, 5), facecolor="white")
    axis = figure.subplots()
    for row in rows:
        axis.scatter(row["effect"]["estimate"], row["effect"]["standard_error"],
                     color="#333333", s=28, alpha=.85)
    center = result["primary"].get("estimate")
    if center is not None and rows:
        limit = max(r["effect"]["standard_error"] for r in rows) * 1.08
        critical = float(stats.norm.isf(result["review"]["protocol"]["analysis"]["alpha"] / 2))
        axis.plot([center, center - critical * limit], [0, limit], color="#999999", linestyle="--")
        axis.plot([center, center + critical * limit], [0, limit], color="#999999", linestyle="--")
        axis.axvline(center, color="#555555", linewidth=.8)
    axis.invert_yaxis()
    axis.set_xlabel("Study estimate on analysis scale")
    axis.set_ylabel("Standard error")
    axis.set_title("Study estimate and precision", loc="left", fontweight="bold")
    axis.spines[["top", "right"]].set_visible(False)
    figure.tight_layout()
    return _figure_bytes(figure, result["review"]["protocol_sha256"] + "funnel")


def _table(headers, rows):
    return "<table><thead><tr>" + "".join("<th>" + _h(v) + "</th>" for v in headers) + \
        "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + _h(v) + "</td>" for v in row) +
        "</tr>" for row in rows) + "</tbody></table>"


def _pool_row(label, value):
    ci = value.get("display_interval", [None, None])
    return [label, value.get("k"), _n(value.get("display_estimate")),
            " to ".join(_n(v) for v in ci), value.get("interval_method", value.get("reason")),
            _n(value.get("tau_squared")), _n(value.get("I_squared_percent"))]


def _safe_link(value, label):
    if not isinstance(value, str):
        return _h(label)
    parsed = urlsplit(value)
    if parsed.scheme not in {"https", "http"} or not parsed.netloc or parsed.username or parsed.password:
        return _h(label)
    return '<a rel="noreferrer" href="' + _h(value) + '">' + _h(label) + "</a>"


def report_html(result, metadata, figures):
    p, reviewed = result["review"]["protocol"], result["review"]
    primary = result["primary"]
    title = p["title"]
    parts = ['<!doctype html><html lang="en"><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        "<title>" + _h(title) + "</title><style>",
        "body{font:15px/1.5 system-ui,sans-serif;color:#222;background:#fff;max-width:1160px;margin:36px auto;padding:0 24px}",
        "h1{font-size:28px;line-height:1.15}h2{font-size:21px;margin-top:36px}h3{font-size:17px}p{max-width:90ch}",
        "table{border-collapse:collapse;width:100%;font-size:13px;margin:16px 0}th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}",
        "th{background:#eee}code,pre{font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}",
        "details{border:1px solid #ccc;padding:10px;margin:12px 0}summary{cursor:pointer;font-weight:600}",
        "svg{max-width:100%;height:auto}.muted{color:#555}.metric{font-size:23px;font-weight:600}.fig{margin:24px 0}",
        "a{color:#222;text-decoration:underline}@media print{body{margin:0;max-width:none;padding:0}h2,h3{break-after:avoid}tr,.fig{break-inside:avoid}details>summary{display:none}details>div{display:block}}",
        "</style><header><p class=\"muted\">Stellar Forge · Research Analysis</p><h1>" + _h(title) + "</h1>",
        "<p>" + _h(p["question"]) + "</p></header>",
        "<p><strong>Selected contrast.</strong> " + _h(p["rationale"]) + "</p>"]
    if primary["status"] == "ESTIMATED":
        parts += ['<p class="metric">' + _h(_MEASURE[p["measure"]]) + ": " +
                  _h(_n(primary["display_estimate"])) + " (" +
                  _h(" to ".join(_n(x) for x in primary["display_interval"])) + ")</p>",
                  "<p>" + _h(f'{(1-p["analysis"]["alpha"])*100:g}% interval; {primary["k"]} independent studies; ') +
                  _h(primary["interval_method"]) + ".</p>"]
    else:
        parts.append("<p>" + _h(primary["reason"]) + "</p>")
    parts.append(_table(["Protocol item", "Selected value"], [[k.title(), p["cohort"][k]] for k in p["cohort"]]))
    parts += ["<h2>Study selection</h2>",
              _table(["Published results", "Reviewed results", "Included results", "Estimable results", "Unselected results"],
                     [[reviewed["counts"][k] for k in ("published_results", "reviewed_results", "included_results",
                                                       "estimable_results", "unselected_results")]]),
              "<p>Each row retains its original Study, accepted result edition, source binding and review decision. "
              "All source values and unselected descriptors accompany this report in the complete publication file.</p>",
              _table(["Study", "State", "Decision and reason", "Effect", "Interval", "Issues"],
                [[row["label"], row["state"], row["reason"],
                  _n((row["effect"] or {}).get("display_estimate")),
                  " to ".join(_n(x) for x in (row["effect"] or {}).get("display_interval", [None, None])),
                  "; ".join(row["issues"])] for row in reviewed["rows"]]),
              "<h2>Study estimates</h2>"]
    for name, data in figures.items():
        if name.startswith("forest"):
            parts.append('<div class="fig">' + "<svg" + data.decode("utf-8").split("<svg", 1)[1] + "</div>")
    parts += ["<h2>Model and interval comparison</h2>",
              _table(["Analysis", "Studies", "Estimate", "Interval", "Interval method", "Tau squared", "I squared (%)"],
                     [_pool_row("Primary selected analysis", primary)] +
                     [_pool_row(k.replace("_", " "), v) for k, v in result["comparisons"].items()]),
              "<p>" + _h(" ".join(primary.get("notes", []))) + "</p>",
              "<h2>Sensitivity to study selection</h2>"]
    if result["leave_one_out"]:
        parts.append(_table(["Omitted study", "Remaining studies", "Estimate", "Interval", "Change on analysis scale"],
             [[v["label"], v["result"].get("k"), _n(v["result"].get("display_estimate")),
               " to ".join(_n(x) for x in v["result"].get("display_interval", [None, None])),
               _n(v["estimate_change"])] for v in result["leave_one_out"]]))
    else:
        parts.append("<p>Leave-one-study-out estimates require at least three estimable studies and the corresponding protocol selection.</p>")
    for subset in result["sensitivity_sets"]:
        parts += ["<h3>" + _h(subset["definition"]["label"]) + "</h3>",
                  "<p>" + _h(subset["definition"]["reason"]) + "</p>",
                  _table(["Analysis", "Studies", "Estimate", "Interval", "Interval method", "Tau squared", "I squared (%)"],
                         [_pool_row(subset["definition"]["label"], subset["result"])])]
    for group in result["subgroups"]:
        parts += ["<h3>" + _h(group["definition"]["label"]) + "</h3>",
                  "<p>" + _h(group["definition"]["rationale"]) + "</p>",
                  _table(["Group", "Studies", "Estimate", "Interval", "Interval method", "Tau squared", "I squared (%)"],
                         [_pool_row(v["level"] if v["level"] is not None else "Unspecified", v["result"])
                          for v in group["levels"]]),
                  "<p>" + _h(group["interpretation"]) + "</p>"]
    funnel = figures.get("funnel.svg", b"").decode("utf-8")
    if funnel:
        parts += ["<h2>Study precision</h2>", '<div class="fig"><svg' + funnel.split("<svg", 1)[1] + "</div>",
                  "<p>" + _h(result["funnel"]["interpretation"]) + "</p>"]
        if result["funnel"]["small_sample_note"]:
            parts.append("<p>" + _h(result["funnel"]["small_sample_note"]) + "</p>")
    parts += ["<h2>Methods and source editions</h2>",
              "<ol>" + "".join("<li>" + _h(note) + "</li>" for note in result["method_notes"]) + "</ol>",
              "<p>Engine: " + _h(result["engine"]["name"]) + ". " +
              _h(", ".join(f"{k} {v}" for k, v in result["engine"]["packages"].items())) + ". " +
              _safe_link(result["engine"]["methods"], "Published engine methods") + ".</p>",
              "<p>Protocol reviewer: " + _h(p["reviewer"]["name"]) + ". " +
              "Saved protocol " + _h(metadata["protocol"]["name"]) + ", revision " +
              _h(metadata["protocol"]["revision"]) + "; source " + _h(metadata["publication"]["name"]) +
              ", revision " + _h(metadata["publication"]["revision"]) + ".</p>"]
    for row in reviewed["rows"]:
        parts += ["<details><summary>" + _h(row["label"]) + " — numeric inputs and sources</summary><div>",
                  "<p>Original Study: " + _h(row["study_id"]) + ". Result: " + _h(row["result_id"]) +
                  ". Edition: " + _h(row["edition_id"]) + ".</p>"]
        if row["effect"]:
            parts += ["<p>" + _h(row["effect"]["method"]) + "</p>",
                      _table(["Analysis field", "Value used", "Transformation", "Original accepted values"],
                             [[key, value["lexical"], value["transformation"],
                               "; ".join(o["field"] + ": " + canonical(o["answer"].get("value")) for o in value["operands"])]
                              for key, value in row["effect"]["numbers"].items()])]
        parts += ["<pre>" + _h(json.dumps(row["source_bindings"], ensure_ascii=False, indent=2)) + "</pre></div></details>"]
    parts += ["<details><summary>Complete saved selection and source identity</summary><div><pre>" +
              _h(json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2)) + "</pre></div></details>",
              "<footer><p class=\"muted\">The complete downloadable package contains the original publication, "
              "protocol, accepted numeric inputs, all study decisions, calculated results, figures and file manifest.</p></footer></html>"]
    return "".join(parts).encode("utf-8")


def make_outputs(result, metadata, publication_raw, *, cancelled=lambda: None):
    cancelled()
    figures = forest_figures(result, cancelled)
    figures["funnel.svg"] = funnel_figure(result)
    rows = result["review"]["rows"]
    studies = _csv(
        ["result_id", "edition_id", "study_id", "study_version", "label", "state", "reason",
         "estimate_analysis", "variance", "standard_error", "ci_low_analysis", "ci_high_analysis",
         "estimate_display", "ci_low_display", "ci_high_display", "measure", "issues"],
        [[r["result_id"], r["edition_id"], r["study_id"], r["study_version"], r["label"], r["state"], r["reason"],
         *[(r["effect"] or {}).get(k) for k in ("estimate", "variance", "standard_error")],
         *(r["effect"] or {}).get("interval", [None, None]),
         (r["effect"] or {}).get("display_estimate"),
         *(r["effect"] or {}).get("display_interval", [None, None]),
         result["review"]["protocol"]["measure"], "; ".join(r["issues"])] for r in rows])
    diagnostics = _csv(["omitted_result_id", "omitted_study_id", "label", "remaining_studies",
                         "estimate_analysis", "ci_low_analysis", "ci_high_analysis", "tau_squared", "change"],
        [[r["omitted_result_id"], r["omitted_study_id"], r["label"], r["result"].get("k"),
          r["result"].get("estimate"), *r["result"].get("interval", [None, None]),
          r["result"].get("tau_squared"), r["estimate_change"]] for r in result["leave_one_out"]])
    files = {"result.json": _json(result), "protocol.json": _json(metadata["protocol"]),
             "publication.json": publication_raw, "studies.csv": studies, "diagnostics.csv": diagnostics,
             **figures}
    files["report.html"] = report_html(result, metadata, figures)
    cancelled()
    manifest = {"schema": "stellar-forge.evidence-synthesis-files.v1", "metadata": metadata,
                "engine": result["engine"],
                "csv_text": "Formula-leading text cells are apostrophe-prefixed; original accepted values remain in publication.json and result.json.",
                "files": [{"name": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                          for name, data in sorted(files.items())]}
    files["manifest.json"] = _json(manifest)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in sorted(files.items()):
            cancelled()
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100600 << 16
            archive.writestr(info, data)
    files["synthesis.zip"] = out.getvalue()
    return files

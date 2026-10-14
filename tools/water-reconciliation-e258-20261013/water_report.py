"""Complete offline inspector for an original water reconciliation case.

The renderer reads already-calculated result, source report and manifest objects.
It does not mutate them or calculate a new water reconciliation.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import os
from pathlib import Path
import re
import tempfile

RESULT_SCHEMA = "tjlabs.water-reconciliation.result.v1"
OFFLINE_SCHEMA = "tjlabs.water-reconciliation.offline-report.v1"


def _json(value):
    """Use the original discovery engine's canonical JSON representation."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                      allow_nan=False) + "\n"


def _sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _validate(result, source_report, original_manifest):
    for value in (result, source_report, original_manifest):
        _require(isinstance(value, dict), "Provide loaded complete JSON objects")
    _require(result.get("schema") == RESULT_SCHEMA, "Unsupported water result")
    _require(result.get("source_run_identity") == source_report.get("run_identity")
             and isinstance(result.get("source_run_identity"), str),
             "Water result and original report identify different source runs")
    _require(result.get("data_class") == source_report.get("data_class")
             == original_manifest.get("data_class"),
             "Result, report and manifest data classes differ")
    lineage = source_report.get("lineage")
    _require(isinstance(lineage, dict), "Original source lineage is required")
    _require(lineage.get("definition_sha256") == _sha(_json(original_manifest)),
             "Canonical manifest differs from the original source definition")
    _require(result.get("source_inputs") == lineage.get("inputs")
             and isinstance(result.get("source_inputs"), list),
             "Water result must retain the complete original source inventory")
    tables = original_manifest.get("tables")
    _require(isinstance(tables, list), "Original table definitions are required")
    ids = [row.get("id") for row in tables if isinstance(row, dict)]
    _require(len(ids) == len(tables) and all(
        isinstance(value, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,95}", value)
        for value in ids) and len(ids) == len(set(ids)),
        "Original table identities must be complete and unique")
    selected = []
    for item in result["source_inputs"]:
        _require(isinstance(item, dict), "Source identity must be an object")
        table = item.get("table")
        _require(table in ids and item.get("retained_path") == "inputs/" + table + ".csv",
                 "Retained source path does not match its original table")
        _require(type(item.get("bytes")) is int and item["bytes"] >= 0
                 and isinstance(item.get("sha256"), str)
                 and re.fullmatch(r"[0-9a-f]{64}", item["sha256"]),
                 "Retain each complete source byte count and SHA256")
        selected.append(table)
    _require(len(selected) == len(set(selected)) and set(selected) == set(ids),
             "Source inventory must contain every original table exactly once")
    rows = result.get("results")
    _require(isinstance(rows, list) and type(result.get("selected_periods")) is int
             and result["selected_periods"] == len(rows),
             "Selected-period count must match the complete result")
    _require(all(isinstance(row, dict) and isinstance(row.get("period_id"), str)
                 and isinstance(row.get("issues"), list) for row in rows),
             "Retain all complete period records and review items")
    _require(len({row["period_id"] for row in rows}) == len(rows),
             "Selected period identities must be unique")


def _payload_text(value):
    # JSON is in a non-executable script element. Do not permit a source value
    # to close that element or create HTML, including literal Unicode separators.
    return (_json(value).replace("&", "\\u0026").replace("<", "\\u003c")
            .replace(">", "\\u003e").replace("\u2028", "\\u2028")
            .replace("\u2029", "\\u2029"))


def _csp_hash(source):
    return base64.b64encode(hashlib.sha256(source.encode("utf-8")).digest()).decode("ascii")


def render_html(result, source_report, original_manifest):
    """Return one complete UTF-8-compatible offline HTML case inspector."""
    _validate(result, source_report, original_manifest)
    payload = {
        "schema": OFFLINE_SCHEMA,
        # Keep original JSON text intact in browser downloads. JavaScript's
        # floating-point parser must not rewrite original integer tokens.
        "result_json": _json(result),
        "source_report_json": _json(source_report),
        "original_manifest_json": _json(original_manifest),
    }
    label = str(source_report.get("label", source_report.get("edition", "Water case")))
    fallback = ['<div class="table-wrap"><table><thead><tr>',
                '<th>Period</th><th>Register gallons</th><th>AMI gallons</th>',
                '<th>Recorded gallons</th><th>Billed gallons</th><th>Review items</th>',
                '</tr></thead><tbody>']
    for row in result["results"]:
        values = [row["period_id"]]
        for name in ("register_gallons", "ami_gallons", "recorded_gallons", "billed_gallons"):
            value = row.get(name)
            values.append(value["decimal_12"] if value is not None else "Uncomputed")
        values.append(len(row["issues"]))
        fallback.append("<tr>" + "".join("<td>" + html.escape(str(x)) + "</td>"
                                         for x in values) + "</tr>")
    fallback.append("</tbody></table></div>")
    csp = ("default-src 'none'; base-uri 'none'; object-src 'none'; "
           "form-action 'none'; connect-src 'none'; img-src data:; "
           "script-src 'sha256-" + _csp_hash(_SCRIPT) + "'; "
           "style-src 'sha256-" + _csp_hash(_CSS) + "'")
    replacements = {
        "__CSP__": html.escape(csp, quote=True),
        "__TITLE__": html.escape(label, quote=True),
        "__DATA_CLASS__": html.escape(str(result["data_class"]), quote=True),
        "__CSS__": _CSS,
        "__JS__": _SCRIPT,
        "__FALLBACK__": "".join(fallback),
        "__PAYLOAD__": _payload_text(payload),
    }
    # Substitute only original template markers in one pass. A caller's literal
    # marker text is ordinary data and must never trigger another replacement.
    return re.sub(r"__(?:CSP|TITLE|DATA_CLASS|CSS|JS|FALLBACK|PAYLOAD)__",
                  lambda match: replacements[match.group(0)], _HTML)


def _read(path):
    def pairs(items):
        result = {}
        for key, value in items:
            _require(key not in result, "Duplicate original JSON key: " + key)
            result[key] = value
        return result

    def constant(value):
        raise ValueError("Nonfinite JSON value: " + value)

    return json.loads(Path(path).read_bytes().decode("utf-8"),
                      object_pairs_hook=pairs, parse_constant=constant)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--result", required=True)
    parser.add_argument("--source-report", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    temporary = None
    try:
        text = render_html(_read(args.result), _read(args.source_report), _read(args.manifest))
        destination = Path(args.output).resolve()
        _require(not destination.exists(), "Choose a new inspection filename")
        _require(destination.parent.is_dir(), "Inspection output parent must exist")
        fd, temporary = tempfile.mkstemp(prefix="." + destination.name + "-", dir=destination.parent)
        with os.fdopen(fd, "wb") as stream:
            stream.write(text.encode("utf-8"))
            stream.flush()
            os.fsync(stream.fileno())
        # An atomic no-clobber publication: a racing existing file is preserved.
        os.link(temporary, destination)
        print(json.dumps({"status": "COMPLETE", "output": str(destination),
                          "bytes": destination.stat().st_size, "sha256": _sha(text)}))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"status": "ERROR", "type": type(error).__name__, "message": str(error)}))
        return 2
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)


OPERATOR_GUIDE = r"""

### Readable narrow tables and printed inspection views

Tables retain full column widths inside keyboard-focusable horizontal scroll regions. On a narrow screen, focus the table and move horizontally to read every original value; exact decimal text remains a single value. Printed current views use landscape A4, repeated table headings and flowing sections rather than keeping an entire long card on one page. Review every produced PDF page and all visible numeric columns. A saved result or original calculation is unchanged by a presentation correction.
## Offline water case inspector

Open `water/report.html` inside the completed case, or its downloaded `Water_Case_Inspector.html`. This is a self-contained application for the **saved selected result**, source report and original canonical manifest. It needs no server, network, account or browser extension. TokenJunkieLabs (TJLabs) attribution remains in the report and all downloaded report copies.

The inspector is a view of the engine's result. It does not rerun water calculations, change the selected source, approve a field finding, edit a bill or make a refund decision. A blank calculation is displayed as **Uncomputed**; a calculated zero remains zero. Every volume/charge value uses the original exact rational and its engine-supplied twelve-place decimal display. Enable **Show full exact fractions** to inspect the numerator/denominator beside each value. Chart coordinates alone use approximate browser numbers.

### Review the complete selected case

The four cards always describe the complete case. Search and account/status filters select the visible periods; the visible count identifies both the filtered and full populations. Filtered overview CSV is explicitly a presentation export, with formula-leading cells escaped. Complete JSON and HTML downloads retain every period regardless of filters.

- **Period overview:** select a period and inspect the separate register → AMI → recorded account consumption → billed quantities. Open every coverage/exception item, exact period source record, physical-meter segment, boundary register and complete interval reference list. Source references are paged in groups of forty; no records are dropped. Period lists are paged in groups of forty.
- **Exact comparisons:** inspect the native saved tolerance decisions, including missing/uncomputed comparisons. A second pair selector compares any two visible periods using their original quantities, exact boundaries and rational right-minus-left subtraction. It applies no duration normalization and makes no new tolerance or field decision.
- **Water charge review:** inspect the selected tariff, fixed factor, each tier quantity/rate, exact component amount, line-versus-total rounding, original billed water charge and the native saved difference/decision. Water-charge scope does not silently include taxes, arrears, penalties or unrelated charges.
- **Daily & flow patterns:** select the original period, local dates and chart quantity. All filtered days are plotted; the table is paged in groups of thirty-one. Actual 23/24/25-hour days, incomplete daily allocation, night-crossing records, adjacent-complete-day differences and continuous runs retain their original meanings. The continuous-run table can show all runs or only runs meeting the selected duration; all original runs remain embedded. Patterns may be COMPLETE, NOT_SELECTED or UNCOMPUTED. No synthetic zero, interpolation or leak conclusion is introduced.
- **Sources & definitions:** inspect the complete original table definitions/profiles, full source report, original manifest, interpretation/recipe identities and all source links. Open the original water selection to inspect its complete quality/tolerance/unit/tariff interpretation.

A missing or ambiguous selected period can have no known account, timestamp or source row. It remains a visible review item with uncomputed quantities. Do not interpret the known-account count as including unresolved account identities.

### Read exact retained source records

The report is stored at `case/water/report.html`. A source link points to the existing `../inputs/<table>.csv`; original/canonical/receiving manifests and the source report remain in the parent case. Retain this directory layout when sharing the **complete case**. A separately downloaded HTML embeds all calculations and provenance, but cannot carry CSV bytes that were never passed to the renderer.

Click a table/record button to open its original identity. Record numbers count CSV data records after the header, not physical lines; a quoted multiline record is one record. Choose the retained CSV in the source dialog to read raw values. The inspector checks the complete file byte count and SHA256, then checks decoded headers and record count against the original profile before showing values. The file stays in browser memory and is not uploaded or included in a subsequent report download.

Browser drilldown supports exact UTF-8/UTF-8-with-signature, ASCII and Latin-1 source decoding. Other encodings, unsupported CSV dialects or a browser without SHA256 support remain available through the original native case reader and direct original-file link. An unverified or differently decoded source is never displayed as the original. Record numbers outside the actual retained population are explicitly absent.

### Complete downloads, reopening and keyboard use

**Download complete offline report** saves the entire embedded case plus current view settings. Open that downloaded file in a new browser page: the view is rebuilt from the original embedded inputs. No localStorage, IndexedDB or server state is needed. Source-file selections are intentionally transient; select the exact original CSV again after reopening.

**Download embedded case JSON** contains three complete JSON-text documents under `result_json`, `source_report_json` and `original_manifest_json`, with schema `tjlabs.water-reconciliation.offline-report.v1`. The JSON texts preserve exact numeric strings and integer tokens without JavaScript reserialization. Individual complete result/report/canonical-manifest downloads are also available. The byte-exact original manifest and selected interpretation are linked separately from the full case. This JSON is an inspection export, not a substitute for the engine's complete handover ZIP.

Use Tab/Shift+Tab for controls, Left/Right or Home/End within the section tabs, Enter/Space for buttons and disclosure sections, and Escape to close a source dialog. Focus returns to the source-reference button. At narrow widths, controls and quantity cards stack; wide exact tables retain horizontal scrolling. Print exports the **current view**, labelled accordingly; complete HTML/JSON and case ZIP preserve the entire selected population.

### Renderer interface and receiving

`render_html(result, source_report, original_manifest) -> str` accepts the actual loaded JSON objects and returns UTF-8-compatible HTML text. It validates the water/source run binding, original data class, complete source inventory and original canonical manifest identity. It serializes caller input without editing it, embeds it with HTML-significant characters escaped, and applies a restrictive inline-script/style content security policy. No arbitrary source URL becomes an executable or external link.

The original atomic water course calls this function and retains the exact `water_report.py` byte hash in `result.recipe_files`. Keep that selected renderer beside the original calculator when packing. For an additional inspection copy, the same source also supports:

```bash
python water_report.py \
  --result /absolute/case/water/result.json \
  --source-report /absolute/case/report.json \
  --manifest /absolute/case/manifest.json \
  --output /absolute/new-inspection.html
```

The output must be a new filename. A separately placed report still displays its entire embedded case; source links resolve correctly when it is kept in the original `water/` directory. Do not overwrite the engine-bound `report.html` after the delivery manifest is written; make a new inspection copy or a new complete engine edition.

The existing receiving owner should open the actual generated report at desktop and narrow widths, operate every main view and the source dialog, inspect actual rendered screenshots, download the complete HTML/JSON/filtered CSV, and cold reopen the downloaded HTML. Verify that incomplete/missing periods remain visible, exact source references survive, and filters do not truncate complete downloads. Source/syntax review is separate from this actual rendered receiving outcome. Use the original coordinated receiving queue, preserving selected user tabs and current owner browser instructions.

### Operate the actual generated reports with the existing browser receiver

The adjacent `receiving_water_browser.mjs` consumes the original native course's completed `receiving.json`. It does not create another dataset or rerun a water calculation. Use the receiver's actual installed Node, Playwright module and Chromium paths:

```bash
/actual/node receiving_water_browser.mjs \
  --receiving /absolute/original-water-receiving/receiving.json \
  --output /absolute/original-water-browser \
  --playwright /actual/installed/playwright/index.mjs \
  --chromium /actual/installed/chromium
```

The Playwright module must expose `chromium`; the existing Python Playwright installation's actual `driver/package/index.mjs` may be used if that installed module is present and the selected Node can import it. This helper performs no dependency installation. Keep its output outside the immutable `a/`, `b/` and `cold/` case directories.

An interrupted browser course resumes with the **same arguments and output directory plus `--resume`**. Its exact original receiving/report/helper/runtime selection must match. It preserves incomplete attempt directories and retires a prior lock only when that lock is from the same host and its original PID is observably absent; an active/foreign owner stays authoritative. Mutable progress and completion receipts publish atomically. A completed course is reused only after every saved artifact's full bytes and SHA256 is checked.

The helper operates filters, all five views, verified original CSV record loading, keyboard section selection, desktop and 390-pixel layouts, complete HTML/JSON and filtered CSV downloads, downloaded-HTML cold reopening, current-view PDF printing, and the already-generated later/native-cold report files. It saves full screenshots and exact artifact identities. `BROWSER_COURSE_COMPLETE` records those functional actions; `visual_review` remains `PENDING_ACTUAL_SCREENSHOT_AND_EXPORT_VIEWING` until the receiving owner actually opens/views all PNG/PDF/exported files under `VIEWING.md`. Carry the actual viewed result into the same original receiving thread, not a second operation.

"""

_CSS = r"""

:root{color-scheme:light;--ink:#242424;--muted:#555555;--paper:#fff;--base:#f2f2f2;--line:#c7c7c7;--navy:#242424;--teal:#383838;--ok:#333333;--warn:#333333;--error:#111111;--focus:#111111;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--base);color:var(--ink)}button,input,select{font:inherit}button,a,input,select{touch-action:manipulation}button,.button{border:1px solid var(--teal);border-radius:3px;background:var(--paper);color:var(--teal);padding:.45rem .7rem;cursor:pointer;text-decoration:none;display:inline-block}button:hover,.button:hover{background:#eeeeee}button:disabled{opacity:.5;cursor:default}button.primary{background:var(--teal);color:white}a{color:var(--teal)}:focus-visible{outline:3px solid var(--focus);outline-offset:3px}.skip{position:absolute;left:1rem;top:-5rem;background:white;padding:.6rem;z-index:10}.skip:focus{top:.5rem}
header{background:var(--navy);color:white;padding:1.3rem max(1.25rem,calc((100vw - 1500px)/2));border-bottom:5px solid var(--teal)}header a{color:white}.eyebrow{font-size:.8rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:#dddddd}h1{font-size:clamp(1.5rem,3vw,2.15rem);line-height:1.15;margin:.3rem 0 .5rem}h2{font-size:1.35rem;line-height:1.3;margin:0 0 .8rem}h3{font-size:1.05rem;margin:1.3rem 0 .5rem}p{margin:.5rem 0 1rem}header p{max-width:65rem;margin:.5rem 0}main{max-width:1500px;margin:auto;padding:1.2rem}.toolbar,.row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}.toolbar{padding:1rem 0}.toolbar .spacer{flex:1}.muted{color:var(--muted)}.small{font-size:.85rem}.mono,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.card{background:white;border:1px solid var(--line);border-radius:4px;padding:1.15rem;margin-bottom:1rem;min-width:0}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.8rem;margin:1rem 0}.stat{padding:.9rem;background:white;border:1px solid var(--line);border-top:3px solid var(--teal)}.stat strong{display:block;font-size:1.65rem}.stat span{color:var(--muted);font-size:.87rem}.banner{padding:.75rem 1rem;border-left:4px solid var(--warn);background:#f4f4f4;margin:.75rem 0}.badge{font-size:.76rem;font-weight:700;border-radius:3px;display:inline-block;padding:.2rem .45rem;background:#eeeeee;color:var(--ink);overflow-wrap:anywhere}.badge.ok{background:#e9e9e9;color:var(--ok)}.badge.warn{background:#e3e3e3;color:var(--warn)}.badge.bad{background:#dedede;color:var(--error)}
.filters{display:grid;grid-template-columns:minmax(12rem,2fr) 1fr 1fr;gap:.75rem}label{display:block;font-weight:600;font-size:.86rem}input,select{width:100%;background:white;color:var(--ink);border:1px solid #888888;border-radius:3px;padding:.55rem;margin:.2rem 0 .4rem;min-width:0}input[type=checkbox]{width:auto}nav.tabs{display:flex;flex-wrap:wrap;gap:.3rem;margin:1rem 0}nav.tabs button[aria-selected=true]{background:var(--navy);color:white;border-color:var(--navy)}.layout{display:grid;grid-template-columns:minmax(14rem,22rem) minmax(0,1fr);gap:1rem}.list{max-height:65vh;overflow:auto;padding:.25rem}.period-choice{display:block;text-align:left;width:100%;color:var(--ink);border:1px solid var(--line);border-left:4px solid transparent;margin:.35rem 0;padding:.7rem}.period-choice[aria-current=true]{border-left-color:var(--teal);background:#ededed}.period-choice strong{display:block;overflow-wrap:anywhere}.period-choice .small{display:block;color:var(--muted)}.pager{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:.7rem 0}.pager span{margin-right:auto}.table-wrap{overflow:auto;max-width:100%;margin:.8rem 0;border:1px solid var(--line);overscroll-behavior-inline:contain}table{border-collapse:collapse;min-width:max(100%,46rem);font-size:.88rem}caption{text-align:left;font-weight:700;padding:.6rem;background:#f1f1f1}th,td{text-align:left;vertical-align:top;padding:.55rem .65rem;border-bottom:1px solid var(--line);min-width:7rem;overflow-wrap:normal;word-break:normal}th{background:#eeeeee;white-space:normal}td.num{font-variant-numeric:tabular-nums;white-space:nowrap}.quantity{font-variant-numeric:tabular-nums;white-space:nowrap}.quantity small{display:block;font-family:ui-monospace,monospace;font-size:.72rem;color:var(--muted);white-space:normal;overflow-wrap:anywhere}.chain{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.5rem}.chain .node{padding:.75rem;background:#f2f2f2;border:1px solid var(--line)}.chain .node strong{display:block;font-size:.8rem;text-transform:uppercase}.chain .quantity{display:block;font-size:1.15rem;margin:.4rem 0}.definition{display:grid;grid-template-columns:minmax(8rem,1fr) minmax(0,3fr);gap:.35rem 1rem;margin:.5rem 0}.definition dt{font-weight:600;color:var(--muted)}.definition dd{margin:0;overflow-wrap:anywhere}.refs{display:flex;gap:.3rem;flex-wrap:wrap}.refs button{font-size:.8rem;padding:.2rem .4rem}.json{white-space:pre-wrap;overflow-wrap:anywhere;font: .8rem/1.5 ui-monospace,monospace;background:#f4f4f4;padding:.8rem;max-height:36rem;overflow:auto}.issue{padding:.8rem 0;border-bottom:1px solid var(--line)}.issue h3{margin:0 0 .4rem}.empty{padding:1rem;background:#f5f5f5;color:var(--muted)}details{margin:.6rem 0}summary{cursor:pointer;font-weight:600;padding:.35rem 0}.chart{display:block;width:100%;min-height:170px;background:#f5f5f5;border:1px solid var(--line);margin:.6rem 0}.chart text{font-family:system-ui,sans-serif;font-size:12px;fill:var(--muted)}.charts{display:grid;grid-template-columns:1fr;gap:.5rem}.view-controls{display:flex;flex-wrap:wrap;gap:1rem}.view-controls label{font-weight:400}.notice{min-height:1.5rem;padding:.4rem 0;color:var(--teal)}dialog{width:min(62rem,calc(100vw - 1.5rem));max-height:90vh;overflow:auto;border:1px solid var(--line);border-radius:5px;padding:1.2rem;color:var(--ink)}dialog::backdrop{background:#00000099}dialog .close{float:right}.split{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.source-link{display:inline-block;margin:.3rem .5rem .3rem 0}footer{max-width:1500px;margin:auto;padding:1rem 1.2rem 2rem;color:var(--muted);font-size:.85rem;border-top:1px solid var(--line)}[hidden]{display:none!important}#fatal{border:2px solid var(--error)}
@media(max-width:850px){.layout{grid-template-columns:1fr}.list{max-height:20rem}.filters{grid-template-columns:1fr 1fr}.filters label:first-child{grid-column:1/-1}.chain{grid-template-columns:1fr 1fr}.summary{grid-template-columns:1fr 1fr}.split{grid-template-columns:1fr}}
@media(max-width:480px){main{padding:.7rem}.card{padding:.8rem}.filters{grid-template-columns:1fr}.filters label:first-child{grid-column:auto}.chain{grid-template-columns:1fr}.definition{grid-template-columns:1fr}.definition dd{margin-bottom:.4rem}.toolbar>*{flex-grow:1}.tabs button{flex:1 1 40%}.summary{gap:.4rem}.stat strong{font-size:1.35rem}.row>*{max-width:100%}}
@page{size:A4 landscape;margin:12mm}
@media print{
 :root{font-size:11px;line-height:1.35}body{background:white}header{background:white;color:#111;border-color:#777;padding:.4rem 0;break-inside:avoid}header .eyebrow{color:#333}header h1{font-size:1.45rem;margin:.2rem 0}header p{margin:.2rem 0}
 .toolbar,.filters,.tabs,.list,.pager,.view-controls,.no-print,dialog,#notice{display:none!important}
 .layout{display:block}.layout>aside{display:none}.card{break-inside:auto;border-color:#bbb;padding:.65rem;margin-bottom:.6rem}main{max-width:none;padding:0}main>p.small.muted{display:none}
 .summary{grid-template-columns:repeat(4,minmax(0,1fr));gap:.4rem;margin:.5rem 0;break-inside:avoid}.stat{padding:.35rem .6rem}.stat strong{font-size:1.25rem}.stat span{font-size:.85rem}.banner{background:white;margin:.4rem 0;padding:.4rem .6rem}
 h2,h3{break-after:avoid;margin:.65rem 0 .35rem}h2{font-size:1.15rem}.definition{grid-template-columns:11rem minmax(0,1fr);gap:.15rem .6rem}
 .table-wrap{overflow:visible;max-width:none;border:0;break-inside:auto}table{width:100%;min-width:100%;font-size:10px;table-layout:auto}thead{display:table-header-group}tr{break-inside:avoid}th,td{min-width:0;padding:.35rem .4rem;overflow-wrap:normal;word-break:normal}
 .quantity{white-space:nowrap}.quantity small{display:block!important;font-size:8px;white-space:normal;overflow-wrap:anywhere}.json{max-height:none;font-size:9px}details{break-inside:auto}.chart{max-height:180px}.issue{break-inside:avoid}.refs button{font-size:9px;padding:.1rem .3rem}footer{padding:.4rem 0;font-size:9px;break-inside:avoid}.print-note{display:block!important}
}

.raw-cell{white-space:pre-wrap;margin:0;font:inherit;overflow-wrap:anywhere}
"""

_HTML = r"""
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="__CSP__"><title>__TITLE__ — water case inspector</title>
<style>__CSS__</style></head><body>
<a class="skip" href="#main">Skip to case review</a>
<header><div class="eyebrow">TJLabs · Water evidence workbench</div><h1>Meter, interval &amp; bill reconciliation</h1><p id="case-label">__TITLE__</p><div class="row"><span id="data-class" class="badge">__DATA_CLASS__</span><span id="edition" class="small"></span></div></header>
<main id="main" tabindex="-1">
<div id="fatal" class="card" hidden></div>
<div class="toolbar"><button id="download-html" class="primary">Download complete offline report</button><button id="download-json">Download embedded case JSON</button><button id="download-csv">Download filtered overview CSV</button><span class="spacer"></span><button id="print">Print current view</button></div>
<p class="small muted">Complete calculated results, the source report and original manifest are embedded. Original CSV files stay in the complete case; open their retained links or choose the exact file for verified record drilldown. Filters never change the saved result.</p>
<div id="notice" class="notice" role="status" aria-live="polite"></div>
<div class="banner" id="meaning"></div>
<section class="summary" aria-label="Complete selected case summary" id="summary"></section>
<section class="card" aria-labelledby="filter-title"><h2 id="filter-title">Select the review view</h2><div class="filters">
<label for="period-filter">Find a period, account or issue code<input id="period-filter" type="search" autocomplete="off" placeholder="Search the complete selected case"></label>
<label for="account-filter">Account<select id="account-filter"><option value="">All selected accounts</option></select></label>
<label for="review-filter">Review status<select id="review-filter"><option value="all">All selected periods</option><option value="issues">With review items</option><option value="reconciled">Reconciled within selected tolerances</option><option value="uncomputed">With uncomputed quantities</option></select></label></div>
<div class="view-controls"><label><input type="checkbox" id="exact-values"> Show full exact fractions beside values</label><button id="reset-filters">Reset filters</button></div><p id="filter-count" class="small muted"></p></section>
<nav class="tabs" role="tablist" aria-label="Case review sections">
<button role="tab" id="tab-overview" data-panel="overview" aria-controls="panel-overview" aria-selected="true">Period overview</button>
<button role="tab" id="tab-comparisons" data-panel="comparisons" aria-controls="panel-comparisons" aria-selected="false" tabindex="-1">Exact comparisons</button>
<button role="tab" id="tab-charges" data-panel="charges" aria-controls="panel-charges" aria-selected="false" tabindex="-1">Water charge review</button>
<button role="tab" id="tab-patterns" data-panel="patterns" aria-controls="panel-patterns" aria-selected="false" tabindex="-1">Daily &amp; flow patterns</button>
<button role="tab" id="tab-sources" data-panel="sources" aria-controls="panel-sources" aria-selected="false" tabindex="-1">Sources &amp; definitions</button></nav>
<section id="panel-overview" role="tabpanel" aria-labelledby="tab-overview"><div class="layout"><aside class="card"><h2>Selected periods</h2><div id="period-list" class="list"></div><div id="period-pager"></div></aside><article id="period-detail" class="card"></article></div></section>
<section id="panel-comparisons" role="tabpanel" aria-labelledby="tab-comparisons" hidden class="card"></section>
<section id="panel-charges" role="tabpanel" aria-labelledby="tab-charges" hidden class="card"></section>
<section id="panel-patterns" role="tabpanel" aria-labelledby="tab-patterns" hidden class="card"></section>
<section id="panel-sources" role="tabpanel" aria-labelledby="tab-sources" hidden class="card"></section>
<p class="print-note small" hidden>Printed review view only. The complete offline HTML and original case retain all selected records and source identities.</p>
<noscript><section class="card"><h2>Complete selected-period overview</h2><p>Enable JavaScript for filtering, source drilldown and complete exact-value views. The saved case JSON and CSV remain available beside this report.</p>__FALLBACK__</section></noscript>
</main>
<dialog id="source-dialog" aria-labelledby="source-title"><button class="close" id="source-close" aria-label="Close source record">Close</button><h2 id="source-title">Retained source record</h2><div id="source-content"></div></dialog>
<footer><strong>TokenJunkieLabs (TJLabs)</strong> · Source-bound engineering review. Retain this attribution when sharing the report.<br>Recorded arithmetic, coverage and descriptive usage patterns do not independently establish a leak, meter defect, payment liability or approved refund.</footer>
<script id="water-payload" type="application/json">__PAYLOAD__</script>
<script id="water-view" type="application/json">{}</script>
<script>__JS__</script>
</body></html>
"""

_SCRIPT = r"""

"use strict";
(()=>{
const $=id=>document.getElementById(id), esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
window.addEventListener("error",event=>{const box=$("fatal");box.hidden=false;box.textContent="This view could not finish rendering: "+event.message+". Original result.json and source files remain unchanged.";});
const lazy=new Map();let lazySequence=0;
const raw=JSON.parse($("water-payload").textContent), R=JSON.parse(raw.result_json), S=JSON.parse(raw.source_report_json), M=JSON.parse(raw.original_manifest_json);
const all=R.results, inputByTable=new Map(R.source_inputs.map(x=>[x.table,x])), tableById=new Map(M.tables.map(x=>[x.id,x]));
const profileById=new Map((S.tables||[]).map(x=>[x.id,x])), cache=new Map();
const panels=["overview","comparisons","charges","patterns","sources"];
const defaults={panel:"overview",query:"",account:"",review:"all",exact:false,period:0,page:0,compareA:0,compareB:Math.min(1,all.length-1),dayFrom:"",dayTo:"",dayMetric:"gallons",dayPage:0,runPage:0,qualifyingOnly:false};
let state={...defaults}, filtered=[], focusBeforeDialog=null, currentRef=null, sourceToken=0;
try{const saved=JSON.parse($("water-view").textContent);for(const k of Object.keys(defaults)){if(typeof saved[k]===typeof defaults[k])state[k]=saved[k];}}catch{}
if(!panels.includes(state.panel))state.panel="overview";
for(const k of ["period","compareA","compareB"])if(!Number.isInteger(state[k])||state[k]<0||state[k]>=all.length)state[k]=defaults[k];
const notice=text=>{$("notice").textContent=text;};
const pretty=x=>JSON.stringify(x,null,2);
const detail=(title,x)=>{const id=String(++lazySequence);lazy.set(id,{kind:"json",value:x});return '<details data-lazy="'+id+'"><summary>'+esc(title)+'</summary><div></div></details>';};
const badge=(text,kind="")=>'<span class="badge '+esc(kind)+'">'+esc(text)+'</span>';
function q(x){if(x===null||x===undefined)return '<span class="muted">Uncomputed</span>';if(typeof x!=="object")return esc(x);const full=String(x.numerator)+"/"+String(x.denominator);return '<span class="quantity" title="Exact: '+esc(full)+'">'+esc(x.decimal_12??full)+(state.exact?'<small>'+esc(full)+'</small>':'')+'</span>';}
function bool(v){return v===true?badge("Within selected tolerance","ok"):v===false?badge("Outside selected tolerance","warn"):badge("Uncomputed");}
const defs=items=>'<dl class="definition">'+items.map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+v+'</dd>').join("")+'</dl>';
const grid=(headers,rows,caption="")=>'<div class="table-wrap" tabindex="0" role="region" aria-label="'+esc((caption||headers.join(" · "))+"; scroll horizontally for complete columns")+'"><table>'+(caption?'<caption>'+esc(caption)+'</caption>':'')+'<thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(c=>'<td>'+c+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
function refs(list){if(!Array.isArray(list)||!list.length)return '<span class="muted">No source references supplied</span>';return '<div class="refs">'+list.map(x=>'<button data-source="'+esc(JSON.stringify(x))+'">'+esc(x.table??"Unresolved table")+' · record '+esc(x.record??"?")+'</button>').join("")+'</div>';}
function refsPaged(list,label="Retained source records"){if(!list?.length)return refs([]);if(list.length<=12)return refs(list);const id=String(++lazySequence);lazy.set(id,{kind:"refs",value:list,page:0});return '<details data-lazy="'+id+'"><summary>'+esc(label)+' ('+list.length+')</summary><div></div></details>';}
function renderLazy(box,id){const item=lazy.get(id);if(!item)return;if(item.kind==="json"){box.innerHTML='<pre class="json">'+esc(pretty(item.value))+'</pre>';return;}const count=item.value.length,limit=40;item.page=Math.max(0,Math.min(item.page,Math.ceil(count/limit)-1));box.innerHTML=refs(item.value.slice(item.page*limit,(item.page+1)*limit))+'<div class="pager"><span class="small">'+(item.page*limit+1)+'–'+Math.min(count,(item.page+1)*limit)+' of '+count+' original references</span><button data-ref-page="'+id+'" data-delta="-1" '+(item.page===0?'disabled':'')+'>Previous references</button><button data-ref-page="'+id+'" data-delta="1" '+((item.page+1)*limit>=count?'disabled':'')+'>Next references</button></div>';}
document.addEventListener("toggle",e=>{const d=e.target;if(d.matches?.("details[data-lazy]")&&d.open&&!d.dataset.loaded){renderLazy(d.lastElementChild,d.dataset.lazy);d.dataset.loaded="true";}},true);
function pager(id,count,page,size){const last=Math.max(0,Math.ceil(count/size)-1);return '<div class="pager"><span class="small">'+(count?((page*size+1)+"–"+Math.min(count,(page+1)*size)):"0")+' of '+count+'</span><button data-page="'+id+'" data-delta="-1" '+(page<=0?'disabled':'')+'>Previous</button><button data-page="'+id+'" data-delta="1" '+(page>=last?'disabled':'')+'>Next</button></div>';}
function issueRows(items){if(!items?.length)return '<p class="empty">No engine review items for this selected period.</p>';return items.map(x=>{let d=x.detail;try{d=JSON.parse(d);}catch{}return '<section class="issue"><h3>'+esc(x.code)+'</h3>'+(typeof d==="object"?'<pre class="json">'+esc(pretty(d))+'</pre>':'<p>'+esc(d)+'</p>')+refsPaged(x.source_records)+'</section>';}).join("");}
function periodOptions(selected){return filtered.map(i=>'<option value="'+i+'" '+(i===selected?'selected':'')+'>'+esc(all[i].period_id+' · '+(all[i].account_id??"Unresolved account"))+'</option>').join("");}
function periodSelector(){return '<label for="active-period">Inspect a selected period<select id="active-period">'+periodOptions(state.period)+'</select></label>';}
function volumeChain(row){return '<div class="chain">'+[["register","Register"],["ami","AMI"],["recorded","Separate recorded"],["billed","Billed"]].map(([key,label])=>'<div class="node"><strong>'+label+'</strong>'+q(row[key+"_gallons"])+'<span class="small muted">US gallons</span></div>').join("")+'</div>';}
function compareTable(row){const expected=[["register","ami"],["ami","recorded"],["recorded","billed"],["register","billed"]];return grid(["Saved comparison","From · gallons","To · gallons","To − from · gallons","Engine decision"],expected.map(([a,b])=>{const c=(row.comparisons||[]).find(x=>x.from===a&&x.to===b);return [esc(a+" → "+b),q(row[a+"_gallons"]),q(row[b+"_gallons"]),q(c?.difference_gallons),bool(c?.within_selected_tolerance)];}),"Exact selected-period volume comparisons");}
function applyFilters(){
 const query=state.query.toLocaleLowerCase();filtered=all.map((_,i)=>i).filter(i=>{const r=all[i];return (!state.account||r.account_id===state.account)&&(!query||[r.period_id,r.account_id,...(r.issues||[]).map(x=>x.code)].join(" ").toLocaleLowerCase().includes(query))&&(state.review==="all"||(state.review==="issues"&&r.issues?.length)||(state.review==="reconciled"&&r.classification==="RECONCILED_WITHIN_SELECTED_TOLERANCES")||(state.review==="uncomputed"&&["register","ami","recorded","billed"].some(k=>r[k+"_gallons"]==null)));});
 if(!filtered.includes(state.period))state.period=filtered[0]??-1;
 state.page=Math.max(0,Math.min(state.page,Math.ceil(filtered.length/40)-1));
 for(const k of ["compareA","compareB"])if(!filtered.includes(state[k]))state[k]=filtered[k==="compareB"?1:0]??filtered[0]??-1;
 $("filter-count").textContent=filtered.length+" of "+all.length+" selected periods visible. The case and complete downloads still contain all "+all.length+".";
}
function renderOverview(){
 const rows=filtered.slice(state.page*40,(state.page+1)*40);
 $("period-list").innerHTML=rows.length?rows.map(i=>{const r=all[i];return '<button class="period-choice" data-period="'+i+'" aria-current="'+(state.period===i)+'"><strong>'+esc(r.period_id)+'</strong><span class="small">'+esc(r.account_id??"Unresolved account")+'</span><span class="small">'+esc(r.period?.start??"Unresolved start")+' → '+esc(r.period?.end??"Unresolved end")+'</span>'+badge((r.issues||[]).length+" review items",r.issues?.length?"warn":"ok")+'</button>';}).join(""):'<p class="empty">No periods match these filters.</p>';
 $("period-pager").innerHTML=pager("page",filtered.length,state.page,40);
 const r=all[state.period];if(!r){$("period-detail").innerHTML='<h2>No matching period</h2><p>Change or reset the filters to continue.</p>';return;}
 $("period-detail").innerHTML='<h2>'+esc(r.period_id)+'</h2>'+badge(r.classification,r.classification==="RECONCILED_WITHIN_SELECTED_TOLERANCES"?"ok":"warn")+defs([["Account",esc(r.account_id??"Unresolved")],["Exact source period",esc((r.period?.start??"Unresolved")+" → "+(r.period?.end??"Unresolved"))],["Period row",r.source_record?refs([r.source_record]):refs([])]])+volumeChain(r)+compareTable(r)+'<h3>Coverage and exceptions · '+(r.issues||[]).length+'</h3>'+issueRows(r.issues)+'<h3>Physical-meter segments · '+(r.segments||[]).length+'</h3>'+((r.segments||[]).map(s=>'<details><summary>'+esc(s.segment_id)+'</summary>'+defs([["Register gallons",q(s.register_gallons)],["AMI gallons",q(s.ami_gallons)],["Average gallons/minute",q(s.average_gallons_per_minute)],["Same-average 30-day gallons",q(s.same_average_30_day_gallons)]])+'<p class="small muted">'+esc(s.projection_meaning??"Unavailable calculations remain uncomputed.")+'</p>'+refs(s.source_record?[s.source_record]:[])+'<h3>Boundary register records</h3>'+refsPaged(s.register_records)+'<h3>Retained interval records</h3>'+refsPaged(s.interval_records)+detail("Complete saved segment",s)+'</details>').join("")||'<p class="empty">No resolved segment was retained.</p>')+detail("Complete saved period result",r);
}
function fractionDelta(a,b){if(!a||!b)return '<span class="muted">Uncomputed</span>';try{let n=BigInt(b.numerator)*BigInt(a.denominator)-BigInt(a.numerator)*BigInt(b.denominator),d=BigInt(a.denominator)*BigInt(b.denominator);if(d<=0n)throw Error("Invalid denominator");let x=n<0n?-n:n,y=d;while(y){const z=x%y;x=y;y=z;}const g=x||1n;n/=g;d/=g;return '<span class="mono">'+esc(n.toString()+"/"+d.toString())+'</span>';}catch{return '<span class="muted">Exact difference unavailable; inspect the original values.</span>';}}
function renderComparisons(){
 const host=$("panel-comparisons");if(!filtered.length){host.innerHTML='<h2>Exact comparisons</h2><p class="empty">No periods match the filters.</p>';return;}
 const r=all[state.period],a=all[state.compareA],b=all[state.compareB];
 host.innerHTML='<h2>Exact volume comparisons</h2>'+periodSelector()+compareTable(r)+'<p class="small muted">Tolerance decisions are the stored engine decisions for this period. A missing comparison is uncomputed; zero is a calculated value.</p><h3>Compare two selected periods</h3><div class="split"><label for="compare-a">Left period<select id="compare-a">'+periodOptions(state.compareA)+'</select></label><label for="compare-b">Right period<select id="compare-b">'+periodOptions(state.compareB)+'</select></label></div>'+defs([["Left boundary",esc((a.period?.start??"Unresolved")+" → "+(a.period?.end??"Unresolved"))],["Right boundary",esc((b.period?.start??"Unresolved")+" → "+(b.period?.end??"Unresolved"))]])+'<p>These are the original complete selected periods. No duration normalization or tariff assumption is applied. The last column is an exact rational subtraction (right minus left), not a new reconciliation decision.</p>'+grid(["Quantity · US gallons","Left: "+a.period_id,"Right: "+b.period_id,"Exact right − left"],["register","ami","recorded","billed"].map(k=>[esc(k),q(a[k+"_gallons"]),q(b[k+"_gallons"]),fractionDelta(a[k+"_gallons"],b[k+"_gallons"])]))+detail("Left complete saved result",a)+detail("Right complete saved result",b);
}
function renderCharges(){
 const host=$("panel-charges");if(!filtered.length){host.innerHTML='<h2>Water charge review</h2><p class="empty">No periods match the filters.</p>';return;}
 const r=all[state.period],b=r.billing;host.innerHTML='<h2>Reviewed water charge lines</h2>'+periodSelector()+(b?defs([["Tariff",esc(b.tariff_id)],["Currency",esc(b.currency)],["Chargeable quantity",q(b.chargeable_quantity)+" "+esc(b.quantity_unit)],["Calculated water charge",q(b.amount)],["Original billed water charge",q(b.billed_water_charge)],["Billed − calculated",q(b.difference)],["Engine decision",bool(b.within_selected_tolerance)],["Rounding",esc(b.rounding_stage+" · "+b.rounding_mode)]])+grid(["Line","Quantity","Price per unit","Exact line amount","Individually rounded charge"],b.components.map(c=>[esc(c.kind+(c.tier?" "+c.tier:"")),q(c.quantity),esc(c.price_per_unit??"See fixed-charge interpretation"),q(c.amount),c.charged_amount==null?'<span class="muted">Total rounding; no separate charged line</span>':q(c.charged_amount)]))+'<p class="banner">'+esc(b.scope)+'</p><h3>Original tariff evidence</h3>'+refsPaged(b.source_records)+detail("Complete saved tariff calculation",b):'<p class="empty">The reviewed water charge could not be calculated. Inspect the exact source and issue below.</p>')+'<h3>Relevant period review items</h3>'+issueRows((r.issues||[]).filter(x=>/BILL|CHARGE|TARIFF|RECORDED/.test(x.code)));
}
function chart(days,metric){
 const vals=days.map(d=>d[metric]==null?null:Number(d[metric].decimal_12)), finite=vals.filter(x=>x!==null&&Number.isFinite(x)), max=finite.reduce((m,x)=>Math.max(m,x),0), width=900,height=195,left=60,base=150,area=820,step=area/Math.max(1,days.length);
 if(!days.length)return '<p class="empty">No dates match this pattern filter.</p>';
 const bars=days.map((d,i)=>{const v=vals[i],x=left+i*step,h=v!==null&&Number.isFinite(v)&&max>0?Math.max(0,v/max*115):0;return '<g><title>'+esc(d.local_date+": "+(d[metric]?.decimal_12??"uncomputed"))+'</title>'+(v===null||!Number.isFinite(v)?'<path d="M'+(x+step/2-2)+' 143 l4 4 m-4 0 l4 -4" stroke="#444444"/>':'<rect x="'+x+'" y="'+(base-h)+'" width="'+Math.max(.6,step-1)+'" height="'+Math.max(.8,h)+'" fill="#444444"/>')+'</g>';}).join("");
 return '<svg class="chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+esc(metric+' by local date; exact values and source links in the following table')+'"><text x="8" y="28">'+esc(max.toPrecision(4))+'</text><text x="30" y="154">0</text><path d="M60 30 V150 H880" fill="none" stroke="#888888"/>'+bars+'<text x="60" y="176">'+esc(days[0].local_date)+'</text><text x="880" y="176" text-anchor="end">'+esc(days[days.length-1].local_date)+'</text></svg><p class="small muted">Every filtered day is plotted. Plot heights use approximate display coordinates only; the table retains exact engine values. × means uncomputed or outside numeric chart range, not zero.</p>';
}
function renderPatterns(){
 const host=$("panel-patterns");if(!filtered.length){host.innerHTML='<h2>Usage patterns</h2><p class="empty">No periods match the filters.</p>';return;}
 const p=all[state.period].patterns??{status:"UNCOMPUTED",reason:"Resolve this period's source and coverage issues first."};
 let html='<h2>Daily, night and continuous-use observations</h2>'+periodSelector()+badge(p.status,p.status==="COMPLETE"?"ok":"warn");
 if(p.status!=="COMPLETE"){host.innerHTML=html+'<p class="empty">'+esc(p.reason??"Pattern criteria were not selected for this case.")+'</p>'+detail("Saved pattern state",p);return;}
 const criteria=p.criteria??{},days=(p.daily||[]).filter(x=>(!state.dayFrom||x.local_date>=state.dayFrom)&&(!state.dayTo||x.local_date<=state.dayTo));
 state.dayPage=Math.max(0,Math.min(state.dayPage,Math.ceil(days.length/31)-1));
 const metrics={gallons:"Daily volume · US gallons",night_gallons:"Night volume · US gallons",minimum_interval_gpm:"Minimum interval flow · gallons/minute",maximum_interval_gpm:"Maximum interval flow · gallons/minute"};
 if(!Object.hasOwn(metrics,state.dayMetric))state.dayMetric="gallons";
 html+='<p class="banner">'+esc(p.meaning)+'</p>'+defs([["Local timezone",esc(criteria.timezone)],["Night clock hours",esc((criteria.night_hours||[]).join(", "))],["Continuous-flow threshold",esc(criteria.continuous_threshold_gpm)+" gallons/minute; each interval must be above the threshold"],["Selected duration",esc(criteria.minimum_continuous_hours)+" elapsed hours"],["Interpretation",esc(criteria.interpretation_reference)]])+'<div class="filters"><label for="day-from">First local date<input id="day-from" type="date" value="'+esc(state.dayFrom)+'"></label><label for="day-to">Last local date<input id="day-to" type="date" value="'+esc(state.dayTo)+'"></label><label for="day-metric">Plot quantity<select id="day-metric">'+Object.entries(metrics).map(([k,v])=>'<option value="'+k+'" '+(state.dayMetric===k?'selected':'')+'>'+esc(v)+'</option>').join("")+'</select></label></div>'+chart(days,state.dayMetric);
 html+=grid(["Local date / coverage","Actual day hours","Daily gallons","Night gallons / observed hours","Interval flow · min / max GPM","Change from adjacent complete day","Original records"],days.slice(state.dayPage*31,(state.dayPage+1)*31).map(d=>[esc(d.local_date)+"<br>"+badge(d.complete_day?"Complete day":"Uncomputed day",d.complete_day?"ok":"warn")+(d.coverage_note?'<p class="small">'+esc(d.coverage_note)+'</p>':""),q(d.actual_day_hours),q(d.gallons),q(d.night_gallons)+"<br>"+q(d.night_observed_hours),q(d.minimum_interval_gpm)+"<br>"+q(d.maximum_interval_gpm),q(d.previous_complete_day_difference_gallons)+'<span class="small"> gallons</span><br>'+q(d.previous_complete_day_relative_change)+'<span class="small"> relative ratio</span>',refsPaged(d.source_records)+((d.night_crossing_records||[]).length?'<p>Intervals crossing selected night hours: no proration.</p>'+refsPaged(d.night_crossing_records):"")]),"Complete saved daily records · "+days.length+" of "+p.daily.length+" dates")+pager("dayPage",days.length,state.dayPage,31);
 const runs=(p.continuous_runs||[]).filter(r=>!state.qualifyingOnly||r.meets_selected_duration);state.runPage=Math.max(0,Math.min(state.runPage,Math.ceil(runs.length/25)-1));
 html+='<h3>Continuous runs above the selected interval threshold</h3><label><input type="checkbox" id="qualifying-only" '+(state.qualifyingOnly?'checked':'')+'> Show only runs meeting the selected duration</label>'+grid(["Exact elapsed boundaries","Elapsed hours","Gallons","Minimum interval GPM","Duration criterion","Original records"],runs.slice(state.runPage*25,(state.runPage+1)*25).map(r=>[esc(r.start)+"<br>"+esc(r.end),q(r.elapsed_hours),q(r.gallons),q(r.minimum_interval_gpm),badge(r.meets_selected_duration?"Meets selected duration":"Shorter than selected duration",r.meets_selected_duration?"warn":""),refsPaged(r.source_records)]),"Saved continuous runs · "+runs.length+" of "+p.continuous_runs.length)+pager("runPage",runs.length,state.runPage,25)+detail("Complete saved pattern result, including every date and run",p);
 host.innerHTML=html;
}
function retainedHref(row){return row&&row.retained_path==="inputs/"+row.table+".csv"&&/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/.test(row.table)?"../inputs/"+encodeURIComponent(row.table)+".csv":null;}
function inputLink(row){const href=retainedHref(row);return href?'<a class="source-link" href="'+esc(href)+'" download>Open retained '+esc(row.table)+'.csv</a>':'<span class="muted">No safe retained-file link</span>';}
function renderSources(){
 $("panel-sources").innerHTML='<h2>Original sources, definitions and full case</h2>'+defs([["Source case",'<span class="mono">'+esc(R.source_run_identity)+'</span>'],["Original edition",esc(S.edition)],["Data class",esc(R.data_class)],["Source quality",badge(S.quality_status,S.quality_status==="PASS"?"ok":"warn")],["Selected interpretation",esc(R.interpretation_reference)],["Selection SHA256",'<span class="mono">'+esc(R.selection_sha256)+'</span>']])+'<p>Record numbers are one-based CSV data records after the header. Quoted multiline records are not physical line numbers. A record button opens its exact table identity, source path, schema and profile; choosing the retained file verifies its bytes and SHA256 before displaying raw values.</p><div class="row"><button data-download="result_json">Download full result JSON</button><button data-download="source_report_json">Download full source report JSON</button><button data-download="original_manifest_json">Download complete canonical manifest JSON</button></div><div class="row"><a class="source-link" href="../manifest.original.json" download>Original manifest bytes</a><a class="source-link" href="../manifest.receiving.json" download>Receiving manifest</a><a class="source-link" href="selection.original.json" download>Original water selection</a><a class="source-link" href="review-items.csv" download>Complete engine review-items CSV</a></div>'+R.source_inputs.map(s=>{const p=profileById.get(s.table),m=tableById.get(s.table);return '<section class="issue"><h3>'+esc(s.table)+'</h3>'+inputLink(s)+defs([["Original path",esc(s.original_path)],["Retained path",esc(s.retained_path)],["Original bytes",esc(s.bytes)],["SHA256",'<span class="mono">'+esc(s.sha256)+'</span>'],["Records",esc(p?.rows??"Not supplied")],["Valid / invalid records",esc(p?.valid_rows??"Not supplied")+" / "+esc(p?.invalid_rows??"Not supplied")]])+'<button data-source="'+esc(JSON.stringify({table:s.table,record:1}))+'">Inspect records from this source</button>'+detail("Complete original field definitions",m)+detail("Complete saved source profile",p)+'</section>';}).join("")+detail("Complete source report: full profile, metrics, relations and registers",S)+detail("Complete original manifest and authorization",M)+detail("Selected recipe file identities",R.recipe_files||[]);
}
function render(){
 lazy.clear();applyFilters();for(const p of panels){$("panel-"+p).hidden=p!==state.panel;const b=$("tab-"+p);b.setAttribute("aria-selected",String(p===state.panel));b.tabIndex=p===state.panel?0:-1;}
 if(state.panel==="overview")renderOverview();else if(state.panel==="comparisons")renderComparisons();else if(state.panel==="charges")renderCharges();else if(state.panel==="patterns")renderPatterns();else renderSources();
}
function download(name,text,type="application/json"){
 const a=document.createElement("a"),u=URL.createObjectURL(new Blob([text],{type}));a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);
}
function safeScript(text){return text.replace(/</g,"\\u003c").replace(/>/g,"\\u003e").replace(/&/g,"\\u0026").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");}
function downloadHTML(){
 const clone=document.documentElement.cloneNode(true);clone.querySelector("#water-view").textContent=safeScript(JSON.stringify(state));clone.querySelector("#source-dialog").removeAttribute("open");clone.querySelector("#source-content").replaceChildren();clone.querySelector("#notice").textContent="";
 for(const id of ["period-list","period-pager","period-detail","panel-comparisons","panel-charges","panel-patterns","panel-sources","summary"])clone.querySelector("#"+id).replaceChildren();
 // UI is regenerated from the immutable embedded inputs on cold reopen.
 download("Water_Case_Inspector.html","<!doctype html>\n"+clone.outerHTML,"text/html;charset=utf-8");notice("Complete offline HTML downloaded, with all case data and the current view settings.");
}
function csvCell(v){const s=String(v??"");const safe=/^[\s]*[=+\-@]/.test(s)?"'"+s:s;return '"'+safe.replace(/"/g,'""')+'"';}
function downloadCSV(){
 const headers=["period_id","account_id","start","end","classification","register_gallons","ami_gallons","recorded_gallons","billed_gallons","issue_count"];
 const rows=filtered.map(i=>{const r=all[i];return[r.period_id,r.account_id,r.period?.start,r.period?.end,r.classification,...["register","ami","recorded","billed"].map(k=>r[k+"_gallons"]?.decimal_12??"UNCOMPUTED"),r.issues?.length??0];});
 download("Water_Filtered_Overview.csv",[headers,...rows].map(x=>x.map(csvCell).join(",")).join("\r\n")+"\r\n","text/csv;charset=utf-8");notice("Filtered overview exported: "+rows.length+" of "+all.length+" selected periods. Exact fractions remain in the complete JSON/HTML.");
}
function sourceBody(ref,message=""){
 const s=inputByTable.get(ref.table),m=tableById.get(ref.table),p=profileById.get(ref.table),parsed=cache.get(ref.table),n=Number(ref.record);
 if(!s||!m)return '<p class="empty">This reference is not in the retained source inventory.</p>'+detail("Original reference",ref);
 const cells=parsed?.rows[n],headers=parsed?.rows[0]??p?.original_headers??m.columns.map(x=>x.name);
 const rawRows=cells?Array.from({length:Math.max(headers.length,cells.length)},(_,i)=>[esc(headers[i]??("Undeclared column "+(i+1))),'<pre class="raw-cell">'+esc(cells[i]??"<missing column>")+'</pre>']):null;
 return inputLink(s)+defs([["Original record",esc(n)+" (after header)"],["Source SHA256",'<span class="mono">'+esc(s.sha256)+'</span>'],["Original path",esc(s.original_path)],["Retained path",esc(s.retained_path)]])+'<p class="small">The full source data stays local to this browser. Only the file matching this exact byte count and SHA256 is accepted.</p><label for="source-file">Choose the retained original CSV to read its records<input id="source-file" type="file"></label><p id="source-status" role="status">'+esc(message||(parsed?"Verified original source loaded.":"Choose the exact file; no source rows are inferred from the profile."))+'</p><label for="source-record">CSV data record number<input id="source-record" type="number" min="1" step="1" value="'+esc(n)+'"></label><button id="source-go">Read record</button>'+(rawRows?grid(["Original field","Exact raw value"],rawRows,"Verified original CSV · record "+n):'<p class="empty">'+(parsed?"This data record is absent from the verified original file.":"Record values appear after the original file is verified.")+'</p>')+detail("Original table definition",m)+detail("Complete original profile",p);
}
function openSource(ref){
 focusBeforeDialog=document.activeElement;currentRef={...ref};sourceToken++;$("source-title").textContent=String(ref.table)+" · record "+String(ref.record);$("source-content").innerHTML=sourceBody(ref);if(!$("source-dialog").open)$("source-dialog").showModal();$("source-close").focus();
}
function parseCSV(text,delimiter,quote){
 if(typeof delimiter!=="string"||delimiter.length!==1||typeof quote!=="string"||quote.length!==1)throw Error("This CSV dialect requires the original native reader.");
 const rows=[];let row=[],cell="",quoted=false,after=false,touched=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){touched=true;if(c===quote){if(text[i+1]===quote){cell+=quote;i++;}else{quoted=false;after=true;}}else cell+=c;continue;}
 if(after&&c!==delimiter&&c!=="\r"&&c!=="\n")throw Error("Unexpected character after quoted CSV cell.");
 if(c===delimiter){touched=true;row.push(cell);cell="";after=false;continue;}
 if(c==="\r"||c==="\n"){if(c==="\r"&&text[i+1]==="\n")i++;if(touched||row.length||cell!=="")row.push(cell);rows.push(row);row=[];cell="";after=false;touched=false;continue;}
 if(c===quote&&cell===""){quoted=true;touched=true;continue;}cell+=c;touched=true;
 }
 if(quoted)throw Error("Unclosed original CSV quote.");if(touched||row.length||cell!==""){row.push(cell);rows.push(row);}return rows;
}
async function loadSource(file){
 if(!file||!currentRef)return;const ref={...currentRef},token=++sourceToken,s=inputByTable.get(ref.table),m=tableById.get(ref.table),status=$("source-status");status.textContent="Verifying the complete original file…";
 try{
 if(file.size!==s.bytes)throw Error("Byte count differs from the retained original source.");
 if(!globalThis.crypto?.subtle)throw Error("This browser cannot verify SHA256 here. Use the original case reader; an unverified file will not be displayed.");
 const buffer=await file.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",buffer)),x=>x.toString(16).padStart(2,"0")).join("");
 if(digest!==s.sha256)throw Error("SHA256 differs from the retained original source.");
 const encoding=(m.encoding??"utf-8-sig").toLowerCase().replace(/_/g,"-");let text;
 if(["utf-8","utf8","utf-8-sig"].includes(encoding))text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:encoding!=="utf-8-sig"}).decode(buffer);
 else if(["ascii","us-ascii"].includes(encoding)){const bytes=new Uint8Array(buffer);if(bytes.some(x=>x>127))throw Error("Invalid ASCII source.");text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(buffer);}
 else if(["latin-1","latin1","iso-8859-1"].includes(encoding)){const bytes=new Uint8Array(buffer),parts=[];for(let i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));text=parts.join("");}
 else throw Error("This exact encoding requires the native source reader: "+encoding);
 const rows=parseCSV(text,m.delimiter??",",m.quotechar??'"'),p=profileById.get(ref.table);
 if(p&&JSON.stringify(rows[0])!==JSON.stringify(p.original_headers))throw Error("Decoded headers differ from the original reader; use the native case reader for this encoding.");
 if(p&&rows.length-1!==p.rows)throw Error("Decoded record count differs from the original reader; use the native case reader.");
 cache.set(ref.table,{rows});if(token===sourceToken&&currentRef?.table===ref.table){$("source-content").innerHTML=sourceBody(currentRef,"Complete original file verified against retained bytes and SHA256.");}
 }catch(e){if(token===sourceToken&&$("source-status"))$("source-status").textContent="Source not opened: "+e.message;}
}
document.addEventListener("click",e=>{
 const b=e.target.closest("button");if(!b)return;
 if(b.dataset.panel){state.panel=b.dataset.panel;render();}
 if(b.dataset.period){state.period=Number(b.dataset.period);state.dayPage=state.runPage=0;render();}
 if(b.dataset.source){try{openSource(JSON.parse(b.dataset.source));}catch(err){notice("Source could not be opened: "+err.message);}}
 if(b.dataset.refPage){const item=lazy.get(b.dataset.refPage);if(item){item.page+=Number(b.dataset.delta);const d=b.closest("details");renderLazy(d.lastElementChild,b.dataset.refPage);d.querySelector("summary").focus();}}
 if(b.dataset.page){state[b.dataset.page]+=Number(b.dataset.delta);render();}
 if(b.dataset.download){const names={result_json:"Water_Result.json",source_report_json:"Source_Report.json",original_manifest_json:"Manifest_Canonical.json"};download(names[b.dataset.download],raw[b.dataset.download]);}
 if(b.id==="source-go"){const n=Number($("source-record").value);if(!Number.isSafeInteger(n)||n<1){$("source-status").textContent="Choose a positive whole data record number.";return;}currentRef={...currentRef,record:n};$("source-title").textContent=currentRef.table+" · record "+n;$("source-content").innerHTML=sourceBody(currentRef);}
});
document.addEventListener("change",e=>{
 const t=e.target;if(t.id==="source-file"){loadSource(t.files[0]);return;}
 const map={"active-period":"period","compare-a":"compareA","compare-b":"compareB","day-from":"dayFrom","day-to":"dayTo","day-metric":"dayMetric","qualifying-only":"qualifyingOnly"};
 if(map[t.id]){state[map[t.id]]=t.type==="checkbox"?t.checked:(["active-period","compare-a","compare-b"].includes(t.id)?Number(t.value):t.value);state.dayPage=state.runPage=0;render();}
});
$("period-filter").addEventListener("input",e=>{state.query=e.target.value;state.page=0;render();});
$("account-filter").addEventListener("change",e=>{state.account=e.target.value;state.page=0;render();});
$("review-filter").addEventListener("change",e=>{state.review=e.target.value;state.page=0;render();});
$("exact-values").addEventListener("change",e=>{state.exact=e.target.checked;render();});
$("reset-filters").onclick=()=>{state.query=state.account="";state.review="all";state.page=0;syncControls();render();};
$("download-html").onclick=downloadHTML;
$("download-json").onclick=()=>{download("Water_Embedded_Case.json",$("water-payload").textContent);notice("Complete embedded result, source report and manifest downloaded. Original source CSVs remain in the full case.");};
$("download-csv").onclick=downloadCSV;$("print").onclick=()=>window.print();
$("source-close").onclick=()=>$("source-dialog").close();
$("source-dialog").addEventListener("close",()=>{sourceToken++;focusBeforeDialog?.focus();});
document.querySelector(".tabs").addEventListener("keydown",e=>{const i=panels.indexOf(state.panel);let next;if(e.key==="ArrowRight")next=(i+1)%panels.length;if(e.key==="ArrowLeft")next=(i+panels.length-1)%panels.length;if(e.key==="Home")next=0;if(e.key==="End")next=panels.length-1;if(next!==undefined){e.preventDefault();state.panel=panels[next];render();$("tab-"+state.panel).focus();}});
function syncControls(){$("period-filter").value=state.query;$("account-filter").value=state.account;$("review-filter").value=state.review;$("exact-values").checked=state.exact;}
$("account-filter").innerHTML='<option value="">All selected accounts</option>'+[...new Set(all.map(r=>r.account_id).filter(x=>typeof x==="string"))].sort().map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");
$("edition").textContent="Source edition "+String(S.edition);$("meaning").textContent=R.meaning;
const issueCount=all.reduce((n,r)=>n+(r.issues||[]).length,0),complete=all.filter(r=>r.classification==="RECONCILED_WITHIN_SELECTED_TOLERANCES").length;
$("summary").innerHTML=[["Selected accounts",R.selected_accounts],["Selected periods",R.selected_periods],["Reconciled periods",complete],["Engine review items",issueCount]].map(([label,value])=>'<div class="stat"><strong>'+esc(value)+'</strong><span>'+label+'</span></div>').join("");
syncControls();render();
})();
// Any unexpected rendering failure remains visible without hiding original saved files.
"""

if __name__ == "__main__":
    raise SystemExit(main())

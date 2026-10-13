"""Read-only disk-backed migration inspector for the original localhost case server."""
from __future__ import annotations
import base64
import hashlib
import html
import json
import re

RESULT_SCHEMA = "tjlabs.migration-reconciliation.result.v1"

def _json(value):
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
    _require(result.get("schema") == RESULT_SCHEMA, "Unsupported migration result")
    _require(result.get("source_run_identity") == source_report.get("run_identity")
             and isinstance(result.get("source_run_identity"), str),
             "Migration result and original report identify different source runs")
    _require(result.get("data_class") == source_report.get("data_class")
             == original_manifest.get("data_class"),
             "Result, report and manifest data classes differ")
    lineage = source_report.get("lineage")
    _require(isinstance(lineage, dict), "Original source lineage is required")
    _require(lineage.get("definition_sha256") == _sha(_json(original_manifest)),
             "Canonical manifest differs from the original source definition")
    _require(result.get("source_inputs") == lineage.get("inputs")
             and isinstance(result.get("source_inputs"), list),
             "Migration result must retain the complete original source inventory")
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
    pairs = result.get("pairs")
    _require(isinstance(pairs, list) and all(isinstance(p, dict) for p in pairs),
             "Complete selected pair definitions are required")
    _require(len({p.get("id") for p in pairs}) == len(pairs)
             and all(isinstance(p.get("id"), str) for p in pairs),
             "Selected pair identities must be unique strings")
    for pair in pairs:
        _require("rows" not in pair and isinstance(pair.get("totals"), dict),
                 "Use the disk-backed row and total result contract")
        _require(pair.get("source_table") in ids and pair.get("target_table") in ids,
                 "Pair tables must belong to the complete original source")
    _require(isinstance(result.get("selection_sha256"), str)
             and re.fullmatch(r"[0-9a-f]{64}", result["selection_sha256"]),
             "The complete selected interpretation must have its SHA256")

def _payload_text(value):
    # JSON is in a non-executable script element. Do not permit a source value
    # to close that element or create HTML, including literal Unicode separators.
    return (_json(value).replace("&", "\\u0026").replace("<", "\\u003c")
            .replace(">", "\\u003e").replace("\u2028", "\\u2028")
            .replace("\u2029", "\\u2029"))


def _csp_hash(source):
    return base64.b64encode(hashlib.sha256(source.encode("utf-8")).digest()).decode("ascii")


def render_html(result, source_report, original_manifest):
    """Return the token-relative application; population data stays disk-backed."""
    _validate(result, source_report, original_manifest)
    bootstrap = {name: result.get(name) for name in
                 ("source_run_identity", "selection_sha256", "data_class", "label")}
    label = str(result.get("label") or source_report.get("label") or "Migration case")
    csp = ("default-src 'none'; base-uri 'none'; object-src 'none'; "
           "form-action 'none'; connect-src 'self'; img-src data:; "
           "script-src 'sha256-" + _csp_hash(_SCRIPT) + "'; "
           "style-src 'sha256-" + _csp_hash(_CSS) + "'")
    replacements = {"__CSP__": html.escape(csp, quote=True),
                    "__TITLE__": html.escape(label, quote=True),
                    "__DATA_CLASS__": html.escape(str(result["data_class"]), quote=True),
                    "__CSS__": _CSS, "__JS__": _SCRIPT,
                    "__BOOTSTRAP__": _payload_text(bootstrap)}
    return re.sub(r"__(?:CSP|TITLE|DATA_CLASS|CSS|JS|BOOTSTRAP)__",
                  lambda match: replacements[match.group(0)], _HTML)


OPERATOR_GUIDE = r"""
## Read-only migration case inspector

The inspector opens the **complete saved migration case through its original private localhost server**. It never uploads source data, runs SQL supplied by a browser, changes the calculation, accepts a migration or changes a production system. Retain TokenJunkieLabs (TJLabs) attribution.

The result population is disk-backed: comparison rows and dimension totals stay in complete JSONL/CSV files plus the verified SQLite index. Even when millions of original records or dimension groups are selected, the browser requests at most forty rows or totals per normal page. Full downloads stream directly from the original case. The HTML application alone is not a complete case and is not advertised as a self-contained full-population report.

### Open the original verified edition

Use the selected application source and an existing complete case. Place the private server receipt outside the immutable case:

```bash
python migration_server.py \
  --case /absolute/received-case \
  --archive /absolute/Migration_Case.zip \
  --receipt /absolute/private/new-server.json \
  --port 0
```

The server verifies original source/results/application hashes and, when supplied, the complete archive. Open the exact private token-bearing URL in its LISTENING result or receipt. It binds only 127.0.0.1 and accepts its own Host/Origin. Do not publish the private URL or receipt. The launching operator owns that process and stops it locally; the inspector exposes no remote mutation or shutdown route.

If the original archive was not selected, the page disables the case-ZIP link and explains how to reopen with a complete prepacked archive. Summary, full rows/totals and original manifest/report remain available. A changed immutable file is an explicit error, not a silently refreshed calculation.

### Inspect every selected population and its meaning

- **Records & differences:** apply an exact pair, native classification and literal key-text filter; then use forty-record pages. The count identifies the full matching population. Open any comparison record to inspect the original/selected keys, source and target record references, duplicate-group sizes, every typed field comparison, exact rational arithmetic/tolerance, and all original issues. The field selector narrows only that detail view. Crosswalk ambiguity and duplicate groups remain unresolved rather than receiving arbitrary matches.
- **Dimension totals:** filter pair, numeric field, literal dimensions text and native state. Every dimension group remains in the complete disk-backed totals; the table pages forty groups and opens a complete selected total. Source/target computable subtotals, full row counts and uncomputed counts stay distinct. A subtotal with omitted/uncomputed values is not a complete total. Aggregate agreement does not accept individual record differences.
- **Mappings & coverage:** read every selected key/field transformation, explicit dimension definition, source/target row coverage, native status counts and complete pair interpretation. Open the full crosswalk-issue population using the original row route; summary counts do not replace those records.
- **Original sources:** read the complete original table definitions, profiles, lineage inventories, original manifest/report and selected recipe identities. Click a source or target reference to read its complete raw CSV record through the actual native CSV reader. Headers, source bytes/SHA and record ordinal remain visible. A blank CSV record is an empty array; a present empty field is an empty string. Quoted multiline records retain their original record number.
- **Complete downloads:** stream every original row/total as JSONL or formula-safe CSV, download complete result/source report/original manifest bytes, and receive the prepacked whole case ZIP when available. Original full downloads remain complete regardless of the current view. The filtered stream links include only the explicit applied filters, never the page offset/limit.

Quantities use the saved exact numerator/denominator and native decimal display. The inspector does not recompute tolerances, round differences to equality, infer missing values or turn unavailable values into zero. **Show exact fractions** reveals the rational components. Original integer/decimal JSON tokens that cannot be represented exactly in browser numbers use a lossless view representation; complete record/total/source JSON downloads retain their original server response text.

### Reopen a view and distinguish subset exports

**Download view settings** retains only the source-run/interpretation identity, selected filters, page offsets and selected detail IDs. It contains no localhost access token. **Restore settings** accepts that same original case/interpretation and rereads the original records from its server. It does not restore a different data edition as if unchanged.

**Current page CSV** and **Current page snapshot HTML** are explicitly limited exports containing the visible page and its original identities. They do not replace the full population. A downloaded snapshot opens offline, contains no server token or active API, and clearly gives the visible/full matching counts. JSONL remains the complete exact machine-readable population. Print produces the current review view, not the whole case.

Use Tab/Shift+Tab throughout, Left/Right or Home/End among the five section tabs, Enter/Space for buttons and disclosures, and Escape to close a source dialog. Focus returns to the source-reference control. At narrow widths the controls stack, long identities wrap and exact data tables remain horizontally scrollable.

### Renderer interface

`render_html(result, source_report, original_manifest) -> str` is called by the original atomic calculation. It validates the exact source-run, original manifest hash, complete source table inventory and selected interpretation. The generated HTML contains only a small original-case identity bootstrap and the application code; it does not embed population rows or dimension groups. All data calls are relative to the server's token-scoped root. A restrictive content security policy permits only the original inline script/style hashes and same-origin reads.

Keep the actual selected renderer and server source with the complete application. Do not replace report.html after its native delivery manifest is written. For a new inspection copy, use a new complete native edition; a copied HTML file still requires the matching original server and is not itself a whole report.

### Complete browser receiving on the already-running server

The adjacent helper consumes the actual private server receipt. It does not start another server, create example records, calculate a new case or install dependencies:

```bash
/actual/node receiving_migration_browser.mjs \
  --server-receipt /absolute/private/new-server.json \
  --directory /absolute/migration-browser-receiving \
  --playwright /actual/installed/playwright/index.mjs \
  --chromium /actual/installed/chromium
```

Select the existing installed Playwright module that exposes chromium. The installed Python Playwright wheel's actual driver/package/index.mjs may be used if the selected Node imports it. Keep browser artifacts outside the immutable case and retain the original server receipt privately.

An interrupted receiving course uses the same arguments and directory plus `--resume`. It retains incomplete attempts, exact source/runtime/input identities and atomic progress/completion receipts. A completed result is reused only after saved artifact hashes are verified. A live or foreign process lock is not overridden.

The helper operates actual pair/classification/key filters, complete row/field/source drilldown, totals/filter/detail paging, all five sections, exact view-settings export/restoration, streamed JSONL/CSV and whole archive downloads, a cold browser context and downloaded subset-HTML reopen. It saves actual desktop/narrow screenshots and a current-view PDF. The original native receiving course owns full archive verification, cold case receiving and server reopening; this helper consumes that real server.

**The receiving owner must then actually open/view every saved screenshot, PDF and exported HTML, and inspect the complete JSONL/CSV/archive identities under VIEWING.md.** Browser functional completion remains separate from actual visual receiving. Report the real outcome in the existing original receiving operation. Preserve user-selected tabs and current owner browser instructions; no parallel duplicate course is needed.

"""

_CSS = r"""

:root{color-scheme:light;--ink:#242424;--muted:#555555;--paper:#fff;--base:#f2f2f2;--line:#c7c7c7;--navy:#242424;--teal:#383838;--ok:#333333;--warn:#333333;--error:#111111;--focus:#111111;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--base);color:var(--ink)}button,input,select{font:inherit}button,a,input,select{touch-action:manipulation}button,.button{border:1px solid var(--teal);border-radius:3px;background:var(--paper);color:var(--teal);padding:.45rem .7rem;cursor:pointer;text-decoration:none;display:inline-block}button:hover,.button:hover{background:#eeeeee}button:disabled{opacity:.5;cursor:default}button.primary{background:var(--teal);color:white}a{color:var(--teal)}:focus-visible{outline:3px solid var(--focus);outline-offset:3px}.skip{position:absolute;left:1rem;top:-5rem;background:white;padding:.6rem;z-index:10}.skip:focus{top:.5rem}
header{background:var(--navy);color:white;padding:1.3rem max(1.25rem,calc((100vw - 1500px)/2));border-bottom:5px solid var(--teal)}header a{color:white}.eyebrow{font-size:.8rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:#dddddd}h1{font-size:clamp(1.5rem,3vw,2.15rem);line-height:1.15;margin:.3rem 0 .5rem}h2{font-size:1.35rem;line-height:1.3;margin:0 0 .8rem}h3{font-size:1.05rem;margin:1.3rem 0 .5rem}p{margin:.5rem 0 1rem}header p{max-width:65rem;margin:.5rem 0}main{max-width:1500px;margin:auto;padding:1.2rem}.toolbar,.row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}.toolbar{padding:1rem 0}.toolbar .spacer{flex:1}.muted{color:var(--muted)}.small{font-size:.85rem}.mono,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.card{background:white;border:1px solid var(--line);border-radius:4px;padding:1.15rem;margin-bottom:1rem;min-width:0}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.8rem;margin:1rem 0}.stat{padding:.9rem;background:white;border:1px solid var(--line);border-top:3px solid var(--teal)}.stat strong{display:block;font-size:1.65rem}.stat span{color:var(--muted);font-size:.87rem}.banner{padding:.75rem 1rem;border-left:4px solid var(--warn);background:#f4f4f4;margin:.75rem 0}.badge{font-size:.76rem;font-weight:700;border-radius:3px;display:inline-block;padding:.2rem .45rem;background:#eeeeee;overflow-wrap:anywhere}.badge.ok{background:#e9e9e9;color:var(--ok)}.badge.warn{background:#e3e3e3;color:var(--warn)}.badge.bad{background:#dedede;color:var(--error)}
.filters{display:grid;grid-template-columns:minmax(12rem,2fr) 1fr 1fr;gap:.75rem}label{display:block;font-weight:600;font-size:.86rem}input,select{width:100%;background:white;color:var(--ink);border:1px solid #888888;border-radius:3px;padding:.55rem;margin:.2rem 0 .4rem;min-width:0}input[type=checkbox]{width:auto}nav.tabs{display:flex;flex-wrap:wrap;gap:.3rem;margin:1rem 0}nav.tabs button[aria-selected=true]{background:var(--navy);color:white;border-color:var(--navy)}.layout{display:grid;grid-template-columns:minmax(14rem,22rem) minmax(0,1fr);gap:1rem}.list{max-height:65vh;overflow:auto;padding:.25rem}.period-choice{display:block;text-align:left;width:100%;color:var(--ink);border:1px solid var(--line);border-left:4px solid transparent;margin:.35rem 0;padding:.7rem}.period-choice[aria-current=true]{border-left-color:var(--teal);background:#ededed}.period-choice strong{display:block;overflow-wrap:anywhere}.period-choice .small{display:block;color:var(--muted)}.pager{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:.7rem 0}.pager span{margin-right:auto}.table-wrap{overflow:auto;max-width:100%;margin:.8rem 0;border:1px solid var(--line)}table{border-collapse:collapse;min-width:100%;font-size:.88rem}caption{text-align:left;font-weight:700;padding:.6rem;background:#f1f1f1}th,td{text-align:left;vertical-align:top;padding:.55rem .65rem;border-bottom:1px solid var(--line);overflow-wrap:anywhere}th{background:#eeeeee;white-space:normal}td.num{font-variant-numeric:tabular-nums;white-space:nowrap}.quantity{font-variant-numeric:tabular-nums}.quantity small{display:block;font-family:ui-monospace,monospace;font-size:.72rem;color:var(--muted);white-space:normal;overflow-wrap:anywhere}.chain{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.5rem}.chain .node{padding:.75rem;background:#f2f2f2;border:1px solid var(--line)}.chain .node strong{display:block;font-size:.8rem;text-transform:uppercase}.chain .quantity{display:block;font-size:1.15rem;margin:.4rem 0}.definition{display:grid;grid-template-columns:minmax(8rem,1fr) minmax(0,3fr);gap:.35rem 1rem;margin:.5rem 0}.definition dt{font-weight:600;color:var(--muted)}.definition dd{margin:0;overflow-wrap:anywhere}.refs{display:flex;gap:.3rem;flex-wrap:wrap}.refs button{font-size:.8rem;padding:.2rem .4rem}.json{white-space:pre-wrap;overflow-wrap:anywhere;font: .8rem/1.5 ui-monospace,monospace;background:#f4f4f4;padding:.8rem;max-height:36rem;overflow:auto}.issue{padding:.8rem 0;border-bottom:1px solid var(--line)}.issue h3{margin:0 0 .4rem}.empty{padding:1rem;background:#f5f5f5;color:var(--muted)}details{margin:.6rem 0}summary{cursor:pointer;font-weight:600;padding:.35rem 0}.chart{display:block;width:100%;min-height:170px;background:#f5f5f5;border:1px solid var(--line);margin:.6rem 0}.chart text{font-family:system-ui,sans-serif;font-size:12px;fill:var(--muted)}.charts{display:grid;grid-template-columns:1fr;gap:.5rem}.view-controls{display:flex;flex-wrap:wrap;gap:1rem}.view-controls label{font-weight:400}.notice{min-height:1.5rem;padding:.4rem 0;color:var(--teal)}dialog{width:min(62rem,calc(100vw - 1.5rem));max-height:90vh;overflow:auto;border:1px solid var(--line);border-radius:5px;padding:1.2rem;color:var(--ink)}dialog::backdrop{background:#00000099}dialog .close{float:right}.split{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.source-link{display:inline-block;margin:.3rem .5rem .3rem 0}footer{max-width:1500px;margin:auto;padding:1rem 1.2rem 2rem;color:var(--muted);font-size:.85rem;border-top:1px solid var(--line)}[hidden]{display:none!important}#fatal{border:2px solid var(--error)}
@media(max-width:850px){.layout{grid-template-columns:1fr}.list{max-height:20rem}.filters{grid-template-columns:1fr 1fr}.filters label:first-child{grid-column:1/-1}.chain{grid-template-columns:1fr 1fr}.summary{grid-template-columns:1fr 1fr}.split{grid-template-columns:1fr}}
@media(max-width:480px){main{padding:.7rem}.card{padding:.8rem}.filters{grid-template-columns:1fr}.filters label:first-child{grid-column:auto}.chain{grid-template-columns:1fr}.definition{grid-template-columns:1fr}.definition dd{margin-bottom:.4rem}.toolbar>*{flex-grow:1}.tabs button{flex:1 1 40%}.summary{gap:.4rem}.stat strong{font-size:1.35rem}.row>*{max-width:100%}}
@media print{body{background:white}header{background:white;color:#111;border-color:#333;padding:.5rem}header .eyebrow{color:#333}.toolbar,.filters,.tabs,.list,.pager,.view-controls,.no-print,dialog{display:none!important}.layout{display:block}.card{break-inside:avoid;border-color:#bbb}main{padding:0}.table-wrap{overflow:visible}.json{max-height:none}footer{padding:.5rem}.quantity small{display:block!important}.chart{max-height:220px}.banner{background:white}.print-note{display:block!important}}

.raw-cell{white-space:pre-wrap;margin:0;font:inherit;overflow-wrap:anywhere}

.shell{display:grid;grid-template-columns:minmax(0,1fr);gap:1rem}.status-line{min-height:1.7rem;font-size:.87rem}.metrics{display:flex;flex-wrap:wrap;gap:.5rem}.metric{padding:.6rem .8rem;border:1px solid var(--line);background:#f5f5f5}.metric strong{display:block;font-size:1.3rem}.error{border:2px solid #333;padding:.8rem;background:#f3f3f3}.row-link{color:#222;border-color:#999;text-align:left}.row-link[aria-current=true]{font-weight:700;border:2px solid #222}.dual{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.scroll-cell{max-width:25rem;white-space:pre-wrap;overflow-wrap:anywhere}.filter-form{display:grid;grid-template-columns:1fr 1fr 2fr auto;align-items:end;gap:.7rem}.filter-form button{margin-bottom:.4rem}.readonly{border:1px solid var(--line);padding:.8rem;background:#f8f8f8}.busy{color:#555;font-style:italic}.full-width{width:100%}.identity{overflow-wrap:anywhere}.detail-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.7rem}.pill{display:inline-block;border:1px solid #999;background:#eee;padding:.15rem .4rem;margin:.15rem;font-size:.8rem}.record-panel:focus{outline:2px solid #555}.download-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.download-card{border:1px solid var(--line);padding:1rem;min-width:0}.download-card p{font-size:.88rem;color:var(--muted)}#source-dialog .dual{margin-top:1rem}.no-wrap{white-space:nowrap}
@media(max-width:900px){.filter-form{grid-template-columns:1fr 1fr}.filter-form label:nth-child(3){grid-column:1/-1}.filter-form button{grid-column:1/-1}.dual,.download-grid{grid-template-columns:1fr}}
@media(max-width:480px){.filter-form{grid-template-columns:1fr}.filter-form label:nth-child(3),.filter-form button{grid-column:auto}.scroll-cell{max-width:17rem}}
@media print{.filter-form,#downloads-panel,.source-tools,.pager{display:none!important}.dual{display:block}.status-line{display:none}}

a[aria-disabled=true]{pointer-events:none;color:#777;border-style:dashed}

"""

_HTML = r"""
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="__CSP__">
<title>__TITLE__ — migration reconciliation</title><style>__CSS__</style></head>
<body><a class="skip" href="#main">Skip to reconciliation</a>
<header><div class="eyebrow">TJLabs · Source and target reconciliation</div><h1>Migration case inspector</h1><p id="case-label">__TITLE__</p><div class="row"><span id="data-class" class="badge">__DATA_CLASS__</span><span id="case-identity" class="small mono"></span></div></header>
<main id="main" tabindex="-1">
<div class="banner">Read-only inspection of one complete native case. Every original selected row remains in the case and full downloads. Browser filters and field views do not change the saved reconciliation.</div>
<div id="notice" class="notice" role="status" aria-live="polite"></div><div id="fatal" class="error" hidden></div>
<section id="case-summary" class="summary" aria-label="Full case summary"></section>
<nav class="tabs" role="tablist" aria-label="Migration review sections">
<button role="tab" id="tab-records" data-panel="records" aria-controls="records-panel" aria-selected="true">Records &amp; differences</button>
<button role="tab" id="tab-totals" data-panel="totals" aria-controls="totals-panel" aria-selected="false" tabindex="-1">Dimension totals</button>
<button role="tab" id="tab-definition" data-panel="definition" aria-controls="definition-panel" aria-selected="false" tabindex="-1">Mappings &amp; coverage</button>
<button role="tab" id="tab-sources" data-panel="sources" aria-controls="sources-panel" aria-selected="false" tabindex="-1">Original sources</button>
<button role="tab" id="tab-downloads" data-panel="downloads" aria-controls="downloads-panel" aria-selected="false" tabindex="-1">Complete downloads</button></nav>
<section class="card" id="records-panel" role="tabpanel" aria-labelledby="tab-records">
<h2>Complete comparison population</h2>
<form id="row-filters" class="filter-form">
<label for="pair-filter">Source / target pair<select id="pair-filter"><option value="">All selected pairs</option></select></label>
<label for="status-filter">Native classification<select id="status-filter"><option value="">All classifications</option></select></label>
<label for="key-search">Literal key text<input id="key-search" maxlength="1000" type="search" autocomplete="off" placeholder="Exact literal text search"></label>
<button type="submit" id="apply-filters" class="primary">Apply view</button></form>
<div class="row"><button id="reset-filters">Reset view</button><label><input id="exact-values" type="checkbox"> Show exact fractions</label><button id="download-page-csv">Download current page CSV</button></div>
<p id="rows-status" class="status-line" role="status"></p><div id="rows-error" class="error" hidden></div>
<div id="row-table"></div><div id="row-pager" class="pager"></div><div class="row"><a id="download-filtered-csv" class="button" download>Stream every matching record CSV</a><a id="download-filtered-jsonl" class="button" download>Stream every matching record JSONL</a></div>
<article id="record-detail" class="record-panel" tabindex="-1"><p class="empty">Choose a retained comparison record to inspect its complete field differences and original source records.</p></article></section>
<section class="card" id="totals-panel" role="tabpanel" aria-labelledby="tab-totals" hidden></section>
<section class="card" id="definition-panel" role="tabpanel" aria-labelledby="tab-definition" hidden></section>
<section class="card" id="sources-panel" role="tabpanel" aria-labelledby="tab-sources" hidden></section>
<section class="card" id="downloads-panel" role="tabpanel" aria-labelledby="tab-downloads" hidden>
<h2>Complete case and streamed results</h2><p>The population downloads stream from the original disk-backed case. They are not assembled from the visible browser page. Keep the complete source/case handover for offline reopening with the native server.</p>
<div class="download-grid">
<div class="download-card"><h3>Every comparison record</h3><a class="button" href="download/rows.jsonl" download id="download-all-jsonl">Full rows JSONL</a><a class="button" href="download/rows.csv" download id="download-all-csv">Full population CSV</a><p>JSONL retains complete exact values and lineage. CSV is a formula-safe presentation export.</p></div>
<div class="download-card"><h3>Every dimension total</h3><a class="button" href="download/totals.jsonl" download id="download-all-totals-jsonl">Full totals JSONL</a><a class="button" href="download/totals.csv" download id="download-all-totals-csv">Full totals CSV</a><p>All exact dimension groups, computable subtotals and unresolved counts.</p></div><div class="download-card"><h3>Complete native case ZIP</h3><a class="button" href="download/case.zip" download id="download-case">Download prepacked case</a><p id="archive-status" class="mono">Checking the original server’s complete archive selection…</p></div>
<div class="download-card"><h3>Summary and source definitions</h3><a class="button" href="download/result.json" download>Complete result summary</a><a class="button" href="download/source-report.json" download>Original source report</a><a class="button" href="download/manifest.original.json" download>Original manifest bytes</a></div>
<div class="download-card"><h3>Current review view</h3><button id="save-view">Download view settings</button><label for="load-view">Restore settings for this exact case<input id="load-view" type="file" accept=".json,application/json"></label><button id="download-page-html">Current page snapshot HTML</button><button id="print">Print current view</button><p>These are explicitly limited view exports. They contain no server token and do not replace the complete population/case.</p></div></div></section>
<p id="meaning" class="muted small"></p>
<noscript><section class="card"><p>JavaScript is needed to page the native result. Full original downloads remain at their links. Start the original case server to open this application; a copied HTML file alone has no comparison population.</p></section></noscript>
</main>
<dialog id="source-dialog" aria-labelledby="source-title"><button id="source-close" class="close">Close</button><h2 id="source-title">Original source record</h2><div id="source-content"></div></dialog>
<footer><strong>TokenJunkieLabs (TJLabs)</strong> · Complete source and target reconciliation.<br>Retain this attribution. Classification records the selected exact comparison; it is not automatic migration acceptance, a production-system mutation or an approved financial correction.</footer>
<script id="migration-bootstrap" type="application/json">__BOOTSTRAP__</script><script>__JS__</script></body></html>
"""

_SCRIPT = r"""

"use strict";
(()=>{
const $=id=>document.getElementById(id), E=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const boot=JSON.parse($("migration-bootstrap").textContent),panels=["records","totals","definition","sources","downloads"];
const state={panel:"records",filters:{pair:"",classification:"",search:""},offset:0,limit:40,exact:false,rowId:null,field:"",totalsPair:"",totalField:"",dimension:"",totalPage:0,definitionPair:""};
let summary=null,manifest=null,sourceReport=null,pageData=null,detailRow=null,activeSource=null,totalsData=null,totalRow=null;
let totalsRequest=null,totalRequest=null,totalsGeneration=0,totalGeneration=0;
const totalsFilters={pair:"",field:"",search:"",status:""};let totalsOffset=0;
let listRequest=null,detailRequest=null,sourceRequest=null,listGeneration=0,detailGeneration=0,sourceGeneration=0,focusBeforeDialog=null,sourceLoading=null;
const lazy=new Map(),lazyScopes=new Map();let lazyId=0,lazyScope="general";
function resetLazy(scope){for(const key of lazyScopes.get(scope)||[])lazy.delete(key);lazyScopes.set(scope,[]);lazyScope=scope;}
function keepLazy(id,value){lazy.set(id,value);if(!lazyScopes.has(lazyScope))lazyScopes.set(lazyScope,[]);lazyScopes.get(lazyScope).push(id);}
const notice=text=>{$("notice").textContent=text;};
const rawJSON=new WeakMap();
class ExactJSONNumber{constructor(token){this.token=token;}}
function parseOriginalJSON(text){
 let i=0;const ws=()=>{while(i<text.length&&/\s/.test(text[i]))i++;};
 function read(depth=0){
  invariant(depth<200,"Original JSON nesting exceeds the inspector limit");ws();const c=text[i];
  if(c==='"'){const start=i++;while(i<text.length){if(text[i]==="\\"){i+=2;continue;}if(text[i++]==='"')return JSON.parse(text.slice(start,i));}throw Error("Unclosed JSON string");}
  if(c==="["){i++;const a=[];ws();if(text[i]==="]"){i++;return a;}while(true){a.push(read(depth+1));ws();if(text[i]==="]"){i++;return a;}invariant(text[i++]===",","Invalid JSON array");}}
  if(c==="{"){i++;const o=Object.create(null);ws();if(text[i]==="}"){i++;return o;}while(true){ws();invariant(text[i]==='"',"JSON object key required");const k=read(depth+1);ws();invariant(text[i++]===":"&&!Object.hasOwn(o,k),"Invalid or duplicate JSON object key");o[k]=read(depth+1);ws();if(text[i]==="}"){i++;return o;}invariant(text[i++]===",","Invalid JSON object");}}
  for(const [token,v]of [["true",true],["false",false],["null",null]])if(text.startsWith(token,i)){i+=token.length;return v;}
  const m=text.slice(i).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);invariant(m,"Invalid JSON value");i+=m[0].length;
  const n=Number(m[0]);return Number.isSafeInteger(n)&&!/[.eE]/.test(m[0])?n:new ExactJSONNumber(m[0]);
 }
 const value=read();ws();invariant(i===text.length,"Trailing original JSON bytes");return value;
}
function exactJSON(v,level=0){
 if(v instanceof ExactJSONNumber)return v.token;if(v===undefined)return "null";if(v===null||typeof v!=="object")return JSON.stringify(v);
 const pad="  ".repeat(level),inside="  ".repeat(level+1);
 if(Array.isArray(v))return v.length?"[\n"+v.map(x=>inside+exactJSON(x,level+1)).join(",\n")+"\n"+pad+"]":"[]";
 const keys=Object.keys(v);return keys.length?"{\n"+keys.map(k=>inside+JSON.stringify(k)+": "+exactJSON(v[k],level+1)).join(",\n")+"\n"+pad+"}":"{}";
}
const pretty=v=>exactJSON(v);

function invariant(condition,message){if(!condition)throw Error(message);}
function fatal(error){$("fatal").hidden=false;$("fatal").textContent=error instanceof Error?error.message:String(error);}
window.addEventListener("error",event=>fatal("The view could not finish rendering. Reload this same original case server. "+event.message));
function details(title,value){const id=String(++lazyId);keepLazy(id,value);return '<details data-json="'+id+'"><summary>'+E(title)+'</summary><div></div></details>';}
document.addEventListener("toggle",e=>{const d=e.target;if(d.matches?.("details[data-json]")&&d.open&&!d.dataset.loaded){d.lastElementChild.innerHTML='<pre class="json">'+E(rawJSON.get(lazy.get(d.dataset.json))??pretty(lazy.get(d.dataset.json)))+'</pre>';d.dataset.loaded="true";}},true);
function quantity(value){if(value===null||value===undefined)return '<span class="muted">Uncomputed</span>';if(typeof value!=="object")return E(value);const fraction=String(value.numerator)+"/"+String(value.denominator);return '<span class="quantity" title="Exact '+E(fraction)+'">'+E(value.decimal??fraction)+(state.exact?'<small>'+E(fraction)+'</small>':"")+'</span>';}
const value=x=>x instanceof ExactJSONNumber?'<span class="scroll-cell" title="Exact original JSON number">'+E(x.token)+'</span>':x===null?'<span class="muted">NULL</span>':x===undefined?'<span class="muted">Not supplied</span>':'<span class="scroll-cell">'+E(typeof x==="string"?JSON.stringify(x):pretty(x))+'</span>';
const badge=text=>'<span class="badge">'+E(text??"Not supplied")+'</span>';
const defs=rows=>'<dl class="definition">'+rows.map(([label,text])=>'<dt>'+E(label)+'</dt><dd>'+text+'</dd>').join("")+'</dl>';
const table=(headers,rows,caption="")=>'<div class="table-wrap"><table>'+(caption?'<caption>'+E(caption)+'</caption>':"")+'<thead><tr>'+headers.map(h=>'<th scope="col">'+E(h)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(c=>'<td>'+c+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
function refButtons(refs){if(!Array.isArray(refs)||!refs.length)return '<span class="muted">No retained row reference</span>';return '<div class="refs">'+refs.map(ref=>'<button data-source="'+E(JSON.stringify(ref))+'">'+E(ref.table)+' · record '+E(ref.record)+'</button>').join("")+'</div>';}
function paginateRefs(refs){if(!refs?.length)return refButtons([]);if(refs.length<=12)return refButtons(refs);const id=String(++lazyId);keepLazy(id,{refs,page:0});return '<details data-refs="'+id+'"><summary>'+refs.length+' complete original references</summary><div></div></details>';}
function renderRefs(d){const item=lazy.get(d.dataset.refs);if(!item)return;const count=item.refs.length;item.page=Math.max(0,Math.min(item.page,Math.ceil(count/40)-1));d.lastElementChild.innerHTML=refButtons(item.refs.slice(item.page*40,(item.page+1)*40))+'<div class="pager"><span>'+ (item.page*40+1)+'–'+Math.min(count,(item.page+1)*40)+' of '+count+'</span><button data-ref-page="-1" '+(item.page===0?"disabled":"")+'>Previous references</button><button data-ref-page="1" '+((item.page+1)*40>=count?"disabled":"")+'>Next references</button></div>';}
document.addEventListener("toggle",e=>{const d=e.target;if(d.matches?.("details[data-refs]")&&d.open&&!d.dataset.loaded){renderRefs(d);d.dataset.loaded="true";}},true);
function endpoint(route,params={}){
 invariant(/^https?:$/.test(location.protocol)&&["127.0.0.1","localhost","[::1]"].includes(location.hostname),"Open this application through its original private localhost case server.");
 const base=new URL(".",location.href),url=new URL(route,base);invariant(url.origin===base.origin&&url.pathname.startsWith(base.pathname),"Invalid case-relative route");
 for(const [key,val]of Object.entries(params))if(val!==""&&val!==null&&val!==undefined)url.searchParams.set(key,String(val));return url;
}
async function api(route,params={},signal){
 const response=await fetch(endpoint(route,params),{method:"GET",mode:"same-origin",credentials:"omit",cache:"no-store",redirect:"error",signal});
 const text=await response.text();let body;try{body=parseOriginalJSON(text);if(body&&typeof body==="object")rawJSON.set(body,text);}catch{throw Error("The original server returned a non-JSON response ("+response.status+").");}
 if(!response.ok){const message=typeof body.error==="string"?body.error:body.error?.message??body.message??"Request not completed";throw Error("Original server "+response.status+": "+message);}
 return body;
}
function pairById(id){return summary.pairs.find(x=>x.id===id);}
function issueList(items){return (items||[]).length?items.map(x=>'<section class="issue"><h3>'+E(x.code??x.status??"Review item")+'</h3><p>'+E(typeof x.detail==="string"?x.detail:pretty(x.detail??x))+'</p>'+paginateRefs(x.source_records)+details("Complete original issue",x)+'</section>').join(""):'<p class="empty">No issues were retained for this selection.</p>';}
function pairOptions(current,all=false){return(all?'<option value="">All selected pairs</option>':"")+summary.pairs.map(p=>'<option value="'+E(p.id)+'" '+(p.id===current?"selected":"")+'>'+E(p.label??p.id)+'</option>').join("");}
function setPanel(name,load=true){
 if(!summary||!panels.includes(name))return;state.panel=name;
 for(const p of panels){$(p+"-panel").hidden=p!==name;$("tab-"+p).setAttribute("aria-selected",String(p===name));$("tab-"+p).tabIndex=p===name?0:-1;}
 if(name==="totals"){renderTotalsShell();if(load)loadTotals(totalsOffset);}if(name==="definition")renderDefinition();if(name==="sources")loadSources();
}
function appliedLabel(){return "Applied view: "+(state.filters.pair||"all pairs")+"; "+(state.filters.classification||"all classifications")+"; "+(state.filters.search?("literal key text "+JSON.stringify(state.filters.search)):"all keys");}
function renderRows(){
 if(!pageData){$("row-table").innerHTML="";$("row-pager").innerHTML="";return;}
 const items=pageData.rows;
 $("row-table").innerHTML=table(["Comparison record","Source / target pair","Original source key","Selected target key","Native classification","Source / target group rows","Review items"],items.map(row=>[
 '<button class="row-link" data-row="'+E(row.row_id)+'" aria-current="'+(row.row_id===state.rowId)+'">Record '+E(row.row_id)+'</button>',
 E(pairById(row.pair)?.label??row.pair??"Unspecified pair"),value(row.source_key),value(row.key),badge(row.classification),
 E(row.group_source_rows??row.source_records?.length??0)+" / "+E(row.group_target_rows??row.target_records?.length??0),
 E(row.issues?.length??0)
 ]),"Page of native comparison records");
 $("rows-status").textContent=appliedLabel()+". Showing "+(items.length?(pageData.offset+1)+"–"+(pageData.offset+items.length):"0")+" of "+pageData.total+" matching records. Full downloads remain complete.";
 $("row-pager").innerHTML='<button data-page="previous" '+(pageData.offset===0?"disabled":"")+'>Previous 40</button><span class="small">'+E(pageData.total)+' matching comparison records</span><button data-page="next" '+((pageData.offset+items.length>=pageData.total)?"disabled":"")+'>Next 40</button>';
 $("download-page-csv").disabled=!items.length;
}
async function loadRows(offset=0){
 const generation=++listGeneration;listRequest?.abort();detailRequest?.abort();detailGeneration++;listRequest=new AbortController();
 const parameters={...state.filters,offset,limit:state.limit};pageData=null;detailRow=null;state.rowId=null;state.field="";resetLazy("records");
 $("record-detail").innerHTML='<p class="empty">Choose a record from this view to inspect its full comparison.</p>';$("rows-error").hidden=true;$("rows-status").textContent="Loading the requested original-case page…";
 renderRows();$("download-page-csv").disabled=true;
 try{
   const data=await api("api/rows",parameters,listRequest.signal);if(generation!==listGeneration)return;
   invariant(Number.isSafeInteger(data.total)&&data.total>=0&&Number.isSafeInteger(data.offset)&&Array.isArray(data.rows),"Invalid original page response");
   invariant(data.offset===offset&&data.rows.every(r=>Number.isSafeInteger(r.row_id)&&r.row_id>0),"Original page identity differs");
   invariant(data.rows.length<=state.limit,"Original server returned more than the selected page");
   state.offset=offset;pageData=data;renderRows();updateDownloadLinks();return true;
 }catch(error){if(error.name==="AbortError"||generation!==listGeneration)return;$("rows-error").textContent=error.message;$("rows-error").hidden=false;$("rows-status").textContent="The selected page is unavailable. Original case files are unchanged.";return false;}
}
async function openRow(id,focus=false){
 const generation=++detailGeneration;detailRequest?.abort();detailRequest=new AbortController();state.rowId=id;detailRow=null;state.field="";
 $("record-detail").innerHTML='<p class="busy" role="status">Loading original comparison record '+E(id)+'…</p>';renderRows();
 try{const row=await api("api/row",{id},detailRequest.signal);if(generation!==detailGeneration)return;invariant(row.row_id===id,"Original record response differs");detailRow=row;renderDetail();if(focus)$("record-detail").focus();return true;}
 catch(error){if(error.name==="AbortError"||generation!==detailGeneration)return;$("record-detail").innerHTML='<div class="error">'+E(error.message)+'</div>';return false;}
}
function renderDetail(){
 const r=detailRow;if(!r)return;resetLazy("records");const pair=pairById(r.pair),fields=(r.fields||[]).filter(f=>!state.field||f.id===state.field);
 $("record-detail").innerHTML='<hr><div class="detail-head"><h2>Comparison record '+E(r.row_id)+'</h2><button id="download-record">Download full record JSON</button></div>'+badge(r.classification)+defs([["Selected pair",E(pair?.label??r.pair??"Unspecified")],["Original source key",value(r.source_key)],["Selected target key",value(r.key)],["Source / target group size",E(r.group_source_rows??r.source_records?.length??0)+" / "+E(r.group_target_rows??r.target_records?.length??0)]])+'<p class="small muted">Ambiguous groups may contain one comparison record per original row. Group counts are retained; rows are never paired arbitrarily.</p><div class="dual"><section class="readonly"><h3>Original source records</h3>'+paginateRefs(r.source_records)+'</section><section class="readonly"><h3>Original target records</h3>'+paginateRefs(r.target_records)+'</section></div><label for="field-filter">Field view<select id="field-filter"><option value="">Every compared field</option>'+(r.fields||[]).map(f=>'<option value="'+E(f.id)+'" '+(state.field===f.id?"selected":"")+'>'+E(f.id)+'</option>').join("")+'</select></label>'+
 table(["Field / type","Original normalized source","Original normalized target","Transformed exact source / target","Target − source","Selected tolerance","Native decision / reason"],fields.map(f=>[E(f.id)+"<br>"+E(f.kind),value(f.source_value),value(f.target_value),f.kind==="decimal"?quantity(f.source_exact)+"<br>"+quantity(f.target_exact):'<span class="muted">Typed value comparison</span>',f.kind==="decimal"?quantity(f.difference):'<span class="muted">Not applicable</span>',f.kind==="decimal"?quantity(f.tolerance):'<span class="muted">Exact typed equality</span>',badge(f.status)+(f.reason?'<p>'+E(f.reason)+'</p>':"")]),fields.length+" of "+(r.fields||[]).length+" saved fields")+
 '<h3>Dimensions and mapping interpretation</h3>'+details("Exact pair key, field and dimension definition",pair??{})+
 '<h3>Original unresolved issues</h3>'+issueList(r.issues)+details("Complete original comparison record",r);
}

function renderTotalsShell(){
 const fields=[...new Set([...summary.pairs.flatMap(p=>(p.fields||[]).filter(f=>f.kind==="decimal").map(f=>f.id)),...(totalsFilters.field?[totalsFilters.field]:[])])].sort();
 const statuses=[...new Set([...summary.pairs.flatMap(p=>Object.keys(p.totals?.status_counts??{})),...(totalsFilters.status?[totalsFilters.status]:[])])].sort();
 $("totals-panel").innerHTML='<h2>Exact totals by retained dimensions</h2><p>Every dimension group stays in the native disk-backed result. This view requests forty groups at a time. Computable subtotals and excluded/uncomputed rows remain explicit.</p><form id="totals-filters" class="filter-form"><label for="totals-pair">Selected pair<select id="totals-pair">'+pairOptions(totalsFilters.pair,true)+'</select></label><label for="totals-field">Numeric field<select id="totals-field"><option value="">Every numeric field</option>'+fields.map(f=>'<option value="'+E(f)+'" '+(totalsFilters.field===f?"selected":"")+'>'+E(f)+'</option>').join("")+'</select></label><label for="dimension-search">Literal dimension text<input id="dimension-search" value="'+E(totalsFilters.search)+'" type="search"></label><label for="total-status">Native total state<select id="total-status"><option value="">Every state</option>'+statuses.map(s=>'<option value="'+E(s)+'" '+(totalsFilters.status===s?"selected":"")+'>'+E(s)+'</option>').join("")+'</select></label><button type="submit" class="primary">Apply totals view</button></form><p id="totals-status" class="status-line" role="status"></p><div id="totals-error" class="error" hidden></div><div id="totals-table"></div><div id="totals-pager" class="pager"></div><div class="row"><a id="download-filtered-totals-csv" class="button" download>Stream all matching totals CSV</a><a id="download-filtered-totals-jsonl" class="button" download>Stream all matching totals JSONL</a></div><article id="total-detail" class="record-panel" tabindex="-1"><p class="empty">Select an exact dimension-group total for its complete saved record.</p></article>';
 updateDownloadLinks();
}
async function loadTotals(offset=0){
 const generation=++totalsGeneration;totalsRequest?.abort();totalRequest?.abort();totalGeneration++;totalsRequest=new AbortController();totalsData=null;totalRow=null;resetLazy("totals");
 $("totals-table").innerHTML="";$("total-detail").innerHTML='<p class="empty">Select an exact dimension-group total.</p>';$("totals-pager").innerHTML="";$("totals-error").hidden=true;$("totals-status").textContent="Reading the requested original total groups…";
 try{
 const data=await api("api/totals",{...totalsFilters,offset,limit:40},totalsRequest.signal);if(generation!==totalsGeneration)return;
 invariant(Number.isSafeInteger(data.total)&&data.total>=0&&data.offset===offset&&Array.isArray(data.rows)&&data.rows.length<=40&&data.rows.every(t=>Number.isSafeInteger(t.total_id)&&t.total_id>0),"Invalid original total page");
 totalsData=data;totalsOffset=offset;renderTotalPage();updateDownloadLinks();return true;
 }catch(error){if(error.name==="AbortError"||generation!==totalsGeneration)return;$("totals-error").textContent=error.message;$("totals-error").hidden=false;$("totals-status").textContent="The selected total page is unavailable; original results remain unchanged.";return false;}
}
function renderTotalPage(){
 if(!totalsData)return;const d=totalsData;
 $("totals-table").innerHTML=table(["Total record / pair","Dimensions / field","Source exact subtotal","Source rows / uncomputed","Target exact subtotal","Target rows / uncomputed","Exact target − source","Native state"],d.rows.map(t=>[
 '<button data-total="'+t.total_id+'">Total '+t.total_id+'</button><br>'+E(pairById(t.pair)?.label??t.pair),value(t.dimensions)+"<br>"+E(t.field),quantity(t.source?.sum),E(t.source?.rows??"Not supplied")+" / "+E(t.source?.uncomputed_rows??"Not supplied"),quantity(t.target?.sum),E(t.target?.rows??"Not supplied")+" / "+E(t.target?.uncomputed_rows??"Not supplied"),quantity(t.difference),badge(t.status)]),"Original dimension totals page");
 $("totals-status").textContent="Showing "+(d.rows.length?d.offset+1:0)+"–"+(d.offset+d.rows.length)+" of "+d.total+" matching total groups. Applied pair: "+(totalsFilters.pair||"all")+"; field: "+(totalsFilters.field||"all")+"; state: "+(totalsFilters.status||"all")+"; dimension text: "+JSON.stringify(totalsFilters.search)+".";
 $("totals-pager").innerHTML='<button data-totals-page="previous" '+(d.offset===0?"disabled":"")+'>Previous 40 groups</button><span>'+d.total+' matching groups</span><button data-totals-page="next" '+(d.offset+d.rows.length>=d.total?"disabled":"")+'>Next 40 groups</button>';
}
async function openTotal(id,focus=false){
 const generation=++totalGeneration;totalRequest?.abort();totalRequest=new AbortController();totalRow=null;$("total-detail").innerHTML='<p class="busy">Reading original dimension-group total…</p>';
 try{
 const t=await api("api/total",{id},totalRequest.signal);if(generation!==totalGeneration)return;invariant(t.total_id===id,"Original total identity differs");totalRow=t;renderTotalDetail();if(focus)$("total-detail").focus();return true;
 }catch(error){if(error.name==="AbortError"||generation!==totalGeneration)return;$("total-detail").innerHTML='<div class="error">'+E(error.message)+'</div>';return false;}
}
function renderTotalDetail(){
 if(!totalRow)return;resetLazy("totals");const t=totalRow;
 $("total-detail").innerHTML='<hr><div class="detail-head"><h3>Complete total '+t.total_id+'</h3><button id="download-total">Download complete total JSON</button></div>'+badge(t.status)+defs([["Selected pair",E(pairById(t.pair)?.label??t.pair)],["Exact dimensions",value(t.dimensions)],["Numeric field",E(t.field)],["Source subtotal",quantity(t.source?.sum)],["Source rows / uncomputed rows",E(t.source?.rows)+" / "+E(t.source?.uncomputed_rows)],["Target subtotal",quantity(t.target?.sum)],["Target rows / uncomputed rows",E(t.target?.rows)+" / "+E(t.target?.uncomputed_rows)],["Exact difference",quantity(t.difference)]])+'<p>'+E(t.meaning??"Incomplete dimensions or values retain their uncomputed count; a computable subtotal is not a complete total.")+'</p>'+details("Entire original dimension-total record",t);
}
function downloadHref(route,parameters){const u=endpoint(route,parameters);return u.pathname+u.search;}
function updateDownloadLinks(){
 const links=[["download-filtered-csv","download/rows.csv",state.filters],["download-filtered-jsonl","download/rows.jsonl",state.filters],["download-filtered-totals-csv","download/totals.csv",totalsFilters],["download-filtered-totals-jsonl","download/totals.jsonl",totalsFilters]];
 for(const [id,route,params]of links){const node=$(id);if(node)node.href=downloadHref(route,params);}
}
function renderDefinition(){
 resetLazy("definition");const p=pairById(state.definitionPair)||summary.pairs[0];if(!p){$("definition-panel").innerHTML='<p>No selected pairs.</p>';return;}state.definitionPair=p.id;
 const def=p.definition??p,counts=p.summary?.status_counts??{};
 $("definition-panel").innerHTML='<h2>Selected mappings, population and coverage</h2><label for="definition-pair">Selected pair<select id="definition-pair">'+pairOptions(p.id)+'</select></label>'+defs([["Source table",E(p.source_table??def.source?.table)],["Target table",E(p.target_table??def.target?.table)],["Source key columns",value(p.key_fields?.source??def.source?.keys)],["Target key columns",value(p.key_fields?.target??def.target?.keys)],["Dimensions",value(p.dimensions)],["Selected comparison records",E(p.comparison_records??p.summary?.comparison_records??"See complete summary")]])+
 table(["Source rows","Target rows","Key groups","Issue count"],[[E(p.summary?.source_rows),E(p.summary?.target_rows),E(p.summary?.key_groups),E(p.summary?.issue_count)]])+
 table(["Native classification","Comparison records"],Object.entries(counts).map(([k,v])=>[badge(k),E(v)]))+
 '<h3>Field definitions and exact transformations</h3>'+table(["Field","Kind","Source binding","Target binding","Tolerance / null rule"],(p.fields||def.fields||[]).map(f=>[E(f.id),E(f.kind),value(f.source),value(f.target),(f.kind==="decimal"?quantity(f.tolerance):"Exact typed equality")+"<br>"+(f.allow_both_null===true?"Both-null explicitly allowed":f.allow_both_null===false?"Both-null not allowed":"See complete original definition")]))+
 '<h3>Crosswalk and mapping issues</h3>'+table(['Issue code','Original issue records'],Object.entries(p.crosswalk_issue_counts||{}).map(([k,v])=>[E(k),E(v)]))+'<p>'+E(p.crosswalk_issues??'Every original issue remains in the comparison population.')+'</p><button id="show-crosswalk" data-pair="'+E(p.id)+'">Open complete crosswalk issue population</button>'+details("Complete original pair definition and aggregate outcomes",p)+details("Complete source-quality result",summary.source_quality??{});
}
async function loadSources(){
 if(manifest&&sourceReport){renderSources();return;}
 if(sourceLoading){await sourceLoading;return;}
 $("sources-panel").innerHTML='<h2>Original source inventory</h2><p class="busy">Reading complete original manifests and source report…</p>';
 sourceLoading=(async()=>{try{
   const [m,s]=await Promise.all([api("api/manifest"),api("api/source-report")]);
   invariant(s.run_identity===summary.source_run_identity&&m.data_class===summary.data_class,"Original source response belongs to another case");
   invariant(isSame(s.lineage?.inputs,summary.source_inputs),"Original source inventory differs from the selected result");
   manifest=m;sourceReport=s;renderSources();
 }catch(error){$("sources-panel").innerHTML='<h2>Original sources</h2><div class="error">'+E(error.message)+'</div><button id="retry-sources">Retry original source read</button>';}finally{sourceLoading=null;}})();await sourceLoading;
}
function canonical(v){if(v instanceof ExactJSONNumber)return {$exactNumber:v.token};if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==="object")return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
const isSame=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function renderSources(){
 resetLazy("sources");const profiles=new Map((sourceReport.tables||[]).map(p=>[p.id,p])),definitions=new Map(manifest.tables.map(t=>[t.id,t]));
 $("sources-panel").innerHTML='<h2>Complete original source and target tables</h2>'+defs([["Source case",'<span class="mono">'+E(summary.source_run_identity)+'</span>'],["Data class",E(summary.data_class)],["Original source quality",badge(sourceReport.quality_status)],["Original interpretation",E(summary.interpretation_reference)]])+
 '<p>Every retained CSV is bound by its full bytes and SHA256. Record drilldown is read by the original native CSV reader, including quoted multiline and blank records. No browser reconstruction or sampling is used.</p>'+
 (summary.source_inputs||[]).map(s=>{const p=profiles.get(s.table);return '<section class="issue"><h3>'+E(s.table)+'</h3>'+defs([["Original path",E(s.original_path)],["Retained path",E(s.retained_path)],["Bytes",E(s.bytes)],["SHA256",'<span class="mono">'+E(s.sha256)+'</span>'],["Rows / valid / invalid",E(p?.rows)+" / "+E(p?.valid_rows)+" / "+E(p?.invalid_rows)]])+'<button data-source="'+E(JSON.stringify({table:s.table,record:1}))+'">Read original record</button>'+details("Complete table definition",definitions.get(s.table))+details("Complete original table profile",p)+'</section>';}).join("")+
 details("Original report: tables, metrics, relationships and registers",sourceReport)+details("Complete original manifest",manifest)+details("Exact selected recipe files",summary.recipe_files??[]);
}
async function openSource(ref){
 focusBeforeDialog=document.activeElement;activeSource={table:ref.table,record:Number(ref.record)};sourceGeneration++;sourceRequest?.abort();
 $("source-title").textContent=String(ref.table)+" · record "+String(ref.record);$("source-content").innerHTML='<p class="busy">Reading exact original CSV record…</p>';
 if(!$("source-dialog").open)$("source-dialog").showModal();$("source-close").focus();await readSource();
}
async function readSource(){
 const generation=++sourceGeneration;sourceRequest?.abort();sourceRequest=new AbortController();const ref={...activeSource};
 $("source-content").innerHTML='<p class="busy" role="status">Reading original source record…</p>';
 try{
   invariant(Number.isSafeInteger(ref.record)&&ref.record>0,"Choose a positive original data record number");
   const r=await api("api/source",ref,sourceRequest.signal);if(generation!==sourceGeneration)return;
   const s=summary.source_inputs.find(x=>x.table===ref.table);
   invariant(r.table===ref.table&&r.record===ref.record&&s&&r.source?.sha256===s.sha256&&r.source?.bytes===s.bytes&&r.source?.retained_path===s.retained_path,"Original record source identity differs");
   invariant(Array.isArray(r.headers)&&Array.isArray(r.values),"Original CSV row must retain arrays");resetLazy("source-dialog");
   $("source-content").innerHTML=defs([["Table",E(r.table)],["Data record",E(r.record)],["Retained path",E(r.source.retained_path)],["Complete source SHA256",'<span class="mono">'+E(r.source.sha256)+'</span>']])+
   '<p>One-based data record after the CSV header. A blank record has no values; missing fields are distinct from present empty strings.</p><div class="source-tools"><label for="source-record">Read another original record<input id="source-record" type="number" min="1" step="1" value="'+E(r.record)+'"></label><button id="source-read">Read record</button><button id="download-source-record">Download this record JSON</button></div>'+
   table(["Original header","Raw original value"],Array.from({length:Math.max(r.headers.length,r.values.length)},(_,i)=>[E(r.headers[i]??("Undeclared column "+(i+1))),i<r.values.length?value(r.values[i]):'<span class="muted">Missing field</span>']),"Complete raw CSV record · "+r.values.length+" values")+
   details("Complete native record response",r);
   activeSource={...ref,result:r};$("source-title").textContent=ref.table+" · record "+ref.record;
 }catch(error){if(error.name==="AbortError"||generation!==sourceGeneration)return;$("source-content").innerHTML='<div class="error">'+E(error.message)+'</div><label for="source-record">Original data record number<input id="source-record" type="number" min="1" value="'+E(ref.record)+'"></label><button id="source-read">Read record</button>';}
}
function download(name,body,type="application/json"){const u=URL.createObjectURL(new Blob([body],{type})),a=document.createElement("a");a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
function viewDocument(){return {schema:"tjlabs.migration-reconciliation.view.v1",source_run_identity:summary.source_run_identity,selection_sha256:summary.selection_sha256,panel:state.panel,filters:{...state.filters},offset:state.offset,exact:state.exact,row_id:state.rowId,field:state.field,totals_filters:{...totalsFilters},totals_offset:totalsOffset,total_id:totalRow?.total_id??null,definition_pair:state.definitionPair};}
function safeCell(x){let s=x==null?"":typeof x==="string"?x:pretty(x);if(/^\s*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function pageCSV(){
 if(!pageData)return;const rows=[["row_id","pair","classification","source_key","target_key","issue_count","source_records","target_records"],...pageData.rows.map(r=>[r.row_id,r.pair,r.classification,r.source_key,r.key,r.issues?.length??0,r.source_records,r.target_records])];
 download("Migration_Current_Page.csv",rows.map(r=>r.map(safeCell).join(",")).join("\r\n")+"\r\n","text/csv;charset=utf-8");
 notice("Exported "+pageData.rows.length+" current-page comparison records out of "+pageData.total+" matches. Use streamed full downloads for the complete population.");
}
function pageHTML(){
 if(!pageData){notice("Load a comparison page first.");return;}
 const view=viewDocument(),content='<h1>Migration reconciliation — current page snapshot</h1><p><strong>TokenJunkieLabs (TJLabs)</strong></p><p>This is an explicitly limited read-only snapshot: '+pageData.rows.length+' current-page records of '+pageData.total+' matches. Complete results remain in the original native case and streamed downloads. It has no server token or live API.</p>'+
 '<h2>Exact case and view</h2><pre>'+E(pretty(view))+'</pre><h2>Complete current-page records</h2><pre>'+E(pretty(pageData.rows))+'</pre>'+(detailRow?'<h2>Selected full comparison record</h2><pre>'+E(pretty(detailRow))+'</pre>':"");
 download("Migration_Current_Page.html",'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;"><title>Migration current page snapshot</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#222;background:white;max-width:75rem;margin:auto;padding:1.3rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:1rem;background:#f4f4f4;border:1px solid #ccc}h1{font-size:1.6rem}</style></head><body>'+content+'</body></html>',"text/html;charset=utf-8");
 notice("Downloaded the explicitly labelled current-page snapshot. The full case stays in the complete handover.");
}
async function restoreView(file){
 if(!file||!summary)return;try{
 invariant(file.size<=1024*1024,"View settings are limited to one MiB; select the small view-settings file, not the complete case");
 const v=JSON.parse(await file.text());
 invariant(v.schema==="tjlabs.migration-reconciliation.view.v1"&&v.source_run_identity===summary.source_run_identity&&v.selection_sha256===summary.selection_sha256,"View settings belong to a different exact case or interpretation");
 const strings=(o,keys)=>o&&typeof o==="object"&&!Array.isArray(o)&&keys.every(k=>typeof o[k]==="string"&&o[k].length<=1000);
 const id=x=>x===null||(Number.isSafeInteger(x)&&x>0);
 invariant(panels.includes(v.panel)&&strings(v.filters,["pair","classification","search"])&&Number.isSafeInteger(v.offset)&&v.offset>=0&&typeof v.exact==="boolean"&&typeof v.field==="string"&&id(v.row_id),"Invalid complete view settings");
 invariant(!v.filters.pair||pairById(v.filters.pair),"View references an absent selected pair");
 invariant(strings(v.totals_filters,["pair","field","search","status"])&&Number.isSafeInteger(v.totals_offset)&&v.totals_offset>=0&&id(v.total_id),"Invalid totals view settings");
 invariant(!v.totals_filters.pair||pairById(v.totals_filters.pair),"Totals view references an absent selected pair");
 invariant(typeof v.definition_pair==="string"&&(!v.definition_pair||pairById(v.definition_pair)),"Invalid mapping view");
 state.filters={pair:v.filters.pair,classification:v.filters.classification,search:v.filters.search};state.exact=v.exact;
 Object.assign(totalsFilters,v.totals_filters);totalsOffset=v.totals_offset;state.definitionPair=v.definition_pair;
 syncFilters();invariant(await loadRows(v.offset),"Restored filters could not read their original page; retry that view.");
 if(v.row_id!==null){invariant(await openRow(v.row_id),"Selected original record could not be reopened.");invariant(!v.field||detailRow.fields.some(f=>f.id===v.field),"Saved field is absent from the original record");state.field=v.field;renderDetail();}
 setPanel(v.panel,false);
 if(v.panel==="totals"){invariant(await loadTotals(v.totals_offset),"Original totals page unavailable");if(v.total_id!==null)invariant(await openTotal(v.total_id),"Selected original total could not be reopened.");}
 notice("Restored the view against this same complete source/selection. No native result was changed.");
 }catch(error){notice("View settings were not received: "+error.message);}
}
function syncFilters(){if(state.filters.classification&&!Array.from($("status-filter").options).some(o=>o.value===state.filters.classification))$("status-filter").add(new Option(state.filters.classification,state.filters.classification));$("pair-filter").value=state.filters.pair;$("status-filter").value=state.filters.classification;$("key-search").value=state.filters.search;$("exact-values").checked=state.exact;}
document.addEventListener("click",e=>{
 const b=e.target.closest("button");if(!b)return;if(!summary){notice("Wait for the selected original case summary to finish loading.");return;}
 if(b.dataset.panel)setPanel(b.dataset.panel);
 if(b.dataset.row)openRow(Number(b.dataset.row),true);
 if(b.dataset.page&&pageData)loadRows(b.dataset.page==="next"?pageData.offset+state.limit:Math.max(0,pageData.offset-state.limit));
 if(b.dataset.source){try{openSource(JSON.parse(b.dataset.source));}catch(error){notice(error.message);}}
 if(b.dataset.refPage){const d=b.closest("details"),item=lazy.get(d.dataset.refs);item.page+=Number(b.dataset.refPage);renderRefs(d);d.querySelector("summary").focus();}
 if(b.dataset.total)openTotal(Number(b.dataset.total),true);
 if(b.dataset.totalsPage&&totalsData)loadTotals(b.dataset.totalsPage==="next"?totalsOffset+40:Math.max(0,totalsOffset-40));
 if(b.id==="show-crosswalk"){state.filters={pair:b.dataset.pair,classification:"CROSSWALK_ISSUE",search:""};syncFilters();setPanel("records");loadRows(0);}
 if(b.id==="download-total"&&totalRow)download("Migration_Total_"+totalRow.total_id+".json",rawJSON.get(totalRow)??(pretty(totalRow)+"\n"));
 if(b.id==="source-read"){activeSource={table:activeSource.table,record:Number($("source-record").value)};readSource();}
 if(b.id==="download-record"&&detailRow)download("Migration_Record_"+detailRow.row_id+".json",rawJSON.get(detailRow)??(pretty(detailRow)+"\n"));
 if(b.id==="download-source-record"&&activeSource?.result)download("Migration_Source_Record.json",rawJSON.get(activeSource.result)??(pretty(activeSource.result)+"\n"));
 if(b.id==="retry-sources")loadSources();
});
document.addEventListener("change",e=>{
 if(e.target.id==="field-filter"){state.field=e.target.value;renderDetail();}
 if(e.target.id==="definition-pair"){state.definitionPair=e.target.value;renderDefinition();}
 
 if(e.target.id==="load-view")restoreView(e.target.files[0]);
});
document.addEventListener("submit",e=>{
 if(e.target.id==="row-filters"){e.preventDefault();if(!summary){notice("Original summary not ready.");return;}state.filters={pair:$("pair-filter").value,classification:$("status-filter").value,search:$("key-search").value};loadRows(0);}
 if(e.target.id==="totals-filters"){e.preventDefault();if(!summary)return;Object.assign(totalsFilters,{pair:$("totals-pair").value,field:$("totals-field").value,search:$("dimension-search").value,status:$("total-status").value});loadTotals(0);}
});
$("reset-filters").onclick=()=>{if(!summary)return;state.filters={pair:"",classification:"",search:""};syncFilters();loadRows(0);};
$("exact-values").onchange=e=>{if(!summary)return;state.exact=e.target.checked;renderDetail();if(state.panel==="totals"){renderTotalPage();renderTotalDetail();}};
$("download-page-csv").onclick=pageCSV;$("download-page-html").onclick=pageHTML;
$("save-view").onclick=()=>{if(summary)download("Migration_View.json",pretty(viewDocument())+"\n");};
$("print").onclick=()=>window.print();
$("source-close").onclick=()=>$("source-dialog").close();
$("source-dialog").addEventListener("close",()=>{sourceGeneration++;sourceRequest?.abort();focusBeforeDialog?.focus();});
document.querySelector(".tabs").addEventListener("keydown",e=>{if(!summary)return;const i=panels.indexOf(state.panel);let j;if(e.key==="ArrowRight")j=(i+1)%panels.length;if(e.key==="ArrowLeft")j=(i+panels.length-1)%panels.length;if(e.key==="Home")j=0;if(e.key==="End")j=panels.length-1;if(j!==undefined){e.preventDefault();setPanel(panels[j]);$("tab-"+panels[j]).focus();}});
(async()=>{
 try{
  const [result,capabilities]=await Promise.all([api("api/summary"),api("api/capabilities")]);
  invariant(result.schema==="tjlabs.migration-reconciliation.result.v1"&&result.source_run_identity===boot.source_run_identity&&result.data_class===boot.data_class&&result.selection_sha256===boot.selection_sha256,"Server summary differs from the selected original case");
  invariant(Array.isArray(result.pairs)&&Array.isArray(result.source_inputs),"Complete pair/source inventory is required");
  invariant(capabilities.schema==="tjlabs.migration-reconciliation.capabilities.v1"&&capabilities.read_only===true,"The selected server must be read-only");
  summary=result;
  const archiveLink=$("download-case");if(!capabilities.archive_available){archiveLink.removeAttribute("href");archiveLink.setAttribute("aria-disabled","true");archiveLink.tabIndex=-1;$("archive-status").textContent="A complete case archive was not selected for this server. Use the original native pack command and reopen with --archive.";}else{$("archive-status").textContent="Verified prepacked case: "+capabilities.archive.bytes+" bytes · SHA256 "+capabilities.archive.sha256;}
  $("case-label").textContent=result.label??boot.label;$("case-identity").textContent=result.source_run_identity;$("meaning").textContent=result.meaning??"";
  $("pair-filter").innerHTML=pairOptions("",true);
  const statuses=[...new Set(result.pairs.flatMap(p=>Object.keys(p.summary?.status_counts??{})))].sort();
  $("status-filter").innerHTML='<option value="">All classifications</option>'+statuses.map(s=>'<option value="'+E(s)+'">'+E(s)+'</option>').join("");
  const sourceRows=result.pairs.reduce((n,p)=>n+(p.summary?.source_rows??0),0),targetRows=result.pairs.reduce((n,p)=>n+(p.summary?.target_rows??0),0),issues=result.pairs.reduce((n,p)=>n+(p.summary?.issue_count??0),0);
  $("case-summary").innerHTML=[["Selected table pairs",result.pairs.length],["Source rows across pair selections",sourceRows],["Target rows across pair selections",targetRows],["Native issue count",issues]].map(([name,n])=>'<div class="stat"><strong>'+E(n)+'</strong><span>'+E(name)+'</span></div>').join("");
  await loadRows(0);
 }catch(error){fatal(error);$("rows-status").textContent="The original case summary is unavailable. No source or calculation has been changed.";}
})();
})();

"""

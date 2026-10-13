# Offline ambient measurement explorer

## Open the complete saved source family

Open `measurement-explorer.html` beside `report.html` in this directory. Its complete observation document is embedded once, so normal filtering, row inspection and exports operate directly from disk without a server or network request. Keep the accompanying `original/` files and source inventories in their saved relative locations: each measurement links to the captured result, activity, station and limit CSV records.

The native edition, full report files and independent receiving procedure remain in [NATIVE_OPENING.md](NATIVE_OPENING.md). The explorer is a companion to that original source and report workflow.

## Work through the observations

Choose a station and parameter, then an exact comparison group when you want one method, medium, fraction, unit and reporting basis. Each numbered group lists its complete 16-field definition under the filter panel. Group identifiers are display identifiers for this saved edition, not agency station, method or result identifiers.

Combine a source analysis window with explicit dates, month or season to inspect actual sampling coverage. Censoring, source-comment, detected-code, qualifier and result-status filters retain those distinct source fields. Text search uses station, parameter, result/activity IDs, methods and original comments. Numeric sorting becomes available only after selecting one exact group; the original value and unit remain the displayed measurements.

The status line counts matching observations, exact groups, distinct sampled dates, censored results and commented records. These are counts of the returned original records. A calendar gap is not an unsampled concentration estimate, and a source comment code is not automatically an invalidity judgment.

The table initially shows 50 rows. Use Previous/Next or select 100/250 rows per page; no record is dropped. Choose displayed columns without changing the selection or exports. A sample time and time-zone column can distinguish multiple measurements on one date.

Open a row to inspect every original joined field, original result/activity/station CSV row references, each detection/quantitation limit with its own source reference, and the full comparison-group definition. A separate analytical-review notice appears for records in the derivation’s source-value review table. It is bound by both original station and result ID, displays the exact review trigger and interpretation, and links the derived review CSV. It does not change the original value, source qualifier, original comment codes or comparison group. In particular, the reported dissolved-oxygen trigger is an analyst-selected source-reconciliation trigger, not a new water-quality criterion.

The dialog supports its Close button and the browser's Escape behavior, returning focus to the original row button. The per-row JSON download preserves the complete joined record.

## Export and retain the complete selection

“Download all selected rows · CSV” exports every matching row and all original fields, regardless of current page or displayed columns. Original strings are quoted without concentration substitutions or spreadsheet-specific rewriting. Nested source references, quality-code arrays and limit records are represented as JSON cells. Standard RFC-style CSV readers preserve their embedded commas, quotes and newlines.

“Download selection, filters and full rows · JSON” retains the saved edition metadata, exact current filters, comparison-group field definition, selected count, separate analytical-review records and complete original joined rows. It is useful for passing an explicit source selection to another operator. The download applies pending search text before creating the file.

“Download the complete observation document” retains the complete embedded input document, including its schema, interpretation and all rows. Browser printing prints the displayed table page; the downloads contain the full selected or complete dataset.

The source inventory links every included capture and its original publisher request. The accompanying local file is the captured edition. A live publisher request may return a later edition.

## Reproduce from the authored derivation

`create_report_explorer.mjs` is a dependency-free JavaScript module. It exports `renderExplorer(built, options={})`, `buildExplorer(document, options={})`, `createExplorerModel(document, groupFields)` and `GROUP_FIELDS`.

Use the same original-data derivation output as the saved report:

```js
import { renderExplorer } from './create_report_explorer.mjs';
const base = 'source/nc_ambient_measurements/20261013/';
files[base + 'measurement-explorer.html'] = renderExplorer(built);
```

`renderExplorer` preferentially parses `built.files[base + 'observations.json']` so the complete original document metadata remains present. It also accepts `built.observations` as an array or a document containing `rows`. It uses `built.sourceInventory` for captured file identities and publisher links. Stations and parameters are derived from actual rows, so additional original Big Creek records join the same controls when the maintained derivation includes them.

Options include `title`, `sourcePrefix`, `sourceEdition`, `datasetSha256`, `reportHref` and `sources`. The source prefix defaults to this application-relative directory and is stripped for local captured-file links. A source record can explicitly provide `href`; otherwise its path must lie under that prefix. Only safe relative links and HTTPS/HTTP publisher links are admitted. No source records are fetched or reclassified by the browser. The complete embedded JSON escapes HTML-sensitive characters; source text is rendered with DOM text nodes.

When using `createExplorerModel` independently, pass the exported `GROUP_FIELDS` explicitly. Its `filter()` returns the original row objects with original indices; `csv()` exports those full original rows. Display-only group numbers remain outside the measurement records.

## Actual source and product acceptance

The first complete run used the retained Horsepasture capture: 1,957 observations, all 59 source-derived exact groups, 425 censored results, 106 water-temperature records and all 14 original capture descriptors. A complete recent-window temperature CSV was decoded again: all 26 rows and all 49 fields matched the original selected objects, including nested source references and limits. The embedded observation rows matched the original derived document exactly. Month filtering reproduced zero prior-window July samples and four recent-window July samples.

The actual generated controller was exercised with the complete source document: initial 50-row paging, station/parameter/window filters, original-row dialog and source references, complete CSV/row-JSON exports, an invalid date range and reset/recovery. These source/controller exercises establish data and control behavior.

Before the completed customer artifact is presented, open the actual generated file in the receiving browser at desktop and narrow widths. Inspect rendered pixels and exercise the same important controls, including keyboard focus/close, original local downloads and whole-selection export after typing a search without waiting. Open every outgoing attachment in its real reader: HTML, CSV, JSON, SVG/figure outputs, PDF and selected-study ZIP. Preserve the actual visual review result with the existing receiving operation. Source parsing or an inventory match does not substitute for that rendered inspection.

# Scientific report changes

Version 1.0.0 · original Upper Savannah operator extension `report-changes`

## Customer workflow

Save two scientific editions in the original **Sources** desk. Open **Report
changes**, choose the intended earlier and later reports, and select **Review
reports and matching**. Reports are identified by their complete original IDs;
the desk does not infer chronology from a title.

For each table, either keep exact-row comparison or explicitly select the columns
that uniquely identify a record. Exact-row matching preserves duplicate counts:
a changed row is one removal and one addition. Explicit keys match the same
record across editions and show its changed cells. A repeated key fails with the
side, table and original row position; select additional key columns. Changes to
keys invalidate the preview, so review the new plan before preparation.

**Prepare complete comparison** uses the original operator action queue. It
retains both complete editions and builds a durable, indexed change register.
Open the saved comparison, filter by type, table or status, and read all pages.
Both original reports remain directly accessible. Original values are displayed
without JavaScript rounding of integers beyond its safe integer range.

**Prepare full comparison ZIP** includes the entire change register, an offline
HTML overview, all change pages, complete CSV, SQLite, structured summary, and
both byte-complete original report trees. Nothing is truncated to the visible
page. Portable receiving creates an independent directory whose original reports
can be compared again with a different explicit matching plan.

## What changes mean

Sections match by exact heading plus occurrence; blocks match by kind plus
occurrence within a section. This identity is explicit in the preview and summary.
Renaming a section produces removal/addition rather than an inferred semantic
match. Table columns retain original labels and duplicate-label occurrence.

The register includes report metadata, contact, presentation, source records and
source order, section/block changes, figures, links, table metadata and row
changes, and the hashes/lengths of every changed original file. Position-only row
changes are counted separately and can be expanded into individual records.
These comparisons do not calculate a new scientific result, convert units, or
infer a numerical benefit across different methods/support populations. The
original headers, units, values, sources and files remain available to the reader.

## Native implementation

`operator/report_changes.py` uses the maintained `ScientificReportEditions._inspect`
on both selected saved editions. That original method checks their native source
bindings. Preparation and export hold the original Workspace lock and execute as
`report-changes.prepare` and `report-changes.export`; there is no competing queue,
run scheduler or renderer. Preparation requires the exact preview identity.

`operator/extensions/report-changes.json` registers the provider, **Report changes**
view after **Sources**, routes, original verified file transport and Workspace
verification hook. The additive component fragment selects every implementation
member without editing the shared catalogue, renderer or Sources controller.
The native workspace stores comparisons under `scientific-report-comparisons/`
and exported ZIPs under `scientific-report-comparison-exports/`.

Routes:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/report-changes/catalog` | Original editions and saved comparisons |
| POST | `/api/report-changes/preview` | Exact pair, table/key choices and comparison ID |
| GET | `/api/report-changes/detail?id=ID` | Saved report pair and original file links |
| GET | `/api/report-changes/rows?id=ID&after=0&limit=100` | Complete keyset-paginated register |
| POST | `/api/actions` | Original prepare/export task with retained operation ID |

The preview body is `{"left":"EDITION_ID","right":"EDITION_ID","plan":{"row_keys":{},"include_positions":false}}`.
Use returned table IDs as `row_keys` keys and original **left-column zero-based
indexes** as values, such as `{"TABLE_ID":[0,2]}`. The preview reports matching
right-column indexes by exact, unambiguous header identity. A prepare payload
contains the same body plus `preview_id` equal to the returned preview `id`.

Rows support `category`, `table_id` and `status` filters. Continue using the returned
`next_after` until it is null. Page size is a presentation choice, not a limit on
the comparison. The complete CSV and SQLite are always retained.

## Offline receiving and re-comparison

Python 3.10+ and its standard library are sufficient for the comparison engine.
The existing GIS application remains necessary to render new scientific editions;
it is not necessary to inspect or re-compare already delivered originals.

Run from the application/source root:

```sh
python -m model.report_changes preview /path/earlier-edition /path/later-edition
python -m model.report_changes build /path/earlier-edition /path/later-edition /new/comparison --plan matching.json
python -m model.report_changes rows /new/comparison --limit 100
python -m model.report_changes export /new/comparison /delivery/report-comparison.zip
python -m model.report_changes receive /delivery/report-comparison.zip /new/received-comparison
python -m model.report_changes inspect /new/received-comparison
python -m model.report_changes build /new/received-comparison/left /new/received-comparison/right /new/alternative-comparison
```

Open `index.html` in the received directory. Relative original-file paths and
report assets are preserved. Exports use streaming ZIP64; receiving checks the
complete member inventory, paths, lengths and SHA256 values before publication.
Default receiving capacity is 100,000 members and 2 TiB uncompressed; Python
callers may explicitly configure these archive inspection capacity parameters.
There is no silent row/file omission. A destination containing different work is
not overwritten.

## Interruption and throughput

Preparation commits each complete table in a private SQLite transaction and
retains the exact original files once. A process death can be resumed by invoking
the same pair, plan and destination. The original task identity survives a lost
HTTP response in session storage; the desk recovers that request rather than
submitting another. Explicit retry after a failed/interrupted native task starts
a new queue operation for the same content-addressed comparison and resumes its
committed tables. Source renders and scientific model runs are not repeated.

Completed output is atomically published only after its final manifest is
verified. An interruption after completion but before directory rename reopens
the complete stage and finishes publication. Offline receiving is also resumable
and create-only. Original reports remain immutable while matching plans and
comparison outputs are independently editable through new comparison editions.

The operator caches verified file identities using device/inode/size/mtime/ctime
plus their expected hash and length. Page reads still check each retained member's
identity; a changed file is rehashed and corruption rejected. Unchanged completed
reports are not parsed and hashed in full for every visible page. Cache state is
process-local; cold receiving starts full verification again.

## Installation and operating checks

The normal cumulative application assembly discovers the component fragment.
For an existing checkout, run `python install_report_changes.py --application
/path/to/upstate_forever_2026` from this source package. The additive installer
requires the original report provider and registry, copies only this component's
files, and refuses to replace a differing existing file. Restart the original
operator to discover its descriptor.

Two focused operating courses are included:

```sh
python tests/report_changes_journey.py /new/software-course --rows 12000
python tests/report_changes_browser.py /new/software-course /new/browser-course
```

The first creates complete **authored software-exercise editions**, then performs
explicit/default matching, committed-table interruption, atomic-publication
interruption, complete pagination, ZIP transfer, sender removal, independent
receiving/re-comparison, repeated-key rejection and original-file corruption
checks. It does not represent a watershed-model run.

The browser course executes the actual shipped JavaScript and provider with
explicit original-operator interface fixtures. In the supplied runner, Chromium
network navigation is disabled, so it exercises DOM behavior through Python's
actual loopback HTTP transport and an explicit session-storage port. Selection,
preview invalidation, lost-response remount recovery, task deduplication, filters,
pagination, full archive download, Workspace changes and grayscale desktop/mobile
layout are exercised. Cumulative application boot and regional source-binding
execution are separate integration runs.

Observed authored course: 12,000 primary rows, 1,386 matched-record changes,
1,419 recorded changes, complete core course 3.696 s and browser course 3.768 s.
The 100,000-row case retained 11,581 changes across 47 offline pages and completed
export/receive/re-comparison, including recovery after a process interruption.
Reading 1,000 changes in ten requests measured 1.5545 s with full revalidation
versus 0.1811 s with verified-file reuse (8.58× in this fixture). These are local
software measurements, not regional scientific results or a universal benchmark.

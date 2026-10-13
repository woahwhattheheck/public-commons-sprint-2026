# Editable scientific report tables

This companion belongs to the original scientific report edition, renderer, application and Study. It makes the complete ordered report tables usable in Excel, LibreOffice Calc or another compatible XLSX editor. It is generated beside the report PDF, HTML, Markdown and exact structured report data.

## Open the report and work with its tables

Download the complete saved report archive through the existing Scientific report controls and extract it without moving its relative files. Open **report-tables.xlsx** in a normal spreadsheet application. Start with **Read me**, then use **Contents** to open a table. Table sheets keep the original section and block order; each sheet identifies its original section, complete source table dimensions, selected row/column range and original report-data SHA256.

The five heading rows stay visible when scrolling. Filters apply to the actual table headings and all retained rows. Column widths, wrapped text, grayscale headings and repeated print headings support normal editing. Expand row heights or use the formula bar for long entries. Save an annotated working copy under another name so the original saved report remains easy to identify.

Every scientific value is **literal original display text**. Signs, scientific notation, grouping separators, units, leading zeros, dates, identifiers, “Unavailable” and other original states retain their exact display strings. A cell beginning with an equals sign remains text. The workbook does not reinterpret a formatted quantity as an exact native number, evaluate a formula, convert a date, recalculate a physical quantity or infer missing units. The report's original display-precision statement is prominent on Read me. Use the complete working Study/native records for calculations requiring values beyond the original report's displayed precision.

An edited spreadsheet is a separate scientific working copy. It does not change the original report edition, native input, model result or selected source. Make a scientific input/method/scenario change in the existing application and generate a new deliberate report edition when that is the intended operation.

## Complete source and navigation

The workbook provides:

- **Contents:** every complete table, original heading/block position, actual sheet name and row/column ranges. The first cell links directly to the corresponding table.
- **Narrative:** all original non-table blocks and their original positions. Figure entries retain the exact title, caption, alternative text, relative path, size, checksum and numeric specification from the original report. Figures remain in the complete report folder and in the narrative report formats.
- **Sources:** every field from every original source record, preserving source order and complete literal/structured values.
- **Report binding:** the original schema, title, contact, presentation, display-precision statement and complete source-selection binding.
- **Links:** the complete label and original target for every report-table link. Table cells also retain their original valid source/file hyperlink.
- **Long text:** complete consecutive text parts for values exceeding a spreadsheet cell's supported size or line count. The original cell identifies the text ID. Sort by the retained part number if needed and concatenate **without adding separators** to reconstruct it exactly.

A zero-column original table is retained as an explicit empty-table sheet and index entry, including its original count of zero-width rows. Its exact source remains embedded.

No table is sampled or truncated. Tables beyond the real XLSX row or column boundary continue on explicitly numbered sheets, with complete original offsets in Contents. This is a format boundary, not a new scientific selection.

The XLSX ZIP package includes **source/report-data.json**, copied byte-for-byte from the saved report, and **source/workbook-index.json**, containing its identity, table-to-source coordinates and long-text mapping. Its source/README.txt explains ordinary extraction. These are companions to the editable cells; editing cells does not silently rewrite the original JSON. A spreadsheet editor may drop unfamiliar package members when saving a modified copy, so retain the original downloaded XLSX and the whole original report archive.

Original relative source and figure links are resolved using the delivered report folder. Keep its filenames and structure together. Public source links remain the original publisher references. A hyperlink click is a deliberate reader action; no external formulas, macros, connections or automatic data refresh are created.

## Exact renderer integration

The sole shared report owner composes this module with the editable narrative companion. It must keep every newer renderer/source-selection/archive change.

The public function is:

~~~python
from .scientific_report_workbook import write_workbook

descriptor = write_workbook(directory, report_data_bytes)
~~~

The original caller first writes its complete report-data.json using its maintained writer, then passes those **same exact bytes**. The module checks the saved file before publication and derives all title/sections/contact/source/binding values from that single original. Do not construct a second parallel argument set.

The returned value is the existing common.describe_file descriptor for **report-tables.xlsx**. Register it as report_workbook alongside the current report descriptors. Use the same saved-renderer identity, report-file inventory, original export/receive validation and full Workspace/Study source closure. Advance the renderer's format identity when adding this output; preserve all historical editions and actual prior ZIPs.

The pure function workbook_bytes(report_data_bytes) supplies the deterministic package bytes for the original formatter's focused native exercise. It requires the complete original JSON and uses the original scientific_report._cell and _source_block semantics through a deferred import. It does not import a second scientific writer. Only Python standard-library JSON/XML/ZIP/hash facilities and the existing report/common modules are needed.

Every ZIP member has a fixed packaging timestamp and permissions. The original JSON is compared byte-for-byte after the ZIP is built; ZIP CRC reading also checks every member. Atomic publication uses the original common.atomic_bytes helper. A mismatched saved report-data file, invalid original section/table shape or nonfinite JSON value is reported before publishing the workbook. There is no new native job, scheduler, database or contact route.

## Same original native and attachment operation

The existing equipped scientific report operation receives this complete source with the ODT/current report cohort. Continue from its actual retained Study, source selection and native report edition. Do not rerun the scientific model solely to add a presentation format.

1. Reopen an actual retained complete report-data.json through the current scientific report renderer, preserving its selected source/binding and all original scientific values.
2. Generate the full current report edition and ordinary complete ZIP. Check that the embedded original report-data.json is byte-identical and that all table/section ranges refer to the original ordered blocks.
3. Open the exact emitted XLSX in Excel or LibreOffice Calc. Personally inspect Read me, Contents and **every populated table**, including long notes, literal formula-like text, identifiers, scientific notation and negative/unknown entries where the actual source contains them. Follow an original publisher link and a delivered relative link where present.
4. Use a table filter; clear it; inspect every original row; enlarge a wrapped cell; edit one working-copy annotation; save and reopen that separate file. Confirm the retained original report/Study remains available unchanged.
5. Receive the complete original report ZIP/Study through the existing application, cold reopen its saved edition, download the workbook again and open it normally. Preserve current native request identity and completed original runs.
6. Personally view the current application at the actual presentation width and 390px where relevant; use its exact workbook/download control and reopen the file. Return actual artifact identity and screens that the producing peer can look at. Inspect the ODT/PDF/HTML/source/GIS attachments through their existing normal viewing course too.

A source read, ZIP schema check or screenshot capture is not a substitute for opening and viewing the outgoing spreadsheet. Repair actual unreadable wrapping, clipping, broken relative links or application download issues in this same complete product. Keep the exercise focused on the affected result; no broad suite or independent verification product is introduced.

## Maintained owner direction

Read and retain **AGENTS.md version 2026-10-13.1** and **CURRENT_OWNER_DIRECTION.md version 2026-10-13.4** from this same project. The existing 52-work-order bank additionally directs the product toward Tim running his real files through the application, reviewing scientific interpretation, executing the selected calculation and receiving readable editable results. This workbook uses the existing result model and leaves scientific choices with the scientist.

Before presenting any client/prospect-facing result, the responsible producing peer must open/run/render the exact outgoing version, personally LOOK at its actual screens or real screenshots, and operate its important controls. Include normal and narrow layouts where relevant, populated/empty/loading/error states, download/export and cold reopening. This covers **all attachments** in their normal recipient-facing applications, including every relevant report page, spreadsheet, map, slide, image, archive and audiovisual file. Fix material defects within the current task. Passing source review or another peer's acceptance does not replace actual observation and use.

The old Upper Savannah 14:00 UTC preservation checkpoint does not stop this continuing post-call source work. The owner handoff quoting Bryce's meeting-browser release at original coordination1791908979.290839 restores that existing route while preserving his tabs/state and other controls. The original equipped operator retains its current data, Journal, native requests and browser lifetime. No new runtime, paid service, private Git publication, Actions run, automatic watcher, relationship send, contract signature or scientific attestation is created by this formatter.

## Format sources

Microsoft's original SpreadsheetML documentation specifies inline strings as explicit text cells: https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.cell . The format's real row/column/cell boundaries are documented in https://support.microsoft.com/en-us/excel/excel-specifications-and-limits . The writer uses literal inline strings and explicit continuation, retaining complete original data rather than relying on spreadsheet type inference.

Relative hyperlink basis: Microsoft’s original PackageRelationship.TargetMode documentation states that an External relative target is resolved against the package location: https://learn.microsoft.com/en-us/dotnet/api/system.io.packaging.packagerelationship.targetmode?view=windowsdesktop-9.0 . Therefore an original tables/file.csv target remains tables/file.csv beside report-tables.xlsx, rather than being rewritten relative to an internal worksheet XML part.

# Workbook measurements

Open a retained workbook or delimited table, review its worksheet and scientific mapping, and save the complete preparation with its original file. The existing Measurements engine remains responsible for chemistry, stations, units, dates, fractions, censoring, scientific preview and import.

## Select the original source

In **Open my data**, retain the original XLSX, XLSM, CSV, TSV or text file. Choose its worksheet, original header row, encoding and formula-reading mode. Review its role as **MEASUREMENTS** and save the scientific source edition. The original binary, worksheet and reading choices remain part of that edition.

Open **Prepare workbook measurements** from the saved source result, or **Workbook measurements** in the workbench. Select that exact source, choose **Chemistry / WQP** or **Monitoring stations**, and enter the preparation name, reviewer and original context. The page displays the actual existing Measurements workspace identity. Review the source column previews and select only columns that are identifiers. For example, a numeric station code stored as `1` with the Excel format `000` is retained as the identifier `001`; a measurement stored as numeric `1` remains numeric. **Save worksheet preparation** submits one retained operation to the workbench's original task queue.

The operation creates a named preparation, without importing observations or running a scientific model. Open **Measurements** and select that saved preparation.

## Review and import

The Measurements preparation displays the original filename, worksheet, source collection and source ID, selected header/encoding/formula mode, and complete row accounting. Sample tables show original worksheet rows or delimited-file line ranges alongside native CSV line numbers.

Map source columns using the existing guided intake controls. Review the original units, fractions, dates, time zones and scientific interpretation. Save the mapping and select **Review mapped measurements**. The original normalizer supplies accepted and rejected counts and scientific values. Confirm that exact saved preview before **Import reviewed source**.

Replaying an already accepted original request recovers its saved preparation or import. It does not apply a current draft to an earlier receipt. Native preparation editions and scientific import identities retain their original semantics.

## Original cells and row references

The bridge uses the same file reader as Open my data. It mechanically creates CSV text for the existing importer; it does not infer missing values, convert units or choose scientific meaning.

Identifier columns are an explicit saved choice. Text and blanks remain unchanged. For selected numeric identifiers, plain Excel zero masks such as `000` preserve leading zeros without rounding. A complex numeric format, date, boolean, error or unevaluated formula in a selected identifier column gives a specific correction message. The lineage retains the original stored value, cell type, number format and rendered identifier alongside the complete original workbook. Unselected columns retain their original values. Earlier preparations with no identifier choice keep their original projection and lineage.

The complete column map preserves each original label and position. Duplicate or empty labels receive unique transport headings so the native CSV parser can address them; the original labels remain alongside those headings. Every original worksheet row or delimited record appears in the row accounting, including preamble, header and empty rows. Quoted multiline CSV fields retain their original physical line ranges.

Formula mode **formulas** preserves formula text as source text. Formula mode **cached** requires an existing cached result for each nonempty formula in the selected data. A missing cache rejects preparation before a native request; a formula row is never silently omitted. Recalculate and save the original with the owner's spreadsheet application, or explicitly select formula-text reading in another source edition.

A native source can be shared by two byte-identical CSV projections. Each original guided receipt retains its own workbook, worksheet, source collection and physical-row mapping. The source-lineage route returns every such bound preparation, without changing the existing scientific import ID.

## Download, reopen and transfer

The preparation's **Download original** returns the exact original binary or delimited file. **Download selected worksheet CSV** returns the mechanical native input. **Download complete original row and column map** returns the full lineage. **Download complete preparation** includes original binaries, projected sources, all saved mapping editions, receipts and retained received history.

**Download unsaved inputs** includes the selected original binary and the complete unfinished mapping. Opening it creates a separate draft and does not replay a previously pending native import. Native saved preparations can be opened as separate copies through the original intake workflow; their complete original history is retained.

The existing Measurements full-workspace export/receive transaction carries the binary table and lineage together with all native records. The scientific Workspace's existing portable archive includes the retained source objects, bridge operation directory and Measurements database. Original operator restore additionally invokes registered semantic verification. The direct model portable restore continues to verify archive members by the maintained inventory; it does not run an additional service merely to verify the bridge.

An interrupted operation retains its original native request before dispatch. Reopening uses the same queued task and native preparation identity. The initial native edition is checked even if another view has since saved later editions. The bridge never overwrites those later editions.

## Reopen a source-only Study for a new preparation

A selected **Scientific Study** can carry a saved MEASUREMENTS source collection
before any Measurements preparation or import exists. In the Study desk select
the source collection and review the selected original dependencies. The archive
retains the complete source edition, original manifest, original file objects and
companions. A current saved source also carries its exact selected native
worksheet inspection and original reading options inside that immutable edition.
An earlier source edition keeps its original inspection record and source files
through the existing typed Study dependency receipt.

After receiving the Study into its independent Workspace, **Workbook
measurements** discovers the saved scientific source collections directly. It
does not require a producer commit task or reinspection. Select the received
source, review its original worksheet/header/formula or text reading choices,
choose Chemistry / WQP or Monitoring stations, and save a named preparation
through the normal queue. The original source collection, source ID, inspection
ID, complete original byte identity and row/column lineage accompany that
preparation. Scientific mapping and import still happen in Measurements.

A transferred preview is evidence of the original reading, not a substitute for
the original file. Preparation verifies the retained source file and its binding
to the selected worksheet. Missing or inconsistent evidence gives a specific
source-selection error; it does not choose another sheet, infer a mapping or
substitute an example. Existing preparations and accepted tasks remain unchanged.
A new preparation belongs to the receiving Measurements workspace and its own
explicit operation; resume an accepted operation using its retained task identity.

For the focused own-file receiving course, use an actual retained MEASUREMENTS
source already present in the selected clean Workspace. Export that source
collection using the existing Study control and open the verified archive in a
separate receiving folder. Confirm the source's complete original bytes/hash and
selected sheet/options match before proceeding. A current embedded-preview source
does not need a `client-source-intake` directory in this source-only archive.
Select it in Workbook measurements and continue the existing
`receiveWorkbookMeasurements` function with the actual receiving workspace,
source IDs and reviewed native mapping. It exercises preparation, mapped preview,
explicit import, complete original/projection/lineage downloads, complete
preparation-copy receiving and reopening. Inspect the actual desktop and narrow
screens and OPEN, LOOK at and USE every returned recipient attachment. Retain
the resulting original task/preparation identities for continuation.

## Installation and capacity

Use the complete maintained scientific installation and its Measurements component. The scientific environment declares openpyxl for XLSX/XLSM reading; the original Measurements engine requires Node 22.16 or newer for its existing SQLite runtime.

The operator action contains only source references and review text. Original binary transfer, lineage and CSV projection use the existing 128 MiB Measurements request route. Base64 and complete history count toward that bound. A preparation that cannot travel completely is rejected before publication; its preceding native history and retained source remain unchanged. No source or history is truncated.

## Existing-host receiving course

The accompanying `source_tools/receive_workbook_measurements.mjs` exports a complete receiving function for the original authenticated workbench/browser owner. It consumes the actual retained workspace, source collection and worksheet IDs, plus the owner's reviewed mapping. It reuses that host's page, authenticated API, view navigation, download and screenshot functions; it creates no second listener or browser.

The course saves and reopens the native preparation, exercises actual mapping/preview/import and exact receipt replay, downloads and verifies the complete original and preparation, opens a separate full-history copy, inspects narrow-layout behavior and captures the actual desktop/phone output. The equipped owner must visually inspect those captures before recording visual acceptance. Local fixtures or source checks are not customer data or a completed native receiving result.

## Source interface

Queued action: `client-measurement.prepare`.

Payload fields: `source_collection_id`, `source_id`, `target_workspace_id`, `kind` (`wqp` or `stations`), `label`, `reviewer`, `note`, `context`; optional `identifier_columns` is a list of original column IDs such as `["c1"]`. Omit the optional field when no identifier formatting was selected, preserving earlier saved requests exactly.

Result: original task identity, native `preparation_id`, target workspace identity, complete source binding, projection/lineage/preparation file identities and original download tickets.

Existing native routes retain their contracts. New read route `GET /intake/source-lineages/:importId` returns source-bound lineages for all original guided receipts of that native import. `GET /intake/:id/original` returns the selected original binary and filename. Native preparation read/export/save receive the complete `originals` collection only when source lineage exists; older plain-text preparations continue to open.

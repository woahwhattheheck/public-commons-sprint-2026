# Guided measurement source preparation

The original Measurements desk now lets an analyst open a complete file, see its actual headers and original rows, map recognised columns, review the existing native interpretation, and import one saved preparation. This is the Measurements part of WO45. Operator-wide upload/source selection stays with CEDAR8047; source-shaped workbook receiving/return stays with675D; readable measurement reports stay with6A62.

## Operate the complete workflow

1. Open **Measured observations → Receive sources → Prepare a measurement file** in the existing operator. Choose the source type and the complete UTF-8 original. The existing public-provider and large-file panels remain available.
2. Inspect the original column names and first twelve source rows. Missing station/date/characteristic mappings do not hide those rows. The complete original stays retained; the preview is not a reduced import file.
3. Select columns in the named mapping controls. An explicit **Not supplied** suppresses a detected alias. No unit, date, geography, fraction, detection condition or reviewer is invented. Preserve source identifiers, leading zeros and the original source text.
4. Name the source, record its mapping reviewer, and retain workbook/sheet/agency/context in the preparation. For chemistry or discharge, choose the existing scientific interpretation edition deliberately. Historic unpinned source interpretations remain available; changing the directive changes the native source identity.
5. **Save preparation** creates an immutable edition in the same Measurements SQLite workspace. Browser recovery retains unfinished controls separately. Saved editions use a preparation-specific compare-and-swap revision, so an unrelated station review cannot replace an intake draft and another tab cannot silently overwrite it.
6. **Review mapped measurements** saves the current preparation and asks the original scientific normaliser for complete counts and representative accepted/rejected rows. Check units, bounds, fractions, temporal precision and flags. It does not approve a station-to-reach assignment or make an observation usable for calibration.
7. Confirm that exact preview and **Import reviewed source**. The existing import still owns source/record identities, full rejected rows and canonical records. Repeating the same request recovers its original import. Changing a source mapping is a new interpretation, not a silent edit to the original.
8. Reopen the preparation from the selector. Download the unchanged original, complete preparation history, or the existing complete Measurements workspace. Receive the complete workspace through the original empty-workspace receiver to restore sources, mapping history, import receipts and native records together.

## Unfinished input and interrupted operations

The local preparation stores the full original and exact pending save/import/copy request before native dispatch. The same request is reconciled after a lost response; it never adopts an unseen later revision as an expected save revision. Browser and native revisions are separate.

Changing view captures the last focused control before the Measurements component is destroyed. Its pending browser write completes before its database closes. A storage conflict keeps a recoverable in-memory working copy for that original workspace; choose it and **Save separate copy**, which does not overwrite the conflicting row. **Download unsaved inputs** is a separate rescue file containing the complete current source and unfinished fields. Keep it before deliberately leaving a storage-failed draft. It is not advertised as a complete native workspace archive.

Opening a complete preparation file creates a distinct native preparation, retaining its full previous edition history and original received project/receipts as ancestry. It does not replay a foreign import. Native import still requires review in this workspace. Source copies retain exact original labels; download filenames use a safe basename.

The original HTTP and Python bridge accept complete JSON requests up to128MiB. JSON escaping and envelope overhead count toward that bound. A file below128MiB may exceed the request limit; its original is retained before inspection and remains downloadable. Use the maintained large-file intake for that source rather than truncate it. CSV syntax/row/cell limits remain the original parser's limits.

## Existing source and integration

The additive `engine/intake.mjs` imports the original `parseCSV`, `fieldReader`, `FIELDS`, `parseSource` and native scientific interpretation constants. It does not provide a second CSV or scientific parser. Sources are retained by exact UTF-8 SHA256; independent preparation editions store source-name/context/mapping/reviewer/note, while received projects retain full ancestry.

The existing `engine/workspace.mjs` initializes four preparation tables plus original-project ancestry in its own database. Its portable document includes an `intake` field. Receiving validates the full source/edition/receipt graph and inserts it within the existing native receive transaction; an older package without that field remains compatible. Receiving into a workspace with saved preparations is rejected, preserving pending work.

The original authenticated RPC mounts `/intake` operations below `/api/measurement-workspace`. The standalone native server and Python bridge serve the same browser module. The installed operator mirror is declared in `operator/extensions/measured-observations.json`; its original view/auth/workspace lifecycle remains authoritative.

To join CEDAR's or675D's original file selection, pass the full native CSV text plus exact filename/context to the same preparation API. Do not replace the original workbook with a CSV as its purported source: the workbook owner retains that original and supplies its derived sheet lineage. No Tim dataset is manufactured by this feature.

## Complete original-source receiving course

`engine/intake-receiving.mjs` uses the existing, unchanged3,640-byte original WQP eight-station CSV already shipped in `source_data/wqp_eight_20261013/wqp_eight_native.csv`, SHA256 `21022c3f3b46fb0bae6e341cde74880ec2e395528592f9168742f53af60b533e`. This is public station-location metadata, not Tim's observations or a new acquisition.

Run from an equipped checkout with Node22.16+ and the already-installed Playwright/Chromium:

```sh
node measurement_workspace/engine/intake-receiving.mjs \
  --output /absolute/owned/guided-intake-receiving \
  --playwright /absolute/installed/playwright/index.mjs \
  --chromium /absolute/installed/chromium
```

The programme operates raw preview with an intentionally unassigned station selector, saved/reloaded mapping, reviewed native import, exact request replay, a conflicting later copy edition, complete project/workspace export, source-byte verification and original empty-workspace receiving. Its browser course opens and uses the real component at1365px and390px, downloads full files, and cold-reopens the retained browser profile. It does not run a scientific model, send a message or alter a shared customer workspace. Source hashes, complete outputs and screenshots are retained in the separately owned output directory.

A source review or syntax parse is not a rendered completion. Inspect the actual desktop,390px and cold-reopen screenshots after a completed run, and record that visual finding with the operation. If the host fails before process creation, report that exact outcome; do not call the UI operated.

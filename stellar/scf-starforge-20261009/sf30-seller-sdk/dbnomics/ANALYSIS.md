# DBnomics economic analysis and editable workbook receiving

The DBnomics workbench prepares a complete, selected economic edition for the
maintained Python Analysis workspace. The original response mapper, SQLite
dataset engine, Reports, Workbooks, DatasetChanges and WorkspaceArchives own
the resulting analysis and receiving operations.

A source selection includes every observation in its capture, the chosen full
saved reports, complete series descriptions and one exact source-notes revision.
The original DBnomics source handover travels with it, including response bytes,
all retained note/report editions, calculation specifications and source terms.
The separate record kinds distinguish source observations, calculated records,
series context and analyst notes.

## Select the original economic edition

Open **Analysis and notes → Python Analysis and editable workbooks** in the
existing DBnomics browser. Choose the capture, complete reports and a saved
notes revision. Prepare the source and download its complete JSON package.
Prepared sources remain available when the original project reopens.

The same original operation is available through the typed client:

~~~js
const prepared = await dbnomics.analysisSource({
  id: 'economic-briefing-source-01',
  selection: {
    captureId: original.captureId,
    captureSha256: original.captureSha256,
    reportIds: selectedSavedReports.map(report => report.id),
    notesRevision: originalNotes.revision,
    title: 'Reviewed economic source and analyst briefing'
  }
});
const completeSourceFile = await dbnomics.analysisSourceFile(prepared.id);
~~~

`id` is the original operation ID. The source freezes its complete handover
before assembly. Repeating that same ID and input reuses its saved result;
later notes or source changes use their own explicit selection.

The CLI input is `{id,selection}` with the same fields:

~~~sh
starforge dbnomics analysis-source \
  --workspace /srv/starforge/projects/economic-source \
  --input /srv/starforge/inputs/analysis-selection.json \
  --out /srv/starforge/handovers/economic-analysis-source

starforge dbnomics analysis-source-export \
  --workspace /srv/starforge/projects/economic-source \
  --id economic-briefing-source-01 \
  --out /srv/starforge/handovers/economic-analysis-source.json
~~~

The first command copies the complete source directory. The second produces a
single complete package of the exact source files. Record that file's SHA256
when transferring it; the Python receiver requires the selected digest.

The direct MCP tools are `dbnomics_analysis_source` and
`dbnomics_analysis_source_file`. They use the same running server and original
operation record. `dbnomics_operation` reconciles a response that was lost
after the source was saved.

## Install and open the original Python application

The selected `dbnomics` product retains the complete original Python package,
Analysis modules and examples. Use Python 3.11 or newer and its declared
`workbooks` extra. The pinned workbook dependency is `openpyxl==3.1.5`.

For a source installation:

~~~sh
python3 -m venv /srv/starforge/python/economic-analysis
/srv/starforge/python/economic-analysis/bin/python -m pip install \
  '/absolute/merchant/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python[workbooks]'
~~~

An existing maintained Python runtime can install the same source and extra
through its original **Python** workspace. The **Applications** catalog then
offers **DBnomics analysis and workbook receiving** for the complete command,
and **Analysis and workbook workspace** for the original interactive UI.

The DBnomics command application accepts the original argument vector beginning
with `--operation` and its private directory. The maintained runtime supplies
the selected source checkout and Node executable. After preparation, open
`OPERATION/analysis` with the existing Analysis application. Its original
listener exposes source review, SQL, reports, workbook sources, comparisons,
exports and editable backups.

Use `stellar-forge-dbnomics-analysis` from the selected Python environment.
Global options precede the operation name:

~~~sh
stellar-forge-dbnomics-analysis \
  --operation /srv/starforge/analysis/economic-briefing \
  --checkout /absolute/merchant/source --node /absolute/node \
  prepare --source /srv/starforge/handovers/economic-analysis-source
~~~

For a received single-file package:

~~~sh
stellar-forge-dbnomics-analysis \
  --operation /srv/starforge/analysis/economic-briefing \
  prepare --bundle /srv/starforge/handovers/economic-analysis-source.json \
  --sha256 EXACT_COMPLETE_PACKAGE_SHA256
~~~

For a source that already resides in a native DBnomics project:

~~~sh
stellar-forge-dbnomics-analysis \
  --operation /srv/starforge/analysis/economic-briefing \
  --checkout /absolute/merchant/source --node /absolute/node \
  prepare --project /srv/starforge/projects/economic-source \
  --selection /srv/starforge/inputs/selection-only.json \
  --source-operation economic-briefing-source-01
~~~

Here `selection-only.json` contains the `selection` object, while the Node
`analysis-source` command accepts its `{id,selection}` wrapper.

Preparation returns the exact native preview ID/hash, full row counts,
column mapping, source terms and selected note/report identities. Review that
actual preview and finish the same operation:

~~~sh
stellar-forge-dbnomics-analysis \
  --operation /srv/starforge/analysis/economic-briefing \
  finish --preview-sha256 EXACT_NATIVE_PREVIEW_SHA256 \
  --review-note 'Reviewed source measure, annual/monthly identities, calculation bases and source reuse references.'
~~~

The `receive` command combines preparation, that explicit review note, complete
outputs and original archive reopening. It accepts the same source options:

~~~sh
stellar-forge-dbnomics-analysis \
  --operation /srv/starforge/analysis/economic-briefing \
  receive --source /srv/starforge/handovers/economic-analysis-source \
  --review-note 'Reviewed the complete selected source and its retained methodology.'
~~~

## Complete analyst outputs

The workflow retains one original Analysis workspace and produces:

| Output | Complete contents |
| --- | --- |
| Original source document | Every selected mapped record plus the complete raw DBnomics source handover and analysis receipt |
| Typed query export | JSONL, CSV, SQLite and the original native manifest |
| Frozen economic briefing | All observation, calculation, series and note sections; full HTML, JSON and CSV ZIP |
| Workbook | Full Records sheet, original Readme/source mapping, native definition and complete workbook handoff |
| Editable Analysis archive | Original database, registered source documents, saved queries, report publication, workbook, job history and exports |
| Reopened source | Exact checked files and original economic source reconstructed from the received archive |

The initial SQL view is `economic_records`. All source-facing values are
declared text: a provider number's original spelling remains in `value_text`,
and the actual base observation's spelling remains in `base_value_text`.
`calculated_value` is the original saved calculation's IEEE-754 result
represented as text. Missing `NA`/null states, unavailable-calendar reasons,
source periods and identities are explicit.

`record_id` is a source-derived identity within `record_kind`. A calculation
also includes its original report ID, so several saved calculations for the
same observation remain separate records. Reports retain their own exact
note revisions. The selected source notes become their own note records.

The workbook includes all mapped columns except the two wide
`dimensions_json` and `attributes_json` fields. Those complete fields remain
in the original table, source document and typed query exports. The workbook
writes source strings literally and provides `review_note` for returned
analyst commentary.

The compact briefing has separate full sections for observations,
calculations, series and notes. Its saved definition, native result hash,
publication identity and complete output hashes remain in
`OPERATION/records/complete.json`.

The included Insee project contains 468 original observations: 36 annual and
432 monthly values. Its four saved reports carry 468 original levels, 432
monthly year-change rows, 36 annual year-change rows and 432 monthly
index-to-selected-base rows. With the initial two notes and two series, the
complete Analysis source has 1,840 records. Counts always come from the actual
selected source receipt.

This source is the index **including imputed rents**, France, all households,
unadjusted, base 2015. Preserve that measure description when using the output.
The original annual and monthly series remain separate populations.
[The source guide](SOURCE.md) retains the complete source references,
attribution and meaning.

## Return a complete workbook for review

Keep the original `Records` worksheet names and named columns, including
`record_id`. Column order may change. Hidden rows are included. Additional
worksheets, formatting, comments and charts remain in the retained original
XLSX; the mapped review compares the selected Records cell values.

The receiver reads both the exact original workbook and returned workbook.
It records blank, string, number, Boolean, date/time, duration, formula and
error cell kinds. Formulas are preserved as formula text and are never
evaluated by this reader. Changing a source string to an Excel number is
visible even if the displayed text is similar.

Record the complete returned file's SHA256 and retain a stable return ID:

~~~sh
stellar-forge-dbnomics-analysis \
  --operation /srv/starforge/analysis/economic-briefing \
  return-workbook --id analyst-return-01 \
  --file /srv/starforge/returns/economic-records.xlsx \
  --sha256 EXACT_RETURNED_WORKBOOK_SHA256

stellar-forge-dbnomics-analysis \
  --operation /srv/starforge/analysis/economic-briefing \
  return-review --id analyst-return-01 --after 0 --limit 100
~~~

Both original and returned XLSX files become checked Analysis source documents.
The native response mapper imports their complete typed projections.
DatasetChanges compares them by `record_id`, retaining added, removed, changed,
moved and unchanged counts, field/type differences and source row locations.
Duplicate or missing identities require correction of the returned source;
the reader does not invent a row key.

`return-review` returns the original native page cursor, while its
`changes_file` contains the complete original comparison. The same comparison
is available through the Analysis browser.

Select the exact result with a substantive review note:

~~~sh
stellar-forge-dbnomics-analysis \
  --operation /srv/starforge/analysis/economic-briefing \
  accept-return --id analyst-return-01 \
  --result-sha256 EXACT_ORIGINAL_COMPARISON_SHA256 \
  --review-note 'Reviewed the returned cell values, identities, types and complete change list.'
~~~

The native selection activates the separate `workbook_...` review view.
The original `economic_records` view continues to bind its selected source
version. Complete reviewed JSON/CSV change exports and an editable workspace
archive are produced after selection.

## Carry analyst notes into the original economic project

An accepted return can add its `review_note` values through the original
DBnomics notes operation. This route requires the other source cells and types
to match their original values; it accepts plain analyst text and exact
original observation IDs. Source changes remain in the reviewed workbook
edition for analysis.

~~~sh
stellar-forge-dbnomics-analysis \
  --operation /srv/starforge/analysis/economic-briefing \
  --checkout /absolute/merchant/source --node /absolute/node \
  adopt-notes --id analyst-return-01 \
  --project /srv/starforge/projects/economic-source \
  --author 'Original economic analyst'
~~~

The operation binds the original project ID, capture file hash, selected notes
revision, returned file, comparison selection and analyst. It preserves the
existing note entries and appends the reviewed notes. The original native
compare-and-swap revision check decides whether the current source notes can
accept that edit.

After the native note save, the workflow prepares and imports the actual new
source-notes edition into a separate Analysis view. The frozen original
briefing/report editions remain available. A new complete original Analysis
archive includes the accepted workbook, new notes source, imports and history.
The save, source preparation and archive keep their original operation IDs
when resumed.

## Reopen the editable delivery

Reopen the initial analyst archive:

~~~sh
stellar-forge-dbnomics-analysis \
  --operation /srv/starforge/analysis/economic-briefing \
  reopen
~~~

Reopen an accepted workbook edition and its adopted notes:

~~~sh
stellar-forge-dbnomics-analysis \
  --operation /srv/starforge/analysis/economic-briefing \
  --checkout /absolute/merchant/source --node /absolute/node \
  reopen --id analyst-return-01 \
  --source-project /srv/starforge/projects/economic-received
~~~

WorkspaceArchives restores the original workspace ID and exact archived
files. The receiver reopens every complete typed-query, briefing and workbook
output, verifies the original economic view and reviewed return, and
reconstructs the full economic handover from its retained source parts.

When notes were adopted, the newer archive and notes source are selected.
Its default destination is `returns/RETURN_ID/received-with-notes`; an earlier
accepted-only receiving keeps its own `received` destination. The original
DBnomics `importSources` receives the whole source history into the intended
new economic project and checks the selected capture and notes revision.

Keep the full workflow directory, its `records` and retained deliveries when
handing the operation to another operator. Its original `operation.json`,
return records, preview/selection hashes and source inputs are the continuation
authority. The standalone workspace ZIP is also editable through the original
Analysis receiver.

## Python API and the complete native example

~~~python
from stellar_forge_buyer import DbnomicsAnalysisSource, DbnomicsEconomicWorkflow

source = DbnomicsAnalysisSource("/private/economic-analysis-source")
work = DbnomicsEconomicWorkflow("/private/economic-analysis")
preview = work.prepare(source)
finished = work.finish(
    preview_sha256=preview["preview_sha256"],
    review_note="Reviewed the full source and calculation selection.",
)
received = work.reopen()
~~~

The additional methods are `return_workbook`, `return_review`, `accept_return`,
`adopt_notes`, `inspect` and `reopen`. Methods retain original native job IDs and
returned file identities, so they can be used from a notebook or another
installed Python application.

The complete source example is
`sf88-operator-buyer-cli/python/examples/dbnomics_economic_workbook.py`.
It opens an already completed original DBnomics receiving project, prepares
all its original reports, builds the full briefing/workbook, exports and
reopens the editable Analysis workspace, and receives the economic source.
An explicitly supplied real analyst comment can be written to the exact chosen
observation, returned, compared, reviewed and adopted.

~~~sh
python /absolute/merchant/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/examples/dbnomics_economic_workbook.py \
  --checkout /absolute/merchant/source --node /absolute/node \
  --project /private/completed-dbnomics-project \
  --operation /private/economic-workbook-receiving \
  --review-note 'Reviewed the original Insee measure, exact calendar calculations, saved notes and source terms.' \
  --observation-id EXACT_ORIGINAL_OBSERVATION_ID \
  --annotation 'The calculation uses the exact source calendar lag and retains unavailable initial periods.' \
  --author 'Original economic analyst'
~~~

The example keeps the existing native receiving ID
`dbnomics-insee-ipc-20261012` unless another completed original receiving ID is
explicitly supplied. Source capture, merchant, payment and publication
operations continue at their original project paths.

## Recovery, limits and retained source

Every native request is written before dispatch. Completed native results are
reused, and file bytes are checked on reopening. Native interrupted local
query/report/workbook jobs retain their original record plus one saved
successor request; original response-import and archive recovery use the
engine's own same-ID continuation. A changed source, preview, selection or
native input produces an explicit conflict.

Use private operation directories and regular input files. The original source
reader requires file permissions `0600` and directory permissions `0700`.
Copy approved input files into that original private operation before running
the receiver.

The source adapter accepts at most 32 selected complete reports, 128 MiB for
its full source handover and 256 MiB for the Analysis document and originals.
The Python briefing/workbook flow supports 100,000 complete mapped records.
Returned XLSX input is at most 128 MiB, with at most 256 MiB of expanded members;
its complete typed JSON projection must fit the original 32 MiB JSON source
reader. Native report sections retain their own complete-output limits.
Oversized selections are reported before a sampled result could be mistaken
for a complete delivery.

DBnomics' aggregate database terms and underlying provider terms remain
attached to every source edition. The software uses the repository's MIT
license. The [DBnomics source guide](SOURCE.md),
[original analyst workbench](README.md) and
[native merchant/customer receiving guide](RECEIVING.md) retain the related
source, publication and operating contracts.

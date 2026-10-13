# Open the complete questionnaire project

If the downloaded ZIP opens to `TRANSPORT_MANIFEST.json`, `complete-customer.zip.xz`
and `reassemble_customer_project.py`, follow its `START_HERE.md` first. That
single delivery recreates the complete project ZIP and its checksum sidecar,
verifies every project member, and supplies the original extracted layout used
below. The transport index records both the native export and the complete
member-preserving ZIP reencoding.

Extract the complete project ZIP into a private directory. Keep `application/`,
`workspace/`, `document-runtime/`, `calculation-runtime/` and `MANIFEST.json`
together. `HANDOVER.json` indexes the actual packaged questionnaires,
publications, respondents, reports, calculation jobs and operating register.
Their identifiers and versions remain the authority when the project is edited
and exported again.

For the saved reporting example, open **Reports** for the original-source trade
reporting questionnaire and choose **Trade questionnaire response report**,
report `2eaf4700-3f14-4ff0-8e09-5e5b787c9cf1`. Its six accepted source-bound
responses use the final saved template version 5. The six current original
family report examples and their complete paired downloads are indexed at
`workspace/source-evidence/whole-family-programme/delivered-report-index.json`.
That index distinguishes the current customer examples from retained earlier
report editions.

## First opening

The delivered offline document wheels support Linux x86_64, Python 3.12 and
glibc 2.28 or newer. From the extracted project directory, create its local
runtime and open the application:

```sh
python3 application/install_document_runtime.py \
  --wheelhouse document-runtime/wheelhouse \
  --manifest document-runtime/manifest.json \
  --destination .document-runtime
.document-runtime/bin/python application/server.py \
  --workspace workspace --port 0
```

Open the local URL printed by the server. Read `workspace/operator-key.txt`
locally and enter that code into the operator login. Stop the server with
Ctrl-C. Start it with the same command to reopen the same project. Each opening
prints its current local address. The server retains the existing access code.

Use the **Language / Langue** selector to switch English or French at any time.
The application retains the authenticated user's preference. Display wording
and translated choice labels remain separate from the original workbook
strings and saved answer values. Operators can edit and save a successor
French wording edition for the selected saved definition.

The installer verifies every delivered wheel before installing without a
network request. For another supported Python version or platform, install
`application/requirements-documents.txt` into that platform's Python environment
and use its Python executable to start the server.

Native workbook calculation also needs installed LibreOffice and Java 17 or
newer. The complete official UNO client, original POM, license and inventory
are delivered under `calculation-runtime/`. Set `ATSSC_SOFFICE` or `ATSSC_JAVA`
when the installed executable has a different name or location. The retained
originals, calculated workbooks, answers and reports open immediately; new
native calculation uses the installed office engine. See
`application/NATIVE_CALCULATION.md` for its exact commands and replay behavior.

## Workbooks and original definitions

The project retains all five original Annex C workbooks as exact BLOBs with
their original SHA256 identifiers. Their complete 79 worksheets, hidden
worksheets, formulas, styles, validation, merged cells and source context are
preserved. The original Annex package is also retained under
`workspace/source-evidence/`.

Open **Workbooks**, choose an original edition and press **Inspect**. Select
the actual worksheet and cell range. **Download complete workbook** returns
that retained edition. **Calculate native workbook** creates a retained native
calculation with its original input identity, complete output files and formula
token dependencies. The full native export and the original-format cache
edition are both retained.

**Create full original questionnaire** prepares the original visible answer
cells and native calculated metrics from an already calculated original
workbook. The complete cell catalogue and hidden source origins remain beside
that definition. Open **Definitions** to review its editable JSON, source
coordinates, types, choices, units, field disclosure and native dependencies.
Save a successor definition and publish its saved edition. Existing invitations
and responses remain bound to their earlier immutable publication.

The source catalogue records the original classification markers and any
operator classification. Original variables, template years, fiscal-year
columns and internal sheets remain source context. Read-only native metrics
come from the original calculation engine. The source's formula errors remain
typed in their original/native cache inventory; they appear as unavailable
values wherever they affect an answer. Numeric zero remains numeric zero.

The compatible financial-workbook definition treats the original unlocked
material-name cells **Fin!B42/J42/B43/J43/B44/J44** as their actual source text.
The earlier published definition stays in history. Choose the current saved
definition when exchanging that complete original workbook; earlier
invitations continue to use their own publication.

The retained reporting commissioning programme also has a corrected source
publication. Its percentage input uses **Pub - Questions!E97**. Delivery rows
use **Pub - Purch!40,44,48**, with the original fixed labels in column B and
entered values in columns C/G. The earlier source publication and frozen
reports remain in history. `HANDOVER.json` lists the actual editions.

## Workbook Exchange

From **Workbooks**, open **Workbook Exchange** in the same operator session.
Choose an original workbook and inspect its worksheet and source cells,
including the hidden sheets and original formula caches. Download the unchanged
workbook or select original answer cells for a reviewed Excel successor. Select
the explicit text, exact decimal, Boolean, date, blank or absent state before
retaining the edition. Formula cells remain in the native calculation workflow.

Choose a saved questionnaire definition or publication to read its complete
source mapping. Extract a selected original or calculated edition, then
download its four-sheet Excel register and complete JSON source records. The
register preserves the question mapping, typed source cells, validation and
original source identities. Original formula issues remain separate from
answer validation. An unavailable native value keeps its source issue and
numeric zero remains zero.

Reimport a complete edited original-layout XLSX in **Workbooks**, calculate its
native edition, and use its source-bound questionnaire invitation to receive
and review the answers. The full operated five-family examples and their
original/successor workbooks, extraction registers and native operating history
are retained in this customer workspace. See `application/WORKBOOK_EXCHANGE.md`
for the original-cell editing, source-row selections and complete exchange APIs.

## Original formula library

The **Workbooks** page also opens the complete **Original formula library**.
Filter its original workbook, worksheet, source cell, function or question ID.
Open a group, inspect a physical source cell, and choose a retained native
calculation edition. The original formula, shared expression, source cache and
actual native outcome remain separate. Language changes retain the selected
filters and calculation edition. The complete five-workbook collection and all
7,661 original/native formula joins reopen from this workspace. See
`application/SOURCE_FORMULAS.md` for the whole source programme and shipped
offline reader runtime.

The original author's complete dependency inventory and source manifest are
retained under `workspace/source-evidence/original-author-formula/`. Their
`SOURCE_RECEIVING.json` pins the original source revision and exact Annex
archive alongside the retained native collection.

## Respondent progress, corrections and downloads

Open **Respondents**, select the intended publication and create an invitation.
The download contains that respondent's entry path and private access code.
Give the invitation to its intended respondent. The native workspace retains
the original invitation for subsequent reopening.

Respondents enter answers and choose disclosure separately for each public
question or table cell. A protected answer can have a separate public text
alternative. Native and authored calculated answers remain read-only, and
protected input dependencies keep their derived results protected.

Use **Save progress** to retain a partial response. Close the session, reopen
the same invitation and continue that saved draft. Confirm the public answers
and alternatives, then **Submit answer revision**. The analyst opens the latest
revision, reviews its validation and complete comparison, and either accepts
it or requests a correction. An accepted response reopens for respondent
editing when the analyst requests a correction.

The respondent view and its public/protected **PDF** and **Word** downloads use
the current saved draft or latest submitted revision. Analysts keep the full
revision history. Public alternatives remain explanatory text; statistical
calculations use the visible original values. Downloaded Word headings, tables
and charts remain editable. To change retained questionnaire data, save the
change in the application and produce its new document edition.

The **Language / Langue** preference selects the PDF/Word reader labels for
that authenticated user. Linked contents, Word headings and PDF outlines open
the selected sections. Protected documents retain the selected response and
permitted worksheet references; public documents use their own disclosure
projection. See `application/DOCUMENT_READING.md` for English/French copies,
current draft versus submitted state, and source references.

For a revised XLSX, choose its original template and upload the complete file
in that original layout. Only that template's declared answer bindings join
the current response; retained answers from other source templates remain.
Dates, percentages, exact physical rows and fixed original labels follow the
published source binding. The exact uploaded workbook and its native successor
remain available with the respondent's revision.

## Saved reporting workbench

Open **Reports** for the selected questionnaire. Create or reopen a saved
template and view. Choose respondents, questions, filters, section order,
titles, notes, groups, year comparisons, statistics and charts. Drag a section
or use the keyboard ordering controls, then save its successor version.

Preview the **public** and **protected** editions independently. The public
cohort, filters, totals, ratios and charts use visible public values. Select
**Freeze report** to retain the selected accepted revisions and full layout.
Subsequent respondent edits or template changes produce a new report edition.

Download both frozen editions as **HTML, CSV, JSON, PDF, Word, Excel or
PowerPoint**. Word and PowerPoint charts include editable embedded workbook
data. Excel keeps the full report tables, a sortable response-value sheet and
the source data for its native charts. Charts retain gaps for unavailable
values. A report section with no visible numerical answers retains its complete
statistics and table. Record the public disclosure review and release the
public edition to create its public download route.

Excel and PowerPoint retain the selected frozen report's values, source
question context and disclosure edition. Edit their native cells, tables,
text or charts in the office application. To update the retained questionnaire
or statistical report, save the corresponding change here and freeze a new
report. See `application/OFFICE_REPORTS.md` for the editable file structure.

## Companies and communications

Open **Companies and communications** from the operator navigation. Its case,
sources, company coverage, contacts, assignments, templates, messages, delivery
returns, follow-ups and operating history use this same SQLite workspace.

After opening on another host or local port, review **Case and delivery
settings** and save the current application origin before preparing new
invitations. Historical message editions retain their original rendered links.
The packaged company operating commissioning uses named local examples and a
local mail receiver; its bilingual messages, source files and delivery returns
are retained in the operating register.

Review source mappings before receiving trade or contact data. Source
interpretation successors keep the original file bytes and earlier mapping.
Review coverage, exclusions, extra companies and contact choices before
assigning the original questionnaire publication. The desk retains the original
invitation, contact changes, message MIME, transport result and final delivery
return. A received response suppresses its queued reminder.

Configure the intended SMTP transport on the operating host using the complete
`application/RESPONDENT_OPERATIONS.md` instructions. Prepare and review a
message before dispatching it. The delivered desk preserves its existing
source and message history when a new host configuration is applied.

The **Exports** section downloads the editable seven-sheet operating workbook,
complete operating CSV/JSON, original source files and full operating ZIP. Its
complete project ZIP carries the same application, database, private
invitations, source evidence and calculation/document dependencies.

## Complete backup, restore and another editable handover

The original archive stays available while another copy is received. From its
extracted project directory:

```sh
python3 application/cli.py receive ../ATSSC_Questionnaire_Complete_Customer_Project.zip \
  --destination ../reopened-customer-project \
  --expected-sha256-file ../ATSSC_Questionnaire_Complete_Customer_Project.zip.sha256
```

Keep the delivered ZIP and its SHA256 sidecar one directory above the extracted
project for these commands, or change those two input paths to their actual
location. Choose a new destination;
receiving checks the complete member inventory and hashes, SQLite integrity,
workbook BLOBs, workspace identity and preserved access roles. It installs the
whole project in that new directory. Follow **First opening** there. Retained
records keep their existing identifiers and versions.

From an opened project, produce a separate database backup or the next full
editable project archive with the original CLI:

```sh
.document-runtime/bin/python application/cli.py --workspace workspace invoke backup \
  --json '{"path":"../next-questionnaires.sqlite3"}'
.document-runtime/bin/python application/cli.py --workspace workspace invoke export_project \
  --json '{"path":"../next-complete-project.zip"}'
```

Choose new output files outside the native workspace directory. Export retains
the whole current database, original workbook BLOBs, private access files,
definitions, publications, drafts, answer/review history, frozen reports,
source catalogues, calculation jobs, operating register and both runtimes.
Its `MANIFEST.json` covers every retained file. The current `HANDOVER.json`
indexes that edition for subsequent opening and review.

# Reading and delivering retained questionnaire documents

The existing Word and PDF downloads now carry linked contents, native document
navigation, clear edition state and the references needed to use the document
outside the application. Reports keep the original report, saved template and
view versions. Protected documents additionally retain their selected accepted
response identities and original worksheet locations, including summary-only
reports. Protected respondent downloads identify their own published definition
and current submitted revision; a saved draft keeps its own draft version.
Each public document
uses only its own saved disclosure projection.

## Read a complete edition

Open **Reports**, reopen the retained report, and choose its public or protected
Word/PDF download. The opening identifies the selected disclosure edition and
whether the content is a saved report, current preview, saved draft, submitted
response or unanswered published questionnaire. The contents links open each
saved report view, response record and closing reference section.

In Word, use the contents links or the navigation pane. Headings, original
paragraphs, native tables and embedded charts remain editable. In a PDF reader,
use the contents links or document outline; every displayed question also has
its own destination. The application's original question order, response order,
complete chart values, grouped tables and year gaps are retained.

Question references identify the original stable question ID. In a protected
edition, a bound question also carries its original worksheet location. A table
with explicit physical rows preserves its gaps: rows 40, 44 and 48 remain those
three rows. Original column labels and source-column letters remain paired.
The closing section identifies the retained source workbook SHA-256 values
once per workbook.

A saved reporting template keeps its complete introduction and selected layout.
For a two-column PDF, the full-width introduction and linked contents can span
as many pages as needed; the two-column report body starts on the next page.
Long descriptions and contents are not shortened to fit a cover.

## Follow the same original document workflow

The existing methods and endpoints stay authoritative:

- Workspace.report_bytes(report_id, edition, format_name) reads the saved
  report; export_report produces the existing complete report directory.
- Workspace.response_bytes(respondent_id, edition, format_name) reads the
  current saved draft or latest submitted response.
- release_report records the existing disclosure review. The normal public
  report route requires that release; a protected operator preview does not
  acquire a release merely by being printed.
- The normal whole-project export and independent receive include all three
  renderer modules and this guide through their original source collection.

The renderer does not open another workspace or retrieve older response
records. Its complete reference context comes from the single supplied
edition. Public documents keep the existing anonymous response numbering and
public question projection; private respondent IDs, original workbook bindings
and protected definition data are not recovered for their navigation.

Public alternatives remain explanatory text beside a withheld answer or cell.
They do not become numeric observations. Missing answers, original numerical
zero and actual Boolean values retain their original distinctions.

## English and French reader labels

The application's current **Language / Langue** preference selects the reader
labels for its authenticated Word and PDF downloads. Each respondent keeps its
own existing preference; operator downloads use the operator preference. An
explicit `?language=en` or `?language=fr` selects a copy on an existing document
route, including a released public report. It does not change the saved report,
release decision or language preference. Anonymous public downloads default to
the retained edition's declared language, then English.

The normal document call accepts an optional language without changing its
original two positional arguments:

~~~python
from document_exports import render_document

pdf_bytes = render_document(retained_public_edition, "pdf")
word_bytes = render_document(retained_protected_edition, "docx", language="fr")
~~~

Use en or fr; a declared edition/definition language is used when no explicit
language is supplied, and English remains the default. The existing command
supports the same selection:

~~~sh
python3 application/document_exports.py public.json public.pdf
python3 application/document_exports.py protected.json protected-fr.docx --language fr
~~~

This selection uses original French question labels and source context where
they are retained in the selected edition. It also translates reader controls,
generated missing/withheld markers, document state, statistics labels and
reference headings. Answers, notes, grouping labels and numerical values retain
their saved values.
Complete original stems and their French wording already supplied in the
selected edition are retained with their source context. An answer whose literal text happens to be
“Not answered” remains that exact answer; generated markers have a separate
rendering state.

Word includes the corresponding en-CA or fr-CA proofing language, and the PDF
carries the corresponding language metadata. UTC timestamps keep their actual
instant; a source timestamp with no offset is displayed without inventing one.

## Source integration and receiving

The document_reading.py module creates reading context from the exact selected
payload. The document_navigation.py module adds native bookmarks, internal
contents links and PDF outline destinations. The document_exports.py module
remains the original Word/PDF renderer. Its field/cell projection, numerical
values, original editable chart module and download routes remain the same
application contract.

A complete document receiving pass uses the original saved public/protected
report JSON or existing customer package. It compares all original rendered
answers, disclosure alternatives and statistics before/after the join; checks
the complete PDF outlines and internal links; opens the Word package and its
bookmarks, links, charts and original source text; and reads the resulting pages.
The original report IDs, saved versions and customer database stay unchanged.
Both editable and fixed-page outputs return to the existing report/workshare
delivery together with the full selected source.

Runtime installation remains in **DOCUMENT_DOWNLOADS.md**. Preserve its pinned
document requirements, licensed fonts and complete runtime inventory when
moving the original customer project.

## Receive the complete pages from an existing customer project

`DOCUMENT_RECEIVING.py` is the document phase of the original customer operation.
It opens `questionnaires.sqlite3` with SQLite `mode=ro` and `query_only`,
selects only the requested frozen reports, and writes into a new directory
outside the retained workspace. Each selected public/protected payload is saved
with its original report, publication, release and exact retained-JSON identity.

For this optional developer page-review command, use a Python environment
with PyMuPDF installed. The application downloads use the six delivered offline
wheels and their original python-docx and ReportLab dependencies. For Word page receiving, supply the original installed
LibreOffice executable explicitly:

```sh
python3 application/DOCUMENT_RECEIVING.py \
  --workspace /absolute/customer-project/workspace \
  --expected-workspace-id ORIGINAL_WORKSPACE_ID \
  --report-id ORIGINAL_SAVED_REPORT_ID \
  --output /absolute/new-document-receiving \
  --render-pages \
  --office /absolute/installed/soffice
```

Repeat `--report-id` to include another original family report. Both English
and French reader labels are rendered by default; `--language en` or
`--language fr` selects one. This changes the document's reader labels while
preserving the saved source wording, answers, tables, report selection and
calculations.

The output contains all paired DOCX/PDF files, their actual page PNGs, the
original selected report JSON, a linked `DOCUMENT_PAGES.html` gallery,
`DOCUMENT_RECEIVING.json`, and the full `DOCUMENT_FILES.json` byte inventory.
Word navigation is checked against its actual internal bookmark destinations;
PDF navigation is checked against its actual outline and page destinations.
Protected selected-response references remain visible for summary reports.
The optional LibreOffice step renders each original Word file to a separate
PDF and complete page set using a private temporary profile.

If a native rendering step is interrupted, its already produced files and the
exact error remain in that output directory. Use those concrete outputs to
repair the original source, then choose a new receiving directory for the same
selected report IDs. The saved workspace, frozen editions and earlier document
files remain available. Review the actual page images before publishing the
documents; successful structural checks alone do not finish the page review.

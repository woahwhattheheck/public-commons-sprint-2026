# Questionnaire document downloads

Respondents can save the current partially completed questionnaire or latest
submitted response as an editable Word document or a PDF. Saved draft progress
appears in the document. Each download uses the current response visible in the
application. Analysts retain the earlier revisions in the workspace history.

Operators can download the public and protected editions of a saved report in
both formats. The report retains its selected respondents, selected questions,
question order and accepted revisions. To incorporate later answers, create a
new report in the application.

Public documents display public answers and public alternatives alongside a
withheld protected answer. This applies separately to each table cell. A public
alternative is explanatory text; numeric statistics use the visible numeric
answers. Protected documents contain the complete selected response values.

Word documents preserve editable headings, paragraphs and native tables. To
revise the stored response data, save the answers in the application and export
again. Text edits made in Word stay in that downloaded file. PDF documents use
embedded licensed fonts for English and French text and retain selectable text.

Saved report charts remain editable native Word charts with embedded Excel
data. The PDF edition contains the same selected chart values as vector
graphics. Unavailable periods remain gaps, and the complete tables retain the
selected groups, original units and disclosure-specific statistics.

## Read and navigate a document

The current **Language / Langue** preference selects the reader labels for
operator and respondent Word/PDF downloads. Original question wording, answers
and numerical values retain their exact language and values. Linked contents,
Word navigation headings and PDF outlines open each selected section. The
closing references preserve the selected edition and its permitted source
identities, including protected summary reports.

See [Reading retained documents](DOCUMENT_READING.md) for source references,
current draft versus submitted response behavior, English/French selection,
and the complete retained-document workflow.

## Install the delivered offline document runtime

The complete customer package includes six pinned wheels for Linux x86_64 with
Python 3.12 and glibc 2.28 or newer. Run these commands from the received project
directory:

```sh
python3 application/install_document_runtime.py \
  --wheelhouse document-runtime/wheelhouse \
  --manifest document-runtime/manifest.json \
  --destination .document-runtime
.document-runtime/bin/python application/server.py \
  --workspace workspace --port 0
```

The installer checks all six original wheel lengths and SHA256 digests before
creating the new runtime, then installs with hash verification and network
access disabled. Open the local URL printed by the server and use the native
workspace access code to open the same customer project.

For another supported operating system or Python version, install the portable
requirements in that platform's Python environment:

```sh
python3 -m pip install -r application/requirements-documents.txt
python3 application/server.py --workspace workspace --port 0
```

## Native renderer

`document_exports.render_document(payload, format_name)` returns complete PDF
or DOCX bytes. The supplied payload is one retained public or protected edition
from the workspace. The renderer reads only that payload and the embedded font
files. Both outputs use the same ordered, field-level projection.

The standalone command renders a previously saved edition into a new file:

```sh
python3 application/document_exports.py public.json public.pdf
python3 application/document_exports.py protected.json protected.docx
```

The native source includes both licensed font files under
`application/export-assets/fonts`. Preserve that directory, the pinned
requirements and the full runtime inventory when moving the complete project.

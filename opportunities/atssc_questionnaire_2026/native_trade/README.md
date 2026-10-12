# Questionnaire Operations

The native application retains whole original Excel workbooks, binds an editable
questionnaire definition to their worksheets and cells, publishes immutable
questionnaire editions, and tracks complete respondent revisions. Analysts can
compare revised workbook cells and structure, request corrections, accept an
edition, consolidate the accepted answers, and release its reviewed public
report alongside the protected report.

## Open the application

Requirements: Python 3.10 or newer and a browser. The core application uses the
Python standard library and serves on the local loopback interface.
PDF and Word downloads use the pinned document runtime described in
`DOCUMENT_DOWNLOADS.md`. Start the server with that runtime's Python after
installing its dependencies. Native workbook recalculation uses an installed
LibreOffice executable; its original and calculated workbook editions remain
separate.

```sh
python3 server.py --workspace ./customer-workspace --port 0
```

Open the local URL printed by the server. Enter the access code from
`customer-workspace/operator-key.txt`. The browser keeps a scoped session in an
HttpOnly cookie. Close the server with Ctrl+C and run the same command to reopen
the retained workspace.

1. Import each original XLSX workbook in **Workbooks**. The original bytes, every
   worksheet, cells, formulas, hidden-sheet state, merged ranges, validations
   and sheet protection remain available. The inspector displays an explicit
   cell range; its paging changes the view of the retained workbook.
2. Create and save a definition in **Definitions**. Stable question identifiers
   bind answers to the original workbook cells. Table questions bind their row
   window and each original column. The full definition is editable JSON.
3. Publish the saved definition and create respondent invitations in
   **Respondents**. An invitation retains its access code in a private native
   file. Each respondent entry opens only that respondent's published edition,
   current answers and review notes. The operator retains the complete history;
   a respondent receives only the current saved draft and latest submitted
   revision.
4. Submit native answers or the complete original/revised workbook. The native
   record retains each revision and validation outcome. The analyst sees all
   changed answers and the complete changed workbook cell/structure catalogue.
   Use **Save progress** to retain an incomplete response, close the session,
   and resume from the same entry. Submission seals a numbered immutable
   edition. Accept a valid latest revision or return it for correction. An
   accepted response is closed to respondent changes until the operator
   requests a correction. Respondent downloads contain the current retained
   draft or latest submitted edition as Word and PDF.
5. Create a frozen report in **Reports**. The protected edition includes the
   complete accepted values, respondent identities and accepted revision
   references. The public edition withholds protected answers and table cells,
   with separately supplied public alternative text. Respondents may mark an
   answer to a public question as protected. A protected definition stays
   protected. Public calculations derived from protected inputs also stay
   protected. Submission records the respondent's confirmation of the public
   portion. A recorded public disclosure review releases that exact public
   report. Both editions download as JSON, CSV, HTML, PDF and editable Word.
   A new report includes only the latest currently accepted revisions. Saved
   reports retain their original accepted references when later responses
   change.

Questionnaire calculations and cross-answer validation rules use a declarative
expression tree in the editable definition. Numeric operations use Decimal.
The original workbook formulas and cached cell values are retained separately;
the definition records the calculation used by the web questionnaire.

## Native commands

```sh
python3 cli.py --workspace ./customer-workspace invoke status
python3 cli.py --workspace ./customer-workspace rpc
```

The retained process accepts one JSON object per line:

```json
{"id":"read-1","method":"status","params":{}}
```

Responses are `{id,result}` or `{id,error:{code,message,detail}}`. Native operation
names are `status`, `import_workbook`, `inspect_workbook`, `compare_workbooks`,
`create_questionnaire`, `save_definition`, `get_definition`, `publish`, `invite`,
`get_respondent`, `save_progress`, `workbook_answers`, `submit_revision`, `review_revision`,
`create_report`, `get_report`, `release_report`, `export_report`, `export_response`, `backup` and
`export_project`. Definitions and respondent writes require their current
`expected_version`; conflicting writes preserve the current edition.

`import_workbook` receives `name`, `data_base64`, optional `source_url` and an
optional `expected_sha256`. The returned SHA256 identifies the whole retained
workbook. `inspect_workbook` receives that `sha256`, optionally `sheet` and a
list of original `cells`. `compare_workbooks` receives `before_sha256` and
`after_sha256` and returns every changed cell and changed sheet definition.

Every mutating operation accepts an optional stable `request_id`. Replaying
the same identifier and complete inputs returns the retained result; using
it for different inputs fails without changing the workspace. An exact saved
request remains replayable after its original expected version advances.
The journal records the native operation, actor, timestamp and saved outcome.

`save_progress` receives `respondent_id`, `expected_version`,
`expected_draft_version` (zero before the first draft), `answers`, optional
`disclosures` and `public_confirmed`. It preserves incomplete answers and
validation messages without sealing a response. `submit_revision` receives
the current sealed `expected_version` and either `answers` or
`workbook_sha256`. It also receives the current disclosure choices and the
public confirmation. A sealed revision clears the saved draft.

Disclosure choices use the published stable question identifiers:

```json
{"public_question":{"classification":"protected","public_alternative":"Public description supplied by the respondent"}}
```

For a table, `cells` is a list following its answer rows. Each row maps the
stable column identifier to the same classification/alternative shape.
Public alternatives are text and remain separate from numerical values and
statistics. Protected fields cannot be promoted to public. The respondent
confirms the actual public answers and alternatives with
`public_confirmed:true`; missing confirmation remains a validation issue.

`create_report` receives `publication_id`, optional ordered `question_ids`,
and optional `respondent_ids` selecting accepted respondents in that edition.
The report freezes those references. `export_report` receives `report_id` and
a new `directory`; it exports both disclosure editions in all five formats
with member hashes. `export_response` receives `respondent_id` and a new
`directory`; it exports the current retained response in both PDF and Word
disclosure editions.

## Preserve and receive the whole project

Export to a new path:

```sh
python3 cli.py --workspace ./customer-workspace invoke export_project \
  --json '{"path":"./Questionnaire_Customer_Project.zip"}'
```

The archive contains the original source application, complete SQLite backup,
original workbook bytes inside the database, all definitions/publications,
respondent drafts/revisions/reviews, report editions, the journal, retained
request results, document export code/fonts and the native access-code files.
Keep this whole customer archive private.

Receive it into a new destination, preserving all original identifiers:

```sh
python3 cli.py receive Questionnaire_Customer_Project.zip \
  --destination independently-received-project
python3 independently-received-project/application/server.py \
  --workspace independently-received-project/workspace --port 0
```

The receiving command verifies the archive inventory, every member's length and
SHA256, SQLite integrity/relationships, the original workspace identity,
operator access-code consistency and every original workbook BLOB. An existing
destination is preserved. Use `--expected-sha256` to pin the whole archive.
The operator access code is in the received native workspace. The same project
can be reopened, edited, reviewed and exported again.

For a database-only backup, invoke `backup` with a new `path`. Preserve the
native operator and respondent access-code files alongside that database.

## Definition shape

Each definition has `title`, `source_workbooks`, `questions` and `rules`.
Questions have a stable `id`, `label`, `kind`, explicit `disclosure`, optional
`required`, `unit`, numeric `minimum`/`maximum`, and original `source` binding.
Kinds are text, number, integer, date, boolean, choice and table. Choice fields
have `choices`; table fields have scalar `columns` and an optional `max_rows`.
Column disclosure follows its table unless explicitly specified.

Scalar binding: `source.workbook_sha256`, `source.sheet`, `source.cell`.
Table binding: `source.workbook_sha256`, `source.sheet`, `source.start_row`,
`source.end_row`; each table column has `source_column`.

Calculations use `{field:questionId}`, `{constant:value}`, or `{op,args}`.
Available operations are add, subtract, multiply, divide, equal, not_equal,
less, greater, less_equal, greater_equal, and, or and not. `table_sum` uses
`table` and `column`. A calculated question has `calculation` and is read-only
to respondents. A validation rule has `id`, `message` and a Boolean `when`
expression. Calculations cannot contain cyclic question dependencies.

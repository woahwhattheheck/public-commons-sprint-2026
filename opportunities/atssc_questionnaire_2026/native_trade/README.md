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
   answers, revisions and review notes.
4. Submit native answers or the complete original/revised workbook. The native
   record retains each revision and validation outcome. The analyst sees all
   changed answers and the complete changed workbook cell/structure catalogue.
   Accept a valid latest revision or return it for correction.
5. Create a frozen report in **Reports**. The protected edition includes the
   complete accepted values, respondent identities and accepted revision
   references. The public edition projects only explicitly public questions
   and table columns. A recorded public disclosure review releases that exact
   public report. Both editions download as JSON, CSV and HTML.

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
`get_respondent`, `workbook_answers`, `submit_revision`, `review_revision`,
`create_report`, `get_report`, `release_report`, `export_report`, `backup` and
`export_project`. Definitions and respondent writes require their current
`expected_version`; conflicting writes preserve the current edition.

`import_workbook` receives `name`, `data_base64`, optional `source_url` and an
optional `expected_sha256`. The returned SHA256 identifies the whole retained
workbook. `inspect_workbook` receives that `sha256`, optionally `sheet` and a
list of original `cells`. `compare_workbooks` receives `before_sha256` and
`after_sha256` and returns every changed cell and changed sheet definition.

## Preserve and receive the whole project

Export to a new path:

```sh
python3 cli.py --workspace ./customer-workspace invoke export_project \
  --json '{"path":"./Questionnaire_Customer_Project.zip"}'
```

The archive contains the original source application, complete SQLite backup,
original workbook bytes inside the database, all definitions/publications,
respondent revisions/reviews, report editions and the native access-code files.
Keep this whole customer archive private.

Receive it into a new destination, preserving all original identifiers:

```sh
python3 cli.py receive Questionnaire_Customer_Project.zip \
  --destination independently-received-project
python3 independently-received-project/application/server.py \
  --workspace independently-received-project/workspace --port 0
```

The receiving command verifies the archive inventory, every member's length and
SHA256, SQLite integrity and every original workbook BLOB. An existing
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

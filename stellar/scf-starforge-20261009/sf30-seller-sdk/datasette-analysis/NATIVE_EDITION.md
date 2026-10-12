# Native Datasette edition → customer Analysis

This component opens the publisher's original reviewed edition and prepares the
same customer Analysis data used by the industrial operator and native receiver.

## Native input

The existing handover schema gains one delivery kind:

    {
      "schema": "stellar-forge.datasette-analysis-handover.v1",
      "delivery": {
        "kind": "native-edition",
        "edition": "/absolute/private/edition/edition.json",
        "sha256": "the full SHA256 returned by the original edition operation"
      }
    }

Use the actual edition path and SHA from createDatasetteEdition or
readDatasetteEdition. Relative paths in a retained handover file are resolved by
the existing handover helper; the Node bridge receives a canonical absolute path.
The inline handover requires an absolute edition path.

The existing AnalysisWorkspace supplies its selected Node executable through
analysis.node. Python invokes edition_bridge.mjs with shell=False and one JSON
input on stdin. The public JS export is readNativeDatasetteEdition({edition,sha256}).
The direct CLI accepts that same two-field object on stdin.

## Original source contract

The JS module imports the sibling datasette/editions.mjs reader and
projectDatasetteRow. It also uses the sibling exact JSON kinds, native member-path
validation, and original publisher file reader. The selected source implementation
is public commit5836015e28121914eba8fc029f036107c63af97a:
- editions.mjs:4396752281f04cef17e81459e94cb1232a019d7f
- capture.mjs:63221ad8c4f2155d76720ebca182d19caf0ab948
- json.mjs:91d8d57a78e564aa5c62145798870f1423af12ef

The reviewed projection controls every returned column and row. Numeric cells keep
their original decimal/integer spellings as text. The separate native-kind column
distinguishes numbers, strings, booleans, nulls and the explicit JSON/label choices.
All original capture, review, operation, page-body and other declared source files
remain in the original edition closure.

The bridge returns complete projected rows, projected kinds, full original source
kinds, source metadata, exact edition/capture/review, and every edition.files member
plus edition.json. Each source descriptor includes the logical relative name,
canonical absolute path, bytes, SHA256, media type and role. Python reopens all those
regular files and checks their complete declared bytes/SHA against the original
edition. It retains every body in the existing ResponseDocument/archive workflow.
A complete bridge JSON maps each logical source member to its retained hash.

## Projection and key mapping

The native review aliases remain the declared projection. The current
reviewed_columns helper maps those aliases to Analysis storage names, preserving
the root's case-insensitive SQLite naming fixes.

source_column_aliases keeps every alias of every original source column, including
multiple projected representations. storage_alias_mapping records the final
Analysis names. A semantic alias is selected explicitly from a unique native
projection, a same-named native projection, or a sole declared projection.
Ambiguous source columns remain listed alongside all their visible data columns.

type_mapping={} means the native-kind JSON already names final storage columns.
The recipes _hints integration honors that explicit map, preventing a semantic
source alias from remapping a type twice.

The original native key review and complete alias map are preserved. A recommended
business key must be unique in that actual native review, fully available in the
chosen native projection, and free of local database locators. Recommendations use
original source names; the existing Analysis recipes and comparison path apply
the explicit semantic map. rowid, _rowid_ and oid aliases stay local locators.

When the native capture has no retrieval start time, its actual committedAt value
supplies the source retention time. capture_time_basis records native-capture-commit;
the complete original page receipts retain available retrieval times.

## Operate and receive the complete customer workspace

Create or receive the edition through the original Datasette source application.
Save the handover above with its actual edition path and SHA256, then open the
Datasette Analysis application and prepare that handover. The application retains
the complete reviewed source and creates its country summary, data-quality review,
published report, workbook and editable Analysis views.

Use the installed command, Applications lifecycle and Python workbook setup
described in [INSTALLATION.md](INSTALLATION.md). The browser, Python client and
command-line interface operate the same retained Analysis workspace.

The native `receiving.py` programme accepts this handover through `--handover`.
With the original WRI geothermal edition, supply `--expected-rows 189`,
`--expected-capacity-mw 12563.55` and `--customer-country USA`. The programme
prepares the edition, reads every row through HTTP, downloads the complete report,
workbook and handoff, exports through the original workspace archive engine, and
receives the archive into an independent workspace. It then saves and executes
the customer's country query, exports a new archive, receives that edited workspace,
and reopens the same saved query and result.

Keep the source edition and both received workspaces in the customer's retained
operation directory. Every original edition member and the full handover are
included in the Analysis source document and its workspace transfer.

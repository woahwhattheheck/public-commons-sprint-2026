# Original workbook calculation

The questionnaire workspace retains the complete original XLSX bytes. Native
calculation opens a separate read-only copy in installed LibreOffice, calls
`com.sun.star.sheet.XCalculatable.calculateAll`, and retains its full native
XLSX export. Original workbook macros and linked-source updates are disabled.
The calculation client uses a fresh private LibreOffice profile and a native
connection bound to the local loopback interface.

Requirements are Python 3.10+, Java 17+ with source-launch support, and installed
LibreOffice. The supplied official UNO Java client is version 26.2.2. The full
native programme ran with OpenJDK 17.0.20 and LibreOfficeDev 26.8.0.0.alpha0,
build `2c87e51eeaa2b413ff4ae097b2705eea1995d8e5`.

The complete offline client, original Maven POM, MPL license and locked inventory
are retained under the workspace's `calculation-runtime` directory. A received
customer project retains that same runtime at its root. No Maven package resolve
or network request is made during workbook calculation. Select another installed
office or Java executable with `ATSSC_SOFFICE` or `ATSSC_JAVA`.

Run an original retained workbook through the same application:

```sh
python3 application/cli.py --workspace ./workspace invoke calculate_workbook \
  --json '{"request_id":"original-c1-calculation","workbook_sha256":"649106f345787fb9f3154b5f2fcd418503e4bbfe5b46b191e714c1d7370df8c4"}'
```

Use the SHA256 returned by the original workbook import. A respondent calculation
is tied to that respondent's own uploaded workbook and published question edition.
The operator can provide an existing definition and report mapping. The returned
`calculated_sha256` identifies the whole original-format calculated workbook in
the same retained workbook store; `answers` uses the published stable question IDs.

Each job retains the source SHA, native export, native formula tokens, cached
calculated workbook, every original/member cache comparison and complete output
inventory. Its original formulas, including shared and array attributes, styles,
defined cells, source labels, validation, protection and unrelated ZIP members
remain unchanged. The separate full native export also retains its native array
result windows. The cache manifest lists any result cells outside the author's
original declared array window.

The five original Annex workbooks contain existing formula errors and legacy
helper references. The native programme keeps their original cached outcomes and
their actual recalculated outcomes separately. An error remains a typed formula
error; answer projection never treats it as a number or a zero. Original error
expressions remain editable in the retained source workbook. A valid numeric
zero remains a zero, and a cleared answer remains absent.

Calculation persistence uses the original SQLite database. The application writes
short start/finalize transactions and runs the native engine outside a database
transaction. A private filesystem lease serializes calculation jobs. Exact
request replay returns the saved edition with its original identities and file
hashes. A changed payload using the same request ID fails. A restarted unfinished
job reuses a validated complete native export, or starts a fresh native attempt
while retaining the prior attempt and its diagnostic output. Whole-project export,
receive and reopen retain all job files, original workbook bytes and access roles.

Technical source references:

- [Official calculation API](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1sheet_1_1XCalculatable.html)
- [Official formula-token API](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1sheet_1_1XFormulaTokens.html)
- [Official Java UNO runtime](https://api.libreoffice.org/docs/java/ref/com/sun/star/comp/helper/Bootstrap.html)
- [Official published Java client](https://central.sonatype.com/artifact/org.libreoffice/libreoffice/26.2.2)

The standalone complete-family native command is also available:

```sh
python3 application/native_calculation.py \
  --input-directory ./originals \
  --output-directory ./new-native-edition \
  --uno-jar ./calculation-runtime/libreoffice-26.2.2.jar
```

Select a new output directory to preserve an existing completed native edition.

## Complete original questionnaire intake

The original source family comprises five XLSX files, 79 worksheets, 71,717
declared cells, 7,661 formulas and 21 hidden worksheets. The compiler creates
3,514 stable questions covering 7,424 visible unlocked answer cells and 1,531
readonly native metrics. It uses the original cell protection, merged anchors,
number formats and validation rules. Every source cell, French label, original
question prompt, defined name and hidden calculation/report origin remains in
the complete machine catalogue. Hidden Variables, FY and INT origins stay
operator source context rather than becoming respondent input fields.

First calculate the retained complete original, then import its full definition:

```sh
python3 application/cli.py --workspace ./workspace invoke import_workbook_definition \
  --json '{"request_id":"original-c1-intake","workbook_sha256":"649106f345787fb9f3154b5f2fcd418503e4bbfe5b46b191e714c1d7370df8c4"}'
```

The result gives the original questionnaire ID, definition version, complete
definition, source counts and `catalogue_path`. Publish that saved version and
invite a respondent through the normal application. A stable request resumes
the same questionnaire and saved definition after a process interruption;
compilation, source classification and each normal nested mutation are retained.
Different source/classification inputs cannot reuse that request identity.

`classifications` may supply explicit operator mappings keyed by `sheet!cell`,
with `disclosure`, `label`, `kind`, `choices`, `minimum`, `maximum` or `unit`.
The original PUBLIC/PROTECTED source markers establish the default. Source
cells without a classification marker remain explicitly marked
`operator-classification-required` in the catalogue and default to protected.
To revise an existing questionnaire, include its `questionnaire_id` and current
`expected_version` under a new request ID. Previously published definitions,
submitted responses and report editions retain their original source mappings.

The compiler preserves original numeric no-data markers as typed unavailable
outcomes. Original X/0 indicators remain text indicators, even when the source
cell uses an accounting format. A translated text formula remains text. A later
numeric unit-value result is a number and participates in numeric consolidation.
These distinctions are recorded from compiler version 2. Version 3 also uses
the original percentage unit headers to type blank General-format inputs,
including unscaled E97. Earlier native attempts and corrected successor
definitions remain in the same workspace history.

## Authoritative response calculation and disclosure

Saving progress retains entered answers without running office calculation.
Sealing an original-family response writes its declared answers into a separate
original-format workbook edition, runs the real native engine, and supplies
readonly computed fields to the normal revision validation. This also runs for
certification: its hidden helper formulas are retained and calculated even
though it has no visible computed questions. Respondents cannot supply the
computed answer values themselves.

Scalar bindings use exact source SHA/sheet/cell coordinates. Bound table rows
use `source.rows`, so physical rows 40, 44 and 48 remain those rows through
upload, native calculation and return projection. Blank intermediate rows retain
their positions. `source_readonly` labels come from the original BLOB and never
become worksheet writes. Dates use the original 1900/1904 date system;
percentage fields carry their explicit `workbook_scale`. The source's General
format percentage answer E97 is an unscaled numeric percentage.

An uploaded answer workbook must select a source retained by the immutable
publication. Its original sheet names/visibility, defined cell catalogue,
formula expressions/attributes, styles, protection, merged ranges and validation
must match that original template. The original uploaded package remains the
base of its answered successor; other source-family answers remain retained.

Each sealed revision records its calculation IDs, input hash and original /
answered / calculated SHA bindings. Original native formula errors and
unavailable numeric markers stay typed and visible in the protected calculation
record. Public disclosure follows exact native reference coordinates, including
the actual referenced row/column in a period table. A protected input cannot
expose its numeric value or a derived native summary through a public report.
The protected edition preserves full values and lineage, while the public
edition retains separately supplied public alternative text.

## Delivered complete customer programmes

The editable complete-family programme runs intake, publication, invitation,
saved-progress reopen, actual native revision, analyst review and paired report
downloads through the original application. The entered examples come from the
retained plan; their names and values identify an internal demonstration.

```sh
python3 application/whole_family_programme.py --workspace ./workspace \
  --plan ./workspace/source-evidence/whole-family-programme/entered-plan.json
```

`source-evidence/whole-family-programme/complete-family-programme.json` indexes
all five families and their exact report files. The first foreign-producer
native production total is 150; its public summary X indicator is masked by its
protected production precedent. The importer unit value is 2,500, domestic
production total is 100, and union totals are 25 employees / 37,000 hours. The
zero and cleared production successors both calculate a total of 30 while
preserving different original input values and workbook identities. Their
separate reports retain the earlier accepted editions and disclosure review.
The cleared original workbook is additionally uploaded through the original
workbook-answer route, sealed with a new authoritative native calculation and
accepted in the same publication. Its cleared input and total 30 survive that
complete source-workbook return journey; its actual uploaded package is retained.

Freeze the current accepted customer reports with complete original question
context and all paired download formats:

```sh
python3 application/source_context_report_programme.py --workspace ./workspace
```

`delivered-report-index.json` selects six current customer reports: one per
family plus the complete workbook receiving example. Each has paired JSON, CSV,
HTML, PDF, Word, XLSX and PowerPoint files with exact SHA256 and byte identities.
The same index separately retains the original initial, zero, cleared and prior
source-attempt report files. The current foreign-producer edition is its cleared
successor; the first total 150 remains in the earlier sealed report history.

`reporting_workbook_programme.py` additionally reads a retained accepted-report
selection, authors all current source-bound C1/C2 workbooks and verifies their
complete original-value return projection. Its source evidence is retained
under `source-evidence/accepted-workbook-cohort`. It preserves the original
accepted respondent/review/report history and source-context year/trade labels.
The exact original questionnaire/report selection is provided with the case.

Whole-project export includes the full original workbooks, compiled catalogues,
entered and native successors, job attempts, report files, source modules and
locked offline client runtime. Receiving and reopening use the same workspace
identity and the ordinary original API. Keep the original project archive and
its SHA sidecar together for the operator handover.

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

# World Bank reports and customer workbooks

A reviewed World Bank handover can continue directly into the existing Python
Analysis application. The installed `stellar-forge-worldbank-analysis` command
prepares the typed source table, saved SQL recipes, a published report, an Excel
workbook and a portable Analysis workspace.

The input is the original World Bank `handover.zip`. The command uses the
original World Bank importer and review/export engine to validate its retained
source responses and reproduce its reviewed CSV. It requires the reproduced CSV
to match the original customer CSV byte for byte. The completed source then
enters the original Analysis response-document and table-import workflow.

## Install and prepare

Use Python 3.11 or newer and the original Python package with its workbook extra:

```sh
python3 -m pip install '/absolute/starforge/sf88-operator-buyer-cli/python[workbooks]'
stellar-forge-worldbank-analysis prepare \
  --handover /absolute/WorldBank_Managed_Customer_Handover_20261012.zip \
  --worldbank-core /absolute/starforge/sf30-seller-sdk/worldbank/core.py \
  --workspace /absolute/private/worldbank-analysis \
  --operation-id 13c281c36fca40fe8377af367911bb4d
```

The original `core.py` must remain beside its original `source.py`. In a full
repository checkout, both paths are under
`stellar/scf-starforge-20261009/`. The Python package also supports direct
module invocation with
`python3 -m stellar_forge_buyer.worldbank_analysis`.

Choose a private absolute workspace directory. The operation ID is a stable
32-character lowercase hexadecimal value. Omitting it derives one from the
original handover digest. An optional `--prefix` names this edition's Analysis
view and saved recipes. Other editions use their own operation IDs and view
names inside the same existing Analysis application.

The command prints progress for each original source, import, report, workbook
and archive job, then the complete delivery metadata. Each output is retained in
`<workspace>/worldbank-analysis/<operation-id>/delivery/`.

## Customer outputs

| File | Customer use |
| --- | --- |
| `WorldBank_Report.html` | Open the complete published report in a browser |
| `WorldBank_Report.json` | Read the same original report, source bindings and result metadata programmatically |
| `WorldBank_Report_Tables.zip` | Use the original report's section CSV exports |
| `WorldBank_Analysis.xlsx` | Open the typed customer workbook in Excel or another spreadsheet application |
| `WorldBank_Workbook_Handover.zip` | Receive and inspect the original workbook package independently |
| `WorldBank_Analysis_Workspace.zip` | Reopen the original sources, SQL recipes, report publication and workbook history |
| `WorldBank_Analysis_Workspace_Manifest.json` | Read the complete portable workspace file inventory |
| `Analysis_Delivery.json` | Resolve source, publication, workbook and portable workspace identities and hashes |
| `Open_and_use.md` | Follow the customer receiving and local application instructions |
| `WorldBank_Analysis_Delivery.zip` | Transfer the complete customer delivery together |

The original Analysis report exporter, workbook builder and workspace archive
engine create those products. The adapter assembles their retained files into
the final customer bundle using stable ZIP member metadata.

## Analytical views

### Reviewed observations

This section retains every row selected by the original World Bank review,
including its exclusions and any explicit duplicate-row choices. Source
numeric tokens, country/indicator identifiers and period labels remain text.
The original aggregate flag is displayed as `true` or `false`. Source page and
row positions remain integers.

The reviewed CSV must include source, country, indicator, period, value, value
state, unit, observation status and aggregate columns. If a prior review removed
one of those fields, select a source review containing the required analytical
identity instead of reconstructing it from guesses.

### Source coverage

Coverage groups by the original source, country, indicator, aggregate flag and
unit. It counts all reviewed observations and missing values and retains the
first and last original period labels. It does not insert missing years or
aggregate countries into a new regional series.

### Annual change

The annual recipe accepts four-digit period labels. It compares consecutive
selected years within the same source, country, indicator, aggregate status
and unit. Missing values, repeated period identities, gaps and zero prior values
produce an uncalculated result with an explanatory status. The source value and
previous source value stay beside the derived percentage.

A source period such as a quarter or month remains in the observations and
coverage sections. It is outside this annual recipe.

### GDP and population

When both `NY.GDP.MKTP.CD` and `SP.POP.TOTL` are present, the fourth section joins
unique reviewed rows on source, country, period and aggregate status. It preserves
both original source values and calculates GDP divided by positive population.
Repeated source identities remain in Observations and are omitted from the ratio.

This is a ratio of the original current-US-dollar GDP series to the original
population series. It is distinct from constant-price or purchasing-power-parity
measures. The original indicator definitions remain in the World Bank package.

## Precision and missing values

The typed source document preserves the original CSV schema: World Bank values
are nullable strings, aggregate flags are booleans and source page/row positions
are integers. The existing DatasetDatabase imports those typed scalars without
affinity conversion. Raw source values never pass through a floating-point
conversion before retention.

Derived percentages and ratios use SQLite floating point. They are explicitly
labelled calculations and use numeric Excel cells with the existing
`excel-number` setting. Counts use integer cells. Source token, period and code
columns use text cells with preserved precision. Missing source text displays
as `NULL`; uncalculated numeric cells are blank. The underlying Analysis table
keeps missing values nullable.

Report sections are complete original query results. The adapter does not accept
truncated reports. The current command supports fewer than 100,000 reviewed
observations, an original handover up to 32 MiB and a typed JSON source up to
the original Analysis document limit of 32 MiB.

## Retained source and reproducible queries

The original source document holds the exact handover ZIP, reviewed CSV, dataset
schema, provider source metadata, original review, selection and original capture.
The ZIP contains the full original response closure. The typed projection is a
separate, content-addressed document.

Provenance retains the original provider capture time, source selection, original
review revision and source digest. The transform digest identifies the exact
`typed_rows` function source. The adapter also records its executing module digest
in its operation metadata. Reopening a source edition retains its original
document and saved SQL revisions.

Each report section pins an original saved SQL recipe revision. Report
publication pins the exact completed report result and reviewed view bindings.
Each workbook sheet pins the original publication record and source section,
including the original column position. These identities travel through the
existing workbook and workspace packages.

## Continue after interruption

Run the same `prepare` command with the same source, operation and workspace.
Completed source import and review are reused; a valid review is not incremented.
Completed jobs and publication IDs retain their original results.

When a prior phase was interrupted or failed, correct the underlying problem
and repeat the same command with `--resume`. The original workspace archive job
resumes its retained snapshot. Other job kinds keep their previous outcome and
use a new retained attempt under the same adapter operation. This also handles
an interrupted workbook build without overwriting its partial output directory.

A completed adapter delivery is reopened by verifying its retained files. Later
customer changes to the original Analysis workspace are preserved.

```sh
stellar-forge-worldbank-analysis status \
  --workspace /absolute/private/worldbank-analysis \
  --operation-id 13c281c36fca40fe8377af367911bb4d
```

## Receive the customer's complete workspace

Use the exact workspace ZIP hash from `Analysis_Delivery.json`, a new target
under a private parent, and a stable receiving operation ID:

```sh
stellar-forge-worldbank-analysis receive \
  --archive /absolute/WorldBank_Analysis_Workspace.zip \
  --sha256 <exact-workspace-archive-sha256> \
  --workspace /absolute/private/customer-worldbank-analysis \
  --operation-id 431e21b8c6e44f65a3d6c279f5b8e012

stellar-forge-worldbank-analysis serve \
  --workspace /absolute/private/customer-worldbank-analysis
```

The command delegates to the existing `restore_archive` operation. Interrupted
receiving continues the same original archive, and completed repeat receiving
preserves later edits. The original Analysis application binds a private numeric
loopback URL and prints it for the customer.

To receive the workbook separately, use the existing
`WorkbookDelivery.receive(archive, destination, expected_sha256=...)`.
If the destination was already received, reopen it with
`WorkbookDelivery(destination, expected_manifest_sha256=...)` and
`inspect()` instead of creating a second receiving tree.

## Run the complete original receiving example

The [complete receiving example](examples/analysis-native-receiving.py) carries
the original North America edition through producer and customer workspaces in
one retained operation. It accepts the original 14,330-byte managed customer
handover with SHA256
`c99f7386ae02742eb0d5c91b1c051eab753fc210d2cd689eb21127109de391fb`.

Use an existing Python 3.11+ environment with `openpyxl==3.1.5`:

```sh
python3 -B examples/analysis-native-receiving.py \
  --workspace /absolute/private/worldbank-analysis \
  --handover /absolute/WorldBank_Managed_Customer_Handover_20261012.zip
```

The example receives the two required source folders from immutable commit
`ad176c013d239cbb307e7d3a168fe9029e0570eb`, retains their Git blob inventory,
and reopens those same files on a repeated invocation. The original Analysis
module must match SHA256
`923fa1b5ad8476cc9294e78d33d8a891b0ea5a13ec79f61dc350c8e438c9721f`.
If the workbook dependency is installed in an existing private target directory,
pass `--python-dependencies /absolute/that-directory`.

The producer uses operation `13c281c36fca40fe8377af367911bb4d`. The customer
receives the completed workspace with operation
`431e21b8c6e44f65a3d6c279f5b8e012`, runs the original observations query,
compares all 42 rows to the reviewed handover, and retains a Canada GDP query.
It then repeats the same workspace receiving operation and confirms that the
customer's saved query survives. The private Analysis HTTP application opens
inside the same invocation.

The workbook is received through `WorkbookDelivery`; the example checks the
received file against the original Excel delivery. Its four data sheets contain
42 observations, 6 coverage rows, 42 annual-change rows and 21 GDP/population
rows. The original Readme and Sources sheets remain present. The Canada 2024
GDP token `2270076189683.46` remains a text cell, while calculated changes and
ratios use numeric cells.

Progress and actual errors are printed as JSON. `producer-result.json`,
`customer-result.json` and `native-errors.jsonl` are retained at the operation
root. The complete customer bundle is at:

```text
<workspace>/producer/worldbank-analysis/13c281c36fca40fe8377af367911bb4d/delivery/WorldBank_Analysis_Delivery.zip
```

Continue an interrupted run with the same command, original handover and
workspace directory. The producer, received customer workspace and separate
received workbook stay under that directory. A completed receiving is reopened
against its original archive and manifest, preserving the customer's saved
query and the original job histories.

## Source references

- [World Bank API request structure](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures)
- [World Bank indicator metadata](https://datahelpdesk.worldbank.org/knowledgebase/articles/898599-indicator-api-queries)
- [Original World Bank source and review application](README.md)
- [Existing Python Analysis workspace](../../sf88-operator-buyer-cli/python/WORKSPACE.md)
- [Existing workbook delivery](../../sf88-operator-buyer-cli/python/WORKBOOK_DELIVERY.md)

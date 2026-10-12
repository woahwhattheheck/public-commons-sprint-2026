# Commons BI Migration Operator

A complete local workspace for Cognos migration and ongoing report support: import the original specification, review and map the model, build native paginated reports and editable Power BI projects, compare complete report outputs, manage deployment and rollback, and hand the work to its receiving team.

The operating views include the complete [load-forecast review workflow](LOAD_FORECAST_GUIDE.md): published workbook intake, exact period and unit mappings, forecast-vintage or accuracy comparisons, sourced explanations, analyst decisions, complete ten-sheet deliveries and editable receiving. They also cover inventory, migration plans, data and corrections, output comparison, on-premises Report Server, Power BI capture, cloud rollout and rollback, support, agency billing, handoff and recovery, and activity. The interface uses a restrained grayscale industrial layout.

## Start

Use Python 3.10 or later. Run these commands from this directory:

    python -m venv .venv
    .venv/bin/python -m pip install -r requirements.txt
    .venv/bin/python BI_OPERATOR.py --workspace ./bi-workspace serve

On Windows, use .venv\Scripts\python.exe in place of .venv/bin/python.

Open the complete localhost address printed by the process. Its access fragment is private to that workspace. The server binds only to loopback and permits one operator process per workspace.

Select **Load SANDAG working example** to import the complete public data, authored Cognos-compatible specification, reviewed model, explicit source mappings, and native Power BI build. The same import runs without a browser:

    python BI_OPERATOR.py --workspace ./bi-workspace example --build

The complete CSV inputs are in examples/sandag/data.zip. The application reads that archive directly; the working example needs no external database or data download.

## Choose the receiving platform

SANDAG SOL1623687 starts with **on-premises Power BI Report Server** and adds an Azure/cloud phase from 2027. The two native routes have separate files and execution steps.

| Receiving platform | Editable native file | Operating route |
|---|---|---|
| Power BI Report Server | Paginated `.rdl`, or `.pbix` saved in the Desktop version optimized for the receiving Report Server | **Report Server** prepares a complete Windows receiving job, retains the previous native report, imports complete native CSV exports and delivers recovery instructions. |
| Power BI Desktop / Fabric cloud | `.pbip`, `.pbir` and `.tmdl` | **Migration plans** builds the native project; **Power BI capture** and **Rollout & rollback** use the corresponding cloud APIs. |

Power BI Desktop optimized for Report Server does not open PBIP projects. Use the matching Report Server Desktop application for its PBIX files, or Report Builder for the included RDL family. The [operating guide](OPERATOR_GUIDE.md) and [Windows runner guide](tools/report-server/GUIDE.md) cover both paths.

## Work delivered

| Workflow | Behavior |
|---|---|
| Cognos inventory | Reads report XML, Framework Manager XML, data modules and dashboards. Retains original bytes, query graph, prompts, filters and review items. Assigns owners, priority and migration waves; joins usage CSVs by workspace source IDs. |
| Reviewed migration | Edits the typed native model, DAX, relationships, pages and visual fields. Binds each table to an imported CSV, explicit SQL Server table/query, or reviewed Power Query M. |
| Native Power BI build | Produces PBIP, PBIR and TMDL with stable identities, native visuals, a grayscale theme, complete data and source/plan metadata. Validates JSON documents with the bundled Microsoft schema closure. |
| Full output comparison | Compares every row, including duplicate counts, explicit nulls, decimals, booleans and ISO dates. Supports mapped fields and explicit numeric tolerances. Retains original and corrected outputs as separate linked records. |
| Report Server operations | Imports native RDL/PBIX files or registers large original files by complete size and hash. Generates a reviewed CSV/SQL paginated family, prepares a native Windows job, receives the original result ZIP and imports its complete CSV captures. |
| Native result capture | Calls Power BI Execute Queries against an existing semantic model. Saves the original response and complete CSV. Recognizes native errors and truncation; includes nulls. |
| Existing-item deployment | Captures current Fabric semantic model/report definitions before updating either item. Retains Microsoft operation IDs and resumes the original asynchronous operation. |
| Reconciliation and rollback | Reads native state after an uncertain response and prepares restoration from captured definitions, including a settled partial deployment. |
| Support and handoff | Tracks owners, severity, state, due dates, reproduction and resolution against source/artifact revisions. Exports a complete selected implementation handoff. |
| Agency billing | Retains original Azure cost/usage files; applies versioned agency/resource policies; reconciles shared charges, refunds and currency rounding; reviews/finalizes monthly statements; exports agency CSV/HTML and a complete accounting workbook; retains corrections and prior statements. |
| Recovery | Encrypts SQLite state and immutable objects with AES-256-GCM. Restores into a new directory, checks the complete database/object closure, and rotates browser access while preserving business/provider IDs. |

## Agency cost allocation and bill-back

Open **Agency billing** for the complete monthly operating workflow. [BILLING_GUIDE.md](BILLING_GUIDE.md) covers input mapping, direct/fixed/usage policies, review, corrections, statements, accounting exports and recovery. It implements the original SANDAG Task 4 agency cost-allocation work in the existing versioned workspace.

To load the separate Commons-authored 12-agency operating example, use:

    python BI_OPERATOR.py --workspace ./billing-example billing-example
    python BI_OPERATOR.py --workspace ./billing-example serve

The example includes 83 native-format cost rows, 36 agency usage records, 16 resource rules, a prior-usage refund, invoice-scope rounding, small charges and provider internal allocation rows. It opens as a draft for the receiving operator to review and finalize. The example agency IDs belong to this authored billing case; the public crime-report jurisdictions keep their separate geographic meaning.

## Public SANDAG example

The source is SANDAG's **2024 Crime in the San Diego Region**, published August 18, 2025. SOURCE.json in the example records the issuer URL, original PDF identity, extracted input identities and transformation rules.

The model includes all **5,037** retained offense-table cells across the published 2021, 2023 and 2024 columns; a **26-row** jurisdiction dimension including the regional aggregate; **42** population records; **312** published Group A summary controls; and the three reported years. It has five explicitly bound tables, five relationships, six measures, four pages and seven native visuals.

Original values, reporting states, raw tokens, source rows/pages, footnotes and hierarchy remain attached. Group A categories use the publication's distinct counting rules. Group B is arrest-based. Regional aggregation includes Sheriff-Total once. A selected subset uses the same nonoverlapping jurisdiction set for detailed and published counts. The retained summary controls cover Group A; the Group B page presents actual detailed Group B counts.

Population retains the issuer's 2021 and combined 2023/2024 observations. The reference page shows the original period and applicable years, without duplicating a population observation or filtering the combined period away. Missing and partial values remain missing and partial. Twelve visually unlabeled cells remain unlabeled.

The authored Cognos-compatible example provides a reproducible public-data migration exercise. It is identified as a Commons-authored specification throughout the workspace. Production Cognos exports can be imported separately with their own mappings and review.

The pages cover Group A counts and published controls; Group B arrest-based counts; source coverage and row trace; and population denominators. The source's detailed/summary differences remain visible.

## Open and operate the native Report Server family

Extract **examples/sandag/SANDAG_Public_Example.ReportServer.zip**. It contains five complete RDL 2016 reports, their source mappings, the reviewed plan and an operating note. Open the reports in Microsoft Report Builder or publish them through the **Report Server** view. The public example uses embedded XML source rows, so it requires no agency database connection.

The offense report contains all 5,037 original cells and the exact eleven fields in the retained baseline. The other reports retain all 26 jurisdictions, 42 population observations, 312 published controls and three years. Their native definitions validate against the bundled original Microsoft RDL 2016 schema. Use report-server-comparison.json for the native CSV export and expected-native-rows.csv from data.zip as the baseline.

For production reports, import the actual formatted RDL or optimized Desktop PBIX. Generated paginated families are explicit tabular projections of reviewed source mappings; report measures, original layout and access rules have their own implementation review.

Prepare a job using the actual catalog path, REST address ending in /api/v2.0, report-service URL, parameters and native application versions. The ZIP includes the original report and the complete PowerShell runner. Files larger than 64 MiB stay on the native machine and are registered through the runner's small JSON manifest.

Use the same Windows work directory for Inspect, Capture, Publish, Reconcile, Export, Rollback and Package. Capture retains existing native content and target identity before deployment. The receiving result ZIP preserves the original job, event history, recovery files and exact output captures. Import it in **Report Server**, compare and correct the full output, attach support cases, and build the complete operating handoff.

## Open the native cloud project

Download the project from **Migration plans**, or use the included examples/sandag/SANDAG_Public_Example.PowerBI.zip when present. Extract it and run:

    python prepare_project.py

Then open the PBIP file in Power BI Desktop and refresh. On Windows, OPEN_POWER_BI.ps1 prepares the extracted data path and opens the project. The helper updates only the DataRoot expression.

Use capture-query.dax in the example for the complete 5,037-cell native row projection. Its native-comparison.json maps the native query aliases to the retained baseline and defines exact numeric comparisons. Extract expected-native-rows.csv from data.zip when using an external tool.

JSON schema validation and an actual Desktop/Fabric refresh are separate recorded stages. A native capture stores the result of the latter. Existing-item Fabric rollout requires SQL or native M bindings and existing service connections; local CSV demo bindings stay with the Desktop project.

## Operating guide

[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) covers the full migration/support workflow, structured actions, original-operation recovery, deployment, and backup restoration.

Credentials stay in the operator process environment. Set POWER_BI_ACCESS_TOKEN for native result capture and FABRIC_ACCESS_TOKEN for deployment, or select another environment variable name in the form. The browser never needs the credential value.

## Portable delivery

The standard-library release builder packages the application, vendored parser, Microsoft schemas, complete public example and documentation. It excludes workspaces, environments, caches and backups.

    python build_release.py --output /path/to/Commons_BI_Operator.zip --source-commit YOUR_COMMIT

The builder reopens the ZIP and verifies every file against its manifest. The receiving operator can use the archive without cloning the repository.

## Dependencies and attribution

The unmodified cognos2powerbi parser/IR/generator core is pinned to upstream commit 1994a986c73f37538cde8235f613d1c29031b505. The adapter uses its mechanical parsing and native query-state generation. VENDOR_SOURCE.json records every exact vendored file; THIRD_PARTY_LICENSES.txt retains its MIT license.

The schemas index pins 18 downloaded Microsoft JSON schemas by URL and SHA-256. The Report Server route also includes Microsoft’s original RDL 2016 XSD from microsoft/RdlMigration. The original licenses and source identities accompany both schema sets. Runtime schema validation works offline.

The original public-data source is attributed separately. The working example does not imply agency affiliation or production-system access.


## Complete operating example

See [DEMONSTRATION.md](DEMONSTRATION.md) for the supplied public native files, complete browser workflow, full-data correction and encrypted recovery. The Report Server runner and original job/result packages travel with the release. Use [examples/sandag/SOLICITATION_SCOPE.md](examples/sandag/SOLICITATION_SCOPE.md) for the source-grounded ARJIS delivery scope.


## SQL Server operations

The SQL Server workspace adds private connection/catalog inspection, typed and reviewed keyset queries, durable multi-page capture/cancellation/continuation, original native result receiving, model field mapping, full comparisons and portable workstream receiving. Original record histories and exact native job inputs remain together through conflict resolution and encrypted recovery.

Start with [the complete SQL Server operating guide](tools/sql-server/GUIDE.md). The existing host additionally uses Node22.16+ and mssql12.7.4 for actual SQL Server reads. One existing driver installation is reused across immutable jobs; portable job/result packages support a separately equipped host. Password values remain in that selected host's environment.

## Azure monthly source acquisition

The **Azure exports** workspace completes native export discovery, an existing export's monthly execution and original run history, manifest selection, resumable ETag-pinned partition transfer, staff header review, original Agency billing import and portable receiving. It retains original CSV/Gzip/Parquet files and freezes the selected source/review/partition identities into finalized statement downloads. Ordinary file imports retain their existing identities. See [AZURE_EXPORTS_GUIDE.md](AZURE_EXPORTS_GUIDE.md) for the complete operator flow, connection fields, structured operations, receiving and recovery.

Run `python examples/AZURE_EXPORTS_JOURNEY.py --output ./azure-example` for the complete authored operating journey over the original 12-agency billing inputs, then reopen `./azure-example/workspace` with the ordinary launcher. CSV/Gzip uses the existing runtime; native Parquet additionally uses `requirements-azure.txt`.


## Tourism funding and reporting

The **Tourism reporting** section uses the same original workspace records,
operation journal, file store and encrypted recovery as the migration and
agency billing application. Import mapped CSV sources or the original tourism
source packet, accept their exact editions, and prepare monthly, quarterly and
annual transient guest tax schedules. Collections, published distributions,
budget columns and operator cash retain their own source meaning.

The included Overland Park example contains 26 actual monthly KDOR observations,
ten published distribution controls, and the four original VisitOP budget
columns. It opens a prepared report for review:

```sh
python BI_OPERATOR.py --workspace ./tourism-workspace tourism-example
python BI_OPERATOR.py --workspace ./tourism-workspace serve
```

Staff review retains original arithmetic differences, then finalizes an exact
report edition. The complete export includes an eleven-sheet workbook,
individual CSV schedules, a printable HTML report, the annual plan, all selected
original source files and a file manifest. Use original encrypted workspace
recovery to continue editing on another computer.

See [TOURISM_GUIDE.md](TOURISM_GUIDE.md) for the full operating sequence, source
definitions, forecast assumptions, cash returns and receiving instructions.

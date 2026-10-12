# Stellarcarbon customer statements desk

Turn original carbon contributions and retirement records into customer and project statements. The complete desk keeps source editions, later retirement allocations, customer assignments, statement revisions and the receiving workspace together. Its optional accounting connection uses the original Merchant customer, invoice and payment-plan workflow.

[Complete source](../../stellar/scf-starforge-20261009/partners/stellarcarbon-statements/) · [Native contract and API](../../stellar/scf-starforge-20261009/partners/stellarcarbon-statements/README.md) · [Original retained data](../../stellar/scf-starforge-20261009/partners/stellarcarbon-statements/source-edition/manifest.json)

## Open the desk

The maintained command is **starforge stellarcarbon-statements**. In a source checkout, replace that prefix with:

~~~sh
node stellar/scf-starforge-20261009/partners/stellarcarbon-statements/cli.mjs
~~~

Use Node 22 or newer on Linux with the existing Merchant flock runtime. Initialize a private directory, receive the included original data, and open the printed URL:

~~~sh
starforge stellarcarbon-statements init \
  --directory "$HOME/stellarcarbon-workspace" --name "Stellarcarbon statements"

starforge stellarcarbon-statements import \
  --directory "$HOME/stellarcarbon-workspace" --retained \
  --label "Complete original sc-data d7c10873"

starforge stellarcarbon-statements serve \
  --directory "$HOME/stellarcarbon-workspace" --port 0
~~~

Merchant Applications lists **Stellarcarbon customer statements**. Select the initialized directory. Applications retains the selected source and workspace identity and provides the existing start, open, stop and reopen controls.

The page uses a neutral industrial layout. The top selection controls source edition, customer, customer project, inclusive start and exclusive end. The operator name identifies saved changes.

## Receive the original records

**Import and receive** offers three source paths:

- **Included original edition** receives all seven whole tables from the pinned upstream commit.
- **Native backup** accepts all seven original NDJSON files together, plus their metadata manifest when available.
- **Native API** selects the official network, fixed dates and page size, follows both lists to their terminal empty pages, and loads connected full records. Progress and original responses remain available for resume.

Each completed import becomes a named edition. **Source editions** shows the original repository/network/selection, quantities, available tables, metadata, whole source files and complete API responses. Each normalized native table has pages with all records.

The included [sc-data d7c10873 edition](https://github.com/stellarcarbon/sc-data/tree/d7c10873e98993616af561dd3d00a6e0ae81e3cc/sc-audit), published April 14, 2026, contains 176 rows in 43,022 original bytes. Its 39 sinking transactions are dated November 20, 2021 through March 3, 2026. It contains **49.158 CARBON**, **49.000 allocated**, and **0.158 remaining**.

## Assign actual customers and projects

Create a customer in **Customers and projects** using the operator's actual customer identity. Add an internal reference and useful operating note. A customer project belongs to that named customer.

In **Contributions**, open the complete original transaction. Its funder and recipient can differ. Assign the transaction, recipient or funder using the original value displayed. A transaction assignment takes precedence; then a recipient assignment; then a funder assignment.

Optional inclusive start and exclusive end dates restrict an assignment to a period. Deactivate a superseded assignment when it should stop participating. Editing a record creates its next version and retains history. Project selections follow the chosen customer.

When equally specific assignments point to different customers or projects, the desk shows a conflict. Correct the operator assignment from the complete original record. The overview and statement coverage show remaining unassigned and conflicting transactions.

The source VCS impact project is separate from the operator's customer project. An address does not automatically become a named company or registered Stellarcarbon profile.

## Inspect contributions and retirements

**Contributions** pages every selected sinking transaction. Search original hashes, exact TOIDs, addresses, memo and impact-project text. Filter by assignment or retirement status. Totals cover all matching records, including later pages.

Open a contribution for its full source payment assets and issuers, funder, recipient, metadata, assignment and every retirement allocation. CARBON retains three decimal places; source and destination asset amounts retain seven. Distinct asset issuers have separate totals.

**Retirements** selects certificate retirement dates. A beneficiary address prefix can refine the register. Each certificate appears once, with its full VCU quantity and attributed CARBON in separate fields. Open it for beneficiary, serial number, instrument/vintage details, block links and related contributions.

A false native completion flag may belong to a contribution that later completed. All allocations participate in filled and remaining quantities. The desk derives completion from the full retained set and keeps the original flags available in record detail.

## Prepare and retain a statement

Choose the source edition, customer or project, and date window. In **Statements**, prepare a title and operating note, then preview the complete contents.

The preview includes selected contributions, every linked retirement allocation, a separately dated certificate register, exact asset totals and source metadata. Review source age, assignment coverage and date bases.

Saving retains an immutable version. Revising produces another complete saved version. Earlier versions retain their original source, customer metadata and relevant assignment snapshot. A later import does not silently alter an existing statement.

Every saved version exports five complete files:

| File | Receiving use |
| --- | --- |
| statement.html | Readable statement; open and print or save to PDF |
| statement.json | Full statement, source selection, original rows and frozen customer/project metadata |
| contributions.csv | Selected native transactions, assignments, quantities and certificate IDs |
| allocations.csv | Every original transaction-to-certificate allocation and retirement date |
| retirements.csv | Independently dated certificate register, full quantity and attributed CARBON |

The contribution period and certificate period are separate. Allocation amounts include later certificates known in the retained source edition. The certificate register uses retirement dates. Both bases remain visible in the statement.

## Compare the next source edition

In **Compare editions**, choose an earlier and later edition. Inspect quantity changes and every native table. Added records, removed records and changed fields use their original source primary identities.

The JSON and CSV comparison exports contain all changes. Visible pages provide navigation. An API view declares its available tables and original selection, so compare source scopes as well as totals.

Save a new statement version when customer delivery should use the newer edition. Previous versions keep their original contents.

## Continue the original invoice and payment plan

Open the desk with an initialized original Merchant accounting directory:

~~~sh
starforge stellarcarbon-statements serve \
  --directory "$HOME/stellarcarbon-workspace" --port 0 \
  --accounting-directory "$HOME/merchant-accounting"
~~~

Choose the existing accounting customer by name in **Customers and projects**. Save a statement version containing that link. Its service-fee invoice action accepts the agreed amount, currency, tax amount, issue date and due date.

The desk calls the original Merchant invoice controller. Retrying uses the original request identity and recovers a draft saved before an interruption. The saved statement carries the original invoice link.

Continue in **Invoices and receipts** to edit, review and issue the draft. **Customer payment plans** uses the original installment flow, including fixed-day, monthly, quarterly and annual calendar schedules. Original accounts, receipts, balances and payment-plan history remain in the accounting workspace.

Service pricing is entered explicitly. CARBON quantities and source token conversion do not determine a service fee.

## Receive the complete editable workspace

**Export whole workspace** downloads the staff handover: every source edition and response, customers, projects, assignments, statements and versions, invoice references, history and replay records.

In **Import and receive**, choose that file and a new absolute private directory. The desk saves an independent workspace and supplies its local URL. The receiving operator can inspect original data, edit records, assign transactions, import the next edition and save another statement.

CLI receiving provides the same continuation:

~~~sh
starforge stellarcarbon-statements handover \
  --directory "$HOME/stellarcarbon-workspace" \
  --out "$HOME/stellarcarbon-complete-workspace.json"

starforge stellarcarbon-statements receive \
  --directory "$HOME/stellarcarbon-received" \
  --file "$HOME/stellarcarbon-complete-workspace.json"

starforge stellarcarbon-statements serve \
  --directory "$HOME/stellarcarbon-received" --port 0
~~~

Receive creates a new saved file. Close a running desk before opening a second writer against its directory. A browser-received desk runs while its parent process runs; its saved directory reopens independently with serve afterwards.

Whole-workspace transfer is for staff receiving and contains all customers. A single customer's period delivery uses that saved statement's complete exports.

## Walk through actual source periods

Open the included original edition and select **All customers**, so unassigned original contributions remain visible.

| Period selection | Contributions | CARBON contributed | Allocated in retained edition | Remaining | Certificates dated in period |
| --- | ---: | ---: | ---: | ---: | --- |
| From September 1, 2025; before October 1 | 5 | 14.949 | 14.949 | 0.000 | 4 certificates; 14 VCU |
| From November 1, 2025; before December 1 | 1 | 1.177 | 1.019 | 0.158 | 0 |
| From March 1, 2026; before April 1 | 1 | 1.000 | 1.000 | 0.000 | 1 certificate; 1 VCU |

September source payments span **CARBON 2.6100000**, **USDC 18.2493522** and **XLM 568.9618279**. Its contributions have allocations across six certificates known in this edition, including later retirements. One transaction beginning e479785d received **0.458** from a certificate dated January 28, 2026 and **0.881** from a certificate dated February 13.

November's transaction is **5d9f0355c3703c953e3a44cd0a666bc96f39b617ac1cfcef12300c37bc562384**, with exact TOID **257032605592502272**. Certificate **323885**, dated February 13, 2026, supplies **1.019** of its **1.177** CARBON, leaving **0.158**. The November certificate register is empty because its retirement occurred later.

March's **1.000** CARBON contribution has source payment **XLM 129.0612232** and allocation to certificate **325123**, dated March 3, 2026. It illustrates aligned contribution and retirement dates.

The [worked November statement](../../stellar/scf-starforge-20261009/partners/stellarcarbon-statements/worked-november-2025/statement.html) is generated by the actual statement engine using the real source recipient as its label. Its [complete JSON](../../stellar/scf-starforge-20261009/partners/stellarcarbon-statements/worked-november-2025/statement.json), allocation CSV, contribution CSV and retirement CSV travel alongside it.

## Operate the agreed installation and monthly service

For a partner installation, receive its original edition, create its actual customer mappings and projects, save each selected historical period, and then prepare the first current period from the selected current source. The same desk supports at least ten separately mapped customers and a consolidated all-customer statement. Each saved version retains the exact source used.

For a monthly run, acquire one new edition, compare it with the prior edition, prepare each customer statement and a consolidated statement, revise selected reports through the saved-version flow, and export their full files. Hand the complete editable workspace to the partner or next operator. The desk does not impose an artificial ten-customer or period limit; the commercial service scope defines the operated quantity.

## JSON command fields

Mutation commands accept complete JSON files; the browser fills the same values.

| Operation | Required fields | Optional or update fields |
| --- | --- | --- |
| customer | name | id, expectedVersion, reference, note, merchantCustomerId |
| project | customerId, name | id, expectedVersion, reference, note |
| assignment | kind, value, customerId | id, expectedVersion, projectId, fromDate, beforeDate, active, note |
| statement | title, editionId, fromDate, beforeDate | id, expectedVersion, customerId, projectId, note |
| invoice | amount, currency.code, currency.scale, issueDate, dueDate | statementVersion, taxAmount, note |

Assignment kind is TRANSACTION, RECIPIENT or FUNDER. Native amounts and cursors remain strings. Updates include the current record version; statement updates include the current saved-version count. The CLI uses the current workspace revision and accepts --request-id and --actor.

## Source map

| Source | Responsibility |
| --- | --- |
| source.mjs | Native columns, exact numeric parsing, dates, keys and relationship validation |
| engine.mjs | Assignments, full record pages, statements, saved versions, comparison and handover |
| capture.mjs | Complete original API lists, relation closure and resume checkpoints |
| store.mjs | Original private-file and kernel-lease storage; source hashes |
| exports.mjs | Full HTML, JSON and CSV statements and comparisons |
| accounting.mjs | Original invoice controller and request recovery |
| server.mjs | Local desk and original accounting handler composition |
| public/ | Complete browser operations |
| cli.mjs | Source acquisition, operations, exports and editable receiving |
| client.mjs and declarations | HTTP client and typed full data contracts |
| application-provider.mjs | Original Applications preparation, binding and local listener |
| source-edition/ | Seven original tables, metadata and original license |

## Comparing source coverage

The comparison retains each edition’s observed row counts and acquisition scope. A table is compared only when both source editions acquired it. Complete native Stellarcarbon backups cover all seven tables; native API captures cover the five declared tables. Distribution transactions and minted blocks remain unavailable in an API-only edition. Their comparison change counts are `null`, their change arrays are empty, and the operator screen and CSV label the comparison unavailable. This avoids interpreting an unacquired table as deleted records. Registry imports likewise preserve their explicitly supplied table coverage. Added, removed and changed rows describe differences within the retained source populations.

The HTTP and CLI comparison JSON expose `comparisonStatus`, `coverage.before`, `coverage.after` and `note` for each table. CSV exports include coverage columns and an unavailable row where a table could not be compared. Complete native receiving retains the original source editions and all saved statement versions.

Typed carbon amounts compare by their exact scaled values, and civil dates compare by their original day. Equivalent source formatting and changes in which fields are reported remain in `sourceDifferences`, with all raw before/after values retained. An API-omitted contract identifier is an unavailable field. Instrument metadata updates remain explicit; source-reported year 0001 and zero total-vintage placeholders carry a source note, while the separate retired VCU and allocation amounts retain their original values.

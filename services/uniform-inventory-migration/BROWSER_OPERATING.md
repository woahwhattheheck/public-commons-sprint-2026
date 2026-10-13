# Uniform and inventory migration workspace

This application receives complete original CSV exports and actual returned target exports, reviews explicit field mappings, records explained cell corrections and reconciles the selected records. The browser and command line share one exact-data engine.

## Open the operator

Build the complete standalone application from this directory:

~~~sh
node build-standalone.mjs --out /absolute/new/Uniform_Migration_Workspace.html
~~~

Open that HTML in a current browser. Its complete engine, styles and operator are inside the file. It makes no network requests. Keep working files in the customer's authorised working location. A complete current workspace can also be embedded at build time:

~~~sh
node build-standalone.mjs --workspace /absolute/current/workspace.json --out /absolute/new/Uniform_Migration_Workspace.html
~~~

The output must be a new file. The builder preserves an existing destination. For the complete command-line workflow, use README.md and cli.mjs.

## Receive and map the original sources

1. In **Source files**, choose a dataset and either **Original source** or **Returned target**. Receive a complete UTF-8 CSV. The importer keeps the original text, original headings, every data cell, source identity and import edition.
2. Review the full original file using search and record pages. The page displays50 records at a time; original downloads and the full workspace contain every record.
3. In **Field mapping**, select an imported edition and choose original columns for the exchange fields. Column numbers distinguish duplicated headings. The suggested unique exact-name matches remain editable; **Save and select this mapping** explicitly makes that edition current.
4. Receive and map the corresponding actual returned target export separately. Continue for each dataset in the migration scope.

Eight exchange domains are supplied: locations, wearers, products, quantity entitlements, stock, issues, returns and assets. The empty CSV templates document these fields. They contain no customer records.

IDs remain exact strings, including leading zeroes and significant whitespace. Product and transaction units remain explicit. Quantity comparisons use exact nonnegative decimal arithmetic. The engine never applies a guessed conversion, price or platform allowance rule.

## Review findings and corrections

**Reconcile complete workspace** checks every selected row, required value, identifier, referenced domain, unit and applicable date. It detects duplicate identifiers and location cycles, matches source and target by the selected domain key, compares all canonical fields and pairs otherwise unmapped columns by original heading and occurrence. A changed unmapped value remains visible.

Returns are grouped against their original issue. Only complete valid rows with compatible units contribute to a confirmed sum. An ambiguous issue or an invalid return remains incomplete; a total greater than its issue quantity is a finding.

The screen provides the full finding list with search and paging, original column coverage, source-record navigation and exact-key inspection of target comparison. Download the complete JSON report to retain all original cells and findings. A reconciled result describes the selected data and mappings. Operational acceptance also uses the prime's actual native import results and agreed cutover observations.

To resolve a source value, open its original record, choose **Edit cell**, select its original column, enter the exact replacement, reason and reviewer, then save. The correction becomes an attributed revision; the original file stays available. Later mapping selections keep every earlier mapping. Corrected CSVs are separate outputs.

The application compares the selected stock snapshots. It does not calculate a closing balance from an unspecified or incomplete transaction period. Financial allowances and vendor-specific configuration remain with their actual approved platform contract.

## Save, hand over and continue

**Save working HTML** downloads a complete editable file with a new independent working-copy identity. Open that exact download to continue the same logical project independently. Every source, mapping, correction and operation travels with it. The JSON workspace is the same engine's sealed portable format and can be received through the browser or CLI.

**Prepare full handover** creates all original and corrected CSVs, canonical selected source/target CSVs, the complete reconciliation, full history, workspace JSON and manifest. Download the ZIP to receive ordinary complete files together, or download any member individually. The JSON handover also retains every member's full text. The manifest gives byte counts and SHA-256 identities.

**Receive as an independent working copy** validates the incoming complete workspace, downloads the current working HTML, including uncommitted review text, first, then opens a new browser copy. **Create independent workspace** similarly saves the current project before creating a separately identified migration.

Browser persistence compares the actual stored revision in one IndexedDB transaction. If another tab saved first, the current and competing complete versions remain available. Uncommitted correction and mapping drafts survive navigation and validation errors and travel in saved working HTML. Save a new working HTML to continue independently. When browser storage is unavailable, downloaded-file mode keeps edits in memory and asks you to save; closing a changed unsaved copy prompts the browser's standard confirmation.

CSV tools must preserve identifiers as text when files are opened in spreadsheets. Original CSV downloads reproduce the source text; corrected/canonical CSVs deliberately preserve exact field values.

## Limits and operating scope

Each original CSV is at most32MiB,100,000 data records and512 columns. The complete portable workspace is at most128MiB, including all original text, parsed records and history, and can retain128 sources and10,000 operations. Agree the actual source populations and number of retained editions before starting. These limits describe the complete retained project, rather than an allowance to fill every domain independently to every maximum.

The browser ZIP builder supports complete archives up to512MiB. Larger complete source programmes can use the CLI's ordinary-file handover and explicit separate migration scopes, each preserving its original history.

## Actual product receiving

Use the original equipped programme's browser and receiving directory. The companion run_browser_receiving.mjs exports a callback accepting that existing page/context; it creates no independent browser controller. It operates the exact generated application at1440px and390px widths, receives all eight datasets on both sides, reviews mapping and a real computed return finding from explicitly labelled receiving-example data, saves a correction, compares the corrected returned target, downloads the complete originals/report/ZIP, receives the workspace and independently continues a saved HTML copy.

Before presenting this app or any attachment to a prospect/customer, the responsible producer must personally open, render, LOOK at and operate that exact outgoing version. Actually view its desktop/narrow screenshots, full loaded/empty/error states and important controls. Open every produced attachment in its ordinary viewer; inspect the ZIP's usable contents, complete source files and independently reopened project. Fix concrete usability and behaviour defects within the original workflow. The source exercise and static review support this work; record the actual viewed version and meaningful receiving edit.

This is the standing direct Bryce rendered-product and all-attachment instruction. Carry it into downstream operating guides and delegated assignments. It creates no new approval queue or controller.

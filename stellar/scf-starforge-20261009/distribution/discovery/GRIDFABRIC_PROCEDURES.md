# GridFabric customer Operating Plans

Use one saved procedure to carry a customer's Plaid configuration, measurement sources, report mapping, callback and event history, dispatch outcomes and complete delivery through the installed GridFabric product.

The procedure uses the existing Operating Plans model and browser. Its native capture reads the original authenticated GridFabric SDK and retains the complete selected responses, dependent pages and file bytes. The original GridFabric application continues to own SQLite, callbacks, dispatch, export and restoration.

## Browser workspace

Open **Customer procedures** from the existing GridFabric console. The screen uses that application's private connection and the same Operating Plans model. Its five sections carry the work from preparation through customer receiving:

1. **Plan and steps** prepares the nine-step procedure, saves customer edits as revisions, attaches complete output files, and exports editable JSON or readable HTML/Markdown. Earlier revisions remain available.
2. **Original records and files** pages through the native collections, shows complete records and selects their retained files. Review the workspace revision explicitly before capturing.
3. **Capture and saved requests** saves the exact input, catalog, complete plan, request UUID and capture time in the browser before dispatch. It receives the full capture through an SDK connection to the running application. The application keeps its own durable request and attempt history.
4. **Compare reports and outcomes** compares original quantities, source gaps, mapping parameters, actual recorded outcomes and saved procedure changes. It reads both complete captures before deriving a comparison.
5. **Receive and return** reopens a complete capture archive or receives a returned editable plan. Compatible histories extend the same plan; divergent histories can be received as separate copies. Save or download an edited draft before receiving another history.

After a lost response, open the saved request and choose **Read this original outcome**. A retained incomplete request offers explicit continuation with the same UUID and frozen body. A separate capture receives a new UUID after the earlier attempt has been reviewed. The native request history is paginated: list pages show compact saved metadata, and opening an individual request reads and checks the complete capture.

The browser saves complete drafts, requests and imported archives in IndexedDB for its current origin. If saving fails or another page has advanced the same record, the entered work stays on screen with a backup download option. The backup retains plan histories, entered drafts, raw command text, original requests and prior bindings. Small archives can travel in the backup; larger ones retain explicit original-file declarations so the other entered work can still be saved. Keep each declared archive file alongside the backup.

Receive a browser-work backup to preview its same-workspace join. Compatible work can merge; conflicting drafts, histories or request bodies remain separate. A separate recovery journal preserves both versions and can be selected again later. Reselect any externally declared archive file before resuming its import. Restored requests require reading their original native outcome before another POST. The connection token stays in the current browser session.

A capture archive includes the original selected workspace identity and full plan history. Receiving it permits inspection and plan continuation; live capture still requires an explicitly selected input for the connected source and workspace. Native device actions and dispatch remain available in the main GridFabric console.

## Install and open

Build the maintained merchant workspace with the `gridfabric-plaid` source selection, following [Energy operations](../../../../products/energy-operations/OPERATING.md). This selection includes the original GridFabric product, Command finder, Operating Plans and the procedure command.

Open the existing customer workspace in **Applications → GridFabric Plaid**. Use the original private connection file belonging to that running application. Read the instance ID from its original configuration. The command opens an authenticated SDK connection to that owner and releases only its own connection when finished.

Generate a complete editable procedure input:

```sh
starforge gridfabric-procedure input \
  --connection-file /private/customer/gridfabric-console.url \
  --id customer-grid-operations \
  --title 'Customer Plaid operating procedure' \
  --instance CUSTOMER_INSTANCE_ID \
  --customer 'Customer name' \
  --owner 'Operating owner' \
  --period 'Agreed operating period' \
  --out /private/customer/procedure-input.json
```

The command reads the actual workspace identity, source SHA-256 and revision, then reads the selected instance. It requires that revision to remain stable across those reads. The resulting JSON includes the selected instance as the configuration record.

All output paths are new. Keep the input alongside the saved plan so its complete original selections remain available.

## Select the work and original results

Edit `procedure-input.json` using the actual record and file identities returned by GridFabric. Keep its workspace and source binding.

| Input | Meaning |
| --- | --- |
| `workspace` | Original workspace ID, absolute directory and native source SHA-256 |
| `expectedRevision` | The reviewed native revision to capture |
| `instanceId` | Original Plaid instance |
| `records` | Original collection/ID selections, each assigned to a procedure step |
| `files` | Original SDK `file_SHA256` or `export_UUID` selections, each assigned to a step |
| `stepResults` | Explicit operator assessments: step ID, planned/in-progress/completed/skipped, and a complete explanatory note |

There are nine stable procedure steps:

| Step ID | Customer work | Useful original records |
| --- | --- | --- |
| `workspace` | Reopen the bound native workspace | Original launch, source and state are captured automatically |
| `configuration` | Check deployed contract and configuration | instances, instance_editions |
| `sources` | Review measurements and corrections | sources, source_rows, source_issues |
| `mappings` | Review and activate report definitions | mappings |
| `callbacks` | Inspect native callback/response history | callbacks, callback_deliveries |
| `events` | Review intervals, targets and opt decisions | events, event_revisions, distributions, opt_decisions |
| `dispatch` | Reconcile original provider/device work | management_operations, management_receipts, device_actions, operations |
| `reports` | Inspect original report calculations | reports, report_rows |
| `delivery` | Transfer the complete customer workspace | Select the actual retained export file returned by GridFabric |

A record selection has `stepId`, `collection` and `id`. A file selection has `stepId` and `fileId`. Reuse the same identity across different steps when that original record is relevant to both. The input accepts up to 500 explicit references. Related source/report/callback/history pages and native file dependencies are received completely.

The capture reads records from the bound workspace. Select records belonging to the intended instance and retain the complete sources that explain them. The original GridFabric domain guide defines source, mapping, event and dispatch relationships.

A successful read leaves the saved step status unchanged. The operator's `stepResults` supplies any new assessment. Each note remains in the recorded plan result; the complete native status and response stay in the capture. For example, an adapter's ACKNOWLEDGED status retains its original HTTP meaning, and a management PROCESSED result retains its distinction from later VTN outcomes.

The native revision can advance as callbacks arrive. Review the new state and update the input's revision when appropriate. An inconsistent capture exits with the original error; it does not silently select a different revision.

## Prepare and edit the customer procedure

```sh
starforge gridfabric-procedure prepare \
  --input /private/customer/procedure-input.json \
  --out /private/customer/gridfabric-plan.json

starforge discover serve --port 4311
```

Open the returned Command finder address, choose **Operating Plans**, and import the complete `gridfabric-plan.json`. The saved plan contains the original installed `gridfabric-plaid` command registration, its source declarations and declared runtime groups.

Edit the customer instructions, owners, expected outcomes and period in that workspace. Keep the nine stable step IDs and each step's structured workspace binding. Save a revision, export the complete JSON, and use that export as `--plan` for the next capture. The preparation keeps all steps planned until an explicit operator assessment is captured or the operator edits their statuses in Operating Plans.

The installed browser provides the original complete revision history, comparison, fork and return workflow. Retain the same browser origin/port when reopening its local saved plans.

To use a separately retained installed catalog, pass `--catalog /absolute/complete-catalog.json` to prepare or capture. Produce that complete catalog with `starforge gridfabric-procedure catalog --out /absolute/complete-catalog.json`. It reads the same installed Command finder catalog and retains its source and runtime declarations. Command finder search exports use their original search-results schema.

## Capture the native work

```sh
starforge gridfabric-procedure capture \
  --connection-file /private/customer/gridfabric-console.url \
  --input /private/customer/procedure-input.json \
  --plan /private/customer/gridfabric-plan.json \
  --out /private/customer/capture-2026-10-13
```

Omit `--plan` to prepare the original plan and then append the captured result. Supplying a plan preserves every earlier revision and appends the new recorded result through the same Operating Plans model.

Capture checks the original workspace/source binding and reviewed revision, reads complete raw responses, follows dependent collection pages, receives selected and referenced native files, and checks the source and state again. Every saved original body and file has its complete byte count and SHA-256. The command also receives the installed native source members declared by the original server, verifies their complete bytes against that declaration, and includes them in the customer capture. Run it from the matching installed GridFabric toolkit on that operating host. A native result is never replaced by an inferred dispatch or report outcome.

The output includes the complete normalized procedure input, catalog, all plan revisions, readable HTML and Markdown, original native response/source material, selected record history and files, and `capture.json`. The capture manifest names the complete saved members. Plan results point to this manifest instead of squeezing full source rows into the original 32,000-character step field.

The new capture uses an exclusively created private directory. Its completion manifest is committed last after all declared members are durable. An interrupted directory remains available for inspection; the reader requires the complete committed capture. A pre-existing destination is retained; choose a new path for another capture. Credentials from the connection file remain with the original connection and are excluded from the delivered input.

## Receive and continue

```sh
starforge gridfabric-procedure show \
  --directory /private/customer/capture-2026-10-13
```

`show` reopens and checks every declared member of the frozen capture. The receiving host can inspect it without running the customer GridFabric workspace.

Open its readable plan, then import its complete plan JSON into Operating Plans. The full history extends an identical earlier history. Divergent edits remain available through the original Operating Plan returns workflow:

```sh
starforge discover plan-return --help
```

For live continuation, receive the selected complete native export through GridFabric's original restore/receiving commands. Keep the full installed product archive and customer files with the procedure. The native product's restored identity, source and complete records remain the authority for the next capture.

Readable editions can also be created from any retained plan JSON:

```sh
starforge gridfabric-procedure render \
  --plan /private/customer/gridfabric-plan.json \
  --format html \
  --out /private/customer/gridfabric-plan.html

starforge gridfabric-procedure render \
  --plan /private/customer/gridfabric-plan.json \
  --format markdown \
  --out /private/customer/gridfabric-plan.md
```

## Transfer one complete capture archive

The browser can download a complete capture as `.gridprocedure.jsonl.gz`. The archive contains every declared capture member, its complete file bytes, source material and plan revisions. Each file is streamed in chunks, and the receiver checks the compressed file identity, member lengths and hashes, archive footer and original capture graph.

The same archive operations are available from the installed command:

```sh
starforge gridfabric-procedure archive \
  --directory /private/customer/capture-2026-10-13 \
  --out /private/customer/GridFabric_Procedure.gridprocedure.jsonl.gz

starforge gridfabric-procedure receive \
  --archive /private/customer/GridFabric_Procedure.gridprocedure.jsonl.gz \
  --sha256 ARCHIVE_SHA256 \
  --bytes ARCHIVE_BYTES \
  --out /private/customer/received-gridfabric-procedure

starforge gridfabric-procedure show \
  --directory /private/customer/received-gridfabric-procedure
```

Use the archive's returned `sha256` and `bytes` as the receiving declaration. Keep those values with the delivered file. Export and receiving use new private destinations; an incomplete destination remains available for inspection. They use the same native capture reader and do not need a running GridFabric workspace.

The command streams file content and supports archives larger than the browser's in-memory import allowance. Expanded receiving defaults to 16 GiB. For a larger known customer delivery, supply `--maximum-expanded-bytes` with an explicit positive byte allowance. The running server's compressed upload allowance follows its existing `maximumPortableBytes` setting, which defaults to 4 GiB.

Where the browser supports choosing a writable destination, archive download streams to that file. Its length is checked before the file is committed, and the sender's SHA-256 remains available with the download. The in-memory browser download fallback and local import hashing use a 64 MiB allowance. For a larger browser import, enter the sender's full SHA-256: the browser retains the selected File and frozen request before streaming it to the existing server importer, which verifies the entire archive. This preserves the server's configured upload allowance without allocating a whole-file browser buffer. If browser storage cannot retain the file, use the installed `receive` command above, then open the received readable plan or its complete editable JSON. The native archive receiver checks the full file and capture contents during receiving.

The procedure archive's member layout and receiving rules are distinct from GridFabric's database export. Use the main product's native workspace export and restore when transferring the operating database itself.

## Application API

Import the pure procedure model from `@tokenjunkielabs/starforge-merchant/operator/gridfabric-procedure` and native capture from `@tokenjunkielabs/starforge-merchant/operator/gridfabric-procedure/native`.

- `inspectGridFabricProcedureInput(input)` validates the complete selection.
- `prepareGridFabricProcedure({catalog,input,savedAt})` returns the original complete Operating Plan.
- `recordGridFabricProcedure(plan,capture,{input,savedAt})` returns that plan with a new saved revision.
- `captureGridFabricProcedure({client,catalog,input,outputDirectory,savedAt,plan})` reads an already connected original SDK client and returns the complete capture and plan.
- `readGridFabricProcedureCapture(directory)` receives a frozen capture.

Import streaming archive operations from `@tokenjunkielabs/starforge-merchant/seller/gridfabric-plaid/procedure-archive`:

- `exportGridProcedureArchive({directory,outputFile})` streams a checked capture to a new gzip archive and returns its complete byte count and SHA-256.
- `receiveGridProcedureArchive({file,outputDirectory,expectedSha256,expectedBytes,maximumExpanded,maximumMembers})` receives a new private capture directory and returns the original complete capture result plus the archive identity. The optional limits default to 16 GiB expanded bytes and 1,000,000 members.

The application embedding capture owns its client lifecycle. The capture function borrows that client and leaves its original owner running. The CLI creates and closes only its own SDK connection.

## Original source references

- [Operating Plans](OPERATING_PLANS.md)
- [Operating Plan returns](OPERATING_PLAN_RETURNS.md)
- [GridFabric operator](../../sf30-seller-sdk/gridfabric-plaid/README.md)
- [GridFabric domain engine](../../sf30-seller-sdk/gridfabric-plaid/DOMAIN_OPERATIONS.md)
- [Original typed SDK and MCP](../../sf30-seller-sdk/gridfabric-plaid/SDK_MCP.md)
- [Energy product operating guide](../../../../products/energy-operations/OPERATING.md)


## Compare a source correction with the earlier report

Use **Compare reports and outcomes** after the original reporting workflow has prepared a revised response. The useful question is: which reported intervals changed, which source gaps remain, and which mapping or operating decisions explain the difference?

1. In **Capture and saved requests**, open the earlier and later complete captures, or receive their complete archives in **Receive and return**. Select captures from the same original workspace and Plaid instance.
2. Open **Compare reports and outcomes**. Select the before and after requests. A request UUID may also be entered directly when it is on another history page.
3. Choose **Read both original captures**. The existing authenticated reader receives every original capture member. A restored browser response alone is insufficient.
4. Choose the report on each side. Captures with more than one report require an explicit report choice. Choose **Compare selected reports**.
5. Review source gaps and the before/after original quantities, then open the mapping parameters, calculation details, source rows and quality information. The interval table pages through all results; JSON and HTML downloads retain every row.
6. Review retained device/management outcomes and customer procedure changes. Use the original main console or Operating Plans editor for any subsequent operating decision.

Intervals match by original report specifier, rId and timestamp. A quantity difference is **after minus before**, using the exact decimal strings already calculated and rounded by the original GridFabric engine. It appears only when device, channel, kind, unit, aggregation, time basis and effective interval period match. Different units or semantics stay visible without a numeric subtraction. The comparison performs no new aggregation, unit conversion, energy-saving estimate or causal analysis.

A **source gap resolved** means the same measurement changes from NEEDS_SOURCE to READY. A change to a different unit, device or period is identified as changed semantics even when its new report is READY. Missing values are never zero-filled. A row selected on only one side does not establish creation, deletion or zero activity in the operating workspace.

READY means the original report response was prepared. VTN acceptance remains a separate original management outcome. An adapter's ACKNOWLEDGED status retains its original HTTP-success meaning and complete response. Changed source precedence, correction links and quality flags remain visible even when rounded quantities are equal.

### Keep and reopen the complete comparison

Download the **full comparison JSON**, **readable comparison report** and both **complete capture archives**. The JSON retains all selected original records, full plan histories, mappings, source metadata and comparison choices. Original binary files and raw responses remain in the two archives.

On another receiving host, import both archives through the existing native receiver. Open the full comparison JSON in the comparison tab, read the two received original requests, and explicitly reopen the comparison. The result is re-derived from both complete originals and must match the saved JSON in full. An HTML report is readable on its own; exact source verification and continued comparison require the JSON and both archives.

Comparison selections and an imported comparison are included in the existing complete browser-work backup. A cold page must read the original captures again. Prior imported comparisons can be retained in that backup while starting another selection. Editing a capture or report choice removes the displayed old result immediately.

### Native comparison and exact receiving

The same comparison model is available through the installed command. Both directories are received by the original full capture reader before any comparison is exported.

```sh
starforge gridfabric-procedure compare \
  --before /private/customer/before-capture \
  --after /private/customer/after-capture \
  --before-report ORIGINAL_BEFORE_REPORT_ID \
  --after-report ORIGINAL_AFTER_REPORT_ID \
  --format json \
  --out /private/customer/GridFabric_Report_Comparison.json

starforge gridfabric-procedure reopen-comparison \
  --comparison /private/customer/GridFabric_Report_Comparison.json \
  --before /private/customer/before-capture \
  --after /private/customer/after-capture \
  --format html \
  --out /private/customer/GridFabric_Report_Comparison.html
```

Omit a report flag only when its capture contains at most one report. Output destinations are new files. Comparison opens neither a GridFabric workspace nor an authenticated borrower; it uses the two previously captured directories.

The typed pure API is exported at `@tokenjunkielabs/starforge-merchant/operator/gridfabric-procedure/comparison`:

- `compareGridFabricCaptures(before,after,{beforeReportId,afterReportId})` receives two results from `readGridFabricProcedureCapture` and returns the complete derived comparison.
- `receiveGridFabricComparison(saved,before,after)` re-derives and checks the complete saved comparison.
- `renderGridFabricComparisonHTML(comparison)` renders every interval and retained operating context.

The native capture includes the current comparison helper with the original source members. The reader also accepts the exact earlier helper roster, so already-delivered captures remain usable.

### Inspect the exact outgoing product

Run the original receiving operation with the actual customer or explicitly labelled engineering example captures. Use the existing authenticated browser owner and the additive `receiveGridFabricComparisonBrowser` course. The course downloads and reopens the complete comparison, checks original capture identities, reloads the browser's retained selection, saves desktop and narrow populated views, and opens the exact downloaded HTML for inspection.

Before calling the outgoing product ready, the producing operator must **look at the actual desktop and narrow screenshots or screen**. Check quantities/units, source-gap interpretation, mapping details, navigation, selected-report controls, downloads and the cold reopen. Preserve the actual screen observations with the original receiving outcome. Source-level examples establish arithmetic and source joins; the receiving result records the actual rendered run.

See [comparison browser receiving](GRIDFABRIC_COMPARISON_RECEIVING.md) for the existing-owner invocation and complete handover.

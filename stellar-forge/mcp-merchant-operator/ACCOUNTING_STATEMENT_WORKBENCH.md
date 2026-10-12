# Customer closing workbench

Maintain customer records and service captures, then prepare, review, issue, and retrieve customer statements in the existing merchant accounting workspace. The workbench uses the original statement client, durable customer operations, and closing-cycle engine. It preserves each prepared review, original request, retained statement, and complete customer delivery folder.

## Open from the installed merchant application

The maintained merchant receivables package includes **Customer statements** in Applications. It uses the existing merchant MCP host and its configured accounting workspace.

In the Runtime workspace, attach the installed merchant runtime, open **Applications**, choose **Customer statements**, and enter the private customer closing folder, original merchant MCP address, accounting workspace alias and operator name. Choose the existing access-token environment variable and the private environment file when one is used. Keep the secret value in that file or the original host environment.

Review and save the application, then **Start** and **Open**. The original Applications operation retains the selected command and opening address. Use its normal stop and reopen controls. The same saved-work folder preserves prepared customer changes, closing cycles and customer downloads across restarts.

The installed command is:

~~~sh
starforge customer-closing \
  --directory /absolute/customer-closes \
  --url http://127.0.0.1:8787/mcp \
  --workspace accounting \
  --actor operator \
  --port 4419
~~~

Use port 0 to let the operating system choose a listener. The command prints the selected local address. Its structured startup also binds that address to the same directory, merchant connection, workspace, operator and requested port for Applications.

The maintained merchant receivables source selection includes this workbench and the same browser manifest consumed by its HTTP server. The original source builder packages the declared HTML, styles and all three browser modules together. Typed package interfaces are available under merchant/customer-closing, merchant/customer-closing/cycles, merchant/customer-closing/customer-dossiers, merchant/customer-closing/operations and merchant/customer-closing/client.

## Start the workbench

Use the Node runtime and source tree already installed for the merchant operator. Start the original merchant MCP service with its accounting workspace and service source aliases configured.

Create a private directory owned by the operator:

~~~sh
install -d -m 700 /absolute/customer-closes
~~~

From the repository root, run:

~~~sh
node stellar-forge/mcp-merchant-operator/accounting-statement-cycle-server.mjs \
  --directory /absolute/customer-closes \
  --url http://127.0.0.1:8787/mcp \
  --workspace accounting \
  --actor operator \
  --port 4419
~~~

Open the local address printed by the command, normally http://127.0.0.1:4419.

The merchant token stays in the server environment. The default variable is MCP_ACCESS_TOKEN; use --token-env with the existing configured variable name when different. The workbench binds to loopback. A local browser connects to the workbench, and the workbench connects to the original merchant service.

Browser drafts are scoped to the original merchant connection, workspace and saved-work directory. Restarting the same workbench restores its drafts without mixing another merchant's work.

The directory holds saved closing cycles and the customer-operations folder for reviewed customer changes. Use the same directory after restarting the server. A prepared CLI cycle can also be copied as an intact child directory here and opened from Saved cycles. Preserve its private ownership and permissions. Open it with its original merchant URL and workspace.

## Set up customers and service

Open **Customers and service**. The four sections use the same merchant workspace as the closing-cycle screens.

### Customer records and assignments

Create a customer with a stable reference, name, and optional email, postal address, and internal note. Existing customers open through **Edit** in the directory. **Review customer** saves the exact proposed profile before any merchant write. Review the displayed values and choose **Apply changes**.

The directory, statement filters, and assignment form use the original customer identity. Profile edits retain the originally opened customer version; another operator's intervening changes require a new review. After a confirmed save, the open form adopts the saved customer identity and current version while preserving any further unsaved field edits.

For assignments, choose a customer and paste one original order reference per line. An optional second tab-separated column supplies the customer-facing description, so a two-column spreadsheet can be pasted directly. Select a completed accounting run when you want to compare those references with its native purchase events. The comparison reads the complete retained report through its original file hash and shows the current customer assignment for every reference.

**Review assignments** saves the normalized original references, descriptions, selected customer, and original revision. Moving an order from another customer requires the explicit reassignment choice and a reason. The native writer retains the prior assignment history. Assignment review can also be used before an order appears in the selected accounting run; the statement compiler later determines which original purchases belong in the chosen close.

### Original service captures

The merchant host declares its original capture files under the selected workspace's `statementUsageInputs` configuration. **Refresh sources** reads the actually configured aliases from that workspace.

Choose a source and select **Inspect capture**. The screen shows its original capture time, order count, and source format. Its exact source identity is retained under Capture identity. Name the imported capture, select **Review import**, and apply the saved request.

The native import uses the inspected source hash. If the configured file changes before import, inspect and review its current contents again. Repeating an import of the same original file reuses that retained capture. The Imported captures table distinguishes capture time from import time, and the same captures appear immediately in the cycle's opening and closing choices.

### Issued statements

Filter issued statements by customer or lifecycle status. **Open statement** reads the complete original statement JSON, current native record, and all history pages. Every original customer file can be downloaded from that view.

**Prepare correction** adds the original customer, run, captures, settlement bounds, and replacement reference to the cycle composer. Choose the current sources, review the complete replacement, and issue it through the existing cycle engine. The original native statement lifecycle records the correction.

**Withdraw this statement** requires a reason and prepares a saved withdrawal request for review. Applying it uses the native revision guard and retained withdrawal history. The original statement files remain available after correction or withdrawal.

### Resume saved customer changes

**Saved changes** lists every prepared customer operation and its recorded outcome. The same directory survives browser or server restart.

| Action | Result |
| --- | --- |
| Apply changes | Reconciles the original native records, then applies the saved request when required |
| Continue saved changes | Resumes that same request after an interrupted response |
| Check saved result | Reads and reconciles the original effect without sending the mutation |
| Edit these changes | Opens the current customer/source records and prepares a separate revised request |

Matching preparation retries reuse the original private request. Interrupted preparation completes the missing initial state without replacing a saved request. Progress reads observe atomic state files without taking the writer lease.

Customer mutations and cycle issuance run in one workbench queue. Each request retains the native optimistic revision guard, so an intervening merchant change still requires fresh review. Review preparation and complete statement inspection remain available while an existing write runs.

The equivalent maintained CLI commands are `prepare`, `execute`, `reconcile`, and `observe --dir PRIVATE_OPERATION` in accounting-statement-cli.mjs. The underlying request and state formats are unchanged.

## Prepare the customer work

The workspace inventory lists original customer profiles, assigned orders, completed accounting runs, service captures, and retained statements. Refresh workspace reads the complete inventories, including every run page. If the workspace changes during a paged read, refresh once the active operation finishes.

1. Name the cycle.
2. Choose a completed accounting run and, when applicable, closing and opening service captures.
3. Find and select customers, then choose Add selected customers.
4. Adjust the source choices for individual customer rows. Add another period creates another row for that customer.
5. Use Review this statement to inspect a complete current preview.
6. Choose Prepare all reviews to save every customer review before issuing any statement.

The preparation request remains the same when the browser retries. Editing the selections creates a new preparation identity. The original engine resumes an interrupted preparation from the customer reviews already saved.

### Choose the right source period

| Selection | Result |
| --- | --- |
| Completed run without a service capture | Purchase statement from the original accounting run |
| Closing capture without an opening capture | Cumulative service position at that original capture |
| Opening and closing service captures | Original service-period comparison, including carried reservations, recovered results, and unit movements |
| Settlement from/until bounds | Purchase-row filter within the accounting run; enter both bounds in UTC |
| A retained statement under Correct a retained statement | A correction tied to that original statement |

The capture choices show source creation time. That is the time of the original service capture, rather than its later import time. A customer-period row must use the customer's own original source records. The merchant compiler checks customer assignments, source identities, and period compatibility.

## Review the complete statement

The review shows the customer and reference, purchase and service order counts, reconciliation needs, quoted merchant totals, and the original service-period balances when present.

For service periods it includes:

- Opening and closing purchased, consumed, reserved, and available units.
- Period admission, consumption, release, reserved changes, recovered results, and carried reservations.
- Every original route and service call, with table pagination.
- Purchase orders, excluded rows, asset totals, and complete original row detail.

Source identifiers, exact timestamps, and hashes remain available under the source details. Download review JSON retains the complete original preview document.

Prepared cycle reviews are read from the saved review files. The engine checks the complete review and its original selection before statement retention.

## Issue or resume the cycle

Open Saved cycles and select a prepared cycle.

| Action | Behavior |
| --- | --- |
| Issue reviewed statements | Reconciles original requests, retains unchanged reviewed statements, and completes their customer packets |
| Resume closing cycle | Continues the original requests and completes the remaining retention or file delivery |
| Continue preparing reviews | Resumes the saved preparation until every review is available |
| Refresh delivered statements | Reconciles the same retained statements and updates their current status snapshots and delivery indexes |
| Prepare changed rows | Starts a new review for rows whose sources changed after the earlier review |

Each customer's progress remains visible while the cycle runs. The progress reader observes saved atomic customer states without competing for the cycle writer lease. Customer setup mutations and statement issuance jobs against the same workspace execute in sequence. Review preparation starts immediately and saves the original request before opening its merchant connection. Closing the browser leaves the server operation running.

If the server is stopped, restart it with the same directory and workspace and open the saved cycle. Resume uses the original stable request IDs and retained statement identities. A source change that invalidates a review remains visible on that customer row; select the appropriate current records and prepare the changed row again.

The workbench does not close the merchant accounting workspace when it stops. It disconnects its own connection and retains the saved closing-cycle files.

## Retrieve and hand over the files

### One packet for a customer with several passes or periods

Open a saved cycle and use **Customer handover**. This section groups every original statement row by its customer identity. Find a customer by name or reference, or search for a saved pass or statement number. The list shows 25 customers per page; opening a customer's details shows every one of that customer's original rows.

Choose **Download customer packet** to prepare and download one archive for that customer. **Prepare preview** makes the same saved packet available through **Open customer packet** and its download link. The packet includes:

- A readable index with the customer's pass, period and statement register.
- `statements.csv`, `periods.csv` and `dossier.json` for the same original rows.
- Each completed statement's original customer delivery files in its own `statements/<statement UUID>/` folder.
- The saved statement lifecycle, including corrections, superseded statements and withdrawals.

Extract the archive and open `index.html`. The links stay relative to that extracted folder, so the complete packet can be reopened on another computer. Each statement keeps its own service period, purchase amounts and source files. The customer register does not combine separate statement periods into a new accounting statement.

A customer with unfinished rows has **Download available statements**. Its register lists both the included packets and the rows that still need completion. Resume the original closing cycle to finish those rows, then prepare the customer's completed packet. A customer with no completed delivery files shows its current progress until a statement packet becomes available.

The handover reflects the original cycle's saved status files. **Refresh delivered statements** retrieves later corrections and withdrawals through the existing statement engine. After that refresh, prepare the customer packet again to include the new saved status. Earlier customer packets remain reopenable with the status they contained when prepared.

Repeated preparation of unchanged statement and status files reuses the same saved packet. Concurrent requests for that customer share the in-progress export. Customer exports in one cycle run in sequence under the original cycle lease; a queued closing operation continues after an existing export finishes. The saved packet has its own immutable source identity and can be read after a workbench restart without rewriting the cycle.

The workbench retains these customer packets under its private `.customer-dossiers/` directory. The downloadable archive contains only that customer's register and listed statement delivery files. The original cycle request, merchant connection settings, other customers, operator states and private export ownership file stay in the operator's saved-work directory.

### Individual statement and operator downloads

Each completed statement row still provides **Open packet** and **Download**. This download contains that one statement's complete original customer files, its service-period captures when selected, and its saved statement-status snapshot. The gzip-compressed tar archive has its index at the archive root.

**Download complete cycle** preserves the full operator folder: frozen request and manifest, every saved review, customer state, register, and available complete or partial delivery files. Extract it as a private child directory under the workbench's saved-cycle directory to continue the same work. Open `register.html` for the cycle's delivery register.

**All saved files** also provides individual operator downloads. The original cycle archives and files are read while holding the cycle lease. Saved customer handover downloads read their immutable snapshot and check each file's recorded size and content hash during streaming. If an original customer file needs recovery, resume its cycle and prepare the customer packet again.

Use the grouped customer packet for delivery across that customer's passes and periods. Use the individual statement packet when delivering one statement. The complete-cycle download is the operator's collection across all selected customers.

## Original engine and client

See [Customer statement cycles](ACCOUNTING_STATEMENT_CYCLES.md) for CLI preparation, execution, inspection, and read-only observation.

The workbench imports:

- prepareAccountingStatementOperation
- runAccountingStatementOperation
- observeAccountingStatementOperation
- prepareAccountingStatementCycle
- runAccountingStatementCycle
- observeAccountingStatementCycle
- inspectAccountingStatementCustomerDossiers
- exportAccountingStatementCustomerDossier
- readAccountingStatementCustomerDossier
- connectAccountingStatementClient
- accountingStatementSelection
- accountingStatementPreview

The server exports startAccountingStatementCycleWorkbench for installed local applications. It accepts the existing client when the application already owns one and leaves that supplied connection under its caller's control.

## Plan the next service close

Open **Plan service close** to group original native captures by customer and purchased pass, inspect current periods, gaps and corrections, and select exact opening and closing captures across many customers. Review or download the complete plan, then prepare the original saved cycle and continue its existing review, issuing, recovery and handover workflow. See [Plan customer service close](ACCOUNTING_STATEMENT_SERVICE_PLANNER.md) for the complete operator guide and native, typed and command-line contracts.

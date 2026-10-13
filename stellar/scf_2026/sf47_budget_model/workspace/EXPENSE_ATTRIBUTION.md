# Issued buyer expenses in Grant Operations

Grant Operations can retain a complete issued Buyer Expenses source, carry its accepted accountant references forward, and allocate each original expense or credit to the work packages in the selected operating case. The allocation records, review history and original source files travel together in the existing Operations export.

Open a saved plan, choose **Delivery operations**, select its operating case and choose **Buyer expenses**. This is the same workspace, case version, transaction journal and operator identity used by the other Operations panels. Headless commands and the typed client use the same methods.

## Choose the complete financial source

The receiver accepts two original formats:

| Source | Contents used by the receiver |
| --- | --- |
| Issued Buyer Accountant source JSON | `stellar-forge.buyer-accountant-source.v1`: the original buyer workspace, immutable issued close, selected allocations, credits and original source captures. |
| Complete Buyer Expenses Accountant delivery ZIP | `stellar-forge.buyer-expense-export.v1`: the same issued close together with bookkeeping history and every original returned accountant packet referenced by that history. |

Use the source exported by the original buyer workspace. A later accountant edition belongs to the same original issued close and extends its accepted bookkeeping history. Keep the original file bytes when moving the source between machines.

The ZIP reader checks its exact manifest, member lengths and SHA-256 values before inspecting the original source and returned accountant packets. It reads the original accountant schemas through the existing Node modules. Select a complete source of at most 8 MiB; the same limit also applies to the total expanded ZIP members. The reader accepts at most 1,200 plain file members.

A statement screenshot, a CSV of manually reconstructed amounts or an individual accountant return does not provide the complete issued source needed here. When the buyer workspace has accepted a returned accountant file, export its complete Accountant delivery again so that the accepted return and its original history arrive together.

The receiver keeps the original distinctions between an expense and a credit, the original native amount, network, asset, source capture, recognition date, account coding and payment references. Accountant status and external references describe the accepted bookkeeping return. They do not change the issued amount.

## Receive and inspect

1. Select the source file in Buyer expenses.
2. Preview it. Read the buyer workspace, close, period, source SHA-256, original line count and accepted bookkeeping references.
3. Enter the receiving operator and a useful note, then receive that preview.
4. Select an original expense or credit from the retained source.

Preview and receive are separate steps. Receive binds the complete file to the exact preview and current case version. If another operation changes the case before receiving, refresh the preview. If the response to a submitted receive is lost, retain its original request rather than creating a different receiving request.

An already retained identical source file resolves to its original intake. An altered file with the same issued close identity must still carry the identical issued close. Later bookkeeping editions must preserve the accepted original return chain; conflicting editions are refused. Earlier editions remain in the case history and in the full export.

The panel shows all received editions and identifies the current edition for each original close. A new current accountant edition can mark an earlier attribution as needing source review. The previous allocation and review remain readable so the operator can see exactly what was accepted earlier.

## Attribute the original amount

Choose the original work package and funding basis for each portion of the line. Funding bases are:

- **GRANT** — the selected grant work.
- **CUSTOMER** — customer-funded work.
- **INTERNAL** — internally funded work.
- **PREAWARD** — work before award.

Amounts are integer native units from the issued source. The combined portions cannot exceed that original line. Record a reason for any remainder. Combine repeated portions for the same work package and funding basis into one explicit allocation.

A line may be split across up to 200 work-package/funding-basis combinations. The case retains one attribution for each original buyer workspace and source allocation. To change an existing attribution, reopen and edit that record. Receiving another edition of the source does not create another original charge.

Link existing invoice, purchase or work records where they explain the allocation. These links use the original retained Operations identities. They provide a useful connection to the existing delivery records without creating a second invoice, payment or work record.

Save the draft with a clear operator note. A saved draft retains its complete original source binding, work-package split, remainder, valuation and related record IDs. It appears in the review queue until reviewed.

### Drafts and interrupted responses

Unsaved allocations and notes are retained per original selected line in this browser. Switching to another line and returning restores that line's draft. Reloading preserves the selected draft and note. If the source edition or saved attribution has changed, the panel preserves the local draft for download and asks the operator to reload the retained selection before saving.

A successful save replaces that line's cached draft with its actual retained record. The review action applies to the saved record. Save or explicitly discard unsaved changes before reviewing it.

If a mutation response is interrupted, the panel retains the exact action, body and request UUID. On reopening it reads the original request receipt. A committed receipt resolves the earlier action without sending another save. If no receipt exists, the operator can resume the same retained request with the same bytes. A pending receive also needs the exact original source file; reselecting a different file cannot silently replace that request.

The retained request belongs to the original workspace and case. Keep the same operation identity when recovering a response. Use the displayed request and selection information when handing a recovery to another operator.

## Valuation and credits

Native amounts remain useful without a USD valuation. They are grouped by network, asset, work package and funding basis, with expense, credit and net columns. Record USD only when there is an explicit source and method for that comparison.

Two valuation methods are supported:

| Method | Operator inputs |
| --- | --- |
| Entered USD | The USD amount for each allocated portion, a valuation date, at least one retained source attachment and a note explaining the selected evidence and method. |
| Retained rate | The original unit's currency code and decimal places, a valuation date, retained source attachments and the original Forecast currency rate record where a conversion is required. |

Attach the unit definition and valuation evidence using the original case's source workflow. Select those existing source IDs in the valuation. An asset's display name does not establish its decimal places, currency or exchange rate.

The retained-rate path supports original atomic precision through 18 decimal places. It scales the selected integer amounts exactly, validates the currency/rate relationship with the original Forecast currency module and uses that module's cumulative cent allocation. Rounding follows the selected original rate. See [CURRENCY.md](CURRENCY.md) for the rate source, date, purpose and rounding fields.

A selected USD unit does not need a foreign exchange rate. The unit definition and its source still need to be explicit. A non-USD unit requires the matching original rate record. No rate is obtained from a network service during receipt or review.

Credits keep their positive original native amount and **CREDIT** kind. Reports subtract reviewed credit allocations from reviewed expense allocations. A refund source remains linked to its original buyer source and accepted close; it is not converted into a negative replacement expense.

Operational USD totals include reviewed allocations from operational input in an OPERATIONS case, excluding testnet networks and rates explicitly marked as planning assumptions. The report also retains excluded record IDs, unvalued portions and drafts so the operator can understand each total. Review an original native amount without valuing it when the evidence does not yet establish a currency comparison.

## Review, revise and continue

The attribution lifecycle is:

| Current state | Available actions while the case is open |
| --- | --- |
| DRAFT | Save, review or void. |
| REVIEWED | Reopen or void. |
| VOID | Reopen. |

Review records the selected source binding and content SHA-256, operator and note. It requires the current original source edition. If accepted accountant references changed, reopen the attribution, select the current source, save the updated draft and review that retained edition.

Reopening appends the change to the original case history. Earlier reviewed content remains in the journal. Voiding preserves the record and reason while removing that allocation from current totals.

Closing the operating case uses its original review and close workflow. The expense records are part of the case's business review. A later mutation requires the original case to be open. Imported older cases that have no expense records keep their original accepted review identities.

The expense totals complement the original invoice balances and recorded cash. An allocated cost, an invoice liability and a cash settlement answer different operational questions. Use the links and source references to explain their relationship.

## Export and receive on another machine

The Buyer expenses panel can download:

- **Expense attributions CSV** — retained amounts, work-package allocations, state, valuation, original line and source references.
- **Expense sources CSV** — all retained source editions and their complete file identities.
- **Readable expense review** — a self-contained HTML review of sources, allocated expenses, credits, valuation and review status.
- **Complete Operations ZIP** — the original plan and operating history, every attached financial source, accepted accountant packets inside their original source archive, retained attribution editions and the derived reports.

Use the complete Operations ZIP for continuation. CSV and HTML downloads are useful review documents, while the complete ZIP carries the original event history and source bytes needed to reopen the case.

Import with the original Operations importer into a selected private workspace. It validates each source again, verifies the retained original return chain, replays the expense events in order and compares frozen review snapshots. It creates a receiving case identity and preserves the original case origin. The original case and its source files remain available.

After import, select the received case, inspect its current Buyer expenses view and original history, then continue through the same save/review/reopen workflow. The source selection, currency method, accepted accountant references and native amounts survive the handover.

Keep private exports with the operators who need the original financial records. Share a selected readable report when the recipient needs the review rather than the full source and request history.

## Run from the command line

The commands below run from this source directory. Use a private workspace that is not already open in the browser process. The original workspace lock protects all planning and Operations commands.

Set the actual private paths and IDs from the original workspace before invoking commands. These example variables are ordinary shell variables; the program does not read them implicitly.

```sh
GRANT_WORKSPACE=/absolute/private/grant-workspace
GRANT_SCENARIO=/absolute/source/sf10_current_candidate.json
GRANT_CASE=operation-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ISSUED_SOURCE=/absolute/private/issued-buyer-source.json
```

Open the original browser workspace:

```sh
python3 cli.py serve --workspace "$GRANT_WORKSPACE" --scenario "$GRANT_SCENARIO" --port 0
```

Use the private access file returned by the original server. In an installed managed launch, the existing launcher checks the selected workspace, scenario, Python executable and complete source closure before publishing its startup identity. Keep the new expense modules and their original accountant dependencies with that selected source.

The reader uses Node from the normal executable path. A host can select its installed executable explicitly through `SF47_BUYER_NODE=/absolute/path/to/node`.

Read current expense sources, lines, allocations and allowed actions:

```sh
python3 cli.py operations --workspace "$GRANT_WORKSPACE" --scenario "$GRANT_SCENARIO" \
  expenses --case "$GRANT_CASE" --output /absolute/private/expense-view.json
```

Preview a complete issued source against the actual case version:

```sh
python3 cli.py operations --workspace "$GRANT_WORKSPACE" --scenario "$GRANT_SCENARIO" \
  expense-preview --case "$GRANT_CASE" --expected-version 37 --file "$ISSUED_SOURCE" \
  --output /absolute/private/expense-preview.json
```

Use the returned `previewSha256` and version when receiving:

```sh
python3 cli.py operations --workspace "$GRANT_WORKSPACE" --scenario "$GRANT_SCENARIO" \
  expense-receive --case "$GRANT_CASE" --expected-version 37 --file "$ISSUED_SOURCE" \
  --expected-preview-sha256 REVIEWED_PREVIEW_SHA256 \
  --actor "Receiving operator" --note "Selected issued close and original allocations" \
  --request-id receiving-original-issued-close
```

Prepare a save input from the actual retained line. A minimal unvalued allocation looks like:

```json
{
  "intakeId": "expense-intake-SELECTED_ID",
  "sourceLineId": "ORIGINAL_SOURCE_LINE_ID",
  "expectedSourceRowSha256": "ORIGINAL_SOURCE_ROW_SHA256",
  "allocations": [
    {
      "costId": "ORIGINAL_WORK_PACKAGE_ID",
      "fundingBasis": "GRANT",
      "nativeAmount": "60000",
      "memo": "Allocation supported by the original selected delivery"
    }
  ],
  "valuation": null,
  "unattributedReason": "",
  "linkedInvoiceIds": [],
  "linkedPurchaseIds": [],
  "linkedWorkIds": []
}
```

Use the source line's actual amount and enter a remainder reason when allocating less than the original amount. Include the existing attribution's `id` when saving a reopened draft.

```sh
python3 cli.py operations --workspace "$GRANT_WORKSPACE" --scenario "$GRANT_SCENARIO" \
  expense-save --case "$GRANT_CASE" --expected-version CURRENT_VERSION \
  --data /absolute/private/expense-allocation.json --actor "Recording operator" \
  --note "Reviewed source-to-work-package allocation" --request-id save-original-allocation
```

Review the actual saved attribution with its returned content SHA-256:

```sh
python3 cli.py operations --workspace "$GRANT_WORKSPACE" --scenario "$GRANT_SCENARIO" \
  expense-review --case "$GRANT_CASE" --expected-version CURRENT_VERSION \
  --attribution RETAINED_ATTRIBUTION_ID --expected-content-sha256 RETAINED_CONTENT_SHA256 \
  --actor "Reviewing operator" --note "Accepted this retained source and allocation" \
  --request-id review-original-allocation
```

`expense-reopen` and `expense-void` use the same selection flags and require a new explicit reason. Use a fresh request ID for a new action; reuse an existing ID only with its exact original action and payload.

For a lost response, save the complete original command body and read its original receipt:

```sh
python3 cli.py operations --workspace "$GRANT_WORKSPACE" --scenario "$GRANT_SCENARIO" \
  expense-request --case "$GRANT_CASE" --request /absolute/private/original-request.json
```

A committed response returns the original receipt. A conflicting body cannot take over an existing request identity.

Export derived reports using the current reviewed version:

```sh
python3 cli.py operations --workspace "$GRANT_WORKSPACE" --scenario "$GRANT_SCENARIO" \
  expense-export --case "$GRANT_CASE" --expected-version CURRENT_VERSION \
  --format attributions --output /absolute/private/expense-attributions.csv
```

The other formats are `sources` and `html`. Use the original `operations export` and `operations import` commands for a complete portable case. Each subcommand's `--help` lists its required input and receiving identity fields. Output files are published create-only; choose a new path or intentionally reuse an identical retained output where the original command supports it.

## Client and service integration

The existing `GrantWorkspaceClient` exposes:

- `expensePreview(caseId, expectedVersion, sourceBytes, filename)`
- `expenseReceive(caseId, sourceBytes, options)`
- `expenseSave(caseId, options)`
- `expenseTransition(caseId, action, options)` for review, reopen and void
- `expenseRequest(caseId, originalCommandBody)`
- the `expenses` read and expense CSV/HTML downloads

Receive options include the current version, stable request ID, actor, note, filename and selected preview SHA-256. Save options carry the actual allocation data. Transitions carry the actual attribution ID and selected content SHA-256. The client uses the existing server authorization, source selection and request reconciliation.

Service routes stay under the original `/api/operations/<caseId>` family:

| Route | Purpose |
| --- | --- |
| GET `expense-attribution` | Current retained source, lines, allocations and allowed actions. |
| POST `expense-preview` | Inspect complete source bytes against the selected case version. |
| POST `command` | Original transactional `expense.receive/save/review/reopen/void` actions. |
| POST `expense-request` | Read the receipt for an exact original command body. |
| GET expense CSV/HTML filenames | Download the derived retained review. |

The original request table admits the same exact request once. Expense mutations advance the same case version and append the same Operations events used by the other case records. The source attachments and imported history remain in the original workspace.

## Receiving operation

The complete source-native operation is `operations/expense-attribution-receiving.py`, with its browser journey in `operations/expense-attribution-browser.mjs`. Supply a complete original issued buyer/accountant project, an original Operations case archive, the selected full current source, Node and the available Chromium executable. Its work directory retains the exact inputs, source identities, browser requests and downloads, case exports, received workspace and final result.

The operation continues one copied original case through browser source receipt, draft recovery, a committed save with its browser response dropped, same-request reconciliation, review, accepted accountant editions, credits, currency precision, complete export/import and reopen. It keeps its actual phases and artifacts if execution is interrupted so the same selected inputs and operation can be recovered.

For a receiving installation that also includes the original support or buyer components outside the SF47 workspace directory, pass `--source-manifest /absolute/SOURCE.json`. Use the same map emitted by this operation: repository-relative filenames mapped to their exact `bytes` and `sha256`. The receiver verifies those complete original source files and includes them alongside the managed source, typed client, browser journey and this guide in its retained source edition. Resume with the same work directory and selected buyer close; previously committed original requests retain their IDs and receipts.

## Continue a named operator’s complete expense desk

The Expenses desk keeps its complete editor, every line draft and note, original source bytes and pending save in browser storage selected by the native installation and staff identity. Reopening the same case restores that operator’s original request and checks its unchanged digest before reading the receipt or resuming it. A named operator continues a request bearing that original recording actor; installation owners retain the original recording-actor behavior. Expired sign-in, changed access and unavailable routes keep the pending request available for recovery.

Use **Download complete editor** to retain the full working JSON, selected source bytes, original request, allocation drafts and receipt. **Open complete editor** checks the original case and request, preserves a download of the preceding work, and opens the received editor without changing the native case. **Earlier local issued expense copy** explicitly inspects, downloads or receives a pre-existing browser copy; the earlier copy remains untouched. When another window changes the same saved editor, download the complete current work and use **Download work and reopen saved local desk** to select its retained version. Original metadata-only copies may require selecting the exact original filename and bytes before an uncommitted source request can resume. The browser verifies those bytes against the retained digest.

The source cache retains the original file before a native receiving command can be sent. The complete editor and source cache share the existing request and source identities; they do not alter issued expenses, credits, accountant returns, valuation, review state or case history. The original readable report, allocation CSV and complete native case export remain available from the same desk.

## Preserve the original budget edition and receiving course

Each saved allocation is validated against the plan selected immediately before that native save. Reviewing, reopening or voiding an allocation preserves its last saved cost selection and exact valuation. Later budget amendments can retire a work package without changing the original allocation, review or complete-case receiving history.

The existing issued-expense browser receiving programme opens **Cash → Buyer expenses / credits** in the current workspace and uses the same signed-in installation owner. Its private checkpoint includes the actual complete editor and retained source cache, with original request IDs and hashes. A subsequent browser process opens that complete checkpoint through **Open complete editor**, retains the preceding copy, and continues the same source receipt, allocation, controlled response-loss recovery and review. The original issued buyer close, imported Grant case, programme binding and final case export remain the receiving inputs. Continue the existing `grant-issued-expense-attribution-f232-20261012` operation with its retained private state and complete source input.

Finance operators can preview, receive, allocate and review issued expenses and credits within their assigned cases. The original case authorization, selected operator and native mutation checks apply to the complete editor and the original request recovery. Read-only preview and receipt inspection use the same case access.

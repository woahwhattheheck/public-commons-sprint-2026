# Account reconciliation and saved period closes

Account Reconciliation brings the original Account Statements intake and Cash Accounts workbench into one period-close workflow. An operator selects a retained statement, reviews every original source movement against the current native cash account, resolves complete matching groups and outstanding movements, and saves an immutable reconciliation edition. Opening a saved edition shows its original close alongside a fresh comparison with the current case.

The implementation lives in `operations_account_reconciliation.py`. It uses the original Statements parser and review sources, the Cash Accounts validated correction chains, native decimal amounts, and the existing Operations transaction and source storage.

## Complete operator workflow

1. Receive the original account CSV through [Account Statements](STATEMENTS.md), including its account identity, column mapping, row decisions and original opening and closing balances. Each received interpretation retains the CSV, its complete review, and the original cash identities.
2. Open Account Reconciliation and choose that retained statement. Enter the period dates reported by the original account statement and a useful reconciliation name. Every nonzero source movement must fall within the selected period.
3. Review the original balances, every source row, and every native cash movement in the exact selected account and period. Original received cash is matched through its retained identity. A corrected observation follows the validated Cash Accounts successor chain.
4. Resolve source and account differences. Use an explicit matching group when several source rows belong to several complete native movements. Record each outstanding native movement with its reason, expected clearance date when known, and retained supporting documents. Open the original statement or cash writer when the source interpretation or actual observation needs a correction.
5. Preview the complete decision set. A draft can retain unresolved differences. A closed edition requires complete original balances, resolved meaningful source rows, resolved native movements and a zero remaining difference.
6. Save the reviewed draft or close. The save retains a complete source edition, one original request identity, the exact reviewed case version, all matching and outstanding decisions, and its full native comparison.
7. Reopen any saved edition to inspect the original facts and the current account. Save a following edition to continue its decisions. Export the complete reconciliation handover when another operator needs the case, original sources and retained history.

A saved close remains an immutable historical edition. Later native cash observations and corrections appear in the current comparison. The earlier edition stays available in the reconciliation history.


## Browser desk, original writers and recovery

Open **Delivery operations → Account reconciliation** in the original Operations case. The statement chooser uses retained source filenames and readable account labels. Set the original statement period explicitly, then use the comparison, statement rows, cash entries, matching groups, resolution plan, saved editions and original files views.

The source and cash tables keep every record and page the visible rows. Select complete rows and native movements to add an explicit match. A row or cash movement already used in a different explicit decision must be removed from that decision before reassignment. The complete resolution plan stays editable when a malformed date, stale edition or conflicting input prevents a new preview.

Opening an earlier edition as the next draft copies its original document and targets the latest retained reconciliation head. The earlier edition, an existing editable draft and their complete recovery downloads remain available. Switching between current and saved comparisons preserves the draft separately.

**Open original statement inputs** carries the exact retained CSV, original mapping, format, balances and row decisions into Account Statements. Before replacing an existing editable statement, the writer downloads its complete original recovery copy. If a statement import is pending or accepted, its exact request remains selected and the incoming original input is retained beside it for opening after that request is resolved. The statement recovery copy includes both complete inputs.

**Open cash account** selects this statement's exact network, currency, asset and period. Opening an individual cash row selects that original movement in Cash Accounts. The existing cash draft or pending original request stays retained while the account selection changes.

The reconciliation desk is saved per original case in browser storage. Each write compares the saved revision in the same IndexedDB transaction; another tab's newer desk is preserved. On a storage conflict the current tab retains its full input and offers **Download complete desk** or **Open saved browser desk**. Downloaded desks include the selected case version, editable document, selected source and cash rows, reasons, chosen view, complete pending request, previous original request and last result. Recovery accepts a complete JSON desk up to 64 MiB in its original case.

A save first retains the complete body, recording operator and original request ID. After an interrupted response, **Resume original request** sends that same body again. Access or transport failures keep the pending request selected. A definite native validation or current-version conflict can return its complete original document to a draft against the fresh case and current reconciliation head; that operation preserves the rejected request and requires a fresh preview.

## Command line and typed client

Use the existing workspace and scenario selection described in [the native CLI guide](CLI.md). These are subcommands of `operations`:

| Command | Original selection |
| --- | --- |
| `account-reconciliation` | `--case`, optional `--reconciliation`, `--revision`, `--expected-version`, `--output` |
| `account-reconciliation-statement-inputs` | `--case`, `--source`, optional `--output` |
| `account-reconciliation-preview` | `--case`, `--input`, optional matching `--expected-version`, `--output` |
| `account-reconciliation-apply` | `--case`, `--input`; optional matching `--expected-version`, `--actor`, `--request-id`, `--expected-preview-sha256`, `--output` |
| `account-reconciliation-desk-resume` | `--case`, complete original `--input` desk, optional `--output` |
| `account-reconciliation-export` | `--case`, optional `--reconciliation` and `--revision`, required `--expected-version`, `--expected-report-sha256`, `--output` |

Preview and apply accept the complete native input JSON or a downloaded reconciliation desk. A draft desk includes its selected case version. An apply or resume with a pending desk uses its retained exact body. Additional command-line fields must match any value already present in that body. `account-reconciliation-desk-resume` accepts the original desk and forwards the pending request unchanged.

An explicit output is written as a new private file through the existing atomic output publisher. The reconciliation export is the complete source/case ZIP listed below. Receive that file through the ordinary `operations import` command; the receipt includes `accountReconciliation`, which identifies the retained reconciliation and edition in the new case.

The typed `GrantWorkspaceClient` exposes:

| Client call | Complete result |
| --- | --- |
| `read('account-reconciliation', selection)` | `GrantAccountReconciliationReport` |
| `read('account-reconciliation-statement-inputs', {caseId, sourceId})` | Original `GrantStatementInput` with complete source bytes |
| `accountReconciliationPreview(caseId, body)` | `GrantAccountReconciliationPreview` |
| `accountReconciliationApply(caseId, body)` | `GrantAccountReconciliationReceipt` |
| `download('account-reconciliation', selection)` | Complete reviewed original account ZIP through the existing download API |

The declarations retain the exact decimal strings, source-row and native-movement statuses, matching decisions, report totals, every saved edition, comparison and receiving selection. A reviewed export pins both its case version and `reportSha256`.

## Merchant MCP and installed source selection

The existing Grant Workspace Merchant adapter adds `account_reconciliation`, `account_reconciliation_statement_inputs`, `account_reconciliation_preview` and `account_reconciliation_apply`. Its ordinary `export` operation accepts kind `account-reconciliation` with the original reconciliation selection, reviewed case version and report SHA-256.

Preview and apply accept the complete native body through `inputs` or a verified original file/reference. For a downloaded desk with a pending request, select `inputPointer: "/pending/body"` after verifying the entire original file. Optional top-level version, request, actor and reviewed-preview fields must match retained values. The adapter delegates the original body to the typed client and native Operations owner.

The Python and Node managed launch selections include the new reconciliation engine, browser, stylesheet and this guide, together with the composed Statements, Cash, Operations and client interfaces. Start the existing installed service with that complete source release, open the original case, and continue its same retained statement and cash workflow.

## Account identity, period and source facts

An account is selected from a retained original Statements CSV. Its native dimensions are exact:

| Dimension | Value |
| --- | --- |
| Network | `statement/` followed by the original account ID |
| Currency | The original statement currency |
| Asset | The original statement currency |
| Period start and end | The operator's explicit original statement period, inclusive |
| Eligible cash | Original native `OBSERVED` movements accepted by the existing Performance cash filter |

The same account name under different native dimensions is a different account. Changing a native cash observation's account, currency, asset or date can therefore remove it from the selected period's eligible movements. The comparison retains any referenced original and corrected record so the operator can review that change.

The desk reads the complete original CSV and its retained Statements review. It reuses the existing Statements parser to confirm the original mapped rows, source amounts, account identity, source interpretation and source balance arithmetic. Original cells, intake decisions, exclusions, allocations and cash references remain available.

Rows excluded during intake retain their original meaning. A zero-value row that was explicitly excluded in the original Statements interpretation can receive an informational acknowledgment. A nonzero excluded row needs an actual matching or original intake resolution before close.

## Native account arithmetic

Every amount is carried as an exact decimal string in its original currency. The native account comparison uses complete movements; it does not divide a cash record into unrecorded partial amounts.

Let:

- `S₀` be the original statement opening balance.
- `S₁` be the original statement closing balance.
- `L` be the signed net of all eligible native movements in the selected account and period.
- `O` be the signed net of explicitly outstanding eligible movements.

An inflow has a positive sign and an outflow has a negative sign.

| Report field | Calculation | Meaning |
| --- | --- | --- |
| `totals.statement.net` | Original source inflows minus original source outflows | Every original statement movement, including excluded intake rows |
| `sourceAnchoredLedgerClosing` | `S₀ + L` | Native period movement compared from the retained source opening |
| `sourceDifference` | `S₀ + L − S₁` | Difference before the explicit outstanding decisions |
| `clearedLedgerNet` | `L − O` | Native period movement after the retained outstanding selection |
| `sourceAnchoredClearedClosing` | `S₀ + L − O` | Closing comparison after outstanding movements |
| `remainingDifference` | `S₀ + L − O − S₁` | Difference that must be zero for a closed edition |
| `absoluteLedgerOpening` | `null` | The selected source opening remains an external account fact |

The opening and closing balances must both be present in the original Statements interpretation and its original balance status must be `MATCH`. A source balance anchors this comparison; saving a reconciliation does not create a cash observation for that balance.

### Worked original-statement flow

For an account statement containing a 1,200 USD grant inflow, a 250 USD supplier payment and a 50 USD customer inflow, source net movement is 1,000 USD. With an original opening of 100 USD and closing of 1,100 USD, the statement balances.

When the three corresponding native movements are the complete eligible period ledger, native net is also 1,000 USD and remaining difference is zero. Their original source-to-cash identities match automatically.

If the same period also contains an observed 40 USD payment that has not cleared this statement, native net is 960 USD. The source-anchored closing is 1,060 USD, giving a source difference of −40 USD. Explicitly retaining that complete payment as outstanding gives outstanding net −40 USD and cleared native net 1,000 USD. The remaining difference becomes zero. The payment, its reason and original documents remain visible in the saved edition.

## Matching complete original movements

### Retained and corrected observations

A source row received as `NEW` resolves through its retained `review.cashRows` entry. A row received as `EXISTING` resolves through its retained `recordId`. Automatic matching requires an eligible current native movement with the original source date, currency, direction and amount.

The Cash Accounts engine validates every correction against its original source bytes and native void, record and source events. Reconciliation follows only that validated chain. It retains the selected predecessor, current successor and every correction source ID.

Changes to allocations, recorded USD valuation, category or reference can retain the same bank movement. The complete native record is still shown, and its changed facts appear in comparison with the saved edition. A changed amount, direction, date or account needs the operator's current matching or original cash decision.

### Explicit many-row and many-movement groups

An explicit link has this shape:

```json
{
  "rowNumbers": [2, 3],
  "cashIds": ["cash-<retained native identity>", "cash-<retained native identity>"],
  "reason": "The original statement groups these complete native payments."
}
```

The actual request uses full retained native IDs. Each group requires:

- One or more distinct original source row numbers.
- One or more distinct retained native cash IDs.
- A retained matching reason.
- Readable original source movement amounts.
- Eligible current cash in the exact selected account and period.
- Equal signed source and native group totals.
- Each complete current cash movement used by only one successful group.

A selected predecessor resolves to its current successor. If two selected predecessor IDs resolve to the same current movement, the group remains a conflict. The desk never silently consumes that movement twice.

Explicit links are evaluated first. Remaining original rows then use their retained automatic cash matches. A conflict remains visible with the original row and current native record details.

### Outstanding movements

Each outstanding decision retains:

```json
{
  "cashId": "cash-<retained native identity>",
  "reason": "Issued during this period; clearance is absent from this original statement.",
  "expectedClearDate": "2026-10-13",
  "sourceIds": ["source-<retained supporting document>"]
}
```

The native movement must be eligible, unmatched and distinct from every other successful outstanding selection. An expected clearance date is optional and remains an operator observation. Supporting source IDs must identify original retained case documents.

The selected record contributes its entire native amount and direction to the outstanding totals. Outstanding does not void, reclassify or rewrite the original cash observation.

## Preview and close rules

The preview distinguishes the ability to retain the operator's current work from the ability to close the original period.

| Field | Meaning |
| --- | --- |
| `canSave` | The original Operations case is open and has room to retain the complete source edition |
| `canClose` | The complete current preview has no error findings and can be retained |
| `canApply` | A draft can be saved, or the requested closed edition satisfies `canClose` |
| `previewSha256` | The exact complete preview reviewed for this request |
| `inputSha256` | The normalized case version, reconciliation head, requested state and complete document |
| `cashBasisSha256` | Complete selected native cash facts and retained correction source identities |

Closing requires the original source balance status `MATCH`, complete source amounts, period coverage for every nonzero source movement, a matching or permitted zero-value acknowledgment for every source row, a matching or explicit outstanding decision for every eligible native movement, and zero remaining difference.

The findings retain a code, severity, readable message, original row numbers and relevant cash IDs. Drafts retain unresolved findings so work can continue from a complete original decision set.

### Source-row statuses

| Status | Meaning |
| --- | --- |
| `MATCHED` | The retained native observation matches the original movement |
| `CORRECTED` | The validated current successor matches the original movement |
| `LINKED` | An explicit complete matching group resolves the row |
| `SOURCE_ONLY` | An original source movement has no successful current match |
| `CHANGED` | A retained observation or explicit group requires a current decision |
| `EXCLUDED` | The original intake exclusion remains unresolved for this close |
| `ACKNOWLEDGED` | An originally excluded zero-value informational row has a retained reason |

### Native movement statuses

| Status | Meaning |
| --- | --- |
| `MATCHED` | Used by a successful original source match |
| `LINKED` | Used by a successful explicit source group |
| `OUTSTANDING` | A complete unmatched movement has an explicit outstanding decision |
| `LEDGER_ONLY` | An eligible native movement still needs a decision |
| `EXCLUDED_VOID` | The retained observation is void |
| `EXCLUDED_TESTNET` | The original Performance filter excludes the movement |
| `OUTSIDE_PERIOD` | A referenced original or successor is outside the selected dates |
| `OTHER_ACCOUNT` | A referenced original or successor uses different native dimensions |

All original native fields accompany a movement row. The source rows retain their original cells, intake action and reason, original cash identity and correction source IDs.

## Engine API

These functions borrow the original Operations instance. Account and preview reads use its existing snapshot context.

| Function | Result |
| --- | --- |
| `account(ops, case_id, body=None)` | Statement catalogue, saved reconciliation heads, selected edition, complete history and current comparison |
| `preview(ops, case_id, body)` | Complete normalized original source/native movement comparison |
| `apply(ops, case_id, body)` | Atomic immutable edition save and original receipt |
| `statement_inputs(ops, case_id, statement_source_id)` | Complete original Statements inputs, including exact original CSV bytes |
| `export_bundle(report, original_case_bytes)` | Full reconciliation ZIP |
| `unwrap_bundle(raw)` | Native case ZIP and optional reconciliation report |
| `validate_import(context, events, files)` | Validated original reconciliation editions rebuilt from native history |
| `validate_received(report, document, files)` | Complete report matched to the received original case |
| `received_selection(report)` | Selected original reconciliation and source-case handover fields |

The HTTP routes are relative to the selected existing Operations case:

| Method | Route | Operation |
| --- | --- | --- |
| GET | `/account-reconciliation` | Account and selected edition |
| GET | `/account-reconciliation/export.zip` | Full selected handover |
| POST | `/account-reconciliation-preview` | Preview complete decisions |
| POST | `/account-reconciliation` | Save reviewed edition |
| GET | `/account-reconciliation-statements/{sourceId}/inputs` | Reopen the exact original statement inputs |

### Account selection

```json
{
  "selection": {
    "reconciliationId": null,
    "revision": null
  },
  "expectedVersion": 12
}
```

The version is optional for an account read. An empty selection shows the account catalogue. Selecting an original reconciliation with a null revision opens its current saved head. Selecting a revision opens that exact immutable edition.

The account response has schema `stellar-forge.sf47-account-reconciliation.v1` and these top-level fields:

```text
schema
case
statements[]
reconciliations[]
selection { reconciliationId, revision }
selected { source, record } | null
current <complete current preview> | null
history[] { source, record }
comparison | null
reportSha256
```

Each statement summary includes its original CSV and review source metadata, account dimensions, first and last dated row, original opening and closing balances, balance status, source hashes and original receiving version.

Each reconciliation head includes its original identity, name, revision, state, reviewed and saved case versions, source identity, statement identity, account, currency, period, recording operator, time, request ID, reviewed preview hash, remaining difference and unresolved-row count.

The selected `record.document` contains the complete original editable decisions. Every history item includes the exact full saved packet and its original source metadata.

### Preview and save body

```json
{
  "expectedVersion": 12,
  "reconciliationId": null,
  "expectedRevision": 0,
  "state": "DRAFT",
  "document": {
    "name": "Operating USD — October statement",
    "statementSourceId": "source-<retained original statement>",
    "periodStart": "2026-10-01",
    "periodEnd": "2026-10-31",
    "links": [],
    "exclusions": [],
    "outstanding": [],
    "note": "Original account period review."
  }
}
```

For a following edition, send the original reconciliation ID and the current head's revision. The current case version and current head revision must both match. Reopening an older historical edition uses its original document as a new draft against the current head; it preserves the older source edition.

After reviewing the preview, the save body additionally contains:

```json
{
  "expectedPreviewSha256": "<complete reviewed preview SHA-256>",
  "actor": "<recording operator>",
  "requestId": "<one original request identity>"
}
```

Send these fields in the same complete body as the decisions. Changing any selected input or current case fact requires a fresh preview.

The preview schema is `stellar-forge.sf47-account-reconciliation.v1.preview`. Its complete fields are:

```text
schema, case, expectedVersion, reconciliationId, expectedRevision, requestedState
document
selection { statementSourceId, reviewSourceId, accountId, network, currency, asset, startDate, endDate }
statement { source, reviewSource, accountId, accountLabel, currency, network, asset,
            headers, originalBalance, originalSummary, editionSha256 }
sourceRows[]
transactions[]
matches[]
totals { statement, ledger, outstanding, reconciliation }
counts
findings[]
basis
cashBasisSha256, inputSha256
canSave, canClose, canApply, previewSha256
```

Matching groups expose `rowNumbers`, resolved current `cashIds`, originally selected `selectedCashIds`, exact source and ledger nets, difference, reason, correction source IDs and `MATCHED` or `CONFLICT` state. Group kinds are `EXPLICIT`, `RETAINED` and `CORRECTION`.

### Original statement handoff

`statement_inputs` returns:

```text
caseId
expectedVersion
statementSourceId
reviewSourceId
inputs
```

`inputs` is the original retained Statements input object. Its `source.contentBase64` contains the exact original CSV, and its original source observation, mapping, format, row decisions and balance inputs are restored. The Statements workflow then computes its own current preview using its current original cash correction rules.

## Immutable editions and request recovery

A save runs through the existing `workspace._transaction(requestId, payload, action)`. The payload includes the complete original save body and selected case ID. The original request store resolves an accepted identical request before the action reads a newer case version, checks a newer reconciliation head, or creates another timestamp or source packet.

A pending client retry must therefore retain the exact original body and request identity. An accepted retry returns the original receipt. Reusing that request identity for different content follows the original native request-conflict behavior.

A received case also retains the original edition request IDs in its source history. If a fresh workspace has no matching accepted request in its own request store, saving still checks those retained edition identities before adding a source. Continuing that received case uses a new original request for the new edition.

Inside the original transaction, the action checks the current case and head, rebuilds the exact reviewed preview, and records one complete source through native `source.add`. The source increments the case version once.

The immutable packet schema is `stellar-forge.sf47-account-reconciliation.v1.edition`:

```text
schema
id
revision
parentSourceId
parentSourceSha256
caseId
fromVersion
version
state
document
preview
requestId
recordedAt
recordedBy
```

The filename is `account-reconciliation-{native identity}-r{revision}.json`. The packet uses canonical JSON followed by a newline. A following edition identifies its exact predecessor source and source hash.

The save receipt includes:

```text
id <case identity>
version
action = account-reconciliation.save
reconciliationId
revision
state
sourceId
sourceSha256
requestId
previewSha256
selection { reconciliationId, revision }
```

The operator can recover a delivered request from the original receipt or its retained reconciliation summary and full edition, which each carry `requestId`.

## Historical comparison and continuing work

Opening a saved edition calculates a current preview from that edition's original document and the current case. The original saved preview remains inside `selected.record.preview`.

The comparison reports:

- Saved and current case versions.
- Whether complete native cash facts changed.
- Added, removed and changed cash IDs.
- Original source row numbers whose current reconciliation changed.
- Saved and current source differences.
- Saved and current remaining differences.
- Saved and current ability to close.

The report's `history` retains every edition for the selected original reconciliation. The selected revision can be older than its current head. A new save continues the current head with the operator's explicit current decision set.

For actual cash errors, [Cash Accounts](CASH_ACCOUNTS.md) retains the voided predecessor, corrected native observation, original allocations and valuation facts, complete correction source and affected completion/forecast handoffs. Reconciliation reads those original outcomes when reopened.

## Complete export and native receiving

The reconciliation ZIP includes the full native Operations case plus these readable and machine-readable members:

| Member | Contents |
| --- | --- |
| `operations-case.zip` | Complete original case, original sources and retained source editions |
| `reconciliation.json` | Complete selected account report |
| `selection.json` | Original reconciliation and revision selection |
| `reconciliation.html` | Readable original balance, current account, full source rows, native movements, matching groups and history |
| `reconciliations.csv` | Every current saved reconciliation head |
| `statements.csv` | Complete original statement catalogue |
| `source-rows.csv` | Every original selected source row and its current matching details |
| `native-movements.csv` | Full selected native movements and referenced originals |
| `match-groups.csv` | Complete matching groups and amounts |
| `outstanding.csv` | Every explicit outstanding native movement |
| `reconciliation-history.json` | Complete selected original edition history |
| `README.txt` | Operator receiving and financial basis |
| `MANIFEST.json` | Exact file byte counts and SHA-256 values |

A selected edition also includes `original-statement.csv` and `original-statement-review.json`, copied exactly from its complete native case. Array and object fields in CSV members are canonical JSON, preserving group members, original cells, allocations and source references.

The wrapper validates every original member and regenerates the readable members from the complete report before passing the nested case to the existing Operations importer. Native case receiving then validates all original reconciliation sources against their exact source events and edition chain.

For each saved edition, receiving reconstructs its original cash population from the native record and void history at the reviewed case version. Sources added after that version are removed from that original view. The original source interpretation, explicit decisions, correction selection, exact amounts, findings and preview are rebuilt and must match the saved edition.

A later Merchant settlements correction can void its original cash and record a replacement in one native command. Receiving restores the earlier observation from that command's exact cash changes and retained source review, then applies the saved reconciliation's original version cutoff. The complete original source, review identity, event, actor, request and cash fields stay joined. The replacement remains in the later current account, while the earlier saved edition retains the cash state it reviewed. This also preserves an earlier reconciliation when the later merchant correction belongs to another account in the same operating case.

These checks run before the receiving case changes its case identity, name or selected plan identity. The received account selection retains the source case ID, source case version and report hash. The native records, original documents, source edition IDs and full saved history travel with the complete case.

## Original capacity and compatibility

The engine uses existing native capacity limits: an 8 MiB source file, 24 MiB of retained case sources, 200 source files and a 32 MiB complete handover. Preview includes a complete-edition size estimate and saving uses the original source writer's final limits.

The new engine owns reconciliation decisions and saved original account comparisons. Statements continues to own CSV interpretation and receiving; Cash Accounts continues to own correction chains and native financial inspection. Original supplier, customer, completion, forecast, installation, plan-amendment and work-intake records remain part of the same complete native case and its ordinary receiving process.

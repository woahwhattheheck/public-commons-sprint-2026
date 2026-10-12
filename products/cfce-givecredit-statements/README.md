# GiveCredit donor and initiative statements desk

Operate original GiveCredit donations from receipt/payment intake through pooled provider payouts and Stellarcarbon retirement allocations. The desk keeps every source edition, saved association, funding method and issued statement version together.

[Complete native source](../../stellar/scf-starforge-20261009/partners/cfce-givecredit-statements/) · [Original source and API contract](../../stellar/scf-starforge-20261009/partners/cfce-givecredit-statements/README.md) · [Companion Stellarcarbon desk](../stellarcarbon-statements/)

## Open the operator

Use **starforge givecredit-statements** in the maintained Merchant distribution. In a source checkout, replace that prefix with:

~~~sh
node stellar/scf-starforge-20261009/partners/cfce-givecredit-statements/cli.mjs
~~~

The native receiver uses Node 22 or newer on Linux, the existing Merchant private-file/flock runtime, and the original Stellar SDK ^16.3.0 peer for ledger acquisition.

~~~sh
starforge givecredit-statements init \
  --directory "$HOME/givecredit-workspace" \
  --name "GiveCredit donor and initiative statements"

starforge givecredit-statements serve \
  --directory "$HOME/givecredit-workspace" --port 0
~~~

Open the printed local URL. Merchant Applications also lists **GiveCredit donor and initiative statements**; choose the initialized private directory for its existing start, open, stop and reopen controls.

The top row selects the current **Registry**, **Ledger** and **Stellarcarbon** editions. Pages use a neutral industrial layout, readable dates, source-specific choices and ordinary decimal amount entry. The browser converts amounts to exact original token atoms.

## 1. Receive or capture original source editions

**Import and receive** accepts a whole GiveCredit source edition, original registry table files, a complete source edition from the Stellarcarbon desk, or the retained published Stellarcarbon backup. Every import gets a readable edition label.

Original registry filenames are donations.json, nfts.json, organizations.json, initiatives.json, credits.json, providers.json, stories.json and impactlinks.json. Original NDJSON files use the same table names. The imported table coverage is visible with the original metadata.

**Capture original records** provides native registry and ledger acquisition:

- Registry capture uses the operator's existing authorized API access. It follows complete original pages and keeps nested donation impact relations.
- Ledger capture uses the selected original Credits contract, every original Stellar receipt hash in the selected registry edition, native contract events, source-observed provider transfers and full ledger metadata.
- Additional original hashes can be supplied for a known payment. Original RPC, Horizon, archive and date/ledger selectors remain available in the acquisition form.
- A running acquisition reports progress. Pause retains its native checkpoint; resume continues the same selection.

The standard mainnet settings come from the original published GiveCredit application. A testnet selection requires that deployment's original contract. Each captured edition identifies its actual network and original source bounds.

**Source editions** opens every native table with complete pagination, whole original-file downloads and the complete edition export. A source note is attached to the original acquisition scope. A current contract getter and an older transaction observation retain separate source dates.

CLI source receiving:

~~~sh
starforge givecredit-statements import-registry \
  --directory "$HOME/givecredit-workspace" \
  --source "$HOME/original-givecredit-export" \
  --label "GiveCredit original organization export"

starforge givecredit-statements import-carbon \
  --directory "$HOME/givecredit-workspace" --retained \
  --label "Stellarcarbon published April 14, 2026"
~~~

For native acquisition, pass a local JSON file containing the selected original source options. Registry authentication can use the existing GIVECREDIT_REGISTRY_API_KEY environment variable. Retained source editions omit authentication headers.

~~~sh
starforge givecredit-statements capture-registry \
  --directory "$HOME/givecredit-workspace" \
  --file "$HOME/givecredit-registry-options.json" \
  --label "GiveCredit original registry acquisition"

starforge givecredit-statements capture-ledger \
  --directory "$HOME/givecredit-workspace" \
  --file "$HOME/givecredit-ledger-options.json" \
  --registry-edition ORIGINAL_REGISTRY_EDITION_ID \
  --label "GiveCredit mainnet original payments"
~~~

## Import complete original historical ledgers

The ledger capture options accept `originalLedgerSources` alongside explicit original transaction hashes. Each entry carries `format: "stellar-expert-ledger-json"`, the original `sourceUrl`, its `ledger` and the complete unchanged JSON response in `content`. Optional acquisition observations retain the original source import and the later native receiving time separately.

The engine decodes the original envelope, transaction result and metadata directly from that retained provider format. It preserves the entire original response, exact native outer/inner transaction identities, actual ledger order and source references. Successful classic payments use their original native operation/result amounts; path payments retain both the payer debit and the delivered destination amount. Normal contract, account, provider-event and transaction acquisition then continues from those native records.

The complete [historical source reader](../../stellar/scf-starforge-20261009/partners/carbon-native-receiving/prepare-ledger-inputs.mjs) prepares the existing capture-options input from whole original ledger files and the accompanying source manifest. It derives transaction hashes using the selected original network and the existing Stellar SDK, and keeps both raw files and their precise selection in a new private directory. In the full receiving parcel, the same reader is available at `receiving/prepare-ledger-inputs.mjs`.

Use that generated `capture-options.json` with `givecredit-statements capture-ledger --file`, or pass it through the full native receiving caller’s `--capture-options`. The original source directory and complete operated workspace travel in the final archive.

## 2. Inspect donations and assign the original payments

In **Donations**, filter the original registry edition by organization, initiative, donor and registry creation period. Each row retains its original registry amount and reported USD value, alongside the number of saved payment assignments and native receipt relations.

Open a donation to inspect the actual organization and initiative, donor address, original record, directly related receipts, legacy receipt candidates and retained payment candidates.

A receipt carries two identities: its original donor payment hash and its separately minted token identifier. Several receipts may share one original payment. The desk counts that original payment once.

Choose the exact successful original transfer, enter the amount assigned to the Donation, optionally select its matching native receipt, and save the source note. The original payment hash, network, amount and asset precision remain attached. A shared payment can be assigned in explicit partial amounts; the sum stays within the actual source transfer.

Legacy matching uses a saved operator association. Its source note explains why the original Donation and payment belong together. Editing an assignment creates its next version; archive retires it from current selections.

In **Payments**, inspect every retained successful or failed source record, with full original transaction and operation details. A classic path payment shows the payer debit and retains its actual delivered destination amount. Only successful original payments enter financial statements.

## 3. Inspect the provider pool

**Contract pools** separates actual incoming and outgoing token movements from source-observed balances. Select a half-open ledger-close period for the movement table.

The native contract has an accounted provider remainder and an actual token balance. Those values have their own observation ledger and phase. A current getter value is not presented as a past closing balance.

Provider payouts and immediate vendor fees are classified within each original donation call. The source contract permits the same provider and vendor address, so the original event order and source-dated settings matter. Resolved native provider payouts and operator-classified source candidates have separate flow columns.

## 4. Allocate each actual provider payout

Open **Payout allocations** and select the original provider-address transfer. The form lists original donor payments entering that same pool and asset before the payout.

Choose one saved funding method:

| Method | Effect |
| --- | --- |
| Proportional gross payments | Uses original gross donor amounts as weights, with each payment's remaining provider funding capacity |
| Oldest available payments first | Consumes original funding capacity in native payment order |
| Explicit payment amounts | Saves the exact original token amount attributed from each selected payment |

The capacity uses the source-dated provider contribution and deducts prior funding assignments. An immediate vendor fee cannot become reusable provider funding. Where the original source leaves capacity or ordering unresolved, the form accepts an explicit operator source assignment and retains that decision.

Preview the exact allocation. The saved parts equal the whole original provider payout. Original token atoms control rounding and capacity checks. Save a readable allocation name and its useful source note.

If a single provider-address transfer still needs vendor-versus-provider classification, the form displays that condition and records the original source used to resolve it. The saved allocation carries this classification into the statement.

## 5. Associate original carbon contributions

Select a ledger edition and a Stellarcarbon edition from the same network. In **Carbon associations**, choose the saved payout allocation and actual original sink transaction.

Enter the source-observed amount of the provider payout used and the CARBON attributed to that association. Save the original source that connects the two transactions. Multiple actual payouts and sinks can have separately retained associations, with original payment and CARBON capacity checks.

The association freezes the selected payout funding revision. Editing that allocation later leaves existing associated donor proportions intact. To adopt the new method for an association, open that association and explicitly save its next version.

Every original certificate fill participates. Any source CARBON outside the saved association stays outside the donor's attributed share. The full certificate details remain available.

## 6. Prepare donor, initiative and consolidated statements

In **Statements**, choose a title, original date basis, inclusive start and exclusive end:

- **Registry donation creation** selects original Donation.created records and their saved payment shares.
- **Payment ledger close** selects native donor payments and explicitly assigned original classic payments by their actual ledger close time.

Choose an organization, an initiative within that organization, or a donor address. Leave the donor empty for a consolidated statement. A saved statement is also a reusable reporting group: reopen its selection and issue another version.

Preview shows registry asset totals and original reported USD separately from the actual ledger payment assets. It shows attributed CARBON, every known certificate allocation, remaining CARBON and the separately dated retirement register.

A certificate can be dated after the selected donation/payment period. Its allocation is shown as known in the retained source edition. The retirement register uses the certificate's own date. Whole certificate VCU quantity and attributed CARBON remain separate.

Save the statement. Revisions create complete retained versions; earlier versions preserve their source selections, original records and saved assignment/funding snapshots.

Every version supplies nine complete files:

| File | Purpose |
| --- | --- |
| statement.html | Readable standalone customer or partner statement; print or save to PDF |
| statement.json | Full statement, selected original records, source metadata and frozen operator decisions |
| donations.csv | Original registry donation records |
| payments.csv | Distinct selected original token transfers and attributed atomic amounts |
| payout-funding.csv | Exact donor funding parts for each related original provider payout |
| carbon-contributions.csv | Attributed sink contributions, filled and remaining quantities |
| carbon-allocations.csv | Individual original certificate allocations |
| retirement-register.csv | Linked certificates whose own retirement dates fall in the selected period |
| receipt-records.csv | Original receipts and their original payment and minted-token identities |

The contribution and certificate-allocation CSVs are separate so aggregating certificate rows cannot duplicate contribution totals.

## 7. Compare fresh source editions and carry the work forward

Import or capture the next complete edition. **Compare editions** reports every added, removed and changed native record using the original source identities.

For unchanged original Donation and ledger payment records, **Carry unchanged payment assignments** copies the saved association into the chosen new registry/ledger editions. Changed amounts, identities, dates or assets remain in the comparison for review. Existing statement versions keep their original editions.

Prepare the next period or issue a revised statement version using the fresh source selection. The funding and carbon association screens retain the source revisions they apply to.

## 8. Receive a complete independent editable workspace

**Export complete workspace** downloads all original source editions and response bodies, payment assignments, payout methods, carbon associations, statements and versions, history and replay records.

In **Import and receive**, choose the whole handover JSON and a new absolute private directory. The received workspace opens with its own local identity. Staff can edit its original mappings, import the next source edition, issue another statement and export a fresh handover.

~~~sh
starforge givecredit-statements handover \
  --directory "$HOME/givecredit-workspace" \
  --out "$HOME/givecredit-complete-workspace.json"

starforge givecredit-statements receive \
  --directory "$HOME/givecredit-received" \
  --file "$HOME/givecredit-complete-workspace.json"

starforge givecredit-statements serve \
  --directory "$HOME/givecredit-received" --port 0
~~~

Receiving creates a new saved workspace and preserves the current one. Close a running listener before opening another writer for its directory. A browser-received listener runs with its parent process; its saved directory reopens independently through serve or Merchant Applications.

A whole workspace is the complete staff handover. A donor or partner receives the selected statement's complete export files.

## Installation and recurring operation

The same operator supports one original CFCE organization and deployment, ten or more initiative/donor reporting groups, selected historical periods and the first current period. The commercial scope defines which groups and periods the team operates; the product has no artificial ten-group limit.

Commissioning consists of receiving the actual original registry/API source, acquiring native payments, reviewing legacy source associations, saving the agreed payout funding method, linking the relevant carbon records and issuing the selected reports. The partner receives both the complete source and an editable workspace.

A recurring run captures one fresh source edition, compares the originals, carries unchanged payment assignments, reviews the affected payout/carbon source relations, issues each selected statement and a consolidated report, and hands over the complete retained workspace. A correction creates a new statement version and preserves the earlier delivery.

## Native operation fields

| Operation | Required original values |
| --- | --- |
| payment-link | registryEditionId, ledgerEditionId, donationId, paymentKey, amountAtoms, note |
| allocation | ledgerEditionId, payoutKey, method, selected paymentKeys or explicit parts; source capacities where needed |
| bridge | ledgerEditionId, carbonEditionId, payoutKey, allocationId, sinkHash, paymentAtoms, carbonAmount, note |
| statement | title, basis, fromDate, beforeDate and the selected source edition IDs |
| carry-payment-links | fromRegistryEditionId, toRegistryEditionId, fromLedgerEditionId, toLedgerEditionId |

Edits include the original record ID and current expectedVersion. Statement edits use the current saved-version count. The CLI reads the current workspace revision and accepts an original stable request ID for replay.

The complete native command help and typed interfaces expose every intake, paged record, allocation, comparison, export and receiving operation.

## Comparing source coverage

The comparison retains each edition’s observed row counts and acquisition scope. A table is compared only when both source editions acquired it. Complete native Stellarcarbon backups cover all seven tables; native API captures cover the five declared tables. Distribution transactions and minted blocks remain unavailable in an API-only edition. Their comparison change counts are `null`, their change arrays are empty, and the operator screen and CSV label the comparison unavailable. This avoids interpreting an unacquired table as deleted records. Registry imports likewise preserve their explicitly supplied table coverage. Added, removed and changed rows describe differences within the retained source populations.

The HTTP and CLI comparison JSON expose `comparisonStatus`, `coverage.before`, `coverage.after` and `note` for each table. CSV exports include coverage columns and an unavailable row where a table could not be compared. Complete native receiving retains the original source editions and all saved statement versions.

Typed carbon amounts compare by their exact scaled values, and civil dates compare by their original day. Equivalent source formatting and changes in which fields are reported remain in `sourceDifferences`, with all raw before/after values retained. An API-omitted contract identifier is an unavailable field. Instrument metadata updates remain explicit; source-reported year 0001 and zero total-vintage placeholders carry a source note, while the separate retired VCU and allocation amounts retain their original values.

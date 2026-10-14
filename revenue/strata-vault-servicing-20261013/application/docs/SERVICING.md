# Retained vault history and statements

This optional extension preserves observations from the current Strata asynchronous vault. It adds durable servicing history and statements to the existing application; it does not change its contracts, signer, authority model or administrative writers.

The selected contract source is BootNodeDev/strata-vault-kit at 400754230a3fecaa69385687ba8457f1c2250d13. Current asynchronous requests and epoch pricing are authoritative. The historical synchronous-vault gist is not this implementation. Valuation history and reconciliation are proposed future extensions in the current architecture, not an assertion that an awarded milestone is unfinished.

## Install with the original project

Use the complete current repository plus this source overlay. Preserve the original Apache-2.0 license, AGENTS.md, package-lock.json, environments.toml and generated-client scripts. Install the original exact dependency lock with npm ci, using Node 22.16 or newer. The project selects @stellar/stellar-sdk 16.1.0. The collector verifies that installed SDK version and its own complete SOURCE.json roster before opening a workspace.

The existing application still builds through its original generation pipeline:

```sh
npm ci
npm run build --workspace app
```

The app's prebuild generates addresses and clients from the selected deployment; retain the original PUBLIC_STELLAR_* and ADDRESSES_ENV selection. Do not replace generated clients with guessed bindings. Contract builds use the original stellar contract build command when contracts themselves need building; this servicing collector neither builds nor deploys a contract.

The new application route is /history. It opens a complete archive file, retains the original in browser storage, and derives statements locally. It can display an archive from a different selected deployment without changing the application's current wallet or transaction configuration.

## Select the original deployment

Create an ordinary JSON binding file. Replace each placeholder with an actual selected contract ID; all six distinct addresses are required.

```json
{
  "network": {
    "id": "testnet",
    "passphrase": "Test SDF Network ; September 2015",
    "rpcUrl": "https://soroban-testnet.stellar.org"
  },
  "contracts": {
    "async_vault": "SELECTED_VAULT_CONTRACT",
    "share_token": "SELECTED_SHARE_TOKEN_CONTRACT",
    "nav_oracle": "SELECTED_NAV_ORACLE_CONTRACT",
    "identity_verifier": "SELECTED_IDENTITY_VERIFIER_CONTRACT",
    "compliance": "SELECTED_COMPLIANCE_CONTRACT",
    "asset": "SELECTED_SETTLEMENT_ASSET_CONTRACT"
  },
  "startLedger": 123456,
  "sourceCommit": "400754230a3fecaa69385687ba8457f1c2250d13"
}
```

startLedger is inclusive and operator-selected. It is not automatically the deployment ledger. Selecting a recent ledger cannot recover older expired history. Select the exact original deployment addresses from its retained record, not addresses inferred from a name or asset symbol.

The collector uses getNetwork to bind successful reads to the selected passphrase. HTTPS is required except for an explicit loopback local development RPC. It accepts no wallet key and invokes no submit/deploy/sign method. RPC endpoint URLs and full response headers travel in the exported archive; use the intended public endpoint and treat an archive containing private endpoint metadata accordingly.

## Initialize, collect and continue

Use an absolute private directory outside the application source. Stable request IDs identify the original action.

```sh
node scripts/servicing/cli.mjs init --directory /ABS/vault-history --binding /ABS/binding.json --request-id vault-history-init
node scripts/servicing/cli.mjs snapshot --directory /ABS/vault-history --request-id snapshot-opening --label "Opening observed state"
node scripts/servicing/cli.mjs collect --directory /ABS/vault-history --request-id capture-001 --max-pages 100
node scripts/servicing/cli.mjs status --directory /ABS/vault-history
```

Omitting --to-ledger freezes the original getHealth latest ledger when that capture is first created. An explicit --to-ledger freezes that ending ledger instead. Repeating the same ID and original selection continues incomplete work or adopts the completed result. max-pages controls work per continuation and may change; it does not change the selected range. Finish an existing incomplete capture before starting another.

Each page is retained before its cursor is acknowledged. The same reviewed process lease prevents a second collector from writing the workspace. SQLite FULL synchronization and one transaction bind accepted source and progress. Failed read attempts and complete original responses are retained. Complete or partial raw response bytes, status and headers are durably retained before UTF-8 parsing; invalid UTF-8 and interrupted bodies remain exact binary evidence. Finished reads bind their full request and raw byte receipt to the retained source. On interruption, a retained successful original page is adopted before issuing its equivalent next read again.

getEvents begins with inclusive startLedger and exclusive endLedger, all six selected contracts and a page limit of 1000. Cursor continuations omit start/end as the original RPC requires. Events beyond the frozen end remain in the original response but are excluded from that capture's derived history. A short terminal page or observation beyond the original ending ledger proves completion; a max-pages pause does not.

If the selected beginning predates the node's retention, the collector records a GAP with the original health observation and advances only through that declared gap. If retention expires during a partially captured range, its pages remain INCOMPLETE; the collector does not relabel them complete. Preserve that archive and acquire an actual earlier source if available.

## Observe state without changing it

```sh
node scripts/servicing/cli.mjs snapshot --directory /ABS/vault-history --request-id snapshot-closing --label "Closing observed state"
```

Snapshots retain all six original instance ledger keys and the exact returned XDR and ledger context. They do not claim to enumerate investor storage or to restore archived state. A missing entry is missing evidence.

Treasury reconciliation compares two retained vault NetDeployed values against complete intervening Deployed minus Funded events. It becomes UNKNOWN when the required snapshot, decoded movement or complete interval is absent. A DIFFERENCE remains an investigation item with original evidence; the service never rewrites the contract counter.

NetDeployed is signed and can be negative, because anyone can fund the vault. It is not an off-chain asset valuation. Direct asset transfers, issuer actions and off-chain custody records are not invented from this counter.

## Export and open the complete history

```sh
node scripts/servicing/cli.mjs export --directory /ABS/vault-history --out /ABS/exports/history-001.json
node scripts/servicing/cli.mjs inspect --archive /ABS/exports/history-001.json
```

Output files are create-only or exact replay. Choose a new filename for a later edition. The archive carries the selected binding, original complete RPC sources, event ranges, state snapshots, collector command/read-attempt journal, operator notes and whole-body SHA-256. A hash establishes that the retained bytes have not changed; it is not a signature by the network or an independent endorsement of the RPC provider.

Open the full JSON file on /history. The interface separates activity, requests/statements, valuations, epochs, treasury/wind-down and coverage/source. Original events carry their IDs, transaction hashes and full XDR. Unrecognized or malformed events remain visible; they are not silently discarded as no activity. The selected archive's network and all six contracts remain explicit even if the current app uses different addresses.

Amounts retain integer strings. Asset amounts are exact asset atoms: the selected asset address has no proven decimal metadata in this archive. Only the current ShareToken guarantees seven decimals. NAV is an 18-decimal WAD ratio of asset atoms per share atom; it is not a human-unit asset/share price. No financial arithmetic goes through JavaScript floating point. Report and statement JSON retain the complete exact records. CSV retains complete original row JSON along with its archive identity, network, vault and row type.

## Prepare an investor statement

```sh
node scripts/servicing/cli.mjs statement --archive /ABS/exports/history-001.json --controller SELECTED_G_OR_C_ADDRESS --from-ledger 123456 --to-ledger 124500 --format json --out /ABS/exports/investor-001.json
node scripts/servicing/cli.mjs statement --archive /ABS/exports/history-001.json --controller SELECTED_G_OR_C_ADDRESS --from-ledger 123456 --to-ledger 124500 --format csv --out /ABS/exports/investor-001.csv
node scripts/servicing/cli.mjs report --archive /ABS/exports/history-001.json --view treasury --format csv --out /ABS/exports/treasury-001.csv
```

A cancelled request followed by a new request in the same epoch is a separate episode. A claim across missing coverage or with a different original quantity does not inherit an earlier request identity: the earlier request stays incomplete and the later conclusion is an uncertain missing-start episode. Recognized financial events must retain the selected original symbol/address/u64/i128 XDR types before contributing to derived totals. An observed claim without its request is marked missingStart. Deposits, share claims, redemption requests, returned shares, cash claims and wind-down payouts are separate totals; they are not netted into a fabricated portfolio value. Totals include valid observed events in the selected interval. Episodes may include earlier/later evidence that explains a selected lifecycle; each event retains its exact ledger.

The current NAV report contains price, acceptance timestamp and expiry only. The service does not add a proof-reference field that the current contract does not emit. Aggregate epoch pricing and individual floor-rounded claims remain separate observations. Refunds emitted through DepositCancelled after pricing are labelled as possible zero-share refunds; the service does not infer an unobserved invocation.

## Receive and continue independently

```sh
node scripts/servicing/cli.mjs receive --directory /ABS/recipient-history --archive /ABS/exports/history-001.json --request-id receive-history-001
node scripts/servicing/cli.mjs note --directory /ABS/recipient-history --request-id recipient-note-001 --file /ABS/operator-note.txt
node scripts/servicing/cli.mjs export --directory /ABS/recipient-history --out /ABS/exports/recipient-history-001.json
```

Receive selects a new directory, validates the whole original archive and retains its complete original command and source history. Original request IDs are not renamed. Portable child validation requires all original sources, snapshots, notes, read attempts, completed commands and received envelopes to remain exact. Only an original incomplete capture may advance with the same selection and preserved page prefixes, with explicit source-bound gaps if retention moves. Completed captures replay; an incomplete capture retains its original cursor and automatic/fixed ending selection. The next new capture begins after the durable covered range. Recipient notes append independently. Source edition compatibility is checked when reopening a workspace.

Keep the full source overlay and original repository/lock with the archive for an independent recipient. Do not overwrite a live installation or workspace to change the executing source edition.

## One original read-only receiving course

After selecting an actual original deployment and retained range:

```sh
node scripts/servicing/receiving.mjs --directory /ABS/original-receiving --binding /ABS/binding.json --operation-id STRATA-HISTORY-ORIGINAL --to-ledger 124500 --controller SELECTED_G_OR_C_ADDRESS
```

The course initializes one producer, reads actual network/state/events, saves complete report/CSV, receives the archive into an independent customer, appends its original note, exports a return and cold-opens that return. It preserves all original sources and continuation. Stable input/source/runtime and exact artifacts are verified before adopting COMPLETE. The completion record distinguishes completion of archive receiving from source coverage: a wholly expired selected range can finish transfer with captureStatus GAP and explicit missing-range evidence. It never widens that frozen interval. An INCOMPLETE source range remains partial and must resume the same operation. The course invokes no contract transaction.

Run `node scripts/servicing/exercise.mjs --directory /ABS/authored-exercise` in a separate selected directory. This separate exercise.mjs command uses labelled authored RPC responses encoded with the actual selected SDK to exercise cancellation/re-request, exact integer amounts, gaps, original capture replay and portable receiving. It is software behavior evidence, never a claim that an investor or business transaction occurred.

## Render and use the outgoing product

Before any client/demo-ready claim, the producing operator must render the exact outgoing application and actually use /history at a narrow phone-width viewport and a screenshare/desktop viewport. Open the actual archive, switch all six views, use account/range filters, inspect full original RPC/XDR and snapshots, prepare an investor statement, download and reopen every relevant JSON/CSV attachment, reload and reopen the browser's saved original, and compare its network/contract binding with the current app. Exercise complete/partial/missing-source and storage-failure presentation with labelled software inputs where actual source lacks those cases.

Retain the original owner's whole rendered-product and attachment instruction with the source handback. Compilation, a source-level exercise or a screenshot without using controls is not evidence of the full product course. The equipped host should execute the existing source-native build and original receiving queue; do not create a competing native job.

## Primary sources

- Current full source: https://github.com/BootNodeDev/strata-vault-kit/tree/400754230a3fecaa69385687ba8457f1c2250d13
- Original protocol and authority/compliance descriptions: docs/kit-spec.md, docs/strata-product-and-architecture.md, docs/AUTHORIZATION_MATRIX.md, docs/COMPLIANCE_MATRIX.md.
- RPC getEvents: https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents
- RPC getLedgerEntries: https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries
- RPC pagination: https://developers.stellar.org/docs/data/apis/rpc/api-reference/structure/pagination

## Complete derivative and owner instructions

The complete current application is described in ../DERIVATIVE_NOTICE.md and bound by ../DELIVERY_SOURCE.json; the unchanged upstream member identities are in ../UPSTREAM_SOURCE.json. Follow ../OWNER_INSTRUCTIONS.md and SERVICING_RECEIVING.md for the same original public staging, archive, customer-return and rendered application course. Original vendor instructions and all license/attribution files are retained unchanged. Source delivery does not claim a completed build, actual provider read or viewed product.

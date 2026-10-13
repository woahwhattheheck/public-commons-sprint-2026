# CFCE / GiveCredit donor and initiative statements

A complete native operator for the original GiveCredit registry, Stellar payments, pooled provider payouts and Stellarcarbon allocations. The original registry edition, ledger edition and carbon edition remain distinct. Operators save the exact associations used for each statement.

Operation: **SCF-CFCE-GIVECREDIT-8D45-20261012**.

[Complete operator guide](../../../../products/cfce-givecredit-statements/README.md) · [Command interface](./cli.mjs) · [Typed core](./core.d.mts) · [Native capture](./ledger.mjs) · [Large checkpoint storage and recovery](./CHECKPOINT_STORAGE.md)

## Original source contract

The implementation follows [CollaborativeEconomics/monorepo at 3d20065447bd56c9c05a3e658ccd11e0b9cb985e](https://github.com/CollaborativeEconomics/monorepo/tree/3d20065447bd56c9c05a3e658ccd11e0b9cb985e).

| Original source | Applied behavior |
| --- | --- |
| packages/database/prisma/schema.prisma | Donation and receipt values retain Decimal(14,4); original IDs and relationships stay intact |
| packages/database/src/database/donations.ts | Full offset pages, original created timestamps, organization/initiative/wallet selectors and nested impact links |
| packages/database/src/database/nftData.ts | Original donor payment transactionId and separately minted tokenId/contractId; multiple receipt rows can share a payment |
| packages/utils/src/mintReceiptNFT.ts | Original payment hash survives receipt creation; the original Donation UUID remains optional |
| packages/components/src/donationForm/DonationForm.tsx | A saved Donation and its receipt may require an explicit legacy association |
| packages/blockchain-tools/src/contracts/soroban/credits/src/contract.rs | Actual gross payment, immediate vendor transfer, provider share, bucket payout and provider remainder |
| packages/blockchain-tools/src/contracts/soroban/credits/src/events.rs | Ordered donation and configuration-change events |
| packages/blockchain-tools/src/contracts/soroban/credits/src/storage.rs | Separately retained contract settings and accounted provider balance |

The production registry base is **https://registry.cfce.io/api**. The original configured organization is **04340418-765d-48ab-af36-512a66c960b4**. Native mainnet capture starts from the original Credits contract **CAIRWEYKTLVRQBXQGYNLDUAKWIUV4NO6WPTCMVHH2BOMUUUBTXRJF43R** and configured account **GD2IBAC2WK3XOD64APP4OKQTX4URQFAH5WRHODEOJF7EN2MLDOV45VKI**. Operators can select a different original deployment.

The Stellarcarbon source contract and complete seven-table published edition are reused from [the maintained companion desk](../stellarcarbon-statements/). That edition is pinned to [stellarcarbon/sc-data d7c10873e98993616af561dd3d00a6e0ae81e3cc](https://github.com/stellarcarbon/sc-data/tree/d7c10873e98993616af561dd3d00a6e0ae81e3cc/sc-audit), published April 14, 2026. Its raw source bodies remain in the original component.

## Native composition

Use Node 22 or newer on Linux, the existing Merchant private-file/flock runtime and the original **@stellar/stellar-sdk ^16.3.0** peer. The distribution contribution registers the command, all typed exports, browser assets and Applications provider without editing another product's source.

| Module | Responsibility |
| --- | --- |
| source.mjs | Exact original rows, preserved numeric lexemes, source validation and registry/carbon intake |
| engine.mjs | Explicit payment associations, pool funding, carbon allocation, versioned statements and edition comparison |
| funding.mjs | Source-dated funding capacity and native ordering before a payout |
| capture.mjs | Complete original registry list traversal, original bodies, relation closure and checkpoints |
| ledger.mjs | Original RPC/Horizon/XDR capture, provider transfer closure, historical metadata and contract observations |
| store.mjs | Private files, original kernel lease, atomic saves, exact source digests and independent receiving |
| exports.mjs | Complete readable HTML, JSON and seven CSV exports |
| server.mjs | Bound local operator API and background native source acquisition |
| client.mjs | Browser/native HTTP client bound to its own workspace |
| public/ | Complete industrial operator workflow |
| cli.mjs | Whole source acquisition, statement operations, exports and receiving |
| application-provider.mjs | Original Merchant Applications preparation, identity guard and listener discovery |

The main command is **starforge givecredit-statements**. From a source checkout, use:

~~~sh
node stellar/scf-starforge-20261009/partners/cfce-givecredit-statements/cli.mjs help
~~~

Typed package exports are **./givecredit**, **./givecredit/core**, **./givecredit/client**, **./givecredit/capture**, **./givecredit/ledger**, and **./givecredit/server**. The core source/statement/export layer does not require an SDK import. Native ledger acquisition lazily imports the original peer.

## Whole source edition format

Every imported edition uses **stellar-forge.givecredit-source.v1** and contains:

| Field | Meaning |
| --- | --- |
| kind | registry, ledger or carbon |
| metadata | Original source, network, query selection, source bounds, retrieval times, coverage, source notes and progress |
| files | Complete original text bodies keyed by their retained names |
| responses | Original URL, request query/body, retrieval time, status and complete response content |
| tables | All normalized original records for the declared source kind |
| carbon | The complete original Stellarcarbon edition when kind is carbon |

Registry tables are **donations, nfts, organizations, initiatives, credits, providers, stories, impactlinks**. Ledger tables are **transactions, transfers, donationEvents, contractObservations**. Source numbers are strings before JSON parsing can round them. Ledger atoms use exact integers; native/classic Stellar asset precision follows the original asset identity. Custom token precision retains its source metadata and observation ledger.

Imports are named, immutable editions. The native store computes a digest over the complete metadata, files, responses and records; reopening checks that same original source body. A whole-workspace export keeps every edition and saved operator record.

## Registry capture contract

**captureRegistry(options)** uses the operator's existing authorized registry API key. It preserves all successful and failed response bodies while omitting authentication headers from the retained source.

The original API returns **success/data** list envelopes, including its normal HTTP 201 responses. Capture follows zero-based pages through an empty terminal page, with a maximum native page size of 200. It rechecks the first page after traversal and stops with its complete checkpoint if a page repeats or an original row changes during that acquisition.

| Table | Original list | Scope |
| --- | --- | --- |
| donations | GET /donations | Selected orgId or all accessible donations |
| nfts | GET /nft?chain=stellar | Selected orgId; the original route requires chain even for lists |
| organizations | GET /organizations | Original accessible catalog |
| initiatives | GET /initiatives | Selected orgId |
| credits | GET /credits | Original accessible catalog |
| providers | GET /providers | Original accessible catalog |
| stories | GET /stories | Selected orgId |
| impactlinks | donations[].impactlinks | Complete relation closure, including original nested stories |

The source's inclusive date filter only activates when both endpoints are supplied. Acquisition keeps the whole organization edition and performs half-open statement filtering locally, so later receipt and impact relations remain available. Live offset pagination is labeled with its actual capture interval and consistency scope.

**receiveRegistryFiles(files, metadata)** accepts original arrays, original list envelopes or NDJSON tables as complete raw strings. It preserves all supplied fields. An explicit file import declares exactly the tables it contains.

## Original Stellar capture

**captureLedger(options)** verifies the selected RPC and Horizon network passphrases, retains original contract state, pages native contract events to the frozen range boundary, loads every original receipt/payment hash and closes the source-observed provider account and token-event history.

Default mainnet sources are:

- https://mainnet.sorobanrpc.com
- https://horizon.stellar.org
- https://archive-rpc.lightsail.network/

Original transaction metadata is decoded through the matching Stellar SDK XDR definitions. The collector retains the full response and original XDR. Older identified transaction hashes use their original ledger's getLedgers metadata when available.

A transfer retains its original asset, amountAtoms, addresses, network, ledger, close time, operation/event index and raw source references. Fee-bump inner and outer hashes resolve to the original envelope identity. A failed fee-bump envelope remains distinct from a later successful envelope sharing its inner transaction hash.

Classic path-payment records retain the payer debit in their original source asset, plus the actual destination asset and delivered amount. Token events are decoded from the full native transaction, including provider contract addresses. Source-observed contract settings and token metadata keep their own dated observation.

The acquisition status reports original source coverage and source notes. Unknown token decimal metadata remains attached to the original raw body until the actual source supplies its scale. Interrupted acquisition retains its checkpoint and resumes with the same source selection.

## Accounting semantics

A registry Donation, an NFT receipt and an original token transfer are different records. The receipt's original payment transactionId is an anchor, while its minted tokenId is a separate receipt identity. Multiple receipts can refer to one payment. Only saved operator Donation-to-payment assignments attribute token amounts to a registry record.

A contract donation transfers gross tokens in, pays its immediate vendor fee, accumulates its provider share, pays complete bucket multiples and retains the remainder. The source's provider remainder and the actual contract token balance are separate observations. Current configuration is never used as the historical rate for an older donation.

Provider payouts are classified within the native donation call, using the matching incoming transfer through the terminal donation event. Vendor and provider may share an address. A resolved provider transfer and an operator-resolved source candidate carry their classification basis into the saved funding allocation.

Funding uses the original provider contribution capacity, with prior allocated funding deducted. Gross original donor amounts can remain the proportional weights. The native order must put a funding payment before its payout. If source capacity or ordering needs an operator association, the saved entry retains that decision and its source note.

Allocation methods are **PROPORTIONAL_GROSS**, **FIFO_GROSS** and **EXPLICIT**. Exact integer atoms, source capacities and stable native-key ties control rounding. Every allocated payout equals the original transfer amount.

A payout-to-sink association saves both **allocationVersion** and the whole **allocationSnapshot**. Later allocation edits leave that association's donor proportions intact. Editing the association explicitly adopts the selected current funding revision.

CARBON uses three-decimal native precision. All original sink-to-certificate fills participate. The unassociated part of a source sink remains part of the capacity-limited allocation, so rounding cannot assign it to a selected donor. Each certificate's full VCU quantity appears once in the certificate register.

## Statements and source dates

Two statement bases are supported:

- **REGISTRY_CREATED** selects the original Donation.created period. Assigned original payment shares and later known carbon allocations remain attached.
- **LEDGER_CLOSED** selects successful native donor payments and explicitly assigned original classic payments by their ledger close period. Organization and initiative filtering requires the selected registry source.

Every period includes **fromDate** and excludes **beforeDate**. A selected contribution's later known certificate allocations remain visible. The retirement-date register separately selects the certificate's own retirement_date.

A saved statement version freezes the selected source metadata, original records, payment assignments, funding allocation revisions and payout-to-sink associations. The full source editions remain available in the editable workspace. Reissuing creates a new saved version.

The nine exports are statement.html, statement.json, donations.csv, payments.csv, payout-funding.csv, carbon-contributions.csv, carbon-allocations.csv, retirement-register.csv and receipt-records.csv. Contribution totals and individual certificate fills have separate CSV tables.

## HTTP and receiving contract

The server listens on a loopback address and exposes **/givecredit/**. Writes carry **X-GiveCredit-Workspace** with the original selected workspace ID. Browser clients bind that identity only from their own **GET /api/state** response.

| Route | Operation |
| --- | --- |
| GET /api/state | Current source selections, mappings, saved statements and acquisition state |
| GET /api/choices | Native records for source-specific forms |
| GET /api/donations, /api/transfers | Complete paged registers |
| GET /api/donations/:id, /api/transfers/:key | Original full records and saved relationships |
| GET /api/pools | Separate flow, provider remainder and token-balance observations |
| GET /api/editions/:id | Original source overview, tables and whole-file links |
| GET /api/editions/:id/tables/:table | Complete original table pages |
| GET /api/statements/:id | Selected frozen statement version |
| GET /api/statements/:id/files/:name | Complete original statement export |
| GET /api/compare | Added, removed and changed original keyed records |
| POST /api/import | Whole source intake |
| POST /api/preview/:kind | Full allocation, association or statement preview |
| POST /api/operations/:action | Versioned operator mutation |
| POST /api/capture/:kind | Background original acquisition |
| POST /api/capture/:kind/stop | Pause with retained source checkpoint |
| GET /api/handover | Complete editable staff handover |
| POST /api/receive | New independent private workspace and local listener |

Mutations carry the current workspace revision and a stable request ID. Replaying the same operation returns its saved result. A received workspace has a new identity and keeps its original source editions, statements, mappings and history. Browser receiving creates a child listener; the saved directory also reopens independently through the CLI and Merchant Applications.

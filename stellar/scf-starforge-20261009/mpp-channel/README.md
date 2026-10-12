# MPP channel work

Open and fund a selected Stellar channel, then operate recurring paid tasks through it. The original MPP workspace retains the task budget, each original request, cumulative commitment, merchant delivery, paid response, channel funding, ongoing collection and final close. The browser, installed command, JavaScript and Python clients all use the same native records and lease.

This application adds the native **channel** intent beside the existing Charge product. Its wire protocol is the pinned Stellar MPP channel implementation: incremental challenge amounts, cumulative vouchers and the existing one-way-channel contract. Each receiving application carries the full operating history and the complete source needed to reopen it.

## Open the installed application

Use the original selected MPP product and its exact native runtime:

```sh
starforge mpp-workspace open --dir "$MPP_PRODUCT"
starforge mpp-workspace channel state --dir "$MPP_PRODUCT"
starforge mpp-workspace channel help
```

Open **Channel work** in the original browser. The browser keeps the existing private console session, displays the actual workspace records and sends operations to the original job queue. A second source workspace is unnecessary.

A received application can open its native workspace directly:

```sh
node "$RECEIVED_APPLICATION/stellar/scf-starforge-20261009/mpp-channel/cli.mjs" \
  serve --workspace "$MPP_WORKSPACE"
```

The original workspace must be stopped before the direct command acquires its lease. Attached commands use `--dir` and share the running product.

## Open and initially fund a channel

Use **Open a channel** in Channel work when the customer and merchant need their first channel. Keep an existing deployed channel by selecting its original identity in the task or merchant form.

Choose the actual network, token, funder account, recipient, commitment public key, initial amount, refund waiting period and selected contract edition. The setup derives the channel address from the network, funder and retained salt. Its signed deployment includes that exact salt, WASM hash and original constructor arguments.

### Select the source and deposit

| Selection | Meaning |
|---|---|
| Network and RPC | The RPC must report the selected Stellar network before observation, preparation, submission or recovery. |
| Token and decimals | The selected SEP-41 token contract and its display precision. Every amount is a canonical string in that token's base units. |
| Funder and signer | The original `G…` account pays transaction fees and deposits its selected tokens. The funding account must equal that funder. The host reads its secret only from the selected environment-variable name. |
| Recipient | The actual merchant's `G…` or `C…` address that will collect earned commitments. |
| Commitment public key | The actual `G…` public key for the customer's off-chain commitments. The funder and commitment signer may use different keys. |
| Initial amount | The selected nonnegative base-unit amount deposited by the original constructor. A zero deposit opens an empty channel for later top-up. |
| Refund waiting period | An exact unsigned 32-bit number of ledgers. Select it with the merchant so the recipient has time to collect after a funder starts closing. |
| Contract edition | The original source URL and the 64-character lowercase SHA-256 of its actual compiled WASM. |
| Code mode | `existing` receives and retains the selected code already on that network. `upload` receives the selected compiled file from the native host and uploads it if that code is absent. |
| Salt | Leave it blank on the first preparation to generate and retain 32 random bytes. Reuse the returned salt and opening ID for every continuation. |
| Maximum fee | The operator's maximum stroops per transaction. The review also shows the total cap for the selected one- or two-transaction setup. |

The browser imports and exports the complete setup document. **Prepare opening** captures the exact compiled code bytes and derives the final channel address without signing. Existing-code mode requires that exact code on the selected network. Upload mode reads the original host's absolute WASM path, checks its binary header and digest, and retains the complete bytes before authorization. Subsequent execution uses those retained bytes.

The installed interface exposes the same selection:

```sh
starforge mpp-workspace channel opening-template --dir "$MPP_PRODUCT"
starforge mpp-workspace channel opening-prepare --dir "$MPP_PRODUCT" \
  --input "$COMPLETE_OPENING_INPUT"
starforge mpp-workspace channel opening-execute --dir "$MPP_PRODUCT" \
  --input "$ORIGINAL_OPENING_ID_INPUT"
starforge mpp-workspace channel openings --dir "$MPP_PRODUCT" \
  --id "$ORIGINAL_OPENING_ID"
```

The preparation input is `{openingId, profile}`. Copy the template profile returned by `opening-template` and complete its selections:

```json
{
  "openingId": "customer-channel-opening-20261012",
  "profile": {
    "schema": "stellar-forge.mpp-channel-opening-profile.v1",
    "title": "Selected customer and merchant recurring work",
    "channel": {
      "network": "stellar:testnet",
      "address": "",
      "token": "ACTUAL_TOKEN_CONTRACT",
      "funder": "ACTUAL_FUNDER_ACCOUNT",
      "recipient": "ACTUAL_MERCHANT_ADDRESS",
      "commitmentKey": "ACTUAL_COMMITMENT_PUBLIC_KEY",
      "decimals": 7,
      "wasmSha256": "ACTUAL_COMPILED_CODE_SHA256",
      "contractSource": "ORIGINAL_CONTRACT_SOURCE_URL",
      "rpcUrl": "https://soroban-testnet.stellar.org/"
    },
    "dependencyRoot": "/absolute/private/selected-native-runtime",
    "opening": {
      "salt": "",
      "initialAmountAtomic": "SELECTED_BASE_UNIT_AMOUNT",
      "refundWaitingPeriod": "REPLACE_WITH_SELECTED_LEDGER_COUNT_NUMBER",
      "codeMode": "existing"
    },
    "funding": {
      "account": "ACTUAL_FUNDER_ACCOUNT",
      "keyEnv": "MPP_CHANNEL_FUNDER_SECRET",
      "maximumFeeStroops": "SELECTED_MAXIMUM_FEE_STROOPS",
      "operator": "accountable-operator"
    }
  }
}
```

This is a field guide with explicit replacement values. Supply actual Stellar addresses, source and amounts, and replace `refundWaitingPeriod` with the selected JSON number. For upload mode, set `codeMode:"upload"` and add `opening.wasmFile` with the absolute retained compiled-file path. Keep the generated salt and complete returned profile after the first preparation. Later execute, resume and cancel inputs contain only the original `openingId`; reconciliation also accepts a selected archival `rpcUrl`.

### Authorize and continue the original opening

**Authorize / resume** presents the original parties, exact source, deposit, refund period and fee limits in the product's controlling terminal. That authority covers the selected code upload, when required, and the channel creation. Task purchase budgets are selected separately after the channel opens.

An optional code upload and the actual channel creation each retain their original signed XDR, transaction hash, fee, expiration, before-signing ledger, submission attempts and finality. Each envelope is saved before broadcast. Channel creation uses the native SDK's direct `createCustomContract` operation. The application checks its complete create-contract host function and source-account authorization, including the exact original constructor and selected token transfer.

| State | Continue the existing operation |
|---|---|
| `DRAFT` | Correct the unsigned setup, or authorize its complete selected edition. |
| `AUTHORIZED` | Resume the selected setup; its original terminal authority is already retained. |
| `SIGNED`, `SUBMITTING`, `PENDING` | Resume the same signed stage or reconcile its original transaction hash. |
| `CODE_READY` | The selected code upload succeeded. Resume the original opening to create the channel. |
| `OPENING` | Creation succeeded; resume to finish the original channel observation and local setup. |
| `OPENED` | Use the retained channel identity for merchant setup and recurring work. Reopening completes any interrupted local finalization. |
| `HISTORY_REQUIRED` | Reconcile the same transaction through a selected RPC that retains its possible inclusion window. |
| `FAILED`, `EXPIRED` | Retain this final transaction and history. A newly selected attempt uses a new opening ID and fresh authority. |
| `CANCELLED` | An unsigned opening was cancelled. Its complete prior selection and any completed code-upload stage remain in the record. |

An archival RPC must confirm the same network. A `NOT_FOUND` response is treated as definitive expiration only when its closed-ledger time is past the signed maximum time and its retained history covers the whole possible inclusion window. An original signed stage is always recovered with its original envelope.

After successful creation, the application observes the actual code hash, token, funder, recipient, commitment key and refund period, then creates the original channel stream and its funder selection. The receipt carries the deployment hash, optional upload hash and observed balance. **Download channel identity** supplies that same selection to the merchant or customer workflow. The application resumes incomplete local finalization idempotently.

**Cancel unsigned opening** is available before the creation envelope is signed. An outstanding signed code upload must first reach a final state. The cancellation is saved before its operation reservation is released; interrupted cleanup resumes from the retained cancelled state.

### Receive an opening on another host

A prepared or interrupted opening appears in the existing complete operating-handover selector. Export its original derived channel identity, then receive that same full file in the selected product. The bundle carries the complete selected WASM, profile, salt, original authority, both transaction stages, SDK records and executable source. Its receiving runtime binding supplies the actual installed SDK path without rewriting the original profile.

Reopen `openings` with the original opening ID. Use `opening-resume` for its selected unfinished stage or `opening-reconcile` for the original signed transaction. Once `OPENED`, continue the merchant and customer's actual useful work in that same received channel.

## Select useful work and authorize its task budget

1. Open the selected channel through **Open a channel**, or select the actual original deployed channel, token, funder, recipient, commitment public key, WASM hash, source edition and RPC. Keep its returned identity throughout merchant setup and recurring work.
2. Start the merchant with its real authorized source and useful priced route. Load its public `/_mpp/channel-contract` through **Load a merchant offer**, or open the saved complete contract.
3. Select the offer, describe the recurring work and choose its accountable operator. Set a total budget in token base units, maximum amount per purchase, number of purchases and expiry.
4. Save the task edition. **Authorize task budget** presents the full source, channel, task, endpoint, selected merchant edition, unit and cap in the original controlling terminal.
5. Prepare each useful request with its stable purchase ID. **Execute** spends from the selected task authority. **Resume** continues the same saved commitment and response.

For example, a real source owner can expose an authorized dataset query, an explorer query or a document conversion as a priced route. Each request contains the actual input required for that unit of work. The source's edition, authorization and digest travel with its offer and task. This application does not create customer selections or source content.

### Budget corrections

A saved task has a current revision and immutable configuration digest. Correcting it creates a new planning edition and retains previous configurations and authorization history. Its committed amount and purchase count remain attached to the original channel. A budget cannot be reduced below work already committed. The operator authorizes the revised scope before further spending.

Stopping a task prevents new reservations. An already reserved or signed purchase can recover its original result. An unsigned reservation can be cancelled and releases its amount and count exactly once. A retained signed commitment is recovered using its original purchase ID.

### Run a real work list

The JavaScript client and installed command can process a complete supplied work list under a selected task cap. Stable purchase IDs allow the same file to resume after interruption.

```json
{
  "schema": "stellar-forge.mpp-channel-work.v1",
  "purchases": [
    {
      "taskId": "the-saved-task-id",
      "purchaseId": "the-original-unit-of-work-id",
      "request": {
        "url": "https://your-selected-merchant.example/your-route",
        "method": "POST",
        "json": {}
      }
    }
  ]
}
```

Replace the request with the real selected endpoint and useful input. Run it against the same native product:

```sh
starforge mpp-workspace channel run --dir "$MPP_PRODUCT" \
  --input "$ACTUAL_WORK_LIST" --out "$RUN_RESULT"
starforge mpp-workspace channel response --dir "$MPP_PRODUCT" \
  --id "$ORIGINAL_PURCHASE_ID" --out "$PAID_RESPONSE"
```

A running job keeps its ID when the command returns. Read that original job, then rerun the original list. Completed purchases return their retained responses; the same list never creates replacement payment IDs.

## Merchant setup

The merchant is a separate loopback listener, normally port 8789, exposed through the selected HTTPS origin. Its profile selects the actual channel and native dependency directory. Each route defines its authorized source, useful priced unit, incremental base-unit amount and JSON value, JSON file or installed handler.

| Profile field | Selected value |
| --- | --- |
| `title`, `publicOrigin` | Actual merchant name and its public HTTPS origin |
| `channel` | Network, contract address, token, funder, recipient, commitment public key, decimals, WASM digest, original contract source URL and RPC URL |
| `dependencyRoot` | Absolute directory containing the original installed dependency set |
| `secretEnv` | Environment variable holding the merchant's challenge authentication secret |
| `routes[]` | ID, GET or POST, path, description, priced unit, source, amountAtomic and resource |
| `routes[].source` | ID, edition, title, source URL, SHA-256 and the actual authorization for its use |
| `resource.kind` | `json` with value; `json-file` with absolute path; or `handler` with export name |
| `handlersModule` | Absolute original module path when any route uses a handler |
| `settlement` | Recipient account, signing-key environment variable, maximum fee in stroops and accountable operator |

Save its selected edition through the browser or `merchant-save`. Start the listener with its saved stream key. The state view supplies that exact key. Editing the selected profile preserves old deliveries and profiles. Stop and start the listener to operate the newly selected merchant edition.

A handler receives the original stable operation ID, request, route, source, accepted cumulative commitment and native receipt. It returns a `Response` or a JSON value. Implement work that is read-only or idempotent with that operation ID: an interruption after external work but before response persistence can invoke the same operation again. Maintain the original handler edition and its required files for incomplete deliveries.

The merchant atomically associates its native claim and cumulative acceptance with the original delivery ID and credential digest. Recovery resumes that actual accepted delivery, including a crash between the SDK's cumulative update and its challenge completion. It never borrows another request's accepted cumulative amount.

Completed responses retain their original bytes, status, headers and digest. Browser downloads use an attachment response; the native response record preserves its original media type.

## Fund, collect and return the original channel

The existing channel stays selected across recurring work, additional funding, merchant collection and refund. Funding and fee signatures belong to their actual funder or recipient accounts. The task's separately authorized work budget still governs every new purchase.

The contract interface used here is the original [one-way channel at 25dea1b3](https://github.com/stellar-experimental/one-way-channel/blob/25dea1b303495a7a4184af7605bbb7671ff08da6/contracts/channel/src/lib.rs). The application checks the selected channel's deployed WASM hash, parties, token and commitment key before signing or accepting a fresh commitment. Its native protocol remains [Stellar MPP SDK 0.7.1](https://github.com/stellar/stellar-mpp-sdk/tree/9f2f8254421e09906dfb7e983e2491a273120adf).

### Select the funder and add funds

In **Channel funds**, load the original channel. The application fills the actual network, contract, token, funder and selected dependency directory. Choose a profile title, accountable operator, signer environment-variable name and maximum transaction fee in stroops. **Save funding edition** retains the complete profile; correcting it preserves earlier operation profiles and transactions.

A funder profile contains:

| Field | Meaning |
| --- | --- |
| `schema` | `stellar-forge.mpp-channel-funder.v1` |
| `title` | Accountable funding profile label |
| `channel` | Complete original selected channel identity |
| `dependencyRoot` | Absolute installed native SDK directory |
| `funding.account` | The selected channel's actual funder G account |
| `funding.keyEnv` | Host environment variable containing that account's signing key |
| `funding.maximumFeeStroops` | Maximum fee for each explicitly selected transaction |
| `funding.operator` | Accountable operator ID |

The funder transaction route supports the original G-account signer. A C-address funder needs its existing contract-wallet authorization workflow; its account is never substituted with a local signer.

Select **Add funds**, enter one stable funding operation ID and the exact token amount in base units, then prepare. **Authorize** presents the original channel, amount, funder, operator and fee cap in the controlling terminal. The signed call is the original contract's `top_up(amount)`. The only permitted nested authorization is that token's transfer of the exact selected amount from this funder into this channel.

Use the installed command to create the same source-filled draft:

```sh
starforge mpp-workspace channel funder-template --dir "$MPP_PRODUCT" \
  --input "$SELECTED_STREAM_INPUT" --out "$FUNDER_PROFILE_DRAFT"
starforge mpp-workspace channel funder-save --dir "$MPP_PRODUCT" \
  --input "$COMPLETE_FUNDER_SELECTION"
starforge mpp-workspace channel funding-prepare --dir "$MPP_PRODUCT" \
  --input "$SELECTED_FUNDING_INPUT"
starforge mpp-workspace channel funding-execute --dir "$MPP_PRODUCT" \
  --input "$ORIGINAL_FUNDING_ID_INPUT"
```

`SELECTED_STREAM_INPUT` contains `{stream}`, using the actual key from `channel state`. The complete funder selection contains `{profile, expectedRevision}`. A top-up preparation contains `{stream, fundingId, action:"top_up", amountAtomic}`. Its execute/resume/reconcile/cancel input carries that same `fundingId`.

### Collect earned work while keeping the channel open

Choose **Collect earned amount and keep open** in the merchant section and enter a stable settlement operation ID. Preparation retains the highest original accepted credential, delivery, cumulative amount, signature and merchant profile. The recipient reviews that commitment, the observed amount still uncollected, pending deliveries, fee account and maximum fee.

The resulting `settle(cumulative, signature)` call transfers only the part above the contract's previous `WithdrawnAmount`. A successful collection is **COLLECTED** and permits later paid work on the same channel. Its completion clears only its own financial-operation marker; it does not mark the channel closed.

```sh
starforge mpp-workspace channel collection-prepare --dir "$MPP_PRODUCT" \
  --input "$SELECTED_COLLECTION_INPUT"
starforge mpp-workspace channel collection-execute --dir "$MPP_PRODUCT" \
  --input "$ORIGINAL_SETTLEMENT_ID_INPUT"
```

The preparation input is `{stream, settlementId}`; execute/resume/reconcile/cancel retain that same `settlementId`. A collection ID cannot be reused for a close, and a close ID cannot be reinterpreted as collection.

**Collect and close channel** uses `close-prepare` followed by `close-execute`. The original `close(cumulative, signature)` collects the unpaid amount, closes the channel and attempts to return the rest to its funder. A successful close is **SETTLED**. If the contract's automatic refund cannot transfer the rest, the funder can use the separate refund operation after close is effective.

### Correct balance and cumulative accounting

The commitment amount is a lifetime cumulative claim. The contract's balance is the token amount still held. After collecting a cumulative 40 from a deposit of 100, the remaining balance is 60 and the withdrawn cumulative is 40. A later cumulative commitment of 55 requires 15 more from the channel; it fits the remaining balance.

For each new commitment, the application requires:

```text
fresh cumulative - already withdrawn >= authenticated purchase amount
fresh cumulative >= current native cumulative + authenticated purchase amount
fresh cumulative - already withdrawn <= current channel balance
```

Task authorization uses the same unpaid commitment amount plus the selected task's remaining cap. Every purchase continues to consume its original task budget and lifetime cumulative counter.

The balance simulation and contract instance must report the same ledger. That instance supplies the original parties, commitment key, deployed WASM hash, withdrawal cumulative and closing state. If the ledger advances between the two reads, the application repeats that observation up to three times. This avoids mixing the balance from before a collection with a withdrawal amount from after it.

The merchant's coherent check runs inside the original SDK store's cumulative-update entry, after native signature and challenge/replay validation and immediately before the original atomic cumulative acceptance. The unpaid increment must cover the authenticated challenge price even if the local cumulative is below the observed withdrawal amount. Combined with the native atomic monotonicity rule, the required floor is the larger of the stored cumulative and already withdrawn, plus the new price. It replaces only the SDK's optional raw-cumulative-versus-balance query. The SDK still authenticates the commitment and enforces monotonicity, exact incremental payment and one-time challenge acceptance. A previously accepted original delivery recovers through its retained native acceptance and response.

The browser shows the actual remaining balance, total collected, closing/refund state and observation ledger. **Refresh chain state** performs a current selected-network observation. Reading the local workspace does not run background chain requests.

### Start the refund period and return the remainder

Select **Start refund waiting period** with a new stable funding ID. The funder authorizes the exact `close_start()` call and fee. After confirmation, the recorded close-effective ledger is displayed and new commitments stop.

When the chain reaches that ledger, select **Return remaining balance** with its own funding ID. The funder authorizes `refund()`, which transfers the balance remaining at execution back to the channel's original funder. The application checks the actual ledger deadline. Both operations use `funding-prepare` with `action:"close_start"` or `action:"refund"`; neither takes an amount field.

A refund record identifies the amount mode as `remaining-balance-at-execution`. Its full finality includes the original transaction result and metadata. The post-transaction balance is a separate current observation, because other authorized channel operations can occur before that read. Collection records likewise retain the authorized cumulative and observed expected collection separately from original finality.

### Resume the original financial operation

The signed Stellar envelope, original hash, fee, expiry and before-signing ledger are saved before submission. All financial operations share the same retained-transaction receiver. A transport interruption resumes the exact envelope; a saved operation never silently obtains another transaction or fee authority.

| Saved state | Operator behavior |
| --- | --- |
| DRAFT | Review and authorize this selected action |
| AUTHORIZED | Resume its original unsigned preparation or cancel it |
| SIGNED / SUBMITTING / PENDING | Resume or reconcile the same transaction |
| FUNDED | Original top-up succeeded |
| COLLECTED | Merchant cumulative collected; channel remains available for later work |
| CLOSING | Funder's refund-start transaction succeeded; use its actual close ledger |
| REFUNDED | Original remaining-balance refund succeeded |
| SETTLED | Recipient's original collect-and-close succeeded |
| FAILED | Original failed transaction retained; its own pending marker is finalized |
| EXPIRED | Same-network RPC history covers every possible inclusion ledger and has advanced beyond the envelope expiry |
| HISTORY_REQUIRED | Query the original hash using an archival RPC with the missing historical window |
| CANCELLED | Unsigned action cancelled; original preparation retained |

Use `funding-resume`, `collection-resume` or `close-resume` with the original ID. The corresponding `*-reconcile` operation accepts an optional `rpcUrl`. Every configured or archival RPC must first confirm the original Stellar network. An absent transaction on another network cannot finalize this operation.

A failed or definitively expired transaction can be followed by a new operation ID and a fresh fee authorization. A signed pending operation keeps its original identity through application restart and complete receiving. Completion journals can resume after the terminal transaction result is saved but before the final owned marker is cleared.

## Move the complete operating channel

**Create operating handover** transfers the selected channel from its current workspace. It retains one immutable file before transferring operation, including:

- Complete task editions, task authority, budget reservations, signed cumulative commitments and original requests.
- Native SDK state, merchant profiles, accepted deliveries and exact paid response bytes.
- Funder profile editions, funding/refund authority, collection/close commitments, signed transactions, coherent chain observations, original finality responses and incomplete journals.
- Full source closure, native package manifest and lockfile, browser assets, required handler modules and selected input files.

Download the same saved file by its SHA-256. Interrupted download is a read of that original handover; export with the same handover ID returns it again.

The receiving command checks the entire native record set before joining it. Existing matching records permit interrupted receiving to continue. A conflicting operating record remains intact. The restored application source and file mappings point to real receiving paths, while historical profile and source identities stay unchanged.

The receiver restores existing reservations and signed commitments exactly. Its tasks reopen as **RECEIVED** until the receiving operator selects authority for future purchases. Original pending purchases retain their already selected commitments. Both the full JSON handover and a READY receiving record remain in the original native workspace.

```sh
starforge mpp-workspace channel export --dir "$MPP_PRODUCT" --input "$SELECTED_HANDOVER_INPUT"
starforge mpp-workspace channel handover --dir "$MPP_PRODUCT" \
  --id "$RETURNED_BUNDLE_SHA256" --out "$COMPLETE_HANDOVER"
starforge mpp-workspace channel receive --dir "$RECEIVING_PRODUCT" \
  --input "$RECEIVING_INPUT"
```

The receiving input selects `file` and `dependencyRoot`; the browser can send the complete bundle directly. A subsequent handover reads the restored input mappings and includes every retained profile edition.

## Application and agent API

The maintained client exposes 41 operations, including the six `opening-*` actions. The `openings` record kind returns the original setup and transaction-stage metadata; the native operating handover retains its complete code and signed envelopes.

```js
import { connectMppChannel } from './stellar/scf-starforge-20261009/mpp-channel/client.mjs';

const channel = await connectMppChannel({directory: process.env.MPP_PRODUCT});
try {
  const state = await channel.state();
  const work = await channel.runPurchases(actualWorkList);
  // work contains the original purchase records or the original pending job.
  const response = await channel.response(originalPurchaseId);
  // Persist response.bytes to the selected receiving destination.
} finally {
  await channel.close();
}
```

The export path is also available directly from `mpp-channel/client.mjs`. The client checks the original console identity through `MppProductClient` on every operation. Its typed interface covers work lists, jobs, opening, task, purchase, merchant contract, funder profile, funding, settlement and observation records, responses, handovers and complete operations. The installed CLI exposes those same operations to an agent using the current product session.

The original merchant MCP also exposes `merchant_mpp_channel_status`, `merchant_mpp_channel_record`, `merchant_mpp_channel_operate` and `merchant_mpp_channel_file`. Select its host-declared console alias. Channel operations return the original native job; `merchant_mpp_job` reads it. Large channel handovers stream from their original immutable file through the maintained reader, with the returned read ID, exact byte digest and next offset. An interrupted transfer resumes the same original file after the reader or process restarts.

## Python customer work and file receiving

The [complete Python customer integration](python/README.md) attaches to this same running product through the maintained Node client. It includes typed standard-library methods, a persistent native bridge, a complete work-list runner and whole-channel receiving. Keep the six source files together; Python 3.10+ and the original Node 22+ runtime are the only local dependencies.

```sh
python3 -B "$MPP_CHANNEL_SOURCE/python/run_work.py" \
  --product "$MPP_PRODUCT" --work "$ACTUAL_CHANNEL_WORK_LIST" \
  --out "$PRIVATE_CUSTOMER_OUTPUT"
```

The runner retains each result edition and receives the exact paid response bytes beside it. Reusing the original work list continues its original purchase IDs. A waiting operation returns its native job identity; a transport timeout ends only the Python attachment. The product retains the actual operation and can be reattached.

Python also receives the complete operating handover directly to an immutable private file, including source, original channel records and required inputs. The receiving helper selects both actual product identities before export and joins the same complete channel into its selected receiving workspace. Its source files travel in the original handover; generated Python caches are excluded.

## Native source and engineering boundaries

The exact installed dependency set is `@stellar/mpp 0.7.1`, `mppx 0.6.29`, `@stellar/stellar-sdk 15.1.0`; the original lock resolves `@stellar/stellar-base 15.0.0` for native deployment operations. The channel modules load through the existing native runtime resolver; dependency receiving stays with the original MPP product owner.

- [Stellar MPP v0.7.1](https://github.com/stellar/stellar-mpp-sdk/tree/9f2f8254421e09906dfb7e983e2491a273120adf): channel request/payload, cumulative client store, native merchant atomic acceptance and commitment preparation.
- [One-way channel contract](https://github.com/stellar-experimental/one-way-channel/blob/25dea1b303495a7a4184af7605bbb7671ff08da6/contracts/channel/src/lib.rs): actual deployed edition is selected by its WASM digest in the channel profile.
- [Native SDK contract creation and code upload](https://github.com/stellar/js-stellar-base/blob/v15.0.0/src/operations/invoke_host_function.js): the exact `createCustomContract` and `uploadContractWasm` host operations used by opening.
- [SDK contract ID derivation](https://github.com/stellar/js-stellar-base/blob/v15.0.0/src/asset.js): network-bound XDR contract-ID preimage and address encoding; opening uses its address-and-salt preimage variant.
- [Stellar RPC getNetwork](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getNetwork): confirms the selected network before channel observations, submission and archival recovery.
- [Stellar RPC getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction): transaction status, retained ledger boundaries and ledger close times used by close recovery.
- Original `mpp-charge/storage.mjs`, `products/mpp-workspace` and distribution contribution remain the native lease, product identity and installed application path.

Per-channel operations are serial within the original leased workspace. An active merchant selected by the exact same workspace, profile digest and channel uses its original native request handler inside the buyer's existing operation, avoiding a loopback lock cycle. Other merchants use the selected public HTTPS transport. Amounts are canonical decimal base-unit strings and use integer arithmetic. One outstanding buyer commitment per channel preserves unambiguous response recovery. Task authority is separate from recipient close-fee authority. Private key material is read from the operator's environment and is excluded from source, profiles and handover files.

This engineering contribution is AI assisted and belongs with the original SCF application disclosure and its selected funded adaptation. Customer installations, commercial workshare allocations and measured participating operators remain in their original grant and customer cases.

# Native MPP operating guide

The product contains the original Charge workflow and recurring **Channel work** in one native console. Sections 1–9 describe the existing product and Charge operation; section 10 carries a selected channel from useful recurring work through its merchant response, funding, collection and close. Both share the same installed runtime, private product and native workspace lease.

## 1. Select the original runtime and workspace

The product retains two separate directories: the private commerce workspace and the original dependency package. Its `product.json` records the native workspace’s creation identity, the selected runtime path and the product’s own operator/customer/receiving directories.

Create the dependency package with `runtime-template`, then use `runtime-receive`. These commands call the original native CLI and exact-lock Python receiver. The selected versions are:

| Package | Version |
|---|---|
| `@stellar/mpp` | `0.7.1` |
| `mppx` | `0.6.29` |
| `@stellar/stellar-sdk` | `15.1.0` |

The receiver verifies the original package and lockfile, original archive integrity, nested installation paths and selected executable links. An optional archive cache retains verified downloads. `--cache-limit-bytes` makes that cache opportunistic: capacity exhaustion leaves installation work in its original runtime directory and records skipped cache retention. A subsequent invocation with the same directory continues the selected package installation.

```sh
starforge mpp-workspace runtime-receive /absolute/private/mpp-runtime \
  --cache /absolute/private/mpp-archives --cache-limit-bytes 4194304
starforge mpp-workspace runtime-receive /absolute/private/mpp-runtime --inspect
```

Product launch checks the original manifest/lock and the exact top-level version metadata without importing the full payment SDK. It reports `PACKAGES_PRESENT` or `RECEIVING_REQUIRED`. The receiver’s `--inspect` checks the complete installed selection.

Initialize a new product with `init --dir … --runtime …`. To continue an existing native workspace, add `--workspace` with its actual private path. The product retains the original metadata and profile identities. It opens that workspace through the original native lease.

All setup/input files containing private operator paths, policy selection or customer configuration must be regular files owned by the operator with mode 0600. Product/native directories use mode 0700. The product does not seed a merchant recipient, customer payer, offer or purchase.

## 2. Open the browser and merchant agent

For the browser:

```sh
starforge mpp-workspace open --dir /absolute/private/mpp-product --browser-only
```

For browser and agent, supply the original incoming MCP token through the selected environment variable:

```sh
starforge mpp-workspace open --dir /absolute/private/mpp-product \
  --port 0 --mcp-port 0 --token-env MCP_ACCESS_TOKEN
```

The fixed bearer token must meet the original MCP host’s requirements. Its value stays in the environment; the product’s customer connection stores only the console token’s environment name. `MCP_OAUTH_CONFIG` and `MCP_CLIENT_ORIGINS` remain the original host’s OAuth and client-origin inputs.

The native browser URL includes its authentication fragment. Keep that URL with the operator. The merchant agent URL is a separate loopback HTTP endpoint, authenticated by the selected MCP access mode. The agent sees the original native MPP tools under console alias **native**.

A merchant-only product can open with zero registered customer aliases. Add actual customer configurations when the agent needs to receive and review purchases.

The process retains one product lease. The native browser retains one native workspace lease. The merchant agent borrows that browser endpoint and never opens another native writer. Multiple read-only client attachments can use the same running product.

## 3. Configure a merchant

Use the native browser’s merchant profile form, or save a private original merchant profile JSON and select it with the actual observed revision:

```sh
starforge mpp-workspace profile --dir /absolute/private/mpp-product \
  --kind merchant --file /absolute/private/merchant-profile.json --revision 0
```

This command operates a stopped product. With an already running product, add `--online` to submit that same profile through its original private console. Stop the native merchant listener before changing its active merchant profile.

The original profile contains:

- Merchant title and canonical public HTTPS origin.
- Exact native dependency root and the environment-variable name containing the merchant challenge secret.
- One or more GET/POST routes, with their stable route IDs, paths and descriptions.
- Exact network, Stellar asset contract, recipient, atomic price and decimal precision per route.
- Each original resource: inline JSON, a retained JSON file, or an exported handler in the selected original module.
- Optional original RPC URL and challenge lifetime.

Use the product’s selected dependency root in active merchant, buyer and customer profiles. The original normalizers validate the profile. Managed launch retains active profile identities, source file selections and the exact configuration revision.

Start the original merchant from its browser or:

```sh
starforge mpp-workspace merchant-start --dir /absolute/private/mpp-product --port 8788
starforge mpp-workspace catalog --dir /absolute/private/mpp-product
```

The listener binds loopback. The selected public HTTPS origin must route to that original listener through the operator’s existing public transport. The buyer’s native binding includes exact method, canonical URL/query, original body bytes, offer/profile and network/economic identity. Preserve those bytes through the transport.

The original merchant publishes its customer contract, OpenAPI and offers under `/_mpp/`. A static OpenAPI security value does not replace a native challenge: preparation obtains the current original 402 challenge for that particular request.

The browser’s merchant `active` count is the number of in-flight operations. Listener presence is represented by the merchant record itself.

## 4. Receive and configure a customer

In the original customer workbench, receive the merchant contract or complete customer bundle. The native receiver checks the contract and, for a bundle, regenerates and compares all companion files from the original source.

The draft displays the merchant’s origin, offers, exact atomic prices, selected asset, recipient and changes from the prior contract. Configure:

- Actual payer public key and signing-key environment name.
- Original governor Python executable, policy path, ledger path, actor and service identity.
- Per-asset maximum amount and maximum network fee.
- This original native workspace and dependency runtime.
- Optional original RPC and supported transport selections.

The signing key remains in its selected host environment. The original published client creates the transaction credential during purchase execution.

The live-console command flow uses the original draft and review:

```sh
umask 077
starforge mpp-workspace customer-intake --dir /absolute/private/mpp-product \
  --file /absolute/private/received-contract.json > /absolute/private/customer-draft.json
```

Make the draft file private before editing. Fill the draft’s actual configuration values. Then review and apply that retained revision:

```sh
starforge mpp-workspace customer-review --dir /absolute/private/mpp-product \
  --file /absolute/private/customer-draft.json > /absolute/private/customer-review.json
starforge mpp-workspace customer-configure --dir /absolute/private/mpp-product \
  --file /absolute/private/customer-review.json
```

The commands accept the original `draft` or `profile` envelope and its retained `revision`. An explicit `--revision` may select the same observed revision. A revision conflict requires reading the current selection and reviewing the desired change.

To enable agent-driven contract review, register the actual private customer configuration in the stopped product. `inspect` reports the product’s customer-selection revision separately from the native profile revision:

```sh
starforge mpp-workspace customer-register --dir /absolute/private/mpp-product \
  --alias accounts --file /absolute/private/customer-configuration.json \
  --label "Accounts purchasing" --revision 0
```

That configuration is the original `stellar-forge.mpp-customer.v1` object: `workspace`, `dependencyRoot`, `operator`, `signer`, `assetLimits`, and optional `rpcUrl`/`transport`. Its workspace and runtime must be the product’s retained paths. The product saves its exact private bytes under their SHA-256 and then publishes the alias selection. Native review validates its terms against the actual received contract.

Customer files are immutable versions. Registering a later alias selection preserves earlier files, reviews and purchases. Removing an alias changes the current agent’s available input, while original saved purchases retain their own configuration. Reopen the product after a host customer selection change.

If a setup or alias save was interrupted, `recover-setup` completes the same retained selector journal. It compares the original revision before completing the connection and customer selection files.

## 5. Prepare and execute an original purchase

Select an offer and enter its query/JSON inputs in the browser, or use the typed client/commands. The inputs file contains only `query`, `json`, and, for preparation, an optional original `challengeId`.

Preview the exact request and amount:

```sh
starforge mpp-workspace preview --dir /absolute/private/mpp-product \
  --profile-id ORIGINAL_CUSTOMER_PROFILE_SHA256 --offer-id OFFER_ID \
  --input /absolute/private/purchase-inputs.json
```

Choose one stable purchase ID and retain it before dispatch:

```sh
starforge mpp-workspace prepare --dir /absolute/private/mpp-product \
  --profile-id ORIGINAL_CUSTOMER_PROFILE_SHA256 --offer-id OFFER_ID \
  --purchase-id accounts-2026-10-12-001 \
  --input /absolute/private/purchase-inputs.json
```

Preparation returns the original console job ID. The native workbench retains the original contract, profile, exact request and stable purchase ID before network preparation. Inspect the job or purchase:

```sh
starforge mpp-workspace job --dir /absolute/private/mpp-product \
  --job-id ORIGINAL_JOB_ID --purchase-id accounts-2026-10-12-001 --wait-ms 30000
starforge mpp-workspace purchase --dir /absolute/private/mpp-product \
  --id accounts-2026-10-12-001
```

Execute invokes the original SF36 consent/reservation and native published SDK flow:

```sh
starforge mpp-workspace execute --dir /absolute/private/mpp-product \
  --id accounts-2026-10-12-001
```

The product host’s controlling terminal presents the original governor request. Keep that terminal attached, or use managed Applications’ retained terminal. The agent can inspect purchase/job state while the original approval is pending.

The purchase’s exact accepted terms and original request remain authoritative. The official SDK builds the native pull credential. The original merchant’s challenge/transaction ownership and retained delivery state govern retries. SF86 examines the original transaction and token transfer, then the original governor receives its final accounting outcome.

## 6. Continue after interruption

Use the original retained identity:

| Observed state | Continuation |
|---|---|
| Preparation request/reply interrupted | Inspect the purchase ID, then `retry-prepare` on that ID |
| Job ID lost after console restart | Read `job` with the purchase ID; `JOB_NOT_RETAINED` includes the saved purchase |
| Credential/payment/response request interrupted | Inspect the purchase, then `resume` on the same ID |
| Response retained, finality still pending | `finalize` the same purchase through original SF86/accounting |
| Merchant retained an unfinished delivery | `delivery-recover` with its original delivery ID |
| Current contract or profile changed | Reopen the existing purchase and use its retained original request/profile |
| Response already available | Download its inspected original bytes without another purchase |
| Product opening failed after one listener opened | The original owner drains the opened listener before releasing its leases |

`execute`, `resume` and `finalize` each return a native background job. A client timeout leaves the original job/purchase available for inspection. `MppProductError` retains the purchase/job ID when the dispatch has that identity.

The product does not automatically retry a spending operation. It exposes the original preparation and recovery methods so the caller can continue the correct retained operation.

## 7. Typed native client

```js
import { connectMppProduct } from './products/mpp-workspace/client.mjs';

const client = await connectMppProduct({ directory: '/absolute/private/mpp-product' });
try {
  const current = await client.customerStatus();
  const selected = {
    profileId: current.profileId,
    offerId: 'the-selected-offer',
    purchaseId: 'accounts-2026-10-12-001'
  };
  const preview = await client.preview({
    profileId: selected.profileId, offerId: selected.offerId,
    inputs: { query: { period: '2026-10' } }
  });
  // Present preview to the operator before preparing the selected purchase.
  const job = await client.prepare({ ...selected, query: { period: '2026-10' } });
  const observed = await client.waitJob(job.id, {
    purchaseId: selected.purchaseId, timeoutMs: 30000
  });
  console.log(observed.state);
} finally {
  await client.close();
}
```

Closing the client drains its own HTTP calls. The product host retains the native workspace and its accepted jobs.

`connectMppAgent` supplies named wrappers over the original merchant MCP: `review`, `configure`, `preview`, `prepare`, `execute`, `resume`, `finalize`, `job`, `purchase`, `export` and `download`. It verifies that console alias `native` selects the product’s original workspace. Its local helper uses the original fixed-bearer MCP client. OAuth clients can use their normal authenticated MCP transport against the same original endpoint.

## 8. Managed review and shutdown

Use `inspect-launch` for the exact current launch selection. It records the product and native workspace, current native metadata/profile files, customer configurations, original runtime package/lock/version metadata, active external resource files, policy files and operator-added connection inputs. Mutable purchase, delivery, response and ledger activity is preserved independently.

Applications’ normal preparation supplies the common port, private environment-file digest and retained terminal. Its deferred startup observation accepts only this product’s schema-first readiness announcement, reconciles the original run/review and wrapper process, and authenticates the native console identity before displaying its private URL.

A stopped/reopened product can choose new loopback ports. Its dynamic connection file is regenerated from the same retained customer selections. The private workspace identity and saved data stay the same.

On Stop or Ctrl-C, the product first drains the merchant MCP. It then drains the original native console jobs and merchant listener before releasing its workspace. If a native drain reports an error, the same owner remains available for another close/Stop attempt.

## 9. Preserve the working product

Retain the whole private product directory, its attached native workspace when external, the selected dependency runtime, original governor ledger/policy and referenced merchant resource/handler files. Signing and incoming-access values stay in their original host environment.

Use the complete customer and response receiving operations in **[RECEIVING.md](RECEIVING.md)** for customer-facing handoffs. Historical profile file paths must remain available for an unfinished original delivery. A prepared purchase continues from its retained profile and signed credential even when the current customer selection changes.

## 10. Operate recurring channel work

Open **Channel work** in the original browser. Its task, merchant, purchase, funding, collection, refund and receiving views use the same current product session. The complete [channel work guide](../../stellar/scf-starforge-20261009/mpp-channel/README.md) describes each profile field and the actual pinned protocol.

### Select and run a task

Start with the merchant's actual channel contract at `/_mpp/channel-contract`, or load its complete retained contract file. Choose the useful priced route and authorized source edition. The task binds the original channel address, network, token, funder, recipient, commitment key, deployed WASM digest, endpoint, selected merchant profile and offer.

Set the accountable operator, total amount in token base units, maximum amount per purchase, number of purchases and expiry. Saving creates an editable planning edition. **Authorize task budget** presents that selected edition and cap in the product's controlling terminal. A task correction keeps its prior editions and committed spending; the revised scope receives its own operator authorization.

Prepare each actual work item with one stable purchase ID and its real request input. **Execute** signs the original cumulative target under the selected task authority. **Resume** recovers that same purchase and response. A stopped task permits existing work to recover while preventing new reservations. Cancelling an unsigned reservation releases its retained amount and count once.

Read the existing state or run a complete supplied work list from the installed product:

```sh
starforge mpp-workspace channel state --dir "$MPP_PRODUCT"
starforge mpp-workspace channel run --dir "$MPP_PRODUCT" \
  --input "$ACTUAL_CHANNEL_WORK_LIST" --out "$WORK_RESULT"
starforge mpp-workspace channel response --dir "$MPP_PRODUCT" \
  --id "$ORIGINAL_PURCHASE_ID" --out "$PAID_RESPONSE"
```

The work list contains the original `taskId`, `purchaseId` and complete `request` for every item. It uses schema `stellar-forge.mpp-channel-work.v1`. Rerun the same file to continue original operations after an interruption. If a command returns a running job, read that job through `channel job --id …`; completed purchases retain their result.

### Operate the selected merchant and collect

The channel merchant profile selects the actual authorized source and a useful JSON, JSON-file or handler route. Its configuration preserves the priced unit, exact incremental amount and original profile digest. Use a read-only or idempotent handler keyed by the original delivery operation ID.

Start the merchant from Channel work, or use `merchant-start` with the stream key returned by `channel state`. An active merchant in the same native workspace serves the original request inside the existing channel operation. A separate merchant uses its selected public HTTPS origin.

Prepare an ongoing collection with `collection-prepare` and a stable settlement ID. The recipient authorizes the original accepted cumulative commitment, observed amount still uncollected, delivery, fee account and maximum fee in its terminal. `collection-execute` calls the original contract's `settle` function; **COLLECTED** leaves the channel available for later work. `collection-resume` and `collection-reconcile` continue that same signed transaction. To collect and end the channel, use the separate `close-prepare` and `close-execute` route; its completed state is **SETTLED**.

A definitively expired or failed financial transaction can receive a new operation ID and fresh fee authorization. If the original RPC no longer retains the possible inclusion window, select an archival `rpcUrl` for the matching `funding-reconcile`, `collection-reconcile` or `close-reconcile`. Every configured or archival RPC must confirm the original network. Each route retains the same original signed envelope and hash.

### Fund continued work and recover the remaining balance

In **Channel funds**, load the selected original channel and save its accountable funder profile. The form retains the channel's actual funder account, operator, host signer environment-variable name and maximum transaction fee. The complete profile is also available from `funder-template`; save it with `funder-save` and the current selection revision.

Choose **Add funds** and a stable funding ID. `funding-prepare` takes `{stream, fundingId, action:"top_up", amountAtomic}`. The subsequent `funding-execute` takes that original `fundingId` and presents the selected amount and fee in the funder's terminal. The original contract's top-up operation moves exactly those tokens from the selected funder into its channel. The task's total cap, per-purchase cap, count and expiry remain separately selected.

The channel display shows balance, already collected cumulative amount, observation ledger and refund state. It reads balance and withdrawal accounting from the same ledger. Fresh commitments consume only their unpaid difference above the amount already collected; task authorization uses the same remaining-liability calculation.

To recover remaining funds, prepare `action:"close_start"` with a new funding ID, then authorize its original transaction. The resulting ledger deadline appears in the channel view and new commitments stop. When the chain reaches that ledger, prepare `action:"refund"` with a new funding ID and authorize the return to the original funder. These two actions take no amount field: the final refund transfers the remaining balance at execution.

The prepared, authorized, signed, pending and final records appear in the same financial-operation tables. Use their original IDs for resume, reconciliation or unsigned cancellation. Full profiles, signed calls, finality and coherent observations move with the complete channel handover. The [full financial workflow](../../stellar/scf-starforge-20261009/mpp-channel/README.md#fund-collect-and-return-the-original-channel) includes exact input shapes, contract sources and all recovery states.

### Agent and application access

The typed `connectMppChannel` client attaches to this same product. It exposes state, original records, task operations, complete work lists, response bytes and operating handovers. The original merchant MCP exposes four matching tools under console alias `native`:

| Tool | Operation |
|---|---|
| `merchant_mpp_channel_status` | Read current tasks, budgets, merchants, deliveries, funding, collections, refunds and receiving |
| `merchant_mpp_channel_record` | Reopen the selected original task, purchase, merchant contract, funder profile, financial operation or chain observation |
| `merchant_mpp_channel_operate` | Dispatch the selected native operation and retain its original job |
| `merchant_mpp_channel_file` | Receive an exact paid response or complete operating handover |

Read a returned operation job through the existing `merchant_mpp_job`. The whole-channel transfer and recovery flow is in [RECEIVING.md](RECEIVING.md#6-receive-a-complete-operating-channel).

### Python work lists and paid files

The [Python customer guide](../../stellar/scf-starforge-20261009/mpp-channel/python/README.md) supplies a typed standard-library client over this original product, plus complete work-list and operating-channel receiving commands. Its persistent Node bridge uses the maintained `connectMppChannel` client and the same native jobs.

```sh
python3 -B "$MPP_CHANNEL_SOURCE/python/run_work.py" \
  --product "$MPP_PRODUCT" --work "$ACTUAL_CHANNEL_WORK_LIST" \
  --out "$PRIVATE_CUSTOMER_OUTPUT"
```

The selected output directory receives immutable work-result editions and each original paid response, with its actual byte digest and source identity. Run the same actual work file again to continue its retained purchases. A pending operation exposes its original job; the client can be closed and reattached without changing that operation.

The same six-file Python source directory includes `receive_channel.py` for complete source-and-operation receiving. It attaches to both real product identities before exporting, retains the original handover file, and reopens that channel in the selected receiving product. The [receiving instructions](../../stellar/scf-starforge-20261009/mpp-channel/python/README.md#carry-the-complete-operating-channel) cover same-host use and the exact-file transfer between hosts.


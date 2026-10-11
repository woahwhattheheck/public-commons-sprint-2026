# GoldRush wallet workspace

A local wallet research application over the provider pilot's generated client and the existing Stellar Forge buyer. It prepares balance and transfer requests, opens the original operator review, executes an explicitly reviewed request, recovers the same retained work, and reads completed responses through the existing resource library.

The interface uses plain grayscale panels and tables. Token quantities, transaction values and quotes remain exact decimal strings.

## Open and reopen

Use Node 22.16 or newer and this source tree, or a merchant distribution containing this example and the original SF88 runtime. Build the provider release with the existing commands in [README.md](README.md). Keep its original generated customer client.

The maintained distribution registers this original command as `starforge goldrush workbench`; it can be invoked from any working directory. Use `npx --no-install starforge` when the package is installed only in the current Node application. From a source checkout, the equivalent command is `node customer.mjs workbench` in this example directory. `starforge goldrush-merchant` supplies the original discover/prepare/inspect release workflow.

Use a private directory for application state and the existing operator workspace when execution is required:

~~~sh
starforge goldrush workbench \
  --state /absolute/private/goldrush-wallet \
  --release /absolute/provider-release \
  --buyer-state /absolute/private/goldrush-buyer \
  --inbox /absolute/private/goldrush-inbox \
  --workspace /absolute/existing-operator-workspace
~~~

An existing operator profile may be supplied with --profile /absolute/operator-profile.json in place of --workspace. The workspace supplies its own profile. Offline request preparation and review can be used without either option.

Open the private local URL printed by the process. The wallet app at /goldrush and the ordinary Resource library share the same foreground listener and existing private session.

When the original runtime resides in another installed source tree, add --source-root /absolute/installed/source. The browser application imports the server extension from this example's source tree and uses the selected installed native Buyer, Inbox and Library. The selected native runtime's schema feature requires `re2js@2.8.6` to be installed and resolvable in the application, as described by the merchant distribution's schema installation guide. Check that installation with `starforge doctor --feature schema`. If the dependency is already installed in a separate application directory, run this process with `NODE_PATH=/absolute/existing-application/node_modules`; keep that setting when reopening. The application uses the original schema validator and runs locally.

Stop with Ctrl-C. Reopen the same work with:

~~~sh
starforge goldrush workbench --state /absolute/private/goldrush-wallet
~~~

Repeat --source-root when using a separate installed runtime. --port 8242 selects a stable local port if browser form drafts should survive process restarts at the same origin. Durable requests, the selected resource, saved notes and revisions are retained independently of browser storage.

## Request and operator workflow

1. Select balances or one page of transfers. The form reads chains, quote currencies, page size limits and payment choices from the actual release's generated client.
2. Enter the wallet. Transfers also require the token contract, zero-based page number and page size.
3. Select a provider payment option and review the maximum amount in atomic units. The original generated client authors the request; existing live admission validates its input.
4. Choose **Prepare and review**. This saves one exact request configuration and creates or reopens the original Node Buyer operation. Without an execution profile, the original Node Buyer supplies the offline review and the saved request remains visible in the workspace. When its retained configuration includes the original operator and signer, the application validates that configuration before delegating it to the existing Inbox for review.
5. Inspect the request, payment tuple and original review. The review identifies whether the original Node preparation or Inbox owns the request. For an Inbox request, **Execute reviewed request** invokes the existing Inbox/operator workflow for that saved review. Refreshing, reopening, viewing, comparing or exporting never invokes execution.
6. After an interrupted browser wait, select the same request and choose **Recover saved result**. The owning Node operation or Inbox reads its retained attempt. The application preserves native state and history, including a prior interrupted or failed delegation.
7. When an existing operator workspace has a recorded outcome, **Finalize workspace** exposes its original finalization operation.

A request ID binds one exact authored request. A replay with the same ID and configuration rejoins the saved operation. An edited request with that ID returns a conflict; clear the form for a new request. Changes to the provider release require a fresh refresh before authoring a new request. Previously prepared operations keep their native configuration. An operator-less preparation stays bound to that configuration. To prepare a payable request later, open a workspace with its original operator profile and use a new request ID; the existing offline preparation remains available for review. The app does not rewrite an existing intent's configuration or delegation history.

The sample release contains example merchant/payment values. Actual provider deployment and existing operator configuration are required for paid execution. This app does not replace upstream provider authorization or create a GoldRush account.

## Read wallet data

**Refresh saved work** scans the original Inbox into the existing resource library. Saved request navigation includes both original Node preparations and published Inbox jobs, without duplicating an intent that has already entered the Inbox. A successful saved response opens after its original size/hash, current Inbox binding and complete JSON are checked. The existing library supplies resource IDs, saved files and downloads.

Balances show exact quantities, 24-hour balances and provider quote values where supplied. Transfer rows retain individual identity, including the containing transaction and event/transfer position. The containing-transactions table retains value, fees, gas and result metadata, including transactions with no transfer rows.

Wallet, chain, quote currency, query filters, update time, pagination and source identity remain attached. A transfer response is one page of the selected query. **Prepare next page** fills the form with a new request ID and the retained scope when the provider advertises another page. Review and prepare that page before execution.

A missing value is displayed as unavailable. The app does not treat a missing balance as zero, infer a complete portfolio from partial scope, net transfers into holdings, or label a separately supplied observation as a paid request.

## Compare, annotate and export

Choose **Use as comparison A** and **Use as comparison B** on two responses. Comparison reopens both exact sources and checks operation, wallet, chain, quote currency, filters and row identity. Compatible balance comparisons use exact integer/decimal arithmetic. Added or removed rows remain changes within the returned view. Incompatible comparisons retain reasons instead of calculating a misleading delta.

Transfer comparisons retain row changes and changes in the containing transaction's value, fees, result and other metadata. Complete comparison JSON includes source identities, update times, coverage, chronology and all changed fields.

Notes, tags and stars use the original Resource library annotation API. Each save retains a revision and stable operation ID. Browser drafts retain their original revision. If another editor saves first, the app keeps the draft, opens saved revisions and lets the analyst explicitly use the latest revision before saving. A lost save response can be repeated with the same operation ID.

**Add summary to note** adds both comparison source identities and its summary to the current draft. **Save note** records the revision. Separate reference observations do not create buyer records or an alternate annotation database.

Exports include:

- Analysis JSON with exact quantities, source scope, original resource binding and current annotation.
- CSV with every field quoted, formula protection and numeric strings preserved as spreadsheet text, including long positive integer quantities.
- The original response through the existing verified Resource library download.
- Complete comparison JSON.
- The ordinary Resource library review export with its native saved annotation history.

## Optional source observations

Attach a complete separately obtained provider response with --reference-file /absolute/observations.json. This reads a manifest and exact local files; it performs no acquisition, purchase or Inbox import. An explicitly supplied reference-file option on reopening can select another manifest without replacing the saved buyer/inbox binding.

The schema is stellar-forge.goldrush-observations.v1. Its observations array contains:

| Field | Meaning |
| --- | --- |
| id | Stable observation ID |
| operation | balances or transfers |
| chain, wallet | Exact request chain and wallet |
| query | Exact query values, including transfer page and size |
| path | Complete regular response file; relative paths resolve against the manifest |
| bytes, sha256 | Exact response-byte identity |
| source.operator | Actual operator that returned the response |
| source.url | Actual HTTPS request URL |
| source.retrievedAt | Actual response capture time |

Use complete original UTF-8 JSON within the same 1 MiB pilot response limit. Keep credentials out of manifests and URLs. Identify a gateway by its own operator; its response does not establish a provider partnership, native Stellar support or resale permission.

## Native integration

The workbench composes the original Node Buyer/Inbox and Resource library. The wallet-data module is a pure response projection and comparison module, with no network, payment, storage or scheduling engine.

The existing resource server accepts an optional local application extension for static assets and authenticated routes, after its normal Host/Origin/session checks. Original APIs, annotations, scanning, deadlines and verified downloads remain the implementations.

The retained source contracts and catalog are in this example's source directory. The original upstream remains https://api.covalenthq.com.

- [GoldRush token balance API](https://goldrush.dev/docs/api-reference/foundational-api/balances/get-token-balances-for-address)
- [GoldRush ERC20 transfer API](https://goldrush.dev/docs/api-reference/foundational-api/balances/get-erc20-token-transfers-for-address)
- [GoldRush x402 discovery](https://x402.goldrush.dev/v1/x402/endpoints)

## Installed application entry

The package export `@tokenjunkielabs/starforge-merchant/buyer/goldrush/workspace` exposes the original `main(args)` opening function and `openWorkbench` for an existing private server. The root package also exports `startGoldRushWorkspace`, which is that same `main` function. Pass the original CLI argument array; for an initialized workspace, `await startGoldRushWorkspace(['--state', '/absolute/private/goldrush-wallet'])` returns `{app, listener, url, close}`. Keep that returned application alive for the operator and call `await close()` during host shutdown. Initial creation uses the same release, buyer-state, inbox and optional original operator arguments shown above. This API does not prepare or execute a request by opening.

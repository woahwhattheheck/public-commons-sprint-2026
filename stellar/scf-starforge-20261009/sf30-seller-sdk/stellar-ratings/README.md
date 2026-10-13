# Stellar ratings workspace

A complete operator for Stellar wallet holdings, Bluechip ratings and daily network activity. The same source provides a private browser application, a JSON operator API, a terminal interface, continuous daily collections, immutable result editions and independently received workspace packages.

## What the application does

| Area | Delivered behavior |
| --- | --- |
| Asset registry | Versioned network, code and issuer identity; native XLM; verified SAC identity; explicitly selected contract assets and contract wallets; issuer and distribution scopes. |
| Wallet review | Original G and M identity, complete Horizon balances, selected C balances, original labels, exact quantities, USD values, agency grades, score policy, rated coverage and unresolved holdings. |
| Daily activity | Exact UTC ledger boundaries, complete selected operation and event pages, issuance and burn, payment and trade flows, original supply, holders, concentration and per-asset transaction counts. |
| Original sources | Native Bluechip, Horizon, Stellar RPC and Stellar Expert reads; configured customer GET routes; complete JSON, CSV and document imports; retained raw responses and versioned projections. |
| Operator | Monochrome browser, 47 JSON methods, complete CLI, original-request recovery, daily worker, corrections and edition comparison. |
| Delivery | HTML, CSV and JSON reports; complete source/data/runtime workspace export; archive upload and independent receiving; reopening with the original journal and continuations. |

## Start the complete application

Use Node.js 24 and npm. Run the following commands from the `sf30-seller-sdk` directory of the complete checkout or received source tree. The surrounding shared source directories are part of the declared distribution.

Install and retain the exact original Stellar SDK runtime in directories outside the mutable workspace:

```bash
node stellar-ratings/cli.mjs runtime-install \
  --installation-directory /srv/stellar-ratings-packages \
  --destination /srv/stellar-ratings-runtime
```

The installation selects `@stellar/stellar-sdk@17.2.1`, its original package lock, compiled exports, dependency files and licenses. Keep the returned manifest identity with the installation. `runtime-verify` checks every retained member. `runtime-restore` creates an independently usable installation; `runtime-bind` binds that exact installation to an application directory.

Create a private configuration directory and copy the supplied public-source configuration into it:

```bash
mkdir -p /srv/stellar-ratings-private
cp stellar-ratings/examples/connections.example.json /srv/stellar-ratings-private/connections.json
node stellar-ratings/cli.mjs serve \
  --workspace /srv/stellar-ratings-workspace \
  --connections-file /srv/stellar-ratings-private/connections.json \
  --runtime-directory /srv/stellar-ratings-runtime \
  --collect-daily \
  --startup-format json
```

Open the complete private URL returned in the startup JSON. The default port is 8777. The `STELLAR_RATINGS_READY` record includes the original workspace ID, source and configuration paths, runtime selection, daily collection flag and process identity. A managed Applications launch uses the same CLI and verifies those selected values.

The supplied configuration connects to the original Bluechip API, public Horizon and Stellar Expert. Add the selected network RPC as a `stellar` connection with its actual `rpcUrl` to collect contract balances and contract events. The registry and every native connection must select the same Stellar network. Keep credentials in the private connection file. An authenticated customer data source also supplies its actual `accountScope`.

In **Registry and policy**, save the supplied registry template and wallet policy. The registry starts with Circle mainnet USDC and native XLM, including the original source references. Adjust the tracked assets, price keys, accepted supply/holder scopes and contract selections for the installation. Each save creates a following immutable version.

In **Wallets**, choose the registry and policy, enter the original addresses and run a complete review. In **Daily activity**, save a collection with its accepted launch date, select the dates and run it. Settings controls continuous collection; a saved Settings choice takes precedence over the launch default. An explicitly paused collection retains its original dates and resumes through its own Resume action.

## Ratings, prices and accounting

Bluechip grades retain the case-sensitive original agency symbol, current agency grade and its original URL. Displayed grades carry **by Bluechip** attribution. The source contract is retained in [source/contracts.json](source/contracts.json); original network specifications and licensed source selections accompany it.

Prices and numerical scores are independent original inputs. Configure the existing customer pricing/CMS GET routes, or import their complete original JSON/CSV files. The two header-only CSV examples show the supported direct price and score columns. Their cells preserve decimal strings. A field mapping selects the actual source JSON pointers; the price field is `price` and the score field is `score`.

The wallet policy pins the coverage threshold, allowed source age, explicit stale-source treatment, score range, original grade bands and methodology source IDs. The default minimum rated coverage is 50 percent. Original numeric scores are USD weighted with exact rational arithmetic. A letter grade alone remains a grade; a numerical aggregate uses the configured original score policy.

Wallet holdings preserve all original Classic balances. An M input retains its muxed ID and joins the underlying G account once. A C wallet covers its explicitly selected registry assets and records that scope with the result. Verified Classic and SAC views join by exact asset identity. Unpriced or unresolved holdings remain visible and keep the valuation denominator incomplete. Every displayed amount has an original quantity, precision and source reference.

Daily activity uses UTC `[from, to)` boundaries. The planner resolves the actual ledger closes at the selected boundaries, verifies the selected network, and preserves every original response and cursor. A collection advances day by day from the accepted launch date through closed UTC days. Its current run, cursor and date selection survive interruption. A following repair preserves the earlier edition and publishes another edition for comparison.

Original issuer mint/burn, path-payment endpoints, intermediate trade legs, claimable balances, pool reserves and contract events retain their actual accounting identities. Paired effects and multiple protocol views join once. Supply and holder figures retain their source scope and observation time. Known empty intervals may produce zero; unavailable source quantities remain unavailable, or explicitly carry the previous retained value and its original time.

## Source imports and configured routes

The Sources page offers each configured native route with its actual filter schema. Integer, Boolean, array and object filters retain their native types; structured filters use JSON. Complete selection JSON is available for every route. **Continue through every original page** completes the selected capture using the retained provider cursor.

For file imports, choose a complete original JSON, CSV or document file, its provider, kind, original scope and optional records pointer. The browser journals the original File before sending it. A new projection retains the earlier body and projection. Attribution corrections record the actor, reason and exact source/record identity, with optional supersession. Reopen the selected sources into a following edition to apply those corrections.

Customer source connections use `provider: "source"`, an actual HTTPS `baseUrl`, and a `routes` array. Every route names a fixed relative GET `path`, `kind`, `filtersSchema`, optional `recordsPath`, `projection` and the original pagination contract. A projection uses `{entity, fields}` with JSON pointers to the actual source fields. Optional `planning.bindings` binds real registry, asset, policy, period or observation-time fields to the route filters. The native catalog exposes the exact configured source selection.

For example, an existing price source can bind its required `pricingKey` query field to `asset.pricingKey`, and map `price` and `asOf` to their actual response pointers. Set the real source endpoint and field paths from that source contract before selecting it. Complete original source files can also be imported without a network route.

## Complete terminal operations

Commands accept complete JSON arguments through `--input FILE` or `--input -`. The CLI retains or generates an original request UUID and supplies the current revision before a new mutation. Returned request IDs let automation continue the same operation after an interrupted response.

```bash
node stellar-ratings/cli.mjs registry-save \
  --workspace /srv/stellar-ratings-workspace \
  --file stellar-ratings/examples/registry.template.json
node stellar-ratings/cli.mjs policy-save \
  --workspace /srv/stellar-ratings-workspace \
  --file stellar-ratings/examples/wallet-policy.template.json
node stellar-ratings/cli.mjs wallet-review \
  --workspace /srv/stellar-ratings-workspace \
  --connections-file /srv/stellar-ratings-private/connections.json \
  --runtime-directory /srv/stellar-ratings-runtime \
  --input /srv/stellar-ratings-private/review.json
```

The review JSON contains the actual saved `registryId` and `policyId`, the original `addresses` array, and optional pinned versions, source IDs, source aliases and observation cutoff. `mode: "capture"` collects original native sources. `mode: "retained"` reviews the explicitly selected retained sources with the original runtime identity.

For a saved daily collection, `collection-run` accepts `--collection-id`, optional `--from` and `--to` dates, and `--repair`. The end date is exclusive. `--resume-original` on the corresponding continuation command restores the saved run/capture/collection arguments. File commands with `--output` stream the complete original body; `--offset` and `--length` explicitly select a range.

### Operator methods

Every listed mutation accepts `requestId` and `expectedRevision`; independent `package.receive` uses its own original receiving request. Read methods page through `offset` and `limit` where applicable.

| JSON method | Operation | Required selection |
| --- | --- | --- |
| `workspace.describe` | Read | — |
| `workspace.list` | Read | `table` |
| `workspace.profile` | Write | `profile` |
| `workspace.history` | Read | — |
| `request.status` | Read | `requestId` |
| `registry.save` | Write | `definition` |
| `registry.read` | Read | `registryId` |
| `policy.save` | Write | `definition` |
| `policy.read` | Read | `policyId` |
| `source.catalog` | Read | — |
| `source.import` | Write | `provider`, `kind`, `bodyBase64` |
| `source.project` | Write | `sourceId` |
| `source.read` | Read | `sourceId` |
| `source.file` | Read | `sourceId` |
| `capture.start` | Write | `registryId`, `connectionAlias`, `read` |
| `capture.read` | Read | `captureId` |
| `capture.next` | Write | `captureId` |
| `capture.run` | Write | `captureId` |
| `capture.pause` | Write | `captureId` |
| `capture.resume` | Write | `captureId` |
| `wallet.review` | Write | `registryId`, `policyId`, `addresses` |
| `activity.collect` | Write | `registryId`, `policyId`, `period` |
| `run.start` | Write | `registryId`, `policyId`, `kind` |
| `run.read` | Read | `runId` |
| `run.next` | Write | `runId` |
| `run.continue` | Write | `runId` |
| `run.pause` | Write | `runId` |
| `run.resume` | Write | `runId` |
| `collection.save` | Write | `definition` |
| `collection.read` | Read | `collectionId` |
| `collection.run` | Write | `collectionId` |
| `collection.pause` | Write | `collectionId` |
| `collection.resume` | Write | `collectionId` |
| `decision.save` | Write | `registryId`, `sourceId`, `recordId`, `action`, `actor`, `reason` |
| `decision.read` | Read | `decisionId` |
| `edition.read` | Read | `editionId` |
| `edition.file` | Read | `editionId` |
| `edition.compare` | Read | `leftEditionId`, `rightEditionId` |
| `report.create` | Write | `editionId` |
| `report.read` | Read | `reportId` |
| `report.file` | Read | `reportId` |
| `lookup.read` | Read | — |
| `wallet.popular` | Read | — |
| `workspace.export` | Write | `destination` |
| `report.export` | Write | `reportId`, `destination` |
| `package.inspect` | Read | `sourceDirectory` |
| `package.receive` | Write | `sourceDirectory`, `destination` |

The CLI uses the same names with dots replaced by hyphens, and also supports `invoke --method` for a complete JSON call.

## HTTP integration

The local operator requires its startup bearer token. Mutations also include `X-Ratings-Workspace-ID` matching the original startup workspace ID. The browser stores its token only in the local session and removes the token fragment from its displayed URL after startup.

| Route | Result |
| --- | --- |
| `POST /api/invoke` | Complete `{method, args}` operator invocation. |
| `POST /stellar/wallet-ratings` | Complete original review; accepts saved registry/policy selection, original addresses and a UUID request ID or Idempotency-Key. |
| `GET /stellar/wallet-ratings/reviews/:runId` | Original run progress and its retained wallet edition. |
| `GET /stellar/wallet-ratings/popular` | Ranked original accounts and Top 10/100/1000 tiers. |
| `POST /api/sources/import` | Complete raw source body plus base64 JSON metadata in `X-Ratings-Source`. |
| `GET /api/sources/:sourceId/original` | Complete original source bytes. |
| `GET /api/editions/:editionId/original` | Complete immutable result edition. |
| `GET /api/reports/:reportId/files/:format` | Complete retained HTML, CSV or JSON report. |
| `GET /api/packages/:exportId/archive` | Complete original package archive with `X-Ratings-Manifest-SHA256`. |
| `POST /api/packages/unpack?requestId=UUID` | Stream an original archive into its stable receiving inbox. |

Private lookup accounting counts a successful original wallet once per new review run. Replaying an HTTP response, continuing an interrupted run or repairing its sources preserves that count. The popularity response provides ranks and tiers; the private lookup view retains the exact counts and edition identities.

## Reports, receiving and recovery

Reports can cover a whole edition, one asset or one account. HTML, CSV and JSON files preserve their source scope and Bluechip attribution. The browser previews the original HTML and verifies the retained SHA256 for complete file downloads.

Export a whole workspace or a report package in **Delivery and receiving**. The complete workspace contains the original registry and policy versions, source bodies, projections, captures, runs, collections, corrections, result editions, reports, journal, declared source tree and selected runtime. Use a destination outside the active workspace.

Download the complete archive, upload it into the receiving inbox, inspect its exact manifest and receive it into a fresh destination. Receiving restores the original source and runtime, verifies the original journal and preserves every original continuation. Unfinished work starts paused in the independent installation and resumes with its saved source selection. Terminal partial editions retain their repair path.

The Requests page recovers the original browser request body or File. An interrupted HTTP response uses the same request identity and arguments. An already committed request returns its retained result. A definite revision conflict refreshes the revision while preserving the operation intent. Browser history restores the selected source or result edition.

## Source and native operation

[source/contracts.json](source/contracts.json) records the original source contracts and attribution. [source/stellar-expert-openapi.json](source/stellar-expert-openapi.json) retains the original MIT-licensed API specification. [source/stellar-native-source.json](source/stellar-native-source.json) retains the selected upstream Stellar source and Apache license. The SDK registry selection and exact compiled runtime are included by the runtime and receiving modules.

`source-files.json` declares the complete portable source selection. Keep every declared member when distributing the product. The managed Applications adapter selects the same source closure and verifies the actual runtime before launch. The accompanying original native programme operates the full public-source wallet and daily collection, browser recovery, reports and independent receiving flow.

Authored application source is MIT licensed. Upstream specifications, SDK files and original provider content retain their respective source licenses and attribution.

# SF102: Merchant seller recovery and zero-payment cutover parity

**Use case:** A working SF30 paid JSON API needs a repeatable, private backup and standby migration, preserving every configured Stellar payment option, API response data and canonical public origin. SF102 packages the actual static seller configuration plus snapshot assets, restores it into a separate clean location, and compares each original server's published offers to that saved configuration. Two servers that agree with each other but share a stale or changed recipient, price, asset or option set produce a cutover drift report. The existing seller and merchant deployment process remain in use.

Node 22+, no npm dependency for SF102, no cloud runner. Keep its original SF30 `seller.mjs`, `route-path.mjs` and `http-methods.mjs` imports with the source. The existing original SF30 remains the source of payment challenges, verification, settlement and route serving; running that seller needs its full original import closure. Compatible inputs are original `stellar-forge.seller-service.v1` configs containing inline `response` or `responseFile` JSON routes. Application `handler` routes are outside this static snapshot format because their implementation and dependencies need their existing application deployment.

## Actual operator flow

The seller config and each referenced `responseFile` must live within the same original config directory (including subfolders) as regular non-symlink JSON files. This prevents accidental collection of unrelated secrets from arbitrary host locations. Place staging output under an *existing* private parent, outside the original source.

```sh
F=stellar/scf-starforge-20261009
node "$F/sf102-seller-recovery/recovery.mjs" pack \
  --config /private/merchant/seller.json \
  --out /private/backup/sf102-20261011-a
node "$F/sf102-seller-recovery/recovery.mjs" verify \
  --bundle /private/backup/sf102-20261011-a

# On a destination host after privately transferring this bundle:
node "$F/sf102-seller-recovery/recovery.mjs" restore \
  --bundle /private/import/sf102-20261011-a \
  --to /private/merchant/standby

# Start the EXISTING native SF30 runtime on both hosts or separate local ports.
# For a local no-wallet acceptance, omit --facilitator on both processes:
node "$F/sf30-seller-sdk/serve.mjs" --config /private/merchant/seller.json --port 8423
node "$F/sf30-seller-sdk/serve.mjs" --config /private/merchant/standby/seller.json --port 8425
node "$F/sf102-seller-recovery/recovery.mjs" probe \
  --bundle /private/backup/sf102-20261011-a \
  --current http://127.0.0.1:8423 \
  --standby http://127.0.0.1:8425
```

In production, make the standby's original service accessible via the operator's loopback path; both endpoints must be accessible as `127.0.0.1` on the machine running `probe`, for example through an existing authenticated SSH local forward. SF102 does not negotiate SSH or change DNS. `probe` reads only original `/_seller/health` and `/_seller/offers`; it sends no paid API request, payment header or settlement request. Its result identifies whether both metadata snapshots match the saved seller's compiled offers and route/method/URL/mode. The existing SF96/SF98 merchant paths handle deployment, native settlement and merchant delivery after the operator's cutover.

## Bind each live seller to the saved configuration

For a declarative route, the probe calls the original `compileHttpSellerOffer` with the saved definition and the applicable origin. For an imported route, it retains the saved complete offer and its original embedded URL/schema. It maps each live offer through the original health route ID, method and URL, so array position cannot associate a different route's price with the saved route.

Both endpoints are checked independently for:

- The same route IDs, methods and fixed or imported route-template identity.
- The complete original compiled offer, including resource metadata and Bazaar input/output schema.
- Every ordered payment choice: scheme, network, asset, atomic amount, exact recipient, timeout and `extra`. Missing, added, reordered or changed alternatives produce a specific option diagnostic, including when the first alternative is unchanged.
- A known, matching seller mode. A native seller and a challenge-only standby do not have the same operating mode even when their offers match.

An explicit `publicOrigin` remains fixed on both listeners. The original SF30 origin normalization handles its optional trailing slash. Imported offers always retain their saved origin and concrete sample URL; they require the matching configured public origin, as the original seller does.

For definition-only local development without `publicOrigin`, each original seller advertises its own `http://127.0.0.1:PORT` URL. These ports may differ. The probe requires one canonical loopback origin across each endpoint's routes and compiles the saved definitions against that endpoint's actual advertised origin. Paths, methods, payment alternatives and the rest of the offer still match exactly. A probe port forwarded through SSH may differ from the advertised listener port. This local-origin equivalence never applies to imported offers or an explicitly configured public origin.

### Drift output and CLI exit status

Success retains `cutoverParity: true`, the original config/offer hashes, mode and route count. It adds payment-option count, manifest identity format, both endpoint hashes and per-route expected/observed offer hashes. Raw offers, asset addresses, recipients and dataset bodies are not printed.

A source mismatch throws `SF102_CUTOVER_DRIFT` from the exported `probe()` function. Its `error.report` contains `cutoverParity: false`, the endpoint summaries and a structured `drift` array. The CLI writes that report as JSON to stdout, the error code to stderr, and exits **2**. Invalid bundles or command arguments retain exit **1**; a successful probe exits **0**. A consumer can therefore keep a failed cutover report for repair without treating a returned false result as a successful programmatic probe.

```sh
umask 077
node "$F/sf102-seller-recovery/recovery.mjs" probe \
  --bundle /private/backup/sf102-20261011-a \
  --current http://127.0.0.1:8423 \
  --standby http://127.0.0.1:8425 \
  > /private/merchant/cutover-report.json
```

Each drift item names `current`, `standby` or `pair`, and the route ID when applicable. Payment items include the one-based option index, changed field names and expected/observed hashes; the actual payment values stay private in the original configuration.

| Diagnostic | Meaning and operator repair |
| --- | --- |
| `PAYMENT_OPTION_DRIFT` | The named option differs in the reported fields, such as `payTo`, `amount`, `maxTimeoutSeconds` or `extra`. Start the affected original seller with the verified restored configuration, or create a new bundle for the intended current terms. |
| `PAYMENT_OPTION_COUNT_DRIFT` | An alternative was added or removed. Reconcile the full offered set with the selected saved configuration. |
| `OFFER_METADATA_DRIFT` | Resource or Bazaar metadata differs. Check the actual route definition/imported offer and deployed source. |
| `HEALTH_ROUTE_IDENTITY_DRIFT` | Route method, advertised URL or template differs from the saved route. Correct the original service configuration or public origin. |
| `MISSING_LIVE_ROUTE`, `UNEXPECTED_LIVE_ROUTE`, `DUPLICATE_LIVE_ROUTE` | The listener is serving a different or ambiguous route set. Inspect the loaded config and current process. |
| `MISSING_LIVE_OFFER`, `AMBIGUOUS_LIVE_OFFER`, `UNASSIGNED_LIVE_OFFERS` | Health and offer metadata cannot be associated uniquely. Use the original matching runtime/config together. |
| `INVALID_DEFINITION_LOCAL_ORIGIN`, `INCONSISTENT_DEFINITION_LOCAL_ORIGINS` | An origin-free definition deployment does not advertise one canonical loopback listener. Imported/public configurations cannot use local-origin equivalence. |
| `SELLER_MODE_DRIFT`, `INVALID_LIVE_MODE` | The two runtime modes differ or a response is not a recognized original seller mode. |
| `SOURCE_READ_FAILED` | Health or offer retrieval failed, timed out, redirected or returned invalid JSON. Check the existing listener/forward and use the report's named endpoint and surface. |

This is a point-in-time comparison of the published original metadata. Bundle verification separately checks the saved data bytes. A live health/offer response does not expose the running backend's file contents, proxy state, facilitator state or wallet state, so those continue through their existing deployment and merchant acceptance paths.

## What gets delivered

`pack` creates a new private directory `0700`, including `seller.json` (original route declarations with rebased `./assets/<id>.json` paths), exact JSON byte snapshots under `assets/`, and `manifest.json` with route/payment fingerprints, asset SHA-256, original/staged config SHA-256 and canonical origin. Files are create-only `0600`; existing output directories are never overwritten. The original config and data are not modified. The manifest contains no recipient addresses or atomic prices, while private `seller.json` necessarily retains the original payment terms and data declarations. Keep the bundle in the merchant's private recovery storage.

`verify` ensures manifest/schema/route/asset correspondence, hash integrity, strict UTF-8 JSON and no unexpected files, including explicit symlink and size guards. `restore` verifies the source and creates a distinct private destination with the same staged config/assets and a receipt. No scripts, wallet keys, facilitator secrets or imported application modules are copied. For inline `response` routes, the unchanged exact JSON travels inside `seller.json`.

### Ordered payment identity and old bundles

The bundle schema remains `stellar-forge.sf102.seller-recovery.v1`. New manifests add `paymentIdentity: "stellar-forge.sf102.ordered-payment-options.v1"`. Under that explicit format, each route's `paymentHash` hashes the entire normalized option array in merchant order; `paymentOptionCount` and `optionHashes` expose the count and each full-option hash. `normalizeSellerPaymentOptions` from the original SF30 seller supplies the same bounded payment/extra validation used by the live runtime. Object-key order does not change the fingerprint; array order does.

Old manifests without `paymentIdentity` continue through their exact original route-fingerprint comparison and unchanged full `sellerConfigSha256`/asset checks. The returned identity is `LEGACY_ROUTE_FINGERPRINT`. The updated probe derives every offered option from that verified saved config, so an old first-option fingerprint does not limit current live comparison. This also supports earlier bundles whose definition already used `paymentOptions` even though their old route fingerprint did not summarize the array.

`restore` preserves saved seller and asset bytes for either format and records the identity format/count in `RECOVERY-SOURCE.json`. To produce an updated manifest, pack the verified restored seller config into a new bundle. Retain historical bundles as written. An unknown explicit payment identity version is rejected instead of being treated as legacy.

## Boundaries and commercial value

This creates a portable operator asset for existing static paid datasets/APIs: a customer can recover from a failed host, stage a replacement and preserve unchanged payment terms before proxy cutover. It works alongside current SF30 seller (including SF61 OpenAPI-derived static configs), SF93 support handoffs, SF99 HTTPS deployment and SF98 settlement notification without modifying those owner files. For intended changes to the public origin or commercial payment terms, update the original seller configuration and pack that actual configuration into a new recovery bundle.

Encrypted whole-merchant recovery and native outbox continuity remain in their existing SF101/SF108 modules. SF102 checks the static seller's saved data and published offer configuration; it does not copy, merge, reset or requeue merchant settlement journals.

No GitHub Actions, background timers, server processes, scheduled tasks, hosted spend or submission/transaction are started by SF102 itself. Its scoped CLI output contains hashes/counts, never the JSON dataset body.

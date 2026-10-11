# Blockscout token-information merchant

This package turns the configured Blockscout PRO token-information route into a
complete Stellar Forge merchant. A customer selects an EVM chain and token
address, reviews the original offer, pays through the original Stellar buyer,
and receives the exact retained provider JSON. The provider desk keeps account
usage, quota observations, token-read history and verified downloads beside the
original merchant traffic, pause/resume and settlement controls.

The implementation composes the original SF61 OpenAPI importer, SF30 merchant
and upstream transport, SF98 settlement outbox, and SF88 Node/Python buyers.
Its private SQLite database records provider attempts and response bytes.
The existing payment components keep the spend journal, approval, signing,
settlement and receipt records.

## Source and installation

Use a complete matching Stellar Forge checkout on Linux with Node 24 or newer,
Python 3.11 or newer, and `flock`. Node's built-in SQLite module supplies the
provider database. The merchant and buyer use the existing pinned official
`@x402/core`, `@x402/stellar` and `@stellar/stellar-sdk` dependencies in the
original runtime; their existing lockfiles and installation instructions apply.

Run these commands from the repository root:

```sh
BS=stellar/scf-starforge-20261009/partners/blockscout-stellar-pro-api
BUYER=stellar/scf-starforge-20261009/sf88-operator-buyer-cli
mkdir -m 700 /private/blockscout
node "$BS/cli.mjs" template > /private/blockscout/plan.json
chmod 600 /private/blockscout/plan.json
```

Replace `/private/blockscout` with an absolute private directory owned by the
operator. The parent must exist. All package, merchant, buyer, downloaded and
restored paths in the following commands are absolute paths.

Edit the plan's public merchant origin, provider account alias, API-key
environment-variable name, actual Stellar asset contract, merchant recipient,
and explicit atomic price for each configured chain. The public merchant
origin must use HTTPS. The data route remains
`/{chain_id}/api/v2/tokens/{address_hash}`; an address is exactly `0x` followed by
40 hexadecimal characters. A query string or request body is rejected before
payment.

The plan's `payment.network` is `stellar:testnet` or `stellar:pubnet`. Its
`chains[].chainId` identifies the indexed EVM data, such as Base `8453`.
Token decimals, supplies, market values and other numeric text stay strings.
An asset's bridge-origin fields remain separate from the requested data chain.

Supply the existing provider credential through the environment variable named
by `apiKeyEnv`. The default name is `BLOCKSCOUT_PRO_API_KEY`. The application
reads it once at launch and sends `Authorization: Bearer …` only to the fixed
`https://api.blockscout.com` origin. The plan, generated package, buyer offer,
operator browser and stored quota records carry the variable name and account
alias. Credential rotation takes effect on the next drained restart.

[CONTRACT.md](CONTRACT.md) records the exact first-party route, response fields,
quota units, error behavior and service terms used by this package.

## Prepare and start the complete merchant

Preparation is offline and creates a new private package. It includes the
original OpenAPI document, selections, route bindings, seller service and
offers, trusted handler entry, run instructions, and a manifest containing
every file's exact SHA-256 and byte count.

```sh
node "$BS/cli.mjs" inspect --plan /private/blockscout/plan.json
node "$BS/cli.mjs" prepare \
  --plan /private/blockscout/plan.json \
  --out /private/blockscout/package-v1
node "$BS/cli.mjs" serve \
  --package /private/blockscout/package-v1 \
  --state /private/blockscout/merchant \
  --facilitator https://YOUR_EXISTING_STELLAR_FACILITATOR \
  --port 8423 --operations-port 8424 --desk-port 8425
```

The original native facilitator must support the selected Stellar asset,
recipient and sponsored exact-payment terms. The existing
[native facilitator](../../native-facilitator/README.md) can supply those
terms. An operator-controlled facilitator on HTTP `127.0.0.1` can be selected
with `--allow-local-facilitator`; the provider target remains the fixed
Blockscout PRO HTTPS origin.

Expose only the original seller listener through the HTTPS reverse proxy for
the configured public origin. The provider desk and original operations
listeners bind to loopback. Startup prints the current private controller URLs:

| URL | Purpose |
| --- | --- |
| `seller`, `offers` | Original seller listener and discovery |
| `providerDesk` | Provider quota, token read history, buyer preparation and backup |
| `operations` | Original merchant traffic and usage |
| `availability` | Original persisted pause, drain and resume |
| `fulfillment` | Original settlement and delivery outbox |

The private desk URL contains a random capability in its fragment. The browser
removes that fragment from the address bar and uses the capability in an
original-origin request header. Open the newly printed URL after restarting the
merchant; it has a new capability. CLI operations also accept a loopback base
URL plus `--token-env VARIABLE`, with the existing capability supplied through
that environment variable.

Keep the same `--state` directory when restarting, rotating the provider
credential, changing prices, or selecting an earlier package. The account
alias binds the existing provider database to the intended account. One
Linux file lease owns that database at a time.

## Read quota and account history

Open the private provider desk, select a chain and token address, and choose
**Read provider once** to make one explicit account-billed diagnostic request.
A normal status refresh, history selection, buyer preparation and saved
response download do not make a provider request.

The same operations are available without the browser:

```sh
node "$BS/cli.mjs" status --url "$BLOCKSCOUT_DESK_URL"
node "$BS/cli.mjs" probe --url "$BLOCKSCOUT_DESK_URL" \
  --chain 8453 --address 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
node "$BS/cli.mjs" attempts --url "$BLOCKSCOUT_DESK_URL" \
  --chain 8453 --address 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

History is paged by its retained sequence. Pass the returned `nextAfter` as
`--after` until it is null. Every attempt identifies the selected data chain,
address, plan hash, purpose, start/end time, provider HTTP status, local credit
reservation, retained body digest and exact observed quota-header values.

Successful token JSON remains byte-for-byte intact. Its schema and selected
address are checked before the original seller releases it. Contract changes
produce a retained failed attempt with a specific error, allowing the operator
to inspect the saved provider body. Provider error responses use the original
upstream transport's sanitized error contract. A credential echo is removed
before retaining or releasing a response.

### Budget semantics

There are two distinct sources of information:

| Source | Meaning |
| --- | --- |
| Local attempt ledger | Configured UTC daily attempt/credit ceilings, per-second limit, in-flight limit and storage reservation |
| Provider response headers | Account credits and request-window values observed on a particular returned request |

`creditsPerAttempt` defaults to 20 for this token-detail route. Select the
actual tariff and operating ceiling for the provider account. Local configured
credits are an admission estimate; the provider headers retain the account's
own values. Other applications using the same API key may also consume quota.

Admission reserves capacity again immediately before the actual upstream
request. Concurrent requests share the same account-wide ledger across all
configured chains. Fresh provider samples are combined conservatively with
attempts that may not have been included in the sample. The lowest applicable
sample and those retained reservations prevent concurrent reads from each
spending the same reported balance. The desk displays the raw provider value
separately from the resulting local availability estimate.

`x-ratelimit-reset` is a duration in **milliseconds until reset**. It is not an
epoch timestamp. A provider value of `-1`, absent header, or unusable integer is
shown as unknown. Credit samples expire according to the explicitly configured
`quotaFreshnessMs`; rate-window constraints expire after the reported duration.
The local daily and per-second ceilings continue to apply.

A crash leaves an admitted provider attempt as `outcome_unknown` on reopening.
Its original credit/request amount remains reserved against later applicable
provider samples because a restart time does not establish remote completion.
It retains its reserved local credits because the provider may have processed
the request. Reopening does not issue another read. A transport result known
to have never dispatched releases its configured local credits. Exact
provider response bytes and quota data stay associated with their original
attempt and plan.

Storage limits reserve room for each accepted maximum-size response. When the
configured record or byte ceiling is reached, the original merchant stops
admitting new provider reads. Export the retained database and select an
appropriate explicit limit in a new plan. Existing records remain readable.

## Select and prepare an original buyer

Use the desk's buyer form or the following command. Supply one stable intent
for one selected purchase and a new destination for the original response:

```sh
node "$BS/cli.mjs" buyer \
  --package /private/blockscout/package-v1 \
  --chain 8453 \
  --address 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --intent blockscout-base-usdc-001 \
  --out /private/blockscout/buyer-review.json \
  --response-out /private/blockscout/token-response.json
```

This materializes the original merchant offer for the exact token URL and
passes it through the original SF88 review compiler. The saved review includes
the original discovery hash and selected Stellar payment terms.

Initialize the original operator workspace with the actual existing payer:

```sh
node "$BUYER/cli.mjs" --init-workspace \
  --config /private/blockscout/buyer-review.json \
  --dir /private/blockscout/operator \
  --actor merchant-data-operator --service blockscout-token-data \
  --payer ACTUAL_EXISTING_STELLAR_PUBLIC_ADDRESS \
  --python /absolute/python3 \
  --secret-env EXISTING_STELLAR_SIGNER_ENV
node "$BUYER/cli.mjs" --review-workspace --dir /private/blockscout/operator
node "$BUYER/cli.mjs" --diagnose-workspace --dir /private/blockscout/operator
```

The original initializer owns the signer binding, local spend policy, journal
and HMAC keys. Use its `--signer-provider`, `--rpc`, explicit proxy options,
and total/daily atomic ceilings when required by the existing deployment.
The original [SF88 guide](../../sf88-operator-buyer-cli/README.md) and
[mainnet guide](../../sf88-operator-buyer-cli/MAINNET.md) describe those options.
Execute through one selected application interface for this intent.

### Node application

The runnable Node client uses the original durable Node buyer. Preparation
snapshots the already initialized operator configuration and creates the
original offline review:

```sh
node "$BS/customer.mjs" prepare \
  --workspace /private/blockscout/operator \
  --state /private/blockscout/node-buyer
node "$BS/customer.mjs" review \
  --state /private/blockscout/node-buyer --intent blockscout-base-usdc-001
node "$BS/customer.mjs" execute \
  --workspace /private/blockscout/operator \
  --state /private/blockscout/node-buyer --intent blockscout-base-usdc-001 \
  --config-sha256 EXACT_SHA_FROM_THE_REVIEW
```

Execute from the original operator terminal with the already configured signer
environment. The original buyer performs approval, reservation and signing.
It records a permanent attempt before the native call and saves the original
result and response file. The supplied review hash selects the exact retained
configuration. The Node wrapper also checks that the current operator
workspace still matches that copied configuration.

Reopen and save the completed response:

```sh
node "$BS/customer.mjs" recover \
  --state /private/blockscout/node-buyer --intent blockscout-base-usdc-001
node "$BS/customer.mjs" save \
  --state /private/blockscout/node-buyer --intent blockscout-base-usdc-001 \
  --out /private/blockscout/base-usdc-copy.json
```

The module also exports `prepareCustomer`, `reviewCustomer`,
`executeCustomer` and `recoverCustomer` for an existing Node application.
The returned original `BuyerResult` supports verified `json()`, `bytes()`,
streaming `chunks()` and create-only `saveAs()`. Numeric token fields remain
JSON strings. The original result directory retains the native payment
outcome, receipt and response digest.

### Python application

The Python entrypoint uses the original Python buyer and its native workspace
bridge. It requires Python's standard library and the existing Node runtime.

For a purchase selected for the Python interface, prepare its original
operator workspace and then run:

```sh
python3 "$BS/customer.py" prepare \
  --workspace /private/blockscout/python-operator \
  --state /private/blockscout/python-buyer --node /absolute/node
python3 "$BS/customer.py" review \
  --state /private/blockscout/python-buyer --intent blockscout-base-usdc-python-001 \
  --node /absolute/node
python3 "$BS/customer.py" execute \
  --state /private/blockscout/python-buyer --intent blockscout-base-usdc-python-001 \
  --config-sha256 EXACT_SHA_FROM_THE_REVIEW --node /absolute/node
python3 "$BS/customer.py" recover \
  --state /private/blockscout/python-buyer --intent blockscout-base-usdc-python-001 \
  --node /absolute/node
python3 "$BS/customer.py" save \
  --state /private/blockscout/python-buyer --intent blockscout-base-usdc-python-001 \
  --out /private/blockscout/python-token-copy.json --node /absolute/node
```

The Python bridge loads the original workspace journal keys inside Node. Its
permanent attempt, saved result, review hash and verified response readers
remain in the original Python buyer state.

A recovered result can be available even if a parent process did not retain
its exit code. Inspect the original native status and delivery fields. For an
interrupted settlement or accounting outcome, use the original
[buyer accounting](../../sf88-operator-buyer-cli/MAINNET.md) and
[workspace recovery](../../sf88-operator-buyer-cli/RECOVERY.md) tools against
the existing intent and journal.

## Pause, drain, restart and selected rollback

The provider desk links to the original
[availability controller](../../sf30-seller-sdk/availability/README.md).
Select the exact merchant routes, inspect the current revision, and pause
them. Already admitted native operations drain under the original grace
period; new requests receive the original availability response. Discovery
still describes the merchant's configured routes.

The original availability CLI can operate the same live controller:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/availability/cli.mjs \
  status --url "$BLOCKSCOUT_AVAILABILITY_URL"
node stellar/scf-starforge-20261009/sf30-seller-sdk/availability/cli.mjs \
  pause --url "$BLOCKSCOUT_AVAILABILITY_URL" \
  --revision CURRENT_DISPLAYED_REVISION --route blockscout_8453 \
  --reason "Provider account maintenance"
```

Select up to 100 distinct routes with repeated `--route` options. Resume with
the current displayed revision. A revision conflict returns the current state
for review.

Stop the merchant with SIGINT or SIGTERM. The launcher drains the original
seller, closes the private provider desk and original operations observer,
then closes the upstream/accounting layer. Admitted backups finish before the
provider database closes.

Prepare any changed plan in a new package directory. To select an earlier
price/package after draining, start `serve` with that package and the **same**
merchant state directory. Historical attempts retain their original plan
hash; local account usage, paused routes and settlement records survive the
selection. The generated trusted handler module can also be used by the
existing SF82 release tools, with `BLOCKSCOUT_ACCOUNTING_DIRECTORY` set to
the same private provider directory. Use only one active owner of that ledger.

## Complete provider backup and restoration

Create a consistent full provider database image while the original merchant
is running. The image includes every retained plan, attempted call, raw token
response and quota observation. The receipt pins its exact SHA-256 and bytes.

```sh
node "$BS/cli.mjs" backup --url "$BLOCKSCOUT_DESK_URL" \
  --out /private/blockscout/provider-backup.sqlite
```

If transport interrupts the download, the CLI returns the original retained
backup receipt. Resume that same immutable backup selection by downloading it
again into a new file:

```sh
node "$BS/cli.mjs" download-backup --url "$BLOCKSCOUT_DESK_URL" \
  --id ORIGINAL_BACKUP_ID --sha256 ORIGINAL_BACKUP_SHA256 \
  --out /private/blockscout/provider-backup-copy.sqlite
```

The browser downloads backups up to 64 MiB; the CLI streams larger retained
databases. Each download verifies the original server receipt and all bytes.
The backing database and its receipt remain in the merchant's private
`exports` directory.

Restore the original backup into the provider subdirectory of a new private
merchant root:

```sh
mkdir -m 700 /private/blockscout/restored-merchant
node "$BS/cli.mjs" restore \
  --source /private/blockscout/provider-backup.sqlite \
  --sha256 ORIGINAL_BACKUP_SHA256 \
  --out /private/blockscout/restored-merchant/provider
```

Restoration checks the complete input digest, SQLite integrity, schema, and
each retained plan identity. It preserves attempt IDs, original response
bytes and quota history. Pending reads in a restored snapshot reopen as
interrupted outcomes.

The provider database is one component of the complete merchant state.
Preserve the original `availability`, `delivery` and `usage` directories
through their original merchant lifecycle as well. The original SF98 outbox
must retain any unresolved settlement and delivery. Keep each buyer's
application state and original operator workspace together, using the
existing encrypted workspace recovery/export flow for its keys and journal.

## Embedding and extension

`prepareProduct(plan)` produces the original seller service and route bindings.
`createBlockscoutApplication(plan, {directory, env})` returns original handlers,
admissions, accounting operations, a snapshot and an asynchronous close.
`startBlockscoutMerchant(...)` composes the complete original seller and desks.
`prepareTokenBuyer(plan, selection)` emits the native offline buyer review.

The trusted programmatic `nativeFactory` option allows an existing
self-facilitated deployment to reuse its original SDK facilitator.
A separate explicit programmatic `developmentProviderOrigin` accepts only an
HTTP `127.0.0.1` origin for retained contract fixtures; the CLI has no provider
redirect flag. The runtime snapshot records that source selection.

All browser tables and JSON views use text rendering. Provider credentials
and controller capabilities stay out of buyer routes, response bytes,
published source and account-usage summaries.

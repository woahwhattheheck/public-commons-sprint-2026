# Portable native provider and operator journey

This package opens the existing CoinGecko market workspace on a configured host, with the original SF61 declaration compiler, SF30 seller, native facilitator, SF88 operator inbox, SF31 buyer and SF36 budget ledger. It includes the full browser journey and uses those original payment implementations.

The source preparation command makes **zero payments**. The browser journey subsequently prepares and explicitly executes **one Stellar testnet request**, then reopens and inspects that same native operation. Retained vendor Bazaar examples remain labelled as provider examples throughout delivery and comparison. The demonstration does not claim CoinGecko has deployed a Stellar endpoint or that its original examples are current market quotes.

## Source and runtime

Use the complete published repository or the complete source extracted from an existing market handover. Keep this directory at its original relative path; the helper imports the existing sibling Starforge modules directly.

Required local tools are Node 24 or later, Python 3.11 or later, and OpenSSL. Use an existing maintained native runtime where available. The original package versions and manifests are in [../../runtime-dependencies.json](../../runtime-dependencies.json). For an independently unpacked source directory, dependencies must resolve from an ancestor of **all** the sibling modules.

The browser also uses an existing Playwright installation and Chromium executable. Select them in the private configuration or through PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE. This package does not download a browser or run GitHub Actions.

No cloud container path is built into these commands. The native configuration can use paths relative to its own file. Runtime-created state, TLS material, buyer profile and output stay in its selected private run directory.

## 1. Retain all five original vendor sources

Reuse the exact metadata/body/challenge files already acquired for this work when they are available. Copy the complete original files without rewriting URLs, query strings, headers, timestamps or JSON values.

To acquire one fresh **unsigned** response from each documented family on connected compute:

    node stellar/scf-starforge-20261009/partners/coingecko-stellar-market/workspace/acceptance/collect-provider-sources.mjs \
      --directory /absolute/private/provider-sources

[sources.example.json](sources.example.json) records the five actual request URLs. The collector sends only an ordinary GET with explicit JSON and identity-encoding headers; it has no wallet, API key, payment header or signed retry. Each actual response is preserved under attempts/, including an unexpected HTTP status. Successful source files are published create-only with original body and challenge hashes. Reopening the same source directory completes a retained valid attempt and reuses completed families.

The five canonical file groups are:

| Family | Metadata and body stem | Decoded original challenge |
| --- | --- | --- |
| Coin prices | public-unpaid-response | public-payment-required.json |
| Onchain token prices | onchain-token-price-response | onchain-token-price-payment-required.json |
| Search pools | search-pools-response | search-pools-payment-required.json |
| Trending pools | trending-pools-response | trending-pools-payment-required.json |
| Token details | token-data-response | token-data-payment-required.json |

Each stem has both .json metadata and .bin original body. SOURCE_CAPTURE.json identifies the actual observations and attempts. A new observation belongs in a new source directory; a changed original response never overwrites an earlier one. The native preparation pins this complete packet before creating its receiving project.

The exact requested URL is independent of the challenge's advertised resource.url. In the acquired coin-price source those differ in query inclusion. Both are retained. Bad native Bazaar enum descriptions stay unchanged; the product's separate documented endpoint contracts supply the actual query semantics.

## 2. Configure the existing native accounts and signing environment

Copy [native.example.json](native.example.json) into a private directory and fill its public configuration paths. The existing runtime owner supplies:

- **publicConfigFile**: the original public Stellar testnet assignment, with direct string fields accounts.buyer, accounts.facilitator, and accounts.merchant, plus network, networkPassphrase and asset.
- **originalPaidResult** and **originalPaidResultSha256**: the exact retained original public outcome whose /outcome/requirement supplies the existing merchant account, asset, amount, timeout and payment-flow metadata. The helper verifies its hash and its agreement with the public assignment.
- **signerOwnershipDirectory**: the existing shared native ownership directory for those accounts. Keep the original ownership mechanism; do not create a second lease directory for the same funded signer.
- **buyerSecretEnv** and **facilitatorSecretEnv**: the names of the existing process environment variables. Their values stay in the environment supplied by that owner. Neither JSON file takes signer secrets.
- **vendorSourceDirectory**: the directory containing the complete five-family source packet.
- **sourceRoot**: the root of the complete selected source checkout. Omit it when the launcher is inside that checkout. **sourceRef** can pin the acquired Git commit; a normal checkout is detected automatically.
- **merchantOrigin**: the HTTPS development origin used consistently by the provider, SF88 profile, exact resource binding and local transport.

The native environment is testnet only. The copied original payment requirement is used verbatim; this package does not substitute account addresses, amounts, networks or payment options.

The optional **profile** selects the original SF88 profile ID/name and its retained private workspace path. The default path is inside the new run directory. It does not consume another service's pending business operation.

The optional **browser** fields select output, chromium and playwrightModule. Relative browser paths are resolved from the private configuration, except output, which is relative to the run directory. A bare Playwright package name uses normal module resolution.

The local development endpoint uses a generated TLS certificate and an explicit CONNECT proxy for the configured staging origin. Its certificate is added to this Node process's trust bundle. Existing TLS trust is retained; TLS verification is never disabled. An existing RPC origin uses the same transport's original bindings. The development TLS key is private run material, separate from Stellar signer secrets.

## 3. Prepare without payment

From the complete source root:

    python stellar/scf-starforge-20261009/partners/coingecko-stellar-market/workspace/acceptance/launch-native.py \
      --config /absolute/private/native.json --prepare

The command retains the actual five vendor sources and five separately labelled Bazaar examples, an ordered five-family collection, a provider plan and a frozen baseline. It starts the original seller in its actual challenge-only preparation mode and creates an isolated original SF88 profile from that exact merchant challenge. No payment is executed.

The selected run directory contains preparation.json, environment.json, the original source-bound profile preparation, NATIVE_PREPARATION_RESULT.json, and BROWSER_CONFIG.json. Output JSON reports the actual project/profile/collection IDs when preparation has completed. A process exit alone is not a completed preparation result.

The same configuration preserves operation IDs, recorded request bodies, imported source hashes, profile, ports and account bindings when resumed. Failed attempts remain in failures/ and NATIVE_LAST_FAILURE.json. Resume that existing run after correcting a concrete runtime problem; do not delete its state or create a replacement paid intent.

An earlier private preparation can be adopted on the same host by pointing directory, state, source files, profile and account bindings to that existing run. Copy its original environment into a separate private configuration file and select the current complete sourceRoot. The launcher derives the operation prefix from the retained original project intent, preserves the original profile and ports, and saves the exact previous environment before updating its format. It does not clear preparation steps, outputs or failed attempts. A run with no retained steps has no existing project intent to replace. Moving signing custody to another host still belongs to its existing runtime owner.

## 4. Open the original product or run the complete browser continuation

To open the product directly, have the existing owner supply the two named signing environment variables and run:

    python stellar/scf-starforge-20261009/partners/coingecko-stellar-market/workspace/acceptance/launch-native.py \
      --config /absolute/private/native.json --serve

The helper prints one readiness JSON object with workspaceUrl, projectId, continuationProjectId, buyerProfileId, providerPlan, the source/capture identifiers and retained paths. Open the emitted loopback URL.

For the full retained browser workflow, close that standalone server and run:

    node stellar/scf-starforge-20261009/partners/coingecko-stellar-market/workspace/acceptance/run-browser.mjs \
      /absolute/private/native-run/BROWSER_CONFIG.json

The generated browser configuration launches and closes the same native helper. Its sourceRoot field intentionally names the **vendor source directory**; the native helper's own sourceRoot field names the **repository root**.

The actual browser workflow covers the complete five-family source intake and row inspection, ordered collection, two-operator 409 revision resolution, provider setup and native discovery, one explicit original SF88 purchase, exact source comparison, named research handover, server close/reopen, separate-project full-source restore, and all eight operator views at mobile width.

The browser records each stage and retains its checkpoint before continuing. On recovery, use that same output directory and original native state. It inspects the original operation and its attempt status; it does not execute a second payment to recreate an earlier result. Stop the current driver before a continuation on another host. An independently restored historical project does not adopt live signer or budget custody.

UI_JOURNEY_RESULT.json is produced by the actual completed workflow, together with downloads, screenshots, runtime logs and the checkpoint. An unfinished or failed stage retains its actual result. Those files describe the host's observed run; the package itself does not claim they already exist.

## Complete handover and source custody

Use the product's Handover view to export its actual original sources, immutable snapshots, exact derived rows, notes, native outcome summaries, history and runnable source. This acceptance package is included in that original runtime source closure.

Live signer secrets, the original shared signer ownership directory, active SF88 budget ledger and local TLS private key remain outside the market project archive. Its restored historical jobs preserve their original classification. Reattaching a configured native buyer is a separate explicit action for a new operation.

Keep the source commit, original vendor source packet, native preparation result and final browser result together in the private operating handover. No command in this package sends a prospect email, publishes a service, changes CoinGecko's official payment options or grants provider API redistribution rights.

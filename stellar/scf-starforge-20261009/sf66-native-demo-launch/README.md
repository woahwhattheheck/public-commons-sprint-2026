# SF66: one-command original-source Bazaar Atlas demo

This small, MIT-licensed **integration launcher**, not another seller, catalog, browser, or payment simulator, composes the existing accepted SF60 persistent catalog with SF61 Bazaar Atlas. The reviewer sees the original operator's actual catalog state, or an explicitly selected public facilitator, through the existing browser. The launcher also captures one **real native provider page** for reproducible human inspection. It makes no claims about payment success, customer usage, grant eligibility, complete corpus coverage, or settlement.

## Three actual original-source modes

From the root of a current `public-commons-sprint-2026` checkout with Node 22 or newer:

```sh
# One command starts SF60's ORIGINAL durable service and SF61's ORIGINAL browser.
node stellar/scf-starforge-20261009/sf66-native-demo-launch/run.mjs \
  --directory /absolute/operator-owned/existing-sf60-journal

# If an existing operator already holds SF60's exclusive journal lock, reuse it:
node stellar/scf-starforge-20261009/sf66-native-demo-launch/run.mjs \
  --local-upstream http://127.0.0.1:8787

# Real optional public testnet comparison; only original GET discovery calls:
node stellar/scf-starforge-20261009/sf66-native-demo-launch/run.mjs \
  --upstream https://vellar-facilitator-testnet-production.up.railway.app
```

Each mode prints the actual loopback browser URL, source identity, observed native page row count, provider-reported total, pagination, network, and SHA-256 of that exact viewer-response JSON. Browsing is on `127.0.0.1`, using SF61's original Host/CSP/GET-only/timeout restrictions. No new payment code, wallet, signer, registrar, crawler, model or hosted infrastructure. The SF60 directory **must already contain** the operator's durable catalog; the launcher never creates an empty journal or ingests records. Ctrl-C closes the browser first and the SF60 owner second.

For a short-lived first-party original source readback to hand to a reviewer or repeatable Muse test, use:

```sh
node stellar/scf-starforge-20261009/sf66-native-demo-launch/run.mjs \
  --upstream https://vellar-facilitator-testnet-production.up.railway.app \
  --network stellar:testnet --limit 100 --once --snapshot /private/observed-page.json
```

`--snapshot` is **exclusive create**, mode `0600`, and holds the returned page exactly as the SF61 viewer exposed it, with full page JSON and a hash. This is **NOT** a raw upstream-byte signature, a catalog-wide coverage certificate, a ledger/payment receipt or a production latency benchmark. The original SF41 capture-v1 owner retains authentic upstream-body custody and the correct native full-coverage replay. If fewer than 100 items are returned, use the native pagination metadata to understand remaining pages rather than reporting a magically completed corpus.

## Why this addition exists

Previously reviewers needed two separate terminal processes, source/port coordination and an already populated journal to see the SF60+SF61 experience. This is one human-operable entry point with source observation integrated into startup. It retains every original module and source contract, makes the observed catalog page immediately visible and allows grant/merchant reviewers to compare genuine declared Stellar x402 HTTP/MCP offers without moving funds. It does **not** replace SF57 evidence packaging, SF56 diff, SF64 merchant conversion report, SF63 backups, SF65 cross-provider comparison or SF10 founder admission/application.

Original sources: [SF60 durable service](../sf60-durable-catalog-transaction/service.mjs), [SF61 Bazaar Atlas viewer](../sf61-bazaar-explorer/server.mjs), [original SF41 source replay](../sf41-real-source-replay/README.md). For broad 1:1 source-exact acceptance, the existing Muse worker can run the exact launcher against their retained original 27-row Vellar catalog/journal and report the observed native values, side by side with the original SF41 capture SHA and original SF60/SF61 source refs. No separate fabricated fixture runner is needed.

No GitHub Actions or other cloud CI is configured or invoked by this feature. CLI source can be checked offline with `node --check path/to/run.mjs`; actual external provider/retained-corpus acceptance must run on a networked, authorized original checkout.
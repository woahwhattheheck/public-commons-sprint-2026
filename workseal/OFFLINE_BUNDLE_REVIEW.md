# Offline WorkSeal browser-bundle verifier

This additive **Node 20+** CLI allows a judge or prospective buyer to inspect a downloaded `workseal-browser-bundle/v1` signed JSON receipt without opening the WorkSeal web demo. It imports the existing `web/core.mjs` verifier; it does **not** implement a competing signature format or weakened alternative to the browser rules.

From the `workseal` directory:

```bash
node src/verify_browser_bundle_cli.mjs --demo
node src/verify_browser_bundle_cli.mjs --file workseal-verified-browser-bundle.json
node src/verify_browser_bundle_cli.mjs --file workseal-verified-browser-bundle.json --json
node --test test/offline_bundle_cli.test.mjs
```

The `--demo` flag constructs a brand-new, explicitly synthetic in-memory example; it is **not** a Colosseum entry, a provider-verified completed job, nor evidence of an on-chain transfer. `--file` verifies a browser-exported public proof against its pinned GitHub Actions evidence, requirement digest, verifier Ed25519 public-key fingerprint and signature, task/result/generation/amount/parties/funding bindings, and settlement-intent digest. These are *internal cryptographic and semantic consistency checks*. The CLI cannot, by inspecting an exported JSON bundle alone, independently establish that the represented GitHub Actions run was obtained from GitHub or is still valid; a separate live provider receipt/source check is required for real settlement.

The CLI rejects invalid JSON/UTF-8, non-regular inputs, oversized input over 2 MiB and any failing verifier invariant. Exit codes: `0` PASS, `1` verification HOLD, `2` malformed invocation. JSON mode emits a single predictable receipt object and never echoes original evidence, private keys, tokens or the supplied bundle. No provider URL is fetched, no wallet is opened, no remote API is called, and no transaction is signed/submitted by this CLI. An offline PASS explicitly grants **no payment authority**.

Scope: three additive files only. No change to WorkSeal payment, browser, canonical digest, escrow contract or competition submission code. Focused coverage is one Node test with a valid synthetic browser bundle, a forged amount, and an oversized input.

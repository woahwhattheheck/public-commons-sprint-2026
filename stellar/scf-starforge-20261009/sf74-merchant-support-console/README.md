# SF74: Stellar merchant support console

An original operator-facing browser layer for the **existing, published SF70 merchant intake**. It does not replace or fork SF52 source visibility, SF68 browser preflight or SF70's combined result. All real diagnostic network operations remain in that imported source. This is a sales-support workflow for the existing SF49 merchant pilot, not a grant application or checkout engine.

## Run

From the public sprint repository (Node 22+):

```bash
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs
```

Open the printed `http://127.0.0.1:<port>/` locally. You need no package installation. Nothing is hosted or probed on page load. Fill an authorized seller resource HTTPS URL, facilitator catalog HTTPS URL, buyer origin, exact Stellar network, public `payTo`, and the advertised intended HTTP method. Confirm authorization, then run a single intake. The server validates input using the **current original SF70 `parseArgs`**, executes **current original SF70 `capture`**, renders the original report findings and full original nested source result as JSON, and supplies an explicit copy action for the one seller handoff. No content is written to disk; no browser localStorage, third-party JS or telemetry. Close the process to end the session.

For explicit local source fixtures only, `node .../server.mjs --allow-loopback` forwards the canonical SF70 `--allow-loopback` validation permission. It still binds the console to literal 127.0.0.1. Never set this switch to diagnose public or untrusted targets.

## Boundary and limitations

- Local HTTP server rejects non-loopback clients, unexpected Host and cross-origin form POST. Input capped to 8 KiB, one intake at a time. Browser CSP defaults to no external content. No cookies, credentials, wallet or database.
- SF70 uses original catalog pagination and guarded unpaid seller GET / browser GET+OPTIONS only where appropriate. A POST/MCP-only listing remains marked not assessed for a paid checkout; use the original method-aware result. This console does not issue paid POST, sign or settle.
- Original SF70 `state` and `findings` are displayed without reinterpretation. `INCONCLUSIVE` and `REMEDIATION_REQUIRED` are not an approved sale or payment. For any proposed paid remediation, SF49 owner still obtains real seller consent, commercial terms and buyer acceptance.
- `payTo` is a PUBLIC recipient address, not a secret. Do not paste private keys, privileged resource URLs or tokens. The report is intentionally retained only in the current browser tab unless an operator explicitly copies it.

## Focused reproduction

`server.mjs` exports `start({runCapture})` strictly for a local HTTP/API integration check. The default CLI mode always delegates to original SF70 capture; no fake result is shipped. The focused test verifies loopback-only host/origin gates, bounded type/schema validation with original `parseArgs`, POST→JSON→browser asset path and input-to-source configuration. It cannot establish live Vellar/Periplo network access, seller origin liveness, external user interest, or paid settlement; original Muse 1:1 corpus remains the separate accepted external evidence lane.
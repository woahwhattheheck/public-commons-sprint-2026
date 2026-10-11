# SF74: Stellar merchant support console

An original operator-facing browser layer for the **existing, published SF70 merchant intake**. It does not replace or fork SF52 source visibility, SF68 browser preflight or SF70's combined result. All real diagnostic network operations remain in that imported source. This is a sales-support workflow for the existing SF49 merchant pilot, not a grant application or checkout engine.

## Run

From the public sprint repository (Node 22+):

```bash
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs
```

Open the printed `http://127.0.0.1:<port>/` locally. You need no package installation. Nothing is hosted or probed on page load. Fill an authorized seller resource HTTPS URL, facilitator catalog HTTPS URL, buyer origin, exact Stellar network, public `payTo`, and the advertised intended HTTP method. Confirm authorization, then run a single intake. The server validates input using the **current original SF70 `parseArgs`**, executes **current original SF70 `capture`**, renders the original report findings and full original nested source result as JSON, and supplies explicit copy/download actions for the one seller handoff. The server never writes uploaded files or results to disk; browser downloads happen only when selected. No browser localStorage, third-party JS or telemetry. Close the process to end the session.

For explicit local source fixtures only, `node .../server.mjs --allow-loopback` forwards the canonical SF70 `--allow-loopback` validation permission. It still binds the console to literal 127.0.0.1. Never set this switch to diagnose public or untrusted targets.

## Boundary and limitations

- Local HTTP server rejects non-loopback clients, unexpected Host and cross-origin form POST. Input capped to 8 KiB, one intake at a time. Browser CSP defaults to no external content. No cookies, credentials, wallet or database.
- SF70 uses original catalog pagination and guarded unpaid seller GET / browser GET+OPTIONS only where appropriate. A POST/MCP-only listing remains marked not assessed for a paid checkout; use the original method-aware result. This console does not issue paid POST, sign or settle.
- Original SF70 `state` and `findings` are displayed without reinterpretation. `INCONCLUSIVE` and `REMEDIATION_REQUIRED` are not an approved sale or payment. For any proposed paid remediation, SF49 owner still obtains real seller consent, commercial terms and buyer acceptance.
- `payTo` is a PUBLIC recipient address, not a secret. Do not paste private keys, privileged resource URLs or tokens. The report is retained only in the current browser tab unless an operator explicitly copies or downloads it.

## Compare a repair in the same console

1. Run the authorized diagnosis before the repair and choose **Download intake JSON**. Keep this file unchanged. CLI-produced original SF70 JSON is accepted too.
2. Apply the separately agreed merchant repair. Run the same original diagnosis after the change and download the new capture. The browser may append a filename suffix; choose the actual earlier/later files by their contents, not filename alone.
3. In **Review a merchant repair**, select the original before and after SF70 files. For POST-only routes, also select both original SF72 preflight files, each bound to its corresponding unchanged SF70 file. Run SF72 against the downloaded file itself; copied or reformatted JSON may have different bytes.
4. Choose **Compare repair captures**. The existing SF76 comparator validates the original state/findings, literal merchant scope and chronological order. The interface shows its original classification, source timestamps and SHA-256 digests, remaining/new findings, findings no longer observed, incomplete-coverage warnings, and severity changes. Expand the full JSON for all scope fields and optional SF72 source hashes.
5. Choose **Download repair comparison JSON** to keep the result with the original captures. Changing any selected file clears the previous result; failed comparison never presents a prior success as the new result.

Comparison works without running a fresh diagnosis. It calls no merchant or provider endpoint, needs no network authorization checkbox, and accepts no server filesystem paths. Each file is limited to 2,000,000 bytes. The browser transfers the exact selected file bytes as base64 to same-origin `/api/compare`; the server decodes and hashes those bytes before parsing JSON and calls the **unchanged original SF76 `compare`**. Formatting, line endings and trailing newlines therefore remain part of file identity. Files and results stay in process/tab memory unless you explicitly download them.

The ordinary loopback/Host/Origin fences also apply to comparison. Uploaded JSON must be valid UTF-8 and original SF70/SF72 format. A hash binds the result to uploaded bytes; it does not independently establish that observations are authentic or that a seller authorized a commercial engagement. The original comparator's unpaid technical milestone is separate from a signed agreement, paid checkout, service delivery or Stellar settlement.

## Focused reproduction

`server.mjs` exports `start({runCapture})` strictly for a local HTTP/API integration check. The default CLI mode always delegates to original SF70 capture; no fake result is shipped. The focused test verifies loopback-only host/origin gates, bounded type/schema validation with original `parseArgs`, POST→JSON→browser asset path and input-to-source configuration. It cannot establish live Vellar/Periplo network access, seller origin liveness, external user interest, or paid settlement; original Muse 1:1 corpus remains the separate accepted external evidence lane.

Run the original-module HTTP integration from repository root:

```sh
node --test stellar/scf-starforge-20261009/sf74-merchant-support-console/test/comparison.test.mjs
```

The focused check runs the actual SF70/SF52/SF68 diagnostics against explicit local HTTP fixtures, then the actual SF72 preflight and unchanged SF76 comparator through the console API. It checks GET and POST repair paths, exact CRLF file hashes, malformed/oversized input, same-origin protection, changed scope, altered findings and SF72 byte-link rejection; comparison adds zero merchant requests. This is local software acceptance, not a live-provider or paid-checkout claim.

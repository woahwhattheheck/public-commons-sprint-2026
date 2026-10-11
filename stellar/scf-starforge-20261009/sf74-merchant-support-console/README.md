# SF74: Stellar merchant support console

An original operator-facing browser layer for the **existing, published SF70 merchant intake**. It does not replace or fork SF52 source visibility, SF68 browser preflight or SF70's combined result. All real diagnostic network operations remain in that imported source. This is a sales-support workflow for the existing SF49 merchant pilot, not a grant application or checkout engine.

## Run

From the public sprint repository (Node 22+):

```bash
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs
```

Open the printed `http://127.0.0.1:<port>/` locally. You need no package installation. Nothing is hosted or probed on page load. Fill an authorized seller resource HTTPS URL, facilitator catalog HTTPS URL, buyer origin, exact Stellar network, public `payTo`, and the advertised intended HTTP method. Confirm authorization, then run a single intake. The server validates input using the **current original SF70 `parseArgs`**, executes **current original SF70 `capture`**, renders the original report findings and full original nested source result as JSON, and supplies explicit copy/download actions for the one seller handoff. The server never writes uploaded files or results to disk; browser downloads happen only when selected. No browser localStorage, third-party JS or telemetry. Close the process to end the session.

Select **The buyer requires credentialed browser requests** when the intended buyer uses cookies or other browser credentials. This forwards the existing SF70 `--credentialed` policy to its original CORS evaluator; the diagnostic itself sends no cookies or authorization. The choice is retained in the intake and shown in its scope. Keep it identical before and after the repair, including both SF72 preflights for POST-only routes. Omitting the API `credentialed` field preserves the previous noncredentialed behavior; a supplied field must be a boolean.

For explicit local source fixtures only, `node .../server.mjs --allow-loopback` forwards the canonical SF70 `--allow-loopback` validation permission. It still binds the console to literal 127.0.0.1. Never set this switch to diagnose public or untrusted targets.

## Boundary and limitations

- Local HTTP server rejects non-loopback clients, unexpected Host and cross-origin form POST. Input capped to 8 KiB, one intake at a time. Browser CSP defaults to no external content. No cookies, credentials, wallet or database.
- SF70 uses original catalog pagination and guarded unpaid seller GET / browser GET+OPTIONS only where appropriate. A POST/MCP-only listing remains marked not assessed for a paid checkout; use the original method-aware result. This console does not issue paid POST, sign or settle.
- Original SF70 `state` and `findings` are displayed without reinterpretation. `INCONCLUSIVE` and `REMEDIATION_REQUIRED` are not an approved sale or payment. For any proposed paid remediation, SF49 owner still obtains real seller consent, commercial terms and buyer acceptance.
- `payTo` is a PUBLIC recipient address, not a secret. Do not paste private keys, privileged resource URLs or tokens. The report is retained only in the current browser tab unless an operator explicitly copies or downloads it.

## Run the original POST-only preflight

For an intake with intended method POST, the output offers **Run original OPTIONS-only preflight**. Review the displayed captured seller URL, buyer origin and credential mode, then explicitly authorize this separate check. The server calls the unchanged original SF72 eligibility gate and evaluator. Only a report proving the original complete POST-only HTTP payment route can trigger its one OPTIONS request; other reports return original `INCONCLUSIVE` with zero requests. No GET, POST, cookies, authorization or payment is sent by this action.

Download **both** the intake JSON and the SF72 preflight JSON. The latter contains the SHA-256 of the exact intake bytes offered by **Download intake JSON**, plus its original scope and observation timestamp. It is directly usable as the optional SF72 input in section 4 or the existing SF76/SF77 CLI workflows. Do not reformat the intake after generating its preflight. Repeat the diagnosis and optional preflight after the repair, using identical scope and credential policy.

The server accepts only a current POST intake with explicit `scope.browserCredentialed`, validates it with original SF76, and forwards that mode to SF72. An older file without a retained mode needs a new capture. Intake and preflight share the existing single-network-diagnostic gate. Changing intake inputs or replacing a report invalidates the old preflight display/download and requires a new diagnosis; late responses cannot restore stale results. Cancelling a browser request cannot undo an OPTIONS request already sent. Page load and comparison remain free of provider calls.

## Compare a repair in the same console

1. Run the authorized diagnosis before the repair and choose **Download intake JSON**. Keep this file unchanged. CLI-produced original SF70 JSON is accepted too.
2. Apply the separately agreed merchant repair. Run the same original diagnosis after the change and download the new capture. The browser may append a filename suffix; choose the actual earlier/later files by their contents, not filename alone.
3. In **Review a merchant repair**, select the original before and after SF70 files. For POST-only routes, also select both original SF72 preflight files, each bound to its corresponding unchanged SF70 file. Run SF72 against the downloaded file itself; copied or reformatted JSON may have different bytes.
4. Choose **Compare repair captures**. The existing SF76 comparator validates the original state/findings, literal merchant scope, browser credential policy and chronological order. Different known credential modes are rejected. Legacy captures with no original credential-mode evidence remain explicitly unconfirmed; they cannot claim a completed technical milestone or cleared findings. The interface shows its original classification, source timestamps and SHA-256 digests, remaining/new findings, findings no longer observed, incomplete-coverage warnings, and severity changes. Expand the full JSON for all scope fields and optional SF72 source hashes.
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

The POST preflight integration can be checked separately with:

```sh
node --test stellar/scf-starforge-20261009/sf74-merchant-support-console/test/post-preflight.test.mjs
```

It uses original local HTTP captures, original SF72 OPTIONS and original SF76 comparison: explicit permission and Origin gates, zero calls on page load/ineligible input, one authorized OPTIONS, exact downloadable-intake hash, serialized network checks and end-to-end paired repair comparison. No rendered browser test or live-provider claim is implied.

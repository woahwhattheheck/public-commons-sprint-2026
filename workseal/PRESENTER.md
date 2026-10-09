# WorkSeal: executable judge walkthrough (synthetic fixture)

This adds a **separate, self-contained presentation UI** for the existing Colosseum WorkSeal prototype. It changes neither the browser verifier nor the protocol, Solana adapter, payment routing or existing demo. Source-only; no entrant registration, third-party hosting or competition submission occurs by running it.

## Run locally

From the **repository root**:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/workseal/web/presenter.html` in a modern browser with Web Crypto Ed25519 support. A static HTTP server is required for browser ESM imports. No third-party package, external API, RPC account, wallet or service credentials are required. Python is serving static files only, with no backend application.

Click **Generate and verify receipt** to generate a fresh ephemeral verifier keypair, run the actual `buildDemoBundle()` and `verifyBrowserBundle()` implementations from `web/core.mjs`, and show the signed task, worker result, verifier fingerprint, acceptance and settlement-intent digests in the four-stage user flow. The key's private half is not in the exported fixture; the page does not send it anywhere. Verify the on-page PASS and `writePerformed:false` invariant before treating the synthetic demo as operational.

Click **Tamper with receipt** to flip one hexadecimal character of the *result artifact digest* in a JSON-deep-copied bundle and run the same verifier. Expected result: HOLD with a typed source error, such as `receipt task/result digest mismatch`. The original signed proof stays untouched. Click **Restore valid proof** to clear the tampered comparison without re-signing; click **Generate and verify receipt** for a new fixture.

## Judge run-of-show (~75 seconds)

1. **Problem, 0–15s.** A worker can claim delivery, but an invoice alone does not say which task, which result generation, or whose acceptance authorizes payment.
2. **Bound terms, 15–30s.** Show task digest, parties, exact integer amount and the evidence policy. No rounding or freeform signature target.
3. **Signed acceptance, 30–45s.** Generate a proof. Show `PASS` and the verifier fingerprint, acceptance and settlement-intent digests. Explain that Ed25519 signs the acceptance *for that result generation*.
4. **Adversarial edit, 45–60s.** Alter the artifact digest. `HOLD` appears despite a previously valid signature because the signed receipt no longer binds the changed result.
5. **Boundary, 60–75s.** An intent is **not an executed payment**. Current proof is wholly synthetic: it does not attest to live GitHub API, deployed escrow, verified funding, token transfer or Colosseum submission. Next meaningful milestone is devnet escrow + external evidence + actual submission with owner authorization.

## Scope / assets

Add exactly these files to `woahwhattheheck/public-commons-sprint-2026`:

- `workseal/web/presenter.html`
- `workseal/web/presenter.mjs`
- `workseal/PRESENTER.md`

The import `./core.mjs` deliberately reuses the actual WorkSeal browser verifier. It will fail if copied outside the repository structure or if the current version does not export `buildDemoBundle` and `verifyBrowserBundle`. The source was checked against the original repository October 9, 2026; publishing should use a fresh branch/head fence and preserve concurrent teammate edits.

**Trust/evaluation honesty:** This page's passed fixture is not proof of a live source provider, contest eligibility, actual token movement, a real customer, or a payable outcome. Its value is an accessible and reproducible interactive demonstration of the exact local integrity guarantees, including refusal of an intentionally altered artifact.

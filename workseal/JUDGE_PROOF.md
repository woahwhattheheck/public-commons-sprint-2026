# WorkSeal judge proof lab

The additive [`web/judge-proof.html`](web/judge-proof.html) makes WorkSeal's **existing original browser verifier** explorable as a nine-case proof matrix. It is part of the existing WorkSeal product and existing Colosseum entrant, not a second entry or payment processor.

## Launch the actual product page

From the repository root:

```bash
python3 -m http.server 8765
# In a normal desktop browser open:
# http://127.0.0.1:8765/workseal/web/judge-proof.html
```

Loopback is a browser secure context for WebCrypto. For remote hosting, use HTTPS. No package installation, API key, RPC node, wallet or signing account is needed.

Choose **Run source-native proof lab**. A fresh local Ed25519 key signs a synthetic ACCEPT receipt. The same `web/core.mjs` imported by the existing WorkSeal browser demo validates the intact result. Nine detached copies of that same signed proof are mutated one field at a time and passed back to **the original `verifyBrowserBundle`**, not a parallel permissive verifier:

| Stage | Adversarial edit | Gate demonstrated |
| --- | --- | --- |
| Buyer terms | change `task.amountAtomic` | pinned task digest |
| Worker result | change `result.artifactDigest` | pinned result/acceptance digest |
| Source evidence | change a CI step to failure | GitHub run/job/step verification |
| Source evidence | change pinned commit hash | expected source revision |
| Acceptance | impersonate verifier ID | task-pinned verifier identity |
| Acceptance | corrupt Ed25519 signature | signed receipt verification |
| Acceptance | change accepted generation | result generation binding |
| Settlement intent | change funding atomic amount | exact buyer/settlement terms |
| Buyer terms | replace acceptance requirement | fail-closed supported policy |

The baseline must show `PASS`, nine mutated inputs must be `REJECTED`, and only then does **Export signed proof + matrix** activate. The downloadable JSON contains the public signed fixture (never the ephemeral signing private key), the baseline verification hashes, the nine changed fields, and the exact original verifier responses. This is a portable, repeatable local proof, not a transaction receipt.

The page uses text-only DOM output for changed values and error messages; no untrusted case data is inserted as HTML. The interface is keyboard accessible, responsive on phones, and can be run offline after local files are available.

## Source-exact execution receipt

Before this additive UI was built, all three original source files were read from public `main` commit `02a652efdbdc22844ee277b464fb679bc0a661f5` and reproduced byte-identically in the ChatGPT Linux workspace. `git hash-object` matched:

- `web/core.mjs`: `9505e1ca9aabc2a2c1ded7e4b748957776bd9eba`
- `src/github_evidence_contract.mjs`: `d1cc940cedf0379299a6642625cc217a3f4ae693`
- `src/rfc3339.mjs`: `5dc1880b09e634b2d7edc5473edfee2d7564fad2`

The new page was exercised in Linux Chromium with the **unchanged original source module bodies** and the original nine-case page code. This container's managed Chromium disallowed navigation to local HTTP and `file:` origins, so the modules were bundled in-memory for the browser smoke test and browser WebCrypto was supplied through a standards-compatible Ed25519/SHA-256 bridge to Python `cryptography`. This was a local, credential-free, cryptographically real verification, **not** a browser-native WebCrypto run or live provider call. The result: original proof `PASS`, **9/9** distinct hostile fields rejected, **0** JavaScript page errors, JSON export successful, desktop and mobile rendering captured. For browser-native WebCrypto, run the unbundled page over secure localhost/HTTPS as described above.

No Solana program-test bank, Solana deployment, provider attestation, real funding, execution or customer payment was performed in this scope. Solana program-test execution and official hackathon upload remain with the previously assigned owners.

## Judge presentation and entry integration

- Open `web/presenter.html` for the original four-stage guided walkthrough, then `web/judge-proof.html` for independent hostile-case proof. Both exercise the same original verifier; the new page adds breadth without changing signed settlement or acceptance authority.
- Product-demo video: record the intact PASS, nine rejection cases and downloadable public proof, then clearly distinguish an *intent* from any real chain transaction.
- Separate 2–3-minute presentation video: problem (agents paid for promises instead of accepted results), WorkSeal product, concrete market and distribution thesis, and explicit remaining bank/deployment/adoption milestones. Founder-specific claims, credentials, references, and actual market traction must be supplied by the entrant owner.
- The existing Colosseum entrant submits **one product**, with required branding, source, team information and both video URLs via the existing owner-controlled account. This document is not itself a contest entry.

### Truth and authority boundary

The generated GitHub Actions record is deliberately illustrative and not an authenticated GitHub API capture; the signed acceptance identity is ephemeral and self-generated. A local `PASS` checks exact-format evidence coherence but does not confer external verifier authority. The Solana program has its own bank-test/deployment requirements, and the settlement intent is **not a transfer**. Real funds, wallet signing, buyer/supplier contact, account or terms changes, and official entry publication are outside this additive artifact.

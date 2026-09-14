# WorkSeal browser + GitHub Actions evidence adapter

This continuation makes the merged WorkSeal protocol judgeable without pretending that a wallet or Solana program has been deployed.

## Browser demo

Serve `workseal/` over any static HTTP server and open `web/index.html`. The page uses browser WebCrypto only. It generates an ephemeral Ed25519 verifier key, builds a synthetic successful GitHub Actions evidence record, signs an ACCEPT receipt, binds the exact signature + verifier fingerprint into the settlement intent, and re-verifies the bundle.

No network, wallet, RPC, transfer, Colosseum account, or provider mutation is performed by the demo. `writePerformed=false` and `externalAuthorityGranted=false` are explicit verification outputs.

## GitHub Actions evidence contract

`src/github_evidence_contract.mjs` is browser-safe and strict. A PASS requires:

- exact `owner/repo`, workflow path, workflow SHA-256, commit id, and event pinned by the buyer/verifier;
- a completed successful run and attempt id;
- an exact GitHub API run locator;
- a retained raw API-response SHA-256;
- the exact buyer/verifier-pinned required job-name set, with at least one step per job and every retained job/step successful;
- no duplicate jobs or step numbers;
- monotonic run/job/observation timestamps;
- no unknown fields.

`src/github_evidence.mjs` turns that normalized evidence into a WorkSeal `{id,digest}` entry.

### Trust boundary

This adapter validates a **retained evidence packet**. It does not cryptographically prove that arbitrary caller-supplied JSON came from GitHub. The host/verifier must independently retrieve and retain the API response/workflow bytes (or later use GitHub attestation/OIDC evidence) before treating the packet as authoritative. WorkSeal then prevents that exact retained evidence from being silently swapped after acceptance.

## Run focused proof

```bash
node --test test/github_evidence.test.mjs test/web_core.test.mjs
```

The repository workflow `.github/workflows/workseal-browser-evidence.yml` runs the existing full WorkSeal suite plus these paths on supported Node versions when WorkSeal changes.

## Remaining chain gate

The merged `src/solana.mjs` adapter remains a transaction-plan MVP. A true onchain escrow/PDA must be compiled/tested with a real Solana toolchain and deployed only with explicit wallet/provider authority. This carrier does not claim that gate is closed.

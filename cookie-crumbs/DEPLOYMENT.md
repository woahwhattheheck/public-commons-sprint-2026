# Cookie Crumbs deployment contract

This carrier publishes only the six runtime files required by Cookie Crumbs:

- `index.html`
- `styles.css`
- `app.js`
- `receipt.mjs`
- `chain.mjs`
- `history.mjs`

The source contract is bound to repository `woahwhattheheck/public-commons-sprint-2026`, hardened runtime source commit `6ea7fc3976676577f81f8a5adebd239487eb7c0a`, directory `cookie-crumbs`. The verifier pins every published file to its exact Git blob identity from that generation; later verifier/documentation commits intentionally do not change the runtime source generation.

## GitHub Pages release path

1. Merge the accompanying workflow and verifier into `main`.
2. In repository **Settings → Pages**, select **GitHub Actions** as the publishing source if Pages has never been enabled for this repository.
3. Dispatch **Cookie Crumbs Pages**, or push a Cookie Crumbs change to `main`.
4. Accept only a run where the deploy job passes the post-publication verifier and uploads a `cookie-crumbs-deployment-receipt-<sha>` artifact.

The workflow runs the full source test contract before packaging, uploads a least-authority static artifact, deploys it, then checks the live HTTP status, MIME types, required application markers, UTF-8 validity, byte ceilings, exact pinned Git blob identities, and SHA-256 digests. The least-authority artifact includes the checked-in chain/RPC module and signer-attribution module because `app.js` imports them directly; it executes no remote JavaScript dependency.

## Manual verification

```bash
npm run verify:deploy -- https://woahwhattheheck.github.io/public-commons-sprint-2026/cookie-crumbs/
```

A successful run emits `cookie-crumbs/deployment-receipt/v1`. A nonzero exit is terminal; do not claim a deployment from a provider dashboard alone.

## Security and authority boundaries

- The verifier never connects a wallet, asks for a signature, submits a transaction, or mutates chain state.
- No seed phrase, private key, provider token, or customer data belongs in the repository or receipt.
- The public runtime contains no third-party executable CDN script; the JSON-RPC client, Memo transaction encoder, and signer classifier are checked-in source and source-bound by the verifier.
- Recent-receipt attribution fails closed unless the exact connected public key is represented in parsed transaction metadata with `signer: true`.
- The workflow intentionally omits repository documentation, tests, and submission notes from the public artifact.
- A deployment receipt proves the fetched bytes and HTTP contract at its timestamp. It does not prove future uptime or a successful Cookie Chain transaction.
- Preserve original implementation credit for `ZAP-913433`, source-integrity discovery credit for Z-BankHarbor, and prior recovery credit for Z-PentacleHarbor in any internal handoff.

## Rollback

Disable the Pages workflow or revert the workflow commit. If the public endpoint must disappear immediately, disable GitHub Pages in repository settings after preserving the last receipt and workflow run URL.

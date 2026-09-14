# Cookie Crumbs submission packet

## One-line pitch

Cookie Crumbs gives developers a zero-backend way to sign compact release, audit, handoff, and incident receipts on Cookie Chain with Nightly, then verify and index signer-authenticated receipts from public chain history.

## Demo path

1. Open the app and verify live Cookie Chain RPC health.
2. Click **Connect Nightly + Cookie Chain**; approve the custom SVM network prompt if Nightly is on another network.
3. Choose a receipt type and edit the subject/note.
4. Inspect the exact `cookie-crumbs:v1` Memo payload and byte count.
5. Click **Write receipt on-chain** and approve the Nightly signature.
6. Watch submitted → confirmed state, open the CookieScan signature, and see the receipt reappear in **Your recent crumbs** only after the index verifies the connected public key is a transaction signer.

## Judging hooks

- **Useful:** public evidence breadcrumbs without a custom deployed program or backend.
- **Native:** transaction signing + confirmation happens on Cookie Chain; wallet activity is indexed from Cookie RPC.
- **Nightly support:** injected Nightly wallet, `standard:connect`, custom-network switch, transaction signing.
- **Attribution integrity:** the history index fails closed unless parsed transaction metadata marks the exact connected public key with `signer: true`; mere address appearance is not treated as authorship.
- **Source integrity:** the wallet-connected page executes only checked-in application modules; there is no third-party JavaScript CDN dependency, and deployment verification pins all six runtime files to exact Git blob identities.
- **Robustness:** preflight, blockhash expiry fencing, confirmation error handling, signature rejection messaging, conservative Memo byte bound, hostile signer-attribution tests, and deployment drift tests.
- **Open source:** source, tests, and CI are public and dependency-free at runtime.

## External publication checklist

Do not mark a row complete without the corresponding receipt.

- [ ] Dedicated/public GitHub repository URL (this sprint subtree is the current source carrier)
- [ ] Public live deployment URL
- [ ] Successful real Cookie Chain demo transaction signature
- [ ] X demo/guide thread URL
- [ ] Cookie Chain Telegram share receipt
- [ ] Superteam submission receipt

Advertised bounty: 1,000 USDC total prize pool. No acceptance, placement, or payment is implied by this packet.

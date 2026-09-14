# Cookie Crumbs

Cookie Crumbs is a small developer-facing cApp for **Cookie Chain**. It connects to **Nightly Wallet**, switches Nightly to the Cookie Chain community RPC with the chain's live genesis hash, writes compact human-readable receipts through Solana's Memo program, confirms the transaction, and indexes only recent Cookie Crumbs receipts for which the connected wallet is cryptographically represented as a transaction signer.

The target use cases are release evidence, audit checkpoints, handoffs, and incident breadcrumbs that benefit from a cheap public timestamp without deploying a custom program.

## What is real

- Cookie Chain HTTP RPC: `https://rpc.cookiescan.io`
- CookieScan explorer links for submitted signatures
- Nightly injected Solana wallet (`window.nightly.solana`)
- Nightly standard connect + transaction-signing features
- Nightly custom SVM network change using `getGenesisHash()` + `changeNetwork({ genesisHash, url })`
- Canonical Solana Memo program `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`
- Dependency-free checked-in JSON-RPC client and legacy Memo transaction encoder
- RPC confirmation fenced by last-valid-block-height
- Recent connected-wallet transaction indexing with exact signer attribution

There is no mocked success path, backend key custody, or remote executable JavaScript dependency.

## Safety / signing contract

Cookie Crumbs never requests seed phrases or private keys. The exact memo is rendered before signing. The user must click **Write receipt on-chain**, approve the Nightly signature, and have enough COOK for the fee. Rejected signatures are treated as terminal user decisions. The app does not bridge, swap, transfer tokens, or deploy a program.

The history view does not equate “an address appeared in this transaction” with authorship. A parsed transaction is eligible for **Your recent crumbs** only when its `accountKeys` metadata marks the exact connected public key with `signer: true`. Unknown or legacy-untyped account-key shapes fail closed.

Receipts use a compact versioned format:

```text
cookie-crumbs:v1|ts=<ISO8601>|kind=<encoded>|subject=<encoded>|note=<encoded>|id=<encoded>
```

The encoder normalizes control characters, percent-encodes delimiters, rejects malformed/duplicate fields on parse, and enforces a conservative 480-byte memo limit.

## Run locally

From the repository root:

```bash
python3 -m http.server 8080
# open http://localhost:8080/cookie-crumbs/
```

Nightly must be installed in the browser. The connect button may prompt to switch Nightly to Cookie Chain. Network reads work without a wallet.

## Validate

No dependency install is required for the test suite:

```bash
cd cookie-crumbs
npm run ci
```

All executable app code is checked in under `cookie-crumbs/**`; `index.html` intentionally contains no remote executable `<script>` tags. CI checks JavaScript syntax, the local transaction encoder/RPC request contract, signer-attribution hostiles, receipt round-trips/adversarial parsing/byte bounds, and static integration contracts for Cookie RPC, Nightly, signing, confirmation, and the Memo program.

## Source references

Implementation follows the sponsor/network docs rather than assuming Solana mainnet behavior:

- Cookie Chain getting started: <https://docs.cookiechain.wtf/getting-started>
- Cookie Chain developer guide: <https://docs.cookiechain.wtf/developer-guide>
- Cookie Chain wallet setup: <https://docs.cookiechain.wtf/wallets>
- Nightly connect: <https://docs.nightly.app/docs/solana/solana/connect/>
- Nightly sign transaction: <https://docs.nightly.app/docs/solana/solana/sign_transaction/>
- Nightly custom SVM network: <https://docs.nightly.app/docs/solana/solana/change_network/>

## Bounty publication boundary

This subtree is the source carrier for the Superteam **Create an App on Cookie Chain** bounty. Sponsor submission additionally asks for a public live app, GitHub repository URL, X demo/guide thread, and sharing that thread in the Cookie Chain Telegram. Those are separate publication/account actions and should only be marked complete when receipts exist.

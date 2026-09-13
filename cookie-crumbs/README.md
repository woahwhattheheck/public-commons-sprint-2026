# Cookie Crumbs

Cookie Crumbs is a small developer-facing cApp for **Cookie Chain**. It connects to **Nightly Wallet**, switches Nightly to the Cookie Chain community RPC with the chain's live genesis hash, writes compact human-readable receipts through Solana's Memo program, confirms the transaction, and indexes the connected wallet's recent Cookie Crumbs receipts.

The target use cases are release evidence, audit checkpoints, handoffs, and incident breadcrumbs that benefit from a cheap public timestamp without deploying a custom program.

## What is real

- Cookie Chain HTTP RPC: `https://rpc.cookiescan.io`
- Cookie Chain WebSocket RPC: `https://wss.cookiescan.io`
- CookieScan explorer links for submitted signatures
- Nightly injected Solana wallet (`window.nightly.solana`)
- Nightly standard connect + transaction-signing features
- Nightly custom SVM network change using `getGenesisHash()` + `changeNetwork({ genesisHash, url })`
- Canonical Solana Memo program `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`
- RPC confirmation with blockhash + last-valid-block-height fencing
- Recent connected-wallet transaction indexing

There is no mocked success path and no backend holding keys.

## Safety / signing contract

Cookie Crumbs never requests seed phrases or private keys. The exact memo is rendered before signing. The user must click **Write receipt on-chain**, approve the Nightly signature, and have enough COOK for the fee. Rejected signatures are treated as terminal user decisions. The app does not bridge, swap, transfer tokens, or deploy a program.

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

The browser client loads `@solana/web3.js@1.98.4` from jsDelivr. CI checks JavaScript syntax, receipt round-trips/adversarial parsing/byte bounds, and static integration contracts for the Cookie RPC, Nightly, transaction signing, confirmation, and Memo program.

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

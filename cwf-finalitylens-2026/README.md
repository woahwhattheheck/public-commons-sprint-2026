# FinalityLens — Solana cross-provider transaction evidence

An original, local-first, **read-only** Solana observability candidate for the 2026 Crypto World's Fair. Compare 2–5 independent RPC providers before reporting an observational finalization agreement. A single provider's “finalized” status is **never sufficient**; successful status must match transaction signature, slot, recent blockhash, and nil execution error on *every* endpoint. Missing, unsupported, conflicting and unavailable histories abstain. No private keys, wallet connection, signing or on-chain writes.

## Run the honest offline demonstration

Requires Node.js 22+, no `npm install` or network required.

```sh
npm start
# open http://127.0.0.1:8789
# choose matching finalized / pending / divergence / offline synthetic scenarios
```

The dashboard is visibly labeled `SYNTHETIC DEMO · NO NETWORK`. The demo signature and all observations are synthetic. The JSON evidence exports mark `SYNTHETIC_DEMO`; never present them as on-chain proof.

```sh
npm run check                # synthetic aligned example
npm run check -- "$SIG" divergent
npm run test:focused        # one focused evidence-classification suite
```

## Real read-only network mode

Use **at least two independent RPC providers on different hostnames**, configured only by the local operator. All remote endpoints must be HTTPS. No RPC URLs or query token secrets are returned to the browser or logged. Both RPC providers must be able to answer `getSignatureStatuses` and `getTransaction` for the same signature and support JSON version 0 decoding.

```sh
export FINALITY_MODE=live
export FINALITY_RPC_URLS='https://independent-rpc-one.example/rpc,https://independent-rpc-two.example/rpc'
export PORT=8789  # optional
npm start
# or: npm run check -- 'REPLACE_WITH_REAL_BASE58_TRANSACTION_SIGNATURE'
```

Never put credential-bearing endpoint URLs in screenshots or public shell history. The server binds **127.0.0.1** only. Each request caps returned JSON at 256 KiB and times out after seven seconds; at most two local requests run concurrently. RPC endpoints are configured by the operator's environment, not by web URL parameters. HTTP responses have strict CSP and disabled caching. Evidence timestamps describe *observed* time; no automatic blockchain height or RPC-trust threshold is inferred.

## Comparison semantics

| Verdict | Condition | Interpretation |
|---|---|---|
| `AGREED_FINALIZED` | Every independent provider supplies a matching, successful finalized status **and** same-signature transaction with identical slot and recent blockhash | Observational agreement only; **not** cryptographic consensus proof or payment authorization |
| `CONFLICT` | Cross-provider successful versus failed execution, or verified slots/blockhashes differ | Disagreement — investigate; don't assert one provider is honest |
| `AGREED_EXECUTION_ERROR` | All report same execution-error fingerprint | Agreement on *failure*, never successful payment |
| `PENDING` | All observations are missing/pending | No finality evidence |
| `INDETERMINATE` | Any mixed, unavailable, incomplete, or inconsistent evidence | Fail closed |

Important limitations: independent hostnames do not establish economically independent infrastructure; RPC nodes can share providers, lack transaction history, or lie. An agreeing set is not a direct Merkle/consensus proof. This is **not** a fund-release or chargeback decision system. Real RPC calls incur the operator's existing plan rate limits. Never enter a live payment credential or production endpoint just for a demo.

## Competition packaging and remaining work

- Source is ready to publish under `cwf-finalitylens-2026/` with MIT license, focused synthetic cases, dashboard, CLI and live read-only RPC mode.
- Official main event: https://colosseum.com/worldsfair ; deadline **October 12, 2026** (organizer listed, local entrant must check submission portal's exact clock/time zone).
- Before claiming an entry or prize: register the authorized Colosseum team and project; record a real operator-run multi-provider test and short demo video; publish the source at the authorized original-account GitHub location; submit via the real entry portal and retain actual confirmation ID. **None of these portal steps has been completed by producing this source.**
- A meaningful enhancement for maintainers: direct independent consensus proof / Merkle transaction inclusion verification, chain commitment verification, persistent signed audit evidence, and sensitivity to RPC backend correlation; this edition deliberately makes no such claims.

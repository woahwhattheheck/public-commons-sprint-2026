# WorkSeal x Solami: live Solana mainnet acceptance observation

**Competition lane:** Superteam Earn "Build Something Live on Solana Data" (Crypto World's Fair), advertised **3,000 USDG** competitive pool. Official sidetrack deadline observed: **2026-10-13 06:59 UTC**. This is source/evidence preparation, not a competition entry, provider account, award, escrow or payment receipt.

## Product wedge

WorkSeal verifies and content-addresses work: task -> result generation -> signed acceptance -> settlement intent. This adapter connects an accepted WorkSeal result to a **live finalized Solana mainnet slot**. The output binds the accepted task, result, acceptance and settlement digests to a chain observation in one deterministic receipt digest. This helps marketplace operators record which network state they saw after accepting a job, instead of relying on unverified screenshots or old slots.

Solami is the actual data path: it supplies all three on-demand JSON-RPC reads (getGenesisHash, getSlot(finalized), getBlockTime(slot)). Wrong networks, stale/null/future block times, malformed replies and unverified WorkSeal status abort. The adapter requires an owner-provided HTTPS Solami endpoint, never silently falls back to another RPC, and never calls a transaction method.

## Reproduce the live demo

Node 20+; no npm installation or third-party packages.

1. On the existing owner account, obtain a Solami mainnet HTTPS RPC URL and export it as SOLAMI_RPC_URL in your shell. Do not place endpoint credentials in a checked-in file or shared screenshot. This source does not create accounts or buy usage.
2. From workseal/, run: node src/solami_demo.mjs
3. The demo creates a **synthetic local WorkSeal acceptance**, verifies it using WorkSeal's real verifyBrowserBundle() path, reads a live finalized Solami mainnet slot and emits a content-addressed observation. Re-run later to show slot/time changes.
4. For real work, feed the real verifyBrowserBundle() result of an **authentic owner-approved delivery** into buildSolamiAcceptanceObservation. Never present the synthetic local acceptance as a paid customer result.

Focused check: node --test test/solami_receipt.test.mjs. Four cases cover read-only method allowlist, deterministic digest and credential omission, mainnet identity, freshness, malformed RPC frames and WorkSeal rejection.

This is a **provider-reported time-bounded observation**, not a signed oracle, irreversible settlement, on-chain anchoring, investor claim or proof that any funds moved. There is no wallet, token, signature or transaction execution path. Solami account use, live evidence capture, recording, truthful pre-existing-work disclosure, Colosseum registration and the separate Superteam Earn submission remain owner-authorized tasks.

## Submission evidence checklist

- Capture a real Solami mainnet read (method names, slot, and observation digest; redact complete endpoint/API key).
- Record the WorkSeal task/result/acceptance digests, verified PASS and live Solami observation in a 2-3-minute demo.
- Attach public source, exact run command, setup instructions and explain why finality/freshness/chain identity matter.
- Verify one eligible Colosseum team/product submission and required project history disclosures; separately submit to this Superteam track once if still open.
- Preserve provider submission ID and review result. **No submission, award or payment is asserted by a source merge.**

Official references: https://solami.dev/ ; https://solana.com/docs/rpc/http ; https://colosseum.com/worldsfair ; https://superteam.fun/earn/listing/build-something-live-on-solana-data/

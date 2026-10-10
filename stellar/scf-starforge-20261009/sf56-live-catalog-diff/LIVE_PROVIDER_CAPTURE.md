# SF56 · First-party live Stellar x402 Bazaar quote review

An original **source-connected read-only** operator/buyer workflow for Stellar Community Fund Starforge. It consumes the community Vellar facilitator's **real advertised** `GET /discovery/resources` protocol, not an independently invented ledger simulator. The module is isolated from the existing SF31 wallet/consumer, SF41 actual-source replay, SF45 internal catalog recovery and SF53 local proof workbench.

## What you can actually do

- Fetch all pages from **Vellar's current first-party documented hosted testnet endpoint** with an HTTPS `GET` only; save the vendor response verbatim as UTF-8 in `capture.json` with per-page raw SHA-256 and capture time. Default first-page `limit=100`, `offset=0`, network `stellar:testnet`.
- Examine every original `items[]` resource, each independent `accepts[]` option, and its **same-option** scheme, CAIP-2 network, SEP-41 contract, atomic amount and recipient. Never assert a valid (network,payee) pair assembled from two different options.
- Quarantine structurally invalid listings, duplicate resource IDs and ambiguous malformed options, rather than silently turning an advertised bad quote into a valid buyer candidate. A listing can contain multiple *distinct* valid offers; all are presented individually.
- Diff two captured snapshots by the resource/method/network/scheme/asset family, reporting **exact price and payee changes**, new offers, removed offers, and ambiguous multi-offer changes. No amount is parsed as floating point.
- Produce a polished static, local-only `review.html` with quoted amounts, seller URLs, review flags and provider-reported verification fields. HTML escapes all seller-controlled values, has a restrictive CSP and makes **zero remote requests**. JSON outputs retain exact advertised string values for further source-exact replay.

No wallet, signing callback, facilitator `/verify` or `/settle`, seller paid GET, merchant site fetch, Stars/SCF form, GitHub Action, CI workflow, automation, account mutation or outbound prospect contact is run. This is a read-only *first-party provider advertisement inspector*, not proof that a merchant controls a resource, a payment can settle, or a grant is approved.

## Run in the original public repository checkout

Node 22+, no npm dependencies. Existing cloud runtimes without DNS can use **the original authenticated Muse/local raw Vellar capture** rather than faking live payloads:

```bash
# Network-capable operator: actual read-only discovery, raw capture, static human report
node stellar/scf-starforge-20261009/sf56-live-catalog-diff/cli.mjs live --out /tmp/sf56-live

# Offline on full original JSON from GET /discovery/resources (items and total required)
node stellar/scf-starforge-20261009/sf56-live-catalog-diff/cli.mjs inspect --input /path/to/original-vellar.json --out /tmp/sf56-review

# Compare two genuine saved snapshots; does not open any network connection
node stellar/scf-starforge-20261009/sf56-live-catalog-diff/cli.mjs compare --before /tmp/sf56-old/snapshot.json --after /tmp/sf56-live/snapshot.json --out /tmp/sf56-delta

# One focused Node22 source interface/quoting/HTML safety check (no hosted CI)
node --test stellar/scf-starforge-20261009/sf56-live-catalog-diff/test/catalog.test.mjs
```

Raw `capture.json` replays offset+body (raw source bytes, UTF-8) for every page. Each `pageHashes[].sha256` covers the **actual individual HTTP body** in the live mode, rather than a reserialized JSON object. In offline `inspect` mode, a parsed JSON input provides a hash of its canonical *reserialized* page and is **not represented as the original HTTP-byte digest**. For multiple pages each page receives its own digest. The provider's declared `total` must equal retrieved rows, or the run fails rather than showing a partial corpus. A moving declared total fails before producing a mixed snapshot.

The current Vellar Railway origin and the `listResources({network:'stellar:testnet'})` API are documented by the Vellar project: [Discover services](https://docs.vellar.xyz/docs/buyers/discover-services). Stellar Foundation's official [x402 documentation](https://developers.stellar.org/docs/build/agentic-payments/x402) explicitly categorizes Vellar as a community testnet-only facilitator not independently audited. The approved replay baseline is the **existing** Muse SF41/SF45 run on 2026-10-10 with 27/27 original testnet catalog records, hash `63a7662d63c4cc610917ddfc7f2dbd490e88a9e491abf7b7038714a51d1b8c81`, not our source package. The full original payload should be passed through this module in the owner-run real corpus experiment; do not replace it with tiny offline regression fixtures.

## Operational acceptance for SCF + sales

1. Existing SF41/Muse owner reruns this code on the **same original 27-row live HTTP response bytes**, preserving source time, digest, all offer+quarantine counts and change report against the next genuine capture. Run the *full actual cohort*, not an arbitrary subset.
2. Existing SF43 buyer/SF35 settlement owners run separate real testnet payable proof using official canonical SDK, an authorized funded testnet wallet, upstream facilitator and independent Stellar receipt. This module must never be wired as authorization. Always re-check a fresh merchant `402` and buyer limits before paying.
3. Existing SCF founder owner chooses the correct official grant interest/application path and includes only claims supported by original source and independent acceptance. Existing business owner can demonstrate local HTML to a consenting prospective pilot, but no external contact or price/award claim is implied by source publication.

**Limitations:** This is a cross-snapshot *catalog advertised-term* diff, not a DNS ownership validator or quote oracle. Origin is hard-pinned to official Vellar Railway; arbitrary third-party proxy URLs are not accepted. A listing can be removed/replaced between captures. Host availability and chain settlement remain separate independently validated steps. `providerOwnerVerified` is provider-reported only. The CLI never follows HTTP redirects.

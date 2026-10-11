# SF79 | Native federated Bazaar change watch

MIT · Node.js 22+ · no packages · no hosted GitHub Actions · no seller payments.

A **real, operator-runnable longitudinal product** for the original SF70 two-facilitator Stellar x402 Bazaar discovery. SF70 already exposes current native Vellar and Periplo listings, while SF71 already compares *two* provider-complete observations inside one browser tab. SF79 imports the **original unchanged** `readFederation()` and `compareSnapshots()`; it adds durable per-capture custody, comparison across restarts, locally configurable watch duration, and JSON change notifications. It is **not** a second crawler, a reimplementation of the offer comparator, a merchant-origin diagnostic, or an independent settlement system.

SF66 Merchant Observatory operates on consenting *specific merchant + facilitator* checks and SF76 handles same-merchant before/after acceptance; this tool watches **the public native facilitator-advertised operations across both existing pinned providers**. Source promotions and incomplete coverage are explicit. The watcher never auto-contacts a merchant listed in a catalog.

## Start an actual pinned-provider observation

From the **full original** `woahwhattheheck/public-commons-sprint-2026` checkout:

```bash
# One original GET-only two-provider observation and private persisted report
node stellar/scf-starforge-20261009/sf79-native-catalog-watch/watch.mjs \
  --dir=/private/sf79-observations

# Two native observations 90 seconds apart; report new/removed/changed ads
node stellar/scf-starforge-20261009/sf79-native-catalog-watch/watch.mjs \
  --dir=/private/sf79-observations --samples=2 --interval-seconds=90

# Deliberately continuous *foreground* observation, until Ctrl-C
node stellar/scf-starforge-20261009/sf79-native-catalog-watch/watch.mjs \
  --dir=/private/sf79-observations --samples=0 --interval-seconds=300

# Independently verify the full local per-capture bytes and chained manifest
node stellar/scf-starforge-20261009/sf79-native-catalog-watch/watch.mjs \
  --dir=/private/sf79-observations --verify
```

`--samples=1` is the default; `--samples=0` means continuous foreground operation, **not** an automatic scheduled task. Select `--network=stellar:testnet` (default) or explicit `--network=stellar:pubnet`; no actual pubnet availability is asserted. Source URLs cannot be configured arbitrarily; they come from the current original SF70 module. The native SF70 reader retains its 12-second per-page timeout, 30-page, 3,000-row cap, strict pagination and redirect refusal.

**Reuse an already-running SF70 server** rather than doubling upstream traffic:

```bash
# Terminal A: existing original SF70 operator (not a new provider service)
node stellar/scf-starforge-20261009/sf70-federated-bazaar-operator/server.mjs --port=8788

# Terminal B: run watch against exactly that operator's forced genuine refresh
node stellar/scf-starforge-20261009/sf79-native-catalog-watch/watch.mjs \
  --dir=/private/sf79-observations --origin=http://127.0.0.1:8788 --samples=2 --interval-seconds=90
```

`--origin` only accepts literal `http://127.0.0.1:PORT`, with no path, query, DNS alias, credentials or fragment. The watcher GETs exactly `/api/federated?refresh=1` to bypass SF70's 8-second complete-capture reuse, while respecting its active singleflight coordination. No bearer credentials or browser cookies are forwarded. The original operator is authoritative for the two public provider GETs. Never point the watch at a seller endpoint.

## Actionable durable output

Every sample writes an **SF70-projected native source observation**, verbatim as JSON, to a private create-only `captures/capture-XXXXXXXX.json` file (mode 0600). `history.jsonl` is a chain of SHA-256 keyed entries referring to each full observation, with original capture timestamps and provider status, source-projection digest, optional SF71 change records and exact indivisible advertised payment options. Hashes protect local artifact consistency; they do **not** cryptographically attest the remote seller or recover *raw facilitator native JSON bytes*. For those raw external page hashes, use original SF41/Muse capture and manifest custody, not this projection.

One stdout JSON line per run reports original provider state, observed row count, baseline sequence, which providers could be compared, change counts, and one of `OBSERVED_ADVERTISEMENT_CHANGED`, `SOURCE_COVERAGE_INCOMPLETE`, `NO_OBSERVED_CHANGE`. Source failures never count as merchant removals; SF71 skips any provider not complete in both observations. For example, a source outage after a prior full capture retains the last full baseline rather than resetting it. Later complete observations can compare against that original full baseline. On a fresh partial-only history, the latest previous partial sample is used with SF71's original skip logic until the first fully complete baseline arrives.

Unchanged listings are not proof of a seller's current HTTP 402. Changed `payTo`, amount, network, asset or scheme in an **advertised** original payment alternative is surfaced atomically through SF71; no buyer policy approval, wallet, seller consent, actual paid request, signed retry, ledger receipt, mainnet deployment, SCF award or sale follows automatically. Per-provider captured `observedAt` values stay attached to the original snapshots.

The directory is owned by the operator, created mode 0700. A create-only `.writer.lock` rejects concurrent writers; stop the original owner and inspect any stale lock before removing it. `--verify` rereads **every** snapshot and every `history.jsonl` record, checks its SHA-256 links, original SF70 schema and native source cardinality, and rejects unexpected/orphan capture files. A crash between a durable snapshot and the journal append leaves an explicit orphan; there is no silent overwrite or fabricated continuous history. Keep that directory outside public Git repositories, and do not commit private customer configurations.

## Genuine original-source acceptance handoff

The retained Muse SF70 carrier in `#sim-data` already reported *two independently fetched, 29-row testnet observations*, with provider-success and SHA receipts. Have that original carrier run this **current original SF70/SF71 source** from a complete checkout for two genuine cycles, or against its already-running loopback SF70 operator, and return source commit SHA, Node version, `--verify` counts, provider-level timestamps/coverage, before/after summary and any actual changes to `#sim-data`. A zero-change result is a real and useful stable-catalog outcome; changed outer capture hashes alone are not evidence of changed offers.

Single local focused operator regression (filesystem mechanics + original SF71 module import, not a fake provider result):

```bash
node --test stellar/scf-starforge-20261009/sf79-native-catalog-watch/test/watch.test.mjs
```

No GitHub workflow, new provider contact, customer email, grant form or automatic task creation is required. The original SF10 founder, SF49 seller conversion and SF41/Muse network-capture owners remain the source owners.

# SF66: One-command original Stellar Bazaar operator demo

This is a usable **single entrypoint** to the already shipped SF60 durable Stellar Bazaar journal and SF61 Atlas browser, composed without copying, forking, mocking, or modifying their original implementations. Node 22+; no external dependencies, CI jobs, payment credentials, seller or buyer registration.

## Real existing operator catalog

From the original complete `public-commons-sprint-2026` checkout:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/launch.mjs \
  --directory /private/existing-catalog \
  --report /private/source-parity-20261010.json
```

The supplied directory **must already contain** the original SF60 `catalog-commits.json`. The launcher opens the original exclusive SF60 journal owner exactly once, starts its original loopback read-only service on an ephemeral port, then starts the existing canonical SF61 Atlas interface on another loopback port. It checks `/healthz`, direct original `/discovery/resources?limit=25&offset=0`, Atlas `/api/source` and `/api/discovery?view=list&limit=25&offset=0`. It fails closed if original resources, pagination, source identity or nonpayment gates differ. The operator opens the printed `atlasUrl` in the same machine's browser; Ctrl-C or SIGTERM closes Atlas first and then the original journal/service, releasing its normal lock. It does not delete an orphan lock, seize a live owner, or rewrite the journal.

For a new operator who has deliberately chosen to create an **empty** catalog:

```sh
mkdir -m 700 /private/empty-catalog
node stellar/scf-starforge-20261009/sf66-demo-launcher/launch.mjs \
  --directory /private/empty-catalog --create-empty --atlas-port 0
```

This serves **zero** seller records until the original authenticated operator ingests genuine approved source using SF60. It is not a synthetic 27-row provider corpus, and no paid endpoint is called.

For a source-parity report and immediate clean shutdown instead of a persistent browser:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/launch.mjs \
  --directory /private/existing-catalog --one-shot \
  --report /private/sf66-original-parity.json
```

`--report` is opt-in and create-only (mode `0600`), never overwrites a prior report. The JSON contains observed row count, source journal head, aggregate totals, UTC observation time, original resource/pagination SHA-256 digests, and a flag marking that **only one native page** was observed. It intentionally does not export seller rows, wallet data, source policy, or operator secrets. It is a provenance check for this actual local composition, not a paid transfer, permission, external provider validation, full corpus capture, or grant admission claim.

## First-party acceptance for the existing Muse/source owner

For an already archived original 27/27 Vellar Stellar-testnet catalog: use the existing SF41 original-byte manifest and SF60 authorized ingest/provenance procedures to build or locate its actual SF60 durable operator journal. Run the launcher **against that existing journal**, and return the command output, JSON parity report digest, native `/healthz` total and the SF41 manifest pin to `#sim-data`. Original SF41 continues to own broad live-provider pagination and replay; this adds a browser-facing source-parity result, not a second synthetic corpus or runner. Do not pass a live writer-owned directory to this separate standalone process: mount `serveDiscovery({catalog})` in that owner and start SF61 directly instead.

## Boundaries

The launcher uses only original modules imported at runtime from sibling folders. SF60 remains the exclusive lock/write owner and SF61 the canonical UI. All listeners bind to `127.0.0.1`. No arbitrary upstream URLs, remote sellers, identity claims, network transactions, signer, account registration, outreach, full SCF application or hosted GitHub Actions. Existing SF10 founder, SF60/SF61 owners and Muse source replay continue to own their workstreams. The actionable gain is a trustworthy one-command **locally operable** UI with an observed self-check useful for demos and grant reviewer walkthroughs.
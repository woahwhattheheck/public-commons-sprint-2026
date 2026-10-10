# SF66 · One-process original-source operator desk

**Actual operator product, not another discovery protocol implementation.** This launcher starts the existing [SF60 durable discovery service](../sf60-durable-catalog-transaction/SERVING.md) and [SF61 Bazaar Atlas viewer](../sf61-bazaar-explorer/README.md) from the same original public checkout. One process owns the original SF60 journal lock, boots a real HTTP backend on `127.0.0.1`, connects the original Atlas via its documented `localUpstream`, checks its actual `/healthz` and `/api/source` wire replies, and displays the genuine Atlas browser URL. No catalog, serializer, identity policy, search engine, or seller/payment client is reimplemented.

Use Node 22+ and an original current public-commons-sprint-2026 checkout. No npm install, account keys, CI, external provider request, or paid hosted runner.

## Operator launch

```bash
# Existing, populated, operator-owned SF60 durable journal; no silent empty catalog.
node stellar/scf-starforge-20261009/sf66-operator-desk/desk.mjs \
  --directory /private/my-original-sf60-journal
```

Open the printed `ui` URL locally. The HTTP backend's ephemeral port and Atlas viewer's ephemeral port are chosen by the OS, not by parallel uncoordinated processes. Both services are loopback-only. Ctrl-C or SIGTERM closes **Atlas first**, then the original durable service and its journal lock. If an existing SF60 process owns the lock, stop that original writer cleanly or mount `serveDiscovery` in its owner process; this launcher refuses to steal a lock. It never contacts a remote facilitator and makes no paid API request.

For an explicitly blank operator installation (real empty journal, no invented offers):

```bash
node stellar/scf-starforge-20261009/sf66-operator-desk/desk.mjs \
  --directory /private/new-empty-sf60 --create-empty
```

You can use `--backend-port 8787 --ui-port 8790` to pin ports, or leave both at the safer default `0` for independently assigned local ports. There is no network listener on public interfaces and no URL parameter that lets a browser choose the upstream.

## Actual journal and original-browser full-page parity capture

The following **runs actual original SF60 list GETs and actual SF61 `/api/discovery` GETs**, page-by-page on the **same journal in the same process**, and checks all resource data objects match exactly. It records original native and viewer JSON response bytes (UTF-8), their SHA-256 values, native declared pagination totals, original health/source responses, and each returned real row. No generated offers or placeholder rows are inserted. This captures the entire stable *filtered SF60 local journal*, not a claim of coverage of an unqueried external provider:

```bash
node stellar/scf-starforge-20261009/sf66-operator-desk/desk.mjs \
  --directory /private/my-original-sf60-journal \
  --network stellar:testnet \
  --limit 100 \
  --snapshot /private/evidence/sf66-original-testnet.json \
  --once
```

`--once` closes both original services and releases the writer lock after the native-wire capture. If you omit it, Atlas stays available. `--network stellar:pubnet` explicitly selects pubnet; omit network to include all original eligible records. Each page must match SF60 original bytes parsed into the SF61 original row envelope, reported totals must not change, and `/healthz` must be stable throughout. Any drift aborts capture rather than quietly calling an incomplete page a full catalog. The output is created atomically and no-clobber with private file permissions (`0600`); use a fresh filename for each observation. Retain the original output file and its SHA-256 in the run journal before comparing runs.

The JSON contains `schema: stellar-forge.sf66.original-operator-capture/v1`, actual native and viewer JSON per page, start/end health SHA-256, captured timestamp, the selected network and total observed rows. This supports later **authentic original-source** reviewer/Muse analysis without recomputing or substituting fixture data. A blank journal yields a documented genuine 0-row result, not evidence that the public Stellar ecosystem has no endpoints. SF41 and SF65 owners retain all direct independent-facilitator capture and cross-provider coverage decisions.

## Engineering acceptance

The launcher relies directly on current original exports:

- `openDiscovery({directory,port,createEmpty})` from SF60 `service.mjs`, retaining SF60 writer-lock, native `GET /healthz`, and native `GET /discovery/resources` semantics.
- `startExplorer({localUpstream,port})` from SF61 `server.mjs`, retaining original GET proxy, filter, pagination, host checks, CSP, and static UI.

No secondary journal open, bypass of seller attestation, signing, synthetic provider stub, npm dependency, test suite, or workflow file. Local use from an original checkout is the acceptance; reviewer should record original main commit, actual journal observation timestamp, snapshot file SHA and source provider/origin consent context. `node --check` may be used as a quick syntax check, not as proof that a journal actually contained merchant listings.

Known limits: this launcher neither verifies seller authority, pays for resources, creates Stellar testnet transactions, claims mainnet availability, nor submits an SCF application. An exact parity capture is the original operator's catalog truth *at capture time*, not proof of independent provider coverage, upstream seller reachability or customer traction. Broader first-party protocol and live testnet validation remain with the original SF41/SF38/SF43/Muse owners. SF10 remains the single founder-owned SCF grant carrier.

MIT.

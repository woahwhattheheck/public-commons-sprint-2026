# SF60 | Crash-atomic catalog commitments and immutable provenance

Original-source Node 22+ integration, additive to current accepted SCF Starforge code. `journal.mjs` imports the **actual** `BazaarCatalog`, `CatalogTrustBoundary` and `LifecycleCatalog`; it never substitutes another x402 parser, network or amount scheme. None of the three upstream implementations was edited.

## What is implemented

A single privileged process calls `DurableCatalogTransaction.open(privateDirectory)`, then `ingest(candidate,authenticatedAuthority,provenance)` or `retire(authorizedWithdrawal)`.

1. Reconstruct all three original upstream projections from the committed operator journal and verify its SHA-256 chain on open. Malformed/tampered records abort startup.
2. On each proposed update, re-run **all three actual original code paths** in a wholly separate staged projection. Original SF27 authority/origin/payTo/signer/sequence and hostile-metadata gates apply; original SF21 provenance, scheme, resource identity and amount checks apply. Reject cross-projection aliasing so a new seller or route cannot bind an existing logical ID under a different catalog key.
3. Persist the complete next append-only logical journal via a private temporary file, fsync, atomic rename and parent-directory fsync. Only after successful persistence swap the process's live projection. This is crash-atomic at the file replacement boundary. No two catalogs show a half-accepted update. An I/O exception after possible rename poisons the current process and forces a reopen from disk.
4. `list()` and `search()` delegate to the original read-only Bazaar interface and never expose mutable catalog objects. `history()` delegates to the original lifecycle. A retirement uses the existing lifecycle owner/seller proof and existing Bazaar `removeValidated()`. Restart deterministically rebuilds active/retired state.
5. An exclusive `wx` lock refuses a second writer on the same directory. Clean `close()` releases it. Following an unclean process termination, the operator must verify the old writer is not active before removing the orphan `.catalog-writer.lock`. Never auto-steal a lock from a possibly live writer.

## Operator use

```js
import { DurableCatalogTransaction } from './journal.mjs';
const db = await DurableCatalogTransaction.open('/PRIVATE-LOCAL-DIRECTORY');
try {
  // `authority` is authenticated by the existing trusted operator. It holds
  // exact sellerId and signer identity plus Sets of allowedOrigins,
  // allowedRecipients, allowedNetworks and allowedSchemes.
  const receipt = await db.ingest(candidate, authority, provenance);
  // `candidate`: {sellerId, sequence: positive safe integer, entry: original x402 v2 catalog row}
  // `provenance`: {authority: 'signed_export' or 'settlement_hook', sellerId,
  // sourceURL, sourceSha256, observedAt}. These claims require real original-source proof.
  console.log(receipt.decision, receipt.head);
} finally { await db.close(); }
```

For **one focused original-module acceptance** within the complete public repository checkout:

```sh
node --test stellar/scf-starforge-20261009/sf60-durable-catalog-transaction/acceptance.test.mjs
```

This covers the original native triple projection, unauthorized quote rejection without partial state, exact replay without a new commit, monotonic update, issuer withdrawal, reopen/restart and disk-tamper detection. No hosted Actions or broad suite required.

## Architectural boundaries / commercial relevance

This is **local trusted-operator storage**, not a network-facing registration endpoint, multi-node distributed consensus protocol, public user-auth system or hosted database. The writer lock is single-host advisory by filesystem existence; do not put the data directory on an untrusted shared filesystem. Journal and lock files may include business/operator metadata; keep the directory outside web roots, private, backed up and access-controlled. Transaction throughput is intentionally O(n) per write because source projections are reconstructed and journal is rewritten; use an approved durable database with equivalent semantics before large-scale deployment. The current implementation caps records and file size to resist unbounded local input.

It does not verify a signer private key or cryptographic seller consent itself. An **already authenticated** facilitator or operator must provide the authority and source bytes; `signer` means an identity string, not a seed. In the journal, sourceSha256 is a supplied fingerprint; the operator must independently hash the actual original bytes and independently validate real ledger settlement and quote-to-delivery parity. This code does not initiate payments, issue wallet signatures, make an SCF application, register public sellers, or claim buyer adoption.

The buyer value is durable, auditably consistent checkout discovery: accepted offers, corrected quotes and seller withdrawals survive a service restart without falsely advertising a retired endpoint. Existing SF21/SF27/SF46 and SF10/grant owners retain their original source, credentials, submissions and decisions. Muse can run broad original x402 corpus replay against this **actual** module after source publication; use the real Vellar 27/27 capture already retained in `#sim-data`, never replace it with a made-up provider corpus.

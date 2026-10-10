# SCF SF55 provenance gate

This is an additive, offline source inventory for the existing SCF grant and merchant QA workstreams. It does not file an application or perform a network transaction.

## Run from the repository checkout

```sh
node stellar/scf-starforge-20261009/sf55-evidence-provenance-gate/gate.mjs > report.json
node stellar/scf-starforge-20261009/sf55-evidence-provenance-gate/test/gate.test.mjs
```

Requires Node 22 or newer. No external dependencies or hosted jobs. Positional arguments to gate.mjs may override the repository root and manifest.

## Results

- `source_verified`: local source bytes match the exact pinned Git blob ID.
- `test_source_only_not_executed`: original test file matches a pin, but its execution is not asserted.
- `source_drift` or `source_unavailable`: local source is changed or cannot be inspected safely.
- `external_acceptance_not_verified_by_source_gate`: source cannot prove a real provider outcome, buyer decision, or grant status.

`source_integrity_ok` is not the same as application readiness. `submission_ready` remains false. Even a clean report never certifies that an external acceptance event occurred.

The baseline includes SF31 buyer, SF50 seller, SF52 buyer-outcome, SF54 facilitator, SF44 onramp, and an original SF54 test-file pin. External settlement, buyer-traction, interest/invitation, and funding claims remain unverified. A change on main legitimately invalidates a source pin until the owner reviews and records the new bytes.

## Handoffs

The existing technical and Muse owners retain genuine first-party provider and ledger acceptance runs. Such runs should preserve the actual network, asset, payee, amount, quote, payment authorization, settlement receipt, resource delivery and source revision. An offline test alone does not provide that evidence.

The original SCF founder team controls eligibility, track, budget, interest form, invitation and submission. SCF #46 has an invited submission deadline of November 8, 2026, with earlier rolling interest-form screening. The grant pays future deliverables, not prior sunk engineering costs.

A potential commercial pilot still requires a real consenting customer, buyer-specific scope, success criteria and independently approved terms. This tool does not represent a booked sale or authorize external outreach.

Git blob IDs are local identity checks, not author signatures, authenticated service records or a product security audit. Paths are checked for traversal and symlinks. No existing SF10 application, product, simulator or hosted workflow is modified.

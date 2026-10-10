# SF-21 trusted catalog lifecycle

This dependency-free module defines a versioned storage and migration boundary for paid HTTP and MCP resources. It consumes canonical x402 Bazaar discovery records, delegates resource identity to the shipped SF-28 implementation, preserves payment amounts as base-unit strings, and retains source provenance instead of turning an operator response into an ownership claim.

Schema `stellar-forge.catalog-lifecycle/v1` provides:

- separate HTTP and MCP identities (`resource.url + input.toolName` for MCP);
- normalized, deterministically ordered amount/asset/network/payee/scheme facts;
- mandatory source URL, SHA-256, observation time and evidence authority;
- explicit `operator_reported`, `signed_attested`, or `settlement_bound` confidence—never a stronger claim than the supplied evidence;
- monotonic corrections, exact replay soft-drop, stale/conflicting update rejection and seller continuity;
- authenticated retirements with retained public revision history;
- caller-selected `asOf` freshness classification and visible age;
- deterministic snapshots, digest verification and rejection of unknown schema migrations.

Focused check:

```sh
node --test stellar-forge/catalog-lifecycle/lifecycle.test.mjs
```

The test round-trips the repository's preserved x402 Foundation Bazaar discovery example at `tools/stellar_bazaar_interop/official_bazaar_resource.json`, keeps its Base-network payment facts exact, exercises correction/freshness/retirement, and rejects unverifiable provenance, numeric amount coercion, seller takeover, corrupt history and an unknown schema version.

This is catalog state machinery, not seller-signature, settlement, Soroban, KYC, or legal-ownership verification. SF-27 remains the enforced hostile-ingestion authority boundary. No provider call, wallet, transaction, deployment, workflow, SCF form or grant claim is made here.

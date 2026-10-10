# SF54 | Original buyer intent to governor consent contract

**Source-exact additive integration of existing first-party SF31 and SF36.** The read-only Python adapter converts the immutable approval callback intent from SF31's X402BuyerClient.call() into the strict 15-field request accepted by the original SF36 budget governor. It imports canonical(), parse_amount(), validate_request() and Denied from the live SF36 module. No settlement simulation, wallet, private key, reservation, consent issuing, merchant contact or GitHub Actions.

## Product safety boundary

The complete accepted x402 requirement, including all nested extra metadata, is hashed using SF36's actual canonicalization rather than a JS or shortened-term approximation. The adapter requires the exact current SF31 callback schema, verifies repeated top-level fields match the accepted offer, rejects quoted amounts above the spend cap, and reserves only the *actual exact offered* amount, never a larger caller limit. Governor validation also enforces HTTPS resource, network, asset, HTTP operation, body identity and timeout. Its request is NOT permission to spend. A separately privileged human/operator must compare the genuine offer, issue an explicitly authorized consent, reserve atomically in SF36, and only then allow an upstream official x402 signer. This package never does those things.

## Original-source local integration

From full repository checkout, using Node 22 and Python 3.10+ without external packages:

    node --test stellar/scf-starforge-20261009/sf54-buyer-governor-intent/test/contract.test.mjs

The focused test imports the real current SF31 buyer, issues a local HTTP 402 response via a loopback server while retaining the canonical HTTPS merchant URL in its policy intent, invokes this Python adapter that imports real SF36, then refuses approval. The signer is never reached; assertions require zero signed requests. Mutated payee, over-cap amount, absent/unknown fields must reject; a changed nested extra field must alter the complete accepted-terms fingerprint. Real payments, finality, customer acceptance and SCF award/application status are not simulated or claimed.

Read-only command for an operator-held SF31 approve-callback JSON payload (never signer output or keys):

    python3 stellar/scf-starforge-20261009/sf54-buyer-governor-intent/intent_adapter.py --actor agent-01 --service merchant-service < intent.json

This validates and serializes input, but **does not authenticate the input's provenance**: the trusted original buyer/operator must retain the actual observed 402 source and approve separately. Unsupported usage-based upto billing remains with the separate original scheme owner. MIT, like the imported source modules.

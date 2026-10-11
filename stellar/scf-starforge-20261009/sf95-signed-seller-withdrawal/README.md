# SF95 | Seller-signed catalog withdrawal

This product workflow composes with the original SF50 Ed25519 seller proof, SF73 pinned admission, and SF60 crash-atomic catalog journal. It provides seller-authorized retirement of an already-approved paid API listing without starting a payment, signing a wallet transaction, or making an SCF award claim.

Operator: prepare a current-head and current-sequence-bound request, have the independently pinned seller Ed25519 key sign it on the seller's machine, verify freshness and current catalog ownership, and execute original SF60's retirement.

Status: source integration in progress on this branch. No hosted GitHub Actions requested.

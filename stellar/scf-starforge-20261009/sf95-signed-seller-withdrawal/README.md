# SCF SF95 | Seller-signed catalog withdrawal

Node 22+, MIT, no dependencies beyond the original public sprint source. This is an operator-run SELLER withdrawal approval that composes with the original SF50/73 Ed25519 proof/admission and the original SF60 crash-atomic catalog. It is not a new payment rail, settlement protocol, key custodian, or SCF application.

## Product behavior

A genuine seller can ask the current catalog operator to remove a previously accepted paid API resource. The operator first prepares one request from an open original SF60 journal, binding the exact active catalogKey, seller ID, currently pinned Ed25519 signer, next monotonically increasing sequence, entire current journal head, canonical HTTPS provenance URL, reason, random 256-bit nonce and 30-minute expiration. Nothing is removed yet.

The authorized seller signs this precise request on their own local machine with their existing independently pinned Ed25519 signing key, which is NOT a Stellar payment/wallet secret. The operator verifies the envelope using an independently approved seller public key, never a public key supplied in an untrusted message. Altered terms, incorrect signer, expired time window, changed original journal head or old sequence reject. The original SF60 retirement revalidates current owner and signer, stages all three original projections, and commits to disk atomically. The journal stores SHA-256 of the actual signed envelope in original signed_export provenance, not a fabricated payment receipt.

Original SF60 journal.mjs is changed minimally: retirement accepts an optional expectedHead and checks it INSIDE its serialized write queue. Callers not supplying the option retain their exact former behavior. This prevents a prior signed request from being applied after a competing queued catalog mutation.

## Exact operator commands

Run from the root of the full original woahwhattheheck/public-commons-sprint-2026 checkout. Paths are examples. Do not put approved private keys, private merchant catalogs or requests in public GitHub or Slack.

Operator prepares a request:

    node stellar/scf-starforge-20261009/sf95-signed-seller-withdrawal/cli.mjs prepare --dir /private/current-sf60-catalog --seller APPROVED_SELLER_ID --catalog-key ACTUAL_ACTIVE_CATALOG_KEY --source-url https://approved-seller.example/retirements --reason seller-requested-retirement --out /private/seller-request.json

The request is unsigned. Transfer it to the authorized seller. On the seller machine only:

    node stellar/scf-starforge-20261009/sf95-signed-seller-withdrawal/cli.mjs sign --request /private/seller-request.json --private-key /private/approved-seller-ed25519.pem --out /private/seller-approved-envelope.json

Return the signed envelope to the operator. Use the SAME independently pinned public Ed25519 seller identity from original SF73 admission, not an unapproved rotated key. Verify without side effects:

    node stellar/scf-starforge-20261009/sf95-signed-seller-withdrawal/cli.mjs verify --envelope /private/seller-approved-envelope.json --pin /private/approved-seller-public.pem

After operator authorizes the exact removal, execute:

    node stellar/scf-starforge-20261009/sf95-signed-seller-withdrawal/cli.mjs apply --dir /private/current-sf60-catalog --envelope /private/seller-approved-envelope.json --pin /private/approved-seller-public.pem

The operator needs sole access to original SF60 journal writer (original lock semantics remain). CLI-created JSON is exclusive-create mode 0600. A consumed, expired, differently pinned or old-head request does not silently reapply.

## Trust and evidence

Source files: proof.mjs (Ed25519 canonical request signing and independently pinned verification), withdrawal.mjs (current native journal preparation and original retirement), cli.mjs (seller/operator workflow). The exact original SF60 journal is reused; its optional head lease extension is backward-compatible. A valid approval shows control of the known signing key and removal of a current catalog listing, not legal identity, Stellar payTo wallet ownership, a live customer HTTP response, paid settlement, completed delivery, or a funded SCF award.

Node22 cloud isolated focused cryptographic checks covered valid signing, tampered reason, expired approval and wrong independent public key. The independent full-source seller admit/retire/restart execution remains for the existing original-source Muse or native integration operator before a real merchant demonstration. No hosted Actions, customer payments or buyer emails are required.

# Finalize original Stellar buyer reservations

The existing SF62 approval now retains the complete 15-field approved request.
SF81 carries it with the native buyer result; SF82 saves it in the original
private reconciliation record. The worker in this directory compares that
request with the authenticated SF36 ledger, fetches the original transaction
through SF86, and finalizes the same reservation. It never signs, submits,
retries a purchase, or releases a pending reservation after a timeout.

## Run from the existing operator host

Use the same maintained checkout, Python 3.10+, Node 22+, and actual
`@stellar/stellar-sdk` installation as the original SF43/SF86 product. Configure
the existing `SF36_CONSENT_KEY_B64`, `SF36_AUDIT_KEY_B64`, and
`SF36_OPERATOR_KEY_B64` through the operator's protected service environment.
No keys are passed to the Node observer, written into reports, or printed.
The constructor currently requires all three original keys; do not give this
operator command or its environment to an untrusted buyer or MCP caller.

Point at an **existing** private SF36 ledger and a private original SF82 evidence
file written by `executeWithEvidence()` or an original SF81 reconciliation
record exported on that same trusted buyer host. Use the actual payer from
the trusted signer configuration, independently of the seller's receipt.
Create a separate private reports directory before starting the worker.

```sh
python3 stellar/scf-starforge-20261009/sf36-spend-governor/finalize.py \
  --record /private/operator/evidence/ORIGINAL_INTENT_SHA256.json \
  --ledger /private/operator/reservations.sqlite \
  --policy /private/operator/policy.json \
  --payer ACTUAL_SIGNER_STELLAR_ACCOUNT \
  --reports /private/operator/finalization-reports
```

For the existing SF88 inbox/evidence directory, replace `--record` with
`--records-dir /private/operator/evidence`. One invocation processes every
original JSON capture once. `--watch-seconds 60` keeps observing unresolved
operations; SIGINT/SIGTERM stops after the current operation. The interval
has a 30-second minimum. The existing ledger is the progress record: a restart
reuses an authenticated finalization without issuing a new attestation or
fetching the same confirmed transaction again. Other buyer/reservation
processes may continue using the original SQLite WAL file.

The ledger, evidence and outbox files must be private (`0600`) and owned by
the operator. Evidence/report/outbox directories must be private (`0700`),
paths absolute and normalized, and parents protected against shared writes.
The worker refuses to create a missing ledger. Reports are atomically replaced
and fsynced; they are outputs, never inputs to finality authority. Keep them
private because original request IDs and merchant order references may appear.

## Exact accounting transition

1. Validate the preserved complete request and recompute its original Python
   canonical digest. Compare both with the SF62 digest and HMAC-audited SF36
   reservation. An old abbreviated record still works with the read-only
   SF82/SF86 tools, but cannot be used by this worker. Recover its exact original
   approved request from the trusted operator capture; never reconstruct one
   from guessed fields or reexecute a paid request to obtain it.
2. Compare the native amount, network, asset and recipient with that original
   request, then require the independently configured payer. The actual SF86
   observer uses the official Stellar testnet RPC and original SDK XDR decoder.
   Production has no endpoint, fetch, decoder or saved-verdict override.
3. Require successful inclusion and exactly one native transfer for that
   transaction, payer, recipient, asset and exact amount. Reaudit the original
   reservation after RPC, and call original `Governor.reconcile()` inside its
   existing immediate SQLite transaction.
4. The receipt key is `stellar:testnet/` plus the lowercase transaction hash.
   This preserves original cross-request receipt reuse protection. The proof
   digest covers immutable verified transaction/ledger/event/transfer facts and
   the complete request digest; advancing RPC pages cannot create a different
   accounting identity. A competing conflicting finalization is rejected by
   the original governor. Reports retained before and after restart may differ
   in observation detail, while the authoritative ledger result stays the same.

This version follows SF86's **exact testnet** support. Mainnet and `upto`
continue through their original operator paths; neither is silently treated as
testnet or exact. The Stellar event proves a transfer, while the protected
original buyer-host capture supplies its association with the HTTP request.
The chain does not encode the HTTP URL, method or request-body digest. These
trust boundaries are explicit: source files or keys controlled by an attacker
cannot provide a trustworthy operation association. Whole-database rollback
still requires the original independently retained checkpoint/witness.

## Merchant operation after payment

On a host that has the actual merchant's original SF98 outbox, add its private
directory and independently selected original seller route:

```sh
  --outbox /private/merchant/sf98-outbox --merchant-route ORIGINAL_ROUTE_ID
```

The worker opens the original outbox read path and joins the transaction
fingerprint, canonical event ID, route, method, network, asset digest and amount.
It reports the original event and callback state alongside financial accounting.
A callback accepted by the merchant inbox does not establish that the customer
received the product. `NATIVE_EVENT_RECOVERY_REQUIRED` means the existing native
receipt/order source must recover the missing merchant notice; the worker never
fabricates `ORIGINAL_NATIVE_PROCESS_SETTLEMENT_SUCCESS` from chain data.
`MERCHANT_TERMS_MISMATCH` or multiple matching events identifies the concrete
merchant state to reconcile. Repair the original receiver and use the original
SF98 requeue/drain flow for an exhausted callback. Financial finalization is
retained if merchant reporting or output writing fails; rerunning reads the same
ledger and rebuilds the report without making another purchase.

## Verification performed

The existing `focused_check.py` now includes one original durable finalization
lifecycle: mutated full-request/digest refusal before observation, changed
payee refusal, local replay refusal, successful accounting, and exact restart
reuse of one original reserve/finalize pair. Its transport fixture exercises
accounting behavior and does not claim a network payment. Production always
uses the actual original SF86 observer and official decoder. No hosted workflow
or broader repository test run is introduced.

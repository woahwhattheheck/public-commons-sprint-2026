# SF82 — original SCF buyer approval → Stellar transfer evidence

**MIT · Node 22+ · trusted local operator host · no new payment controller or dependencies.**

The October 11 merged SF81 `OperatorApprovedBuyer` can make exactly one original
operator-approved x402 HTTP retry and retain SF36's durable reservation. SF43
independently checks an actual Stellar testnet transaction and canonical SEP-41
transfer event. SF52 preserves the difference between seller-reported settlement,
verified transfer and observed HTTP payload. SF82 **composes those three existing
pieces in one operator call**, without copying their implementations or altering
approval, ledger, signing, settlement, or merchant service code.

## Use the ORIGINAL existing operator objects

```js
import { OperatorApprovedBuyer } from '../sf81-buyer-operator-bridge/bridge.mjs';
import { executeWithEvidence } from './evidence.mjs';
import { createOfficialEventDecoder } from '../sf43-agent-commerce/verify.mjs';

// Existing, already provisioned original SF36 ledger/keys/policy/terminal.
const buyer = new OperatorApprovedBuyer({operator:originalTrustedOperatorConfig});
// Existing original @x402/stellar scheme signer supplies `call.sign`.
const call = {intentId:existingStableOperationId,url,method,body,expect,sign,signal};
// Pre-create this LOCAL private directory, owned by the trusted operator:
// mkdir -m 700 /private/stellar-evidence
const {result,error,evidencePath,report} = await executeWithEvidence({
  buyer,call,outputDir:'/private/stellar-evidence',
  trustedPayer:actualPayerFromTrustedSignerOrOperator,
  decodeContractEvent:await createOfficialEventDecoder(),
  captureBody:true, // explicit opt-in, at most 1 MiB of body read for SHA-256 only
  bodyCaptureTimeoutMs:15000, // optional body capture only; original SF43 keeps its RPC limits
});
if (error) {
  // Existing original ledger must reconcile unknown signed outcomes.
  // Never retry with a new intent ID merely because a response was lost.
  throw error;
}
```

The adapter calls `buyer.call(call)` **exactly once**. The original SF81/SF36
policy and signer remain the sole authorities for consent and spending. No
automated approval or new application gate is introduced. The trusted payer is
supplied from the actual authorized signer/operator, not from a seller receipt.
Evidence metadata is checked before that call: this adapter accepts the original
SF52 limit of 1–128 intent-ID characters (`A–Z`, `a–z`, digits, `.`, `_`, `:`, `-`).
SF81's broader identity contract is unchanged. An explicit `observedAt` must be
the canonical ISO timestamp accepted by SF52, such as `2026-10-11T12:00:00.000Z`.
Invalid metadata therefore cannot fail for the first time after signing.
If no decoder is explicitly supplied it attempts the original
`createOfficialEventDecoder()`; if the installed Stellar SDK is not present,
SF43 can still establish transaction inclusion, **never** a token transfer
match. SF43 RPC's own endpoint restriction applies: official Stellar testnet
or a loopback address used for an explicit local verification exercise.

`executeWithEvidence()` returns the original `result` or `error`, the actual
`evidencePath`, and original SF52 `report`. Errors do not become successful
purchases. A reported seller receipt alone does not count as a verified
transfer. Read-only independent verification uses the actual transaction hash,
original accepted asset/amount/payee and trusted payer, then the native SF43
RPC transaction+SEP-41 event check. SF52 computes the outcome, so a successful
seller response cannot be silently converted to confirmed on-chain payment.

## Durable private operation record

The operator selects an existing private absolute output directory. For each
stable `intentId`, create-only mode `0600` file `SHA256(intentId).json` records:
original SF52 sanitized observation, independently verified chain evidence if
available, optional bounded HTTP body SHA-256 (never raw response), a **small
allowlisted** SF81 reservation reference, and exact SF52 summary. It does NOT
store a wallet, signature, original HTTP response, operator transcript, private
keys, payment envelope, raw source payload, customer body, or error cause.

Existing terminal evidence rejects another invocation of the same operation
*before* `buyer.call()`. Concurrent first calls on separate processes rely on
SF81's original SF36 shared ledger; this file is **not** a substitute for the
ledger's exclusive reservation. `wx` prohibits overwrites and already-recorded
operations. A crash after a signed send but before this artifact exists cannot
be interpreted as safe to retry: recover SF36 and original chain history. An
existing partial file is also never overwritten. No cleanup automatically
releases reserved capacity.

### Reconcile the saved operation later

New evidence files also contain `reconciliation`. When the actual returned buyer
result satisfies the existing `sf81ReconciliationRecord()` helper, its status is
`AVAILABLE` and `record` retains that helper's original approved reservation,
accepted terms and seller receipt. This snapshot is taken before the independent
RPC lookup. It adds no HTTP body, signed payment header, wallet key or operator
transcript. `AVAILABLE` means the original record was saved; it does not mean
that SF86 has verified the payer, transaction or transfer.

Use the existing [SF86 CLI](../sf86-rpc-transfer-reconcile/README.md) to retry only
the read-only reconciliation, supplying the actual payer independently:

```sh
node stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/cli.mjs \
  --sf82-evidence /private/stellar-evidence/ORIGINAL_INTENT_SHA256.json \
  --payer YOUR_ACTUAL_TRUSTED_G_ADDRESS
```

SF86 consumes the saved original record and retains its existing checks and
testnet-only scope. It does not repeat the purchase, overwrite this evidence file
or change the SF36 reservation. Keep the original operation and this later result
together when completing the existing ledger reconciliation.

Free requests, thrown buyer errors and results missing the required original
receipt/reservation save `reconciliation.status:UNAVAILABLE`. Older files lack
this field. Neither can be reconstructed from the smaller observation and
reservation summary: SF86 reports `SF82_ORIGINAL_RECONCILIATION_RECORD_UNAVAILABLE`
before loading the decoder or calling RPC. Use an independently retained original
SF81 record through SF86's existing `--sf81-result` option if one actually exists;
an unavailable record is not permission to purchase again.

For `captureBody:true` the adapter reads a cloned **successful paid HTTP** body
through an 8-MiB maximum bound (default 1 MiB), computes only SHA-256, and
uses `bodyCaptureTimeoutMs` (default 15,000; integer 1–60,000 milliseconds) to
bound the complete optional body read. The persisted `bodyCapture` field records
the actual result, including `BODY_CAPTURE_TIMED_OUT`, `BODY_OVER_LIMIT`, or
`BODY_READ_FAILED`. An incomplete capture adds no delivery proof and returns the
same original buyer result/error. Reader cancellation is best-effort and never
awaited; late read rejection cannot replace the outcome. The caller's original
response body remains available. This deadline does not change SF43 RPC limits.
A free response or an error cannot be upgraded to paid delivery proof. HTTP
body observation also cannot prove a buyer received or accepted useful output.

## One focused native-source integration check

From the complete original checkout, on Node 22+:

```sh
node stellar/scf-starforge-20261009/sf82-checkout-evidence/acceptance.mjs
node --test stellar/scf-starforge-20261009/sf82-checkout-evidence/lifecycle.test.mjs
```

The check imports the **real original SF43 RPC verifier and SF52 reducer**,
uses a Node loopback JSON-RPC wire fixture and a fake buyer result (not a wallet
or network payment) to test transfer-event binding, bounded body hashing,
create-only duplicate behavior, signed unknown response, free response and
secret omission. It does **not** claim actual chain inclusion or paid commerce.
The lifecycle regression checks metadata rejection before the buyer, a real
open response stream reaching the body deadline, late read/cancel failures,
preserved original error identity and readable caller bodies. It makes no RPC
or payment calls.
The real production signer/finality acceptance belongs to the existing SF81 /
SF43/SF49 operator's authenticated Stellar testnet run, with source evidence
saved by this adapter. No GitHub Actions workflow, test framework, new account,
external contact or new scheduled automation is needed.

## SCF founder and merchant use

The existing SF10 original founder can cite this as *integration-ready code*.
Only an actual authorized operator run with real SF43 RPC and real network
events can produce a genuine proof. SF49 can attach the resulting real evidence
to an accepted, consented merchant diagnostic or paid pilot. Code delivery does
not constitute customer revenue, an approved budget, grant eligibility, a
submitted interest form or a signed merchant agreement.

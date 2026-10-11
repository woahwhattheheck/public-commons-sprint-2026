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

For `captureBody:true` the adapter reads a cloned **successful paid HTTP** body
through an 8-MiB maximum bound (default 1 MiB), computes only SHA-256, and
marks evidence as unavailable if the bounded capture could not complete. A
free response or an error cannot be upgraded to paid delivery proof. HTTP
body observation also cannot prove a buyer received or accepted useful output.

## One focused native-source integration check

From the complete original checkout, on Node 22+:

```sh
node stellar/scf-starforge-20261009/sf82-checkout-evidence/acceptance.mjs
```

The check imports the **real original SF43 RPC verifier and SF52 reducer**,
uses a Node loopback JSON-RPC wire fixture and a fake buyer result (not a wallet
or network payment) to test transfer-event binding, bounded body hashing,
create-only duplicate behavior, signed unknown response, free response and
secret omission. It does **not** claim actual chain inclusion or paid commerce.
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
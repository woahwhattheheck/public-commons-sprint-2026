# SF54: Original-source Bazaar extension settlement sidechannel

The [x402 Foundation Bazaar spec](https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md#verify-and-settlement-response-sidechannel)
requires a facilitator-to-resource-server HTTP EXTENSION-RESPONSES header.
It is base64(JSON) keyed by extension, with bazaar.status equal to success,
processing or rejected, and rejectedReason when rejected. It is NOT the
resource-server-to-buyer PAYMENT-RESPONSE wire.

This adapter invokes the EXISTING original SF25 PaymentAutoCatalog code,
which itself uses SF46 atomic integration, SF27 seller trust and SF21
lifecycle. It does not duplicate their index or implement its own settlement.
Accepted catalogs and exact previously cataloged replays report success.
Malformed schema, mismatched settlement facts and rejected catalog operations
report rejected with a bounded machine-readable reason. An absent Bazaar
extension contributes no Bazaar key. Other trusted extension outcomes are
preserved without letting callers preempt the Bazaar decision.

## Use (in the public repository checkout, Node 22+)

~~~js
import { BazaarSettlementSidechannel } from
  './stellar/scf-starforge-20261009/sf54-cataloging-sidechannel/sidechannel.mjs';
const adapter = new BazaarSettlementSidechannel();
// ONLY in a facilitator-controlled, independently authenticated settlement hook:
const result = adapter.processSettled({
  paymentPayload: canonicalVerifiedPayload,
  settlement: trustedFinalSettlement,
  sequence: monotonicSellerSequence,
  otherExtensionResponses: otherTrustedExtensionOutcomes,
});
if (result.headerValue) {
  facilitatorResponse.setHeader(result.headerName, result.headerValue);
}
~~~

The EXTENSION-RESPONSES sidechannel goes only to the *resource server*.
**Never forward it to the buyer** or expose processSettled as an HTTP handler
accepting user-supplied settlement claims.

One source-integrated original Node check (no CI or network calls):

~~~sh
node --test stellar/scf-starforge-20261009/sf54-cataloging-sidechannel/test/sidechannel.test.mjs
~~~

Limits: The caller, not this adapter, must run the canonical @x402/stellar
verification and actual chain settlement and produce authenticated immutable
settlement authority facts. Fixtures do not establish network transactions,
production uptime, fees, real users, SCF eligibility, grants or revenue.
Current RFP and round applicability remain founder-held. MIT; no secrets,
wallet, outbound requests, GitHub Actions workflow or external registration.

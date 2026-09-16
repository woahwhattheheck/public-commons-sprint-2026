# Bazantic integration contract

## Recipe purpose

The recipe asks an agent to use a retained Graph-derived purchase decision before entering an x402/Hedera report acquisition path, then consume only a report proven to belong to the retained settlement response.

## Required host adapters

A production host must provide:

- a trusted clock;
- a content-addressed Lane B receipt store plus execution/source evidence;
- a Lane A verifier that independently reads the payment/settlement provider result;
- a report store that retains the exact response bytes and service-response digest;
- provider-specific release readbacks for GitHub, deployment, Bazantic, Graph, Hedera, A/B captures, and video.

The host must not derive expected digests from the same request body it is evaluating.

## Runtime assembly

```js
const laneB = await laneBStore.readByTrustedRunId(runId);
const authoritySpec = {
  evaluatedAt: clock.nowIso(),
  laneB: {
    expectedReceiptDigest: laneB.receipt.receiptDigest,
    sourceHead: laneB.verifiedSourceHead,
    executionEvidenceDigest: laneB.executionEvidenceDigest,
  },
};

const input = { laneBReceipt: laneB.receipt };

if (laneAReadback) {
  input.laneAReceipt = laneAReadback.receipt;
  authoritySpec.laneA = {
    expectedReceiptDigest: laneAReadback.receipt.receiptDigest,
    sourceHead: laneAReadback.verifiedSourceHead,
    executionEvidenceDigest: laneAReadback.executionEvidenceDigest,
  };
}

if (reportReadback) {
  input.report = reportReadback.payload;
  authoritySpec.report = {
    expectedPayloadDigest: reportReadback.payload.payloadDigest,
    expectedServiceResponseDigest: reportReadback.serviceResponseDigest,
    sourceHead: reportReadback.verifiedSourceHead,
    executionEvidenceDigest: reportReadback.executionEvidenceDigest,
  };
}

const authority = createRecipeAuthority(authoritySpec);
return evaluateRecipeFlow(input, authority);
```

## Forbidden integration patterns

- Accepting `graphPolicy` or `now` in the public request body.
- Computing an “expected” receipt digest from the same caller-authored receipt and treating equality as provenance.
- Calling `createRecipeAuthority()` inside generic request deserialization.
- Treating `upstreamVerified: true`, a transaction string, or digest-shaped text as provider verification.
- Treating `PAYMENT_REQUIRED` with any status other than exact HTTP `402`.
- Using a report whose recomputed payload digest or service-response digest differs from the Lane A binding.
- Passing a second JSON object to the release reducer to mint readiness.

## Bazantic account boundary

Recipe creation, account acceptance, credential entry, external deployment, competition enrollment, and submission remain human/provider actions. This repository contains source contracts and evidence reducers only.

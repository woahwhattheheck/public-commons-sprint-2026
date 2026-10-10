# SF52 — independent Stellar buyer checkout outcomes

MIT. Node 22 standard library. Source-contract adapter for real, current accepted public modules:

- `../sf31-buyer-client/buyer.mjs`, `X402BuyerClient.call()` / `BuyerError` (Git blob `bdba522124f42eec39cda1176a36ddf8cd5e6004`).
- `../sf43-agent-commerce/verify.mjs`, `checkStellarTestnetTransaction()` (Git blob `03fc89a93052ab81882ad11ad609f4abe87271d5`).

This module **does not implement a second protocol, facilitator, simulated payment network or wallet**. It consumes ordinary results already emitted by those modules and joins evidence. No provider call, payment, signing, onchain transaction, grant action or hosted GitHub Actions job occurs.

## API usage with the original sources

```js
import { X402BuyerClient } from '../sf31-buyer-client/buyer.mjs';
import { checkStellarTestnetTransaction } from '../sf43-agent-commerce/verify.mjs';
import { captureBuyerResult, captureBuyerError, aggregateOutcomes } from './outcomes.mjs';

const client = new X402BuyerClient();
const intentId = crypto.randomUUID();
let captured;
try {
  // Approved caller supplies actual url, explicit terms, original sign and approve handlers.
  const buyer = await client.call({ intentId, url, expect, approve, sign });
  captured = captureBuyerResult(buyer);
  // ONLY for authorized genuine Stellar testnet receipts, not network placeholders:
  // const chain = await checkStellarTestnetTransaction({ receipt: buyer.receipt,
  //   expected: { ...buyer.requirement, payer: actualPayer }, decodeContractEvent: actualSdkDecoder });
  // captured = { ...captured, chain };
} catch (error) {
  captured = captureBuyerError({intentId,error});
}
const report = aggregateOutcomes([captured]);
```

**Do not call `checkStellarTestnetTransaction` unless there is an actual permitted testnet receipt and a canonical SDK event decoder.** A recorded seller `PAYMENT-RESPONSE.success=true` means *reported*, not transfer-verified. `TOKEN_TRANSFER_MATCHED_TESTNET` plus matching network, transaction, contract, recipient, exact atomic amount, ledger and `RPC_TX_AND_SEP41_TRANSFER_EVENT_MATCH` earns transfer verification. A separately observed 2xx HTTP body SHA-256 adds an observed-delivery category, but not customer satisfaction.

## Operator CLI

Save a JSON array of `captureBuyerResult()` or `captureBuyerError()` observations (optionally enriched with genuine `chain` and `delivery` evidence). Do not serialize a Response, payment header, wallet, signer, request body or error cause. Then from the repository root:

```bash
node stellar/scf-starforge-20261009/sf52-buyer-outcomes/outcomes.mjs --input /path/to/observations.json > /path/to/report.json
node --test stellar/scf-starforge-20261009/sf52-buyer-outcomes/test/outcomes.test.mjs
```

The zero-network reducer has bounded 8 MiB input, ≤100,000 records, a *single terminal observation per `intentId`*, exact BigInt addition, and separate counts of attempted signed requests, seller-reported success, confirmed testnet asset transfers and observed HTTP payloads. Duplicate intent IDs are **rejected**, preventing a single purchase from being counted twice. Aggregated amounts remain **asset-denominated atomic testnet token units**, never USD, paid contracts, revenue or cash. The adapter redacts raw `Response`/headers and `BuyerError.cause` by design.

Source-accurate focused Node22 reducer proof: four targeted tests — seller-only, independent SF43 match and HTTP delivery, hostile cross-term mismatch, pending/error/duplicate. This verifies the reducer, **not** an original provider integration or an SCF-funded milestone. For proper product claims, consume already-authorized original SF41/Muse public-corpus, current canonical SDK version and actual Stellar testnet ledger data.

## Revenue/application use

SF49 commercial diagnostics can use the *separate* `sellerReportedSuccess`, `verifiedTransfers`, `transferAndBodyObserved`, `proofConflicts` and `uncertainOrPending` fields to locate what actually breaks after a discovered offer. A scoped diagnostic could report *which expected checkout step failed and why* for an opted-in seller without handling their keys or charging anyone. SCF SF10 may use genuine authorized findings with operator consent and exact provenance, but **neither a grant submission nor a pilot buyer has been obtained by this module**. Existing SF31/SF33/SF43/SF46/SF49/SF51 owners retain all existing source and buyer relationships.
# SF87 | OpenZeppelin smart-account x402 policy compatibility

**An operator-ready bridge from the actual Stellar SDK simulation to a deterministic, local interoperability decision.** This consumes the real DiagnosticEvent XDR emitted by the official Soroban simulator. It does not create a second settlement engine or modify the original SF43 verifier. It is intentionally usable before running a wallet or taking fees.

## Why this exists

Original upstream [x402-foundation/x402 issue #3764](https://github.com/x402-foundation/x402/issues/3764), filed October 10, 2026, reports that an OpenZeppelin smart account with a spending-limit policy invokes USDC transfer and successfully simulates the following events, in order:

1. The non-asset policy contract emits spending_limit_enforced, with its smart-account address as a topic.
2. The expected USDC asset contract emits one transfer from the smart account to the seller for the exact authorized atomic amount.

The reference Stellar exact facilitator's validateSimulationEvents currently rejects every contract event unless its first symbol is transfer and its contract is the quoted asset. Consequently the legitimate policy event produces invalid_exact_stellar_payload_event_not_transfer. Independently, the smart-account policy/auth path consumes ~290,000 stroops while the upstream default transaction-fee ceiling is 50,000 stroops. Relaxing event parsing alone does not resolve the fee ceiling. The original report provides an actual testnet settlement and a source reproducer. Those facts belong to the upstream reporter, not to a TJLabs transaction.

## What this delivers

compat.mjs exports decodeOriginalXdrEvents, assessDecodedEvents and reviewCaptureFile, and runs directly as a Node 22 CLI. It decodes official SDK DiagnosticEvent XDR, permits a spending-limit event only from a specifically approved policy contract for the same smart account, and requires exactly one original asset transfer with exact payer, recipient and signed i128 amount. It rejects every other unexpected contract event, side financial events from other contracts, second asset transfers, wrong contracts, wrong payee, changed amount, duplicate policy and unrelated policy-account events. Legacy scalar and modern SEP-41 map amount encodings are understood.

Fee calculation uses integer stroops, original simulation minResourceFee plus the operator's explicit inclusionFeeStroops. It never widens the ceiling itself. When events pass with a policy, the status is EVENT_COMPATIBLE_UPSTREAM_PATCH_REQUIRED, **not** a paid/settled success. The reference facilitator must separately accept those events, check signed auth, and settle with independent ledger evidence. When fee exceeds the explicit approved maximum, status remains BLOCKED. Capture SHA-256 binds the report to the exact original local input bytes.

The output is human-readable terminal JSON, or exclusive-create policy-review.json and policy-review.md in an operator-chosen directory (file mode 0600). All code is local and secretless. No API, RPC, HTTP, wallet, signing, payment, grant submission or outbound contact occurs.

## Run against the real original simulation

On an authorized operator machine where the ORIGINAL upstream SDK and x402 transaction are already available:

~~~js
import { writeFile } from "node:fs/promises";
// Import from existing installed official @stellar/stellar-sdk + x402 runtime.
// sim must be the actual successful return of rpc.simulateTransaction(originalTx).
const capture = {
  source: { label: "original native Stellar testnet simulator" },
  expected: {
    network: "stellar:testnet",
    asset: ORIGINAL_USDC_CONTRACT_ID,
    payer: ORIGINAL_OZ_SMART_ACCOUNT_ADDRESS,
    payTo: ORIGINAL_SELLER_ADDRESS,
    amount: ORIGINAL_QUOTED_ATOMIC_AMOUNT,
    approvedPolicyContracts: [ORIGINAL_INSTALLED_SPENDING_LIMIT_POLICY_CONTRACT]
  },
  simulation: {
    events: sim.events.map(event => event.toXDR("base64")),
    minResourceFee: String(sim.minResourceFee)
  },
  fee: {
    inclusionFeeStroops: "100",
    operatorMaxTransactionFeeStroops: ORIGINAL_APPROVED_MAX_FEE_STROOPS
  }
};
await writeFile("original-simulation.json", JSON.stringify(capture, null, 2),
  { flag: "wx", mode: 0o600 });
~~~

Run with Node 22 or later after installing the original @stellar/stellar-sdk in the operator workspace:

~~~sh
node stellar/scf-starforge-20261009/sf87-oz-policy-compat/compat.mjs \
  original-simulation.json --out-dir ./original-oz-policy-review
~~~

The output directory must not contain existing report files. CLI returns exit code 1 for blocked event or fee conditions, 2 for unreadable/malformed capture, 0 for an event-shape assessment that is not itself settlement approval. The imported assessDecodedEvents is also available to a native existing simulator host that has already decoded authentic events via the SDK.

## Exact integration boundary

Keep the original SF43 native testnet seller/buyer and its independent transaction/SEP-41 check. Use this preflight after successful original simulateTransaction and before committing to the upstream facilitator. If it reports EVENT_COMPATIBLE_UPSTREAM_PATCH_REQUIRED, the merchant owner needs the upstream validator corrected to admit only approved policy events while retaining transfer safety, plus a separately approved fee ceiling that covers the measured fee; *do not retry a failing purchase just because this local tool recognizes the policy event*. Once the upstream fix is actually installed and a signed transaction settles, the original SF43/SF82 check remains the separate onchain acceptance route.

SCF founder positioning: this is a practical compatibility capability for policy-governed agent wallets, not evidence that the grant was awarded, that a smart account already purchased a TJLabs service, or that the upstream facilitator is fixed. It complements existing SF36 spend governance, SF43 signed native checkout, SF81/82 onchain reconciliation and SF84/85 merchant rails; it replaces none of them.

Original sources: [x402 upstream report](https://github.com/x402-foundation/x402/issues/3764), [actual upstream event validator](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/stellar/src/exact/facilitator/scheme.ts), [OpenZeppelin spending-limit policy](https://github.com/OpenZeppelin/stellar-contracts/blob/main/packages/accounts/src/policies/spending_limit.rs), [original SF43 native integration](../sf43-agent-commerce/README.md).

## Focused no-wallet contract check

Use this one source-native, local check for the critical distinct behavior. It deliberately supplies decoded first-party *issue-shaped* values, **not** a claimed native XDR capture or simulated transfer receipt. The native XDR path requires the existing original operator SDK.

~~~sh
node --input-type=module -e '
import {assessDecodedEvents} from "./stellar/scf-starforge-20261009/sf87-oz-policy-compat/compat.mjs";
const p="C"+"P".repeat(55),asset="C"+"A".repeat(55),buyer="C"+"B".repeat(55),seller="G"+"S".repeat(55);
const capture={source:{label:"local semantic control"},expected:{network:"stellar:testnet",asset,payer:buyer,payTo:seller,amount:"10000000",approvedPolicyContracts:[p]},simulation:{events:[1,2],minResourceFee:"290000"},fee:{inclusionFeeStroops:"100",operatorMaxTransactionFeeStroops:"300000"}};
const policy={type:"contract",contractId:p,name:"spending_limit_enforced",topics:[buyer],amount:null};
const transfer={type:"contract",contractId:asset,name:"transfer",topics:[buyer,seller],amount:"10000000"};
const good=assessDecodedEvents([policy,transfer],capture);
if(good.status!=="EVENT_COMPATIBLE_UPSTREAM_PATCH_REQUIRED") throw Error(JSON.stringify(good));
const side=assessDecodedEvents([{...policy,name:"transfer"},transfer],capture);
if(side.reason!=="SIDE_FINANCIAL_EVENT") throw Error("failed side-effect rejection");
const fee=assessDecodedEvents([policy,transfer],{...capture,fee:{...capture.fee,operatorMaxTransactionFeeStroops:"50000"}});
if(fee.reason!=="SIMULATED_FEE_EXCEEDS_OPERATOR_CAP") throw Error("failed fee gate");
console.log("SF87 source semantic control: compatible policy, side-effect rejection, exact fee gate PASS");
'
~~~

# SF82: reconcile original SF81 x402 payment with Stellar transfer events

Production operator-side, read-only integration. This **does not** sign, send, retry, reserve, release, or settle payments. It consumes the *existing* SF81 buyer result, the independently known buyer wallet public address, and native Stellar CLI transaction-result and Soroban contract events. No new dependency, wallet, backend or CI.

SF31 deliberately treats a seller's HTTP PAYMENT-RESPONSE as **reported**, not onchain finality. SF82 verifies that the **seller-reported transaction hash** has a successful native transaction result **and exactly one** matching asset transfer from the trusted buyer payer to the original approved payTo for the exact atomic amount. It compares the original SF81 reservation intent/network/asset/amount and the original accepted SF31 requirement. Inconsistent and unknown states fail without touching the SF36 ledger.

## Existing operator workflow

In the existing trusted Node host, following an actual original operator-authorized SF81 call:

    import { writeFile } from 'node:fs/promises';
    import { sf81ReconciliationRecord } from '../sf82-chain-transfer-reconcile/record.mjs';
    const paidResult = await buyer.call(existingOriginalAuthorizedCall);
    const record = sf81ReconciliationRecord(paidResult);
    await writeFile('/private/operator/sf81-payment-record.json',
      JSON.stringify(record), { flag: 'wx', mode: 0o600 });

The helper strips the streaming HTTP Response; private keys, cookies and raw signatures never enter the exported record. It requires the original SF62 approved reservation and a canonical receipt with a transaction hash. The **trusted payer** comes separately from the original wallet owner, not a seller's claimed payer field.

On the same trusted host with Stellar CLI configured for the actual network:

    python3 stellar/scf-starforge-20261009/sf82-chain-transfer-reconcile/reconcile.py \
      --sf81-result /private/operator/sf81-payment-record.json \
      --payer YOUR_EXISTING_TRUSTED_G_ADDRESS

This performs two read-only calls:

    stellar tx fetch result --hash HASH --network testnet --output json
    stellar tx fetch events --hash HASH --network testnet --output json

For stellar:pubnet it uses the CLI network name public. No shell commands are constructed from seller input. It requires a transaction success code and a native contract event with contract_id matching the **checksummed C... SEP-41 asset**, transfer topics matching trusted payer and accepted payTo, and a signed i128 amount exactly equal to the accepted atomic amount. Unsupported native shapes, nonzero CLI exit, multiple matching events, mismatched terms or no matching event produce exit code 2 and NOT_RECONCILED. Outputs contain only public transaction identifiers, original terms and response digests, never signed payment material.

For original previously captured native CLI JSON, use both --saved-result ORIGINAL_RESULT.json and --saved-events ORIGINAL_EVENTS.json. This mode emits SAVED_CLI_RECORD_MATCHED, distinct from live CHAIN_TRANSFER_MATCHED. A locally constructed JSON shape or undocumented source is not a live network acceptance run.

**Limit:** A matching transfer confirms a transfer *for the seller's reported hash*, not cryptographic proof that the seller bound that hash to the original HTTP request. The SF36 reservation remains UNCHANGED_VERIFY_SEPARATELY. The original finality/ledger owner must reconcile the preserved stable intent and request evidence before making any accounting change. Never blindly retry a signed endpoint for extra proof.

## Original-source handoff

This is a complementary tool to [SF81 operator bridge](../sf81-buyer-operator-bridge/README.md), [SF31 native buyer](../sf31-buyer-client/README.md), and the existing SF36 governor, not their replacement. Native owner/Muse SF43: use an **already-authorized real testnet transaction** with its original SF81 record and original Stellar CLI result/events. Publish source-pinned public facts and exact mismatches to the existing #sim-data thread; do not create a new paid request, wallet, hosted Actions run or synthetic settlement claim.

Official references: https://developers.stellar.org/docs/tools/cli/agent-cli/guides/pay-for-apis-x402 and https://developers.stellar.org/docs/tools/cli/stellar-cli .

Offline checks in cloud Linux confirmed record extraction and parser positive/failure branches with sample-shaped input. They are not independently verified Stellar settlement, merchant operation, or customer payment. Only native CLI readback against a genuine transaction can establish that narrower evidence.

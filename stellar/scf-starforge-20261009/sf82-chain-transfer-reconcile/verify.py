"""Match original approved SF81 payment terms to one native transfer event. MIT."""
import hashlib
import json
import re
from xdr import (HASH, ATOMIC, MAX_I128, ReconciliationError, require, contract_hex, i128, require_positive_result, unpack_events)

def verify_record(record, trusted_payer, native_result, native_events, source):
    require(isinstance(record, dict), 'INVALID_SF81_RECORD')
    intent_id = record.get('intentId')
    require(isinstance(intent_id, str) and re.fullmatch(r'[A-Za-z0-9._:-]{1,160}', intent_id),
            'INVALID_INTENT_ID')
    requirement = record.get('requirement')
    receipt = record.get('receipt')
    reserve = record.get('operatorReservation')
    require(isinstance(requirement, dict) and isinstance(receipt, dict), 'MISSING_NATIVE_TERMS_OR_RECEIPT')
    require(isinstance(reserve, dict) and reserve.get('schema') == 'stellar-forge.sf62.result.v1'
            and reserve.get('outcome') == 'FRESH_RESERVATION_APPROVED'
            and reserve.get('request_id') == intent_id, 'NO_MATCHING_SF81_RESERVATION')
    require(requirement.get('scheme') == 'exact', 'NOT_AN_EXACT_PAYMENT')
    network = requirement.get('network')
    require(network in ('stellar:testnet', 'stellar:pubnet'), 'UNSUPPORTED_NETWORK')
    require(reserve.get('network') == network and reserve.get('asset') == requirement.get('asset')
            and reserve.get('reserved_atomic_units') == requirement.get('amount'), 'RESERVED_TERMS_MISMATCH')
    require(receipt.get('network') == network and (receipt.get('success') is True or
            (receipt.get('success') is False and receipt.get('errorReason') == 'settlement_pending')),
            'NO_ELIGIBLE_SELLER_TRANSACTION_CLAIM')
    require(isinstance(trusted_payer, str) and re.fullmatch(r'G[A-Z2-7]{55}', trusted_payer),
            'INVALID_TRUSTED_PAYER')
    require(receipt.get('payer') == trusted_payer, 'RECEIPT_PAYER_MISMATCH')
    pay_to = requirement.get('payTo')
    require(isinstance(pay_to, str) and re.fullmatch(r'[GC][A-Z2-7]{55}', pay_to),
            'INVALID_RECIPIENT')
    amount = requirement.get('amount')
    require(isinstance(amount, str) and ATOMIC.fullmatch(amount) and
            0 < int(amount) <= MAX_I128, 'INVALID_ATOMIC_AMOUNT')
    require(receipt.get('amount') in (None, amount), 'RECEIPT_AMOUNT_MISMATCH')
    tx = receipt.get('transaction')
    require(isinstance(tx, str) and HASH.fullmatch(tx), 'INVALID_TRANSACTION_HASH')
    asset = contract_hex(requirement.get('asset'))
    require_positive_result(native_result)
    matches = []
    for item in unpack_events(native_events):
        if not isinstance(item, dict) or item.get('type_') != 'contract':
            continue
        contract_id = item.get('contract_id')
        if isinstance(contract_id, str):
            if contract_id.startswith('C'):
                try:
                    contract_id = contract_hex(contract_id)
                except ReconciliationError:
                    continue
            else:
                contract_id = contract_id.removeprefix('0x').lower()
        body = item.get('body')
        v0 = body.get('v0') if isinstance(body, dict) else None
        if not isinstance(v0, dict) or contract_id != asset:
            continue
        topics = v0.get('topics')
        if (not isinstance(topics, list) or len(topics) < 3 or
                topics[0] != {'symbol': 'transfer'} or
                topics[1] != {'address': trusted_payer} or
                topics[2] != {'address': pay_to}):
            continue
        if i128(v0.get('data')) == int(amount):
            matches.append(item)
    require(len(matches) == 1, 'NO_EXACT_TRANSFER' if not matches else 'AMBIGUOUS_TRANSFERS')
    return {
        'schema': 'stellar-forge.sf82.reconciliation.v1',
        'verdict': 'CHAIN_TRANSFER_MATCHED' if source == 'live-stellar-cli' else 'SAVED_CLI_RECORD_MATCHED',
        'source': source,
        'intentId': intent_id,
        'transaction': tx,
        'network': network,
        'asset': requirement['asset'],
        'payer': trusted_payer,
        'recipient': pay_to,
        'atomicAmount': amount,
        'matchingTransfers': 1,
        'sellerReport': 'REPORTED_SUCCESS' if receipt.get('success') is True else 'SETTLEMENT_PENDING',
        'onchainResultSha256': hashlib.sha256(json.dumps(native_result, sort_keys=True).encode()).hexdigest(),
        'onchainEventsSha256': hashlib.sha256(json.dumps(native_events, sort_keys=True).encode()).hexdigest(),
        'reservation': 'UNCHANGED_VERIFY_SEPARATELY',
        'limitation': 'Transfer matches seller-provided hash; not cryptographic proof the seller bound this hash to the original HTTP intent.'
    }


"""Original Stellar CLI Soroban event/transaction decoding, stdlib only. MIT."""
import base64
import binascii
import json
import re
import struct
from pathlib import Path

HASH = re.compile(r"[0-9a-f]{64}\Z")
ATOMIC = re.compile(r"(?:0|[1-9][0-9]{0,38})\Z")
MAX_I128 = 2**127 - 1
MAX_BYTES = 4_000_000

class ReconciliationError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def require(condition, code):
    if not condition:
        raise ReconciliationError(code)


def read_json(path):
    payload = Path(path).read_bytes()
    require(len(payload) <= MAX_BYTES, 'INPUT_TOO_LARGE')
    try:
        return json.loads(payload)
    except (UnicodeDecodeError, ValueError):
        raise ReconciliationError('INVALID_JSON') from None


def contract_hex(address):
    """Decode a checksummed Stellar C... StrKey into an XDR contract ID."""
    require(isinstance(address, str) and address.startswith('C'), 'INVALID_ASSET_STRKEY')
    try:
        raw = base64.b32decode(address + '=' * ((-len(address)) % 8), casefold=False)
    except (binascii.Error, ValueError):
        raise ReconciliationError('INVALID_ASSET_STRKEY') from None
    require(len(raw) == 35 and raw[0] == 16, 'INVALID_ASSET_STRKEY')
    require(struct.pack('<H', binascii.crc_hqx(raw[:-2], 0)) == raw[-2:], 'INVALID_ASSET_CHECKSUM')
    return raw[1:33].hex()


def i128(value):
    if not isinstance(value, dict) or 'i128' not in value:
        return None
    n = value['i128']
    if isinstance(n, str) and re.fullmatch(r'-?[0-9]+', n):
        return int(n)
    if isinstance(n, dict) and type(n.get('hi')) is int and type(n.get('lo')) is int:
        hi, lo = n['hi'], n['lo']
        if -(1 << 63) <= hi < (1 << 63) and 0 <= lo < (1 << 64):
            return (hi << 64) + lo
    return None


def require_positive_result(result):
    """Use only explicit XDR success codes, not a seller's HTTP 200."""
    require(isinstance(result, (dict, list)), 'UNKNOWN_TX_RESULT_SHAPE')
    seen = []

    def walk(value, depth=0):
        if depth > 20:
            return
        if isinstance(value, dict):
            for key, child in value.items():
                if key in ('tx_success', 'tx_fee_bump_inner_success', 'tx_failed',
                           'tx_fee_bump_inner_failed'):
                    seen.append(key)
                if key in ('code', 'status', 'transaction_status') and isinstance(child, str):
                    if child in ('tx_success', 'tx_fee_bump_inner_success',
                                 'tx_failed', 'tx_fee_bump_inner_failed'):
                        seen.append(child)
                walk(child, depth + 1)
        elif isinstance(value, list):
            for child in value:
                walk(child, depth + 1)
    walk(result)
    require(not any(x in seen for x in ('tx_failed', 'tx_fee_bump_inner_failed')),
            'TX_RESULT_FAILED')
    require(any(x in seen for x in ('tx_success', 'tx_fee_bump_inner_success')),
            'TX_SUCCESS_NOT_ESTABLISHED')


def unpack_events(payload):
    """Official CLI tx fetch events --output json contract_events format."""
    require(isinstance(payload, dict), 'UNKNOWN_EVENTS_SHAPE')
    groups = payload.get('contract_events')
    require(isinstance(groups, list), 'UNKNOWN_EVENTS_SHAPE')
    result = []
    for group in groups:
        require(isinstance(group, list), 'UNKNOWN_EVENTS_SHAPE')
        result.extend(group)
    return result


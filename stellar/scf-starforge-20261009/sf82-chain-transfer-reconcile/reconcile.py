#!/usr/bin/env python3
"""Read-only SF81 original Stellar x402 chain-transfer reconciliation. MIT."""
import argparse
import json
import shutil
import subprocess
import sys
import re
from xdr import (HASH, MAX_BYTES, ReconciliationError, require, read_json)
from verify import verify_record

def native_fetch(executable, network, tx):
    exe = shutil.which(executable)
    require(exe is not None, 'STELLAR_CLI_UNAVAILABLE')
    def query(kind):
        try:
            p = subprocess.run([exe, 'tx', 'fetch', kind, '--hash', tx,
                                '--network', network, '--output', 'json'],
                               capture_output=True, timeout=35, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise ReconciliationError('STELLAR_CLI_FETCH_FAILED') from None
        require(p.returncode == 0 and len(p.stdout) <= MAX_BYTES,
                'STELLAR_CLI_FETCH_FAILED')
        try:
            return json.loads(p.stdout.decode('utf-8'))
        except (UnicodeDecodeError, ValueError):
            raise ReconciliationError('STELLAR_CLI_NONJSON_RESPONSE') from None
    return query('result'), query('events')


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--sf81-result', required=True, help='Private owner-exported minimal JSON of original SF81 result fields')
    p.add_argument('--payer', required=True, help='Trusted wallet public address; never copied from seller')
    p.add_argument('--stellar', default='stellar', help='Installed original Stellar CLI executable')
    p.add_argument('--saved-result', help='Saved *original* stellar tx fetch result JSON')
    p.add_argument('--saved-events', help='Saved *original* stellar tx fetch events JSON')
    args = p.parse_args(argv)
    try:
        require(bool(args.saved_result) == bool(args.saved_events), 'BOTH_SAVED_CLI_FILES_REQUIRED')
        record = read_json(args.sf81_result)
        receipt = record.get('receipt') if isinstance(record, dict) else None
        tx = receipt.get('transaction') if isinstance(receipt, dict) else None
        require(isinstance(tx, str) and HASH.fullmatch(tx), 'INVALID_TRANSACTION_HASH')
        requirement = record.get('requirement')
        network = requirement.get('network') if isinstance(requirement, dict) else None
        require(network in ('stellar:testnet', 'stellar:pubnet'), 'UNSUPPORTED_NETWORK')
        if args.saved_result:
            native_result, native_events = read_json(args.saved_result), read_json(args.saved_events)
            source = 'saved-cli-json'
        else:
            native_result, native_events = native_fetch(args.stellar, network.split(':')[1].replace('pubnet','public'), tx)
            source = 'live-stellar-cli'
        result = verify_record(record, args.payer, native_result, native_events, source)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ReconciliationError, OSError) as e:
        code = e.code if isinstance(e, ReconciliationError) else 'FILE_READ_FAILED'
        print(json.dumps({'schema':'stellar-forge.sf82.reconciliation.v1',
                          'verdict':'NOT_RECONCILED', 'reason':code,
                          'reservation':'UNCHANGED_VERIFY_SEPARATELY'}, sort_keys=True))
        return 2


if __name__ == '__main__':
    sys.exit(main())

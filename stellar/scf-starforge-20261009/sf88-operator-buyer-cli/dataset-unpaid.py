"""Read one existing SF36 ledger under its original SF81 approval lock."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'sf62-human-approval-cli'))
from console import check_ledger_path, load_json, key_from_environment
from governor import Governor, Denied

SCHEMA = 'stellar-forge.sf88.unpaid-ledger-check.v1'

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    args = parser.parse_args()
    governor = None
    try:
        raw = args.config.read_bytes()
        if len(raw) > 65536 or hashlib.sha256(raw).hexdigest() != args.sha256:
            raise Denied('DATASET_UNPAID_CONFIG_CHANGED')
        cfg = json.loads(raw)
        owner = cfg['operator']
        intent_id = cfg['operation']['intentId']
        ledger = Path(owner['ledger'])
        check_ledger_path(ledger)
        os.umask(0o077)
        lock_path = ledger.with_name(ledger.name + '.sf81.lock')
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'a') as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise Denied('OPERATOR_BUSY') from error
            governor = Governor(str(ledger), load_json(Path(owner['policy'])),
                key_from_environment('SF36_CONSENT_KEY_B64'),
                key_from_environment('SF36_AUDIT_KEY_B64'),
                key_from_environment('SF36_OPERATOR_KEY_B64'))
            # The original authenticated journal checks every reservation before
            # this read. A reserved, settled, released or duplicate row all deny
            # continuation; a missing approval return never clears native state.
            governor.db.execute('BEGIN')
            governor._audit()
            row = governor.db.execute(
                'SELECT request_id FROM reservations WHERE request_id=?',
                (intent_id,)).fetchone()
            if row is not None:
                raise Denied('DATASET_UNPAID_ORIGINAL_RESERVATION_EXISTS')
            result = {'schema': SCHEMA,
                'outcome': 'ABSENT_FROM_AUTHENTICATED_ORIGINAL_LEDGER',
                'intentId': intent_id, 'ledger': str(ledger),
                'checkedAt': datetime.now(timezone.utc).isoformat(),
                'reservationsForIntent': 0}
            governor.db.execute('COMMIT')
            governor.close()
            governor = None
        print(json.dumps(result, separators=(',', ':')), flush=True)
        return 0
    except (Denied, OSError, ValueError, KeyError, TypeError, sqlite3.Error) as error:
        code = (str(error) if isinstance(error, Denied) else
            getattr(error, 'sqlite_errorname', None) or
            'DATASET_UNPAID_LEDGER_READ_FAILED')
        print(json.dumps({'schema': SCHEMA, 'outcome': 'REFUSED',
            'code': code, 'errorType': type(error).__name__}), flush=True)
        return 2
    finally:
        if governor is not None:
            governor.close()

if __name__ == '__main__':
    raise SystemExit(main())

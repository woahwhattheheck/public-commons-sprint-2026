"""One focused actual-SF31/54/36/59 interop check, no signer or network."""
import base64
from contextlib import redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile

from console import (Denied, ReservationApprovalDenied, buyer_intent_to_governor_request,
                     load_json, reserve_interactive, review_payload)

ASSET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
EMPTY_SHA = hashlib.sha256(b'').hexdigest()
TERMS = dict(scheme='exact', network='stellar:testnet', amount='25000', asset=ASSET,
             payTo='G' + 'A' * 55, maxTimeoutSeconds=60, extra={'source': 'local-acceptance'})
INTENT = dict(intentId='sf62-probe-001', url='https://example.com/api/quote', method='GET',
              scheme='exact', network='stellar:testnet', amount='25000', asset=ASSET,
              payTo=TERMS['payTo'], maxAtomic='25000', maxTimeoutSeconds=60,
              acceptedTerms=TERMS, bodyPresent=False, bodyBytes=0, bodySha256=EMPTY_SHA)
POLICY = dict(schema='stellar-spend-governor/v1', assets=[dict(network='stellar:testnet',
              asset=ASSET, max_single='50000', max_total='100000',
              max_per_utc_day='100000', max_per_actor_utc_day='100000',
              max_per_service_utc_day='100000')])


def main():
    request = buyer_intent_to_governor_request(INTENT, actor='operator-reviewed-agent', service='original-seller')
    review, phrase = review_payload(INTENT, request)
    assert review['complete_original_accepted_terms'] == TERMS
    assert review['max_atomic_units_to_reserve'] == '25000'
    with tempfile.TemporaryDirectory(prefix='sf62-') as folder:
        directory = Path(folder)
        policy_path = directory / 'policy.json'
        policy_path.write_text(json.dumps(POLICY), encoding='utf8')
        ledger = directory / 'reservation.sqlite'
        saved = {name: os.environ.get(name) for name in ('SF36_CONSENT_KEY_B64', 'SF36_AUDIT_KEY_B64', 'SF36_OPERATOR_KEY_B64')}
        for name in saved:
            os.environ[name] = base64.b64encode(os.urandom(32)).decode('ascii')
        try:
            # A human denial does not reserve budget despite the original
            # governor opening the private durable journal.
            try:
                with redirect_stdout(io.StringIO()):
                    reserve_interactive(INTENT, request, policy_path=policy_path,
                                        ledger_path=ledger, terminal=io.StringIO('DENY\n'))
                raise AssertionError('refused human approval incorrectly succeeded')
            except Denied as exc:
                assert str(exc) == 'EXPLICIT_OPERATOR_CONSENT_NOT_GIVEN'
            with sqlite3.connect(ledger) as db:
                assert db.execute('SELECT count(*) FROM reservations').fetchone()[0] == 0
            # One full native approval: SF54 real mapping, SF36 real WAL reserve,
            # SF59 real fresh-reservation guard and original consent issuer.
            with redirect_stdout(io.StringIO()):
                result = reserve_interactive(INTENT, request, policy_path=policy_path,
                                              ledger_path=ledger, terminal=io.StringIO(phrase + '\n'))
            assert result['outcome'] == 'FRESH_RESERVATION_APPROVED'
            assert result['signed_requests'] == result['payments_confirmed'] == 0
            with sqlite3.connect(ledger) as db:
                rows = db.execute('SELECT request_id,amount,state FROM reservations').fetchall()
                assert rows == [('sf62-probe-001', '25000', 'reserved')]
            # A second human consent cannot authorize another signature for
            # the identical request, even when original SF36 is idempotent.
            try:
                with redirect_stdout(io.StringIO()):
                    reserve_interactive(INTENT, request, policy_path=policy_path,
                                        ledger_path=ledger, terminal=io.StringIO(phrase + '\n'))
                raise AssertionError('duplicate reserve incorrectly approved')
            except ReservationApprovalDenied as exc:
                assert 'NO_FRESH_RESERVATION' in str(exc)
            with sqlite3.connect(ledger) as db:
                assert db.execute('SELECT count(*) FROM reservations').fetchone()[0] == 1
            # No external network or signer, exact SHA and zero funds moved.
            print('SF62 native 4-module approval: denied / fresh / duplicate PASS; reservations=1; signed=0')
        finally:
            for name, val in saved.items():
                if val is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = val


if __name__ == '__main__':
    main()

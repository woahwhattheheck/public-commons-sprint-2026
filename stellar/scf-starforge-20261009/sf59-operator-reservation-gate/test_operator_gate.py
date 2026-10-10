"""Focused gate contract test. Original SF54 + SF36 remain unchanged."""
import unittest
from operator_gate import reserve_for_approval, ReservationApprovalDenied


class GovernorDouble:
    def __init__(self, outcome='RESERVED'):
        self.outcome = outcome
        self.calls = []

    def reserve(self, request, permit):
        self.calls.append((dict(request), permit))
        if permit != 'operator-issued-for-this-exact-request':
            raise ValueError('privileged consent rejected')
        if self.outcome == 'RESERVED':
            return dict(outcome='RESERVED', request_id=request['request_id'],
                        max_amount=request['max_amount'], scheme=request['scheme'],
                        network=request['network'], asset=request['asset'])
        return dict(outcome=self.outcome, state='reserved', request_id=request['request_id'])


def exact_mapper(intent, *, actor, service):
    return dict(request_id=intent['intentId'], actor=actor, service=service,
                max_amount=intent['amount'], scheme='exact', network='stellar:testnet',
                asset='C'+'A'*55)


class GateChecks(unittest.TestCase):
    def test_new_reservation_approves_once(self):
        ledger = GovernorDouble()
        seen = []
        def human_operator(request):
            seen.append(dict(request))
            return 'operator-issued-for-this-exact-request'
        intent = {'intentId': 'test-intent-01', 'amount': '123'}
        self.assertTrue(reserve_for_approval(intent, actor='agent-one', service='seller-one',
                                            governor=ledger, consent_for_request=human_operator,
                                            intent_mapper=exact_mapper))
        self.assertEqual(len(ledger.calls), 1)
        self.assertEqual(seen[0], ledger.calls[0][0])
        self.assertEqual(ledger.calls[0][0]['max_amount'], '123')

    def test_existing_reservation_cannot_enable_duplicate_sign(self):
        for outcome in ('IDEMPOTENT_EXISTING', 'DENIED', 'FINALIZED'):
            with self.subTest(outcome=outcome):
                with self.assertRaisesRegex(ReservationApprovalDenied, 'NO_FRESH_RESERVATION'):
                    reserve_for_approval({'intentId': 'x', 'amount': '3'},
                        actor='a', service='b', governor=GovernorDouble(outcome),
                        consent_for_request=lambda _: 'operator-issued-for-this-exact-request',
                        intent_mapper=exact_mapper)

    def test_unapproved_never_reserves(self):
        ledger = GovernorDouble()
        with self.assertRaisesRegex(ReservationApprovalDenied, 'CONSENT_NOT_GRANTED'):
            reserve_for_approval({'intentId': 'x', 'amount': '3'},
                actor='a', service='b', governor=ledger,
                consent_for_request=lambda _: None, intent_mapper=exact_mapper)
        self.assertEqual(ledger.calls, [])

    def test_original_mapper_rejection_does_not_reserve(self):
        ledger = GovernorDouble()
        def reject(*args, **kwargs):
            raise ValueError('malformed source intent')
        with self.assertRaisesRegex(ValueError, 'malformed source'):
            reserve_for_approval({}, actor='a', service='b', governor=ledger,
                consent_for_request=lambda _: 'operator-issued-for-this-exact-request',
                intent_mapper=reject)
        self.assertFalse(ledger.calls)

    def test_mapped_actor_drift_denied_before_token(self):
        ledger = GovernorDouble()
        called = []
        def wrong_actor(intent, *, actor, service):
            r = exact_mapper(intent, actor=actor, service=service)
            r['actor'] = 'attacker'
            return r
        with self.assertRaisesRegex(ReservationApprovalDenied, 'OPERATOR_IDENTITY_DRIFT'):
            reserve_for_approval({'intentId': 'x', 'amount': '3'},
                actor='a', service='b', governor=ledger,
                consent_for_request=lambda r: called.append(r), intent_mapper=wrong_actor)
        self.assertFalse(called)
        self.assertFalse(ledger.calls)

    def test_governor_denial_propagates(self):
        ledger = GovernorDouble()
        with self.assertRaisesRegex(ValueError, 'privileged consent rejected'):
            reserve_for_approval({'intentId': 'x', 'amount': '3'}, actor='a', service='b',
                governor=ledger, consent_for_request=lambda _: 'wrong',
                intent_mapper=exact_mapper)
        self.assertEqual(len(ledger.calls), 1)


if __name__ == '__main__':
    unittest.main()

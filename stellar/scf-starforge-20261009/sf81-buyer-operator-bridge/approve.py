"""SF81 trusted POSIX host: pipe SF31 intent to the unchanged SF62 operator.

Default review and response use the controlling TTY. The trusted browser host
can select a framed pipe review with an exact native-request-digest decision.
This subprocess is an integration boundary, NOT a sandbox against its parent.
"""
from __future__ import annotations

import argparse
from contextlib import redirect_stdout
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'sf62-human-approval-cli'))
from console import (Denied, ReservationApprovalDenied,  # noqa: E402
                     buyer_intent_to_governor_request, check_ledger_path,
                     reserve_interactive, reserve_reviewed)


def unique_object(pairs: list[tuple]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise Denied('DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor', required=True)
    parser.add_argument('--service', required=True)
    parser.add_argument('--policy', type=Path, required=True)
    parser.add_argument('--ledger', type=Path, required=True)
    parser.add_argument('--review-channel', choices=('terminal', 'pipe'), default='terminal')
    args = parser.parse_args()
    try:
        raw = (sys.stdin.buffer.readline(65_538).rstrip(b'\n')
               if args.review_channel == 'pipe' else sys.stdin.buffer.read(65_537))
        if len(raw) > 65_536:
            raise Denied('INTENT_TOO_LARGE')
        def nonfinite(_):
            raise Denied('NONFINITE_JSON')
        intent = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object,
                            parse_constant=nonfinite)
        request = buyer_intent_to_governor_request(intent, actor=args.actor,
                                                   service=args.service)
        input_digest = hashlib.sha256(raw).hexdigest()
        check_ledger_path(args.ledger)
        # Serialize interactive users of this ledger, including other processes.
        # Never follow a preplaced symlink for the lock and never hold SQLite
        # transaction locks while waiting for a person.
        os.umask(0o077)
        lock_path = args.ledger.with_name(args.ledger.name + '.sf81.lock')
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise Denied('OPERATOR_BUSY') from exc
            if args.review_channel == 'pipe':
                def confirm(presented: dict) -> str | None:
                    print(json.dumps({'schema': 'stellar-forge.sf81.review.v1',
                        'input_sha256': input_digest, **presented},
                        separators=(',', ':'), ensure_ascii=True), flush=True)
                    line = sys.stdin.buffer.readline(4097)
                    if not line.endswith(b'\n') or len(line) > 4096:
                        raise Denied('OPERATOR_DECISION_FRAME_INVALID')
                    decision = json.loads(line.decode('utf-8'),
                        object_pairs_hook=unique_object, parse_constant=nonfinite)
                    if (type(decision) is not dict or set(decision) !=
                            {'schema', 'input_sha256', 'request_sha256', 'decision'} or
                            decision.get('schema') != 'stellar-forge.sf81.decision.v1' or
                            decision.get('input_sha256') != input_digest or
                            decision.get('request_sha256') != presented['review']['request_sha256'] or
                            decision.get('decision') not in ('approve', 'reject')):
                        raise Denied('OPERATOR_DECISION_MISMATCH')
                    return decision['request_sha256'] if decision['decision'] == 'approve' else None

                native = reserve_reviewed(intent, request, policy_path=args.policy,
                    ledger_path=args.ledger, confirm_review=confirm)
            else:
                # Separate streams avoid seeking/buffering surprises on a terminal.
                with open('/dev/tty', 'r', encoding='utf-8') as answer, \
                        open('/dev/tty', 'w', encoding='utf-8', buffering=1) as review:
                    with redirect_stdout(review):
                        native = reserve_interactive(intent, request,
                            policy_path=args.policy, ledger_path=args.ledger,
                            terminal=answer)
        print(json.dumps({'schema': 'stellar-forge.sf81.approval.v1',
            'input_sha256': input_digest, 'reservation': native},
            separators=(',', ':'), ensure_ascii=True), flush=True)
        return 0
    except (Denied, ReservationApprovalDenied, OSError, ValueError, TypeError,
            KeyError, UnicodeError, RecursionError) as exc:
        # No secrets or input content in pipe errors. A lost result after a
        # successful reserve must NEVER be reported as proof of no reservation.
        print(json.dumps({'schema': 'stellar-forge.sf81.approval.v1',
            'outcome': 'NO_APPROVAL_RETURNED', 'error_type': type(exc).__name__,
            'reason': str(exc)[:256] if isinstance(exc, (Denied, ReservationApprovalDenied))
                      else 'LOCAL_INPUT_IO_OR_TERMINAL_ERROR'}),
            flush=True)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())


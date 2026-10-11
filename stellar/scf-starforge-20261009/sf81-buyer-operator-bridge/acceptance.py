"""One POSIX integration check: native Node HTTP -> real Python TTY -> SQLite.

Test-only PTY driver types answers for disposable FICTIONAL payment intents.
Never use this driver with a real policy, ledger, wallet, signer or merchant.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='sf81-integration-') as work:
    directory = Path(work)
    os.chmod(directory, 0o700)
    keys = {name: base64.b64encode(os.urandom(32)).decode() for name in
            ('SF36_CONSENT_KEY_B64', 'SF36_AUDIT_KEY_B64', 'SF36_OPERATOR_KEY_B64')}
    policy = {'schema': 'stellar-spend-governor/v1', 'assets': [{
        'network': 'stellar:testnet', 'asset': 'C' + 'A' * 55,
        **{key: '100' for key in ('max_single', 'max_total', 'max_per_utc_day',
              'max_per_actor_utc_day', 'max_per_service_utc_day')}}]}
    (directory / 'policy.json').write_text(json.dumps(policy))
    env = {**os.environ, **keys, 'SF81_FIXTURE_DIR': work, 'SF81_PYTHON': sys.executable}
    command = [shutil.which('node'), str(HERE / 'acceptance.mjs')]
    # Detached execution must not mint approval from piped stdin.
    no_tty = subprocess.run(command + ['--no-tty'], env=env, start_new_session=True,
                            stdin=subprocess.DEVNULL, capture_output=True, timeout=10)
    assert no_tty.returncode == 0 and b'NO_TTY_PASS' in no_tty.stdout, no_tty.stderr.decode()
    pid, fd = pty.fork()
    if pid == 0:
        os.execve(command[0], command, env)
    transcript = bytearray(); scanned = 0; status = None
    prompt = re.compile(rb'To authorize ONE fresh reservation, type exactly: (APPROVE [0-9a-f]{16})')
    try:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            ready, _, _ = select.select([fd], [], [], 0.1)
            if ready:
                try:
                    chunk = os.read(fd, 65_536)
                except OSError:
                    break
                if not chunk:
                    break
                transcript.extend(chunk)
                for match in prompt.finditer(transcript, scanned):
                    prefix = bytes(transcript[:match.start()])
                    steps = re.findall(rb'STEP ([a-z]+)', prefix)
                    step = steps[-1] if steps else b''
                    if step == b'deny':
                        os.write(fd, b'NO\n')
                    elif step in (b'approved', b'duplicate', b'lost'):
                        os.write(fd, match.group(1) + b'\n')
                    scanned = match.end()
            ended, value = os.waitpid(pid, os.WNOHANG)
            if ended:
                status = value
                break
        if status is None:
            ended, value = os.waitpid(pid, os.WNOHANG)
            if ended:
                status = value
            else:
                os.killpg(pid, signal.SIGKILL)
                _, status = os.waitpid(pid, 0)
        assert os.waitstatus_to_exitcode(status) == 0, transcript.decode(errors='replace')
        assert b'NATIVE_BRIDGE_PASS' in transcript, transcript.decode(errors='replace')
    finally:
        os.close(fd)
    with sqlite3.connect(directory / 'ledger.sqlite') as db:
        rows = db.execute('SELECT request_id,amount,state FROM reservations ORDER BY request_id').fetchall()
        assert rows == [('approved', '7', 'reserved'), ('lost', '7', 'reserved')], rows
        assert db.execute('SELECT COUNT(*) FROM journal').fetchone()[0] == 2
        assert db.execute('PRAGMA journal_mode').fetchone()[0] == 'wal'
    sys.path.insert(0, str(HERE.parent / 'sf36-spend-governor'))
    from governor import Governor
    g = Governor(directory / 'ledger.sqlite', policy, *(base64.b64decode(keys[k]) for k in keys))
    try:
        audit = g.audit()
        assert audit['outcome'] == 'JOURNAL_CONSISTENT' and audit['rows'] == 2
    finally:
        g.close()
    result = json.loads((directory / 'result.json').read_text())
    result.update(noTTY='PASS', nativeDurableRows=rows, nativeAudit=audit['outcome'])
    print(json.dumps(result, indent=2))

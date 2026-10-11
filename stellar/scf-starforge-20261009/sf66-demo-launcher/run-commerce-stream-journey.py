"""Original PR970 PTY/TLS fixture continuation for the native stream workspace.

Provide existing Playwright and Chromium paths. Only three generated local
fixture intents can receive this runner's generated approval challenges.
"""
import base64
import json
import os
import pty
import re
import select
import signal
import subprocess
import tempfile
import time
from pathlib import Path

source = Path(__file__).resolve().parent
assert Path(os.environ['COMMERCE_STREAM_PLAYWRIGHT']).is_file()
assert Path(os.environ['COMMERCE_STREAM_BROWSER_PATH']).is_file()
expected = [b'stream-browser-answer', b'stream-browser-partial', b'stream-browser-records']
with tempfile.TemporaryDirectory(prefix='sf66-stream-', dir=os.environ.get('COMMERCE_STREAM_TMPDIR')) as directory:
    root = Path(directory)
    os.chmod(root, 0o700)
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-noenc',
        '-keyout', str(root / 'test.key'), '-out', str(root / 'test.crt'), '-days', '1',
        '-subj', '/CN=merchant.example', '-addext', 'subjectAltName=DNS:merchant.example'],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.chmod(root / 'test.key', 0o600)
    env = dict(os.environ, COMMERCE_STREAM_FIXTURE_ROOT=directory, NODE_EXTRA_CA_CERTS=str(root / 'test.crt'), TMPDIR=directory)
    for name in ('SF36_CONSENT_KEY_B64', 'SF36_AUDIT_KEY_B64', 'SF36_OPERATOR_KEY_B64'):
        env[name] = base64.b64encode(os.urandom(32)).decode()
    env['COMMERCE_STREAM_SOURCE_HEAD'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
    pid, fd = pty.fork()
    if pid == 0:
        os.execvpe('node', ['node', str(source / 'commerce-stream-journey.mjs')], env)
    transcript = bytearray()
    scanned = approvals = 0
    status = None
    prompt = re.compile(rb'To authorize ONE fresh reservation, type exactly: (APPROVE [0-9a-f]{16})')
    try:
        deadline = time.monotonic() + 160
        while time.monotonic() < deadline:
            ready, _, _ = select.select([fd], [], [], 0.1)
            if ready:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                transcript.extend(chunk)
                for match in prompt.finditer(transcript, scanned):
                    assert approvals < len(expected), 'Unexpected fixture payment prompt'
                    current = transcript[scanned:match.start()]
                    assert b'FIXTURE_ALLOWED_INTENT ' + expected[approvals] in current
                    assert b'merchant.example' in current and expected[approvals] in current
                    os.write(fd, match.group(1) + b'\n')
                    approvals += 1
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
        if os.waitstatus_to_exitcode(status) != 0:
            print(transcript.decode(errors='replace')[-20000:])
            raise SystemExit(1)
        assert approvals == len(expected)
        report = Path(os.environ.get('COMMERCE_STREAM_OUTPUT', str(root / 'output'))) / 'commerce-stream-journey.json'
        print(report.read_text())
    finally:
        os.close(fd)

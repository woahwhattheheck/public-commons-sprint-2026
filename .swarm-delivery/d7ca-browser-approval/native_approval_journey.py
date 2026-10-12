"""Prepare a thin original-source closure and run one native browser journey.

Scratch acceptance tooling, intentionally outside the repository. The companion
Node file exercises actual SF66/SF88/SF81/SF31 and Python SF62/SF59/SF54/SF36. It uses
private disposable keys, policy and ledger plus the existing SF81 fictional
merchant/signer fixture. This command installs nothing and invokes no build.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
SCF = Path('stellar/scf-starforge-20261009')
DEFAULT_SOURCE = HERE.parent / 'scf-browser-approval/source'
DEFAULT_KEEPER = Path('/workspace/scratch/d1ccf784531e/scf-following-release/native-2d790e8c0483/installed/node_modules/@tokenjunkielabs/starforge-merchant/source')
KEY_NAMES = ('SF36_CONSENT_KEY_B64', 'SF36_AUDIT_KEY_B64', 'SF36_OPERATOR_KEY_B64')


def thin_overlay(base: Path, changed: Path, destination: Path, captured: dict, relative=Path()) -> None:
    """Only changed leaves are copied; every untouched subtree is a symlink."""
    if changed.is_file():
        data = changed.read_bytes()
        destination.write_bytes(data)
        destination.chmod(0o600)
        captured[str(relative)] = hashlib.sha256(data).hexdigest()
    elif changed.is_dir():
        if base.exists() and not base.is_dir():
            raise RuntimeError('Source directory conflicts with keeper: ' + str(relative))
        destination.mkdir(mode=0o700)
        names = {item.name for item in changed.iterdir()}
        if base.is_dir():
            names |= {item.name for item in base.iterdir()}
        for name in sorted(names):
            thin_overlay(base / name, changed / name, destination / name, captured, relative / name)
    elif base.exists():
        destination.symlink_to(base, target_is_directory=base.is_dir())
    else:
        raise RuntimeError('Missing original source: ' + str(relative))


def run() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE,
                        help='Root assembled changed-source tree, containing stellar/.')
    parser.add_argument('--keeper', type=Path, default=DEFAULT_KEEPER,
                        help='Existing installed original source; dependencies are reused.')
    parser.add_argument('--node', type=Path,
                        default=Path(os.environ.get('CODEX_PRIMARY_RUNTIME_NODE') or shutil.which('node') or '/usr/bin/node'))
    parser.add_argument('--out', type=Path, help='Write the non-secret native result here.')
    args = parser.parse_args()
    source, keeper, node = args.source.resolve(), args.keeper.resolve(), args.node.resolve()
    required = [
        'sf81-buyer-operator-bridge/browser-approval.mjs',
        'sf81-buyer-operator-bridge/bridge.mjs',
        'sf81-buyer-operator-bridge/approve.py',
        'sf62-human-approval-cli/console.py',
        'sf66-demo-launcher/commerce-console.mjs',
        'sf66-demo-launcher/commerce.mjs',
        'sf88-operator-buyer-cli/workspace.mjs',
        'sf88-operator-buyer-cli/queue.mjs',
        'sf81-buyer-operator-bridge/browser-ui/approval-panel.mjs',
        'sf81-buyer-operator-bridge/browser-ui/approval.css',
    ]
    for name in required:
        if not (source / SCF / name).is_file():
            raise RuntimeError('Assemble the changed source before this journey: ' + name)
    if not (keeper / SCF / 'sf36-spend-governor/governor.py').is_file():
        raise RuntimeError('The installed native keeper is unavailable.')
    node_modules = keeper.parents[2]
    if node_modules.name != 'node_modules' or not node.is_file():
        raise RuntimeError('Installed dependencies and the Node executable must already exist.')

    # /tmp keeps the Unix-socket path below the native 103-byte limit.
    with tempfile.TemporaryDirectory(prefix='s81-', dir='/tmp') as owned:
        directory = Path(owned)
        directory.chmod(0o700)
        fixture = directory / 'fixture'; fixture.mkdir(mode=0o700)
        captured = {}
        overlay = directory / 'source'
        thin_overlay(keeper, source, overlay, captured)
        (directory / 'node_modules').symlink_to(node_modules, target_is_directory=True)
        keys = {name: base64.b64encode(os.urandom(32)).decode() for name in KEY_NAMES}
        script = directory / 'native_approval_journey.mjs'
        script.write_bytes((HERE / 'native_approval_journey.mjs').read_bytes())
        script.chmod(0o600)
        configuration = {'source': str(overlay), 'directory': str(fixture),
                         'python': sys.executable, 'keys': keys}
        command = [str(node), '--preserve-symlinks', str(script)]
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, start_new_session=True,
            env={'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'NO_COLOR': '1'})
        try:
            stdout, stderr = process.communicate(json.dumps(configuration), timeout=50)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                stdout, stderr = process.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                stdout, stderr = process.communicate()
            raise RuntimeError('Native journey exceeded 50 seconds.\n' + stderr + stdout)
        if process.returncode:
            raise RuntimeError('Native journey failed.\n' + stderr + stdout)
        result = json.loads(stdout)
        assert result['status'] == 'PASS', result

        # Independently use the original mapper/canonical serializer and actual
        # SQLite ledger, rather than inferring reservation from the UI state.
        sys.path.insert(0, str(overlay / SCF / 'sf36-spend-governor'))
        sys.path.insert(0, str(overlay / SCF / 'sf54-buyer-governor-intent'))
        from governor import Governor, canonical
        from intent_adapter import buyer_intent_to_governor_request
        request = buyer_intent_to_governor_request(result['originalIntent'],
            actor='fixture-actor', service='fixture-seller')
        digest = hashlib.sha256(canonical(request)).hexdigest()
        native = result['freshReservation']
        review = result['approvedEnvelope']['review']
        assert native['approved_request'] == request
        assert native['request_sha256'] == review['request_sha256'] == digest
        assert review['accepted_terms_sha256'] == request['accepted_terms_sha256']
        assert review['complete_original_accepted_terms'] == result['originalIntent']['acceptedTerms']
        assert [native[name] for name in ('signed_requests', 'wallet_calls', 'payments_confirmed')] == [0, 0, 0]
        native_workspace = fixture / 'workspace'
        policy = json.loads((native_workspace / 'policy.json').read_text())
        stored = json.loads((native_workspace / 'operator-keys.json').read_text())
        assert stored['keys'] == keys and set(stored['keys']) == set(KEY_NAMES)
        with sqlite3.connect(native_workspace / 'reservations.sqlite') as db:
            rows = db.execute('SELECT request_id,amount,state FROM reservations ORDER BY request_id').fetchall()
            assert rows == [('browser-approved', '7', 'reserved')], rows
            assert db.execute('SELECT COUNT(*) FROM journal').fetchone()[0] == 1
            assert db.execute('PRAGMA journal_mode').fetchone()[0] == 'wal'
        governor = Governor(native_workspace / 'reservations.sqlite', policy,
                            *(base64.b64decode(keys[name]) for name in KEY_NAMES))
        try:
            audit = governor.audit()
            assert audit['outcome'] == 'JOURNAL_CONSISTENT' and audit['rows'] == 1, audit
        finally:
            governor.close()
        report = {'status': 'PASS', 'journey': 'D7CA-SCF-BROWSER-APPROVAL',
            'nativeModuleClosure': ['SF66 HTTP console', 'SF88 queue workspace binding and retained keys',
                'SF81 browser broker and bridge',
                'SF31 buyer', 'SF62 review', 'SF54 mapper', 'SF59 fresh gate', 'SF36 durable governor'],
            'scenarios': result['scenarios'], 'fixtureSignedRequests': result['signedRequests'],
            'signatures': result['signatures'], 'nativeDurableRows': rows,
            'nativeAudit': audit['outcome'], 'nativeBudgetAtReview':
                result['approvedEnvelope']['current_native_budget_estimate'],
            'reviewRequestSha256': digest, 'changedSourceSha256': captured,
            'baseSource': str(keeper)}
        rendered = json.dumps(report, indent=2, ensure_ascii=True) + '\n'
        if args.out:
            args.out.write_text(rendered, encoding='utf-8')
        print(rendered, end='')


if __name__ == '__main__':
    run()

#!/usr/bin/env python3
"""Execute or resume the retained synthetic headwaters case without regenerating inputs.

Uses the original official-InVEST runner, verifies the saved fourteen inputs,
retains successful native steps, and finishes the original numerical/report output.
The old preparation cutoff is historical; an execution deadline is optional.
"""
from __future__ import annotations

import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import traceback

CASE_ID = 'TJL-SYNTHETIC-HEADWATERS-120X120-20261013'
SOURCE_SHA = 'a5119d161c3ec929d2c373a14ea1ef4559b88dc68611eddd5d9d5ab476ebf925'
OWNER_DIRECTION = '2026-10-13.4'
THREAD = 'https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791724121853269'
CHILD = None


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(part)
    return digest.hexdigest()


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    os.replace(temp, path)


def emit(root: Path, stage: str, **values: object) -> None:
    record = {'at': now(), 'case_id': CASE_ID, 'stage': stage, **values}
    print(json.dumps(record, allow_nan=False), flush=True)
    with (root / 'execution-events.jsonl').open('a', encoding='utf-8') as stream:
        stream.write(json.dumps(record, allow_nan=False) + '\n')
    write(root / 'execution-status.json', record)


def verify_inputs(root: Path) -> tuple[dict, str]:
    manifest = json.loads((root / 'input_manifest.json').read_text())
    if manifest.get('case_id') != CASE_ID or manifest.get('synthetic') is not True:
        raise ValueError('The supplied manifest is not the retained synthetic direct case')
    entries = manifest['input_files']
    if len(entries) != 14:
        raise ValueError(f'Expected the original fourteen inputs, found {len(entries)}')
    for entry in entries:
        file = (root / entry['path']).resolve()
        if not file.is_relative_to(root / 'inputs'):
            raise ValueError(f'Input outside the case inputs: {entry["path"]}')
        if file.stat().st_size != entry['bytes'] or sha(file) != entry['sha256']:
            raise ValueError(f'Original input has changed: {entry["path"]}')
    config = json.loads((root / 'config.json').read_text())
    if config.get('case_id') != CASE_ID or config.get('synthetic') is not True:
        raise ValueError('Config and original case identity differ')
    identity = hashlib.sha256(json.dumps({
        'manifest': manifest, 'configuration': config,
        'source_sha256': SOURCE_SHA
    }, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return config, identity


def normalize_arguments(args: dict, root: Path) -> dict:
    normalized = dict(args)
    for key, value in args.items():
        if isinstance(value, str):
            with contextlib.suppress(ValueError):
                normalized[key] = str(Path(value).relative_to(root))
    return normalized


def finish_child() -> None:
    global CHILD
    if CHILD is None or CHILD.poll() is not None:
        return
    os.killpg(CHILD.pid, signal.SIGTERM)
    try:
        CHILD.wait(timeout=8)
    except subprocess.TimeoutExpired:
        os.killpg(CHILD.pid, signal.SIGKILL)
        CHILD.wait()


def main() -> int:
    global CHILD
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--python', default=sys.executable,
                        help='Existing InVEST3.20 interpreter; no installation is performed')
    parser.add_argument('--deadline', help='Optional explicitly selected UTC ISO deadline')
    options = parser.parse_args()
    root, source = options.root.resolve(), options.source.resolve()
    if not root.is_dir():
        parser.error('--root must be the existing prepared direct-case directory')
    if sha(source) != SOURCE_SHA:
        parser.error('Original runner differs from the retained source SHA256')
    deadline = None
    if options.deadline:
        parsed = datetime.fromisoformat(options.deadline.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            parser.error('--deadline must include a time zone')
        deadline = parsed.timestamp()
    config, input_identity = verify_inputs(root)
    lock = (root / '.native-execution.lock').open('a+')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.seek(0)
        print(json.dumps({'state': 'ACTIVE_EXECUTION', 'holder': lock.read()}))
        return 73
    lock.seek(0)
    lock.truncate()
    json.dump({'host': socket.gethostname(), 'pid': os.getpid(), 'started': now()}, lock)
    lock.flush()
    spec = importlib.util.spec_from_file_location('original_direct_case', source)
    if spec is None or spec.loader is None:
        raise ImportError(f'Cannot load {source}')
    original = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(original)
    original.ROOT = root
    native_env = os.environ.copy()
    executable = Path(options.python).resolve()
    prefix = executable.parent.parent
    # Scope native data directories to this process and this explicit runtime.
    for variable, location in [('PROJ_DATA', prefix / 'share/proj'),
                               ('GDAL_DATA', prefix / 'share/gdal')]:
        if location.is_dir():
            native_env[variable] = str(location)
    for variable in ['GDAL_NUM_THREADS', 'OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS',
                     'MKL_NUM_THREADS', 'NUMEXPR_NUM_THREADS']:
        native_env[variable] = '1'
    native_env['GDAL_CACHEMAX'] = '16'
    def interrupted(signum, frame):
        raise KeyboardInterrupt(f'Signal {signum}')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    completed, reused = [], []
    write(root / 'execution-request.json', {
        'case_id': CASE_ID, 'host': socket.gethostname(), 'pid': os.getpid(),
        'input_identity': input_identity, 'source_sha256': SOURCE_SHA,
        'owner_direction': OWNER_DIRECTION, 'coordination': THREAD,
        'historical_preparation_cutoff': config.get('cutoff_utc'),
        'execution_deadline': options.deadline, 'python': str(executable),
        'started': now(), 'inputs_regenerated': False,
    })
    try:
        emit(root, 'EXECUTION_STARTED', python=str(executable), input_identity=input_identity)
        results, displays = [], {}
        for scenario in original.SCENARIOS:
            for model in ('ndr', 'sdr'):
                args = original.model_args(config, scenario, model)
                work = Path(args['workspace_dir'])
                work.mkdir(parents=True, exist_ok=True)
                success = work / 'direct-case-success.json'
                fingerprint = hashlib.sha256(json.dumps({
                    'inputs': input_identity, 'arguments': normalize_arguments(args, root),
                    'source_sha256': SOURCE_SHA
                }, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                if success.exists():
                    saved = json.loads(success.read_text())
                    execution = work / 'native_execution.json'
                    if (saved.get('fingerprint') != fingerprint or
                            not execution.exists() or
                            sha(execution) != saved.get('native_execution_sha256')):
                        raise ValueError(f'Saved completed step differs: {scenario}/{model}')
                    reused.append(f'{scenario}/{model}')
                    emit(root, 'COMPLETED_STEP_REUSED', scenario=scenario, model=model)
                    continue
                arguments = root / 'arguments' / f'{scenario}_{model}.json'
                write(arguments, args)
                timeout = None if deadline is None else deadline - time.time()
                if timeout is not None and timeout <= 0:
                    raise TimeoutError('The explicitly supplied execution deadline has elapsed')
                argv = [str(executable), '-u', str(source), '--native-child', model,
                        '--args', str(arguments)]
                started = time.monotonic()
                with (work / 'native.stdout.log').open('a') as log:
                    CHILD = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT,
                                             env=native_env, start_new_session=True)
                    emit(root, 'NATIVE_STARTED', scenario=scenario, model=model,
                         argv=argv, pid=CHILD.pid)
                    code = CHILD.wait(timeout=timeout)
                if code != 0:
                    raise RuntimeError(f'{scenario}/{model} exit{code}; {work / "native.stdout.log"}')
                execution = work / 'native_execution.json'
                native = json.loads(execution.read_text())
                if native['version'].split('+')[0] != '3.20.0':
                    raise ValueError(f'Unexpected native version: {native["version"]}')
                if normalize_arguments(native['args'], root) != normalize_arguments(args, root):
                    raise ValueError('Native return arguments do not match the requested step')
                write(success, {'fingerprint': fingerprint, 'completed': now(),
                                'native_execution_sha256': sha(execution),
                                'seconds': time.monotonic() - started})
                completed.append(f'{scenario}/{model}')
                emit(root, 'NATIVE_COMPLETED', scenario=scenario, model=model,
                     seconds=time.monotonic()-started)
            result, display = original.collect_scenario(scenario)
            results.append(result)
            displays[scenario] = display
            emit(root, 'SCENARIO_AGGREGATED', scenario=scenario, result=result)
        original.comparison(results, displays)
        verify_inputs(root)
        emit(root, 'COMPLETE_NATIVE', completed=completed, reused=reused,
             report=str(root / 'OPEN_RESULTS.html'), owner_direction=OWNER_DIRECTION)
        return 0
    except (KeyboardInterrupt, subprocess.TimeoutExpired, TimeoutError) as error:
        finish_child()
        emit(root, 'INTERRUPTED', reason=str(error), completed=completed, reused=reused)
        return 124
    except Exception as error:
        finish_child()
        emit(root, 'FAILED', reason=str(error), traceback=traceback.format_exc(),
             completed=completed, reused=reused)
        return 1
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


if __name__ == '__main__':
    raise SystemExit(main())

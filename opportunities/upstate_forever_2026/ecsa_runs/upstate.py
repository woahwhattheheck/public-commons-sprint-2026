"""Exact original Operator -> Workspace.run composition, without a second queue.

Inspected original source: commons 97d09111ac34899ea46ba9fdd599cccf5e46dbac,
opportunities/upstate_forever_2026/operator/server.py, model/workspace.py,
model/native.py. Native NDR/SDR arguments, execute functions and comparison code
remain untouched. The original operator gate encloses this entire call.
"""
from __future__ import annotations
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any
from .provider import safe_relative
from .workspace_adapter import WorkspaceRetention
from .store import check_sha


def _identifier(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value):
        raise ValueError('Select an existing original native identity')
    return value


def retention_for(operator, workspace) -> WorkspaceRetention:
    """One retention sidecar, outside the original native workspace tree."""
    project_id = workspace.project['id']
    key = hashlib.sha256(str(project_id).encode()).hexdigest()
    return WorkspaceRetention(Path(operator.root) / 'native-retention' / key,
                              namespace='upstate:' + str(project_id))


def _selected_inputs(workspace, run_id: str) -> tuple[dict, dict[str, Path], dict[str, dict]]:
    state = workspace.inspect_run(run_id)
    selection = state['selection']
    grid = workspace.get_grid(_identifier(selection['grid_id']))
    profile = workspace._get('profiles', _identifier(selection['profile_id']))
    scenario = workspace._get('scenarios', _identifier(selection['scenario_id']))
    root = Path(workspace.root).resolve()
    files: dict[str, Path] = {}
    expected_files: dict[str, dict] = {}

    def add(relative: str, expected: dict | None = None):
        name = safe_relative(relative).as_posix()
        path = root / name
        if name != relative or path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
            raise ValueError(f'Native dependency is not a retained file: {relative}')
        if expected is not None:
            sha = check_sha(expected.get('sha256'))
            size = expected.get('bytes')
            if type(size) is not int or size < 0:
                raise ValueError('Original native dependency byte length must be nonnegative')
            if path.stat().st_size != size:
                raise ValueError(f'Original native dependency length changed: {name}')
            descriptor = {'sha256': sha, 'bytes': size}
            if name in expected_files and expected_files[name] != descriptor:
                raise ValueError(f'Original native dependency metadata conflicts: {name}')
            expected_files[name] = descriptor
        files[name] = path

    add('workspace.json')
    add('profiles/' + profile['id'] + '.json')
    add('scenarios/' + scenario['id'] + '.json')
    grid_prefix = 'grids/' + grid['id'] + '/'
    add(grid_prefix + 'grid.json')
    for item in grid['files'].values():
        # Native describe_file stores original directory-relative `path`.
        add(grid_prefix + item['path'], item)
    # Retain the actual prepared native sidecars used by the current grid.
    from model.reuse import native_companions
    for item in native_companions(root / grid_prefix, grid['files']):
        add(grid_prefix + item['path'], item)
    for companions in grid.get('input_companions', {}).values():
        for item in companions:
            add(grid_prefix + item['path'], item)
    collections = {profile['source_collection_id'], scenario['source_collection_id'],
                   grid['spec']['source_collection_id']}
    collections.update(item['original_source_collection_id']
                       for item in grid.get('inputs', {}).values()
                       if item.get('original_source_collection_id'))
    sources = []
    for key in sorted(collections):
        source = workspace._get('sources', _identifier(key))
        sources.append(source)
        add('sources/' + key + '.json')
        bodies = [source['original_manifest']]
        for entry in source['entries']:
            bodies.extend([entry['body'], *entry.get('companions', [])])
        for body in bodies:
            add(body['object'], body)
    return {'project': workspace.project, 'selection': selection, 'grid': grid,
            'profile': profile, 'scenario': scenario, 'sources': sources}, files, expected_files


def _native_file_metadata(result: dict, run_id: str) -> dict[str, dict]:
    """Select exact file descriptors from the original completed native stages."""
    prefix = 'runs/' + run_id + '/'
    expected = {}

    def add(item):
        if not isinstance(item, dict):
            raise TypeError('Original native file metadata must be a descriptor')
        relative = safe_relative(item['path']).as_posix()
        if relative != item['path']:
            raise ValueError('Original native file metadata must use canonical paths')
        sha = check_sha(item.get('sha256'))
        size = item.get('bytes')
        if type(size) is not int or size < 0:
            raise ValueError('Original native file byte length must be nonnegative')
        name = prefix + relative
        descriptor = {'sha256': sha, 'bytes': size}
        if name in expected and expected[name] != descriptor:
            raise ValueError('Original native file descriptors conflict: ' + name)
        expected[name] = descriptor

    for item in result.get('artifacts', {}).values():
        add(item)
    for model in ('ndr', 'sdr', 'landcover'):
        stage = result.get('stages', {}).get(model)
        if stage is None:
            continue
        for field in ('arguments', 'requested_arguments', 'artifact'):
            if stage.get(field) is not None:
                add(stage[field])
        for item in stage.get('files', {}).values():
            add(item)
        for field in ('companions', 'additional_files'):
            for item in stage.get(field, []):
                add(item)
    return expected


def invoke_original_run(operator, task: dict, workspace, run_id: str) -> dict:
    """Original run.start callable: complete native result + original task receipt.

    Called inside the ORIGINAL Operator._perform gate. Retains before its success
    write. A lost success write is recovered by original job/attempt lookup, not
    by submitting another native job. Non-run actions do not enter this function.
    """
    run_id = _identifier(run_id)
    job_id = _identifier(task['id'])
    if task['action'] != 'run.start' or task['payload'].get('run_id') != run_id:
        raise ValueError('Native retention must bind the original run.start request')
    attempts = task.get('attempts', [])
    attempt = attempts[-1]['number'] if attempts else 1
    if type(attempt) is not int or attempt < 1:
        raise ValueError('Original task attempt must be positive')
    retention = retention_for(operator, workspace)
    # Look only at the original task's attempts. No alternate job registry.
    for prior in range(attempt, 0, -1):
        try:
            meta = retention.metadata(job_id, prior)
        except KeyError:
            continue
        if meta['run_id'] != run_id:
            raise ValueError('Retained task points to a different original run')
        retention.restore_native(job_id, workspace.root, prior, repair_missing=True)
        result = retention.load(job_id, prior)
        task['retention'] = {**meta, 'recovered_from_attempt': prior}
        return result

    if 'source_runs' in task['payload']:
        from model.run_assembly import seed_completed_models
        original_selection = workspace.inspect_run(run_id)['selection']
        assembled = seed_completed_models(workspace, original_selection,
                                          task['payload']['source_runs'])
        if assembled['id'] != run_id:
            raise ValueError('Completed-stage assembly changed the original selected run')

    inputs, native_files, expected_files = _selected_inputs(workspace, run_id)
    # Freeze before native execution. The immutable blob copies below are used
    # during final retention, so later source changes cannot rebind the edition.
    frozen = {}
    for name, path in native_files.items():
        sha, size = retention.store.put_file(path, expected=expected_files.get(name))
        frozen[name] = retention.store.blob_path(sha)
    result = workspace.run(run_id)  # THE ORIGINAL native.execute_run path.
    if not isinstance(result, dict) or result.get('state') != 'complete' or result.get('id') != run_id:
        raise ValueError('Original native run did not return this completed run')
    if result.get('selection') != inputs['selection']:
        raise ValueError('Native run changed its selected inputs')
    directory = Path(workspace.root) / 'runs' / run_id
    native_directories = [directory.relative_to(workspace.root).as_posix()]
    for path in sorted(directory.rglob('*')):
        if path.is_symlink():
            raise ValueError('Native run tree contains a symlink')
        if path.is_dir():
            native_directories.append(path.relative_to(workspace.root).as_posix())
        if path.is_file() and not path.name.endswith('.lock'):
            frozen[path.relative_to(workspace.root).as_posix()] = path
    if 'runs/' + run_id + '/run.json' not in frozen:
        raise ValueError('Original completed run state is missing')
    # Read actual completed stages, including the current selected-model path;
    # do not relabel an NDR-only run as if SDR also executed.
    completed_models = [name.upper() for name in ('ndr', 'sdr') if name in result.get('stages', {})]
    if not completed_models:
        raise ValueError('Original completed run has no retained native model stage')
    family = result.get('model_family', result.get('family', 'InVEST_' + '_'.join(completed_models)))
    meta = retention.retain(job_id, result, attempt=attempt,
                            model_family=family, run_id=run_id,
                            scenario_id=inputs['selection']['scenario_id'],
                            inputs={'native_inputs': inputs, 'original_request': task['payload']},
                            native_files=frozen, native_directories=tuple(native_directories),
                            native_file_metadata=_native_file_metadata(result, run_id))
    task['retention'] = meta
    return result


# Advertise the maintained run.start payload consumed above.
ORIGINAL_RUN_CAPABILITIES = {"run.start": {"source_runs": True}}


def integrate_operator(source: str | Path, *, write: bool = False) -> dict:
    """Patch only the exact known original run.start return, preserving other code.

    AST checks the enclosing Operator._invoke, its action branch, and exact call.
    Changed upstream call shapes require explicit composition rather than guesswork.
    The existing server receives a byte-for-byte backup and atomic replacement.
    """
    path = Path(source).resolve(strict=True)
    before = path.read_bytes()
    text = before.decode('utf-8')
    tree = ast.parse(text)
    classes = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Operator']
    if len(classes) != 1:
        raise ValueError('Expected the original Operator class')
    methods = [n for n in classes[0].body if isinstance(n, ast.FunctionDef) and n.name == '_invoke']
    if len(methods) != 1:
        raise ValueError('Expected the original Operator._invoke')
    target = None
    already = False
    matched_branches = 0
    comparison = ast.dump(ast.parse('action == "run.start"', mode='eval').body)
    expected = ast.dump(ast.parse('ws.run(required(value, "run_id"))', mode='eval').body)
    integrated = ast.dump(ast.parse('invoke_original_run(self, task, ws, required(value, "run_id"))', mode='eval').body)
    for node in methods[0].body:
        if isinstance(node, ast.If) and ast.dump(node.test) == comparison:
            matched_branches += 1
            if len(node.body) == 1 and isinstance(node.body[0], ast.Return) and ast.dump(node.body[0].value) == expected:
                target = node.body[0]
            elif len(node.body) == 2 and isinstance(node.body[0], ast.ImportFrom) and node.body[0].module == 'ecsa_runs.upstate' and isinstance(node.body[1], ast.Return) and ast.dump(node.body[1].value) == integrated:
                already = True
            else:
                raise ValueError('Original run.start has changed; retain its current composition')
    if matched_branches != 1:
        raise ValueError('Expected one original run.start branch')
    if already:
        return {'path': str(path), 'state': 'already_integrated', 'sha256': hashlib.sha256(before).hexdigest()}
    if target is None:
        raise ValueError('Original run.start call site was not found')
    lines = before.splitlines(keepends=True)
    start = sum(map(len, lines[:target.lineno - 1])) + target.col_offset
    end = sum(map(len, lines[:target.end_lineno - 1])) + target.end_col_offset
    indent = b' ' * target.col_offset
    newline = b'\r\n' if b'\r\n' in before else b'\n'
    replacement = b'from ecsa_runs.upstate import invoke_original_run' + newline + indent + b'return invoke_original_run(self, task, ws, required(value, "run_id"))'
    after = before[:start] + replacement + before[end:]
    ast.parse(after.decode('utf-8'))
    old_sha = hashlib.sha256(before).hexdigest()
    result = {'path': str(path), 'state': 'ready', 'before_sha256': old_sha,
              'after_sha256': hashlib.sha256(after).hexdigest(), 'changed_call_sites': 1}
    if write:
        backup = path.with_name(path.name + '.before-native-retention-' + old_sha[:12])
        if backup.exists() and backup.read_bytes() != before:
            raise ValueError('Original source backup differs')
        if not backup.exists():
            with backup.open('xb') as out:
                out.write(before); out.flush(); os.fsync(out.fileno())
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.native-compose-', delete=False) as out:
            pending = Path(out.name)
            out.write(after); out.flush(); os.fsync(out.fileno())
        try:
            os.chmod(pending, path.stat().st_mode & 0o777)
            if path.read_bytes() != before:
                raise RuntimeError('Original source changed during composition')
            os.replace(pending, path)
        finally:
            pending.unlink(missing_ok=True)
        result.update(state='integrated', backup=str(backup))
    return result

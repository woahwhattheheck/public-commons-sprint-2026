"""Capture exact provider/input editions and execute the original parsed_model seam.

This module deliberately contains no watershed equations or model substitutes.
The provider supplied by the application remains the scientific implementation.
"""
from __future__ import annotations
import copy
import importlib.util
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import uuid
from typing import Any
from .store import RunStore, digest

SKIP_DIRS = {'.git', '.venv', 'venv', '__pycache__', '.pytest_cache', 'node_modules', '.ecsa-runs'}

def safe_relative(value: str) -> Path:
    p = PurePosixPath(value)
    if p.is_absolute() or not p.parts or any(x in ('..', '') for x in p.parts) or '\\' in value:
        raise ValueError(f'Unsafe relative path: {value!r}')
    return Path(*p.parts)

def _inside(path: Path, root: Path) -> bool:
    try: path.relative_to(root); return True
    except ValueError: return False

def _capture_tree(store: RunStore, root: Path, prefix: str) -> list[dict]:
    files = []
    if not root.is_dir(): raise FileNotFoundError(root)
    if _inside(root, store.root): raise ValueError('Source root cannot be the run workspace')
    for parent, dirs, names in os.walk(root, followlinks=False):
        parent = Path(parent)
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and
                         not _inside((parent / d).resolve(), store.root))
        for d in dirs:
            if (parent / d).is_symlink():
                raise ValueError(f'Snapshot directory symlink must be resolved explicitly: {parent / d}')
        for name in sorted(names):
            path = parent / name
            if name.endswith(('.pyc', '.pyo')): continue
            # Local credentials and environment files are not model source.
            if name == '.env' or name.startswith('.env.') or name in {'.netrc', '.git-credentials'}: continue
            if path.is_symlink(): raise ValueError(f'Snapshot file symlink must be resolved explicitly: {path}')
            before = path.stat()
            sha, size = store.put_file(path)
            files.append({'path': prefix + '/' + path.relative_to(root).as_posix(),
                          'sha256': sha, 'bytes': size, 'mode': before.st_mode & 0o777})
    return files

def capture_provider(store: RunStore, provider_file: str | Path, data_dir: str | Path,
                     code_root: str | Path | None = None) -> str:
    """Freeze the complete local provider tree and data tree, returning a manifest hash.

    Installed dependencies are not vendored; keep the application's environment.
    All regular files are retained, including native libraries and model formats.
    The workspace, caches, VCS metadata and credential-dotfiles are excluded.
    """
    provider = Path(provider_file).resolve(strict=True)
    root = Path(code_root).resolve(strict=True) if code_root else provider.parent
    data = Path(data_dir).resolve(strict=True)
    if not _inside(provider, root): raise ValueError('Provider must be inside code_root')
    files = _capture_tree(store, root, 'code')
    if _inside(data, root):
        data_rel = 'code/' + data.relative_to(root).as_posix()
    else:
        files += _capture_tree(store, data, 'data')
        data_rel = 'data'
    manifest = {'format': 'ecsa-provider-v1', 'entry': 'code/' + provider.relative_to(root).as_posix(),
                'code_dir': 'code', 'data_dir': data_rel, 'original_code_dir': str(root),
                'original_data_dir': str(data), 'files': sorted(files, key=lambda x: x['path'])}
    if manifest['entry'] not in {x['path'] for x in files}: raise ValueError('Provider entry was excluded')
    return store.put(manifest)

def _pointer(parent: Any, pointer: str) -> tuple[Any, Any]:
    if not pointer.startswith('/') or pointer == '/': raise ValueError('File fields use JSON pointers, e.g. /weather_csv')
    parts = [s.replace('~1', '/').replace('~0', '~') for s in pointer[1:].split('/')]
    for part in parts[:-1]: parent = parent[int(part)] if isinstance(parent, list) else parent[part]
    key = int(parts[-1]) if isinstance(parent, list) else parts[-1]
    return parent, key

def submit_run(store: RunStore, snapshot_sha: str, family: str, inputs: dict,
               name: str = 'Baseline', kind: str = 'baseline',
               file_fields: tuple[str, ...] | list[str] = ('/weather_csv',),
               request_key: str | None = None, max_attempts: int = 2,
               timeout_seconds: float | None = None, input_base: str | Path | None = None,
               result_file_fields: tuple[str, ...] | list[str] = ()) -> dict:
    """Queue an immutable run. Only declared file fields are rebound; labels stay labels."""
    snapshot = store.read(snapshot_sha)
    if snapshot.get('format') != 'ecsa-provider-v1': raise ValueError('Unsupported provider snapshot')
    if timeout_seconds is not None and timeout_seconds <= 0: raise ValueError('timeout_seconds must be positive')
    inputs = copy.deepcopy(inputs)
    bindings = []
    base = Path(input_base or snapshot['original_code_dir']).resolve()
    for pointer in file_fields:
        try: parent, key = _pointer(inputs, pointer)
        except KeyError: continue
        value = parent.get(key) if isinstance(parent, dict) else parent[key]
        if value is None or value == '': continue
        if not isinstance(value, (str, Path)): raise TypeError(f'{pointer} must be a local file path')
        path = Path(value).expanduser()
        path = (base / path).resolve(strict=True) if not path.is_absolute() else path.resolve(strict=True)
        sha, size = store.put_file(path)
        bindings.append({'pointer': pointer, 'sha256': sha, 'bytes': size,
                         'name': path.name, 'original_path': str(path)})
        # Preserve input text as entered; replacement happens only inside the worker.
    spec = {'format': 'ecsa-run-v1', 'snapshot_sha': snapshot_sha, 'family': family,
            'name': name, 'kind': kind, 'inputs': inputs, 'file_bindings': bindings,
            'timeout_seconds': timeout_seconds, 'result_file_fields': list(result_file_fields)}
    return store.submit(spec, request_key=request_key, max_attempts=max_attempts)

class ProviderSession:
    """One exact provider edition per process. RunStore supervisor rotates on changes."""
    def __init__(self, store: RunStore, snapshot_sha: str, session_id: str | None = None):
        self.store, self.snapshot_sha = store, snapshot_sha
        self.snapshot = store.read(snapshot_sha)
        self.root = store.root / 'execution' / (session_id or uuid.uuid4().hex)
        self.root.mkdir(parents=True, exist_ok=False)
        self.file_hashes = {item['path']: item['sha256'] for item in self.snapshot['files']}
        for item in self.snapshot['files']:
            target = self.root / safe_relative(item['path'])
            target.parent.mkdir(parents=True, exist_ok=True)
            store.copy_blob(item['sha256'], target)
            target.chmod(item['mode'] & 0o777)
        self.code = self.root / safe_relative(self.snapshot['code_dir'])
        self.data = self.root / safe_relative(self.snapshot['data_dir'])
        self.previous_cwd = Path.cwd()
        self.previous_path = sys.path[:]
        os.chdir(self.code)
        sys.path.insert(0, str(self.code))
        entry = self.root / safe_relative(self.snapshot['entry'])
        # The original module name is preserved for native imports and decorators.
        rel = entry.relative_to(self.code).with_suffix('')
        self.module_name = '.'.join(rel.parts)
        if self.module_name.endswith('.__init__'): self.module_name = self.module_name[:-9]
        spec = importlib.util.spec_from_file_location(self.module_name, entry)
        if spec is None or spec.loader is None: raise ImportError(entry)
        self.module = importlib.util.module_from_spec(spec)
        sys.modules[self.module_name] = self.module
        spec.loader.exec_module(self.module)
        self.count = 0
        self.source_stats = {r: self._stat(self.root / safe_relative(r)) for r in self.file_hashes}

    @staticmethod
    def _stat(path):
        s = path.stat()
        return s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_ino

    def execute(self, spec: dict, job: dict) -> dict:
        if spec['snapshot_sha'] != self.snapshot_sha: raise ValueError('Worker edition mismatch')
        # A model may create cache files, but it may not silently change its frozen inputs.
        for relative, expected in self.file_hashes.items():
            path = self.root / safe_relative(relative)
            if not path.exists() or self._stat(path) != self.source_stats[relative]:
                raise RuntimeError(f'Provider modified captured source/input: {relative}; use a separate cache path')
        inputs = copy.deepcopy(spec['inputs'])
        binding_dir = self.root / 'bound-inputs' / job['id'] / str(job['attempt'])
        for i, binding in enumerate(spec.get('file_bindings', [])):
            target = binding_dir / str(i) / Path(binding['name']).name
            target.parent.mkdir(parents=True, exist_ok=True)
            self.store.copy_blob(binding['sha256'], target)
            parent, key = _pointer(inputs, binding['pointer'])
            parent[key] = str(target)
        method = 'run_scenario' if spec['kind'] == 'scenario' else 'run_model'
        function = getattr(self.module, method, None)
        if not callable(function): raise AttributeError(f'Provider has no callable {method}')
        if method == 'run_scenario':
            result = function(spec['family'], inputs, scenario_name=spec['name'], data_dir=str(self.data))
        else:
            result = function(spec['family'], inputs, data_dir=str(self.data))
        if not isinstance(result, dict): raise TypeError('Original model provider must return a result dictionary')
        if result.get('family') != spec['family']: raise ValueError('Result family differs from requested model family')
        if not result.get('run_id'): raise ValueError('Provider result has no run_id')
        for relative in self.file_hashes:
            path = self.root / safe_relative(relative)
            if not path.exists() or self._stat(path) != self.source_stats[relative]:
                raise RuntimeError(f'Provider modified captured source/input during run: {relative}')
        self.count += 1
        result = dict(result)
        if '_ecsa_execution' in result: raise ValueError('Reserved result key _ecsa_execution already exists')
        result['_ecsa_execution'] = {'job_id': job['id'], 'attempt': job['attempt'],
            'snapshot_sha': self.snapshot_sha, 'spec_sha': job['spec_sha'], 'worker_pid': os.getpid(),
            'worker_run_number': self.count, 'original_inputs': spec['inputs'],
            'file_bindings': spec.get('file_bindings', []), 'provider_method': method}
        from .artifacts import retain_artifacts
        result['_ecsa_execution']['result_artifacts'] = retain_artifacts(
            self.store, result, spec.get('result_file_fields', []), self.code)
        return result

    def close(self):
        os.chdir(self.previous_cwd)
        sys.path[:] = self.previous_path
        # Worker processes terminate before another edition is imported; do not try to
        # unload ctypes handles or provider state into a different scientific edition.
        shutil.rmtree(self.root, ignore_errors=True)

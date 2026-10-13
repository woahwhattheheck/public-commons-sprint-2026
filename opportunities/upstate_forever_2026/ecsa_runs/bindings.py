"""Original BC10 NativeInputManifest receiving and narrow source repair.

This validates file identity, not the scientific suitability of the inputs. The
application's native-family validator still decides scientific/model readiness.
"""
from __future__ import annotations
import ast
from dataclasses import asdict, is_dataclass
import hashlib
import json
import os
from pathlib import Path
import tempfile
from .provider import submit_run


def submit_manifest(store, snapshot_sha: str, manifest, *, name: str | None = None,
                    asset_root=None, request_key=None, result_file_fields=(), **options):
    """Receive the existing BC10 dataclass or its JSON form, with no family rewriting.

    The provider receives the entire manifest as ``inputs``. Declare an original-
    app provider wrapper that reads that same manifest; never map assets to knobs
    by guessing filenames. Rebinding preserves each explicit binding_role.
    """
    body = asdict(manifest) if is_dataclass(manifest) else dict(manifest)
    # Copy recursively into ordinary JSON so an asset dataclass cannot be mutated.
    body = json.loads(json.dumps(body))
    for key in ('project_id', 'manifest_id', 'model_family', 'assets', 'knobs'):
        if key not in body: raise ValueError(f'NativeInputManifest lacks {key}')
    if not body['model_family']: raise ValueError('model_family is required')
    if body.get('validation', {}).get('ready') is False:
        raise ValueError('Native manifest requires inputs: ' + str(body['validation'].get('missing_roles', [])))
    seen, pointers = set(), []
    for i, asset in enumerate(body['assets']):
        identity = asset['asset_id']
        if identity in seen: raise ValueError(f'Duplicate native asset ID: {identity}')
        seen.add(identity)
        path = Path(asset['stored_path']).expanduser()
        if not path.is_absolute():
            if asset_root is None: raise ValueError('Relative native assets require asset_root')
            path = Path(asset_root) / path
        path = path.resolve(strict=True)
        actual, size = store.put_file(path)
        if asset.get('sha256') != actual or asset.get('size_bytes') != size:
            raise ValueError(f'Native asset has changed since preview: {identity}')
        # Original labels/roles/IDs and hash remain exactly as supplied.
        asset['stored_path'] = str(path)
        pointers.append(f'/assets/{i}/stored_path')
    scenario = body.get('scenario_id')
    return submit_run(store, snapshot_sha, body['model_family'], body,
                      name=name or scenario or 'Baseline', kind='scenario' if scenario else 'baseline',
                      file_fields=pointers, request_key=request_key,
                      result_file_fields=result_file_fields, **options)


def repair_bc10_source(path: str | Path, *, write=False) -> dict:
    """Patch only the observed mixed-case required-role lookup and iterator reuse.

    Parse the *complete local source*, preserve unrelated and unseen functions,
    keep a content-addressed backup, and refuse a raced write. Repeat-safe.
    """
    path = Path(path).resolve(strict=True)
    raw = path.read_bytes(); text = raw.decode('utf-8')
    tree = ast.parse(text)
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'validate_native_bindings']
    if len(functions) != 1: raise ValueError('Expected exactly one validate_native_bindings function')
    function = functions[0]
    lines = text.splitlines(keepends=True)
    offsets = [0]
    for line in lines: offsets.append(offsets[-1] + len(line.encode('utf-8')))
    def span(node):
        return offsets[node.lineno-1]+node.col_offset, offsets[node.end_lineno-1]+node.end_col_offset
    edits = []
    # Change only keys in the role dictionary used by the uppercased-family lookup.
    lookups = [n for n in ast.walk(function) if isinstance(n, ast.Call)
               and isinstance(n.func, ast.Attribute) and n.func.attr == 'get'
               and isinstance(n.func.value, ast.Dict) and n.args
               and isinstance(n.args[0], ast.Call) and isinstance(n.args[0].func, ast.Attribute)
               and n.args[0].func.attr == 'upper']
    if len(lookups) != 1: raise ValueError('Native-binding lookup structure has changed; inspect before composing')
    for key in lookups[0].func.value.keys:
        if isinstance(key, ast.Constant) and isinstance(key.value, str) and key.value != key.value.upper():
            a,b = span(key); edits.append((a,b,repr(key.value.upper()).encode()))
    materialized = any(isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id=='assets' for t in n.targets)
                       and isinstance(n.value, ast.Call) and isinstance(n.value.func, ast.Name)
                       and n.value.func.id=='list' and len(n.value.args)==1
                       and isinstance(n.value.args[0], ast.Name) and n.value.args[0].id=='assets'
                       for n in function.body)
    if not materialized:
        body = function.body
        first = body[1] if isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value,str) else body[0]
        pos=offsets[first.lineno-1]
        indent=lines[first.lineno-1][:first.col_offset]
        ending='\r\n' if '\r\n' in text else '\n'
        edits.append((pos,pos,(indent+'assets = list(assets)'+ending).encode()))
    changed = raw
    for a,b,replacement in sorted(edits,reverse=True): changed=changed[:a]+replacement+changed[b:]
    ast.parse(changed)
    before=hashlib.sha256(raw).hexdigest(); after=hashlib.sha256(changed).hexdigest()
    backup=None
    if edits and write:
        backup=path.with_name(path.name+'.before-'+before[:12])
        if backup.exists() and backup.read_bytes()!=raw: raise ValueError('Conflicting source backup')
        if not backup.exists():
            with backup.open('xb') as f: f.write(raw);f.flush();os.fsync(f.fileno())
        fd,tmp=tempfile.mkstemp(dir=path.parent,prefix='.'+path.name)
        try:
            with os.fdopen(fd,'wb') as f: f.write(changed);f.flush();os.fsync(f.fileno())
            os.chmod(tmp,path.stat().st_mode & 0o777)
            if path.read_bytes()!=raw: raise RuntimeError('Source changed while composing repair')
            os.replace(tmp,path)
        finally:
            if os.path.exists(tmp): os.unlink(tmp)
    return {'path':str(path),'changed':bool(edits),'written':bool(edits and write),
            'before_sha256':before,'after_sha256':after,'backup':str(backup) if backup else None,
            'edits':len(edits)}

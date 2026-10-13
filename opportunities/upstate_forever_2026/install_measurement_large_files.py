#!/usr/bin/env python3
"""Install complete large-file Measurements into the original maintained application.

Exact changed hunks are composed into existing files; unrelated code and original
scientific modules are retained. The same command completes interrupted installs.
"""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile

VERSION = '1.2.2'
MANIFEST = 'MEASUREMENT_LARGE_FILES_SOURCE.json'
ALIASES = {'workspace.js': 'measured_observations.mjs', 'workspace.css': 'measured_observations.css',
           'extension.mjs': 'measured_observations_extension.mjs', 'collections.mjs': 'measured_collections.mjs',
           'large_files.mjs': 'measured_large_files.mjs', 'chemistry.mjs': 'measured_chemistry.mjs'}


def digest(data): return hashlib.sha256(data).hexdigest()


def member(root, name):
    if not isinstance(name, str) or not name or '\\' in name or any(x in {'', '.', '..'} for x in name.split('/')):
        raise ValueError('Expected a relative source member')
    target = root / name
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError('Source member escapes the application')
    current = target
    while current != root:
        if current.is_symlink(): raise ValueError('Installation crosses a symlink: ' + name)
        current = current.parent
    return target


def compose(text, operations, name):
    if isinstance(operations, dict):
        failures = []
        for variant in operations['variants']:
            try:
                return compose(text, variant['operations'], name)
            except ValueError as error:
                failures.append(str(error))
        raise ValueError('No original source edition matched for ' + name + ': ' + '; '.join(failures))
    for operation in operations:
        old, new = operation['old'], operation['new']
        if new and text.count(new) == 1:
            continue
        if old:
            if text.count(old) == 1:
                text = text.replace(old, new, 1)
            elif new and text.count(new) == 1:
                continue
            else:
                raise ValueError('A concurrently changed source needs this exact hunk joined: ' + name + ' / ' + old[:100])
        elif new in text:
            continue
        else:
            after, before = operation['after'], operation['before']
            if after and text.count(after) == 1:
                text = text.replace(after, new + after, 1)
            elif before and text.count(before) == 1:
                text = text.replace(before, before + new, 1)
            else:
                raise ValueError('Insertion context changed: ' + name)
    return text


def install(application, source_root=None, *, standalone=False, dry_run=False):
    root = Path(application).resolve(strict=True)
    source = Path(source_root or Path(__file__).parent).resolve(strict=True)
    # Complete scientific releases use the single current guarded component writer.
    # The original standalone large-file installer remains available below.
    combined = source / "integration/measurements/INSTALLATION.json"
    if not standalone and combined.is_file():
        import importlib.util
        implementation = source / "operator/install_measurements.py"
        spec = importlib.util.spec_from_file_location("_upstate_complete_measurements_installer", implementation)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.install(root, source, check=dry_run)
    if not standalone and not (root / 'operator/extension_registry.py').is_file():
        raise ValueError('Select the original extension-registry application, or use --standalone for the original CLI')
    inventory = json.loads((source / MANIFEST).read_text('utf-8'))
    rows = {row['path']: row for row in inventory['files']}
    bodies = {}
    for name, row in rows.items():
        body = member(source, name).read_bytes()
        if len(body) != row['bytes'] or digest(body) != row['sha256']:
            raise ValueError('Complete source inventory differs: ' + name)
        bodies[name] = body
    recipes = json.loads(bodies['measurement_workspace/large_file_patches.json'])
    chosen = {n: b for n, b in bodies.items() if n.startswith('measurement_workspace/') or
              n in {'operator/extensions/measured-observations.json', 'integration/component_fragments/measurement-large-files.json', 'MEASUREMENT_LARGE_FILES.md', 'install_measurement_large_files.py'}}
    lockroot = member(root, '.locks'); lockroot.mkdir(exist_ok=True)
    lock = sqlite3.connect(lockroot / 'measurement-large-files.sqlite', timeout=5)
    lock.execute('BEGIN IMMEDIATE')
    try:
        previous_path = member(root, MANIFEST)
        previous = json.loads(previous_path.read_text('utf-8')) if previous_path.is_file() else {}
        predecessors = {row['path']: row['sha256'] for row in previous.get('files', [])}
        before, prepared, preserved, reused = {}, {}, [], []
        for name, body in chosen.items():
            target = member(root, name)
            if not target.exists(): prepared[name] = body; continue
            old = target.read_bytes(); before[name] = old
            if old == body: reused.append(name); continue
            if name in recipes:
                result = compose(old.decode('utf-8'), recipes[name], name).encode('utf-8')
                if result == old: reused.append(name)
                else: prepared[name] = result
            elif digest(old) == predecessors.get(name) and rows[name]['role'] != 'native':
                prepared[name] = body
            elif rows[name]['role'] == 'native':
                preserved.append(name)
            else:
                raise ValueError('Different existing extension file was retained: ' + name)
        # Keep peer routes/capabilities, while registering this extension's own asset.
        descriptor_name = 'operator/extensions/measured-observations.json'
        descriptor_target = member(root, descriptor_name)
        descriptor_body = prepared.get(descriptor_name)
        if descriptor_body is None:
            descriptor_body = descriptor_target.read_bytes() if descriptor_target.exists() else bodies[descriptor_name]
        descriptor = json.loads(descriptor_body)
        if descriptor.get('id') != 'measured-observations':
            raise ValueError('Unexpected Measurements descriptor identity')
        if 'measured_large_files.mjs' not in descriptor.setdefault('assets', []):
            descriptor['assets'].append('measured_large_files.mjs')
            prepared[descriptor_name] = (json.dumps(descriptor, indent=2) + '\n').encode()
            reused = [name for name in reused if name != descriptor_name]
            preserved = [name for name in preserved if name != descriptor_name]
        # Mirror the composed existing UI, not a replacement of a peer's controller.
        for filename, alias in ALIASES.items():
            original = 'measurement_workspace/web/' + filename
            destination = 'operator/web/' + alias
            native = prepared.get(original)
            if native is None: native = member(root, original).read_bytes() if member(root, original).exists() else bodies[original]
            if filename == 'extension.mjs':
                text = native.decode('utf-8')
                for source_name, installed_name in {**ALIASES, 'chemistry.mjs': 'measured_chemistry.mjs'}.items():
                    text = text.replace("from './" + source_name + "'", "from './" + installed_name + "'")
                    text = text.replace('from "./' + source_name + '"', 'from "./' + installed_name + '"')
                native = text.encode('utf-8')
            target = member(root, destination)
            if target.exists():
                old = target.read_bytes(); before[destination] = old
                if old == native: reused.append(destination); continue
                if original in recipes:
                    result = compose(old.decode('utf-8'), recipes[original], destination).encode('utf-8')
                    if result != native:
                        # Both native and alias may carry distinct peer additions.
                        native = result
                elif original in before and old == before[original]:
                    pass
                elif rows[original]['role'] == 'native':
                    preserved.append(destination); continue
                else: raise ValueError('Different browser extension source retained: ' + destination)
            prepared[destination] = native
        installed_rows = []
        for name, row in rows.items():
            body = prepared.get(name)
            if body is None:
                target = member(root, name)
                body = target.read_bytes() if target.exists() else bodies[name]
            installed_rows.append({**row, 'sha256': digest(body), 'bytes': len(body)})
        installed_inventory = {**inventory, 'files': installed_rows,
                               'origin_manifest_sha256': inventory.get('origin_manifest_sha256', digest((source / MANIFEST).read_bytes()))}
        manifest_body = (json.dumps(installed_inventory, indent=2) + '\n').encode()
        if previous_path.exists():
            before[MANIFEST] = previous_path.read_bytes()
            if before[MANIFEST] == manifest_body: reused.append(MANIFEST)
            else: prepared[MANIFEST] = manifest_body
        else: prepared[MANIFEST] = manifest_body
        for name, body in prepared.items():
            if name.endswith('.py'): ast.parse(body.decode('utf-8'), filename=name)
            elif name.endswith('.json'): json.loads(body)
        created = sorted(n for n in prepared if n not in before)
        upgraded = sorted(n for n in prepared if n in before)
        result = {'format': 'upper-savannah-measurement-large-install/v1', 'version': VERSION,
                  'application': str(root), 'dry_run': dry_run, 'created': created, 'upgraded': upgraded,
                  'reused': sorted(set(reused)), 'preserved': sorted(set(preserved)),
                  'changed_files': [{'path': n, 'bytes': len(b), 'sha256': digest(b)} for n, b in sorted(prepared.items())]}
        if dry_run: return result
        def order(name):
            if name == MANIFEST: return 10
            if name == 'operator/extensions/measured-observations.json': return 9
            if name.startswith('operator/web/'): return 8
            if name.endswith('/web/extension.mjs') or name.endswith('/extension.py'): return 7
            if name.endswith('/engine/cli.mjs') or name.endswith('/engine/http.mjs'): return 6
            if name.endswith('/engine/workspace.mjs'): return 5
            return 1
        changed = []
        with tempfile.TemporaryDirectory(prefix='.measurement-large-install-', dir=root) as temporary:
            stage = Path(temporary)
            try:
                for name, body in prepared.items():
                    target = member(stage, name); target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open('xb') as stream:
                        stream.write(body); stream.flush(); os.fsync(stream.fileno())
                for name in sorted(prepared, key=lambda n: (order(n), n)):
                    target = member(root, name); target.parent.mkdir(parents=True, exist_ok=True)
                    if name in before:
                        if target.read_bytes() != before[name]: raise ValueError('Source changed during installation: ' + name)
                        os.replace(member(stage, name), target)
                    else:
                        os.link(member(stage, name), target)
                    changed.append(name)
            except Exception:
                for name in reversed(changed):
                    target = member(root, name)
                    if target.exists() and target.read_bytes() == prepared[name]:
                        if name in before:
                            recovery = member(stage, name + '.rollback'); recovery.write_bytes(before[name]); os.replace(recovery, target)
                        else: target.unlink()
                raise
        return result
    finally:
        lock.rollback(); lock.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--application', required=True, type=Path)
    parser.add_argument('--source-root', type=Path)
    parser.add_argument('--standalone', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    options = parser.parse_args()
    print(json.dumps(install(options.application, options.source_root, standalone=options.standalone, dry_run=options.dry_run), indent=2))

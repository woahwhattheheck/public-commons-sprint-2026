#!/usr/bin/env python3
"""Join the supplied root Python/Node/Excel payloads to a scientific descriptor.

Run from the maintained application source, against the existing collection.
Payloads are read in place. Scientific archives, source origins and Workspace
selections are retained. The resulting fragment also lets the final assembler
consume all three completed dependency arms before its scientific packs arrive.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import uuid

TARGETS = ('windows-x86_64', 'macos-x86_64', 'macos-arm64')
HASH = re.compile(r'[0-9a-f]{64}\Z')
SCHEMA = 'upstate.root-dependencies/v1'


def _bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')


def _module(path):
    name = '_ecosystem_root_dependency_preparer'
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError('The maintained root dependency preparer is missing')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _descriptor(root, filename, schema, prep):
    path = prep.bundle_member(root, filename)
    content = path.read_bytes()
    prep.checked(path, (len(content), hashlib.sha256(content).hexdigest()))
    value = json.loads(content)
    if not isinstance(value, dict) or value.get('schema') != schema:
        raise ValueError('Unsupported supplied descriptor: ' + filename)
    return value, {'path': filename, 'bytes': len(content),
                   'sha256': hashlib.sha256(content).hexdigest()}


def _payload(root, row, prep):
    if not isinstance(row, dict):
        raise ValueError('A supplied dependency record is not an object')
    size, digest = row.get('bytes'), row.get('sha256')
    if type(size) is not int or size < 0 or not isinstance(digest, str) or not HASH.fullmatch(digest):
        raise ValueError('A supplied dependency has an invalid size or checksum')
    path = prep.bundle_member(root, row.get('path'))
    prep.checked(path, (size, digest))
    return path


def _publish(root, filename, body, prep, *, previous=None):
    fs = prep._FILESYSTEM
    path = fs.native_path(root / filename)
    if path.exists() or path.is_symlink():
        prep.bundle_member(root, filename)
        current = path.read_bytes()
        prep.checked(path, (len(current), hashlib.sha256(current).hexdigest()))
        if current == body:
            return False
        if previous is None:
            raise ValueError('Preserved a different existing descriptor: ' + filename)
        prep.checked(path, (len(previous), hashlib.sha256(previous).hexdigest()))
    elif previous is not None:
        raise ValueError('The selected runtime descriptor disappeared while composing')
    staging = path.with_name('.' + filename + '.' + uuid.uuid4().hex)
    try:
        with os.fdopen(fs.open_file(staging, os.O_WRONLY | os.O_CREAT | os.O_EXCL), 'wb') as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        if previous is None:
            try:
                fs.publish_file(staging, path)
            except FileExistsError:
                prep.checked(path, (len(body), hashlib.sha256(body).hexdigest()))
        else:
            # Recheck immediately before the completed atomic replacement.
            prep.checked(path, (len(previous), hashlib.sha256(previous).hexdigest()))
            fs.replace(staging, path)
        fs.sync_directory(root)
    finally:
        staging.unlink(missing_ok=True)
    return True


def compose(collection: Path, application: Path, *, apply=False):
    """Verify supplied original bytes and compose only root dependency fields.

    With apply=True, merge into each existing science-platform row. Unfinished
    science targets are returned as pending keys, never invented as runnable
    environments. Run the same command after attaching those native descriptors;
    matching fragments and matching runtime records are reused byte-for-byte.
    """
    root, application = collection.resolve(strict=True), application.resolve(strict=True)
    prep = _module(Path(__file__).with_name('prepare_runtime_dependencies.py'))
    prep.portable_fs(application)
    fs = prep._FILESYSTEM
    root = fs.native_path(root)
    from source_tools.native_runtime.binary_dependencies import inspect
    with fs.locked(root / '.root-dependencies-composition.lock'):
        boot, boot_origin = _descriptor(root, 'BOOTSTRAPS.json', 'upstate.bootstrap-payloads/v1', prep)
        node, node_origin = _descriptor(root, 'NODE_DEPENDENCIES.json', 'ecosystem-node-dependencies/1', prep)
        platforms, images, inventory_names = {}, {}, []
        for target in TARGETS:
            bootstrap = boot.get('platforms', {}).get(target)
            selected_node = node.get('platforms', {}).get(target)
            if not isinstance(bootstrap, dict) or not isinstance(selected_node, dict):
                raise ValueError('The supplied dependency set is missing ' + target)
            directory = prep.bundle_member(root, bootstrap.get('directory'))
            files = bootstrap.get('files')
            if not isinstance(files, list) or not files:
                raise ValueError('The supplied bootstrap has no original inventory: ' + target)
            fs.validate_members([row.get('path') for row in files], portable=True)
            names, total = set(), 0
            for row in files:
                _payload(directory, row, prep)
                if row['path'] in names:
                    raise ValueError('Repeated bootstrap inventory member: ' + row['path'])
                names.add(row['path']); total += row['bytes']
                inventory_names.append(bootstrap['directory'] + '/' + row['path'])
            if (bootstrap.get('file_count') != len(files) or bootstrap.get('total_bytes') != total
                    or bootstrap.get('python') not in names):
                raise ValueError('The bootstrap count, size or interpreter differs: ' + target)
            expected_format = 'pe' if target.startswith('windows-') else 'mach-o'
            expected_arch = 'arm64' if target.endswith('-arm64') else 'x86_64'
            binaries = {'bootstrap': directory / bootstrap['python']}
            dependencies = selected_node.get('dependencies')
            if not isinstance(dependencies, dict):
                raise ValueError('The supplied Node selection has no dependency records')
            for key in ('node', 'node_license'):
                path = _payload(root, dependencies.get(key), prep)
                inventory_names.append(dependencies[key]['path'])
                if key == 'node':
                    binaries['node'] = path
            target_images = {}
            for key, path in binaries.items():
                found = inspect(path)
                if not any(image.format == expected_format and image.architecture == expected_arch
                           and image.kind == 'executable' for image in found):
                    raise ValueError('The original ' + key + ' executable does not match ' + target)
                target_images[key] = [image.to_dict() for image in found]
            images[target] = target_images
            platforms[target] = {'bootstrap': copy.deepcopy(bootstrap),
                                 'dependencies': copy.deepcopy(dependencies)}
        if node.get('node_version') != '22.16.0':
            raise ValueError('Keep the selected original Node 22.16.0 dependency')
        wheels = node.get('workbook_dependencies')
        if not isinstance(wheels, list):
            raise ValueError('The supplied workbook wheels are missing')
        by_name = {row.get('distribution'): row for row in wheels}
        if len(by_name) != len(wheels):
            raise ValueError('Duplicate workbook dependency distribution')
        for name, version, relative in prep.WHEELS:
            row = by_name.get(name)
            if (not isinstance(row, dict) or row.get('version') != version or row.get('path') != relative
                    or (row.get('bytes'), row.get('sha256')) != prep.PAYLOADS[relative]):
                raise ValueError('The supplied original workbook wheel differs: ' + name)
            _payload(root, row, prep); inventory_names.append(relative)
        for row in node.get('license_files', []):
            _payload(root, row, prep); inventory_names.append(row['path'])
        fs.validate_members(inventory_names, portable=True)
        fragment = {'schema': SCHEMA, 'platforms': platforms, 'workbook_dependencies': wheels,
                    'native_images': images, 'source_descriptors': [boot_origin, node_origin]}
        written = _publish(root, 'ROOT_DEPENDENCIES.json', _bytes(fragment), prep)
        applied, pending, runtime_written = [], list(TARGETS), False
        manifest = root / 'NATIVE_RUNTIME.json'
        if apply and (manifest.exists() or manifest.is_symlink()):
            manifest = prep.bundle_member(root, 'NATIVE_RUNTIME.json')
            original = manifest.read_bytes()
            prep.checked(manifest, (len(original), hashlib.sha256(original).hexdigest()))
            current = json.loads(original)
            if (not isinstance(current, dict) or current.get('schema') != 'upstate.offline-native-runtime/v2'
                    or not isinstance(current.get('platforms'), dict)):
                raise ValueError('Keep the original scientific descriptor; compose its v2 platform rows first')
            merged = copy.deepcopy(current)
            for target in TARGETS:
                row = merged['platforms'].get(target)
                if row is None:
                    continue
                if not isinstance(row, dict) or not isinstance(row.get('archive'), dict) or not row.get('python'):
                    raise ValueError('Complete the existing scientific descriptor for ' + target)
                row['bootstrap'] = copy.deepcopy(platforms[target]['bootstrap'])
                deps = row.setdefault('dependencies', {})
                if not isinstance(deps, dict):
                    raise ValueError('Invalid existing dependency map for ' + target)
                deps.update(copy.deepcopy(platforms[target]['dependencies']))
                applied.append(target); pending.remove(target)
            if merged != current:
                runtime_written = _publish(root, 'NATIVE_RUNTIME.json', _bytes(merged), prep, previous=original)
        return {'schema': SCHEMA, 'prepared_platforms': list(TARGETS), 'payload_files': len(inventory_names),
                'fragment_written': written, 'runtime_manifest_written': runtime_written,
                'applied_platforms': applied, 'pending_scientific_platforms': pending}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collection', required=True, type=Path)
    parser.add_argument('--application', type=Path)
    parser.add_argument('--apply', action='store_true', help='Attach to the existing scientific runtime rows')
    args = parser.parse_args()
    application = args.application or args.collection / 'application'
    print(json.dumps(compose(args.collection, application, apply=args.apply), sort_keys=True))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, KeyError, TypeError) as error:
        print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
        raise SystemExit(2)

#!/usr/bin/env python3
"""Capture explicitly listed GIS deliverables and run the original audit on the copy."""
from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys

from delivery_snapshot import (DEFAULT_LIMITS, MAX_INDEX_BYTES, MAX_MANIFEST_BYTES,
                               capture_delivery, capture_limits, fingerprint,
                               relative_path, verify_capture)
from handoff_view import render_handoff

HERE = Path(__file__).resolve().parent


def require(ok, detail):
    if not ok:
        raise ValueError(detail)


def unique_object(pairs):
    obj = {}
    for key, value in pairs:
        require(key not in obj, 'JSON contains a duplicate object key')
        obj[key] = value
    return obj


def reject_constant(_value):
    raise ValueError('Nonfinite JSON numbers are unsupported')


def read_regular(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= limit,
                'Input must be a regular file within its documented byte limit')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(limit + 1)
        after = os.fstat(fd)
        require(len(raw) <= limit, 'Input exceeds its byte limit')
        require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'Input changed while reading')
        return raw
    finally:
        os.close(fd)


def parse_json(raw):
    return json.loads(raw.decode('utf-8-sig'), object_pairs_hook=unique_object,
                      parse_constant=reject_constant)


def original_ids(filename, name):
    """Use original role IDs without importing Rasterio just to enumerate files."""
    tree = ast.parse((HERE / filename).read_text(encoding='utf-8'))
    assignments = [node for node in tree.body if isinstance(node, ast.Assign) and
                   any(isinstance(target, ast.Name) and target.id == name for target in node.targets)]
    require(len(assignments) == 1, 'Original audit role declaration is unavailable: ' + name)
    values = ast.literal_eval(assignments[0].value)
    require(isinstance(values, tuple) and values and all(isinstance(v, str) for v in values),
            'Original audit role declaration has changed: ' + name)
    return values


def collect_references(data, *, limits=None):
    limits = capture_limits(limits)
    require(isinstance(data, dict) and data.get('schema') in (
            'upstate-ec-sdc-2026/delivery-v1', 'commons.native-study-delivery/v1'),
            'Choose an original regional RFP or explicit native-study delivery manifest')
    study = data['schema'] == 'commons.native-study-delivery/v1'
    if study:
        require(data.get('delivery_mode') == 'native_study', 'Declare native_study delivery mode')
    rasters = data.get('rasters') if isinstance(data.get('rasters'), dict) else {}
    maps = data.get('maps') if isinstance(data.get('maps'), dict) else {}
    references = []
    raster_paths = []
    for key in original_ids('raster_checks.py', 'RASTERS'):
        entry = rasters.get(key)
        entry = entry if isinstance(entry, dict) else {}
        references.append({'role': 'raster.' + key, 'path': entry.get('path')})
        references.append({'role': 'metadata.' + key, 'path': entry.get('fgdc_xml')})
        if isinstance(entry.get('path'), str) and entry['path']:
            raster_paths.append(entry['path'])
    required_maps = (original_ids('audit.py', 'MAPS') if not study else (
        'future_sediment_loss', 'future_nutrient_runoff', 'current_nutrient_export',
        'current_sediment_export', 'combined_pollutant_export'))
    for key in dict.fromkeys((*required_maps, *maps.keys())):
        require(isinstance(key, str) and len(key) <= 200, 'Map IDs must be bounded strings')
        references.append({'role': 'map.' + key, 'path': maps.get(key)})
    references.append({'role': 'final_report', 'path': data.get('report_pdf')})
    if 'grid' in data:
        grid = data['grid']
        require(isinstance(grid, dict) and grid.get('schema') == 'upstate.retained-grid/v1',
                'Expected the original retained grid declaration')
        references.append({'role': 'model.grid', 'path': grid.get('record')})
    assets = data.get('project_assets', [])
    require(isinstance(assets, list) and (limits['max_references'] is None
            or len(assets) <= limits['max_references']) and
            all(isinstance(path, str) and path for path in assets),
            'project_assets must be explicit relative paths within max_references=' +
            str(limits['max_references']))
    references.extend({'role': 'project_asset', 'path': path} for path in assets)
    return references, raster_paths


def companion_paths(relative):
    """Known GDAL companion names only; never enumerate the source folder."""
    path = PurePosixPath(relative)
    candidates = {relative + suffix for suffix in ('.msk', '.aux.xml', '.ovr', '.msk.ovr', '.msk.aux.xml')}
    for suffix in ('.tfw', '.tifw', '.tiffw', '.wld', '.tab', '.xml', '.RPB', '.rpb'):
        candidates.add(str(path.with_suffix(suffix)))
    candidates.add(str(path.with_name(path.stem + '_RPC.TXT')))
    candidates.add(str(path.with_name(path.stem + '_rpc.txt')))
    # Uppercase extensions occur in exports from Windows GIS tools.
    candidates.update(str(PurePosixPath(value).with_suffix(PurePosixPath(value).suffix.upper()))
                      for value in tuple(candidates))
    candidates.discard(relative)
    return sorted(candidates)


def companion_state(root, raster_paths):
    existing = set()
    for relative in raster_paths:
        for candidate in companion_paths(relative):
            if os.path.lexists(root / candidate):
                existing.add(candidate)
    return existing


def unavailable(detail):
    return {'schema': 'upstate-ec-sdc-2026/audit-execution-v1',
            'status': 'AUDIT_UNAVAILABLE', 'detail': detail, 'findings': [],
            'boundary': 'The original technical audit did not complete; no technical pass or scientific acceptance is inferred.'}


def run_original_audit(captured_manifest, index, raster_paths, *, limits=None):
    limits = capture_limits(limits)
    # A local XML/VRT file named .tif must not cause GDAL to resolve remote data.
    # The original audit already requires GTiff; check its container before open.
    captured = {entry['path'] for entry in index['artifacts']}
    for relative in raster_paths:
        if 'delivery/' + relative not in captured:
            continue
        with (captured_manifest.parent / relative).open('rb') as stream:
            signature = stream.read(4)
        if signature not in (b'II*\x00', b'MM\x00*', b'II+\x00', b'MM\x00+'):
            return unavailable('A declared raster lacks a TIFF/BigTIFF container signature; correct the source artifact before native audit.')
    try:
        audit_name = ('native_study_audit.py' if index.get('schema')
                      == 'commons.native-study-package/v1' else 'audit.py')
        spec = importlib.util.spec_from_file_location('upstate_selected_delivery_audit', HERE / audit_name)
        require(spec is not None and spec.loader is not None, 'Original audit module cannot be loaded')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result = module.inspect(captured_manifest, max_manifest_bytes=limits['max_manifest_bytes'])
        require(isinstance(result, dict) and result.get('status') in ('FAIL', 'TECHNICAL_PRECHECK_PASS'),
                'Original audit returned an unsupported result')
        return result
    except (ImportError, OSError, ValueError, TypeError, KeyError, RuntimeError, RecursionError) as error:
        # Keep the package useful when optional native GIS libraries are absent.
        # This is an execution state, never a replacement scientific validator.
        return unavailable(type(error).__name__ + ': ' + str(error))


def write_new(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + '\n').encode('utf-8')


def write_json_new(path, value, maximum):
    """Stream a new metadata member within its selected byte budget."""
    encoder = json.JSONEncoder(ensure_ascii=False, indent=2,
                               sort_keys=True, allow_nan=False)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        size = 0
        for chunk in encoder.iterencode(value):
            raw = chunk.encode('utf-8')
            size += len(raw)
            require(size + 1 <= maximum,
                    'Package metadata exceeds max_index_bytes=' + str(maximum))
            stream.write(raw)
        stream.write(b'\n')


def pack(manifest_path, output, *, limits=None):
    limits = capture_limits(limits)
    raw = read_regular(manifest_path, limits['max_manifest_bytes'])
    data = parse_json(raw)
    references, raster_paths = collect_references(data, limits=limits)
    # Validate declared names before probing only their known companion names.
    for reference in references:
        if reference['path'] is not None:
            relative_path(reference['path'])
    source_root = manifest_path.absolute().parent.resolve(strict=True)
    companions = companion_state(source_root, raster_paths)
    index = capture_delivery(manifest_path, output, references, raw, limits=limits)
    included = {entry['path'].removeprefix('delivery/') for entry in index['artifacts']}
    for relative in sorted(companions - included):
        index['missing'].append({'roles': ['raster_companion'], 'path': 'delivery/' + relative,
                                 'reason': 'Companion exists beside a declared source raster but was not listed. Add it explicitly to project_assets and capture again.'})
    captured_manifest = output / index['manifestPath']
    audit = run_original_audit(captured_manifest, index, raster_paths, limits=limits)
    require(companion_state(source_root, raster_paths) == companions,
            'Raster companion presence changed during packaging; choose a fresh capture')
    audit_raw = json_bytes(audit)
    require(len(audit_raw) <= limits['max_index_bytes'] and
            (limits['max_file_bytes'] is None or len(audit_raw) <= limits['max_file_bytes']),
            'Generated audit exceeds the selected metadata/member byte budget')
    require(limits['max_total_bytes'] is None or
            sum(item['bytes'] for item in index['artifacts']) + len(audit_raw)
            <= limits['max_total_bytes'],
            'Captured source and audit exceed the selected total byte budget')
    write_new(output / 'audit.json', audit_raw)
    index['artifacts'].append({'roles': ['technical-audit'], 'path': 'audit.json',
                               'bytes': len(audit_raw), 'sha256': hashlib.sha256(audit_raw).hexdigest()})
    index['auditStatus'] = audit['status']
    native_study = index.get('schema') == 'commons.native-study-package/v1'
    index['humanReview'] = ('SCIENTIFIC_INTERPRETATION' if native_study else 'PENDING_QUALIFIED_PRIME')
    index['projectReferences'] = 'RELATIVE_LAYOUT_PRESERVED; application-internal absolute paths and undeclared dependencies remain operator review'
    index['companionCoverage'] = 'Known GeoTIFF masks, overviews and georeferencing companion names checked; not a full GIS dependency graph'
    if audit['status'] == 'AUDIT_UNAVAILABLE':
        index['disposition'] = 'PACKAGED_AUDIT_UNAVAILABLE'
        code = 3
    elif audit['status'] == 'FAIL' or index['missing']:
        index['disposition'] = 'PACKAGED_FOR_REMEDIATION'
        code = 2
    else:
        index['disposition'] = ('PACKAGED_NATIVE_STUDY' if native_study else 'PACKAGED_HUMAN_REVIEW_REQUIRED')
        code = 0
    index['packageSha256'] = fingerprint(index)
    verify_capture(output, index, limits=limits)
    # Write the inventory after all artifact bytes are stable. The navigator is
    # a derivative of the inventory/audit and is outside their fingerprint.
    write_json_new(output / 'package.json', index, limits['max_index_bytes'])
    write_new(output / 'index.html', render_handoff(index, audit).encode('utf-8'))
    print(json.dumps({'disposition': index['disposition'], 'package': str(output),
                      'packageSha256': index['packageSha256'], 'capturedFiles': len(index['artifacts']),
                      'missingReferences': len(index['missing']), 'auditStatus': audit['status'],
                      'humanReview': index['humanReview']}, sort_keys=True))
    return code


def verify(output, *, limits=None):
    limits = capture_limits(limits)
    index = parse_json(read_regular(output / 'package.json', limits['max_index_bytes']))
    verify_capture(output, index, limits=limits)
    print(json.dumps({'integrity': 'MATCH', 'packageSha256': index['packageSha256'],
                      'auditStatus': index.get('auditStatus', 'UNKNOWN'),
                      'humanReview': index.get('humanReview', 'UNKNOWN'),
                      'boundary': 'Matching file hashes do not establish origin, completeness, scientific validity or acceptance.'}, sort_keys=True))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    create = sub.add_parser('pack', help='Create a fresh portable delivery package')
    create.add_argument('manifest', type=Path)
    create.add_argument('output', type=Path)
    check = sub.add_parser('verify', help='Check listed file bytes and inventory fingerprint')
    check.add_argument('output', type=Path)
    for command in (create, check):
        for key, default in DEFAULT_LIMITS.items():
            command.add_argument('--' + key.replace('_', '-'), type=int, default=default,
                                 help='Optional positive integer; default %(default)s' +
                                      (' references' if key == 'max_references' else ' bytes'))
    args = parser.parse_args()
    try:
        limits = {key: getattr(args, key) for key in DEFAULT_LIMITS}
        return (pack(args.manifest, args.output, limits=limits) if args.command == 'pack'
                else verify(args.output, limits=limits))
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, RecursionError) as error:
        print(json.dumps({'status': 'ERROR', 'detail': str(error),
                          'partialOutput': 'If a new output directory was created, retain it for inspection and choose a fresh path after repair.'}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

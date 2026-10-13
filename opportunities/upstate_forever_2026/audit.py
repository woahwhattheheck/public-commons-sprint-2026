#!/usr/bin/env python3
"""Inspect delivery evidence for Upstate Forever's 2026 EC-SDC GIS RFP.

Read-only technical acceptance; NOT a watershed model, calibration, or FGDC certification.
Requires rasterio and pyproj, installed in the reviewing environment.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from raster_checks import (AUDIT_SCOPES, inspect_rasters, RASTERS,
                           retained_grid_geometry)
from pyproj.exceptions import CRSError


MAPS = (
    'future_sediment_loss', 'future_nutrient_runoff',
    'critical_drinking_water', 'high_quality_waters',
    'current_nutrient_export', 'current_sediment_export',
    'combined_pollutant_export',
)
SOURCES = ('NLCD', 'PROTECTED_LANDS', 'PARCEL', 'NHD',
           'PRECIPITATION', 'R_FACTOR', 'K_FACTOR', 'LS_FACTOR', 'NWI')


MAX_JSON_BYTES = 1024 * 1024


def _reject_constant(value):
    raise ValueError('Nonfinite JSON number: ' + value)


def _read_json(path: Path) -> dict:
    with path.open('rb') as incoming:
        body = incoming.read(MAX_JSON_BYTES + 1)
    if len(body) > MAX_JSON_BYTES:
        raise ValueError('JSON document exceeds the 1 MiB audit limit')
    value = json.loads(body.decode('utf-8'), parse_constant=_reject_constant)
    if not isinstance(value, dict):
        raise ValueError('JSON root must be an object')
    return value


def _retained_grid(data, model, child, add, summary):
    if 'grid' not in data:
        summary['audit_scope'] = 'regional-30m'
        add('INFO', 'grid.scope', 'Legacy regional delivery: unrotated 30 x 30 meter grid required')
        return None
    declaration = data['grid']
    if not isinstance(declaration, dict):
        summary['audit_scope'] = 'invalid'
        add('FAIL', 'grid.binding', 'The retained grid declaration must be an object')
        return None
    scope = declaration.get('audit_scope')
    summary['audit_scope'] = scope if scope in AUDIT_SCOPES else 'invalid'
    summary['grid'] = {key: declaration.get(key) for key in
                       ('schema', 'id', 'record', 'audit_scope')}
    try:
        if declaration.get('schema') != 'upstate.retained-grid/v1':
            raise ValueError('Unsupported retained grid declaration schema')
        if scope not in AUDIT_SCOPES:
            raise ValueError('Select regional-30m or source-native audit scope')
        grid_id = declaration.get('id')
        if not isinstance(grid_id, str) or not grid_id.strip():
            raise ValueError('The retained grid ID must be a nonempty string')
        if model.get('grid_id') != grid_id:
            raise ValueError('model.grid_id differs from the declared retained grid ID')
        path = child(declaration.get('record'), 'grid.record')
        if path is None:
            return None
        record = _read_json(path)
        if record.get('schema') != 'upstate.grid/v1':
            raise ValueError('The declared record must be an original upstate.grid/v1 document')
        if record.get('id') != grid_id:
            raise ValueError('Original grid record ID differs from model.grid_id and grid.id')
        if record.get('state') != 'complete':
            raise ValueError('The retained original grid must be complete')
        if not isinstance(record.get('spec'), dict):
            raise ValueError('The retained original grid selection must be an object')
        original = json.dumps({'spec': record['spec'], 'grid': record.get('grid')},
                              sort_keys=True, ensure_ascii=False,
                              separators=(',', ':'), allow_nan=False).encode('utf-8')
        if hashlib.sha256(original).hexdigest() != grid_id:
            raise ValueError('Original grid specification and geometry differ from the retained grid ID')
        geometry = retained_grid_geometry(record.get('grid'))
        recorded_buffer = record['spec'].get('upstream_buffer_m')
        declared_buffer = model.get('upstream_buffer_m')
        for label, value in (('Retained', recorded_buffer), ('Declared', declared_buffer)):
            if (isinstance(value, bool) or not isinstance(value, (int, float))
                    or not math.isfinite(value) or value < 0):
                raise ValueError(label + ' context buffer must be a finite nonnegative meter value')
        if not math.isclose(recorded_buffer, declared_buffer, rel_tol=0, abs_tol=1e-6):
            raise ValueError('Declared context buffer differs from the original grid selection')
        geometry['upstream_buffer_m'] = float(recorded_buffer)
        summary['grid'].update({
            'record_schema': record['schema'], 'record_state': record['state'],
            'crs': geometry['crs'].to_wkt(), 'width': geometry['width'],
            'height': geometry['height'], 'transform': list(geometry['transform']),
            'resolution_m': list(geometry['resolution_m']),
            'nominal_resolution_m': geometry['nominal_resolution_m'],
            'pixel_area_ha': geometry['pixel_area_ha'],
            'upstream_buffer_m': geometry['upstream_buffer_m'],
        })
        add('INFO', 'grid.scope', scope + '; original completed grid ' + grid_id
            + '; cell hectares ' + str(geometry['pixel_area_ha']))
        return geometry
    except (OSError, ValueError, UnicodeError, TypeError, OverflowError,
            RecursionError, CRSError) as exc:
        add('FAIL', 'grid.binding', 'Invalid retained grid: ' + str(exc))
        return None


def inspect(manifest_path: Path) -> dict:
    manifest_path = Path(manifest_path)
    findings = []
    summary = {'raster_layers': 0, 'map_files': 0, 'valid_cells': {}, 'resolution_m': None,
               'audit_scope': 'regional-30m', 'grid': None}

    def add(level, key, message):
        findings.append({'level': level, 'check': key, 'detail': str(message)})

    def child(value, key):
        if not isinstance(value, str) or not value or '\0' in value:
            add('FAIL', key, 'A nonempty relative path is required')
            return None
        try:
            if Path(value).is_absolute():
                add('FAIL', key, 'A nonempty relative path is required')
                return None
            p = (base / value).resolve()
            if not p.is_relative_to(base):
                add('FAIL', key, 'Path escapes the delivery root')
                return None
            if not p.is_file():
                add('FAIL', key, 'File missing: ' + value)
                return None
            return p
        except (OSError, ValueError, RuntimeError) as exc:
            add('FAIL', key, 'Unreadable delivery path: ' + str(exc))
            return None

    try:
        base = manifest_path.resolve().parent
        data = _read_json(manifest_path)
    except (OSError, ValueError, UnicodeError, RecursionError, RuntimeError) as e:
        return {'status': 'FAIL', 'findings': [{'level': 'FAIL', 'check': 'manifest', 'detail': str(e)}],
                'summary': summary}

    if data.get('schema') != 'upstate-ec-sdc-2026/delivery-v1':
        add('FAIL', 'schema', 'Unsupported delivery schema')

    maps = data.get('maps') if isinstance(data.get('maps'), dict) else {}
    for key in MAPS:
        p = child(maps.get(key), 'map.' + key)
        if p:
            try:
                with p.open('rb') as incoming:
                    signature = incoming.read(5)
                if signature != b'%PDF-':
                    add('FAIL', 'map.' + key, 'No PDF file signature')
                else:
                    summary['map_files'] += 1
            except OSError as exc:
                add('FAIL', 'map.' + key, exc)
    extra_maps = set(maps) - set(MAPS)
    if extra_maps:
        add('INFO', 'maps.extra', 'Additional map IDs: ' + ', '.join(sorted(extra_maps)))
    if summary['map_files'] == len(MAPS):
        add('REVIEW', 'map.cartography', 'Human visual check still required: scale, legend, north arrow, readability, page extent, and print/online suitability')

    report = child(data.get('report_pdf'), 'final_report')
    if report:
        try:
            with report.open('rb') as incoming:
                signature = incoming.read(5)
            if signature != b'%PDF-':
                add('FAIL', 'final_report', 'No PDF file signature')
            else:
                add('REVIEW', 'final_report', 'Read report for model methods, accuracy, limitations and intelligibility to non-specialists')
        except OSError as exc:
            add('FAIL', 'final_report', exc)

    model = data.get('model') if isinstance(data.get('model'), dict) else {}
    if not model.get('name') or not model.get('version'):
        add('FAIL', 'model.identity', 'Model name and version missing')
    expected_grid = _retained_grid(data, model, child, add, summary)
    native_grid = expected_grid is not None and summary['audit_scope'] == 'source-native'
    buffer = model.get('upstream_buffer_m')
    try:
        valid_buffer = (not isinstance(buffer, bool) and isinstance(buffer, (float, int))
                        and math.isfinite(buffer)
                        and (buffer >= 0 if native_grid else buffer > 0))
    except (OverflowError, TypeError, ValueError):
        valid_buffer = False
    if not valid_buffer:
        requirement = 'Nonnegative native context' if native_grid else 'Positive upstream/watershed modeling'
        add('FAIL', 'model.buffer', requirement + ' buffer (meters) not declared')
    elif buffer == 0:
        add('INFO', 'model.buffer', 'Original completed native grid retained with zero added context')
    else:
        add('REVIEW', 'model.buffer', 'Declared buffer needs spatial comparison to the watershed boundary; manifest alone cannot prove extent')

    records = data.get('source_data')
    records = records if isinstance(records, list) else []
    seen = set()
    for item in records:
        if not isinstance(item, dict):
            add('FAIL', 'sources.record', 'Each source record must be an object')
            continue
        sid = item.get('id')
        if not isinstance(sid, str) or not sid.strip():
            add('FAIL', 'sources.record', 'Each source ID must be a nonempty string')
        else:
            if sid in seen:
                add('FAIL', 'sources.duplicate', f'Duplicate source {sid}')
            seen.add(sid)
        if not item.get('vintage') or not item.get('uri'):
            add('FAIL', 'sources.provenance', f'Source {sid} lacks vintage or original URI')
    for sid in SOURCES:
        if sid not in seen:
            add('FAIL', 'sources.' + sid, 'Required modeled-input provenance entry missing')
    add('REVIEW', 'sources.currency', 'Source vintage, regional calibration and availability must be checked against latest applicable release')

    inspect_rasters(data, child, add, summary, expected_grid=expected_grid,
                    audit_scope=summary['audit_scope'])

    failed = sum(f['level'] == 'FAIL' for f in findings)
    return {'schema': 'upstate-ec-sdc-2026/audit-v1', 'status': 'FAIL' if failed else 'TECHNICAL_PRECHECK_PASS',
            'failed_checks': failed, 'findings': findings, 'summary': summary,
            'boundary': 'Read-only artifact structure/grid/value/FGDC-section inspection; no proof of environmental model correctness, cartographic quality, issuer acceptance, or contract.'}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('manifest', type=Path, help='Delivery manifest JSON')
    ap.add_argument('--out', type=Path, help='Optional JSON report')
    args = ap.parse_args()
    result = inspect(args.manifest)
    raw = json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False) + '\n'
    if args.out:
        args.out.write_text(raw, encoding='utf-8')
    print(raw, end='')
    return 0 if result['status'] == 'TECHNICAL_PRECHECK_PASS' else 2


if __name__ == '__main__':
    sys.exit(main())

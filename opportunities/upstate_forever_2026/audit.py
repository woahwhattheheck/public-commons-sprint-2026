#!/usr/bin/env python3
"""Inspect delivery evidence for Upstate Forever's 2026 EC-SDC GIS RFP.

Read-only technical acceptance; NOT a watershed model, calibration, or FGDC certification.
Requires rasterio and pyproj, installed in the reviewing environment.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from raster_checks import inspect_rasters, RASTERS


MAPS = (
    'future_sediment_loss', 'future_nutrient_runoff',
    'critical_drinking_water', 'high_quality_waters',
    'current_nutrient_export', 'current_sediment_export',
    'combined_pollutant_export',
)
SOURCES = ('NLCD', 'PROTECTED_LANDS', 'PARCEL', 'NHD',
           'PRECIPITATION', 'R_FACTOR', 'K_FACTOR', 'LS_FACTOR', 'NWI')


def inspect(manifest_path: Path) -> dict:
    base = manifest_path.resolve().parent
    findings = []
    summary = {'raster_layers': 0, 'map_files': 0, 'valid_cells': {}, 'resolution_m': None}

    def add(level, key, message):
        findings.append({'level': level, 'check': key, 'detail': str(message)})

    def child(value, key):
        if not isinstance(value, str) or not value or Path(value).is_absolute():
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

    try:
        data = json.loads(manifest_path.read_text(encoding='utf-8'))
        if not isinstance(data, dict):
            raise ValueError('JSON root must be an object')
    except (OSError, ValueError, UnicodeError) as e:
        return {'status': 'FAIL', 'findings': [{'level': 'FAIL', 'check': 'manifest', 'detail': str(e)}]}

    if data.get('schema') != 'upstate-ec-sdc-2026/delivery-v1':
        add('FAIL', 'schema', 'Unsupported delivery schema')

    maps = data.get('maps') if isinstance(data.get('maps'), dict) else {}
    for key in MAPS:
        p = child(maps.get(key), 'map.' + key)
        if p:
            try:
                if p.open('rb').read(5) != b'%PDF-':
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
            if report.open('rb').read(5) != b'%PDF-':
                add('FAIL', 'final_report', 'No PDF file signature')
            else:
                add('REVIEW', 'final_report', 'Read report for model methods, accuracy, limitations and intelligibility to non-specialists')
        except OSError as exc:
            add('FAIL', 'final_report', exc)

    model = data.get('model') if isinstance(data.get('model'), dict) else {}
    if not model.get('name') or not model.get('version'):
        add('FAIL', 'model.identity', 'Model name and version missing')
    buffer = model.get('upstream_buffer_m')
    if isinstance(buffer, bool) or not isinstance(buffer, (float, int)) or not math.isfinite(buffer) or buffer <= 0:
        add('FAIL', 'model.buffer', 'Positive upstream/watershed modeling buffer (meters) not declared')
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
        if sid in seen:
            add('FAIL', 'sources.duplicate', f'Duplicate source {sid}')
        if isinstance(sid, str):
            seen.add(sid)
        if not item.get('vintage') or not item.get('uri'):
            add('FAIL', 'sources.provenance', f'Source {sid} lacks vintage or original URI')
    for sid in SOURCES:
        if sid not in seen:
            add('FAIL', 'sources.' + sid, 'Required modeled-input provenance entry missing')
    add('REVIEW', 'sources.currency', 'Source vintage, regional calibration and availability must be checked against latest applicable release')

    inspect_rasters(data, child, add, summary)

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

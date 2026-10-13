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


def _read_json(path: Path, *, maximum=MAX_JSON_BYTES) -> dict:
    if type(maximum) is not int or maximum <= 0:
        raise ValueError('The audit JSON byte limit must be a positive integer')
    with path.open('rb') as incoming:
        body = incoming.read(maximum + 1)
    if len(body) > maximum:
        raise ValueError('JSON document exceeds the selected audit byte limit: ' + str(maximum))
    value = json.loads(body.decode('utf-8'), parse_constant=_reject_constant)
    if not isinstance(value, dict):
        raise ValueError('JSON root must be an object')
    return value


def _model_identity(model, add, summary):
    """Inspect declared versions without flattening retained per-model evidence."""
    if not model.get('name'):
        add('FAIL', 'model.identity', 'Model name missing')
    structured = ('versions' in model or 'native_version_provenance' in model)
    if not structured:
        if not model.get('version'):
            add('FAIL', 'model.identity', 'Model name and version missing')
        else:
            add('INFO', 'model.version', 'Legacy declared model version: ' + str(model['version']))
        return

    def version(value, label):
        if value is not None and (not isinstance(value, str) or not value.strip()):
            raise ValueError(label + ' must be a nonempty version string or null')
        return value

    try:
        provenance = model.get('native_version_provenance')
        if not isinstance(provenance, dict):
            raise ValueError('Retain the original native version provenance object')
        policy = provenance.get('policy')
        if not isinstance(policy, str) or not policy.strip():
            raise ValueError('Retain the native version resolution policy')
        models = provenance.get('models')
        if (not isinstance(models, list) or not models
                or not all(isinstance(name, str) and name for name in models)
                or len(set(models)) != len(models)
                or not set(models) <= {'ndr', 'sdr'}):
            raise ValueError('Retain the selected NDR/SDR model names once each')
        versions = model.get('versions')
        if not isinstance(versions, dict) or set(versions) != set(models):
            raise ValueError('Per-model versions differ from the retained model selection')
        versions = {name: version(versions[name], name) for name in models}
        if provenance.get('versions') != versions:
            raise ValueError('Manifest and provenance baseline versions differ')
        baseline = model.get('baseline_run_id')
        alternatives = model.get('scenario_run_ids')
        if (not isinstance(baseline, str) or not baseline
                or not isinstance(alternatives, list)
                or not all(isinstance(key, str) and key for key in alternatives)):
            raise ValueError('Retain the original baseline and scenario run identities')
        selected = [baseline, *alternatives]
        if len(set(selected)) != len(selected):
            raise ValueError('Retain each selected baseline/scenario run once')
        runs = provenance.get('runs')
        if not isinstance(runs, dict) or set(runs) != set(selected):
            raise ValueError('Version provenance must bind exactly the selected native runs')
        values, fallback = [], []
        for run_id in selected:
            entries = runs[run_id]
            if not isinstance(entries, dict) or set(entries) != set(models):
                raise ValueError('Retain every selected model version for run ' + run_id)
            for name in models:
                info = entries[name]
                if not isinstance(info, dict) or info.get('model') != name:
                    raise ValueError('Version evidence differs from its model binding')
                for key in ('comparison_version', 'observed_stage_version',
                            'observed_run_version', 'requested_version', 'basis'):
                    if key not in info:
                        raise ValueError('Version evidence is missing ' + key)
                effective = version(info['comparison_version'], name + ' comparison')
                stage = version(info['observed_stage_version'], name + ' completed stage')
                observed = version(info['observed_run_version'], name + ' observed run')
                requested = version(info['requested_version'], name + ' requested')
                basis = info['basis']
                if basis == 'completed_stage_runtime':
                    if not stage or not info.get('stage_completed_at') or effective != stage:
                        raise ValueError('Completed-stage version evidence is inconsistent')
                elif basis in ('observed_run_fallback', 'observed_runtime'):
                    if stage or not observed or effective != observed:
                        raise ValueError('Observed-run version evidence is inconsistent')
                elif basis == 'requested_legacy':
                    if stage or observed or not requested or effective != requested:
                        raise ValueError('Legacy requested version evidence is inconsistent')
                    fallback.append(run_id + '/' + name + ': requested legacy ' + requested)
                elif basis == 'unavailable':
                    if any(value is not None for value in (effective, stage, observed, requested)):
                        raise ValueError('Unavailable version evidence declares a version')
                    fallback.append(run_id + '/' + name + ': version unavailable')
                else:
                    raise ValueError('Unsupported retained version evidence basis: ' + str(basis))
                if info.get('differs_from_requested') is not bool(
                        effective and requested and effective != requested):
                    raise ValueError('Requested-version difference flag is inconsistent')
                if run_id == baseline and versions[name] != effective:
                    raise ValueError('Per-model baseline version differs from its original run')
                values.append(effective)
        common = values[0] if values and values[0] and all(
            value == values[0] for value in values) else None
        if version(model.get('version'), 'Combined model') != common:
            raise ValueError('Combined version must match every selected run/model or be null')
        summary['model_versions'] = {
            'version': common, 'versions': versions, 'policy': policy,
            'run_ids': selected,
            'unobserved': fallback,
        }
        add('INFO', 'model.version',
            'Retained per-model versions across ' + str(len(selected)) + ' original runs'
            + ('; common version ' + common if common else '; no single common version'))
        if fallback:
            add('REVIEW', 'model.version.observation',
                'Retained requested or unavailable versions need execution-source review: '
                + '; '.join(fallback))
    except (ValueError, TypeError, KeyError) as error:
        add('FAIL', 'model.version', str(error))


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


def inspect(manifest_path: Path, *, max_manifest_bytes=MAX_JSON_BYTES) -> dict:
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
        data = _read_json(manifest_path, maximum=max_manifest_bytes)
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
    _model_identity(model, add, summary)
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

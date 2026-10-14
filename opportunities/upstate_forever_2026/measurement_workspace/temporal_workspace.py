"""Use the original Measurements import and exact original rows for temporal work."""
from __future__ import annotations

from datetime import date
import json
import math
from pathlib import Path
import re
from typing import Any

from model.common import identifier, verify_file
from measurement_workspace.temporal_analysis import base_record, canonical, clean, sha, endpoints

ROOT = 'source/temporal-workspace-observations'
OPTIONAL = ('activity', 'fraction', 'depth', 'depth_unit', 'method_authority', 'value_type',
            'weight_basis', 'time_basis', 'temperature_basis', 'particle_size_basis',
            'project', 'time', 'timezone', 'reporting_limit', 'reporting_limit_unit', 'comment')
DEFAULT = {'columns': {}, 'below_qualifiers': ['<', '<='], 'above_qualifiers': ['>', '>='],
           'numeric_qualifiers': [''], 'nonnegative': False, 'use_limit_unit_when_missing': False}
COMPARISON = re.compile(r'^\s*(<=|>=|<|>|≤|≥)\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*$')


# Scientific dimensions only: measured values and source/review IDs stay out.
QUANTITY_CONTEXT_FIELDS = ('basis', 'speciation', 'chemical_basis', 'unitKind',
    'methodName', 'solidsBasis', 'resultDepth', 'resultDepthUnit',
    'resultDepthReference', 'activityDepth', 'activityDepthUnit',
    'activityDepthReference', 'relativeDepth')
INTERPRETATION_CONTEXT_FIELDS = ('chemicalBasis', 'solidsBasis', 'unitKind',
    'microbialCountMethod', 'turbidityScale', 'conductivityTemperatureCorrection')


def _source_object(value: Any, label: str, *, opaque=False) -> dict:
    if value in (None, ''):
        return {}
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        if opaque:
            return {}
        raise ValueError(label + ' must retain an object or its exact JSON text.')
    def reject(token):
        raise ValueError('Non-finite original analytical context: ' + token)
    try:
        parsed = json.loads(value, parse_constant=reject)
    except (TypeError, ValueError) as error:
        if opaque:
            return {}
        raise ValueError(label + ' is not complete original JSON.') from error
    if not isinstance(parsed, dict):
        if opaque:
            return {}
        raise ValueError(label + ' must retain an object.')
    return parsed


def source_context(row: dict, metadata: dict) -> dict:
    """Retain exact extra scientific dimensions, without conversion/inference.

    Independent declarations keep their namespaces, explicit nulls and conflicts.
    Legacy opaque quantity text remains in the complete original record.
    """
    original = row.get('original') or {}
    column = metadata.get('columns', {}).get('source_quantity', 'source_quantity')
    quantity_value = row.get('source_quantity')
    if quantity_value in (None, ''):
        quantity_value = original.get(column, metadata.get('source_quantity'))
    quantity = _source_object(quantity_value, 'Original source quantity', opaque=True)
    canonical_source = _source_object(original.get('canonical_row_json'),
                                      'Original canonical record')
    result = {}
    for label, source in (('source_quantity', quantity),
                          ('canonical_original', canonical_source)):
        selected = {key: source[key] for key in QUANTITY_CONTEXT_FIELDS if key in source}
        if selected:
            result[label] = selected
        interpretation = _source_object(source.get('characteristicInterpretation'),
                                         'Original characteristic interpretation')
        selected_interpretation = {key: interpretation[key]
            for key in INTERPRETATION_CONTEXT_FIELDS if key in interpretation}
        if selected_interpretation:
            result[label + '_interpretation'] = selected_interpretation
    native_support = {}
    for key in ('quantity_basis', 'measurement_support', 'time_support'):
        if key in row:
            native_support[key] = row[key]
        elif key in metadata:
            native_support[key] = metadata[key]
    if native_support:
        result['native_support'] = native_support
    return json.loads(canonical(result))


def optional_source_field(row: dict, metadata: dict, mapping: dict, field: str) -> dict:
    """Keep an absent override distinct from an explicitly disabled mapping."""
    original = row.get('original') or {}
    if field in mapping['columns']:
        column = mapping['columns'][field]
        if column == '':
            return {'basis': 'explicitly_disabled', 'present': False}
        return {'basis': 'selected_original_column', 'column': column,
                'present': column in original, **({'value': original[column]} if column in original else {})}
    declared = metadata.get('columns', {})
    if field in declared:
        column = declared[field]
        if column == '':
            return {'basis': 'original_mapping_disabled', 'present': False}
        return {'basis': 'original_column', 'column': column, 'present': column in original,
                **({'value': original[column]} if column in original else {})}
    if field in row:
        return {'basis': 'native_row', 'present': True, 'value': row[field]}
    if field in metadata:
        return {'basis': 'original_metadata', 'present': True, 'value': metadata[field]}
    return {'basis': 'absent', 'present': False}


def _field_text(detail: dict) -> str:
    value = detail.get('value')
    if value is None:
        return ''
    return canonical(value).decode('utf-8') if isinstance(value, (dict, list)) else str(value).strip()


def options(value: dict | None, columns: list[str]) -> dict:
    value = {} if value is None else value
    if not isinstance(value, dict) or set(value) - set(DEFAULT):
        raise ValueError('Choose the displayed imported-measurement interpretation controls.')
    out = {**DEFAULT, **value}
    if type(out['nonnegative']) is not bool or type(out['use_limit_unit_when_missing']) is not bool:
        raise ValueError('The nonnegative-quantity choice must be explicit.')
    if not isinstance(out['columns'], dict) or set(out['columns']) - set(OPTIONAL):
        raise ValueError('An optional mapping must use the supported source fields.')
    if any(not isinstance(v, str) or (v and v not in columns) for v in out['columns'].values()):
        raise ValueError('Choose original column names from the selected source.')
    for key in ('below_qualifiers', 'above_qualifiers', 'numeric_qualifiers'):
        if not isinstance(out[key], list) or any(not isinstance(v, str) for v in out[key]):
            raise ValueError('Qualifier meanings must be lists of exact source text.')
        out[key] = [v.strip() for v in out[key]]
        if len(set(out[key])) != len(out[key]):
            raise ValueError('A source qualifier is listed more than once.')
    groups = [set(out[k]) for k in ('below_qualifiers', 'above_qualifiers', 'numeric_qualifiers')]
    if any(groups[i] & groups[j] for i in range(3) for j in range(i + 1, 3)):
        raise ValueError('A qualifier cannot mean both a measured value and a detection limit.')
    return out


def catalog(workspace) -> list[dict]:
    return [{'id': r['id'], 'title': r.get('metadata', {}).get('title', r['id']),
             'rows': len(r.get('rows', [])), 'columns': r.get('columns', []),
             'source_uri': r.get('metadata', {}).get('source_uri', ''),
             'value_basis': r.get('metadata', {}).get('value_basis', 'context')}
            for r in workspace._list('observations')]


def preview(workspace, key: str) -> dict:
    source = workspace._get('observations', identifier(key))
    rows = source.get('rows', [])
    return {'id': source['id'], 'title': source['metadata']['title'],
            'source_uri': source['metadata'].get('source_uri'), 'columns': source.get('columns', []),
            'defaults': DEFAULT, 'row_count': len(rows),
            'qualifiers': sorted({str(r.get('qualifier', '')) for r in rows}),
            'preview': [{k: r.get(k) for k in ('id', 'line', 'station_id', 'parameter', 'unit',
                        'value_text', 'qualifier', 'period_start', 'period_end', 'method', 'original')}
                        for r in rows[:8]]}


def _finite(value: Any) -> float:
    out = float(value)
    if not math.isfinite(out):
        raise ValueError('The reported value is not a finite number.')
    return out


def capture(workspace, key: str, target: Path, selection: dict | None = None) -> dict:
    """Capture a read-only existing source, not a second importer or live edit."""
    source = workspace._get('observations', identifier(key))
    mapping = options(selection, source['columns'])
    original = verify_file(workspace.root, {**source['original'], 'path': source['original']['object']})
    raw_bytes = original.read_bytes()
    metadata = source['metadata']
    target = Path(target)
    folder = target / ROOT
    folder.mkdir(parents=True, exist_ok=False)
    original_path = ROOT + '/original.csv'
    snapshot_path = ROOT + '/original-workspace-record.json'
    (target / original_path).write_bytes(raw_bytes)
    (target / snapshot_path).write_bytes(canonical(source))
    originals = [{'path': original_path, 'bytes': len(raw_bytes), 'sha256': sha(raw_bytes),
                  'uri': metadata.get('source_uri'), 'source_filename': source['original'].get('filename')},
                 {'path': snapshot_path, 'bytes': (target / snapshot_path).stat().st_size,
                  'sha256': sha((target / snapshot_path).read_bytes())}]
    records = []
    for i, row in enumerate(source['rows']):
        r = base_record('workspace', row, i, snapshot_path)
        field_sources = {field: optional_source_field(row, metadata, mapping, field) for field in OPTIONAL}
        def optional(field: str) -> str:
            return _field_text(field_sources[field])
        r['optional_source_fields'] = field_sources
        r['original_unit_present'] = 'unit' in row
        r['original_unit'] = row.get('unit')
        r['unit_choice'] = {
            'allow_original_reporting_limit_when_missing': mapping['use_limit_unit_when_missing'],
            'reporting_limit_unit': field_sources['reporting_limit_unit'],
            'effective_basis': 'original_measurement_unit'}

        r.update({k: optional(k) for k in OPTIONAL if k != 'reporting_limit'})
        r.update(station=str(row.get('station_id') or ''), parameter=str(row.get('original_parameter') or row['parameter']),
                 unit=str(row.get('unit') or ''), method=str(row.get('method') or ''),
                 speciation=str(row.get('species') or ''), date=str(row.get('period_start') or ''),
                 original_cells=row['original'], original_observation_id=source['id'],
                 original_record_id=row['id'], source_csv_row=row['line'],
                 source_references=[{**originals[0], 'csv_row': row['line'], 'record_id': row['id']},
                                    {'path': snapshot_path, 'row_index': i, 'observation_id': source['id']}],
                 dataset_title=metadata['title'], original_mapping=metadata.get('columns', {}))
        scientific_context = source_context(row, metadata)
        if scientific_context:
            r['source_context'] = scientific_context
        r['activity_identity_basis'] = ('source_activity_identifier' if r['activity'] else 'original_record')
        if (metadata.get('measurement_native_handoff')
                and field_sources['activity'].get('column') == 'activity'):
            original_canonical = _source_object(row['original'].get('canonical_row_json'),
                                                'Original canonical record')
            if original_canonical.get('activityId') in (None, ''):
                r['activity_identity_basis'] = 'original_record'
        r['activity'] = r['activity'] or (source['id'] + ':' + row['id'])
        # Defaults only for an absent declaration. A supplied null/blank or
        # explicit disabled field remains the chosen source value.
        for field, default in (('value_type', 'Original reported value'),
                               ('project', source['id']),
                               ('time_basis', metadata.get('time_support', 'Original single-day measurement'))):
            if field_sources[field]['basis'] == 'absent':
                r[field] = default
        r['lower'], r['upper'], r['censored'] = None, None, False
        issues = []
        try:
            day = date.fromisoformat(r['date'])
            if day.isoformat() != r['date']:
                raise ValueError()
            if row.get('period_end') and row['period_end'] != r['date']:
                issues.append('multi-day source period: use its original aggregate support')
        except (ValueError, TypeError):
            issues.append('original date needs a complete ISO calendar day')
        if metadata.get('value_basis') == 'annual_mass_rate':
            issues.append('annual mass-rate source: use the original annual-load comparison')
        qualifier = str(row.get('qualifier') or '').strip()
        text = str(row.get('value_text') or '').strip()
        match = COMPARISON.fullmatch(text)
        symbol = {'≤': '<=', '≥': '>='}.get(match[1], match[1]) if match else None
        direction = 'below' if qualifier in mapping['below_qualifiers'] else 'above' if qualifier in mapping['above_qualifiers'] else 'numeric' if qualifier in mapping['numeric_qualifiers'] else None
        if match:
            inline_direction = 'below' if symbol.startswith('<') else 'above'
            if qualifier and direction != inline_direction:
                issues.append('inline reporting limit and source qualifier have different or unreviewed meanings')
            direction = inline_direction
        try:
            if direction in ('below', 'above'):
                reported_limit = optional('reporting_limit')
                limit = _finite(reported_limit or (match[2] if match else text))
                limit_unit = optional('reporting_limit_unit')
                if not r['unit'] and limit_unit and mapping['use_limit_unit_when_missing']:
                    r['unit'] = limit_unit
                    r['unit_origin'] = 'original reporting-limit unit: explicit missing-measurement-unit selection'
                    r['unit_choice']['effective_basis'] = 'explicit_original_reporting_limit_unit'
                if limit_unit and limit_unit != r['unit']:
                    raise ValueError('The original reporting-limit unit differs from the selected measurement unit.')
                if mapping['nonnegative'] and limit < 0:
                    raise ValueError('A negative reporting limit conflicts with the chosen nonnegative support.')
                r['lower'], r['upper'] = ((0.0 if mapping['nonnegative'] else -math.inf), limit) if direction == 'below' else (limit, math.inf)
                r['censored'] = True
            elif direction == 'numeric' and not match:
                value = _finite(text)
                if mapping['nonnegative'] and value < 0:
                    raise ValueError('The original value is negative under the selected nonnegative support.')
                r['lower'] = r['upper'] = value
            else:
                issues.append('source qualifier has no selected numerical or reporting-limit meaning: ' + repr(qualifier))
        except (ValueError, TypeError) as error:
            issues.append(str(error))
        if not r['station'] or not r['parameter'] or not r['unit']:
            issues.append('original station, constituent and unit are required for a temporal cohort')
        r['qualifiers'] = [qualifier] if qualifier else []
        r['flags'], r['eligible'] = issues, not issues
        r.update(endpoints(r['lower'], r['upper']))
        records.append(clean(r))
    records_path = ROOT + '/records.json'
    (target / records_path).write_bytes(canonical(records))
    result = {'schema': 'upstate.temporal-workspace-source/v1', 'title': metadata['title'],
              'workspace_project': workspace.project['id'], 'observation_id': source['id'],
              'source_metadata': metadata, 'interpretation': mapping,
              'capture_implementation_sha256': sha(Path(__file__).read_bytes()),
              'sources': originals, 'records': {'path': records_path,
                  'bytes': (target / records_path).stat().st_size, 'sha256': sha((target / records_path).read_bytes())}}
    (folder / 'manifest.json').write_bytes(canonical(result))
    return result

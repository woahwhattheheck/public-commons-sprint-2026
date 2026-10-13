"""Carry complete retained paired ensembles into the original scientific composer.

The numerical engine owns every result. This adapter describes and retains its
completed artifacts; it neither dispatches a model nor changes its populations.
Copyright 2026 TokenJunkieLabs.
"""
from __future__ import annotations

import copy
import hashlib
import math
import os
from pathlib import Path
import shutil
import tempfile
import zipfile

from .ensemble_store import atomic, canonical, digest, fingerprint, held, identifier, now, read, verify

SCHEMA = 'upstate.paired-ensemble-report-source/v1'
REPORT_SCHEMA = 'upstate.observed-report/v1'
SOURCE_ID = 'paired-ensemble-scientific-report'
EDITION = 'paired-ensemble-report/1'
LABELS = {'nitrogen_export': 'Nitrogen', 'phosphorus_export': 'Phosphorus',
          'sediment_export': 'Sediment'}
UNITS = {'nitrogen_export': 'kg/year', 'phosphorus_export': 'kg/year',
         'sediment_export': 'metric_tonnes/year'}
SUPPORT = {
    'all_pairs': 'Common valid pixels across every selected pair, separately by pollutant',
    'all_pairs_all_pollutants': 'Common valid pixels across every pair and pollutant',
    'available_pairs': 'Available-pair raster display; basin totals still use every pair’s common pixels',
}


def _number(value):
    if value is None:
        return 'Unavailable'
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError('The retained ensemble has a nonfinite report quantity')
        return format(value, '.9g')
    return str(value)


def _table(columns, rows, caption=None, widths=None):
    return {'kind': 'table', 'columns': columns,
            'rows': [[_number(value) for value in row] for row in rows],
            'widths': widths, 'caption': caption}


def _text(value):
    return value if isinstance(value, str) else canonical(value).decode('utf-8')


def _copy(source, target, expected):
    """Stream and verify one immutable original; never replace an existing member."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        verify(target.parent, {**expected, 'path': target.name})
        return
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.capture-', delete=False) as out:
            temporary = Path(out.name)
            checksum, count = hashlib.sha256(), 0
            with source.open('rb') as incoming:
                for chunk in iter(lambda: incoming.read(1024 * 1024), b''):
                    checksum.update(chunk)
                    count += len(chunk)
                    out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
        if count != expected['bytes'] or checksum.hexdigest() != expected['sha256']:
            raise ValueError('Original ensemble changed during report capture: ' + str(source))
        try:
            os.link(temporary, target)
        except FileExistsError:
            verify(target.parent, {**expected, 'path': target.name})
        descriptor = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def _completed(directory):
    directory = Path(directory).resolve(strict=True)
    state = read(directory / 'analysis.json')
    if (state.get('schema') != 'upstate.paired-raster-ensemble/v1'
            or state.get('state') != 'complete'
            or state.get('id') != digest(state.get('selection'))):
        raise ValueError('Choose a complete, unchanged paired-raster ensemble')
    reports = read(directory / 'reports.json')
    if reports.get('ensemble_id') != state['id']:
        raise ValueError('The retained report belongs to another paired ensemble')
    descriptors = [*state['artifacts'].values(), *reports['files']]
    descriptors += [{'path': name, **fingerprint(directory / name)}
                    for name in ('analysis.json', 'reports.json')]
    members = {}
    for row in descriptors:
        verify(directory, row)
        record = {key: row[key] for key in ('path', 'bytes', 'sha256')}
        if record['path'] in members and members[record['path']] != record:
            raise ValueError('Retained ensemble members disagree on their identity')
        members[record['path']] = record
    selection = state['selection']
    summary_record = read(directory / 'summary.json')
    if (read(directory / 'selection.json') != selection
            or summary_record.get('ensemble_id') != state['id']
            or summary_record.get('summary') != state['summary']):
        raise ValueError('The retained report summaries differ from the original calculation')
    pollutants = selection['pollutants']
    if set(pollutants) != set(state['summary']) or not set(pollutants) <= set(LABELS):
        raise ValueError('The report must describe every selected pollutant exactly once')
    selected = selection['selected_member_count']
    planned = selection['planned_member_count']
    if (type(selected) is not int or type(planned) is not int
            or selected < 1 or planned < selected or len(selection['members']) != selected):
        raise ValueError('The selected and planned ensemble populations disagree')
    if selection['support'] not in SUPPORT:
        raise ValueError('The original ensemble has an unsupported support rule')
    selected_ids = [item['id'] for item in selection['members']]
    if len(set(selected_ids)) != selected:
        raise ValueError('The original ensemble repeats a selected member')
    selected_by_id = {item['id']: item for item in selection['members']}
    for pollutant in pollutants:
        summary = state['summary'][pollutant]
        if summary['units'] != UNITS[pollutant]:
            raise ValueError('Retain the original annual mass units for ' + pollutant)
        if [item['id'] for item in summary['members']] != selected_ids:
            raise ValueError('Summary members differ from the original selected population')
        for item in summary['members']:
            if item['common_cells'] != summary['common_cells']:
                raise ValueError('Paired basin totals must retain identical common support')
            selected_item = selected_by_id[item['id']]
            for name in ('profile_id', 'baseline_run_id', 'alternative_run_id', 'scenario_id'):
                if item.get(name) != selected_item.get(name):
                    raise ValueError('A report member differs from its original ' + name)
    return state, reports, members


def sections(state):
    """Describe the actual tested population, separately for every physical output."""
    selection = state['selection']
    refs = selection.get('source_references') or {}
    if not isinstance(refs, dict):
        refs = {'original': refs}
    grid = selection['grid']
    facts = [
        ['Selected / planned members', str(selection['selected_member_count']) + ' / ' + str(selection['planned_member_count'])],
        ['Original input kind', selection.get('input_kind', 'Unspecified in original selection')],
        ['Original input description', selection.get('input_description', 'Unspecified in original selection')],
        ['Original grid', str(grid['width']) + ' × ' + str(grid['height']) + ' pixels'],
        ['Raster display support', SUPPORT[selection['support']]],
        ['Scenario-effect direction', 'Baseline minus alternative; positive means a reduction'],
        ['Quantile convention', selection.get('quantile_method', 'Retained original quantile convention')],
    ]
    if refs.get('invest_version'):
        facts.append(['Retained model version', refs['invest_version']])
    result = [['Question and selected calculation', [
        selection.get('purpose') or 'Compare the saved baseline and alternative across the explicitly selected profiles.',
        _table(['Design', 'Retained value'], facts, widths=[1.5, 4.4]),
        'The report describes the selected profiles, not a fitted probability distribution. '
        'A fraction of members showing improvement is not an estimated probability of success. '
        'Unselected planned members are not counted as successes, failures or zero reductions.',
        {'kind': 'links', 'items': [
            {'title': 'Original full-resolution ensemble report and retained raster overviews', 'path': 'original/index.html'},
            {'title': 'Exact selected profiles, sources, grid and scenarios', 'path': 'original/selection.json'},
        ]},
    ]]]
    support_rows, report_summary = [], {}
    for pollutant in selection['pollutants']:
        value = state['summary'][pollutant]
        distribution = value['basin_reduction_distribution_common_support']
        totals = [member['reduction_total_common_support'] for member in value['members']]
        valid = [number for number in totals if number is not None]
        direction = {'reduced': sum(number > 0 for number in valid),
                     'increased': sum(number < 0 for number in valid),
                     'unchanged': sum(number == 0 for number in valid),
                     'unavailable': len(totals) - len(valid)}
        report_summary[pollutant] = {
            'units': value['units'], 'common_cells': value['common_cells'],
            'reporting_cells': value['reporting_cells'],
            'common_coverage_fraction': value['common_coverage_fraction'],
            'distribution': copy.deepcopy(distribution),
            'member_direction_at_stored_precision': direction,
            'improvement_threshold_per_pixel': selection['improvement_thresholds'].get(pollutant, 0),
        }
        coverage = value['common_coverage_fraction']
        support_rows.append([LABELS[pollutant], value['common_cells'], value['reporting_cells'],
                             None if coverage is None else 100 * coverage,
                             value['partial_pair_cells'], value.get('common_projected_grid_area_ha')])
        unit = value['units']
        if distribution is None:
            headline = 'There is no common valid geography for a paired whole-reporting-area comparison.'
            spread = []
        else:
            headline = (str(direction['reduced']) + ' selected members have a positive basin reduction; '
                        + str(direction['increased']) + ' have an increase; ' + str(direction['unchanged'])
                        + ' are unchanged at stored precision. The selected mean reduction is '
                        + _number(distribution['mean']) + ' ' + unit + '.')
            spread = [_table(['Selected-population statistic', 'Reduction (' + unit + ')'],
                             [['Minimum', distribution['minimum']], ['Mean', distribution['mean']],
                              *[['Q' + _number(row['q'] * 100), row['value']] for row in distribution['quantiles']],
                              ['Maximum', distribution['maximum']]], widths=[2.2, 3.7])]
        rows = []
        for index, item in enumerate(value['members'], 1):
            rows.append([index, item['baseline_total_common_support'], item['alternative_total_common_support'],
                         item['reduction_total_common_support'], item['reduction_percent_common_support']])
        result.append([LABELS[pollutant] + ' — paired reporting-area effect', [
            headline,
            'All basin totals in this section use the same ' + str(value['common_cells'])
            + ' pixels for every selected member. Basin quantiles come from those whole-area member totals; '
            'they are not sums of pixel quantiles. Nutrient and sediment mass units stay separate.',
            *spread,
            _table(['Member', 'Baseline (' + unit + ')', 'Alternative (' + unit + ')',
                    'Reduction (' + unit + ')', 'Reduction (%)'], rows,
                   'Member order matches the complete identity table. Missing values and a zero baseline denominator remain unavailable.',
                   widths=[0.5, 1.4, 1.4, 1.4, 1.2]),
            'The stored spatial improvement threshold is '
            + _number(selection['improvement_thresholds'].get(pollutant, 0))
            + ' in the original per-pixel mass units. The member-direction counts above instead describe '
            'the sign of whole-area totals at stored precision; these are different statistics.',
        ]])
    result.insert(1, ['Geographic support and missingness', [
        _table(['Output', 'Common pixels', 'Reporting pixels', 'Coverage (%)', 'Partial pixels', 'Common grid area (ha)'],
               support_rows, 'Projected grid area is retained from the calculation, not a new geodesic measurement.',
               widths=[1, 1, 1, 0.9, 0.9, 1.1]),
        'Each pollutant keeps its own reported support. Cross-pollutant geographic equivalence is asserted only '
        'when the original selection used all_pairs_all_pollutants. The available_pairs display does not '
        'change the common-support population used for basin comparisons.',
        {'kind': 'links', 'items': [
            {'title': 'Original full-precision coverage table', 'path': 'original/coverage.csv'},
            {'title': 'Original full-precision basin quantiles', 'path': 'original/basin-quantiles.csv'},
        ]},
    ]])
    identities = []
    for index, member in enumerate(selection['members'], 1):
        identities.append([index, member['id'], member.get('profile_id'),
                           member.get('baseline_run_id'), member.get('alternative_run_id'), member.get('scenario_id')])
    result.append(['Original member and source identities', [
        'The complete original files retain every profile, run, scenario, raster identity, negative-input count '
        'and pair-specific support total. Source/result identifiers are copied unchanged, including absent '
        'native identifiers in an explicitly authored arithmetic case.',
        _table(['Member', 'Selected identity', 'Profile', 'Baseline run', 'Alternative run', 'Scenario'],
               identities, widths=[0.4, 1.1, 1.1, 1.1, 1.1, 1.1]),
        {'kind': 'links', 'items': [
            {'title': 'Complete original paired-member CSV', 'path': 'original/paired-members.csv'},
            {'title': 'Complete original analysis and artifacts', 'path': 'original/analysis.json'},
            {'title': 'Unrounded scientific report summary', 'path': 'science-summary.json'},
            {'title': 'Complete original file inventory', 'path': 'original-inventory.json'},
        ]},
    ]])
    return result, report_summary


def capture(project, destination, *, title=None, workspace_id=None):
    """Prepare one independently importable report source from a complete result directory."""
    project = Path(project).resolve(strict=True)
    destination = Path(destination).resolve()
    if title is not None and (not isinstance(title, str) or not title.strip()):
        raise ValueError('Enter a nonempty scientific report title')
    state, reports, members = _completed(project)
    title = title.strip() if title is not None else state['selection']['title']
    identity = {'edition': EDITION, 'ensemble_id': state['id'], 'workspace_id': workspace_id,
                'title': title, 'original_members': members,
                'producer': fingerprint(Path(__file__)),
                'storage_implementation': fingerprint(Path(__file__).with_name('ensemble_store.py'))}
    key = digest(identity)
    root = destination / key
    destination.mkdir(parents=True, exist_ok=True)
    with held(destination / '.paired-report-source.lock', blocking=True):
        record_path = root / 'report-source-record.json'
        if record_path.exists():
            record = inspect(root)
            if record['identity'] != identity:
                raise ValueError('Report capture identity changed')
            return {**record, 'directory': str(root), 'reused': True}
        root.mkdir(parents=True, exist_ok=True)
        intent_path = root / 'intent.json'
        if intent_path.exists():
            intent = read(intent_path)
            if intent['identity'] != identity or intent['id'] != key:
                raise ValueError('Resume this original report capture with the same inputs')
        else:
            intent = {'id': key, 'identity': identity, 'created_at': now()}
            atomic(intent_path, intent, immutable=True)
        companions = []
        for name, descriptor in sorted(members.items()):
            original = verify(project, descriptor)
            target = root / 'original' / name
            _copy(original, target, descriptor)
            companions.append({**descriptor, 'path': 'original/' + name})
        for name in ('ensemble_report_source.py', 'ensemble_store.py'):
            source = Path(__file__).with_name(name)
            expected = identity['producer' if name == 'ensemble_report_source.py' else 'storage_implementation']
            _copy(source, root / 'implementation' / name, expected)
            companions.append({'path': 'implementation/' + name, **expected})
        report_sections, summary = sections(state)
        atomic(root / 'science-summary.json', {'ensemble_id': state['id'],
               'input_kind': state['selection'].get('input_kind'),
               'input_description': state['selection'].get('input_description'),
               'selected_members': state['selection']['selected_member_count'],
               'planned_members': state['selection']['planned_member_count'],
               'effect_direction': state.get('effect_direction'), 'summary': summary}, immutable=True)
        atomic(root / 'original-inventory.json', {'ensemble_id': state['id'], 'members': members}, immutable=True)
        for name in ('science-summary.json', 'original-inventory.json'):
            companions.append({'path': name, **fingerprint(root / name)})
        recipe = {'schema': REPORT_SCHEMA, 'title': title, 'edition': EDITION,
                  'report_context_kind': 'paired-raster-ensemble',
                  'project_id': workspace_id, 'ensemble_id': state['id'],
                  'inputs': companions, 'sections': report_sections, 'figures': [],
                  'source_links': ['original/index.html', 'original/selection.json',
                                   'original/analysis.json', 'science-summary.json']}
        atomic(root / 'report-source.json', recipe, immutable=True)
        entry = {'id': SOURCE_ID, 'kind': 'document', 'title': title,
                 'uri': 'urn:upstate:paired-ensemble-report:' + key,
                 'vintage': intent['created_at'], 'path': 'report-source.json',
                 'sha256': fingerprint(root / 'report-source.json')['sha256'],
                 'companions': companions, 'role': 'paired-ensemble-report-source',
                 'metadata': {'report_schema': REPORT_SCHEMA,
                              'report_context_kind': 'paired-raster-ensemble',
                              'report_source_id': key, 'ensemble_id': state['id'],
                              'project_id': workspace_id,
                              'input_kind': state['selection'].get('input_kind'),
                              'input_description': state['selection'].get('input_description'),
                              'selected_member_count': state['selection']['selected_member_count'],
                              'planned_member_count': state['selection']['planned_member_count'],
                              'new_native_calculation': False}}
        atomic(root / 'sources.json', {'schema': 'upstate.sources/v1', 'title': title,
               'captured_at': intent['created_at'], 'entries': [entry]}, immutable=True)
        files = companions + [{'path': name, **fingerprint(root / name)}
                              for name in ('intent.json', 'report-source.json', 'sources.json')]
        record = {'schema': SCHEMA, 'id': key, 'ensemble_id': state['id'], 'state': 'complete',
                  'identity': identity, 'title': title, 'created_at': intent['created_at'],
                  'source_id': SOURCE_ID, 'files': files, 'summary': summary}
        record['record_sha256'] = digest(record)
        # Catch concurrent replacement after the original descriptors were read.
        _, _, current = _completed(project)
        if current != members:
            raise ValueError('The original ensemble changed before source publication')
        atomic(record_path, record, immutable=True)
        inspect(root)
        return {**record, 'directory': str(root), 'reused': False}


def inspect(directory):
    root = Path(directory).resolve(strict=True)
    record = read(root / 'report-source-record.json')
    if (record.get('schema') != SCHEMA or record.get('state') != 'complete'
            or record.get('id') != digest(record['identity'])
            or record.get('record_sha256') != digest({key: value for key, value in record.items()
                                                    if key != 'record_sha256'})):
        raise ValueError('Retained paired ensemble report source changed')
    for item in record['files']:
        verify(root, item)
    return record


def prepare(workspace, selection, *, progress=None):
    """Register the completed source using the original Workspace source importer."""
    if not isinstance(selection, dict) or set(selection) - {'ensemble_id', 'title'}:
        raise ValueError('Choose ensemble_id and optional title for the original report source')
    key = identifier(selection['ensemble_id'])
    project = workspace.root / 'ensemble-products' / key
    if progress:
        progress({'stage': 'retain-complete-ensemble', 'ensemble_id': key})
    result = capture(project, workspace.root / 'ensemble-products' / 'report-sources',
                     title=selection.get('title'), workspace_id=workspace.project['id'])
    root = Path(result['directory'])
    if progress:
        progress({'stage': 'import-scientific-source', 'ensemble_id': key})
    collection = workspace.import_sources(root / 'sources.json')
    choice = {'source_collection_id': collection['id'], 'source_id': SOURCE_ID}
    body, entry = workspace.source_file(choice['source_collection_id'], SOURCE_ID)
    manifest = read(root / 'sources.json')['entries'][0]
    if fingerprint(Path(body)) != fingerprint(root / 'report-source.json'):
        raise ValueError('Original source importer returned a different scientific report')
    expected = {item['path']: {field: item[field] for field in ('bytes', 'sha256')}
                for item in manifest['companions']}
    received = {item.get('view_path', item['filename']):
                {field: item[field] for field in ('bytes', 'sha256')}
                for item in entry.get('companions', [])}
    if received != expected:
        raise ValueError('Original source importer changed the complete report companions')
    receipt = {'schema': SCHEMA, 'state': 'complete', 'report_source_id': result['id'],
               'ensemble_id': key, 'project_id': workspace.project['id'], 'title': result['title'],
               'source_choice': choice, 'source_count': 1, 'companion_count': len(expected),
               'directory': str(root), 'summary': result['summary']}
    atomic(root / 'import.json', receipt)
    if progress:
        progress({'stage': 'complete', 'ensemble_id': key, 'source_choice': choice})
    return receipt


def export_source(directory, destination):
    """Export all declared source files for normal create-only source receiving."""
    root = Path(directory).resolve(strict=True)
    record = inspect(root)
    destination = Path(destination).resolve()
    if destination.is_relative_to(root):
        raise ValueError('Keep a source archive outside its captured directory')
    destination.parent.mkdir(parents=True, exist_ok=True)
    members = {item['path']: item for item in record['files']}
    members['report-source-record.json'] = {'path': 'report-source-record.json',
                                          **fingerprint(root / 'report-source-record.json')}
    if destination.exists():
        with zipfile.ZipFile(destination) as archive:
            if set(archive.namelist()) != set(members):
                raise ValueError('Existing archive has another scientific-source inventory')
            for name, item in members.items():
                checksum, count = hashlib.sha256(), 0
                with archive.open(name) as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        checksum.update(chunk)
                        count += len(chunk)
                if count != item['bytes'] or checksum.hexdigest() != item['sha256']:
                    raise ValueError('Existing source archive changed: ' + name)
        return {'path': str(destination), **fingerprint(destination), 'reused': True}
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, suffix='.zip', delete=False) as stream:
            temporary = Path(stream.name)
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name, item in sorted(members.items()):
                path = verify(root, item)
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                with path.open('rb') as incoming, archive.open(info, 'w', force_zip64=True) as outgoing:
                    shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
                verify(root, item)
        with temporary.open('rb') as stream:
            os.fsync(stream.fileno())
        os.link(temporary, destination)
    except FileExistsError:
        return export_source(root, destination)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
    return {'path': str(destination), **fingerprint(destination), 'reused': False}

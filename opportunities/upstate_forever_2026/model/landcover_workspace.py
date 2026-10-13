"""Land-cover accounting over the original retained Workspace and source readers.

The original scientific queue owns execution. No hydrology call or source/grid
writer is introduced here. Native contracts are documented in LANDCOVER_LEDGER.
"""
from __future__ import annotations
from contextlib import ExitStack
from dataclasses import asdict
import json
from pathlib import Path

from .landcover_ledger import (Options, RasterInput, LedgerError, run_ledger,
                              sha256_file, atomic_json)
from .landcover_exports import export_report, make_portable
from . import landcover_source_inputs

KIND = 'landcover-ledgers'
BINDING_SCHEMA = 'upstate.landcover-binding/v1'
EDITION_SCHEMA = 'upstate.landcover-edition/v1'


def _native():
    # Delayed import leaves the standalone file-level reducer usable independently.
    from .common import digest, held, identifier, verify_file, describe_file, read_json
    return digest, held, identifier, verify_file, describe_file, read_json


def _operand(workspace, run_id):
    digest, held, identifier, verify_file, describe_file, read_json = _native()
    run = workspace.inspect_run(identifier(run_id))
    grid = workspace.get_grid(run['selection']['grid_id'])
    scenario = workspace._get('scenarios', run['selection']['scenario_id'])
    stage = run.get('stages', {}).get('landcover')
    if stage and stage.get('artifact'):
        descriptor = stage['artifact']
        root = workspace.root / 'runs' / run_id
        basis = 'retained_landcover_stage'
    elif scenario.get('kind') == 'landcover':
        raise LedgerError('The selected land-cover edit has no completed raster yet: ' + run_id)
    else:
        descriptor = grid['files']['NLCD']
        root = workspace.root / 'grids' / grid['id']
        basis = 'retained_grid_NLCD'
    path = verify_file(root, descriptor)
    return path, grid, {
        'run_id': run_id, 'selection': run['selection'],
        'scenario': scenario, 'basis': basis,
        'raster': {**descriptor, 'path': path.relative_to(workspace.root).as_posix()},
    }


def catalog(workspace):
    data = workspace.overview()
    scenarios = {r['id']: r for r in data.get('scenarios', [])}
    runs = []
    for row in data.get('runs', []):
        selection = row.get('selection', {})
        scenario = scenarios.get(selection.get('scenario_id'), {})
        ready = scenario.get('kind') != 'landcover' or bool(
            row.get('stages', {}).get('landcover', {}).get('artifact'))
        runs.append({'id': row['id'], 'selection': selection, 'state': row.get('state'),
                     'title': scenario.get('title') or scenario.get('kind') or row['id'],
                     'landcover_ready': ready, 'scenario_kind': scenario.get('kind')})
    vectors, rasters = [], []
    for collection in data.get('sources', []):
        for entry in collection.get('entries', []):
            if entry.get('kind') == 'raster':
                rasters.append({'source_collection_id': collection['id'],
                                'source_id': entry['id'], 'title': entry['title'],
                                'vintage': entry.get('vintage'), 'uri': entry.get('uri'),
                                'role': entry.get('role'), 'body': entry['body']})
            if entry.get('kind') == 'vector':
                vectors.append({'source_collection_id': collection['id'],
                                'source_id': entry['id'], 'title': entry['title'],
                                'layer': entry.get('layer'), 'vintage': entry.get('vintage'),
                                'body': entry['body']})
    return {'schema': 'upstate.landcover-catalog/v1', 'workspace_id': workspace.project['id'],
            'runs': runs, 'vectors': vectors, 'rasters': rasters, 'editions': overview(workspace)}


def _zones(workspace, selection):
    """Preserve the original reader, source CRS, property values and feature IDs."""
    from .spatial_esri import is_esri_source, OriginalEsriFeatures
    path, entry = workspace.source_file(selection['source_collection_id'], selection['source_id'])
    if entry.get('kind') != 'vector':
        raise LedgerError('Choose a retained polygon source for reporting watersheds')
    id_field = selection.get('id_field') or 'huc12'
    name_field = selection.get('name_field') or 'name'
    selected = selection.get('ids')
    if selected is not None and (not isinstance(selected, list) or not selected or
                                any(not isinstance(x, str) for x in selected)):
        raise LedgerError('Selected watershed IDs must be a nonempty list of original strings')
    wanted = None if selected is None else set(selected)
    features, seen = [], set()
    reader_metadata = {}
    with ExitStack() as stack:
        if is_esri_source(path, entry):
            source = OriginalEsriFeatures(path, entry)
            layer = selection.get('layer')
            if layer and layer != source.name:
                raise LedgerError('Choose the original retained Esri layer name')
            crs = source.crs_wkt
            reader_metadata = source.reader_metadata
            rows = iter(source)
        else:
            import fiona
            kwargs = {}
            layer = selection.get('layer') or entry.get('layer')
            if layer:
                kwargs['layer'] = layer
            source = stack.enter_context(fiona.open(path, **kwargs))
            crs = source.crs_wkt or source.crs
            if not crs:
                raise LedgerError('The reporting source must retain its coordinate system')
            rows = iter(source)
        for feature in rows:
            properties = dict(feature['properties'])
            value = properties.get(id_field)
            if value is None or isinstance(value, (dict, list, bool)):
                raise LedgerError('Reporting feature lacks scalar field ' + id_field)
            if 'huc' in id_field.lower() and not isinstance(value, str):
                raise LedgerError('Original HUC identifiers must remain strings')
            zid = str(value)
            if wanted is not None and zid not in wanted:
                continue
            if not zid or zid in seen:
                raise LedgerError('Duplicate or empty original watershed identifier: ' + zid)
            seen.add(zid)
            geometry = feature['geometry']
            if geometry is None:
                raise LedgerError('Selected watershed has no original geometry: ' + zid)
            # Fiona mappings carry tuples; JSON normalization retains coordinates.
            geometry = json.loads(json.dumps(dict(geometry), allow_nan=False))
            retained = {'_landcover_zone_id': zid,
                        '_landcover_zone_name': str(properties.get(name_field) or zid),
                        '_source_properties': properties, '_source_feature_id': str(feature['id'])}
            if hasattr(feature, 'geometry_operations'):
                retained['_original_esri'] = {
                    'feature_index': feature.source_feature_index, 'id_basis': feature.id_basis,
                    'geometry_operations': feature.geometry_operations}
            features.append({'type': 'Feature', 'id': str(feature['id']),
                             'properties': retained, 'geometry': geometry})
        from pyproj import CRS
        crs = CRS.from_user_input(crs).to_wkt()
    if not features or wanted is not None and wanted - seen:
        raise LedgerError('The original reporting source is missing selected watershed IDs')
    return {'type': 'FeatureCollection', 'crs': {'type': 'name', 'properties': {'name': crs}},
            'features': features}, {'selection': selection, 'source_entry': entry,
                                   'reader_metadata': reader_metadata,
                                   'source_collection_id': selection['source_collection_id']}


def _selection(value):
    if not isinstance(value, dict):
        raise LedgerError('Land-cover selection must be a JSON object')
    mode = value.get('input_mode', 'runs')
    if mode not in ('runs', 'sources'):
        raise LedgerError('Choose retained runs or retained raster sources')
    if mode == 'sources':
        baseline = landcover_source_inputs.source_selection(value.get('baseline_source'))
        alternatives = value.get('alternative_sources')
        if not isinstance(alternatives, list) or not alternatives:
            raise LedgerError('Select at least one alternative raster source')
        alternatives = [landcover_source_inputs.source_selection(item) for item in alternatives]
        identities = [json.dumps(item, sort_keys=True) for item in [baseline, *alternatives]]
        if len(set(identities)) != len(identities):
            raise LedgerError('Choose distinct baseline and alternative source bands')
        inputs = {'input_mode': 'sources', 'baseline_source': baseline,
                  'alternative_sources': alternatives}
    else:
        baseline = value.get('baseline_run_id')
        alternatives = value.get('alternative_run_ids')
        if not isinstance(baseline, str) or not baseline or not isinstance(alternatives, list):
            raise LedgerError('Choose an original baseline and original alternative run IDs')
        if not alternatives or any(not isinstance(x, str) or not x for x in alternatives):
            raise LedgerError('Select at least one alternative run')
        if baseline in alternatives or len(set(alternatives)) != len(alternatives):
            raise LedgerError('Choose distinct baseline and alternative run IDs')
        inputs = {'baseline_run_id': baseline, 'alternative_run_ids': alternatives}
    zones = value.get('zones')
    if not isinstance(zones, dict) or not zones.get('source_collection_id') or not zones.get('source_id'):
        raise LedgerError('Choose an original retained reporting source')
    allowed = {'tile_size', 'support_scope', 'unknown_policy', 'allow_overlap'}
    options = value.get('options', {})
    if not isinstance(options, dict) or set(options) - allowed:
        raise LedgerError('Choose the supported window, common-support, unknown-class and overlap options')
    # The legacy run selection keeps its exact pre-existing shape and identity.
    return {**inputs, 'zones': zones, 'title': str(value.get('title') or 'Land-cover change ledger'),
            'options': options}


def _inputs(workspace, selection):
    if selection.get('input_mode') == 'sources':
        operands, keys = landcover_source_inputs.prepare(workspace, selection)
        return {'rasters': [item[0] for item in operands],
                'operands': [item[2] for item in operands], 'keys': keys,
                'schema': landcover_source_inputs.SCHEMA, 'grid_id': None,
                'grid_definition': operands[0][2]['header']['grid'],
                'grid_spec': {'input_mode': 'sources', 'resampling': 'none'}}
    operands = [_operand(workspace, rid) for rid in
                [selection['baseline_run_id'], *selection['alternative_run_ids']]]
    grid = operands[0][1]
    if any(item[1]['id'] != grid['id'] for item in operands[1:]):
        raise LedgerError('Land-cover comparisons require the same original retained grid ID')
    return {'rasters': [RasterInput(item[0]) for item in operands],
            'operands': [item[2] for item in operands],
            'keys': [item[2]['run_id'] for item in operands[1:]],
            'schema': BINDING_SCHEMA, 'grid_id': grid['id'],
            'grid_definition': grid['grid'], 'grid_spec': grid['spec']}


def preview_inputs(workspace, value):
    """Verify selected native sources and original reporting IDs without a model run."""
    selection = _selection(value)
    inputs = _inputs(workspace, selection)
    zones, zone_binding = _zones(workspace, selection['zones'])
    result = {'schema': 'upstate.landcover-input-preview/v1',
              'input_mode': selection.get('input_mode', 'runs'), 'selection': selection,
              'grid_id': inputs['grid_id'], 'grid': inputs['grid_definition'],
              'reporting': {'feature_count': len(zones['features']),
                            'source_crs': zones['crs']['properties']['name'],
                            'selection': zone_binding['selection'],
                            'source_entry': zone_binding['source_entry']},
              'checked': ['original source bytes and companions', 'integer bands and common native lattice; NLCD class values checked during build',
                          'original reporting source and selected identifiers'],
              'remaining': 'Build computes polygon intersections, valid-data coverage and class transitions.'}
    if selection.get('input_mode') == 'sources':
        result['source_editions'] = landcover_source_inputs.presentation(inputs['operands'], inputs['keys'])
        result['headers'] = [item['header'] for item in inputs['operands']]
    return result


def build(workspace, value, *, progress=None):
    digest, held, identifier, verify_file, describe_file, read_json = _native()
    selection = _selection(value)
    inputs = _inputs(workspace, selection)
    zones, zone_binding = _zones(workspace, selection['zones'])
    binding = {'schema': inputs['schema'], 'workspace_id': workspace.project['id'],
               'selection': selection, 'grid_id': inputs['grid_id'],
               'grid_definition': inputs['grid_definition'], 'grid_spec': inputs['grid_spec'],
               'operands': inputs['operands'], 'zones': zone_binding,
               'reducer_sha256': sha256_file(Path(__file__).with_name('landcover_ledger.py')),
               'adapter_sha256': sha256_file(__file__)}
    if selection.get('input_mode') == 'sources':
        binding['source_adapter_sha256'] = sha256_file(landcover_source_inputs.__file__)
    key = digest(binding)
    parent = workspace.root / KIND
    parent.mkdir(exist_ok=True)
    directory = parent / key
    with held(parent / ('.' + key + '.lock'), blocking=False):
        directory.mkdir(exist_ok=True)
        edition_path = directory / 'edition.json'
        if edition_path.exists():
            return inspect(workspace, key)['edition']
        pending_binding = directory / 'input-bindings.json'
        if pending_binding.exists() and read_json(pending_binding) != binding:
            raise LedgerError('Retained land-cover input selection changed')
        if not pending_binding.exists():
            atomic_json(pending_binding, binding)
        zone_path = directory / 'zones-original.geojson'
        if zone_path.exists() and read_json(zone_path) != zones:
            raise LedgerError('Retained land-cover reporting geometry changed')
        if not zone_path.exists():
            atomic_json(zone_path, zones)
        output = directory / 'results'
        options = Options(**selection['options'], title=selection['title'],
                          resume=(output / 'ledger.sqlite3').exists())
        # All original operands have already been verified by common.verify_file.
        report = run_ledger(inputs['rasters'][0],
                            dict(zip(inputs['keys'], inputs['rasters'][1:])),
                            zone_path, output, options=options,
                            id_field='_landcover_zone_id', name_field='_landcover_zone_name',
                            context_files=[pending_binding], progress=progress)
        if selection.get('input_mode') == 'sources':
            report['source_editions'] = landcover_source_inputs.presentation(inputs['operands'], inputs['keys'])
            atomic_json(output / 'input-editions.json', binding)
            atomic_json(output / 'ledger.json', report)
        export_report(output)
        archive = directory / 'landcover-report.zip'
        if not archive.exists():
            make_portable(output, archive)
        files = {p.name: describe_file(directory, p) for p in output.iterdir()
                 if p.is_file() and p.suffix in ('.json', '.geojson', '.csv', '.html', '.tif')
                 and p.name != 'status.json'}
        files['archive'] = describe_file(directory, archive)
        files['binding'] = describe_file(directory, pending_binding)
        files['original_zones'] = describe_file(directory, zone_path)
        edition = {'schema': EDITION_SCHEMA, 'id': key, 'title': selection['title'],
                   'workspace_id': workspace.project['id'], 'grid_id': inputs['grid_id'],
                   'selection': selection, 'binding_sha256': digest(binding),
                   'signature': report['signature'], 'zone_count': len(zones['features']),
                   'alternative_count': len(inputs['operands'])-1, 'files': files, 'state': 'complete'}
        atomic_json(edition_path, edition)
        return edition


def inspect(workspace, key):
    digest, held, identifier, verify_file, describe_file, read_json = _native()
    directory = workspace.root / KIND / identifier(key)
    edition = read_json(directory / 'edition.json')
    if edition.get('schema') != EDITION_SCHEMA or edition.get('id') != key:
        raise LedgerError('Land-cover edition identity differs')
    binding = read_json(verify_file(directory, edition['files']['binding']))
    if binding['workspace_id'] != workspace.project['id'] or digest(binding) != key:
        raise LedgerError('Land-cover edition belongs to a different source selection')
    if edition.get('selection') != binding['selection'] or edition.get('grid_id') != binding['grid_id'] or edition.get('binding_sha256') != key:
        raise LedgerError('Land-cover edition selection differs from its retained binding')
    source_mode = binding.get('schema') == landcover_source_inputs.SCHEMA
    if source_mode:
        if binding['selection'].get('input_mode') != 'sources':
            raise LedgerError('Source binding mode differs from its retained selection')
        current = _inputs(workspace, binding['selection'])
        if (not landcover_source_inputs.same_records(binding['operands'], current['operands'])
                or current['grid_id'] != binding['grid_id']
                or not landcover_source_inputs.same_grid(binding['grid_definition'], current['grid_definition'])
                or current['grid_spec'] != binding['grid_spec']):
            raise LedgerError('Original land-cover source edition or native header changed')
    elif binding.get('schema') == BINDING_SCHEMA:
        grid = workspace.get_grid(binding['grid_id'])
        if grid['grid'] != binding['grid_definition'] or grid['spec'] != binding['grid_spec']:
            raise LedgerError('Original land-cover grid changed')
    else:
        raise LedgerError('Unknown retained land-cover binding schema')
    source_selection = binding['zones']['selection']
    _, source_entry = workspace.source_file(source_selection['source_collection_id'], source_selection['source_id'])
    if source_entry != binding['zones']['source_entry']:
        raise LedgerError('Original reporting source changed')
    for descriptor in edition['files'].values():
        verify_file(directory, descriptor)
    if not source_mode:
        for operand in binding['operands']:
            original = workspace.inspect_run(operand['run_id'])
            if original['selection'] != operand['selection']:
                raise LedgerError('Original selected run changed')
            verify_file(workspace.root, operand['raster'])
    report = read_json(verify_file(directory, edition['files']['ledger.json']))
    if report.get('signature') != edition['signature']:
        raise LedgerError('Land-cover report differs from its native edition')
    if source_mode:
        if read_json(verify_file(directory, edition['files']['input-editions.json'])) != binding:
            raise LedgerError('Portable source binding differs from the original edition')
        if report.get('source_editions') != landcover_source_inputs.presentation(binding['operands'], current['keys']):
            raise LedgerError('Source chronology differs from the original edition')
    return {'edition': edition, 'binding': binding, 'report': report}


def overview(workspace):
    digest, held, identifier, verify_file, describe_file, read_json = _native()
    result = []
    for path in sorted((workspace.root / KIND).glob('*/edition.json')):
        row = read_json(path)
        if row.get('schema') != EDITION_SCHEMA or row.get('id') != path.parent.name:
            raise LedgerError('Land-cover edition metadata differs')
        result.append({key: row[key] for key in ('id', 'title', 'state', 'grid_id',
                                                'zone_count', 'alternative_count', 'selection')})
    return result


def verify_all(workspace):
    return [{'id': row['id'], 'signature': inspect(workspace, row['id'])['edition']['signature']}
            for row in overview(workspace)]

"""Verified retained annual raster inputs for the original land-cover ledger.

No raster is resampled, no modeled run is created, and original mask/auxiliary
members must belong to the same immutable source entry.
"""
from __future__ import annotations
import math
from pathlib import Path

from .common import digest, identifier
from .landcover_ledger import LedgerError, RasterInput, _grid_info

SCHEMA = 'upstate.landcover-source-binding/v1'


def source_selection(value):
    if not isinstance(value, dict) or set(value) - {'source_collection_id', 'source_id', 'band'}:
        raise LedgerError('Choose an original source collection, raster source ID and band')
    collection = identifier(value.get('source_collection_id'))
    source_id = value.get('source_id')
    band = value.get('band', 1)
    if not isinstance(source_id, str) or not source_id.strip():
        raise LedgerError('Choose a retained raster source ID')
    if isinstance(band, bool) or not isinstance(band, int) or band < 1:
        raise LedgerError('Raster band must be a positive integer')
    return {'source_collection_id': collection, 'source_id': source_id, 'band': band}


def _scalar(value):
    if value is None:
        return None
    number = float(value)
    return number if math.isfinite(number) else str(number)


def operand(workspace, value):
    import numpy as np
    import rasterio
    selection = source_selection(value)
    path, entry = workspace.source_file(selection['source_collection_id'], selection['source_id'])
    if entry.get('kind') != 'raster':
        raise LedgerError('Choose a retained categorical land-cover raster source')
    path = Path(path)
    # Workspace.source_file is the authority for native member layout and hashes.
    view = workspace.root / 'source-views' / selection['source_collection_id'] / digest(selection['source_id'])
    originals = [entry['body'], *entry.get('companions', [])]
    retained = {(view / row.get('view_path', row['filename'])).resolve(): row for row in originals}
    band = selection['band']
    with rasterio.open(path) as dataset:
        if band > dataset.count:
            raise LedgerError('Selected band is absent from original raster: ' + selection['source_id'])
        dtype = dataset.dtypes[band - 1]
        if not np.issubdtype(np.dtype(dtype), np.integer):
            raise LedgerError('Categorical land cover requires an integer raster band: ' + selection['source_id'])
        grid = _grid_info(dataset, False)
        dependencies = []
        for native_path in dataset.files:
            dependency = Path(native_path).resolve(strict=True)
            if dependency not in retained:
                raise LedgerError('Raster dependency is not a retained source companion: ' + str(native_path))
            descriptor = retained[dependency]
            dependencies.append({'path': dependency.relative_to(view.resolve()).as_posix(),
                                 'bytes': descriptor['bytes'], 'sha256': descriptor['sha256']})
        header = {'grid': grid, 'band_count': dataset.count, 'dtype': dtype,
                  'nodata': _scalar(dataset.nodatavals[band-1]),
                  'mask_flags': [flag.name for flag in dataset.mask_flag_enums[band-1]],
                  'dependencies': sorted(dependencies, key=lambda row: row['path'])}
        native_grid = (dataset.width, dataset.height, dataset.crs, dataset.transform)
    record = {'source_selection': selection, 'source_entry': entry, 'header': header,
              'basis': 'retained_categorical_source',
              'raster': {'path': path.relative_to(workspace.root).as_posix(),
                         'bytes': entry['body']['bytes'], 'sha256': entry['body']['sha256']}}
    return RasterInput(path, band), native_grid, record


def prepare(workspace, selection):
    references = [selection['baseline_source'], *selection['alternative_sources']]
    operands = [operand(workspace, reference) for reference in references]
    if any(item[1] != operands[0][1] for item in operands[1:]):
        raise LedgerError('Original raster sources must have identical width, height, CRS and affine transform; choose aligned retained editions')
    keys = ['source-' + digest(reference)[:20] for reference in references[1:]]
    if len(set(keys)) != len(keys):
        raise LedgerError('Original raster selections have colliding ledger identifiers')
    return operands, keys


def presentation(records, keys):
    def item(record, key):
        entry = record['source_entry']
        selected = record['source_selection']
        return {'key': key, 'label': entry['title'], 'source_time': entry['vintage'],
                'source_collection_id': selected['source_collection_id'],
                'source_id': selected['source_id'], 'band': selected['band'],
                'raster': record['raster'], 'source_crs': record['header']['grid']['crs'],
                'units': 'NLCD categorical class code', 'source_uri': entry['uri']}
    return {'schema': 'upstate.landcover-source-editions/v1', 'input_mode': 'sources',
            'area_method': 'fractional_polygon_overlap', 'binding_file': 'input-editions.json',
            'baseline': item(records[0], 'baseline'),
            'alternatives': [item(record, key) for record, key in zip(records[1:], keys)]}


def same_grid(original, current):
    """Keep original display metadata while checking CRS meaning and the lattice."""
    from pyproj import CRS
    if CRS.from_user_input(original['wkt']) != CRS.from_user_input(current['wkt']):
        return False
    display = {'crs', 'wkt', 'projection_method'}
    return {key: value for key, value in original.items() if key not in display} == {
        key: value for key, value in current.items() if key not in display}


def same_records(originals, current):
    if len(originals) != len(current):
        return False
    for old, new in zip(originals, current):
        if {k: v for k, v in old.items() if k != 'header'} != {
                k: v for k, v in new.items() if k != 'header'}:
            return False
        if {k: v for k, v in old['header'].items() if k != 'grid'} != {
                k: v for k, v in new['header'].items() if k != 'grid'}:
            return False
        if not same_grid(old['header']['grid'], new['header']['grid']):
            return False
    return True

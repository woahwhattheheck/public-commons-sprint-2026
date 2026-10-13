"""Streaming, exact paired-raster ensemble analysis.

Positive effect = baseline - alternative. Arrays retain physical pixel-mass
units; nodata never becomes zero. Quantiles are descriptive order statistics
of the explicitly supplied members, not confidence intervals.

Copyright 2026 TokenJunkieLabs.
"""
from __future__ import annotations
from collections import OrderedDict
import math
import os
from pathlib import Path
import time
import numpy as np
import rasterio
from rasterio.windows import Window, transform as window_transform
from .ensemble_store import atomic, canonical, digest, fingerprint, held, now, read, verify

SCHEMA = 'upstate.paired-raster-ensemble/v1'
UNITS = {'nitrogen_export': 'kg/pixel/year',
         'phosphorus_export': 'kg/pixel/year',
         'sediment_export': 'metric_tonnes/pixel/year'}
TOTAL_UNITS = {'nitrogen_export': 'kg/year', 'phosphorus_export': 'kg/year',
               'sediment_export': 'metric_tonnes/year'}
SUPPORT = {'all_pairs', 'available_pairs', 'all_pairs_all_pollutants'}
BASE_BANDS = ('valid_pairs', 'improved_pairs', 'common_support', 'fraction_improved',
              'mean_reduction', 'minimum_reduction', 'maximum_reduction')
COUNT_NODATA = 4294967295
FLOAT_NODATA = -1.7976931348623157e308


def quantile_name(value):
    return 'q' + format(value, '.12g').replace('.', '_') + '_reduction'


def checked_quantiles(values):
    if not isinstance(values, list) or not values:
        raise ValueError('Select at least one explicit quantile')
    output = []
    for q in values:
        if isinstance(q, bool) or not isinstance(q, (int, float)) or not math.isfinite(q) or not 0 <= q <= 1:
            raise ValueError('Quantiles must be finite numbers between zero and one')
        output.append(float(q))
    if len(set(output)) != len(output):
        raise ValueError('Duplicate quantiles are not meaningful')
    names = [quantile_name(q) for q in output]
    if len(set(names)) != len(names):
        raise ValueError('Quantile labels collide at 12 significant digits; separate the selected levels')
    return sorted(output)


def _same_grid(ds, grid):
    if ds.count != 1 or ds.width != grid['width'] or ds.height != grid['height']:
        raise ValueError('Every selected mass raster must be single-band on the same grid')
    if ds.crs is None or ds.crs.to_wkt() != grid['crs_wkt'] or list(ds.transform)[:6] != grid['transform']:
        raise ValueError('Selected ensemble rasters differ in CRS or affine alignment')


def _grid(path):
    with rasterio.open(path) as ds:
        if ds.crs is None or ds.count != 1:
            raise ValueError('Select a single-band reporting mask with a defined CRS')
        transform = list(ds.transform)[:6]
        result = {'width': ds.width, 'height': ds.height, 'crs_wkt': ds.crs.to_wkt(),
                  'transform': transform, 'reporting_rule': 'finite nonzero reporting-mask pixels'}
        area = None
        if ds.crs.is_projected:
            _, factor = ds.crs.linear_units_factor
            a, b, _, d, e, _ = transform
            area = abs(a*e-b*d)*factor*factor/10000.0
        result['projected_pixel_area_ha'] = area
        if abs(transform[0]*transform[4]-transform[1]*transform[3]) == 0:
            raise ValueError('Reporting mask has a singular affine transform')
        return result


class RasterPool:
    """Bounded open handles; no bound on the number of analysed members."""
    def __init__(self, maximum=48):
        if not isinstance(maximum, int) or maximum < 2:
            raise ValueError('Select at least two open raster handles')
        self.maximum = maximum
        self.items = OrderedDict()

    def get(self, path):
        name = str(path)
        if name in self.items:
            item = self.items.pop(name)
            self.items[name] = item
            return item
        while len(self.items) >= self.maximum:
            _, old = self.items.popitem(last=False)
            old.close()
        item = rasterio.open(name)
        self.items[name] = item
        return item

    def close(self):
        for item in self.items.values():
            item.close()
        self.items.clear()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def _array(ds, window):
    value = ds.read(1, window=window, masked=True, out_dtype='float64')
    data = np.asarray(value.data, dtype=np.float64)
    valid = ~np.ma.getmaskarray(value) & np.isfinite(data)
    return data, valid


def _pair(pool, member, pollutant, window, reporting):
    files = member['rasters'][pollutant]
    baseline, bv = _array(pool.get(files['baseline']['absolute_path']), window)
    alternative, av = _array(pool.get(files['alternative']['absolute_path']), window)
    bv &= reporting
    av &= reporting
    valid = bv & av
    with np.errstate(over='raise', invalid='raise'):
        effect = np.subtract(baseline, alternative, where=valid, out=np.full(baseline.shape, np.nan))
    if np.any(valid & ~np.isfinite(effect)):
        raise ValueError('A finite physical input produced a nonfinite paired difference')
    return baseline, alternative, bv, av, valid, effect


def _sum(values, mask):
    if not np.any(mask):
        return 0.0
    with np.errstate(over='raise', invalid='raise'):
        result = float(np.sum(values, where=mask, dtype=np.float64))
    if not math.isfinite(result):
        raise ValueError('Physical aggregation overflowed float64')
    return result


def _member_totals(baseline, alternative, bv, av, valid, common, effect, threshold):
    return {
        'baseline_valid_cells': int(np.count_nonzero(bv)),
        'alternative_valid_cells': int(np.count_nonzero(av)),
        'paired_valid_cells': int(np.count_nonzero(valid)),
        'baseline_total_own_support': _sum(baseline, bv),
        'alternative_total_own_support': _sum(alternative, av),
        'baseline_total_paired_support': _sum(baseline, valid),
        'alternative_total_paired_support': _sum(alternative, valid),
        'reduction_total_paired_support': _sum(effect, valid),
        'baseline_total_common_support': _sum(baseline, common),
        'alternative_total_common_support': _sum(alternative, common),
        'reduction_total_common_support': _sum(effect, common),
        'improved_common_cells': int(np.count_nonzero(common & (effect > threshold))),
        'worsened_common_cells': int(np.count_nonzero(common & (effect < -threshold))),
        'baseline_negative_cells': int(np.count_nonzero(bv & (baseline < 0))),
        'alternative_negative_cells': int(np.count_nonzero(av & (alternative < 0))),
    }


def exact_statistics(cube, reporting, common, quantiles, threshold, support):
    """In-place column order statistics; NaNs are absent members, never zeros.

    The linear quantile is x[floor((n-1)q)]*(1-w)+x[ceil((n-1)q)]*w.
    It exactly matches NumPy's method='linear' to floating-point precision.
    """
    finite = np.isfinite(cube)
    counts = np.count_nonzero(finite, axis=0).astype(np.uint32)
    improved = np.count_nonzero(finite & (cube > threshold), axis=0).astype(np.uint32)
    with np.errstate(over='raise', invalid='raise'):
        sums = np.nansum(cube, axis=0, dtype=np.float64)
    selected = reporting & ((counts > 0) if support == 'available_pairs' else common)
    result = {'valid_pairs': counts.astype(np.float64), 'improved_pairs': improved.astype(np.float64),
              'common_support': common.astype(np.float64)}
    result['common_support'][~reporting] = np.nan
    result['valid_pairs'][~reporting] = np.nan
    result['improved_pairs'][~reporting] = np.nan
    for name, values in (
        ('fraction_improved', np.divide(improved, counts, out=np.full(counts.shape, np.nan), where=counts > 0)),
        ('mean_reduction', np.divide(sums, counts, out=np.full(counts.shape, np.nan), where=counts > 0)),
    ):
        values[~selected] = np.nan
        result[name] = values
    del finite, sums
    # NumPy places NaNs at the end. Sorting is in-place and the cube is disposable.
    cube.sort(axis=0)
    def select(q):
        index = np.maximum(counts.astype(np.int64)-1, 0)*q
        lower = np.floor(index).astype(np.int64)
        upper = np.ceil(index).astype(np.int64)
        low = np.take_along_axis(cube, lower[None, ...], axis=0)[0]
        high = np.take_along_axis(cube, upper[None, ...], axis=0)[0]
        weight = index-lower
        with np.errstate(invalid='ignore', over='raise'):
            value = low*(1-weight)+high*weight
        value[~selected] = np.nan
        return value
    result['minimum_reduction'] = select(0)
    result['maximum_reduction'] = select(1)
    for q in quantiles:
        result[quantile_name(q)] = select(q)
    return result


def _profile(grid, width, height, transform, count=1):
    # Tiles are lossless float64. Output count maps are materialized as uint32.
    return {'driver': 'GTiff', 'width': width, 'height': height, 'count': count,
            'dtype': 'float64', 'crs': grid['crs_wkt'], 'transform': transform,
            'nodata': FLOAT_NODATA, 'compress': 'deflate', 'predictor': 3,
            'tiled': True, 'blockxsize': 128, 'blockysize': 128, 'BIGTIFF': 'IF_SAFER'}


def _fsync(path):
    with Path(path).open('rb') as f:
        os.fsync(f.fileno())


def _write_tile(directory, key, grid, window, products, summaries, bands):
    """Close+sync native file before publishing its complete tile record."""
    tile_dir = directory / 'tiles'
    tile_dir.mkdir(exist_ok=True)
    final = tile_dir / (key + '.tif')
    pending = tile_dir / ('.' + key + '.pending.tif')
    pending.unlink(missing_ok=True)
    transform = window_transform(window, rasterio.Affine(*grid['transform']))
    profile = _profile(grid, int(window.width), int(window.height), transform, len(bands))
    try:
        with rasterio.open(pending, 'w', **profile) as ds:
            for index, band in enumerate(bands, 1):
                value = products[band['pollutant']][band['name']]
                ds.write(np.where(np.isfinite(value), value, FLOAT_NODATA), index)
                ds.set_band_description(index, band['pollutant'] + '/' + band['name'])
                ds.set_band_unit(index, band['units'])
            ds.update_tags(effect_direction='baseline minus alternative', ensemble_schema=SCHEMA)
        _fsync(pending)
        os.replace(pending, final)
        record = {'window': [int(window.col_off), int(window.row_off), int(window.width), int(window.height)],
                  'path': final.relative_to(directory).as_posix(), **fingerprint(final),
                  'summaries': summaries}
        atomic(tile_dir / (key + '.json'), record)
        return record
    finally:
        pending.unlink(missing_ok=True)


def _tile_key(window):
    return str(int(window.row_off)) + '-' + str(int(window.col_off))


def _windows(grid, edge):
    for row in range(0, grid['height'], edge):
        for col in range(0, grid['width'], edge):
            yield Window(col, row, min(edge, grid['width']-col), min(edge, grid['height']-row))


def _bind(spec):
    """Verify all physical sources and freeze a path-independent input identity."""
    if spec.get('schema') != 'upstate.ensemble-input/v1':
        raise ValueError('Use upstate.ensemble-input/v1')
    for name in ('title', 'purpose', 'input_description'):
        if not isinstance(spec.get(name), str) or not spec[name].strip():
            raise ValueError('Describe the ensemble ' + name.replace('_', ' '))
    if spec.get('support', 'all_pairs') not in SUPPORT:
        raise ValueError('Choose all_pairs, available_pairs or all_pairs_all_pollutants')
    quantiles = checked_quantiles(spec.get('quantiles', [0.1, 0.5, 0.9]))
    pollutants = spec.get('pollutants')
    if not isinstance(pollutants, list) or not pollutants or len(set(pollutants)) != len(pollutants) or any(p not in UNITS for p in pollutants):
        raise ValueError('Select distinct nitrogen_export, phosphorus_export or sediment_export products')
    members = spec.get('members')
    if not isinstance(members, list) or not members:
        raise ValueError('Select at least one explicitly paired model member')
    if len(members) >= COUNT_NODATA:
        raise ValueError('The selected cohort exceeds uint32 count storage')
    reporting = Path(spec['reporting_mask']).resolve(strict=True)
    grid = _grid(reporting)
    sources, seen = [], set()
    for member in members:
        key = member.get('id')
        if not isinstance(key, str) or not key or key in seen:
            raise ValueError('Each paired member needs a distinct nonempty ID')
        seen.add(key)
        rasters, identity = {}, {k: member.get(k) for k in ('id', 'profile_id', 'baseline_run_id', 'alternative_run_id', 'scenario_id')}
        identity['rasters'] = {}
        for pollutant in pollutants:
            selection = member['rasters'][pollutant]
            if selection.get('units') != UNITS[pollutant]:
                raise ValueError('Expected ' + UNITS[pollutant] + ' for ' + pollutant + '; do not pass an areal-rate raster')
            rasters[pollutant] = {'units': UNITS[pollutant]}
            identity['rasters'][pollutant] = {'units': UNITS[pollutant]}
            for side in ('baseline', 'alternative'):
                record = selection[side]
                if isinstance(record, str):
                    record = {'path': record}
                path = Path(record['path']).resolve(strict=True)
                if not path.is_file():
                    raise ValueError('A selected result is not a regular file')
                actual = fingerprint(path)
                for field in ('sha256', 'bytes'):
                    if field in record and actual[field] != record[field]:
                        raise ValueError('Selected ' + side + ' result differs: ' + key + '/' + pollutant)
                with rasterio.open(path) as ds:
                    _same_grid(ds, grid)
                rasters[pollutant][side] = {**actual, 'absolute_path': str(path)}
                identity['rasters'][pollutant][side] = actual
        sources.append({**identity, 'rasters': rasters})
    thresholds = {}
    for pollutant in pollutants:
        value = spec.get('improvement_thresholds', {}).get(pollutant, 0.0)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            raise ValueError('Improvement thresholds must be finite nonnegative values in the selected pixel-mass units')
        thresholds[pollutant] = float(value)
    original_size = spec.get('planned_member_count', len(members))
    if isinstance(original_size, bool) or not isinstance(original_size, int) or original_size < len(members):
        raise ValueError('Planned-member count must include all selected members')
    selected = {'schema': SCHEMA, 'title': spec['title'], 'purpose': spec['purpose'],
                'input_description': spec['input_description'],
                'input_kind': spec.get('input_kind', 'explicit paired rasters'),
                'source_references': spec.get('source_references', []),
                'quantiles': quantiles, 'quantile_method': 'linear; (n-1)*q',
                'kernel_sha256': fingerprint(Path(__file__))['sha256'],
                'support': spec.get('support', 'all_pairs'), 'pollutants': pollutants,
                'improvement_thresholds': thresholds, 'planned_member_count': original_size,
                'selected_member_count': len(members), 'grid': grid,
                'reporting_mask': fingerprint(reporting),
                'members': [{**m, 'rasters': {
                    p: {**{'units': UNITS[p]}, **{s: {k: v for k, v in m['rasters'][p][s].items() if k != 'absolute_path'}
                                               for s in ('baseline', 'alternative')}}
                    for p in pollutants}} for m in sources]}
    return selected, sources, reporting


def _distribution(values, quantiles):
    if not values:
        return None
    a = np.asarray(values, dtype=np.float64)
    if not np.all(np.isfinite(a)):
        raise ValueError('Nonfinite basin-level ensemble values')
    return {'members': len(values), 'minimum': float(a.min()), 'maximum': float(a.max()),
            'mean': float(a.mean()),
            'quantiles': [{'q': q, 'value': float(np.quantile(a, q, method='linear'))} for q in quantiles]}


def _totals(selected, records):
    output = {}
    for p in selected['pollutants']:
        output[p] = {'units': TOTAL_UNITS[p], 'reporting_cells': 0, 'common_cells': 0,
                     'any_pair_cells': 0, 'partial_pair_cells': 0,
                     'members': [{k: m.get(k) for k in ('id', 'profile_id', 'baseline_run_id', 'alternative_run_id', 'scenario_id')}
                                 for m in selected['members']]}
    # Compensated accumulation of block sums reduces error on large rasters.
    compensations = {}
    def add(target, key, value, identity):
        if isinstance(value, int):
            target[key] = target.get(key, 0) + value
        else:
            ckey = identity + (key,)
            previous = target.get(key, 0.0)
            corrected = value-compensations.get(ckey, 0.0)
            updated = previous+corrected
            compensations[ckey] = (updated-previous)-corrected
            target[key] = updated
    for record in records:
        for p, summary in record['summaries'].items():
            dest = output[p]
            for field in ('reporting_cells', 'common_cells', 'any_pair_cells', 'partial_pair_cells'):
                add(dest, field, summary[field], (p,))
            for i, member in enumerate(summary['members']):
                for field, value in member.items():
                    add(dest['members'][i], field, value, (p, i))
    for p, result in output.items():
        count = result['common_cells']
        total = result['reporting_cells']
        result['common_coverage_fraction'] = count/total if total else None
        result['reporting_projected_grid_area_ha'] = total*selected['grid']['projected_pixel_area_ha'] if selected['grid']['projected_pixel_area_ha'] is not None else None
        result['common_projected_grid_area_ha'] = count*selected['grid']['projected_pixel_area_ha'] if selected['grid']['projected_pixel_area_ha'] is not None else None
        for member in result['members']:
            base = member['baseline_total_common_support']
            delta = member['reduction_total_common_support']
            member['reduction_percent_common_support'] = 100*delta/base if count and base else None
            member['common_cells'] = count
            for count_field, fields in (
                ('baseline_valid_cells', ('baseline_total_own_support',)),
                ('alternative_valid_cells', ('alternative_total_own_support',)),
                ('paired_valid_cells', ('baseline_total_paired_support', 'alternative_total_paired_support', 'reduction_total_paired_support')),
            ):
                if not member[count_field]:
                    for field in fields:
                        member[field] = None
            if not count:
                for field in ('baseline_total_common_support', 'alternative_total_common_support', 'reduction_total_common_support'):
                    member[field] = None
        result['basin_reduction_distribution_common_support'] = _distribution(
            [m['reduction_total_common_support'] for m in result['members']], selected['quantiles']) if count else None
        result['basin_quantile_definition'] = 'quantile of whole-basin paired member totals on the same common cells; not a sum of pixel quantiles'
    return output


def analyze(spec, output, *, memory_mb=256, tile_size=256, max_open_datasets=48,
            on_progress=None, should_cancel=None):
    """Build/reopen a complete raster ensemble with durable per-tile recovery.

    Memory scales with members times tile pixels, not full-grid pixels. Exact
    member quantiles are computed tilewise. File outputs and completed tile
    records are hash-bound; interrupted materialization resumes from tile files.
    """
    if not isinstance(memory_mb, (int, float)) or isinstance(memory_mb, bool) or not math.isfinite(memory_mb) or memory_mb <= 0:
        raise ValueError('Select a positive memory budget in MiB')
    if isinstance(tile_size, bool) or not isinstance(tile_size, int) or not 1 <= tile_size <= 2048:
        raise ValueError('Select a tile edge between 1 and 2048 pixels')
    selected, members, reporting_path = _bind(spec)
    key = digest(selected)
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    directory = root / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / '.analysis.lock'):
        manifest_path = directory / 'analysis.json'
        if manifest_path.exists():
            previous = read(manifest_path)
            if previous.get('id') != key or previous.get('selection') != selected:
                raise ValueError('Retained ensemble selection changed')
            if previous.get('state') == 'complete':
                try:
                    for artifact in previous['artifacts'].values():
                        verify(directory, artifact)
                except (OSError, ValueError):
                    # Final products are derived; rebuild them from verified
                    # tiles rather than rerunning original scientific models.
                    pass
                else:
                    return {**previous, 'directory': str(directory), 'reused': True}
        n = len(members)
        # Conservative allowance for float64 cube, sorting, masks, and products.
        per_pixel = 16*n + 128*(len(BASE_BANDS)+len(selected['quantiles']))*len(selected['pollutants'])
        allowed_pixels = int(memory_mb*1024**2 // per_pixel)
        if allowed_pixels < 1:
            raise ValueError('The selected memory budget cannot hold one pixel of this full member cohort; increase memory_mb')
        edge = min(tile_size, max(1, math.isqrt(allowed_pixels)))
        execution_path = directory / 'execution.json'
        execution = {'tile_edge': edge, 'memory_mb': float(memory_mb), 'member_count': n}
        # A resumed analysis preserves its original tile grid even if the caller
        # chooses a different budget. It must still fit the new chosen budget.
        if execution_path.exists():
            original = read(execution_path)
            edge = original['tile_edge']
            if edge*edge > allowed_pixels:
                raise ValueError('Resume needs the original tile working memory; choose a larger memory_mb')
        else:
            atomic(execution_path, execution, immutable=True)
        grid = selected['grid']
        bands = []
        for pollutant in selected['pollutants']:
            for name in (*BASE_BANDS, *(quantile_name(q) for q in selected['quantiles'])):
                units = 'count' if name in ('valid_pairs', 'improved_pairs', 'common_support') else 'fraction' if name == 'fraction_improved' else UNITS[pollutant]
                bands.append({'pollutant': pollutant, 'name': name, 'units': units})
        state = {'schema': SCHEMA, 'id': key, 'selection': selected,
                 'state': 'running', 'started_at': now(), 'bands': bands,
                 'effect_direction': 'baseline minus alternative; positive = reduction',
                 'interpretation': 'Descriptive variation over selected parameter members. No probability or confidence interval is assigned.',
                 'coverage_rule': 'common support requires every selected pair; available support is reported separately',
                 'artifacts': {}}
        atomic(manifest_path, state)
        record_paths = []
        clock = time.monotonic()
        total_tiles = math.ceil(grid['width']/edge)*math.ceil(grid['height']/edge)
        try:
            with RasterPool(max_open_datasets) as pool:
                for tile_number, window in enumerate(_windows(grid, edge)):
                    if should_cancel and should_cancel():
                        state.update(state='paused', tiles_complete=len(record_paths), updated_at=now())
                        atomic(manifest_path, state)
                        return {**state, 'directory': str(directory)}
                    tile_key = _tile_key(window)
                    record_path = directory / 'tiles' / (tile_key + '.json')
                    if record_path.exists():
                        record = read(record_path)
                        expected_window = [int(window.col_off), int(window.row_off), int(window.width), int(window.height)]
                        if record['window'] != expected_window:
                            raise ValueError('Retained tile window changed')
                        try:
                            verify(directory, record)
                        except (OSError, ValueError):
                            # Only this derived tile is recomputed. Originals
                            # were independently verified in the input binding.
                            pass
                        else:
                            record_paths.append(record_path)
                            if on_progress:
                                on_progress({'id': key, 'phase': 'tiles', 'complete': tile_number+1, 'total': total_tiles, 'reused_tile': True})
                            continue
                    reporting, rv = _array(pool.get(reporting_path), window)
                    reporting = rv & (reporting != 0)
                    joint = reporting.copy()
                    if selected['support'] == 'all_pairs_all_pollutants':
                        for p in selected['pollutants']:
                            for member in members:
                                _, _, _, _, valid, _ = _pair(pool, member, p, window, reporting)
                                joint &= valid
                    products, summaries = {}, {}
                    for pollutant in selected['pollutants']:
                        cube = np.empty((n, int(window.height), int(window.width)), dtype=np.float64)
                        alternatives = np.empty_like(cube)
                        common = joint.copy()
                        empty = np.zeros(common.shape, dtype=bool)
                        threshold = selected['improvement_thresholds'][pollutant]
                        member_summaries = []
                        # Keep two tile-local cohorts, not a second source pass.
                        # The baseline cohort becomes the disposable effect
                        # cohort after original baseline/alternative sums finish.
                        for i, member in enumerate(members):
                            baseline, alternative, bv, av, valid, effect = _pair(pool, member, pollutant, window, reporting)
                            cube[i] = np.where(valid, baseline, np.nan)
                            alternatives[i] = np.where(valid, alternative, np.nan)
                            common &= valid
                            member_summaries.append(_member_totals(baseline, alternative, bv, av, valid, empty, effect, threshold))
                        counts = np.count_nonzero(np.isfinite(cube), axis=0)
                        summary = {'reporting_cells': int(np.count_nonzero(reporting)),
                                   'common_cells': int(np.count_nonzero(common)),
                                   'any_pair_cells': int(np.count_nonzero(counts > 0)),
                                   'partial_pair_cells': int(np.count_nonzero((counts > 0) & (counts < n))),
                                   'members': member_summaries}
                        for i, row in enumerate(member_summaries):
                            row['baseline_total_common_support'] = _sum(cube[i], common)
                            row['alternative_total_common_support'] = _sum(alternatives[i], common)
                            with np.errstate(over='raise', invalid='ignore'):
                                cube[i] -= alternatives[i]
                            row['reduction_total_common_support'] = _sum(cube[i], common)
                            row['improved_common_cells'] = int(np.count_nonzero(common & (cube[i] > threshold)))
                            row['worsened_common_cells'] = int(np.count_nonzero(common & (cube[i] < -threshold)))
                        del alternatives
                        products[pollutant] = exact_statistics(cube, reporting, common, selected['quantiles'], threshold, selected['support'])
                        summaries[pollutant] = summary
                        del cube
                    _write_tile(directory, tile_key, grid, window, products, summaries, bands)
                    record_paths.append(record_path)
                    if on_progress:
                        on_progress({'id': key, 'phase': 'tiles', 'complete': tile_number+1, 'total': total_tiles, 'reused_tile': False})
            totals = _totals(selected, (read(p) for p in record_paths))
            artifacts = _materialize(directory, selected, bands, record_paths, on_progress=on_progress)
            state.update(state='complete', completed_at=now(), elapsed_seconds_this_invocation=time.monotonic()-clock,
                         tiles_complete=len(record_paths), summary=totals, artifacts=artifacts,
                         selected_members=n, selected_fraction_of_planned=n/selected['planned_member_count'])
            atomic(manifest_path, state)
            return {**state, 'directory': str(directory)}
        except BaseException as error:
            state.update(state='interrupted' if not isinstance(error, Exception) else 'failed',
                         updated_at=now(), tiles_complete=len(record_paths),
                         error={'type': type(error).__name__, 'message': str(error)})
            atomic(manifest_path, state)
            raise


def _materialize(directory, selected, bands, record_paths, *, on_progress=None):
    grid = selected['grid']
    transform = rasterio.Affine(*grid['transform'])
    artifacts = {}
    for index, band in enumerate(bands, 1):
        name = band['pollutant'] + '--' + band['name']
        destination = directory / (name + '.tif')
        pending = directory / ('.' + name + '.pending.tif')
        pending.unlink(missing_ok=True)
        profile = _profile(grid, grid['width'], grid['height'], transform)
        is_count = band['units'] == 'count'
        if is_count:
            profile.update(dtype='uint32', nodata=COUNT_NODATA, predictor=2)
        try:
            with rasterio.open(pending, 'w', **profile) as dst:
                dst.set_band_description(1, name)
                dst.set_band_unit(1, band['units'])
                dst.update_tags(ensemble_id=digest(selected),
                                units=band['units'], member_count=str(len(selected['members'])),
                                effect_direction='baseline minus alternative',
                                support=selected['support'],
                                quantile_method=selected['quantile_method'],
                                interpretation='descriptive tested-member variation; not a confidence interval')
                for record_path in record_paths:
                    record = read(record_path)
                    with rasterio.open(directory / record['path']) as src:
                        values = src.read(index, masked=True)
                    if is_count:
                        array = np.where(np.ma.getmaskarray(values), COUNT_NODATA, values.data).astype('uint32')
                    else:
                        array = values.filled(FLOAT_NODATA)
                    dst.write(array, 1, window=Window(*record['window']))
            _fsync(pending)
            os.replace(pending, destination)
            artifacts[name] = {'path': destination.name, **fingerprint(destination),
                               'pollutant': band['pollutant'], 'statistic': band['name'], 'units': band['units']}
            if on_progress:
                on_progress({'id': digest(selected), 'phase': 'export', 'complete': index, 'total': len(bands)})
        finally:
            pending.unlink(missing_ok=True)
    return artifacts

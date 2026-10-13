"""Saved-result comparison without zero-filling, unit coercion or cross-family joins."""
from __future__ import annotations
import math
import numbers
import pandas as pd


def _number(value):
    return isinstance(value, numbers.Real) and not isinstance(value, bool) and math.isfinite(float(value))


def _metric_rows(result):
    rows = result.get('metrics')
    if isinstance(rows, pd.DataFrame) and {'metric', 'value', 'unit'} <= set(rows.columns):
        if rows['metric'].isna().any() or rows['metric'].duplicated().any():
            raise ValueError('Metric names must be unique and non-null')
        return {r['metric']: r for r in rows.to_dict('records')}
    # A summary without declared units remains readable, but cannot yield a physical delta.
    return {k: {'metric': k, 'value': v, 'unit': None, 'label': k}
            for k, v in result.get('summary', {}).items() if _number(v)}


def compare_runs(baseline: dict, candidate: dict, spatial_keys: tuple[str, ...] = ('source_cell_id',)) -> dict:
    family = baseline.get('family')
    if not family or candidate.get('family') != family:
        raise ValueError('Choose baseline and candidate from the same model family')
    left, right = _metric_rows(baseline), _metric_rows(candidate)
    rows = []
    for key in sorted(left.keys() | right.keys(), key=str):
        a, b = left.get(key), right.get(key)
        av, bv = a.get('value') if a else None, b.get('value') if b else None
        au, bu = a.get('unit') if a else None, b.get('unit') if b else None
        status = ('baseline_missing' if not a else 'candidate_missing' if not b else
                  'unit_missing' if au is None or bu is None else 'unit_mismatch' if au != bu else
                  'value_missing' if not _number(av) or not _number(bv) else 'paired')
        delta = float(bv) - float(av) if status == 'paired' else None
        percent = 100 * delta / abs(float(av)) if status == 'paired' and av != 0 else None
        rows.append({'metric': key, 'label': (b or a).get('label', key),
                     'unit': au if au == bu else None, 'baseline_unit': au, 'candidate_unit': bu,
                     'baseline': av, 'candidate': bv, 'delta': delta, 'delta_percent': percent,
                     'relative_change': 'zero_baseline' if status == 'paired' and av == 0 else status,
                     'status': status})
    a, b = baseline.get('spatial'), candidate.get('spatial')
    spatial = pd.DataFrame()
    if isinstance(a, pd.DataFrame) and isinstance(b, pd.DataFrame):
        keys = list(spatial_keys)
        for name, frame in [('baseline', a), ('candidate', b)]:
            if not set(keys) <= set(frame.columns): raise ValueError(f'{name} spatial output lacks {keys}')
            if frame[keys].isna().any().any(): raise ValueError(f'{name} has null spatial identity')
            if frame.duplicated(keys).any(): raise ValueError(f'{name} spatial identities repeat; include time/constituent in spatial_keys')
        # Do not cast source identifiers to numbers; leading zeros are meaningful.
        for key in keys:
            if a[key].dtype != b[key].dtype: raise ValueError(f'Spatial key dtype differs for {key}')
        spatial = a.merge(b, on=keys, how='outer', suffixes=('_baseline','_candidate'),
                          validate='one_to_one', indicator='pair_status')
        # This field names its physical unit explicitly in the original provider contract.
        col = 'nitrate_final_mg_l'
        if col in a and col in b:
            spatial['nitrate_delta_mg_l'] = spatial[col+'_candidate'] - spatial[col+'_baseline']
    source_a = baseline.get('_ecsa_execution', {}).get('snapshot_sha')
    source_b = candidate.get('_ecsa_execution', {}).get('snapshot_sha')
    return {'baseline_run_id': baseline['run_id'], 'candidate_run_id': candidate['run_id'],
            'family': family, 'metrics': pd.DataFrame(rows), 'spatial_delta': spatial,
            'source_editions': {'baseline': source_a, 'candidate': source_b,
                               'same_snapshot': source_a == source_b if source_a and source_b else None},
            'delta_convention': 'candidate minus baseline',
            'input_changes': input_changes(baseline, candidate)}


def input_changes(a, b):
    from . import codec
    a = a.get('_ecsa_execution', {}).get('original_inputs', a.get('inputs', {}))
    b = b.get('_ecsa_execution', {}).get('original_inputs', b.get('inputs', {}))
    return {key: {'baseline': a.get(key), 'candidate': b.get(key),
                  'baseline_present': key in a, 'candidate_present': key in b}
            for key in sorted(a.keys() | b.keys())
            if key not in a or key not in b or codec.dumps(a[key]) != codec.dumps(b[key])}

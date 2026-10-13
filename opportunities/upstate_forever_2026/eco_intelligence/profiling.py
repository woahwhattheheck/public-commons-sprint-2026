"""Complete-population streaming analysis. Summaries never imply sampled coverage."""
from __future__ import annotations
import csv
import json
import math
import sqlite3
import tempfile
from pathlib import Path
from typing import Iterator, Any
from .common import IntelligenceError, finite
from .native_catalog import raster_unit_declarations

class Moments:
    """Mergeable Welford population moments; works for raster blocks and table cells."""
    def __init__(self):
        self.n = 0
        self.mean = self.m2 = self.total = 0.0
        self.lo = self.hi = None

    def merge(self, n: int, mean: float, m2: float, total: float, lo: float, hi: float):
        if not n:
            return
        combined = self.n + n
        delta = mean - self.mean
        self.m2 += m2 + delta * delta * self.n * n / combined
        self.mean += delta * n / combined
        self.n = combined
        self.total += total
        self.lo = lo if self.lo is None else min(self.lo, lo)
        self.hi = hi if self.hi is None else max(self.hi, hi)

    def add(self, value: float):
        self.merge(1, value, 0., value, value, value)

    def array(self, values):
        import numpy as np
        a = np.asarray(values, dtype='float64')
        a = a[np.isfinite(a)]
        if a.size:
            mean = float(a.mean())
            self.merge(int(a.size), mean, float(np.square(a - mean).sum()), float(a.sum()), float(a.min()), float(a.max()))

    def result(self):
        return {'count': self.n, 'min': self.lo, 'max': self.hi,
                'mean': self.mean if self.n else None, 'sum': self.total if self.n else None,
                'population_stddev': math.sqrt(max(0., self.m2 / self.n)) if self.n else None}


def rows(path: Path) -> Iterator[dict[str, Any]]:
    suffix = path.suffix.lower()
    if suffix in {'.csv', '.tsv'}:
        with path.open(encoding='utf-8-sig', newline='') as f:
            reader = csv.DictReader(f, delimiter='\t' if suffix == '.tsv' else ',')
            if not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames)):
                raise IntelligenceError('Table headers must be present and unique.')
            for row in reader:
                if None in row:
                    raise IntelligenceError('A table row contains more values than its header.')
                yield row
    elif suffix in {'.jsonl', '.ndjson'}:
        with path.open(encoding='utf-8-sig') as f:
            for index, line in enumerate(f, 1):
                if not line.strip():
                    continue
                row = json.loads(line)
                if not isinstance(row, dict):
                    raise IntelligenceError(f'JSONL row {index} must be an object.')
                yield row
    else:
        raise IntelligenceError('Tabular analysis supports CSV, TSV, JSONL and NDJSON.')


def table_profile(path: Path) -> dict:
    columns: dict[str, dict] = {}
    count = 0
    for row in rows(path):
        for key in row:
            if key not in columns:
                columns[key] = {'missing': count, 'non_numeric': 0, 'numeric': Moments()}
        for key, col in columns.items():
            value = row.get(key)
            if value is None or value == '':
                col['missing'] += 1
            else:
                number = finite(value)
                if number is None:
                    col['non_numeric'] += 1
                else:
                    col['numeric'].add(number)
        count += 1
    return {'format': 'table', 'population': 'complete', 'rows': count,
            'columns': {k: {'missing': v['missing'], 'non_numeric_or_nonfinite': v['non_numeric'],
                            'numeric': v['numeric'].result()} for k, v in columns.items()}}


def raster_profile(path: Path) -> dict:
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    bands = []
    with rasterio.open(path) as src:
        for band in range(1, src.count + 1):
            unit_info = raster_unit_declarations(src, band)
            moments = Moments()
            for top in range(0, src.height, 512):
                for left in range(0, src.width, 512):
                    window = Window(left, top, min(512, src.width-left), min(512, src.height-top))
                    values = src.read(band, window=window, masked=True).compressed()
                    moments.array(values)
            bands.append({'band': band, 'description': src.descriptions[band-1],
                          'unit': unit_info['unit'], 'unit_declarations': unit_info['declarations'], 'valid': moments.n,
                          'excluded_masked_or_nonfinite': src.width * src.height - moments.n,
                          'statistics': moments.result()})
        return {'format': 'raster', 'population': 'complete', 'width': src.width, 'height': src.height,
                'crs': str(src.crs) if src.crs else None, 'bounds': list(src.bounds),
                'transform': list(src.transform)[:6], 'dtype': list(src.dtypes), 'bands': bands,
                'interpretation': 'Numeric cell statistics in declared raster units; interpret sums using their units and coverage.'}


def vector_profile(path: Path) -> dict:
    import fiona
    with fiona.open(path) as src:
        result = {'format': 'vector', 'population': 'complete', 'features': 0,
                  'crs': str(src.crs), 'bounds': list(src.bounds), 'schema': dict(src.schema),
                  'null_geometries': 0, 'geometry_types': {}}
        for feature in src:
            result['features'] += 1
            geometry = feature.get('geometry')
            if not geometry:
                result['null_geometries'] += 1
            else:
                typ = geometry['type']
                result['geometry_types'][typ] = result['geometry_types'].get(typ, 0) + 1
        return result


def profile(path: Path) -> dict:
    suffix = path.suffix.lower()
    if suffix in {'.csv', '.tsv', '.jsonl', '.ndjson'}:
        return table_profile(path)
    if suffix in {'.tif', '.tiff'}:
        return raster_profile(path)
    if suffix in {'.geojson', '.gpkg', '.shp'}:
        return vector_profile(path)
    if suffix == '.json':
        with path.open(encoding='utf-8-sig') as f:
            value = json.load(f)
        return {'format': 'json', 'population': 'complete', 'value': value}
    raise IntelligenceError(f'No analysis adapter is installed for {suffix or "this file type"}.')


def compare_rasters(left: Path, right: Path, band: int = 1) -> dict:
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    baseline, candidate, delta = Moments(), Moments(), Moments()
    both_missing = left_only = right_only = increased = decreased = unchanged = 0
    with rasterio.open(left) as a, rasterio.open(right) as b:
        if (a.crs != b.crs or a.width != b.width or a.height != b.height or
                not a.transform.almost_equals(b.transform)):
            raise IntelligenceError('Rasters have different grids. Align CRS, resolution and transform explicitly before comparison.')
        if not 1 <= band <= min(a.count, b.count):
            raise IntelligenceError('Band does not exist in both rasters.')
        left_unit_info = raster_unit_declarations(a, band)
        right_unit_info = raster_unit_declarations(b, band)
        if left_unit_info['unit'] != right_unit_info['unit']:
            raise IntelligenceError('Band units disagree.')
        for top in range(0, a.height, 512):
            for leftx in range(0, a.width, 512):
                w = Window(leftx, top, min(512,a.width-leftx), min(512,a.height-top))
                x, y = a.read(band,window=w,masked=True), b.read(band,window=w,masked=True)
                va = ~np.ma.getmaskarray(x) & np.isfinite(x.data)
                vb = ~np.ma.getmaskarray(y) & np.isfinite(y.data)
                paired = va & vb
                xv, yv = x.data[paired].astype('float64'), y.data[paired].astype('float64')
                difference = yv - xv
                baseline.array(xv); candidate.array(yv); delta.array(difference)
                left_only += int((va & ~vb).sum()); right_only += int((vb & ~va).sum())
                both_missing += int((~va & ~vb).sum())
                increased += int((difference > 0).sum()); decreased += int((difference < 0).sum())
                unchanged += int((difference == 0).sum())
        return {'format': 'raster_comparison', 'population': 'complete aligned grid', 'paired_cells': delta.n,
                'baseline_only_cells': left_only, 'candidate_only_cells': right_only,
                'both_excluded_cells': both_missing, 'increased': increased, 'decreased': decreased, 'unchanged': unchanged,
                'unit': left_unit_info['unit'], 'units_status':'declared' if left_unit_info['unit'] else 'not declared in either raster',
                'unit_declarations': {'baseline': left_unit_info['declarations'], 'candidate': right_unit_info['declarations']},
                'grid':{'width':a.width,'height':a.height,'crs':str(a.crs) if a.crs else None,'transform':list(a.transform)[:6]}, 'baseline': baseline.result(), 'candidate': candidate.result(),
                'candidate_minus_baseline': delta.result(),
                'relative_sum_change_percent': None if not baseline.n or baseline.total == 0 else 100*(candidate.total-baseline.total)/baseline.total,
                'interpretation': 'Paired valid cells only. Cell-sum change is not automatically watershed mass change.'}


def pair_tables(observed: Path, predicted: Path, keys: list[str], observed_key: str,
                predicted_key: str, *, retain_points: bool = False,
                canonical_time: bool = False) -> tuple[dict, list[dict], list[dict]]:
    """Disk-backed exact-key join, streaming summaries; points are optional for native fits.

    Canonical time pairing maps ISO timestamps to UTC before duplicate detection.
    Date-only values represent midnight UTC. Spatial/station keys must be selected
    explicitly for multisite comparisons; a one-site fit rejects duplicate periods.
    """
    from datetime import datetime, timezone
    if not keys or len(keys) != len(set(keys)):
        raise IntelligenceError('Provide unique nonempty pairing key columns.')
    if canonical_time and len(keys) != 1:
        raise IntelligenceError('Chronological calibration requires one time column.')
    obs, pred, errors, absolute = Moments(), Moments(), Moments(), Moments()
    points_o, points_p = [], []
    with tempfile.TemporaryDirectory(prefix='eco-pair-') as root:
        db = sqlite3.connect(str(Path(root)/'pairs.sqlite'))
        try:
            db.execute('PRAGMA temp_store=FILE')
            db.execute('PRAGMA cache_size=-8192')
            db.execute('CREATE TABLE obs (k TEXT PRIMARY KEY, value REAL) WITHOUT ROWID')
            db.execute('CREATE TABLE pred (k TEXT PRIMARY KEY, value REAL) WITHOUT ROWID')
            counts = {'observations':0, 'predictions':0, 'invalid_observations':0, 'invalid_predictions':0}
            for table, path, value_key, count_key in [('obs',observed,observed_key,'observations'), ('pred',predicted,predicted_key,'predictions')]:
                for row in rows(path):
                    counts[count_key] += 1
                    if any(key not in row or row[key] is None or row[key] == '' for key in keys) or value_key not in row:
                        raise IntelligenceError('A pairing key or requested value column is missing.')
                    parts=[str(row[k]) for k in keys]
                    if canonical_time:
                        try:
                            dt=datetime.fromisoformat(parts[0].replace('Z','+00:00'))
                            dt=dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
                            parts=[dt.isoformat()]
                        except ValueError as exc:
                            raise IntelligenceError('Calibration periods must be ISO dates or timestamps.') from exc
                    key=json.dumps(parts,ensure_ascii=False,separators=(',',':'))
                    value=finite(row[value_key])
                    if value is None: counts['invalid_'+count_key] += 1
                    try:
                        db.execute(f'INSERT INTO {table} VALUES (?,?)',(key,value))
                    except sqlite3.IntegrityError as exc:
                        raise IntelligenceError('Duplicate pairing keys: add station/site/period columns instead of overwriting rows.') from exc
            for key,o,p in db.execute('SELECT o.k,o.value,p.value FROM obs o JOIN pred p ON o.k=p.k WHERE o.value IS NOT NULL AND p.value IS NOT NULL ORDER BY o.k'):
                obs.add(o); pred.add(p); errors.add(p-o); absolute.add(abs(p-o))
                if retain_points:
                    points_o.append({'date':key,'observed_sediment':o})
                    points_p.append({'date':key,'predicted_sediment':p})
            counts['paired_finite']=obs.n
            counts['unmatched_observations']=db.execute('SELECT COUNT(*) FROM obs o LEFT JOIN pred p ON o.k=p.k WHERE p.k IS NULL').fetchone()[0]
            counts['unmatched_predictions']=db.execute('SELECT COUNT(*) FROM pred p LEFT JOIN obs o ON o.k=p.k WHERE o.k IS NULL').fetchone()[0]
        finally:
            db.close()
    n=obs.n; sse=errors.m2 + errors.n * errors.mean**2
    return ({'population':'complete exact-key join','keys':keys,'coverage':counts,
             'key_normalization':'ISO timestamps to UTC' if canonical_time else 'exact stored strings',
             'observed':obs.result(),'predicted':pred.result(),
             'rmse':math.sqrt(sse/n) if n else None,'mae':absolute.mean if n else None,
             'nse':None if obs.m2 == 0 else 1-sse/obs.m2,
             'pbias_definition':'100 * (sum(predicted) - sum(observed)) / sum(observed); negative means underprediction',
             'pbias_percent':None if obs.total == 0 else 100*(pred.total-obs.total)/obs.total},points_o,points_p)

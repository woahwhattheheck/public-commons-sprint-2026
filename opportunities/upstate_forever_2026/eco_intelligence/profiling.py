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


def selected_reading(source: dict, retained_preview: dict | None = None) -> dict | None:
    """Use the retained edition's reviewed worksheet/layer and reading choices."""
    metadata = source.get('metadata') or {}
    binding = metadata.get('source_binding') or {}
    entry = metadata.get('source') or {}
    if metadata.get('native_kind') != 'retained_source' or binding.get('role') != 'primary':
        return None
    client = entry.get('client_source') or {}
    if entry.get('kind') == 'table' and client:
        # A saved biophysical projection is its own registered CSV. Its original
        # workbook header/worksheet must not be applied a second time.
        if entry.get('field_projection'):
            return None
        choice = client.get('selection') or {}
        if any(type(choice.get(name)) is not int or choice[name] < 0 for name in ('file_index','part_index')):
            raise IntelligenceError('Restore the original file and worksheet selection.',409)
        if retained_preview is not None:
            part = {'kind':'table','fields':retained_preview['original_fields'],
                    'sheet':retained_preview['original_worksheet'],
                    'header_row':retained_preview['original_header_row']}
            supplied_options = retained_preview['reading_options']
        else:
            preview = client.get('inspection')
            if not isinstance(preview, dict) or preview.get('schema') != 'upstate.client-source-preview/v1':
                raise IntelligenceError('Open this source in Review my files and retain its worksheet and reading choices before Assistant table analysis.', 409)
            part = preview.get('part') or {}
            if preview.get('source_sha256') != source.get('sha256'):
                raise IntelligenceError('The selected table preview belongs to another original file.',409)
            supplied_options = preview.get('options')
        if (client.get('source_sha256') != source.get('sha256')
                or entry.get('body',{}).get('sha256') != source.get('sha256')
                or part.get('kind') != 'table' or not isinstance(part.get('fields'), list)
                or part.get('sheet') != entry.get('sheet')):
            raise IntelligenceError('The selected table edition has inconsistent original worksheet evidence.', 409)
        from model.client_source_files import options
        reading = options(supplied_options)
        if reading['header_row'] != part.get('header_row'):
            raise IntelligenceError('The selected table header differs from its retained reading choices.', 409)
        fields = part['fields']
        labels = [field.get('label') for field in fields]
        keys = labels if all(isinstance(label, str) and label for label in labels) and len(set(labels)) == len(labels) else [field.get('id') for field in fields]
        if not fields or any(not isinstance(key, str) or not key for key in keys) or len(set(keys)) != len(keys):
            raise IntelligenceError('The selected table has no unambiguous retained column identities.', 409)
        return {'kind': 'table', 'options': reading, 'sheet': part.get('sheet'),
                'fields': fields, 'column_keys': keys,
                'source_sha256': source['sha256'],
                'interpretation': 'Original selected worksheet and cells; column_keys retain unique original labels, or the reviewed positional column IDs when labels repeat or are empty.'}
    if entry.get('kind') == 'vector' and entry.get('layer') is not None:
        return {'kind': 'vector', 'layer': entry['layer']}
    if entry.get('kind') == 'raster' and client:
        selected = client.get('selection') or {}
        # The retained projection already contains the selected original band.
        part_index = selected.get('part_index')
        band = (1 if entry.get('band_projection') else
                part_index + 1 if type(part_index) is int and part_index >= 0 else None)
        if band is not None:
            if type(band) is not int or band < 1:
                raise IntelligenceError('Choose the retained raster band.', 409)
            return {'kind': 'raster', 'band': band,
                    'original_band': entry.get('band_projection', {}).get('original_band', band)}
    return None


def reviewed_records(path: Path, reading: dict) -> Iterator[dict[str, Any]]:
    from model.client_source_files import table_records, headers, scalar
    iterator = table_records(path, reading['options'], reading.get('sheet'))
    header_row = reading['options']['header_row']
    found_header = False
    try:
        for record in iterator:
            if record['row'] < header_row:
                continue
            values = record['values']
            if record['row'] == header_row:
                retained = [{key: field.get(key) for key in ('id', 'index', 'label', 'display')}
                            for field in reading['fields']]
                from .common import public_metadata
                original_fields = headers(values)
                if original_fields != retained and public_metadata(original_fields) != retained:
                    raise IntelligenceError('The original table header differs from its retained inspection.', 409)
                # Registry metadata sanitizes URL-like labels. Recover their exact
                # original spelling from the verified file for scientific results.
                reading['fields'] = original_fields
                labels = [field['label'] for field in original_fields]
                reading['column_keys'] = (labels if all(labels) and len(set(labels)) == len(labels)
                                          else [field['id'] for field in original_fields])
                found_header = True
                continue
            if (len(values) > len(reading['column_keys'])
                    and any(value is not None and value != '' for value in values[len(reading['column_keys']):])):
                raise IntelligenceError('An original table row has more cells than its reviewed header. Review the source header before analysis.', 409)
            cells = {key: scalar(values[index]) if index < len(values) else None
                     for index, key in enumerate(reading['column_keys'])}
            position = {key: record[key] for key in ('row', 'line_start', 'line_end')}
            if 'cell_metadata' in record:
                position['cell_metadata'] = {
                    key: record['cell_metadata'][index]
                    for index, key in enumerate(reading['column_keys'])
                    if index < len(record['cell_metadata'])}
            yield {'cells': cells, 'source_row': position}
        if not found_header:
            raise IntelligenceError('The selected original header row is absent.', 409)
    except (ValueError, UnicodeError, csv.Error) as error:
        raise IntelligenceError(str(error), 422) from error
    finally:
        iterator.close()


def reviewed_rows(path: Path, reading: dict) -> Iterator[dict[str, Any]]:
    iterator = reviewed_records(path, reading)
    try:
        for record in iterator:
            yield record['cells']
    finally:
        iterator.close()


def table_page(path: Path, offset: int, limit: int, reading: dict | None = None) -> dict:
    reviewed = reading is not None and reading.get('kind') == 'table'
    iterator = (reviewed_records(path, reading) if reviewed else
                ({'cells': row} for row in rows(path, reading)))
    page, positions, more = [], [], False
    try:
        for index, record in enumerate(iterator):
            if index < offset:
                continue
            if len(page) == limit:
                more = True
                break
            page.append(record['cells'])
            if reviewed:
                positions.append(record['source_row'])
    finally:
        iterator.close()
    return {'format': 'table_rows', 'population': 'original row page',
            'offset': offset, 'rows': page, 'complete_page': True,
            'next_offset': offset + len(page) if more else None,
            **({'selected_reading': reading, 'original_rows': positions} if reviewed else {}),
            'interpretation': 'Original literal cells and reviewed source positions. Excel cell type and number_format are retained where available; displayed identifier formatting requires the explicit retained Measurements projection. This page is not a statistical sample or a substituted numeric measurement.'}


def rows(path: Path, reading: dict | None = None) -> Iterator[dict[str, Any]]:
    if reading is not None and reading.get('kind') == 'table':
        yield from reviewed_rows(path, reading)
        return
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


def table_profile(path: Path, reading: dict | None = None) -> dict:
    columns: dict[str, dict] = {}
    count = 0
    for row in rows(path, reading):
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
            **({'selected_reading': reading} if reading is not None else {}),
            'columns': {k: {'missing': v['missing'], 'non_numeric_or_nonfinite': v['non_numeric'],
                            'numeric': v['numeric'].result()} for k, v in columns.items()}}


def raster_profile(path: Path, reading: dict | None = None) -> dict:
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    bands = []
    with rasterio.open(path) as src:
        selected = [reading['band']] if reading is not None else range(1, src.count + 1)
        if any(band > src.count for band in selected):
            raise IntelligenceError('The retained raster band is absent from this original file.', 409)
        for band in selected:
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
                **({'selected_reading': reading} if reading is not None else {}),
                'crs': str(src.crs) if src.crs else None, 'bounds': list(src.bounds),
                'transform': list(src.transform)[:6], 'dtype': list(src.dtypes), 'bands': bands,
                'interpretation': 'Numeric cell statistics in declared raster units; interpret sums using their units and coverage.'}


def vector_profile(path: Path, reading: dict | None = None) -> dict:
    import fiona
    from contextlib import nullcontext
    environment = nullcontext
    if reading is not None:
        from model.rasters import vector_environment
        environment = vector_environment
    selected = {'layer': reading['layer']} if reading is not None else {}
    with environment(), fiona.open(path, **selected) as src:
        result = {'format': 'vector', 'population': 'complete', 'features': 0,
                  **({'selected_reading': reading} if reading is not None else {}),
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


def profile(path: Path, reading: dict | None = None) -> dict:
    if reading is not None:
        kind = reading.get('kind')
        if kind == 'table':
            return table_profile(path, reading)
        if kind == 'vector':
            return vector_profile(path, reading)
        if kind == 'raster':
            return raster_profile(path, reading)
        raise IntelligenceError('Choose a supported retained source interpretation.', 409)
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


def compare_rasters(left: Path, right: Path, band: int = 1, *,
                    left_reading: dict | None = None, right_reading: dict | None = None) -> dict:
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    if any(reading is not None and reading.get('kind') != 'raster'
           for reading in (left_reading, right_reading)):
        raise IntelligenceError('Choose two retained raster editions for raster comparison.')
    left_band = left_reading['band'] if left_reading is not None else band
    right_band = right_reading['band'] if right_reading is not None else band
    baseline, candidate, delta = Moments(), Moments(), Moments()
    both_missing = left_only = right_only = increased = decreased = unchanged = 0
    with rasterio.open(left) as a, rasterio.open(right) as b:
        if (a.crs != b.crs or a.width != b.width or a.height != b.height or
                not a.transform.almost_equals(b.transform)):
            raise IntelligenceError('Rasters have different grids. Align CRS, resolution and transform explicitly before comparison.')
        if not 1 <= left_band <= a.count or not 1 <= right_band <= b.count:
            raise IntelligenceError('A selected band does not exist in its original raster.')
        left_unit_info = raster_unit_declarations(a, left_band)
        right_unit_info = raster_unit_declarations(b, right_band)
        if left_unit_info['unit'] != right_unit_info['unit']:
            raise IntelligenceError('Band units disagree.')
        for top in range(0, a.height, 512):
            for leftx in range(0, a.width, 512):
                w = Window(leftx, top, min(512,a.width-leftx), min(512,a.height-top))
                x, y = a.read(left_band,window=w,masked=True), b.read(right_band,window=w,masked=True)
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
                'selected_bands': {'baseline': left_band, 'candidate': right_band},
                **({'selected_readings': {'baseline': left_reading, 'candidate': right_reading}}
                   if left_reading is not None or right_reading is not None else {}),
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
                canonical_time: bool = False, observed_reading: dict | None = None,
                predicted_reading: dict | None = None) -> tuple[dict, list[dict], list[dict]]:
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
                reading = observed_reading if table == 'obs' else predicted_reading
                for row in rows(path, reading):
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
             **({'selected_readings': {'observed': observed_reading, 'predicted': predicted_reading}}
                if observed_reading is not None or predicted_reading is not None else {}),
             'key_normalization':'ISO timestamps to UTC' if canonical_time else 'exact stored strings',
             'observed':obs.result(),'predicted':pred.result(),
             'rmse':math.sqrt(sse/n) if n else None,'mae':absolute.mean if n else None,
             'nse':None if obs.m2 == 0 else 1-sse/obs.m2,
             'pbias_definition':'100 * (sum(predicted) - sum(observed)) / sum(observed); negative means underprediction',
             'pbias_percent':None if obs.total == 0 else 100*(pred.total-obs.total)/obs.total},points_o,points_p)

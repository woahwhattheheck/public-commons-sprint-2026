"""Read-only native numeric GeoTIFF, retained-grid and FGDC section checks."""
import math
import xml.etree.ElementTree as ET

import numpy as np
import rasterio
from pyproj import CRS
from pyproj.exceptions import CRSError

RASTERS = ('nitrogen_export', 'phosphorus_export', 'sediment_export')
GRID_TOLERANCE_M = 1e-6
CELL_AREA_TOLERANCE_HA = 1e-9
AUDIT_SCOPES = ('regional-30m', 'source-native')


def _finite_number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(label + ' must be a finite number')
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(label + ' must be a finite number')
    return number


def _geometry(crs_value, width, height, transform):
    if (isinstance(width, bool) or not isinstance(width, int) or width <= 0
            or isinstance(height, bool) or not isinstance(height, int) or height <= 0):
        raise ValueError('Grid width and height must be positive integers')
    if not isinstance(transform, (list, tuple)) or len(transform) != 6:
        raise ValueError('Grid transform must contain all six affine coefficients')
    affine = tuple(_finite_number(value, 'Affine coefficient') for value in transform)
    crs = CRS.from_user_input(crs_value)
    factors = [_finite_number(axis.unit_conversion_factor, 'CRS unit conversion')
               for axis in crs.axis_info[:2]]
    if (not crs.is_projected or len(factors) != 2
            or any(not math.isclose(value, 1.0, rel_tol=0, abs_tol=1e-7) for value in factors)):
        raise ValueError('Projected meter-coordinate CRS required')
    a, b, _, d, e, _ = affine
    resolution = (math.hypot(a, d), math.hypot(b, e))
    area = abs(a * e - b * d)
    if (any(not math.isfinite(value) or value <= 0 for value in resolution)
            or not math.isfinite(area) or area <= 0):
        raise ValueError('Grid must have finite positive cell dimensions and area')
    return {'crs': crs, 'width': width, 'height': height, 'transform': affine,
            'resolution_m': resolution, 'pixel_area_ha': area / 10000}


def retained_grid_geometry(value):
    """Validate the physical fields of the original completed Workspace grid."""
    if not isinstance(value, dict):
        raise ValueError('The retained record must contain its grid geometry')
    result = _geometry(value.get('crs'), value.get('width'), value.get('height'),
                       value.get('transform'))
    nominal = _finite_number(value.get('resolution_m'), 'Retained nominal resolution')
    area = _finite_number(value.get('pixel_area_ha'), 'Retained cell area')
    if nominal <= 0 or area <= 0:
        raise ValueError('Retained resolution and cell area must be positive')
    if any(not math.isclose(size, nominal, rel_tol=0, abs_tol=GRID_TOLERANCE_M)
           for size in result['resolution_m']):
        raise ValueError('Retained nominal resolution differs from the affine cell dimensions')
    if not math.isclose(area, result['pixel_area_ha'], rel_tol=0,
                        abs_tol=CELL_AREA_TOLERANCE_HA):
        raise ValueError('Retained cell hectares differ from the affine determinant')
    result['nominal_resolution_m'] = nominal
    return result


def _regional_grid(value):
    a, b, _, d, e, _ = value['transform']
    return (math.isclose(abs(a), 30, rel_tol=0, abs_tol=GRID_TOLERANCE_M)
            and math.isclose(abs(e), 30, rel_tol=0, abs_tol=GRID_TOLERANCE_M)
            and abs(b) < 1e-8 and abs(d) < 1e-8)


def _same_grid(left, right):
    return (left['crs'].equals(right['crs'])
            and left['width'] == right['width'] and left['height'] == right['height']
            and all(math.isclose(a, b, rel_tol=0, abs_tol=GRID_TOLERANCE_M)
                    for a, b in zip(left['transform'], right['transform'])))


def inspect_rasters(data, child, add, summary, *, expected_grid=None,
                    audit_scope='regional-30m'):
    rasters = data.get('rasters') if isinstance(data.get('rasters'), dict) else {}
    reference = None
    summary.setdefault('raster_grids', {})
    if expected_grid is not None and audit_scope == 'regional-30m' and not _regional_grid(expected_grid):
        add('FAIL', 'grid.regional_resolution', 'The retained regional grid must use unrotated 30 x 30 meter cells')
    for key in RASTERS:
        ent = rasters.get(key)
        ent = ent if isinstance(ent, dict) else {}
        rp = child(ent.get('path'), 'raster.' + key)
        metap = child(ent.get('fgdc_xml'), 'metadata.' + key)
        units = ent.get('units')
        if not isinstance(units, str) or len(units.strip()) < 4 or units.lower().strip() in {'unitless', 'relative', 'rank', 'index'}:
            add('FAIL', 'units.' + key, 'Numeric export mass/rate unit must be specified, not a relative ranking')

        if metap:
            try:
                xml = ET.parse(metap).getroot()
                # FGDC Content Standard for Digital Geospatial Metadata (CSDGM), XML representation.
                if xml.tag.rsplit('}', 1)[-1].lower() != 'metadata':
                    add('FAIL', 'metadata.' + key, 'Expected FGDC CSDGM <metadata> root')
                for field in ('idinfo/citation/citeinfo/title', 'idinfo/descript/abstract',
                              'dataqual/lineage', 'spref', 'metainfo'):
                    node = xml.find(field)
                    if node is None or not ''.join(node.itertext()).strip():
                        add('FAIL', 'metadata.' + key, 'Missing FGDC section: ' + field)
            except (ET.ParseError, OSError, ValueError) as exc:
                add('FAIL', 'metadata.' + key, 'XML unreadable: ' + str(exc))

        if not rp:
            continue
        try:
            with rasterio.Env(GDAL_CACHEMAX=64 * 1024 * 1024), rasterio.open(rp) as src:
                if src.driver != 'GTiff' or src.count != 1:
                    add('FAIL', 'raster.' + key, 'Expected single-band GeoTIFF')
                if src.crs is None:
                    add('FAIL', 'raster.' + key, 'CRS missing')
                    continue
                actual = _geometry(src.crs, src.width, src.height, tuple(src.transform)[:6])
                if audit_scope == 'regional-30m' and not _regional_grid(actual):
                    add('FAIL', 'raster.' + key,
                        'Pixel transform is not unrotated 30 x 30 meters: ' + str(actual['transform']))
                if expected_grid is not None:
                    if not actual['crs'].equals(expected_grid['crs']):
                        add('FAIL', 'grid.' + key + '.crs', 'Raster CRS differs from the retained grid record')
                    if (actual['width'], actual['height']) != (expected_grid['width'], expected_grid['height']):
                        add('FAIL', 'grid.' + key + '.dimensions', 'Raster dimensions differ from the retained grid record')
                    if not all(math.isclose(a, b, rel_tol=0, abs_tol=GRID_TOLERANCE_M)
                               for a, b in zip(actual['transform'], expected_grid['transform'])):
                        add('FAIL', 'grid.' + key + '.transform',
                            'Raster affine differs from the retained grid record; absolute tolerance '
                            + str(GRID_TOLERANCE_M) + ' meters')
                if reference is not None and not _same_grid(reference, actual):
                    add('FAIL', 'raster.' + key, 'Export layers are not aligned to exactly the same grid')
                if reference is None:
                    reference = actual
                    summary['resolution_m'] = list(actual['resolution_m'])
                summary['raster_grids'][key] = {
                    'crs': actual['crs'].to_wkt(), 'width': actual['width'], 'height': actual['height'],
                    'transform': list(actual['transform']), 'resolution_m': list(actual['resolution_m']),
                    'pixel_area_ha': actual['pixel_area_ha'],
                }
                summary['raster_layers'] += 1
                count, negatives, invalid = 0, 0, 0
                for _, window in src.block_windows(1):
                    block = src.read(1, window=window, masked=True)
                    good = block.compressed()
                    count += good.size
                    if good.size:
                        negatives += int(np.count_nonzero(good < 0))
                        invalid += int(np.count_nonzero(~np.isfinite(good)))
                summary['valid_cells'][key] = count
                if count == 0:
                    add('FAIL', 'raster.' + key, 'Every output cell is NoData')
                if negatives or invalid:
                    add('FAIL', 'raster.' + key, f'Invalid numeric export values: {negatives} negative, {invalid} nonfinite')
                if src.nodata is None:
                    add('REVIEW', 'raster.' + key, 'NoData convention absent; ensure external masking is documented')
        except (OSError, rasterio.errors.RasterioError, CRSError, ValueError, TypeError, OverflowError) as exc:
            add('FAIL', 'raster.' + key, 'Unreadable or invalid raster: ' + str(exc))

    if summary['raster_layers'] == len(RASTERS):
        add('REVIEW', 'model.export', 'Check per-pixel mass units, source-area normalization, N/P/sediment input model calibrations, and scenario vs current land cover against native InVEST outputs')

"""Read-only native numeric GeoTIFF and FGDC CSDGM section checks."""
import math
import xml.etree.ElementTree as ET

import numpy as np
import rasterio
from pyproj import CRS

RASTERS = ('nitrogen_export', 'phosphorus_export', 'sediment_export')


def inspect_rasters(data, child, add, summary):
    rasters = data.get('rasters') if isinstance(data.get('rasters'), dict) else {}
    grid = None
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
            except (ET.ParseError, OSError) as exc:
                add('FAIL', 'metadata.' + key, 'XML unreadable: ' + str(exc))

        if not rp:
            continue
        try:
            with rasterio.open(rp) as src:
                if src.driver != 'GTiff' or src.count != 1:
                    add('FAIL', 'raster.' + key, 'Expected single-band GeoTIFF')
                if src.crs is None:
                    add('FAIL', 'raster.' + key, 'CRS missing')
                    continue
                crs = CRS.from_user_input(src.crs)
                factors = [a.unit_conversion_factor for a in crs.axis_info[:2]]
                if not crs.is_projected or len(factors) != 2 or any(abs(float(v) - 1) > 1e-7 for v in factors):
                    add('FAIL', 'raster.' + key, 'Projected meter-coordinate CRS required for 30 x 30 m raster')
                a = src.transform
                if not (math.isclose(abs(a.a), 30, abs_tol=1e-6) and
                        math.isclose(abs(a.e), 30, abs_tol=1e-6) and
                        abs(a.b) < 1e-8 and abs(a.d) < 1e-8):
                    add('FAIL', 'raster.' + key, f'Pixel transform is not 30 x 30 meters: {tuple(a)[:6]}')
                if src.width == 0 or src.height == 0:
                    add('FAIL', 'raster.' + key, 'Raster is empty')
                fingerprint = (str(src.crs), src.width, src.height, tuple(round(v, 6) for v in tuple(a)[:6]))
                if grid is not None and grid != fingerprint:
                    add('FAIL', 'raster.' + key, 'Export layers are not aligned to exactly the same grid')
                grid = grid or fingerprint
                summary['resolution_m'] = [abs(a.a), abs(a.e)]
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
        except (OSError, rasterio.errors.RasterioError, ValueError) as exc:
            add('FAIL', 'raster.' + key, 'Unreadable raster: ' + str(exc))

    if summary['raster_layers'] == len(RASTERS):
        add('REVIEW', 'model.export', 'Check per-pixel mass units, source-area normalization, N/P/sediment input model calibrations, and scenario vs current land cover against native InVEST outputs')


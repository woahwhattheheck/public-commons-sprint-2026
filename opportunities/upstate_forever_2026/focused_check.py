#!/usr/bin/env python3
"""One local read/write fixture check of the unmodified audit CLI, not a model run."""
import json
import tempfile
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from audit import MAPS, RASTERS, SOURCES, inspect

FGDC = '''<?xml version="1.0"?>
<metadata><idinfo><citation><citeinfo><title>illustrative grid</title></citeinfo></citation>
<descript><abstract>Internal mechanical fixture, not environmental output.</abstract></descript></idinfo>
<dataqual><lineage><procstep><procdesc>illustrative</procdesc></procstep></lineage></dataqual>
<spref><horizsys><planar><planci><plance>UTM 17 North</plance></planci></planar></horizsys></spref>
<metainfo><metd>20261011</metd></metainfo></metadata>'''

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    (root/'maps').mkdir()
    (root/'rasters').mkdir()
    (root/'metadata').mkdir()
    manifest = {
        'schema': 'upstate-ec-sdc-2026/delivery-v1',
        'model': {'name': 'Illustrative only', 'version': '0', 'upstream_buffer_m': 100},
        'source_data': [{'id': s, 'vintage': 'ILLUSTRATION', 'uri': 'https://example.invalid/source'} for s in SOURCES],
        'maps': {}, 'rasters': {}, 'report_pdf': 'report.pdf'
    }
    (root/'report.pdf').write_bytes(b'%PDF-1.7\nillustrative fixture\n')
    for name in MAPS:
        (root/f'maps/{name}.pdf').write_bytes(b'%PDF-1.7\nillustrative fixture\n')
        manifest['maps'][name] = f'maps/{name}.pdf'
    for name in RASTERS:
        rpath = root/f'rasters/{name}.tif'
        with rasterio.open(rpath, 'w', driver='GTiff', width=16, height=12, count=1,
                           dtype='float32', nodata=-9999, crs='EPSG:32617',
                           transform=from_origin(480000, 3900000, 30, 30)) as ds:
            ds.write(np.ones((12, 16), dtype='float32'), 1)
        (root/f'metadata/{name}.xml').write_text(FGDC)
        manifest['rasters'][name] = {'path': f'rasters/{name}.tif',
                                     'fgdc_xml': f'metadata/{name}.xml', 'units': 'kg/pixel/year'}
    mpath = root/'manifest.json'
    mpath.write_text(json.dumps(manifest))
    got = inspect(mpath)
    assert got['status'] == 'TECHNICAL_PRECHECK_PASS', got
    assert got['summary']['map_files'] == 7 and got['summary']['raster_layers'] == 3
    print('GOOD DELIVERY STRUCTURE:', got['status'], 'mapped=7, aligned rasters=3')
    manifest['rasters']['nitrogen_export']['units'] = 'relative'
    mpath.write_text(json.dumps(manifest))
    got = inspect(mpath)
    assert got['status'] == 'FAIL' and any('units.' in f['check'] for f in got['findings']), got
    print('PSEUDO-EXPORT RANK INSTEAD OF MASS RATE:', got['status'])
    manifest['rasters']['nitrogen_export']['units'] = 'kg/pixel/year'
    mpath.write_text(json.dumps(manifest))
    bad = root/'rasters/nitrogen_export.tif'
    with rasterio.open(bad, 'r+') as ds:
        ds.transform = from_origin(480000, 3900000, 60, 60)
    got = inspect(mpath)
    assert got['status'] == 'FAIL' and any('30 x 30' in f['detail'] for f in got['findings']), got
    print('60-METER GRID INCORRECTLY PRESENTED AS 30-METER:', got['status'])
print('FOCUSED NATIVE ACCEPTANCE: PASS (3 cases)')

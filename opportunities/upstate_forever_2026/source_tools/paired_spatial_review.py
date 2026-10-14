"""Offline spatial review of retained paired-raster products; no model execution.

Copyright 2026 TokenJunkieLabs. Native source and arithmetic remain with the
original model.paired_ensemble producer. This consumer is read-only until a
reviewer explicitly exports a new, independently editable review directory.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import ExitStack
import csv
import gzip
import hashlib
import html
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import zipfile

import numpy as np
from PIL import Image
import rasterio
from rasterio.windows import Window

# Use the original source-bound canonical identity and file verification.
from model import portable_fs as _fs
from model.paired_ensemble.ensemble_store import digest, fingerprint, read, verify

VERSION = '1.0.1'
LABELS = {'nitrogen_export': 'Nitrogen', 'phosphorus_export': 'Phosphorus',
          'sediment_export': 'Sediment'}


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(',', ':'), allow_nan=False) + '\n').encode()


def safe(root: Path, name: str) -> Path:
    root = _fs.native_path(root).resolve()
    _fs.relative_name(name, windows=True)
    target = (root / name).resolve()
    if not target.is_relative_to(root):
        raise ValueError('Package member escapes its directory')
    return target


def put(path: Path, body: bytes):
    """Create-only, byte-exact restart on each native receiving filesystem."""
    path = _fs.native_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    expected = {'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
    if path.is_symlink():
        raise ValueError('Preserving symbolic link: ' + str(path))
    if path.exists():
        if fingerprint(path) != expected:
            raise ValueError('Preserving differing existing file: ' + str(path))
        return
    fd, name = tempfile.mkstemp(prefix='.spatial-', dir=path.parent)
    pending = _fs.native_path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            _fs.publish_file(pending, path)
        except FileExistsError:
            if fingerprint(path) != expected:
                raise ValueError('Another writer changed ' + str(path))
        _fs.sync_directory(path.parent)
    finally:
        pending.unlink(missing_ok=True)


def read_product(root):
    root = _fs.native_path(root).resolve(strict=True)
    a = read(root / 'analysis.json')
    if (a.get('state') != 'complete' or a['id'] != digest(a['selection'])
            or a['selection'].get('schema') != 'upstate.paired-raster-ensemble/v1'):
        raise ValueError('Select a complete original paired-raster product')
    for artifact in a['artifacts'].values():
        verify(root, artifact)
    return root, a


def file_descriptor(path, root):
    return {'path': path.relative_to(root).as_posix(), **fingerprint(path)}


def scan_product(source, output, tile_size, reports_override=None):
    output = _fs.native_path(output)
    root, a = read_product(source)
    selected = a['selection']
    target = output / 'products' / a['id']
    names = {'analysis.json', 'reports.json'}
    reports = reports_override if reports_override is not None else read(root / 'reports.json')
    for descriptor in reports['files']:
        verify(root, descriptor)
        names.add(descriptor['path'])
    names.update(x['path'] for x in a['artifacts'].values())
    _fs.validate_members(names, portable=True)
    for name in sorted(names):
        put(safe(target, name), json_bytes(reports) if name == 'reports.json' and reports_override is not None else safe(root, name).read_bytes())
    sources = selected.get('source_references', {})
    grid = selected['grid']
    width, height = grid['width'], grid['height']
    bands = [{'key': key, **artifact} for key, artifact in sorted(a['artifacts'].items())]
    record = {'id': a['id'], 'analysis_sha256': fingerprint(root / 'analysis.json')['sha256'],
              'title': sources.get('alternative_scenario', {}).get('title', selected.get('title', 'Scenario')),
              'baseline': sources.get('baseline_scenario', {}).get('title', 'Retained baseline'),
              'purpose': selected.get('purpose', ''), 'grid': grid,
              'member_count': selected['selected_member_count'],
              'planned_member_count': selected['planned_member_count'],
              'pollutants': selected['pollutants'], 'support': selected['support'],
              'interpretation': a.get('interpretation', ''),
              'bands': bands, 'tiles': [], 'tile_size': tile_size,
              'original_report': f'products/{a["id"]}/index.html',
              'original_analysis': f'products/{a["id"]}/analysis.json',
              'original_summary': a['summary'], 'overviews': {}}
    with ExitStack() as stack:
        datasets = [stack.enter_context(rasterio.open(verify(root, band))) for band in bands]
        record['coordinate_units'] = datasets[0].crs.linear_units if datasets[0].crs.is_projected else 'degrees'
        for ds in datasets:
            if (ds.count != 1 or ds.width != width or ds.height != height
                    or list(ds.transform)[:6] != grid['transform']
                    or ds.crs != rasterio.crs.CRS.from_wkt(grid['crs_wkt'])):
                raise ValueError('A retained statistic differs from its original grid')
        for row in range(0, height, tile_size):
            for col in range(0, width, tile_size):
                w, h = min(tile_size, width-col), min(tile_size, height-row)
                layers = []
                for ds in datasets:
                    data = ds.read(1, window=Window(col, row, w, h), masked=True)
                    values = np.array(data.astype('float64').filled(np.nan), dtype='<f8', copy=True)
                    values[~np.isfinite(values)] = np.nan
                    layers.append(values.tobytes(order='C'))
                body = b''.join(layers)
                tile_id = f'{row}-{col}'
                payload = base64.b64encode(gzip.compress(body, compresslevel=6, mtime=0)).decode()
                key = a['id'] + ':' + tile_id
                script = ('window.registerSpatialTile(' + json.dumps(key) + ',' + json.dumps(payload) + ');\n').encode()
                tile_path = f'tiles/{a["id"]}/{tile_id}.js'
                put(output / tile_path, script)
                record['tiles'].append({'id': tile_id, 'row': row, 'col': col, 'width': w,
                                        'height': h, 'path': tile_path, 'decoded_bytes': len(body),
                                        'sha256': hashlib.sha256(body).hexdigest(), 'payload_gzip': payload})
        for band, ds in zip(bands, datasets):
            factor = min(1, 700/max(width, height))
            w, h = max(1, round(width*factor)), max(1, round(height*factor))
            data = ds.read(1, out_shape=(h, w), masked=True,
                           resampling=rasterio.enums.Resampling.nearest)
            valid = ~np.ma.getmaskarray(data) & np.isfinite(data.data)
            lo, hi = ((float(data.data[valid].min()), float(data.data[valid].max()))
                      if valid.any() else (None, None))
            yy, xx = np.indices((h, w))
            gray = np.where(((yy//6 + xx//6) % 2) == 0, 236, 214).astype('uint8')
            if lo is not None:
                if band['statistic'] in ('fraction_improved', 'common_support'):
                    low, high = 0., 1.
                elif band['units'] == 'count':
                    low, high = 0., float(selected['selected_member_count'])
                else:
                    magnitude = max(abs(lo), abs(hi)) or 1.
                    low, high = -magnitude, magnitude
                gray[valid] = np.round(238 - 210*np.clip((data.data[valid]-low)/(high-low), 0, 1)).astype('uint8')
            else:
                low = high = None
            stream = io.BytesIO()
            Image.fromarray(gray).save(stream, format='PNG')
            name = f'overviews/{a["id"]}/{band["key"]}.png'
            put(output/name, stream.getvalue())
            record['overviews'][band['key']] = {'path': name, 'low': low, 'high': high,
                                               'sampling': 'nearest original raster cell; row orientation',
                                               'width': w, 'height': h, 'data_uri': 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()}
    record['source_files'] = [{**file_descriptor(p, output), 'content_base64': base64.b64encode(p.read_bytes()).decode()} for p in sorted(target.rglob('*')) if p.is_file()]
    return record


def build(projects, output, title, classification, tile_size=128):
    displayed_output = Path(output).absolute()
    output = _fs.native_path(displayed_output).resolve()
    if not 16 <= tile_size <= 512:
        raise ValueError('Tile size must be between 16 and 512 cells')
    products = [read_product(p) for p in projects]
    if len({a['id'] for _, a in products}) != len(products):
        raise ValueError('Select distinct original products')
    config = {'version': VERSION, 'title': title, 'classification': classification,
              'tile_size': tile_size,
              'products': [{'id': a['id'], **fingerprint(p/'analysis.json')} for p,a in products],
              'producer_sha256': fingerprint(_fs.native_path(__file__))['sha256'],
              'template_sha256': fingerprint(_fs.native_path(__file__).with_suffix('.html'))['sha256']}
    output.mkdir(parents=True, exist_ok=True)
    if output.is_symlink() or any(output == p or output.is_relative_to(p) or p.is_relative_to(output) for p,a in products):
        raise ValueError('Build in a separate directory outside the original products')
    put(output/'build-input.json', json_bytes(config))
    records = [scan_product(p, output, tile_size) for p,a in products]
    manifest = {'schema': 'upstate.paired-spatial-atlas/v1', 'version': VERSION,
                'id': digest(config), 'title': title, 'classification': classification,
                'effect_direction': 'baseline minus alternative', 'products': records,
                'review_semantics': 'A selection of modeled result cells for review, not a new intervention or a new model run.'}
    template = _fs.native_path(__file__).with_suffix('.html').read_text(encoding='utf-8')
    encoded = json.dumps(manifest, ensure_ascii=False, separators=(',', ':'), allow_nan=False).replace('<', '\\u003c')
    if template.count('/*__ATLAS_DATA__*/null') != 1:
        raise ValueError('Template data marker is missing or ambiguous')
    page = template.replace('/*__ATLAS_DATA__*/null', encoded)
    put(output/'START_HERE.html', page.encode())
    put(output/'atlas.json', json_bytes(manifest))
    put(output/'source_tools'/'paired_spatial_review.py', _fs.native_path(__file__).read_bytes())
    put(output/'source_tools'/'paired_spatial_review.html', _fs.native_path(__file__).with_suffix('.html').read_bytes())
    return {'id': manifest['id'], 'directory': str(displayed_output), 'products': len(records),
            'grid_cells': sum(p['grid']['width']*p['grid']['height'] for p in records),
            'statistic_rasters': sum(len(p['bands']) for p in records)}



def append_native_report_review(directory, report):
    """Add the reader through the original export_reports/reports.json pipeline.

    The native caller owns its report lock. This hook stages elsewhere, appends
    one artifact, and retains all original quantitative/source descriptors.
    A normal native report export therefore reaches the existing browser,
    composer and portable transfer without a parallel operator or job queue.
    """
    from model.paired_ensemble.ensemble_store import atomic
    directory = _fs.native_path(directory).resolve(strict=True)
    original, analysis = read_product(directory)
    with tempfile.TemporaryDirectory(prefix='paired-spatial-report-') as scratch:
        product = scan_product(original, Path(scratch), 128, reports_override=report)
    source = analysis['selection'].get('source_references', {})
    source_title = source.get('grid_spec', {}).get('title') or analysis['selection'].get('input_description') or analysis['selection']['title']
    classification = source_title + ' · Retained model outputs; source editions and working assumptions remain in the original report.'
    binding = {'analysis_sha256': product['analysis_sha256'],
               'sources': [{k:v for k,v in f.items() if k != 'content_base64'} for f in product['source_files']],
               'producer_sha256': fingerprint(_fs.native_path(__file__))['sha256'],
               'template_sha256': fingerprint(_fs.native_path(__file__).with_suffix('.html'))['sha256']}
    manifest = {'schema':'upstate.paired-spatial-atlas/v1','version':VERSION,
                'id':digest(binding),'title':'Native model results · spatial review',
                'classification':classification,'effect_direction':'baseline minus alternative',
                'products':[product]}
    template = _fs.native_path(__file__).with_suffix('.html').read_text(encoding='utf-8')
    encoded = json.dumps(manifest,ensure_ascii=False,separators=(',',':'),allow_nan=False).replace('<','\\u003c')
    if template.count('/*__ATLAS_DATA__*/null') != 1:
        raise ValueError('Template data marker is missing or ambiguous')
    body = template.replace('/*__ATLAS_DATA__*/null', encoded).encode()
    # The original export owns these derived artifacts, as it already owns index.html.
    def generated(path, body):
        fd, name = tempfile.mkstemp(prefix='.spatial-report-', dir=directory)
        pending = _fs.native_path(name)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(body)
                stream.flush()
                os.fsync(stream.fileno())
            _fs.replace(pending, _fs.native_path(path))
            _fs.sync_directory(directory)
        finally:
            pending.unlink(missing_ok=True)
    generated(directory/'spatial-review.html',body)
    index_path=directory/'index.html'
    index=index_path.read_text(encoding='utf-8')
    if 'href="spatial-review.html"' not in index:
        if '<nav>' not in index:raise ValueError('Original report navigation was not found')
        index=index.replace('<nav>','<nav><a href="spatial-review.html">Interactive spatial review</a>',1)
        generated(index_path,index.encode())
    for descriptor in report['files']:
        if descriptor['path']=='index.html':descriptor.update(fingerprint(index_path))
    report['files']=[d for d in report['files'] if d['path'] not in ('spatial-review.html','spatial-review-atlas.json')]
    report['files'].append({'path':'spatial-review.html',**fingerprint(directory/'spatial-review.html')})
    atomic(directory/'spatial-review-atlas.json', manifest)
    report['files'].append({'path':'spatial-review-atlas.json',**fingerprint(directory/'spatial-review-atlas.json')})
    report['spatial_review']={'entrypoint':'spatial-review.html','atlas':'spatial-review-atlas.json','id':manifest['id']}
    return report


def enhance(project):
    """Explicit spatial export through the maintained native report inventory.

    Regular report/model jobs retain their original cost and behavior. Only this
    requested export reads and packages all quantitative layers for an offline
    recipient. The original producer renders its current report first, preventing
    recursive embedding of a previous spatial edition on repeated exports.
    """
    from model.paired_ensemble.ensemble_report import export_reports
    from model.paired_ensemble.ensemble_store import atomic, held
    displayed_project = Path(project).absolute()
    directory = _fs.native_path(displayed_project).resolve(strict=True)
    export_reports(directory)
    with held(directory/'.report.lock', blocking=True):
        report = read(directory/'reports.json')
        root, analysis = read_product(directory)
        if report.get('ensemble_id') != analysis['id']:
            raise ValueError('The current native report belongs to another result')
        append_native_report_review(directory, report)
        atomic(directory/'reports.json', report)
    return {'project': str(displayed_project), **report['spatial_review'], 'files': report['files']}


def receive(atlas_root, review_file, output):
    """Import an exact browser review into independent native GIS/report files."""
    atlas_root = _fs.native_path(atlas_root).resolve(strict=True)
    if atlas_root.is_file():
        atlas_path, atlas_root = atlas_root, atlas_root.parent
    else:
        atlas_path = atlas_root/'atlas.json'
        if not atlas_path.is_file():
            atlas_path = atlas_root/'spatial-review-atlas.json'
    atlas = read(atlas_path)
    if atlas.get('schema') != 'upstate.paired-spatial-atlas/v1':
        raise ValueError('Select a retained paired spatial atlas')
    with os.fdopen(_fs.open_file(_fs.native_path(review_file), os.O_RDONLY), 'rb') as stream:
        original_review = stream.read()
    review = json.loads(original_review)
    if review.get('schema') != 'upstate.paired-spatial-review/v1' or review.get('atlas_id') != atlas['id']:
        raise ValueError('This review belongs to another atlas edition')
    candidates = [p for p in atlas['products'] if p['id'] == review.get('product_id')]
    if len(candidates) != 1:
        raise ValueError('Review product is not present in this atlas')
    product = candidates[0]
    product_path = atlas_root/'products'/product['id']
    if not product_path.is_dir() and (atlas_root/'analysis.json').is_file():
        product_path = atlas_root  # Existing native single-product export.
    root, analysis = read_product(product_path)
    if analysis['id'] != product['id']:
        raise ValueError('Native result does not match the selected original product')
    expected_bands = [{'key': k, **v} for k,v in sorted(analysis['artifacts'].items())]
    if (product['grid'] != analysis['selection']['grid'] or product['bands'] != expected_bands
            or product['pollutants'] != analysis['selection']['pollutants']):
        raise ValueError('Atlas grid or statistics differ from the retained original analysis')
    if (review.get('analysis_sha256') != product['analysis_sha256']
            or fingerprint(root/'analysis.json')['sha256'] != product['analysis_sha256']):
        raise ValueError('Review no longer matches its original analysis bytes')
    grid = product['grid']
    total = grid['width']*grid['height']
    indices = review.get('selected_cells')
    if (not isinstance(indices, list) or any(type(i) is not int or i<0 or i>=total for i in indices)
            or len(set(indices)) != len(indices)):
        raise ValueError('Select unique original zero-based row-major cell indices')
    if not isinstance(review.get('note', ''), str):
        raise ValueError('Review note must be text')
    output = _fs.native_path(output).resolve()
    if (output == atlas_root or output.is_relative_to(atlas_root) or atlas_root.is_relative_to(output)):
        raise ValueError('Receive into an independent directory outside the original atlas')
    output.mkdir(parents=True, exist_ok=True)
    put(output/'review.original.json', original_review)
    bands = product['bands']
    keys = [b['key'] for b in bands]
    mask = np.zeros((grid['height'], grid['width']), dtype='uint8')
    for i in indices:
        mask.flat[i] = 1
    first = rasterio.open(verify(root, bands[0]))
    profile = first.profile.copy();first.close()
    profile.update(dtype='uint8', count=1, nodata=None, compress='deflate')
    with rasterio.io.MemoryFile() as mem:
        with mem.open(**profile) as ds:
            ds.write(mask, 1)
            ds.update_tags(atlas_id=atlas['id'], analysis_id=product['id'],
                           meaning='1=selected modeled result cell; 0=not selected; not an intervention')
        put(output/'selected-result-cells.tif', mem.read())
    a,b,c,d,e,f = grid['transform']
    stream = io.StringIO(newline='');writer=csv.writer(stream)
    writer.writerow(['cell_index','row','column','grid_x','grid_y', *keys])
    sums = {k: [] for k in keys if k.endswith('--mean_reduction')}
    with ExitStack() as stack:
        datasets = [stack.enter_context(rasterio.open(verify(root, band))) for band in bands]
        groups = {}
        tile_size = product['tile_size']
        for i in sorted(indices):
            row,col=divmod(i,grid['width'])
            groups.setdefault((row//tile_size, col//tile_size), []).append((i,row,col))
        for (tr,tc), cells in sorted(groups.items()):
            y,x=tr*tile_size,tc*tile_size
            arrays=[ds.read(1,window=Window(x,y,min(tile_size,grid['width']-x),min(tile_size,grid['height']-y)),masked=True) for ds in datasets]
            for i,row,col in cells:
                values=[]
                for key,array in zip(keys,arrays):
                    v=array[row-y,col-x]
                    value=None if np.ma.is_masked(v) or not np.isfinite(v) else float(v)
                    values.append(value)
                    if key in sums and value is not None:sums[key].append(value)
                writer.writerow([i,row,col,a*(col+.5)+b*(row+.5)+c,d*(col+.5)+e*(row+.5)+f,*values])
    put(output/'selected-result-cells.csv',stream.getvalue().encode())
    summary={'schema':'upstate.paired-spatial-receiving/v1','atlas_id':atlas['id'],
             'product_id':product['id'],'analysis_sha256':product['analysis_sha256'],
             'selected_cells':len(indices),'selected_projected_grid_area_ha':
                (len(indices)*grid['projected_pixel_area_ha'] if grid.get('projected_pixel_area_ha') is not None else None),
             'classification':atlas['classification'],'grid':grid,'review_sha256':hashlib.sha256(original_review).hexdigest(),
             'mean_reduction_sums':{key:{'finite_cells':len(v),'sum':math.fsum(v),
                 'meaning':'Sum of finite per-cell member means on the explicit review selection; not a whole-basin quantile.'} for key,v in sums.items()},
             'columns':[{'name':b['key'],'units':b['units']} for b in bands]}
    put(output/'review-summary.json',json_bytes(summary))
    esc=lambda x:html.escape(str(x),quote=True)
    body=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Received spatial review</title><style>body{{font:17px/1.6 system-ui;margin:40px auto;padding:0 20px;max-width:920px;color:#222}}h1{{line-height:1.15}}code{{overflow-wrap:anywhere}}a{{color:inherit}}pre{{white-space:pre-wrap}}section{{border-top:1px solid #bbb;margin-top:24px;padding-top:14px}}</style><h1>{esc(product['title'])}</h1><p>{esc(atlas['classification'])}</p><p><strong>{len(indices):,} modeled result cells selected for review.</strong> This selection does not change the intervention or rerun the model.</p><section><h2>Reviewer note</h2><pre>{esc(review.get('note',''))}</pre></section><section><h2>Use the received files</h2><p><a href="selected-result-cells.tif">Original-grid selection GeoTIFF</a> · <a href="selected-result-cells.csv">Full-precision selected statistics CSV</a> · <a href="review.original.json">Editable original review</a> · <a href="review-summary.json">Complete summary, units and CRS</a></p><p>Open the original atlas, choose Load review, and select review.original.json to continue editing. Raster coordinates and CRS stay exact. The GeoTIFF contains 1 for selected result cells and 0 for unselected cells.</p><code>Original analysis {esc(product['id'])}</code></section></html>'''
    put(output/'OPEN_REVIEW.html',body.encode())
    return summary


def pack(directory, archive):
    """Publish a complete portable archive without replacing a prior delivery."""
    root = _fs.native_path(directory).resolve(strict=True)
    archive = _fs.native_path(archive).absolute()
    if archive.parent.resolve().is_relative_to(root):
        raise ValueError('Put the archive outside its source directory')
    if archive.exists() or archive.is_symlink():
        raise ValueError('Preserving an existing output archive')
    archive.parent.mkdir(parents=True, exist_ok=True)
    members = []
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('Archive does not include symlinks')
        if path.is_file():
            members.append((path.relative_to(root).as_posix(), path, fingerprint(path)))
    _fs.validate_members([name for name, _, _ in members], portable=True)
    fd, name = tempfile.mkstemp(prefix='.spatial-pack-', suffix='.zip', dir=archive.parent)
    pending = _fs.native_path(name)
    try:
        with os.fdopen(fd, 'w+b') as stream:
            with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as packed:
                for name, path, expected in members:
                    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o100644 << 16
                    checksum, count = hashlib.sha256(), 0
                    with os.fdopen(_fs.open_file(path, os.O_RDONLY), 'rb') as incoming:
                        with packed.open(info, 'w', force_zip64=True) as outgoing:
                            for chunk in iter(lambda: incoming.read(1024 * 1024), b''):
                                count += len(chunk)
                                if count > expected['bytes']:
                                    raise ValueError('Original source grew during archive export: ' + name)
                                checksum.update(chunk)
                                outgoing.write(chunk)
                    if ({'bytes': count, 'sha256': checksum.hexdigest()} != expected
                            or fingerprint(path) != expected):
                        raise ValueError('Original source changed during archive export: ' + name)
            stream.flush()
            os.fsync(stream.fileno())
        _fs.publish_file(pending, archive)
        _fs.sync_directory(archive.parent)
    finally:
        pending.unlink(missing_ok=True)
    return fingerprint(archive)


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('build');p.add_argument('--project',action='append',required=True);p.add_argument('--output',required=True)
    p.add_argument('--title',required=True);p.add_argument('--classification',required=True);p.add_argument('--tile-size',type=int,default=128)
    p=sub.add_parser('enhance');p.add_argument('--project',required=True)
    p=sub.add_parser('receive');p.add_argument('--atlas',required=True);p.add_argument('--review',required=True);p.add_argument('--output',required=True)
    p=sub.add_parser('pack');p.add_argument('--directory',required=True);p.add_argument('--archive',required=True)
    args=parser.parse_args(argv)
    try:
        if args.command=='build':result=build(args.project,args.output,args.title,args.classification,args.tile_size)
        elif args.command=='enhance':result=enhance(args.project)
        elif args.command=='receive':result=receive(args.atlas,args.review,args.output)
        else:result=pack(args.directory,args.archive)
        print(json.dumps(result,indent=2,allow_nan=False));return 0
    except (ValueError,OSError,KeyError,TypeError) as exc:
        print(f'{type(exc).__name__}: {exc}',file=sys.stderr);return 2

if __name__=='__main__':raise SystemExit(main())

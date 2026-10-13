"""Complete, source-bound ensemble tables and readable offline reports.

Copyright 2026 TokenJunkieLabs.
"""
from __future__ import annotations
import csv
import html
import io
import json
import math
import os
from pathlib import Path
import tempfile
from urllib.parse import quote
import numpy as np
import rasterio
from PIL import Image
from .ensemble_store import (atomic, digest, fingerprint, held, read, verify,
                             native_provenance as read_native_provenance)

LABELS = {'nitrogen_export': 'Nitrogen export', 'phosphorus_export': 'Phosphorus export',
          'sediment_export': 'Sediment export'}
SUPPORT_LABELS = {'all_pairs': 'All selected pairs, separately for each pollutant',
                  'available_pairs': 'Available pairs at each pixel; member count can vary',
                  'all_pairs_all_pollutants': 'All selected pairs and all selected pollutants'}


def text_file(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.report-', delete=False) as out:
            pending = Path(out.name)
            out.write(text.encode('utf-8'))
            out.flush()
            os.fsync(out.fileno())
        os.replace(pending, path)
        pending = None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _csv(rows, fields):
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator='\n')
    writer.writeheader()
    for row in rows:
        # Formula-leading text is literal in spreadsheet applications. The JSON
        # source preserves the original exact strings and numerical values.
        safe = {key: ("'" + value if isinstance(value, str) and value.startswith(('=', '+', '-', '@', '\t', '\r', '\n')) else value)
                for key, value in row.items() if key in fields}
        writer.writerow(safe)
    return stream.getvalue()


def _number(value, decimals=5):
    if value is None:
        return 'Unavailable'
    if isinstance(value, int):
        return f'{value:,}'
    if not math.isfinite(value):
        raise ValueError('Report number must be finite')
    return f'{value:,.{decimals}g}'


def _preview(path, target, statistic):
    """Overview only; full-resolution quantitative data remain in the TIFF."""
    with rasterio.open(path) as ds:
        scale = min(1.0, 760 / max(ds.width, ds.height))
        width, height = max(1, round(ds.width*scale)), max(1, round(ds.height*scale))
        values = ds.read(1, out_shape=(height, width), masked=True,
                         resampling=rasterio.enums.Resampling.nearest)
    valid = ~np.ma.getmaskarray(values) & np.isfinite(values.data)
    lo = float(values.data[valid].min()) if np.any(valid) else None
    hi = float(values.data[valid].max()) if np.any(valid) else None
    yy, xx = np.indices((height, width))
    gray = np.where((xx//8 + yy//8) % 2, 210, 240).astype('uint8')
    if np.any(valid):
        if statistic == 'fraction_improved':
            low, high = 0.0, 1.0
        else:
            bound = max(abs(lo), abs(hi)) or 1.0
            low, high = -bound, bound
        scaled = np.zeros((height, width), dtype='float64')
        scaled[valid] = np.clip((values.data[valid]-low)/(high-low), 0, 1)
        gray[valid] = np.round(24 + 208*scaled[valid]).astype('uint8')
    else:
        low = high = None
    target.parent.mkdir(parents=True, exist_ok=True)
    pending = target.with_name('.' + target.name + '.pending')
    Image.fromarray(gray).save(pending, format='PNG')
    os.replace(pending, target)
    return {'path': target.name, 'width': width, 'height': height,
            'display_minimum': low, 'display_maximum': high,
            'sampled_minimum': lo, 'sampled_maximum': hi,
            'sampling': 'nearest-neighbour raster overview; original affine orientation',
            'nodata': 'checkerboard'}


def _input_records(selection):
    """Expose each retained original source independently of native run caches."""
    rows = []
    for member in selection['members']:
        for pollutant in selection['pollutants']:
            rasters = member['rasters'][pollutant]
            for side in ('baseline', 'alternative'):
                original = rasters[side]
                rows.append({
                    'member_id': member['id'],
                    'profile_id': member.get('profile_id'),
                    'scenario_id': member.get('scenario_id'),
                    'pollutant': pollutant,
                    'side': side,
                    'run_id': member.get(side + '_run_id'),
                    'units': rasters['units'],
                    'bytes': original['bytes'],
                    'sha256': original['sha256'],
                })
    return rows


def _input_identity_section(rows):
    e = lambda value: html.escape(str(value), quote=True)
    records = []
    for row in rows:
        records.append('<tr><th scope="row"><code>' + e(row['member_id']) +
                       '</code></th><td>' + e(LABELS[row['pollutant']]) +
                       '</td><td>' + e(row['side'].capitalize()) +
                       '</td><td>' + e(row['units']) + '</td><td>' +
                       e(_number(row['bytes'])) + '</td><td><code>' +
                       e(row['sha256']) + '</code></td><td><code>' +
                       e(row['run_id'] or 'Not retained') + '</code></td></tr>')
    return ('<details><summary>Original baseline and alternative raster identities</summary>'
            '<p>Every row identifies one original input raster. Native run identifiers are shown '
            'where retained; received quantitative results remain readable using these original '
            'raster identities. Profile and scenario identifiers are included in the CSV.</p>'
            '<p><a href="input-rasters.csv">Original input raster CSV</a></p>'
            '<div class="table-scroll"><table class="input-rasters"><thead><tr>'
            '<th>Member</th><th>Pollutant</th><th>Input</th><th>Raster units</th>'
            '<th>Bytes</th><th>Original SHA-256</th><th>Native run</th>'
            '</tr></thead><tbody>' + ''.join(records) + '</tbody></table></div></details>')



def _native_version_section(directory, analysis, descriptor):
    record = read_native_provenance(directory, analysis, descriptor)
    e = lambda value: html.escape(str(value), quote=True)
    if record is None:
        if analysis['selection'].get('input_kind') != 'original Workspace native run artifacts':
            return '', [], None
        declared = analysis['selection'].get('source_references', {}).get('invest_version')
        return ('<section><h2>Native model versions</h2><p>Original recorded version: ' +
                e(declared or 'Unavailable') + '. This historical report edition does not retain '
                'separate producing-stage runtime records.</p></section>'), [], None
    rows = []
    for run_id, versions in sorted(record['cohort']['runs'].items()):
        for model, value in versions.items():
            rows.append({
                'run_id': run_id, 'model': model,
                'comparison_version': value['comparison_version'],
                'basis': value['basis'], 'requested_version': value.get('requested_version'),
                'observed_stage_version': value.get('observed_stage_version'),
                'observed_run_version': value.get('observed_run_version'),
                'stage_completed_at': value.get('stage_completed_at'),
                'reused_from': json.dumps(value.get('reused_from'), ensure_ascii=False, sort_keys=True),
            })
    text_file(directory / 'native-versions.csv', _csv(rows, [
        'run_id', 'model', 'comparison_version', 'basis', 'requested_version',
        'observed_stage_version', 'observed_run_version', 'stage_completed_at', 'reused_from']))
    labels = {
        'completed_stage_runtime': 'Completed producing stage',
        'observed_run_fallback': 'Observed run; stage version unavailable',
        'requested_legacy': 'Requested legacy version; execution version unavailable',
        'unavailable': 'Unavailable',
    }
    body = ''.join(
        '<tr><td><code>' + e(row['run_id']) + '</code></td><td>' + e(row['model'].upper()) +
        '</td><td>' + e(row['comparison_version']) + '</td><td>' +
        e(labels.get(row['basis'], row['basis'])) + '</td><td>' +
        e(row['requested_version'] or 'Unavailable') + '</td></tr>' for row in rows)
    section = ('<section><h2>Native model versions</h2>'
        '<p>Each selected quantity is paired only with the same producing-model version. '
        'Completed stage runtimes take precedence over the last observed run runtime; '
        'original records without either retain an explicitly labeled requested-version fallback. '
        'Different NDR and SDR versions remain separate.</p>'
        '<div class="table-scroll"><table class="input-rasters"><thead><tr>'
        '<th>Original run</th><th>Model</th><th>Compared version</th><th>Source</th>'
        '<th>Requested version</th></tr></thead><tbody>' + body + '</tbody></table></div>'
        '<p><a href="native-versions.csv">Complete native version CSV</a> · <a href="' +
        quote(descriptor['path'], safe='/') + '">Original runtime and stage records</a></p></section>')
    return section, [descriptor['path'], 'native-versions.csv'], record

def export_reports(directory, *, native_provenance=None):
    directory = Path(directory).resolve(strict=True)
    state = read(directory / 'analysis.json')
    if state.get('state') != 'complete' or state['id'] != digest(state['selection']):
        raise ValueError('Complete the original ensemble before exporting its report')
    with held(directory / '.report.lock', blocking=True):
        for artifact in state['artifacts'].values():
            verify(directory, artifact)
        selection = state['selection']
        if native_provenance is None and (directory / 'reports.json').is_file():
            native_provenance = read(directory / 'reports.json').get('native_provenance')
        native_section, native_names, native_record = _native_version_section(
            directory, state, native_provenance)
        atomic(directory / 'summary.json', {
            'schema': 'upstate.ensemble-summary/v1', 'ensemble_id': state['id'],
            'effect_direction': state['effect_direction'],
            'selected_member_count': selection['selected_member_count'],
            'planned_member_count': selection['planned_member_count'],
            'support': selection['support'], 'summary': state['summary']})
        atomic(directory / 'selection.json', selection)
        input_rows = _input_records(selection)
        text_file(directory / 'input-rasters.csv', _csv(input_rows, [
            'member_id', 'profile_id', 'scenario_id', 'pollutant', 'side',
            'run_id', 'units', 'bytes', 'sha256']))
        member_rows, coverage_rows, distribution_rows = [], [], []
        for pollutant, summary in state['summary'].items():
            for member in summary['members']:
                member_rows.append({'pollutant': pollutant, 'units': summary['units'],
                                    'ensemble_id': state['id'], **member})
            coverage_rows.append({'pollutant': pollutant, **{k: v for k, v in summary.items()
                                  if k not in ('members', 'basin_reduction_distribution_common_support', 'basin_quantile_definition')}})
            distribution = summary['basin_reduction_distribution_common_support']
            if distribution is not None:
                for record in distribution['quantiles']:
                    distribution_rows.append({'pollutant': pollutant, 'units': summary['units'],
                                              'common_cells': summary['common_cells'],
                                              'members': distribution['members'], **record})
        fields = list(dict.fromkeys(key for row in member_rows for key in row))
        text_file(directory / 'paired-members.csv', _csv(member_rows, fields))
        fields = list(dict.fromkeys(key for row in coverage_rows for key in row))
        text_file(directory / 'coverage.csv', _csv(coverage_rows, fields))
        text_file(directory / 'basin-quantiles.csv', _csv(distribution_rows,
                  ['pollutant', 'units', 'common_cells', 'members', 'q', 'value']))
        e = lambda value: html.escape(str(value), quote=True)
        sections = []
        previews = []
        for pollutant, summary in state['summary'].items():
            title = LABELS[pollutant]
            pixel_units = state['artifacts'][pollutant + '--mean_reduction']['units']
            threshold = selection['improvement_thresholds'][pollutant]
            threshold_text = ('Improvement counts a tested pair only when baseline minus alternative '
                              'is greater than ' + _number(threshold) + ' ' + pixel_units + '.')
            common_area = summary.get('common_projected_grid_area_ha')
            reporting_area = summary.get('reporting_projected_grid_area_ha')
            area_text = ('' if common_area is None or reporting_area is None else
                         ' Common-support projected grid area: ' + _number(common_area) +
                         ' of ' + _number(reporting_area) + ' ha.')
            rows = []
            for i, member in enumerate(summary['members'], 1):
                name = member.get('profile_id') or member['id']
                rows.append('<tr><th scope="row"><span class="muted">' + str(i) + '</span> <code>' + e(name) + '</code></th>' +
                            ''.join('<td>' + e(_number(member[k])) + '</td>' for k in
                                    ('baseline_total_common_support', 'alternative_total_common_support',
                                     'reduction_total_common_support', 'reduction_percent_common_support', 'paired_valid_cells')) + '</tr>')
            figures = []
            for statistic, label in [('mean_reduction', 'Mean reduction'), ('fraction_improved', 'Fraction of valid tested pairs showing improvement')]:
                artifact = state['artifacts'][pollutant + '--' + statistic]
                target = directory / 'previews' / (pollutant + '--' + statistic + '.png')
                preview = _preview(directory / artifact['path'], target, statistic)
                preview.update(pollutant=pollutant, statistic=statistic,
                               path=target.relative_to(directory).as_posix())
                previews.append(preview)
                legend = ('No finite pixels on the selected display support.' if preview['display_minimum'] is None else
                          'Dark ' + _number(preview['display_minimum']) + ' → light ' + _number(preview['display_maximum']) + ' ' + artifact['units'])
                figures.append('<figure><h3>' + e(label) + '</h3><a href="' + quote(artifact['path']) + '">' +
                               '<img alt="' + e(title + ' ' + label + '; checkerboard denotes missing data') +
                               '" src="' + quote(preview['path']) + '" width="' + str(preview['width']) +
                               '" height="' + str(preview['height']) + '"></a><figcaption>' + e(legend) +
                               '<br>Checkerboard: no displayed result. Nearest-neighbour overview; open the linked GeoTIFF for original data and geography.</figcaption></figure>')
            distribution = summary['basin_reduction_distribution_common_support']
            if distribution is None:
                spread = 'No common valid geography exists for a paired basin comparison.'
            else:
                spread = 'Mean ' + _number(distribution['mean']) + '; range ' + _number(distribution['minimum']) + ' to ' + _number(distribution['maximum']) + ' ' + summary['units'] + '. '
                spread += '; '.join('Q' + _number(row['q']*100) + ': ' + _number(row['value']) for row in distribution['quantiles']) + '.'
            coverage = summary['common_coverage_fraction']
            percent = 'Unavailable' if coverage is None else _number(coverage*100) + '%'
            sections.append('<section id="' + e(pollutant) + '"><h2>' + e(title) + '</h2><p class="coverage">' +
                            e(_number(summary['common_cells'])) + ' / ' + e(_number(summary['reporting_cells'])) +
                            ' reporting pixels support every selected pair (' + e(percent) + '). ' +
                            e(_number(summary['partial_pair_cells'])) + ' pixels have only partial pair coverage.' + e(area_text) + '</p><p>' + e(threshold_text) + '</p><p><strong>Member totals on common valid reporting pixels:</strong> ' +
                            e(spread) + '</p><p class="muted">Basin quantiles are computed from complete member totals on the same common pixels. They are not sums of pixel quantiles.</p>' +
                            '<div class="figures">' + ''.join(figures) + '</div><details><summary>All ' + str(len(rows)) +
                            ' paired member totals · ' + e(summary['units']) + '</summary><div class="table-scroll"><table><thead><tr>' +
                            '<th>Profile / member</th><th>Baseline · common pixels</th><th>Alternative · common pixels</th><th>Reduction · common pixels</th><th>Reduction % · common pixels</th><th>Pair-valid pixels</th>' +
                            '</tr></thead><tbody>' + ''.join(rows) + '</tbody></table></div></details></section>')
        downloads = ''.join('<li><a href="' + quote(a['path']) + '">' + e(LABELS[a['pollutant']] + ' · ' + a['statistic'].replace('_', ' ') + ' · ' + a['units']) + '</a></li>'
                            for a in state['artifacts'].values())
        source_json = e(json.dumps(selection.get('source_references', []), indent=2, ensure_ascii=False))
        input_section = _input_identity_section(input_rows)
        page = ('''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>''' + e(selection['title']) + '''</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#ededeb;color:#202020;font:16px/1.55 system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:28px}header,section{background:#fff;border:1px solid #bbb;padding:24px;margin:0 0 22px}h1{font-size:30px;line-height:1.2;margin:10px 0}h2{font-size:23px;margin:0 0 10px}h3{font-size:16px}a{color:inherit;text-underline-offset:3px}code{font:12px ui-monospace,monospace;overflow-wrap:anywhere}p{max-width:100ch}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.1em}.muted,figcaption{color:#555;font-size:14px}.coverage{border-left:4px solid #444;padding-left:12px}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}.facts div{border-top:1px solid #aaa;padding:12px 0}.facts strong{display:block;font-size:19px}.figures{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}figure{margin:0}figure img{display:block;width:100%;max-width:100%;height:auto;image-rendering:pixelated;border:1px solid #777;object-fit:contain}figcaption{margin:7px 0 18px}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{padding:10px;border-bottom:1px solid #ccc;text-align:right}table.input-rasters td{white-space:normal;text-align:left;min-width:100px}table.input-rasters td:nth-child(6){min-width:180px}th:first-child{min-width:220px;text-align:left;max-width:380px;white-space:normal}summary{cursor:pointer;font-weight:600;padding:14px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}nav{display:flex;flex-wrap:wrap;gap:10px 22px;margin:18px 0}.downloads{columns:2;column-gap:30px}.downloads li{break-inside:avoid;padding-bottom:7px}@media(max-width:700px){main{padding:12px}header,section{padding:16px}.figures{grid-template-columns:1fr}h1{font-size:25px}.downloads{columns:1}}@media print{body{background:#fff}main{padding:0}header,section{break-inside:avoid}.table-scroll{overflow:visible}details>summary{display:none}details>*{display:block}a{text-decoration:none}}
</style></head><body><main><header><div class="eyebrow">TokenJunkieLabs · Paired raster ensemble analysis</div><h1>''' + e(selection['title']) + '</h1><p>' + e(selection['purpose']) + '</p><p><strong>Input kind:</strong> ' + e(selection.get('input_kind', 'explicit paired rasters')) + '</p><p><strong>Inputs:</strong> ' + e(selection['input_description']) + '</p>' +
        '<div class="facts"><div><strong>' + str(selection['selected_member_count']) + ' of ' + str(selection['planned_member_count']) +
        '</strong>Selected / planned members</div><div><strong>Positive = reduction</strong>Baseline minus alternative</div><div><strong>' +
        e(selection['grid']['width']) + ' × ' + e(selection['grid']['height']) + '</strong>Original raster grid</div></div><p><strong>Displayed support:</strong> ' +
        e(SUPPORT_LABELS[selection['support']]) + '</p><p>Quantiles describe the explicitly tested profiles. The improvement fraction divides improved pairs by valid pairs at each pixel. Read its valid-pair count to see where support varies. Missing pixels stay missing. Nutrient and sediment quantities are reported separately.</p>' +
        '<nav>' + ''.join('<a href="#' + p + '">' + LABELS[p] + '</a>' for p in selection['pollutants']) + '<a href="#files">Files and methods</a></nav><code>Analysis ' + e(state['id']) + '</code></header>' + ''.join(sections) +
        native_section + '<section id="files"><h2>Files and methods</h2>' + input_section + '<nav><a href="input-rasters.csv">Original input raster CSV</a><a href="paired-members.csv">Complete paired-member CSV</a><a href="coverage.csv">Coverage CSV</a><a href="basin-quantiles.csv">Basin quantiles CSV</a><a href="summary.json">Quantitative JSON</a><a href="selection.json">Exact selection and sources</a><a href="analysis.json">Full analysis record</a></nav><p>Per-pixel quantiles use linear interpolation at (n−1)q. The improvement threshold is retained per pollutant in its native pixel-mass units. Common-support basin totals always use identical pixels for every member. A percentage reduction with zero baseline is unavailable; negative original values remain in the calculation and are counted in the complete CSV.</p><p>Projected-grid area is pixel determinant × coordinate-unit conversion; it is not a separate geodesic-area estimate. Raster overviews retain affine row orientation, without a cartographic north-arrow claim.</p><details><summary>All quantitative GeoTIFFs</summary><ul class="downloads">' + downloads + '</ul></details><details><summary>Original source, profile and scenario references</summary><pre>' + source_json + '</pre></details><p class="muted">Complete result files can be received offline. Use the original scientific Workspace backup to transfer model inputs and run caches as well. Full numeric precision is retained in JSON, CSV and GeoTIFF; displayed values are rounded for reading.</p></section></main></body></html>')
        text_file(directory / 'index.html', page)
        atomic(directory / 'previews.json', previews)
        names = ['index.html', 'summary.json', 'selection.json', 'input-rasters.csv', 'paired-members.csv',
                 'coverage.csv', 'basin-quantiles.csv', 'previews.json'] + [p['path'] for p in previews] + native_names
        report = {'schema': 'upstate.ensemble-reports/v1', 'ensemble_id': state['id'],
                  'entrypoint': 'index.html', 'files': [{'path': name, **fingerprint(directory / name)} for name in names]}
        if native_record is not None:
            report['native_provenance'] = native_provenance
            report['native_versions'] = native_record['cohort']['versions']
        atomic(directory / 'reports.json', report)
        return report

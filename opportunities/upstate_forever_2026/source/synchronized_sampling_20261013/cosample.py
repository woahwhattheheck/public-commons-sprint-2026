#!/usr/bin/env python3
"""Compile source-bound, same-local-date and exact-method station comparisons.

Uses retained observations, never imputes censored values, and writes a new edition.
Python standard library only. Run --help for the complete production entry point.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import html
import itertools
import json
import math
import shutil
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from statistics import median
from typing import Any

VERSION = '1.0.0'
PROJECT = 'b9d5d257-c6bb-4f07-b975-8e8c63705db3'
TITLE = 'Upper Savannah | Same-day sampling support'
SOURCE_ID = 'regional-same-day-sampling-20261013'
INPUTS = {
    'routine.csv': 'data/original-routine-observations.csv',
    'all-original-intervals.csv': 'inputs/original/original_intervals/record-intervals.csv',
    'stations.csv': 'data/station-support.csv',
    'excluded-original-records.json': 'data/excluded-original-records.json',
    'atlas-summary.json': 'inputs/data/summary.json',
    'publisher-source-register.json': 'inputs/data/source-register.json',
    'original-calendar-report.json': 'observed-report.json',
}
METHODS = [
    'A match requires the same original local date, exact method context and identifier, and normalized unit. It is not an assertion of simultaneous collection, equal weather, comparable flow, or causal influence.',
    'Station A and station B are ordered by their complete original station IDs. Each row is one date/method/unit contrast, B minus A. There is one retained activity per station/date/method/unit in this edition; the compiler rejects ambiguous repetitions rather than silently selecting or pooling them.',
    'For retained intervals A=[aL,aU] and B=[bL,bU], the conservative difference enclosure is [bL-aU,bU-aL]. An original unbounded upper endpoint remains unbounded. Missing/not-reported bounds make the contrast unavailable, not zero or an infinite measurement.',
    'Censoring endpoints are carried as conservative closed enclosures. B is higher only when the lower difference bound is strictly positive; B is lower only when the upper bound is strictly negative. Overlap and boundary contact are not resolved to a direction. No half-limit substitution, p-value, exceedance standard or causal estimate is produced.',
    'Elapsed time uses the reported EDT (UTC-4) or EST (UTC-5) timestamp, not the workstation time zone. Unknown or invalid original times remain unavailable. A maximum-gap filter excludes unknown gaps. The gap is collection-time separation, not flow travel time.',
    'All station-pair summaries retain zero-support pairs. Repeated-support counts count distinct dates, not Cartesian record combinations. Method-specific contrasts remain separate when viewing all methods. Selected year ranges include every calendar year between their endpoints.',
    'Network components describe links in this selected sampling dataset only. Geographic lines are straight connectors between original stations, not river routes or downstream relations. A station with no supported peer is still retained.',
    'The original 730 records include one field replicate excluded by the existing routine-cohort membership. Its original interval record and exclusion explanation remain in the package. The analysis uses the original 729 routine activities without altering the original atlas or monitoring plans.',
]

def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + '\n', encoding='utf-8')

def write_csv(path: Path, rows: list[dict], fields: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    columns = fields or list(dict.fromkeys(k for row in rows for k in row))
    with path.open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: json.dumps(row.get(k), ensure_ascii=False, separators=(',', ':')) if isinstance(row.get(k), (dict, list)) else row.get(k) for k in columns})

def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline='', encoding='utf-8-sig') as stream:
        return list(csv.DictReader(stream))

def boolean(raw: Any) -> bool:
    if raw in (True, 'true', 'True', '1', 1):
        return True
    if raw in (False, 'false', 'False', '0', 0, '', None):
        return False
    raise ValueError(f'Unrecognized boolean {raw!r}')

def number(raw: str | None) -> float | None:
    if raw is None or raw.strip() == '':
        return None
    value = float(raw)
    if not math.isfinite(value):
        raise ValueError('A numeric source field is not finite')
    return value

def identity(row: dict) -> str:
    return f"{row['source_file']}#{row['source_row']}"

def timestamp(row: dict) -> float | None:
    offset = {'EDT': -4, 'EST': -5, 'UTC': 0, 'GMT': 0}.get(row.get('timezone'))
    if offset is None or not row.get('time'):
        return None
    try:
        value = datetime.fromisoformat(row['date'] + 'T' + row['time'])
        if value.tzinfo is not None:
            return None  # Do not resolve contradictory embedded and named offsets.
        return value.replace(tzinfo=timezone(timedelta(hours=offset))).timestamp()
    except ValueError:
        return None

def interval(row: dict) -> tuple[float | None, float | None, bool]:
    low, high = number(row.get('lower')), number(row.get('upper'))
    unbounded = boolean(row.get('upper_unbounded'))
    if low is not None and low < 0:
        raise ValueError(f'Negative concentration lower bound: {identity(row)}')
    if unbounded and high is not None:
        raise ValueError(f'Conflicting finite/unbounded upper bound: {identity(row)}')
    if high is not None and (low is None or high < low):
        raise ValueError(f'Invalid interval: {identity(row)}')
    return low, high, unbounded

def comparison(a: dict, b: dict, date: str, method: str, unit: str) -> dict:
    al, au, ai = interval(a)
    bl, bu, bi = interval(b)
    known = al is not None and bl is not None and (au is not None or ai) and (bu is not None or bi)
    lower = None if not known or ai else bl - au
    upper = None if not known or bi else bu - al
    direction = 'unavailable'
    if known:
        direction = 'B higher' if lower is not None and lower > 0 else 'B lower' if upper is not None and upper < 0 else 'same reported point' if lower == upper == 0 else 'overlap'
    ta, tb = timestamp(a), timestamp(b)
    pair_id = a['station_id'] + '|' + b['station_id']
    return {
        'pair_id': pair_id, 'station_a': a['station_id'], 'station_b': b['station_id'],
        'date': date, 'year': int(date[:4]), 'method': method, 'unit': unit,
        'activity_a': a['activity_id'], 'activity_b': b['activity_id'],
        'source_a': identity(a), 'source_b': identity(b),
        'time_a': a['time'], 'timezone_a': a['timezone'], 'time_b': b['time'], 'timezone_b': b['timezone'],
        'gap_hours': None if ta is None or tb is None else abs(tb - ta) / 3600,
        'status_a': a['status'], 'status_b': b['status'],
        'a_lower': al, 'a_upper': au, 'a_upper_unbounded': ai,
        'b_lower': bl, 'b_upper': bu, 'b_upper_unbounded': bi,
        'difference_lower': lower, 'difference_upper': upper,
        'difference_lower_unbounded': bool(known and ai), 'difference_upper_unbounded': bool(known and bi),
        'difference_available': known, 'direction': direction,
    }

def components(station_ids: list[str], edges: list[tuple[str, str]]) -> list[list[str]]:
    neighbors = {s: set() for s in station_ids}
    for a, b in edges:
        neighbors[a].add(b)
        neighbors[b].add(a)
    remaining = set(station_ids)
    result = []
    while remaining:
        start = min(remaining)
        remaining.remove(start)
        reached, pending = {start}, [start]
        while pending:
            for s in neighbors[pending.pop()] & remaining:
                remaining.remove(s)
                reached.add(s)
                pending.append(s)
        result.append(sorted(reached))
    return sorted(result, key=lambda value: (-len(value), value))

def build(calendar: Path) -> dict:
    routine = read_csv(calendar / INPUTS['routine.csv'])
    original = read_csv(calendar / INPUTS['all-original-intervals.csv'])
    stations = read_csv(calendar / INPUTS['stations.csv'])
    atlas = json.loads((calendar / INPUTS['atlas-summary.json']).read_text())
    prior_report = json.loads((calendar / INPUTS['original-calendar-report.json']).read_text())
    if prior_report.get('project_id') != PROJECT or atlas.get('project_id') != PROJECT:
        raise ValueError('The retained calendar belongs to a different scientific project')
    all_rows = {identity(row): row for row in original}
    if len(all_rows) != len(original):
        raise ValueError('Duplicate original source-row identity')
    ids = sorted(s['station_id'] for s in stations)
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate station identity')
    if len(routine) != 729 or len(original) != 730 or len(ids) != 36:
        raise ValueError('This edition requires the original 729/730 record and 36-station cohort')
    by_key, by_activity, grouped = {}, set(), defaultdict(dict)
    day_stations = defaultdict(set)
    method_records = Counter()
    for row in routine:
        key = identity(row)
        if key in by_key or row['activity_id'] in by_activity:
            raise ValueError(f'Duplicate routine source or activity identity: {key}')
        if key not in all_rows or row['activity_type'] != 'Sample-Routine' or row['station_id'] not in ids:
            raise ValueError(f'Unknown station, non-routine record, or missing original: {key}')
        # The upstream calendar normalized numeric spelling (1 to 1.0).
        # Verify exact decimal values while retaining both complete input files.
        for field in all_rows[key].keys() & row.keys():
            if field in ('month', 'year', 'season', 'huc12', 'method_key', 'upper_unbounded'):
                continue
            original_value, retained_value = all_rows[key][field], row[field]
            equal = original_value == retained_value
            if not equal and field in ('limit_value', 'result_value', 'lower', 'upper') and original_value and retained_value:
                equal = Decimal(original_value) == Decimal(retained_value)
            if not equal:
                raise ValueError(f'Changed original {field} in {key}')
        datetime.strptime(row['date'], '%Y-%m-%d')
        interval(row)
        method = row['method_context'] + ':' + row['method']
        if row['method_key'] != method:
            raise ValueError(f'Method identity mismatch in {key}')
        group = grouped[(row['date'], method, row['unit'])]
        if row['station_id'] in group:
            raise ValueError('Multiple activities per station/date/method/unit need an explicit new grouping design')
        group[row['station_id']] = row
        by_key[key] = row
        by_activity.add(row['activity_id'])
        day_stations[row['date']].add(row['station_id'])
        method_records[method] += 1
    contrasts, events = [], []
    pair_dates_any = defaultdict(set)
    for date, sites in sorted(day_stations.items()):
        for a, b in itertools.combinations(sorted(sites), 2):
            pair_dates_any[a + '|' + b].add(date)
    for (date, method, unit), mapping in sorted(grouped.items()):
        rows = [mapping[s] for s in sorted(mapping)]
        times = [timestamp(row) for row in rows]
        events.append({'date': date, 'year': int(date[:4]), 'method': method, 'unit': unit,
            'stations': sorted(mapping), 'station_count': len(rows), 'source_rows': [identity(row) for row in rows],
            'pair_contrasts': len(rows) * (len(rows) - 1) // 2,
            'collection_span_hours': (max(times) - min(times)) / 3600 if all(t is not None for t in times) else None})
        for a, b in itertools.combinations(rows, 2):
            contrasts.append(comparison(a, b, date, method, unit))
    by_pair = defaultdict(list)
    for row in contrasts:
        by_pair[row['pair_id']].append(row)
    pairs, annual = [], []
    years = list(range(min(int(r['date'][:4]) for r in routine), max(int(r['date'][:4]) for r in routine) + 1))
    for a, b in itertools.combinations(ids, 2):
        pid = a + '|' + b
        rows = by_pair[pid]
        dates = {r['date'] for r in rows}
        gaps = [r['gap_hours'] for r in rows if r['gap_hours'] is not None]
        direction = Counter(r['direction'] for r in rows)
        pairs.append({'pair_id': pid, 'station_a': a, 'station_b': b,
            'same_date_any_method': len(pair_dates_any[pid]), 'shared_dates': len(dates), 'contrasts': len(rows),
            'years': sorted({r['year'] for r in rows}), 'methods': sorted({r['method'] for r in rows}),
            'first_date': min(dates) if dates else '', 'last_date': max(dates) if dates else '',
            'median_gap_hours': median(gaps) if gaps else None, 'max_gap_hours': max(gaps) if gaps else None,
            'gap_at_most_1h': sum(g <= 1 for g in gaps),
            'b_higher': direction['B higher'], 'b_lower': direction['B lower'], 'same_point': direction['same reported point'],
            'overlap': direction['overlap'], 'unavailable': direction['unavailable']})
        for year in years:
            for method in sorted(method_records):
                selected = [r for r in rows if r['year'] == year and r['method'] == method]
                annual.append({'pair_id': pid, 'station_a': a, 'station_b': b, 'year': year, 'method': method,
                    'shared_dates': len({r['date'] for r in selected}), 'contrasts': len(selected),
                    'available_contrasts': sum(r['difference_available'] for r in selected)})
    direction = Counter(r['direction'] for r in contrasts)
    groups = components(ids, [(p['station_a'], p['station_b']) for p in pairs if p['shared_dates']])
    source_fingerprint = hashlib.sha256(json.dumps({k: digest(calendar / v) for k, v in INPUTS.items()}, sort_keys=True).encode()).hexdigest()
    summary = {'schema': 'upstate.same-day-summary/v1', 'version': VERSION, 'project_id': PROJECT,
        'source_fingerprint': source_fingerprint, 'original_records': len(original), 'routine_activities': len(routine),
        'excluded_records': len(original) - len(routine), 'station_count': len(stations), 'huc12_count': atlas['huc12_count'],
        'years': years, 'all_dates': len(day_stations), 'exact_method_events': len(events),
        'multi_station_events': sum(r['station_count'] > 1 for r in events),
        'possible_pairs': len(pairs), 'supported_pairs': sum(p['shared_dates'] > 0 for p in pairs),
        'zero_support_pairs': sum(p['shared_dates'] == 0 for p in pairs),
        'pairs_at_least_5_dates': sum(p['shared_dates'] >= 5 for p in pairs),
        'pairs_at_least_12_dates': sum(p['shared_dates'] >= 12 for p in pairs),
        'contrasts': len(contrasts), 'contrast_directions': dict(sorted(direction.items())),
        'contrasts_gap_at_most_1h': sum(r['gap_hours'] is not None and r['gap_hours'] <= 1 for r in contrasts),
        'contrasts_unknown_gap': sum(r['gap_hours'] is None for r in contrasts),
        'max_gap_hours': max(r['gap_hours'] for r in contrasts if r['gap_hours'] is not None),
        'method_counts': dict(sorted(method_records.items())), 'result_status_counts': dict(Counter(r['status'] for r in routine)),
        'network_components': len(groups), 'network_component_sizes': [len(g) for g in groups],
        'isolated_stations': [g[0] for g in groups if len(g) == 1]}
    return {'summary': summary, 'stations': stations, 'pairs': pairs, 'contrasts': contrasts, 'events': events,
        'annual': annual, 'observations': routine, 'components': groups, 'methods': METHODS,
        'excluded': json.loads((calendar / INPUTS['excluded-original-records.json']).read_text())}

def sections(data: dict) -> list:
    s = data['summary']
    table = lambda columns, rows: {'kind': 'table', 'columns': columns, 'rows': rows}
    short = lambda name: name.split('WQX-')[-1]
    ranked = sorted((p for p in data['pairs'] if p['shared_dates']), key=lambda p: (-p['shared_dates'], p['pair_id']))[:12]
    annual = []
    for year in s['years']:
        c = [r for r in data['contrasts'] if r['year'] == year]
        annual.append([year, len(c), len({r['pair_id'] for r in c}), len({r['date'] for r in c}), sum(r['difference_available'] for r in c)])
    return [
        ['Sampling support across the retained regional network', [
            f"The complete original cohort contains {s['routine_activities']} routine activities at {s['station_count']} stations. Exact date, method and unit matching yields {s['contrasts']} station-pair contrasts across {s['supported_pairs']} of {s['possible_pairs']} possible station pairs. The other {s['zero_support_pairs']} pairs have no matching date in this selected cohort.",
            f"{s['pairs_at_least_5_dates']} station pairs share at least five distinct dates; {s['pairs_at_least_12_dates']} share at least twelve. This is a historical support inventory, not a funded sampling programme or a test of water-quality differences.",
            table(['Year', 'Contrasts', 'Supported pairs', 'Shared dates', 'Available intervals'], annual)]],
        ['Collection time and result bounds', [
            f"{s['contrasts_gap_at_most_1h']} of {s['contrasts']} contrasts have collection-time separation of at most one hour. The maximum retained separation is {s['max_gap_hours']:.3f} hours. Same date therefore does not mean simultaneous sampling.",
            table(['Conservative B minus A interval classification', 'Contrasts'], [[k, v] for k, v in s['contrast_directions'].items()]),
            'Each comparison is independently source-bound. A direction count is not a significance result, paired observations are not independent across reused dates and stations, and method changes are not pooled into a concentration trend.']],
        ['Most repeatedly co-sampled station pairs', [
            table(['Station A', 'Station B', 'Shared dates', 'Median gap (h)'], [[short(p['station_a']), short(p['station_b']), p['shared_dates'], round(p['median_gap_hours'], 2)] for p in ranked]),
            'Short station labels are for display only. Complete original station IDs, every zero-support pair and every matched source record appear in the accompanying CSV and offline explorer.']],
        ['Source-bound review and operational use', [
            'Open index.html offline. Select method, year range, maximum collection-time gap, and minimum shared dates. Inspect a pair to see both original activities, original bounds and collection times. Export the entire selected table or contrasts, not only the visible page.',
            'Save a source-bound review JSON including filters, selected pair and working note. Reopening rejects foreign source identities before replacing the current draft. Import same-day-report.sources.json into the existing Sources and Scientific Reports workflow to reuse this complete report and its original source companions.',
            f"The resulting co-sampling graph has {s['network_components']} components including isolated stations, under the unfiltered at-least-one-shared-date definition. These are sampling-support components, not hydrologic catchments."]],
        ['Method and original source preservation', METHODS],
    ]

def static_report(data: dict) -> str:
    esc = lambda value: html.escape(str(value))
    body = []
    for title, content in sections(data):
        body.append('<section><h2>' + esc(title) + '</h2>')
        for item in content:
            if isinstance(item, str):
                body.append('<p>' + esc(item) + '</p>')
            else:
                body.append('<div class="scroll"><table><thead><tr>' + ''.join('<th>' + esc(c) + '</th>' for c in item['columns']) + '</tr></thead><tbody>')
                body.extend('<tr>' + ''.join('<td>' + esc(c) + '</td>' for c in row) + '</tr>' for row in item['rows'])
                body.append('</tbody></table></div>')
        body.append('</section>')
    return '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Upper Savannah same-day sampling report</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#171717;background:#fff;margin:0}main{max-width:980px;margin:auto;padding:28px}h1{font-size:30px;line-height:1.2}h2{font-size:22px;border-top:1px solid #aaa;padding-top:22px}a{color:inherit}section{break-inside:auto}.scroll{max-width:100%;overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:9px;text-align:left;border-bottom:1px solid #ccc}th{background:#eee}td{font-variant-numeric:tabular-nums}p{overflow-wrap:anywhere}@media(max-width:500px){main{padding:18px}h1{font-size:26px}}@media print{main{padding:0;font-size:10pt}a{color:#000}.scroll{overflow:visible}table{font-size:8pt}tr{break-inside:avoid}h2{break-after:avoid}h1{font-size:20pt}}</style><main><p>ECOSYSTEM SCIENCES / SOURCE-BOUND STUDY</p><h1>Upper Savannah<br>Same-day sampling support</h1><p>2021–2025 original routine cohort · 13 October 2026</p><p><a href="index.html">Open interactive review</a> · <a href="data/pair-support.csv">Complete station-pair table</a> · <a href="data/paired-contrasts.csv">All paired contrasts</a></p>''' + ''.join(body) + '</main></html>'

def prepare(calendar: Path, output: Path) -> dict:
    calendar = calendar.resolve(strict=True)
    output = output.resolve()
    if output == calendar or output.is_relative_to(calendar):
        raise ValueError('Write a new edition outside the retained input calendar')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output already contains files; preserve it and choose a fresh edition')
    for name in INPUTS.values():
        p = (calendar / name).resolve(strict=True)
        if not p.is_relative_to(calendar) or not p.is_file():
            raise ValueError('Input escapes the original calendar directory')
    data = build(calendar)
    output.mkdir(parents=True, exist_ok=True)
    originals = []
    for target_name, relative in INPUTS.items():
        target = output / 'inputs' / target_name
        target.parent.mkdir(exist_ok=True)
        shutil.copy2(calendar / relative, target)
        originals.append({'path': target.relative_to(output).as_posix(), 'original_path': relative, 'bytes': target.stat().st_size, 'sha256': digest(target)})
    write_json(output / 'data/analysis.json', data)
    write_json(output / 'data/summary.json', data['summary'])
    for name, key in [('pair-support','pairs'), ('paired-contrasts','contrasts'), ('date-method-events','events'), ('pair-year-method-support','annual'), ('station-source','stations')]:
        write_csv(output / f'data/{name}.csv', data[key])
    write_json(output / 'data/input-manifest.json', {'project_id': PROJECT, 'source_fingerprint': data['summary']['source_fingerprint'], 'files': originals})
    write_json(output / 'data/network-components.json', {'definition': 'At least one exact-method/unit same-local-date contrast', 'components': data['components']})
    browser = {k: v for k, v in data.items() if k != 'annual'}
    payload = json.dumps(browser, ensure_ascii=False, separators=(',', ':'), allow_nan=False).replace('<', '\\u003c')
    template = Path(__file__).with_name('review.html').read_text(encoding='utf-8')
    if template.count('__PAYLOAD__') != 1:
        raise ValueError('The offline template requires exactly one payload marker')
    (output / 'index.html').write_text(template.replace('__PAYLOAD__', payload), encoding='utf-8')
    (output / 'report.html').write_text(static_report(data), encoding='utf-8')
    for name in ('cosample.py', 'review.html', 'receive_report.py', 'README.md'):
        src = Path(__file__).with_name(name)
        if not src.is_file():
            raise ValueError(f'Complete delivery source is missing {name}')
        (output / 'source').mkdir(exist_ok=True)
        shutil.copy2(src, output / 'source' / name)
    companions = [{'path': p.relative_to(output).as_posix(), 'bytes': p.stat().st_size, 'sha256': digest(p)} for p in sorted(output.rglob('*')) if p.is_file()]
    recipe = {'schema': 'upstate.observed-report/v1', 'title': TITLE, 'project_id': PROJECT,
        'basis': {'source_operation': 'ECO-COSAMPLE-13', 'source_fingerprint': data['summary']['source_fingerprint'], 'original_atlas': json.loads((output / 'inputs/atlas-summary.json').read_text()), 'reference_years': [2021, 2025]},
        'sections': sections(data), 'inputs': companions,
        'source_links': ['index.html', 'report.html', 'data/pair-support.csv', 'data/paired-contrasts.csv', 'data/pair-year-method-support.csv', 'inputs/publisher-source-register.json']}
    write_json(output / 'observed-report.json', recipe)
    entry = {'id': SOURCE_ID, 'kind': 'document', 'title': TITLE, 'path': 'observed-report.json',
        'sha256': digest(output / 'observed-report.json'), 'vintage': '2026-10-13',
        'uri': 'urn:commons:project:' + PROJECT + ':' + SOURCE_ID,
        'metadata': {'project_id': PROJECT, 'report_schema': recipe['schema'], 'source_fingerprint': data['summary']['source_fingerprint']},
        'companions': [{'path': c['path'], 'sha256': c['sha256']} for c in companions]}
    write_json(output / 'same-day-report.sources.json', {'schema': 'upstate.sources/v1', 'title': TITLE, 'captured_at': '2026-10-13', 'entries': [entry]})
    write_json(output / 'manifest.json', {'schema': 'upstate.same-day-delivery/v1', 'version': VERSION, 'project_id': PROJECT,
        'summary': data['summary'], 'files': [{'path': p.relative_to(output).as_posix(), 'bytes': p.stat().st_size, 'sha256': digest(p)} for p in sorted(output.rglob('*')) if p.is_file()]})
    return data['summary']

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--calendar', required=True, type=Path, help='Existing full regional calendar study directory')
    parser.add_argument('--output', required=True, type=Path, help='Fresh output directory outside the retained source')
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.calendar, args.output), indent=2, allow_nan=False))
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as exc:
        parser.exit(2, f'Cannot compile this edition: {exc}\n')

if __name__ == '__main__':
    main()

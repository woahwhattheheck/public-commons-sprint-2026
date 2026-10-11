"""Read-only SF36 buyer statements. Python 3.10+, standard library only.

Run beside the existing governor.py. This module never constructs a Governor,
loads signing keys, mutates the ledger, or makes network requests.
"""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import html
import io
import json
import os
import re
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from governor import ID_PATTERN, NETWORKS, canonical, parse_amount, validate_policy

SCHEMA = 'stellar-buyer-statement/v1'
COLUMNS = ('request_id', 'request_digest', 'actor', 'service', 'network', 'asset',
           'scheme', 'amount', 'day', 'state', 'actual', 'receipt_ref', 'proof_sha256')
MONEY = ('settled_base_units', 'reserved_base_units', 'released_capacity_base_units')
CSV_FIELDS = ('request_id', 'day', 'actor', 'service', 'network', 'asset', 'scheme',
              'state', 'amount', *MONEY, 'age_utc_days', 'receipt_ref', 'proof_sha256')
HEX = re.compile(r'[0-9a-f]{64}')
ASSET = re.compile(r'[A-Z2-7]{56}')


class StatementError(ValueError):
    """The requested statement cannot be produced without misleading the operator."""


def utc_day(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise StatementError('day must be YYYY-MM-DD')
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise StatementError('day is not a calendar date') from exc
    return value


def read_snapshot(database: str | Path) -> dict:
    """Read committed WAL data in ONE transaction, without creating a missing DB.

    Do not use immutable=1: it can omit the active WAL. SQLite may maintain WAL
    shared-memory sidecars; this command issues no data/schema/checkpoint writes.
    """
    path = Path(database).expanduser().resolve(strict=True)
    if not path.is_file():
        raise StatementError('database must be an existing SQLite file')
    con = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True,
                          isolation_level=None, timeout=10)
    try:
        con.execute('PRAGMA query_only=ON')
        con.execute('PRAGMA trusted_schema=OFF')
        con.execute('BEGIN')
        # First SELECT fixes the snapshot, including all later metadata reads.
        kinds = dict(con.execute("SELECT name,type FROM sqlite_master WHERE name IN ('reservations','journal')"))
        if kinds != {'reservations': 'table', 'journal': 'table'}:
            raise StatementError('expected the existing SF36 reservations and journal tables')
        actual = {r[1] for r in con.execute('PRAGMA table_info(reservations)')}
        if not set(COLUMNS) <= actual:
            raise StatementError('SF36 reservations schema is missing required columns')
        rows = [dict(zip(COLUMNS, row)) for row in con.execute(
            'SELECT ' + ','.join(COLUMNS) + ' FROM reservations ORDER BY day,request_id')]
        events, sequence = con.execute('SELECT COUNT(*),COALESCE(MAX(sequence),0) FROM journal').fetchone()
        result = {'rows': rows, 'journal_events': events, 'last_sequence': sequence,
                  'captured_at': datetime.now(timezone.utc).isoformat(),
                  'database_name': path.name}
        con.execute('COMMIT')
        return result
    finally:
        con.close()


def normalize_rows(rows: list[dict], today: str) -> list[dict]:
    normalized, seen = [], set()
    for original in rows:
        if not isinstance(original, dict) or any(not isinstance(original.get(k), str) for k in COLUMNS):
            raise StatementError('SF36 rows require all thirteen original text fields')
        r = {k: original[k] for k in COLUMNS}
        for k in ('request_id', 'actor', 'service'):
            if not ID_PATTERN.fullmatch(r[k]):
                raise StatementError('invalid ledger identity: ' + k)
        if r['request_id'] in seen:
            raise StatementError('duplicate ledger request identity')
        seen.add(r['request_id'])
        if r['network'] not in NETWORKS or not ASSET.fullmatch(r['asset']):
            raise StatementError('invalid ledger network/asset')
        if not HEX.fullmatch(r['request_digest']):
            raise StatementError('invalid request digest')
        utc_day(r['day'])
        maximum, actual = parse_amount(r['amount']), parse_amount(r['actual'])
        if maximum < 1 or actual > maximum or r['scheme'] not in ('exact', 'upto'):
            raise StatementError('inconsistent ledger amounts/scheme')
        if r['state'] == 'reserved':
            if actual != 0 or r['receipt_ref'] or r['proof_sha256']:
                raise StatementError('reserved row unexpectedly contains settlement fields')
            settled, pending, released = 0, maximum, 0
        elif r['state'] == 'settled':
            if (not r['receipt_ref'] or len(r['receipt_ref']) > 512 or
                    not HEX.fullmatch(r['proof_sha256']) or
                    (r['scheme'] == 'exact' and actual != maximum)):
                raise StatementError('inconsistent settled row')
            settled, pending, released = actual, 0, maximum - actual
        else:
            raise StatementError('unknown reservation state; update the reader for this schema')
        age = (date.fromisoformat(today) - date.fromisoformat(r['day'])).days
        r.update(zip(MONEY, map(str, (settled, pending, released))))
        r['age_utc_days'] = age if r['state'] == 'reserved' and age >= 0 else None
        normalized.append(r)
    return sorted(normalized, key=lambda r: (r['day'], r['request_id']))


def aggregate(rows: list[dict], dimensions: tuple[str, ...] = ()) -> list[dict]:
    """Never sum unlike assets/networks. Python integers avoid aggregate overflow."""
    keys = ('network', 'asset', *dimensions)
    groups: dict[tuple, dict] = {}
    for r in rows:
        key = tuple(r[k] for k in keys)
        g = groups.setdefault(key, {**dict(zip(keys, key)), 'requests': 0,
                                   'pending_requests': 0, **dict.fromkeys(MONEY, 0)})
        g['requests'] += 1
        g['pending_requests'] += int(r['state'] == 'reserved')
        for name in MONEY:
            g[name] += int(r[name])
    result = []
    for key in sorted(groups):
        g = groups[key]
        g['accounted_base_units'] = str(g[MONEY[0]] + g[MONEY[1]])
        for name in MONEY:
            g[name] = str(g[name])
        result.append(g)
    return result


def parse_labels(value: dict | None) -> dict[tuple, dict]:
    if value is None:
        return {}
    if not isinstance(value, dict) or set(value) != {'assets'} or not isinstance(value['assets'], list):
        raise StatementError('labels must be an object containing an assets array')
    labels = {}
    for item in value['assets']:
        if not isinstance(item, dict) or set(item) != {'network', 'asset', 'symbol', 'decimals'}:
            raise StatementError('each label needs network, asset, symbol and decimals')
        pair = (item['network'], item['asset'])
        if (not isinstance(pair[0], str) or pair[0] not in NETWORKS or
                not isinstance(pair[1], str) or not ASSET.fullmatch(pair[1])):
            raise StatementError('invalid label network/asset')
        if pair in labels:
            raise StatementError('duplicate asset label')
        symbol, decimals = item['symbol'], item['decimals']
        if (not isinstance(symbol, str) or not 1 <= len(symbol) <= 24 or
                any(ord(c) < 32 or ord(c) == 127 for c in symbol) or
                type(decimals) is not int or not 0 <= decimals <= 30):
            raise StatementError('label symbol/decimals invalid')
        labels[pair] = item.copy()
    return labels


def select_rows(rows: list[dict], filters: dict) -> list[dict]:
    allowed = {'from_day', 'through_day', 'actor', 'service', 'network', 'asset', 'state'}
    if not isinstance(filters, dict) or set(filters) - allowed:
        raise StatementError('unknown statement filter')
    for key, value in filters.items():
        if not isinstance(value, str) or not value:
            raise StatementError('filter values must be nonempty strings')
        if key in ('from_day', 'through_day'):
            utc_day(value)
    if filters.get('from_day', '') > filters.get('through_day', '9999-12-31'):
        raise StatementError('from-day is after through-day')
    if 'network' in filters and filters['network'] not in NETWORKS:
        raise StatementError('unsupported filter network')
    if 'state' in filters and filters['state'] not in ('reserved', 'settled'):
        raise StatementError('state must be reserved or settled')
    return [r for r in rows if
            r['day'] >= filters.get('from_day', '0001-01-01') and
            r['day'] <= filters.get('through_day', '9999-12-31') and
            all(r[k] == v for k, v in filters.items() if k not in ('from_day', 'through_day'))]


def build_statement(snapshot: dict, *, filters: dict | None = None,
                    policy: dict | None = None, labels: dict | None = None) -> dict:
    captured = datetime.fromisoformat(snapshot['captured_at'].replace('Z', '+00:00'))
    if captured.tzinfo is None or captured.utcoffset().total_seconds() != 0:
        raise StatementError('snapshot time must be explicitly UTC')
    today = captured.date().isoformat()
    rows = normalize_rows(snapshot['rows'], today)
    selected = select_rows(rows, filters or {})
    parsed_labels = parse_labels(labels)
    limits = validate_policy(policy) if policy is not None else {}
    portfolio = {(g['network'], g['asset']): g for g in aggregate(rows)}
    for pair in limits:
        portfolio.setdefault(pair, {'network': pair[0], 'asset': pair[1], 'requests': 0,
                                    'pending_requests': 0, **dict.fromkeys(MONEY, '0'),
                                    'accounted_base_units': '0'})
    today_usage = {(g['network'], g['asset']): int(g['accounted_base_units'])
                   for g in aggregate([r for r in rows if r['day'] == today])}
    for pair, group in portfolio.items():
        group['today_accounted_base_units'] = str(today_usage.get(pair, 0))
        if pair in limits:
            cap = limits[pair]
            used, day_used = int(group['accounted_base_units']), today_usage.get(pair, 0)
            group['policy'] = {k: str(v) for k, v in cap.items()}
            group['remaining_total_base_units'] = str(max(0, cap['max_total'] - used))
            group['remaining_today_base_units'] = str(max(0, cap['max_per_utc_day'] - day_used))
            group['over_total_base_units'] = str(max(0, used - cap['max_total']))
            group['over_today_base_units'] = str(max(0, day_used - cap['max_per_utc_day']))
    return {
        'schema': SCHEMA, 'captured_at': snapshot['captured_at'], 'today_utc': today,
        'source': {'database_name': snapshot['database_name'], 'reservations': len(rows),
                   'journal_events': snapshot['journal_events'], 'last_sequence': snapshot['last_sequence'],
                   'projection_sha256': hashlib.sha256(canonical(snapshot['rows'])).hexdigest()},
        'basis': 'SF36 ledger projection; no HMAC or independent chain verification performed',
        'date_basis': 'UTC reservation day, not settlement or accounting recognition date',
        'filters': filters or {}, 'rows': selected,
        'selected_totals': aggregate(selected),
        'by_actor': aggregate(selected, ('actor',)),
        'by_service': aggregate(selected, ('service',)),
        'by_reservation_day': aggregate(selected, ('day',)),
        'portfolio': [portfolio[p] for p in sorted(portfolio)],
        'asset_labels': [parsed_labels[p] for p in sorted(parsed_labels)],
        'notes': [
            'Portfolio and policy capacity cover the entire snapshot, unaffected by selection filters.',
            'Reserved maximum is unresolved exposure, not settled spend and not an automatic refund.',
            'Released capacity is an unused authorization maximum, not returned money.',
            'Remaining total/day capacity is not a new purchase approval; other native caps and concurrent work still apply.',
            'Asset labels/decimals are supplied by the operator; no token registry or fiat conversion is used.',
            'Exports contain private actor, service and receipt references. Keep them off public hosting.'
        ]
    }


def csv_cell(value: Any) -> str:
    text = '' if value is None else str(value)
    # Spreadsheet formula injection protection. Numeric base units remain exact
    # decimal bytes; spreadsheet importers must select TEXT to prevent rounding.
    if text and (text[0] in '\t\r\n' or text.lstrip()[:1] in ('=', '+', '-', '@')):
        return "'" + text
    return text


def render_csv(rows: list[dict]) -> str:
    out = io.StringIO(newline='')
    writer = csv.writer(out, lineterminator='\r\n')
    writer.writerow(CSV_FIELDS)
    writer.writerows([csv_cell(r.get(k)) for k in CSV_FIELDS] for r in rows)
    return out.getvalue()


def format_units(value: str, label: dict | None = None) -> str:
    if label is None:
        return value + ' base units'
    precision = label['decimals']
    padded = value.zfill(precision + 1)
    number = padded if precision == 0 else padded[:-precision] + '.' + padded[-precision:]
    return number + ' ' + label['symbol']


CSS = '''
:root{color-scheme:light;--ink:#172b3a;--muted:#506574;--line:#d5e0e7;--paper:#f2f6f8;--accent:#165f70}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,sans-serif}
header{background:#122d3c;color:white;padding:34px max(20px,calc((100vw - 1240px)/2))}header p{color:#c2d6df}
h1{font-size:clamp(28px,4vw,44px);line-height:1.15;margin:12px 0}h2{font-size:21px;margin:0 0 10px}h3{font-size:16px}
.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase}.tag{display:inline-block;padding:4px 10px;border:1px solid #658996;border-radius:20px;font-size:12px}
main{max-width:1280px;margin:auto;padding:24px 20px 48px}.panel{background:white;border:1px solid var(--line);border-radius:12px;margin-bottom:20px;padding:22px}
p{margin:7px 0 16px}.muted,small{color:var(--muted)}.toolbar{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:16px 0}
label{display:flex;flex-direction:column;gap:4px;font-size:12px;flex:1;min-width:130px}input,select,button{font:inherit;padding:10px;border:1px solid #b7c9d3;border-radius:6px;background:white;color:var(--ink)}
button{cursor:pointer;font-size:13px;background:#e9f2f4}button:hover{background:#d4e8ec}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #1b8095;outline-offset:2px}
.scroll{overflow:auto}.scroll table{min-width:800px}.detail-table{min-width:1160px!important}.detail-table td:not(.contract){white-space:nowrap}.toolbar label:first-child{flex:2;min-width:220px}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:var(--muted);font-size:11px;letter-spacing:.035em;text-transform:uppercase}
th,td{border-bottom:1px solid var(--line);padding:11px 9px;vertical-align:top}tbody tr:hover{background:#f4f8f9}.number{font-variant-numeric:tabular-nums;font-family:ui-monospace,monospace;white-space:nowrap}
.contract{min-width:180px;max-width:330px;overflow-wrap:anywhere;font:11px/1.6 ui-monospace,monospace;color:var(--muted)}.status{display:inline-block;border-radius:4px;padding:2px 6px;background:#e6f0f2;white-space:nowrap}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.card{border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:7px;padding:16px}.card p{margin:3px 0}
.metric{display:flex;gap:10px;justify-content:space-between;font-size:13px;margin-top:8px}.metric strong{font-variant-numeric:tabular-nums;text-align:right;overflow-wrap:anywhere}
.empty{padding:20px;border:1px dashed #aabfc9;color:var(--muted)}details{margin-top:16px}summary{cursor:pointer;font-weight:600}code{font-size:12px;overflow-wrap:anywhere}.note{border-left:3px solid #83a5b1;padding-left:12px}.actions{display:flex;gap:8px;flex-wrap:wrap}
@media(max-width:640px){main{padding:14px 10px}.panel{padding:15px}.toolbar{gap:8px}.toolbar label{min-width:44%}th,td{padding:9px 6px}.cards{grid-template-columns:1fr}.contract{max-width:220px}}
@media print{header{background:white;color:#172b3a;padding:12px}header p{color:#506574}body{background:white}.toolbar,.actions{display:none}.panel{break-inside:avoid;border-radius:0}.scroll{overflow:visible}table{font-size:9px}}
'''

JS = r'''
'use strict';
const report=JSON.parse(document.getElementById('statement-data').textContent);
const $=id=>document.getElementById(id), labels=new Map(report.asset_labels.map(x=>[x.network+'\0'+x.asset,x]));
const money=['settled_base_units','reserved_base_units','released_capacity_base_units'];
function units(v,r){const l=labels.get(r.network+'\0'+r.asset);if(!l)return v+' base units';const p=v.padStart(l.decimals+1,'0');return(l.decimals?p.slice(0,-l.decimals)+'.'+p.slice(-l.decimals):p)+' '+l.symbol;}
function node(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function groups(rows,dimension){const m=new Map();for(const r of rows){const key=JSON.stringify([r.network,r.asset,...(dimension?[r[dimension]]:[])]);if(!m.has(key))m.set(key,{network:r.network,asset:r.asset,...(dimension?{[dimension]:r[dimension]}:{}),requests:0,pending_requests:0,...Object.fromEntries(money.map(k=>[k,0n]))});const g=m.get(key);g.requests++;g.pending_requests+=Number(r.state==='reserved');for(const k of money)g[k]+=BigInt(r[k]);}return [...m.entries()].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0).map(([,g])=>({...g,accounted_base_units:String(g[money[0]]+g[money[1]]),...Object.fromEntries(money.map(k=>[k,String(g[k])]))}));}
for(const key of ['actor','service','network','asset','state'])for(const value of [...new Set(report.rows.map(r=>r[key]))].sort()){const o=node('option',value);o.value=value;$(key).append(o);}
function viewRows(){const q=$('search').value.trim().toLowerCase();return report.rows.filter(r=>['actor','service','network','asset','state'].every(k=>!$(k).value||r[k]===$(k).value)&&(!$('from-day').value||r.day>=$('from-day').value)&&(!$('through-day').value||r.day<=$('through-day').value)&&(!q||[r.request_id,r.actor,r.service,r.network,r.asset,r.receipt_ref].some(v=>v.toLowerCase().includes(q))));}
function viewFilters(){return Object.fromEntries(['actor','service','network','asset','state','search','from-day','through-day'].map(k=>[k,$(k).value]).filter(([,v])=>v));}
function totals(rows){const target=$('selected-totals');target.replaceChildren();const gs=groups(rows);if(!gs.length){target.append(node('p','No reservations in this selection. Portfolio exposure above is unchanged.','empty'));return;}for(const g of gs){const c=node('article',undefined,'card');c.append(node('h3',g.network),node('p',g.asset,'contract'));for(const [k,label] of [['settled_base_units','Settled actual'],['reserved_base_units','Outstanding maximum'],['released_capacity_base_units','Unused capacity released']]){const line=node('div',undefined,'metric');line.append(node('span',label),node('strong',units(g[k],g)));c.append(line);}c.append(node('small',g.requests+' requests · '+g.pending_requests+' unresolved'));target.append(c);}}
function detailRows(rows){const body=$('rows');body.replaceChildren();for(const r of rows){const tr=node('tr');for(const [value,cls] of [[r.request_id,''],[r.day,''],[r.actor,''],[r.service,''],[r.network+' / '+r.asset,'contract'],[r.state,''],[units(r.settled_base_units,r),'number'],[units(r.reserved_base_units,r),'number'],[units(r.released_capacity_base_units,r),'number'],[r.age_utc_days===null?'—':String(r.age_utc_days),'number']])tr.append(node('td',value,cls));body.append(tr);}}
function breakdown(rows,dimension,id){const body=$(id);body.replaceChildren();for(const g of groups(rows,dimension)){const tr=node('tr');for(const [text,cls] of [[g[dimension],''],[g.network+' / '+g.asset,'contract'],[String(g.requests),'number'],[units(g.settled_base_units,g),'number'],[units(g.reserved_base_units,g),'number']])tr.append(node('td',text,cls));body.append(tr);}}
function paint(){const rows=viewRows();const bad=$('from-day').value&&$('through-day').value&&$('from-day').value>$('through-day').value;$('count').textContent=bad?'Date range is reversed. No rows match.':rows.length+' of '+report.rows.length+' exported reservations shown. Totals and breakdowns follow these filters.';totals(rows);detailRows(rows);breakdown(rows,'actor','actors');breakdown(rows,'service','services');breakdown(rows,'day','days');}
function cell(v){let s=v===null||v===undefined?'':String(v);if(/^[\t\r\n]/.test(s)||/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function csv(rows){return[report.csv_fields.map(cell).join(','),...rows.map(r=>report.csv_fields.map(k=>cell(r[k])).join(','))].join('\r\n')+'\r\n';}
function save(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('csv').addEventListener('click',()=>save('starforge-spend-selection.csv',csv(viewRows()),'text/csv;charset=utf-8'));
$('json').addEventListener('click',()=>{const rows=viewRows();const{csv_fields,...base}=report;save('starforge-spend-selection.json',JSON.stringify({...base,view_filters:viewFilters(),rows,selected_totals:groups(rows),by_actor:groups(rows,'actor'),by_service:groups(rows,'service'),by_reservation_day:groups(rows,'day')},null,2)+'\n','application/json');});
$('reset').addEventListener('click',()=>{for(const k of ['actor','service','network','asset','state','search','from-day','through-day'])$(k).value='';paint();});
for(const key of ['actor','service','network','asset','state','search','from-day','through-day'])$(key).addEventListener('input',paint);
paint();
'''


def render_html(report: dict) -> str:
    e = lambda value: html.escape(str(value), quote=True)
    labels = {(x['network'], x['asset']): x for x in report['asset_labels']}
    def units(value: str, row: dict) -> str:
        return e(format_units(value, labels.get((row['network'], row['asset']))))
    def summary_cards(groups: list[dict]) -> str:
        cards = []
        for g in groups:
            metrics = ''.join('<div class="metric"><span>' + title + '</span><strong>' + units(g[k], g) + '</strong></div>'
                              for k, title in zip(MONEY, ('Settled actual', 'Outstanding maximum', 'Unused capacity released')))
            cards.append(f'<article class="card"><h3>{e(g["network"])}</h3><p class="contract">{e(g["asset"])}</p>{metrics}<small>{g["requests"]} requests · {g["pending_requests"]} unresolved</small></article>')
        return ''.join(cards) or '<p class="empty">No reservations in this selection. Portfolio exposure above is unchanged.</p>'
    def table_rows(rows: list[dict]) -> str:
        return ''.join('<tr>' + ''.join(f'<td class="{cls}">{value}</td>' for value, cls in (
            (e(r['request_id']), ''), (e(r['day']), ''), (e(r['actor']), ''), (e(r['service']), ''),
            (e(r['network'] + ' / ' + r['asset']), 'contract'), (e(r['state']), ''),
            (units(r[MONEY[0]], r), 'number'), (units(r[MONEY[1]], r), 'number'),
            (units(r[MONEY[2]], r), 'number'), (e(r['age_utc_days']) if r['age_utc_days'] is not None else '—', 'number'))
        ) + '</tr>' for r in rows)
    portfolio = []
    for g in report['portfolio']:
        capacity = (f'{units(g["remaining_total_base_units"], g)} total / {units(g["remaining_today_base_units"], g)} today'
                    if 'policy' in g else 'No policy supplied for this asset')
        if g.get('over_total_base_units', '0') != '0' or g.get('over_today_base_units', '0') != '0':
            capacity += f'<br><strong>Over supplied policy: {units(g["over_total_base_units"],g)} total / {units(g["over_today_base_units"],g)} today</strong>'
        portfolio.append(f'<tr><td>{e(g["network"])}<div class="contract">{e(g["asset"])}</div></td><td class="number">{units(g[MONEY[0]],g)}</td><td class="number">{units(g[MONEY[1]],g)}<br><small>{g["pending_requests"]} unresolved</small></td><td>{capacity}</td></tr>')
    controls = ''.join(f'<label>{e(k.title())}<select id="{k}"><option value="">All {e(k)} values</option></select></label>' for k in ('actor', 'service', 'network', 'asset', 'state'))
    def breakdown(key: str, dimension: str, heading: str, ident: str) -> str:
        body = ''.join('<tr>'+''.join(f'<td>{text}</td>' for text in (e(g[dimension]), e(g['network']+' / '+g['asset']), str(g['requests']), units(g[MONEY[0]],g), units(g[MONEY[1]],g)))+'</tr>' for g in report[key])
        return f'<details><summary>{heading}</summary><div class="scroll"><table><thead><tr><th>{e(dimension)}</th><th>Network / asset</th><th>Requests</th><th>Settled</th><th>Outstanding</th></tr></thead><tbody id="{ident}">{body}</tbody></table></div></details>'
    payload = json.dumps({**report, 'csv_fields': list(CSV_FIELDS)}, ensure_ascii=True, separators=(',', ':'))
    payload = payload.replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e')
    digest = lambda text: base64.b64encode(hashlib.sha256(text.encode()).digest()).decode()
    csp = f"default-src 'none'; script-src 'sha256-{digest(JS)}'; style-src 'sha256-{digest(CSS)}'; connect-src 'none'; base-uri 'none'; form-action 'none'"
    scope = ', '.join(f'{k}={v}' for k, v in report['filters'].items()) or 'All reservations'
    notes = ''.join(f'<li>{e(note)}</li>' for note in report['notes'])
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{e(csp)}"><meta name="referrer" content="no-referrer">
<title>Starforge · Buyer spend statement</title><style>{CSS}</style></head><body>
<header><div class="eyebrow">Starforge / Buyer operations</div><h1>Buyer spend statement</h1><p>Settled amounts, outstanding authorizations and the capacity they consume.</p><span class="tag">Local snapshot · Read-only · No network</span></header>
<main><section class="panel"><h2>Whole-ledger exposure</h2><p class="muted">Captured {e(report['captured_at'])} · {report['source']['reservations']} reservations · {report['source']['journal_events']} journal events.<br>These figures ignore selection filters. Capacity is not purchase approval.</p>
<div class="scroll"><table><thead><tr><th>Network / asset</th><th>Settled actual</th><th>Outstanding maximum</th><th>Remaining policy capacity</th></tr></thead><tbody>{''.join(portfolio) or '<tr><td colspan="4">No reservations or supplied asset policies in this snapshot.</td></tr>'}</tbody></table></div>
<p class="note muted">Network and asset totals remain separate. Testnet units are not real-money revenue. Released capacity is not a refund.</p></section>
<section class="panel"><h2>Explore this statement</h2><p class="muted">Export scope: {e(scope)}. Search below narrows that scope; it cannot recover excluded rows.</p>
<div class="toolbar"><label>Search requests or receipts<input id="search" type="search" placeholder="Request, actor, service or receipt"></label>{controls}<label>Reservation day from<input id="from-day" type="date"></label><label>Reservation day through<input id="through-day" type="date"></label><button id="reset" type="button">Reset filters</button></div>
<p id="count" aria-live="polite" class="muted">{len(report['rows'])} reservations in the exported selection.</p><div id="selected-totals" class="cards">{summary_cards(report['selected_totals'])}</div>
<p class="muted">Days refer to reservation creation, not settlement time. Age is calendar days for unresolved reservations, not permission to release them.</p>
<div class="actions"><button id="csv" type="button">Export selected CSV</button><button id="json" type="button">Export selected JSON</button></div>
<p class="muted">On narrow screens, scroll tables horizontally to see all columns.</p><div class="scroll"><table class="detail-table"><thead><tr><th>Request</th><th>UTC day</th><th>Actor</th><th>Service</th><th>Network / asset</th><th>State</th><th>Settled</th><th>Outstanding</th><th>Released capacity</th><th>Age days</th></tr></thead><tbody id="rows">{table_rows(report['rows'])}</tbody></table></div>
{breakdown('by_actor','actor','Actor breakdown','actors')}{breakdown('by_service','service','Service breakdown','services')}{breakdown('by_reservation_day','day','Reservation-day breakdown','days')}
</section><section class="panel"><h2>Basis and export details</h2><p>{e(report['basis'])}. {e(report['date_basis'])}.</p><p>Source: {e(report['source']['database_name'])} · projection fingerprint <code>{e(report['source']['projection_sha256'])}</code></p><ul>{notes}</ul><p class="muted">Import CSV base-unit columns as text in spreadsheet software to avoid numeric rounding. JSON and this view keep exact integer amounts.</p><noscript><p>The complete exported selection is shown. Interactive filtering and downloads require JavaScript; CLI JSON/CSV remain available.</p></noscript></section></main>
<script id="statement-data" type="application/json">{payload}</script><script>{JS}</script></body></html>\n'''


def write_new(path: str | Path, text: str) -> None:
    """Do not replace the database, symlinks, or a previous private statement."""
    target = Path(path)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    identity = os.fstat(fd)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        # A concurrent replacement in the output directory is not ours to delete.
        try:
            current = target.lstat()
            if (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino):
                target.unlink()
        except FileNotFoundError:
            pass
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', help='existing SF36 SQLite file, including its live WAL')
    parser.add_argument('--output', required=True, help='new private .html/.json/.csv file (never overwritten)')
    parser.add_argument('--format', choices=('html', 'json', 'csv'), help='default: output extension')
    parser.add_argument('--policy', help='existing SF36 policy JSON; show snapshot capacity, not authorization')
    parser.add_argument('--labels', help='optional operator-supplied asset symbols/decimals JSON')
    for key in ('from-day', 'through-day', 'actor', 'service', 'network', 'asset', 'state'):
        parser.add_argument('--' + key)
    args = parser.parse_args(argv)
    try:
        fmt = args.format or Path(args.output).suffix.removeprefix('.').lower()
        if fmt not in ('html', 'json', 'csv'):
            raise StatementError('choose --format html, json or csv, or an equivalent output extension')
        policy = json.loads(Path(args.policy).read_text(encoding='utf-8')) if args.policy else None
        labels = json.loads(Path(args.labels).read_text(encoding='utf-8')) if args.labels else None
        filters = {k: getattr(args, k) for k in ('from_day','through_day','actor','service','network','asset','state') if getattr(args,k) is not None}
        report = build_statement(read_snapshot(args.database), filters=filters, policy=policy, labels=labels)
        result = (render_html(report) if fmt == 'html' else render_csv(report['rows']) if fmt == 'csv'
                  else json.dumps(report, ensure_ascii=True, indent=2) + '\n')
        write_new(args.output, result)
        print(f'Created {fmt} statement: {len(report["rows"])} selected / {report["source"]["reservations"]} total reservations. Ledger unchanged.')
        return 0
    except (OSError, sqlite3.Error, ValueError, TypeError, KeyError, AttributeError) as exc:
        print('Statement not created: ' + str(exc), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

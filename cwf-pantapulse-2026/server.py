#!/usr/bin/env python3
"""PantaPulse: read-only Panta prediction-market evidence, strictly local HTTP UI."""
import hashlib
import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from detail_fetch import enrich_market_list
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.getenv('PORT', '8766'))
BASE = os.getenv('PANTA_API_BASE_URL', '').rstrip('/')
KEY = os.getenv('PANTA_API_KEY', '')
MODE = 'panta-api' if BASE and KEY else 'fixture'
DATA_LOCK = threading.RLock()
DETAIL_LOCK = threading.Lock()
FEED = {'mode': MODE, 'data': [], 'observed_utc': None, 'digest': None, 'alerts': [], 'errors': []}

# Mocked sample markets are NOT Panta records or current quotes.
FIXTURES = [
    {'id': 'F-CLIMATE', 'question': 'SYNTHETIC: Will the demonstration city meet its solar target?',
     'yes_price': '0.68', 'liquidity_usd': '48000', 'volume_usd': '20000', 'status': 'open'},
    {'id': 'F-RELEASE', 'question': 'SYNTHETIC: Will the fictional software ship by Friday?',
     'yes_price': '0.22', 'liquidity_usd': '900', 'volume_usd': '300', 'status': 'open'},
    {'id': 'F-SPORT', 'question': 'SYNTHETIC: Will North City win the demonstration final?',
     'yes_price': '0.51', 'liquidity_usd': '12500', 'volume_usd': '9500', 'status': 'open'},
]

class FeedError(Exception):
    pass

class RedirectDenied(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise FeedError('Provider redirected the authenticated request; redirect refused.')


def get_path(mapping, *keys):
    value = mapping
    for key in keys:
        if not isinstance(value, dict): return None
        value = value.get(key)
    return value


def maybe_decimal(v, minimum=None, maximum=None):
    if v is None or isinstance(v, bool): return None
    if not isinstance(v, (int, str, float)): return None
    try: d = Decimal(str(v))
    except (InvalidOperation, ValueError): return None
    if not d.is_finite() or len(str(d)) > 40 or (minimum is not None and d < minimum) or (maximum is not None and d > maximum): return None
    return d


def market_normalize(raw):
    """Missing price/volume fields are UNKNOWN, never silently invented."""
    if not isinstance(raw, dict): return None
    mid = next((raw.get(k) for k in ('id', 'market_id', 'marketId', 'slug') if isinstance(raw.get(k), (str, int))), None)
    question = next((raw.get(k) for k in ('question', 'title', 'name') if isinstance(raw.get(k), str)), None)
    if not mid or not question: return None
    # Explicitly documented schema alternatives; unknown Panta API versions remain unknown.
    # Explicit sponsor null-list quotes are not malformed observations.
    # Non-null malformed/out-of-range values must remain visible as source cautions.
    candidates = (raw.get('yes_price'), raw.get('yesPrice'), raw.get('primaryYesPrice'),
                  raw.get('yes_probability'), get_path(raw, 'prices', 'yes'),
                  get_path(raw, 'probabilities', 'yes'))
    price = next((v for v in candidates if v is not None), None)
    probability = maybe_decimal(price, Decimal('0'), Decimal('1'))
    price_state = ('verified' if probability is not None else
                   ('malformed' if price is not None else 'unavailable'))
    liq = next((raw.get(k) for k in ('liquidity_usd', 'liquidityUsd', 'liquidity') if raw.get(k) is not None), None)
    vol = next((raw.get(k) for k in ('volume_usd', 'volumeUsd', 'volumeUsdc', 'volume') if raw.get(k) is not None), None)
    liquidity = maybe_decimal(liq, Decimal(0), Decimal('1e12'))
    volume = maybe_decimal(vol, Decimal(0), Decimal('1e12'))
    mid = str(mid)[:120]
    question = question.strip()[:240]
    if not question: return None
    return {'id': mid, 'question': question,
            'yes_probability_pct': str((probability * 100).quantize(Decimal('0.01'))) if probability is not None else None,
            'liquidity_usd': str(liquidity) if liquidity is not None else None,
            'volume_usd': str(volume) if volume is not None else None,
            'status': str(raw.get('status', raw.get('phase', 'unknown')))[:50],
            'price_proven': probability is not None, 'price_state': price_state,
            'quote_source': ('detail' if raw.get('_panta_price_from_detail') and probability is not None
                             else ('list' if probability is not None else 'unverified'))}


def alerts(rows):
    findings = []
    for row in rows:
        if row.get('price_state') == 'malformed':
            findings.append({'market': row['id'], 'severity': 'caution',
                             'signal': 'Provider supplied an invalid or out-of-range YES quote; not price evidence.'})
        p = maybe_decimal(row['yes_probability_pct'], Decimal(0), Decimal(100))
        liq = maybe_decimal(row['liquidity_usd'], Decimal(0))
        # In documented list rows, absent YES price is expected coverage metadata,
        # not a per-market trading signal. The UI labels that state explicitly.
        # Preserve known low liquidity regardless of price availability, but do
        # not create an unavailable-liquidity alert for every unpriced list row.
        if liq is None:
            if row['price_proven']:
                findings.append({'market': row['id'], 'severity': 'unknown', 'signal': 'Liquidity unavailable; no liquidity adequacy claim.'})
        elif liq < Decimal('1000'):
            findings.append({'market': row['id'], 'severity': 'caution', 'signal': 'Reported liquidity under $1,000; price may be fragile.'})
        if p is not None and (p < 5 or p > 95):
            findings.append({'market': row['id'], 'severity': 'caution', 'signal': 'Extreme implied probability; verify resolution terms and spread.'})
    return findings


def market_collection(root):
    """Return a documented market list without inventing or coercing records."""
    if isinstance(root, list):
        return root
    if isinstance(root, dict):
        for key in ('items', 'results', 'markets', 'data'):
            value = root.get(key)
            if isinstance(value, list):
                return value
    return None


def provider_data():
    if not BASE or not KEY: return FIXTURES, ['SYNTHETIC fixture mode; connect first-party Panta API for live markets.']
    url = urllib.parse.urlsplit(BASE)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise FeedError('PANTA_API_BASE_URL must be a clean HTTPS provider API base.')
    # The official playground documents GET /markets/ authenticated with X-Api-Key.
    req = urllib.request.Request(BASE + '/markets/', headers={'X-Api-Key': KEY, 'Accept': 'application/json',
                                                             'User-Agent': 'CartWitness-PantaPulse-research/1.0'})
    try:
        with urllib.request.build_opener(RedirectDenied()).open(req, timeout=9) as resp:
            if resp.status != 200: raise FeedError('Unexpected Panta HTTP response.')
            payload = resp.read(1024 * 1024 + 1)
            if len(payload) > 1024 * 1024: raise FeedError('Panta response exceeds 1 MiB limit.')
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        raise FeedError(f'Panta provider unavailable ({getattr(exc, "code", "connection error")}).') from exc
    try: root = json.loads(payload)
    except ValueError as exc: raise FeedError('Panta provider response was not valid JSON.') from exc
    data = market_collection(root)
    if not isinstance(data, list):
        raise FeedError('Unrecognized Panta market collection schema; API integration unverified.')
    try: top_n = int(os.getenv('PANTA_DETAIL_TOP_N', '10'))
    except ValueError: top_n = 10
    with DETAIL_LOCK:
        return enrich_market_list(data[:100], BASE, KEY, market_normalize, top_n=max(0, min(50, top_n)))


def refresh():
    raw, warnings = provider_data()
    normalized = [m for m in map(market_normalize, raw) if m]
    if not normalized: raise FeedError('No recognizable markets returned; refusing to invent values.')
    stamp = datetime.now(timezone.utc).isoformat(timespec='seconds')
    canonical = json.dumps(normalized, sort_keys=True, separators=(',', ':')).encode()
    result = {'mode': MODE, 'data': normalized, 'observed_utc': stamp,
              'digest': hashlib.sha256(canonical).hexdigest(), 'alerts': alerts(normalized),
              'errors': warnings, 'count_total_seen': len(raw), 'count_displayed': len(normalized),
              'detail_quotes_verified': sum(row.get('quote_source') == 'detail' for row in normalized)}
    with DATA_LOCK:
        FEED.clear(); FEED.update(result)
    return result


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass  # no bearer/API keys or raw provider data in logs
    def output(self, status, value, mime='application/json'):
        buf = value if isinstance(value, bytes) else value.encode()
        self.send_response(status)
        self.send_header('Content-Type', mime + ('; charset=utf-8' if mime.startswith('text/') else ''))
        self.send_header('Content-Length', str(len(buf)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'")
        self.end_headers(); self.wfile.write(buf)
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in {'/', '/app.js', '/style.css'}:
            name = {'/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css'}[path]
            mime = {'/': 'text/html', '/app.js': 'application/javascript', '/style.css': 'text/css'}[path]
            return self.output(200, (ROOT / 'web' / name).read_bytes(), mime)
        if path == '/api/feed':
            try: result = refresh()
            except FeedError as exc:
                return self.output(503, json.dumps({'error': str(exc)}))
            return self.output(200, json.dumps(result))
        if path == '/api/report':
            with DATA_LOCK: data = dict(FEED)
            if not data.get('observed_utc'): return self.output(404, json.dumps({'error': 'Refresh first.'}))
            out = ['# PantaPulse market intelligence', '', f"Mode: {data['mode']}",
                   f"Observed UTC: {data['observed_utc']}", f"SHA256 canonical observation: {data['digest']}",
                   '', '## Market observations']
            for m in data['data']:
                price_text = f"{m['yes_probability_pct']}%" if m['price_proven'] else 'UNVERIFIED (detail not fetched)'
                out.append(f"- **{m['question']}**: YES price {price_text}; reported liquidity ${m['liquidity_usd'] or 'UNKNOWN'}; market ID {m['id']}")
            out += ['', '## Alerts']
            for a in data['alerts']: out.append(f"- {a['market']}: {a['severity']} — {a['signal']}")
            out += ['', 'Source: live Panta API only if `mode=panta-api`; otherwise completely synthetic demo data.',
                    'Not financial advice. Source schema/market resolution must be independently verified.']
            return self.output(200, '\n'.join(out).encode(), 'text/markdown')
        return self.output(404, json.dumps({'error': 'Unknown local endpoint'}))


if __name__ == '__main__':
    print(f'PantaPulse at http://127.0.0.1:{PORT} | provider mode: {MODE}')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
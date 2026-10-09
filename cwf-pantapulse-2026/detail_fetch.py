"""Optional read-only Panta market detail price enrichment.

Source contract: Kaito-HQ/panta-api-playground at main,
src/components/MarketsPanel.tsx (GET /markets/{encoded marketId}/),
src/lib/types.ts (yesPrice, primaryYesPrice) and GET /markets/ list.
No trade, wallet, price projection, or liquidity invention.
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal, InvalidOperation


class DetailRedirectDenied(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ValueError('Authenticated Panta market-detail redirect rejected.')


def valid_yes_price(value):
    """Return a provider-observed [0,1] decimal string, or None."""
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not d.is_finite() or len(str(value)) > 40 or d < 0 or d > 1:
        return None
    return str(d)


def rank_unpriced(raw_items, normalize, limit):
    """Use the EXISTING app normalizer, stable high-volume ordering, no invented rank."""
    eligible = []
    seen_ids = set()
    for index, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            continue
        norm = normalize(raw)
        if not norm or norm.get('price_proven'):
            continue
        market_id = norm['id']
        if market_id in seen_ids:
            continue
        seen_ids.add(market_id)
        volume = norm.get('volume_usd')
        try:
            numeric_volume = Decimal(volume) if volume is not None else None
        except (InvalidOperation, TypeError, ValueError):
            numeric_volume = None
        eligible.append((index, market_id, numeric_volume))
    eligible.sort(key=lambda row: (row[2] is None, -row[2] if row[2] is not None else 0, row[0]))
    return eligible[:limit]


def _retry_after(headers):
    try:
        seconds = float(headers.get('Retry-After', '1'))
    except (TypeError, ValueError, AttributeError):
        seconds = 1.0
    return seconds if 0 <= seconds <= 20 else None


def enrich_market_list(raw_items, base, api_key, normalize, top_n=10, *,
                       opener=None, clock=None, sleep=None):
    """Return (list copy, summarized receipts); never replace original list fields.

    Request pacing 110/min; retry 429 at most twice using server Retry-After.
    A bad/mismatched detail is ignored, not used as verified pricing.
    The first-party detail endpoint returns a direct MarketCatalogItem object.
    """
    updated = list(raw_items)
    limit = max(0, min(50, int(top_n)))
    if not limit or not base or not api_key:
        return updated, []
    picks = rank_unpriced(updated, normalize, limit)
    if not picks:
        return updated, []
    opener = opener or urllib.request.build_opener(DetailRedirectDenied())
    clock = clock or time.monotonic
    sleep = sleep or time.sleep
    pace = 60.0 / 110.0
    last_request = clock()
    reads = 0
    successes = 0
    errors = 0
    skipped = 0
    budget_stop = False

    for index, market_id, _volume in picks:
        # Budget applies across all detail requests including 429 retries.
        value = None
        for attempt in range(3):
            remaining = pace - (clock() - last_request)
            if remaining > 0:
                sleep(remaining)
            last_request = clock()
            route = '/markets/' + urllib.parse.quote(market_id, safe='') + '/'
            req = urllib.request.Request(base + route, headers={
                'X-Api-Key': api_key, 'Accept': 'application/json',
                'User-Agent': 'PantaPulse-read-only/1.1'
            })
            reads += 1
            try:
                with opener.open(req, timeout=9) as response:
                    if response.status != 200:
                        errors += 1
                        break
                    body = response.read(256 * 1024 + 1)
                    if len(body) > 256 * 1024:
                        errors += 1
                        break
                detail = json.loads(body)
                # Sponsor's playground returns a direct MarketCatalogItem.
                if not isinstance(detail, dict) or str(detail.get('marketId', '')) != market_id:
                    errors += 1
                    break
                value = valid_yes_price(detail.get('yesPrice'))
                if value is None:
                    value = valid_yes_price(detail.get('primaryYesPrice'))
                if value is None:
                    skipped += 1
                break
            except urllib.error.HTTPError as exc:
                if exc.code in (401, 403):
                    errors += 1
                    budget_stop = True
                    break
                if exc.code != 429:
                    errors += 1
                    break
                delay = _retry_after(exc.headers)
                if delay is None or attempt == 2:
                    errors += 1
                    budget_stop = True
                    break
                sleep(max(delay, pace))
            except (urllib.error.URLError, ValueError, OSError, TimeoutError):
                errors += 1
                break
        if value is not None:
            patched = dict(updated[index])
            # The original normalizer prioritizes yes_price over yesPrice.
            patched['yes_price'] = value
            patched['yesPrice'] = value
            patched['_panta_price_from_detail'] = True
            updated[index] = patched
            successes += 1
        if budget_stop:
            break

    summary = (f'Panta read-only detail: {successes} verified YES quote(s)'
               f' from {reads} HTTP request(s), {errors} error(s),'
               f' {skipped} detail(s) without a usable YES quote.'
               f' Unknown liquidity remains UNKNOWN.')
    return updated, [summary]

"""MIT. Exact Amberdata page semantics and Decimal research calculations."""
import base64
from datetime import datetime, timezone
from decimal import Decimal, localcontext
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl, quote, urlsplit

PAGE_SCHEMA = 'stellar-forge.amberdata-page.v1'
SUMMARY_SCHEMA = 'stellar-forge.amberdata-ohlcv-summary.v1'
CLOUDSYNC_SCHEMA = 'stellar-forge.amberdata-cloudsync.v1'
ORIGIN = 'https://api.amberdata.com'
CLOUDSYNC_COLUMNS = ('exchange', 'pair', 'exchangeTimestamp', 'exchangeTimestampNanoseconds',
                     'count', 'close', 'high', 'low', 'open', 'volume', 'vwap', 'quoteVolume', 'derived')


class ContractError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ContractError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def sha256(value):
    return hashlib.sha256(value.encode('utf-8') if isinstance(value, str) else value).hexdigest()


def strict_json(body, *, decimals=False):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON object key.')
            result[key] = value
        return result
    def constant(_):
        raise ContractError('Non-finite JSON value.')
    return json.loads(body, parse_float=Decimal if decimals else float,
                      parse_constant=constant, object_pairs_hook=pairs)


def plan_selection(plan):
    fields = {key: plan[key] for key in ['provider', 'window', 'units', 'limits']}
    result = sha256(canonical(fields))
    require(plan.get('selectionSha256') == result, 'The saved selection changed.')
    return result


def timestamp(value):
    require(isinstance(value, str) and value.endswith('Z'), 'An explicit UTC timestamp is required.')
    parsed = datetime.fromisoformat(value[:-1] + '+00:00')
    return int(parsed.timestamp() * 1000)


def iso(milliseconds):
    return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def provider_path(plan, operation):
    require(operation in ['spot_instruments', 'spot_ohlcv'], 'Unknown provider operation.')
    return '/markets/spot/exchanges/information' if operation == 'spot_instruments' else '/markets/spot/ohlcv/' + quote(plan['provider']['instrument'], safe='')


def next_cursor(plan, operation, metadata):
    require(isinstance(metadata, dict), 'Provider metadata must be an object.')
    value = metadata.get('next')
    if value is None or value == '':
        return None
    require(isinstance(value, str) and len(value) <= 8192, 'Unsupported provider continuation.')
    parsed = urlsplit(value)
    require(parsed.scheme == 'https' and parsed.netloc == 'api.amberdata.com' and
            parsed.path == provider_path(plan, operation) and not parsed.fragment,
            'Continuation must use the selected original provider path.')
    query = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    require(len(query) == 1 and query[0][0] == 'cursor' and 0 < len(query[0][1]) <= 4096,
            'Continuation requires one original opaque cursor.')
    return query[0][1]


def page_key(value):
    require(isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdefABCDEF' for c in value),
            'AMBERDATA_PAGE_KEY must contain 32 bytes as hexadecimal.')
    return bytes.fromhex(value)


def b64url(value):
    return base64.urlsafe_b64encode(value).decode('ascii').rstrip('=')


def encode_continuation(plan, operation, cursor, previous_sha, page_index, key):
    payload = {'v': 1, 'selection': plan_selection(plan), 'operation': operation,
               'cursor': cursor, 'previousBodySha256': previous_sha, 'pageIndex': page_index,
               'expires': int(time.time()) + plan['limits']['continuationTtlSeconds']}
    body = canonical(payload).encode('utf-8')
    return b64url(body) + '.' + b64url(hmac.digest(key, body, 'sha256'))


def decode_continuation(plan, operation, value, key):
    require(isinstance(value, str) and len(value) <= 2000 and value.count('.') == 1, 'Invalid continuation token.')
    def decode(text):
        require(text and all(c.isascii() and (c.isalnum() or c in '-_') for c in text), 'Invalid continuation encoding.')
        result = base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))
        require(b64url(result) == text, 'Non-canonical continuation encoding.')
        return result
    encoded, signed = value.split('.')
    body, signature = decode(encoded), decode(signed)
    require(hmac.compare_digest(hmac.digest(key, body, 'sha256'), signature), 'Continuation signature does not match this merchant.')
    payload = strict_json(body)
    require(isinstance(payload, dict) and payload.get('v') == 1 and payload.get('selection') == plan_selection(plan)
            and payload.get('operation') == operation, 'Continuation belongs to a different product or operation.')
    require(type(payload.get('expires')) is int and payload['expires'] > int(time.time()), 'Continuation has expired; review a new initial request.')
    require(type(payload.get('pageIndex')) is int and 1 <= payload['pageIndex'] < plan['limits']['maxPages'], 'The configured page limit has been reached.')
    require(isinstance(payload.get('cursor'), str) and 0 < len(payload['cursor']) <= 4096, 'Invalid original cursor.')
    require(isinstance(payload.get('previousBodySha256'), str) and len(payload['previousBodySha256']) == 64, 'Missing original page identity.')
    return payload


def provider_request(plan, operation, continuation, key):
    selected = plan['provider']
    previous = decode_continuation(plan, operation, continuation, key) if continuation else None
    if previous:
        query = {'cursor': previous['cursor']}
    elif operation == 'spot_instruments':
        query = {'exchange': selected['exchange'], 'instrument': selected['instrument'], 'timeFormat': 'ms', 'includeInactive': 'false'}
    else:
        query = {'exchange': selected['exchange'], **plan['window'], 'timeFormat': 'ms'}
    return {
        'path': provider_path(plan, operation), 'query': query,
        'cursor': previous['cursor'] if previous else None,
        'pageIndex': previous['pageIndex'] if previous else 0,
        'previousBodySha256': previous['previousBodySha256'] if previous else None,
    }


def read_body(plan, operation, body):
    require(isinstance(body, str) and 1 < len(body.encode('utf-8')) <= plan['limits']['maxResponseBytes'], 'Provider body exceeds this product limit.')
    value = strict_json(body, decimals=True)
    require(isinstance(value, dict) and type(value.get('status')) is int and value['status'] == 200,
            'The original provider body is not a successful response.')
    payload = value.get('payload')
    require(isinstance(payload, dict) and isinstance(payload.get('metadata'), dict), 'Missing original provider metadata.')
    metadata = payload['metadata']
    require(metadata.get('api-version') == plan['provider']['apiVersion'], 'The actual provider API version differs from the retained selection.')
    following = next_cursor(plan, operation, metadata)
    rows = payload.get('data')
    if operation == 'spot_ohlcv' or plan['provider']['instrumentsShape'] == 'array':
        require(isinstance(rows, list) and len(rows) <= plan['limits']['maxRows'], 'The selected provider response requires an array within the row limit.')
        for row in rows:
            require(isinstance(row, dict) and row.get('exchange') == plan['provider']['exchange'] and row.get('instrument') == plan['provider']['instrument'],
                    'Provider rows differ from the selected exchange or instrument.')
        if operation == 'spot_instruments':
            for row in rows:
                require(type(row.get('active')) is bool, 'Instrument active status must remain explicit.')
                require(row['active'], 'The selected product excludes inactive instruments.')
                availability = row.get('ohlcv')
                require(isinstance(availability, dict), 'The selected instrument has no original OHLCV availability.')
                require(type(availability.get('startDate')) is int and type(availability.get('endDate')) is int,
                        'Instrument availability requires original millisecond timestamps.')
    else:
        require(isinstance(rows, dict), 'The selected legacy instrument contract requires an object.')
        require(set(rows).issubset({plan['provider']['exchange']}), 'Unexpected exchange in the legacy response.')
        instruments = rows.get(plan['provider']['exchange'], {})
        require(isinstance(instruments, dict) and set(instruments).issubset({plan['provider']['instrument']}), 'Unexpected legacy instrument selection.')
        for availability in instruments.values():
            require(isinstance(availability, dict) and isinstance(availability.get('ohlc'), dict), 'Missing legacy OHLC availability.')
            require(type(availability['ohlc'].get('startDate')) is int and type(availability['ohlc'].get('endDate')) is int,
                    'Legacy availability requires original millisecond timestamps.')
    return rows, metadata, following


def make_page(plan, operation, request, body, key, native):
    body_sha = sha256(body)
    # Retain the successful native upstream bytes even when their interpretation
    # is unavailable. A changed schema or long cursor must not force a second read.
    page = {
        'schema': PAGE_SCHEMA, 'operation': operation, 'selectionSha256': plan_selection(plan),
        'provider': dict(plan['provider']), 'window': dict(plan['window']) if operation == 'spot_ohlcv' else None,
        'units': dict(plan['units']) if operation == 'spot_ohlcv' else None,
        'request': {'cursor': request['cursor'], 'pageIndex': request['pageIndex'], 'previousBodySha256': request['previousBodySha256']},
        'body': body, 'bodySha256': body_sha, 'bodyBytes': len(body.encode('utf-8')),
        'continuation': None, 'nativeUpstream': native, 'interpretation': {'status': 'ready'},
    }
    try:
        rows, _, following = read_body(plan, operation, body)
        if operation == 'spot_ohlcv':
            checked_rows(plan, rows)
        if following:
            at_limit = request['pageIndex'] + 1 >= plan['limits']['maxPages']
            token = encode_continuation(plan, operation, following, body_sha, request['pageIndex'] + 1, key)
            route = '/spot/instruments' if operation == 'spot_instruments' else '/spot/ohlcv'
            url = plan['publicOrigin'] + route + '?continuation=' + quote(token, safe='')
            reason = 'configured_page_limit' if at_limit else 'native_request_url_limit' if len(url) > 2048 else None
            page['continuation'] = {'token': None if reason else token, 'pageLimitReached': at_limit,
                                    **({'unavailableReason': reason} if reason else {})}
    except (ValueError, RecursionError) as error:
        page['interpretation'] = {'status': 'unavailable', 'error': {
            'code': 'AMBERDATA_RESPONSE_CONTRACT', 'message': str(error)[:300]}}
    return page


def number(value, label):
    require(type(value) in (int, Decimal), label + ' must be a JSON number.')
    result = Decimal(value)
    require(result.is_finite() and result >= 0 and result.adjusted() <= 40 and result.as_tuple().exponent >= -40,
            label + ' is outside the supported numeric range.')
    return result


def decimal_string(value):
    if value is None:
        return None
    result = format(value, 'f')
    return result.rstrip('0').rstrip('.') if '.' in result else result


def interval(plan):
    step = {'minutes': 60000, 'hours': 3600000, 'days': 86400000}[plan['window']['timeInterval']]
    offset = plan['units']['dailyBoundaryMinutes'] * 60000 if step == 86400000 else 0
    return step, offset


def checked_rows(plan, rows):
    start, end = timestamp(plan['window']['startDate']), timestamp(plan['window']['endDate'])
    step, offset = interval(plan)
    result = []
    for row in rows:
        stamp = row.get('exchangeTimestamp')
        require(type(stamp) is int and 0 <= stamp <= 9007199254740991, 'Candle timestamp must be an exact millisecond integer.')
        require(start <= stamp < end, 'A candle falls outside the explicit selected window.')
        require((stamp - offset) % step == 0, 'A candle differs from the selected interval or configured exchange boundary.')
        amounts = {key: number(row.get(key), key) for key in ['open', 'high', 'low', 'close', 'volume']}
        require(amounts['low'] <= min(amounts['open'], amounts['close']) <= max(amounts['open'], amounts['close']) <= amounts['high'],
                'Candle OHLC values are inconsistent.')
        result.append((stamp, amounts))
    return result


def summarize_pages(plan, input):
    require(isinstance(input, dict) and set(input) == {'pages'}, 'Summary accepts only the exact supplied page collection.')
    pages = input['pages']
    require(isinstance(pages, list) and 1 <= len(pages) <= plan['limits']['maxPages'], 'Supply a page collection within the selected limit.')
    selected = plan_selection(plan)
    merged, seen_pages, sources = {}, set(), []
    expected_cursor, previous_sha, duplicates = None, None, 0
    for index, page in enumerate(pages):
        require(isinstance(page, dict), 'Each supplied page must be an object.')
        require(page.get('schema', PAGE_SCHEMA) == PAGE_SCHEMA and page.get('operation', 'spot_ohlcv') == 'spot_ohlcv', 'A supplied page belongs to another operation.')
        require(page.get('selectionSha256', selected) == selected, 'A supplied page belongs to a different retained selection.')
        body = page.get('body')
        rows, _, following = read_body(plan, 'spot_ohlcv', body)
        body_sha = sha256(body)
        require(page.get('bodySha256', body_sha) == body_sha, 'A supplied provider body differs from its retained hash.')
        require(body_sha not in seen_pages, 'The same provider page was supplied twice.')
        seen_pages.add(body_sha)
        request = page.get('request', {'cursor': None})
        require(isinstance(request, dict) and request.get('cursor') == expected_cursor, 'The original page continuation chain is incomplete or reordered.')
        require(request.get('pageIndex', index) == index and request.get('previousBodySha256', previous_sha) == previous_sha, 'The prior page identity differs.')
        page_rows = checked_rows(plan, rows)
        for stamp, amounts in page_rows:
            if stamp in merged:
                require(merged[stamp] == amounts, 'Different provider values occupy the same candle.')
                duplicates += 1
            else:
                merged[stamp] = amounts
        require(len(merged) <= plan['limits']['maxRows'], 'The retained window exceeds the selected total row limit.')
        sources.append({'pageIndex': index, 'bodySha256': body_sha, 'bodyBytes': len(body.encode('utf-8')), 'rows': len(rows), 'continuationPresent': following is not None})
        previous_sha, expected_cursor = body_sha, following
        if index + 1 < len(pages):
            require(following is not None, 'A terminal provider page cannot have another continuation page.')
    return summary_result(plan, merged, sources, duplicates, 'rest-pages', len(pages), expected_cursor is None)


def summary_result(plan, merged, sources, duplicates, source_kind, page_count, chain_complete):
    selected = plan_selection(plan)
    timestamps = sorted(merged)
    step, offset = interval(plan)
    start, end = timestamp(plan['window']['startDate']), timestamp(plan['window']['endDate'])
    first_expected = start + ((offset - start) % step)
    expected_count = max(0, (end - first_expected + step - 1) // step)
    # Store compact intervals of absent candles, never invented price/volume rows.
    gaps, candidate = [], first_expected
    for stamp in timestamps:
        if stamp > candidate:
            gaps.append({'startDate': iso(candidate), 'endDate': iso(stamp), 'missingCandles': (stamp - candidate) // step})
        candidate = stamp + step
    if candidate < end:
        missing = (end - candidate + step - 1) // step
        gaps.append({'startDate': iso(candidate), 'endDate': iso(candidate + missing * step), 'missingCandles': missing})
    values = list(merged.values())
    with localcontext() as context:
        context.prec = 100
        volume = sum((values['volume'] for values in merged.values()), Decimal(0))
        price_change = merged[timestamps[-1]]['close'] - merged[timestamps[0]]['open'] if timestamps else None
        price_range = max(value['high'] for value in values) - min(value['low'] for value in values) if values else None
    return {
        'schema': SUMMARY_SCHEMA, 'selectionSha256': selected,
        'sourceKind': source_kind,
        'provider': dict(plan['provider']), 'window': dict(plan['window']), 'units': dict(plan['units']),
        'pageCount': page_count, 'rowCount': len(timestamps), 'duplicateRows': duplicates,
        'expectedCandles': expected_count, 'missingCandles': expected_count - len(timestamps),
        'pageChainComplete': chain_complete, 'intervalCoverageComplete': not gaps,
        'complete': chain_complete is not False and not gaps,
        'firstTimestamp': iso(timestamps[0]) if timestamps else None,
        'lastTimestamp': iso(timestamps[-1]) if timestamps else None,
        'open': decimal_string(merged[timestamps[0]]['open']) if timestamps else None,
        'close': decimal_string(merged[timestamps[-1]]['close']) if timestamps else None,
        'high': decimal_string(max(v['high'] for v in values)) if values else None,
        'low': decimal_string(min(v['low'] for v in values)) if values else None,
        'volume': decimal_string(volume), 'priceChange': decimal_string(price_change),
        'priceRange': decimal_string(price_range), 'priceUnit': plan['units']['quote'],
        'gaps': gaps, 'sources': sources,
        'numericRepresentation': 'binary64-roundtrip-json' if source_kind == 'cloudsync-parquet' else 'provider-json-decimal',
        'interpretation': 'Observed source candles only; decimal values retain the explicitly selected quote and volume units.',
    }


def digest_string(value):
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def read_cloudsync(plan, source):
    require(isinstance(source, dict) and set(source) == {'schema', 'original', 'decoder', 'interval', 'rowsBody', 'rowsSha256'}
            and source['schema'] == CLOUDSYNC_SCHEMA, 'Expected an original CloudSync source input.')
    require(source['interval'] == plan['window']['timeInterval'], 'CloudSync interval differs from this retained selection.')
    original, decoder = source['original'], source['decoder']
    require(isinstance(original, dict) and set(original) == {'url', 'format', 'sha256', 'bytes'}
            and original['format'] == 'parquet' and digest_string(original['sha256'])
            and type(original['bytes']) is int and 8 <= original['bytes'] <= 268435456,
            'Original Parquet identity requires its URL, bytes and SHA-256.')
    require(isinstance(original['url'], str) and len(original['url']) <= 2048, 'Retain the original source URL.')
    url = urlsplit(original['url'])
    require(url.scheme == 'https' and url.hostname and not url.username and not url.password
            and not url.query and not url.fragment, 'Source identity requires a credential-free HTTPS URL.')
    require(isinstance(decoder, dict) and set(decoder) == {'name', 'version', 'numberFormat', 'originalRowsSha256', 'originalRowsBytes'}
            and decoder['numberFormat'] == 'binary64-roundtrip-json' and digest_string(decoder['originalRowsSha256'])
            and type(decoder['originalRowsBytes']) is int and 2 <= decoder['originalRowsBytes'] <= 4194304,
            'Retain the original decoder, number representation and decoded-file identity.')
    for name in ['name', 'version']:
        require(isinstance(decoder[name], str) and 0 < len(decoder[name]) <= 80
                and all(ord(c) >= 32 and ord(c) != 127 for c in decoder[name]), 'Invalid decoder identity.')
    body = source['rowsBody']
    require(isinstance(body, str) and 1 < len(body.encode('utf-8')) <= plan['limits']['maxInputBytes']
            and source['rowsSha256'] == sha256(body), 'CloudSync row bytes differ from their retained digest.')
    rows = strict_json(body, decimals=True)
    require(isinstance(rows, list) and len(rows) <= plan['limits']['maxRows'], 'CloudSync rows exceed this product limit.')
    nulls = {key: 0 for key in CLOUDSYNC_COLUMNS}
    derived = {'true': 0, 'false': 0, 'null': 0}
    for row in rows:
        require(isinstance(row, dict) and set(row) == set(CLOUDSYNC_COLUMNS), 'Retain all 13 original CloudSync columns.')
        require(row['exchange'] == plan['provider']['exchange'] and row['pair'] == plan['provider']['instrument'],
                'CloudSync exchange or pair differs from this retained selection.')
        for key, value in row.items():
            if value is None:
                nulls[key] += 1
        for key in ['exchangeTimestampNanoseconds', 'count']:
            require(row[key] is None or type(row[key]) is int and 0 <= row[key] <= 9223372036854775807,
                    key + ' must retain its original nonnegative integer or null.')
        for key in ['vwap', 'quoteVolume']:
            if row[key] is not None:
                number(row[key], key)
        require(row['derived'] is None or type(row['derived']) is bool, 'Derived status must remain explicit.')
        derived['null' if row['derived'] is None else 'true' if row['derived'] else 'false'] += 1
    checked = checked_rows(plan, rows)
    source_info = {'kind': 'cloudsync-parquet', 'apiVersion': None, 'original': dict(original), 'decoder': dict(decoder),
                   'interval': source['interval'], 'rowsSha256': sha256(body), 'rowsBytes': len(body.encode('utf-8')),
                   'rows': len(rows), 'nullCounts': nulls, 'derivedCounts': derived}
    return checked, source_info


def summarize_cloudsync_source(plan, source):
    rows, retained = read_cloudsync(plan, source)
    merged, duplicates = {}, 0
    for stamp, amounts in rows:
        if stamp in merged:
            require(merged[stamp] == amounts, 'Different CloudSync values occupy the same candle.')
            duplicates += 1
        else:
            merged[stamp] = amounts
    return summary_result(plan, merged, [retained], duplicates, 'cloudsync-parquet', 0, None)


def summarize(plan, input):
    require(isinstance(input, dict), 'Research input must be an object.')
    if set(input) == {'pages'}:
        return summarize_pages(plan, input)
    require(set(input) in ({'cloudsync'}, {'cloudsync', 'compareCloudsync'}),
            'Supply original REST pages or one CloudSync source with optional interval comparisons.')
    result = summarize_cloudsync_source(plan, input['cloudsync'])
    comparisons = input.get('compareCloudsync', [])
    require(isinstance(comparisons, list) and len(comparisons) <= 2, 'At most two other original intervals can be compared.')
    seen, total, result['comparisons'] = {plan['window']['timeInterval']}, result['sources'][0]['rows'], []
    for source in comparisons:
        require(isinstance(source, dict) and source.get('interval') in ['minutes', 'hours', 'days']
                and source['interval'] not in seen, 'Each comparison needs a different original interval.')
        seen.add(source['interval'])
        reference_plan = {**plan, 'window': {**plan['window'], 'timeInterval': source['interval']}}
        reference_plan['selectionSha256'] = sha256(canonical({key: reference_plan[key] for key in ['provider', 'window', 'units', 'limits']}))
        reference = summarize_cloudsync_source(reference_plan, source)
        total += reference['sources'][0]['rows']
        require(total <= plan['limits']['maxRows'], 'The combined original interval rows exceed this product limit.')
        with localcontext() as context:
            context.prec = 100
            differences = {key: decimal_string(Decimal(reference[key]) - Decimal(result[key]))
                           if reference[key] is not None and result[key] is not None else None
                           for key in ['open', 'high', 'low', 'close', 'volume']}
        result['comparisons'].append({**reference, 'differenceFromSelected': differences,
                                      'comparisonDirection': 'This interval minus the selected interval; source totals remain independent.'})
    return result

"""Native MakeInfinite discovery and read-only SQL, with lossless values."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import http.client
import json
import os
from pathlib import Path
import re
import ssl
import stat
import time
from urllib.parse import urlencode, urlsplit
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPSHandler, ProxyHandler, HTTPRedirectHandler

API = 'https://api.makeinfinite.dev'
PROXY = 'https://proxy.api.makeinfinite.dev'
MAX_RESPONSE = 64 * 1024 * 1024
SAFE_HEADERS = {'content-type', 'content-length', 'date', 'retry-after',
                'x-request-id', 'x-correlation-id', 'etag'}


class NativeRetry(ValueError):
    def __init__(self, status, headers):
        super().__init__('Native authentication returned HTTP ' + str(status) + '; resume after Retry-After.')
        self.status, self.headers = status, headers


def _pairs(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError('The native JSON contains a duplicate property: ' + key)
        out[key] = value
    return out


def decode(body):
    return json.loads(body.decode('utf-8-sig') if isinstance(body, bytes) else body,
                      parse_float=Decimal, object_pairs_hook=_pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-finite native JSON number.')))


def scalar(value):
    """CSV text for one native scalar; decimal arithmetic never uses float."""
    if value is None:
        return ''
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, int):
        return str(value)
    if isinstance(value, Decimal) and value.is_finite():
        if len(value.as_tuple().digits) + abs(value.as_tuple().exponent) > 4096:
            raise ValueError('The native number exceeds the supported exact-decimal representation.')
        return format(value, 'f')
    raise ValueError('Choose a native scalar field for the CSV column; nested objects remain in the original response.')


def native_array(body):
    rows = decode(body)
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError('The native endpoint did not return its documented array of row objects.')
    return rows


def identifier(value):
    if not isinstance(value, str) or not value or len(value) > 512 or '\0' in value:
        raise ValueError('A nonempty installed schema, table or column identifier is required.')
    return '`' + value.replace('`', '``') + '`'


def _timestamp(value, *, native=False):
    if not isinstance(value, str):
        raise ValueError('A timestamp value must be an explicit ISO timestamp string.')
    match = re.fullmatch(r'(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?', value)
    if not match or (not native and not match[4]):
        raise ValueError('Use an ISO timestamp with an explicit UTC offset and at most nine fractional digits.')
    if native and not match[4]:
        # A vendor wall-clock cursor keeps its native zone semantics. Operator
        # windows still require explicit offsets and are normalized to UTC.
        datetime.fromisoformat(match[1] + 'T' + match[2])
        return match[1] + ' ' + match[2] + (match[3] or '')
    offset = match[4] or 'Z'
    whole = datetime.fromisoformat(match[1] + 'T' + match[2] + ('+00:00' if offset == 'Z' else offset))
    return whole.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M:%S') + (match[3] or '') + 'Z'


def category(column):
    name = str(column.get('dataType', '')).upper().strip()
    if re.search(r'\b(TINYINT|SMALLINT|INTEGER|INT|BIGINT|DECIMAL|NUMERIC|NUMBER)\b', name):
        return 'number'
    if name.startswith('TIMESTAMP'):
        return 'timestamp'
    if name == 'DATE':
        return 'date'
    if name in ('BOOLEAN', 'BOOL'):
        return 'boolean'
    if any(part in name for part in ('CHAR', 'STRING', 'TEXT')):
        return 'text'
    raise ValueError('The installed type ' + name + ' cannot be used as an exact ordered key/window. Select a native numeric, text, date or timestamp column.')


def literal(value, column, *, native=False):
    kind = category(column)
    if value is None:
        raise ValueError('An ordered key, window or filter comparison cannot use null.')
    if kind == 'number':
        if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
            raise ValueError('Supply exact numeric filter values as decimal strings or integers.')
        try:
            number = Decimal(value)
        except InvalidOperation as error:
            raise ValueError('The numeric filter or key is not a decimal value.') from error
        if not number.is_finite() or len(number.as_tuple().digits) + abs(number.as_tuple().exponent) > 4096:
            raise ValueError('The numeric filter or key exceeds the exact-decimal limit.')
        return format(number, 'f')
    if kind == 'boolean':
        if value is True or value == 'true':
            return 'TRUE'
        if value is False or value == 'false':
            return 'FALSE'
        raise ValueError('A boolean filter must be true or false.')
    if not isinstance(value, str):
        raise ValueError('The installed text/date/timestamp column requires a string value.')
    prefix = ''
    if kind == 'timestamp':
        value, prefix = _timestamp(value, native=native), 'TIMESTAMP '
    elif kind == 'date':
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            raise ValueError('Use YYYY-MM-DD for a native DATE value.')
        datetime.strptime(value, '%Y-%m-%d')
        prefix = 'DATE '
    if '\0' in value or len(value) > 16384:
        raise ValueError('The SQL key or filter text exceeds the supported length.')
    if kind == 'text':
        # Data appears only as hex, independent of the session's quote and
        # backslash modes. Native COUNT also verifies this Spark expression.
        return "decode(X'" + value.encode('utf-8').hex() + "', 'UTF-8')"
    return prefix + "'" + value + "'"


def validate_plan(plan):
    allowed = {'schema', 'table', 'scope', 'columns', 'order_by', 'window', 'filters',
               'page_size', 'max_rows', 'max_capture_bytes', 'label'}
    if not isinstance(plan, dict) or set(plan) - allowed:
        raise ValueError('Use only the documented public capture plan fields; credentials belong in the private credential file.')
    for key in ('schema', 'table'):
        identifier(plan.get(key))
    out = json.loads(json.dumps(plan))
    out.setdefault('scope', 'PUBLIC')
    if out['scope'] not in ('PUBLIC', 'SUBSCRIPTION'):
        raise ValueError('Native scope must be PUBLIC or SUBSCRIPTION.')
    for field in ('columns', 'order_by'):
        items = out.get(field, [])
        if not isinstance(items, list) or len(items) > 256 or any(not isinstance(item, str) for item in items) or len(set(items)) != len(items):
            raise ValueError(field + ' must be a unique array of installed column names.')
        for item in items:
            identifier(item)
    if not out.get('columns'):
        raise ValueError('Select the actual native columns to retain in this acquisition.')
    if not isinstance(out.get('window'), dict) or set(out['window']) != {'column', 'from', 'through'}:
        raise ValueError('Declare an exact window with column, inclusive from and exclusive through.')
    identifier(out['window']['column'])
    filters = out.setdefault('filters', [])
    if not isinstance(filters, list) or len(filters) > 100:
        raise ValueError('filters must be an array of at most 100 explicit native column comparisons.')
    for item in filters:
        if not isinstance(item, dict) or set(item) != {'column', 'operator', 'value'}:
            raise ValueError('Each native filter needs column, operator and value.')
        identifier(item['column'])
        if item['operator'] not in ('eq', 'ne', 'gt', 'ge', 'lt', 'le', 'in'):
            raise ValueError('Unsupported native filter operator.')
        if item['operator'] == 'in' and (not isinstance(item['value'], list) or not 1 <= len(item['value']) <= 100):
            raise ValueError('An in filter needs 1–100 explicit values.')
    for name, default, maximum in [('page_size', 1000, 100000), ('max_rows', 1000000, 100000000),
                                  ('max_capture_bytes', 1024 ** 3, 64 * 1024 ** 3)]:
        out.setdefault(name, default)
        if isinstance(out[name], bool) or not isinstance(out[name], int) or not 1 <= out[name] <= maximum:
            raise ValueError(name + ' must be a positive integer within its documented capacity.')
    return out


def _selected(items, field, value):
    exact = [item for item in items if item.get(field) == value]
    if not exact:
        exact = [item for item in items if isinstance(item.get(field), str) and item[field].casefold() == value.casefold()]
    if len(exact) != 1:
        raise ValueError('Select one exact installed ' + field + ': ' + value)
    return exact[0]


def resolve(plan, metadata):
    schema = _selected(metadata['schemas'], 'schema', plan['schema'])['schema']
    table_item = _selected(metadata['tables'], 'table', plan['table'])
    if table_item.get('schema', schema).casefold() != schema.casefold():
        raise ValueError('The native table metadata belongs to another schema.')
    table = table_item['table']
    columns = metadata['columns']
    if any(item.get('schema', schema).casefold() != schema.casefold() or item.get('table', table).casefold() != table.casefold() for item in columns):
        raise ValueError('The native column metadata belongs to another selected table.')
    by_name = {item['column']: item for item in columns}
    if len(by_name) != len(columns):
        raise ValueError('The native column discovery returned duplicate identifiers.')
    find = lambda value: _selected(columns, 'column', value)['column']
    keys = sorted([item for item in metadata['primary_keys'] if isinstance(item.get('primaryKeySequence'), int)
                   and item['primaryKeySequence'] > 0], key=lambda item: item['primaryKeySequence'])
    primary = [find(item['column']) for item in keys]
    if not primary:
        raise ValueError('This table has no discovered primary key. Use an agreed keyed native table or view before keyset acquisition.')
    order = [find(value) for value in plan.get('order_by', [])] or primary
    if not set(primary).issubset(order):
        raise ValueError('The ordered selection must contain the complete discovered primary key.')
    window = {**plan['window'], 'column': find(plan['window']['column'])}
    selected = list(dict.fromkeys([find(value) for value in plan['columns']] + order + [window['column']]))
    filters = [{**item, 'column': find(item['column'])} for item in plan['filters']]
    out = {'schema': schema, 'table': table, 'columns': selected, 'order_by': order,
           'window': window, 'filters': filters, 'types': by_name, 'table_metadata': table_item}
    for key in order:
        category(by_name[key])
    # Validate every native literal before the first business query.
    predicate(out)
    window_type = category(by_name[window['column']])
    lower, upper = window['from'], window['through']
    if window_type == 'number':
        valid = Decimal(str(lower)) < Decimal(str(upper))
    elif window_type == 'timestamp':
        def timestamp_key(value):
            whole, dot, fraction = _timestamp(value).removesuffix('Z').partition('.')
            return whole, (fraction if dot else '').ljust(9, '0')
        valid = timestamp_key(lower) < timestamp_key(upper)
    else:
        valid = str(lower) < str(upper)
    if not valid:
        raise ValueError('The inclusive native window start must precede its exclusive end.')
    return out


def predicate(resolved):
    window, types = resolved['window'], resolved['types']
    column = identifier(window['column'])
    terms = [column + ' >= ' + literal(window['from'], types[window['column']]),
             column + ' < ' + literal(window['through'], types[window['column']])]
    operators = {'eq': '=', 'ne': '<>', 'gt': '>', 'ge': '>=', 'lt': '<', 'le': '<='}
    for item in resolved['filters']:
        name, op, value = item['column'], item['operator'], item['value']
        if op == 'in':
            terms.append(identifier(name) + ' IN (' + ', '.join(literal(v, types[name]) for v in value) + ')')
        else:
            terms.append(identifier(name) + ' ' + operators[op] + ' ' + literal(value, types[name]))
    return ' AND '.join('(' + term + ')' for term in terms)


def query(resolved, *, count=False, after=None, limit=1000):
    table = identifier(resolved['schema']) + '.' + identifier(resolved['table'])
    where = predicate(resolved)
    if count:
        return 'SELECT COUNT(*) AS `__tjl_count`, ' + encoding_expression() + ' AS `__tjl_encoding` FROM ' + table + ' WHERE ' + where
    if after is not None:
        if len(after) != len(resolved['order_by']):
            raise ValueError('The retained native key cursor has the wrong width.')
        keys, terms = resolved['order_by'], []
        for index, key in enumerate(keys):
            equal = [identifier(keys[i]) + ' = ' + literal(after[i], resolved['types'][keys[i]], native=True) for i in range(index)]
            greater = identifier(key) + ' > ' + literal(after[index], resolved['types'][key], native=True)
            terms.append('(' + ' AND '.join(equal + [greater]) + ')')
        where += ' AND (' + ' OR '.join(terms) + ')'
    selected = ', '.join(identifier(name) + ' AS ' + identifier(name) for name in resolved['columns'])
    order = ', '.join(identifier(name) + ' ASC' for name in resolved['order_by'])
    return 'SELECT ' + selected + ' FROM ' + table + ' WHERE ' + where + ' ORDER BY ' + order + ' LIMIT ' + str(limit)


def key_values(row, resolved):
    values = []
    for name in resolved['order_by']:
        if name not in row or row[name] is None:
            raise ValueError('A native result omitted a discovered ordered key: ' + name)
        value = row[name]
        literal(value, resolved['types'][name], native=True)
        values.append(scalar(value))
    return values


ENCODING_PROBE = "native quote ' / backslash \\ / café"


def encoding_expression():
    return "decode(X'" + ENCODING_PROBE.encode('utf-8').hex() + "', 'UTF-8')"


def observed_count(rows):
    if len(rows) != 1 or set(rows[0]) != {'__tjl_count', '__tjl_encoding'}:
        raise ValueError('The native COUNT query did not return its count and encoding observations.')
    if rows[0]['__tjl_encoding'] != ENCODING_PROBE:
        raise ValueError('The installed native SQL engine did not preserve the exact UTF-8 key expression. Its response is retained before any keyset rows are acquired.')
    value = rows[0]['__tjl_count']
    if isinstance(value, bool):
        raise ValueError('The native COUNT observation is not an integer.')
    try:
        exact = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError('The native COUNT observation is not numeric.') from error
    if not exact.is_finite() or exact != exact.to_integral_value() or exact < 0:
        raise ValueError('The native COUNT observation is not a nonnegative integer.')
    return int(exact)


def credentials(path):
    file = Path(path).expanduser()
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid() or info.st_size > 65536:
            raise ValueError('Use an owned private 0600 credential JSON file.')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = json.loads(stream.read())
    finally:
        os.close(fd)
    if not isinstance(data, dict) or set(data) - {'api_key', 'access_token', 'access_token_expires', 'biscuits'}:
        raise ValueError('Credential fields are api_key or access_token, optional access_token_expires (milliseconds), and optional biscuits.')
    if not data.get('api_key') and not data.get('access_token'):
        raise ValueError('Install the existing customer account API key or access token.')
    for key in ('api_key', 'access_token'):
        if key in data and (not isinstance(data[key], str) or not data[key] or '\n' in data[key] or '\r' in data[key]):
            raise ValueError('The installed credential value is malformed.')
    if 'biscuits' in data and (not isinstance(data['biscuits'], list) or any(not isinstance(v, str) or not v for v in data['biscuits'])):
        raise ValueError('biscuits must be an array of existing authorization strings.')
    return data


def transport(request):
    url = urlsplit(request['url'])
    if url.scheme != 'https' or url.netloc not in ('api.makeinfinite.dev', 'proxy.api.makeinfinite.dev') or url.fragment:
        raise ValueError('The native request must use its original MakeInfinite HTTPS API origin.')
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    ca_file = os.environ.get('SSL_CERT_FILE') or os.environ.get('REQUESTS_CA_BUNDLE')
    context = ssl.create_default_context(cafile=ca_file)
    opener = build_opener(ProxyHandler(), HTTPSHandler(context=context), NoRedirect())
    query = Request(request['url'], data=request.get('body'), headers=request['headers'], method=request['method'])
    try:
        try:
            response = opener.open(query, timeout=45)
        except HTTPError as error:
            response = error
        with response:
            body = response.read(MAX_RESPONSE + 1)
            if len(body) > MAX_RESPONSE:
                raise ValueError('The complete native response exceeds 64 MiB. Reduce the selected page size and start a fresh capture; no rows were truncated.')
            return {'status': response.code, 'headers': {key.lower(): value for key, value in response.headers.items()}, 'body': body}
    except http.client.HTTPException as error:
        raise ValueError('The native HTTPS response was incomplete. Resume the retained read operation to acquire that response again.') from error
    except URLError as error:
        raise ValueError('The native HTTPS read could not complete through the configured network route. Resume the same capture after that connection is available.') from error


class Client:
    def __init__(self, secret, send=transport):
        self.secret, self.send = dict(secret), send

    def bearer(self):
        expires = self.secret.get('access_token_expires')
        if self.secret.get('access_token') and (expires is None or float(expires) > time.time() * 1000 + 60000):
            return self.secret['access_token']
        if not self.secret.get('api_key'):
            raise ValueError('Refresh the existing account access token in its private credential file, then resume.')
        response = self.send({'method': 'POST', 'url': PROXY + '/auth/apikey',
                              'headers': {'Accept': 'application/json', 'apikey': self.secret['api_key']}, 'body': None})
        if response['status'] == 429 or response['status'] >= 500:
            raise NativeRetry(response['status'], response['headers'])
        if response['status'] != 200:
            raise ValueError('Native API-key authentication returned HTTP ' + str(response['status']) + '. Check the existing account credential and resume.')
        value = decode(response['body'])
        if not isinstance(value, dict) or not isinstance(value.get('accessToken'), str) or not value['accessToken']:
            raise ValueError('The native authentication response did not contain an access token.')
        self.secret['access_token'] = value['accessToken']
        self.secret['access_token_expires'] = value.get('accessTokenExpires')
        return self.secret['access_token']

    def discovery(self, resource, parameters):
        if resource not in ('schema', 'table', 'table/column', 'table/primarykey'):
            raise ValueError('Unknown native discovery resource.')
        return {'method': 'GET', 'url': API + '/v2/discover/' + resource + '?' + urlencode({**parameters, 'sourceNetwork': 'MANAGED'}),
                'headers': {'Accept': 'application/json', 'Authorization': 'Bearer ' + self.bearer()}, 'body': None}

    def sql(self, text):
        if not text.startswith('SELECT '):
            raise ValueError('This acquisition client only constructs SELECT queries.')
        body = {'sqlText': text}
        if self.secret.get('biscuits'):
            body['biscuits'] = self.secret['biscuits']
        headers = {'Accept': 'application/json', 'Content-Type': 'application/json', 'originApp': 'commons-ledger-acquisition'}
        if self.secret.get('api_key'):
            headers['apikey'] = self.secret['api_key']
            url = PROXY + '/v1/sql'
        else:
            headers['Authorization'] = 'Bearer ' + self.bearer()
            body['sourceNetwork'] = 'MANAGED'
            url = API + '/v1/sql'
        return {'method': 'POST', 'url': url, 'headers': headers,
                'body': json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()}


def public_request(request):
    """Retain exact query semantics while credential material stays private."""
    body = json.loads(request['body']) if request.get('body') else None
    authorization_fields = []
    if body and 'biscuits' in body:
        authorization_fields.append('biscuits')
        del body['biscuits']
    return {'method': request['method'], 'url': request['url'], 'body': body,
            'headers': {key: value for key, value in request['headers'].items()
                        if key.lower() in ('accept', 'content-type', 'originapp')},
            'authorization_fields_omitted': authorization_fields}

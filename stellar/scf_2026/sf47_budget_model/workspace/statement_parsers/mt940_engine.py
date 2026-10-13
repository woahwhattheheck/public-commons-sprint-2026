"""Strict MT940 text intake and supplied-file controls; Python standard library.

The profile is deliberately narrower than universal Swift/bank compatibility.
All money is exported as integer strings. The supplied set is not authenticated.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
import hashlib
import json
import re
import unicodedata
from typing import Any

VERSION = 'mt940-retained-intake/1'
MAX_SOURCE = 8 * 1024 * 1024
MAX_TOTAL = 16 * 1024 * 1024
MAX_PAGES = 2000
MAX_ENTRIES = 50000
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\Z')
SHA = re.compile(r'[0-9a-f]{64}\Z')
TAG = re.compile(r':([0-9]{2}[A-Z]?):(.*)\Z')
BAL = re.compile(r'([CD])([0-9]{6})([A-Z]{3})([0-9]+,[0-9]*)\Z')
TX = re.compile(r'([0-9]{6})([0-9]{4})?(RC|RD|C|D)([A-Z])?'
                r'([0-9]+,[0-9]*)([NSF][A-Z0-9]{3})(.*)\Z')
LIMITATIONS = [
    'Historical supplied-file arithmetic and identity review only.',
    'Matching hashes do not authenticate the bank, source completeness or payments.',
    'No ledger posting, payment, live balance, regulatory or accounting authority.',
    'Entry MMDD has no inferred year; value dates use the explicit 100-year window.',
    'Narratives and supplementary details are opaque; no invoice or FX inference.',
    'Even a complete multipart set does not prove complete account history.',
]


class IntakeError(ValueError):
    """Fixed diagnostic code and optional source-relative line, never source text."""
    def __init__(self, code: str, line: int | None = None):
        self.code, self.line = code, line
        super().__init__(code + (f' at line {line}' if line is not None else ''))


def require(condition: bool, code: str, line: int | None = None) -> None:
    if not condition:
        raise IntakeError(code, line)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=True, sort_keys=True,
                       separators=(',', ':'), allow_nan=False) + '\n').encode('ascii')


def _pairs(pairs: list[tuple[str, Any]]) -> dict:
    result: dict = {}
    for key, value in pairs:
        require(key not in result, 'DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def _number_refused(_: str) -> None:
    raise IntakeError('NONINTEGER_JSON_NUMBER')


def load_json(raw: bytes, maximum: int = 1024 * 1024) -> Any:
    require(type(raw) is bytes and 0 < len(raw) <= maximum, 'JSON_SIZE')
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=_pairs,
                          parse_float=_number_refused, parse_constant=_number_refused)
    except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as exc:
        if isinstance(exc, IntakeError):
            raise
        raise IntakeError('INVALID_JSON') from None


def fields(obj: Any, keys: set[str], code: str) -> None:
    require(type(obj) is dict and set(obj) == keys, code)


def validate_plan(plan: Any) -> dict:
    fields(plan, {'schema', 'institution_scope', 'year_window_start', 'currency_scales',
                  'complete_export_set', 'sources'}, 'PLAN_FIELDS')
    require(type(plan['schema']) is str and
            plan['schema'] in {'mt940-intake-plan/1', 'mt940-intake-plan/2'},
            'PLAN_SCHEMA')
    explicit_profiles = plan['schema'] == 'mt940-intake-plan/2'
    require(type(plan['institution_scope']) is str and
            ID.fullmatch(plan['institution_scope']) is not None, 'INSTITUTION_SCOPE')
    year = plan['year_window_start']
    require(type(year) is int and 1900 <= year <= 2000, 'YEAR_WINDOW')
    require(type(plan['complete_export_set']) is bool, 'COMPLETENESS_TYPE')
    scales = plan['currency_scales']
    require(type(scales) is dict and 1 <= len(scales) <= 32, 'CURRENCY_SCALES')
    for currency, scale in scales.items():
        require(type(currency) is str and re.fullmatch('[A-Z]{3}', currency) is not None,
                'CURRENCY_CODE')
        require(type(scale) is int and 0 <= scale <= 6, 'CURRENCY_SCALE')
    rows = plan['sources']
    require(type(rows) is list and 1 <= len(rows) <= 32, 'SOURCE_COUNT')
    seen: set[str] = set()
    for row in rows:
        source_fields = {'id', 'file', 'sha256', 'bytes', 'profile'}
        if explicit_profiles:
            source_fields |= {'encoding', 'debit_credit_profile'}
        fields(row, source_fields, 'SOURCE_FIELDS')
        require(type(row['id']) is str and ID.fullmatch(row['id']) is not None,
                'SOURCE_ID')
        require(row['id'] not in seen, 'DUPLICATE_SOURCE_ID')
        seen.add(row['id'])
        require(type(row['file']) is str and ID.fullmatch(row['file']) is not None
                and row['file'] not in {'.', '..'}, 'SOURCE_FILENAME')
        require(type(row['sha256']) is str and SHA.fullmatch(row['sha256']) is not None,
                'SOURCE_DIGEST')
        require(type(row['bytes']) is int and 0 < row['bytes'] <= MAX_SOURCE,
                'SOURCE_SIZE')
        require(type(row['profile']) is str and row['profile'] in {'TEXT_BODY', 'FIN_ENVELOPE'},
                'SOURCE_PROFILE')
        if explicit_profiles:
            require(type(row['encoding']) is str and
                    row['encoding'] in {'ASCII', 'UTF-8', 'ISO-8859-1'},
                    'SOURCE_ENCODING')
            require(type(row['debit_credit_profile']) is str and
                    row['debit_credit_profile'] in {'CD_ONLY', 'CD_REVERSALS'},
                    'DEBIT_CREDIT_PROFILE')
    require(sum(row['bytes'] for row in rows) <= MAX_TOTAL, 'TOTAL_SIZE')
    return {**plan, 'currency_scales': dict(sorted(scales.items())),
            'sources': [dict(row) for row in sorted(rows, key=lambda x: x['id'])]}


def yy_date(raw: str, start: int, line: int) -> str:
    require(re.fullmatch('[0-9]{6}', raw) is not None, 'DATE_SHAPE', line)
    year = start + ((int(raw[:2]) - start % 100) % 100)
    try:
        return date(year, int(raw[2:4]), int(raw[4:6])).isoformat()
    except ValueError:
        raise IntakeError('INVALID_DATE', line) from None


def minor(raw: str, scale: int, line: int) -> int:
    require(re.fullmatch('[0-9]+,[0-9]*', raw) is not None and len(raw) <= 15,
            'AMOUNT_SHAPE', line)
    whole, fraction = raw.split(',')
    require(len(fraction) <= scale, 'AMOUNT_SCALE', line)
    # A present comma with no fractional digits is legitimate (including JPY).
    return int(whole) * 10 ** scale + int((fraction + '0' * scale)[:scale] or '0')


def _text(raw: bytes, encoding: str = 'ASCII') -> str:
    require(type(raw) is bytes and 0 < len(raw) <= MAX_SOURCE, 'SOURCE_SIZE')
    # A selected decoder is part of the retained plan, never a fallback guess.
    if encoding == 'ASCII':
        require(all(b in (10, 13) or 32 <= b <= 126 for b in raw), 'ASCII_PROFILE')
        text = raw.decode('ascii')
    else:
        require(type(encoding) is str and encoding in {'UTF-8', 'ISO-8859-1'},
                'SOURCE_ENCODING')
        codec = 'utf-8' if encoding == 'UTF-8' else 'iso-8859-1'
        try:
            text = raw.decode(codec, 'strict')
        except UnicodeError:
            raise IntakeError('SOURCE_DECODE') from None
        # Check before any splitlines call: Unicode line separators and control
        # characters must not fabricate physical records or change provenance.
        # Format characters include BOMs and bidi embedding/override controls.
        require(all(char in '\r\n' or unicodedata.category(char) not in
                    {'Cc', 'Cf', 'Cs', 'Zl', 'Zp'} for char in text),
                'TEXT_CHARACTER')
    require('\r' not in text.replace('\r\n', ''), 'BARE_CR')
    text = text.replace('\r\n', '\n')
    require(all(len(line) <= 512 for line in text.split('\n')), 'PHYSICAL_LINE_SIZE')
    return text


def _block(text: str, pos: int, expected: str) -> tuple[str, int]:
    require(text.startswith('{' + expected + ':', pos), 'FIN_BLOCK_ORDER')
    begin = pos
    depth = 0
    while pos < len(text) and pos - begin <= 4096:
        char = text[pos]
        # Transport fingerprints keep their existing ASCII byte interpretation.
        # Unicode is admitted in supported body text fields, not FIN metadata.
        require(ord(char) < 128, 'FIN_METADATA_ASCII')
        if char == '{':
            depth += 1
            require(depth <= 3, 'FIN_BLOCK_DEPTH')
        elif char == '}':
            depth -= 1
            if depth == 0:
                return text[begin:pos + 1], pos + 1
        require(char != '\n', 'FIN_HEADER_NEWLINE')
        pos += 1
    raise IntakeError('FIN_BLOCK_UNTERMINATED')


def _bodies(text: str, profile: str) -> list[tuple[str, int, dict]]:
    """Return body, original starting line, and transport integrity metadata."""
    if profile == 'TEXT_BODY':
        require('{' not in text and '}' not in text, 'BODY_ENVELOPE_NOT_SELECTED')
        return [(text, 1, {'kind': 'TEXT_BODY'})]
    bodies = []
    pos = 0
    line_cursor = 1
    counted_to = 0
    while pos < len(text):
        while pos < len(text) and text[pos] == '\n':
            pos += 1
        if pos == len(text):
            break
        if bodies and text[pos] == '$':
            pos += 1
            while pos < len(text) and text[pos] == '\n':
                pos += 1
            require(pos < len(text), 'FIN_TRAILING_SEPARATOR')
        heading_start = pos
        b1, pos = _block(text, pos, '1')
        require(re.fullmatch(r'\{1:F01[A-Z0-9]{12}[0-9]{10}\}', b1) is not None,
                'FIN_BASIC_HEADER_PROFILE')
        b2, pos = _block(text, pos, '2')
        # Header transport metadata is not a network validation/certification.
        require(re.fullmatch(r'\{2:[IO]940[A-Z0-9]{13,60}\}', b2) is not None,
                'FIN_NOT_MT940_OR_HEADER_PROFILE')
        if text.startswith('{3:', pos):
            _, pos = _block(text, pos, '3')
        require(text.startswith('{4:\n', pos), 'FIN_TEXT_BLOCK')
        header = text[heading_start:pos + 4]
        pos += 4
        start = pos
        end = text.find('\n-}', start)
        require(end >= 0, 'FIN_TEXT_UNTERMINATED')
        body = text[start:end] + '\n'
        require('{' not in body and '}' not in body, 'FIN_BODY_BRACES')
        pos = end + 3
        trailer = ''
        if text.startswith('{5:', pos):
            trailer, pos = _block(text, pos, '5')
        line_cursor += text.count('\n', counted_to, start)
        counted_to = start
        bodies.append((body, line_cursor,
                       {'kind': profile, 'header_sha256': digest(header.encode()),
                        'trailer_sha256': digest(trailer.encode()),
                        'transport_authenticated': False}))
        require(len(bodies) <= MAX_PAGES, 'PAGE_LIMIT')
    require(bool(bodies), 'NO_MESSAGES')
    return bodies


def _records(body: str, first: int) -> list[list[dict]]:
    pages: list[list[dict]] = []
    current: list[dict] = []
    closed = False
    record_count = 0
    lines = body.splitlines()
    for offset, line in enumerate(lines):
        number = first + offset
        if line == '':
            # Blank lines are permitted only between complete message bodies.
            require(not current or closed, 'BLANK_IN_MESSAGE', number)
            continue
        if line == '$':
            require(bool(current) and current[-1]['tag'] in {'62F', '62M', '64', '65', '86'},
                    'BODY_SEPARATOR', number)
            pages.append(current)
            current = []
            closed = False
            continue
        m = TAG.fullmatch(line)
        if m:
            tag, value = m.groups()
            if tag == '20' and current:
                pages.append(current)
                current = []
                closed = False
            if not current:
                require(tag == '20', 'MESSAGE_MUST_START_20', number)
            current.append({'tag': tag, 'lines': [value], 'line': number})
            closed = closed or tag in {'62F', '62M'}
            record_count += 1
            require(record_count <= 2 * MAX_ENTRIES + 16 * MAX_PAGES, 'RECORD_LIMIT')
        else:
            require(not line.startswith(':'), 'UNKNOWN_OR_MALFORMED_TAG', number)
            require(bool(current) and current[-1]['tag'] in {'61', '86'},
                    'UNATTACHED_CONTINUATION', number)
            current[-1]['lines'].append(line)
        require(len(pages) <= MAX_PAGES, 'PAGE_LIMIT')
    if current:
        pages.append(current)
    require(bool(pages), 'NO_MESSAGES')
    return pages


def _single(record: dict, maximum: int) -> str:
    require(len(record['lines']) == 1 and 1 <= len(record['lines'][0]) <= maximum,
            'FIELD_LENGTH_OR_CONTINUATION', record['line'])
    return record['lines'][0]


def _balance(record: dict, plan: dict) -> dict:
    raw = _single(record, 25)
    m = BAL.fullmatch(raw)
    require(m is not None, 'BALANCE_SHAPE', record['line'])
    mark, day, currency, amount = m.groups()
    require(currency in plan['currency_scales'], 'UNDECLARED_CURRENCY', record['line'])
    n = minor(amount, plan['currency_scales'][currency], record['line'])
    return {'tag': record['tag'], 'mark': mark,
            'date': yy_date(day, plan['year_window_start'], record['line']),
            'currency': currency, 'minor': str(n if mark == 'C' else -n),
            'raw_amount': amount}


def _narrative(record: dict) -> list[str]:
    require(1 <= len(record['lines']) <= 6 and
            all(len(x) <= 65 for x in record['lines']), 'NARRATIVE_SIZE', record['line'])
    return record['lines'][:]


def _transaction(record: dict, currency: str, plan: dict,
                 debit_credit_profile: str = 'CD_ONLY') -> dict:
    values = record['lines']
    require(1 <= len(values) <= 2 and (len(values) == 1 or len(values[1]) <= 34),
            'TRANSACTION_SUPPLEMENT_SIZE', record['line'])
    m = TX.fullmatch(values[0])
    require(m is not None, 'TRANSACTION_SHAPE', record['line'])
    value_day, entry_mmdd, mark, funds, amount, code, rest = m.groups()
    # This documented v1 bank profile refuses funds-code currency ambiguity.
    require(funds is None, 'FUNDS_CODE_UNSUPPORTED', record['line'])
    # C/D remains the default v1 contract. Reversals require an explicit v2
    # source profile: RD reverses a debit (credit), RC reverses a credit (debit).
    require(mark in {'C', 'D'} or debit_credit_profile == 'CD_REVERSALS',
            'REVERSAL_MARK_UNSUPPORTED', record['line'])
    if entry_mmdd is not None:
        try:
            date(2000, int(entry_mmdd[:2]), int(entry_mmdd[2:]))
        except ValueError:
            raise IntakeError('ENTRY_MMDD_INVALID', record['line']) from None
    refs = rest.split('//')
    require(1 <= len(refs) <= 2 and all(1 <= len(x) <= 16 and x.strip() == x and bool(x.strip()) for x in refs),
            'REFERENCE_SHAPE', record['line'])
    n = minor(amount, plan['currency_scales'][currency], record['line'])
    return {'value_date': yy_date(value_day, plan['year_window_start'], record['line']),
            'entry_mmdd': entry_mmdd, 'entry_year_inferred': False, 'mark': mark,
            'amount_minor': str(n if mark in {'C', 'RD'} else -n), 'raw_amount': amount,
            'transaction_code': code, 'owner_reference': refs[0],
            'bank_reference': refs[1] if len(refs) == 2 else None,
            'supplementary': values[1] if len(values) == 2 else None,
            'narrative_lines': [], 'source_line': record['line']}


def parse_page(records: list[dict], plan: dict, source: dict, transport: dict) -> dict:
    index = 0
    def take(tag: str, maximum: int) -> str:
        nonlocal index
        require(index < len(records) and records[index]['tag'] == tag, 'TAG_ORDER')
        value = _single(records[index], maximum)
        index += 1
        return value
    reference = take('20', 16)
    require(reference.strip() == reference and bool(reference), 'MESSAGE_REFERENCE_BLANK_OR_PADDED')
    related = None
    if index < len(records) and records[index]['tag'] == '21':
        related = take('21', 16)
    account = take('25', 35)
    require(account.strip() == account and bool(account), 'ACCOUNT_BLANK_OR_PADDED')
    serial = take('28C', 11)
    match = re.fullmatch(r'([0-9]{1,5})(?:/([0-9]{1,5}))?', serial)
    require(match is not None, 'STATEMENT_NUMBER')
    number, sequence = match.groups()
    require(int(number) >= 1 and (sequence is None or int(sequence) >= 1),
            'STATEMENT_NUMBER_ZERO')
    require(index < len(records) and records[index]['tag'] in {'60F', '60M'},
            'OPENING_BALANCE_REQUIRED')
    opening = _balance(records[index], plan)
    index += 1
    transactions: list[dict] = []
    while index < len(records) and records[index]['tag'] == '61':
        tx = _transaction(records[index], opening['currency'], plan,
                          source.get('debit_credit_profile', 'CD_ONLY'))
        index += 1
        if index < len(records) and records[index]['tag'] == '86':
            tx['narrative_lines'] = _narrative(records[index])
            index += 1
        tx['ordinal'] = len(transactions) + 1
        transactions.append(tx)
        require(len(transactions) <= MAX_ENTRIES, 'ENTRY_LIMIT')
    require(index < len(records) and records[index]['tag'] in {'62F', '62M'},
            'CLOSING_BALANCE_REQUIRED')
    closing = _balance(records[index], plan)
    index += 1
    require(opening['currency'] == closing['currency'], 'BALANCE_CURRENCY')
    available = None
    forwards = []
    statement_narrative = []
    if index < len(records) and records[index]['tag'] == '64':
        available = _balance(records[index], plan)
        index += 1
    while index < len(records) and records[index]['tag'] == '65':
        forwards.append(_balance(records[index], plan))
        index += 1
        require(len(forwards) <= 10, 'FORWARD_BALANCE_COUNT')
    if index < len(records) and records[index]['tag'] == '86':
        statement_narrative = _narrative(records[index])
        index += 1
    require(index == len(records), 'UNSUPPORTED_OR_MISORDERED_TAG')
    require(all(b['currency'] == opening['currency'] for b in forwards +
                ([available] if available else [])), 'AVAILABLE_CURRENCY')
    require(len({b['date'] for b in forwards}) == len(forwards), 'DUPLICATE_FORWARD_DATE')
    semantic = {
        'message_reference': reference, 'related_reference': related, 'account': account,
        'statement_number': str(int(number)),
        'sequence_number': int(sequence) if sequence else None,
        'opening': opening, 'closing': closing,
        'available': available, 'forward_available': forwards,
        'statement_narrative_lines': statement_narrative,
        'transactions': [{k: v for k, v in t.items() if k != 'source_line'}
                         for t in transactions],
        # Retain lexical fields so changed same-key bytes cannot quietly coalesce.
        'raw_fields': [{'tag': r['tag'], 'lines': r['lines']} for r in records],
    }
    page_hash = digest(canonical(semantic))
    occurrence = {'source_id': source['id'], 'first_line': records[0]['line'],
                  'last_line': records[-1]['line'] + len(records[-1]['lines']) - 1,
                  'transaction_lines': [t['source_line'] for t in transactions],
                  'transport': transport}
    if plan['schema'] == 'mt940-intake-plan/2':
        occurrence.update(encoding=source['encoding'],
                          debit_credit_profile=source['debit_credit_profile'])
    movement = sum(int(t['amount_minor']) for t in transactions)
    difference = int(opening['minor']) + movement - int(closing['minor'])
    credits = sum(int(t['amount_minor']) for t in transactions if t['mark'] in {'C', 'RD'})
    debits = -sum(int(t['amount_minor']) for t in transactions if t['mark'] in {'D', 'RC'})
    key = [plan['institution_scope'], account, opening['currency'],
           closing['date'][:4], str(int(number)), int(sequence) if sequence else None]
    return {'page_sha256': page_hash, 'identity': key, 'data': semantic,
            'occurrences': [occurrence], 'movement_minor': str(movement),
            'credit_total_minor': str(credits), 'debit_total_minor': str(debits),
            'credit_rows': sum(t['mark'] in {'C', 'RD'} for t in transactions),
            'debit_rows': sum(t['mark'] in {'D', 'RC'} for t in transactions),
            'booked_difference_minor': str(difference), 'findings': []}


def compile_report(plan: Any, sources: dict[str, bytes]) -> dict:
    plan = validate_plan(plan)
    require(type(sources) is dict and set(sources) == {r['id'] for r in plan['sources']},
            'SOURCE_SET_MISMATCH')
    pages_by_hash: dict[str, dict] = {}
    source_receipts = []
    page_count = entry_count = 0
    for source in plan['sources']:
        raw = sources[source['id']]
        require(type(raw) is bytes and len(raw) == source['bytes'], 'SOURCE_SIZE_MISMATCH')
        require(digest(raw) == source['sha256'], 'SOURCE_HASH_MISMATCH')
        text = _text(raw, source.get('encoding', 'ASCII'))
        message_count = 0
        for body, first, transport in _bodies(text, source['profile']):
            groups = _records(body, first)
            if source['profile'] == 'FIN_ENVELOPE':
                require(len(groups) == 1, 'MULTIPLE_STATEMENTS_IN_FIN_BODY')
            for records in groups:
                page_count += 1
                require(page_count <= MAX_PAGES, 'PAGE_LIMIT')
                page = parse_page(records, plan, source, transport)
                entry_count += len(page['data']['transactions'])
                require(entry_count <= MAX_ENTRIES, 'ENTRY_LIMIT')
                h = page['page_sha256']
                if h in pages_by_hash:
                    pages_by_hash[h]['occurrences'].extend(page['occurrences'])
                else:
                    pages_by_hash[h] = page
                message_count += 1
        source_receipts.append({**source, 'message_count': message_count})
    pages = sorted(pages_by_hash.values(), key=lambda p: canonical(p['identity']) +
                   p['page_sha256'].encode())
    findings: list[dict] = []
    def finding(code: str, affected: list[dict], detail: str = '') -> None:
        hashes = sorted(p['page_sha256'] for p in affected)
        row = {'code': code, 'pages': hashes, 'detail': detail}
        findings.append(row)
        for p in affected:
            if code not in p['findings']:
                p['findings'].append(code)
    identities: dict[bytes, list[dict]] = defaultdict(list)
    groups: dict[bytes, list[dict]] = defaultdict(list)
    for p in pages:
        identities[canonical(p['identity'])].append(p)
        groups[canonical(p['identity'][:-1])].append(p)
        p['occurrences'].sort(key=lambda x: (x['source_id'], x['first_line']))
        if int(p['booked_difference_minor']) != 0:
            finding('BOOKED_BALANCE_DIFFERENCE', [p], p['booked_difference_minor'])
        d = p['data']
        if d['opening']['date'] > d['closing']['date']:
            finding('BALANCE_DATE_REVERSED', [p])
        if d['available'] and d['available']['date'] != d['closing']['date']:
            finding('AVAILABLE_DATE_DIFFERS', [p])
        if any(b['date'] < d['closing']['date'] for b in d['forward_available']):
            finding('FORWARD_DATE_BEFORE_CLOSE', [p])
        if len(p['occurrences']) > 1:
            # Informational only: one exact page, all original occurrences retained.
            p['duplicate_occurrences'] = len(p['occurrences']) - 1
        else:
            p['duplicate_occurrences'] = 0
    for variants in identities.values():
        if len(variants) > 1:
            finding('STATEMENT_IDENTITY_CONFLICT', variants)
    group_reports = []
    complete_chains: dict[tuple, list[list[dict]]] = defaultdict(list)
    for key, parts in sorted(groups.items()):
        sequences = [p['data']['sequence_number'] for p in parts]
        conflict = len(set(sequences)) != len(sequences)
        ordered = sorted(parts, key=lambda p: (p['data']['sequence_number'] or 0,
                                              p['page_sha256']))
        valid = not conflict
        if None in sequences:
            valid = valid and len(parts) == 1
        else:
            valid = valid and sorted(sequences) == list(range(1, len(parts) + 1))
        valid = valid and ordered[0]['data']['opening']['tag'] == '60F'
        valid = valid and ordered[-1]['data']['closing']['tag'] == '62F'
        valid = valid and all(p['data']['opening']['tag'] == '60M' for p in ordered[1:])
        valid = valid and all(p['data']['closing']['tag'] == '62M' for p in ordered[:-1])
        if not valid:
            finding('MULTIPART_INCOMPLETE_OR_CONFLICTING', parts)
        else:
            for before, after in zip(ordered, ordered[1:]):
                left, right = before['data']['closing'], after['data']['opening']
                if any(left[k] != right[k] for k in ('date', 'currency', 'minor')):
                    finding('INTERMEDIATE_BALANCE_CHAIN_DIFFERENCE', [before, after])
            if len({p['data']['closing']['date'] for p in ordered}) != 1:
                finding('MULTIPART_CLOSE_DATE_DIFFERENCE', parts)
        if valid:
            account_key = tuple(ordered[0]['identity'][:3])
            complete_chains[account_key].append(ordered)
        group_reports.append({'identity': json.loads(key),
                              'pages': [p['page_sha256'] for p in ordered],
                              'multipart_structure_matches': bool(valid)})
    for chains in complete_chains.values():
        chains.sort(key=lambda chain: (chain[-1]['data']['closing']['date'],
                                       int(chain[0]['data']['statement_number'])))
        for left, right in zip(chains, chains[1:]):
            close = left[-1]['data']['closing']
            opening = right[0]['data']['opening']
            if close['date'] == right[-1]['data']['closing']['date']:
                finding('SAME_ACCOUNT_CLOSE_DATE_AMBIGUOUS', left + right)
            elif any(close[k] != opening[k] for k in ('date', 'currency', 'minor')):
                finding('SUPPLIED_STATEMENT_CHAIN_BREAK', [left[-1], right[0]])
    if not plan['complete_export_set']:
        finding('EXPORT_SET_NOT_DECLARED_COMPLETE', [])
    for p in pages:
        p['findings'].sort()
        p['status'] = 'REVIEW' if p['findings'] else 'SUPPLIED_PAGE_CONTROLS_MATCH'
    findings.sort(key=lambda r: (r['code'], r['pages'], r['detail']))
    # No account/currency aggregate is represented as spendable cash or ledger truth.
    return {'schema': VERSION, 'plan_sha256': digest(canonical(plan)),
            'plan': plan, 'sources': source_receipts, 'pages': pages,
            'statement_groups': group_reports, 'findings': findings,
            'status': 'REVIEW' if findings else 'SUPPLIED_SET_CONTROLS_MATCH',
            'summary': {'source_files': len(source_receipts),
                        'page_occurrences': page_count, 'unique_pages': len(pages),
                        'duplicate_page_occurrences': page_count - len(pages),
                        'unique_page_transaction_rows': sum(len(p['data']['transactions'])
                                                            for p in pages),
                        'finding_count': len(findings)},
            'limitations': LIMITATIONS[:],
            'authority': {'bank_authenticated': False, 'history_completeness_proven': False,
                          'live_balance': False, 'ledger_posting': False,
                          'payment_execution': False, 'external_send': False}}

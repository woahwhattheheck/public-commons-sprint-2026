"""Readable export shared by the original HTTP and optional ASGI hosts."""
import html
import re
from .common import dumps

def _inline(value: str) -> str:
    parts = re.split(r'(\*\*[^*\n]+\*\*|`[^`\n]+`)', str(value))
    unescape = lambda s: re.sub(r'\\([\\`*{}\[\]()#+.!<>_|-])', r'\1', s)
    return ''.join('<strong>'+html.escape(unescape(p[2:-2]))+'</strong>' if p.startswith('**') and p.endswith('**')
                   else '<code>'+html.escape(p[1:-1])+'</code>' if p.startswith('`') and p.endswith('`')
                   else html.escape(unescape(p)) for p in parts)


def _prose(value: str) -> str:
    """Render retained plain Markdown without accepting HTML, scripts or URLs."""
    lines = str(value or '').replace('\r\n', '\n').replace('\r', '\n').split('\n')
    result, i = [], 0
    rule = lambda s: bool(re.fullmatch(r'\s*\|?\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?)+\s*\|?\s*', s))
    cells = lambda s: [v.strip().replace(r'\|', '|') for v in re.split(r'(?<!\\)\|', s.strip().strip('|'))]
    def special(n):
        return (not lines[n].strip() or bool(re.match(r'\s*(#{1,6}\s|[-*+]\s|\d+\.\s|```)', lines[n]))
                or ('|' in lines[n] and n+1 < len(lines) and rule(lines[n+1])))
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if re.match(r'\s*```', line):
            body, i = [], i+1
            while i < len(lines) and not re.match(r'\s*```', lines[i]):
                body.append(lines[i]); i += 1
            i += i < len(lines)
            result.append('<pre><code>'+html.escape('\n'.join(body))+'</code></pre>')
            continue
        if '|' in line and i+1 < len(lines) and rule(lines[i+1]):
            header = '<thead><tr>'+''.join('<th scope="col">'+_inline(v)+'</th>' for v in cells(line))+'</tr></thead>'
            rows, i = [], i+2
            while i < len(lines) and lines[i].strip() and '|' in lines[i]:
                rows.append('<tr>'+''.join('<td>'+_inline(v)+'</td>' for v in cells(lines[i]))+'</tr>'); i += 1
            result.append('<div class="table-scroll"><table>'+header+'<tbody>'+''.join(rows)+'</tbody></table></div>')
            continue
        heading = re.match(r'\s*(#{1,6})\s+(.+)$', line)
        if heading:
            level = str(min(6, len(heading[1])+2))
            result.append('<h'+level+'>'+_inline(heading[2])+'</h'+level+'>'); i += 1
            continue
        item = re.match(r'\s*([-*+]|\d+\.)\s+(.+)$', line)
        if item:
            ordered, items = item[1][0].isdigit(), []
            while i < len(lines):
                item = re.match(r'\s*([-*+]|\d+\.)\s+(.+)$', lines[i])
                if not item or item[1][0].isdigit() != ordered:
                    break
                items.append('<li>'+_inline(item[2])+'</li>'); i += 1
            tag = 'ol' if ordered else 'ul'
            result.append('<'+tag+'>'+''.join(items)+'</'+tag+'>')
            continue
        body, i = [line], i+1
        while i < len(lines) and not special(i):
            body.append(lines[i]); i += 1
        result.append('<p>'+_inline(' '.join(body))+'</p>')
    return '<div class="prose">'+''.join(result)+'</div>'


def _table(headers, rows) -> str:
    return ('<div class="table-scroll"><table><thead><tr>'
            + ''.join('<th scope="col">'+html.escape(str(x))+'</th>' for x in headers)
            + '</tr></thead><tbody>'
            + ''.join('<tr>'+''.join('<td>'+html.escape('-' if x is None else str(x))+'</td>' for x in row)+'</tr>' for row in rows)
            + '</tbody></table></div>')


def _evidence_summary(evidence: dict, original_headers=None, column_roles=None) -> str:
    result = evidence.get('result', {})
    operation = evidence.get('operation', {}).get('operation', 'Retained analysis')
    sources = evidence.get('sources', [])
    name = sources[0].get('name') if sources else None
    heading = {'inventory': 'Available original sources', 'profile': 'Stored source profile',
               'table_rows': 'Original literal records'}.get(operation, str(operation).replace('_', ' ').title())
    pieces = ['<h2>'+html.escape(heading)+('</h2><p>'+html.escape(name)+'</p>' if name else '</h2>')]
    if sources:
        pieces.append(_table(['Original source', 'Bytes'], [[s.get('name') or s.get('id') or s.get('registry'), s.get('bytes')] for s in sources]))
    if operation == 'inventory' and isinstance(result, dict):
        counts = result.get('counts', {})
        pieces.append('<p>'+html.escape(' - '.join(str(v)+' '+str(k).replace('_', ' ') for k, v in counts.items()))+'</p>')
        rows = []
        for key in ['datasets', 'jobs', 'ensembles', 'aois']:
            for item in result.get(key, []):
                metadata = item.get('metadata', {})
                source = metadata.get('source', {})
                selection = source.get('client_source', {}).get('selection', {})
                rows.append([item.get('title') or item.get('name') or item.get('id'), key.rstrip('s'),
                             selection.get('role') or source.get('role') or metadata.get('native_kind'),
                             item.get('bytes'), selection.get('units') or metadata.get('units') or 'Not supplied'])
        if rows:
            pieces.append(_table(['Original item', 'Kind', 'Reviewed role', 'Bytes', 'Units'], rows))
    elif operation == 'table_rows' and isinstance(result, dict):
        rows = result.get('rows', [])
        retained_headers = list(dict.fromkeys(key for row in rows if isinstance(row, dict) for key in row))
        declared=result.get('headers') or original_headers or []
        headers=[key for key in declared if key in retained_headers]
        headers.extend(key for key in retained_headers if key not in headers)
        if headers:
            pieces.append(_table(headers, [[row.get(key) for key in headers] for row in rows]))
        pieces.append('<p>Original record page starts at row '+html.escape(str(result.get('offset', 0)+1))
                      +'; '+html.escape(str(len(rows)))+' retained records are displayed.'
                      +(' Further original records remain available.' if result.get('next_offset') is not None else ' This page reaches the end of the original table.')+'</p>')
        if 'Qualifier' in headers:
            pieces.append('<p>Qualifier cells are retained exactly as provided. Their definitions require the source code dictionary.</p>')
    elif operation == 'profile' and isinstance(result, dict):
        pieces.append('<p>'+html.escape(str(result.get('format', 'Source')))+' - '
                      +html.escape(str(result.get('rows', 'Unknown')))+' original rows - '
                      +html.escape(str(result.get('population', 'Retained source')))+' </p>')
        columns = result.get('columns', {})
        if isinstance(columns, dict):
            rows = []
            for name, values in columns.items():
                numeric = values.get('numeric', {})
                role=(column_roles or {}).get(name)
                aggregate=[None,None,None] if role in {'Identifier','Label'} else [numeric.get('min'),numeric.get('max'),numeric.get('mean')]
                rows.append([name,role or 'Not declared',values.get('missing'),values.get('non_numeric_or_nonfinite'),numeric.get('count'),*aggregate])
            pieces.append(_table(['Original column','Declared role','Missing','Other literal cells','Parsed numeric cells','Minimum','Maximum','Mean'],rows))
    else:
        scalars = {k: v for k, v in result.items() if isinstance(v, (str, int, float, bool)) or v is None} if isinstance(result, dict) else {}
        if scalars:
            pieces.append(_table(['Retained quantity', 'Value'], [[k.replace('_', ' '), v] for k, v in scalars.items()]))
    pieces.append('<details><summary>Complete technical evidence - '+html.escape(str(evidence.get('id', '')))
                  +'</summary><pre>'+html.escape(dumps(evidence))+'</pre></details>')
    return ''.join(pieces)


def report(session: dict) -> str:
    events = [event for event in session['events'] if event['kind'] in {'question', 'answer', 'request_error'}]
    answers = [i for i, event in enumerate(events) if event['kind'] == 'answer']
    selected = answers[-1] if answers else len(events)-1
    sections = []
    if selected >= 0:
        question = next((event for event in reversed(events[:selected+1]) if event['kind'] == 'question'), None)
        if question:
            sections.append('<section><h2>Question</h2>'+_prose(question['body'].get('text', ''))+'</section>')
        current = events[selected]
        if current is not question:
            body = current['body']
            sections.append('<section><h2>'+('Answer' if current['kind'] == 'answer' else 'Provider result')+'</h2>'
                            +_prose(body.get('text', body.get('error', '')))+'<details><summary>Original retained text</summary><pre>'
                            +html.escape(body.get('text', body.get('error', '')))+'</pre></details></section>')
    original_orders={}
    column_roles={}
    for evidence in session['evidence']:
        for source in evidence.get('sources',[]):
            metadata=source.get('metadata',{});record=metadata.get('source',{})
            fields=record.get('original_fields',[])
            if fields and all(isinstance(field.get('index'),int) and isinstance(field.get('label'),str) for field in fields):
                labels=[field['label'] for field in sorted(fields,key=lambda field:field['index'])]
                if len(set(labels))==len(labels):
                    key=(metadata.get('source_binding',{}).get('collection_id'),metadata.get('source_binding',{}).get('source_id'),record.get('body',{}).get('sha256'))
                    original_orders[key]=labels
                    identifiers={field.get('id'):field['label'] for field in fields}
                    selections=[record.get('client_source',{}).get('selection',{})]
                    if evidence.get('result',{}).get('format')=='structured_json':
                        own=record.get('client_source',{}).get('selection',{})
                        selections.extend(value for value in evidence.get('result',{}).get('data',{}).get('selections',[])
                            if all(value.get(name)==own.get(name) for name in ('file_index','part_index')))
                    for selection in selections:
                        for field,role in [('identifier_field','Identifier'),('label_field','Label')]:
                            label=identifiers.get(selection.get(field))
                            if label: column_roles.setdefault(key,{})[label]=role
    order = {'table_rows': 0, 'profile': 1, 'inventory': 2}
    for evidence in sorted(session['evidence'], key=lambda e: order.get(e.get('operation', {}).get('operation'), 3)):
        source=next(iter(evidence.get('sources',[])),{})
        metadata=source.get('metadata',{});record=metadata.get('source',{})
        key=(metadata.get('source_binding',{}).get('collection_id'),metadata.get('source_binding',{}).get('source_id'),record.get('body',{}).get('sha256'))
        sections.append('<section id="'+html.escape(evidence['id'],quote=True)+'">'+_evidence_summary(evidence,original_orders.get(key),column_roles.get(key))+'</section>')
    for plan in session['plans']:
        sections.append('<section><h2>Guided action - '+html.escape(plan['status'])+'</h2><details><summary>Complete retained action</summary><pre>'+html.escape(dumps(plan))+'</pre></details></section>')
    history = []
    for event in events:
        body = event['body']
        history.append('<h3>'+html.escape(event['kind'].replace('_', ' ').title())+'</h3>'
                       +_prose(body.get('text', body.get('error', ''))))
    sections.append('<section><details><summary>Complete retained conversation - '+str(len(events))+' entries</summary>'
                    +''.join(history)+'</details></section>')
    style = 'body{font:15px/1.5 system-ui;max-width:1100px;margin:40px auto;padding:0 20px;color:#191919;background:#fff}h1{font-size:28px}h2{font-size:19px}h3{font-size:17px}section{border-top:1px solid #bbb;padding:18px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace}.prose{overflow-wrap:anywhere}.table-scroll{overflow-x:auto;max-width:100%}table{border-collapse:collapse;text-align:left;font-size:14px;min-width:100%;width:max-content}th,td{padding:8px 12px;border-bottom:1px solid #bbb;vertical-align:top;white-space:nowrap}td{overflow-wrap:anywhere}details{margin:14px 0}summary{cursor:pointer;font-size:13px;color:#445}code{font-family:monospace}small{color:#555}@media print{section{break-inside:avoid}}'
    created = str(session['created']).replace('T', ' ').replace('+00:00', ' UTC')
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html.escape(session['title'])+'</title><style>'+style+'</style><header><small>ECO SCIENCE / RETAINED INVESTIGATION</small><h1>'+html.escape(session['title'])+'</h1><p>Created '+html.escape(created)+'</p></header>'+''.join(sections)+'</html>'

"""Readable export shared by the original HTTP and optional ASGI hosts."""
import html
from .common import dumps

def report(session: dict) -> str:
    sections=[]
    for event in session['events']:
        if event['kind'] in {'question','answer','request_error'}:
            body=event['body']
            sections.append('<section><h2>'+html.escape(event['kind'].replace('_',' ').title())+'</h2><p class="prose">'+html.escape(body.get('text',body.get('error','')))+'</p></section>')
    for evidence in session['evidence']:
        sections.append('<section id="'+evidence['id']+'"><h2>'+evidence['id']+'</h2><pre>'+html.escape(dumps(evidence))+'</pre></section>')
    for plan in session['plans']:
        sections.append('<section><h2>Guided action · '+html.escape(plan['status'])+'</h2><pre>'+html.escape(dumps(plan))+'</pre></section>')
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html.escape(session['title'])+'</title><style>body{font:15px/1.5 system-ui;max-width:1100px;margin:40px auto;padding:0 20px;color:#191919;background:#fff}h1{font-size:28px}h2{font-size:17px}section{border-top:1px solid #bbb;padding:18px 0}pre,.prose{white-space:pre-wrap;overflow-wrap:anywhere}pre{font:12px/1.5 monospace}small{color:#555}@media print{section{break-inside:avoid}}</style><header><small>ECO SCIENCE / RETAINED INVESTIGATION</small><h1>'+html.escape(session['title'])+'</h1><p>Created '+html.escape(session['created'])+' · Tenant '+html.escape(session['tenant'])+'</p></header>'+''.join(sections)+'</html>'

"""Complete print-friendly HTML and spreadsheet-safe physical-outcome CSV."""
from __future__ import annotations
import csv
import io
import json
from html import escape
from .engine import canonical_hash
from .schema import Study


def _e(value):
    if value is None: return "—"
    return escape(str(value))


def _table(headers, rows):
    return '<div class="scroll"><table><thead><tr>'+''.join('<th>'+_e(h)+'</th>' for h in headers)+'</tr></thead><tbody>'+''.join(
        '<tr>'+''.join('<td>'+_e(c)+'</td>' for c in row)+'</tr>' for row in rows)+'</tbody></table></div>'


def _bind(study, answer):
    s = study if isinstance(study, Study) else Study.model_validate(study)
    if canonical_hash(s.model_dump()) != answer.get('study_sha256'):
        raise ValueError('Report result does not belong to these study inputs')
    return s


def populations(answer):
    if answer['schema_version'] == 'ecosci.robust-frontier/1':
        return [(p['budget'], p.get('result', {'status': p.get('status')})) for p in answer['points']]
    return [(None, answer['result'])]


def html_report(study, answer):
    s = _bind(study, answer)
    body = '<h1>'+_e(s.title)+'</h1><p class="subtitle">Retained decision report · '+_e(s.mode)+'</p>'
    body += '<p>Input SHA-256: <code>'+_e(answer['study_sha256'])+'</code></p>'
    body += '<h2>Decision assumptions</h2><p>Positive physical gain means reduced export. Scores use the stated weights and scales. Guaranteed targets apply to every included profile. Profile probabilities, when supplied, are decision assumptions.</p>'
    body += _table(['Budget', 'Cost unit', 'Capacity limit', 'Selection model'], [[s.budget, s.cost_units, s.capacity, s.mode]])
    if s.additive_basis: body += '<p>'+_e(s.additive_basis)+'</p>'
    body += _table(['Metric', 'Original unit', 'Scale', 'Weight', 'Guaranteed gain'], [[m.id,m.units,m.scale,m.weight,m.guaranteed_gain] for m in s.metrics])
    body += _table(['Profile', 'Description', 'Supplied probability'], [[p.id,p.label,p.probability] for p in s.profiles])
    for budget, result in populations(answer):
        body += '<h2>'+('Budget '+_e(budget)+' '+_e(s.cost_units) if budget is not None else 'Selected decision')+'</h2>'
        body += '<p>Status: <strong>'+_e(result['status'])+'</strong></p>'
        if result.get('selected_ids') is not None:
            body += _table(['Selected candidates', 'Cost', 'Worst score', 'Maximum regret'], [[', '.join(result['selected_ids']),result['cost'],result['worst_score'],result.get('maximum_regret')]])
            body += _table(['Profile','Score','Regret','Metric','Gain','Unit','Target','Shortfall'], [[p['id'],p['score'],p.get('regret'),m['id'],m['gain'],m['units'],m['guaranteed_gain'],m['target_shortfall']] for p in result['profiles'] for m in p['metrics']])
            body += _table(['Constraint','Actual','Above minimum','Below maximum'], [[c['id'],c['value'],c['lower_slack'],c['upper_slack']] for c in result['constraints']])
        elif 'diagnostic_without_gain_targets' in result:
            relaxed = result['diagnostic_without_gain_targets']
            body += '<h3>Target-relaxed diagnostic</h3><p>Budget, capacity and selection constraints remain in force. This comparison reports target shortfalls rather than accepting them.</p>'
            if relaxed.get('selected_ids') is not None:
                body += '<p>Diagnostic selection: '+_e(', '.join(relaxed['selected_ids']))+'</p>'
                body += _table(['Profile','Metric','Gain','Unit','Required','Shortfall'], [[p['id'],m['id'],m['gain'],m['units'],m['guaranteed_gain'],m['target_shortfall']] for p in relaxed['profiles'] for m in p['metrics']])
            else: body += '<p>'+_e(relaxed.get('message',relaxed['status']))+'</p>'
    if answer.get('profile_benchmarks'):
        body += '<h2>Same-feasible-set profile benchmarks</h2>'+_table(['Profile','Status','Best score','Selected'], [[p['profile_id'],p['status'],p['profile_optimum'],', '.join(p.get('selected_ids',[]))] for p in answer['profile_benchmarks']])
    if answer.get('value_of_information'):
        v=answer['value_of_information']
        body += '<h2>Value of perfect profile information</h2><p>'+_e(v['evpi'])+' '+_e(v['units'])+'. This is a score difference, not a monetary valuation.</p>'
        body += _table(['Perfect-information expectation','Best expected fixed plan'], [[v['perfect_information_score'],v['optimal_expected_score']]])
    body += '<h2>Complete candidate inputs</h2>'+_table(['Candidate','Description','Cost','Capacity','Required','Excluded','Group'], [[c.id,c.label,c.cost,c.capacity,c.required,c.excluded,c.group] for c in s.candidates])
    body += '<h2>Complete original gain matrix</h2>'+_table(['Profile','Candidate',*[m.id+' ['+m.units+']' for m in s.metrics]], [[c.profile_id,c.candidate_id,*[c.gains[m.id] for m in s.metrics]] for c in s.cells])
    body += '<h2>Retained source identities</h2><pre>'+_e(json.dumps(s.source,indent=2,ensure_ascii=False))+'</pre>'
    body += '<details><summary>Complete selected-cell provenance and input</summary><pre>'+_e(json.dumps(s.model_dump(),indent=2,ensure_ascii=False))+'</pre></details>'
    body += '<details><summary>Complete calculation record</summary><pre>'+_e(json.dumps(answer,indent=2,ensure_ascii=False))+'</pre></details>'
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+_e(s.title)+'''</title><style>
body{font:14px/1.5 system-ui,sans-serif;color:#222;max-width:1200px;margin:40px auto;padding:0 24px}h1{font-size:26px}h2{font-size:19px;margin-top:30px}h3{font-size:16px}table{border-collapse:collapse;width:100%;font-size:12px;margin:16px 0}th,td{text-align:left;padding:8px;border-bottom:1px solid #ccc;overflow-wrap:anywhere}th{background:#eee}pre,code{font-size:11px;overflow-wrap:anywhere;white-space:pre-wrap}pre{padding:15px;background:#f4f4f4}.scroll{overflow:auto}.subtitle{color:#666}summary{cursor:pointer}@media print{body{max-width:none;margin:0;padding:0}h2{break-after:avoid}tr{break-inside:avoid}details{display:none}th{background:#eee}}
</style><body>'''+body+'</body></html>'


def csv_report(study, answer):
    _bind(study, answer)
    buffer=io.StringIO(newline=''); writer=csv.writer(buffer)
    def safe(v):
        # Keep numeric values numeric; disarm formula-like text labels only.
        if isinstance(v,str) and v.lstrip()[:1] in ('=', '+', '-', '@'):
            return "'"+v
        return v
    writer.writerow(['budget','status','selected_ids','cost','cost_units','profile','score','regret','metric','gain','units','guaranteed_gain','target_shortfall'])
    for budget,r in populations(answer):
        base=[budget,r['status'],' | '.join(r.get('selected_ids',[])),r.get('cost'),r.get('cost_units')]
        if not r.get('profiles'):
            writer.writerow([safe(v) for v in base]+['']*8)
        else:
            for p in r['profiles']:
                for m in p['metrics']:
                    writer.writerow([safe(v) for v in base+[p['id'],p['score'],p.get('regret'),m['id'],m['gain'],m['units'],m['guaranteed_gain'],m['target_shortfall']]])
    return buffer.getvalue()

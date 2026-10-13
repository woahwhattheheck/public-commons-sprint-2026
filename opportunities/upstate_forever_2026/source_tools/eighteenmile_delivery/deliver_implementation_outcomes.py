#!/usr/bin/env python3
"""Publish the Eighteenmile 2023 reading desk from its existing native outcome.

This producer reads saved results; it never recalculates measurements or contrasts.
Original report bytes and complete selected-source rows travel with the reading desk.
"""
from __future__ import annotations
import argparse, base64, csv, hashlib, html, io, json, mimetypes, shutil, zipfile
from pathlib import Path
from typing import Any


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def interval(value: dict[str, Any] | None) -> str:
    if not value:
        return 'Unavailable for this selection'
    lo, hi = value.get('lower'), value.get('upper')
    if lo == hi and lo is not None:
        return format(lo, '.7g')
    return ('(' if value.get('lower_open') else '[') + (format(lo, '.7g') if lo is not None else '-infinity') + ', ' + (format(hi, '.7g') if hi is not None else '+infinity') + (')' if value.get('upper_open') else ']')


def make_zip(files: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 10, 13, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, data)
    return out.getvalue()


CSS = '''
:root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#181818}
*{box-sizing:border-box}body{margin:0;background:#fff;color:#181818;font:16px/1.5 Arial,Helvetica,sans-serif}
main{max-width:1120px;margin:0 auto;padding:34px 28px 60px;background:#fff;color:#181818}
a{color:#181818}h1{font-size:34px;line-height:1.12;margin:12px 0 16px;max-width:820px;letter-spacing:-.5px}h2{font-size:23px;line-height:1.2;margin:0 0 14px}h3{font-size:18px;line-height:1.3;margin:10px 0}p{margin:9px 0 16px;max-width:95ch}
.kicker{font-size:12px;text-transform:uppercase;letter-spacing:1.3px;color:#505050}.muted,small{color:#505050}.lead{max-width:880px;font-size:18px}.stats{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #bdbdbd;margin:24px 0}.stat{padding:15px;border-right:1px solid #bdbdbd;background:#f5f5f5;color:#181818}.stat:last-child{border-right:0}.stat strong{display:block;font-size:28px;line-height:1.2;margin-bottom:4px}.stat span{font-size:14px}
nav{display:flex;gap:8px;flex-wrap:wrap;border-block:1px solid #bdbdbd;padding:12px 0;margin:24px 0}button,.button{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:9px 13px;font:inherit;font-size:14px;line-height:1.3;min-height:42px;color:#181818;background:#fff;border:1px solid #808080;border-radius:2px;text-decoration:none;cursor:pointer}button:hover,.button:hover{background:#eee}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #505050;outline-offset:2px}button[aria-current=true]{background:#252525;color:#fff;border-color:#252525}section{margin-top:28px}.panel{border:1px solid #bdbdbd;padding:20px;margin:20px 0;background:#fff;color:#181818}.note{padding:14px 18px;background:#f2f2f2;color:#181818;border-left:3px solid #505050}.table-scroll{overflow:auto;max-width:100%;border:1px solid #bdbdbd;margin:14px 0}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #ccc}thead th{background:#ededed;color:#171717}tbody tr:last-child td{border-bottom:0}.comparison{min-width:640px}.comparison th:first-child{width:36%}.comparison td:not(:first-child){font-variant-numeric:tabular-nums}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:16px}.metric{background:#f7f7f7;padding:14px}.metric strong{display:block;font-size:23px;font-variant-numeric:tabular-nums;margin:4px 0}.metric span{font-size:13px}.tools{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin:14px 0}label{display:flex;flex-direction:column;gap:5px;font-size:14px}input,select,textarea{font:inherit;padding:9px 10px;color:#171717;background:#fff;border:1px solid #808080;border-radius:2px;max-width:100%}#search{width:320px}pre,code{font-size:12px;overflow-wrap:anywhere;white-space:pre-wrap;background:#f6f6f6;color:#181818}pre{padding:14px;max-height:460px;overflow:auto}details{border-top:1px solid #bbb;padding:12px 0}summary{cursor:pointer;font-weight:bold;padding:5px 0}.figure-scroll{overflow:auto;border:1px solid #bbb;padding:10px}.figure-scroll svg{display:block;width:100%;min-width:800px;height:auto}.hidden{display:none}.downloads{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.downloads button{justify-content:flex-start;text-align:left}.record{padding:0;background:#fff}.record details{padding:8px 0}.record pre{max-width:900px}.foot{margin-top:36px;border-top:1px solid #aaa;padding-top:18px;font-size:13px}.tag{font-size:12px;border:1px solid #999;padding:2px 6px;white-space:nowrap}#rows-table{min-width:850px}.print-only{display:none}
@media(max-width:650px){main{padding:22px 18px 40px}h1{font-size:29px}.lead{font-size:16px}.stats{grid-template-columns:repeat(2,1fr)}.stat:nth-child(2){border-right:0}.stat:nth-child(-n+2){border-bottom:1px solid #bbb}.stat strong{font-size:25px}.panel{padding:14px}.metrics{grid-template-columns:1fr}.downloads{grid-template-columns:1fr}nav{display:grid;grid-template-columns:1fr 1fr}nav button{min-height:42px}.tools{display:grid;grid-template-columns:1fr;width:100%}input,select,#search{width:100%}.note{padding:12px}.figure-scroll svg{min-width:800px}.comparison,.comparison tbody{display:block;min-width:0;width:100%}.comparison thead{display:none}.comparison tr{display:block;border-bottom:1px solid #aaa}.comparison tr:last-child{border-bottom:0}.comparison th:first-child{display:block;width:auto;background:#ededed}.comparison td{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.comparison td::before{content:attr(data-label);color:#444}.comparison td:last-child{border-bottom:0}}
@media print{@page{size:A4;margin:16mm}main{padding:0;font-size:10pt}.kicker{font-size:8pt}h1{font-size:25pt}h2{font-size:16pt}h3{font-size:12pt}.lead{font-size:11pt}.stats{margin:14px 0}.stat strong{font-size:21pt}.stat span{font-size:9pt}.panel{margin:14px 0;padding:12px;break-inside:avoid}.note{font-size:10pt}.comparison{min-width:0}table{font-size:9pt}th,td{padding:6px 8px}nav,.no-print,details,#sources,#charts,#downloads,.tools,.foot{display:none!important}#overview{display:block!important}.metrics{gap:10px}.metric strong{font-size:16pt}.table-scroll{overflow:visible}.print-only{display:block}p{orphans:3;widows:3}.panel{break-inside:avoid}h2,h3{break-after:avoid}}
'''

JS = r'''
const payload=JSON.parse(document.getElementById('payload').textContent);
const buttons=[...document.querySelectorAll('nav button')];
function tab(id){for(const section of document.querySelectorAll('section[data-tab]'))section.classList.toggle('hidden',section.id!==id);for(const button of buttons)button.setAttribute('aria-current',String(button.dataset.tab===id));}
for(const button of buttons)button.addEventListener('click',()=>tab(button.dataset.tab));
const generated=[];
function download(name){const item=payload.files[name];if(!item)throw new Error('Missing retained file: '+name);const raw=atob(item.base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:item.type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);document.getElementById('download-status').textContent='Prepared '+name+' ('+bytes.length.toLocaleString()+' bytes).';}
for(const button of document.querySelectorAll('[data-download]'))button.addEventListener('click',()=>download(button.dataset.download));
const tbody=document.getElementById('rows');const fields=['date','site_id','parameter','original_text','unit','method','qualifier'];
function renderRows(){tbody.replaceChildren();const term=document.getElementById('search').value.trim().toLowerCase(),period=document.getElementById('period').value,series=document.getElementById('series').value;const filtered=payload.records.filter(r=>(!period||r.period===period)&&(!series||r.group_id===series)&&(!term||JSON.stringify(r).toLowerCase().includes(term)));
 for(const r of filtered){const tr=document.createElement('tr');for(const field of fields){const td=document.createElement('td');td.textContent=r[field]??'';tr.appendChild(td);}const td=document.createElement('td'),b=document.createElement('button');b.textContent='Original row';b.addEventListener('click',()=>{document.getElementById('row-title').textContent=(r.parameter||'Original record')+' · '+r.date+' · '+r.site_id;document.getElementById('row-content').textContent=JSON.stringify(r,null,2);document.getElementById('record-detail').open=true;document.getElementById('record-detail').scrollIntoView({block:'nearest'});});td.appendChild(b);tr.appendChild(td);tbody.appendChild(tr);}
 document.getElementById('row-count').textContent=filtered.length+' of '+payload.records.length+' retained comparison records';}
for(const id of ['search','period','series'])document.getElementById(id).addEventListener('input',renderRows);
document.getElementById('clear-filters').addEventListener('click',()=>{for(const id of ['search','period','series'])document.getElementById(id).value='';renderRows();});
renderRows();tab('overview');
'''


def publish(result_path: Path, workspace: Path, output: Path) -> dict[str, Any]:
    result = json.loads(result_path.read_text(encoding='utf-8-sig'))
    binding = result['plan_binding']
    report_dir = workspace / 'implementation/plans' / binding['plan_id'] / 'reports' / result['id']
    native: dict[str, bytes] = {}
    for item in result['files']:
        name = item['name']
        candidate = Path(name)
        if candidate.is_absolute() or '..' in candidate.parts:
            raise ValueError('Unsafe retained member path: ' + name)
        data = (report_dir / name).read_bytes()
        if len(data) != item['bytes'] or digest(data) != item['sha256']:
            raise ValueError('Original report changed: ' + name)
        native[name] = data
    values = json.loads(native['outcomes.json'])
    expected = {'plan_id':'eighteenmile-2023-original-lake-samples', 'revision':2, 'before':{'start':'2023-04-01','end':'2023-06-30'}, 'after':{'start':'2023-07-01','end':'2023-10-31'}, 'impact_site_ids':['21SC60WQ_WQX-SV-838'], 'control_site_ids':['21SC60WQ_WQX-SV-840'], 'event':None}
    if any(values['selection'].get(k) != v for k,v in expected.items()) or {e['method'] for e in values['effects']} != {'445.0','520019'}:
        raise ValueError('This reading desk is bound to the original Eighteenmile 2023 selection')
    if values['selection_digest'] != result['selection_digest'] or values['plan_binding'] != binding:
        raise ValueError('Selection/plan identity differs from the original result')
    if output.exists():
        raise FileExistsError('Use a new destination to retain previous deliveries: ' + str(output))
    output.mkdir(parents=True)
    original = output / 'native-report'; original.mkdir()
    for name, data in native.items():
        target = original / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
    (output/'native-result.json').write_bytes(result_path.read_bytes())
    selection=json.dumps(values['selection'],ensure_ascii=False,indent=2).encode()+b'\n'
    (output/'selection.json').write_bytes(selection)
    retained_zip=make_zip(native)
    (output/'Original_Outcome_Report_and_Data.zip').write_bytes(retained_zip)
    records=list(csv.DictReader(io.StringIO(native['outcome_rows.csv'].decode('utf-8-sig'))))
    ef = html.escape
    selection_v=values['selection'];summary=values['summary']
    period=lambda key: ef(selection_v[key]['start'])+' to '+ef(selection_v[key]['end'])
    stats=[(str(len(json.loads(native['plan.json'])['observations'])),'original laboratory results'),(str(summary['selected_records']),'selected comparison records'),(str(summary['matched_control_dates']),'shared sampling dates'),(str(summary['groups']),'separate analytical series')]
    header='<div class="stats">'+''.join('<div class="stat"><strong>'+ef(v)+'</strong><span>'+ef(label)+'</span></div>' for v,label in stats)+'</div>'
    cards=[];figures=[];options=[]
    for index,effect in enumerate(values['effects']):
        direct=effect['direct']; paired=effect['controls']['paired'];unit=effect['unit']
        options.append('<option value="'+ef(effect['group_id'],quote=True)+'">'+ef(effect['parameter'])+'</option>')
        rows=[]
        for label,item in [('Before',direct['before']),('After',direct['after'])]:
            rows.append('<tr><th scope="row">'+label+'</th><td data-label="Mean interval">'+ef(interval(item['interval']))+'</td><td data-label="Sampled dates">'+str(item['days'])+'</td><td data-label="Censored results">'+str(item['censored_records'])+'</td></tr>')
        missing=effect['controls']['unpaired_impact_dates']
        support='All selected study-station dates have a complete same-date reference match.' if not missing else 'Dates omitted from the paired contrast: '+', '.join(x['date'] for x in missing)+'. The original selection and omitted-reference details remain in the native report.'
        cards.append('<article class="panel"><h3>'+ef(effect['parameter'])+'</h3><p class="muted">'+ef(unit)+' · Method '+ef(effect['method'])+' · '+ef(effect['fraction'])+'</p><div class="table-scroll" tabindex="0" aria-label="Period measurements"><table class="comparison"><thead><tr><th>Study-station period</th><th>Mean interval ('+ef(unit)+')</th><th>Sampled dates</th><th>Censored results</th></tr></thead><tbody>'+''.join(rows)+'</tbody></table></div><div class="metrics"><div class="metric"><span>Change in study-station mean ('+ef(unit)+')</span><strong>'+ef(interval(direct['change']))+'</strong><span>After minus before</span></div><div class="metric"><span>Change in same-date site-minus-reference difference ('+ef(unit)+')</span><strong>'+ef(interval(paired['change']))+'</strong><span>After minus before on the original paired dates</span></div></div><p><small>'+ef(support)+'</small></p></article>')
    for name,data in native.items():
        if name.endswith('.svg'):
            figures.append('<details><summary>Original native figure '+str(len(figures)+1)+'</summary><p class="muted">Pan horizontally on a phone to read the full-size labels. The source SVG and exact underlying data are included in the downloads.</p><div class="figure-scroll" tabindex="0" aria-label="Original scientific figure">'+data.decode()+'</div><p><button data-download="'+ef(name,quote=True)+'">Save original SVG</button></p></details>')
    all_files={**native,'selection.json':selection,'Original_Outcome_Report_and_Data.zip':retained_zip,'native-result.json':result_path.read_bytes()}
    files={name:{'base64':base64.b64encode(data).decode(),'type':mimetypes.guess_type(name)[0] or 'application/octet-stream','bytes':len(data),'sha256':digest(data)} for name,data in all_files.items()}
    payload=json.dumps({'records':records,'files':files},ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
    downloads=[('Original_Outcome_Report_and_Data.zip','Complete original report and data ZIP'),('outcomes.json','Complete evaluation and source context'),('outcome_rows.csv','Original selected records (CSV)'),('matched_controls.csv','Same-date reference matches (CSV)'),('sampled_dates.csv','Retained sampled dates (CSV)'),('period_summary.csv','Period and monthly comparisons (CSV)'),('selection.json','Editable native selection (JSON)'),('plan.json','Original complete saved laboratory plan (JSON)'),('native-result.json','Original native result and file inventory'),('outcome-figures.json','Original figure specifications')]
    buttons=''.join('<button data-download="'+ef(name,quote=True)+'">'+ef(label)+'</button>' for name,label in downloads)
    page='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eighteenmile 2023 | Monitoring comparison</title><style>'''+CSS+'''</style></head><body><main>
<header><div class="kicker">Eighteenmile Creek and Lake Hartwell · Original monitoring records</div><h1>Eighteenmile 2023 monitoring comparison</h1><p class="lead">An inspectable comparison of the upper lake arm and its same-date reference station, with the original report, source rows and editable selection included.</p>'''+header+'''</header>
<nav aria-label="Reading desk"><button data-tab="overview">Comparison</button><button data-tab="charts">Native figures</button><button data-tab="sources">Source explorer</button><button data-tab="downloads">Files and reopening</button></nav>
<section id="overview" data-tab><h2>What is being compared</h2><p><strong>Before:</strong> '''+period('before')+'''<br><strong>After:</strong> '''+period('after')+'''<br><strong>Study station:</strong> SV-838, Eighteenmile Creek Upper Lake Arm<br><strong>Reference station:</strong> SV-840, Lake Hartwell off Eighteenmile Creek arm</p>
<div class="note"><strong>Read these as historical period contrasts.</strong> This selection has no recorded management event. The periods occupy different calendar months, so a common-month seasonal comparison is unavailable. The matched-date analysis preserves the observed site/reference pairing.</div>
'''+''.join(cards)+'''
<h2>How to read the intervals</h2><p>A single number is the retained point estimate. Square brackets include an endpoint; parentheses exclude it. The intervals preserve reporting-limit bounds from censored measurements. They are not statistical confidence intervals. Each analytical method keeps its own units and sample support.</p><p>For microcystins/nodularin, the study-station change interval includes zero. Its matched-reference contrast uses a different, explicitly paired set of observations. Inspect that pairing before interpreting the difference.</p><div class="print-only"><p><strong>Working files:</strong> Open START_HERE.html for the searchable source rows, full-size native figures, all original report files and the editable selection. The complete application and saved project are provided separately as Eighteenmile_Outcome_Workspace_20261013.zip.</p><p>Native result <code>'''+ef(result['id'])+'''</code></p></div></section>
<section id="charts" data-tab class="hidden"><h2>Original native figures</h2><p>These are the unchanged SVGs generated by the saved native comparison. Every value and reporting-limit endpoint remains attached to the original result.</p>'''+''.join(figures)+'''</section>
<section id="sources" data-tab class="hidden"><h2>Inspect the original selected records</h2><p>Each row opens its complete retained observation, original source pointer and measurement support. Filtering changes this view only.</p><div class="tools"><label>Find a date, station, result or source value<input id="search" type="search" placeholder="Search original selected records"></label><label>Period<select id="period"><option value="">Both periods</option><option value="before">Before</option><option value="after">After</option></select></label><label>Analytical series<select id="series"><option value="">Both series</option>'''+''.join(options)+'''</select></label><button id="clear-filters">Clear filters</button></div><p id="row-count" aria-live="polite"></p><div class="table-scroll" tabindex="0"><table id="rows-table"><thead><tr><th>Date</th><th>Station</th><th>Parameter</th><th>Original result</th><th>Unit</th><th>Method</th><th>Qualifier</th><th>Source</th></tr></thead><tbody id="rows"></tbody></table></div><details id="record-detail"><summary id="row-title">Open a source row</summary><pre id="row-content"></pre></details></section>
<section id="downloads" data-tab class="hidden"><h2>Keep the complete working material</h2><p>This page works offline. The buttons save the retained native bytes directly. The ZIP contains the original full report, both native SVGs, all source tables, the complete saved plan and its original file manifest.</p><div class="downloads">'''+buttons+'''</div><p id="download-status" aria-live="polite"></p><h3>Reopen the editable project</h3><p>Receive the accompanying full Workspace archive with its bundled application. The saved laboratory plan remains revision 2; the separate station/visit plan and all original observations remain present. Open the saved outcome by its original ID, or edit a copy of selection.json and use the included rerun_selection.py with the received application.</p><pre>python rerun_selection.py --application RECEIVED/application --workspace RECEIVED/workspace --selection selection.json</pre><details><summary>Original source identity</summary><pre>'''+ef(json.dumps({'native_result_id':result['id'],'plan':binding,'selection_digest':result['selection_digest'],'report_sha256':digest(native['report.html'])},indent=2))+'''</pre></details></section>
<footer class="foot">Built from the retained 2023 laboratory plan and native outcome result. Original data, analytical methods and source records are preserved in the working package.</footer></main><script id="payload" type="application/json">'''+payload+'''</script><script>'''+JS+'''</script></body></html>'''
    (output/'START_HERE.html').write_text(page,encoding='utf-8')
    rerun='''#!/usr/bin/env python3\n"""Build a new outcome from an explicit editable selection in the received app."""\nimport argparse, json, sys\nfrom pathlib import Path\np=argparse.ArgumentParser(description=__doc__)\np.add_argument('--application',required=True,type=Path)\np.add_argument('--workspace',required=True,type=Path)\np.add_argument('--selection',required=True,type=Path)\na=p.parse_args()\nsys.path.insert(0,str(a.application.resolve()))\nfrom model.implementation_outcomes import build\nselection=json.loads(a.selection.read_text(encoding='utf-8-sig'))\nresult=build(str(a.workspace.resolve()),selection)\nprint(json.dumps(result,ensure_ascii=False,indent=2))\n'''
    (output/'rerun_selection.py').write_text(rerun)
    (output/'README.md').write_text('# Eighteenmile monitoring comparison\n\nOpen START_HERE.html. It contains the comparison, original figures, searchable selected rows and embedded native downloads. Extract Original_Outcome_Report_and_Data.zip to read the unchanged native report in its original directory.\n\nThe independent full Workspace archive contains the original project, all 88 laboratory observations, saved plan revision 2, separate station/visit plan, native comparison and application source. Its outcome ID is '+result['id']+'.\n\nThe prepared selection compares April-June 2023 with July-October 2023. It has no recorded event and no common calendar months. Original reporting-limit intervals and explicit missing-reference dates remain intact.\n\nUse rerun_selection.py only to deliberately calculate a new selection in the received application; the saved outcome is already complete.\n')
    inventory={p.relative_to(output).as_posix():{'bytes':p.stat().st_size,'sha256':digest(p.read_bytes())} for p in sorted(output.rglob('*')) if p.is_file()}
    manifest={'schema':'upstate.implementation-outcome-reading-desk/v1','native_result_id':result['id'],'plan_binding':binding,'selection_digest':result['selection_digest'],'native_members':len(native),'files':inventory}
    (output/'reading-desk.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return manifest


def main() -> None:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--result',required=True,type=Path)
    p.add_argument('--workspace',required=True,type=Path)
    p.add_argument('--output',required=True,type=Path)
    a=p.parse_args()
    print(json.dumps(publish(a.result,a.workspace,a.output),indent=2))

if __name__=='__main__':main()

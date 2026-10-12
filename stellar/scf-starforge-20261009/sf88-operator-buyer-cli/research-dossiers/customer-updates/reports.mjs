// MIT. Complete, deterministic customer report files from the frozen original review.
import {jsonBytes} from '../../node/store.mjs';
import {CUSTOMER_UPDATE_REPORT_SCHEMA,requireCustomerUpdate as need} from './contracts.mjs';
const html=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const md=value=>String(value??'').replace(/[\\`*_{}\[\]<>#+!|]/g,'\\$&').replace(/\r?\n/g,' ');
const pretty=value=>JSON.stringify(value,null,2);
function markdownJson(value){
  const text=pretty(value),longest=Math.max(2,...[...text.matchAll(/`+/g)].map(row=>row[0].length));
  const fence='`'.repeat(longest+1);return [fence+'json',text,fence,''].join('\n');
}
function mdTable(headers,rows){
  return ['| '+headers.map(md).join(' | ')+' |','| '+headers.map(()=> '---').join(' | ')+' |',
    ...rows.map(row=>'| '+row.map(md).join(' | ')+' |'),''].join('\n');
}
function table(headers,rows){
  return '<div class="table"><table><thead><tr>'+headers.map(value=>'<th>'+html(value)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+html(value)+'</td>').join('')+'</tr>').join('')+
    '</tbody></table></div>';
}
export function customerDeliveryReport(delivery,work){
  need(work?.schema==='sf88-research-customer-update-work/v1'&&work.workId===delivery.workId,'CUSTOMER_UPDATE_REPORT_WORK_CHANGED');
  return {schema:CUSTOMER_UPDATE_REPORT_SCHEMA,delivery:structuredClone(delivery),work:structuredClone(work)};
}
function markdown(report){
  const {delivery,work}=report,{context,review}=work,brief=context.brief.definition,request=context.requested.definition;
  const lines=['# '+md(delivery.title),'','Customer: '+md(brief.customer.name),'',
    'Project '+md(work.projectId)+' · delivery '+md(delivery.id)+' · '+delivery.createdAt,'',
    'Prepared by '+md(delivery.actor.name)+' from retained dossier revision '+work.sourceRevision+'.','',
    delivery.coverNote,'','## Summary','',review.summary,'','## Limitations','',review.limitations||'No additional limitation was entered.','',
    '## Customer brief','',brief.purpose,'','Responsible operator: '+md(brief.owner.name),'',
    'Protocol: '+md(brief.protocol.title)+' · '+md(brief.protocol.version)+' · '+md(brief.protocol.source),'',
    brief.protocol.notes,'',mdTable(['Question ID','Agreed question'],context.questions.map(row=>[row.id,row.text])),
    'Commercial scope is the retained brief text: '+md([brief.scope.amount,brief.scope.currency,brief.scope.unit].filter(Boolean).join(' '))+'.','',
    brief.scope.note,'','Scope reference: '+md(brief.scope.reference),'',
    'Update policy: '+md(brief.updatePolicy),'','## Requested edition','',
    md(request.kind)+' · '+md(request.label)+' · requested by '+md(request.request.by.name)+' on '+request.request.receivedAt+'.','',
    request.request.note,'','Request reference: '+md(request.request.reference),'',request.instructions,'',
    mdTable(['Source plan','Field','From, literal','Until, literal','Period note'],
      request.periods.map(row=>[row.planId,row.field,row.from,row.until,row.notes])),'## Sources and original query',''];
  for(const plan of brief.sourcePlans)lines.push('### '+md(plan.name),'','Provider: '+md(plan.provider)+' · question '+md(plan.questionId),'',
    plan.query,'','Source terms: '+md(plan.terms),'','Constraints: '+md(plan.constraints),'',
    'Original parameters and handles:','',markdownJson({parameters:plan.parameters,original:plan.original}));
  lines.push('## Intake and complete source changes','',
    mdTable(['Unit','Count'],Object.entries(context.inventory.counts)),mdTable(['Comparison','Count'],Object.entries(context.comparison.counts)),
    context.baseline?'Previous delivery '+md(context.baseline.previousDeliveryId)+'; source review '+md(context.baseline.workId)+'.':
      'This requested edition has no prior delivery baseline.','',
    mdTable(['Source','Change','Original before occurrences','Original after occurrences','Recorded disposition'],
      context.comparison.rows.map(row=>[row.title,row.status,row.before?.occurrenceCount??0,row.after?.occurrenceCount??0,
        review.changeDecisions.find(item=>item.sourceId===row.id)?.disposition??(row.status==='UNCHANGED'?'unchanged':'not reviewed')])),
    '### Exact source editions','',mdTable(['Edition','Question','Provider','Mode','SHA-256 / original reference','Projection'],
      context.inventory.editions.map(row=>[row.id,row.questionId,row.provider,row.mode,row.raw?.sha256??pretty(row.reference),row.projection.status])),
    '### Intake provenance','',markdownJson(context.intakes));
  if(context.uncoveredPlans.length)lines.push('### Source plans without selected intake','',
    mdTable(['Plan','Provider','Query'],context.uncoveredPlans.map(row=>[row.name,row.provider,row.query])));
  lines.push('## Original analysis selections','',
    'Each selection below is the complete original native dossier record at the retained source revision.','');
  for(const record of context.nativeRecords)lines.push('### '+md(record.label||record.kind),'',
    'Original path '+md(record.path)+' · SHA-256 '+record.sha256+'.','',markdownJson(record.record));
  lines.push('## Acceptance against the agreed outputs','',mdTable(['Output','Expected result','Recorded status','Operator note'],
    brief.outputs.map(output=>{const answer=review.acceptance.find(row=>row.outputId===output.id);
      return [output.label,output.acceptance,answer?.status??'not_reviewed',answer?.note??''];})),
    '## Change-review reasons','',mdTable(['Source ID','Disposition','Reason'],
      review.changeDecisions.map(row=>[row.sourceId,row.disposition,row.reason])),
    '## Operator and delivery notes','',review.note,'',delivery.deliveryNote,'',
    '## Complete source and receiving','',
    'The JSON report contains the complete frozen context, every selected source occurrence, all original handles and full selected analysis records. '+
    'The accompanying original portable dossier retains every source body, immutable revision and customer-update file. '+
    'Receive that same portable dossier to continue this project and request a later edition.','',
    'Work snapshot '+work.workId+'; original dossier '+work.dossierId+'; context SHA-256 '+context.fingerprint+'.','');
  if(context.agreements?.length)lines.push('## Recorded scope responses','',markdownJson(context.agreements));
  return lines.join('\n');
}
function htmlReport(report){
  const {delivery,work}=report,{context,review}=work,brief=context.brief.definition,request=context.requested.definition;
  const prose=value=>'<div class="prose">'+html(value)+'</div>';
  const details=(label,value,open=false)=>'<details'+(open?' open':'')+'><summary>'+html(label)+'</summary><pre>'+html(pretty(value))+'</pre></details>';
  const plans=brief.sourcePlans.map(plan=>'<article><h3>'+html(plan.name)+'</h3><p>'+html(plan.provider)+' · '+html(plan.questionId)+'</p>'+
    prose(plan.query)+'<p>Source terms: '+html(plan.terms)+'</p>'+prose(plan.constraints)+details('Exact query parameters and original handles',{parameters:plan.parameters,original:plan.original})+'</article>').join('');
  const selected=context.nativeRecords.map(row=>'<article><h3>'+html(row.label||row.kind)+'</h3><p class="identity">'+html(row.path)+' · '+html(row.sha256)+'</p>'+
    details('Complete original selected record',row.record,true)+'</article>').join('');
  const content='<header><p>Research customer delivery</p><h1>'+html(delivery.title)+'</h1><p>'+html(brief.customer.name)+' · '+html(delivery.createdAt)+'</p>'+
    '<p class="identity">'+html(work.projectId)+' / '+html(delivery.id)+'</p>'+prose(delivery.coverNote)+'</header>'+
    '<section><h2>Summary</h2>'+prose(review.summary)+'<h2>Limitations</h2>'+prose(review.limitations||'No additional limitation was entered.')+'</section>'+
    '<section><h2>Customer brief</h2>'+prose(brief.purpose)+'<p>Responsible operator: '+html(brief.owner.name)+'</p>'+
    '<p>Protocol: '+html(brief.protocol.title)+' · '+html(brief.protocol.version)+' · '+html(brief.protocol.source)+'</p>'+prose(brief.protocol.notes)+
    table(['Question','Retained question text'],context.questions.map(row=>[row.id,row.text]))+
    '<p>Retained scope: '+html([brief.scope.amount,brief.scope.currency,brief.scope.unit].filter(Boolean).join(' '))+'</p>'+prose(brief.scope.note)+
    '<p>'+html(brief.scope.reference)+'</p><h3>Update policy</h3>'+prose(brief.updatePolicy)+
    (context.agreements?.length?details('Recorded scope responses',context.agreements):'')+'</section>'+
    '<section><h2>Requested edition</h2><p>'+html(request.kind)+' · '+html(request.label)+' · '+html(request.request.by.name)+' · '+html(request.request.receivedAt)+'</p>'+
    prose(request.request.note)+'<p>'+html(request.request.reference)+'</p>'+prose(request.instructions)+
    table(['Source plan','Field','From, literal','Until, literal','Note'],request.periods.map(row=>[row.planId,row.field,row.from,row.until,row.notes]))+'</section>'+
    '<section><h2>Sources and original query</h2>'+plans+'</section>'+
    '<section><h2>Source changes</h2>'+table(['Unit','Count'],Object.entries(context.inventory.counts))+
    table(['Change','Count'],Object.entries(context.comparison.counts))+
    (context.baseline?'<p>Baseline: '+html(context.baseline.previousDeliveryId)+' · '+html(context.baseline.workId)+'</p>':'<p>Initial delivery baseline.</p>')+
    table(['Source','Change','Before occurrences','After occurrences','Review'],
      context.comparison.rows.map(row=>[row.title,row.status,row.before?.occurrenceCount??0,row.after?.occurrenceCount??0,
        review.changeDecisions.find(item=>item.sourceId===row.id)?.disposition??(row.status==='UNCHANGED'?'unchanged':'not reviewed')]))+
    '<h3>Exact source editions</h3>'+table(['Edition','Question','Provider','Mode','SHA-256 or original handle','Projection'],
      context.inventory.editions.map(row=>[row.id,row.questionId,row.provider,row.mode,row.raw?.sha256??pretty(row.reference),row.projection.status]))+
    details('Full intake provenance',context.intakes)+details('Complete source occurrences and change context',context.inventory)+
    (context.uncoveredPlans.length?details('Source plans without selected intake',context.uncoveredPlans,true):'')+'</section>'+
    '<section><h2>Original analysis selections</h2>'+selected+'</section>'+
    '<section><h2>Acceptance against agreed outputs</h2>'+table(['Output','Expected result','Recorded status','Note'],
      brief.outputs.map(output=>{const answer=review.acceptance.find(row=>row.outputId===output.id);
        return [output.label,output.acceptance,answer?.status??'not_reviewed',answer?.note??''];}))+
    '<h3>Change-review reasons</h3>'+table(['Source','Disposition','Reason'],review.changeDecisions.map(row=>[row.sourceId,row.disposition,row.reason]))+'</section>'+
    '<section><h2>Operator and delivery notes</h2>'+prose(review.note)+prose(delivery.deliveryNote)+'</section>'+
    '<footer><h2>Complete editable receiving</h2><p>The accompanying original portable dossier retains every source body, immutable revision and customer-update file. '+
    'Receive it into the original Research workspace to continue the same project, record corrections and request its next edition.</p>'+
    '<p class="identity">Work '+html(work.workId)+' · dossier '+html(work.dossierId)+' · source revision '+work.sourceRevision+' · context '+html(context.fingerprint)+'</p></footer>';
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+html(delivery.title)+'</title><style>html{color:#171717;background:#fff;font:15px/1.5 system-ui,sans-serif}body{max-width:1120px;margin:40px auto;padding:0 24px}h1{font-size:30px}h2{font-size:23px;margin-top:32px}h3{font-size:18px}.prose{white-space:pre-wrap;margin:12px 0;overflow-wrap:anywhere}.identity{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.table{overflow:auto}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace;border:1px solid #ccc;padding:12px}summary{cursor:pointer;padding:8px 0}article,section{margin-bottom:24px}footer{border-top:1px solid #999;padding-top:16px}@media print{body{margin:0;max-width:none}details{display:block}details>pre{display:block}.table{overflow:visible}h2,h3{break-after:avoid}}</style>'+
    '<body>'+content+'</body></html>\n';
}
function csv(report){
  const rows=[['section','id','value_json']],add=(section,id,value)=>rows.push([section,id,JSON.stringify(value)]);
  const {delivery,work}=report,context=work.context;
  add('schema','report',report.schema);add('delivery',delivery.id,delivery);
  add('work',work.workId,Object.fromEntries(Object.entries(work).filter(([key])=>key!=='context'&&key!=='review')));
  for(const key of ['schema','dossierId','revision','revisionSha256','project','brief','requested','selection','baseline','uncoveredPlans','currentBriefId','fingerprint','agreements'])
    if(Object.hasOwn(context,key))add('context',key,context[key]);
  for(const row of context.questions)add('question',row.id,row);
  for(const row of context.intakes)add('intake',row.id,row);
  add('inventory','counts',context.inventory.counts);
  for(const row of context.inventory.editions)add('edition',row.id,row);
  for(const row of context.inventory.sources)add('source',row.id,row);
  add('comparison','counts',context.comparison.counts);
  for(const row of context.comparison.rows)add('comparison',row.id,row);
  for(const row of context.nativeRecords)add('native-record',row.path,row);
  add('review',work.workId,work.review);
  return rows.map(row=>row.map(value=>'"'+String(value).replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';
}
// The v1 renderer is part of the retained file contract. A future incompatible
// document renderer must introduce a new report version while keeping this one.
export function customerDeliveryBodies(delivery,work){
  const report=customerDeliveryReport(delivery,work);
  return [
    {format:'json',contentType:'application/json; charset=utf-8',body:jsonBytes(report)},
    {format:'md',contentType:'text/markdown; charset=utf-8',body:Buffer.from(markdown(report),'utf8')},
    {format:'html',contentType:'text/html; charset=utf-8',body:Buffer.from(htmlReport(report),'utf8')},
    {format:'csv',contentType:'text/csv; charset=utf-8',body:Buffer.from(csv(report),'utf8')},
  ].map(file=>({...file,name:delivery.id+'.'+file.format}));
}

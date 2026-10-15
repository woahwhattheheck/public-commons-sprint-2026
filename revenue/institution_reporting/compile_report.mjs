// Generic institution reporting from complete native mapped views. No network or financial advice.
export function compileInstitutionReport(input, runtime) {
  const need=(v,m)=>{if(!v)throw new Error(m);};
  const text=(v,k)=>{need(typeof v==='string'&&v.length>0&&v.length<=1000,'Invalid '+k);return v;};
  const list=(a,k,max)=>{need(Array.isArray(a)&&a.length>0&&a.length<=max,'Invalid '+k);return a;};
  const unique=(a,key,k)=>{const m=new Map();for(const x of a){const id=text(key(x),k);need(!m.has(id),'Duplicate '+k+': '+id);m.set(id,x);}return m;};
  need(input?.schema==='commons.institution-report-input.v1','Unknown report input');
  need(typeof runtime?.sha256==='function','Supply UTF-8 SHA256 function');
  const MAX=1000000000000000000000000000000000000000000000000000000000000n;
  const gcd=(a,b)=>{a=a<0n?-a:a;b=b<0n?-b:b;while(b){const t=a%b;a=b;b=t;}return a||1n;};
  const rat=(n,d=1n)=>{need(d!==0n,'Zero internal denominator');if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return{n:n/g,d:d/g};};
  const dec=s=>{need(typeof s==='string'&&/^[+-]?\d{1,40}(?:\.\d{1,20})?$/.test(s),'Use an exact decimal string');const neg=s[0]==='-';s=s.replace(/^[+-]/,'');const [a,b='']=s.split('.');const n=BigInt(a+b)*(neg?-1n:1n);need(n<MAX&&n>-MAX,'Decimal magnitude exceeded');return rat(n,10n**BigInt(b.length));};
  const add=(a,b)=>rat(a.n*b.d+b.n*a.d,a.d*b.d), sub=(a,b)=>rat(a.n*b.d-b.n*a.d,a.d*b.d);
  const mul=(a,b)=>rat(a.n*b.n,a.d*b.d), div=(a,b)=>rat(a.n*b.d,a.d*b.n);
  const cmp=(a,b)=>a.n*b.d<b.n*a.d?-1:a.n*b.d>b.n*a.d?1:0;
  const format=(a,places)=>{need(Number.isInteger(places)&&places>=0&&places<=12,'Invalid decimal places');const scale=10n**BigInt(places),sign=a.n<0n?-1n:1n,n=a.n*sign*scale;let q=n/a.d;const r=n%a.d;if(r*2n>=a.d)q++;let s=q.toString().padStart(places+1,'0');if(places)s=s.slice(0,-places)+'.'+s.slice(-places);return(sign<0n&&q!==0n?'-':'')+s;};
  const exact=a=>({numerator:a.n.toString(),denominator:a.d.toString()});
  const quarter=p=>{need(typeof p==='string'&&/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(p),'Calendar quarter end required: '+p);return{year:Number(p.slice(0,4)),q:['03-31','06-30','09-30','12-31'].indexOf(p.slice(5))+1};};
  const periods=list(input.periods,'display periods',8);periods.forEach(quarter);need(new Set(periods).size===periods.length,'Duplicate display period');
  need(periods.every((p,i)=>!i||p>periods[i-1]),'Display periods must increase');
  const layout=input.reportLayout??'three_sections';
  need(['three_sections','four_sections'].includes(layout),'Unknown report layout');
  const pairs=input.comparisonPairs===undefined?[]:list(input.comparisonPairs,'explicit period pairs',28);
  unique(pairs,x=>x.id,'period pair id');
  const pairKeys=new Set();
  for(const p of pairs){
    text(p.label,'period pair label');
    need(periods.includes(p.from)&&periods.includes(p.to)&&p.from<p.to,'Comparison endpoints must be increasing displayed periods');
    const key=p.from+'|'+p.to;need(!pairKeys.has(key),'Duplicate comparison endpoints');pairKeys.add(key);
  }
  need(layout!=='four_sections'||pairs.length>0,'Four sections require explicit period pairs');
  const entities=unique(list(input.institutions,'institutions',50),x=>x.id,'institution');
  for(const x of entities.values()){text(x.name,'institution name');need(['bank','credit_union'].includes(x.family),'Select bank or credit_union');}
  need(new Set([...entities.values()].map(x=>x.family)).size===1,'One source family per report');
  const measures=unique(list(input.measures,'measures',20),x=>x.id,'measure');
  
  for(const p of pairs)if(p.measureIds!==undefined){
    list(p.measureIds,'comparison measures',20);
    need(new Set(p.measureIds).size===p.measureIds.length&&p.measureIds.every(id=>measures.has(id)),'Unknown/duplicate comparison measure');
  }
  if(input.review?.findings!==undefined){
    need(Array.isArray(input.review.findings)&&input.review.findings.length<=1000,'Invalid review findings');
    unique(input.review.findings,x=>x.id,'review finding');
    for(const f of input.review.findings){
      need(typeof f.finding==='string'&&f.finding.length>0&&f.finding.length<=4000,'Write the recorded finding');
      for(const k of ['entity','period','measure','sourceReference','action','owner','status','reviewer','reviewedAt'])
        need(f[k]===undefined||f[k]===null||typeof f[k]==='string'&&f[k].length<=(k==='action'?4000:1000),'Invalid finding '+k);
      need(!f.entity||entities.has(f.entity),'Finding institution must be selected');
      need(!f.period||periods.includes(f.period),'Finding period must be selected');
      need(!f.measure||measures.has(f.measure),'Finding measure must be selected');
      need(!f.status||['proposed','open','in_progress','resolved','accepted','rejected'].includes(f.status),'Unknown recorded finding status');
    }
  }
  for(const m of measures.values()){
    text(m.label,'measure label');text(m.unit,'measure unit');need(Number.isInteger(m.decimals)&&m.decimals>=0&&m.decimals<=12,'Set measure decimals');
    need(['reported','quarter_from_ytd','ratio'].includes(m.operation),'Unknown measure operation');
    need(['mean','median','ratio_of_sums'].includes(m.peerStatistic),'Choose peer statistic');
    need(['higher','lower','none'].includes(m.rankDirection),'Choose rank direction');
    need(['compatible','same_calendar_quarter','display_only'].includes(m.comparisonPolicy),'Choose period comparison policy');text(m.comparisonNote,'period comparison definition');
    if(m.operation==='reported'&&m.sourceBasis==='year_to_date')need(m.comparisonPolicy!=='compatible','Reported YTD requires same-calendar-quarter or display-only comparison');
    if(m.operation==='ratio'){text(m.numerator,'ratio numerator');text(m.denominator,'ratio denominator');dec(m.multiplier);need(measures.has(m.numerator)&&measures.has(m.denominator),'Ratio operands must be selected measures');}
    else{text(m.sourceMetric,'source metric');text(m.sourceDefinitionGroup,'approved source definition group');need(['instant','quarter','year_to_date','annualized','provider_defined'].includes(m.sourceBasis),'Explicit native source basis required');if(m.operation==='quarter_from_ytd')need(m.sourceBasis==='year_to_date','Quarter derivation requires YTD');}
    if(m.peerStatistic==='ratio_of_sums')need(m.operation==='ratio','Ratio-of-sums requires explicit ratio operands');
  }
  const subjects=list(input.subjectIds,'subjects',50);need(new Set(subjects).size===subjects.length&&subjects.every(x=>entities.has(x)),'Unknown/duplicate subject');
  const cohorts=unique(list(input.cohorts,'cohorts',50),x=>x.subjectId,'cohort subject');
  need(cohorts.size===subjects.length&&subjects.every(x=>cohorts.has(x)),'One explicit cohort per subject');
  for(const [id,k] of cohorts){
    text(k.id,'cohort id');text(k.definition,'cohort definition');text(k.approvedBy,'cohort approver');text(k.approvedAt,'cohort approval');
    need(typeof k.includeSubject==='boolean','Explicit subject inclusion');
    list(k.memberIds,'cohort members',50);need(new Set(k.memberIds).size===k.memberIds.length&&k.memberIds.every(x=>entities.has(x)),'Invalid cohort members');
    need(k.memberIds.includes(id)===k.includeSubject,'Cohort membership conflicts with subject inclusion');
  }
  const sources=unique(list(input.originals,'complete source originals',32),x=>x.sha256,'source hash');
  for(const [hash,s]of sources){need(/^[0-9a-f]{64}$/.test(hash)&&typeof s.text==='string','Original UTF-8 source required');need(runtime.sha256(s.text)===hash,'Original source hash mismatch');text(s.filename,'source filename');}
  const views=list(input.views,'complete mapped views',64),seenViews=new Set(),observations=[];
  for(const document of views){
    need(document&&typeof document.text==='string'&&/^[0-9a-f]{64}$/.test(document.sha256),'Complete exact native view document required');
    need(runtime.sha256(document.text)===document.sha256,'Complete native view object hash mismatch');
    const v=JSON.parse(document.text);
    need(v.schema==='commons.bankregdata-view.v1'&&sources.has(v.source_sha256),'Complete source-bound native view required');
    need(Array.isArray(v.observations)&&v.observation_count===v.observations.length&&v.observations.length<=250000,'Complete native observation body required');
    const vh=document.sha256;need(!seenViews.has(vh),'Duplicate complete view');seenViews.add(vh);
    for(const o of v.observations){
      need(o.source?.sha256===v.source_sha256,'Observation source differs from complete view');
      observations.push({viewHash:vh,o});
    }
  }
  const selections=list(input.sourceSelections,'source selections',320),selected=new Map();
  for(const s of selections){
    text(s.metric,'selected source metric');quarter(s.period);need(sources.has(s.sourceSha256),'Selected original missing');
    text(s.tableId,'selected table');text(s.definitionId,'source definition');text(s.compatibility?.group,'source compatibility group');text(s.compatibility?.approvedBy,'compatibility approver');text(s.compatibility?.approvedAt,'compatibility approval');text(s.compatibility?.note,'compatibility definition');const key=JSON.stringify([s.metric,s.period]);need(!selected.has(key),'Duplicate source selection');selected.set(key,s);
  }
  const index=new Map();
  for(const item of observations){
    const o=item.o,key=JSON.stringify([o.metric,o.period]),s=selected.get(key);
    if(!s||o.source.sha256!==s.sourceSha256||o.source.table_id!==s.tableId||!entities.has(o.entity))continue;
    const k=JSON.stringify([o.entity,o.period,o.metric]);need(!index.has(k),'Ambiguous selected observation: '+k);index.set(k,item);
  }
  const cache=new Map(),active=new Set(),exceptions=[];
  const missing=(reason,traces=[])=>({status:'unavailable',reason,traces});
  const reported=(entity,period,m)=>{
    const selection=selected.get(JSON.stringify([m.sourceMetric,period]));
    if(!selection)return missing('No approved source edition for '+m.sourceMetric+' '+period);
    const item=index.get(JSON.stringify([entity,period,m.sourceMetric]));
    if(!item)return missing('Selected source has no observation');
    const o=item.o,trace={viewHash:item.viewHash,entity,period,metric:o.metric,raw:o.raw,source:o.source,status:o.status,basis:o.basis,unit:o.unit,normalized_unit:o.normalized_unit,normalized_value:o.normalized_value,scale:o.scale,zero_policy:o.zero_policy,definitionId:selection.definitionId,compatibility:selection.compatibility};
    if(selection.compatibility.group!==m.sourceDefinitionGroup)return missing('Source definition is outside the approved compatibility group',[trace]);
    if(o.basis!==m.sourceBasis)return missing('Source time basis differs from approved measure',[trace]);
    if(o.normalized_unit!==m.unit)return missing('Normalized unit differs from approved measure',[trace]);
    if(o.comparable!==true||!['reported','reported_zero'].includes(o.status)||o.normalized_value===null)return missing('Native source value is not comparable: '+o.status,[trace]);
    return{status:'available',value:dec(o.normalized_value),traces:[trace]};
  };
  const value=(entity,period,id)=>{
    const key=JSON.stringify([entity,period,id]);if(cache.has(key))return cache.get(key);
    need(!active.has(key),'Cyclic report formula');active.add(key);const m=measures.get(id);need(m,'Unknown measure operand');let v;
    if(m.operation==='reported')v=reported(entity,period,m);
    else if(m.operation==='quarter_from_ytd'){
      const now=reported(entity,period,m),q=quarter(period);
      if(q.q===1)v={...now,derivation:{operation:'first_quarter_from_ytd',period}};
      else{
        const previous=q.year+'-'+['03-31','06-30','09-30'][q.q-2],before=reported(entity,previous,m),traces=[...now.traces,...before.traces];
        v=now.status==='available'&&before.status==='available'?{status:'available',value:sub(now.value,before.value),traces,derivation:{operation:'current_ytd_minus_previous_ytd',current:period,previous}}:missing('Quarter unavailable: '+[now,before].filter(x=>x.status!=='available').map(x=>x.reason).join('; '),traces);
      }
    }else{
      const n=value(entity,period,m.numerator),d=value(entity,period,m.denominator),traces=[...n.traces,...d.traces];
      if(n.status!=='available'||d.status!=='available')v=missing('Ratio operand unavailable',traces);
      else if(d.value.n<=0n)v=missing('Ratio denominator must be positive',traces);
      else v={status:'available',value:mul(div(n.value,d.value),dec(m.multiplier)),traces,derivation:{operation:'ratio',numerator:m.numerator,denominator:m.denominator,multiplier:m.multiplier},operands:{numerator:n.value,denominator:d.value}};
    }
    active.delete(key);cache.set(key,v);return v;
  };
  const publicValue=(v,m)=>v.status==='available'?{status:v.status,display:format(v.value,m.decimals),exact:exact(v.value),unit:m.unit,derivation:v.derivation??null,traces:v.traces}:{status:v.status,reason:v.reason,unit:m.unit,traces:v.traces};
  const institutionRows=[];
  for(const entity of entities.keys())for(const period of periods)for(const [id,m]of measures){
    const v=value(entity,period,id);institutionRows.push({entity,period,measure:id,...publicValue(v,m)});
    if(v.status!=='available')exceptions.push({entity,period,measure:id,reason:v.reason});
  }
  const peerRows=[];
  for(const subject of subjects)for(let pi=0;pi<periods.length;pi++)for(const [id,m]of measures){
    const period=periods[pi],cohort=cohorts.get(subject),subjectValue=value(subject,period,id);
    const available=cohort.memberIds.map(entity=>({entity,v:value(entity,period,id)})).filter(x=>x.v.status==='available');
    let statistic=null,reason=null;
    if(!available.length)reason='No comparable cohort observations';
    else if(m.peerStatistic==='mean')statistic=div(available.reduce((s,x)=>add(s,x.v.value),rat(0n)),rat(BigInt(available.length)));
    else if(m.peerStatistic==='median'){
      const a=available.map(x=>x.v.value).sort(cmp),mid=Math.floor(a.length/2);statistic=a.length%2?a[mid]:div(add(a[mid-1],a[mid]),rat(2n));
    }else{
      const n=available.reduce((s,x)=>add(s,x.v.operands.numerator),rat(0n)),d=available.reduce((s,x)=>add(s,x.v.operands.denominator),rat(0n));
      if(d.n<=0n)reason='Cohort denominator must be positive';else statistic=mul(div(n,d),dec(m.multiplier));
    }
    let rank=null;
    if(m.rankDirection!=='none'&&subjectValue.status==='available'&&cohort.includeSubject){
      const better=available.filter(x=>m.rankDirection==='higher'?cmp(x.v.value,subjectValue.value)>0:cmp(x.v.value,subjectValue.value)<0).length;
      rank={position:better+1,tied:available.filter(x=>cmp(x.v.value,subjectValue.value)===0).length,of:available.length,method:'competition',direction:m.rankDirection};
    }
    let change=null;
    if(pi>0){
      const before=value(subject,periods[pi-1],id);
      if(m.comparisonPolicy==='display_only'||(m.comparisonPolicy==='same_calendar_quarter'&&quarter(period).q!==quarter(periods[pi-1]).q))change={from:periods[pi-1],unavailable:'Period definitions do not permit this comparison'};
      else if(subjectValue.status==='available'&&before.status==='available'){
        const delta=sub(subjectValue.value,before.value);change={from:periods[pi-1],absolute:format(delta,m.decimals),unit:m.unit==='percent'?'percentage_points':m.unit,relativePercent:before.value.n>0n?format(mul(div(delta,before.value),rat(100n)),2):null,relativeReason:before.value.n>0n?null:'Baseline must be positive'};
      }else change={from:periods[pi-1],unavailable:'One or both selected period values unavailable'};
    }
    peerRows.push({subject,period,measure:id,cohortId:cohort.id,cohortDefinition:cohort.definition,memberIds:cohort.memberIds,includesSubject:cohort.includeSubject,eligibleCount:cohort.memberIds.length,observedCount:available.length,missingIds:cohort.memberIds.filter(x=>!available.some(a=>a.entity===x)),method:m.peerStatistic,statistic:statistic?{display:format(statistic,m.decimals),exact:exact(statistic),unit:m.unit}:null,reason,subjectValue:publicValue(subjectValue,m),rank,change});
  }
  const periodRows=[];
  const compactValue=(v,m)=>{const p=publicValue(v,m);delete p.traces;return p;};
  for(const subject of subjects)for(const pair of pairs)for(const [id,m] of measures){
    if(pair.measureIds&&!pair.measureIds.includes(id))continue;
    const before=value(subject,pair.from,id),after=value(subject,pair.to,id);
    let change;
    if(m.comparisonPolicy==='display_only'||(m.comparisonPolicy==='same_calendar_quarter'&&quarter(pair.from).q!==quarter(pair.to).q)){
      change={status:'unavailable',reason:'Period definitions do not permit this comparison'};
    }else if(before.status!=='available'||after.status!=='available'){
      change={status:'unavailable',reason:'One or both selected period values unavailable'};
    }else{
      const delta=sub(after.value,before.value),relative=before.value.n>0n?mul(div(delta,before.value),rat(100n)):null;
      change={status:'available',absolute:format(delta,m.decimals),absoluteExact:exact(delta),unit:m.unit==='percent'?'percentage_points':m.unit,
        relativePercent:relative?format(relative,2):null,relativeExact:relative?exact(relative):null,relativeReason:relative?null:'Baseline must be positive'};
    }
    periodRows.push({subject,measure:id,comparisonId:pair.id,label:pair.label,from:pair.from,to:pair.to,
      comparisonPolicy:m.comparisonPolicy,comparisonNote:m.comparisonNote,
      fromValue:compactValue(before,m),toValue:compactValue(after,m),change,
      sourceRows:[{entity:subject,period:pair.from,measure:id},{entity:subject,period:pair.to,measure:id}]});
  }
  const selectionHash=runtime.sha256(JSON.stringify(input)),output={schema:'commons.institution-report.v1',selectionHash,title:text(input.title,'report title'),periods,institutions:[...entities.values()],measures:[...measures.values()],cohorts:[...cohorts.values()],institutionRows,peerRows,exceptions,sourceCoverage:input.sourceSelections.map(s=>({...s,originalFilename:sources.get(s.sourceSha256).filename,selectedObservationCount:[...index.values()].filter(x=>x.o.metric===s.metric&&x.o.period===s.period&&x.o.source.sha256===s.sourceSha256&&x.o.source.table_id===s.tableId).length})),review:input.review??{reviewer:null,reviewedAt:null,corrections:[]},rounding:'Exact rational arithmetic; display rounds half away from zero; no intermediate rounding'};
  if(input.reportLayout!==undefined)output.reportLayout=layout;
  if(pairs.length){output.comparisonPairs=pairs;output.periodRows=periodRows;}
  return JSON.parse(JSON.stringify(output));
}
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reportHtml(report){
  if(report.reportLayout==='four_sections')return fourSectionReportHtml(report);
  const e=escapeHtml,table=(heads,rows)=>'<div class="table-scroll" tabindex="0"><table><thead><tr>'+heads.map(h=>'<th>'+e(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+e(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  const names=new Map(report.institutions.map(x=>[x.id,x.name])),labels=new Map(report.measures.map(x=>[x.id,x.label]));
  const definitions=table(['Measure','Operation / operands','Unit','Comparison policy','Definition group'],report.measures.map(m=>[m.label,m.operation==='ratio'?m.numerator+' / '+m.denominator+' × '+m.multiplier:m.operation+' ('+m.sourceMetric+', '+m.sourceBasis+')',m.unit,m.comparisonPolicy+': '+m.comparisonNote,m.sourceDefinitionGroup??'From operands']));
  const cohortTable=table(['Subject','Cohort','Included institutions','Subject included','Approved by / at'],report.cohorts.map(k=>[names.get(k.subjectId),k.definition,k.memberIds.map(id=>names.get(id)).join('; '),k.includeSubject?'Yes':'No',k.approvedBy+' / '+k.approvedAt]));
  const profiles=table(['Institution','Period','Measure','Value','Unit','Interpretation / source'],report.institutionRows.map(x=>[names.get(x.entity),x.period,labels.get(x.measure),x.display??'Unavailable',x.unit,x.reason??(x.derivation?JSON.stringify(x.derivation):'Reported')]));
  const peers=table(['Subject','Period','Measure','Statistic','Method','Observed / eligible','Rank','Change'],report.peerRows.map(x=>[names.get(x.subject),x.period,labels.get(x.measure),x.statistic?.display??'Unavailable',x.method,x.observedCount+' / '+x.eligibleCount,x.rank?x.rank.position+' of '+x.rank.of+'; tied '+x.rank.tied:'—',x.change?x.change.absolute!==undefined?x.change.absolute+' '+x.change.unit+(x.change.relativePercent!==null?'; '+x.change.relativePercent+'% relative':''):'Unavailable':'—']));
  const coverage=table(['Metric','Period','Source file','SHA256','Table','Definition / compatibility','Approval','Selected observations'],report.sourceCoverage.map(x=>[x.metric,x.period,x.originalFilename,x.sourceSha256,x.tableId,x.definitionId+' / '+x.compatibility.group,x.compatibility.approvedBy+' / '+x.compatibility.approvedAt,x.selectedObservationCount]));
  const exceptions=table(['Institution','Period','Measure','Issue'],report.exceptions.map(x=>[names.get(x.entity),x.period,labels.get(x.measure),x.reason]));
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+e(report.title)+'</title><style>body{font:15px system-ui,sans-serif;color:#161616;background:#fff;margin:32px;line-height:1.5}h1{font-size:26px}h2{font-size:20px;margin-top:36px}table{border-collapse:collapse;width:100%;min-width:760px;font-size:13px}.table-scroll{overflow-x:auto;max-width:100%;margin:16px 0}nav{display:flex;gap:16px;flex-wrap:wrap}a{color:inherit;text-decoration:underline}a:focus-visible,.table-scroll:focus-visible{outline:2px solid #333;outline-offset:3px}@media(max-width:600px){body{margin:16px}}th,td{text-align:left;vertical-align:top;border:1px solid #b7b7b7;padding:8px;overflow-wrap:anywhere}th{background:#eee}code{overflow-wrap:anywhere}small{color:#444}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{overflow-wrap:anywhere}@media print{body{margin:12mm}thead{display:table-header-group}tr{break-inside:avoid}.table-scroll{overflow:visible}table{min-width:0}}</style></head><body><h1>'+e(report.title)+'</h1><nav aria-label="Report downloads"><a href="input.json" download>Complete input</a><a href="report.json" download>Report JSON</a><a href="observations.csv" download>Observation CSV</a><a href="manifest.json" download>File manifest</a></nav><p>Periods: '+report.periods.map(e).join(', ')+'</p><p>'+e(report.rounding)+'</p><h2>1. Institution results</h2>'+definitions+profiles+'<h2>2. Peer and period comparisons</h2>'+cohortTable+peers+'<p>Rank uses explicit cohort membership and competition ranking. Subject rank is shown only when that subject is included. Each cohort definition and full source traces are preserved in the accompanying JSON.</p><h2>3. Source coverage and review</h2>'+coverage+exceptions+'<h3>Review record</h3><pre>'+e(JSON.stringify(report.review,null,2))+'</pre><small>Selection SHA256: <code>'+e(report.selectionHash)+'</code>. Preserve the complete input and report JSON alongside this readable output.</small></body></html>\n';
}
export function reportCsv(report){
  const q=x=>{let s=String(x??'');if(/^[\u0000-\u0020]*[=+@-]/.test(s)&&!/^[-+]?\d+(?:\.\d+)?$/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const rows=[['entity','period','measure','value','unit','status','reason','exact_numerator','exact_denominator','source_traces_json'],...report.institutionRows.map(x=>[x.entity,x.period,x.measure,x.display,x.unit,x.status,x.reason,x.exact?.numerator,x.exact?.denominator,JSON.stringify(x.traces)])];
  return rows.map(r=>r.map(q).join(',')).join('\r\n')+'\r\n';
}

function fourSectionReportHtml(report){
  const e=escapeHtml,table=(heads,rows)=>'<div class="table-scroll" tabindex="0"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+e(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+e(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  const names=new Map(report.institutions.map(x=>[x.id,x.name])),labels=new Map(report.measures.map(x=>[x.id,x.label]));
  const definitions=table(['Measure','Operation / operands','Unit','Period policy','Definition group'],report.measures.map(m=>[m.label,m.operation==='ratio'?m.numerator+' / '+m.denominator+' × '+m.multiplier:m.operation+' ('+m.sourceMetric+', '+m.sourceBasis+')',m.unit,m.comparisonPolicy+': '+m.comparisonNote,m.sourceDefinitionGroup??'From operands']));
  const subjects=new Set(report.cohorts.map(x=>x.subjectId));
  const profiles=report.institutions.map(i=>'<details data-subject="'+(subjects.has(i.id)?'true':'false')+'"'+(subjects.has(i.id)?' open':'')+'><summary>'+e(i.name)+' — '+report.periods.length+' periods, '+report.measures.length+' measures</summary>'+table(['Period','Measure','Value','Unit','Interpretation / availability'],report.institutionRows.filter(x=>x.entity===i.id).map(x=>[x.period,labels.get(x.measure),x.display??'Unavailable',x.unit,x.reason??(x.derivation?JSON.stringify(x.derivation):'Reported')]))+'</details>').join('');
  const comparisons=table(['Subject','Comparison','Measure / policy','From period / value','To period / value','Absolute change','Relative change / availability'],(report.periodRows??[]).map(x=>[names.get(x.subject),x.label,labels.get(x.measure)+' / '+x.comparisonPolicy,x.from+' / '+(x.fromValue.display??'Unavailable')+' '+x.fromValue.unit,x.to+' / '+(x.toValue.display??'Unavailable')+' '+x.toValue.unit,x.change.status==='available'?x.change.absolute+' '+x.change.unit:'Unavailable',x.change.status!=='available'?x.change.reason:x.change.relativePercent!==null?x.change.relativePercent+'%':x.change.relativeReason]));
  const cohortTable=table(['Subject','Cohort','Included institutions','Subject included','Approved by / at'],report.cohorts.map(k=>[names.get(k.subjectId),k.definition,k.memberIds.map(id=>names.get(id)).join('; '),k.includeSubject?'Yes':'No',k.approvedBy+' / '+k.approvedAt]));
  const peers=table(['Subject','Period','Measure','Subject value','Peer value / unit','Statistic','Observed / eligible','Rank / missing peers'],report.peerRows.map(x=>[names.get(x.subject),x.period,labels.get(x.measure),x.subjectValue.display??'Unavailable',(x.statistic?.display??'Unavailable')+' '+(x.statistic?.unit??x.subjectValue.unit),x.method,x.observedCount+' / '+x.eligibleCount,(x.rank?x.rank.position+' of '+x.rank.of+'; tied '+x.rank.tied:'Rank not selected/applicable')+(x.missingIds.length?'; unavailable: '+x.missingIds.map(id=>names.get(id)).join(', '):'')]));
  const coverage=table(['Metric','Period','Original file','SHA256 / table','Definition / compatibility','Approval','Selected observations'],report.sourceCoverage.map(x=>[x.metric,x.period,x.originalFilename,x.sourceSha256+' / '+x.tableId,x.definitionId+' / '+x.compatibility.group,x.compatibility.approvedBy+' / '+x.compatibility.approvedAt,x.selectedObservationCount]));
  const exceptions=table(['Institution','Period','Measure','Issue'],report.exceptions.map(x=>[names.get(x.entity),x.period,labels.get(x.measure),x.reason]));
  const findings=table(['Finding','Source / selected observation','Recorded action','Owner / status','Reviewer / date'],(report.review.findings??[]).map(f=>[f.id+': '+f.finding,[names.get(f.entity)??f.entity,f.period,labels.get(f.measure)??f.measure,f.sourceReference].filter(Boolean).join(' / '),f.action,[f.owner,f.status].filter(Boolean).join(' / '),[f.reviewer,f.reviewedAt].filter(Boolean).join(' / ')]));
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+e(report.title)+'</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#161616;background:#fff;margin:32px}h1{font-size:26px;overflow-wrap:anywhere}h2{font-size:20px;margin-top:36px}h3{font-size:17px}nav{display:flex;gap:12px 20px;flex-wrap:wrap;margin:16px 0}a{color:inherit}table{border-collapse:collapse;width:100%;min-width:760px;font-size:13px}.table-scroll{overflow-x:auto;max-width:100%;margin:16px 0}th,td{text-align:left;vertical-align:top;border:1px solid #b7b7b7;padding:8px;overflow-wrap:anywhere}th{background:#eee}details{border:1px solid #bbb;padding:12px;margin:12px 0}summary{font-weight:600;cursor:pointer}button{font:inherit;color:inherit;background:#f3f3f3;border:1px solid #777;padding:7px 12px;cursor:pointer}.institution-controls{display:flex;gap:12px;flex-wrap:wrap}pre,code{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#444}a:focus-visible,button:focus-visible,summary:focus-visible,.table-scroll:focus-visible{outline:2px solid #333;outline-offset:3px}@media(max-width:600px){body{margin:16px}}@media print{body{margin:12mm}thead{display:table-header-group}tr{break-inside:avoid}.table-scroll{overflow:visible}table{min-width:0}details{break-inside:auto}.institution-controls{display:none}}</style></head><body><h1>'+e(report.title)+'</h1><nav aria-label="Report sections"><a href="#institution">Institution profile</a><a href="#periods">Period developments</a><a href="#peers">Peer context</a><a href="#sources">Source and review</a></nav><nav aria-label="Report downloads"><a href="input.json" download>Complete input</a><a href="report.json" download>Report JSON</a><a href="observations.csv" download>Observation CSV</a><a href="manifest.json" download>File manifest</a></nav><p>Periods: '+report.periods.map(e).join(', ')+'</p><p>'+e(report.rounding)+'</p><h2 id="institution">1. Institution profile</h2>'+definitions+'<p>Subject institutions open initially. Expand another institution to inspect every selected value; complete observations also remain in the CSV and JSON.</p><div class="institution-controls"><button type="button" id="expand-institutions">Expand all institutions</button> <button type="button" id="show-subjects">Show subjects only</button></div>'+profiles+'<h2 id="periods">2. Period developments</h2><p>Each comparison uses the explicitly selected endpoints. Percentage-point differences and relative percent changes have separate units. Full exact changes and original institution-row references remain in the JSON.</p>'+comparisons+'<h2 id="peers">3. Peer context</h2>'+cohortTable+peers+'<p>Rank uses explicit cohort membership and competition ranking. Subject rank is shown only when that subject is included.</p><h2 id="sources">4. Source coverage and review</h2>'+coverage+exceptions+'<h3>Recorded findings and actions</h3>'+findings+'<p>Statuses and actions are the retained reviewer record. The report does not create a management decision.</p><h3>Complete review record</h3><pre>'+e(JSON.stringify(report.review,null,2))+'</pre><small>Selection SHA256: <code>'+e(report.selectionHash)+'</code>. Preserve the complete input and report JSON alongside this readable output.</small><script>const institutions=[...document.querySelectorAll("details[data-subject]")];document.querySelector("#expand-institutions").addEventListener("click",()=>institutions.forEach(x=>x.open=true));document.querySelector("#show-subjects").addEventListener("click",()=>institutions.forEach(x=>x.open=x.dataset.subject==="true"));let beforePrint=null;addEventListener("beforeprint",()=>{beforePrint=institutions.map(x=>x.open);institutions.forEach(x=>x.open=true);});addEventListener("afterprint",()=>{if(beforePrint)institutions.forEach((x,i)=>x.open=beforePrint[i]);beforePrint=null;});</script></body></html>\n';
}

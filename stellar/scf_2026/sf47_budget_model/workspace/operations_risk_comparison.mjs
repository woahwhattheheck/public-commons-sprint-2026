// Read-only comparison of two complete original delivery-risk editions.
// All asynchronous calls are invoked by the existing Risk desk task owner.
const SCHEMA='stellar-forge.sf47-delivery-risk-comparison.v1';
const HASH=/^[0-9a-f]{64}$/;
const CHANGES=['ADDED','REMOVED','CHANGED','UNCHANGED'];
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(value,message)=>{if(!value)throw new Error(message);};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const enc=encodeURIComponent;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const words=value=>String(value??'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const attrs=value=>Object.entries(value).map(([key,v])=>' '+key+'="'+esc(v)+'"').join('');
const button=(label,action,data={},disabled=false)=>'<button type="button" data-risk-action="comparison-'+esc(action)+'"'+attrs(data)+(disabled?' disabled data-risk-fixed="true"':'')+'>'+esc(label)+'</button>';
const empty=text=>'<p class="risk-comparison-empty">'+esc(text)+'</p>';
const pretty=value=>JSON.stringify(value,null,2);
const full=(label,value)=>'<details class="risk-comparison-full"><summary>'+esc(label)+'</summary><pre>'+esc(pretty(value))+'</pre></details>';
const table=(heads,rows)=>'<div class="risk-comparison-table"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const badge=value=>'<span class="risk-comparison-badge">'+esc(words(value))+'</span>';
const text=value=>value===null?'null':typeof value==='string'?value:pretty(value);
const cell=value=>'<pre class="risk-comparison-value">'+esc(text(value))+'</pre>';
const named=value=>value?'<strong>'+esc(value.title||value.name||value.id||'Original record')+'</strong><small>'+esc(value.id||'')+'</small>':'<span class="risk-comparison-missing">Not present</span>';
const pointer=path=>path==='/'?'Record':String(path).split('/').slice(1).map(p=>p.replaceAll('~1','/').replaceAll('~0','~')).join(' / ');
const side=value=>value.present?cell(value.value):'<span class="risk-comparison-missing">Field absent</span>';
function fields(rows,label='Original field changes'){
 return rows.length?'<section class="risk-comparison-fields"><h5>'+esc(label)+'</h5>'+table(['Field','Before','After'],rows.map(row=>[
  '<code>'+esc(row.path)+'</code><small>'+esc(pointer(row.path))+'</small>',side(row.before),side(row.after)
 ]))+'</section>':empty('No field changes.');
}
function fieldShape(rows){
 need(Array.isArray(rows)&&rows.every(row=>plain(row)&&typeof row.path==='string'&&
  [row.before,row.after].every(side=>plain(side)&&typeof side.present==='boolean'&&Object.hasOwn(side,'value')&&(side.present||side.value===null))),
  'The comparison must retain every complete before/after field, including absent values.');
}
function rowShape(rows,type){
 need(Array.isArray(rows),'The original comparison rows are incomplete.');
 const seen=new Set();
 for(const row of rows){
  need(plain(row)&&typeof row.id==='string'&&row.id&&CHANGES.includes(row.change)&&Object.hasOwn(row,'before')&&Object.hasOwn(row,'after'),
   'A complete original comparison row is required.');
  if(type==='action')need(typeof row.riskId==='string'&&row.riskId,'The original mitigation must retain its risk identity.');
  if(type==='context')need(['SOURCE_IDENTITY','PLAN','CONTRIBUTOR','PACKAGE','SOURCE'].includes(row.kind),'The original comparison context is incomplete.');
  const key=type==='context'?row.kind+':'+row.id:type==='action'?row.riskId+':'+row.id:row.id;
  need(!seen.has(key),'The original comparison contains a repeated record.');seen.add(key);fieldShape(row.fields);
  if(type!=='context'){
   need(typeof row.contextChanged==='boolean'&&Object.hasOwn(row,'reportBefore')&&Object.hasOwn(row,'reportAfter'),
    'Keep both original dated report observations.');fieldShape(row.reportFields);
  }
 }
}
function editionShape(row){
 need(plain(row)&&typeof row.id==='string'&&row.id&&HASH.test(row.sha256||''),'Choose an original saved review with its complete SHA-256 identity.');
 return row;
}
export function createDeliveryRiskComparison({programId,saveApi,session={},editions,download,sourceMetadata=()=>null,available=()=>true}){
 need(typeof programId==='string'&&typeof saveApi==='function'&&typeof editions==='function'&&typeof download==='function','Use the original Operations case and Risk desk.');
 const prefix='/api/operations/'+enc(programId)+'/risk-register-comparison';
 const defaults={beforeReviewId:'',afterReviewId:'',section:'risks',filter:'DIFFERENT',search:'',page:0,selectedKey:'',value:null};
 for(const [key,value] of Object.entries(defaults))if(!Object.hasOwn(session,key))session[key]=value;
 // This read-only view is retained by the same in-memory staff/case desk. The
 // original editable working-copy format and frozen save commands are unchanged.
 let visible=false;
 function list(){
  const rows=editions();need(Array.isArray(rows),'Reopen the original edition list.');rows.forEach(editionShape);return rows;
 }
 function selection(){
  const rows=list(),before=rows.find(row=>row.id===session.beforeReviewId),after=rows.find(row=>row.id===session.afterReviewId);
  need(before&&after,'Choose both complete saved editions.');
  return {beforeReviewId:before.id,beforeReviewSha256:before.sha256,afterReviewId:after.id,afterReviewSha256:after.sha256};
 }
 function selectedValue(){
  if(!session.value)return null;
  try{return same(session.value.comparison.selection,selection())?session.value:null;}catch{return null;}
 }
 function query(value){return Object.entries(value).map(([key,v])=>enc(key)+'='+enc(String(v))).join('&');}
 async function verify(value,wanted){
  need(plain(value)&&plain(value.current)&&value.current.programId===programId&&Number.isSafeInteger(value.current.version)&&value.current.version>=0,
   'The comparison belongs to a different current case.');
  const c=value.comparison;
  need(plain(c)&&c.schema===SCHEMA&&c.engineVersion===1&&same(c.selection,wanted)&&HASH.test(c.comparisonSha256||'')&&
   ['SAME_EDITION','FORWARD','REVERSE'].includes(c.direction)&&typeof c.notice==='string',
   'The selected comparison identity is incomplete or changed.');
  editionShape(c.before);editionShape(c.after);
  need(c.before.id===wanted.beforeReviewId&&c.before.sha256===wanted.beforeReviewSha256&&c.after.id===wanted.afterReviewId&&c.after.sha256===wanted.afterReviewSha256,
   'The returned editions differ from the selected original reviews.');
  need(plain(c.originals)&&c.originals.before?.id===wanted.beforeReviewId&&c.originals.before.sha256===wanted.beforeReviewSha256&&
   c.originals.after?.id===wanted.afterReviewId&&c.originals.after.sha256===wanted.afterReviewSha256,
   'Keep both complete original saved reviews.');
  fieldShape(c.registerFields);rowShape(c.riskRows,'risk');rowShape(c.actionRows,'action');rowShape(c.contextRows,'context');
  need(Array.isArray(c.counts)&&c.counts.every(row=>plain(row)&&typeof row.name==='string'&&
   [row.before,row.after,row.delta].every(Number.isFinite)&&row.delta===row.after-row.before),'Keep the exact original dated counts and their signed differences.');
  // Native canonical JSON preserves Python number/Unicode semantics. Keep its
  // authoritative digest as the exact export pin; do not reserialize it in JS.
  return value;
 }
 async function read(){
  const wanted=selection(),value=await verify(await saveApi(prefix+'?'+query(wanted)),wanted);
  need(same(selection(),wanted),'The selected edition pair changed during its read.');
  session.value=value;session.page=0;session.selectedKey='';
 }
 async function openReceived(value){
  const keys=['schema','beforeReviewId','beforeReviewSha256','afterReviewId','afterReviewSha256','comparisonSha256'];
  need(plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))&&value.schema===SCHEMA+'.selection',
   'Keep the complete original received comparison selection.');
  const selected=structuredClone(value),wanted={};
  for(const side of ['before','after']){
   need(/^review-[a-f0-9]{32}$/.test(selected[side+'ReviewId'])&&HASH.test(selected[side+'ReviewSha256']||''),
    'The received comparison needs both exact original review identities.');
   wanted[side+'ReviewId']=selected[side+'ReviewId'];wanted[side+'ReviewSha256']=selected[side+'ReviewSha256'];
  }
  need(HASH.test(selected.comparisonSha256||''),'Keep the original received comparison digest.');
  const matches=()=>['before','after'].every(side=>list().some(row=>row.id===wanted[side+'ReviewId']&&row.sha256===wanted[side+'ReviewSha256']));
  need(matches(),'The received edition list differs from the selected original reviews.');
  const result=await verify(await saveApi(prefix+'?'+query(wanted)),wanted);
  need(matches()&&result.comparison.comparisonSha256===selected.comparisonSha256,
   'The received native comparison differs from the exact exported selection.');
  session.beforeReviewId=wanted.beforeReviewId;session.afterReviewId=wanted.afterReviewId;
  session.value=result;session.page=0;session.selectedKey='';visible=true;
 }
 function open({beforeReviewId,afterReviewId}={}){
  const rows=list();visible=true;
  if(afterReviewId)session.afterReviewId=afterReviewId;
  if(beforeReviewId)session.beforeReviewId=beforeReviewId;
  if(!rows.some(row=>row.id===session.afterReviewId))session.afterReviewId=rows[0]?.id||'';
  if(!rows.some(row=>row.id===session.beforeReviewId)){
   const after=rows.find(row=>row.id===session.afterReviewId),previous=after?.supersedes?.reviewId;
   session.beforeReviewId=rows.find(row=>row.id===previous)?.id||rows.find(row=>row.id!==session.afterReviewId)?.id||session.afterReviewId;
  }
 }
 function change(target){
  const key=target.dataset.riskComparison;if(!key)return false;
  if(key==='beforeReviewId'||key==='afterReviewId'){
   need(list().some(row=>row.id===target.value),'Choose an existing original review.');
   session[key]=target.value;session.selectedKey='';session.page=0;
  }else if(key==='filter'){
   need(['DIFFERENT','ALL','ADDED','REMOVED','CHANGED','UNCHANGED','CONTEXT'].includes(target.value),'Choose an available change filter.');
   session.filter=target.value;session.page=0;session.selectedKey='';
  }else if(key==='search'){session.search=target.value;session.page=0;session.selectedKey='';}
  else return false;
  return true;
 }
 function rowKey(row){return session.section==='context'?row.kind+':'+row.id:session.section==='actions'?row.riskId+':'+row.id:row.id;}
 function rows(){
  const c=selectedValue()?.comparison;if(!c)return [];
  const source=session.section==='actions'?c.actionRows:session.section==='context'?c.contextRows:c.riskRows;
  const needle=session.search.trim().toLowerCase();
  return source.filter(row=>{
   const context=row.contextChanged===true,reportChanged=Array.isArray(row.reportFields)&&row.reportFields.length>0;
   if(session.filter==='DIFFERENT'&&row.change==='UNCHANGED'&&!context&&!reportChanged)return false;
   if(session.filter==='CONTEXT'&&!context&&!reportChanged&&session.section!=='context')return false;
   if(CHANGES.includes(session.filter)&&row.change!==session.filter)return false;
   return !needle||[row.id,row.riskId,row.kind,row.before?.title,row.after?.title,row.before?.name,row.after?.name,...row.fields.map(field=>field.path)].filter(Boolean).join(' ').toLowerCase().includes(needle);
  });
 }
 async function exportFile(kind){
  const held=selectedValue();need(held,'Read the complete selected comparison before exporting.');
  const c=held.comparison,paths={json:'export.json',html:'export.html',risks:'risks.csv',actions:'actions.csv',context:'context.csv',zip:'export.zip'};
  need(Object.hasOwn(paths,kind),'Choose one of the original comparison exports.');
  const params={...c.selection,expectedComparisonSha256:c.comparisonSha256,...(kind==='zip'?{expectedVersion:held.current.version}:{})};
  const response=await saveApi(prefix+'/'+paths[kind]+'?'+query(params),undefined,{download:true});
  const data=await response.arrayBuffer();need(data.byteLength>0,'The original comparison export was empty.');
  if(kind==='json'){
   const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
   need(same(parsed,c),'The downloaded comparison differs from the selected complete original.');
  }
  const type=kind==='json'?'application/json':kind==='html'?'text/html;charset=utf-8':kind==='zip'?'application/zip':'text/csv;charset=utf-8';
  if(available())download(new Blob([data],{type}),programId+'-risk-comparison-'+c.comparisonSha256.slice(0,16)+'-'+paths[kind]);
 }
 async function action(name,target){
  if(name==='close'){visible=false;return;}
  if(name==='read'){await read();return;}
  if(name==='swap'){const before=session.beforeReviewId;session.beforeReviewId=session.afterReviewId;session.afterReviewId=before;session.page=0;session.selectedKey='';return;}
  if(name==='section'){
   need(['risks','actions','context','register','counts','originals'].includes(target.dataset.section),'Choose an original comparison section.');
   session.section=target.dataset.section;session.page=0;session.selectedKey='';return;
  }
  if(name==='select'){const row=rows().find(row=>rowKey(row)===target.dataset.rowKey);need(row,'Choose a visible original comparison row.');session.selectedKey=rowKey(row);return;}
  if(name==='page'){const page=Number(target.dataset.page);need(Number.isInteger(page)&&page>=0,'Choose an available page.');session.page=page;session.selectedKey='';return;}
  if(name==='export'){await exportFile(target.dataset.kind);return;}
  throw new Error('Unknown original comparison action.');
 }
 function chooser(label,key,rows){
  return '<label>'+esc(label)+'<select data-risk-comparison="'+key+'">'+(rows.length?'':'<option value="">No saved editions</option>')+
   rows.map(row=>'<option value="'+esc(row.id)+'"'+(session[key]===row.id?' selected':'')+'>'+esc((row.name||'Risk register')+' · '+row.asOfDate+' · '+row.id)+'</option>').join('')+'</select></label>';
 }
 function summary(label,value){
  return '<article><h5>'+esc(label)+'</h5><strong>'+esc(value.name||value.id)+'</strong><p>Assessed '+esc(value.asOfDate)+' · '+esc(value.actor)+'</p>'+
   '<p>'+esc(value.note)+'</p><dl><dt>Review</dt><dd><code>'+esc(value.id)+'</code></dd><dt>Original SHA-256</dt><dd><code>'+esc(value.sha256)+'</code></dd>'+
   '<dt>Saved version</dt><dd>'+esc(value.version)+'</dd><dt>Recorded at</dt><dd>'+esc(value.createdAt)+'</dd></dl>'+
   '<button type="button" data-risk-action="open" data-review-id="'+esc(value.id)+'">Open original edition</button></article>';
 }
 function sourceLink(value){
  if(!plain(value)||typeof value.id!=='string'||!HASH.test(value.sha256||''))return '';
  const current=sourceMetadata(value.id);
  if(!current||current.sha256!==value.sha256||(value.bytes!=null&&current.bytes!==value.bytes))return '';
  return '<button type="button" data-risk-action="source" data-source-id="'+esc(value.id)+'">Download this original source</button>';
 }
 function rowDetail(row){
  if(!row)return empty('Choose a row to inspect every original value and dated report observation.');
  const report=session.section!=='context';
  return '<section class="risk-comparison-detail" aria-label="Selected comparison record"><h4>'+esc(row.after?.title||row.before?.title||row.after?.name||row.before?.name||row.id)+'</h4>'+
   '<p><code>'+esc(row.id)+'</code> '+badge(row.change)+(row.reportFields?.length?' '+badge('DATED_REPORT_CHANGED'):'')+(row.contextChanged?' '+badge('LINKED_CONTEXT_CHANGED'):'')+'</p>'+
   (row.riskId?'<p>Original risk <code>'+esc(row.riskId)+'</code></p>':'')+
   fields(row.fields)+(report?fields(row.reportFields,'Original dated report changes'):'')+
   (row.kind==='SOURCE'?'<div class="risk-actions">'+sourceLink(row.before)+sourceLink(row.after)+'</div>':'')+
   '<div class="risk-comparison-pair">'+full('Complete before record',row.before)+full('Complete after record',row.after)+'</div>'+
   (report?'<div class="risk-comparison-pair">'+full('Before dated report',row.reportBefore)+full('After dated report',row.reportAfter)+'</div>':'')+'</section>';
 }
 function records(){
  const matched=rows(),pages=Math.max(1,Math.ceil(matched.length/50));
  session.page=Math.min(session.page,pages-1);
  const start=session.page*50,show=matched.slice(start,start+50);
  return '<div class="risk-comparison-filters"><label>Changes<select data-risk-comparison="filter">'+
   [['DIFFERENT','Field or dated report changes'],['ALL','All original records'],['ADDED','Added'],['REMOVED','Removed'],['CHANGED','Changed'],['UNCHANGED','Unchanged fields'],['CONTEXT','Dated report / source context']].map(([key,label])=>'<option value="'+key+'"'+(session.filter===key?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
   '<label>Find title, ID or field<input type="search" data-risk-comparison="search" value="'+esc(session.search)+'"></label></div>'+
   '<p>'+matched.length+' records · page '+(session.page+1)+' of '+pages+'. Filters affect only this view. Exports retain every original row.</p>'+
   (show.length?table(['Record','Before','After','Change','Inspect'],show.map(row=>[
    '<code>'+esc(row.id)+'</code>'+(row.riskId?'<small>Risk '+esc(row.riskId)+'</small>':'')+(row.kind?'<small>'+esc(words(row.kind))+'</small>':''),
    named(row.before),named(row.after),badge(row.change)+(row.reportFields?.length?'<small>Dated report changed</small>':'')+(row.contextChanged?'<small>Linked source context changed</small>':''),
    button('Inspect','select',{'data-row-key':rowKey(row)})
   ])):empty('No original rows match these filters.'))+
   '<div class="risk-actions">'+button('Previous page','page',{'data-page':session.page-1},session.page===0)+
   button('Next page','page',{'data-page':session.page+1},session.page>=pages-1)+'</div>'+
   rowDetail(matched.find(row=>rowKey(row)===session.selectedKey));
 }
 function render(){
  if(!document.querySelector('link[data-risk-comparison-style]')){
   const style=document.createElement('link');style.rel='stylesheet';style.href='/operations_risk_comparison.css';style.dataset.riskComparisonStyle='true';document.head.append(style);
  }
  const choices=list(),held=selectedValue(),c=held?.comparison;
  let body='';
  if(c){
   if(['risks','actions','context'].includes(session.section))body=records();
   else if(session.section==='register')body=fields(c.registerFields,'Register fields');
   else if(session.section==='counts')body='<p>Each count is the native report recorded for that edition’s assessment date. The signed difference is After minus Before; it does not infer likelihood, improvement or financial exposure.</p>'+
    table(['Recorded count','Before · '+c.before.asOfDate,'After · '+c.after.asOfDate,'Difference'],c.counts.map(row=>[
     esc(words(row.name)),esc(row.before),esc(row.after),esc(row.delta>0?'+'+row.delta:row.delta)
    ]));
   else body='<p>Both complete original reviews retain their saved source identity, report, review metadata and document. Imported editions may name their original producing case.</p>'+
    full('Complete before review',c.originals.before)+full('Complete after review',c.originals.after)+full('Complete native comparison',c);
  }
  return '<section class="risk-comparison" aria-label="Saved risk edition comparison"><header><h4>Compare saved risk editions</h4>'+
   button('Back to editions','close')+'<button type="button" data-risk-action="refresh">Refresh editions</button></header><p>Select the original Before and After reviews. Reverse and same-edition comparisons are available. This view reads saved work and keeps the editable draft and any unfinished save in the original desk.</p>'+
   '<div class="risk-comparison-pair">'+chooser('Before edition','beforeReviewId',choices)+chooser('After edition','afterReviewId',choices)+'</div>'+
   '<div class="risk-actions">'+button('Read selected comparison','read',{},!choices.length)+button('Swap before and after','swap',{},!choices.length)+'</div>'+
   (!c?empty(choices.length?'Read the selected editions to view their complete native comparison.':'Save an original risk edition before comparing saved work.'):
    '<p>'+badge(c.direction)+' <code>'+esc(c.comparisonSha256)+'</code></p><p>'+esc(c.notice)+'</p>'+
    '<div class="risk-comparison-pair">'+summary('Before',c.before)+summary('After',c.after)+'</div>'+
    '<nav class="risk-comparison-tabs" aria-label="Comparison sections">'+
    [['risks','Risks and issues'],['actions','Mitigations'],['context','Source and contributor context'],['register','Register fields'],['counts','Dated counts'],['originals','Complete originals']].map(([key,label])=>button(label,'section',{'data-section':key,'aria-pressed':String(session.section===key)})).join('')+'</nav>'+body+
    '<section class="risk-comparison-exports"><h4>Export this exact comparison</h4><p>Download full original rows or the complete case ZIP, including both selected reviews and comparison. The ZIP uses current case version '+esc(held.current.version)+'. If that version changes, read the comparison again before exporting.</p>'+
    '<div class="risk-actions">'+[['json','Comparison JSON'],['html','Readable HTML'],['risks','Risks CSV'],['actions','Mitigations CSV'],['context','Context CSV'],['zip','Full case ZIP']].map(([key,label])=>button(label,'export',{'data-kind':key})).join('')+'</div></section>')+
   '</section>';
 }
 return {open,openReceived,change,action,render,get visible(){return visible;}};
}

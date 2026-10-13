const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value));
const relationLabels={same_observation:'Same observation published more than once',independent_replicates:'Independent replicate measurements',related_context:'Related context only',distinct_observations:'Distinct observations',unresolved:'Relationship remains unresolved'};
const display=value=>value===undefined?'Not supplied':value===null?'Null':value===''?'Blank':typeof value==='object'?JSON.stringify(value):String(value);
const selected=(a,b)=>a===b?' selected':'';
const rowTitle=r=>[r.stationId,r.sampledDate,r.characteristic||r.parameter,r.reportedValue,r.reportedUnit].filter(v=>v!==undefined&&v!==null&&v!=='').join(' · ');
const supportFields=['organization','stationId','activityId','sourceResultId','sampledDate','sampledAt','sourceTime','timePrecision','timeZone','characteristic','parameter','basis','fraction','medium','activityType','method','laboratory','valueType','reportedValue','reportedUnit','value','lower','upper','censor','unit','detection','detectionLimits','qualifier','status','methodContext','methodName','speciation','solidsBasis','resultDepth','resultDepthUnit','resultDepthReference','activityDepth','activityDepthUnit','activityDepthReference','relativeDepth','timeBasis','temperatureBasis','weightBasis','original_station'];
const missingSupport=['stationId','sampledDate','sampledAt','timePrecision','timeZone','characteristic','parameter','basis','fraction','medium','activityType','method','methodContext','speciation','laboratory','valueType','unit'];
const stable=value=>JSON.stringify(value,(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
const valueNode=(r,key)=>{if(key==='original_station')key='station';return Object.hasOwn(r,key)?{present:true,value:r[key]}:{present:false};};
function comparison(rows){
 const fields=supportFields.map(field=>({field,cells:rows.map(r=>({record_id:r.id,...valueNode(r,field)}))}));
 for(const f of fields)f.different=new Set(f.cells.map(({record_id,...v})=>stable(v))).size>1;
 const concerns=fields.filter(f=>f.different).map(f=>({id:'different:'+f.field,message:'Original '+f.field+' differs between the selected records.'}));
 for(const field of missingSupport)if(rows.some(r=>!Object.hasOwn(r,field)||r[field]===null||r[field]===''))concerns.push({id:'unknown:'+field,message:'Original '+field+' is not supplied for every record.'});
 if(rows.some(r=>!r.station||r.station.latitude===null||r.station.latitude===undefined||r.station.longitude===null||r.station.longitude===undefined))concerns.push({id:'unknown:coordinates',message:'Original coordinates are not supplied for every record.'});
 return {fields,concerns};
}
function cleanEdition(value){const {reused,current_revision,...body}=value;return body;}
function download(name,body,type='application/json'){
 const blob=new Blob([typeof body==='string'?body:JSON.stringify(body,null,2)+'\n'],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function sourceName(source,index){return 'original-'+String(index+1).padStart(3,'0')+'-'+source.id.slice(0,16)+(/^[\s]*[\[{]/.test(source.content)?'.json':'.csv');}
function reportBody(edition){
 const choices=new Map(edition.rows.map(r=>[r.record_id,r]));
 return '<header><p class="eyebrow">OBSERVATION EDITION</p><h1>'+esc(edition.title)+'</h1><p>'+esc(edition.purpose)+'</p><dl><dt>Scientist / reviewer</dt><dd>'+esc(edition.reviewer)+'</dd><dt>Saved edition</dt><dd>'+esc(edition.edition_id||'Unsaved preview')+'</dd><dt>Original Measurements revision</dt><dd>'+esc(edition.workspaceRevision)+'</dd><dt>Parent edition</dt><dd>'+esc(edition.parent_id||'None')+'</dd><dt>Source binding</dt><dd>'+esc(edition.source_binding)+'</dd></dl></header><section><h2>Reviewed observation selection</h2><p>'+edition.counts.retained+' retained · '+edition.counts.duplicate_representations+' duplicate representations · '+edition.counts.excluded+' explicitly excluded · '+edition.counts.unresolved+' unresolved · '+edition.counts.native_eligible+' passed the saved native eligibility check.</p><p>'+esc(edition.method)+'</p><p>'+edition.counts.not_assessed+' records have no cross-source relationship decision. Their inclusion does not assert that they are unique.</p><p>Exact source filters: '+esc(JSON.stringify(edition.capture.scope.filters))+'</p></section><section><h2>Relationships and scientific support</h2>'+(edition.groups.length?edition.groups.map(g=>'<article><h3>'+esc(relationLabels[g.relationship])+'</h3><p>'+esc(g.rationale)+'</p><p>Evidence: '+esc(g.evidence_reference)+'</p><p>Representative: '+esc(g.representative_id||'All original members remain distinct')+'</p><ul>'+g.member_ids.map(id=>{const r=edition.capture.records.find(x=>x.id===id);return '<li>'+esc(rowTitle(r))+'<br><code>'+esc(id)+'</code></li>';}).join('')+'</ul><details><summary>Original field differences and missing support ('+g.concerns.length+')</summary><ul>'+g.concerns.map(c=>'<li>'+esc(c.message)+(g.acknowledged_differences.includes(c.id)?' — explicitly reviewed':'')+'</li>').join('')+'</ul><div class="scroll"><table><thead><tr><th>Original field</th>'+g.member_ids.map(id=>'<th>'+esc(id.slice(0,16))+'</th>').join('')+'</tr></thead><tbody>'+g.comparison.filter(f=>f.field!=='original_fields').map(f=>'<tr><th>'+esc(f.field)+'</th>'+f.cells.map(c=>'<td>'+esc(c.present?display(c.value):'Not supplied')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></details></article>').join(''):'<p>No cross-source relationship has been asserted.</p>')+'</section><section><h2>Complete selected original records</h2><div class="scroll"><table><thead><tr><th>Original record / source result</th><th>Station / source date</th><th>Original measurement</th><th>Fraction / method</th><th>Edition disposition</th><th>Saved native eligibility</th></tr></thead><tbody>'+edition.capture.records.map(r=>{const s=choices.get(r.id);return '<tr><td><code>'+esc(r.id)+'</code><br>'+esc(r.sourceResultId||'No source result ID')+'</td><td>'+esc(r.stationId)+'<br>'+esc(r.sampledDate)+'<br>'+esc(r.sampledAt||r.sourceTime||'Date only')+'</td><td>'+esc(r.characteristic)+'<br>'+esc(display(r.reportedValue))+' '+esc(r.reportedUnit)+'<br>'+esc(r.censor)+'</td><td>'+esc(r.fraction||'Not supplied')+'<br>'+esc(r.method||'Not supplied')+'</td><td>'+esc(s.disposition)+'<br>'+esc(s.reason)+'</td><td>'+esc(s.native_eligible?'Eligible in saved snapshot':s.native_reasons.join('; '))+'</td></tr>';}).join('')+'</tbody></table></div></section><section><h2>Complete original source files</h2><p>All source bodies and original fields are retained in the embedded edition JSON. The source downloads below are byte-for-byte original text.</p><table><thead><tr><th>Source</th><th>SHA-256</th><th>Original text</th></tr></thead><tbody>'+edition.capture.sources.map((s,i)=>'<tr><td>'+esc(s.label)+'<br>'+esc(s.id)+'</td><td><code>'+esc(s.sha)+'</code></td><td><button data-source="'+i+'">Download original</button></td></tr>').join('')+'</tbody></table></section>';
}
export function observationEditionHTML(edition){
 const embedded=JSON.stringify(cleanEdition(edition)).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(edition.title)+'</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{background:#fff;color:#202428;font:15px/1.5 system-ui,sans-serif;margin:0 auto;padding:28px;max-width:1400px}h1{font-size:30px}h1,h2,h3,p{overflow-wrap:anywhere}.eyebrow{font-size:12px;letter-spacing:.1em}button{font:inherit;color:#202428;background:#f4f5f5;border:1px solid #737b81;border-radius:3px;padding:8px 12px;cursor:pointer}.actions{display:flex;gap:12px;flex-wrap:wrap}dl{display:grid;grid-template-columns:200px 1fr;gap:5px 15px}dd{margin:0;overflow-wrap:anywhere}article{border:1px solid #bbb;padding:18px;margin:18px 0}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;vertical-align:top;border-bottom:1px solid #bbb;padding:8px;overflow-wrap:anywhere}code{font:11px/1.4 ui-monospace,monospace;overflow-wrap:anywhere}section{margin-top:28px}summary{cursor:pointer}@media(max-width:600px){body{padding:14px}dl{display:block}dt{font-weight:bold}dd{margin-bottom:8px}}@media print{body{max-width:none;padding:0;font-size:11px}.actions,button{display:none}.scroll{overflow:visible}table{font-size:9px}thead{display:table-header-group}tr{break-inside:avoid}article{break-inside:avoid}h2,h3{break-after:avoid}}</style><div class="actions"><button id="print">Print current review</button><button id="json">Download complete edition JSON</button></div>'+reportBody(edition)+'<script type="application/json" id="observation-edition-data">'+embedded+'</script><script>const edition=JSON.parse(document.getElementById("observation-edition-data").textContent);function save(name,text,type){const u=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);}document.getElementById("json").onclick=()=>save("Observation_Edition.json",JSON.stringify(edition,null,2)+"\\n","application/json");document.getElementById("print").onclick=()=>window.print();document.querySelectorAll("[data-source]").forEach(b=>b.onclick=()=>{const i=Number(b.dataset.source),s=edition.capture.sources[i];save("original-"+String(i+1).padStart(3,"0")+"-"+s.id.slice(0,16)+(["[","{"].includes(s.content.trimStart().charAt(0))?".json":".csv"),s.content,"text/plain;charset=utf-8")});let opened=[];addEventListener("beforeprint",()=>{opened=[...document.querySelectorAll("details")].filter(x=>!x.open);opened.forEach(x=>x.open=true)});addEventListener("afterprint",()=>opened.forEach(x=>x.open=false));</script></html>';
}
export function mountObservationEditions(host,{api,request,initialState={},onStateChange=()=>{},onChanged=()=>{},openRecord,openExports,css='/measurements/observation_editions.css'}={}){
 if(!(host instanceof Element))throw new TypeError('Mount observation editions in an existing element');
 const link=document.createElement('link');link.rel='stylesheet';link.href=css;document.head.append(link);
 const abort=new AbortController();let dead=false,busy=false,generation=0;
 const initial={scope:{source_ids:[],filters:{}},title:'',reviewer:'',purpose:'',groups:[],exclusions:[],capture:null,edition:null,selected_ids:[],comparison:null,parent_id:null,parent_digest:null,dirty:false,page:0,search:'',pending_save:null,retained_saves:[]};
 let state={...initial,...clone(initialState)},catalogue={revision:null,sources:[],editions:[]},notice='',isError=false;
 function emit(){if(!dead)onStateChange(snapshot());}
 function snapshot(){return clone(state);}
 function recoveryRequests(...lists){
  const byId=new Map();for(const list of lists){if(!Array.isArray(list))throw new Error('Retained save requests must be an array');for(const value of list){if(!value||typeof value!=='object'||typeof value.operation_id!=='string'||!value.operation_id.trim()||!Array.isArray(value.scope?.source_ids)||!Array.isArray(value.groups)||!Array.isArray(value.exclusions))throw new Error('A retained save request is incomplete; keep its original draft file.');const prior=byId.get(value.operation_id);if(prior&&stable(prior)!==stable(value))throw new Error('The same retained operation ID has different payloads; keep both original draft files separately.');byId.set(value.operation_id,clone(value));}}return [...byId.values()];
 }
 function dirty(){state.dirty=true;state.edition=null;emit();}
 function message(value,error=false){notice=String(value);isError=error;if(!dead){const n=host.querySelector('[data-oe-status]');if(n){n.textContent=notice;n.dataset.error=String(error);}}}
 async function call(path,method='GET',body){
  if(api)return api('/observation-editions'+path,method,body);
  if(!request)throw new Error('The original Measurements transport is required');
  const r=await request('/observation-editions'+path,method,body),t=await r.text();let value;try{value=JSON.parse(t);}catch{throw new Error('The Measurements service returned an unreadable response');}
  if(!r.ok)throw new Error(value.error||'Measurements request failed');return value;
 }
 async function raw(path){
  if(!request)throw new Error('The original download transport is required');
  const r=await request(path,'GET');if(!r.ok){let t=await r.text();try{t=JSON.parse(t).error||t;}catch{}throw new Error(t);}return r;
 }
 function own(token){return !dead&&token===generation;}
 async function run(operation){
  if(dead||busy)return;
  const token=++generation;busy=true;render();
  try{await operation(token);}catch(e){if(own(token)&&e.name!=='AbortError')message(e.message,true);}
  finally{if(own(token)){busy=false;render();emit();}}
 }
 function askDiscard(){if(state.pending_save){message('Recover the exact pending save before replacing this draft. Its original edition may already be accepted.',true);return false;}return !state.dirty||window.confirm('Replace the unfinished observation-edition choices? Download the draft to retain them before opening another selection.');}
 function exactRequest(){return {scope:clone(state.scope),title:state.title,reviewer:state.reviewer,purpose:state.purpose,groups:state.groups.map(g=>({member_ids:clone(g.member_ids),relationship:g.relationship,representative_id:g.representative_id||null,rationale:g.rationale,evidence_reference:g.evidence_reference,acknowledged_differences:clone(g.acknowledged_differences||[])})),exclusions:clone(state.exclusions),expected_revision:state.capture?.workspace_revision,source_binding:state.capture?.source_binding,parent_id:state.parent_id,parent_digest:state.parent_digest};}
 function operationId(){if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();return 'observation-'+Date.now()+'-'+Math.random().toString(36).slice(2);}
 function recordRows(){return state.capture?.records||[];}
 function relationFor(id){return state.groups.find(g=>g.member_ids.includes(id));}
 function disposition(id){if(state.exclusions.some(x=>x.record_id===id))return 'Excluded';const g=relationFor(id);if(!g)return 'Retained · relationship not assessed';if(g.relationship==='same_observation')return g.representative_id===id?'Retained representative':'Duplicate representation';if(g.relationship==='unresolved')return 'Unresolved';return 'Retained · '+relationLabels[g.relationship];}
 function options(values,value,blank='All original values'){return '<option value="">'+esc(blank)+'</option>'+values.map(v=>'<option value="'+esc(v)+'"'+selected(v,value)+'>'+esc(v)+'</option>').join('');}
 function recoveryPanel(){
  const pending=state.pending_save,retained=state.retained_saves||[];if(!pending&&!retained.length)return '';
  return '<section class="oe-panel"><h3>Save request recovery</h3><p>A failed response does not establish whether an edition was accepted. Retry uses the exact original operation and choices. Keeping a request for later recovery allows further editing without erasing that request.</p>'+(pending?'<p><strong>Pending request:</strong> '+esc(pending.title)+'<br><code>'+esc(pending.operation_id)+'</code></p><div class="oe-actions"><button data-oe-action="retry">Retry exact pending save</button><button data-oe-action="retain-pending">Keep request for recovery and continue editing</button></div>':'')+(retained.length?'<h4>Retained exact requests</h4><ul>'+retained.map((p,i)=>'<li>'+esc(p.title)+'<br><code>'+esc(p.operation_id)+'</code><div class="oe-actions"><button data-oe-recover="'+i+'">Recover retained save</button></div></li>').join('')+'</ul>':'')+'<button data-oe-action="draft">Download draft and all retained requests</button><p>These requests remain in this editor and its downloaded draft. A new edition does not replace a previously accepted edition.</p></section>';
 }
 function editionControls(){
  return '<section class="oe-panel"><h3>Save the reviewed observation edition</h3><form data-oe-form="edition"><div class="oe-two"><label>Edition title<input name="title" required maxlength="500" value="'+esc(state.title)+'"></label><label>Scientist / reviewer<input name="reviewer" required maxlength="500" value="'+esc(state.reviewer)+'"></label></div><label>Purpose and interpretation<textarea name="purpose" required rows="3">'+esc(state.purpose)+'</textarea></label><p>'+esc(state.parent_id?'New revision of '+state.parent_id+'. Its original record stays unchanged.':'Save creates a named immutable edition in this workspace.')+'</p><div class="oe-actions"><button type="submit">Save observation edition</button><button type="button" data-oe-action="preview">Preview complete selection</button><button type="button" data-oe-action="draft">Download unfinished draft</button></div></form></section>';
 }
 function sourceControls(){
  const f=state.scope.filters||{};
  return '<section class="oe-panel"><h3>Original sources and scope</h3><form data-oe-form="scope"><fieldset><legend>Select complete retained source editions</legend><div class="oe-source-list">'+catalogue.sources.map(s=>'<label><input type="checkbox" name="source_id" value="'+esc(s.id)+'"'+(state.scope.source_ids.includes(s.id)?' checked':'')+'><span>'+esc(s.label)+' · '+esc(s.kind)+' · '+esc(s.summary.rows)+' accepted original rows<br><code>'+esc(s.sha)+'</code></span></label>').join('')+'</div></fieldset><div class="oe-filters">'+[['stationId','Exact station ID'],['parameter','Normalized constituent'],['characteristic','Original characteristic'],['fraction','Original fraction'],['unit','Normalized unit'],['censor','Original censoring code'],['method','Original method'],['organization','Original organization'],['activityId','Original activity ID']].map(([k,l])=>'<label>'+l+'<input name="'+k+'" value="'+esc(f[k]||'')+'" placeholder="All if blank"></label>').join('')+'<label>From source date<input type="date" name="from" value="'+esc(f.from||'')+'"></label><label>Through source date<input type="date" name="to" value="'+esc(f.to||'')+'"></label></div><button type="submit">Inspect selected originals</button></form></section>';
 }
 function table(){
  const search=state.search.toLowerCase(),rows=recordRows().filter(r=>!search||[r.id,rowTitle(r),r.method,r.fraction,r.organization,r.activityId,r.sourceResultId].some(v=>String(v||'').toLowerCase().includes(search))),pageSize=25,pages=Math.max(1,Math.ceil(rows.length/pageSize));
  state.page=Math.min(state.page,pages-1);const page=rows.slice(state.page*pageSize,(state.page+1)*pageSize);
  return '<section class="oe-panel"><h3>Original observations</h3><p>'+recordRows().length+' selected original records · '+state.capture.counts.occurrences+' original source occurrences. The checkboxes choose records to compare; they do not remove measurements from the edition.</p><div class="oe-actions"><label>Find within this selection<input data-oe-search value="'+esc(state.search)+'" placeholder="Station, activity, method, result or record ID"></label><button data-oe-action="compare"'+(state.selected_ids.length<2?' disabled':'')+'>Compare '+state.selected_ids.length+' selected records</button><button data-oe-action="clear-selection">Clear comparison selection</button></div><div class="oe-scroll"><table><thead><tr><th>Compare</th><th>Station / date</th><th>Original measurement</th><th>Fraction / method</th><th>Edition disposition</th><th>Original record</th></tr></thead><tbody>'+page.map(r=>'<tr><td><input aria-label="Compare '+esc(rowTitle(r))+'" type="checkbox" data-oe-record-pick="'+esc(r.id)+'"'+(state.selected_ids.includes(r.id)?' checked':'')+'></td><td>'+esc(r.stationId)+'<br>'+esc(r.sampledDate)+'<br>'+esc(r.sampledAt||r.sourceTime||'Date only')+'</td><td>'+esc(r.characteristic||r.parameter)+'<br><strong>'+esc(display(r.reportedValue))+' '+esc(r.reportedUnit)+'</strong><br>'+esc(r.censor)+'</td><td>'+esc(r.fraction||'Not supplied')+'<br>'+esc(r.method||'Not supplied')+'</td><td>'+esc(disposition(r.id))+'</td><td><button data-oe-open="'+esc(r.id)+'">Inspect original</button><button data-oe-exclude="'+esc(r.id)+'">'+(state.exclusions.some(x=>x.record_id===r.id)?'Restore to edition':'Exclude with reason')+'</button></td></tr>').join('')+'</tbody></table></div><div class="oe-actions"><button data-oe-action="previous"'+(state.page===0?' disabled':'')+'>Previous</button><span>'+rows.length+' matching · page '+(state.page+1)+' of '+pages+'</span><button data-oe-action="next"'+(state.page>=pages-1?' disabled':'')+'>Next</button></div></section>';
 }
 function comparisonForm(){
  if(!state.comparison)return '';
  const g=state.comparison,rows=g.member_ids.map(id=>recordRows().find(r=>r.id===id)).filter(Boolean),c=comparison(rows);
  return '<section class="oe-panel oe-comparison"><h3>Review the original relationship</h3><p>Same sampling date or similar values do not establish one observation. Review source identifiers, method, fraction, time and location. Independent replicates and related context remain separate.</p><form data-oe-form="relationship"><label>Relationship<select name="relationship">'+Object.entries(relationLabels).map(([k,v])=>'<option value="'+k+'"'+selected(k,g.relationship)+'>'+esc(v)+'</option>').join('')+'</select></label><label>Representative when these are the same observation<select name="representative_id"><option value="">Choose an original record</option>'+rows.map(r=>'<option value="'+esc(r.id)+'"'+selected(r.id,g.representative_id)+'>'+esc(rowTitle(r))+' · '+esc(r.id.slice(0,12))+'</option>').join('')+'</select></label><label>Scientific rationale<textarea name="rationale" required rows="3">'+esc(g.rationale||'')+'</textarea></label><label>Evidence reference in the retained original sources<textarea name="evidence_reference" required rows="2" placeholder="Original source, activity/result identifier, row or published explanation">'+esc(g.evidence_reference||'')+'</textarea></label><fieldset><legend>Original differences and unknown support</legend><p>Choosing one representative requires explicit review of every listed difference and missing field. No values are converted or replaced.</p>'+c.concerns.map(x=>'<label class="oe-check"><input type="checkbox" name="acknowledged_differences" value="'+esc(x.id)+'"'+((g.acknowledged_differences||[]).includes(x.id)?' checked':'')+'><span>'+esc(x.message)+'</span></label>').join('')+(c.concerns.length?'':'<p>No displayed support differences were found. This does not prove shared identity.</p>')+'</fieldset><div class="oe-actions"><button>Apply relationship to draft</button><button type="button" data-oe-action="cancel-comparison">Discard unfinished relationship</button></div></form><details open><summary>Complete original field comparison</summary><div class="oe-scroll"><table><thead><tr><th>Original field</th>'+rows.map(r=>'<th>'+esc(r.stationId)+'<br>'+esc(r.id.slice(0,16))+'</th>').join('')+'</tr></thead><tbody>'+c.fields.map(f=>'<tr'+(f.different?' class="oe-difference"':'')+'><th>'+esc(f.field)+'</th>'+f.cells.map(x=>'<td>'+esc(x.present?display(x.value):'Not supplied')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></details><details><summary>Unmodified original field objects and every source occurrence</summary>'+rows.map(r=>'<h4>'+esc(r.id)+'</h4><pre>'+esc(JSON.stringify({original_fields:r.raw,sources:r.sources},null,2))+'</pre>').join('')+'</details></section>';
 }
 function draftGroups(){
  return '<section class="oe-panel"><h3>Draft relationships and exclusions</h3>'+(state.groups.length?'<ul>'+state.groups.map((g,i)=>'<li><strong>'+esc(relationLabels[g.relationship])+'</strong> · '+g.member_ids.length+' records<br>'+esc(g.rationale)+'<div class="oe-actions"><button data-oe-edit-group="'+i+'">Review relationship</button><button data-oe-remove-group="'+i+'">Remove relationship</button></div></li>').join('')+'</ul>':'<p>No cross-source relationship is asserted. Unassessed original records remain distinct.</p>')+(state.exclusions.length?'<h4>Explicit exclusions</h4><ul>'+state.exclusions.map(x=>'<li><code>'+esc(x.record_id)+'</code> · '+esc(x.reason)+' <button data-oe-restore="'+esc(x.record_id)+'">Restore to edition</button></li>').join('')+'</ul>':'')+'</section>';
 }
 function savedPanel(){
  return '<section class="oe-panel"><h3>Saved observation editions</h3>'+(catalogue.editions.length?'<ul class="oe-saved">'+catalogue.editions.map(e=>'<li><strong>'+esc(e.title)+'</strong><br>'+esc(e.created_at)+' · '+esc(e.reviewer)+' · '+esc(e.counts?.retained)+' retained originals<div class="oe-actions"><button data-oe-saved="'+esc(e.id)+'">Open saved edition</button></div></li>').join('')+'</ul>':'<p>No observation edition has been saved in this workspace.</p>')+'</section>';
 }
 function savedReview(){
  return '<section class="oe-panel"><div class="oe-actions"><button data-oe-action="revise">Revise with current originals</button><button data-oe-action="edition-json">Download complete edition JSON</button><button data-oe-action="edition-csv">Download all original-row decisions CSV</button><button data-oe-action="edition-html">Download readable review</button><button data-oe-action="calibration">Download calibration input selection</button><button data-oe-action="portable">Download editable workspace</button><button data-oe-action="exports">Open Exports &amp; handover</button></div><p>This historical edition retains its original review and source state. Later Measurements decisions do not rewrite it. A calibration download uses this saved eligibility snapshot; current native admission still checks its own scientific source contract.</p>'+reportBody(state.edition)+'</section>';
 }
 function render(){
  if(dead)return;
  host.classList.add('observation-editions');
  host.innerHTML='<header class="oe-head"><div><h2>Observation editions</h2><p>Review relationships across retained sources and save a complete observation selection. Original records, independent replicates and previous editions remain available.</p></div><div class="oe-actions"><button data-oe-action="refresh">Refresh saved catalogue</button><button data-oe-action="new">New observation edition</button><label class="oe-button">Open unfinished draft<input type="file" accept=".json,application/json" data-oe-draft-file></label></div></header><div data-oe-status role="status" aria-live="polite" data-error="'+String(isError)+'">'+esc(notice||'Choose original sources or reopen a saved observation edition.')+'</div>'+recoveryPanel()+(state.edition?savedReview():sourceControls()+(state.capture?'<p class="oe-binding">Inspected Measurements revision '+state.capture.workspace_revision+' · source binding <code>'+esc(state.capture.source_binding)+'</code></p>'+table()+comparisonForm()+draftGroups()+editionControls():''))+savedPanel();
  if(busy){host.setAttribute('aria-busy','true');for(const n of host.querySelectorAll('button,input,select,textarea'))n.disabled=true;}else host.setAttribute('aria-busy','false');
 }
 function updateForm(form){
  if(!form)return;
  const data=new FormData(form),kind=form.dataset.oeForm;
  if(kind==='edition'){state.title=String(data.get('title')||'');state.reviewer=String(data.get('reviewer')||'');state.purpose=String(data.get('purpose')||'');}
  if(kind==='relationship'&&state.comparison){for(const key of ['relationship','representative_id','rationale','evidence_reference'])state.comparison[key]=String(data.get(key)||'');state.comparison.acknowledged_differences=data.getAll('acknowledged_differences').map(String);}
  if(kind==='scope'){
   state.scope={source_ids:data.getAll('source_id').map(String),filters:{}};
   for(const key of ['stationId','parameter','characteristic','fraction','unit','censor','method','organization','activityId','from','to']){const value=String(data.get(key)||'').trim();if(value)state.scope.filters[key]=value;}
   // Existing inspected choices remain visible until explicit reinspection;
   // their binding prevents saving them against changed source filters.
  }
  dirty();
 }
 async function inspect(token,{keep=false}={}){
  const capture=await call('/inspect','POST',{scope:state.scope});
  if(!own(token))return;
  if(!keep){state.groups=[];state.exclusions=[];state.parent_id=null;state.parent_digest=null;}
  state.capture=capture;state.scope=clone(capture.scope);state.edition=null;if(!keep){state.selected_ids=[];state.comparison=null;state.page=0;state.search='';}state.dirty=true;
  message(capture.records.length+' exact original records are ready for scientific comparison. No relationship has been inferred.');
 }
 async function save(token,payload){
  if(state.pending_save&&stable(state.pending_save)!==stable(payload))throw new Error('Recover the retained pending save before submitting a different operation.');
  state.pending_save=clone(payload);emit();
  const value=await call('/editions','POST',payload);if(!own(token))return;
  const {operation_id,...savedRequest}=payload,unchanged=stable(savedRequest)===stable(exactRequest());
  state.pending_save=null;state.retained_saves=(state.retained_saves||[]).filter(p=>p.operation_id!==payload.operation_id);
  if(unchanged){state.edition=cleanEdition(value);state.capture=state.edition.capture;state.dirty=false;state.comparison=null;state.selected_ids=[];}
  onChanged({revision:value.current_revision});message(!unchanged?'The pending original save was recovered in Saved observation editions. Your later unfinished choices remain in place; inspect the current originals before saving them.':value.reused?'The exact original save was recovered.':'Observation edition saved. Original Measurements decisions remain unchanged.');
  const next=await call('');if(own(token))catalogue=next;
 }
 host.addEventListener('input',event=>{
  if(dead||busy)return;const target=event.target;
  if(target.matches('[data-oe-search]')){state.search=target.value;state.page=0;render();const input=host.querySelector('[data-oe-search]');input?.focus();input?.setSelectionRange(state.search.length,state.search.length);emit();return;}
  const form=target.closest('[data-oe-form]');if(form)updateForm(form);
 },{signal:abort.signal});
 host.addEventListener('change',event=>{
  if(dead||busy)return;const target=event.target;
  if(target.matches('[data-oe-draft-file]')){
   const file=target.files?.[0];if(!file||!askDiscard())return;
   run(async token=>{
    if(file.size>8*1024*1024)throw new Error('The unfinished draft exceeds 8 MiB. Use the complete workspace archive for source data.');
    const buffer=await file.arrayBuffer();if(!own(token))return;
    const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer),draft=JSON.parse(text);
    if(draft?.schema!=='upstate.observation-edition-draft/v1'||!draft.request||!Array.isArray(draft.request.scope?.source_ids)||!Array.isArray(draft.request.groups)||!Array.isArray(draft.request.exclusions))throw new Error('Choose an original observation-edition draft');
    const retained=recoveryRequests(state.retained_saves||[],draft.retained_saves||[]),pending=draft.pending_save==null?null:recoveryRequests([draft.pending_save])[0];if(pending)recoveryRequests(retained,[pending]);
    const capture=await call('/inspect','POST',{scope:draft.request.scope});if(!own(token))return;
    const ids=new Set(capture.records.map(r=>r.id));
    if(draft.request.groups.some(g=>!Array.isArray(g.member_ids)||g.member_ids.some(id=>!ids.has(id)))||draft.request.exclusions.some(e=>!ids.has(e.record_id)))throw new Error('This draft refers to original records absent from the current source selection. Restore its complete workspace before opening it.');
    state={...clone(initial),retained_saves:retained,pending_save:pending,scope:clone(draft.request.scope),title:String(draft.request.title||''),reviewer:String(draft.request.reviewer||''),purpose:String(draft.request.purpose||''),groups:clone(draft.request.groups),exclusions:clone(draft.request.exclusions),parent_id:draft.request.parent_id||null,parent_digest:draft.request.parent_digest||null,capture,comparison:draft.comparison&&Array.isArray(draft.comparison.member_ids)&&draft.comparison.member_ids.every(id=>ids.has(id))?clone(draft.comparison):null,selected_ids:Array.isArray(draft.selected_ids)?draft.selected_ids.filter(id=>ids.has(id)):[],dirty:true};
    message('The complete draft is open against the current original sources. Review its scientific choices before saving.');
   });return;
  }
  if(target.matches('[data-oe-record-pick]')){
   const id=target.dataset.oeRecordPick;if(target.checked){if(state.selected_ids.length>=64){target.checked=false;message('Review at most 64 original records in one explicitly defined relationship; retain separate independent groups.',true);return;}state.selected_ids.push(id);}else state.selected_ids=state.selected_ids.filter(x=>x!==id);render();emit();return;
  }
  const form=target.closest('[data-oe-form]');if(form)updateForm(form);
 },{signal:abort.signal});
 host.addEventListener('submit',event=>{
  const form=event.target.closest('[data-oe-form]');if(!form||dead||busy)return;event.preventDefault();updateForm(form);
  const kind=form.dataset.oeForm;
  if(kind==='scope'){if(state.pending_save){message('Recover the exact pending save before reinspecting its source selection. Later draft edits remain in place.',true);return;}const keep=!!state.capture&&stable({...state.scope,source_ids:[...state.scope.source_ids].sort()})===stable(state.capture.scope);if(!keep&&(state.groups.length||state.exclusions.length||state.comparison)&&!window.confirm('Inspecting a different source selection replaces the unfinished relationship choices. Download the draft first if you need to retain them.'))return;run(token=>inspect(token,{keep}));return;}
  if(kind==='edition'){if(state.pending_save){message('Use Retry exact pending save before issuing another save. The original operation may already be accepted.',true);return;}if(state.comparison){message('Apply or discard the unfinished relationship before saving the edition.',true);return;}const payload={...exactRequest(),operation_id:operationId()};run(token=>save(token,payload));return;}
  if(kind==='relationship'){
   const value=clone(state.comparison);
   if(!value.rationale?.trim()||!value.evidence_reference?.trim()){message('Add the scientific rationale and original evidence reference.',true);return;}
   if(value.relationship!=='same_observation')value.representative_id=null;else {const rows=value.member_ids.map(id=>recordRows().find(r=>r.id===id)),issues=comparison(rows).concerns;if(!value.member_ids.includes(value.representative_id)){message('Choose an original representative for this same-observation relationship.',true);return;}if(issues.some(x=>!value.acknowledged_differences.includes(x.id))){message('Review every displayed difference and unknown support field before selecting one representative.',true);return;}}
   const ids=new Set(value.member_ids);
   const conflict=state.groups.find(g=>g.member_ids.some(id=>ids.has(id))&&!sameMembers(g.member_ids,value.member_ids));
   if(conflict){message('One selected record already belongs to another relationship. Review that complete group or remove it before defining a different grouping.',true);return;}
   state.groups=state.groups.filter(g=>!sameMembers(g.member_ids,value.member_ids));state.groups.push(value);state.comparison=null;dirty();message('Relationship added to the unfinished edition. It has not changed original Measurements reviews.');render();
  }
 },{signal:abort.signal});
 function sameMembers(a,b){return stable([...a].sort())===stable([...b].sort());}
 host.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||dead||busy)return;
  const ds=button.dataset,action=ds.oeAction;
  if(ds.oeSaved){if(!askDiscard())return;run(async token=>{const value=await call('/editions/'+encodeURIComponent(ds.oeSaved));if(!own(token))return;state={...clone(initial),retained_saves:clone(state.retained_saves||[]),edition:cleanEdition(value),capture:value.capture,scope:clone(value.capture.scope),title:value.title,reviewer:value.reviewer,purpose:value.purpose,groups:clone(value.groups),exclusions:clone(value.exclusions),parent_id:value.parent_id,parent_digest:value.parent_digest};message('Saved historical observation edition opened. Original source data and decisions are retained.');});return;}
  if(ds.oeOpen){const record=recordRows().find(r=>r.id===ds.oeOpen);if(openRecord){emit();openRecord(ds.oeOpen);}else{download('Original_Observation_'+record.id+'.json',record);message('Complete original observation downloaded.');}return;}
  if(ds.oeExclude){const id=ds.oeExclude,old=state.exclusions.find(x=>x.record_id===id);if(old){state.exclusions=state.exclusions.filter(x=>x.record_id!==id);dirty();render();return;}const reason=window.prompt('Explain why this original observation is excluded from this edition. The original record remains unchanged.');if(reason?.trim()){state.exclusions.push({record_id:id,reason:reason.trim()});dirty();render();}return;}
  if(ds.oeRestore){state.exclusions=state.exclusions.filter(x=>x.record_id!==ds.oeRestore);dirty();render();return;}
  if(ds.oeEditGroup!==undefined){const target=state.groups[Number(ds.oeEditGroup)];if(state.comparison){if(sameMembers(state.comparison.member_ids,target.member_ids)){render();return;}if(!window.confirm('Replace the unfinished relationship comparison? Apply it or download the draft to retain its rationale.'))return;}state.comparison=clone(target);render();emit();return;}
  if(ds.oeRemoveGroup!==undefined){state.groups.splice(Number(ds.oeRemoveGroup),1);dirty();render();return;}
  if(ds.source!==undefined&&state.edition){const i=Number(ds.source),source=state.edition.capture.sources[i];download(sourceName(source,i),source.content,'text/plain;charset=utf-8');return;}
  if(action==='new'){if(!askDiscard())return;state={...clone(initial),retained_saves:clone(state.retained_saves||[])};message('New observation edition. Choose its original sources.');render();emit();return;}
  if(action==='refresh'){run(async token=>{const next=await call('');if(own(token)){catalogue=next;message('Saved catalogue refreshed; unfinished choices remain in place.');}});return;}
  if(action==='compare'){
   const member_ids=[...state.selected_ids].sort();if(member_ids.length<2)return;
   if(state.comparison){if(sameMembers(state.comparison.member_ids,member_ids)){render();return;}if(!window.confirm('Replace the unfinished relationship comparison? Apply it or download the draft to retain its rationale.'))return;}const old=state.groups.find(g=>sameMembers(g.member_ids,member_ids));state.comparison=old?clone(old):{member_ids,relationship:'unresolved',representative_id:null,rationale:'',evidence_reference:'',acknowledged_differences:[]};render();emit();return;
  }
  if(action==='cancel-comparison'){state.comparison=null;render();emit();return;}
  if(action==='clear-selection'){state.selected_ids=[];render();emit();return;}
  if(action==='previous'||action==='next'){state.page=Math.max(0,state.page+(action==='next'?1:-1));render();emit();return;}
  if(action==='draft'){download('Observation_Edition_Draft.json',{schema:'upstate.observation-edition-draft/v1',request:exactRequest(),comparison:clone(state.comparison),selected_ids:clone(state.selected_ids),pending_save:clone(state.pending_save),retained_saves:clone(state.retained_saves||[])});message('Unfinished choices and exact pending or retained save requests downloaded. Original source files travel in the complete workspace archive.');return;}
  if(action==='retain-pending'){
   if(!state.pending_save)return;if(!window.confirm('Keep the exact pending request for later recovery and continue editing? It may already have created an edition. The original request remains in this editor and downloaded drafts; any later save creates a separate operation.'))return;
   state.retained_saves=recoveryRequests(state.retained_saves||[],[state.pending_save]);state.pending_save=null;state.dirty=true;message('Exact request retained for recovery. You can edit or reinspect the draft, then save a separate edition. Download the draft to retain all requests outside this session.');render();emit();return;
  }
  if(ds.oeRecover!==undefined){
   if(state.pending_save){message('Recover or keep the current pending request before selecting another retained request.',true);return;}const payload=(state.retained_saves||[])[Number(ds.oeRecover)];if(!payload)return;
   state.pending_save=clone(payload);state.retained_saves=state.retained_saves.filter(p=>p.operation_id!==payload.operation_id);emit();run(token=>save(token,clone(payload)));return;
  }
  if(action==='retry'){const payload=clone(state.pending_save);if(payload)run(token=>save(token,payload));return;}
  if(action==='preview'){
   if(state.comparison){message('Apply or discard the unfinished relationship before preparing the complete preview.',true);return;}const payload=exactRequest();run(async token=>{const value=await call('/preview','POST',payload);if(!own(token))return;download('Observation_Edition_Preview.html',observationEditionHTML(value),'text/html;charset=utf-8');message('Readable complete preview downloaded. The edition has not been saved.');});return;
  }
  if(action==='revise'){
   const parent=state.edition;if(!parent)return;
   run(async token=>{const capture=await call('/inspect','POST',{scope:parent.capture.scope});if(!own(token))return;state={...clone(initial),retained_saves:clone(state.retained_saves||[]),scope:clone(parent.capture.scope),capture,title:parent.title,reviewer:parent.reviewer,purpose:parent.purpose,groups:clone(parent.groups),exclusions:clone(parent.exclusions),parent_id:parent.edition_id,parent_digest:parent.digest,dirty:true};message('New revision opened against current original sources. The selected parent edition remains unchanged.');});return;
  }
  if(action==='edition-json'&&state.edition){download('Observation_Edition.json',state.edition);return;}
  if(action==='edition-html'&&state.edition){download('Observation_Edition_Review.html',observationEditionHTML(state.edition),'text/html;charset=utf-8');return;}
  if(['edition-csv','calibration'].includes(action)&&state.edition){
   const id=state.edition.edition_id;run(async token=>{const suffix=action==='edition-csv'?'observations.csv':'calibration.json',r=await raw('/observation-editions/editions/'+encodeURIComponent(id)+'/'+suffix),text=await r.text();if(own(token))download(action==='edition-csv'?'Observation_Edition_All_Original_Rows.csv':'Observation_Edition_Calibration.json',text,action==='edition-csv'?'text/csv;charset=utf-8':'application/json');});return;
  }
  if(action==='portable'){run(async token=>{const r=await raw('/portable'),text=await r.text();if(own(token)){download('Measurements_Complete_Workspace.json',text,'application/json');message('Complete editable workspace downloaded with original sources, all saved editions and review history.');}});return;}
  if(action==='exports'&&openExports){emit();openExports();}
 },{signal:abort.signal});
 function beforeUnload(event){if(state.dirty||state.pending_save||state.retained_saves?.length){event.preventDefault();event.returnValue='';}}
 window.addEventListener('beforeunload',beforeUnload);
 render();
 const ready=run(async token=>{const value=await call('');if(own(token)){catalogue=value;message(state.dirty?'Unfinished observation choices restored.':'Original source catalogue and saved observation editions loaded.');}});
 return {ready,snapshot,hasDraft:()=>state.dirty,hasUnsaved:()=>state.dirty||!!state.pending_save||!!state.retained_saves?.length,async prepareLeave(){emit();},cancelLeave(){},async openSaved(id){if(dead||!askDiscard())return;return run(async token=>{const value=await call('/editions/'+encodeURIComponent(id));if(!own(token))return;state={...clone(initial),retained_saves:clone(state.retained_saves||[]),edition:cleanEdition(value),capture:value.capture,scope:clone(value.capture.scope),title:value.title,reviewer:value.reviewer,purpose:value.purpose,groups:clone(value.groups),exclusions:clone(value.exclusions)};message('Saved observation edition opened.');});},destroy(){if(dead)return;onStateChange(snapshot());dead=true;generation++;abort.abort();window.removeEventListener('beforeunload',beforeUnload);link.remove();host.replaceChildren();}};
}

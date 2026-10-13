/** Saved samples → explicit laboratory request package → original returned results. */
import {clone,esc} from './implementation_core.mjs';
const SELECTION='upstate.implementation-lab-dispatch-selection/v1';
const PREVIEW='upstate.implementation-lab-dispatch-preview/v1';
const PACKAGE='upstate.implementation-lab-dispatch/v1';
const RECONCILIATION='upstate.implementation-lab-dispatch-reconciliation/v1';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const button=(action,label,attrs='')=>'<button type="button" data-impl="dispatch-'+action+'" '+attrs+'>'+esc(label)+'</button>';
const field=(label,body,help='')=>'<label class="iw-field"><span>'+esc(label)+'</span>'+body+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const option=(value,label,selected)=>'<option value="'+esc(value)+'" '+(value===selected?'selected':'')+'>'+esc(label)+'</option>';
const busy=s=>['loading','previewing','saving','preparing','reconciling','opening'].includes(s?.stage);
function active(w){
 if(!w.native||w.gone||w.host.getState?.()?.workspace_key!==w.workspace)throw Error('Open laboratory requests in the original native workspace.');
}
function editable(w){active(w);if(w.pending||busy(w.labDispatch))throw Error('Finish the retained laboratory package or plan operation first.');}
function current(w,s,turn){return !w.gone&&w.labDispatch===s&&w.plan?.id===s.plan_id&&w.generation===turn&&w.host.getState?.()?.workspace_key===w.workspace;}
function touch(w,s){s.preview=null;s.operation_id=null;s.stage='editing';s.reconciliation=null;w.cache();}
function download(name,value){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function state(plan){return {plan_id:plan.id,stage:'editing',selection:{schema:SELECTION,label:'',laboratory:'',laboratory_reference:'',instructions:'',orders:[],attachment_source_ids:[]},selected_activities:[],sample_query:'',sample_page:0,order_page:0,draft_analyte:{parameter:'',unit:'',basis:'',fraction:'',method:'',notes:''},items:[],preview:null,reconciliation:null,active_package:null};}
export function samples(plan,query=''){
 const sites=new Map(plan.sites.map(x=>[x.id,x])),visits=new Map(plan.visits.map(x=>[x.id,x]));
 const tokens=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 return plan.activities.filter(a=>a.kind==='sample').map(activity=>{const visit=visits.get(activity.visit_id)||{},site=sites.get(activity.site_id||visit.site_id)||{};return {activity,site,visit};}).filter(row=>tokens.every(token=>[row.activity.id,row.activity.sample_id,row.site.id,row.site.label,row.visit.id,row.activity.custody_ref,row.activity.collected_at].join('\n').toLocaleLowerCase().includes(token)));
}
export function campaignChoices(plan,selected){
 const chosen=new Set(selected),visits=new Map(plan.visits.map(x=>[x.id,x])),monitoring=new Map(plan.monitoring_plans.map(x=>[x.id,x])),out=new Map();
 for(const activity of plan.activities){if(!chosen.has(activity.id))continue;const programme=monitoring.get(visits.get(activity.visit_id)?.monitoring_plan_id);if(!programme)continue;
  for(const parameter of programme.parameters||[]){if(typeof parameter!=='string'||!parameter)continue;const key=JSON.stringify([programme.id,parameter]);out.set(key,{key,parameter,programme_id:programme.id,title:programme.title});}
 }
 return [...out.values()];
}
export function canPrepare(w){
 const s=w.labDispatch,p=s?.preview;
 return !!p?.can_prepare&&!w.pending&&!w.dirty&&!!w.nativePlan&&same(w.plan,w.nativePlan)&&
 p.schema===PREVIEW&&p.plan?.id===w.plan.id&&p.plan.revision===w.plan.revision&&
 typeof p.plan.document_digest==='string'&&!!p.operation_id&&same(p.selection,s.selection);
}
function issuesHtml(w,issues){return w.table(['Severity','Original sample / order','Issue'],(issues||[]).map(x=>[esc(x.severity||''),esc(x.activity_id||x.order_id||''),esc(x.message||x.code||'')]),'No source issues reported.');}
function reconcileHtml(w,s){
 const r=s.reconciliation;if(!r)return '';
 const rows=r.orders||[],start=Math.min(s.reconciliation_page||0,Math.max(0,Math.ceil(rows.length/50)-1))*50;
 const summaries=Object.entries(r.summary||{}).map(([key,value])=>esc(key.replaceAll('_',' '))+': '+esc(typeof value==='object'?JSON.stringify(value):value)).join(' · ');
 return '<h4>Requested analyses and returned results</h4><p>Compared with original saved plan revision '+esc(r.plan?.revision)+'. '+summaries+'</p>'+
 w.table(['Order','Sample activity','Requested analysis','Return status','Original result IDs','Issues'],rows.slice(start,start+50).map(row=>[esc(row.order_id),esc(row.activity_id),'<b>'+esc(row.parameter)+'</b><br>'+esc(['unit','basis','fraction','method'].filter(key=>row[key]).map(key=>key+': '+row[key]).join(' · ')),esc(row.status)+(row.result_types?.length?'<br>'+esc(row.result_types.join(', ')):''),'<span>Matched: '+esc((row.observation_ids||[]).join(', ')||'None')+'</span>'+(row.ambiguous_observation_ids?.length?'<br><span>Competing: '+esc(row.ambiguous_observation_ids.join(', '))+'</span>':''),esc((row.issues||[]).map(x=>typeof x==='string'?x:x.message||x.code||JSON.stringify(x)).join('\n'))]),'No requested analysis rows.')+
 '<div class="iw-actions">'+button('reconcile-prev','Previous returns',start?'':'disabled')+'<span>Showing '+(rows.length?start+1:0)+'–'+Math.min(start+50,rows.length)+' of '+rows.length+'</span>'+button('reconcile-next','Next returns',start+50<rows.length?'':'disabled')+button('export-reconciliation','Export complete reconciliation')+'</div>'+
 '<details><summary>'+esc((r.unrequested_observation_ids||[]).length)+' results outside the requested order set</summary><pre class="iw-json">'+esc((r.unrequested_observation_ids||[]).join('\n'))+'</pre></details>'+
 '<details><summary>'+esc((r.preexisting_observation_ids||[]).length)+' unchanged original results predating this request</summary><p>These original saved records remain separate from new or changed laboratory returns.</p><pre class="iw-json">'+esc((r.preexisting_observation_ids||[]).join('\n'))+'</pre></details>';
}
function packageHtml(w,s){
 const p=s.active_package;if(!p)return '';
 return '<h4>Retained laboratory request package</h4><p>'+esc(p.label||p.selection?.label||p.dispatch_id)+' · original plan revision '+esc(p.original_revision??p.revision??p.plan?.revision)+'</p>'+
 '<p>'+w.nativeDownloads(p._downloads||[])+'</p><p>The request files retain the original sample IDs and explicit analyte orders. Complete the original return template with the laboratory’s actual values and result types; import it through Laboratory CSV results using the package’s mapping.</p>'+
 '<div class="iw-actions">'+button('reconcile','Compare with saved results')+button('export-package','Export package metadata')+button('open-intake','Open laboratory CSV intake')+'</div>'+reconcileHtml(w,s);
}
export function render(w){
 const s=w.labDispatch;
 if(!s)return '<section class="iw-notice"><h3>Laboratory requests and returns</h3><p>Prepare explicit requested analyses for original saved samples, retain their collection and custody context, and compare returned results with the saved request.</p>'+button('open','Prepare or reopen laboratory request')+'</section>';
 const disabled=busy(s)||w.pending?'disabled':'',all=samples(w.plan,s.sample_query),chosen=new Set(s.selected_activities||[]);
 const samplePage=Math.min(s.sample_page||0,Math.max(0,Math.ceil(all.length/50)-1));s.sample_page=samplePage;
 const orderPage=Math.min(s.order_page||0,Math.max(0,Math.ceil(s.selection.orders.length/50)-1));s.order_page=orderPage;
 const choices=campaignChoices(w.plan,[...chosen]);
 const input=(name,value,attrs='')=>'<input data-dispatch-field="'+name+'" value="'+esc(value??'')+'" '+disabled+' '+attrs+'>';
 const sampleRows=all.slice(samplePage*50,samplePage*50+50).map(({activity:a,site,visit})=>[
  '<input type="checkbox" data-dispatch-sample="'+esc(a.id)+'" aria-label="Select original sample '+esc(a.sample_id||a.id)+'" '+(chosen.has(a.id)?'checked':'')+' '+disabled+'>',
  esc(a.sample_id),esc(a.id),esc(site.label||site.id),esc(visit.id),esc(a.collected_at||'Not recorded'),esc(a.custody_ref||'Not recorded')]);
 const orderRows=s.selection.orders.slice(orderPage*50,orderPage*50+50).map((row,n)=>{const index=orderPage*50+n;
  return [esc(row.activity_id),...['parameter','unit','basis','fraction','method','notes'].map(key=>'<input data-dispatch-order="'+index+'" data-dispatch-key="'+key+'" aria-label="'+esc(key)+' for '+esc(row.activity_id)+'" value="'+esc(row[key]??'')+'" '+disabled+'>'),button('remove-order','Remove','data-index="'+index+'" '+disabled)];
 });
 const attachments=w.plan.source_links.filter(x=>x.kind==='local_file');
 const summary=s.preview?.summary;
 const preview=s.preview?'<section><h4>Review the original request</h4><p>Saved revision '+esc(s.preview.plan.revision)+' · '+esc(summary?.samples)+' samples · '+esc(summary?.orders)+' requested analyses · '+esc(summary?.attachments)+' attachments.</p>'+issuesHtml(w,s.preview.issues)+
 '<div class="iw-actions">'+button('prepare','Prepare retained request package',canPrepare(w)?'':'disabled')+button('export-preview','Export full request review')+'</div>'+
 (!canPrepare(w)&&s.preview.can_prepare?'<p>The current plan or selection differs from the reviewed revision. Save and review it again.</p>':'')+'</section>':'';
 return '<section class="iw-notice"><div class="iw-section-head"><h3>Laboratory requests and returns</h3>'+button('close','Close request controls',disabled)+'</div>'+
 '<p>Select original sample activities and explicitly add each requested analysis. Campaign parameters are optional source choices. Collection timestamps, custody references and site records retain their original values.</p>'+
 '<div class="iw-two">'+field('Request label (required)',input('label',s.selection.label,'required'))+field('Laboratory',input('laboratory',s.selection.laboratory))+
 field('Laboratory reference',input('laboratory_reference',s.selection.laboratory_reference))+field('Instructions','<textarea data-dispatch-field="instructions" '+disabled+'>'+esc(s.selection.instructions)+'</textarea>')+'</div>'+
 '<h4>Choose original samples</h4>'+field('Search sample, site, collection or custody','<input type="search" data-dispatch-filter="sample_query" value="'+esc(s.sample_query)+'" '+disabled+'>')+
 '<p>'+chosen.size+' selected · '+all.length+' matching original samples.</p><div class="iw-actions">'+button('select-matching','Select all matching samples',disabled)+button('clear-samples','Clear selected samples',disabled)+'</div>'+
 w.table(['Select','Original sample ID','Activity ID','Site','Visit','Actual collection timestamp','Original custody reference'],sampleRows,'No original sample activities match this view.')+
 '<div class="iw-actions">'+button('samples-prev','Previous samples',samplePage?disabled:'disabled')+'<span>Page '+(samplePage+1)+' of '+Math.max(1,Math.ceil(all.length/50))+'</span>'+button('samples-next','Next samples',samplePage*50+50<all.length?disabled:'disabled')+'</div>'+
 '<h4>Add an explicit requested analysis</h4>'+
 (choices.length?field('Optional original campaign parameter','<select data-dispatch-campaign '+disabled+'>'+option('','Choose a source parameter explicitly','')+choices.map(row=>option(row.key,row.parameter+' — '+row.title,'')).join('')+'</select>'):'')+
 '<div class="iw-two">'+['parameter','unit','basis','fraction','method','notes'].map(key=>field(({parameter:'Requested parameter',unit:'Requested unit (optional)',basis:'Chemical basis (optional)',fraction:'Fraction (optional)',method:'Method (optional)',notes:'Analysis notes'})[key],'<input data-dispatch-analyte="'+key+'" value="'+esc(s.draft_analyte[key]||'')+'" '+disabled+'>')).join('')+'</div>'+
 '<p>Optional unit, basis, fraction and method restrict the requested analysis and its return comparison. Leave a field blank when the request does not specify it.</p>'+button('add-orders','Add analysis to selected samples',disabled)+
 '<h4>'+s.selection.orders.length+' explicit requested analyses</h4>'+w.table(['Original activity','Parameter','Unit','Basis','Fraction','Method','Notes',''],orderRows,'Select original samples and add an explicit analysis.')+
 '<div class="iw-actions">'+button('orders-prev','Previous orders',orderPage?disabled:'disabled')+'<span>Page '+(orderPage+1)+' of '+Math.max(1,Math.ceil(s.selection.orders.length/50))+'</span>'+button('orders-next','Next orders',orderPage*50+50<s.selection.orders.length?disabled:'disabled')+'</div>'+
 '<details><summary>Original files to include ('+s.selection.attachment_source_ids.length+')</summary>'+w.table(['Include','Original file','Source identity'],attachments.map(link=>['<input type="checkbox" data-dispatch-attachment="'+esc(link.id)+'" aria-label="Include '+esc(link.label||link.id)+'" '+(s.selection.attachment_source_ids.includes(link.id)?'checked':'')+' '+disabled+'>',esc(link.label||link.id),esc(link.id)]),'No original local files in this plan.')+'</details>'+
 '<div class="iw-actions">'+button('preview',w.dirty||!w.nativePlan?'Save plan and review request':'Review saved request',disabled)+button('refresh','Refresh retained requests',disabled)+'</div>'+preview+
 '<h4>Retained requests for this plan</h4>'+w.table(['Request','Original revision','Samples / analyses','Open'],(s.items||[]).map(item=>[esc(item.label||item.dispatch_id),esc(item.original_revision??item.revision),esc((item.summary?.samples??'')+' / '+(item.summary?.orders??'')),button('open-package','Open original request','data-id="'+esc(item.dispatch_id)+'" '+disabled)]),'No retained request packages returned for this plan.')+packageHtml(w,s)+'</section>';
}
async function saveFirst(w,s,next){
 if(!w.dirty&&w.nativePlan&&same(w.plan,w.nativePlan))return false;
 s.stage='saving';s.after_save=next;s.operation_id=null;w.cache();
 try{const kind=w.importedFile?'implementation.plan.import':w.nativePlan?'implementation.plan.save':'implementation.plan.create';await w.queue(kind,{document:w.plan,expected_revision:w.plan.revision});}
 catch(error){if(!w.pending&&!s.operation_id){s.stage='editing';s.after_save=null;w.cache();}throw error;}
 return true;
}
async function request(w,operation,body){return w.host.api('/api/implementation/'+operation,{method:'POST',body:{workspace:w.workspace,...body}});}
async function refresh(w){
 const s=w.labDispatch,turn=w.generation;s.stage='loading';w.cache();w.render();
 try{const result=await w.read('/api/implementation/dispatches',{plan_id:w.plan.id});if(!current(w,s,turn))return;if(!Array.isArray(result.items))throw Error('The original request catalogue did not return its saved packages.');s.items=result.items;s.stage='editing';w.cache();w.render();}
 catch(error){if(current(w,s,turn)){s.stage='editing';w.cache();w.render();}throw error;}
}
async function preview(w){
 editable(w);const s=w.labDispatch;if(await saveFirst(w,s,'preview'))return;
 const turn=w.generation,selected=clone(w.plan),selection=clone(s.selection);s.stage='previewing';s.preview=null;w.cache();w.render();
 try{
  const p=await request(w,'dispatch-preview',{plan_id:selected.id,revision:selected.revision,selection});
  if(!current(w,s,turn))return;
  if(p?.schema!==PREVIEW||p.plan?.id!==selected.id||p.plan.revision!==selected.revision||!p.plan.document_digest||!p.operation_id)throw Error('The request review does not identify the original saved plan revision.');
  if(!same(selected,w.plan)||!same(selection,s.selection)){s.stage='editing';w.cache();w.render();throw Error('The plan or request changed while its original review was being prepared. Review it again.');}
  s.selection=clone(p.selection);s.preview=p;s.stage='review';w.cache();w.render();
 }catch(error){if(current(w,s,turn)){s.stage='editing';w.cache();w.render();}throw error;}
}
async function prepare(w){
 editable(w);if(!canPrepare(w))throw Error('Save and review the exact original sample request before preparing its package.');
 const s=w.labDispatch,p=s.preview;s.stage='preparing';s.operation_id=null;w.cache();
 try{await w.queue('implementation.lab.dispatch',{plan_id:p.plan.id,revision:p.plan.revision,document_digest:p.plan.document_digest,selection:p.selection,dispatch_operation_id:p.operation_id});}
 catch(error){if(!w.pending&&!s.operation_id){s.stage='review';w.cache();}throw error;}
}
async function openPackage(w,id){
 editable(w);const s=w.labDispatch,turn=w.generation;s.stage='opening';s.reconciliation=null;w.cache();w.render();
 try{
  const p=await w.read('/api/implementation/dispatch-detail',{plan_id:w.plan.id,dispatch_id:id});if(!current(w,s,turn))return;
  if(p?.dispatch_id!==id||(p.plan_id||p.plan?.id)!==w.plan.id)throw Error('The retained request belongs to another original plan.');
  s.active_package=p;s.stage='editing';w.cache();w.render();
 }catch(error){if(current(w,s,turn)){s.stage='editing';w.cache();w.render();}throw error;}
}
async function reconcile(w){
 editable(w);const s=w.labDispatch;if(!s.active_package?.dispatch_id)throw Error('Open an original request package first.');
 if(await saveFirst(w,s,'reconcile'))return;
 const turn=w.generation,selected=clone(w.plan),id=s.active_package.dispatch_id;s.stage='reconciling';s.reconciliation=null;w.cache();w.render();
 try{
  const r=await request(w,'dispatch-reconcile',{plan_id:selected.id,revision:selected.revision,dispatch_id:id});
  if(!current(w,s,turn))return;
  if(r?.schema!==RECONCILIATION||r.dispatch_id!==id||r.plan?.id!==selected.id||r.plan.revision!==selected.revision||!r.plan.document_digest)throw Error('The return comparison does not identify this original request and saved revision.');
  if(!same(selected,w.plan)){s.stage='editing';w.cache();w.render();throw Error('The plan changed during comparison. Save and compare the current records again.');}
  s.reconciliation=r;s.reconciliation_page=0;s.stage='editing';w.cache();w.render();
 }catch(error){if(current(w,s,turn)){s.stage='editing';w.cache();w.render();}throw error;}
}
export function validateReceipt(w,pending,result){
 if(result?.schema!==PACKAGE||result.plan_id!==pending.plan_id||result.revision!==pending.payload.revision||result.document_digest!==pending.payload.document_digest||result.operation_id!==pending.payload.dispatch_operation_id||!result.dispatch_id||!['prepared','reconnected'].includes(result.status))throw Error('The prepared request differs from the retained original dispatch operation.');
}
export async function finish(w,pending,result){
 const s=w.labDispatch;if(!s||s.plan_id!==pending.plan_id||s.operation_id!==pending.operation_id)return;
 if(pending.action==='implementation.lab.dispatch'){
  validateReceipt(w,pending,result);s.active_package=clone(result);s.stage='editing';s.operation_id=null;s.preview=null;s.reconciliation=null;
  w.pending=null;w.message='Original laboratory request package prepared for saved revision '+result.revision+'.'+(w.dirty?' Later browser edits remain in this draft.':'');
  w.cache();w.render();try{await refresh(w);}catch(error){if(!w.gone&&w.labDispatch===s){w.error=error?.message||String(error);w.message='The original laboratory package is prepared and its downloads remain available. Refresh retained requests to reopen the catalogue.';w.cache();w.render();}}return;
 }
 if(s.stage==='saving'){
  const next=s.after_save;s.stage='editing';s.operation_id=null;s.after_save=null;w.cache();
  if(w.dirty){w.message='The plan revision was saved. Later browser edits remain; save and review them before continuing the laboratory request.';w.render();return;}
  if(next==='preview')await preview(w);else if(next==='reconcile')await reconcile(w);
 }
}
export async function act(w,b){
 const action=b.dataset.impl.slice(9);
 if(action==='open'){editable(w);if(!w.labDispatch)w.labDispatch=state(w.plan);w.tab='field';w.cache();await refresh(w);return;}
 if(action==='close'){editable(w);w.labDispatch=null;w.cache();w.render();return;}
 if(action==='open-intake'){editable(w);const s=w.labDispatch,turn=w.generation,lab=await w.labCapability();if(current(w,s,turn))await lab.act(w,{dataset:{impl:'lab-open'}});return;}
 if(action==='preview')return preview(w);
 if(action==='prepare')return prepare(w);
 if(action==='refresh'){editable(w);return refresh(w);}
 if(action==='open-package')return openPackage(w,b.dataset.id);
 if(action==='reconcile')return reconcile(w);
 const s=w.labDispatch;if(!s)return;
 if(action==='export-preview'){if(!s.preview)throw Error('Review the original request first.');download(w.plan.id+'-lab-request-review.json',s.preview);return;}
 if(action==='export-package'){if(!s.active_package)throw Error('Open an original request first.');download(s.active_package.dispatch_id+'-package.json',s.active_package);return;}
 if(action==='export-reconciliation'){if(!s.reconciliation)throw Error('Compare saved results first.');download(s.reconciliation.dispatch_id+'-returned-results.json',s.reconciliation);return;}
 if(action.endsWith('-prev')||action.endsWith('-next')){
  const key=action.startsWith('samples-')?'sample_page':action.startsWith('orders-')?'order_page':'reconciliation_page';
  s[key]=Math.max(0,(s[key]||0)+(action.endsWith('-prev')?-1:1));w.cache();w.render();return;
 }
 editable(w);
 if(action==='select-matching'){s.selected_activities=[...new Set([...s.selected_activities,...samples(w.plan,s.sample_query).map(row=>row.activity.id)])];w.cache();w.render();return;}
 if(action==='clear-samples'){s.selected_activities=[];w.cache();w.render();return;}
 if(action==='add-orders'){
  if(!s.draft_analyte.parameter.trim())throw Error('Enter an explicit requested parameter.');
  const allowed=new Set(samples(w.plan).map(row=>row.activity.id)),selected=s.selected_activities.filter(id=>allowed.has(id));if(!selected.length)throw Error('Select original sample activities first.');
  for(const activity_id of selected)s.selection.orders.push({activity_id,...clone(s.draft_analyte)});
  touch(w,s);w.render();return;
 }
 if(action==='remove-order'){const index=Number(b.dataset.index);if(!Number.isInteger(index)||index<0||index>=s.selection.orders.length)throw Error('The requested analysis row changed. Reopen it.');s.selection.orders.splice(index,1);touch(w,s);w.render();}
}
export async function change(w,e){
 const t=e.target,s=w.labDispatch;if(!s)return;editable(w);
 if(t.dataset.dispatchFilter){s.sample_query=t.value;s.sample_page=0;w.cache();w.render();return;}
 if(t.hasAttribute('data-dispatch-campaign')){
  const chosen=campaignChoices(w.plan,s.selected_activities).find(row=>row.key===t.value);if(chosen)s.draft_analyte.parameter=chosen.parameter;w.cache();w.render();return;
 }
 if(t.dataset.dispatchSample){const set=new Set(s.selected_activities);if(t.checked)set.add(t.dataset.dispatchSample);else set.delete(t.dataset.dispatchSample);s.selected_activities=[...set];w.cache();w.render();return;}
 if(t.dataset.dispatchAnalyte){s.draft_analyte[t.dataset.dispatchAnalyte]=t.value;w.cache();return;}
 if(t.dataset.dispatchField){s.selection[t.dataset.dispatchField]=t.value;touch(w,s);w.render();return;}
 if(t.hasAttribute('data-dispatch-order')){
  const index=Number(t.dataset.dispatchOrder),key=t.dataset.dispatchKey;if(!Number.isInteger(index)||!s.selection.orders[index]||!['parameter','unit','basis','fraction','method','notes'].includes(key))throw Error('The original requested analysis changed.');
  s.selection.orders[index][key]=t.value;touch(w,s);w.render();return;
 }
 if(t.dataset.dispatchAttachment){const set=new Set(s.selection.attachment_source_ids);if(t.checked)set.add(t.dataset.dispatchAttachment);else set.delete(t.dataset.dispatchAttachment);s.selection.attachment_source_ids=[...set];touch(w,s);w.render();}
}

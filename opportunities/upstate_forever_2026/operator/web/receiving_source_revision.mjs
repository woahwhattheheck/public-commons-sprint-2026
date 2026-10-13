/** Explicit source-edition drafts; original Receiving remains the study writer. */
import {attachReceivingSourcePicker} from './receiving_water_sources.mjs';
import {selectionObject,copySelection} from './receiving_water_editing.mjs';
const API='/api/receiving-source-impact';
function safeSelection(value){
 const visit=row=>{if(typeof row==='number'&&(!Number.isFinite(row)||(Number.isInteger(row)&&!Number.isSafeInteger(row))))throw Error('This retained selection has numbers outside exact browser integer support. Download the exact server draft for native editing.');
  if(row&&typeof row==='object')for(const item of Object.values(row))visit(item);};
 visit(value);return selectionObject(value);
}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=value=>JSON.stringify(value,null,2);
const sameSource=(a,b)=>a?.source_collection_id===b?.source_collection_id&&a?.source_id===b?.source_id;
const button=(action,label,extra='')=>'<button type="button" data-rwr-action="'+action+'" '+extra+'>'+esc(label)+'</button>';
const code=value=>'<code>'+esc(value)+'</code>';

export function attachReceivingSourceRevision(context){
 const {getState,api,endpoint,openExtension}=context;
 const picker=attachReceivingSourcePicker(context);
 let root=null,state=null,generation=0,serial=0,handoffRequest=0;
 const workspace=()=>getState()?.workspace_key??null;
 const live=(token,ws)=>root?.isConnected&&generation===token&&state?.workspace===ws&&workspace()===ws;
 function detach(){generation++;serial++;picker.detach();root=null;state=null;}
 function renderInto(container){
  if(root!==container){picker.detach();serial++;root=container;if(state?.busy){state.busy=false;state.error='The impact view refreshed during revision reading. Reload the original revision or review the retained choices again.';}}
  if(state&&state.workspace!==workspace()){detach();root=container;}
  render();
 }
 async function read(action,payload){
  const ws=workspace(),result=await api(endpoint(API),{method:'POST',body:{workspace:ws,action,payload}});
  if(workspace()!==ws||result?.workspace_key!==ws)throw Error('The source revision belongs to another workspace. Reopen it.');
  return result;
 }
 const request=()=>({...state.request,record_sha256:state.options.record_sha256,
  choices:[...state.choices.values()].map(copySelection),
  ...(state.request.kind==='analyses'?{use_successors:state.useSuccessors,plan_id:state.planId}:{})});
 function invalidate(){serial++;state.draft=null;state.error='';}
 function planOptions(){
  const data=getState()?.data||{},water=data.receiving_waters||data,rows=(water.receiving_water_plans||[]).filter(row=>row.state==='complete');
  const all=[...rows];for(const id of [state.options.plan.id,state.planId])if(id&&!all.some(row=>row.id===id))all.push({id,title:'Retained source plan '+id.slice(0,12)});
  return all.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===state.planId?' selected':'')+'>'+esc(row.title||row.id)+'</option>').join('');
 }
 function sources(){
  const rows=state.options.bindings,needle=state.search.trim().toLocaleLowerCase();
  const shown=needle?rows.filter(row=>[row.path,row.receptor_id,row.role,row.original.source_id,row.replacement?.source_id].join(' ').toLocaleLowerCase().includes(needle)):rows;
  const pages=Math.max(1,Math.ceil(shown.length/10));state.page=Math.min(state.page,pages-1);
  const page=shown.slice(state.page*10,state.page*10+10);
  return '<p>Keep an original binding, or explicitly choose its mapped replacement. Layer, attribute filters and native feature IDs start unselected for a new edition. Applying the chooser confirms actual retained membership; it does not move the original declarations or evidence to a new edition automatically.</p>'+
   '<label>Find an original source or area<input data-rwr-search value="'+esc(state.search)+'" placeholder="Area ID, source, or retained field"></label>'+
   '<p>'+shown.length+' matching binding(s) · '+state.choices.size+' explicit replacement(s) retained across all pages</p>'+
   page.map(row=>{
    const choice=state.choices.get(row.id);
    return '<article class="rw-revision-binding" data-rwr-binding="'+esc(row.id)+'"><h4>'+esc(row.receptor_id||row.path)+'</h4><p>'+esc(row.role.replaceAll('_',' '))+'</p>'+
     '<div class="rw-impact-columns"><div><strong>Retained original</strong>'+code(row.original.source_id)+code(row.original.source_collection_id)+'</div><div><strong>Saved mapped replacement</strong>'+
     (row.replacement?code(row.replacement.source_id)+code(row.replacement.source_collection_id):'<p>Unmapped. Original binding remains retained.</p>')+'</div></div>'+
     '<p class="rw-impact-review">'+(choice?'Explicit replacement confirmed; review the complete selection before saving.':'Original binding retained; no replacement selected.')+'</p>'+
     (row.problem?'<p>'+esc(row.problem)+'</p>':'')+
     '<details><summary>Original selector, saved change reason and evidence boundary</summary><pre>'+esc(json({selector:row.original,relation:row.relation,change:row.change}))+'</pre>'+
     '<p>Other original metadata, classifications, intake references and evidence remain in the complete original selection. Confirm which declarations still describe this geometry; native feature ID reuse alone establishes no such association.</p></details>'+
     (choice?'<details><summary>Confirmed replacement selector</summary><pre>'+esc(json(choice))+'</pre></details>':'')+
     '<div class="rw-impact-toolbar">'+button('pick','Choose mapped original features','data-id="'+esc(row.id)+'"'+(row.problem?' disabled':''))+
     (choice?button('keep','Keep original binding','data-id="'+esc(row.id)+'"'):'')+'</div><div data-rwr-picker="'+esc(row.id)+'"></div></article>';
   }).join('')+
   (!page.length?'<p>No bindings match this filter. Existing choices remain retained.</p>':'')+
   '<div class="rw-impact-toolbar">'+button('previous','Previous bindings',state.page===0?'disabled':'')+
   '<span>Page '+(state.page+1)+' of '+pages+'</span>'+button('next','Next bindings',state.page+1>=pages?'disabled':'')+'</div>';
 }
 function analyses(){
  const check=state.options.successor_check;
  return '<p>Choose a saved source plan and whether to adopt the recorded successor cohort. Pollutants, quantities, weights, caps, normalization, accounting and all other original analysis settings are retained for explicit review.</p>'+
   '<label>Complete saved source plan<select data-rwr-plan>'+planOptions()+'</select></label>'+
   '<p>To revise geometry first, return to this analysis’s source plan, confirm its replacements and save that plan through the original editor. Then choose its actual returned ID here.</p>'+
   '<label class="rw-revision-check"><input type="checkbox" data-rwr-successors '+(state.useSuccessors?'checked ':'')+(!check?.compatible?'disabled':'')+'> Use the currently complete mapped native cohort</label>'+
   '<p>'+esc(check?.message||'No checked successor cohort is available.')+'</p><p>'+esc(check?.scope||'')+'</p>'+
   '<div class="rw-impact-scroll"><table><thead><tr><th>Original run</th><th>Saved successor</th><th>Current admission</th></tr></thead><tbody>'+
   (check?.runs||[]).map((row,index)=>'<tr><td><strong>'+(index?'Alternative '+index:'Baseline')+'</strong>'+code(row.original_id)+'</td><td>'+code(row.successor_id||'Unmapped')+'</td><td>'+esc(row.state)+(row.reused_original?' · original reused':'')+'<p>'+esc(row.message||'')+'</p></td></tr>').join('')+'</tbody></table></div>'+
   '<p>Completion/grid/profile/land-cover checks are limited to the original cohort contract. Actual pollutant artifacts, geographic support, topology and accounting remain the original analysis engine’s authority.</p>';
 }
 function render(){
  if(!root)return;
  if(!state){root.replaceChildren();return;}
  const s=state,o=s.options,d=s.draft;
  root.innerHTML='<section class="rw-impact-detail rw-source-revision" data-receiving-source-revision data-kind="'+esc(s.request.kind)+'" aria-busy="'+s.busy+'">'+
   '<header><h3>'+(s.request.kind==='plans'?'Review source-edition replacements':'Review analysis successors')+'</h3>'+button('close','Close revision')+'</header>'+
   (s.error?'<p class="rw-impact-error" role="alert">'+esc(s.error)+'</p>':'')+
   (!o&&!s.busy?button('reload','Reload original revision'):'')+
   (s.busy?'<p data-rwr-loading role="status">'+esc(s.message||'Reading exact retained revision…')+'</p>':'')+
   (o?'<p>Original '+esc(s.request.kind==='plans'?'source plan':'analysis')+' '+code(o.record_id)+'</p>'+
    (s.safe?(s.request.kind==='plans'?sources():analyses()):'<p>The full original contains numeric values the browser cannot preserve exactly. Download the server-serialized draft and use the original native selection editor; no number has been silently rounded into a revision.</p>')+
    '<div class="rw-impact-toolbar">'+(s.safe?button('review','Review complete draft'):'')+button('download','Download exact revision draft')+'</div>':'')+
   (d?'<section data-rwr-ready data-draft="'+esc(d.draft_id)+'"><h4>Complete original-editor draft</h4><p>'+esc(d.interpretation)+'</p>'+
    '<p>Explicitly changed fields: '+esc(d.changed_paths.length?d.changed_paths.join(', '):'none; original selection retained')+'</p>'+
    (d.missing_accounting?.length?'<p class="rw-impact-error">Original accounting references missing from the selected plan. Correct or explicitly remove these in the original editor before saving.</p><ul>'+
     d.missing_accounting.map(row=>'<li>'+esc(row.group_id)+' · '+esc(row.field)+' · '+esc(row.id)+'</li>').join('')+'</ul>':'')+
    '<details><summary>Verified replacement source identities</summary><pre>'+esc(json(d.validated_sources))+'</pre></details>'+
    '<details><summary>Full preserved selection</summary><pre>'+esc(json(d.selection))+'</pre></details>'+
    button('open-editor','Open existing Receiving editor')+'<p>The original editor remains editable. Its normal Save button queues preparation or analysis; this review has saved no study or model run.</p></section>':'')+'</section>';
  if(s.busy)root.querySelectorAll('button,input,select').forEach(node=>{if(node.dataset.rwrAction!=='close')node.disabled=true;});
  root.onclick=click;root.onchange=change;
 }
 async function open({container,...requestValues}){
  handoffRequest++;detach();root=container;const token=generation,ws=workspace();
  state={workspace:ws,request:requestValues,options:null,choices:new Map(),planId:'',useSuccessors:false,search:'',page:0,draft:null,error:'',busy:true,message:'Reading the original saved selection and current source mappings…',safe:false};
  render();const requestId=++serial;
  try{
   const value=await read('revision-options',requestValues);
   if(!live(token,ws)||requestId!==serial)return;
   state.options=value;state.planId=value.plan.id;
   try{safeSelection(value.original_selection);state.safe=true;}catch(error){state.error=error.message;}
  }catch(error){if(live(token,ws)&&requestId===serial)state.error=error.message;}
  finally{if(live(token,ws)&&requestId===serial){state.busy=false;render();}}
 }
 async function pick(key){
  const binding=state.options.bindings.find(row=>row.id===key);
  if(!binding||binding.problem)throw Error('Choose an available mapped vector binding.');
  const token=generation,ws=workspace(),s=state,previous=state.choices.get(key);
  const seed=previous?copySelection(previous.source):{
   source_collection_id:binding.replacement.source_collection_id,source_id:binding.replacement.source_id,
   where:{},...(binding.mode==='catchments'?{id_field:binding.original.id_field||'',downstream_field:binding.original.downstream_field||''}:{})
  };
  if(binding.mode==='receptor')Object.assign(seed,previous?.relation||{
   method:binding.relation.method,rationale:binding.relation.rationale||'',buffer_m:binding.relation.buffer_m
  });
  const slot=root.querySelector('[data-rwr-picker="'+key+'"]');
  await picker.open({container:slot,mode:binding.mode,selection:seed,
   isCurrent:()=>live(token,ws)&&state===s&&!state.busy&&root.contains(slot),
   onApply:value=>{
    if(!live(token,ws)||state!==s)throw Error('The original source revision changed.');
    if(!sameSource(value,binding.replacement))throw Error('Choose the exact mapped replacement source shown above.');
    const source={};for(const name of ['source_collection_id','source_id','layer','where','feature_ids','id_field','downstream_field'])if(value[name]!==undefined)source[name]=copySelection(value[name]);
    const chosen={binding_id:key,source};
    if(binding.mode==='receptor'){
     chosen.relation={method:value.method,rationale:value.rationale};
     if(value.buffer_m!==undefined)chosen.relation.buffer_m=value.buffer_m;
    }
    invalidate();state.choices.set(key,chosen);picker.detach();render();
   }});
 }
 async function prepare(download=false){
  if(!state.options)throw Error('Read the original saved selection first.');
  const token=generation,ws=workspace(),requestId=++serial,values=request();
  picker.detach();state.draft=null;state.busy=true;state.error='';state.message='Checking the selected original sources and current run mappings…';render();
  try{
   const value=await read(download?'revision-download':'revision-draft',values);
   if(!live(token,ws)||requestId!==serial)return;
   if(download){
    if(typeof value.content!=='string')throw Error('The exact server-side draft download is unavailable.');
    const url=URL.createObjectURL(new Blob([value.content],{type:'application/json;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=value.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }else{safeSelection(value.selection);state.draft=value;}
  }catch(error){if(live(token,ws)&&requestId===serial)state.error=error.message;}
  finally{if(live(token,ws)&&requestId===serial){state.busy=false;render();}}
 }
 async function dispatch(action,node){
  if(!state||state.workspace!==workspace())return;
  if(action==='close'){detach();node.closest('[data-receiving-source-revision]')?.remove();return;}
  if(state.busy)return;
  if(action==='reload')return open({container:root,...state.request});
  if(action==='pick')return pick(node.dataset.id);
  if(action==='keep'){invalidate();state.choices.delete(node.dataset.id);picker.detach();render();}
  else if(action==='previous'||action==='next'){picker.detach();state.page=Math.max(0,state.page+(action==='next'?1:-1));render();}
  else if(action==='review'||action==='download')return prepare(action==='download');
  else if(action==='open-editor'){
   if(!state.draft)throw Error('Review this complete draft before opening its original editor.');
   const value={workspace_key:state.workspace,request:request(),draft_id:state.draft.draft_id};
   await openExtension('receiving-waters','openSourceRevision',value);
  }
 }
 function click(event){
  const node=event.target.closest('[data-rwr-action]');if(!node||!root?.contains(node)||node.disabled)return;
  event.preventDefault();event.stopPropagation();
  const s=state,action=node.dataset.rwrAction,ws=workspace(),token=generation,handoff=++handoffRequest;
  Promise.resolve(dispatch(action,node)).catch(error=>{
   if(action==='open-editor'&&handoff!==handoffRequest)return;
   if(state===s&&root){state.error=error.message;render();}
   else if(action==='open-editor'&&workspace()===ws&&generation===token+1&&
           context.getView?.()==='receiving-waters'){
    context.toast('Receiving revision could not open: '+error.message);
   }
  });
 }
 function change(event){
  if(!state||state.busy)return;
  if(event.target.matches('[data-rwr-search]')){picker.detach();state.search=event.target.value;state.page=0;render();}
  if(event.target.matches('[data-rwr-plan]')){invalidate();state.planId=event.target.value;render();}
  if(event.target.matches('[data-rwr-successors]')){invalidate();state.useSuccessors=event.target.checked;render();}
 }
 return {open,renderInto,detach};
}

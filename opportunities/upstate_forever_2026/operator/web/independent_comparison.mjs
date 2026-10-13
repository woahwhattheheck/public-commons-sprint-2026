/** Independent scientific source comparisons in the original authenticated Workspace. */
import {draftScope,openComparisonDraftStore} from './independent_comparison_state.mjs';
import {renderIndependentFigures,moveIndependentFigure} from './independent_comparison_figures.mjs';
import {renderPublisherBudget,selectPublisherBudget,buildPublisherBudgetReport,buildPublisherBudgetSvg,buildPublisherBudgetCsv,buildPublisherBudgetJson} from './sparrow_budget_figures.mjs';
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const list=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const need=(ok,message)=>{if(!ok)throw Error(message);};
const uuid=()=>crypto.randomUUID();
const id=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const mappingFields=['record_id','catchment_id','parameter','value','unit','period_start','period_end','qualifier','method','uncertainty','source_records','parameter_code','species','source_constituent'];
const supports=['landscape_to_stream','station_catchment_load','reach_incremental','reach_accumulated','point_source_discharge','concentration','other'];
const definitionFields=['quantity','source_support','fraction','temporal_basis','spatial_basis','method','source_period','lineage'];
const quantityOptions=[['annual_mass_rate','Annual mass rate'],['concentration','Concentration'],['areal_yield','Mass per area per time']];
const fractionOptions=[['total_nitrogen','Total nitrogen'],['total_phosphorus','Total phosphorus'],['total_sediment','Total sediment']];
const kinds=['field_load_estimate','external_model_estimate','reported_effluent','concentration','other'];
const empty=()=>({schema:'upstate.independent-comparison-selection/v1',title:'Independent source comparison',author:'',interpretation:'',notes:[],parent_id:null,native_comparison_id:'',reference:{source_collection_id:'',source_id:'',source_sha256:'',format:'csv',columns:{},defaults:{},parameter_map:{},definition:{evidence_kind:'external_model_estimate',quantity:'',source_support:'',fraction:'',temporal_basis:'',spatial_basis:'',method:'',source_period:'',lineage:'',reference_ids:[]}},pairs:[],input_sha256:'',producers:{}});
const initial=()=>({selection:empty(),pending:null,requests:[],history:[],raw:'',rawDirty:false,view:{tab:'selection',page:0,query:'',opened:''}});
const option=(v,l,s)=>'<option value="'+esc(v)+'"'+(String(v)===String(s)?' selected':'')+'>'+esc(l)+'</option>';
const button=(a,l,extra='')=>'<button type="button" data-ic="'+esc(a)+'" '+extra+'>'+esc(l)+'</button>';
const field=(name,label,value,{type='text',max=8000}={})=>'<label>'+esc(label)+'<input data-field="'+esc(name)+'" type="'+type+'" maxlength="'+max+'" value="'+esc(value)+'"></label>';
const textarea=(name,label,value,max=32000)=>'<label>'+esc(label)+'<textarea data-field="'+esc(name)+'" maxlength="'+max+'">'+esc(value)+'</textarea></label>';
const table=(heads,rows)=>'<div class="ic-scroll" tabindex="0" role="region" aria-label="Complete comparison table"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
const pretty=value=>JSON.stringify(value,null,2);
const download=(name,value,type='application/json')=>{const text=typeof value==='string'?value:pretty(value)+'\n';const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const safeDownload=url=>typeof url==='string'&&/^\/api\/file\//.test(url);
const numbers=value=>typeof value==='number'?value.toLocaleString(undefined,{maximumSignificantDigits:8}):value??'';
export function attachIndependentComparison(host){
  const {getState,api,endpoint,openDesk,openScientificReport,showTask,refreshState}=host;
  const contexts=new Map();let root=null,ctx=null,epoch=0,events=null;
  globalThis.addEventListener('beforeunload',event=>{if([...contexts.values()].some(x=>x.dirty||x.busy||x.state.pending||(x.blocked&&x.state.history.length))){event.preventDefault();event.returnValue='';}});
  const activeScope=()=>draftScope(getState()),scopeKey=s=>canonical(s);
  const alive=(c,g)=>root&&ctx===c&&epoch===g&&scopeKey(activeScope())===scopeKey(c.scope);
  const node=s=>root?.querySelector(s);
  function status(message,error=false){if(node('[data-status]')){node('[data-status]').textContent=message;node('[data-status]').classList.toggle('ic-error',error);}}
  function localContext(scope){
    const k=scopeKey(scope);if(!contexts.has(k))contexts.set(k,{scope,store:openComparisonDraftStore(scope),state:initial(),revision:0,loaded:false,blocked:false,error:'',dirty:false,busy:false,timer:null,tail:Promise.resolve(),catalog:null,fitContext:null,fitLoading:false,fitError:'',predictionContext:null,predictionLoading:false,predictionError:'',inputs:null,preview:null,previewKey:'',opened:null,readEpoch:0,conflicts:[]});return contexts.get(k);
  }
  function queueSave(c){
    clearTimeout(c.timer);c.timer=null;const snapshot=clone(c.state);
    c.tail=c.tail.catch(()=>{}).then(async()=>{
      if(c.blocked){try{await c.store.preserve(snapshot,c.error||'Unresolved earlier saved-draft conflict');}catch(error){c.error=error.message;}return false;}
      try{const result=await c.store.save(snapshot,c.revision);
        if(result.state==='conflict'){c.blocked=true;c.error='Another tab saved this original draft. Your complete version is retained in Conflicting drafts.';return false;}
        c.revision=result.record.revision;if(canonical(c.state)===canonical(snapshot))c.dirty=false;return true;
      }catch(error){c.blocked=true;c.error='Local save failed: '+error.message+'. Download the complete working draft before closing.';return false;}
      finally{if(ctx===c&&root)paintStatus(c);}
    });return c.tail;
  }
  function paintStatus(c){
    if(ctx!==c||!root)return;
    if(c.blocked)status(c.error,true);
    const disabled=c.busy||c.blocked||!!c.state.pending;
    root?.querySelectorAll('[data-editor] input,[data-editor] select,[data-editor] textarea,[data-mutator],[data-guided-mutator]').forEach(e=>e.disabled=disabled);
    if(c.state.rawDirty)root?.querySelectorAll('[data-guided] input,[data-guided] select,[data-guided] textarea,[data-guided-mutator]').forEach(e=>e.disabled=true);
    const save=node('[data-ic="save"]');if(save)save.disabled=disabled||c.state.rawDirty||!c.preview||c.previewKey!==canonical(c.state.selection);
    const preview=node('[data-ic="preview"]');if(preview)preview.disabled=disabled||c.state.rawDirty||!c.inputs;
    const resume=node('[data-ic="resume"]');if(resume)resume.disabled=c.busy||c.blocked||!c.state.pending;
    const raw=node('[data-ic="apply-raw"]');if(raw)raw.disabled=disabled||!c.state.rawDirty;
  }
  function changed(c){c.dirty=true;c.preview=null;c.previewKey='';clearTimeout(c.timer);c.timer=setTimeout(()=>queueSave(c),350);paintStatus(c);}
  async function flush(c){clearTimeout(c.timer);c.timer=null;if(c.dirty)await queueSave(c);else await c.tail.catch(()=>{});need(!c.blocked,c.error);return true;}
  function editable(c){need(!c.busy&&!c.blocked&&!c.state.pending,'Finish the original retained request or recover the current draft before editing.');need(!c.state.rawDirty,'Apply or explicitly discard the advanced JSON draft before changing guided choices.');}
  function archive(c,reason){c.state.history.push({at:new Date().toISOString(),reason,selection:clone(c.state.selection),raw:c.state.raw,rawDirty:c.state.rawDirty,view:clone(c.state.view)});}
  function selectionValid(s){
    need(s&&s.schema==='upstate.independent-comparison-selection/v1'&&typeof s==='object'&&!Array.isArray(s)&&s.reference&&typeof s.reference==='object'&&Array.isArray(s.pairs),'Retain the complete comparison selection, reference mapping and pairs.');
    need(typeof s.title==='string'&&typeof s.author==='string'&&typeof s.interpretation==='string'&&Array.isArray(s.notes)&&s.notes.every(x=>typeof x==='string'),'Retain the original title, author and interpretation fields.');
    need(typeof s.native_comparison_id==='string'&&[s.reference.columns,s.reference.defaults,s.reference.definition].every(v=>v&&typeof v==='object'&&!Array.isArray(v)),'Retain complete native and independent reference selectors.');
    need(s.pairs.every(p=>p&&typeof p==='object'&&typeof p.id==='string'&&typeof p.native_observation_id==='string'&&Number.isSafeInteger(p.reference_row_number)&&p.reference_row_number>0&&['comparable','context-only'].includes(p.decision)&&p.assessment&&['quantity','fraction','space','time'].every(k=>['same','different','unknown'].includes(p.assessment[k]))&&typeof p.rationale==='string'),'Retain every complete pair identity, support decision and rationale.');
    return clone(s);
  }
  function retainParent(c){if(c.opened?.edition?.id)c.state.selection.parent_id=c.opened.edition.id;else if(c.state.savedBasis&&canonical(c.state.selection)===c.state.savedBasis.selectionKey)c.state.selection.parent_id=c.state.savedBasis.editionId;}
  function validateWorking(value){
    need(value&&typeof value==='object'&&Array.isArray(value.history)&&Array.isArray(value.requests)&&typeof value.raw==='string'&&typeof value.rawDirty==='boolean'&&value.view&&['selection','mapping','pairs','results','figures','originals','context','history'].includes(value.view.tab)&&Number.isSafeInteger(value.view.page)&&value.view.page>=0&&typeof value.view.query==='string','Retain the complete editor, history and view state.');
    selectionValid(value.selection);
    if(value.pending){const r=value.pending.request;need(r&&typeof r.workspace==='string'&&r.action==='independent.comparison.save'&&typeof r.operation_id==='string'&&/^[A-Za-z0-9_-]{16,100}$/.test(r.operation_id),'Retain the exact original task request and workspace.');selectionValid(r.payload);}
    return value;
  }
  function inputSelection(c){return {native_comparison_id:c.state.selection.native_comparison_id,reference:clone(c.state.selection.reference)};}
  function nativeRows(c){return list(c.inputs?.native_rows);}
  function referenceRows(c){return list(c.inputs?.reference?.rows||c.inputs?.reference_rows);}
  function nativeId(row){return row.observation_id||row.id;}
  function referenceId(row,index){return row.row_number??index+1;}
  function referenceOriginal(row){return row.original||row;}
  function controls(){
    return '<section class="ic-desk"><header><h2>Independent source comparisons</h2><p>Compare a saved native result with an independently published estimate. Keep original support, uncertainty and disagreements visible.</p></header>'+
      '<div class="ic-toolbar">'+button('refresh','Refresh sources')+button('working','Download complete working draft')+'<label>Open working draft<input type="file" data-import accept=".json,application/json"></label>'+button('conflicts','Conflicting drafts')+button('retry-storage','Retry original local save')+'</div>'+
      '<p class="ic-status" data-status role="status" aria-live="polite">Opening retained choices…</p><div data-pending></div>'+
      '<nav class="ic-tabs" aria-label="Comparison sections">'+['selection','mapping','pairs','results','figures','originals','context','history'].map(t=>button('tab',(t==='context'?'Publisher context':t==='figures'?'Maps and figures':t[0].toUpperCase()+t.slice(1)),'data-tab="'+t+'" role="tab"')).join('')+'</nav>'+
      '<div data-body></div><div data-conflicts></div><div class="ic-toolbar"><label>Saved comparison<select data-saved><option value="">Choose a saved edition</option></select></label>'+button('open','Open selected edition')+button('new','New draft','data-mutator')+'</div>'+
      '<div data-downloads></div><div class="ic-toolbar">'+button('inputs','Read selected original inputs','data-mutator')+button('preview','Preview comparison','data-mutator')+button('save','Save full comparison','data-mutator')+button('resume','Recover original request')+'</div></section>';
  }
  function render(c,{body=true}={}){
    if(ctx!==c||!root)return;const s=c.state.selection;
    if(body)renderBody(c);
    root.querySelectorAll('[data-ic="tab"]').forEach(x=>x.setAttribute('aria-selected',String(x.dataset.tab===c.state.view.tab)));
    const pending=c.state.pending;
    node('[data-pending]').innerHTML=pending?'<section class="ic-panel"><h3>Original request retained</h3><p>'+esc(pending.task?'Task '+pending.task.id+' · '+pending.task.state:'Awaiting original task receipt')+'</p><details><summary>Exact request</summary><pre>'+esc(pretty(pending.request))+'</pre></details>'+(pending.task?button('task','Open original operation'):'')+(['failed','cancelled'].includes(pending.task?.state)?button('correct-terminal','Retain failed operation and correct draft'):'')+'</section>':'';
    const selected=node('[data-saved]')?.value||c.state.view.opened;
    const editions=list(c.catalog?.editions||c.catalog?.selections);
    node('[data-saved]').innerHTML=option('','Choose a saved edition',selected)+editions.map(x=>option(x.id,x.title,selected)).join('');
    node('[data-downloads]').innerHTML=list(c.opened?._downloads).filter(x=>safeDownload(x.url)).map(x=>'<p><a href="'+esc(x.url+(x.url.includes('?')?'&':'?')+'download=1')+'">'+esc(x.label||x.filename||'Original retained file')+'</a></p>').join('')+(c.opened?.edition?.source?button('report','Open in Scientific Reports'):'');
    paintStatus(c);
  }
  function sourceContext(c){const catalog=c.catalog?.reference_catalog;if(!catalog)return '';return '<section class="ic-panel"><h3>Scientific source context</h3><p>'+esc(catalog.purpose)+'</p>'+list(catalog.profiles).map(p=>'<details><summary>'+esc(p.label)+'</summary><p>'+esc(p.description)+'</p>'+table(['Evidence kind','Native support / boundary','Time basis'], '<tr><td>'+esc(p.evidence_kind)+'</td><td>'+esc(p.process_boundary)+'</td><td>'+esc(p.time_basis)+'</td></tr>')+'<p>Retain: '+esc(list(p.retain).join(', '))+'</p></details>').join('')+'<h4>Original primary references</h4><ul>'+list(catalog.references).map(r=>'<li>'+(/^https:\/\//.test(r.url||'')?'<a target="_blank" rel="noopener noreferrer" href="'+esc(r.url)+'">'+esc(r.title)+'</a>':esc(r.title))+' · '+esc(r.id)+'</li>').join('')+'</ul>'+button('catalog-json','Download complete scientific reference catalogue')+'</section>';}
  function definitionControl(k,ref){const value=ref.definition[k]||'';
    if(k==='source_support')return '<select data-definition="'+k+'">'+option('','Choose actual published support',value)+supports.map(v=>option(v,v.replaceAll('_',' '),value)).join('')+'</select>';
    if(k==='quantity'||k==='fraction'){const choices=k==='quantity'?quantityOptions:fractionOptions;return '<input data-definition="'+k+'" list="ic-'+k+'-choices" value="'+esc(value)+'"><datalist id="ic-'+k+'-choices">'+choices.map(([v,l])=>'<option value="'+esc(v)+'">'+esc(l)+'</option>').join('')+'</datalist><small>Choose a documented term or retain the original custom definition.</small>';}
    return '<textarea data-definition="'+k+'">'+esc(value)+'</textarea>';
  }
  function publisherUnit(c,parameter,field){
    return c.predictionContext?.sourceMap?.calibrationFieldResolution?.[parameter]?.[field]?.unit||null;
  }
  function predictionContextView(c){
    const value=c.predictionContext;
    if(!value)return '<section class="ic-panel"><h3>Published prediction quantities and source budgets</h3><p>'+esc(c.predictionLoading?'Reading the complete received prediction edition and publisher definitions…':c.predictionError||'Read the current retained publisher edition for all five original reaches.')+'</p>'+button('prediction-context-read',c.predictionLoading?'Reading…':'Read prediction quantities',c.predictionLoading?'disabled':'')+'</section>';
    const budget=(row,field)=>list(row.budgets).find(x=>x.field===field);
    const overview=list(value.rows).map(row=>'<tr><td>'+esc(row.target)+'<br>COMID '+esc(row.comid)+'</td><td>'+esc(row.parameter)+'</td><td>'+esc(numbers(budget(row,'ACCL')?.total))+' '+esc(budget(row,'ACCL')?.unit)+'</td><td>'+esc(numbers(budget(row,'INCL')?.total))+' '+esc(budget(row,'INCL')?.unit)+'</td><td>'+esc(numbers(row.support?.incrementalPercentOfAccumulated))+'%</td><td>'+esc(row.targetLocation)+'</td></tr>').join('');
    const editions=list(value.editionComparisons).map(row=>'<tr><td>'+esc(row.target)+'<br>'+esc(row.parameter)+'</td><td>'+esc(row.oldField)+': '+(row.oldValue===null?'No original calibration row':esc(numbers(row.oldValue)))+'</td><td>'+esc(row.currentField)+': '+esc(numbers(row.currentValue))+'</td><td>'+esc(row.unit)+'</td><td>'+esc(numbers(row.difference))+'</td><td>'+esc(numbers(row.relativePercent))+(row.relativePercent===null||row.relativePercent===undefined?'':'%')+'</td></tr>').join('');
    const fields=list(value.sourceMap?.fields).map(field=>'<tr><td>'+esc(field.parameter)+'<br>'+esc(field.field)+'</td><td>'+esc(field.publisherLabel)+'</td><td>'+esc(field.unit)+'</td><td>'+esc(field.quantity)+'<br>'+esc(field.sourceSupport)+'</td><td>'+esc(field.definition?.text||'')+'</td></tr>').join('');
    return renderPublisherBudget(value,c.state.view.publisherBudget||{})+'<section class="ic-panel"><h3>'+esc(value.title)+'</h3><p>Publisher HTML, its operating field configuration and the retained release dictionary resolve the annual units shown here. '+esc(value.counts?.predictionRows)+' original prediction rows retain '+esc(value.counts?.budgets)+' source budgets and '+esc(value.counts?.componentValues)+' component values.</p>'+
      '<p class="ic-note">Incremental load includes attenuation over half the local reach. Accumulated load includes upstream sources and attenuation. Delivered quantities target the Atlantic Ocean for these reaches. Matching units alone never makes these quantities equivalent to the native landscape-to-stream result.</p>'+
      table(['Original reach','Constituent','ACCL · accumulated annual load','INCL · incremental annual load','INCL as a share of ACCL','Coastal target'],overview)+
      button('prediction-context-download','Download complete prediction chapter')+button('publisher-field-map-download','Download publisher field definitions')+
      '<h4>Complete source budgets</h4><p>Open a reach and constituent to inspect every metric and all source components. Published rounded totals, component sums and residuals remain separate. Shares are descriptive model allocations; reaches may be nested and are not summed.</p>'+
      list(value.rows).map(row=>'<details><summary>'+esc(row.target)+' · '+esc(row.parameter)+' · '+esc(row.streamName||row.comid)+'</summary>'+
        '<p>Original COMID '+esc(row.decoratedComid||row.comid)+'; layer '+esc(row.layer)+'; object '+esc(row.objectId)+'.</p>'+
        list(row.budgets).map(b=>'<details><summary>'+esc(b.field)+' · '+esc(b.label)+' · '+esc(numbers(b.total))+' '+esc(b.unit)+'</summary><p>Quantity: '+esc(b.quantity)+'; support: '+esc(b.support)+'.</p>'+
          table(['Original field','Publisher source label','Value ('+b.unit+')','Share of this metric total'],list(b.components).map(x=>'<tr><td>'+esc(x.field)+'</td><td>'+esc(x.label)+'</td><td>'+esc(numbers(x.value))+'</td><td>'+esc(numbers(x.sharePercent))+(x.sharePercent===null||x.sharePercent===undefined?'':'%')+'</td></tr>').join(''))+
          '<p>Component sum: '+esc(numbers(b.componentSum))+'; sum minus published total: '+esc(numbers(b.sumMinusPublishedTotal))+'. '+esc(b.closureMeaning)+'</p></details>').join('')+
        '<details><summary>Original support, concentration, delivery fraction and unchanged source fields</summary><pre>'+esc(pretty({support:row.support,concentration:row.concentration,deliveryFraction:row.deliveryFraction,original:row.original,source:row.source}))+'</pre></details></details>').join('')+
      '<h4>Distinct calibration and mapper editions</h4><p>All eleven retained overlaps differ. The comparison below preserves the old calibration PLOAD and current mapper ACCL values; these differences are neither a time trend nor a native-model error.</p>'+
      table(['Target / constituent','Original calibration fitted field','Received mapper prediction','Resolved annual unit','Current minus original','Relative difference'],editions)+
      '<h4>Publisher quantity definitions</h4>'+table(['Constituent / field','Publisher label','Annual unit','Quantity and support','Original definition'],fields)+
      '<details><summary>Later source evidence resolving historical calibration field units</summary><p>The older calibration-context file retains its original dictionary-only uncertainty. The independently retained publisher popup configuration supplies the current units and identifies ACTUAL as a Beale or Fluxmaster load estimate, not a literal direct measurement.</p><pre>'+esc(pretty(value.sourceMap?.calibrationFieldResolution))+'</pre></details>'+
      '<h4>Interpretation and limits</h4><ul>'+list(value.limitations).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'+
      '<details><summary>Complete source definitions and primary evidence</summary><pre>'+esc(pretty({publisher:value.sourceMap?.publisher,definitions:value.sourceMap?.sourceDefinitions,release:value.release,sources:value.sources}))+'</pre></details></section>';
  }
  async function loadPredictionContext(c){
    if(c.predictionLoading)return;const g=epoch;c.predictionLoading=true;c.predictionError='';if(alive(c,g)&&c.state.view.tab==='context')renderBody(c);
    try{
      const value=await api(endpoint('/api/independent-comparison/prediction-context',{workspace:c.scope.workspace}));
      need(value.workspace_key===c.scope.workspace&&value.project_id===c.scope.project,'The prediction chapter belongs to another Workspace response.');
      need(value.schema==='upstate.sparrow-prediction-context/v1'&&Array.isArray(value.rows)&&Array.isArray(value.editionComparisons)&&Array.isArray(value.sourceMap?.fields),'Retain the complete prediction chapter and publisher definitions.');
      if(!alive(c,g))return;c.predictionContext=value;
    }catch(error){if(alive(c,g))c.predictionError=error.message;}
    finally{c.predictionLoading=false;if(alive(c,epoch)&&c.state.view.tab==='context')renderBody(c);}
  }
  function downloadPublisherBudget(c,action){
    need(c.predictionContext,'Read the complete publisher prediction chapter first.');
    need(['svg','csv','json','report','all-csv','all-json'].includes(action),'Choose a publisher figure or full-data download.');
    const context=clone(c.predictionContext),selection=selectPublisherBudget(context,c.state.view.publisherBudget||{}),view=clone(selection.view);
    const stem='sparrow-'+[view.comid,view.parameter,view.metric].map(value=>String(value).replace(/[^a-zA-Z0-9_.-]/g,'_')).join('-');
    if(action==='svg')return download(stem+'.svg',buildPublisherBudgetSvg(context,view),'image/svg+xml;charset=utf-8');
    if(action==='csv')return download(stem+'.csv',buildPublisherBudgetCsv(context,view),'text/csv;charset=utf-8');
    if(action==='json')return download(stem+'.json',buildPublisherBudgetJson(context,view),'application/json;charset=utf-8');
    if(action==='report')return download('sparrow-complete-source-budget-report.html',buildPublisherBudgetReport(context,view),'text/html;charset=utf-8');
    if(action==='all-csv')return download('sparrow-all-source-budgets.csv',buildPublisherBudgetCsv(context,view,{all:true}),'text/csv;charset=utf-8');
    return download('sparrow-complete-source-budgets.json',buildPublisherBudgetJson(context,view,{all:true}),'application/json;charset=utf-8');
  }
  function fitContextView(c){
    const value=c.fitContext;
    if(!value)return '<section class="ic-panel"><h3>Published SPARROW calibration context</h3><p>'+esc(c.fitLoading?'Reading the complete retained publisher tables…':c.fitError||'Read the original published calibration records for the five retained Upper Savannah targets.')+'</p>'+button('fit-context-read',c.fitLoading?'Reading…':'Read published context',c.fitLoading?'disabled':'')+'</section>';
    const rows=list(value.comparisons).flatMap(group=>{
      if(!list(group.rows).length)return ['<tr><td>'+esc(group.target)+'<br>'+esc(group.comid)+'</td><td>'+esc(group.parameter)+'</td><td colspan="5">No calibration row in this retained publisher table. '+esc(group.interpretation)+'</td></tr>'];
      return group.rows.map(row=>'<tr><td>'+esc(group.target)+'<br>'+esc(row.stationName||row.stationId||group.comid)+'<br>COMID '+esc(row.comid)+'</td><td>'+esc(group.parameter)+(row.constituent?'<br>'+esc(row.constituent):'')+'</td><td>'+esc(row.actualField)+': '+esc(numbers(row.actual))+'</td><td>'+esc(row.predictedField)+': '+esc(numbers(row.predicted))+'</td><td>'+esc(numbers(row.difference))+'</td><td>'+(row.relativePercent===null||row.relativePercent===undefined?esc(row.relativeReason||'Unavailable'):esc(numbers(row.relativePercent))+'%')+'</td><td>'+esc(publisherUnit(c,group.parameter,row.actualField)||'Historical dictionary-only unit uncertainty; read the prediction chapter above')+(row.tssConv!==null&&row.tssConv!==undefined?'<br>TSS_CONV: '+esc(row.tssConv)+' (original raw field)':'')+'</td></tr>');
    }).join('');
    return '<section class="ic-panel"><h3>'+esc(value.title)+'</h3><p>These are the publisher’s original calibration records and fitted predictions. They describe the retained published fitting edition; they are separate from this Workspace’s native results and from later mapper prediction editions. Raw differences keep the original fields. The adjoining prediction chapter supplies later publisher-backed annual units; this historical file retains the dictionary-only uncertainty of its original edition.</p>'+table(['Target / original station','Constituent','Published calibration-field value','Published fitted-field value','Raw fitted minus calibration estimate','Raw relative difference','Publisher-resolved units and original sediment lineage'],rows)+button('fit-context-download','Download complete published context')+
      '<h4>Separate published-method sediment context</h4><p>For recognized source patterns, the retained recipe applies the publisher’s documented TSS-to-suspended-sediment equation. Derived SSC-equivalent values below remain separate from the unchanged raw table and do not establish native comparability or a new measurement.</p>'+
      table(['Target / original constituent','Method status','Retained coefficient / factor','Derived SSC-equivalent value','Published PLOAD_MT','Derived difference','Derived relative difference'],list(value.comparisons).filter(group=>group.parameter==='sediment').flatMap(group=>{
        if(!list(group.rows).length)return ['<tr><td>'+esc(group.target)+'</td><td colspan="6">No exact original calibration row.</td></tr>'];
        return group.rows.map(row=>{const method=row.publishedMethodSscContext;if(!method)return '<tr><td>'+esc(group.target)+'</td><td colspan="6">No derived method context retained for this row.</td></tr>';
          return '<tr><td>'+esc(group.target)+'<br>'+esc(row.constituent)+'</td><td>'+esc(method.status)+'</td><td>'+esc(numbers(method.coefficient))+'<br>'+esc(numbers(method.factor))+'</td><td>'+esc(numbers(method.actualSscEquivalent))+'</td><td>'+esc(numbers(method.predicted))+'</td><td>'+esc(numbers(method.difference))+'</td><td>'+(method.relativePercent===null||method.relativePercent===undefined?'Unavailable':esc(numbers(method.relativePercent))+'%')+'</td></tr>';});
      }).join(''))+'<details><summary>Exact published method and conditional calculation</summary><pre>'+esc(pretty(value.methodEvidence))+'</pre>'+(/^https:\/\//.test(value.methodEvidence?.url||'')?'<a target="_blank" rel="noopener noreferrer" href="'+esc(value.methodEvidence.url)+'">Open original USGS method</a>':'')+'</details>'+
      '<h4>Regional published context</h4>'+list(value.regional).map(region=>'<details><summary>'+esc(region.parameter)+' · '+esc(region.count)+' original rows</summary><p>These are descriptive raw-field summaries from the published fitting edition, with no pass threshold or validation conclusion.</p>'+table(['Original stratum','Rows','Median raw relative difference','Fitted above raw calibration value','Fitted below raw calibration value'],list(region.summary?.strata).map(stratum=>'<tr><td>'+esc(stratum.label)+'</td><td>'+esc(stratum.count)+'</td><td>'+esc(numbers(stratum.medianRawRelativePercent))+'%</td><td>'+esc(stratum.above)+'</td><td>'+esc(stratum.below)+'</td></tr>').join(''))+'<details><summary>Complete summary and original record identities</summary><pre>'+esc(pretty(region.summary))+'</pre></details></details>').join('')+
      '<h4>Interpretation and limits</h4><ul>'+list(value.limitations).map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul><details><summary>Exact source identity and primary references</summary><pre>'+esc(pretty({sourceIdentity:value.sourceIdentity,sources:value.sources}))+'</pre></details><details><summary>Complete target records and original publisher fields</summary><pre>'+esc(pretty(value.comparisons))+'</pre></details></section>';
  }
  async function loadFitContext(c){
    if(c.fitLoading)return;const g=epoch;c.fitLoading=true;c.fitError='';if(alive(c,g)&&c.state.view.tab==='context')renderBody(c);
    try{const value=await api(endpoint('/api/independent-comparison/reference-context',{workspace:c.scope.workspace}));
      need(value.workspace_key===c.scope.workspace&&value.project_id===c.scope.project,'The published context belongs to another Workspace response.');
      need(value.schema==='upstate.sparrow-fit-context/v1'&&Array.isArray(value.comparisons)&&Array.isArray(value.regional)&&value.sourceIdentity,'Retain the complete published context and original table identities.');
      if(!alive(c,g))return;c.fitContext=value;
    }catch(error){if(alive(c,g))c.fitError=error.message;}
    finally{c.fitLoading=false;if(alive(c,epoch)&&c.state.view.tab==='context')renderBody(c);}
  }
  function renderBody(c){
    const s=c.state.selection,ref=s.reference,tab=c.state.view.tab;
    let html='';
    if(tab==='context')html=predictionContextView(c)+fitContextView(c);
    else if(tab==='figures')html=renderIndependentFigures(c.opened,c.state.view);
    else if(tab==='selection'){
      const natives=list(c.catalog?.native_comparisons||c.catalog?.comparisons),sources=list(c.catalog?.reference_sources||c.catalog?.references||c.catalog?.sources);
      html='<section class="ic-panel ic-editor" data-editor data-guided><h3>Original selections</h3><div class="ic-grid">'+
        field('title','Comparison title',s.title,{max:300})+field('author','Scientific reviewer',s.author,{max:300})+
        '<label>Saved native observation comparison<select data-native>'+option('','Choose original saved result',s.native_comparison_id)+natives.map(x=>option(x.id,x.title||x.label||x.id,s.native_comparison_id)).join('')+'</select></label>'+
        '<label>Independent original source table<select data-reference>'+option('','Choose retained original CSV',canonical({source_collection_id:ref.source_collection_id,source_id:ref.source_id,source_sha256:ref.source_sha256}))+sources.map(x=>{const v=x.choice||x.reference||x;return option(canonical({source_collection_id:v.source_collection_id,source_id:v.source_id,source_sha256:v.source_sha256}),x.title||v.source_id,canonical({source_collection_id:ref.source_collection_id,source_id:ref.source_id,source_sha256:ref.source_sha256}));}).join('')+'</select></label>'+
        '<label>Independent quantity type<select data-definition="evidence_kind">'+kinds.map(k=>option(k,k.replaceAll('_',' '),ref.definition.evidence_kind)).join('')+'</select></label>'+
        textarea('interpretation','Interpretation and unresolved disagreement',s.interpretation)+textarea('notes','Source and method notes',Array.isArray(s.notes)?s.notes.join('\n'):s.notes)+'</div></section>'+
        '<section class="ic-panel"><h3>Reference meaning</h3><p class="ic-note">A published model estimate remains a model estimate. Descriptive agreement does not establish independent predictive accuracy when the sources or calibration inputs overlap.</p><div class="ic-grid" data-editor data-guided>'+
        definitionFields.map(k=>'<label>'+esc(k.replaceAll('_',' '))+definitionControl(k,ref)+'</label>').join('')+
        '<label>Scientific reference IDs (one per line)<textarea data-definition="reference_ids">'+esc(list(ref.definition.reference_ids).join('\n'))+'</textarea></label></div></section>'+sourceContext(c);
    }else if(tab==='mapping'){
      const columns=list(c.inputs?.reference?.columns||c.inputs?.reference_columns),labels=[...new Set(referenceRows(c).map(r=>ref.columns.parameter?referenceOriginal(r)[ref.columns.parameter]:ref.defaults.parameter||'').filter(v=>typeof v==='string'&&v))].sort();
      html='<section class="ic-panel ic-editor"><h3>Original column mapping</h3><p>Map the publisher’s actual columns. Optional explicit defaults are source declarations, never inferred measurements. Read the selected inputs first to inspect exact headings.</p><div data-editor data-guided>'+table(['Meaning','Original column','Explicit source default'],mappingFields.map(k=>'<tr><th scope="row">'+esc(k.replaceAll('_',' '))+'</th><td><select data-column="'+k+'">'+option('','No column',ref.columns[k])+columns.map(x=>option(x,x,ref.columns[k])).join('')+'</select></td><td><input data-default="'+k+'" value="'+esc(ref.defaults[k]??'')+'" aria-label="'+esc(k)+' default"></td></tr>').join(''))+'</div>'+
        '<section data-editor data-guided><h4>Exact original constituent labels</h4><p>Map only the publisher’s stated constituent meaning. Analytical codes and fractions remain separately visible and checked.</p>'+table(['Original label','Native constituent'],labels.map(label=>'<tr><th scope="row">'+esc(label)+'</th><td><select data-parameter-label="'+esc(label)+'">'+option('','Keep original label',ref.parameter_map?.[label])+['nitrogen','phosphorus','sediment'].map(v=>option(v,v,ref.parameter_map?.[label])).join('')+'</select></td></tr>').join(''))+'</section><details><summary>Advanced complete selection JSON</summary><p>Apply this complete draft explicitly. Unapplied JSON blocks guided changes and saving.</p><div data-editor><textarea data-raw rows="18" aria-label="Complete comparison selection JSON">'+esc(c.state.rawDirty?c.state.raw:pretty(s))+'</textarea></div><div class="ic-toolbar">'+button('apply-raw','Apply JSON draft','data-mutator')+button('discard-raw','Discard JSON draft','data-mutator')+'</div></details></section>';
    }else if(tab==='pairs'){
      const ns=nativeRows(c),rs=referenceRows(c);
      html='<section class="ic-panel ic-editor"><h3>Explicit comparison pairs</h3><p>Choose the native observation-support row and original reference row for each pair. Different or unknown quantity, fraction, place or time stays contextual. Original engine checks can still exclude a pair marked comparable.</p>'+
      '<p class="ic-note">Native model period: '+esc(pretty(c.inputs?.original_profile?.model_period||c.inputs?.native_comparison?.model_period||'Read original inputs'))+'. Dates in the row chooser below describe the associated original observation, not a new native simulation period.</p><div data-editor data-guided><div class="ic-toolbar"><label>Native support row with associated observation period<select data-pair-native>'+ns.map(r=>option(nativeId(r),(r.catchment_id||r.station_id||'')+' · '+r.parameter+' · '+(r.period_start||'')+' → '+(r.period_end||''),null)).join('')+'</select></label>'+
      '<label>Original reference row<select data-pair-reference>'+rs.map((r,i)=>option(referenceId(r,i),'Row '+referenceId(r,i)+' · '+Object.values(referenceOriginal(r)).slice(0,4).join(' / '),null)).join('')+'</select></label>'+button('add-pair','Add comparison pair','data-guided-mutator')+'</div>'+
      s.pairs.map((p,i)=>'<fieldset class="ic-panel"><legend>Pair '+(i+1)+'</legend><p>Native '+esc(p.native_observation_id)+' · reference row '+esc(p.reference_row_number)+'</p><div class="ic-grid">'+
        ['quantity','fraction','space','time'].map(k=>'<label>'+esc(k)+' support<select data-pair-index="'+i+'" data-assessment="'+k+'">'+['unknown','same','different'].map(v=>option(v,v,p.assessment?.[k])).join('')+'</select></label>').join('')+
        '<label>Comparison use<select data-pair-index="'+i+'" data-pair-field="decision">'+['context-only','comparable'].map(v=>option(v,v,p.decision)).join('')+'</select></label><label>Source-grounded rationale<textarea data-pair-index="'+i+'" data-pair-field="rationale">'+esc(p.rationale)+'</textarea></label></div>'+button('remove-pair','Remove from this draft','data-index="'+i+'" data-guided-mutator')+'</fieldset>').join('')+'</div></section>';
    }else if(tab==='results'){
      const result=c.opened?.data||c.preview?.data||c.preview;
      if(!result)html='<p class="ic-empty">Preview the selected comparison or open a saved edition. Native model execution is separate; this action analyzes retained outputs.</p>';
      else{
        const rows=list(result.pairs),query=c.state.view.query.toLowerCase(),filtered=rows.filter(x=>!query||canonical(x).toLowerCase().includes(query)),pages=Math.max(1,Math.ceil(filtered.length/50));
        c.state.view.page=Math.min(c.state.view.page,pages-1);
        html='<section class="ic-panel"><h3>'+(c.opened?'Saved independent comparison':'Current comparison preview')+'</h3><pre>'+esc(pretty(result.counts||{}))+'</pre><p>'+esc(result.interpretation||s.interpretation)+'</p>'+
        '<div class="ic-toolbar"><label>Find matched values, source IDs or issues<input type="search" data-query value="'+esc(c.state.view.query)+'"></label>'+button('result-json','Download complete comparison JSON')+'</div>'+
        table(['Pair / reference','Native annual value','Reference value','Difference','Use / support','Interpretation'],filtered.slice(c.state.view.page*50,c.state.view.page*50+50).map(r=>'<tr><th scope="row">'+esc(r.id||r.pair?.id||'')+'<br>'+esc(r.reference_row_number||r.pair?.reference_row_number||'')+'</th><td>'+esc(numbers(r.native?.modeled_annual_mass))+' '+esc(r.units||'')+'</td><td>'+esc(r.reference?.value??'')+' '+esc(r.reference?.unit||'')+'</td><td>'+esc(numbers(r.difference))+' '+esc(r.difference===null?'':r.units||'')+'</td><td>'+esc(r.status||r.decision||r.pair?.decision||'')+'</td><td>'+esc(list(r.issues).join('; ')||r.rationale||'')+'<details><summary>Complete original pair</summary><pre>'+esc(pretty(r))+'</pre></details></td></tr>').join(''))+
        '<div class="ic-toolbar">'+button('previous','Previous',c.state.view.page===0?'disabled':'')+'<span>Page '+(c.state.view.page+1)+' of '+pages+'</span>'+button('next','Next',c.state.view.page+1>=pages?'disabled':'')+'</div>'+
        '<details><summary>Statistics and complete retained disagreements</summary><pre>'+esc(pretty(result))+'</pre></details></section>';
      }
    }else if(tab==='originals'){
      const data=c.opened?.inputs||c.inputs;html=data?'<section class="ic-panel"><h3>Complete original inputs</h3><p>Every selected source row remains here, including unpaired or excluded observations. The publisher table is unchanged.</p>'+button('inputs-json','Download complete input snapshot')+'<details><summary>Native original result and support</summary><pre>'+esc(pretty(data.native_comparison||data.native||data.native_rows))+'</pre></details><details><summary>Independent original source</summary><pre>'+esc(pretty(data.reference||data.reference_rows))+'</pre></details><details><summary>Full identities and original input record</summary><pre>'+esc(pretty(data))+'</pre></details></section>':'<p class="ic-empty">Read the selected original inputs to inspect the complete source records.</p>';
    }else{
      html='<section class="ic-panel"><h3>Draft and request history</h3><p>Saved scientific editions stay in the original Workspace. This working draft also retains replaced unfinished selections and exact operator requests.</p>'+table(['When','Reason','Original selection'],c.state.history.map((r,i)=>'<tr><td>'+esc(r.at)+'</td><td>'+esc(r.reason)+'</td><td>'+button('history-download','Download complete prior draft','data-index="'+i+'"')+'</td></tr>').join(''))+'<details><summary>Original requests and task receipts</summary><pre>'+esc(pretty(c.state.requests))+'</pre></details></section>';
    }
    node('[data-body]').innerHTML=html;paintStatus(c);
    if(tab==='figures'){const image=node('[data-figure-image]');if(image?.complete&&image.naturalWidth>0){const label=node('[data-figure-status]');if(label)label.textContent='Exact saved figure loaded. Full original data and file downloads remain below.';}}
  }
  async function refresh(c){
    const g=epoch,ticket=++c.readEpoch,result=await api(endpoint('/api/independent-comparison/catalog',{workspace:c.scope.workspace}));
    if(!alive(c,g)||ticket!==c.readEpoch)return;
    need(result.project_id===c.scope.project&&result.workspace_key===c.scope.workspace,'Catalogue belongs to another Workspace.');
    c.catalog=result;render(c);status('Select the retained native result and independent publisher table.');
  }
  async function loadInputs(c){
    editable(c);const chosen=inputSelection(c),g=epoch,ticket=++c.readEpoch;c.busy=true;paintStatus(c);
    try{await flush(c);const result=await api(endpoint('/api/independent-comparison/inputs',{workspace:c.scope.workspace}),{method:'POST',body:{workspace:c.scope.workspace,selection:chosen}});
      if(!alive(c,g)||ticket!==c.readEpoch||canonical(inputSelection(c))!==canonical(chosen))return;
      need(result.project_id===c.scope.project&&result.workspace_key===c.scope.workspace,'The input snapshot belongs to another Workspace.');
      c.inputs=result;if(c.state.selection.input_sha256!==result.input_sha256||canonical(c.state.selection.producers)!==canonical(result.producers))retainParent(c);c.opened=null;c.state.selection.input_sha256=result.input_sha256;c.state.selection.producers=clone(result.producers);changed(c);await flush(c);render(c);status('Complete original inputs retained. Map source columns and decide comparison pairs.');
    }finally{c.busy=false;if(alive(c,g))paintStatus(c);}
  }
  async function preview(c){
    editable(c);const chosen=clone(c.state.selection),g=epoch,ticket=++c.readEpoch;c.busy=true;paintStatus(c);
    try{await flush(c);const result=await api(endpoint('/api/independent-comparison/preview',{workspace:c.scope.workspace}),{method:'POST',body:{workspace:c.scope.workspace,selection:chosen}});
      if(!alive(c,g)||ticket!==c.readEpoch||canonical(c.state.selection)!==canonical(chosen))return;
      need(result.project_id===c.scope.project&&result.workspace_key===c.scope.workspace,'The preview belongs to another Workspace.');
      c.preview=result;c.previewKey=canonical(chosen);c.opened=null;c.state.view.tab='results';c.dirty=true;await flush(c);render(c);status('Preview complete. Review every contextual/excluded pair before saving the original scientific edition.');
    }finally{c.busy=false;if(alive(c,g))paintStatus(c);}
  }
  async function dispatchPending(c){
    need(c.state.pending,'No retained original request is pending.');need(!c.blocked,c.error);
    need(scopeKey(activeScope())===scopeKey(c.scope),'Return to the original Workspace and person before dispatch.');
    const request=clone(c.state.pending.request),g=epoch;
    need(request.workspace===c.scope.workspace&&request.action==='independent.comparison.save','The retained request has a different target.');
    await flush(c);need(alive(c,g),'The Workspace changed before original request dispatch.');
    const task=await api('/api/actions',{method:'POST',body:request});
    need(task.workspace===request.workspace&&task.action===request.action&&canonical(task.payload)===canonical(request.payload),'The returned task does not retain the exact original request payload.');
    c.state.pending.task=clone(task);c.dirty=true;await flush(c);
    if(alive(c,g)){render(c);status('Original task '+task.state+'. Its source analysis and complete result remain in Operations.');await refreshState();}
    await observeTask(c,task);
  }
  async function save(c,recover=false){
    need(!c.busy,'An original action is already being retained.');if(!recover){editable(c);need(c.preview&&c.previewKey===canonical(c.state.selection),'Preview this exact current selection before saving.');}
    const g=epoch;c.busy=true;paintStatus(c);
    try{
      await flush(c);
      if(!recover){need(alive(c,g),'The Workspace changed.');const request={workspace:c.scope.workspace,action:'independent.comparison.save',payload:clone(c.state.selection),operation_id:uuid()};c.state.pending={request,created_at:new Date().toISOString(),task:null};c.dirty=true;await flush(c);}
      await dispatchPending(c);
    }finally{c.busy=false;if(alive(c,g))paintStatus(c);}
  }
  async function observeTask(c,task){
    if(!c.state.pending||task.id!==c.state.pending.task?.id)return;need(task.workspace===c.scope.workspace&&task.action===c.state.pending.request.action&&canonical(task.payload)===canonical(c.state.pending.request.payload),'The observed task belongs to a different original request.');
    c.state.pending.task=clone(task);
    if(task.state==='complete'){
      c.state.requests.push(clone(c.state.pending));c.state.view.opened=task.result?.id||'';
      if(id(task.result?.id)&&canonical(c.state.selection)===canonical(c.state.pending.request.payload))c.state.savedBasis={editionId:task.result.id,selectionKey:canonical(c.state.selection)};
      c.state.pending=null;
      c.dirty=true;await flush(c);if(ctx===c&&root){render(c);status('Comparison saved. Open its retained edition below or in Operations.');}
    }else{c.dirty=true;await queueSave(c);}
  }
  async function openSaved(c,key){
    need(id(key),'Choose an original saved comparison.');need(!c.state.pending&&!c.busy,'Finish the original request before replacing the current editor.');const g=epoch,ticket=++c.readEpoch;c.busy=true;paintStatus(c);
    try{await flush(c);const before=canonical(c.state.selection),result=await api(endpoint('/api/independent-comparison/edition',{workspace:c.scope.workspace,id:key}));
      if(!alive(c,g)||ticket!==c.readEpoch||canonical(c.state.selection)!==before)return;
      need(result.edition?.id===key&&result.project_id===c.scope.project&&result.workspace_key===c.scope.workspace,'The edition belongs to another Workspace.');
      archive(c,'Open saved scientific edition');c.state.selection=selectionValid(result.edition.selection);c.state.savedBasis={editionId:key,selectionKey:canonical(c.state.selection)};c.state.raw='';c.state.rawDirty=false;c.state.view.opened=key;c.state.view.tab='results';c.opened=result;c.inputs=result.inputs;c.preview=null;c.dirty=true;await flush(c);render(c);status('Exact saved edition opened. Editing creates a new edition while preserving this original.');
    }finally{c.busy=false;if(alive(c,g))paintStatus(c);}
  }
  function input(event){
    const c=ctx,t=event.target;if(!c||!root)return;
    if(t.matches('[data-query]')){c.state.view.query=t.value;c.state.view.page=0;c.dirty=true;clearTimeout(c.timer);c.timer=setTimeout(()=>{queueSave(c);if(ctx===c&&root)renderBody(c);},350);return;}
    if(t.matches('[data-raw]')){need(!c.busy&&!c.blocked&&!c.state.pending,'The current original draft is not editable.');c.state.raw=t.value;c.state.rawDirty=true;changed(c);return;}
    editable(c);retainParent(c);const s=c.state.selection;
    if(t.dataset.field){s[t.dataset.field]=t.dataset.field==='notes'?t.value.split('\n'):t.value;}
    else if(t.dataset.definition){s.reference.definition[t.dataset.definition]=t.dataset.definition==='reference_ids'?t.value.split('\n').map(x=>x.trim()).filter(Boolean):t.value;}
    else if(t.dataset.column){s.reference.columns[t.dataset.column]=t.value;}
    else if(t.dataset.default){if(t.value==='')delete s.reference.defaults[t.dataset.default];else s.reference.defaults[t.dataset.default]=t.value;}
    else if(t.dataset.parameterLabel!==undefined){s.reference.parameter_map||={};if(t.value==='')delete s.reference.parameter_map[t.dataset.parameterLabel];else s.reference.parameter_map[t.dataset.parameterLabel]=t.value;}
    else if(t.dataset.pairIndex!==undefined){const p=s.pairs[Number(t.dataset.pairIndex)];need(p,'The selected pair changed.');if(t.dataset.assessment)p.assessment[t.dataset.assessment]=t.value;else p[t.dataset.pairField]=t.value;}
    else return;
    c.opened=null;changed(c);
  }
  async function receive(c,file){
    need(!c.busy&&!c.state.pending,'Finish the original request before receiving a working draft.');const g=epoch;c.busy=true;paintStatus(c);
    try{await flush(c);const raw=await file.text(),value=JSON.parse(raw);need(alive(c,g),'The Workspace changed while the file opened.');
      need(value.schema==='upstate.independent-comparison-working/v1'&&value.scope.project===c.scope.project,'This complete working file belongs to another scientific project.');
      validateWorking(value.state);
      need(!value.state.pending,'Recover the exact original request in its original Workspace before importing this working draft.');
      const prior=clone(c.state),incoming=clone(value.state);incoming.history.push({at:new Date().toISOString(),reason:'Current complete working state before explicit receive',state:prior});incoming.history.push({at:new Date().toISOString(),reason:'Original received working file',file:{name:file.name,text:raw}});
      delete incoming.savedBasis;c.state=incoming;c.inputs=null;c.preview=null;c.opened=null;c.dirty=true;await flush(c);render(c);status('Complete working choices and original file retained. Read original sources again before saving.');
    }finally{c.busy=false;if(alive(c,g))paintStatus(c);}
  }
  async function conflicts(c){
    c.conflicts=await c.store.conflicts();if(ctx!==c||!root)return;
    node('[data-conflicts]').innerHTML='<section class="ic-panel ic-local"><h3>Retained conflicting drafts</h3><p>Your visible complete draft stays available to download. Reopening the canonical draft first preserves this visible state separately.</p>'+button('reopen','Reopen canonical saved draft')+c.conflicts.map((r,i)=>'<p>'+esc(r.conflict.at)+' '+button('conflict-download','Download entire conflicting draft','data-index="'+i+'"')+button('conflict-restore','Restore as current draft','data-index="'+i+'"')+'</p>').join('')+'</section>';
  }
  async function click(action,target){
    const c=ctx;need(c,'Open the original scientific Workspace.');
    if(action==='working'){try{await flush(c);}catch{}download('independent-comparison-working.json',{schema:'upstate.independent-comparison-working/v1',scope:c.scope,state:clone(c.state),storage_revision:c.revision,storage_error:c.error||null});return;}
        if(action==='retry-storage'){
      need(!c.busy,'Wait for the original local action to finish.');c.busy=true;paintStatus(c);
      try{clearTimeout(c.timer);await c.tail.catch(()=>{});const current=await c.store.read();
        if((current?.revision||0)!==c.revision){await c.store.preserve(clone(c.state),'Exact visible state before retry found another canonical draft');throw Error('Another tab has a different saved revision. Open Conflicting drafts; the current complete draft remains visible.');}
        c.blocked=false;c.error='';c.dirty=true;await flush(c);status('Original local draft and pending request are retained. Resume the same request explicitly if needed.');
      }finally{c.busy=false;paintStatus(c);}return;
    }
    if(action==='refresh')return refresh(c);
    if(action==='inputs')return loadInputs(c);
    if(action==='preview')return preview(c);
    if(action==='save')return save(c);
    if(action==='resume')return save(c,true);
    if(action==='open')return openSaved(c,node('[data-saved]').value);
    if(action==='task'){need(c.state.pending?.task,'Original task unavailable.');return showTask(c.state.pending.task.id);}
    if(action==='correct-terminal'){
      need(!c.busy&&!c.blocked&&c.state.pending?.task,'Receive the original terminal operation before correcting its draft.');const g=epoch,original=clone(c.state.pending);c.busy=true;paintStatus(c);
      try{await flush(c);need(alive(c,g),'Return to the original Workspace before receiving this task.');
        const task=await api(endpoint('/api/task',{workspace:c.scope.workspace,id:original.task.id}));
        need(alive(c,g)&&canonical(c.state.pending.request)===canonical(original.request),'The original editor or request changed.');
        need(task.id===original.task.id&&task.workspace===c.scope.workspace&&task.action===original.request.action&&canonical(task.payload)===canonical(original.request.payload),'The returned task differs from this exact original request.');
        need(['failed','cancelled'].includes(task.state),'This original operation is no longer terminal; receive it through Operations.');
        c.state.requests.push({...original,task:clone(task),editorDisposition:{action:'correct-draft',at:new Date().toISOString()}});
        c.state.pending=null;c.preview=null;c.previewKey='';c.dirty=true;await flush(c);render(c);status('Original terminal operation retained in History. Correct this draft and preview it before creating a new request.');
      }finally{c.busy=false;if(alive(c,g))paintStatus(c);}return;
    }
    if(action==='tab'){c.state.view.tab=target.dataset.tab;c.dirty=true;queueSave(c);render(c);if(c.state.view.tab==='context')return Promise.all([c.fitContext?null:loadFitContext(c),c.predictionContext?null:loadPredictionContext(c)]);return;}
    if(action==='figure-unpaired-previous'||action==='figure-unpaired-next'){const side=target.dataset.side;need(['native','reference'].includes(side),'Choose an original unpaired source table.');const key=side==='native'?'figureNativePage':'figureReferencePage',rows=list(c.opened?.data?.['unpaired_'+side]),last=Math.max(0,Math.ceil(rows.length/50)-1),page=Number.isSafeInteger(c.state.view[key])?c.state.view[key]:0;c.state.view[key]=Math.max(0,Math.min(last,page+(action==='figure-unpaired-next'?1:-1)));c.dirty=true;queueSave(c);renderBody(c);return;}
    if(action==='figure-previous'||action==='figure-next'){const chosen=moveIndependentFigure(c.opened,c.state.view,action==='figure-next'?1:-1);if(chosen){c.state.view.figureId=chosen;c.dirty=true;queueSave(c);renderBody(c);}return;}
    if(action==='prediction-context-read')return loadPredictionContext(c);
    if(action==='prediction-context-download'){need(c.predictionContext,'Read the complete prediction chapter first.');download('sparrow-prediction-context.json',c.predictionContext);return;}
    if(action==='publisher-field-map-download'){need(c.predictionContext,'Read the complete prediction chapter first.');download('sparrow-publisher-field-map.json',c.predictionContext.sourceMap);return;}
    if(action==='fit-context-read')return loadFitContext(c);
    if(action==='fit-context-download'){need(c.fitContext,'Read the complete published context first.');download('sparrow-published-fit-context.json',c.fitContext);return;}
    if(action==='catalog-json'){download('independent-scientific-reference-catalogue.json',c.catalog?.reference_catalog);return;}
    if(action==='inputs-json'){download('complete-original-comparison-inputs.json',c.opened?.inputs||c.inputs);return;}
    if(action==='result-json'){download('complete-independent-comparison.json',c.opened?.data||c.preview?.data||c.preview);return;}
    if(action==='history-download'){download('retained-comparison-history.json',c.state.history[Number(target.dataset.index)]);return;}
    if(action==='conflicts')return conflicts(c);
    if(action==='conflict-download'){const r=c.conflicts[Number(target.dataset.index)];need(r,'Select a retained conflict.');download('conflicting-comparison-working.json',{schema:'upstate.independent-comparison-working/v1',scope:r.scope,state:r.state,storage_revision:r.revision,conflict:r.conflict});return;}
    if(action==='reopen'||action==='conflict-restore'){
      need(!c.busy&&!c.state.pending,'Keep the current pending request in its original editor.');c.busy=true;paintStatus(c);
      try{clearTimeout(c.timer);await c.tail.catch(()=>{});const prior=clone(c.state);await c.store.preserve(prior,'Visible complete draft before explicit recovery');
        const current=await c.store.read();let next=current?.state||initial();
        if(action==='conflict-restore'){const chosen=c.conflicts[Number(target.dataset.index)];need(chosen,'Select a retained full conflict.');validateWorking(chosen.state);
          if(chosen.state.pending){need(chosen.state.pending.request.workspace===c.scope.workspace,'Recover this request only in its original Workspace.');need(!current?.state.pending||canonical(current.state.pending.request)===canonical(chosen.state.pending.request),'The canonical draft has another pending request; recover it before choosing this retained request.');}
          else need(!current?.state.pending,'The canonical draft has a pending request; reopen and recover it before restoring another draft.');next=clone(chosen.state);next.history.push({at:new Date().toISOString(),reason:'Canonical draft retained before conflict restoration',state:clone(current?.state||initial())});}
        next.history.push({at:new Date().toISOString(),reason:'Visible draft retained before recovery',state:prior});c.state=next;c.revision=current?.revision||0;c.blocked=false;c.error='';c.dirty=true;c.inputs=null;c.preview=null;c.opened=null;await flush(c);render(c);await conflicts(c);
      }finally{c.busy=false;if(ctx===c&&root)paintStatus(c);}return;
    }
    if(action==='report'){need(c.opened?.edition?.source,'Open a saved report source.');return openScientificReport({workspace_key:c.scope.workspace,sources:[clone(c.opened.edition.source)],title:c.opened.edition.title,selection_mode:'append'});}
    if(action==='previous'||action==='next'){c.state.view.page=Math.max(0,c.state.view.page+(action==='next'?1:-1));c.dirty=true;queueSave(c);renderBody(c);return;}
    if(action==='apply-raw'){need(!c.busy&&!c.blocked&&!c.state.pending,'The original draft is not editable.');const next=selectionValid(JSON.parse(c.state.raw));archive(c,'Explicit advanced JSON adoption');if(c.opened?.edition?.id)next.parent_id=c.opened.edition.id;else if(c.state.savedBasis&&canonical(c.state.selection)===c.state.savedBasis.selectionKey)next.parent_id=c.state.savedBasis.editionId;c.state.selection=next;c.state.rawDirty=false;c.state.raw='';c.inputs=null;c.opened=null;changed(c);await flush(c);render(c);return;}
    if(action==='discard-raw'){need(!c.busy&&!c.blocked&&!c.state.pending,'The original draft is not editable.');archive(c,'Explicit unapplied JSON discard');c.state.rawDirty=false;c.state.raw='';changed(c);render(c);return;}
    editable(c);retainParent(c);
    if(action==='new'){archive(c,'New comparison draft');c.state.selection=empty();delete c.state.savedBasis;c.state.raw='';c.state.rawDirty=false;c.inputs=null;c.opened=null;c.state.view.tab='selection';}
    else if(action==='add-pair'){const n=node('[data-pair-native]').value,r=Number(node('[data-pair-reference]').value);need(n&&Number.isSafeInteger(r)&&r>0,'Choose both exact original rows.');c.state.selection.pairs.push({id:uuid(),native_observation_id:n,reference_row_number:r,decision:'context-only',assessment:{quantity:'unknown',fraction:'unknown',space:'unknown',time:'unknown'},rationale:''});}
    else if(action==='remove-pair')c.state.selection.pairs.splice(Number(target.dataset.index),1);
    else throw Error('Choose an independent comparison control.');
    changed(c);render(c);
  }
  function detach(){const c=ctx;if(c){clearTimeout(c.timer);if(c.dirty)queueSave(c);}events?.abort();events=null;root=null;ctx=null;epoch++;}
  async function mount(container){
    detach();root=container;const g=epoch,c=localContext(activeScope());ctx=c;root.innerHTML=controls();events=new AbortController();const signal=events.signal;
    root.addEventListener('load',e=>{if(!alive(c,g)||!e.target.matches?.('[data-figure-image]'))return;const label=node('[data-figure-status]');if(label)label.textContent='Exact saved figure loaded. Full original data and file downloads remain below.';},{signal,capture:true});
    root.addEventListener('error',e=>{if(!alive(c,g)||!e.target.matches?.('[data-figure-image]'))return;const label=node('[data-figure-status]');if(label){label.textContent='The retained figure could not be displayed. Reopen this same saved edition or use its exact SVG and data downloads.';label.classList.add('ic-error');}},{signal,capture:true});
    root.addEventListener('input',e=>{try{if(!e.target.matches('select,[data-native],[data-reference]'))input(e);}catch(error){status(error.message,true);}},{signal});
    root.addEventListener('change',e=>{const t=e.target;
      if(t.matches('[data-budget-filter]')){try{
        if(!alive(c,g))return;
        need(c.predictionContext,'Read the complete publisher prediction chapter first.');
        const key=t.dataset.budgetFilter;need(['comid','parameter','metric'].includes(key),'Choose an original publisher budget display control.');
        const current=selectPublisherBudget(c.predictionContext,c.state.view.publisherBudget||{}).view;
        const selected=selectPublisherBudget(c.predictionContext,{...current,[key]:t.value});
        c.state.view.publisherBudget=clone(selected.view);c.dirty=true;queueSave(c);renderBody(c);
        root.querySelector('[data-budget-filter="'+key+'"]')?.focus();
      }catch(error){if(alive(c,g))status(error.message,true);}return;}
      if(t.matches('[data-figure-filter]')){const key=t.dataset.figureFilter;need(['figureKind','figureParameter','figureId'].includes(key),'Choose an original figure display control.');c.state.view[key]=t.value;if(key!=='figureId')c.state.view.figureId='';c.dirty=true;queueSave(c);renderBody(c);return;}
      if(t.matches('[data-import]')){const file=t.files?.[0];if(file)receive(c,file).catch(error=>{if(alive(c,g))status(error.message,true);});return;}
      try{if(t.matches('[data-native],[data-reference]')){editable(c);retainParent(c);archive(c,'Original source selection changed');
          if(t.matches('[data-native]'))c.state.selection.native_comparison_id=t.value;
          else{const selected=t.value?JSON.parse(t.value):{source_collection_id:'',source_id:'',source_sha256:''},previous=c.state.selection.reference;
            if(['source_collection_id','source_id','source_sha256'].some(k=>selected[k]!==previous[k]))c.state.selection.reference={...empty().reference,...selected};
          }
          c.state.selection.pairs=[];c.state.selection.input_sha256='';c.state.selection.producers={};c.inputs=null;c.opened=null;++c.readEpoch;changed(c);render(c);
          if(t.matches('[data-reference]'))status('Original table changed. Its previous full mapping, definitions and lineage remain in History; select meanings for this source.');
        }else if(t.matches('select')){input(e);if(t.dataset.column==='parameter')renderBody(c);}
        else if(t.dataset.default==='parameter')renderBody(c);
      }catch(error){status(error.message,true);}
    },{signal});
    root.addEventListener('click',e=>{
      const budget=e.target.closest('[data-budget-action]');
      if(budget){e.preventDefault();try{if(alive(c,g))downloadPublisherBudget(c,budget.dataset.budgetAction);}catch(error){if(alive(c,g))status(error.message,true);}return;}
      const t=e.target.closest('[data-ic]');if(!t)return;e.preventDefault();Promise.resolve(click(t.dataset.ic,t)).catch(error=>{if(alive(c,g))status(error.message,true);});},{signal});
    try{if(!c.loaded){const saved=await c.store.read();if(saved){validateWorking(saved.state);c.state=saved.state;c.revision=saved.revision;}c.loaded=true;}if(!alive(c,g))return;render(c);await refresh(c);if(c.state.pending)status('An original request is retained. Use Recover original request to receive its same task; no automatic resubmission.');}
    catch(error){c.blocked=true;c.error=error.message;if(alive(c,g)){render(c);status(c.error,true);}}
  }
  function update(){
    const c=ctx;if(!c||!root)return;if(scopeKey(activeScope())!==scopeKey(c.scope))return mount(root);
    const task=list(getState()?.tasks).find(t=>t.id===c.state.pending?.task?.id);
    if(task&&!c.busy&&(task.state!==c.state.pending.task.state||task.state==='complete')){const originalId=task.id,g=epoch;c.busy=true;paintStatus(c);
      api(endpoint('/api/task',{workspace:c.scope.workspace,id:originalId})).then(full=>{need(full.id===originalId,'The task reader returned a different original operation.');if(!alive(c,g))return;return observeTask(c,full);}).catch(error=>{if(alive(c,g))status(error.message,true);}).finally(()=>{c.busy=false;if(alive(c,g))paintStatus(c);});}
  }
  function taskActions(task){return task?.workspace===getState()?.workspace_key&&task.action==='independent.comparison.save'&&task.state==='complete'&&id(task.result?.id)?'<button type="button" data-action="independent-comparison-open" data-id="'+esc(task.result.id)+'">Open independent comparison</button>':'';}
  async function openEdition(key){if(!root)return openDesk('independent-comparison','openEdition',key);return openSaved(ctx,key);}
  function dispatch(button){if(button.dataset.action==='independent-comparison-open')return openEdition(button.dataset.id);return false;}
  return {mount,update,detach,taskActions,dispatch,openEdition};
}

/**
 * Readable inspection of original operator records.
 * Read-only: no requests, model calculation, source edits or task submission.
 */
import {renderSourceInspectionSummary,SOURCE_INSPECTION_SUMMARY_CSS} from './source_inspection_summary.mjs';
export const SCIENTIFIC_INSPECTION_VERSION='upstate.scientific-inspection/v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const own=(v,k)=>v!==null&&typeof v==='object'&&Object.prototype.hasOwnProperty.call(v,k);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const title=v=>v?.title||v?.metadata?.title||v?.spec?.title||v?.selection?.title||v?.name;
const labels={
 source_collection_id:'Source edition',source_id:'Original source',biophysical_source_id:'Biophysical table',
 mask_source_id:'Scenario mask',grid_id:'Model grid',base_grid_id:'Original grid reused',profile_id:'Parameter profile',
 scenario_id:'Land-cover scenario',run_id:'Native model run',baseline_run_id:'Baseline run',
 scenario_run_ids:'Alternative runs',observation_id:'Observation edition',delivery_id:'Map delivery',
 captured_at:'Source capture date',created_at:'Created',started_at:'Started',ended_at:'Ended',completed_at:'Completed',
 model_period:'Model period',source_uri:'Original source location',uri:'Original source location',vintage:'Source edition / period',
 reporting_area:'Reporting area selection',model_domain:'Upstream model domain',upstream_buffer_m:'Upstream context (m)',
 crs:'Coordinate reference system',crs_name:'Coordinate reference system',coordinate_reference_system:'Coordinate reference system',
 bounds:'Extent in the stated coordinate system',transform:'Native grid transform',
 resolution_m:'Grid resolution (m)',pixel_area_ha:'Cell area (ha)',pixel_resolution:'Pixel size in native coordinate units',
 native_resolution_m:'Square projected cell size (m)',projected_metre_grid:'Projected metre grid',
 width:'Grid columns',height:'Grid rows',count:'Band count',dtypes:'Native value types',nodata:'No-data value',
 valid_cells:'Valid cells',sum:'Recorded total',sum_units:'Total units',units:'Units',
 sum_change:'Signed change',direction:'Difference direction',common_artifacts:'Outputs with shared support',
 nitrogen_export:'Nitrogen export',phosphorus_export:'Phosphorus export',sediment_export:'Sediment export',
 ndr:'Nutrient delivery ratio (NDR)',sdr:'Sediment delivery ratio (SDR)',
 threshold_flow_accumulation:'Stream-initiation threshold (cells)',flow_dir_algorithm:'Flow-routing algorithm',
 k_param:'Connectivity shape parameter k',subsurface_critical_length_n:'Subsurface nitrogen retention length (m)',
 subsurface_eff_n:'Maximum subsurface nitrogen retention fraction',runoff_proxy_av:'Runoff-proxy average',
 sdr_max:'Maximum sediment delivery ratio',ic_0_param:'Connectivity-index midpoint',l_max:'Maximum L factor (dimensionless)',
 lucode:'Land-cover code',lucodes:'Land-cover codes',from_codes:'Original land-cover codes',to_code:'Destination land-cover code',
 load_n:'Nitrogen loading',load_p:'Phosphorus loading',load_type_n:'Nitrogen loading basis',load_type_p:'Phosphorus loading basis',
 eff_n:'Nitrogen retention fraction',eff_p:'Phosphorus retention fraction',crit_len_n:'Nitrogen retention length (m)',
 crit_len_p:'Phosphorus retention length (m)',proportion_subsurface_n:'Subsurface nitrogen fraction',
 usle_c:'USLE cover-management factor',usle_p:'USLE support-practice factor',where:'Selected original attributes',
 feature_count:'Feature count',geometry_type:'Geometry type',selected_layer:'Selected original layer',
 source_count:'Original source count',scope:'Declared scientific scope',references:'Published references',
 payload:'Retained operation inputs',attempts:'Retained execution attempts',progress:'Recorded progress',
 result:'Retained result',state:'State',error:'Execution detail',code:'Support code',message:'Original message',
 sha256:'SHA256',body_sha256:'Original body SHA256',invest_version:'InVEST version',selected_models:'Selected native models',
 models:'Native models',selection:'Original selection',notes:'Notes',reason:'Scientific reason',
 unique_eligible_cells:'Unique eligible cells',net_changed_cells:'Final changed cells',
 eligible_hectares:'Eligible area (ha)',net_changed_hectares:'Final changed area (ha)'
};
const referenceKinds={source_collection_id:'sources',grid_id:'grids',base_grid_id:'grids',profile_id:'profiles',
 scenario_id:'scenarios',run_id:'runs',baseline_run_id:'runs',scenario_run_ids:'runs',run_ids:'runs',
 observation_id:'observations',delivery_id:'deliveries'};
export const scientificLabel=key=>labels[key]||String(key).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/^./,s=>s.toUpperCase());
const plain=v=>v===null||v===undefined?'Not supplied':v===true?'Yes':v===false?'No':String(v);
function namedRecord(data,kind,id){
 const row=(data?.[kind]||[]).find(v=>v.id===id);
 if(!row)return null;
 if(kind==='runs'){
  const selection=row.selection||{},scenario=(data.scenarios||[]).find(x=>x.id===selection.scenario_id);
  const profile=(data.profiles||[]).find(x=>x.id===selection.profile_id);
  return title(row)||[title(scenario),title(profile)].filter(Boolean).join(' · ')||null;
 }
 return title(row)||null;
}
function reference(value,key,context){
 if(typeof value!=='string')return null;
 let name=referenceKinds[key]?namedRecord(context.data,referenceKinds[key],value):null;
 if(['source_id','biophysical_source_id','mask_source_id'].includes(key)&&context.collectionId){
  const collection=(context.data?.sources||[]).find(v=>v.id===context.collectionId);
  const source=collection?.entries?.find(v=>v.id===value);name=title(source);
 }
 return name?'<span>'+esc(name)+'</span><small class="scientific-identity">Original identity: '+esc(value)+'</small>':null;
}
function scalar(value,key,context){
 const ref=reference(value,key,context);if(ref)return ref;
 if(typeof value==='string'&&/^https?:\/\//i.test(value))return '<a href="'+esc(value)+'" target="_blank" rel="noopener noreferrer">'+esc(value)+'</a>';
 return '<span class="scientific-value">'+esc(plain(value))+'</span>';
}
/** Complete field values, with nested named fields instead of serialized objects. */
export function scientificValue(value,key='',context={}){
 if(!object(value)&&!Array.isArray(value))return scalar(value,key,context);
 if(Array.isArray(value)){
  if(!value.length)return '<span class="scientific-empty">No retained entries</span>';
  if(['bounds','extent'].includes(key)&&value.length===4)return scientificFields(Object.fromEntries(['Minimum x','Minimum y','Maximum x','Maximum y'].map((k,i)=>[k,value[i]])),context);
  if(key==='transform'&&value.length===6)return scientificFields(Object.fromEntries(['Column x step','Row x step','X origin','Column y step','Row y step','Y origin'].map((k,i)=>[k,value[i]])),context);
  if(['resolution','pixel_resolution'].includes(key)&&value.length===2)return scientificFields({'X pixel size':value[0],'Y pixel size':value[1]},context);
  // Each retained member remains present. Groups collapse only the view.
  const groups=[];
  for(let start=0;start<value.length;start+=50){
   const group=value.slice(start,start+50),body='<ol class="scientific-list" start="'+(start+1)+'">'+group.map(v=>'<li>'+scientificValue(v,key,context)+'</li>').join('')+'</ol>';
   groups.push(value.length>50?'<details class="scientific-group"'+(start===0?' open':'')+'><summary>Entries '+(start+1)+'–'+(start+group.length)+' of '+value.length+'</summary>'+body+'</details>':body);
  }
  return groups.join('');
 }
 return scientificFields(value,context);
}
export function scientificFields(value,context={}){
 if(!object(value))return scientificValue(value,'',context);
 const local={...context,collectionId:value.source_collection_id||context.collectionId};
 const entries=Object.entries(value);
 if(!entries.length)return '<p class="scientific-empty">No retained fields</p>';
 return '<dl class="scientific-fields">'+entries.map(([k,v])=>'<dt>'+esc(scientificLabel(k))+'</dt><dd>'+scientificValue(v,k,local)+'</dd>').join('')+'</dl>';
}
const knownErrors={
 SOURCE_MISSING:['An original source file is unavailable.','Receive the complete original source edition, then reopen this selection. Preserve the saved operation while restoring its files.'],
 SOURCE_CHANGED:['The selected source edition changed.','Reopen the source preview and select the intended retained edition before preparing a new operation.'],
 SOURCE_LAYER:['The selected layer is unavailable in this file.','Inspect the original source and select one of its listed native layers.'],
 SOURCE_SELECTION:['The selected source is not registered here.','Open Original sources in this Workspace and choose the retained source manifest.'],
 SOURCE_SCHEMA:['This file is not a supported source manifest.','Use source intake to select the original manifest and its complete files.'],
 SOURCE_CAPACITY:['The complete source exceeds the selected receiving capacity.','Keep the original file. Ask the operator to provide sufficient receiving storage or a supported complete transfer.'],
 NATIVE_BUSY:['This Workspace already has an active operation.','Open Operations and follow the existing task before starting another operation on the same selection.'],
 OPERATOR_REOPENED:['The operator reopened during this task.','Inspect the saved model state and retained outputs, then use Resume original selection when the native process is no longer active.'],
 OPERATOR_DRAINING:['The operator is closing or reopening.','Keep this saved operation and resume it after the original operator is available.'],
 OPERATION_REUSED:['This request identity belongs to a different selection.','Open the existing saved operation. Create a new deliberate selection only if different inputs are intended.'],
 OPERATION_ALIAS_INVALID:['The saved request no longer matches its original operation.','Keep the original operation and ask the operator to reconcile its retained request before any retry.'],
 RESPONSE_INVALID:['The operator response could not be read.','Refresh the Workspace and inspect Operations before repeating an action; the original request may already be saved.'],
 NATIVE_ERROR:['The native calculation did not finish successfully.','Read the retained execution detail and source selections below. Correct the identified source or runtime issue before resuming the original operation.'],
 INPUT_INVALID:['The selected inputs need a correction.','Review the original validation message below, correct the named input or source mapping, and keep the existing selection.']
};
export function scientificDiagnostic(error,{state=''}={}){
 const code=String(error?.code||''),message=typeof error==='string'?error:String(error?.message||'');
 const known=knownErrors[code],trace=/Traceback \(most recent call last\)|\n\s+at |File ".+", line \d/.test(message);
 const summary=known?.[0]||(trace?'The operation could not finish.':message||'The operation could not finish.');
 const next=known?.[1]||(state==='running'||state==='queued'?'Inspect the active saved operation before retrying.':'Review the retained selection and original execution detail. Correct the identified issue before resuming the same saved operation.');
 return {summary,next,code,message,showDetail:!!(code||message&&message!==summary)};
}
export function scientificError(error,options={}){
 const d=scientificDiagnostic(error,options);
 return '<section class="scientific-diagnostic"><h3>'+esc(d.summary)+'</h3><p>'+esc(d.next)+'</p>'+
 (d.showDetail?'<details><summary>Original validation and support detail'+(d.code?' · '+esc(d.code):'')+'</summary><pre>'+esc(d.message||'No additional message was supplied.')+'</pre></details>':'')+'</section>';
}
function selectedSource(data,collectionId,selection){
 if(!selection)return 'Not retained';
 const collection=(data.sources||[]).find(v=>v.id===collectionId);
 const source=collection?.entries?.find(v=>v.id===selection.source_id);
 return {source_id:selection.source_id,title:title(source)||'Original source title unavailable',layer:selection.layer??source?.layer??'Default retained layer',
 ...(own(selection,'where')?{where:selection.where}:{})};
}
export function scientificRunContext(run,data={}){
 const selection=run.selection||{},grid=(data.grids||[]).find(v=>v.id===selection.grid_id);
 const profile=(data.profiles||[]).find(v=>v.id===selection.profile_id);
 const scenario=(data.scenarios||[]).find(v=>v.id===selection.scenario_id);
 const collectionId=grid?.spec?.source_collection_id;
 const context={data,collectionId};
 const values={grid_id:selection.grid_id,profile_id:selection.profile_id,scenario_id:selection.scenario_id,
  source_collection_id:collectionId??'Source edition unavailable in this Workspace view',
  reporting_area:selectedSource(data,collectionId,grid?.spec?.reporting_area),
  model_domain:selectedSource(data,collectionId,grid?.spec?.model_domain),
  model_period:profile?.model_period??'No explicit model period was retained; review the original source vintages.',
  ...(grid?.grid?{resolution_m:grid.grid.resolution_m,crs:grid.grid.crs_name||grid.grid.crs}:{}),
  ...(scenario?.reason?{reason:scenario.reason}:{})};
 return '<section class="scientific-section"><h3>Where and when these results apply</h3>'+scientificFields(values,context)+
 '<p class="scientific-note">Native NDR and SDR exports describe modeled delivery to streams on the selected reporting mask. They are not measured intake concentrations. The upstream model domain and the reporting area are distinct selections.</p>'+
 '<p class="scientific-note">Totals, units and valid-cell counts below are copied from the retained native artifacts. Missing coverage or uncertainty is not estimated by this view; use the original comparison and scientific review for that support.</p></section>';
}
export function scientificTask(task,data={}){
 const notices={queued:'The original operation is queued. Follow this saved task; opening it does not submit it again.',
 running:'The original operation is running. Its saved result will appear here when the operator records it.',
 complete:'The operator recorded completion. Open the saved result and its retained files below.',
 failed:'This attempt failed. The original input selection and preceding attempts are retained.',
 interrupted:'This operation was interrupted. Inspect the retained state before resuming the original selection.',
 cancelled:'This operation was cancelled. Its original input selection remains retained.'};
 const attempts=Array.isArray(task.attempts)?task.attempts:[];
 let html='<section class="scientific-section"><h3>Operation and selected scientific inputs</h3><p>'+esc(notices[task.state]||'Inspect the recorded state of this original operation.')+'</p>';
 if(task.error)html+=scientificError(task.error,{state:task.state});
 html+=scientificFields(task.payload||{}, {data});
 if(task.progress!==undefined)html+='<h4>Recorded progress</h4>'+scientificValue(task.progress,'progress',{data});
 if(task.result!==undefined)html+='<details class="scientific-group"><summary>Retained result fields</summary>'+scientificValue(task.result,'result',{data})+'</details>';
 if(attempts.length)html+='<details class="scientific-group"><summary>'+attempts.length+' retained execution '+(attempts.length===1?'attempt':'attempts')+'</summary>'+attempts.map((a,i)=>'<section><h4>Attempt '+esc(a.number??i+1)+'</h4>'+scientificFields(Object.fromEntries(Object.entries(a).filter(([k])=>k!=='error')),{data})+(a.error?scientificError(a.error,{state:a.state}):'')+'</section>').join('')+'</details>';
 return html+'</section>';
}
export const SCIENTIFIC_INSPECTION_CSS="\n#detail-title,#detail-body>p,#detail-body td{overflow-wrap:anywhere}\n#detail-body td button{overflow-wrap:normal;white-space:nowrap}\n.scientific-inspection,.scientific-section,.scientific-diagnostic,.scientific-fields,.scientific-downloads{color:#202b33;background:#fff;box-sizing:border-box}\n.scientific-inspection{font:14px/1.5 Arial,Helvetica,sans-serif;max-width:1100px;margin:0 auto;padding:24px}\n.scientific-inspection h1{font-size:26px;line-height:1.25;margin:0 0 12px;overflow-wrap:anywhere}\n.scientific-inspection h2,.scientific-section h3{font-size:18px;line-height:1.35;margin:0 0 12px}\n.scientific-inspection h3,.scientific-inspection h4,.scientific-section h4{margin:18px 0 10px}\n.scientific-section{margin:16px 0;border:1px solid #cbd2d8;padding:18px;border-radius:4px}\n.scientific-fields{display:grid;grid-template-columns:minmax(135px,1fr) minmax(0,2fr);gap:0;margin:12px 0;font-size:13px;min-width:0}\n.scientific-fields>dt,.scientific-fields>dd{margin:0;padding:9px 0;border-bottom:1px solid #e2e6e9;overflow-wrap:anywhere;min-width:0}\n.scientific-fields>dt{padding-right:16px;font-weight:600;color:#435361}\n.scientific-fields>dd .scientific-fields{margin:0;grid-template-columns:minmax(115px,1fr) minmax(0,1.5fr)}\n.scientific-fields>dd .scientific-fields>dt{font-weight:400}\n.scientific-fields a,.scientific-inspection a{color:#174b67}\n.scientific-value{white-space:pre-wrap;overflow-wrap:anywhere}\n.scientific-identity{display:block;font:11px/1.5 ui-monospace,monospace;color:#52616b;margin-top:4px;overflow-wrap:anywhere}\n.scientific-list{margin:0;padding-left:24px}\n.scientific-list>li{margin:4px 0;padding-left:3px}\n.scientific-group{margin:12px 0;color:#202b33;background:#fff}\n.scientific-group>summary,.scientific-diagnostic summary{cursor:pointer;padding:7px 0;font-weight:600;color:#344856}\n.scientific-note,.scientific-empty{font-size:13px;line-height:1.6;color:#53616b}\n.scientific-note{margin:14px 0 0}\n.scientific-diagnostic{border:1px solid #c9bba9;border-left:4px solid #8d7356;padding:14px 16px;border-radius:3px;margin:12px 0}\n.scientific-diagnostic h3{font-size:14px;margin:0 0 7px;overflow-wrap:anywhere}\n.scientific-diagnostic p{font-size:13px;margin:0}\n.scientific-diagnostic pre,.scientific-inspection pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f6;color:#23303b;border:1px solid #d4dce1;padding:12px;font:12px/1.5 ui-monospace,monospace;max-height:420px;overflow:auto}\n.scientific-downloads{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:0 0 14px}\n.scientific-downloads button{border:1px solid #aeb9c1;border-radius:3px;padding:8px 12px;font:13px/1.4 Arial,Helvetica,sans-serif;color:#202b33;background:#fff;cursor:pointer}\n.scientific-downloads button:hover{background:#edf1f4}\n.scientific-downloads button:disabled{color:#58646d;background:#eceff1;opacity:1;cursor:wait}\n.scientific-downloads button:focus-visible,.scientific-group>summary:focus-visible,.scientific-diagnostic summary:focus-visible{outline:3px solid #6b8ba0;outline-offset:2px}\n@media(max-width:600px){.scientific-inspection{padding:16px}.scientific-section{padding:13px}.scientific-fields,.scientific-fields>dd .scientific-fields{grid-template-columns:1fr}.scientific-fields>dt{padding:10px 0 2px;border:0}.scientific-fields>dd{padding:3px 0 10px}.scientific-fields>dd .scientific-fields{border-left:2px solid #d6dee4;padding-left:12px}.scientific-downloads{align-items:stretch}.scientific-downloads button{flex:1 1 180px}}\n@media print{.scientific-inspection{max-width:none;padding:0}.scientific-section{break-inside:avoid}.scientific-inspection pre{max-height:none;overflow:visible}}\n";

/** Exclude ephemeral download tickets; original scientific fields stay unchanged. */
export function scientificRecord(record){
 return JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(record||{}).filter(([key])=>!['_downloads','download'].includes(key)))));
}
export function scientificDocument({kind,record,title:heading,data={}}){
 const original=scientificRecord(record),context={data,collectionId:record?.source_collection_id||record?.source?.source_collection_id};
 const sourceView=renderSourceInspectionSummary(original,{data,kind});
 const view=sourceView||(kind==='runs'?scientificRunContext(original,data):kind==='task'?scientificTask(original,data):'');
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>'+esc(heading)+'</title><style>'+
 SCIENTIFIC_INSPECTION_CSS+SOURCE_INSPECTION_SUMMARY_CSS+'</style></head><body><main class="scientific-inspection"><p class="scientific-note">Upper Savannah · Retained scientific inspection</p><h1>'+esc(heading)+'</h1>'+
 (sourceView?'<p>Read the original source contents, saved choices and linked scientific settings below. Expand the provenance for every retained field and the original structured record.</p>':'<p>This read-only document contains the selected saved '+esc(scientificLabel(kind))+' record. It is not a complete Workspace backup. Original scientific inputs and values are retained below; this document cannot execute tasks. Top-level temporary download controls are omitted; links within the retained scientific provenance stay unchanged.</p>')+view+
 (sourceView?'<details class="scientific-group"><summary>Complete source provenance and retained fields</summary>'+scientificFields(original,context)+'</details>':'<section class="scientific-section"><h2>Complete retained fields</h2>'+scientificFields(original,context)+'</section>')+
 '<details class="scientific-group"><summary>Original structured record</summary><pre>'+esc(JSON.stringify(original,null,2))+'</pre></details>'+
 '<p class="scientific-note">TokenJunkieLabs · '+SCIENTIFIC_INSPECTION_VERSION+'</p></main></body></html>\n';
}
/** Use the original operator's typed source report for completed source intake.
 * The ticket stays bound to its frozen record and Workspace; the full original
 * JSON remains independently downloadable below.
 */
export function scientificSourceReport(record,workspace){
 const action=record?.action||record?._client_source?.action;
 if(!['client-source.inspect','client-source.commit'].includes(action))return null;
 const tickets=Array.isArray(record?._downloads)?record._downloads:[];
 const report=tickets.find(value=>value?.role==='source-inspection-report'&&value.kind==='html');
 if(!report)return null;
 if(report.workspace!==workspace||typeof report.url!=='string'||
    !/^\/api\/file\/[a-f0-9]{64}$/.test(report.url)||
    typeof report.filename!=='string'||!/^[^\\/\u0000-\u001f]+\.html$/.test(report.filename)||
    !/^[a-f0-9]{64}$/.test(report.sha256||'')||
    !Number.isSafeInteger(report.bytes)||report.bytes<1)return null;
 return {...report};
}
export function createScientificInspection({getState,getWorkspace,reportError}){
 let release=null;
 const data=()=>getState()?.data||{};
 const fields=value=>scientificFields(value,{data:data(),collectionId:value?.source_collection_id});
 function clear(){release?.();release=null;}
 function bind(container,selection){
  clear();if(!container||!selection?.record)return;
  const workspace=getWorkspace(),record=scientificRecord(selection.record);
  const sourceReport=scientificSourceReport(selection.record,workspace);
  const sourceTask=['client-source.inspect','client-source.commit'].includes(selection.record.action||selection.record._client_source?.action);
  // Snapshot the rendered edition once. A later state refresh cannot relabel this export.
  const html=sourceReport?null:scientificDocument({...selection,record,data:data()});
  const json=JSON.stringify(record,null,2)+'\n';
  const controls=document.createElement('div');controls.className='scientific-downloads';
  controls.innerHTML='<button type="button" data-scientific-download="html">'+(sourceTask&&!sourceReport?'Download technical inspection':'Download readable inspection')+'</button><button type="button" data-scientific-download="json">Download original record JSON</button>';
  let active=true;
  const onClick=event=>{
   const button=event.target.closest('[data-scientific-download]');
   if(!button||!controls.contains(button))return;
   event.preventDefault();event.stopPropagation();
   try{
    if(!active||!controls.isConnected||getWorkspace()!==workspace)throw Error('Reopen this record in its original Workspace before downloading.');
    const type=button.dataset.scientificDownload;
    if(type==='html'&&sourceReport){
     const anchor=document.createElement('a');anchor.href=sourceReport.url+'?download=1';
     anchor.download=sourceReport.filename;document.body.append(anchor);anchor.click();anchor.remove();return;
    }
    const content=type==='html'?html:json;
    const name=String(selection.title||selection.kind||'scientific-record').normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100)||'scientific-record';
    const url=URL.createObjectURL(new Blob([content],{type:type==='html'?'text/html;charset=utf-8':'application/json;charset=utf-8'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=name+'-inspection.'+type;document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
   }catch(error){reportError?.(error);}
  };
  controls.addEventListener('click',onClick);container.prepend(controls);
  release=()=>{active=false;controls.removeEventListener('click',onClick);controls.remove();};
 }
 function installStyles(document){
  if(document.getElementById('scientific-inspection-style'))return;
  // The original operator permits same-origin stylesheets, not inline styles.
  // Keep this asset identical to SCIENTIFIC_INSPECTION_CSS for offline exports.
  const style=document.createElement('link');style.id='scientific-inspection-style';style.rel='stylesheet';style.href=new URL('./scientific_inspection.css',import.meta.url).href;document.head.append(style);
 }
 return {fields,clear,bind,installStyles,run:row=>scientificRunContext(row,data()),task:row=>scientificTask(row,data()),error:scientificError,diagnostic:scientificDiagnostic};
}

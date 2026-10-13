/** Optional load integration over a saved original daily-flow study. */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=x=>JSON.parse(JSON.stringify(x));
const num=x=>x==null?'—':Number(x).toLocaleString(undefined,{maximumSignificantDigits:9});
const option=(v,t,s='')=>'<option value="'+esc(v)+'"'+(v===s?' selected':'')+'>'+esc(t)+'</option>';
const ORIGINAL_CONTRACT="{\n  \"schema\": \"upstate.observed-loads-contract/v1\",\n  \"period\": {\n    \"start\": \"2020-01-01\",\n    \"end\": \"2026-10-13\"\n  },\n  \"maximum_interpolation_gap_days\": 45,\n  \"daily_concentration_basis\": \"date_assigned_grab_with_daily_mean_flow\",\n  \"accepted_concentration_qualifiers\": [\n    \"\"\n  ],\n  \"accepted_concentration_statuses\": [\n    \"Final\"\n  ],\n  \"accepted_censoring_conditions\": [\n    \"Present Below Quantification Limit\",\n    \"Not Detected\"\n  ],\n  \"accepted_flow_approval_statuses\": [\n    \"Approved\"\n  ],\n  \"accepted_flow_qualifiers\": [\n    \"\"\n  ],\n  \"accepted_flow_validity\": [\n    \"\"\n  ],\n  \"event_sampling_policy\": \"retain_only\",\n  \"source_references\": [\n    \"https://www.waterqualitydata.us/\",\n    \"https://waterdata.usgs.gov/monitoring-location/02186702/\"\n  ],\n  \"support\": [\n    {\n      \"station_id\": \"21SC60WQ_WQX-SV-233\",\n      \"gauge_id\": \"USGS-02186702\",\n      \"gauge_relation\": \"downstream_same_reach\",\n      \"accepted\": false,\n      \"location_match\": false,\n      \"catchment_match\": false,\n      \"catchment_id\": \"\",\n      \"evidence\": [\n        \"original/eighteenmile-sv233-hydrolocation.json\",\n        \"original/eighteenmile-gauge-network-location.json\",\n        \"original/eighteenmile-upstream-wqp.json\"\n      ],\n      \"reason\": \"Original network relationship does not establish coincident concentration and discharge support.\"\n    },\n    {\n      \"station_id\": \"21SC60WQ_WQX-SV-245\",\n      \"gauge_id\": \"USGS-02186702\",\n      \"gauge_relation\": \"indexed_upstream_reach\",\n      \"accepted\": false,\n      \"location_match\": false,\n      \"catchment_match\": false,\n      \"catchment_id\": \"\",\n      \"evidence\": [\n        \"original/eighteenmile-sv245-hydrolocation.json\",\n        \"original/eighteenmile-gauge-network-location.json\",\n        \"original/eighteenmile-upstream-wqp.json\"\n      ],\n      \"reason\": \"Original network relationship does not establish coincident concentration and discharge support.\"\n    },\n    {\n      \"station_id\": \"21SC60WQ_WQX-SV-375\",\n      \"gauge_id\": \"USGS-02186702\",\n      \"gauge_relation\": \"indexed_upstream_reach\",\n      \"accepted\": false,\n      \"location_match\": false,\n      \"catchment_match\": false,\n      \"catchment_id\": \"\",\n      \"evidence\": [\n        \"original/eighteenmile-sv375-hydrolocation.json\",\n        \"original/eighteenmile-gauge-network-location.json\",\n        \"original/eighteenmile-upstream-wqp.json\"\n      ],\n      \"reason\": \"Original network relationship does not establish coincident concentration and discharge support.\"\n    },\n    {\n      \"station_id\": \"21SC60WQ_WQX-SV-376\",\n      \"gauge_id\": \"USGS-02186702\",\n      \"gauge_relation\": \"indexed_upstream_reach\",\n      \"accepted\": false,\n      \"location_match\": false,\n      \"catchment_match\": false,\n      \"catchment_id\": \"\",\n      \"evidence\": [\n        \"original/eighteenmile-sv376-hydrolocation.json\",\n        \"original/eighteenmile-gauge-network-location.json\",\n        \"original/eighteenmile-upstream-wqp.json\"\n      ],\n      \"reason\": \"Original network relationship does not establish coincident concentration and discharge support.\"\n    }\n  ],\n  \"native_comparison_mappings\": [],\n  \"seasons\": []\n}\n";
const CONTRACT_PATH='source/observed-load-integration-20261013/flow-study-load-contract.json';
function parse(text){const v=JSON.parse(text);if(v?.schema!=='upstate.observed-loads-contract/v1')throw Error('Choose a complete observed-loads contract.');return v;}
async function fileText(file){if(!file?.size)throw Error('Choose the original contract JSON.');if(file.size>16*1024*1024)throw Error('The contract exceeds the 16 MiB input limit.');return new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}
function download(name,value,type='application/json'){
 const text=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function saveBundle(value){
 if(!value||typeof value.base64!=='string'||!Number.isSafeInteger(value.bytes)||value.bytes<0||!/^[a-f0-9]{64}$/.test(value.sha256))throw Error('The retained bundle descriptor is incomplete.');
 const binary=atob(value.base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
 if(bytes.length!==value.bytes)throw Error('The retained bundle size differs from its descriptor.');
 if(globalThis.crypto?.subtle){const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');if(digest!==value.sha256)throw Error('The retained bundle checksum differs from its descriptor.');}
 const url=URL.createObjectURL(new Blob([bytes],{type:value.type||'application/zip'})),a=document.createElement('a');a.href=url;a.download=value.name||'flow-bundle.zip';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function table(headers,rows,label){return '<div class="mf-scroll" tabindex="0" role="region" aria-label="'+esc(label)+'"><table><thead><tr>'+headers.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function facts(values){return '<dl class="mf-facts">'+values.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(num(v))+'</dd></div>').join('')+'</dl>';}

/** Labeled scientist controls preserve every unedited contract field and source relationship. */
const LOAD_ARRAY_FIELDS=[
 ['accepted_concentration_statuses','Accepted concentration result statuses'],
 ['accepted_concentration_qualifiers','Accepted concentration qualifiers'],
 ['accepted_censoring_conditions','Accepted left-censor conditions'],
 ['accepted_flow_approval_statuses','Accepted discharge approval statuses'],
 ['accepted_flow_qualifiers','Accepted discharge qualifiers'],
 ['accepted_flow_validity','Accepted discharge validity labels'],
 ['source_references','Original method and data references']
];
const LOAD_LEFT_CONDITIONS=['Not Detected','Present Below Quantification Limit'];
const loadOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const loadDate=value=>{const stamp=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==value)throw Error('The saved flow calendar has an invalid date.');return stamp;};
export function loadContractFromStudy(study){
 if(study?.schema!=='upstate.daily-flow-study/v1'||!Array.isArray(study.sample_context?.rows)||!Array.isArray(study.input?.relations))throw Error('Open a complete saved Flow study first.');
 const relations=new Map(study.input.relations.map(r=>[r.station_id,r]));
 const support=[...new Set(study.sample_context.rows.map(r=>r.station_id))].map(station_id=>{
  const r=relations.get(station_id),source=String(r?.source||'');
  return {station_id,gauge_id:r?.gauge_id||'',gauge_relation:r?.gauge_relation||'unassigned',...(r?{flow_location_role:r.flow_location_role}:{}),
   accepted:false,location_match:false,catchment_match:false,catchment_id:r?.catchment_id||'',
   evidence:source?source.split(';').map(s=>s.trim()).filter(Boolean):[],
   reason:'Retained original relationship; scientist has not admitted concentration/discharge support.'};
 });
 return {schema:'upstate.observed-loads-contract/v1',period:{start:study.edition.start,end:new Date(loadDate(study.edition.end)+86400000).toISOString().slice(0,10)},
  maximum_interpolation_gap_days:null,daily_concentration_basis:'date_assigned_grab_with_daily_mean_flow',
  accepted_concentration_qualifiers:[''],accepted_concentration_statuses:['Final'],accepted_censoring_conditions:[],
  accepted_flow_approval_statuses:['Approved'],accepted_flow_qualifiers:[''],accepted_flow_validity:[''],event_sampling_policy:'retain_only',
  source_references:[...new Set(study.input.sources.map(r=>r.uri).filter(Boolean))],support,seasons:[],native_comparison_mappings:[]};
}
export function loadSupportDecision(study,support){
 if(!study)return {allowed:false,reason:'Inspect the selected saved study to bind these controls to its original source relationship.'};
 const rows=study.sample_context.rows.filter(r=>r.station_id===support.station_id),relations=study.input.relations.filter(r=>r.station_id===support.station_id);
 if(!rows.length||relations.length!==1)return {allowed:false,reason:'The selected study does not supply one original relationship for this sampled station.'};
 const r=relations[0];
 if(r.gauge_id!==support.gauge_id||r.gauge_relation!==support.gauge_relation||(loadOwn(support,'flow_location_role')&&r.flow_location_role!==support.flow_location_role))
  return {allowed:false,reason:'This contract refers to a different relationship. Retain it as an original or start a draft from the selected study.'};
 if(r.gauge_relation!=='co_located'||r.flow_location_role!=='matched_catchment_discharge'||rows.some(v=>v.annual_mass_spatial_support!==true))
  return {allowed:false,reason:'Original evidence supplies regional, downstream or unassigned context. It does not establish matched concentration and catchment discharge.'};
 if(!String(r.source||'').trim())return {allowed:false,reason:'The original relationship has no retained support evidence.'};
 return {allowed:true,reason:'The original study explicitly records coincident, matched catchment discharge. Admission still requires the scientist’s location, catchment and evidence decisions.',relation:r};
}
const LOAD_SCALAR_PATHS=new Set(['period.start','period.end','maximum_interpolation_gap_days','daily_concentration_basis','event_sampling_policy']);
/** A single control changes one declared field; all other data, order and unknown fields survive. */
export function editLoadContract(document,edit,study=null){
 const value=clone(document);if(value?.schema!=='upstate.observed-loads-contract/v1')throw Error('Load a complete observed-load contract before editing.');
 const {section,index,field,action}=edit;
 if(section==='scalar'){
  if(!LOAD_SCALAR_PATHS.has(field))throw Error('Unknown scientific control.');
  if(field.startsWith('period.')){value.period={...(value.period||{}),[field.slice(7)]:edit.value};}
  else value[field]=field==='maximum_interpolation_gap_days'?(edit.value===''?null:Number(edit.value)):edit.value;
  return value;
 }
 if(LOAD_ARRAY_FIELDS.some(([key])=>key===section)){
  if(!Array.isArray(value[section])||value[section].some(v=>typeof v!=='string'))throw Error('The original '+section+' needs an explicit string array; retain or repair its advanced source.');
  if(action==='add')value[section].push('');
  else if(Number.isInteger(index)&&index>=0&&index<value[section].length){
   if(action==='remove')value[section].splice(index,1);else if(action==='set')value[section][index]=String(edit.value);else throw Error('Unknown source-list action.');
  }else throw Error('Original source-list row no longer exists.');
  return value;
 }
 if(['seasons','native_comparison_mappings'].includes(section)&&value[section]===undefined&&action==='add')value[section]=[];
 if(!['support','seasons','native_comparison_mappings'].includes(section)||!Array.isArray(value[section]))throw Error('Retain an explicit original scientific row list.');
 const rows=value[section];
 if(action==='add'){
  if(section==='support')throw Error('Sampled support rows come from the selected original study.');
  rows.push(section==='seasons'?{label:'',start:value.period?.start||'',end:value.period?.end||''}:{series_key:'',parameter:'',species:'',evidence:[]});return value;
 }
 if(!Number.isInteger(index)||index<0||index>=rows.length)throw Error('Original scientific row no longer exists.');
 if(action==='remove'){if(section==='support')throw Error('Retain sampled support; mark it context-only instead.');rows.splice(index,1);return value;}
 const row=rows[index],allowed=section==='support'?['accepted','location_match','catchment_match','catchment_id','reason','evidence']:
  section==='seasons'?['label','start','end']:['series_key','parameter','species','evidence'];
 if(action!=='set'||!allowed.includes(field))throw Error('This original identity is read-only.');
 if(section==='support'){
  const decision=loadSupportDecision(study,row);
  if(['accepted','location_match','catchment_match'].includes(field)&&edit.value===true&&!decision.allowed)throw Error(decision.reason);
  if(field==='catchment_id'&&decision.relation&&loadOwn(decision.relation,'catchment_id')&&edit.value!==decision.relation.catchment_id)throw Error('Retain the original selected catchment identity.');
 }
 row[field]=field==='evidence'?String(edit.value).split(/\r?\n/).map(v=>v.trim()).filter(Boolean):edit.value;
 return value;
}
function contractControl(section,index,field,extra=''){return ' data-contract-section="'+esc(section)+'"'+(index==null?'':' data-contract-index="'+index+'"')+' data-contract-field="'+esc(field||'')+'" '+extra;}
function contractInput(label,value,section,index,field,type='text',extra=''){
 return '<label>'+esc(label)+'<input type="'+type+'" value="'+esc(value)+'"'+contractControl(section,index,field,extra)+'></label>';
}
function contractSelect(label,value,choices,section,index,field,extra=''){
 const retained=choices.some(([id])=>id===value)?'':option(value,'Retained original: '+(value||'(blank)'),value);
 return '<label>'+esc(label)+'<select'+contractControl(section,index,field,extra)+'>'+retained+choices.map(([id,label])=>option(id,label,value)).join('')+'</select></label>';
}
function contractAction(label,section,index,action){return '<button type="button" data-contract-action="'+action+'" data-contract-section="'+section+'"'+(index==null?'':' data-contract-index="'+index+'"')+'>'+esc(label)+'</button>';}
function contractList(contract,key,label){
 const rows=contract[key];if(!Array.isArray(rows)||rows.some(v=>typeof v!=='string'))return '<p class="mf-notice">'+esc(label)+': the original shape is not an editable string list. Its complete content remains in Advanced contract.</p>';
 return '<details><summary>'+esc(label)+' ('+rows.length+')</summary><p class="mf-muted">'+(key==='source_references'?'Retain source URLs or original evidence paths.':'Values are literal, case-sensitive source labels. An empty row explicitly accepts the blank source value; an empty list accepts none. Editing never changes source observations.')+'</p>'+rows.map((v,i)=>{
 const input=key==='accepted_censoring_conditions'?contractSelect('Condition '+(i+1),v,[['','Choose a supported left-censor condition'],...LOAD_LEFT_CONDITIONS.map(x=>[x,x])],key,i,''):
  contractInput('Original value '+(i+1)+(v===''?' (blank source value)':''),v,key,i,'');
 return '<div class="mf-contract-row">'+input+contractAction('Remove value',key,i,'remove')+'</div>';
 }).join('')+contractAction('Add explicit value',key,null,'add')+'</details>';
}
export function loadContractFormHTML(contract,{study=null,series=[]}={}){
 if(contract?.schema!=='upstate.observed-loads-contract/v1')return '<p>Load a contract or start one from the selected saved study.</p>';
 const s=contract.support,seasons=contract.seasons===undefined?[]:contract.seasons,mappings=contract.native_comparison_mappings===undefined?[]:contract.native_comparison_mappings;
 const scalar='<h4>Calculation dates and temporal assumptions</h4><div class="mf-grid">'+
  contractInput('First included date',contract.period?.start||'','scalar',null,'period.start','date')+
  contractInput('First excluded date',contract.period?.end||'','scalar',null,'period.end','date')+
  contractInput('Maximum days between interpolation endpoints',contract.maximum_interpolation_gap_days??'','scalar',null,'maximum_interpolation_gap_days','number','min="1" step="1"')+
  contractSelect('Event-targeted sample handling',contract.event_sampling_policy,[['retain_only','Retain as source context; exclude from interpolation'],['include_with_declared_bias','Include with explicitly declared event-sampling bias']],'scalar',null,'event_sampling_policy')+'</div>'+
  contractSelect('Concentration / discharge time support',contract.daily_concentration_basis,[['date_assigned_grab_with_daily_mean_flow','Assign grab samples to original dates and use daily mean discharge']],'scalar',null,'daily_concentration_basis')+
  '<p class="mf-notice">Choose the interpolation gap explicitly. Between eligible dated samples, the engine linearly interpolates only within that gap. It never extrapolates endpoints or fills missing discharge. Daily-mean flow and grab-sample timing remain an approximation, and event bias is not corrected by inclusion. Finite censor bounds are not confidence intervals.</p>';
 const support=Array.isArray(s)?s.map((r,i)=>{
  const d=loadSupportDecision(study,r),lock=d.allowed?'':'data-unavailable="true" disabled',r0=d.relation;
  const checks=[['accepted','Accept this original support for mass integration'],['location_match','Concentration and discharge locations are explicitly matched'],['catchment_match','The original catchment is explicitly matched']].map(([f,l])=>'<label class="mf-check"><input type="checkbox"'+(r[f]===true?' checked':'')+contractControl('support',i,f,lock)+'><span>'+esc(l)+'</span></label>').join('');
  return '<details><summary>'+esc(r.station_id)+' · '+esc(r.gauge_relation||'Unassigned')+'</summary><p>Original gauge: <strong>'+esc(r.gauge_id||'Unassigned')+'</strong><br>Original flow role: '+esc(r.flow_location_role||r0?.flow_location_role||'Not specified in this contract')+'</p><p class="mf-notice">'+esc(d.reason)+'</p>'+checks+
   (d.allowed?'':contractAction('Retain this station as context only','support',i,'context'))+
   contractInput('Original catchment identity',r.catchment_id||'','support',i,'catchment_id','text',r0&&loadOwn(r0,'catchment_id')?'readonly':'')+
   contractInput('Scientist’s support rationale',r.reason||'','support',i,'reason')+
   '<label>Retained evidence URLs or paths (one per line)<textarea rows="3"'+contractControl('support',i,'evidence')+'>'+esc(Array.isArray(r.evidence)?r.evidence.join('\n'):'')+'</textarea></label>'+
   '<p class="mf-muted">Station, gauge, spatial relationship and flow role belong to the saved parent study. Correct those originals in a new Flow study; this form cannot replace them.</p></details>';
 }).join(''):'<p class="mf-notice">The original support list is not editable. Its complete source remains in Advanced contract.</p>';
 const seasonal=Array.isArray(seasons)?seasons.map((r,i)=>'<div class="mf-contract-block"><div class="mf-grid">'+contractInput('Period label',r.label||'','seasons',i,'label')+contractInput('First included date',r.start||'','seasons',i,'start','date')+contractInput('First excluded date',r.end||'','seasons',i,'end','date')+'</div>'+contractAction('Remove seasonal interval','seasons',i,'remove')+'</div>').join('')+contractAction('Add seasonal interval','seasons',null,'add'):'<p>Seasonal intervals are absent or have an unsupported original shape. Retain or edit Advanced contract.</p>';
 const native=Array.isArray(mappings)?mappings.map((r,i)=>'<div class="mf-contract-block">'+
  contractSelect('Exact original method/fraction series',r.series_key||'',[['','Choose a previewed original series'],...series.map(x=>[x.series_key,x.station_id+' · '+x.characteristic+' / '+x.sample_fraction+' / '+x.method_id])],'native_comparison_mappings',i,'series_key')+
  '<div class="mf-grid">'+contractSelect('Native annual quantity',r.parameter||'',[['','Choose a compatible quantity'],['nitrogen','Nitrogen (kg/year)'],['phosphorus','Phosphorus (kg/year)'],['sediment','Suspended sediment (metric tonnes/year)']],'native_comparison_mappings',i,'parameter')+
  contractInput('Explicit original species',r.species||'','native_comparison_mappings',i,'species')+'</div><label>Original species/fraction comparability evidence (one reference per line)<textarea rows="3"'+contractControl('native_comparison_mappings',i,'evidence')+'>'+esc(Array.isArray(r.evidence)?r.evidence.join('\n'):'')+'</textarea></label>'+contractAction('Remove comparison mapping','native_comparison_mappings',i,'remove')+'</div>').join('')+contractAction('Add explicit comparison mapping','native_comparison_mappings',null,'add'):'<p>Native comparison mappings are absent or have an unsupported original shape. Retain or edit Advanced contract.</p>';
 return '<div data-contract-editor>'+scalar+'<details><summary>Source labels and censoring choices</summary>'+LOAD_ARRAY_FIELDS.map(([k,l])=>contractList(contract,k,l)).join('')+'</details>'+
  '<h4>Original station and catchment support</h4>'+support+
  '<details><summary>Seasonal intervals ('+(Array.isArray(seasons)?seasons.length:'unavailable')+')</summary><p>Each interval lies inside the selected calculation period. Its end date is exclusive; intervals may intentionally overlap.</p>'+seasonal+'</details>'+
  '<details><summary>Explicit native annual comparison ('+(Array.isArray(mappings)?mappings.length:'unavailable')+')</summary><p>Preview to obtain original series choices. A mapping never converts nitrogen species, TSS to SSC, or incomplete periods into annual values. Original methods, chemical basis and fractions, complete calendar support, uncensored mass and explicit catchment evidence remain required by the existing engine.</p>'+native+'</details></div>';
}

export function mountFlowLoads(host,{api,request,studies=[],selectedStudy=null,initialState=null}={}){
 if(!(host instanceof Element)||typeof api!=='function'||typeof request!=='function')throw TypeError('Use the existing daily-flow API and host.');
 const controller=new AbortController(),signal=controller.signal;
 let sourceContractText='',parentStudy=null;
 let dead=false,busy=false,catalogue=[],studyId=selectedStudy||'',contractText='',result=null,resultId='',previewInput=null,current=false,view='series',seriesKey='',page=0;
 if(initialState){({studyId,contractText,result,resultId,previewInput,current,view,seriesKey,page}=clone(initialState));sourceContractText=initialState.sourceContractText||contractText;parentStudy=clone(initialState.parentStudy||null);}
 host.classList.add('mf-loads');
 host.innerHTML='<section class="mf-card"><h3>Concentration and discharge loads</h3><p>Use a saved flow study and an explicit support/interpolation contract. Original methods, fractions, censoring and station relationships remain separate.</p><p class="mf-status" role="status" aria-live="polite">Opening saved load results…</p><div class="mf-load-body"></div></section>';
 const status=host.querySelector('[role=status]'),body=host.querySelector('.mf-load-body');
 function message(s,error=false){if(dead)return;status.textContent=s;status.dataset.error=String(error);}
 function controls(){host.setAttribute('aria-busy',String(busy));for(const el of host.querySelectorAll('button,input,textarea,select'))el.disabled=busy||el.dataset.unavailable==='true';}
 async function task(fn){if(dead||busy)return;busy=true;controls();try{await fn();}catch(e){if(!dead&&e.name!=='AbortError')message(e.message,true);}finally{busy=false;if(!dead)controls();}}
 function capture(){const id=host.querySelector('[name=load-study]'),editor=host.querySelector('[name=load-contract]');if(id)studyId=id.value;if(editor)contractText=editor.value;}
 function dirty(){capture();current=false;const save=host.querySelector('[data-load-act=save]');if(save){save.dataset.unavailable='true';save.disabled=true;}message('The selected study or contract changed. Preview this exact combination before saving.');}
 async function catalogueRefresh(){const response=await api('/flow/load-catalogue');if(!dead)catalogue=response.rows;}

 function chosenParent(){return parentStudy?.id===studyId?parentStudy:null;}
 function formHTML(){try{return loadContractFormHTML(parse(contractText),{study:chosenParent(),series:result?.flow_study_id===studyId?result.integration.series:[]});}catch(e){return '<p class="mf-notice">'+esc(contractText?'The draft is not yet a complete readable contract. Its exact text remains below.':'Choose a saved study and start a draft, or load an original contract.')+'</p>';}}
 function renderContractForm(){const el=host.querySelector('.mf-contract-controls');if(el)el.innerHTML=formHTML();controls();}
 async function inspectParent(){capture();if(!studyId)throw Error('Choose an original saved Flow study first.');const requested=studyId;const value=await api('/flow/studies/'+encodeURIComponent(requested));if(dead)return;if(value.id!==requested)throw Error('The returned Flow study differs from the selected original.');parentStudy=value;renderContractForm();}
 function replaceContract(next,{original=false}={}){contractText=next;if(original)sourceContractText=next;current=false;const editor=host.querySelector('[name=load-contract]');if(editor)editor.value=next;}
 function formEdit(edit){
  capture();const value=editLoadContract(parse(contractText),edit,chosenParent());replaceContract(JSON.stringify(value,null,2)+'\n');dirty();
 }

 function editorHTML(){
  const choices=option('','Choose a saved flow study',studyId)+studies.map(s=>option(s.id,s.title+' · '+s.start+' – '+s.end,studyId)).join('');
  const missing=studyId&&!studies.some(s=>s.id===studyId)?option(studyId,'Retained parent '+studyId,studyId):'';
  return '<label>Original saved flow study<select name="load-study">'+choices+missing+'</select></label><div class="mf-actions"><button type="button" data-load-act="use-open" data-unavailable="'+String(!selectedStudy)+'">Use the open saved study</button><button type="button" data-load-act="original-contract">Load original context-only contract</button></div>'+
   '<p class="mf-muted">The retained example is '+esc(CONTRACT_PATH)+'. It explicitly declines matched support for the existing Eighteenmile concentration stations. Loading it does not change that evidence.</p>'+
   '<form data-load-form="contract"><label>Upload an explicit contract<input type="file" name="contract-file" accept=".json,application/json" required></label><button type="submit">Load contract file</button></form>'+
   '<div class="mf-actions"><button type="button" data-load-act="start-contract">Start a context-only draft from this study</button><button type="button" data-load-act="inspect-contract">Inspect original support / refresh controls</button></div>'+
   '<p class="mf-muted">Ordinary authoring uses the labeled controls below. Starting a draft preserves the saved study, derives only its original dates/relationships/references, and leaves interpolation and support admission for explicit review.</p><div class="mf-contract-controls">'+formHTML()+'</div>'+
   '<details class="mf-contract-advanced"><summary>Advanced contract and original source</summary><p>Every unedited field is retained. Editing a labeled control serializes the working draft; the loaded original text remains separately downloadable. Advanced text is never silently normalized while typing.</p><label>Complete support and interpolation contract<textarea name="load-contract" rows="12" spellcheck="false" placeholder="Load a contract or start one from the selected original study.">'+esc(contractText)+'</textarea></label><div class="mf-actions"><button type="button" data-load-act="inspect-contract">Apply advanced text to labeled controls</button><button type="button" data-load-act="original-text" data-unavailable="'+String(!sourceContractText)+'">Download loaded original contract</button></div></details>'+
   '<p class="mf-notice">The load contract end date is <strong>exclusive</strong>; the parent flow-study end date is inclusive. Keep the contract within the selected parent calendar. A new contract cannot promote downstream/regional flow to coincident catchment support.</p>'+
   '<div class="mf-actions"><button type="button" data-load-act="preview">Preview loads from this study</button><button type="button" data-load-act="draft-contract">Download draft contract</button></div>';
 }
 function savedHTML(){
  return '<details><summary>Saved load results ('+num(catalogue.length)+')</summary><div class="mf-actions"><button type="button" data-load-act="refresh">Refresh saved results</button></div>'+
   (catalogue.length?table(['Result / created','Original parent study','Series / context only','Open'],catalogue.map(r=>[
    '<strong>'+esc(r.title||'Saved load result')+'</strong><small>'+esc(r.created_at)+'</small>','<span class="mf-mono">'+esc(r.flow_study_id)+'</span>',num(r.counts?.series)+' / '+num(r.counts?.context_only_series),'<button type="button" data-load-act="open" data-id="'+esc(r.id)+'">Open result</button>'
   ]),'Saved original load results'):'<p class="mf-muted">No load calculation has been saved. Context-only results can be saved with the same original evidence.</p>')+'</details>';
 }
 function render(){if(dead)return;body.innerHTML=savedHTML()+editorHTML()+'<div class="mf-load-result"></div>';renderResult();controls();}
 function renderResult(){
  const target=host.querySelector('.mf-load-result');if(!result){target.innerHTML='';return;}
  const calc=result.integration,counts=calc.counts,annual=result.observationExports.annual_count;
  target.innerHTML='<hr><div class="mf-heading"><h4>'+ (resultId?'Saved load result':'Load preview')+'</h4><span class="mf-tag">'+(resultId?'Retained':'Not yet saved')+'</span></div>'+
   '<p class="mf-mono">Parent study '+esc(result.flow_study_id)+'<br>Contract SHA-256 '+esc(result.contract_sha256)+(resultId?'<br>Result '+esc(resultId):'')+'</p>'+
   facts([['Original samples',counts.source_samples],['Original flow rows',counts.source_flows],['Method/fraction series',counts.series],['Matched-support series',counts.support_admitted_series],['Context-only series',counts.context_only_series],['Admissible annual rows',annual]])+
   (counts.support_admitted_series===0?'<p class="mf-notice"><strong>These observations remain context only.</strong> No series has accepted coincident concentration and catchment-discharge support. There are no annual loads to compare with native exports. The original samples, station relationships and exclusion reasons remain available below.</p>':'<p class="mf-notice">Mass covers only quantified days. Missing periods are not annualized. Finite censoring bounds are not point estimates or confidence intervals. Flow-weighted concentrations use the same quantified-day mass and discharge volume; missing days enter neither term, and zero volume has no defined mean. Annual rows require complete calendar-year coverage and an explicit compatible species/fraction mapping.</p>')+
   '<div class="mf-actions"><button type="button" data-load-act="save" data-unavailable="'+String(!current||Boolean(resultId))+'">'+(resultId?'Result saved':'Save this preview')+'</button><button type="button" data-load-act="json">Complete load result JSON</button><button type="button" data-load-act="result-contract">Selected result contract</button><button type="button" data-load-act="parent">Parent study with full originals</button></div>'+
   '<div class="mf-actions">'+[['bundle','Complete original ZIP'],['report.html','Readable report HTML'],['periods.csv','Period masses CSV'],['daily.csv','Daily loads CSV'],['context.csv','Original context CSV'],['annual.csv','Admissible annual CSV']].map(([file,title])=>'<button type="button" data-load-act="download" data-file="'+file+'" data-unavailable="'+String(!resultId)+'">'+title+'</button>').join('')+'</div>'+
   (!resultId?'<p class="mf-muted">Save this exact result to download its server-rendered report and complete CSVs.</p>':'')+
   '<p class="mf-muted">For offline report links, keep the individual named files together or use the complete ZIP. Put each saved result in its own folder.</p><nav class="mf-tabs" aria-label="Load result views">'+[['series','Series and support'],['periods','Period masses and bounds'],['daily','Daily calculations'],['sources','Original sample context']].map(([id,title])=>'<button type="button" data-load-act="view" data-view="'+id+'" aria-current="'+String(view===id)+'">'+title+'</button>').join('')+'</nav><div class="mf-load-view"></div>';
  renderView();controls();
 }
 function quantityContext(series){const c=series.series_context;if(!c)return '';return '<small>Chemical basis: '+esc(c.chemical_basis||'Unspecified')+' · Normalized unit: '+esc(c.normalized_unit||'Unspecified')+' · Original speciation: '+esc(Array.isArray(c.source_speciation)?c.source_speciation.join('; '):c.source_speciation||'Unspecified')+'</small>';}
 function seriesSelection(){return '<label class="mf-row-filter">Original method/fraction series<select name="load-series">'+option('','All original series',seriesKey)+result.integration.series.map(s=>option(s.series_key,s.station_id+' · '+s.characteristic+' / '+s.sample_fraction+' / '+s.method_id,seriesKey)).join('')+'</select></label>';}
 function renderView(){
  if(!result)return;const target=host.querySelector('.mf-load-view'),calc=result.integration,chosen=calc.series.filter(s=>!seriesKey||s.series_key===seriesKey);
  if(view==='series'){
   target.innerHTML=table(['Original station / characteristic','Fraction / method','Samples: original / usable / censored','Gauge relationship','Support and status','Quantified / expected days','Point mass (kg)','Lower / upper mass (kg)','Quantified volume (m³)','Flow-weighted concentration: point / lower / upper (mg/L)'],calc.series.map(s=>{
    const p=s.periods[0];return[esc(s.station_id)+'<small>'+esc(s.characteristic)+'</small>'+quantityContext(s),esc(s.sample_fraction)+'<small>'+esc(s.method_context)+' / '+esc(s.method_id)+'</small>',[s.source_sample_count,s.usable_sample_count,s.censored_sample_count].map(num).join(' / '),esc(s.support.gauge_relation||'Unassigned'),esc(s.support.issues.join('; ')||s.status),p?num(p.quantified_days)+' / '+num(p.expected_days):'No matched support',num(p?.load_kg),num(p?.load_lower_kg)+' / '+num(p?.load_upper_kg),num(p?.quantified_flow_volume_m3),[p?.flow_weighted_concentration_mg_l,p?.flow_weighted_concentration_lower_mg_l,p?.flow_weighted_concentration_upper_mg_l].map(num).join(' / ')];
   }),'Original series, support and retained mass bounds')+
   '<details><summary>Original uncertainty and temporal approximation</summary><pre>'+esc(JSON.stringify({method:calc.method,uncertainty:calc.uncertainty,source_binding:result.source_binding},null,2))+'</pre></details>';return;
  }
  let rows=[];
  if(view==='periods')rows=chosen.flatMap(s=>[...s.periods.map(r=>({...r,series:s,kind:'Selected or seasonal period'})),...s.annual.map(r=>({...r,series:s,kind:'Calendar-year window'}))]);
  if(view==='daily')rows=chosen.flatMap(s=>s.daily.map(r=>({...r,series:s})));
  if(view==='sources')rows=calc.source_samples.filter(s=>!seriesKey||s.series_key===seriesKey);
  const size=50;page=Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1));const visible=rows.slice(page*size,(page+1)*size);
  let html=seriesSelection();
  if(!rows.length)html+='<p class="mf-notice">'+(view==='sources'?'No source samples match this selection.':'No quantified calculation rows exist for this series selection. Inspect the original support and exclusion reasons in Series and support; no missing load is represented as zero.')+'</p>';
  if(view==='periods'&&rows.length)html+=table(['Series / period','Dates (end exclusive)','Quantified / expected','Coverage complete / full calendar year','Point mass (kg)','Lower / upper mass (kg)','Censored / sampled / interpolated days','Quantified volume (m³)','Flow-weighted concentration: point / lower / upper (mg/L)','Inspect'],visible.map((r,i)=>[
   esc(r.series.station_id)+'<small>'+esc(r.series.characteristic)+' / '+esc(r.series.sample_fraction)+' / '+esc(r.series.method_id)+'</small>'+quantityContext(r.series)+esc(r.kind)+' · '+esc(r.label),esc(r.period_start)+' – '+esc(r.period_end),num(r.quantified_days)+' / '+num(r.expected_days),(r.coverage_complete?'Yes':'No')+' / '+(r.whole_calendar_year===undefined?'Not a calendar-year row':r.whole_calendar_year?'Yes':'No'),num(r.load_kg),num(r.load_lower_kg)+' / '+num(r.load_upper_kg),[r.censored_days,r.sampled_days,r.interpolated_days].map(num).join(' / '),num(r.quantified_flow_volume_m3),[r.flow_weighted_concentration_mg_l,r.flow_weighted_concentration_lower_mg_l,r.flow_weighted_concentration_upper_mg_l].map(num).join(' / ')+'<small>'+esc(r.flow_weighted_concentration_basis)+'</small>','<button type="button" data-load-act="row" data-index="'+i+'">Original row</button>'
  ]),'Period mass and censoring bounds');
  if(view==='daily'&&rows.length)html+=table(['Series / date','Concentration (mg/L)','Lower / upper (mg/L)','Daily Q (m³/s)','Point load (kg/day)','Lower / upper (kg/day)','Basis / exclusions','Inspect'],visible.map((r,i)=>[
   esc(r.series.station_id)+'<small>'+esc(r.series.characteristic)+' / '+esc(r.series.sample_fraction)+' / '+esc(r.series.method_id)+'</small>'+quantityContext(r.series)+esc(r.date),num(r.concentration_mg_l),num(r.concentration_lower_mg_l)+' / '+num(r.concentration_upper_mg_l),num(r.discharge_m3_s),num(r.load_kg),num(r.load_lower_kg)+' / '+num(r.load_upper_kg),esc(r.concentration_basis||'Unquantified')+'<small>'+esc(r.issues.join('; '))+'</small>','<button type="button" data-load-act="row" data-index="'+i+'">Original row</button>'
  ]),'Daily concentration/discharge calculations');
  if(view==='sources'&&rows.length)html+=table(['Original station / date','Characteristic / fraction','Original value / unit','Detection / limit','Method','Usable / reasons','Inspect'],visible.map((r,i)=>[
   esc(r.station_id)+'<small>'+esc(r.date)+'</small>',esc(r.characteristic)+'<small>'+esc(r.sample_fraction)+'</small>',esc(r.original.value)+' '+esc(r.original.unit),esc(r.original.detection_condition||'None reported')+'<small>'+esc(r.original.limit_value)+' '+esc(r.original.limit_unit)+'</small>',esc(r.method_context)+' / '+esc(r.method_id),esc(r.usable?'Accepted by concentration contract':'Not quantified')+'<small>'+esc(r.issues.join('; '))+'</small>','<button type="button" data-load-act="row" data-index="'+i+'">Original source</button>'
  ]),'Complete original concentration context');
  target.innerHTML=html+'<div class="mf-actions"><button type="button" data-load-act="previous" data-unavailable="'+String(!page)+'">Previous rows</button><span>'+num(rows.length?Math.min(rows.length,page*size+1):0)+'–'+num(Math.min(rows.length,(page+1)*size))+' of '+num(rows.length)+'</span><button type="button" data-load-act="next" data-unavailable="'+String((page+1)*size>=rows.length)+'">Next rows</button></div><div class="mf-load-detail"></div>';target._rows=visible;controls();
 }
 host.addEventListener('input',event=>{
  event.stopPropagation();
  if(event.target.name==='load-contract'){dirty();const panel=host.querySelector('.mf-contract-controls');if(panel)panel.innerHTML='<p class="mf-notice">Advanced draft text has changed. Apply it to labeled controls when ready; preview always uses this exact draft.</p>';return;}
  const el=event.target.closest('[data-contract-field]');if(!el||!host.contains(el))return;
  try{formEdit({section:el.dataset.contractSection,index:el.dataset.contractIndex===undefined?undefined:Number(el.dataset.contractIndex),field:el.dataset.contractField,action:'set',value:el.type==='checkbox'?el.checked:el.value});}
  catch(e){current=false;message(e.message,true);renderContractForm();const save=host.querySelector('[data-load-act=save]');if(save){save.disabled=true;save.dataset.unavailable='true';}}
 },{signal});
 host.addEventListener('change',event=>{event.stopPropagation();if(event.target.name==='load-study'){dirty();renderContractForm();}if(event.target.name==='load-series'){seriesKey=event.target.value;page=0;renderView();}},{signal});
 host.addEventListener('submit',event=>{
  const form=event.target.closest('[data-load-form]');if(!form)return;event.preventDefault();event.stopPropagation();const data=new FormData(form);
  task(async()=>{const original=await fileText(data.get('contract-file'));parse(original);capture();replaceContract(original,{original:true});render();message('Complete original contract loaded. Review its source support and exclusive period before previewing.');});
 },{signal});
 host.addEventListener('click',event=>{
  const cb=event.target.closest('button[data-contract-action]');
  if(cb&&host.contains(cb)){event.preventDefault();event.stopPropagation();task(async()=>{
   const section=cb.dataset.contractSection,index=cb.dataset.contractIndex===undefined?undefined:Number(cb.dataset.contractIndex),action=cb.dataset.contractAction;
   if(action==='context'){for(const field of ['accepted','location_match','catchment_match'])formEdit({section,index,field,action:'set',value:false});}
   else formEdit({section,index,action});renderContractForm();
  });return;}
  const b=event.target.closest('button[data-load-act]');if(!b||!host.contains(b))return;event.preventDefault();event.stopPropagation();
  task(async()=>{
   const act=b.dataset.loadAct;
   if(act==='original-contract'){capture();replaceContract(ORIGINAL_CONTRACT,{original:true});render();message('Original extended Eighteenmile contract loaded unchanged. It records regional context only; check its period against your selected parent.');}
   if(act==='inspect-contract'){capture();parse(contractText);await inspectParent();if(dead)return;message('Labeled controls now use this exact contract and the selected saved study. Existing source fields are unchanged.');}
   if(act==='start-contract'){await inspectParent();if(dead)return;replaceContract(JSON.stringify(loadContractFromStudy(parentStudy),null,2)+'\n',{original:true});render();message('Context-only draft derived from this original study. Set the interpolation gap and review source labels, censoring and scientific support before previewing.');}
   if(act==='original-text'){if(!sourceContractText)throw Error('No original contract text has been loaded.');download('original-flow-load-contract.json',sourceContractText);}
   if(act==='use-open'){if(!selectedStudy)throw Error('Open and save a flow study first.');capture();studyId=selectedStudy;current=false;render();message('Open saved study selected. The contract has not been changed.');}
   if(act==='draft-contract'){capture();parse(contractText);download('flow-load-contract-draft.json',contractText);}
   if(act==='refresh'){capture();await catalogueRefresh();render();message('Saved load results refreshed; the draft remains intact.');}
   if(act==='preview'){
    capture();if(!studyId)throw Error('Select an original saved flow study.');
    const input={study_id:studyId,contract:parse(contractText)};message('Reproducing original source binding and calculating coverage…');
    const value=await api('/flow/load-preview',{method:'POST',value:input});if(dead)return;
    result=value;resultId='';previewInput=clone(input);current=true;view='series';seriesKey='';page=0;renderResult();renderContractForm();
    message('Preview complete: '+num(value.integration.counts.context_only_series)+' context-only series, '+num(value.observationExports.annual_count)+' admissible annual rows. Review support, coverage and censoring before saving.');
   }
   if(act==='save'){
    if(!result||!previewInput||!current||resultId)throw Error('Preview the current original study and contract first.');
    const response=await api('/flow/load-save',{method:'POST',value:{...previewInput,expected_id:result.id}});if(dead)return;result=response.result;resultId=response.id;await catalogueRefresh();render();message(response.duplicate?'This exact load result is already retained.':'Saved original load result and immutable parent binding.');
   }
   if(act==='open'){
    const value=await api('/flow/load-results/'+encodeURIComponent(b.dataset.id));if(dead)return;result=value;resultId=b.dataset.id;studyId=value.flow_study_id;contractText=JSON.stringify(value.integration.contract,null,2);sourceContractText=contractText;parentStudy=null;previewInput={study_id:studyId,contract:clone(value.integration.contract)};current=true;view='series';seriesKey='';page=0;render();message('Opened the retained load result with its exact original contract and parent study.');
   }
   if(act==='json')download('flow-loads.json',result);
   if(act==='result-contract')download('contract.json',result.integration.contract);
   if(act==='parent'){const value=await api('/flow/studies/'+encodeURIComponent(result.flow_study_id));if(dead)return;download('flow-study.json',value);}
   if(act==='download'){
    if(!resultId)throw Error('Save the exact load preview first.');
    if(b.dataset.file==='bundle'){const value=await api('/flow/load-results/'+encodeURIComponent(resultId)+'/bundle');if(dead)return;await saveBundle(value);return;}
    const response=await request('/flow/load-results/'+encodeURIComponent(resultId)+'/'+b.dataset.file,'GET'),text=await response.text();
    if(!response.ok)throw Error(text);if(dead)return;download(({'report.html':'load-report.html','periods.csv':'period-loads.csv','daily.csv':'daily-loads.csv','context.csv':'concentration-context.csv','annual.csv':'annual-loads.csv'})[b.dataset.file],text,b.dataset.file.endsWith('.html')?'text/html;charset=utf-8':'text/csv;charset=utf-8');
   }
   if(act==='view'){view=b.dataset.view;seriesKey='';page=0;renderResult();}
   if(act==='previous'){page=Math.max(0,page-1);renderView();}
   if(act==='next'){page++;renderView();}
   if(act==='row'){const target=host.querySelector('.mf-load-view'),r=target._rows?.[Number(b.dataset.index)];const {series,...row}=r||{};target.querySelector('.mf-load-detail').innerHTML='<details open><summary>Complete original calculation/source row</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details>';}
  });
 },{signal});
 task(async()=>{await catalogueRefresh();if(dead)return;render();message('Choose a saved parent study and a complete explicit contract. Context-only results remain usable original records.');});
 return {snapshot(){capture();return clone({studyId,contractText,sourceContractText,parentStudy,result,resultId,previewInput,current,view,seriesKey,page});},destroy(){dead=true;controller.abort();host.replaceChildren();host.classList.remove('mf-loads');}};
}

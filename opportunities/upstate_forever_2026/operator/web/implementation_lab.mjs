/** Native laboratory intake. Original CSV, explicit mapping, one saved revision. */
import {clone,esc} from './implementation_core.mjs';
const SCHEMA='upstate.implementation-lab-mapping/v1';
const FIELDS=[
 ['activity_id','Activity ID'],['sample_id','Sample ID'],['site_id','Site ID'],['visit_id','Visit ID'],['observation_id','Result ID'],
 ['collected_at','Actual collection timestamp'],['parameter','Parameter'],['original_text','Original result text'],
 ['value','Numeric value'],['result_type','Result type'],['unit','Unit'],['basis','Chemical basis'],['fraction','Fraction'],
 ['qualifier','Qualifier'],['detection_limit','Detection limit'],['quantitation_limit','Quantitation limit'],
 ['method','Laboratory method'],['method_context','Method naming context'],['method_name','Full method name'],['qa_status','QA status'],['notes','Notes']
];
const CONSTANTS=new Set(['activity_id','sample_id','site_id','visit_id','parameter','result_type','unit','basis','fraction','qualifier','method','method_context','method_name','qa_status','notes']);
const TYPES=['numeric','censored','text','missing'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const button=(action,label,extra='')=>'<button type="button" data-impl="lab-'+action+'" '+extra+'>'+esc(label)+'</button>';
const label=(name,body,help='')=>'<label class="iw-field"><span>'+esc(name)+'</span>'+body+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const option=(value,text,selected)=>'<option value="'+esc(value)+'" '+(String(value)===String(selected)?'selected':'')+'>'+esc(text)+'</option>';
const options=(rows,selected)=>option('','— not mapped —',selected)+rows.map(name=>option(name,name,selected)).join('');
const input=(key,value,extra='')=>'<input data-lab-map="'+esc(key)+'" value="'+esc(value??'')+'" '+extra+'>';
const busy=s=>['uploading','inspecting','saving','previewing','importing'].includes(s?.stage);
function assertActive(w){
 if(!w.native||w.gone||w.host.getState?.()?.workspace_key!==w.workspace)throw Error('Open laboratory intake in its original native workspace.');
}
function assertEditable(w){
 assertActive(w);if(w.pending||busy(w.labIntake))throw Error('Finish the retained laboratory or plan operation first.');
}
function current(w,s,turn){return !w.gone&&w.labIntake===s&&w.generation===turn&&w.plan?.id===s.plan_id&&w.host.getState?.()?.workspace_key===w.workspace;}
function touch(w,s){s.preview=null;s.operation_id=null;s.stage='mapping';s.issue_page=0;w.cache();}
function download(name,body,type='application/json'){
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([body],{type}));a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function newMapping(headers,delimiter=',',encoding='utf-8-sig'){
 const columns={};for(const [key] of FIELDS)if(headers.includes(key))columns[key]=key;
 return {schema:SCHEMA,delimiter,encoding,columns,constants:{},result_type_values:{},fallback_columns:{},decimal_separator:'.',fill_missing_collection_times:false,row_actions:{}};
}
function mapping(w){
 const s=w.labIntake,m=clone(s.mapping);
 if(s.mapping_error)throw Error(s.mapping_error);
 for(const key of ['result_type_values','fallback_columns','row_actions']){
  const raw=s.advanced?.[key];
  if(raw!==undefined){let value;try{value=JSON.parse(raw||'{}');}catch{throw Error(key+' must be a JSON object.');}
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error(key+' must be a JSON object.');m[key]=value;
  }
 }
 return m;
}
export function canApply(w){
 const s=w.labIntake,p=s?.preview;
 return !!p?.can_import&&!w.pending&&!w.dirty&&!!w.nativePlan&&same(w.plan,w.nativePlan)&&
 p.workspace_key===w.workspace&&p.plan_id===w.plan.id&&p.revision===w.plan.revision&&
 p.upload_id===s.upload?.id&&!!p.document_digest&&!!p.operation_id;
}
export function render(w){
 const s=w.labIntake,disabled=busy(s)?'disabled':'';
 if(!s)return '<section class="iw-notice"><h3>Laboratory CSV results</h3><p>Map an original laboratory file to this plan’s existing samples and activities, review every conflict, then save the selected results together with the source file.</p>'+button('open','Import laboratory CSV')+'</section>';
 const source=s.upload;
 const sourcePanel='<p>Plan '+esc(w.plan.id)+' · '+(source?esc(source.filename)+' · '+esc(source.bytes)+' bytes':'Choose the original laboratory CSV.')+'</p>'+
 '<div class="iw-actions"><input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" data-lab-file '+disabled+' aria-label="Original laboratory CSV">'+button('close','Close intake',disabled)+'</div>'+
 (source?'<details><summary>Original file identity</summary><p>'+esc(source.sha256)+'</p></details>':'');
 const format='<div class="iw-two">'+label('Delimiter','<select data-lab-format="delimiter" '+disabled+'>'+[[',','Comma'],['\t','Tab'],[';','Semicolon'],['|','Pipe']].map(([a,b])=>option(a,b,s.mapping.delimiter)).join('')+'</select>')+
 label('Encoding','<select data-lab-format="encoding" '+disabled+'>'+['utf-8-sig','utf-8','utf-16','cp1252','latin-1'].map(x=>option(x,x,s.mapping.encoding)).join('')+'</select>')+'</div>'+
 (source?button('inspect','Read original headers again',disabled):'');
 if(!s.inspection)return '<section class="iw-notice" aria-label="Laboratory CSV intake"><h3>Import laboratory results</h3>'+sourcePanel+format+(busy(s)?'<p role="status">'+esc(s.stage)+' original file…</p>':'')+'</section>';
 const headers=s.inspection.headers||[],m=s.mapping;
 const rows=FIELDS.map(([key,title])=>'<tr><th scope="row">'+esc(title)+'</th><td><select data-lab-map="columns.'+key+'" '+disabled+'>'+options(headers,m.columns?.[key])+'</select></td><td>'+
 (CONSTANTS.has(key)?(key==='result_type'?'<select data-lab-map="constants.result_type" '+disabled+'>'+options(TYPES,m.constants?.result_type)+'</select>':input('constants.'+key,m.constants?.[key],disabled)):'<span class="iw-muted">Original column only</span>')+'</td></tr>').join('');
 const samples=s.inspection.sample_rows||[];
 const sampleTable=w.table(['Record / original lines',...headers],samples.map(row=>[esc(row.record)+' / '+esc(row.line_start)+'–'+esc(row.line_end),...headers.map(h=>esc(row.values?.[h]??''))]));
 const advanced=['result_type_values','fallback_columns','row_actions'].map(key=>label(key,'<textarea data-lab-json="'+key+'" rows="5" '+disabled+'>'+esc(s.advanced?.[key]??JSON.stringify(m[key]||{},null,2))+'</textarea>')).join('');
 const mappingPanel='<h4>Map source columns explicitly</h4><p>Choose Activity ID, or Sample ID with any needed Site/Visit selectors. Original result text must come from a source column. Set result type explicitly; numeric, censored, text and missing stay distinct. A constant is used only when its corresponding column is not mapped. Map method naming context and full name only from the actual laboratory definition; requested_ columns describe the request and must not be used as returned values.</p><div class="iw-table-wrap"><table><thead><tr><th>Plan field</th><th>Original CSV column</th><th>Explicit constant</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
 '<div class="iw-two">'+label('Decimal separator','<select data-lab-map="decimal_separator" '+disabled+'>'+option('.','Period (.)',m.decimal_separator)+option(',','Comma (,)',m.decimal_separator)+'</select>')+
 '<label><input type="checkbox" data-lab-map="fill_missing_collection_times" '+(m.fill_missing_collection_times?'checked':'')+' '+disabled+'> Fill an empty activity collection time from a complete source timestamp with timezone</label></div>'+
 '<p>Date-only source text stays in the original CSV. Existing collection times are checked, never silently replaced.</p>'+
 '<details><summary>Original source preview ('+esc(s.inspection.row_count)+' data records; first '+samples.length+' shown)</summary>'+sampleTable+'</details>'+
 '<details><summary>Result-type aliases, original-text/unit fallback columns and record decisions</summary><p>Result-type aliases map original labels to numeric, censored, text or missing. Ordered fallback_columns use an explicitly selected source field only when its primary cell is blank, for example {"original_text":["ResultDetectionConditionText"]}. Record decisions use one-based data-record numbers, not physical line numbers.</p>'+advanced+'</details>'+
 '<div class="iw-actions">'+button('preview',w.dirty||!w.nativePlan?'Save plan and preview laboratory results':'Preview laboratory results',disabled)+button('export-mapping','Export mapping JSON',disabled)+
 '<label>Open mapping JSON <input type="file" accept=".json,application/json" data-lab-mapping-file '+disabled+'></label></div>';
 return '<section class="iw-notice" aria-label="Laboratory CSV intake"><h3>Import laboratory results</h3>'+sourcePanel+format+mappingPanel+(busy(s)?'<p role="status">'+esc(s.stage==='saving'?'Saving the current plan before the source review.':s.stage==='importing'?'The original laboratory import task is retained.':s.stage+' the original laboratory file…')+'</p>':'')+previewPanel(w)+receiptPanel(w)+'</section>';
}
function receiptPanel(w){
 const r=w.labIntake?.result;if(!r)return '';
 return '<section><h4>Laboratory source saved at revision '+esc(r.applied_revision)+'</h4><p>'+esc(r.summary?.append_count??0)+' appended · '+esc(r.summary?.replace_count??0)+' replaced · '+esc(r.summary?.identical_count??0)+' identical · '+esc(r.summary?.skip_count??0)+' explicitly skipped. Original source '+esc(r.source?.filename||'')+' remains with the plan. Latest native revision: '+esc(w.nativePlan?.revision??r.current_revision)+'.</p><p>Use the field-observation review below to register a saved revision in Observed water quality, or Handover to prepare the client-readable implementation report.</p><details><summary>Original import and source record</summary><pre class="iw-json">'+esc(JSON.stringify(r,null,2))+'</pre></details></section>';
}
function previewPanel(w){
 const s=w.labIntake,p=s?.preview;if(!p)return '';
 const summary=p.summary||{},rows=p.rows||[],all=p.issues||[];
 const filtered=all.filter(x=>!s.issue_filter||x.severity===s.issue_filter),page=Math.max(0,Math.min(s.issue_page||0,Math.max(0,Math.ceil(filtered.length/50)-1))),shown=filtered.slice(page*50,(page+1)*50);
 const issues=w.table(['Record / lines','Severity','Issue','Original candidate matches'],shown.map(x=>[esc(x.record??'')+' / '+esc(x.line_start??'')+'–'+esc(x.line_end??''),esc(x.severity),esc(x.message),esc(typeof x.candidates==='object'?JSON.stringify(x.candidates):x.candidates||'')]),'No issues in this selection.');
 const decisions=w.table(['Record / lines','Decision','Sample and result','Parameter and type','Original result','Declared method'],rows.map(x=>[esc(x.record)+' / '+esc(x.line_start)+'–'+esc(x.line_end),esc(x.status||x.action),'Activity: '+esc(x.activity_id||'')+'<br>Result: '+esc(x.observation_id||''),esc(x.parameter||'')+'<br>Type: '+esc(x.result_type||''),'Original: '+esc(x.original_text??'')+'<br>Value: '+esc(x.value??'')+'<br>Unit: '+esc(x.unit||''),esc(x.method_definition?Object.entries(x.method_definition).map(([key,value])=>key+': '+value).join(' · '):'')]));
 const resolver='<details><summary>Resolve a specific original data record</summary><p>Choose an explicit activity for an ambiguous record, identify the existing observation to replace, or skip a record with a reason. Re-preview after every decision.</p><div class="iw-two">'+label('Data record number','<input type="number" min="1" step="1" data-lab-resolution="record">')+
 label('Decision','<select data-lab-resolution="action">'+['import','replace','skip'].map(x=>option(x,x,'import')).join('')+'</select>')+
 label('Existing activity','<select data-lab-resolution="activity_id">'+option('','—','')+w.plan.activities.map(a=>option(a.id,a.id+' · '+(a.sample_id||a.kind),'')).join('')+'</select>')+
 label('Existing observation','<select data-lab-resolution="observation_id">'+option('','—','')+w.plan.observations.map(o=>option(o.id,o.id+' · '+o.parameter+' · '+o.original_text,'')).join('')+'</select>')+
 label('Reason','<input data-lab-resolution="reason">')+'</div>'+button('resolve','Apply record decision')+button('unresolve','Remove this record decision')+'</details>';
 return '<section><h4>Review saved revision '+esc(p.revision)+'</h4><p>'+Object.entries(summary).map(([k,v])=>esc(k.replace(/_/g,' '))+': '+esc(v)).join(' · ')+'</p><p>'+esc(rows.length)+' decisions shown'+(p.rows_truncated?' of '+summary.row_count+'; all conflicts are listed below.':'.')+'</p>'+
 '<div class="iw-actions">'+button('apply','Import reviewed results in one native revision',canApply(w)?'':'disabled')+button('export-preview','Export full preview JSON')+'</div>'+decisions+'<h4>All source issues ('+all.length+')</h4>'+label('Filter issues','<select data-lab-issue-filter>'+option('','All',s.issue_filter)+option('error','Errors',s.issue_filter)+option('warning','Warnings',s.issue_filter)+'</select>')+issues+
 '<div class="iw-actions">'+button('issues-prev','Previous 50',page===0?'disabled':'')+'<span>Page '+(page+1)+' of '+Math.max(1,Math.ceil(filtered.length/50))+'</span>'+button('issues-next','Next 50',(page+1)*50>=filtered.length?'disabled':'')+'</div>'+resolver+'</section>';
}
async function post(w,operation,payload){
 return w.host.api('/api/implementation/'+operation,{method:'POST',body:{workspace:w.workspace,...payload}});
}
export async function inspect(w){
 assertEditable(w);const s=w.labIntake;if(!s?.upload)throw Error('Choose an original CSV first.');
 const turn=w.generation;s.stage='inspecting';s.preview=null;s.inspection=null;w.cache();w.render();
 try{
  const r=await post(w,'lab-inspect',{upload_id:s.upload.id,delimiter:s.mapping.delimiter,encoding:s.mapping.encoding});
  if(!current(w,s,turn))return;
  if(r.workspace_key!==w.workspace||r.upload_id!==s.upload.id||!Array.isArray(r.headers)||r.source?.sha256!==s.upload.sha256||r.source?.bytes!==s.upload.bytes)throw Error('The inspected file differs from its original upload.');
  s.inspection=r;s.stage='mapping';
  if(!s.mappingChosen)s.mapping=newMapping(r.headers,s.mapping.delimiter,s.mapping.encoding);
  s.mappingChosen=true;s.error='';w.cache();w.render();
 }catch(e){if(current(w,s,turn)){s.stage='mapping';w.cache();}throw e;}
}
export async function preview(w){
 assertEditable(w);const s=w.labIntake;if(!s?.upload||!s.inspection)throw Error('Read the original file headers first.');
 s.mapping=mapping(w);s.advanced={};s.preview=null;s.operation_id=null;
 if(w.dirty||!w.nativePlan){
  s.stage='saving';s.plan_id=w.plan.id;w.cache();
  try{await w.queue(w.importedFile?'implementation.plan.import':w.nativePlan?'implementation.plan.save':'implementation.plan.create',{document:w.plan,expected_revision:w.plan.revision});}
  catch(e){if(!w.pending){s.stage='mapping';w.cache();}throw e;}return;
 }
 const turn=w.generation,plan=clone(w.plan);s.stage='previewing';w.cache();w.render();
 try{
  const r=await post(w,'lab-preview',{upload_id:s.upload.id,plan_id:plan.id,revision:plan.revision,mapping:s.mapping});
  if(!current(w,s,turn))return;
  if(w.dirty||!same(w.plan,plan))throw Error('Plan records changed during preview. Save and review their actual revision.');
  if(r.schema!=='upstate.implementation-lab-preview/v1'||r.workspace_key!==w.workspace||r.plan_id!==plan.id||r.revision!==plan.revision||r.plan?.id!==plan.id||r.plan?.revision!==plan.revision||r.upload_id!==s.upload.id||r.source?.sha256!==s.upload.sha256||!r.document_digest||!r.operation_id)throw Error('The laboratory preview differs from the selected source and saved plan.');
  s.preview=r;s.stage='review';s.issue_page=0;w.cache();w.render();
 }catch(e){if(current(w,s,turn)){s.stage='mapping';s.preview=null;w.cache();}throw e;}
}
export async function apply(w){
 assertEditable(w);if(!canApply(w))throw Error('Save and preview this exact file, mapping and plan revision before importing.');
 const s=w.labIntake,p=s.preview;s.stage='importing';s.operation_id=null;w.cache();
 try{await w.queue('implementation.lab.import',{upload_id:s.upload.id,plan_id:p.plan_id,revision:p.revision,document_digest:p.document_digest,mapping:p.mapping,lab_operation_id:p.operation_id});}
 catch(e){if(!w.pending&&!s.operation_id){s.stage='review';w.cache();}throw e;}
}
export function validateReceipt(w,pending,result){
 const s=w.labIntake;
 if(!s||result?.schema!=='upstate.implementation-lab-import/v1'||result.workspace_key!==w.workspace||result.plan_id!==pending.plan_id||result.plan?.id!==pending.plan_id||result.operation_id!==pending.payload.lab_operation_id||result.base_revision!==pending.payload.revision||result.base_document_digest!==pending.payload.document_digest||result.source?.sha256!==s.upload?.sha256||!Number.isSafeInteger(result.applied_revision))throw Error('The native laboratory receipt differs from the retained original operation.');
}
export async function finish(w,pending,result){
 const s=w.labIntake;if(!s||s.operation_id!==pending.operation_id||s.plan_id!==pending.plan_id)return;
 if(pending.action==='implementation.lab.import'){
  validateReceipt(w,pending,result);
  s.result=clone(result);s.stage='complete';s.operation_id=null;s.preview=null;w.message='Laboratory results and the original source were saved together at revision '+result.applied_revision+'.'+(w.dirty?' Later browser edits remain in this draft.':'');w.cache();w.render();return;
 }
 if(s.stage==='saving'){
  s.operation_id=null;s.stage='mapping';w.cache();
  if(w.dirty){w.message='The plan was saved. Later browser changes are retained; save and review those changes before importing the laboratory file.';w.render();return;}
  await preview(w);
 }
}
export async function act(w,b){
 const action=b.dataset.impl.slice(4);
 if(action==='open'){assertEditable(w);if(!w.labIntake)w.labIntake={plan_id:w.plan.id,stage:'mapping',mapping:newMapping([]),advanced:{},issue_page:0};w.tab='field';w.cache();w.render();return;}
 if(action==='close'){assertEditable(w);w.labIntake=null;w.cache();w.render();return;}
 if(action==='inspect')return inspect(w);
 if(action==='preview')return preview(w);
 if(action==='apply')return apply(w);
 if(action==='export-preview'){const p=w.labIntake?.preview;if(!p)throw Error('Preview the original file first.');download(w.plan.id+'-lab-preview.json',JSON.stringify(p,null,2)+'\n');return;}
 if(action==='export-mapping'){download(w.plan.id+'-lab-mapping.json',JSON.stringify(mapping(w),null,2)+'\n');return;}
 const s=w.labIntake;if(!s)return;
 if(action==='issues-prev'||action==='issues-next'){s.issue_page=Math.max(0,(s.issue_page||0)+(action==='issues-prev'?-1:1));w.render();return;}
 if(action==='resolve'||action==='unresolve'){
  assertEditable(w);const get=k=>w.root.querySelector('[data-lab-resolution="'+k+'"]')?.value||'',record=Number(get('record'));
  if(!Number.isSafeInteger(record)||record<1||record>s.inspection.row_count)throw Error('Choose an original one-based data record number.');
  const m=mapping(w);
  if(action==='unresolve')delete m.row_actions[String(record)];
  else{const a=get('action'),reason=get('reason').trim();if(!reason)throw Error('Record a reason for this source-row decision.');
   const row={action:a,reason};if(a==='import'){row.activity_id=get('activity_id');if(!row.activity_id)throw Error('Choose an existing activity.');}
   if(a==='replace'){if(get('activity_id'))row.activity_id=get('activity_id');row.observation_id=get('observation_id');if(!row.observation_id)throw Error('Choose the original observation to replace.');}
   m.row_actions[String(record)]=row;
  }
  s.mapping=m;s.advanced={};touch(w,s);w.render();return;
 }
}
export async function change(w,e){
 const t=e.target,s=w.labIntake;if(!s)return;
 if(t.matches('[data-lab-file]')){
  assertEditable(w);const file=t.files?.[0];if(!file)return;
  const limit=w.host.getState?.()?.limits?.upload_bytes;if(limit&&file.size>limit)throw Error('The original file exceeds this operator’s upload size.');
  const turn=w.generation;s.stage='uploading';s.preview=null;s.inspection=null;s.upload=null;s.mappingChosen=false;s.mapping=newMapping([],s.mapping.delimiter,s.mapping.encoding);s.advanced={};s.result=null;w.cache();w.render();
  try{
   const r=await w.host.api('/api/upload',{method:'POST',raw:file,filename:file.name});
   if(!current(w,s,turn))return;
   if(!r?.id||!r.sha256||r.bytes!==file.size)throw Error('The original upload did not return its complete file identity.');
   s.upload=r;s.stage='mapping';w.cache();await inspect(w);
  }catch(error){if(current(w,s,turn)){s.stage='mapping';w.cache();}throw error;}return;
 }
 if(t.matches('[data-lab-mapping-file]')){
  assertEditable(w);const file=t.files?.[0];if(!file)return;
  s.preview=null;s.operation_id=null;s.stage='mapping';w.cache();w.render();
  if(file.size>2*1024*1024)throw Error('Use a mapping JSON smaller than 2 MiB.');
  const turn=w.generation,value=JSON.parse(await file.text());if(!current(w,s,turn))return;
  if(value.schema!==SCHEMA||!value.columns||typeof value.columns!=='object'||Array.isArray(value.columns))throw Error('Choose an original laboratory mapping JSON.');
  s.mapping=value;s.advanced={};s.mappingChosen=true;s.mapping_error=null;s.inspection=null;touch(w,s);w.render();if(s.upload)await inspect(w);return;
 }
 if(t.hasAttribute('data-lab-issue-filter')){s.issue_filter=t.value;s.issue_page=0;w.render();return;}
 assertEditable(w);
 if(t.dataset.labFormat){
  s.mapping[t.dataset.labFormat]=t.value;s.inspection=null;touch(w,s);w.render();return;
 }
 if(t.dataset.labJson){s.advanced=s.advanced||{};s.advanced[t.dataset.labJson]=t.value;touch(w,s);w.render();return;}
 if(t.dataset.labMap){
  s.mapping=mapping(w);s.advanced={};
  const key=t.dataset.labMap,parts=key.split('.'),v=t.type==='checkbox'?t.checked:t.value;
  if(parts.length===2){s.mapping[parts[0]]=s.mapping[parts[0]]||{};if(v==='')delete s.mapping[parts[0]][parts[1]];else s.mapping[parts[0]][parts[1]]=v;
   if(parts[0]==='columns'&&v)delete s.mapping.constants?.[parts[1]];
   if(parts[0]==='constants'&&v){delete s.mapping.columns?.[parts[1]];delete s.mapping.fallback_columns?.[parts[1]];}
  }else s.mapping[key]=v;
  touch(w,s);
  // Change fires after committing a control edit; immediately remove stale preview controls.
  w.render();
 }
}

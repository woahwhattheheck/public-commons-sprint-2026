// MIT. Flowable whole-source commissioning in the original SF47 Source Desk.
import {Sha256,sha256File} from './operations_installation_source_hash.mjs';
import {staffRequest,assertStaffRequestActor,currentStaffContext} from './staff-session.mjs';
import {parseExactMappingJSON,nativeJSONCanonical} from './operations_installation_mapping_reconciliation.mjs';

export const FLOWABLE_SOURCE_WORKING='stellar-forge.flowable-source-desk-working.v1';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>structuredClone(x);
const pretty=x=>JSON.stringify(x,null,2)+'\n';
const same=(a,b)=>nativeJSONCanonical(a)===nativeJSONCanonical(b);
const hash=x=>new Sha256().update(typeof x==='string'?new TextEncoder().encode(x):x).hex();
const LIMITS={archive:256*1024*1024,seed:2*1024*1024,bindings:2*1024*1024,commissioning:8*1024*1024,attachment:256*1024*1024};
const TEXT_KEYS=['seedText','commissioningText','bindingsText','programmeChoice','openRequestId','workshareId','attachmentName','attachmentPurpose'];
const blank=()=>({schema:FLOWABLE_SOURCE_WORKING,seedText:'',commissioningText:'',bindingsText:'',
 programmeChoice:'',openRequestId:'',workshareId:'',attachmentName:'',attachmentPurpose:'',
 archive:null,seed:null,commissioning:null,bindings:null,attachments:[],catalogue:null,inspection:null,
 template:null,prepared:null,preview:null,previewBasis:null,pending:null,requests:[],history:[],nextOffset:0,
 nativeWorkshares:null,nativeSelection:null,bindingRaw:{},dirty:false,receivedDraftKey:null});
function descriptor(x){
 return record(x)&&HEX.test(x.fileId??'')&&HEX.test(x.sha256??'')&&Number.isSafeInteger(x.bytes)&&x.bytes>=0&&
 typeof x.name==='string'&&typeof x.kind==='string';
}
function object(text,label){
 let value;try{value=parseExactMappingJSON(text).value;}catch(error){throw new Error(label+': '+error.message);}
 if(!record(value))throw new Error(label+' must be a complete JSON object.');return value;
}
function checkRequest(x){
 if(!record(x)||!UUID.test(x.requestId??'')||!['import','catalogue','inspect','template','prepare'].includes(x.method)||
  !record(x.args)||x.args.requestId!==x.requestId||x.sha256!==hash(nativeJSONCanonical({method:x.method,args:x.args})))
  throw new Error('Keep the complete original Flowable request and its unchanged identity.');
 return x;
}
export function validateFlowableSourceWork(value){
 if(value===null||value===undefined)return null;
 if(!record(value)||value.schema!==FLOWABLE_SOURCE_WORKING)throw new Error('Keep the complete Flowable Source Desk working format.');
 for(const key of TEXT_KEYS)if(typeof value[key]!=='string')throw new Error('Keep every original Flowable input, including unfinished JSON.');
 for(const key of ['archive','seed','commissioning','bindings'])if(value[key]!==null&&!descriptor(value[key]))throw new Error('Keep the selected complete '+key+' file identity.');
 if(!Array.isArray(value.attachments)||!Array.isArray(value.requests)||!Array.isArray(value.history))
  throw new Error('Keep all original Flowable attachments and requests.');
 for(const a of value.attachments)if(!descriptor(a.file)||typeof a.name!=='string'||typeof a.purpose!=='string')throw new Error('Keep complete additional source names and purposes.');
 if(!record(value.bindingRaw??{})||Object.values(value.bindingRaw??{}).some(x=>typeof x!=='string'))throw new Error('Keep complete unfinished guided binding fields.');
 for(const x of value.requests)checkRequest(x);
 if(value.pending)checkRequest(value.pending);
 for(const key of ['catalogue','inspection','template','prepared','preview','nativeWorkshares','nativeSelection'])if(value[key]!==null&&!record(value[key]))throw new Error('Keep the complete '+key+' source view.');
 return value;
}

/** All state belongs to the original Source Desk journal, case and Installation editor. */
export function createFlowableSourceDesk(ctx){
 if(!document.querySelector('link[data-flowable-source-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_flowable_sources.css';link.dataset.flowableSourceStyle='true';document.head.append(link);}
 const {esc,header,table,hint,empty,download}=ctx,controllers=new Set(),selected=new Map();
 let uploadProgress='',disposed=false;
 const prefix='/api/operations/'+encodeURIComponent(ctx.caseId)+'/flowable-sources';
 const w=()=>ctx.state().flowableWork??(ctx.state().flowableWork=blank());
 function assertLive(owner){ctx.checkContext();if(disposed||ctx.state().flowableWork!==owner)throw Object.assign(new Error('This original Flowable working copy is no longer active. Reopen its saved request; no other working copy was changed.'),{code:'FLOWABLE_WORKING_COPY_CHANGED'});}
 const editable=()=>ctx.editing()&&!w().pending;
 const needEdit=()=>{ctx.requireEdit();if(w().pending)throw new Error('Read or retry the complete original Flowable request before selecting new work.');};
 const button=(label,action,extra='',disabled=false)=>'<button type="button" data-source-action="flowable-'+action+'" '+extra+(disabled?' disabled data-source-fixed="true"':'')+'>'+esc(label)+'</button>';
 const field=(label,key,value='',options={})=>{
  const attr=' data-flowable-field="'+esc(key)+'" data-source-edit';
  let input;
  if(options.choices)input='<select'+attr+'>'+options.choices.map(([v,t])=>'<option value="'+esc(v)+'"'+(String(value)===String(v)?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select>';
  else if(options.area)input='<textarea'+attr+' rows="'+(options.rows||6)+'" spellcheck="false">'+esc(value)+'</textarea>';
  else input='<input'+attr+' value="'+esc(value)+'">';
  return '<label class="'+(options.wide?'source-desk-wide':'')+'"><span>'+esc(label)+'</span>'+input+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
 };
 const detail=(title,value)=>'<details><summary>'+esc(title)+'</summary><pre>'+esc(pretty(value))+'</pre></details>';
 function touch(){w().dirty=true;ctx.changed();}
 function invalidate(){w().prepared=null;w().preview=null;w().previewBasis=null;w().receivedDraftKey=null;touch();}
 function clearFrom(kind){
  if(kind==='archive'){w().catalogue=null;w().programmeChoice='';w().inspection=null;}
  if(kind==='archive'||kind==='inspection'||kind==='seed'||kind==='commissioning')w().template=null;
  invalidate();
 }
 function activeSource(){return w().inspection?.source??null;}
 function programmeRows(){const rows=w().catalogue?.programmes??[],p=activeSource()?.programme;if(p&&!rows.some(x=>x.record.id===p.record.id&&x.record.revision===p.record.revision))return [...rows,{record:p.record,programmeSha256:p.programmeSha256,basisSha256:p.basisSha256,key:p.programmeKey,state:p.progress.state,total:p.progress.total,confirmed:p.progress.confirmed}];return rows;}
 function selectedProgramme(){return programmeRows().find(x=>x.record.id+'@'+x.record.revision===w().programmeChoice);}
 function requestArgs(method,args){
  return {method,args:{requestId:crypto.randomUUID(),...clone(args)}};
 }
 async function savePending(method,args){
  needEdit();const r=requestArgs(method,args),entry={...r,requestId:r.args.requestId,status:'PREPARED',sha256:hash(nativeJSONCanonical(r)),error:null,result:null};
  w().pending=entry;w().requests.push(entry);ctx.changed();await ctx.persistNow();return entry;
 }
 function currentRequest(original,owner=w()){
  assertLive(owner);const current=owner.requests.find(x=>x.requestId===original.requestId);
  if(!current||!same(current.args,original.args)||current.sha256!==original.sha256)throw new Error('The original Flowable request changed while it was running.');
  return current;
 }
 async function retainedText(file,owner=w()){
  if(!descriptor(file)||file.bytes>16*1024*1024)throw new Error('Keep the complete selected JSON input within its original capacity.');
  const controller=new AbortController();controllers.add(controller);
  try{
   const response=await ctx.api(prefix+'/files/'+file.fileId,undefined,{download:true,signal:controller.signal});
   const raw=new Uint8Array(await response.arrayBuffer());assertLive(owner);
   if(raw.length!==file.bytes||hash(raw)!==file.sha256)throw new Error('The retained input changed: '+file.name);
   return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
  }finally{controllers.delete(controller);}
 }
 async function hydratePrepared(result,original,owner){
  const names={seed:'source/seed.json',bindings:'source/bindings.json',commissioning:'source/commissioning.json'};
  const inputs=Object.entries(names).map(([kind,name])=>{
   const file=result.files.find(f=>f.name===name&&f.kind===kind);
   if(!file)throw new Error('The complete saved preparation omits '+name+'.');return {kind,file};
  });
  const texts=await Promise.all(inputs.map(async x=>({...x,text:await retainedText(x.file,owner)})));
  assertLive(owner);const state=owner;
  for(const x of texts){state[x.kind]=clone(x.file);state[x.kind+'Text']=x.text;}
  const archive=result.files.find(f=>f.kind==='archive'&&f.name==='source/flowable-workspace.ndjson');
  if(!archive||!result.source?.programme||!result.installation?.document)throw new Error('The saved preparation omits the complete original workspace or programme.');
  state.archive=clone(archive);state.inspection={requestId:original.args.inspectionId,source:clone(result.source),files:[]};
  state.programmeChoice=result.source.programme.record.id+'@'+result.source.programme.record.revision;
  state.template={bindings:object(state.bindingsText,'Complete original bindings'),restoredFrom:result.requestId};
  state.bindingRaw={};
  state.attachments=(original.args.attachments??[]).map(a=>{
   const file=result.files.find(f=>f.fileId===a.fileId)??result.files.find(f=>f.kind==='attachment'&&f.name==='attachments/'+a.name);
   if(!file)throw new Error('The saved preparation omits an original additional file.');return {file:clone(file),name:a.name,purpose:a.purpose};
  });
 }
 async function adopt(original,result,owner=w()){
  assertLive(owner);const current=currentRequest(original,owner);
  if(!record(result)||result.requestId!==original.requestId||result.type!==original.method)throw new Error('The response differs from its original Flowable request.');
  if(result.status==='PENDING'){current.status='PENDING';current.result=clone(result);w().pending=current;ctx.changed();await ctx.persistNow();return result;}
  if(!Array.isArray(result.files))throw new Error('The complete Flowable result is missing its file inventory.');
  for(const file of result.files)if(!descriptor(file))throw new Error('A complete result file lost its retained identity.');
  current.status='COMPLETE';current.result={requestId:result.requestId,type:result.type,status:'COMPLETE',files:clone(result.files),preparationSha256:result.preparationSha256??null};current.error=null;
  if(w().pending?.requestId===current.requestId)w().pending=null;
  const state=owner;
  if(original.method==='import'){
   const f=result.files.find(x=>x.kind===original.args.kind&&x.sha256===original.args.sha256&&x.bytes===original.args.bytes);
   if(!f)throw new Error('The complete uploaded file differs from its retained result.');
   if(f.kind==='attachment'){
    if(!state.attachments.some(x=>x.file.fileId===f.fileId&&x.name===original.args.name))
     state.attachments.push({file:clone(f),name:original.args.name,purpose:original.purpose??''});
   }else {state[f.kind]=clone(f);clearFrom(f.kind);}
  }else if(original.method==='catalogue'){state.catalogue=clone(result);state.programmeChoice='';state.inspection=null;clearFrom('inspection');}
  else if(original.method==='inspect'){state.inspection=clone(result);state.archive=clone(result.files.find(f=>f.kind==='archive')??state.archive);state.programmeChoice=result.source.programme.record.id+'@'+result.source.programme.record.revision;clearFrom('inspection');}
  else if(original.method==='template'){
   if(!record(result.bindings))throw new Error('The original binding template is missing.');
   const inputRows=['seed','commissioning'].map(kind=>({kind,file:result.files.find(f=>f.kind===kind)}));
   for(const row of inputRows){state[row.kind+'Text']=await retainedText(row.file,owner);state[row.kind]=clone(row.file);}
   const inspection=await ctx.api(prefix+'/requests/'+original.args.inspectionId);assertLive(owner);
   if(inspection.status!=='COMPLETE'||inspection.type!=='inspect'||!same(inspection.source,result.source))throw new Error('The retained template differs from its original full inspection.');
   state.inspection=clone(inspection);state.archive=clone(inspection.files.find(f=>f.kind==='archive'));
   state.programmeChoice=result.source.programme.record.id+'@'+result.source.programme.record.revision;
   state.template=clone(result);state.bindingsText=pretty(result.bindings);state.bindings=null;state.bindingRaw={};invalidate();
  }else if(original.method==='prepare'){await hydratePrepared(result,original,owner);state.prepared=clone(result);state.preview=null;state.previewBasis=null;state.dirty=false;}
  state.openRequestId=current.requestId;ctx.changed();await ctx.persistNow();
  ctx.notice('Retained the complete original '+original.method+' result and all source identities.');return result;
 }
 async function send(original,file,owner=w()){
  checkRequest(original);assertLive(owner);const current=currentRequest(original,owner);
  current.status='REQUESTING';current.error=null;w().pending=current;ctx.changed();await ctx.persistNow();
  const controller=new AbortController();controllers.add(controller);
  try{
   let result;
   if(original.method==='import'){
    const selectedFile=file??selected.get(original.args.kind);
    if(!selectedFile||selectedFile.name!==original.args.name||selectedFile.size!==original.args.bytes||
       await sha256File(selectedFile)!==original.args.sha256)
     throw new Error('Select the same complete original file to resume this upload; its saved name, length and SHA-256 must match.');
    const query=new URLSearchParams(Object.entries(original.args).map(([k,v])=>[k,String(v)]));
    result=await staffRequest(prefix+'/import?'+query,selectedFile,{raw:true,headers:{'Content-Type':'application/octet-stream'},signal:controller.signal,staffContext:ctx.staffContext});
   }else{
    assertStaffRequestActor(original.args,ctx.staffContext??currentStaffContext());
    result=await ctx.api(prefix+'/'+original.method,clone(original.args),{signal:controller.signal});
   }
   assertLive(owner);return await adopt(original,result,owner);
  }catch(error){
   if(disposed||ctx.state().flowableWork!==owner)throw error;
   const current=currentRequest(original,owner);current.status='UNRESOLVED';current.error={message:String(error.message),code:error.code??null,status:error.status??null};
   w().pending=current;ctx.changed();await ctx.persistNow();throw error;
  }finally{controllers.delete(controller);}
 }
 async function command(method,args){const request=await savePending(method,args);return send(request);}
 async function importFile(kind,file,purpose=''){
  needEdit();const owner=w();
  if(!file||typeof file.name!=='string'||file.size<1||file.size>LIMITS[kind])throw new Error('Select the complete '+kind+' file within '+LIMITS[kind]+' bytes.');
  selected.set(kind,file);uploadProgress='Reading complete '+file.name;
  ctx.render();
  const digest=await sha256File(file,{onProgress:({bytes,total})=>{uploadProgress='Hashing '+file.name+': '+bytes+' / '+total+' bytes';ctx.progress(uploadProgress);}});
  assertLive(owner);const request=await savePending('import',{kind,name:file.name,bytes:file.size,sha256:digest});
  request.purpose=purpose;ctx.changed();await ctx.persistNow();
  try{return await send(request,file,owner);}finally{uploadProgress='';}
 }
 async function importText(kind,text){
  object(text,'Complete '+kind+' input');const file=new File([new TextEncoder().encode(text)],kind+'.json',{type:'application/json'});
  if(w()[kind]?.sha256===hash(text)&&w()[kind].bytes===file.size)return w()[kind];
  await importFile(kind,file);return w()[kind];
 }
 function basis(){
  const state=w();return hash(nativeJSONCanonical({requestId:state.prepared?.requestId,bindingsText:state.bindingsText,
   seedText:state.seedText,commissioningText:state.commissioningText,archive:state.archive,inspectionId:state.inspection?.requestId,
   attachments:state.attachments.map(x=>({fileId:x.file.fileId,name:x.name,purpose:x.purpose}))}));
 }
 async function loadSaved(id){
  const owner=w();if(!UUID.test(id))throw new Error('Use the original saved request UUID.');
  const result=await ctx.api(prefix+'/requests/'+id);assertLive(owner);
  if(result.status==='NOT_RECORDED'){ctx.notice('The original request is not recorded yet. Keep its saved UUID and retry the exact original request; no replacement was created.');return result;}
  if(result.status==='PENDING'){
   if(!result.request)throw new Error('The pending request lost its complete original input.');
   const args={...clone(result.request)};delete args.schema;delete args.type;
   const request={method:result.type,args,requestId:id,sha256:hash(nativeJSONCanonical({method:result.type,args})),status:'PENDING',result:clone(result),error:null};
   if(w().pending&&w().pending.requestId!==id)throw new Error('Recover the other original request first.');
   if(!w().requests.some(x=>x.requestId===id))w().requests.push(request);
   w().pending=w().requests.find(x=>x.requestId===id);ctx.changed();await ctx.persistNow();return;
  }
  const original=w().requests.find(x=>x.requestId===id);
  if(original)return adopt(original,result);
  await ctx.parkWorking('Before reopening a complete saved Flowable result');assertLive(owner);
  if(!result.request)throw new Error('Keep the complete saved request alongside its result.');
  if(w().pending)throw new Error('Recover the pending original request before opening another result.');
  const args=clone(result.request);delete args.schema;delete args.type;
  const entry={method:result.type,args,requestId:id,sha256:hash(nativeJSONCanonical({method:result.type,args})),status:'COMPLETE',result:null,error:null};
  w().requests.push(entry);
  return adopt(entry,result);
 }
 async function downloadFile(file){
  const owner=w();if(!descriptor(file))throw new Error('Select the complete original saved file.');
  const controller=new AbortController();controllers.add(controller);
  try{
   const response=await ctx.api(prefix+'/files/'+file.fileId,undefined,{download:true,signal:controller.signal});
   const blob=await response.blob();
   if(blob.size!==file.bytes||await sha256File(blob)!==file.sha256)throw new Error('The downloaded file differs from the complete original bytes.');assertLive(owner);
   download(blob,file.name,file.mediaType??'application/octet-stream');
  }finally{controllers.delete(controller);}
 }
 async function downloadArchive(){
  const owner=w(),prepared=owner.prepared;if(!prepared?.requestId)throw new Error('Open a complete preparation first.');
  ctx.checkContext();await ctx.verifyStaff();assertLive(owner);
  const path=prefix+'/requests/'+prepared.requestId+'/archive.zip',receipt=await ctx.api(path+'?describe=1');assertLive(owner);
  if(!Number.isSafeInteger(receipt.bytes)||receipt.bytes<1||!HEX.test(receipt.sha256??''))throw new Error('Retain the complete native archive download identity.');
  w().archiveDownload={requestId:prepared.requestId,...clone(receipt)};ctx.changed();await ctx.persistNow();
  const a=document.createElement('a');a.href=path;
  a.download='Flowable_Source_Preparation_'+prepared.requestId+'.zip';a.rel='noopener';document.body.append(a);a.click();a.remove();
  ctx.notice('The browser is downloading the complete preparation ZIP directly: '+receipt.bytes+' bytes, SHA-256 '+receipt.sha256+'. Keep it until the download finishes, then open its full contents. This request does not establish receiving.');
 }
 async function downloadSource(index){
  const owner=w(),source=activeSource(),file=source?.files?.[index];if(!file)throw new Error('Select an original inspected source file.');
  const controller=new AbortController();controllers.add(controller);
  try{
   const response=await ctx.api(prefix+'/sources/'+w().inspection.requestId+'/file?path='+encodeURIComponent(file.name),undefined,{download:true,signal:controller.signal});
   const blob=await response.blob();
   if(blob.size!==file.bytes||await sha256File(blob)!==file.sha256)throw new Error('The original selected source file changed during download.');assertLive(owner);
   download(blob,file.name.split('/').at(-1),file.mediaType??'application/octet-stream');
  }finally{controllers.delete(controller);}
 }
 async function preview(){
  needEdit();const state=w(),result=state.prepared,installation=result?.installation;
  if(!installation?.document||!installation.preview)throw new Error('Prepare the complete original Installation first.');
  await ctx.refreshCase();assertLive(state);
  if(installation.source?.caseId!==ctx.caseId||installation.source.version!==ctx.context().version)
   throw new Error('The original case advanced. Keep this complete preparation and obtain a fresh Workshare seed before preparing the next one.');
  const frozen=basis(),value=await ctx.api('/api/operations/'+ctx.caseId+'/installation-preview',clone(installation.preview));
  if(state!==w()||frozen!==basis()||!same(value.document,installation.document)||!same(value.source,installation.source))
   throw new Error('The native preview differs from the complete selected source or current bindings.');
  state.preview=clone(value);state.previewBasis=frozen;ctx.changed();await ctx.persistNow();
  ctx.notice('Reviewed the complete original Installation. Open its draft to use the existing explicit native Save.');
 }
 async function receive(){
  needEdit();const state=w();
  if(!state.preview||state.previewBasis!==basis())throw new Error('Preview the exact current complete preparation before opening its Installation draft.');
  await ctx.refreshCase();assertLive(state);
  if(state.preview.source?.caseId!==ctx.caseId||state.preview.source.version!==ctx.context().version)
   throw new Error('The original case changed after preview. Retain this edition and prepare against its current Workshare.');
  const result=state.prepared,answer=await ctx.receiveDraft({scope:{caseId:ctx.caseId,version:ctx.context().version},
   document:clone(state.preview.document),prepared:clone(result.installation),preview:clone(state.preview),
   sourcePreparationId:result.requestId,sourceDeskDraftId:ctx.draft()?.id??null,workshareCaseId:result.workshareCaseId??result.installation.workshareCaseId});
  assertLive(state);if(!answer?.applied)throw new Error(answer?.message||'The original Installation editor could not retain the complete draft.');
  state.receivedDraftKey=answer.draftKey;state.dirty=false;ctx.changed();await ctx.persistNow();
  ctx.notice('The complete draft is in Customer installations. Its existing Preview and Save controls own the native edition.');
  await ctx.closeToInstallation();
 }
 function bindEdit(path,value){
  const state=w();state.bindingRaw??={};state.bindingRaw[path]=value;touch();
  const bindings=object(state.bindingsText,'Complete original bindings'),parts=path.split('.');
  if(parts.some(x=>['__proto__','prototype','constructor'].includes(x)))throw new Error('Select an original binding field.');
  if(path==='payment.taskUnits'){
   if(value!==''&&!/^(0|[1-9][0-9]*)$/.test(value))throw new Error('Keep the task count as whole decimal text.');
   value=value===''?null:Number(value);if(value!==null&&!Number.isSafeInteger(value))throw new Error('The task count exceeds the original integer range.');
  }else if(['merchantDeploymentId','payment.priceAtomic','payment.taskBudgetAtomic'].includes(path))value=value===''?null:value;
  let objectValue=bindings;for(const part of parts.slice(0,-1))objectValue=objectValue[part]??(objectValue[part]={});
  objectValue[parts.at(-1)]=value;delete state.bindingRaw[path];state.bindingsText=pretty(bindings);state.bindings=null;invalidate();
 }
 function edit(target){
  const key=target.dataset.flowableField,binding=target.dataset.flowableBinding,buyer=target.dataset.flowableBuyer;
  if(!key&&!binding&&!buyer)return false;needEdit();
  if(buyer){const b=object(w().bindingsText,'Complete bindings'),ids=new Set(b.buyerDeploymentIds??[]);target.checked?ids.add(buyer):ids.delete(buyer);b.buyerDeploymentIds=[...ids];w().bindingsText=pretty(b);w().bindings=null;invalidate();return true;}
  if(binding){bindEdit(binding,target.value);return true;}
  if(!TEXT_KEYS.includes(key))throw new Error('Select an original Flowable working field.');
  const state=w();state[key]=target.value;
  if(key==='programmeChoice'){state.inspection=null;clearFrom('inspection');}
  else if(['seedText','commissioningText','bindingsText'].includes(key)){
   state[key.replace('Text','')]=null;if(key==='bindingsText')state.bindingRaw={};clearFrom(key.replace('Text',''));
  }else touch();
  return true;
 }
 async function chooseFile(target){
  const owner=w(),kind=target.dataset.flowableUpload;if(!kind)return false;
  const file=target.files?.[0];if(!file)return true;
  if(w().pending){
   if(w().pending.method!=='import'||w().pending.args.kind!==kind)throw new Error('Recover the existing original request before selecting another source.');
   selected.set(kind,file);ctx.notice('Selected the original upload file. Use Retry exact saved request to verify and continue.');return true;
  }
  if(['seed','commissioning','bindings'].includes(kind)){
   needEdit();if(file.size>LIMITS[kind])throw new Error('The complete input exceeds its original capacity.');
   const raw=new Uint8Array(await file.arrayBuffer());assertLive(owner);const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
   w()[kind+'Text']=text;w()[kind]=null;clearFrom(kind);ctx.changed();await ctx.persistNow();
  }
  await importFile(kind,file,kind==='attachment'?w().attachmentPurpose:'');return true;
 }
 async function action(action,target){
  const key=action.slice('flowable-'.length),state=w();
  if(key==='working-download'){download(pretty(state),'FLOWABLE_SOURCE_WORKING.json');return;}
  if(key==='request-download'){download(pretty(state.requests),'FLOWABLE_SOURCE_REQUESTS.json');return;}
  if(key==='status')return loadSaved(state.pending?.requestId??state.openRequestId);
  if(key==='retry'){if(!state.pending)throw new Error('Select the original pending request.');return send(clone(state.pending));}
  if(key==='retain-rejected'){
   const original=state.pending;if(!original||![400,409,413,415,422].includes(original.error?.status))throw new Error('Read the original outcome; only an explicit validation rejection can start a corrected preparation.');
   await ctx.parkWorking('Before revising explicitly rejected Flowable source inputs');
   const current=currentRequest(original);current.status='REJECTED_RETAINED';state.pending=null;state.preview=null;state.previewBasis=null;ctx.changed();await ctx.persistNow();ctx.notice('Retained the complete rejected source request. Correct the input and explicitly prepare a new request; no Installation or engine request was replayed.');return;
  }
  if(key==='file-download')return downloadFile([...state.requests.flatMap(x=>x.result?.files??[])].find(x=>x.fileId===target.dataset.id));
  if(key==='source-download')return downloadSource(Number(target.dataset.index));
  if(key==='archive-download')return downloadArchive();
  if(key==='receiving-download'){
   const result=state.prepared;if(!result?.readyReceiving)throw new Error('Reopen the complete preparation to read its original native receiving selection.');
   download(pretty({schema:'stellar-forge.flowable-source-desk-receiving-selection.v1',requestId:result.requestId,...clone(result.readyReceiving),caseId:ctx.caseId,workshareCaseId:result.workshareCaseId,archive:result.archive,files:result.files}), 'FLOWABLE_SOURCE_RECEIVING_SELECTION.json');return;
  }
  if(key==='open'){if(state.pending&&state.pending.requestId!==state.openRequestId)throw new Error('Recover the existing request first.');return loadSaved(state.openRequestId);}
  if(key==='list'||key==='more'){
   const offset=key==='more'?state.nextOffset:0,page=await ctx.api(prefix+'/requests?offset='+offset+'&limit=100');
   assertLive(state);if(!Array.isArray(page.rows))throw new Error('The saved result inventory is incomplete.');
   state.history=key==='more'?[...state.history,...clone(page.rows)]:clone(page.rows);state.nextOffset=page.nextOffset??null;ctx.changed();await ctx.persistNow();return;
  }
  needEdit();
  if(key==='catalogue'){if(!state.archive)throw new Error('Upload the complete Flowable workspace archive first.');return command('catalogue',{archiveId:state.archive.fileId});}
  if(key==='inspect'){
   const row=selectedProgramme();if(!row||!state.archive)throw new Error('Select an original programme edition from this archive.');
   return command('inspect',{archiveId:state.archive.fileId,programmeId:row.record.id,programmeRevision:row.record.revision,
    expectedProgrammeSha256:row.programmeSha256,expectedBasisSha256:row.basisSha256});
  }
  if(key==='workshares'){
   const value=await ctx.nativeWorkshares();assertLive(state);state.nativeWorkshares=clone(value.inventory);state.nativeSelection=clone(value.selection);
   if(value.commissioningText&&!state.commissioningText){state.commissioningText=value.commissioningText;state.commissioning=null;}
   ctx.changed();await ctx.persistNow();return;
  }
  if(key==='seed'){
   if(!state.nativeSelection||!state.workshareId)throw new Error('Read the attached original Workshares and select one.');
   const value=await ctx.nativeSeed(state.nativeSelection,state.workshareId);assertLive(state);state.seedText=pretty(value);state.seed=null;clearFrom('seed');ctx.changed();await ctx.persistNow();return;
  }
  if(key==='template'){
   if(!state.inspection)throw new Error('Inspect the exact selected programme first.');
   await importText('seed',state.seedText);await importText('commissioning',state.commissioningText);
   await ctx.refreshCase();assertLive(state);return command('template',{inspectionId:state.inspection.requestId,seedId:state.seed.fileId,commissioningId:state.commissioning.fileId,nativeCaseId:ctx.caseId,expectedVersion:ctx.context().version});
  }
  if(key==='prepare'){
   if(!state.inspection||!state.template)throw new Error('Read the complete original binding template first.');
   if(Object.keys(state.bindingRaw??{}).length)throw new Error('Correct retained unfinished guided bindings before preparation.');
   await importText('seed',state.seedText);await importText('commissioning',state.commissioningText);await importText('bindings',state.bindingsText);
   await ctx.refreshCase();assertLive(state);return command('prepare',{inspectionId:state.inspection.requestId,seedId:state.seed.fileId,bindingsId:state.bindings.fileId,expectedVersion:ctx.context().version,
    commissioningId:state.commissioning.fileId,nativeCaseId:ctx.caseId,attachments:state.attachments.map(a=>({fileId:a.file.fileId,name:a.name,purpose:a.purpose}))});
  }
  if(key==='remove-attachment'){state.attachments.splice(Number(target.dataset.index),1);invalidate();return;}
  if(key==='preview')return preview();
  if(key==='receive')return receive();
  if(key==='show-request'){state.openRequestId=target.dataset.id;return loadSaved(state.openRequestId);}
  throw new Error('Unknown Flowable desk control.');
 }
 function fileTable(files){
  return files.length?table(['Complete file','Original identity','Download'],files.map(f=>[
   esc(f.name)+'<br>'+esc(f.kind),f.bytes+' bytes<br><code>'+esc(f.sha256)+'</code>',
   button('Download complete file','file-download','data-id="'+esc(f.fileId)+'"')])):empty('No retained complete files yet.');
 }
 function bindingsView(){
  const state=w();let b;try{b=object(state.bindingsText,'Complete bindings');}catch(error){return hint(error.message);}
  const make=(label,key,value,options={})=>field(label,key,state.bindingRaw?.[key]??value,options).replace('data-flowable-field=','data-flowable-binding=');
  const deployments=ctx.caseData()?.records?.deployments??[],merchants=deployments.filter(x=>['MERCHANT','BOTH'].includes(x.role));
  return '<div class="source-desk-fields">'+
   make('Existing merchant deployment','merchantDeploymentId',b.merchantDeploymentId??'',{choices:[['','Not selected'],...merchants.map(x=>[x.id,x.name+' · '+x.operator])]})+
   make('Actual receiving host','receiving.host',b.receiving?.host??'')+
   make('Receiving operator','receiving.operator',b.receiving?.operator??'')+
   make('Customer source authority','source.authority',b.source?.authority??'',{area:true,wide:true})+
   make('Exact source reference','source.reference',b.source?.reference??'',{area:true,wide:true})+
   make('Payment network','payment.network',b.payment?.network??'')+
   make('Payment asset','payment.asset',b.payment?.asset??'')+
   make('Approved recipient','payment.recipient',b.payment?.recipient??'')+
   make('Payment authority','payment.authority',b.payment?.authority??'',{wide:true})+
   make('Price in atomic units','payment.priceAtomic',b.payment?.priceAtomic??'')+
   make('Whole task count','payment.taskUnits',b.payment?.taskUnits??'')+
   make('Task budget in atomic units','payment.taskBudgetAtomic',b.payment?.taskBudgetAtomic??'')+'</div>'+
   '<fieldset><legend>Existing customer buyer deployments</legend>'+deployments.filter(x=>['BUYER','BOTH'].includes(x.role)).map(x=>'<label class="source-desk-check"><input type="checkbox" data-flowable-buyer="'+esc(x.id)+'" data-source-edit'+(b.buyerDeploymentIds?.includes(x.id)?' checked':'')+'> <span>'+esc(x.name)+' · '+esc(x.operator)+'</span></label>').join('')+'</fieldset>'+hint('Complete receiving instructions and every other original binding remain editable in the full JSON below.');
 }
 function render(){
  const state=w(),source=activeSource(),rows=programmeRows(),pending=state.pending,files=state.prepared?.files??[];
  const upload=(kind,label)=>'<label>'+esc(label)+'<input type="file" data-flowable-upload="'+kind+'"'+(kind==='archive'?' accept=".ndjson,application/x-ndjson"':kind==='attachment'?'':' accept=".json,application/json"')+' data-source-edit></label>';
  const programmeChoices=[['','Choose a complete retained programme edition'],...rows.map(x=>[x.record.id+'@'+x.record.revision,(x.label||x.key||x.record.id)+' · revision '+x.record.revision+' · '+(x.state??'')])];
  return '<section class="flowable-source-desk">'+
   header('Flowable customer source','Keep the entire workspace, select its exact programme edition, and prepare the original commercial Installation.',button('Download Flowable working fields','working-download')+button('Download original requests','request-download'))+
   (pending?'<section class="source-desk-recovery">'+header('Continue the original request',pending.method+' · '+pending.requestId)+
    hint(pending.error?.message||pending.status)+button('Read saved request','status')+button('Retry exact saved request','retry')+
    ([400,409,413,415,422].includes(pending.error?.status)?button('Keep rejected preparation and edit new inputs','retain-rejected'):'')+
    (pending.method==='import'?upload(pending.args.kind,'Reselect the same original '+pending.args.name):'')+
    detail('Complete original pending request',pending)+'</section>':'')+
   '<h4>1 · Whole workspace and selected programme</h4>'+upload('archive','Complete Flowable workspace NDJSON, up to 256 MiB')+
   (uploadProgress?hint(uploadProgress):'')+(state.archive?fileTable([state.archive]):empty('Choose the full original exported workspace. The large source remains a mandatory sidecar outside ordinary case attachment limits.'))+
   '<div class="source-desk-actions">'+button('Read complete programme catalogue','catalogue','',!state.archive||!!pending)+'</div>'+
   field('Saved programme edition','programmeChoice',state.programmeChoice,{choices:programmeChoices,wide:true})+
   '<div class="source-desk-actions">'+button('Inspect selected programme and original outcomes','inspect','',!selectedProgramme()||!!pending)+'</div>'+
   (selectedProgramme()?detail('Selected original record, source and basis identities',selectedProgramme()):'')+
   (source?'<p><strong>'+esc(source.programme.programme?.label||source.programme.record.id)+'</strong> · '+esc(source.programme.progress.state)+
    ' · '+esc(source.programme.progress.total)+' steps · '+esc(source.programme.progress.confirmed)+' confirmed</p>'+
    table(['Programme step','Native kind and state','Original record'],source.programme.progress.rows.map(x=>[esc(x.key),esc(x.kind)+' · '+esc(x.state),x.record?'<code>'+esc(x.record.id)+'</code><br>Revision '+x.record.revision:'Unprepared']))+
    table(['Complete selected source','Original bytes / SHA-256','Download'],source.files.map((f,i)=>[esc(f.name),f.bytes+' bytes<br><code>'+esc(f.sha256)+'</code>',button('Download original source','source-download','data-index="'+i+'"')]))+
    detail('Full selected programme, source, reviews and recorded native outcomes',source):'')+
   '<h4>2 · Original customer Workshare and commissioning</h4>'+
   '<div class="source-desk-actions">'+button('Read attached native Workshares','workshares','',!!pending)+'</div>'+
   field('Original Workshare','workshareId',state.workshareId,{choices:[['','Choose attached original Workshare'],...(state.nativeWorkshares?.cases??[]).map(x=>[x.caseId,x.title||x.customer||x.caseId])],wide:true})+
   '<div class="source-desk-actions">'+button('Read fresh original Workshare seed','seed','',!state.workshareId||!!pending)+'</div>'+
   '<div class="source-desk-fields">'+upload('seed','Or open complete original Workshare seed JSON')+upload('commissioning','Complete original commercial commissioning JSON')+
   field('Complete native Workshare seed','seedText',state.seedText,{area:true,rows:9,wide:true})+
   field('Complete commercial commissioning source','commissioningText',state.commissioningText,{area:true,rows:9,wide:true})+'</div>'+
   hint('The native seed must belong to this actual case and current plan. Preserve original phase hours, commercial terms and OPEN acceptance checks.')+
   '<div class="source-desk-actions">'+button('Create complete native binding template','template','',!state.inspection||!state.seedText||!state.commissioningText||!!pending)+'</div>'+
   '<h4>3 · Customer bindings and complete additional files</h4>'+
   (state.template?bindingsView()+detail('Original installed profile and commercial source',state.template):empty('Read the original template to edit actual host, operator, source and payment bindings.'))+
   '<div class="source-desk-fields">'+upload('bindings','Open complete binding JSON')+
   field('Full original bindings','bindingsText',state.bindingsText,{area:true,rows:12,wide:true})+
   field('Purpose for the next additional file','attachmentPurpose',state.attachmentPurpose,{wide:true})+upload('attachment','Additional complete customer working file')+'</div>'+
   (state.attachments.length?table(['Selected working file','Purpose / full identity','Next preparation'],state.attachments.map((a,i)=>[esc(a.name),esc(a.purpose)+'<br>'+a.file.bytes+' bytes<br><code>'+esc(a.file.sha256)+'</code>',
    button('Download complete file','file-download','data-id="'+a.file.fileId+'"')+button('Remove from next preparation','remove-attachment','data-index="'+i+'"',!!pending)])):'')+
   '<div class="source-desk-actions">'+button('Prepare complete Installation and source sidecars','prepare','',!state.template||!state.bindingsText||!!pending)+'</div>'+
   '<h4>4 · Complete preparation, original Preview and Save</h4>'+
   (state.prepared?'<p>Saved preparation <code>'+esc(state.prepared.requestId)+'</code><br>SHA-256 <code>'+esc(state.prepared.preparationSha256)+'</code></p>'+
    fileTable(files)+(state.archiveDownload?.requestId===state.prepared.requestId?detail('Whole preparation download identity',state.archiveDownload):'')+detail('Complete prepared native Installation',state.prepared.installation)+
    '<div class="source-desk-actions">'+button('Download whole preparation ZIP','archive-download')+button('Download exact receiving selection','receiving-download','',!state.prepared.readyReceiving)+button('Preview in the original case','preview','',!!pending)+
    button('Open reviewed Installation draft','receive','',!state.preview||state.previewBasis!==basis()||!!pending)+'</div>'+
    (state.preview?detail('Actual original case preview',state.preview):'')+
    hint('Opening a draft does not save, accept or fund it. Review and use the existing Installation editor Save. Carry every listed file and the full workspace sidecar through complete independent receiving.'):
    empty('Prepare all selected original source, commercial terms and bindings before native preview.'))+
   '<h4>Saved requests and reopening</h4>'+
   '<div class="source-desk-fields">'+field('Original request UUID','openRequestId',state.openRequestId,{wide:true})+'</div>'+
   '<div class="source-desk-actions">'+button('Open saved result','open')+button('Refresh saved requests','list')+
   (state.nextOffset!==null&&state.history.length?button('Load next saved requests','more'):'')+'</div>'+
   (state.history.length?table(['Original saved request','Type / state','Open'],state.history.map(x=>['<code>'+esc(x.requestId)+'</code>',esc(x.type)+' · '+esc(x.status??''),button('Open complete saved result','show-request','data-id="'+esc(x.requestId)+'"')])):'')+
   '</section>';
 }
 return {render,edit,chooseFile,action,validate:validateFlowableSourceWork,pending:()=>!!w().pending,dirty:()=>!!w().dirty,
  async dispose(){disposed=true;for(const controller of controllers)controller.abort();},
  controls(){return {pending:!!w().pending,editable:editable(),disposed};}};
}

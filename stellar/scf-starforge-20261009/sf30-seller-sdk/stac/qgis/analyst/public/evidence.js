// SPDX-License-Identifier: MIT
// Full evidence workflow in the original QGIS analyst. Rendered desktop and 390px review is required before readiness.
import {createEvidenceStore,clone,same} from './evidence-store.js';
const MAX_FILE=128*1024*1024;
const SOURCE_FIELDS=['title','seriesKey','edition','role','issuer','jurisdiction','sourceUri','publishedDate','effectiveDate','retrievedAt','mediaType','coordinateReference','notes','previousId','documentScope','coverageNotes','publisherUpdatedAt','queryDescription'];
const CASE_FIELDS=['title','jurisdiction','purpose','proposedUse','asOf','scope','assumptions','sourceReferences','subjects','professionalQuestions'];
const FINDING_FIELDS=['title','classification','status','statement','applicability','assumptions','subjectIds','sourceReferences','reviewer','reviewedAt','nextAction','responsibleRole','dueDate','answer','answerReferences','correctionReason'];
const pick=(row,fields)=>Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,clone(row[k])]));
const clean=v=>v===null||v===undefined?'—':typeof v==='object'?JSON.stringify(v):String(v);
const title=v=>String(v).replaceAll('_',' ').toLowerCase().replace(/^./,x=>x.toUpperCase());
function absolutePath(value){
 if(typeof value!=='string'||!value.startsWith('/')||value.includes('\0'))throw new Error('Use the complete absolute path on the original host.');
 const parts=value.split('/').filter(p=>p!==''&&p!=='.');return (value.startsWith('//')&&!value.startsWith('///')?'//':'/')+parts.join('/');
}
function normalizedPayload(action,raw,directory){
 const value=clone(raw);
 if(action==='project.export')value.directory=absolutePath(value.directory||absolutePath(directory).replace(/\/$/,'')+'-deliveries');
 if(action==='map.features'){value.offset??=0;value.limit??=100;}
 if(action==='evidence.spatial'){value.measurementCrs=String(value.measurementCrs).trim();value.purpose=String(value.purpose).trim();}
 if(action==='evidence.command'&&Object.hasOwn(value.payload,'file'))value.payload.file=absolutePath(value.payload.file);
 return value;
}
const ident=()=> 'evidence-'+crypto.randomUUID();
const now=()=>new Date().toISOString();
function el(tag,attributes={},...children){
  const node=document.createElement(tag);for(const[k,v]of Object.entries(attributes)){
    if(k.startsWith('on'))node.addEventListener(k.slice(2),v);else if(k==='class')node.className=v;else if(k==='text')node.textContent=v;
    else if(v!==false&&v!==null&&v!==undefined){if(k in node&&!k.startsWith('aria-'))node[k]=v;else node.setAttribute(k,v===true?'':v);}
  }for(const child of children.flat(Infinity))if(child!==null&&child!==undefined&&child!==false)node.append(child instanceof Node?child:document.createTextNode(String(child)));return node;
}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const a=el('a',{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function section(heading,...body){return el('section',{class:'ev-panel'},el('h2',{},heading),...body);}
function note(value){return el('p',{class:'ev-note'},value);}
function grid(...children){return el('div',{class:'ev-grid'},...children);}
function actions(...children){return el('div',{class:'ev-actions'},...children);}
function table(columns,rows,empty='No saved records.'){
 return el('div',{class:'ev-table',tabIndex:0},el('table',{},el('thead',{},el('tr',{},columns.map(([label])=>el('th',{scope:'col'},label)))),
 el('tbody',{},rows.length?rows.map(row=>el('tr',{},columns.map(([,read])=>el('td',{},read(row))))):el('tr',{},el('td',{colSpan:columns.length},empty)))));
}
function detail(label,value){const content=el('div');const d=el('details',{ontoggle:()=>{content.replaceChildren(...(d.open?[el('pre',{},JSON.stringify(value,null,2))]:[]));}},el('summary',{},label),content);return d;}
function field(label,control,hint=''){return el('label',{class:'ev-field'},el('span',{},label),control,hint&&el('small',{},hint));}
function textInput(value,changed,options={}){return el('input',{type:'text',value:value??'',...options,oninput:e=>changed(e.target.value)});}
function area(value,changed,rows=3){return el('textarea',{value:value??'',rows,oninput:e=>changed(e.target.value)});}
function select(value,choices,changed){const s=el('select',{onchange:e=>changed(e.target.value)});for(const [key,label]of choices)s.append(el('option',{value:key,selected:String(key)===String(value)},label));if(value&&!choices.some(x=>String(x[0])===String(value)))s.prepend(el('option',{value,selected:true},'Retained: '+value));return s;}
const href=(label,url)=>el('a',{href:url,target:'_blank',rel:'noopener'},label);
function sourceDefinition(){return {title:'',seriesKey:'',edition:'Unknown',role:'OTHER',issuer:'',jurisdiction:'',sourceUri:'',publishedDate:'',effectiveDate:'',retrievedAt:now(),mediaType:'application/pdf',coordinateReference:'',notes:'',previousId:'',documentScope:'',coverageNotes:'',publisherUpdatedAt:'',queryDescription:''};}
function caseDefinition(){return {title:'',jurisdiction:'',purpose:'',proposedUse:'',asOf:'',scope:'',assumptions:'',sourceReferences:[],subjects:[],professionalQuestions:[]};}
function findingDefinition(){return {title:'',classification:'SOURCE_FACT',status:'OPEN',statement:'',applicability:'',assumptions:'',subjectIds:[],sourceReferences:[],reviewer:'',reviewedAt:now(),nextAction:'',responsibleRole:'',dueDate:'',answer:'',answerReferences:[],correctionReason:''};}
export function createEvidenceWorkbench(ctx){
 let workspace='',store,catalog,snapshot,caseId='',view='Sources',generation=0,reading=0,busy=false,root=null,pending=null,receipts=[],problem='',forms=new Map(),formKey='',writeTail=Promise.resolve();
 let pollTimer=null;
 let featurePage=null,featureSource='',featureOffset=0,featureLimit=25,nativeRead=null,selectedFeature=null,selectedNative=null,businessField='',fileSelection=null,uploadPaused=false,sourceResult=null,comparison=null,caseLists={},sourceRequest=0;
 const alive=g=>workspace===ctx.getState().id&&g===generation;
 function say(message,error=false){problem=error?message:'';ctx.notice(message,error);}
 function button(label,fn,options={}){return el('button',{type:'button',...options,onclick:async()=>{try{await fn();}catch(e){say(e.message,true);if(root?.isConnected)await draw();}}},label);}
 function currentBasis(extra={}){return {workspaceRevision:catalog.revision,caseId:caseId||null,caseVersionId:snapshot?.case?.id||null,...extra};}
 function choices(){return [['','Choose original source'],...(catalog?.sources||[]).map(r=>[r.id,r.title+' · '+r.role+' · '+r.edition])];}
 async function getForm(key,initial,basis=currentBasis()){
   if(!forms.has(key)){const record=await store.draft(key,initial,basis);forms.set(key,{...record,key,storageError:null});}
   formKey=key;return forms.get(key);
 }
 function save(form){
   const body=clone(form.body),basis=clone(form.basis);writeTail=writeTail.then(async()=>{
     if(form.storageError)throw new Error(form.storageError);
     const saved=await store.saveDraft(form.key,form.version,body,basis);form.version=saved.version;form.updatedAt=saved.updatedAt;
   }).catch(error=>{form.storageError=error.message;say(error.message+' Your current draft remains available through Download current draft.',true);});return writeTail;
 }
 function set(form,key,value){form.body[key]=value;save(form);}
 async function redraw(){await writeTail;await draw();}
 function bind(form,key,label,options={}){return field(label,options.multiline?area(form.body[key],v=>set(form,key,v),options.rows||3):textInput(form.body[key],v=>set(form,key,v),options),options.hint);}
 function stale(form,basis){return !same(form.basis,basis);}
 function basisPanel(form,basis){
   return section('Draft and reviewed source basis',
     note('Saved draft version '+form.version+' · original workspace revision '+clean(form.basis?.workspaceRevision)+' · current revision '+catalog.revision),
     form.storageError&&note(form.storageError),
     stale(form,basis)&&el('p',{class:'ev-warning'},'This draft belongs to an earlier source or case state. Inspect both bases and explicitly adopt the current basis before submitting.'),
     detail('Original and current reviewed basis',{original:form.basis,current:basis}),
     actions(button('Download current draft',()=>download('evidence-draft-'+form.key.replaceAll(':','-')+'.json',{schema:'starforge.parcel-evidence-draft.v1',workspaceId:workspace,...clone(form)})),
       button('Inspect saved browser draft',async()=>{const saved=await store.read('draft:'+form.key);sourceResult={title:'Saved browser draft',value:saved};await draw();}),
       button('Adopt saved browser draft',async()=>{const saved=await store.read('draft:'+form.key);if(!saved)throw new Error('The saved draft is unavailable.');forms.set(form.key,{...saved,key:form.key,storageError:null});await draw();}),
       button('Keep draft and adopt reviewed current basis',async()=>{await writeTail;if(form.storageError)throw new Error('Resolve the browser draft conflict first.');form.basis=clone(basis);await save(form);await draw();},{disabled:!stale(form,basis)})));
 }
 function refs(form,rows,changed,label='Source references'){
   return section(label,note('Choose the exact original file and locator. PDF source page positions start at 0; the printed page label is retained separately.'),
     ...rows.map((r,i)=>el('fieldset',{},el('legend',{},'Reference '+(i+1)),grid(
       field('Original source',select(r.sourceId||'',choices(),v=>{r.sourceId=v;changed();})),
       field('Exact locator',textInput(r.locator,v=>{r.locator=v;changed();})),
       field('Source page position (0-based)',textInput(r.sourcePageIndex0??'',v=>{if(v==='')delete r.sourcePageIndex0;else r.sourcePageIndex0=Number(v);changed();},{type:'number',min:0,step:1})),
       field('Printed page',textInput(r.printedPage||'',v=>{r.printedPage=v;changed();})),
       field('Section',textInput(r.section||'',v=>{r.section=v;changed();}))),
       button('Remove reference',async()=>{rows.splice(i,1);changed();await redraw();}))),
     button('Add source reference',async()=>{rows.push({sourceId:'',locator:''});changed();await redraw();}));
 }
 async function refresh(){
   const g=generation,selected=caseId;await writeTail;
   const next=await ctx.request('/api/evidence');if(!alive(g))return;
   const chosen=selected?(next.cases.some(r=>r.caseId===selected)?selected:''):(catalog?'':(next.cases[0]?.caseId||''));
   const nextSnapshot=chosen?await ctx.request('/api/evidence/cases/'+encodeURIComponent(chosen)+'/snapshot'):null;
   if(!alive(g)||caseId!==selected)return;
   catalog=next;caseId=chosen;snapshot=nextSnapshot;caseLists={};
   pending=await store.pending();const all=await store.all();if(!alive(g))return;
   receipts=all.filter(r=>r.key.startsWith('receipt:')).map(r=>r.value);await draw();
 }
 async function changeCase(next){
   await writeTail;const g=++generation;root.inert=true;root.setAttribute('aria-busy','true');
   try{const value=next?await ctx.request('/api/evidence/cases/'+encodeURIComponent(next)+'/snapshot'):null;
     if(!alive(g))return;caseId=next;snapshot=value;caseLists={};comparison=null;activeFindingKey='';nativeRead=null;selectedNative=null;featurePage=null;selectedFeature=null;await draw();
   }finally{if(alive(g)){root.inert=false;root.setAttribute('aria-busy','false');}}
 }
 async function listed(kind){
   if(caseLists[kind])return caseLists[kind];
   if(!caseId)return [];let offset=0,items=[],g=generation,selected=caseId;
   while(true){const p=await ctx.request('/api/evidence/cases/'+encodeURIComponent(selected)+'/'+kind.replace('?history=1','')+'?offset='+offset+'&limit=100'+(kind.endsWith('?history=1')?'&history=1':''));
     if(!alive(g)||selected!==caseId)throw new Error('The selected case changed during the source read.');
     items.push(...p.items);if(p.complete)break;offset+=p.items.length;if(!p.items.length)throw new Error('The original page did not advance.');
   }caseLists[kind]=items;return items;
 }
 async function payloadSubmit(action,payload,form,basis=currentBasis(),context={}){
   // Capture complete submitted form and selection before the first asynchronous boundary.
   const originalBasis=clone(basis),selectedGeneration=generation;
   const actor=String(ctx.getActor()||'').trim();if(!actor)throw new Error('Enter the responsible analyst in the application header.');
   const workspaceDirectory=absolutePath(ctx.getDirectory());
   const body={requestId:ident(),action,payload:normalizedPayload(action,payload,workspaceDirectory),revision:originalBasis.workspaceRevision,actor};
   const frozen={workspaceDirectory,caseId,view,formKey:form?.key||null,formBody:form?clone(form.body):null,basis:originalBasis,...clone(context)};
   await writeTail;
   if(!alive(selectedGeneration))throw new Error('The selected evidence context changed before dispatch. Your original form remains saved.');
   if(form&&(form.storageError||stale(form,originalBasis)))throw new Error('Review and reconcile the retained draft basis before submitting.');
   await store.lock(async()=>{if(!alive(selectedGeneration))throw new Error('The selected context changed while awaiting original dispatch.');const p=await store.claim(body,frozen);await dispatch(p,false);});
 }
 async function dispatch(p,continuing){
   const current=await store.pending();if(!current||!same(current.request,p.request))throw new Error('Receive the current saved request; this tab no longer owns that request.');
   busy=true;const attempted=await store.attempt(p.request.requestId,continuing?'CONTINUE':'POST'),attemptId=attempted.activeAttempt;
   try{
     let operation;
     try {operation=await ctx.request(continuing?'/api/operations/'+encodeURIComponent(p.request.requestId)+'/continue':'/api/operations',
       {method:'POST',body:JSON.stringify(continuing?{inputSha256:p.operation.inputSha256}:p.request)});}
     catch(error){await store.attemptResult(p.request.requestId,attemptId,error.status&&error.status<500?'REJECTED':'UNCERTAIN',{message:error.message,status:error.status||null});throw error;}
     await store.attemptResult(p.request.requestId,attemptId,'RECEIVED',{requestId:operation.requestId,status:operation.status});
     await accept(operation);
   }finally{busy=false;pending=await store.pending();await draw();}
 }
 async function accept(operation){
   const current=await store.pending();if(!current)throw new Error('The original pending request is unavailable.');
   const id=current.request.requestId;await store.observe(id,operation);
   if(operation.status!=='COMPLETED'){pending=await store.pending();await draw();return;}
   const p=await store.pending(),g=generation;const next=await ctx.request('/api/evidence');
   if(!alive(g))return;let selected=caseId,nextSnapshot=selected?await ctx.request('/api/evidence/cases/'+encodeURIComponent(selected)+'/snapshot'):null;
   if(!alive(g)||selected!==caseId)return;
   const result=operation.result;
   // Complete request, current catalogue and exact original result are stored atomically before clearing pending.
   await store.received(id,{operation:clone(operation),result:clone(result),receivedRevision:next.revision});
   catalog=next;snapshot=nextSnapshot;caseLists={};pending=null;
   const form=p.context.formKey&&forms.get(p.context.formKey);
   if(form&&same(form.body,p.context.formBody)&&caseId===p.context.caseId){
     if(p.request.action==='evidence.command'&&p.request.payload.action==='source.inspect'){
       form.body.inspection=clone(result);form.body.file=result.file;form.basis={...form.basis,workspaceRevision:next.revision};await save(form);
     }
     if(p.request.action==='evidence.command'&&p.request.payload.action==='source.compare'){
       comparison={payload:clone(p.request.payload.payload),result:clone(result)};form.body.comparison=clone(comparison);form.body.decisions=[];
       for(const r of result.affectedFindings||[])form.body.decisions.push({findingVersionId:r.id,decision:'REVIEW_REQUIRED',reason:'',replacement:null});
       form.basis={...form.basis,workspaceRevision:next.revision};await save(form);
     }
   }
   receipts=(await store.all()).filter(r=>r.key.startsWith('receipt:')).map(r=>r.value);
   say('Original operation completed and its full receipt was retained.');await ctx.refreshState({render:false});await draw();
 }
 async function receive(){
   await store.lock(async()=>{
     const p=await store.pending();if(!p)throw new Error('No original browser request remains pending.');
     try{const op=await ctx.request('/api/operations/'+encodeURIComponent(p.request.requestId));await accept(op);}
     catch(error){if(error.status===404||error.code==='ANALYST_REQUEST_NOT_FOUND'){await store.changePending(p.request.requestId,v=>({...v,notFoundAt:now()}));pending=await store.pending();say('The listener has no saved result for this ID. Review its dispatch history before an explicit same-request retry.');}else throw error;}
   });await draw();
 }
 function pendingPanel(){
   if(!pending)return null;const p=pending,op=p.operation,canRetry=!!p.notFoundAt,terminal=op&&['FAILED','CANCELLED','INTERRUPTED'].includes(op.status);
   return section('Original operation awaiting receiving',el('strong',{},op?.displayStatus||op?.status||'OUTCOME NOT YET RECEIVED'),
     note(p.request.requestId+' · '+p.request.action+(p.request.payload.action?' / '+p.request.payload.action:'')),
     actions(button('Receive saved outcome',receive,{disabled:busy}),
       button('Retry same original request',()=>store.lock(async()=>{const current=await store.pending();if(!current||current.request.requestId!==p.request.requestId||!current.notFoundAt)throw new Error('Read the current original request first.');await dispatch(current,false);} ),{disabled:busy||!canRetry}),
       button('Continue original interrupted operation',()=>store.lock(async()=>{const current=await store.pending();if(!current?.operation?.canResume)throw new Error('The original listener has not allowed continuation.');await dispatch(current,true);}),{disabled:busy||!op?.canResume}),
       button('Archive definitely unperformed request',()=>store.lock(async()=>{await store.archiveNotFound(p.request.requestId);pending=null;await draw();}),{disabled:busy||!canRetry||p.attempts.some(a=>a.state!=='REJECTED')}),
       button('Acknowledge saved unsuccessful outcome',()=>store.lock(async()=>{const current=await store.pending();if(current?.request.requestId!==p.request.requestId||!same(current.operation,op))throw new Error('Receive the current saved outcome first.');await store.received(p.request.requestId,{operation:op,acknowledged:true});pending=null;await draw();}),{disabled:busy||!terminal}),
       button('Download exact request and dispatch history',()=>download(p.request.requestId+'.json',p))),
     detail('Complete original body and attempts',p));
 }
 async function command(action,payload,form,basis=currentBasis()){return payloadSubmit('evidence.command',{action,payload},form,basis);}

 async function sourcesPane(){
   const f=await getForm('source',{file:'',inspection:null,definition:sourceDefinition()},{workspaceRevision:catalog.revision,caseId:null,caseVersionId:null}),d=f.body.definition;
   const change=(k,v)=>{d[k]=v;save(f);};
   const picker=el('input',{type:'file',onchange:e=>{fileSelection=e.target.files[0]||null;}});
   const uploaded=await store.read('upload:active');
   return [section('Original source library',
     note('Retain the complete selected original document or feature response. Source roles, dates, jurisdiction and coverage remain explicit; a completed local page is not proof of a complete publisher dataset.'),
     table([['Source',r=>button(r.title,async()=>{sourceResult={title:r.title,value:await ctx.request('/api/evidence/records/sources/'+encodeURIComponent(r.id))};await draw();})],
       ['Role / edition',r=>r.role+' · '+r.edition],['Effective / retrieved',r=>[r.effectiveDate||'Unknown',note(r.retrievedAt)]],
       ['Coverage',r=>r.coverageNotes||'Not declared'],['Original',r=>href('Download original file','/download/evidence/sources/'+encodeURIComponent(r.id))],
       ['Later edition',r=>button('Prepare successor',async()=>{
         const next=sourceDefinition();Object.assign(next,pick(r,SOURCE_FIELDS),{previousId:r.id,edition:'',retrievedAt:now()});
         f.body={file:'',inspection:null,definition:next};f.basis={workspaceRevision:catalog.revision,caseId:null,caseVersionId:null};await save(f);await draw();
       })]],catalog.sources)),
     section('Upload one original file',field('Complete original PDF, GeoJSON, Esri response or other source file',picker),
       note('Maximum 128 MiB. Exact 8 MiB chunks are checked again when the same upload is resumed.'),
       actions(button(uploaded?'Resume saved upload':'Upload selected original',()=>uploadEvidence(f)),
         button('Pause after current chunk',()=>{uploadPaused=true;}),
         button('Start a separate upload',()=>store.lock(async()=>{if(busy)throw new Error('Pause the current transfer first.');const old=await store.read('upload:active');if(old)await store.update('upload:history:'+old.manifest.uploadId,()=>old);await store.update('upload:active',()=>null);fileSelection=null;await draw();}))),
       uploaded&&detail('Original saved upload',uploaded)),
     section('Inspect and register the original source',
       bind(f,'file','Original absolute file path on this host'),
       button('Inspect exact original bytes',()=>command('source.inspect',{file:f.body.file},f,{workspaceRevision:catalog.revision,caseId:null,caseVersionId:null}),{disabled:busy||!!pending}),
       f.body.inspection&&detail('Inspected original file',f.body.inspection),
       ...receipts.filter(r=>r.request.action==='evidence.command'&&r.request.payload.action==='source.inspect'&&r.receipt?.result?.file===f.body.file).slice(-1).map(r=>button('Adopt retained exact inspection for this file',async()=>{f.body.inspection=clone(r.receipt.result);await save(f);await draw();})),
       grid(...[['title','Source title'],['seriesKey','Stable source series'],['edition','Issuer edition or explicit unknown'],['issuer','Original issuer'],['jurisdiction','Jurisdiction'],['sourceUri','Original source URL or URN']].map(([k,label])=>field(label,textInput(d[k],v=>change(k,v)))),
         field('Source role',select(d.role,catalog.roles.map(v=>[v,title(v)]),v=>change('role',v))),
         field('Previous original source',select(d.previousId||'',[['','First retained edition'],...choices().slice(1)],v=>change('previousId',v))),
         ...[['publishedDate','Published date'],['effectiveDate','Effective date']].map(([k,label])=>field(label,textInput(d[k],v=>change(k,v),{type:'date'}))),
         field('Original retrieval time with UTC offset',textInput(d.retrievedAt,v=>change('retrievedAt',v))),
         field('Publisher update time, when reported',textInput(d.publisherUpdatedAt,v=>change('publisherUpdatedAt',v))),
         field('Original media type',select(d.mediaType,['application/pdf','application/geo+json','application/json','text/csv','text/plain','application/octet-stream'].map(x=>[x,x]),v=>change('mediaType',v))),
         field('Original coordinate reference',textInput(d.coordinateReference,v=>change('coordinateReference',v)))),
       ...[['documentScope','Document scope'],['coverageNotes','Coverage and completeness'],['queryDescription','Original publisher query'],['notes','Source context and limitations']].map(([k,label])=>field(label,area(d[k],v=>change(k,v)))),
       button('Save complete source edition',()=>{
         const inspected=f.body.inspection;if(!inspected||inspected.file!==f.body.file)throw new Error('Inspect this exact selected file first.');
         const definition=clone(d);if(!definition.publisherUpdatedAt)delete definition.publisherUpdatedAt;
         return command('source.save',{file:inspected.file,bytes:inspected.bytes,sha256:inspected.sha256,definition},f,{workspaceRevision:catalog.revision,caseId:null,caseVersionId:null});
       },{disabled:busy||!!pending||!f.body.inspection})),
     basisPanel(f,{workspaceRevision:catalog.revision,caseId:null,caseVersionId:null})];
 }
 async function uploadEvidence(form){
   const file=fileSelection;if(!file||file.size<1||file.size>MAX_FILE)throw new Error('Select one nonempty original file of at most 128 MiB.');
   const captured=clone(form.body),g=generation;
   await store.lock(async()=>{
     busy=true;uploadPaused=false;
     try{
       let saved=await store.read('upload:active');
       const descriptor={path:file.name,bytes:file.size,sha256:null};
       if(saved&&!same(saved.manifest.files,[descriptor]))throw new Error('Re-select the exact original upload or explicitly start a separate upload.');
       if(!saved){saved={manifest:{uploadId:'upload-'+crypto.randomUUID(),kind:'evidence',files:[descriptor]},createdAt:now()};await store.update('upload:active',prior=>{if(prior)throw new Error('Another tab already started an upload.');return saved;});}
       const m=saved.manifest;await ctx.request('/api/uploads',{method:'POST',body:JSON.stringify(m)});
       for(let offset=0;offset<file.size;offset+=8*1024*1024){
         if(uploadPaused||!alive(g))throw new Error('Transfer paused. Re-select the same original file to resume its verified chunks.');
         const bytes=await file.slice(offset,offset+8*1024*1024).arrayBuffer();
         const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
         await ctx.request('/api/uploads/'+encodeURIComponent(m.uploadId)+'/file?path='+encodeURIComponent(file.name)+'&offset='+offset,
           {method:'PUT',body:bytes,headers:{'Content-Type':'application/octet-stream','X-Content-SHA256':hash}});
         say('Original source: '+Math.min(file.size,offset+bytes.byteLength)+' / '+file.size+' bytes verified.');
       }
       const completed=await ctx.request('/api/uploads/'+encodeURIComponent(m.uploadId)+'/complete',{method:'POST',body:'{}'});
       await store.update('upload:active',current=>{if(!same(current.manifest,m))throw new Error('The selected upload changed.');return {...current,completed};});
       if(alive(g)&&same(form.body,captured)){form.body.file=completed.file;form.body.inspection=null;await save(form);}
       say('Original upload saved. Inspect its exact bytes before registering the source.');
     }finally{busy=false;await draw();}
   });
 }
 async function featureRead(){
   const g=generation,t=++sourceRequest,selection={sourceId:featureSource,offset:featureOffset,limit:featureLimit};
   if(!selection.sourceId)throw new Error('Choose an original feature source.');
   const p=await ctx.request('/api/evidence/features?'+new URLSearchParams(selection));
   if(alive(g)&&t===sourceRequest&&selection.sourceId===featureSource&&selection.offset===featureOffset&&selection.limit===featureLimit){featurePage=p;selectedFeature=null;businessField='';await draw();}
 }
 function subjectDefinition(row){return {id:row.id,label:row.label,kind:row.kind,jurisdiction:row.jurisdiction,identity:row.identity,
   sourceReferences:row.sourceReferences.map(r=>pick(r,['sourceId','locator','sourcePageIndex0','printedPage','section'])),
   ...(row.feature?{feature:pick(row.feature,['sourceId','index','featureSha256','businessField'])}:{}),
   ...(row.mapObservation?{mapObservation:{requestId:row.mapObservation.requestId,featureId:row.mapObservation.feature.featureId,businessField:row.mapObservation.businessField}}:{})};}
 async function casePane(){
   const key='case:'+(caseId||'new'),initial=snapshot?{definition:{...pick(snapshot.case,CASE_FIELDS),sourceReferences:snapshot.case.sourceReferences.map(r=>pick(r,['sourceId','locator','sourcePageIndex0','printedPage','section'])),subjects:snapshot.case.subjects.map(subjectDefinition)}}:{definition:caseDefinition()};
   const f=await getForm(key,initial),d=f.body.definition;
   const change=()=>save(f);
   const form=section(snapshot?'Case and subject successor':'New case and original subjects',
     note('Case editions preserve their complete selected subjects. Parcel, structure, proposed improvement and area remain separate subjects with their own source and business identities.'),
     grid(...[['title','Case title'],['jurisdiction','Jurisdiction'],['asOf','Research as-of date']].map(([k,label])=>field(label,textInput(d[k],v=>{d[k]=v;change();},{...(k==='asOf'?{type:'date'}:{})})))),
     ...[['purpose','Decision being supported'],['proposedUse','Proposed use or improvement, including unknowns'],['scope','Research scope'],['assumptions','Assumptions and limitations']].map(([k,label])=>field(label,area(d[k],v=>{d[k]=v;change();}))),
     refs(f,d.sourceReferences,change,'Case source references'),
     ...d.subjects.map((s,index)=>el('fieldset',{},el('legend',{},'Subject '+(index+1)+': '+(s.label||'New')),
       grid(field('Stable subject ID',textInput(s.id,v=>{s.id=v;change();},{readOnly:!!s.feature||!!s.mapObservation})),
         field('Subject label',textInput(s.label,v=>{s.label=v;change();})),
         field('Subject kind',select(s.kind,['PARCEL','STRUCTURE','PROPOSED_IMPROVEMENT','AREA'].map(v=>[v,title(v)]),v=>{s.kind=v;change();})),
         field('Jurisdiction',textInput(s.jurisdiction,v=>{s.jurisdiction=v;change();})),
         field('Original business parcel or subject identity',textInput(s.identity,v=>{s.identity=v;change();}))),
       refs(f,s.sourceReferences,change,'This subject’s original source references'),
       s.feature&&detail('Original source feature binding',s.feature),s.mapObservation&&detail('Original native map-feature binding',s.mapObservation),
       button('Remove from this draft edition',async()=>{d.subjects.splice(index,1);change();await redraw();}))),
     button('Add subject from documentary evidence',async()=>{d.subjects.push({id:ident(),label:'',kind:'PARCEL',jurisdiction:d.jurisdiction,identity:'',sourceReferences:[]});change();await redraw();}),
     section('Professional and agency questions',...d.professionalQuestions.map((q,i)=>actions(field('Question '+(i+1),area(q,v=>{d.professionalQuestions[i]=v;change();})),button('Remove',async()=>{d.professionalQuestions.splice(i,1);change();await redraw();}))),
       button('Add question',async()=>{d.professionalQuestions.push('');change();await redraw();})),
     button(snapshot?'Save reviewed successor case':'Save original case',()=>command('case.save',{...(caseId?{caseId,previousId:f.basis.caseVersionId}:{}),definition:clone(d)},f),{disabled:busy||!!pending}));
   return [form,await featurePicker(f),await nativePicker(f),basisPanel(f,currentBasis()),snapshot&&section('Original case editions',button('Inspect complete original case and all history',async()=>{sourceResult={title:'Complete case and source history',value:clone(snapshot)};await draw();}),button('Download complete current case snapshot',()=>download('evidence-case-'+caseId+'.json',snapshot)))];
 }
 async function featurePicker(form){
   const geo=(catalog.sources||[]).filter(r=>['application/geo+json','application/json'].includes(r.mediaType));
   const properties=selectedFeature?.properties||{};
   return section('Bind a subject to an original source feature',
     grid(field('Original GeoJSON or Esri FeatureSet response',select(featureSource,[['','Choose original feature response'],...geo.map(r=>[r.id,r.title+' · '+r.edition])],v=>{featureSource=v;featureOffset=0;featurePage=null;++sourceRequest;draw();})),
       field('Rows per local page',select(featureLimit,[25,50,100].map(v=>[v,String(v)]),v=>{featureLimit=Number(v);featurePage=null;++sourceRequest;draw();}))),
     button('Read exact local feature page',featureRead),
     featurePage&&detail('Original format, response coverage and coordinate reference',{format:featurePage.format,coverage:featurePage.coverage,coordinateReference:featurePage.coordinateReference,originalCrs:featurePage.originalCrs,totalRetainedFeatures:featurePage.total}),
     featurePage&&table([['Position / original feature ID',r=>r.index+' / '+clean(r.featureId)],['Geometry',r=>r.geometryType||'Absent'],['Original properties',r=>detail('Inspect complete properties',r.properties)],
       ['Select',r=>button('Use original feature',async()=>{selectedFeature=r;businessField='';await draw();})]],featurePage.items),
     featurePage&&actions(button('Previous local page',()=>{featureOffset=Math.max(0,featureOffset-featureLimit);return featureRead();},{disabled:featureOffset===0}),
       note((featurePage.offset+1)+'–'+(featurePage.offset+featurePage.items.length)+' of '+featurePage.total+' retained features'),
       button('Next local page',()=>{featureOffset+=featureLimit;return featureRead();},{disabled:featurePage.complete})),
     selectedFeature&&field('Actual business parcel / subject identity field',select(businessField,[['','Choose original nonempty field'],...Object.entries(properties).filter(([,v])=>v!==null&&v!=='').map(([k,v])=>[k,k+' = '+clean(v)])],v=>{businessField=v;})),
     selectedFeature&&button('Add this exact source feature as a subject',async()=>{
       if(!businessField||properties[businessField]===null||properties[businessField]==='')throw new Error('Choose the original nonempty business identity field.');
       const s={id:ident(),label:clean(properties[businessField]),kind:'PARCEL',jurisdiction:form.body.definition.jurisdiction,identity:clean(properties[businessField]),
         sourceReferences:[{sourceId:featureSource,locator:'Original feature position '+selectedFeature.index+'; '+businessField+' = '+clean(properties[businessField])}],
         feature:{sourceId:featureSource,index:selectedFeature.index,featureSha256:selectedFeature.featureSha256,businessField}};
       form.body.definition.subjects.push(s);await save(form);await draw();
     }),note('A saved feature response may be partial. Preserve the publisher’s transfer-limit flag and selected query; the interface never treats the last local page as whole-dataset completeness.'));
 }
 async function nativePicker(form){
   const f=await getForm('native-binding:'+(caseId||'new'),{requestId:'',projectId:'',layerId:'',offset:'0',limit:'25'},currentBasis());
   const projects=catalog.nativeProjects||[],project=projects.find(p=>p.id===f.body.projectId);
   const rows=nativeRead?.result?.rows||[],fields=nativeRead?.result?.fields||[];
   return section('Bind an actual native map observation',
     note('Use a saved QGIS map and real native feature read. Bounding-box selection records which features were returned; spatial predicates and intersections are recorded separately.'),
     grid(field('Original saved QGIS project',select(f.body.projectId,[['','Choose original map'],...projects.map(p=>[p.id,p.id])],v=>{set(f,'projectId',v);set(f,'layerId','');redraw();})),
       field('Original map layer',select(f.body.layerId,[['','Choose original layer'],...(project?.layers||[]).map(l=>[l.id,l.label||l.id])],v=>set(f,'layerId',v))),
       bind(f,'offset','Native row offset',{type:'number',min:0,step:1}),bind(f,'limit','Native row limit',{type:'number',min:1,max:100,step:1})),
     button('Run original native feature read',()=>payloadSubmit('map.features',{projectId:f.body.projectId,layerId:f.body.layerId,offset:Number(f.body.offset),limit:Number(f.body.limit)},f),{disabled:busy||!!pending||!ctx.getCapabilities().nativeRuntimeSelected}),
     bind(f,'requestId','Completed original map.features request ID'),
     button('Read saved native observation',async()=>{const g=generation,id=f.body.requestId;const op=await ctx.request('/api/operations/'+encodeURIComponent(id));if(!alive(g)||f.body.requestId!==id)return;if(op.status!=='COMPLETED'||op.input.action!=='map.features')throw new Error('Choose a completed original map.features request.');nativeRead=op;selectedNative=null;businessField='';await draw();}),
     nativeRead&&detail('Original native source / page / CRS readback',{requestId:nativeRead.requestId,input:nativeRead.input,result:{...nativeRead.result,rows:undefined}}),
     nativeRead&&table([['Native feature ID',r=>r.featureId],['Original values',r=>detail('Complete native field values',Object.fromEntries(fields.map((col,i)=>[col.name,r.values[i]])))],
       ['Bind',r=>button('Select native feature',async()=>{selectedNative=r;businessField='';await draw();})]],rows),
     selectedNative&&field('Actual returned business identity field',select(businessField,[['','Choose a nonempty original field'],...fields.map((f,i)=>[f.name,i]).filter(([,i])=>selectedNative.values[i]!==null&&selectedNative.values[i]!=='').map(([name,i])=>[name,name+' = '+clean(selectedNative.values[i])])],v=>{businessField=v;})),
     selectedNative&&button('Add exact native feature as a subject',async()=>{
       const index=fields.findIndex(f=>f.name===businessField);if(index<0)throw new Error('Choose an actual returned business identity field.');
       form.body.definition.subjects.push({id:ident(),label:clean(selectedNative.values[index]),kind:'PARCEL',jurisdiction:form.body.definition.jurisdiction,identity:clean(selectedNative.values[index]),sourceReferences:[],
         mapObservation:{requestId:nativeRead.requestId,featureId:selectedNative.featureId,businessField}});
       await save(form);await draw();
     }),note('Add the subject’s exact documentary/source references before saving the case. The server reopens the original request and map binding. Native feature IDs are never substituted for the business parcel ID.'),basisPanel(f,currentBasis()));
 }

 function normalizedFinding(row){return {...pick(row,FINDING_FIELDS),sourceReferences:row.sourceReferences.map(r=>pick(r,['sourceId','locator','sourcePageIndex0','printedPage','section'])),answerReferences:(row.answerReferences||[]).map(r=>pick(r,['sourceId','locator','sourcePageIndex0','printedPage','section']))};}
 function findingFields(form,d,changed){
   return [
     grid(field('Finding or question title',textInput(d.title,v=>{d.title=v;changed();})),
       field('Classification',select(d.classification,catalog.classifications.map(v=>[v,title(v)]),v=>{d.classification=v;changed();redraw();})),
       field('Original review status',select(d.status,catalog.statuses.map(v=>[v,title(v)]),v=>{d.status=v;changed();redraw();}))),
     ...[['statement','Source fact, interpretation or exact question'],['applicability','Applicability to the selected subjects and proposed use'],['assumptions','Assumptions and limitations']].map(([k,label])=>field(label,area(d[k],v=>{d[k]=v;changed();},4))),
     el('fieldset',{},el('legend',{},'Exact subjects covered'),
       ...(snapshot?.case?.subjects||[]).map(s=>field(s.label+' · '+s.kind+' · '+s.identity,el('input',{type:'checkbox',checked:d.subjectIds.includes(s.id),onchange:e=>{d.subjectIds=e.target.checked?[...new Set([...d.subjectIds,s.id])]:d.subjectIds.filter(v=>v!==s.id);changed();}})))),
     refs(form,d.sourceReferences,changed,'Finding source and structured document references'),
     grid(field('Named reviewer',textInput(d.reviewer,v=>{d.reviewer=v;changed();})),
       field('Review time with UTC offset',textInput(d.reviewedAt,v=>{d.reviewedAt=v;changed();})),
       field('Responsible agency / professional role',textInput(d.responsibleRole,v=>{d.responsibleRole=v;changed();})),
       field('Action due date',textInput(d.dueDate||'',v=>{d.dueDate=v;changed();},{type:'date'}))),
     field('Specific next action or recorded completion',area(d.nextAction,v=>{d.nextAction=v;changed();})),
     field('Answer, when received',area(d.answer||'',v=>{d.answer=v;changed();})),
     refs(form,d.answerReferences||=[],changed,'Original answer sources'),
     field('Reason for this successor or correction',area(d.correctionReason||'',v=>{d.correctionReason=v;changed();}))
   ];
 }
 async function findingsPane(){
   if(!snapshot)return [section('Select or create a case',note('Save a case with its complete subjects and sources first.'))];
   const rows=snapshot.currentFindings||[],f=await getForm('finding:'+caseId,{findingId:null,previousId:null,definition:findingDefinition()},currentBasis({findingVersionId:null}));
   const expected=currentBasis({findingVersionId:f.body.findingId?rows.find(r=>r.findingId===f.body.findingId)?.id||null:null});
   const review=new Map((snapshot.findingReview||[]).map(r=>[r.findingVersionId,r]));
   return [section('Current findings and named actions',
     note('Saved review status and current source-review state are shown independently. A newer case or source never silently upgrades an earlier interpretation.'),
     table([['Finding',r=>button(r.title,async()=>{
       if(!same(f.body,{findingId:null,previousId:null,definition:findingDefinition()}))sourceResult={title:'Previous finding draft retained',value:clone(f)};
       const k='finding-edit:'+caseId+':'+r.findingId;const next=await getForm(k,{findingId:r.findingId,previousId:r.id,definition:normalizedFinding(r)},currentBasis({findingVersionId:r.id}));
       activeFindingKey=k;await draw();
     })],['Class / status',r=>r.classification+' · '+r.status],['Current source review',r=>[review.get(r.id)?.state||'Retained original review',detail('Source review reasons',review.get(r.id)||{})]],
       ['Reviewer / next action',r=>[r.reviewer,note(r.nextAction)]],['Exact version',r=>button('Inspect original finding',async()=>{sourceResult={title:r.title,value:await ctx.request('/api/evidence/records/findings/'+r.id)};await draw();})]],rows),
     actions(button('Prepare a new finding',async()=>{activeFindingKey='finding-new:'+caseId+':'+crypto.randomUUID();await getForm(activeFindingKey,{findingId:null,previousId:null,definition:findingDefinition()},currentBasis({findingVersionId:null}));await draw();}),
       button('Read all original finding editions',async()=>{sourceResult={title:'Complete finding history',value:await listed('findings?history=1')};await draw();}))),
     await findingEditor(activeFindingKey||'finding:'+caseId,f,expected)];
 }
 let activeFindingKey='';
 async function findingEditor(key,fallback){
   const f=key===fallback.key?fallback:forms.get(key)||await getForm(key,{findingId:null,previousId:null,definition:findingDefinition()},currentBasis({findingVersionId:null}));
   const actual=f.body.findingId?snapshot.currentFindings.find(r=>r.findingId===f.body.findingId):null;
   const basis=currentBasis({findingVersionId:actual?.id||null}),d=f.body.definition;
   return section(f.body.findingId?'Review successor finding':'Prepare original finding',
     ...findingFields(f,d,()=>save(f)),
     button('Save complete named review',()=>command('finding.save',{caseId,caseVersionId:f.basis.caseVersionId,
       ...(f.body.findingId?{findingId:f.body.findingId,previousId:f.basis.findingVersionId}:{}),definition:clone(d)},f,basis),{disabled:busy||!!pending}),
     basisPanel(f,basis));
 }
 async function successionPane(){
   if(!snapshot)return [section('Select a case',note('A source-succession review belongs to one exact case.'))];
   const f=await getForm('succession:'+caseId,{leftSourceId:'',rightSourceId:'',decisions:[],note:''}),v=f.body;
   const savedComparison=comparison||v.comparison;
   const c=savedComparison&&same(savedComparison.payload,{caseId,leftSourceId:v.leftSourceId,rightSourceId:v.rightSourceId})?savedComparison.result:null;
   const rightChoices=catalog.sources.filter(r=>r.id!==v.leftSourceId&&r.seriesKey===catalog.sources.find(s=>s.id===v.leftSourceId)?.seriesKey);
   return [section('Compare complete original source editions',
     note('Record a decision for every affected finding, including findings on subjects that cite the earlier source. Case and subject updates remain explicit case successors.'),
     grid(field('Earlier source',select(v.leftSourceId,choices(),x=>{set(f,'leftSourceId',x);set(f,'rightSourceId','');comparison=null;redraw();})),
       field('Later edition from the same declared series',select(v.rightSourceId,[['','Choose later edition'],...rightChoices.map(r=>[r.id,r.title+' · '+r.edition])],x=>{set(f,'rightSourceId',x);comparison=null;redraw();}))),
     button('Inspect all impacted current decisions',()=>command('source.compare',{caseId,leftSourceId:v.leftSourceId,rightSourceId:v.rightSourceId},f),{disabled:busy||!!pending}),
     c&&detail('Exact changed metadata, file identities and impacted subjects',c),
     c&&note(c.sameOriginalBytes?'Both editions retain identical original bytes; applicability still needs named review.':'The editions retain different original bytes.'),
     ...(c?.affectedFindings||[]).map(row=>{
       const decision=v.decisions.find(d=>d.findingVersionId===row.id);if(!decision)return note('Receive the complete original comparison to prepare '+row.title);
       return section(row.title,
         note(row.classification+' · '+row.status+' · original version '+row.id),
         field('Treatment of this exact finding',select(decision.decision,['KEEP_EARLIER','REVIEW_REQUIRED','ADOPT_LATER','WITHDRAW'].map(x=>[x,title(x)]),async value=>{
           decision.decision=value;if(['ADOPT_LATER','WITHDRAW'].includes(value)&&!decision.replacement){
             const original=snapshot.currentFindings.find(r=>r.id===row.id)||await ctx.request('/api/evidence/records/findings/'+row.id);
             decision.replacement=normalizedFinding(original);
           }
           if(value==='WITHDRAW')decision.replacement.status='WITHDRAWN';await save(f);await draw();
         })),
         field('Specific reason for this source decision',area(decision.reason,x=>{decision.reason=x;save(f);})),
         ['ADOPT_LATER','WITHDRAW'].includes(decision.decision)&&decision.replacement&&el('div',{},...findingFields(f,decision.replacement,()=>save(f))),
         decision.decision==='ADOPT_LATER'&&note('The complete replacement must cite the exact later source and its locator. No reference is replaced automatically.'));
     }),
     c&&field('Complete succession review note',area(v.note,x=>set(f,'note',x))),
     c&&button('Save every reviewed source decision',()=>{
       const decisions=v.decisions.map(r=>({findingVersionId:r.findingVersionId,decision:r.decision,reason:r.reason,
         ...(['ADOPT_LATER','WITHDRAW'].includes(r.decision)?{replacement:clone(r.replacement)}:{})}));
       return command('succession.save',{caseId,leftSourceId:v.leftSourceId,rightSourceId:v.rightSourceId,comparisonSha256:c.comparisonSha256,decisions,note:v.note},f);
     },{disabled:busy||!!pending}),
     basisPanel(f,currentBasis())),
     section('Original succession history',table([['Recorded',r=>r.createdAt],['Analyst',r=>r.actor],['Review',r=>detail('Complete original succession',r)]],await listed('successions')))];
 }
 async function spatialPane(){
   if(!snapshot)return [section('Select a case',note('Save the exact source-bound subjects first.'))];
   const f=await getForm('spatial:'+caseId,{leftSubjectId:'',rightSubjectId:'',measurementCrs:'',purpose:''}),v=f.body;
   const native=snapshot.case.subjects.filter(s=>s.mapObservation),options=[['','Choose native-bound subject'],...native.map(s=>[s.id,s.label+' · '+s.kind+' · '+s.identity])];
   const rows=await listed('observations');
   return [section('Actual native spatial observations',
     note('Reopen the retained QGIS projects and exact feature geometries. Select an explicit projected measurement CRS; the original native engine records its units, transformations, predicates and intersection.'),
     grid(field('Left subject',select(v.leftSubjectId,options,x=>set(f,'leftSubjectId',x))),
       field('Right subject',select(v.rightSubjectId,options,x=>set(f,'rightSubjectId',x))),
       bind(f,'measurementCrs','Reviewed projected measurement CRS',{placeholder:'Authority code or full original WKT'})),
     bind(f,'purpose','Purpose and scope of this observation',{multiline:true}),
     button('Run native geometry observation',()=>payloadSubmit('evidence.spatial',{caseId,caseVersionId:f.basis.caseVersionId,...clone(v)},f),{disabled:busy||!!pending||!ctx.getCapabilities().nativeRuntimeSelected}),
     note('Planar intersection is a geometric observation. Source coverage, effective dates, agency applicability and professional conclusions stay explicit in the case findings.'),basisPanel(f,currentBasis())),
     section('Retained geometric observations',table([['Recorded / analyst',r=>[r.createdAt,note(r.actor)]],['Subjects',r=>r.leftSubjectId+' / '+r.rightSubjectId],
       ['Intersects',r=>clean(r.result?.intersects)],['Intersection area',r=>clean(r.result?.intersectionArea)+' '+clean(r.result?.areaUnit)],
       ['Original observation',r=>detail('Full geometry, native source and method',r)]],rows))];
 }
 async function renders(){
   const rows=[];let offset=0;while(true){const page=await ctx.request('/api/operations?offset='+offset+'&limit=100');
     rows.push(...page.items.filter(r=>r.action==='map.render'&&r.status==='COMPLETED'));if(page.complete||!page.hasMore&&page.offset+page.items.length>=page.total)break;
     if(!page.items.length)break;offset+=page.items.length;
   }return rows;
 }
 let renderChoices=[];
 async function reportsPane(){
   if(!snapshot)return [section('Select a case',note('Reports freeze the complete selected case and all source/finding history.'))];
   const f=await getForm('report:'+caseId,{title:'',interpretation:'',mapRequestIds:[]}),rows=await listed('reports');
   const exp=await getForm('project-export',{directory:''},{workspaceRevision:catalog.revision,caseId:null,caseVersionId:null});
   return [section('Freeze the complete evidence report',bind(f,'title','Report title'),bind(f,'interpretation','Full interpretation and remaining questions',{multiline:true,rows:6}),
     actions(button('Read existing completed map renders',async()=>{renderChoices=await renders();await draw();}),button('Open native Maps workspace',()=>ctx.openTab('maps'))),
     note('Select exact completed map renders. The report retains original image bytes and the complete original render request/result; it never silently chooses the latest map.'),
     ...renderChoices.map(r=>field(r.requestId,el('input',{type:'checkbox',checked:f.body.mapRequestIds.includes(r.requestId),onchange:e=>{
       f.body.mapRequestIds=e.target.checked?[...new Set([...f.body.mapRequestIds,r.requestId])]:f.body.mapRequestIds.filter(x=>x!==r.requestId);save(f);
     }}))),
     f.body.mapRequestIds.length>0&&detail('Selected original render request IDs',f.body.mapRequestIds),
     button('Build complete frozen report',()=>command('report.build',{caseId,caseVersionId:f.basis.caseVersionId,title:f.body.title,interpretation:f.body.interpretation,mapRequestIds:clone(f.body.mapRequestIds)},f),{disabled:busy||!!pending}),
     basisPanel(f,currentBasis())),
     section('Saved immutable reports',table([['Report',r=>r.title],['Source revision',r=>r.sourceRevision],['Created',r=>r.createdAt],['Original files',r=>actions(
       ...[['zip','Complete report ZIP'],['html','Readable report'],['json','Full case JSON'],['findings','Findings CSV'],['actions','Actions CSV']].map(([kind,label])=>href(label,'/download/evidence/reports/'+r.id+'/'+kind)))],['Receipt',r=>detail('Frozen manifest and archive',r)]],rows)),
     section('Complete editable QGIS workspace handover',
       note('The complete original project export includes source files, all case/finding editions, actual native maps and observations, reports, original operation history and receiving software.'),
       bind(exp,'directory','Optional new archive directory on this host'),
       button('Export complete editable workspace',()=>payloadSubmit('project.export',exp.body.directory?{directory:exp.body.directory}:{},exp,{workspaceRevision:catalog.revision,caseId:null,caseVersionId:null}),{disabled:busy||!!pending}),
       ...receipts.filter(r=>r.request.action==='project.export'&&r.receipt?.operation?.status==='COMPLETED').map(r=>href('Download original complete project '+r.request.requestId,'/download/operations/'+r.request.requestId+'/project')),
       basisPanel(exp,{workspaceRevision:catalog.revision,caseId:null,caseVersionId:null}),
       button('Open original project receiving',()=>ctx.openTab('transfers')))];
 }
 async function openSavedDraft(row){
   await writeTail;const name=row.key.slice('draft:'.length),saved=await store.read(row.key);
   if(!saved)throw new Error('The saved draft is unavailable.');
   const caseBound=/^(address|case|finding|finding-edit|finding-new|native-binding|succession|spatial|report):/.test(name);
   if(caseBound){const selected=saved.basis?.caseId||'';if(selected&&!catalog.cases.some(c=>c.caseId===selected))throw new Error('The retained original case is unavailable in this workspace. Download this draft before receiving its original project.');
     await changeCase(selected);}
   forms.set(name,{...saved,key:name,storageError:null});
   if(name.startsWith('finding')){view='Findings';activeFindingKey=name;}
   else if(name.startsWith('address:'))view='Address QA';
   else if(name==='source')view='Sources';
   else if(name.startsWith('case:')||name.startsWith('native-binding:'))view='Case & subjects';
   else if(name.startsWith('succession:'))view='Later sources';
   else if(name.startsWith('spatial:'))view='Spatial';
   else if(name.startsWith('report:')||name==='project-export')view='Reports';
   else throw new Error('This draft remains preserved for download; its original editor is unavailable.');
   await draw();
 }

 // Address QA is an original-source review pane in this same workspace/journal.
 let addressCatalogue=null,addressSelection='',addressSummary=null,addressPage=null,addressMembers=null;
 let addressTab='candidates',addressSearch='',addressRule='',addressOffset=0,addressLimit=25,addressFlight=0,addressNavigation=0;
 const addressFields=['identity','number','street','building','unitType','unit','postalCity','region','postalCode','municipality','county','authority','sourceDate'];
 function addressInitial(){
   return {title:'',jurisdiction:'',asOf:'',scope:'',sourceIds:[],metadataSourceId:'',
     inventory:{openingCount:'',openingIds:'',closingCount:'',closingIds:''},
     mapping:Object.fromEntries(addressFields.map(k=>[k,''])),
     required:['identity','number','street','postalCity','region','postalCode'],
     rules:['ADDRESS_SIGNATURE','EXACT_POINT','REPEATED_IDENTITY','MISSING_REQUIRED','POINT_GEOMETRY']};
 }
 function addressReset(){addressSelection='';addressSummary=null;addressPage=null;addressMembers=null;addressOffset=0;++addressFlight;}
 function addressURL(path,values){return '/api/evidence/address/'+path+'?'+new URLSearchParams(values);}
 async function addressRead(sourceId,offset=0){
   const g=generation,flight=++addressFlight,selectedCase=caseId,tab=addressTab,search=addressSearch,rule=addressRule,limit=addressLimit;
   const summary=await ctx.request(addressURL('summary',{sourceId}));
   const page=await ctx.request(addressURL(tab,{sourceId,offset,limit,search,rule}));
   if(!alive(g)||flight!==addressFlight||selectedCase!==caseId||tab!==addressTab||search!==addressSearch||rule!==addressRule||limit!==addressLimit)return;
   addressSelection=sourceId;addressSummary=summary;addressPage=page;addressOffset=offset;addressMembers=null;
   await draw();
 }
 async function addressMemberPage(candidate,offset=0){
   const g=generation,flight=++addressFlight,sourceId=addressSelection,selectedCase=caseId,limit=addressLimit;
   const page=await ctx.request(addressURL('members',{sourceId,candidateId:candidate.id,offset,limit}));
   if(!alive(g)||flight!==addressFlight||sourceId!==addressSelection||selectedCase!==caseId||limit!==addressLimit)return;
   addressMembers={candidate,page};await draw();
 }
 function addressRowTable(rows){
   return table([
     ['Original record',r=>[clean(r.objectId),note(r.id),note('Source position '+r.sourceIndex)]],
     ['Address / unit',r=>[clean(r.values.number)+' '+clean(r.values.street),
       note('Building '+clean(r.values.building)+' · '+clean(r.values.unitType)+' '+clean(r.values.unit))]],
     ['Postal / administrative',r=>[clean(r.values.postalCity)+' · '+clean(r.values.region)+' '+clean(r.values.postalCode),
       note('Municipality '+clean(r.values.municipality)+' · County '+clean(r.values.county))]],
     ['Selected identity / source date',r=>[clean(r.values.identity),note(clean(r.values.sourceDate))]],
     ['Screening',r=>[r.candidateIds.length+' candidates',note(r.missingRequired.length?'Missing selected fields: '+r.missingRequired.join(', '):'Selected required fields present'),
       note(r.pointValid?'Original finite point':'Point geometry needs review')]],
     ['Original evidence',r=>[href('Download exact source','/download/evidence/sources/'+encodeURIComponent(r.sourceId)),
       detail('Complete saved row, raw mapped values and feature identity',r)]]
   ],rows);
 }
 async function addressFinding(candidate){
   if(!snapshot||addressSummary?.caseId!==caseId)throw new Error('Select this analysis’s original case before preparing a finding.');
   const sourceId=addressSelection,summary=clone(addressSummary),selectedCase=caseId,g=generation;
   const navigation=++addressNavigation,selectionFlight=addressFlight;
   const stillSelected=()=>alive(g)&&caseId===selectedCase&&addressSelection===sourceId&&addressFlight===selectionFlight&&addressNavigation===navigation;
   const existing=(snapshot.currentFindings||[]).find(r=>r.sourceReferences.some(ref=>ref.sourceId===sourceId&&ref.locator.includes(candidate.id)));
   if(existing){
     const savedKey='finding-edit:'+selectedCase+':'+existing.findingId;
     await getForm(savedKey,{findingId:existing.findingId,previousId:existing.id,definition:normalizedFinding(existing)},currentBasis({findingVersionId:existing.id}));
     if(!stillSelected())return;
     activeFindingKey=savedKey;view='Findings';++generation;await draw();return;
   }
   const key='finding-new:'+selectedCase+':address-'+sourceId+':'+candidate.id;
   const definition={...findingDefinition(),title:title(candidate.rule)+' — '+candidate.recordCount+' retained records',
     classification:'PROFESSIONAL_QUESTION',statement:candidate.meaning+' Candidate '+candidate.id+
       ' contains '+candidate.recordCount+' original records in the complete saved analysis '+sourceId+'.',
     applicability:summary.scope,assumptions:summary.limitation,subjectIds:['address-cohort'],
     sourceReferences:[{sourceId,locator:'candidates[id='+candidate.id+']; complete rowIds and original row/source identities'},
       ...summary.sources.filter(s=>summary.pages.some(p=>p.sourceId===s.sourceId)).map(s=>({sourceId:s.sourceId,locator:'Original feature file; exact candidate positions are retained in '+sourceId}))],
     reviewer:String(ctx.getActor()||'').trim(),nextAction:'Inspect every selected record and ask the responsible source owner to confirm the interpretation; retain the answer or explicit disposition.',
     responsibleRole:'Address data steward'};
   await writeTail;
   if(!stillSelected())return;
   await getForm(key,{findingId:null,previousId:null,definition},currentBasis({findingVersionId:null}));
   if(!stillSelected())return;
   activeFindingKey=key;view='Findings';++generation;await draw();
 }
 async function addressPane(){
   const g=generation,selectedCase=caseId;
   const cat=await ctx.request('/api/evidence/address/catalog'+(caseId?'?caseId='+encodeURIComponent(caseId):''));
   if(!alive(g)||caseId!==selectedCase)return [];
   addressCatalogue=cat;
   if(addressSelection&&!cat.analyses.some(r=>r.id===addressSelection))addressReset();
   const f=await getForm('address:'+(caseId||'new'),addressInitial(),currentBasis());
   const b=f.body,profile=cat.profiles[0],basis=currentBasis();
   const selectedSources=new Set(b.sourceIds);
   const sourceChoices=choices();
   const inventoryKeys=[['openingCount','Opening count'],['openingIds','Opening complete object IDs'],['closingCount','Closing count'],['closingIds','Closing complete object IDs']];
   const config=section('Prepare a source-bound address review',
     note('Use Sources to upload and retain each original feature response, metadata document and inventory observation. This analysis reads their exact saved bytes and creates a normal evidence case edition. It never edits an address.'),
     basisPanel(f,basis),
     grid(bind(f,'title','Review title'),bind(f,'jurisdiction','Jurisdiction'),bind(f,'asOf','Review as-of date',{type:'date'})),
     bind(f,'scope','Exact query, source scope and intended review',{multiline:true,rows:3}),
     section('Original feature files',
       note('Choose only the complete original GeoJSON or Esri FeatureSet pages for this cohort. Metadata and ID inventories are selected below.'),
       ...catalog.sources.map(s=>field(s.title+' · '+s.edition,el('input',{type:'checkbox',checked:selectedSources.has(s.id),
         onchange:e=>{b.sourceIds=e.target.checked?[...b.sourceIds,s.id]:b.sourceIds.filter(id=>id!==s.id);save(f);}}))),
       !catalog.sources.length&&note('No saved sources. Open Sources and retain the originals first.')),
     field('Original layer metadata',select(b.metadataSourceId,sourceChoices,v=>{b.metadataSourceId=v;save(f);})),
     section('Coverage observations',
       note('Choose all four observations to compare the declared query membership. Leave all four empty for explicitly limited retained-file coverage. Matching IDs do not prove a transactional value snapshot.'),
       grid(...inventoryKeys.map(([k,label])=>field(label,select(b.inventory[k],sourceChoices,v=>{b.inventory[k]=v;save(f);}))))),
     section('Explicit field mapping',
       note(cat.normalization),
       actions(button('Use ASDI address field mapping',async()=>{b.mapping=clone(profile.mapping);b.required=clone(profile.required);b.rules=clone(profile.rules);await save(f);await draw();})),
       grid(...addressFields.map(k=>field(title(k),textInput(b.mapping[k],v=>{b.mapping[k]=v;save(f);},{placeholder:'Original source field name'})))),
       ...profile.sourceNotes.map(note)),
     section('Analyst screening policy',
       note('Required fields are your selected review policy. These choices do not assert an issuer standard. The address signature includes building and unit fields.'),
       grid(...addressFields.map(k=>field('Require '+title(k),el('input',{type:'checkbox',checked:b.required.includes(k),
         onchange:e=>{b.required=e.target.checked?[...b.required,k]:b.required.filter(v=>v!==k);save(f);}})))),
       grid(...cat.rules.map(k=>field(title(k),el('input',{type:'checkbox',checked:b.rules.includes(k),
         onchange:e=>{b.rules=e.target.checked?[...b.rules,k]:b.rules.filter(v=>v!==k);save(f);}}))))),
     note(cat.limitation),
     note('Limits: '+cat.limits.rows.toLocaleString()+' original records and '+(cat.limits.bytes/1024/1024)+' MiB of selected original JSON.'),
     actions(button(caseId?'Save analysis and next case edition':'Save analysis and create case',async()=>{
       const payload=clone(b);payload.metadataSourceId=payload.metadataSourceId||null;
       if(Object.values(payload.inventory).every(v=>!v))payload.inventory={};
       payload.caseId=caseId||null;payload.caseVersionId=snapshot?.case?.id||null;
       await command('address.analyze',payload,f,basis);
     },{disabled:busy||!!pending||!!f.storageError||stale(f,basis)})));
   const pane=[section('Address QA',note('Candidate detection, complete original records and named source decisions in the same evidence workspace.'),
     table([['Saved analysis',r=>button(r.title,()=>addressRead(r.id))],['Retained at / analyst',r=>[r.createdAt,note(r.actor)]],
       ['Original derived data',r=>href('Download complete analysis JSON','/download/evidence/sources/'+encodeURIComponent(r.id))]],cat.analyses.slice().reverse()))];
   if(addressSummary&&addressPage){
     const s=addressSummary,p=addressPage;
     pane.push(section(s.title,
       note(s.summary.rows+' records · '+s.summary.candidateGroups+' candidate groups · '+s.summary.rowsWithCandidates+' records with candidates'),
       note(s.inventory.meaning),
       s.inventory.objectIdSetsMatch===false&&el('p',{class:'ev-warning',role:'alert'},'Coverage observations do not reconcile. Review the retained opening, received and closing inventories.'),
       detail('Exact policy, original source identities and coverage',s),
       actions(href('Download complete analysis','/download/evidence/sources/'+encodeURIComponent(addressSelection)),
         ...((snapshot?.sources||[]).filter(x=>x.edition===s.requestId&&x.mediaType.startsWith('text/csv')).map(x=>href(x.filename,'/download/evidence/sources/'+encodeURIComponent(x.id)))),
         s.caseId!==caseId&&button('Open original analysis case',async()=>{const sourceId=addressSelection;await changeCase(s.caseId);view='Address QA';await addressRead(sourceId);})),
       grid(field('Review view',select(addressTab,[['candidates','Candidates'],['rows','All original records']],v=>{addressTab=v;addressOffset=0;addressPage=null;++addressFlight;draw().catch(e=>say(e.message,true));})),
         field('Search original values',textInput(addressSearch,v=>{addressSearch=v;++addressFlight;})),
         field('Rule filter',select(addressRule,[['','All rules'],...cat.rules.map(r=>[r,title(r)])],v=>{addressRule=v;++addressFlight;})),
         field('Rows per page',select(addressLimit,[[25,'25'],[50,'50'],[100,'100']],v=>{addressLimit=Number(v);++addressFlight;}))),
       note('The table is the last explicitly read page. Changed search and rule controls apply when you choose Read selected source page.'),
       actions(button('Read selected source page',()=>addressRead(addressSelection,0))),
       addressTab==='rows'?addressRowTable(p.items):table([
         ['Candidate',c=>[title(c.rule),note(c.id)]],['Original records',c=>c.recordCount],
         ['Meaning',c=>c.meaning],['Review',c=>actions(button('Inspect all candidate records',()=>addressMemberPage(c)),
           button('Prepare named finding',()=>addressFinding(c),{disabled:s.caseId!==caseId||!snapshot}))],
         ['Sample',c=>detail('First '+c.sample.length+' of '+c.recordCount+' records; use Inspect all candidate records for every member',c.sample)]
       ],p.items,'No candidates match this page and filter.'),
       note('Showing '+(p.total?p.offset+1:0)+'–'+Math.min(p.total,p.offset+p.items.length)+' of '+p.total+' matched '+(addressTab==='rows'?'records':'candidates')+'.'),
       actions(button('Previous address page',()=>addressRead(addressSelection,Math.max(0,p.offset-addressLimit)),{disabled:p.offset===0}),
         button('Next address page',()=>addressRead(addressSelection,p.offset+p.limit),{disabled:p.complete}))));
   }else if(addressSelection){
     pane.push(section('Read selected analysis',note('Your source selection remains retained; read the current page to apply changed filters.'),
       actions(button('Read selected source page',()=>addressRead(addressSelection,0)))));
   }
   if(addressMembers){
     const {candidate,page}=addressMembers;
     pane.push(section('All members of '+candidate.id,note(candidate.meaning),addressRowTable(page.items),
       note('Showing '+(page.total?page.offset+1:0)+'–'+Math.min(page.total,page.offset+page.items.length)+' of '+page.total+' original candidate members.'),
       actions(button('Previous candidate members',()=>addressMemberPage(candidate,Math.max(0,page.offset-addressLimit)),{disabled:page.offset===0}),
         button('Next candidate members',()=>addressMemberPage(candidate,page.offset+page.limit),{disabled:page.complete}),
         button('Close candidate members',async()=>{addressMembers=null;++addressFlight;await draw();}))));
   }
   pane.push(config);
   return pane;
 }

 async function recoveryPane(){
   const savedDrafts=(await store.all()).filter(r=>r.key.startsWith('draft:'));
   const picker=el('input',{type:'file',accept:'.json,application/json',onchange:async e=>{
     const file=e.target.files[0];if(!file)return;const g=generation;await writeTail;const before=await store.exportRecovery();
     try{if(file.size>32*1024*1024)throw new Error('Choose a recovery file of at most 32 MiB.');const value=JSON.parse(await file.text());if(!alive(g))return;
       await store.lock(async()=>{await writeTail;const current=await store.exportRecovery();if(!same(before.records,current.records))throw new Error('Browser work changed while the file was read. Re-select the file after saving the current draft.');
         const outcome=await store.importRecovery(value);forms.clear();sourceResult={title:'Recovery import results',value:outcome};pending=await store.pending();await refresh();
       });
     }catch(error){say(error.message,true);}
   }});
   return [section('Browser drafts and exact original operations',
     note('Browser recovery is scoped to this exact workspace. Import adds missing retained records; conflicting current drafts and pending requests are preserved for explicit review. The complete server workspace remains the authoritative saved case.'),
     actions(button('Download complete browser recovery',async()=>{await writeTail;download('parcel-evidence-browser-'+workspace+'.json',await store.exportRecovery());}),
       button('Refresh original saved state',refresh)),
     field('Join a retained browser recovery file',picker),
     section('Every saved draft',table([['Draft',r=>r.value.body?.definition?.title||r.value.body?.title||r.key.slice(6)],['Original case / head basis',r=>detail('Inspect retained basis',r.value.basis)],['Saved version / time',r=>r.value.version+' · '+r.value.updatedAt],['Open',r=>button('Open saved draft',()=>openSavedDraft(r))],['Download',r=>button('Download this complete draft',()=>download('evidence-saved-draft.json',{workspaceId:workspace,key:r.key,...r.value}))]],savedDrafts)),
     table([['Original request',r=>r.request?.requestId||'—'],['Action',r=>r.request?.payload?.action||r.request?.action],['Outcome',r=>r.receipt?.operation?.status||r.reason||'Retained'],
       ['Original receipt',r=>button('Download complete request and outcome',()=>download((r.request?.requestId||'receipt')+'.json',r))],
       ['Inspect',r=>detail('Full original request, dispatch history and result',r)]],receipts.slice().reverse())),
     sourceResult&&section(sourceResult.title,detail('Complete original data',sourceResult.value))];
 }
 async function draw(){
   if(!root||!catalog)return;const g=generation,sequence=++reading;let content;
   root.inert=true;root.setAttribute('aria-busy','true');
   try{
     content=await ({Sources:sourcesPane,'Case & subjects':casePane,Findings:findingsPane,'Later sources':successionPane,Spatial:spatialPane,Reports:reportsPane,'Address QA':addressPane,Recovery:recoveryPane})[view]();
     if(!alive(g)||sequence!==reading)return;
     const selector=select(caseId,[['','New case'],...catalog.cases.map(c=>[c.caseId,c.title+' · '+c.jurisdiction])],async v=>{try{await changeCase(v);}catch(e){say(e.message,true);await draw();}});
     root.replaceChildren(
       el('header',{class:'ev-header'},el('div',{},el('p',{class:'ev-eyebrow'},'Parcel evidence'),el('h1',{},'Source, review and decision workspace'),note('Original workspace '+workspace+' · revision '+catalog.revision)),
         field('Current case',selector),actions(button('Refresh saved evidence',refresh),button('Prepare new case',()=>changeCase('')))),
       el('nav',{'aria-label':'Evidence workflow',class:'ev-tabs'},...['Sources','Case & subjects','Findings','Later sources','Spatial','Reports','Address QA','Recovery'].map(label=>button(label,async()=>{await writeTail;view=label;++generation;await draw();},{'aria-current':view===label?'page':undefined}))),
       problem&&el('p',{class:'ev-warning',role:'alert'},problem),pendingPanel(),...content,
       sourceResult&&view!=='Recovery'&&section(sourceResult.title,detail('Complete original record',sourceResult.value),button('Close inspection',async()=>{sourceResult=null;await draw();})));
     clearTimeout(pollTimer);
     if(pending&&(pending.operation?.displayStatus==='RUNNING'||pending.operation?.status==='RUNNING'&&pending.operation?.workerActive)){
       const originalId=pending.request.requestId;pollTimer=setTimeout(async()=>{if(!alive(g)||pending?.request.requestId!==originalId)return;try{await receive();}catch(error){say(error.message+' The exact original operation remains saved.',true);}},1600);
     }
   }catch(error){if(alive(g)&&sequence===reading){root.replaceChildren(section('Evidence source needs attention',note(error.message),button('Retry original catalogue read',refresh)));throw error;}}
   finally{if(sequence===reading&&alive(g)){root.inert=false;root.setAttribute('aria-busy','false');}}
 }
 return {
   async pane(){
     if(!root){workspace=ctx.getState().id;store=createEvidenceStore(workspace);root=el('div',{class:'evidence-workbench','data-testid':'evidence-workbench'});await refresh();}
     else if(catalog?.revision!==ctx.getState().revision)await refresh();else await draw();
     return root;
   },
   async update(){if(root&&root.isConnected)await refresh();},
   detach(){clearTimeout(pollTimer);++generation;++reading;++sourceRequest;fileSelection=null;uploadPaused=true;},
   async receive(){await receive();}
 };
}

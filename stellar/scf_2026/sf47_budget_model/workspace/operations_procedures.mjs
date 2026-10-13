// MIT. Operating procedures in the original Grant Operations case and source history.
import {
  createOperatingPlan,createOperatingStep,operatingPlanDraft,operatingPlanRevision,
  saveOperatingPlanRevision,inspectOperatingPlan,receiveOperatingPlan,
  STEP_STATES,renderOperatingPlanHTML,
} from '../../../scf-starforge-20261009/distribution/discovery/operating-plan.mjs';
import {
  GRANT_PROCEDURE_SCHEMA,GRANT_PROCEDURE_MAX_BYTES,procedureJSON,procedureSha256,packProcedureText,
  inspectGrantProcedure,prepareGrantProcedure,makeProcedureTable,makeProcedureEdition,
  verifyGrantProcedure,procedureCandidates,grantProcedureFiles,
} from './grant_procedures.mjs';

const SESSION='stellar-forge.sf47-grant-procedures.browser.v1',sessions=new Map();
const copy=x=>JSON.parse(JSON.stringify(x)),now=()=>new Date().toISOString(),uid=()=>crypto.randomUUID().replaceAll('-','');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const to64=raw=>{const b=new TextEncoder().encode(raw);let out='';for(let i=0;i<b.length;i+=16384)out+=String.fromCharCode(...b.subarray(i,i+16384));return btoa(out);};
const download=(name,raw,mime='application/json')=>{const url=URL.createObjectURL(raw instanceof Blob?raw:new Blob([raw],{type:mime}));
 const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
const button=(label,action,extra='')=>'<button type="button" data-gp-action="'+action+'" '+extra+'>'+esc(label)+'</button>';
const selected=(a,b)=>a===b?' selected':'',checked=x=>x?' checked':'';
const field=(label,key,value,{area=false,rows=3,type='text'}={})=>'<label><span>'+esc(label)+'</span>'+(area?
 '<textarea data-gp-field="'+key+'" rows="'+rows+'">'+esc(value)+'</textarea>':
 '<input data-gp-field="'+key+'" type="'+type+'" value="'+esc(value)+'">')+'</label>';
const details=(label,value)=>'<details><summary>'+esc(label)+'</summary><pre>'+esc(typeof value==='string'?value:procedureJSON(value))+'</pre></details>';
const notice=value=>'<p class="gp-note">'+esc(value)+'</p>';
function definitive(error){return error?.definite===true&&error?.uncertain!==true||Number.isInteger(error?.status)&&
 [400,401,403,404,409,413,422].includes(error.status)&&error.uncertain!==true;}

export function mountGrantProcedures({container,current,api,saveApi=api,mutationId,recordingActor,inform=()=>{},onCase=()=>{},onSources=()=>{}}){
 const root=document.createElement('section');root.className='grant-procedures';root.setAttribute('aria-label','Customer operating procedures');container.replaceChildren(root);
 if(!document.querySelector('link[data-grant-procedures]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_procedures.css';link.dataset.grantProcedures='true';document.head.append(link);}
 const caseId=current.program.id,prefix='/api/operations/'+caseId,key='sf47.grant-procedures.'+caseId;
 let active=true,busy=false,hostBusy=false,caseValue=current,taskComparisons=[];
 let state=sessions.get(key);
 if(!state){try{const loaded=JSON.parse(sessionStorage.getItem(key)||'null');if(loaded?.schema===SESSION&&loaded.caseId===caseId)state=loaded;}catch{}}
 if(!state)state={schema:SESSION,caseId,drafts:{},selected:null,tab:'procedure',pending:null,accepted:null,notice:'',error:'',savedRefresh:false};
 state.inflight??=null;state.finishing??=null;sessions.set(key,state);
 const available=()=>active&&root.isConnected,$=selector=>root.querySelector(selector),draft=()=>state.drafts[state.selected]||null;
 const pending=()=>Boolean(state.pending||state.accepted||state.inflight),editable=()=>available()&&!busy&&!hostBusy&&!pending();
 function persist(critical=false){
   const saved={...state};delete saved.inflight;delete saved.finishing;delete saved.storageWarning;
   try{sessionStorage.setItem(key,JSON.stringify(saved));state.storageWarning='';}
   catch(error){state.storageWarning='The browser could not retain this complete draft. Download the browser checkpoint before closing.';
     if(critical)throw new Error('The exact original request could not be retained before dispatch. Download the checkpoint or make room in this site’s session storage. '+error.message);}
 }
 function controls(){
   root.setAttribute('aria-busy',String(busy||hostBusy||!!state.inflight));
   for(const el of root.querySelectorAll('button,input,textarea,select')){
     el.disabled=el.dataset.gpFixed==='true'||busy||hostBusy||!!state.inflight||(pending()&&el.dataset.gpRecovery!=='true'&&el.dataset.gpView!=='true');
     if(el.dataset.gpSave==='true'&&(!draft()?.prepared||caseValue.program.state!=='OPEN'))el.disabled=true;
   }
 }
 async function run(fn){
   if(!available()||busy||hostBusy||state.inflight)return;
   busy=true;state.error='';controls();
   try{return await fn();}
   catch(error){state.error=error.message||String(error);if(available())inform(state.error,true);}
   finally{busy=false;persist();if(available())render();}
 }
 const stopIfPending=()=>{if(pending())throw new Error('Reconcile the retained original save before editing or selecting another procedure.');};
 function invalidate(){const d=draft();if(d)d.prepared=null;state.error='';persist();const el=$('[data-gp-prepared]');if(el)el.textContent='Draft changed. Review its complete sources before saving.';controls();}
 async function readBytes(meta){
   const response=await saveApi(prefix+'/sources/'+encodeURIComponent(meta.id),undefined,{download:true});
   const raw=new Uint8Array(await response.arrayBuffer());
   if(raw.length!==meta.bytes||raw.length>GRANT_PROCEDURE_MAX_BYTES||await procedureSha256(raw)!==meta.sha256)throw new Error('The complete original source differs: '+meta.id);
   return raw;
 }
 const readText=async meta=>new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(meta));
 const readers=value=>({current:value,readSource:async id=>{const m=value.sources.find(x=>x.id===id);if(!m)throw new Error('The original source is absent: '+id);return readBytes(m);},
  readEdition:async(kind,ref)=>saveApi(prefix+'/'+(kind==='installation'?'installations/':'task-outcomes/')+ref.id+'?revision='+ref.revision)});
 function editableDocument(plan,{operatingPlanText=procedureJSON(plan),sourceId=null,procedure=null}={}){
   return {plan,operatingPlanText,draft:operatingPlanDraft(plan,procedure?.selectedRevision),selectedRevision:procedure?.selectedRevision??plan.revisions.length,
     reviewedVersion:caseValue.program.version,parentSourceId:sourceId,sourceIds:procedure?.sources.map(x=>x.id)||[],
     tables:procedure?.sourceTables.map(x=>({key:x.key,origin:'preceding-procedure',table:copy(x)}))||[],
     editions:procedure?.editions.map(x=>({kind:x.kind,id:x.ref.id,revision:x.ref.revision}))||[],
     stepLinks:copy(procedure?.stepLinks||[]),note:'',prepared:null,verification:null};
 }
 async function addOperatingPlan(raw){
   const incoming=inspectOperatingPlan(JSON.parse(raw.replace(/^\uFEFF/,''))),id='plan-'+await procedureSha256(raw);
   const samePlan=Object.values(state.drafts).filter(x=>x.plan?.id===incoming.id);
   for(const existing of samePlan)receiveOperatingPlan(incoming,existing.plan);
   if(!state.drafts[id])state.drafts[id]=editableDocument(incoming,{operatingPlanText:raw});
   state.selected=id;state.tab='procedure';state.notice='Opened the complete Operating Plan history. Recorded step states remain authored statements.';persist();
 }
 async function openSource(sourceId){
   stopIfPending();
   const meta=caseValue.sources.find(x=>x.id===sourceId);if(!meta)throw new Error('Refresh the original case before opening this source.');
   const raw=await readText(meta),inspected=await inspectGrantProcedure(raw);
   const verified=await verifyGrantProcedure(raw,{...readers(caseValue),sourceId});
   const key='source-'+sourceId;
   if(!state.drafts[key])state.drafts[key]=editableDocument(inspected.plan,{operatingPlanText:inspected.document.operatingPlan.text,sourceId,procedure:inspected.document});
   state.drafts[key].verification=verified;state.selected=key;state.tab='procedure';state.notice='Reopened the original procedure, selected source editions and full history from this case.';persist();
 }
 async function refreshCase({review=false}={}){
   const next=await saveApi(prefix);if(next?.program?.id!==caseId)throw new Error('The returned case differs from this original workspace selection.');
   caseValue=next;
   taskComparisons=(await saveApi(prefix+'/task-outcomes')).comparisons||[];
   if(review&&draft()){draft().reviewedVersion=next.program.version;draft().prepared=null;
     state.notice='The draft now explicitly selects case version '+next.program.version+'. Existing table and edition choices remain visible for review.';}
   persist();return next;
 }
 async function chooseFile(accept){
   return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=accept;
     input.addEventListener('change',()=>resolve(input.files?.[0]||null),{once:true});input.addEventListener('cancel',()=>resolve(null),{once:true});input.click();});
 }
 async function fileText(file){
   if(file.size>GRANT_PROCEDURE_MAX_BYTES)throw new Error('Keep the complete original within the native 8 MiB source limit.');
   return new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
 }
 async function prepare(){
   stopIfPending();const d=draft();if(!d)throw new Error('Create or open an Operating Plan first.');
   const fresh=await saveApi(prefix);
   if(fresh?.program?.id!==caseId||fresh.program.version!==d.reviewedVersion)throw new Error('The case changed. Keep this draft and use Review current case before preparing its sources.');
   caseValue=fresh;
   const authored=saveOperatingPlanRevision(d.plan,d.draft,{savedAt:now()});
   // Preserve the exact received text when no content change made a revision.
   const planRaw=authored.revisions.length===d.plan.revisions.length?d.operatingPlanText:procedureJSON(authored);
   const sourceTables=[];
   for(const item of d.tables){
     if(item.origin==='preceding-procedure'){
       if(!d.parentSourceId)throw new Error('The original preceding procedure must remain selected for its retained table.');
       sourceTables.push(copy(item.table));
     }else if(item.origin==='case-plan'){
       if(!caseValue.plan.planning?.sourceTables)throw new Error('This pinned native plan has no retained Source Tables project.');
       sourceTables.push(await makeProcedureTable({key:item.key,origin:item.origin,
         originalText:procedureJSON(caseValue.plan.planning.sourceTables),nativePlanText:procedureJSON(caseValue.plan)}));
     }else if(item.origin==='case-source'){
       const metadata=caseValue.sources.find(x=>x.id===item.sourceId);if(!metadata)throw new Error('The selected table source is absent.');
       sourceTables.push(await makeProcedureTable({key:item.key,origin:item.origin,metadata,originalText:await readText(metadata)}));
     }else sourceTables.push(await makeProcedureTable({key:item.key,origin:'local-original',originalText:item.originalText}));
   }
   const editions=[];
   for(const item of d.editions){
     const original=await saveApi(prefix+'/'+(item.kind==='installation'?'installations/':'task-outcomes/')+item.id+'?revision='+item.revision);
     editions.push(await makeProcedureEdition(item.kind,procedureJSON(original)));
   }
   let parent=null;
   if(d.parentSourceId){
     const metadata=caseValue.sources.find(x=>x.id===d.parentSourceId);if(!metadata)throw new Error('The preceding native procedure is absent.');
     parent={metadata,original:await packProcedureText(await readText(metadata))};
   }
   const prepared=await prepareGrantProcedure({current:caseValue,operatingPlanText:planRaw,selectedRevision:authored.revisions.length,
     actor:recordingActor(),note:d.note,sourceTables,editions,sourceIds:d.sourceIds,stepLinks:d.stepLinks,parent});
   prepared.verification=await verifyGrantProcedure(prepared.document,readers(caseValue));
   const after=await saveApi(prefix);
   if(after.program.id!==caseId||after.program.version!==caseValue.program.version)throw new Error('The case advanced during source verification. Keep the draft and explicitly review the new version.');
   d.prepared={raw:prepared.raw,filename:prepared.filename,bytes:prepared.bytes,sha256:prepared.sha256,
     summary:prepared.summary,verification:prepared.verification,document:prepared.document};
   state.notice='Reviewed the complete procedure and its originals against case version '+caseValue.program.version+'. Saving will use this exact prepared text.';
   persist();
 }
 async function finishAccepted(){
   if(state.finishing)return state.finishing;
   const task=finishAcceptedBody();state.finishing=task;
   try{return await task;}finally{if(state.finishing===task)state.finishing=null;}
 }
 async function finishAcceptedBody(){
   const accepted=state.accepted;if(!accepted)return;
   const result=accepted.result,original=accepted.payload,document=JSON.parse(accepted.raw);
   if(result?.id!==caseId||result.action!=='source.add'||result.kind!=='source'||result.version!==original.expectedVersion+1||
      !/^source-[a-f0-9]{32}$/.test(result.recordId||''))throw new Error('The actual native source response differs from this prepared save.');
   const next=await saveApi(prefix);
   if(next?.program?.id!==caseId||next.program.version<result.version)throw new Error('The original native case has not returned the saved version.');
   const meta=next.sources.find(x=>x.id===result.recordId);if(!meta||meta.filename!==original.data.filename)throw new Error('The original procedure source has not appeared in its case.');
   if(await readText(meta)!==accepted.raw)throw new Error('The reopened source differs from the exact saved procedure bytes.');
   const inspected=await inspectGrantProcedure(accepted.raw),verified=await verifyGrantProcedure(accepted.raw,{...readers(next),sourceId:meta.id});
   const d=state.drafts[accepted.draftKey];if(!d)throw new Error('Keep the original pending draft until its source return is reconciled.');
   const retained=editableDocument(inspected.plan,{operatingPlanText:document.operatingPlan.text,sourceId:meta.id,procedure:document});
   retained.reviewedVersion=next.program.version;retained.verification=verified;
   state.drafts['source-'+meta.id]=retained;state.selected='source-'+meta.id;
   d.savedSourceId=meta.id;d.prepared=null;state.accepted=null;state.savedRefresh=true;caseValue=next;
   state.notice='Saved and independently reopened '+meta.filename+' at native case version '+result.version+'.';persist(true);
   if(available()){state.savedRefresh=false;persist();await onCase(next,result);}
 }
 async function sendPending(){
   if(state.inflight){await state.inflight;if(state.accepted)await finishAccepted();return;}
   if(state.accepted){await finishAccepted();return;}
   if(!state.pending)return;
   const original=state.pending;persist(true);
   const task=(async()=>{
     let result;
     try{result=await saveApi(prefix+'/command',original.payload);}
     catch(error){
       if(definitive(error)){
         state.rejected={...original,error:{code:error.code??null,status:error.status??null,message:error.message},at:now()};
         state.pending=null;const d=state.drafts[original.draftKey];if(d)d.prepared=null;
       }
       persist();throw error;
     }
     state.accepted={...original,result};state.pending=null;persist(true);
   })();
   state.inflight=task;
   try{await task;}finally{state.inflight=null;}
   await finishAccepted();
 }
 async function save(){
   if(state.pending||state.accepted){await sendPending();return;}
   const d=draft();if(!d?.prepared)throw new Error('Review the complete draft and original sources before saving.');
   const p=d.prepared,doc=JSON.parse(p.raw),actor=recordingActor();
   if(actor!==doc.actor)throw new Error('The recording operator changed. Review the procedure again with that operator.');
   const payload={expectedVersion:doc.case.version,actor,action:'source.add',
     data:{kind:'other',filename:p.filename,contentBase64:to64(p.raw),mediaType:'application/json',sourceUrl:'',observedAt:doc.createdAt},note:doc.note};
   payload.requestId=await mutationId('operations:'+caseId,payload);
   state.pending={draftKey:state.selected,payload,raw:p.raw};persist(true);await sendPending();
 }
 function stepLinks(id){
   const d=draft();let row=d.stepLinks.find(x=>x.stepId===id);
   if(!row){row={stepId:id,sourceIds:[],tableKeys:[],editionKeys:[],note:''};d.stepLinks.push(row);}return row;
 }
 function sourceOptions(){
   const d=draft();return [
     ...d.sourceIds.map(id=>['sourceIds',id,caseValue.sources.find(x=>x.id===id)?.filename||id]),
     ...d.tables.map(x=>['tableKeys',x.key,'Table · '+x.key]),
     ...d.editions.map(x=>['editionKeys',x.kind+':'+x.id+':'+x.revision,x.kind+' · '+x.id+' r'+x.revision]),
   ];
 }
 function planPane(d){
   const body=d.draft.content;
   return '<div class="gp-grid">'+field('Procedure title','title',body.title)+field('Customer / team','customer',body.customer)+
     field('Operating owner','owner',body.owner)+field('Period or repeat trigger','period',body.period)+
     field('Useful result','purpose',body.purpose,{area:true})+field('Receiving and continuation','receiving',body.receiving,{area:true})+
     field('Procedure notes','notes',body.notes,{area:true})+field('Case source note','note',d.note,{area:true})+'</div>'+
     notice('The complete plan has '+d.plan.revisions.length+' saved revision(s). Draft edits become a new original Operating Plan revision when the procedure is saved into this case.')+
     '<div class="gp-actions">'+button('Add operating step','add-step')+button('Open selected revision preview','preview','data-gp-view="true"')+'</div>'+
     d.draft.content.steps.map((step,i)=>{
       const links=d.stepLinks.find(x=>x.stepId===step.id)||{sourceIds:[],tableKeys:[],editionKeys:[],note:''};
       return '<details class="gp-step" data-gp-step="'+esc(step.id)+'"'+(i===0?' open':'')+'><summary>'+(i+1)+'. '+esc(step.title)+' · '+esc(step.status)+'</summary>'+
         '<div class="gp-actions">'+button('Move up','step-up','data-id="'+esc(step.id)+'"'+(i===0?' data-gp-fixed="true"':''))+
         button('Move down','step-down','data-id="'+esc(step.id)+'"'+(i===d.draft.content.steps.length-1?' data-gp-fixed="true"':''))+
         button('Remove from draft','step-remove','data-id="'+esc(step.id)+'"')+'</div>'+
         '<div class="gp-grid">'+field('Step title','title',step.title)+field('Step owner','owner',step.owner)+field('Due date','due',step.due,{type:'date'})+
         '<label><span>Recorded status</span><select data-gp-field="status">'+STEP_STATES.map(x=>'<option value="'+x+'"'+selected(x,step.status)+'>'+esc(x)+'</option>').join('')+'</select></label>'+
         field('Work instructions','instruction',step.instruction,{area:true})+field('Inputs','inputs',step.inputs,{area:true})+
         field('Expected complete result','expectedResult',step.expectedResult,{area:true})+field('Recorded result and observation limits','recordedResult',step.recordedResult,{area:true})+
         field('Command arguments · JSON string array','argv',d.invalidArgv?.[step.id]??JSON.stringify(step.argv),{area:true})+
         '<label><span>Selected original sources for this step</span><select multiple size="4" data-gp-links>'+sourceOptions().map(([kind,id,label])=>
           '<option value="'+esc(kind+'|'+id)+'"'+(links[kind].includes(id)?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>'+
         field('Source / result interpretation','link-note',links.note,{area:true})+'</div>'+
         (step.selection?details('Original registration, source and runtime',step.selection):notice('Manual operating step. You can import a complete Operating Plan from Command finder to retain selected installed registrations.'))+'</details>';
     }).join('')+(body.steps.length?'':notice('Add the complete work steps, inputs, expected result and receiving instructions.'));
 }
 function sourcesPane(d){
   const currentSources=caseValue.sources;
   return notice('Choose complete original inputs. A source table retains its source rows, mapping, selected editions and reviews. The native case ZIP retains every case source.')+
     '<h4>Source-table projects</h4><div class="gp-actions">'+button('Select pinned plan tables','table-plan')+
     button('Open original table JSON','table-file')+'</div>'+
     '<div class="gp-inline"><label>Existing case JSON <select data-gp-table-source><option value="">Select original source</option>'+
       currentSources.filter(x=>x.mediaType==='application/json').map(x=>'<option value="'+x.id+'">'+esc(x.filename)+'</option>').join('')+'</select></label>'+
       button('Use selected source table','table-source')+'</div>'+
     d.tables.map((x,i)=>'<article class="gp-material"><div><strong>'+esc(x.key)+'</strong> · '+esc(x.origin)+
       (x.sourceId?' · '+esc(x.sourceId):'')+'</div>'+button('Remove selection','table-remove','data-index="'+i+'"')+
       (x.table?details('Retained original table binding',x.table.selection):'')+'</article>').join('')+
     '<h4>Original case source links</h4><div class="gp-sources">'+currentSources.map(m=>'<label><input type="checkbox" data-gp-source="'+m.id+'"'+checked(d.sourceIds.includes(m.id))+
       '> <span>'+esc(m.filename)+'<small>'+esc(m.kind)+' · '+m.bytes+' bytes · '+esc(m.sha256.slice(0,16))+'</small></span></label>').join('')+'</div>'+
     '<h4>Installation and customer task editions</h4>'+notice('These are exact selected native editions. Their original records remain separate from authored step status.')+
     '<div class="gp-inline"><label>Native record <select data-gp-native-choice><option value="">Select a saved edition</option>'+
       (caseValue.installations||[]).map(x=>'<option value="installation|'+x.id+'|'+x.revision+'">'+esc(x.name||x.id)+' · Installation r'+x.revision+'</option>').join('')+
       taskComparisons.map(x=>'<option value="task-outcome|'+x.id+'|'+x.revision+'">'+esc(x.title||x.id)+' · Task comparison r'+x.revision+'</option>').join('')+
       '</select></label><label>Selected revision <input data-gp-native-revision type="number" min="1" value="1"></label>'+button('Select native edition','edition-add')+'</div>'+
       d.editions.map((x,i)=>'<article class="gp-material"><strong>'+esc(x.kind)+' · '+esc(x.id)+' r'+x.revision+'</strong>'+
         button('Read complete original','edition-read','data-index="'+i+'" data-gp-view="true"')+button('Remove selection','edition-remove','data-index="'+i+'"')+'</article>').join('')+
       (state.originalView?details('Complete original native edition',state.originalView):'');
 }
 function historyPane(d){
   return notice('Every prior revision remains in the original plan. Restoring older content creates a draft against the current complete history.')+
     '<table><thead><tr><th>Revision</th><th>Saved at</th><th>Title / steps</th><th>Actions</th></tr></thead><tbody>'+
     d.plan.revisions.map(r=>'<tr><td>'+r.revision+'</td><td>'+esc(r.savedAt)+'</td><td>'+esc(r.title)+' · '+r.steps.length+'</td><td>'+
       button('Preview','revision-preview','data-revision="'+r.revision+'" data-gp-view="true"')+
       button('Restore content to draft','revision-restore','data-revision="'+r.revision+'"')+'</td></tr>').join('')+'</tbody></table>'+
     details('Complete original Operating Plan JSON',d.operatingPlanText);
 }
 function savedPane(){
   return '<div class="gp-actions">'+button('Refresh case sources','refresh')+button('Open original Sources section','sources-section')+'</div>'+
     procedureCandidates(caseValue).map(m=>'<article class="gp-material"><div><strong>'+esc(m.filename)+'</strong><small>'+esc(m.id)+' · '+m.bytes+' bytes · '+esc(m.sha256)+'</small></div>'+
       button('Reopen complete procedure','open-source','data-id="'+m.id+'"')+'</article>').join('')+
     notice('Every save adds an immutable original source to the existing case. No earlier source or Operating Plan revision is replaced.');
 }
 function receivingPane(d){
   const hasSource=!!d.parentSourceId;
   return '<h4>Hand over the complete editable case</h4>'+
     notice('Download the original case ZIP and the selected procedure JSON together. Import the ZIP through Open case / Import in the receiving Grant Operations application, then open Operating procedures and its retained source. The native importer gives the received case its own ID and keeps all original sources and history.')+
     '<div class="gp-actions">'+button('Download original case ZIP','case-zip','data-gp-view="true"')+
       button('Download complete Operating Plan','download-plan','data-gp-view="true"')+
       button('Download saved procedure JSON','download-source','data-gp-view="true"'+(!hasSource?' data-gp-fixed="true"':''))+
       button('Download readable HTML','download-html','data-gp-view="true"')+'</div>'+
     notice('The installed grant-procedures export / inspect / receive commands publish and verify one complete delivery directory, including every readable member and the original case ZIP. Use the same retained request ID to resume a native save or import.')+
     details('Native CLI handover selection',{caseId,caseVersion:caseValue.program.version,sourceId:d.parentSourceId})+
     (d.verification?details('Actual original-source receiving check',d.verification):notice('Reopen a saved procedure to check its full native source and preceding history.'))+
     (d.prepared?details('Prepared source verification',d.prepared.verification):'');
 }
 function render(){
   if(!available())return;
   const d=draft(),count=Object.keys(state.drafts).length;
   root.innerHTML='<div class="gp-heading"><div><h3>Operating procedures</h3><p>Complete customer work, original inputs and receiving instructions in this case.</p></div>'+
     '<div class="gp-actions">'+button('New procedure','new')+button('Open Operating Plan JSON','import-plan')+
     button('Download browser checkpoint','checkpoint','data-gp-view="true"')+button('Restore browser checkpoint','restore-checkpoint')+'</div></div>'+
     '<p class="gp-status" role="status">'+esc(state.notice)+'</p><p class="gp-error" role="alert">'+esc(state.error)+'</p>'+
     (state.storageWarning?'<p class="gp-error">'+esc(state.storageWarning)+'</p>':'')+
     (state.rejected?details('Definitive original save rejection',state.rejected):'')+
     (pending()?'<section class="gp-recovery"><h4>Original save awaiting reconciliation</h4>'+notice('The exact prepared source and request ID remain retained. Resume that original request; do not prepare a replacement.')+
       button('Reconcile original save','resume','data-gp-recovery="true"')+details('Original request identity',{
         caseId,requestId:state.pending?.payload.requestId||state.accepted?.payload.requestId,returned:!!state.accepted})+'</section>':'')+
     '<div class="gp-inline"><label>Local working procedure <select data-gp-draft><option value="">Select a draft</option>'+
       Object.entries(state.drafts).map(([id,x])=>'<option value="'+esc(id)+'"'+selected(id,state.selected)+'>'+esc(x.draft?.content.title||x.plan.id)+
         (x.parentSourceId?' · saved source':' · local draft')+'</option>').join('')+'</select></label>'+
       '<span>'+count+' retained draft'+(count===1?'':'s')+' · Native case version '+caseValue.program.version+'</span></div>'+
     '<nav class="gp-tabs" aria-label="Operating procedure sections">'+[['procedure','Procedure and steps'],['sources','Selected originals'],['history','Revision history'],['saved','Saved case sources'],['receiving','Receiving']].map(([id,label])=>
       '<button type="button" data-gp-tab="'+id+'"'+(id===state.tab?' aria-current="page"':'')+((!d&&id!=='saved')?' data-gp-fixed="true"':'')+'>'+label+'</button>').join('')+'</nav>'+
     (d?'<div class="gp-selection">'+notice('Draft reviewed case version '+d.reviewedVersion+(d.reviewedVersion===caseValue.program.version?'':' · the native case has advanced'))+
       button('Review current case','review-case')+'</div>':'')+
     '<div class="gp-pane">'+(state.tab==='saved'?savedPane():!d?notice('Create a procedure, open a complete Operating Plan, or reopen a saved case source.'):
       ({procedure:()=>planPane(d),sources:()=>sourcesPane(d),history:()=>historyPane(d),receiving:()=>receivingPane(d)})[state.tab]())+'</div>'+
     (d?'<footer class="gp-footer"><p data-gp-prepared>'+esc(d.prepared?'Prepared '+d.prepared.bytes+' bytes · '+d.prepared.sha256:'Review this draft and its complete sources before saving.')+'</p>'+
       '<div class="gp-actions">'+button('Review procedure and sources','prepare')+button('Save reviewed procedure to case','save','data-gp-save="true"')+
       button('Download working draft','download-draft','data-gp-view="true"')+'</div></footer>':'');
   controls();
 }
 root.addEventListener('input',event=>{
   if(!editable())return;
   const el=event.target,d=draft();if(!d)return;
   if(el.matches('[data-gp-field]')){
     const k=el.dataset.gpField,stepId=el.closest('[data-gp-step]')?.dataset.gpStep;
     if(stepId){
       const step=d.draft.content.steps.find(x=>x.id===stepId);if(!step)return;
       if(k==='argv'){try{const value=JSON.parse(el.value);if(!Array.isArray(value)||!value.every(x=>typeof x==='string'))throw new Error();
         step.argv=value;el.setCustomValidity('');delete step._invalidArgv;}catch{el.setCustomValidity('Use a JSON array of command argument strings.');d.invalidArgv??={};d.invalidArgv[stepId]=el.value;invalidate();return;}
         if(d.invalidArgv)delete d.invalidArgv[stepId];
       }else if(k==='link-note')stepLinks(stepId).note=el.value;else step[k]=el.value;
     }else if(k==='note')d.note=el.value;else d.draft.content[k]=el.value;
     invalidate();
   }
 });
 root.addEventListener('change',event=>{
   const el=event.target;if(!editable())return;const d=draft();
   if(el.matches('[data-gp-draft]')){state.selected=el.value||null;state.tab='procedure';persist();render();return;}
   if(!d)return;
   if(el.matches('[data-gp-source]')){const id=el.dataset.gpSource;d.sourceIds=el.checked?[...new Set([...d.sourceIds,id])]:d.sourceIds.filter(x=>x!==id);if(!el.checked)for(const row of d.stepLinks)row.sourceIds=row.sourceIds.filter(x=>x!==id);invalidate();}
   if(el.matches('[data-gp-links]')){const row=stepLinks(el.closest('[data-gp-step]').dataset.gpStep);row.sourceIds=[];row.tableKeys=[];row.editionKeys=[];
     for(const option of el.selectedOptions){const [kind,...parts]=option.value.split('|');row[kind].push(parts.join('|'));}invalidate();}
   if(el.matches('[data-gp-native-choice]')){const parts=el.value.split('|');$('[data-gp-native-revision]').value=parts[2]||'1';}
 });
 root.addEventListener('click',event=>{
   const tab=event.target.closest('[data-gp-tab]');if(tab&&!busy&&!hostBusy&&!pending()){state.tab=tab.dataset.gpTab;persist();render();return;}
   const target=event.target.closest('[data-gp-action]');if(!target||target.disabled)return;
   void run(async()=>{
     const action=target.dataset.gpAction,d=draft();
     if(action==='checkpoint'){const saved={...state};delete saved.inflight;delete saved.finishing;download('grant-procedures-'+caseId+'.browser.json',procedureJSON(saved));return;}
     if(action==='resume'){await sendPending();return;}
     if(action==='sources-section'){onSources();return;}
     if(action==='restore-checkpoint'){
       stopIfPending();const file=await chooseFile('.json,application/json');if(!file)return;
       const value=JSON.parse(await fileText(file));if(value.schema!==SESSION||value.caseId!==caseId||!value.drafts||typeof value.drafts!=='object')throw new Error('This complete browser checkpoint belongs to another case.');
       for(const entry of Object.values(value.drafts))inspectOperatingPlan(entry.plan);
       const waiting=value.pending||value.accepted;
       if(waiting){
         const original=await inspectGrantProcedure(waiting.raw),p=waiting.payload;
         if(original.document.case.id!==caseId||p?.action!=='source.add'||p.expectedVersion!==original.document.case.version||
           p.actor!==original.document.actor||p.data?.contentBase64!==to64(waiting.raw)||
           p.data.filename!=='grant-procedure-'+original.document.editionId+'.json'||!value.drafts[waiting.draftKey]||
           !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(p.requestId||''))throw new Error('The complete pending source and original request do not match.');
       }
       const keys={};
       for(const [id,entry] of Object.entries(value.drafts)){
         const selected=state.drafts[id]&&JSON.stringify(state.drafts[id])!==JSON.stringify(entry)?id+'-received-'+uid():id;
         keys[id]=selected;state.drafts[selected]=entry;
       }
       if(waiting){
         state.selected=keys[waiting.draftKey];state.pending=value.pending?{...value.pending,draftKey:keys[value.pending.draftKey]}:null;
         state.accepted=value.accepted?{...value.accepted,draftKey:keys[value.accepted.draftKey]}:null;persist(true);
         state.notice='Restored the exact original pending request. Use Reconcile original save; no native write was made by this checkpoint import.';
       }else {if(!state.selected)state.selected=keys[value.selected]||null;state.notice='Received the complete saved working drafts; conflicting local drafts are retained as separate entries.';}
       return;
     }
     if(action==='new'){stopIfPending();const plan=createOperatingPlan({id:'operating-'+uid(),title:caseValue.program.name+' operating procedure',
       owner:recordingActor(),purpose:'',receiving:''});const id='local-'+uid();state.drafts[id]=editableDocument(plan);state.selected=id;state.tab='procedure';return;}
     if(action==='import-plan'){stopIfPending();const file=await chooseFile('.json,application/json');if(file)await addOperatingPlan(await fileText(file));return;}
     if(action==='open-source'){await openSource(target.dataset.id);return;}
     if(action==='refresh'){await refreshCase();state.notice='Read the current original case and source list.';return;}
     if(!d)throw new Error('Open a working procedure first.');
     if(action==='review-case'){await refreshCase({review:true});return;}
     if(action==='prepare'){if(d.invalidArgv&&Object.keys(d.invalidArgv).length)throw new Error('Correct the retained invalid command argument text before reviewing.');await prepare();return;}
     if(action==='save'){await save();return;}
     if(action==='download-plan'){download('operating-plan.json',d.operatingPlanText);return;}
     if(action==='download-draft'){download('operating-plan-draft.json',procedureJSON(d.draft));return;}
     if(action==='download-html'||action==='preview'||action==='revision-preview'){
       const revision=action==='revision-preview'?Number(target.dataset.revision):d.selectedRevision;
       const html=renderOperatingPlanHTML(d.plan,{revision});
       if(action==='download-html')download('operating-procedure.html',html,'text/html');
       else{const blob=URL.createObjectURL(new Blob([html],{type:'text/html'}));window.open(blob,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(blob),60000);}return;
     }
     if(action==='download-source'){const meta=caseValue.sources.find(x=>x.id===d.parentSourceId);if(!meta)throw new Error('Save and reopen the native procedure first.');download(meta.filename,await readBytes(meta));return;}
     if(action==='case-zip'){
       const before=await saveApi(prefix),response=await saveApi(prefix+'/export.zip',undefined,{download:true}),blob=await response.blob(),after=await saveApi(prefix);
       if(before.program.id!==caseId||after.program.id!==caseId||before.program.version!==after.program.version)throw new Error('The case changed during export. Use the native grant-procedures export command for a version-bound delivery.');
       download(caseId+'-v'+before.program.version+'.zip',blob,'application/zip');state.notice='Downloaded the original full case ZIP for native receiving.';return;
     }
     stopIfPending();
     if(action==='add-step'){d.draft.content.steps.push(createOperatingStep({id:'step-'+uid(),title:'New operating step',owner:d.draft.content.owner}));invalidate();return;}
     if(action.startsWith('step-')){
       const i=d.draft.content.steps.findIndex(x=>x.id===target.dataset.id);if(i<0)return;
       if(action==='step-remove'){
         const removed=d.draft.content.steps.splice(i,1)[0];if(d.invalidArgv)delete d.invalidArgv[removed.id];
         if(!d.plan.revisions.some(r=>r.steps.some(x=>x.id===removed.id)))d.stepLinks=d.stepLinks.filter(x=>x.stepId!==removed.id);
       }
       else{const next=i+(action==='step-up'?-1:1);if(next>=0&&next<d.draft.content.steps.length){const [row]=d.draft.content.steps.splice(i,1);d.draft.content.steps.splice(next,0,row);}}
       invalidate();return;
     }
     if(action==='revision-restore'){d.draft=operatingPlanDraft(d.plan,Number(target.dataset.revision));d.selectedRevision=Number(target.dataset.revision);d.invalidArgv={};
       d.prepared=null;state.tab='procedure';state.notice='Restored revision '+target.dataset.revision+' into a draft against the full current history. Earlier saved revisions remain unchanged.';return;}
     if(action==='table-plan'){
       if(d.tables.some(x=>x.origin==='case-plan'))throw new Error('The current pinned plan table is already selected.');
       if(!caseValue.plan.planning?.sourceTables)throw new Error('The pinned native plan has no retained Source Tables project.');
       d.tables.push({key:'pinned-plan-'+caseValue.program.planRevision,origin:'case-plan'});invalidate();return;
     }
     if(action==='table-file'){
       const file=await chooseFile('.json,application/json');if(!file)return;const raw=await fileText(file),key='table-'+uid();
       await makeProcedureTable({key,origin:'local-original',originalText:raw});
       d.tables.push({key,origin:'local-original',originalText:raw,filename:file.name});invalidate();return;
     }
     if(action==='table-source'){
       const id=$('[data-gp-table-source]').value,meta=caseValue.sources.find(x=>x.id===id);if(!meta)throw new Error('Select the original case JSON source.');
       const key='table-'+id;await makeProcedureTable({key,origin:'case-source',metadata:meta,originalText:await readText(meta)});
       if(d.tables.some(x=>x.key===key))throw new Error('This source table is already selected.');
       d.tables.push({key,origin:'case-source',sourceId:id});invalidate();return;
     }
     if(action==='table-remove'){const [removed]=d.tables.splice(Number(target.dataset.index),1);for(const row of d.stepLinks)row.tableKeys=row.tableKeys.filter(x=>x!==removed.key);invalidate();return;}
     if(action==='edition-add'){
       const [kind,id]=$('[data-gp-native-choice]').value.split('|'),revision=Number($('[data-gp-native-revision]').value);
       if(!kind||!id||!Number.isInteger(revision)||revision<1)throw new Error('Choose one actual native edition and revision.');
       const original=await saveApi(prefix+'/'+(kind==='installation'?'installations/':'task-outcomes/')+id+'?revision='+revision);
       await makeProcedureEdition(kind,procedureJSON(original));
       if(d.editions.some(x=>x.kind===kind&&x.id===id&&x.revision===revision))throw new Error('The selected edition is already retained.');
       d.editions.push({kind,id,revision});state.originalView=original;invalidate();return;
     }
     if(action==='edition-read'){const x=d.editions[Number(target.dataset.index)];state.originalView=await saveApi(prefix+'/'+(x.kind==='installation'?'installations/':'task-outcomes/')+x.id+'?revision='+x.revision);return;}
     if(action==='edition-remove'){const [removed]=d.editions.splice(Number(target.dataset.index),1),key=removed.kind+':'+removed.id+':'+removed.revision;for(const row of d.stepLinks)row.editionKeys=row.editionKeys.filter(x=>x!==key);invalidate();return;}
   });
 });
 render();
 async function openSavedWorkflow(selection){
   await ready;
   if(!available())throw new Error('Open this original procedure desk before selecting its source.');
   if(busy||pending())throw new Error('Finish the retained procedure request before opening another source.');
   if(selection?.kind!=='grant-procedure'||typeof selection.sourceId!=='string')
     throw new Error('Select a complete original procedure source.');
   if(selection.caseId!==undefined&&selection.caseId!==caseId||selection.expectedVersion!==undefined&&selection.expectedVersion!==caseValue.program.version)
     throw new Error('Refresh this original case before opening its saved procedure.');
   const meta=procedureCandidates(caseValue).find(row=>row.id===selection.sourceId);
   if(!meta)throw new Error('The selected procedure source is absent from this original case.');
   busy=true;state.error='';controls();
   try{
     await openSource(meta.id);
     if(!available())throw new Error('The original procedure desk changed while its source was opening.');
     persist();render();
     return {outcome:'opened',caseId,kind:'grant-procedure',sourceId:meta.id};
   }catch(problem){state.error=problem.message||String(problem);throw problem;}
   finally{busy=false;if(available())controls();}
 }
 const ready=(async()=>{
   taskComparisons=(await saveApi(prefix+'/task-outcomes')).comparisons||[];
   if(state.inflight)await state.inflight;
   if(state.accepted||state.finishing)await finishAccepted();
   if(state.savedRefresh){const next=await refreshCase();state.savedRefresh=false;persist();if(available())await onCase(next,{id:caseId,action:'source.readback',version:next.program.version});}
   if(available())render();
 })().catch(error=>{state.error=error.message;persist();if(available())render();throw error;});
 return {ready,openSavedWorkflow,dispose(){active=false;persist();},setHostBusy(value){hostBusy=Boolean(value);if(available())controls();}};
}

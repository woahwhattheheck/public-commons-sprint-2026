// SPDX-License-Identifier: MIT
// Browser caller for original host-declared standalone Object-session recovery.
const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const actions={'object-snapshot':'Create encrypted Object backup','object-verify':'Verify Object backup','object-restore':'Restore or reopen original Object state'};
const command=value=>Object.hasOwn(actions,value);
function node(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;}
function field(label,input){const wrap=node('div',undefined,'object-field'),caption=node('label',label);caption.htmlFor=input.id;wrap.append(caption,input);return wrap;}
function input(id,maximum){const value=node('input');value.id=id;value.autocomplete='off';value.spellcheck=false;value.maxLength=maximum;return value;}
function facts(value){const pre=node('pre',JSON.stringify(value,null,2),'object-facts');pre.tabIndex=0;return pre;}
function stamp(){return 'object-recovery-'+Date.now().toString(36)+'-'+crypto.randomUUID().slice(0,8);}
export function createObjectRecoveryDesk({root,api,post,refresh,notice,showDetails}){
 let state=null,profile=null,generation=0,busy=false,review=null,continuation=null,profileBinding='';
 const form=node('form'),source=node('select'),action=node('select'),operation=input('object-operation',80),record=input('object-record',64);
 source.id='object-source';action.id='object-action';record.className=operation.className='mono';
 const quiesced=node('input');quiesced.type='checkbox';quiesced.id='object-quiesced';
 const quiet=node('label',undefined,'quiescence');quiet.htmlFor=quiesced.id;
 quiet.append(quiesced,node('span','I have stopped the selected Object-session writers and will keep them stopped through this backup.'));
 const help=node('p',undefined,'hint'),sourceFacts=node('div'),observation=node('div'),reviewPanel=node('div',undefined,'object-review'),reviewBody=node('div');
 const next=node('button','New Object request'),inspect=node('button','Inspect current source'),reviewButton=node('button','Review selection'),start=node('button','Start reviewed request'),continueButton=node('button','Continue selected attempt');
 for(const button of [next,inspect,start,continueButton])button.type='button';
 reviewButton.type='submit';reviewPanel.hidden=true;
 const controls=node('div',undefined,'actions');controls.append(inspect,reviewButton);
 const confirmed=node('input');confirmed.type='checkbox';confirmed.id='object-reviewed';
 const confirmedLabel=node('label',undefined,'quiescence');confirmedLabel.htmlFor=confirmed.id;
 confirmedLabel.append(confirmed,node('span','I reviewed these exact source, backup and original-request identities.'));
 reviewPanel.append(node('h3','Exact Object recovery review'),reviewBody,confirmedLabel,start,continueButton);
 const heading=node('div',undefined,'section-head');heading.append(node('h2','Standalone Object recovery'),next);
 form.append(field('Original host-declared session',source),field('Object operation',action),field('Original request ID',operation),
  field('Exact backup record SHA-256',record),quiet,help,controls);
 root.append(heading,node('p','Use the original free Object session and its complete encrypted state backup. Paths and passphrase names are supplied by this host.','hint'),
  form,sourceFacts,observation,reviewPanel);
 const selected=()=>profile?.objectSessions?.find(row=>row.id===source.value);
 const key=()=>state&&profile?'sf101-object-selection/'+state.id+'/'+profile.id:null;
 const available=()=>!busy&&!state?.readOnly&&!state?.active&&!!selected();
 function saveSelection(){
  const k=key();if(!k)return;
  try{sessionStorage.setItem(k,JSON.stringify({schema:'sf101-object-browser-selection.v1',source:source.value,action:action.value,id:operation.value,record:record.value}));}catch{}
 }
 function invalidate({clearQuiet=false}={}){
  generation++;review=null;continuation=null;confirmed.checked=false;reviewPanel.hidden=true;
  if(clearQuiet)quiesced.checked=false;sync();
 }
 function sync(){
  const declaration=selected(),snapshot=action.value==='object-snapshot';
  quiet.hidden=!snapshot;record.parentElement.hidden=snapshot;
  for(const element of [source,action,operation,record,quiesced,next])element.disabled=busy||!!state?.readOnly;
  inspect.disabled=busy||!!state?.readOnly||!!state?.active||!declaration;
  reviewButton.disabled=!available()||(snapshot&&!quiesced.checked)||!ID.test(operation.value);
  start.hidden=!!continuation;continueButton.hidden=!continuation;
  const exact=!!review&&confirmed.checked&&review.profileId===profile?.id&&review.intent?.objectSessionId===source.value;
  start.disabled=!available()||!exact;
  continueButton.disabled=!available()||!exact||(snapshot&&!quiesced.checked);
  confirmed.disabled=busy||!review||!!state?.readOnly;
  help.textContent=snapshot?
   'Inspect reads the complete native session. Review binds its current bytes and configuration history. Starting saves this request before the original backup command.':
   'Use the exact record hash from a completed backup or your retained original manifest. Verify authenticates it. Restore uses its original canonical state root; it never deletes an existing source or starts an acquisition.';
 }
 function presentSource(){
  const d=selected();sourceFacts.replaceChildren();
  if(d)sourceFacts.append(facts({session:d.sessionId,directory:d.directory,stateRoot:d.stateRoot,include:d.include,bundle:d.bundle,
   allowed:d.kinds,expectedRecordSha256:d.expectedRecordSha256??null}));
 }
 function setAction(preferred){
  const d=selected(),prior=preferred??action.value;action.replaceChildren();
  for(const kind of d?.kinds??[]){const value='object-'+kind;if(!command(value))continue;const option=node('option',actions[value]);option.value=value;action.append(option);}
  if([...action.options].some(row=>row.value===prior))action.value=prior;
 }
 function newRequest({preserveSource=true}={}){
  invalidate({clearQuiet:true});operation.value=stamp();record.value=selected()?.expectedRecordSha256??'';
  if(!preserveSource&&source.options.length)source.selectedIndex=0;
  setAction();observation.replaceChildren();presentSource();saveSelection();sync();
 }
 function intent(){
  const value={profileId:profile.id,action:action.value,id:operation.value,objectSessionId:source.value};
  if(value.action==='object-snapshot')value.quiesced=quiesced.checked;
  else value.expectedRecordSha256=record.value||selected()?.expectedRecordSha256;
  if(!ID.test(value.id))throw new Error('Keep an original request ID of 1–80 letters, digits, dot, underscore or hyphen.');
  if(value.action!=='object-snapshot'&&!HASH.test(value.expectedRecordSha256??''))throw new Error('Select the complete original backup record SHA-256.');
  return value;
 }
 async function task(fn){
  if(busy)return;busy=true;sync();
  try{return await fn();}catch(error){
   notice((error.code?error.code+': ':'')+error.message,true);
   const evidence=evidenceButton(error.nativeEvidence);
   if(evidence)observation.replaceChildren(node('h3','Retained native observation failure'),
    facts({code:error.code,message:error.message,nativeEvidence:error.nativeEvidence}),evidence);
  }
  finally{busy=false;sync();}
 }
 function evidenceButton(reference){
  if(!HASH.test(reference?.sha256??''))return null;
  const button=node('button','Read complete native evidence');button.type='button';
  button.addEventListener('click',()=>task(async()=>{
   const value=await api('/api/object-evidence?sha256='+encodeURIComponent(reference.sha256));showDetails(value);
  }));return button;
 }
 function displayReview(value,{saved=null}={}){
  review=value;continuation=saved;confirmed.checked=false;reviewBody.replaceChildren(facts(value));
  const evidence=evidenceButton(value.objectRecovery?.nativeEvidence);if(evidence)reviewBody.append(evidence);
  reviewPanel.hidden=false;sync();
 }
 async function readOriginal(profileId,id){
  const row=await api('/api/request?profile='+encodeURIComponent(profileId)+'&id='+encodeURIComponent(id));
  showDetails(row);await refresh();return row;
 }
 source.addEventListener('change',()=>{setAction();newRequest();});
 action.addEventListener('change',()=>{invalidate({clearQuiet:true});saveSelection();sync();});
 for(const element of [operation,record])element.addEventListener('input',()=>{invalidate();saveSelection();});
 quiesced.addEventListener('change',()=>{
  // A saved continuation retains its original request; this is a fresh operator acknowledgement.
  if(continuation){confirmed.checked=false;sync();}else invalidate();
 });
 confirmed.addEventListener('change',sync);
 next.addEventListener('click',()=>newRequest());
 inspect.addEventListener('click',()=>task(async()=>{
  const p=profile.id,s=source.value;invalidate({clearQuiet:true});const epoch=generation;
  const result=await api('/api/object-session?profile='+encodeURIComponent(p)+'&session='+encodeURIComponent(s));
  if(epoch!==generation||profile?.id!==p||source.value!==s)return;
  observation.replaceChildren(node('h3','Current native source observation'),facts(result));
  const evidence=evidenceButton(result.nativeEvidence);if(evidence)observation.append(evidence);
  notice('The original source was inspected. Confirm current writer shutdown before reviewing a backup.');
 }));
 form.addEventListener('submit',event=>{
  event.preventDefault();task(async()=>{
   const selectedIntent=intent(),epoch=++generation;confirmed.checked=false;review=null;continuation=null;reviewPanel.hidden=true;
   const result=await post('/api/review',selectedIntent);
   if(epoch!==generation||JSON.stringify(selectedIntent)!==JSON.stringify(intent()))return;
   displayReview(result);notice('Review the exact native selection, record and original request before starting.');
  });
 });
 start.addEventListener('click',()=>task(async()=>{
  if(!review||!confirmed.checked||continuation)return;
  const chosen=review,p=chosen.profileId,id=chosen.operationId;
  // Keep this selection after a lost response. No automatic start retry occurs.
  saveSelection();confirmed.checked=false;review=null;reviewPanel.hidden=true;
  try{const result=await post('/api/start',{selection:chosen.intent,expectedReviewHash:chosen.reviewHash});
   showDetails(result);await refresh();notice('Original Object request '+id+' is retained. Read its native completion before continuing.');
  }catch(error){
   notice('The start response needs reconciliation. Read original request '+id+'; do not create a replacement request.',true);
   try{await readOriginal(p,id);}catch{}
   throw error;
  }
 }));
 continueButton.addEventListener('click',()=>task(async()=>{
  const chosen=continuation;if(!chosen||!review||!confirmed.checked)return;
  const request={profileId:chosen.profileId,id:chosen.operationId,expectedReviewHash:chosen.review.reviewHash,afterAttempt:chosen.attempts};
  if(chosen.review.command==='object-snapshot'){if(!quiesced.checked)return;request.quiesced=true;}
  confirmed.checked=false;continuation=null;review=null;reviewPanel.hidden=true;
  try{const result=await post('/api/resume',request);showDetails(result);await refresh();
   notice('The selected original attempt was continued or its existing result was returned. No new request was created.');
  }catch(error){try{await readOriginal(request.profileId,request.id);}catch{}throw error;}
 }));
 function update(value,profileId){
  state=value;profile=value.profiles.find(row=>row.id===profileId);
  const binding=JSON.stringify([value.id,profileId,profile?.objectSessions??[]]);
  root.hidden=!(profile?.objectSessions?.length);
  if(binding!==profileBinding){
   invalidate({clearQuiet:true});profileBinding=binding;source.replaceChildren();
   for(const d of profile?.objectSessions??[]){const option=node('option',d.label??d.id);option.value=d.id;source.append(option);}
   let saved=null;try{saved=JSON.parse(sessionStorage.getItem(key())??'null');}catch{}
   if(saved?.schema==='sf101-object-browser-selection.v1'&&[...source.options].some(o=>o.value===saved.source))source.value=saved.source;
   setAction(saved?.action);operation.value=ID.test(saved?.id??'')?saved.id:stamp();
   record.value=HASH.test(saved?.record??'')?saved.record:selected()?.expectedRecordSha256??'';
   observation.replaceChildren();presentSource();saveSelection();
  }
  sync();
 }
 async function reopen(row){
  if(row.profileId!==profile?.id)throw new Error('Select the original recovery profile.');
  const fresh=await api('/api/request?profile='+encodeURIComponent(row.profileId)+'&id='+encodeURIComponent(row.operationId));
  if(fresh.profileId!==profile?.id)return;
  const original=fresh.review.intent,d=(profile.objectSessions??[]).find(d=>d.id===original.objectSessionId);
  if(!d)throw new Error('This original Object declaration is unavailable. Restore its original host configuration before continuing.');
  invalidate({clearQuiet:true});source.value=d.id;setAction(original.action);operation.value=original.id;
  record.value=original.expectedRecordSha256??d.expectedRecordSha256??'';presentSource();saveSelection();
  displayReview(fresh.review,{saved:fresh.phase==='COMPLETE'?null:fresh});
  if(fresh.phase==='COMPLETE'){review=null;reviewPanel.hidden=true;showDetails(fresh);}
  else notice('The exact saved request is open. Review it and confirm the selected original attempt before continuing.');
  root.scrollIntoView({behavior:'smooth',block:'nearest'});sync();
 }
 function useCompleted(row,kind){
  const d=(profile?.objectSessions??[]).find(d=>d.id===row.review.intent?.objectSessionId);
  const recordSha=row.operation?.recordSha256;
  if(!d||!HASH.test(recordSha??'')||!d.kinds.includes(kind))throw new Error('Use an actual completed native backup result with its unchanged host declaration.');
  source.value=d.id;setAction('object-'+kind);newRequest();action.value='object-'+kind;record.value=recordSha;saveSelection();sync();
  root.scrollIntoView({behavior:'smooth',block:'nearest'});
 }
 function requestCard(row){
  const article=node('article',undefined,'request'),heading=node('div',undefined,'request-head'),controls=node('div',undefined,'actions');
  heading.append(node('h3',row.operationId,'mono'),node('span',row.phase,'badge'));
  article.append(heading,node('p',actions[row.review.command]+' · '+row.updatedAt,'hint'));
  const result=row.operation;
  article.append(facts({session:result?.sessionId??row.review.objectRecovery?.sessionId,
   recordSha256:result?.recordSha256??row.review.options?.expectedRecordSha256,
   completionReported:result?.completionReported??false,ok:result?.ok??false,process:result?.process??null,
   publicationSyncError:result?.publicationSyncError??null,nativeReopenErrors:result?.nativeReopenErrors??[],
   cleanupErrors:result?.cleanupErrors??[],leaseReleaseErrors:result?.leaseReleaseErrors??[],attempts:row.attempts}));
  if(row.error)article.append(node('p',row.error.code+': '+row.error.message,'request-error'));
  const add=(title,fn)=>{const b=node('button',title);b.type='button';b.disabled=!!state?.readOnly&&title!=='Read saved result';
   b.addEventListener('click',()=>task(fn));controls.append(b);return b;};
  add('Read saved result',()=>readOriginal(row.profileId,row.operationId));
  const evidence=evidenceButton(result?.nativeEvidence);if(evidence)controls.append(evidence);
  if(row.running)add('Stop owned execution',async()=>{await post('/api/cancel',{profileId:row.profileId,id:row.operationId});await refresh();});
  else if(row.phase!=='COMPLETE')add('Reopen exact request',()=>reopen(row));
  if(row.phase==='COMPLETE'&&HASH.test(result?.recordSha256??'')){
   const d=(profile?.objectSessions??[]).find(d=>d.id===row.review.intent?.objectSessionId);
   if(d?.kinds.includes('verify'))add('New review: verify this backup',()=>useCompleted(row,'verify'));
   if(d?.kinds.includes('restore'))add('New review: restore or reopen',()=>useCompleted(row,'restore'));
  }
  article.append(controls);return article;
 }
 return {update,isRequest:row=>command(row?.review?.command),requestCard,reopen};
}

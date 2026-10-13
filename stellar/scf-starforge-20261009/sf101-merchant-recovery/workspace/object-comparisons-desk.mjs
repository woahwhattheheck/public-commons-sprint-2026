// SPDX-License-Identifier: MIT
// Original queued Object-backup comparison; all paths and passphrase names belong to the host.
const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const isComparison=row=>row?.review?.command==='object-compare';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
const facts=value=>el('pre',JSON.stringify(value,null,2),'object-facts');
const freshId=()=>'object-compare-'+Date.now().toString(36)+'-'+crypto.randomUUID().slice(0,8);
function field(label,input,id){input.id=id;const wrap=el('div',undefined,'object-field'),caption=el('label',label);caption.htmlFor=id;wrap.append(caption,input);return wrap;}
function textInput(max){const n=el('input');n.maxLength=max;n.autocomplete='off';n.spellcheck=false;n.className='mono';return n;}
export function createObjectComparisonDesk({root,api,post,refresh,notice,showDetails}){
 let state=null,profile=null,binding='',generation=0,busy=false,review=null,continuation=null;
 const form=el('form'),before=el('select'),after=el('select'),beforeHash=textInput(64),afterHash=textInput(64),id=textInput(80);
 const prepare=el('button','Review comparison'),next=el('button','New comparison'),submit=el('button','Authenticate and compare');
 prepare.type='submit';next.type=submit.type='button';
 const confirmed=el('input');confirmed.type='checkbox';confirmed.id='comparison-confirmed';
 const confirmLabel=el('label',undefined,'quiescence');confirmLabel.htmlFor=confirmed.id;
 confirmLabel.append(confirmed,el('span','I reviewed both exact backup records and the original request.'));
 const reviewPanel=el('div',undefined,'object-review'),reviewBody=el('div'),selectionDetails=el('div'),hint=el('p',undefined,'hint');
 reviewPanel.hidden=true;reviewPanel.append(el('h3','Reviewed backup comparison'),reviewBody,confirmLabel,submit);
 const head=el('div',undefined,'section-head');head.append(el('h2','Compare Object backups'),next);
 form.append(field('Before: declared backup',before,'comparison-before'),
  field('Before record SHA-256',beforeHash,'comparison-before-hash'),
  field('After: declared backup',after,'comparison-after'),
  field('After record SHA-256',afterHash,'comparison-after-hash'),
  field('Original comparison request ID',id,'comparison-id'),prepare);
 root.append(head,el('p','Authenticate two saved editions of the same original session and inspect every changed, added, removed and unchanged member. Comparison leaves the live session untouched. Use the separate restore review after selecting an edition.','hint'),
  form,hint,selectionDetails,reviewPanel);
 const declarations=()=>profile?.objectSessions?.filter(d=>d.kinds.includes('verify'))??[];
 const declared=name=>declarations().find(d=>d.id===(name==='before'?before:after).value);
 const key=()=>state&&profile?'sf101-object-comparison/'+state.id+'/'+profile.id:null;
 const current=(epoch,p)=>epoch===generation&&profile?.id===p;
 function persist(){try{if(key())sessionStorage.setItem(key(),JSON.stringify({schema:'sf101-object-comparison-selection.v1',before:before.value,after:after.value,beforeHash:beforeHash.value,afterHash:afterHash.value,id:id.value}));}catch{}}
 function clear(){generation++;review=null;continuation=null;confirmed.checked=false;reviewPanel.hidden=true;sync();}
 function details(){
  selectionDetails.replaceChildren();const a=declared('before'),b=declared('after');
  if(a&&b)selectionDetails.append(facts({before:{declaration:a.id,bundle:a.bundle,recordSha256:beforeHash.value},
   after:{declaration:b.id,bundle:b.bundle,recordSha256:afterHash.value},session:a.sessionId,directory:a.directory,stateRoot:a.stateRoot}));
 }
 function sync(){
  const a=declared('before'),b=declared('after'),same=a&&b&&a.sessionId===b.sessionId&&a.directory===b.directory&&a.stateRoot===b.stateRoot;
  const available=!busy&&!state?.readOnly&&!state?.active&&same;
  for(const n of [before,after,beforeHash,afterHash,id,next])n.disabled=busy||!!state?.readOnly;
  beforeHash.readOnly=!!a?.expectedRecordSha256;afterHash.readOnly=!!b?.expectedRecordSha256;
  prepare.disabled=!available||!HASH.test(beforeHash.value)||!HASH.test(afterHash.value)||!ID.test(id.value);
  confirmed.disabled=busy||!review||!!state?.readOnly;
  submit.disabled=!available||!review||!confirmed.checked;
  submit.textContent=continuation?'Continue selected comparison attempt':'Authenticate and compare';
  hint.textContent=same?'Both declarations refer to the same canonical source. The queued comparison authenticates the selected records independently.':
   'Select two host-declared backups with verification enabled for the same original session, directory and state root.';
 }
 function selection(){
  const value={profileId:profile.id,action:'object-compare',id:id.value,beforeObjectSessionId:before.value,afterObjectSessionId:after.value,
   beforeExpectedRecordSha256:beforeHash.value,afterExpectedRecordSha256:afterHash.value};
  if(!ID.test(value.id)||!HASH.test(value.beforeExpectedRecordSha256)||!HASH.test(value.afterExpectedRecordSha256))
   throw new Error('Select both complete record hashes and an original request ID.');
  return value;
 }
 function populateHashes(){beforeHash.value=declared('before')?.expectedRecordSha256??'';afterHash.value=declared('after')?.expectedRecordSha256??'';}
 function newRequest(){clear();id.value=freshId();populateHashes();persist();details();sync();}
 async function task(fn){
  if(busy)return;const originalBinding=binding;busy=true;sync();
  try{return await fn();}catch(error){if(binding===originalBinding)notice((error.code?error.code+': ':'')+error.message,true);}
  finally{busy=false;sync();}
 }
 function present(value,saved=null){review=value;continuation=saved;confirmed.checked=false;reviewBody.replaceChildren(facts(value));reviewPanel.hidden=false;sync();}
 for(const n of [before,after])n.addEventListener('change',()=>{clear();populateHashes();persist();details();sync();});
 for(const n of [beforeHash,afterHash,id])n.addEventListener('input',()=>{clear();persist();details();sync();});
 confirmed.addEventListener('change',sync);next.addEventListener('click',newRequest);
 form.addEventListener('submit',event=>{event.preventDefault();clear();task(async()=>{
  const input=selection(),epoch=generation,p=profile.id;
  const selected=await post('/api/review',input);
  if(!current(epoch,p)||JSON.stringify(selection())!==JSON.stringify(input))return;
  present(selected);notice('Review both exact backup identities, then authenticate the comparison.');
 });});
 submit.addEventListener('click',()=>task(async()=>{
  if(!review||!confirmed.checked)return;
  const chosen=review,saved=continuation,epoch=generation,p=profile.id;confirmed.checked=false;reviewPanel.hidden=true;review=null;continuation=null;
  persist();
  try{
   const result=saved?await post('/api/resume',{profileId:p,id:chosen.operationId,expectedReviewHash:chosen.reviewHash,afterAttempt:saved.attempts}):
    await post('/api/start',{selection:chosen.intent,expectedReviewHash:chosen.reviewHash});
   if(!current(epoch,p))return;showDetails(result);await refresh();
   if(current(epoch,p))notice('Comparison request '+chosen.operationId+' is retained. Read its complete result in Workspace operations.');
  }catch(error){
   if(!current(epoch,p))return;
   notice('Read original comparison '+chosen.operationId+' before explicitly continuing its observed attempt.',true);
   try{const savedResult=await api('/api/request?profile='+encodeURIComponent(p)+'&id='+encodeURIComponent(chosen.operationId));if(current(epoch,p))showDetails(savedResult);}catch{}
   throw error;
  }
 }));
 function update(value,profileId,requests=[]){
  state=value;profile=value.profiles.find(p=>p.id===profileId);
  const nextBinding=JSON.stringify([value.id,profileId,profile?.objectSessions??[],profile?.passEnv]);
  root.hidden=!declarations().length;
  if(binding!==nextBinding){
   binding=nextBinding;clear();before.replaceChildren();after.replaceChildren();
   for(const d of declarations())for(const select of [before,after]){const option=el('option',d.label??d.id);option.value=d.id;select.append(option);}
   let saved;try{saved=JSON.parse(sessionStorage.getItem(key())??'null');}catch{}
   if(saved?.schema==='sf101-object-comparison-selection.v1'){
    if(declarations().some(d=>d.id===saved.before))before.value=saved.before;
    if(declarations().some(d=>d.id===saved.after))after.value=saved.after;
   }else if(after.options.length>1)after.selectedIndex=1;
   populateHashes();
   if(!declared('before')?.expectedRecordSha256&&HASH.test(saved?.beforeHash??''))beforeHash.value=saved.beforeHash;
   if(!declared('after')?.expectedRecordSha256&&HASH.test(saved?.afterHash??''))afterHash.value=saved.afterHash;
   id.value=ID.test(saved?.id??'')?saved.id:freshId();persist();details();
  }
  if(continuation){const latest=requests.find(r=>r.profileId===continuation.profileId&&r.operationId===continuation.operationId);
   if(latest&&(latest.attempts!==continuation.attempts||latest.phase!==continuation.phase))clear();}
  sync();
 }
 async function reopen(row){
  const epoch=generation,p=profile.id;
  const fresh=await api('/api/request?profile='+encodeURIComponent(row.profileId)+'&id='+encodeURIComponent(row.operationId));
  if(!current(epoch,p)||fresh.profileId!==p)return;
  showDetails(fresh);if(fresh.phase==='COMPLETE')return;
  const input=fresh.review.intent;
  if(!declarations().some(d=>d.id===input.beforeObjectSessionId)||!declarations().some(d=>d.id===input.afterObjectSessionId))
   throw new Error('Restore the original host declarations before continuing this saved comparison.');
  clear();before.value=input.beforeObjectSessionId;after.value=input.afterObjectSessionId;
  beforeHash.value=input.beforeExpectedRecordSha256;afterHash.value=input.afterExpectedRecordSha256;id.value=input.id;
  details();persist();present(fresh.review,fresh);root.scrollIntoView({behavior:'smooth',block:'nearest'});
 }
 async function download(row,kind,identity){
  const epoch=generation,p=profile.id;
  const query=new URLSearchParams({profile:row.profileId,id:row.operationId,kind,sha256:identity.sha256});
  const value=await api('/api/object-comparison-artifact?'+query);
  const bytes=new TextEncoder().encode(value.text),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(value.sha256!==identity.sha256||value.bytes!==identity.bytes||bytes.length!==identity.bytes||sha!==identity.sha256||value.mediaType!==identity.mediaType)
   throw new Error('The complete comparison artifact differs from its saved identity.');
  if(!current(epoch,p))return;
  const url=URL.createObjectURL(new Blob([bytes],{type:value.mediaType})),a=el('a');
  a.href=url;a.download=row.operationId+'.'+(kind==='result'?'json':kind==='markdown'?'md':'html');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function requestCard(row){
  const article=el('article',undefined,'request'),head=el('div',undefined,'request-head'),buttons=el('div',undefined,'actions');
  head.append(el('h3',row.operationId,'mono'),el('span',row.phase,'badge'));article.append(head,el('p','Authenticated Object-backup comparison · '+row.updatedAt,'hint'));
  const result=row.operation??row.local?.objectComparisonLastResult;
  article.append(facts({selection:row.review.intent,attempts:row.attempts,authenticated:result?.summary?.authenticated??false,cleanCompletion:result?.ok??false,
   summary:result?.summary??null,process:result?.process??null,artifacts:result?.artifacts??{},error:row.error??result?.error??null}));
  const button=(label,fn,disabled=false)=>{const b=el('button',label);b.type='button';b.disabled=disabled;b.addEventListener('click',()=>task(fn));buttons.append(b);};
  button('Read saved request',async()=>{const epoch=generation,p=profile.id;const value=await api('/api/request?profile='+encodeURIComponent(row.profileId)+'&id='+encodeURIComponent(row.operationId));if(current(epoch,p))showDetails(value);});
  for(const [kind,identity] of Object.entries(result?.artifacts??{}))if(['result','html','markdown'].includes(kind)&&HASH.test(identity?.sha256??''))
   button(kind==='result'?'Download full native result':'Download '+kind+' report',()=>download(row,kind,identity));
  if(row.running)button('Stop owned comparison',async()=>{const epoch=generation,p=profile.id;await post('/api/cancel',{profileId:row.profileId,id:row.operationId});if(current(epoch,p))await refresh();},!!state?.readOnly);
  else if(row.phase!=='COMPLETE')button('Reopen exact attempt',()=>reopen(row),!!state?.readOnly);
  article.append(buttons);return article;
 }
 return {update,isRequest:isComparison,requestCard};
}

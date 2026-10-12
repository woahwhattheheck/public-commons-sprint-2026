// MIT. Quotation page on the original SF74 loopback listener and saved cases.
import {mountCommercialDesk} from './commercial-desk.mjs';
const $=id=>document.getElementById(id),UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
let selectedId='',selectionEpoch=0,nextOffset=null,listEpoch=0,query='',listing=false;
const rows=new Map();
async function response(path,body) {
  const result=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',
    headers:body===undefined?{}:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!result.ok) {
    let value;try{value=await result.json();}catch{value={};}
    throw Object.assign(new Error(value.detail||value.error||'The original merchant request did not complete.'),{
      code:value.error,status:result.status,...(value.requestState?{requestState:value.requestState}:{})});
  }
  return result;
}
async function request(path,body){return (await response(path,body)).json();}
function current(){if(!UUID.test(selectedId))throw new Error('Choose the original saved merchant case.');return selectedId;}
function checked(args,id){if(args.scope?.caseId!==id)throw new Error('Reopen the selected original case before continuing.');return args;}
async function call(action,args={}) {
  const id=current(),token=selectionEpoch;
  const body=checked(args,id);
  const result=await request('/api/cases/'+id+'/commercial/'+action,{
    ...body,...(['save-draft','publish','receive','receive-pricing'].includes(action)?{actor:'Local commercial operator'}:{})});
  if(token!==selectionEpoch)throw new Error('The selected original case changed while the request returned.');
  return result;
}
const desk=mountCommercialDesk({root:$('quotation-root'),services:{
  async read(){const id=current(),token=selectionEpoch;const value=await request('/api/cases/'+id+'/commercial');if(token!==selectionEpoch)throw new Error('The selected original case changed.');return value;},
  preview:args=>call('preview',args),saveDraft:args=>call('save-draft',args),publish:args=>call('publish',args),
  receive:args=>call('receive',args),receivePricing:args=>call('receive-pricing',args),compare:args=>call('compare',args),
  async download(args) {
    const id=current(),token=selectionEpoch;
    const result=await response('/api/cases/'+id+'/commercial/download',checked(args,id));
    if(token!==selectionEpoch)throw new Error('The selected original case changed during its download.');
    const encoded=result.headers.get('x-sf74-file-name'),bytes=result.headers.get('x-sf74-file-bytes');
    if(!encoded||!/^(0|[1-9]\d*)$/.test(bytes??''))throw new Error('The original file descriptor is missing.');
    const descriptor={filename:decodeURIComponent(encoded),bytes:Number(bytes),sha256:result.headers.get('x-content-sha256')};
    return {descriptor,response:result};
  },
}});
function say(value){$('case-status').textContent=value;}
function selectOptions() {
  const selected=$('case-selection').value;
  $('case-selection').replaceChildren(new Option('Choose a case',''),...Array.from(rows.values(),r=>
    new Option(r.name+' · '+(r.metadata?.merchant||r.id)+(r.metadata?.owner?' · '+r.metadata.owner:''),r.id)));
  if(rows.has(selected))$('case-selection').value=selected;
  else if(rows.has(selectedId))$('case-selection').value=selectedId;
  $('more-cases').hidden=nextOffset===null;
}
async function list(more=false) {
  if(listing&&more)return;
  const token=++listEpoch,selectedQuery=$('case-query').value;
  const offset=more&&selectedQuery===query?nextOffset??0:0;
  listing=true;$('more-cases').disabled=true;
  try {
    const result=await request('/api/cases?'+new URLSearchParams({q:selectedQuery,offset:String(offset),limit:'100'}));
    if(token!==listEpoch)return;
    if(result.enabled===false)throw new Error('Open Merchant workspace with its original private case directory.');
    if(!Array.isArray(result.cases))throw new Error('The original case list did not return.');
    if(offset===0)rows.clear();
    for(const row of result.cases)rows.set(row.id,row);
    query=selectedQuery;nextOffset=result.nextOffset;selectOptions();
    say(rows.size+' matching cases loaded'+(Number.isSafeInteger(result.total)?' of '+result.total:'')+'.');
  } catch(error){if(token===listEpoch)say(error.message);}
  finally{if(token===listEpoch){listing=false;$('more-cases').disabled=false;}}
}
async function openCase(id) {
  if(!UUID.test(id??'')){say('Choose an original saved case.');return;}
  selectionEpoch++;desk.clear();selectedId=id;
  const url=new URL(location.href);url.searchParams.set('case',id);history.replaceState(null,'',url);
  say('Opening the saved source and quotation history…');
  await desk.connect();
  if(desk.snapshot().connected)say('Original case '+id+' is open. Changes use its current saved revision.');
}
$('case-search').addEventListener('submit',event=>{event.preventDefault();void list();});
$('more-cases').addEventListener('click',()=>void list(true));
$('open-case').addEventListener('click',()=>void openCase($('case-selection').value));
window.addEventListener('beforeunload',event=>{const state=desk.snapshot();if(state.dirty||state.pending){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>desk.clear());
void (async()=>{
  const health=await request('/health');
  if(!health.casesEnabled){say('Open the original Merchant workspace with its private case directory to work on retained quotations.');return;}
  await list();
  const incoming=new URL(location.href).searchParams.get('case');
  if(incoming)await openCase(incoming);
})().catch(error=>say(error.message));

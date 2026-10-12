// MIT. Named ClinicalTrials routes inside the original authenticated dossier server.
import {need} from './clinical-trials-model.mjs';
const integer=(value,fallback)=>{if(value===null||value===undefined)return fallback;need(/^\d{1,12}$/.test(value),'CLINICALTRIALS_REVIEW_PAGE_INVALID');const n=Number(value);need(Number.isSafeInteger(n),'CLINICALTRIALS_REVIEW_PAGE_INVALID');return n;};
const part=value=>{let result;try{result=decodeURIComponent(value);}catch{need(false,'CLINICALTRIALS_EDITION_ID_INVALID');}need(result.length>0&&result.length<=160&&!/[\x00-\x1f\x7f/\\]/.test(result),'CLINICALTRIALS_EDITION_ID_INVALID');return result;};
export async function handleClinicalTrialsRoute({workspace,dossierId,action,req,url,readBody,send}){
 if(!action.startsWith('clinical-trials/'))return false;
 const route=action.slice('clinical-trials/'.length),paging={offset:integer(url.searchParams.get('offset'),0),limit:integer(url.searchParams.get('limit'),50)};
 if(route==='inputs'&&req.method==='POST'){
  need((req.headers['content-type']??'').split(';')[0]==='application/octet-stream','CLINICALTRIALS_PACKET_BODY_REQUIRED');
  const expectedSha256=url.searchParams.get('sha256'),expectedBytes=integer(url.searchParams.get('bytes'),null);
  need(expectedBytes!==null&&expectedBytes>0&&expectedBytes<=128*1024*1024,'CLINICALTRIALS_PACKET_SIZE_INVALID');
  send(201,await workspace.importInput(req,{expectedSha256,expectedBytes}));return true;
 }
 if(req.method==='GET'){
  if(route==='inputs'){send(200,await workspace.inputs({after:url.searchParams.get('after')??'',limit:integer(url.searchParams.get('limit'),30)}));return true;}
  const input=route.match(/^inputs\/(ctsrc_[a-f0-9]{64})(?:\/(packet))?$/);
  if(input){
   if(input[2]){const value=await workspace.sourcePacket(input[1]);send(200,value.bytes,'application/zip',value.filename);}
   else send(200,await workspace.input(input[1]));return true;
  }
  if(route==='operations'){send(200,await workspace.list(dossierId,{after:url.searchParams.get('after')??'',limit:integer(url.searchParams.get('limit'),30)}));return true;}
  if(route==='retained'){send(200,await workspace.retainedList(dossierId));return true;}
  if(route==='retained/compare'){send(200,await workspace.compareRetained(dossierId,part(url.searchParams.get('before')??''),part(url.searchParams.get('after')??'')));return true;}
  const retained=route.match(/^retained\/([^/]+)(?:\/(edition|record|packet))?$/);
  if(retained){
   const editionId=part(retained[1]);
   if(retained[2]==='edition'){const value=await workspace.retainedEdition(dossierId,editionId);send(200,value.bytes,'application/json; charset=utf-8',editionId+'.clinicaltrials.json');}
   else if(retained[2]==='packet'){const value=await workspace.retainedPacket(dossierId,editionId);send(200,value.bytes,'application/zip',value.filename);}
   else if(retained[2]==='record')send(200,await workspace.retainedRecord(dossierId,editionId,integer(url.searchParams.get('index'),-1)));
   else send(200,await workspace.retainedReview(dossierId,editionId,paging));
   return true;
  }
 }
 if(route==='prepare'&&req.method==='POST'){send(201,await workspace.prepare(dossierId,await readBody()));return true;}
 const operation=route.match(/^operations\/(ct_[a-f0-9]{64})(?:\/(start|stop|receive|edition|record|compare))?$/);
 if(operation){
  const id=operation[1],verb=operation[2],selected=await workspace.inspect(id,{probe:false});
  need(selected.plan.payload.dossierId===dossierId,'CLINICALTRIALS_OPERATION_DOSSIER_MISMATCH');
  if(req.method==='GET'){
   if(!verb)send(200,await workspace.review(id,paging));
   else if(verb==='edition'){const value=await workspace.edition(id);send(200,value.bytes,'application/json; charset=utf-8',id+'.clinicaltrials.json');}
   else if(verb==='record')send(200,await workspace.record(id,integer(url.searchParams.get('index'),-1)));
   else if(verb==='compare')send(200,await workspace.compare(id,url.searchParams.get('before')));
   else {send(405,{error:'METHOD_NOT_ALLOWED'});return true;}
   return true;
  }
  if(req.method==='POST'){
   const data=await readBody();
   const allowed=verb==='receive'?['expectedPlanSha256','expectedEditionSha256','expectedRevision']:verb==='stop'?[]:['expectedPlanSha256'];
   need(Object.keys(data).every(key=>allowed.includes(key)),'CLINICALTRIALS_OPERATION_FIELDS_INVALID');
   if(verb==='start')send(202,await workspace.start(id,data));
   else if(verb==='stop')send(200,await workspace.stop(id));
   else if(verb==='receive')send(200,await workspace.receive(id,data));
   else send(405,{error:'METHOD_NOT_ALLOWED'});
   return true;
  }
 }
 send(req.method==='GET'||req.method==='POST'?404:405,{error:req.method==='GET'||req.method==='POST'?'ROUTE_NOT_FOUND':'METHOD_NOT_ALLOWED'});return true;
}

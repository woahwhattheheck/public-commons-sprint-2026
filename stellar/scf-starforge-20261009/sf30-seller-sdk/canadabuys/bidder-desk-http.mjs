// MIT. Bidder-desk routes use the same authenticated loopback origin and saved workspace.
import { failure } from './core.mjs';
function integer(value,name,fallback){
 if(value===null||value===undefined)return fallback;
 if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw failure('INVALID_NUMBER',name+' must be a nonnegative safe integer');
 return Number(value);
}
export async function routeBidderDesk({workspace,request,response,url,requestJSON,sendJSON,attachment,maxRequestBytes}){
 if(!url.pathname.startsWith('/api/bidder/'))return false;
 const desk=workspace.bidderDesk,method=request.method,segments=url.pathname.slice('/api/bidder/'.length).split('/').map(decodeURIComponent);
 const query=url.searchParams;
 const read=()=>requestJSON(request,maxRequestBytes);
 if(method==='GET'&&segments.length===1&&segments[0]==='status'){sendJSON(response,200,desk.status());return true;}
 if(method==='POST'&&segments.length===1&&segments[0]==='evidence-intake'){sendJSON(response,200,desk.intakeEvidence(await read()));return true;}
 if(method==='POST'&&segments.length===1&&segments[0]==='assess'){sendJSON(response,200,desk.assess(await read()));return true;}
 if(method==='POST'&&segments.length===1&&segments[0]==='fit'){
  const body=await read();sendJSON(response,200,desk.fit(body.profileId,body));return true;
 }
 if(segments[0]==='records'&&(segments.length===2||segments.length===3)){
  const [,kind,id]=segments;
  if(method==='GET'){
   const result=id?desk.get(kind,id,{revision:integer(query.get('revision'),'revision'),history:query.get('history')==='true'})
    :desk.list(kind,{noticeId:query.get('noticeId')??undefined,offset:integer(query.get('offset'),'offset',0),limit:integer(query.get('limit'),'limit',100)});
   sendJSON(response,200,result);return true;
  }
  if(method==='POST'&&!id){sendJSON(response,200,desk.create(kind,await read()));return true;}
  if(method==='PATCH'&&id){sendJSON(response,200,desk.update(kind,id,await read()));return true;}
 }
 if(method==='GET'&&segments[0]==='evidence'&&segments.length===3&&segments[2]==='file'){
  attachment(response,desk.evidenceFile(segments[1],{revision:integer(query.get('revision'),'revision')}));return true;
 }
 if(method==='GET'&&segments[0]==='decisions'&&segments.length===3){
  if(segments[2]==='compare'){sendJSON(response,200,desk.compareCurrent(segments[1]));return true;}
  if(segments[2]==='report'){
   attachment(response,desk.report(segments[1],{revision:integer(query.get('revision'),'revision'),format:query.get('format')||'html'}));return true;
  }
 }
 throw failure('NOT_FOUND','Bidder desk route does not exist',404);
}

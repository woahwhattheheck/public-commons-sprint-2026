// MIT. Private HTTP operator over the original opportunity/source/dossier model.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {openOpportunityStore} from './model.mjs';
import {renderOpportunityHtml,renderOpportunityMarkdown,renderOpportunityCsv} from './package.mjs';

const WEB=fileURLToPath(new URL('./web/',import.meta.url));
const TYPES=Object.freeze({'index.html':'text/html; charset=utf-8','app.js':'text/javascript; charset=utf-8','style.css':'text/css; charset=utf-8'});
const CONTROL_LIMIT=2*1024*1024;
const DISPATCH_LIMIT=96*1024*1024;
const PORTABLE_LIMIT=256*1024*1024+65536;
const ACTIONS=new Set(['create','update','retain_source','import_award_edition','save_capability','save_requirement','save_coverage','save_team','save_milestone','save_question','review_change','create_package','read_source','source','compare']);
const FORMATS=new Set(['portable','html','markdown','requirements','capabilities','teaming','milestones','questions']);
const FILES=Object.freeze({html:'handoff.html',markdown:'handoff.md',requirements:'requirements.csv',capabilities:'capabilities.csv',teaming:'teaming.csv',milestones:'milestones.csv',questions:'questions.csv'});
const MEDIA=Object.freeze({portable:'application/json; charset=utf-8',html:'text/html; charset=utf-8',markdown:'text/markdown; charset=utf-8',requirements:'text/csv; charset=utf-8',capabilities:'text/csv; charset=utf-8',teaming:'text/csv; charset=utf-8',milestones:'text/csv; charset=utf-8',questions:'text/csv; charset=utf-8'});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const need=(condition,code)=>{if(!condition)fail(code);};
const json=value=>Buffer.from(JSON.stringify(value)+'\n');
const safeCode=error=>typeof error?.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(error.code)?error.code:'OPPORTUNITY_OPERATION_FAILED';
const statusFor=code=>code==='AUTH_REQUIRED'?401:/HOST_REFUSED|ORIGIN_REFUSED/.test(code)?403:/NOT_FOUND/.test(code)?404:/CONFLICT|HISTORY_CHANGED|SOURCE_CHANGED|DIVERGED|ALREADY_EXISTS/.test(code)?409:/TOO_LARGE|SIZE_LIMIT/.test(code)?413:code==='WORKSPACE_CLOSING'?503:code==='OPPORTUNITY_OPERATION_FAILED'?500:400;
const messageFor=code=>({
  AUTH_REQUIRED:'The private operator token is required.',
  HOST_REFUSED:'Use the original loopback workspace URL.',
  ORIGIN_REFUSED:'Use the original workspace origin.',
  REVISION_CONFLICT:'The project changed after this editor was opened. Refresh the original project before applying the intended change.',
  JSON_BODY_REQUIRED:'Send a complete application/json request.',
  JSON_INVALID:'The request must contain complete UTF-8 JSON.',
  REQUEST_BODY_TOO_LARGE:'The selected request exceeds the workspace receiving capacity.',
  WORKSPACE_CLOSING:'The workspace is closing. Reopen the original operating directory to continue.',
  OPPORTUNITY_OPERATION_FAILED:'The operating request did not complete. Its saved state remains available in the original workspace.'
}[code]||code.toLowerCase().replaceAll('_',' '));
function absolute(value,name){
  need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value,name+'_ABSOLUTE_PATH_REQUIRED');return value;
}
function pathId(value){
  let id;try{id=decodeURIComponent(value);}catch{fail('PROJECT_ID_INVALID');}
  need(/^opp_[a-f0-9-]{36}$/.test(id),'PROJECT_ID_INVALID');return id;
}
function revision(value){
  need(typeof value==='string'&&/^[1-9][0-9]{0,7}$/.test(value),'REVISION_INVALID');return Number(value);
}
function downloadName(project,format,packageId){
  const name=String(project.title||'opportunity').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90)||'opportunity';
  return name+'-'+(packageId?'package':format)+'-r'+project.revision+(format==='portable'?'.json':format==='html'?'.html':format==='markdown'?'.md':'.csv');
}
async function body(req,limit){
  const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  need(type==='application/json','JSON_BODY_REQUIRED');
  const declared=req.headers['content-length'];
  if(declared!==undefined){need(/^\d+$/.test(declared),'CONTENT_LENGTH_INVALID');need(Number(declared)<=limit,'REQUEST_BODY_TOO_LARGE');}
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;need(size<=limit,'REQUEST_BODY_TOO_LARGE');chunks.push(chunk);}
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}catch{fail('JSON_INVALID');}
  need(plain(value),'JSON_OBJECT_REQUIRED');return value;
}
/** Return exact named handoff files or render the selected current/historical project. */
export async function opportunityExport(store,id,{format='portable',packageId,revision:selectedRevision}={}){
  need(FORMATS.has(format),'EXPORT_FORMAT_INVALID');
  need(!(packageId&&selectedRevision!==undefined),'ONE_EXPORT_SELECTION_REQUIRED');
  if(packageId!==undefined)need(typeof packageId==='string'&&/^pkg_[a-f0-9-]{36}$/.test(packageId),'PACKAGE_ID_INVALID');
  if(format==='portable'||packageId){
    const packet=await store.exportPackage(id,{...(packageId?{packageId}:{}),...(selectedRevision===undefined?{}:{revision:selectedRevision})});
    const project=packet.project;
    need(plain(project)&&project.id===id,'PACKAGE_PROJECT_INVALID');
    if(format==='portable')return {bytes:json(packet),mediaType:MEDIA.portable,filename:downloadName(project,format,packageId),revision:project.revision};
    const file=packet.files.find(entry=>entry.path===FILES[format]);
    need(file&&typeof file.contentBase64==='string','PACKAGE_FILE_NOT_FOUND');
    const bytes=Buffer.from(file.contentBase64,'base64');
    need(bytes.length===file.bytes,'PACKAGE_FILE_SIZE_CHANGED');
    return {bytes,mediaType:MEDIA[format],filename:downloadName(project,format,packageId),revision:project.revision};
  }
  const project=await store.get(id,selectedRevision===undefined?{}:{revision:selectedRevision});
  const output=format==='html'?renderOpportunityHtml(project):format==='markdown'?renderOpportunityMarkdown(project):renderOpportunityCsv(project,format);
  const bytes=Buffer.isBuffer(output)?output:Buffer.from(output);
  return {bytes,mediaType:MEDIA[format],filename:downloadName(project,format),revision:project.revision};
}

/** An injected store is borrowed; this launcher closes only the store it opens. */
export async function startOpportunityWorkspace({directory,operator='Opportunity operator',dossierDirectory,awardDirectory,port=0,store:providedStore}={}){
  absolute(directory,'WORKSPACE');
  if(dossierDirectory!==undefined)absolute(dossierDirectory,'DOSSIER');
  if(awardDirectory!==undefined)absolute(awardDirectory,'AWARD_WORKSPACE');
  need(Number.isInteger(port)&&port>=0&&port<=65535,'WORKSPACE_PORT_INVALID');
  need(typeof operator==='string'&&operator.trim()&&operator.length<=240,'OPERATOR_REQUIRED');
  const owned=!providedStore;
  const store=providedStore??await openOpportunityStore({directory,operator,dossierDirectory,awardDirectory});
  need(store&&['list','get','dispatch','exportPackage','importPackage','close'].every(name=>typeof store[name]==='function'),'OPPORTUNITY_STORE_REQUIRED');
  try{await store.list();}catch(error){if(owned)await store.close().catch(()=>{});throw error;}
  const token=randomBytes(32).toString('hex'),expected=Buffer.from('Bearer '+token);
  const active=new Set();let origin='',closing=false,closed;
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
  const handle=async(req,res)=>{
    const send=(status,value,type='application/json; charset=utf-8',filename)=>{
      if(res.destroyed||res.writableEnded)return;
      const bytes=Buffer.isBuffer(value)?value:json(value);
      res.writeHead(status,{...headers,'Content-Type':type,'Content-Length':bytes.length,
        ...(filename?{'Content-Disposition':'attachment; filename="'+filename+'"'}:{})});
      res.end(req.method==='HEAD'?undefined:bytes);
    };
    try{
      need(!closing,'WORKSPACE_CLOSING');need(origin&&req.headers.host===new URL(origin).host,'HOST_REFUSED');
      need(!req.headers.origin||req.headers.origin===origin,'ORIGIN_REFUSED');
      need(typeof req.url==='string'&&req.url.startsWith('/')&&!req.url.startsWith('//'),'REQUEST_TARGET_INVALID');
      const url=new URL(req.url,origin),path=url.pathname;
      if(['GET','HEAD'].includes(req.method)&&(path==='/'||Object.hasOwn(TYPES,path.slice(1)))){
        const file=path==='/'?'index.html':path.slice(1);
        send(200,await readFile(join(WEB,file)),TYPES[file]);return;
      }
      if(['GET','HEAD'].includes(req.method)&&path==='/guide'){
        send(200,await readFile(fileURLToPath(new URL('./README.md',import.meta.url))),'text/plain; charset=utf-8');return;
      }
      const supplied=Buffer.from(typeof req.headers.authorization==='string'?req.headers.authorization:'');
      need(supplied.length===expected.length&&timingSafeEqual(supplied,expected),'AUTH_REQUIRED');
      if(req.method==='GET'&&path==='/api/projects'){send(200,{projects:await store.list(),operator});return;}
      if(req.method==='POST'&&path==='/api/dispatch'){
        const input=await body(req,DISPATCH_LIMIT);
        need(typeof input.action==='string'&&ACTIONS.has(input.action),'ACTION_INVALID');
        need(plain(input.payload),'ACTION_PAYLOAD_REQUIRED');
        send(input.action==='create'?201:200,await store.dispatch(input.action,input.payload));return;
      }
      if(req.method==='POST'&&path==='/api/projects'){
        const input=await body(req,CONTROL_LIMIT);send(201,await store.dispatch('create',input));return;
      }
      if(req.method==='POST'&&path==='/api/receive'){
        const input=await body(req,PORTABLE_LIMIT);need(plain(input.packet),'PORTABLE_PACKAGE_REQUIRED');
        send(200,await store.importPackage(input.packet));return;
      }
      const match=path.match(/^\/api\/projects\/([^/]+)(?:\/(export))?$/);
      if(req.method==='GET'&&match){
        const id=pathId(match[1]);
        const selectedRevision=url.searchParams.has('revision')?revision(url.searchParams.get('revision')):undefined;
        if(!match[2]){send(200,await store.get(id,selectedRevision===undefined?{}:{revision:selectedRevision}));return;}
        const data=await opportunityExport(store,id,{format:url.searchParams.get('format')||'portable',packageId:url.searchParams.get('packageId')||undefined,revision:selectedRevision});
        send(200,data.bytes,data.mediaType,data.filename);return;
      }
      send(404,{error:'ROUTE_NOT_FOUND',message:'The requested workspace route does not exist.'});
    }catch(error){const code=safeCode(error);send(statusFor(code),{error:code,message:messageFor(code)});}
  };
  const server=createServer((req,res)=>{
    const task=handle(req,res);active.add(task);task.then(()=>active.delete(task),()=>active.delete(task));
  });
  server.requestTimeout=120000;server.headersTimeout=20000;server.keepAliveTimeout=5000;server.maxHeadersCount=64;
  try{
    await new Promise((resolveListen,reject)=>{
      const error=e=>reject(e);server.once('error',error);
      server.listen(port,'127.0.0.1',()=>{server.off('error',error);resolveListen();});
    });
    origin='http://127.0.0.1:'+server.address().port;
  }catch(error){server.close();if(owned)await store.close().catch(()=>{});throw error;}
  const close=()=>{
    if(closed)return closed;
    closing=true;
    closed=(async()=>{
      const stopped=new Promise(resolveStop=>server.close(resolveStop));
      server.closeIdleConnections();
      let failure;
      try{await Promise.allSettled([...active]);if(owned)await store.close();}
      catch(error){failure=error;}
      finally{server.closeAllConnections();await stopped;}
      if(failure)throw failure;
    })();
    return closed;
  };
  return Object.freeze({directory,operator,origin,url:origin+'/#token='+token,server,store,close});
}

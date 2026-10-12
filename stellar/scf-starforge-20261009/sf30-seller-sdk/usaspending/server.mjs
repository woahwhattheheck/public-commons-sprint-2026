// MIT. Private loopback operator for the durable award research workspace.
import { createServer } from 'node:http';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { requireThat, plain, integer, csv, publicRow, COLUMNS, now } from './core.mjs';
import { prepareMerchant, adoptDelivery, previewMerchant } from './merchant.mjs';
import { detailReceipt } from './source-import.mjs';
import { workshareBrief } from './brief.mjs';

const STATIC=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
const WEB=fileURLToPath(new URL('./web/',import.meta.url));
const LIMIT=128*1024*1024;
function jsonError(error){return {error:error.code??'OPERATION_FAILED',message:error.message,captureId:error.captureId??null,providerStatus:error.providerStatus??null,retryAt:error.retryAt??null};}
async function readBody(req){
  requireThat((req.headers['content-type']??'').split(';')[0]==='application/json','JSON_REQUIRED','Use application/json',415);
  const chunks=[];let length=0;
  for await(const part of req){length+=part.length;requireThat(length<=LIMIT,'INPUT_TOO_LARGE',undefined,413);chunks.push(part);}
  requireThat(length>0,'BODY_REQUIRED');const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,length)));
  requireThat(plain(value),'OBJECT_REQUIRED');return value;
}
export async function serveWorkspace(workspace,{port=8783,receivingRoot}={}){
  integer(port,'Port',0,65535);const secret=randomBytes(32).toString('base64url'),jobs=new Map(),pending=new Set(),startedAt=now();
  const receiving=receivingRoot?await realpath(resolve(receivingRoot)):null;
  let origin,closed=false,closing;
  function send(res,status,value,{type='application/json; charset=utf-8',filename}={}){
    const body=Buffer.isBuffer(value)?value:Buffer.from(type.startsWith('application/json')?JSON.stringify(value):String(value));
    res.writeHead(status,{'content-type':type,'content-length':body.length,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',...(filename?{'content-disposition':'attachment; filename="'+filename+'"'}:{})});res.end(body);
  }
  function authorize(req){
    const supplied=req.headers['x-research-token'];requireThat(typeof supplied==='string','AUTH_REQUIRED','Open the original workspace launch link',401);
    const a=Buffer.from(supplied),b=Buffer.from(secret);requireThat(a.length===b.length&&timingSafeEqual(a,b),'AUTH_INVALID',undefined,401);
    requireThat(!req.headers.origin||req.headers.origin===origin,'ORIGIN_REJECTED',undefined,403);
  }
  function startJob(type,fn){
    const job={id:'J-'+randomUUID(),type,status:'running',startedAt:now(),finishedAt:null,result:null,error:null},controller=new AbortController();jobs.set(job.id,{job,controller});
    const promise=Promise.resolve().then(()=>fn(controller.signal)).then(result=>{job.status='complete';job.result=result;return result;},error=>{job.status=controller.signal.aborted?'paused':'error';job.error=jsonError(error);}).finally(()=>{job.finishedAt=now();pending.delete(promise);});
    pending.add(promise);return {...job};
  }
  function knownMerchant(mid){
    const publication=workspace.state().publications.find(p=>p.data.merchantId===mid);requireThat(publication,'MERCHANT_NOT_FOUND',undefined,404);return publication.data.directory;
  }
  async function receivingDirectory(name){
    requireThat(receiving,'RECEIVING_ROOT_REQUIRED','Start the operator with its original receiving folder',409);
    requireThat(typeof name==='string'&&name===basename(name)&&name!=='.'&&name!=='..'&&!name.startsWith('.'),'DELIVERY_NAME_INVALID');
    const path=await realpath(join(receiving,name));requireThat(path.startsWith(receiving+'/'),'DELIVERY_OUTSIDE_RECEIVING_ROOT');return path;
  }
  const server=createServer((req,res)=>{Promise.resolve().then(async()=>{
    requireThat(!closed,'WORKSPACE_CLOSING',undefined,503);
    requireThat(req.headers.host===new URL(origin).host,'HOST_REJECTED',undefined,403);
    const url=new URL(req.url,origin),path=url.pathname;
    if(req.method==='GET'&&STATIC.has(path)){
      const [file,type]=STATIC.get(path),bytes=await readFile(join(WEB,file));
      res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      return send(res,200,bytes,{type});
    }
    authorize(req);
    if(req.method==='GET'){
      if(path==='/api/state')return send(res,200,{...workspace.state(),server:{startedAt,receivingEnabled:!!receiving},jobs:[...jobs.values()].map(v=>v.job)});
      if(path==='/api/rows'){
        const opts=Object.fromEntries(url.searchParams);requireThat(opts.edition,'EDITION_REQUIRED');const {edition,...rest}=opts;
        for(const key of ['page','limit'])if(rest[key]!==undefined)rest[key]=Number(rest[key]);
        return send(res,200,workspace.browse(edition,rest));
      }
      if(path==='/api/overview')return send(res,200,workspace.overview(url.searchParams.get('edition')));
      if(path==='/api/award')return send(res,200,workspace.row(url.searchParams.get('edition'),url.searchParams.get('key')));
      if(path==='/api/compare')return send(res,200,workspace.compare(url.searchParams.get('before'),url.searchParams.get('after')));
      if(path==='/api/history')return send(res,200,workspace.history({...(url.searchParams.has('key')?{award_key:url.searchParams.get('key')}:{})}));
      if(path==='/api/coverage'){const packet=workspace.exportEdition(url.searchParams.get('edition'),{includeSourceBytes:false});return send(res,200,{coverage:packet.coverage,warnings:packet.warnings});}
      if(path==='/api/source'){
        const s=workspace.sourcePage(url.searchParams.get('capture'),Number(url.searchParams.get('page')));
        return send(res,200,s.response,{filename:s.capture_id+'-page-'+s.page+'.json'});
      }
      if(path==='/api/edition-export'){
        const eid=url.searchParams.get('edition'),format=url.searchParams.get('format')??'json';
        if(format==='csv')return send(res,200,csv(workspace.rows(eid).map(publicRow),COLUMNS,{spreadsheet:true}),{type:'text/csv; charset=utf-8',filename:eid+'.csv'});
        requireThat(format==='json','EXPORT_FORMAT_INVALID');return send(res,200,workspace.exportEdition(eid,{includeReviews:url.searchParams.get('reviews')==='true'}),{filename:eid+'.json'});
      }
      if(path==='/api/brief'){const eid=url.searchParams.get('edition'),key=url.searchParams.get('key');return send(res,200,workshareBrief(workspace,eid,key),{type:'text/markdown; charset=utf-8',filename:'workshare-'+eid+'.md'});}
      if(path==='/api/backup')return send(res,200,workspace.exportPacket(),{filename:'award-research-'+workspace.state().id+'.json'});
      if(path==='/api/receiving'){
        const entries=receiving?await readdir(receiving,{withFileTypes:true}):[],deliveries=[];
        for(const entry of entries.filter(e=>e.isDirectory()&&!e.name.startsWith('.')).slice(0,500)){const child=join(receiving,entry.name);try{const info=await stat(join(child,'manifest.json'));if(info.isFile())deliveries.push({name:entry.name,manifestBytes:info.size});}catch{}}
        return send(res,200,{enabled:!!receiving,deliveries});
      }
      throw Object.assign(new Error('Unknown operation'),{code:'NOT_FOUND',status:404});
    }
    requireThat(req.method==='POST','METHOD_NOT_ALLOWED',undefined,405);
    const body=await readBody(req);
    if(path==='/api/queries')return send(res,200,workspace.saveQuery(body));
    if(path==='/api/captures')return send(res,202,startJob('provider_capture',signal=>workspace.runCapture(body,{signal})));
    if(path==='/api/cancel-capture')return send(res,200,workspace.cancel(body.captureId));
    if(path==='/api/capacity')return send(res,200,workspace.resizeCapture(body));
    if(path==='/api/cancel-job'){const holder=jobs.get(body.jobId);requireThat(holder&&holder.job.status==='running','JOB_NOT_RUNNING',undefined,409);holder.controller.abort(new Error('Operator paused this job'));return send(res,200,{jobId:body.jobId,status:'pausing'});}
    if(path==='/api/reviews')return send(res,200,workspace.saveReview(body));
    if(path==='/api/enrich')return send(res,202,startJob('award_details',signal=>workspace.enrich(body.editionId,body.keys,{signal})));
    if(path==='/api/select-edition')return send(res,200,workspace.selectEdition(body.editionId,{awardKeys:body.awardKeys,name:body.name}));
    if(path==='/api/attach-details')return send(res,200,workspace.attachDetails(body.editionId,body.detailIds));
    if(path==='/api/import-capture')return send(res,200,workspace.importCapturedPages(body));
    if(path==='/api/import-detail'){const bytes=Buffer.from(body.responseBase64,'base64');return send(res,200,workspace.importDetail({bytes,receipt:body.receipt?.http_status?detailReceipt(body.receipt,bytes):body.receipt,name:body.name}));}
    if(path==='/api/merchant')return send(res,202,startJob('merchant_prepare',()=>prepareMerchant(workspace,body.editionId,body.options??{})));
    if(path==='/api/merchant-preview')return send(res,200,await previewMerchant(knownMerchant(body.merchantId),body.query??{}));
    if(path==='/api/adopt-delivery'){const directory=await receivingDirectory(body.name);return send(res,202,startJob('native_delivery_adoption',()=>adoptDelivery(workspace,directory)));}
    if(path==='/api/restore'){requireThat(pending.size===0,'OPERATIONS_ACTIVE',undefined,409);return send(res,200,workspace.restorePacket(body));}
    throw Object.assign(new Error('Unknown operation'),{code:'NOT_FOUND',status:404});
  }).catch(error=>{if(!res.headersSent)send(res,error.status??400,jsonError(error));else res.destroy();});});
  server.requestTimeout=120000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
  origin='http://127.0.0.1:'+server.address().port;
  const close=()=>closing??=(async()=>{closed=true;for(const {controller}of jobs.values())controller.abort(new Error('Operator closed this workspace'));for(const controller of workspace.active.values())controller.abort(new Error('Workspace closing'));await Promise.allSettled([...pending]);await new Promise((yes,no)=>{server.close(error=>error?no(error):yes());server.closeIdleConnections();});workspace.close();return {closed:true};})();
  return {server,origin,url:origin+'/#'+secret,close};
}

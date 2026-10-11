// MIT. Private loopback operator UI; the original native workspace owns execution.
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {FAMILIES,VARIABLES,ATTRIBUTION,need,keys,sha} from './contract.mjs';
import {cleanResult,safeCode,withoutRaw,verifyWeather} from './workspace.mjs';
import {chartSvg,seriesCsv,frozenReportBytes} from './exports.mjs';
import {series} from './analysis.mjs';
const own=fileURLToPath(new URL('.',import.meta.url));
const equal=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const json=(response,status,value)=>send(response,status,Buffer.from(JSON.stringify(cleanResult(value))+'\n'),'application/json; charset=utf-8');
function send(response,status,body,type,extra={}){
 response.writeHead(status,{'content-type':type,'content-length':body.length,'cache-control':'no-store','x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",...extra});response.end(body);
}
async function requestJson(request){
 need(/^application\/json(?:;|$)/i.test(request.headers['content-type']??''),'JSON_BODY_REQUIRED');
 const chunks=[];let bytes=0;for await(const chunk of request){bytes+=chunk.length;need(bytes<=65536,'REQUEST_TOO_LARGE');chunks.push(chunk);}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
export async function startWeatherServer({workspace,port=0}){
 need(Number.isSafeInteger(port)&&port>=0&&port<=65535,'PORT_INVALID');
 const bootstrap=randomBytes(32).toString('hex'),session=randomBytes(32).toString('hex'),pending=new Set();
 const assets=new Map(await Promise.all([['/','index.html','text/html; charset=utf-8'],['/app.js','app.js','text/javascript; charset=utf-8'],['/app.css','app.css','text/css; charset=utf-8']].map(async([url,file,type])=>[url,{body:await readFile(join(own,file)),type}])));
 let origin,closing=false;
 const server=createServer((req,res)=>{
  const task=handle(req,res).catch(error=>{if(!res.headersSent)json(res,/NOT_FOUND$/.test(safeCode(error))?404:409,{error:safeCode(error)});else res.destroy();});
  pending.add(task);task.finally(()=>pending.delete(task)).catch(()=>{});
 });
 server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
 async function handle(request,response){
  need(!closing,'WEATHER_SERVER_CLOSING');need(request.headers.host===new URL(origin).host,'LOCAL_HOST_REQUIRED');
  const url=new URL(request.url,origin);need(url.origin===origin,'LOCAL_ORIGIN_REQUIRED');
  need(!request.headers.origin||request.headers.origin===origin,'LOCAL_ORIGIN_REQUIRED');
  need(request.headers['sec-fetch-site']!=='cross-site','LOCAL_SESSION_REQUIRED');
  if(request.method==='GET'&&url.pathname==='/'&&url.searchParams.has('access')){
   need(url.searchParams.size===1&&equal(url.searchParams.get('access'),bootstrap),'LAUNCH_CAPABILITY_INVALID');
   response.writeHead(303,{location:'/', 'set-cookie':'weather_session='+session+'; HttpOnly; SameSite=Strict; Path=/',
    'cache-control':'no-store','referrer-policy':'no-referrer'});response.end();return;
  }
  const cookies=String(request.headers.cookie??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith('weather_session='));
  need(cookies.length===1&&equal(cookies[0].slice('weather_session='.length),session),'LOCAL_SESSION_REQUIRED');
  if(request.method==='POST')need(request.headers.origin===origin,'LOCAL_ORIGIN_REQUIRED');
  if(request.method==='GET'){
   if(assets.has(url.pathname)){need(!url.search,'UNEXPECTED_QUERY');const a=assets.get(url.pathname);send(response,200,a.body,a.type);return;}
   if(url.pathname==='/api/meta'){json(response,200,{families:FAMILIES,variables:VARIABLES,attribution:ATTRIBUTION,providerMode:workspace.settings.provider.mode});return;}
   if(url.pathname==='/api/state'){json(response,200,await workspace.summary());return;}
   if(url.pathname==='/api/job'){json(response,200,workspace.job());return;}
   if(url.pathname==='/api/events'){json(response,200,await workspace.events({after:Number(url.searchParams.get('after')??0),limit:Number(url.searchParams.get('limit')??100)}));return;}
   if(url.pathname==='/api/compare'){json(response,200,await workspace.compare(url.searchParams.get('left'),url.searchParams.get('right'),{variable:url.searchParams.get('variable'),...(url.searchParams.has('unit')?{unit:url.searchParams.get('unit')}:{})}));return;}
   let matched=url.pathname.match(/^\/api\/captures\/(capture-[a-f0-9-]{36})(?:\/(raw|csv))?$/);
   if(matched){
    const result=await workspace.serial(()=>{
     const capture=workspace.store.capture(matched[1]);
     if(matched[2]==='raw')return {bytes:capture.raw,type:'application/json',name:capture.id+'.json'};
     if(matched[2]==='csv')return {bytes:seriesCsv(capture),type:'text/csv; charset=utf-8',name:capture.id+'.csv'};
     const variable=url.searchParams.get('variable')??capture.view.request.variables[0],unit=url.searchParams.get('unit')??undefined;
     return {capture:withoutRaw(capture),series:series(capture.view,variable,{unit,limit:2000}),chart:chartSvg(capture,variable,{unit})};
    });
    if(result.bytes)send(response,200,result.bytes,result.type,{'content-disposition':'attachment; filename="'+result.name+'"','x-content-sha256':sha(result.bytes)});
    else json(response,200,result);return;
   }
   matched=url.pathname.match(/^\/api\/reports\/(report-[a-f0-9-]{36})\/download$/);
   if(matched){
    const format=url.searchParams.get('format')??'zip';need(['zip','html','json'].includes(format),'REPORT_FORMAT_INVALID');
    const bytes=await workspace.serial(async()=>{const report=workspace.store.report(matched[1]),captures=report.captures.map(c=>workspace.store.capture(c.id));return frozenReportBytes(report,captures,{format});});
    send(response,200,bytes,format==='zip'?'application/zip':format==='html'?'text/html; charset=utf-8':'application/json',
     {'content-disposition':'attachment; filename="'+matched[1]+'.'+format+'"','x-content-sha256':sha(bytes)});return;
   }
  }
  if(request.method==='POST'){
   const body=await requestJson(request);
   const mutations={'/api/sites':'saveSite','/api/requests':'saveRequest','/api/decisions':'saveDecision','/api/reports':'freezeReport'};
   if(mutations[url.pathname]){json(response,200,await workspace[mutations[url.pathname]](body));return;}
   if(url.pathname==='/api/cancel'){keys(body,['id']);json(response,200,workspace.cancel(body.id));return;}
   if(url.pathname==='/api/jobs'){
    keys(body,['kind','requestId','args']);const args=body.args??{};
    let operation;
    if(body.kind==='source'){keys(args,['expectedRevision']);operation=signal=>workspace.sourceCapture(body.requestId,{...args,signal});}
    else if(body.kind==='source-reprocess'){keys(args,['expectedRevision']);operation=()=>workspace.reprocessSource(body.requestId,args);}
    else if(body.kind==='prepare'){keys(args,['expectedRevision','maxAtomic','acceptIndex','directEvaluation']);operation=signal=>workspace.prepare(body.requestId,{...args,signal});}
    else if(body.kind==='execute'){keys(args,[]);operation=signal=>workspace.execute(body.requestId,{signal});}
    else if(body.kind==='recover'){keys(args,[]);operation=()=>workspace.recover(body.requestId);}
    else if(body.kind==='recovery-review'){keys(args,[]);operation=()=>workspace.recoveryReview();}
    else if(body.kind==='recovery-snapshot'){keys(args,['output','passphraseEnv']);operation=signal=>workspace.snapshot({...args,signal});}
    else if(body.kind==='recovery-verify'){keys(args,['bundle','expectedRecordSha256','passphraseEnv']);operation=signal=>verifyWeather({...args,environment:workspace.environment,signal});}
    else need(false,'WEATHER_JOB_UNKNOWN');
    json(response,202,workspace.start(body.kind,operation));return;
   }
  }
  json(response,404,{error:'WEATHER_ROUTE_NOT_FOUND'});
 }
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port;
 return {origin,url:origin+'/?access='+bootstrap,workspace,
  async close(){
   if(closing)return;closing=true;workspace.active?.controller.abort(Object.assign(new Error('OPERATOR_CLOSED'),{code:'OPERATOR_CLOSED'}));
   const stopped=new Promise(resolve=>server.close(resolve));server.closeIdleConnections();
   while(pending.size)await Promise.allSettled([...pending]);await workspace.close();server.closeIdleConnections();await stopped;
  }};
}

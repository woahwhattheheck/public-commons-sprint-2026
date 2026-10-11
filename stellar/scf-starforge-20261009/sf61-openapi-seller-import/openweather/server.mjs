// MIT. Private operator application and header-authenticated customer data API.
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore} from './store.mjs';
import {SOURCE,FIELD_MAP,SCHEMA,fail,integer,identifier,redact} from './contract.mjs';
import {configureBudget,saveProject,createAcquisition,createAcquirer,dataset,reviewAcquisition,readReview,selectReview,rollbackReview} from './acquisition.mjs';
import {importInventory,listPackages,prepareIntegration,exportIntegration,createDeployment,customerContract,readIntegration} from './integration.mjs';
import {csv,ndjson,handoff,configureSchedule,createScheduler} from './delivery.mjs';

const here=fileURLToPath(new URL('.',import.meta.url));
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function bodyOf(req){
  if(!String(req.headers['content-type']??'').startsWith('application/json'))fail('CONTENT_TYPE','Use application/json',415);
  const parts=[];let bytes=0;
  for await(const part of req){bytes+=part.length;if(bytes>8*1024*1024)fail('REQUEST_LIMIT','Request exceeds 8 MiB',413);parts.push(part);}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('INVALID_JSON','Supply complete JSON');}
}
function publicState(store,acquirer,env){
  const s=store.snapshot();return {schema:SCHEMA,generation:s.generation,createdAt:s.createdAt,listenPort:s.listenPort,
    account:s.account,budgets:s.budgets,retainedBytes:s.retainedBytes,projects:Object.values(s.projects),
    jobs:Object.values(s.jobs).map(j=>({id:j.id,project:j.project,revision:j.revision,state:j.state,phase:j.phase,start:j.start,end:j.end,createdAt:j.createdAt,
      completedAt:j.completedAt,reason:j.reason,attempts:j.attempts.length,hourlyPages:j.hourlyPages,maxPages:j.maxPages,retryAt:j.retryAt??null})).reverse(),
    running:acquirer.running(),source:SOURCE,fieldMap:FIELD_MAP,
    credentials:{application:Boolean(env.OPENWEATHER_APP_TOKEN),provider:Boolean(s.account&&env[s.account.keyEnv])}};
}
function customerEnvelope(review){
  const d=review.data;return {schema:'stellar-forge.openweather-customer.v1',project:d.project,review:review.id,reviewedAt:review.createdAt,
    timezone:d.timezone,units:d.units,coverage:d.coverage,
    sources:d.sources.map(({id,kind,receivedAt,sha256,status})=>({id,kind,receivedAt,sha256,status}))};
}
export async function startApplication({root,port,packageParent,env=process.env,fetchImpl,signals=true}={}){
  const store=await openStore(root),acquirer=createAcquirer(store,{env,...(fetchImpl?{fetchImpl}:{})}),deployment=createDeployment(store),scheduler=createScheduler(store,acquirer);
  let origin,closing=null;
  const operatorToken=randomBytes(32).toString('hex');
  const requested=port??store.snapshot().listenPort??0;
  const server=createServer(async(req,res)=>{
    const send=(status,value,{type='application/json; charset=utf-8',filename}={})=>{
      if(res.headersSent)return;
      res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff',
        'referrer-policy':'no-referrer',...(filename?{'content-disposition':'attachment; filename="'+filename+'"'}:{}),
        ...(type.startsWith('text/html')?{'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}:{})});
      res.end(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));
    };
    try{
      if(req.headers.host!==new URL(origin).host)fail('HOST','Use the application’s actual loopback host',403);
      const url=new URL(req.url,origin),path=url.pathname;
      if(path.startsWith('/weather/')){
        if(req.method!=='GET')fail('METHOD','Customer data uses GET',405);
        const configured=env.OPENWEATHER_APP_TOKEN;
        if(!configured)fail('APPLICATION_CREDENTIAL','Set OPENWEATHER_APP_TOKEN in the application launch environment',503);
        if(!same(req.headers['x-weather-token'],configured))fail('AUTHENTICATION','Application access token required',401);
        const match=path.match(/^\/weather\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/(current|hourly)$/);
        if(!match)fail('ROUTE','Customer route was not found',404);
        const [,projectId,choice,kind]=match,project=store.snapshot().projects[identifier(projectId)];
        if(!project)fail('PROJECT_MISSING','Project was not found',404);
        const reviewId=choice==='active'?project.activeReview:choice;
        if(!reviewId)fail('DATA_UNSELECTED','This project has no selected data edition',409);
        const review=await readReview(store,projectId,reviewId),result=customerEnvelope(review);
        if(kind==='current')return send(200,{...result,record:review.data.current});
        const offset=integer(Number(url.searchParams.get('offset')??0),'Offset',0,10000000),limit=integer(Number(url.searchParams.get('limit')??100),'Limit',1,200);
        const rows=review.data.hourly,total=rows.length;
        return send(200,{...result,data:rows.slice(offset,offset+limit),offset,total,nextOffset:offset+limit<total?offset+limit:null});
      }
      if(req.headers.origin&&req.headers.origin!==origin)fail('ORIGIN','Use the original local application origin',403);
      if(req.method==='GET'&&['/','/index.html','/browser.mjs','/style.css'].includes(path)){
        const name=path==='/'?'index.html':path.slice(1),bytes=await readFile(join(here,name));
        return send(200,bytes,{type:name.endsWith('.mjs')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});
      }
      if(!path.startsWith('/api/'))fail('ROUTE','Route was not found',404);
      if(!same(req.headers.authorization,'Bearer '+operatorToken))fail('AUTHENTICATION','Use the complete operator URL printed by the application',401);
      if(req.method==='GET'){
        if(path==='/api/state')return send(200,publicState(store,acquirer,env));
        if(path==='/api/packages')return send(200,{packages:await listPackages(store,packageParent)});
        if(path==='/api/deployment')return send(200,await deployment.status());
        if(path==='/api/diff')return send(200,await deployment.diff(url.searchParams.get('release')));
        if(path==='/api/job'){
          const job=store.snapshot().jobs[identifier(url.searchParams.get('job'))];if(!job)fail('JOB_MISSING','Acquisition was not found',404);
          const offset=integer(Number(url.searchParams.get('offset')??0),'Attempt offset',0,30000);
          return send(200,{...job,attempts:job.attempts.slice(offset,offset+100),totalAttempts:job.attempts.length,nextOffset:offset+100<job.attempts.length?offset+100:null});
        }
        if(path==='/api/dataset')return send(200,await dataset(store,url.searchParams.get('job'),{conflicts:url.searchParams.get('conflicts')??'reject'}));
        if(path==='/api/response'){
          const job=store.snapshot().jobs[identifier(url.searchParams.get('job'))],attempt=job?.attempts.find(a=>a.id===url.searchParams.get('attempt'));
          if(!attempt?.response)fail('RESPONSE_MISSING','Retained response was not found',404);
          return send(200,(await store.read('records',attempt.id)).bytes,{filename:attempt.id+'.json'});
        }
        if(path==='/api/source'){
          const project=store.snapshot().projects[identifier(url.searchParams.get('project'))],id=identifier(url.searchParams.get('id'));
          if(!project||![...project.sources,...(project.integrations??[])].some(r=>r.id===id))fail('SOURCE_MISSING','Source does not belong to this project',404);
          return send(200,(await store.read('sources',id)).bytes,{filename:id+'.json'});
        }
        if(path==='/api/integration')return send(200,await readIntegration(store,url.searchParams.get('project'),url.searchParams.get('id')));
        if(path==='/api/review'){
          return send(200,await readReview(store,url.searchParams.get('project'),url.searchParams.get('review')));
        }
        if(path==='/api/export'){
          const project=url.searchParams.get('project'),reviewId=url.searchParams.get('review'),format=url.searchParams.get('format')??'json';
          const review=await readReview(store,project,reviewId),name=project+'-'+reviewId.slice(0,12);
          if(format==='csv')return send(200,csv(review.data),{type:'text/csv; charset=utf-8',filename:name+'.csv'});
          if(format==='ndjson')return send(200,ndjson(review.data),{type:'application/x-ndjson; charset=utf-8',filename:name+'.ndjson'});
          if(format==='contract')return send(200,customerContract(review,origin),{filename:name+'-openapi.json'});
          if(format==='handoff')return send(200,await handoff(store,project,reviewId),{filename:name+'-handoff.json'});
          if(format!=='json')fail('FORMAT','Choose json, csv, ndjson, contract or handoff');
          return send(200,review,{filename:name+'.json'});
        }
        if(path==='/api/backup')return send(200,await store.backup(),{filename:'openweather-workspace-backup.json'});
        fail('ROUTE','API route was not found',404);
      }
      if(req.method!=='POST')fail('METHOD','Use GET or POST',405);
      const input=await bodyOf(req);
      if(path==='/api/account')return send(200,await configureBudget(store,input));
      if(path==='/api/project')return send(200,await saveProject(store,input));
      if(path==='/api/source')return send(200,await importInventory(store,input));
      if(path==='/api/acquire'){
        const job=await createAcquisition(store,input);void acquirer.run(job.id).catch(()=>{});return send(202,job);
      }
      if(path==='/api/resume')return send(202,await acquirer.resume(input.job,{...input,background:true}));
      if(path==='/api/stop')return send(200,await acquirer.stop(input.job));
      if(path==='/api/review'){
        const review=await reviewAcquisition(store,input);return send(200,{id:review.id,createdAt:review.createdAt,coverage:review.data.coverage});
      }
      if(path==='/api/select')return send(200,await selectReview(store,input));
      if(path==='/api/rollback-data')return send(200,await rollbackReview(store,input));
      if(path==='/api/schedule')return send(200,await configureSchedule(store,input));
      if(path==='/api/integration/review')return send(200,await prepareIntegration(store,input,{origin,packageParent}));
      if(path==='/api/integration/export')return send(200,await exportIntegration(store,input));
      if(path==='/api/stage')return send(200,await deployment.stage(input));
      if(path==='/api/activate')return send(200,await deployment.select(input));
      if(path==='/api/rollback')return send(200,await deployment.rollback(input));
      if(path==='/api/start-release')return send(200,await deployment.start(input));
      if(path==='/api/stop-release')return send(200,await deployment.stop());
      fail('ROUTE','API route was not found',404);
    }catch(e){
      let message=String(e.message??e);for(const key of [operatorToken,env.OPENWEATHER_APP_TOKEN,store.snapshot().account&&env[store.snapshot().account.keyEnv]])if(key)message=redact(message,key);
      send(e.status??(e.code==='ENOENT'?404:400),{code:e.code??'APPLICATION_ERROR',error:message});
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
  try{
    integer(requested,'Application port',0,65535);await acquirer.recover();
    await new Promise((done,reject)=>{server.once('error',reject);server.listen(requested,'127.0.0.1',done);});
    origin='http://127.0.0.1:'+server.address().port;
    await store.transaction(s=>{s.listenPort=server.address().port;});
    scheduler.start();
  }catch(e){await acquirer.close();await scheduler.close();await store.close();server.close();throw e;}
  const close=()=>{
    if(closing)return closing;
    closing=(async()=>{server.closeIdleConnections?.();const stopped=new Promise(resolve=>server.close(resolve));
      await acquirer.close();await scheduler.close();await deployment.close();await stopped;await store.close();
      process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);})();
    return closing;
  };
  const onSignal=()=>{void close().catch(()=>{process.exitCode=1;});};
  if(signals){process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);}
  return {url:origin+'/#'+operatorToken,origin,operatorToken,store,acquirer,deployment,scheduler,server,close};
}

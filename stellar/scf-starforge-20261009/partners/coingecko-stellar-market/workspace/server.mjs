// MIT. Local operator HTTP surface over the original retained market model.
import {createServer} from 'node:http';
import {readFile,open,unlink,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hostname} from 'node:os';
import {MarketModel} from './model.mjs';
import {MarketJobs} from './jobs.mjs';
import {need,jsonBytes,LIMITS,errorView,safeName} from '../common.mjs';

const PUBLIC=fileURLToPath(new URL('./public/',import.meta.url));
const routeKind=value=>value==='provider-plans'?'providerPlans':value;
const DOWNLOAD_NAME=name=>{
  const value=safeName(name),fallback=value.replace(/[^A-Za-z0-9._ -]/g,'_').replace(/["\\]/g,'_');
  return 'attachment; filename="'+fallback+'"; filename*=UTF-8'+String.fromCharCode(39,39)+encodeURIComponent(value);
};
export async function acquireWorkspaceLease(directory){
  await mkdir(directory,{recursive:true,mode:0o700});
  const path=join(resolve(directory),'operator-runtime.json');
  const value={pid:process.pid,host:hostname(),createdAt:new Date().toISOString()};
  for(let attempt=0;attempt<2;attempt++){
    let handle;
    try{handle=await open(path,'wx',0o600);await handle.writeFile(jsonBytes(value));await handle.sync();await handle.close();
      return async()=>{try{const current=JSON.parse(await readFile(path,'utf8'));if(current.pid===value.pid&&current.createdAt===value.createdAt)await unlink(path)}catch(error){if(error.code!=='ENOENT')throw error}}}
    catch(error){
      await handle?.close().catch(()=>{});
      if(handle)await unlink(path).catch(cleanup=>{if(cleanup.code!=='ENOENT')process.stderr.write('Workspace lease cleanup failed: '+cleanup.code+'\n')});
      if(error.code!=='EEXIST')throw error;
      const current=JSON.parse(await readFile(path,'utf8'));
      let alive=true;try{process.kill(current.pid,0)}catch(check){if(check.code==='ESRCH')alive=false}
      need(current.host===hostname()&&!alive,'WORKSPACE_ALREADY_RUNNING','This workspace already has a running native operator process. Use its current browser or close it before starting another worker.',409);
      await unlink(path);
    }
  }
  need(false,'WORKSPACE_LEASE_FAILED');
}
async function requestBody(req,maximum){
  const parts=[];let bytes=0;
  for await(const part of req){bytes+=part.length;need(bytes<=maximum,'REQUEST_TOO_LARGE','Submitted file exceeds the declared limit',413);parts.push(part)}
  let value;try{value=JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{need(false,'INVALID_JSON','Request body must be JSON')}
  need(value!==null&&typeof value==='object'&&!Array.isArray(value),'INVALID_JSON');return value;
}
export async function startMarketWorkspace({directory,port=0,buyerProfiles=[],fetchImpl,allowLocal=false,providerMode,...options}={}){
  need(typeof directory==='string','STATE_DIRECTORY_REQUIRED');
  const release=await acquireWorkspaceLease(resolve(directory));
  let model,runner,server,closing;
  try{
    model=new MarketModel(directory,{buyerProfiles,allowLocal,providerMode,...options});
    runner=new MarketJobs(model,{fetchImpl,probeTimeoutMs:options.probeTimeoutMs??30000}).start();model.attachRunner(runner);
    server=createServer((req,res)=>dispatch(req,res).catch(error=>{
      if(res.headersSent){res.destroy();return}
      const status=Number.isInteger(error.status)?error.status:500;
      send(res,status,{error:error.code??'WORKSPACE_ERROR',message:error.message??'The operation failed',
        ...(error.currentRevision===undefined?{}:{currentRevision:error.currentRevision}),
        ...(error.current===undefined?{}:{current:error.current})});
    }));
    server.requestTimeout=120000;server.headersTimeout=10000;
    function send(res,status,value,headers={}){
      const bytes=Buffer.isBuffer(value)?value:jsonBytes(value);
      res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
        'x-content-type-options':'nosniff','content-length':String(bytes.length),...headers});
      res.end(bytes);
    }
    function result(res,value,status=200){
      if(value?.ok&&['probe','checkout'].includes(value.value?.kind))value={...value,value:model.jobView(value.value)};
      send(res,status,value);
    }
    function download(res,bytes,name,contentType){
      send(res,200,bytes,{'content-type':contentType,'content-disposition':DOWNLOAD_NAME(name)});
    }
    async function dispatch(req,res){
      const address=server.address(),allowed=new Set(['127.0.0.1:'+address.port,'localhost:'+address.port]);
      need(allowed.has(req.headers.host),'INVALID_HOST','Use this workspace’s loopback address',400);
      const base='http://'+req.headers.host,url=new URL(req.url,base),path=url.pathname,query=Object.fromEntries(url.searchParams);
      const write=['POST','PUT','PATCH','DELETE'].includes(req.method);
      if(write){
        need(req.headers['x-workspace-request']==='1','WORKSPACE_REQUEST_HEADER_REQUIRED','Use the workspace’s normal write interface',403);
        need(req.headers.origin===undefined||req.headers.origin===base,'CROSS_ORIGIN_WRITE','The write must come from this workspace',403);
      }
      if(req.method==='GET'&&['/','/app.mjs','/style.css'].includes(path)){
        const name=path==='/'?'index.html':path.slice(1),type=name.endsWith('.html')?'text/html; charset=utf-8':
          name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
        return send(res,200,await readFile(join(PUBLIC,name)),{'content-type':type,
          'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
      }
      if(req.method==='GET'&&path==='/favicon.ico'){res.writeHead(204);res.end();return}
      need(path.startsWith('/api/'),'NOT_FOUND','Route not found',404);
      const body=write?await requestBody(req,Math.ceil((path==='/api/restore'?LIMITS.restoreBytes:LIMITS.uploadBytes)*4/3)+1048576):null;
      if(req.method==='GET'&&path==='/api/state')return result(res,model.state());
      if(req.method==='POST'&&path==='/api/projects')return result(res,model.createProject(body),201);
      if(req.method==='POST'&&path==='/api/restore')return result(res,model.restore(body),201);
      let m;
      if((m=/^\/api\/projects\/([^/]+)$/.exec(path))&&req.method==='GET')return result(res,model.project(m[1]));
      if((m=/^\/api\/projects\/([^/]+)\/([^/]+)$/.exec(path))){
        const[,projectId,kind]=m;
        if(req.method==='GET')return result(res,model.list(projectId,routeKind(kind),query));
        if(req.method==='POST'){
          if(kind==='config')return result(res,model.saveConfig(projectId,body));
          if(kind==='requests')return result(res,model.saveRequest(projectId,body));
          if(kind==='collections')return result(res,model.saveCollection(projectId,body));
          if(kind==='collection-import')return result(res,model.importCollection(projectId,body));
          if(kind==='files')return result(res,model.upload(projectId,body));
          if(kind==='imports')return result(res,model.importResponse(projectId,body));
          if(kind==='samples')return result(res,model.sample(projectId,body));
          if(kind==='probes')return result(res,await model.createProbe(projectId,body),202);
          if(kind==='snapshots')return result(res,model.createSnapshot(projectId,body));
          if(kind==='comparisons')return result(res,model.createComparison(projectId,body));
          if(kind==='notes')return result(res,model.saveNote(projectId,body));
          if(kind==='provider-plans')return result(res,await model.saveProviderPlan(projectId,body));
          if(kind==='exports')return result(res,model.exportProject(projectId,body));
        }
      }
      if((m=/^\/api\/requests\/([^/]+)$/.exec(path))){
        if(req.method==='GET')return result(res,model.request(m[1]));
        if(req.method==='POST')return result(res,model.saveRequest(model.store.get('requests',m[1]).projectId,body,m[1]));
      }
      if((m=/^\/api\/collections\/([^/]+)(?:\/(download|checkout))?$/.exec(path))){
        if(req.method==='GET'&&!m[2])return result(res,model.collection(m[1]));
        if(req.method==='GET'&&m[2]==='download')return download(res,model.collectionBytes(m[1]),model.collection(m[1]).collection.name+'.json','application/json');
        if(req.method==='POST'&&m[2]==='checkout')return result(res,await model.createCheckout(m[1],body),202);
        if(req.method==='POST'&&!m[2])return result(res,model.saveCollection(model.store.get('collections',m[1]).projectId,body,m[1]));
      }
      if((m=/^\/api\/files\/([^/]+)(?:\/(download))?$/.exec(path))&&req.method==='GET'){
        const file=model.store.fileInfo(m[1]);
        return m[2]?download(res,model.store.fileBytes(file.id),file.name,file.contentType):result(res,{file});
      }
      if((m=/^\/api\/captures\/([^/]+)(?:\/rows(?:\/([^/]+))?)?$/.exec(path))&&req.method==='GET'){
        return result(res,m[2]?model.captureRow(m[1],m[2]):path.endsWith('/rows')?model.captureRows(m[1],query):model.capture(m[1]));
      }
      if((m=/^\/api\/jobs\/([^/]+)(?:\/(execute|cancel|resume|recover))?$/.exec(path))){
        if(req.method==='GET'&&!m[2])return result(res,model.job(m[1]));
        if(req.method==='POST'&&m[2])return result(res,await model.controlJob(m[1],m[2],body),202);
      }
      if((m=/^\/api\/snapshots\/([^/]+)(?:\/(rows|download))?$/.exec(path))&&req.method==='GET'){
        if(m[2]==='rows')return result(res,model.snapshotRows(m[1],query));
        if(m[2]==='download')return download(res,jsonBytes(model.snapshotDocument(m[1])),model.snapshot(m[1]).snapshot.name+'.json','application/json');
        return result(res,model.snapshot(m[1]));
      }
      if((m=/^\/api\/comparisons\/([^/]+)(?:\/(rows|download))?$/.exec(path))&&req.method==='GET'){
        if(m[2]==='rows')return result(res,model.comparisonRows(m[1],query));
        if(m[2]==='download')return download(res,jsonBytes(model.comparisonDocument(m[1])),model.comparison(m[1]).comparison.name+'.json','application/json');
        return result(res,model.comparison(m[1]));
      }
      if((m=/^\/api\/notes\/([^/]+)$/.exec(path))){
        if(req.method==='GET')return result(res,model.note(m[1]));
        if(req.method==='POST')return result(res,model.saveNote(model.store.get('notes',m[1]).projectId,body,m[1]));
      }
      if((m=/^\/api\/provider-plans\/([^/]+)(?:\/(download))?$/.exec(path))){
        if(req.method==='GET'&&m[2])return download(res,jsonBytes(model.providerDocument(m[1])),model.providerPlan(m[1]).plan.name+'.json','application/json');
        if(req.method==='GET')return result(res,model.providerPlan(m[1]));
        if(req.method==='POST'&&!m[2])return result(res,await model.saveProviderPlan(model.store.get('providerPlans',m[1]).projectId,body,m[1]));
      }
      if((m=/^\/api\/exports\/([^/]+)\/download$/.exec(path))&&req.method==='GET'){
        const{record,bytes}=model.exportBytes(m[1]);return download(res,bytes,record.name+'.json.gz','application/gzip');
      }
      need(false,'NOT_FOUND','API route not found',404);
    }
    await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done)});
    const close=()=>closing??=(async()=>{await runner.close();await new Promise(done=>{server.close(done);server.closeIdleConnections()});model.close();await release()})();
    return{url:'http://127.0.0.1:'+server.address().port,server,model,runner,close};
  }catch(error){
    await runner?.close().catch(()=>{});model?.close();await release();throw error;
  }
}

// MIT. Local industrial workspace around the original OData application.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { fault } from './state.mjs';

const assets=fileURLToPath(new URL('./public/',import.meta.url));
const files=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.mjs',['app.mjs','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
export async function startODataServer({workspace,port=8797,liveServiceId}={}){
  if(!Number.isInteger(port)||port<0||port>65535)throw new TypeError('Choose a local TCP port.');
  let publisher,live,closing;
  const getPublisher=async()=>publisher||=(await import('./publisher.mjs')).openODataPublisher({workspace});
  const getLive=async()=>{
    if(!live)live=import('./live-operations.mjs').then(module=>module.openODataLiveOperations({
      workspace,navigationOrigin:'http://127.0.0.1:'+server.address().port
    })).catch(error=>{live=null;throw error;});
    return live;
  };
  const send=(res,status,value,headers={})=>{
    const body=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(body);
  };
  async function body(req){let length=0,chunks=[];for await(const chunk of req){length+=chunk.length;
    if(length>64*1024*1024)throw fault('ODATA_REQUEST_SIZE','The workspace request exceeds 64 MiB.',413);chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw fault('ODATA_REQUEST_JSON','Use a JSON request.');}}
  const server=createServer(async(req,res)=>{
    try{
      const address=server.address(),origin='http://127.0.0.1:'+address.port;
      if(req.headers.host!=='127.0.0.1:'+address.port&&req.headers.host!=='localhost:'+address.port)throw fault('ODATA_LOCAL_HOST','Use the displayed local workspace address.',400);
      const url=new URL(req.url,origin);
      if(req.headers.origin&&req.headers.origin!==origin&&req.headers.origin!=='http://localhost:'+address.port)throw fault('ODATA_LOCAL_ORIGIN','Open the local workspace before submitting an operation.',403);
      if(req.method==='GET'&&files.has(url.pathname)){
        const [name,type]=files.get(url.pathname);return send(res,200,await readFile(join(assets,name)),{'Content-Type':type,
          'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});}
      if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,await workspace.state());
      if(req.method==='GET'&&url.pathname==='/api/application'){
        const {odataWorkspaceProbe}=await import('./live/startup.mjs');return send(res,200,await odataWorkspaceProbe(workspace));}
      if(req.method==='GET'&&url.pathname==='/api/rows')return send(res,200,{rows:await workspace.rows(url.searchParams.get('id'))});
      if(req.method==='GET'&&url.pathname==='/api/edition')return send(res,200,await workspace.edition(url.searchParams.get('id')));
      if(req.method==='GET'&&url.pathname==='/api/source')return send(res,200,await workspace.raw(url.searchParams.get('hash')),
        {'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="original-odata-source"'});
      if(req.method==='GET'&&url.pathname==='/api/compare')return send(res,200,await workspace.compare(url.searchParams.get('before'),url.searchParams.get('after')));
      if(req.method==='GET'&&url.pathname==='/api/backup')return send(res,200,await workspace.backup(),{'Content-Disposition':'attachment; filename="odata-workspace.json"'});
      if(req.method==='GET'&&url.pathname==='/api/export'){
        const id=url.searchParams.get('id'),name=url.searchParams.get('file'),record=(await workspace.state()).exports.find(value=>value.id===id);
        if(!record||!record.files.includes(name))throw fault('ODATA_EXPORT_FILE','Export file not found.',404);
        return send(res,200,await readFile(join(workspace.directory,'exports',id,name)),{'Content-Type':name.endsWith('.csv')?'text/csv; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="'+name+'"'});}
      if(req.method==='GET'&&url.pathname==='/api/merchant')return send(res,200,await(await getPublisher()).status());
      if(req.method==='GET'&&url.pathname==='/api/live')return send(res,200,await(await getLive()).status());
      if(req.method==='GET'&&url.pathname==='/api/live/detail')return send(res,200,await(await getLive()).detail(url.searchParams.get('id')));
      if(req.method==='GET'&&url.pathname==='/api/live/file'){
        const file=await(await getLive()).file(Object.fromEntries(url.searchParams));
        return send(res,200,file.bytes,{'Content-Type':file.name.endsWith('.jsonl')?'application/x-ndjson':'application/json; charset=utf-8',
          'Content-Disposition':'attachment; filename="'+file.name+'"'});}
      if(req.method!=='POST')throw fault('ODATA_ROUTE','Workspace operation not found.',404);
      if(!String(req.headers['content-type']||'').startsWith('application/json'))throw fault('ODATA_CONTENT_TYPE','Send JSON for workspace operations.',415);
      const input=await body(req);let result;
      switch(url.pathname){
        case '/api/connect':result=await workspace.connect(input);break;
        case '/api/refresh':result=await workspace.refreshConnection(input.id);break;
        case '/api/plan':result=await workspace.plan(input);break;
        case '/api/review-plan':result=await workspace.reviewPlan(input);break;
        case '/api/capture':{
          result=await workspace.startCapture(input);const id=result.id;
          void workspace.capture(id,{pageBudget:input.pageBudget||10000}).catch(()=>{});return send(res,202,result);}
        case '/api/resume':{
          const record=await workspace.edition(input.id);
          if((await workspace.state()).running.includes(input.id))throw fault('ODATA_CAPTURE_RUNNING','This edition is already importing.',409);
          if(record.status==='COMPLETE')return send(res,200,{id:input.id,status:'COMPLETE'});
          void workspace.capture(input.id,{pageBudget:input.pageBudget||10000}).catch(()=>{});return send(res,202,{id:input.id,status:'IMPORTING'});}
        case '/api/pause':result=await workspace.pause(input.id);break;
        case '/api/review':result=await workspace.reviewEdition(input);break;
        case '/api/export':result=await workspace.exportEdition(input);break;
        case '/api/query':result=await workspace.queryExport(input);break;
        case '/api/restore':result=await workspace.restore(input);break;
        case '/api/merchant/prepare':result=await(await getPublisher()).prepare(input);break;
        case '/api/merchant/activate':result=await(await getPublisher()).activate(input);break;
        case '/api/merchant/rollback':result=await(await getPublisher()).rollback(input);break;
        case '/api/live/prepare':result=await(await getLive()).prepare(input);break;
        case '/api/live/start':result=await(await getLive()).start(input);break;
        case '/api/live/stop':result=await(await getLive()).stop(input);break;
        case '/api/live/buyer':result=await(await getLive()).buyer(input);break;
        case '/api/live/receive':result=await(await getLive()).receive(input);break;
        default:throw fault('ODATA_ROUTE','Workspace operation not found.',404);
      }
      return send(res,200,result);
    }catch(error){if(!res.headersSent)send(res,error.status||(error instanceof TypeError?400:500),{error:error.code||'ODATA_OPERATION_FAILED',message:error.message});else res.destroy();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const service={url:'http://127.0.0.1:'+server.address().port,server,liveRuntime:null,
    close:()=>closing??=(async()=>{
      try{if(live)await(await live).close();}
      finally{try{await workspace.close();}finally{await new Promise(resolve=>server.close(resolve));}}
    })()};
  try{if(liveServiceId)service.liveRuntime=await(await getLive()).start({id:liveServiceId});return service;}
  catch(error){await service.close();throw error;}
}

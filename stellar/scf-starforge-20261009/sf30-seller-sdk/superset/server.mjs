// MIT. Private industrial browser over the original retained workspace and native merchant.
import {createServer} from 'node:http';
import {readFile,open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
import {openSupersetWorkspace} from './workspace.mjs';
import {startSupersetMerchant,supersetMerchantStatus} from './merchant.mjs';
import {reviewSupersetBuyer,inspectSupersetDelivery} from './customer.mjs';
import {object,fault,MiB} from './files.mjs';
const equal=(a,b)=>{const x=Buffer.from(a??''),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const mountOf=value=>{
  if(typeof value!=='string'||!value.startsWith('/')||!value.endsWith('/')||value.includes('//')||
      new URL(value,'http://127.0.0.1').pathname!==value||/[?#\\]/.test(value))
    throw new TypeError('Use a canonical browser mount path ending in /.');
  return value;
};
export async function startSupersetWorkspaceServer({directory,port=0,host='127.0.0.1',mountPath='/',
  env=process.env,fetchImpl=globalThis.fetch,merchantRuntime={port:0},nativeFactory}={}){
  if(host!=='127.0.0.1'||!Number.isInteger(port)||port<0||port>65535)throw new TypeError('Use a loopback port from 0 to 65535.');
  mountPath=mountOf(mountPath);
  const workspace=await openSupersetWorkspace({directory,env,fetchImpl});
  const assets=new Map();
  try{for(const [path,name,type]of [['','index.html','text/html; charset=utf-8'],['app.mjs','app.mjs','text/javascript; charset=utf-8'],['style.css','style.css','text/css; charset=utf-8']])
    assets.set(path,{body:await readFile(new URL('./ui/'+name,import.meta.url)),type});}
  catch(error){await workspace.close();throw error;}
  const token=randomBytes(32).toString('base64url'),authorization='Bearer '+token;
  let origin,closing=false,closePromise;
  const runs=new Map();
  const running=async merchantId=>{
    const merchant=workspace.get('merchants',merchantId),group=merchant.versionGroup??merchant.id,entry=runs.get(group);
    if(!entry)throw fault('SUPERSET_MERCHANT_NOT_RUNNING','Start this merchant version store in the workspace first.',409);
    const service=await entry.promise;
    return{merchant,group,entry,service};
  };
  const runSummary=(merchant,group,service)=>({merchantId:merchant.id,versionGroup:group,url:service.url,mode:service.mode,resource:merchant.resource});
  const start=async merchantId=>{
    const merchant=workspace.get('merchants',merchantId),group=merchant.versionGroup??merchant.id;
    if(!runs.has(group)){
      const promise=workspace.materializeMerchant(merchantId).then(()=>startSupersetMerchant({directory:join(workspace.directory,merchant.preparedRelative),
        stageDirectory:join(workspace.directory,'stages',merchant.id),runtime:merchantRuntime,nativeFactory}));
      const entry={merchantId:merchant.id,promise};runs.set(group,entry);
      promise.catch(()=>{if(runs.get(group)===entry)runs.delete(group);});
    }
    const selected=await running(merchantId);return runSummary(merchant,group,selected.service);
  };
  const readBody=async req=>{
    if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')throw fault('SUPERSET_JSON_REQUIRED','Use a JSON operation body.',415);
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>MiB)throw fault('SUPERSET_REQUEST_LIMIT','This operation body exceeds 1 MiB.',413);chunks.push(chunk);}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}
    catch{throw fault('SUPERSET_JSON_REQUIRED','The operation body is not valid JSON.');}
  };
  const headers=type=>({'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});
  const reply=(res,status,value)=>{
    if(res.destroyed||res.headersSent)return;
    const raw=JSON.stringify(value);res.writeHead(status,{...headers('application/json; charset=utf-8'),'content-length':Buffer.byteLength(raw)});res.end(raw);
  };
  const server=createServer({maxHeaderSize:16384,requestTimeout:30000,headersTimeout:15000,keepAliveTimeout:1000},async(req,res)=>{
    try{
      if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)||
          req.headers['sec-fetch-site']==='cross-site')return reply(res,403,{error:'SUPERSET_LOCAL_ORIGIN'});
      const url=new URL(req.url,origin);
      if(!url.pathname.startsWith(mountPath))return reply(res,404,{error:'NOT_FOUND'});
      const path=url.pathname.slice(mountPath.length),asset=assets.get(path);
      if(req.method==='GET'&&asset){res.writeHead(200,headers(asset.type));res.end(asset.body);return;}
      if(!equal(req.headers.authorization,authorization))return reply(res,401,{error:'SUPERSET_SESSION_REQUIRED'});
      if(closing)return reply(res,503,{error:'SUPERSET_WORKSPACE_STOPPING'});
      if(req.method==='GET'&&path==='api/state'){
        const active=[];
        for(const [group,entry]of runs){
          try{const service=await entry.promise;active.push(runSummary(workspace.get('merchants',entry.merchantId),group,service));}
          catch{}
        }
        return reply(res,200,{...workspace.state(),merchantRuns:active});
      }
      if(req.method==='POST'&&path==='api/inventory'){
        const body=await readBody(req);return reply(res,200,await workspace.inventory(body.sourceId,body));
      }
      const operation=path.match(/^api\/operations\/([A-Za-z0-9_-]+)$/);
      if(operation&&req.method==='GET')return reply(res,200,workspace.operation(operation[1]));
      if(operation&&req.method==='POST'){
        const body=await readBody(req);
        if(operation[1]==='prepare-buyer'){
          const selected=await running(body.merchantId);body.seller=selected.service.url;
        }
        const task=workspace.dispatch(operation[1],body);task.catch(()=>{});
        return reply(res,202,workspace.operation(body.operationId));
      }
      const cancel=path.match(/^api\/cancel\/([A-Za-z0-9_-]+)$/);
      if(cancel&&req.method==='POST'){await readBody(req);return reply(res,202,workspace.cancel(cancel[1]));}
      const record=path.match(/^api\/records\/([a-z]+)\/([A-Za-z0-9_-]+)$/);
      if(record&&req.method==='GET')return reply(res,200,workspace.get(record[1],record[2]));
      if(path==='api/query'&&req.method==='POST'){
        const body=await readBody(req);return reply(res,200,await workspace.query(body.editionId,body.query??{}));
      }
      if(path==='api/merchant/start'&&req.method==='POST'){
        const body=await readBody(req);return reply(res,200,await start(body.merchantId));
      }
      if(path==='api/merchant/stop'&&req.method==='POST'){
        const body=await readBody(req),selected=await running(body.merchantId);
        await selected.service.close();runs.delete(selected.group);return reply(res,200,{status:'STOPPED',versionGroup:selected.group});
      }
      if(path==='api/merchant/status'&&req.method==='POST'){
        const body=await readBody(req),merchant=workspace.get('merchants',body.merchantId);
        return reply(res,200,await supersetMerchantStatus(join(workspace.directory,merchant.preparedRelative)));
      }
      if(path==='api/buyer/review'&&req.method==='POST'){
        const body=await readBody(req),selected=await running(body.merchantId);
        return reply(res,200,await reviewSupersetBuyer({directory:join(workspace.directory,selected.merchant.preparedRelative),
          seller:selected.service.url,query:body.query??{}}));
      }
      if(path==='api/buyer/status'&&req.method==='POST'){
        const body=await readBody(req),buyer=workspace.get('buyers',body.buyerId);
        const {inspectDatasetSession}=await import('../../sf88-operator-buyer-cli/dataset-session.mjs');
        return reply(res,200,await inspectDatasetSession(join(workspace.directory,buyer.relative,'session')));
      }
      if(path==='api/delivery/inspect'&&req.method==='POST'){
        const body=await readBody(req),delivery=workspace.get('deliveries',body.deliveryId);
        return reply(res,200,await workspace.materializeDelivery(delivery.id));
      }
      const download=path.match(/^api\/export\/(workspace|capture|comparison|csv|lineage)(?:\/([A-Za-z0-9_-]+))?$/);
      if(download&&req.method==='GET'){
        const item=await workspace.exportFile(download[1],download[2]);
        const handle=await open(item.file,'r');
        try{
          const stat=await handle.stat();
          if(stat.size!==item.bytes)throw fault('SUPERSET_EXPORT_CHANGED','The retained export changed.',409);
          res.writeHead(200,{...headers(item.contentType),'content-length':String(item.bytes),
            'content-disposition':'attachment; filename="'+item.name+'"','x-content-sha256':item.sha256});
          await pipeline(handle.createReadStream({autoClose:false}),res);
        }finally{await handle.close();}
        return;
      }
      return reply(res,404,{error:'NOT_FOUND'});
    }catch(error){
      reply(res,Number.isInteger(error.status)?error.status:400,{error:typeof error.code==='string'?error.code:'SUPERSET_REQUEST_FAILED',
        message:error.code?error.message:'The operation could not be completed.'});
    }
  });
  try{
    await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,host,done);});
    origin='http://127.0.0.1:'+server.address().port;
  }catch(error){await workspace.close();throw error;}
  return{server,workspace,url:origin+mountPath,sessionUrl:origin+mountPath+'#session='+token,
    async close(){
      if(closePromise)return closePromise;
      closing=true;const keeper=setInterval(()=>{},1000);
      closePromise=(async()=>{
        const issues=[];
        try{
          const closeHttp=new Promise((done,reject)=>server.close(error=>error?reject(error):done()));
          server.closeIdleConnections();
          for(const entry of runs.values()){
            try{const service=await entry.promise;await service.close();}catch(error){issues.push(error);}
          }
          runs.clear();
          try{await workspace.close();}catch(error){issues.push(error);}
          try{await closeHttp;}catch(error){issues.push(error);}
          if(issues.length)throw issues[0];
        }finally{clearInterval(keeper);}
      })();
      return closePromise;
    }};
}

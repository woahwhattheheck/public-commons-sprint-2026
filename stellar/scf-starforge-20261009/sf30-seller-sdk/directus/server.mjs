// MIT. Local operator for retained repository data and native dataset editions.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {openDirectusWorkspace,receiveDirectusWorkspace} from './workspace.mjs';
import {DirectusOperations} from './operations.mjs';
import {prepareDirectusMerchant,readDirectusMerchant,startDirectusMerchant,publishDirectusMerchant} from './merchant.mjs';
import {reviewDirectusBuyer,prepareDirectusBuyer,receiveDirectusBuyer,inspectDirectusDelivery} from './customer.mjs';
import {object,canonical} from './source.mjs';
import {acquireDatasetLease} from '../dataset-refresh/writer-lease.mjs';
import {hash,fault,MAX_SOURCE_BYTES} from './source.mjs';
import {DIRECTUS_OPERATOR_LAUNCH_SCHEMA,verifyDirectusOperatorSourceSelection} from './launch.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ID=/^[A-Za-z0-9_.:-]{8,128}$/;
async function saveJson(file,value){
  const temporary=file+'.'+randomUUID()+'.tmp';
  let handle;
  try{
    handle=await fsp.open(temporary,'wx',0o600);
    await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();await handle.close();handle=null;
    await fsp.rename(temporary,file);
  }finally{await handle?.close();await fsp.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function body(req,limit=2*1024*1024){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw fault('REQUEST_SIZE','The complete request exceeds the supported size.',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fault('REQUEST_JSON','The complete operation must be JSON.');}
}
function send(res,status,value){
  const bytes=Buffer.from(JSON.stringify(value));
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':bytes.length});res.end(bytes);
}
const brief=item=>({key:item.key,objectSha256:item.object_sha256,fields:item.fields,values:item.values,object_json:item.object_json,origins:item.origins});
export async function startDirectusOperator({directory,workspaceDirectory,sourceDirectory,expectedSelectionSha256,host='127.0.0.1',port=0,token=randomBytes(32).toString('base64url')}={}){
  if(!['127.0.0.1','::1','localhost'].includes(host))throw fault('OPERATOR_HOST','Use a loopback host for this private operator.');
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw fault('OPERATOR_PORT','Choose a port from 0 to 65535.');
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(token))throw fault('OPERATOR_TOKEN','Use a private URL-safe operator credential.');
  const requested=path.resolve(directory??'.directus-operator');await fsp.mkdir(requested,{recursive:true,mode:0o700});
  const selectedSource=await verifyDirectusOperatorSourceSelection({directory:requested,workspaceDirectory,sourceDirectory,expectedSelectionSha256});
  const root=selectedSource.selection.directory,instanceId='directus-instance-'+randomUUID();
  const lease=acquireDatasetLease(root),registryFile=path.join(root,'operator.json'),launchFile=path.join(root,'operator-launch.json');
  let launch;
  let registry,workspace,server,tail=Promise.resolve(),closing=false;
  let connection={baseUrl:process.env.DIRECTUS_BASE_URL??'',token:process.env.DIRECTUS_TOKEN??''};
  const nativeOperations=new DirectusOperations(),merchants=new Map();
  const closeOwned=async()=>{
    let failure;
    try{await nativeOperations.close();}catch(error){failure=error;}
    for(const service of merchants.values())try{await service.close();}catch(error){failure??=error;}
    merchants.clear();
    try{await workspace?.close();}catch(error){failure??=error;}
    if(failure)throw failure;
  };
  const serial=job=>{const result=tail.then(()=>{if(closing)throw fault('OPERATOR_CLOSING','The operator is closing.',409);lease.assertHeld();return job();});tail=result.catch(()=>{});return result;};
  try{
    try{registry=JSON.parse(await fsp.readFile(registryFile,'utf8'));}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      registry={schema:'stellar-forge.directus-operator.v1',id:'directus-operator-'+randomUUID(),selected:'original',projects:[{key:'original',name:'Original workspace',directory:path.resolve(workspaceDirectory??path.join(root,'workspaces','original'))}],receiving:{}};
      await saveJson(registryFile,registry);
    }
    if(registry.schema!=='stellar-forge.directus-operator.v1'||!Array.isArray(registry.projects)||!registry.projects.some(p=>p.key===registry.selected))
      throw fault('OPERATOR_PROJECTS','The original operator project registry is invalid.');
    if(registry.id===undefined){registry={...registry,id:'directus-operator-'+randomUUID()};await saveJson(registryFile,registry);}
    if(!ID.test(registry.id))throw fault('OPERATOR_ID','The original operator identity is invalid.');
    // Loopback browser cookies are shared across ports. Keep each original
    // operator's private cookie separate when several managed apps are open.
    const cookieName='directus_operator_'+createHash('sha256').update(JSON.stringify([registry.id,root])).digest('hex').slice(0,24);
    workspace=await openDirectusWorkspace({directory:registry.projects.find(p=>p.key===registry.selected).directory});
    let origin;
    const state=()=>({...workspace.state(),connection:{baseUrl:connection.baseUrl,configured:Boolean(connection.baseUrl),authenticated:Boolean(connection.token)},
      native_active:nativeOperations.active,merchants:[...merchants.entries()].map(([directory,service])=>({directory,url:service.url,edition:service.edition,current:service.versions?.status?.().current})),operator:{id:registry.id,instanceId,selected:registry.selected,projects:registry.projects.map(({key,name})=>({key,name}))}});
    const publicLaunch=()=>({...launch,projectKey:registry.selected,workspaceId:workspace.state().id});
    const scoped=(req,job)=>serial(()=>{
      const expected=[['x-directus-operator',registry.id,'OPERATOR'],['x-directus-instance',instanceId,'INSTANCE'],
        ['x-directus-project',registry.selected,'PROJECT'],['x-directus-workspace',workspace.state().id,'WORKSPACE']];
      for(const [header,actual,kind] of expected)if(req.headers[header]!==undefined&&req.headers[header]!==actual)
        throw fault('DSCOPE_'+kind,'The selected '+kind.toLowerCase()+' changed. Bind the current original workspace before continuing.',409);
      return job();
    });
    const select=async key=>{
      const selected=registry.projects.find(p=>p.key===key);if(!selected)throw fault('OPERATOR_PROJECT','Choose an available original workspace.',404);
      if(key===registry.selected)return state();
      if(nativeOperations.active)throw fault('DIRECTUS_NATIVE_RUNNING','Let the active native request finish before switching its workspace.',409);
      const next=await openDirectusWorkspace({directory:selected.directory});
      const revised={...registry,selected:key};
      try{await saveJson(registryFile,revised);}catch(error){await next.close();throw error;}
      await workspace.close();workspace=next;registry=revised;return state();
    };
    const sameToken=value=>{
      const a=Buffer.from(value??''),b=Buffer.from(token);return a.length===b.length&&timingSafeEqual(a,b);
    };
    server=http.createServer(async(req,res)=>{
      res.setHeader('cache-control','no-store');
      res.setHeader('x-content-type-options','nosniff');
      res.setHeader('referrer-policy','no-referrer');
      res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
      try{
        const u=new URL(req.url,origin);
        if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin)
          throw fault('OPERATOR_ORIGIN','Open this operator from its original local address.',403);
        if(req.method==='GET'&&['/','/app.js','/style.css'].includes(u.pathname)){
          const filename=u.pathname==='/'?'index.html':u.pathname.slice(1);
          const bytes=await fsp.readFile(path.join(HERE,'public',filename));
          if(u.pathname==='/')res.setHeader('set-cookie',cookieName+'='+token+'; HttpOnly; SameSite=Strict; Path=/');
          res.writeHead(200,{'content-type':filename.endsWith('.html')?'text/html; charset=utf-8':filename.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','content-length':bytes.length});res.end(bytes);return;
        }
        const cookie=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
        if(!sameToken(req.headers.authorization?.replace(/^Bearer /,''))&&!sameToken(cookie))
          throw fault('OPERATOR_AUTH','Open the local operator or supply its bearer credential.',401);
        if(req.method==='GET'&&u.pathname==='/api/launch'){send(res,200,await scoped(req,publicLaunch));return;}
        if(req.method==='GET'&&u.pathname==='/api/state'){send(res,200,await scoped(req,state));return;}
        if(req.method==='GET'&&u.pathname==='/api/record'){
          send(res,200,await scoped(req,()=>workspace.read(u.searchParams.get('kind'),u.searchParams.get('id'),{offset:Number(u.searchParams.get('offset')??0),limit:Number(u.searchParams.get('limit')??20)})));return;
        }
        if(req.method==='GET'&&u.pathname==='/api/items'){
          const source=await scoped(req,()=>workspace.get('sources',u.searchParams.get('id'))),offset=Number(u.searchParams.get('offset')??0),limit=Number(u.searchParams.get('limit')??20);
          if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw fault('OPERATOR_PAGE','Choose a valid source page.');
          let items=source.items;
          const search=(u.searchParams.get('search')??'').toLowerCase();if(search)items=items.filter(i=>(String(i.key)+' '+i.object_json).toLowerCase().includes(search));
          send(res,200,{sourceId:source.id,items:items.slice(offset,offset+limit).map(brief),total:items.length,offset,limit});return;
        }
        if(req.method==='GET'&&u.pathname==='/api/item'){
          const source=await scoped(req,()=>workspace.get('sources',u.searchParams.get('source'))),item=source.items.find(i=>String(i.key)===u.searchParams.get('key')&&i.object_sha256===u.searchParams.get('variant'));
          if(!item)throw fault('OPERATOR_ITEM','Choose an original source variant.',404);send(res,200,item);return;
        }

        if(req.method==='GET'&&u.pathname==='/api/native-history'){
          send(res,200,await scoped(req,()=>workspace.nativeHistory(u.searchParams.get('id'))));return;
        }
        if(req.method==='GET'&&u.pathname==='/api/native-status'){
          send(res,200,await scoped(req,()=>nativeOperations.describe(workspace,u.searchParams.get('id'))));return;
        }
        if(req.method==='POST'&&u.pathname==='/api/connection'){
          const input=await body(req,16384);
          if(!object(input)||Object.keys(input).some(k=>!['baseUrl','token'].includes(k))||
              typeof input.baseUrl!=='string'||typeof input.token!=='string'||input.token.length>32768)
            throw fault('DIRECTUS_CONNECTION','Provide the Directus API URL and its transport credential.');
          const selected=new URL(input.baseUrl);
          if(!['https:','http:'].includes(selected.protocol)||selected.username||selected.password||selected.search||selected.hash)
            throw fault('DIRECTUS_CONNECTION','Use the original API URL with credentials supplied separately.');
          send(res,200,await scoped(req,()=>{connection={baseUrl:selected.href.replace(/\/$/,''),token:input.token};
            return {baseUrl:connection.baseUrl,configured:true,authenticated:Boolean(connection.token)};}));return;
        }
        if(req.method==='POST'&&u.pathname==='/api/native'){
          const {action,...input}=await body(req,2*1024*1024);
          send(res,202,await scoped(req,()=>nativeOperations.start({workspace,connection,action,input})));return;
        }
        if(req.method==='POST'&&u.pathname==='/api/merchant'){
          const {action,...input}=await body(req,2*1024*1024);
          const result=await scoped(req,async()=>{
            if(action==='prepare')return prepareDirectusMerchant({...input,workspace});
            if(action==='inspect'){
              const p=await readDirectusMerchant(input.directory);
              return {directory:p.directory,source:p.source,dataset:p.dataset,description:p.description,
                resource:p.service.publicOrigin+p.service.routes[0].path};
            }
            if(action==='serve'){
              const key=path.resolve(input.directory);
              const launchIdentity=hash(canonical({directory:key,stageDirectory:path.resolve(input.stageDirectory),runtime:input.runtime??{port:0}}));
              if(merchants.has(key)){
                const service=merchants.get(key);
                if(service.directusLaunchIdentity!==launchIdentity)throw fault('DIRECTUS_SELLER_RUNNING','This package is already serving with different original stage or runtime inputs.',409);
                return {directory:key,url:service.url,reused:true};
              }
              const service=await startDirectusMerchant(input);Object.defineProperty(service,'directusLaunchIdentity',{value:launchIdentity});merchants.set(key,service);
              return {directory:key,url:service.url,edition:service.edition,current:service.versions.status()};
            }
            if(action==='stop'){
              const key=path.resolve(input.directory),service=merchants.get(key);
              if(service){await service.close();merchants.delete(key);}return {directory:key,stopped:true};
            }
            if(action==='publish')return publishDirectusMerchant(input);
            throw fault('DIRECTUS_MERCHANT_ACTION','Choose prepare, inspect, serve, publish or stop.');
          });
          send(res,200,result);return;
        }
        if(req.method==='POST'&&u.pathname==='/api/buyer'){
          const {action,...input}=await body(req,2*1024*1024);
          const result=await scoped(req,async()=>{
            if(action==='offer')return reviewDirectusBuyer(input);
            if(action==='prepare')return prepareDirectusBuyer({...input,workspace});
            if(action==='receive')return receiveDirectusBuyer({...input,workspace});
            if(action==='inspect')return inspectDirectusDelivery(input.directory);
            throw fault('DIRECTUS_BUYER_ACTION','Choose offer, prepare, receive or inspect.');
          });
          send(res,200,result);return;
        }

        if(req.method==='GET'&&u.pathname==='/api/operation'){send(res,200,await scoped(req,()=>workspace.operation(u.searchParams.get('id'))));return;}
        if(req.method==='GET'&&u.pathname==='/api/download'){
          const file=await scoped(req,()=>workspace.exportFile(u.searchParams.get('kind'),u.searchParams.get('id')));
          res.writeHead(200,{'content-type':file.contentType,'content-length':file.bytes,'content-disposition':'attachment; filename="'+file.filename+'"','x-file-sha256':file.sha256});
          await pipeline(fs.createReadStream(file.path),res);return;
        }
        if(req.method==='POST'&&u.pathname==='/api/action'){
          const input=await body(req,MAX_SOURCE_BYTES*1.4),{action,...args}=input;
          send(res,200,await scoped(req,()=>workspace.dispatch(action,args)));return;
        }
        if(req.method==='POST'&&u.pathname==='/api/query'){
          const input=await body(req);
          const response=await scoped(req,()=>workspace.query(input.editionId,input.query??{}));
          send(res,response.status,response.body);return;
        }
        if(req.method==='POST'&&u.pathname==='/api/select-project'){
          const input=await body(req);send(res,200,await scoped(req,()=>select(input.key)));return;
        }
        if(req.method==='POST'&&u.pathname==='/api/receive'){
          const operationId=req.headers['x-operation-id'];
          if(typeof operationId!=='string'||!ID.test(operationId))throw fault('OPERATOR_REQUEST','Retain a stable receiving request ID.');
          const result=await scoped(req,async()=>{
            if(nativeOperations.active)throw fault('DIRECTUS_NATIVE_RUNNING','Let the active native request finish before receiving another workspace.',409);
            const uploads=path.join(root,'uploads');await fsp.mkdir(uploads,{recursive:true,mode:0o700});
            const temporary=path.join(uploads,operationId+'.partial-'+randomUUID()),digest=createHash('sha256');let bytes=0;
            const meter=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;if(bytes>MAX_SOURCE_BYTES)return callback(fault('OPERATOR_PROJECT_SIZE','Select a complete project up to 256 MiB.',413));digest.update(chunk);callback(null,chunk);}});
            try{
              await pipeline(req,meter,fs.createWriteStream(temporary,{flags:'wx',mode:0o600}));
              const completed=await fsp.open(temporary,'r');try{await completed.sync();}finally{await completed.close();}
              const sha256=digest.digest('hex'),file=path.join(uploads,sha256+'.sqlite3');
              try{await fsp.link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;
                const st=await fsp.lstat(file),check=createHash('sha256');let size=0;
                if(!st.isFile()||st.isSymbolicLink())throw fault('DIRECTUS_RECEIVING_FILE','The retained receiving file changed.',409);
                for await(const chunk of fs.createReadStream(file)){check.update(chunk);size+=chunk.length;}
                if(size!==bytes||check.digest('hex')!==sha256)throw fault('DIRECTUS_RECEIVING_FILE','The retained receiving file differs from its original bytes.',409);
              }
              const parent=await fsp.open(uploads,'r');try{await parent.sync();}finally{await parent.close();}
              const prior=registry.receiving[operationId];
              if(prior&&prior.sha256!==sha256)throw fault('OPERATOR_REQUEST_CHANGED','This receiving request belongs to a different original file.',409);
              const key='received-'+sha256;
              if(!registry.projects.some(p=>p.key===key)){
                const destination=path.join(root,'workspaces',key);
                const received=await receiveDirectusWorkspace({file,directory:destination}),receivedState=received.state();
                await received.close();
                const revised={...registry,projects:[...registry.projects,{key,name:'Received '+receivedState.id.slice(0,15),directory:destination}],receiving:{...registry.receiving,[operationId]:{sha256,bytes,key}}};
                await saveJson(registryFile,revised);registry=revised;
              }else if(!prior){
                const revised={...registry,receiving:{...registry.receiving,[operationId]:{sha256,bytes,key}}};await saveJson(registryFile,revised);registry=revised;
              }
              return {operationId,sha256,bytes,replayed:!!prior,state:await select(key)};
            }finally{await fsp.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
          });
          send(res,200,result);return;
        }
        throw fault('OPERATOR_ROUTE','Choose an available operator action.',404);
      }catch(error){
        if(res.headersSent){res.destroy(error);return;}
        const known=Number.isInteger(error.status)&&error.status>=400&&error.status<600;
        if(!known)process.stderr.write(JSON.stringify({event:'directus_operator_error',message:error.message,stack:error.stack})+'\n');
        send(res,known?error.status:500,{error:known?error.code:'OPERATOR_FAILURE',message:known?error.message:'The operation could not finish. Inspect its original request in the operator log.'});
      }
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
    const address=server.address();origin=new URL('http://'+(address.address.includes(':')?'['+address.address+']':address.address)+':'+address.port).origin;
    launch={schema:DIRECTUS_OPERATOR_LAUNCH_SCHEMA,state:'running',operatorId:registry.id,instanceId,pid:process.pid,
      directory:root,workspaceDirectory:selectedSource.selection.workspaceDirectory,url:origin,
      serverFile:path.join(selectedSource.executionSourceDirectory,'server.mjs'),serverSha256:selectedSource.serverSha256,
      sourceDirectory:selectedSource.selection.sourceDirectory,executionSourceDirectory:selectedSource.executionSourceDirectory,
      sourceSha256:selectedSource.selection.sourceSha256,selectionSha256:selectedSource.selectionSha256,startedAt:new Date().toISOString()};
    await saveJson(launchFile,{...launch,token});
    let closePromise;
    return {url:origin,token,state,launch:publicLaunch(),close(){
      if(closePromise)return closePromise;
      closing=true;closePromise=(async()=>{
        try{
          let failure;
          try{await new Promise(resolve=>server.close(resolve));await tail;}catch(error){failure=error;}
          try{await closeOwned();}catch(error){failure??=error;}
          if(failure)throw failure;
          lease.assertHeld();await saveJson(launchFile,{...launch,state:'stopped',stoppedAt:new Date().toISOString()});
        }finally{await lease.close();}
      })();return closePromise;
    }};
  }catch(error){
    try{try{if(server?.listening)await new Promise(resolve=>server.close(resolve));await tail;}finally{await closeOwned();}}
    finally{await lease.close();}
    throw error;
  }
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){
    if(!['--directory','--workspace','--port','--host','--source-directory','--expected-selection-sha256','--startup-format'].includes(args[i])||!args[i+1])throw new TypeError('Use --directory PRIVATE_OPERATOR --workspace EXISTING_WORKSPACE --port PORT.');
    options[{'--directory':'directory','--workspace':'workspaceDirectory','--port':'port','--host':'host','--source-directory':'sourceDirectory','--expected-selection-sha256':'expectedSelectionSha256','--startup-format':'startupFormat'}[args[i]]]=args[i]==='--port'?Number(args[i+1]):args[i+1];
  }
  if(options.startupFormat!==undefined&&options.startupFormat!=='managed')throw new TypeError('Use --startup-format managed.');
  const service=await startDirectusOperator(options);process.stdout.write(JSON.stringify(service.launch)+'\n');
  const stop=()=>service.close().then(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);
}

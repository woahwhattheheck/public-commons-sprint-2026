// MIT. Local operator for retained repository data and native dataset editions.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {openDspaceWorkspace,receiveDspaceWorkspace} from './workspace.mjs';
import {acquireDatasetLease} from '../dataset-refresh/writer-lease.mjs';
import {hash,fault,MAX_SOURCE_BYTES} from './source.mjs';

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
const brief=item=>({uuid:item.uuid,objectSha256:item.object_sha256,name:item.name,entity_type:item.entity_type,fields:item.fields,metadata_count:item.metadata_count,in_scope:item.in_scope,origins:item.origins});
export async function startDspaceOperator({directory,workspaceDirectory,host='127.0.0.1',port=0,token=randomBytes(32).toString('base64url')}={}){
  if(!['127.0.0.1','::1','localhost'].includes(host))throw fault('OPERATOR_HOST','Use a loopback host for this private operator.');
  const root=path.resolve(directory??'.dspace-operator');await fsp.mkdir(root,{recursive:true,mode:0o700});
  const lease=acquireDatasetLease(root),registryFile=path.join(root,'operator.json');
  let registry,workspace,server,tail=Promise.resolve(),closing=false;
  const serial=job=>{const result=tail.then(()=>{if(closing)throw fault('OPERATOR_CLOSING','The operator is closing.',409);return job();});tail=result.catch(()=>{});return result;};
  try{
    try{registry=JSON.parse(await fsp.readFile(registryFile,'utf8'));}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      registry={schema:'stellar-forge.dspace-operator.v1',selected:'original',projects:[{key:'original',name:'Original workspace',directory:path.resolve(workspaceDirectory??path.join(root,'workspaces','original'))}],receiving:{}};
      await saveJson(registryFile,registry);
    }
    if(registry.schema!=='stellar-forge.dspace-operator.v1'||!registry.projects.some(p=>p.key===registry.selected))
      throw fault('OPERATOR_PROJECTS','The original operator project registry is invalid.');
    workspace=await openDspaceWorkspace({directory:registry.projects.find(p=>p.key===registry.selected).directory});
    let origin;
    const state=()=>({...workspace.state(),operator:{selected:registry.selected,projects:registry.projects.map(({key,name})=>({key,name}))}});
    const select=async key=>{
      const selected=registry.projects.find(p=>p.key===key);if(!selected)throw fault('OPERATOR_PROJECT','Choose an available original workspace.',404);
      if(key===registry.selected)return state();
      const next=await openDspaceWorkspace({directory:selected.directory});
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
          if(u.pathname==='/')res.setHeader('set-cookie','dspace_operator='+token+'; HttpOnly; SameSite=Strict; Path=/');
          res.writeHead(200,{'content-type':filename.endsWith('.html')?'text/html; charset=utf-8':filename.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','content-length':bytes.length});res.end(bytes);return;
        }
        const cookie=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('dspace_operator='))?.slice(16);
        if(!sameToken(req.headers.authorization?.replace(/^Bearer /,''))&&!sameToken(cookie))
          throw fault('OPERATOR_AUTH','Open the local operator or supply its bearer credential.',401);
        if(req.method==='GET'&&u.pathname==='/api/state'){send(res,200,await serial(state));return;}
        if(req.method==='GET'&&u.pathname==='/api/record'){
          send(res,200,await serial(()=>workspace.read(u.searchParams.get('kind'),u.searchParams.get('id'),{offset:Number(u.searchParams.get('offset')??0),limit:Number(u.searchParams.get('limit')??20)})));return;
        }
        if(req.method==='GET'&&u.pathname==='/api/items'){
          const source=await serial(()=>workspace.get('sources',u.searchParams.get('id'))),offset=Number(u.searchParams.get('offset')??0),limit=Number(u.searchParams.get('limit')??20);
          if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw fault('OPERATOR_PAGE','Choose a valid source page.');
          let items=source.items;
          if(u.searchParams.get('scope')==='collection')items=items.filter(i=>i.in_scope);
          const search=(u.searchParams.get('search')??'').toLowerCase();if(search)items=items.filter(i=>(i.name+' '+i.uuid+' '+i.entity_type).toLowerCase().includes(search));
          send(res,200,{sourceId:source.id,items:items.slice(offset,offset+limit).map(brief),total:items.length,offset,limit});return;
        }
        if(req.method==='GET'&&u.pathname==='/api/item'){
          const source=await serial(()=>workspace.get('sources',u.searchParams.get('source'))),item=source.items.find(i=>i.uuid===u.searchParams.get('uuid')&&i.object_sha256===u.searchParams.get('variant'));
          if(!item)throw fault('OPERATOR_ITEM','Choose an original source variant.',404);send(res,200,item);return;
        }
        if(req.method==='GET'&&u.pathname==='/api/operation'){send(res,200,await serial(()=>workspace.operation(u.searchParams.get('id'))));return;}
        if(req.method==='GET'&&u.pathname==='/api/download'){
          const file=await serial(()=>workspace.exportFile(u.searchParams.get('kind'),u.searchParams.get('id')));
          res.writeHead(200,{'content-type':file.contentType,'content-length':file.bytes,'content-disposition':'attachment; filename="'+file.filename+'"','x-file-sha256':file.sha256});
          await pipeline(fs.createReadStream(file.path),res);return;
        }
        if(req.method==='POST'&&u.pathname==='/api/action'){
          const input=await body(req,MAX_SOURCE_BYTES*1.4),{action,...args}=input;
          send(res,200,await serial(()=>workspace.dispatch(action,args)));return;
        }
        if(req.method==='POST'&&u.pathname==='/api/query'){
          const input=await body(req);
          const response=await serial(()=>workspace.query(input.editionId,input.query??{}));
          send(res,response.status,response.body);return;
        }
        if(req.method==='POST'&&u.pathname==='/api/select-project'){
          const input=await body(req);send(res,200,await serial(()=>select(input.key)));return;
        }
        if(req.method==='POST'&&u.pathname==='/api/receive'){
          const operationId=req.headers['x-operation-id'];
          if(typeof operationId!=='string'||!ID.test(operationId))throw fault('OPERATOR_REQUEST','Retain a stable receiving request ID.');
          const result=await serial(async()=>{
            const uploads=path.join(root,'uploads');await fsp.mkdir(uploads,{recursive:true,mode:0o700});
            const temporary=path.join(uploads,operationId+'.partial-'+randomUUID()),digest=createHash('sha256');let bytes=0;
            const meter=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;if(bytes>MAX_SOURCE_BYTES)return callback(fault('OPERATOR_PROJECT_SIZE','Select a complete project up to 256 MiB.',413));digest.update(chunk);callback(null,chunk);}});
            try{
              await pipeline(req,meter,fs.createWriteStream(temporary,{flags:'wx',mode:0o600}));
              const sha256=digest.digest('hex'),file=path.join(uploads,sha256+'.sqlite3');
              try{await fsp.link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;}
              const prior=registry.receiving[operationId];
              if(prior&&prior.sha256!==sha256)throw fault('OPERATOR_REQUEST_CHANGED','This receiving request belongs to a different original file.',409);
              const key='received-'+sha256;
              if(!registry.projects.some(p=>p.key===key)){
                const destination=path.join(root,'workspaces',key);
                const received=await receiveDspaceWorkspace({file,directory:destination}),receivedState=received.state();
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
        send(res,error.status??500,{error:error.code??'OPERATOR_FAILURE',message:error.message});
      }
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
    const address=server.address();origin='http://'+(address.address.includes(':')?'['+address.address+']':address.address)+':'+address.port;
    let closePromise;
    return {url:origin,token,state,close(){
      if(closePromise)return closePromise;
      closing=true;closePromise=(async()=>{await new Promise(resolve=>server.close(resolve));await tail;await workspace.close();await lease.close();})();return closePromise;
    }};
  }catch(error){await workspace?.close();await lease.close();throw error;}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){
    if(!['--directory','--workspace','--port','--host'].includes(args[i])||!args[i+1])throw new TypeError('Use --directory PRIVATE_OPERATOR --workspace EXISTING_WORKSPACE --port PORT.');
    options[{'--directory':'directory','--workspace':'workspaceDirectory','--port':'port','--host':'host'}[args[i]]]=args[i]==='--port'?Number(args[i+1]):args[i+1];
  }
  const service=await startDspaceOperator(options);process.stdout.write(JSON.stringify({url:service.url,directory:path.resolve(options.directory??'.dspace-operator')})+'\n');
  const stop=()=>service.close().then(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);
}

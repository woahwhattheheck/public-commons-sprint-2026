// MIT. One original authenticated operator listener with native Plaid callback routes.
import {createServer} from 'node:http';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {constants,openSync,closeSync,readFileSync,writeFileSync,fsyncSync,fstatSync,lstatSync,
  mkdirSync,renameSync,unlinkSync,existsSync,createReadStream,createWriteStream} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {TextDecoder} from 'node:util';
import {publicTables,publicActions} from './operator.mjs';
import {createGridProcedureController} from './procedure-controller.mjs';
import {readBrowserAssets} from '../../distribution/browser-assets.mjs';
import {createGridFabricFileReader,GRIDFABRIC_FILE_RANGE} from './native-file-reader.mjs';
import {privateDirectory} from './sqlite-store.mjs';
import {exportWorkspace,listExports,exportMetadata,restoreWorkspace,restorationStatus,artifactIdentity} from './delivery.mjs';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,statusCode});
const safeEqual=(a,b)=>timingSafeEqual(createHash('sha256').update(String(a)).digest(),createHash('sha256').update(String(b)).digest());
const json=(response,status,value)=>{const body=Buffer.from(JSON.stringify(value)+'\n');response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store'});response.end(body);};
const contentName=name=>"attachment; filename*=UTF-8''"+encodeURIComponent(basename(name)).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const exceptionView=error=>({code:error.code||'GRIDFABRIC_HTTP_ERROR',message:String(error.message||error),...(error.details?{details:error.details}:{})});
function unsigned(value,label,defaultValue){
  if(value===null||value===undefined||value==='')return defaultValue;
  if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw fail('GRIDFABRIC_PAGE',label+' must be a nonnegative integer.');
  return Number(value);
}
async function bodyBytes(request,limit){
  const length=request.headers['content-length'];
  if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>limit))throw fail('GRIDFABRIC_REQUEST_LIMIT','The complete request exceeds the selected native owner allowance.',413);
  let total=0;const chunks=[];
  for await(const chunk of request){total+=chunk.length;if(total>limit)throw fail('GRIDFABRIC_REQUEST_LIMIT','The complete request exceeds the selected native owner allowance.',413);chunks.push(Buffer.from(chunk));}
  if(length!==undefined&&total!==Number(length))throw fail('GRIDFABRIC_REQUEST_INCOMPLETE','The original request body ended before its declared length.');
  return Buffer.concat(chunks);
}
async function objectBody(request,limit){
  const value=JSON.parse(decoder.decode(await bodyBytes(request,limit)));
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail('GRIDFABRIC_REQUEST_OBJECT','Use a JSON object for the original operation.');
  return value;
}
function operationEnvelope(body){
  if(!UUID.test(body.request_id||'')||!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0)
    throw fail('GRIDFABRIC_OPERATION_ENVELOPE','Supply the exact original request UUID and workspace revision.');
  if(!body.input||typeof body.input!=='object'||Array.isArray(body.input))throw fail('GRIDFABRIC_OPERATION_INPUT','Supply the original action input object.');
  return {request_id:body.request_id,expected_revision:body.expected_revision};
}
function callbackAuthentication(request,instance,environment){
  for(const [name,reference] of Object.entries(instance.callback_headers_env||{})){
    const expected=environment[reference];
    if(typeof expected!=='string'||!expected)throw fail('GRIDFABRIC_CALLBACK_CONFIGURATION','An original callback header environment reference is unavailable.',503);
    const occurrences=request.rawHeaders.filter((_,index)=>index%2===0&&request.rawHeaders[index].toLowerCase()===name.toLowerCase()).length;
    if(occurrences!==1||!safeEqual(request.headers[name.toLowerCase()]||'',expected))
      throw fail('GRIDFABRIC_CALLBACK_AUTH','The configured original callback authentication did not match.',401);
  }
  if(instance.callback_basic_user_env||instance.callback_basic_password_env){
    const user=environment[instance.callback_basic_user_env],password=environment[instance.callback_basic_password_env];
    if(typeof user!=='string'||typeof password!=='string')throw fail('GRIDFABRIC_CALLBACK_CONFIGURATION','The original callback basic credential references are unavailable.',503);
    if(!safeEqual(request.headers.authorization||'','Basic '+Buffer.from(user+':'+password).toString('base64')))
      throw fail('GRIDFABRIC_CALLBACK_AUTH','The configured original callback authentication did not match.',401);
  }
}
function publishedConnection(path,url){
  if(!path)return ()=>{};
  const target=resolve(path);privateDirectory(dirname(target));
  if(existsSync(target))throw fail('GRIDFABRIC_CONNECTION_EXISTS','Use a new private connection file.');
  const bytes=Buffer.from(url+'\n'),fd=openSync(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  return ()=>{
    if(!existsSync(target))return;
    const fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const stat=fstatSync(fd),named=lstatSync(target),observed=readFileSync(fd);
      if(stat.isFile()&&stat.nlink===1&&stat.ino===named.ino&&stat.dev===named.dev&&observed.equals(bytes))unlinkSync(target);
    }finally{closeSync(fd);}
  };
}
export function sourceIdentity(){
  const names=['core.cjs','model.cjs','sqlite-store.mjs','files.mjs','native-file-reader.mjs','operator.mjs','server.mjs','delivery.mjs','cli.mjs',
    'public/index.html','public/style.css','public/app.mjs','contracts/plaid-public-contract.json','contracts/management-examples.json',
    'procedure-files.mjs','procedure-archive.mjs','procedure-controller.mjs','public/procedures.html','public/procedures.mjs','public/procedures.css','browser-assets.json','../../distribution/browser-assets.mjs'];
  const modules=names.map(path=>{const bytes=readFileSync(join(ROOT,path));return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
  const leasePath=new URL('../../merchant-fleet-gateway/state-lease.mjs',import.meta.url),lease=readFileSync(leasePath);
  modules.push({path:'../../merchant-fleet-gateway/state-lease.mjs',bytes:lease.length,sha256:createHash('sha256').update(lease).digest('hex')});
  return {schema:'stellar-forge.gridfabric-native-source.v1',node:process.versions.node,modules,
    sha256:createHash('sha256').update(JSON.stringify(modules)).digest('hex')};
}
export async function startGridFabricServer({workspace,port=0,host='127.0.0.1',connectionFile,
  environment=process.env,maximumRequestBytes=256*1024*1024,maximumPortableBytes=4*1024*1024*1024}={}){
  if(host!=='127.0.0.1')throw fail('GRIDFABRIC_LISTEN_HOST','The original operator listens on IPv4 loopback; use the configured secured proxy for remote Plaid callbacks.');
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw fail('GRIDFABRIC_LISTEN_PORT','Select a valid loopback port, or zero.');
  if(!Number.isSafeInteger(maximumRequestBytes)||maximumRequestBytes<1024||!Number.isSafeInteger(maximumPortableBytes)||maximumPortableBytes<1024)
    throw fail('GRIDFABRIC_HTTP_LIMIT','Select positive complete request and portable byte allowances.');
  const browserAssets=await readBrowserAssets(new URL('./browser-assets.json',import.meta.url));
  const token=randomBytes(32).toString('base64url'),callbacks=new Set(),requests=new Set(),jobs=new Set(),exportsInFlight=new Map(),restoresInFlight=new Set();
  const callbackRoutes=new Map(workspace.publicContract.callbacks.map(item=>[item.endpoint,item]));
  const source=sourceIdentity(),transferFiles=createGridFabricFileReader();let origin=null,closing=false,closePromise=null,removeConnection=()=>{};
  const procedures=createGridProcedureController({workspace,source,origin:()=>origin,token,tables:publicTables(),maximumRequestBytes,
    maximumArchiveBytes:maximumPortableBytes});
  async function transferFile(kind,id) {
    let path,metadata;
    if(kind==='file') {
      path=workspace.files.filePath(id);
      const saved=workspace.fileMetadata(id);
      metadata={file_id:id,kind,name:saved?.name||id+'.txt',mime_type:saved?.mime_type||'text/plain',
        sha256:id,...(saved?{bytes:saved.bytes}:{})};
    } else {
      const saved=exportMetadata(workspace,id);
      if(saved.status!=='READY')throw fail('GRIDFABRIC_EXPORT_PENDING','The original portable export has not finished.',409);
      path=join(workspace.directory,'exports',saved.name);
      metadata={file_id:id,kind,name:saved.name,mime_type:'application/gzip',sha256:saved.sha256,bytes:saved.bytes};
    }
    const info=await transferFiles.info(path,metadata);
    return {path,file:{schema:'stellar-forge.gridfabric-native-file.v1',workspace_id:workspace.workspace_id,...metadata,...info}};
  }
  async function transferRange(response,url,kind,id) {
    const selected=await transferFile(kind,id);
    if(url.searchParams.get('expected_sha256')!==selected.file.sha256||
       !url.searchParams.has('offset')||!url.searchParams.has('limit'))
      throw fail('GRIDFABRIC_TRANSFER_IDENTITY','Repeat the original SHA256, offset and byte limit.',409);
    const offset=unsigned(url.searchParams.get('offset'),'offset'),limit=unsigned(url.searchParams.get('limit'),'limit');
    const part=await transferFiles.range(selected.path,selected.file,{offset,limit});
    const headers={'Content-Type':selected.file.mime_type,'Content-Length':part.bytes.length,
      'X-Content-SHA256':part.sha256,'X-Chunk-SHA256':part.chunk_sha256,
      'X-GridFabric-File-Bytes':part.total,'X-GridFabric-File-Offset':part.offset,
      'Content-Disposition':contentName(selected.file.name),'ETag':'"'+part.sha256+'"'};
    if(part.bytes.length)headers['Content-Range']='bytes '+part.offset+'-'+(part.offset+part.bytes.length-1)+'/'+part.total;
    response.writeHead(part.bytes.length?206:200,headers);response.end(part.bytes);
  }

  const server=createServer((request,response)=>{
    response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy','same-origin');response.setHeader('Cache-Control','no-store');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    let settle;const drained=new Promise(resolve=>{settle=resolve;});requests.add(drained);
    const completed=()=>{requests.delete(drained);callbacks.delete(drained);settle();};
    response.once('finish',completed);response.once('close',completed);
    const handle=async()=>{
      if(closing&&request.method!=='GET')throw fail('GRIDFABRIC_LISTENER_CLOSING','The original listener is draining.',503);
      if(request.headers.host!==new URL(origin).host)throw fail('GRIDFABRIC_HOST','Use the original loopback authority.',403);
      const url=new URL(request.url,origin);
      const browserOrigin=request.headers.origin;
      if(browserOrigin!==undefined&&browserOrigin!==origin)throw fail('GRIDFABRIC_ORIGIN','Use the original operator origin.',403);
      if(url.pathname.startsWith('/callbacks/')){
        if(request.method!=='POST')throw fail('GRIDFABRIC_CALLBACK_METHOD','The original callback method is POST.',405);
        const parts=url.pathname.split('/');
        if(parts.length!==4||!callbackRoutes.has(parts[3]))throw fail('GRIDFABRIC_CALLBACK_ROUTE','Select a documented callback endpoint.',404);
        const instanceId=decodeURIComponent(parts[2]),instance=workspace.detail('instances',instanceId).record,contract=callbackRoutes.get(parts[3]);
        callbackAuthentication(request,instance,environment);callbacks.add(drained);
        const bytes=await bodyBytes(request,maximumRequestBytes);
        if(bytes.length===0&&contract.messageType!=='OnHeartbeat')throw fail('GRIDFABRIC_CALLBACK_BODY','Only the documented heartbeat endpoint accepts an empty body.');
        const result=workspace.handleCallback(instanceId,decoder.decode(bytes),{callback_kind:contract.messageType});
        if(!Number.isInteger(result.http_status)||typeof result.body_utf8!=='string')throw fail('GRIDFABRIC_CALLBACK_RESULT','The original callback returned an invalid native response.',500);
        const body=Buffer.from(result.body_utf8);
        response.writeHead(result.http_status,{'Content-Type':body.length?'application/json; charset=utf-8':'text/plain',
          'Content-Length':body.length,'X-GridFabric-Callback-Id':String(result.callback_id||''),'X-GridFabric-Delivery-Id':String(result.delivery_id||'')});
        response.end(body);return;
      }
      if(request.method==='GET'&&browserAssets.has(url.pathname)){
        const {url:assetUrl,type}=browserAssets.get(url.pathname),body=readFileSync(assetUrl);
        response.writeHead(200,{'Content-Type':type,'Content-Length':body.length});response.end(body);return;
      }
      if(!safeEqual(request.headers.authorization||'','Bearer '+token))throw fail('GRIDFABRIC_OPERATOR_AUTH','Use the private original operator connection.',401);
      response.setHeader('X-GridFabric-Workspace-ID',workspace.workspace_id);
      if(request.method==='POST'&&browserOrigin!==origin)throw fail('GRIDFABRIC_ORIGIN','Native operator writes require the exact Origin header.',403);
      if(await procedures.handle(request,response,url))return;
      if(request.method==='GET'){
        if(url.pathname==='/api/state'){json(response,200,workspace.state());return;}
        if(url.pathname==='/api/launch'){json(response,200,{schema:'stellar-forge.gridfabric-launch.v1',status:'READY',workspace_id:workspace.workspace_id,
          workspace:workspace.directory,origin,revision:workspace.state().revision,source,tables:publicTables(),actions:publicActions()});return;}
        if(url.pathname==='/api/source'){json(response,200,source);return;}
        if(url.pathname==='/api/contracts'){json(response,200,{public:workspace.publicContract,examples:JSON.parse(readFileSync(join(ROOT,'contracts/management-examples.json'),'utf8'))});return;}
        if(url.pathname==='/api/page'||url.pathname==='/api/host/page'){
          const selected={offset:unsigned(url.searchParams.get('offset'),'offset',0),limit:unsigned(url.searchParams.get('limit'),'limit',100)};
          for(const name of ['scope','tag','gte','lt','order'])if(url.searchParams.has(name))selected[name]=url.searchParams.get(name);
          json(response,200,url.pathname==='/api/page'?workspace.page(url.searchParams.get('collection'),selected):workspace.hostPage(url.searchParams.get('collection'),selected));return;
        }
        if(url.pathname==='/api/detail'){json(response,200,workspace.detail(url.searchParams.get('collection'),url.searchParams.get('id')));return;}
        if(url.pathname==='/api/operation'){
          const id=url.searchParams.get('request_id'),host=workspace.hostOperation(id);let original=null;
          try{original=workspace.detail('operations',id).record;}catch(error){if(error.code!=='RECORD_NOT_FOUND')throw error;}
          if(!original&&!host)throw fail('GRIDFABRIC_OPERATION_NOT_FOUND','The original request was not accepted.',404);
          json(response,200,{request_id:id,operation:original,host_dispatch:host,workspace_id:workspace.workspace_id,revision:workspace.state().revision});return;
        }
        if(url.pathname==='/api/file-info'||url.pathname==='/api/export-info'){
          const selected=await transferFile(url.pathname==='/api/file-info'?'file':'export',url.searchParams.get('id'));
          json(response,200,selected.file);return;
        }
        if(url.pathname==='/api/file'){
          const id=url.searchParams.get('id');
          if(url.searchParams.has('offset')||url.searchParams.has('limit')){await transferRange(response,url,'file',id);return;}
          const body=workspace.files.readBytes(id),metadata=workspace.fileMetadata(id)||{name:id+'.txt',mime_type:'text/plain'};
          response.writeHead(200,{'Content-Type':metadata.mime_type,'Content-Length':body.length,'Content-Disposition':contentName(metadata.name),
            'ETag':'"'+id+'"','X-Content-SHA256':id});response.end(body);return;
        }
        if(url.pathname==='/api/restore-status'){
          const name=url.searchParams.get('name');
          if(!name||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name)||name==='.'||name==='..')
            throw fail('GRIDFABRIC_RESTORE_NAME','Select the original sibling workspace name.');
          json(response,200,await restorationStatus({destination:join(dirname(workspace.directory),name),expectedSha256:url.searchParams.get('sha256')||undefined}));return;
        }
        if(url.pathname==='/api/exports'){json(response,200,{items:listExports(workspace)});return;}
        if(url.pathname==='/api/export'){
          if(url.searchParams.has('offset')||url.searchParams.has('limit')){await transferRange(response,url,'export',url.searchParams.get('id'));return;}
          const item=exportMetadata(workspace,url.searchParams.get('id'));
          if(item.status!=='READY')throw fail('GRIDFABRIC_EXPORT_PENDING','The original portable export has not finished.',409);
          const path=join(workspace.directory,'exports',item.name),actual=await artifactIdentity(path);
          if(actual.sha256!==item.sha256||actual.bytes!==item.bytes)throw fail('GRIDFABRIC_EXPORT_CHANGED','The complete retained export changed.',409);
          response.writeHead(200,{'Content-Type':'application/gzip','Content-Length':item.bytes,'Content-Disposition':contentName(item.name),
            'X-Content-SHA256':item.sha256,'ETag':'"'+item.sha256+'"'});
          await pipeline(createReadStream(path),response);return;
        }
        throw fail('GRIDFABRIC_ROUTE','The original read route does not exist.',404);
      }
      if(request.method!=='POST')throw fail('GRIDFABRIC_METHOD','Use the original read or action method.',405);
      if(url.pathname==='/api/action'){
        const body=await objectBody(request,maximumRequestBytes),options=operationEnvelope(body);
        json(response,200,workspace.execute(body.action,body.input,options));return;
      }
      if(url.pathname==='/api/upload'){
        const declared=request.headers['content-length'],expected=request.headers['x-gridfabric-sha256'];
        if(expected!==undefined&&declared!==undefined) {
          if(!/^[0-9a-f]{64}$/.test(expected)||!/^\d+$/.test(declared)||!Number.isSafeInteger(Number(declared))||
             Number(declared)>maximumRequestBytes)
            throw fail('GRIDFABRIC_UPLOAD_IDENTITY','Select the complete source byte count and SHA256 within the native allowance.',413);
          const receiver=workspace.beginUpload({sha256:expected,bytes:Number(declared),
            name:decodeURIComponent(request.headers['x-gridfabric-name']||'Original_Source.json'),
            mime_type:request.headers['content-type']||'application/octet-stream'});
          let complete=false;
          try {
            for await(const chunk of request)receiver.write(chunk);
            const result=receiver.finish();complete=true;json(response,200,result);return;
          }finally{if(!complete)receiver.abort();}
        }
        const bytes=await bodyBytes(request,maximumRequestBytes),sha=createHash('sha256').update(bytes).digest('hex');
        if(request.headers['x-gridfabric-sha256']&&request.headers['x-gridfabric-sha256']!==sha)
          throw fail('GRIDFABRIC_UPLOAD_SHA','The original uploaded source bytes differ.');
        const name=decodeURIComponent(request.headers['x-gridfabric-name']||'Original_Source.json');
        const mime_type=request.headers['content-type']||'application/octet-stream';
        json(response,200,workspace.upload(decoder.decode(bytes),{name,mime_type}));return;
      }
      if(url.pathname==='/api/dispatch/management'||url.pathname==='/api/dispatch/device'){
        const body=await objectBody(request,maximumRequestBytes),options=operationEnvelope(body);
        options.beforeDispatch=()=>Promise.all([...callbacks]);
        const result=url.pathname.endsWith('/management')?await workspace.dispatchManagement(body.input,options):await workspace.dispatchDevice(body.input,options);
        json(response,200,result);return;
      }
      if(url.pathname==='/api/export'){
        const body=await objectBody(request,maximumRequestBytes);
        if(!UUID.test(body.request_id||''))throw fail('GRIDFABRIC_EXPORT_ID','Use the original export UUID.');
        const existing=exportsInFlight.get(body.request_id);
        if(existing&&existing.revision!==body.expected_revision)throw fail('GRIDFABRIC_EXPORT_REQUEST_CONFLICT','This original export UUID names a different revision.',409);
        let promise=existing?.promise;
        if(!promise){
          promise=exportWorkspace(workspace,{request_id:body.request_id,expected_revision:body.expected_revision,source});
          exportsInFlight.set(body.request_id,{promise,revision:body.expected_revision});promise.finally(()=>exportsInFlight.delete(body.request_id)).catch(()=>{});
        }
        json(response,200,await promise);return;
      }
      if(url.pathname==='/api/restore'){
        const name=url.searchParams.get('name'),requestId=request.headers['x-gridfabric-request-id'],expectedSha=request.headers['x-gridfabric-sha256'];
        if(!name||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name)||name==='.'||name==='..'||!UUID.test(requestId||'')||!/^[0-9a-f]{64}$/.test(expectedSha||''))
          throw fail('GRIDFABRIC_RESTORE_NAME','Choose the original receiving name, request UUID and complete archive SHA256.');
        if(restoresInFlight.has(requestId))throw fail('GRIDFABRIC_RESTORE_ACTIVE','This original receiving request is still active; read its outcome before continuing.',409);
        restoresInFlight.add(requestId);
        try{
          const receiving=join(workspace.directory,'receiving');privateDirectory(receiving);
          const file=join(receiving,requestId+'.jsonl.gz'),part=file+'.part',bindingPath=join(receiving,requestId+'.json');
          const binding={schema:'stellar-forge.gridfabric-restore-upload.v1',request_id:requestId,workspace_id:workspace.workspace_id,
            destination:join(dirname(workspace.directory),name),sha256:expectedSha};
          if(existsSync(bindingPath)){
            const fd=openSync(bindingPath,constants.O_RDONLY|constants.O_NOFOLLOW);
            let retained;try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)throw fail('GRIDFABRIC_RESTORE_BINDING','Keep the original receiving request file.');
              retained=JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}
            if(JSON.stringify(retained)!==JSON.stringify(binding))throw fail('GRIDFABRIC_RESTORE_UPLOAD_CONFLICT','This original request UUID names another archive or receiving destination.',409);
          }else{
            if(existsSync(file)||existsSync(part))throw fail('GRIDFABRIC_RESTORE_BINDING','The old upload has no complete original request binding; preserve it and review a new request UUID.',409);
            const temporary=join(receiving,'.binding-'+randomUUID()),fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
            try{writeFileSync(fd,JSON.stringify(binding));fsyncSync(fd);}finally{closeSync(fd);}
            renameSync(temporary,bindingPath);
            const directory=openSync(receiving,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(directory);}finally{closeSync(directory);}
          }
          if(existsSync(part)){
            const stat=lstatSync(part);
            if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw fail('GRIDFABRIC_RESTORE_UPLOAD_PENDING','Keep the original incomplete upload for inspection.',409);
            // Only this bound request owns its incomplete copy; the exact full body is received again.
            unlinkSync(part);
          }
          let bytes=0;const hash=createHash('sha256');
          const expectedLength=request.headers['content-length'];
          if(expectedLength!==undefined&&(!/^\d+$/.test(expectedLength)||Number(expectedLength)>maximumPortableBytes))
            throw fail('GRIDFABRIC_RESTORE_LIMIT','The complete portable upload exceeds the selected allowance.',413);
          if(existsSync(file)){
            for await(const chunk of request){
              bytes+=chunk.length;if(bytes>maximumPortableBytes)throw fail('GRIDFABRIC_RESTORE_LIMIT','The complete portable upload exceeds the selected allowance.',413);
              hash.update(chunk);
            }
            const actual=await artifactIdentity(file);
            if(actual.sha256!==expectedSha||actual.bytes!==bytes||hash.digest('hex')!==expectedSha)
              throw fail('GRIDFABRIC_RESTORE_UPLOAD_CONFLICT','This original request UUID contains different complete bytes.',409);
          }else{
            const limit=new Transform({transform(chunk,encoding,callback){
              bytes+=chunk.length;if(bytes>maximumPortableBytes){callback(fail('GRIDFABRIC_RESTORE_LIMIT','The complete portable upload exceeds the selected allowance.',413));return;}
              hash.update(chunk);callback(null,chunk);
            }});
            await pipeline(request,limit,createWriteStream(part,{flags:'wx',mode:0o600}));
            const fd=openSync(part,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}
            if(hash.digest('hex')!==expectedSha)throw fail('GRIDFABRIC_RESTORE_UPLOAD_SHA','The complete original portable upload SHA256 differs.');
            if(expectedLength!==undefined&&bytes!==Number(expectedLength))throw fail('GRIDFABRIC_RESTORE_UPLOAD_LENGTH','The complete original upload length differs.');
            renameSync(part,file);
            const directory=openSync(receiving,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(directory);}finally{closeSync(directory);}
          }
          if(expectedLength!==undefined&&bytes!==Number(expectedLength))throw fail('GRIDFABRIC_RESTORE_UPLOAD_LENGTH','The complete original upload length differs.');
          json(response,200,await restoreWorkspace({file,destination:binding.destination,expectedSha256:expectedSha}));return;
        }finally{restoresInFlight.delete(requestId);}
      }
      throw fail('GRIDFABRIC_ROUTE','The original action route does not exist.',404);
    };
    const job=handle().catch(error=>{
      if(!response.headersSent&&!response.destroyed)json(response,Number.isInteger(error.statusCode)?error.statusCode:Number.isInteger(error.http_status)?error.http_status:error instanceof SyntaxError?400:500,{error:exceptionView(error)});
      else response.destroy(error);
    });
    jobs.add(job);job.then(()=>jobs.delete(job),()=>jobs.delete(job));
  });
  server.requestTimeout=600000;server.headersTimeout=60000;server.keepAliveTimeout=5000;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});});
    origin='http://127.0.0.1:'+server.address().port;
    removeConnection=publishedConnection(connectionFile,origin+'/#'+token);
  }catch(error){await new Promise(resolve=>server.close(()=>resolve()));throw error;}
  return {origin,consoleUrl:origin+'/#'+token,source,workspace_id:workspace.workspace_id,
    launch:{schema:'stellar-forge.gridfabric-launch.v1',status:'READY',workspace_id:workspace.workspace_id,workspace:workspace.directory,origin,source},
    close(){
      if(closePromise)return closePromise;closing=true;
      closePromise=(async()=>{
        // Existing captures finish their read-only SDK requests before this listener closes.
        await procedures.close();
        const stopped=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));server.closeIdleConnections();
        await stopped;await Promise.allSettled([...requests,...jobs,...[...exportsInFlight.values()].map(item=>item.promise)]);removeConnection();transferFiles.close();
      })().catch(error=>{closePromise=null;throw error;});return closePromise;
    }};
}

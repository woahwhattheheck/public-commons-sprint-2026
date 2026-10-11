// MIT. Private loopback transport for the original direct-provider workflow.
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile,open,rm,rename} from 'node:fs/promises';
import {constants} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {openProviderDesk} from './model.mjs';
import {fail,requireValue as need,nativeErrorCode} from '../operator-lock.mjs';

const HOST='127.0.0.1';
const security={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'cross-origin-resource-policy':'same-origin',
  'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
const errors={
  DESK_CASE_CHANGED_REFRESH:'The saved case changed. Refresh its original records before continuing.',
  DESK_INTENT_ALREADY_ATTACHED:'That stable intent is already attached. Open its existing case.',
  DESK_PREPARATION_ID_REUSED:'This preparation identifier belongs to different saved inputs. Open the existing case.',
  PILOT_OPERATION_BUSY:'An original operation owns this case. Its owner and state are shown in the case.',
  PILOT_OPERATION_OWNER_NOT_STOPPED:'The original operation owner has not been shown to be stopped.',
  PILOT_NATIVE_ATTEMPT_OWNER_NOT_STOPPED:'The native queue attempt may still be running. Its permanent record is unchanged.',
  RECOVERY_DESTINATION_ALREADY_EXISTS:'The original destination already exists. Recovery never overwrites a live case.',
  RECOVERY_EXACT_ORIGINAL_DIRECTORY_REQUIRED:'Restore must use the original absolute case directory shown in the archive.',
  RECOVERY_PASSPHRASE_OR_ARCHIVE_INVALID:'The passphrase or encrypted file could not be verified. The uploaded file is retained for another explicit attempt.',
  DESK_HOST_PROFILE_NOT_FOUND:'Choose a configured host profile. The setup panel contains the native profile command.',
  DESK_ORIGINAL_COMPLETE_RESPONSE_REQUIRED:'The original buyer has not recorded a complete returned file.',
  DESK_RETAINED_FILE_CHANGED:'The local file no longer matches the original saved delivery result.',
  RECOVERY_USE_TRUSTED_TERMINAL_FOR_EXTERNAL_PATH:'This archive belongs outside the desk’s managed case root. Use its exact restore command on the trusted terminal.',
};
async function json(req,max=65536) {
  need((req.headers['content-type']??'').split(';')[0].trim()==='application/json','DESK_JSON_REQUIRED',415);
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;need(bytes<=max,'DESK_REQUEST_TOO_LARGE',413);chunks.push(chunk);}
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch{fail('DESK_JSON_INVALID');}
  need(value&&typeof value==='object'&&!Array.isArray(value),'DESK_JSON_OBJECT_REQUIRED');return value;
}
function query(url,allowed) {
  need([...url.searchParams.keys()].every(key=>allowed.includes(key)&&url.searchParams.getAll(key).length===1),'DESK_QUERY_INVALID');
  return Object.fromEntries(url.searchParams);
}
export async function startProviderWorkspace({stateDirectory,profilesPath=null,port=8469,environment=process.env}={}) {
  need(Number.isInteger(port)&&port>=0&&port<=65535,'DESK_PORT_INVALID');
  const model=await openProviderDesk({stateDirectory,profilesPath,environment});
  const token=randomBytes(32).toString('hex'),tokenBytes=Buffer.from(token);
  const assets=new Map(await Promise.all([
    ['/','index.html','text/html; charset=utf-8'],['/app.js','app.js','text/javascript; charset=utf-8'],
    ['/style.css','style.css','text/css; charset=utf-8'],
  ].map(async([path,file,type])=>[path,{bytes:await readFile(new URL('./web/'+file,import.meta.url)),type}])));
  const tickets=new Map(),sockets=new Set(),pending=new Set(),downloads=new Set();
  let origin,host,closing=false,closePromise,recoveryBusy=false;
  function ticket(value) {
    for(const[id,item]of tickets)if(item.expires<Date.now())tickets.delete(id);
    need(tickets.size<128,'DESK_DOWNLOAD_LIMIT',429);
    const id=randomBytes(24).toString('hex');tickets.set(id,{...value,expires:Date.now()+60000});
    return {url:'/download?ticket='+id,expiresInSeconds:60};
  }
  async function recoveryWork(callback) {
    need(!recoveryBusy,'DESK_RECOVERY_OPERATION_ACTIVE',409);recoveryBusy=true;
    try{return await callback();}finally{recoveryBusy=false;}
  }
  async function handle(req,res) {
    const reply=(status,type,bytes,headers={})=>{
      if(res.destroyed||res.headersSent)return;
      bytes=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
      res.writeHead(status,{...security,'content-type':type,'content-length':String(bytes.length),...headers});
      res.end(req.method==='HEAD'?undefined:bytes);
    };
    const send=(status,value)=>reply(status,'application/json; charset=utf-8',JSON.stringify(value));
    try {
      need(req.headers.host===host&&(!req.headers.origin||req.headers.origin===origin)&&
        !['same-site','cross-site'].includes(req.headers['sec-fetch-site']),'DESK_ORIGIN_REQUIRED',403);
      need(req.url?.startsWith('/')&&!req.url.startsWith('//'),'DESK_TARGET_INVALID');
      const url=new URL(req.url,origin);
      if(['GET','HEAD'].includes(req.method)&&assets.has(url.pathname)&&!url.search) {
        const asset=assets.get(url.pathname);return reply(200,asset.type,asset.bytes);
      }
      need(!closing,'DESK_CLOSING',409);
      if(req.method==='GET'&&url.pathname==='/download') {
        const{ticket:id}=query(url,['ticket']),item=tickets.get(id);
        need(item&&item.expires>=Date.now(),'DESK_DOWNLOAD_EXPIRED',401);tickets.delete(id);
        let saved;downloads.add(req.socket);
        try {
          saved=item.artifact?await model.openArtifact(item.artifact):await model.openCaseDownload(item.caseId,item.kind,item.revision);
          res.writeHead(200,{...security,'content-type':saved.type??'application/octet-stream',
            'content-length':String(saved.bytes),'content-disposition':'attachment; filename="'+saved.name.replace(/[^A-Za-z0-9._-]/g,'_')+'"',
            'x-content-sha256':saved.sha256});
          await pipeline(saved.handle.createReadStream({start:0,autoClose:false}),res);
        } finally{downloads.delete(req.socket);await saved?.handle.close();}
        return;
      }
      const supplied=Buffer.from(typeof req.headers['x-provider-workspace-token']==='string'?req.headers['x-provider-workspace-token']:'');
      need(supplied.length===tokenBytes.length&&timingSafeEqual(supplied,tokenBytes),'DESK_CAPABILITY_REQUIRED',401);
      if(req.method==='GET'&&url.pathname==='/api/status'&&!url.search)return send(200,await model.status());
      if(req.method==='GET'&&url.pathname==='/api/cases') {
        const values=query(url,['query','state','page']);
        if(values.page!==undefined)need(/^(0|[1-9][0-9]{0,5})$/.test(values.page),'DESK_PAGE_INVALID');
        return send(200,await model.listCases({...values,page:Number(values.page??0)}));
      }
      if(req.method==='GET'&&url.pathname==='/api/intakes'&&!url.search)return send(200,{intakes:await model.listIntakes()});
      if(req.method==='GET'&&url.pathname==='/api/uploads'&&!url.search)return send(200,{uploads:await model.uploads()});
      const intake=url.pathname.match(/^\/api\/intakes\/([a-f0-9-]{36})$/);
      if(req.method==='GET'&&intake&&!url.search)return send(200,await model.inspectIntake(intake[1]));
      const match=url.pathname.match(/^\/api\/cases\/([a-f0-9]{32})(?:\/([a-z-]+))?$/);
      if(req.method==='GET'&&match&&!match[2]&&!url.search)return send(200,await model.getCase(match[1]));
      need(req.method==='POST'&&!url.search,'DESK_ROUTE_NOT_FOUND',404);
      need(req.headers.origin===origin,'DESK_ORIGIN_REQUIRED',403);
      if(url.pathname==='/api/intakes')return send(201,await model.retainIntake(await json(req,524288)));
      if(url.pathname==='/api/cases')return send(201,await model.prepareCase(await json(req)));
      if(url.pathname==='/api/cases/attach')return send(200,await model.attachCase(await json(req)));
      if(url.pathname==='/api/uploads') {
        need((req.headers['content-type']??'').split(';')[0].trim()==='application/octet-stream','DESK_BINARY_UPLOAD_REQUIRED',415);
        const target=await model.uploadTarget(),stage=target.path+'.partial';
        let h,published=false,bytes=0;
        try {
          h=await open(stage,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
          for await(const chunk of req){bytes+=chunk.length;need(bytes<=528482304,'DESK_RECOVERY_UPLOAD_TOO_LARGE',413);await h.writeFile(chunk);}
          need(bytes>0,'DESK_EMPTY_UPLOAD');await h.sync();await h.close();h=null;
          await rename(stage,target.path);published=true;
          return send(201,await model.registerUpload(target.path,bytes));
        } finally{await h?.close().catch(()=>{});if(!published)await rm(stage,{force:true});}
      }
      if(url.pathname==='/api/uploads/inspect') {
        const value=await json(req);return send(200,await recoveryWork(()=>model.inspectUpload(value)));
      }
      if(url.pathname==='/api/uploads/restore') {
        const value=await json(req);return send(201,await recoveryWork(()=>model.restoreUpload(value)));
      }
      if(url.pathname==='/api/uploads/retire-restore') {
        const value=await json(req);return send(200,await recoveryWork(()=>model.retireRestore(value)));
      }
      if(url.pathname==='/api/artifacts/download') {
        const value=await json(req);
        need(Object.keys(value).length===1&&typeof value.id==='string','DESK_FIELDS_INVALID');
        const h=await model.openArtifact(value.id);await h.handle.close();
        return send(200,ticket({artifact:value.id}));
      }
      need(match&&match[2],'DESK_ROUTE_NOT_FOUND',404);
      const id=match[1],action=match[2],value=await json(req);
      if(action==='context')return send(200,await model.updateContext(id,value));
      if(action==='actions')return send(202,await model.runAction(id,value));
      if(action==='stop')return send(202,await model.stopAction(id,value.id));
      if(action==='clear-lock')return send(200,await model.clearStoppedLock(id,value));
      if(action==='report') {
        need(Object.keys(value).length===1,'DESK_FIELDS_INVALID');
        const artifact=await model.exportReport(id,value.expectedRevision);
        return send(201,{artifact,download:ticket({artifact:artifact.name})});
      }
      if(action==='backup') {
        const artifact=await recoveryWork(()=>model.backup(id,value));
        return send(201,{artifact,download:ticket({artifact:artifact.name})});
      }
      if(action==='download') {
        need(Object.keys(value).every(key=>['kind','expectedRevision'].includes(key)),'DESK_FIELDS_INVALID');
        const saved=await model.openCaseDownload(id,value.kind,value.expectedRevision);await saved.handle.close();
        return send(200,ticket({caseId:id,kind:value.kind,revision:value.expectedRevision}));
      }
      fail('DESK_ROUTE_NOT_FOUND',404);
    } catch(error) {
      if(res.headersSent){res.destroy();return;}
      const code=nativeErrorCode(error);
      const status=error.status??(/CHANGED|BUSY|ACTIVE|EXISTS|ALREADY|UNAVAILABLE|LOCK/.test(code)?409:400);
      send(status,{error:code,message:errors[code]??code.replace(/_/g,' ').toLowerCase(),
        ...(error.caseId?{caseId:error.caseId}:{}),...(error.lock?{lock:error.lock}:{})});
    }
  }
  const server=createServer((req,res)=>{
    const promise=handle(req,res);pending.add(promise);promise.finally(()=>pending.delete(promise)).catch(()=>{});
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  server.requestTimeout=180000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=100;
  try{await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,HOST,accept);});}
  catch(error){await model.close();throw error;}
  host=HOST+':'+server.address().port;origin='http://'+host;
  async function close() {
    if(closePromise)return closePromise;closing=true;
    closePromise=(async()=>{
      const closed=new Promise(accept=>server.close(accept));
      const timer=setTimeout(()=>{for(const socket of sockets)socket.destroy();},15000);timer.unref();
      try {
        await model.close();
        for(const socket of sockets)if(!downloads.has(socket))socket.destroy();
        await Promise.allSettled([...pending]);tickets.clear();server.closeIdleConnections();await closed;
      } finally {clearTimeout(timer);}
    })();return closePromise;
  }
  return {url:origin+'/#'+token,origin,close,model};
}

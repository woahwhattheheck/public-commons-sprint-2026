// MIT. Loopback operator application over the original retained workspace.
import http from 'node:http';
import {randomBytes,timingSafeEqual,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,mkdir,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Workspace} from './store.mjs';
import {defaultDictionary,fault,text} from './contract.mjs';
import {hashFile,objectPath,retainStream,atomicJson} from './files.mjs';
import {buildEdition,editionFile,exportWorkspace,restoreWorkspace} from './delivery.mjs';
import {importArcgisSource} from './arcgis.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8','.csv':'text/csv; charset=utf-8','.pdf':'application/pdf','.zip':'application/zip',
  '.txt':'text/plain; charset=utf-8','.ndjson':'application/x-ndjson'};
const typeFor=name=>Object.entries(mime).find(([extension])=>name.endsWith(extension))?.[1]||'application/octet-stream';
async function bodyJson(request,limit=2*1024*1024){
  if(!String(request.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw fault(415,'Send a JSON request.');
  let size=0;const chunks=[];
  for await(const chunk of request){size+=chunk.length;if(size>limit)throw fault(413,'The request is too large.');chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}
  catch{throw fault(422,'Supply a JSON object.');}
}
function send(response,status,value){
  const bytes=Buffer.from(JSON.stringify(value)+'\n');
  response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,'Cache-Control':'no-store'});response.end(bytes);
}
export async function createWorkspaceServer({workspace,port=0,uploadLimit,python,maxRestoreBytes=8*1024*1024*1024}={}){
  const ws=await Workspace.open(workspace,{uploadLimit}),token=randomBytes(32).toString('hex'),children=new Map(),leases=new Map();
  const registryPath=join(ws.root,'restored-cases.json');let restored=[];
  try{
    const parsed=JSON.parse(await readFile(registryPath,'utf8'));
    if(Array.isArray(parsed))restored=parsed.filter(x=>typeof x.id==='string'&&/^restored-[a-f0-9-]{36}$/.test(x.id));
  }catch(e){if(e.code!=='ENOENT')throw e;}
  const lease=file=>{
    for(const [key,value] of leases)if(value.expires<Date.now())leases.delete(key);
    const key=randomBytes(24).toString('hex');leases.set(key,{...file,expires:Date.now()+10*60*1000});
    return {download_url:'/files/'+key,filename:file.filename,sha256:file.sha256,size:file.size};
  };
  let serverOrigin,closing=false;
  async function openRestored(entry){
    if(!children.has(entry.id))children.set(entry.id,await createWorkspaceServer({workspace:join(ws.root,'restored',entry.id),port:0,uploadLimit,python,maxRestoreBytes}));
    return {url:children.get(entry.id).url,title:entry.title,project_id:entry.project_id};
  }
  const server=http.createServer(async(request,response)=>{
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      const address=server.address(),allowedHosts=new Set(['127.0.0.1:'+address.port,'localhost:'+address.port]);
      if(!allowedHosts.has(request.headers.host))throw fault(403,'Open the local application address.');
      const url=new URL(request.url,serverOrigin),parts=url.pathname.split('/').filter(Boolean);
      if(request.headers.origin&&request.headers.origin!==serverOrigin&&request.headers.origin!=='http://localhost:'+address.port)
        throw fault(403,'Use the local operator application.');
      if(request.method==='GET'&&parts[0]==='files'&&parts.length===2){
        const item=leases.get(parts[1]);leases.delete(parts[1]);
        if(!item||item.expires<Date.now())throw fault(404,'This download expired. Request a fresh copy.');
        response.writeHead(200,{'Content-Type':typeFor(item.filename),'Content-Length':item.size,
          'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(item.filename),'Cache-Control':'no-store'});
        createReadStream(item.path).on('error',()=>response.destroy()).pipe(response);return;
      }
      if(request.method==='GET'&&['/','/app.mjs','/style.css'].includes(url.pathname)){
        const name=url.pathname==='/'?'index.html':url.pathname.slice(1),bytes=await readFile(join(here,'public',name));
        response.writeHead(200,{'Content-Type':typeFor(name),'Content-Length':bytes.length,'Cache-Control':'no-store'});response.end(bytes);return;
      }
      const supplied=request.headers['x-midland-token'];
      if(typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))
        throw fault(401,'Open the full local application URL printed by the launcher.');
      if(parts[0]!=='api')throw fault(404,'Route not found.');
      if(request.method==='GET'&&url.pathname==='/api/bootstrap'){
        send(response,200,{schema:'midland.delivery-ui.v1',projects:ws.list(),restored_cases:restored,default_dictionary:defaultDictionary(),upload_limit:ws.uploadLimit});return;
      }
      if(request.method==='GET'&&url.pathname==='/api/projects'){send(response,200,ws.list());return;}
      if(request.method==='POST'&&url.pathname==='/api/projects'){send(response,201,ws.create(await bodyJson(request)));return;}
      if(request.method==='POST'&&url.pathname==='/api/open-restored'){
        const input=await bodyJson(request),entry=restored.find(x=>x.id===input.id);
        if(!entry)throw fault(404,'Retained case package not found.');send(response,200,await openRestored(entry));return;
      }
      if(request.method==='POST'&&url.pathname==='/api/restore'){
        const uploadRoot=join(ws.root,'staging','restore-upload-'+randomUUID());
        const retained=await retainStream(uploadRoot,request,{limit:maxRestoreBytes});
        const name='restored-'+randomUUID();await mkdir(join(ws.root,'restored'),{recursive:true,mode:0o700});
        try{
          const result=await restoreWorkspace(retained.path,join(ws.root,'restored',name),{maxBytes:maxRestoreBytes,uploadLimit,python});
          const entry={id:name,title:result.title,project_id:result.project_id,created_at:new Date().toISOString(),package_sha256:retained.sha256};
          restored.push(entry);await atomicJson(registryPath,restored);
          send(response,201,{...result,...await openRestored(entry)});
        }finally{await rm(uploadRoot,{recursive:true,force:true});}
        return;
      }
      if(parts[1]!=='projects'||!parts[2])throw fault(404,'Project route not found.');
      const projectId=decodeURIComponent(parts[2]);ws.project(projectId);
      const action=parts[3]||'';
      if(request.method==='GET'){
        if(!action){send(response,200,ws.state(projectId));return;}
        if(action==='findings'){
          send(response,200,ws.findings(projectId,url.searchParams.get('run'),{offset:Number(url.searchParams.get('offset')||0),
            limit:Number(url.searchParams.get('limit')||50),code:url.searchParams.get('code')||'',search:url.searchParams.get('search')||'',action:url.searchParams.get('action')||''}));return;
        }
        if(action==='row'){
          send(response,200,await ws.row(projectId,url.searchParams.get('run'),url.searchParams.get('source'),Number(url.searchParams.get('line'))));return;
        }
        if(action==='compare'){
          send(response,200,ws.comparison(projectId,url.searchParams.get('previous'),url.searchParams.get('current')));return;
        }
        if(action==='finding-history'){
          const finding=ws.db.prepare('SELECT id,run_id,fingerprint FROM findings WHERE id=? AND project_id=?').get(url.searchParams.get('finding'),projectId);
          if(!finding)throw fault(404,'Finding not found.');
          const unique=ws.db.prepare('SELECT COUNT(*) AS n FROM findings WHERE run_id=? AND fingerprint=?').get(finding.run_id,finding.fingerprint).n===1;
          send(response,200,ws.db.prepare('SELECT d.*,f.run_id,f.source_id FROM decisions d JOIN findings f ON f.id=d.finding_id WHERE f.project_id=? AND f.fingerprint=? AND (f.id=? OR (?=1 AND f.run_id!=? AND (SELECT COUNT(*) FROM findings x WHERE x.run_id=f.run_id AND x.fingerprint=f.fingerprint)=1)) ORDER BY d.seq DESC').all(projectId,finding.fingerprint,finding.id,unique?1:0,finding.run_id));return;
        }
      }
      if(request.method!=='POST')throw fault(405,'Use a supported operator action.');
      if(action==='uploads'){
        send(response,201,await ws.upload(projectId,url.searchParams.get('name'),request));return;
      }
      const input=await bodyJson(request);
      if(action==='sources'){send(response,201,await ws.addSource(projectId,input));return;}
      if(action==='arcgis-source'){send(response,201,await importArcgisSource(ws,projectId,input));return;}
      if(action==='select-sources'){send(response,200,ws.selectSources(projectId,input));return;}
      if(action==='artifacts'){send(response,201,ws.addArtifact(projectId,input));return;}
      if(action==='dictionaries'){send(response,201,await ws.addDictionary(projectId,input));return;}
      if(action==='select-dictionary'){send(response,200,ws.selectDictionary(projectId,input));return;}
      if(action==='runs'){send(response,202,ws.startRun(projectId,input));return;}
      if(action==='stop-run'){
        ws.change(projectId,input.expected,input.actor,'STOP_PREFLIGHT',{run_id:input.run_id},()=>ws.stopRun(projectId,input.run_id));
        send(response,200,ws.state(projectId));return;
      }
      if(action==='decisions'){send(response,200,ws.decide(projectId,input));return;}
      if(action==='milestones'){send(response,200,ws.milestone(projectId,input));return;}
      if(action==='releases'){send(response,201,ws.createRelease(projectId,input));return;}
      if(action==='build-edition'){send(response,200,await buildEdition(ws,projectId,input.release_id,{python}));return;}
      if(action==='edition-download'){
        send(response,200,lease(await editionFile(ws,projectId,input.release_id,input.name,{python})));return;
      }
      if(action==='backup'){
        send(response,200,lease(await exportWorkspace(ws,projectId,{python})));return;
      }
      if(action==='source-download'){
        const source=ws.db.prepare('SELECT * FROM sources WHERE id=? AND project_id=?').get(input.source_id,projectId);
        if(!source||!['metadata','rows'].includes(input.kind))throw fault(404,'Source file not found.');
        const sha=source[input.kind+'_sha'],path=objectPath(ws.root,sha),actual=await hashFile(path);
        if(actual.sha256!==sha||actual.size!==source[input.kind+'_size'])throw fault(409,'The retained source changed.');
        send(response,200,lease({path,filename:source[input.kind+'_name'],...actual}));return;
      }
      if(action==='artifact-download'){
        const item=ws.db.prepare('SELECT * FROM artifacts WHERE id=? AND project_id=?').get(input.artifact_id,projectId);
        if(!item)throw fault(404,'Delivery file not found.');
        const path=objectPath(ws.root,item.sha256),actual=await hashFile(path);
        if(actual.sha256!==item.sha256||actual.size!==item.size)throw fault(409,'The retained artifact changed.');
        send(response,200,lease({path,filename:item.filename,...actual}));return;
      }
      throw fault(404,'Operator action not found.');
    }catch(e){
      if(!response.headersSent&&!response.destroyed)send(response,e.status||500,{error:String(e.message||e).slice(0,4000)});
      else response.destroy();
    }
  });
  server.requestTimeout=0;server.headersTimeout=30000;
  await new Promise((resolvePromise,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolvePromise);});
  serverOrigin='http://127.0.0.1:'+server.address().port;
  return {server,workspace:ws,token,origin:serverOrigin,url:serverOrigin+'/?access='+token,
    close:async()=>{
      if(closing)return;closing=true;
      await Promise.allSettled([...children.values()].map(child=>child.close()));
      await ws.close();server.closeAllConnections();
      await new Promise(resolvePromise=>server.close(resolvePromise));
    }};
}

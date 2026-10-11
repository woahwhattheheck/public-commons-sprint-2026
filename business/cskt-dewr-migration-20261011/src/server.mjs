import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Workspace, Problem, requireRole, digest, now, pack, unpack } from './store.mjs';
import { workspaceState, importCorpus, saveDraft, reviewItem, createRelease, itemDetail, publicUrl, plain } from './core.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
const body=async req=>{let n=0;const chunks=[];for await(const chunk of req){n+=chunk.length;if(n>40*1024*1024)throw new Problem(413,'The request exceeds 40 MiB.');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new Problem(400,'Send a complete JSON request.');}};
const cookie=req=>{const match=(req.headers.cookie||'').match(/(?:^|;\s*)cskt_session=([A-Za-z0-9_-]+)/);return match?.[1];};
const publicUser=row=>({id:row.id,name:row.name,role:row.role,enabled:Boolean(row.enabled)});

export function startServer({database=resolve('workspace/cskt.sqlite'),host='127.0.0.1',port=33219,origin,sourceRoot=resolve(root,'source'),destinationModule=resolve(root,'destination/wordpress.mjs')}={}) {
  const workspace=new Workspace(database), attempts=new Map();let expectedOrigin=origin ? new URL(origin).origin : null;
  const endpoint=async req=>{
    if(!existsSync(destinationModule))throw new Problem(503,'The WordPress destination module is not installed.','destination_module_missing');
    return import(pathToFileURL(destinationModule).href);
  };
  const activeDeployments=new Map();
  const originalDeployment=id=>{
    const row=workspace.db.prepare('SELECT * FROM deployments WHERE id=?').get(id);
    if(!row)throw new Problem(404,'This native delivery operation was not found.','deployment_not_found');
    const intent=workspace.meta('deploymentIntent:'+id);
    if(!intent)throw new Problem(409,'This older operation has no retained destination identity. Inspect its original target before creating a new operation.','deployment_intent_missing');
    const release=workspace.release(intent.releaseId);
    if(release.sha!==intent.releaseSha256||row.release_id!==intent.releaseId||row.action!==intent.action||row.target!==intent.config.baseUrl)throw new Problem(409,'The retained native delivery identity does not match its original release and journal.','deployment_identity_changed');
    return {row,intent,release};
  };
  const runDeployment=async({actor,input,method,path,release,action,config,module,parentOperationId=null})=>{
    const retained=workspace.meta('deploymentIntent:'+input.requestId);
    if(retained&&(retained.releaseId!==release.id||retained.releaseSha256!==release.sha||retained.action!==action||retained.actorId!==actor.id||(retained.parentOperationId||null)!==parentOperationId))throw new Problem(409,'This request ID identifies a different original native delivery operation.','request_conflict');
    if(!retained&&!config)throw new Problem(400,'Configure the exact WordPress destination first.');
    const destination=retained?retained.config:module.normalizeDestinationConfig(config);
    const intent=retained||{releaseId:release.id,releaseSha256:release.sha,action,config:destination,planSha256:input.planSha256||null,actorId:actor.id,parentOperationId};
    const context={method,path,releaseId:intent.releaseId,releaseSha256:intent.releaseSha256,action:intent.action,destination:intent.config,parentOperationId:intent.parentOperationId};
    const started=workspace.mutate(actor,input,()=>{
      const id=input.requestId;
      workspace.setMeta('deploymentIntent:'+id,intent);
      workspace.db.prepare('INSERT INTO deployments(id,release_id,action,target,status,actor,started_at) VALUES(?,?,?,?,?,?,?)').run(id,intent.releaseId,intent.action,intent.config.baseUrl,'RUNNING',actor.id,now());
      workspace.event(actor,'destination.'+intent.action+'.started',id,{releaseId:intent.releaseId,sha256:intent.releaseSha256,target:intent.config.baseUrl,parentOperationId});
      return {operationId:id};
    },context);
    const original=originalDeployment(started.operationId),previous=original.row;
    const envelope={operationId:previous.id,releaseId:intent.releaseId,action:intent.action,target:intent.config.baseUrl,parentOperationId:intent.parentOperationId};
    if(started.recovered&&previous.status==='RETURNED')return {...envelope,status:previous.status,result:unpack(previous.result),recovered:true,revision:workspace.revision()};
    if(activeDeployments.has(previous.id))return {...await activeDeployments.get(previous.id),recovered:true};
    if(!['RUNNING','READBACK_REQUIRED'].includes(previous.status))throw new Problem(409,'Inspect the original native delivery before continuing.','deployment_state_conflict');
    const dispatch=async()=>{
      if(previous.status==='READBACK_REQUIRED'){
        workspace.db.exec('BEGIN IMMEDIATE');
        try{workspace.db.prepare('UPDATE deployments SET status=?,finished_at=NULL WHERE id=?').run('RUNNING',previous.id);workspace.setMeta('revision',workspace.revision()+1);workspace.event(actor,'destination.'+intent.action+'.resumed',previous.id,{releaseId:intent.releaseId,target:intent.config.baseUrl});workspace.db.exec('COMMIT');}
        catch(error){try{workspace.db.exec('ROLLBACK');}catch{}throw error;}
      }
      let outcome,status;
      try{
        outcome=await(intent.action==='apply'?module.applyRelease(intent.config,{manifestBytes:original.release.bytes,sha256:intent.releaseSha256,operationId:previous.id,...(intent.planSha256?{planSha256:intent.planSha256}:{})}):module.rollbackRelease(intent.config,{releaseId:intent.releaseId,operationId:previous.id}));
        status='RETURNED';
      }catch(error){outcome={error:{message:error.message,code:error.code||'destination_response_interrupted',detail:error.detail||null},releaseId:intent.releaseId,operationId:previous.id};status='READBACK_REQUIRED';}
      workspace.db.exec('BEGIN IMMEDIATE');
      try{workspace.db.prepare('UPDATE deployments SET status=?,result=?,finished_at=? WHERE id=?').run(status,pack(outcome),now(),previous.id);workspace.setMeta('revision',workspace.revision()+1);workspace.event(actor,'destination.'+intent.action+'.returned',previous.id,{status,result:outcome,target:intent.config.baseUrl});workspace.db.exec('COMMIT');}
      catch(error){try{workspace.db.exec('ROLLBACK');}catch{}throw error;}
      return {...envelope,status,result:outcome,revision:workspace.revision(),...(started.recovered?{recovered:true}:{})};
    };
    const pending=dispatch();activeDeployments.set(previous.id,pending);
    try{return await pending;}finally{if(activeDeployments.get(previous.id)===pending)activeDeployments.delete(previous.id);}
  };
  const download=(res,bytes,name,type='application/json')=>{res.writeHead(200,{'content-type':type,'content-disposition':'attachment; filename="'+name.replace(/[^a-zA-Z0-9._-]/g,'-')+'"','content-length':bytes.length,'cache-control':'no-store'});res.end(bytes);};
  const server=createServer(async(req,res)=>{
    res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
    res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; frame-src 'self' https://*.arcgis.com https://arcg.is; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const base=expectedOrigin || 'http://127.0.0.1:'+port;
      if(req.headers.host!==new URL(base).host)throw new Problem(421,'Use the configured workspace origin.');
      const url=new URL(req.url,base),path=url.pathname,method=req.method;
      if(!['GET','HEAD','POST'].includes(method))throw new Problem(405,'Use a supported HTTP method.');
      if(method==='POST'){
        if(req.headers.origin!==base)throw new Problem(403,'Use the configured workspace origin for changes.','origin_required');
        if(!(req.headers['content-type']||'').startsWith('application/json'))throw new Problem(415,'Send application/json.');
      }
      if(path==='/api/status'&&method==='GET')return json(res,200,{product:'CSKT migration workspace',configured:workspace.db.prepare('SELECT COUNT(*) AS n FROM users WHERE enabled=1').get().n>0,origin:base});
      if(path==='/api/login'&&method==='POST'){
        const input=await body(req),key=req.socket.remoteAddress+':'+String(input.id).slice(0,80),entry=attempts.get(key);
        if(entry&&entry.count>=8&&entry.until>Date.now())throw new Problem(429,'Wait before trying this login again.','login_rate_limit');
        try{
          const session=workspace.login(input.id,input.password);attempts.delete(key);
          res.setHeader('set-cookie','cskt_session='+session.token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'+(base.startsWith('https:')?'; Secure':''));
          return json(res,200,{user:session.user,csrf:session.csrf,expiresAt:session.expiresAt});
        }catch(error){if(attempts.size>1000)for(const[k,v]of attempts)if(v.until<Date.now())attempts.delete(k);attempts.set(key,{count:entry&&entry.until>Date.now()?entry.count+1:1,until:Date.now()+15*60_000});throw error;}
      }
      if(['/', '/index.html','/app.mjs','/styles.css'].includes(path)&&method==='GET'){
        const name=path==='/'?'index.html':path.slice(1),bytes=readFileSync(join(root,'public',name));
        res.writeHead(200,{'content-type':name.endsWith('.mjs')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(bytes);
      }
      const actor=workspace.session(cookie(req));if(!actor)throw new Problem(401,'Sign in to the migration workspace.','sign_in_required');
      if(method==='POST'&&req.headers['x-workspace-csrf']!==actor.csrf)throw new Problem(403,'Refresh the signed-in workspace before making a change.','csrf_required');
      if(path==='/api/signout'&&method==='POST'){workspace.logout(actor);res.setHeader('set-cookie','cskt_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(base.startsWith('https:')?'; Secure':''));return json(res,200,{signedOut:true});}
      if(path==='/api/state'&&method==='GET')return json(res,200,workspaceState(workspace,actor));
      if(path==='/api/users'&&method==='GET'){requireRole(actor,'admin');return json(res,200,{users:workspace.db.prepare('SELECT id,name,role,enabled FROM users ORDER BY name').all().map(publicUser)});}
      if(path==='/api/items'&&method==='GET'){
        const q=(url.searchParams.get('q')||'').toLowerCase(),kind=url.searchParams.get('kind'),stage=url.searchParams.get('stage'),category=url.searchParams.get('category'),changed=url.searchParams.get('changed')==='true';
        const offset=Math.max(0,Number(url.searchParams.get('offset'))||0),limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||60));
        let items=workspace.allItems();const categories=[...new Set(items.map(x=>x.draft.category))].sort();
        items=items.filter(x=>(!kind||x.draft.kind===kind)&&(!stage||x.stage===stage)&&(!category||x.draft.category===category)&&(!changed||x.sourceChanged)&&(!q||[x.id,x.draft.title,x.source.url,x.draft.category,x.draft.summary,plain(x.draft.contentHtml)].join(' ').toLowerCase().includes(q)));
        const total=items.length;items=items.slice(offset,offset+limit).map(({draft,...item})=>({...item,draft:{...draft,contentHtml:undefined,gis:draft.gis.map(g=>({...g,fallbackHtml:undefined}))}}));
        return json(res,200,{items,total,offset,limit,hasMore:offset+limit<total,categories});
      }
      let match=path.match(/^\/api\/items\/([^/]+)$/);if(match&&method==='GET')return json(res,200,itemDetail(workspace,decodeURIComponent(match[1])));
      if(path==='/api/audit'&&method==='GET'){
        const after=Math.max(0,Number(url.searchParams.get('after'))||0),rows=workspace.audit(after,100),hasMore=rows.length>100,items=rows.slice(0,100);return json(res,200,{items,hasMore,nextAfter:items.at(-1)?.seq||after});
      }
      if(path==='/api/gis'&&method==='GET')return json(res,200,workspace.meta('gis',{items:[]}));
      match=path.match(/^\/api\/gis\/([a-f0-9]{32})$/i);if(match&&method==='GET'){
        const entry=workspace.meta('gis',{items:[]}).items.find(x=>x.id===match[1]);if(!entry)throw new Problem(404,'This original GIS item is not in the retained corpus.');
        const readSource=name=>{if(!name)return null;const exact=resolve(sourceRoot,name);if(!exact.startsWith(resolve(sourceRoot)+'/'))throw new Problem(400,'Invalid source filename.');return JSON.parse(readFileSync(exact,'utf8'));};
        return json(res,200,{entry,item:entry.item??readSource(entry.itemFile),data:entry.data??readSource(entry.dataFile)});
      }
      match=path.match(/^\/api\/releases\/([^/]+)(\/download)?$/);if(match&&method==='GET'){
        const release=workspace.release(decodeURIComponent(match[1]));if(match[2])return download(res,release.bytes,'cskt-release-'+release.id+'.json');return json(res,200,{manifest:release.manifest,sha256:release.sha});
      }
      if(path==='/api/backup'&&method==='GET'){
        requireRole(actor,'admin');const folder=resolve(dirname(workspace.filename),'backups');mkdirSync(folder,{recursive:true,mode:0o700});const file=join(folder,randomUUID()+'.sqlite');
        try{workspace.backup(file);return download(res,readFileSync(file),'cskt-workspace-'+new Date().toISOString().slice(0,10)+'.sqlite','application/vnd.sqlite3');}finally{if(existsSync(file))unlinkSync(file);}
      }
      if(path==='/api/export'&&method==='GET'){
        const exported={schema:'cskt.migration.operating-export.v1',exportedAt:now(),revision:workspace.revision(),users:workspace.db.prepare('SELECT id,name,role,enabled FROM users ORDER BY id').all().map(publicUser),captures:workspaceState(workspace,actor).captures,items:workspace.allItems().map(x=>itemDetail(workspace,x.id)),releases:workspace.listReleases().map(x=>({sha256:x.sha,manifest:workspace.release(x.id).manifest})),audit:workspace.db.prepare('SELECT * FROM audit ORDER BY seq').all().map(x=>({...x,detail:unpack(x.detail)})),deployments:workspaceState(workspace,actor).deployments};
        return download(res,Buffer.from(JSON.stringify(exported,null,2)+'\n'),'cskt-operating-export.json');
      }
      if(method==='POST'){
        const input=await body(req),mutate=fn=>workspace.mutate(actor,input,fn,{method,path});let result;
        if(path==='/api/import')result=mutate(()=>importCorpus(workspace,actor,input.corpus));
        else if((match=path.match(/^\/api\/items\/([^/]+)\/draft$/)))result=mutate(()=>saveDraft(workspace,actor,decodeURIComponent(match[1]),input.draft,input.note));
        else if((match=path.match(/^\/api\/items\/([^/]+)\/review$/)))result=mutate(()=>reviewItem(workspace,actor,decodeURIComponent(match[1]),input.decision,input.note));
        else if(path==='/api/reviews/batch')result=mutate(()=>{
          if(!Array.isArray(input.itemIds)||!input.itemIds.length||input.itemIds.length>500||new Set(input.itemIds).size!==input.itemIds.length)throw new Problem(400,'Select one to 500 distinct original items.');
          return {reviews:input.itemIds.map(id=>reviewItem(workspace,actor,id,input.decision,input.note))};
        });
        else if(path==='/api/releases')result=mutate(()=>createRelease(workspace,actor,input));
        else if(path==='/api/destination')result=mutate(()=>{
          requireRole(actor,'admin');const c=input.config;
          if(!c||typeof c.username!=='string'||!c.username.trim()||!/^env:[A-Z_][A-Z0-9_]*$|^file:\//.test(c.credentialRef||''))throw new Problem(400,'Name the target, WordPress user and server-side env: or file: credential reference.');
          let u;try{u=new URL(c.baseUrl);}catch{throw new Problem(400,'Use the exact destination URL.');}
          if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw new Problem(400,'Use an HTTPS destination or an owned loopback WordPress runtime.');
          const config={baseUrl:u.href.replace(/\/$/,''),username:c.username.trim(),credentialRef:c.credentialRef};workspace.setMeta('destination',config);workspace.event(actor,'destination.configured',config.baseUrl,{username:config.username,credentialRef:config.credentialRef});return {config};
        });
        else if(path==='/api/destination/inspect'){
          requireRole(actor,'admin');const config=workspace.meta('destination');if(!config)throw new Problem(400,'Configure the exact WordPress destination first.');const module=await endpoint(req);return json(res,200,{result:await module.inspectDestination(config)});
        }
        else if((match=path.match(/^\/api\/deployments\/([^/]+)\/(readback|rollback)$/))){
          requireRole(actor,'admin');const operationId=decodeURIComponent(match[1]),original=originalDeployment(operationId),module=await endpoint(req);
          if(match[2]==='readback')return json(res,200,{operationId,releaseId:original.intent.releaseId,action:original.intent.action,target:original.intent.config.baseUrl,result:await module.readbackRelease(original.intent.config,{releaseId:original.intent.releaseId})});
          if(input.requestId===operationId)throw new Problem(409,'Use a new request ID for rollback of this original delivery.','request_conflict');
          return json(res,200,await runDeployment({actor,input,method,path,release:original.release,action:'rollback',config:original.intent.config,module,parentOperationId:operationId}));
        }
        else if((match=path.match(/^\/api\/releases\/([^/]+)\/(preview|apply|readback|rollback)$/))){
          requireRole(actor,'admin');const release=workspace.release(decodeURIComponent(match[1])),action=match[2],config=workspace.meta('destination');
          const module=await endpoint(req);
          if(action==='preview'||action==='readback'){
            if(!config)throw new Problem(400,'Configure the exact WordPress destination first.');
            return json(res,200,{result:action==='preview'?await module.previewRelease(config,{manifestBytes:release.bytes,sha256:release.sha}):await module.readbackRelease(config,{releaseId:release.id})});
          }
          return json(res,200,await runDeployment({actor,input,method,path,release,action,config,module}));
        }
        else throw new Problem(404,'This action was not found.');
        return json(res,200,result);
      }
      throw new Problem(404,'This resource was not found.');
    }catch(error){if(!res.headersSent)json(res,error.status||500,{error:{code:error.code||'server_error',message:error.status?error.message:'The workspace could not complete this request.',detail:error.detail}});else res.end();if(!error.status)process.stderr.write(String(error.stack||error)+'\n');}
  });
  server.requestTimeout=60_000;server.headersTimeout=15_000;
  return new Promise((resolveStart,reject)=>{server.once('error',reject);server.listen(port,host,()=>{if(!expectedOrigin)expectedOrigin='http://'+(host.includes(':')?'['+host+']':host)+':'+server.address().port;resolveStart({server,workspace,origin:expectedOrigin,close:()=>new Promise(done=>server.close(()=>{workspace.close();done();}))});});});
}

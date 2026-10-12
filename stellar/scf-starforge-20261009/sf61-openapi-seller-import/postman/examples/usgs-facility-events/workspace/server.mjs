// MIT. Private loopback customer desk using the original reporter and browser asset collector.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { downloadCollectionArchive } from './buyer-collections.mjs';
import { openFacilityStore } from './store.mjs';
import { SourceCaptures } from './provider.mjs';
import { SOURCE_LIMIT, now, need, parseBytes, renderFacilityCsv, reviewCsv, comparisonCsv, handoverHtml, hash, coverageNotes, canonical } from './model.mjs';
import { readBrowserAssets } from '../../../../../distribution/browser-assets.mjs';

const STATIC=await readBrowserAssets(new URL('./browser-assets.json',import.meta.url));
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'";
function constantEqual(a,b){const x=Buffer.from(typeof a==='string'?a:''),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
async function body(req,maximum=8*1024*1024){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;need(size<=maximum,'The request exceeds '+maximum+' bytes.',413);chunks.push(chunk);}
  return Buffer.concat(chunks,size);
}
const int=(value,fallback)=>value===null||value===undefined?fallback:Number(value);
const filename=(value,extension)=>String(value).replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^[-.]+/,'').slice(0,120)+extension;
function download(res,bytes,type,name){
  res.writeHead(200,{'Content-Type':type,'Content-Disposition':'attachment; filename="'+filename(name,'')+'"','Content-Length':bytes.byteLength});
  res.end(bytes);
}
export async function startFacilityServer({workspace,port=0,sourceIdentity=null,fetch:transport=globalThis.fetch,beforeStoreClose}={}){
  need(Number.isInteger(port)&&port>=0&&port<=65535,'Choose a valid local port.');
  need(beforeStoreClose===undefined||typeof beforeStoreClose==='function','The launch cleanup must be a function.');
  const store=await openFacilityStore(workspace),captures=new SourceCaptures(store,{fetch:transport});
  const token=randomBytes(32).toString('base64url');let origin,closing=false;
  const server=createServer({maxHeaderSize:65536,requestTimeout:0},async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',CSP);
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    try {
      if(closing)return send(503,{error:'The workspace is closing.'});
      const url=new URL(req.url,origin),path=url.pathname;
      need(req.headers.host===new URL(origin).host&&(!req.headers.origin||req.headers.origin===origin),'Use the exact local workspace origin.',403);
      if(req.method==='GET'&&STATIC.has(path)){
        const asset=STATIC.get(path);res.writeHead(200,{'Content-Type':asset.type});res.end(await readFile(asset.url));return;
      }
      need(path.startsWith('/api/'),'Route not found.',404);
      need(constantEqual(req.headers['x-workspace-token']??url.searchParams.get('token'),token),'Open the complete local URL printed by the launcher.',401);
      store.assertOpen();
      if(path==='/api/info'&&req.method==='GET')return send(200,{workspaceId:store.manifest.id,projects:store.listProjects(),source:sourceIdentity});
      if(path==='/api/projects'&&req.method==='POST'){
        const input=parseBytes(await body(req),'Project request');return send(200,store.createProject(input,input.operationId));
      }
      if(path==='/api/import'&&req.method==='POST'){
        need(captures.size===0,'Pause active source captures before receiving a full workspace.',409);
        return send(200,await store.importProject(req,req.headers['x-operation-id']));
      }
      if(path==='/api/example'&&req.method==='GET'){
        const [facilities,raw]=await Promise.all([readFile(new URL('../facilities.example.json',import.meta.url),'utf8'),readFile(new URL('../historical-response.json',import.meta.url))]);
        return send(200,{facilities:JSON.parse(facilities),source:{name:'historical-response.json',bytes:raw.length,sha256:hash(raw),receivedAt:now(),
          url:parseBytes(raw).metadata.url},sourceText:raw.toString('utf8'),label:'Original 2014 South Napa example'});
      }
      const match=/^\/api\/projects\/([^/]+)(?:\/(.*))?$/.exec(path);
      need(match,'Route not found.',404);
      const projectId=decodeURIComponent(match[1]),route=match[2]??'';
      store.project(projectId);
      if(req.method==='GET'){
        if(route===''){const value=store.state(projectId),sites=value.rosters.find(item=>item.id===value.project.currentRosterId)?.facilityInput.facilities??[];return send(200,{...value,coverage:Object.fromEntries(value.sources.map(source=>[source.id,coverageNotes(source,sites)]))});}
        if(route==='work')return send(200,store.work(projectId,{editionId:url.searchParams.get('edition')||null,status:url.searchParams.get('status')||'',
          assignee:url.searchParams.get('assignee')||'',query:url.searchParams.get('q')||'',offset:int(url.searchParams.get('offset'),0),limit:int(url.searchParams.get('limit'),50),openOnly:url.searchParams.get('open')==='1'}));
        if(route==='history')return send(200,{reviews:store.reviewHistory(projectId,url.searchParams.get('pair'))});
        if(route==='comparison'){
          const value=store.compare(projectId,url.searchParams.get('before'),url.searchParams.get('after'));
          const offset=int(url.searchParams.get('offset'),0),limit=int(url.searchParams.get('limit'),50);
          need(Number.isInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=1&&limit<=200,'Choose a valid comparison page.');
          return send(200,{...value,total:value.rows.length,offset,limit,rows:value.rows.slice(offset,offset+limit)});
        }
        if(route==='export'){
          res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Content-Disposition':'attachment; filename="'+filename(store.project(projectId).title,'.facility-workspace.ndjson')+'"'});
          for await(const chunk of store.exportProject(projectId)){if(res.destroyed)break;if(!res.write(chunk))await new Promise((resolve,reject)=>{const cleanup=()=>{res.off('drain',drained);res.off('close',closed);res.off('error',failed);};const drained=()=>{cleanup();resolve();},closed=()=>{cleanup();reject(new Error('The receiving connection closed.'));},failed=error=>{cleanup();reject(error);};res.once('drain',drained);res.once('close',closed);res.once('error',failed);});}
          res.end();return;
        }
        if(route==='work.csv'){
          return download(res,Buffer.from(reviewCsv(store.allEditionWork(projectId,url.searchParams.get('edition')||null))),'text/csv; charset=utf-8','facility-operating-work.csv');
        }
        if(route==='comparison.csv'){
          return download(res,Buffer.from(comparisonCsv(store.compare(projectId,url.searchParams.get('before'),url.searchParams.get('after')))),'text/csv; charset=utf-8','facility-edition-comparison.csv');
        }
        const collection=/^collections\/([^/]+)(?:\/(manifest|archive))?$/.exec(route);
        if(collection){
          const value=store.entry(projectId,'collection',collection[1]);
          if(collection[2]==='manifest')return download(res,store.blob(value.manifestSha256),'application/json; charset=utf-8','original-collection-manifest.json');
          if(collection[2]==='archive'){
            const cancellation=new AbortController(),closed=()=>{if(!res.writableFinished)cancellation.abort(new Error('The collection download closed.'));};
            res.once('close',closed);let saved;
            try{
              saved=await downloadCollectionArchive(store.directory,value,{signal:cancellation.signal});
              res.writeHead(200,{'Content-Type':'application/x-tar','Content-Disposition':'attachment; filename="'+filename(value.name,'')+'"',
                'Content-Length':saved.bytes,'X-Content-SHA256':saved.sha256});
              await pipeline(saved.file.createReadStream({start:0,autoClose:false}),res,{signal:cancellation.signal});return;
            }finally{res.off('close',closed);if(saved)await saved.dispose();}
          }
          return send(200,store.collectionMembers(projectId,value.id,{query:url.searchParams.get('query')??'',
            offset:int(url.searchParams.get('offset'),0),limit:int(url.searchParams.get('limit'),50)}));
        }
        const acquisition=/^sources\/([^/]+)\/acquisition$/.exec(route);
        if(acquisition){
          const value=store.entry(projectId,'source',acquisition[1]);
          need(value.acquisition,'This source was received as an ordinary response file.',404);
          return download(res,Buffer.from(JSON.stringify(store.sourceAcquisitions(projectId,[value])[0],null,2)+'\n'),
            'application/json; charset=utf-8','original-buyer-member.json');
        }
        const rosterMatch=/^rosters\/([^/]+)\/raw$/.exec(route);
        if(rosterMatch){const item=store.entry(projectId,'roster',rosterMatch[1]);return download(res,Buffer.from(canonical(item.facilityInput)),'application/json; charset=utf-8',item.label+'.json');}
        const source=/^sources\/([^/]+)\/raw$/.exec(route);
        if(source){const item=store.entry(projectId,'source',source[1]);return download(res,store.blob(item.bodySha256),'application/geo+json; charset=utf-8',item.name);}
        const observation=/^observations\/([^/]+)\/(\d+)$/.exec(route);
        if(observation){const job=store.capture(projectId,observation[1]),item=job.observations.find(value=>value.id===Number(observation[2]));need(item,'The captured response was not found.',404);
          return download(res,store.blob(item.bodySha256),item.kind==='count'?'text/plain; charset=utf-8':'application/octet-stream','usgs-observation-'+item.id+'.'+(item.kind==='count'?'txt':'body'));}
        const report=/^editions\/([^/]+)(?:\/(report.json|report.csv|handover.html))?$/.exec(route);
        if(report){
          const value=store.entry(projectId,'edition',report[1]);
          if(!report[2])return send(200,value);
          if(report[2]==='report.json')return download(res,Buffer.from(JSON.stringify(value.report,null,2)+'\n'),'application/json; charset=utf-8',filename(value.label,'.json'));
          if(report[2]==='report.csv')return download(res,Buffer.from(renderFacilityCsv(value.report)),'text/csv; charset=utf-8',filename(value.label,'.csv'));
          const sites=store.entry(projectId,'roster',value.rosterId),sources=value.sourceIds.map(id=>store.entry(projectId,'source',id));
          const html=handoverHtml(store.project(projectId),value,store.allEditionWork(projectId,value.id),sites,sources,{retainedWork:store.allEditionWork(projectId,null),reviewHistory:store.entries(projectId,'review'),acquisitions:store.sourceAcquisitions(projectId,sources)});
          // The original report is self-contained and supplies its own print styles.
          res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;
        }
        throw Object.assign(new Error('Route not found.'),{status:404});
      }
      if(req.method==='POST'&&route==='collections/upload'){
        need(captures.size===0,'Pause active source captures before receiving a buyer collection.',409);
        const metadata={name:url.searchParams.get('name'),operator:url.searchParams.get('operator'),
          expectedSha256:url.searchParams.get('sha256'),bytes:Number(url.searchParams.get('bytes'))};
        return send(200,await store.importBuyerCollectionUpload(projectId,req,metadata,
          Number(req.headers['x-project-revision']),req.headers['x-operation-id']));
      }
      if(req.method==='POST'&&route==='sources'){
        const meta={name:url.searchParams.get('name')??'events.geojson',status:int(url.searchParams.get('status'),200),
          ...(url.searchParams.has('receivedAt')?{receivedAt:url.searchParams.get('receivedAt')} : {}),
          ...(url.searchParams.has('url')?{url:url.searchParams.get('url')}:{}),
          note:url.searchParams.get('note')??''};
        return send(200,store.importSource(projectId,await body(req,SOURCE_LIMIT),meta,Number(req.headers['x-project-revision']),req.headers['x-operation-id']));
      }
      const input=parseBytes(await body(req),'Workspace request'),revision=input.revision,operationId=input.operationId;
      if(req.method==='PATCH'&&route==='')return send(200,store.updateProject(projectId,input,revision,operationId));
      if(req.method==='POST'){
        if(route==='collections'){
          need(captures.size===0,'Pause active source captures before receiving a buyer collection.',409);
          return send(200,await store.importBuyerCollection(projectId,input,revision,operationId));
        }
        const collectionSources=/^collections\/([^/]+)\/sources$/.exec(route);
        if(collectionSources){
          need(captures.size===0,'Pause active source captures before receiving buyer responses.',409);
          return send(200,await store.importCollectionSources(projectId,collectionSources[1],input,revision,operationId));
        }
        if(route==='rosters')return send(200,store.saveRoster(projectId,input,revision,operationId));
        if(route==='queries')return send(200,store.saveQuery(projectId,input,revision,operationId));
        if(route==='editions')return send(200,store.createEdition(projectId,input,revision,operationId));
        if(route==='selection')return send(200,store.selectEdition(projectId,input.id,revision,operationId));
        if(route==='reviews')return send(200,store.saveReview(projectId,input,revision,operationId));
        if(route==='captures'){
          const result=store.createCapture(projectId,input,revision,operationId);
          captures.start(projectId,result.id).catch(error=>{const job=store.capture(projectId,result.id);job.state='interrupted';job.error=error.message;store.saveCapture(projectId,job);});
          return send(202,{...result,state:store.capture(projectId,result.id).state});
        }
        const capture=/^captures\/([^/]+)$/.exec(route);
        if(capture){
          need(['resume','pause'].includes(input.action),'Choose resume or pause.');
          const job=store.capture(projectId,capture[1]);
          if(input.action==='pause')await captures.pause(projectId,job.id);
          else captures.start(projectId,job.id).catch(error=>{const current=store.capture(projectId,job.id);current.state='interrupted';current.error=error.message;store.saveCapture(projectId,current);});
          return send(202,{id:job.id,state:store.capture(projectId,job.id).state});
        }
      }
      throw Object.assign(new Error('Route not found.'),{status:404});
    }catch(error){
      if(res.headersSent){res.destroy(error);return;}
      send(Number.isInteger(error.status)?error.status:400,{error:error.message,code:error.code??null});
    }
  });
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port},()=>{server.off('error',reject);resolve();});});
    origin=new URL('http://127.0.0.1:'+server.address().port).origin;
  }catch(error){
    try{await captures.close();}catch{}
    try{store.close();}catch{}
    throw error;
  }
  let closePromise;
  async function close(){
    if(closePromise)return closePromise;
    closing=true;
    closePromise=(async()=>{
      let failure;
      try{await captures.close();}catch(error){failure=error;}
      try{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}catch(error){failure??=error;}
      // The original writer still owns its lease while the managed launch is retired.
      try{await beforeStoreClose?.();}catch(error){failure??=error;}
      try{store.close();}catch(error){failure??=error;}
      if(failure)throw failure;
    })();
    return closePromise;
  }
  return {url:origin+'/#'+token,origin,store,captures,close,server};
}

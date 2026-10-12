// MIT — Customer pages within the original private resource-library service.
import { readFile, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { serveLibrary } from '../resource-library/server.mjs';
import { collectionExtension } from '../resource-library/collection-ui.mjs';
import { prepareCollectionDownload } from '../resource-library/collection-package.mjs';
import { writeBytes } from '../node/store.mjs';
import { requireValue, hash } from './source.mjs';
export async function serveReviewJobs(app,{port=0}={}){
  const extension=await collectionExtension(app.library);
  const assets=await Promise.all([['/review-jobs','index.html','text/html'],
    ['/review-jobs/app.js','app.js','text/javascript'],['/review-jobs/style.css','style.css','text/css']]
    .map(async([route,file,type])=>({route,type,bytes:await readFile(new URL(file,import.meta.url))})));
  const methods=new Set(['create','assign','prepare','review','approve','action','stop','annotate','deliver']);
  async function handle({request,url,send,body,signal,registerDownload}){
    if(!url.pathname.startsWith('/api/review-jobs/'))return false;
    const route=url.pathname.slice('/api/review-jobs/'.length),method=request.method;
    function one(name,fallback=''){
      requireValue(url.searchParams.getAll(name).length<=1,'DUPLICATE_QUERY');
      return url.searchParams.get(name)??fallback;
    }
    if(method==='GET'&&route==='context')send(await app.context({
      offset:Number(one('offset','0')),limit:Number(one('limit','50')),q:one('q')}));
    else if(method==='GET'&&route==='job')send(await app.inspect(one('id')));
    else if(method==='GET'&&route==='source')send(await app.source(one('sha256')));
    else if(method==='GET'&&route==='catalog')send(await app.catalog(one('sha256')));
    else if(method==='POST'&&methods.has(route))send(await app[route](await body(4*1024*1024)),route==='action'?202:200);
    else if(method==='POST'&&route==='source/fetch')send(await app.fetchSource(await body(),{signal}));
    else if(method==='POST'&&route==='source/import'){
      const input=await body(4*1024*1024);
      requireValue(typeof input.contentBase64==='string'&&input.contentBase64.length<=2800000,'BROWSER_SOURCE_LIMIT');
      send(await app.importSource(Buffer.from(input.contentBase64,'base64'),input.metadata),201);
    }else if(method==='POST'&&route==='catalog/import'){
      const input=await body(2*1024*1024);
      requireValue(typeof input.contentBase64==='string'&&input.contentBase64.length<=1398104,'CATALOG_SIZE_INVALID');
      send(await app.importCatalog(Buffer.from(input.contentBase64,'base64')),201);
    }else if(method==='POST'&&route==='scan'){await body();send(await app.library.scan({signal}));}
    else if(method==='POST'&&route==='delivery/download'){
      const input=await body(),view=await app.inspect(input.externalId),delivery=view.job.delivery;
      requireValue(delivery,'JOB_DELIVERY_NOT_SELECTED',409);
      send(await registerDownload(signal=>prepareCollectionDownload(app.library,
        {id:delivery.collectionId,revision:delivery.collectionRevision,signal})));
    }else if(method==='POST'&&route==='handoff/download'){
      const input=await body();
      send(await registerDownload(async()=>{
        const value=await app.handoff(input.externalId),bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
        const path=join(app.store.state,'exports','handoff-'+randomUUID()+'.json');
        await writeBytes(path,bytes,{exclusive:true});
        let file;try{file=await open(path,'r');}catch(e){await unlink(path).catch(()=>{});throw e;}
        let disposed=false;
        return {file,bytes:bytes.length,sha256:hash(bytes),resource:{id:'review-job-handoff',name:'review-job-handoff.json'},
          async dispose(){if(disposed)return;disposed=true;try{await file.close();}finally{await unlink(path).catch(()=>{});}}};
      }));
    }else requireValue(false,'REVIEW_JOB_ROUTE_NOT_FOUND',404);
    return true;
  }
  const listener=await serveLibrary(app.library,{port,additionalAssets:[...extension.additionalAssets,...assets],
    authenticatedRoute:[handle,extension.authenticatedRoute]});
  let closing;
  return {app,listener,url:listener.origin+'/review-jobs#'+listener.token,
    close:()=>closing??=(async()=>{await listener.close();await app.close();})()};
}

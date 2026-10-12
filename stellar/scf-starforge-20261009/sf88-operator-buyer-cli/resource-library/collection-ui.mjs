// MIT — Collection pages inside the original private resource-library server.
import { readFile } from 'node:fs/promises';
import { requireValue, verifyFile } from './files.mjs';
import { prepareCollectionDownload } from './collection-package.mjs';
export async function collectionExtension(library) {
  const additionalAssets=await Promise.all([
    ['/collections','collections.html','text/html'],
    ['/collections.js','collections.js','text/javascript'],
    ['/collections.css','collections.css','text/css']
  ].map(async([route,file,type])=>({route,type,bytes:await readFile(new URL(file,import.meta.url))})));
  async function authenticatedRoute({request,url,send,body,signal,registerDownload}) {
    const route=url.pathname,method=request.method;
    if(route!=='/api/collections' && !route.startsWith('/api/collections/'))return false;
    const page={offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??50)};
    const revision=url.searchParams.has('revision')?Number(url.searchParams.get('revision')):undefined;
    if(route==='/api/collections' && method==='GET')send(library.collections.list(page));
    else if(route==='/api/collections' && method==='PUT')send(library.collections.save(await body(4*1024*1024)));
    else {
      const match=/^\/api\/collections\/([A-Za-z0-9][A-Za-z0-9._-]{0,95})(?:\/(history|download|preview))?$/.exec(route);
      requireValue(match,'COLLECTION_ROUTE_NOT_FOUND',404);
      const [,id,action]=match;
      if(method==='GET' && !action)send(library.collections.show(id,revision));
      else if(method==='GET' && action==='history')send(library.collections.history(id,page));
      else if(method==='GET' && action==='preview') {
        const collection=library.collections.show(id,revision);
        const record=collection.members.find(r=>r.id===url.searchParams.get('resource'));
        requireValue(record,'COLLECTION_MEMBER_NOT_FOUND',404);
        send({resource:record,...await verifyFile(record,{...library.config,signal})});
      } else if(method==='POST' && action==='download') {
        const selected=await body();
        requireValue(Number.isSafeInteger(selected.revision) && selected.revision>0,'COLLECTION_REVISION_REQUIRED');
        send(await registerDownload(signal=>prepareCollectionDownload(library,{id,revision:selected.revision,signal})));
      } else requireValue(false,'METHOD_NOT_ALLOWED',405);
    }
    return true;
  }
  return {additionalAssets,authenticatedRoute};
}

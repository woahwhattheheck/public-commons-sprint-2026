// MIT. Document composition joins the original authenticated customer host and downloads.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readBrowserAssets} from '../../stellar/scf-starforge-20261009/distribution/browser-assets.mjs';
import {documentProvider,defaultDocumentSettings,documentError} from './contracts.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const number=(url,name,fallback)=>url.searchParams.has(name)?Number(url.searchParams.get(name)):fallback;
function file(body,name){
  return {name,base64:body.toString('base64'),bytes:body.length,sha256:digest(body)};
}
export async function documentCompositionExample(kind='orders',provider='mintpdf',{merchantOrigin=null}={}){
  const recipes={orders:'order-documents.json',grouped:'grouped-order-documents.json',reports:'report-documents.json'};
  if(!Object.hasOwn(recipes,kind))throw documentError('DOCUMENT_COMPOSITION_EXAMPLE_REQUIRED','Select orders, grouped order lines or reports.');
  const selected=documentProvider(provider);
  const root=new URL('./examples/composition/',import.meta.url);
  const request=JSON.parse((await readFile(new URL(recipes[kind],root))).toString('utf8'));
  if(request.templates.some(item=>!selected.formats.includes(item.format)))
    throw documentError('DOCUMENT_COMPOSITION_FORMAT_UNSUPPORTED','Choose an HTML example for this provider.');
  request.provider=selected.id;request.merchantOrigin=merchantOrigin;
  for(const template of request.templates)template.settings=defaultDocumentSettings(selected.id);
  const dataset=file(await readFile(new URL(request.dataset.source,root)),request.dataset.source);
  const templates=Object.fromEntries(await Promise.all(request.templates.map(async item=>
    [item.id,file(await readFile(new URL(item.source,root)),item.source)])));
  return {example:true,request,dataset,templates};
}
export async function documentCompositionExtension(controller){
  if(!controller||typeof controller.start!=='function'||typeof controller.download!=='function'||
    typeof controller.close!=='function'||typeof controller.bundles?.start!=='function')throw documentError('DOCUMENT_COMPOSITION_CONTROLLER_REQUIRED');
  const declared=await readBrowserAssets(new URL('./composition-browser-assets.json',import.meta.url));
  const additionalAssets=await Promise.all([...declared].map(async([route,{url,type}])=>
    ({route,type,bytes:await readFile(url)})));
  async function authenticatedRoute({request,url,send,body,signal,registerDownload}){
    if(!url.pathname.startsWith('/api/document-composition/'))return false;
    const path=url.pathname.slice('/api/document-composition/'.length),method=request.method;
    if(path.startsWith('bundles/')){
      const action=path.slice('bundles/'.length),bundles=controller.bundles;
      if(method==='GET'){
        if(action==='state'){send({...bundles.status(),assemblies:await bundles.list({
          offset:number(url,'offset',0),limit:number(url,'limit',20)})});return true;}
        if(action==='assembly'){send(await bundles.get({id:url.searchParams.get('id'),
          ...(url.searchParams.has('sourceSha256')?{sourceSha256:url.searchParams.get('sourceSha256')}:{ }),signal}));return true;}
        if(action==='operation'){send(bundles.operation({operationId:url.searchParams.get('operationId')}));return true;}
      }
      if(method==='POST'){
        if(['stage','restore','materialize','prepare','run','receive','export'].includes(action)){
          send(bundles.start(action,await body(action==='stage'||action==='restore'?40*1048576:2*1048576)),202);return true;}
        if(action==='cancel'){send(await bundles.cancel(await body()),202);return true;}
        if(action==='download'){
          const input=await body();send(await registerDownload(downloadSignal=>bundles.download(input,{signal:downloadSignal})));return true;}
      }
      throw Object.assign(documentError('DOCUMENT_ASSEMBLY_ROUTE_NOT_FOUND'),{status:404});
    }
    if(method==='GET'){
      if(path==='state'){
        send({...controller.status(),compositions:await controller.list({
          offset:number(url,'offset',0),limit:number(url,'limit',20)})});return true;
      }
      if(path==='composition'){
        send(await controller.get({id:url.searchParams.get('id'),offset:number(url,'offset',0),
          limit:number(url,'limit',100),...(url.searchParams.has('sourceSha256')?
            {sourceSha256:url.searchParams.get('sourceSha256')}:{ }),signal}));return true;
      }
      if(path==='assembly'){
        send(await controller.assembly({id:url.searchParams.get('id'),sourceSha256:url.searchParams.get('sourceSha256'),
          assemblyId:url.searchParams.get('assemblyId'),assemblySha256:url.searchParams.get('assemblySha256'),signal}));return true;
      }
      if(path==='operation'){
        send(controller.operation({operationId:url.searchParams.get('operationId')}));return true;
      }
      if(path==='example'){
        const defaults=controller.status().defaults;
        send(await documentCompositionExample(url.searchParams.get('kind')??'orders',
          url.searchParams.get('provider')??defaults.provider,{merchantOrigin:defaults.merchantOrigin}));
        return true;
      }
    }
    if(method==='POST'){
      if(['stage','restore','prepare','run','receive','export','assembly-stage','assembly-prepare',
        'assembly-run','assembly-receive','assembly-export'].includes(path)){
        // Whole dataset and all template bytes fit the existing host's selected 48 MiB ceiling.
        const input=await body(path==='stage'||path==='restore'?40*1048576:2*1048576);
        send(controller.start(path,input),202);return true;
      }
      if(path==='cancel'){send(await controller.cancel(await body()),202);return true;}
      if(path==='download'){
        const input=await body();
        send(await registerDownload(downloadSignal=>controller.download(input,{signal:downloadSignal})));
        return true;
      }
    }
    throw Object.assign(documentError('DOCUMENT_COMPOSITION_ROUTE_NOT_FOUND'),{status:404});
  }
  return {additionalAssets,authenticatedRoute,close:()=>controller.close()};
}

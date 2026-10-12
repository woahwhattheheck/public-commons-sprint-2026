// MIT. Complete customer resolution inside the original authenticated resource-library host.
import {readFile} from 'node:fs/promises';
import {readBrowserAssets} from '../../../distribution/browser-assets.mjs';
import {need,RESOLUTION_RECEIVING_BYTES} from '../../../sf30-seller-sdk/jobs/resolution/contract.mjs';

export async function jobResolutionExtension(controller){
  need(controller&&typeof controller.inspect==='function','JOB_RESOLUTION_CUSTOMER_CONTROLLER_REQUIRED');
  const assets=await readBrowserAssets(new URL('./browser-assets.json',import.meta.url));
  const additionalAssets=await Promise.all([...assets].map(async([route,{url,type}])=>
    ({route,type,bytes:await readFile(url)})));
  return {additionalAssets,async authenticatedRoute({request,response,url,send,body,signal}){
    const path=url.pathname,method=request.method;
    if(path==='/api/job-workspace/resolutions'&&method==='GET'){
      send(await controller.list({q:url.searchParams.get('q')??'',view:'all',offset:Number(url.searchParams.get('offset')??0),
        limit:Number(url.searchParams.get('limit')??50)}));return true;
    }
    const match=/^\/api\/job-workspace\/jobs\/([a-f0-9]{64})\/resolution(?:\/([a-z]+))?$/.exec(path);
    if(!match)return false;
    const [,entryId,action]=match;
    if(!action&&method==='GET'){send(await controller.inspect(entryId,{signal}));return true;}
    if(action==='export'&&method==='GET'){
      const file=await controller.export(entryId,{signal});
      response.writeHead(200,{'Content-Type':file.type,'Content-Length':file.bytes.length,
        'Content-Disposition':'attachment; filename="'+file.name+'"','X-Content-SHA256':file.sha256});
      response.end(file.bytes);return true;
    }
    need(method==='POST','METHOD_NOT_ALLOWED',405);
    const input=await body(action==='receive'?RESOLUTION_RECEIVING_BYTES:24000);
    if(action==='refresh')send(await controller.refresh(entryId,{signal}));
    else if(action==='issues')send(await controller.issue(entryId,input,{signal}));
    else if(action==='messages')send(await controller.message(entryId,input,{signal}));
    else if(action==='recover')send(await controller.recover(entryId,input,{signal}));
    else if(action==='resume')send(await controller.resume(entryId,input,{signal}));
    else if(action==='stop')send(await controller.stop(entryId));
    else if(action==='receive')send(await controller.receive(entryId,input,{signal}));
    else need(false,'JOB_RESOLUTION_ROUTE_NOT_FOUND',404);
    return true;
  }};
}

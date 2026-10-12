// MIT. Timescale operator joins the original PostgreSQL publisher listener.
import { readFile } from 'node:fs/promises';
import { startPostgresPublisherServer } from '../publisher/server.mjs';
import { identity, fault } from '../publisher/files.mjs';
import { exportTimescaleWorkspace } from './package.mjs';
import { remediationHttp } from './remediation-http.mjs';
async function jsonBody(req){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))throw fault('JSON_REQUIRED','Send application/json.',415);
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>8388608)throw fault('REQUEST_TOO_LARGE','The operation exceeds 8 MiB.',413);chunks.push(chunk);}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw fault('JSON_INVALID');}
}
async function startTimescaleWorkspaceServer({workspace,port=8446,ownsWorkspace=true,schedule=null}={}){
  if(!workspace||typeof workspace.startCapture!=='function')throw new TypeError('Open the original Timescale workspace first.');
  const assets=await Promise.all([['/timescale/app.mjs','app.mjs','text/javascript; charset=utf-8'],
    ['/timescale/style.css','style.css','text/css; charset=utf-8'],
    ['/timescale/remediation.mjs','remediation.mjs','text/javascript; charset=utf-8'],
    ['/timescale/remediation.css','remediation.css','text/css; charset=utf-8']].map(async([path,file,type])=>
      ({path,type,bytes:await readFile(new URL('./public/'+file,import.meta.url))})));
  const mutations={
    '/api/timescale/capture':value=>workspace.startCapture(value),
    '/api/timescale/review':value=>workspace.saveReview(value),
    '/api/timescale/refresh/prepare':value=>workspace.prepareRefresh(value),
    '/api/timescale/refresh/run':value=>workspace.startRefresh(value),
    '/api/timescale/verify':value=>workspace.startVerification(value),
    '/api/timescale/job/prepare':value=>workspace.prepareJob(value),
    '/api/timescale/job/apply':value=>workspace.applyJob(value),
    '/api/timescale/select':value=>workspace.selectAggregate(value),
    '/api/timescale/extract':value=>workspace.startPublicationExtraction(value),
    '/api/timescale/export':value=>exportTimescaleWorkspace(workspace,value)
  };
  const handleRemediation=remediationHttp({workspace,jsonBody});
  let closing;
  const listener=await startPostgresPublisherServer({publisher:workspace.publisher,port,ownsPublisher:ownsWorkspace,schedule,extension:{
    assets,head:'<link rel="stylesheet" href="/timescale/style.css"><link rel="stylesheet" href="/timescale/remediation.css"><script type="module" src="/timescale/app.mjs"></script><script type="module" src="/timescale/remediation.mjs"></script>',
    async handle({req,res,url,send}){
      if(!url.pathname.startsWith('/api/timescale/'))return false;
      const path=url.pathname,query=url.searchParams;
      if(await handleRemediation({req,res,url,send}))return true;
      if(req.method==='GET'){
        if(path==='/api/timescale/status')send(200,workspace.status({limit:query.has('limit')?Number(query.get('limit')):25,offset:query.has('offset')?Number(query.get('offset')):0}));
        else if(path==='/api/timescale/edition')send(200,await workspace.edition(query.get('id')));
        else if(path==='/api/timescale/compare'){
          const result=await workspace.comparison(query.get('before'),query.get('after'));send(200,{...result,digest:identity(result)});
        }else if(path==='/api/timescale/operation')send(200,workspace.operation(query.get('id')));
        else if(path==='/api/timescale/plan')send(200,workspace.getPlan(query.get('id')));
        else if(path==='/api/timescale/record'){
          const operation=workspace.operation(query.get('operation'));
          const reference=operation.data.result?.native??operation.data.dispatch?.before;
          if(!reference)throw fault('TIMESCALE_NATIVE_RECORD_NOT_FOUND','This operation has no retained native result.',404);
          const record=await workspace.readRecord(reference);
          res.setHeader('content-disposition','attachment; filename="'+reference.sha256+'.json"');
          send(200,record.bytes);
        }else throw fault('NOT_FOUND','Timescale operation not found.',404);
        return true;
      }
      if(req.method!=='POST')throw fault('METHOD_NOT_ALLOWED');
      const input=await jsonBody(req);
      if(path==='/api/timescale/cancel'){send(200,workspace.cancel(input.id));return true;}
      if(!Object.hasOwn(mutations,path))throw fault('NOT_FOUND','Timescale operation not found.',404);
      const selected=mutations[path](input);
      // The original UUID and request binding are committed before acknowledgement.
      // Disconnecting this browser never invents a second native operation.
      send(202,{id:selected.id,reused:selected.reused});
      return true;
    }
  }});
  return {url:listener.url,server:listener.server,workspace,schedule:listener.schedule,
    close(){closing??=(async()=>{try{await listener.close();}finally{if(ownsWorkspace)await workspace.close();}})();return closing;}};
}

export { startTimescaleWorkspaceServer };

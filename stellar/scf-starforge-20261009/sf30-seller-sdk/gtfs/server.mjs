// MIT. GTFS source controls are an extension of the original dataset publisher.
import { readFile } from 'node:fs/promises';
import { readBrowserAssets } from '../../distribution/browser-assets.mjs';
import { startPostgresPublisherServer } from '../postgres/publisher/server.mjs';
import { fault } from '../postgres/publisher/files.mjs';
import { openGtfsWorkspace } from './workspace.mjs';
import { GTFS_ZIP_MAX_BYTES } from './source.mjs';

async function inputBody(req,maximum,json=true) {
  const type=req.headers['content-type']??'';
  if(json&&!/^application\/json(?:\s*;|$)/i.test(type))throw fault('JSON_REQUIRED','Send application/json.',415);
  if(!json&&!/^(application\/zip|application\/octet-stream)(?:\s*;|$)/i.test(type))
    throw fault('GTFS_ZIP_REQUIRED','Upload the original ZIP file.',415);
  const declared=Number(req.headers['content-length']);
  if(Number.isFinite(declared)&&declared>maximum)throw fault('GTFS_REQUEST_TOO_LARGE','The original input exceeds its size limit.',413);
  const chunks=[];let size=0;
  for await(const part of req){size+=part.length;if(size>maximum)throw fault('GTFS_REQUEST_TOO_LARGE','The original input exceeds its size limit.',413);chunks.push(part);}
  const content=Buffer.concat(chunks,size);
  if(!json)return content;
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content));}
  catch{throw fault('JSON_INVALID','Send complete UTF-8 JSON.');}
}
function parameters(url,allowed) {
  for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)
    throw fault('GTFS_QUERY_INVALID','Use one value for each declared query field.');
  return Object.fromEntries(url.searchParams);
}
function drainResponse(res) {
  if(res.destroyed)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const clear=()=>{res.off('drain',done);res.off('close',done);res.off('error',fail);};
    const done=()=>{clear();resolve();};const fail=issue=>{clear();reject(issue);};
    res.once('drain',done);res.once('close',done);res.once('error',fail);
    if(res.destroyed)done();
  });
}
function numbers(input,keys){for(const key of keys)if(input[key]!==undefined)input[key]=Number(input[key]);return input;}
export async function createGtfsExtension({workspace}) {
  const registered=await readBrowserAssets(new URL('./browser-assets.json',import.meta.url));
  const assets=[];
  for(const [path,value] of registered)if(path==='/gtfs.mjs'||path==='/gtfs.css')
    assets.push({path,type:value.type,bytes:await readFile(value.url)});
  return {
    assets,head:'<link rel="stylesheet" href="/gtfs.css"><script type="module" src="/gtfs.mjs"></script>',
    async handle({req,res,url,send}) {
      if(!url.pathname.startsWith('/api/gtfs/'))return false;
      const route=url.pathname;
      if(req.method==='GET') {
        let input;
        if(route==='/api/gtfs/identity') {parameters(url,[]);send(200,workspace.identity());return true;}
        if(route==='/api/gtfs/status') {
          input=numbers(parameters(url,['limit','feedsOffset','editionsOffset','comparisonsOffset','decisionsOffset','releasesOffset','exportsOffset']),
            ['limit','feedsOffset','editionsOffset','comparisonsOffset','decisionsOffset','releasesOffset','exportsOffset']);
          send(200,await workspace.status(input));return true;
        }
        if(route==='/api/gtfs/feed'||route==='/api/gtfs/edition'||route==='/api/gtfs/comparison') {
          input=parameters(url,['id']);send(200,await workspace[route.split('/').at(-1)](input.id));return true;
        }
        if(route==='/api/gtfs/operation') {
          input=parameters(url,['requestId']);send(200,workspace.operation(input.requestId));return true;
        }
        if(route==='/api/gtfs/rows'||route==='/api/gtfs/source-rows') {
          input=numbers(parameters(url,['feedId','editionId','resource','offset','limit','query']),['offset','limit']);
          send(200,await workspace[route.endsWith('source-rows')?'sourceRows':'rows'](input));return true;
        }
        if(route==='/api/gtfs/manifest') {
          input=numbers(parameters(url,['kind','id','offset','limit','expectedManifestSha256']),['offset','limit']);
          send(200,await workspace.manifest(input));return true;
        }
        if(route==='/api/gtfs/download') {
          input=parameters(url,['kind','id','file','expectedSha256']);
          let chunk=await workspace.readFile({...input,offset:0,limit:65536}),readId=chunk.readId,complete=false;
          try {
            const file=chunk.file,name=file.name.split('/').at(-1).replace(/[^A-Za-z0-9_.-]/g,'_')||'gtfs-artifact';
            res.writeHead(200,{'content-type':file.contentType??'application/octet-stream',
              'content-length':file.bytes,'content-disposition':'attachment; filename="'+name+'"',
              'x-content-type-options':'nosniff','cache-control':'no-store','referrer-policy':'no-referrer',
              'x-content-sha256':file.sha256});
            for(;;) {
              if(res.destroyed)break;
              if(!res.write(Buffer.from(chunk.data,'base64')))await drainResponse(res);
              if(chunk.nextOffset===null){complete=true;res.end();break;}
              if(res.destroyed)break;
              chunk=await workspace.readFile({...input,readId,offset:chunk.nextOffset,limit:65536});
            }
          } finally {if(!complete)await workspace.releaseRead(readId).catch(()=>{});}
          return true;
        }
        throw fault('NOT_FOUND','GTFS view not found.',404);
      }
      if(req.method!=='POST')throw fault('NOT_FOUND','GTFS action not found.',404);
      if(route==='/api/gtfs/upload') {
        const values=parameters(url,['requestId','expectedRevision','title','filename','feedSha256']);
        const content=await inputBody(req,GTFS_ZIP_MAX_BYTES,false);
        const result=await workspace.retainFeed({requestId:values.requestId,expectedRevision:Number(values.expectedRevision),
          payload:{title:values.title,filename:values.filename,feedSha256:values.feedSha256,feedBytes:content.length}},content);
        send(201,result);return true;
      }
      parameters(url,[]);
      const input=await inputBody(req,1024*1024);
      const actions={
        '/api/gtfs/edition':'createEdition','/api/gtfs/compare':'compareEditions','/api/gtfs/decision':'saveDecision',
        '/api/gtfs/select':'selectEdition','/api/gtfs/export':'exportWorkspace','/api/gtfs/release-prepare':'prepareRelease',
        '/api/gtfs/release-stage':'stageRelease','/api/gtfs/read':'readFile'};
      if(actions[route]){send(200,await workspace[actions[route]](input));return true;}
      if(route==='/api/gtfs/recover'){send(200,await workspace.recoverRequest(input.requestId));return true;}
      if(route==='/api/gtfs/read-release'){await workspace.releaseRead(input.readId);send(200,{readId:input.readId,state:'RELEASED'});return true;}
      throw fault('NOT_FOUND','GTFS action not found.',404);
    },
  };
}
export async function startGtfsWorkspaceServer({workspace:borrowed,port=8448,...options}={}) {
  const workspace=borrowed??await openGtfsWorkspace(options),owns=!borrowed;
  try {
    const extension=await createGtfsExtension({workspace});
    const server=await startPostgresPublisherServer({publisher:workspace.publisher,schedule:workspace.schedule,
      ownsPublisher:false,port,extension});
    let closing;
    return {workspace,url:server.url,server:server.server,close(){
      closing??=(async()=>{try{await server.close();}finally{if(owns)await workspace.close();}})();return closing;}};
  } catch(issue){if(owns)await workspace.close();throw issue;}
}

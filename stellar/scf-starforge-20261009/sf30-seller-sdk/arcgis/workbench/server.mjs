// MIT. Same-listener ArcGIS workbench extension for the original publisher UI.
import { readFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { startPostgresPublisherServer } from '../../postgres/publisher/server.mjs';
import { openArcgisWorkbench } from './model.mjs';
import { fault } from '../../postgres/publisher/files.mjs';

async function jsonBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))
    throw fault('JSON_REQUIRED','Send application/json.',415);
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>262144)throw fault('REQUEST_TOO_LARGE',undefined,413);chunks.push(chunk);}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch{throw fault('JSON_INVALID');}
}
function pageOptions(url) {
  const result={};
  for(const key of ['limit','capturesOffset','editionsOffset','deploymentsOffset']){
    if(!url.searchParams.has(key))continue;
    const value=url.searchParams.get(key);
    if(!/^(0|[1-9][0-9]*)$/.test(value))throw fault('ARCGIS_PAGE_INVALID');
    result[key]=Number(value);
  }
  return result;
}
function drain(res) {
  if (res.destroyed) return Promise.reject(fault('ARCGIS_DOWNLOAD_CLOSED'));
  return new Promise((done,reject) => {
    const clear = () => { res.off('drain',ready);res.off('close',closed);res.off('error',failed); };
    const ready = () => { clear();done(); };
    const closed = () => { clear();reject(fault('ARCGIS_DOWNLOAD_CLOSED')); };
    const failed = issue => { clear();reject(issue); };
    res.once('drain',ready);res.once('close',closed);res.once('error',failed);
  });
}
async function streamFile(res, file) {
  const handle=await open(file.path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=await handle.stat();
    if(!before.isFile()||before.nlink!==1||before.mode&0o077||before.size!==file.bytes)
      throw fault('ARCGIS_DOWNLOAD_CHANGED');
    res.writeHead(200,{'content-type':file.type,'content-length':file.bytes,
      'content-disposition':'attachment; filename="'+file.name+'"','x-content-sha256':file.sha256,
      'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
    const hash=createHash('sha256');let size=0;
    for await(const chunk of handle.createReadStream({autoClose:false})){
      if(res.destroyed)throw fault('ARCGIS_DOWNLOAD_CLOSED');
      size+=chunk.length;if(size>file.bytes)throw fault('ARCGIS_DOWNLOAD_CHANGED');
      hash.update(chunk);
      if(!res.write(chunk))await drain(res);
    }
    const after=await handle.stat();
    if(size!==file.bytes||hash.digest('hex')!==file.sha256||after.size!==before.size||
      after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw fault('ARCGIS_DOWNLOAD_CHANGED');
    res.end();
  } catch(issue){if(res.headersSent)res.destroy();throw issue;}
  finally{await handle.close();}
}
export async function startArcgisWorkbenchServer({publisher,port=8457,releaseDirectory,environment=process.env}={}) {
  const workbench=await openArcgisWorkbench({publisher,releaseDirectory,environment});
  try {
  const manifest=JSON.parse(await readFile(new URL('./browser-assets.json',import.meta.url),'utf8'));
  const assets=await Promise.all(manifest.routes.filter(([path])=>path.startsWith('/arcgis-workbench/'))
    .map(async([path,[name,type]])=>({path,type,bytes:await readFile(new URL(manifest.root+name,import.meta.url))})));
  const extension={
    assets,
    head:'<link rel="stylesheet" href="/arcgis-workbench/style.css"><script type="module" src="/arcgis-workbench/app.mjs"></script>',
    async handle({req,res,url,send}) {
      const path=url.pathname;
      if(!path.startsWith('/api/arcgis/'))return false;
      const binding=req.headers['x-arcgis-workbench'];
      if(binding!==undefined&&binding!==workbench.workbenchId||
        !['GET','HEAD'].includes(req.method)&&binding!==workbench.workbenchId)
        throw fault('ARCGIS_WORKSPACE_CHANGED','This request belongs to another workspace. Reopen and review the current workspace.',409);
      if(req.method==='GET'){
        if(path==='/api/arcgis/status')send(200,await workbench.status(pageOptions(url)));
        else if(path==='/api/arcgis/request')send(200,workbench.request(url.searchParams.get('id')));
        else if(path==='/api/arcgis/capture')send(200,await workbench.capture(url.searchParams.get('id')));
        else if(path==='/api/arcgis/edition')send(200,await workbench.edition(url.searchParams.get('id')));
        else if(path==='/api/arcgis/deployment')send(200,await workbench.deployment(url.searchParams.get('id')));
        else if(path==='/api/arcgis/download')await streamFile(res,await workbench.download(url.searchParams.get('deploymentId'),url.searchParams.get('name')));
        else throw fault('NOT_FOUND','Page not found.',404);
        return true;
      }
      if(req.method==='PUT'&&path==='/api/arcgis/uploads'){
        if(!/^application\/octet-stream(?:\s*;|$)/i.test(req.headers['content-type']??''))
          throw fault('ARCGIS_FILE_BODY_REQUIRED',undefined,415);
        const result=await workbench.upload(req,{requestId:url.searchParams.get('requestId'),name:url.searchParams.get('name'),sha256:url.searchParams.get('sha256')});
        if(result.state==='SUCCEEDED')send(200,result.result);
        else send(422,{error:result.error?.code??'ARCGIS_UPLOAD_FAILED',message:result.error?.message,request:result});
        return true;
      }
      if(req.method!=='POST')throw fault('NOT_FOUND','Action not found.',404);
      const input=await jsonBody(req);
      const operations={
        '/api/arcgis/captures':()=>workbench.prepareCapture(input),
        '/api/arcgis/continue':()=>workbench.continueCapture(input),
        '/api/arcgis/pause':()=>workbench.pause(input),
        '/api/arcgis/editions':()=>workbench.createEdition(input),
        '/api/arcgis/select':()=>workbench.select(input),
        '/api/arcgis/deployments':()=>workbench.exportDeployment(input),
        '/api/arcgis/stage':()=>workbench.stage(input),
        '/api/arcgis/remove-upload':()=>workbench.removeUpload(input),
        '/api/arcgis/release-console':()=>workbench.releaseConsole(input),
      };
      if(!operations[path])throw fault('NOT_FOUND','Action not found.',404);
      const result=await operations[path]();
      send(result?.request?.state==='RUNNING'?202:200,result);return true;
    },
    close:()=>workbench.close(),
  };
    const service=await startPostgresPublisherServer({publisher,port,extension});
    return {...service,workbench};
  } catch(issue){await workbench.close();await publisher.close();throw issue;}
}

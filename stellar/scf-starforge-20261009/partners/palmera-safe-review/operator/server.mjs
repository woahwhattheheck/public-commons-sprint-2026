// MIT. Private loopback operator; original engines own each underlying operation.
import {createServer} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {need,parseJson,safeCode} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {openSafeBuyerWorkspace} from './model.mjs';

const PUBLIC=fileURLToPath(new URL('./public/',import.meta.url));
const ASSETS={'/':'index.html','/app.mjs':'app.mjs','/style.css':'style.css'};
const TYPES={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const methods={
  '/api/capture':['capture',['captureId','context','label']],
  '/api/selections/receive':['receiveSelection',['directory']],
  '/api/prepare':['prepare',['selectionId','planFile','ticketFile','intentId']],
  '/api/import':['import',['directory']],
  '/api/review':['review',['intentId']],
  '/api/execute':['execute',['intentId','reviewSha256']],
  '/api/recover':['recover',['intentId']],
  '/api/abort':['abort',['intentId']],
  '/api/analyze':['analyze',['intentId']],
  '/api/compare':['compare',['beforeIntentId','afterIntentId','title','notes']],
  '/api/handover':['handover',['intentId']],
  '/api/receive':['receive',['directory']]
};
async function input(req) {
  need((req.headers['content-type']??'').split(';',1)[0].trim()==='application/json','SAFE_JSON_BODY_REQUIRED');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;need(size<=1024*1024,'SAFE_OPERATOR_INPUT_LIMIT');chunks.push(chunk);}
  const value=parseJson(Buffer.concat(chunks));
  need(value&&typeof value==='object'&&!Array.isArray(value),'SAFE_JSON_OBJECT_REQUIRED');return value;
}
export async function startSafeBuyerWorkspace({port=0,...options}={}) {
  need(Number.isInteger(port)&&port>=0&&port<=65535,'SAFE_OPERATOR_PORT_INVALID');
  const model=await openSafeBuyerWorkspace(options);
  const token=randomBytes(32).toString('hex');
  let origin,closing=false,shutdown;
  const server=createServer(async(req,res)=>{
    const send=(status,value,type='application/json; charset=utf-8',extra={})=>{
      const raw=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value)+'\n');
      if(res.destroyed)return;
      res.writeHead(status,{...headers,'Content-Type':type,'Content-Length':raw.length,...extra});res.end(raw);
    };
    const success=value=>send(200,{scope:model.scope,value});
    try {
      need(req.headers.host===new URL(origin).host,'SAFE_HOST_REFUSED');
      need(!req.headers.origin||req.headers.origin===origin,'SAFE_ORIGIN_REFUSED');
      const url=new URL(req.url,origin),path=url.pathname;
      if(req.method==='GET'&&Object.hasOwn(ASSETS,path)){
        const name=ASSETS[path],suffix=name.slice(name.lastIndexOf('.'));
        send(200,await readFile(join(PUBLIC,name)),TYPES[suffix]);return;
      }
      const actual=Buffer.from(req.headers.authorization??''),wanted=Buffer.from('Bearer '+token);
      need(actual.length===wanted.length&&timingSafeEqual(actual,wanted),'SAFE_AUTH_REQUIRED');
      need(!closing,'SAFE_WORKSPACE_CLOSING');
      await model.bound();
      if(req.method==='GET'&&path==='/api/state'){success(await model.state());return;}
      if(req.method==='GET'&&path==='/api/operation'){success(await model.operation(url.searchParams.get('intentId')));return;}
      if(req.method==='GET'&&path==='/api/handover'){success(await model.openHandover({id:url.searchParams.get('id')}));return;}
      if(req.method==='GET'&&(path==='/api/download'||path==='/api/review-file')) {
        const selected=path==='/api/download'?await model.download({
          handover:url.searchParams.get('handover'),file:url.searchParams.get('file')}):
          await model.reviewFile({intentId:url.searchParams.get('intentId'),sha256:url.searchParams.get('sha256')});
        send(200,selected.bytes,selected.type,{
          'Content-Disposition':'attachment; filename="'+selected.filename+'"',
          'X-Content-SHA256':selected.sha256});return;
      }
      if(req.method==='POST'&&Object.hasOwn(methods,path)) {
        const data=await input(req),[method,allowed]=methods[path];
        model.requireScope(data);
        need(Object.keys(data).every(key=>['workspaceId','configurationSha256',...allowed].includes(key)),
          'SAFE_OPERATOR_FIELD_INVALID');
        const selected={};for(const key of allowed)if(Object.hasOwn(data,key))selected[key]=data[key];
        const value=await model[method](selected);
        success(value);return;
      }
      send(404,{error:'SAFE_ROUTE_NOT_FOUND'});
    }catch(error){
      if(res.headersSent){res.destroy();return;}
      const code=safeCode(error?.code,'SAFE_WORKSPACE_OPERATION_FAILED');
      const status=code==='SAFE_AUTH_REQUIRED'?401:
        ['SAFE_HOST_REFUSED','SAFE_ORIGIN_REFUSED'].includes(code)?403:
        code==='SAFE_WORKSPACE_CLOSING'?503:
        ['SAFE_WORKSPACE_SCOPE_CHANGED','SAFE_OPERATION_ACTIVE','SAFE_WORKSPACE_IDENTITY_CHANGED',
          'SAFE_WORKSPACE_CONFIGURATION_CHANGED'].includes(code)?409:code==='ENOENT'?404:400;
      send(status,{error:code});
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
  try {await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',accept);});}
  catch(error){await model.close();throw error;}
  origin='http://127.0.0.1:'+server.address().port;
  const close=()=>shutdown??=(async()=>{
    closing=true;
    const stopped=new Promise((accept,reject)=>server.close(error=>error?reject(error):accept()));
    server.closeIdleConnections();
    await model.close();await stopped;
  })();
  return {server,model,origin,url:origin+'/#token='+token,scope:model.scope,close};
}
export const HELP='Safe buyer operator workspace\n\n'+
  '  --directory DIR --runtime DIR --state DIR --analysis DIR\n'+
  '  [--operator-profile FILE] [--capture-module FILE] [--port PORT]\n'+
  '  [--expected-workspace-sha256 HASH_OR_NEW --expected-configuration-sha256 HASH]\n'+
  '  [--workspace-creation-id ORIGINAL_MANAGED_REQUEST_ID]\n\n'+
  'Use the original SF88 runtime and buyer state. Capture uses the selected local\n'+
  'caller module exporting loadTransaction({context,signal}); it returns the original\n'+
  'Safe/Palmera instance and transaction. Review and execute keep the original buyer.\n';
export async function main(argv=process.argv.slice(2)) {
  if(!argv.length||argv.length===1&&argv[0]==='--help'){console.log(HELP);return null;}
  const map={'--directory':'directory','--runtime':'runtimeDirectory','--state':'stateDirectory',
    '--analysis':'analysisWorkspace','--operator-profile':'operatorProfile','--capture-module':'captureModule','--port':'port',
    '--expected-workspace-sha256':'expectedWorkspace','--expected-configuration-sha256':'expectedConfiguration',
    '--workspace-creation-id':'creationId'};
  const options={};
  need(argv.length%2===0,'SAFE_OPERATOR_OPTIONS_REQUIRED');
  for(let i=0;i<argv.length;i+=2){
    const key=map[argv[i]],value=argv[i+1];
    need(key&&typeof value==='string'&&value.length>0&&!value.startsWith('--')&&!Object.hasOwn(options,key),
      'SAFE_OPERATOR_OPTIONS_INVALID');
    if(key==='port'){need(/^(0|[1-9][0-9]{0,4})$/.test(value),'SAFE_OPERATOR_PORT_INVALID');options.port=Number(value);}
    else if(['expectedWorkspace','expectedConfiguration','creationId'].includes(key))options[key]=value;
    else options[key]=resolve(value);
  }
  if(Object.hasOwn(options,'expectedWorkspace')||Object.hasOwn(options,'expectedConfiguration')) {
    options.launchBinding={workspaceSha256:options.expectedWorkspace,configurationSha256:options.expectedConfiguration};
    delete options.expectedWorkspace;delete options.expectedConfiguration;
  }
  const active=await startSafeBuyerWorkspace(options);
  console.log(JSON.stringify({schema:'stellar-forge.safe-buyer-workspace-startup.v1',
    status:'SAFE_BUYER_WORKSPACE_READY',safeBuyerWorkspace:active.url,directory:active.model.root,
    workspaceSha256:active.model.manifestSha256,creationId:active.model.manifest.createdBy??null,...active.scope}));
  const stop=()=>active.close().catch(error=>{console.error(safeCode(error?.code,'SAFE_WORKSPACE_CLOSE_FAILED'));process.exitCode=1;});
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  return active;
}
if(process.argv[1]&&await realpath(resolve(process.argv[1])).then(path=>path===fileURLToPath(import.meta.url),()=>false))
  main().catch(error=>{console.error(safeCode(error?.code,'SAFE_WORKSPACE_START_FAILED'));process.exitCode=1;});

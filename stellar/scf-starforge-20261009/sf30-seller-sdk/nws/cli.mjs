// MIT. Original weather workspace actions from files or a running private session.
import {readFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openNwsWorkspace} from './core.mjs';
import {readReleaseRuntime} from './workspace.mjs';
const json=async p=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(resolve(p))));
const HELP=[
  'node nws/cli.mjs --workspace PRIVATE_DIR COMMAND [options]',
  'node nws/cli.mjs --session PRIVATE_STARTUP_JSON COMMAND [options]',
  '',
  'Commands:',
  '  schema | view | sites',
  '  action --request ORIGINAL_ACTION_JSON',
  '  collect --site-id ID --operation-id ID [--start ISO] [--end ISO] [--products forecast,hourly,grid,observations,alerts] [--units us|si]',
  '  import-source --site-id ID --operation-id ID --file ORIGINAL_SOURCE_PACKAGE',
  '  rows --edition-id ID --table TABLE [--offset 0] [--limit 100]',
  '  source --edition-id ID --page INDEX --output NEW_FILE [--wire true]',
  '  download --export-id ID --output NEW_FILE',
  '  receive-file --receipt-id ID --name NAME --output NEW_FILE',
  '',
  'Private workspace options: --inbox PRIVATE_DIR --release-runtime PRIVATE_JSON --user-agent IDENTIFIER.',
  'A running console owns its workspace. Use its private startup JSON with --session to send actions to that same writer.',
  'Collect and import wait for the selected capture. Other named actions use the unchanged action/payload/operationId/expectedRevision JSON contract.'
].join('\n');
function argumentsOf(args){
  const values={};let command;
  for(let i=0;i<args.length;i++){
    const a=args[i];if(a==='--help')return {help:true};
    if(a.startsWith('--')){
      if(values[a]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw new TypeError('Use paired unique options; see --help.');
      values[a]=args[++i];
    }else if(command)throw new TypeError('Choose one command.');else command=a;
  }
  const names=['--workspace','--session','--inbox','--release-runtime','--user-agent','--request','--site-id','--operation-id',
    '--start','--end','--products','--units','--file','--edition-id','--table','--offset','--limit','--page','--output','--wire','--export-id','--receipt-id','--name'];
  if(Object.keys(values).some(k=>!names.includes(k)))throw new TypeError('An option is not supported; see --help.');
  if(Boolean(values['--workspace'])===Boolean(values['--session']))throw new TypeError('Choose one private workspace or original session file.');
  return {values,command};
}
async function sessionClient(filename){
  const file=await json(filename);
  if(file.schema!=='stellar-forge.nws-workspace-startup.v1'||file.status!=='NWS_READY')throw new TypeError('Choose an original NWS startup descriptor.');
  const session=new URL(file.url),token=session.hash.slice(1);
  if(session.protocol!=='http:'||session.hostname!=='127.0.0.1'||!token||session.pathname!=='/')throw new TypeError('The private NWS session URL is invalid.');
  const origin=session.origin;
  async function request(path,options={}){
    const r=await fetch(origin+path,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
    if(!r.ok){let detail;try{detail=await r.json();}catch{}throw Object.assign(new Error(detail?.message??'Workspace HTTP'+r.status),detail??{},{status:r.status});}
    return r;
  }
  const query=(path,v)=>path+'?'+new URLSearchParams(Object.entries(v).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]));
  return {
    schema:async()=>(await request('/api/schema')).json(),view:async()=>(await request('/api/view')).json(),
    action:async value=>(await request('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})).json(),
    rows:async(id,o)=>(await request(query('/api/rows',{editionId:id,...o}))).json(),
    raw:async(id,page,{wire=false}={})=>({bytes:Buffer.from(await (await request(query('/api/raw',{editionId:id,page,wire}))).arrayBuffer())}),
    exported:async id=>({bytes:Buffer.from(await (await request('/api/exports/'+encodeURIComponent(id))).arrayBuffer())}),
    received:async(id,name)=>({bytes:Buffer.from(await (await request('/api/receipts/'+encodeURIComponent(id)+'/'+encodeURIComponent(name))).arrayBuffer())}),
    close:async()=>{},remote:true
  };
}
async function writeOutput(filename,bytes){
  if(!filename)throw new TypeError('--output is required for a file download.');
  const file=await open(resolve(filename),'wx',0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  return {file:resolve(filename),bytes:bytes.length};
}
export async function main(args=process.argv.slice(2)){
  const parsed=argumentsOf(args);if(parsed.help){console.log(HELP);return;}
  const {values:v,command}=parsed;
  if(!['schema','view','sites','action','collect','import-source','rows','source','download','receive-file'].includes(command))
    throw new TypeError('Choose a listed command; see --help.');
  const app=v['--session']?await sessionClient(v['--session']):await openNwsWorkspace({
    directory:resolve(v['--workspace']),inboxDirectory:v['--inbox']?resolve(v['--inbox']):undefined,
    userAgent:v['--user-agent'],releaseRuntime:v['--release-runtime']?await readReleaseRuntime(v['--release-runtime']):undefined
  });
  let result;
  try{
    if(command==='schema')result=await app.schema();
    else if(command==='view')result=await app.view();
    else if(command==='sites')result=(await app.view()).sites;
    else if(command==='action'){
      if(!v['--request'])throw new TypeError('--request is required.');
      const request=await json(v['--request']);
      if(request.action==='release.start'&&!app.remote)throw new TypeError('Use --session PRIVATE_STARTUP_JSON to start a publisher under the running workspace process.');
      result=await app.action(request);
      if(result.result?.captureId&&['capture.start','capture.resume','capture.import','capture.station'].includes(request.action))
        result.capture=await waitCapture(app,result.result.captureId);
    }else if(command==='collect'||command==='import-source'){
      if(!v['--site-id']||!v['--operation-id'])throw new TypeError('--site-id and a stable --operation-id are required.');
      const current=await app.view(),payload={siteId:v['--site-id']};
      if(command==='import-source'){
        if(!v['--file'])throw new TypeError('--file is required.');payload.bundle=await json(v['--file']);
      }else{
        if(v['--start'])payload.observationStart=v['--start'];if(v['--end'])payload.observationEnd=v['--end'];
        if(v['--products'])payload.products=v['--products'].split(',');if(v['--units'])payload.units=v['--units'];
      }
      result=await app.action({action:command==='collect'?'capture.start':'capture.import',payload,
        operationId:v['--operation-id'],expectedRevision:current.revision});
      result.capture=await waitCapture(app,result.result.captureId);
    }else if(command==='rows')result=await app.rows(v['--edition-id'],{table:v['--table']??'forecast',offset:Number(v['--offset']??0),limit:Number(v['--limit']??100)});
    else if(command==='source')result=await writeOutput(v['--output'],(await app.raw(v['--edition-id'],Number(v['--page']),{wire:v['--wire']==='true'})).bytes);
    else if(command==='download')result=await writeOutput(v['--output'],(await app.exported(v['--export-id'])).bytes);
    else result=await writeOutput(v['--output'],(await app.received(v['--receipt-id'],v['--name'])).bytes);
    console.log(JSON.stringify(result,null,2));return result;
  }finally{await app.close();}
}
async function waitCapture(app,id){
  if(!app.remote)await app.waitForCaptures();
  for(;;){
    const view=await app.view(),capture=view.captures.find(c=>c.id===id);
    if(!capture)throw new TypeError('The selected capture is missing.');
    if(!['QUEUED','RUNNING'].includes(capture.state))return capture;
    await new Promise(done=>setTimeout(done,750));
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{console.error(JSON.stringify({error:error.code??'NWS_CLI_ERROR',message:error.message,operationId:error.operationId??null},null,2));process.exitCode=1;});

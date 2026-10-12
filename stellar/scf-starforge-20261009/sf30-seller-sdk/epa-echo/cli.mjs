// MIT. Operate the same original EPA workspace from a terminal or its private session.
import {readFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readOwned} from '../stellar-expert/store.mjs';
import {openEchoWorkspace} from './core.mjs';
import {readReleaseRuntime} from './workspace.mjs';
const json=async(path,max=256*1024*1024)=>{
 const file=await open(resolve(path),'r');let bytes;
 try{const stat=await file.stat();if(!stat.isFile()||stat.size>max)throw new TypeError('Choose a complete JSON file within its stated capacity.');bytes=await file.readFile();}
 finally{await file.close();}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
};
const HELP=[
 'node epa-echo/cli.mjs --workspace PRIVATE_DIR COMMAND [options]',
 'node epa-echo/cli.mjs --session PRIVATE_STARTUP_JSON COMMAND [options]',
 '',
 'Commands:',
 '  schema | view | portfolios',
 '  action --request ORIGINAL_ACTION_JSON',
 '  search --query SOURCE_QUERY_JSON --operation-id ID [--label TEXT]',
 '  search-results --search-id ID [--offset 0] [--limit 100]',
 '  collect --portfolio-id ID --operation-id ID [--label TEXT]',
 '  import-source --portfolio-id ID --operation-id ID --file COMPLETE_SOURCE_PACKAGE',
 '  editions [--portfolio-id ID] [--offset 0] [--limit 100]',
 '  edition --edition-id ID',
 '  rows --edition-id ID --table TABLE [--facility-id FRS] [--section ORIGINAL_SECTION] [--offset 0] [--limit 100]',
 '  facility --edition-id ID --facility-id FRS',
 '  source --edition-id ID --page INDEX --output NEW_FILE [--wire true]',
 '  download --export-id ID --output NEW_FILE',
 '  receive-file --receipt-id ID --name ORIGINAL_CUSTOMER_FILENAME --output NEW_FILE',
 '  export-workspace --operation-id ID --output NEW_FILE',
 '  import-workspace --operation-id ID --file COMPLETE_WORKSPACE_PACKAGE',
 '  received-workspace --receipt-id ID',
 '  received-workspace-file --receipt-id ID --path ORIGINAL_PACKAGE_PATH --output NEW_FILE',
 '',
 'Private local options: --inbox ORIGINAL_PRIVATE_DIR --release-runtime PRIVATE_JSON --user-agent IDENTIFIER.',
 'The running console owns its private writer. Use --session to operate that same process.',
 'Start a lasting release through --session. The terminal action format keeps the original operationId and expectedRevision.',
 'Source search and capture commands wait for their saved operation to become complete, partial or paused.',
 'Every downloaded file is created exclusively; an existing output is preserved.'
].join('\n');
function argumentsOf(args){
 const values={};let command;
 for(let i=0;i<args.length;i++){
  const value=args[i];if(value==='--help')return {help:true};
  if(value.startsWith('--')){
   if(values[value]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw new TypeError('Use paired unique options; see --help.');
   values[value]=args[++i];
  }else if(command)throw new TypeError('Choose one command.');else command=value;
 }
 const names=['--workspace','--session','--inbox','--release-runtime','--user-agent','--request','--portfolio-id','--operation-id',
  '--file','--query','--label','--edition-id','--table','--facility-id','--section','--offset','--limit','--page','--output','--wire',
  '--export-id','--receipt-id','--search-id','--name','--path'];
 if(Object.keys(values).some(k=>!names.includes(k)))throw new TypeError('An option is not supported; see --help.');
 if(Boolean(values['--workspace'])===Boolean(values['--session']))throw new TypeError('Choose one private workspace or original session file.');
 if(values['--wire']!==undefined&&!['true','false'].includes(values['--wire']))throw new TypeError('--wire accepts true or false.');
 return {values,command};
}
export async function sessionClient(filename){
 const file=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readOwned(resolve(filename),65536)));
 if(file.schema!=='stellar-forge.epa-echo-workspace-startup.v1'||file.status!=='EPA_ECHO_READY'||
  !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(file.workspaceId??''))
  throw new TypeError('Choose the original private EPA ECHO startup descriptor.');
 const session=new URL(file.url),token=session.hash.slice(1);
 if(session.protocol!=='http:'||session.hostname!=='127.0.0.1'||session.username||session.password||session.search||
  !/^[A-Za-z0-9_-]{43}$/.test(token)||session.pathname!=='/'||!session.port)
  throw new TypeError('The private original session URL is invalid.');
 const origin=session.origin;
 async function request(path,options={}){
  const r=await fetch(origin+path,{...options,redirect:'error',headers:{Authorization:'Bearer '+token,...options.headers}});
  if(!r.ok){
   let detail;try{detail=await r.json();}catch{}
   throw Object.assign(new Error(detail?.message??'Workspace HTTP '+r.status),detail??{},{status:r.status});
  }
  return r;
 }
 const query=(path,v)=>path+'?'+new URLSearchParams(Object.entries(v).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]));
 const identity=await(await request('/api/schema')).json();
 if(identity.workspaceId!==file.workspaceId)throw new TypeError('This listener belongs to another workspace. Select the current descriptor for the original workspace.');
 return {
  schema:async()=>(await request('/api/schema')).json(),view:async()=>(await request('/api/view')).json(),
  action:async value=>(await request('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})).json(),
  editions:async options=>(await request(query('/api/editions',options))).json(),
  edition:async id=>(await request(query('/api/edition',{editionId:id}))).json(),
  rows:async(id,options)=>(await request(query('/api/rows',{editionId:id,...options}))).json(),
  facility:async(id,facilityId)=>(await request(query('/api/facility',{editionId:id,facilityId}))).json(),
  search:async(id,options)=>(await request(query('/api/search',{searchId:id,...options}))).json(),
  raw:async(id,page,{wire=false}={})=>({bytes:Buffer.from(await(await request(query('/api/raw',{editionId:id,page,wire}))).arrayBuffer())}),
  exported:async id=>({bytes:Buffer.from(await(await request('/api/exports/'+encodeURIComponent(id))).arrayBuffer())}),
  received:async(id,name)=>({bytes:Buffer.from(await(await request('/api/receipts/'+encodeURIComponent(id)+'/'+encodeURIComponent(name))).arrayBuffer())}),
  receivedWorkspace:async receiptId=>(await request(query('/api/received-workspace',{receiptId}))).json(),
  receivedWorkspaceFile:async(receiptId,path)=>({bytes:Buffer.from(await(await request(query('/api/received-workspace-file',{receiptId,path}))).arrayBuffer())}),
  close:async()=>{},remote:true
 };
}
async function writeOutput(filename,bytes){
 if(!filename)throw new TypeError('--output is required for a file download.');
 const file=await open(resolve(filename),'wx',0o600);
 try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
 return {file:resolve(filename),bytes:bytes.length};
}
async function waitSource(app,id,kind){
 if(!app.remote)await app.waitForCaptures();
 for(;;){
  const view=await app.view(),record=(kind==='capture'?view.captures:view.searches).find(c=>c.id===id);
  if(!record)throw new TypeError('The selected original source operation is missing.');
  if(!['QUEUED','RUNNING','PAUSING'].includes(record.state))return record;
  await new Promise(done=>setTimeout(done,750));
 }
}
export async function main(args=process.argv.slice(2)){
 const parsed=argumentsOf(args);if(parsed.help){console.log(HELP);return;}
 const {values:v,command}=parsed,commands=['schema','view','portfolios','action','search','search-results','collect','import-source',
  'editions','edition','rows','facility','source','download','receive-file','export-workspace','import-workspace','received-workspace','received-workspace-file'];
 if(!commands.includes(command))throw new TypeError('Choose a listed command; see --help.');
 const app=v['--session']?await sessionClient(v['--session']):await openEchoWorkspace({
  directory:resolve(v['--workspace']),inboxDirectory:v['--inbox']?resolve(v['--inbox']):undefined,userAgent:v['--user-agent'],
  releaseRuntime:v['--release-runtime']?await readReleaseRuntime(v['--release-runtime']):undefined
 });
 const required=name=>{if(!v[name])throw new TypeError(name+' is required.');return v[name];};
 const range=()=>({offset:Number(v['--offset']??0),limit:Number(v['--limit']??100)});
 async function submit(action,payload){
  const operationId=required('--operation-id'),current=await app.view();
  return app.action({action,payload,operationId,expectedRevision:current.revision});
 }
 let result;
 try{
  if(command==='schema')result=await app.schema();
  else if(command==='view')result=await app.view();
  else if(command==='portfolios')result=(await app.view()).portfolios;
  else if(command==='action'){
   const request=await json(required('--request'));
   if(request.action==='release.start'&&!app.remote)throw new TypeError('Use --session PRIVATE_STARTUP_JSON to keep the original publisher under the running workspace process.');
   result=await app.action(request);
   if(result.result?.captureId&&['capture.start','capture.resume','capture.import'].includes(request.action))
    result.capture=await waitSource(app,result.result.captureId,'capture');
   if(result.result?.searchId&&request.action==='facility.search')result.search=await waitSource(app,result.result.searchId,'search');
  }else if(command==='search'){
   result=await submit('facility.search',{query:await json(required('--query'),65536),...(v['--label']?{label:v['--label']}:{})});
   result.search=await waitSource(app,result.result.searchId,'search');
  }else if(command==='collect'||command==='import-source'){
   const payload={portfolioId:required('--portfolio-id'),...(v['--label']?{label:v['--label']}:{})};
   if(command==='import-source')payload.bundle=await json(required('--file'));
   result=await submit(command==='collect'?'capture.start':'capture.import',payload);
   result.capture=await waitSource(app,result.result.captureId,'capture');
  }else if(command==='search-results')result=await app.search(required('--search-id'),range());
  else if(command==='editions')result=await app.editions({...range(),portfolioId:v['--portfolio-id']});
  else if(command==='edition')result=await app.edition(required('--edition-id'));
  else if(command==='rows')result=await app.rows(required('--edition-id'),{...range(),table:v['--table']??'facilities',facilityId:v['--facility-id'],section:v['--section']});
  else if(command==='facility')result=await app.facility(required('--edition-id'),required('--facility-id'));
  else if(command==='source')result=await writeOutput(required('--output'),(await app.raw(required('--edition-id'),Number(required('--page')),{wire:v['--wire']==='true'})).bytes);
  else if(command==='download')result=await writeOutput(required('--output'),(await app.exported(required('--export-id'))).bytes);
  else if(command==='receive-file')result=await writeOutput(required('--output'),(await app.received(required('--receipt-id'),required('--name'))).bytes);
  else if(command==='export-workspace'){
   required('--output');result=await submit('workspace.export',{});
   result.file=await writeOutput(v['--output'],(await app.exported(result.result.id)).bytes);
  }else if(command==='import-workspace')result=await submit('workspace.receive',{bundle:await json(required('--file'))});
  else if(command==='received-workspace')result=await app.receivedWorkspace(required('--receipt-id'));
  else result=await writeOutput(required('--output'),(await app.receivedWorkspaceFile(required('--receipt-id'),required('--path'))).bytes);
  console.log(JSON.stringify(result,null,2));return result;
 }finally{await app.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(error=>{console.error(JSON.stringify({error:error.code??'ECHO_CLI_ERROR',message:error.message,operationId:error.operationId??null},null,2));process.exitCode=1;});

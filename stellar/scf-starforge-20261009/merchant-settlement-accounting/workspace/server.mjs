#!/usr/bin/env node
// MIT. Loopback operator interface for the maintained accounting workspace.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {openAccountingWorkspace,WorkspaceError} from './store.mjs';

const PUBLIC=fileURLToPath(new URL('./public/',import.meta.url));
const TYPES={'.json':'application/json; charset=utf-8','.csv':'text/csv; charset=utf-8','.html':'text/html; charset=utf-8','.tar':'application/x-tar'};
const check=(ok,code,message,status=400)=>{if(!ok)throw new WorkspaceError(code,message,status);};
async function body(request){
  check(request.headers['content-type']?.split(';')[0]==='application/json','JSON_REQUIRED','Send a JSON workspace request.');
  let length=0;const parts=[];
  for await(const part of request){length+=part.length;check(length<=600_000,'BODY_TOO_LARGE','The upload exceeds the supported file size.',413);parts.push(part);}
  let value;try{value=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new WorkspaceError('INVALID_JSON','The request is not valid JSON.');}
  check(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_REQUEST','Send an object.');return value;
}
export async function startAccountingWorkspace({port=8446,host='127.0.0.1',...options}){
  check(host==='127.0.0.1'||host==='localhost','LOOPBACK_REQUIRED','This operator workspace binds to loopback.');
  check(Number.isInteger(port)&&port>=0&&port<=65535,'INVALID_PORT','Choose a valid port.');
  const workspace=await openAccountingWorkspace(options),hosts=new Set();
  const send=(response,status,value,{type='application/json; charset=utf-8',name}={})=>{
    if(response.destroyed)return;
    const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
    response.writeHead(status,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      ...(name?{'Content-Disposition':'attachment; filename="'+name+'"'}:{})});response.end(bytes);
  };
  const server=createServer(async(request,response)=>{
    try{
      check(hosts.has(request.headers.host),'INVALID_HOST','Open the printed local workspace address.',403);
      const url=new URL(request.url,'http://'+request.headers.host),path=url.pathname;
      const assets={'/':['index.html','text/html; charset=utf-8'],'/app.mjs':['app.mjs','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
      if(request.method==='GET'&&assets[path]){const [name,type]=assets[path];send(response,200,await readFile(join(PUBLIC,name)),{type});return;}
      let value;
      if(request.method==='POST'){
        check(request.headers['x-workspace-request']==='1','WORKSPACE_REQUEST_REQUIRED','Use the operator workspace form.',403);
        check(!request.headers.origin||request.headers.origin==='http://'+request.headers.host,'INVALID_ORIGIN','Use this local workspace address.',403);
        value=await body(request);
      }
      const parts=path.split('/').filter(Boolean),query=Object.fromEntries(url.searchParams);
      let result;
      if(path==='/api/state'&&request.method==='GET')result=workspace.view();
      else if(path==='/api/recovered/source'&&request.method==='POST')result=await workspace.connectRecovered(value);
      else if(path==='/api/recovered/refresh'&&request.method==='POST')result=await workspace.refreshRecovered(value);
      else if(path==='/api/recovered/review'&&request.method==='POST')result=await workspace.reviewRecovery(value);
      else if(path==='/api/recovered/import'&&request.method==='POST')result=await workspace.importRecovery(value);
      else if(parts.length===5&&parts[0]==='api'&&parts[1]==='recovered'&&parts[2]==='jobs'&&parts[4]==='cancel'&&request.method==='POST')result=await workspace.cancelRecovery(parts[3],value);
      else if(parts.length===4&&parts[0]==='api'&&parts[1]==='recovered'&&parts[3]==='response'&&request.method==='GET'){
        const file=await workspace.recoveredResponse(parts[2]);send(response,200,file.bytes,{type:file.type,name:file.name});return;
      }
      else if(path==='/api/proofs'&&request.method==='POST')result=await workspace.importProof(value);
      else if(parts.length===4&&parts[0]==='api'&&parts[1]==='proofs'&&parts[3]==='selection'&&request.method==='POST')result=await workspace.selectProof(parts[2],value);
      else if(path==='/api/terms'&&request.method==='POST')result=await workspace.importTerms(value);
      else if(path==='/api/terms/selection'&&request.method==='POST')result=await workspace.selectTerms(value);
      else if(path==='/api/runs'&&request.method==='POST')result=await workspace.begin(value);
      else if(parts[0]==='api'&&parts[1]==='runs'&&parts[2]){
        const id=parts[2];
        if(parts.length===3&&request.method==='GET')result=await workspace.run(id);
        else if(parts.length===4&&['ledger','options','exceptions','proofs','recovered'].includes(parts[3])&&request.method==='GET')result=await workspace.rows(id,parts[3],query);
        else if(parts.length===4&&parts[3]==='compare'&&request.method==='GET')result=await workspace.compare(id,query.baseline,query);
        else if(parts.length===6&&parts[3]==='exceptions'&&parts[5]==='review'&&request.method==='POST')result=await workspace.review(id,parts[4],value);
        else if(parts.length===4&&parts[3]==='exports'&&request.method==='POST')result=await workspace.exportRun(id,value);
        else if(parts.length===5&&parts[3]==='download'&&request.method==='GET'){
          const file=await workspace.download(id,parts[4]);send(response,200,file.bytes,{type:TYPES[file.name.slice(file.name.lastIndexOf('.'))]??'application/octet-stream',name:file.name});return;
        }
        else if(parts.length===6&&parts[3]==='recovered'&&parts[5]==='response'&&request.method==='GET'){
          const file=await workspace.recoveredResponse(parts[4],id);send(response,200,file.bytes,{type:file.type,name:file.name});return;
        }
      }else if(parts.length===4&&parts[0]==='api'&&parts[1]==='exports'&&parts[3]==='download'&&request.method==='GET'){
        const file=await workspace.archive(parts[2]);send(response,200,file.bytes,{type:TYPES['.tar'],name:file.name});return;
      }
      check(result!==undefined,'NOT_FOUND','This workspace operation was not found.',404);send(response,200,result);
    }catch(error){send(response,error.status??400,{error:error.code??'WORKSPACE_OPERATION_FAILED',message:String(error.message??error).slice(0,2000)});}
  });
  server.requestTimeout=30_000;server.headersTimeout=15_000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});}
  catch(error){await workspace.close();throw error;}
  const actual=server.address().port;hosts.add('127.0.0.1:'+actual);hosts.add('localhost:'+actual);
  let closing;
  return {workspace,server,url:'http://127.0.0.1:'+actual,close(){if(!closing)closing=(async()=>{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await workspace.close();})();return closing;}};
}

const HELP=`Merchant settlement workspace

Create:
  node workspace/server.mjs --workspace /private/accounting-workspace \\
    --outbox /private/merchant-outbox --proof-dir /private/sf86-results \\
    --terms /private/accounting-terms.json

Reopen:
  node workspace/server.mjs --workspace /private/accounting-workspace

Optional: --port 8446 and --recovered-dir /private/original-recovered-settlements.
Requires Node22+, Linux flock, and tar for review downloads.
Uses the original accounting engine and report writer; all serving is loopback.
`;
export async function main(argv=process.argv.slice(2)){
  if(argv.length===1&&argv[0]==='--help'){process.stdout.write(HELP);return;}
  const keys=new Set(['--workspace','--outbox','--proof-dir','--terms','--port','--recovered-dir']),values={};
  for(let i=0;i<argv.length;i+=2){check(keys.has(argv[i])&&argv[i+1]&&!Object.hasOwn(values,argv[i]),'INVALID_ARGUMENTS',HELP);values[argv[i]]=argv[i+1];}
  check(values['--workspace'],'WORKSPACE_REQUIRED',HELP);
  const app=await startAccountingWorkspace({directory:resolve(values['--workspace']),
    outboxDir:values['--outbox']&&resolve(values['--outbox']),proofDir:values['--proof-dir']&&resolve(values['--proof-dir']),termsFile:values['--terms']&&resolve(values['--terms']),
    recoveredDir:values['--recovered-dir']&&resolve(values['--recovered-dir']),
    port:values['--port']===undefined?8446:Number(values['--port'])});
  process.stdout.write('Merchant accounting workspace: '+app.url+'\n');
  const close=()=>app.close().then(()=>process.exit(0),error=>{console.error(error.message);process.exit(1);});
  process.once('SIGINT',close);process.once('SIGTERM',close);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});

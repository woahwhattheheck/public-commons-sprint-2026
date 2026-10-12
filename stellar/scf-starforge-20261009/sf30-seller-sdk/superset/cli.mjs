// MIT. Original source, review, publication, acquisition and receiving command line.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openSupersetWorkspace,receiveSupersetWorkspace} from './workspace.mjs';
import {readSupersetOperatorLaunch} from './launch.mjs';
import {readJson,object,fault,MiB} from './files.mjs';
const USAGE = `Superset report workspace

  starforge-merchant superset-workspace --directory PRIVATE_DIRECTORY [--workspace EXISTING_WORKSPACE] [--port PORT] [--runtime PRIVATE_JSON]
  starforge-merchant superset init|status --directory PRIVATE_DIRECTORY
  starforge-merchant superset source|capture|edition|review|compare|select|replay|prepare-merchant|publish|prepare-buyer|receive-buyer --directory PRIVATE_DIRECTORY --input PRIVATE_JSON [--connect]
  starforge-merchant superset inventory --directory PRIVATE_DIRECTORY --source ID [--kind chart|dashboard] [--page 0] [--page-size 25] [--dashboard ID] [--connect]
  starforge-merchant superset query --directory PRIVATE_DIRECTORY --edition ID [--input PRIVATE_QUERY_JSON] [--connect]
  starforge-merchant superset capture-detail --directory PRIVATE_DIRECTORY --capture ID [--query-ordinal 0] [--offset 0] [--limit 50] [--connect]
  starforge-merchant superset operation|cancel --directory PRIVATE_DIRECTORY --id OPERATION_ID [--connect]
  starforge-merchant superset record --directory PRIVATE_DIRECTORY --kind sources|captures|editions|reviews|comparisons|merchants|publications|buyers|deliveries --id ID [--connect]
  starforge-merchant superset export --directory PRIVATE_DIRECTORY --kind workspace|capture|comparison|csv|lineage [--id ID]
  starforge-merchant superset export-dataset --directory PRIVATE_DIRECTORY --edition ID --out NEW_PRIVATE_DIRECTORY
  starforge-merchant superset receive --file EXPORTED_SQLITE --directory NEW_PRIVATE_DIRECTORY
  starforge-merchant superset connect --directory PRIVATE_OPERATOR
  starforge-merchant superset buyer init|run|status|recover|deliver|export|accounting|finalize [original SF88 arguments]

Mutating JSON inputs include operationId and the displayed expectedRevision.
A repeated ID must retain identical input; an interrupted or failed original attempt
can be resumed with retry:true. Native credentials are environment references in the
source definition. --connect uses the running operator's private launch record.

Complete buyer execution uses the original page-budget, approval, signer, settlement
and recovery workflow. Run "starforge-merchant superset buyer --help" for its arguments.
`;
const ACTIONS=new Set(['source','capture','edition','review','compare','select','replay','prepare-merchant','publish','prepare-buyer','receive-buyer']);
const names=new Set(['directory','input','source','kind','page','page-size','dashboard','edition','capture','query-ordinal','offset','limit','id','out','file']);
function options(args){
  const out={};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--connect'){if(out.connect)throw new TypeError('Use --connect once.');out.connect=true;continue;}
    if(!args[i].startsWith('--')||!names.has(args[i].slice(2))||args[i+1]===undefined||args[i+1].startsWith('--')||Object.hasOwn(out,args[i].slice(2)))
      throw new TypeError('Use documented Superset options once; see --help.');
    out[args[i].slice(2)]=args[++i];
  }
  return out;
}
function number(value,fallback){const n=value===undefined?fallback:Number(value);if(!Number.isSafeInteger(n)||n<0)throw new TypeError('Use a nonnegative integer.');return n;}
async function connected(directory){
  const connection=await readSupersetOperatorLaunch({directory});
  return async(method,path,body)=>{
    const response=await fetch(new URL('/api/'+path,connection.url),{method,redirect:'error',
      headers:{authorization:'Bearer '+connection.token,...(body===undefined?{}:{'content-type':'application/json'})},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(300000)});
    if(!response.body)throw fault('SUPERSET_CONNECTED_RESPONSE','The running operator returned no response.',502);
    let size=0;const chunks=[];
    for await(const chunk of response.body){size+=chunk.length;if(size>256*MiB)throw fault('SUPERSET_CONNECTED_RESPONSE','The original response exceeds 256 MiB.',413);chunks.push(chunk);}
    let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}
    catch{throw fault('SUPERSET_CONNECTED_RESPONSE','The running operator returned invalid JSON.',502);}
    if(!response.ok)throw fault(result.error??'SUPERSET_CONNECTED_REQUEST',result.message??'The running operator rejected this request.',response.status);
    return result;
  };
}
export async function main(args=process.argv.slice(2),{print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n')}={}){
  const [command,...remaining]=args;
  if(!command||command==='--help'||command==='help'){process.stdout.write(USAGE);return null;}
  if(command==='buyer')return(await import('./customer.mjs')).runSupersetBuyer(remaining);
  if(command==='serve')return(await import('./server.mjs')).main(remaining);
  const opt=options(remaining);
  if(!opt.directory)throw new TypeError('Choose --directory PRIVATE_DIRECTORY.');
  const directory=resolve(opt.directory),input=opt.input?await readJson(resolve(opt.input),MiB):{};
  if(!object(input))throw new TypeError('The input must be a JSON object.');
  if(command==='connect'){
    const native=await readSupersetOperatorLaunch({directory});
    const result={url:native.url,...native.scope};print(result);return result;
  }
  if(command==='receive'){
    if(!opt.file||opt.connect)throw new TypeError('Choose --file EXPORTED_SQLITE and a new private receiving directory.');
    const result=await receiveSupersetWorkspace({file:resolve(opt.file),directory});print(result);return result;
  }
  let workspace,request;
  if(opt.connect)request=await connected(directory);
  else workspace=await openSupersetWorkspace({directory});
  try{
    let result;
    if(ACTIONS.has(command)){
      if(!opt.input)throw new TypeError('Use --input PRIVATE_JSON with a stable operationId and expectedRevision.');
      if(request)result=await request('POST','operations/'+command,input);
      else result=await workspace.dispatch(command,input);
    }else if(command==='init'||command==='status')result=request?await request('GET','state'):workspace.state();
    else if(command==='inventory'){
      const value={sourceId:opt.source,kind:opt.kind??'chart',page:number(opt.page,0),pageSize:number(opt['page-size'],25),...(opt.dashboard?{dashboardId:number(opt.dashboard)}:{})};
      result=request?await request('POST','inventory',value):await workspace.inventory(opt.source,value);
    }else if(command==='query')result=request?await request('POST','query',{editionId:opt.edition,query:input}):await workspace.query(opt.edition,input);
    else if(command==='capture-detail'){
      const page={queryOrdinal:number(opt['query-ordinal'],0),offset:number(opt.offset,0),limit:number(opt.limit,50)};
      result=request?await request('GET','capture/'+encodeURIComponent(opt.capture)+'?'+new URLSearchParams(page)):workspace.captureDetail(opt.capture,page);
    }else if(command==='record')result=request?await request('GET','records/'+encodeURIComponent(opt.kind)+'/'+encodeURIComponent(opt.id)):workspace.get(opt.kind,opt.id);
    else if(command==='operation')result=request?await request('GET','operations/'+encodeURIComponent(opt.id)):workspace.operation(opt.id);
    else if(command==='cancel')result=request?await request('POST','cancel/'+encodeURIComponent(opt.id),{}):workspace.cancel(opt.id);
    else if(command==='export'){
      if(request)throw new TypeError('Download complete exports in the running browser, or close it and run this command.');
      result=await workspace.exportFile(opt.kind,opt.id);
    }else if(command==='export-dataset'){
      if(request||!opt.out)throw new TypeError('Close the browser and choose --out NEW_PRIVATE_DIRECTORY.');
      result=await workspace.exportDataset(opt.edition,resolve(opt.out));
    }else throw new TypeError('Unknown Superset command; see --help.');
    print(result);
    if(result?.status==='FAILED'||result?.status==='CANCELLED'||result?.status==='INTERRUPTED')process.exitCode=2;
    return result;
  }finally{await workspace?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write((error.code??'SUPERSET_COMMAND_FAILED')+': '+error.message+'\n');process.exitCode=1;});

// MIT. CLI for the ORIGINAL running merchant workspace; no second state writer.
import { constants } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readPrivate, privateDirectory, createFile, bytes, fault } from '../../postgres/publisher/files.mjs';

const PATHS={
  editions:['GET','workbook/editions/list'],
  'edition-suggest':['POST','workbook/editions/suggest'],'edition-compare':['POST','workbook/editions/compare'],
  'edition-read':['POST','workbook/editions/read'],'edition-apply':['POST','workbook/editions/apply'],
  'edition-export':['POST','workbook/editions/export'],
  status:['GET','status'],upload:['PUT','workbook'],inspect:['POST','workbook/inspect'],
  plan:['POST','workbook/plan'],prepare:['POST','workbook/prepare'],remove:['POST','workbook/remove'],
  download:['POST','workbook/download'],export:['POST','workbook/export'],
  review:['POST','draft/export'],select:['POST','draft/select'],preview:['POST','preview'],
  publish:['POST','publish'],activate:['POST','activate'],'buyer-offer':['POST','buyer-offer'],
  'buyer-prepare':['POST','buyer-prepare'],buyer:['POST','buyer-saved']};
const BINARY=new Set(['download','export','edition-export']);
const JSON_INPUT=new Set(['plan','publish','activate','buyer-prepare','edition-suggest','edition-compare','edition-apply']);
const json=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
async function sessionFrom(path){
  let value;
  try{value=json(await readPrivate(resolve(path),16384));}
  catch(e){if(e.code)throw e;throw fault('INVALID_WORKSPACE_SESSION','Use the private JSON session file written by the running workspace.');}
  const url=new URL(value.origin);
  if(value.schema!=='stellar-forge.dataset-publisher-session.v1'||url.protocol!=='http:'||
    url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash||
    url.origin!==value.origin||!/^[A-Za-z0-9_-]{43}$/.test(value.token??''))
    throw fault('INVALID_WORKSPACE_SESSION','Use this running workspace’s exact private loopback session file.');
  return value;
}
async function responseJSON(response){
  let size=0,chunks=[];
  for await(const chunk of response.body){
    size+=chunk.length;if(size>16*1024**2)throw fault('WORKSPACE_RESPONSE_CAPACITY','Select a smaller original source inspection.');
    chunks.push(chunk);
  }
  let value;try{value=json(Buffer.concat(chunks));}catch{throw fault('WORKSPACE_RESPONSE_INVALID','The running workspace did not return its complete JSON response.');}
  if(!response.ok)throw Object.assign(fault(value.error??'WORKSPACE_ACTION_FAILED',value.message??'The running workspace rejected this action.',response.status),{details:value.details});
  return value;
}
/** Call only the existing authenticated local workspace. The caller supplies all
 * reviewed pins and receives the original source/merchant result unchanged. */
export async function callWorkbookWorkspace({sessionFile,action,payload,file,output}){
  if(!Object.hasOwn(PATHS,action))throw fault('INVALID_WORKBOOK_COMMAND','Choose a documented original workspace operation.');
  const session=await sessionFrom(sessionFile),[method,path]=PATHS[action];
  const headers={authorization:'Bearer '+session.token};let handle,body,inputStat;
  try{
    if(action==='upload'){
      if(typeof file!=='string')throw fault('WORKBOOK_FILE_REQUIRED');
      handle=await open(resolve(file),constants.O_RDONLY|(constants.O_NOFOLLOW??0));inputStat=await handle.stat();
      if(!inputStat.isFile()||inputStat.size<1||inputStat.size>64*1024**2)
        throw fault('WORKBOOK_TOO_LARGE','Choose an original XLSX regular file up to 64 MiB.');
      headers['content-type']='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      headers['content-length']=String(inputStat.size);headers['x-upload-name']=encodeURIComponent(basename(file));
      body=handle.createReadStream({autoClose:false});
    }else if(method==='POST'){
      body=JSON.stringify(payload??{});if(Buffer.byteLength(body)>2*1024**2)throw fault('WORKBOOK_REQUEST_CAPACITY');
      headers['content-type']='application/json';
    }
    const response=await fetch(session.origin+'/api/'+path,{method,headers,body,
      ...(action==='upload'?{duplex:'half'}:{}),redirect:'error',signal:AbortSignal.timeout(150000)});
    if(action==='upload'){
      const after=await handle.stat();
      if(after.size!==inputStat.size||after.mtimeMs!==inputStat.mtimeMs||after.ctimeMs!==inputStat.ctimeMs){
        await response.body.cancel();
        throw fault('WORKBOOK_INPUT_CHANGED','The selected upload changed during transmission. Inspect the server’s actual retained source before proceeding.',409);
      }
    }
    if(!BINARY.has(action)||!response.ok)return await responseJSON(response);
    if(typeof output!=='string'){await response.body.cancel();throw fault('OUTPUT_REQUIRED','Select a private output path for original source downloads.');}
    const pathOut=resolve(output);await privateDirectory(dirname(pathOut));
    const destination=await open(pathOut,'wx',0o600),hash=createHash('sha256');let written=0,success=false;
    try{
      const maximum=512*1024**2,length=response.headers.get('content-length');
      if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maximum))throw fault('WORKBOOK_DOWNLOAD_CAPACITY');
      for await(const chunk of response.body){
        written+=chunk.length;if(written>maximum)throw fault('WORKBOOK_DOWNLOAD_CAPACITY');
        hash.update(chunk);await destination.writeFile(chunk);
      }
      if(length!==null&&written!==Number(length))throw fault('WORKBOOK_DOWNLOAD_INCOMPLETE');
      await destination.sync();success=true;
      return {path:pathOut,bytes:written,sha256:hash.digest('hex'),contentType:response.headers.get('content-type')};
    }finally{await destination.close();if(!success)await rm(pathOut,{force:true});}
  }finally{await handle?.close();}
}
const HELP="Workbook intake in the running dataset publisher\n\nStart the existing merchant workspace with an unused private session filename:\n  starforge dataset-publisher --state /private/dataset --port 8431 \\\n    --workspace /private/publisher --session-file /private/publisher-session.json \\\n    --workbook-python python3\n\nThe session file is mode0600 and removed on owned shutdown. Reopen the original\nworkspace to retain sources/plans/candidates; each local session gets a new token.\nWorkbook CLI never opens another publisher or writes the dataset version store.\n\n  starforge dataset-publisher workbook status --session-file FILE\n  starforge dataset-publisher workbook upload --session-file FILE --file original.xlsx\n  starforge dataset-publisher workbook inspect --session-file FILE --source UUID \\\n    --sheet \"Sheet name\" --range A1:G40 [--offset 0] [--limit 25]\n  starforge dataset-publisher workbook plan --session-file FILE --input review.json\n  starforge dataset-publisher workbook prepare --session-file FILE --source UUID \\\n    --plan UUID --plan-revision 1\n  starforge dataset-publisher workbook review --session-file FILE --candidate UUID\n  starforge dataset-publisher workbook preview --session-file FILE \\\n    --target draft:UUID --query \"limit=5\"\n  starforge dataset-publisher workbook publish --session-file FILE --input publication.json\n  starforge dataset-publisher workbook activate --session-file FILE --input rollback.json\n  starforge dataset-publisher workbook buyer-offer --session-file FILE \\\n    --target SNAPSHOT --query \"limit=5\"\n  starforge dataset-publisher workbook buyer-prepare --session-file FILE --input buyer.json\n  starforge dataset-publisher workbook buyer --session-file FILE --id UUID\n  starforge dataset-publisher workbook download --session-file FILE --source UUID --out FILE\n  starforge dataset-publisher workbook export --session-file FILE --candidate UUID --out FILE\n  starforge dataset-publisher workbook remove --session-file FILE --source UUID --source-revision N\n\nWorkbook updates in this same retained workspace:\n  starforge dataset-publisher workbook editions --session-file FILE\n  starforge dataset-publisher workbook edition-suggest --session-file FILE --input selection.json\n  starforge dataset-publisher workbook edition-compare --session-file FILE --input comparison.json\n  starforge dataset-publisher workbook edition-read --session-file FILE --id UUID \\\n    [--offset 0] [--limit 50] [--kind all]\n  starforge dataset-publisher workbook edition-apply --session-file FILE --input adoption.json\n  starforge dataset-publisher workbook edition-export --session-file FILE --id UUID --out FILE\n\nComparisons read both complete original projections, retain every row and reopen\nby their original ID. Row kinds: all, added, removed, changed, source, unchanged,\nmoved. Apply the displayed comparison identity and captured revisions, then use\nthe original prepare/review/publish/buyer commands above.\n\n--input files contain the exact documented API object, including captured source,\nplan and native revision pins. JSON outputs may use --out FILE. Existing files are\nnever overwritten. Source bundle/download and JSON outputs use private directories.\nOnly inspect/source selection reads original workbook cells. The native dataset,\npublication and buyer preparation retain their existing authority and results.";
export async function main(args=process.argv.slice(2)){
  if(args.length===0||args.length===1&&args[0]==='--help'){console.log(HELP);return;}
  const command=args[0],options={};
  if(!Object.hasOwn(PATHS,command))throw fault('INVALID_WORKBOOK_COMMAND','Use workbook --help.');
  const permitted=new Set(['--session-file','--out',...(command==='upload'?['--file']:[]),
    ...(JSON_INPUT.has(command)?['--input']:[]),...(['inspect','prepare','remove','download'].includes(command)?['--source']:[]),
    ...(command==='inspect'?['--sheet','--range','--offset','--limit']:[]),
    ...(command==='prepare'?['--plan','--plan-revision']:[]),...(command==='remove'?['--source-revision']:[]),
    ...(['review','select','export'].includes(command)?['--candidate']:[]),
    ...(['preview','buyer-offer'].includes(command)?['--target','--query']:[]),...(['buyer','edition-read','edition-export'].includes(command)?['--id']:[]),
    ...(command==='edition-read'?['--offset','--limit','--kind']:[])]);
  for(let i=1;i<args.length;i+=2){
    if(!permitted.has(args[i])||Object.hasOwn(options,args[i])||args[i+1]===undefined||args[i+1].startsWith('--'))
      throw fault('INVALID_WORKBOOK_OPTIONS','Use the exact options shown by workbook --help.');
    options[args[i]]=args[i+1];
  }
  const required=name=>{const value=options[name];if(!value)throw fault('WORKBOOK_OPTION_REQUIRED',name+' is required.');return value;};
  const integer=(name,fallback)=>{
    const value=options[name]??fallback;
    if(!/^(0|[1-9][0-9]*)$/.test(String(value))||!Number.isSafeInteger(Number(value)))
      throw fault('INVALID_WORKBOOK_OPTIONS',name+' must be a whole number.');
    return Number(value);
  };
  const sessionFile=required('--session-file');let payload;
  if(JSON_INPUT.has(command))payload=json(await readPrivate(resolve(required('--input')),2*1024**2));
  else if(command==='inspect')payload={id:required('--source'),sheet:required('--sheet'),range:required('--range'),
    offset:integer('--offset',0),limit:integer('--limit',25)};
  else if(command==='prepare')payload={id:required('--source'),planId:required('--plan'),expectedPlanRevision:integer('--plan-revision')};
  else if(command==='remove')payload={id:required('--source'),expectedSourceRevision:integer('--source-revision')};
  else if(command==='download')payload={id:required('--source')};
  else if(command==='export')payload={candidateId:required('--candidate')};
  else if(command==='review'||command==='select')payload={id:required('--candidate')};
  else if(command==='preview'||command==='buyer-offer')payload={target:required('--target'),query:options['--query']??''};
  else if(command==='buyer'||command==='edition-export')payload={id:required('--id')};
  else if(command==='edition-read')payload={id:required('--id'),offset:integer('--offset',0),limit:integer('--limit',50),kind:options['--kind']??'all'};
  if(command==='upload')required('--file');
  if(BINARY.has(command))required('--out');
  const result=await callWorkbookWorkspace({sessionFile,action:command,payload,file:options['--file'],output:options['--out']});
  if(options['--out']&&!BINARY.has(command)){
    const output=resolve(options['--out']);await privateDirectory(dirname(output));await createFile(output,bytes(result));
    console.log(JSON.stringify({path:output,bytes:bytes(result).length}));
  }else console.log(JSON.stringify(result,null,2));
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{
    console.error(JSON.stringify({error:error.code??'WORKBOOK_COMMAND_FAILED',message:error.message,details:error.details}));
    process.exitCode=1;
  });

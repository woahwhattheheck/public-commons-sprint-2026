#!/usr/bin/env node
// MIT. Native commands use the same original workspace as the local operator UI.
import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openGrantsWorkspace } from './workspace.mjs';
import { grantsAction, startGrantsServer } from './server.mjs';

const HELP = 'Grants.gov opportunity workspace\n\n'+
'node grantsgov/cli.mjs <command> --workspace /private/grants [options]\n\n'+
'  init | status                    Open or inspect the original workspace\n'+
'  serve [--port 0]                  Start the private local operator UI\n'+
'  action --action NAME --input JSON_FILE\n'+
'                                   Run any documented native workspace action\n'+
'  query --name NAME --keyword WORDS [--statuses posted,forecasted]\n'+
'                                   Save a search (new query revision zero)\n'+
'  capture --query ID [--revision N] [--operation ID]\n'+
'                                   Retain every page and full notice detail\n'+
'  resume --capture ID               Resume the same original acquisition\n'+
'  import --file CAPTURE_JSON        Receive a complete original source capture\n'+
'  receive --file EDITION_JSON       Receive an edition and its qualification\n'+
'  restore --file WORKSPACE_JSON     Receive a research backup into an empty workspace\n'+
'  edition --capture ID --name NAME [--ids ID,ID]\n'+
'  opportunities --edition ID [--search TEXT] [--offset N] [--limit N]\n'+
'  opportunity --edition ID --id ID\n'+
'  review --edition ID --id ID --revision N --file REVIEW_JSON\n'+
'  compare --before ID --after ID\n'+
'  export --kind KIND --out FILE [--edition ID] [--capture ID] [--merchant ID] [--id ID]\n'+
'  download --id EXPORT_SHA --out FILE\n'+
'  merchant --edition ID [--file CONFIG_JSON]\n'+
'  preview --merchant ID [--file QUERY_JSON]\n\n'+
'Use --request ID to replay a mutation with exactly the same input.\n'+
'Use --buyers HOST_BINDINGS_JSON for native customer workspace aliases.\n'+
'Export kinds: workspace, edition, capture, merchant, comparison, workshare-md, workshare-html.\n'+
'Complete API and publishing inputs are documented in README.md.\n';
function args(argv) {
  const values={_:[]};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(!key.startsWith('--')){values._.push(key);continue;}
    if(key==='--help'){values.help=true;continue;}
    if(i+1>=argv.length||argv[i+1].startsWith('--'))throw Error('A value is required for '+key);
    if(Object.hasOwn(values,key.slice(2)))throw Error('Duplicate option '+key);
    values[key.slice(2)]=argv[++i];
  }
  return values;
}
function required(value,name){if(!value)throw Error('Supply --'+name);return value;}
function number(value,fallback){return value===undefined?fallback:Number(value);}
const readJSON=async path=>JSON.parse(await readFile(resolve(path),'utf8'));
async function outputFile(path,data){
  path=resolve(required(path,'out'));await mkdir(dirname(path),{recursive:true,mode:0o700});
  const handle=await open(path,'wx',0o600);try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
  return path;
}
async function download(workspace,id,path){
  const first=await workspace.readExport(id,{offset:0,limit:8*1024*1024});
  const target=resolve(required(path,'out'));await mkdir(dirname(target),{recursive:true,mode:0o700});
  const handle=await open(target,'wx',0o600);let next=0;
  try{
    let part=first;
    while(true){
      await handle.write(Buffer.from(part.data,'base64'),0,part.bytesRead,next);next+=part.bytesRead;
      if(part.nextOffset===null)break;
      part=await workspace.readExport(id,{offset:part.nextOffset,limit:8*1024*1024});
    }
    await handle.sync();
  }finally{await handle.close();}
  return {file:target,bytes:first.file.bytes,sha256:first.file.sha256,exportId:id};
}
export async function main(argv=process.argv.slice(2)){
  const options=args(argv),command=options._[0]??'help';
  if(options.help||command==='help'){process.stdout.write(HELP);return;}
  const directory=resolve(required(options.workspace,'workspace'));
  const buyerWorkspaces=options.buyers?await readJSON(options.buyers):[];
  if(command==='serve'){
    const server=await startGrantsServer({directory,port:number(options.port,0),buyerWorkspaces});
    process.stdout.write(JSON.stringify({url:server.url,workspace:directory,pid:process.pid})+'\n');
    let stopping=false;
    const close=async()=>{if(stopping)return;stopping=true;await server.close();process.exitCode=0;};
    process.once('SIGINT',close);process.once('SIGTERM',close);
    return;
  }
  const workspace=await openGrantsWorkspace({directory,buyerWorkspaces});
  const requestId=options.request??'request-'+randomUUID();
  let runningCapture,retainedRelease=false;
  const abort=()=>{if(runningCapture)void workspace.pauseCapture(runningCapture);};
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
    let result;
    if(command==='init'||command==='status')result=await workspace.snapshot();
    else if(command==='action'){
      const action=required(options.action,'action'),input=options.input?await readJSON(options.input):{};
      result=await grantsAction(workspace,action,input);
      if(action==='publisher.release.start')retainedRelease=true;
      if(action==='capture.start'){runningCapture=result.id;result=await workspace.waitCapture(result.id);}
    }else if(command==='query'){
      const input=options.file?await readJSON(options.file):{
        keyword:options.keyword??'',opportunityNumber:options.number??'',
        statuses:(options.statuses??'posted,forecasted').split(',').filter(Boolean),
        agencies:(options.agencies??'').split(',').filter(Boolean),
        eligibilities:(options.eligibilities??'').split(',').filter(Boolean),
        pageSize:number(options['page-size'],25)
      };
      result=await workspace.querySave({requestId,id:options.id,expectedRevision:number(options.revision,0),
        name:required(options.name,'name'),definition:input});
    }else if(command==='capture'||command==='resume'){
      let input;
      if(command==='resume')input={requestId,captureId:required(options.capture,'capture')};
      else{
        const queryId=required(options.query,'query'),state=await workspace.snapshot();
        const query=state.queries.find(value=>value.id===queryId);
        input={requestId,queryId,expectedRevision:number(options.revision,query?.revision),
          operationId:options.operation??requestId};
      }
      result=await workspace.startCapture(input);runningCapture=result.id;
      result=await workspace.waitCapture(result.id);
      if(!['complete','partial'].includes(result.status))process.exitCode=2;
    }else if(command==='import'||command==='receive'||command==='restore'){
      const packet=await readJSON(required(options.file,'file')),input={requestId,packet,name:options.name??'Received grant research'};
      result=command==='import'?await workspace.importOriginal(input):
        command==='receive'?await workspace.receiveEdition(input):await workspace.restore(input);
    }else if(command==='edition')result=await workspace.createEdition({requestId,captureId:required(options.capture,'capture'),
      name:required(options.name,'name'),opportunityIds:options.ids?.split(',').filter(Boolean),parentId:options.parent});
    else if(command==='opportunities')result=await workspace.rows(required(options.edition,'edition'),{
      search:options.search??'',status:options.status,agency:options.agency,closingFrom:options.from,closingTo:options.to,
      sort:options.sort??'closing_date',direction:options.direction??'asc',offset:number(options.offset,0),limit:number(options.limit,50)});
    else if(command==='opportunity')result=await workspace.opportunity(required(options.edition,'edition'),required(options.id,'id'));
    else if(command==='review')result=await workspace.reviewSave({requestId,editionId:required(options.edition,'edition'),
      opportunityId:required(options.id,'id'),expectedRevision:number(options.revision,0),review:await readJSON(required(options.file,'file'))});
    else if(command==='compare')result=await workspace.compare(required(options.before,'before'),required(options.after,'after'),
      {offset:number(options.offset,0),limit:number(options.limit,250)});
    else if(command==='merchant')result=await workspace.merchant({...(options.file?await readJSON(options.file):{}),requestId,
      editionId:required(options.edition,'edition')});
    else if(command==='preview')result=await workspace.merchantPreview(required(options.merchant,'merchant'),
      options.file?await readJSON(options.file):{limit:5});
    else if(command==='export'){
      const descriptor=await workspace.exportFile({kind:required(options.kind,'kind'),editionId:options.edition,
        captureId:options.capture,merchantId:options.merchant,opportunityId:options.id,before:options.before,after:options.after,
        includeReviews:true});
      result=await download(workspace,descriptor.id,options.out);
    }else if(command==='download')result=await download(workspace,required(options.id,'id'),options.out);
    else throw Error('Unknown command '+command+'. Use --help.');
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }finally{
    process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);
    if(retainedRelease){const close=()=>void workspace.close();process.once('SIGINT',close);process.once('SIGTERM',close);}
    else await workspace.close();
  }
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'GRANTS_COMMAND_FAILED',message:error.message}})+'\n');process.exitCode=1;});

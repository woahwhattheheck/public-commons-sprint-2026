import {parseArgs} from 'node:util';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {CommissioningWorkspace} from './workspace.mjs';
import * as nativeEngine from './native/index.mjs';
import {createHandover,inspectHandover,resumeHandover} from './packaging.mjs';
export async function main(argv=process.argv.slice(2)){
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,options:{workspace:{type:'string'},input:{type:'string'},id:{type:'string'},edition:{type:'string'},baseline:{type:'string'},candidate:{type:'string'},file:{type:'string'},path:{type:'string'},label:{type:'string'},revision:{type:'string'},'include-operator-private':{type:'boolean'},python:{type:'string'}}});
  const command=positionals[0];
  if(!command||command==='help')return {usage:'node cli.mjs COMMAND --workspace /absolute/path [--input complete-request.json]',commands:['init','configure','intake','selection','draft','select-draft','manifest','file','edit','seal','compare','review','plan','run','inspect','operation','state','snapshot','package','inspect-handover','resume-handover','content-exports'],examples:{intake:'{"projectRoot":"/opt/full-jaffle-shop-demo","label":"Original source","operationId":"source-jaffle-001"}',plan:'{"operationId":"jaffle-preview-001","action":"start-preview","editionId":"YOUR_SEALED_EDITION_ID","input":{"name":"commissioning-jaffle","expiresInHours":24}}'}};
  if(!values.workspace)throw new Error('--workspace is required.');
  const input=values.input?JSON.parse(await fs.readFile(values.input,'utf8')):{};
  const revision=values.revision===undefined?input.expectedRevision:Number(values.revision);
  const workspace=await CommissioningWorkspace.open(values.workspace,{create:command==='init',label:values.label??input.label,engine:nativeEngine});
  try{
    if(command==='init'||command==='state')return await workspace.state();
    if(command==='configure')return workspace.configure(input,revision);
    if(command==='intake')return await workspace.captureProject(input,revision);
    if(command==='selection')return workspace.selectEditions(input,revision);
    if(command==='draft')return await workspace.createDraft(values.edition??input.editionId,revision);
    if(command==='select-draft')return workspace.selectDraft(values.id??input.id,revision);
    if(command==='manifest')return values.edition?await workspace.editionManifest(values.edition):await workspace.draftManifest({expectedDraftId:input.expectedDraftId});
    if(command==='file'){const selected=await workspace.readSource({editionId:values.edition,draft:!values.edition,expectedDraftId:input.expectedDraftId,path:values.path??input.path});return {...selected,content:selected.content??new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(selected.absolutePath))};}
    if(command==='edit'){if(values.file)input.content=await fs.readFile(values.file,'utf8');if(values.path)input.path=values.path;return await workspace.editDraft(input,revision);}
    if(command==='seal')return await workspace.sealDraft(input,revision);
    if(command==='compare')return await workspace.compare(values.baseline??input.baselineId,values.candidate??input.candidateId);
    if(command==='review')return workspace.saveReview(input,revision);
    if(command==='plan')return await workspace.plan(input,revision);
    if(command==='run'||command==='inspect')return await workspace.execute(values.id??input.operationId,{inspect:command==='inspect'});
    if(command==='operation')return workspace.operation(values.id??input.operationId);
    if(command==='content-exports')return await workspace.contentExports(values.id??input.operationId);
    if(command==='snapshot')return await workspace.saveSnapshot();
    if(command==='inspect-handover')return await inspectHandover({workspace,id:values.id??input.id,python:values.python});
    if(command==='resume-handover')return await resumeHandover({workspace,id:values.id??input.id,python:values.python});
    if(command==='package')return await createHandover({workspace,id:values.id??input.id,python:values.python,expectedRevision:revision,includeOperatorPrivate:values['include-operator-private']===true});
    throw new Error('Unknown command: '+command+'. Run help for complete supported operations.');
  }finally{workspace.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error=>{process.stderr.write(JSON.stringify({state:'FAILED',error:{message:error.message,code:error.code??null}})+'\n');process.exitCode=1;});

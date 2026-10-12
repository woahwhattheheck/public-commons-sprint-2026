// MIT. USAspending in the original installed Applications lifecycle.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute, need, plain, digest, json, canonical } from './storage.mjs';

const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending';
const STARTUP='stellar-forge.usaspending-application-startup.v1';
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
const hash=value=>digest(json(canonical(value)));

export function usaspendingApplication(common) {
  return {id:'usaspending',command:'usaspending-application',title:'Federal awards and workshares',terminal:false,
    requiredSource:SOURCE+'/application.mjs',
    description:'Capture and compare federal awards and modifications, prepare complete prime workshares, and reopen original sources, assessments and customer receiving.',
    fields:[
      field('workspaceDirectory','Private research workspace','path',true,
        'Choose the existing research folder, or a new folder under a private parent. Awards, transactions, assessments and receiving history stay together.'),
      field('receivingRoot','Customer delivery folder','path',false,
        'Optional private folder containing original customer deliveries to receive through the award workspace.'),
      field('operator','Operator name','text',false,
        'Recorded on saved assessments and workspace operations. Defaults to Local operator.'),
      ...common,
    ]};
}
function sameDirectory(original,input) {
  return original.path===input.path&&original.exists===input.exists&&
    (!original.exists||(original.dev===String(input.dev)&&original.ino===String(input.ino)));
}
export async function prepareUSASpendingApplication(settings,{inputPath,runtimeDirectory}={}) {
  need(typeof inputPath==='function','APPLICATION_USASPENDING_INPUT_READER_REQUIRED');
  const workspace=await inputPath(absolute(settings.workspaceDirectory),'directory',true,true);
  const receiving=settings.receivingRoot?await inputPath(absolute(settings.receivingRoot),'directory',true,true):null;
  const { inspectMerchantRuntime }=await import('../../sf46-release/runtime-package.mjs');
  const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false});
  const native=await import(pathToFileURL(join(runtime.sourceRoot,SOURCE,'application.mjs')).href);
  need(typeof native.prepareUSASpendingSelection==='function'&&
    typeof native.verifyUSASpendingStartup==='function'&&Array.isArray(native.USASPENDING_APPLICATION_FILES),
    'APPLICATION_USASPENDING_NATIVE_READER_REQUIRED');
  const selection=await native.prepareUSASpendingSelection({
    workspaceDirectory:workspace.path,receivingRoot:receiving?.path,
    operator:settings.operator??'Local operator',sourceRoot:runtime.sourceRoot,
  });
  need(sameDirectory(selection.workspace.directory,workspace)&&
    (!receiving||sameDirectory(selection.receiving,receiving)),'APPLICATION_USASPENDING_WORKSPACE_CHANGED');
  const inputs=[workspace,...(receiving?[receiving]:[])];
  for(const file of selection.source.files) {
    const original=await inputPath(join(runtime.sourceRoot,file.path),'file');
    need(original.sha256===file.sha256&&original.bytes===file.bytes,'APPLICATION_USASPENDING_SOURCE_CHANGED');
    inputs.push(original);
  }
  const args=['serve','--workspace',workspace.path,'--operator',selection.operator,
    '--managed-selection',JSON.stringify(selection)];
  if(receiving)args.push('--receiving-root',receiving.path);
  const createDirectories=[workspace,receiving].filter(value=>value&&!value.exists).map(value=>value.path);
  return {args,inputs,createDirectories,
    resourceKey:hash({family:'usaspending-workspace',directory:workspace.path})};
}
function option(request,name,optional=false) {
  need(Array.isArray(request.args),'APPLICATION_USASPENDING_STARTUP_CHANGED');
  const positions=request.args.flatMap((value,index)=>value===name?[index]:[]);
  if(optional&&positions.length===0)return undefined;
  need(positions.length===1&&typeof request.args[positions[0]+1]==='string','APPLICATION_USASPENDING_STARTUP_CHANGED');
  return request.args[positions[0]+1];
}
export async function usaspendingStartup(request,text,context={}) {
  if(request.command!=='usaspending-application'||request.pythonCommand||request.args?.[0]!=='serve'||
    typeof text!=='string'||text.length>32768||!text.startsWith('{"schema":"'+STARTUP+'",'))return null;
  let startup,selection;
  try{startup=JSON.parse(text);selection=JSON.parse(option(request,'--managed-selection'));}
  catch{need(false,'APPLICATION_USASPENDING_STARTUP_CHANGED');}
  need(plain(startup)&&plain(selection)&&plain(selection.workspace)&&plain(selection.workspace.directory)&&
    selection.workspace.directory.path===absolute(option(request,'--workspace'))&&
    (selection.receiving?.path??undefined)===option(request,'--receiving-root',true)&&
    selection.operator===option(request,'--operator'),'APPLICATION_USASPENDING_STARTUP_CHANGED');
  const rawPort=option(request,'--port',true)??'0';
  need(/^(0|[1-9]\d*)$/.test(rawPort),'APPLICATION_USASPENDING_STARTUP_CHANGED');
  const launchSourceRoot=join(absolute(request.releaseDirectory),'source');
  const native=await import(pathToFileURL(join(launchSourceRoot,SOURCE,'application.mjs')).href);
  return native.verifyUSASpendingStartup(startup,{
    selection,launchSourceRoot,port:Number(rawPort),...(context.pid?{pid:context.pid}:{}),
  });
}

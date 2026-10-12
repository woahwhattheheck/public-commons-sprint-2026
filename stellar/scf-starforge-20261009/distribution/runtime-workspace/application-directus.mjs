// MIT. The original Directus collection operator in managed Applications.
import {realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {absolute,plain,need,digest,json,canonical} from './storage.mjs';

const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/directus';
const STARTUP='stellar-forge.directus-operator-launch.v1';
const HASH=/^[a-f0-9]{64}$/;
const field=(name,label,required=false,description='')=>({name,label,type:'path',required,description});

export function directusApplication(common=[]) {
  return {
    id:'directus-workspace',command:'directus-workspace',title:'Directus collection data',terminal:false,
    requiredSource:SOURCE+'/launch.mjs',
    description:'Reopen authenticated collection captures, native fields and relations, selected editions, named reviews, comparisons and complete customer transfers.',
    fields:[
      field('directory','Private collection operator',true,
        'Reopen the original operator folder, or choose one new folder in an existing private parent.'),
      field('workspaceDirectory','Existing collection workspace',false,
        'Optional original workspace for a new operator. Saved operators keep their original projects and selection.'),
      ...common,
    ],
  };
}

export async function prepareDirectusApplication(settings,{inputPath,runtimeDirectory}={}) {
  need(typeof inputPath==='function','APPLICATION_DIRECTUS_INPUT_READER_REQUIRED');
  const operator=await inputPath(settings.directory,'directory',true,true);
  const workspace=settings.workspaceDirectory
    ?await inputPath(settings.workspaceDirectory,'directory',false,true):null;
  const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false,source:false});
  const native=await realpath(join(runtime.sourceRoot,SOURCE));
  const original=await import(pathToFileURL(join(native,'launch.mjs')).href);
  need(typeof original.inspectDirectusOperatorSelection==='function'&&typeof original.readDirectusOperatorLaunch==='function',
    'APPLICATION_DIRECTUS_LAUNCH_READER_REQUIRED','Choose a runtime containing the managed collection operator.');
  const selected=await original.inspectDirectusOperatorSelection({
    directory:operator.path,workspaceDirectory:workspace?.path,sourceDirectory:native,
  });
  need(selected.selection?.directory===operator.path&&selected.selection?.sourceDirectory===native&&
    selected.selection?.workspaceDirectory===(workspace?.path??null)&&HASH.test(selected.selectionSha256??'')&&
    Array.isArray(selected.sourceFiles),'APPLICATION_DIRECTUS_SOURCE_SELECTION_CHANGED');
  const inputs=[operator,...(workspace?[workspace]:[])];
  for(const file of selected.sourceFiles)inputs.push(await inputPath(file,'file'));
  const args=['--directory',operator.path,'--source-directory',native,
    '--expected-selection-sha256',selected.selectionSha256,'--startup-format','managed'];
  if(workspace)args.push('--workspace',workspace.path);
  return {args,inputs,createDirectories:operator.exists?[]:[operator.path],
    resourceKey:digest(json(canonical({family:'directus-operator',directory:operator.path})))};
}

function selection(request) {
  need(Array.isArray(request.args)&&request.args.length%2===0,'APPLICATION_DIRECTUS_STARTUP_CHANGED');
  const options=new Map(),allowed=new Set(['--directory','--workspace','--source-directory',
    '--expected-selection-sha256','--startup-format','--port']);
  for(let index=0;index<request.args.length;index+=2) {
    const name=request.args[index],value=request.args[index+1];
    need(allowed.has(name)&&!options.has(name)&&typeof value==='string'&&value.length>0,
      'APPLICATION_DIRECTUS_STARTUP_CHANGED');
    options.set(name,value);
  }
  for(const key of ['--directory','--source-directory','--expected-selection-sha256','--startup-format'])
    need(options.has(key),'APPLICATION_DIRECTUS_STARTUP_CHANGED');
  need(options.get('--startup-format')==='managed'&&HASH.test(options.get('--expected-selection-sha256')),
    'APPLICATION_DIRECTUS_STARTUP_CHANGED');
  const port=options.get('--port')??'0';
  need(/^(0|[1-9][0-9]*)$/.test(port)&&Number(port)<=65535,'APPLICATION_DIRECTUS_PORT_CHANGED');
  return {directory:absolute(options.get('--directory')),sourceDirectory:absolute(options.get('--source-directory')),
    workspaceDirectory:options.has('--workspace')?absolute(options.get('--workspace')):null,
    selectionSha256:options.get('--expected-selection-sha256'),port:Number(port)};
}

export async function directusStartup(request,text) {
  if(request.command!=='directus-workspace'||typeof text!=='string'||text.length>32768||
    !text.startsWith('{"schema":"'+STARTUP+'",'))return null;
  let announcement;
  try{announcement=JSON.parse(text);}catch{return null;}
  if(!plain(announcement)||announcement.schema!==STARTUP||announcement.state!=='running')return null;
  const selected=selection(request);
  need(announcement.directory===selected.directory&&announcement.sourceDirectory===selected.sourceDirectory&&
    announcement.workspaceDirectory===selected.workspaceDirectory&&announcement.selectionSha256===selected.selectionSha256,
    'APPLICATION_DIRECTUS_STARTUP_CHANGED','The original collection operator differs from the reviewed application.');
  const original=await import(pathToFileURL(join(selected.sourceDirectory,'launch.mjs')).href);
  const connected=await original.readDirectusOperatorLaunch({
    directory:selected.directory,instanceId:announcement.instanceId,
    executionSourceDirectory:join(absolute(request.releaseDirectory),'source',SOURCE),
    selectionSha256:selected.selectionSha256,announcement,
  });
  const url=new URL(connected.url);
  need(!selected.port||Number(url.port||80)===selected.port,'APPLICATION_DIRECTUS_PORT_CHANGED');
  return {url:connected.url,original:connected.launch};
}

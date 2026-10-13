// MIT. Named Workbook selections over the original installed Python commands.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { open, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { absolute, canonical, digest, json, need, plain, regular, makePrivate, privateDirectory } from '../runtime-workspace/storage.mjs';
import { bindPythonApplicationCommand } from './command-binding.mjs';

const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
const installation=field('installationId','Installed Python environment','text',true,'Choose the retained Python installation.');
const environment=field('environmentFile','Private environment JSON','path');
const original='stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/';
const deliveryFields=[installation,
  field('databaseDirectory','Running Analysis database','path',true,'Use the database opened by the original Analysis application.'),
  field('recipeFile','Workbook recipe file','path',true,'Select the original JSON definition or reviewed refresh recipe. The complete file is included in review.'),
  field('operationDirectory','Delivery operation directory','path',true,'Use a private directory for this workbook edition. Reuse it to continue the same saved request and build.'),
  field('waitSeconds','Wait for this delivery, in seconds','text',false,'Defaults to 300. Use 0 to start the original job and receive it in a later start of this same application.'),
  environment];
export const WORKBOOK_APPLICATION_CATALOG=Object.freeze([
  {id:'python-workbook-build',python:true,command:'workbookDelivery',workbookAction:'build',terminal:false,
    requiredSource:original+'workbook_client.py',title:'Build and receive workbook',
    description:'Save the selected workbook definition in the running Analysis workspace, build its original sources and receive the complete Excel handover.',
    fields:deliveryFields},
  {id:'python-workbook-refresh',python:true,command:'workbookDelivery',workbookAction:'refresh',terminal:false,
    requiredSource:original+'workbook_client.py',title:'Review and refresh workbook',
    description:'Use the original refresh recipe and source projection review to create the next retained workbook edition.',
    fields:deliveryFields.map(item=>item.name==='recipeFile'?{...item,label:'Reviewed refresh recipe file'}:item)},
  {id:'python-workbook-receive',python:true,command:'workbooks',workbookAction:'receive',terminal:false,
    requiredSource:original+'analysis_workbooks.py',title:'Receive workbook handover',
    description:'Verify an original complete workbook ZIP and receive its workbook, definitions, source files and history into a new private directory.',
    fields:[installation,field('archiveFile','Complete workbook ZIP','path',true),
      field('destinationDirectory','New receiving directory','path',true,'Its private parent must exist. The original receiver keeps an existing destination.'),
      field('archiveSha256','Expected archive SHA-256','text',false,'Optional checksum supplied with the handover. Review pins the actual archive bytes.'),
      field('maxBytes','Maximum expanded bytes','text',false,'Defaults to 1073741824 (1 GiB), as in the original receiver.'),environment]},
  {id:'python-workbook-inspect',python:true,command:'workbooks',workbookAction:'inspect',terminal:false,
    requiredSource:original+'analysis_workbooks.py',title:'Inspect saved workbook',
    description:'Verify every retained workbook member and the complete definition history, then open the saved files.',
    fields:[installation,field('deliveryDirectory','Complete workbook directory','path',true),
      field('manifestSha256','Expected manifest SHA-256','text',false,'Optional original checksum. Review retains the exact current manifest.'),environment]},
  {id:'python-workbook-copy',python:true,command:'workbooks',workbookAction:'copy',terminal:false,
    requiredSource:original+'analysis_workbooks.py',title:'Copy complete workbook',
    description:'Verify the selected workbook and copy all original files and history into a new private directory.',
    fields:[installation,field('deliveryDirectory','Original workbook directory','path',true),
      field('destinationDirectory','New copy directory','path',true,'The original command creates a complete copy and preserves an existing destination.'),
      field('manifestSha256','Expected manifest SHA-256','text',false),environment]},
]);
const kinds=new Set(WORKBOOK_APPLICATION_CATALOG.map(row=>row.id));
export const isNamedWorkbook=type=>kinds.has(type?.id);
const hash=value=>digest(json(canonical(value)));
function number(value,fallback,minimum) {
  if(value===undefined || value==='')return fallback;
  need(typeof value==='string' && /^(0|[1-9][0-9]{0,15})$/.test(value),'WORKBOOK_NUMBER_INVALID','Use a whole number of bytes or seconds.');
  const result=Number(value);
  need(Number.isSafeInteger(result) && result>=minimum,'WORKBOOK_NUMBER_INVALID');
  return result;
}
function optionalHash(value) {
  if(value===undefined || value==='')return null;
  need(typeof value==='string' && /^[a-f0-9]{64}$/.test(value),'WORKBOOK_CHECKSUM_INVALID','Use the complete lower-case SHA-256 checksum.');
  return value;
}
export function namedWorkbookResource(type,settings) {
  if(!isNamedWorkbook(type))return undefined;
  const directory=['build','refresh'].includes(type.workbookAction)?settings.operationDirectory:
    type.workbookAction==='inspect'?settings.deliveryDirectory:settings.destinationDirectory;
  return hash({family:'python-workbook-output',directory:absolute(directory)});
}

export async function runWorkbookReader(descriptor,plan) {
  need(plain(plan) && Buffer.byteLength(JSON.stringify(plan))<=65536,'WORKBOOK_SELECTION_INVALID');
  const child=spawn(descriptor.python,['-I',fileURLToPath(new URL('./workbook_result.py',import.meta.url))],{
    cwd:descriptor.cwd,shell:false,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe']});
  let output=[],bytes=0,stderr='',limited=false,timedOut=false,killer;
  child.stdout.on('data',chunk=>{
    bytes+=chunk.length;
    if(bytes>16*1024*1024){limited=true;child.kill('SIGTERM');killer??=setTimeout(()=>child.kill('SIGKILL'),2000);}
    else output.push(chunk);
  });
  child.stderr.on('data',chunk=>{if(stderr.length<4096)stderr+=chunk.toString('utf8').slice(0,4096-stderr.length);});
  child.stdin.on('error',()=>{});
  child.stdin.end(JSON.stringify(plan));
  const timeout=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');killer??=setTimeout(()=>child.kill('SIGKILL'),2000);},120000);
  try{
    const result=await new Promise((accept,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>accept({code,signal}));});
    need(result.code===0 && !limited && !timedOut,'WORKBOOK_VERIFICATION_FAILED',
      timedOut?'Original workbook verification has not finished. Inspect it again from this saved application.':
        limited?'The original workbook result exceeds the 16 MiB view limit.':
        'The original workbook could not be verified. '+stderr.slice(-1800));
    let value;try{value=JSON.parse(Buffer.concat(output).toString('utf8'));}catch{need(false,'WORKBOOK_RESULT_INVALID');}
    need(value?.schema==='stellar-forge.workbook-application-result.v1','WORKBOOK_RESULT_INVALID');
    return value;
  }finally{clearTimeout(timeout);if(killer)clearTimeout(killer);}
}

async function retainRecipe(root,raw) {
  const directory=join(root,'workbook-inputs');
  try{await makePrivate(directory);}catch(error){if(error.code!=='EEXIST')throw error;await privateDirectory(directory);}
  const path=join(directory,digest(raw)+'.json');
  try{
    need((await regular(path,1024*1024)).equals(raw),'WORKBOOK_RETAINED_RECIPE_CHANGED');
    return path;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=join(directory,'.recipe-'+randomUUID());
  const handle=await open(temporary,'wx',0o600);
  try{
    await handle.writeFile(raw);await handle.sync();
    try{await link(temporary,path);}
    catch(error){if(error.code!=='EEXIST')throw error;need((await regular(path,1024*1024)).equals(raw),'WORKBOOK_RETAINED_RECIPE_CHANGED');}
  }finally{await handle.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  const parent=await open(directory,'r');
  try{await parent.sync();}finally{await parent.close();}
  return path;
}

export async function prepareNamedWorkbook(root,type,settings,{runtimeId,runtimeDirectory,inputPath}) {
  need(isNamedWorkbook(type),'WORKBOOK_ACTION_INVALID');
  const action=type.workbookAction,inputs=[];
  const inspectDescriptor=await bindPythonApplicationCommand(root,{runtimeId,runtimeDirectory,
    installationId:settings.installationId,command:'workbooks',args:['--help']});
  let args,selection;
  if(action==='build' || action==='refresh'){
    inputs.push(await inputPath(absolute(settings.databaseDirectory),'directory',false,true));
    inputs.push(await inputPath(absolute(settings.recipeFile),'file',false,false));
    inputs.push(await inputPath(absolute(settings.operationDirectory),'directory',true,true));
    const raw=await regular(settings.recipeFile,1024*1024);
    let recipe;try{recipe=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{need(false,'WORKBOOK_RECIPE_INVALID','Select the original JSON workbook recipe.');}
    need(plain(recipe),'WORKBOOK_RECIPE_INVALID');
    const retainedRecipe=await retainRecipe(root,raw);
    inputs.push(await inputPath(retainedRecipe,'file',false,false));
    const wait=number(settings.waitSeconds,300,0);
    args=['--database',settings.databaseDirectory,action==='refresh'?'--refresh-recipe':'--recipe',retainedRecipe,
      '--operation',settings.operationDirectory,'--wait-seconds',String(wait)];
    selection={action,directory:join(settings.operationDirectory,'received'),operation:settings.operationDirectory,
      database:settings.databaseDirectory,recipeFile:retainedRecipe,originalRecipeFile:settings.recipeFile,recipeSha256:digest(raw),recipe,waitSeconds:wait};
  }else if(action==='receive'){
    inputs.push(await inputPath(absolute(settings.archiveFile),'file',false,false));
    const destination=await inputPath(absolute(settings.destinationDirectory),'directory',true,true);
    need(!destination.exists,'WORKBOOK_DESTINATION_EXISTS','Choose a new destination. Inspect an already received workbook with the Inspect saved workbook action.');
    inputs.push(destination);
    const selected=await runWorkbookReader(inspectDescriptor,{action:'archive-selection',archive:settings.archiveFile,
      archive_sha256:optionalHash(settings.archiveSha256)});
    const maximum=number(settings.maxBytes,1073741824,1);
    args=['receive','--archive',settings.archiveFile,'--destination',settings.destinationDirectory,
      '--sha256',selected.sha256,'--max-bytes',String(maximum)];
    selection={action,directory:settings.destinationDirectory,archive:settings.archiveFile,
      archive_sha256:selected.sha256,archive_bytes:selected.bytes,manifest_sha256:selected.manifest_sha256,
      manifest:selected.manifest,maxBytes:maximum};
  }else{
    inputs.push(await inputPath(absolute(settings.deliveryDirectory),'directory',false,true));
    const selected=await runWorkbookReader(inspectDescriptor,{action:'inspect',directory:settings.deliveryDirectory,
      manifest_sha256:optionalHash(settings.manifestSha256)});
    need(selected.state==='VERIFIED','WORKBOOK_COMPLETE_DELIVERY_REQUIRED');
    args=[action,'--delivery',settings.deliveryDirectory,'--manifest-sha256',selected.manifest_sha256];
    if(action==='copy'){
      const destination=await inputPath(absolute(settings.destinationDirectory),'directory',true,true);
      need(!destination.exists,'WORKBOOK_DESTINATION_EXISTS','Choose a new copy destination. The original command preserves existing directories.');
      inputs.push(destination);args.push('--destination',settings.destinationDirectory);
    }
    selection={action,directory:action==='copy'?settings.destinationDirectory:settings.deliveryDirectory,
      source_directory:settings.deliveryDirectory,manifest_sha256:selected.manifest_sha256,manifest:selected.manifest};
  }
  return {args,inputs,workbook:{schema:'stellar-forge.workbook-application-selection.v1',...selection}};
}

function one(args,flag) {
  const values=[];
  for(let at=0;at<args.length;at++){
    if(args[at]===flag){need(at+1<args.length,'WORKBOOK_ARGUMENTS_INVALID');values.push(args[at+1]);}
    else if(args[at].startsWith(flag+'='))values.push(args[at].slice(flag.length+1));
  }
  need(values.length<=1,'WORKBOOK_ARGUMENTS_INVALID','Select '+flag+' once.');
  return values[0];
}
export function workbookCommandSelection(descriptor) {
  const args=descriptor?.args;
  if(!Array.isArray(args) || !args.every(value=>typeof value==='string'))return null;
  if(descriptor.command==='workbookDelivery'){
    const recipe=one(args,'--recipe'),refresh=one(args,'--refresh-recipe');
    if(Boolean(recipe)===Boolean(refresh))return null;
    const operation=one(args,'--operation'),database=one(args,'--database');
    if(!operation || !database)return null;
    return {action:refresh?'refresh':'build',operation:absolute(operation),database:absolute(database),
      directory:join(operation,'received'),recipeFile:absolute(recipe||refresh)};
  }
  if(descriptor.command!=='workbooks' || !['receive','inspect','copy'].includes(args[0]))return null;
  const action=args[0],directory=one(args,action==='inspect'?'--delivery':'--destination');
  if(!directory)return null;
  const value={action,directory:absolute(directory)};
  if(action==='receive'){
    const archive=one(args,'--archive');if(!archive)return null;value.archive=absolute(archive);
    value.archive_sha256=optionalHash(one(args,'--sha256'));
  }else{
    value.source_directory=absolute(one(args,'--delivery'));value.manifest_sha256=optionalHash(one(args,'--manifest-sha256'));
  }
  return value;
}

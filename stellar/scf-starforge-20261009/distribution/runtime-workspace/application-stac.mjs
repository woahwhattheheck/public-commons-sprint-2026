// MIT. Original imagery and customer hosts in the existing Applications manager.
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {absolute,plain,need,privateDirectory,recordId,operationId,readJSON,saveJSON} from './storage.mjs';
const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/stac';
const STARTUP='stellar-forge.stac-managed-startup.v1',HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
const processingFields=[
  field('processingWorkspaceDirectory','Processing workspace','path',false,
    'Optional existing Cirrus or FilmDrop processing workspace received with this imagery.'),
  field('processingConfigurationFile','Processing source configuration','path',false,
    'Use the original configuration file with the selected processing workspace.'),
  field('transportFile','Source transport configuration','path',false,
    'Optional original HTTP source transport; private credentials remain on this host.'),
];
const catalogueFields=[
  field('catalogueWorkspaceDirectory','Catalogue receiving workspace','path',false,
    'Optional private native GeoNetwork workspace. A new directory needs an existing private parent.'),
  field('catalogueConfigurationFile','Private catalogue host configuration','path',false,
    'Optional title, handover directory and existing source-publication directory. Credential values remain in host environment variables.'),
];
const variants=[
  {id:'stac-imagery',native:'serve',title:'Satellite imagery and processing',
    description:'Open original scene editions, selected assets, source comparisons, processing history and complete receiving.',
    fields:[...processingFields,...catalogueFields]},
  {id:'stac-eoapi',native:'eoapi-serve',title:'Imagery customer operations',
    description:'Operate the original eoAPI policy, source, selected files, merchant staging and customer receiving in the same imagery workspace.',
    fields:[field('sourceConfigurationFile','Private source authorization','path',false,
      'Select the original eoAPI source configuration and credential references.'),
      field('policyWorkspaceDirectory','Deployment policy workspace','path',false,
        'Select the original initialized policy directory; the default is eoapi/policy inside this imagery workspace.'),
      field('outputDirectory','Customer output directory','path',false,
        'Select the original separate delivery directory; a new directory needs an existing private parent.'),...processingFields]},
  {id:'stac-prescient',native:'prescient-serve',title:'Prescient imagery operations',
    description:'Open the original approved profile, SDK connection, source and selected-file receiving under its existing customer operator.',
    fields:[field('deploymentFile','Private Prescient host configuration','path',true,
      'Select the original deployment JSON with local credential bindings and receiving roots.'),
      field('profileSha256','Selected profile SHA256','text',false,
        'Leave empty to review the current profile. The saved application starts that exact selected profile.')]},
];
export function stacApplications(common){
  return variants.map(v=>({id:v.id,command:'stac',title:v.title,terminal:false,
    requiredSource:SOURCE+(v.native==='serve'?'/managed.mjs':v.native==='eoapi-serve'?'/eoapi/cli.mjs':'/prescient/cli.mjs'),description:v.description,
    fields:[field('workspaceDirectory','Initialized private workspace','path',true,v.native==='prescient-serve'?
      'Select the original Prescient operator directory containing operator/ and stac/.':
      'Select the original or received imagery workspace, initialized with the original STAC command.'),...v.fields,...common]}));
}
async function nativeModules(runtimeDirectory){
  const selected=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false});
  const directory=join(selected.sourceRoot,SOURCE),native=await import(pathToFileURL(join(directory,'managed.mjs')).href);
  need(typeof native.inspectStacManagedSelection==='function'&&typeof native.parseStacManagedSelection==='function'&&
    typeof native.stacSelectionDigest==='function'&&native.STAC_MANAGED_STARTUP===STARTUP,
    'APPLICATION_STAC_RUNTIME_REQUIRED','Choose an installed runtime containing the managed STAC host.');
  return {directory,native};
}
export async function prepareStacApplication(kind,settings,{inputPath,runtimeDirectory}={}){
  const variant=variants.find(v=>v.id===kind);need(variant&&typeof inputPath==='function','APPLICATION_STAC_KIND_INVALID');
  const original=await nativeModules(runtimeDirectory);
  const flags={workspace:absolute(settings.workspaceDirectory),port:settings.port??0,'startup-json':true};
  const mapping={processingWorkspaceDirectory:'processing-workspace',processingConfigurationFile:'processing-config',
    transportFile:'transport',sourceConfigurationFile:'source-config',policyWorkspaceDirectory:'policy-workspace',
    outputDirectory:'output-directory',deploymentFile:'deployment',profileSha256:'profile-sha256',
    catalogueWorkspaceDirectory:'catalogue-workspace',catalogueConfigurationFile:'catalogue-config'};
  for(const[name,flag]of Object.entries(mapping))if(settings[name])flags[flag]=settings[name];
  const selection=await original.native.inspectStacManagedSelection({command:variant.native,flags,sourceDirectory:original.directory});
  if(selection.options.profileSha256)flags['profile-sha256']=selection.options.profileSha256;
  if(selection.eoapi){flags['policy-workspace']=selection.eoapi.policy.directory;flags['output-directory']=selection.eoapi.output.directory;}
  const inputs=[await inputPath(selection.directory,'directory',false,true)];
  if(selection.workspace.directory!==selection.directory)inputs.push(await inputPath(selection.workspace.directory,'directory',false,true));
  if(selection.processing)inputs.push(await inputPath(selection.processing.directory,'directory',false,true));
  if(selection.eoapi){
    inputs.push(await inputPath(selection.eoapi.policy.directory,'directory',false,true));
    inputs.push(await inputPath(selection.eoapi.output.directory,'directory',true,true));
  }
  if(selection.catalogue)inputs.push(await inputPath(selection.catalogue.location.directory,'directory',true,true));
  for(const value of selection.configurations){
    const retained=await inputPath(value.path,'file');
    need(retained.sha256===value.sha256&&retained.bytes===value.bytes,'APPLICATION_STAC_CONFIGURATION_CHANGED');inputs.push(retained);
  }
  for(const value of selection.source.files){
    const retained=await inputPath(join(original.directory,value.name),'file');
    need(retained.sha256===value.sha256&&retained.bytes===value.bytes,'APPLICATION_STAC_SOURCE_CHANGED');inputs.push(retained);
  }
  const args=[variant.native,'--workspace',selection.directory,'--startup-json','--managed-selection',JSON.stringify(selection)];
  for(const[flag,value]of Object.entries(flags))if(!['workspace','port','startup-json'].includes(flag))args.push('--'+flag,String(value));
  const reviewedSettings={...settings,...(selection.options.profileSha256?{profileSha256:selection.options.profileSha256}:{}),
    ...(selection.eoapi?{policyWorkspaceDirectory:selection.eoapi.policy.directory,outputDirectory:selection.eoapi.output.directory}:{})};
  return {args,inputs,createDirectories:[],settings:reviewedSettings,resourceKey:original.native.stacSelectionDigest({
    family:'stac',directory:selection.workspace.directory,workspaceId:selection.workspace.id})};
}
function option(request,name){
  const positions=request.args.flatMap((value,index)=>value===name?[index]:[]);
  need(positions.length===1&&typeof request.args[positions[0]+1]==='string','APPLICATION_STAC_STARTUP_CHANGED');
  return request.args[positions[0]+1];
}
export async function stacStartup(request,text){
  if(request.command!=='stac'||!Array.isArray(request.args)||typeof text!=='string'||Buffer.byteLength(text)>32768||
    !text.startsWith('{"schema":"'+STARTUP+'",'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  need(plain(value)&&value.schema===STARTUP&&value.status==='STAC_READY'&&
    request.args.filter(x=>x==='--startup-json').length===1,'APPLICATION_STAC_STARTUP_CHANGED');
  const sourceDirectory=join(absolute(request.releaseDirectory),'source',SOURCE);
  const native=await import(pathToFileURL(join(sourceDirectory,'managed.mjs')).href);
  const selection=native.parseStacManagedSelection(option(request,'--managed-selection'));
  need(value.command===request.args[0]&&value.command===selection.command&&
    value.directory===absolute(option(request,'--workspace'))&&value.directory===selection.directory&&
    value.workspaceDirectory===selection.workspace.directory&&value.workspaceId===selection.workspace.id&&
    value.selectionSha256===native.stacSelectionDigest(selection)&&value.sourceSha256===selection.source.sha256&&
    HASH.test(value.sourceSha256)&&value.processingDirectory===(selection.processing?.directory??null)&&
    value.profileSha256===(selection.options.profileSha256??null)&&
    value.policyDirectory===(selection.eoapi?.policy.directory??null)&&value.outputDirectory===(selection.eoapi?.output.directory??null)&&
    (value.catalogueDirectory??null)===(selection.catalogue?.location.directory??null)&&
    (!selection.catalogue||/^catalogue-[a-f0-9]{24}$/.test(value.catalogueWorkspaceId??''))&&
    UUID.test(value.instanceId??'')&&
    Number.isSafeInteger(value.pid)&&value.pid>0&&typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt)),
    'APPLICATION_STAC_STARTUP_CHANGED');
  const live=await native.verifyStacManagedHost({url:value.url,selection});
  need(live.workspaceId===value.workspaceId&&(live.catalogueWorkspaceId??null)===(value.catalogueWorkspaceId??null),'APPLICATION_STAC_WORKSPACE_CHANGED');
  return {url:live.url,original:{schema:STARTUP,command:value.command,directory:value.directory,
    workspaceDirectory:value.workspaceDirectory,workspaceId:value.workspaceId,selectionSha256:value.selectionSha256,
    sourceSha256:value.sourceSha256,processingDirectory:value.processingDirectory,profileSha256:value.profileSha256,
    policyDirectory:value.policyDirectory,outputDirectory:value.outputDirectory,
    catalogueDirectory:value.catalogueDirectory??null,catalogueWorkspaceId:value.catalogueWorkspaceId??null,
    instanceId:value.instanceId,pid:value.pid,createdAt:value.createdAt}};
}

/** Keep one private connection path for the saved application across host restarts. */
export async function saveStacApplicationConnection(request,directory,record){
  const id=recordId(request.applicationId),operation=operationId(directory.split('/').at(-1));
  const applicationDirectory=join(dirname(dirname(absolute(directory))),'applications',id);
  await privateDirectory(applicationDirectory);
  const saved=await readJSON(join(applicationDirectory,'application.json'));
  const run=await readJSON(join(applicationDirectory,'runs',operation+'.json'));
  need(saved.id===id&&run.applicationId===id&&run.id===operation&&saved.revision===run.revision&&
    run.request.command==='stac'&&run.request.releaseId===request.releaseId&&run.request.homeId===request.homeId&&
    JSON.stringify(run.request.args)===JSON.stringify(request.args)&&
    record.applicationId===id&&record.operationId===operation&&
    record.workspaceId===record.original.workspaceId,'APPLICATION_STAC_CONNECTION_CHANGED');
  const path=join(applicationDirectory,'stac-connection.json'),previous=await readJSON(path,true);
  need(!previous||(previous.schema==='stellar-forge.application-url.v1'&&previous.applicationId===id),
    'APPLICATION_STAC_CONNECTION_CHANGED');
  await saveJSON(path,record,true);
  return path;
}


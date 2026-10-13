// MIT. Complete one selected original release and the original STAC Applications receiver.
import {readFile,writeFile,mkdir,lstat,realpath,rename,copyFile,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {gunzipSync} from 'node:zlib';
const runFile=promisify(execFile);

const SCHEMA='starforge.following-stac-applications-operation.v1';
const SOURCE='stellar/scf-starforge-20261009';
const now=()=>new Date().toISOString();
const json=value=>JSON.stringify(value,null,2)+'\n';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const selectedProfile=selection=>JSON.stringify({native:selection.native,features:selection.features,
  operator:selection.operator,pins:Object.fromEntries(Object.entries(selection.pins??{}).sort(([a],[b])=>a.localeCompare(b)))});
const gitBlob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const need=(value,code,message=code)=>{if(!value)throw Object.assign(new Error(message),{code});};
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code!=='ENOENT')throw error;return false;}};
const absolute=value=>need(typeof value==='string'&&value!==resolve('/')&&resolve(value)===value&&!value.includes('\0'),'ABSOLUTE_OWNED_PATH_REQUIRED');

async function privateDirectory(path){
  absolute(path);await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&
    (!process.getuid||info.uid===process.getuid())&&await realpath(path)===path,'PRIVATE_OWNED_DIRECTORY_REQUIRED');
}
async function save(path,value){
  const pending=path+'.pending';
  await writeFile(pending,json(value),{mode:0o600});
  await rename(pending,path);
}
async function immutable(path,value){
  const bytes=Buffer.from(json(value));
  if(await exists(path))need((await readFile(path)).equals(bytes),'ORIGINAL_OPERATION_INPUT_CHANGED',path);
  else await writeFile(path,bytes,{mode:0o600,flag:'wx'});
}
async function checked(record){
  absolute(record.path);
  const info=await lstat(record.path);
  need(info.isFile()&&!info.isSymbolicLink(),'ORIGINAL_INPUT_NOT_REGULAR',record.path);
  const bytes=await readFile(record.path);
  if(record.bytes!==undefined)need(bytes.length===record.bytes,'ORIGINAL_INPUT_LENGTH_CHANGED',record.path);
  if(record.sha256)need(sha256(bytes)===record.sha256,'ORIGINAL_INPUT_DIGEST_CHANGED',record.path);
  if(record.blob)need(gitBlob(bytes)===record.blob,'ORIGINAL_INPUT_GIT_BLOB_CHANGED',record.path);
  return bytes;
}

function sameValue(left,right){
  const canonical=value=>Array.isArray(value)?value.map(canonical):
    value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  return JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
}
async function immutableBytes(path,bytes){
  if(await exists(path))need((await readFile(path)).equals(bytes),'ORIGINAL_OPERATION_INPUT_CHANGED',path);
  else await writeFile(path,bytes,{mode:0o600,flag:'wx'});
}
async function receiveClosedInput(config,runtime){
  const selected=config.closedInput;
  if(!selected)return null;
  need(selected.schema==='commons.stac-closed-processing-input.v1','ORIGINAL_CLOSED_INPUT_REQUIRED');
  need(typeof selected.importOperationId==='string'&&selected.importOperationId&&
    typeof selected.editionId==='string'&&selected.editionId,'ORIGINAL_IMPORT_IDENTITIES_REQUIRED');
  need(selected.member?.name==='cirrus-native.processing.json.gz'&&
    /^[a-f0-9]{64}$/.test(selected.manifestDigest??''),'ORIGINAL_PROCESSING_HANDOVER_REQUIRED');
  const root=join(config.projectDirectory,'restored-inputs');
  need(config.sourceWorkspace===join(root,'scenes')&&
    config.sourceProcessingWorkspace===join(root,'processing')&&
    selected.receivingDirectory===join(root,'received-inputs')&&
    selected.handoverDirectory===join(root,'exports'),'SELECT_ORIGINAL_RECEIVING_DIRECTORIES');
  for(const path of [selected.archive?.path,selected.receivingDirectory,selected.handoverDirectory])absolute(path);
  const archive=await checked(selected.archive);
  const inputDirectory=join(config.projectDirectory,'delivery','original-input');
  await privateDirectory(inputDirectory);
  await immutableBytes(join(inputDirectory,'STAC_Cirrus_Receiving_Case_20261012.zip'),archive);
  const intent={
    schema:'commons.stac-closed-input-intent.v1',operationId:config.operationId,
    sourceCommit:config.sourceCommit,archive:selected.archive,member:selected.member,
    manifestDigest:selected.manifestDigest,importOperationId:selected.importOperationId,
    editionId:selected.editionId,sourceWorkspace:config.sourceWorkspace,
    sourceProcessingWorkspace:config.sourceProcessingWorkspace,
    receivingDirectory:selected.receivingDirectory,handoverDirectory:selected.handoverDirectory
  };
  const intentFile=join(config.projectDirectory,'input-restoration-intent.json');
  await immutable(intentFile,intent);
  const outputFile=join(config.projectDirectory,'input-restoration.json');
  const prior=await exists(outputFile)?JSON.parse(await readFile(outputFile,'utf8')):null;
  if(prior)need(prior.status==='COMPLETE'&&sameValue(prior.intent,intent),'ORIGINAL_CLOSED_INPUT_RECEIPT_CHANGED');
  if(prior)for(const path of [config.sourceWorkspace,config.sourceProcessingWorkspace])
    need(await exists(path),'RESTORE_ORIGINAL_RETAINED_INPUT_DIRECTORY',path);
  await privateDirectory(root);
  for(const path of [selected.receivingDirectory,selected.handoverDirectory])await privateDirectory(path);
  const base=join(runtime.sourceRoot,SOURCE,'sf30-seller-sdk','stac');
  await checked({path:join(base,'workspace.mjs'),blob:'a6634bc6453209c79609540230a1ed008acec626'});
  await checked({path:join(base,'processing','workspace.mjs'),blob:'e74fc5a51ac11b1be76a869683d11375d97fa480'});
  const {openStacWorkspace}=await import(pathToFileURL(join(base,'workspace.mjs')).href);
  const {createProcessingController}=await import(pathToFileURL(join(base,'processing','workspace.mjs')).href);
  const extraction=[
    'import sys,zipfile',
    'with zipfile.ZipFile(sys.argv[1]) as archive:',
    ' matches=[item for item in archive.infolist() if item.filename==sys.argv[2]]',
    ' if len(matches)!=1 or matches[0].is_dir(): raise ValueError("Use the one original processing member")',
    ' sys.stdout.buffer.write(archive.read(matches[0]))'
  ].join('\n');
  const {stdout}=await runFile(config.pythonExecutable??'python3',
    ['-B','-c',extraction,selected.archive.path,selected.member.name],
    {encoding:'buffer',maxBuffer:selected.member.bytes+4096});
  const body=Buffer.from(stdout);
  need(body.length===selected.member.bytes&&sha256(body)===selected.member.sha256,
    'ORIGINAL_PROCESSING_MEMBER_CHANGED');
  const packed=JSON.parse(gunzipSync(body).toString('utf8'));
  need(packed.schema==='scf-stac-processing-packed/v1'&&
    packed.manifest?.digest===selected.manifestDigest,'ORIGINAL_PROCESSING_MANIFEST_CHANGED');
  await immutableBytes(join(inputDirectory,selected.member.name),body);
  let scenes=null,processing=null,observed=null;
  try{
    scenes=await openStacWorkspace({directory:config.sourceWorkspace,...(prior?{create:false}:{})});
    processing=await createProcessingController({stacWorkspace:scenes,
      directory:config.sourceProcessingWorkspace,config:{
        receivingDirectory:selected.receivingDirectory,handoverDirectory:selected.handoverDirectory}});
    const imported=prior?.imported??await processing.actions['import-handover']({
      input:{bodyBase64:body.toString('base64')},operationId:selected.importOperationId,stacWorkspace:scenes});
    const query={editionId:selected.editionId};
    const sceneState=await scenes.getState();
    const runs=await processing.reads.runs({query});
    const statistics=await processing.reads.statistics({query});
    need(Array.isArray(sceneState.editions)&&sceneState.editions.length>0,
      'ORIGINAL_IMPORTED_SCENES_REQUIRED');
    observed={imported,sceneState,runs,statistics};
    if(prior)need(sameValue(prior.sceneState,sceneState)&&sameValue(prior.runs,runs)&&
      sameValue(prior.statistics,statistics),'ORIGINAL_RESTORED_INPUT_CHANGED');
  }finally{
    try{if(processing)await processing.close();}
    finally{if(scenes)await scenes.close();}
  }
  if(prior)return prior;
  const result={schema:'commons.stac-closed-input-receiving.v1',status:'COMPLETE',
    operationId:config.operationId,sourceCommit:config.sourceCommit,completedAt:now(),
    closed:true,intent,...observed};
  await save(outputFile,result);
  await copyFile(outputFile,join(config.projectDirectory,'delivery','input-restoration.json'));
  await copyFile(intentFile,join(config.projectDirectory,'delivery','input-restoration-intent.json'));
  return result;
}

/**
 * Run with the maintained native ForegroundLaunch/artifact collector.
 * Runtime output may be a separate retained directory; all original inputs are read-only.
 * Same operation/project/runtime/receiving paths continue retained original state.
 */
export async function continueStacApplications(config,{onProgress=()=>{}}={}){
  need(config?.schema===SCHEMA,'ORIGINAL_CONTINUATION_INPUT_REQUIRED');
  for(const key of ['projectDirectory','runtimeDirectory','builderDirectory','sourceCache','sourceWorkspace'])absolute(config[key]);
  if(config.previousRuntime)absolute(config.previousRuntime);
  else need(config.selection&&typeof config.selection.native==='boolean'&&
    Array.isArray(config.selection.features)&&typeof config.selection.operator==='boolean',
    'SELECT_ORIGINAL_RUNTIME_PROFILE');
  if(config.sourceProcessingWorkspace)absolute(config.sourceProcessingWorkspace);
  need(/^[a-f0-9]{40}$/.test(config.sourceCommit)&&/^[a-f0-9]{40}$/.test(config.sourceTree),'ORIGINAL_SOURCE_IDENTITY_REQUIRED');
  need(typeof config.operationId==='string'&&config.operationId.length>0&&Array.isArray(config.builderFiles),'ORIGINAL_OPERATION_ID_REQUIRED');
  const project=config.projectDirectory,delivery=join(project,'delivery');
  if(config.previousRuntime)need(config.runtimeDirectory!==config.previousRuntime&&
    !config.previousRuntime.startsWith(config.runtimeDirectory+'/')&&
    !config.runtimeDirectory.startsWith(config.previousRuntime+'/'),'SEPARATE_RUNTIME_REQUIRED');
  await privateDirectory(project);await privateDirectory(delivery);
  let stage='INPUTS';
  const progress=value=>onProgress({stage,...value});
  let runtimeDirectory=config.runtimeDirectory;
  try{
    await immutable(join(project,'continuation-input.json'),config);
    const builderFiles=[];
    for(const item of config.builderFiles){
      need(typeof item.name==='string'&&!item.name.includes('/')&&!item.name.includes('\\'),'BUILDER_MEMBER_NAME_INVALID');
      const path=join(config.builderDirectory,item.name);
      const bytes=await checked({path,blob:item.blob,bytes:item.bytes});
      builderFiles.push({name:item.name,bytes:bytes.length,sha256:sha256(bytes)});
    }
    need(builderFiles.some(item=>item.name==='build.mjs')&&
      builderFiles.some(item=>item.name==='specification.mjs')&&
      builderFiles.some(item=>item.name==='product-package.mjs'),'ORIGINAL_BUILDER_CLOSURE_REQUIRED');
    const prior={};
    if(config.previousRuntime){
      for(const [name,record] of Object.entries(config.previousInputs??{}))prior[name]=JSON.parse(await checked(record));
      need(prior.plan&&prior.profile&&prior.state,'ORIGINAL_READY_INPUTS_REQUIRED');
      need(prior.plan.directory===config.previousRuntime&&prior.state.phase==='READY'&&
        prior.state.installationId===prior.plan.installationId&&
        prior.profile.profileId===prior.plan.profileId,'ORIGINAL_READY_IDENTITY_CHANGED');
    }
    const selection=config.previousRuntime?prior.profile.selection:{
      native:config.selection.native,features:config.selection.features,
      operator:config.selection.operator,pins:config.selection.pins??{}
    };
    const env={...process.env,PATH:dirname(process.execPath)+':'+process.env.PATH,
      PYTHONDONTWRITEBYTECODE:'1',npm_config_update_notifier:'false',
      npm_config_cache:config.npmCache??join(project,'npm-cache')};
    process.env.PATH=env.PATH;process.env.PYTHONDONTWRITEBYTECODE='1';
    process.env.npm_config_cache=env.npm_config_cache;
    const selected={
      schema:'starforge.following-source-release-selection.v1',operationId:config.operationId,
      sourceCommit:config.sourceCommit,sourceTree:config.sourceTree,sourceCache:config.sourceCache,
      builderDirectory:config.builderDirectory,builderFiles,
      releaseDirectory:join(project,'release'),runtimeDirectory:config.runtimeDirectory,
      previousRuntime:config.previousRuntime??null,selection
    };
    await immutable(join(project,'release-selection.json'),selected);
    await save(join(project,'input-receipts.json'),{
      observedAt:now(),sourceCommit:config.sourceCommit,sourceTree:config.sourceTree,builderFiles,
      previousInstallationId:prior.plan?.installationId??null,
      previousProfileId:prior.profile?.profileId??null,selection
    });

    stage='SOURCE';
    const {buildDistribution}=await import(pathToFileURL(join(config.builderDirectory,'build.mjs')).href);
    const distribution=await buildDistribution({repository:config.sourceCache,ref:config.sourceCommit,
      output:selected.releaseDirectory,resume:await exists(selected.releaseDirectory),
      offline:config.sourceOffline??true,python:config.pythonExecutable??'python3',
      onProgress:event=>progress({phase:'original_builder',...event})});
    need(distribution.status==='PACKAGED'&&distribution.sourceCommit===config.sourceCommit,
      'ORIGINAL_DISTRIBUTION_INCOMPLETE');
    await save(join(project,'source-release.json'),distribution);
    await copyFile(distribution.archive,join(delivery,'source.tgz'));
    await copyFile(join(selected.releaseDirectory,'distribution.json'),join(delivery,'distribution.json'));
    const bootstrapRoot=join(selected.releaseDirectory,'package','source',SOURCE,'distribution');
    await checked({path:join(bootstrapRoot,'runtime-install.mjs'),blob:'b1eaf6529659273e32f2534a4a34b26274c3a7d5'});
    await checked({path:join(bootstrapRoot,'runtime-profile.mjs'),blob:'dd2ecfa155a5806dec9feed4f4d9a5bd15005d95'});
    const installer=await import(pathToFileURL(join(bootstrapRoot,'runtime-install.mjs')).href);
    const options={offline:config.dependencyOffline??true,cache:env.npm_config_cache,
      npm:config.npmExecutable??'npm',nodeHeaders:null};
    const recovery=runtimeDirectory+'-recovered';

    stage='RUNTIME';
    if(await exists(recovery))runtimeDirectory=recovery;
    if(await exists(join(runtimeDirectory,'runtime-install.json'))){
      const plan=JSON.parse(await readFile(join(runtimeDirectory,'runtime-install.json'),'utf8'));
      need(plan.source.sourceCommit===config.sourceCommit&&plan.archiveSha256===distribution.sha256,
        'RETAINED_RUNTIME_EDITION_CHANGED');
      await installer.installRuntime({directory:runtimeDirectory,...options});
    }else if(await exists(runtimeDirectory)){
      need(runtimeDirectory!==recovery,'CONTINUE_ORIGINAL_PREPARATION_RECOVERY');
      const preparation=JSON.parse(await readFile(join(runtimeDirectory,'preparation.json'),'utf8'));
      need(preparation.archiveSha256===distribution.sha256&&
        selectedProfile(preparation.selection)===selectedProfile(selection),
        'RETAINED_RUNTIME_SELECTION_CHANGED');
      await installer.recoverRuntime({from:runtimeDirectory,directory:recovery,
        python:config.pythonExecutable??'python3',...options});runtimeDirectory=recovery;
    }else if(config.previousRuntime){
      await installer.upgradeRuntime({from:config.previousRuntime,directory:runtimeDirectory,
        archive:distribution.archive,sha256:distribution.sha256,
        python:config.pythonExecutable??'python3',...options});
    }else{
      // This explicitly selected new installation uses the maintained profile
      // resolver, archive receiver and npm state machine, exactly as upgrade does.
      await installer.prepareRuntimeInstall({directory:runtimeDirectory,archive:distribution.archive,
        sha256:distribution.sha256,...selection,python:config.pythonExecutable??'python3'});
      await installer.installRuntime({directory:runtimeDirectory,...options});
    }
    const runtime=await installer.inspectRuntimeInstall({directory:runtimeDirectory,load:true});
    need(runtime.status==='READY'&&runtime.ready===true&&runtime.sourceCommit===config.sourceCommit,
      'ORIGINAL_RUNTIME_NOT_READY');
    const profile=JSON.parse(await readFile(join(runtimeDirectory,'runtime-profile.json'),'utf8'));
    need(selectedProfile(profile.selection)===selectedProfile(selection),'ORIGINAL_RUNTIME_PROFILE_CHANGED');
    const plan=JSON.parse(await readFile(join(runtimeDirectory,'runtime-install.json'),'utf8'));
    need(/^[a-f0-9]{64}$/.test(plan.source.manifestSha256??''),'ORIGINAL_SOURCE_MANIFEST_REQUIRED');
    const ready={...runtime,runtimeDirectory:runtime.directory,sourceManifestSha256:plan.source.manifestSha256,
      sourceRepository:'woahwhattheheck/public-commons-sprint-2026',operationId:config.operationId};
    await save(join(project,'runtime-ready.json'),ready);
    progress({phase:'READY',installationId:runtime.installationId,profileId:runtime.profileId,
      sourceCommit:runtime.sourceCommit,sourceManifestSha256:ready.sourceManifestSha256});

    stage='INPUT_RESTORATION';
    const inputRestoration=await receiveClosedInput(config,runtime);
    if(inputRestoration)progress({phase:'ORIGINAL_CLOSED_INPUT_RECEIVED',
      importOperationId:inputRestoration.intent.importOperationId,
      sceneWorkspaceId:inputRestoration.sceneState.id,editionId:inputRestoration.intent.editionId});

    stage='APPLICATIONS';
    const root=join(runtime.sourceRoot,SOURCE);
    for(const record of config.installedSources??[]){
      const file=join(runtime.sourceRoot,record.path);
      await checked({path:file,blob:record.blob});
      if(record.import)await import(pathToFileURL(file).href);
    }
    const receiverFile=join(root,'sf30-seller-sdk/stac/examples/managed-applications-receiving.mjs');
    await checked({path:receiverFile,blob:'47a11b1970e2d80ce75524f89c0f821dfe177d6e'});
    const receiving={
      schema:'stellar-forge.stac-managed-applications-input.v1',runtimeDirectory,
      sourceWorkspace:config.sourceWorkspace,sourceProcessingWorkspace:config.sourceProcessingWorkspace??null,
      directory:join(project,'apps-receiving'),label:config.label??'Satellite imagery and processing receiving',
      timeoutMs:config.timeoutMs??180000,pollMs:config.pollMs??500
    };
    await immutable(join(project,'apps-input.json'),receiving);
    const {runManagedStacReceiving}=await import(pathToFileURL(receiverFile).href);
    const {schema,...request}=receiving;
    const result=await runManagedStacReceiving({...request,
      onStage:event=>progress({phase:'original_applications',...event})});
    need(result.status==='COMPLETE'&&result.completedAt,'ORIGINAL_APPLICATIONS_RECEIVING_INCOMPLETE');
    const outcome={
      schema:'starforge.following-stac-applications-result.v1',status:'COMPLETE',operationId:config.operationId,
      completedAt:now(),sourceCommit:config.sourceCommit,sourceTree:config.sourceTree,
      distribution,runtime:ready,selection:profile.selection,inputRestoration,receiving:result,
      retainedPaths:{applications:'delivery/apps-receiving',sourceArchive:'delivery/source.tgz'}
    };
    await save(join(project,'continuation.json'),outcome);
    progress({phase:'COMPLETE',sourceCommit:config.sourceCommit,applicationId:result.applicationId});
    return outcome;
  }catch(error){
    await save(join(project,'continuation-error.json'),{schema:'starforge.following-stac-applications-error.v1',
      operationId:config.operationId,sourceCommit:config.sourceCommit,stage,observedAt:now(),
      code:error.code??null,message:String(error.message),
      ...(Array.isArray(error.missingObjects)?{missingObjects:error.missingObjects}:{}),
      ...(error.sourceCommit?{originalSourceCommit:error.sourceCommit}:{})}).catch(()=>{});
    throw error;
  }finally{
    // The existing native collector retains delivery on both outcomes. Original
    // runtime and provider data remain in their selected directories.
    for(const name of ['continuation-input.json','release-selection.json','input-receipts.json',
      'source-release.json','runtime-ready.json',
      'apps-input.json','continuation.json','continuation-error.json',
      'input-restoration-intent.json','input-restoration.json']){
      if(await exists(join(project,name)))await copyFile(join(project,name),join(delivery,name));
    }
    const distribution=join(project,'release/distribution.json');
    if(await exists(distribution)){
      const receipt=JSON.parse(await readFile(distribution,'utf8'));
      await copyFile(distribution,join(delivery,'distribution.json'));
      if(await exists(receipt.archive))await copyFile(receipt.archive,join(delivery,'source.tgz'));
    }
    for(const selected of [config.runtimeDirectory,config.runtimeDirectory+'-recovered']){
      if(!await exists(selected))continue;
      const target=join(delivery,selected.endsWith('-recovered')?'runtime-recovered':'runtime');
      await privateDirectory(target);
      for(const name of ['runtime-install.json','runtime-profile.json','install-state.json','package.json',
        'package-lock.json','preparation.json','prepare-error.json','RUNBOOK.md']){
        if(await exists(join(selected,name)))await copyFile(join(selected,name),join(target,name));
      }
    }
    if(await exists(join(project,'apps-receiving')))
      await cp(join(project,'apps-receiving'),join(delivery,'apps-receiving'),{recursive:true});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const input=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
  await continueStacApplications(input,{onProgress:value=>process.stdout.write(json(value))});
}

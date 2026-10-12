// MIT. Callable receiving phase for the existing complete PMTiles native operation.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {join,resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {open} from 'node:fs/promises';

/**
 * Invoke after the original producer browser/server closes, in its owning
 * native command and network namespace. This consumes its actual saved source.
 */
export async function exercisePMTilesMcp({sourceRoot,directory,runtimeProfile,expectedWorkspaceId,
  root,operationId,reviewer,signal}){
  for(const path of [sourceRoot,directory,runtimeProfile,root])assert.ok(isAbsolute(path));
  sourceRoot=resolve(sourceRoot);root=resolve(root);
  const moduleAt=relative=>import(pathToFileURL(join(sourceRoot,relative)).href);
  const scf='stellar/scf-starforge-20261009/';
  const product=scf+'sf30-seller-sdk/pmtiles/';
  const operator='stellar-forge/mcp-merchant-operator/';
  const [{privateDirectory,readJson},{retainJson,fileDescriptor,MAX_METADATA_BYTES},
    {clone,digest,hash},{openPMTilesWorkspace},{initializePMTilesWorkspaceMerchant},
    {startMerchantMcp},{openMerchantFileClient},{downloadPMTilesPackage},
    {runPMTilesMcpCommand}]=await Promise.all([
    moduleAt(scf+'sf88-operator-buyer-cli/node/store.mjs'),moduleAt(product+'files.mjs'),
    moduleAt(product+'model.mjs'),moduleAt(product+'workspace.mjs'),
    moduleAt(operator+'pmtiles-workspace.mjs'),moduleAt(operator+'serve.mjs'),
    moduleAt(operator+'retained-download.mjs'),moduleAt(operator+'pmtiles-download.mjs'),
    moduleAt(operator+'pmtiles-cli.mjs')]);
  await privateDirectory(root);await privateDirectory(join(root,'steps'));
  const input={schema:'stellar-forge.pmtiles-mcp-native-input.v1',sourceRoot:resolve(sourceRoot),directory:resolve(directory),
    runtimeProfile:resolve(runtimeProfile),expectedWorkspaceId,root,operationId,reviewer};
  const inputSha256=digest(input),prefix='mcp-'+inputSha256.slice(0,16);
  const requestId=name=>prefix+'-'+name;
  await retainJson(join(root,'input.json'),input);
  async function optional(path){try{return await readJson(path,MAX_METADATA_BYTES);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  const completed=await optional(join(root,'result.json'));
  if(completed){
    assert.equal(completed.inputSha256,inputSha256);
    const original=await fileDescriptor(completed.downloadedArchive.path,{limit:8*1024*1024*1024,signal});
    assert.equal(original.sha256,completed.downloadedArchive.sha256);assert.equal(original.bytes,completed.downloadedArchive.bytes);
    return {...completed,reused:true};
  }
  async function step(name,work){
    const path=join(root,'steps',name+'.json'),saved=await optional(path);
    if(saved){assert.equal(saved.inputSha256,inputSha256);return saved.result;}
    signal?.throwIfAborted();
    const result=await work();await retainJson(path,{inputSha256,result});return result;
  }
  const selected=await step('original-selected-source',async()=>{
    const workspace=await openPMTilesWorkspace({directory,expectedWorkspaceId,create:false});
    try{
      const state=workspace.state(),release=state.currentRelease?workspace.getRelease(state.currentRelease):null;
      const row=release?{id:release.editionId,version:release.editionVersion}:state.editions[0];
      assert.ok(row,'The original native journey must retain a saved map edition.');
      const edition=workspace.getEdition(row.id,row.version),archive=workspace.getResource(edition.archives[0].resourceId);
      const style=workspace.getResource(edition.style);
      return {workspaceId:state.id,currentRelease:state.currentRelease,edition,archive,style,
        archivePath:workspace.resourceFile(archive.id).path,stylePath:workspace.resourceFile(style.id).path};
    }finally{await workspace.close();}
  });
  assert.equal(selected.workspaceId,expectedWorkspaceId);
  const receivingRoot=await privateDirectory(join(root,'receiving-target'));
  const connection=join(root,'connection.json');
  const source=row=>({name:row.name,kind:row.kind,rights:row.rights,expected:{bytes:row.bytes,sha256:row.sha256}});
  await retainJson(connection,{schema:'stellar-forge.pmtiles-workspace-connection.v1',workspaces:{original:{
    label:'Original regional map release',directory,expectedWorkspaceId,runtime:runtimeProfile,
    imports:{archive:{path:selected.archivePath,...source(selected.archive)},style:{path:selected.stylePath,...source(selected.style)}},
    receivingTargets:{customer:{directory:receivingRoot}}}}});
  const initialized=await initializePMTilesWorkspaceMerchant({directory:join(root,'operator'),connection,name:'Original PMTiles MCP receiving'});
  assert.deepEqual(await initializePMTilesWorkspaceMerchant({directory:join(root,'operator'),connection,name:'Original PMTiles MCP receiving'}),initialized);
  const tokenEnv='PMTILES_NATIVE_RECEIVING_MCP_TOKEN',environment={...process.env,[tokenEnv]:randomBytes(32).toString('hex')};
  const listenerPath=join(root,'listener.json');let listener,client;
  const toolCalls=[];
  async function start(){
    const saved=await optional(listenerPath);if(saved)assert.equal(saved.inputSha256,inputSha256);
    listener=await startMerchantMcp({configPath:initialized.configuration,port:saved?.port??0,tokenEnv,environment});
    const port=Number(new URL(listener.url).port);
    if(saved)assert.equal(port,saved.port);else await retainJson(listenerPath,{inputSha256,port});
    client=await openMerchantFileClient({url:listener.url,tokenEnv,environment,signal,errorPrefix:'PMTILES',
      clientName:'original-pmtiles-native-receiving',maximumResponseBytes:32*1024*1024});
  }
  async function call(name,args={}){
    const full='merchant_pmtiles_'+name;
    const selectedArgs=name.startsWith('download_')?args:{workspace:'original',...args};
    const value=await client.call(full,selectedArgs,{requestSignal:signal,timeoutMs:600000});
    toolCalls.push({name:full,inputSha256:digest(selectedArgs),resultSha256:digest(value)});return value;
  }
  const durable=(name,args={})=>({requestId:requestId(name),...args});
  try{
    await start();
    const catalog=listener.operator.tools.map(value=>value.name).filter(name=>name.startsWith('merchant_pmtiles_'));
    assert.equal(catalog.length,31);
    const opened=await call('open');assert.equal(opened.workspaceId,expectedWorkspaceId);
    const consoleFirst=await call('console');assert.equal(new URL(consoleFirst.url).origin,opened.authoring.origin);
    assert.ok(new URL(consoleFirst.url).hash.startsWith('#token='));
    const firstOrigin=opened.authoring.origin;
    const archive=await step('mcp-original-archive',()=>call('import',durable('archive',{source:'archive'})));
    assert.deepEqual(await call('import',durable('archive',{source:'archive'})),archive);
    const style=await step('mcp-original-style',()=>call('import',durable('style',{source:'style'})));
    const resources=[];let offset=0;
    for(;;){
      const page=await call('resources',{offset,limit:2});resources.push(...page.items);
      if(!page.hasMore)break;assert.ok(page.nextOffset>offset);offset=page.nextOffset;
    }
    assert.ok(resources.some(value=>value.id===archive.id));assert.ok(resources.some(value=>value.id===style.id));
    const original=await call('resource',{resourceId:archive.id});assert.equal(original.sha256,selected.archive.sha256);
    const part=await call('resource_file',{resourceId:archive.id,expectedSha256:archive.sha256,offset:0,limit:65536});
    const fd=await open(selected.archivePath,'r');
    try{
      const actual=Buffer.alloc(part.bytesRead);await fd.read(actual,0,actual.length,0);
      assert.equal(Buffer.from(part.data,'base64').compare(actual),0);
    }finally{await fd.close();}
    await call('file_release',{readId:part.readId});
    const fields=['name','notes','style','archives','sprite','glyphs','layerDecisions','view'];
    const edition=Object.fromEntries(fields.filter(key=>Object.hasOwn(selected.edition,key)).map(key=>[key,clone(selected.edition[key])]));
    edition.name=selected.edition.name+' — merchant MCP';edition.style=style.id;
    edition.archives=edition.archives.map((value,index)=>index===0?{...value,resourceId:archive.id}:value);
    const saved=await step('mcp-saved-edition',()=>call('save',durable('save',{editionId:requestId('edition'),expectedVersion:0,edition})));
    assert.deepEqual(await call('edition',{editionId:saved.id,version:saved.version}),saved);
    await call('compare',{leftId:selected.edition.id,leftVersion:selected.edition.version,rightId:saved.id,rightVersion:saved.version});
    const inspection=await step('mcp-native-inspection',()=>call('inspect',durable('inspect',{editionId:saved.id,version:saved.version})));
    const recovered=await call('request',{requestId:requestId('inspect')});
    assert.equal(recovered.request.status,'COMPLETE');assert.deepEqual(recovered.request.result,inspection);
    const review=await step('mcp-native-review',()=>call('review',durable('review',{editionId:saved.id,version:saved.version,
      inspectionRequestId:requestId('inspect'),expectedCurrentRelease:selected.currentRelease,reviewer,note:'Original source through the merchant MCP operator'})));
    assert.deepEqual(await call('review_status',{reviewId:review.id}),review);
    const release=await step('mcp-prepared-release',()=>call('prepare',durable('prepare',{reviewId:review.id,reviewSha256:review.reviewSha256})));
    assert.deepEqual(await call('release',{releaseId:release.id}),release);
    const published=await step('mcp-published-release',()=>call('publish',durable('publish',{releaseId:release.id,
      manifestSha256:release.manifestSha256,expectedCurrentRelease:selected.currentRelease})));
    assert.equal(published.publication.releaseId,release.id);assert.equal(published.previewError,null);assert.equal(published.preview.alive,true);
    const preview=await call('preview',durable('preview',{releaseId:release.id}));assert.equal(preview.preview.alive,true);
    await step('mcp-complete-workspace-export',()=>call('export',durable('export')));
    const packaged=await step('mcp-complete-package',()=>call('package',durable('package')));
    const info=await call('package_info',durable('package'));assert.deepEqual(info,packaged);
    const exportId=packaged.exportId,downloadRoot=join(root,'download');
    await step('mcp-interrupted-original-download',async()=>{
      let pause=false,complete=null;
      const retainedClient={endpoint:client.endpoint,call:async(name,args,options)=>{
        const value=await client.call(name,args,options);
        if(name==='merchant_pmtiles_download_file'&&args.file==='pmtiles-operations.zip'&&args.offset>=196608&&!pause){
          pause=true;throw Object.assign(new Error('Original returned file chunk interrupted before local receiving'),{code:'PMTILES_CAPTURED_RETURN_INTERRUPTED'});
        }
        return value;
      }};
      try{complete=await downloadPMTilesPackage({client:retainedClient,exportId,directory:downloadRoot,
        expectedManifestSha256:packaged.downloadManifestSha256,signal});}
      catch(error){assert.equal(error.code,'PMTILES_CAPTURED_RETURN_INTERRUPTED');}
      assert.ok(pause||complete?.state==='COMPLETE');
      const checkpoint=await readJson(join(downloadRoot,'download-state','checkpoint.json'),65536);
      const file=checkpoint.files['pmtiles-operations.zip'];assert.ok(file.bytes>=196608);
      return {interrupted:pause,retainedBytes:file.bytes,complete:complete?.state==='COMPLETE'};
    });
    await call('close');await listener.close();listener=null;await start();
    const reopened=await call('open');assert.equal(reopened.authoring.origin,firstOrigin);
    const consoleSecond=await call('console');assert.notEqual(consoleSecond.url,consoleFirst.url);
    const cli=await runPMTilesMcpCommand(['inspect-package','--url',listener.url,'--export-id',exportId,'--token-env',tokenEnv],{environment,signal});
    assert.equal(cli.manifestSha256,packaged.downloadManifestSha256);
    const download=await step('mcp-completed-original-download',()=>downloadPMTilesPackage({url:listener.url,tokenEnv,environment,
      exportId,directory:downloadRoot,expectedManifestSha256:packaged.downloadManifestSha256,signal}));
    assert.equal(download.state,'COMPLETE');
    const repeated=await downloadPMTilesPackage({url:listener.url,tokenEnv,environment,exportId,directory:downloadRoot,
      expectedManifestSha256:packaged.downloadManifestSha256,signal});
    assert.equal(repeated.resumedBytes,packaged.archive.bytes);
    const downloadedArchive={path:join(downloadRoot,'pmtiles-operations.zip'),
      ...await fileDescriptor(join(downloadRoot,'pmtiles-operations.zip'),{limit:8*1024*1024*1024,signal})};
    assert.equal(downloadedArchive.sha256,packaged.archive.sha256);assert.equal(downloadedArchive.bytes,packaged.archive.bytes);
    const receiveArgs=durable('receive',{packageRequestId:requestId('package'),archiveSha256:packaged.archive.sha256,target:'customer'});
    const received=await step('mcp-original-package-receiving',()=>call('receive',receiveArgs));
    assert.equal(received.status,'COMPLETE');assert.equal(received.currentRelease,release.id);
    const receiveReplay=await call('receive',receiveArgs);
    assert.equal(receiveReplay.workspaceId,received.workspaceId);assert.equal(receiveReplay.archiveSha256,received.archiveSha256);
    const restored=await step('mcp-restored-original-release',()=>call('restore',durable('restore',{fromReleaseId:release.id,manifestSha256:release.manifestSha256})));
    assert.equal(restored.restoration.restoredReleaseId,selected.currentRelease);
    await call('stop_preview',durable('stop'));
    const finalState=await call('status');assert.equal(finalState.authoring.currentRelease,selected.currentRelease);
    await call('close');await listener.close();listener=null;
    const result={schema:'stellar-forge.pmtiles-mcp-native-result.v1',status:'COMPLETE',operationId,inputSha256,
      workspaceId:expectedWorkspaceId,sourceEdition:{id:selected.edition.id,version:selected.edition.version},
      edition:{id:saved.id,version:saved.version},reviewId:review.id,releaseId:release.id,
      restoredReleaseId:selected.currentRelease,authoringOrigin:firstOrigin,toolCatalog:catalog,toolCalls,
      package:packaged,download,downloadedArchive,receiving:received,completedAt:new Date().toISOString()};
    await retainJson(join(root,'result.json'),result);return result;
  }finally{if(listener)await listener.close();}
}

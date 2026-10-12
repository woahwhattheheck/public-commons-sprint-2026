// MIT. Complete receiving through the original Utility console and merchant MCP.
import { createServer, request as httpRequest } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, open, rename, readdir, rmdir, lstat } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const sha = value => createHash('sha256').update(value).digest('hex');
const need = (value,message) => { if (!value) throw new Error(message); };
const canonical = value => JSON.stringify(value,function(key,item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(name => [name,item[name]])) : item;
});
async function save(path,value) {
  const temporary = path+'.next-'+randomUUID(), handle = await open(temporary,'wx',0o600);
  try { await handle.writeFile(JSON.stringify(value,null,2)+'\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary,path);
}
function sourceIdentity(state) {
  const keys = ['schema','applicationSchema','sources','plans','builds','comparisons','imports','previews','reviews',
    'reconciliations','captures','active_review','active_build','totals','merchant'];
  return Object.fromEntries(keys.map(key => [key,state[key] ?? null]));
}
async function rpc(url,token,method,params = {}) {
  return new Promise((yes,no) => {
    const body = Buffer.from(JSON.stringify({jsonrpc:'2.0',id:'utility-catalog',method,params}));
    const req = httpRequest(url,{method:'POST',agent:false,headers:{
      authorization:'Bearer '+token,'content-type':'application/json','content-length':String(body.length),
      accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'
    }},response => {
      (async () => {
        need(response.statusCode === 200,'The original MCP listener returned '+response.statusCode);
        const chunks = []; let count = 0;
        for await (const chunk of response) {
          count += chunk.length; need(count <= 4*1024*1024,'The original MCP catalog exceeded its receiving capacity.');
          chunks.push(chunk);
        }
        return JSON.parse(Buffer.concat(chunks,count).toString('utf8'));
      })().then(yes,no).finally(() => req.destroy());
    });
    req.once('error',no);req.setTimeout(120000,() => req.destroy(new Error('Original MCP request timed out.')));req.end(body);
  });
}

/**
 * Attaches one already-running original Python owner. Optional finalExport
 * retains one original package.export under a saved UUID; it never replays a
 * provider capture, reviewed interval decision, publisher purchase or payment.
 */
export async function runUtilityEnergyMcpJourney({
  sourceRoot,workspaceDirectory,consoleUrlFile,consoleUrl,outputDirectory,
  workspaceAlias = 'customer',reviewId,exportId,finalExport = false,
  expectedSourceIdentitySha256,sourceManifest = fileURLToPath(new URL('./source-manifest.json',import.meta.url))
} = {}) {
  for (const [key,value] of Object.entries({sourceRoot,workspaceDirectory,outputDirectory}))
    need(typeof value === 'string' && isAbsolute(value),'Choose an absolute '+key+'.');
  need(Boolean(consoleUrlFile) !== Boolean(consoleUrl),'Select the existing console URL file or exact original URL.');
  if(consoleUrlFile)need(typeof consoleUrlFile==='string'&&isAbsolute(consoleUrlFile),'Choose the absolute original console URL file.');
  sourceRoot = resolve(sourceRoot);outputDirectory = resolve(outputDirectory);
  await mkdir(outputDirectory,{recursive:true,mode:0o700});
  const reportPath = join(outputDirectory,'journey.json');
  let report;
  try { report = JSON.parse(await readFile(reportPath,'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (report) need(report.workspaceAlias === workspaceAlias && report.workspaceDirectory === workspaceDirectory,
    'Continue this receiving directory with its same original Utility workspace.');
  report ??= {schema:'stellar-forge.utility-mcp-receiving.v1',startedAt:new Date().toISOString(),
    workspaceAlias,workspaceDirectory,downloads:[],phase:'CREATED'};
  const checkpoint = async phase => {
    report.phase = phase;report.updatedAt = new Date().toISOString();await save(reportPath,report);
  };
  let owned,originalClient,failure;
  try {
    const declaration = typeof sourceManifest === 'string'
      ? JSON.parse(await readFile(sourceManifest,'utf8')) : sourceManifest;
    need(declaration?.schema === 'stellar-forge.utility-receiving-source.v1','Use the complete original Utility source declaration.');
    report.source = {commit:declaration.sourceCommit,files:[]};
    for (const file of declaration.files) {
      const bytes = await readFile(join(sourceRoot,file.path));
      const blob = createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
      need(bytes.length === file.bytes && sha(bytes) === file.sha256 && blob === file.gitBlob,
        'The selected original Utility source differs: '+file.path);
      report.source.files.push({path:file.path,bytes:file.bytes,sha256:file.sha256,gitBlob:blob});
    }
    if (consoleUrl) {
      const target = new URL(consoleUrl);
      need(target.protocol === 'http:' && target.hostname === '127.0.0.1' && !target.search &&
        !target.username && !target.password && target.pathname === '/' &&
        /^[A-Za-z0-9_-]{40,100}$/.test(target.hash.slice(1)),'Use the original private Utility console URL.');
      consoleUrlFile = join(outputDirectory,'borrowed-console.url');
      await writeFile(consoleUrlFile,consoleUrl+'\n',{mode:0o600});
    }
    const moduleRoot = join(sourceRoot,'stellar-forge/mcp-merchant-operator');
    const {openUtilityWorkspace} = await import(pathToFileURL(join(sourceRoot,
      'stellar/scf-starforge-20261009/sf30-seller-sdk/utility-energy/utility-client.mjs')));
    const {utilityEnergyWorkspaceTools} = await import(pathToFileURL(join(moduleRoot,'utility-energy-workspace.mjs')));
    const {initializeUtilityEnergyMerchant} = await import(pathToFileURL(join(moduleRoot,'utility-energy-setup.mjs')));
    const {readMerchantConfig} = await import(pathToFileURL(join(moduleRoot,'config.mjs')));
    const {MerchantReleaseOperator} = await import(pathToFileURL(join(moduleRoot,'operator.mjs')));
    const {writePrivate} = await import(pathToFileURL(join(moduleRoot,'host-files.mjs')));
    const {openUtilityEnergyClient,downloadUtilityEnergyExport,reopenUtilityEnergyExport} =
      await import(pathToFileURL(join(moduleRoot,'utility-energy-client.mjs')));
    const {createMcpToolHandler} = await import(pathToFileURL(join(sourceRoot,'stellar-forge/mcp-paid-agent/http-tools.mjs')));
    const {default:provider} = await import(pathToFileURL(join(moduleRoot,'providers/utility-energy-workspaces.mjs')));
    originalClient = await openUtilityWorkspace({connectionFile:consoleUrlFile,expectedWorkspace:workspaceDirectory});
    const before = await originalClient.state(), launch = await originalClient.launch();
    const beforeSha = sha(canonical(sourceIdentity(before)));
    need(before.applicationSchema === 'stellar-forge.utility-workspace.v1','Attach the original Utility application.');
    if (expectedSourceIdentitySha256) need(beforeSha === expectedSourceIdentitySha256,'The original customer source changed.');
    if (report.original) need(report.original.sourceIdentitySha256 === beforeSha,'The original source changed since this receiving operation.');
    report.original ??= {sourceIdentitySha256:beforeSha,bindingSha256:launch.bindingSha256,
      imports:before.imports.map(row => ({id:row.id,sha256:row.source_sha256,bytes:row.bytes})),
      reviewIds:before.reviews.map(row => row.id),builds:before.builds,
      comparisonIds:before.comparisons.map(row => row.id),reconciliationIds:before.reconciliations.map(row => row.id),
      activeReview:before.active_review,activeBuild:before.active_build,revision:before.revision};
    await save(join(outputDirectory,'original-state.json'),before);
    const configFile = join(outputDirectory,'connection.json');
    await save(configFile,{schema:'stellar-forge.utility-workspace-connection.v1',workspaces:{
      [workspaceAlias]:{label:'Original reviewed utility customer',consoleUrlFile,workspaceDirectory,
        expectedBindingSha256:launch.bindingSha256,files:{},captures:{},buyerWorkspaces:{}}
    }});
    const merchantDirectory=join(outputDirectory,'merchant-host');
    const merchantConfiguration=join(merchantDirectory,'merchant-mcp.json');
    const releaseStore=join(merchantDirectory,'releases');
    const exportsDirectory=join(merchantDirectory,'customer-exports');
    if(!report.hostSetup) {
      try {await lstat(merchantDirectory);throw new Error('This receiving host directory already belongs to another operation.');}
      catch(error){if(error.code!=='ENOENT')throw error;}
      report.hostSetup={directory:merchantDirectory,configuration:merchantConfiguration,
        connection:configFile,requestId:randomUUID(),preparedAt:new Date().toISOString()};
      await checkpoint('ORIGINAL_MERCHANT_SETUP_PREPARED');
    }
    need(report.hostSetup.directory===merchantDirectory&&report.hostSetup.connection===configFile,
      'Reopen this receiving with its original merchant host and console declaration.');
    let rawHost;
    try {rawHost=JSON.parse(await readFile(merchantConfiguration,'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const rawExpected={schema:'stellar-forge.merchant-mcp.v1',name:'Original Utility customer receiving',
      releaseStore,exportsDirectory:'./customer-exports',sources:{},utilityEnergyWorkspaceConnection:configFile};
    if(!rawHost) {
      const nativeReleases=await import(pathToFileURL(join(sourceRoot,
        'stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')));
      let directoryExists=false;
      try {const info=await lstat(merchantDirectory);need(info.isDirectory()&&!info.isSymbolicLink(),
        'The original receiving host must remain a real directory.');directoryExists=true;}
      catch(error){if(error.code!=='ENOENT')throw error;}
      if(directoryExists) {
        // Only this journal's interrupted initializer can own these paths.
        // Existing original release history is read by its native engine.
        const names=await readdir(merchantDirectory);
        need(names.every(name=>['releases','customer-exports'].includes(name)),
          'Review the unexpected original receiving host member before continuing.');
        let state;
        try {state=await nativeReleases.readReleaseState(releaseStore);}
        catch(error) {
          if(error.code!=='ENOENT')throw error;
          for(const path of [join(releaseStore,'releases'),releaseStore]) {
            try {await rmdir(path);}catch(remove){if(remove.code!=='ENOENT')throw remove;}
          }
          await nativeReleases.initReleaseStore(releaseStore);
          state=await nativeReleases.readReleaseState(releaseStore);
        }
        need(state.generation===0&&state.active===null&&state.previous===null&&state.history.length===0,
          'The receiving initializer has an existing original release operation; inspect that operation first.');
        await mkdir(exportsDirectory,{recursive:true,mode:0o700});
        await writePrivate(merchantConfiguration,rawExpected);
      } else await initializeUtilityEnergyMerchant({directory:merchantDirectory,connection:configFile,
        name:rawExpected.name});
      rawHost=JSON.parse(await readFile(merchantConfiguration,'utf8'));
    }
    need(canonical(rawHost)===canonical(rawExpected),'The original receiving merchant configuration changed.');
    const configuration=await readMerchantConfig(merchantConfiguration);
    need(configuration.utilityEnergyWorkspaces?.workspaces?.[workspaceAlias]?.consoleUrlFile===consoleUrlFile,
      'The original configured registry did not bind this Utility console.');
    report.hostSetup.completedAt??=new Date().toISOString();
    const definition = (name,description,properties,required,annotations = {}) => ({
      name,description,annotations,inputSchema:{type:'object',properties,required,additionalProperties:false}
    });
    const tools = utilityEnergyWorkspaceTools(definition), toolNames = tools.map(tool => tool.name).sort();
    need(toolNames.length === 22 && new Set(toolNames).size === toolNames.length &&
      canonical(toolNames) === canonical([...declaration.toolNames].sort()) &&
      provider.id === 'utility-energy-workspaces' && provider.tools(definition).length === toolNames.length,
    'The original configured Utility catalog or declaration changed.');
    const token = randomBytes(32).toString('base64url'), environment = {UTILITY_RECEIVING_MCP_TOKEN:token};
    async function attach() {
      const adapter = new MerchantReleaseOperator(configuration);
      const server = createServer(createMcpToolHandler(adapter,{
        bearerToken:token,serverName:'starforge-utility-customer-receiving',serverVersion:'0.1.0',
        maxRequestBytes:adapter.maxRequestBytes,instructions:provider.instructions.map(row => row.text).join('\n')
      }));
      let closed;
      try {
        await new Promise((yes,no) => {server.once('error',no);server.listen(0,'127.0.0.1',() => {server.off('error',no);yes();});});
        const endpoint = 'http://127.0.0.1:'+server.address().port+'/mcp';
        const client = await openUtilityEnergyClient({url:endpoint,tokenEnv:'UTILITY_RECEIVING_MCP_TOKEN',environment});
        return {adapter,server,client,endpoint,close() {
          closed ??= (async () => {
            await adapter.close();
            const done = new Promise((yes,no) => server.close(error => error ? no(error) : yes()));
            server.closeIdleConnections?.();await done;
          })();return closed;
        }};
      } catch (error) {
        await adapter.close().catch(()=>{});
        if (server.listening) {const done=new Promise(yes=>server.close(yes));server.closeIdleConnections?.();await done;}
        throw error;
      }
    }
    owned = await attach();
    const catalog = await rpc(owned.endpoint,token,'tools/list');
    const advertised=catalog.result?.tools?.map(row=>row.name).sort();
    need(Array.isArray(advertised)&&canonical(advertised)===canonical(owned.adapter.tools.map(row=>row.name).sort())&&
      canonical(advertised.filter(name=>name.startsWith('merchant_utility_')))===canonical(toolNames),
      'The authenticated original merchant host advertised a different Utility catalog.');
    report.toolNames=toolNames;report.toolCount=toolNames.length;
    report.merchantHost={configurationFile:merchantConfiguration,advertisedToolCount:advertised.length,
      originalOperator:'MerchantReleaseOperator',profile:owned.adapter.inspectHost()};
    const status = await owned.client.status({workspace:workspaceAlias});
    need(status.launch.bindingSha256 === launch.bindingSha256 && sha(canonical(sourceIdentity(status.state))) === beforeSha,
      'The MCP borrower attached to a different source or owner.');
    await checkpoint('ORIGINAL_CONSOLE_AND_CATALOG_BOUND');
    report.inventories = {};
    for (const kind of ['imports','reviews','builds','comparisons','reconciliations','captures','operations']) {
      let offset=0,snapshot;const rows=[];
      do {
        const native=(await owned.client.inventory({workspace:workspaceAlias,kind,offset,limit:50,
          ...(snapshot?{expectedSnapshot:snapshot}:{})})).native;
        snapshot ??= native.snapshot;need(native.snapshot===snapshot,'The original inventory changed during receiving.');
        rows.push(...native.items);offset=native.nextOffset;
      } while(offset!==null);
      report.inventories[kind]={count:rows.length,snapshot};
      await save(join(outputDirectory,'inventory-'+kind+'.json'),rows);
    }
    let offset=0,total=null;const recordIds=new Set();let firstRecord;
    do {
      const native=(await owned.client.records({workspace:workspaceAlias,kind:'interval',offset,limit:200})).native;
      total ??= native.total;need(total===native.total && native.offset===offset,'Original interval page identity changed.');
      for(const row of native.rows){need(typeof row.row_id==='string'&&!recordIds.has(row.row_id),'An original interval record repeated.');recordIds.add(row.row_id);firstRecord ??= row;}
      offset=native.next_offset;
    } while(offset!==null);
    need(recordIds.size===total,'The complete original interval inventory did not finish.');
    report.intervalRecords={total,unique:recordIds.size};
    if(firstRecord) await save(join(outputDirectory,'original-full-interval.json'),
      (await owned.client.inspect({workspace:workspaceAlias,kind:'record',id:firstRecord.row_id})).native);
    await save(join(outputDirectory,'original-series.json'),(await owned.client.series({workspace:workspaceAlias})).native);
    for(const review of before.reviews)
      await save(join(outputDirectory,'review-'+review.id+'.json'),
        (await owned.client.inspect({workspace:workspaceAlias,kind:'review',id:review.id})).native);
    const selectedReview = reviewId ?? before.active_review;
    need(before.reviews.some(row=>row.id===selectedReview),'Select the original completed review for delivery.');
    if(finalExport) {
      if(!report.finalExportRequest) {
        const current=(await owned.client.status({workspace:workspaceAlias})).state;
        report.finalExportRequest={requestId:randomUUID(),expectedRevision:current.revision,
          action:'package.export',payload:{review_id:selectedReview},dispatched:false};
        await checkpoint('FINAL_ORIGINAL_EXPORT_PREPARED');
      }
      const selected=report.finalExportRequest;
      need(selected.payload.review_id===selectedReview,'The saved final export belongs to another review.');
      let result;
      if(!selected.dispatched) {
        selected.dispatched=true;await checkpoint('FINAL_ORIGINAL_EXPORT_DISPATCHED');
        result=(await owned.client.action({workspace:workspaceAlias,action:selected.action,
          payload:selected.payload,expectedRevision:selected.expectedRevision,requestId:selected.requestId})).native;
      } else {
        const operation=(await owned.client.operation({workspace:workspaceAlias,requestId:selected.requestId})).native;
        need(operation.status==='COMPLETE','Read and resolve the same original export operation before continuing.');
        result={result:operation.result};
      }
      const operation=(await owned.client.operation({workspace:workspaceAlias,requestId:selected.requestId})).native;
      need(operation.status==='COMPLETE' && operation.action==='package.export','The original final export is not complete.');
      const exported=result.result ?? result;
      need(exported.id===operation.result.id,'The exact operation reader returned a different export.');
      report.nativeExportId=exported.id;report.exportOperation=operation;
      await checkpoint('FINAL_ORIGINAL_EXPORT_RECOVERED');
    } else {
      report.nativeExportId ??= exportId ?? [...before.exports].reverse().find(row=>row.review_id===selectedReview)?.id;
      need(report.nativeExportId,'Select the existing complete customer export or explicitly retain the final export.');
    }
    const manifest=(await owned.client.inspect({workspace:workspaceAlias,kind:'export',id:report.nativeExportId})).native;
    need(manifest.review_id===selectedReview && Array.isArray(manifest.files),'The original customer export differs from the selected review.');
    await save(join(outputDirectory,'original-customer-manifest.json'),manifest);
    const stable=(await owned.client.status({workspace:workspaceAlias})).state;
    need(sha(canonical(sourceIdentity(stable)))===beforeSha,'Original source changed during final customer export.');
    report.revisionAfterExport=stable.revision;
    const selections=[
      {kind:'delivery',exportId:report.nativeExportId},
      {kind:'workspace'},
      {kind:'export-file',exportId:report.nativeExportId,name:'delivery.json'},
      ...manifest.files.filter(file=>['dataset.csv','dataset.json','source.json','query.json'].includes(file.name))
        .map(file=>({kind:'export-file',exportId:report.nativeExportId,name:file.name})),
      ...(before.imports[0]?[{kind:'original',id:before.imports[0].id}]:[]),
      ...(before.comparisons[0]?[{kind:'changes',id:before.comparisons[0].id}]:[]),
      ...(before.active_build?[{kind:'native-project',id:before.active_build}]:[])
    ];
    await mkdir(join(outputDirectory,'received'),{recursive:true,mode:0o700});
    for(let index=0;index<selections.length;index++) {
      const selection=selections[index],key=sha(canonical(selection));
      let item=report.downloads.find(row=>row.selectionKey===key);
      if(!item) {
        const originalFile=selection.kind==='export-file' ? manifest.files.find(file=>file.name===selection.name) :
          selection.kind==='original' ? before.imports.find(row=>row.id===selection.id) : null;
        const expectedSha256=originalFile?.sha256 ?? originalFile?.source_sha256;
        const prepared=await owned.client.filePrepare({workspace:workspaceAlias,selection,
          expectedRevision:stable.revision,...(expectedSha256?{expectedSha256}:{})});
        item={selectionKey:key,selection,exportId:prepared.exportId,manifestSha256:prepared.manifestSha256,
          originalFile:prepared.manifest.files[0],directory:join(outputDirectory,'received','file-'+String(index).padStart(3,'0'))};
        report.downloads.push(item);await checkpoint('COMPLETE_FILE_PREPARED_'+index);
      }
      const received=await downloadUtilityEnergyExport({client:owned.client,directory:item.directory,
        exportId:item.exportId,expectedManifestSha256:item.manifestSha256});
      const reopened=await reopenUtilityEnergyExport({directory:item.directory,exportId:item.exportId,
        expectedManifestSha256:item.manifestSha256});
      need(received.state==='COMPLETE' && reopened.state==='REOPENED' && received.bytes===item.originalFile.bytes,
        'The complete original Utility file did not receive and reopen.');
      const handle=await open(join(item.directory,item.originalFile.name),'r');
      try {
        const digest=createHash('sha256');let length=0;
        for await(const chunk of handle.createReadStream({start:0,autoClose:false})) {length+=chunk.length;digest.update(chunk);}
        need(length===item.originalFile.bytes && digest.digest('hex')===item.originalFile.sha256,'The received original file changed.');
      } finally {await handle.close();}
      Object.assign(item,{state:received.state,reopened:reopened.state,bytes:received.bytes});
      await checkpoint('COMPLETE_FILE_RECEIVED_'+index);
    }
    await owned.close();owned=null;
    const afterDetach=await originalClient.state();
    need(afterDetach.revision===stable.revision && sha(canonical(sourceIdentity(afterDetach)))===beforeSha,
      'Closing the MCP borrower changed the original owner.');
    owned=await attach();
    const reattached=await owned.client.reopen({workspace:workspaceAlias});
    need(reattached.launch.bindingSha256===launch.bindingSha256 && reattached.state.revision===stable.revision,
      'The same original console did not reattach.');
    const first=report.downloads[0];
    if(first) {
      const saved=await owned.client.manifest({exportId:first.exportId});
      need(saved.manifestSha256===first.manifestSha256,'The retained export changed after the MCP borrower reopened.');
    }
    await owned.close();owned=null;
    const final=await originalClient.state();
    need(final.revision===stable.revision && sha(canonical(sourceIdentity(final)))===beforeSha,
      'The final original source changed after client close.');
    report.final={sourceIdentitySha256:beforeSha,revision:final.revision,bindingSha256:launch.bindingSha256,
      originalOwnerAvailable:true,mcpClosed:true,downloads:report.downloads.length};
    report.status='COMPLETE';report.passed=true;report.completedAt=new Date().toISOString();
    delete report.error;
    await checkpoint('COMPLETE');
  } catch(error) {
    failure=error;report.status='FAILED';report.passed=false;
    report.error={code:error.code ?? null,message:String(error.message),requestId:error.requestId ?? null,
      stack:String(error.stack).slice(0,5000)};
    await checkpoint('RETAINED_CONTINUATION_REQUIRED').catch(()=>{});
  } finally {
    for(const value of [owned,originalClient]) {
      try {await value?.close();} catch(error) {if(!failure)failure=error;}
    }
  }
  if(failure) {failure.utilityReceiving=report;throw failure;}
  return report;
}
export { sourceIdentity as utilityEnergySourceIdentity };

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const input=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
  const report=await runUtilityEnergyMcpJourney(input);
  process.stdout.write(JSON.stringify({status:report.status,passed:report.passed,toolCount:report.toolCount,
    original:report.original,final:report.final,nativeExportId:report.nativeExportId})+'\n');
}

// MIT. Receive the complete original Redis product through its installed Applications lifecycle.
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = 'stellar/scf-starforge-20261009/';
const SCHEMA = 'stellar-forge.redis-managed-reception.v1';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const moduleAt = (root, path) => import(pathToFileURL(join(root, ROOT + path)).href);
function requireValue(value, code) {
  if (!value) throw Object.assign(new Error(code), { code });
}
function expectedArgument(args, name, value) {
  const indices = args.flatMap((part, index) => part === name ? [index] : []);
  requireValue(indices.length === 1 && args[indices[0] + 1] === value, 'REDIS_RECEIVING_BINDING_CHANGED');
}

export async function receiveRedisManagedApplication(config, { onProgress = () => {} } = {}) {
  for (const key of ['runtimeDirectory', 'redisDirectory', 'receptionDirectory'])
    requireValue(typeof config[key] === 'string' && isAbsolute(config[key]), 'REDIS_RECEIVING_PATH_REQUIRED');
  requireValue(/^[a-f0-9]{40}$/.test(config.expectedSourceCommit ?? '') &&
    /^[a-f0-9]{64}$/.test(config.expectedManifest ?? ''), 'REDIS_RECEIVING_INSTALLED_SOURCE_REQUIRED');
  const bootstrapSourceRoot = config.bootstrapSourceRoot ?? join(config.runtimeDirectory, 'package', 'source');
  requireValue(typeof bootstrapSourceRoot === 'string' && isAbsolute(bootstrapSourceRoot), 'REDIS_RECEIVING_PATH_REQUIRED');
  const { inspectMerchantRuntime } = await moduleAt(bootstrapSourceRoot, 'sf46-release/runtime-package.mjs');
  const installed = await inspectMerchantRuntime(config.runtimeDirectory,
    { expectedManifest: config.expectedManifest, load: false });
  requireValue(installed.sourceCommit === config.expectedSourceCommit, 'REDIS_RECEIVING_SOURCE_CHANGED');
  const { createRuntimeWorkspace, openRuntimeWorkspace } =
    await moduleAt(installed.sourceRoot, 'distribution/runtime-workspace/model.mjs');
  const { inspectRedisWorkspaceBinding } = await moduleAt(installed.sourceRoot, 'sf30-seller-sdk/redis/workspace/model.mjs');
  const { managedCommandAlive } = await moduleAt(installed.sourceRoot, 'distribution/runtime-workspace/managed-workspace.mjs');
  const { makePrivate, privateDirectory, readJSON, saveJSON, operationLease } =
    await moduleAt(installed.sourceRoot, 'distribution/runtime-workspace/storage.mjs');
  if (config.applicationWorkspace !== undefined)
    requireValue(typeof config.applicationWorkspace === 'string' && isAbsolute(config.applicationWorkspace), 'REDIS_RECEIVING_PATH_REQUIRED');
  const observed = await inspectRedisWorkspaceBinding(config.redisDirectory, {includeConnection:true, includeSetupOrigin:true});
  if (config.requireConnectionDescription)
    requireValue(observed.connection?.schema === 'stellar-forge.redis-workspace-connection.v1', 'REDIS_RECEIVING_CONNECTION_DESCRIPTION_REQUIRED');
  const expectedKinds = config.expectedQueryKinds === undefined ? null : [...config.expectedQueryKinds].sort();
  requireValue(expectedKinds === null || expectedKinds.length > 0 && expectedKinds.every(kind =>
    ['get','hash','sorted-set','stream','list','set'].includes(kind)), 'REDIS_RECEIVING_PRODUCT_KINDS_INVALID');
  try { await makePrivate(config.receptionDirectory); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(config.receptionDirectory); }
  const lease = await operationLease(join(config.receptionDirectory, 'receiving.lock'));
  const receiptPath = join(config.receptionDirectory, 'redis-managed-reception.json');
  let journal, continuing = false, stage = 'OPEN_RECEIVING';
  try {
    journal = await readJSON(receiptPath, true); continuing = Boolean(journal);
    const applicationWorkspace = config.applicationWorkspace ?? join(config.receptionDirectory, 'runtime-workspace');
    const selection = {
      runtimeDirectory: installed.directory, sourceCommit: installed.sourceCommit,
      sourceManifestSha256: installed.sourceManifestSha256, installationId: installed.installationId,
      redisDirectory: observed.directory, workspaceId: observed.workspaceId, profileSha256: observed.profileSha256,
      environmentFile: config.environmentFile ?? null, applicationWorkspace, homeId: config.homeId ?? null,
      ...(expectedKinds ? {expectedQueryKinds:expectedKinds} : {}),
      ...(observed.setupOrigin ? {setupOrigin:observed.setupOrigin} : {}),
      ...(config.existingApplication ? {originalApplicationId:config.existingApplication.applicationId} : {}),
    };
    if (journal) {
      requireValue(journal.schema === SCHEMA &&
        JSON.stringify(journal.selection) === JSON.stringify(selection), 'REDIS_RECEIVING_SELECTION_CHANGED');
    } else {
      journal = { schema: SCHEMA, createdAt: new Date().toISOString(), selection,
        baselineHead: observed.head, applicationWorkspace,
        saveRequestId: config.existingApplication?.saveRequestId ?? randomUUID(),
        ...(config.existingApplication ? {applicationId:config.existingApplication.applicationId,
          configurationRevision:config.existingApplication.configurationRevision,
          configurationReviewId:config.existingApplication.configurationReviewId,
          originalSetupOperationId:config.existingApplication.operationId} : {}), passes: [
          { name: 'first-open', requestId: randomUUID() },
          { name: 'reopen', requestId: randomUUID() },
        ] };
      await saveJSON(receiptPath, journal);
    }
    const persist = async () => { journal.updatedAt = new Date().toISOString(); await saveJSON(receiptPath, journal, true); };
    const progress = value => onProgress({ stage, applicationId: journal.applicationId ?? null, ...value });
    if (journal.completedAt) return journal;
    let existing;
    try { existing = await readFile(join(journal.applicationWorkspace, 'workspace.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!existing) {
      requireValue(!config.applicationWorkspace, 'REDIS_RECEIVING_EXISTING_APPLICATIONS_WORKSPACE_MISSING');
      await createRuntimeWorkspace({ directory: journal.applicationWorkspace });
    }
    let model = await openRuntimeWorkspace({ directory: journal.applicationWorkspace });
    const attached = await model.attach({ directory: installed.directory, label: config.label ?? 'Redis managed merchant' });
    journal.runtimeId = attached.runtimeId; await persist();
    const checkBinding = command => {
      requireValue(command.command === 'redis', 'REDIS_RECEIVING_COMMAND_CHANGED');
      expectedArgument(command.args, '--directory', selection.redisDirectory);
      expectedArgument(command.args, '--expected-workspace-id', selection.workspaceId);
      expectedArgument(command.args, '--expected-profile-sha256', selection.profileSha256);
      expectedArgument(command.args, '--port', '0');
      if (config.requireConnectionDescription) {
        const binding = command.redis?.binding;
        requireValue(binding && !Object.hasOwn(binding,'head') &&
          binding.workspaceId === observed.workspaceId && binding.profileSha256 === observed.profileSha256 &&
          JSON.stringify(binding.connection) === JSON.stringify(observed.connection) &&
          JSON.stringify(binding.environmentNames) === JSON.stringify(observed.environmentNames),
          'REDIS_RECEIVING_REVIEW_DESCRIPTOR_CHANGED');
      }
    };
    const app = async () => {
      const value = (await model.applicationsState()).applications.find(item => item.id === journal.applicationId);
      requireValue(value, 'REDIS_RECEIVING_APPLICATION_MISSING');
      return value;
    };
    const awaitState = async (label, accept, recover) => {
      const started = Date.now(), recoveredStates = new Set(); let nextProgress = started;
      for (;;) {
        const value = await app();
        const interrupted = value.phase === 'INTERRUPTED' || value.adoption?.phase === 'INTERRUPTED';
        if (value.phase === 'INTERRUPTED' && value.current?.state)
          value.receivingCommandAlive = await managedCommandAlive(value.current.state);
        if (accept(value)) return value;
        if (interrupted && recover && !value.receivingCommandAlive) {
          const current = value.current ?? value.adoption;
          const key = JSON.stringify([current?.id, current?.phase]);
          if (!recoveredStates.has(key)) {
            recoveredStates.add(key); await recover(value); continue;
          }
        }
        if (['FAILED', 'UNAVAILABLE', 'STOPPED'].includes(value.phase) || value.adoption?.phase === 'FAILED')
          throw Object.assign(new Error('Read the retained original operation outcome in this receiving receipt'),
            { code: value.phase === 'STOPPED' ? 'REDIS_RECEIVING_NATIVE_PASS_ENDED' : 'REDIS_RECEIVING_OPERATION_REQUIRES_RECOVERY' });
        if (Date.now() >= nextProgress) {
          progress({ label, phase: value.phase, operationId: value.current?.id ?? value.adoption?.id ?? null });
          nextProgress = Date.now() + 15000;
        }
        if (config.waitTimeoutMs !== undefined && Date.now() - started > config.waitTimeoutMs)
          throw Object.assign(new Error('Continue this same retained receiving receipt and operation'),
            { code: 'REDIS_RECEIVING_OPERATION_PENDING' });
        await delay(1000);
      }
    };
    if (!journal.configurationReviewId) {
      stage = 'REVIEW_CONFIGURATION';
      const review = await model.applicationsReview({ runtimeId: attached.runtimeId, kind: 'redis',
        label: config.label ?? 'Redis managed merchant',
        ...(config.homeId ? { homeId: config.homeId } : {}),
        settings: { workspaceDirectory: selection.redisDirectory, port: 0,
          ...(config.environmentFile ? { environmentFile: config.environmentFile } : {}) } });
      checkBinding(review.command);
      journal.configurationReviewId = review.id; await persist();
    }
    if (!journal.applicationId) {
      stage = 'SAVE_AND_ADOPT';
      const saved = await model.applicationsSave({ requestId: journal.saveRequestId, reviewId: journal.configurationReviewId });
      journal.applicationId = saved.applicationId; journal.configurationRevision = saved.revision;
      journal.adoptionOperationId = saved.connection?.operationId ?? saved.connection?.id ?? null;
      await persist();
      if (saved.connectionError) throw Object.assign(new Error(saved.connectionError.message),
        { code: saved.connectionError.code });
    }
    if (config.existingApplication) {
      const originalSetup=config.existingApplication,saved=await app();
      requireValue(originalSetup.applicationWorkspace===journal.applicationWorkspace &&
        originalSetup.redisDirectory===selection.redisDirectory && originalSetup.homeId===config.homeId &&
        originalSetup.sourceCommit===installed.sourceCommit &&
        originalSetup.sourceManifestSha256===installed.sourceManifestSha256 &&
        originalSetup.installationId===installed.installationId &&
        saved.homeId===originalSetup.homeId && saved.runtimeId===attached.runtimeId &&
        saved.settings.workspaceDirectory===selection.redisDirectory &&
        saved.saveRequestId===originalSetup.saveRequestId && saved.reviewId===originalSetup.configurationReviewId &&
        observed.setupOrigin?.operationId===originalSetup.operationId &&
        observed.setupOrigin?.setupId===originalSetup.setupId &&
        observed.setupOrigin?.inputSha256===originalSetup.inputSha256,
        'REDIS_RECEIVING_ORIGINAL_APPLICATION_CHANGED');
    }
    stage = 'CONNECT_ORIGINAL_RUNTIME';
    await model.applicationsConnect({ applicationId: journal.applicationId });
    const recoverAdoption = async value => {
      const operation = value.adoption;
      if (!operation || operation.active) return;
      journal.adoptionOperationId = operation.id;
      journal.adoptionRecovery = { at: new Date().toISOString(), result: operation.phase === 'QUEUED' ?
        await model.resumeQueued(operation.id) : await model.recoverManagedOperation(operation.id) };
      await persist();
    };
    const connection = await app();
    if (!connection.release && connection.adoption && !connection.adoption.active &&
        (connection.adoption.phase === 'INTERRUPTED' ||
          continuing && ['QUEUED', 'FAILED'].includes(connection.adoption.phase)))
      await recoverAdoption(connection);
    await awaitState('Original managed runtime adoption', value => Boolean(value.release), recoverAdoption);
    for (const pass of journal.passes) {
      if (pass.stoppedAt) continue;
      model = await openRuntimeWorkspace({ directory: journal.applicationWorkspace });
      if (!pass.reviewId) {
        stage = 'REVIEW_' + pass.name.toUpperCase();
        const review = await model.applicationsStartReview({ applicationId: journal.applicationId });
        checkBinding(review.command); pass.reviewId = review.id; await persist();
      }
      const recoverPass = async () => {
        pass.recovery = { at: new Date().toISOString(),
          result: await model.applicationsRecover({ applicationId: journal.applicationId, operationId: pass.requestId }) };
        await persist();
      };
      const ownedUrl = value => value.current?.id === pass.requestId ?
        value.current.privateUrl ?? (value.receivingCommandAlive ? value.current.url?.url : null) : null;
      if (!pass.opened) {
        stage = 'START_' + pass.name.toUpperCase();
        const savedRun = (await app()).runs.find(value => value.id === pass.requestId);
        if (savedRun) await recoverPass();
        else await model.applicationsStart({ applicationId: journal.applicationId,
          requestId: pass.requestId, reviewId: pass.reviewId });
        const running = await awaitState('Original Redis startup',
          value => Boolean(ownedUrl(value)), recoverPass);
        const url = new URL(ownedUrl(running));
        requireValue(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
          /^[a-f0-9]{64}$/.test(url.hash.slice(1)), 'REDIS_RECEIVING_ORIGINAL_URL_REQUIRED');
        const get = async path => {
          const response = await fetch(new URL(path, url), {
            headers: { 'x-workspace-token': url.hash.slice(1) }, signal: AbortSignal.timeout(15000),
          });
          requireValue(response.ok, 'REDIS_RECEIVING_ORIGINAL_BROWSER_READ_FAILED');
          return response.json();
        };
        const post = async (path, input) => {
          const response = await fetch(new URL(path,url), {method:'POST',
            headers:{'x-workspace-token':url.hash.slice(1), origin:url.origin, 'content-type':'application/json'},
            body:JSON.stringify(input), signal:AbortSignal.timeout(65000)});
          const value = await response.json();
          requireValue(response.ok, value.error ?? 'REDIS_RECEIVING_ORIGINAL_BROWSER_OPERATION_FAILED');
          return value;
        };
        const state = await get('/api/state');
        requireValue(state.schema === 'stellar-forge.redis-authoring-workspace.v1' &&
          state.workspace?.id === selection.workspaceId, 'REDIS_RECEIVING_ORIGINAL_WORKSPACE_CHANGED');
        const revision = await get('/api/revision?id=' + journal.baselineHead);
        requireValue(revision.id === journal.baselineHead, 'REDIS_RECEIVING_SAVED_REVISION_MISSING');
        const products = revision.source?.queries;
        requireValue(products && typeof products === 'object', 'REDIS_RECEIVING_SAVED_PRODUCTS_MISSING');
        const kinds = Object.values(products).map(query=>query.kind).sort();
        if (expectedKinds) requireValue(JSON.stringify(kinds) === JSON.stringify(expectedKinds),
          'REDIS_RECEIVING_PRODUCT_KINDS_CHANGED');
        const original = await inspectRedisWorkspaceBinding(selection.redisDirectory, {includeConnection:true,includeSetupOrigin:true});
        if (selection.setupOrigin) requireValue(JSON.stringify(original.setupOrigin) === JSON.stringify(selection.setupOrigin),
          'REDIS_RECEIVING_SETUP_ORIGIN_CHANGED');

        if (config.previewAll) {
          journal.sourceReads ??= [];
          if (pass.name === 'first-open') {
            for (const [query, declaration] of Object.entries(products)) {
              let input = structuredClone(config.previewInputs?.[query] ?? {}), page = 0;
              const inputs = new Set();
              for (;;) {
                const inputKey = JSON.stringify(input);
                requireValue(!inputs.has(inputKey), 'REDIS_RECEIVING_CONTINUATION_REPEATED');
                inputs.add(inputKey);
                let retained = journal.sourceReads.find(value=>value.query===query && value.page===page);
                if (!retained) {
                  retained = {query, kind:declaration.kind, page, input:structuredClone(input), requestId:'managed-'+randomUUID()};
                  journal.sourceReads.push(retained); await persist();
                }
                requireValue(JSON.stringify(retained.input) === inputKey, 'REDIS_RECEIVING_PREVIEW_INPUT_CHANGED');
                let result = await post('/api/preview', {requestId:retained.requestId,
                  revisionId:journal.baselineHead, query, input});
                if (result.status === 'INTERRUPTED') result = await post('/api/resume',{requestId:retained.requestId});
                requireValue(result.status === 'COMPLETED' && result.result?.data,
                  result.error?.code ?? 'REDIS_RECEIVING_SOURCE_PREVIEW_FAILED');
                const data = result.result.data, bytes = JSON.stringify(data);
                const resultSha256 = sha256(bytes);
                if (retained.resultSha256) requireValue(retained.resultSha256 === resultSha256,
                  'REDIS_RECEIVING_RETAINED_PREVIEW_CHANGED');
                Object.assign(retained,{resultSha256,bytes:Buffer.byteLength(bytes),rowCount:data.rowCount,
                  nextInput:data.nextInput ?? null,completedAt:retained.completedAt ?? new Date().toISOString()});
                await persist();
                // A native Set page may be empty and still have a real cursor.
                // Continue exactly the source's nextInput until it is absent.
                if (data.nextInput === undefined || data.nextInput === null) break;
                requireValue(typeof data.nextInput === 'object' && !Array.isArray(data.nextInput),
                  'REDIS_RECEIVING_SOURCE_CONTINUATION_INVALID');
                input=structuredClone(data.nextInput);page++;
              }
            }
          } else {
            for (const retained of journal.sourceReads) {
              const replay = await get('/api/operation?id='+encodeURIComponent(retained.requestId));
              requireValue(replay.status==='COMPLETED' &&
                sha256(JSON.stringify(replay.result?.data)) === retained.resultSha256,
                'REDIS_RECEIVING_COLD_RESPONSE_CHANGED');
            }
          }
        }
        const customerFiles = [];
        if (config.customerPackageId) {
          const prepared = await get('/api/operation?id='+encodeURIComponent(config.customerPackageId));
          requireValue(prepared.kind==='prepare' && prepared.status==='COMPLETED' && prepared.result?.files,
            'REDIS_RECEIVING_CUSTOMER_PACKAGE_REQUIRED');
          for (const [name, file] of Object.entries(prepared.result.files)) {
            if (name!=='openapi.json' && !name.startsWith('client/')) continue;
            const response=await fetch(new URL('/api/customer-file?package='+encodeURIComponent(prepared.id)+
              '&name='+encodeURIComponent(name),url),{headers:{'x-workspace-token':url.hash.slice(1)},
              signal:AbortSignal.timeout(15000)});
            requireValue(response.ok, 'REDIS_RECEIVING_CUSTOMER_FILE_UNAVAILABLE');
            const bytes=Buffer.from(await response.arrayBuffer()), digest=sha256(bytes);
            requireValue(digest===file.sha256, 'REDIS_RECEIVING_CUSTOMER_FILE_CHANGED');
            customerFiles.push({name,bytes:bytes.length,sha256:digest});
          }
          requireValue(customerFiles.some(file=>file.name==='openapi.json') &&
            customerFiles.some(file=>file.name.startsWith('client/')), 'REDIS_RECEIVING_CUSTOMER_FILES_MISSING');
        }
        requireValue(original.workspaceId === selection.workspaceId && original.profileSha256 === selection.profileSha256,
          'REDIS_RECEIVING_BINDING_CHANGED');
        pass.opened = { observedAt: new Date().toISOString(), originalHead: state.workspace.head,
          retainedRevisionId: revision.id, retainedRevisionSha256: sha256(JSON.stringify(revision)),
          privateUrlSha256: sha256(url.href), port: Number(url.port || 80), workspaceId: original.workspaceId,
          profileSha256: original.profileSha256, queryKinds:kinds,
          ...(original.connection?{connection:original.connection}:{}),
          ...(original.setupOrigin?{setupOrigin:original.setupOrigin}:{}), customerFiles,
          revisionPage: state.revisions.items.map(item => item.id),
          operationPage: state.operations.items.map(item => item.id) };
        await persist(); progress({ operationId: pass.requestId, phase: 'RUNNING', head: state.workspace.head });
      }
      stage = 'STOP_' + pass.name.toUpperCase();
      await model.applicationsStop({ applicationId: journal.applicationId, operationId: pass.requestId });
      const stopped = await awaitState('Original Redis process stop',
        value => value.phase === 'STOPPED' && value.current?.id === pass.requestId && !value.current.active, recoverPass);
      pass.stoppedAt = new Date().toISOString(); pass.terminalPhase = stopped.current.phase;
      await persist(); progress({ operationId: pass.requestId, phase: 'STOPPED' });
    }
    requireValue(journal.passes[0].opened.retainedRevisionSha256 === journal.passes[1].opened.retainedRevisionSha256,
      'REDIS_RECEIVING_SAVED_REVISION_CHANGED');
    requireValue(journal.passes[0].opened.privateUrlSha256 !== journal.passes[1].opened.privateUrlSha256,
      'REDIS_RECEIVING_SESSION_NOT_REOPENED');
    requireValue(JSON.stringify(journal.passes[0].opened.customerFiles) === JSON.stringify(journal.passes[1].opened.customerFiles),
      'REDIS_RECEIVING_CUSTOMER_HANDOVER_CHANGED');
    stage = 'COMPLETED'; journal.completedAt = new Date().toISOString(); delete journal.issue;
    await persist(); progress({ phase: 'COMPLETED', receiptPath }); return journal;
  } catch (error) {
    if (journal) {
      journal.issue = { stage, at: new Date().toISOString(), code: error.code ?? 'REDIS_RECEIVING_FAILED',
        message: String(error.message ?? error).slice(0, 600) };
      await saveJSON(receiptPath, journal, true).catch(() => {});
    }
    throw error;
  } finally { await lease.close(); }
}


// Start the one live setup workspace through the selected original Applications
// home. The browser edits and creates through this managed process; its saved app
// and setup operation are then reused by the ordinary open/reopen receiver.
export async function startRedisManagedSetupJourney({configurationFile,redisDirectory,initial}={}) {
  requireValue(typeof configurationFile==='string' && isAbsolute(configurationFile) &&
    typeof redisDirectory==='string' && isAbsolute(redisDirectory), 'REDIS_RECEIVING_CONFIGURATION_REQUIRED');
  const config=JSON.parse(await readFile(configurationFile,'utf8'));
  for(const key of ['runtimeDirectory','receptionDirectory','applicationWorkspace'])
    requireValue(typeof config[key]==='string' && isAbsolute(config[key]), 'REDIS_RECEIVING_PATH_REQUIRED');
  requireValue(/^[a-f0-9]{40}$/.test(config.expectedSourceCommit??'') &&
    /^[a-f0-9]{64}$/.test(config.expectedManifest??'') && /^[a-f0-9]{24}$/.test(config.homeId??''),
    'REDIS_RECEIVING_EXISTING_APPLICATIONS_HOME_REQUIRED');
  if(config.redisDirectory!==undefined) requireValue(config.redisDirectory===redisDirectory,
    'REDIS_RECEIVING_NATIVE_WORKSPACE_CHANGED');
  const bootstrap=config.bootstrapSourceRoot??join(config.runtimeDirectory,'package','source');
  requireValue(isAbsolute(bootstrap),'REDIS_RECEIVING_PATH_REQUIRED');
  const {inspectMerchantRuntime}=await moduleAt(bootstrap,'sf46-release/runtime-package.mjs');
  const installed=await inspectMerchantRuntime(config.runtimeDirectory,{expectedManifest:config.expectedManifest,load:false});
  requireValue(installed.sourceCommit===config.expectedSourceCommit,'REDIS_RECEIVING_SOURCE_CHANGED');
  const {openRuntimeWorkspace}=await moduleAt(installed.sourceRoot,'distribution/runtime-workspace/model.mjs');
  const {managedCommandAlive}=await moduleAt(installed.sourceRoot,'distribution/runtime-workspace/managed-workspace.mjs');
  const {makePrivate,privateDirectory,readJSON,saveJSON,operationLease}=
    await moduleAt(installed.sourceRoot,'distribution/runtime-workspace/storage.mjs');
  try{await makePrivate(config.receptionDirectory);}
  catch(error){if(error.code!=='EEXIST')throw error;await privateDirectory(config.receptionDirectory);}
  const lease=await operationLease(join(config.receptionDirectory,'setup-receiving.lock'));
  const receiptPath=join(config.receptionDirectory,'redis-managed-setup-reception.json'),
    inputPath=join(config.receptionDirectory,'redis-managed-setup-input.json');
  let journal,model,closing,stage='REVIEW_MANAGED_SETUP';
  try{
    const previousInput=await readJSON(inputPath,true);
    if(previousInput)requireValue(JSON.stringify(previousInput)===JSON.stringify(initial),'REDIS_RECEIVING_SETUP_INPUT_CHANGED');
    else await saveJSON(inputPath,initial);
    const inputSha256=sha256(await readFile(inputPath));
    const selection={runtimeDirectory:installed.directory,sourceCommit:installed.sourceCommit,
      sourceManifestSha256:installed.sourceManifestSha256,installationId:installed.installationId,
      redisDirectory,applicationWorkspace:config.applicationWorkspace,homeId:config.homeId,
      environmentFile:config.environmentFile??null,inputPath,inputSha256};
    journal=await readJSON(receiptPath,true);
    if(journal)requireValue(journal.schema==='stellar-forge.redis-managed-setup-reception.v1' &&
      JSON.stringify(journal.selection)===JSON.stringify(selection),'REDIS_RECEIVING_SELECTION_CHANGED');
    else{
      journal={schema:'stellar-forge.redis-managed-setup-reception.v1',selection,createdAt:new Date().toISOString(),
        saveRequestId:randomUUID(),requestId:randomUUID()};
      await saveJSON(receiptPath,journal);
    }
    const persist=async()=>{journal.updatedAt=new Date().toISOString();await saveJSON(receiptPath,journal,true);};
    const progress=(label,value)=>process.stdout.write(JSON.stringify({redisManagedSetup:{label,stage,
      applicationId:journal.applicationId??null,operationId:journal.requestId,phase:value?.phase??null}})+'\n');
    const app=async()=>{
      const value=(await model.applicationsState()).applications.find(item=>item.id===journal.applicationId);
      requireValue(value,'REDIS_RECEIVING_APPLICATION_MISSING');return value;
    };
    const checkSetup=command=>{
      requireValue(command.command==='redis' && command.args[0]==='workspace' && command.args[1]==='setup' &&
        command.redis?.mode==='setup' && command.redis.directory===redisDirectory &&
        command.redis.inputSha256===inputSha256,'REDIS_RECEIVING_SETUP_REVIEW_CHANGED');
      expectedArgument(command.args,'--directory',redisDirectory);
      expectedArgument(command.args,'--input',inputPath);
      expectedArgument(command.args,'--expected-input-sha256',inputSha256);
      expectedArgument(command.args,'--port','0');
    };
    const waitFor=async(label,accept)=>{
      const began=Date.now(),recoveries=new Set();let nextProgress=0;
      for(;;){
        const value=await app();
        if(value.phase==='INTERRUPTED' && value.current?.state)
          value.receivingCommandAlive=await managedCommandAlive(value.current.state);
        if(accept(value))return value;
        const adoption=!value.release && value.adoption;
        const current=adoption||value.current;
        if(current && !current.active && ['INTERRUPTED','FAILED'].includes(current.phase)){
          const key=JSON.stringify([current.id,current.phase]);
          if(!recoveries.has(key)){
            recoveries.add(key);
            if(adoption)await model.applicationsConnect({applicationId:journal.applicationId});
            else if(!value.receivingCommandAlive)
              await model.applicationsRecover({applicationId:journal.applicationId,operationId:journal.requestId});
            continue;
          }
        }
        requireValue(!['FAILED','UNAVAILABLE','STOPPED'].includes(value.phase) && value.adoption?.phase!=='FAILED',
          'REDIS_RECEIVING_MANAGED_SETUP_ENDED');
        if(Date.now()>=nextProgress){progress(label,value);nextProgress=Date.now()+15000;}
        if(config.waitTimeoutMs!==undefined && Date.now()-began>config.waitTimeoutMs)
          throw Object.assign(new Error('Continue the retained setup operation and receiving receipt.'),{code:'REDIS_RECEIVING_OPERATION_PENDING'});
        await delay(1000);
      }
    };
    model=await openRuntimeWorkspace({directory:config.applicationWorkspace});
    const attached=await model.attach({directory:installed.directory,label:config.label??'Redis managed merchant'});
    journal.runtimeId=attached.runtimeId;await persist();
    if(!journal.configurationReviewId){
      const review=await model.applicationsReview({runtimeId:attached.runtimeId,kind:'redis',
        label:config.label??'Redis managed merchant',homeId:config.homeId,
        settings:{workspaceDirectory:redisDirectory,create:true,setupFile:inputPath,port:0,
          ...(config.environmentFile?{environmentFile:config.environmentFile}:{})}});
      checkSetup(review.command);journal.configurationReviewId=review.id;await persist();
    }
    if(!journal.applicationId){
      const saved=await model.applicationsSave({requestId:journal.saveRequestId,reviewId:journal.configurationReviewId});
      journal.applicationId=saved.applicationId;journal.configurationRevision=saved.revision;await persist();
      if(saved.connectionError)throw Object.assign(new Error(saved.connectionError.message),{code:saved.connectionError.code});
    }
    stage='CONNECT_MANAGED_SETUP';
    await model.applicationsConnect({applicationId:journal.applicationId});
    await waitFor('Original managed runtime adoption',value=>Boolean(value.release));
    if(!journal.startReviewId){
      const review=await model.applicationsStartReview({applicationId:journal.applicationId});
      checkSetup(review.command);journal.startReviewId=review.id;await persist();
    }
    stage='START_MANAGED_SETUP';
    const savedRun=(await app()).runs.find(value=>value.id===journal.requestId);
    if(savedRun)await model.applicationsRecover({applicationId:journal.applicationId,operationId:journal.requestId});
    else await model.applicationsStart({applicationId:journal.applicationId,
      requestId:journal.requestId,reviewId:journal.startReviewId});
    const ownedUrl=value=>value.current?.id===journal.requestId?
      value.current.privateUrl??(value.receivingCommandAlive?value.current.url?.url:null):null;
    const running=await waitFor('Original setup startup',value=>Boolean(ownedUrl(value)));
    expectedArgument(running.current.args,'--setup-operation',journal.requestId);
    const url=new URL(ownedUrl(running));
    requireValue(url.protocol==='http:' && url.hostname==='127.0.0.1' &&
      /^[a-f0-9]{64}$/.test(url.hash.slice(1)),'REDIS_RECEIVING_ORIGINAL_URL_REQUIRED');
    const state=async()=>{
      const response=await fetch(new URL('/api/state',url),{
        headers:{'x-workspace-token':url.hash.slice(1)},signal:AbortSignal.timeout(15000)});
      const value=await response.json();
      requireValue(response.ok && value.schema==='stellar-forge.redis-connection-setup.v1' &&
        value.directory===redisDirectory && value.operationId===journal.requestId,
        'REDIS_RECEIVING_SETUP_STARTUP_CHANGED');return value;
    };
    const original=await state();
    journal.startedAt??=new Date().toISOString();journal.setupId=original.setupId;
    journal.privateUrlSha256=sha256(url.href);await persist();stage='BROWSER_MANAGED_SETUP';
    const summary=()=>({applicationId:journal.applicationId,configurationRevision:journal.configurationRevision,
      configurationReviewId:journal.configurationReviewId,saveRequestId:journal.saveRequestId,
      runtimeId:journal.runtimeId,operationId:journal.requestId,setupId:journal.setupId,inputSha256,
      applicationWorkspace:config.applicationWorkspace,homeId:config.homeId,redisDirectory,
      sourceCommit:installed.sourceCommit,sourceManifestSha256:installed.sourceManifestSha256,
      installationId:installed.installationId,receiptPath,reattachedAt:journal.reattachedAt??null,
      stoppedAt:journal.stoppedAt??null});
    return {url:url.origin,operatorUrl:url.href,token:url.hash.slice(1),operationId:journal.requestId,inputSha256,
      summary,
      async reattach(){
        model=await openRuntimeWorkspace({directory:config.applicationWorkspace});
        await model.applicationsRecover({applicationId:journal.applicationId,operationId:journal.requestId});
        const retained=await waitFor('Reopen original setup operation',value=>Boolean(ownedUrl(value)));
        requireValue(ownedUrl(retained)===url.href,'REDIS_RECEIVING_SETUP_SESSION_CHANGED');
        expectedArgument(retained.current.args,'--setup-operation',journal.requestId);
        const value=await state();
        requireValue(value.setupId===journal.setupId && value.created?.setupOrigin?.operationId===journal.requestId &&
          value.created.setupOrigin.inputSha256===inputSha256,'REDIS_RECEIVING_SETUP_ORIGIN_CHANGED');
        journal.reattachedAt=new Date().toISOString();journal.created=value.created;await persist();return value;
      },
      close(){
        if(closing)return closing;
        closing=(async()=>{
          try{
            stage='STOP_MANAGED_SETUP';
            await model.applicationsStop({applicationId:journal.applicationId,operationId:journal.requestId});
            await waitFor('Original setup process stop',value=>value.phase==='STOPPED' &&
              value.current?.id===journal.requestId && !value.current.active);
            journal.stoppedAt??=new Date().toISOString();await persist();
          }finally{await lease.close();}
        })();return closing;
      }};
  }catch(error){
    if(journal){journal.issue={stage,at:new Date().toISOString(),code:error.code??'REDIS_RECEIVING_FAILED',
      message:String(error.message??error).slice(0,600)};await saveJSON(receiptPath,journal,true).catch(()=>{});}
    await lease.close();throw error;
  }
}

// Called by the original six-product native journey while its Redis fixture and
// selected installed runtime are alive. The existing Applications workspace/home
// is explicit; the native workspace and its source are the already-created one.
export async function runRedisApplicationsJourney({configurationFile,redisDirectory,expectedQueryKinds,customerPackageId,managedSetup}={}) {
  requireValue(typeof configurationFile==='string' && isAbsolute(configurationFile),
    'REDIS_RECEIVING_CONFIGURATION_REQUIRED');
  const config=JSON.parse(await readFile(configurationFile,'utf8'));
  requireValue(typeof config.applicationWorkspace==='string' && isAbsolute(config.applicationWorkspace) &&
    /^[a-f0-9]{24}$/.test(config.homeId ?? ''), 'REDIS_RECEIVING_EXISTING_APPLICATIONS_HOME_REQUIRED');
  if(config.redisDirectory!==undefined) requireValue(config.redisDirectory===redisDirectory,
    'REDIS_RECEIVING_NATIVE_WORKSPACE_CHANGED');
  const result=await receiveRedisManagedApplication({...config,redisDirectory,expectedQueryKinds,
    customerPackageId,previewAll:true,requireConnectionDescription:true,
    ...(managedSetup?{existingApplication:managedSetup}:{})},
    {onProgress:value=>process.stdout.write(JSON.stringify({redisApplications:value})+'\n')});
  return {result:'PASS',applicationId:result.applicationId,workspaceId:result.selection.workspaceId,
    profileSha256:result.selection.profileSha256,sourceCommit:result.selection.sourceCommit,
    sourceManifestSha256:result.selection.sourceManifestSha256,
    applicationWorkspace:result.applicationWorkspace,redisDirectory,
    receipt:join(config.receptionDirectory,'redis-managed-reception.json'),
    setupOrigin:result.selection.setupOrigin ?? null,managedSetup:managedSetup??null,
    sourceReads:result.sourceReads ?? [],passes:result.passes};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  requireValue(process.argv[2], 'REDIS_RECEIVING_CONFIGURATION_REQUIRED');
  const config = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
  const result = await receiveRedisManagedApplication(config, { onProgress: value => process.stdout.write(JSON.stringify(value) + '\n') });
  process.stdout.write(JSON.stringify({ status: 'COMPLETED', applicationId: result.applicationId,
    sourceCommit: result.selection.sourceCommit, workspaceId: result.selection.workspaceId,
    operations: result.passes.map(pass => ({ name: pass.name, requestId: pass.requestId,
      opened: pass.opened.observedAt, stopped: pass.stoppedAt, retainedRevisionId: pass.opened.retainedRevisionId })) }) + '\n');
}

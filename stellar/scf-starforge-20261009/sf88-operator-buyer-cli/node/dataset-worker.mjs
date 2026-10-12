// MIT — Native dataset entry point for the application process boundary.
// Every acquisition, page, lock, recovery and export belongs to the original runtime.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {executeLostOutputCommand} from './dataset-recovery.mjs';
import { absolute, readJson, writeJson, writeBytes, jsonBytes, exists, object, need, safeCode } from './store.mjs';

const [runtimePath, entryPath, command, requestPath, resultPath] = process.argv.slice(2);
const runtime = absolute(runtimePath), entry = absolute(entryPath);
const load = name => import(pathToFileURL(join(runtime, name)).href);
const controller = new AbortController();
const stop = () => controller.abort();
process.once('SIGINT', stop); process.once('SIGTERM', stop);

async function main() {
  const metadata = await readJson(join(entry, 'dataset.json'));
  need(metadata.schema === 'stellar-forge.node-dataset.v1' && metadata.entryDirectory === entry,
    'DATASET_APPLICATION_STATE_INVALID');
  const directory = absolute(metadata.sessionDirectory);
  const api = await load('dataset-session.mjs');
  const { canonical, digest } = await load('dataset-page.mjs');
  const request = await readJson(absolute(requestPath));
  need(Number.isSafeInteger(request.reportLimit) && request.reportLimit >= 1048576 &&
    request.reportLimit <= 268435456, 'DATASET_REPORT_LIMIT_INVALID');
  const bindingPath = join(entry, 'binding.json');
  let binding = await exists(bindingPath) ? await readJson(bindingPath) : null;
  const check = report => {
    need(object(report) && report.schema === 'stellar-forge.sf88.dataset-acquisition.v1' &&
      report.directory === directory, 'DATASET_NATIVE_REPORT_INVALID');
    if (report.status !== 'RUNNING') {
      need(binding && report.configurationSha256 === binding.configurationSha256 &&
        report.sessionId === binding.sessionId && report.expectedSnapshot === binding.expectedSnapshot &&
        canonical(report.limits) === canonical(binding.limits) &&
        (report.workspaceDirectory ?? null) === binding.workspaceDirectory,
      'DATASET_APPLICATION_BINDING_CHANGED');
    }
    return report;
  };
  const bind = async value => {
    const proposed = { schema:'stellar-forge.node-dataset-binding.v1', id:metadata.id,
      sessionDirectory:directory, configurationSha256:value.configurationSha256,
      sessionId:value.sessionId, limits:value.limits, expectedSnapshot:value.expectedSnapshot,
      workspaceDirectory:value.workspaceDirectory ?? null };
    if (binding) need(canonical(binding) === canonical(proposed), 'DATASET_APPLICATION_BINDING_CHANGED');
    else {
      try { await writeJson(bindingPath, proposed, {exclusive:true}); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      binding = await readJson(bindingPath);
      need(canonical(binding) === canonical(proposed), 'DATASET_APPLICATION_BINDING_CHANGED');
    }
  };
  if (binding) need(binding.schema === 'stellar-forge.node-dataset-binding.v1' &&
    binding.id === metadata.id && binding.sessionDirectory === directory,
  'DATASET_APPLICATION_BINDING_CHANGED');

  let result;
  if (command === 'initialize') {
    need(metadata.source?.kind === 'config' || metadata.source?.kind === 'workspace',
      'DATASET_INITIALIZATION_SOURCE_REQUIRED');
    const source = metadata.source.kind === 'config'
      ? await (await load('config.mjs')).config(join(entry, 'config.json'))
      : (await (await load('workspace.mjs')).openWorkspace(['--dir', metadata.source.directory])).config;
    const selected = new URL(source.operation.url).searchParams.get('snapshot');
    await bind({configurationSha256:digest(canonical(source)), sessionId:source.operation.intentId,
      limits:metadata.limits, expectedSnapshot:metadata.expectedSnapshot ?? selected ?? null,
      ...(metadata.source.kind === 'workspace' ? {workspaceDirectory:metadata.source.directory} : {})});
    if (await exists(join(directory, 'session.json'))) result = check(await api.inspectDatasetSession(directory));
    else result = check(await api.createDatasetSession({directory,
      ...(metadata.source.kind === 'workspace' ? {workspaceDirectory:metadata.source.directory}
        : {configPath:join(entry, 'config.json')}), ...metadata.limits,
      expectedSnapshot:metadata.expectedSnapshot}));
  } else if (command === 'attach') {
    need(metadata.source?.kind === 'attached', 'DATASET_ATTACHMENT_SOURCE_REQUIRED');
    result = await api.inspectDatasetSession(directory);
    need(result.status !== 'RUNNING', 'DATASET_SESSION_RUNNING_USE_STATUS');
    await bind(result); check(result);
  } else if(command==='attach-recovery') {
    need(metadata.source?.kind==='attached','DATASET_RECOVERY_ATTACHMENT_REQUIRED');
    const definition=api.validateDatasetDefinition(await readJson(join(directory,'session.json'),262144),directory);
    await bind({configurationSha256:definition.configurationSha256,sessionId:definition.config.operation.intentId,
      limits:definition.limits,expectedSnapshot:definition.expectedSnapshot,
      workspaceDirectory:definition.workspaceDirectory??null});
    result={schema:'stellar-forge.node-dataset-recovery-attachment.v1',directory,
      sessionId:binding.sessionId,configurationSha256:binding.configurationSha256,
      limits:binding.limits,expectedSnapshot:binding.expectedSnapshot,workspaceDirectory:binding.workspaceDirectory};
  } else if(['inspect-lost-output','recover-lost-output','read-lost-output','export-lost-output'].includes(command)) {
    await executeLostOutputCommand({runtime,entry,metadata,binding,request,requestPath:absolute(requestPath),
      resultPath:absolute(resultPath),command,signal:controller.signal});
    return;
  } else if (command === 'accounting' || command === 'finalize') {
    need(binding || command === 'accounting' && request.initializeAccounting === true &&
      metadata.source.kind === 'attached', 'DATASET_INITIALIZE_OR_ATTACH_REQUIRED');
    const definition = await readJson(join(directory, 'session.json'), 262144);
    const selectedBinding = binding ?? {
      sessionId:definition.config?.operation?.intentId, configurationSha256:definition.configurationSha256,
      expectedSnapshot:definition.expectedSnapshot, limits:definition.limits,
      workspaceDirectory:definition.workspaceDirectory ?? null};
    need(definition.schema === 'stellar-forge.sf88.dataset-session.v1' && definition.directory === directory &&
      definition.config?.operation?.intentId === selectedBinding.sessionId &&
      digest(canonical(definition.config)) === selectedBinding.configurationSha256 &&
      definition.configurationSha256 === selectedBinding.configurationSha256 &&
      definition.expectedSnapshot === selectedBinding.expectedSnapshot &&
      canonical(definition.limits) === canonical(selectedBinding.limits) &&
      (definition.workspaceDirectory ?? null) === selectedBinding.workspaceDirectory,
    'DATASET_APPLICATION_BINDING_CHANGED');
    // Accounting does not inspect or require product pages. The original native
    // entrypoint verifies the saved definition, attempts and financial evidence.
    result = await api.accountDatasetSession(directory, {workspace:request.workspaceDirectory ?? undefined,
      offset:request.offset, limit:request.limit, finalize:command === 'finalize', signal:controller.signal,
      outbox:request.outboxDirectory ?? undefined, merchantRoute:request.merchantRoute ?? undefined});
    need(result.schema === 'stellar-forge.sf88.session-accounting.v1' && result.kind === 'dataset' &&
      result.directory === directory && result.sessionId === selectedBinding.sessionId &&
      result.configurationSha256 === selectedBinding.configurationSha256, 'DATASET_ACCOUNTING_BINDING_CHANGED');
    if (request.initializeAccounting === true) await bind(selectedBinding);
    if (result.interrupted) process.exitCode = 130;
    else if (command === 'finalize' && result.entries.some(entry =>
      !['FINALIZED','IDEMPOTENT_FINALIZED','NO_PAYMENT_REQUIRED','NOT_ATTEMPTED'].includes(entry.outcome))) process.exitCode = 2;
  } else {
    need(binding, 'DATASET_INITIALIZE_OR_ATTACH_REQUIRED');
    // Offline inspection checks the immutable original definition before a new run.
    const current = command === 'recover'
      ? await api.recoverDatasetSession(directory) : await api.inspectDatasetSession(directory);
    check(current);
    if (command === 'inspect' || command === 'recover') result = current;
    else if (command === 'run') {
      need(current.status !== 'RUNNING', 'DATASET_SESSION_RUNNING_USE_STATUS');
      result = check(await api.runDatasetSession(directory, {signal:controller.signal,
        environment:process.env, emitPageSummaries:false}));
    } else if (command === 'deliver') {
      need(current.status === 'COMPLETE', 'DATASET_COMPLETE_SESSION_REQUIRED');
      result = await api.deliverDatasetSession(directory, absolute(request.destination));
      need(result.schema === 'stellar-forge.sf88.dataset-delivery.v1' && result.sourceDirectory === directory,
        'DATASET_NATIVE_DELIVERY_INVALID');
    } else if (command === 'manifest') {
      need(current.status === 'COMPLETE', 'DATASET_COMPLETE_SESSION_REQUIRED');
      result = await api.exportDatasetManifest(directory, absolute(request.destination));
    } else need(false, 'DATASET_APPLICATION_COMMAND_INVALID');
  }
  const bytes = jsonBytes({schema:'stellar-forge.node-dataset-command.v1', id:metadata.id, command, result});
  need(bytes.length <= request.reportLimit, 'DATASET_REPORT_LIMIT_EXCEEDED');
  await writeBytes(absolute(resultPath), bytes, {exclusive:true});
}

main().catch(error => {
  process.stderr.write(JSON.stringify({error:safeCode(error?.code, 'DATASET_APPLICATION_COMMAND_FAILED')}) + '\n');
  process.exitCode = 1;
}).finally(() => {
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
});

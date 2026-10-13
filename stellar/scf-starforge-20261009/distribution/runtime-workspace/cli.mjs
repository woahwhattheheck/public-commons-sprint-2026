#!/usr/bin/env node
// MIT. Open the original customer runtime workflow in a private operator browser.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRuntimeWorkspace, openRuntimeWorkspace } from './model.mjs';
import { startRuntimeWorkspace } from './server.mjs';
import { workspaceBackupCommands, workspaceBackupHelp, runWorkspaceBackupCommand } from './workspace-backup-cli.mjs';
import { runtimeProcedureCommands, runtimeProcedureHelp, runRuntimeProcedureCommand } from './operating-procedures-cli.mjs';
import { applicationInputCommands, applicationInputHelp, runApplicationInputCommand } from './application-inputs-cli.mjs';
import { applicationInputSetCommands, applicationInputSetHelp, runApplicationInputSetCommand } from './application-input-sets-cli.mjs';
import { applicationInputEditionCommands, applicationInputEditionHelp, runApplicationInputEditionCommand } from './application-input-set-editions-cli.mjs';
import { readJSON } from './storage.mjs';
import { fail, json, saveJSON, runtimeWorkspaceError } from './storage.mjs';

import { inspectProductPlanBundle, readProductPlanDocument } from './source-product-plans.mjs';
import { saveTextExport } from '../discovery/write-json.mjs';

const HELP = `Starforge customer runtime workspace

  runtime-workspace init --workspace NEW_DIRECTORY [--runtime-home PRIVATE_DIRECTORY]
  runtime-workspace attach --workspace DIRECTORY --runtime EXISTING_RUNTIME [--label NAME]
  runtime-workspace serve --workspace DIRECTORY [--port 8465]
  runtime-workspace status --workspace DIRECTORY [--runtime-id ID]
  runtime-workspace operations --workspace DIRECTORY [--query TEXT --filter all|active|attention|completed --runtime-id ID --limit 20 --cursor TOKEN]
  runtime-workspace operation-status --workspace DIRECTORY --operation-id UUID
  runtime-workspace operation-log --workspace DIRECTORY --operation-id UUID
  runtime-workspace source-plans --workspace DIRECTORY [--query TEXT --limit 30 --cursor ID] [--receiving-query TEXT --receiving-status all --receiving-limit 30 --receiving-cursor ID]
  runtime-workspace source-plan-inspect --document COMPLETE_JSON
  runtime-workspace source-plan-save --workspace DIRECTORY --request COMPLETE_JSON
  runtime-workspace source-plan-open --workspace DIRECTORY --plan-id ID [--binding-id ID]
  runtime-workspace source-plan-refresh --workspace DIRECTORY --plan-id ID [--binding-id ID]
  runtime-workspace source-plan-briefing --workspace DIRECTORY --plan-id ID [--binding-id ID --runtime-id ID] [--format markdown|html|json --output NEW_FILE]
  runtime-workspace source-plan-runtimes --workspace DIRECTORY --plan-id ID [--binding-id ID --output NEW_FILE]
  runtime-workspace source-plan-handoff --workspace DIRECTORY --plan-id ID --runtime-id ID [--binding-id ID --output NEW_FILE]
  runtime-workspace source-plan-export --workspace DIRECTORY --plan-id ID [--output NEW_JSON]
  runtime-workspace source-plan-receive --workspace DIRECTORY --document COMPLETE_JSON --repository ABSOLUTE_GIT [--offline true --python python3]
  runtime-workspace source-plan-receiving --workspace DIRECTORY --receipt-id ID [--output NEW_JSON]
  runtime-workspace source-plan-continue --workspace DIRECTORY --receipt-id ID
  runtime-workspace source-plan-build --workspace DIRECTORY --plan-id ID [--binding-id ID]
  runtime-workspace source-builds --workspace DIRECTORY
  runtime-workspace source-build-catalog --workspace DIRECTORY --request ABSOLUTE_JSON_FILE
  runtime-workspace source-build-review --workspace DIRECTORY --request ABSOLUTE_JSON_FILE
  runtime-workspace source-build-review-show --workspace DIRECTORY --review-id ID
  runtime-workspace source-build-operation --workspace DIRECTORY --request ABSOLUTE_JSON_FILE
  runtime-workspace source-build-continue --workspace DIRECTORY --operation-id UUID
  runtime-workspace python-status --workspace DIRECTORY --runtime-id ID
  runtime-workspace python-review --workspace DIRECTORY --runtime-id ID --python ABS [--extras workbooks,agents|base]
  runtime-workspace python-operation --workspace DIRECTORY --request ABSOLUTE_JSON_FILE
  runtime-workspace python-continue --workspace DIRECTORY --operation-id UUID
  runtime-workspace python-command --workspace DIRECTORY --runtime-id ID --installation-id SHA --command NAME --args ABSOLUTE_JSON_FILE
  runtime-workspace handoff --workspace DIRECTORY --runtime-id ID
  runtime-workspace transfers --workspace DIRECTORY [--transfer-id ID]
  runtime-workspace transfer-review --workspace DIRECTORY --runtime-id ID
  runtime-workspace transfer-attach --workspace DIRECTORY --directory TRANSFER_DIRECTORY [--label NAME]
  runtime-workspace transfer-operation --workspace DIRECTORY --request ABSOLUTE_JSON_FILE
  runtime-workspace transfer-continue --workspace DIRECTORY --operation-id UUID
  runtime-workspace managed-open --workspace DIRECTORY --home HOME [--label NAME]
  runtime-workspace managed-status --workspace DIRECTORY [--home-id ID]
  runtime-workspace managed-review --workspace DIRECTORY --home-id ID --runtime-id ID
  runtime-workspace managed-operation --workspace DIRECTORY --request ABSOLUTE_JSON_FILE
  runtime-workspace managed-recover --workspace DIRECTORY --operation-id UUID
  runtime-workspace managed-stop --workspace DIRECTORY --operation-id UUID
  runtime-workspace managed-config --workspace DIRECTORY --home-id ID [--path RELATIVE_FILE]
  runtime-workspace applications --workspace DIRECTORY [--history-limit 1]
  runtime-workspace application-history --workspace DIRECTORY --application-id ID [--limit 30] [--cursor CURSOR]
  runtime-workspace application-review --workspace DIRECTORY --request PRIVATE_JSON
  runtime-workspace application-save --workspace DIRECTORY --request PRIVATE_JSON
  runtime-workspace application-start-review --workspace DIRECTORY --application-id ID
  runtime-workspace application-start --workspace DIRECTORY --request PRIVATE_JSON
  runtime-workspace application-connect --workspace DIRECTORY --application-id ID
  runtime-workspace application-stop --workspace DIRECTORY --application-id ID --operation-id UUID
  runtime-workspace application-recover --workspace DIRECTORY --application-id ID --operation-id UUID
  runtime-workspace application-output --workspace DIRECTORY --application-id ID --operation-id UUID

${workspaceBackupHelp}
${runtimeProcedureHelp}
${applicationInputHelp}
${applicationInputSetHelp}
${applicationInputEditionHelp}

The private browser receives an original archive or reuses an existing runtime,
reviews exact dependency profiles, prepares and resumes original installations,
compares upgrades, recovers into a new directory and exports the original
source/dependency roots for the existing host and SF46 release controls.
Install workers retain progress and continue across browser/server restarts.
Linux, Node22.16+, Python3.11+, npm and flock are the original installer requirements.
`;
const allowed = {
  ...workspaceBackupCommands,
  ...runtimeProcedureCommands,
  ...applicationInputCommands,
  ...applicationInputSetCommands,
  ...applicationInputEditionCommands,
  'source-plans': ['--workspace', '--query', '--limit', '--cursor', '--receiving-query', '--receiving-status', '--receiving-limit', '--receiving-cursor'],
  'source-plan-inspect': ['--document'],
  'source-plan-save': ['--workspace', '--request'],
  'source-plan-open': ['--workspace', '--plan-id', '--binding-id'],
  'source-plan-build': ['--workspace', '--plan-id', '--binding-id'],
  'source-plan-refresh': ['--workspace', '--plan-id', '--binding-id'],
  'source-plan-briefing': ['--workspace', '--plan-id', '--binding-id', '--format', '--output', '--runtime-id'],
  'source-plan-runtimes': ['--workspace', '--plan-id', '--binding-id', '--output'],
  'source-plan-handoff': ['--workspace', '--plan-id', '--binding-id', '--runtime-id', '--output'],
  'source-plan-export': ['--workspace', '--plan-id', '--output'],
  'source-plan-receive': ['--workspace', '--document', '--repository', '--offline', '--python'],
  'source-plan-receiving': ['--workspace', '--receipt-id', '--output'],
  'source-plan-continue': ['--workspace', '--receipt-id'],
  'source-builds': ['--workspace'],
  'source-build-catalog': ['--workspace', '--request'], 'source-build-review': ['--workspace', '--request'],
  'source-build-review-show': ['--workspace', '--review-id'],
  'source-build-operation': ['--workspace', '--request'], 'source-build-continue': ['--workspace', '--operation-id'],
  applications: ['--workspace', '--history-limit'],
  'application-history': ['--workspace', '--application-id', '--limit', '--cursor'],
  'application-review': ['--workspace', '--request'], 'application-save': ['--workspace', '--request'],
  'application-start': ['--workspace', '--request'],
  'application-start-review': ['--workspace', '--application-id'], 'application-connect': ['--workspace', '--application-id'],
  'application-stop': ['--workspace', '--application-id', '--operation-id'],
  'application-recover': ['--workspace', '--application-id', '--operation-id'],
  'application-output': ['--workspace', '--application-id', '--operation-id'],
  'python-status': ['--workspace', '--runtime-id'],
  'python-review': ['--workspace', '--runtime-id', '--python', '--extras'],
  'python-operation': ['--workspace', '--request'], 'python-continue': ['--workspace', '--operation-id'],
  'python-command': ['--workspace', '--runtime-id', '--installation-id', '--command', '--args'],
  transfers: ['--workspace', '--transfer-id'], 'transfer-review': ['--workspace', '--runtime-id'],
  'transfer-attach': ['--workspace', '--directory', '--label'],
  'transfer-operation': ['--workspace', '--request'], 'transfer-continue': ['--workspace', '--operation-id'],
  'managed-open': ['--workspace', '--home', '--label'], 'managed-status': ['--workspace', '--home-id'],
  'managed-review': ['--workspace', '--home-id', '--runtime-id'], 'managed-operation': ['--workspace', '--request'],
  'managed-recover': ['--workspace', '--operation-id'], 'managed-stop': ['--workspace', '--operation-id'],
  'managed-config': ['--workspace', '--home-id', '--path'],
  init: ['--workspace', '--runtime-home'], attach: ['--workspace', '--runtime', '--label'],
  serve: ['--workspace', '--port'], status: ['--workspace', '--runtime-id'], handoff: ['--workspace', '--runtime-id'],
  operations: ['--workspace', '--query', '--filter', '--runtime-id', '--limit', '--cursor'],
  'operation-status': ['--workspace', '--operation-id'], 'operation-log': ['--workspace', '--operation-id'],
};
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP); return; }
  const [command, ...rest] = argv, options = {};
  if (!allowed[command] || rest.length % 2) fail('RUNTIME_WORKSPACE_ARGUMENTS_INVALID');
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!allowed[command].includes(key) || Object.hasOwn(options, key) || !rest[i + 1] || rest[i + 1].startsWith('--'))
      fail('RUNTIME_WORKSPACE_ARGUMENTS_INVALID');
    options[key] = rest[i + 1];
  }
  if (command === 'source-plan-inspect') {
    if (!options['--document']) fail('PRODUCT_PLAN_DOCUMENT_REQUIRED');
    process.stdout.write(json(inspectProductPlanBundle(await readProductPlanDocument(resolve(options['--document']))))); return;
  }
  if (!options['--workspace']) fail('RUNTIME_WORKSPACE_DIRECTORY_REQUIRED');
  const directory = resolve(options['--workspace']);
  if (command === 'init') {
    process.stdout.write(json(await createRuntimeWorkspace({ directory,
      ...(options['--runtime-home'] ? { runtimeHome: resolve(options['--runtime-home']) } : {}) })));
    return;
  }
  if (command === 'serve') {
    if (options['--port'] !== undefined && !/^(0|[1-9][0-9]{0,4})$/.test(options['--port'])) fail('RUNTIME_WORKSPACE_PORT_INVALID');
    const server = await startRuntimeWorkspace({ directory, port: options['--port'] === undefined ? 8465 : Number(options['--port']) });
    process.stdout.write('Runtime workspace: ' + server.url + '\nOriginal install workers retain their progress when this browser server closes.\n');
    let closing = false;
    const stop = async () => {
      if (closing) return; closing = true;
      try { await server.close(); }
      catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
      finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    return;
  }
  const model = await openRuntimeWorkspace({ directory });
  let result;
  if (Object.hasOwn(workspaceBackupCommands, command)) result = await runWorkspaceBackupCommand(model, command, options);
  else if (Object.hasOwn(runtimeProcedureCommands, command)) result = await runRuntimeProcedureCommand(model, command, options);
  else if (Object.hasOwn(applicationInputEditionCommands, command)) result = await runApplicationInputEditionCommand(model, command, options);
  else if (Object.hasOwn(applicationInputSetCommands, command)) result = await runApplicationInputSetCommand(model, command, options);
  else if (Object.hasOwn(applicationInputCommands, command)) result = await runApplicationInputCommand(model, command, options);
  else if (command === 'operations') {
    if (options['--limit'] !== undefined && !/^(?:[1-9][0-9]?|100)$/.test(options['--limit']))
      fail('RUNTIME_OPERATION_HISTORY_LIMIT_INVALID');
    result = await model.operationHistory({
      ...(options['--query'] !== undefined ? { query: options['--query'] } : {}),
      ...(options['--filter'] !== undefined ? { filter: options['--filter'] } : {}),
      ...(options['--runtime-id'] !== undefined ? { runtimeId: options['--runtime-id'] } : {}),
      ...(options['--limit'] !== undefined ? { limit: Number(options['--limit']) } : {}),
      ...(options['--cursor'] !== undefined ? { cursor: options['--cursor'] } : {}),
    });

  } else if (command === 'source-plans') result = await model.sourcePlansState({
    ...(options['--query'] !== undefined ? { query: options['--query'] } : {}),
    ...(options['--limit'] !== undefined ? { limit: Number(options['--limit']) } : {}),
    ...(options['--cursor'] !== undefined ? { cursor: options['--cursor'] } : {}),
    ...(options['--receiving-query'] !== undefined ? { receivingQuery: options['--receiving-query'] } : {}),
    ...(options['--receiving-status'] !== undefined ? { receivingStatus: options['--receiving-status'] } : {}),
    ...(options['--receiving-limit'] !== undefined ? { receivingLimit: Number(options['--receiving-limit']) } : {}),
    ...(options['--receiving-cursor'] !== undefined ? { receivingCursor: options['--receiving-cursor'] } : {}),
  });
  else if (command === 'source-plan-build') {
    if (!options['--plan-id']) fail('PRODUCT_PLAN_ID_REQUIRED');
    const value = await model.sourcePlanRead({ planId: options['--plan-id'],
      ...(options['--binding-id'] ? { bindingId: options['--binding-id'] } : {}) });
    result = { planId: value.plan.planId, bindingId: value.bindingId, operation: await model.begin(value.buildRequest) };
  }
  else if (['source-plan-runtimes', 'source-plan-handoff'].includes(command)) {
    if (!options['--plan-id']) fail('PRODUCT_PLAN_ID_REQUIRED');
    const selected = { planId: options['--plan-id'],
      ...(options['--binding-id'] ? { bindingId: options['--binding-id'] } : {}) };
    if (command === 'source-plan-handoff') {
      if (!options['--runtime-id']) fail('PRODUCT_PLAN_RUNTIME_ID_REQUIRED');
      result = await model.sourcePlanHandoff({ ...selected, runtimeId: options['--runtime-id'] });
    } else result = await model.sourcePlanRuntimes(selected);
    if (options['--output']) {
      const output = resolve(options['--output']);
      await saveTextExport(output, JSON.stringify(result, null, 2) + '\n');
      result = { schema: result.schema, planId: result.planId, bindingId: result.bindingId,
        ...(result.runtime ? { runtimeId: result.runtime.runtimeId } : {}), output };
    }
  }
  else if (command === 'source-plan-briefing') {
    if (!options['--plan-id']) fail('PRODUCT_PLAN_ID_REQUIRED');
    const briefing = await model.sourcePlanBriefing({ planId: options['--plan-id'],
      ...(options['--binding-id'] ? { bindingId: options['--binding-id'] } : {}),
      ...(options['--format'] ? { format: options['--format'] } : {}),
      ...(options['--runtime-id'] ? { runtimeId: options['--runtime-id'] } : {}) });
    if (options['--output']) {
      const output = resolve(options['--output']); await saveTextExport(output, briefing.content);
      const { content, ...summary } = briefing; result = { ...summary, output };
    } else { process.stdout.write(briefing.content); return; }
  }
  else if (command === 'source-plan-save') {
    if (!options['--request']) fail('PRODUCT_PLAN_REQUEST_REQUIRED');
    result = await model.sourcePlanSave(await readProductPlanDocument(resolve(options['--request'])));
  }
  else if (['source-plan-open', 'source-plan-refresh', 'source-plan-export'].includes(command)) {
    if (!options['--plan-id']) fail('PRODUCT_PLAN_ID_REQUIRED');
    const method = { 'source-plan-open': 'sourcePlanRead', 'source-plan-refresh': 'sourcePlanRefresh',
      'source-plan-export': 'sourcePlanExport' }[command];
    result = await model[method]({ planId: options['--plan-id'],
      ...(options['--binding-id'] ? { bindingId: options['--binding-id'] } : {}) });
    if (options['--output']) {
      await saveJSON(resolve(options['--output']), result);
      result = { output: resolve(options['--output']), planId: result.plan.planId, sha256: result.sha256 };
    }
  }
  else if (command === 'source-plan-receive') {
    if (!options['--document'] || !options['--repository']) fail('PRODUCT_PLAN_DOCUMENT_REPOSITORY_REQUIRED');
    if (options['--offline'] !== undefined && !['true', 'false'].includes(options['--offline']))
      fail('PRODUCT_PLAN_OFFLINE_BOOLEAN_REQUIRED');
    result = await model.sourcePlanReceive({ bundle: await readProductPlanDocument(resolve(options['--document'])),
      repository: resolve(options['--repository']),
      ...(options['--offline'] !== undefined ? { offline: options['--offline'] === 'true' } : {}),
      ...(options['--python'] ? { python: options['--python'] } : {}) });
  }
  else if (['source-plan-receiving', 'source-plan-continue'].includes(command)) {
    if (!options['--receipt-id']) fail('PRODUCT_PLAN_RECEIPT_REQUIRED');
    result = await model[command === 'source-plan-continue' ? 'sourcePlanContinue' : 'sourcePlanReceiving']({
      receiptId: options['--receipt-id'] });
    if (options['--output']) {
      await saveJSON(resolve(options['--output']), result);
      result = { output: resolve(options['--output']), receiptId: result.input.receiptId, status: result.state.status };
    }
  }
  else if (command === 'source-builds') result = await model.sourceBuildsState();
  else if (command === 'source-build-review-show') result = await model.sourceBuildsReadReview(options['--review-id']);
  else if (command === 'source-build-continue') result = await model.recoverSourceBuildOperation(options['--operation-id']);
  else if (['source-build-catalog', 'source-build-review', 'source-build-operation'].includes(command)) {
    if (!options['--request']) fail('SOURCE_BUILD_REQUEST_FILE_REQUIRED');
    const input = await readJSON(resolve(options['--request']));
    if (command === 'source-build-operation' && input?.operation !== 'source-build') fail('SOURCE_BUILD_OPERATION_REQUIRED');
    const method = { 'source-build-catalog': 'sourceBuildsCatalog', 'source-build-review': 'sourceBuildsReview', 'source-build-operation': 'begin' }[command];
    result = await model[method](input);
  }
  else if (command === 'applications') result = await model.applicationsState({ historyLimit: options['--history-limit'] === undefined ? 1 : Number(options['--history-limit']) });
  else if (command === 'application-history') {
    if (!options['--application-id']) fail('APPLICATION_ID_REQUIRED');
    result = await model.applicationsHistory({ applicationId: options['--application-id'],
      ...(options['--limit'] !== undefined ? { limit: Number(options['--limit']) } : {}),
      ...(options['--cursor'] ? { cursor: options['--cursor'] } : {}) });
  }
  else if (['application-review', 'application-save', 'application-start'].includes(command)) {
    if (!options['--request']) fail('APPLICATION_REQUEST_FILE_REQUIRED');
    const method = { 'application-review': 'applicationsReview', 'application-save': 'applicationsSave', 'application-start': 'applicationsStart' }[command];
    result = await model[method](await readJSON(resolve(options['--request'])));
  } else if (['application-start-review', 'application-connect', 'application-stop', 'application-recover', 'application-output'].includes(command)) {
    if (!options['--application-id']) fail('APPLICATION_ID_REQUIRED');
    const method = { 'application-start-review': 'applicationsStartReview', 'application-connect': 'applicationsConnect',
      'application-stop': 'applicationsStop', 'application-recover': 'applicationsRecover', 'application-output': 'applicationsOutput' }[command];
    result = await model[method]({ applicationId: options['--application-id'], ...(options['--operation-id'] ? { operationId: options['--operation-id'] } : {}) });
  } else if (command === 'python-status') result = await model.pythonState({ runtimeId: options['--runtime-id'] });
  else if (command === 'python-review') {
    if (!options['--python']) fail('PYTHON_INTERPRETER_REQUIRED', 'Select an absolute Python executable.');
    result = await model.pythonReview({ runtimeId: options['--runtime-id'], python: resolve(options['--python']),
      extras: options['--extras'] === 'base' ? [] : (options['--extras'] ?? 'workbooks').split(',') });
  } else if (command === 'python-operation') {
    if (!options['--request']) fail('PYTHON_REQUEST_FILE_REQUIRED');
    const request = await readJSON(resolve(options['--request']));
    if (!request?.operation?.startsWith('python-')) fail('PYTHON_OPERATION_INVALID');
    result = await model.begin(request);
  } else if (command === 'python-continue') result = await model.recoverPythonOperation(options['--operation-id']);
  else if (command === 'python-command') {
    if (!options['--args']) fail('PYTHON_ARGUMENT_FILE_REQUIRED');
    result = await model.pythonCommand({ runtimeId: options['--runtime-id'], installationId: options['--installation-id'],
      command: options['--command'], args: await readJSON(resolve(options['--args'])) });
  } else if (command === 'transfers') result = await model.transfersState({ cacheTransferId: options['--transfer-id'] ?? null });
  else if (command === 'transfer-review') result = await model.transfersReview({ runtimeId: options['--runtime-id'] });
  else if (command === 'transfer-attach') {
    if (!options['--directory']) fail('RUNTIME_TRANSFER_DIRECTORY_REQUIRED');
    result = await model.transfersAttach({ directory: resolve(options['--directory']), label: options['--label'] });
  } else if (command === 'transfer-operation') {
    if (!options['--request']) fail('RUNTIME_TRANSFER_REQUEST_FILE_REQUIRED');
    const request = await readJSON(resolve(options['--request']));
    if (!request?.operation?.startsWith('transfer-')) fail('RUNTIME_TRANSFER_OPERATION_INVALID');
    result = await model.begin(request);
  } else if (command === 'transfer-continue') result = await model.recoverTransferOperation(options['--operation-id']);
  else if (command === 'managed-open') {
    if (!options['--home']) fail('MANAGED_HOME_REQUIRED');
    result = await model.openManagedHome({ directory: resolve(options['--home']), label: options['--label'] });
  } else if (command === 'managed-status') result = await model.managedState({ homeId: options['--home-id'] ?? null });
  else if (command === 'managed-review') result = await model.reviewManagedAdoption({
    homeId: options['--home-id'], runtimeId: options['--runtime-id'] });
  else if (command === 'managed-config') result = await model.managedConfig({
    homeId: options['--home-id'], ...(options['--path'] ? { path: options['--path'] } : {}) });
  else if (command === 'managed-operation') {
    if (!options['--request']) fail('MANAGED_REQUEST_FILE_REQUIRED');
    result = await model.begin(await readJSON(resolve(options['--request'])));
  } else if (command === 'managed-recover') result = await model.recoverManagedOperation(options['--operation-id']);
  else if (command === 'managed-stop') result = await model.stopManagedCommand(options['--operation-id']);
  else if (command === 'attach') {
    if (!options['--runtime']) fail('RUNTIME_WORKSPACE_RUNTIME_REQUIRED');
    result = await model.attach({ directory: resolve(options['--runtime']), label: options['--label'] });
  } else if (command === 'handoff') {
    if (!options['--runtime-id']) fail('RUNTIME_WORKSPACE_RUNTIME_ID_REQUIRED');
    result = await model.handoff(options['--runtime-id']);
  } else if (command === 'operation-status') result = await model.operationStatus({ operationId: options['--operation-id'] });
  else if (command === 'operation-log') {
    if (!options['--operation-id']) fail('RUNTIME_WORKSPACE_OPERATION_INVALID');
    result = await model.logs({ operationId: options['--operation-id'] });
  } else result = await model.state({ runtimeId: options['--runtime-id'] ?? null });
  process.stdout.write(json(result));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => {
    const diagnostic = runtimeWorkspaceError(error, 'RUNTIME_WORKSPACE_ERROR', Infinity);
    process.stderr.write(json({ error: diagnostic.code, message: diagnostic.message,
      ...(diagnostic.flock ? { flock: diagnostic.flock } : {}) }));
    process.exitCode = 1;
  });

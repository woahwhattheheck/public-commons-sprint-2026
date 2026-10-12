// MIT. Create one immutable native job merchant from selected n8n automations.
import { mkdir, readFile, lstat, realpath } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, digest } from '../jobs/config.mjs';
import { readN8nConfiguration, compileN8nMerchant, environmentStatus, fail } from './config.mjs';
import { privateDirectory, readPrivate, writePrivate } from './store.mjs';

export const PREPARED_SCHEMA = 'stellar-forge.n8n-prepared-merchant.v1';
const runtimeFiles = ['config.mjs', 'store.mjs', 'client.mjs', 'runtime.mjs'];
export async function prepareN8nMerchant({ configPath, directory } = {}) {
  directory = resolve(directory);
  const parent = dirname(directory);
  if (await realpath(parent) !== parent) fail('DIRECTORY', 'Prepare the merchant below a canonical existing parent.');
  const source = await readN8nConfiguration(configPath);
  await mkdir(directory, { mode: 0o700 });
  await privateDirectory(directory, { create: false });
  const dispatchDirectory = join(directory, 'dispatches');
  await privateDirectory(dispatchDirectory);
  const closure = await Promise.all(runtimeFiles.map(async name => ({
    url: new URL('./' + name, import.meta.url).href,
    sha256: digest(await readFile(new URL('./' + name, import.meta.url))),
  })));
  const application = [
    '// Generated from the selected original Starforge n8n merchant source.',
    "import {readFile} from 'node:fs/promises';",
    "import {createHash} from 'node:crypto';",
    'const closure=' + canonical(closure) + ';',
    "for(const file of closure){const bytes=await readFile(new URL(file.url));if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Object.assign(new Error('The selected n8n runtime source changed.'),{code:'JOB_AUTOMATION_SOURCE_CHANGED'});}",
    'const {executeN8nJob}=await import(' + JSON.stringify(new URL('./runtime.mjs', import.meta.url).href) + ');',
    'const configuration=' + canonical(source.normalized) + ';',
    'const directory=' + JSON.stringify(dispatchDirectory) + ';',
    ...Object.keys(source.jobs.functions).map((id, index) =>
      'async function starforgeAutomationFunction' + index + '(input,context){return executeN8nJob(configuration,directory,' + JSON.stringify(id) + ',input,context); }\n' +
      'export {starforgeAutomationFunction' + index + ' as ' + id + '};'),
    '',
  ].join('\n');
  const merchantBytes = Buffer.from(JSON.stringify(source.jobs, null, 2) + '\n');
  await writePrivate(join(directory, 'n8n-merchant.json'), source.bytes);
  await writePrivate(join(directory, 'merchant.json'), merchantBytes);
  await writePrivate(join(directory, 'application.mjs'), Buffer.from(application));
  const record = { schema: PREPARED_SCHEMA, directory, configurationSha256: source.configurationSha256,
    inputSha256: digest(source.bytes), merchantSha256: digest(merchantBytes), applicationSha256: digest(application),
    runtime: closure, dispatchDirectory, jobDirectory: join(directory, 'jobs'), createdAt: new Date().toISOString() };
  await writePrivate(join(directory, 'n8n-prepared.json'), Buffer.from(canonical(record) + '\n'));
  return { ...record, configPath: join(directory, 'merchant.json'), functions: Object.keys(source.jobs.functions) };
}

export async function inspectN8nMerchant(directory, { env = process.env } = {}) {
  directory = resolve(directory);
  await privateDirectory(directory, { create: false });
  const record = JSON.parse(await readPrivate(join(directory, 'n8n-prepared.json')));
  if (record.schema !== PREPARED_SCHEMA || record.directory !== directory ||
      record.dispatchDirectory !== join(directory, 'dispatches') || record.jobDirectory !== join(directory, 'jobs'))
    fail('PREPARED_IDENTITY', 'Select this merchant at its original prepared directory.', 409);
  const checks = [['n8n-merchant.json', record.inputSha256], ['merchant.json', record.merchantSha256],
    ['application.mjs', record.applicationSha256]];
  for (const [name, expected] of checks)
    if (digest(await readPrivate(join(directory, name))) !== expected)
      fail('PREPARED_SOURCE', 'The prepared ' + name + ' differs from its selected original source.', 409);
  if (!Array.isArray(record.runtime) || record.runtime.length !== runtimeFiles.length)
    fail('PREPARED_SOURCE', 'The original n8n runtime closure is unavailable.', 409);
  for (let i = 0; i < runtimeFiles.length; i++) {
    const original = new URL('./' + runtimeFiles[i], import.meta.url);
    if (record.runtime[i].url !== original.href || digest(await readFile(original)) !== record.runtime[i].sha256)
      fail('PREPARED_SOURCE', 'Use the same selected n8n runtime source that prepared this merchant.', 409);
  }
  const raw = JSON.parse(await readPrivate(join(directory, 'n8n-merchant.json')));
  const compiled = compileN8nMerchant(raw, { baseDir: directory });
  if (compiled.configurationSha256 !== record.configurationSha256)
    fail('PREPARED_IDENTITY', 'The retained automation configuration has a different identity.', 409);
  return { record, ...compiled, environment: environmentStatus(compiled, env) };
}

/** Importable n8n wrapper using the original built-in Webhook and Execute Workflow nodes. */
export function createAutomationWorkflow(raw, { functionId, childWorkflowId, headerCredentialId, headerCredentialName } = {}) {
  const source = compileN8nMerchant(raw), automation = source.normalized.automations[functionId];
  if (!automation) fail('FUNCTION', 'Select a configured automation.');
  if (typeof childWorkflowId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(childWorkflowId))
    fail('WORKFLOW_ID', 'Supply the existing child workflow ID whose trigger accepts all data.');
  if (headerCredentialId !== undefined && (typeof headerCredentialId !== 'string' || !headerCredentialId || headerCredentialId.length > 128))
    fail('CREDENTIAL_ID', 'Select the existing n8n webhook credential ID.');
  const configuredPath = new URL(automation.webhookUrl).pathname;
  const separator = configuredPath.indexOf('/webhook/');
  const path = separator >= 0 ? configuredPath.slice(separator + '/webhook/'.length) : configuredPath.replace(/^\//, '');
  if (!path) fail('WEBHOOK_PATH', 'Supply a named production webhook path.');
  const requestName = automation.webhookNode;
  const ackName = 'Starforge Accepted', inputName = 'Starforge Input', childName = 'Run selected automation';
  if (new Set([requestName, ackName, inputName, childName, automation.resultNode]).size !== 5)
    fail('NODE_NAMES', 'Choose request and result names distinct from the wrapper operation nodes.');
  const accepted = `={{ { schema: 'stellar-forge.n8n-accepted.v1', jobId: $json.body.jobId, functionId: $json.body.functionId, dispatchId: $json.body.dispatchId, attemptId: $json.body.attemptId, inputSha256: $json.body.inputSha256, configurationSha256: $json.body.configurationSha256, workflowId: $workflow.id, executionId: $execution.id } }}`;
  const request = { parameters: { httpMethod: 'POST', path, responseMode: 'responseNode',
    authentication: automation.webhookHeader ? 'headerAuth' : 'none', options: {} },
    id: 'starforge-request', name: requestName, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0],
    webhookId: 'starforge-' + digest(path).slice(0, 24) };
  if (automation.webhookHeader && headerCredentialId) request.credentials = { httpHeaderAuth: {
    id: headerCredentialId, name: headerCredentialName ?? 'Starforge merchant webhook',
  } };
  const fields = JSON.stringify(automation.resultFields);
  const nodes = [request,
    { parameters: { respondWith: 'json', responseBody: accepted, options: { responseCode: 202 } },
      id: 'starforge-accepted', name: ackName, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.4, position: [220, 0] },
    { parameters: { jsCode: `const request = $(${JSON.stringify(requestName)}).first().json.body;\nif (!request || request.schema !== 'stellar-forge.n8n-dispatch.v1' || !request.input || typeof request.input !== 'object' || Array.isArray(request.input)) throw new Error('Invalid Starforge automation request');\nreturn [{ json: request.input }];` },
      id: 'starforge-input', name: inputName, type: 'n8n-nodes-base.code', typeVersion: 2, position: [440, 0] },
    { parameters: { source: 'database', workflowId: { __rl: true, value: childWorkflowId, mode: 'id' },
      mode: 'once', options: { waitForSubWorkflow: true } },
      id: 'starforge-automation', name: childName, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.3, position: [660, 0] },
    { parameters: { jsCode: `const fields = ${fields};\nreturn $input.all().map(item => { const result = {}; for (const field of fields) { if (!Object.prototype.hasOwnProperty.call(item.json, field)) throw new Error('Missing public result field: ' + field); result[field] = item.json[field]; } return { json: result }; });` },
      id: 'starforge-result', name: automation.resultNode, type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 0] },
  ];
  const connections = {};
  for (let i = 0; i < nodes.length - 1; i++) connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] };
  return { name: source.normalized.serviceName + ' · ' + functionId, nodes, connections,
    settings: { executionOrder: 'v1', saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all',
      saveManualExecutions: true, saveExecutionProgress: true },
    active: false, pinData: {}, tags: [] };
}

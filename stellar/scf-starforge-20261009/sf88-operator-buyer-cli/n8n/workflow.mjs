#!/usr/bin/env node
// MIT — importable native-customer workflows, inactive and credential-referenced.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const NODE = 'n8n-nodes-starforge-buyer.starforgeBuyer';
const FORMATS = new Set(['binary', 'json', 'csv', 'ndjson', 'sse']);
const assignment = (name, value, type = 'string') => ({ id: randomUUID(), name, value, type });
const node = (name, type, typeVersion, parameters, x, extra = {}) => ({
  id: randomUUID(), name, type, typeVersion, position: [x, 240], parameters, ...extra,
});
const manual = () => node('Start selected operation', 'n8n-nodes-base.manualTrigger', 1, {}, 0);
const select = intent => node('Select original intent', 'n8n-nodes-base.set', 3.4, {
  assignments: { assignments: [assignment('intentId', intent)] }, includeOtherFields: false, options: {},
}, 240);

export function createCustomerWorkflows({
  credentialId, credentialName = 'Original Starforge buyer workspace',
  intentId = '', responseFormat = 'binary', webhookPath = 'starforge-buyer-intake',
} = {}) {
  if (!FORMATS.has(responseFormat)) throw new Error('RESPONSE_FORMAT_INVALID');
  if (typeof credentialName !== 'string' || !credentialName.trim()) throw new Error('CREDENTIAL_NAME_REQUIRED');
  if (credentialId !== undefined && (typeof credentialId !== 'string' || !credentialId.trim()))
    throw new Error('CREDENTIAL_ID_INVALID');
  if (typeof intentId !== 'string' || (intentId && !/^[A-Za-z0-9._:-]{1,128}$/.test(intentId)))
    throw new Error('ORIGINAL_INTENT_ID_INVALID');
  if (typeof webhookPath !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(webhookPath))
    throw new Error('WEBHOOK_PATH_INVALID');
  const credentials = { starforgeBuyerWorkspace: {
    ...(credentialId === undefined ? {} : { id: credentialId }), name: credentialName,
  } };
  const buyer = (name, operation, parameters = {}, x = 480) => node(name, NODE, 1, {
    operation,
    ...(operation === 'list' || operation === 'report' || operation.endsWith('Handoff')
      ? {} : { intentId: '={{ $json.intentId }}' }),
    ...parameters,
    options: parameters.options || {},
  }, x, { credentials, retryOnFail: false, onError: 'stopWorkflow' });
  const workflow = (filename, name, nodes, purpose) => {
    const connections = {};
    for (let i = 0; i < nodes.length - 1; i++) {
      connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] };
    }
    return { filename, purpose, workflow: {
      name, active: false, nodes, connections, settings: { executionOrder: 'v1' },
      pinData: {}, tags: [],
    } };
  };
  const intake = node('Actual merchant packet', 'n8n-nodes-base.webhook', 2, {
    httpMethod: 'POST', path: webhookPath, responseMode: 'lastNode', options: {},
  }, 0, { webhookId: randomUUID() });
  const acknowledgment = node('Return intake identity', 'n8n-nodes-base.set', 3.4, {
    assignments: { assignments: [
      assignment('intentId', '={{ $json.intentId }}'),
      assignment('state', '={{ $json.native.state }}'),
      assignment('packetSha256', '={{ $json.packet.handoffSha256 }}'),
      assignment('received', true, 'boolean'),
    ] }, includeOtherFields: false, options: {},
  }, 480);
  return [
    workflow('01_merchant_packet_intake.json', 'Starforge — retain merchant request', [
      intake,
      buyer('Retain in original inbox', 'enqueueHandoff', {
        packetSource: 'json', packetJson: '={{ $json.body.packet }}',
        acceptIndex: '={{ $json.body.acceptIndex }}',
      }, 240),
      acknowledgment,
    ], 'Actual packet and explicit offered-option index into the original inbox; return only intake identity to the caller.'),
    workflow('02_review_operator_handoff.json', 'Starforge — review selected request', [
      manual(), select(intentId), buyer('Review and prepare terminal handoff', 'review'),
    ], 'Inspect retained original terms and give the operator a hash-bound native terminal command.'),
    workflow('03_read_verified_response.json', 'Starforge — read saved response', [
      manual(), select(intentId), buyer('Read original verified response', 'response', { responseFormat }),
    ], 'After native execution, reopen the same intent and return its verified binary, JSON or record result.'),
    workflow('04_recover_existing_attempt.json', 'Starforge — recover original evidence', [
      manual(), select(intentId), buyer('Recover original evidence', 'recover'),
      buyer('Read retained response', 'response', { responseFormat }, 720),
    ], 'Explicitly recover an existing attempt through its original evidence and read the same saved response.'),
    workflow('05_finalize_and_export_history.json', 'Starforge — finalize and export history', [
      manual(), select(intentId), buyer('Finalize original reservation', 'finalize', { merchantRoute: '' }),
      buyer('Export native inbox history', 'report', {}, 720),
    ], 'Continue the selected original reservation, then return its native private HTML history.'),
    workflow('06_resume_prepared_intake.json', 'Starforge — finish prepared intake', [
      manual(), select(intentId), buyer('Enqueue original prepared intent', 'enqueuePrepared'),
      buyer('Review original intent', 'review', {}, 720),
    ], 'Complete the same saved Node intake after an interrupted enqueue; no new request or intent is made.'),
  ];
}

export async function writeCustomerWorkflows(directory, options = {}) {
  directory = resolve(directory);
  const entries = createCustomerWorkflows(options);
  // One explicit new destination. A failed write leaves the unfinished directory
  // visible; the completion manifest is written only after every workflow.
  await mkdir(directory, { mode: 0o700 });
  for (const entry of entries) {
    await writeFile(join(directory, entry.filename), JSON.stringify(entry.workflow, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 });
  }
  const manifest = {
    schema: 'stellar-forge.n8n-customer-workflows.v1', nodePackage: 'n8n-nodes-starforge-buyer',
    nodeType: NODE, createdAt: new Date().toISOString(), active: false,
    credentialType: 'starforgeBuyerWorkspace',
    workflows: entries.map(({ filename, purpose }) => ({ filename, purpose })),
    operatorExecution: 'Original SF88 terminal handoff from workflow 02; reopen the same intent in workflow 03.',
  };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
  return { directory, ...manifest };
}

async function main() {
  const { values } = parseArgs({ options: {
    output: { type: 'string' }, 'credential-id': { type: 'string' },
    'credential-name': { type: 'string' }, intent: { type: 'string' },
    format: { type: 'string' }, 'webhook-path': { type: 'string' }, help: { type: 'boolean' },
  }, strict: true });
  if (values.help) {
    process.stdout.write('node workflow.mjs --output NEW_DIRECTORY [--credential-id EXISTING_ID] [--credential-name NAME] [--intent ORIGINAL_ID] [--format binary|json|csv|ndjson|sse] [--webhook-path PRIVATE_PATH]\n');
    return;
  }
  if (!values.output) throw new Error('NEW_OUTPUT_DIRECTORY_REQUIRED');
  const result = await writeCustomerWorkflows(values.output, {
    ...(values['credential-id'] === undefined ? {} : { credentialId: values['credential-id'] }),
    ...(values['credential-name'] === undefined ? {} : { credentialName: values['credential-name'] }),
    ...(values.intent === undefined ? {} : { intentId: values.intent }),
    ...(values.format === undefined ? {} : { responseFormat: values.format }),
    ...(values['webhook-path'] === undefined ? {} : { webhookPath: values['webhook-path'] }),
  });
  process.stdout.write(JSON.stringify(result) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.message }) + '\n'); process.exitCode = 1;
  });
}

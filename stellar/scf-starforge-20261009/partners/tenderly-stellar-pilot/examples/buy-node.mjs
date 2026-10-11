#!/usr/bin/env node
// MIT. Workspace download and analysis joins around the original customer CLI.
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main as customerMain } from '../customer/cli.mjs';
import { TenderlyCustomer, openExport } from '../customer/client.mjs';
import { prepareWorkspaceRequest } from '../customer.mjs';
import { readJson, readBytes, digest } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { receiveBuyerResult, receiveBytes } from '../../../sf88-operator-buyer-cli/tenderly-analysis/library.mjs';

const defaultRuntime = fileURLToPath(new URL('../../../sf88-operator-buyer-cli/', import.meta.url));
const fail = code => { throw Object.assign(new Error(code), { code }); };
const show = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
const HELP = [
  'Tenderly workspace and customer example', '',
  'prepare --plan PLAN_JSON --packet WORKSPACE_REQUEST --intent STABLE_ID --out PRIVATE_INPUT_DIR',
  '        [--response-out NEW_RESPONSE_JSON]',
  'analyze --state PRIVATE_BUYER_DIR --intent STABLE_ID --workspace ANALYSIS_DIR [--label TEXT]',
  '        [--runtime SF88_DIR]',
  'analyze-export --directory CUSTOMER_EXPORT --workspace ANALYSIS_DIR [--label TEXT]', '',
  'The remaining commands delegate to the original customer CLI below. This example',
  'defaults --runtime to the adjacent complete SF88 installation.', '',
].join('\n');

function flagsFor(action, args) {
  const allowed = {
    prepare: ['plan', 'packet', 'intent', 'out', 'response-out'],
    analyze: ['state', 'intent', 'workspace', 'label', 'runtime'],
    'analyze-export': ['directory', 'workspace', 'label'],
  }[action];
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.slice(2), value = args[i + 1];
    if (!args[i]?.startsWith('--') || !allowed.includes(name) || Object.hasOwn(values, name) ||
        value === undefined || value.startsWith('--') || !value)
      fail('TENDERLY_EXAMPLE_ARGUMENT_INVALID');
    values[name] = value;
  }
  const required = action === 'prepare' ? ['plan', 'packet', 'intent', 'out']
    : action === 'analyze' ? ['state', 'intent', 'workspace'] : ['directory', 'workspace'];
  if (required.some(name => !values[name])) fail('TENDERLY_EXAMPLE_ARGUMENT_REQUIRED');
  return values;
}

/** Keep the actual original BuyerResult class instance at the analysis boundary. */
export async function analyzeResult(result, { workspace, label = '' }) {
  if (result === null) return { status: 'AWAITING_ORIGINAL_RESULT' };
  const simulation = await result.summary();
  const capture = await receiveBuyerResult(result.original, {
    workspace: resolve(workspace), request: result.analysisRequest(), label,
  });
  return { intentId: result.native.intentId, simulation,
    analysis: { id: capture.id, directory: capture.directory, analysisPath: capture.analysisPath } };
}

/** A completed Node or Python export can be analyzed after its buyer machine closes. */
export async function analyzeExport({ directory, workspace, label = '' }) {
  directory = resolve(directory);
  const saved = await openExport(directory);
  const source = {};
  for (const name of ['response.json', 'simulation-request.json', 'buyer-result.json']) {
    const binding = saved.manifest.files[name];
    const bytes = await readBytes(join(directory, name), binding.bytes);
    if (bytes.length !== binding.bytes || digest(bytes) !== binding.sha256)
      fail('TENDERLY_ANALYSIS_EXPORT_CHANGED');
    source[name] = bytes;
  }
  const capture = await receiveBytes(source['response.json'], {
    workspace: resolve(workspace), requestBytes: source['simulation-request.json'],
    nativeBytes: source['buyer-result.json'], label,
  });
  return { intentId: saved.manifest.intentId, simulation: saved.simulation,
    analysis: { id: capture.id, directory: capture.directory, analysisPath: capture.analysisPath } };
}

export async function main(args = process.argv.slice(2)) {
  const [action, ...rest] = args;
  if (!action || action === '--help' || action === '-h') {
    process.stdout.write(HELP + '\n');
    return customerMain(['--help']);
  }
  if (action === 'prepare') {
    const v = flagsFor(action, rest);
    return show(await prepareWorkspaceRequest({ plan: await readJson(resolve(v.plan)),
      packetFile: resolve(v.packet), intentId: v.intent, out: resolve(v.out),
      ...(v['response-out'] ? { responseOut: resolve(v['response-out']) } : {}) }));
  }
  if (action === 'analyze-export') {
    const v = flagsFor(action, rest);
    return show(await analyzeExport(v));
  }
  if (action === 'analyze') {
    const v = flagsFor(action, rest);
    const customer = new TenderlyCustomer({ runtimeDirectory: resolve(v.runtime ?? defaultRuntime),
      stateDirectory: resolve(v.state) });
    const result = await customer.operation(v.intent).recover();
    return show(await analyzeResult(result, { workspace: v.workspace, label: v.label }));
  }
  return customerMain(['selection', 'open-export'].includes(action) || rest.includes('--runtime')
    ? args : [...args, '--runtime', defaultRuntime]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    const code = error?.code;
    process.stderr.write(JSON.stringify({ error: typeof code === 'string' && /^[A-Z0-9_]{1,120}$/.test(code)
      ? code : 'TENDERLY_CUSTOMER_FAILED' }) + '\n');
    process.exitCode = 2;
  });

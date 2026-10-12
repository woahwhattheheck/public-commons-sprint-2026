// MIT. Original Tenderly workspace binding for the retained Applications launcher.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { readBytes, parse, sha256 } from '../../sf102-cube-paid-query-adapter/onboarding/files.mjs';
import { absolute, plain, need } from './storage.mjs';

const WORKSPACE = 'stellar-forge.tenderly-workspace.v1';
const STARTUP = 'stellar-forge.tenderly-workspace-startup.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function tenderlyApplication(common) {
  return {
    id: 'tenderly', command: 'tenderly-workspace', title: 'Tenderly simulation merchant', terminal: false,
    requiredSource: 'stellar/scf-starforge-20261009/distribution/runtime-workspace/application-tenderly.mjs',
    description: 'Prepare the original merchant, retain pinned simulation requests, start and drain its seller, review saved provider observations and reopen complete customer results.',
    fields: [
      field('workspaceDirectory', 'Private Tenderly workspace', 'path', true,
        'Use the original or received workspace. A new directory may be created in an existing private parent.'),
      field('planFile', 'Initial merchant plan', 'path', false,
        'Optional original stellar-forge.tenderly-merchant-plan.v1 file. Existing saved profiles remain in the workspace.'),
      field('facilitator', 'Original HTTPS facilitator', 'text', false,
        'Select the original facilitator for the saved Stellar terms. Without one, the original merchant uses its challenge mode.'),
      ...common,
    ],
  };
}

async function workspaceAt(directory, optional = false) {
  let bytes;
  try { bytes = await readBytes(join(directory, 'workspace.json'), { privateFile: true, max: 65536 }); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  const value = parse(bytes, 'Tenderly workspace identity');
  need(plain(value) && value.schema === WORKSPACE && UUID.test(value.id ?? ''),
    'APPLICATION_TENDERLY_WORKSPACE_INVALID', 'Select an original Tenderly workspace or a new private directory');
  return { id: value.id, sha256: sha256(bytes) };
}

export async function prepareTenderlyApplication(settings, inputPath, runtimeDirectory) {
  const inputs = [await inputPath(settings.workspaceDirectory, 'directory', true, true)];
  const workspace = await workspaceAt(settings.workspaceDirectory, true);
  if (workspace) {
    const identity = await inputPath(join(settings.workspaceDirectory, 'workspace.json'), 'file');
    need(identity.sha256 === workspace.sha256, 'APPLICATION_TENDERLY_WORKSPACE_CHANGED');
    inputs.push(identity);
  }
  const args = ['--state', settings.workspaceDirectory,
    '--expected-workspace-sha256', workspace?.sha256 ?? 'new'];
  if (settings.planFile) {
    const original = await inputPath(settings.planFile, 'file');
    const bytes = await readBytes(settings.planFile, { max: 1024 * 1024 });
    need(original.sha256 === sha256(bytes), 'APPLICATION_TENDERLY_PLAN_CHANGED');
    const runtime = await inspectMerchantRuntime(runtimeDirectory, { load: false });
    const module = join(runtime.sourceRoot,
      'stellar/scf-starforge-20261009/partners/tenderly-stellar-pilot/product.mjs');
    inputs.push(original, await inputPath(module, 'file'));
    const { inspectPlan } = await import(pathToFileURL(module).href);
    inspectPlan(parse(bytes, 'initial Tenderly merchant plan'));
    args.push('--plan', settings.planFile, '--expected-plan-sha256', original.sha256);
  }
  if (settings.facilitator) {
    let url;
    try { url = new URL(settings.facilitator); }
    catch { need(false, 'APPLICATION_TENDERLY_FACILITATOR_INVALID'); }
    need(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
      'APPLICATION_TENDERLY_FACILITATOR_INVALID', 'Use the original credential-free HTTPS facilitator URL');
    args.push('--facilitator', url.href);
  }
  return { args, inputs };
}

function selectedValue(request, name, optional = false) {
  need(Array.isArray(request.args), 'APPLICATION_TENDERLY_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && positions.length === 0) return null;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_TENDERLY_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}

export async function tenderlyStartup(request, text) {
  if (request.command !== 'tenderly-workspace' || typeof text !== 'string' ||
      text.length > 16384 || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'TENDERLY_WORKSPACE_READY') return null;
  const directory = absolute(selectedValue(request, '--state'));
  const expected = selectedValue(request, '--expected-workspace-sha256');
  need(expected === 'new' || HASH.test(expected), 'APPLICATION_TENDERLY_STARTUP_CHANGED');
  const workspace = await workspaceAt(directory);
  need(value.directory === directory && value.workspace === workspace.id &&
    value.workspaceSha256 === workspace.sha256 &&
    (expected === 'new' || expected === workspace.sha256),
    'APPLICATION_TENDERLY_STARTUP_CHANGED', 'The original startup must match the reviewed Tenderly workspace');
  const plan = selectedValue(request, '--plan', true);
  const expectedPlan = selectedValue(request, '--expected-plan-sha256', true);
  need(Boolean(plan) === Boolean(expectedPlan), 'APPLICATION_TENDERLY_STARTUP_CHANGED');
  if (plan) {
    const bytes = await readBytes(absolute(plan), { max: 1024 * 1024 });
    need(HASH.test(expectedPlan) && value.planFile === plan &&
      value.planSha256 === expectedPlan && sha256(bytes) === expectedPlan,
      'APPLICATION_TENDERLY_STARTUP_CHANGED', 'The original startup must retain the reviewed initial plan bytes');
  } else need(value.planFile === null && value.planSha256 === null, 'APPLICATION_TENDERLY_STARTUP_CHANGED');
  const facilitator = selectedValue(request, '--facilitator', true);
  need(value.facilitator === facilitator, 'APPLICATION_TENDERLY_STARTUP_CHANGED');
  const port = Number(selectedValue(request, '--port', true) ?? 0);
  let url;
  try { url = new URL(value.tenderlyWorkspace); }
  catch { need(false, 'APPLICATION_TENDERLY_STARTUP_CHANGED'); }
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535 &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    /^[#][A-Za-z0-9_-]{43}$/.test(url.hash) &&
    Number.isInteger(port) && port >= 0 && port <= 65535 && (port === 0 || Number(url.port || 80) === port),
    'APPLICATION_TENDERLY_STARTUP_CHANGED');
  return { url: url.href, original: { schema: STARTUP, directory,
    workspace: workspace.id, workspaceSha256: workspace.sha256,
    planFile: plan, planSha256: expectedPlan, facilitator } };
}

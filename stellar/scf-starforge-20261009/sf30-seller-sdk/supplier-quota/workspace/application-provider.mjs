// MIT. Source-owned Applications entry for the original supplier-account workspace.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../../distribution/runtime-workspace/application-provider.mjs';
import { absolute, need, plain } from '../../../distribution/runtime-workspace/storage.mjs';

const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/supplier-quota/workspace/';
const STARTUP = 'stellar-forge.supplier-account-workspace-startup.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function supplierAccountApplication(common, field) {
  return {
    id: 'supplier-accounts', command: 'supplier-accounts', title: 'Supplier accounts', terminal: false,
    requiredSource: ROOT + 'cli.mjs',
    description: 'Review shared supplier limits and binding membership, save the original merchant configuration, recover a lost save and continue retained account history.',
    fields: [
      field('directory', 'Private account workspace', 'path', true,
        'Continue the existing workspace, or create one in an existing private parent.'),
      field('upstreamsFile', 'Original upstream configuration', 'path', true,
        'The merchant’s existing seller-upstreams.v1 file. Account directories and credential references stay with this source.'),
      ...common.filter(item => item.name === 'port'),
    ],
  };
}

export async function prepareSupplierAccountApplication(settings, context) {
  need(typeof context.inputPath === 'function', 'APPLICATION_SUPPLIER_INPUT_READER_REQUIRED');
  const directory = absolute(settings.directory), upstreamsFile = absolute(settings.upstreamsFile);
  const { inspectMerchantRuntime } = await import('../../../sf46-release/runtime-package.mjs');
  const runtime = await inspectMerchantRuntime(context.runtimeDirectory, { load: false });
  const modelPath = join(runtime.sourceRoot, ROOT + 'model.mjs');
  const inputs = [
    await context.inputPath(join(runtime.sourceRoot, ROOT + 'cli.mjs'), 'file'),
    await context.inputPath(modelPath, 'file'),
    await context.inputPath(join(runtime.sourceRoot, ROOT + 'server.mjs'), 'file'),
  ];
  const original = await import(pathToFileURL(modelPath).href);
  need(typeof original.inspectSupplierAccountSource === 'function', 'APPLICATION_SUPPLIER_RUNTIME_REQUIRED');
  const selected = await original.inspectSupplierAccountSource(upstreamsFile);
  const source = await context.inputPath(upstreamsFile, 'file');
  need(source.sha256 === selected.sha256 && String(source.dev) === selected.device &&
    String(source.ino) === selected.inode, 'APPLICATION_SUPPLIER_SOURCE_CHANGED');
  inputs.push(source);
  const state = await context.inputPath(directory, 'directory', true, true);
  inputs.push(state);
  return {
    args: ['serve', '--state', directory, '--upstreams', upstreamsFile, '--managed-source-sha256', selected.sha256],
    inputs, createDirectories: state.exists ? [] : [state.path],
    supplierAccounts: { sourceSha256: selected.sha256,
      accounts: Object.keys(selected.config.supplierAccounts ?? {}).length,
      bindings: Object.keys(selected.config.bindings).length },
  };
}

function argument(request, flag, fallback) {
  const positions = request.args.flatMap((value, index) => value === flag ? [index] : []);
  if (positions.length === 0 && fallback !== undefined) return fallback;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string' &&
    !request.args[positions[0] + 1].startsWith('--'), 'APPLICATION_SUPPLIER_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
export function supplierAccountStartup(request, text) {
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'SUPPLIER_ACCOUNTS_READY') return null;
  const directory = absolute(argument(request, '--state')), source = absolute(argument(request, '--upstreams'));
  const expected = argument(request, '--managed-source-sha256'), requested = argument(request, '--port', '0');
  need(HASH.test(expected) && /^(0|[1-9][0-9]*)$/.test(requested) && Number(requested) <= 65535 &&
    value.directory === directory && value.upstreamsFile === source && value.sourceSha256 === expected &&
    value.requestedPort === Number(requested) && UUID.test(value.instanceId ?? '') && UUID.test(value.workspaceId ?? '') &&
    Number.isSafeInteger(value.pid) && value.pid > 0 && Number.isFinite(Date.parse(value.startedAt)),
  'APPLICATION_SUPPLIER_STARTUP_CHANGED');
  let url;
  try { url = new URL(value.url); } catch { need(false, 'APPLICATION_SUPPLIER_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && port >= 1 && port <= 65535 &&
    port === value.port && (Number(requested) === 0 || port === Number(requested)) &&
    !url.username && !url.password && !url.search && url.pathname === '/' && HASH.test(url.hash.slice(1)),
  'APPLICATION_SUPPLIER_STARTUP_CHANGED');
  return { url: url.href, workspaceId: value.workspaceId, original: {
    schema: STARTUP, status: value.status, instanceId: value.instanceId, pid: value.pid, startedAt: value.startedAt,
    directory, upstreamsFile: source, sourceSha256: expected, requestedPort: Number(requested), port,
  } };
}
export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'supplier-accounts', order: 425,
  catalog({ common, field }) { return [supplierAccountApplication(common, field)]; },
  prepare(type, settings, context) { return prepareSupplierAccountApplication(settings, context); },
  resourceKey(type, settings, { hash }) { return hash({ family: 'supplier-accounts', upstreamsFile: settings.upstreamsFile }); },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'supplier-accounts' &&
      Array.isArray(request.args) && request.args[0] === 'serve' && request.args.includes('--managed-source-sha256');
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"' + STARTUP + '",')) return null;
      return () => supplierAccountStartup(request, text);
    });
  },
};

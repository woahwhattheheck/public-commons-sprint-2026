// MIT. Host configuration; MCP arguments never select files or executable modules.
import { readFile, lstat, mkdir, open } from 'node:fs/promises';
import { dirname, resolve, isAbsolute, join } from 'node:path';
import { initReleaseStore, readReleaseState } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';

export const CONFIG_SCHEMA = 'stellar-forge.merchant-mcp.v1';
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const failure = (code, message) => Object.assign(new Error(message), { code });
export function exact(value, keys, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    throw failure('INVALID_PARAMS', 'Supply only the declared fields, including every required field.');
}
export function identifier(value, label = 'Identifier') {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))
    throw failure('INVALID_PARAMS', label + ' must use 1–64 lowercase letters, digits, underscores or hyphens.');
  return value;
}
export function line(value, label = 'Text') {
  if (typeof value !== 'string' || !value.trim() || value.length > 240 || /[\x00-\x1f\x7f]/.test(value))
    throw failure('INVALID_PARAMS', label + ' must be nonempty single-line text up to 240 characters.');
  return value.trim();
}
export async function fileBytes(path, maximum = 4 * 1024 * 1024) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > maximum) throw failure('SOURCE_INVALID', 'Expected a regular source file within its size limit.');
  const bytes = await readFile(path);
  if (bytes.length > maximum) throw failure('SOURCE_INVALID', 'Source file grew beyond its size limit.');
  return bytes;
}
export async function writePrivate(path, value) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw failure('CONFIGURATION_ERROR', 'Host paths must be nonempty strings.');
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}
export async function readMerchantConfig(path) {
  path = resolve(path);
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fileBytes(path, 1024 * 1024)));
  exact(raw, ['schema', 'name', 'releaseStore', 'exportsDirectory', 'sources'], ['schema', 'name', 'releaseStore', 'exportsDirectory', 'sources']);
  if (raw.schema !== CONFIG_SCHEMA || !plain(raw.sources) || Object.keys(raw.sources).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Expected a merchant MCP configuration with up to 32 named sources.');
  const base = dirname(path), sources = Object.create(null);
  for (const [alias, source] of Object.entries(raw.sources)) {
    identifier(alias, 'Source alias');
    exact(source, ['label', 'spec', 'selections', 'bindings', 'runtime'], ['spec', 'selections', 'bindings']);
    const runtime = structuredClone(source.runtime ?? {});
    exact(runtime, ['port', 'handlers', 'facilitator', 'allowLocalFacilitator']);
    if (runtime.handlers !== undefined) runtime.handlers = hostPath(runtime.handlers, base);
    sources[alias] = { alias, label: line(source.label ?? alias, 'Source label'),
      spec: hostPath(source.spec, base), config: hostPath(source.selections, base),
      bindings: hostPath(source.bindings, base), runtime };
  }
  const config = { schema: CONFIG_SCHEMA, name: line(raw.name, 'Merchant name'),
    releaseStore: hostPath(raw.releaseStore, base), exportsDirectory: hostPath(raw.exportsDirectory, base), sources };
  await readReleaseState(config.releaseStore);
  if (!(await lstat(config.exportsDirectory)).isDirectory()) throw failure('CONFIGURATION_ERROR', 'Customer export directory must be a real directory.');
  return config;
}
export async function initializeMerchant({ directory, name = 'Starforge merchant', spec, selections, bindings, runtime = {} }) {
  const root = resolve(directory);
  for (const path of [spec, selections, bindings]) await fileBytes(resolve(path));
  if (runtime.handlers) await fileBytes(resolve(runtime.handlers));
  await mkdir(root, { mode: 0o700 });
  await initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const path = join(root, 'merchant-mcp.json');
  await writePrivate(path, { schema: CONFIG_SCHEMA, name: line(name, 'Merchant name'),
    releaseStore: './releases', exportsDirectory: './customer-exports', sources: {
      initial: { label: 'Initial merchant configuration', spec: resolve(spec), selections: resolve(selections),
        bindings: resolve(bindings), runtime: { ...runtime, ...(runtime.handlers ? { handlers: resolve(runtime.handlers) } : {}) } },
    } });
  await readMerchantConfig(path);
  return { schema: CONFIG_SCHEMA, configuration: path, sourceAlias: 'initial', state: 'INITIALIZED' };
}

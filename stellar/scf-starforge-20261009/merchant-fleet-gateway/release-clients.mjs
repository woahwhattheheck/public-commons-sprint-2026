// MIT. Per-slot customer handover over the original SF82 console and file reader.
import { mkdir, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createReleaseClientConsole } from '../sf82-seller-pilot/release-client.mjs';
import { MerchantClientExports } from '../../../stellar-forge/mcp-merchant-operator/client-exports.mjs';
import { downloadSellerClientExport } from '../../../stellar-forge/mcp-merchant-operator/client-download.mjs';

const failure = (code, status = 400) => Object.assign(new Error(code), { code, status });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fields(input, allowed) {
  if (!object(input) || Object.keys(input).some(key => !['tenant', 'slot', ...allowed].includes(key)) ||
      typeof input.tenant !== 'string' || typeof input.slot !== 'string')
    throw failure('FLEET_CLIENT_PARAMETERS');
}
async function privateDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const value = await lstat(path);
  if (!value.isDirectory() || value.isSymbolicLink() || process.platform !== 'win32' && (value.mode & 0o077) ||
      await realpath(path) !== path)
    throw failure('FLEET_CLIENT_DIRECTORY');
}

/** The parent owns the fleet lease and sessions. Every retained export stays in
 * the original five-file customer format under this declared tenant and slot. */
export function createFleetClientDesk({ directory, planDigest, locate, getManaged }) {
  const root = join(resolve(directory), 'clients'), opened = new Map();
  let closing = false, closed;
  async function scope(input, allowed) {
    fields(input, allowed);
    if (closing) throw failure('FLEET_CLIENT_CLOSING', 503);
    const selected = locate(input.tenant, input.slot), key = selected.key;
    let pending = opened.get(key);
    if (!pending) {
      pending = (async () => {
        const merchant = join(root, input.tenant), target = join(merchant, input.slot);
        await privateDirectory(root); await privateDirectory(merchant); await privateDirectory(target);
        if (closing) throw failure('FLEET_CLIENT_CLOSING', 503);
        const console = await createReleaseClientConsole(selected.slot.store, {
          directory: target, getManaged: () => getManaged(input.tenant, input.slot),
        });
        const reads = new MerchantClientExports({ directory: target });
        return { console, reads, tenant: input.tenant, slot: input.slot };
      })();
      opened.set(key, pending);
      pending.catch(() => { if (opened.get(key) === pending) opened.delete(key); });
    }
    const desk = await pending;
    if (closing) throw failure('FLEET_CLIENT_CLOSING', 503);
    return desk;
  }
  const publicView = (input, value) => {
    const { directory: _directory, ...view } = value;
    return { tenant: input.tenant, slot: input.slot, ...view };
  };
  const params = ({ tenant, slot, ...input }) => input;
  async function consoleCall(method, allowed, input) {
    const desk = await scope(input, allowed);
    return publicView(input, await desk.console[method](params(input)));
  }
  async function readCall(method, allowed, input) {
    const desk = await scope(input, allowed);
    return publicView(input, await desk.reads.call('merchant_client_export_' + method, params(input)));
  }
  const api = {
    list: input => consoleCall('list', ['after', 'limit'], input),
    inspect: input => consoleCall('inspect', ['exportId'], input),
    generate: input => consoleCall('generate', ['id', 'instanceId'], input),
    adopt: input => consoleCall('adopt', ['exportId', 'expectedFilesSha256'], input),
    manifest: input => readCall('manifest', ['exportId'], input),
    file: input => readCall('file', ['exportId', 'file', 'expectedManifestSha256',
      'expectedSha256', 'readId', 'offset', 'limit'], input),
    releaseFile: input => readCall('file_release', ['exportId', 'readId'], input),
    async sendDownload(req, res, input) {
      const desk = await scope(input, ['exportId', 'expectedManifestSha256', 'file', 'expectedSha256']);
      return desk.console.sendDownload(req, res, params(input));
    },
    async download(input) {
      fields(input, ['exportId', 'expectedManifestSha256', 'directory', 'signal', 'onProgress']);
      if (typeof input.directory !== 'string' || !input.directory || input.directory.includes('\0') ||
          typeof input.expectedManifestSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.expectedManifestSha256))
        throw failure('FLEET_CLIENT_DOWNLOAD_PARAMETERS');
      const selected = { tenant: input.tenant, slot: input.slot };
      // Reuse the original checkpointed writer. Its endpoint identity prevents a
      // same-named export in another tenant or slot from adopting these bytes.
      const client = { endpoint: 'stellar-forge-fleet:' + planDigest + '/' + input.tenant + '/' + input.slot,
        call(name, args) {
          const methods = { merchant_client_export_manifest: 'manifest',
            merchant_client_export_file: 'file', merchant_client_export_file_release: 'releaseFile' };
          const method = methods[name];
          if (!method) throw failure('FLEET_CLIENT_OPERATION_UNKNOWN');
          return api[method]({ ...selected, ...args });
        } };
      const result = await downloadSellerClientExport({ client, exportId: input.exportId, directory: input.directory,
        expectedManifestSha256: input.expectedManifestSha256, signal: input.signal, onProgress: input.onProgress });
      return { tenant: input.tenant, slot: input.slot, ...result };
    },
    get summary() { return { available: !closing, openedSlots: opened.size }; },
    close() {
      if (!closed) {
        closing = true;
        closed = (async () => {
          const results = await Promise.allSettled([...opened.values()].map(async pending => {
            const desk = await pending;
            const result = await Promise.allSettled([desk.console.close(), desk.reads.close()]);
            const failures = result.filter(row => row.status === 'rejected').map(row => row.reason);
            if (failures.length) throw new AggregateError(failures, 'Original customer handover close failed');
          }));
          const errors = results.filter(row => row.status === 'rejected' && row.reason?.code !== 'FLEET_CLIENT_CLOSING').map(row => row.reason);
          opened.clear();
          if (errors.length) throw Object.assign(failure('FLEET_CLIENT_SHUTDOWN_INCOMPLETE', 500),
            { cause: new AggregateError(errors, 'Original customer handover close failed') });
        })();
      }
      return closed;
    },
  };
  return api;
}

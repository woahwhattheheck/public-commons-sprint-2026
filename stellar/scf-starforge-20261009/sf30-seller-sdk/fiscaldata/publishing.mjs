// MIT. Treasury source packages through the existing publisher/SF82/SF88.
import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { fault } from '../postgres/publisher/files.mjs';

export async function openFiscalPublisher({ directory, buyerWorkspaces = [], resolveExport, retainDownload, retainAcquisition }) {
  let native = null, opening = null;
  const buyers = new Map(buyerWorkspaces.map(value => [value.id, value]));
  async function ensure() {
    if (native) return native;
    if (!opening) opening = (async () => {
      const { openSocrataPublisher } = await import('../socrata/publisher.mjs');
      native = await openSocrataPublisher({ directory });
      return native;
    })().finally(() => { opening = null; });
    return opening;
  }
  async function state() {
    if (!native) {
      try { await lstat(join(directory, 'drafts', 'workspace.json')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }
    return (await ensure()).state();
  }
  async function act(action, input = {}) {
    let payload = structuredClone(input);
    if (action === 'publisher.prepare') {
      if (Object.keys(payload).join(',') !== 'exportId') throw fault('MERCHANT_EXPORT_REQUIRED', 'Choose a retained Fiscal Data merchant export.');
      const source = await resolveExport(payload.exportId);
      if (source.kind !== 'merchant') throw fault('MERCHANT_EXPORT_REQUIRED', 'Configure this edition as a merchant before preparing publication.');
      payload = { exportDirectory: source.directory };
    }
    if (action === 'publisher.buyer.session') {
      const selected = buyers.get(payload.workspaceId);
      if (!selected || Object.hasOwn(payload, 'workspaceDirectory'))
        throw fault('BUYER_WORKSPACE_REQUIRED', 'Select an original buyer workspace configured by this operator host.');
      delete payload.workspaceId;
      payload.workspaceDirectory = selected.directory;
    }
    const result = await (await ensure()).act(action, payload);
    if (action === 'publisher.buyer.export')
      result.result = { ...result.result, export: await retainAcquisition(result.result) };
    return result.result;
  }
  async function file(id, name) {
    const kind = {
      'buyer-config.json': 'buyer-config', 'draft-csv.csv': 'draft-csv',
      'draft-review.json': 'draft-review', 'session-manifest.json': 'session-manifest',
    }[name];
    if (!kind) throw fault('PUBLISHER_FILE_UNKNOWN', 'Choose a retained original publisher download.', 404);
    const value = await (await ensure()).readExport(kind, id);
    return retainDownload(id, name, value.bytes, value.contentType);
  }
  return { state, act, file, async close() { if (opening) await opening; await native?.close(); } };
}

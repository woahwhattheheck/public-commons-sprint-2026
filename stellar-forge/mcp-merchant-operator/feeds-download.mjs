// MIT. Original retained downloader, scoped to the original feed workspace.
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { FEEDS_MANIFEST_NAME, MAX_FEEDS_DELIVERY_BYTES, parseFeedsDeliveryManifest } from './feeds-manifest.mjs';
function original(workspace) {
  if (typeof workspace !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(workspace))
    throw Object.assign(new Error('Select the original configured feed workspace alias.'), { code: 'FEEDS_DOWNLOAD_CONFIGURATION' });
  return createRetainedDownload({
    manifestName: FEEDS_MANIFEST_NAME, parseManifest: (bytes, exportId) => {
      const value = parseFeedsDeliveryManifest(bytes, exportId);
      if (value.workspace !== workspace) throw Object.assign(new Error('The delivery belongs to another workspace.'), { code: 'FEEDS_EXPORT_CONFLICT' });
      return value;
    },
    maximumBytes: MAX_FEEDS_DELIVERY_BYTES, stateSchema: 'stellar-forge.feeds-download-state.v1',
    resultSchema: 'stellar-forge.feeds-download.v1', toolPrefix: 'merchant_feeds_download',
    errorPrefix: 'FEEDS', clientName: 'starforge-feed-receiving',
    describe: manifest => ({ workspace: manifest.workspace, kind: manifest.kind, selection: manifest.selection }),
    connect: async options => {
      const client = await openMerchantFileClient(options);
      return { endpoint: client.endpoint, call: (name, args, callOptions) => client.call(name, { ...args, workspace }, callOptions) };
    },
  });
}
export async function downloadFeedsDelivery({ workspace, ...options } = {}) { return original(workspace).download(options); }
export async function inspectFeedsDelivery({ workspace, ...options } = {}) { return original(workspace).inspect(options); }

// MIT. Compare caller decisions with the original native WebDAV intent encoding.
import { identity } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/webdav/config.mjs';
import { webDavJson, webDavHash, webDavError, webDavPlain } from './webdav-workspace-contracts.mjs';

export { webDavBindingSelection } from './catalog/webdav-tools.mjs';

const select = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
function exactInput(input, keys) {
  if (!webDavPlain(input) || Object.keys(input).some(key => !keys.includes(key)))
    throw webDavError('WEBDAV_CLIENT_NATIVE_INPUT', 'Retain only the original publisher action fields.');
}
function expectedIntent(record, originalInput) {
  const args = record.args, profile = record.profileBinding?.value;
  switch (record.tool) {
    case 'merchant_webdav_source': return { action: 'source.save', input: { source: profile } };
    case 'merchant_webdav_catalogue': return { action: 'source.catalogue', input: select(args, ['href','depth','offset','limit']) };
    case 'merchant_webdav_capture':
      if (args.action === 'start') return { action: 'capture.start', input: { selection: args.selection } };
      if (args.action === 'resume') return { action: 'capture.resume', input: { captureId: args.captureId } };
      return { action: 'capture.sample', input: select(args, ['captureId','format','recordsPointer','limit']) };
    case 'merchant_webdav_mapping': return { action: 'mapping.save',
      input: { captureId: args.captureId, expectedCaptureSha256: args.expectedCaptureSha256, projection: args.projection } };
    case 'merchant_webdav_edition':
      return args.action === 'build'
        ? { action: 'edition.build', input: { mappingId: args.mappingId, dataset: args.dataset, review: args.review } }
        : { action: 'edition.export', input: { editionId: args.editionId, merchantId: args.merchantId,
          reviewer: args.reviewer, note: args.note ?? '' } };
    case 'merchant_webdav_merchant': return { action: 'merchant.save',
      input: { ...profile, editionId: args.editionId, reviewer: args.reviewer, note: args.note ?? '' } };
    case 'merchant_webdav_packet': return { action: 'source.packet', input: {} };
    case 'merchant_webdav_publisher': {
      const input = webDavJson(args.payload ?? {});
      if (args.action === 'publisher.prepare') {
        exactInput(input, ['exportId','productId','title']);
        return { action: 'publisher.prepare', input };
      }
      if (args.action === 'publisher.release.stage') {
        exactInput(input, ['draftId','id','label']); input.runtime = profile;
      }
      if (args.action === 'publisher.buyer.session') {
        exactInput(input, ['buyerId','buyerWorkspace','maxPages','maxTotalAtomic','maxRows','maxPageBytes']);
        const directory = originalInput?.input?.workspaceDirectory;
        if (typeof directory !== 'string' || !directory
            || webDavHash(Buffer.from(directory)) !== profile?.directorySha256)
          throw webDavError('WEBDAV_CLIENT_NATIVE_INTENT_CHANGED', 'The original buyer operation belongs to another declared workspace.');
        delete input.buyerWorkspace; input.workspaceDirectory = directory;
      }
      return { action: 'publisher.act', input: { productId: args.productId, action: args.action, input } };
    }
    default: throw webDavError('WEBDAV_CLIENT_OPERATION_TOOL', 'Select an original native WebDAV mutation.');
  }
}
/** Require the original UUID, action, exact input and native canonical digest. */
export function verifyWebDavNativeOperation(record, native) {
  if (!native) return null;
  const operation = native.operation;
  if (!operation || operation.id !== record.id || !webDavPlain(operation.input))
    throw Object.assign(webDavError('WEBDAV_CLIENT_NATIVE_INTENT_CHANGED', 'Read the complete original native operation and its saved input.'), { nativeResult: native });
  const expected = expectedIntent(record, operation.input);
  const actual = { action: operation.action, input: operation.input };
  if (operation.action !== expected.action || operation.intentSha256 !== identity(actual)
      || operation.intentSha256 !== identity(expected))
    throw Object.assign(webDavError('WEBDAV_CLIENT_NATIVE_INTENT_CHANGED', 'This native operation UUID belongs to a different original action or reviewed input.'), { nativeResult: native });
  return native;
}

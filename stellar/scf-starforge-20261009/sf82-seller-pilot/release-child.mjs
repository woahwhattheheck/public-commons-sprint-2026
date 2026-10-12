// MIT. Existing release-manager ownership barrier and original pilot bootstrap.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachReleaseCacheControls } from './release-cache.mjs';
import { releaseProcessOwner, inheritedReleaseLease } from './release-process.mjs';
import { withNativePaymentReview } from '../sf30-seller-sdk/native-factory.mjs';

const [pilot, directory, instanceId, controlFile, lifetimeDescriptor = '-'] = process.argv.slice(2);
function nativeFailureCode(error) {
  // Original pilot families preserve their startup error as Error.cause.
  // Report only these public codes; never expose arbitrary nested messages.
  for (let current = error, depth = 0; current && typeof current === 'object' && depth < 16;
    current = current.cause, depth++) {
    if (['FACILITATOR_REVIEW_CHANGED', 'SELLER_FLOW_OUTSIDE_FACILITATOR_POLICY'].includes(current.code)) return current.code;
  }
  return null;
}
let started = false;
process.once('disconnect', () => { if (!started) process.exit(0); });
process.once('message', async message => {
  if (message?.type !== 'sf82-start' || message.instanceId !== instanceId) process.exit(1);
  started = true;
  // Node may still be flushing messages buffered before this listener was
  // attached. Let that dispatch finish before clearing the IPC channel.
  setImmediate(() => { if (process.connected) process.disconnect(); });
  let session, control;
  try {
    const { launch } = await import(pathToFileURL(pilot).href);
    session = await withNativePaymentReview(message.facilitatorReview,
      () => launch(['--resume', directory]));
    if (!session.server?.listening) throw new Error('Original seller stopped before cache attachment.');
    control = await attachReleaseCacheControls(session, { controlFile, routes: message.cacheRoutes });
    const originalClose = session.close.bind(session);
    let closing;
    session.close = () => closing ??= (async () => {
      try { return await originalClose(); } finally { await control?.close(); }
    })();
    if (!session.server.listening) throw new Error('Original seller stopped during cache attachment.');
    const report = JSON.parse(await readFile(join(directory, 'runtime-readiness.json'), 'utf8'));
    process.stdout.write(JSON.stringify({ releaseReady: true, instanceId,
      originalOffersSha256: report.originalOffersSha256,
      originalServiceConfigSha256: report.originalServiceConfigSha256,
      listener: session.url, mode: session.mode, cacheControlAvailable: control !== null,
      ...((session.jsonrpc || session.postgres || session.clickhouse || session.opensearch || session.grpc) && session.operations ? { operations: {
        url: session.operations.url, availability: session.operations.availabilityUrl,
        availabilityControl: session.operations.availabilityControlUrl,
      } } : {}) }) + '\n');
  } catch (error) {
    await session?.close().catch(() => {}); await control?.close().catch(() => {});
    const code = nativeFailureCode(error);
    process.stderr.write(code === 'FACILITATOR_REVIEW_CHANGED'
      ? 'FACILITATOR_REVIEW_CHANGED: Review the current native payment requirements and stage a new release.\n'
      : code === 'SELLER_FLOW_OUTSIDE_FACILITATOR_POLICY'
        ? 'SELLER_FLOW_OUTSIDE_FACILITATOR_POLICY: The configured facilitator does not advertise this merchant payment flow.\n'
      : JSON.stringify({ error: 'RELEASE_CHILD_START_FAILED', cause: {
        name: String(error?.name ?? 'Error').slice(0, 80),
        ...(typeof error?.code === 'string' ? { code: error.code.slice(0, 120) } : {}),
        message: String(error?.message ?? 'Startup failed').slice(0, 1600),
      } }) + '\n'); process.exitCode = 1;
  }
});
// No application import or listener is permitted before the original manager
// durably records this exact worker identity and grants startup over this IPC.
const owner = await releaseProcessOwner();
const kernelLease = inheritedReleaseLease(lifetimeDescriptor);
process.send({ type: 'sf82-owner', instanceId, pid: owner.pid,
  processIdentity: owner.processIdentity, kernelLease }, error => { if (error) process.exit(1); });

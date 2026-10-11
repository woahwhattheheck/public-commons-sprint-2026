// MIT. Original SF30 native seller + private operations + retained availability.
import { isAbsolute, resolve } from 'node:path';
import { startSellerService } from '../serve.mjs';
import { startSellerOperations } from '../operations/server.mjs';
import { validateAvailabilityDirectory } from '../availability/store.mjs';
import { createStellarRpcApplication } from './application.mjs';

function portNumber(port) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid merchant listener port');
}
export async function startStellarRpcMerchant({ plan, env = process.env, port = 8423,
  operationsPort = 8424, nativeFactory = null, allowLoopbackUpstream = false, lookup,
  navigationOrigin = null,
  availabilityDirectory, historyDirectory, historyRetentionDays = 90, deliveryOutbox,
  maxInFlight = 64, drainGraceMs = 60000, handlerTimeoutMs, requestTimeoutMs } = {}) {
  portNumber(port);
  if (operationsPort !== null) portNumber(operationsPort);
  if (port && port === operationsPort) throw new TypeError('Choose different seller and operations ports');
  if (nativeFactory !== null && typeof nativeFactory !== 'function') throw new TypeError('Original native factory required');
  if (availabilityDirectory !== undefined) validateAvailabilityDirectory(availabilityDirectory);
  if (historyDirectory !== undefined && (!isAbsolute(historyDirectory) ||
      resolve(historyDirectory) !== historyDirectory || historyDirectory === '/' ||
      historyDirectory === availabilityDirectory)) throw new TypeError('Separate absolute private history directory required');
  if (!Number.isSafeInteger(historyRetentionDays) || historyRetentionDays < 1 || historyRetentionDays > 365)
    throw new TypeError('History retention must be 1–365 days');
  if (operationsPort === null && (historyDirectory !== undefined || deliveryOutbox !== undefined))
    throw new TypeError('Operations listener required for history and fulfillment');
  const application = createStellarRpcApplication(plan, { env, allowLoopbackUpstream, lookup });
  let seller, operations;
  try {
    // One original provider getNetwork read pins data-network identity before sale.
    // A failed check leaves both merchant listeners unopened.
    await application.verifyNetwork();
    seller = await startSellerService({ config: application.config, handlers: application.handlers,
      port, nativeFactory, availabilityDirectory, maxInFlight, drainGraceMs,
      ...(handlerTimeoutMs === undefined ? {} : { handlerTimeoutMs }),
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }) });
    seller.upstreamSnapshot = application.snapshot;
    if (operationsPort !== null) operations = await startSellerOperations(seller, {
      port: operationsPort, historyDirectory, historyRetentionDays, deliveryOutbox, navigationOrigin,
    });
  } catch (cause) {
    if (seller) await seller.close().catch(() => {});
    if (operations) await operations.close().catch(() => {});
    await application.close().catch(() => {});
    throw cause;
  }
  let closing;
  const close = () => closing ??= (async () => {
    let failure;
    // Preserve the original observer through native verification/settlement drain.
    try { await seller.close(); } catch (cause) { failure = cause; }
    try { await operations?.close(); } catch (cause) { failure ??= cause; }
    try { await application.close(); } catch (cause) { failure ??= cause; }
    if (failure) throw failure;
  })();
  return { ...seller, operations, application, close };
}

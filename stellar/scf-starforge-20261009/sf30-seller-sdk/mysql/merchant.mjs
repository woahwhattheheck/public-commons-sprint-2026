// MIT. The original shared database binding and SF30 seller own HTTP/payment.
import { startPostgresMerchant } from '../postgres/merchant.mjs';
import { bindPostgresSeller } from '../postgres/bindings.mjs';
import { readSellerConfig } from '../serve.mjs';
import { openMysqlSourceFile } from './config.mjs';
import { validateAvailabilityDirectory } from '../availability/store.mjs';

export const bindMysqlSeller = bindPostgresSeller;
export const startMysqlMerchant = startPostgresMerchant;

/** The native CLI and browser use one original facilitator construction. */
export async function createMysqlNativeFactory({ facilitator, allowLocalFacilitator = false } = {}) {
  if (!facilitator) {
    if (allowLocalFacilitator) throw new TypeError('MYSQL_LAUNCH_OPTIONS_CONFLICT');
    return null;
  }
  const url = new URL(facilitator);
  const local = allowLocalFacilitator && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
    throw new TypeError('MYSQL_FACILITATOR_URL_INVALID');
  const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
    import('@x402/core/server'), import('../native-factory.mjs')]);
  return compiled => createNativeSellerServer(compiled, {
    facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }) });
}

export async function startMysqlSeller({ sourceFile, configFile, environment = process.env,
  port = 8423, operationsPort = 8424, nativeFactory = null,
  maxInFlight = 64, drainGraceMs = 60000, availabilityDirectory } = {}) {
  if (availabilityDirectory !== undefined) validateAvailabilityDirectory(availabilityDirectory);
  const config = await readSellerConfig(configFile);
  const { source, config: declaration } = await openMysqlSourceFile(sourceFile, { environment });
  try {
    return await startMysqlMerchant({ source, config, bindings: declaration.bindings,
      port, operationsPort, nativeFactory, maxInFlight, drainGraceMs, availabilityDirectory });
  } catch (issue) { await source.close(); throw issue; }
}

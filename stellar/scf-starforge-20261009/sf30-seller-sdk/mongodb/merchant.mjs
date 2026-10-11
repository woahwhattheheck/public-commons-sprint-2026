// MIT. Existing SF30 database binding, seller, operations and facilitator factory.
import { startPostgresMerchant } from '../postgres/merchant.mjs';
import { bindPostgresSeller } from '../postgres/bindings.mjs';
import { createMysqlNativeFactory } from '../mysql/merchant.mjs';
import { readSellerConfig } from '../serve.mjs';
import { openMongoSourceFile } from './config.mjs';
import { validateAvailabilityDirectory } from '../availability/store.mjs';

export const bindMongoSeller = bindPostgresSeller;
export const startMongoMerchant = startPostgresMerchant;
export const createMongoNativeFactory = createMysqlNativeFactory;
export async function startMongoSeller({ sourceFile, configFile, environment = process.env,
  port = 8423, operationsPort = 8424, nativeFactory = null, maxInFlight = 64,
  drainGraceMs = 60000, availabilityDirectory } = {}) {
  if (availabilityDirectory !== undefined) validateAvailabilityDirectory(availabilityDirectory);
  const config = await readSellerConfig(configFile), { source, config: declaration } = await openMongoSourceFile(sourceFile, { environment });
  try { return await startMongoMerchant({ source, config, bindings: declaration.bindings,
    port, operationsPort, nativeFactory, maxInFlight, drainGraceMs, availabilityDirectory }); }
  catch (issue) { await source.close(); throw issue; }
}

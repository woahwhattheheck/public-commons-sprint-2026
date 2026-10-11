// MIT. The original seller owns HTTP, native payments, operations and drain.
import { startPostgresMerchant } from '../postgres/merchant.mjs';
import { bindPostgresSeller } from '../postgres/bindings.mjs';
import { createMysqlNativeFactory } from '../mysql/merchant.mjs';
import { readSellerConfig } from '../serve.mjs';
import { validateAvailabilityDirectory } from '../availability/store.mjs';
import { openRedisSourceFile } from './config.mjs';

export const bindRedisSeller = bindPostgresSeller;
export const startRedisMerchant = startPostgresMerchant;

/** Reuse the existing explicit facilitator construction for the Redis seller. */
export async function createRedisNativeFactory(options = {}) {
  try { return await createMysqlNativeFactory(options); }
  catch (issue) {
    if (issue instanceof TypeError && ['MYSQL_LAUNCH_OPTIONS_CONFLICT', 'MYSQL_FACILITATOR_URL_INVALID'].includes(issue.message))
      throw new TypeError(issue.message.replace(/^MYSQL_/, 'REDIS_'), { cause: issue });
    throw issue;
  }
}

export async function startRedisSeller({ sourceFile, configFile, environment = process.env,
  port = 8423, operationsPort = 8424, nativeFactory = null,
  maxInFlight = 64, drainGraceMs = 60000, availabilityDirectory } = {}) {
  if (availabilityDirectory !== undefined) validateAvailabilityDirectory(availabilityDirectory);
  const config = await readSellerConfig(configFile);
  const { source, config: declaration } = await openRedisSourceFile(sourceFile, { environment });
  try {
    return await startRedisMerchant({ source, config, bindings: declaration.bindings,
      port, operationsPort, nativeFactory, maxInFlight, drainGraceMs, availabilityDirectory });
  } catch (issue) { await source.close().catch(() => {}); throw issue; }
}

// MIT. The original shared database binding and SF30 seller own HTTP/payment.
import { startPostgresMerchant } from '../postgres/merchant.mjs';
import { bindPostgresSeller } from '../postgres/bindings.mjs';
import { readSellerConfig } from '../serve.mjs';
import { openMysqlSourceFile } from './config.mjs';

export const bindMysqlSeller = bindPostgresSeller;
export const startMysqlMerchant = startPostgresMerchant;

export async function startMysqlSeller({ sourceFile, configFile, environment = process.env,
  port = 8423, operationsPort = 8424, nativeFactory = null,
  maxInFlight = 64, drainGraceMs = 60000 } = {}) {
  const config = await readSellerConfig(configFile);
  const { source, config: declaration } = await openMysqlSourceFile(sourceFile, { environment });
  try {
    return await startMysqlMerchant({ source, config, bindings: declaration.bindings,
      port, operationsPort, nativeFactory, maxInFlight, drainGraceMs });
  } catch (issue) { await source.close(); throw issue; }
}

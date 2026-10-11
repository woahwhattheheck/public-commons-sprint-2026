#!/usr/bin/env node
// MIT. Workspace launch API over the maintained source and original seller.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSellerConfig } from '../serve.mjs';
import { openPostgresQueryFile } from './config.mjs';
import { startPostgresMerchant } from './merchant.mjs';
import { main } from './start.mjs';
export { main };

export async function startPostgresSeller({ sourceFile, configFile, port = 8423,
  operationsPort = 8424, nativeFactory = null, maxInFlight = 64, drainGraceMs = 60000,
  environment = process.env } = {}) {
  const config = await readSellerConfig(resolve(configFile));
  const { source, bindings } = await openPostgresQueryFile(resolve(sourceFile), { environment });
  let seller;
  try {
    seller = await startPostgresMerchant({ source, config, bindings, port, operationsPort,
      nativeFactory, maxInFlight, drainGraceMs });
  } catch (issue) { await source.close(); throw issue; }
  return { seller, source, operations: seller.operations, close: () => seller.close() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(issue => {
    process.stderr.write(JSON.stringify({ error: issue.code ?? issue.message ?? 'POSTGRES_START_FAILED',
      ...(issue.query ? { query: issue.query } : {}), ...(issue.sqlState ? { sqlState: issue.sqlState } : {}) }) + '\n');
    process.exitCode = 1;
  });
}

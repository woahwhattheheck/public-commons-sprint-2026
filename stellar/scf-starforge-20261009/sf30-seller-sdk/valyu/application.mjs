// MIT. Trusted application binding for the original SF30 serve/operations launcher.
import { readFile, stat } from 'node:fs/promises';
import { createValyuAdapter } from './adapter.mjs';
import { normalizeValyuProvider, validateValyuServiceConfig } from './config.mjs';

const configFile = process.env.VALYU_MERCHANT_CONFIG;
if (typeof configFile !== 'string' || !configFile.trim())
  throw new TypeError('VALYU_MERCHANT_CONFIG must identify the same seller-service.json supplied to the original launcher');
const info = await stat(configFile);
if (!info.isFile() || info.size > 1048576) throw new TypeError('Valyu merchant config must be a regular file up to 1 MiB');
const bytes = await readFile(configFile);
if (bytes.length > 1048576) throw new TypeError('Valyu merchant config exceeds 1 MiB');
const config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
validateValyuServiceConfig(config);
const application = createValyuAdapter({ provider: normalizeValyuProvider(config.provider) });
export const valyuSearch = application.handlers.valyuSearch;
export const admitValyuSearch = application.handlers.admitValyuSearch;

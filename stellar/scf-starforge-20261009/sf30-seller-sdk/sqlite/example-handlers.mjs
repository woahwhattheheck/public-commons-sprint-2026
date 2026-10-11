// MIT. Trusted merchant handler module loaded by the EXISTING SF30 serve.mjs.
import { openSqliteQueryFile } from './config.mjs';
if (!process.env.SF30_SQLITE_SOURCE) throw new Error('Set SF30_SQLITE_SOURCE to your operator-owned source JSON file');
const source = await openSqliteQueryFile(process.env.SF30_SQLITE_SOURCE);
const catalog = source.route('catalog', { input: 'query' });
export const catalogQuery = catalog.handler;
export const admitCatalog = catalog.admit;
// Embedding applications should call this after stopping the seller. In the
// ordinary CLI, idle IPC is unreferenced and parent exit closes the child.
export const closeSqliteSource = () => source.close();

// MIT. Resolve the installed original Stellar Forge runtime without copying it.
import {resolve, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
export const runtimeRoot = resolve(process.env.FIRECRAWL_RUNTIME_ROOT ??
  fileURLToPath(new URL('../../', import.meta.url)));
export const native = name => import(pathToFileURL(join(runtimeRoot, name)).href);

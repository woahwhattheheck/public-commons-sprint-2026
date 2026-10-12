// MIT. Use the maintained source/installed Stellar Forge runtime.
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const runtimeRoot=resolve(process.env.OPEN_METEO_RUNTIME_ROOT??fileURLToPath(new URL('../../',import.meta.url)));
export const native=name=>import(pathToFileURL(join(runtimeRoot,name)).href);

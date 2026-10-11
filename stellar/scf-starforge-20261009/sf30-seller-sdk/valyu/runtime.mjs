// MIT. Resolve the maintained native runtime in source or installed distributions.
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const runtimeRoot=resolve(process.env.VALYU_RUNTIME_ROOT??fileURLToPath(new URL('../../',import.meta.url)));
export const native=name=>import(pathToFileURL(join(runtimeRoot,name)).href);

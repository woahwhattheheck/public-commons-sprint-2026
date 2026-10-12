// MIT. Compatibility entry point for the original SF82 dataset release runtime.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from '../../sf82-seller-pilot/release-dataset.mjs';
export { startDatasetRelease, launch } from '../../sf82-seller-pilot/release-dataset.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  launch().catch(issue => {
    process.stderr.write(JSON.stringify({ error: issue.message, code: issue.code ?? 'OAI_RUNTIME_FAILED' }) + '\n');
    process.exitCode = 1;
  });

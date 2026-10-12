// MIT. Installed provider handoff entrypoint, using the original ERDDAP CLI owner.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { main as erddapMain } from './cli.mjs';
export const main = (args = process.argv.slice(2)) => erddapMain(['provider-handoff', ...args]);
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({error: 'ERDDAP_PROVIDER_CLI', message: error.message}) + '\n'); process.exitCode = 1; });

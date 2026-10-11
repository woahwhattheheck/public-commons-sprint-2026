// MIT. Create, operate and move one private Allium workspace; Node 22+ and Linux flock.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAlliumWorkspace, openAlliumWorkspace, importAlliumWorkspace } from './model.mjs';
import { startAlliumWorkspaceServer } from './server.mjs';
import { createFile, bytes } from '../../../sf30-seller-sdk/postgres/publisher/files.mjs';

const HELP = `Allium retained operator workspace
  create --workspace NEW_DIRECTORY --product PRODUCT_JSON [--name NAME]
  serve --workspace DIRECTORY [--port 8447] [--allow-loopback-provider]
  status --workspace DIRECTORY
  export --workspace DIRECTORY --out NEW_JSON_FILE
  import --workspace NEW_DIRECTORY --bundle EXPORTED_JSON_FILE

create, status, export and import are offline. serve prints a private local URL.
The explicit Start query action runs the saved Allium query using its named host
environment key. A retained run ID is collected or recovered, never resubmitted.
The original dataset publisher and merchant are owned by this process and stop
on shutdown. Export stops its merchant and retains all source, versions and buyer
records; import opens stopped. Close an existing server before CLI export/status.
--allow-loopback-provider is only for an explicitly supplied local contract host.
No command installs a dependency, enables Actions or creates a wallet.`;
const OPTIONS = { create: ['workspace', 'product', 'name'], serve: ['workspace', 'port', 'allow-loopback-provider'],
  status: ['workspace'], export: ['workspace', 'out'], import: ['workspace', 'bundle'] };
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.length === 1 && ['--help', 'help'].includes(argv[0])) { console.log(HELP); return; }
  const [command, ...args] = argv, allowed = OPTIONS[command];
  if (!allowed) throw new TypeError(HELP);
  const option = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index].replace(/^--/, '');
    if (!args[index].startsWith('--') || !allowed.includes(key) || Object.hasOwn(option, key)) throw new TypeError('Unknown or duplicate option: ' + args[index]);
    if (key === 'allow-loopback-provider') option[key] = true;
    else { if (!args[index + 1] || args[index + 1].startsWith('--')) throw new TypeError('Missing value for --' + key); option[key] = args[++index]; }
  }
  if (!option.workspace) throw new TypeError('--workspace is required');
  const directory = resolve(option.workspace);
  const read = async path => new TextDecoder('utf-8', { fatal: true }).decode(await readFile(resolve(path)));
  let result;
  if (command === 'create') {
    if (!option.product) throw new TypeError('--product is required');
    result = await createAlliumWorkspace({ directory, productText: await read(option.product), name: option.name });
  } else if (command === 'import') {
    if (!option.bundle) throw new TypeError('--bundle is required');
    result = await importAlliumWorkspace({ directory, bundle: JSON.parse(await read(option.bundle)) });
  } else if (command === 'serve') {
    const port = option.port === undefined ? 8447 : Number(option.port);
    const host = await startAlliumWorkspaceServer({ directory, port, allowLoopback: option['allow-loopback-provider'] === true });
    console.log(JSON.stringify({ directory, operatorUrl: host.url, original: 'Allium + SF30 dataset publisher' }, null, 2));
    let stopped = false;
    const close = () => { if (stopped) return; stopped = true; host.close().catch(error => { console.error(error.message); process.exitCode = 1; }); };
    process.once('SIGINT', close); process.once('SIGTERM', close); return host;
  } else {
    const workspace = await openAlliumWorkspace({ directory });
    try {
      if (command === 'status') result = await workspace.state();
      else {
        if (!option.out) throw new TypeError('--out is required');
        const bundle = await workspace.exportBundle(), data = bytes(bundle);
        await createFile(resolve(option.out), data);
        result = { path: resolve(option.out), bytes: data.length, manifestSha256: bundle.manifestSha256, runtime: 'STOPPED' };
      }
    } finally { await workspace.close(); }
  }
  console.log(JSON.stringify(result, null, 2)); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error((error.code ? error.code + ': ' : '') + error.message); process.exitCode = 1; });

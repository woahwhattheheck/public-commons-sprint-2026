// MIT. Create a merchant workspace from the packaged original SF30 examples.
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const templates = new Set(['dataset', 'application', 'upstream']);
const example = name => new URL('../sf30-seller-sdk/examples/' + name, import.meta.url);
const json = value => JSON.stringify(value, null, 2) + '\n';
const shellQuote = value => "'" + value.replace(/'/g, "'\\''") + "'";
export const workspaceSchema = 'stellar-forge.merchant-workspace.v1';

export async function createWorkspace({ directory, template = 'dataset', release = null }) {
  if (typeof directory !== 'string' || !directory || !templates.has(template))
    throw new TypeError('init requires --dir DIRECTORY and a dataset, application or upstream template');
  const target = resolve(directory);
  const config = JSON.parse(await readFile(example(template === 'upstream' ? 'upstream-service.json' : 'service.json'), 'utf8'));
  const files = new Map();
  if (template === 'dataset') {
    const data = config.routes[0].response;
    delete config.routes[0].response;
    config.routes[0].responseFile = './data/catalog.json';
    files.set('data/catalog.json', json(data));
  } else if (template === 'application') {
    delete config.routes[0].response;
    config.routes[0].handler = 'dataset';
    files.set('application.mjs', await readFile(example('application.mjs')));
  } else files.set('upstreams.json', await readFile(example('upstreams.json')));
  files.set('seller.json', json(config));
  files.set('workspace.json', json({ schema: workspaceSchema, template,
    packageVersion: release?.packageVersion ?? null, sourceCommit: release?.sourceCommit ?? null }));
  files.set('.gitignore', '.private/\nnode_modules/\n');
  files.set('README.md', `# Merchant workspace\n\nTemplate: ${template}. Edit seller.json to describe your own resource and exact payment terms.\n\nThe supplied example uses the original SF30 nonpayable testnet markers. The default command runs the original challenge-only seller and operations dashboard.\n\nFrom the directory where you installed the package (POSIX shell):\n\n    npx --no-install starforge run --workspace ${shellQuote(target)} -- --port 0\n\nThe two startup lines print seller and dashboard addresses. The seller exposes /_seller/docs and /_seller/openapi.json.\n\n${template === 'dataset' ? 'Update data/catalog.json and restart to load a new JSON snapshot.' : template === 'application' ? 'Edit application.mjs. The original seller invokes the trusted handler only through its configured native payment lifecycle.' : 'Edit upstreams.json to name your existing backend. For the bundled loopback example, add --allow-loopback-upstream after --.'}\n\nFor native payments, install the documented optional packages, replace the example asset and recipient with your operator configuration, and pass --facilitator URL after --. Existing buyer approval, signer, request limits and settlement behavior remain in their native modules.\n`);
  // Nonrecursive mkdir deliberately refuses an existing target, including symlinks.
  // Keep any partial creation on an I/O failure so operator edits are never removed.
  await mkdir(target, { mode: 0o700 });
  if (template === 'dataset') await mkdir(join(target, 'data'), { mode: 0o700 });
  await mkdir(join(target, '.private'), { mode: 0o700 });
  for (const [name, content] of files)
    await writeFile(join(target, name), content, { flag: 'wx', mode: 0o600 });
  return { status: 'WORKSPACE_CREATED', directory: target, template,
    files: [...files.keys()], run: ['starforge', 'run', '--workspace', target, '--', '--port', '0'] };
}

export async function workspaceCommand(directory, extra = []) {
  const requested = resolve(directory);
  if (!(await lstat(requested)).isDirectory()) throw new TypeError('Workspace must be a directory');
  const target = await realpath(requested);
  const file = join(target, 'workspace.json');
  const info = await lstat(file);
  if (!info.isFile() || info.size > 16384) throw new TypeError('Invalid workspace.json');
  const bytes = await readFile(file);
  if (bytes.length > 16384) throw new TypeError('Invalid workspace.json');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!value || value.schema !== workspaceSchema || !templates.has(value.template))
    throw new TypeError('Unsupported merchant workspace');
  if (extra.some(arg => ['--config', '--handlers', '--upstreams'].includes(arg)))
    throw new TypeError('Workspace supplies config and application bindings; use the direct seller command to override them');
  const args = ['--config', join(target, 'seller.json')];
  if (value.template === 'application') args.push('--handlers', join(target, 'application.mjs'));
  if (value.template === 'upstream') args.push('--upstreams', join(target, 'upstreams.json'));
  return { upstream: value.template === 'upstream', args: [...args, ...extra] };
}

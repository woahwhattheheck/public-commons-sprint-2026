// MIT. Operator-facing Cube capture, preparation, export and native runtime composition.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectCubeMetadata } from './metadata.mjs';
import { createCubeWorkspace, inspectCubeWorkspace, captureCubeMetadata, probeCubeReport } from './workspace.mjs';
import { exportCubePackage, inspectCubePackage, prepareCubePackageBuyer } from './package.mjs';
import { launchCubePackage } from './runtime.mjs';
import { readBytes, parse } from './files.mjs';

const USAGE = `Cube merchant onboarding (original SF102/SF30/SF88 components)

node cli.mjs metadata --file CUBE_META_JSON
node cli.mjs capture-meta --upstream UPSTREAM_JSON --out CUBE_META_JSON [--path /cubejs-api/v1/meta]
node cli.mjs prepare --metadata CUBE_META_JSON --plan MERCHANT_PLAN_JSON --dir NEW_PRIVATE_DIR
node cli.mjs review --dir PRIVATE_DIR
node cli.mjs probe --dir PRIVATE_DIR --report REPORT_ID --out NEW_PRIVATE_RESULT_DIR
node cli.mjs export --dir PRIVATE_DIR --out NEW_PRIVATE_PACKAGE_DIR
node cli.mjs inspect-package --package PRIVATE_PACKAGE_DIR
node cli.mjs buyer --package PRIVATE_PACKAGE_DIR --report REPORT_ID --accept INDEX
                  --intent-id STABLE_OPERATION_ID --out NEW_REVIEW_JSON [--inputs INPUTS_JSON]
node cli.mjs launch --package PRIVATE_PACKAGE_DIR -- ORIGINAL_LAUNCH_OPTIONS

Launch options: --port 8423, --facilitator HTTPS_URL, --allow-local-facilitator,
--max-in-flight 64, --drain-grace-ms 60000, --operations, --operations-port 8424,
--history-dir PRIVATE_DIR, --history-days 90.
capture-meta and probe read the configured Cube backend. Other preparation,
review, export and buyer-draft commands are offline and load no credentials.
See onboarding/README.md for the merchant plan format and native buyer setup.`;

function flags(args, required, optional = []) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (![...required, ...optional].includes(key) || values.has(key) || typeof value !== 'string' || !value || value.startsWith('--'))
      throw new TypeError(`Unsupported, duplicate or missing option: ${key}`);
    values.set(key, value);
  }
  if (required.some(key => !values.has(key))) throw new TypeError('Required options: ' + required.join(' '));
  return values;
}
const file = path => resolve(path);
const readJson = async path => parse(await readBytes(file(path)), path);
const print = value => { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); return value; };

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === '--help') { process.stdout.write(USAGE + '\n'); return null; }
  const [command, ...tail] = args;
  if (command === 'metadata') {
    const f = flags(tail, ['--file']);
    return print(inspectCubeMetadata(await readJson(f.get('--file'))));
  }
  if (command === 'capture-meta') {
    const f = flags(tail, ['--upstream', '--out'], ['--path']);
    return print(await captureCubeMetadata({ upstream: await readJson(f.get('--upstream')),
      destination: file(f.get('--out')), ...(f.has('--path') ? { metaPath: f.get('--path') } : {}) }));
  }
  if (command === 'prepare') {
    const f = flags(tail, ['--metadata', '--plan', '--dir']);
    return print(await createCubeWorkspace({ directory: file(f.get('--dir')), metadataPath: file(f.get('--metadata')), planPath: file(f.get('--plan')) }));
  }
  if (command === 'review') {
    const f = flags(tail, ['--dir']);
    return print(await inspectCubeWorkspace(file(f.get('--dir'))));
  }
  if (command === 'probe') {
    const f = flags(tail, ['--dir', '--report', '--out']);
    const result = await probeCubeReport({ directory: file(f.get('--dir')), reportId: f.get('--report'), outputDirectory: file(f.get('--out')) });
    if (result.httpStatus !== 200) process.exitCode = 2;
    return print(result);
  }
  if (command === 'export') {
    const f = flags(tail, ['--dir', '--out']);
    return print(await exportCubePackage({ directory: file(f.get('--dir')), destination: file(f.get('--out')) }));
  }
  if (command === 'inspect-package') {
    const f = flags(tail, ['--package']);
    return print(await inspectCubePackage(file(f.get('--package'))));
  }
  if (command === 'buyer') {
    const f = flags(tail, ['--package', '--report', '--accept', '--intent-id', '--out'], ['--inputs']);
    if (!/^(?:0|[1-9][0-9]*)$/.test(f.get('--accept')) || !Number.isSafeInteger(Number(f.get('--accept')))) throw new TypeError('Use an explicit nonnegative payment option index');
    return print(await prepareCubePackageBuyer({ directory: file(f.get('--package')), reportId: f.get('--report'),
      acceptIndex: Number(f.get('--accept')), intentId: f.get('--intent-id'), destination: file(f.get('--out')),
      ...(f.has('--inputs') ? { inputs: await readJson(f.get('--inputs')) } : {}) }));
  }
  if (command === 'launch') {
    const separator = tail.indexOf('--'), f = flags(separator < 0 ? tail : tail.slice(0, separator), ['--package']);
    return launchCubePackage({ directory: file(f.get('--package')), args: separator < 0 ? [] : tail.slice(separator + 1) });
  }
  throw new TypeError(USAGE);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });

// MIT. Portable merchant exports with native offers, OpenAPI and buyer preparation.
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { compileCubeMerchantPlan } from './plan.mjs';
import { openCubeWorkspace, prepareCubeBuyer } from './workspace.mjs';
import { fail } from './metadata.mjs';
import { absolute, privateDirectory, readBytes, writeNew, newDirectory, syncDirectory,
  parse, json, sha256, fileBinding, readBoundFiles } from './files.mjs';

export const PACKAGE_SCHEMA = 'stellar-forge.cube-merchant-package.v1';
const PACKAGE_FILES = ['cube-meta.json', 'merchant-plan.json', 'cube-adapter.json', 'seller-service.json',
  'catalog.json', 'reports.json', 'openapi.json', 'launch.mjs', 'README.md', 'BUYER.md'];
const sq = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const launcher = `// MIT. Launch this package with the installed, original Stellar Forge runtime.
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const args = process.argv.slice(2), index = args.indexOf('--runtime');
if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--') || args.lastIndexOf('--runtime') !== index) {
  console.error('Usage: node launch.mjs --runtime /absolute/stellar/scf-starforge-20261009 [--port 8423] [--facilitator HTTPS_URL] [--operations-port 8424]');
  process.exitCode = 1;
} else {
  const root = resolve(args[index + 1]); args.splice(index, 2);
  try {
    const { launchCubePackage } = await import(pathToFileURL(resolve(root, 'sf102-cube-paid-query-adapter/onboarding/runtime.mjs')).href);
    await launchCubePackage({ directory: dirname(fileURLToPath(import.meta.url)), args });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
`;

function publicReports(compiled) {
  return { schema: 'stellar-forge.cube-public-reports.v1', serviceName: compiled.serviceName,
    publicOrigin: compiled.publicOrigin, reports: compiled.reports.map(report => ({
      id: report.id, method: 'GET', path: report.path, description: report.description,
      inputs: report.inputs, range: report.range, exampleUrl: report.exampleUrl,
      paymentOptions: report.paymentOptions.map((option, index) => ({ index, ...option })),
    })) };
}
function buyerGuide(compiled) {
  const rows = compiled.reports.map(report => {
    const prices = report.paymentOptions.map((option, index) => `  - Option ${index}: ${option.amount} atomic ${JSON.stringify(option.asset)} on ${option.network}; payTo ${JSON.stringify(option.payTo)}; timeout ${option.maxTimeoutSeconds}s.`).join('\n');
    return `## ${report.id}\n\n${report.description}\n\nUnsigned request:\n\n\`\`\`sh\ncurl -i -- ${sq(report.exampleUrl)}\n\`\`\`\n\n${prices}\n`;
  }).join('\n');
  return `# ${compiled.serviceName}: buyer requests\n\nThis catalog was compiled from the merchant's saved plan. A 402 advertises terms; the original buyer reviews the actual current challenge before signing. Prices are decimal atomic strings, without inferred token decimals.\n\nThe public input constraints and required examples are in reports.json. HTTP query values are strings. The native seller admits the original template before its payment lifecycle. Dates use YYYY-MM-DD; integer inputs use canonical decimal text; enum choices are exact.\n\nPrepare an original SF88 review configuration from the selected report and an explicit payment option:\n\n\`\`\`sh\nnode "$SCF_ROOT/sf102-cube-paid-query-adapter/onboarding/cli.mjs" buyer \\\n  --package "$CUBE_PACKAGE" --report ${compiled.reports[0].id} --accept 0 \\\n  --intent-id my-first-report --out /private/report-review.json\nnode "$SCF_ROOT/sf88-operator-buyer-cli/cli.mjs" \\\n  --review --config /private/report-review.json\n\`\`\`\n\nAdd --inputs /private/inputs.json to supply concrete query values as a JSON object of strings; otherwise the saved merchant example is used. The command validates those inputs with the original renderer and calls the original prepareReview function. The generated configuration retains the exact original offer and selected term fields.\n\nAttach the reviewed operation using the existing SF88 operator workspace/setup workflow, then run the original execute command. The package contains no buyer keys or spending approval. Preserve a stable intent for each intended purchase and use the original queue/ledger recovery for an attempted operation. The running native developer portal exposes /_seller/docs, /_seller/openapi.json and /_seller/client/seller-client.mjs.\n\n${rows}`;
}
function merchantGuide(compiled) {
  return `# ${compiled.serviceName}: Cube merchant package\n\nThe package contains ${compiled.reports.length} reviewed fixed reports, compiled by the original SF102/SF30 components. It uses the saved Cube metadata and merchant plan; it does not claim to have queried this deployment or verified payment settlement.\n\n## Launch\n\nUse the installed repository's stellar/scf-starforge-20261009 directory as SCF_ROOT. Native facilitator mode also requires its existing pinned x402 dependencies. Supply the complete Cube Authorization header in the environment variable ${compiled.adapter.authEnv}; its value is never stored in this package.\n\n\`\`\`sh\nnode launch.mjs --runtime "$SCF_ROOT" --port 8423\nnode launch.mjs --runtime "$SCF_ROOT" --port 8423 \\\n  --facilitator https://YOUR-CONFIGURED-FACILITATOR \\\n  --operations-port 8424 --history-dir /private/cube-usage\n\`\`\`\n\nThe first command starts the original challenge-only seller. The second passes the explicit facilitator to the original native seller launcher and starts the original operations dashboard. Both listeners bind to 127.0.0.1; place the seller behind the operator-managed HTTPS proxy for ${compiled.publicOrigin}. Do not expose the private operations listener. The launcher uses a short-lived private handler module to compose the original Cube adapter and admission hook, then removes that module once the original service starts. It contains no alternate verifier or payment engine.\n\nAfter startup, inspect /_seller/health and /_seller/ready, then open /_seller/docs. In NATIVE_X402 mode, valid unsigned requests receive the native 402 and invalid query inputs receive 400 before payment processing. Original CHALLENGE_ONLY mode advertises 402 metadata without running application admission or contacting Cube. Actual report delivery uses the configured native facilitator and original adapter.\n\n## Files and handoff\n\nShare catalog.json, reports.json, openapi.json and BUYER.md for buyer integration. The complete package, merchant-plan.json, cube-meta.json, cube-adapter.json, and seller-service.json are private merchant material. The saved OpenAPI describes the default challenge-only mode; the running native portal reflects the actual launch mode.\n\nRun the onboarding inspect-package command after moving this directory. Files must retain private directory/file permissions (0700/0600). The installed onboarding runtime verifies saved bytes and recompiles the original config bindings before launch. An updated query, schema snapshot, or price should be prepared as a new workspace and exported to a new directory. Existing destinations are preserved.\n\nBackend: ${compiled.adapter.origin}${compiled.adapter.path}. Upstream timeout ${compiled.adapter.timeoutMs}ms, at most ${compiled.adapter.maxRows} result rows and ${compiled.adapter.maxResponseBytes} response bytes, ${compiled.adapter.maxInFlight} concurrent upstream requests. These are the original adapter's application limits.\n`;
}
function derivedFiles(compiled) {
  return { 'cube-adapter.json': json(compiled.adapter), 'seller-service.json': json(compiled.seller),
    'catalog.json': json({ resources: compiled.offers }), 'reports.json': json(publicReports(compiled)),
    'openapi.json': json(compiled.openapi), 'launch.mjs': Buffer.from(launcher),
    'README.md': Buffer.from(merchantGuide(compiled)), 'BUYER.md': Buffer.from(buyerGuide(compiled)) };
}

export async function exportCubePackage({ directory, destination }) {
  const saved = await openCubeWorkspace(directory);
  const files = { ...saved.files, ...derivedFiles(saved.compiled) };
  const root = await newDirectory(destination);
  for (const [name, data] of Object.entries(files)) await writeNew(join(root, name), data);
  const manifest = { schema: PACKAGE_SCHEMA, id: randomUUID(), workspaceId: saved.manifest.id,
    createdAt: new Date().toISOString(), metadataSha256: saved.manifest.files['cube-meta.json'].sha256,
    planSha256: saved.manifest.files['merchant-plan.json'].sha256,
    files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, fileBinding(data)])) };
  await writeNew(join(root, 'package.json'), json(manifest));
  await syncDirectory(root); await syncDirectory(dirname(root));
  const receipt = { schema: 'stellar-forge.cube-package-export.v1', workspaceId: saved.manifest.id,
    packageId: manifest.id, destination: root, createdAt: manifest.createdAt,
    metadataSha256: manifest.metadataSha256, planSha256: manifest.planSha256,
    packageManifestSha256: sha256(json(manifest)), fileCount: Object.keys(files).length + 1 };
  await writeNew(join(saved.root, 'exports', sha256(root) + '.json'), json(receipt));
  await syncDirectory(join(saved.root, 'exports'));
  return { ...receipt, status: 'EXPORTED', filesRevalidated: true,
    serviceName: saved.compiled.serviceName, reportCount: saved.compiled.reports.length,
    publicOrigin: saved.compiled.publicOrigin, launch: ['node', join(root, 'launch.mjs'), '--runtime', '/absolute/stellar/scf-starforge-20261009'] };
}

export async function openCubePackage(directory) {
  const root = await privateDirectory(directory);
  const manifest = parse(await readBytes(join(root, 'package.json'), { privateFile: true, max: 65536 }), 'package.json');
  if (manifest.schema !== PACKAGE_SCHEMA || !/^[a-f0-9-]{36}$/.test(manifest.id ?? '') ||
      !/^[a-f0-9-]{36}$/.test(manifest.workspaceId ?? '') || !Number.isFinite(Date.parse(manifest.createdAt))) fail('Invalid Cube package manifest');
  const files = await readBoundFiles(root, manifest, PACKAGE_FILES);
  if (sha256(files['cube-meta.json']) !== manifest.metadataSha256 || sha256(files['merchant-plan.json']) !== manifest.planSha256)
    fail('Package source hashes do not match the merchant plan');
  const compiled = compileCubeMerchantPlan(parse(files['cube-meta.json'], 'cube-meta.json'), parse(files['merchant-plan.json'], 'merchant-plan.json'));
  const generated = derivedFiles(compiled);
  for (const name of ['cube-adapter.json', 'seller-service.json', 'catalog.json', 'reports.json', 'openapi.json'])
    if (!files[name].equals(generated[name])) fail(`Package ${name} does not match original native compilation; export a new package with this runtime`);
  return { root, manifest, files, compiled };
}
export async function inspectCubePackage(directory) {
  const saved = await openCubePackage(directory);
  return { schema: PACKAGE_SCHEMA, status: 'PREPARED', directory: saved.root, id: saved.manifest.id,
    workspaceId: saved.manifest.workspaceId, createdAt: saved.manifest.createdAt,
    metadataSha256: saved.manifest.metadataSha256, planSha256: saved.manifest.planSha256,
    serviceName: saved.compiled.serviceName, publicOrigin: saved.compiled.publicOrigin,
    reportCount: saved.compiled.reports.length, reports: publicReports(saved.compiled).reports,
    authEnv: saved.compiled.adapter.authEnv, allowLoopback: saved.compiled.allowLoopback,
    filesRevalidated: true, defaultMode: 'CHALLENGE_ONLY' };
}
export async function prepareCubePackageBuyer({ directory, reportId, acceptIndex, intentId, inputs, destination }) {
  const saved = await openCubePackage(directory);
  return prepareCubeBuyer({ compiled: saved.compiled, catalogBytes: saved.files['catalog.json'],
    reportId, acceptIndex, intentId, inputs, destination: absolute(destination) });
}

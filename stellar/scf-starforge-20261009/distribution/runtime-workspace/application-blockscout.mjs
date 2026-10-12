// MIT. Original Blockscout merchant binding for the retained Applications launcher.
import { join } from 'node:path';
import { absolute, privateDirectory, regular, plain, need, digest } from './storage.mjs';

const STARTUP = 'stellar-forge.blockscout-startup.v1';
const PACKAGE = 'stellar-forge.blockscout-package.v1';
const FILES = ['plan.json', 'openapi.json', 'selections.json', 'route-bindings.json',
  'seller-service.json', 'seller-offers.json', 'handlers.mjs', 'RUN.md'];
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });
export function blockscoutApplication(common) {
  return {
    id: 'blockscout', command: 'blockscout', title: 'Blockscout token merchant', terminal: false,
    requiredSource: 'stellar/scf-starforge-20261009/distribution/runtime-workspace/application-blockscout.mjs',
    description: 'Operate the original token merchant, provider quotas, saved attempts, reconciliation, buyer reviews, backup and native merchant controls.',
    fields: [
      field('packageDirectory', 'Verified merchant package', 'path', true),
      field('stateDirectory', 'Private merchant state', 'path', true,
        'Use this same directory across restart, credential rotation and price rollback.'),
      field('facilitator', 'Original facilitator URL', 'text', true),
      field('operationsPort', 'Merchant operations port', 'port'),
      field('deskPort', 'Provider desk port', 'port'),
      field('drainGraceMs', 'Drain grace in milliseconds', 'text', false, '1000–300000; default 60000.'),
      field('allowLocalFacilitator', 'Allow a local HTTP facilitator', 'boolean', false,
        'Permits only http://127.0.0.1 for the original local development facilitator.'),
      ...common,
    ],
  };
}
function parsed(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { need(false, 'APPLICATION_BLOCKSCOUT_PACKAGE_INVALID'); }
}
async function manifestAt(directory) {
  absolute(directory); await privateDirectory(directory);
  const bytes = await regular(join(directory, 'package.json'), 131072), value = parsed(bytes);
  need(plain(value) && value.schema === PACKAGE && /^[a-f0-9]{64}$/.test(value.planSha256 ?? '') &&
    plain(value.files) && Object.keys(value.files).length === FILES.length &&
    FILES.every(name => Object.hasOwn(value.files, name)), 'APPLICATION_BLOCKSCOUT_PACKAGE_INVALID');
  for (const record of Object.values(value.files))
    need(plain(record) && Number.isSafeInteger(record.bytes) && record.bytes >= 0 &&
      record.bytes <= 1048576 && /^[a-f0-9]{64}$/.test(record.sha256 ?? ''),
    'APPLICATION_BLOCKSCOUT_PACKAGE_INVALID');
  return { value, sha256: digest(bytes) };
}
export async function prepareBlockscoutApplication(settings, inputPath) {
  let facilitator;
  try { facilitator = new URL(settings.facilitator); }
  catch { need(false, 'APPLICATION_BLOCKSCOUT_FACILITATOR_INVALID'); }
  const local = settings.allowLocalFacilitator === true &&
    facilitator.protocol === 'http:' && facilitator.hostname === '127.0.0.1';
  need((local || facilitator.protocol === 'https:') && !facilitator.username && !facilitator.password &&
    !facilitator.search && !facilitator.hash, 'APPLICATION_BLOCKSCOUT_FACILITATOR_INVALID');
  const selectedPorts = [settings.port ?? 0, settings.operationsPort ?? 0, settings.deskPort ?? 0];
  need(selectedPorts.every(value => Number.isInteger(value) && value >= 0 && value <= 65535), 'APPLICATION_PORT_INVALID');
  const ports = selectedPorts.filter(Boolean);
  need(new Set(ports).size === ports.length, 'APPLICATION_BLOCKSCOUT_PORT_CONFLICT');
  let grace;
  if (settings.drainGraceMs !== undefined) {
    need(/^(?:0|[1-9]\d*)$/.test(settings.drainGraceMs), 'APPLICATION_BLOCKSCOUT_DRAIN_GRACE_INVALID');
    grace = Number(settings.drainGraceMs);
    need(Number.isSafeInteger(grace) && grace >= 1000 && grace <= 300000,
      'APPLICATION_BLOCKSCOUT_DRAIN_GRACE_INVALID');
  }
  const inputs = [
    await inputPath(settings.packageDirectory, 'directory', false, true),
    await inputPath(settings.stateDirectory, 'directory', true, true),
  ];
  const original = await manifestAt(settings.packageDirectory);
  const manifest = await inputPath(join(settings.packageDirectory, 'package.json'), 'file');
  need(manifest.sha256 === original.sha256, 'APPLICATION_BLOCKSCOUT_PACKAGE_CHANGED');
  inputs.push(manifest);
  for (const name of FILES) {
    const item = await inputPath(join(settings.packageDirectory, name), 'file');
    need(item.bytes === original.value.files[name].bytes && item.sha256 === original.value.files[name].sha256,
      'APPLICATION_BLOCKSCOUT_PACKAGE_CHANGED', 'Review the complete original merchant package before launch');
    inputs.push(item);
  }
  const args = ['serve', '--package', settings.packageDirectory, '--state', settings.stateDirectory,
    '--facilitator', settings.facilitator, '--operations-port', String(settings.operationsPort ?? 0),
    '--desk-port', String(settings.deskPort ?? 0),
    '--expected-plan-sha256', original.value.planSha256, '--expected-package-sha256', original.sha256];
  if (grace !== undefined) args.push('--drain-grace-ms', String(grace));
  if (settings.allowLocalFacilitator) args.push('--allow-local-facilitator');
  return { args, inputs };
}
function selectedValue(request, name) {
  need(Array.isArray(request.args) && request.args[0] === 'serve', 'APPLICATION_BLOCKSCOUT_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_BLOCKSCOUT_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
export async function blockscoutStartup(request, text) {
  if (request.command !== 'blockscout' || typeof text !== 'string' || text.length > 16384 ||
    !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'BLOCKSCOUT_MERCHANT_RUNNING') return null;
  const packageDirectory = absolute(selectedValue(request, '--package')),
    stateDirectory = absolute(selectedValue(request, '--state')),
    expectedPlan = selectedValue(request, '--expected-plan-sha256'),
    expectedPackage = selectedValue(request, '--expected-package-sha256');
  need(/^[a-f0-9]{64}$/.test(expectedPlan) && /^[a-f0-9]{64}$/.test(expectedPackage),
    'APPLICATION_BLOCKSCOUT_STARTUP_CHANGED');
  need(value.packageDirectory === packageDirectory && value.stateDirectory === stateDirectory,
    'APPLICATION_BLOCKSCOUT_STARTUP_CHANGED', 'The original startup must name the reviewed package and merchant state');
  const original = await manifestAt(packageDirectory);
  need(value.planSha256 === expectedPlan && original.value.planSha256 === expectedPlan &&
    value.packageManifestSha256 === expectedPackage && original.sha256 === expectedPackage,
    'APPLICATION_BLOCKSCOUT_STARTUP_CHANGED');
  let url;
  try { url = new URL(value.providerDesk); } catch { need(false, 'APPLICATION_BLOCKSCOUT_STARTUP_CHANGED'); }
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535 &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    /^[a-f0-9]{64}$/.test(url.hash.slice(1)), 'APPLICATION_BLOCKSCOUT_STARTUP_CHANGED');
  return { url: url.href, original: { schema: STARTUP, packageDirectory, stateDirectory,
    planSha256: value.planSha256, packageManifestSha256: original.sha256 } };
}

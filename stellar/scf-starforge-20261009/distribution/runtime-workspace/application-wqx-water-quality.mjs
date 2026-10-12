// MIT. Water-quality and Open Waters inside the original Applications manager.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { readPrivateJson } from '../../sf30-seller-sdk/routescan/quota.mjs';
import { absolute, need, plain } from './storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/';
const STARTUP = 'stellar-forge.wqx-managed-startup.v1';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const field = (name, label, type = 'path', required = false, description = '') => ({ name, label, type, required, description });

export function wqxWaterQualityApplication(common) {
  return {
    id: 'wqx-water-quality', command: 'water-quality-managed', title: 'Water quality and Open Waters',
    terminal: false, requiredSource: SOURCE + 'managed.mjs',
    description: 'Review original WQX samples, retain scientific decisions, receive complete source editions, and generate Open Waters imports in the existing water-quality workspace.',
    fields: [
      field('projectDirectory', 'Private water project', 'path', true,
        'Choose the existing private project, or a new directory beneath a private parent.'),
      field('bundleFile', 'Complete source bundle', 'path', false,
        'Optional complete native review or Open Waters JSON bundle. First launch receives it into an empty project; reopening retains the original receipt.'),
      field('reviewId', 'Saved review', 'text', false, 'Optional original review identifier for direct report and source downloads.'),
      field('planId', 'Saved Open Waters plan', 'text', false, 'Optional original receiving-plan identifier for all six exports.'),
      field('buyerConfig', 'Private buyer configuration', 'path', false,
        'Optional original buyer configuration for the existing customer and purchased-file controls.'),
      field('facilitator', 'Original facilitator', 'text', false, 'Optional existing HTTPS native facilitator URL.'),
      field('allowLocalFacilitator', 'Use a loopback development facilitator', 'boolean'),
      field('merchantPort', 'Merchant listener port', 'port'),
      ...common,
    ],
  };
}
export async function prepareWqxWaterQualityApplication(settings, { inputPath, runtimeDirectory } = {}) {
  const runtime = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const modulePath = join(runtime.sourceRoot, SOURCE, 'managed.mjs');
  const moduleInput = await inputPath(modulePath, 'file');
  const project = await inputPath(settings.projectDirectory, 'directory', true, true);
  const original = await import(pathToFileURL(modulePath).href);
  const reviewed = await original.reviewWaterQualityManaged({
    directory: project.path, bundleFile: settings.bundleFile, buyerConfig: settings.buyerConfig,
    facilitator: settings.facilitator, allowLocalFacilitator: settings.allowLocalFacilitator === true,
    reviewId: settings.reviewId, planId: settings.planId,
  });
  const inputs = [moduleInput, project], retained = new Set(inputs.map(value => value.path));
  async function retain(path, expected) {
    if (!path || retained.has(path)) return;
    const file = await inputPath(path, 'file');
    if (file.sha256 && expected) need(file.sha256 === expected, 'APPLICATION_WQX_INPUT_CHANGED');
    inputs.push(file); retained.add(path);
  }
  for (const source of reviewed.source.files) await retain(join(runtime.sourceRoot, SOURCE, source.path), source.sha256);
  for (const selected of [reviewed.selection.project?.file, reviewed.selection.bundle, reviewed.selection.buyer,
    reviewed.selection.review?.file, reviewed.selection.plan?.file])
    if (selected) await retain(selected.path, selected.sha256);
  const args = ['serve', '--project', project.path, '--merchant-port', String(settings.merchantPort ?? 0),
    '--expected-source-sha256', reviewed.source.sha256, '--expected-selection-sha256', reviewed.selectionSha256];
  for (const [name, value] of [['--bundle', reviewed.selection.bundle?.path], ['--buyer-config', reviewed.selection.buyer?.path],
    ['--facilitator', reviewed.selection.facilitator], ['--review', settings.reviewId], ['--plan', settings.planId]])
    if (value) args.push(name, value);
  if (settings.allowLocalFacilitator) args.push('--allow-local-facilitator');
  return {
    args, inputs, createDirectories: project.exists ? [] : [project.path],
    resourceKey: hash({ family: 'wqx-water-quality', directory: project.path }),
    identity: { selection: reviewed.selection, selectionSha256: reviewed.selectionSha256, source: reviewed.source },
  };
}
function option(request, name, optional = false) {
  need(Array.isArray(request.args) && request.args[0] === 'serve', 'APPLICATION_WQX_STARTUP_CHANGED');
  const indexes = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && !indexes.length) return null;
  need(indexes.length === 1 && typeof request.args[indexes[0] + 1] === 'string', 'APPLICATION_WQX_STARTUP_CHANGED');
  return request.args[indexes[0] + 1];
}
export async function wqxWaterQualityStartup(request, operationDirectory, text, context = {}) {
  if (request.command !== 'water-quality-managed' || !request.applicationId ||
    typeof text !== 'string' || text.length > 32768 || !text.startsWith('{')) return null;
  let value; try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'WQX_MANAGED_READY') return null;
  absolute(operationDirectory);
  const directory = absolute(option(request, '--project')),
    sourceSha256 = option(request, '--expected-source-sha256'),
    selectionSha256 = option(request, '--expected-selection-sha256');
  need(HASH.test(sourceSha256) && HASH.test(selectionSha256) && value.directory === directory &&
    value.sourceSha256 === sourceSha256 && value.selectionSha256 === selectionSha256,
  'APPLICATION_WQX_STARTUP_CHANGED');
  const saved = await readPrivateJson(join(directory, 'managed-water-quality-launch.json'));
  const binding = await readPrivateJson(join(directory, 'managed-water-quality-binding.json'));
  need(hash(saved) === hash(value) && binding.schema === 'stellar-forge.wqx-managed-project.v1' &&
    binding.directory === directory && binding.id === value.projectBindingId, 'APPLICATION_WQX_PROJECT_CHANGED');
  need(Number.isSafeInteger(context.pid) && context.pid > 0 && Number.isSafeInteger(value.pid) &&
    value.pid > 0 && (value.pid === context.pid || value.ppid === context.pid), 'APPLICATION_WQX_CHILD_CHANGED');
  const requestedPort = Number(option(request, '--port', true) ?? 0), url = new URL(value.url);
  need(Number.isSafeInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535 &&
    url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/' &&
    !url.username && !url.password && !url.search && !url.hash &&
    Number(url.port || 80) > 0 && Number(url.port || 80) <= 65535 && (!requestedPort || Number(url.port || 80) === requestedPort),
  'APPLICATION_WQX_LISTENER_CHANGED');
  for (const [name, selected] of [['--review', value.reviewId], ['--plan', value.planId]]) {
    const requested = option(request, name, true);
    need(!requested || requested === selected, 'APPLICATION_WQX_DECISION_CHANGED');
    need(selected === null || ID.test(selected), 'APPLICATION_WQX_DECISION_CHANGED');
  }
  need(value.facilitator === option(request, '--facilitator', true) &&
    value.allowLocalFacilitator === request.args.includes('--allow-local-facilitator'),
  'APPLICATION_WQX_FACILITATOR_CHANGED');
  const origin = url.origin;
  need(Array.isArray(value.links) && value.links.length <= 11, 'APPLICATION_WQX_LINKS_CHANGED');
  for (const item of value.links) {
    const link = new URL(item.url);
    const allowed = value.reviewId && new RegExp('^/api/reviews/' + value.reviewId + '/(html|json|csv|geojson|bundle)$').test(link.pathname) ||
      value.planId && new RegExp('^/api/open-waters/' + value.planId + '/(locations|results|crosswalk|report|references|bundle)$').test(link.pathname);
    need(link.origin === origin && !link.username && !link.password && !link.search && !link.hash &&
      allowed && typeof item.label === 'string', 'APPLICATION_WQX_LINKS_CHANGED');
  }
  return {
    url: url.href, links: value.links,
    original: { schema: STARTUP, launchId: value.launchId, directory, projectBindingId: binding.id,
      sourceSha256, selectionSha256, projectRevision: value.projectRevision,
      projectSelectionSha256: value.projectSelectionSha256, reviewId: value.reviewId, reviewSha256: value.reviewSha256,
      planId: value.planId, planSha256: value.planSha256, received: value.received,
      buyerConfigured: value.buyerConfigured, facilitator: value.facilitator,
      allowLocalFacilitator: value.allowLocalFacilitator, pid: value.pid },
  };
}

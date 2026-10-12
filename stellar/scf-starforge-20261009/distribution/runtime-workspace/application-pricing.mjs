// MIT. Original merchant pricing and scenario planning in managed Applications.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute, need, plain } from './storage.mjs';

const CLI = 'stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/workspace/cli.mjs';
const STARTUP = 'stellar-forge.merchant-pricing-workspace-launch.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function pricingApplication(common) {
  return {
    id: 'merchant-pricing', command: 'revenue-workspace', requiredSource: CLI,
    title: 'Merchant pricing and scenario planning', terminal: false,
    description: 'Review original merchant usage, compare demand, price and cost scenarios, save commercial terms and prepare seller price changes.',
    fields: [
      field('workspaceDirectory', 'Private pricing workspace', 'path', true,
        'Reopen the same saved reviews and plans, or create one directory in an existing private parent.'),
      field('configFile', 'Original seller configuration', 'path', true,
        'Select the SF30 seller JSON whose ordered payment choices this merchant uses.'),
      field('opsUrl', 'Original operations URL', 'text', false,
        'Use the existing loopback operations listener, or select saved traffic files below.'),
      field('snapshotFile', 'Original session traffic export'),
      field('historyFile', 'Original retained usage export'),
      field('nativeOutbox', 'Existing native settlement outbox'),
      field('supplierUsageFile', 'Original supplier usage export'),
      field('accountingReportFile', 'Original accounting report'),
      field('sourcePackage', 'Original API merchant package'),
      field('releaseStore', 'Existing seller release store', 'path', false,
        'Optional; select its original API merchant package above.'),
      field('releaseRuntime', 'Original release runtime JSON', 'path', false,
        'Optional host settings for the selected release store.'),
      ...common,
    ],
  };
}

export function validatePricingSelection(settings) {
  const files = Boolean(settings.snapshotFile || settings.historyFile);
  need(Boolean(settings.opsUrl) !== files, 'APPLICATION_PRICING_SOURCE_REQUIRED',
    'Choose the original operations URL, or one or both original traffic export files.');
  need(!settings.releaseStore || Boolean(settings.sourcePackage),
    'APPLICATION_PRICING_PACKAGE_REQUIRED', 'Select the original API merchant package with its release store.');
  need(!settings.releaseRuntime || Boolean(settings.releaseStore),
    'APPLICATION_PRICING_RELEASE_REQUIRED', 'Select the original release store with its runtime settings.');
}

export async function preparePricingApplication(settings, { inputPath, runtimeDirectory }) {
  validatePricingSelection(settings);
  const { inspectMerchantRuntime } = await import('../../sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const cli = join(selected.sourceRoot, CLI);
  const original = await import(pathToFileURL(cli).href);
  need(original.PRICING_WORKSPACE_LAUNCH_SCHEMA === STARTUP,
    'APPLICATION_PRICING_LAUNCH_UNAVAILABLE',
    'Choose an installed runtime containing the original merchant pricing launch contract.');
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', true, true);
  const config = await inputPath(settings.configFile, 'file');
  need(/^[a-f0-9]{64}$/.test(config.sha256 ?? '') && config.bytes <= 2 * 1024 * 1024,
    'APPLICATION_PRICING_CONFIG_REQUIRED', 'Select the original seller JSON of at most 2 MiB.');
  const inputs = [workspace, config, await inputPath(cli, 'file')];
  const args = ['--config', config.path, '--state', workspace.path,
    '--expected-config-sha256', config.sha256];
  const paths = [
    ['snapshotFile', '--snapshot', 'file', true, false],
    ['historyFile', '--history', 'file', true, false],
    ['nativeOutbox', '--native-outbox', 'directory', false, true],
    ['supplierUsageFile', '--supplier-usage', 'file', true, false],
    ['accountingReportFile', '--accounting-report', 'file', true, false],
    ['sourcePackage', '--source-package', 'directory', false, false],
    ['releaseStore', '--release-store', 'directory', false, true],
    ['releaseRuntime', '--release-runtime', 'file', false, false],
  ];
  for (const [name, flag, kind, missing, privateOnly] of paths) {
    if (!settings[name]) continue;
    const value = await inputPath(settings[name], kind, missing, privateOnly);
    inputs.push(value); args.push(flag, value.path);
  }
  if (settings.opsUrl) args.push('--ops-url', settings.opsUrl);
  // Traffic and outbox contents belong to the original live/source readers.
  // Opening retained reviews remains possible while that source is unavailable.
  return { args, inputs, createDirectories: workspace.exists ? [] : [workspace.path] };
}

function selectedValue(request, flag) {
  const positions = request.args.flatMap((value, index) => value === flag ? [index] : []);
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_PRICING_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}

export function pricingStartup(request, text) {
  if (request.command !== 'revenue-workspace' || !Array.isArray(request.args) ||
      typeof text !== 'string' || text.length > 16384 || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'MERCHANT_PRICING_WORKSPACE_READY') return null;
  const state = absolute(selectedValue(request, '--state'));
  const configPath = absolute(selectedValue(request, '--config'));
  const configSha256 = selectedValue(request, '--expected-config-sha256');
  const port = selectedValue(request, '--port');
  need(/^[a-f0-9]{64}$/.test(configSha256) && /^(0|[1-9]\d*)$/.test(port) &&
    Number(port) <= 65535 && value.state === state && value.configPath === configPath &&
    value.configSha256 === configSha256 && Number.isSafeInteger(value.pid) && value.pid > 0,
  'APPLICATION_PRICING_STARTUP_CHANGED', 'The original pricing process must open the reviewed seller and workspace.');
  let url, planning;
  try { url = new URL(value.url); planning = new URL(value.planningUrl); }
  catch { need(false, 'APPLICATION_PRICING_STARTUP_CHANGED'); }
  const actualPort = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    actualPort >= 1 && actualPort <= 65535 && (port === '0' || actualPort === Number(port)) &&
    !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
    planning.origin === url.origin && planning.pathname === '/planning' &&
    !planning.username && !planning.password && !planning.search && !planning.hash,
  'APPLICATION_PRICING_STARTUP_CHANGED');
  const links = [{ label: 'Scenario planning', url: planning.href }];
  if (value.costsUrl !== undefined) {
    let costs;
    try { costs = new URL(value.costsUrl); } catch { need(false, 'APPLICATION_PRICING_STARTUP_CHANGED'); }
    need(costs.origin === url.origin && costs.pathname === '/economics' &&
      !costs.username && !costs.password && !costs.search && !costs.hash,
      'APPLICATION_PRICING_STARTUP_CHANGED');
    links.push({ label: 'Supplier costs', url: costs.href });
  }
  return {
    url: url.href,
    links,
    original: { schema: STARTUP, state, configPath, configSha256, pid: value.pid },
  };
}

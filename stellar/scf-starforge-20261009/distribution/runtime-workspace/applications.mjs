// MIT. Application lifecycle over the original READY runtime and managed-command worker.
import { readDistributionSpecification } from '../specification.mjs';
import { wqxWaterQualityApplication, prepareWqxWaterQualityApplication } from './application-wqx-water-quality.mjs';
import { grpcApplication, prepareGrpcApplication } from './application-grpc.mjs';
import { coingeckoApplication, prepareCoingeckoApplication } from './application-coingecko.mjs';
import { oaiApplication, prepareOaiApplication } from './application-oai.mjs';
import { fiscalDataApplication, prepareFiscalDataApplication } from './application-fiscaldata.mjs';
import { databentoApplication, prepareDatabentoApplication } from './application-databento.mjs';
import { opencageApplication, prepareOpenCageApplication } from './application-opencage.mjs';
import { webdavApplication, prepareWebDavApplication } from './application-webdav.mjs';
import { merchantSupportApplication, prepareMerchantSupportApplication } from './application-merchant-support.mjs';
import { readdir, lstat, realpath, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { blockscoutApplication, prepareBlockscoutApplication } from './application-blockscout.mjs';
import { mppApplication, prepareMppApplication } from './application-mpp.mjs';
import { ndjsonApplication, prepareNdjsonApplication } from './application-ndjson.mjs';
import { cheesecakeApplication, prepareCheesecakeApplication } from './application-cheesecake.mjs';
import { odataApplication, prepareODataApplication } from '../../sf30-seller-sdk/odata/live/applications.mjs';
import { secEdgarApplication, prepareSecEdgarApplication } from './application-sec-edgar.mjs';
import { jobResultReceiverApplication, prepareJobResultReceiverApplication } from './application-job-result-receiver.mjs';
import { sheetsApplication, prepareSheetsApplication } from './application-sheets.mjs';
import { nocodbApplication, prepareNocoDBApplication } from './application-nocodb.mjs';
import { cocartApplication, prepareCocartApplication } from './application-cocart.mjs';
import { stellarExpertApplication, prepareStellarExpertApplication } from './application-stellar-expert.mjs';
import { atlasApplication, prepareAtlasApplication } from './application-atlas.mjs';
import { n8nApplication, prepareN8nApplication } from './application-n8n.mjs';
import { redisApplication, prepareRedisApplication } from './application-redis.mjs';
import { cryptoworthApplication, prepareCryptoworthApplication } from './application-cryptoworth.mjs';
import { openApiApplication, prepareOpenApiApplication } from './application-openapi.mjs';
import { arcgisAgentApplication, prepareArcgisAgentApplication } from './application-arcgis.mjs';
import { duckdbAgentApplication, prepareDuckDBAgentApplication } from './application-duckdb-agent.mjs';
import { s3MerchantApplication, prepareS3MerchantApplication } from './application-s3-merchant.mjs';
import { jobCheckoutApplication, validateJobCheckoutSelection, prepareJobCheckoutApplication } from './application-job-checkout.mjs';
import { datasetBuyerApplication, prepareDatasetBuyerApplication } from './application-dataset-buyer.mjs';
import { pricingApplication, validatePricingSelection, preparePricingApplication } from './application-pricing.mjs';
import { collectionsApplication, prepareCollectionsApplication } from './application-collections.mjs';
import { baserowApplication, prepareBaserowApplication } from './application-baserow.mjs';
import { grantApplication, prepareGrantApplication } from './application-grant.mjs';
import { buyerRunbookApplication, prepareBuyerRunbookApplication } from './application-buyer-runbook.mjs';
import { grantsgovApplication, prepareGrantsgovApplication } from './application-grantsgov.mjs';
import { fredApplication, prepareFredApplication } from './application-fred.mjs';
import { worldbankAgentApplication, prepareWorldBankAgentApplication } from './application-worldbank.mjs';
import { apiPassWorkspaceApplication, prepareApiPassWorkspaceApplication } from '../../sf101-merchant-receiver/api-access/workspace/application.mjs';
import { eventFeedApplications, prepareEventFeedApplication } from './application-event-feed.mjs';
import { tenderlyApplication, prepareTenderlyApplication } from './application-tenderly.mjs';
import { browserWalletApplication, prepareBrowserWalletApplication } from './application-browser-wallet.mjs';
import { rssAtomApplication, prepareRssAtomApplication } from './application-rss-atom.mjs';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { managedState, managedHome, openManagedHome, reviewManagedAdoption } from './managed-workspace.mjs';
import { applicationRunPage, applicationHistoryLimit } from './application-history.mjs';
import { applicationEnvironment, readApplicationTerminal, sendApplicationTerminal } from './application-command.mjs';
import { PYTHON_APPLICATION_CATALOG, pythonApplicationCommand, pythonApplicationResource } from '../python-runtime/application-lifecycle.mjs';
import { absolute, privateDirectory, makePrivate, regular, readJSON, saveJSON, recordId, operationId,
  operationLease, operationRunning, tailFile, plain, need, digest, json, canonical, now } from './storage.mjs';

const SCHEMA = 'stellar-forge.runtime-application.v1';
const TYPES = ['applications', 'application-reviews', 'application-homes', 'application-resource-locks'];
const bindingKeys = ['directory', 'installationId', 'profileId', 'profileSha256', 'lockSha256', 'sourceCommit', 'sourceManifestSha256'];
const binding = value => Object.fromEntries(bindingKeys.map(key => [key, value[key]]));
const hash = value => digest(json(canonical(value)));
const errorView = error => ({ code: error.code ?? 'APPLICATION_ERROR', message: String(error.message ?? error).slice(0, 2000) });
const directoryFor = (root, id) => join(root, 'applications', recordId(id));
const reviewPath = (root, id) => join(root, 'application-reviews', recordId(id) + '.json');
const operationPath = (root, id) => join(root, 'operations', operationId(id));
const uuidFrom = value => {
  const id = digest(value);
  return id.slice(0, 8) + '-' + id.slice(8, 12) + '-4' + id.slice(13, 16) + '-a' + id.slice(17, 20) + '-' + id.slice(20, 32);
};
const field = (name, label, type = 'path', required = false, description = '') => ({ name, label, type, required, description });
const common = [
  field('port', 'Local port', 'port', false, 'Use 0 to let the original application choose an available port.'),
  field('environmentFile', 'Private environment JSON', 'path', false, 'Optional private file containing environment names and string values. Values stay on this host.'),
];
export const APPLICATION_CATALOG = Object.freeze([
  wqxWaterQualityApplication(common),
  coingeckoApplication(common),
  oaiApplication(common),
  fiscalDataApplication(common),
  databentoApplication(common),
  opencageApplication(common),
  webdavApplication(common),
  merchantSupportApplication(common),
  grpcApplication(common),
  atlasApplication(common),
  n8nApplication(common),
  ...PYTHON_APPLICATION_CATALOG,
  ...eventFeedApplications(common),
  apiPassWorkspaceApplication(common),
  blockscoutApplication(common),
  mppApplication(common),
  ndjsonApplication(common),
  cheesecakeApplication(common),
  odataApplication(common),
  secEdgarApplication(common),
  jobResultReceiverApplication(common),
  sheetsApplication(common),
  nocodbApplication(common),
  cocartApplication(common),
  stellarExpertApplication(common),
  redisApplication(common),
  cryptoworthApplication(common),
  arcgisAgentApplication(common),
  duckdbAgentApplication(common),
  s3MerchantApplication(common),
  jobCheckoutApplication(common),
  datasetBuyerApplication(common),
  pricingApplication(common),
  collectionsApplication(common),
  baserowApplication(common),
  grantApplication(common),
  buyerRunbookApplication(common),
  grantsgovApplication(common),
  fredApplication(common),
  worldbankAgentApplication(common),
  tenderlyApplication(common),
  browserWalletApplication(common),
  rssAtomApplication(common),
  { id: 'xml', command: 'dataset', requiredSource: 'stellar/scf-starforge-20261009/sf30-seller-sdk/xml/cli.mjs',
    title: 'XML dataset onboarding', terminal: false,
    description: 'Reopen an initialized XML workspace with its original sources, mappings, native datasets, comparison and portable editions.',
    fields: [field('workspaceDirectory', 'Initialized XML workspace', 'path', true), ...common] },
  openApiApplication(common),
  { id: 'dataset', command: 'dataset-workspace', title: 'Dataset preview', terminal: false,
    description: 'Open an original dataset file or retained dataset state with its native query and preview controls.',
    fields: [field('datasetFile', 'Dataset file'), field('stateDirectory', 'Retained dataset state'), field('catalogDirectory', 'Catalog directory'),
      field('resource', 'Resource URL', 'text'), ...common] },
  { id: 'postgres-publisher', command: 'postgres-publisher', title: 'PostgreSQL dataset publisher', terminal: false,
    description: 'Use the original plans, extraction, review, publication, schedules and buyer handoff.',
    fields: [field('workspaceDirectory', 'Publisher workspace', 'path', true), field('create', 'Initialize a new publisher', 'boolean'),
      field('sourceFile', 'Original source configuration'), field('stateDirectory', 'Target dataset state'),
      field('seller', 'Seller origin', 'text'), field('resource', 'Resource URL', 'text'), ...common] },
  { id: 'sheets-publisher', command: 'sheets-publisher', title: 'Google Sheets dataset publisher', terminal: false,
    description: 'Open the original Sheets source, authorization, range plans, extraction, review and recurring publication.',
    fields: [field('workspaceDirectory', 'Publisher workspace', 'path', true), field('create', 'Initialize a new publisher', 'boolean'),
      field('sourceFile', 'Original Sheets source configuration'), field('stateDirectory', 'Target dataset state'),
      field('seller', 'Seller origin', 'text'), field('resource', 'Resource URL', 'text'), ...common] },
  { id: 'postgres', command: 'postgres-workspace', title: 'PostgreSQL merchant authoring', terminal: false,
    description: 'Inspect the original database source, review its paid query contract and prepare the original merchant release.',
    fields: [field('sourceFile', 'Original PostgreSQL source', 'path', true), field('outputDirectory', 'Private merchant output directory', 'path', true),
      field('releaseStore', 'Existing release store'), ...common] },
  { id: 'object-buyer', command: 'buyer-object-workspace', requiredSource: 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-workspace/server.mjs',
    title: 'Object buyer workspace', terminal: true,
    description: 'Reopen original object sessions, received products, verified downloads and analysis. Every new acquisition retains its original explicit terminal approval.',
    fields: [field('stateDirectory', 'Original private object buyer state', 'path', true), field('profileFile', 'Original product profile'),
      field('operatorSettings', 'Original operator settings file'), field('analysisPython', 'Analysis Python executable'),
      field('terminalPython', 'Terminal Python executable', 'path', false, 'Defaults to /usr/bin/python3; the original managed worker supplies the terminal.'), ...common] },
  { id: 'goldrush', command: 'goldrush',
    requiredSource: 'stellar/scf-starforge-20261009/sf30-seller-sdk/examples/goldrush-stellar-pilot/workbench.mjs',
    title: 'GoldRush wallet research', terminal: true,
    description: 'Reopen the original wallet, saved requests, source comparisons and notes. Execution uses its original buyer and connected terminal.',
    fields: [field('stateDirectory', 'Initialized GoldRush workspace', 'path', true),
      field('referenceFile', 'Original observation manifest'),
      field('terminalPython', 'Terminal Python executable', 'path', false,
        'Defaults to /usr/bin/python3; uses the existing managed PTY.'), ...common] },
  { id: 'research-dossiers', command: 'research-workspace', requiredSource: 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/server.mjs',
    title: 'Research dossiers', terminal: false,
    description: 'Reopen research questions, original source editions, selections, findings, revision comparison and portable reports.',
    fields: [field('workspaceDirectory', 'Private research dossiers directory', 'path', true,
      'An existing directory or one new directory in an existing private parent.'),
      field('openalexWorkspaceDirectory', 'Existing OpenAlex research workspace', 'path', false,
        'Optional saved collection with its original queries, editions, pages and review decisions.'),
      field('openalexModule', 'Original OpenAlex workspace module', 'path', false,
        'Optional explicit workspace.mjs from the original provider source; otherwise use this selected runtime.'),
      field('editionAdapter', 'Original provider edition adapter', 'path', false,
        'Optional local adapter module for retained provider references such as Valyu.'),
      field('crossrefState', 'Private Crossref source directory', 'path', false,
        'Optional retained source directory. Enables DOI metadata using public Crossref.'),
      field('crossrefConfig', 'Original Crossref merchant configuration', 'path', false,
        'Optional existing configuration; requires the Crossref source directory.'), ...common] },
  { id: 'buyer-expenses', command: 'buyer-expenses',
    requiredSource: 'stellar/scf-starforge-20261009/sf36-spend-governor/expense-workspace/server.py',
    title: 'Buyer expenses', terminal: false,
    description: 'Reopen statement captures, cost centers, allocations, period reviews and accountant editions.',
    fields: [field('stateDirectory', 'Private buyer expense workspace', 'path', true,
      'Reopen the original or received workspace, or create one directory in an existing private parent.'), ...common] },
  { id: 'merchant-recovery', command: 'merchant-recovery-remote',
    requiredSource: 'stellar/scf-starforge-20261009/sf101-merchant-recovery/workspace/cli.mjs',
    title: 'Merchant recovery', terminal: false,
    description: 'Capture and verify local snapshots, prepare original restored publishers, and use a configured S3 store for off-host transfer and cold restore.',
    fields: [field('hostConfig', 'Original private recovery host configuration', 'path', true),
      field('workspaceDirectory', 'Private recovery workspace directory', 'path', true,
        'An existing directory or one new directory in an existing private parent. Original transfer journals remain at the host-selected paths.'), ...common] },
  { id: 'commerce', command: 'commerce-console', title: 'Commerce session', terminal: true,
    description: 'Reopen an initialized original commerce session. Its buyer approval remains in the connected original terminal.',
    fields: [field('directory', 'Initialized commerce session', 'path', true), field('finalityNode', 'Finality Node executable'),
      field('recoveryConfig', 'Private recovery configuration'), field('terminalPython', 'Terminal Python executable', 'path', false,
        'Defaults to /usr/bin/python3; the same managed worker uses the Python standard library PTY.'), ...common] },
]);

export async function initializeApplications(root) {
  for (const name of TYPES) {
    try { await makePrivate(join(root, name)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(join(root, name)); }
  }
}
function applicationType(kind) {
  const found = APPLICATION_CATALOG.find(item => item.id === kind);
  need(found, 'APPLICATION_KIND_INVALID', 'Choose an original application from this installation');
  return found;
}
async function inputPath(value, type = 'directory', missing = false, privateOnly = false) {
  const path = absolute(value);
  need(await realpath(dirname(path)) === dirname(path), 'APPLICATION_REAL_PARENT_REQUIRED');
  let info;
  try { info = await lstat(path); }
  catch (error) {
    if (error.code !== 'ENOENT' || !missing) throw error;
    if (privateOnly) await privateDirectory(dirname(path));
    return { path, kind: type, exists: false, parent: await realpath(dirname(path)) };
  }
  need(!info.isSymbolicLink() && await realpath(path) === path &&
    (type === 'file' ? info.isFile() : info.isDirectory()), 'APPLICATION_INPUT_PATH_INVALID');
  if (privateOnly && type === 'directory') await privateDirectory(path);
  const valueInfo = { path, kind: type, exists: true, dev: info.dev, ino: info.ino };
  if (type === 'file') {
    Object.assign(valueInfo, { bytes: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
    if (info.size <= 4 * 1024 * 1024) valueInfo.sha256 = digest(await regular(path, 4 * 1024 * 1024));
  }
  return valueInfo;
}
async function selectedExecutable(value) {
  const executable = absolute(value);
  need(await realpath(dirname(executable)) === dirname(executable), 'APPLICATION_REAL_PARENT_REQUIRED');
  const info = await lstat(executable);
  need(info.isFile() || info.isSymbolicLink(), 'APPLICATION_EXECUTABLE_REQUIRED');
  const target = await realpath(executable), inputs = [await inputPath(target, 'file')];
  if (info.isSymbolicLink()) inputs.push({ path: executable, kind: 'executable-link', exists: true,
    target, dev: info.dev, ino: info.ino, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
  const configuration = join(dirname(dirname(executable)), 'pyvenv.cfg');
  try { inputs.push(await inputPath(configuration, 'file')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await access(executable, constants.X_OK);
  return { executable, inputs };
}
function normalizeSettings(type, input) {
  need(plain(input) && Object.keys(input).every(name => type.fields.some(field => field.name === name)), 'APPLICATION_SETTINGS_INVALID');
  const settings = {};
  for (const item of type.fields) {
    let value = input[item.name];
    if (item.type === 'boolean') { need(value === undefined || typeof value === 'boolean', 'APPLICATION_BOOLEAN_REQUIRED'); if (value) settings[item.name] = true; continue; }
    if (item.type === 'port') {
      value = value === undefined || value === '' ? 0 : typeof value === 'number' ? value : Number(value);
      need(Number.isInteger(value) && value >= 0 && value <= 65535, 'APPLICATION_PORT_INVALID');
      settings[item.name] = value; continue;
    }
    if (value === undefined || value === '') { need(!item.required, 'APPLICATION_SETTING_REQUIRED', item.label + ' is required'); continue; }
    need(typeof value === 'string' && value.length <= 4096 && value.trim() === value && !value.includes('\0'), 'APPLICATION_SETTING_INVALID');
    if (item.type === 'path') absolute(value);
    settings[item.name] = value;
  }
  if (type.id === 'dataset') need(Boolean(settings.datasetFile) !== Boolean(settings.stateDirectory),
    'APPLICATION_DATASET_SELECTION_REQUIRED', 'Choose exactly one original dataset file or retained state');
  if (type.id === 'job-checkout') validateJobCheckoutSelection(settings);
  if (type.id === 'merchant-pricing') validatePricingSelection(settings);
  if (type.id.endsWith('-publisher')) {
    need(!settings.create || settings.sourceFile && settings.stateDirectory, 'APPLICATION_PUBLISHER_SOURCE_REQUIRED');
    need(Boolean(settings.seller) === Boolean(settings.resource), 'APPLICATION_BUYER_ENDPOINT_PAIR_REQUIRED');
  }
  if (type.id === 'research-dossiers') {
    need(!settings.openalexModule || settings.openalexWorkspaceDirectory,
      'APPLICATION_OPENALEX_WORKSPACE_REQUIRED', 'Choose the original saved OpenAlex workspace with its module');
    need(!settings.crossrefConfig || settings.crossrefState,
      'APPLICATION_CROSSREF_STATE_REQUIRED', 'Choose the original Crossref source directory with its configuration');
  }
  return settings;
}
async function applicationCommand(type, settings, runtimeDirectory, context = {}) {
  if (type.python) return pythonApplicationCommand(context.root, type, settings, {
    ...context, runtimeDirectory, inputPath, selectedExecutable, applicationEnvironment,
  });
  const inputs = [], createDirectories = [], args = [];
  let terminalPython, eventFeed, apiPassWorkspace, mppBinding, selectedResourceKey, jobResultReceiver, stellarApplication, openapi, buyerRunbook;
  const path = async (name, kind = 'directory', missing = false, privateOnly = false) => {
    if (!settings[name]) return;
    const value = await inputPath(settings[name], kind, missing, privateOnly); inputs.push(value); return value;
  };
  const option = (name, value) => { if (value !== undefined && value !== '') args.push(name, String(value)); };
  if (type.id === 'wqx-water-quality') {
    const original = await prepareWqxWaterQualityApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories); selectedResourceKey = original.resourceKey;
  } else if (type.id === 'webdav') {
    const original = await prepareWebDavApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories);
  } else if (type.id === 'merchant-support') {
    const original = await prepareMerchantSupportApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories);
  } else if (type.id === 'opencage-workspace') {
    const original = await prepareOpenCageApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories);
  } else if (type.id === 'coingecko') {
    const original = await prepareCoingeckoApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories);
  } else if (type.id === 'grpc-workspace') {
    const original = await prepareGrpcApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories);
  } else if (type.id === 'databento-migration') {
    const original = await prepareDatabentoApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories); selectedResourceKey = original.resourceKey;
  } else if (type.id === 'fiscaldata') {
    const original = await prepareFiscalDataApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories); selectedResourceKey = original.resourceKey;
  } else if (type.id === 'worldbank-agent') {
    const original = await prepareWorldBankAgentApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
  } else if (type.id === 'fred') {
    const original = await prepareFredApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
  } else if (type.id === 'mpp') {
    const original = await prepareMppApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs); mppBinding = original.binding;
  } else if (type.id === 'stellar-application') {
    const original = await prepareCheesecakeApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs); selectedResourceKey = original.resourceKey;
    stellarApplication = original.identity;
  } else if (type.id === 'odata') {
    const original = await prepareODataApplication(settings, { ...context, inputPath, selectedExecutable, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
  } else if (type.id === 'sec-edgar') {
    const original = await prepareSecEdgarApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
  } else if (type.id === 'job-result-receiver') {
    const original = await prepareJobResultReceiverApplication(settings, {
      inputPath, runtimeDirectory, applicationEnvironment,
    });
    args.push(...original.args); inputs.push(...original.inputs); jobResultReceiver = original.identity;
  } else if (type.id === 'cocart-workspace') {
    const original = await prepareCocartApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
    selectedResourceKey = original.resourceKey;
  } else if (type.id === 'nocodb-authoring') {
    const original = await prepareNocoDBApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
  } else if (type.id === 'stellar-expert') {
    const original = await prepareStellarExpertApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
  } else if (type.id === 'sheets-authoring') {
    const original = await prepareSheetsApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
  } else if (type.id === 'api-pass-customer') {
    const original = await prepareApiPassWorkspaceApplication(settings, { runtimeDirectory, inputPath, selectedExecutable });
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
    apiPassWorkspace = original.identity;
  } else if (['mercury-feed', 'buyer-event-feed'].includes(type.id)) {
    const selected = await prepareEventFeedApplication(type.id, settings, {
      ...context, runtime: { directory: runtimeDirectory }, inputPath, selectedExecutable,
    });
    args.push(...selected.args); inputs.push(...selected.inputs); eventFeed = selected.identity;
  } else if (type.id === 'blockscout') {
    const original = await prepareBlockscoutApplication(settings, inputPath);
    args.push(...original.args); inputs.push(...original.inputs);
  } else if (type.id === 'cryptoworth') {
    const original = await prepareCryptoworthApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs); selectedResourceKey = original.resourceKey;
  } else if (type.id === 'redis') {
    const original = await prepareRedisApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs);
  } else if (type.id === 's3-merchant') {
    const original = await prepareS3MerchantApplication(settings, { ...context, inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories);
  } else if (type.id === 'arcgis-agent') {
    const original = await prepareArcgisAgentApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs);
  } else if (type.id === 'duckdb-agent') {
    const original = await prepareDuckDBAgentApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs);
  } else if (type.id === 'job-checkout') {
    const original = await prepareJobCheckoutApplication(settings, runtimeDirectory, inputPath);
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
  } else if (type.id === 'baserow-authoring') {
    const prepared = await prepareBaserowApplication(settings, { inputPath, runtimeDirectory });
    args.push(...prepared.args); inputs.push(...prepared.inputs);
    createDirectories.push(...prepared.createDirectories);
  } else if (type.id === 'buyer-collections') {
    const prepared = await prepareCollectionsApplication(settings, { inputPath, runtimeDirectory });
    args.push(...prepared.args); inputs.push(...prepared.inputs);
    createDirectories.push(...prepared.createDirectories);
  } else if (type.id === 'grantsgov') {
    const prepared = await prepareGrantsgovApplication(settings, { inputPath, runtimeDirectory });
    args.push(...prepared.args); inputs.push(...prepared.inputs);
    createDirectories.push(...prepared.createDirectories);
  } else if (type.id === 'buyer-runbook') {
    const prepared = await prepareBuyerRunbookApplication(settings, { inputPath, runtimeDirectory });
    args.push(...prepared.args); inputs.push(...prepared.inputs);
    createDirectories.push(...prepared.createDirectories); buyerRunbook = prepared.identity;
  } else if (type.id === 'grant-workspace') {
    const prepared = await prepareGrantApplication(settings, { inputPath, selectedExecutable, runtimeDirectory });
    args.push(...prepared.args); inputs.push(...prepared.inputs);
    createDirectories.push(...prepared.createDirectories);
  } else if (type.id === 'dataset-buyer') {
    const prepared = await prepareDatasetBuyerApplication(settings, { inputPath, selectedExecutable, runtimeDirectory });
    args.push(...prepared.args); inputs.push(...prepared.inputs); createDirectories.push(...prepared.createDirectories);
  } else if (type.id === 'merchant-pricing') {
    const prepared = await preparePricingApplication(settings, { ...context, inputPath, runtimeDirectory });
    args.push(...prepared.args); inputs.push(...prepared.inputs); createDirectories.push(...prepared.createDirectories);
  } else if (type.id === 'browser-wallet') {
    const original = await prepareBrowserWalletApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs);
  } else if (type.id === 'tenderly') {
    const original = await prepareTenderlyApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs);
  } else if (type.id === 'catalog-atlas') {
    const original = await prepareAtlasApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
  } else if (type.id === 'n8n-merchant') {
    const original = await prepareN8nApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs);
  } else if (type.id === 'oai-repository') {
    const original = await prepareOaiApplication(settings, {
      inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,
    });
    args.push(...original.args); inputs.push(...original.inputs);
  } else if (type.id === 'rss-atom') {
    const original = await prepareRssAtomApplication(settings, {
      inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,
    });
    args.push(...original.args); inputs.push(...original.inputs);
  } else if (type.id === 'ndjson') {
    const prepared = await prepareNdjsonApplication(settings, {
      inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,
    });
    args.push(...prepared.args); inputs.push(...prepared.inputs);
  } else if (type.id === 'xml') {
    await path('workspaceDirectory', 'directory', false, true);
    args.push('xml', '--workspace', settings.workspaceDirectory, 'serve');
  } else if (type.id === 'openapi') {
    const prepared = await prepareOpenApiApplication(settings, {
      ...context, inputPath, applicationEnvironment, runtimeDirectory,
    });
    args.push(...prepared.args); inputs.push(...prepared.inputs);
    createDirectories.push(...prepared.createDirectories); openapi = prepared.openapi;
  } else if (type.id === 'dataset') {
    await path('datasetFile', 'file'); await path('stateDirectory', 'directory', false, true);
    await path('catalogDirectory', 'directory', false, true);
    option('--dataset', settings.datasetFile); option('--state', settings.stateDirectory);
    option('--catalog', settings.catalogDirectory); option('--resource', settings.resource);
  } else if (type.id.endsWith('-publisher')) {
    const workspace = await path('workspaceDirectory', 'directory', Boolean(settings.create), true);
    args.push('serve'); option('--workspace', settings.workspaceDirectory);
    if (settings.create && !workspace.exists) {
      args.push('--create'); await path('sourceFile', 'file'); await path('stateDirectory', 'directory', true, true);
      option('--source', settings.sourceFile); option('--state', settings.stateDirectory);
    } else {
      const original = await readJSON(join(settings.workspaceDirectory, 'workspace.json'));
      need(typeof original.sourceFile === 'string' && typeof original.targetDirectory === 'string' &&
        (!settings.sourceFile || settings.sourceFile === original.sourceFile) &&
        (!settings.stateDirectory || settings.stateDirectory === original.targetDirectory),
      'APPLICATION_PUBLISHER_BINDING_CHANGED', 'Open this publisher with its original source and target state');
      inputs.push(await inputPath(original.sourceFile, 'file'));
      inputs.push(await inputPath(join(settings.workspaceDirectory, 'workspace.json'), 'file'));
    }
    option('--seller', settings.seller); option('--resource', settings.resource);
  } else if (type.id === 'postgres') {
    await path('sourceFile', 'file'); await path('outputDirectory', 'directory', true, true);
    await path('releaseStore', 'directory', false, true);
    option('--source', settings.sourceFile); option('--output', settings.outputDirectory); option('--release-store', settings.releaseStore);
  } else if (type.id === 'object-buyer') {
    await path('stateDirectory', 'directory', false, true);
    await path('profileFile', 'file'); await path('operatorSettings', 'file');
    const savedSettings = join(settings.stateDirectory, 'received', 'operator-settings.json');
    const original = await readJSON(savedSettings, true);
    if (original) {
      need(typeof original.path === 'string' && (!settings.operatorSettings || settings.operatorSettings === original.path),
        'APPLICATION_OBJECT_OPERATOR_CHANGED', 'Reopen this object workspace with its original operator settings path');
      absolute(original.path); inputs.push(await inputPath(savedSettings, 'file'));
    }
    let analysisPython;
    if (settings.analysisPython) {
      const selected = await selectedExecutable(settings.analysisPython);
      analysisPython = selected.executable; inputs.push(...selected.inputs);
    }
    option('--state', settings.stateDirectory); option('--profile', settings.profileFile);
    option('--operator-settings', settings.operatorSettings); option('--analysis-python', analysisPython);
  } else if (type.id === 'goldrush') {
    await path('stateDirectory', 'directory', false, true);
    const configFile = join(settings.stateDirectory, 'workbench.json');
    inputs.push(await inputPath(configFile, 'file'));
    const original = await readJSON(configFile);
    need(original.schema === 'stellar-forge.goldrush-workbench.v1' &&
      typeof original.id === 'string' && typeof original.release === 'string' &&
      typeof original.buyerState === 'string' && typeof original.inbox === 'string' &&
      !(original.workspace && original.profile), 'APPLICATION_GOLDRUSH_BINDING_CHANGED');
    inputs.push(await inputPath(original.release, 'directory'));
    for (const key of ['buyerState', 'inbox'])
      inputs.push(await inputPath(original[key], 'directory', false, true));
    if (original.workspace) inputs.push(await inputPath(original.workspace, 'directory', false, true));
    if (original.profile) inputs.push(await inputPath(original.profile, 'file'));
    const reference = settings.referenceFile ?? original.referenceFile;
    if (reference) inputs.push(await inputPath(reference, 'file'));
    args.push('workbench', '--state', settings.stateDirectory);
    option('--reference-file', settings.referenceFile);
  } else if (type.id === 'research-dossiers') {
    const workspace = await path('workspaceDirectory', 'directory', true, true);
    if (!workspace.exists) createDirectories.push(workspace.path);
    await path('editionAdapter', 'file');
    await path('openalexModule', 'file');
    if (settings.crossrefState) {
      const source = await path('crossrefState', 'directory', true, true);
      if (!source.exists && !createDirectories.includes(source.path)) createDirectories.push(source.path);
      await path('crossrefConfig', 'file');
    }
    if (settings.openalexWorkspaceDirectory) {
      await path('openalexWorkspaceDirectory', 'directory', false, true);
      for (const part of ['queries', 'editions'])
        inputs.push(await inputPath(join(settings.openalexWorkspaceDirectory, part), 'directory'));
    }
    option('--dir', settings.workspaceDirectory);
    option('--edition-adapter', settings.editionAdapter);
    option('--openalex-workspace', settings.openalexWorkspaceDirectory);
    option('--openalex-module', settings.openalexModule);
    option('--crossref-state', settings.crossrefState);
    option('--crossref-config', settings.crossrefConfig);
  } else if (type.id === 'buyer-expenses') {
    const state = await path('stateDirectory', 'directory', true, true);
    if (!state.exists) createDirectories.push(state.path);
    option('--state', settings.stateDirectory);
  } else if (type.id === 'merchant-recovery') {
    const config = await path('hostConfig', 'file');
    await path('workspaceDirectory', 'directory', true, true);
    const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
    const originalModule = join(selected.sourceRoot,
      'stellar/scf-starforge-20261009/sf101-merchant-recovery/workspace/model.mjs');
    inputs.push(await inputPath(originalModule, 'file'));
    const { readRecoveryConfiguration } = await import(pathToFileURL(originalModule).href);
    const original = await readRecoveryConfiguration(settings.hostConfig);
    need(original.sha256 === config.sha256, 'APPLICATION_RECOVERY_CONFIG_CHANGED',
      'Review the original current recovery host configuration');
    const retained = new Set(inputs.map(item => item.path));
    const retain = async (value, kind = 'directory', missing = false) => {
      if (!retained.has(value)) {
        inputs.push(await inputPath(value, kind, missing, true));
        retained.add(value);
      }
    };
    for (const profile of original.host.profiles) {
      if (profile.storeConfig != null) await retain(profile.storeConfig, 'file');
      await retain(profile.operations, 'directory', true);
      for (const root of profile.bundleRoots) await retain(root.directory);
      for (const plan of profile.capturePlans ?? []) await retain(plan.planFile, 'file', true);
      for (const restored of profile.publisherRestores ?? []) {
        await retain(restored.bundleDirectory, 'directory', true);
        await retain(restored.restoreDirectory, 'directory', true);
      }
      await retain(profile.downloadRoot);
      await retain(profile.restoreRoot);
    }
    args.push('workspace', 'serve');
    option('--config', settings.hostConfig); option('--directory', settings.workspaceDirectory);
  } else if (type.id === 'commerce') {
    await path('directory', 'directory', false, true); await path('recoveryConfig', 'file');
    const finalityNode = settings.finalityNode ? await realpath(settings.finalityNode) : null;
    if (finalityNode) { inputs.push(await inputPath(finalityNode, 'file')); await access(finalityNode, constants.X_OK); }
    args.push('start'); option('--directory', settings.directory);
    option('--finality-node', finalityNode ?? undefined); option('--recovery-config', settings.recoveryConfig);
  }
  if (type.terminal) {
    terminalPython = await realpath(settings.terminalPython ?? '/usr/bin/python3');
    inputs.push(await inputPath(terminalPython, 'file')); await access(terminalPython, constants.X_OK);
  }
  if (type.id !== 'mpp') option('--port', settings.port);
  if (settings.environmentFile) inputs.push(await inputPath(settings.environmentFile, 'file'));
  const environment = await applicationEnvironment(settings.environmentFile);
  return { command: type.command, args, inputs, createDirectories, terminal: type.terminal,
    ...(eventFeed ? { eventFeed } : {}),
    ...(apiPassWorkspace ? { apiPassWorkspace } : {}),
    ...(mppBinding ? { mppBinding } : {}),
    ...(openapi ? { openapi } : {}),
    ...(stellarApplication ? { stellarApplication } : {}),
    ...(jobResultReceiver ? { jobResultReceiver } : {}),
    ...(buyerRunbook ? { buyerRunbook } : {}),
    ...(selectedResourceKey ? { resourceKey: selectedResourceKey } : {}),
    ...(type.terminal ? { terminalPython } : {}),
    ...(settings.environmentFile ? { environmentFile: settings.environmentFile, environmentSha256: environment.sha256 } : {}) };
}
function resourceKey(type, settings) {
  if (type.python) return pythonApplicationResource(type, settings);
  if (['arcgis-agent', 'worldbank-agent'].includes(type.id)) return hash({ family: 'merchant-mcp', directory: settings.configurationFile });
  if (type.id === 'duckdb-agent') return hash({ family: 'native-mcp', directory: settings.nativeDirectory });
  const value = settings.outputParent ?? settings.workspaceDirectory ?? settings.directory ??
    settings.outputDirectory ?? settings.stateDirectory ?? settings.datasetFile;
  // Feeds, repository metadata and XML retain the same original SQLite workspace and writer.
  const family = ['rss-atom', 'oai-repository'].includes(type.id) ? 'xml' : type.id.endsWith('-publisher') ? 'publisher' : type.id;
  return hash({ family, directory: value });
}
async function application(root, id) {
  const value = await readJSON(join(directoryFor(root, id), 'application.json'));
  need(value.schema === SCHEMA && value.id === id && /^[a-f0-9]{64}$/.test(value.revision), 'APPLICATION_RECORD_CHANGED');
  return value;
}
async function runCancellation(root, appId, id) {
  return readJSON(join(directoryFor(root, appId), 'runs', operationId(id) + '.cancel.json'), true);
}
async function operationView(root, id) {
  const directory = operationPath(root, id);
  const request = await readJSON(join(directory, 'request.json'), true);
  const state = await readJSON(join(directory, 'state.json'), true);
  const active = Boolean(state) && await operationRunning(join(directory, 'worker.lock'));
  const result = await readJSON(join(directory, 'command-result.json'), true);
  const stop = await readJSON(join(directory, 'stop.json'), true);
  const url = await readJSON(join(directory, 'application-url.json'), true);
  return { id, request, state, result, active, stop,
    phase: !request ? 'PENDING' : !state ? 'QUEUED' : state.phase === 'RUNNING' && !active ? 'INTERRUPTED' : state.phase,
    url: url?.operationId === id ? url : null };
}
async function runs(root, id) {
  const directory = join(directoryFor(root, id), 'runs');
  const names = (await readdir(directory)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
  const saved = await Promise.all(names.map(name => readJSON(join(directory, name))));
  saved.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return saved;
}
const unfinished = value => value.active || ['PENDING', 'QUEUED', 'RUNNING', 'INTERRUPTED'].includes(value.phase);
async function busyApplication(root, id) {
  const saved = await runs(root, id);
  for (const run of saved) {
    if (await runCancellation(root, id, run.id)) continue;
    const value = await operationView(root, run.id);
    if (unfinished(value)) return value;
  }
  return null;
}
async function selectedRelease(root, saved, homes = null) {
  // This map belongs to one overview request, never to a lifecycle action.
  if (homes && !homes.has(saved.homeId)) homes.set(saved.homeId, managedHome(root, saved.homeId));
  const home = await (homes ? homes.get(saved.homeId) : managedHome(root, saved.homeId));
  const release = home?.releases.find(item => item.runtime &&
    bindingKeys.every(key => item.runtime[key] === saved.runtime[key]));
  return { home, release };
}
async function runViews(root, applicationId, history) {
  return Promise.all(history.map(async run => {
    const cancelled = await runCancellation(root, applicationId, run.id);
    const observed = cancelled ? { id: run.id, phase: 'CANCELLED', active: false, result: cancelled } : await operationView(root, run.id);
    return { id: run.id, createdAt: run.createdAt, revision: run.revision, command: run.request.command,
      args: run.request.args, terminal: run.request.terminal === true, ...observed,
      request: undefined, privateUrl: observed.active && !observed.stop ? observed.url?.url ?? null : null,
      privateLinks: observed.active && !observed.stop && Array.isArray(observed.url?.links) ? observed.url.links : [] };
  }));
}
async function view(root, saved, { homes = null, historyLimit = 30 } = {}) {
  const [{ home, release }, page] = await Promise.all([
    selectedRelease(root, saved, homes),
    applicationRunPage(root, { applicationId: saved.id, limit: historyLimit }),
  ]);
  const rows = await runViews(root, saved.id, page.runs);
  const current = rows[0] ?? null;
  const adoption = !release && saved.adoption ? await operationView(root, saved.adoption.requestId) : null;
  const phase = !release ? 'CONNECTING' : !current ? 'READY' :
    current.active ? current.stop ? 'STOPPING' : current.url ? 'RUNNING' : 'STARTING' :
      ['SUCCEEDED', 'CANCELLED'].includes(current.phase) ? current.result?.state === 'EXITED' || current.result?.state === 'LAUNCH_FAILED' ? 'FAILED' : 'STOPPED' :
        current.phase;
  return { ...saved, phase, release: release ? { id: release.id, digest: release.digest, sourceCommit: release.sourceCommit } : null,
    home: home ? { id: home.id, directory: home.directory, revision: home.revision, phase: home.phase } : null,
    adoption, current, runs: rows, totalRuns: page.totalRuns,
    history: { limit: page.limit, nextCursor: page.nextCursor } };
}
export async function applicationsState(root, { historyLimit = 30 } = {}) {
  historyLimit = applicationHistoryLimit(historyLimit);
  await initializeApplications(root);
  const names = (await readdir(join(root, 'applications'))).filter(name => /^[a-f0-9]{24}$/.test(name));
  const homes = new Map();
  const items = await Promise.all(names.map(async id => {
    try { return await view(root, await application(root, id), { homes, historyLimit }); }
    catch (error) { return { id, label: id, phase: 'UNAVAILABLE', error: errorView(error) }; }
  }));
  items.sort((a, b) => String(a.label).localeCompare(String(b.label)) || a.id.localeCompare(b.id));
  return { schema: 'stellar-forge.runtime-applications.v1', catalog: APPLICATION_CATALOG, applications: items };
}
export async function applicationsHistory(root, input = {}) {
  await application(root, recordId(input.applicationId));
  const page = await applicationRunPage(root, input);
  return { schema: 'stellar-forge.application-history.v1', ...page,
    runs: await runViews(root, input.applicationId, page.runs) };
}
export async function reviewApplication(root, { runtimeId, runtimeDirectory, kind, settings: input,
  label, applicationId = null, expectedRevision = null, homeId = null } = {}) {
  await initializeApplications(root);
  recordId(runtimeId);
  const previous = applicationId ? await application(root, recordId(applicationId)) : null;
  if (previous) {
    need(previous.revision === expectedRevision, 'APPLICATION_REVIEW_CHANGED', 'Reopen the current application before editing it', 409);
    need(!await busyApplication(root, previous.id), 'APPLICATION_RUNNING', 'Stop or reconcile the original application before changing its settings', 409);
  }
  const type = applicationType(kind), settings = normalizeSettings(type, input);
  need(typeof label === 'string' && label.trim() && label.length <= 120, 'APPLICATION_LABEL_REQUIRED');
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const { spec } = await readDistributionSpecification({ sourceRoot: runtime.sourceRoot });
  need(type.python || Object.hasOwn(spec.commands ?? {}, type.command), 'APPLICATION_NOT_IN_RUNTIME',
    'This selected runtime does not include ' + type.command + '. Choose a runtime containing that original command.');
  if (type.requiredSource) await regular(join(runtime.sourceRoot, type.requiredSource), 4 * 1024 * 1024).catch(() =>
    need(false, 'APPLICATION_NOT_IN_RUNTIME', 'Choose a runtime containing the original ' + type.title + ' source'));
  if (type.id === 'research-dossiers' && settings.openalexWorkspaceDirectory && !settings.openalexModule)
    await regular(join(runtime.sourceRoot,
      'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research/workspace.mjs'), 4 * 1024 * 1024).catch(() =>
      need(false, 'APPLICATION_NOT_IN_RUNTIME',
        'Choose a runtime containing the original OpenAlex workspace or select its explicit original module'));
  if (type.id === 'research-dossiers' && settings.crossrefState) {
    const required = [
      'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/crossref-workspace.mjs',
      'stellar/scf-starforge-20261009/sf30-seller-sdk/crossref/source.mjs',
      ...(settings.crossrefConfig ? [
        'stellar/scf-starforge-20261009/sf30-seller-sdk/crossref/config.mjs',
        'stellar/scf-starforge-20261009/sf30-seller-sdk/crossref/merchant.mjs',
      ] : []),
    ];
    for (const path of required) await regular(join(runtime.sourceRoot, path), 4 * 1024 * 1024).catch(() =>
      need(false, 'APPLICATION_NOT_IN_RUNTIME', 'Choose a runtime containing the original Crossref research workspace and source'));
  }
  const command = await applicationCommand(type, settings, runtime.directory, { root, runtimeId });
  const homes = (await managedState(root)).homes;
  let home = homeId ? homes.find(item => item.id === recordId(homeId)) : homes.find(item => item.releases.some(release =>
    release.runtime && bindingKeys.every(key => release.runtime[key] === runtime[key])));
  if (!home) {
    need(!homeId, 'APPLICATION_MANAGED_HOME_REQUIRED');
    const opened = await openManagedHome(root, { directory: join(root, 'application-homes', runtimeId), label: label.trim() + ' runtime' });
    home = opened.home;
  }
  const release = home.releases.find(item => item.runtime && bindingKeys.every(key => item.runtime[key] === runtime[key]));
  const adoptionReview = release ? null : await reviewManagedAdoption(root, { homeId: home.id, runtimeId, runtimeDirectory });
  const value = { schema: 'stellar-forge.application-review.v1', applicationId, previousRevision: previous?.revision ?? null,
    runtimeId, runtime: binding(runtime), kind, settings, label: label.trim(), command,
    homeId: home.id, homeDirectory: home.directory, releaseId: release?.id ?? null,
    resourceKey: command.resourceKey ?? resourceKey(type, settings),
    adoption: adoptionReview ? { requestId: uuidFrom('application-adopt:' + home.id + ':' + adoptionReview.id),
      operation: 'managed-adopt', homeId: home.id, reviewId: adoptionReview.id } : null };
  const id = hash(value).slice(0, 24), path = reviewPath(root, id);
  try { await saveJSON(path, { ...value, id, reviewedAt: now() }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return readJSON(path);
}
export async function saveApplication(root, { requestId, reviewId, applicationId = null } = {}) {
  operationId(requestId);
  const reviewed = await readJSON(reviewPath(root, reviewId));
  need(reviewed.applicationId === applicationId, 'APPLICATION_REVIEW_CHANGED');
  const id = applicationId ? recordId(applicationId) : digest(requestId).slice(0, 24), directory = directoryFor(root, id);
  try { await makePrivate(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(directory); }
  for (const name of ['runs', 'revisions']) {
    try { await makePrivate(join(directory, name)); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const lease = await operationLease(join(directory, 'application.lock'));
  try {
    const previous = await readJSON(join(directory, 'application.json'), true), requestHash = hash({ requestId, reviewId, applicationId });
    if (previous?.saveRequestId === requestId) {
      need(previous.saveRequestHash === requestHash, 'APPLICATION_SAVE_ID_REUSED');
      return previous;
    }
    need((previous?.revision ?? null) === reviewed.previousRevision, 'APPLICATION_REVIEW_CHANGED');
    if (previous) need(!await busyApplication(root, id), 'APPLICATION_RUNNING');
    const current = await applicationCommand(applicationType(reviewed.kind), reviewed.settings, reviewed.runtime.directory, {
      root, runtimeId: reviewed.runtimeId,
    });
    need(hash(current) === hash(reviewed.command), 'APPLICATION_INPUTS_CHANGED', 'Review the current application files before saving', 409);
    for (const path of reviewed.command.createDirectories) {
      try { await makePrivate(path); } catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(path); }
    }
    const body = { kind: reviewed.kind, label: reviewed.label, runtimeId: reviewed.runtimeId, runtime: reviewed.runtime,
      settings: reviewed.settings, homeId: reviewed.homeId, homeDirectory: reviewed.homeDirectory,
      adoption: reviewed.adoption, resourceKey: reviewed.resourceKey };
    const revision = hash(body);
    const value = { schema: SCHEMA, id, ...body, revision, createdAt: previous?.createdAt ?? now(), updatedAt: now(),
      saveRequestId: requestId, saveRequestHash: requestHash, reviewId };
    try { await saveJSON(join(directory, 'revisions', revision + '.json'), value); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await saveJSON(join(directory, 'application.json'), value, true);
    return value;
  } finally { await lease.close(); }
}
export async function applicationBindingOperation(root, id) {
  const saved = await application(root, id), { release } = await selectedRelease(root, saved);
  return release ? null : saved.adoption;
}
export async function reviewApplicationStart(root, id) {
  const saved = await application(root, id);
  need(!await busyApplication(root, id), 'APPLICATION_RUNNING', 'Reopen the retained application operation', 409);
  const runtime = await inspectMerchantRuntime(saved.runtime.directory, { expectedManifest: saved.runtime.sourceManifestSha256, load: false });
  need(hash(binding(runtime)) === hash(saved.runtime), 'APPLICATION_RUNTIME_CHANGED');
  const { home, release } = await selectedRelease(root, saved);
  need(release && (applicationType(saved.kind).python || Object.hasOwn(release.commands, applicationType(saved.kind).command)), 'APPLICATION_CONNECTION_REQUIRED');
  const command = await applicationCommand(applicationType(saved.kind), saved.settings, saved.runtime.directory, {
    root, runtimeId: saved.runtimeId,
  });
  need(command.resourceKey === undefined || command.resourceKey === saved.resourceKey,
    'APPLICATION_STATE_CHANGED', 'Review and save this application with its current private state directory before starting', 409);
  const value = { schema: 'stellar-forge.application-start-review.v1', applicationId: id,
    applicationRevision: saved.revision, runtime: saved.runtime, homeId: home.id, homeRevision: home.revision,
    releaseId: release.id, releaseDigest: release.digest, resourceKey: saved.resourceKey, command };
  const reviewId = hash(value).slice(0, 24);
  try { await saveJSON(reviewPath(root, reviewId), { ...value, id: reviewId, reviewedAt: now() }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return readJSON(reviewPath(root, reviewId));
}
export async function prepareApplicationStart(root, { applicationId, requestId, reviewId } = {}) {
  const id = recordId(applicationId); operationId(requestId);
  const saved = await application(root, id), directory = directoryFor(root, id), file = join(directory, 'runs', requestId + '.json');
  const requestHash = hash({ applicationId, requestId, reviewId });
  const original = await readJSON(file, true);
  if (original) { need(original.requestHash === requestHash, 'APPLICATION_RUN_ID_REUSED'); return original; }
  const lease = await operationLease(join(root, 'application-resource-locks', saved.resourceKey + '.lock'));
  try {
    const again = await readJSON(file, true);
    if (again) { need(again.requestHash === requestHash, 'APPLICATION_RUN_ID_REUSED'); return again; }
    const reviewed = await readJSON(reviewPath(root, reviewId));
    need(reviewed.schema === 'stellar-forge.application-start-review.v1' && reviewed.applicationId === id &&
      reviewed.applicationRevision === (await application(root, id)).revision, 'APPLICATION_START_REVIEW_CHANGED');
    const names = (await readdir(join(root, 'applications'))).filter(name => /^[a-f0-9]{24}$/.test(name));
    for (const other of names) {
      const candidate = await readJSON(join(directoryFor(root, other), 'application.json'), true);
      if (candidate?.resourceKey === saved.resourceKey)
        need(!await busyApplication(root, other), 'APPLICATION_WORKSPACE_BUSY',
          'The original application for this data directory already has a retained operation. Reopen or stop that operation.', 409);
    }
    const current = await applicationCommand(applicationType(saved.kind), saved.settings, saved.runtime.directory, {
      root, runtimeId: saved.runtimeId,
    });
    need(hash(current) === hash(reviewed.command), 'APPLICATION_INPUTS_CHANGED', 'Review the original current inputs again', 409);
    const { home, release } = await selectedRelease(root, saved);
    need(home?.revision === reviewed.homeRevision && release?.id === reviewed.releaseId &&
      release?.digest === reviewed.releaseDigest, 'APPLICATION_RELEASE_CHANGED');
    const request = { requestId, operation: 'managed-run', homeId: home.id, releaseId: release.id,
      expectedRevision: home.revision, applicationId: id, command: current.command, args: current.args,
      terminal: current.terminal, ...(current.terminalPython ? { terminalPython: current.terminalPython } : {}),
      ...(current.pythonCommand ? { pythonCommand: current.pythonCommand } : {}),
      ...(current.jobResultReceiver ? { jobResultReceiver: current.jobResultReceiver } : {}),
      ...(current.buyerRunbook ? { buyerRunbook: current.buyerRunbook } : {}),
      ...(current.stellarApplication ? { stellarApplication: current.stellarApplication } : {}),
      ...(current.environmentFile ? { environmentFile: current.environmentFile, environmentSha256: current.environmentSha256 } : {}) };
    const value = { schema: 'stellar-forge.application-run.v1', id: requestId, applicationId: id,
      createdAt: now(), revision: saved.revision, reviewId, requestHash, request };
    await saveJSON(file, value);
    return value;
  } finally { await lease.close(); }
}
export async function dispatchApplicationStart(root, input, dispatch) {
  const lease = await operationLease(join(directoryFor(root, input.applicationId), 'application.lock'));
  try {
    need(!await runCancellation(root, input.applicationId, input.requestId), 'APPLICATION_START_CANCELLED');
    const run = await prepareApplicationStart(root, input);
    return { applicationId: input.applicationId, ...await dispatch(run.request) };
  } finally { await lease.close(); }
}
export async function cancelApplicationRun(root, input, stop) {
  const { applicationId, operationId: id } = input;
  const lease = await operationLease(join(directoryFor(root, applicationId), 'application.lock'));
  try {
    await applicationOperation(root, input);
    if (await readJSON(join(operationPath(root, id), 'request.json'), true)) return stop(id);
    const path = join(directoryFor(root, applicationId), 'runs', operationId(id) + '.cancel.json');
    let result = await readJSON(path, true);
    if (!result) {
      result = { schema: 'stellar-forge.application-run-cancellation.v1', applicationId, operationId: id,
        state: 'CANCELLED', completedAt: now(), launched: false };
      try { await saveJSON(path, result); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    return result;
  } finally { await lease.close(); }
}
export async function applicationOperation(root, { applicationId, operationId: id } = {}) {
  const saved = await readJSON(join(directoryFor(root, applicationId), 'runs', operationId(id) + '.json'));
  need(saved.applicationId === applicationId && saved.id === id, 'APPLICATION_OPERATION_CHANGED');
  return saved.request;
}
export async function applicationOutput(root, { applicationId, operationId: id } = {}) {
  await applicationOperation(root, { applicationId, operationId: id });
  const value = await operationView(root, id);
  let output = { text: '', totalBytes: 0, offset: 0 };
  try { output = await tailFile(join(operationPath(root, id), 'worker.log')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { operationId: id, phase: value.phase, active: value.active, result: value.result, output };
}
export { readApplicationTerminal, sendApplicationTerminal };

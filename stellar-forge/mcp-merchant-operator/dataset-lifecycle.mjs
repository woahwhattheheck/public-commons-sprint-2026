// MIT. Original SF82 dataset releases and the running SF30 version controller.
import { join, resolve } from 'node:path';
import { lstat } from 'node:fs/promises';
import { inspectRelease } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';
import { datasetContractSha256 } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-dataset.mjs';
import { openDatasetVersions } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/versions.mjs';
import { datasetControl } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/service.mjs';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const fail = (code, message) => Object.assign(new Error(message), { code });
const releaseId = { type: 'string', pattern: ID.source };
const digest = { type: 'string', pattern: HASH.source };
const selected = { releaseId };
const expected = { ...selected, expectedDigest: digest };
const current = { expectedSnapshot: digest, expectedRevision: { type: 'integer', minimum: 1 } };
const read = { readOnly: true, idempotent: true };
const unavailable = error => ['ENOENT', 'ECONNREFUSED', 'ECONNRESET'].includes(error.code);

export function datasetReleaseView(dataset) {
  if (!dataset) return null;
  const { datasetDirectory, ...publicValue } = dataset;
  return { ...publicValue, controllerConfigured: typeof datasetDirectory === 'string' };
}
export function datasetLifecycleTools(tool) {
  return [
    tool('merchant_dataset_status', 'Read the retained SF82 dataset release and its running original version controller: staged baseline, current snapshot/revision, retained versions and actual resources. A stopped controller is reported without opening a writer.',
      selected, ['releaseId'], read),
    tool('merchant_dataset_initialize', 'Initialize the original version store from an exact staged release before first seller start. Reuses an existing running controller; reopens an existing stopped store under its original writer lease and closes immediately. Existing data selection is preserved.',
      expected, ['releaseId', 'expectedDigest'], { idempotent: true }),
    tool('merchant_dataset_preview', 'Query the running original controller with its native URL query string, including retained snapshot and cursor continuity. Returns the original operator preview through the same dataset parser.',
      { ...selected, query: { type: 'string', maxLength: 8192 } }, ['releaseId', 'query'], read),
    tool('merchant_dataset_publish', 'Publish the dataset in an exact staged SF82 release through its original running controller, using current native snapshot/revision. Original contract, retention and capacity checks apply. Running payment terms change through merchant_activate/restart.',
      { ...expected, ...current }, ['releaseId', 'expectedDigest', 'expectedSnapshot', 'expectedRevision']),
    tool('merchant_dataset_activate', 'Select a retained data snapshot through the original controller using current snapshot/revision. In-flight requests keep their admitted generation. Merchant release selection and payment terms use the existing SF82 lifecycle.',
      { ...expected, ...current, snapshot: digest },
      ['releaseId', 'expectedDigest', 'snapshot', 'expectedSnapshot', 'expectedRevision']),
  ];
}
function validate(name, args) {
  const definition = datasetLifecycleTools((name, description, properties, required) => ({ name, properties, required }))
    .find(value => value.name === name);
  if (!definition) throw fail('TOOL_NOT_FOUND', 'Unknown dataset lifecycle operation.');
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(key => !Object.hasOwn(definition.properties, key)) ||
      definition.required.some(key => !Object.hasOwn(args, key)))
    throw fail('INVALID_PARAMS', 'Supply exactly the declared dataset lifecycle fields.');
  if (typeof args.releaseId !== 'string' || !ID.test(args.releaseId))
    throw fail('INVALID_PARAMS', 'Choose an original retained release ID.');
  for (const key of ['expectedDigest', 'expectedSnapshot', 'snapshot'])
    if (Object.hasOwn(args, key) && (typeof args[key] !== 'string' || !HASH.test(args[key])))
      throw fail('INVALID_PARAMS', 'Use an inspected SHA256 for ' + key + '.');
  if (Object.hasOwn(args, 'expectedRevision') && (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 1))
    throw fail('INVALID_PARAMS', 'Use the current positive dataset revision.');
  if (Object.hasOwn(args, 'query') && (typeof args.query !== 'string' || args.query.length > 8192))
    throw fail('INVALID_PARAMS', 'Use the original URL query string within 8192 characters.');
}
async function selectedRelease(root, args) {
  root = resolve(root);
  const release = await inspectRelease(root, args.releaseId);
  if (!release.dataset) throw fail('DATASET_RELEASE_REQUIRED', 'Choose a retained original SF82 dataset release.');
  if (args.expectedDigest !== undefined && release.digest !== args.expectedDigest)
    throw fail('RELEASE_CONFLICT', 'The retained release differs from its inspected digest.');
  const directory = join(root, 'releases', args.releaseId);
  // inspectRelease already verifies the complete source and dataset against the
  // retained release digest. Reuse that result instead of parsing the CSV twice.
  return { release, dataset: release.dataset, configPath: join(directory, 'dataset', 'dataset.json'),
    directory: release.dataset.datasetDirectory };
}
function view(selected, values) {
  return { releaseId: selected.release.id, releaseDigest: selected.release.digest,
    dataset: datasetReleaseView(selected.dataset), ...values };
}
function sameContract(selected, description) {
  if (datasetContractSha256(description) !== selected.dataset.contractSha256)
    throw fail('DATASET_CONTRACT_CHANGED', 'The target has a different original query contract. Select the matching dataset release and version store.');
}
async function running(selected) {
  const result = await datasetControl(selected.directory, 'schema');
  sameContract(selected, result.dataset);
  return result;
}
/** Running changes use the original controller. Explicit initialization alone
 * opens a writer; the original lease is released before returning. */
export async function merchantDatasetOperation(root, name, args = {}) {
  validate(name, args);
  const selected = await selectedRelease(root, args);
  if (name === 'merchant_dataset_initialize') {
    try {
      const live = await running(selected);
      return view(selected, { state: 'RUNNING', versions: live.versions, resources: live.resources });
    } catch (error) { if (!unavailable(error)) throw error; }
    const existing = await lstat(join(selected.directory, 'state.json')).then(() => true, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    const versions = await openDatasetVersions({ directory: selected.directory,
      ...(existing ? {} : { initialConfig: selected.configPath }), collectOnOpen: false });
    try {
      sameContract(selected, versions.describe());
      return view(selected, { state: 'READY', versions: versions.status() });
    } finally { await versions.close(); }
  }
  let live;
  try { live = await running(selected); }
  catch (error) {
    if (!unavailable(error)) throw error;
    if (name === 'merchant_dataset_status')
      return view(selected, { state: 'NOT_RUNNING', versions: null, resources: [] });
    throw fail('DATASET_SELLER_NOT_RUNNING', 'Start the selected original SF82 dataset seller, then continue through its private controller.');
  }
  if (name === 'merchant_dataset_status')
    return view(selected, { state: 'RUNNING', versions: live.versions, resources: live.resources });
  if (name === 'merchant_dataset_preview')
    return view(selected, { state: 'RUNNING', response: await datasetControl(selected.directory, 'preview', { query: args.query }) });
  const guard = { expectedSnapshot: args.expectedSnapshot, expectedRevision: args.expectedRevision };
  if (name === 'merchant_dataset_publish') {
    const versions = await datasetControl(selected.directory, 'refresh', { configPath: selected.configPath, ...guard });
    if (versions.current !== selected.dataset.baselineSnapshot)
      throw fail('DATASET_PUBLICATION_UNCERTAIN', 'Read the original dataset status and retained release before another publication.');
    return view(selected, { state: 'PUBLISHED', versions });
  }
  return view(selected, { state: 'ACTIVATED', versions: await datasetControl(selected.directory, 'activate', { snapshot: args.snapshot, ...guard }) });
}

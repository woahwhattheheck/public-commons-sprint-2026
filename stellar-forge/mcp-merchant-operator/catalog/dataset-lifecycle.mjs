// MIT. Original tool metadata; provider runtimes load only when selected.


const HASH = /^[a-f0-9]{64}$/;

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const releaseId = { type: 'string', pattern: ID.source };

const digest = { type: 'string', pattern: HASH.source };

const selected = { releaseId };

const expected = { ...selected, expectedDigest: digest };

const current = { expectedSnapshot: digest, expectedRevision: { type: 'integer', minimum: 1 } };

const read = { readOnly: true, idempotent: true };

function datasetReleaseView(dataset) {
  if (!dataset) return null;
  const { datasetDirectory, ...publicValue } = dataset;
  return { ...publicValue, controllerConfigured: typeof datasetDirectory === 'string' };
}

function datasetLifecycleTools(tool) {
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

export { datasetLifecycleTools, datasetReleaseView, selected, read, expected, current, digest, releaseId, HASH, ID };

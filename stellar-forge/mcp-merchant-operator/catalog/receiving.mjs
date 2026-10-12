// MIT. Original tool metadata; provider runtimes load only when selected.


const ID_PATTERN = '^[a-z0-9]{8,13}-[a-f0-9]{16}$';

const idSchema = { type: 'string', pattern: ID_PATTERN };

const aliasSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const digestSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };

const pageSchema = { after: idSchema, limit: { type: 'integer', minimum: 1, maximum: 50 } };

const offsetSchema = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } };

function receivingTools(tool) {
  const read = { readOnly: true, idempotent: true };
  return [
    tool('merchant_receiving_status', 'Inspect configured receiving sources and this process-owned workspace, active review and queued work. Does not open the workspace.', {}, [], read),
    tool('merchant_receiving_sources', 'List host-selected seller profiles and captured-review imports, or inspect exact source bytes and digests before preparing/importing. Credential values and file paths stay on the host.',
      { kind: { enum: ['profile', 'import'] }, source: aliasSchema }, [], read),
    tool('merchant_receiving_open', 'Open the original private receiving workspace and resume its retained queued reviews. Uses its original exclusive lease. Close a standalone browser/CLI owner first.', {}, [], { idempotent: true, openWorld: true }),
    tool('merchant_receiving_close', 'Drain this process-owned receiving workspace and release its original lease so the same saved work can open in the original browser or CLI. Other merchant runtimes remain available.', {}, [], { idempotent: true }),
    tool('merchant_receiving_prepare', 'Freeze an inspected host seller source as an original saved profile with compiled native payment choices. Use a caller-retained ID and exact source digest; an equal retry returns the same profile.',
      { id: idSchema, source: aliasSchema, expectedSourceSha256: digestSchema }, ['id', 'source', 'expectedSourceSha256'], { idempotent: true }),
    tool('merchant_receiving_profiles', 'List saved original profiles, or inspect one profile and its paged original payment choices. Reuses the currently opened workspace.',
      { id: idSchema, ...pageSchema, offset: offsetSchema.offset }, [], read),
    tool('merchant_receiving_start', 'Queue an original native live receiving review or replay a retained capture. Uses exact saved profile and plan digest. Retain id across retries; optional previousReviewId adds the original comparison. Live mode performs network reads.',
      { id: idSchema, profileId: idSchema, expectedPlanDigest: digestSchema, mode: { enum: ['live', 'replay'] },
        captureReviewId: idSchema, previousReviewId: idSchema }, ['id', 'profileId', 'expectedPlanDigest', 'mode'], { idempotent: true, openWorld: true }),
    tool('merchant_receiving_reviews', 'List saved review jobs or read an exact review, original summary, paged account findings and corrective actions. Captured source bytes remain in the original private bundle.',
      { id: idSchema, profileId: idSchema, ...pageSchema, offset: offsetSchema.offset }, [], read),
    tool('merchant_receiving_cancel', 'Cancel an original queued review or request interruption of its active reads. Completed results keep their original state. Inspect reviews for the terminal result.',
      { id: idSchema }, ['id'], { idempotent: true }),
    tool('merchant_receiving_compare', 'Compare two completed original reviews using complete payment identity. Returns paged added, changed, unchanged and removed options.',
      { previousId: idSchema, currentId: idSchema, ...offsetSchema }, ['previousId', 'currentId'], read),
    tool('merchant_receiving_import', 'Import a host-selected complete original receiving export using its inspected byte digest and a caller-retained review ID. The original controller validates and retains source, profile, capture and report together.',
      { id: idSchema, source: aliasSchema, expectedSourceSha256: digestSchema }, ['id', 'source', 'expectedSourceSha256'], { idempotent: true }),
    tool('merchant_receiving_export', 'Publish the exact complete original receiving export as a private named JSON file under the configured customer export directory. An equal retry reuses the same completed file.',
      { id: idSchema, exportId: aliasSchema }, ['id', 'exportId'], { idempotent: true }),
    tool('merchant_receiving_export_status', 'Read a named receiving export, verify every embedded file and its original retained manifest, and return the exact file digest and native review identity.',
      { exportId: aliasSchema }, ['exportId'], read),
  ];
}

export { receivingTools, aliasSchema, idSchema, digestSchema, pageSchema, offsetSchema, ID_PATTERN };

// MIT. Original tool metadata; provider runtimes load only when selected.


const aliasSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const operationSchema = { type: 'string', pattern: '^[a-z][a-z0-9-]{7,79}$' };

const revisionSchema = { type: 'integer', minimum: 1 };

const digestSchema = { type: 'string', pattern: '^[0-9a-f]{64}$' };

const jsonSchema = { type: 'object', additionalProperties: true };

function s3WorkspaceTools(tool) {
  const read = { readOnly: true, idempotent: true };
  const withWorkspace = fields => ({ workspace: aliasSchema, ...fields });
  const recordSchema = { type: 'string', minLength: 1, maxLength: 160 };
  return [
    tool('merchant_s3_status', 'List configured S3 authoring aliases, or inspect an already opened original workspace, saved head, selected reviews, packages and release IDs. Does not open a database or contact object storage.',
      withWorkspace({}), [], read),
    tool('merchant_s3_open', 'Open or reopen a host-selected original S3 authoring workspace and its existing release store. Retains original revisions and recovery records; does not contact object storage or start a seller.',
      withWorkspace({}), ['workspace'], { idempotent: true }),
    tool('merchant_s3_close', 'Close this operator’s S3 authoring handle after its accepted work finishes. Saved revisions, original packages and the separately managed seller remain available.',
      withWorkspace({}), ['workspace'], { idempotent: true }),
    tool('merchant_s3_history', 'Page the original immutable authoring revisions, newest first. Continue with nextBeforeRevision returned by this original store.',
      withWorkspace({ beforeRevision: revisionSchema, limit: { type: 'integer', minimum: 1, maximum: 100 } }), ['workspace'], read),
    tool('merchant_s3_revision', 'Read one exact saved S3 revision and payment/origin choices. Set includeSource explicitly to return its private object locations and credential-provider configuration; credential values are never read.',
      withWorkspace({ revision: revisionSchema, includeSource: { type: 'boolean' } }), ['workspace', 'revision'], read),
    tool('merchant_s3_save', 'Save the complete original S3 source, payment and public origin as one immutable revision. Use expectedRevision=0 for the first save; otherwise use the current head. Reuse operationId after a lost response.',
      withWorkspace({ expectedRevision: { type: 'integer', minimum: 0 }, operationId: operationSchema,
        source: jsonSchema, payment: jsonSchema, origin: { type: 'string', minLength: 1, maxLength: 4096 } }),
      ['workspace', 'expectedRevision', 'operationId', 'source', 'payment', 'origin'], { idempotent: true }),
    tool('merchant_s3_review', 'Select the saved revision’s actual objects with the original S3 HEAD reader and retain their native size/type/ETag/version pins and original compiled service terms. Reuse operationId to recover the same completed selection.',
      withWorkspace({ revision: revisionSchema, operationId: operationSchema }), ['workspace', 'revision', 'operationId'], { idempotent: true, openWorld: true }),
    tool('merchant_s3_review_status', 'Reopen one retained original object-selection review by reviewId. Does not repeat HEAD or regenerate terms.',
      withWorkspace({ reviewId: recordSchema }), ['workspace', 'reviewId'], read),
    tool('merchant_s3_prepare', 'Compile the selected original S3 review into the native SF30 seller and SF82 package. Binds exact revision/review/operation IDs and reuses the original selected object pins without another HEAD.',
      withWorkspace({ revision: revisionSchema, reviewId: recordSchema, operationId: operationSchema }),
      ['workspace', 'revision', 'reviewId', 'operationId'], { idempotent: true }),
    tool('merchant_s3_package', 'Reopen and verify a retained original prepared S3 package, its source digests and complete file identities.',
      withWorkspace({ packageId: recordSchema }), ['workspace', 'packageId'], read),
    tool('merchant_s3_stage', 'Stage the exact prepared S3 package into this merchant’s original SF82 release store using host-configured runtime settings. Continue with merchant_compare, merchant_activate and merchant_start on that same release ID.',
      withWorkspace({ packageId: recordSchema, releaseId: aliasSchema, operationId: operationSchema }),
      ['workspace', 'packageId', 'releaseId', 'operationId'], { idempotent: true }),
    tool('merchant_s3_customer', 'Inspect the selected original S3 release’s exact objects.json and offers.json customer files and hashes. These are the same inputs consumed by the original object buyer.',
      withWorkspace({ releaseId: aliasSchema }), ['workspace', 'releaseId'], read),
    tool('merchant_s3_customer_file', 'Read exact saved customer object/offer bytes, pinned to the SHA-256 from merchant_s3_customer. Continue nextOffset until eof; survives MCP or seller restart without regenerating the files.',
      withWorkspace({ releaseId: aliasSchema, file: { type: 'string', enum: ['objects.json', 'offers.json'] },
        expectedSha256: digestSchema, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 65536 } }),
      ['workspace', 'releaseId', 'file', 'expectedSha256'], read),
  ];
}

export { s3WorkspaceTools, aliasSchema, revisionSchema, operationSchema, jsonSchema, digestSchema };

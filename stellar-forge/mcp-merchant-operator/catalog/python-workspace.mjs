// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$';

const idSchema = { type: 'string', pattern: ID_PATTERN };

const aliasSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const shaSchema = { type: 'string', pattern: '^[0-9a-f]{64}$' };

const generationSchema = { type: 'integer', minimum: 0 };

const reasonSchema = { type: 'string', minLength: 1, maxLength: 240 };

const noteSchema = { type: 'string', maxLength: 2000 };

const fileSchema = { type: 'string', minLength: 1, maxLength: 4096 };

const rangeSchema = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } };

const KINDS = ['revisions', 'previews', 'stages', 'customers'];

function pythonWorkspaceTools(tool) {
  const read = { readOnly: true, idempotent: true };
  const withWorkspace = (properties = {}) => ({ workspace: aliasSchema, ...properties });
  return [
    tool('merchant_python_status', 'List host-declared original Python workspaces, or inspect an opened workspace, current authoring head, native release selection, owned processes and record counts. Does not open or execute Python.',
      { workspace: aliasSchema }, [], read),
    tool('merchant_python_open', 'Open the same saved Python authoring model. Reuses revisions, preview outcomes, native releases and customer exports; does not start Python or a seller.',
      withWorkspace(), ['workspace'], { idempotent: true }),
    tool('merchant_python_close', 'Cancel and drain only this model handle’s previews, stop its owned seller, release its file reads and close its database. Other handles keep their own work.',
      withWorkspace(), ['workspace'], { idempotent: true }),
    tool('merchant_python_revision', 'Inspect a saved revision and its original compiled public functions/payment choices, with a page of file identities. Read exact declaration or source bytes with merchant_python_read.',
      withWorkspace({ id: idSchema, ...rangeSchema }), ['workspace'], read),
    tool('merchant_python_save', 'Save source/helper-file edits, removals, entry selection and/or declaration text as one original immutable authoring revision. Requires the current head; native declaration/source synchronization and revision conflict checks apply. No Python executes.',
      withWorkspace({ baseRevision: idSchema, expectedHead: idSchema, entry: fileSchema, declarationText: { type: 'string', maxLength: 1048576 },
        files: { type: 'array', maxItems: 512, items: { type: 'object', properties: { path: fileSchema, text: { type: 'string' }, base64: { type: 'string' } }, required: ['path'], additionalProperties: false } },
        remove: { type: 'array', maxItems: 512, items: fileSchema }, note: noteSchema }), ['workspace', 'baseRevision', 'expectedHead']),
    tool('merchant_python_restore', 'Restore one retained source revision as a new head with its original ancestry; keeps later revisions and original results available.',
      withWorkspace({ revisionId: idSchema, expectedHead: idSchema, note: noteSchema }), ['workspace', 'revisionId', 'expectedHead']),
    tool('merchant_python_refresh', 'Capture the workspace’s originally selected host declaration and helper directory as a new revision. Imported portable workspaces keep their retained source and do not invent a new host source location.',
      withWorkspace({ expectedHead: idSchema, note: noteSchema }), ['workspace', 'expectedHead']),
    tool('merchant_python_history', 'Page original revisions, previews, stages or customer exports; supply an exact id to inspect its retained record. Source, preview output and customer files use the same chunk reader.',
      withWorkspace({ kind: { enum: KINDS }, id: idSchema, ...rangeSchema }), ['workspace', 'kind'], read),
    tool('merchant_python_preview', 'Run a declared function against an immutable saved revision through the original native Python source. Retain operationId before calling: an equal retry returns the same original job and never repeats execution.',
      withWorkspace({ operationId: idSchema, revisionId: idSchema, function: { type: 'string', minLength: 1, maxLength: 160 },
        input: { type: 'object', additionalProperties: true } }), ['workspace', 'operationId', 'revisionId', 'function', 'input'], { idempotent: true, openWorld: true }),
    tool('merchant_python_cancel', 'Cancel this model handle’s original preview and drain its workers. Completed jobs remain completed; other handles’ workers cannot be cancelled here.',
      withWorkspace({ id: idSchema }), ['workspace', 'id'], { idempotent: true }),
    tool('merchant_python_stage', 'Stage an exact saved revision through the original Python/SF82 release implementation, using only host-declared runtime settings. Retain the release id across an interrupted reply.',
      withWorkspace({ revisionId: idSchema, id: aliasSchema, label: noteSchema }), ['workspace', 'revisionId', 'id'], { idempotent: true }),
    tool('merchant_python_release_review', 'Inspect the exact native candidate, complete terms and original changes against the active or named release; returns the current generation and candidate digest.',
      withWorkspace({ id: aliasSchema, from: { anyOf: [aliasSchema, { type: 'null' }] } }), ['workspace', 'id'], read),
    tool('merchant_python_activate', 'Select the reviewed original release using its exact digest and current selection generation. A currently running seller keeps its old version until explicit restart.',
      withWorkspace({ id: aliasSchema, expectedDigest: shaSchema, expectedGeneration: generationSchema, reason: reasonSchema }),
      ['workspace', 'id', 'expectedDigest', 'expectedGeneration', 'reason']),
    tool('merchant_python_rollback', 'Select a specific retained original release with its inspected digest and current generation; records the original rollback history without discarding later source.',
      withWorkspace({ to: aliasSchema, expectedDigest: shaSchema, expectedGeneration: generationSchema, reason: reasonSchema }),
      ['workspace', 'to', 'expectedDigest', 'expectedGeneration', 'reason']),
    tool('merchant_python_start', 'Start the selected original Python/SF82 seller after checking its exact digest and generation. No paid endpoint is requested.',
      withWorkspace({ expectedDigest: shaSchema, expectedGeneration: generationSchema }), ['workspace', 'expectedDigest', 'expectedGeneration'], { openWorld: true }),
    tool('merchant_python_stop', 'Gracefully stop only the original seller instance owned by this Python model handle.',
      withWorkspace({ instanceId: { type: 'string', minLength: 1, maxLength: 64 } }), ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_python_restart', 'Check the reviewed selection and owned instance, drain the old original seller, then start the selected original release.',
      withWorkspace({ instanceId: { type: 'string', minLength: 1, maxLength: 64 }, expectedDigest: shaSchema, expectedGeneration: generationSchema }),
      ['workspace', 'instanceId', 'expectedDigest', 'expectedGeneration'], { destructive: true, openWorld: true }),
    tool('merchant_python_customer_export', 'Create the original five-file JavaScript/TypeScript/OpenAPI customer export from this owned running seller. Retain the export id; reopening reads the same original files.',
      withWorkspace({ id: aliasSchema, instanceId: { type: 'string', minLength: 1, maxLength: 64 } }), ['workspace', 'id', 'instanceId'], { idempotent: true }),
    tool('merchant_python_export', 'Publish one complete original portable authoring export with its native release history and customer clients. Requires the expected head/generation. The same export id reopens the already-published exact archive even after later edits.',
      withWorkspace({ id: aliasSchema, expectedHead: idSchema, expectedGeneration: generationSchema }), ['workspace', 'id', 'expectedHead', 'expectedGeneration'], { idempotent: true }),
    tool('merchant_python_export_status', 'Read and verify a named original portable export and its exact download metadata. Does not rebuild it or require the Python model to be open.',
      withWorkspace({ id: aliasSchema }), ['workspace', 'id'], read),
    tool('merchant_python_read', 'Read exact retained source, declaration, preview input/output, customer client or portable export bytes through the original verified chunk reader. Resume after restart with the same SHA256 and offset; it never reruns a preview or purchase.',
      withWorkspace({ kind: { enum: ['source', 'declaration', 'preview', 'preview-input', 'customer', 'export'] }, id: idSchema, file: fileSchema,
        readId: { type: 'string', minLength: 1, maxLength: 64 }, expectedSha256: shaSchema,
        offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } }),
      ['workspace', 'kind', 'id'], read),
    tool('merchant_python_read_release', 'Release a verified file snapshot owned by this Python workspace alias. Completed and expired reads need no release.',
      withWorkspace({ readId: { type: 'string', minLength: 1, maxLength: 64 } }), ['workspace', 'readId'], { idempotent: true }),
  ];
}

export { pythonWorkspaceTools, aliasSchema, idSchema, rangeSchema, fileSchema, noteSchema, KINDS, shaSchema, generationSchema, reasonSchema, ID_PATTERN };

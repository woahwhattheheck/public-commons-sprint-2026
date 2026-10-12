// MIT. Original tool metadata; provider runtimes load only when selected.
import { graphqlFileTools } from './graphql-workspace-files.mjs';

const aliasSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const projectSchema = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' };

const uuidSchema = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' };

const shaSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };

const revisionSchema = { type: 'integer', minimum: 1 };

const generationSchema = { type: 'integer', minimum: 0 };

const rangeSchema = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 },
  expectedSnapshotSha256: shaSchema };

const operationSchema = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$' };

const common = { workspace: aliasSchema, project: projectSchema };

const current = { ...common, expectedRevision: revisionSchema };

const deployment = { ...current, deploymentId: uuidSchema };

const textSchema = { type: 'string', minLength: 1, maxLength: 240 };

function graphqlWorkspaceTools(tool) {
  const read = { readOnly: true, idempotent: true };
  return [
    tool('merchant_graphql_status', 'List host-declared original GraphQL workspaces/source aliases or inspect one open workspace and its native runtime. Browser URLs are private operator capabilities.',
      { workspace: aliasSchema }, [], read),
    tool('merchant_graphql_open', 'Open the original GraphQL workspace server and its single kernel-owned writer. Browser and MCP share that same project, preview and release state.',
      { workspace: aliasSchema }, ['workspace'], { idempotent: true }),
    tool('merchant_graphql_close', 'Cancel and drain this owned workspace connection, previews and native release consoles; preserve every saved project/result and original file.',
      { workspace: aliasSchema, instanceId: uuidSchema }, ['workspace', 'instanceId'], { idempotent: true }),
    tool('merchant_graphql_projects', 'Page original saved projects. Repeat expectedSnapshotSha256 when paging a changing list.',
      { workspace: aliasSchema, ...rangeSchema }, ['workspace'], read),
    tool('merchant_graphql_project', 'Inspect an exact saved project revision, optional full raw draft, or a page of its original merchant exports/deployments/previews. Raw unfinished drafts remain available.',
      { ...common, revision: revisionSchema, includeInput: { type: 'boolean' },
        collection: { enum: ['exports', 'deployments', 'previews'] }, ...rangeSchema }, ['workspace', 'project'], read),
    tool('merchant_graphql_history', 'Read the original most-recent 100-revision history window with its native more flag. Open any older retained revision explicitly with merchant_graphql_project.',
      { ...common, ...rangeSchema }, ['workspace', 'project'], read),
    tool('merchant_graphql_schema', 'Page actual captured/supplied schema roots, types, or a selected type’s fields and enum values from an immutable saved revision. The original GraphQL reference compiler validates the source.',
      { ...common, revision: revisionSchema, collection: { enum: ['roots', 'types'] }, type: operationSchema, ...rangeSchema },
      ['workspace', 'project', 'revision'], read),
    tool('merchant_graphql_capture', 'Make one deliberate original introspection request to a host-declared source. Optionally save that exact schema into the selected project at its expected revision; includeSchema controls the full text in the reply. Existing queries, plan and title remain intact.',
      { workspace: aliasSchema, source: aliasSchema, project: projectSchema, expectedRevision: revisionSchema,
        includeSchema: { type: 'boolean' } }, ['workspace', 'source'], { openWorld: true }),
    tool('merchant_graphql_operation', 'Open an existing fixed query as the original field/argument/bounded-variable model, or compile a proposed model without saving. Use merchant_graphql_schema for paged field discovery.',
      { ...common, revision: revisionSchema, operation: operationSchema, model: { type: 'object', additionalProperties: true } },
      ['workspace', 'project', 'revision', 'operation'], read),
    tool('merchant_graphql_apply_operation', 'Compile one original field selection, then atomically save its query and matching plan route name/samples at the expected revision. Keeps price, payment and public-path fields; an invalid raw plan stays intact for repair.',
      { ...current, operation: operationSchema, model: { type: 'object', additionalProperties: true } },
      ['workspace', 'project', 'expectedRevision', 'operation', 'model']),
    tool('merchant_graphql_save', 'Save raw draft field changes through the original immutable revision/CAS store. For a new project use expectedRevision 0 and all four fields; unfinished raw query/plan text is preserved.',
      { ...common, expectedRevision: generationSchema, input: { type: 'object', properties: {
        title: { type: 'string', maxLength: 160 }, schemaText: { type: 'string', maxLength: 1048576 },
        queriesText: { type: 'string', maxLength: 1048576 }, planText: { type: 'string', maxLength: 262144 } }, additionalProperties: false } },
      ['workspace', 'project', 'expectedRevision', 'input']),
    tool('merchant_graphql_review', 'Validate a saved schema/query/merchant plan with the original compiler and inspect its actual routes, variables and payment terms. No source request or seller start.',
      { ...common, revision: revisionSchema }, ['workspace', 'project', 'revision'], read),
    tool('merchant_graphql_preview_start', 'Start one original read-only GraphQL operation against the saved project with a retained preview UUID. Returns immediately; status/result/recover use that same native record, and a started unknown request is never resent automatically.',
      { ...current, source: aliasSchema, previewId: uuidSchema, operation: operationSchema,
        variables: { type: 'object', additionalProperties: true } },
      ['workspace', 'project', 'expectedRevision', 'source', 'previewId', 'operation', 'variables'], { idempotent: true, openWorld: true }),
    tool('merchant_graphql_preview_status', 'Inspect or page original completed/started preview records, their request/response identities and attachment state. Does not repeat a source request.',
      { ...common, previewId: uuidSchema, ...rangeSchema }, ['workspace', 'project'], read),
    tool('merchant_graphql_preview_cancel', 'Request cancellation only of this process-owned preview transport. The original handler retains any returned or cancelled outcome; inspect its same native record afterward.',
      { ...common, previewId: uuidSchema }, ['workspace', 'project', 'previewId'], { idempotent: true }),
    tool('merchant_graphql_preview_recover', 'Attach an already completed native preview to the current project without another provider request. Its original source revision/digest remain explicit even after later draft edits.',
      { ...current, previewId: uuidSchema }, ['workspace', 'project', 'expectedRevision', 'previewId'], { idempotent: true }),
    tool('merchant_graphql_preview_result', 'Page a selected JSON pointer in the actual retained response, preserving the exact response hash. Download original response bytes with the retained-file tools; this structured view never reruns the query.',
      { ...common, previewId: uuidSchema, pointer: { type: 'string', maxLength: 2048 }, ...rangeSchema },
      ['workspace', 'project', 'previewId'], read),
    tool('merchant_graphql_prepare', 'Prepare the original complete merchant and generated buyer package from the current reviewed saved project. On a lost reply inspect project/history before another preparation.',
      { ...current, source: aliasSchema }, ['workspace', 'project', 'expectedRevision', 'source']),
    tool('merchant_graphql_evolution', 'Compare a saved candidate with its retained baseline merchant or read an already prepared original revision report. Comparison returns the exact digest required by prepare_revision.',
      { ...current, baselineExportId: uuidSchema, reportExportId: uuidSchema },
      ['workspace', 'project', 'expectedRevision'], read),
    tool('merchant_graphql_prepare_revision', 'Prepare the original revised merchant, exact baseline copy and buyer handoff using the current saved draft and inspected comparison digest.',
      { ...current, source: aliasSchema, baselineExportId: uuidSchema, comparisonDigest: shaSchema },
      ['workspace', 'project', 'expectedRevision', 'source', 'baselineExportId', 'comparisonDigest']),
    tool('merchant_graphql_deployment', 'Prepare or continue the original deployment: prepare a merchant export, stage a native release with host runtime settings, generate a host-declared installation packet, or recover its finished attachment.',
      { ...current, action: { enum: ['prepare', 'stage', 'host', 'recover'] }, source: aliasSchema,
        exportId: uuidSchema, deploymentId: uuidSchema, releaseId: aliasSchema, label: textSchema, host: aliasSchema },
      ['workspace', 'project', 'expectedRevision', 'action']),
    tool('merchant_graphql_deployment_status', 'Inspect the original deployment generation, source identity, staged release, host readiness and any finished unattached continuation.',
      { ...common, deploymentId: uuidSchema }, ['workspace', 'project', 'deploymentId'], read),
    tool('merchant_graphql_release_status', 'Inspect the original project release console or compare two retained native releases. Browser handover uses that same console and seller owner.',
      { ...deployment, to: aliasSchema, from: aliasSchema }, ['workspace', 'project', 'expectedRevision', 'deploymentId'], read),
    tool('merchant_graphql_release_change', 'Activate, roll back, start, stop or restart through the original release console. Changes bind the inspected immutable digest/current generation; stop/restart require that console’s exact instance ID.',
      { ...deployment, action: { enum: ['activate', 'rollback', 'start', 'stop', 'restart'] },
        releaseId: aliasSchema, expectedDigest: shaSchema, expectedGeneration: generationSchema,
        reason: textSchema, instanceId: { type: 'string', minLength: 1, maxLength: 64 } },
      ['workspace', 'project', 'expectedRevision', 'deploymentId', 'action']),
    ...graphqlFileTools(tool),
  ];
}

export { graphqlWorkspaceTools, aliasSchema, uuidSchema, rangeSchema, common, revisionSchema, operationSchema, projectSchema, current, generationSchema, shaSchema, textSchema, deployment };

// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const HASH = /^[a-f0-9]{64}$/;

const downloads = ['dataset.csv', 'dataset.json', 'seller.json', 'source.json', 'binding.json',
  'arcgis-receiving.json', 'release-receiving.json'];

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const uuid = { type: 'string', pattern: UUID.source };

const hash = { type: 'string', pattern: HASH.source };

const text = { type: 'string', minLength: 1, maxLength: 240 };

const integer = { type: 'integer', minimum: 0 };

const read = { readOnly: true, idempotent: true };

const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const querySchema = object({ where: { type: 'string', minLength: 1, maxLength: 8192 },
  outFields: { type: 'array', minItems: 1, maxItems: 4096, uniqueItems: true, items: { type: 'string', minLength: 1 } },
  returnGeometry: { type: 'boolean' } });

const filesSchema = object({ metadata: uuid, pages: { type: 'array', minItems: 1, maxItems: 4096, items: uuid },
  geometryPages: { type: 'array', minItems: 1, maxItems: 4096, items: uuid },
  geometryField: text, representation: { enum: ['parsed-json', 'wire-json'] } }, ['metadata', 'pages']);

const columnsSchema = { type: 'object', minProperties: 1, maxProperties: 64, additionalProperties: {
  oneOf: [object({ field: text }, ['field']),
    object({ source: { enum: ['attributes', 'geometry', 'spatialReference'] } }, ['source'])] } };

function arcgisWorkspaceTools(tool) {
  const scoped = properties => ({ workspace: alias, workbenchId: uuid, ...properties });
  return [
    tool('merchant_arcgis_status', 'List host-declared ArcGIS workspaces or inspect an open original workbench. Source captures, immutable editions, deployments and request IDs are shared with its browser and merchant_publisher tools. Status does not open a publisher or start its scheduler.',
      scoped({ limit: { type: 'integer', minimum: 1, maximum: 100 },
        capturesOffset: integer, editionsOffset: integer, deploymentsOffset: integer }), [], read),
    tool('merchant_arcgis_open', 'Open or reuse the ArcGIS workbench attached to the declared original merchant publisher. One publisher object, workspace lease and scheduler serve both agent commands and the borrowed browser. Returns workbenchId and the current process instance IDs.',
      { workspace: alias }, ['workspace'], { idempotent: true, openWorld: true }),
    tool('merchant_arcgis_close', 'Close this exact workbench instance and drain its browser, source operation and retained file reads. The owning merchant publisher and its schedule remain open. Use merchant_publisher_close to close that owner and every attached workbench.',
      { workspace: alias, instanceId: uuid }, ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_arcgis_source', 'Inspect a host-declared original JSON file and its SHA-256, upload those exact bytes into the native workbench, or remove a completed ingress copy. Upload requires file alias, requestId and inspected expectedSha256. Remove requires uploadId and expectedSha256. Source files and credentials cannot be selected by client path.',
      scoped({ action: { enum: ['inspect', 'upload', 'remove-upload'] }, file: alias,
        requestId: uuid, uploadId: uuid, expectedSha256: hash }), ['workspace', 'workbenchId', 'action']),
    tool('merchant_arcgis_capture', 'Prepare a named live or retained-file capture, continue or pause its original request, or inspect its native fields and sample. Prepare selects a host profile plus exact ArcGIS query; files mode selects retained upload IDs for metadata and ordered pages. Continue retains the original capture and page progress. Every mutation uses a client-retained requestId.',
      scoped({ action: { enum: ['prepare', 'continue', 'pause', 'inspect'] }, requestId: uuid,
        captureId: uuid, title: text, mode: { enum: ['live', 'files'] }, profile: alias,
        query: querySchema, files: filesSchema, maxPages: { type: 'integer', minimum: 1, maximum: 4096 } }),
      ['workspace', 'workbenchId', 'action'], { openWorld: true }),
    tool('merchant_arcgis_edition', 'Create an immutable reviewed mapping from a complete capture, inspect a retained source edition, or select it against the current source revision. Create requires the actual capture SHA-256 and explicit public columns. Geometry and spatial reference remain original Esri JSON. Selection does not publish a dataset.',
      scoped({ action: { enum: ['create', 'inspect', 'select'] }, requestId: uuid, captureId: uuid,
        expectedCaptureSha256: hash, title: text, query: { type: 'string', minLength: 1, maxLength: 48 },
        columns: columnsSchema, editionId: uuid, expectedRevision: integer }), ['workspace', 'workbenchId', 'action']),
    tool('merchant_arcgis_request', 'Read the original retained ArcGIS request by its exact UUID. RUNNING, PAUSED, INTERRUPTED, FAILED and SUCCEEDED are native states. After a lost response inspect this record, then explicitly resend the same operation and input only if continuation is needed.',
      scoped({ requestId: uuid }), ['workspace', 'workbenchId', 'requestId'], read),
    tool('merchant_arcgis_deployment', 'Export the complete native delivery package for an already published run and retained seller upload, stage that package in the host release store, or inspect its files and hashes. Stage uses only the host runtime declaration. Original release controls govern activation; export and stage do not start another publisher or pay a buyer.',
      scoped({ action: { enum: ['export', 'stage', 'inspect'] }, requestId: uuid,
        runId: uuid, sellerUploadId: uuid, label: text, deploymentId: uuid, releaseId: alias }),
      ['workspace', 'workbenchId', 'action']),
    tool('merchant_arcgis_file', 'Read an original deployment file in SHA-256-bound chunks. First read verifies the native package and retains one immutable snapshot. Continue with readId, expectedSha256 and nextOffset; EOF releases it. The scope accepts four reads and 256 MB of verified snapshots. Original package files remain unchanged.',
      scoped({ deploymentId: uuid, filename: { enum: downloads }, expectedSha256: hash, readId: uuid,
        offset: integer, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } }),
      ['workspace', 'workbenchId', 'deploymentId', 'filename'], read),
    tool('merchant_arcgis_file_release', 'Release a selected unfinished original deployment-file read without deleting the deployment.',
      scoped({ readId: uuid }), ['workspace', 'workbenchId', 'readId'], { idempotent: true }),
    tool('merchant_arcgis_browser', 'Open or close the industrial browser on this same publisher, workbench and scheduler. A repeated open reuses its existing listener. Closing the browser drains only its listener and active responses; agent tools and retained source work remain available.',
      scoped({ action: { enum: ['open', 'close'] }, port: { type: 'integer', minimum: 0, maximum: 65535 } }),
      ['workspace', 'workbenchId', 'action']),
    tool('merchant_arcgis_release_console', 'Open the original release controls for this workspace after a deployment is staged. Returns the live private local URL; the durable request stores its nonsecret result. Reuses the current original console. A fresh open request is needed after the workbench has closed.',
      scoped({ requestId: uuid }), ['workspace', 'workbenchId', 'requestId']),
  ];
}

export { arcgisWorkspaceTools, alias, uuid, integer, read, hash, text, querySchema, filesSchema, columnsSchema, downloads, UUID, HASH, object };

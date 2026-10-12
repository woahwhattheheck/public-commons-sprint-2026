# Huwise Automation API client

This module operates the real Huwise / Opendatasoft Automation v1.0 API for a host-configured portal. It manages the dataset definition, resource extraction, metadata, processing, access rules, schedules, publication and the provider's saved versions. The adjacent workbench owns reviewed plans, durable state and the final Explore capture.

## Authoritative source

The current [Huwise Automation v1.0 reference](https://developer.huwise.com/apis/automation/v1.0/index.html), reviewed on 2026-10-12, supplies the current dataset, metadata, resource-file and translation behavior. [current-reference.json](./current-reference.json) records each applied correction, its method/path and official section. These corrections take precedence over the older SDK snapshot.

The complete original [Opendatasoft Automation SDK](https://github.com/opendatasoft/opendatasoft-automation-sdk) specification is also retained unmodified as [upstream-openapi.json](./upstream-openapi.json), with its original [MIT license](./UPSTREAM_LICENSE):

- Commit: `d8111887796815a7a2cf0755033a809b0f3f757e`.
- Path: `generators/python/openapi/openapi_3.1.0_original.json`.
- Git blob: `568f4b4b3b9414dc404ea8fac83f35bfabf6bfcd`.
- Original bytes: 461,135.
- SHA256: `27065299b52ec6c8e71272981f912107ff6931d1276fab7bb15a5a0de1de7d3b`.

That SDK snapshot contains 105 paths and 115 schemas. The active client exposes 92 operations and the complete referenced request definitions. Ninety registry IDs come from the retained SDK. The two translation keys identify the exact current documented GET/POST routes and are explicitly marked as client keys; the rendered reference does not expose their original OpenAPI IDs. The metadata-field listing additionally accepts the current documentation's `list-metadata-template-fields` alias.

The original SDK is a reproducible source artifact. Its fixed default-metadata requirements and resource-upload HTTP 200 response have been superseded in the active contract by the current reference. The client accepts the older documented upload 200 response as a compatibility case while accepting current 201 normally. Optional native response fields remain preserved.

## Host configuration and lifetime

The client imports the existing workbench's exact JSON parser from `../capture.mjs` and its original file utilities. Run it with the maintained workbench's Node runtime; the original parser uses `JSON.rawJSON` and reviver source context to preserve large numeric tokens. There are no extra package dependencies in this client.

```js
import {
  createOpendatasoftAutomationClient,
  OpendatasoftAutomationError
} from './client.mjs';

const client = createOpendatasoftAutomationClient({
  origin: 'https://your-portal.example',
  authTokenEnv: 'HUWISE_AUTOMATION_API_KEY',
  env: process.env,
  timeoutMs: 60000,
  maxResponseBytes: 64 * 1024 * 1024,
  maxRequestBytes: 16 * 1024 * 1024,
  maxUploadBytes: 1024 * 1024 * 1024
});

try {
  const reply = await client.getDataset({ datasetUid: savedTargetUid });
  await retainResponse(reply);
} finally {
  await client.close();
}
```

The API key is resolved from the host environment for each operation and sent as `Authorization: apikey …`. The configured origin is one HTTPS portal origin; requests cannot supply another tenant, credential, arbitrary URL path or request header. Host configuration, rather than browser or MCP input, selects the connection. Request receipts contain the credential-free request binding and retain the original provider response headers.

`close()` aborts this client's outstanding requests and status waits, then joins their completion. It does not close a global fetch dispatcher or another client's work. Cancelling a local observer does not call the provider's abort endpoint.

Every native operation is dispatched once. Redirects are returned without following them, so the key stays at the configured origin. There is no automatic mutation retry, including after a timeout, 429, 5xx or response-save failure. The retained workbench decides continuation using actual provider readback.

## Methods and complete results

Every convenience method uses named inputs and the same second options object:

```js
await client.getDataset({ datasetUid }, options);
await client.createDataset({ body: reviewedDataset }, options);
await client.updateDataset({ datasetUid, body: reviewedDatasetConfiguration }, options);
await client.createResource({ datasetUid, body: reviewedResource }, options);
await client.publishDataset({ datasetUid }, options);
```

The generic form accepts the registry operation key:

```js
await client.invoke('update-dataset', {
  params: { dataset_uid: datasetUid },
  body: reviewedDatasetConfiguration
}, options);
```

JSON responses return:

```js
{
  raw: Buffer,       // complete bytes from the fetch response body
  value,            // exact original parsed object/array, or null for an empty body
  receipt           // method, URL, status, headers, times, hash, size and outcome
}
```

Optional provider fields and native result unions remain intact. The client does not project a response into a smaller display shape. `value` uses the existing exact-number representation when a native numeric token would be rounded by ordinary JavaScript parsing. Retain `raw` for exact replay/export; use the original parser/serializer for subsequent JSON operations.

JSON request bodies may be complete JavaScript objects or `Uint8Array` containing the reviewed JSON bytes. Byte input is parsed for structural validation and dispatched without reserialization. Object input rejects non-JSON values and preserves the existing exact-number representation. Structural checks enforce the retained required fields, primitive types, unions, discriminators and documented bounds while keeping optional provider-specific fields. The current reference corrections and retained SDK definitions identify the source of each structural check; the provider performs its own final validation.

### Request and response journals

The callbacks are awaited. `onRequest` must finish before the HTTP dispatch, allowing the workbench to retain the exact planned operation first:

```js
const options = {
  signal: abortController.signal,
  async onRequest(request) {
    await journalRequest(request);
  },
  async onResponse(reply) {
    await journalResponse(reply.raw, reply.receipt, reply.value, reply.file);
  }
};
```

A request record contains:

```js
{
  schema: 'stellar-forge.opendatasoft-automation-request.v1',
  operationId, method, url,
  contentType, bodyBytes, bodySha256,
  upload: { filename, mimetype, bytes, sha256 }, // only for multipart
  sha256, preparedAt
}
```

The request `sha256` binds the JSON serialization of `{operationId, method, url, contentType, bodyBytes, bodySha256, upload?}`, excluding its timestamp. Multipart `bodySha256` binds the exact generated boundary and wire body; `upload.sha256` independently binds the complete original file. Retain the reviewed source/body alongside the request, since a digest does not contain its source bytes.

A receipt contains:

```js
{
  schema: 'stellar-forge.opendatasoft-automation-receipt.v1',
  operationId, method, url, request,
  sentAt, receivedAt, completedAt,
  status, headers, effect, outcome,
  bodyRepresentation: 'fetch-response-body',
  bytes, sha256, complete,
  uploadVerified // only for multipart
}
```

The callback runs for a complete HTTP error as well as success. An interrupted response supplies its actually received prefix with `complete:false` and the prefix's exact hash and size. Native fetch can transparently decode a compressed body; `bodyRepresentation` states what was hashed while `headers` retains the provider's original content-encoding.

A failed request callback prevents dispatch. A failed response callback throws an error containing the already received `response` and original receipt, so the workbench can retain those same bytes through its recovery path.

## Dataset identity and complete preimage

The native dataset UID is the immutable path identity. `dataset_id` is the human identifier used by Explore; the provider permits changing it while unpublished. Keep both identities in a reviewed plan.

The current native create schema requires `metadata`. Its structural minimum is `{metadata:{}}`; a reviewed publication should supply useful descriptive values and an explicit dataset ID/access choice:

```js
{
  dataset_id: reviewedDatasetId,
  is_restricted: reviewedAccessChoice,
  metadata: {
    default: {
      title: { value: reviewedTitle },
      language: { value: 'en' }
    },
    reviewed_custom_template: {
      original_source: { value: reviewedSourceReference }
    }
  }
}
```

Template names and field requirements come from the actual portal. The client preserves arbitrary template names and exact JSON metadata values. The current create schema does not require fixed `default.title`, `default.modified` or `default.language` entries. Include source dates when they have a real source value and meaning.

Dataset configuration and metadata use separate operations:

```js
await client.updateDataset({
  datasetUid,
  body: reviewedDatasetConfiguration // dataset_id, is_restricted, default_security
}, options);

await client.updateMetadata({
  datasetUid,
  body: reviewedCompleteMetadata
}, options);
```

`updateDataset` uses PUT on the dataset and accepts its configuration properties. A `metadata` key is rejected locally with `ODS_AUTOMATION_BODY_ENDPOINT_MISMATCH` before dispatch, directing the caller to the dedicated metadata operation. Retain the actual complete preimage and explicitly review the resulting configuration. Dataset GET also includes read-only `uid`, `created_at`, `updated_at`, `created_by`, `updated_by` and `is_published`.

`updateMetadata` replaces the full metadata dictionary; omitted fields are removed. Its HTTP 200 result is the complete metadata dictionary, rather than a Dataset or an action acknowledgment. `updateMetadataTemplate` replaces only the selected template and removes omitted fields there. The single-field helper `updateMetadataField` requires `value` and supports `override_remote_value`. Receive and retain the provider's `remote_value` as well; it is read-only in the writable metadata shape.

The `DatasetMetadata` schema remains a generic template → field → metadata-value dictionary, and `Metadata` aliases it. The actual full/template PUT bodies are open JSON objects in the current reference. The client keeps those permissive native schemas; the reviewed workspace uses the complete dictionary shape to preserve existing templates and writable override controls.

For a full publication review, receive the following original configuration:

| Authority | Convenience method | Complete receiving behavior |
| --- | --- | --- |
| Dataset definition | `getDataset` | Keep the full body, UID, human ID and source fields. |
| Native state | `getDatasetStatus` | Keep all status, previous/next, since, errors and params. |
| Metadata | `getMetadata` | Keep every template, original value and override control. |
| Portal template definitions | `listMetadataTemplates`, `getDomainMetadataTemplate`, `listMetadataTemplateFields` | Receive the portal's real templates, fields, requirement levels and choices. |
| Translations | `getDatasetTranslations` | Keep the original term/language dictionary used when localized content is published. |
| Resources | `listResources` | Follow every native page; preserve native order and full datasource configuration. |
| Ordered fields | `listFields` | Follow the actual returned next URL; retain original field positions. |
| Ordered processors | `listProcessors` | Follow the actual returned next URL; retain processing order and complete params. |
| User rules | `listUserSecurity` | Receive every page of the actual dataset rules. |
| Group rules | `listGroupSecurity` | Receive every page of the actual dataset rules. |
| Schedules | `listSchedules` | Receive every page and preserve enabled state, timing and time zone. |
| Attachments and exports | `listAttachments`, `listAlternativeExports` | Retain selected full configuration and native file bytes. |
| Connections | `getConnection` / `listConnections` | Resolve the connection UIDs actually referenced by reviewed resources. |
| Provider versions | `listVersions` / `getVersion` | Preserve the versions the provider returns; the native list is limited to the latest 20. |

The current user/group ruleset permission values are retained in `current-reference.json`, including dataset, connection, page and form permissions. Preserve the complete returned ruleset when changing one part of it; the active contract accepts the current values.

Some connection/security readbacks require the matching tenant permissions. A partial preimage must remain partial in the plan instead of becoming an empty configuration replacement.

The resource list's documented `expand` value can be `datasource.connection` or `datasource.dataset`. Keep the actual native datasource and reference identity even when using expansion.

## Upload the complete source, then attach its actual returned identity

`uploadFile` posts multipart/form-data to the dataset's resource-file endpoint. The multipart part name is exactly `file`. The current success is HTTP 201 and the complete response includes `{uid, filename, mimetype, created_at}`. The client also accepts the retained SDK's documented HTTP 200 response. Attach the actual returned UID.

```js
const uploaded = await client.uploadFile({
  datasetUid,
  file: immutableCaptureRecordsPath,
  filename: reviewedUniqueFilename,
  mimetype: 'application/json',
  expectedSha256: originalRecordsSha256,
  expectedBytes: originalRecordsBytes
}, options);

const resource = {
  type: 'jsonfile',
  title: reviewedResourceTitle,
  datasource: {
    type: 'uploaded_file',
    file: { uid: uploaded.value.uid }
  }
};

const preview = await client.previewResourceInput({
  datasetUid,
  body: {
    datasource: resource.datasource,
    type: resource.type
  }
}, options);

await client.createResource({ datasetUid, body: resource }, options);
```

The current Resource create/update schema requires `type` and `title`; `params`, `url` and `datasource` are optional in that generic schema. An uploaded-source plan supplies its actual `uploaded_file` datasource explicitly. Unsaved extractor guessing and preview still require their documented `datasource`/`type` inputs. Preserve the full native extractor and datasource configuration in the plan.

The file path must name an absolute regular file. The client opens and retains its descriptor, verifies identity and complete bytes before dispatch, streams it in 64 KiB chunks, then verifies the streamed hash and file identity before sending the multipart terminator. Optional expected hash and size bind it to the original reviewed capture. A `Uint8Array` input is copied before dispatch. Neither mode rewrites source records or rounds numeric tokens.

Use `listExtractors`, `guessExtractors`, `guessExtractorParams` and `previewResourceInput` to discover the provider's actual parser and parameters. A preview covers at most the provider's preview rows; final receiving uses the complete Explore export. The saved-resource helper is named `guessSavedResourceExtractorParams`; its native path uses the provider's plural `guess_extractors_params` spelling.

HTTP ingestion can reference an existing native HTTP connection:

```js
{
  type: reviewedExtractorType,
  title: reviewedResourceTitle,
  datasource: {
    type: 'http',
    connection: { uid: existingConnectionUid },
    relative_url: reviewedRelativeSourceUrl,
    headers: reviewedSourceHeaders
  },
  params: reviewedExtractorParameters
}
```

Use only the actual source connector and approved headers. Connection credentials remain in the host's existing connection configuration and protected native receiving state.

### Complete file receiving

`downloadFile`, `downloadAttachment` and `downloadAlternativeExport` return complete in-memory binary bytes by default. For large selected files, pass an absolute new `destination`:

```js
const received = await client.downloadFile({
  datasetUid,
  fileUid,
  destination: receivingFilePath,
  expectedSha256: optionalExpectedHash,
  expectedBytes: optionalExpectedSize
}, options);
```

The destination is created exclusively with mode 0600 and is never overwritten. It is streamed, hashed and fsynced. The result uses:

```js
{
  raw: null, value: null,
  file: { path, bytes, sha256, complete },
  receipt
}
```

On interruption, the same file retains its actually written prefix and `complete:false`. A hash mismatch keeps the complete received bytes for inspection and throws the binding error. HTTP error bodies remain in `response.raw`, even when a successful binary download would have used a destination.

An alternative export may return the documented 303 response. Its original Location is retained and no redirect is followed. A separate reviewed transfer can receive that external file without forwarding the Automation key.

## Portal metadata definitions and translations

The standard dataset templates are `default`, `visualization`, `internal` and `asset_content_configuration`. Additional templates depend on portal configuration. Discover the actual complete definitions before constructing a custom metadata plan:

```js
const templates = await client.collect('list-metadata-templates', {
  query: { is_active: true, limit: 1000 }
}, options);

const fields = await client.collect('get-metadata-fields-list', {
  params: { template_name: reviewedTemplateName },
  query: { limit: 1000 }
}, options);
```

`listMetadataTemplates({query}, options)` and `listMetadataTemplateFields({templateName,query}, options)` return individual full pages. `getDomainMetadataTemplate({templateName}, options)` and `getMetadataTemplateField({templateName,templateFieldName}, options)` retrieve a complete definition. The current prose identifier `list-metadata-template-fields` aliases the retained SDK key `get-metadata-fields-list` in generic calls.

`getDatasetTranslations({datasetUid}, options)` retrieves the current translation dictionary. `updateDatasetTranslations({datasetUid,body}, options)` uses the documented POST route; its body maps original terms to language dictionaries. Both return the complete dictionary with HTTP 200. The reference describes an update, so the client does not assume undocumented patch, replacement or deletion semantics. Retain the original translation dictionary, review the intended complete change and compare the actual readback before publication.

## Full pagination and ordered configuration

The normal list methods return one complete provider page. A metadata-only request with `limit:0` is supported only by endpoints that advertise it. A complete collection requires actual result pages.

```js
const resources = await client.collect('list-dataset-resources', {
  params: { dataset_uid: datasetUid },
  query: { limit: 1000 }
}, {
  ...options,
  maxPages: 10000,
  maxResults: 1000000,
  maxBytes: 64 * 1024 * 1024
});

for await (const page of client.paginate('list-dataset-field-configurations', {
  params: { dataset_uid: datasetUid }
}, options)) {
  await retainOrderedFieldPage(page);
}
```

Fields and processors have paginated responses even though the pinned specification does not advertise initial limit/offset inputs. Their helpers issue the documented first request, then follow the returned same-origin, same-path next URL. Initial convenience methods do not invent unsupported query parameters.

`followPage(nextUrl, {expectedOperationId, params, query?}, options)` gives the workbench explicit journal control. It permits only the original collection and filters plus native limit/offset continuation values. `paginate` also detects repeated/nonadvancing pages. Bound exhaustion throws with the actual continuation or received page; it never marks a truncated collection complete.

`collect` returns `{results, pages, totals, bytes, complete:true}`. Each page includes its original bytes and receipt; `totals` preserves each native total_count value as returned, including a string or null. Use `paginate` when receiving a larger collection directly into durable storage.

## Publication, status and recovery

`publishDataset`, `publishDatasetMetadata`, `abortDataset` and `unpublishDataset` acknowledge with HTTP 200 and `{detail:"ok"}`. The acknowledgment contains no job ID. Publication and processing continue asynchronously at the dataset.

Before dispatch, retain the actual prior status. After the acknowledgment, observe the same dataset:

```js
const before = await client.getDatasetStatus({ datasetUid }, options);
const accepted = await client.publishDataset({ datasetUid }, options);
const observed = await client.waitForDatasetStatus({
  datasetUid,
  baseline: before.value,
  requireTransition: true,
  expectedPublished: true,
  intervalMs: 2000,
  maxWaitMs: 300000
}, options);
```

The baseline prevents an unchanged earlier idle publication from being accepted as this operation's completion. A transition compares the original status, previous, next, since and is_published fields. Very fast provider processing can finish between observations; retain all readbacks and compare the final configuration and complete Explore result with the reviewed source.

Known native states are `idle`, `error`, `limit_reached`, `queued`, `aborting_processing`, `processing`, `deleting` and `saving_version`. An idle state with a non-null next state remains running. Unknown states and all native errors/params stay in the original response.

The waiter returns the latest full response, observations, transitionObserved and classified state. Its outcome is `IDLE`, `IDLE_WITH_RECORD_ERRORS`, `ERROR`, `LIMIT_REACHED`, `UNKNOWN_STATE` or `WAITING`. A local deadline returns WAITING with the actual latest state; it does not alter provider processing. `records_errors` stays available for actual rejected-row investigation.

The workbench then captures the complete published dataset with its existing Explore capture engine, including opening/closing metadata and the full original export. Retain the original dataset/configuration/source identities with that receiving result.

### Interrupted mutation decisions

| Observed state | Retained interpretation | Native continuation |
| --- | --- | --- |
| Local validation or request journal failed | `NOT_SENT` | Correct the exact source/configuration or journal issue, then prepare the same reviewed operation. |
| Successful write/action acknowledgment | `ACKNOWLEDGED` | Read back the actual target; for publication, receive status and the complete Explore export. |
| Explicit 4xx/native rejection | `REJECTED` | Retain the full error and correct the exact provider-reported condition. |
| Write transport loss, timeout, 5xx or incomplete successful response | `UNCERTAIN` | Compare current native state with the retained before-state and intended after-state before deciding another mutation. |
| Response-save callback failed | Original observed outcome plus full response | Retain the original reply through recovery, then adopt/read back that exact operation. |
| Upload acknowledgment lost | `UNCERTAIN`; source hash remains known | Probe the original reviewed filename only as a native lookup candidate, then adopt the actual returned file UID after complete downloaded-byte/hash readback. |
| Existing prior idle status is unchanged | `WAITING` when a transition is required | Continue status/configuration and Explore receiving against the original target. |

Creating a dataset can be reconciled by the exact reviewed human dataset ID and the full current definition; do not adopt a different source/configuration that happens to have a matching title. Resource/field/processor updates need the exact reviewed native UID and full configuration. The provider does not advertise an idempotency key for these mutation endpoints.

Native versions and recovered resources are explicit provider actions. `restoreVersion`, `recoverResource`, `deleteRecoveredResourceData`, `abortDataset` and `unpublishDataset` remain separately selected reviewed operations. The client never invokes them as an automatic response to a transport error. Aborting processing can leave already processed rows available through Explore; unpublishing removes Explore availability while retaining the dataset definition.

## Errors and receiving limits

Catch `OpendatasoftAutomationError` and retain `error.response` before rendering a concise message. The error contains `code`, `message`, `outcome`, `category`, the original `request`, `receipt`, and complete `response` where received. A native `error_code` is available as `providerCode`; Retry-After is interpreted as `retryAfterMs`. The compact `toJSON()` deliberately does not duplicate the raw response body.

Default per-request limits are 60 seconds, 64 MiB response, 16 MiB JSON request and 1 GiB uploaded/downloaded file. A bound failure retains the actual request/received prefix and throws. Increase a host-configured bound only when the original reviewed operation requires it; a response bound is not permission to discard remaining rows.

The source contract contains a few published schema inconsistencies which receiving preserves: PaginatedResults describes total_count as string/null while native examples include integers; the status is_published union contains a JSON null entry; one GET security operation has an erroneous requestBody entry; and the connection sort description allows a descending '-' prefix omitted by its enum. The client accepts actual total values, treats native status booleans/null directly, never sends a GET body, and permits the documented descending sort prefix.

## Native operation reference

All paths below are relative to `/api/automation/v1.0`. The operation key is accepted by `invoke`, `paginate`, `collect` and `followPage`. Convenience methods translate named IDs to exact snake_case path parameters. Original SDK keys are retained; the two translation keys are identified separately in `current-reference.json`.

| Method | Native path | Operation key | Convenience method |
| --- | --- | --- | --- |
| GET | `/datasets/` | `list-datasets` | `listDatasets` |
| POST | `/datasets/` | `create-dataset` | `createDataset` |
| GET | `/datasets/{dataset_uid}/` | `retrieve-dataset` | `getDataset` |
| PUT | `/datasets/{dataset_uid}/` | `update-dataset` | `updateDataset` |
| DELETE | `/datasets/{dataset_uid}/` | `delete-dataset` | `deleteDataset` |
| POST | `/datasets/{dataset_uid}/publish/` | `publish-dataset` | `publishDataset` |
| POST | `/datasets/{dataset_uid}/publish_metadata/` | `publish-dataset-metadata` | `publishDatasetMetadata` |
| POST | `/datasets/{dataset_uid}/abort/` | `abort-dataset` | `abortDataset` |
| POST | `/datasets/{dataset_uid}/unpublish/` | `unpublish-dataset` | `unpublishDataset` |
| POST | `/datasets/{dataset_uid}/copy/` | `copy-dataset` | `copyDataset` |
| GET | `/datasets/{dataset_uid}/status/` | `get-dataset-status` | `getDatasetStatus` |
| GET | `/datasets/{dataset_uid}/feedbacks/` | `list-dataset-feedbacks` | `listFeedbacks` |
| GET | `/datasets/{dataset_uid}/feedbacks/{feedback_uid}/` | `retrieve-dataset-feedback` | `getFeedback` |
| POST | `/datasets/{dataset_uid}/feedbacks/{feedback_uid}/archive/` | `archive-dataset-feedback` | `archiveFeedback` |
| GET | `/datasets/{dataset_uid}/fields/` | `list-dataset-field-configurations` | `listFields` |
| POST | `/datasets/{dataset_uid}/fields/` | `create-dataset-field-configurations` | `createField` |
| GET | `/datasets/{dataset_uid}/fields/{field_uid}/` | `retrieve-dataset-field-configuration` | `getField` |
| PUT | `/datasets/{dataset_uid}/fields/{field_uid}/` | `update-dataset-field` | `updateField` |
| DELETE | `/datasets/{dataset_uid}/fields/{field_uid}/` | `destroy-dataset-field-configurations` | `deleteField` |
| GET | `/datasets/{dataset_uid}/processors/` | `list-dataset-processors` | `listProcessors` |
| POST | `/datasets/{dataset_uid}/processors/` | `create-dataset-processor` | `createProcessor` |
| GET | `/datasets/{dataset_uid}/processors/{processor_uid}/` | `retrieve-dataset-processor` | `getProcessor` |
| PUT | `/datasets/{dataset_uid}/processors/{processor_uid}/` | `update-dataset-processor` | `updateProcessor` |
| DELETE | `/datasets/{dataset_uid}/processors/{processor_uid}/` | `delete-dataset-processor` | `deleteProcessor` |
| GET | `/extractors/` | `list-extractors` | `listExtractors` |
| GET | `/datasets/{dataset_uid}/resources/` | `list-dataset-resources` | `listResources` |
| POST | `/datasets/{dataset_uid}/resources/` | `create-dataset-resource` | `createResource` |
| POST | `/datasets/{dataset_uid}/resources/guess_extractors/` | `guess-unsaved-resource-extractors` | `guessExtractors` |
| POST | `/datasets/{dataset_uid}/resources/guess_extractor_params/` | `guess-unsaved-resource-extractor-params` | `guessExtractorParams` |
| POST | `/datasets/{dataset_uid}/resources/preview/` | `resource-unsaved-preview` | `previewResourceInput` |
| GET | `/datasets/{dataset_uid}/resources/{resource_uid}/` | `retrieve-dataset-resource` | `getResource` |
| PUT | `/datasets/{dataset_uid}/resources/{resource_uid}/` | `update-dataset-resource` | `updateResource` |
| DELETE | `/datasets/{dataset_uid}/resources/{resource_uid}/` | `delete-dataset-resource` | `deleteResource` |
| GET | `/datasets/{dataset_uid}/resources/{resource_uid}/guess_extractors/` | `resource-guess-extractors` | `guessSavedResourceExtractors` |
| POST | `/datasets/{dataset_uid}/resources/{resource_uid}/clean_cache/` | `clean-resource-cache` | `clearResourceCache` |
| GET | `/datasets/{dataset_uid}/resources/{resource_uid}/guess_extractors_params/` | `resource-guess-extractor-params` | `guessSavedResourceExtractorParams` |
| GET | `/datasets/{dataset_uid}/resources/{resource_uid}/preview/` | `resource-preview` | `previewResource` |
| POST | `/datasets/{dataset_uid}/resources/{resource_uid}/recover/` | `recover-resource` | `recoverResource` |
| POST | `/datasets/{dataset_uid}/resources/{resource_uid}/delete_recover_data/` | `delete-recover-data-resource` | `deleteRecoveredResourceData` |
| POST | `/datasets/{dataset_uid}/resources/{resource_uid}/enable/` | `enable-resource` | `enableResource` |
| POST | `/datasets/{dataset_uid}/resources/{resource_uid}/disable/` | `disable-resource` | `disableResource` |
| POST | `/datasets/{dataset_uid}/resources/{resource_uid}/renew_api_key/` | `resource-renew-api-key` | `renewResourceApiKey` |
| POST | `/datasets/{dataset_uid}/resources/files/` | `upload-resource-file` | `uploadFile` |
| GET | `/datasets/{dataset_uid}/resources/files/{file_uid}/` | `retrieve-dataset-resource-file` | `getFile` |
| GET | `/datasets/{dataset_uid}/resources/files/{file_uid}/download/` | `download-dataset-resource-file` | `downloadFile` |
| GET | `/datasets/{dataset_uid}/attachments/` | `list-dataset-attachments` | `listAttachments` |
| POST | `/datasets/{dataset_uid}/attachments/` | `create-dataset-attachment` | `uploadAttachment` |
| GET | `/datasets/{dataset_uid}/attachments/{attachment_uid}/` | `retrieve-dataset-attachment` | `getAttachment` |
| DELETE | `/datasets/{dataset_uid}/attachments/{attachment_uid}/` | `delete-dataset-attachment` | `deleteAttachment` |
| GET | `/datasets/{dataset_uid}/attachments/{attachment_uid}/download/` | `download-dataset-attachment` | `downloadAttachment` |
| GET | `/datasets/{dataset_uid}/alternative_exports/` | `list-dataset-alternative-exports` | `listAlternativeExports` |
| POST | `/datasets/{dataset_uid}/alternative_exports/` | `create-dataset-alternative-export` | `createAlternativeExport` |
| GET | `/datasets/{dataset_uid}/alternative_exports/{export_uid}/` | `retrieve-dataset-alternative-export` | `getAlternativeExport` |
| PUT | `/datasets/{dataset_uid}/alternative_exports/{export_uid}/` | `update-dataset-alternative-export` | `updateAlternativeExport` |
| DELETE | `/datasets/{dataset_uid}/alternative_exports/{export_uid}/` | `delete-dataset-alternative-export` | `deleteAlternativeExport` |
| GET | `/datasets/{dataset_uid}/alternative_exports/{export_uid}/download/` | `download-dataset-alternative_exports` | `downloadAlternativeExport` |
| GET | `/datasets/{dataset_uid}/security/users/` | `list-dataset-user-security` | `listUserSecurity` |
| POST | `/datasets/{dataset_uid}/security/users/` | `create-dataset-user-security` | `createUserSecurity` |
| GET | `/datasets/{dataset_uid}/security/users/{username}/` | `retrieve-dataset-user-security` | `getUserSecurity` |
| PUT | `/datasets/{dataset_uid}/security/users/{username}/` | `update-dataset-user-security` | `updateUserSecurity` |
| DELETE | `/datasets/{dataset_uid}/security/users/{username}/` | `delete-dataset-user-security` | `deleteUserSecurity` |
| GET | `/datasets/{dataset_uid}/security/groups/` | `list-dataset-group-security` | `listGroupSecurity` |
| POST | `/datasets/{dataset_uid}/security/groups/` | `create-dataset-group-security` | `createGroupSecurity` |
| GET | `/datasets/{dataset_uid}/security/groups/{group_uid}/` | `retrieve-dataset-group-security` | `getGroupSecurity` |
| PUT | `/datasets/{dataset_uid}/security/groups/{group_uid}/` | `update-dataset-group-security` | `updateGroupSecurity` |
| DELETE | `/datasets/{dataset_uid}/security/groups/{group_uid}/` | `delete-dataset-group-security` | `deleteGroupSecurity` |
| GET | `/datasets/{dataset_uid}/versions/` | `list-dataset-versions` | `listVersions` |
| GET | `/datasets/{dataset_uid}/versions/{version_uid}/` | `retrieve-dataset-version` | `getVersion` |
| POST | `/datasets/{dataset_uid}/versions/{version_uid}/restore/` | `restore-version` | `restoreVersion` |
| GET | `/datasets/{dataset_uid}/schedules/` | `list-dataset-schedules` | `listSchedules` |
| POST | `/datasets/{dataset_uid}/schedules/` | `create-dataset-schedule` | `createSchedule` |
| GET | `/datasets/{dataset_uid}/schedules/{schedule_uid}/` | `retrieve-dataset-schedule` | `getSchedule` |
| PUT | `/datasets/{dataset_uid}/schedules/{schedule_uid}/` | `update-dataset-schedule` | `updateSchedule` |
| DELETE | `/datasets/{dataset_uid}/schedules/{schedule_uid}/` | `delete-dataset-schedule` | `deleteSchedule` |
| GET | `/datasets/{dataset_uid}/metadata/` | `list-all-dataset-metadata` | `getMetadata` |
| PUT | `/datasets/{dataset_uid}/metadata/` | `update-all-dataset-metadata` | `updateMetadata` |
| GET | `/datasets/{dataset_uid}/metadata/{template_name}/` | `list-template-dataset-metadata` | `getMetadataTemplate` |
| PUT | `/datasets/{dataset_uid}/metadata/{template_name}/` | `update-template-dataset-metadata` | `updateMetadataTemplate` |
| GET | `/datasets/{dataset_uid}/metadata/{template_name}/{template_field_name}/` | `retrieve-template-field-dataset-metadata` | `getMetadataField` |
| PUT | `/datasets/{dataset_uid}/metadata/{template_name}/{template_field_name}/` | `update-template-field-dataset-metadata` | `updateMetadataField` |
| DELETE | `/datasets/{dataset_uid}/metadata/{template_name}/{template_field_name}/` | `delete-template-field-dataset-metadata` | `deleteMetadataField` |
| GET | `/datasource_connections/` | `list-connections` | `listConnections` |
| POST | `/datasource_connections/` | `create-connection` | `createConnection` |
| GET | `/datasource_connections/{connection_uid}/` | `retrieve-connection` | `getConnection` |
| PUT | `/datasource_connections/{connection_uid}/` | `update-connection` | `updateConnection` |
| DELETE | `/datasource_connections/{connection_uid}/` | `delete-connection` | `deleteConnection` |
| GET | `/metadata/templates/` | `list-metadata-templates` | `listMetadataTemplates` |
| GET | `/metadata/templates/{template_name}/` | `retrieve-metadata-templates` | `getDomainMetadataTemplate` |
| GET | `/metadata/templates/{template_name}/fields/` | `get-metadata-fields-list` | `listMetadataTemplateFields` |
| GET | `/metadata/templates/{template_name}/fields/{template_field_name}/` | `get-metadata-fields-retrieve` | `getMetadataTemplateField` |
| GET | `/datasets/{dataset_uid}/i18n/translations/` | `get-dataset-translations` | `getDatasetTranslations` |
| POST | `/datasets/{dataset_uid}/i18n/translations/` | `update-dataset-translations` | `updateDatasetTranslations` |

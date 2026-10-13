# Highway source capture and ArcGIS receiving contract

## What this component does

`highway/capture.py` reads an explicitly selected HTTPS FeatureServer and up to four advertised layers and two advertised tables. It retains original service and dataset metadata, counts, ObjectID enumerations, feature query bodies, per-feature attachment listings, and available attachment bytes. It does not edit a service, create a replica, configure a GIS schema, or compare business records.

The default selected-data limits are 100,000 features, 10,000 attachments and 256 MiB of retained files. JSON responses are limited to 32 MiB and individual attachment bodies to 64 MiB. Every limit fails explicitly. A response is never shortened and labelled complete.

## Run and resume

Use fixed, explicitly supplied operation and capture UUIDs, a private real directory, and the exact same source selection on continuation:

```sh
python -m highway.capture \
  --service https://gis.livingstoncountyny.gov/arcgis/rest/services/Highways/FeatureServer \
  --layers 0,1,2,3 \
  --directory /srv/highway/captures/SELECTED_CAPTURE_UUID \
  --operation-id SELECTED_OPERATION_UUID \
  --capture-id SELECTED_CAPTURE_UUID
```

The example selects real dataset IDs; it does not assert that this selection has been captured. Choose the actual desired layer IDs after reading the service metadata. Tables must be explicitly selected and advertised in the service's own table inventory. Existing county metadata observed by the source owner advertises no tables; the proposed allowance of two related tables is not an observation that such tables exist.

Optional authentication is selected with `--token-env ENVIRONMENT_VARIABLE_NAME`. The token is read only from that environment and supplied in an authorization header. It is never placed in a saved request URL. Redirects are refused. A response that echoes the selected token is not retained.

A permanent `capture.lock` is held for the entire capture. The original input, request intents, attempts and exact response bodies remain in the same directory. Successful first responses are reused. An interrupted read with no returned record may repeat that read while retaining its prior attempt. A returned failed read needs an explicit `--retry-failed` continuation, and any original Retry-After deadline still applies. This option never changes the frozen source selection.

The final `manifest.json` is immutable. Reopening a completed capture verifies its original manifest and every inventoried file. Start a separately identified capture when fresh source observations are required. Missing attachment 404/410 results can be represented explicitly as unavailable; other read failures interrupt the operation. Unavailable attachment rows make coverage incomplete.

## Producer ABI

Python entry point:

```python
capture(
    service, layer_ids, table_ids, directory,
    operation_id=operation_uuid, capture_id=capture_uuid,
    token_env=None, batch_size=100, max_bytes=268435456,
    max_features=100000, max_attachments=10000,
    retry_failed=False,
)
```

The returned schema is `geocove.arcgis-capture.v1`. Its descriptors always have exactly `{sha256, bytes, mediaType, path}`; paths are relative to the capture directory.

The manifest contains:

- `id`, `operationId`, `createdAt`, `startedAt`, `completedAt`.
- `service: {url, itemId, metadata, finalMetadata}`.
- `selection: {layers: [integer IDs], tables: [integer IDs]}`.
- `datasets`, each with `id`, original `name`, `type: "layer" | "table"`, `metadata`, `finalMetadata`, `idQuery`, `finalIdQuery`, `countQuery`, `finalCountQuery`, `featurePages`, `attachmentManifests`, `attachments`, `coverage`, and `observations`.
- `attachmentManifests` rows are `{parentObjectId, descriptor}`. The descriptor resolves the entire original attachment listing.
- `attachments` rows are `{parentObjectId, parentGlobalId, info, content, state}`. `info` is the original attachment metadata; `content` is its exact byte descriptor or null; `state` is CAPTURED or UNAVAILABLE.
- `files` is the complete sorted descriptor inventory, including request and response records. It excludes the manifest itself. `bytes` is the sum of inventoried file sizes.
- `sha256` hashes the UTF-8 canonical JSON of the full manifest excluding only its `sha256` property. Canonical JSON sorts keys, uses compact separators and rejects non-finite numbers.

Each dataset coverage object has integer `initialObjectIds`, `finalObjectIds`, `capturedFeatures`, `initialReportedCount`, and `finalReportedCount`; actual `missingObjectIds`, `unexpectedObjectIds`, and `duplicateObjectIds` arrays; attachment counts; and separate `complete` and `sourceChanged` booleans.

The source metadata determines the actual ObjectID and GlobalID field names. Feature pages retain original `features[].attributes` and geometry, including requested Z/M values. No synthesized feature row replaces an original response.

Coverage describes the selected initial ObjectID set. Final counts, IDs and metadata are separately retained. A matching final ID set does not prove that all feature attributes remained unchanged between requests. The manifest therefore records MULTIPLE_READS_NOT_TRANSACTIONAL_SNAPSHOT. A changed source is not silently promoted to a stable snapshot.

## ArcGIS capability and receiving rules

These rules come from Esri's primary REST documentation; their application to the selected service must use its actual saved metadata.

1. **GlobalIDs and edits.** Service-level `useGlobalIds=true` requires advertised support. It preserves supplied GlobalIDs; the default false mode assigns server IDs on adds and uses ObjectIDs for edits. A GlobalID field alone does not establish the capability. `honorSequenceOfEdits=true` preserves submitted dataset ordering, whereas the default sorts by layer ID. A future authorized writer must retain exact outbound inputs and all per-row results. A collision does not prove that an earlier uncertain request succeeded. [Service applyEdits](https://developers.arcgis.com/rest/services-reference/enterprise/apply-edits-feature-service/)

2. **Actual outcomes.** Layer edit responses separate add, update, delete and attachment results. Individual rows include success or error information; an HTTP success is insufficient evidence that every edit applied. Rollback and partial outcomes must remain distinct. A retained acknowledgement is also distinct from a later source refresh. [Layer applyEdits](https://developers.arcgis.com/rest/services-reference/enterprise/apply-edits-feature-service-layer/)

3. **Relationship identity.** Resolve declared relationships from the layer's relationship ID, related table ID, role, cardinality and key field. Do not infer a related table or foreign key from a proposed form or a coincidentally named field. Preserve domains, subtype definitions, nullable/editable attributes, original field names and spatial reference from the selected metadata. [Layer resource](https://developers.arcgis.com/rest/services-reference/enterprise/layer-feature-service/)

4. **Attachments and synchronization.** In GlobalID-based attachment transfer, attachment GlobalID identifies the attachment and parentGlobalId identifies its feature. AttachmentId is the server's attachment identifier. Replica attachment synchronization requires an appropriately configured sync workflow; a service with sync disabled cannot be described as ready for replica synchronization. This component keeps photos local when the selected target does not advertise attachments. [Sync and attachments](https://developers.arcgis.com/rest/services-reference/enterprise/sync-and-attachments/)

5. **Complete reads.** Layer queries support an ObjectID enumeration followed by bounded ObjectID subsets. The current layer-query documentation describes a one-million-ID response limit; this component's smaller explicit bound and independent count comparison avoid assuming unlimited enumeration. The capture also checks missing, unexpected and duplicate returned IDs. [Layer query](https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/)

6. **Optional attachment query features.** Bulk queryAttachments requires its advertised capability. Pagination and returned URLs have their own support flags. This component uses original per-feature attachment information and fixed same-service attachment read paths, avoiding dependence on those optional bulk features or saved token-bearing returned URLs. [Query attachments](https://developers.arcgis.com/rest/services-reference/enterprise/query-attachments-feature-service-layer/)

Esri documents authorization headers for ArcGIS services. The capture uses `X-Esri-Authorization` and preserves only the selected environment-variable name in its original request record. [Authorization headers](https://developers.arcgis.com/documentation/security-and-authentication/reference/http-authorization-headers/)

## Integration boundaries

The domain resolves metadata and pages through their SHA-256 descriptors and validates original dataset and ObjectID identity. The storage layer imports all referenced files before applying the immutable capture command. Forms, supervisor decisions, proposed edits, crew assignment and the paired reconciliation engine remain their existing modules.

No external GIS writes are authorized by this read-only capture. Future customer-controlled receiving must retain its exact target capability snapshot, original operation/request identities, every native result and a separate follow-up source capture. An unresolved write must be reconciled before any new submission.

# Maximo target receiving contract

Reviewed: 13 October 2026. This contract accompanies the maintained municipal migration workspace's configured Maximo target extension. It defines discovery, complete acquisition, field mapping, prepared imports and receiving of actual provider results.

The implementation uses the selected installation's API root, object structure, organization, site and returned schema. The public IBM catalogue is a discovery reference; IBM explicitly states that installations expose different generated APIs. Retain the actual version and original tenant metadata with each target edition. [IBM API catalogue](https://developer.ibm.com/apis/catalog/maximo--maximo-manage-rest-api/)

## 1. Selected installation and discovery

Keep a profile containing the exact HTTPS API root, object structure, intended organization/site, mapped root attributes, identity attributes and source-link/crosswalk choice. A profile change produces a different acquisition identity. Retain complete schema, request URL, response status/headers/body, observation time and digests.

Use the original installation's `jsonschemas/<object-structure>` resource. Schema properties describe exposed MBO attributes, JSON types and Maximo subtypes. `oslc.select=*` on the schema includes its child-object hierarchy; an explicitly selected schema can describe only the needed portion. Embedded `addschema=1` metadata belongs to the response where it was returned; later page URLs do not automatically repeat that parameter. [JSON schema](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/jsonschema/jsonschema/)

The current Manage guide describes generated OAS3 and `/oslc/oas?os=MXAPIASSET`, with `includeactions=1` for actions and `/oas3/api.html` for its UI. The catalogue's version-8 example uses different spellings/routes. Preserve the actual installation response rather than rewriting it to match either example. [Generated OAS](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/oas/)

API-key calls act with the key owner's permissions. Put the key in the `apikey` header. IBM documents the `/api` servlet route for headless authentication where the `/oslc` route is constrained by application-server login, and `x-public-uri` to make returned links use that selected route. Store the credential separately from exported observations and source. [API keys](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/authentication/apikey/)

## 2. Complete root-asset acquisition

| Element | Receiving behavior |
| --- | --- |
| Collection | Use the configured object-structure collection and `lean=1`. |
| Selected values | Request the full configured root attribute set plus compound identity, source-link fields and native row stamp. |
| Nulls | Set `_dropnulls=0` so explicit null values survive comparison. |
| Ordering | Use persistent root keys with explicit ascending/descending prefixes; URL-encode plus signs. |
| Page size | Use an explicit practical size within the installation's configured maximum. |
| Continuation | Retain and follow the returned `responseInfo.nextPage` until its absence in a complete response. |
| Counts | Retain supplied counts; request `collectioncount=1` when needed. Counts are not returned by default. |
| Persistence | Save each complete provider observation before advancing the receiving journal. |
| Endpoint binding | Resolve links against the observed request; verify HTTPS origin, selected API path and original collection before adding credentials. |
| Result | Publish only the complete accepted walk as a target edition; preserve interrupted observations in their own operation. |

IBM's collection envelope uses `member` and `responseInfo`. Null-valued attributes are normally omitted, and `_rowstamp` supports dirty-update handling. A wildcard selects persistent attributes for a persistent object; explicitly request any required nonpersistent fields. Attribute/relation name collisions can produce aliases, so field mapping must preserve the returned schema and selected alias. [Selecting](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/query/selecting/)

Ordinary pagination reruns the query for each page. Stable paging retains an MboSet, but delivered pages expire and cannot be fetched again; its default idle expiry is five minutes. This implementation selects ordinary pagination and rejects stable cursors. Two complete matching walks, duplicate checks and unchanged before/after schema provide observed consistency for the captured edition. This is an engineering consistency check; it does not create a database snapshot. If either walk differs, retain both observations and recapture after resolving the change. [Sorting and paging](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/query/sort_and_paging/)

A repeated page URL, duplicate compound identity, malformed envelope, wrong scope, response limit, incomplete transfer or page-count limit is a concrete incomplete-capture outcome. Save it with its original operation so a later complete capture cannot silently incorporate different pages.

## 3. Asset identity and source mapping

IBM identifies SITEID and ASSETNUM as the external asset keys. Retain them separately, alongside the selected installation/object structure, organization and original resource href. Use an unambiguous tuple representation for comparisons; punctuation joining can collide with legitimate identifier values. [Asset identity](https://www.ibm.com/docs/en/icvi/cd?topic=rmvomopa-differences-among-moving-object-id-asset-number-site-id)

The provider REST identifier is generated from primary-key values; it is not the MBO's numeric unique ID. Use the returned href for later resource references. Preserve source-qualified municipal identity independently. A source AM_ID alone is insufficient where actual source rows repeat it: use the original layer/provider identity and OBJECTID or the reviewed explicit crosswalk. [Resource identity](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/crud/create_and_update/)

A reviewed mapping establishes:

- The actual source field or constant for each native root attribute.
- Exact source row identity and target compound identity.
- Null, empty string and absent-value behavior.
- Schema type, Maximo subtype, required/read-only rules and relevant limits.
- A direct source-link field or a complete explicitly reviewed crosswalk.
- Separate matched, unmatched, ambiguous and conflicting populations.

This is an implementation design. An unmapped asset stays visible for review; a similar description or guessed asset number does not establish identity. Preserve numeric precision and original typed values through JSON, comparison and CSV companions.

OSLC filters are type-sensitive: strings/dates use quoted literals, numeric values use their numeric representation, and booleans use native boolean/numeric forms. Wildcards and special null syntax have semantics of their own. Construct a constrained expression from validated field names and encoded values, and independently verify returned scope/identity. [Filtering](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/query/filtering/)

## 4. Prepared import and concurrency

Generate an immutable preparation from the selected source edition, target edition, reviewed mapping and exact row choices. Keep both complete original inputs, field-level changes, ordered request rows, source-to-request index, method/collection/headers/body and byte digests. Current preparation is for root scalar fields. It excludes child-array mutation and remains usable by the prime's selected native import route.

IBM supports resource updates through POST with `x-method-override: PATCH`. `patchtype: MERGE` preserves omitted children while matching or adding supplied ones. The older IBM CRUD guide additionally warns that even a scalar-only replacement update can remove omitted children. Bind the chosen MERGE behavior in the prepared update contract, rather than relying on omission alone across versions. [Create and update](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/crud/create_and_update/) [IBM CRUD guide, page 5](https://community.ibm.com/HigherLogic/System/DownloadDocumentFile.ashx?DocumentFileKey=c6832c93-a298-22d1-3e32-2fd0d9fc5663&forceDialog=1)

The same CRUD guide, pages 7–8, specifies `_rowstamp` in resource data for concurrent-change detection at every object level; omitting it removes that check. Retain the original value on each prepared existing-record update. IBM support confirms that SQL Server rowstamps can be strings representing byte arrays, so do not coerce them to integers. The delta-query high-water value is a separate representation. [Original rowstamp representation](https://www.ibm.com/support/pages/why-rowstamp-value-rest-api-responses-byte-array-instead-integer)

The older guide's bulk examples use `_data`/`_meta` wrappers, while the current maintained guide documents the simplified `_action` resource array. Select the actual installation's supported bulk contract. Retain that choice with the preparation; an older example must not silently change current wire format.

For an update using conditional concurrency, retain the actual selected resource's HTTP ETag. IBM documents `If-Match` and a 412 response when that ETag is stale. A collection ETag is not automatically an individual asset ETag. A 412 means retrieve the current resource and review the changed state before producing a successor preparation; removing the condition would discard the operator's reviewed basis. [Conditional update](https://www.ibm.com/docs/en/control-desk/7.6.1?topic=resources-partial-update-oslc-resource)

## 5. Bulk-result receiving

IBM's bulk route is a collection POST with `x-method-override: BULK` and an ordered JSON array. The default behavior commits each resource separately; an HTTP 200 can contain successes, failures or both. Retain every original item, its position, `_responsemeta.status`, returned Location and complete `_responsedata.Error`. With `allornothing: 1`, a failed item causes rollback of the batch. [Bulk operations](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/crud/bulk/)

The receiver uses the following implementation interpretation:

| Received condition | Recorded result |
| --- | --- |
| Complete response, successful status for every corresponding item | Provider acceptance for those exact rows; retain locations and obtain the selected target readback. |
| Mixed item outcomes under default commit behavior | Separate accepted and rejected rows; retain their original request indices. |
| Any failure with the original allornothing header enabled | Record the batch rollback semantics; never count successful-looking siblings as committed rows. |
| HTTP 200 with missing/unrecognized item outcome | Unresolved item, with the complete original response retained. |
| Response length/order cannot be bound to the prepared array | Preserve the observation; no inferred per-row success assignment. |
| Timeout or lost/incomplete response | Original outcome unresolved; recover native state before preparing another import. |
| Authentication, authorization or malformed request failure | Retain the actual refusal and correct the original configuration/input as appropriate. |

A successful import result and a complete post-import target capture are distinct records. Reconcile the actual later target values against the same prepared source/mapping; surface provider normalization, rejected fields and independently changed assets.

## 6. Repeated requests and recovery

IBM's `transactionid` header detects a duplicate after its first transaction commits and returns HTTP 409. Its documented default retention is only five minutes, controlled by OSLCTXN. This is a finite provider mechanism rather than a permanent idempotency guarantee. Keep the original transaction identity with the prepared request and actual attempt. A changed ID cannot resolve an ambiguous prior result. [Duplicate requests](https://ibm-maximo-dev.github.io/maximo-restapi-documentation/duplicaterequests/)

The local journal retains the complete preparation, attempt, original response and later target observations. Reopening a completed receiving operation returns its existing result. Corrected mapping, changed target state or separately authorized remainder creates an explicit successor tied to its predecessor and row decisions.

The independent handover contains the original source, all complete target observations, schema/profile without credentials, mapping/crosswalk, reconciliation reports, prepared bytes, received native result and complete project history. The receiving operator can inspect, edit, export, reopen and return that same work through the maintained municipal application.

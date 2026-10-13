# Property source, inspection and customer delivery

This is an additive workflow in the original Socrata / HPD operator. It uses the same private workspace, SQLite writer lease, serialized action dispatcher, retained state and complete portable package. It reuses the original SF30 dataset publisher, SF82 seller release and SF88/SF100 buyer acquisition and recovery models.

The workflow joins three different observations:

* **HPD:** the selected original Affordable Housing Production by Building capture, with building-in-project rows. Several project rows may refer to one building or BBL. The original Queens capture has 1,342 rows; the demonstrated Preservation selection has 144 rows. Neither count is a count of violations, inspections or uniquely identified buildings.
* **Propply:** the complete returned compliance or portfolio report and its stated coverage. Its score, grade and property aggregates keep their vendor definitions and original response locators.
* **RentCheck:** the receiving account's actual property, current inspection template, native inspection and original report. A missing native identity remains unknown until the operator provides a source-backed match.

The installation does not change the original HPD capture, active dataset, previous merchant price, publication or paid buyer records. No vendor request or customer acceptance is established by installing these files.

## Install and open the original application

Use the complete current Stellar Forge source or its original complete source package. The property modules are siblings of the existing `socrata/` directory under:

`stellar/scf-starforge-20261009/sf30-seller-sdk/`

The runtime remains **Node.js 24 or later**, as required by the original lossless Socrata source parser and `node:sqlite`. Do not copy only this leaf without the original dataset, publisher, SF82 and buyer dependencies.

From that SDK directory:

~~~sh
node socrata/cli.mjs workspace --directory /absolute/original-workspace --port 8478
~~~

Open the exact printed private session URL. The original listener remains loopback-only; its capability token belongs in the URL fragment and browser session, not in source or customer packages. Stop with Ctrl+C and wait for the server and its owned operations to close. Restart with the **same workspace directory**. Keep the same port when resuming browser-local request recovery.

If another original operator owns the workspace, attach its existing session or close it normally before a separate CLI invocation. The existing SQLite writer lease is authoritative. Do not remove the lock file or infer that another process ended from a missing terminal.

Choose **Property operations** in the original navigation. The existing Source, Capture, Mapping & editions, Query preview, Merchant, Publisher & buyer, and Export & recovery sections remain available.

A host that already owns the original operator can continue passing that same model to `startSocrataWorkspace({directory,operator})`. A host opening the model can supply `propertyHost` to `openSocrataOperator`; borrowed original models keep their existing lifecycle ownership.

## Host credentials and actual API contracts

Vendor calls are disabled by default. Source import, review, comparison, export, original publisher inspection and retained-state recovery do not require a vendor key.

To enable an authorized Propply report acquisition, make a private host JSON file that selects the name of an already configured environment variable:

~~~json
{
  "timeoutMs": 60000,
  "propply": {
    "enabled": true,
    "apiKeyEnv": "SELECTED_PROPPLY_KEY_ENV"
  },
  "rentcheck": {}
}
~~~

The example is a configuration shape, not a credential. Set the real environment value through the operator's existing private secret mechanism. Start the same operator with:

~~~sh
node socrata/cli.mjs workspace --directory /absolute/original-workspace --port 8478 --property-host /absolute/private-property-host.json
~~~

RentCheck requires a reviewed, retained **account-specific** contract before a host entry can be enabled. The public update documents these operations:

| Operation | Original documented route |
|---|---|
| List templates | `GET /v1/inspection-templates` |
| One template | `GET /v1/inspection-templates/:id` |
| List inspections | `GET /v2/inspections` |
| One inspection | `GET /v1/inspections/:id` |
| Create one inspection | `POST /v2/inspections`, using `inspection_template_id` |

The original source owner now retains the complete officially linked OpenAPI document, including declared authentication, request bodies, response schemas and pagination. Select the receiving account's actual environment and review its source-backed field pointers against that retained contract. Preserve the documented inspection-list version and maintenance-report wrapper discrepancies. No idempotency header or replay guarantee is established for inspection creation; reconcile the original request and complete response before another dispatch.

Retain the complete original contract file with **Retain exact file**, then enter this configuration using values from that actual contract:

~~~text
schema: tjlabs.rentcheck-account-contract/v1
account_id: original receiving account identity
environment: production, staging, or sandbox as actually selected
api_base: actual HTTPS getrentcheck.com API base, ending in /
auth_header_names: the actual credential header names
fields:
  create_property: JSON pointer to the receiving property in the complete create body
  template_id: JSON pointer to the native ID relative to one returned template record
  inspection_id: JSON pointer to the native ID in the complete inspection detail response
  inspection_property: JSON pointer to the property ID in that detail response
  inspection_template: JSON pointer to the template ID in that detail response
  created_inspection_id: actual create-response ID pointer, or null if not supplied
  report_url: actual returned report URL pointer, or null if not supplied
reviewed_by: operator
review_note: original source / selected contract explanation
~~~

This is an explanation of the configuration fields, not a fabricated vendor schema. Native IDs are opaque text; the adapter does not round numeric identifiers or infer them from address order. The source descriptor is filled from the retained original file.

The saved contract exposes its exact `contract_sha256`. In the host file, use that full hash as the key under `rentcheck`, with `enabled:true` and `headersEnv` mapping each **actual header name** to its selected environment variable name. The full set must match the saved contract. No credential values go through browser actions or exports. Restart the original operator to load a changed host configuration.

## The complete operator journey

### 1. Pin the existing HPD edition

Select a complete original HPD edition and the actual source columns for project ID, building ID, BBL, BIN and address. Leave an absent column unselected rather than inventing it. The source must be the original `data.cityofnewyork.us/hg8x-zxpr` capture.

The action verifies every original page's length and SHA-256 and uses the original lossless parser. It retains the edition snapshot, capture revision, row scope, exact page descriptors and selected column mapping. Numeric source tokens remain text in identity inspection. The baseline's row number is a locator in that ordered original capture, not a new geographic identifier.

### 2. Save the receiving property selection

Enter one to fifty records with:

* a stable local `id`;
* `propply_address` containing the exact requested `address`, `state` and `zip`, with optional `city` and `name`;
* the actual `rentcheck_property_id` as text, or null while unknown;
* optional BBL and BIN values for reviewed candidates.

The panel provides a blank JSON structure. Its empty values must be replaced by the receiving operator's actual selection. A null ID cannot be used to prepare an inspection. A later corrected property list is a new saved selection and review; it does not rewrite the previous source edition.

### 3. Prepare and acquire a Propply source edition

Choose the saved selection and either:

* `compliance_report`: exactly one address, with documented optional boolean flags `include_equipment`, `include_violations`, `include_rules`; or
* `portfolio_report`: one to fifty addresses. The documented request is `{properties:[...]}`; single-report flags are not invented as portfolio parameters.

Preparation saves the complete method, fixed official URL, body, selected addresses and request hash. It makes no vendor request.

**Run this one vendor request** is a separate operator action. The original workspace durably records **ISSUED** before the one HTTP call. The host supplies the selected API key server-side. No report retry, monitoring enrolment or webhook subscription is automatic. A report may consume vendor quota or bill overages according to that account's actual plan.

The full response, actual status, selected returned headers and request binding are retained before interpretation. A malformed/error body remains a source artifact. Original response identity is the SHA-256 of the complete bytes, not a regenerated JSON value.

The published portfolio sample has `score`, `grade`, `open_violations`, `overdue_inspections`, `top_risk` and `equipment_count`; it does not supply a stable receiving-property ID. The compliance response has a separate `report` object and `risk_score/risk_level` fields. The adapter preserves those differences. An absent coverage field remains unavailable. A vendor grade is not an HPD A/B/C violation classification.

If the operation returns no complete evidence, its request remains issued. **Recover retained response** reads only an already retained response; it does not make another API request. A later billable acquisition requires its own deliberate prepared request and clear original history.

You can also retain a complete actual response file from an existing authorized acquisition and attach it to the exact prepared request with its actual HTTP metadata and source note. Such evidence is labelled `OPERATOR_IMPORTED_ORIGINAL_RESPONSE`, distinct from a call observed by this host.

### 4. Review explicit property identity links

Load the HPD baseline, Propply edition and original property list together. For each selected receiving property, choose:

* the actual returned Propply record;
* **same property**, **building context** or **parcel context**;
* zero or more actual HPD source row numbers;
* a source-to-receiving identity explanation.

BBL/BIN candidate rows are shown with their original row, project, building and address values. They are never automatically selected. Address similarity and request/response ordering do not establish identity.

Several units may use one building/parcel report as context. Shared HPD rows are explicitly recorded; do not sum the same building aggregate once per receiving unit. Unmatched source rows, vendor reports and receiving properties stay visible.

The saved review pins the complete property selection, source response hash, HPD page identity, row hashes, relationship and reviewer. A changed selected source or property revision invalidates an unsaved loaded view; the panel requires an explicit reload.

### 5. Read the actual RentCheck templates

Save the receiving account contract, then prepare a documented template collection or one-template read. Select actual query parameters from that account's contract. No pagination or status field is inferred.

Issue the prepared read once. Open its complete response edition and choose the actual template record using the JSON pointer within that returned body. An empty pointer means the whole response is itself the template object. The configured template-ID pointer is evaluated relative to that selected record.

The template response must belong to the same saved account contract used for the inspection. `inspection_type` is deprecated and is rejected in a new create body.

### 6. Prepare one original inspection

Select the saved identity review, one reviewed local property, the completed native template read, and the complete create body supplied by the account contract.

The adapter verifies the actual property and `inspection_template_id` in the body against the selected saved sources. It retains all source hashes and the whole request before any call. It does not construct undocumented vendor fields.

Issue the prepared create only through its explicit original request. There is no automatic create retry. A successful create response must still be checked against a native detail read.

### 7. Reconcile the real native inspection

Read the actual inspection through the documented detail route, retaining that request and response.

Use **the original create returned this ID** only when the complete captured create response actually returned that exact native ID. The detail must match the same receiving property and template.

Use **explicitly adopt this observed existing inspection** when the original create's outcome is uncertain or an existing native inspection is intentionally selected. The binding states that the operator adopted the observed inspection; it does not claim an uncertain POST created it.

Once the original prepared request is bound, it is marked **BOUND**. It cannot later dispatch another create, even if the adopted inspection began with a prepared request that had never been sent. All original request, response, uncertainty and reviewer records remain.

### 8. Retain the original report

Import the complete actual report file, verify its full SHA-256, and associate it with the saved native inspection binding.

Select either an original export made by the receiving operator or a file from the exact report URL returned by that inspection. The URL route additionally verifies the original detail response and its configured report locator. It does not guess or fetch a report endpoint.

The private source record retains the original association. Signed download URLs are not included in the selected merchant's public source projection. The original report bytes can be included in a customer resource only when explicitly selected under its recorded rights.

### 9. Compare two genuine editions

Choose the previous and current saved property reviews and explicit named report-field JSON pointers. Compare compatible source observations; do not compare a compliance score and a portfolio field merely because both are numbers.

The comparison retains separate states for missing, null, zero, changed and unchanged values. It flags a changed receiving identity rather than describing that as a condition change. Added/removed review membership is not evidence that a building or condition was created, removed or resolved.

The comparison is a saved immutable record that can be reopened or downloaded without acquiring the sources again.

### 10. Export the selected merchant resource

Select the saved review, an optional comparison ending at that review, and any native inspection bindings/reports associated with that same review.

Record the actual resource merchant, independent buyer/receiving operator, licensed scope, display/retention/redistribution rights, selected host, payment path, reviewer and note. The parties must have approved that selection before a merchant export. The feature itself does not establish their approval or a commercial contract.

Choose explicitly whether the customer is allowed the whole original vendor response and the selected native report files. The default source handover contains the selected report context and source identities, not the private account contract, credentials or an unrestricted vendor catalogue.

The export produces:

* original `dataset.csv` and `dataset.json` for the existing SF30 engine;
* a compact `source.json` with the existing SF82 `sourceFiles` inventory;
* complete selected source/review/comparison files and any expressly approved originals;
* the original `seller.json` built by `buildDatasetSellerConfig`;
* `query.json` and the receiving README.

Selected report values use native **string columns containing JSON `{present,value}` cells**. This preserves missing/null/zero and structured values without a new query engine or accidental decimal/identifier coercion. The original typed dataset engine still controls filters, sort, limits, snapshots and cursors.

Resource key and query-contract selection define its original publisher directory. A materially different query contract gets its own original model directory. The original HPD publisher is never repurposed for the different property contract.

### 11. Continue through the original publisher and buyer

Click **Use in original publisher & buyer** on the exact saved resource. The original panel opens with that resource's verified export and original publisher model.

Continue the same maintained sequence: prepare draft, preview, review at expected snapshot/revision, stage/activate/start the original seller, read its actual offer, prepare the buyer, attach the original buyer workspace and explicit bounds, and run/recover/export that retained acquisition.

The property wrapper changes only which verified resource owns the original model. It introduces no payment verifier, signer, settlement code, acquisition journal or duplicate buyer engine. The original HPD publisher and its earlier sessions remain selectable in the same panel.

Keep the existing paid result and receipt when a response is lost. Use the original buyer's recovery and unpaid-continuation controls; never retry a completed payment as a new sale. The original account/network and caller approvals still govern any actual operation.

A selected commercial integration using ordinary API billing may be useful revenue; it is not automatically an accepted Stellar merchant/buyer/payment cohort. Actual selected merchant control, independent buyer acceptance and returned payment records determine that claim.

### 12. Export and reopen the complete private workspace

Use the original **Export & recovery → Export current package**. Before the snapshot, any already retained complete vendor response is reconciled into its request metadata without another HTTP call.

The original compressed `starforge-socrata.json.gz` now includes every declared property file alongside all original HPD pages, metadata, mappings and dataset editions. Each source is bound by path, complete byte count and SHA-256. Pending request identities and issued/returned/bound states remain part of the same workspace record.

Restore through the original command into a new empty directory:

~~~sh
node socrata/cli.mjs action package.import --directory /absolute/empty-receiving-workspace --json '{"packagePath":"/absolute/path/starforge-socrata.json.gz"}'
node socrata/cli.mjs workspace --directory /absolute/empty-receiving-workspace --port 8478
~~~

The existing importer rejects a nonempty workspace, including a property-only workspace. It verifies the whole source inventory and native HPD dataset snapshots before selecting the restored state. No existing decisions are overwritten. Credentials must be supplied separately through the receiving operator's private host setup; the original source package does not enable network access.

The source workspace package is distinct from the original seller deployment and paid buyer workspace. Preserve their complete original export/recovery products through SF82/SF88 as already documented in `socrata/PUBLISHING.md`. Do not treat the private source package as a replacement backup of an active seller process or an independently owned buyer workspace.

After restore, property resource paths are resolved under the selected receiving workspace rather than trusted from old absolute paths in provenance.

## Original request and browser recovery contract

Every property mutation carries:

~~~json
{
  "key": "one-original-request-id",
  "workspace_id": "the-displayed-original-property-workspace-id",
  "expected_revision": 0
}
~~~

The revision above is an illustration, not a receiving precondition. Use the actual displayed value. Before the first property record only, `workspace_id` is null.

The backend hashes the full input, checks an existing original request before current revision, and returns its exact committed result before considering later edits. A reused key with different input is rejected. A new mutation must match the actual workspace identity and revision.

The browser durably retains the exact request before submission. Its accepted response is kept until it can be matched to the same native operation. If an accepted browser receipt survives an older workspace restore without that native commitment, the browser refuses to resubmit. Export that retained request/receipt and recover the complete original workspace.

Requests that reached **ISSUED** are never reset to prepared by restart or package restore. An absent/incomplete response remains a reconciliation task. A normal explicit GET/detail read can establish actual native state without making another create. The original backend serializes calls and keeps its writer lease for the process lifetime.

## CLI and host action reference

All actions remain on `socrata/cli.mjs action ACTION --directory DIR --input FILE`, or the original private `POST /api/action` envelope `{action,payload}`.

| Purpose | Action |
|---|---|
| Read a saved immutable property record | `property.get` with group/id |
| Read one original operation | `property.operation` with key |
| Candidate source rows | `property.candidates` |
| Retain a complete local source | `property.file.import` |
| Original HPD source / property selection | `property.baseline.save`, `property.selection.save` |
| Prepare Propply / account contract / native read | `property.propply.prepare`, `property.rentcheck.contract`, `property.rentcheck.prepare` |
| Prepare native inspection | `property.inspection.prepare` |
| Issue once / recover retained response / import actual response | `property.request.run`, `property.request.recover`, `property.request.import` |
| Save reviewed link / compare editions | `property.identity.save`, `property.comparison.save` |
| Bind observed inspection / original report | `property.inspection.bind`, `property.report.save` |
| Prepare exact native resource handover | `property.resource.export` |
| Inspect verified publisher selection | `property.resource.publisher` |
| Original publisher/buyer action on that resource | `property.publisher.*` |

A `property.publisher.*` payload has exactly `{resource_id,payload}`; the nested payload is the unchanged original publisher action input. For example, `property.publisher.prepare` selects the saved resource and supplies `payload:{}`. The wrapper derives its verified export directory. All original expected snapshot/revision, release-generation and buyer-attempt fields retain their original semantics.

For CLI `property.publisher.release.start`, the same original operator remains alive and prints its private browser session. Ctrl+C drains the owned seller and listener. A CLI status invocation cannot borrow a running process's SQLite lease; use its existing browser/API.

## Published contracts and limits

* [Original HPD dataset](https://data.cityofnewyork.us/Housing-Development/Affordable-Housing-Production-by-Building/hg8x-zxpr)
* [Propply official API documentation](https://insparisk.com/docs/api-docs)
* [RentCheck API update and template identity](https://help.getrentcheck.com/en/articles/9045668-rentcheck-api-updates)
* [RentCheck official developer portal](https://developers.getrentcheck.com/)

The Propply adapter uses only the two documented report operations at the fixed official endpoint. Each complete report response is limited to 16 MiB; a local retained source/report file is limited to 64 MiB. The original workspace package retains its existing aggregate size limits. Limits are checked before import/retention and never justify truncating a source.

The original source owner captured the complete officially linked RentCheck OpenAPI document on 12 October 2026: 434,208 bytes, SHA-256 `3865e074ff61d2ac05a0b49ddad6f85c3efaf392c8602bfcf83f845cb36d7808`, with 42 paths, 66 operations and 56 schemas. The [developer portal](https://developers.getrentcheck.com/) links the [original YAML](https://rentcheck-lambdas-static-files.s3-us-east-2.amazonaws.com/doc_specs.yml). Keep the account-specific reviewed selection: the retained specification and separate guide still differ on inspection-list v2/v3 and the maintenance-report wrapper. Preserve the complete source and actual receiving account contract when commissioning that integration.

### Complete browser request records and moved source workspaces

The private operator retains each exact property action and its accepted response under an individual browser storage key before updating its active-request pointer. Recovery is also bound to the original outer workspace identity (`createdAt`), including a first property action whose inner workspace ID is still null. Opening a different workspace keeps the original request and receipt, disables its recovery action, and permits their download; reopening the original workspace restores the same recovery path. The identity is checked before native reads and immediately before dispatch, without changing the retained input or request key. Other windows cannot replace that record. A retained-request list lets the operator recover each original key; completed records remain marked as acknowledged. If an accepted browser response survives an older database restore without its matching native operation, recovery stops before submission. Reopen the complete original workspace; do not create a replacement request to erase this boundary.

After a source package is received under a new directory, resource export paths are derived from that actual current directory. The publisher's resource selector chooses one exact resource edition, and its Prepare control opens only that edition's verified files. Select another edition in the same selector when needed. The original publisher still groups compatible editions under its retained contract and preserves its existing releases, paid acquisitions and buyer recovery records.

### Selected source fields and response representation

The customer resource's CSV and provenance file project only the chosen report fields. A selected comparison carries only those same field pointers, together with the complete private comparison's hash. Unselected vendor fields remain private unless the parties explicitly permit the complete original vendor response. The receiving property structure accepts only its stable ID, request address, actual RentCheck ID and optional BBL/BIN; unrelated customer account fields cannot enter it accidentally.

The host requests identity encoding. It retains the complete body returned by Fetch, with the actual content-encoding and content-length headers. If a vendor nevertheless compresses a response, Fetch may decode it: the stored hash identifies that complete decoded response body, not compressed wire bytes. The same 16 MiB body limit applies, and no extra HTTP request is made. Unsafe integer or nonfinite JSON values prevent interpretation while the exact complete response remains retained for review.

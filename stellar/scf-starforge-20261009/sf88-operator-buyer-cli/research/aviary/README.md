# Aviary migration workspace — operator guide

This workspace takes an original audiovisual collection, records an explicit mapping into Aviary’s five import tables, and retains the source files, review revisions, import progress, provider IDs and receiving evidence together. The same reviewed collection can produce an Aviary bulk-import ZIP or drive the API workflow for an entered organization and collection.

Start with the public USGS example below. For an institutional collection, substitute its original files and reviewed mappings, then choose the receiving collection and its visibility settings. The local preview and native CSV package can be inspected before any API operation.

## What is included

The application consists of aviary.py, aviary_client.py, server.py, index.html, app.js, cli.mjs, this guide and PROVIDER_CONTRACT.md. The complete native handoff also includes managed.py and [the Applications guide](APPLICATIONS.md). The installed aviary command and the Aviary collection migration entry in Applications open that same workspace with its selected Python. Python 3.11 or later runs the application. The local command line and browser use the same retained workspace. In the surrounding Node project, `node research/aviary/cli.mjs` forwards the same arguments to Python and preserves normal process signals. It uses STELLAR_FORGE_PYTHON when set, otherwise python3.

The example includes an input declaration and a source-capture script. Its source tables deliberately use catalogue headers such as record_key, asset_key, local_file and Tile. The mapping records every conversion, including the explicit **Title ← Tile** attachment mapping. It does not silently repair a malformed CSV row.

| Output | Contents | Intended use |
|---|---|---|
| Native package | All five Aviary CSV files and selected local assets, with an adjacent member manifest | Review or import through Aviary’s supported bulk-import path |
| Workspace handoff | Application, original source, mapping history, operation records, provider IDs, transcript exports, native package and human review | Continue the same migration on another machine |
| API operation | One saved plan and retained child actions for resources, media uploads, transcripts, indexes and supplements | Execute and recover the migration against the entered collection |

A completed local exercise establishes the application behavior and the exercised protocol. Acceptance by a particular Aviary organization requires its actual authorized receiving configuration and readback. The acceptance receipt delivered with a run identifies which stages actually occurred.

## Original provider contract

The implementation follows the current Aviary guides and maintained AVP importer/exporter sources at commit 9f189144f6434e6561696983edce17494aa66dd0:

- [Bulk importing](https://coda.aviaryplatform.com/bulk-importing-248).
- [Aviary API](https://coda.aviaryplatform.com/aviary-api-14).
- [Official OpenAPI specification](https://www.aviaryplatform.com/aviary-api.json), as linked by the API documentation page. The reviewed source was retrieved on October 12, 2026 at 09:20 UTC: OpenAPI 3.0.0, document version 1.0.0, 200,348 bytes, SHA256 `1bf29e93ede6bc7aa755be25603e1fed4ddb899dac1964f4f63eaaca930c1291`.
- [Transcripts](https://coda.aviaryplatform.com/transcripts-137).
- [Indexes](https://coda.aviaryplatform.com/indexes-221).
- [AVP import/export scripts at the retained commit](https://github.com/WeAreAVP/aviary-api-scripts/tree/9f189144f6434e6561696983edce17494aa66dd0).

Resource and media *user keys* are four-digit values from 1000 through 9999. They connect rows inside an import package; Aviary does not retain them as remote identifiers. The workspace keeps the original catalogue keys and assigned user-key map alongside provider IDs returned by API operations.

The aviary ID column changes meaning with the child table:

| Table | New parent in this package | Existing parent in Aviary |
|---|---|---|
| Resources | A resource is a new top-level row | Existing resources are referenced from child rows |
| Media | Resource User Key | aviary ID is the parent resource ID |
| Transcripts | Media User Key | aviary ID is the parent media ID |
| Indexes | Media User Key | aviary ID is the parent media ID |
| Supplemental files | Resource User Key | aviary ID is the parent resource ID |

Each child row must choose exactly one parent form. A resource ID must not be entered where a transcript expects a media ID.

The retained vendor example contains Tile attachment headers while its importer reads Title. Some sample rows also have unquoted commas that change their column count. The supplied profile maps the intended header explicitly; shifted or duplicate rows remain visible validation errors. Restricted content in the vendor’s OHMS example is excluded from this public source collection.

## Capture the public example

The example uses five public-domain USGS items: three audio recordings and two separately dated photographs. The capture script saves the complete original download bodies, publisher pages and HTTP metadata with byte lengths and SHA-256 hashes. It checks that each retained publisher page contains the public-domain statement.

| Resource | Media | Attached material |
|---|---|---|
| USGS amphibian audio | CoreFacts 109: frog declines and deformities | Original publisher transcript, extracted as untimed text |
| USGS amphibian audio | California red-legged frog vocalization | Authored 12-second navigation index; separate original frog photograph attached to the resource |
| USGS Forster’s tern | Forster’s tern attraction-tape excerpt | Authored 20-second navigation index; separate original tern photograph attached to the resource |

The two VTT files are authored navigation cues covering publisher-stated recording intervals. They are not source speech transcripts or claims about the time of a particular vocalization. The CoreFacts text comes from its original transcript section; HTML entities and paragraph whitespace are normalized, with the original HTML and extraction receipt retained.

From the application directory in the repository, run:

~~~bash
python3 -B examples/receive_usgs_example.py \
  --packet examples/usgs-example-input.json \
  --directory /absolute/aviary-usgs-example
~~~

Choose a persistent directory. A repeat with the identical input reopens and verifies completed captures. A changed source body does not overwrite an existing captured member. The script links captured bodies into the source tree when both directories use the same filesystem, so original assets occupy one set of storage blocks.

A failed publisher page does not prevent capture of the remaining sources. The script retains the actual HTTP status, selected response headers, response body, transport error and any Retry-After deadline under capture-attempts/. A resumed run respects an active deadline for that original host.

For publisher pages that need normal browser navigation, use an existing Playwright/Chromium installation and add --publisher-browser. The script first records the direct response, then opens the original public page in a fresh browser context. It retains the browser’s actual main-document response bytes and labels browser decompression explicitly. Add --browser-executable /absolute/path/to/chromium only when selecting an already installed browser. Successful original captures are reused in either mode.

When Playwright is installed in the Node runtime, add `--publisher-browser-runtime node`. Optional `--node-executable` and `--playwright-module` arguments select the existing Node binary and Playwright module entrypoint. The companion `examples/capture-publisher-page.mjs` returns the same original response bodies and capture records; the Python collector validates them and retains failed attempts before continuing. For example:

~~~bash
python3 -B examples/receive_usgs_example.py \
  --packet examples/usgs-example-input.json \
  --directory /absolute/aviary-usgs-example \
  --publisher-browser --publisher-browser-runtime node \
  --browser-executable /absolute/path/to/chromium \
  --playwright-module /absolute/node_modules/playwright/index.mjs
~~~

The optional --api-documentation switch captures the Aviary documentation HTML and specification locator. The exact reviewed OpenAPI document is identified in the provider contract; capturing a documentation page does not update that reviewed contract automatically.

The result includes:

- source/: five input CSVs, three original MP3s, two original JPEGs, one transcript, two navigation VTTs and source provenance.
- mapping.json: the complete five-table source mapping.
- receiving-result.json: actual counts, member hashes, original URLs and capture outcome.
- captures/: exact downloaded bodies and response metadata.
- capture-attempts/: failed responses and progress from any incomplete source intake.
- contract/: complete captured API documentation HTML and specification-locator contexts when requested.

Expected rows are **2 resources, 3 media, 1 transcript, 2 indexes and 2 supplemental files**. Asset sizes and hashes come from the actual capture receipt. If original sources are unavailable, the script completes the other captures, retains each failed response, and reports the remaining source IDs in one progress result. Repeating the same command continues that intake.

## Create and review a workspace

Choose a source directory and a different workspace directory. Do not place the input inside the new workspace.

~~~bash
python3 -B aviary.py init \
  --source /absolute/aviary-usgs-example/source \
  --workspace /absolute/aviary-migration \
  --mapping /absolute/aviary-usgs-example/mapping.json \
  --label usgs-public-audio
~~~

Initialization freezes and fingerprints the original source and saves mapping revision 0. Subsequent views and packages refer to those retained source bytes.

~~~bash
python3 -B aviary.py show --workspace /absolute/aviary-migration
python3 -B aviary.py mapping --workspace /absolute/aviary-migration
python3 -B aviary.py preview --workspace /absolute/aviary-migration
~~~

For the example, the initial keys are readable catalogue identifiers. Assign their Aviary user keys through the actual current revision:

~~~bash
python3 -B aviary.py assign-keys \
  --workspace /absolute/aviary-migration \
  --expected-revision 0
~~~

If a mapping has already changed, use the revision returned by show. Assignment preserves the original identifiers and saves explicit resource/media keyMaps. All local child relationships use those same maps.

The browser is another view of this workspace:

~~~bash
python3 -B aviary.py serve \
  --workspace /absolute/aviary-migration \
  --port 8769
~~~

Open the displayed local address. Review mapped rows, source identity, validation, packages and retained operation state there. Keep one writer for a workspace; mapping saves check the expected revision.

## Edit a source mapping

A complete mapping has schema stellar-forge.aviary-mapping.v1. Its tables object can contain resources, media, transcripts, indexes and supplemental. Each table declares an original CSV path, Aviary-to-original header mapping, explicit defaults, value conversions and ignored columns.

This is a small fragment; the delivered example contains all five tables:

~~~json
{
  "schema": "stellar-forge.aviary-mapping.v1",
  "tables": {
    "transcripts": {
      "path": "tables/transcripts.csv",
      "columns": {
        "Media User Key": "asset_key",
        "Sequence #": "sort_order",
        "Title": "Tile",
        "Path": "local_file",
        "Language": "language_tag",
        "Public": "visibility",
        "Captions": "caption_track",
        "Ignore Title": "ignore_heading",
        "Description": "editorial_note"
      },
      "defaults": {},
      "valueMaps": {
        "Public": {"open": "yes", "restricted": "no"}
      },
      "ignoredColumns": ["attachment_key"]
    }
  },
  "keyMaps": {"resources": {}, "media": {}},
  "exclude": {},
  "note": "Describe the original collection and reviewed mapping choices."
}
~~~

Every original column must be mapped or explicitly ignored. Ignoring a column in an import preserves it in the original source. Use defaults only for selected values such as Featured: no; missing source information should remain visible.

Resource and media tables preserve supported custom metadata. The receiving collection must configure required custom fields or special fields such as geolocation metadata. Preview findings identify values that require receiver interpretation.

Use exclude to omit a row by its original table/key with a stated reason. The row remains in the source and review. Children that still reference an excluded parent produce a broken-relationship finding.

Save a reviewed complete mapping using its current revision:

~~~bash
python3 -B aviary.py save-mapping \
  --workspace /absolute/aviary-migration \
  --input /absolute/reviewed-mapping.json \
  --expected-revision 1
~~~

A stale save returns REVISION_CONFLICT. Reopen the current mapping, retain your intended changes and save against its actual revision. An identical mapping reuses the existing revision.

## Resolve preview issues

Preview returns the source manifest hash, mapping revision/hash, mapped rows, exclusions, counts and issues. Its ready field is true when no error-level issue remains. Informational findings remain available for review.

| Finding | Correction |
|---|---|
| Incorrect CSV width or duplicate header | Repair the source collection in a new input preparation and retain the original for comparison |
| Unmapped column | Map it or add it explicitly to ignoredColumns |
| Empty or duplicate original key | Supply distinct original identifiers before assigning keys |
| Invalid user key | Use assign-keys or enter a complete valid retained map |
| Parent missing or both parent forms entered | Choose the correct included local key or actual existing parent ID |
| Missing asset | Include the original file at the declared relative path |
| Unsupported extension | Supply a supported original/exported format with provenance |
| Invalid sequence | Enter a positive Sequence # for media, transcript and index ordering |
| Invalid access value | Apply an explicit conversion to accepted provider values |
| Missing rights | Record the source rights or preserve the gap as a review finding |
| Source hash changed | Recover the retained bytes; a changed collection requires separately reviewed source input |

Source paths are relative and cannot escape their root. Local media must match its retained manifest and supported format/size contract. The native validator enforces Aviary’s documented 25 GB media limit; check any additional limit for the actual receiving service.

Resource access has three meanings: yes is public, no is restricted and blank is private. Other import tables use explicit yes or no. Choose each row’s access intentionally, including transcripts and indexes. Rights and visibility are separate inputs.

## Produce the native five-CSV package

When preview is ready:

~~~bash
python3 -B aviary.py package \
  --workspace /absolute/aviary-migration \
  --output /absolute/delivery/Aviary_Reviewed_Collection.zip
~~~

The ZIP contains an aviary-package/ directory with:

- Aviary-resource-csv-template.csv
- Aviary-media-csv-template.csv
- Aviary-transcript-csv-template.csv
- Aviary-index-csv-template.csv
- Aviary-supplemental-csv-template.csv

Selected assets travel in that package. The adjacent .zip.manifest.json records source identity, mapping revision/hash, counts, archive hash and every member. CSV output uses proper quoting and consistent row widths.

Use --revision N to package an earlier saved mapping over the same retained source. Choose a new output filename so an existing package is not overwritten.

The native package supports Aviary’s bulk-import workflow. A complete workspace handoff additionally carries the original source, reviews and API progress.

## Configure one API operation

Create a local JSON configuration using the actual organization origin, organization ID and destination collection ID. These values are examples:

~~~json
{
  "schema": "stellar-forge.aviary-client.v1",
  "baseUrl": "https://your-organization.aviaryplatform.com",
  "collectionId": "1234",
  "organizationId": "5678",
  "tokenEnv": "AVIARY_TOKEN",
  "authorizationScheme": "Bearer",
  "timeoutSeconds": 120,
  "partSize": 104857600,
  "multipartThreshold": 104857600
}
~~~

The token comes from the named environment variable. Configuration stores the variable name, not the credential. Use the receiver’s existing secret-injection method. The API requires the positive organizationId; the client sends it in the organization-id header. Optional caFile names an existing certificate file.

baseUrl is the organization HTTPS origin without an API path, query or embedded credentials. The client joins the documented routes. allowLoopback: true enables HTTP only for an explicit local receiving exercise.

Plan one stable migration:

~~~bash
python3 -B aviary.py plan \
  --workspace /absolute/aviary-migration \
  --config /absolute/aviary-receiver.json \
  --operation-id usgs-aviary-pilot-20261012
~~~

The plan binds workspace identity, source/mapping hashes, selected revision, receiving target and rows. Planning creates no remote resources. Repeating an exact plan returns the original operation. A different ID for the same workspace and target points back to its original migration.

Inspect the saved plan, then execute the authorized operation:

~~~bash
python3 -B aviary.py run \
  --workspace /absolute/aviary-migration \
  --operation-id usgs-aviary-pilot-20261012
~~~

Resources precede dependent media and attachments. The client records an action request before dispatch, saves returned IDs, and reuses confirmed actions.

Local media uses Aviary’s original upload description. Small files use a presigned upload URL; large files can use multipart upload with retained part identities and ETags. The client checks the file size, part count and part numbers. It opens each local media or attachment with a held file descriptor, verifies its full SHA256 and length against the saved plan before dispatch, and uses that same descriptor through every part and retry. A concurrent source change cannot silently substitute other bytes. Storage PUTs use the supplied storage route without forwarding the Aviary bearer token. Completion and metadata stay bound to the original media ID.

## Thumbnails and media delivery

Choose either Media Thumbnail Path for a retained local image or Media Thumbnail URL for an existing URL. The mapping review reports a row with both populated so the operator can choose its intended source before planning.

A local image is verified against the saved source and uploaded through Aviary’s thumbnail endpoint after its media record exists. It has a separate media:<user key>:thumbnail action, so a thumbnail failure preserves the completed media upload. A URL is sent with media creation using the maintained importer’s thumbnail_path parameter.

Each run returns mediaDelivery entries for local-file completion, the provider’s reported processing value when present, and the selected thumbnail outcome. COMPLETE means the planned records, source transfers, metadata and attachments have confirmed or positively reconciled results. Inspect the provider’s processing information when deciding whether a recording is ready for playback.

The native CSV package preserves each positive numeric Sequence #. The documented transcript and index creation endpoints have no sequence field; API dispatch follows the reviewed row order while the native package carries its explicit values.

## Continue a partial or interrupted run

Inspect show, then continue with the same run command. Preserve the original operation when a creation result is uncertain.

| State | Continuation |
|---|---|
| CONFIRMED or ADOPTED | Reuse the original result and provider ID |
| DEFERRED | Respect the actual retry time, then run the same operation |
| RETRYABLE | Correct the stated cause and continue the same operation |
| DISPATCHING or UNCERTAIN for creation | Find and reconcile the actual original provider record |
| UNCERTAIN completion, metadata or thumbnail | Run the original operation again to read and compare the original provider state |
| UPLOADING or UPLOAD_PENDING | Continue the original unfinished parts; refresh that upload’s URLs when required |
| Parent pending | Complete or reconcile the original parent |
| Changed request or source | Restore the bound input or review a deliberate new source |

If a creation reply was lost, obtain its actual original provider ID from the authorized receiver’s records. Use the exact action key from show:

~~~bash
python3 -B aviary.py reconcile \
  --workspace /absolute/aviary-migration \
  --operation-id usgs-aviary-pilot-20261012 \
  --action resources:1000:create \
  --provider-id 5678 \
  --note "Receiver matched the original collection, title and creation record."
~~~

Reconciliation reads the selected provider record, checks the original binding fields and records adoption. It preserves the original action and does not infer an ID from a title alone.

Completed local uploads reuse their recorded completion and metadata actions after a handoff. An unfinished upload can continue from the same original media record. If an adopted creation readback did not include upload URLs, the first supplied original manifest must match the mode, file size and part size in that saved creation request. Every later manifest must preserve the original upload identity and every dispatched part.

For expired or exported-away upload URLs, obtain a fresh provider upload manifest for the same original media and upload identity:

~~~bash
python3 -B aviary.py refresh-upload \
  --workspace /absolute/aviary-migration \
  --operation-id usgs-aviary-pilot-20261012 \
  --media-key 1000 \
  --input /absolute/original-media-refreshed-upload.json
~~~

The command rejects a changed media ID, upload mode, multipart ID, part size or part count. It saves the refreshed observation; run then continues the same upload.

If a completion response was lost, the next run reads the original media and downloads its original file for a streaming size/hash comparison. It also requires matching provider file-size analysis, the original collection/resource relationship and the already confirmed upload parts. A positive result adopts the original completion; accepted parts and the mutating completion request remain unchanged.

A lost metadata response is resolved by comparing all requested metadata values with the current original media record, including repeated values. A lost local-thumbnail response is resolved by reading its original thumbnail_url and matching the image bytes with the reviewed local source. These reads recur when the original operation resumes, respecting any provider retry deadline. If the provider changes the image or source-file bytes, review that specific action with the receiving operator.

For an explicitly selected completion, metadata or thumbnail action, reconcile accepts only the original media ID already bound to that action. The saved request and its history stay attached to the same operation.

A filesystem or process failure can leave a saved action without returned command output. Reopen its status/events first. Keep the workspace database and original source together.

## Retain transcript exports

After resources have been created or adopted:

~~~bash
python3 -B aviary.py transcripts \
  --workspace /absolute/aviary-migration \
  --operation-id usgs-aviary-pilot-20261012
~~~

Select particular existing resources by repeating --resource-id ID. The client checks that each selected resource belongs to the configured collection, following the collection’s resource pages when needed. It validates each transcript through its original media and resource, then reads its declared export formats and files. It retains IDs, formats, filenames, response evidence, lengths and hashes under exports/transcripts/.

Repeated retrieval reuses unchanged retained downloads. Changed retained bytes are reported. If a provider response declares further pages beyond its supported response, the client reports the incomplete list rather than marking that partial set complete.

## Export and receive the complete workspace

~~~bash
python3 -B aviary.py export \
  --workspace /absolute/aviary-migration \
  --output /absolute/delivery/Aviary_Migration_Workspace.zip
~~~

The ZIP includes application/, workspace/ and delivery/. Delivery contains the preview, operation status, human review and a native-package manifest. A ready mapping includes its native package. If the latest mapping is a draft, the handoff retains that draft and includes the most recent saved mapping that is ready; the manifest records both revisions. If no revision is ready, the complete source/workspace/application still exports and the manifest records the unresolved mapping issues. Workspace preserves source and database, mapping history, operation identity, action evidence and transcript exports. A top-level manifest binds the full membership.

Portable database copies remove live signed upload URLs. Completed actions retain IDs and progress. Unfinished uploads can adopt refreshed URLs for their original upload identity.

On another machine, use the delivered application:

~~~bash
python3 -B application/aviary.py receive \
  --source /absolute/Aviary_Migration_Workspace.zip \
  --output /absolute/received-aviary-migration
~~~

Receive binds the exact archive and manifest to the selected output. It verifies each original member, source and workspace ID, resumes complete members or exact interrupted media prefixes in private staging, and publishes the whole directory atomically. Repeat the same command after interruption. If the workspace was already received, the command reopens it while preserving later mapping revisions, provider actions and transcript downloads. An earlier receiver’s partial directory is adopted only after every retained member or prefix matches the original archive. An output bound to another archive returns its explicit identity conflict. Use the returned paths to reopen:

~~~bash
python3 -B /absolute/received-aviary-migration/application/aviary.py show \
  --workspace /absolute/received-aviary-migration/workspace
~~~

For API continuation, provide the original configuration’s environment variable, inspect the retained operation, refresh unfinished upload URLs when required and run that same operation. Confirmed resources retain their original IDs.

## Acceptance record

Retain the actual result with the delivered handoff:

1. Original inventory, source URLs/rights and exact hashes.
2. Saved mapping revision, header/value/key choices, exclusions and resolved preview.
3. All five CSVs, selected asset hashes and package manifest.
4. Receiving configuration identity, operation ID and actual resource/media/attachment IDs for a service run.
5. Upload receipts, completed action states and explicit reconciliation.
6. Transcript exports with source response/hash evidence.
7. Complete workspace export, receive into a new directory and reopened original state.

Identify a local API exercise as local. A service result should name the receiving organization/collection and verified IDs. The receipt must show the steps actually completed.

## Source attribution

The original publisher pages supply the source, credit, date and public-domain statements:

- [CoreFacts 109: frog declines and deformities](https://www.usgs.gov/media/audio/what-are-leading-causes-frog-declines-and-deformities).
- [California red-legged frog vocalization](https://www.usgs.gov/media/audio/california-red-legged-frog-vocalization).
- [Forster’s tern attraction tape](https://www.usgs.gov/media/audio/forsters-tern-attraction-tape).
- [California red-legged frog photograph](https://www.usgs.gov/media/images/california-red-legged-frog).
- [Forster tern photograph](https://www.usgs.gov/media/images/forster-tern).

The photographs have separate dates and credits; their placement beside audio does not claim they show the recording event. Resource descriptions and navigation cues identify their editorial role. The original publisher transcript remains untimed. Every downloaded body and the text-extraction method travel in the provenance.

## Complete local receiving exercise

The repository's examples directory contains one complete HTTP/storage receiving program. Run it against this exact application source:

~~~bash
python3 -B examples/run-aviary-receiving.py \
  --application . \
  --example /absolute/aviary-usgs-example/source \
  --out /absolute/aviary-native-receiving
~~~

The program starts two local HTTP origins and runs the complete client workflow with the required organization header, a resource found on the second collection page, original resource/media/attachment operations and a local thumbnail. It exercises a lost creation response, an interrupted multipart upload, lost completion/metadata responses with delayed provider readback, exact transcript downloads and a cold process reopening the exported application. It checks that completed records, accepted parts, completion requests and metadata updates keep their original identities through recovery. During complete workspace receiving it kills an owned copy process after the original media prefix is durably written, resumes that same inode through native receiving, and repeats the receive after a later saved mapping revision to confirm the original review and API progress are preserved. The separately supplied USGS directory retains its actual publisher-source inventory alongside this application receiving journey.

The result is receiving-result.json. The output directory retains the original input, HTTP and storage records, byte hashes, portable-workspace.zip, completed-workspace.zip and cold-reopen-result.json. A repeat with the same source and output directory reconciles its saved artifacts and continues the same operation.

The ten runtime/application files travel in a complete workspace handoff with that workspace's original input. The public-source collector and the local receiving program are available in the repository's examples directory for a new example capture or a new application receiving exercise.


### Complete browser receiving

`examples/run-aviary-browser-receiving.mjs` opens a saved public-source workspace and the completed original API receiving workspace through the actual local application. It assigns keys, saves mapping edits entered while an earlier response is in flight, saves and restores a reasoned resource exclusion, reviews all five source tables, builds and downloads the native package, and exports and cold-reopens the complete public workspace. The final migration view reopens the existing operation and confirms that switching between it and a new target draft preserves both the original provider IDs and the draft fields. Desktop and narrow screenshots, downloaded packages and the full receiving record are retained under the chosen output directory.

~~~bash
node examples/run-aviary-browser-receiving.mjs \
  --application /absolute/research/aviary \
  --workspace /absolute/public-usgs-workspace \
  --provider-workspace /absolute/api-receiving/received/workspace \
  --operation-id aviary-http-receiving-6ba15-20261012 \
  --out /absolute/browser-receiving \
  --browser-executable /absolute/path/to/chromium \
  --playwright-module /absolute/node_modules/playwright/index.mjs
~~~

Use the actual application and received workspace from `run-aviary-receiving.py`. The browser journey reads that saved provider operation and creates its public-source packages through the workbench. Capture results, screenshots and generated files belong to the executed run; its output directory must be retained through delivery.

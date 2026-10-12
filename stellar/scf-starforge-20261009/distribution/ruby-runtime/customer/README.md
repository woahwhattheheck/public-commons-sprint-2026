# Ruby customer commissioning workspace

Open the original native dataset or Baserow publication, retain its customer selection, run the existing Ruby customer program, and receive its complete Rails application into the managed runtime. The browser includes the existing environment, application, operation, log and archive controls.

The workspace uses the same private directory, Ruby environments, operation UUIDs, application registrations, leases and output files as [Ruby runtime](../README.md). A customer record joins those existing objects.

## Open the desk

Initialize or reopen the private runtime, then launch the customer browser:

~~~sh
ruby-customer-workspace serve --directory /absolute/private/ruby-runtime --create --port 8475 --startup-json
~~~

The startup object has schema `stellar-forge.ruby-customer-workspace-startup.v1`, status `RUBY_CUSTOMER_WORKSPACE_READY`, the original runtime directory, selected source hashes and a private loopback URL. Open that complete URL. Its token moves into the browser session; file downloads use the private session cookie.

The installed **Applications → Ruby customer commissioning** card opens the same desk from the selected initialized runtime directory. Port `0` selects an available port. The direct command defaults to `8475`.

| View | Work |
| --- | --- |
| Customers | Inspect original source, adopt a saved customer, retain selection, commission and receive the original application. |
| Environments | Inspect an actual Ruby executable, select Bundler and the full Gemfile, install or resume the private bundle. |
| Applications | Launch, stop, inspect, verify and export the complete original Rails working copy. |
| Operations | Read each original UUID, its worker, complete output, full result files, cancellation and same-operation resume. |
| Receive | Stream or select a complete runtime TAR archive, verify its original SHA-256 and install from its retained bundle. |

The latter four views preserve the original runtime browser source and behavior. The customer cohort includes exact copies of runtime browser `9a250837ca86a6a60b93be420ef5511d8af2233d` and style `f24068bb7c9de5d45dbd29783aec99205a36fd3b`. Its browser asset manifest uses the maintained local `root: "./"` format.

## Prepare an environment

In **Environments**, choose the actual executable spelling and exact Bundler version returned by the host. Save the supplied Rails profile or select the existing project directory, then install the retained bundle. The existing managed runtime preserves the original Gemfile, complete lock, dependency cache, client source inventory and installation result.

A Python virtual environment's executable spelling matters. Use the original absolute Python path, even when it ultimately resolves to a system executable. Use the original selected Node executable and source checkout.

Fresh Baserow source selections use the paired source-pinned lifecycle. Create their Ruby environment from the current customer source. An earlier environment remains bound to its original copied client; its existing saved customer argv can still be adopted.

## Select a native dataset

Select **Native SF100 dataset delivery** and the original completed room directory. **Inspect complete source selection** reads the original `manifest.json` and, when present, the hash-bound `semantics.json`. It shows the actual provider metadata, fields, row count, original snapshot, query identity, output descriptors and exact source hash.

Choose the original stable key fields. The native manifest supports up to 64 projected fields with the original identifier rule `[A-Za-z][A-Za-z0-9_]{0,47}`. If the native semantic primary key is complete, the form initially selects its projected fields. The model also preserves an explicitly empty `keys: []`; the unchanged original native lifecycle derives the complete semantic key itself.

Retain the original source key, dataset ID, source checkout, Python, Node and customer output directory. A new output must have an existing original parent directory and remain separate from the source room, checkout and runtime directory.

Saving this selection records the exact original manifest and semantic metadata before any customer operation. **Commission and receive application** runs the maintained `native-dataset-lifecycle` entry. It receives every original native page, retains complete values and source semantics, builds the real Rails mapping and database, imports the full revision, produces the full preview and receipt, and reopens the independently copied application.

The customer desk registers that original `received-application` with the same managed environment.

## Select a Baserow publication

Select **Baserow published source** and the directory containing the original completed native publication's `native-result.json`. The source must carry the original completed publication, publisher directory, retained candidate, snapshot, source hash, capture hash and source operation identity.

Supply the original customer key, dataset ID, checkout commit and optional selected query. The existing Baserow customer program retains the original record identity, exact selected field aliases, native page/finalization behavior and every applicable attachment reference and complete file.

The selected source SHA-256 passes through the native argument `--expected-original-result-sha256`. The paired Ruby lifecycle checks the original file before saving its customer input or publishing a customer result. A changed source returns `RUBY_CUSTOMER_SOURCE_CHANGED` or the original Ruby source-binding error. The saved customer input schema remains unchanged.

The desk runs `baserow-customer-lifecycle` and registers its original `delivered-application`. That application includes the complete Rails operator interface, received dataset, domain mapping, transactional import and edition history, original attachments and full moved-application receiving.

## Adopt an existing customer

Use **Open existing customer** when the original native or Baserow customer output already exists. Its `lifecycle-input.json` supplies the actual source/runtime/output values. The inspection returns `input.sha256`; saving adoption requires that exact `expectedInputSha256`.

A completed original output can be adopted when its producer path is unavailable. The original completed customer program reopens its retained delivery and application. The desk retains the original source identities and source path for attribution and uses the completed customer output for receiving.

The runtime finds an existing customer operation with the same environment, native entry and original arguments. It preserves the literal existing argv. If more than one operation matches, select the actual operation UUID. The same rule applies to an existing application. Explicit IDs must match the selected original source and environment.

Saving adoption retains the selection. **Commission and receive application** advances its selected original operation and registration.

## Completion and restart

| Phase | Meaning and action |
| --- | --- |
| `SELECTING` | Original request exists; repeat that same saved selection to complete its metadata. |
| `SELECTED` | Source, environment, output and original operation identities are retained. Advance to commission. |
| `COMMISSIONING` | Original customer operation is queued or active. Read its full log in Operations. |
| `CUSTOMER_COMPLETE` | Native customer output is complete. Advance to its original application registration. |
| `CUSTOMER_NEEDS_RESUME` | Original customer operation ended with a failure, cancellation or interruption. Correct its reported cause and resume that phase. |
| `REGISTERING` | Original managed application registration is queued or active. |
| `REGISTRATION_NEEDS_RESUME` | Correct the original registration's reported cause and resume that same phase. |
| `FINALIZING` | Registration succeeded. Advance once more to retain the joined customer receipt. |
| `READY` | Original customer result, application registration and joined receipt are retained; complete result download is available. |

The browser saves the complete selected action before sending it. After a lost response it offers the same original action, with the same customer/request/operation identifiers. Starting commissioning retains a browser continuation that follows the original worker and finalizes registration, including `FINALIZING`. Reopening the same browser session can continue that original selection.

A failed phase requires explicit same-operation resume. **Pause desk continuation** pauses browser follow-through; the worker remains in the original runtime. Closing the listener drains admitted requests and closes the original runtime handle. Detached original workers remain available through their retained operation journal. Cancellation reaches the selected customer or registration operation; resume continues that UUID.

## Complete output and application operation

The customer detail downloads:

- `selection.json`: complete customer identity, environment, native command, source descriptors and original application binding.
- Every retained original manifest, semantic document or adopted `original-input.json`.
- `result.json`: the complete original customer result, with its original file SHA-256.

These downloads stream an independent, complete, hash-verified file descriptor. HTTP supports `HEAD`, one byte range, exact content length, ETag and `X-Content-SHA256`.

**Operate received application** opens the original Applications view. Launch uses the original application and environment selection hashes. Stop the managed application before exporting its database. The existing export retains the complete environment, bundle, client and stopped working application; receiving installs its retained dependencies and reopens the actual full application.

## CLI

Source and existing-customer inspections do not require an initialized runtime:

~~~sh
ruby-customer-workspace source --kind native --source-directory /absolute/private/original-room
ruby-customer-workspace existing --output-directory /absolute/private/original-customer
~~~

Save a private selected request JSON, then use that exact file for repeat selection:

~~~json
{
  "id": "native-customer",
  "title": "Native dataset customer",
  "requestId": "ed648b2a-014c-4df3-9982-8e1c8aee0dbf",
  "environmentId": "rails-customer",
  "kind": "native",
  "sourceDirectory": "/absolute/private/original-room",
  "expectedSourceSha256": "ORIGINAL_MANIFEST_SHA256",
  "outputDirectory": "/absolute/private/customer-output",
  "checkout": "/absolute/original-source",
  "python": "/absolute/python-environment/bin/python",
  "node": "/absolute/node",
  "datasetId": "original-dataset-id",
  "sourceKey": "original-source-key",
  "keys": ["original_key_field"]
}
~~~

Replace the hash, source identifiers, actual paths and UUID with the original host's selected values. Optional `applicationId`, `operationId` and `registrationId` select existing matching native objects.

For Baserow, use `kind: "baserow"` and supply `customerKey`, `sourceRef` and optional `query` instead of `sourceKey`/`keys`. `expectedSourceSha256` is the original completed Baserow native-result file hash.

For adoption, the complete body is:

~~~json
{
  "id": "existing-customer",
  "title": "Existing customer",
  "requestId": "188190f1-7079-4d4a-9113-5f8126ef0d8a",
  "environmentId": "original-environment",
  "outputDirectory": "/absolute/private/original-customer",
  "expectedInputSha256": "ORIGINAL_LIFECYCLE_INPUT_SHA256"
}
~~~

~~~sh
ruby-customer-workspace select --directory /absolute/private/runtime --input /absolute/private/selected-customer.json
ruby-customer-workspace adopt --directory /absolute/private/runtime --input /absolute/private/adopt-customer.json
ruby-customer-workspace list --directory /absolute/private/runtime --offset 0 --limit 25
ruby-customer-workspace customer --directory /absolute/private/runtime --id native-customer
ruby-customer-workspace commission --directory /absolute/private/runtime --id native-customer --selection-sha256 ORIGINAL_SELECTION_SHA256 --wait
ruby-customer-workspace resume --directory /absolute/private/runtime --id native-customer --selection-sha256 ORIGINAL_SELECTION_SHA256 --phase customer --wait
ruby-customer-workspace file --directory /absolute/private/runtime --id native-customer --name result.json --out /absolute/private/original-result.json
~~~

`--wait` prints actual phase changes to stderr and returns the complete current customer. Ctrl-C requests cancellation of the active original phase. The output file command streams the complete original snapshot and verifies an existing destination before accepting a completed replay.

Use `ruby-runtime` for the same environment installation, log paging, application launch, stopped export and receiving commands. The browser exposes those same operations.

## JavaScript API

Import `openRubyCustomerWorkspace` from the installed `./ruby-runtime/customer` export. Open it with `{directory, create?}`. The handle forwards every maintained Ruby runtime method without changing its arguments or native behavior.

| Method | Exact input |
| --- | --- |
| `previewSource` | `{kind: "native" \| "baserow", directory, expectedSha256?}` |
| `previewExisting` | `{directory}` |
| `customers` | `{offset?: 0, limit?: 25}`; limit 1–100 |
| `customer` | `{id}` |
| `selectCustomer` | Complete selected body above |
| `adoptCustomer` | Complete adoption body above |
| `advanceCustomer` | `{id, expectedSelectionSha256}` |
| `resumeCustomer` | `{id, expectedSelectionSha256, phase: "customer" \| "registration"}` |
| `cancelCustomer` | `{id, expectedSelectionSha256, phase: "customer" \| "registration"}` |
| `openCustomerFile` | `{id, name}` → `{handle, name, bytes, sha256, type}`; caller closes handle |
| `inspect` | Original runtime inspection with customer schema and first customer page |
| `close` | Drain admitted calls, then close the original runtime handle |

Source previews retain `manifest: {name, bytes, sha256}`, `summary`, and complete `metadata: {manifest, semantics}`. Existing previews return the original `input` descriptor, normalized `selected`, native `entry`, generated `argv` and complete original `result` when available.

A retained customer returns `schema: "stellar-forge.ruby-customer.v1"`, `id`, `title`, `phase`, `selectionSha256`, `requestId`, `createdAt`, `source`, `selected`, `environment`, `customerOperation`, `customerOperationId`, `entry`, `argv`, `registrationOperation`, `registrationId`, `applicationId`, `applicationDirectory`, `application`, `result`, and `files`. A `SELECTING` record instead returns its complete retained `request` and `requestSha256`.

The customer page returns `schema: "stellar-forge.ruby-customers.v1"`, `offset`, `total`, `nextOffset` or `null`, and the complete `customers` array. Paging includes retained selections only.

## Local HTTP

The existing private session, original runtime routes and streamed TAR receiving remain available.

| Method / route | Model method |
| --- | --- |
| `POST /api/customer/source` | `previewSource` |
| `POST /api/customer/existing` | `previewExisting` |
| `POST /api/customer/select` | `selectCustomer` |
| `POST /api/customer/adopt` | `adoptCustomer` |
| `POST /api/customer/advance` | `advanceCustomer` |
| `POST /api/customer/resume` | `resumeCustomer` |
| `POST /api/customer/cancel` | `cancelCustomer` |
| `GET /api/customers?offset=0&limit=25` | `customers` |
| `GET /api/customer?id=ID` | `customer` |
| `GET/HEAD /api/customer/file?id=ID&name=NAME` | `openCustomerFile` |

JSON bodies are capped at 1 MiB. Native source metadata is read from the selected host path. Complete returned files and original runtime TAR archives stream independently of that JSON request limit. Existing runtime receiving allows complete archives up to 4 GiB.

Actionable errors retain exact identifiers: `RUBY_CUSTOMER_SOURCE_CHANGED`, `RUBY_CUSTOMER_REQUEST_CHANGED`, `RUBY_CUSTOMER_ORIGINAL_INPUT_CHANGED`, `RUBY_CUSTOMER_OPERATION_SELECTION`, `RUBY_CUSTOMER_OPERATION_CHANGED`, `RUBY_CUSTOMER_APPLICATION_SELECTION`, `RUBY_CUSTOMER_ENVIRONMENT_CHANGED`, and `RUBY_CUSTOMER_SOURCE_PIN_CLIENT_REQUIRED`.

## Continue the original managed customer journey

[examples/customer-workspace.mjs](examples/customer-workspace.mjs) is a complete executable continuation of the [existing managed customer program](../examples/customer-runtime.mjs). Run it after that original program has completed, using the same retained directory:

~~~sh
node stellar/scf-starforge-20261009/distribution/ruby-runtime/customer/examples/customer-workspace.mjs \
  --managed-directory /absolute/private/original-managed-customer \
  --customer-id original-customer
~~~

It reuses the actual producer environment, original customer operation UUID, original application registration UUID and customer output. It adopts that existing customer, opens the real loopback desk, authenticates its private session, reads all six browser assets, reviews the original source input, finalizes the joined receipt through HTTP, receives every complete customer source/result file, closes the listener, and reopens the original customer.

The original `customer-workspace/customer-workspace-result.json` retains actual row/field identities, original operation/application IDs, complete received files and hashes, HTTP results and reopen outcome. Repeating the same command reads that completed result and verifies all original files without creating another customer operation.

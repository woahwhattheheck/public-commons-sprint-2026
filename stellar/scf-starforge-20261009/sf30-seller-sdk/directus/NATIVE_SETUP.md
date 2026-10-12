# Directus native setup and complete receiving

The maintained `native-setup.py` runs one official Directus 12.5.0 instance, creates an isolated versioning-enabled collection, and runs the original `native-customer.mjs` and `native-browser.mjs` against that instance. It uses the caller's installed Starforge dependencies and browser runtime.

## Inputs and ownership

The caller owns one admitted process tree and one persistent project directory. Pass an owned runtime directory with enough space for the official npm dependency installation. Runtime staging may be temporary, but it must remain available until the entire process tree exits. The project retains the private Directus database, generated credentials, exact HTTP responses, source manifest, customer SQLite project, browser results and original logs.

The command acquires a nonblocking exclusive lock in that project. A repeated completed invocation verifies the same intent plus the retained customer report, exported project and browser report before returning the original result.

Supply a UTF-8 JSON source packet with `schema: "stellar-forge.directus-native-source-packet.v1"`, an immutable `productCommit`, and `files`. Each file contains its repository-relative `path`, UTF-8 `content`, byte count `bytes`, full `sha256`, and Git blob SHA-1 `gitBlob`. The controller verifies each byte sequence before composing it over the explicit original installed SDK source. Include the exact native customer, native browser, shared semantic receiving modules and the product's source closure selected for this operation. Original installed dependency files are reused through the explicit node_modules path; source modules are copied into the owned source tree so imports resolve the selected shared postimages.

## Invocation

Run this through the existing equipped worker or maintained native admission interface:

```sh
python3 -B native-setup.py \
  --project /absolute/persistent/customer-project \
  --sources /absolute/persistent/source-packet.json \
  --operation-id directus-customer-original-operation \
  --runtime-root /absolute/owned/runtime \
  --sdk-source /absolute/installed/source/stellar/scf-starforge-20261009 \
  --node-modules /absolute/installed/node_modules \
  --node /absolute/runtime/bin/node \
  --npm /absolute/runtime/bin/npm \
  --playwright /absolute/installed/playwright \
  --chromium /absolute/installed/chromium
```

Use the actual runtime and storage requirements when admitting the operation. This command relies on the configured npm registry and requires Node 22 or later. It installs `directus@12.5.0` with its normal dependencies and records the resulting package lock, Directus package and API 40.0.0 package. The completed installation marker is published only after npm returns successfully. Interrupted installations resume through npm's original installer.

## Native customer and browser

The setup creates three actual records, a related owners collection, nullable and empty values, a decimal field, an exact large numeric string and a field intentionally omitted from the selected source query. The main collection has native versioning enabled.

The original customer performs authenticated capture, native draft creation/save/compare/promotion/readback, a successor source edition, the existing seller and paged customer acquisition, complete source receiving, SQLite export/reopen, and seller restart. The browser then receives that completed project, opens the maintained operator, exercises native authoring and source capture, inspects edition/query/merchant/customer views, downloads and receives a complete project, and reopens the operator. The selected source defines the exact customer checks; all original responses and results remain attributable to that source generation.

Generated Directus credentials stay in the selected project's private directory and are passed to the original modules through their environment. The controller records no authentication header in its HTTP receipts. It closes its Directus process before publishing `NATIVE_RESULT.json` with `status: "PASS"`. Failures retain their original exception, phase history and log locations; the caller reconciles the same native job or records an explicit source-bound continuation as appropriate.

## Retained results

`NATIVE_RESULT.json` identifies the executed source manifest, official runtime versions, customer result and project hashes, and browser result hash. `receipts/` contains the actual package lock and setup API responses. `customer/` and `browser/` contain the original product outputs, while `private/` retains the isolated database and connection state for the same operation.

# Retained OpenSearch customer review

This receiving workflow completes preparation, release comparison, customer export and a fresh-process reopen from an existing OpenSearch workspace. It uses the original saved captures, compiler, package verifier, release store and customer-export reader.

The operator can inspect the seven-result and six-result editions, compare their source content and query definitions, prepare the six-result merchant package, inspect the two release contracts, and download the previously generated managed customer client. Both prepared packages include the generated JavaScript client, TypeScript declarations and OpenAPI.

## Files and prerequisites

Use Python 3.10 or later and the original Node 24 or later runtime. The receiving directory must already contain:

- `receiver.lock`, the original receiver ownership lock;
- `workspace/workspace.sqlite3` and all of its retained `sources/`, `packages/`, `deployment/` and `deployment.clients/` files;
- `managed-source.json` and the unchanged `deployment-journey.json`;
- the original complete `source-runtime-<fingerprint>.zip`;
- the explicit selection JSON described below.

The source distribution must retain all four neighboring files: `retained-local-network.mjs`, `retained-review.mjs`, `run-retained-review.py` and this guide. The bootstrap verifies every original source archive member and records these four additive receiving files separately.

Close other operators for the same receiving directory before opening this workflow. It takes the original kernel lock for the entire preparation and two-process reopen.

## Run the local receiving workflow

Supply the retained receiver, exact source archive and its SHA-256, the existing selection file, and a temporary directory with enough room for the original source distribution:

~~~sh
python3 run-retained-review.py \
  --directory /absolute/path/to/receiver \
  --archive /absolute/path/to/receiver/source-runtime-FINGERPRINT.zip \
  --expected-archive-sha256 ARCHIVE_SHA256 \
  --selection /absolute/path/to/retained-selection.json \
  --runtime-root /absolute/path/to/temporary-runtime \
  --node /absolute/path/to/node
~~~

The source runtime is reconstructed in a newly owned temporary directory. Its exact original contents are verified before the product opens. The temporary runtime is removed after the two child processes finish; the receiving workspace and customer exports remain in the original directory.

On a Commons shared worker, use the maintained native foreground runner with the source archive, receiver, Node runtime and four receiving source files registered as inputs. Declare the measured output and temporary runtime space. The local workflow needs no browser, provider bridge or additional dependency installation.

## Selection contract

The selection is a JSON object with schema `stellar-forge.opensearch-retained-selection.v1`. It binds one receiving operation to original saved identifiers:

| Field | Purpose |
|---|---|
| `operation` | Stable identity of this local receiving operation |
| `workspaceId`, `sourceProfileSha256` | Original workspace and connection-profile identities |
| `baseEditionId`, `baseResultSha256` | Original seven-result capture and exact result-file checksum |
| `basePackageId` | Original prepared merchant package |
| `upgradeCaptureRequestId` | Existing completed six-result capture request |
| `baseReleaseId`, `upgradeReleaseId` | Retained seven-result release and the prepared six-result release |
| `baseClientExportId` | Previously completed managed customer export |
| `baseClientManifestSha256`, `baseClientArchiveSha256` | Original client manifest and complete archive checksums |
| `originalLiveReportSha256` | Exact unchanged live-journey checkpoint |
| `deniedNativeOperation` | Original live operation associated with the retained connection boundary |
| `providerBoundary` | Observed provider destination and error, with no credentials or proxy address |

Resolve these fields from the retained native reports and original workspace. The driver requires the selected original capture request to be complete, the base capture to have seven hits over three pages, and the upgrade capture to have six hits over four pages with its PIT released. The fourth upgrade page is the original adapter's truncation lookahead. It verifies both result checksums before preparing anything.

## What the operator receives

The `retained-review/` directory contains:

- `retained-review.json`: original identifiers, selected source, completed actions, export checksums and the two process records;
- `receiving-run.json`: bootstrap state, source assembly, actual child exits and cleanup;
- `source-assembly.json` and `selection.json`;
- original result JSON, edition JSON and CSV for both captures;
- a capture comparison that preserves original document identity and query scope;
- `customer/prepared-six-result/`, containing all eleven original compiler outputs;
- the source/release comparison and six-result deployment instructions;
- `customer/retained-v1-managed-client.tar.gz` and its verified member files.

The six-result package's client is generated from its prepared OpenAPI. The retained v1 managed client carries its original running-instance export manifest. Each remains connected to its own source and generation record.

The first process uses the existing workspace APIs to prepare and stage the new package, then reads the original export through the existing local HTTP download path. It checks that the active release, previous release and generation remain the same. It uses both generated clients to build the actual typed flight request locally.

The second process independently opens the same saved workspace. It verifies both capture identities and checksums, both staged release digests, the prepared package, every delivered file, and the exact managed customer archive returned by the original reader. Completion is recorded in the separate retained-review report.

## Network behavior

The receiving guard installs before importing the product. Only HTTP connections to numeric loopback listeners opened by that process are permitted. A listener's allowance ends when its own close begins; a later listener on the same port has separate ownership.

External sockets, TLS, HTTP/2, DNS lookups, datagrams, WebSockets, child processes, worker threads and provider-source opening are disabled inside the guarded Node process. Fetch follows no redirects. The Python bootstrap only verifies files, assembles source and starts the two guarded Node processes.

The original Playground bridge is never started by this receiving command. The live seller source and normal live operator remain available through their original launchers. A seller start, a running-instance v2 customer export and a running rollback still require the configured OpenSearch connection. Their existing native checkpoint is retained separately from this completed local review.

## Continue the customer deployment

Use the complete original workspace in the normal deployment console when the configured OpenSearch connection is available. The six-result package is already prepared and staged; inspect the saved comparison, select its retained release at the displayed generation, and use the original start/restart action. Generate its managed customer client from the actual running seller. Keep both customer archives with their original manifests when handing the installation to another operator.

The underlying commercial workshare and the original relationship owner remain attached to the existing opportunity. This receiving workflow supplies the reusable source, query editions, prepared contracts and customer files for that handoff.

# Dataset preparation and edition review as a file job

This application converts the customer's complete JSON inputs into an original
queryable dataset and a recoverable delivery. It uses the existing paid-jobs
intake, sealed originals, job execution and customer download. The original
NDJSON workspace supplies mapping, exact-number projection, native queries,
edition comparison and six-file project receiving.

A successful result is one ZIP containing the original files, the complete CSV
and configuration for every edition, each portable project, a saved workspace,
the requested query, the full edition comparison and a plain HTML review.
Mapping and query corrections return a complete REVIEW_REQUIRED delivery that
retains the originals and names the precise stage requiring attention.

## Configure the merchant

Install a Starforge distribution containing this contribution and its declared
schema runtime dependency. The runtime must provide Node and Python 3. The
Python application uses the standard library; native dataset queries use the
original declared re2js package through SF30's existing engine.

In a merchant-owned directory, save example-merchant.json and copy
installed-application.mjs as application.mjs. The shim resolves the installed
Starforge export. Keep the installed distribution intact so its original Python
workspace, native dataset engine and receiving tools remain together.

Set publicOrigin, payment network, asset, recipient and amount in the merchant
configuration. Set these two operator environment variables to actual absolute
executables:

~~~sh
export SF30_NDJSON_PYTHON=/usr/bin/python3
export SF30_XML_NODE=/absolute/path/to/node

starforge jobs serve \
  --config /srv/starforge/dataset-jobs/example-merchant.json \
  --state /srv/starforge/dataset-jobs/merchant-state \
  --native-factory /srv/starforge/native-runtime.mjs \
  --start-worker
~~~

Use the original [paid-jobs installation](../../jobs/INSTALL.md) for native
factory setup, the four service ports and HTTPS routing. The application's
configured purchase route is /dataset-preparation. Its original file intake and
customer results use the same /jobs routes as other paid jobs.

For source development, example-merchant.json can stay beside application.mjs
in this directory. Both installed and source use the same application and
original workspace.

## Prepare the request

Choose prepareDataset in the existing Request application. Save its ordinary
inputs, attach the original files, and prepare its original checkout. The
[original input-file guide](../../jobs/inputs/README.md) gives the complete
browser, command and interrupted-transfer workflow.

| Input slot | Required | Accepted originals | Maximum |
| --- | --- | --- | --- |
| source | Yes | UTF-8 NDJSON or complete JSON package | 32 MiB |
| mapping | Yes | Original NDJSON mapping JSON | 64 KiB |
| baseline | Optional | A previous edition of the same dataset | 32 MiB |

For NDJSON, use sourceFormat: "ndjson". Each nonblank line must contain one JSON
object. The original bytes are retained exactly.

For a package containing an array, use sourceFormat: "json-array" and set
sourceArrayPointer explicitly. An empty pointer selects an array at the root;
/grants selects the grants array in a 360Giving package. JSON Pointer escapes
~0 and ~1 identify literal tilde and slash characters. The service retains the
whole package and writes the selected original objects to normalized JSON Lines,
preserving every original numeric token and nested value.

The optional baseline uses the same mapping. baselineFormat and
baselineArrayPointer default to the source settings. Compare editions of the
same identified dataset; independent funds remain separate jobs.

| Ordinary input | Meaning |
| --- | --- |
| reportName | Required report title, at most 120 characters |
| sourceLabel / baselineLabel | Edition names shown in the review |
| sourceFormat / baselineFormat | ndjson or json-array |
| sourceArrayPointer / baselineArrayPointer | Explicit JSON Pointer for array inputs |
| queryJson | Original query parameter object encoded as JSON; default {"limit":"50"} |

The example-mapping.json preserves an exact string id and the full record as
JSON. Use a domain mapping to expose useful columns, filters and sort keys.
Map exact monetary values and identifiers exceeding JavaScript's exact integer
range as strings. Retain missing/null distinctions with state columns and keep
full arrays or nested objects with JSON columns. The
[NDJSON source guide](../README.md) describes the original mapping contract.

For example-input.json and an original grants package, attach that package as
source and a reviewed grant mapping as mapping. Attach a baseline only when a
corresponding edition is intended. The original customer Request application
handles chunk hashing, missing-chunk resumption, sealing and checkout.

## Open and receive the delivered result

Use the existing customer Jobs, Fetch and Resource library workflow to retrieve
dataset-project.zip. Open review.html after extraction for the report, complete
CSV links, mapping/query corrections and comparison counts.

For a complete receiving workspace, use the original downloaded archive:

~~~sh
starforge dataset-ndjson-job receive \
  --file /srv/starforge/downloads/dataset-project.zip \
  --out /srv/starforge/received/publisher-edition \
  --python /usr/bin/python3 \
  --sha256 SELECTED_JOB_RESULT_SHA256
~~~

The receiver verifies the complete archive inventory and restores every member.
It reconstructs each portable project through the original engine in
customer-workspace, repeats successful queries and the original comparison,
then closes and reopens the workspace. Repeat the same command after an
interruption. An existing file is reused only when its complete bytes match.
Receiving an already completed delivery preserves its original receiving result.

Use the existing source console to work with the received editions:

~~~sh
starforge dataset-ndjson \
  --workspace /srv/starforge/received/publisher-edition/customer-workspace serve
~~~

## Files in the complete delivery

| Path | Contents |
| --- | --- |
| review.html | Plain industrial review with links and a 25-row preview |
| result.json | All edition identities, transformation details and correction items |
| manifest.json | Complete member inventory with byte lengths and SHA-256 |
| request.json | Original job, attempt, ordinary input and sealed-file descriptors |
| originals/ | Complete source, mapping and optional baseline |
| normalized/ | Lossless JSON Lines selected from array packages |
| editions/source/ | Complete CSV, configuration, project and native query |
| editions/baseline/ | The same complete files for an optional baseline |
| comparison/ | Full changes and original comparison summary |
| workspace/ | Closed source workspace with retained sources, plans and builds |
| RECEIVING.md | Receiving commands and exact data treatment |

The delivery ZIP is limited to 64 MiB and its expanded members to 512 MiB.
Each source limit, row limit and projected cell limit remains explicit in the
merchant configuration or selected mapping. Full CSVs and complete comparisons
are retained even when the HTML shows a shorter preview.

## Native execution and recovery

The application reads the original sealed file handles and copies verified
bytes into its private execution directory. It calls Python through the
merchant's context.processes API. That API keeps native process and directory
ownership outside the terminable Node Worker. Cancellation, timeout and normal
completion retire the selected process group before the attempt completes.
A merchant process exit disconnects the same supervisor, which retires its
native process group and removes its private execution directory.

The original paid job remains responsible for payment association, execution
attempts, explicit retries and immutable customer results. A successful file
job returns the complete ZIP as its configured byte result. A failed native
runtime records a failed attempt through the same original execution path.

# SFTP report merchant

Turn files from a private SFTP account into reviewed, versioned datasets with the
original Stellar x402 seller, buyer, and recurring publisher. The source adapter
reads a configured folder, captures complete file bytes, and projects a named
report into the existing CSV dataset contract. The browser workspace retains
source and merchant revisions and opens the original publication console.

## Start from the maintained product

Use Node 22.5 or newer on Linux. The source requires `ssh2@1.17.0`; the publisher
uses the original Linux workspace lock. In a source checkout, install the exact
declared source runtime:

```sh
npm ci --ignore-scripts --omit=optional --prefix stellar/scf-starforge-20261009/sf30-seller-sdk/sftp
```

The maintained distribution exposes `sftp`, `sftp-publisher`, and
`sftp-workspace`. Direct source entrypoints are `sftp/cli.mjs`,
`sftp/publisher/cli.mjs`, and `sftp/workspace/server.mjs`. Each prints its complete
command arguments with `--help`.

## Configure and inspect a connection

Save a private source JSON file with mode 0600. Set the authentication reference
in the process that starts the workspace:

```sh
export SFTP_PRIVATE_KEY_FILE=/absolute/private/path/client-key
chmod 600 /absolute/private/path/client-key /absolute/private/path/source.json
```

The environment value for a key-file reference is an absolute path. A source may
instead name `privateKeyEnv` or `passwordEnv`, and a private key may also name
`passphraseEnv`. The declaration contains environment names; the environment or
private key file supplies the credential at connection time.

Declare the server's independently confirmed OpenSSH SHA256 host-key fingerprint.
For a host key supplied by the server operator, `ssh-keygen -lf HOST_KEY.pub -E
sha256` prints this fingerprint. The adapter compares the raw host key before
authentication. The configured array can hold the current and next independently
confirmed keys during a planned rotation.

A connection-only source uses `queries: {}`. Open its catalogue before authoring
the first report. The configured `root` is an absolute remote path. Catalogue and
report paths are relative to that root; canonical resolution must remain within
it. A report must resolve to a regular file.

```json
{
  "schema": "stellar-forge.sftp-source.v1",
  "connection": {
    "host": "sftp.example.com",
    "port": 22,
    "username": "reports_reader",
    "hostKeyFingerprints": ["REPLACE_WITH_CONFIRMED_SHA256_FINGERPRINT"],
    "auth": { "privateKeyFileEnv": "SFTP_PRIVATE_KEY_FILE" }
  },
  "root": "/exports",
  "limits": {
    "maxFileBytes": 67108864,
    "maxRowBytes": 1048576,
    "timeoutMs": 300000,
    "maxDirectoryEntries": 10000
  },
  "queries": {}
}
```

```sh
node sftp/cli.mjs inspect /absolute/private/path/source.json
node sftp/cli.mjs catalogue /absolute/private/path/source.json --path housing --limit 200
node sftp/cli.mjs sample /absolute/private/path/source.json --path housing/production.json --format json --records-pointer /records --out /absolute/private/path/sample.json
```

A directory response includes `totalEntries`, `offset`, `nextOffset`, and
`directoryComplete`. Sampling first captures the complete file and counts all
records; the displayed rows and suggested field types cover the selected first
records. The sample records the exact capture hash and distinguishes sample size
from full record count.

## Author a named report

Add a report under `queries`. A report fixes the relative file path, format,
record-array pointer for JSON, exposed aliases, scalar types, missing-value
handling, and permitted parameterized comparisons. Operators choose typed inputs;
the remote file path and projection remain in the saved source revision.

```json
{
  "preservation": {
    "path": "housing/production.json",
    "format": "json",
    "recordsPointer": "/records",
    "columns": {
      "project_id": { "pointer": "/project_id", "type": "string" },
      "building_id": { "pointer": "/building_id", "type": "string", "nullable": true, "missing": "null" },
      "bbl": { "pointer": "/bbl", "type": "string", "nullable": true, "missing": "null" },
      "construction": { "pointer": "/reporting_construction_type", "type": "string" },
      "units": { "pointer": "/all_counted_units", "type": "integer" },
      "completed": { "pointer": "/project_completion_date", "type": "string", "nullable": true, "missing": "null" }
    },
    "parameters": {
      "construction": { "type": "string", "required": true, "default": "Preservation" },
      "minimumUnits": { "type": "integer", "required": true, "default": 0 }
    },
    "where": [
      { "column": "construction", "op": "eq", "parameter": "construction" },
      { "column": "units", "op": "gte", "parameter": "minimumUnits" }
    ]
  }
}
```

Field pointers follow JSON Pointer: `/Header with spaces` addresses a CSV header,
`~1` escapes a slash, and `~0` escapes a tilde. A JSON source must select an
array of record objects using `recordsPointer`; an empty pointer selects a root
array. NDJSON uses one record object per nonempty line. CSV uses the original
incremental parser, including quoted delimiters, escaped quotes, and embedded
newlines.

| Source value | Explicit projection |
| --- | --- |
| Text | The original string is retained. |
| JSON numeric token projected as Text | The exact token is retained, including large integer identifiers and decimal lexemes. |
| Integer | The value must be a finite safe JavaScript integer. Choose Text for larger exact identifiers. |
| Number | The value is an explicitly selected finite JavaScript number. |
| Boolean | JSON uses a native Boolean; CSV accepts `true` and `false`. |
| Null | The column must explicitly allow null. |
| Missing field | The default is an error; `missing: "null"` requires `nullable: true`. |
| Nullable CSV empty cell | It maps to the original dataset's null representation. |
| JSON empty string | It remains an empty string; a nullable public CSV column rejects the empty-string/null ambiguity. |
| Object or array projected as Text | JSON text retains nested numeric tokens and uses sorted object keys. |

Comparison operators are `eq`, `ne`, `lt`, `lte`, `gt`, and `gte`.
The parameter and selected column must have the same type; Boolean comparisons
use equality or inequality. Multiple conditions are combined with AND. Optional
parameters omitted from the input omit their corresponding conditions.

## Review, publish, and sell

Open `sftp-workspace` to save the source declaration and complete merchant payment
choices, inspect the remote folder, sample a file, and author reports. Create a
dataset publication from a saved report revision. This opens the original
publisher console for that one bound report.

In the publication console:

1. Choose the report's exact typed inputs and public dataset columns.
2. Set a complete-extraction row/byte/time budget and explicit ordering.
3. Save the plan, then extract its complete candidate.
4. Inspect the capture hash, source revision, row count, and resulting schema.
5. Record the review and publish the retained dataset version.
6. Start the native dataset seller from the parent workspace.
7. Open the seller documentation, select an exact payment offer, and prepare the
   original snapshot-bound buyer configuration.

The original publisher stores its own plans, runs, reviews, versions, and history.
The SFTP driver supplies complete source bytes and row encoding to that existing
implementation. The final CSV loader validates the public schema and cell
representations before a candidate becomes reviewable.

The retained extraction has a separate budget from buyer page limits. All
matching source rows must fit the chosen extraction budget; exceeding it produces
a failed run. Rows use the reviewed explicit ordering with nulls last and original
file position as the tie-breaker. String ordering uses JavaScript UTF-16 code
units. Published versions retain their complete dataset bytes, and prepared buyers
can pin an earlier edition after another edition is published.

Merchant payment alternatives and atomic amount strings are retained through the
original offer compiler. The dataset seller and original SF88 buyer use their
existing receipt, admission, and settlement implementation.

## Capture continuity and recurring refresh

Each extraction opens the remote file, checks its size against the source limit,
and captures every received byte. It records the negotiated pinned host identity,
canonical remote path, before/after opened-handle attributes, final path
attributes, exact SHA256, and received byte count.

A completed capture is immutable and content addressed. Its digest identifies
the captured bytes. To bind an agreed remote edition, set the report's optional
`expectedSha256` from a trusted manifest or source owner. Attribute observations
describe the transfer; the expected digest supplies an additional edition check.

If a connection is interrupted, the source retains the received prefix and its
transfer binding. The next capture of the same observed file compares every
retained prefix byte with the newly opened remote handle before it resumes at the
saved offset. A changed prefix or expected-digest mismatch requires source
review. Completed captures are consumed by the publisher only after the full
digest and final observations succeed.

Recurring refresh uses the original publisher schedule. Save its interval,
review/publication policy, and execution budget in the publication console.
The enabled policy survives a workspace reopen and records each attempt with the
existing retained run history. A remote update is captured again; equal published
content can produce the original `UNCHANGED` outcome. Earlier published editions
remain available to their pinned buyers.

## Reopen and move a workspace

Close the running workspace before backing it up. Copy the entire private
workspace directory, including source revisions, publication directories,
captures, buyer configurations, original publisher files, and dataset versions.
Reopen that directory with the same environment reference names populated for the
new host. The environment can point to a new absolute private key path.

The workspace verifies saved source and merchant hashes before reopening a
publication. Remembered seller intent restarts the original versioned seller
after a valid initial publication; the publisher and schedule continue from their
existing retained state. The separate key file and environment remain supplied by
the operator's runtime.

Source capture storage contains:

- `objects/<sha256>.data`: the exact completed file bytes.
- `receipts/capture_<id>.json`: immutable remote observations and capture binding.
- `partial/<transfer>.data` and `partial/<transfer>.json`: interrupted transfer
  bytes and their durable source binding.
- `publisher.lock`: the original Linux kernel lock for that capture directory.

Public candidate downloads and buyer exports come from the original publisher.
The capture files and private source declarations remain in the retained operator
workspace.

## Native API

```js
import { openSftpSourceFile } from './config.mjs';
import { openSftpPublisher } from './publisher/model.mjs';

const { source } = await openSftpSourceFile(sourceFile, {
  env: process.env,
  captureDirectory: '/absolute/private/captures'
});
try {
  const catalogue = await source.catalogue({ path: '', limit: 200, offset: 0 });
  const sample = await source.sampleFile({
    path: 'housing/production.ndjson',
    format: 'ndjson',
    limit: 20
  });
  const capture = await source.captureFile('housing/production.ndjson');
} finally {
  await source.close();
}

const publisher = await openSftpPublisher({
  directory: '/absolute/private/publication',
  create: true,
  sourceFile,
  targetDirectory: '/absolute/private/dataset',
  environment: process.env
});
// Use the original publisher's source/savePlan/startExtraction/inspect/review/
// publish methods and the original openPostgresSchedule({ publisher }).
await publisher.close();
```

Source references: the published `ssh2@1.17.0` package documents raw host-key
verification and SFTP handle operations; OpenSSH documents the server's
`internal-sftp -R` read-only subsystem; JSON Pointer is RFC 6901. The source uses
the existing SF30 CSV parser, dataset loader, publisher, scheduler, versioned
seller, and buyer handoff.

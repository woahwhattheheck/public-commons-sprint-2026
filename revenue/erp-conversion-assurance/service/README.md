# Local ERP reconciliation service

This service turns the existing [ERP comparison engine](../README.md) into a
retained customer workflow: stage an immutable source/target/spec bundle, run a
comparison, reconnect to its job, export the exact report, and record a reviewer
decision against that report's SHA-256. Each bundle also retains the original
engine, so a complete private replay package can reproduce the delivered work.
The local operator and the [AGX handler](../agx/README.md) use the same service
and retained jobs.

The engine compares the complete input key sets, fixed-point amounts and declared
group totals. Job responses show counts and input/report hashes; the full
exception report is available through explicit local export or the authorized
customer peer's report download. Each customer root has its own configuration,
HMAC key, bundles, jobs and worker lease. The local operator creates the complete
replay package, including the private key needed to reproduce report identifiers.

## Start with the included files

Use Linux, Node.js 22 or newer, and the util-linux `flock` executable in `PATH`.
Run these commands from the repository root. The local operator and service have
no npm dependencies. Keep the complete source checkout: `service.mjs` imports
the existing merchant-fleet state lease, which invokes `flock`, and staging
copies the original `reconcile.mjs` into each immutable bundle. The
[AGX guide](../agx/README.md) covers its separate transport dependency.

Choose a private directory outside the source checkout. `init` creates a new
root with permissions `0700` and its own local HMAC key. An existing root must
already be private and owned by the operating-system account running the
command. The saved configuration pins the key's SHA-256. Operator output
contains that configuration and its path; a complete replay export includes
the key in a private package.

```sh
umask 077
export ERP_RECON_DIRECTORY=/absolute/private/customer-example

node revenue/erp-conversion-assurance/service/operator.mjs init

node revenue/erp-conversion-assurance/service/operator.mjs run \
  --job-id example-run-1 \
  --source revenue/erp-conversion-assurance/source.sample.csv \
  --target revenue/erp-conversion-assurance/target.sample.csv \
  --spec revenue/erp-conversion-assurance/spec.sample.json

node revenue/erp-conversion-assurance/service/operator.mjs status \
  --job-id example-run-1

node revenue/erp-conversion-assurance/service/operator.mjs export \
  --job-id example-run-1 \
  --destination "$ERP_RECON_DIRECTORY/example-run-1-report.json" \
  > "$ERP_RECON_DIRECTORY/example-run-1-export.json"
```

The included source and target represent the same three rows under different
column names, so this example completes with `state: "COMPLETED"` and
`result.status: "PASS"`. `run` stages the files and waits for this job. Its JSON
includes the immutable bundle ID, source/target row counts and hashes, discrepancy
counts, and the report's SHA-256 and byte count.

Open the exported JSON report to review totals and exceptions. The export
receipt records the digest of those exact bytes. Record the example reviewer
decision using that receipt:

```sh
ERP_RECON_REPORT_SHA256=$(node -e \
  'const fs = require("node:fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).sha256)' \
  "$ERP_RECON_DIRECTORY/example-run-1-export.json")

node revenue/erp-conversion-assurance/service/operator.mjs review \
  --job-id example-run-1 \
  --report-sha256 "$ERP_RECON_REPORT_SHA256" \
  --reviewer "Example operator" \
  --decision accepted \
  --note "Reviewed the included three-row example and its totals."

node revenue/erp-conversion-assurance/service/operator.mjs reviews \
  --job-id example-run-1
```

For customer work, use the actual source and target exports, agreed column
mapping and tolerances, and the actual reviewer's name and decision. Reviewer
records preserve the supplied name, timestamp, decision, note and exact report
digest. Their authority comes from access to the private customer root. A
reviewer can record approved exceptions in the note; the underlying comparison
result and report bytes remain intact.

## Configure a customer root

`init` saves the configuration once. Later commands read the saved settings.
Passing different limits to `init` for the same root returns
`SERVICE_CONFIGURATION_MISMATCH`; the existing customer's configuration and
jobs remain available. Initialize a separate root when a different resource
profile is required.

```sh
node revenue/erp-conversion-assurance/service/operator.mjs init \
  --directory /absolute/private/customer-larger \
  --max-input-bytes 33554432 \
  --max-report-bytes 33554432 \
  --timeout-ms 120000 \
  --max-heap-mib 512

node revenue/erp-conversion-assurance/service/operator.mjs config \
  --directory /absolute/private/customer-larger
```

| Setting | Default | Meaning |
|---|---:|---|
| `--max-input-bytes` | 8,388,608 | Maximum bytes in each complete source or target CSV |
| Spec size | 262,144 | Maximum bytes in the complete mapping JSON |
| Engine size | 524,288 | Maximum bytes in the retained original engine |
| `--max-report-bytes` | 16,777,216 | Maximum bytes in a complete retained report |
| `--timeout-ms` | 60,000 | Engine time limit for an individual attempt |
| `--max-heap-mib` | 256 | Node engine heap limit; minimum 64 MiB |
| `--wait-timeout-ms` | 600,000 | How long this operator invocation waits for its job |
| `--poll-ms` | 500 | Operator status interval; range 50–60,000 ms |
| Replay inventory size | 8,388,608 | Maximum bytes in the complete replay manifest, including all captured review entries |

The service processes complete files. An over-limit input, report, runtime or
heap fails the operation instead of sampling or truncating the comparison. The
engine keeps one index entry per distinct composite key, so select limits that
fit the available machine memory. A larger heap allowance does not reserve RAM.
Run one root per customer; the worker lease serializes jobs within that root.
Different roots share the host's actual CPU, RAM and storage capacity.

The operator accepts `--directory` for every command. If omitted, it uses
`ERP_RECON_DIRECTORY`. All commands except `init` require an initialized root,
which makes a mistyped directory an explicit error.

`FLEET_LINUX_FLOCK_REQUIRED` means the host needs Linux and the `flock`
executable. `FLEET_STATE_LEASE_FAILED` means the native lease process could not
establish ownership; check executable availability and access to this private
root. `HMAC_KEY_CHANGED` means the retained key differs from the saved pin;
restore the customer's original key from its private backup.

## Stage once and submit by identity

Use `stage` when inputs are ready before a job should start:

```sh
node revenue/erp-conversion-assurance/service/operator.mjs stage \
  --source /absolute/private/incoming/source.csv \
  --target /absolute/private/incoming/target.csv \
  --spec /absolute/private/incoming/spec.json
```

Staging copies the three supplied regular files and the current original
engine into the customer root, hashes the exact bytes, checks that the files
stayed unchanged while copying, and returns a `bundleId`. Symbolic-link inputs
are rejected. Changing the original files after staging leaves the retained
bundle intact. All four files participate in the bundle identity: identical
source, target, mapping and engine bytes return the same ID. A mapping-file
whitespace change or a new engine revision produces a different identity.

Use the returned `bundleId` with a stable job ID chosen for that customer run:

```sh
node revenue/erp-conversion-assurance/service/operator.mjs submit \
  --job-id conversion-run-1 --bundle-id BUNDLE_ID

node revenue/erp-conversion-assurance/service/operator.mjs status \
  --job-id conversion-run-1 --wait --wait-timeout-ms 180000
```

Replace `BUNDLE_ID` with the complete returned lowercase digest. `submit`
returns promptly with the retained job state; add `--wait` to wait in the same
invocation. `run --job-id ID --bundle-id BUNDLE_ID` performs the same submission
and waits by default. File-based `run` accepts all three input paths instead of
`--bundle-id`.

Job IDs contain 1–96 letters, digits, dots, underscores or hyphens and start with
a letter or digit. Repeating the same job ID and bundle returns the existing
job with `reused: true`. Reusing that job ID for different inputs returns
`JOB_INPUT_CONFLICT`. Choose a new job ID for a new customer run or changed
inputs. Job requests also retain the engine digest used for that run. Execution
uses the engine snapshot in the selected bundle, including when the deployed
source checkout later changes.

## Connect a local review workspace

Browser and operator integrations use the same service through these local
methods. Each call is bound to the customer directory passed to
`openReconciliationService`; input paths stay on that operator's machine.

| Method | Return value | Behavior |
|---|---|---|
| `getBundle(bundleId)` | `{ bundle, spec }` | Reads and verifies every retained source, target, spec and engine file, then returns the manifest and parsed mapping JSON. Malformed JSON returns `SPEC_INVALID`. |
| `listBundles({ limit = 100, after = '' })` | `{ bundles, nextCursor }` | Lists manifests in SHA order, validating their structure and content identity. It reads metadata only; use `getBundle` to verify all files before opening a draft. |
| `reviseBundle({ bundleId, source?, target?, spec? })` | Bundle manifest | Creates an immutable revision from optional local replacement file paths. Omitted inputs reuse the verified original bytes; the revision snapshots the current engine. |

`listBundles` accepts limits from 1 to 1000. Pass its returned `nextCursor` as
`after`; `null` means the page is complete. A nonempty cursor is a full lowercase
bundle SHA. Listing a draft does not start a job.

For a correction, write the edited mapping to a private JSON file and pass its
path as `spec`. Put the previous job/bundle reference and local review-workspace
metadata inside `spec.workspace` when the caller needs that relationship. The
service preserves the full supplied JSON. For example, from an ES module at the
repository root, with `ERP_RECON_BUNDLE_ID` set to the bundle ID returned by
`stage` and the corrected private mapping file already saved:

```js
import { openReconciliationService } from
  './revenue/erp-conversion-assurance/service/service.mjs';

const service = await openReconciliationService({
  directory: '/absolute/private/customer-example',
});
const { bundle, spec } = await service.getBundle(process.env.ERP_RECON_BUNDLE_ID);
const revised = await service.reviseBundle({
  bundleId: bundle.bundleId,
  spec: '/absolute/private/corrections/spec.json',
  // source and target are omitted: reuse their original retained bytes.
});
const job = await service.execute({
  jobId: 'conversion-run-2',
  bundleId: revised.bundleId,
});
```

Revision validates the copied original input pins before publishing. The old
bundle and its jobs remain available. If all input, mapping and current-engine
bytes are identical, the content identity is unchanged; otherwise the returned
bundle has its own identity. Submit a new job ID for a corrected run, then use
the original status, report, export and reviewer workflow below.

## Follow progress, cancel and recover

```sh
node revenue/erp-conversion-assurance/service/operator.mjs list --limit 25
node revenue/erp-conversion-assurance/service/operator.mjs status --job-id conversion-run-1
node revenue/erp-conversion-assurance/service/operator.mjs cancel --job-id conversion-run-1
node revenue/erp-conversion-assurance/service/operator.mjs recover --job-id conversion-run-1 --wait
```

`list` sorts by job ID and returns `jobs` plus `nextCursor`; pass the returned
cursor as `--after` for the next page. The limit is 1–1000.

| Job state | Operator meaning |
|---|---|
| `QUEUED` | Inputs and request are retained; awaiting the customer's worker |
| `RUNNING` | The root's worker is executing the original comparison |
| `COMPLETED` | A full, validated report is retained; its result is `PASS` or `FAIL` |
| `FAILED` | The attempt failed; `error.code` identifies its cause |
| `INTERRUPTED` | The worker ended before completing the attempt |
| `CANCELLED` | The cancellation request ended this job |

`cancel` records a request against the selected job. Its immediate output can
still be `RUNNING` with `cancellationRequested: true` while the worker stops the
engine. Read `status --wait` for the terminal state. Cancelling an already
terminal job returns its existing state.

`recover` explicitly resumes a retained interrupted, failed or cancelled job
once the customer root's worker is idle. It first checks whether a previous
attempt left a complete report matching the exact input/spec hashes and report
schema. A valid complete report can be adopted. Otherwise recovery queues a new
pure-computation attempt for the same job and bundle, using that bundle's
retained engine. Changing the deployed engine leaves existing jobs reproducible.
`ENGINE_CHANGED` means the request's engine pin disagrees with its retained
bundle; restore the original retained files from the customer's private backup.
Completed jobs return their existing result.

An operator wait timeout returns the last observed job with
`operatorWait.timedOut: true` and exits 1. The retained job and its engine time
limit continue independently of that wait. Reconnect with `status --wait`.
Waiting never silently cancels or retries a job. If a process interruption leaves
a job interrupted, inspect its state and choose `recover` explicitly.

## Export and reviewer acceptance

`export --job-id ID --destination FILE` writes the exact retained report bytes
using create-only publication. The destination's parent directory must already
exist. Use a private destination directory. An existing destination returns
`EEXIST`; choose another filename. The export receipt includes `sha256`, `bytes`
and the absolute destination. Both `PASS` and `FAIL` reports can be exported.

`review` requires `--report-sha256` from that exact report. A stale or mismatched
digest returns `REVIEW_REPORT_CONFLICT`. Use `--decision accepted` or
`--decision changes_requested`, a reviewer name of at most 200 characters and
an optional note of at most 4000 characters. Each call creates a new immutable
review record. `reviews --job-id ID` returns the retained decisions in timestamp
order, so later review does not overwrite earlier review.

Keep the original customer root, including its HMAC key, with its private
operational backup. This preserves consistent hashed record/group identifiers
across customer runs and the original input, job, report and review relationships.
Use the service to create separate roots for separate customers.

## Export a complete private replay package

After reviewing the report, export the whole retained job to a new directory:

```sh
node revenue/erp-conversion-assurance/service/operator.mjs export-replay \
  --job-id example-run-1 \
  --destination "$ERP_RECON_DIRECTORY/example-run-1-replay" \
  > "$ERP_RECON_DIRECTORY/example-run-1-replay-receipt.json"

ERP_RECON_REPLAY_SHA256=$(node -e \
  'const fs = require("node:fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).manifest.sha256)' \
  "$ERP_RECON_DIRECTORY/example-run-1-replay-receipt.json")

node "$ERP_RECON_DIRECTORY/example-run-1-replay/replay.mjs" \
  --manifest-sha256 "$ERP_RECON_REPLAY_SHA256"
```

The destination's parent must already exist. Export reserves a new directory
with mode `0700`, writes private files with mode `0600`, and publishes
`export.json` last. An existing destination returns `EEXIST`. A failed export
removes the new directory it created. The receipt identifies the original job,
bundle and report digest, the manifest digest and size, file count, review count,
and absolute package directory.

| Package content | Purpose |
|---|---|
| `source.csv`, `target.csv`, `spec.json`, `engine.mjs` | Exact retained inputs, mapping and engine used by the original job |
| `bundle.json`, `request.json`, `state.json`, `service.json` | Original bundle pins, job request, completed result and resource configuration |
| `report.json` | Exact original delivered report, retaining its original SHA-256 |
| `reviews/` | Exact immutable review events from the filename set captured by this export |
| `hmac.key` | Customer key needed to reproduce the same hashed record and group identifiers |
| `export.json` | SHA-256 and byte count for every included file, plus job/report/engine identity and review capture time |
| `replay.mjs`, `README.txt` | Standalone replay command and operating instructions |

The manifest records the review event set once. A review added during or after
export is available in the customer root and can be included by a later export
to another directory. Every included review is checked against the exported
job and report digest.

Keep the package directory and files private. It contains the full customer
inputs and the customer's HMAC key; use the agreed private customer delivery
route for this package. The AGX report download carries the authorized peer's
selected report. Complete replay export is a local operator operation.

The package runs with Node.js 22 or newer independently of the service checkout.
`replay.mjs` validates its manifest and every inventoried file, including the
input/engine pins, completed report identity and saved key pin. Supplying
`--manifest-sha256` also binds that validation to the export receipt. It then
runs the retained engine with the original heap and runtime limits and checks
the full report size limit.

Replay creates `replayed-report.json` beside the original `report.json`. For
another replay, choose a fresh filename with
`node replay.mjs --out replay-002.json`. Output names are single filenames in the
package directory, and publication is create-only. The delivered report keeps
its original bytes and digest.

The engine generates a fresh `generated_at` timestamp on every run. Replay
compares all other parsed report content, including status, counts, input and
mapping hashes, totals and complete discrepancies. Its JSON receipt reports
`matchesDeliveredReport`, the original and regenerated report digests, and the
new report filename. A matching `PASS` exits `0`; a matching discrepancy report
exits `2`; an execution error or substantive difference exits `1`.

## Output and exit codes

The operator prints one readable JSON value to stdout. Errors are JSON on
stderr with a stable `error.code` and a concise explanation. CLI errors suppress
filesystem path details. Treat saved output as private customer material.

| Exit | Meaning |
|---:|---|
| `0` | Completed `PASS`; accepted pending submission; successful setup, staging, listing, cancellation request, report/replay export or reviewer operation |
| `2` | A completed, structurally valid comparison report with `FAIL` discrepancies |
| `1` | Invalid arguments, file/configuration error, failed/interrupted/cancelled job, or expired operator wait |

A `COMPLETED` job with `result.status: "FAIL"` is a delivered discrepancy report.
That is different from an engine failure, which has `state: "FAILED"` and an
error code. Automation consuming `run`, `submit --wait`, `status` or `recover`
should preserve exit 2 and export the complete discrepancy report for review.
The original engine's `0`/`2`/`1` distinction is retained.

Run `node revenue/erp-conversion-assurance/service/operator.mjs --help` for the
complete command reference. Unknown commands, unknown or repeated flags,
unexpected positional arguments and unsupported wait options are rejected
before opening the customer root.

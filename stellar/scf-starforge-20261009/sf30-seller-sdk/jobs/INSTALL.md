# Paid jobs: installation and operation

Install the complete paid-jobs product to sell work that can finish after the original HTTP payment request. The merchant prepares a job with retained input, the existing Starforge buyer pays for that job, and the customer can reopen its status and download the completed output. The operator workspace, command line, worker, seller, and customer service use the same merchant model.

This guide covers installation, service launch, customer handoff, and recovery. [README.md](README.md) defines the application and merchant configuration. [BUYER.md](BUYER.md) describes the buyer's retained acceptance, status, and output API.

## Install an original distribution containing paid jobs

Use Linux with Node.js 22.16 or newer, Python 3.11 or newer, npm, and the util-linux `flock` command. A dependency selected by the original release can require a newer Node version. The paid-jobs worker itself uses Node built-ins and the existing merchant lock.

Select an original merchant archive whose manifest contains this `sf30-seller-sdk/jobs/` directory, the `jobs` and `jobs-buyer` commands, and the exports listed below. The archive's own source identity determines the installed product. Keep its complete SHA-256 digest with the download.

Create the existing parent directories under your normal service account, then prepare a new private runtime through the maintained installer:

```sh
starforge runtime-install prepare \
  --dir /srv/starforge/runtimes/paid-jobs-01 \
  --archive /srv/starforge/downloads/original-merchant.tgz \
  --sha256 REPLACE_WITH_COMPLETE_ORIGINAL_ARCHIVE_SHA256 \
  --native --operator

starforge runtime-install install \
  --dir /srv/starforge/runtimes/paid-jobs-01
```

`--native` selects the existing release's payment dependencies. `--operator` records its Linux, Python, and `flock` requirements. Paid jobs adds no optional dependency group. The installer retains the original package under `package/`, installs its selected dependencies under `node_modules/`, and keeps their source and lock identities together.

The complete installation and interruption workflow is documented in [RUNTIME_INSTALL.md](../../distribution/RUNTIME_INSTALL.md). A populated npm cache can be selected with the original `--offline --cache ABSOLUTE_DIRECTORY` installation options.

Set paths for the examples below. Keep the application and merchant state outside the replaceable runtime directory:

```sh
SF_JOBS_RUNTIME=/srv/starforge/runtimes/paid-jobs-01
SF_JOBS_SOURCE=$SF_JOBS_RUNTIME/package/source
SF_JOBS_APP=/srv/starforge/applications/paid-reports
SF_JOBS_STATE=/srv/starforge/workspaces/paid-reports
```

The original installed command is dispatched with:

```sh
starforge runtime-install run --dir "$SF_JOBS_RUNTIME" -- jobs --help
starforge runtime-install run --dir "$SF_JOBS_RUNTIME" -- jobs-buyer --help
```

The equivalent source entrypoints are `jobs/cli.mjs` and `jobs/buyer.mjs` under the installed `stellar/scf-starforge-20261009/sf30-seller-sdk/` directory. Keep that original source in place so its relative imports resolve through the selected runtime.

## Prepare the application and payment terms

Copy these three adjacent examples into the operator-owned application directory:

```sh
install -d -m 700 "$SF_JOBS_APP"
cp "$SF_JOBS_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/example-merchant.json" "$SF_JOBS_APP/"
cp "$SF_JOBS_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/example-application.mjs" "$SF_JOBS_APP/"
cp "$SF_JOBS_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/example-input.json" "$SF_JOBS_APP/"
```

The example application exports `analyze` for a JSON report and `tabulate` for a CSV result. Its sample input is `{"values":[2,4,6,8],"window":2}`. The merchant configuration refers to the adjacent application with `"application": "./example-application.mjs"`.

Edit the merchant configuration before preparing customer work:

| Setting | Operator choice |
| --- | --- |
| `schema` | Keep `stellar-forge.paid-jobs.v1`. |
| `application` | The trusted application module that the service will execute. |
| `serviceName` | The merchant's customer-facing service name. |
| `publicOrigin` | The actual HTTPS origin used by the paid endpoints and customer status/result service. |
| `functions` | The functions to offer, including each path, description, input schema, example, and exact payment terms. |
| Function `payment` | Replace sample markers with the actual Stellar network, asset, merchant recipient, and amount supported by the configured original payment runtime. |
| Function execution limits | Choose `timeoutMs` and `maxOutputBytes` appropriate to the work; configuration supports at most one hour and 64 MiB. |
| Function `output` | Select JSON or bytes, with the applicable content type and download filename. |
| `workerCount`, `memoryLimitMb` | Select worker concurrency and the application's worker heap allowance for the available host. |
| `maxPending`, `maxJobs` | Select the retained merchant's pending-work and total-job limits. |
| `environment` | Name only the environment variables the trusted application requires. The example begins with an empty list. |

The application executes merchant-owned JavaScript. Supply the source and its needed environment through the existing deployment process. Keep the module and its dependencies available at their configured paths across service restarts.

The included `native-runtime.example.mjs` composes the original SF30 seller factory with the original `HTTPFacilitatorClient`. Set `SF_JOBS_FACILITATOR_URL` to the configured HTTPS facilitator and use the example at its installed location. Its relative import points to the original adjacent seller factory; an application-local copy must update that import to the retained original source.

## Start one merchant service

Run the owning service under your normal process supervisor, using stable application and state paths. This example selects distinct loopback ports for each surface:

```sh
export SF_JOBS_FACILITATOR_URL=https://REPLACE_WITH_CONFIGURED_FACILITATOR

starforge runtime-install run --dir "$SF_JOBS_RUNTIME" -- \
  jobs serve \
  --config "$SF_JOBS_APP/example-merchant.json" \
  --state "$SF_JOBS_STATE" \
  --seller-port 8423 \
  --customer-port 8477 \
  --operator-port 8478 \
  --operations-port 8479 \
  --native-factory "$SF_JOBS_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/native-runtime.example.mjs" \
  --start-worker
```

`--native-factory` accepts an absolute module path exporting `nativeFactory` or a default factory. The factory receives the original compiled seller declaration and returns the original SDK integration. The installed example supplies that composition for the configured facilitator.

Without a native factory, the service can prepare jobs and expose the original payment challenge. Configure the factory to process native paid requests. `--start-worker` starts execution through the same owning model; the workspace can also start and stop that worker.

Retain the returned operator URL, including its access capability, in the private operator workflow. The workspace provides input preparation, job history, worker controls, reconciliation, revision-checked retry/cancel, and result preview/download. Its server borrows the owning model.

### Route the public origin

Terminate HTTPS at the existing host or deployment proxy for the exact configured `publicOrigin`.

| Public route | Destination |
| --- | --- |
| Each paid function path declared in the merchant configuration | Seller port, for example `127.0.0.1:8423`. |
| `/jobs/<jobId>` | Customer service, for example `127.0.0.1:8477`. |
| `/jobs/<jobId>/result` | The same customer service. |

Forward the original request method, body, response status, payment headers, and customer capability header without rewriting their values. Paid job submission uses the original order identity and `x-sfjobs-token`; customer status and result requests use `x-sfjobs-token`, with Bearer authorization also supported by the customer service. The original buyer handles the native payment exchange.

For the customer upstream, preserve the configured public hostname in `Host`, or use the exact loopback host and port selected by the service. The customer listener checks that host and, when present, the same public `Origin`. Forward either the claim header or Bearer authorization once.

Keep the operator workspace and operations ports within the existing private operator access path. Public routing needs only the configured seller paths and customer status/result routes. A single public origin allows the original acceptance to retain the exact customer URLs.

## Prepare work and hand it to the buyer

Use the running workspace to choose a function and validate the customer's input. Preparation retains that input and returns a job handoff containing the job identity, customer capability, and purchase details. Preserve that handoff as a private file when using the command-line buyer.

The existing SF88 buyer performs the paid call for the prepared job. Retain the actual returned `BuyerResult` or its saved acceptance together with the handoff. The paid-jobs buyer then follows this accepted job through status and completed output.

For a headless preparation session, stop the owning service before opening the same merchant directory in another command. All merchant commands use the existing directory lease. With the directory available:

```sh
umask 077
starforge runtime-install run --dir "$SF_JOBS_RUNTIME" -- \
  jobs create \
  --config "$SF_JOBS_APP/example-merchant.json" \
  --state "$SF_JOBS_STATE" \
  --function analyze \
  --input "$SF_JOBS_APP/example-input.json" \
  --label "Quarterly report" \
  --reference report-2026-q4 \
  --out /srv/starforge/handoffs/report-2026-q4.json
```

Choose an output path that does not already exist. Start the owning service again with the same state directory before the customer submits the paid request.

### Retain, follow, and download an accepted job

The installed buyer command accepts the original acceptance and the private job handoff:

```sh
starforge runtime-install run --dir "$SF_JOBS_RUNTIME" -- \
  jobs-buyer retain \
  --state /srv/starforge/customer-jobs/report-2026-q4 \
  --acceptance-file /srv/starforge/customer-inbox/report-2026-q4-acceptance.json \
  --handoff-file /srv/starforge/customer-inbox/report-2026-q4-handoff.json

starforge runtime-install run --dir "$SF_JOBS_RUNTIME" -- \
  jobs-buyer wait \
  --state /srv/starforge/customer-jobs/report-2026-q4 \
  --deadline-ms 900000 --poll-ms 2000

starforge runtime-install run --dir "$SF_JOBS_RUNTIME" -- \
  jobs-buyer fetch \
  --state /srv/starforge/customer-jobs/report-2026-q4 \
  --out /srv/starforge/customer-results/report-2026-q4.json \
  --deadline-ms 120000
```

Create the parent directories for the customer state and output before using these paths. `--claim-token-file ABSOLUTE_FILE` is the alternative when the customer already retained only the original claim capability. Pass `--transport-file ABSOLUTE_JSON` on network commands when the original SF31 connection profile is required. The profile remains the original explicit-connect transport used by the customer workflow.

Buyer state is private to the customer: a `0700` directory retains the original acceptance, capability, observed status, and delivery metadata in private files. `inspect --state ...` reads the selected job, and `wait`/`fetch` can reopen the same directory after interruption. Deadline values are elapsed-time budgets in milliseconds.

The result download retains and checks its exact bytes and SHA-256. Publication uses a new output destination. A completed local delivery can be reopened and checked against its retained identity. Preserve the state directory with the output so a subsequent operation resumes the same accepted job.

An embedding that already has the original purchase result can use the package API directly:

```js
import { createJobBuyer } from '@tokenjunkielabs/starforge-merchant/buyer/jobs';

const customer = await createJobBuyer({
  directory: '/srv/starforge/customer-jobs/report-2026-q4',
  result: originalBuyerResult,
  handoff: originalPreparedJobHandoff,
  transport: originalBuyerTransport,
});
await customer.wait({ deadlineMs: 900_000, pollMs: 2_000 });
await customer.download({
  destination: '/srv/starforge/customer-results/report-2026-q4.json',
  deadlineMs: 120_000,
});
```

`createJobBuyer` accepts exactly one original purchase source: `result` or `acceptanceFile`. Supply either the handoff or `claimToken`. Use `openJobBuyer({directory, transport})` to reopen the retained customer workflow. [BUYER.md](BUYER.md) contains the full interface and transport options.

## Operate retained work

The live workspace is the operator surface for a running service. For offline CLI work, stop that service, open the same configuration/state pair, perform the command, and return service ownership to the normal supervisor.

| Command after `jobs` | Operation |
| --- | --- |
| `status` | Read the retained merchant snapshot. |
| `show --id JOB_ID` | Read one job and its retained details. |
| `reconcile` | Reconcile retained paid orders with the merchant's jobs. |
| `work --once` | Drain the currently available paid jobs through the original worker. |
| `work` | Run the worker through this command's owning model. |
| `retry --id JOB_ID --revision CURRENT_REVISION --reason TEXT` | Retry the selected retained job using its observed revision. |
| `cancel --id JOB_ID --revision CURRENT_REVISION --reason TEXT` | Cancel the selected job using its observed revision. |
| `result --id JOB_ID --out NEW_ABSOLUTE_PATH` | Export the retained output to a new destination. |

Each command requires `--config ABSOLUTE_CONFIG --state ABSOLUTE_DIRECTORY`. Obtain the current job revision from the latest job view before retrying or cancelling. If it changed, refresh that same job and act on its present state.

On restart, retain the same application, configuration, merchant directory, and original order records. Start one owner and use its retained history to resolve interrupted work. A retry acts on the existing job and its frozen input. Keep completed output and customer capability state available for customers who resume later.

## Upgrade the runtime while preserving merchant state

Prepare a new original runtime through `runtime-install upgrade --from OLD_DIRECTORY --dir NEW_DIRECTORY --archive ORIGINAL_ARCHIVE --sha256 ORIGINAL_SHA256`. The installer inherits the selected native/operator profile unless explicitly changed and records the source and dependency comparison.

Stop the owning service, select the new runtime in the existing process supervisor, and launch with the unchanged application/configuration/state paths. Preserve the previous runtime for the deployment workflow's rollback. If the retained dependency tree needs recovery, use the original `runtime-install recover` operation into a new directory.

The installation-specific runbook retains both absolute `sourceRoot` and `dependencyRoot`. Hand them together to the original host or container workflow; source paths and installed native dependencies must remain resolvable from the selected package.

## Package integration

The existing full `sf30-seller-sdk` component includes this directory, its workspace assets, examples, and documentation. SF31 and SF88 provide the existing buyer and transport dependencies. The distribution should register these original files:

| Distribution entry | Original path below `sf30-seller-sdk/jobs/` |
| --- | --- |
| Command `jobs` | `cli.mjs` |
| Command `jobs-buyer` | `buyer.mjs` |
| Export `@tokenjunkielabs/starforge-merchant/seller/jobs` | `model.mjs` — `openJobMerchant` |
| Export `@tokenjunkielabs/starforge-merchant/seller/jobs/merchant` | `merchant.mjs` — `startJobSeller` |
| Export `@tokenjunkielabs/starforge-merchant/seller/jobs/customer` | `customer.mjs` — `startCustomerServer` |
| Export `@tokenjunkielabs/starforge-merchant/seller/jobs/workspace/server` | `workspace/server.mjs` — `startJobsWorkspace` |
| Export `@tokenjunkielabs/starforge-merchant/buyer/jobs` | `buyer.mjs` — `createJobBuyer`, `openJobBuyer` |

Keep package commands and exports pointed at the retained original source. The release's existing source-closure and runtime installer own packaging and dependency selection.


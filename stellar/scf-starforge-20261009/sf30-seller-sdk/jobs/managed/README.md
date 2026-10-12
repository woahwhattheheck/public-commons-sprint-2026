# Paid-job merchant in Applications

**Paid-job merchant** starts and reopens the original merchant from the installed
Applications workspace. One service owns the original paid routes, public customer
listener, durable worker, input receiving desk, resolution desk and configured
completed-result dispatcher. The same state directory retains the jobs and their
original settlement, input, result and support histories.

Use the original [installation and merchant setup](../INSTALL.md) first. Select
the complete runtime containing this Applications provider, the original schema
runtime and the payment dependencies used by your existing native factory.
Applications discovers this entry through the source-owned
[paid-job-operations contribution](../../../distribution/contributions/paid-job-operations.json).

## Review and open the merchant

In the existing Applications workspace, choose **Paid-job merchant** and the
original installed runtime. Enter the private merchant directory and its original
configuration file. You can select an initialized directory or create one directory
inside an existing private parent. Save the same directory when reopening an
existing merchant.

The merchant configuration selects the trusted application module, function
schemas and prices, worker concurrency and memory limits, and the public HTTPS
origin. Select the existing native factory module to enable its original native
payment implementation. Review reads that module and its hash; Start loads the
module as the original seller's factory.

Choose an optional intake override when the service should expose a different
selection of its configured functions. Choose the original result-delivery
configuration and its existing custom queue when result delivery is configured.
An empty custom queue field selects `result-delivery` inside the merchant state.

| Choice | Effect |
| --- | --- |
| Seller port | The original purchase listener behind the configured HTTPS purchase route. |
| Customer port | The original intake, input upload, job status and completed-result listener. |
| Private operator port | The authenticated merchant workspace used by Open and its linked desks. |
| Seller operations port | The original seller operations listener. |
| Start the original job worker | Processes the merchant's existing paid queue using its configured limits. |
| Start result delivery | Starts the original signed dispatcher with the selected destinations and queue. |
| Open page | Chooses jobs, inputs, resolutions or configured deliveries as the first page. |

Use distinct nonzero ports for retained proxy routes. Zero selects an available
loopback port. The existing HTTPS proxy continues to route configured function
purchase paths to the seller and public intake/status/input/result paths to the
customer listener. The service's startup includes the exact selected listener
addresses and original public intake URL.

The private environment JSON uses the existing Applications environment field.
The review retains its file identity and hash. The original factory, trusted
application, intake access and result-delivery secrets use their existing
environment names. The service selection shows those names; values remain in
the selected host environment.

Choose **Review**, inspect the full source and service selection, and **Save**.
Applications connects the same installed runtime through its retained managed
home. When it is connected, choose **Review Start**, then **Start**. The running
merchant publishes its original private launch record. Applications authenticates
that listener, matches its current source, directory, runtime and service
instance, then enables **Open**.

The linked pages share that same merchant:

- **Application jobs** prepares jobs, follows the original settlement and worker,
  opens completed output, and retains operator decisions.
- **Input receiving** shows the original receiving policy, upload progress,
  verified input bytes and job linkage. Its cleanup uses the original store's
  reference guards.
- **Job resolution** carries the original customer issue, merchant reply, job
  retry/cancellation decisions, accounting connection and retained adjustments.
- **Result delivery**, when configured, uses the original delivery queue,
  destination configuration and dispatcher.

The existing [input receiving guide](../inputs/workspace/README.md) and
[resolution guide](../resolution/README.md) describe the detailed operations.
Completed files continue through the original result, customer-library and
receiving workflows.

## Stop, reopen and recover

**Stop** closes the original service's admission and drains its owned listeners,
input transfers, agent requests and configured dispatcher before closing the
merchant. The merchant then drains its original resolution work and worker and
releases its state lease. A stop during source loading or listener startup uses
this same cleanup path.

Applications retains the original operation, output and stop record. After it is
closed, **Review Start** creates the next reviewed start of the same saved
application. The next process gets a new instance and private URL; jobs, accepted
purchases, native outbox entries, input files and completed results remain in the
original merchant directory.

Reopen an active operation through its existing Applications entry. Its Open
address belongs to that particular running instance. After an interrupted start,
use the existing operation's recovery and output view to establish its actual
process state before creating a later start. The original merchant lease also
prevents concurrent writers to that state.

A changed application, configuration, optional factory, intake or destination
file changes the reviewed service selection. Review and save the intended source
through the existing Applications lifecycle. For a restored merchant, use the
physical source adopted by the original SF101 recovery flow. The service reads
that source binding and preserves its historical merchant identity.

## Foreground command

The original CLI runs the same owner used by Applications:

~~~sh
starforge jobs inspect-service \
  --config /srv/merchant/merchant.json \
  --state /srv/merchant/state \
  --native-factory /srv/merchant/native-factory.mjs \
  --seller-port 8423 --customer-port 8477 \
  --operator-port 8478 --operations-port 8424 \
  --start-worker --landing inputs

starforge jobs serve \
  --config /srv/merchant/merchant.json \
  --state /srv/merchant/state \
  --native-factory /srv/merchant/native-factory.mjs \
  --seller-port 8423 --customer-port 8477 \
  --operator-port 8478 --operations-port 8424 \
  --start-worker --landing inputs
~~~

`inspect-service` reads the original configuration, current source binding and
selected files without opening the merchant writer or loading the native factory.
Its JSON includes the source identities, function/payment/output terms, resource
limits, environment references and selection hash.

`serve` prints one compact JSON announcement with the complete private operator
address and linked desks. SIGINT and SIGTERM close the same service. The optional
`--delivery-config`, `--delivery-state` and `--start-delivery` flags retain their
original meanings.

Applications supplies `--expected-selection` to bind the reviewed source and
settings. Its `--managed-runtime` checks the canonical installation already
executing the command. The existing managed worker supplies `--managed-launch`
inside its own retained operation directory.

## Embedded service and authenticated connection

The installed package exports this module as `./seller/jobs/managed`, with
matching ESM declarations. From the root of a received source package:

~~~js
import {
  readJobServiceSelection, openJobService,
} from './source/stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/index.mjs';

const options = {
  configPath: '/srv/merchant/merchant.json',
  directory: '/srv/merchant/state',
  nativeFactoryPath: '/srv/merchant/native-factory.mjs',
  sellerPort: 8423, customerPort: 8477, operatorPort: 8478, operationsPort: 8424,
  startWorker: true, landing: 'jobs',
};
const selected = await readJobServiceSelection(options);
const stop = new AbortController();
const service = await openJobService(options, {
  expectedSelection: selected.selectionSha256,
  expectedRuntime: selected.runtimeDirectory,
  signal: stop.signal,
});
console.log(service.launch.entryUrl);

// Keep this same owner for the complete service lifetime.
await service.close();
await service.closed;
~~~

The returned `model`, seller, customer, workspace and optional dispatcher are the
original owners. `close()` is idempotent and resolves after those owners drain.
`closed` exposes the same terminal outcome. A supplied AbortSignal also closes
the service during startup or while it is listening.

A host that connects to an existing Applications operation uses the original
private launch file:

~~~js
import { readJobServiceLaunch } from
  './source/stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/index.mjs';

const connection = await readJobServiceLaunch({
  file: '/srv/runtime-workspace/operations/ORIGINAL_OPERATION_ID/job-service-launch.json',
  expected: {
    directory: '/srv/merchant/state',
    configPath: '/srv/merchant/merchant.json',
    runtimeDirectory: selectedJobsDirectory,
    selectionSha256: reviewedSelectionSha256,
  },
  signal,
});
// connection.workspaceIdentity is authenticated against the running merchant.
~~~

The launch record retains the canonical merchant directory, selected
configuration, actual installed jobs directory, historical source identity,
physical adopted source, service selection and original listener URLs. It includes
the private operator token in its URL and is stored with private permissions.

Every original merchant workspace also exposes authenticated `/api/identity`.
`readJobWorkspaceIdentity({url, expected, signal})` supports direct foreground
connections using the complete private operator URL. It checks the actual
loopback origin and can pin the merchant/source/runtime and running instance.
The merchant agent uses this same connection surface.

## Handover

Retain the complete installed source/archive and selected runtime profile with
the original merchant configuration, trusted application and optional factory.
Keep the private environment through its existing host custody. Use the original
paid-job recovery export to carry the closed merchant state, retained input and
result bytes, source snapshots and support histories; receive it through the
original SF101 source-adoption workflow when physical source paths change.

The Applications workspace retains the saved application, reviewed runtime and
configuration, operation history and private launch/exit records. Those records
describe the process that served the merchant. The merchant directory remains
the owner of its commercial and execution state.

The coherent receiving entrypoint in this directory continues a selected
initialized Applications workspace and its already received runtime. It records
the same Review/Save/Start/Open/Stop/reopen sequence and verifies the original
merchant objects and source across those starts. Its run record belongs beside
the existing operation output.

### Continue the original Applications receiving operation

Create a private JSON input with schema
`stellar-forge.job-merchant-applications-receiving.v1` and these fields:

| Field | Existing selection |
| --- | --- |
| `runtimeWorkspace` | Absolute path of the initialized Applications/runtime workspace. |
| `runtimeId` | Its actual 24-character retained ID for the complete installed runtime. |
| `settings` | The same merchant configuration/state, optional factory/intake/delivery files, ports and landing used in the application review. |
| `jobIds` | IDs of completed original paid jobs to receive and compare after reopening. |
| `recordDirectory` | One owned private directory for this receiving operation. |
| `label` | The saved Applications label. |
| `timeoutMs` | Optional overall native deadline; defaults to 180,000 ms. |

This stage follows the completed merchant's original job objects and results.
Its settings leave `startWorker` and `startDelivery` false. Existing native
payment and execution stages supply those completed jobs. The receiving source
uses the same managed service, source review and authenticated desks.

~~~sh
starforge jobs-merchant-receive \
  --input /srv/receiving/merchant-applications.json
~~~

The entrypoint invokes the maintained Applications APIs to Review and Save,
connect the selected runtime, Review Start and Start, receive the verified Open
address, reopen that same Start request, read the original jobs and complete
results, open all configured operator pages, retain the native operator export,
Stop and wait for the original owners to drain. It then reopens Applications and
starts the same saved merchant again, comparing its source and completed jobs.

`receiving.json` retains the original save, review, application and start IDs.
The two starts are sequential process lifetimes of the same merchant.
`result.json` contains the completed original object and receiving identities;
each phase retains its exact job rows, result files and operator ledger.
Resuming the same input uses those records. If a failed original start has ended,
the original Applications recovery records its outcome before a later reviewed
start is retained in that phase's attempt history. A live original start retains
its own request ID.

On interruption, the entrypoint asks Applications to stop only its own accepted
starts and waits for their original process records. It preserves the actual
failure and cleanup outcome in the same receiving record.

The installed `./seller/jobs/managed/receiving` export exposes
`receiveJobMerchantApplication(input, {signal})` for the same retained operation.
It loads the maintained Applications runtime when that receiving entrypoint is
selected; ordinary merchant service imports keep their original scope.

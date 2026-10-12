# Invoice settlement in Applications

**Invoice settlement** opens the complete invoice workspace through the maintained Applications process lifecycle. It uses the same programme versions, source captures, webhook receipts, listener delivery attempts, reconciliation, reports and receiving implementation as the `stellar-invoice-settlement` command.

The workspace, order API, webhook, SDP and Horizon operations use Node's built-in modules. EVM event decoding selects the original ethers 6.13.5 package and retains its complete installed dependency graph before importing it. The selected runtime's identity travels with the original capture and source records.

The programme, native connection contracts and operating examples are in [README.md](README.md).

## Prepare the selected product

Build from the actual source checkout and its selected Git revision:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/tjlabs-stellar-merchant-workspace \
  --ref HEAD \
  --selection stellar-invoice-settlement \
  --out /absolute/private/invoice-settlement-package
~~~

Keep the resulting archive, resolved source commit and original build manifest together. Install that selected package through the existing runtime installation and Applications workspace.

The package provides these executables:

| Executable | Original source and use |
| --- | --- |
| `stellar-invoice-settlement` | The complete invoice CLI, including `serve` for the local operator. |
| `starforge` | The maintained dispatcher, including the selected invoice, installation and runtime commands. |
| `starforge-merchant` | The same maintained dispatcher under the merchant alias. |

These commands select the same original application:

~~~sh
stellar-invoice-settlement serve --workspace /absolute/private/invoice-workspace
starforge stellar-invoice-settlement serve --workspace /absolute/private/invoice-workspace
starforge-merchant stellar-invoice-settlement serve --workspace /absolute/private/invoice-workspace
~~~

The source-owned contribution declares the command, module exports, Applications provider, browser map and the optional `invoice-ethers` runtime feature. Both the contribution and selected recipe explicitly retain the complete source cohort, including the original dynamically read runtime unpacker, distribution declaration and native API capsules.

## Select the original EVM runtime

Select the `invoice-ethers` feature in the maintained runtime profile and installation when this host will collect or decode EVM invoice events. Its declared original dependency is `ethers@6.13.5`. The invoice runtime additionally verifies the transitive package versions against the original listener's retained package lock.

An EVM connection's private `runtime` settings select the actual installed source:

| Field | Selection |
| --- | --- |
| `installationDirectory` | An existing installation directory from which ordinary ancestor `node_modules` resolution finds the original ethers package. The operator uses the selected application source when this field is omitted. |
| `runtimeDirectory` | The private directory where the full installed graph is retained, or an already received graph to reopen. The operator's default is outside the invoice workspace, under its sibling runtime directory. |
| `expectedManifestSha256` | The exact manifest hash when selecting an existing retained or received runtime. |

Use [connections.example.json](examples/connections.example.json) for the complete native connection shape. These settings belong to the host's private configuration file. Public source and capture records retain only the runtime ID, manifest hash and original ethers version.

The first EVM operation resolves the actual package files without evaluating the package, checks the original package and locked dependency versions, retains their complete source, then imports the verified original entrypoint. The decoder uses that package's `Interface` and retained original ABI profiles to interpret the unchanged topics and data, including legacy and later event definitions from the publisher's original contract source.

For a dedicated dependency project that must reproduce the listener's original dependency lock exactly, extract the two original files from the retained capsule into a new private directory:

~~~js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sourceDirectory =
  '/absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/invoice-settlement';
const installationDirectory = '/absolute/private/invoice-original-dependencies';
const capsuleBytes = await readFile(join(sourceDirectory, 'source/elementpay-listener.json'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
if (sha256(capsuleBytes) !==
    '0053e94e172eef67ebfefae7d7a9032ff244e89824ca8b7720d3687e2d02d533')
  throw new Error('Original listener source changed');

const capsule = JSON.parse(capsuleBytes);
const selected = ['package.json', 'package-lock.json'].map(path => {
  const file = capsule.files.find(item => item.path === path);
  if (!file || typeof file.content !== 'string') throw new Error('Original file missing');
  const bytes = Buffer.from(file.content, 'utf8');
  if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
    throw new Error('Original file identity changed');
  return { path, bytes };
});
await mkdir(installationDirectory, { mode: 0o700 });
for (const file of selected)
  await writeFile(join(installationDirectory, file.path), file.bytes, { flag: 'wx', mode: 0o600 });
~~~

Install using the original lock in that selected private directory:

~~~sh
npm ci --prefix /absolute/private/invoice-original-dependencies \
  --cache /absolute/private/invoice-original-dependencies/npm-cache \
  --ignore-scripts --no-audit --no-fund
~~~

Select that directory as the connection's `runtime.installationDirectory`. The original listener project includes its other declared service dependencies; the invoice retainer selects the complete graph actually needed by ethers, together with the original source capsule and lock. It preserves additional dependencies that the selected graph actually uses.

A source integration can retain the runtime explicitly before a capture:

~~~js
import {
  retainInvoiceRuntime, publicInvoiceRuntime, loadInvoiceEthers
} from './runtime.mjs';

const retained = await retainInvoiceRuntime({
  installationDirectory: '/absolute/private/invoice-original-dependencies',
  directory: '/absolute/private/invoice-ethers-runtime'
});
const selection = publicInvoiceRuntime(retained);
const loaded = await loadInvoiceEthers({
  runtimeDirectory: retained.directory,
  expectedManifestSha256: selection.manifestSha256
});
console.log({ runtime: loaded.runtime, ethersVersion: loaded.ethers.version });
~~~

The runtime manifest records each original package file, file mode, dependency edge and link target needed to reconstruct the installation. Its portable file set contains regular files; the receiver recreates the verified package links and original modes.

## Open through Applications

Select **Invoice settlement** in the existing Applications workspace, save the application settings and start that saved application.

| Setting | Meaning |
| --- | --- |
| **Private invoice workspace** | Absolute directory for the complete editable programme. An existing directory reopens its original workspace identity. |
| **Private source connections** | Optional absolute path to the alias-to-connection JSON. Keep it outside the invoice workspace. It supplies the native endpoints, private credentials and selected decoding runtimes. |
| **Programme profile** | Optional absolute JSON file containing the operator and programme profile. The original configuration reader validates it. |
| **Local listen address** | `127.0.0.1` by default, or `::1`. |
| **Local port** | `0` selects an available port; an explicit local port is also supported. |
| **Private environment JSON** | The original Applications environment-file option, passed to the managed child process. |

Applications stores the selected input descriptors and paths. The original application reads the private connection and profile contents inside that selected process.

Preparation checks the complete original native operator and browser source. An existing workspace's actual UUID is read and supplied to the native command. Startup checks the selected source directory, workspace identity, private input paths, announced revision, process ID, loopback address and actual port.

Applications retains the first valid startup announcement and that process's local session URL. The browser stores the session token in its tab's session storage and removes the token fragment from the visible address. A newly started process supplies a new local session URL.

The managed `serve` process opens the local operator. The independently configured `startInvoiceWebhookServer` API owns the authenticated customer webhook ingress described in the operating guide.

## Run the same source directly

An existing checkout can invoke the CLI without a package alias:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/invoice-settlement/cli.mjs serve \
  --workspace /absolute/private/invoice-workspace \
  --connections-file /absolute/private/invoice-connections.json \
  --profile-file /absolute/private/invoice-profile.json \
  --host 127.0.0.1 \
  --port 0 \
  --startup-format json
~~~

Omit the optional configuration-file flags when reopening retained work with its existing profile and no new source connection. The command stays in the foreground and serves the same browser as Applications.

For a saved workspace, retain its actual UUID and use `--expected-workspace-id` when the launch must reopen that exact identity. This is also the managed provider's identity check.

The machine-readable startup object uses schema `stellar-forge.invoice-settlement-workspace-startup.v1` and status `INVOICE_SETTLEMENT_READY`:

| Fields | Actual launched values |
| --- | --- |
| `url` | Local HTTP URL with the process's 43-character base64url token in `#token=...`. |
| `host`, `port` | Selected loopback address and actual integer listen port. |
| `workspaceDirectory`, `workspaceId` | Absolute continuing workspace directory and original UUID. |
| `revision` | Nonnegative integer workspace revision at startup. |
| `pid` | Positive integer process ID. |
| `sourceDirectory` | Absolute directory containing this selected application's source. |
| `connectionsFile`, `profileFile` | Exact private configuration paths, or `null` when omitted. |

Treat the complete local session URL as private.

## Continue a recorded operation

A saved application keeps the original workspace selection. Stop and reopen it through Applications, or reopen the same directory through the CLI. Programme versions, captured pages, receipts, delivery attempts, reconciliations and reports remain in its original history.

Use the native method catalog for each complete operation body. Mutations use an original UUID request ID and expected workspace revision. Keep the exact original request body when an acknowledgement is uncertain; query that original request before creating another operation:

~~~js
const result = await operator.invoke({
  method: 'request.status',
  args: { requestId: originalRequestId }
});
~~~

The stored request result and current capture or delivery state determine the continuation. Resume the selected original capture or listener delivery. The original cursor, payload, attempt identity and acknowledgement remain attached to that operation.

The browser saves the complete original request before dispatch, including the original File or Blob for source imports and archive uploads. Reloading the same operator address restores its **Retained original requests** panel for the selected workspace UUID and directory. **Retry original** resends that exact request ID, revision, body and file. Each pending request also offers its original request JSON and uploaded file for saving. The browser retains failed requests until a complete successful response or an explicit removal of that browser copy.

Programmatic HTTP writes use `X-Invoice-Workspace-ID` with the exact `state.workspaceId` returned by `GET /api/bootstrap`, alongside the existing bearer authorization. Send it on mutating `POST /api/invoke` calls, `POST /api/sources/import` and `POST /api/packages/unpack`. The server compares it with its original startup selection and the current workspace. A `package.receive` call still names its independent receiving destination in the original arguments; the HTTP header identifies the operator through which that request is made.


For a managed startup identity mismatch, read the saved application settings and actual selected workspace. The continuing directory must match that saved application before the same identity can be reopened.

## Receive the full continuing product

The operator's `workspace.export` creates a complete package containing the original workspace state and journal, programme and source records, webhook receipts, listener delivery history, decisions, reconciliation and report editions, application source, and every decoding runtime referenced by a source or capture.

The private exporter resolves all those runtime pins before assembling the delivery. The package records the exact runtime manifests and regular-file sources alongside the original application files. Runtime credentials and private host paths remain in the exporting host's configuration.

Use `package.inspect` and `package.receive` for archive receiving. The separate `delivery.*` methods operate the outbound listener jobs. CLI commands use `package-inspect` and `package-receive`.

The browser and CLI transfer the same full tar.gz package. Keep its original manifest hash with the archive. Streaming extraction checks the declared original paths, byte counts, hashes and modes, then the receiver restores the complete package into the selected receiving directory.

Receiving preserves the original history and records its own transition. READY or RUNNING captures become PAUSED. Active outbound jobs retain their original status, payload and attempts and receive `paused: true`, including an uncertain SENDING attempt. RUNNING delivery runs become PAUSED and retain their frozen job and completion selections.

The result supplies the actual received workspace, application entrypoints and restored runtime selections. Keep each original connection alias and its endpoint, network and account scope. Set its current `runtime.runtimeDirectory` and `runtime.expectedManifestSha256` to the received generation chosen for future decoding. Add every received generation needed by that alias to `runtime.retained`; these historical selections let later whole-workspace exports recover all original source and capture runtime pins.

For example, if `received` is the complete `package.receive` result and `connections` is the receiving host's private configuration:

```js
const restored = received.application.runtimeConnections;
const alias = 'base-orders'; // The exact original saved source alias.
const current = restored.find(row => row.id === chosenRuntimeId);
if (!current) throw new Error('Select a received original runtime generation.');

const original = connections[alias];
if (!original) throw new Error('Configure the original private connection alias.');
connections[alias] = {
  ...original,
  runtime: {
    ...(original.runtime ?? {}),
    runtimeDirectory: current.runtimeDirectory,
    expectedManifestSha256: current.expectedManifestSha256,
    retained: restored.map(row => ({
      id: row.id,
      runtimeDirectory: row.runtimeDirectory,
      expectedManifestSha256: row.expectedManifestSha256
    }))
  }
};
```

`chosenRuntimeId` is an explicit selection from the returned runtime IDs. Preserve the whole returned list when the original workspace used multiple installed generations. The received source and capture records retain their existing runtime identities, while the private connection selects where those complete generations live on this host. Configure the local source and delivery credentials before explicitly continuing the paused operations.

Open the returned workspace through **Invoice settlement**, or run the returned original CLI with `serve --workspace RECEIVED_WORKSPACE`. The retained programme, full observations, receipts, attempts, editions and reports are ready to inspect.

## Deliver an original report

`report.export` selects the sealed report metadata and every original report member. It retains the original filenames, formats, complete bytes and member hashes. The CLI's `report-file --format html|json|csv` opens a selected original member.

A full workspace package includes those reports as part of the continuing programme. A report package preserves the selected report edition's own files and metadata for independent delivery.

## Source integration

The package exports the original workspace, operator, normal server, receiving, archive, reconciliation, native adapters, event decoder and runtime under `./seller/invoice-settlement`, and the managed Applications lifecycle under `./applications/invoice-settlement`.

The browser map serves the three original files `web/index.html`, `web/app.mjs` and `web/styles.css`. Complete package transfers use the original `archive.mjs` implementation. The provider reuses the maintained Applications input preparation, environment handling, process lifecycle and startup observer.

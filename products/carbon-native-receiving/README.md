# Carbon reporting: complete native receiving

This installed operation assembles the complete original source, runs the Stellarcarbon and GiveCredit desks through their native APIs and browser forms, receives both workspaces independently, joins the selected original accounting case, and preserves the closed delivery as a complete portable archive. The command and typed client use the same maintained runtime and original-source manifest.

## Select the actual host and original source

Use an existing Linux host with Node 22 or newer, its native Chromium executable, and its already available Stellar SDK 16.3 peer. Keep one accepted process for the original operation. The complete source packet includes its manifest, every listed source part and every listed whole-handover part. Download those full originals together with their original filenames.

The installed toolkit starts the selected source packet. The source root is explicit and contains `receiving/source-manifest.json`, `receiving/receive-native.mjs`, the full editable handover, and both original applications under `stellar/scf-starforge-20261009/partners/`. Installation alone does not supply the private current customer handover.

```sh
starforge carbon-native-receiving source --downloads /absolute/original-downloads --source-root /absolute/new-carbon-source
starforge carbon-native-receiving inspect-source --source-root /absolute/new-carbon-source
```

`source` uses the maintained bootstrap to validate every complete part, file identity and the whole original handover before it writes a new private directory. `inspect-source` rereads all manifest files, checks exact bytes and Git identities, and checks the whole customer handover. Its returned manifest identity is retained with the run.

Source, output and archive destinations preserve existing work. Select new source and output directories, and an archive outside both. Use the same original capture checkpoint and matching selection for recovery, with a new output directory for the next attempt.

## Prepare the original SDK and historical inputs

When the host already resolves a compatible installed Stellar SDK, pass that existing module directly. The maintained `sdk` command can also prepare the original published standalone SDK bundle with its complete npm metadata and original license. It checks the bundle's published identity, preserves its original bytes, creates the native adapter, loads the actual required exports and retains the full result in `sdk-runtime.json`.

```sh
starforge carbon-native-receiving sdk --bundle /absolute/original-downloads/stellar-sdk-16.3.1-original.min.js --metadata /absolute/new-carbon-source/receiving/sdk-originals/stellar-sdk-16.3.1-original-npm-metadata.json --output /absolute/new-carbon-source/receiving/stellar-sdk-16.3.1
starforge carbon-native-receiving archive-inputs --source-root /absolute/new-carbon-source --source-manifest /absolute/original-downloads/givecredit-public-source-manifest-20261012.json --ledger-json /absolute/original-downloads/givecredit-original-ledger-51890145-transactions.json --ledger-json /absolute/original-downloads/givecredit-original-ledger-51890864-transactions.json --sdk-module /absolute/new-carbon-source/receiving/stellar-sdk-16.3.1/stellar-sdk-16.3.1.mjs --output /absolute/new-carbon-source/receiving/public-ledger-inputs
```

Use each result's actual `sdkModule` and `captureOptions` paths for the full `run`. SDK output and historical-input output must be new directories. Inspect existing `sdk-runtime.json`, `archive-inputs.json` and `capture-options.json` before selecting a recovery path. The historical command checks the whole source closure, then imports the source packet's own original input reader. Every repeated `--ledger-json` value is retained in order. Its returned counts and hashes come from decoding the supplied complete original ledger records.

The package carries the SDK preparer declaration, original npm and distribution metadata, full license and `SDK_RUNTIME.md`. The SDK guide gives the pinned public bundle URL and its exact original file integrity. `./carbon-native-receiving/sdk-runtime` is its typed package export.

## Operate the complete desks

```sh
starforge carbon-native-receiving run --source-root /absolute/new-carbon-source --output /absolute/new-carbon-run --chromium /absolute/existing/chromium --sdk-module /absolute/existing/stellar-sdk/lib/esm/index.js --actor "Native receiving operator"
```

The SDK option is optional when the original applications already resolve the installed peer. The command forwards source and output as explicit argument values to the received `receiving/receive-native.mjs`, with no shell expansion. It reports the original stage events as they happen and keeps the process attached. SIGINT and SIGTERM reach that run's owned process group, including its Chromium descendants. The stdio remains attached; the launcher never starts a background queue. When the child exits, including an abrupt failure, the launcher also terminates remaining members of that owned group and records its cleanup result.

The connected journey preserves both complete carbon source editions and issued report versions; exports all original source bodies and comparison rows; downloads each customer HTML, JSON and CSV; receives the complete workspace into another directory; and makes the next operator edit there. GiveCredit preserves its independent original registry, ledger and carbon sources, then receives its whole workspace and next edit independently. Native Chromium operates the actual forms, statement versions, downloads and file-input receiving. Finally, all four stores are closed and reopened and their saved state is checked before the full archive is written.

Add original inputs as needed:

| Selection | Run option |
| --- | --- |
| Existing complete ledger edition | `--ledger-source /absolute/original-ledger.json` |
| Authorized complete registry edition | `--registry-source /absolute/original-registry.json` |
| Original ledger capture selection | `--capture-options /absolute/capture-options.json` |
| Interrupted original capture | `--capture-checkpoint /absolute/prior-run/givecredit-ledger-capture-checkpoint.json` |
| Customer statement period | `--from YYYY-MM-DD --before YYYY-MM-DD` |
| Closed delivery archive | `--archive-path /absolute/sibling/carbon-native.tar.gz` |
| Reopen the received desks afterward | `--keep-open` |

The statement period includes its start and excludes its end. Capture selection and original relation closure remain in the capture options; statement dates do not silently trim the acquired original source.

Historical acquisition can use the complete retained public ledger payloads prepared by the maintained `prepare-ledger-inputs.mjs` reader. That reader preserves whole original provider bodies, uses the existing SDK to derive the actual matching envelopes, and writes the original capture options. Its guide and native types are carried in the same component. The typed package export `./carbon-native-receiving/archive-inputs` exposes `prepareArchiveInputs`; pass its returned capture-options path to this run.

## Join the maintained accounting case

```sh
starforge carbon-native-receiving run --source-root /absolute/new-carbon-source --output /absolute/new-accounting-run --chromium /absolute/existing/chromium --accounting-directory /absolute/original-accounting --expected-accounting-workspace-id ORIGINAL_WORKSPACE_ID --expected-accounting-sources-sha256 ORIGINAL_SOURCE_SHA256 --accounting-config /absolute/selected-original-case.json
```

The original case and its source bindings select the actual customer, the saved carbon statement and the proposed service fee. The complete selected invoice preview is saved and exported. Existing customer schedules are read and retained; an explicitly selected issued original invoice can receive a new schedule draft and its review. The receiving output keeps this case selection alongside both reporting desks.

Use the full native source guide in `stellar/scf-starforge-20261009/partners/carbon-native-receiving/README.md` for the original accounting selection fields, exact source acquisition behavior and all receiving stages.

## Inspect and receive the complete archive

```sh
starforge carbon-native-receiving status --output /absolute/new-carbon-run
starforge carbon-native-receiving verify --output /absolute/new-carbon-run
```

Both commands read the original operation. Status joins the immutable `receiving.json`, the actual archive file and its complete sibling descriptor. It checks matching operation, source/output paths, archive length, original completion time and the exact archived receiving-snapshot digest. `verify` also streams SHA256 over the whole archive and compares its original digest without loading the archive into memory.

| Status | Meaning |
| --- | --- |
| `not-started` | No invocation or receiving snapshot exists at the selected output. |
| `running` | The exact recorded native process is still present and the receiving work is progressing. |
| `incomplete` | An invocation or snapshot exists; inspect its retained stages and process record. |
| `interrupted` | The operation saved an interruption or failed to start its native process. |
| `archive-pending` | The receiving snapshot completed before a matching final archive descriptor became available. |
| `archive-invalid` | An archive descriptor exists but its selected file or immutable source snapshot disagrees. |
| `complete` | The closed archive, descriptor and original receiving snapshot agree. |

Archive status includes its exact path, descriptor, byte length, SHA256 and member count. The `verification` field distinguishes the metadata join from the explicit whole-file SHA256 pass. The wrapper's private `<output>.invocation.json` records the selected source and command, process identity, exit and observer errors outside the archived output. If recording a newly launched process fails, the launcher stops and drains its owned group before returning the error. It never rewrites the immutable archived receiving snapshot.

When `--keep-open` is selected, the closed archive completes first. Reopened desk URLs live in the sibling `<output>.live-reopened.json`. Status separately reports whether that exact same-host process is observed open, closed or unknown. Any later live-reopen error is retained alongside the already completed archive.

Move the entire archive and its descriptor through the host's existing durable file route. The archive contains the original source, closed editable workspaces, complete reports, whole handovers, browser downloads and screenshots, plus `_delivery/ORIGINAL_MEMBERS.json`. Its sibling descriptor retains every member identity and the final compressed digest.

## Native client

The installation exposes typed package subpaths `./carbon-native-receiving` and `./carbon-native-receiving/client`. `CarbonNativeReceivingClient` provides `receiveSource`, `inspectSource`, `prepareSdk`, `prepareLedgerInputs`, `start`, `run`, `status` and `verify`.

```js
const client = new CarbonNativeReceivingClient();
const source = await client.receiveSource({
  downloads: '/absolute/original-downloads',
  sourceRoot: '/absolute/new-carbon-source'
});
const run = await client.start({
  sourceRoot: source.sourceRoot,
  output: '/absolute/new-carbon-run',
  chromium: '/absolute/existing/chromium',
  actor: 'Native receiving operator',
  onEvent: event => reportProgress(event)
});
const delivery = await run.completion;
const verified = await client.verify({output: delivery.output});
```

`start` returns the actual PID, selected paths, one completion promise and a `stop` function. `run` waits for the same complete operation. Callbacks observe the existing process; a thrown synchronous observer error is retained without interrupting native work. Interruption rejects with `NATIVE_RECEIVING_INTERRUPTED` and the full current status, so the receiving output and original capture checkpoint remain actionable.

Choose the current original source packet for each run. Updating the installed launcher does not replace a received source closure. Source repairs are carried in the complete updated manifest and packet, then received into a new source directory under the same shared operation.

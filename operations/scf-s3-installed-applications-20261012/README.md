# Installed S3 merchant Applications receiving

This operation carries the published S3 merchant from its selected source archive through the maintained offline runtime installer, managed Applications, merchant release, customer delivery and normal authoring restart.

The complete receiving source is in this directory. It uses the original runtime installer, Applications controller, S3 workspace, SF82 release controller and SF30 payment transport. The selected source archive and original SDK/S3 package locks govern installation.

## Selected product and source

| Input | Original identity |
| --- | --- |
| Managed S3 product | PR1539, merge `062556fdb1850d2d1178ebbbe1223bc9f4d99d81` |
| Subsequent source-owned S3 provider | PR1738, merge `1a9787e831151949eb29e533418ae3134c141823` |
| Source selected by this receiving | `db3d9cb3d64f2aee6c1e968606bf21eb0e6ef00e` |
| Complete source archive | `source-db3d9cb3d64f.tgz`, 13,032,106 bytes |
| Archive SHA-256 | `d953328850112533ada23b7a9b4b92a22178c902d635c3c999894ae9d4dc1edb` |
| Source manifest SHA-256 | `1f18a61249d0e09f4d3d8c22b12bd555c1858a571946e76443c454336683876e` |
| Original public dependency carrier | 26,112,000 bytes; SHA-256 `690f23028fd03833444435295e0944c043475a9471f3902d3e169a0560d5394f` |
| Original SDK lock | SHA-256 `b05e75e53d9695154d57ca50e1e943cd6a41db824f12bd97ad30b54e51f6ff98` |
| Original S3 lock | SHA-256 `d84b531c51d1e8e85aeb93abfeeb45626a00aa2f1d26c3c8392ceaa4a9907ff3` |

The receiving uses native Stellar/x402, the original `s3` feature and Linux operator support. Its SDK version is the public carrier's 16.3.0; S3 uses the original AWS client 3.1149.0. The four native SDK root dependencies and the AWS root compose without conflicting package-location records. The bootstrap modules are unchanged source from the selected public product.

## Receive the complete operation

Keep this layout:

```text
receive-s3-merchant-application.mjs
retained-files.mjs
installed-receiving/
  install-and-receive.mjs
  receive-original-offline-inputs.py
  node_lockfile_cache.py
  node_package_cache.py
  launch-installed-receiving.py
  resume-installed-receiving.py
  input.example.json
  bootstrap/
```

Copy `input.example.json` to private `input.json` beside the receiving programs and enter the equipped host's actual absolute paths. Preserve the selected archive SHA, source commit and manifest. Give a new authorized receiving its own owner and operation ID. For the existing 99D0 operation, reopen its retained original input and native record.

Required existing inputs:

- The exact source archive above.
- The original public dependency carrier's `runtime-parts/public-runtime-locks.part001` through `part004`, with its `TRANSFER-MANIFEST.json`. The four parts are 8,388,608, 8,388,608, 8,388,608 and 946,176 bytes.
- The original S3 `package-lock.json` and its npm cache containing the 26 original archives.
- The equipped Linux host's Node, npm, Python, Playwright package and Chromium executable.
- The original S3 protocol fixture module selected by the operation. Its existing `startOriginalS3InventoryFixture({directory})` supplies the signed local provider and historical object versions to the maintained merchant. Keep its original source and retained provider journal with this input. The existing 99D0 operation already owns this fixture.
- A complete maintained native host runtime and the same shared disk/memory admission used by other workloads on that host.

The archive is independently retained as `libfile_3f476ddd80548191bec55a808c89ce88`, version 0. The original receiving program is retained as `libfile_a597370fcfa08191b404adb8f9370dee`, version 1. The complete original private input and source capsule are in the S3 distribution thread's Canvas `F0C8JMFQN3B`.

## Start through the maintained foreground

From the equipped host, with the actual paths:

```bash
python3 -B installed-receiving/launch-installed-receiving.py \
  --input /PRIVATE/s3-applications/installed-receiving/input.json \
  --host-root /EXISTING/complete-native-runtime/host \
  --peer YOUR_OWNER
```

The launcher registers one operation, the original Node command and its exact source, cache and browser paths. It requests 768 MiB memory plus the original 256 MiB shared reserve, and 256 MiB installation space with a 32 MiB disk reserve. The foreground remains the original owner while the browser and local services run. A previously registered input is resumed through its existing record.

The wrapper uses the maintained `start_foreground` entry point. Its cleanup covers both registration and the startup summary: once the supervisor is acquired, an inspection or output failure still enters the original handoff. Fresh launches and reused operations report the native summary's current record, state and liveness. Select a complete maintained host that exports `start_foreground` and `native_result_view.select`; the inspected current source is Commons commit `d793fc353514d265d6dbec3cdc129e2d4145f38c`.

The worker retains `original-input.json` before work. The shared receiving file helper writes and fsyncs a complete temporary file before publishing a new immutable name or replacing the current journal. An interrupted filesystem write therefore leaves the final checkpoint unmodified; matching retained bytes remain recoverable. It verifies the source archive, calls the original `prepareRuntimeInstall`, and reads the original source/profile identity. If preparation was interrupted before its install plan was published, the maintained `recoverRuntime` creates one linked receiving directory and preserves the partial source.

The offline intake checks all carrier parts and both source locks. It streams the selected package archives into a private npm cache without allocating a second combined tar. The two included Commons cache readers validate package-location graphs, registry integrity, scoped/nested packages and all required original archives. Their original Apache-2.0 license is in `LICENSE.commons`.

The maintained runtime installer then runs offline `npm ci`, imports the actual selected dependencies, verifies source identity and publishes its original READY state. The receiving worker passes that real installation's source root, profile and identity into the original customer program.

## Complete managed merchant and customer workflow

The original browser uses Applications to review, save, adopt, start and open the managed S3 merchant. The merchant saves source and payment terms, selects the original versioned object by HEAD, prepares its original package, stages an SF82 release, activates that release and starts its seller.

The customer request receives the original 402 payment challenge before any provider GET. The receiving then opens the same reviewed S3 source through its original object adapter and verifies the historical `version-one` bytes. The browser downloads both complete customer descriptors and checks their byte counts and hashes against the original release.

The same browser tab then edits both source and payment without saving. Applications Stop drains its owned authoring console, SF82 release console and seller. A normal fresh Start reopens the same merchant at its retained authoring port with its new capability. The existing tab keeps its browser origin and recovers the dirty draft and pending operation identifiers. The original import files are moved before restart, proving the merchant reopens its saved revision. The program checks that reopening adds no object HEAD, saves the recovered revision, reopens the retained seller/customer delivery and closes the final owned services.

The whole workflow includes desktop and 390-pixel browser views. The original fixture, signed provider requests, merchant revisions, releases and customer bytes are the sources of its result.

## Continue an interrupted merchant workflow

The receiving journal keeps the selected fixture, source, payment terms, application and native request identities. It writes the complete initial configuration before publishing dependent import files. A resumed attempt reuses that configuration, including its original payee, and checks the fixture and installed runtime against the first selection.

Before each browser Save or Start and each merchant Save, Review, Prepare or Stage request reaches its native writer, the receiving retains its complete original POST body. If the response or the following checkpoint is lost, continuation reads the saved request and its native result. It reopens the same application, revision, inspection, package or release through the original APIs. An application whose Save completed before its returned ID was checkpointed is recovered only when its original save identity, runtime and complete settings match.

Each customer descriptor is published only after its full downloaded bytes match the selected release. Completed files and the first complete customer/provider observation are retained through later attempts. The same-tab restart proof records the two actual application lifetimes, stable authoring origin, unchanged saved review and the absence of provider reads during that observed reopen.

A receiving process that stops before this browser proof finishes opens its ordinary browser and repeats that unfinished phase with the saved merchant. Once the proof is complete, continuation preserves it and reconciles the original final Save request. It does not turn a new browser into evidence of continuity with an ended tab.

The final result becomes `COMPLETE` only after the owned application, browser, console, model and provider have drained. A cleanup failure stays recoverable in the same journal. Reopening a completed result verifies the original input, operation, fixture, installed runtime, source files and retained customer bytes without starting listeners.

## Resume the original record

An undispatched operation resumes through the maintained foreground. Select the complete runtime's actual identity and the original input:

```bash
python3 -B installed-receiving/resume-installed-receiving.py \
  --input /PRIVATE/s3-applications/installed-receiving/input.json \
  --host-root /EXISTING/complete-native-runtime/host \
  --expected-runtime-sha256 ACTUAL_64_HEX_RUNTIME_ID
```

For a retained recoverable launch failure, first inspect the original native record. Pass its exact eligible failure SHA with `--recover-failure`. The maintained recovery archives the original failure and state, validates the original request and resumes the same foreground operation. Existing live or completed records are reconciled by the native engine.

The actual 99D0 registration exposed an older runtime's missing document-custody reader. Its corrected, already-existing runtime is `runtime-62c14-document-custody-260abed3/host`, complete identity `e6b2a5205a100814b34633229362eb847593bb4be6b8383a444be424da2d67e8`. The original eligible failure SHA is `076c829bbb0c58bf73d0506d235ca65b7f127728bbb123ef6ebffd873d646748`. Its supported recovery reached the original recovery-directory creation, where the receiving filesystem returned ENOSPC. The saved operation remains `scf-s3-applications-installed-99d0-20261012`; source, input and failure remain retained.

### Restore source and inputs after a host replacement

Keep the original operation and input selection while reconciling the original host record. The retained private input has SHA-256 `48a5bd383151d8bf3fa42524a2591f5611dad372696a003347f16e1412d3188e`. On the replacement host, verify the complete archive and every extracted source-manifest entry before invoking the installer. The original selected archive contains 3,481 source files, totaling 46,881,480 bytes.

Reopen the public dependency carrier by its complete 26,112,000-byte identity. Its four original byte slices and the six original package/lock profiles remain the intake inputs. Check the complete SDK lock and the original S3 lock; `awsCache` names the cache's parent directory, and the original AWS compressed objects belong below `_cacache/content-v2/<algorithm>/<first two hex>/<next two hex>/<remaining hex>`. Verify all 26 original AWS archives against the locked integrity values before installation.

Keep the fixture and browser selected in the original input. Reconcile an interrupted archive transfer by inspecting its original destination, retained temporary files and owning process before continuing it. A completed download must match its full byte count and hash before extraction. The existing original fixture, workspace and provider journal stay with their operation when present.

Restore the complete maintained host's import closure from one coherent source selection and check its full file identities. Reopen an existing native record through the resume command above. If the original record belongs to a replaced host, retain that host's original failure and ownership observations with the restored input, and reconcile the original execution before registering a continuation. The maintained native engine continues to own admission, records, supervision and finalization.

If an executed product phase fails, preserve that attempt and its journal, correct the concrete failure and use one linked execution against the same installed source, provider and merchant checkpoint. The runtime installer and merchant APIs govern their own recovery.

## Results and retained state

`installed-receiving.json` records source selection, original preparation, offline graph, READY identity and customer phase. `merchant-reception/managed-s3-reception.json` contains the complete customer result. A completed worker reopens its canonical original customer result and verifies its retained SHA, completed state and operation ID before returning the saved handoff. Earlier worker attempts are retained as `attempt-<uuid>.json` before a continuation replaces the current journal.

The saved source archive, original package locks, installed profile, runtime plan, provider journal, workspace revisions and release records remain available for independent receiving. The source manifest beside this guide records every operating file and its provenance.

## Existing source owners

- S3 Applications and this receiving: 99D0; original distribution thread `C0BTB4SUCP9/1791730220.899469`.
- Maintained application catalog and cumulative installation: original E9B2/D1CC/source owners.
- Exact SDK public package carrier: BC08.
- Exact S3 lock/cache and original object transport: 33E6.
- Complete document-custody native runtime: original 018A/E3E4 runtime owners.

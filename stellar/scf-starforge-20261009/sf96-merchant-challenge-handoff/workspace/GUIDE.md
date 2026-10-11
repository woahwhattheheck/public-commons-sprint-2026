# Direct-provider operator workspace

This is the local operating desk for the original SF96 merchant challenge workflow. It uses the existing SF85 capture/import, SF84 inspection, SF96 source admission, SF88 workspace/inbox, native signing, SF36 ledger, SF52 outcome classification and response writer.

The complete workflow is an actual retained response → an exact source offer and local atomic cap → the original private operator case → native diagnostics and terminal review → the original explicitly approved execution → the returned resource and independent outcome/accounting → useful-output review → private handover and complete encrypted recovery. Existing native cases can be attached and reopened.

The desk adds no payment engine or replacement inbox. Native review and execution run in the terminal that launched it. The original `/dev/tty` terms and typed approval remain authoritative.

## Run from the retained original source

Use a POSIX host with Node.js **22.16 or later**, Python 3, and the original SF88 dependencies/setup described in [OPERATOR.md](../OPERATOR.md). Node's built-in `node:sqlite` provides only the short admission mutex around SF96 coordinator ownership; the spending ledger remains the original implementation. No additional npm dependency is introduced by this desk.

From the repository root, set a private operating location with an existing parent:

~~~sh
SF96_MODULE="$PWD/stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff"
SF96_PRIVATE="/absolute/private/provider-operations"
mkdir -m 700 "$SF96_PRIVATE"
~~~

Create a host profile with actual public operator values:

~~~sh
node "$SF96_MODULE/workspace/cli.mjs" profile \
  --out "$SF96_PRIVATE/host-profiles.json" \
  --id provider-operator \
  --label "Provider operator" \
  --actor YOUR_OPERATOR \
  --service YOUR_SERVICE \
  --payer YOUR_PUBLIC_G_ADDRESS \
  --python /usr/bin/python3 \
  --secret-env STELLAR_SECRET
~~~

The command creates a private JSON file or adds a new unique profile to it. To deliberately replace an existing profile with the same ID, supply `--replace`. The payer must be the intended original public address; preparation applies the native validation. This command records public setup and an environment-variable **name**, and does not load a wallet.

An existing trusted signer integration uses `--signer-provider /absolute/original/provider.mjs` in place of `--secret-env`. The optional original setup flags are:

| Flag | Meaning |
| --- | --- |
| `--rpc HTTPS_URL` | Explicit RPC, validated against the source-selected original network |
| `--https-proxy-env NAME` | Existing host environment name for the original CONNECT transport |
| `--https-proxy HTTPS_URL` | Existing explicit trusted proxy reference; keep this host file private |
| `--sandbox-egress-range 198.18.0.0/15` | Explicit original capture overlay setting for a host that uses that range |
| `--total-atomic INTEGER` | Original total budget for each newly prepared private case |
| `--daily-atomic INTEGER` | Original daily budget for each newly prepared private case |
| `--max-response-bytes INTEGER` | Original returned-file limit; default 64 MiB |
| `--response-timeout-ms INTEGER` | Original returned-file deadline; default 30 seconds |

Each SF96 case uses the original private workspace that SF96 prepares for it. Profile budget defaults apply to **each case**; they are not a shared fleet or desk-wide budget. The source-selected network may be `stellar:testnet` or `stellar:pubnet`, subject to the released original catalog and signer setup.

Launch:

~~~sh
node "$SF96_MODULE/workspace/cli.mjs" serve \
  --state "$SF96_PRIVATE/desk" \
  --profiles "$SF96_PRIVATE/host-profiles.json" \
  --port 8469
~~~

Open the capability URL printed by this process. The service binds only to `127.0.0.1`; the browser keeps the capability in the current tab's session storage and removes it from the visible fragment after opening. Do not expose this local signing workspace as a public website. Keep the terminal open for native commands. Restarting with the same state directory reopens saved cases and changes the browser capability; use the newly printed URL.

The profile file is loaded at startup. To adopt a changed host profile, restart the server. An existing case retains its original source/configuration; a later profile edit does not rewrite it.

A desk without `--profiles` can attach and reopen existing cases, show original records, run applicable native operations, and create recovery points. New preparation requires an explicitly configured host profile.

## Source intake and exact offer selection

**Saved capture** accepts an original SF85 JSON and, for an imported-header capture, its exact original response header file. The bytes and fingerprints are retained without rewriting the capture. An imported capture keeps its original unknown `collectedAtUtc: null` and its separate import timestamp.

**Import original handoff** verifies and retains an existing native SF96 handoff directory. Its original selected offer, intent and atomic cap remain fixed, and preparation consumes that same complete bundle. If its intent already has a registered native case, the desk directs the operator to that original case instead of creating another queue.

**Response headers** invokes the original SF85 header importer. Enter the actual resource URL, its explicitly allowed HTTPS origin and the original GET/HEAD method. The importer records the operator-declared method and header fingerprint; it does not invent a collection time or fetch the resource again.

**Observe endpoint** invokes the original SF85 unauthenticated HTTPS observation once. It uses the explicit allowed origin and, when selected, the host profile's original network/proxy references. This obtains a challenge; it does not sign or purchase. A failed or interrupted request stays in the source list. Reopen its retained result before starting a separate observation.

Each intake has a stable request identifier. Repeating the same submitted identifier returns the original result or retained failure. The **Start a separate intake** action explicitly begins a different observation/import. Automatic retries are not scheduled.

The source review shows all actual alternatives and the original native admission result for each. Choose an eligible exact Stellar offer and type an independent maximum atomic amount. Atomic values remain decimal strings. The cap must cover the selected original quote.

Then choose the trusted public host profile, enter a stable intent, label/provider and useful-output criteria. Preparation calls the existing SF96 `prepare`, which initializes its original private SF88 workspace, original WAL and one original inbox item. It does not load or sign with a wallet.

Attach any pre-existing case for that same intent before preparing work. The desk rejects a duplicate intent among all cases registered with it and directs the operator to the original case. It cannot infer the identity of an unattached directory on another machine; retain one authoritative original case and queue.

## Operating a case

The **Source & outcome** view shows the exact resource, method, asset, recipient, quote, independent cap and acquisition fingerprints alongside the original public payer/network/RPC setup.

The original results remain separate:

| Result | Meaning |
| --- | --- |
| Inbox state | The original queued, cancelled, attempted, interrupted or recovered lifecycle |
| Buyer status / HTTP response | What the native request recorded |
| Seller settlement statement | The merchant's reported statement |
| SF52 classification / independent transfer | The original evidence-derived observation |
| Response writer `SAVED` | A retained file with exact path, byte count and SHA-256 |
| Original finalization | The accounting result from the existing ledger mechanism |

A paid or successful-looking label is never substituted for a missing file or independent evidence.

Use **Run setup diagnostics** for the original environment diagnostics. **Review in trusted terminal** runs the original command with its inherited terminal output. **Run in trusted terminal** invokes the original queued operation and its original wallet/policy prerequisites and typed spend confirmation. The browser cannot supply the approval or a wallet secret.

The operation is retained under a request identifier before dispatch. If the browser loses its response, refresh the original case and its activity. The desk never resubmits an unknown operation automatically. A requested stop is passed to the original running review/execute/finalize command; the existing cancellation and accounting behavior remains the implementation.

After an attempt, **Recover original outcome** reads/reconciles the original records. **Finalize original accounting** uses the original finalizer. Neither action makes another purchase. **Cancel unattempted case** is available only when the original queue exposes cancellation. The original permanent attempt is never expired, stolen or reset.

Applicable original command arrays are shown with a copyable shell form. The original `operator-cli.mjs` continues to work outside the browser.

## Useful-output review and handover

Save provider-specific useful-output criteria, private notes and a named local review. Review records are bound to a fingerprint of the original native state. A later native change leaves the earlier review in history and marks it as predating the current state.

A named review is the entered local operator's attestation; it does not claim external customer acceptance, payment or revenue. Append-only notes and the saved review history remain inside the native case for complete recovery.

**Handover & files** provides:

- the exact retained capture and original header file;
- the returned file only when the original writer records `SAVED` and its native destination, bytes and SHA-256 still match;
- a private standalone HTML handover using the original queue report, with the useful-output criteria, named review and notes added;
- previously completed exports, so a lost browser download can be obtained again without repeating a native operation.

The HTML handover contains private source and operator context. It contains no accounting keys, but it is not an anonymized public artifact. Review it before sending it to someone. It does not restore a working case.

## Complete encrypted recovery

The complete `.sf96case` archive contains every regular private file and directory in the original case: source/handoff, native workspace/configuration, inbox, original ledger and its associated files, evidence, returned resource, and saved case notes/reviews. This includes the case's original **accounting keys**. Wallet values supplied by the host environment and external trusted signer module contents are not copied.

Encryption uses AES-256-GCM with a fresh IV, a fresh salt and scrypt (`N=32768, r=8, p=1`). Both the manifest and file contents are encrypted and authenticated. Every original file fingerprint, the aggregate tree, and the reopened original case identity are checked. No plaintext archive is emitted.

The limit is 512 MiB of original file bytes and 8,192 retained entries. Symlinks, special files, shared hard links and files accessible to other users are refused. The native case is the archival unit, not the entire installed toolkit. The archive manifest records original source/runtime references; those required source/provider paths and compatible dependencies must exist on the recovery host.

From the case's **Case recovery** tab, enter a passphrase of at least 12 characters twice and create the encrypted download. Keep the passphrase separately. The server does not save it. The completed ciphertext also stays in the desk's retained export list.

From the terminal:

~~~sh
node "$SF96_MODULE/workspace/cli.mjs" backup \
  --dir /absolute/original/case \
  --out /absolute/private/NEW.sf96case
~~~

The passphrase is read without echo from `/dev/tty`. A trusted scripted operation may instead reference an existing environment variable with `--passphrase-env NAME`; the value is never a command-line argument or printed result.

### Coordination and interruptions

Supported SF96 prepare/execute/finalize/recover/cancel/report operations and backup share a short-lived case coordinator. An admission mutex makes publication and removal of its exact owner record atomic across supported commands. The mutex has no payment or spending state.

A running original attempt is not backed up as though it had stopped. Direct writers outside SF96 must follow the original queue's quiescent backup procedure. Copies are never a distributed mutex or permission to execute the same intent elsewhere.

A stopped coordinator requires an explicit owner-record comparison before release. The desk checks the original permanent attempt's process when relevant. It removes only the exact stopped SF96 owner, never the original attempt or reservation.

An interrupted restore publishes its exact staging ownership **before** creating plaintext. The Recovery view can inspect that record and explicitly retire a confirmed stopped stage. A case already published at the original destination is verified and preserved. The same admission mutex protects this action from a concurrent new owner.

Terminal inspection/retirement is available as:

~~~sh
node "$SF96_MODULE/workspace/cli.mjs" restore-status \
  --dir /absolute/original/case

node "$SF96_MODULE/workspace/cli.mjs" restore-retire \
  --dir /absolute/original/case \
  --expect-operation-sha OBSERVED_RESTORE_RECORD_SHA256
~~~

If a complete ciphertext committed before its export sidecar, the case export list shows **Verify retained archive**. Enter the existing passphrase to authenticate that same original case and complete the missing index. It does not perform another encryption or native operation.

Desk request activity is a local transport journal in the desk state directory. The complete-case archive preserves the authoritative original operation/ledger/evidence and case notes/reviews; it does not claim to back up the separate desk navigation/request index or external wallet environment.

### Restore and reopen

Upload a complete archive or select an already retained encrypted upload. **Verify and inspect archive** authenticates it and checks all retained entries before showing its original destination and source/runtime requirements. A wrong passphrase leaves the same upload available; use it for an explicit retry instead of uploading another copy.

Restore uses the **exact original absolute case directory**. Original manifest, policy, ledger, signer and response destinations are not rehashed to relocate a case. An existing destination is refused, so a live case cannot be overwritten. Reopen a present case with **Attach native case**.

The browser restores only within its current managed `cases` root. An original case outside that root uses the displayed trusted-terminal command:

~~~sh
node "$SF96_MODULE/workspace/cli.mjs" inspect \
  --archive /absolute/private/COMPLETE.sf96case

node "$SF96_MODULE/workspace/cli.mjs" restore \
  --archive /absolute/private/COMPLETE.sf96case \
  --expect-directory /absolute/original/case
~~~

Restore stages the verified tree privately, publishes it at the original path, invokes the original SF96 reopen/binding checks and verifies the complete restored tree again. It refuses to overwrite an existing target. Failed staging is retired or retained under its exact recovery intent if cleanup cannot complete. Original attempts and outcomes are not replayed.

Launch the desk against the retained original state location and attach the restored case if it was external to the managed root. Confirm its exact source, original queue state and native outcomes before continuing any applicable original action.

## Private transport

The loopback server requires the current capability header on its API, validates the exact Host/Origin and content type, and issues one-use short-lived download tickets. It serves only the three maintained local assets. Browser forms accept public source/setup choices and case context; they do not accept secret values, signer module paths or a substitute payment approval.

The capability protects the local signing workspace from unrelated browser origins. Named operators on notes and reviews are attribution, not authenticated customer identity. Keep this workspace on the trusted operating host and use the original source/terminal workflow for remote handover.

## Source references

- [Original SF96 operator](../OPERATOR.md)
- [Original SF88 inbox lifecycle and recovery](../../sf88-operator-buyer-cli/QUEUE.md)
- [Original SF88 native signer setup](../../sf88-operator-buyer-cli/NATIVE_SIGNER.md)
- [Node 22.16 SQLite API](https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html)

No provider-specific endpoint, customer acceptance or chain transfer is implied by the reusable desk. Actual provider cases retain their own source, consent, native operation and independent evidence.

### References for attached native cases

Complete recovery records the case’s actual Python executable, original workspace CLI, retained generated signer adapter, its static native signer import and any configured external signer-provider path alongside the desk checkout’s source fingerprints. These references may belong to a different retained checkout. The generated adapter is part of the encrypted case; external source, installed SDK packages and host wallet values are not copied. An unavailable old checkout or provider is recorded as unavailable so the original case can still be preserved. Restore the required external runtime before using the original execute command; backup and case restoration do not install it.

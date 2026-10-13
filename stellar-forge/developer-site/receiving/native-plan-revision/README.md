# Original native-plan revision receiving

This directory carries the complete operating programme for **SCF-SUBMISSION-PLAN-REVISION-7F5A-20261012**.
It uses the maintained submission application and the retained real SCF plan. The
private plan and application answers stay in the saved workspace.

## Receive the original complete workspace

The input is **SCF_Native_Plan_Revision_Complete_Workspace_20261012.zip**,
1,116,904 bytes, SHA-256
`0207ffbf5bcfe5663f0fe8f4d961634e58c783528bcaef70e0441a3de6dd8313`.
Its existing Library identity is `libfile_e02e4278d8e88191a02f8fad9c83ec7d`.
The extracted form contains all ten files listed in `source-and-input.json`.
The original `planning.zip` is 96,869 bytes, SHA-256
`2fcc813903a1fbd66532c0a3a17ed07d250f04d3e856f8a4c5dc84309a10e086`.

Use the developer-site source selected at Merchant
`6eb89bc7fd3078de01e7880e16d6578fb220338e`, or the matching public application
cut `985034ecdafb25c615d08491a91bcb45dfada702`.
The manifest selects and hashes all 21 required application/source files. Receive
the operator from this directory and pass the separately selected application
directory. A later repository checkout can contain this operator while the
application remains in its original detached source directory.

```sh
python3 receive.py \
  --app /absolute/selected-source/stellar-forge/developer-site \
  --case-zip /absolute/SCF_Native_Plan_Revision_Complete_Workspace_20261012.zip \
  --output /absolute/private/SCF-SUBMISSION-PLAN-REVISION-7F5A-20261012 \
  --chrome /absolute/existing/chrome-headless-shell \
  --playwright /absolute/existing/playwright/index.mjs \
  --node /absolute/existing/node \
  --library-helper-dir /absolute/existing/library-helpers
```

For an already extracted original workspace, use `--case-dir` instead of
`--case-zip`. Existing runtimes are supplied explicitly; the programme performs
no package installation. The Library helper directory contains the existing
`library_upload.py`, `library_hosted_apps.py` and `library_file_transfer.py`.
On a normal desktop, omit that option and retain the full output ZIP locally.

## Actual application course

The browser opens the maintained nine-answer application and the original edited
revision-4 draft, saves its browser identity and receives the actual native
revision-5 planning ZIP. It reviews merge/keep choices, makes a later manual
Delivery edit, refreshes the now-outdated comparison and applies the reviewed
revision. It then saves and exports the complete application, restores pending
and applied review versions, reopens the full file, and reopens the same browser
record.

The course checks the actual original planning bytes, revision identities, later
Delivery edit and retained revision-4 working-field binding. Downloaded envelopes
are opened with the maintained handover source verifier. The comparison,
decisions, complete exports, screenshots, original source and browser profile
remain in the operated workspace.

## Preserve an interrupted receiving attempt

The output directory retains one operation journal and an immutable directory
per receiving attempt. An advisory lock keeps two local producers from writing
the same operation at once. A completed operation returns its retained archive
without running a second course. An interrupted attempt remains in its original
directory; a subsequent receiving attempt starts from the same verified original
input and retains a pointer to the previous attempt.

The before-browser ZIP and its optional Library save are made before Chromium.
The final ZIP is made after success or an observed child-process failure. The
producer records the exact executable/module/origin, child return code, streamed
log and before/after cgroup readings. Only the producer's own process group is
closed. The persistent browser profile contains the saved application and
IndexedDB record; browser-generated caches are excluded from the ZIP.

To recover an attempt after an abrupt parent-process interruption, run the same
command with `--preserve-only`. This archives the existing attempt and performs
the selected preservation step. Opening the retained profile or full draft
continues its saved application state. The live installed-Page callback in
`../../GRANT_PLANNING_RECEIVING.mjs` remains responsible for continuing an
existing operator's draft through its source-owned interruption journal.

## Source and operated result

The native maintained-core course has completed against the real 400-hour,
$38,000, 150-day plan, including ten versions and export/reopen/restore. That
completed result and all source inputs are in the original archive above.
The visible course writes `case/browser/browser-operation.json` and its
observed terminal result; an admitted process is distinct from completion.

Canonical integration is the existing Site thread
https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791733597745419 .
Source delivery:
https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791856210755709 .
Preserve the original operation when an equipped receiver takes this programme.

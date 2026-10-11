# Portable merchant workspace files

The merchant console can transfer its route inputs, original captures and
unfinished terms in one local `.merchant-workspace.json` file. For the retained
case queue, follow-up notes and saved versions, see [CASE_DESK.md](CASE_DESK.md).
Start the same application from the repository root:

```sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs
```

Open the printed local address. Expand **Portable workspace files** above the
diagnosis form. Give the workspace a recognizable name, then choose **Save case
file**. The browser handles the destination and any
existing-file naming prompt. The application does not silently overwrite a file.

The file keeps route inputs, the current diagnosis and its browser check, the
selected before/after captures and paired checks, the baseline-only choice, and
all owner terms fields. Incomplete entries and currently hidden draft economics
are retained. Saving does not require a completed workorder or complete terms.
Duplicate selections of identical capture bytes occupy only one source blob.
This portable format does not include case-desk ownership, status, notes,
follow-up dates or version history. Back up the private case directory to keep
those records.

To resume, choose **Open a saved case file**. This checks the format and source
bytes and shows a preview; it does not change the current case. Save any current
work, then choose **Replace current case with this file**. Selected original
captures are available through the existing source slots and Save buttons.

Restoring does not repeat diagnosis or preflight requests. It clears derived
comparison/workorder views; use the existing **Compare changes** or **Create
workorder** actions when those documents are needed again. These actions still
use the original SF76 and SF77 implementations and their source/terms checks.
Previous in-flight results and terms imports cannot replace the restored case.
An earlier diagnosis of different route inputs stays explicitly stale.

## Data and authority

A case is private business data, not an encrypted vault. It may contain merchant
URLs, public recipient addresses, recorded permission/approval links, draft
pricing and original observations. Keep downloaded cases in an appropriate
private location. Nothing is put in localStorage, sent to a merchant, or uploaded
by the portable file controls. With case storage enabled, saving to the case desk
writes to the explicitly selected local directory. The modules have no external
dependencies or background jobs.

Existing recorded consent, prices and receipt fields survive as entered case
data. A case file does not authenticate those records. Transient permission to
run a fresh diagnosis or OPTIONS request is intentionally unchecked on restore.
Original SF77 proposal validation remains unchanged; no new approval policy,
outbound send, payment, customer acceptance or revenue event is introduced.

## Format and integration

`workspace-file.mjs` exports `serializeWorkspace(draft)` and
`parseWorkspace(text)`. The version is `stellar-forge.merchant-workspace.v1`.
`inputs` holds the native route form values; `sources` references SHA-256-addressed
Base64 blobs. The exact original UTF-8 bytes, including whitespace and line
endings, are preserved. A digest detects changed bytes; it is not a signature.
Each source retains the existing 2,000,000-byte limit, and the complete file is
limited to 16,100,000 bytes. Unknown versions, fields, missing/unused blobs,
changed bytes and invalid UTF-8 fail before replacement.

`termsText` holds the versioned `stellar-forge.merchant-terms-draft.v1` raw form
snapshot. The existing terms editor now exposes `readDraft`, `validateDraft` and
`loadDraft`; its validating `read` and `load` APIs are unchanged. This separates
saving unfinished work from exporting a completed owner-terms document.

`workspace-files.mjs` mounts the file controls through
`mountWorkspaceFiles({root, readState, applyState})`. The console snapshots form
and selected File references before asynchronous reads, validates the incoming
native form/display shapes before committing, resets operation ownership and
preserves the original sources. The case desk now owns the unsaved-draft
replacement choice; importing a portable workspace opens a new unsaved case
draft. The original diagnostic/workorder endpoints are unchanged. The local
case API is described in [CASE_DESK.md](CASE_DESK.md).

## Existing codec check

```sh
node --test stellar/scf-starforge-20261009/sf74-merchant-support-console/workspace-file.test.mjs
```

The existing three dependency-free checks cover save/reopen byte preservation
and dedup, invalid-file handling, and the actual 2 MB source boundary. The v1
codec remains unchanged by the case desk. This command is available when a
codec change requires it; the case-desk release does not add it to hosted CI.

# Recipient correction exchanges through the CLI, agent and managed application

Use the existing saved DCAT project to issue a complete editable catalogue package, receive the recipient’s exact return, and adopt an inspected reconciliation as an attributed correction revision. The browser, CLI, agent and Applications entrypoint use the same original model, workspace lease, request identities, history and complete archive.

A received proposal is a retained contribution. It does not overwrite the author’s catalogue, select a release or accept a migration or semantic result. The author chooses a saved recipient edition, compares it with the exact issued baseline and the current author revision, resolves conflicts explicitly, and binds the complete preview before saving.

The full browser/recipient workflow is in [CORRECTION_EXCHANGES.md](CORRECTION_EXCHANGES.md). The original local correction commands and agent tools remain documented in [CORRECTIONS_AGENT.md](CORRECTIONS_AGENT.md). This guide covers their additive CLI/MCP and installed-source continuation.

## What travels to the recipient and comes back

An issued package binds an exact saved correction revision and document hash, complete selected revision history, the original catalogue and any original candidate/review evidence included by the maintained writer. Each original member has its own key, byte count and SHA-256. Repeated file bytes are retained once in the package’s content-addressed inventory.

The original issue has a local exchange UUID, full JSON file hash and an intrinsic `packageSha256`. The standalone recipient HTML embeds the complete initial proposal and the selected original source. The recipient can inspect it without the author’s server or bearer URL, save successive local proposal editions, and return the complete HTML or JSON. Keep the complete file; a screenshot, patch fragment or summary is not the return.

Receiving verifies the complete file hash, every original issued member, the unchanged original issue and the full saved recipient history. It retains the exact returned bytes and records a new local proposal UUID. The return’s `senderProposalId`, edition UUIDs and source custody remain separate from that local UUID.

Unfinished working edits are retained in the received proposal’s `draft`; they are available in complete metadata. Only an explicitly selected saved edition is reconciled. The author’s current correction revision can have advanced since issue.

## Identity and hash map

| Identity | What it binds |
|---|---|
| `correctionId` | Original author-side correction draft |
| Issue `revisionId` / `expectedDocumentSha256` | Exact saved author edition issued to the recipient |
| `exchangeId` | Original issued package; equal to its stable issue request UUID |
| Issue `sha256` | Complete retained `issue.json` bytes |
| `packageSha256` | Intrinsic original issue identity verified by the exchange codec |
| `proposalId` | Local received return; equal to its stable receive request UUID |
| Received `sha256` / `expectedSha256` | Complete original returned HTML or JSON file bytes |
| `senderProposalId` | Original proposal identity inside the recipient’s return |
| `editionId` | One saved recipient edition selected for reconciliation |
| `expectedRevisionId` / `expectedDocumentSha256` | Current author head and complete document at preview/adoption |
| `previewSha256` | Whole reconciliation: source selection, current/returned bytes, explicit choices and resulting operations; independent of presentation page |
| Page download `sha256` | Complete JSON bytes of one exact preview page; distinct from `previewSha256` |
| Apply `requestId` / resulting `revisionId` | One original adoption revision and its retained decision |
| `expectedOperationId` | Existing MCP workspace concurrency guard; separate from stable domain request identity |

Keep each stable `requestId` and its complete payload after a failed or uncertain response. Refresh only the MCP `expectedOperationId` from the original current status when the same operation is eligible to continue. Never replace the domain UUID simply because a launch reply was lost.

## Complete CLI workflow

The installed command is `starforge dcat`. These commands use the existing project lease directly. Run them while the browser or managed Applications owner is closed. When that owner is running, use its original browser or the agent attached to the same owner; do not open a second controller against the directory.

The eight additive commands are:

| Command | Purpose |
|---|---|
| `correction-exchanges` | Page issues, received proposals or adoption decisions |
| `correction-exchange` | Complete issue metadata, selected history, original file descriptors and received proposals |
| `correction-proposal` | Complete received return metadata, all saved editions, working edits and decisions |
| `correction-issue` | Issue one exact saved revision with attribution and complete source |
| `correction-receive` | Receive a complete hash-bound returned HTML or JSON file |
| `correction-reconcile` | Page the exact issued/current/returned comparison with explicit choices |
| `correction-adopt` | Save the inspected reconciliation as an original attributed revision |
| `correction-exchange-export` | Export any original package, return, decision or issued evidence member |

The existing nine correction commands, migration review, release, archive and receive commands remain unchanged.

### 1. Inspect and issue an original saved revision

First use the existing `correction-get` and `correction-inspect` commands to select the original correction and revision. Retain the actual revision UUID and document SHA-256.

```sh
starforge dcat correction-get --workspace /absolute/project --correction CORRECTION_UUID

starforge dcat correction-issue \
  --workspace /absolute/project \
  --request STABLE_ISSUE_UUID \
  --correction CORRECTION_UUID \
  --revision SAVED_REVISION_UUID \
  --document-sha256 FULL_DOCUMENT_SHA256 \
  --issuer "Actual issuing operator" \
  --recipient "Intended recipient" \
  --label "Catalogue correction for review" \
  --note "Review the selected source and save an attributed recipient edition."
```

The CLI waits for the original operation. A completed issue’s result ID is the exchange UUID. Inspect it and export the original standalone HTML:

```sh
starforge dcat correction-exchange \
  --workspace /absolute/project --exchange EXCHANGE_UUID

starforge dcat correction-exchange-export \
  --workspace /absolute/project --kind recipient --id EXCHANGE_UUID \
  --out /absolute/private/dcat-recipient.html
```

`--kind issue` exports the complete original issue JSON. `--kind initial-proposal` exports its original editable proposal JSON. `--kind file --id EXCHANGE_UUID --key EXACT_FILES_KEY` exports one exact original issued evidence member. Use the actual `files[].key` from the full issue metadata, not a guessed host path or a basename.

Open the real exported HTML and use its important controls before delivering it. Inspect its source, history, exact-number values, downloads and narrow layout. The standalone file contains complete catalogue information; share it only with the intended recipient through the already authorized customer workflow.

### 2. Receive the exact return

Retain the entire returned HTML or JSON as a private regular file and compute its full SHA-256. The receiver accepts up to 256 MiB.

```sh
starforge dcat correction-receive \
  --workspace /absolute/project \
  --request STABLE_RECEIVE_UUID \
  --file /absolute/private/returned-catalogue.html \
  --sha256 FULL_RETURN_FILE_SHA256
```

The selected file must be private and stable while read. A repeated identical receive request is bound to the full expected hash; the transient local file path is excluded from the original domain request identity. This permits the same original bytes to be relocated without turning them into another proposal.

Inspect the actual local proposal ID returned by the original operation:

```sh
starforge dcat correction-proposal \
  --workspace /absolute/project --proposal LOCAL_PROPOSAL_UUID
```

Read all saved editions and distinguish them from unsaved working edits. A proposal can contain up to 256 saved recipient editions. The original author issue must still exist in this project and match the returned embedded issue exactly.

### 3. Compare the selected edition with the current author head

Refresh the correction metadata to obtain the current author revision/document hash. Select one actual saved recipient `editionId`.

```sh
starforge dcat correction-reconcile \
  --workspace /absolute/project \
  --proposal LOCAL_PROPOSAL_UUID \
  --edition RECIPIENT_EDITION_UUID \
  --expected-revision CURRENT_AUTHOR_REVISION_UUID \
  --document-sha256 CURRENT_AUTHOR_DOCUMENT_SHA256 \
  --offset 0 --limit 50
```

The response retains the complete issued/current/returned values as typed exact JSON text, conflict reasons, chosen branches, `complete`, `saveable`, conflict/unresolved/operation counts, and `page.nextOffset`. Follow every page to the terminal `null` cursor. The whole `previewSha256` is independent of page offset/limit; it must remain the same for the same selection and choices.

A conflict means both the author and the recipient changed the selected branch relative to the issued baseline. Select one exact branch:

- `current`: keep the author’s current value;
- `returned`: use the selected recipient edition’s value;
- `issued`: restore the original issued value for that branch.

The maintained comparator treats structural array changes, container replacement and restoration conservatively. It reports the exact branch requiring a choice; it does not guess that independently reordered records refer to the same item. Use the actual returned path, including the empty root pointer where applicable.

Create a complete UTF-8 JSON choices array:

```json
[
  {"path": "/dataset/0/title", "choice": "returned"},
  {"path": "/dataset", "choice": "current"}
]
```

These paths are illustrative. Use only the unique paths actually present in the selected comparison. A stale or duplicate choice is rejected.

```sh
starforge dcat correction-reconcile \
  --workspace /absolute/project \
  --proposal LOCAL_PROPOSAL_UUID \
  --edition RECIPIENT_EDITION_UUID \
  --expected-revision CURRENT_AUTHOR_REVISION_UUID \
  --document-sha256 CURRENT_AUTHOR_DOCUMENT_SHA256 \
  --choices /absolute/private/choices.json \
  --choices-sha256 FULL_CHOICES_FILE_SHA256 \
  --offset 0 --limit 50
```

CLI and agent choice files are limited to 32 MiB and 10,000 explicit paths. The choices select original exact text; they do not parse catalogue numeric literals into floating-point values.

`complete: true` means no choice is unresolved. `saveable: true` additionally requires the result to fit the original 1,000-operation revision limit. A complete preview with more operations is still retained honestly. Keeping appropriate branches as `current` can reduce the selected operations; inspect the new exact preview again.

### 4. Adopt the inspected result

Use the exact whole preview hash and the same selection/choices:

```sh
starforge dcat correction-adopt \
  --workspace /absolute/project \
  --request STABLE_ADOPTION_UUID \
  --proposal LOCAL_PROPOSAL_UUID \
  --edition RECIPIENT_EDITION_UUID \
  --expected-revision CURRENT_AUTHOR_REVISION_UUID \
  --document-sha256 CURRENT_AUTHOR_DOCUMENT_SHA256 \
  --choices /absolute/private/choices.json \
  --choices-sha256 FULL_CHOICES_FILE_SHA256 \
  --preview-sha256 WHOLE_PREVIEW_SHA256 \
  --author "Actual adopting operator" \
  --note "Adopt the inspected recipient changes with the retained explicit conflict choices."
```

The original save writer appends a correction revision. The domain retains the complete adoption decision, original issue and return, chosen saved recipient edition, current author baseline, choices and preview identity. It can retain an attributed no-change adoption without inventing a catalogue edit.

If the author head or document changes, preview again against the new actual current state. Do not merely replace a hash in the old request. If a prior adoption has started, first reconcile its same stable request and retained revision/decision before deciding on a genuinely new operation.

The resulting revision UUID equals the adoption request UUID. Export its full decision:

```sh
starforge dcat correction-exchange-export \
  --workspace /absolute/project --kind decision --id STABLE_ADOPTION_UUID \
  --out /absolute/private/adoption-decision.json
```

Use the existing `correction-get`, `correction-inspect` and `correction-export` commands to inspect and download the resulting complete document and revision record. Materialize it and prepare the original migration review separately. No release or semantic acceptance is implied by adoption.

## Agent workflow on the same owner

The existing Merchant MCP connection declares the saved workspace and any permitted local file inputs. Add only the original files the agent needs:

```json
{
  "returned_catalogue": {
    "file": "/absolute/private/returned-catalogue.html",
    "label": "Complete recipient return",
    "kind": "dcat-correction-proposal"
  },
  "reconciliation_choices": {
    "file": "/absolute/private/choices.json",
    "label": "Inspected explicit reconciliation choices",
    "kind": "dcat-correction-choices"
  }
}
```

These entries belong in the existing workspace’s `inputs` object. Preserve its original connection schema, alias, directory, runtime and source declarations. The adapter never accepts arbitrary agent-supplied host paths. Use `merchant_ckan_inputs` to inspect each configured alias’s current complete file hash and size.

The ten additive tools use prefix `merchant_ckan_dcat_correction_exchange_`:

| Suffix | Inputs and complete result |
|---|---|
| `list` | `kind`, page/filter/correction selection; separately paged pending request identities |
| `get` | `kind: issue|proposal`, `id`, section and page; complete metadata download selector |
| `metadata_read` | Same original item plus inspected full metadata hash, `readId`, byte offset/limit |
| `issue` | Exact correction/revision/document, issuer/recipient/label/note and stable `requestId` |
| `receive` | Original proposal input alias, full expected hash and stable `requestId` |
| `preview` | Proposal/edition/current author guards, explicit choices and row page |
| `preview_read` | Exact original preview page as complete JSON through the retained byte reader |
| `apply` | Same inspected selection/choices, whole preview hash, attribution and stable `requestId` |
| `files` | One original issue/recipient/initial-proposal/proposal/decision/evidence descriptor |
| `file_read` | Complete selected original file in pinned base64 chunks |

All tools include the original `workspace` alias. Mutations additionally require `expectedOperationId` from `merchant_ckan_status`. Their stable domain request UUID is separate from this outer concurrency guard. The original launch result preserves `exchangeId`, `proposalId`, `correctionId` and `revisionId` as allocated by the domain; follow the original operation before using them.

Agent pages permit up to 100 rows. The original CLI/domain permit up to 200. The adapter’s 64 KiB display budget does not truncate an original row and call it complete. It emits an explicit oversized-row descriptor and supplies the original complete metadata or page-file selection.

### Full metadata and original files

`get` supports issue sections `history`, `files`, `proposals`; proposal sections `editions`, `decisions`; and pending-request kind `pending` with section `choices`. Pending metadata retains the complete original request, its hash and stable UUID, including every explicit adoption choice. Older pending records may not yet contain a retained body; preserve the original client request for their exact replay. A completed pending request is inspected through its retained issue, proposal or decision instead. It supplies the SHA-256 of the complete metadata JSON. The full proposal metadata preserves unfinished working edits even when the display shows only their count.

The first `metadata_read` binds those exact bytes. Follow the returned `readId` and `nextOffset` with the same hash through the final chunk. A new first read detects metadata drift; continuation of an already opened reader keeps its original snapshot.

For `files` and `file_read`:

| Kind | `id` | Additional selection |
|---|---|---|
| `issue` | Exchange UUID | None |
| `recipient` | Exchange UUID | Complete standalone HTML |
| `initial-proposal` | Exchange UUID | Original editable proposal JSON |
| `proposal` | Local received proposal UUID | Exact original returned HTML/JSON bytes |
| `decision` | Adoption request UUID | Complete original decision record |
| `file` | Exchange UUID | Exact original `files[].key` |

The file reader opens the original private retained descriptor with its full byte/hash identity. Keep `readId`, expected SHA-256 and returned byte offset until complete. Use `merchant_ckan_file_release` for an abandoned read.

### Exact preview pages and choices

Choose either inline `choices` or a host alias `choicesInput` with `expectedChoicesSha256`. Do not provide both. Omission means an empty explicit-choice array. Inline choices remain exact path/branch selectors; all catalogue values returned by the original comparator remain literal JSON strings.

`preview` returns the whole `previewSha256`, actual counts and the selected original row page. Its `completeFile` identifies that **entire untruncated page JSON**, including rows too large for display. Follow `page.nextOffset` to receive all original pages.

`preview_read` separates two kinds of offsets:

- `pageOffset` / `pageLimit` select the same original comparison rows.
- `offset` / `limit` select byte chunks in that complete page JSON.

On the first read, use the exact same current revision/document and choices as the inspected preview. For an existing `readId`, the original byte snapshot continues without rereading or re-resolving a relocated choices file. The page-file SHA-256 is not the whole preview hash used by `apply`.

### Same-request recovery

After an uncertain mutation result:

1. Retain its complete body and stable `requestId`.
2. Inspect `merchant_ckan_status`, exchange lists/pending identities and the relevant original correction. Large pending requests have a complete `metadata_read` selection instead of truncated choices; follow that exact file before replay.
3. If it completed, reopen the retained exact issue, proposal or decision rather than creating another one.
4. If the original request is eligible to continue, refresh the outer `expectedOperationId` and call the same domain request unchanged.
5. Stop on a changed original hash, request payload or author revision; preserve the original state and inspect it before selecting any new operation.

A receive retry may use a relocated host alias only when the complete original file SHA-256 is identical. The domain deliberately excludes transient file path from that request identity. Issue and adoption request identities bind their actual content/selection. Adoption can resume between the original revision save and final decision retention using the same request; do not independently manufacture a replacement revision or decision.

## Applications and complete portable receiving

The existing **DCAT catalog workspace** Applications entrypoint continues to select a saved project, original environment and runtime, prepare its managed selection, and verify the original authenticated startup. There is no new application, server, interpreter installer or lease.

Its maintained source selection includes the native exchange module, pure exact-text codec, recipient renderer, recipient JavaScript/CSS, dedicated CLI, both complete guides and original correction sources. The Merchant MCP managed launcher also includes the two dedicated adapter/catalog modules. This lets the installed product retain the whole issue/return/reconciliation capability.

The original complete workspace archive carries:

- author correction drafts and every saved revision;
- issues and complete original member bytes;
- full returned HTML/JSON and every saved recipient edition;
- adoption decisions and their current/issued/returned binding;
- ordinary materialized catalogues and migration reports;
- existing acquisition, semantic validation, saved comparison and release history.

The original archive validator verifies this complete retained state on export and receiving. Continue through the existing `starforge dcat archive` / `receive` or `merchant_ckan_workspace_archive` / inspect/read/receive tools and target alias. Reopen the independently received project through the original Applications setup, browser or MCP owner. Do not export only a new adoption summary and call it a complete workspace.

A standalone recipient HTML is a complete editable issued package; a `.ckanw` archive is the whole author workspace. Keep those purposes distinct. Receiving the former preserves a proposal for author reconciliation. Receiving the latter reopens the full saved project on an independent host.

## Limits and accurate delivery

The original domain bounds are 128 MiB per original file and unique decoded issue bytes, 256 MiB per complete issue/proposal package, 256 saved recipient editions, 32 MiB recipient history/working draft, and 1,000 resulting operations per original save. CLI/MCP choices add the explicit 32 MiB/10,000-path selection bound. Limits produce an explicit error; they never silently trim source or history.

Before client-ready presentation, the producing operator must actually open the exact exported recipient package and returned file, use the important controls, inspect desktop/narrow states, open every attachment, and reopen the received complete workspace. A source review or successful command does not establish that use. Record actual completion and actual remaining work accurately; do not claim native/browser execution from source-only checks.

This additive surface preserves the original local correction, migration, semantic and release authorities. It records who proposed what, from which exact issued edition, what changed locally, and what the author chose to adopt, while retaining the complete source for the next operator.

# Native complete-source file transfer

This extends the existing source-bundle tools with the native attachment route used to move complete source into an equipped receiving session. It retains complete UTF-8 bytes, source hashes, one original draft and the provider's original attachment identity. It also preserves an optional attachment on an explicitly selected, already authorized Notion page.

The operation is a tool caller, not another email sender or queue. It has no send, forward, delete, account discovery, login, subscription, credential loading or browser action. The caller supplies the existing connected actions and an existing durable journal; a private local file journal and complete command-line bridge are included. Generic code is public. Operational journals, account IDs, source contents and provider receipts belong in the existing internal project destination.

## First choose the right receiving route

A file ID returned to one conversation may be invisible in another conversation's Files surface. Give the existing receiver the **original account link, message ID, exact attachment filenames, complete byte sizes and SHA256 hashes**. In that receiving session:

1. Read the original message with native `gmail_read_email`, `format:"full"`.
2. Select the exact MIME part only when `read_attachment_supported:true`.
3. Pass its complete returned `body.attachment_id` to `gmail_read_attachment`; if that ID is absent or explicitly truncated, use the exact filename.
4. Materialize the returned **`file_uri`** in that session's native Files runtime. `content` can be truncated; `extraction_file_uri` identifies a separate extracted JSON file.
5. Verify the original bytes and SHA256 before decoding or installing. The returned original file reference establishes availability, not a completed native calculation or a local saved path.

The `receive` command and `receiveExisting` API implement steps 1–3 against the unchanged existing draft. They create no draft or upload. Use this course before making another copy merely because a sender-side alias is invisible.

## Files and native actions

| File | Purpose |
| --- | --- |
| `native_source_transfer.mjs` | Account-bound operation, original MIME/file reading, uncertain draft reconciliation and Notion continuation |
| `native_source_transfer_tools.mjs` | Exact binding to the current native `mcp__codex_apps__*` actions |
| `native_source_transfer_journal.mjs` | Private atomic Node file journal with explicit orphan-lock inspection/recovery |
| `native_source_transfer_cli.mjs` | Prepare, advance, receive, inspect and reconcile the existing operation |
| `native_source_transfer_course.mjs` | Authored protocol acceptance course; no live service writes |

The code uses `createArchiveCodec` from the maintained Ecosystem source-tools module. It does not implement another UTF-8, Base64, gzip or SHA256 codec. Existing Python and exact-string source envelopes remain available; a carrier is an opaque original file to this operation.

The native contract requires Gmail profile, create-draft, read-email, read-attachment and list-drafts actions. Optional Notion delivery additionally uses get-self, fetch, create-attachment, update-page, get-async-task, download-attachment and get-file-download-URLs. The tool binding calls only these actions. No generic network fetch is used.

## Prepare complete original files

Requires Node.js 20 or newer and a private local filesystem with atomic rename and directory fsync. Select an existing authorized account; record its exact connected link and expected mailbox email. Prepare a JSON spec in the original private operation directory:

```json
{
  "operation_id": "SOURCE-HANDOFF-EXAMPLE-20261013",
  "link_id": "EXISTING_CONNECTED_ACCOUNT_LINK",
  "account_email": "operator@example.test",
  "files": [
    {
      "filename": "complete-source.json",
      "source_path": "complete-source.json",
      "bytes": 123,
      "sha256": "REPLACE_WITH_THE_64_CHARACTER_ORIGINAL_SHA256"
    }
  ]
}
```

The path is resolved relative to the spec. It can instead contain the complete `content` string, but never both. The independently retained expected byte count and hash must match. Source decoding is fatal UTF-8 and preserves a leading BOM, CRLF, nonbreaking spaces, numeric spelling and all other original text. Configuration JSON parsing is separate.

```bash
node tools/slack-source-bundle/native_source_transfer_cli.mjs prepare \
  --spec /private/original-operation/source-spec.json \
  --journal /private/original-operation/source-transfer
```

The returned key identifies the one account/operation pair. Reusing that pair with different files fails. The journal retains complete encoded sources so later continuation does not depend on a vanished scratch source file. Limits are 32 explicitly selected text files and 16 MiB combined original content; these are application limits, not a promise of provider capacity. File basenames must be simple ASCII without paths or collisions. Text JSON, Markdown, HTML, CSV, TSV, XML, CSS, YAML, SVG and TXT extensions have fixed MIME types. An actual native attachment may still be unsupported; the provider's `read_attachment_supported` value governs receiving.

## Run through the existing connected-tool caller

If the existing runtime already exposes the native tools namespace:

```js
import {createArchiveCodec} from "../../opportunities/upstate_forever_2026/source_tools/archive_codec.mjs";
import {createNativeSourceTransfer} from "./native_source_transfer.mjs";
import {bindNativeSourceTools} from "./native_source_transfer_tools.mjs";
import {openSourceTransferJournal} from "./native_source_transfer_journal.mjs";

const operation = createNativeSourceTransfer({
  codec: createArchiveCodec(),
  call: bindNativeSourceTools(existingTools),
  journal: await openSourceTransferJournal(originalPrivateJournalPath)
});
const result = await operation.advance(originalOperationKey);
```

`existingTools` is the already connected runtime object. It is not obtained by this package. A caller module can export this exact `call(name,args)` binding and optionally `readOriginal(file_uri)`, which must return the complete original UTF-8 text from an authorized native file read:

```bash
node tools/slack-source-bundle/native_source_transfer_cli.mjs advance \
  --journal /private/original-operation/source-transfer \
  --key ORIGINAL_OPERATION_KEY \
  --caller /private/existing-runtime/native-source-caller.mjs
```

When the native actions are available to an agent but not directly importable in its Node process, the included stdio bridge is the complete alternative:

```bash
node tools/slack-source-bundle/native_source_transfer_cli.mjs advance \
  --journal /private/original-operation/source-transfer \
  --key ORIGINAL_OPERATION_KEY --bridge stdio
```

The command emits one JSON line:

```json
{"kind":"native_tool_request","id":"source-transfer-1","name":"gmail_get_profile","arguments":{"link_id":"EXISTING_CONNECTED_ACCOUNT_LINK"}}
```

The existing connected tool host calls the exact named native action and writes one response line to that same process:

```json
{"id":"source-transfer-1","result":{"structuredContent":{"email":"operator@example.test"},"isError":false}}
```

Pass the **complete actual tool result**, not the illustrative result above. Each response must match its request ID. The process emits the next exact action until a final `kind:"result"` or `kind:"error"` line. This bridge uses the original tool host's account selection, approvals and provider limits. It does not connect another service. If the process or connection dies, rerun the command against the same journal; an uncertain creation remains pending for reconciliation.

With `--verify-original`, the bridge also emits `kind:"complete_original_read"` with the original returned file reference. Return `{"id":"...","content":"COMPLETE_ORIGINAL_UTF8"}` after an actual complete native file read. The operation checks size/hash and records the exact current file and attachment IDs. Without that read, the result explicitly retains `bytes_verified:false`; provider metadata is not substituted for byte verification.

## Receiving an already-created original draft

Create an internal receiver spec containing `operation_id`, `link_id`, `account_email`, `message_id` and `files:[{filename,mime_type,bytes,sha256}]`. These fields come from the original source owner and observed parent message.

```bash
node tools/slack-source-bundle/native_source_transfer_cli.mjs receive \
  --spec /private/original-operation/receiver.json --bridge stdio
```

This read-only course confirms the selected mailbox, original unsent draft and exact MIME metadata, then obtains the receiver's own original file references. It refuses recipient/reply headers and a sent message. It neither executes nor extracts the received source. Existing source-bank receivers enforce their original archive/member/path checks after full-byte verification.

Expired download URLs can be refreshed by re-reading the original attachment:

```bash
node tools/slack-source-bundle/native_source_transfer_cli.mjs refresh-original \
  --journal /private/original-operation/source-transfer \
  --key ORIGINAL_OPERATION_KEY --index 0 --bridge stdio
```

A refresh clears prior byte verification unless the current original is read and verified again. Current file availability and earlier verification are kept distinct.

## Uncertain draft creation and concurrency

The durable state moves to `draft_create_pending` **before** the native create call. Gmail's exposed create-draft action has no idempotency key. A timeout, malformed receipt or process loss can therefore mean the draft exists. Calling `advance` again will return `reconciliation_required`, not create another draft.

Use the existing account's paginated `gmail_list_drafts` to locate the unique deterministic subject. The actual native list shape uses `draft_id` and `message_id`. Supply the observed IDs:

```bash
node tools/slack-source-bundle/native_source_transfer_cli.mjs reconcile-draft \
  --journal /private/original-operation/source-transfer \
  --key ORIGINAL_OPERATION_KEY --draft OBSERVED_DRAFT_ID \
  --message OBSERVED_MESSAGE_ID --bridge stdio --verify-original
```

Reconciliation reads the actual parent and list, checks its account, recipient absence, exact source manifest, every original filename/size/MIME type, and complete original bytes. It binds the existing draft; it never invents IDs or retries creation because a search is empty. Listing is bounded at 100 pages and exposes incomplete pagination rather than treating it as absence.

The file journal uses an exclusive per-record lock, optimistic revision comparison, a private complete temporary file, fsync and atomic replacement. The pending state wins before a competing caller can create another draft. It is intended for a trusted local private operation directory, not a distributed filesystem or a new fleet scheduler.

A crash inside a journal transaction can leave a lock. The command never steals one by age. Stop all users of that journal, inspect the exact lock, and confirm that its same-host PID is gone:

```bash
node tools/slack-source-bundle/native_source_transfer_cli.mjs inspect-lock \
  --journal /private/original-operation/source-transfer --key ORIGINAL_OPERATION_KEY

node tools/slack-source-bundle/native_source_transfer_cli.mjs recover-lock \
  --journal /private/original-operation/source-transfer --key ORIGINAL_OPERATION_KEY \
  --expect-lock-sha256 EXACT_INSPECTED_LOCK_HASH --confirm-quiescent
```

Recovery refuses a live/unknown PID, another host or changed lock. It preserves the original lock as a recovery record. The explicit quiescent confirmation means **all journal clients are stopped**, including other recovery attempts. After recovery, inspect the original operation state; a pending provider write still requires its own reconciliation.

## Optional authorized Notion attachment

Use an existing authorized page. The target spec is `{page_id,workspace_id,user_id}`, obtained from an actual current Notion identity and page read. The operation verifies both the workspace/user and target before uploading.

```bash
node tools/slack-source-bundle/native_source_transfer_cli.mjs to-notion \
  --journal /private/original-operation/source-transfer --key ORIGINAL_OPERATION_KEY \
  --index 0 --spec /private/original-operation/notion-target.json --bridge stdio
```

Files at or below 200 KiB use complete UTF-8 `content`. Larger files use the actual original attachment's returned HTTPS URL. This command caps that route at 5 MiB, the documented free-workspace limit; it never assumes a paid entitlement. Refresh the original reference before retrying an expired URL. Normal provider URL, network and account restrictions remain in force.

Uploads and page insertion each have separate durable pending states. The upload is attached promptly using the provider's actual returned markup, including an HTML embed when appropriate. The operation appends one uniquely identified source section and reads back its stable `notion-file-block://` reference; unrelated page content remains intact. A queued result shaped `{object:"async_task",id,status}` or nested `async_task` retains its actual task ID. Subsequent calls poll that task once and return its actual state; only success proceeds to dependent attachment readback. Respect the provider's advertised polling delay.

If page insertion is uncertain, read the same target and recover the unique existing section before any further write. If upload creation is uncertain, preserve its original provider receipt. A small known upload can be reconciled by complete native download and byte comparison:

```bash
node tools/slack-source-bundle/native_source_transfer_cli.mjs reconcile-notion-upload \
  --journal /private/original-operation/source-transfer --key ORIGINAL_OPERATION_KEY \
  --index 0 --upload OBSERVED_SAME_INTEGRATION_UPLOAD_ID --bridge stdio
```

Large uncertain uploads require recovery of their original provider receipt/complete original through that integration's supported route; the tool does not guess an upload ID or silently make another copy.

To renew an attached file's short-lived ordinary URL:

```bash
node tools/slack-source-bundle/native_source_transfer_cli.mjs download-notion \
  --journal /private/original-operation/source-transfer --key ORIGINAL_OPERATION_KEY \
  --index 0 --bridge stdio
```

Keep the stable reference in handoffs. Provider `files` and `unresolved` results remain explicit. A successful upload/attachment is separate from the equipped receiver saving and opening the file.

## Executed scope

The actual native route delivered five complete source carriers on 2026-10-13, including a 1.2 MiB carrier for an 8.5 MiB full input bank. The original receiving operation accepted the source and then exposed the cross-session file-alias issue addressed by `receiveExisting`. The maintained helper's read-only receiving path was executed against the existing source-reconciliation parent: current mailbox, exact MIME part and a fresh original file reference were returned without creating another draft. A separate complete 116,648-byte Notion download matched its independently recorded SHA256.

Run the focused authored protocol course with `node tools/slack-source-bundle/native_source_transfer_course.mjs`. The authored protocol course exercises exact Unicode/CRLF source, original-versus-extraction selection, one-draft repeat reuse, concurrent creation, lost creation reply followed by original-byte reconciliation, recipient rejection, same-target Notion reuse, lost insertion reply, queued task continuation and receiving without a new upload. These are explicit authored service fixtures. They are not claims of another native source calculation, actual local file-journal execution or customer visual acceptance. Operational receipts remain in their original internal cases.

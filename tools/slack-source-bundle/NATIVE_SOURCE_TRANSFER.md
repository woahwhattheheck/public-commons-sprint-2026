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

## Attachment-only transfer and retained operations

New plans use `attachment-manifest-v2`: one `multipart/mixed` draft containing the selected source attachments plus `SOURCE_TRANSFER_MANIFEST.json`. The manifest binds the operation, account and every original filename, MIME type, byte count and SHA256. Its name is reserved, case-insensitively. The 32-file limit counts user source files; the generated manifest is additional. File indices continue to refer to the user's original source list.

The create call supplies only the selected account link, deterministic subject, attachment MIME tree and requested receipt fields. Each part carries the original UTF-8 bytes as URL-safe Base64. It omits inline content, explicit charset, sender override, recipient and reply fields. Returned sender and recipient absence are independently checked against the selected account. Padded and unpadded canonical Base64 representations describe the same bytes; the selected encoding is not an asserted provider requirement.

This minimal form addresses observed native argument-binding failures with the older composite request. Actual successful calls also exist with an inline HTML part when its explicit charset was omitted. The observations do not isolate padding, inline content or charset as a universal cause. Keep the actual provider response in the private operation record; do not infer acceptance from a generic success label.

The journal schema remains `commons.native-source-transfer/v1`. Historical plans without a transport field retain their exact inline manifest, fingerprint, deterministic subject, source contents and draft. A new caller preparing the same account/operation and source identities resumes that original record, including a pending creation or Notion action. It does not rewrite the plan or create a replacement draft. A different source set still fails with `OPERATION_PAYLOAD_CONFLICT`. If deliberately reconstructing an old plan from its source spec, set `transport:"inline-manifest-v1"`; this reproduces the historical plan exactly, including an old source file that happens to use the now-reserved manifest name.

Readback checks the complete attached manifest before releasing or refreshing source references. With an original-file reader, its bytes and SHA256 are verified. Without that reader, the provider must return complete, untruncated extracted JSON whose full parsed contents equal the expected manifest. Extraction may reformat JSON; this is recorded as `content_verified.via:"complete_extracted_json"` and leaves manifest byte verification empty. A truncated or missing extraction returns `COMPLETE_MANIFEST_READER_REQUIRED`; rerun the same operation with `--verify-original`. The existing draft remains available and is not recreated. Source `bytes_verified` always depends on reading each complete original source file.

## Preview the complete request before creation

Use the existing builder rather than manually composing attachment parts. Its unchanged `draftArgs(plan)` emits URL-safe Base64 for exact original bytes and omits attachment-level charset. An optional legacy inline text body may retain its UTF-8 charset. Receiving still preserves historical payloads as authored; this guidance does not rewrite earlier requests.

The CLI can inspect a complete source spec without opening a journal or calling a provider:

~~~sh
node tools/slack-source-bundle/native_source_transfer_cli.mjs preview \
  --spec /private/original-operation/source-spec.json \
  --max-request-bytes 12582912
~~~

The number above is an example operator-selected advisory, **not a discovered Gmail or connector limit**. Omit it for size measurement alone. Preview returns the original source manifest, deterministic operation identity, exact UTF-8 byte count and SHA256 of the serialized invocation, each complete decoded attachment identity, the generated manifest's contribution and any recipe findings. It does not output the attachment bodies or claim account/provider acceptance. A byte advisory never changes files, plan fingerprints, the journal or the existing advance behavior.

For an already prepared create/update request saved as JSON:

~~~sh
node tools/slack-source-bundle/native_source_transfer_cli.mjs inspect-request \
  --spec /private/original-operation/exact-request.json \
  --max-request-bytes 12582912
~~~

This pure inspection flags attachment-level charset, non-Base64URL attachment bodies, malformed Base64, duplicate filenames, recipient fields and other deviations from the maintained minimal recipe. It preserves the input. `recipe_compatible` describes this recipe, not every valid Gmail MIME form; it is not a provider schema validator or proof that a mailbox operation will succeed. Size measures the exact object serialized by the caller, excluding unknown external transport overhead.

The same APIs are available to a connected JavaScript caller:

~~~js
const plan = operation.prepare(existingSpec);
const preview = operation.preview(plan, {maxRequestBytes: selectedAdvisory});
const existingRequest = operation.inspectDraftArguments(retainedArguments);
// Use operation.start(plan) / operation.advance(plan.key) for the existing transfer.
~~~

In a later controlled same-draft update, attachment-level charset caused an argument-binding/schema-validation rejection; removing those attachment fields admitted the same Base64URL content. A separate smaller request with the rejected fields also failed. These observations support this minimal recipe, not a universal provider MIME rule or an inferred request-size cap.

Keep the complete provider error and its stage. An `argument_binding/schema_validation` result does not by itself establish a size limit. The observed compatible attachment shape is:

~~~json
{
  "mime_type": "application/json",
  "filename": "complete-source.json",
  "content_disposition": "attachment",
  "body": {"base64_url_content": "EXACT_ORIGINAL_BASE64URL"}
}
~~~

Before reducing a large pickup, inspect its actual serialized request and retain every original in the complete source. Use the maintained [lossless source archive packer](../revenue_owner_console_20261010/lead_cohort_toolkit/source/SOURCE_ARCHIVES.md) to carry repeated embedded applications once without changing reconstructed bytes. Select that complete carrier, its existing materializer/opener and the useful readable scope or guide. A separately attached expanded copy of the same application may be omitted only when its exact bytes are already inside the verified complete carrier. Record the selected attachment manifest; do not silently drop unique source or split an existing operation after a provider outcome becomes uncertain.

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

The returned key identifies the one account/operation pair. The returned state is the actual retained phase, including when prepare resumes an existing operation. Reusing that pair with different files fails. The journal retains complete encoded sources so later continuation does not depend on a vanished scratch source file. Limits are 32 explicitly selected text files and 16 MiB combined original content; these are application limits, not a promise of provider capacity. File basenames must be simple ASCII without paths or collisions. Text JSON, Markdown, HTML, CSV, TSV, XML, CSS, YAML, SVG and TXT extensions have fixed MIME types. An actual native attachment may still be unsupported; the provider's `read_attachment_supported` value governs receiving.

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

A refresh rechecks the same original parent and its current manifest, and clears prior source byte verification unless the current original is read and verified again. Current file availability and earlier verification are kept distinct.

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

The attachment-only successor was exercised through the actual production functions with authored provider results for both transport editions: unchanged historical plan reconstruction, same-operation pending continuation, original-draft reconciliation, complete/reformatted manifest content, truncated extraction, changed manifest rejection, original source bytes and existing Notion continuation. The original legacy producer and successor produce byte-identical historical plan JSON. On 2026-10-14, the production caller created one actual recipient-free attachment-only draft containing a complete 150,152-byte source candidate and 19,728-byte guide. Its first pass accepted the complete extracted manifest and retained original source references with byte verification pending. The same operation then used the actual raw MIME originals and verified both complete source files plus the manifest, without another creation. This exercised the real native Gmail actions from the JavaScript runtime with the session journal adapter; the local filesystem journal and Node CLI were not executed in that run. Exact private provider receipts remain in the original internal operation.



The actual native route delivered five complete source carriers on 2026-10-13, including a 1.2 MiB carrier for an 8.5 MiB full input bank. The original receiving operation accepted the source and then exposed the cross-session file-alias issue addressed by `receiveExisting`. The maintained helper's read-only receiving path was executed against the existing source-reconciliation parent: current mailbox, exact MIME part and a fresh original file reference were returned without creating another draft. A separate complete 116,648-byte Notion download matched its independently recorded SHA256.

Run the focused authored protocol course with `node tools/slack-source-bundle/native_source_transfer_course.mjs`. The authored protocol course exercises exact Unicode/CRLF source, original-versus-extraction selection, one-draft repeat reuse, concurrent creation, lost creation reply followed by original-byte reconciliation, recipient rejection, same-target Notion reuse, lost insertion reply, queued task continuation and receiving without a new upload. These are explicit authored service fixtures. They are not claims of another native source calculation, actual local file-journal execution or customer visual acceptance. Operational receipts remain in their original internal cases.

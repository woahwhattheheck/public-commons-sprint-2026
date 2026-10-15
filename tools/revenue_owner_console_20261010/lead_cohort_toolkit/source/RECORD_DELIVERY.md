# Record and reopen a completed customer delivery

Use this command on the original complete customer source after its authorized sender has actually sent the message. It reconciles the original event, joins the actual Gmail sources, preserves the whole application/customer history and publishes a complete independently reopenable successor.

## Original inline course

The existing plain-text course remains supported:

```sh
node native/record-delivery.mjs Original-Customer-Source delivery-input.json Delivered-Customer-Source
node Delivered-Customer-Source/native/reopen-cohort.mjs Reopened-Customer-Files
```

The input contains the original operation_id, delivery_id, edition_id, account_email, destination, subject, original_body_path and complete sent_message from Gmail FULL. original_body_path is relative to the input JSON or an absolute path. The selected body must equal the complete original text/plain body. Set recorded_at only when its actual original value is known; otherwise the publisher durably selects the first invocation time.

## Complete multipart course

For plain/HTML alternatives or attachments, also supply the complete original native MIME payload, actual Gmail RAW response and every attachment's retained source path. Both external JSON files are resolved relative to the input JSON. The original payload uses the existing native Gmail authoring structure: MIME containers, text body.content with charset UTF-8, and attachment body.content or base64_url_content. Keep original strings, filenames, MIME types, ordering and byte representations.

```json
{
  "operation_id": "original-delivery-operation",
  "delivery_id": "original-delivery-id",
  "edition_id": "original-edition-id",
  "channel": "email",
  "account_email": "sender@example.com",
  "destination": "customer@example.com",
  "subject": "Exact original subject",
  "original_body_path": "first-email.txt",
  "original_payload_path": "original-payload.json",
  "raw_message_path": "actual-sent-raw.json",
  "history_path": "native/operation-history.json",
  "attachments": [
    {
      "source_path": "customer/Original_Pack.json",
      "filename": "Original_Pack.json",
      "mime_type": "application/json"
    },
    {
      "source_path": "customer/Original_Pack.html",
      "filename": "Original_Pack.html",
      "mime_type": "text/html"
    }
  ],
  "sent_message": {}
}
```

Replace placeholders with the retained original case. sent_message is the complete successful Gmail FULL result, including SENT labels, internal_date, original headers and MIME tree. actual-sent-raw.json is the complete successful RAW response for that same provider message/thread. An inline original_payload or raw_message object can replace its corresponding path; do not supply both forms. The original primary-body file is the exact plain alternative when present, otherwise the exact sole HTML body.

Attachments select actual files already present in the original complete source. The filename and MIME type must match the original payload. The retained source bytes, payload bytes and actual decoded RAW bytes must agree. Include every original attachment once; no unselected MIME leaf is accepted. Binary source members are supported by the same complete source bank and Python opener. Existing native limits remain ten attachments and 8 MiB total; RAW has the maintained finite parse limits. Unsupported structures return the original parser error without changing the source or delivery history.

The receiver reuses connected_mime.cjs and connected_gmail_raw.cjs. It checks original provider/RFC identities; full sender, single recipient, date and subject headers; exact MIME container/leaf structure; original plain/HTML alternatives; every attachment's filename/type/length/SHA; and source path correspondence. Actual attachment bytes remain authoritative when an attachment's omitted charset prevents optional text decoding; that original parser warning is retained. The complete RAW response and original authoring payload stay in the delivered source. Readable body content is never obtained by flattening attachment or HTML text.

Connector-authored text content may omit its charset; the receiver uses UTF-8 for that text and retains the exact original authoring payload. Explicit non-UTF-8 charsets reject. The FULL/RAW header comparison decodes RFC 2047 words and ignores only outer space/tab folding; the original raw headers and exact authored-subject binding remain retained.

## Preserve the original event

Use channel email or gmail exactly as retained in the original event and operation. The default is gmail for the original inline course. Provider IDs are reconciled across both supported channel labels before any new event, so a channel change cannot produce a second delivery. Existing delivery IDs, edition, recipient, timestamp and original operation must match. Newly recorded delivery uses the maintained delivery-record operation. Original histories may be native/operation-history.json or internal/operation-history.json; select history_path when both are retained.

Full operation replay must reproduce the exact saved working record. Existing saved delivery-feedback operations use the customer's retained portable Gmail module when present. Every original customer JSON edition is regenerated with that source's original renderer and Markdown formatter and checked against all four actual files. Promotion packs with their original named customer files and cohort packs with their original sample/paid files use the same recorder and reopen command. For original cohort preparations, the command opens each retained complete ZIP, validates all member boundaries and checksums, and checks its original four customer exports and retained guide (the original preparation guide or the complete current customer guide). Supplemental ordinary customer files must match their archive members. An included `MANIFEST.json` must account for every other member with its exact byte count and SHA-256. It preserves the exact ZIP bytes, including supplemental project files, compression and timestamps. An expanded ten-member project ZIP is therefore retained intact. Only a legacy preparation with no ZIP reconstructs the original five-member archive from its complete source. A promotion pack does not acquire a guessed ZIP or cohort configuration.

An existing inline-only receipt remains that original receipt. The command rejects replacing it with a different multipart representation. For a multipart delivery whose event already exists but has no receipt index entry, it joins the complete original MIME receipt without duplicating the event. Repeating the exact same original sources retains the first receipt and complete output bytes.

## Complete source and independent reopening

The delivery index binds provider identity and original event to retained sent-message.json, first-email.txt and, for multipart, original-payload.json and sent-raw.json. It records each original text alternative and attachment source path, length, SHA, MIME type and original part position. Reopening verifies all complete source text and binary members, the index, each selected original history and every original message source before reproducing customer files. A missing, changed or null index cannot replace one declared in the complete source.

The full input source bank is preserved under history/source-editions/SOURCE_SHA256/complete-source.json. Updated tool bodies retain complete predecessors under history/delivery-tool-predecessors/BODY_SHA256/. Original custom scripts, customer editions, payment history, messages, parser sources and binary ZIPs remain available. The output's complete-source.json carries all text and binary members.

```sh
python native/materialize-source.py complete-source.json Recovered-Source
node Recovered-Source/native/reopen-cohort.mjs Reopened-Customer-Files
# When needed, explicitly select the retained legacy history:
node Recovered-Source/native/reopen-cohort.mjs Reopened-Customer-Files internal/operation-history.json
```

An older source directory without a complete-source bank can use the original history and top-level customer files. Complete current deliveries use the whole source bank.

## Resume the same operation

Preparation, recording and generic reopening use source/source-publication.cjs. Its sibling OUTPUT.lead-delivery-state retains the exact original input, selected tool/source edition, first timestamp and full planned output bytes. Exclusive temporary files are synced and create-only linked into their final paths; identical existing members are reused, conflicting or undeclared members reject. Preparation and recording publish complete-source.json last. Independent customer reopening explicitly binds manifest.json as its final completion member and publishes it after the customer files and working record; its receipt identifies that manifest. The publisher preserves the complete-source default for source deliveries, and a retry cannot change the selected completion path. An interrupted or completed retry with unchanged input resumes the same selected output and verifies it.

Keep the same original source/input/output and sibling state after interruption. Do not rewrite recorded_at to the retry time. For a deliberately different input or tool edition use a new named output. The Python opener separately preserves its OUTPUT.source-open-state; see source/MATERIALIZE_SOURCE.md. State and output must share a filesystem supporting create-only hard links; platform failures retain the original unfinished operation.

The recorder works on an already-sent message and performs no mailbox mutation. Use the original company case and sender for current relationship work. Favorable human contact follows the current account's designated relationship owner while the team continues the internal work.

## Buyer contact corrections

When a published contact route changes, preserve the original operations and buyer revisions. Historical receipt verification replays the complete original history and uses the buyer revision immediately before each original `delivery-record` operation. Each retained actual destination must match that historical route. The complete replay must still reproduce the current working record, and existing provider identity, MIME, body, attachment and operation checks continue to apply.

New `recordDelivery` calls still compare the actual new recipient with the current buyer route. Record the corrected buyer through the maintained pack-save operation before recording a new send. Keep both actual sends and the original permanent-failure evidence in the original private company source.

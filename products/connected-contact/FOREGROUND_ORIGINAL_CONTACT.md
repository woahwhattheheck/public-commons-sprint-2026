# Continue one original contact through the foreground bridge

This adds the maintained operator's `select-continuation` and `continue` commands. It uses the original SQLite coordinator, original contact checkpoint, existing account admission, native Gmail tools and the existing foreground relay. It does not create a queue, listener, scheduler, credential service or account. Preparation mode and its source-only Git readers are unchanged.

## Deployment and actual authority

The coordinator's existing owner supplies the real Linux/WSL directory, coordinator UUID, complete authority, account source and private configuration. Source publication does not establish that shared placement, migrate account history or authorize a second coordinator. Use the complete selected product source and its matching SOURCE_MANIFEST.json. The existing product loader verifies every declared leaf before opening the original coordinator.

The new mode makes no Git mutations. Migrated journals may retain historical account or checkpoint verification. For those unchanged histories, it admits only explicitly selected original repository/path/immutable-commit file reads; it retains the original factory's full verification. Company reservations, account admission and checkpoint writes stay in the same selected SQLite coordinator. It exposes only the configured two Gmail identities, the original relationship callback, and at most one exact native email/draft invocation. The unchanged factory checks both actual mailbox profiles, fresh recipient/company correspondence, current account usage and cooldowns, reservations, and the exact selected native envelope. A queued/deferred result stays queued/deferred. No source constant is permission to ignore a current provider response or owner instruction.

Keep all private configuration, selections, attachments, runtime journals, relay state and actual provider returns out of public Git. The public repository contains only generic source and this guide.

## Select from an existing received checkpoint

First receive the original journal/checkpoint using the product's existing adoption command and original owner-selected account placement. This extension does not initialize a new first-contact intent or copy an account into another directory.

Create a mode0600 organization.json containing the actual reviewed company-wide query and domains. Include known company/founder/product aliases in that query. Do not infer an empty history from a failed read.

```json
{"query":"THE ORIGINAL REVIEWED COMPANY QUERY","domains":["the-actual-company-domain"]}
```

The following command is a provider-free local selection. It reads the actual existing checkpoint and constructs the complete native arguments with the maintained renderer, including every selected attachment byte. Substitute actual deployed paths and existing identities; the examples are not runnable account defaults.

```sh
node SOURCE/connected_contact_operator.cjs select-continuation \
  --config PRIVATE_CONFIGURATION.json \
  --operation ORIGINAL_64_HEX_OPERATION_KEY \
  --operation-id ORIGINAL_FOREGROUND_OPERATION_ID \
  --owner ORIGINAL_OWNER \
  --organization organization.json \
  --method accountStatus \
  --selection selected-continuation.json
```

Choose one actual method:

| Method | Additional selection | Effect |
| --- | --- | --- |
| accountStatus | none | Original account inspection only |
| run | none | Continue this original contact; its native account/correspondence guards decide eligibility |
| resumeRecipient | none | Original retained recipient continuation |
| resumeRateLimited | none | Original validated returned-rate continuation |
| resumeConsole | none | Copies the original saved console handoff without reconstruction |
| reconcile | --message ACTUAL_MESSAGE_ID | Read and reconcile the original sent message |
| receiveSent | --message ACTUAL_MESSAGE_ID | Original maintained external-completion receiving |
| receiveCompletedDraft | --message ACTUAL_MESSAGE_ID | Original saved-draft completion receiving |
| receiveDeliveryNotice | --message ACTUAL_NOTICE_ID | Import the actual original delivery notice |
| reconcileAccountAdmission | none | Original retained account attempt reconciliation |

Every selection contains the exact runtime input, input hash, lease, state key, operation key, coordinator authority, both mailboxes, native send binding and complete native arguments. It is an immutable selection for one foreground command. Changing the method or receiving a newly reviewed input requires a newly explicit selection; preserve the predecessor.

## Foreground configuration

Use the existing `commons.connected-contact-tool-bridge/v1` configuration with:

- `mode: "continue-original"`.
- The same original operation_id and a unique retained 64-hex session_id for this foreground invocation.
- Real absolute source_directory, journal_directory and node_executable.
- argv selecting `continue --config ... --operator SOURCE/connected_contact_operator_bridge.cjs --selection ... --journal ... --result ...`.
- Exact SHA256/byte pins for the private config, selected-continuation.json, SOURCE_MANIFEST.json and actual Node executable.
- `policy: {repositories: [], gmail_link_ids: [ACTUAL_BUSINESS_LINK, ACTUAL_SECONDARY_LINK], historical_files: []}`. For migrated history, populate historical_files with its exact original `{repository_full_name,path,ref}` tuples. The ref must be the original immutable40-hex commit; an arbitrary current branch, directory, different file, profile call or Git write is not admitted.
- A finite max_calls large enough for the original complete account/correspondence pagination.

The configuration is mode0600; the private journal is an existing owner-controlled mode0700 directory. The original bridge checks real paths, ownership, source/runtime identity, input pins, and exact CLI arguments. It refuses a previously created same-session directory instead of silently launching over its uncertain history.

The exact command launched by the maintained relay is:

```sh
env COMMONS_CONTACT_BRIDGE_CONFIG=BRIDGE_PRIVATE.json \
  ACTUAL_NODE SOURCE/connected_contact_operator.cjs continue \
  --config PRIVATE_CONFIGURATION.json \
  --operator SOURCE/connected_contact_operator_bridge.cjs \
  --selection selected-continuation.json \
  --journal ORIGINAL_PRIVATE_JOURNAL_DIRECTORY \
  --result original-continuation-result.json
```

Use `runConnectedContactOperator` from the same full source. In addition to the existing configurationText/configurationPath, original hash helpers, native transport and private loadState/saveState callbacks, pass:

- `selectionText`: the exact bytes of the pinned selected-continuation.json.
- `reviewRelationship({selection,spec})`: the original owner’s current relationship-review callback. It must return the original factory decision object with boolean can_contact; preserve applicable original reviewed-message, correction, console or archive fields. It is a callback, not a fabricated tools registry name.

The callback is requested through the existing foreground transport and its full decision is journaled before the factory continues. It is not a new user-approval flow: retain the task's actual authorization and existing positive-human-contact rule. An unreviewed/current human reply cannot be called cold. Every further external message/attachment after positive human contact requires Bryce's individual approval. Keep his reduced-volume/manual-capacity instruction and every actual provider deadline.

The retained relay state must use the original caller's private durable receiving mechanism, and saveState must finish before returning. Do not use a newly empty state key to resume an uncertain invocation. The relay independently checks selection bytes against their pin and each tool's allowed argument shape.

## Exact message and result transport

Short requests retain the existing framing. Requests above16KiB use an acknowledged pull sequence:

1. The native bridge fsyncs the complete original request file before emitting its length/hash.
2. The foreground asks for the next8KiB chunk. Each ordered chunk is retained before the next request; all bytes must match the original complete SHA.
3. Only the reassembled verified request enters the normal allowed-tool dispatch path.
4. The relay saves DISPATCHING before calling the actual tool. It permits at most one selected email/draft send per foreground invocation.
5. It retains the full CallToolResult or full returned exception before encoding the response.
6. The original existing response protocol delivers the complete result in acknowledged chunks. Node fsyncs the full original response before resolving the factory’s tool call.

The limits are96MiB per operational request and256MiB per complete response. Larger original content fails explicitly and remains retained; no truncation, metadata replacement, alternate attachment or resend occurs. Complete MIME/base64 attachment bytes remain in the native request journal and the relay's selected request.

Git writes, unselected historical reads, different mailboxes, another recipient/body/attachment/draft, unselected methods and a second native send are rejected. The factory's existing original-call/checkpoint transport is still the source of account charging, provider rate classification and contact reconciliation.

## Outcomes and interruption

CLI `status: COMPLETE` means this command's full result was saved and the original handle was closed or its close failure was retained. It never means an email was delivered.

Read original-continuation-result.json. It retains:

- exact selected operation and input identity;
- the original method/result, including ACCOUNT_DEFERRED, SEND_OUTCOME_UNKNOWN or SENT_VERIFIED;
- complete original checkpoint location and snapshot;
- original exceptions, returned send evidence and any close error.

The snapshot/result is journaled before closing. Close failures are retained as ORIGINAL_CONTINUATION_REQUIRED, with the original returned result intact. On rerunning the identical saved command, its completed result is returned before reopening the contact; it does not invoke the provider again.

If a provider call is DISPATCHING without a retained return, the relay stops unresolved. Resume only that exact native session and retained relay state when its actual return/acknowledgment is recoverable. It does not replay that tool call. If the native session ended, preserve its complete bridge journal and original checkpoint, inspect the original Gmail outcome, and use the maintained `reconcile` or original receipt-recovery method with the actual message ID. Do not select a fresh sender/controller because a return was lost.

A full native return already retained in the relay can continue through the same response transmission without another provider invocation. The original factory/checkpoint also retains its send transport and validates matching Sent MIME. A successful provider acceptance and a later bounce remain separate events in the same case.

## Actual operating handoff

The existing equipped coordinator owner performs this course with one real received checkpoint:

1. Verify the deployed coordinator/private account authority and select accountStatus from the actual original checkpoint. Run it through this same bridge and inspect the complete saved original result.
2. Select the authorized original continuation with its unchanged input and current relationship callback. Open/read the exact outgoing body and each real attachment in its normal viewer before customer delivery. The source review is not a client-readiness claim.
3. Continue once. Retain the actual account decision, full native request, provider result, exact Sent readback and original contact/account outcome. Stop at a real deferral or uncertainty.
4. Reopen the saved result and original checkpoint. Verify that its actual original IDs and attachment bytes are unchanged and that a completed command returns its retained outcome without another send.
5. When an actual response was interrupted, resume the same relay session or use original receipt reconciliation; keep its full failure/return evidence. Do not manufacture an interruption or send a second message to exercise this path.

No actual coordinator deployment, provider invocation or client delivery is claimed by this source handoff. Current configuration and shared placement remain with the original owner.

## Existing owner controls

The repository AGENTS.md remains authoritative. Before calling a recipient-facing output ready, actually OPEN, LOOK at and USE the exact outgoing version and all attachments in their normal viewer, including real desktop/narrow layouts where relevant. Bryce’s earlier local Codex browser reservation was released after the meeting; use the currently authorized route and preserve actual browser owners, queues and tabs. Check any newer owner instruction before operating. No Actions, private Git writes, access changes, new account, paid purchase or new scheduler is part of this extension.

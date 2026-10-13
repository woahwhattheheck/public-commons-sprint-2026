# Shared local mailbox-admission storage

This source adds an explicit storage injection to the existing admission helper. It does not receive or migrate a live account, create a new account, change limits, reset a queue, send mail, or authorize contact replay.

## Selection and authority

Pass options.storage with kind commons.connected-contact-local-state/v1, the original coordinatorId UUID, and verify/read/compareAndSwap/history methods. The coordinator belongs to the whole selected fleet scope. Do not create a per-seat database or silently choose a new directory after an error.

The existing account key is unchanged: SHA256 of JSON.stringify({provider:'gmail',profile_id:<original string ID>,activity:'Mail sending'}). verify returns the same kind/coordinator_id and authority {scope_id,accounts:[{account_key,profile_id}]}. The admission helper verifies the selected account's native Gmail profile independently. It never switches accounts or bindings on failure.

A missing local account raises LOCAL_ACCOUNT_ADOPTION_REQUIRED. Only the separate original-owner receiving operation can import the complete accepted account. This helper has no account initialization or adoption method.

## Exact snapshot and receipt

read({namespace:'account',key}) returns null or:
- kind commons.connected-contact-local-snapshot/v1
- coordinator_id, namespace, key
- storage revision, sha256 and exact UTF-8 content
- receipt schema commons.connected-contact-local-receipt/v1
- receipt coordinator_id/namespace/key/revision/sha256/previous_sha256/operation_id/action/created_at/origin

The receipt origin remains unchanged:
{kind:'git-original-readback',repository,path,commit_sha,blob_sha,sha256,observed_at,receipt:<complete original readback>}.
The first storage revision has null previous_sha256 and content matching origin.sha256. Its business state is the original complete account, not a synthesized fresh state.

Storage revisions and original business state.revision are separate. Subsequent snapshots form one contiguous storage SHA chain and increment business revision by exactly one. The helper validates the original account, deadline, queue, lease, debit and native-return structures in every received postimage.

## CAS and uncertain returns

compareAndSwap receives exactly {namespace,key,expected_sha256,operation_id,content}. operation_id is the SHA256 of:
{kind:'commons.connected-contact-local-state/v1',coordinator_id,namespace:'account',key,expected_sha256,content_sha256}.
The full next content includes its first updated_at timestamp. The invocation is journaled before the await, and its complete typed returned snapshot afterward. Binding is commons.local-state.compareAndSwap, not a Git tool name.

Exact replay must return the same original snapshot/receipt, even after later writes. Reusing the ID with different arguments must reject. Only code LOCAL_STATE_CONFLICT with status409 permits a new state read and business transform. An unknown return retains its original arguments; the next receiving pass reconciles exactly that operation before later transforms. It does not build another timestamp or replacement lease.

Checkpoint wrappers may persist the same exact invoking/returned transport around the injected method. The original account journal remains the source of the admission helper's same-operation recovery.

history({namespace,key,after_revision,limit<=100}) returns complete snapshots and next_revision equal to the last returned revision when another page exists, or null at the end. Each page must be contiguous. The helper checks current head against the received chain and its observed floor.

## Bounded contact checkpoint retention

Receiving still reads and validates every full intermediate account revision from the selected coordinator, including business revision increments, unchanged original provenance, queue/debit structures and monotonic provider deadlines. It then journals one hash-bound receiving range and the final complete account floor. The range retains first/last revision references, count, a rolling hash of every received immutable receipt and the preceding verified floor.

The coordinator retains all complete originals. This contact retains its own exact CAS invocation/return bodies plus the latest verified receiving floor; it does not copy every unrelated global account postimage into its checkpoint. A reopened handle validates the saved range and reads the actual current coordinator head. Any later revisions are received from the saved floor. An old queued-return proof fetches its exact immutable revision when it is not one of this operation's writes.

Previously recorded full-snapshot journal events remain readable and are not deleted. A retained floor is evidence of a completed receiving pass, not evidence that a token remains active and not permission to send. Current authority, current account state, quota and deadline checks remain mandatory.

## Public result provenance

A local decision carries storage_kind and storage_receipt. source_commit_sha/source_state_sha identify the retained Git origin only. Legacy current commit_sha/state_sha are null; they never contain fabricated local Git IDs.

Local accepted_write is:
{schema:'commons.gmail-account-local-write/v1',account_key,revision:<business revision>,content_sha256,storage_kind,storage_receipt,source_commit_sha,source_state_sha}.

inspectHistory remains synchronous and uses only original journal evidence. inspectConnectedMailboxHistory accepts the same options.storage selection and original events, without a provider call. Its recovered lease retains the original token, operation, attempt, binding and expiry. A later confirm still checks the actual current state.

## Queued-return recovery

A locally created queue generation cannot be proved by the historical Git snapshot. Preserve the returned storage_receipt and forward it as source_storage_receipt to receiveQueuedReturn, with the original operation_key, operation_lease, sequence, queued_at and recovery_sha256. source_commit_sha/source_state_sha still identify the adoption origin.

The helper receives the exact local history snapshot and verifies its immutable receipt and original queue generation. Receiving does not create a fresh waiting entry, grant a token or release another owner. Existing Git-only queued-return proofs remain readable.

## Legacy source

The historical Git read and journal paths remain available. New private Git branch/file mutations are explicitly disabled whether or not local storage is selected. A caller without the original local storage selection receives LOCAL_ACCOUNT_STORAGE_REQUIRED at mutation entry. There is no failure-driven fallback to a Git write.

The current mail policy, rolling usage, recipient accounting, lease/queue decisions, native Gmail classifiers and Gmail invocation path are unchanged. This module itself does not send mail.

## Verification status

The complete helper passes JavaScript grammar and synthetic in-isolate source checks for:
- acquire, exact debit confirmation, same-token recheck and release;
- separate business/storage revisions and retained Git provenance;
- post-commit lost return reconciled with identical arguments and no extra revision;
- competing handles retaining one active token under CAS;
- missing adoption, corrupted snapshots and wrong account authority;
- local queued-return receiving without changing original queue order or active owner;
- disabled private Git mutation and preserved synchronous historical inspection.

Forty-nine original policy, queue, classifier and Gmail functions were compared byte-for-byte and remain unchanged. This is source execution using synthetic data and injected in-memory storage. It is not filesystem durability, account adoption, live provider, send or rendered-product evidence. The paired SQLite coordinator and checkpoint/factory composition need their original complete integration receiving.

The pure export validateConnectedMailboxAccountState({account,content,sha256Utf8,classifyReturnedGmailRateLimit,classifyReturnedSendRateLimit?,storage?}) validates complete original account text through the unchanged business validators and returns its account/profile/revision/content SHA and a copied state. It performs no I/O and does not initialize, migrate or mutate an account.

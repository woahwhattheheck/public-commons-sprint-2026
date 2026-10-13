# Native original POST and separate SENT receiving

This public source continues the complete R103D consumer from private source commit bbcb451049ee8f469dcbe55a3f5f928d25cf6b3f. It is called by the existing dispatcher/source loader, in that dispatcher's original operation directory, after the original first provider return is retained. The same current queue service and account handle remain responsible for provider evidence and account settlement.

## Complete source

- connected_mailbox_sent_readback.cjs is the unchanged 8,135-byte bounded-memory consumer (SHA-256 b73fc6f090add9776ea4815b99a6ccb71a6fcc90ca54ad1fc2b44d458834419c).
- connected_mailbox_sent_binding.cjs contains the complete pure original POST/SENT/account/recipient validator and its three recipient helpers from admission Git blob 35e9245381e3f5255365d0f8864ac01598fc558f. It performs no I/O.
- connected_mailbox_sent_native.cjs joins those functions to durable complete receiving in the existing private native operation. It exports receiveRetainedMailboxSent and inspectRetainedMailboxSent.
- CONNECTED_MAILBOX_SENT_SOURCE.json pins every complete runtime body and its original source lineage.

The historical admission factory is deliberately not copied into this public runtime. Its retained implementation hardcodes a private Git state repository. Reusable code does not make private mailbox state suitable for a public repository. The current owner must supply the existing authorized account handle and its actual secure state adapter. This package creates no replacement account ledger, quota controller, sender, deployment or grant.

The original dispatcher remains the owner of beforeSend admission, exact serialized invocation charging, NOT_INVOKED reconciliation, unused charges, provider floors, rolling headroom and waiting order. A receiving completion grants no permission to send.

## Call from the existing native source loader

Load the three full CommonJS modules together from this host directory. There are no third-party dependencies; use the existing Node runtime on Windows or Linux.

~~~js
const {receiveRetainedMailboxSent} =
  require('/absolute/current/public-source/host/connected_mailbox_sent_native.cjs');

const result = await receiveRetainedMailboxSent({
  operationDirectory: originalDispatcherOperationDirectory,
  selection: originalRetainedSelection,
  account: currentConfiguredOriginalAccount,
  sendBinding: currentOriginalSendBinding,
  service: originalTrustedQueueService,
  admission: originalCurrentAccountHandle,
  record: originalDispatcherJournal
});
~~~

The operation directory must already exist. The helper creates only a private sent-readback child there. On POSIX this child and its events directory must be mode 0700; files are mode 0600. On Windows retain the current operator's existing private ACL custody. It neither changes the parent's permissions nor copies credentials.

account is the independently configured {id,email,link_id}; sendBinding is either gmail.users.messages.send or mcp__codex_apps__gmail_send_email, matching the actual original invocation. Do not derive the configured account from a recipient, current browser selection or a different mailbox. Keep the existing authority's original selected account.

service exposes the existing providerEvidence method from the queue producer PR1584/3e6dcdc387fa120c2a79e69dbc9451c3e8d93cbd. These are reads of already retained queue evidence. The helper does not perform a Gmail POST, GET, search or grant call. The queue's existing native SENT transport has already verified the full MIME tree, profile, recipient partition, RFC marker and subject before recording SENT_READBACK.

admission advertises sent_readback_identity: original_post_and_sent_v1 and provides observeSentReadback. If the first return is missing from the account journal, the unchanged consumer also invokes the existing observeNativeReturn or observe with the exact retained first returned wrapper. Existing authority CAS, receiveWrite and history reconciliation remain authoritative.

record is the original async durable dispatcher journal callback. The native join saves each complete evidence event before calling record with its compact relative file identity. It waits for that callback before another evidence page or account settlement. Include this relative receiving directory in the original operation's existing private archive/save lifecycle.

## The complete original selection

~~~js
{
  schema: 'commons.mailbox-sent-receiving-selection/v1',
  claim_id: originalQueueClaimId,
  provider_attempt_id: originalQueueAttemptId,
  revision_id: originalQueueRevisionId,
  account: { id: originalProfileId, email: originalMailbox, link_id: originalLink },
  charge: {
    args: exactOriginallyChargedInvocation,
    raw: exactFirstReturnedWrapper,
    observed_at: originalFirstReturnTimestamp,
    operation_key: originalAccountOperationKey,
    attempt_key: originalAccountAttemptKey,
    dispatch_token: originalChargedToken,
    source_account: originalConfiguredAccount,
    dispatch_envelope: exactOriginallyChargedAddressEnvelope,
    prepared_envelope: originalCompletePreparedQueueEnvelope
  }
}
~~~

The account operation/attempt hashes and queue claim/attempt/revision IDs are distinct. Preserve all of them. The invocation contains the actual serialized POST body. Preserve the actual original wrapper and its first timestamp; do not rebuild a POST observation from a later GET. Keep the complete MIME and attachments in the prepared envelope and serialized invocation.

The pure validator checks complete evidence digests, account and original To/Cc addresses/order/partition, original charge digest, exact POST response, separate GET URL and SENT/no-DRAFT labels, shared provider IDs, original RFC marker, full acceptance and observed chronology. The account authority then checks the actual charged row and performs its existing single settlement.

## Interruption and the original operation

The helper freezes selection.json on first receiving with create-only publication. A changed object, account, sender binding or first-return identity cannot replace it. On restart omit selection to read that same saved complete source:

~~~js
await receiveRetainedMailboxSent({
  operationDirectory: originalDispatcherOperationDirectory,
  account: currentConfiguredOriginalAccount,
  sendBinding: currentOriginalSendBinding,
  service: originalTrustedQueueService,
  admission: originalCurrentAccountHandle,
  record: originalDispatcherJournal
});
~~~

A process-lifetime local IPC lease excludes concurrent receiving of this same operation. Linux uses an abstract Unix socket and Windows an OS named pipe. Process loss releases that lease through the kernel. It does not replace the account authority's own cross-operation CAS or dispatch lease.

Each full journal event is written, fsynced and create-only linked before it is used. Its filename contains the sequence and complete file hash; each event binds the previous event, original selection and timestamp. Reopen verifies the complete chain one file at a time. Interrupted candidates do not become published events. A write/space failure removes that call's candidate and stops subsequent account actions.

A pending pass starts the queue evidence reader at the first page again. This is necessary because a new SENT digest may sort before an earlier final cursor. Each full page is retained before folding; only the matching POST and earliest matching SENT remain live across pages. No MIME truncation or partial evidence adoption occurs.

If the process disappears after a full successful account result was saved but before complete.json or the parent reply, reopening validates the same selected evidence and adopts that original result. It does not repeat a Gmail call or create a replacement debit. If the account changed but its return was lost before local recording, the unchanged consumer calls the original authority again with the same token and evidence; the authority's original CAS/replay contract owns that uncertainty.

An existing complete result is read alongside its complete journal and source. It is a historical receiving result, not a fresh account-capacity decision. The original controller must use its current ordinary admission path for future sends.

Pending statuses retain the original source and all complete pages. ORIGINAL_POST_ACCEPTANCE_PENDING, ORIGINAL_POST_EVIDENCE_PENDING and ORIGINAL_SENT_READBACK_PENDING continue the same queue attempt. AUTOMATION_ORIGINAL_CHARGE_NOT_CURRENT remains with the original account-history owner. Never fabricate a new charge to make a historical readback fit.

Read the saved operation without contacting the queue or account:

~~~js
const {inspectRetainedMailboxSent} =
  require('/absolute/current/public-source/host/connected_mailbox_sent_native.cjs');
const original = await inspectRetainedMailboxSent(originalDispatcherOperationDirectory);
~~~

## Native adoption in the original programme

The existing R103D / 450E / 9EEA / B41A source and dispatcher owners use the original repair thread C0BU51F1PL3/1791869245.994689 and dispatcher join 1791878626.279869. Return the actual currently adopted public source head, current secure authority adapter and loader identities there.

Run this receiving from one existing charged request with its full retained first return and queue evidence. Reopen that exact request, retain the full original source/journal/compact settlement, and confirm the account's original return hash and debit remain the same. A deliberately interrupted receiving resumes that same request; it never sends another message. Keep this in the original equipped programme, not a second controller or independent polling process.

Public publication contains generic source and source lineage only. Company selections, provider bodies, MIME, mailbox state, credentials and resulting journals remain in original secure custody. All current owner limits and provider deadlines continue to apply.

Before presenting any actual outgoing attachment or app, open and use the exact delivered version normally, view its screenshots and relevant pages, and operate its important controls. This source integration is internal infrastructure; it does not replace the existing rendered-product receiving of customer attachments.

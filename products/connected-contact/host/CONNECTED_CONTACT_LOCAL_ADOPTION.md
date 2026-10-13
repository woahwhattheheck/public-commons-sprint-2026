# Receive original connected-contact state into its selected coordinator

This helper prepares exact immutable Git readbacks and receives one frozen batch into the existing shared coordinator. It does not send mail, resume a contact, clear a queue, change a limit, create a Git ref, or initialize another coordinator.

## Original owner handoff

Use the original operator's private configuration: the existing absolute shared coordinator directory, coordinator UUID, whole fleet authority, original mailbox IDs and connected bindings. The account key remains SHA256(JSON.stringify({provider:'gmail',profile_id:<original string>,activity:'Mail sending'})). No default mailbox, directory, account or queued case is supplied by this source.

The original controller owners must hand off the selected state and writers before preparation. Record ownerHandoff.controllers_quiesced=true, recorded_at, recorded_by and reference to the actual handoff. This declaration is retained; the helper cannot prove that another machine has stopped. It reads each selected branch before the immutable source file and again at the end, rejecting a changed head. Keep those selected original writers stopped through receiving and the original owner's switch to the selected storage. Company-only receiving does not require stopping or reimporting unrelated fleet accounts; the existing coordinator remains authoritative.

## Explicit source inventory

Pass accounts with their complete original private account configuration and source {repository,branch,commit_sha,blob_sha,path}. Select only the complete original accounts explicitly assigned to this receiving owner, each authorized by the unchanged full fleet authority. For subsequent company-only receiving use accounts:[]; account adoption stays with its existing owner and no shared account is overwritten. Account branches are the existing mailbox-admission/v1/<account_key> in woahwhattheheck/commons-ship-enforcer, path state/gmail-account.json. The full original business state passes the unchanged admission validators.

Pass contacts with complete reviewedInput, recipient {repository,branch,commit_sha,blob_sha,path} and intent {repository,branch,ref_sha}. The original gateway derives the recipient path; the original intent module derives its branch. The helper does not derive another recipient, invent an intent or reserve one. Recipient claims must be the native woahwhattheheck/commons main source and intent references must be in that same repository. The local intent retains original_reference {repository,branch,ref_sha} matching its typed origin. Both source selections must already exist. Select each retained recipient claim once; list distinct existing intent/claim selections explicitly.

Pass checkpoints with the exact input_sha256 and original lease, plus optional matching operationKey and existing chunkCache. The original checkpoint preparer receives the complete metadata, all original payload chunks and the original location. The operation key is unchanged SHA256(JSON.stringify({input_sha256,lease})). The exact full payload stays inside the adopted checkpoint, including pending transport journals and outcomes. The helper also joins the checkpoint's returned original_location to the final branch-head recheck; a checkpoint change during preparation rejects the batch.

## Preparation API

```js
const prepared = await prepareConnectedContactAdoption({
  tools, storage,
  modules: {admission, gateway, intent, checkpoint},
  sha256Utf8,
  classifyReturnedGmailRateLimit,
  classifyReturnedSendRateLimit,
  operationId,
  accounts, contacts, checkpoints,
  ownerHandoff,
  observedAt,                 // retain the first preparation time
  githubRefAction: 'github_fetch_commit',
  record                     // original durable private journal callback
});
```

The bindings must be the actual original connected provider methods. A different allowed read binding may be selected before invocation; no failure-driven route switch occurs. Complete native structuredContent, exact immutable file bytes, Git blob SHA1, SHA256, branch observations and original receipt envelopes are retained. Source failures do not cause receiving or source reconstruction.

The returned commons.connected-contact-adoption-preparation/v1 envelope contains the complete request, account authority, source observations, original-owner handoff and both request/preparation hashes. Save this exact envelope privately before invoking receive. The supplied operator CLI writes mode 0600 files atomically and requires a mode 0700 private journal directory. The complete serialized preparation and request are bounded at 256 MiB. Runtime prepared files contain sensitive original account and contact records; do not put them in a public repository or public source carrier.

## Exact atomic receiving and replay

```js
const receipt = await receivePreparedConnectedContactAdoption({
  prepared, storage, record
});
```

Receiving uses only the saved envelope. It revalidates complete bytes and the same coordinator authority, journals the exact receiveBatch arguments before invoking, and retains the complete typed result. Every initial entry is create-only. The batch must contain at least one account, contact or checkpoint, but it need not contain an account. Whole-account cutover and later company-record receiving are distinct operations in the same coordinator; existing accounts are not reimported for each company. The original coordinator commits the selected account, recipient, intent and checkpoint entries in one SQLite transaction.

An uncertain receiving return is reconciled by calling the same function with the same saved prepared envelope, coordinator and operation ID. The backend returns the original batch receipt. Do not regenerate timestamps, reread source into a replacement envelope, choose a new operation ID, or create another coordinator to resolve an uncertain result. A changed payload under the same ID is a hard conflict. An entry already received by another batch remains a conflict requiring its original receipt.

Typed local receipts preserve original Git source identities and complete origins. Local storage revisions are separate from business revisions; they are never labeled new Git commits. The helper validates each returned original revision, content, receipt, operation identity and unchanged origin.

## Operator entry points

The complete product's connected_contact_operator.cjs exposes separate initialize, verify, prepare, receive and inspect commands. Initialize is an explicit original-operator action for the one selected coordinator; this adoption helper never calls it. Prepare and receive require the same private journal and exact request path. Inspect reads the original adopted checkpoint without resuming its pending contact.

After receiving, the original owner may reopen the same checkpoint through the maintained factory/queue controller with storage injected. Preserve the original lease, input hash, intent, recipient claim, deadlines, queue order and pending provider transports. A saved request or a successful adoption receipt is not authorization to replay Gmail.

## Verification boundary

The source is reviewed against the actual coordinator receiveBatch shape and the complete original checkpoint preparer. Focused source checks use synthetic immutable Git responses and an in-memory batch receiver; they exercise identity, complete bytes, changed-source rejection and same-request recovery without real provider calls. They do not claim a live migration, filesystem durability, mailbox send, or actual customer receiving. Those remain with the original operator and complete paired product.

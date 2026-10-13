# Original saved Gmail drafts in the connected-contact product

This joins the existing saved-draft receiver to the maintained product. The original Gmail draft remains the reviewed body of record. Ordinary contacts still use the same carrier constructor. No command here creates a draft, receives an account, or sends a message by itself.

## Complete source and constructor

The unmodified `host/connected_first_contact_draft.cjs` is the original 9,633-byte helper, SHA-256 `93598089ebe1920951e5566d99108ec4a31d4dbe15ac1e42f03270487124869d`, Git blob `a05c40e239d57651d178bfeef0ea985891f26aa3`. Its selected source is included in the whole product manifest.

The product loader uses that original helper when `options.input.native_draft` is present. It passes the unchanged carrier constructor into `createConnectedExistingFirstContactDraft`. The same factory is supplied to checkpoint open, retained-input validation, the original drain and the original operator. Each exact input constructs its own reviewed draft receiver. The verified factory wrapper is retained in the existing source-directory custody registry; repeated load of the same immutable edition returns that same factory identity.

Do not pass a bare `nativeDraft` option to the current checkpoint and assume it is forwarded. Its maintained factory-wrapper contract constructs the receiver at the actual inner factory boundary. All other factory exports remain available.

## Exact original input

Supply the original private runtime input without reconstructing it from a subject or a rendered email:
- `native_draft` has exactly `draft_id`, `message_id` and `thread_id`.
- `native_arguments` retains the original `link_id`, `from_address`, `to`, `subject` and complete MIME `payload`.
- `body` and `body_type` equal the first original complete MIME body. The alternative bodies stay in the original payload.
- `attachments` is an explicit complete manifest, including an empty array when there are none. Retain the original attachment bytes and item identities.
- Preserve the original opportunity/touchpoint fields, selected mailbox, lease and state key whenever already assigned.

The unchanged helper validates that envelope and its MIME source before creating the original carrier. Its receiver paginates the original native draft list, verifies the exact draft/message/thread revision, and then checks FULL and RAW reads as required by the retained MIME/attachment source. DRAFT must be present and SENT absent. Duplicate envelope headers, different bodies, changed attachments, or changed recipient/revision fail rather than silently revising the reviewed input.

The helper's `revise` method only accepts the same original draft, thread, mailbox and recipient. It does not publish an edit to Gmail.

## Existing checkpoint continuation

Receive the original checkpoint using the selected complete source and the original private configuration. Then:

```js
const product = loadConnectedContactProduct({configuration, tools});
const original = await product.readOriginal(operationKey);
const contact = await product.openOriginal(operationKey, {
  owner: originalOwner,
  githubRefAction: originalRefAction,
  beforeSend: originalBeforeSend
});
// Use only the exact action authorized for this original operation.
```

The existing original owner remains responsible for the unchanged full operation and the checkpoint's close/recovery path. Source loading and pure `plan()` are not mail sending. `receiveDraft()` performs original Gmail reads. `prepareDraft()` additionally prepares usage and may acquire/release the actual shared account reservation; it is an operational mutation, even though it does not send mail. Invoke it only through the existing checkpoint and original account owner. `run()` and sending continuations retain every existing review, relationship, account, lease, cadence and provider restriction.

The operator must retain primary action errors and checkpoint-close errors separately, along with the original complete snapshot and returned location. Reopen uncertain operations from their saved transports; do not repeat an unknown provider action.

## First intake without an earlier contact journal

An existing Gmail draft is not a historical first-contact checkpoint. The original constructor may create its first zero-event journal in the owner's private retained session when no journal already exists. That is a new local preparation of the existing draft, not evidence of an earlier account reservation, queue or dispatch.

The product exposes an explicit original read-only intake:

```js
const readback = await product.receiveOriginalDraft({
  runtimeInputText, lease, stateKey, load, store,
  githubActorAction: originalActorAction,
  githubRefAction: originalRefAction
});
// Save the complete readback privately. Then use exactly:
const originalJournals = [{
  runtimeInputText: readback.runtimeInputText,
  journalText: readback.journalText,
  stateKey: readback.stateKey,
  lease: readback.lease,
  source: originalCustody
}];
```

Here `load` and `store` are the original owner's synchronous private journal callbacks. They retain the original invoking and returned Gmail events as the read occurs, including any failure. The method constructs the unchanged draft-aware factory, invokes only its `receiveDraft()`, and returns the actual complete resulting journal and receipt. Its tool boundary permits only `gmail_list_drafts` and `gmail_read_email`; it neither calls `prepareDraft()` nor uses coordinator/account writes. A failed call leaves the original saved partial journal with the owner rather than replacing it with a successful receipt.

In an already-connected in-memory owner session, the same original factory wrapper can call `receiveDraft()` with that session's original tools and load/store. This is the historically supported receiver, not a new transport or sender. Keep all provider results in that original journal. The product method is the equivalent bounded entry on its actual equipped host.

Use the separately maintained original-session intake with a truthful session origin to receive that exact first journal into the existing fleet coordinator. Never invent a Git checkpoint or recipient/intent claim, and never re-import shared mailbox state with a company-only batch. Keep the original input/journal bytes and the original writer's handoff.

## Source review and receiving limits

The complete loader source checks cover the existing ordered mailbox/authority/cache invariants plus ordinary-constructor preservation, exact draft-helper routing, and repeated-load factory identity. A separate source-only exercise constructed three complete historically retained draft inputs with the actual current factory and unchanged draft helper. Their original reviewed input hashes and draft identities matched; all six retained attachments stayed selected. No provider callback, local coordinator write, `prepareDraft` or send was invoked.

This source evidence does not establish a deployed coordinator, tool bridge, live Gmail receiving, account capacity, or successful customer dispatch. Those outcomes need the original operator's actual receipts.

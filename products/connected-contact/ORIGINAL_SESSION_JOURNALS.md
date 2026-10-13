# Receive an original in-session contact journal

This is an explicit source intake for a complete original contact journal that never had a remote checkpoint. It belongs to the same connected-contact product, original contact operation and selected shared coordinator. It does not initialize an account, reset a queue, renew an old account lease or send a message.

## Required original source

Retain the complete original runtime input JSON text and the complete original `commons.connected-first-contact/v1` journal JSON text. The runtime input includes the original attachment bytes and manifests; the reviewed `journal.input` alone is not a replacement for that input. Keep the original state key and operation lease. Identify the actual private source reference, source custodian and capture time.

The source receipt is `original-session-journal-readback`. It contains the exact raw UTF-8 input and journal texts, their byte counts and SHA256 values, the operation identity and actual custody. It has no Git commit or blob claims. The first local checkpoint metadata is newly derived, revision 1 with no active checkpoint lease; all older account queue and provider deadlines remain unchanged inside the original journal.

## Pure preparation

Load the complete selected source through `loadConnectedContactProduct` using the original private mailbox configuration. The same loader supplies the original saved-draft wrapper when the runtime input contains `native_draft`.

```js
const entry = await product.checkpoint.prepareConnectedContactJournalAdoption({
  tools: originalConnectedTools,
  factory: product.factory,
  modules: product.modules,
  runtimeInputText: exactOriginalInputText,
  journalText: exactOriginalJournalText,
  stateKey: originalStateKey,
  lease: originalLease,
  source: {
    reference: actualPrivateSourceReference,
    custodian: originalSourceCustodian,
    observed_at: originalCaptureTime
  },
  observedAt: frozenPreparationTime
});
```

This function performs original input, attachment, journal and input-revision validation in memory. It blocks provider and live storage calls. It does not call the checkpoint's plan, checkpoint, close, prepareDraft or send methods. Freeze the complete returned entry and the complete batch preparation before receiving it; retry the same retained request after an uncertain return.

For the maintained batch preparer, put the same selection in `originalJournals` and use `accounts: []` when no shared account source is selected. Each original journal entry contains `runtimeInputText`, `journalText`, `stateKey`, `lease` and `source`. The preparer uses one frozen `observedAt` for the batch and retains the entire prepared envelope. The original writer handoff applies to the selected contact records, not unrelated mailbox controllers.

Use the existing operator's `prepare` and `receive` commands with the original private selection, request, result and receiving-journal paths. The live coordinator must already be the selected shared Linux/WSL coordinator. The receiver is create-only for these original checkpoints and binds the entire ordered batch to one operation ID. A changed batch is a different request, not a retry.

## Retained input revisions

Some complete original sessions already contain a reviewed draft/body revision after a definite Gmail quota rejection. Their journal retains `input_revisions`, `returned_mailbox_revision`, the original selected event and full closed provider calls.

The original factory's pure `validateOriginalJournalRevision()` method invokes its existing revision validator. It changes no journal or account state. A successful original session intake records the distinct `commons.contact-checkpoint-session-input-revision-source/v1` proof, bound to the exact original raw journal and input source. It does not fabricate a prior checkpoint.

Every cold reopen validates the original source hashes, the original revision proof and the complete retained event prefix. The original remote/local checkpoint `input_revision_source` path remains intact for later checkpoint-based revisions. Unresolved provider calls stay unresolved; receiving source does not classify an uncertain send as unsent or replay it.

## Read-only readback and continuation

After actual receiving, inspect the returned typed receipt and read the complete original checkpoint. Reopen through `product.openOriginal` with the same selected coordinator. For a read-only source inspection compare `snapshot()` and `location()`.

Checkpoint-wrapped `plan()` is asynchronous and performs checkpoint persistence and lease handling. Calling `close()` can also persist. Those are operational methods, not read-only source inspection. Use the pure input reviewer or a cloned bare factory for a source-only plan comparison.

The original controller owns account admission, current quota/deadline checks, full correspondence review and dispatch. A received journal does not itself authorize another send. Preserve any retained unknown provider result and continue only its original reconciliation method.

## Existing Gmail drafts

Use the complete unchanged original draft helper included in this product and the actual original owner's full runtime input. The draft selection binds draft ID, message ID, thread ID, exact native arguments, complete MIME bodies and attachment manifests.

An existing draft without a prior contact journal has a different source history from a session that already ran. Call `product.receiveOriginalDraft` with its exact input text, original state key/lease and original synchronous private load/store callbacks, as described in `ORIGINAL_SAVED_DRAFTS.md`. This invokes only the original draft/message reads and retains the first actual journal; use the returned raw input and journal texts for the explicit session batch. Do not invent historical events, an old queue or a remote checkpoint to use this intake.

## Verification scope

The full original module checks exercise exact source preparation, cold snapshot reopening, input/lease mismatch refusal and frozen request identity with zero provider/live state calls. The actual complete 1,039-event revised session was additionally prepared and cold reopened in explicit in-memory inspection storage with its original journal hash unchanged.

These are source/module checks. They do not establish native SQLite execution, an accepted shared host, operational source receiving or a sent contact. Those outcomes require the original operator's actual receipts.


## Receive an externally completed exact text contact

Use the original `receiveSent(messageId)` when a contact was completed through the connected mailbox before this original journal invoked a send. It receives the same selected mailbox, original input, state key and lease. It retains the native message and records the original completion; it never invokes Gmail sending or rewrites earlier journal events.

For an ordinary reviewed text contact without a fixed native envelope or attachments, the completed message may contain either the original renderer's exact single-part HTML or the exact reviewed single-part plain text. Plain text is compared byte-for-byte as returned in the complete native body: whitespace, line endings, Unicode, links and signatures are not normalized or inferred. Additional MIME parts, attachments, a changed subject or sender, extra recipients, duplicate envelope headers and DRAFT messages refuse. The receipt records the actual plain-text MIME type and body SHA256; it does not label plain text with an HTML hash.

Native-envelope input, saved drafts, attachment deliveries, delivery corrections and retained original send invocations keep their existing exact receiving contracts. Continue their matching reconciliation methods. A failed receiving attempt retains its original message selection; resume that same receiving method after the source update. An actual completed message must never be sent again because its earlier receiver could not read its format.

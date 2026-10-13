# Connected contact: shared local state

This is the maintained connected-first-contact controller, mailbox admission, checkpoint receiver, queue drain and complete source closure, with an explicit private filesystem storage boundary. It preserves the existing recipient and intent identity, original input and lease, mailbox usage limits, queued turns, returned provider deadlines, and original Gmail reconciliation. It does not create a second sender or CRM.

The reusable source is public. Mailbox configuration, prepared receiving requests, source responses, account state, contact text, attachments, journals and receipts remain private on the original operator's selected filesystem.

## Supported placement

The coordinator and its Node adapter support Linux. An existing WSL Linux environment is suitable only when the original Node controller and Python coordinator both run inside that same selected environment. Native Windows Node/Python is not supported. Do not remove the ownership, mode, regular-file, no-symlink or host checks to make a Windows path pass.

Select one original account-wide coordinator placement with the existing account/controller owners. Every process using a selected Gmail account must use that same coordinator identity and directory. A database per seat, a cloned database on another machine, or an independently initialized replacement does not preserve account admission. The database records its host, absolute directory, immutable coordinator UUID and account authority. It refuses an accidental clone at another placement.

Use a real directory on the private Linux filesystem, owned by the actual operator with mode 0700; configuration and private request/result files are mode 0600. Do not place the coordinator on a Windows-mounted filesystem that does not provide those actual Linux permissions. Python 3 with stdlib SQLite and the original existing Node runtime are required. No runtime installation, hosted state API, credential rotation or new provider account is part of this source.

## Complete source and private configuration

Keep every file listed in SOURCE_MANIFEST.json. connected_contact_product.cjs verifies complete source bytes before assembling the original factory and all original dependency modules. It returns the original methods, rather than emulating a provider tool.

Use one complete immutable source checkout per original controller process. The loader binds the real directory, complete manifest and exact loaded module objects. A changed manifest or an unverified module already in Node's cache requires a separate complete checkout or the retained original verified product; it never clears the live cache. Private configuration must retain the ordered, distinct business and secondary mailbox identities. The immutable coordinator authority may select a nonempty subset of those configured accounts; every selected profile and exact Gmail account key is checked before initialization. Company-only adoption with accounts:[] does not make the coordinator authority empty.

A private configuration file has schema commons.connected-contact-private-configuration/v1 and these required fields:

- directory: the original selected absolute Linux coordinator directory.
- coordinatorId: one retained UUID for this shared placement.
- authority: {scope_id, accounts:[{account_key,profile_id}]} for all accounts selected into this coordinator.
- mailboxes: exactly the original business and secondary entries in that order, each {name,link_id,id,email}.
- python: optional existing Python executable selection.

The account key is unchanged: SHA256(JSON.stringify({provider:'gmail',profile_id:<original string>,activity:'Mail sending'})). Preserve actual existing mailbox values in the private configuration. There are no working sample addresses, profile IDs or link IDs in this product and no fallback account. The original Gmail profile read must still agree.

PRIVATE_CONFIGURATION.template.json deliberately contains empty selections. It cannot initialize or select an account. Fill a separate private copy using the original operator's actual values; do not commit it.

## Explicit receiving, no contact dispatch

The executable source entry is connected_contact_operator.cjs. It supports initialize, verify, prepare, receive and inspect. None invokes Gmail sending, an original contact method, or the queue drain.

1. Coordinate the original writer handoff and freeze the exact original account, recipient, intent and checkpoint selections. Receiving state is a deliberate operation, not a failure-driven migration or a reset. Keep active owners, queued entries and deadlines intact. Unknown original send outcomes retain their original reconciliation path.
2. The original operator creates the private coordinator directory and receiving journal directory, each mode 0700, and private configuration/selection files mode 0600.
3. Explicitly initialize the selected shared coordinator:
   node connected_contact_operator.cjs initialize --config /absolute/private/config.json --result /absolute/private/initialize.json
4. Prepare the complete selected source through the already connected original operator:
   node connected_contact_operator.cjs prepare --config /absolute/private/config.json --operator /absolute/original/connected-operator.cjs --selection /absolute/private/selection.json --request /absolute/private/prepared.json --journal /absolute/private/receiving-journal
5. Receive that exact retained prepared record:
   node connected_contact_operator.cjs receive --config /absolute/private/config.json --request /absolute/private/prepared.json --result /absolute/private/received.json --journal /absolute/private/receiving-journal
6. Inspect an original case without invoking it:
   node connected_contact_operator.cjs inspect --config /absolute/private/config.json --operation ORIGINAL_OPERATION_KEY --result /absolute/private/inspection.json

The selected existing operator module exports its actual tools object. It is a reviewed source module from the existing logged-in controller, not JSON containing code or credentials. This product does not invent a connector endpoint or launch another logged-in account. For an embedded connected execution environment, call the same exported product/adoption APIs with its existing tools object instead of the CLI module boundary.

The selection file contains the complete explicit accounts, contacts, checkpoints, operation_id, ownerHandoff and retained observed_at used by the preparer. See host/CONNECTED_CONTACT_LOCAL_ADOPTION.md for the exact fields. Prepare uses immutable original Git commits and full provider readbacks; the checkpoint preparer verifies original chunks and keeps the exact pointer and joined payload bytes. The receiver never refetches or regenerates a timestamp. Save the full prepared envelope before receiving. Retry an uncertain receive with the same prepared file and operation ID.

The whole batch is one SQLite transaction. Reusing its ID with any different selected record, ordering or bytes is rejected. Its complete immutable result is reconstructed from the retained revision references on replay. An account missing from the local store is never synthesized from an empty model.

## Original controller and queue drain adoption

The existing controller integrates through:

    const {loadConnectedContactProduct} = require('/selected/source/connected_contact_product.cjs');
    const product = loadConnectedContactProduct({configuration: originalPrivateConfiguration, tools: originalTools});

For a selected original operation:

    const original = await product.openOriginal(operationKey, {
      owner: originalOwner,
      beforeSend: originalRelationshipReader,
      beforeNativeSend: originalExactPayloadGuard,
      organizationQuery: originalOrganizationQuery,
      organizationDomains: originalOrganizationDomains
    });

Opening does not run the contact. Keep the original controller's explicit selected method and its original business journal. A pending or unknown Gmail send is reconciled using the retained native message and account return; it is never replayed merely because a local completion is absent.

The original createNativeConnectedFirstContactDrain is available through product.createDrain(originalOptions). It now passes the same storage to mailbox admission, complete checkpoint read and original checkpoint open. Retain the original account, relationship callback, organization query callback, selected continuation, cancellation/shouldContinue, recording, snapshot and error handling. Constructing the drain does not run it. Only the already-authorized original controller calls its existing drain method. Do not create a scheduler, watcher or separate seat loop.

Current existing-draft consumers still supply their original reviewed draft adapter through the drain's drafts option. The factory retains its draft interface and exact original send binding. No ordinary source activation silently changes a draft, sender, input, attachments or original case.

Source selection remains the original createContactSourceActivation/receiveContactSourceSelection API. Supply the private mailboxes and same storage in its context. It checks complete capsule hashes and original plan/status/account-history compatibility before retaining a selected source. The generated public source capsule uses the actual published commit; historical private source capsules remain readable. No private source write is used.

## Storage and interrupted results

The SQLite database uses BEGIN IMMEDIATE, FULL synchronous commits, revision history, exact CAS and immutable operation receipts. Account storage revision and business state.revision are separate. Receipts are explicitly local typed receipts; historical Git origin is retained as origin, never presented as a newly written Git commit or blob.

A complete success response, including JSON escaping and retained origin, must fit 256 MiB before the transaction commits. The request has the same complete limit. Oversize writes roll back. History fetches one complete revision at a time and returns a bounded page plus an exact last-received cursor, so large revisions do not cause a hundred-body allocation.

The checkpoint journals a local state invocation before dispatch and its complete typed return afterward. After a lost local CAS return it receives only that exact idempotent state request, with its original operation ID/content/timestamp, before a later transform. The original nested account journal receives the returned snapshot. This storage recovery is distinct from Gmail dispatch: Gmail is never retried by the local-state receiving mechanism.

The coordinator's Python child is local state work only. Timeout means its result is unknown; retain the same original request rather than constructing another write. There is no fallback to private Git writes or a different account. Failures do not select a new directory, coordinator or account.

Historical special receiving modes retain their original source validators and explicit original proofs. A source migration does not turn an unreceived historical account/Gmail tail into a known result. Receive actual original evidence through its existing method; do not manufacture Git IDs from local hashes.

## Verification and actual receiving

The source was reviewed as a whole. Actual JavaScript execution in the isolated source runtime covers original admission CAS/queue decisions, unknown post-commit replay, stale heads and paginated history; the full checkpoint fixture covers preserved private-config plan, cold reopen, exact lost pointer replay and reconstruction into the same nested journal. Those fixtures use synthetic inputs and injected in-memory state. They make zero live provider calls.

Linux SQLite process durability, actual shared placement acceptance, private source adoption, the existing controller entrypoint and native queued-case continuation still require the original receiving operator. No such adoption or send is claimed by publication. The receiving owner should first receive the prepared batch, verify original account/history/queue/receipt identities, open an actual existing case, and continue only its existing selected step. Preserve all returned logs and private receipts in the original operation.

Before presenting any outgoing client-facing application, report or attachment from those cases, the producing owner must open the exact outgoing version, look at its actual render, operate its key controls at presentation and narrow widths where relevant, inspect applicable populated/empty/loading/error states, and open exports/reopen the delivered files. Source review does not replace that original product inspection. This internal coordinator introduces no new client-facing UI or approval queue.

## Licensing

The original maintained Commons source and this component retain the complete Apache-2.0 license in LICENSE and source provenance in SOURCE_MANIFEST.json. The surrounding public repository's license does not erase this component's retained upstream license.

## Reusable exact source capsule

After publication, the original source operator can run `node make_source_capsule.cjs ACTUAL_PUBLISHED_COMMIT OUTPUT.json` from this complete source directory. The builder verifies every manifest member, includes the manifest itself, calculates each actual Git blob identity, and emits the maintained `commons.connected-contact-required-source-closure.v1` format with its complete original loader. Its output is staged, fsynced and published without replacing an existing different capsule. Supply the resulting full packet's independently measured SHA-256 and byte length to the original source-activation API; the loader's own hash is also checked before evaluation. Use the actual merged source commit, never an operational-state commit or a guessed value. Building or reading this source capsule invokes no contact operation.

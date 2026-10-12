# Original Datasette operator request recovery

The current Datasette workspace retains the complete original action and native outcome for source selection, publication-plan creation, candidate review and buyer preparation. It uses the same workspace lease, original publisher SQLite database, existing source editions and original buyer engine.

## Submitting a selected action

Before the first request, choose one UUID with crypto.randomUUID() and preserve the entire operation/input pair. The following operations accept input.requestId:

- source.select
- publisher.plan
- publisher.review
- publisher.prepare-buyer

Keep every input field and its JSON order unchanged when continuing that request. The request digest uses the actual retained JSON serialization, so a reordered dataset-column declaration cannot silently reuse the result for a different native column order. A different action or input requires a new UUID.

The existing capture operationId, extraction runId, immutable edition id, publication reviewId and source/archive receiving identities remain in their original operations. The request identifier associates an operator action with its original result; it does not replace those source and runtime identities.

## Source selection and its observed identity

GET /api/status returns selection and selectionHash. selectionHash is null before the first saved choice; otherwise it is the native hash of that exact declaration. The browser reads the hash from the server. It does not reconstruct native canonical JSON.

Submit source.select with editionId, optional query, requestId and expectedSelectionHash copied from that status. The workspace reads and verifies the complete original edition, records the intended declaration and observed prior hash, and only then writes selected-source.json. It rechecks the selected identity at the actual write boundary.

A source request interrupted after the atomic selection write is completed from that same declaration on continuation. Before accepting another selection, the workspace settles an earlier accepted source-selection request using its original intended declaration. A later different choice is preserved: a stale request whose original prior identity no longer matches is recorded as rejected, and cannot overwrite that later source.

Legacy direct source.select calls remain available, and an explicit expectedSelectionHash is honored even without a request UUID. The complete operator uses both fields.

## Reading an original request

Dispatch requests.inspect with {requestId}. The response includes:

- schema stellar-forge.datasette-request.v1 and original workspaceId
- requestId, operation, complete input and requestHash
- state PENDING, COMPLETE or REJECTED
- createdAt and completedAt
- the exact original result for COMPLETE
- the native code/message/status for a definitive REJECTED result

The original HTTP protocol remains POST /api/operation with {operation,input}, preceded by the source-owned health/workspace identity binding. The typed client and Merchant provider use the same operation catalog.

requests.list accepts offset and limit (1–250), returns compact history without large result bodies, and provides complete pagination. requests.inspect and requests.list can read the retained outcome while another original native action is running.

If a request remains PENDING after connection loss, read it and continue the same exact operation/input. The HTTP client does not automatically issue another mutation. A COMPLETE result is returned from its original receipt, including after later source changes or reviews. A REJECTED request keeps its original error; correcting an input creates a new request.

A storage error while writing the final outer receipt leaves an accepted request resumable. It does not turn an already committed native review, plan, buyer file or source selection into a definitive rejection.

## Native plan, review and buyer receipts

Plan creation continues to use the publisher's existing source_plan_requests table and same transaction as PLAN_SAVED. The outer workspace retains the fully expanded native plan input before execution. Reopening an interrupted request therefore uses its original source hash, column order, native filters/sorts/ranges and extraction order, even if a later source edition is selected.

Candidate review records its request identity and complete original run result in source_action_requests inside the same SQLite transaction as CANDIDATE_REVIEWED. Replaying a review returns that exact review outcome, rather than identifying a later review by similar text. Native target snapshot/revision checks and original candidate validation remain in force before a first review.

Buyer preparation uses the existing buyerOffer and prepareDatasetBuyer functions. A request first retains the complete native buyer result and buyer.json in an atomic private directory below the original run. The original BUYER_HANDOFF_PREPARED event and native action receipt then commit in one SQLite transaction. If the process stops after the file directory is installed but before the database commit, continuation verifies and adopts that exact prepared file and result. It does not request a second offer or create another buyer configuration.

The native review/buyer additions are optional. Original callers that omit requestId continue their existing behavior.

## Closing and receiving

The current workspace's one active dispatch and serialized publisher queue remain authoritative. The accepted action is joined before its publisher is closed and the workspace lease is released. A request written before a shutdown remains available to the same original continuation.

Request records live in the original requests directory. Native action receipts live in the original publisher.sqlite, and request-bound buyer files live inside publisher/runs/RUN_ID/buyer-requests/REQUEST_ID. Include both new source helpers in the source-owned installed component:

- datasette/requests.mjs
- postgres/publisher/requests.mjs

The existing complete workspace inventory and archive retain these files and the original database. No new archive or receiving engine is introduced. Immutable request history keeps the sender's original input and result. When the same workspace is received at another directory, requests.inspect additionally exposes receiving.originDirectory and receiving.directory; use the original files.list/inspect/read authority to open current retained members. Request-bound native buyer receipt validation derives the corresponding file inside the receiving publisher and exposes originalPath when that exact byte-identical file has moved.

## One original receiving programme

Compose the helpers and narrow original-source hunks into the existing DSCEB3 publisher/operator programme. Use its approved 189-row WRI edition, original Stellar testnet payment tuple and complete dependency closure. Exercise source selection, native plan, candidate review and buyer preparation with retained UUIDs; lose one actual accepted response and reopen it through requests.inspect followed by the same original body. Then receive the complete workspace and read the retained history and exact buyer file. This is a continuation of SCF-DATASETTE-SOURCE-EDITIONS-07476-20261012.

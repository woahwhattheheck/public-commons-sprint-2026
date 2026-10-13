# Complete case migration receiving

## Select one real original operation

case_receiving.py runs the supplied original source → mapping → plan → rehearsal → review → cutover → report → customer continuation → return workflow. It uses the installed MigrationWorkspace and PortableService directly. It creates no subprocess, browser, remote connection or target-system write. It does not fabricate a customer record, target result, approved decision, policy or authority.

Prepare the whole input from the authorized existing source/owner operation. Keep external correspondence with that operation's contact owner.

Requirements are Python 3.10+, SQLite, an ordinary private writable filesystem, the complete selected application and actual source files. The original source workspace must exist and be closed by any other server/CLI holder. The runner exclusively holds its receiving operation and each opened original workspace.

Run:

    python3 case_receiving.py --input /absolute/actual-case-input.json --out /absolute/private/original-operation

Use the identical input and output directory for continuation. The input is frozen byte-for-byte before the original workspace opens. Any changed source selection, runtime, action or authority requires an explicit separately reviewed operation; it cannot masquerade as retry.

## Input contract

The full JSON input is bounded to 16 MiB. It contains:

- schema: commons.case-migration-receiving/v1.
- operation_id: a stable original ID, at most 80 characters, valid under the original identifier rules.
- authorization: the actual authority and original case/workstream reference.
- actor: the recorded actual operator.
- title: optional actual handover title.
- application: the exact ordered APPLICATION_FILES list, each entry with path, bytes and lowercase SHA-256 of the installed complete source. Include every one of the current 21 files.
- workspace: path, actual original project id and expected_revision. The revision is checked before the first original phase.
- source_files: complete selected original file receipts. Each entry has unique key, absolute path, filename, bytes and SHA-256.
- steps: the complete actual producer source/mapping/plan/rehearsal/review/cutover action sequence.
- customer_steps: the complete actual recipient continuation. Include the supplied corrected source/target or plan/rehearsal/decision actions necessary for the selected real review.
- comparison: before_id and after_id selecting two distinct actual rehearsal editions. Both may use the explicit accepted-result references described below.
- delivery_resume_reason: optional predeclared actual reason for continuing an incomplete original delivery. Absence leaves that continuation to the existing operator command.

Source/action fields are not guessed from filenames. Obtain each exact mutation body from the installed case schema and actual reviewed original records. Keep reasons, status maps, capture timestamps, windows, evidence and authority factual.

Each action object has unique key within its lane, unique operation_id across the whole programme (at most 100 characters), operation, optional actor, complete payload and optional predeclared resume_reason. Allowed business actions are source.import, case.dataset.create, case.plan.create, case.rehearsal.create, case.review.create, case.cutover.create and workspace.update.

The payload contains only original action fields. The runner saves operation_id, actor and the actual current expected_revision before executing that exact action. It rejects caller payloads that mix in those envelope fields. Original operation IDs cannot overlap the programme's stable delivery or continuation control IDs.

An explicit reference object is the entire object, not a string interpolation:

    {"$result":"producer:reviewed-source-import","pointer":"/id"}
    {"$result":"customer:corrected-rehearsal","pointer":"/id"}
    {"$file":"actual-target-export","field":"sha256"}

$result selects a previously accepted original action result by producer/customer lane and key. pointer is an RFC 6901 path into that whole result. $file selects the retained sha256, bytes or filename of an actual source_files member. Every other object/value is preserved recursively as supplied. A field not present in the original result is an error.

For source.import, retain the actual format/context/column mapping fields required by the original parser, plus file_sha256/bytes/filename references to the selected whole source. Dataset source_id references the accepted source.import result. Later plan/rehearsal/review/cutover payloads select exact original IDs in the same way. Retain the supplied people, lifecycle states and actual review decisions.

Before launching, construct application receipts from the installed files, in the exact order of migration_portable.APPLICATION_FILES. Store the complete actual input outside the output directory or under a separately retained original selection. The selected source files are copied create-only under the operation's inputs and verified by complete hash/length before staging into the original workspace.

## The ten complete phases

1. Original input: freeze exact application/runtime/input identities, actual project, and complete original source files.
2. Producer actions: execute or adopt the same reviewed original requests. Require an actual edition in all five case registers. Capture complete case descriptors, all projected/result rows, original events and operation records.
3. Complete reports: generate all original reports plus case-review, five descriptor inventories and all per-entity CSV/NDJSON.
4. Producer delivery: run the same original delivery.prepare, stream its full archive, independently inspect it and retain its exact complete identity.
5. Customer receive: restore that full original archive through the existing receiver into the chosen private customer directory.
6. Customer actions: prove all original case editions are retained, apply the supplied actual customer continuation, capture its full state and compare both selected rehearsal editions across every original identity.
7. Older receiving replay: close the selected recipient, re-receive the earlier original archive into that same destination and prove the later recipient project/operation history is unchanged.
8. Customer return: prepare and retain the complete actual customer delivery from the same project.
9. Return reopen: receive the customer archive independently, compare all case editions exactly and verify producer/customer original operation histories.
10. Original request replay: submit every original accepted request again with its original ID/body, require reused results and prove the current later project head did not change.

The source and recipient share the original logical project ID, as intended for a portable continuation. Their filesystem roots and kernel owners are distinct. Return receiving does not merge into or overwrite the original producer.

COMPLETE.json is published only after every phase and acknowledged workspace close. It binds the exact input, application/runtime selection, all ten ordered phase receipts, each accepted original action and the complete artifact inventory. The meaning field explicitly distinguishes this original-case workflow from a tenant write or buyer acceptance.

## Interruption and exact continuation

Keep the complete output tree after any error. Do not delete an original phase, request, accepted result, archive or source in order to force success.

Before each mutation, the runner saves its original request. A failed outcome is preserved separately under a content-hashed observation. Acceptance binds only the original SUCCEEDED operation and its complete stored result. Replays ignore a transport reused flag when selecting that stable acceptance.

The original customer baseline and each pre-delivery catalogue are frozen before the first selected mutation or delivery request; continuation verifies those immutable editions while preserving later legitimate additions. Every actual receive response is retained under its full content hash, and the original accepted response is reused after verifying the same archive/destination identity; transient reopened flags cannot overwrite that first observation.

A completed phase is adopted only after rehashing its whole retained artifact inventory. It returns its original observation, rather than recomputing a different receipt from a later legitimate customer edit. A completed whole operation additionally checks the ordered phase set, original request histories, exact immutable case records and current later project revisions before returning the retained completion.

An incomplete native request may require the original operation.resume control. If the actual reason was predeclared in the frozen input, the programme preserves one original control request before applying it. Otherwise stop the receiving process, use the original CLI resume against the same workspace with an actual reason and control operation ID, close it, then continue the identical receiving input. Do not edit a frozen input merely to add a reason, generate a new business ID, or treat a “not found” observation as proof that an earlier external caller cannot finish.

The store's acknowledged close retains its connection/lock owner until its close succeeds. The receiving runner keeps each partially constructed workspace registered before initialization. If closure remains unresolved, it does not publish COMPLETE or release the receiving lease early; process exit remains the final owner boundary.

The output parent must be private (no group/world permissions), and all selected source paths must be ordinary files/directories. Create-only publication preserves incomplete owned prefixes. Exact existing files require hash equality and parent synchronization. A mismatched existing final is not overwritten.

## Bounds, artifacts and practical reading

The complete input limit is 16 MiB; retained JSON receipt reads are bounded to 96 MiB. Full source objects, archives and per-record exports stream through their original file APIs. A case whose complete receipt population exceeds the documented bound must be deliberately partitioned at the input/case selection boundary before starting, not silently truncated during receiving.

The operation directory contains original-input.json, selection.json, original source copies, request/acceptance/observation files, ten phase receipts, full producer/customer/return case catalogues, complete reports, both complete delivery archives, inspections, the full corrected rehearsal comparison and COMPLETE.json.

Read reports/case-review.html under the actual selected revision directory. CSV and NDJSON retain all actual occurrences, including ambiguous/missing/unexpected records. Review/cutover evidence and decisions are full immutable descriptors. The complete ZIPs include original SQLite/object/application contents. Browser form drafts are separately exported by the browser working-file panel; a native SQLite archive does not claim to capture an unsubmitted browser form.

The actual run receipt identifies its selected original sources and outcome. Retain COMPLETE.json separately from source-review or packaging evidence.

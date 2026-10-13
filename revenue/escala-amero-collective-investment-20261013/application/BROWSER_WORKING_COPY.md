# Browser working-copy journal

This complete successor to web/journal.mjs preserves the existing durable request APIs. It adds browser handover without issuing any host or provider request.

## APIs

All functions are asynchronous.

- exportWorkingCopy(workspaceId) returns the complete portable envelope.
- inspectWorkingCopy(packet,workspaceId) validates all metadata, every request intent and complete original File. It returns schema, workspaceId, payloadSha256, view, requests, newRequests, preservedRequests, files, bytes and restores.
- restoreWorkingCopy(packet,workspaceId) validates the complete envelope again, then atomically merges missing requests, preserves each existing same-intent record unchanged, merges immutable recovery history, saves the prior current view and replaces the current view. It returns schema, workspaceId, payloadSha256, restoreId, addedRequests, preservedRequests, view and restores.
- listWorkingCopyRestores(workspaceId) returns saved prior-view receipts in newest-first order. Each contains id, workspaceId, restoredAt, sourcePayloadSha256 and previousView.

The host must request explicit confirmation before calling restoreWorkingCopy. It must preserve newly typed fields while asynchronously inspecting an input file. Calling inspect does not write.

Every newly imported request has needsExplicitRecovery:true outside its original hashed intent. Quiet/open/timer recovery must skip that flag. An explicit user recovery action may continue the exact retained request through the original host lookup and request journal. No journal handover helper sends a request or starts recovery; neither completed nor pending imports are automatically dispatched.

## Full portable representation

Schema amero.browser-working-copy.v1 contains payload and payloadSha256. The hash covers canonical, sorted JSON of the entire payload, including the selected workspace ID, export timestamp, full view, original requests, complete base64 file bytes and prior-view receipts.

Request metadata preserves optional undefined fields using a deterministic value/undefinedPaths representation, including old error observations that predate normalized optional fields. This avoids silently dropping original history during JSON serialization. Numbers in source response metadata preserve the existing browser representation; exact original source Files and native number-token receipts remain unchanged. Request arguments retain their original stricter canonical validation.

Each File includes its complete bytes and SHA-256 bound to the original request's source receipt. Imports reconstruct the retained Blob/File with its original MIME type, name and lastModified where supplied. There is no record or file truncation.

## Atomicity and recovery

IndexedDB version2 preserves the original requests and views stores and adds restores. An existing tab releases its connection on versionchange. All restore writes occur in one transaction after asynchronous full-file validation. A conflicting request or recovery ID aborts the transaction. Existing accepted results, attempt histories and later pending progress win over overlapping imported records; importing an older working copy never replaces those records.

The view intentionally changes only during the explicitly selected restore. Its immediately preceding complete value is retained in the independent restores store. Normal later saveView and markApplied calls do not erase that history. Later working-copy exports carry that full history too.

The native SQLite workspace handover remains separate. This browser file selects the exact original workspace and cannot be silently rebound to a received customer's new workspace ID. It includes private source data and should be handled like the original workspace.

## Validation status

The complete JavaScript source parses in the source-review runtime. Source-level codec checks cover exact optional metadata, original byte encoding, complete request identity, and atomic merge control flow. Actual browser IndexedDB, rendered controls and host receiving remain the existing original commissioning operation; source review is not a rendered customer result.

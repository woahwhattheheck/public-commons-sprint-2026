# Keep the sealed native return available through delivery

This keeper is for an already completed artifact: its absolute path, exact byte length and SHA256 select one immutable file. The producer finishes its native operation and closes its archive before calling the keeper. The existing Library upload helper still performs preparation, transfer, finalization and local metadata application.

A failed transfer leaves the producing process alive, holding the original archive. The same owner can retry that file, replay an observed finalization response through the original metadata step, or return exact byte ranges to the receiving session. No application command is part of this module.

## Integrate the existing producer

Include `hosted-artifact-retention.py` with the producer's complete source before native work. Import or compile that source before launching the application, so a missing keeper cannot first appear after the result is built. The maintained `hosted-original-owner.py` accepts it as a fifth hash-checked helper in the original private input.

For an ordinary Python import, load the module by its absolute source path. For an inline owner:

```python
namespace = {
    "__name__": "hosted_artifact_retention",
    "__file__": str(keeper_source_path),
}
exec(compile(keeper_source_bytes, str(keeper_source_path), "exec"), namespace)
saved = namespace["retain_artifact"](
    private_operation_directory,
    {"path": str(closed_archive), "bytes": archive_bytes, "sha256": archive_sha256},
    original_operation_id,
    existing_library_helper_directory,
    prepared_upload=original_prepared_upload_or_none,
    input_stream=sys.stdin,
    emit=lambda line: print(line, flush=True),
)
```

The module source at this checkpoint is 31,613 bytes, SHA256 `ea73242334dd408f1399a5090f32b3a761ff66196d62f8c9d4b711511fc869d1`, Git blob `4b6c4b4074e7d1219ee1a9a5f1d6d7a95856d273`. It uses only Python standard-library modules and the existing host helper directory containing `library_upload.py`, `library_file_transfer.py` and `library_hosted_apps.py`.

The original helper request is exactly:

```json
{"uploads":[{"local_path":"/absolute/private/closed-return.tar.gz","purpose":"create_library_file"}]}
```

Classification is optional. A supplied preparation's `library_artifact_type` is preserved, including its absence; the default generic keeper does not add a report classification. For a fresh preparation, the caller can pass `artifact_type="report"` or another classification accepted by the original helper. An explicit classification must match a supplied preparation. The maintained Research owner selects report; a pre-existing unclassified ZIP stays unclassified.

When no reservation is supplied, the normal helper prepares it after the artifact exists. A supplied preparation is the complete opaque original create-upload object; keep its transport fields private. An expired initial reservation that has never begun transfer or finalization is renewed through that same helper.

The call returns after the original helper reports one successful Library file and applies the local file metadata. The native operation's own success or failure stays in its original report; saving an attention result preserves that outcome.

## Same-owner controls

The keeper emits newline-delimited JSON. A status contains the artifact identity, original upload session, current stage, transfer/finalization observations, private diagnostic file identities and the same owner's retry-file path. Successful output includes the normal saved-file receipt. Signed transfer URLs, required headers and helper log contents remain private.

Send one JSON command per line over the already accepted native session. Batched lines are consumed in order. If its stdin closes, the keeper continues reading its original private `hosted-return-retention/retry-request.json`; publish that JSON atomically in the same visible namespace. Re-entering the module against the same surviving private directory acquires the original lock and reconciles the existing state.

Status:

```json
{"action":"status"}
```

An explicit retry selects the original artifact and the currently reported session:

```json
{
  "schema": "commons.hosted-artifact-retry/v1",
  "action": "retry",
  "operationId": "THE_ORIGINAL_OPERATION",
  "artifactSha256": "THE_ORIGINAL_ARTIFACT_SHA256",
  "retryId": "transfer-retry-01",
  "expectedUploadSessionId": "THE_CURRENT_REPORTED_SESSION",
  "mode": "same-session"
}
```

Use null for `expectedUploadSessionId` only when status reports no prepared session. Each retry identity is persisted before any provider call. Repeating the same ID and request returns current state without repeating the provider operation; changing the request under a consumed ID is rejected.

| Mode | Same original-file behavior |
| --- | --- |
| `same-session` | Uses the existing preparation. A completed transfer is reused. An observed finalization response is sent through the original local metadata application without another finalization call. |
| `retry-finalize` | Explicitly repeats finalization of the same session after a previously dispatched finalization has no usable response. The original transfer remains selected. |
| `refresh-unused` | Renews a reservation that has never started finalization. It can repair an expired or failed unfinalized transfer, while preserving all earlier attempt/session records. |

A finalization with no observed response keeps its session. Ordinary `same-session` retry cannot silently send that finalization again, and `refresh-unused` cannot replace it. First reconcile any already received provider response; an explicitly selected `retry-finalize` keeps the same upload identity.

For a host-provided fresh reservation, `refresh-unused` can include `preparedUpload` with the complete new opaque create-upload object. Its filename must match the sealed archive. The original helper validates the prepared transfer contract before use.

## Exact byte recovery

When a helper transport is unavailable, request bytes from the same sealed file:

```json
{
  "action": "read",
  "operationId": "THE_ORIGINAL_OPERATION",
  "artifactSha256": "THE_ORIGINAL_ARTIFACT_SHA256",
  "offset": 0,
  "maxBytes": 65536
}
```

The reply includes its exact offset, decoded byte count, chunk SHA256, base64 content and EOF flag. The maximum range is 262,144 bytes. Read the next range at the prior offset plus its returned byte count. Preserve the complete chunks in the receiving session, decode and join them in order, and verify the final byte length and SHA256 against the original sealed artifact. The keeper opens only that selected artifact for range reads; every reply verifies its complete identity and same-descriptor file stability.

The producer stays alive during this recovery. A successful ordinary retry remains available while the archive is being received. The byte response establishes source transport; durable destination publication is completed and read back through the selected destination's existing interface.

## Private state and actual transfer diagnostics

The original private operation contains `hosted-return-retention/state.json`, consumed `attempts/*.json`, complete `prepared/*.json`, and `helper-diagnostics/<attempt>/*`. Those files are private and outside the already sealed archive. The lock allows one keeper for that original file at a time.

The wrapper delegates transfer to the actual `SignedUrlUploader`. It records whether the original helper selected its hosted upload transport and which existing azcopy executable it observed. It preserves the actual helper's diagnostics before that helper's temporary directory is removed. A missing azcopy executable, an HTTP failure and a finalization failure therefore remain different observed stages. Diagnose the actual retained error before selecting a new attempt; the owner does not loop provider requests on a timer.

## Existing Research run and source lineage

The original Research operation is `SCF-RESEARCH-CLIENT-NCC-D9B53-20261012`. Its original local record is `afcbd27354ac49caef9d4bd81b64256b55bbbe1892b04dd08265929708ffba9d`, under `/dev/research-original-d9b53-20261012/records/`.

Its existing command 26032 used the 13,264-byte hosted owner with SHA256 `0507320ebf0fbba555f3dd18ba53ff8fbe008ff0fc54c75f13bd5b94d13c324a`, preserved at [PR2156 merge 0e0217f8](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/0e0217f8ab35062191c5bd67290f3f4c22d56a90/.swarm-delivery/d9b53-research-client-native/hosted-original-owner.py). The new retention source is a maintained continuation for sealed output and following use; it does not rewrite the actual run's provenance.

Recover an uncertain run through that original record and actual owner output. An initial `queued_disk` acknowledgement belongs to the original foreground handoff and does not establish a terminal application result. If its original archive is already present, select its observed byte/hash identity and use this keeper on that file. Preserve the current dossier and all original operation records when continuing the existing native controller.


## Reconcile a completed normal host upload

When the normal host upload of this same sealed path succeeds, send its complete
unchanged provider result to the existing keeper. The result must be a succeeded
`create_library_file` operation with the exact basename and byte length.
Select the original path and SHA256, the current prepared session, and one stable
reconciliation ID:

```json
{
  "schema": "commons.hosted-artifact-receipt/v1",
  "action": "reconcile",
  "operationId": "<the existing operation>",
  "artifactSha256": "<the sealed archive SHA256>",
  "sourcePath": "<the original absolute sealed path>",
  "expectedUploadSessionId": "<the keeper's current session, or null>",
  "reconciliationId": "normal-host-save-01",
  "providerResult": "<replace this placeholder with the complete actual result object>"
}
```

Retain the actual create result from the tool; do not turn a search/read response
or a manually written success flag into a create result. The caller's upload must
have selected the exact original path whose fingerprint is recorded by the keeper.

If the original prepared upload already started finalization, only a result for
that prepared file ID can reconcile it. If finalization never started, the
observed normal host upload may have a different file ID from the unused
preparation. The first observed successful file identity remains fixed.

The keeper writes the complete provider observation before applying local
metadata through the unchanged Library helper's result handler. This command
performs no prepare, byte transfer or finalize call. A repeated identical
reconciliation ID can finish interrupted local metadata; another payload under
that ID is rejected. A metadata failure keeps the file and original observation
available. Once a successful external receipt has been observed, provider retry
commands cannot prepare, transfer or finalize another file; repeat that exact
receipt reconciliation to finish local metadata. A fully applied receipt returns normally from the same keeper.

For a caller that already owns the original process and needs direct integration,
hold the same lock and initialize the existing state before calling
`Retention.reconcile_receipt(request)`. Do not run two keepers over the
same state directory. Keep an older keeper's accepted source as its run provenance
when upgrading the recovery caller.

The concrete receiving case for this path was a normal host upload of a sealed
2,018,725-byte archive after the original helper's block-list commit returned
HTTP502. The successful host result included `operation`, `status`, `file_id`,
`library_file_id`, `file_name`, `file_size_bytes`, version0 and the original
`xattrs` array. The failed preparation had not started finalization.

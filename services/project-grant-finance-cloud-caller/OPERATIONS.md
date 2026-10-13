# Use original commands and complete results

## Command identity and financial meaning

Submit one complete original command:

    {
      "id": "THE_ORIGINAL_CANONICAL_UUIDV4",
      "kind": "capture",
      "arguments": {
        "connection": "THE_ACTUAL_CONFIGURED_SOURCE_ALIAS",
        "profile": "THE_COMPLETE_ORIGINAL_CAPTURE_PROFILE_OBJECT"
      }
    }

The strings above explain the selections; use the complete actual native profile object, not those explanatory strings. The original command shape, required arguments and routes are in native-contract.json and the original service's docs/openapi.json.

A new intentional operation receives one new UUIDv4. Save it with all of its complete original arguments before dispatch. Reuse that same UUID and arguments after a timeout, flow restart, lost response or explicit interrupted-command continuation. The native canonical digest uses exact Decimal values, preserves native IDs and sorts object keys. The caller computes that same digest under a global 2 MiB UTF-8 budget before passing the original text through.

The caller's first read establishes whether the original command exists. Only the native ACTION_NOT_FOUND/404 response permits a new original submit. Other refusals or unknown transport outcomes do not imply absence. An existing command with a different digest is a conflict.

An existing QUEUED, RUNNING or terminal command is returned as it stands. An INTERRUPTED command resumes only when resume_interrupted is explicitly true and its actual provider retry time has elapsed. A completed native command is never silently restarted.

## Three selected flow roles

| Flow | Original kinds | Result |
| --- | --- | --- |
| Capture | capture | Immutable original Business Central source record |
| Prepare/review | mapping, reconcile, target-review, export | Original selected records and complete local handover |
| Delivery/recovery | deliver, recover, continue-delivery | Existing reviewed conditional target request and its original row states |

Each flow first checks the selected live workspace. It submits once with its automatic mutation retry disabled, retains the returned command ID, and polls that exact ID every ten seconds while it is running. The one-hour polling window can end while the native command is still active; the result directs the operator to read the same command. The original service keeps working.

A flow's wrapper COMPLETE is a computation result, not a claim that every delivery row was applied. Always inspect delivery_state and the complete native_json. AWAITING_OPERATOR preserves the original uncertainty, conflict or refusal. Use the original native operator to inspect the actual review, current row, observed result, request bytes and reviewer decision. Explicit acceptance of an observation remains in the original operator; the cloud caller does not expose accept-observation.

Before recover or continue-delivery, the caller reads the original target-delivery, binds its native connection and inspects all actual history Retry-After events using each event's own at timestamp. A PATCH429 can be retained there even when the wrapper is COMPLETE. Reads and later history updates do not move that original provider deadline. The original finance owner is composing the same floor into the local delivery path.

Business Central remains read-only. Dataverse delivery remains the original reviewed conditional write, with original ETags, metadata/actor checks and same-review ownership. The connector does not invent a grant allocation, exchange rate, currency meaning, pilot population, target field, current record or write approval.

## Native command/status receiving

Use the complete client to exercise the actual TLS caller while retaining every full response. The credential file is the private configuration's connection-credentials.json. The selected output directory is a private receiving directory for this exact command.

    python3 -B pmrs_cloud_client.py \
      --origin https://ACTUAL_CERTIFICATE_HOST:9443 \
      --credentials /ABSOLUTE/PRIVATE/caller-configuration/connection-credentials.json \
      --principal capture --group capture \
      --command-file /ABSOLUTE/PRIVATE/original-capture-command.json \
      --output /ABSOLUTE/PRIVATE/capture-receiving --wait-seconds 600

The client freezes original-command.json, records each transport attempt before dispatch, saves every complete response and verifies/saves the native_json bytes against native_sha256. Original states FAILED, CANCELLED or INTERRUPTED return exit code3 after saving their result. A provider/caller refusal returns2 with the saved response path.

After an unknown response, re-run the same command/output or read its exact original UUID. To resume an actual INTERRUPTED command, add --resume-interrupted to that same original command invocation after the provider deadline. No automatic recovery POST occurs during polling.

Read an existing command, record or delivery with a separate exact-view receiving directory:

    python3 -B pmrs_cloud_client.py \
      --origin https://ACTUAL_CERTIFICATE_HOST:9443 \
      --credentials /ABSOLUTE/PRIVATE/caller-configuration/connection-credentials.json \
      --principal prepare --resource record --identifier ORIGINAL_RECORD_SHA256 \
      --output /ABSOLUTE/PRIVATE/original-record-receiving

Use --ca-file only to select the actual institution CA bundle when it is not already trusted by the operating system. Certificate verification stays enabled.

## Full pages, reports and handovers

The connector exposes original record, totals, findings, ownership and delivery reads. ReadTotals and ReadFindings accept offset and limit1–100; the native response retains its original items and page metadata. Continue actual pages until the original page says there are no more. The native record view intentionally includes only the first25 reconciliation totals/findings, so do not treat that first view as the complete population.

Original downloads remain on the native operator:

- /api/files/record/RECORD_SHA/record.json
- /api/files/record/RECORD_SHA/report.html
- /api/files/record/RECORD_SHA/totals.csv
- /api/files/record/RECORD_SHA/rows.jsonl
- /api/files/export/ORIGINAL_EXPORT_UUID/pmrs-handover.zip

The original export command returns its actual download identity, byte count and hash. Use that exact route through the original authenticated operator and retain the complete archive. The cloud caller refuses oversized envelopes and points back to the paged view/full local file; it does not silently truncate a native response.

Reopen the complete handover through the original native service's receiving/import commands, preserving its actual workspace, record, action, delivery and source IDs. Join the received reconciliation edition to the original portfolio application using its maintained financial view. This caller creates no second financial database or portfolio writer.

## Credentials and lifecycle

All three principals can read this selected original finance workspace; write kinds differ by role. Select the corresponding operator permissions and connection usage in Power Platform. Disable a principal in the private caller.json to revoke it on the next request. Changing the workspace/listener/certificate paths requires a normal caller restart; it cannot retarget an already running process.

The caller's private entry and credential files are outside source and handover archives. Retain them only in the institution's normal private configuration and backup. The complete application/source handover contains code and selected public contracts, not these live secrets.

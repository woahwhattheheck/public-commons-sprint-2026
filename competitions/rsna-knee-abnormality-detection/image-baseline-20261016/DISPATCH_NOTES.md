# Private Kaggle dispatch notes

## Effect boundary

This directory contains reusable public source and a prepared request, not a Kaggle execution or competition submission. It contains no credentials, medical data, study/patient identifiers, external weights, trained checkpoint, score, or customer material.

## Authorized target

- Account: tokenjunkielabs (provider user 36520554)
- Competition: rsna-knee-abnormality-detection (provider competition 154281)
- Kernel slug: tokenjunkielabs/rsna-knee-image-baseline-train-v1
- Route: POST /api/v1/kernels/push
- Runtime: private notebook, T4 GPU, Internet disabled, 32,400-second session
- Current provider evidence at preparation time: rules accepted; five submissions allowed now; no owned competition kernel or submission recovered.

## Dispatcher procedure

1. Refresh the authenticated account, competition entry, owned kernels, and submission allowance immediately before the write.
2. Read KAGGLE_SAVE_REQUEST.json and send its parsed JSON body once to the existing Kaggle REST session. Do not substitute MCP save_notebook: its current source-binding path may omit competition mounts.
3. Receive and preserve the provider operation/request ID and returned kernel ID/version.
4. Read back the created kernel metadata before any retry. Confirm private visibility, Internet off, T4 GPU, the exact competition source, SaveAndRunAll, and session status.
5. After completion, inspect only aggregate outputs: run_manifest.json, selected_model.json, KAGGLE_TRAINING_RECEIPT.json, logs, and checkpoint hashes. Do not post medical identifiers.
6. A successful training run is not permission to submit. The original entrant dispatcher separately validates the inference notebook, selected checkpoint binding, submission CSV, live limits, and organizer requirements.

If the first provider response is ambiguous, reconcile by slug and returned version before retrying. If the official mount is absent or duplicated, the notebook fails closed.

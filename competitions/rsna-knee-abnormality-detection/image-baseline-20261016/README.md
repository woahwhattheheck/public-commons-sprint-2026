# RSNA Knee 2026 image-only baseline

This is the reusable, competition-data-only source package for operation ROOT-RSNA-EXISTING-MODEL-RUNNER-20261015-01.

It includes strict official-data ingestion, study-grouped folds, masked 12-label training, a hierarchical image MIL model, held-out evaluation, checkpoint integrity receipts, offline inference, and a private Kaggle training notebook. It does not include MRI data, identifiers, credentials, external weights, trained checkpoints, scores, submissions, or customer/commercial context.

## Artifacts

- rsna_offline_training.ipynb — self-contained private T4 runner; embeds the reviewed training modules and fails closed on mount/runtime/integrity mismatches.
- KAGGLE_SAVE_REQUEST.json — exact prepared direct-REST request body. It is inert until an authorized dispatcher sends it.
- train_rsna.py, rsna_data.py, rsna_image_model.py, rsna_metrics.py — training implementation.
- rsna_offline_inference.ipynb, rsna_infer.py — checkpoint-bound offline inference path.
- DATA_CONTRACT.md, INFERENCE_RECEIVING.md — data and receiving contracts.
- PUBLICATION_MANIFEST.json — content hashes for the published package.

## Execution boundary

The training process has a 28,800-second runtime budget plus a 1,800-second validation reserve inside a 32,400-second Kaggle session. It trains from random initialization with Internet disabled. The notebook verifies that the official competition mount is unique, CUDA and DICOM decoding are available, embedded source hashes match, and the selected checkpoint agrees with the completed run manifest.

No Kaggle execution or competition submission is performed by publishing this directory.

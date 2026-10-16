# RSNA official-data image pipeline

`rsna_data.py` is executable source for authorized competition compute, not a trained model or a scored entry. It makes no network calls and writes no medical data. No actual MRI was downloaded, opened or decoded while preparing this source.

## Public source contract

The [official dataset description](https://www.kaggle.com/competitions/rsna-knee-abnormality-detection/data?select=sample_submission.csv), recovered from the indexed official page on 2026-10-16, defines study-level prediction. `train.csv` has `StudyInstanceUID`, `Report`, and twelve binary targets; only a small subset is labeled. Test reports are unavailable. Series descriptors provide `StudyInstanceUID`, `SeriesInstanceUID`, `Anatomical_Plane`, `Fluid_Sensitive` and `Fat_Suppression`. DICOM layout is `<split>_series/<StudyInstanceUID>/<SeriesInstanceUID>/<SOPInstanceUID>.dcm`, one slice per file. Planes are Sagittal, Coronal and Axial. Mixed transfer syntaxes include JPEG Lossless and JPEG 2000. Visible test files are examples replaced during scoring.

The [official evaluation](https://www.kaggle.com/competitions/rsna-knee-abnormality-detection/overview/evaluation) specifies the arithmetic mean of twelve ROC AUCs. Exact target order:

```text
ACL,MCL,Medial Meniscus,Lateral Meniscus,Medial OA,Lateral OA,PF OA,Effusion,Synovitis,Baker's,Contusion,Fracture
```

The [official timeline/code requirements](https://www.kaggle.com/competitions/rsna-knee-abnormality-detection/overview/timeline) retains offline notebook execution and a nine-hour limit. The dynamic Rules page returned no readable body here; this document does not certify all legal clauses or external-weight eligibility. This data module requires no external weights.

## Implementation and integration

```python
from rsna_data import (
    read_studies, assign_grouped_folds, RSNAStudyDataset,
    collate_studies, training_class_weights, aggregate_summary,
)

# Run only where the official medical dataset is already authorized.
studies = read_studies(data_root, split="train", patient_groups=patient_mapping)
folds = assign_grouped_folds(studies, n_folds=5, seed=2026)
train_rows = [s for s in studies if folds[s.study_uid] != validation_fold]
val_rows = [s for s in studies if folds[s.study_uid] == validation_fold]
positive_weights = training_class_weights(train_rows)
train_data = RSNAStudyDataset(data_root, train_rows, training=True)
val_data = RSNAStudyDataset(data_root, val_rows, training=False)
# torch DataLoader(..., collate_fn=collate_studies)
# Persist train_data.data_config with weights on authorized compute.
```

`patient_mapping` is either `None` or a complete, authorized map of study UID to stable patient key. The published schema does not promise a patient identifier. Without this map, grouping is explicitly study-only. Use `require_patient_groups=True` to refuse study-only splitting. Never describe that fallback as verified patient independence. Group folds balance official positive/negative counts separately, never split a patient's studies, and are stable under row reorder. Weak labels do not influence fold assignment. Labels with insufficient gold class support remain unscoreable; no replacement AUC is invented.

`read_studies` preserves input study order and exact identifiers. It rejects duplicate/missing keys, malformed labels, unknown planes, orphan series and missing series directories. Report text is discarded before creating model records. Missing labels use value zero with mask false and weight zero, not negative supervision. Optional `weak_labels` is numeric-only, training-only `uid -> label -> (probability, confidence)`, produced and retained on authorized compute. Official labels override weak labels. Validate against `gold_mask`; a weak-label metric is a different result. Entirely unlabeled studies remain present but cannot contribute supervised BCE without an approved weak/pseudo target or a separate self-supervised objective. Retaining them is not evidence of using them for learning.

The preprocessing implementation orders slices by physical coordinates, with unique `InstanceNumber` fallback. If neither is available it fails instead of treating filename order as anatomy. It checks DICOM study/series identity, decodes selected slices, applies rescale parameters, masks padding, normalizes within-series percentiles, inverts MONOCHROME1 and uses aspect-preserving resize/padding. It does not guess laterality, crop lesions or apply cross-plane flips. These are baseline design choices, not evidence they are optimal.

Defaults use all series and 16 stratified slices per series at 320 square pixels. Training uses seed/epoch-specific within-bin jitter; evaluation uses bin centers. Set the epoch before constructing each epoch's iterator and avoid persistent worker copies unless epoch state is synchronized. Any `max_series` cap is an explicit compute ablation and must be disclosed. Sampling sixteen slices does not mean decoding every slice.

| Batch key | Shape / meaning |
| --- | --- |
| `images` | `[B,S,D,1,H,W]`, float32, range 0–1 |
| `slice_mask` | `[B,S,D]`, true only at decoded slices |
| `series_mask` | `[B,S]`, true only at existing acquisitions |
| `metadata` | `[B,S,5]`: Sagittal/Coronal/Axial one-hot, fluid-sensitive, fat-suppressed |
| `targets`, `target_mask`, `target_weight`, `gold_mask` | `[B,12]`, exact target order |
| `study_ids` | Private in-memory official keys, needed for output alignment |

No zero-image recovery is used for missing/corrupt studies. Zero padding only represents absent bag positions and has corresponding masks. Aggregate summaries contain counts, not identifiers. Do not publish batches, folds, reports, DICOM headers or raw exceptions from other loaders.

Required runtime packages are NumPy, Pillow, PyTorch, pydicom and installed decoders suitable for all observed transfer syntaxes, such as pylibjpeg with libjpeg/openjpeg plugins. Packages must be supplied before offline evaluation. The preparation host had NumPy/Pillow but not PyTorch/pydicom. Only syntax/import and a small fabricated in-memory grouping/class-weight check ran; it produced no image result or performance metric. Actual DICOM decoding, GPU memory, throughput and end-to-end coverage remain to be measured on the authorized worker.

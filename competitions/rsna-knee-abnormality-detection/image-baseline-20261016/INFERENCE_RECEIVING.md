# Offline inference receiving guide

Operation: `ROOT-RSNA-EXISTING-MODEL-RUNNER-20261015-01`.

## Actual status

This is complete inference source for the companion competition-data-only image
model, not a trained model or a scored entry. The latest retained account receipt
confirms rules acceptance on 2026-10-14 for tokenjunkielabs/user36520554,
competition 154281. No owned notebook/version, trained weights, data cache, full
run, submission or score was recovered in this source lane. AccountChad retains
all account effects; this package does not create, save, run or submit a notebook.

## Contract

Output `/kaggle/working/submission.csv` has these exact columns in order:

```text
StudyInstanceUID,ACL,MCL,Medial Meniscus,Lateral Meniscus,Medial OA,Lateral OA,PF OA,Effusion,Synovitis,Baker's,Contusion,Fracture
```

The official competition `test.csv` supplies every identifier and row order. No
training IDs, sample-submission placeholders or hardcoded test IDs are accepted.
One finite probability in [0,1] is required for each target; no clipping,
constant-score fallback, skipped study or truncated submission is permitted.
The metric is the macro mean of twelve ROC AUCs. Inference is image-only.

## Assets and eligibility decision

This candidate excludes external data, pretrained weights, OAI-derived weights,
and hosted LLM/API calls. Its checkpoint must assert competition-only,
training-only provenance and positive optimizer steps, and must match a selected
SHA-256. An eligibility declaration is not independently verified provenance;
the training receiver must retain the actual source/data/training receipt.

The official overview permits freely/publicly available external data including
pretrained models, but current OAI access and external-tool discussion does not
establish eligibility for any particular outside artifact. No outside model is
admitted based merely on a public notebook or its reported score. General source
code/library use is distinct from transmitting competition data to an API.

Official sources retrieved 2026-10-16:

- https://www.kaggle.com/competitions/rsna-knee-abnormality-detection/overview/timeline
- https://www.kaggle.com/competitions/rsna-knee-abnormality-detection/overview/efficiency-prize-evaluation
- https://www.kaggle.com/competitions/rsna-knee-abnormality-detection/rules
- https://www.kaggle.com/competitions/rsna-knee-abnormality-detection/discussion/749145
- https://www.kaggle.com/competitions/rsna-knee-abnormality-detection/discussion/733965

The dynamic rules page returned no readable body. Indexed official overview
text confirmed CPU/GPU notebooks <=9h, Internet disabled and exact schema/metric.
Specific outside eligibility is unresolved, so none is used.

## Existing operator's next action

1. Recover the current owned notebook/version and source/model history before
   making any account change. Preserve the existing entrant/team and candidates.
2. Train the companion image model on authorized official training data, with
   the grouped evaluation course; select by honest held-out twelve-target AUC,
   not a fabricated score. Retain its checkpoint hash and preprocessing config.
3. Attach this complete source directory, that selected checkpoint and official
   competition dataset to the existing inference notebook. Supply the exact
   `SOURCE_DIR`, `CHECKPOINT` and `CHECKPOINT_SHA256` in the configuration cell.
4. Keep Internet **Off**. Use the profiled GPU/CPU. Verify decoder support on
   every observed transfer syntax before a counted run. If libraries are absent,
   attach a compatible, preverified wheelhouse. The optional pip operation uses
   `--no-index`; no runtime download is permitted. Runtime dependencies are
   torch, numpy, Pillow and pydicom>=3 plus compressed-DICOM decoder plugins.
5. Run the entire notebook once at the existing operator's authorized boundary.
   Its timer starts in the first code cell, before setup. It streams every test
   study; partial failure never creates a final `submission.csv`. The private
   partial is retained for diagnosis; do not submit it.
6. Inspect the complete execution receipt, output shape/ID coverage and actual
   Kaggle elapsed time, then let AccountChad select/submit that existing version.
   Return actual notebook/version, accelerator/runtime, checkpoint hash and
   provider submission ID. Source workers do not perform those effects.

## Runtime estimate and limits

There is no measured MRI/GPU runtime in this source environment. A numeric
whole-test estimate would be invented. The runner measures preprocessing,
decoding, model execution and output time together. After 16 studies it projects
remaining time using max(observed mean, observed per-batch p95), times a 1.5
safety factor, plus 180 seconds reserve. It recomputes the projection thereafter
and fails early if it reaches 32,400 seconds. Different study sizes, codecs,
series counts and hardware can invalidate a pilot projection; only completed
Kaggle readback proves the actual nine-hour execution. There is no hidden
test-size assumption or silent reduction in preprocessing to meet a budget.

Fresh source may require more training, scientific improvement and runtime
optimization. This package alone does not establish competitiveness, a winning
model, a valid scored submission or clinical utility.

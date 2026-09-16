# ProofLine — evidence-bound OpenCV inspection

ProofLine is a source-first OpenCV 5 visual-inspection system for manufacturing and field QA. It aligns a new inspection frame against a known reference, measures localized visual changes, binds them to deterministic evidence receipts, and produces **human review proposals** that cannot approve/reject product or mutate production.

The AWS path is part of the product contract: versioned S3 object events drive a Lambda/OpenCV worker; DynamoDB stores evidence/proposal packets using a conditional idempotency key.

## Quick development demo

Production is intentionally strict about OpenCV 5.x. This repository's execution environment may still have OpenCV 4.x, so tests and the local compatibility demo explicitly opt into a development-only compatibility switch.

```bash
python -m unittest discover -s proofline-opencv/tests -v
python -m compileall -q proofline-opencv/proofline proofline-opencv/tests
```

With PNG files:

```bash
PYTHONPATH=proofline-opencv python -m proofline.cli inspect \
  --reference reference.png --inspection inspection.png \
  --output evidence.json --allow-opencv4-dev
PYTHONPATH=proofline-opencv python -m proofline.cli propose \
  --evidence evidence.json --output proposal.json
PYTHONPATH=proofline-opencv python -m proofline.cli verify \
  --evidence evidence.json --proposal proposal.json
```

On the competition runtime, omit `--allow-opencv4-dev`; anything below OpenCV 5 fails closed.

## What OpenCV actually does

This is not an LLM wrapper around a screenshot. `proofline.vision` uses OpenCV for:

- image decoding and color-space conversion;
- ECC affine registration and warping;
- absolute image differencing and Gaussian denoising;
- Otsu + configured minimum thresholding;
- morphology;
- connected-component extraction and geometric region measurement;
- deterministic PNG encoding for evidence-crop and segmentation-mask digests.

The resulting packet binds both input hashes, registration, segmentation mask, every region, OpenCV version, and pipeline generation.

## Agent boundary

`build_review_proposal` can rank visual changes for human review. Its receipt-bound authority map hard-falses product approval/rejection, production mutation, vendor contact, payment/purchase, and external sends. An evidence or authority mutation invalidates verification.

## AWS

`infra/template.yaml` defines a versioned inspection S3 bucket, Lambda worker, encrypted/PITR DynamoDB evidence table, and least-privilege read/write policies. Duplicate S3 delivery is rejected at ledger insertion using a pipeline-bound event key.

See `docs/ARCHITECTURE.md`, `docs/DEMO_SCRIPT.md`, and `docs/COMPETITION.md`.

## Truth state

This carrier can establish **source/test/demo readiness**. It does not by itself establish a live AWS deployment, competition submission, judging result, prize, payment, or revenue.

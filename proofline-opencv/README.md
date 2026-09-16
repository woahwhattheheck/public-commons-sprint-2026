# ProofLine — evidence-bound OpenCV inspection

ProofLine is a source-first OpenCV 5 visual-inspection system for manufacturing and field QA. It aligns a new inspection frame against a known reference, measures localized visual changes, binds them to deterministic evidence receipts, and produces **human review proposals** that cannot approve/reject product or mutate production.

The AWS path is part of the product contract: versioned S3 object events drive a Lambda/OpenCV worker; the configured reference is pinned to an explicit S3 version; and DynamoDB stores evidence/proposal packets under an idempotency identity that binds both inspection and reference generations.

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

The resulting packet binds both input hashes, registration, segmentation mask, every region, OpenCV version, and pipeline generation. AWS-produced evidence additionally receipt-binds the exact S3 bucket/key/version identity of both the reference and inspection object.

## Agent boundary

`build_review_proposal` can rank visual changes for human review. Its receipt-bound authority map hard-falses product approval/rejection, production mutation, vendor contact, payment/purchase, and external sends. `verify_review_proposal` deterministically recomputes the complete proposal from verified evidence and compares canonical JSON bytes; omitted regions, rewritten priorities/measurements, type aliases, extra fields, or authority edits therefore fail even if a caller recomputes the public integrity digest.

## AWS

`infra/template.yaml` defines a versioned inspection S3 bucket, Lambda worker, encrypted/PITR DynamoDB evidence table, a required `ReferenceVersionId`, S3 read policies, and DynamoDB permissions limited to `GetItem`/`PutItem`. Duplicate delivery first reads the exact bound ledger key; an already-recorded event returns the stored evidence/proposal receipts without refetching or recomputing. A reference-version rotation produces a different event identity and evidence source binding rather than silently reusing the old key.

See `docs/ARCHITECTURE.md`, `docs/DEMO_SCRIPT.md`, and `docs/COMPETITION.md`.

## Commercial pilot pack

`commercial/` converts this source/test/demo carrier into a buyer-evaluable fixed-scope pilot without widening authority. It includes a fail-closed packet compiler, scenario-only ROI worksheet, evidence-linked acceptance criteria, delivery and security runbooks, a clearly synthetic case study, and a first-party-evidence-backed target-account research set.

```bash
PYTHONPATH=proofline-opencv python -m proofline.commercial compile \
  proofline-opencv/commercial/sample_intake.json /tmp/proofline-pilot.json
PYTHONPATH=proofline-opencv python -m proofline.commercial verify \
  /tmp/proofline-pilot.json
```

The sample price is `PROPOSED_NOT_ACCEPTED`; the compiler contains no payment link and rejects positive customer-result, accepted-price, observed-savings, live-deployment, revenue, or outbound claims. Any prospect contact remains a separate owner + Muse single-writer action.

## Truth state

This carrier can establish **source/test/demo readiness**. It does not by itself establish a live AWS deployment, competition submission, judging result, prize, payment, customer acceptance, observed savings, or revenue.

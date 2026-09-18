# VisualLedger — evidence-bound finance-document audit agent

VisualLedger is an OpenCV-first finance-document intake agent for the **OpenCV AI Competition 2026, powered by AWS**. It turns visual measurements into a bounded next action instead of treating computer vision as decorative preprocessing.

The competition's published final-submission requirements call for substantive OpenCV 5 vision plus a meaningful AWS component. For the Agentic Vision path, visual output must change a later plan/tool/action/human-approval step. VisualLedger does exactly that: OpenCV measurements route each document to recapture, human crop, duplicate review, or downstream field extraction + human verification.

## What OpenCV does

`visualledger.vision` performs:

- bounded image decoding and color conversion;
- Canny/morphology/contour document-boundary detection;
- quadrilateral approximation and perspective normalization;
- Laplacian blur measurement;
- contrast and glare measurement;
- edge density and Hough-line document-structure measurement;
- deterministic PNG normalization digest;
- OpenCV resize-based 64-bit dHash for near-duplicate evidence comparison.

This is substantive image analysis. The resulting measurements directly determine the next workflow action.

## Agentic routing

- `REQUEST_RECAPTURE`: capture quality is poor (blur/glare/contrast/edge failure).
- `REQUEST_HUMAN_CROP`: the document boundary is missing/ambiguous, multiple documents are present, or structure is too sparse.
- `QUARANTINE_DUPLICATE_REVIEW`: exact/near-duplicate visual evidence is detected.
- `REQUEST_FIELD_EXTRACTION`: a single sufficiently legible document is ready for a downstream extraction tool and human verification.

Every route still requires human review. VisualLedger **cannot** approve/reject an expense or invoice, post accounting, pay/move funds, contact an external party, or make tax/legal/revenue claims.

## Runtime truth

Competition mode fails closed below OpenCV 5.x. Development hosts may opt into `--allow-opencv4-dev`; every resulting trace records that the runtime is not competition-compatible. The source was developed on OpenCV 4.13 because that is what the current free local runner provides. A future real 5.x execution receipt is required before claiming competition-runtime proof.

```bash
cd visualledger-opencv
PYTHONPATH=. python -m unittest -v tests.test_visualledger
PYTHONPATH=. python -O -m unittest -v tests.test_visualledger
PYTHONPATH=. python -m visualledger.cli evaluate --allow-opencv4-dev
```

Analyze and verify an image:

```bash
PYTHONPATH=. python -m visualledger.cli analyze receipt.png \
  --evidence-id RECEIPT-001 --out trace.json --allow-opencv4-dev
PYTHONPATH=. python -m visualledger.cli verify receipt.png trace.json --allow-opencv4-dev
```

Omit the dev switch on the final OpenCV 5 runtime.

## AWS path

`visualledger.aws_adapter` normalizes a single versioned S3 object event, binds bucket/key/version/eTag + pipeline generation into an idempotency key, performs vision, and writes a deterministic evidence record through an injected Dynamo-style boundary. `infra/template.yaml` is an AWS SAM blueprint for a versioned S3 ingest bucket, container-image Lambda worker, and on-demand DynamoDB evidence table.

The local build does **not** deploy AWS or spend money. The production `lambda_handler` requires a deployed container that contains OpenCV 5 and boto3. The first deployment milestone must add a scope-index query before claiming cross-object duplicate detection in AWS; the adapter deliberately does not fabricate that evidence.

## Evaluation

The included synthetic benchmark covers clear, blurred, glare-obscured, two-document, and sparse-document cases. Tests also attack trace tamper, image substitution, near-duplicate routing, malformed/oversize inputs, unsafe S3 keys, versionless events, idempotent replay, symlink ingress, overwrite behavior, and authority widening.

See `docs/ARCHITECTURE.md`, `docs/COMPETITION.md`, and `docs/DEMO_SCRIPT.md`.

## Truth state

This carrier can establish source/test/demo readiness. It does not establish OpenCV-5 runtime execution, AWS deployment, competition registration/submission, judging result, prize, customer use, savings, payment, or revenue.

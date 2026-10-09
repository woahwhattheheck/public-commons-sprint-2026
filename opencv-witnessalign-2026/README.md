# WitnessAlign — physical-fixture visual discrepancy evidence

**Status: Original OpenCV AI Competition 2026 source candidate, not a submitted/deployed entry.**

Assembly-line operators often receive a reference photograph and an inspection photo taken from a slightly different angle. WitnessAlign aligns the new photo to the reference, compensates for smooth exposure changes, highlights local residual regions, and **requires human review**. A blank or unalignable photo triggers recapture rather than a fictitious pass. The evidence packet deliberately does **not** assert whether a product is safe, genuine, in tolerance, or approved.

## How it works

1. Strict local PNG/JPEG byte and pixel bounds reject oversized or invalid input before CV analysis.
2. CLAHE and OpenCV ORB detect local landmarks. Hamming-ratio correspondences feed RANSAC homography.
3. RANSAC inlier fraction, median reprojection residual and the fraction of reference covered by the candidate must all pass. Otherwise: `recapture_required`.
4. Registered grayscale pairs use a low-frequency lighting-field subtraction plus robust median/MAD residual threshold. Morphological connected components rank **compact** candidate changes by measured support; sparse misalignment ghosts are filtered by component fill ratio. Thin scratches/elongated defects are outside this demonstration detector’s intended target. Boundary padding is excluded.
5. The annotated overlay labels suspect regions **REVIEW** and **HUMAN INSPECTION REQUIRED**. The JSON packet lists dimensions, match counts, alignment quality, candidate regions and non-automated authority ceiling.

The algorithm is deliberately **not** a calibration-grade metrology or QA certification system. It does not infer true dimensions, verify orientation, determine root cause, or classify defects without an operator. Repeated patterns, uniform textures, changing fixtures, hidden sides, specular surfaces or misregistered photos can produce false negatives and positives. Never deploy it for unsupervised safety decisions.

## Local demo (Python 3.12)

Install `requirements.txt` in a fresh virtual environment; OpenCV 5 is the **contest runtime target**. The current cloud prototype may use local OpenCV 4.13 as a compatibility-only preview; that is not proof of the required OpenCV 5 operation.

```bash
python -m demo.make_fixtures --out demo/fixtures
python -m witnessalign.cli demo/fixtures/reference.png demo/fixtures/candidate-missing-component.png --output out/missing
python -m witnessalign.cli demo/fixtures/reference.png demo/fixtures/candidate-clean.png --output out/clean
# focused synthetic check only (not a real defect-detection benchmark)
python -m unittest tests.test_synthetic -v
```

Artifacts: `out/missing/audit.json` + annotated `review-overlay.png`. Generator's images are explicitly **SYNTHETIC** and not evidence that any real factory or customer photo has been inspected. No data is uploaded by the local CLI.

## AWS Lambda path (not deployed)

The repository contains an AWS SAM `template.yaml`, container `Dockerfile` with `opencv-python-headless==5.0.0.93`, and a `POST /audit` Lambda handler. Its input is exactly a JSON object with `reference_b64` and `candidate_b64`; it accepts bounded image bytes (no URLs, arbitrary paths, S3 access, or persistent file storage). It runs registration and change detection **inside the AWS Lambda** when deployed. It returns JSON evidence and a preview (only when small enough). The sample HTTP API has no authentication; **do not expose it publicly** without adding strong gateway authentication, rate and payload limits, billing protection, access logs, and consent/data-retention policy. An AWS authorized account, actual OpenCV 5 runtime proof and real deployment receipt are outstanding; this is **not yet an eligible final competition entry**.

## Evaluation / judge demonstration still required

- Install and run the actual OpenCV 5 container on an authorized AWS account, verify input/output + logs and measure latency/cost.
- Collect consented actual reference/candidate fixture images, define a blinded labeled holdout, record precision/recall, false alarms, failures and calibration sensitivity. A synthetic-only check cannot support an accuracy claim.
- Prepare an accessible before/after demonstration and human-review trace; require operator verification before any real action.
- Submit the complete original-source repository + AWS proof + genuine demo through the existing authorized Devpost entrant before **Oct 26, 2026 at 11:45 p.m. PDT** (the site contains a contradictory 11:59 line; use the earlier header deadline).

Official: https://opencv26.devpost.com/rules · Overall cash award pool **up to $12,000** across winners, including $5,000 first place; competitive and not guaranteed. No entry, grant, award or payout is claimed. This original source does not import other fleet project assets or contact a sponsor.

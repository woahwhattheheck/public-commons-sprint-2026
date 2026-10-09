# VisualLedger — OpenCV AI Competition 2026 technical report

**Submission working draft — 9 October 2026. Not an official entry.**

**Project:** VisualLedger, an evidence-bound finance-document intake and human-review agent.
**Source snapshot:** [public repository at ec8c5dc](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/ec8c5dc365e60f4972016bb2c6e42b57f1016ce4/visualledger-opencv).
**Official deadline:** 26 October 2026, 11:45 p.m. Pacific Daylight Time; see [competition rules](https://opencv26.devpost.com/rules).
**Entrant, project URL and submission receipt:** Not independently verified in this package.

## 1. Problem and outcome

Receipt and invoice photographs can be blurred, glare-obscured, multi-document, sparsely structured, or visually repeated. Letting an extraction or accounting process proceed without checking the visual evidence risks amplifying errors. VisualLedger turns measured document-image properties into a *bounded next workflow step*. It never treats a visually plausible image as an authenticated invoice or payment authorization.

On each authorized input, the system reports visual evidence and one of four routes:

| Route | Observed reason | Next step |
| --- | --- | --- |
| REQUEST_RECAPTURE | Blur, glare, contrast or other capture-quality gate | Ask the operator for a new image |
| REQUEST_HUMAN_CROP | Missing/ambiguous boundary, multiple documents or sparse structure | Ask the operator to select original-image pixels and confirm a reason |
| QUARANTINE_DUPLICATE_REVIEW | Exact/near-duplicate evidence under supplied prior context | Human assesses the potential duplicate |
| REQUEST_FIELD_EXTRACTION | One document passes the visual gates | Permit *downstream* extraction followed by human verification, not financial approval |

These routes are not a fraud verdict, OCR result, tax determination, financial disposition, invoice approval or autonomous communication.

## 2. Architecture and concrete implementation

    source image bytes / versioned S3 object
                 |
                 v
    bounded OpenCV decode -> contour and quadrilateral detection
       -> perspective normalization -> Laplacian blur
       -> contrast/glare -> Canny, morphology, Hough line structure
       -> 64-bit OpenCV-resized dHash duplicate fingerprint
                 |
                 v
    canonical evidence trace: source and normalized-image hashes,
    runtime version, actual metrics, thresholds, action and reasons
                 |
                 v
    policy router -> recapture / crop / duplicate review / extraction
                 |
                 v
    explicit operator review; no autonomous financial authority

The same canonical vision engine powers the Python CLI, locally rendered static review and a real single-user, loopback-bound crop workspace. On REQUEST_HUMAN_CROP, a human selects coordinates in the original pixel space; the unchanged engine re-analyzes only the selected crop. The export retains original bytes, crop PNG, both canonical traces, selected rectangle, supplied prior fingerprints and replay manifest. Verification recomputes source and child decisions; a stale case or changed pixels fail instead of silently inheriting a prior approval.

The AWS design, **not yet demonstrated live**, uses a versioned S3 ObjectCreated event, arm64 container-image Lambda with OpenCV 5, and DynamoDB keyed by (scope, event_id). Identity hashes bucket/key/version/eTag and pipeline generation; an injected I/O boundary makes the same handler testable offline. Records carry deterministic receipts and deployment-held HMAC-SHA256 seals. A strongly consistent same-scope lookup checks up to 512 retained records; malformed/stale/unauthenticated records, overflow or pagination fail closed rather than silently bypassing duplicate checks. Replays require an authenticated matching generation before returning an existing record.

The SAM resource graph was repaired to separate the fixed EvidenceBucketName parameter from an S3 policy reference, avoiding the bucket-notification/Lambda-permission/role cycle. This is a source/dependency result, **not** an AWS deploy or permission to provision resources.

## 3. Actual evidence and what it establishes

| Evidence | Established | Not established |
| --- | --- | --- |
| [PR #259](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/259), merged | Human crop, original-pixel rectangle, canonical recomputation and portable replay; three focused checks reported passed | Hosted browser then failed local navigation due to administrator block; no AWS |
| [PR #265](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/265), merged | SAM dependency-cycle source repair and scoped validator definition | Real AWS provisioning, image deployment, throughput or costs |
| [PR #269](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/269), merged | Actual Chromium synthetic-workspace capture and verifier workflow | This browser capture uses OpenCV 4.13 development compatibility; it does not itself establish OpenCV 5, AWS or final narration |
| [GitHub run 37894218628](https://github.com/woahwhattheheck/public-commons-sprint-2026/actions/runs/37894218628) | Completed SUCCESS at 2026-10-09 06:35 UTC; artifact 11599597211, 2,108,440-byte Actions archive, expiry 2026-10-23 06:35 UTC | Entrant registration, AWS round trip, final contest submission or prize |

A **separate genuine hosted OpenCV 5 source execution** is verified: [source-proof run 37894218836](https://github.com/woahwhattheheck/public-commons-sprint-2026/actions/runs/37894218836), job 113701744025, completed SUCCESS on 9 October 2026 against source head `b8bac529a0c39eb59c50696f333729caead532a5`. Its raw job log reports `opencv-python-headless-5.0.0.93`, `opencv=5.0.0`, `competition_opencv5_runtime=True`, two previously completed 66-case test modes and two successful synthetic CLI evaluations. This was hosted **Linux x86-64**, not arm64 Lambda, real S3 or DynamoDB. No new tests were run to prepare this report.

Source evidence also includes [HUMAN_CROP_PROOF.json](../evidence/HUMAN_CROP_PROOF.json) and [offline-review limits](../docs/OFFLINE_REVIEW.md). The recorded browser interaction separately used **OpenCV 4.13** under the development compatibility switch. Do not mislabel browser footage as the OpenCV 5 source-proof run; preserve both environments and their exact source references on-screen.

## 4. Reproduction and judge access

At the snapshot above, from the public repository root:

    cd visualledger-opencv
    python -m pip install -r requirements.txt

Run the production-compatible source only with a genuine OpenCV 5 environment:

    python -m visualledger.cli evaluate
    python -m visualledger.cli analyze receipt.png --evidence-id RECEIPT-001 --out trace.json
    python -m visualledger.cli verify receipt.png trace.json
    python -m visualledger.workspace --port 8769

For **development only** in the historically demonstrated OpenCV 4 environment, supply --allow-opencv4-dev on the supported CLI/workspace commands. Such output must be labeled development compatibility, never counted as an OpenCV 5 performance result. Existing unit and replay instructions are in [README](../README.md), [browser walkthrough](../docs/BROWSER_DEMO.md) and [crop workflow](../docs/HUMAN_CROP_WORKSPACE.md).

The browser workspace binds 127.0.0.1, uses same-origin controls and only a synthetic fixture in the recorded public run. Crop the two-document fixture with left=40, top=90, right=800, bottom=1140. The 760 x 1050 crop moves the actual route from REQUEST_HUMAN_CROP to REQUEST_FIELD_EXTRACTION; no action is forced to pass. Export and independently replay the ZIP using the existing crop CLI. The development video and screenshots are workflow evidence, not a substitute for a final narrated contest video.

The AWS deployment blueprint is [infra/template.yaml](../infra/template.yaml). A qualified operator must first provide an immutable arm64 OpenCV 5 image, authorized AWS resources and secret custody, check existing deployment/stack state, and gather a real versioned S3 -> Lambda -> DynamoDB event result. Do not represent the template, synthetic mocks, workflow success or empty AWS receipt as an actual deployment.

## 5. Evaluation plan, limitations and real-world utility

Synthetic cases cover clear, blurred, glare-obscured, multi-document and sparse images, alongside supplied fingerprint duplicates. Source checks exercise tampered traces, image substitution, unsafe S3 keys, versionless events, stale generations, HMAC changes, replay, symlink ingress and authority flags. These are software-behavior checks, **not** published sensitivity/specificity on real invoices.

Remaining honest limitations:

- Blur, glare, Hough and contour thresholds are heuristics; no measured real-document error rates or demographic/device robustness figures are available.
- Perceptual similarity is a review signal, not proof of duplicate payment or common issuer; prior fingerprint custody is a trust boundary.
- A crop operator's confirmation does not establish identity, document completeness or provenance. The offline HTML and evidence ZIP may expose raw confidential pixels.
- Static replay proves internal consistency, not issuer authenticity. The service HMAC seals retained service records, not the underlying document's legal truth.
- Current public evidence includes genuine OpenCV 5.0.0 image execution and synthetic evaluation on a GitHub-hosted **x86-64** runner, as well as a separate OpenCV 4 development-browser walkthrough. A production **arm64** image, real AWS S3/Dynamo transaction, deployed latency/cost and an external hosted endpoint remain unverified.
- No historical customer adoption, loss avoided, money moved, competition entry or award is asserted.

The expected utility is a reviewable branching intake system whose visual quality findings change downstream work instead of making financial decisions automatically. Demonstrating business impact responsibly will require an approved, labeled document set, reviewer evaluation and measured false-route rates.

## 6. Final judging and publication gate

Before official submission, preserve the browser artifact bytes outside its October 23 retention window; build and inspect an immutable OpenCV 5 arm64 image; obtain one authorized real AWS event and measured latency/cost receipt; record a narrated video of at most five minutes based on [DEMO_NARRATION.md](DEMO_NARRATION.md); verify actual entrant/team account, applicable phase, project link, eligibility and source rights; and submit exactly once with platform ID/readback. See [EVIDENCE_AND_HANDOFF.md](EVIDENCE_AND_HANDOFF.md) for the provenance checklist and status of each requirement.

The published [rules](https://opencv26.devpost.com/rules) score OpenCV technical execution (30%), innovation (20%), real-world impact (20%), UX (10%), documentation (10%) and cloud/reproducibility (10%); special awards use separate criteria. The entrant should read the rules' broad license covering **materials actually submitted** before uploading anything, and must include only assets it has rights to submit. Prize rights, if any, depend on organizer eligibility, judging and confirmed award/payment.

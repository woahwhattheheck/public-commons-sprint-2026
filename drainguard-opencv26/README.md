# DrainGuard — Vision evidence for roadside drain inspections

**OpenCV AI Competition 2026 / AWS candidate** · original source · MIT · October 9, 2026

DrainGuard turns an aerial/standing reference image of a roadside grate and a follow-up photo into **registration evidence**, per-aperture bright-change estimates, and a review-first artifact. It targets municipal drainage maintenance triage where field crews need a transparent prioritization packet. It **never** purports to determine hydraulic capacity, safe drainage, actual flood risk, or issue an unattended repair order.

## What actually works in this archived source

- Seeded **synthetic** before/after scene with four reference aperture ROIs, small camera shift and invented brown leaves in two apertures.
- OpenCV ORB feature matching, Lowe-ratio filtering and RANSAC homography for camera alignment; rejects low inlier fraction, geometry instability, uncovered aperture and adverse illumination.
- Reference-dark-aperture bright-change measurement, interpretable per-slot coverage/ratio/classification, annotated aligned image, confidence *evidence*, and mandatory human review.
- Static local reviewer UI with original synthetic imagery, four aperture rows and explicit limitations.
- Complete source route for **AWS S3 ObjectCreated → container-image Lambda (OpenCV) → private S3 annotated/photo/JSON + DynamoDB human-review queue**, with least-privilege IAM, S3 server-side encryption, size-bounded reads, idempotent content-addressed reports and controlled prefix.

### Evidence truth (critical)

The actual cloud harness used for source development has **OpenCV 4.13.0**, not 5. Code deliberately uses APIs expected to remain compatible with OpenCV 5, and the deployment Dockerfile requests `opencv-python-headless>=5.0,<6.0`; **an OpenCV 5 runtime, Lambda image build, deployed AWS execution, field photos, video, and official Devpost entry have NOT been verified**. A local synthetic smoke result is not proof of a qualified competition entry. Version availability and AWS billing must be checked by an authorized operator before deployment. No external provider funds were spent during authoring.

## Reproducible local judge demo

```sh
# Have Python 3.12+, numpy and cv2 available; currently verified developer version: OpenCV 4.13.
python -m drainguard.demo --out demo/artifacts
cd demo && python -m http.server 8000
# Visit http://127.0.0.1:8000/ (static, local, zero cloud calls)
```

The demo renders `reference.png`, shifted `capture.png`, aligned `annotated.png`, `report.json` and `slots.json`. With RGB/BGR conversion handled by OpenCV, orange/red rectangles mark inspection priority; **green is not a safe-drain certification**. The CLI printout is only derived from generated synthetic data. One narrow regression invocation if a focused behavior check is required: `python -m unittest discover -s test -p test_focused.py` (do not run unrelated test suites).

## Real AWS deployment architecture (source provided, no live deployment assertion)

```text
private S3: reference/reference.png + reference/slots.json (human-established baseline)
                  │
private S3: captures/<capture>.jpg ──ObjectCreated prefix trigger──► Lambda container
                   └─ constrained IAM read, <=12 MiB streams
                                      │
                       OpenCV registration + review-classification
                                      │
             ┌────────────────────────┴──────────────────────────┐
             ▼                                                   ▼
 S3: reports/<id>/report.json                      DynamoDB review queue
 S3: reports/<id>/annotated.jpg                     AWAITING_HUMAN_REVIEW
```

The included `infra/template.yaml` and Dockerfile are meaningful AWS integrations, not a placeholder service naming AWS. `handler` rejects unauthorized buckets, keys outside `captures/`, invalid image/config and unbounded payloads; only writes `reports/*`, with an S3 event filter preventing recursive triggers. Stable assessment identifiers bind the capture ETag to the exact reference and slot-config versions; repeated S3 events do not enqueue duplicate review items. `ConditionalCheckFailedException` is treated as an idempotent replay only. DynamoDB sourceKey is retained for human traceability, not published. As delivered this SAM source is **not an authenticated deployment receipt**. The integrated template now uses required `DrainGuardBucketName` to avoid an apparent S3 notification / Lambda role reference cycle; inspect `SAM_DEPLOYABILITY.md`. No actual SAM-transform or AWS deployment success is claimed.

An operator with their own authorized AWS environment may deploy after confirming availability and licensing of an OpenCV 5 package and the hosting costs. Install the AWS SAM CLI, set credentials privately outside source, then:

```sh
sam build -t infra/template.yaml
sam deploy --guided --template-file .aws-sam/build/template.yaml
# At the guided parameter prompt set DrainGuardBucketName to a new globally unique,
# lowercase, DNS-safe 3-63 character S3 name. No default name is embedded.
# Read the private bucket output; upload reference/reference.png and the
# drainguard/slots/v1-config file, then one consented test image to captures/.
```

Use generated `demo/artifacts/reference.png` and wrap `demo/artifacts/slots.json` in:

```json
{"schema":"drainguard/slots/v1","slots":[{"id":"S1","x":180,"y":153,"width":58,"height":132},{"id":"S2","x":269,"y":153,"width":58,"height":132},{"id":"S3","x":358,"y":153,"width":58,"height":132},{"id":"S4","x":447,"y":153,"width":58,"height":132}]}
```

Human reviewer must verify registration, lighting comparability, slot coverage and unmodeled failure modes and can reject any automated classification. The workflow never performs physical field action.

## Review, threat, privacy and operations

**Bounds:** Max image 4096 px per side / 10 MP decoded / 12 MiB S3 encoded, 1–64 reference ROIs, min 16 registration matches, calibrated lighting MAD and geometric consistency. If important evidence is unreliable, result is RECAPTURE or review required. Frame and S3 object are separate, both bounded. Results are not public; only synthetic generated scenes appear in the public demo.

**Known limitations:** ORB may fail on smooth concrete or repeated grate geometry. Bright-difference method ignores dark blockage; partial occlusion could be missed. Weather, daylight, lens distortion, full-scene relocation, different hardware, submerged grates, seasonal artifacts and camera movement can trigger false positives or abstention. No calibrated sensitivity/specificity on field footage; labels are synthetic scenario descriptions only. No residents/faces/vehicle plates are processed in fixtures. For real video, human-established lawful capture and privacy retention review are required before activation.

**Cloud controls:** S3 AES-256 encryption, public access blocking, lifecycle-expired demo captures and noncurrent versions, Lambda bounded memory/time, IAM only reference/capture read, reports write and queue PutItem, DynamoDB encryption. No AWS access key in code. Cloud logging should avoid raw image bytes or identity-bearing metadata. Actual operator should add alarms, deployment-specific quotas and incident response before production. Demo does not involve client-side uploading of data.

## Competition activation — uncompleted gates

OpenCV AI Competition 2026 (official https://opencv26.devpost.com/rules) has a **Oct 26 2026 11:45pm PDT** deadline; up to **$12,000 conditional cash**, overall rubric weighted OpenCV technical depth, innovation, impact, UX, docs, AWS/reproducibility. An entry needs a genuinely working **OpenCV 5**, functioning **AWS** component, evidence-led documentation/video and an eligible authorized original entrant's final Devpost submission. This source meets neither version/deployment proof nor actual official entry by itself. The $12,000 maximum pool is not earnings or an assured award.

Activation order: verify a real compatible OpenCV5 image; deploy to an approved AWS account with cost cap; run one consented **synthetic** event end-to-end and inspect S3/DynamoDB provider readbacks; collect original-author/public-code consent; record a truthful demo with failure paths; register and submit via the correct original entrant; preserve provider receipt. Do not invent an AWS success, benchmark, entrant identity or reward.

## License

MIT; see LICENSE. Synthetic fixtures and code are new work produced for Commons. Reused packages remain licensed by their respective owners; any further data/model rights must be separately verified.

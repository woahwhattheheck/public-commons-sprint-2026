# PalletGap — camera evidence that changes the inspection plan

Original OpenCV AI Competition 2026 + AWS prototype. **Not a warehouse safety control or substitute for an on-site inspection.** The software compares a *fixed, human-commissioned* empty aisle baseline with new images, geometrically registers images, masks the human-defined aisle and detects large localized changes. Rather than making an enforcement decision, the first positive observation requests a genuinely independent confirmation frame. Persistent visual findings are sent for **human review**; unreliable camera alignment or lighting returns **ABSTAIN / RETAKE**. It never asserts that an aisle is safe, never authorizes movement, and does not recognize people.

## Why this is an agentic-vision workflow

```text
S3 manifest with camera/frame IDs
  → OpenCV ORB correspondences + RANSAC homography
  → robust Lab illumination correction + connected-region change evidence
  → within defined aisle polygon?
     ├─ unreliable registration/large scene change → RETAKE_REQUIRED
     ├─ no significant change → OBSERVED_NO_CHANGE (not safe/clearance)
     └─ candidate → request SECOND independent frame
          ├─ absent → SECOND_VIEW_REQUIRED
          ├─ disagrees/unreliable → DISAGREEMENT_REVIEW / RETAKE_REQUIRED
          └─ spatially persistent → HUMAN_REVIEW_REQUIRED → AWS FIFO review queue
  → human reviewer (not implemented as automated approval)
```

The next camera capture or manual action **depends on actual vision evidence**. The algorithm does not just describe a finished screenshot. No face detection, person tracking, hard-coded occupancy classification, or autonomous actuation.

## Competition fit and evidence truth

- Public rules: https://opencv26.devpost.com/ — final deadline October 26, 2026; substantive **OpenCV 5** and a meaningful **AWS** component are required. This source uses ORB/RANSAC, morphology and image analysis; AWS SAM defines an S3-triggered, image-container Lambda, DynamoDB decision records and a FIFO human-review queue.
- Real runner evidence from this implementation: one synthetic, bounded three-path local demonstration. **Runner was OpenCV 4.13** because OpenCV 5 isn't installed in this container. This is **not** evidence of an OpenCV 5-validated deployment. AWS stack and any judge submission remain unexecuted.
- All imagery currently synthesized: no production camera or end-user claim, no real ground-truth performance estimate, no AWS bill or credential use. The reference is illustrative; meaningful real-world evaluation and operator sign-off remain required.
- Primary executable environment is OpenCV 5.0+ (see requirements). AWS deploy must use an image built with actual OpenCV 5 and verified on Arm64 before claiming competition requirements are satisfied.

## Offline demo

Install Python 3.12, NumPy, and **OpenCV 5** using `requirements.txt` in a fresh virtual environment; `boto3` is for AWS only.

```bash
python -m pip install -r requirements.txt
python -m palletgap.demo --out demo-artifacts
python -m palletgap.cli --reference demo-artifacts/reference.png \
  --frame demo-artifacts/blocked.png \
  --confirmation demo-artifacts/confirmation.png \
  --camera demo-artifacts/camera.json --out demo-artifacts/output
cat demo-artifacts/output/decision.json
```

The one local focused check is `python focus/one_focused_demo.py` with `PYTHONPATH=.`. It executes **three paths in one synthetic run**: brightness-only reference shift → `OBSERVED_NO_CHANGE`, isolated obstruction → `SECOND_VIEW_REQUIRED`, repeated obstruction → `HUMAN_REVIEW_REQUIRED`. The generated reference and annotated view are synthetic. Do not report real-camera accuracy from these fixtures.

## AWS ingestion contract

`infra/template.yaml` is a SAM **source template, not a deployed stack**. Before AWS deployment, configure secure authenticated capture uploads, cost/quota caps, a human review UI and project account. Upload `config/<site>/camera.json` with `reference_key` and the aisle polygon. Upload the baseline, first and optional confirm image under `frames/<site>/` (PNG/JPEG); after the frames exist, upload `requests/<id>.json` as:

```json
{
  "schema": 1,
  "site": "demo-site",
  "camera_key": "config/demo-site/camera.json",
  "first_key": "frames/demo-site/capture-001.png",
  "second_key": "frames/demo-site/capture-002.png"
}
```

Only the SAM-owned S3 bucket, explicit prefixes and bounded file sizes are accepted. It is essential that trusted camera configuration and capture upload permissions are separated at deployment. The pipeline is **at least once**: the review consumer deduplicates on `inspection_id`, and unconfirmed or mismatched frames are always escalated, never marked safe. DynamoDB retains decisions for up to 30 days (TTL eventual); S3 lifecycle expires raw `frames/` after seven days. An operator must review before taking any field action. The frame capture service/reviewer is a required integration, not purported production functionality here.

## Evaluation and limitations

**Confirmation integrity:** the engine now rejects *pixel-identical* first and confirmation frames as a frozen/replayed feed and requests a new capture. Run `PYTHONPATH=. python focus/identical_confirmation.py` for the one synthetic replay-versus-fresh confirmation regression. Non-identical pixels do **not** prove capture independence, freshness or camera authenticity; a production upload service still needs trusted frame identities and timestamps. No remote camera or physical safety evaluation is claimed.

Real evaluation should use a fixed-camera dataset with day/night, shadows, vibration, partial occlusion, different load positions and accessible manual labels; measure detection rate, false escalation, abstentions, end-to-end latency and cost. ORB may fail on textureless floors; chroma thresholds can disagree under sunlight; overlap is not real-world distance or a 3D clearance measurement. Reviewers must not infer regulatory compliance from any output. Synthetic fixtures intentionally test program flow, **not predictive accuracy**.

Source: MIT, aligned with the host repository license. Original independent competition candidate; no competition entrant/team registration, AWS execution, win or payout is implied by public source publication.

### AWS event snapshots and evidence receipts (source-only)

S3 ObjectCreated notification is pinned to its versionId when present and/or verified against its event eTag with a conditional GetObject. Missing snapshot identifiers or an overwritten unversioned manifest fail closed: the handler does not silently process the current content of a stale event. The receipt inspection_id and evidence_sha256 bind the **bytes actually read** for manifest, camera config, reference, first and optional confirmation frames. Changed camera evidence cannot silently reuse an earlier receipt solely because the request manifest is unchanged.

Schema-1 frame and config references still load their then-current bytes; hashes provide audit identity, **not proof of immutable capture provenance or independent timestamps**. Real deployments require authenticated uploads, version pinning for all input objects, independent capture evidence, operator review and actual AWS/OpenCV5 qualification. This is source only; nothing was deployed or submitted. Offline AWS-mocked focused check: PYTHONPATH=. python -m unittest -q focus.test_s3_snapshot.

### Fully version-pinned evidence (schema 2; source-only)

The opt-in schema-2 request requires a **real S3 VersionId** for the manifest ObjectCreated event and for EVERY referenced input object. The versioned bucket is declared in the SAM template; a legacy unversioned event or missing version field fails closed. The following JSON contains illustrative placeholders: the trusted capture/upload service must replace them with actual S3 object-version IDs.

~~~json
{
  "schema": 2,
  "site": "demo-site",
  "camera_key": "config/demo-site/camera.json",
  "camera_version_id": "ACTUAL_CONFIG_S3_VERSION_ID",
  "first_key": "frames/demo-site/capture-001.png",
  "first_version_id": "ACTUAL_FIRST_S3_VERSION_ID",
  "second_key": "frames/demo-site/capture-002.png",
  "second_version_id": "ACTUAL_SECOND_S3_VERSION_ID"
}
~~~

The selected version of the camera config must include its existing reference_key AND reference_version_id sourced from the trusted original reference upload. If second_key is absent omit second_version_id; if it is present the version is mandatory. Retrieval uses conditional versioned S3 GetObject, verifying returned VersionId for each object. The review receipt records both actual byte SHA-256 hashes and source evidence_versions; inspection_id binds both. Replay with the same version pins and bytes is stable when current S3 objects are overwritten. A new original version yields a new receipt identity even if its content bytes are unchanged.

The SAM template enables S3 Versioning and s3:GetObjectVersion and expires noncurrent raw frame versions after seven noncurrent days; operators must evaluate cost and evidence retention before deploying. This source is NOT deployed here. Backward-compatible schema 1 continues to hash bytes actually read, but config and frames remain UNPINNED on schema 1. Object VersionId alone proves neither independent capture time, upload authorization, camera authenticity, actual physical clearance nor regulatory compliance. The system still requires a trusted publisher, human review, real OpenCV5/AWS deployment validation and explicit contest submission.

Focused offline AWS-mocked check: PYTHONPATH=. python -m unittest -q focus.test_s3_snapshot focus.test_s3_all_inputs_pinned. No live AWS, official entry, award or broad test run is claimed.

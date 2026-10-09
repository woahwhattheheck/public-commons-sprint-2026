# VisualLedger — evidence custody, readiness and entrant handoff

**Observation date:** 9 October 2026. This document distinguishes code delivery, actual execution, retained artifacts and platform submission. It is not a signed organizer receipt.

## Current evidence snapshot

| Item | Direct evidence / identity | Status |
| --- | --- | --- |
| Public project source | [Snapshot ec8c5dc365e60f4972016bb2c6e42b57f1016ce4](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/ec8c5dc365e60f4972016bb2c6e42b57f1016ce4/visualledger-opencv) | Published; use immutable source commit in judge materials |
| Human crop + independent replay | [Original merged PR 259](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/259), [local receipt](../evidence/HUMAN_CROP_PROOF.json) | Focused source/runtime proof in OpenCV 4.13 development mode |
| SAM resource dependency repair | [Original merged PR 265](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/265), [repair details](../docs/SAM_DEPENDENCY_REPAIR.md) | Code/source graph repair, not AWS provisioning |
| Real browser walkthrough | [Original merged PR 269](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/269), [Actions run 37894218628](https://github.com/woahwhattheheck/public-commons-sprint-2026/actions/runs/37894218628) | GitHub: completed SUCCESS, source head b8bac529a0c39eb59c50696f333729caead532a5 |
| Actions output | Artifact **11599597211**, name visualledger-synthetic-browser-demo | Outer GitHub ZIP 2,108,440 bytes, expires 2026-10-23 06:35:08 UTC |
| Durable evidence transfer | User Library path **/Commons/VisualLedger/OpenCV26-JudgePackage-20261009/visualledger-browser-evidence-run37894218628.zip** | Library upload succeeded on 9 October. Cross-seat readback is not yet proved; do not substitute the expiring Actions URL for durable custody |
| Genuine hosted Linux x86-64 OpenCV 5 runtime | [Source-proof run 37894218836](https://github.com/woahwhattheheck/public-commons-sprint-2026/actions/runs/37894218836), job 113701744025, head `b8bac529a0c39eb59c50696f333729caead532a5` | SUCCESS: job log reports `opencv=5.0.0`, 66 existing regular + 66 existing optimized tests passed, and successful clear/blur/other synthetic CLI evaluations. No new run by this handoff; **not AWS or arm64** |
| OpenCV 5 on AWS arm64 | [Requirements](../pyproject.toml) and production Lambda source | No verified deployed arm64 image or real event receipt |
| Live AWS event | S3 object VersionId, Lambda request ID/runtime, Dynamo record and HMAC check, latency and cost | Not verified |
| Narrated technical review and portable dossier | [Later producer receipt](../docs/JUDGE_EVIDENCE_20261009.md) | **Delivered, producer-reported:** 164.546-second narrated MP4 and 25-file dossier. Exact bytes not independently downloaded in this handoff; verify SHA-256 from the receipt before entrant publication. These artifacts are **not an official entry**. |
| Actual judge-accessible hosted endpoint | [Submission readiness](../docs/COMPETITION.md) | No verified hosted deployment or final accessible endpoint; AWS arm64 execution remains unverified |
| Devpost entrant/team/project and submission | [Official rules](https://opencv26.devpost.com/rules) | Authenticated entrant and official submission ID/status not verified |
| Prize/allocation/received money | Organizer and payment provider | No award or payout established |

## Later narrated-asset receipt (not an AWS or entry receipt)

A separate producer subsequently delivered a **164.546-second** narrated technical cut (3,147,797 bytes; SHA-256 `37b4707264207d5b6b78967e282400f25de2796f0660c08d58c2014122e129b7`) and a **25-file** portable review dossier ZIP (7,198,495 bytes; SHA-256 `7c44510c7d0d21e9550a8d199252f502cc8a3bc6dd1d8beedb5327576d5d646a`). Their authoritative source-backed status and caveats are recorded in [the later delivery evidence](../docs/JUDGE_EVIDENCE_20261009.md). The handoff here **has not independently retrieved or rehashed those final media bytes**; the producer's SHA-256 values are reference identities for a real entrant's verification, not our verification claims. The technical cut preserves original synthetic Chromium footage, with OpenCV 4.13 development correctly separated from a different genuine Linux/x86-64 OpenCV 5 source-proof run. No live AWS arm64 deployment, current accessible service, official Devpost submission, award, payment, or real-document benchmark is proven by the video.

## Actual artifact integrity and contents

Retrieved the original [GitHub Actions artifact](https://github.com/woahwhattheheck/public-commons-sprint-2026/actions/runs/37894218628), verified ZIP CRCs, and placed the **unchanged outer archive bytes** in the user Library path above.

- **File:** visualledger-browser-evidence-run37894218628.zip
- **Size:** 2,108,440 bytes
- **SHA-256:** c33016ec8c73f51cd21d67bc1321dd5df425bb10f3aa4fadb3c0a07c6bdfb88d
- **ZIP CRC validation:** every member passed archive CRC verification.
- **Entries, with uncompressed size:** workspace-demo.webm (1,492,175 bytes); workspace-before.png (204,362); workspace-after.png (267,571); workspace-recapture.png (223,477); browser-proof.json (1,675); browser-export.zip (40,839).

This archive proves only what the contained original receipt, rendered recordings, bytes and tested runtime prove. It is not itself an OpenCV 5 or AWS proof. Avoid publishing real customer images; this retained run uses synthetic inputs.

To recheck a retrieved archive in a trusted environment:

    sha256sum visualledger-browser-evidence-run37894218628.zip
    unzip -t visualledger-browser-evidence-run37894218628.zip

The expected digest is the SHA-256 above. Inspect the original browser-proof.json before narrating shot-level behavior. Do not replace a missing frame with a fabricated screen or trace.

## Required real runtime acceptance, not to be replaced with scaffolding

A qualified deployment seat with existing authorization and budget should capture **one** actual execution receipt for the current code:

1. Record immutable source commit, arm64 image digest, Python/runtime architecture and actual import cv2 version proving 5.x without --allow-opencv4-dev.
2. Use existing approved AWS resources (or authorize a new deployment separately), deploy the repaired SAM stack with an immutable ECR image and deployment-held record HMAC key; do not put secret values in evidence logs.
3. Upload one synthetic versioned S3 image. Capture bucket/key/version/eTag, Lambda CloudWatch request ID, elapsed time, output scope/event_id and the Dynamo item; verify the returned trace against the image and inspect authenticated record seal through the existing source.
4. Replay the same S3 version and record the actual idempotent result; measure only observed time and costs. Avoid claiming cloud duplicate detection or concurrency behavior beyond observed records.
5. Record the exact source/image/receipt identifiers and release any temporary resources only when authorized and safe.

If the operator cannot establish these, keep **arm64 OpenCV 5 / AWS deployment and transaction** labeled **unverified**; retain the separate existing hosted x86-64 OpenCV 5 source-proof receipt as established, without blending the two runtimes.

## Entrant and final-submission checks

The original entrant should verify real Devpost login, team member eligibility, ownership/permission for all submitted assets, existing draft/submission history and permitted phase before uploading. Do not duplicate an existing submitted entry. The rules currently display a deadline of **October 26, 2026, 11:45 p.m. PDT**, with a 100-point overall rubric and additional award rubrics.

Final judge-facing package should contain: final report tied to source commit, accessible code/archive, pinned installation and reproduction/deploy instructions, architecture diagram, accurate synthetic performance/evaluation/limitations, working demonstration or valid access path, <=5-minute *actually narrated* video, and genuinely observed AWS/OpenCV 5 evidence when claiming that coverage.

Use [REPORT.md](REPORT.md) and [DEMO_NARRATION.md](DEMO_NARRATION.md) as prepared source; they are not proof of an uploaded contest entry. The submission operation must return the provider's actual project URL, entry/submission ID, date/time, final status, and any judging receipt. Preserve original contributor/entrant rights and seek the applicable award payout only if the organizer actually awards it.

## Closeout checklist

- [x] Reviewed existing source, original PR receipts and official October 26 rules.
- [x] Retrieved actual browser workflow artifact, inspected ZIP members and SHA-256.
- [x] Persisted artifact in user Library beyond GitHub's automatic expiry (upload success only).
- [x] Prepared technical report and timed final narration.
- [ ] Independently proved other fleet seats can retrieve the Library artifact.
- [x] Recovered prior actual Linux x86-64 OpenCV 5.0.0 synthetic source-proof run 37894218836 (readback only; not a new test run).
- [ ] Recorded deployed arm64 OpenCV 5 + AWS S3/Dynamo runtime event and measured latency/cost.
- [x] Later source-backed producer reported an already-rendered 164.546-second narrated technical video (under five minutes) and portable dossier. This handoff did not reproduce the render.
- [ ] Original entrant independently retrieves and SHA-256-checks both narrated MP4 and dossier, verifies accessibility/captions and accepts the final judge-facing media.
- [ ] Reconciled authenticated entrant/project state and completed official submission with provider readback.
- [ ] Verified award or payment, if any, from the actual organizer.

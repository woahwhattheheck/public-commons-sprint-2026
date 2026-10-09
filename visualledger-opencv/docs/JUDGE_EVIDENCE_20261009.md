# VisualLedger judge evidence and reproduction

Prepared 2026-10-09. Original entrant and source-contributor rights remain intact.

## Delivered technical dossier

`visualledger_judge_dossier_20261009_n9.zip` is a 25-file portable dossier containing a technical report, an architecture diagram that separates the recorded local path from the AWS blueprint, reproduction instructions, an offline HTML viewer, an integrity verifier, the original browser and SAM artifacts, and a narrated technical video with a transcript and captions.

- Archive: 7,198,495 bytes; SHA-256 `7c44510c7d0d21e9550a8d199252f502cc8a3bc6dd1d8beedb5327576d5d646a`.
- Narrated MP4: 3,147,797 bytes; 164.546 seconds; SHA-256 `37b4707264207d5b6b78967e282400f25de2796f0660c08d58c2014122e129b7`.
- The entrant's shared delivery folder retains the archive and MP4. These hashes identify the exact handoff, not an automatically public download URL.
- Synthetic narration is not the voice of a real team member. The video uses the existing actual Chromium recording and screenshots, not a new app execution. The original recording remains byte-identical in `evidence/workspace-demo.webm`.

The dossier is ready for technical review. It is **not a completed competition entry**, a new application benchmark, an OpenCV 5 runtime receipt, an AWS deployment, an award or a payment.

## Source-backed observed result

[Browser workflow run 37894218628](https://github.com/woahwhattheheck/public-commons-sprint-2026/actions/runs/37894218628) completed successfully. Its artifact **11599597211** contains a 12.48-second actual recording, three screenshots, `browser-proof.json`, and `browser-export.zip`.

| Observation | Original image | Human-selected crop |
|---|---|---|
| Geometry | 1600 x 1200 | 760 x 1050 |
| Document candidates | 2 | 1 |
| Next action | `REQUEST_HUMAN_CROP` | `REQUEST_FIELD_EXTRACTION` |
| Human review | Required | Still required |
| Prior fingerprint context | Empty | Same empty context |
| OpenCV | 4.13.0, explicit development mode | Same runtime |

The rectangle is left 40, top 90, right 800, bottom 1140. Right and bottom are exclusive. The source reason is `AMBIGUOUS_DOCUMENT_GEOMETRY`; the child reason is `VISION_INTAKE_PASSED`. The proof records independent export replay as `REPLAY_MATCHED`, receipt `282b45d265619dc08bd9e5d780607fcdd5b4367e4b74c4c5b231348271138462`.

The policy thresholds remain identical. The normalized PNG digest and dHash also remain identical because the selected document was already the original image's primary normalized candidate. The original and crop **source-byte** hashes differ. This result shows a geometry-driven route change, not an invented improvement in sharpness. No previous fingerprint history was supplied, so it does not establish database-wide duplicate detection.

The actual recording also loads a blurred synthetic fixture and leaves crop/export disabled in its recapture state. It does not establish real-world accuracy or every possible failure case. A request for field extraction is not OCR execution, invoice approval, issuer authentication, accounting or money movement.

## Original evidence identities

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Original browser artifact ZIP | 2,108,440 | `c33016ec8c73f51cd21d67bc1321dd5df425bb10f3aa4fadb3c0a07c6bdfb88d` |
| Original browser video | 1,492,175 | `107e419d9f15ea227088c0d4ebf62fadadd523cde69e3f2b451c0a2ee07d0574` |
| Original browser export | 40,839 | `80a410d86a84a2a1ced2687aaf088072cbecbd5138a392b81938ae7b9ead7431` |
| Original SAM artifact ZIP | 603 | `fbc9d37b68008998338037ac26bdc9453370bc4b9e5fab718ce60ec8af784410` |

All five members named by the browser proof matched their recorded sizes and SHA-256 values during packaging. The package verifier accepted its manifest and rejected an isolated corrupted copy with exit 2. These are byte-integrity checks, not digital signatures or new OpenCV executions.

The static viewer's local browser-render attempt returned `net::ERR_BLOCKED_BY_ADMINISTRATOR`. No browser policy was changed or bypassed. Its render is therefore not claimed as confirmed in this runner. The original application browser evidence above comes from the separate successful hosted run, not that blocked viewer check.

## Reproduction

The workflow head is `b8bac529a0c39eb59c50696f333729caead532a5`; the proof records checkout `bf801f039e17e581ed692c3949cb93c8a5639f30`. Preserve both values. A pull-request head and its checked-out merge revision must not silently be equated.

In a disposable environment without credentials:

```sh
git clone https://github.com/woahwhattheheck/public-commons-sprint-2026.git
cd public-commons-sprint-2026
git fetch origin bf801f039e17e581ed692c3949cb93c8a5639f30
git checkout --detach bf801f039e17e581ed692c3949cb93c8a5639f30
python3.13 -m venv .venv
. .venv/bin/activate
python -m pip install -r visualledger-opencv/tools/browser-requirements.txt
cd visualledger-opencv
python -m visualledger.crop /ABSOLUTE/DOSSIER/evidence/browser-export.zip --allow-opencv4-dev
```

`/ABSOLUTE/DOSSIER` is the unpacked handoff directory. Stop if the recorded revision cannot be retrieved; do not substitute moving main and call it the same run. The recorded expected result is `REPLAY_MATCHED` with the receipt above. These are reproduction instructions, not a claim that the application was rerun during packaging.

The pinned development dependencies are `opencv-python-headless==4.13.0.92`, `numpy==2.3.5`, and `playwright==1.63.0`. The project metadata's OpenCV 5, NumPy and boto3 ranges are **not** an exact final-runtime lock.

For an actual operator demonstration, run `python -m visualledger.workspace --port 8769 --allow-opencv4-dev`, open the printed loopback address, load the two-document synthetic fixture, apply the recorded rectangle/reason, export and replay. Keep the service on 127.0.0.1; do not turn this single-user workspace into a public service or tunnel. Reuse the retained recording rather than rerunning broad tests merely to check a dossier.

## AWS proof boundary and concrete completion work

[SAM workflow 37893081628](https://github.com/woahwhattheheck/public-commons-sprint-2026/actions/runs/37893081628), artifact **11599431637**, records translator 1.113.0 reproducing the previous resource cycle and verifying the repaired acyclic graph. Managed-policy lookup and deployment parameters were offline fixtures. It does not prove a live AWS stack.

The implemented blueprint is versioned S3 -> container Lambda -> DynamoDB evidence, with deployment-held HMAC verification before retained evidence may influence replay/duplicate routing. Record authentication is not authentication of an invoice issuer. The source specifies bounded same-scope history and failure rather than silent sampling when that bound is exceeded.

The remaining runtime deliverable is one authorized OpenCV 5 image execution and version-pinned S3-to-worker-to-Dynamo round trip in an existing approved account/budget, retaining exact source revision, resolved dependency lock, image architecture/digest, actual OpenCV version, object version, event/record outcome and measured latency. Keep HMAC keys and credentials private. Do not substitute another SAM-only run for this missing live evidence. No COOL/Graviton award qualification is established.

## Entry and deadline

[Organizer requirements](https://opencv26.devpost.com/) call for substantive OpenCV 5 and a meaningful AWS component, a report, judge-accessible code, pinned reproduction, architecture, a working endpoint or arranged live screen-share, and a video no longer than five minutes. The technical cut still needs a genuine original entrant/team introduction and actual final-runtime evidence before it can represent the complete entry.

The banner and [Rules](https://opencv26.devpost.com/rules) read **October 26, 2026 at 11:45 p.m. PDT**; overview prose says 11:59 p.m. PT. Use the earlier displayed cutoff operationally: **October 27, 06:45 UTC / 02:45 EDT**, and recheck the authenticated entrant page before uploading. Preserve the existing entrant and verify current submission history before a single upload. The archive, source merge and narration are not provider submission receipts.

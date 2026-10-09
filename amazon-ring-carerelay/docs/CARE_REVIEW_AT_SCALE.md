# CareRelay: real static review bundles

Additive, offline operator UX for the original Amazon Ring entry. Reads the existing replay-validated workspace. Does not contact Ring, handle video, record decisions, or change receipt/policy authority.

## Run from amazon-ring-carerelay/

```sh
python -m carerelay.workbench report workspace.json --out review-full.html
python -m carerelay.workbench report workspace.json --pages --size 100 --out review.html
python -m carerelay.workbench report workspace.json --summary --out summary.html
python -m carerelay.workbench report workspace.json --pages --size 50 --status pending --classification human --kind doorbell --out pending-human.html
python -m carerelay.workbench report workspace.json --summary --status approved --out approved-summary.html
```

Default full report remains byte-for-byte on its original renderer path. New --pages writes a linked set of actual sibling files: first page review.html, then review-p002.html, review-p003.html, etc. First/Previous/Next/Last target existing exported files, not unusable ?page=N links on a static page. Open offline with no server or JavaScript. New output paths must not already exist.

Allowed sizes: 25, 50, 100, 500, 1000. Status: all, pending, approved, rejected. Kind and classification are exact event-value filters. The whole-workspace totals remain distinct from the matched selection. Quiet events are shown only for status=all; summary mode computes status/class/kind counts without cards.

**Completeness**: a page index spans both matching proposals and non-proposal events. Page count is the maximum of both independently calculated page counts. This keeps later quiet events reachable when they outnumber the review proposals, without inventing external actions. All event fields, labels, source and links are HTML-escaped. The exporter restores/validates once for its full bundle rather than re-running workspace restoration for each page.

## Retained measured design input, not a post-change measurement

On October 9, Muse's source-exact CareRelay review-at-scale run (MUSE-MASSIVE-OPTIMIZATION-WAVE03-20261009-LANE-B-CARERELAY-REVIEW-SCALE, #sim-data) retained 5,000 real workspace events, 1,501 proposals (1,350 pending / 76 approved / 75 rejected) and 3,499 events without a proposal. Its **earlier staged** 100/page HTML was ~94 KB versus the 2,031,310-byte full control: ~21.6x less output. The prior sample is pinned to superseded PR399's older renderer. This new source is different: real sibling navigation and complete quiet-event paging. Do not attribute the prior VM timings or exact bytes to the new module before replay.

One focused committed-source check:
```sh
python -m unittest discover -s tests -p 'test_paged_review.py' -q
```

Next 1:1 Muse run: use the **same archived 5,000-event workspace** and this exact published commit. Verify total 1,501 proposal cards + 3,499 quiet cards across every generated page, decision/status totals, retained SHA-256, unchanged authority, exact valid navigation targets, output bytes and wall time. For size 100/all, 35 pages are necessary to include 3,499 quiet events; do not stop at proposal page 16.

## Official competition boundary

Amazon Developer Hackathon Ring track: the submission must use an actual Ring API, SDK, simulator or device, and demonstrate working Ring functionality in a simulator or on a device. The official deadline is October 23, 2026 at 12:00 PDT; the submission requires a code repository and a public YouTube/Vimeo video shorter than 3 minutes. This read-only UX does not establish Ring provider execution, actual contest entry, judging or award.

Official rules: https://amazonappdev2026.devpost.com/rules
Original project: https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/amazon-ring-carerelay

# VisualLedger — narrated judge-demo production script

**Working recording script / storyboard, target 4:35, maximum 5:00.** This is **not** an assertion that the final narrated film has been recorded or uploaded. Use only real captures from the checked synthetic workflow; never substitute mock AWS footage as if it were live.

**Existing visual source:** [successful browser run](https://github.com/woahwhattheheck/public-commons-sprint-2026/actions/runs/37894218628), artifact 11599597211 (expires 2026-10-23). This contains the synthetic workflow recording/screenshots and portable replay proof, not a narrated final video. Review the actual clip duration and cut points after preserving the bytes. Re-record missing shots if needed using [the documented Playwright driver](../docs/BROWSER_DEMO.md).

## 0:00–0:30 — The task and the stakes

**Visual:** Project title; synthetic receipt and multi-document input; no customer data.

**Narration:** "A finance team shouldn't have to discover bad image evidence after extraction or a payment workflow has already begun. Receipts arrive blurred, cropped badly, repeated, or with several documents in one photograph. VisualLedger measures that evidence before the next tool acts. Its job is not to decide whether to pay. Its job is to show the operator why a capture needs correction, review or controlled extraction."

**Screen caption:** Visual evidence changes the next action. Human review always required.

## 0:30–1:10 — Concrete OpenCV perception

**Visual:** Synthetic clear document; display the canonical trace next to the source. Zoom on boundary geometry, quality/structure measurements, normalized-image hash and runtime version.

**Narration:** "OpenCV finds contours, approximates document corners, normalizes perspective and measures blur, contrast, glare, edge density and line structure. A perceptual fingerprint helps identify prior visually similar evidence. The agent records the image hash, measured values, declared thresholds and precise next action. On a clear single document, the resulting route is REQUEST_FIELD_EXTRACTION. That's a request for a downstream step and human verification, never an invoice approval."

**Screen caption:** Browser footage: OpenCV 4.13 development. Separate [source-proof run](https://github.com/woahwhattheheck/public-commons-sprint-2026/actions/runs/37894218836): OpenCV 5.0.0, hosted Linux x86-64 synthetic evaluation. AWS arm64 remains pending.

## 1:10–1:50 — Unusable evidence branches

**Visual:** Blur/glare synthetic variants, then ambiguous multi-document image. Show action and reason changes on the real UI; do not spoof the values.

**Narration:** "Now the same engine sees a blurry or glare-obscured image. Its measurements cross a quality gate, so it asks for a recapture. In a picture containing more than one document, the boundary isn't safely unique. Instead of inventing an answer, it requests a human crop. The quality evidence is causal: changing the pixels changes the workflow."

**Screen caption:** REQUEST_RECAPTURE / REQUEST_HUMAN_CROP.

## 1:50–2:40 — Human crop, original pixels and replay

**Visual:** Real browser recording of selection rectangle, numeric edge fields, reason and confirmation, recomputed crop action, ZIP download. Select the proven original-pixel rectangle: left 40, top 90, right 800, bottom 1140 (760 x 1050 pixels).

**Narration:** "Here the operator selects one document using original-image coordinates, gives a reason and confirms the crop. VisualLedger replays the source decision before evaluating the crop with exactly the same policy. With this synthetic example, the route changes from REQUEST_HUMAN_CROP to REQUEST_FIELD_EXTRACTION. The exported ZIP keeps original bytes, the cropped pixels, both independent traces, the rectangle and prior fingerprint context. Independent replay can detect a changed image, wrong rectangle or stale case."

**Screen caption:** Original pixels preserved. Human assertion is not issuer authentication.

## 2:40–3:15 — Duplicate review and tamper resistance

**Visual:** Authentic synthetic prior-fingerprint example from source/replay workflow, if present in recordings. If absent, capture a real execution or show the already-existing source/API and correctly label it as implementation rather than recorded live behavior.

**Narration:** "The fourth route is duplicate review. A similarity fingerprint supplied from bounded previous evidence sends a possible repeat to quarantine for a person to inspect. It does not prove duplicate payment or fraud. Deterministic receipts make pixel or trace changes detectable, while authenticated AWS retained records use a separate HMAC seal before previously stored evidence can influence a later decision."

**Screen caption:** Similarity is a review trigger, not a payment verdict.

## 3:15–4:05 — AWS design and measured boundary

**Visual:** Architecture diagram from the report or source SAM template, clearly stamped 'DESIGN / NOT LIVE DEPLOYMENT'. If a separate verified AWS/OpenCV5 receipt arrives before recording, substitute its exact event/metrics, version and source hash; do not estimate.

**Narration:** "The production design begins with a versioned S3 object. An arm64 Lambda container would run the vision engine, and DynamoDB would retain scope-bound, generation-bound event records for idempotency and repeat detection. The source checks record integrity, authentication and the exact object version; missing evidence fails closed. A separate verified GitHub Actions source run actually executed OpenCV 5.0.0 on hosted Linux x86-64 and passed the synthetic evaluations. But that is not a deployed AWS arm64 transaction, an AWS latency measurement or a customer benchmark. The remaining hosted deployment proof is pending."

**Screen caption:** AWS/OpenCV 5 deployment evidence pending until independently verified.

## 4:05–4:35 — Trust boundary and next step

**Visual:** Final route table and operator controls; provenance URLs for code/recorded synthetic run.

**Narration:** "VisualLedger connects visual measurements to safe, explainable next steps, with a human at every consequential boundary. It can't sign a document, judge whether a vendor is genuine, move money or contact anyone. The public code, synthetic browser walkthrough and genuine Linux OpenCV 5 source-proof receipt are available for review. The remaining milestone is a deployed arm64 OpenCV 5 and AWS event receipt with measured behavior, plus a finished narrated demo and actual organizer submission."

**End slate:** Source link; documented evidence run; current verification limits; official contest deadline.

## Production acceptance before rendering final film

- Capture only actual UI/action transitions and link each shot to its trace. Use the [source and run](https://github.com/woahwhattheheck/public-commons-sprint-2026/actions/runs/37894218628); do not treat the successful CI clip as narration.
- Preserve the expiring Actions artifact and record SHA-256 of the downloaded ZIP and extracted video before editing. Keep original evidence for auditors.
- Reconcile whether the duplicate shot exists. If missing, record it; do not generate a simulated trace or invent a passing branch.
- The hosted Linux x86-64 OpenCV 5 source-proof receipt is already confirmed in [run 37894218836](https://github.com/woahwhattheheck/public-commons-sprint-2026/actions/runs/37894218836). If a distinct live arm64/AWS event receipt arrives, amend the script with its exact source, measurements and runtime. Otherwise retain the 'AWS design only' label.
- Export one finished film at or under five minutes, inspect sound, image, captions, runtime-label visibility and link permission; record its actual bytes/hash and final URL. The current script alone does not meet the official final-video requirement.

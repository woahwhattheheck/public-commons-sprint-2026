# OrchardCue — evidence-first orchard fruit imaging

**Original OpenCV AI Competition 2026 / AWS concept; NOT a Devpost submission.** A camera still is analyzed by a conservative **red-fruit-like-region detector** with an ArUco scale marker. The operator receives a count of visual candidates, pixel locations, approximate marker-plane diameters, capture-quality issues, an annotated PNG and an audit JSON. The next action is always **operator review or retake**; the software never decides yield, fruit ripeness, pesticide application, treatment, or any irreversible operation.

The entire offline demo works without cloud credentials, external datasets, images from third parties or an LLM. It is intentionally a falsifiable starting point, **not a model validated in an orchard**. Green/yellow fruit, shade, occlusion, and touching blobs cannot be assumed detected. Red blobs are not guaranteed to be fruit. Millimeter estimates only apply if the marker and candidate are coplanar; absent a marker or duplicate ArUco id 23 markers, dimensional output is suppressed. Duplicate IDs produce `SCALE_MARKER_AMBIGUOUS` and require human review rather than selecting an arbitrary marker scale. These are explicit engineering limitations, not fixed with fictional confidence scores.

## Local demo (Python 3.11+, NumPy, OpenCV with aruco)

```bash
python -m pip install "numpy>=1.26" "opencv-contrib-python>=4.10"
python fixture.py
python cli.py demo-inputs/good.png --output review-good
python cli.py demo-inputs/blur.png --output review-blur
python cli.py demo-inputs/no-marker.png --output review-noref
# Open review-good/index.html in a browser; inspect overlay.png and report.json
python check_focused.py       # one small synthetic acceptance check; not a full test suite
```

**OpenCV 5:** current cloud fixture was run with OpenCV 4.13.0 + NumPy 2.3.5, NOT OpenCV 5. Before entering the official 2026 competition, run with a publicly available OpenCV 5 build (including aruco), collect exact version/build hashes and real image results. This demo does not claim the OpenCV 5 contest requirement is already met.

## Evidence and agentic action contract

`schema=orchardcue-review/1` contains input SHA-256, exact dimensions, ArUco id 23 scale geometry, RGB-to-HSV red mask & contour geometry, blur/glare/brightness diagnostics, visual candidates, limitation notes, and one of three actions:

- `RETAKE_REQUIRED`: blur, severe glare, or underexposure; request a new image and **do not decide orchard state**.
- `HUMAN_REVIEW_REQUIRED`: marker missing, ambiguous/touching red objects, or zero candidates; review and verify scale.
  When the same ID 23 is detected twice, review must request a single-marker recapture rather than choosing a physical scale. Pixel-only candidate positions remain available.
- `READY_FOR_OPERATOR_REVIEW`: quality gates pass and six synthetic red objects were localized; human still confirms.

Every action includes `human_confirmation_required=true`. The static HTML shows the same provenance and annotated capture and provides the JSON, with **no browser-upload service and no silent network calls**.

## Cloud integration boundary

`aws_lambda.py` illustrates a deliberately narrow S3 ObjectCreated → Lambda → separate **review bucket** path, with single-event check, allowlisted source bucket, max 8 MiB image, PNG/JPEG-only key, SHA-deduplicated review prefix, and JSON+PNG outputs. Deployers must provision restricted AWS IAM, S3 notifications, a pinned OpenCV/NumPy Lambda layer or container, runtime limits, and cost alarms. It has **not** been deployed or exercised against real AWS; no hosted endpoint or paid API call is claimed. Provider-backed data/capture, evaluation metrics (false positives, miss rate, marker errors), OpenCV 5 build and ≤3-minute verified demo must precede any competition entry.

## Prize route and remaining gate

Organizer: [OpenCV AI Competition 2026, powered by AWS](https://opencv26.devpost.com/rules), deadline **October 26, 2026 at 11:45 pm PDT**, overall $5k/$3k/$2k awards and separate $1k agentic/COOL specials under their own rubrics. Cash **only if selected and verified**; this source is neither registered nor submitted. Original entrant must verify rules/eligibility, independently demonstrate real OpenCV 5 and AWS, capture a field-safe/rights-cleared demo, write Devpost report, and submit before deadline. This new subtree does not reuse or claim another team's existing entries.

## Implementation choices

The image-size guard limits memory, an ArUco 4x4 marker 23 provides approximate scale, the mask isolates a narrow red HSV hue band (0–12 or 170–179) with saturation/value floors, 5×5 morphology and contour circle/aspect checks identify *candidate* regions, and a per-image quality controller gates review. No uncalibrated physical units, biological diagnosis, or yield extrapolation. The synthetic fixture has exactly six separated red objects with a known marker and separate blur/glare/marker-missing cases.

MIT license for this original source. OpenCV / NumPy remain separately licensed third-party dependencies; no proprietary media are bundled.

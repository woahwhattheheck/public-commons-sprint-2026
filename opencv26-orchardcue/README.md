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

## Red-candidate focus guard (offline, synthetic evidence)

A globally sharp marker or background can conceal *locally blurred red candidates*.
The focus check now reports `quality.red_candidate_median_laplacian_variance`
from six-pixel-padded bounding boxes around detected candidate regions, and
requests `FRUIT_ROI_BLUR_RETAKE` when this median is below **60.0**. The original
whole-image blur, exposure, glare, marker, and operator-confirmation gates remain.

A single focused check, `python focused_red_roi_blur.py`, generated a sharp-background
pair from `fixture.py`: six sharp red objects stayed READY_FOR_OPERATOR_REVIEW,
while six locally blurred objects were sent to RETAKE_REQUIRED. Global focus
remained above its original 22.0 threshold for both. This threshold and pair
are **synthetic-only screening evidence**, not field-calibrated diagnostic accuracy
or official OpenCV 5 / AWS performance. Real orchard validation is still required.

## Evidence and agentic action contract

`schema=orchardcue-review/1` contains input SHA-256, exact dimensions, ArUco id 23 scale geometry, RGB-to-HSV red mask & contour geometry, blur/glare/brightness diagnostics, visual candidates, limitation notes, and one of three actions:

- `RETAKE_REQUIRED`: blur, severe glare, or underexposure; request a new image and **do not decide orchard state**.
- `HUMAN_REVIEW_REQUIRED`: marker missing, ambiguous/touching red objects, or zero candidates; review and verify scale.
  When the same ID 23 is detected twice, review must request a single-marker recapture rather than choosing a physical scale. Pixel-only candidate positions remain available.
- `READY_FOR_OPERATOR_REVIEW`: quality gates pass and six synthetic red objects were localized; human still confirms.

Every action includes `human_confirmation_required=true`. The static HTML shows the same provenance and annotated capture and provides the JSON, with **no browser-upload service and no silent network calls**.

## Cloud integration boundary

`aws_lambda.py` illustrates a deliberately narrow S3 ObjectCreated → Lambda → separate **review bucket** path, with single-event check, allowlisted source bucket, max 8 MiB image, PNG/JPEG-only key, SHA-deduplicated review prefix, and JSON+PNG outputs. Deployers must provision restricted AWS IAM, S3 notifications, a pinned OpenCV/NumPy Lambda layer or container, runtime limits, and cost alarms. It has **not** been deployed or exercised against real AWS; no hosted endpoint or paid API call is claimed. Provider-backed data/capture, evaluation metrics (false positives, miss rate, marker errors), OpenCV 5 build and ≤3-minute verified demo must precede any competition entry.

### Conservative marker geometry scale gate

A detected ArUco ID 23 is **not** enough to justify a physical-unit estimate: the corner geometry must also be sufficiently square in the image (each edge at least 30 px, longest/shortest edge at most 1.30, and adjacent-edge normalized dot magnitude at most 0.32). A strongly foreshortened, sheared or degenerate tag emits `SCALE_MARKER_GEOMETRY_UNRELIABLE`; visual candidate counts/positions stay available for human review, but all `approx_diameter_mm` fields are suppressed. The existing missing-marker reason remains distinct. This is a fail-closed two-dimensional quality heuristic, **not** a perspective correction, field calibration, proof of fruit/tag coplanarity or biological accuracy metric. The three-case synthetic focused regression uses OpenCV 4.13, not OpenCV 5.

## Prize route and remaining gate

Organizer: [OpenCV AI Competition 2026, powered by AWS](https://opencv26.devpost.com/rules), deadline **October 26, 2026 at 11:45 pm PDT**, overall $5k/$3k/$2k awards and separate $1k agentic/COOL specials under their own rubrics. Cash **only if selected and verified**; this source is neither registered nor submitted. Original entrant must verify rules/eligibility, independently demonstrate real OpenCV 5 and AWS, capture a field-safe/rights-cleared demo, write Devpost report, and submit before deadline. This new subtree does not reuse or claim another team's existing entries.

## Implementation choices

The image-size guard limits memory, an ArUco 4x4 marker 23 provides approximate scale, the mask isolates a narrow red HSV hue band (0–12 or 170–179) with saturation/value floors, 5×5 morphology and contour circle/aspect checks identify *candidate* regions, and a per-image quality controller gates review. No uncalibrated physical units, biological diagnosis, or yield extrapolation. The synthetic fixture has exactly six separated red objects with a known marker and separate blur/glare/marker-missing cases.

MIT license for this original source. OpenCV / NumPy remain separately licensed third-party dependencies; no proprietary media are bundled.

## Version-pinned AWS review receipts (optional Lambda adapter)

The optional S3 adapter **requires versioning on the input bucket** and an `ObjectCreated:*` notification whose `s3.object.versionId` names the exact source object version. It rejects unversioned events rather than fetching whatever happens to be latest at that key. `GetObject` pins `VersionId`, checks the returned version and content length (8 MB max), and binds the input byte SHA-256 into every review JSON receipt. Before enabling Lambda, configure authorized least-privilege `s3:GetObjectVersion` on the allowlisted source bucket and `s3:GetObject`/`s3:PutObject` on the separate, private review bucket; configure event notification, IAM, runtime and costs explicitly. None are provisioned here.

Evidence goes to `operator-review/v1/<SHA-256 of bucket/key/version/content identity>/` (not the older content-only path); `report.json` and `overlay.png` use conditional create, and duplicate notifications verify exact previously stored bytes rather than overwrite. Source-version A and B produce different evidence keys even if their image bytes are identical. `receipt_status` is `CREATED`, `ALREADY_IDENTICAL`, or `RECOVERED_PARTIAL`. If an existing object differs, the run fails closed and preserves prior evidence. The two objects are not transactionally atomic; a partial upload is repaired on exact replay. Retain the private output bucket and any existing old-version review evidence.

Run **one focused local fake-S3 check**: `python focused_versioned_s3_check.py`. This is a synthetic S3 provenance check only, not an OpenCV 5/real camera validation, AWS integration result, or competition submission.

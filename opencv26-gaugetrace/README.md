# GaugeTrace — visual dial observation with a human decision boundary

**Status:** Working-source prototype for OpenCV AI Competition 2026; not registered, not field calibrated, not deployed to AWS, and not submitted. The included images are synthetic illustrations, **not measured instrument data**.

This is a physical-AI inspection aid for analog circular dial gauges in plant rooms and workshops. An image is localized with OpenCV Hough circles, checked for focus and saturation, converted into a polar radial-intensity map, and scanned for a plausible dial needle. The calibrated sweep projects the estimated angle to a dial value. A runner-up ray can cause a deliberate ambiguity abstention. The program ALWAYS asks an operator to inspect the overlay: it does not trigger plant equipment, certify compliance, or declare a gauge safe.

## Run with OpenCV 5

Use a Python environment with **OpenCV 5** and NumPy (the challenge requires OpenCV 5). Packaging of OpenCV 5 for your target environment is an operator/deployment prerequisite.

    python -m pip install 'opencv-python-headless>=5,<6' 'numpy>=2,<3'
    python demo_fixture.py --out sample-data
    python gaugetrace.py --image sample-data/gauge-normal.png --config sample-data/calibration.json --json sample-data/reading.json --overlay sample-data/review.png
    python gaugetrace.py --image sample-data/gauge-ambiguous.png --config sample-data/calibration.json --json sample-data/ambiguous.json --overlay sample-data/ambiguous-review.png

A nonzero exit status (2) is a deliberate abstention/retake request. The synthetic normal fixture should return OPERATOR_CONFIRMATION_REQUIRED, **not** automatic PASS. The local smoke check is one optional, focused source acceptance command; it is not field validation:

    python focused_check.py

Calibration JSON specifies start_deg, end_deg, min_value, max_value, units, and optionally fixed center_px and radius_px for a fixed camera. Angles use image coordinates: 0 degrees points right, 90 degrees points down, and angles increase clockwise. The example 135→405 represents a clockwise 270-degree sweep from lower-left around the top to lower-right. Use a site-approved reference photograph and known physical readings to establish REAL calibration; a synthetic file is not calibration.

### Observed evidence

The JSON output exposes the observation schema, estimated dial value or null, decision, reason, circular ROI, Laplacian image-detail metric, near-white clipping fraction, directional needle contrast and second-best separation. Raw photos are not embedded in JSON. The optional overlay makes the inferred ray and review boundary visible. A failed circle, low detail, bright clipping, low needle contrast, competing directions or outside-calibration needle produces RETAKE_OR_REVIEW.

**Limitations:** Mechanical needle thickness, lens perspective, printed legends inside the radial region, bent glass, reflected needle shadows and lighting all affect results. Hough circle localization is an approximation, not a perspective-corrected metrology measurement. Numeric estimates need instrument-specific test images, a physical reference, and documented error bars before any operational use. Never use in safety-critical automatic control.

## Actual AWS component (deployment pending)

The included aws_lambda.py implements the *real S3 event → OpenCV observation → S3 review packet* runtime adapter, not just an architectural diagram:

    Private S3 gauge-input/ object
        -> S3 ObjectCreated event
        -> AWS Lambda image/container with Python, NumPy and OpenCV 5
        -> gauge-review/reports/ JSON + gauge-review/overlays/ PNG
        -> authenticated human reviewer (manual decision only)

Create an AWS Lambda container image built against your chosen OpenCV 5 distribution and a Python 3.12 Lambda runtime. Make aws_lambda.handler the handler. Subscribe only the private input bucket gauge-input/ prefix for ObjectCreated events. Configure GAUGE_OUTPUT_BUCKET, GAUGE_INPUT_PREFIX (default gauge-input/), and GAUGE_CALIBRATION_JSON (site-specific validated JSON). Grant Lambda only S3 GetObject on the input prefix and PutObject on gauge-review/reports/ and gauge-review/overlays/ in the chosen output bucket. Block public access and apply server-side encryption, lifecycle limits and restricted operator access. Configure one input record per invocation; retries may overwrite identical derived object keys and should not dispatch physical actions.

The handler rejects unsupported objects, invalid prefixes, oversized photos and inconsistent event types. It never records an approval, safety certification, or payout; the output remains pending human review. The runtime itself has not been deployed or exercised against real AWS in this branch, so do not imply AWS usage is proven until a provider receipt exists.

## OpenCV26 judging and entry gap

Official challenge: https://opencv26.devpost.com/ — final project deadline October 26, 2026, 11:59 PM Pacific; substantive OpenCV 5 analysis and a meaningful AWS component are required. This prototype has genuine OpenCV processing and an AWS execution adapter in source; remaining gates are a reproducible OpenCV-5 AWS deployment, photo-based accuracy evaluation, real screenshots/video, technical report, operator registration and the Devpost submission. **No prize claim is made.**

Suggested 2–3 minute truthful demonstration: show known-value synthetic fixture and calibration; run the CLI; highlight the detected ray and human-confirmation state; introduce a competing needle to demonstrate abstention; then run one actual image through the deployed AWS container and show the private S3 JSON + overlay alongside Lambda logs. Omit the final AWS scene unless it has actually run.

## Isolation

This directory is independent of fleet OpenCV26 DrainGuard (drains), PalletGap (warehouse aisles), OrchardCue (fruit imaging) and ThermoLoom (solar thermal anomalies). It does not alter those submissions.

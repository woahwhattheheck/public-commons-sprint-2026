# ThermoLoom — PV grayscale anomaly triage

Original OpenCV AI Competition 2026 / AWS source prototype. **Not entered, deployed, calibrated, safety-certified, or awarded.** A synthetic-only vision workflow identifies unusual regions in an operator-specified grid of solar-panel grayscale images, creates localized review evidence, and routes the result to human review, recapture, or monitor. It does **not** estimate temperatures, electrical damage, fire risk, or the economic value of repairs. No autonomous switching/repair is performed.

## Why vision and agency matter

A panel array may have many apparent bright spots from glare, reflections, exposure and faulty alignment. Most naive threshold-based systems would automatically call those defects. ThermoLoom *refuses a decision on compromised inputs*, rectifies a user-provided perspective quadrilateral if present, compares candidate regions against the rest of the array rather than using an absolute color/temperature threshold, and produces three explicit next-action states:

| Decision | Evidence | Operator action |
| --- | --- | --- |
| `RETAKE` | Low dynamic range, clipping, insufficient resolution, or invalid alignment | Get a higher-quality grayscale capture; no defect conclusion |
| `HUMAN_REVIEW` | Local connected region above peer-relative pixel baseline | Inspect annotated region and confirm with qualified instruments |
| `MONITOR` | No detected peer-relative outlier | Keep monitoring; not a certification of safety |

Every receipt is anchored to the source pixel content, grid dimensions, and protocol revision; grid cells, thresholds, connected components, and coordinates are inspectable. A JSON overlay can be rendered locally. Grayscale intensity is **not** thermometry; thermal camera field calibration and environmental metadata would be necessary for real-world defect attribution.

## Architecture

```text
Private operator grayscale image (.png, 8/16bit)
                 |
          S3 images/*.png
                 |
           Lambda Python 3.12
         OpenCV 5 + NumPy
        geometry/quality gate
                 |
       robust peer panel baseline
        morphology + components
                 |
         JSON S3 reviews/<sha>.json
                 |
     Operator's human-review/retake workflow
```

The SAM template implements a real AWS S3 object-created → Lambda CPU vision → separately protected S3 review receipt flow. `reviews/<sha>.json` keys derive from event/source content for repeatable outputs; **AWS at-least-once delivery is not exactly-once execution** and downstream operators should deduplicate on `id`. The system writes only reports, not electrical controls. Buckets block public access. Source-only delivery does not prove deployed AWS functionality, IAM integration, or latency.

## Run locally

Use Python 3.12+; install `pip install -r requirements.txt` (the PyPI headless OpenCV 5.0.0.93 release). For the synthetic-only smoke proof:

```bash
python synthetic_demo.py --out synthetic-output
python thermoloom.py synthetic-output/spot.png --rows 4 --cols 6 --out receipt.json --overlay evidence.png
```

Expected synthetic states: `clean=MONITOR`, `spot=HUMAN_REVIEW` with row 1/col 3, and `flat=RETAKE`. No claimed accuracy on real captures. A real grayscale camera image must pass source rights/privacy and operator validation. For perspective capture, pass `--corners-json corners.json` containing exactly four *image-pixel* coordinates ordered top-left, top-right, bottom-right, bottom-left. Receipts then use rectified-image coordinates, not original-camera coordinates. Combine `--corners-json corners.json --overlay evidence.png` to draw evidence on the same rectified pixels used for scoring. The overlay checks capture identity and refuses mismatched source frames or corner geometry; output overlay coordinates are rectified, not original-camera.

## Opt-in illumination-gradient ablation (synthetic candidate)

The production default remains `--threshold-mode peer` (same historical output, receipt fingerprint and decisions). The separate `--threshold-mode panel` uses each panel's median plus a conservative local median-absolute-deviation cutoff, avoiding a large across-panel gradient raising the global anomaly threshold enough to mask a small region. The opt-in report identifies the mode and records each local cutoff; its fingerprint differs from the original so evidence from two modes cannot overwrite one another.

```bash
python thermoloom.py synthetic-output/spot.png --threshold-mode panel --out local-candidate.json
python test_panel_threshold_focused.py
```

One bounded **synthetic-only** cloud probe used 12 deterministic seeds, eight broad illumination gradients, and clean/spot pairs (96 clean + 96 injected spots): incumbent peer-global localized 51/96 spots, panel-local 96/96, and both modes raised 0/96 alerts on clean synthesized captures. The focused direct-source check used 3 seeds x 4 gradients (12 clean + 12 injected) on **OpenCV 4.13.0**, with peer 4/12 versus panel 12/12 localized and zero clean alerts for both. These are designed cases, not real PV imagery, calibrated thermal results, an official OpenCV 5 evaluation, or estimated deployment accuracy. A real captured-world and OpenCV 5 comparison is required before promoting panel mode to default or claiming competition performance.

## S3 ObjectCreated source identity

The Lambda worker now rejects non-ObjectCreated events and requires an S3 version ID or ETag from the event. Versioned reads request the event's VersionId; if an ETag is present, the S3 IfMatch precondition and a response ETag check prevent a stale event from silently reviewing newer data at the same key. A version mismatch or absent source identity rejects the event before writing a review receipt. ETags are not cryptographic content hashes: bucket versioning is preferred for immutable source identity. AWS processing remains at least once, not exactly once. The four mocked-S3 regression cases use synthetic inputs and do not demonstrate deployed AWS behavior.

## Deploy only with permission

```bash
sam build
sam deploy --guided
# Upload a licensed 8/16-bit grayscale PNG under s3://<InputBucket>/images/
# Human reviews redacted JSON from s3://<ReviewBucket>/reviews/
```

The `template.yaml` defines private input/output buckets and narrowly scoped bucket IAM read/write. Runtime expenses and provider agreement must be authorized before an actual deploy. The AWS Lambda entry uses the same `inspect()` function as the local CLI; no AWS activity occurs in the synthetic demo. S3 receipts may contain source bucket/key metadata, so treat the review bucket as private.

## Exact scope / competing work

This is a distinct *PV-array contrast anomaly* problem from the fleet's NSF/NSO solar-filament instance segmentation, camera-aisle and assembly-fixture OpenCV builds. It does not use that dataset or its competition account. It is not a submitted Devpost entry; original claim remains with the actual authorized future entrant if they submit. The official OpenCV competition requires substantial **OpenCV 5** image processing and meaningful **AWS** operation. Local reproducibility on a different OpenCV major version proves only the named compatibility smoke, not compliance with the required OpenCV 5 runtime.

Official sources: [OpenCV 2026 rules](https://opencv26.devpost.com/rules), [OpenCV 2026 entry](https://opencv26.devpost.com/), [OpenCV 5 Python install](https://docs.opencv.org/5.0/py_tutorials/py_setup/py_pip_install/py_pip_install.html).

License: MIT; no third-party imagery or personal data included.

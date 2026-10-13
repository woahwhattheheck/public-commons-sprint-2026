# Rainfall Release Review

An offline reviewer and public API capture command for rainfall releases. It supports the current 3RWW row and columnar response formats, retains the source response, compares matching observations, and exports a portable review project, a readable HTML report, and CSV tables.

Open **index.html** directly in a browser. It has no installation, external fonts, map key, service worker, analytics, or network dependency. Use Node 20+ only when retrieving data or generating reports from the command line.

## Acquire a real public window

Check the provider's current availability and sensor identifiers first:

    node capture.mjs bounds
    node capture.mjs sensors

Choose a time window inside the returned availability. This example command requires that the provider actually offers that window and sensors:

    node capture.mjs capture --start 2026-07-13T00:00:00Z --end 2026-07-14T00:00:00Z --sensors 1,2 --label "Historical gauge release" --product historic15 --sensor gauge --interval 15 --timestamp-label end --units inches --out captures/historical.json

The source application at commit 1e2d70abec7f7a7ede855cbb9baea15715e03565 requests sensor_columnar results with start_dt, end_dt, rollup, selected gauges/pixels, and delivery=artifact. This command follows that observed current contract. It continues the returned job URL, downloads the finished artifact, refreshes an expired artifact URL once through the same job, and preserves a local continuation file. The original provider documentation includes older API routes; this implementation uses the application's current source.

If an accepted provider job is still running when the command exits:

    node capture.mjs capture --out captures/historical.json --resume yes

The continuation file ends in .job.json and may contain temporary provider job URLs. Keep it local to the acquisition worker. Share the completed rainfall capture, which contains the source response, public endpoint, request parameters, retrieval timestamp, and response hash.

For pixels, specify --sensor pixel and verified pixel IDs. Use --product realtime for a provisional source, historic15 for native historical 15-minute readings, or historic5 with --interval 5 when that service offers the requested window. The command supports 5, 15, and 60 minute review intervals. Daily/total products need calendar-specific comparison and are outside this first implementation.

## Work in the reviewer

1. Load one completed capture to inspect valid coverage and observed rainfall.
2. Load a second capture for the same sensor type, sensor selection, interval, and window. It may be another retrieval or a corresponding provisional/historical product.
3. Select a sensor and switch between all intervals, release changes, and missing/invalid intervals.
4. Write the operational interpretation in Reviewer notes.
5. Export the HTML report and CSV. Save the review project to retain both original responses and the notes.
6. Clear the reviewer and reopen that project to continue the same review.

The UI accepts files up to 40 MB. Review windows are limited to one million selected sensor intervals to keep an ordinary browser usable; split longer programmes into separate review windows.

## Time and scientific meaning

The capture metadata explicitly specifies the accumulation window's start and end, the interval length, units, and whether provider timestamps label the interval start, interval end, or an explicit start/end range. With end labels, expected observations are (start, end], one per interval. Start labels are shifted to their interval end. Explicit ranges must have the selected interval length.

All timestamps must contain a UTC offset or Z. The software will not silently interpret an ambiguous local time using the operator's browser timezone. Original timestamp strings remain in the capture; comparison normalizes instants to UTC. Millimetres are converted to inches using 25.4 mm/in.

Zero is a valid observation. Null, blank, negative, nonnumeric, and absent observations remain separate categories. The source codes G-0 and N/D indicate unavailable observations and are excluded even when a numeric placeholder is present. Unknown source codes are retained and flagged for interpretation. Identical duplicate observations count once; conflicting duplicates stop review so the source conflict can be resolved.

Observed totals sum valid observations. They are incomplete when valid coverage is below 100%. A release's total is never padded with invented zeros. Comparisons calculate deltas only across intervals valid in both releases, and count recovered/lost observations separately. Percentage change is absent when the matched earlier total is zero.

The chart coarsens long windows for display. A display interval containing a missing original reading stays a gap. Tables and CSV retain original interval precision.

## Command-line reports

    node capture.mjs review --before captures/provisional.json --after captures/historical.json --out review

The second capture is optional. Add --notes notes.txt to include working notes. Outputs:

- review-project.json — original releases and editable notes; reopen in index.html.
- report.html — standalone printable review.
- summary.json — machine-readable coverage, source information, and comparison.
- release-1-coverage.csv and release-2-coverage.csv — per-sensor coverage.
- interval-comparison.csv — every aligned interval when comparing two releases.

## Capture format

schema is rainfall-release/v1. metadata contains label, product, sensor_type, sensors, start, end, interval_minutes, units, timestamp_label, retrieved_at, and source_url. raw_text is the exact UTF-8 API response text. raw_sha256 binds that text.

Response data can contain sensor groups with row objects or equal-length columnar arrays, plus historic5 point rows using rainfall. A valid result has status=finished and an array-valued data field.

## Source and receiving

See SOURCES.md for the exact first-party code and service references. The working implementation is original code; it reads the provider's response contract rather than embedding its application.

The focused core exercise covered zero/null/absent readings, columnar intake, UTC-offset alignment, changed source/value, recovered intervals, project reopening, malformed columns, conflicting date/hash cases, and HTML escaping. These checks run the actual core; they do not establish live-service or rendered-product acceptance.

Before any prospect-facing delivery, the final producing worker must open the exact outgoing index.html, load the actual public capture, operate the controls at desktop and 390 px widths, open the exported report, and clear/reopen the project. The worker must actually view those rendered results and repair defects. The retained AGENTS.md carries the owner's full requirement. Record the exact delivered source and inspected files in RECEIVING.md after doing this work.

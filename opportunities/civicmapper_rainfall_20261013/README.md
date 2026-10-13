# Rainfall Release Review

An offline reviewer and public API capture command for rainfall releases. It supports the current 3RWW row and columnar response formats, retains the source response, compares matching observations, and exports a portable review project, a readable HTML report, and CSV tables.

Open **index.html** directly in a browser. It has no installation, external fonts, map key, service worker, analytics, or network dependency. Use Node 20+ only when retrieving data or generating reports from the command line.

## Inspect and retain station selection

Open **catalogue.html** to compare the pinned application catalogue with the complete publisher response retained on October 13. The page preserves every source record, including inactive records, repeated identifiers and records without a query ID. Search or filter the record table, inspect exact original features, choose current active query IDs, and save/reopen the source review with your notes. Export the readable report, complete source records CSV, or request selection.

The provider request uses `web_id`. The reference source stores that role as top-level `feature.id`; the current provider stores it as `properties.web_id` and uses `feature.id` for a different record identifier. External IDs are also reused across several current records. The comparison pairs unique (query ID, external ID) records and retains other candidates separately.

A request selection retains the complete catalogue text, exact source identity, chosen active features and inactive alternatives. Add it to a new capture with `--selection gauge-request-selection.json` and use the same IDs in `--sensors`. The command validates both selections before requesting data. Resume preserves the original job's selection.

These catalogues give current identity at retrieval. They contain no validity dates establishing which physical instrument represented an earlier rainfall interval. Historical results keep their original query IDs; the reviewer does not silently remap them to a different site. When both rainfall acquisitions have catalogue context, their comparison shows changed identity fields alongside the query-series comparison.

## Package the actual source example

    node catalogue_report.mjs --project source/20261013/gauge-catalogue-project.json --out /new/source-handover

Open `OPEN_FIRST.html` in the generated directory. The complete source handover includes the editable catalogue review, source report, original GeoJSON, all-record CSV, saved project, current selection, exact file manifest, complete editable application source and `gauge-catalogue-handover.zip`. It works independently of any rainfall request. `--notes FILE` and `--select 1,2` can set the working notes and current query selection.

Run the same maintained browser course against either the application or that generated directory:

    node receive_handover.mjs --catalogue /new/source-handover --out /new/source-receiving

The producer opens and personally views the exact pages, screenshots and downloaded attachments; the course operates the controls, exports and fresh-context reopening.

## Acquire a real public window

Check the provider's current availability and sensor identifiers first:

    node capture.mjs bounds
    node capture.mjs sensors

Choose a time window inside the returned availability. This example command requires that the provider actually offers that window and sensors:

    node capture.mjs capture --start 2026-07-13T00:00:00Z --end 2026-07-14T00:00:00Z --sensors 1,2 --label "Historical gauge release" --product historic15 --sensor gauge --interval 15 --timestamp-label end --units inches --out captures/historical.json

The source application at commit 1e2d70abec7f7a7ede855cbb9baea15715e03565 requests sensor_columnar results with start_dt, end_dt, rollup, selected gauges/pixels, and delivery=artifact. This command follows that observed current contract. It continues the returned job URL, downloads the finished artifact, refreshes an expired artifact URL once through the same job, and preserves a local continuation file. The original provider documentation includes older API routes; this implementation uses the application's current source.

If an accepted provider job is still running when the command exits:

    node capture.mjs capture --out captures/historical.json --resume yes

The continuation file ends in .job.json. Resume first reopens an existing matching completed capture, without making another provider request. If a response was saved immediately before an interruption, resume verifies its sequence and exact body hash and recovers the same job continuation or already downloaded artifact. It does not overwrite a completed output. Restore a missing completed source from its original saved copy before continuing.

The job and completed capture retain the original acquisition history: requests, complete response and error bodies, HTTP status, selected headers, retrieval timestamps, byte counts and SHA-256 values. Response bytes are the decoded body returned by fetch, not compressed HTTP wire bytes. The history can include temporary provider job, artifact and inline URLs. It travels with the completed capture and saved review project; retain that complete original packet when transferring the work. Transport failure before a usable provider response may leave the provider's acceptance unknown; the history records that actual failure and does not establish a completed job.

The real source snapshot in source/20261013/publisher-selection.json contains the full availability and gauge responses retrieved on October 13, with exact byte identities. At that observation the native historical 15-minute gauge service covered April 1, 2000 through August 31, 2026, so the July command above was inside the returned global product bounds. Those bounds do not establish per-gauge operating history. At that catalogue retrieval, query ID 1 has an active record named PWSA (Observatory Hill), and query ID 2 has one named Alcosan. They are not the GeoJSON feature.id values. Check current bounds for a new selection. The snapshot qualifies the original request; it is not a completed rainfall result.

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

The configured capture defaults to interval-end labels for native 5/15-minute results and explicit start/end ranges for Hourly results, following the pinned application's current contract. It rejects a conflicting configured label. The generic file importer also supports explicitly declared start-labelled inputs.

The capture metadata explicitly specifies the accumulation window's start and end, the interval length, units, and whether provider timestamps label the interval start, interval end, or an explicit start/end range. With end labels, expected observations are (start, end], one per interval. Start labels are shifted to their interval end. Explicit ranges must have the selected interval length.

The example midnight-to-midnight UTC request corresponds to July 12 at 8 p.m. through July 13 at 8 p.m. in America/New_York. It is a 24-hour UTC window, not a July 13 local calendar day. A new local-day request would use July 13 04:00Z through July 14 04:00Z; never change the saved original request. The cards and report show exact UTC and source-local bounds.

All timestamps must contain a UTC offset or Z. The software will not silently interpret an ambiguous local time using the operator's browser timezone. Original timestamp strings remain in the capture; comparison normalizes instants to UTC. The configured 3RWW capture command records its provider values as inches and rejects a request to relabel them. Generic imported releases may explicitly use millimetres, which are converted to inches using 25.4 mm/in.

Zero is a valid observation. Null, blank, negative, nonnumeric, and absent observations remain separate categories. The source codes G-0 and N/D indicate unavailable observations and are excluded even when a numeric placeholder is present. Unknown source codes are retained and flagged for interpretation. Identical duplicate observations count once; conflicting duplicates stop review so the source conflict can be resolved.

Empty row and empty columnar sensor results both produce absent intervals and a null observed total. Hourly coverage counts returned hourly records; it does not establish completeness of underlying native readings.

Observed totals sum valid observations. They are incomplete when valid coverage is below 100%. A release's total is never padded with invented zeros. Comparisons calculate deltas only across intervals valid in both releases, and count recovered/lost observations separately. Percentage change is absent when the matched earlier total is zero.

The chart coarsens long windows for display. A display interval containing a missing original reading stays a gap. Tables and CSV retain original interval precision.

## Command-line reports

    node capture.mjs review --before captures/provisional.json --after captures/historical.json --out review

The second capture is optional. Add --notes notes.txt to include working notes. Outputs:

- review-project.json — original releases and editable notes; reopen in index.html.
- report.html — standalone printable review.
- summary.json — machine-readable coverage, source information, and comparison.
- release-1-coverage.csv and release-2-coverage.csv — per-sensor coverage.
- release-N-intervals.csv — each original interval, including explicit absent intervals, original values/timestamps and source codes.
- interval-comparison.csv — every aligned interval when comparing two releases.

## Capture format

schema is rainfall-release/v1. metadata contains label, product, sensor_type, sensors, start, end, interval_minutes, units, timestamp_label, retrieved_at, and source_url. raw_text is the exact UTF-8 API response text. raw_sha256 binds that text. Optional request and acquisition fields retain the complete original selection and acquisition history through normalization, project save and reopening.

Response data can contain sensor groups with row objects or equal-length columnar arrays, plus historic5 point rows using rainfall. A valid result has status=finished and an array-valued data field.

## Source and receiving

See SOURCES.md for the exact first-party code and service references. The working implementation is original code; it reads the provider's response contract rather than embedding its application.

The focused core exercise covered zero/null/absent readings, columnar intake, UTC-offset alignment, changed source/value, recovered intervals, project reopening, malformed columns, conflicting date/hash cases, and HTML escaping. These checks run the actual core; they do not establish live-service or rendered-product acceptance.

Before any prospect-facing delivery, the final producing worker must open the exact outgoing index.html, load the actual public capture, operate the controls at desktop and 390 px widths, open the exported report, and clear/reopen the project. The worker must actually view those rendered results and repair defects. The retained AGENTS.md carries the owner's full requirement. Record the exact delivered source and inspected files in RECEIVING.md after doing this work.

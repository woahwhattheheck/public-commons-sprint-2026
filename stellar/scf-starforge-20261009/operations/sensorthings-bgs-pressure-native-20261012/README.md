# BGS retained pressure window for the original SensorThings analysis

This package retains a complete, separately selected **scalar numeric source** for the maintained SensorThings and Helgoland workflow. The source is British Geological Survey Datastream **1**, **GGERFS_01 Barometric Pressure**. It is independent of the Hamburg charging-status editions.

## What was actually received

| Item | Retained result |
| --- | --- |
| Public service | `https://sensors.bgs.ac.uk/FROST-Server/v1.1/` |
| Selected query window | 1 June 2026 00:00:00 UTC to 2 June 2026 00:00:00 UTC, end excluded |
| Complete selected observations | 96 distinct observation IDs |
| Returned pages | 64 rows, then 32 rows; final nextLink absent |
| Provider-reported selected count | 96 |
| First / last observed timestamps | 1 June 00:00 / 23:45 UTC |
| Adjacent observed timestamp gaps | 95 gaps of 900 seconds |
| Scalar observation type | OGC OM_Measurement |
| Original unit | Millibar, symbol `mbar`, NERC P06 `UPBB` |
| Observed minimum | 1000.36 mbar; first occurrence at 23:30 UTC, also observed at 23:45 |
| Observed maximum | 1011.42 mbar at 00:00 UTC |
| Opening / closing stream bodies | Byte-identical |
| Actual native edition, review and diagram | Pending the original receiving operation |

The exact original numeric lexemes remain in the complete source bodies. `numeric-window.json` also carries every selected observation as a source-linked record, with decimal result text, explicit original result type, source body SHA, JSON Pointer, exact request URL and source receipt time. Its minimum and maximum are observed point statistics, not interpolated extrema. Ties remain visible in its full row list.

The selected window is historical. The stream metadata's most recent listed phenomenon time is 1 July 2026 07:15 UTC. Capturing that metadata in October does not turn the June observations into current telemetry.

## Original source identity and meaning

The selected source graph includes Thing 8, **BGS GGERFS Barometer**; Sensor 2, **P2TX-BV Barometer**; ObservedProperty 5, **Barometric Pressure**; and Location 11 at the UKGEOS Glasgow Observatory Site 3. The original point coordinates are longitude **-4.2012**, latitude **55.838255**. The publisher notes that XY was estimated from Site 3 borehole coordinates. The packet retains that qualification rather than presenting the location as an independently surveyed sensor position.

The original Thing describes non-telemetered acquisition and names British Geological Survey as provider. The Sensor metadata links its manufacturer product page; the publisher's spelling remains intact. The ObservedProperty's `definition` is an empty string. The unit has its own actual definition URL. No replacement property definition is invented.

Each selected observation includes the original FeatureOfInterest 37 in the expanded response. The two pages, actual continuation URL and complete expanded records are retained. Every selected `resultTime` equals its `phenomenonTime`. No selected row supplies `validTime`.

All 96 selected rows carry the source quality labels `Data Verified (manual check)`, status `9`, quality `Good` and event ID `1559`. These are publisher assertions. They are neither the receiving operator's review nor a calibration certificate, and they do not establish a sample validity interval.

## Source scope and qualification history

The directory preserves **14 complete original bodies** and **14 complete connector receipt documents**. Ten bodies form the one native selected-source recording. Four remain qualification evidence:

| Qualification source | What it establishes | Receiving use |
| --- | --- | --- |
| Hamburg numeric catalogue | The returned numerical candidate is explicitly a test stream, with test metadata | Excluded from the scientific numeric selection |
| Initial BGS three-row catalogue | A real pressure source is available | Retained; the later exact native-encoded catalogue URL is used by the native receiver |
| BGS 30 June one-day query | One returned point in that different selected day | Complete for its own query; excluded from 1 June |
| BGS June-month first page | First 64 of a reported 2,785 records, with continuation present | Partial qualification only; no complete-month claim |

The selected 1 June query is complete across its two exact pages. It is not assembled from the June-month or 30 June qualification requests. The three-row catalogue is a selected page, not an inventory of the whole BGS service.

## Acquisition representation

These originals were received through the declared public-file connector: create an attachment from the exact public source URL, then download its complete UTF-8 text. The original upload and download tool responses are retained in each receipt. Each original body is length- and SHA-bound to its complete download response.

The connector did not expose provider HTTP method, status, response headers or request clocks. Those fields remain unknown. The per-source capture timestamp is the actual clock read after the complete connector download returned. It is distinct from the later native intake clock.

This representation does not establish compressed wire bytes or a simultaneous provider snapshot. A complete returned page and an unchanged metadata bracket have their ordinary source meaning; they do not prove that the provider's database stayed frozen between calls.

## Source and receiving files

- `originals/`: all 14 exact received bodies, including the complete source graph and the four qualification records.
- `receipts/`: all 14 complete connector provenance documents.
- `native-recording.json`: ten exact native-consumable original responses and complete provenance, with repeated stream-URL occurrences retained separately.
- `numeric-window.json`: complete 96-row source-linked numerical selection and bounded summary.
- `recipe.json`: exact original window, source selection, operation IDs and expected source identities.
- `NATIVE_RECEIVING.md`: same-workspace intake, source review, dataset/export and original Helgoland receiving instructions.
- `manifest.json`: complete file inventory and source-role boundary.

The recording is **313,277 bytes**, SHA-256 **e04a3932da707a2a90a68fc87b97c4af72337c09ec5a23f7c072b933a1b855ac**. The maintained entrypoint is `sf30-seller-sdk/sensorthings/receive-bgs.mjs`. It consumes the retained recording using the original native transport, queue, revision checks, source reviews, datasets and exporter. It cannot silently fetch a substitute page.

## Reuse and attribution

The original Thing properties mark this source as unrestricted and state an Open Government Licence with a UKRI acknowledgement. The [government API catalogue](https://www.api.gov.uk/bgs/bgs-sensor-data-service/) independently names the usage licence and published endpoint. Neither this record nor that catalogue supplies a licence version; this package does not infer one.

For these retained 2026 observations, retain the acknowledgement **Contains UKRI materials ©UKRI 2026**. The complete original notice is preserved in `originals/bgs-datastream-1-thing.json` and its receipt. The provider links and original access/quality fields travel with all later source exports. The source-code files in this contribution use their existing MIT licence; that does not replace the upstream data terms.

The [BGS service page](https://sensors.bgs.ac.uk/) describes its sensor and provenance model, and the [BGS API documentation](https://sensors-docs.bgs.ac.uk/) identifies the SensorThings v1.1 API. The selected original records, exact query and retained receipts remain the controlling source for the measurements in this package.

## Current execution state

Source acquisition and the 96-point Functions V8 source calculation are complete. The native Node receiver, original workspace edition, responsible source review, native dataset/export, installed Helgoland numeric diagram and fresh receiving have not been executed for this package. The recording and driver are ready for the existing assigned operation.

The actual Helgoland scalar diagram may use this separate BGS edition after native intake. Hamburg's category codes remain category events in their own editions. An ordinary chart joining pressure points is a visual interpolation, not a source-supplied duration or validity interval; the analyst must keep that choice explicit.

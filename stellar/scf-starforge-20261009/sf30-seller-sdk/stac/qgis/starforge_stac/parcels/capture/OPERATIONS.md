# Capture a complete public parcel refresh

The publisher capture command prepares a new source edition for the existing Parcels workspace. It retains each original public response, its exact SHA-256, requested parcel keys, capture time, response headers and source URL. The original parcel intake owns CSV, JSON and GeoJSON interpretation; the capture adapter uses that same reader.

The installed profile is **Pittsburgh public parcels v1**. It selects the two existing WPRDC City resources, their complete CSV exports, Allegheny County assessment resource and the City's original parcel geometry service. It does not infer legal title, accountable departments, market values or missing geometry.

## Start one named capture

Run from the received QGIS software directory, or use the original package's Python environment with that software directory on its normal module path:

~~~sh
python -m starforge_stac.parcels.capture init \
  --directory /private/parcel-refresh-2026-10 \
  --label "Pittsburgh public parcel refresh — October 2026" \
  --actor "Named operator"
~~~

This freezes a capture ID, profile, label and operator. Repeating the same initialization reopens that capture. Give a later publisher refresh a new directory; a completed capture remains immutable.

The capture directory is separate from the editable QGIS project. Its file journal records only public GET acquisition and durable response objects. Saved parcel editions, named review decisions, portfolios, native layers and the original project request history remain in the original QGIS workspace.

## Advance and resume

~~~sh
python -m starforge_stac.parcels.capture advance \
  --directory /private/parcel-refresh-2026-10 \
  --max-requests 8 --timeout 45

python -m starforge_stac.parcels.capture status \
  --directory /private/parcel-refresh-2026-10
~~~

Each invocation makes at most the selected number of public requests. Successful original responses are reused. If execution ends after a response was retained but before its receipt was published, continuation verifies that retained response and completes its receipt before another GET.

A provider's HTTP 429 or temporary server response produces a retained WAITING result with its actual Retry-After deadline. The process returns; it does not hold a sleeping worker. Continue the same directory after that deadline. An absent or malformed Retry-After uses a bounded increasing delay. HTTP authentication or permission errors, invalid publisher data and an indivisible response exceeding its source limit produce BLOCKED, with the original error and response retained.

After resolving a blocked publisher condition, record the reason and continue:

~~~sh
python -m starforge_stac.parcels.capture retry \
  --directory /private/parcel-refresh-2026-10 \
  --job EXACT_JOB_ID \
  --reason "Publisher returned its complete original schema again."
~~~

A retry cannot shorten a retained provider deadline. If execution stops after saving a WAITING or BLOCKED response but before updating progress, the next status or continuation reconstructs admission from that original response. A later local write failure cannot shorten its Retry-After. An explicit retry applies only to its recorded original attempt. Do not substitute another account, host or endpoint to evade a provider refusal. This public profile sends no credentials or cookies and follows redirects only within its two original HTTPS publisher hosts.

## Coverage and source meaning

The complete City CSVs are retained byte for byte. Their original pin fields form a sorted union of exact 16-character uppercase alphanumeric keys. Blank or invalid keys remain in the source files and are counted explicitly; they are not repaired or discarded from the source.

The eProperties record id remains the publisher's stable record identifier. Several eProperty records may refer to the same parcel. A tax agent remains the publisher's tax-agent assertion. The workflow records County-assessed, local-assessed and base-year 2012 appraisal amounts as their separate source meanings.

The capture requests County and geometry records in bounded selected-key cohorts. Every completed lookup carries requestedPins, matched keys and explicit missing keys. A key with a complete request and no row is NO_MATCH; a key lacking a complete request cannot become a no-match assertion.

When the publisher indicates that a selected response is truncated, the capture retains that response as metadata and divides its selected keys into two smaller original requests. It never stitches incomplete pages into a fabricated original response. A single parcel still exceeding the publisher limit stops for explicit source review.

Geometry requests use the original service's outSR=4326. The receiving descriptor declares EPSG:4326; the original service schema remains retained separately. Missing or null publisher geometry remains visible.

Before and after acquisition, the capture retains original publisher catalogues and the geometry layer description. A change in the selected resource metadata requires an explicit review reason at finalization. These captures document an acquisition interval across independent public publishers; they do not promise a simultaneous database snapshot.

## Produce the existing receiving directory

When status is READY:

~~~sh
python -m starforge_stac.parcels.capture finalize \
  --directory /private/parcel-refresh-2026-10
~~~

If the result reports CAPTURE_PUBLISHER_CHANGED, inspect the retained before/after metadata. To accept that exact interval after review:

~~~sh
python -m starforge_stac.parcels.capture finalize \
  --directory /private/parcel-refresh-2026-10 \
  --accept-publisher-change-reason "Reviewed the original resource dates and retained both publisher versions for this refresh."
~~~

The command validates the completed delivery through the original ParcelIntake before publishing delivery/parcel-source-receiving.json. It returns the receiving directory, exact manifest hash, file and expanded-byte totals, selected-key count and source coverage. Interruption preserves the partial delivery, and continuation verifies each member before completing the same directory. Repeating finalization preserves the same manifest and review reason.

Open the existing analyst console's **Parcels → Sources** pane. Upload that complete delivery directory through its original folder transfer. Run the existing source preview, inspect the original rows and exceptions, and import the exact preview and manifest hash using the original named request and revision.

Use the existing successor comparison to relate this edition to the selected previous edition. Carry only proven unchanged reviews; inspect changed or newly added claims. Preserve original entity versions and distinguish a source owner assertion from a reviewed accountable department. Freeze a portfolio with its explicit assessment and area basis, then publish its normal vector source into the existing Layers and Maps workflow.

The capture tool never changes a saved parcel decision or imports a source behind the operator's review.

## Verify an already retained source without requesting publishers

~~~sh
python -m starforge_stac.parcels.capture verify \
  --directory /private/existing-parcel-source \
  --expected-manifest-sha256 EXACT_SHA256
~~~

This uses the original file hashes and parcel reader, verifies complete selected County and geometry responses, and reports the actual selected-key and no-match counts. It performs no network acquisition. This is the appropriate path for an existing completed source cohort, including an earlier JSON capture and a later full CSV source edition.

## Receiving and recovery

Keep the original capture directory until the completed source directory and its receiving project are preserved through the established approved artifact route. The delivery directory contains all active original source files and the response receipts needed to inspect the source edition. Internal capture attempts and operator retry history stay in the capture directory.

After import, the original QGIS project export carries the immutable parcel edition, exact original source objects, review history, portfolios and projected map geometry. Its independent receiving path validates that whole closure before publishing the received project. The capture module adds no alternate project importer or credentials to that archive.

Current intake bounds remain 10,000 file descriptors, 256 MiB per original source file and 8 GiB of original file bytes. The capture profile bounds the City key union to 100,000 keys and refuses a completed inventory exceeding the original receiving limits. Select native capacity for the complete source, normalized projection, reviewed portfolios and receiving archive using the maintained runtime. A capture command is a bounded source operation; it does not provision compute or start a GIS renderer.

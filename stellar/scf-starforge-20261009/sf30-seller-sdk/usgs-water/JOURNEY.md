# Native USGS Water journey

Run one complete customer workflow from original USGS observations through the
hydrology workspace, an immutable merchant edition, and the original native
buyer. The maintained journey uses the same project, provider, analysis and
merchant modules as the application.

## Run

Use Node 22 or later, Python 3, OpenSSL, and the repository's native x402
dependencies: @x402/core 2.28.0, @x402/stellar 2.28.0, @x402/extensions 2.28.0
and the original buyer's @stellar/stellar-sdk 16.3.0. The seller's existing
native closure also works with its 16.3.1 transitive SDK. Use the existing
repository dependency setup.

From the repository root:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/journey.mjs \
  --directory /absolute/new-water-journey
~~~

Choose a new directory with a canonical absolute parent. The journey retains its
project, source capture, decision, exported edition and native buyer files there.
Its final JSON output identifies result.json and the exported edition.

The repository includes the original four successful USGS responses acquired on
11 October 2026. Repeat the native customer workflow with that bundled source:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/journey.mjs \
  --directory /absolute/new-water-journey \
  --source-bundle stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/examples/usgs-20261001-07.source.json
~~~

A host carrying other original responses for this same selection can use their
exact byte bundle:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/journey.mjs \
  --directory /absolute/new-water-journey \
  --source-bundle /absolute/original-source.json
~~~

The bundle schema is starforge.usgs-water-source-bundle.v1. It contains the
initialUrl and responses array. Each response retains url, status, headers,
receivedAt, bytes, sha256 and bodyBase64 from the original HTTP response. The
journey checks the exact selected query, body length, SHA-256 and every requested
next page. This path feeds those original bytes through the same provider
capture API. The run records its source mode and the complete bundle digest.

## The operation

The selected source is USGS daily mean discharge at USGS-01646500, parameter
00060, statistic 00003, from 1–7 October 2026. A provider page limit of two
exercises the original next links. The source query is:

https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/items?f=json&limit=2&monitoring_location_id=USGS-01646500&parameter_code=00060&statistic_id=00003&time=2026-10-01%2F2026-10-07

The journey acquires the full selection and reopens the same completed capture.
It compares 5–7 October with the 1–3 October baseline, saves a decision that
includes the computed means, and exports HTML, JSON, CSV and GeoJSON.

It then prepares the portable USGS edition and compiles its three routes with
the original SF61 importer. The original SF82 launcher starts the native SF30
merchant against a loopback protocol facilitator. An unsigned request returns
the original 402 challenge.

The original SF88 Node Buyer performs the four paginated observation purchases,
one exact original-source purchase, and one edition-manifest purchase. It
retains its native configuration, reviewed operation, attempt, original response
file and recovery state. Delivered values, units, approval status, full feature
properties and geometry are compared with the source capture.

Finally, the authoring capture moves out of the project and the edition is
copied into exports/water-edition. The edition opens using its own source files,
and each original SF88 purchase reopens with identical retained content.
Source-request and merchant-request counts remain unchanged during reopening.
The original capture then returns to the authoring project so its saved decision
and edition remain available in the browser workspace.

## Open the retained capture directly

examples/usgs-20261001-07.capture.tar.gz contains the completed native capture:
the exact manifest, four original response bodies, and their request/response
records. examples/usgs-20261001-07.capture.json lists every member's byte size
and SHA-256 plus the archive digest. To open the same capture without acquisition:

~~~sh
mkdir -m 700 /absolute/water-capture
tar -xzf stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/examples/usgs-20261001-07.capture.tar.gz \
  -C /absolute/water-capture
~~~

Then call readCapture('/absolute/water-capture/usgs-october-01-07') from
provider.mjs. The archive preserves private directory and file permissions and
the original capture identity.

## Original local commerce fixture

The facilitator methods and local signature payload come from the maintained
sf30-seller-sdk/python/merchant.journey.mjs. Its supported, verify and settle
responses run through the real HTTPFacilitatorClient, createNativeSellerServer,
x402 resource server and Stellar exact scheme.

The POSIX terminal driver follows sf81-buyer-operator-bridge/acceptance.py. It
types the six disposable fixture confirmations into a controlling terminal while
the original SF81, SF62 and SF36 approval and SQLite reservation modules execute.
The journey creates fresh local policy keys and uses the original local
transaction marker.

The original SF88 HTTPS transport reaches the owned merchant through an explicit
SF85 CONNECT endpoint. OpenSSL creates a temporary certificate for the fixed
water-journey.example authority. Only the original buyer child processes receive
that certificate as an additional trusted root. The local CONNECT endpoint
accepts that single authority and carries traffic to the loopback merchant.

## Retained result

result.json contains the actual source URLs and body digests, capture and edition
identities, native dataset snapshot, analysis periods and means, buyer delivery
metadata, local facilitator counts and the exported edition location.

exports contains the four decision reports, the original purchased response
pages, the downloaded source and manifest, and the complete portable edition.
The original capture remains in project/captures/usgs-october-01-07 after the
portable reopening check. An interrupted run
retains failure.json with the operation stage and the local native diagnostics.

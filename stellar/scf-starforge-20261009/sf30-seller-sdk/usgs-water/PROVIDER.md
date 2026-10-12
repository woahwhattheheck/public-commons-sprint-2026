# USGS Water Data source capture

Acquire a selected USGS daily, continuous, monitoring-location or time-series
metadata collection, retain the original response pages, and reopen the same
capture for the merchant edition and customer analysis workflow.

This module uses the maintained SF31 public HTTPS transport and SF85 CONNECT
implementation, together with the existing private-file and Linux flock
primitives from the Routescan operator. The seller, native Stellar payment,
dataset publication and buyer implementations are composed by the surrounding
USGS Water product.

## Current provider contract

Primary sources reviewed on 2026-10-11:

- [USGS OGC API guide](https://api.waterdata.usgs.gov/docs/ogcapi/)
- [Daily schema](https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/schema?f=html)
- [Continuous schema](https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/schema?f=html)
- [Continuous queryable fields, including statistic_id](https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/queryables?f=html)
- [Monitoring-location schema](https://api.waterdata.usgs.gov/ogcapi/v1/collections/monitoring-locations/schema?f=html)
- [Time-series metadata schema](https://api.waterdata.usgs.gov/ogcapi/v1/collections/time-series-metadata/schema?f=json)
- [Efficient requests](https://api.waterdata.usgs.gov/docs/ogcapi/efficiency/)
- [Complex queries and null values](https://api.waterdata.usgs.gov/docs/ogcapi/complex-queries/)
- [API keys and rate-limit headers](https://api.waterdata.usgs.gov/docs/ogcapi/keys/)
- [Migration guide](https://api.waterdata.usgs.gov/docs/ogcapi/migration/)
- [API versioning](https://api.waterdata.usgs.gov/docs/ogcapi/versioning/)

Every request is a GET to
https://api.waterdata.usgs.gov/ogcapi/v1/collections/COLLECTION/items.
The JSON representation is a GeoJSON FeatureCollection. The current observation
field is time_series_id. Original feature IDs, properties, geometry and response
bytes are retained.

| Collection | Selection | Meaning retained |
| --- | --- | --- |
| daily | Locations or exact time series, optional parameter/statistic codes, explicit start/end dates | An original daily statistic and its local calendar date |
| continuous | Locations or exact time series, optional parameter/statistic codes, explicit timestamps with offsets | Original sensor measurements and method category |
| monitoring-locations | Exact location IDs or original location filters/geographic extent | Names, site settings, geography, datum and revision metadata |
| time-series-metadata | Locations, parameters, statistics or exact series IDs | Units, computation period/type, primary flag, source coverage and gap interval |

The USGS transmits observation values as strings to preserve precision. The
capture keeps values such as "0", "0.00", scientific notation, empty strings,
nulls and textual values distinct. It retains approval_status, qualifier and
last_modified. The current provider examples include qualifier arrays as well
as null, even though a schema presentation labels the field as a string.

Daily dates remain their original local dates. Continuous timestamps retain the
original text and UTC offset. Metadata begin/end describe the source's reported
period of record; the USGS explains that the end metadata may update less often
than observations. A parameter's original unit_of_measure is retained without
conversion. A series identity also retains its statistic and computation
metadata so the customer can distinguish a daily mean, daily maximum and
instantaneous measurement.

## Capture a complete selection

Run with Node 22 or newer and the existing Linux util-linux flock command.
This example uses the additive provider module from its source directory:

~~~javascript
import { captureSelection, captureRows } from './provider.mjs';

const capture = await captureSelection({
  directory: '/srv/private/water/captures',
  operationId: 'potomac-discharge-october',
  selection: {
    collection: 'daily',
    locationIds: ['USGS-01646500'],
    parameterCodes: ['00060'],
    statisticIds: ['00003'],
    time: { start: '2026-10-01', end: '2026-10-10' },
    limit: 1000
  },
  onProgress: capture => {
    process.stderr.write(
      capture.operationId + ': ' + capture.pages.length + ' retained pages\n'
    );
  }
});

const rows = await captureRows(capture);
console.log(capture.status, capture.captureSha256, rows.length);
~~~

The directory argument names the private captures parent. The operation is
stored in its operationId subdirectory. The function creates private
directories and acquires the original advisory lock for this one capture.
Concurrent calls for the same capture receive the existing lock-busy outcome.

Page size controls each response. Acquisition follows every original next
link until the selected streams finish. Arrays are expanded into separate
original GET streams, as the USGS recommends for efficient location/parameter
queries. Repeated input identifiers are collapsed before dispatch. The original
next link supplies its cursor; the client does not construct a cursor or infer
an offset. Its origin, collection and selected filters must remain those of the
original request.

The source stream can change while several pages are being retrieved. The
manifest retains each response's timestamp, count declarations and original
feature identity. Changed advertised counts and conflicting repeated features
remain visible in a partial capture. The customer receives the exact retained
edition after the complete source selection has been assembled.

Optional filters use the selected collection's original fields:

- Daily: approval_status, qualifier and last_modified.
- Continuous: the daily fields plus method_category.
- Time-series metadata: primary, computation_period_identifier,
  computation_identifier, begin, end, last_modified and sublocation_identifier.
- Monitoring locations: agency_code, state_code, county_code, country_code,
  site_type_code, hydrologic_unit_code, monitoring_location_name,
  national_aquifer_code and aquifer_code.

A bbox is [west, south, east, north] in longitude/latitude degrees. Simple
filters retain the exact string supplied by the operator. The observation
time range must be explicit; a retained selection does not contain a moving
"last seven days" window.

## Source transport

The default transport delegates each request to createPublicHttpsFetch from
sf31-buyer-client/public-transport.mjs. It supports Node 22 through the original
SF85 CONNECT agent, preserves USGS hostname/TLS verification and requests
identity content encoding.

The selected host proxy variable defaults to HTTPS_PROXY. Its value becomes
the existing explicit-connect profile for the fixed USGS origin. The original
proxy parser accepts an HTTP host/port URL. To select another variable, pass
proxyEnv; to use direct OS DNS/TLS, pass proxyEnv: null. Host environment values
stay in the running process.

Optional USGS authentication uses an operator-selected environment variable:

~~~javascript
const capture = await captureSelection({
  directory: '/srv/private/water/captures',
  operationId: 'selected-source-edition',
  selection,
  apiKeyEnv: 'USGS_WATER_API_KEY',
  proxyEnv: 'HTTPS_PROXY'
});
~~~

The provider key is sent as X-Api-Key. Requests, manifests and exported files
store neither the key nor a query-string credential. The USGS documents that
an optional api.data.gov key raises permitted request capacity. Actual
X-RateLimit-Limit, X-RateLimit-Remaining and Retry-After headers are retained
when returned. An HTTP429 pauses the capture at its original next page until
Retry-After; a response without an interval uses a 60-second recovery interval.

A host integrating its own maintained transport can supply an object with
request(url, {signal, collection}), or that request function directly. The result
is {status, headers, body, url, receivedAt}; body must contain the original
complete bytes. An injected transport remains owned by its caller. The default
transport drains or cancels its own requests on close.

The default response limit is 64 MiB per original page and the complete request
timeout is 60 seconds. createUsgsTransport accepts a lower explicit maxPageBytes and
timeoutMs settings. A caller using it can pass the returned transport to
captureSelection and close it after its operations finish.

## Interrupted work and source identity

Repeating captureSelection with the same parent, operation ID and selection
reopens a completed capture without a provider request. For partial work, it
continues the original pending page. Reusing an operation ID with different
selection content returns USGS_OPERATION_CONFLICT.

Before dispatch, the capture retains its original request record and inflight
identity. The HTTP response record retains its status, selected response
headers and expected original byte hash. Its body is then stored immutably.
If the process exits after the response was retained but before the capture
manifest advances, reopening adopts that same response. If body persistence
was interrupted, the original observed HTTP outcome and expected byte identity
remain in history and the capture continues through a new explicit invocation.

Every failed response is retained with its original status and bytes.
Malformed GeoJSON, inconsistent source counts and changed value types stay
attached to their original response. Network and filesystem failures remain
separate. The original source request is cancelled through the supplied
AbortSignal; a cancelled capture can be reopened at its retained next page.
Progress observers are informational and do not own the source operation.

The source selection SHA256 is computed over:

~~~javascript
JSON.stringify(normalizeSelection(selection), null, 2) + '\n'
~~~

The capture SHA256 uses canonical key-sorted JSON of the persisted manifest,
excluding captureSha256 itself. The runtime directory is attached only when
the manifest is read and is excluded from both its serialized bytes and its
digest. Moving a capture preserves its source identity.

## Read original rows

~~~javascript
import { readCapture, captureRows, retainedFiles } from './provider.mjs';

const capture = await readCapture(
  '/srv/private/water/captures',
  'potomac-discharge-october'
);
const rows = await captureRows(capture);
const uniqueRows = await captureRows(capture, { exactUnique: true });
const files = await retainedFiles(capture);
~~~

captureRows returns every original feature by default. Each row contains these
observation fields, with null conveniences for absent properties:

feature_id, collection, monitoring_location_id, time_series_id,
parameter_code, statistic_id, time, value, value_state, unit_of_measure,
approval_status, qualifier, last_modified and method_category.

Metadata conveniences are monitoring_location_name, state_code, county_code,
site_type, parameter_name, parameter_description, begin, end,
computation_period_identifier, computation_identifier, primary,
data_gap_interval and parent_time_series_id. The complete properties and
geometry remain alongside them. The original properties object preserves the
difference between an absent field and a field with an explicit null.

Source coordinates are source_url, source_sha256, source_stream, source_page
and source_index. Duplicate markers identify repeated original feature IDs.
The exactUnique option omits only duplicate features with identical canonical content;
conflicting versions remain present with conflicting_duplicate: true.
No numeric conversion occurs in this module.

The surrounding merchant uses the original dataset engine to publish a
versioned projection, and the customer receives that original snapshot.
Derived statistics and charts retain their separate calculations and the
original values from this capture.

## Portable source closure

capture.json is the original manifest. All source-member paths are relative
to the capture directory:

- requests/ contains original selected GET requests.
- responses/ contains observed HTTP outcomes and original byte identities.
- bodies/ contains the content-addressed original response bytes.

retainedFiles(capture) returns the complete available original closure as
{path, sha256, bytes}, including capture.json, accepted pages and attempt
history. Copy these files byte for byte into the edition's private capture
directory and preserve their relative paths. The original private readers
expect private regular files; copies use mode 0600 inside mode 0700
directories.

Read a relocated capture directly with readCapture('/new/private/capture').
The reader verifies each accepted body and response record. It binds the new
runtime directory while preserving the exact original manifest and digest.
Merchant/customer editions therefore remain usable after the earlier
acquisition directory is removed.

## Migration opportunity

The USGS announced that the experimental Observations API begins redirecting
on 2026-10-19 and will later stop responding. Its official replacement is the
v1 OGC platform used here. The USGS separately plans WaterServices retirement
in early 2027. A migration can preserve each application's actual station,
parameter, statistic, units and time semantics through these retained source
selections.

- [Observations API retirement notice](https://waterdata.usgs.gov/blog/api-observations-decom/)
- [WaterServices migration notice](https://waterdata.usgs.gov/blog/api-waterservices-decom/)

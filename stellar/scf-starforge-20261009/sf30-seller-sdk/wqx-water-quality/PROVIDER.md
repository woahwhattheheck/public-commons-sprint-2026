# WQX 3.0 source acquisition and sample joins

This companion workspace reads the Water Quality Portal's current WQX 3.0 CSV profiles. A project retains the original request, original response body, native request-status response, complete header, and every source record. Station, sampling activity, result, and detection-limit identities remain separate.

## Acquire and reopen a source cohort

Use an absolute private directory. The capture creates an operation subdirectory, with mode 0700 directories and mode 0600 source files. Run from the source checkout:

```js
import {
  captureSelection, readCapture, retainedFiles
} from './stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/provider.mjs';
import {
  joinCapture
} from './stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/samples.mjs';

const selection = {
  filters: {
    siteid: ['USGS-01646580'],
    providers: ['NWIS'],
    startDateLo: '01-01-2025',
    startDateHi: '03-31-2025'
  },
  profiles: ['Station', 'Activity', 'Result'],
  partition: 'none'
};
const capture = await captureSelection({
  directory: '/absolute/private/water-quality/captures',
  operationId: 'potomac-2025-q1',
  selection,
  onProgress: current => {
    process.stderr.write(JSON.stringify(current.summary) + '\n');
  }
});

const reopened = await readCapture(capture.directory);
const joined = await joinCapture(reopened);
console.log(joined.summary);
console.log(joined.rows[0].record);
console.log(await retainedFiles(reopened));
```

The maintained source adapter uses the existing SF31 public HTTPS transport and the host's `HTTPS_PROXY` when present. `createWqxTransport({ proxyEnv: null })` selects direct access. A caller may select another proxy environment variable, a timeout up to 300000 ms, and a response limit up to 64 MiB. Source acquisition has no npm package dependency beyond the original local modules.

Calling the same operation ID with the same normalized selection reopens a completed capture without more provider requests. A partial operation resumes its unfinished profile requests. A new operation ID creates a new acquisition for a refresh or comparison. An existing ID cannot be repurposed for a different selection.

## Native selection and profile behavior

`normalizeSelection(input)` accepts `{ filters, profiles?, partition? }`. It emits one stable normalized selection, and `buildQueries(selection)` gives each original URL, native profile, request ID, date window and result subprofile.

The default profiles are the three deployed v3 routes used by the portal's current UI and the official USGS dataRetrieval package:

| Profile | Native route | Data |
| --- | --- | --- |
| `Station` | `/wqx3/Station/search` | Monitoring-location identity, coordinates, datum and station metadata |
| `Activity` | `/wqx3/Activity/search` | Sample/field-visit identity, date, time zone, media, sample type and collection methods |
| `Result` | `/wqx3/Result/search?dataProfile=fullPhysChem` | Full physical/chemical result and associated metadata; native limit slots A and B |
| `ResultDetectionQuantitationLimit` | `/wqx3/ResultDetectionQuantitationLimit/search` | Explicit additional profile selection, decoded using the official v3 detection-limit schema when returned |

All calls request `mimeType=csv`. The service currently returns some CSV bodies with `Content-Type: text/plain`; the adapter retains that exact header and recognizes the native profile from its CSV header.

The current 3.0 source UI and official dataRetrieval implementation expose Station, Activity and Result. The direct additional-limit route returned HTTP 400 for the retained Potomac query on October 11, 2026. The adapter retains an explicitly requested profile's original failure response and keeps successful profiles available for review. The default three-profile acquisition remains useful: its original result records include every reported A/B limit slot. The full v3 limit schema can represent additional limit types; the joiner preserves every row when that profile is available. Each report can inspect `summary.profileCoverage` to show the selected and returned profiles.

The beta service uses repeated parameters for OR selections:

```text
providers=NWIS&providers=STORET
siteid=USGS-01646580&siteid=USGS-01646500
```

Different parameter names form the provider's AND selection. Native strings retain case and leading zeroes. Supported multi-value filters are `countrycode`, `statecode`, `countycode`, `siteType`, `organization`, `siteid`, `huc`, `sampleMedia`, `characteristicType`, `characteristicName`, `pCode`, `providers`, `activityId`, `project`, `assemblage`, and `subjectTaxonomicName`. Scalar filters include activity-date bounds, radial coordinates/distance, bounding box, minimum activities and minimum results. Dates may be entered as MM-DD-YYYY or YYYY-MM-DD; original requests use MM-DD-YYYY. Provider codes are `NWIS` and `STORET`.

For large selections, `partition: 'month'` or `'year'` divides both date bounds into nonoverlapping inclusive date windows. Each native profile is acquired for each window. Station metadata repeated across windows remains visible and receives an exact-duplicate marker. A date partition is a provider query partition, with its original URL and receipt; it is not an invented provider page.

## Public source API

| Export | Return / purpose |
| --- | --- |
| `normalizeSelection(input)` | Stable `{filters, profiles, partition}` |
| `buildQueries(selection)` | Array of `{id, profile, url, window, dataProfile}` |
| `createWqxTransport(options)` | Original HTTPS `{request(url, {signal}), close()}` |
| `captureSelection({directory, operationId, selection, transport?, signal?, onProgress?, readStatus?})` | Persisted capture with runtime `directory` |
| `readCapture(directory, operationId?)` | Reopened capture after every retained member and selection hash is checked |
| `readProfiles(capture)` | `{capture, profiles}`, with raw record envelopes for each profile |
| `readProfile(capture, profile)` | Raw record envelopes for one profile |
| `retainedFiles(capture)` | Complete portable relative-path manifest including `capture.json` |
| `decodeProfile(bytes, {profile, status?})` | Original CSV header, records, row count and body digest |
| `assessProviderStatus(resource)` | Interpretation of retained native completion flags and output row counts |
| `joinCapture(capture)` | Original profiles, normalized result rows, relationship issues and summary |

Descriptive aliases are also available: `normalizeWaterQualitySelection`, `captureWaterQuality`, `readWaterQualityCapture`, `retainedWaterQualityFiles`, and `joinWaterQuality`.

An injected source transport returns `{ status, headers, body: Uint8Array, url, receivedAt }`. The URL must equal the requested original URL. This is the seam for replaying an actual retained response bundle or composing an existing authorized host transport. The original native URL, status, headers, body digest and source time remain in the capture.

## Capture files and reopening

`capture.json` uses `schema: 'starforge.wqx-water-quality-capture.v1'`. Its identity includes the normalized selection, request graph, original resource descriptors and attempt history. `captureSha256` hashes the canonical manifest excluding itself and the runtime directory. Copying the capture to a new private directory therefore preserves the capture identity.

Each selected resource carries:

```text
id, profile, url, window, dataProfile,
status, dataAvailable, attempt, bodyFile, recordFile,
rowCount, columns, responseStatus, receivedAt,
sha256, bytes, headers, requestId, providerReceipt, issues, error
```

A native `wqp-request-id` header is followed through the original `/wqx3/status/{id}` endpoint. Its exact JSON bytes, request and response metadata are retained beside the CSV; `providerReceipt.value` exposes the parsed native response. `assessProviderStatus(resource)` compares the actual data providers' `outputRowCount` values to parsed data rows, and treats the header provider separately because `totalRowsSent` includes that header. Explicit failed, canceled, disconnected or incomplete provider output, a mismatched request ID, or inconsistent counts leaves the acquisition partial while keeping available CSV records. An unavailable status response remains visible beside the retained data and can be inspected independently. The original Potomac responses report successful completion with 1, 13 and 1,035 output data rows. The underlying source changes independently between requests. The capture records all retrieval times and native result `LastChangeDate` fields, rather than treating several provider requests as an atomic upstream snapshot.

The manifest has `IN_PROGRESS`, `COMPLETE`, or `PARTIAL` status. A partial capture still exposes valid retained source profiles through `dataAvailable`. HTTP errors, interrupted responses and parse errors remain attached to the affected attempt. Native `Retry-After` is observed on resume.

`retainedFiles` returns entries with `path`, `sha256`, `bytes`, `role`, and `contentType`, plus the related profile and resource where applicable. Roles distinguish original CSV source, original status bytes, request records, response records and the capture manifest. Copy all returned members with ordinary copies into private directories. Reopening checks exact bytes, native source URLs, row counts and actual column names. This supports project import, portable editions, raw CSV download, and original SF88 delivery reopening after the acquisition directory is moved.

## Record and join contract

Every raw record envelope has:

```text
profile, id, key, record, recordSha256,
duplicate, conflictingDuplicate,
source: {
  profile, resourceId, url, sha256, bodyFile,
  index, lineStart, lineEnd, receivedAt
}
```

`record` preserves every original CSV header and cell string. `source.index` is a zero-based CSV data-record index; physical line numbers begin at 1 and include the header and embedded quoted line endings. Escaped quotes, embedded commas, multiline fields, empty cells, leading zeroes, decimal trailing zeroes and JSON-array strings remain intact. A field absent from the native header remains absent in `record`.

The provider namespace and organization are included in every relationship:

| Identity | Tuple |
| --- | --- |
| Monitoring location | ProviderName, Org_Identifier, Location_Identifier |
| Sampling activity | ProviderName, Org_Identifier, Activity_ActivityIdentifier |
| Result | ProviderName, Org_Identifier, Activity_ActivityIdentifier, Result_MeasureIdentifier |
| Limit version | Result identity plus DetectionLimit_Type |

A user-supplied activity identifier is retained separately from the original activity identifier. A new record with an existing native identity receives a distinct content version. Exact duplicates remain present with `duplicate: true`; differing original records under the same identity receive `conflictingDuplicate: true`. No version overwrites another.

`joinCapture` returns `{schema, captureSha256, selection, capture, rows, stations, activities, limits, issues, summary}`. The `rows` array contains normalized results. The profile arrays retain raw envelopes. Result rows include the flat scientific fields agreed by the workspace and analysis modules, `record`, `source`, `stationRecords[]`, `activityRecords[]`, and `limits[]`.

The flat result fields retain characteristic, comparable characteristic, parameter code, fraction, speciation, medium, activity type, analytical method/context, comparable method, sample and laboratory preparation methods, units, statistical base, weight/time/temperature/particle-size basis, sample depth, date, time zone, status, qualifier, detection condition, and value type. Missing fields are `null` in this convenience projection; a present empty CSV value remains `''`. `valueState` distinguishes absent, empty, decimal and text.

Every normalized detection limit retains:

```text
id, resultKey, activityKey, stationKey,
type, value, valueState, unit, comment,
origin, record, source, duplicate, conflictingDuplicate
```

`origin` is `profile`, `result-A`, or `result-B`. All source limits remain separate; equivalent embedded/profile limits have explicit match IDs. Multiple methods, limit types or differing units remain visible. The scientific analysis module determines compatible groups and censored-value summaries.

Relationship issues identify missing station/activity/results, differing activity metadata, conflicting original versions, inconsistent station linkage and differing result/limit units. Unmatched activity rows remain in the profile output; for example, a field visit can be returned while its available analytical result set differs from another independently requested profile.

## Real source cohort

The retained Potomac Chain Bridge cohort uses `USGS-01646580`, NWIS, and January 1 through March 31, 2025. Original v3 responses contain one station, 13 activities and 1,035 result rows across six activity dates. The records include routine and quality-control replicate sample types, accepted result statuses, detection conditions, qualifiers and original analytical methods. This cohort exercises real sample-level relationships and the complete original metadata, including USGS additions after the legacy service's March 11, 2024 cutoff.

## Primary references

- [WQX3 web services guide](https://www.waterqualitydata.us/beta/webservices_documentation/)
- [WQX3 portal user guide and profile descriptions](https://www.waterqualitydata.us/beta/portal_userguide/)
- [USGS WQX3 migration and update](https://waterdata.usgs.gov/blog/wqx3/)
- [EPA outbound WQX3 profile field map](https://www.epa.gov/system/files/other-files/2025-09/schema_outbound_wqx3.0_profiles_1.csv)
- [EPA detection-limit best practices](https://www.epa.gov/system/files/documents/2025-09/wqxdetectionlimitsbestpracticesguide_final.pdf)
- [Official USGS dataRetrieval WQP implementation](https://github.com/DOI-USGS/dataRetrieval/blob/main/R/readWQPdata.R)
- [Official USGS v3 and status endpoint configuration](https://github.com/DOI-USGS/dataRetrieval/blob/main/R/setAccess.R)

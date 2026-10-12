# GridFabric Plaid operation engine

This application joins original interval files, reviewed report definitions, native Plaid callbacks, and explicitly configured device adapters. The domain engine is original CommonJS with no package dependencies. The native host supplies synchronous SQLite transactions, original file custody, a UTC clock, SHA-256, and UUIDs.

## Source and native responsibilities

The captured vendor contracts live in contracts/plaid-public-contract.json, management-examples.json and SOURCES.md. They include the original documentation URLs, source representations, historical examples, and the exact distinction between published paths and the full deployed SDK schema.

Plaid owns OpenADR registration, VTN communication, event timing, randomized offsets, polling and report scheduling. Its HTTP plugin pauses the native instance during a callback. The host must return the callback response before attempting any management request to that same instance. Management requests go to the configured listener root. The captured API has no built-in management authentication; deploy that listener on the intended private interface or authenticated proxy.

The engine accepts the sixteen documented callback kinds. A nonempty callback retains its exact original UTF-8 body and header. The explicit heartbeat endpoint accepts the documented empty POST. Both original instance configuration and every subsequent configuration edition remain in the workspace.

## Importing measurements

First retain the raw file through the host's files endpoint. Then call import_source with its returned file_sha256, a name, format, explicit profile, and provenance. Source IDs are operation identities; importing the same file with a different explicit profile produces another source with the same file identity. Repeating the original action request_id returns the original source ID.

A JSON profile names an array with rows_pointer; each fields value is a JSON pointer relative to a row. CSV fields values are exact original column names. constants provide explicitly declared values. A field may contain kind so one mixed input can preserve several measurement kinds.

A complete mixed profile is:

~~~json
{
  "rows_pointer": "/rows",
  "fields": {
    "device_id": "/device_id",
    "channel": "/channel",
    "kind": "/kind",
    "unit": "/unit",
    "start": "/start",
    "end": "/end",
    "value": "/value",
    "status": "/status",
    "data_quality": "/data_quality"
  },
  "constants": {},
  "timestamp_format": "iso8601",
  "value_semantics": {
    "energy": "interval_energy",
    "power": "interval_average_power",
    "status": "status"
  }
}
~~~

Units are Wh/kWh, W/kW, or status. Each ISO timestamp includes seconds and an explicit UTC offset. Epoch-second profiles support exact decimal values to microsecond precision. Interval energy and average power require an original end timestamp or an explicitly declared end_default_seconds. Instantaneous power uses instantaneous_power semantics. A status source retains its original object; CSV can contain that object's JSON text.

The application preserves the raw file, each parsed original row and line/record locator, normalized values, and every source issue. Duplicate intervals invalidate both rows. A source with issues remains NEEDS_CORRECTION. An original-format import retains evidence, instance schema or operator observations without interpreting it as a measurement file.

A corrected file links corrects_source_id to its original source. A new reviewed mapping lists correction sources before older sources. Sparse corrections replace only the intervals they actually contain; earlier sources supply other intervals. Each source listed for an entry must contain that entry's declared device, channel and kind. Unresolved source issues must be corrected before activation.

## Report definitions and calculation

save_mapping retains a complete original onRegisterReportsResponseMessage together with its declared rId/specifier source mapping. Every registration rid must correspond to one entry, and units/specifier identity must agree. Status registrations omit usageIntervalProperties.

Each mapping entry supplies r_id, report_specifier_id, source_ids in descending precedence, device_id, channel, kind, output unit, time_basis, period_seconds, aggregation, decimal_places and an explicit allow_resample flag. time_basis is start or end for interval aggregation, instant for samples/status. Aggregation is energy_sum, power_average, sample or status. The period supplies an interval duration when a zero-granularity callback requests its single point.

activate_mapping records its named reviewer and supersedes the previous active mapping. Historical mappings, query requests, results and callback responses remain available.

The published query bounds are inclusive. A zero granularity or equal start/end yields a single timestamp. Energy sums and average power use exact rational arithmetic until the declared output rounding: nearest with exact halves away from zero. The result must survive conversion to a JSON number at that declared precision. Status and instantaneous power require the exact original measurement timestamp.

Source ranges are indexed once per entry/query. Reporting combines their chronological boundaries, chooses the highest-precedence covering source, and merges adjacent segments before calculation. It rejects source gaps and overlaps at the selected precedence. A partial original interval requires explicit resampling approval and output quality. Quality comes from the source or an explicit reviewed mapping; missing measurements do not become zero.

Every output row retains its original source IDs, row IDs, segment boundaries, unit conversion, exact numerator/denominator, decimal result and wire value. Every unsuccessful point has its own retained issue. A report with incomplete source coverage returns NEEDS_SOURCE and has no complete response file.

Complete prepared reports are cached by exact instance, active mapping and original query. A matching callback can return the retained body immediately. The cache remains inside the workspace and changes identity when a mapping changes. Multi-specifier output groups reports with the documented reportIdentifier override.

## Event schema bindings and device intent

The complete licensed callback schemas are supplied by a deployed instance. Import an original schema/sample as evidence, then configure a reviewed JSON-pointer binding for each event callback kind. The public sources do not establish all nested event, target, opt-response or status wrappers.

A binding uses events_pointer for an array or event_pointer for one object. event_id_pointer and optional revision_pointer are relative to that selected object. targets_pointer selects its original target object. target_bindings map paths within that object to documented semantic categories: resourceId, venId, groupId or partyId. target_match explicitly states the reviewed any/all category combination. Each instance device maps these provider identifiers to one device_id and optional adapter_id. An empty original target set applies to all configured instance devices.

For OnEventIntervalStart, interval_id_pointer, interval_start_pointer and signal_pointer are relative to the entire callback. They retain the native interval identity/effective timestamp and original signal. A reviewed optIn decision with retained source evidence is required for device setting actions. A configured response_template and opt_type_pointer can project that reviewed choice into an original opt-response envelope.

Every event observation retains its original document and callback. Lower revisions remain stale history. Conflicting definitions at the same revision remain visible for review; comparisons use the same callback shape. Missing legacy modification numbers remain null. Device intent identity includes the retained definition/signal when the modification number is absent.

Repeated interval delivery preserves the same device intent. A new event edition supersedes queued earlier-edition settings. Receiving an unchanged event in a full distribution preserves its active lifecycle. OnEventCancel retains CANCEL_REQUESTED, and OnEventArchive retains ARCHIVED. An end action follows the native OnEventComplete callback, including Plaid's actual randomized cancellation timing.

A resource-specific opt decision applies only to devices whose retained resource IDs match that decision. An event-wide decision applies across the event. At dispatch, the engine chooses the latest applicable decision for each device and records the chosen decision ID; a later optOut therefore prevents an earlier queued setting from sending. The whole-event callback opt response uses the event-wide decision. A resource decision does not silently become a whole-event response.

A reviewed complete distribution can reconcile absent event IDs and supersede their queued settings. That reconciliation preserves its original source, complete ID set and reviewer. It does not substitute an application-generated stop time for the native completion callback.

## Continuing a retained interval

An accepted callback can need an opt decision or corrected schema binding before it can produce a device setting. Its original HTTP response is immutable. Use the explicit resume_event_callback action after completing the source review; supply callback_id, event_id, expected_event_revision, the expected native interval identity/effective start where present, a reviewer and source_evidence. The action retains a continuation and reuses existing intent IDs.

The event must still be active and the retained callback must describe its latest native interval. Both continuation and begin_device_action check the current event revision and latest interval identity. A newer native interval prevents an older queued setting from sending. Repeated delivery with different header observations can still refer to the same interval identity and original signal. A conflicting signal at the same interval identity remains visible for review.

When a complete source-backed binding review changes how retained event callbacks are interpreted, use project_event_history with instance_id, reviewer and source_evidence. It reprojects original callbacks in their first-received revision order, retains projection history, and reapplies original complete-distribution reconciliations at their original revision positions. It preserves original HTTP response bytes, original distribution records and existing action history. Historical callbacks do not enqueue device settings during this projection; a current interval can be continued explicitly afterward.

## Outbound requests and recovery

The seventeen published management operations retain the entire original parameters object, the configuration edition, exact endpoint, header environment references, reviewer and full request body. Secrets are supplied by the host environment and are not stored in the workspace.

prepare_management produces PREPARED. begin_management durably moves that same operation to SENDING and returns the captured endpoint/method/header references, original request body, byte/hash identity and attempt_id. Only after this transaction commits may the host perform its one HTTP call. Device actions follow the same begin/finish protocol from QUEUED.

A replayed begin request returns replayed:true. The host must not send the HTTP request again. It reads the existing operation instead. SENDING and UNKNOWN never automatically re-enter the dispatch path.

finish_management preserves the complete original status, headers, body and transport result. HTTP success, local status, exception and VTN response are classified separately. The published HTTP200 / status OK / response452 case is VTN_REJECTED. A local PROCESSED result remains distinct from later VTN results; ven.start can have asynchronous VTN effects.

An interrupted SENDING operation becomes UNKNOWN through recover_dispatches. A later actual response can complete the same attempt while preserving the prior uncertain receipt. Explicit reconciliation uses complete, not_applied or still_unknown with a named reviewer, reason and original evidence. It preserves the old attempt and its complete receipt history.

For a device adapter, ACKNOWLEDGED means the configured HTTP adapter returned success. Its original response describes the device-specific result. The original device signal, event identity and action ID are sent in stellar-forge.plaid-device-action.v1.

## Durable application interface

The host supplies get/put/scan/count/transaction and put/read file methods. A store scan returns records with id, data, scope, sort and tag; ordering is asc or desc. Public pages include total, offset, limit and next_offset. The internal meta table retains workspace and prepared-report identities. Keep it in every native export and cold restore.

Every new operator action requires request_id and expected_revision. Repeating the same request and exact input returns the saved result; reusing the identity for different input is rejected. A revision conflict requires reading current state. Each callback delivery also advances the workspace revision while retaining its individual delivery record.

The public collections expose all sources/rows/issues, configuration editions, mappings, callbacks/deliveries, event editions, distributions, opt decisions, reports/rows, device actions, management operations/receipts and operator operations. The native delivery must preserve their complete contents, the original workspace ID and every referenced file when another owner reopens it.

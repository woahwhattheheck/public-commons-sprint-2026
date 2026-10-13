# Bind original measurements to an editable native Chemistry case

This workflow joins the existing Measurements source collection, record review and source revision engine to the original Chemistry 0.3 inference and transfer workflow. It retains the complete selected population, exact source rows and original measurement workspace alongside each prepared binding. The existing Chemistry queue performs numerical work.

## Open, review and prepare

Open **Measured observations**, choose an existing original Chemistry case, and inspect the actual imported measurement population. The inspector returns complete records, source links, review history, original spatial assignment and exclusion reasons, grouped by exact characteristic, analytical method, fraction, source basis and normalized unit.

A usable binding requires these explicit choices:

- The original station and actual selected case reach, with a source reference and assignment rationale. Existing HUC assignments are retained as context; they are not silently reused as chemical reaches.
- The exact original characteristic/method/fraction and its measured identity. Ammonia-N, nitrate-plus-nitrite-N and Kjeldahl-N are separate review choices.
- The conserved basis and its source evidence. A blank or unspecified source basis requires the analyst's explicit basis reference and rationale. A conflicting declared source basis is rejected.
- All modeled components and positive weights needed to represent the measured quantity. Components must share the selected conserved basis. A total-nitrogen label alone does not turn an ammonium-plus-nitrate model into a complete TKN-plus-NOx measurement.
- The original model time origin with time zone, or an explicit reviewed model day for a selected source record. Original dates and times remain retained. Samples outside the actual case duration remain excluded.
- An explicit positive uncertainty in mg/L with its rationale, and fit/holdout roles. A dated holdout boundary is supported; source records are never silently assigned a laboratory uncertainty.

The binding keeps quality-control exclusions, source-version conflicts, rejected reviews and unresolved native-domain changes. Only a specific reviewed interpretation resolves an unmapped constituent, a separate explicit chemical-reach assignment, or valid censored bounds.

### Censoring and original nutrient composition

The adapter reuses the existing exact-decimal Eighteenmile source reader in observations/eighteenmile_stoichiometry_20261013/stoichiometry.py. Its original published methods, unfiltered fraction, final status and strict below-quantification condition produce the original finite interval and open endpoint. Original source rows and rationales remain attached. Other sources need finite original bounds and an explicit endpoint review.

An interval uses qualifier interval, lower_mg_l, upper_mg_l, lower_closed and upper_closed. It has no substituted mg_l point value. An optional original TKN-plus-NOx selection uses the same STOICH concentration and plus functions, matches the original activity, station, time zone, sampling depth, medium and project, and retains both original row identities. The target nitrogen operator must exactly equal the disjoint weighted union of the selected original TKN and NOx modeled operators on basis N. Overlapping component pools, omitted pools and changed target weights remain excluded with explicit reasons. Ammonia is already part of TKN and is not added again.

When a TKN-plus-NOx target is created, its two component targets are removed from that request's independent observation population. Their source records and component interpretations remain retained. This prevents treating a derived sum and its same two measurements as three independent observations.

## Exact API

POST /api/measurements/chemistry is handled inside the original authenticated extension. Every body contains the existing workspace key and an action.

- catalog: original cases, saved bindings, explicit measurement choices and measurement_revision.
- inspect: case_id, filters and optional expected_revision. Returns case, revision, filters, complete records, source groups and measurement_choices.
- prepare: selection, with the structure below. Returns binding_id, the editable child case_id, original_case_id, counts, accepted/excluded populations, retained source and native_payload.
- get or export: binding_id. Export returns document, filename, content_type, sha256 and the original native Chemistry export action.
- adopt-source: case_id, source_collection_id and source_id. Reopens the complete binding document retained by an independently received original Chemistry case.

The selection uses actual original IDs. The following is a schema example; field values must come from the selected sources and native project:

~~~json
{
  "case_id": "ACTUAL_ORIGINAL_CASE_ID",
  "title": "Reviewed native observation selection",
  "reviewer": "ACTUAL_REVIEWER",
  "reason": "Scientific purpose and scope of this original source binding",
  "filters": {"stationId": "ORIGINAL_STATION", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD"},
  "expected_revision": 1,
  "station_bindings": [
    {"station_id": "ORIGINAL_STATION", "reach_id": "ACTUAL_CASE_REACH",
     "reference": "Original spatial/source reference", "reason": "Assignment rationale"}
  ],
  "measurement_mappings": [
    {"characteristic": "EXACT ORIGINAL CHARACTERISTIC",
     "method": "EXACT ORIGINAL METHOD", "fraction": "EXACT ORIGINAL FRACTION",
     "measurement": "nitrate_nitrite_n", "basis": "N",
     "basis_reference": "Original method/basis source",
     "basis_reason": "How the selected modeled pools represent the measured quantity",
     "components": [{"species": "ACTUAL_CASE_SPECIES", "weight": 1}],
     "sigma_mg_l": 0.1, "uncertainty_reason": "Explicit reviewed uncertainty source"}
  ],
  "time_origin": "YYYY-MM-DDTHH:MM:SS+00:00",
  "day_overrides": {},
  "roles": {"default": "fit", "holdout_from": "YYYY-MM-DD", "by_record": {}},
  "allow_censored": true,
  "interval_overrides": {},
  "request": {"mode": "calibrate", "parameters": []}
}
~~~

The 0.1 uncertainty above illustrates JSON syntax; the application requires an actual reviewed value. Exact blank method/fraction strings may be selected when those are the original source fields.

day_overrides maps an exact record ID to {day, reason}. interval_overrides maps an exact record ID to {lower_mg_l, upper_mg_l, lower_closed, upper_closed, reason}; the bounds must agree with the declared source. It can explicitly review the physical zero lower bound of a left-censored concentration. It cannot invent a finite upper bound for an originally unbounded result.

Optional derived_total_nitrogen contains measurement: total_nitrogen, basis: N, basis_reference, basis_reason, components, sigma_mg_l and uncertainty_reason. It applies only to the exact supported original TKN and NOx methods at matching original sampling activities.

Native modes are calibrate, sensitivity, uncertainty and monitoring. The request contains that original mode's parameters, draws, count and other native settings. The binding supplies observations, so a competing request.observations is rejected.

## Original native operation and recovery

Preparation reads the original measured revision, every selected full record and the complete portable source in one SQLite read transaction through the existing Measurements process. An explicitly expected stale revision returns a conflict before source publication. A content-addressed identity, native file lock and immutable receiving receipt preserve the same selected operation across interruption. The first complete original portable snapshot is retained when a retry changes only its descriptive creation clock.

The source document and complete editable measurement snapshot enter the existing Workspace.import_sources intake. The new native Chemistry case is a child of the actual selected case, with the same physical project and both original and measured source references. Existing source cases remain available.

The returned native_payload has the original shape {case_id, request}. Run it through the existing chemistry.run operator action. Request metadata carries the complete selected interpretation, accepted/excluded populations, source IDs and original case identity. Numerical inference remains in the original engine.

The CLI uses the same actual managed Measurements service:

~~~sh
python -m measurement_workspace.chemistry --workspace ACTUAL_WORKSPACE \
  --output OUTSIDE_WORKSPACE/inspection.json inspect \
  --case-id ACTUAL_CASE --filters ORIGINAL_FILTERS.json

python -m measurement_workspace.chemistry --workspace ACTUAL_WORKSPACE \
  --output OUTSIDE_WORKSPACE/binding.json prepare --selection REVIEWED_SELECTION.json
~~~

The prepared native case and its completed analyses can be exported with the existing chemistry.export action and independently received through chemistry.receive. The source document and full measured snapshot travel as original native source bodies and companions. A complete Workspace transfer additionally retains the binding desk records directly.

For a selected Chemistry transfer, adopt-source reopens the binding already carried by the received case's exact source selection. Original sender IDs remain in received_from. The original Measurements receive operation can reopen the companion measurements.json into an explicitly chosen empty measured workspace before further record review; its original domain binder retains the receiver's explicit native source choice.

## Source composition and rendered inspection

This component adds measurement_workspace/chemistry.py and its source fragment, joins the current MeasuredObservationExtension and descriptor, and uses the existing browser helper. Source normalization, streaming intake, Published Studies and global operator files retain their existing owners.

Apply the repository's AGENTS.md requirement to the actual outgoing interface and scientific files: open and look at populated desktop/narrow views, operate inspection, preparation, case opening, native run, complete export and reopening, and repair visible defects. Source review alone does not establish the delivered product's rendered behavior.

## Complete original collection companions

When selected records belong to one or more retained Measurements collections,
preparation resolves their original import IDs against those collections' native
manifests. It uses the existing collection publisher and bundle exporter to
preserve each complete immutable edition ZIP. The ZIP contains every original
source and binary companion, the original collection manifest, the portable
measurement project, native domain identifiers and the original reports.

The edition must have the same source revision and complete portable project as
the reviewed atomic snapshot; only the descriptive creation clock may differ.
The exported native domain must also equal the inspected domain. A concurrent
record review or domain change requires a fresh inspection. ZIP byte identities,
embedded project/manifest identities and the complete member inventory are
checked before the unchanged ZIP becomes a companion of the binding's native
Workspace source.

The saved binding and exported document list source_collections with original
collection ID, edition ID, source revision, retained ZIP path, SHA256, byte count
and every original member descriptor. Existing Chemistry editable export and
receive carry these archives with the source. adopt-source preserves the same
collection lineage in the receiving case. Original standalone imports remain
available through the complete portable snapshot.

The receiving operator should open the actual downloaded binding document and
original ZIP as a recipient, inspect the project and source companions, and use
the original Measurements collection receive command when reopening that
collection into an independently selected measurement workspace. All native
measurement and model changes continue through their existing engines.


<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->


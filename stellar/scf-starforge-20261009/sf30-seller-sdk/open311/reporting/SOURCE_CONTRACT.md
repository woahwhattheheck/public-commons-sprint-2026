# Open311 reporting source and operating contract

This document defines the reporting workbench that consumes the original immutable collection export. Reporting owns its saved calendars, target policies, mappings, report editions and reviewer comments. Acquisition and its original capture history remain with the collection workspace.

## Primary sources

1. [Open311 GeoReport v2](https://wiki.open311.org/GeoReport_v2/), GET Service Requests and GET Service Request.
2. [Helsinki feedback service API, 1 October 2025](https://www.hel.fi/static/avoindata/kanslia/Open311_API_description_011025.pdf), pages 3 and 6–9.
3. [FixMyStreet public Open311 interface](https://www.fixmystreet.com/open311).
4. [SocietyWorks FixMyStreet Pro administrator manual](https://fixmystreet.org/pro-manual/admin-tasks/), priorities, statistics, data export and automatic dashboard import.
5. [SocietyWorks integrations, assets and data](https://www.societyworks.org/features/integrations/).

The following implementation choices are our reporting contract. Provider facts are identified by source number.

## 1. Immutable input

Accept the complete `commons.open311.collection-export.v1` envelope:

```text
workspaceId, revision, collection, summary, requests,
observations, originals, sourceOperations
```

The collection preserves its frozen connection, attribution, plan and all windows. Summary contains counts, capResolved and first/last observation times. Each selected request retains captureId, sourceSha256 and its separate review. Observations preserve selectedCaptureId, all occurrences and every distinct original item/hash. An occurrence carries captureId, windowId, capturedAt, sourceSha256, sourceResponseSha256, windowPosition, requestedAt and updatedAt. Originals contain complete raw responses, including capped parent captures.

Import by a complete-envelope digest plus original workspace/revision/collection identity. A repeated import of identical content reuses its edition. Preserve the incoming selected item and all alternative versions. Reject a conflicting payload for an already retained exact identity. Original source remains immutable; operator category mappings and commentary are separate saved records.

Reports count each original request key once in their selected cohort. Capture occurrences and distinct source versions have separate counts. Preserve original null, empty and vendor-specific values. A missing service code belongs to an explicit unmapped group unless an operator has supplied a named mapping.

## 2. Status and time semantics

GeoReport v2 defines open and closed. requested_datetime is creation time; updated_datetime is the latest change and, for a closed request, the closure time. expected_datetime is optional and describes the expected fulfilment time, potentially from a service-specific SLA. Query start/end select creation time; each standard query spans at most 90 days. Timezone offsets are required. [1]

Helsinki documents processing-status values with PROCESSING and READY examples. Its updated_datetime means latest update; expected_datetime, agency_responsible and service_notice are unavailable. service_code and service_name apply when feedback was created through Open311. Its public search covers published feedback, with a stated 90-day/200-response return limit. [2]

Keep these contracts in named provider profiles. The standard profile may use closed-request updatedAt for resolution duration. Helsinki retains READY as a source status and updatedAt as latest update; any operational status grouping is a saved reporting mapping. A reporting mapping does not change the source timestamp meaning.

Store three independent target fields:

- sourceExpectedAt: the unchanged provider value, where valid.
- reviewDueAt: an existing operator review/assignment deadline.
- policyDueAt: the computed deadline from an explicitly selected target-policy edition.

The report names the selected comparison target. A missing target is counted as unassessed. A request with a valid zero duration remains valid; an invalid timestamp or reversed interval is retained with a specific calculation issue. Source status, review state and reporting bucket remain separate fields.

## 3. Periods, observation time and coverage

A named report period uses an explicit half-open interval [start,end), a display timezone and a cohort basis. The default cohort is requestedAt in that interval. These report boundaries are applied after acquisition and do not alter the provider's saved request URLs. The public FixMyStreet interface explicitly defines inclusive start_date and exclusive end_date. [3]

Freeze report asOf and the source edition selection. For historical selection, use the latest retained observation at or before asOf; an item first observed later is unobserved at that cutoff. A creation-period cohort can display its status from a later selected observation, provided that observation date is shown. It cannot automatically become a full historical end-of-period backlog.

Display the exact collection filters, observation interval, capResolved, all unresolved/limited window bounds and source row counts with the report. A LIMITED leaf contributes its returned rows to observed totals and remains visible in coverage. Source capture covers its selected query/filters and observation interval. Counting closure-time events across all older creation cohorts requires the appropriate source selection; a short creation-window capture alone does not supply them.

Saved comparisons pin both report editions. Cohort totals, mapping changes, missing targets, unmapped services, unresolved windows and distinct observation cutoffs remain visible. Percentages carry numerator and denominator. With an empty denominator, the value is unassessed, not zero.

## 4. Named calendars and target policies

Calendars are operator-owned configuration, independent of provider expected dates. Each immutable edition contains:

```text
id, name, revision, timeZone, weeklyIntervals,
dateOverrides, effectiveFrom, effectiveUntil, sourceReferences
```

Use valid IANA timezone names. Weekly intervals are local wall-clock working periods. Date overrides explicitly replace a date's intervals, including holidays/closures and exceptional opening. Preserve their original source or operator attribution.

Policies contain a stable ID/name/edition, the applicable saved service/agency/priority mapping, durationMinutes, clockMode (elapsed or business), calendar edition when required, and the chosen source/assignment clock origin. Require an explicit rule when more than one policy matches. Never extract a numeric target automatically from a priority label.

Elapsed minutes compare absolute UTC instants. Business minutes intersect the task interval with the selected local working intervals, converting each date's boundaries to UTC independently. Overnight work is represented as two dated intervals. Reject overlapping intervals, ambiguous/nonexistent local boundaries without an explicit resolution, and calendars with no reachable working time. A bare “business days” target needs an explicit definition before it is converted to minutes.

Each saved report retains the exact calendar/policy editions and resolved time intervals used. Reopening a report reproduces its arithmetic when host timezone data or an operator's current policy changes. Targets do not rewrite provider fields.

## 5. Customer workflow and export behavior

SocietyWorks' administrator manual describes council/ward/category/date/status filtering, grouping by category/state/month/device, CSV export of Reports or Updates, and category-specific priority names/descriptions/external IDs. Its dashboard CSV is generated overnight and excludes the current day. Automatic import uses the selected export URL and a token; export=1 waits for a file, while export=2 returns HTTP 202 with a redirect to the future file location. [4]

Accordingly, the reporting desk supports named selections, separate source/report/review states, mapped service groups, explicit source dates and saved management commentary. A future dashboard CSV import retains whether it is Reports or Updates, its actual response/export parameters and observation time; HTTP 202 is a pending export operation until the actual file is received. The initial workbench consumes the complete collection envelope above.

The management report presents intake counts, source-status groups, assigned/reviewed workload, age or valid resolution duration, chosen-target performance and exact request drilldowns. HTML and CSV are rendered from the same immutable report edition; JSON includes all calculations, policy/mapping editions, cohort membership and source references. Escape source text for HTML and protect spreadsheet text cells when rendering CSV.

A complete report package includes its original collection export and raw response inventory, report definition, calculations, calendars, mappings, commentary and operation history. Reviewer returns name the original report/base revision and source request/version for each change. Changed bases produce a visible comparison; the operator can retain or incorporate each returned change into a successor edition. Exact request IDs support recovery after a lost response.

## 6. Original-data receiving journey

Use the already retained full Helsinki source carrier (9,730 bytes, SHA256 88a4bbe75bc199de29627610862a720ce56aac644de04a558c4067d4602ed300) and the complete collection export created from that source.

Import; choose the actual creation period; inspect all source statuses, blank service/agency fields and unavailable provider expectations; save an explicit operator calendar and target policy; save commentary; produce the complete report formats; transfer to an independent reporting workspace; reopen the same report; return one source-linked review change and incorporate it into a successor. Keep the source values and original collection identity through the whole journey.

The useful arithmetic checks exercise the actual saved source plus explicit operator configuration: repeat import, request deduplication across overlapping captures, zero or missing denominators, an overnight/holiday boundary and report reproduction after a newer calendar edition. These are focused checks of the customer calculation and receiving behavior.

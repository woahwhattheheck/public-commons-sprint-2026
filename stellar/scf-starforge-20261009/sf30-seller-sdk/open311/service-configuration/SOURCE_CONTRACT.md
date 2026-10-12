# Municipal service configuration: source and implementation contract

This module prepares one agency's service categories, staff access declarations, routing, due-date policy, notification wording and phased rollout as a versioned configuration and editable handover. It joins original municipal request records and the existing Follow-through and Field Desk products. A saved profile is a proposed configuration. A release binds a reviewed profile version to the exact imported source and preview used to assess it.

The source register gives the original published guides, their observed HTTP response identities, and the particular facts used below. The accompanying source examples preserve an actual Boston request and identify the containing original response. Entered staffing, calendar and service targets are visibly proposed policy.

## 1. Published behavior and the supported product

Comcate's category guide describes category names and status, optional department, whether a resident may or must supply a location, up to ten single-word keywords, a resolution interval in days, linked email templates and custom fields. Category order is editable; its Other category remains first. Its due-date formula uses creation date plus the category's resolution interval. The guide does not specify a timezone, business-day calendar, holiday set, daylight-saving convention or time of day. This module therefore records the agency's chosen timezone and calendar explicitly. [C131]

The assignment guide uses an Equals comparison against a submission category or a custom location field, followed by a default assignee and collaborators. This module supports that compatibility subset and labels its broader typed selectors as a local configuration model. Keyword suggestions remain separate from reviewed routing. [C241]

Comcate documents roles and groups, one required role per user, CRM enablement, product administrator status and Read-only, Basic and Overwrite access. The group documentation provides optional group membership and permission declarations. The guides do not define a reliable role-versus-group permission precedence algorithm. The role/group restrictions on changing permissions with assigned users are deployment constraints; an internal profile draft remains editable. [C179, C180, C181, C130]

The template guide allows custom email templates with a subject, content and related documents; existing SMS templates can be edited, but custom SMS templates cannot be created. It documents the native merge names {{case_number}} and {{issue_number}}, and a citizen review link. This module prepares email wording and template previews; its other placeholder names are explicitly local handover names. [C184]

An original submission may be closed and reopened. Comcate also documents an optional setting that closes a submission when its code case closes. Neither behavior proves that physical work was completed. Category-level and individual-submission public-map visibility are separately configurable. Anonymous intake depends on the agency's global setting, its Accounts feature and then the category setting. Those dependencies belong in the deployment checklist when used. [C129, C140, C360, C344]

Published customer implementations describe agency-specific categories and ownership, staff communications at workflow stages, and rollout from staff to commissioners and residents. These support a practical configuration, training and handover workflow. They do not establish access to a particular tenant or the chosen agency's service targets. [ATHENS, CONVERSE, VISIBILITY]

## 2. Profile definition

Object IDs are nonempty stable strings and unique within their collection. References use IDs, never display names. Names, descriptions, notes and source labels remain editable. A profile retains its complete definition, version ID, original operation and content identity. Saving a successor creates a new immutable version.

ProfileDefinition:
- name: string
- agency: { id, name, timeZone, calendar: { kind, weekdays, holidays } }
- departments: Department[]
- staff: Staff[]
- roles: Role[]
- groups: Group[]
- categories: Category[]
- templates: Template[]
- routes: Route[]
- sourceProfiles: SourceProfile[]
- rollout: RolloutPhase[]
- note: string

Department = { id, name, active }.

Role and Group = { id, name, description, active, permissions, sourceLabel?, sourceReference? }.
Permissions = { crmEnabled: boolean, crmProductAdmin: boolean, crmAccess: "none" | "read_only" | "basic" | "overwrite" }.
Default permission declaration is false / false / none. Product administrator status or an access level other than none requires crmEnabled. The declaration records intended grants; it does not authenticate an operator or enforce access to a vendor tenant.

Staff = { id, name, departmentIds: string[], roleId: string, groupIds: string[], contact: string, active: boolean }.
A staff entry has exactly one roleId. Group membership is derived from staff.groupIds, avoiding a second independently editable list of members. References must resolve. Active routing targets must be active staff in the selected department. A conflicting role/group declaration is shown for review, without inventing the vendor's grant precedence.

Category = {
  id, sourceSelectors, name, description, active, isOther, displayOrder,
  includeLocation, locationRequired, departmentId, ownerStaffId,
  keywords, resolutionDays, publicMapDefault, customFields, templateIds
}.
sourceSelectors = [{ sourceProfileId, field: "serviceCode" | "category" | "serviceName", value: JSONScalar }].
keywords is an array of at most ten distinct single-word strings. Preserve entered casing, while an implementation may show a separate normalized suggestion key. Keyword suggestions do not select a route.
resolutionDays is null or a nonnegative integer. Null means no configured target. An integer is the entered target, not an inferred provider SLA.
publicMapDefault is "show" or "hide".
locationRequired requires includeLocation. At most one category isOther; when present it is first in displayed order. Duplicate source selectors across applicable categories are a conflict. Do not silently choose the first row or the lowest displayOrder.
CustomField = {
  id, label, kind, scope, required, options, helpText,
  sourcePointer?, defaultValue?
}.
kind = "text" | "number" | "boolean" | "date" | "single_select" | "multi_select".
scope = "submission" | "location".
options = [{ value: string, label: string }].
These field types are this module's neutral schema. Source labels and original values are retained; no assertion is made that they enumerate all native vendor field types.
Select fields require unique option values. Other types have an empty options array. A supplied default must match the declared type; date values are valid Gregorian YYYY-MM-DD dates. An absent default remains absent.

Template = { id, name, audience, stage, subject, body, locale, active }.
audience = "staff" | "resident".
stage = "received" | "assigned" | "in_progress" | "resolved" | "closed_other".
subject and body are literal text with the allowlisted placeholders in section 6. Rendering escapes the result in the browser; it does not execute HTML, JavaScript or arbitrary expressions.

Route = {
  id, name, active, categoryIds, sourceProfileIds, selectors,
  departmentId, ownerStaffId, collaboratorStaffIds, templateIds, note
}.
selectors = [{ field: string, operator: "equals", value: JSONScalar }
           | { field: string, operator: "in", values: JSONScalar[] }].
The field names resolve through an explicit semantic mapping or custom:<categoryFieldId>. Submission-category and custom-location selectors identify their scope in the profile. A custom location field used by a Comcate-compatible rule must reference an actual declared field with scope location.
There is no implicit rule priority. Match behavior is defined in section 4.

SourceProfile = {
  id, name, kind, rowsPointer, mapping, statusMappings,
  publicMapOverrideMapping?, note
}.
kind = "open311_georeport_v2" | "follow_through_dispatch_v1"
     | "field_destination_update_v1" | "mapped_records".
mapping is a keyed object of semantic fields to exactly one of { pointer: string } or { literal: JSONValue }.
statusMappings = [{ sourceValue: JSONScalar, stage, completionMeaning: string }].
publicMapOverrideMapping = {
  values: [{ sourceValue: JSONScalar, publicMap: "show" | "hide" | "default" }]
}.
Its input is the value resolved by mapping.publicMapOverride; the override declaration does not carry another pointer.
A mapping's pointer is a JSON Pointer relative to one selected original row. A rowsPointer is relative to the imported complete JSON document. Pointer decoding follows the ~0 / ~1 escaping rules and own object members; there is no evaluation of expressions. An empty pointer selects the complete value. Missing pointer, null, empty string and literal value remain distinct.
A literal is an entered mapping choice and is labeled as such, rather than attributed to the original source.
Status mappings match exact typed values, preserve the original status and notes, and express the operator's intended communication stage. Duplicate sourceValue mappings conflict.
Each public-map sourceValue must appear once; section 7 defines explicit default, absent and unknown values.

RolloutPhase = {
  id, name, audience: "staff" | "commissioners" | "resident",
  categoryIds, departmentIds, ownerStaffId,
  trainingItems: string[], entryCriteria: string[], exitCriteria: string[], note
}.
Rollout order is the array order. It records named owners, actual audiences, training and measurable acceptance criteria.

The agency calendar is { kind: "calendar_days" | "business_days", weekdays: number[], holidays: string[] }.
timeZone is an explicit IANA timezone. Weekdays use Sunday=0 through Saturday=6. Holidays are explicit valid YYYY-MM-DD local dates. A business-day calendar requires at least one weekday. A calendar-day policy ignores weekday/holiday exclusions for arithmetic while retaining them as declared configuration.

## 3. Source profiles and exact upstream seams

A source import retains the complete original file bytes, filename/content type when available, SHA-256, original URL/capture metadata, chosen profile and row location. An imported subset is labeled a subset with its original containing-response identity and selected rows. An example row does not establish the completeness of a city-wide cohort.

Open311:
- rowsPointer "" for a response array.
- requestId <- /service_request_id
- issueNumber <- /service_request_id when the selected template needs {{issue_number}}
- serviceCode <- /service_code
- serviceName <- /service_name
- status <- /status
- statusNotes <- /status_notes
- createdAt <- /requested_datetime
- updatedAt <- /updated_datetime
- address <- /address
- map values, case IDs and citizen links require explicit mappings when present.

Follow-through:
- schema commons.open311.follow-through-dispatch.v1; rowsPointer /rows.
- Each dispatch row has key, serviceRequestId, sourceSha256, request, orders, work, geometry and mapped.
- request contains the original normalized request and its untouched source object. orders contains approved linked orders; work is the approved local work record.
- A complete follow-through workspace has schema commons.open311.follow-through-workspace.v1 and records of {kind,id,value}. Select and validate the intended dispatch record explicitly before using the dispatch profile.
- Source request status and the approved dispatch action remain different fields. Entered routing and due dates cannot rewrite either source.

Field Desk:
- schema commons.open311.field-destination-update.v1; rowsPointer /items.
- The complete update contains id, name, workspaceId, workspaceRevision, createdAt, reviewer, destination, note, items, attachments, totals and sha256.
- Each item retains its visit, original sourceRow, source/approval references, crew and dispatch definition.
- A field visit completion or request_closure destination action is a reviewed local action. The original external request status is retained until an actual provider result changes it.
- Service mapping is explicit through the item's retained sourceRow/request or operator-reviewed destination fields. The adapter must not assume a /rows array or flatten away original approval/source identity.

Mapped records:
- A complete arbitrary JSON array/object can be used with rowsPointer and explicit mappings.
- Dates are accepted only under the declared mapping and date interpretation. A string such as 10/08/2026 is not parsed by guessing whether it is month-first or day-first.
- IDs are retained as original strings/numbers. Converting a numeric identifier requires exact representability; unsafe JavaScript integers produce an input diagnostic.
- Original pointer values and source identity remain available beside the configured interpretation.

The supported mapping keys are requestId, serviceCode, category, serviceName, title, description, createdAt, updatedAt, closedAt, status, statusNotes, address, latitude, longitude, residentEmail, trackingUrl, publicMapOverride, issueNumber, caseNumber, workOrderIds, completionNote, progressSummary and magicLink. Selectors for declared category custom fields use custom:<categoryFieldId>. There are no compatibility aliases for earlier draft mapping names. The {{issue_number}} token resolves only from issueNumber; requestId is not an implicit fallback.

## 4. Deterministic category, route and ownership preview

1. Resolve the selected source profile and preserve each original row.
2. Evaluate exact category selectors applicable to that source profile. An active category may match on serviceCode, category or serviceName; two matching categories are a conflict.
3. Evaluate each active route's eligibility. Values within categoryIds and within sourceProfileIds use OR; an empty list explicitly means all. Both eligibility dimensions and every selector within a route must match.
4. Selector comparisons preserve JSON type. "2" and 2 differ. equals has one value; in has a nonempty list. No substring, fuzzy match, coercion or rule-order tie breaker is applied.
5. A single matching route produces proposed department, assignee and collaborators with the route ID as its basis. With zero matching routes, an identified category's valid recorded defaults may be shown with basis CATEGORY_DEFAULT. Otherwise assignment remains unresolved.
6. Two or more matching routes produce a conflict even when their owners happen to match. The operator can narrow or remove a selector and create another profile version.
7. Resolve every referenced active staff, department, collaborator and template. Invalid ownership or missing required field is a row diagnostic, not a silent fallback.

The Comcate-compatible export subset is Equals against submission category or a custom location field, plus default assignee and collaborators. Local in conditions and other semantic fields appear as proposed rule requirements in handover, not as invented native API payloads.

A planned assignee is visibly a proposed routing result. An "assigned" or progress notification preview states its configured action basis; it is not proof that an external work-order assignment occurred. Reassignment, source status and local approved actions remain separately inspectable.

## 5. Due-date arithmetic

For an offset-bearing creation instant, convert it to the configured agency timezone and take the resulting local Gregorian date. Add the category's configured number of days to that civil date, not to an epoch by multiples of 86,400 seconds.

- calendar_days: increment the date by the specified number of calendar days.
- business_days: increment one date at a time after the creation date and count only selected weekdays that are not in the explicit holiday set.
- zero days: return the creation local date without rolling it to a business day.
- null target: retain dueDate null with basis NO_TARGET.
- Missing, invalid or timezone-ambiguous source date: retain the original value and expose an unresolved date diagnostic.
- A date-only source can be used only by an explicit date-only mapping policy; it is already a local date and must not be silently treated as UTC midnight.
- Daylight-saving transitions do not add or remove a civil day. The output is a date-only target, not an invented deadline instant or hour.

A preview retains source creation value, interpreted creation local date, timezone, calendar, interval, computed date and profile version. An imported source expected_datetime remains original data; it is not overwritten by the proposed target. Any comparison labels both values and their independent bases.

The supplied Boston record was created at 2026-10-08T11:28:01Z. Under the explicitly proposed America/New_York policy this is October 8. A proposed two-calendar-day target is October 10; a proposed two-business-day target with Monday–Friday and no holidays is October 12. These are examples of this profile's chosen policy.

## 6. Template allowlist and honest progress wording

The exact local token allowlist is:

{{agency_name}}, {{issue_number}}, {{case_number}}, {{service_category}},
{{department_name}}, {{assignee_name}}, {{request_created_date}},
{{request_updated_date}}, {{due_date}}, {{source_status}},
{{source_status_notes}}, {{location}}, {{work_order_ids}},
{{completion_note}}, {{progress_summary}}, {{magic_link}}.

Only {{issue_number}} and {{case_number}} are documented here as Comcate native merge names. Every other name is part of this module's rendered preview/handover. A vendor deployment task maps it to the tenant's actual supported field or renders the desired fixed content.

Use explicit semantic values and the selected profile. Do not evaluate dot paths, loops, expressions or arbitrary object keys inside templates. A missing selected token remains visibly unresolved with its token name; it is not replaced by an empty string. Preserve the exact template, resolved values, unresolved set, source row, profile version and rendered result.

magic_link requires a source-mapped or explicitly entered permitted HTTPS citizen-review URL. Do not construct a link to a staff session or internal engineering location. It remains unresolved when no suitable original URL exists.

Staff-only owner notes and internal progress values do not become resident wording automatically. A resident-facing template uses explicitly supplied public wording and selected public source values. Assignment, completion and closure statements retain their action/source basis. A preview never creates an actual sent-email event; actual provider sending and readback would be a separately implemented transport.

The original Boston example has status "closed" with notes "Resolved. Citation issued. - Property has been cited." Its proposed mapping uses stage closed_other and retains that literal disposition. Neither the template nor the category should change the statement into "the trash was removed" or infer a repaired asset.

The guides describe attachments in email management and related template documents. The current profile DTO does not introduce a new attachment transport. Existing original source/Field Desk attachment identities can be referenced in the operator's handover and deployed through an actual supported integration.

## 7. Public-map and anonymous-intake settings

Category publicMapDefault supplies the proposed default. When publicMapOverrideMapping is configured, the original per-request value is read through mapping.publicMapOverride and compared with its values array of {sourceValue,publicMap} entries.

- Missing or null override means inherit the category default.
- A recognized show/hide entry records the original value and chosen override.
- A recognized default entry explicitly inherits the category default and retains that basis.
- An unrecognized non-null value is a visibility diagnostic.
- Duplicate sourceValue entries are a profile error.
- A request lacking a resolved category has unresolved default visibility.

A visibility preview lists the original reference, resolved visibility and its basis. It does not publish the complete raw source object, names, addresses or internal notes by default. Any later public-map publication must use an explicitly selected display-field mapping and the receiving system's actual behavior.

The published anonymous-intake dependency is retained as a deployment requirement when relevant: agency Accounts enabled, global anonymous allowance, then the category allowance. This initial DTO does not claim to provision those live settings; handover records their actual receiving-system values and any remaining configuration action.

## 8. Prior deployed profile, migration and rollout

An internal draft can change roles, groups, users and permissions. Its predecessor and changes remain available. The vendor restriction applies when editing a role or group already associated with users in a deployed tenant.

When comparing to a known deployed baseline, include a migration table with the exact affected IDs, old/new permissions, assigned users and proposed sequence:
1. Create a replacement role/group with the reviewed target permissions, or schedule a detach/edit/reattach sequence.
2. Reassign affected users through the actual supported user/membership workflow.
3. Verify their intended access declarations and active operational ownership.
4. Retire the superseded declaration only after the reassignment is complete.

The plan records the chosen sequence and reviewer. A profile save does not execute it. If the deployed baseline or memberships are unavailable, mark those particular migration inputs unresolved and still retain the complete editable target profile. Do not fabricate current users or turn that unknown into a blanket prohibition on draft engineering.

A rollout phase includes named owner, categories/departments, audience, training items, entry criteria and exit criteria. A practical sequence is staff preparation and operating walkthrough, limited commissioner use where appropriate, then resident rollout. This is an adjustable plan based on the published adoption example, not a requirement that every agency has a commissioner pilot.

The complete handover includes:
- editable agency profile and all immutable versions used by releases;
- original imported source files and their metadata/identity;
- full preview rows, diagnostics, matched rule/category and ownership basis;
- date-policy inputs and computed targets;
- exact templates and rendered/unresolved outputs;
- public-map decisions and migration/apply-order tasks;
- rollout training and acceptance records;
- complete exports and operation history for independent receiving.

## 9. Storage and transport join

The agreed route families are state, profiles, sources, previews and releases. Profile/source writes and release construction retain requestId and expectedRevision. Source and profile IDs in a preview identify immutable versions. Changing a draft cannot silently mutate an existing preview or release.

A preview offers paginated rows for the browser and a complete downloadable result. Summary counts include original rows, matched/unmatched categories, unique/conflicting/unassigned routes, unresolved dates/tokens and visibility diagnostics. A release binds its exact preview, definition/source identities and operator review; any unresolved required migration or input is enumerated in the receiving handover.

A complete source import and full export keep the original bytes and history together. Independent receiving validates the envelope, identities and references before reopening the same editable product. Existing request/source identity is not changed by category names, staff display names, new notifications or configured date targets.

## 10. Source references

[C131] https://comcate.elevio.help/en/articles/131-crm-category-management
[C241] https://comcate.elevio.help/en/articles/241-assignment-rules
[C179] https://comcate.elevio.help/en/articles/179-user-permissions
[C180] https://comcate.elevio.help/en/articles/180-user-roles
[C181] https://comcate.elevio.help/en/articles/181-user-groups
[C130] https://comcate.elevio.help/en/articles/130-crm-user-permissions
[C184] https://comcate.elevio.help/en/articles/184-template-management
[C129] https://comcate.elevio.help/en/articles/129-managing-a-submission
[C140] https://comcate.elevio.help/en/articles/140-crm-submission-settings
[C360] https://comcate.elevio.help/en/articles/360-configuring-categories-and-individual-submissions
[C344] https://comcate.elevio.help/en/articles/344-allowing-anonymous-submissions-on-a-category-level
[C142] https://comcate.elevio.help/en/articles/142-managing-emails-on-submissions
[ATHENS] https://www.comcate.com/blog/athens-clarke-county-resident-service-request-management
[CONVERSE] https://www.comcate.com/blog/converse-tx-resident-service-request-crm
[VISIBILITY] https://www.comcate.com/blog/visibility-important-work-completed-public-service

Published help pages were read in full on 2026-10-12; their precise response and article identities are in SOURCE_REGISTER.json. Some pages have different publication dates and describe different permission-management screens. The contract retains those differences and uses a declared neutral model wherever the source does not settle precedence, field types or deployment details.

# Mooring service operations

## Start with the actual mooring

This workbench keeps an asset's owner, vessel, position, permit, seasonal jobs, original field findings, repair work and municipal handoff together. It is a complete offline working copy: there is no account login, external message sender, municipal connection or automatic engineering decision. The six-company catalogue supplies published operating context. Your actual assets, crews, equipment, dates, conditions and authority decisions are entered separately.

Open the standalone HTML in a modern browser. The initial workspace has no customer, asset or job records. Select the relevant operator and give your working copy a useful title when starting a new workspace. Enter your name in the recording-operator field so subsequent decisions retain their author. Use **Export complete JSON** after useful progress. A browser copy is a convenience on that browser; the exported JSON is the portable original working record.

**Load worked example** opens a clearly labelled six-operator programme. The companies and public workflow descriptions are source-based, while all owners, vessels, permit decisions, positions, crews, prices and job outcomes in the example are invented. Contacts are blank. The example exercises spring/fall gear handling, a repair and recheck, an explicit inspection exception, returned town issues and a revised submission, prepared versus manually recorded notices, and reviewed CSV intake. Export any current work before replacing it with the example.

## 1. Establish people, equipment and asset identity

In **People and equipment**, record the actual owner, working crew and contacts. Choose the person's role explicitly. Add actual workboats and equipment; a published description of an operator's barge does not automatically create an available resource. Mark a record inactive when appropriate instead of repurposing an old identity.

In **Moorings**, save the permanent mooring label and your original reference. Set the municipality and harbor separately, link its owner, and enter the original vessel name, registration, type, length and unit. Preserve source position notation, latitude, longitude, datum and the record's provenance. A blank or unknown coordinate is not silently geocoded. The app does not translate an anchor description or a vessel length into a load rating.

Record the season and actual anchor description. **Inspection due** and **Service due** are explicit local calendar dates. **Timing source** holds the permit rule, operator decision or original reference that produced them. Nothing calculates a due date from a general three-year statement. The Day view highlights the entered dates that have become due in that operator's time zone.

Open the asset again to see its related jobs, permits, components and original history. A saved completed job keeps its original asset, owner, crew and equipment snapshot even if you later update today's asset or contact record.

## 2. Register components and gear movements

Use **Gear and evidence** to record components independently: anchors, chain, shackles, swivels, buoy, pennant or other actual equipment. Give each item a meaningful label, kind, description, original serial/reference and installation date when known.

A new component's physical state is unknown. Editing its descriptive record does not install or store it. Use **Record gear movement** to select the affected component IDs and record the actual state, location, event time, related job and reason. The movement retains its prior state and storage location.

Spring installation, replacement with a winter marker, washing, summer-gear storage and retirement remain distinct events. A storage rack is a location, not a new asset. Retired components remain in the history. Review current storage before a later seasonal job so the operator can trace the same physical equipment.

## 3. Record the applicable permit

In **Permits and town review**, choose Permits and enter the actual jurisdiction, reference, validity dates, requirements and original source URLs. The record starts as draft. An edited permit returns to draft; old reviewed jobs and reports retain their earlier source snapshots.

Record a permit decision only after it has occurred outside this app. Select approved, returned or rejected, the actual time, authority reference and reason/issues. This action records the decision; it does not apply for a permit or contact the harbormaster.

For a job requiring a permit, select the actual approved permit for that mooring. A source mentioning Duxbury approval does not impose the same rule on every municipality. Validity, jurisdiction and source changes are checked again when the job is reviewed.

## 4. Plan and confirm the real field visit

In **Jobs**, select the asset and enter the title, work kind and full start/end timestamps with an explicit offset, for example `2026-10-20T09:00:00-04:00`. Retain the display time zone. Select the actual crew and required boat/equipment. Scheduling operates over real instants; a time zone label alone cannot resolve an ambiguous daylight-saving clock.

Choose whether this job requires an approved permit or finalized inspection. Enter the real checklist, using separate rows for meaningful checks, and preserve any source work-order reference. Unpublished durations, crew assignments and availability start blank.

Save the request and use **Review confirmation**. Read the findings and complete saved-source snapshot. Confirmation is bound to that workspace revision and review hash. An inactive owner or crew member, unavailable resource, overlapping assignment or unsuitable permit produces a visible issue. Correct the original record and run a new review rather than treating a previous approval as current.

**Record actual start** only when work starts. The timestamp must lie inside the confirmed interval and the source must still match the review. A requested or confirmed visit can be cancelled with a reason before field work. Do not invent an actual start or completion to clear an appointment.

If an in-progress visit must stop, use **Record stopped field work**, enter the actual stop time and reason. The aborted job preserves the partial checklist, inspection, evidence and assignments and releases its occupied schedule. It remains distinct from completed work and cannot serve as a completed municipal handoff. Create a subsequent job for later work.

## 5. Capture inspection findings and original evidence

While a job is in progress, add its inspection in **Inspections and repairs**. Choose the actual method: hauled, dive, visual or other. Record the observation time and summary. Each finding links to its original component where applicable and preserves the entered condition, measurement, unit, note and evidence IDs.

Condition choices are serviceable, attention, unsafe and not-assessed. A measurement is an observation; this software supplies no rejection threshold or engineering certification. A not-assessed item remains unresolved rather than becoming serviceable by omission.

Upload the actual original attachment through **Gear and evidence**, bound to the operator, mooring and optional job. The maximum is 8 MiB per attachment and 24 MiB in original evidence across one working file. The app retains file name, MIME type, exact bytes and SHA-256. Each attachment has an individual download action. Finalized inspection and job snapshots preserve its identity/hash; the original bytes stay with the evidence record, avoiding repeated copies in every historical snapshot.

Select the appropriate evidence on each finding, then **Finalize original inspection**. The observations and selected evidence are frozen. Do not rewrite a finalized finding to hide a later repair. The app retains the original condition and links the follow-through.

An unresolved attention, unsafe or not-assessed finding needs completed linked repair work or an explicit recorded exception before ordinary job completion. An exception records the actual responsible decision and reason; it does not certify that a mooring is safe. Source requirements and professional judgment remain with the responsible operator.

## 6. Record repairs, time and parts separately

Create repair work on the in-progress job. If it responds to a finding, select the inspection and copy that finding's exact ID. Preserve a clear description, each part's quantity/unit and entered unit price, actual minutes, currency and work notes.

Prices use integer minor units: USD 1,250 means $12.50 per entered unit. Currency must be three uppercase letters when a price is entered. Blank prices and minutes stay unrecorded. The displayed known-parts total does not assign missing prices or calculate a labor charge, tax or invoice.

Record actual completion with its time and result. Reopen completed or cancelled repair work only while the parent job is still in progress, with a reason. A cancelled open repair remains visible with its reason and time in the working record, operating CSV and readable report. Prior completion, cancellation and reopen summaries remain visible too. Cancellation does not resolve its linked inspection finding. Complete the required work or record a responsible exception separately.

Kennebec's published time/materials repair workflow is an example of why repair charging and municipal inspection reporting stay separate. The workbench records those inputs and references without asserting that payment has occurred.

## 7. Complete the job from its current record

Return to the job, record each actual checklist result and its note, then choose **Review completion**. The review considers the recorded start, required checks, finalized inspections, unresolved findings, repairs and current source. Correct any actual deficiency in the relevant record.

Enter the real completion time only after the review is ready. The completed record freezes the asset, owner, assignments, permit, checks, findings, repairs and evidence references used for that decision. Closed field records are preserved. Further seasonal work belongs to a later job rather than changing a completed visit.

The Day view shows the requested/confirmed/in-progress/completed/aborted status and entered due dates. Its selected calendar day and display zone help the operator inspect real overlaps; it does not route a vessel, infer travel time, assign a crew automatically or determine sea conditions.

## 8. Prepare and record the municipal handoff

In town review, choose Submissions. Select the mooring, actual completed jobs, finalized inspections, applicable permit and receiving authority. Retain its original authority reference and notes. Use **Review submission** and inspect the original report source.

Recording a submission requires the actual outside submission time and reference. It stores that event and an immutable snapshot, but does not send an email, upload a form, pay a permit fee or confirm delivery.

When the authority responds, record approved, returned or rejected with its actual time and reference. Enter every returned issue as a separate row. A returned handoff remains returned in the history. Prepare the corrected handoff as a new submission with the earlier submission ID selected as its predecessor; review and record that later submission independently. This keeps the original returned question and later response attached to the same asset.

The Brunswick worked context is jurisdiction-specific: its owner/vessel/property pages, saved application, returned issues and approval before payment are separate administrative steps. They do not become universal town rules in this app.

## 9. Prepare notices and retain real sends

In **Notices**, select the asset, optional job, recipient, channel, actual destination and message body. Saving creates a prepared notice. There is no outbound transport.

After an authorized notice is actually sent or communicated through the existing channel, record its time and reference. Prepared and recorded-sent notices remain distinguishable. Cancel a prepared notice with a reason if it is no longer needed. The demonstration includes both states and makes no claim that a real owner or town was contacted.

## 10. Bring in original CSV without losing the source

Choose the original CSV in **Intake and handover**. The file is limited to 8 MiB and 10,000 rows. Its full original text is retained. Map exact source columns to the mooring fields. For an operator, owner, municipality or other fixed input that is not a CSV column, enter an explicit constant. Do not choose a column and constant for the same destination field.

Review every parsed row. Choose **Create**, **Link** to a specific saved mooring, or **Ignore** with a reason. A link retains source provenance without overwriting today's owner, coordinates or permit history. The review binds the original text, mapping and current workspace revision; changing any of those requires a new review. Duplicate source/mapping intake is rejected instead of silently adding another set of assets.

The buyer publishes CSV import/export, but no machine header contract or public API was provided by the reviewed product pages. This workbench supplies an explicit reviewed onboarding file and operating record; it does not claim an automatic import into MooringOps or its municipality's system.

## 11. Export, receive and continue

**Export complete JSON** is the authoritative working handover. It contains the catalogue, every current row, original CSV text and decisions, original evidence bytes, immutable review snapshots and full before/after history. The core enforces a 64 MiB complete working-file limit before accepting a mutation, so rejected growth leaves the prior workspace intact.

**Export operating register CSV** produces a keyed record table for all current inventory, jobs, checklist outcomes, inspections/findings, repairs, permits, authority handoffs, gear movements, notices, evidence indexes, people/equipment, intake indexes and change indexes. The operating detail JSON column preserves the chosen values. Spreadsheet-active scalar prefixes are escaped for viewing. Full raw source bytes and nested historical snapshots remain in the working JSON.

**Export readable handover** presents those same operating scopes as readable tables, with original record/evidence IDs, file names, measurements, conditions, known amounts, timestamps and returned issues. It is an operating report rather than an importable project or invoice. Download original evidence separately when handing over attachments.

To continue elsewhere, open the same standalone app and choose the complete JSON. Inspect its title, revision and counts, then explicitly replace the current workspace. Export the current copy first when needed. A selected new file invalidates any older pending receipt; an interrupted read or changed form cannot silently replace current work. Reopen the exported JSON and inspect the preserved returned submission, original field attachment and completed job snapshot.

## Source distinctions retained in this edition

- Mattakeesett's annual Duxbury permitting and approval-before-change are linked to the actual permit. Its approximate three-year chain/shackle replacement is condition-dependent, not a universal inspection law.
- Triad's three-year service-area inspection description and photographed hauled measurements stay distinct from equipment replacement.
- Pioneer's original permit coordinates and existing GPS capability retain their source notation and datum.
- Campbell's town-number checks, seasonal assemblies and automatic service programme are workflow context. Six named harbors are location categories, not six mooring assets.
- Lower Cape Marine Services supports both dive and hauled inspections. Float/dock work remains a separate selected job.
- Kennebec's municipal inspection report and separately charged repairs remain separate records. A broader 300-client seasonal statement is not a mooring inventory count.
- The current Mattapoisett page contains conflicting inspection-cohort wording, including the literal “501 - 100,” and an older 2024 paragraph near its 2026 table. No automatic due-date schedule is generated from it.
- Official Brunswick instructions illustrate one authority's owner/vessel/property, saved application, returned issues and approval/payment sequence. The original PDF and current municipal page remain in the source refresh.

The original source routes and retrieval distinctions are retained in SOURCE-REFRESH.json. Current operator facts were refreshed on 13 October 2026. Recheck the relevant original authority before changing an actual permit requirement or schedule.

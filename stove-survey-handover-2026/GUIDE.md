# Stove work and handover

This operating worksheet connects an original enquiry to the surveyed property and appliance, the exact quotation the customer accepted, the actual site visits, field findings and customer handover. A later service or remedial visit continues from those records. The complete working JSON is the portable working copy: it contains every retained original file, record edition, decision and change history.

The six reference companies provide concrete examples of how work is organised. They do not provide real customer jobs, live staff availability, installation measurements or permission to act for them. The supplied worked programme uses fictional job and customer labels. Begin actual use with your own selected records and responsible people.

## 1. Choose the operator and protect the working copy

Choose one company in the header. Sites, enquiries, quotations, jobs and visits are shown for that operator. Switching company clears selected records and pending reviews so another operator's job cannot remain on screen. The complete working file can contain all six operators and retains that separation.

Use **Save working JSON** regularly. It downloads the full editable workspace, including original attachments. A separate browser copy is a convenience on the same browser; downloaded JSON supports independent receiving and recovery. If storage is unavailable or full, download the working file instead. The application never assumes that a browser copy is permanent custody.

Form changes take effect only when saved. Navigation and successful actions that would replace another unsaved form ask before discarding it. Declining leaves the existing form intact. A failed command leaves both saved work and the form available for correction. Reports and downloads represent saved records; the interface tells you when unsaved form changes are excluded.

In **Workspace & history**, choose a complete working JSON to validate it before replacement. The current workspace remains in place during reading and validation. A later file selection, navigation, edit or saved change prevents an older asynchronous result from replacing newer work. Replace the current copy only after checking its identity and record counts. Download the current working JSON first if both copies must be retained.

## 2. Sites, appliances and original enquiries

A customer reference and a property reference are separate. A customer may own several properties, and one property may contain several appliances. Enter the actual property address, operator-provided contact and access details. The property reference is unique within the selected company.

Create each appliance with a practical label. Manufacturer/model, serial number, fuel, location and installation date remain the values you supply. Blank technical fields stay blank. Updating the current appliance does not rewrite a finalized survey, issued quotation, started visit or completed handover that captured an earlier version.

An enquiry records the source reference, requested work, requested date and original details. Attach the original photographs or documents from **Files & CSV intake**. A request is not a confirmed appointment. Close an enquiry with a reason; reopen it explicitly if work resumes. A later related enquiry can retain the same site and appliance while keeping its own original request.

Original evidence is retained without overwriting the supplied file. Add one original at a time, up to 8 MiB each, within the complete workspace's 64 MiB bound. Retain the filename, media type and purpose, and associate it with a site or job where appropriate. Downloads reproduce the retained bytes. For CSV interpretation, valid UTF-8 markers and line endings remain in the original; malformed text is rejected during interpretation.

## 3. Survey drafts and finalized editions

Select the property, related enquiry and appliance, then record the actual survey time with an explicit offset and the responsible surveyor reference. The observations and appliance proposal describe what the operator actually inspected or proposed.

The measurement editor uses one row per observation:

    Label | retained value | unit | source

For example, a demonstration row may describe a measured opening and its field note. The programme stores the entered value as text. It does not calculate a safe clearance, liner size, appliance output or installation design. Use the responsible operator's own measurement source and technical assessment.

The check editor uses:

    Label | unreviewed / pass / fail / not-applicable | notes | evidence IDs

Evidence IDs are shown beside retained original files. Separate multiple IDs with commas. Add only the checks selected for this actual survey. An unanswered check remains unreviewed. A recorded failure stays a failure and remains visible; finalization is preservation of the survey edition, not a declaration that an installation is safe.

Save the draft, then **Review saved survey**. Resolve missing observations, author, timing or selected check details. Finalization binds the exact survey and site/appliance snapshot. To amend a finalized survey, create a replacement edition. The old survey and references stay intact. Enter the new edition's actual survey timing and author before finalizing it.

## 4. Itemised quotations and recorded decisions

Select the relevant finalized survey and appliance. Enter the issue date, expiry, currency, work scope, exclusions and actual terms. Written exceptions belong in those terms. A reference company’s general policy does not automatically populate an agreement.

The quotation line editor uses:

    Description | quantity | unit price

Quantity supports up to three decimal places; price uses two decimal places. Enter the discount, tax percentage and required deposit explicitly. Enter zero when zero is the deliberate choice; blank means unknown and blocks issue. The application calculates the item totals and chosen tax from those explicit inputs. It does not infer a tax rate or price from the website.

Review the saved quotation and issue it only when its source and totals are correct. Issuing preserves the quote content and the survey/site/appliance edition it used. Record the actual customer decision separately, with its time, decision-maker reference and original acceptance or refusal reference. This action stores the decision; it does not send a message or obtain consent.

An expired quotation cannot be newly accepted. Create and issue another edition with explicit dates and terms. A replacement preserves the earlier edition and its decision. Existing job scope does not silently change when a new survey or quotation is prepared.

## 5. Define the job and confirm actual visits

A job may select an accepted quote or carry explicit quote-free service scope. The quote must match the site/appliance and cannot be reused as the accepted scope for another job. Use a parent-job link for variation or remedial work.

Configure the work checklist and handover requirements for this job. The work-check editor uses:

    Label | required yes/no | original evidence required yes/no

The handover-requirement editor uses:

    Label | document / acknowledgement / certificate / other | required yes/no

These rows are operator-selected records. A certificate requirement retains the actual original document and its reference; the worksheet does not issue or authenticate certification. Do not use a company's general website claims as completed evidence for a specific property.

Create each planned visit with its actual work type, explicit start and end instants, timezone label and worker references. An ISO instant includes its offset, for example the format 2026-10-15T09:00:00+01:00. The offset identifies the actual instant; the IANA label identifies the operator's chosen display context. Do not enter an ambiguous local clock without an offset.

A new visit is requested. Review it before confirmation. Confirmed overlaps for the same job or worker are surfaced as conflicts. Public opening hours and team listings are not availability calendars. Editing a confirmed visit resets it to requested and preserves the previous confirmation; review the changed assignment again.

Start a confirmed visit using the actual start time and responsible worker. This freezes its job, property, appliance, quoted scope and configured checks. Started work is not moved to another time by editing its appointment. Finish or abort it and create a successor visit when work continues.

## 6. Field observations, findings and actual documents

Append a field record during a started visit. Record actual observations, measurements, author and time. Enter results only for the checks addressed by that observation. The form offers pass, fail or reasoned not-applicable; leaving a check blank does not imply a pass. A passing check configured to need evidence must link an actual retained original.

Field records are immutable observations. A correction is another field record. The current checklist uses the latest explicit result for a check, while earlier observations remain available. A required failed check blocks handover until an explicit later observation resolves it.

A finding has its own description, severity and evidence. A follow-up finding may remain open and visible in a handover; an unresolved blocking finding prevents current readiness. Resolve a finding with an actual explanation and any supporting original evidence. Reopen it with a reason when warranted. A new blocking finding after an earlier handover changes current readiness while preserving that earlier handover exactly.

Record required documents and acknowledgements using their real references, responsible recorder, time and original attachments. A required certificate or document recorded as present needs actual evidence. A reasoned not-applicable entry is the responsible operator's explicit determination. Corrections append their reasons instead of erasing prior entries.

Finish a visit only after at least one field record. This records the attendance and work done, not automatic completion of every job requirement. If access, weather, materials or an unsafe condition means work stops, abort the visit with its actual withdrawal time and reason. Its partial records stay intact. The later job or visit can address the outstanding work.

## 7. Receipts, reviewed handover and later service

Record an external receipt or refund with the actual amount, currency, date and original payment-system reference. These entries do not execute payments. A correction links to its original entry; the original remains visible and is excluded from current totals. Refunds cannot exceed recorded receipts. Financial balance and field completion are distinct.

Before preparing the handover, review the current work: there must be a finished visit, no active or pending visits, addressed required checks and documents, and no unresolved blocking finding. Enter a meaningful completion summary, actual author/time, selected original documents and any actual customer acknowledgement. Do not invent an acknowledgement to make a record appear received.

Review the exact handover snapshot, then commit it. The committed edition retains the site/appliance, accepted quote and decision, visits, observations, findings, requirements, chosen documents and payment history. Download its own HTML when you need the exact earlier handover. Later changes to the property, job readiness or documents do not rewrite it. A corrected handover is a new explicit edition with its reason.

Select the next service date and its basis separately. A source may recommend annual service, but actual usage, appliance, findings and operator judgement determine the entered date. Link the plan to a follow-up job for the same property/appliance, close it with a reason or reopen it. No reminder is automatically sent.

## 8. Review original CSV and reopen independently

Retain the original CSV file first. Choose site, appliance or enquiry intake and the correct company. Inspect its original headers, then explicitly select a source header or constant for each intended target field. Do not choose both for the same field. Appliance and enquiry rows can resolve a property reference within the operator, or use an explicitly selected existing site.

The parser rejects ambiguous duplicate/empty headers and inconsistent row widths. Normalized header labels support mapping; the original file bytes remain untouched. Review each proposed record and its findings before committing.

Every original row needs one decision:

- **Create** assigns the supplied new stable ID and saves a new record.
- **Link** selects an existing same-company record without overwriting it.
- **Ignore** retains the row and a reason for excluding it.

A repeated identical commit returns the retained import, while different original bytes require a new reviewed intake. The full working JSON keeps the original file, exact mappings/constants, each row and all decisions. A local import into this worksheet is not a native StovePilot import. Use the resulting export and explicit mapping as a handover, then retain the actual destination response separately.

Readable company and all-company reports summarize the operating records and their original references. The complete JSON retains every nested snapshot, evidence file and history event. Open the report and CSV as recipient files, receive the exported JSON independently, and open its original attachments before declaring the handover received.

## Company-specific context

| Reference company | Detail to preserve | First-party source |
| --- | --- | --- |
| Stovecraft Installations | Measured survey and fixed itemised quote; public photo intake has its own eight-file/eight-MB limits. Those limits do not replace the worksheet's disclosed evidence budget. | https://www.stovecraft.co.uk/ |
| Stoves and Sweeps | Saturday discussions are by arrangement despite listed weekend closure. A request and confirmed time remain different. | https://www.stovesandsweeps.co.uk/ |
| Premier Stoves and Fireplaces | Thirty-day quote and deposit/completion milestones allow explicitly written exceptions; separate survey and service requests remain requests. | https://premierstovesandfireplacesltd.co.uk/pages/terms-conditions and https://premierstovesandfireplacesltd.co.uk/pages/installation |
| Riley Stoves & Sweeps | Findings discovered during a sweep are photographed and quoted separately; extra work remains a separate decision. | https://rileystovesandsweeps.co.uk/ |
| Everwarm Fires | Survey-priced installations remain distinct from its task-specific service menu. The two-hour aim concerns a business-hours reply. | https://everwarmfires.co.uk/prices/ and https://everwarmfires.co.uk/contact-us/ |
| Country Stoves & Sweeps | Customer-supplied appliances, office/field roles and original handover paperwork remain explicit. | https://www.countrystovesandsweeps.co.uk/wood-burning-stove-installation/ and https://www.countrystovesandsweeps.co.uk/about-us/ |

The full source-refresh file retains sixteen checked first-party routes and the precise operational distinctions. The current StovePilot public site describes a working installer-led application and forthcoming wider early access, rather than a published machine-import contract: https://stovepilot.co.uk/ and https://stovepilot.co.uk/about.

## Daily crew allocation and complete quotation inputs

The overview retains the selected company’s visits and shows that company’s confirmed minutes for each worker reference. The same reference in another company remains a separate crew identity. Overnight visits appear on each relevant local day, with minutes clipped to that day; a saved assignment does not establish an available shift. Draft quotation totals remain “not entered” until every line quantity and price, discount, tax and deposit is explicit. Enter zero only where it is an actual selected value. Starting any new workspace-file selection also cancels an older in-flight worked-programme replacement, even if the later selection is empty or invalid.

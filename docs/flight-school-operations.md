# Flight school operations

This workbench joins source-based school preparation with actual student, aircraft and instructor registers, office-reviewed booking and dispatch, observed flying/instruction, separate instructor compensation, student charges, paid cash, promotional credit, programme observations and complete editable exports.

The delivered record contains the published source and blank operational collections. A Sling 2 and Piper Cherokee 140 are published aircraft types. Actual registrations, fleet quantities, serviceability, students, instructors, qualifications, measurements and transactions are entered by the school.

## Source and school decisions

Five current observations are Sling wet rental USD 190/hour, Cherokee wet rental USD 205/hour, CFI instruction USD 65/hour, owner-aircraft instruction USD 75/hour and discovery USD 180/flight. Original URLs, units and wording are retained. The actual USD 180/hour private-budget aircraft observation and USD 255/hour professional compound-dual observation are disabled alternatives. They are derived from the retained source, not added to unrelated school inputs. Enabling one requires an office reason.

Compound dual includes aircraft and instruction for the same period. Its booking cannot also contain separate aircraft/instruction lines. A fixed discovery experience stands alone. Third-party medical, written-exam and examiner estimates remain in the published budgets; they do not automatically become school receivables.

Before billable approval, the school reviews:

- Aircraft billing clock: Hobbs, Tach, elapsed actual time or manually observed minutes.
- Time increment and rounding: up, down or nearest.
- Monetary rounding: half up, floor or ceiling.
- Tax basis points and reason, including an explicit zero if appropriate.
- Its own actual preflight checklist and required items.
- Separate instructor compensation rate/basis.
- Promotional-credit rounding and eligible charge categories for matching deposits.

The starter leaves these choices unresolved. The word wet does not determine the clock, rounding or tax. Rates use integer minor units; meters retain decimal strings with up to three places. Meter differences become integer rational durations before increment rounding. Thus 100.0 to 101.1 is exactly 66 minutes, and 75 minutes at a reviewed six-minute round-up policy becomes 78. Those examples explain arithmetic, not a claim about the school's policy.

## Registers and factual observations

Use stable IDs for each actual student, aircraft and instructor. Preserve IDs when correcting details. Student status supports scheduling and the selected source programme supplies context.

An aircraft record contains its actual registration or owner identifier, source type where appropriate, ownership, current school-entered status and observed meters. Dispatch separately records actual starting readings. An open maintenance observation or status other than available prevents dispatch readiness. Retain the actual maintenance reference and resolution.

Instructor compensation is separate from student billing. A zero pay rate is an explicit school choice; unknown pay remains blank and prevents final compensation approval. A flight-specific pay.review can resolve an unknown or incorrect compensation basis while preserving student prices.

Qualifications retain subject, actual document/reference, observation and expiry where known. Programme completion requires actual evidence and reviewed progress names its reviewer. These records support school decisions; they do not issue endorsements or decide legal eligibility, airworthiness or examiner readiness.

## Booking through reviewed billing

Create the booking with student, actual resources, timestamps including timezone, kind, purpose and selected charge lines. Draft quotes may remain incomplete while preparation continues.

Office approval records actual evidence for student_authorization, aircraft_status and instructor_assignment. Where an element is inapplicable, record that fact and basis in the evidence. Dispatch records actual departure, actual checklist results and the starting meter selected by the frozen billing rules. Required checklist items need confirmed results.

Enter actual completion, ending meters, observed flight minutes, airborne instruction minutes and ground-instruction minutes. Instructor and office review are tied to the exact observation digest. Posting requires both reviews and a complete student/compensation calculation.

Kinds are dual, solo, ground, discovery and owner_aircraft. Ground uses instruction only. Owner-aircraft instruction does not add school rental. Solo cannot include dual instruction. One line per billing role prevents duplicate use of an actual clock.

For ordinary dual or owner-aircraft instruction, actual CFI billing combines airborne instruction minutes and ground-instruction minutes before rounding. Ground-only uses ground minutes. Instructor compensation uses its separate actual-minute basis or separately entered pay minutes.

Resource checks cover student, aircraft and instructor. Planned overlaps prevent approval; actual departure checks its shifted interval and unfinished dispatches. A flight with no actual completion still occupies resources. A flight completed before the next departure releases physical resources even while billing is awaiting review. Financial reversal of an old flight does not indefinitely reserve the aircraft. Completed actual intervals remain available for historical conflict checking.

Approval freezes the prepared quote. Note-only edits preserve it. Changing approved resources, times or charges requires explicit reprice, which returns the booking to Draft and clears approval. Dispatch retains the approved rules and rates; later tariff changes do not silently rewrite flown work.

## Corrections and closing

flightEstimate reports lines, subtotal, tax, total, current-tariff difference, separate instructor pay and both reviews.

dispatch.correct changes documented starting meters or actual departure while unposted. History retains the original; affected reviews are invalidated. Ending meters cannot precede corrected starts. The school documents exceptional meter replacement instead of billing a negative difference.

pay.review changes reviewed compensation for this dispatch, leaves student rates intact and invalidates the office review.

After posting, flight.reverse records exact negative student and compensation entries, reverses all allocations against that posting, preserves prior calculations and reopens observation review. Enter the correction and obtain actual reviews again before reposting. A new charge ID retains the original dispatch rates. Closing is an administrative state; balances and history remain.

Every mutation records actor, time and lossless changed-record before/after values. Original source remains immutable and digest checked. Optional operation IDs return the same result for identical input and reject changed input under an existing identity.

## Paid cash and promotional lots

An actual deposit needs paid amount, receipt date, payment reference/method and note. It creates distinct receiptID:cash and, where matching applies, receiptID:promo lots.

| Actual paid USD amount | Published match |
| --- | --- |
| 10,000.00–12,499.00 | 3% |
| 12,500.00–14,999.00 | 4% |
| 15,000.00–20,000.00 | 5% |

The cent gaps are retained. Matching 12,499.01 or 14,999.99 is unresolved; an unmatched cash receipt can still be recorded. Rules beyond the intervals are unknown. Matching requires reviewed rounding and eligibility. Expiry is blank until actually agreed; an entered date is the first unavailable date.

Allocate a lot explicitly to an active charge for the same student. Amount cannot exceed lot balance or unpaid charge. Aircraft-only promotional credit covers separately priced aircraft amounts; compound dual is not automatically split.

A refund represents an actual paid-cash refund with reference/date. It cannot convert promotional credit into cash or refund allocated cash. Reverse a refund while retaining its record. Before voiding a receipt, reverse its allocations and refunds. No refund, expiry, payment or eligibility rule is inferred from the advertised match.

## Programme and budget material

The complete source includes 11 programmes and original professional phases, schedules, totals and arithmetic alternatives. Programme descriptions are guidance, not available booking slots.

Printed professional phase totals sum to USD 74,155; retained line amounts sum to USD 74,165; separate source summary rows sum to USD 72,915. All views remain available. Private training's USD 180 budget remains distinct from current USD 190/205 rates. Medical, written, spin, logbook and readiness statuses require school-entered observations.

Progress retains student, programme/phase, item, status, actual date, optional minutes, evidence and reviewer. Planned entries are useful without claiming completed qualifications.

## Neutral CSV receiving

The import wizard supports student, aircraft and instructor registers. Source columns map explicitly to transferFields targets. The entire original parsed rows, source text, filename, mapping and row decisions remain in the project.

mapping.save stores entity, fields, explicit defaults and reason. previewImport reports create, skip and review. import.receive creates new IDs, skips existing IDs and preserves every disposition; it does not silently overwrite an existing register. Correct existing records through their normal forms.

APEX advertises staff-assisted migration and school setup; these neutral CSV names are preparation formats. Confirm its current actual template during onboarding and retain that mapping in the same project.

## Engine and receiving contract

host/flight_school_operations.cjs is CommonJS/UMD and requires connected_sha256.cjs. Browser assembly exposes FlightSchoolOperationsHash, then FlightSchoolOperations.

create(source), validateRecord(record), apply(record,envelope), catalogue, quote, readiness, flightEstimate, summary, account, depositPreview, programmeProgress, transferFields, previewImport and exportFiles are the primary methods.

Envelope: {type,input,actor,at,id?}. Timestamp has an actual timezone. Optional id supports identical-operation replay. apply returns a complete immutable successor.

Actions:
settings.save; rate.save/restore; student.save; aircraft.save; instructor.save; booking.save/approve/cancel/dispatch; dispatch.correct; observation.save; flight.review/post/reverse/close; pay.review; deposit.add/void; allocation.add/reverse; refund.add/reverse; qualification.save; maintenance.save; progress.save; mapping.save; import.receive.

The 29 engine exports include complete Working_Record, original source, settings, history, budgets, programmes, source issues, mappings/imports and operating/financial CSVs. Whole-record save/open is the receiving authority; CSV is a specific view. Generic source and factual public observations live in the public repository. Actual school records stay on their authorized private surface.

## Actual installed and rendered receiving

Follow the delivered CLI/builder instructions. Start from the empty delivered record; use a separate copy for a reference course rather than populating the customer starter with invented operating data.

Operate reviewed settings, actual forms, planned quote, approval/preflight, meter/instruction observations, both reviews, posting/separate pay, receipt and both lots, allocation, close, reversal/correction/repost. Reopen the saved full record and inspect the exported package.

The exact outgoing application and attachments must be opened and visually inspected at the real desktop/screenshare width and narrow/mobile width. Look at actual pixels, operate important controls and loaded/empty/error states, download files and reopen them in the normal recipient-facing viewer. Inspect the useful archive contents. Fix clipped, cramped, unstyled or unreadable output in the same application. Disabled controls need explicit foreground/background colors and opacity 1. Source or callback operation is distinct from seeing the actual product.

Retain exact source/artifact identity, viewport sizes, screenshots actually viewed, exercised actions/files and concrete repairs in the original receiving case. Keep this focused on the real workflow, with no separate verification product or broad suite.

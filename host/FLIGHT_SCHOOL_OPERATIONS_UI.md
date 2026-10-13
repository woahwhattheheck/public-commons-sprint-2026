# Flight school operations

Open **Flight_School_Operations.html** to use the complete offline application. **Working_Record.json** carries the full original source, operating choices, actual records, history and unfinished forms. The application’s **Download whole ZIP** includes the executable application, editable source, complete record and every tabular export.

## Start with actual school records

Enter the current operator in the header. Go to **Settings & rates** and record the school-reviewed billing clock, time increment, time rounding, money rounding, actual tax treatment and promotional-credit choices. Define the school’s actual preflight checklist and record the reason for these selections. Blank or unresolved choices remain visible until the responsible office supplies them.

Published rate observations and school-selected operating rates are distinct. A combined dual rate already includes the aircraft and instructor. Choose either that combined line or separate aircraft and instruction lines for the same work. Historical budget rates remain source alternatives; use an explicit recorded decision if the office selects one for operation.

Add actual students and instructors in **Students & instructors** and the actual fleet in **Aircraft & maintenance**. Published aircraft types are catalogue observations; they do not create registrations or aircraft availability. Enter agreed instructor pay separately from the rate billed to a student.

Record observed qualifications, document references, maintenance findings and named review evidence with their dates. These remain actual entered records. The office and instructor perform their own operational review before dispatch.

## Book, review and dispatch

1. In **Bookings**, choose the student, actual aircraft and instructor, booking type, start and end time. All time-picker labels explicitly use UTC.
2. Add planned charge lines using the selected rates, planned minutes and fixed-price units. Calculate the quotation. Resolve the displayed issues before approval.
3. Save the booking. Open it in **Flight desk** to view the current source-bound quotation and readiness.
4. Record actual student authorization, aircraft-status review and instructor-assignment evidence in **Office booking approval**. When a resource does not apply, record the actual reason in its review evidence.
5. Record departure/start time, actual starting meter readings and each school-defined preflight result. Save actual dispatch.
6. Record the actual landing/end, ending meters, flight minutes, airborne instruction minutes, additional ground instruction minutes and any separately approved manual pay minutes. Airborne instruction and additional ground time are separate observations; the engine combines them only where the selected billing and compensation rules call for it.
7. Calculate the current actual-flight price. The engine applies the dispatch’s retained tariff and office choices to the current observation.
8. Record the instructor and office reviews against that observation. If returned, correct the observation and review the corrected record.
9. Post the reviewed charges. Open **Accounts** for the resulting student charge and available funding lots.

The original source and tariff selections remain attached to the relevant quotation and dispatch. Changes to the current catalogue are visible without silently replacing that retained pricing. Resource overlaps, unresolved choices and incomplete actual records are surfaced by the operational engine.

Use **Download quotation** for the planned charge document and **Download flight sheet** for the original booking, observations and reviews.

## Correct work while retaining its history

Approved booking edits require the explicit reprice choice and a new office review. Cancel the original booking with a reason when it will not occur.

For a posted flight, use **Correct a posted flight** with a reason. The reversal retains the original charges, funding allocations and instructor-pay entry and records their reversal. Enter the corrected observation, perform the required reviews and post the corrected work. Follow the displayed status after each action. Do not overwrite the original history to make a correction disappear.

## Paid deposits and promotional credit

In **Accounts**, choose the student and receive the actual payment with its date, payment method and original transaction reference. **Preview cash and promotional credit** shows the consequences before the receipt is recorded.

Cash received and promotional credit are separate lots. The published match tiers use their literal boundaries. The source does not fill gaps between those boundaries or set an expiry, refund rule or rounding choice; the operator records the actual agreed choices.

Apply a chosen funding lot to the specific original student charge. An allocation retains the lot, charge, amount, date and operator. Credit eligibility and available balances remain visible. Record actual cash refunds against cash lots with their original transaction references. Use the explicit reversal actions to correct allocations or refunds. A deposit can be voided only when its dependent use is resolved.

**Download student statement** retains the selected student’s current cash balance, promotional balance, original charges and allocations. Instructor compensation remains a distinct operational record.

## Programmes and source alternatives

**Programmes** shows the selected source programme, original schedules, phases and planning budgets alongside the student’s actual recorded progress. Add the actual training item, status, date, evidence and named reviewer. Source schedules are planning descriptions; they do not create actual availability or completed training.

The professional-programme display retains the source’s individual lines, authored totals, computed line totals and separate summary observations. Current operational rates and actual flight charges do not replace these original planning alternatives.

## Save, reopen and hand over

**Save project** writes the complete working JSON, including unfinished forms. **Open project** restores it and validates its structure. Save before opening another project when retaining current work.

**Save offline app** writes a complete application with the current record. **Download whole ZIP** adds every data export, operating guide, source module and member manifest. There is no dependency installation or external service required for the offline application. Sources & exports also offers each complete export separately.

The Page and the offline application use the same engine and original browser callbacks. Shared widget state assists reopening in the Page; the complete exported record remains the portable working copy.

## Receive complete neutral CSV records

**CSV receiving** accepts original student, aircraft and instructor files. Open the original CSV or paste its complete text. The parser preserves quoted commas and newlines, checks the original header and row structure, and retains the full original text with the received operation.

Choose the original column for each target field, and record office-selected defaults only where appropriate. Give the mapping a reference and note, then save it. Neutral monetary columns such as instructor pay use integer minor units: 5000 means USD 50.00. Meter readings remain decimal strings. Confirm source units before receiving.

Preview the complete import. The interface shows new records, existing references that will be skipped and row-specific errors. Page through the original and mapped rows; all rows remain in the record. Resolve errors, then receive the current preview. Existing references are retained for review through their normal record forms. The original filename, full CSV text, source rows, mapping and row decisions remain in the project and its complete exports.

For account views, select the credit eligibility date. The balances incorporate recorded transactions and apply promotional expiry at that selected date; the selector is not a historical transaction cutoff. The explicit date also travels into the generated student statement’s calculation.

## Command-line operation

Use the included source directory with Node.js:

```sh
node source/flight_school_operations_cli.mjs inspect --record Working_Record.json
node source/flight_school_operations_cli.mjs catalogue --record Working_Record.json
node source/flight_school_operations_cli.mjs readiness --record Working_Record.json --booking-id BOOKING_REFERENCE
node source/flight_school_operations_cli.mjs flight --record Working_Record.json --booking-id BOOKING_REFERENCE
node source/flight_school_operations_cli.mjs account --record Working_Record.json --student STUDENT_REFERENCE
node source/flight_school_operations_cli.mjs build --record Working_Record.json --out NEW_DELIVERY_DIRECTORY
```

Apply accepts an original action JSON with `type`, `input`, `actor` and `at`, and writes a new record without replacing an existing output file. Build likewise creates a new delivery directory.

## Engineering and recipient inspection

Generic code is maintained in the public engineering repository. Private school, student and prospect records retain their original private delivery locations and identities. Follow the current root AGENTS.md and the original case’s operating directions.

Before presenting any outgoing edition or attachment as ready, open the exact product and inspect its real desktop and applicable narrow/mobile render. Operate booking, flight, account and correction controls on a separate operator course; view the actual screenshots, open downloadable documents in their normal viewers and reopen the complete package. Fix concrete layout or workflow defects in the original application. Preserve the original receiving operation and record the exact affected version. Source or DOM checks do not replace this actual recipient use.

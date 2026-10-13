# Pebble and Sky studio operations guide

This complete offline workspace connects member access, classes, piece intake, technician clearance, kiln loads, ready notices and collection. It includes six separate public studio examples. Actual people, sessions, resources and decisions begin empty; the worked example is clearly identified demonstration data.

Open `pebblesky-studio-operations.html` in a modern browser. Choose a studio, enter the operator name, and either create your own operating records or open the worked example. The application makes no network requests to a booking service, kiln, gallery, email provider or SMS provider.

## Start with the real studio

Choose **People and setup**. Add the actual makers and their existing customer references. Add the actual rooms, wheel groups, kilns or shelves that staff will allocate. A published wheel count is a source fact, not an automatically instantiated asset.

Create separate programmes for classes, open studio, member access, firing dropoffs and firing. Retain a cone such as `^06–^04` exactly, including its leading zero. Enter the actual material requirements and operating instructions. A cone label does not calculate a safe firing schedule or approve a clay or glaze.

A programme can have an explicitly agreed makeup limit. The number applies to the chosen person's course reference, with every replacement linked to a missed or cancelled booking. Keep the actual policy and public source links alongside the configured programme.

Inactive records remain in saved history and can still be displayed in an existing record. They do not become available for new approvals merely because an old form refers to them.

## Configure membership without changing its meaning

Create the membership under its actual person. Choose **booked**, **unbooked** or **firing-only** access. Enter inclusive studio-local validity dates and choose visits or minutes as the recorded allowance unit.

The opening allowance is a total-credit ceiling. Leaving it blank explicitly means no total-credit ceiling; it does not mean zero. Add independent calendar rules one per line:

```text
week,visits,3
month,minutes,720
```

The first rule allows up to three visits in each Monday-starting calendar week. The second allows up to 720 minutes in each calendar month. Configure only rules the studio has actually agreed. A calendar month is not treated as four weeks. Do not translate a shelf-volume entitlement into minutes, visits or kilograms; retain that distinct entitlement in the membership and load notes.

Once bookings or ledger records exist, the member, allowance unit and opening value are preserved. Use an explicit signed adjustment with a reason for a real credit correction. An allowance adjustment records units, not a cash refund. A membership without a total-credit ceiling has no total balance to adjust.

The displayed balance separates opening credit, adjustments, recorded usage, reservations and available allowance. Original attendance debits and corrections remain in the ledger.

## Plan and approve a session

In **Sessions**, save the title, programme, actual resource selection, capacity, start and end instants and studio IANA time zone. Dates use an explicit ISO offset, for example `2026-10-20T10:00:00+01:00`. The catalogue studio time zone determines local allowance windows. The session time zone controls display, and the explicit entered instant determines actual overlap.

Capacity belongs to this session and its actual selected resources. A six-place wheel class, an eight-place handbuilding room and a twelve-place shared studio are not interchangeable capacities. Shared resources cannot be allocated to overlapping approved sessions.

Saving produces a draft. **Review for approval** shows the actual saved records and any findings. **Record session** approves that exact review. A later edit requires a fresh approval and preserves the prior snapshot and existing booking history. Once a session has attended, missed or corrected bookings, its record is preserved; create a new session for a changed arrangement.

A firing-only member uses a **firing-dropoff** session. Unbooked membership uses a **member-access** session to record actual attendance without adding a reservation requirement to the studio's policy.

## Requests, attendance and makeups

In **Bookings and attendance**, select the actual person, session and membership, if applicable. Enter the actual visit or minute debit. A membership-free booking uses one unit for its single seat. Retain the original booking-system ID.

Save the request, review confirmation and explicitly confirm it. Approval checks the current approved session, available seats, participant identity, membership validity and allowance. Confirmation reserves the applicable units; it is not attendance.

At the actual visit, review and record attendance. The workspace captures the complete decision and debits the allowance once. A requested unbooked member-access record can be attended directly when its membership allows that access.

For a missed visit, enter a reason and explicitly choose **DEBIT** or **KEEP**. The software does not infer a cancellation fee or debit policy from a studio name. Cancellation releases an unconsumed reservation. An already recorded attendance or missed outcome is corrected through **Correct recorded attendance**, with its original debit retained and reversed once. Any later replacement is a new booking.

A makeup identifies its original missed/cancelled booking and course. The actual replacement still needs available capacity and applicable membership approval. The complete history preserves which original visit it replaces.

## Record a piece and its technical decision

In **Pieces**, create a real tag or descriptive label, actual owner, material/brand, exact cone notation and current stage. Link its originating booking where appropriate. Retain original maker references, storage notes and the selected gallery permission. An owner-consented flag records permission; it does not publish a gallery.

Select the actual firing programme and explicitly approve or decline the piece, with the technician's reason. This records a material/programme decision; matching text strings alone do not provide clearance. Changes to relevant material, cone, stage or programme require renewed review.

A piece stays attached to its original owner and intake history. Scheduled, firing, cooling and collected states protect the appropriate records. A ready piece materially changed for further work returns to the awaiting queue. Saving a revised damaged-piece record also returns it to awaiting while retaining its earlier outcome. Withdraw a piece only through a reasoned action when it has no active load.

## Run the recorded load lifecycle

In **Kiln loads**, choose the actual kiln and firing programme, every intended piece, and the reviewed planned interval. Record an explicit assessment of physical loading capacity. There is no automatic conversion of shelf dimensions, piece weights or published kiln volume into a safe load.

Review the complete saved load. Every included piece needs current technical clearance, and the actual kiln must be suitable and available. Record approval against the complete snapshot.

At the real start, open a fresh review and enter the actual start instant. The kiln must have been released by any earlier load and the start must fall inside the reviewed planned interval. If the plan has changed, cancel the planned load and create a new draft with fresh approval; the earlier plan remains in history.

**Record cooling** saves an actual operator-observed transition. **Record unload and outcomes** requires an explicit result for every original loaded piece: bisqued, glazed, finished, damaged or refire. A finished result places that piece in the ready queue; other outcomes retain the appropriate next-stage work. Technical clearance is reset for the next operation.

No elapsed time, website turnaround estimate or planned end automatically makes a piece safe to unload or ready to collect. Follow the real studio's technical procedures and physical assessment.

## Prepare a notice and record collection

In **Ready notices**, choose one owner and that owner's ready pieces, an actual channel, confirmed destination and the complete message. Check the studio's current pickup arrangements. Preparation creates an unsent record.

Send through the existing studio channel. Only afterward record the actual sent instant and the message/call reference. This application does not send anything. Cancel an unused prepared notice with a reason; retain completed sends.

Record collection from the ready piece: collector, actual instant and notes. The collected piece and its prior load, outcome, notice and ownership history remain available. A second pickup is not silently added to the same piece.

## Bring existing pieces into the workspace

In **Intake and handover**, select the original CSV, up to 8 MiB. Map its real columns. For studio, owner or stage, select an explicit constant when the original file has no such column. This supports an ordinary maker file without requiring it to contain this application's internal identifiers.

Review every row. Choose **create**, **link** or **ignore**, and retain a reason where appropriate. Linking adds provenance to an existing piece without overwriting that piece. The complete original text, exact mapping and each decision remain in the workspace. Duplicate or invalid identity findings must be resolved before creating a record.

A fresh file selection immediately invalidates the prior preview and commit controls. A file read that finishes after another selection or intervening workspace/form edit is not applied. Invalid input does not replace the current working state.

## Export, close and reopen

**Download complete JSON** is the portable working record. It contains all original sources, people, configuration, sessions, bookings, pieces, loads, notices, imports, ledger entries and revision history. The all-record CSV provides a worksheet with complete record JSON in its final column. The readable HTML report contains all records and their preserved detail.

**Save browser copy** explicitly saves the current committed workspace to this browser. It does not include unsaved form inputs. Browser storage can be unavailable or cleared, so retain the complete JSON for handover.

To reopen, select the full JSON, review its title/revision, then explicitly replace the current workspace. The application validates the complete source catalogue and record relationships first. Export your current work before replacement when it must also be retained. The import limit is 64 MiB; exceeding it fails before replacement.

Switching sections or replacing another dirty form asks before discarding input. Failed mutations retain the form. A worked-example build also preserves intervening edits instead of applying a stale result.

## Apply the six source examples carefully

- **Stone's Throw:** configure the actual class capacity and an agreed monthly minute allowance. Its different class formats are separate programmes.
- **Garret Pendergrass:** keep the exact bisque/glaze notation and dimensioned shelf allowance in context. Trial-piece retention is an explicit operator decision.
- **West End:** separate general studio access from firing-only dropoff access. Makeup approval still depends on an actual course and available place.
- **Mudworks:** distinguish unbooked full-member attendance from booked open sessions and their respective material rules.
- **Longtom:** record the agreed weekly or monthly interpretation instead of silently converting the published wording.
- **Zed Alley:** preserve Bookeo references, separate resource capacities, the actual agreed charge and current pickup instructions.

The supplied source refresh gives the current first-party URLs and retrieval dates. These examples supply onboarding questions and operating context, not live customer bookings or an unpublished API import contract. The complete CSV/JSON handover can be mapped with the buyer's actual supported receiving process when that process is specified.

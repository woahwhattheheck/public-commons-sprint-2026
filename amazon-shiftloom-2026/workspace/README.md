# Retained volunteer coverage workspace

ShiftLoom now carries a complete coordinator workflow around its original planner: original source capture or export, field mapping, explicit coordinator inputs, retained roster versions, explainable candidate review, named approval and undo, corrected-source reruns, and a complete handoff.

## Start the application

Requirements: Python 3.10 or later, Node 22.16 or later and the site's IANA time-zone data. The Python server and capture command use the standard library; the original JavaScript planner has no package dependencies.

From this directory:

    python3 -B app.py --db /absolute/private/path/coverage.sqlite --port 8802

Open the local URL printed by the command. Use --port 0 when another application occupies that port. Keep the SQLite file in the organization's private working directory. The server listens on 127.0.0.1, validates its local Host/Origin, and uses a per-process token for writes. Each accepted operation is retained in SQLite before the browser receives success.

WORKFLOW.md explains the complete browser operation. API.md documents the same HTTP routes for an operator integration. SOURCE_CONTRACT.md links the original Get Connected schemas and current export/qualification guidance.

## Source intake and real capture

The five roles are volunteer roster, shifts, responses/assignments, coordinator availability/eligibility, and individual qualifications. CSV headers are inspected because Get Connected lets an operator select export columns. Nested JSON object fields can be mapped as dotted headers. Original uploads retain their exact bytes, including UTF-8 BOM and line endings.

The native capture command reads an explicitly selected set of opportunities and candidate volunteers. It also includes every user referenced by those opportunity responses. Select all opportunity IDs needed for the cohort's existing weekly bookings and overlap context.

Put the exact source IDs into two private files, separated by newlines or commas. Make the authorized site's complete API Authorization header value available in the GET_CONNECTED_AUTHORIZATION environment variable. The command reads the value in memory; source journals and application files retain request URLs and response bytes.

    python3 -B capture_getconnected.py \
      --api-base https://api.galaxydigital.com/api \
      --domain-id ACTUAL_SITE_ID \
      --need-ids /absolute/private/path/opportunity-ids.txt \
      --user-ids /absolute/private/path/volunteer-ids.txt \
      --output /absolute/private/path/source-capture

Choose the documented API region for the actual site: the US primary URL above, https://www.volunteerapi.com/api, or https://ca.volunteerapi.com/api. A named alternative environment variable can be passed with --authorization-env.

The original reads are GET /needs/{id}, /needs/{id}/responses, /users/{id}, and /users/{id}/qualifications. The capture follows actual next links only within the same source endpoint and official region; it retains every returned page separately. Requests are paced at least 0.35 seconds apart, below the current documented 200-request-per-minute ceiling. Transient reads receive limited retries. Each completed page has its original bytes, timestamp, URL and SHA256 in the private journal.

If the capture is interrupted, run the same command with --resume. Successful original pages are reused and the exact remaining reads continue. Use a new output directory to capture fresh source. The finished getconnected-snapshot.json embeds the original response bytes and request associations for direct import through the Sources pane.

A native bundle may also contain the documented needs, responses, users and per-user qualifications arrays; examples/getconnected-snapshot.json shows that format. For retained request bundles, each projected row exposes its original request index, URL, response SHA and JSON pointer into the decoded original response. Need.shifts arrays become actual occurrence rows. Qualification request user IDs stay attached to their returned qualification rows.

## Coordinator inputs and the coverage model

The source contract supplies occurrence IDs, start/end timestamps, capacity, response relations, and qualification state/expiry. The coordinator supplies the actual role requirements, weekly assignment limits, availability and eligibility decisions. Configured custom questions remain original source data until their meaning is explicitly mapped.

Additional reserved places occupy capacity beyond named response rows. A team reservation therefore cannot be mistaken for a free place or counted twice. A reservation value of zero is an explicit coordinator value.

The workspace uses one selected seven-day period. Shifts whose starts fall in that period count toward each person's assignment limit; retained context shifts still participate in overlap checks. The operator chooses the site time zone and how date-only qualification expirations end. Full timestamp offsets are retained. Ambiguous or nonexistent local times require an explicit offset. Actual qualification expiry governs eligibility, including durations introduced after the older published schema enumeration.

The planner fills one selected target shift. Its original filtering and workload/preference ordering produce each candidate reason. Existing assignments remain in the source, and known unsafe retained assignments must be corrected before approving revised coverage for that shift. Every new candidate needs affirmative availability and coordinator eligibility, active required qualifications for the entire shift, no overlap and room under the declared weekly limit.

## Review, corrections and recovery

Freezing a board stores its source identities, mapping revisions, coordinator settings, original normalized rows and original planner state. Later edits to the input mapping or source selection leave earlier boards and plans intact.

Every plan stores its exact planning-state snapshot. A reviewer sees that proposal's source rows and prior decision when continuing a corrected scenario. Approval needs the same board revision and exact selected source/configuration. Named rejection, approval and reversal remain separate records. Undo reverses the latest remaining approval and advances the board revision, keeping earlier draft proposals stale.

Download the selected handoff for the original inputs, native captures, frozen mappings, current roster, reviewed changes, candidate plans, named before/after decisions, predecessor review history and a hash manifest. The coordinator enters approved changes through the organization's normal Get Connected workflow.

Download the complete workspace backup to continue all source versions, boards and history:

    python3 -B app.py --db /absolute/private/path/shiftloom-workspace.sqlite --port 8802

The ZIP is the review and transfer package. The consistent SQLite backup reopens the full application.

## Work through the supplied source cohort

Create a fresh example workspace directly from the supplied original native source and explicit coordinator recipe:

    python3 -B create_example.py --db /absolute/private/path/shiftloom-example.sqlite
    python3 -B app.py --db /absolute/private/path/shiftloom-example.sqlite --port 8802

The command accepts a new workspace file and creates the retained original board. Continue its actual plan, named review and corrected-source workflow in the browser.

examples/recipe.json contains exact settings, mappings and coordinator overrides for both native and five-CSV intake. The example contains ten volunteers, three shifts, a canceled response, one extra team-reserved place and distinct qualification, availability, eligibility, overlap and workload conditions.

The initial target has two open places. The original planner selects Jordan 1010 and Avery 1002. Avery's date-only qualification expires after the target shift under the visible inclusive-date policy. The corrected availability removes Avery, leaving incomplete coverage until the corrected qualification file records Gray 1008 as active. The same scenario then selects Jordan and Gray, with the original review retained beside the new one.

These files are a worked operating example. The onboarding work maps the organization's actual exports or authorized native capture, coordinator rules and selected cohort.

## Source and limits

The original MIT-licensed planner is ../planner.mjs. The structured-ID entry point shares its filtering, ranking and application functions with the original demonstration. The existing demonstration server and public interface remain available from their original commands.

Each uploaded source is limited to 20 MiB and 100,000 rows. Browser source and roster tables are paged. The capture and local planner run on the operator's computer. A production delivery selects the actual source family, cohort size, coordinator process and recovery location in its agreed workshare.


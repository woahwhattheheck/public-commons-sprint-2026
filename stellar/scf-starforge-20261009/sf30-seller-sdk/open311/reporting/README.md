# Open311 service reporting

Operate a saved service-reporting desk from complete Open311 collection exports. The desk supports named creation periods, explicit observation cutoffs, service mappings, working calendars, internal targets, management commentary and source-linked reviewer returns.

Start with the installed [operating and receiving guide](INSTALL.md). The [source contract](SOURCE_CONTRACT.md) explains the supported provider timestamp meanings and reporting rules.

## A complete operator workflow

1. Collect the original service requests through the installed Open311 collection workspace, including all refined windows and source responses.
2. Import its complete collection JSON. The reporting desk retains the exact incoming file, original workspace/revision/collection identity, complete source bytes, all observations and source-linked review history.
3. Save an immutable reporting profile. Name the provider semantics, service mappings, calendar editions, target policies and the local interpretation of any date-only review deadline.
4. Select a creation period using an explicit start and exclusive end. Freeze the observation cutoff and source/profile editions. Review the source coverage and unmapped services.
5. Build the report. Source status, internal review state, reporting groups and selected targets remain distinct in every request drilldown. Percentages include their eligible numerator and denominator.
6. Download the management HTML, spreadsheet CSV, full report package or reviewer-return template.
7. Receive the full package in a new private reporting workspace. All report/source editions and original operation histories travel together. The receiving workspace has its own identity and can continue the report series.
8. Import a reviewer return, compare any intervening report edition and select the individual changes to incorporate. The resulting successor retains its original source pins and reviewer history.

## Calendar and target choices

The [weekday review profile](examples/weekday-review-profile.json) is a complete operator configuration accepted by the CLI and browser. It defines a TJLabs internal review target of 240 working minutes, with weekday hours 09:00–17:00 in Europe/Helsinki. The operator can choose another calendar, target or clock origin before saving an edition.

Calendars use weekday keys 0=Sunday through 6=Saturday. Each local interval has start/end values in HH:mm; 24:00 is supported as an end. A date override replaces the whole local date, including an empty array for a closure. Represent overnight work on its two local dates.

Working time is resolved separately for each date. A repeated daylight-saving boundary requires an explicit earlier/later choice; a nonexistent boundary needs an actual date override. Each report saves its resolved UTC intervals, complete policy/calendar editions and calculation runtime. Reading an existing report uses the saved calculations.

Mapping and target rules use exact selectors and an explicit integer priority. The highest-priority matching rule applies. Equal-priority matches appear as a calculation issue requiring an operator choice. A service priority label acquires a duration only through a named target policy.

## Source and report identities

Source import identity is the original workspace ID, original revision and collection ID. The complete incoming file also has a SHA-256. Identical imports reuse the existing source edition. An alternate file for an already retained identity produces a visible conflict.

Each report names its source editions, profile edition, observation cutoff, period, filters and selected target basis. A request first observed after the cutoff is counted as unobserved at that time. Limited source windows contribute their observed rows and retain their exact unresolved boundaries in coverage.

The supported provider profiles are `helsinki` and `georeport-v2`. Helsinki READY/PROCESSING values describe source processing state; its last-update timestamp remains a last update. Under GeoReport v2 semantics, a closed request's update time can supply closure duration. A missing or invalid target remains unassessed.

## Saved review changes

A reviewer-return file names its exact base report ID/SHA-256 and reviewer. Each change has a stable ID, a kind and commentary:

- `report-comment`: commentary for the complete report.
- `request-comment`: commentary with the original request key and source-version SHA-256.

The desk retains the complete return file. An operator selects the change IDs to incorporate. If the series has moved, the desk shows the comparison and requires the chosen current edition. A source-version change stays visible before a request comment can be linked to that newer source.

## Operation and receiving behavior

All mutations carry a stable request ID and expected workspace revision. The saved original request supports lookup after a dropped response. Repeating the same action returns its existing result; a changed action cannot silently reuse its ID. The browser retains large original commands in IndexedDB, supports download and offers recovery before another action.

HTML escapes source text. CSV protects spreadsheet formula text. The complete JSON package contains the source files, normalized records, report editions, configuration, review returns, current operation history and received original operation histories. Receiving validates those original bytes and references before writing one transaction to an empty destination.

The local server is private to its selected loopback address. Its Applications launcher verifies the workspace identity, directory binding and live server instance before opening the desk.

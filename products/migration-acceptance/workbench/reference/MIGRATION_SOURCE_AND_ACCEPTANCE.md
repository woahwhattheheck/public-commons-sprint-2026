# Complete migration source and acceptance contract

## Purpose and integration

This package supplies a complete original relational source and a practical acceptance contract for a migration workflow. Integrate the supplied cohort with the maintained dlt/DuckDB pipeline, comparator, customer workbench and target receiving operation. The package contains the original upstream files, the complete native SQLite source, every table's canonical JSONL and editable CSV, native schemas, row-level source lineage, original generator transformations and full exact control populations.

The selected reference is Chinook version 1.4.5 at upstream commit 7f67772503d71ba90f19283c38e93923addb43fa. Its author describes the media catalogue as originating in an iTunes library, the customers and employees as fictitious, and the sales as generated sample data. This is a complete published reference cohort. Its records are not Definian customer records. The retained original licence permits reuse with its copyright and permission notice.

Definian's own service description emphasizes repeatable extraction/transformation and reconciliation to legacy data after loading. This contribution supports that process through explicit source selection and operated acceptance. Definian continues to own its Applaud conversion engine, delivery methodology, client relationship and production conclusions.

## Receive the full original input

Run Python 3.10 or later using the supplied source selection:

    python3 receive_reference.py --manifest SOURCE_SELECTION.json --output /path/to/new-reference

The output directory must be new. Every original input is downloaded from the same pinned public upstream commit and checked against its full byte count and SHA-256 before it is used. For independent offline receiving, point --inputs to the preserved upstream directory:

    python3 receive_reference.py --manifest SOURCE_SELECTION.json --inputs /path/to/received/reference/upstream --output /path/to/fresh-reference

The complete original SQLite script is executed in a new local database. Its own load order is preserved. After loading, foreign-key enforcement is enabled and the full database integrity and foreign-key populations are inspected. The receiver returns all actual findings; SOURCE_REVIEW_REQUIRED retains the complete source for review.

The original PostgreSQL script is included unchanged as a second authoritative schema/representation reference. This source programme operates SQLite; the target migration owner records its actual selected target execution independently. The original JSON, XSD and generator code are also retained. They explain transformations that occurred before the SQL edition existed.

## Select the correct comparison boundary

There are two distinct retained populations:

1. tables/original-json contains all rows from the upstream generator input.
2. tables/native contains all rows actually read from the published SQLite edition.

The native SQL edition is the selected source for the downstream migration. Do not silently substitute the original JSON population, because its representation differs in a real, documented way. The upstream ChinookDatabase.tt generator converts empty values in nullable columns to SQL NULL. SqliteStrategy.FormatDateValue formats dates as yyyy-MM-dd HH:mm:ss. The original JSON uses a T separator. The receiver records every observed affected field with its original JSON pointer, primary key, original value, native value and exact transformation rule.

SOURCE_TO_NATIVE_LINEAGE.jsonl binds every complete row to its source JSON pointer and both canonical row hashes. GENERATOR_TRANSFORMATIONS.jsonl contains all observed field changes. UNEXPLAINED_DIFFERENCES.json retains anything outside the two source-proven rules. A new customer transformation needs its own approved rule and scope; these reference generator rules are not permission to collapse empty strings or infer dates in other sources.

Monetary fields are parsed from the original JSON using Decimal. The native SQLite receiver obtains their textual representation with CAST(... AS TEXT), then uses exact decimal strings at the declared scale. SQLite NUMERIC affinity can store real or integer values, so the result includes actual storage-class counts. A NUMERIC declaration is not proof that SQLite physically stores a fixed-point decimal. Native monetary values are reconciled back to the complete original decimal population, so an unexpected difference remains visible.

## The complete relational model

| Table | Complete primary key | Parent relationships |
| --- | --- | --- |
| Artist | ArtistId | None |
| Album | AlbumId | ArtistId → Artist.ArtistId |
| MediaType | MediaTypeId | None |
| Genre | GenreId | None |
| Track | TrackId | AlbumId → Album.AlbumId; MediaTypeId → MediaType.MediaTypeId; GenreId → Genre.GenreId |
| Employee | EmployeeId | ReportsTo → Employee.EmployeeId |
| Customer | CustomerId | SupportRepId → Employee.EmployeeId |
| Invoice | InvoiceId | CustomerId → Customer.CustomerId |
| InvoiceLine | InvoiceLineId | InvoiceId → Invoice.InvoiceId; TrackId → Track.TrackId |
| Playlist | PlaylistId | None |
| PlaylistTrack | PlaylistId + TrackId | PlaylistId → Playlist.PlaylistId; TrackId → Track.TrackId |

SCHEMA.json is generated from the actual database and contains all columns, declared types, nullability, ordered key components, foreign keys, update/delete actions and the exact extraction query. All eleven tables are selected. Preserve PlaylistTrack's complete composite key and every repeated TrackId across distinct playlists. Preserve Employee's self-reference and legitimate null ReportsTo values.

An absent nullable relationship is different from a non-null child whose parent is missing. The latter is an unresolved reference, even if the target loader accepts it. Key remapping must retain a complete old-key → new-key map and apply that map consistently to all dependent objects. A new surrogate key does not establish business identity by itself.

For the selected reference, every row is retained. A real customer's inclusion/exclusion decision must identify its full predicate, version, affected population and responsible reviewer. The expected target population is the operated result of those decisions, not an unexplained lower row count.

## Typed transfer and editable files

Canonical JSONL is the primary machine input. It uses original column names, JSON null, integer values, unmodified Unicode text, source-local timestamp text and decimal strings with two places for NUMERIC(10,2). The target pipeline must explicitly decode declared decimal strings to its exact decimal type. Do not route money through a JavaScript Number or a binary-float aggregate. Large integers in a different customer source require an exact integer representation throughout the pipeline.

CSV is an editable convenience with quoted fields. A null is the literal backslash-N sentinel. Literal backslashes in non-null text are doubled. Read a field equal to backslash-N as null, otherwise undo doubled backslashes. Empty text remains empty text. The canonical schema and JSONL remain available when a CSV consumer cannot preserve those distinctions. Do not auto-detect identifiers, postal codes or dates from CSV appearance.

No automatic trim, case-folding, Unicode normalization or deduplication is applied. Original postal codes and names are text. Timestamps have no timezone in this source; migration must not invent UTC or a regional timezone. Any customer-specific canonicalization must retain the preimage, output, rule version and approved scope.

## Exact amount and quantity controls

The complete invoice control population contains every invoice, its original customer/date/country grouping, line count, integer quantity, header total, extended line total and difference. Extension uses InvoiceLine.UnitPrice × InvoiceLine.Quantity with exact decimal arithmetic. It does not substitute Track.UnitPrice: catalogue price and historical line price are different fields.

The grouped report retains all invoices grouped by customer, billing country, calendar year and the complete population. It includes invoice counts, line counts, quantity, header totals, line totals and differences. Full row comparison remains necessary: equal aggregates can hide offsetting record errors.

The original schema contains no currency field. All reference totals therefore use UNSPECIFIED_REFERENCE_AMOUNT. BillingCountry is not a currency. A customer migration with multiple currencies must group amounts by actual declared entity/currency and retain any conversion rate, effective date, rounding rule and approved accounting meaning. Quantities must keep their original units. Do not sum unrelated currencies or units to manufacture one reassuring total.

The source receiver publishes actual unbalanced invoices rather than repairing them. The migration workflow distinguishes source defects, transformation defects, target load omissions and acceptable business differences. A corrected source edition or an approved transformation produces a new comparison, while the prior observed values remain in history.

## Whole migration acceptance

The following are product integration requirements for the maintained migration desk.

**Source and mapping.** Bind the immutable original artifacts, complete selected populations, snapshot/edition, field and key mappings, target schema and transformation rules. Record any filter, split, merge, key reassignment, null conversion, date conversion and rounding. The source author's generator history stays distinct from the client's new migration rules.

**Native operation.** Bind the actual invocation/request identity, target connection/workspace identity, requested source edition and actual returned target IDs. Preserve original completion and failure responses. An unknown outcome is reconciled against the existing target operation before a repeat load. A second send with a new ID is not recovery of the first operation.

**Reconciliation.** Compare full primary-key populations and duplicate multiplicities, all required field values, null versus empty text, all non-null parent relationships and exact grouped controls. Retain complete exception populations with source and target locators. A total row count, checksum or a handful of sampled records cannot by itself establish whole-population equivalence.

**Reviewer decision.** Each exception carries a stable ID, current source/mapping/native versions, original and target values, type, owner, reason and disposition. Distinguish correction required, excluded by an approved selection rule, accepted business deviation and resolved by an identified subsequent operation. An approval on an older source/mapping/native result does not silently apply to a new edition.

**Cutover.** Capture the complete agreed baseline and the actual final source change set. Re-run the relevant full comparison against the real loaded target. Keep the original rehearsal history and the current decision. The selected reference has a single published source edition; it supplies no invented newer customer snapshot.

**Rollback.** Bind the actual restore/reversal input and prior target state, the person or role authorizing it, the real operation and the resulting reconciliation. Preserve operations already completed. A proposed rollback plan and an actual completed rollback have separate states.

**Handover.** Supply editable source/mapping/exception records, native operation/results, complete customer report, full source package and operating guide. A fresh receiver opens the original case, checks the selected source identities, recomputes full controls and reopens the target through the maintained native receiver. It retains prior approvals and source history, and produces its own actual receiving result.

## Integration and commercial scope

The source package supplies the complete reference cohort, extraction contract, schemas, lineage and receiving criteria. The migration application composes these with its dlt/DuckDB engine, operator/customer interface, target operation and independent receiving. Definian's proprietary conversion platform and client obligations remain separate from this reference implementation.

The reference helps determine the marginal work needed for multi-object reconciliation. Customer scope still depends on the actual object count, full population size, transformation complexity, target interface, selected cutover plan and approval responsibilities. Licence/tenant access, professional certification, customer appointment and service volume must come from the real engagement.

Acceptance and payment milestones should name concrete source/mapping approval, operated integrated reconciliation, and complete editable independent receiving. Keep defect correction within the agreed delivery capacity and distinguish later scope changes.

## Original population controls

SOURCE_CONTROL_BASELINE.json retains the complete controls calculated from the original JSON at the pinned source commit. It preserves all 15,607 rows across the eleven tables, all 412 invoice-level controls and all 89 customer, country, year and whole-population control groups. Original decimal number tokens are preserved before parsing and all amount arithmetic uses exact hundredths. The original header and extended-line totals are both 2328.60 in UNSPECIFIED_REFERENCE_AMOUNT; all 412 original invoices balance. These are source-population values. The native receiver independently records its actual loaded rows, transformations and reconciliation.

Keep this baseline with the original source selection. A changed source edition produces a new population and controls; the prior baseline remains available for comparison. UPSTREAM_LICENSE.md contains the original source author's complete licence notice.

## Primary sources

- Pinned upstream repository: https://github.com/lerocha/chinook-database/tree/7f67772503d71ba90f19283c38e93923addb43fa
- Original schema/data generation, provenance and licence: README.md, LICENSE.md, ChinookData.json, ChinookDataSet.xsd, ChinookDatabase.tt, AbstractDdlStrategy.cs and SqliteStrategy.cs in the retained upstream directory.
- Definian service overview: https://www.definian.com/articles/data-migration-services-overview
- Definian modernization: https://www.definian.com/solutions/modernization
- SQLite value storage and type affinity: https://www.sqlite.org/datatype3.html
- SQLite full foreign-key check: https://www.sqlite.org/pragma.html#pragma_foreign_key_check
- Exact decimal arithmetic: https://docs.python.org/3/library/decimal.html
- Relational constraints and composite keys: https://www.postgresql.org/docs/current/ddl-constraints.html

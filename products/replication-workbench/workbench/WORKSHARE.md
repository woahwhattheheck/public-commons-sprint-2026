# Sling migration implementation workshare

**Proposed fee: USD 9,600 · Delivery: 15 business days · USD 4,800 at start + USD 4,800 at acceptance**

TokenJunkieLabs will deliver an editable migration workspace for one agreed Airbyte connection and one source/target connector pair supported by the selected original Sling release. The work includes up to five selected tables, a complete baseline and incremental comparison, one consumer cutover with rollback, and a full receiving handoff. This is a proposed implementation engagement; acceptance, contracting and payment are separate commercial events.

## Useful result

Your team receives the retained original configuration, explicit source/target mappings, native replication outputs, complete typed comparisons and the exact decisions used to switch a consumer. The receiving operator can inspect the earlier and current editions, reopen named packages, continue an interrupted native operation through its original journal, and edit the complete application source.

SlingData's [published Airbyte migration guide](https://slingdata.io/articles/migrating-from-airbyte-to-sling/) provides the relevant transition context. This workshare adds a customer-operated intake, execution, review and receiving application around the original engine. A published guide establishes a useful fit; it does not establish that SlingData or one of its customers has commissioned this engagement.

## Scope and work split

The implementation covers one agreed source/target database connector pair supported by Sling 1.6.5, one existing Airbyte connection, and up to five selected tables. We retain the original configuration and review its namespaces, selected fields, mode, cursor, primary keys and explicit type/column mappings. Unsupported transformations, CDC/history semantics or other adaptation requirements remain visible in that review.

The native reference included in the source runs the original complete CSV inputs into distinct SQLite source and parallel target databases. Customer-specific connector execution and full typed-export adaptation for the agreed pair are paid engagement deliverables. The reference is not represented as a completed run against a customer's production system.

Each of the two acceptance comparison rounds covers up to 250,000 aggregate selected rows and 512 MiB of complete selected exported data. Every selected business cell and duplicate multiplicity is compared. A larger data volume, a second connector pair, additional connections, or more than five tables changes the priced scope before that additional work begins.

TokenJunkieLabs owns the implementation, native installation/recovery, connector/export adaptation, full comparisons, one consumer transition, operating guide and editable receiving package. SlingData or the customer supplies the original configuration, permitted source and parallel-target access, an owned execution host, a representative change input, the consumer owner and one consolidated review.

## Delivery schedule

| Phase | Business days | Delivered result |
| --- | ---: | --- |
| Configuration and migration contract | 3 | Original configuration, selected streams and explicit execution/acceptance bindings |
| Native baseline and connector adaptation | 4 | Customer-hosted original engine, complete export adapter and baseline output |
| Change edition and full comparison | 4 | Incremental/source-schema change, typed full-row comparison and resolved differences |
| Consumer switch and rollback | 2 | Actual consumer selection, observed result, prior-selection restoration and reviewed final selection |
| Receiving and operating handoff | 2 | Full editable/native package, fresh receiving, operation guide and consolidated corrections |

The clock starts after written scope acceptance, the USD 4,800 start milestone, and availability of the agreed inputs, access and reviewer. Input or access delays move the dependent delivery dates. One consolidated correction cycle against the agreed acceptance is included.

## Acceptance

1. The original configuration and selected executable/archive identities are retained with the agreed connector bindings.
2. Baseline and incremental comparisons include every selected row and cell. Schema and primary-key checks pass, duplicate multiplicities match, and the original native commands have successful exit receipts.
3. The chosen comparison identifies the selected plan. The actual consumer reads the accepted parallel edition; rollback restores the recorded prior edition. Up to five reviewed downstream text files are included in this one transition.
4. The receiving workspace retains the original source bytes, native attempts, decisions and complete history. Same named handoffs reopen with the same bytes, and the customer can operate and edit the delivered application.

The receiving result lists unresolved issues explicitly. A failed native command, mismatched comparison or unresolved consumer drift is addressed before the corresponding acceptance is recorded. This is a concrete delivery criterion, not an assertion that a currently prepared reference has already completed.

## Economics and decision

The proposed implementation fee is **USD 9,600**, with **USD 4,800 at start** and **USD 4,800 upon acceptance**. The customer reviews the delivered acceptance package within three business days and provides one consolidated correction list. The fee covers implementation effort; customer-owned compute, storage, network and database/warehouse consumption remain customer operating costs. This offer includes no recurring hosted service.

The proposal is open through **October 27, 2026**, subject to an agreed start slot and the stated inputs. The next decision is the source/target connector pair and the existing connection to use for the first paid implementation.

## Original engine and reusable source

The application selects Sling **1.6.5**, original source commit `7641892e24a7023c8012069596698970c7b3e041`. Its published Linux amd64 archive is 121,317,497 bytes with SHA256 `e4e386c7d4429b33a213c146594be0bf6efa38f4732035dd67e307616fcb9c66`. The engine is retained unchanged. Its original license and source references accompany the handoff; the surrounding application has its own included license.

The two original input files contain 1,000 baseline rows and 14 changed rows. The source-defined change updates 12 existing IDs and introduces two new IDs, giving an expected final population of 1,002. Complete actual execution, browser and receiving outcomes are recorded separately in `CUSTOMER_RESULT.json` when the original programme finishes.

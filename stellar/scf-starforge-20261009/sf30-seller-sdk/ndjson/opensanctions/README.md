# OpenSanctions source monitoring

A customer operator for original OpenSanctions data editions, source changes, native screening operations and case decisions. It attaches to the retained SF30 NDJSON Workspace and uses the original dataset engine for projection, querying, comparison and receiving.

The console has seven plain views: overview, source editions, data updates, change review, counterparties, native screening and receiving. Original data, the provider's event and the customer's decision stay accessible together.

## Open the application

Use Python 3.11 or later and the Node 22 runtime already required by the original NDJSON application. Keep this directory inside the complete SF30 source tree; its sibling NDJSON application and shared XML Workspace supply retained storage and the native engine.

~~~sh
export SF30_XML_NODE=/absolute/path/to/node
python ndjson/opensanctions/cli.py \
  --workspace /absolute/private/customer-workspace --create serve
~~~

Open the exact private URL printed by that process. Later openings omit --create. The server binds to loopback and gives each process a new capability token. The original dataset console remains available from the navigation link.

The workspace is an operator-owned directory with mode 0700. The existing NDJSON lease, database and object store remain authoritative. A later process reopens the workspace after its current operator closes it. Managed installations can attach Domain(existing_ndjson_workspace) and use the same methods through their current application host.

The source, case and receiving workflow uses the Python standard library. Native screening uses the customer's configured yente service, with its own supported installation and data entitlement.

## Receive the original data

Choose **Source editions**.

1. Supply the original dataset metadata URL, or upload the original index and complete flat entities.ftm.json export.
2. Record the intended evaluation or customer-licensed use.
3. The application checks the original resource's published SHA-1 and byte size before indexing the edition.
4. It builds the source through the original SF30 NDJSON projection. IDs, schema and original properties remain exact strings. Nested values are retained as JSON with explicit missing/null state columns.
5. Inspect records by physical source line and ordinal, or open the original source file.

The accepted format is flat FtM JSON Lines. Original id, schema and string-array properties are required. Global referents, source datasets, caption, target status and observation metadata are retained when present. A source-scoped export still uses globally resolved canonical IDs; its properties are those of the selected dataset.

Original property arrays and source bytes remain intact. Indexes retain both current IDs and every supplied referent. An alias resolving to multiple current records is surfaced explicitly.

The native query form and original dataset console use the engine's declared query parameters. For example:

~~~json
{"where_id":"Q94511220","fields":"id,schema","limit":"5"}
~~~

Filter names use the original where_ prefix. Query replies retain the dataset snapshot, original engine blob, page totals and cursor.

### Statement lineage

Upload an original statement CSV when available. Its required columns are:

| Column | Retained meaning |
|---|---|
| entity_id | Original source entity identity |
| canonical_id | Provider's consolidated identity |
| dataset | Original assertion's dataset |
| prop | Original property |
| value | Original value |

Additional native columns remain unrenamed, including original_value, lang, origin, schema, prop_type, first_seen and last_seen when supplied. Column order, quoted cells, physical line ranges and duplicate rows remain available.

A statement removal is compared between two complete exports of the same explicitly declared population. A selected page can be useful source material without representing that full population. Statement observations stay separate from a designation's effective dates.

## Reconcile a source update

Choose an earlier and later edition of the same dataset. Receive the original delta index, then every required nonempty delta file in chronological version order.

The provider events are applied as published:

- **ADD** contains a complete current entity whose ID is absent from the selected base.
- **MOD** contains the complete replacement for an ID present in that base.
- **DEL** contains the original ID to remove.

The application validates the whole chain and retains each source file, event envelope, physical line, version, before/after content hash and operation count. Identifier interpretation happens after the complete chain. A deleted ID can become a referent on an entity added or modified later in the update.

The provider's index contains the last 100 **nonempty changing editions**, rather than 100 daily captures. An export with no change file can still have fresh observation metadata. A baseline older than the available chain uses the complete retained target for full receiving.

### Exact publisher reconciliation

The application implements the original HashDelta.feed projection pinned in SOURCE_CONTRACT.json: SHA-1 over UTF-8 ID, schema, sorted property names and each property's sorted string values, concatenated without separators.

Full original records are also compared independently. This preserves two useful results:

- Whether the ordered delta chain equals the target's publisher-projected content.
- Which full record fields differ between the incremental representation and independently retained published export.

Changes in last_seen, global referents or ordering can remain visible without being described as an additional provider MOD.

The operator selects the checksum-verified **complete published edition**. Selection retains the delta operation and full-record comparison alongside the chosen native source/build IDs. Each later selection records its reviewer, reason and prior revision.

## Review source changes and customer decisions

Choose **Change review**. The default view emphasizes property, identifier and designation changes; the full original comparison remains selectable.

| Application classification | Review meaning |
|---|---|
| ID_REPLACED_OR_MERGED | A prior ID resolves through current referents to one canonical identity |
| IDENTIFIER_AMBIGUOUS | A prior identity resolves to more than one current record |
| ENTITY_ABSENT_IN_SELECTED_EDITION | The ID is absent from current IDs and referents in this selected source |
| ENTITY_ADDED | The complete current source contains a new canonical ID |
| ENTITY_CHANGED | Original properties or meaningful identifier/source metadata changed |
| SOURCE_ASSERTION_REMOVED | A value assertion is absent from a complete equal-scope statement export |
| OBSERVATION_METADATA_UPDATED | Original observation or ordering changes remain available for inspection |

These are application review classifications. Original ADD, MOD and DEL events retain their provider names and source records.

Comparison interpretation v2 distinguishes referent/dataset membership from array order. It preserves both original arrays and reports added/removed members; a different iteration order alone does not reopen identity review. Property arrays retain order while separately reporting semantic additions/removals.

A source absence is scoped to its retained dataset and edition. Designation review uses an actual linked Sanction entity and original authority fields such as authority, authorityId, unscId, programId, provisions, status, listingDate, startDate and endDate. An explicit authority-change review records its original authority URL and reason.

### Customer case history

Receive original customer FtM objects under a stable portfolio key. Each portfolio edition is immutable; original counterparty IDs remain in that customer namespace.

A case carries two distinct decisions:

- **Identity:** same entity, different entity or undecided.
- **Relevance:** in scope, out of scope or undecided.

The original case identity persists when the operator updates its current canonical pointer. Every decision preserves the prior revision, reviewer, reason, edition, source candidate and complete previous values. Saves compare against the actual current revision.

A case can originate from source inspection or a native returned candidate. When it references a native match operation, the candidate must appear in that operation's response for the selected counterparty.

The customer's monitoring policy selects identity properties, programs, topics and datasets. Default identity fields include names/aliases, birth date, nationality, registration/tax/identity numbers and vessel/securities identifiers. Empty program/topic/dataset lists mean all values within the selected source context.

The impact view routes identity changes and source/designation relevance separately. Confirmed mismatches preserve the existing decision. Confirmed matches can reopen for configured identity changes. A linked Sanction triggers relevance review when its designation data or meaningful source membership changes; its own referent history does not by itself reopen the subject's identity. Original observation updates remain inspectable. Decisions explicitly reviewed against the selected current edition stay current when that same comparison is reopened. An undecided gate remains available for review.

## Native yente screening

Choose **Native screening** and save an immutable service profile.

~~~json
{
  "label": "Customer yente",
  "endpoint": "https://customer-yente.example",
  "dataset": "customer_screening",
  "auth": {"kind":"Bearer","env":"CUSTOMER_YENTE_TOKEN"},
  "parameters":{"algorithm":"logic-v2","limit":10,"threshold":0.7},
  "config": {},
  "weights": {},
  "sourceNote":"Customer-operated service and selected data entitlement"
}
~~~

For https://api.opensanctions.org, use ApiKey with the name of the configured API-key environment variable. A local native service can use HTTP loopback and explicit unauthenticated configuration. The stored profile retains the environment reference.

| Operation | Native route | Retained result |
|---|---|---|
| Match counterparties | POST /match/{dataset} | Queries, candidates, scores, match decisions, explanations and totals |
| Refresh entity | GET /entities/{id} | Current original entity and referents |
| Read service catalog | GET /catalog | Original configured dataset catalog |
| Read statement page | GET /statements | Native filters, pagination, source rows and totals |

Matching bodies use the selected counterparty's original schema and properties. Its original ID is the response correlation key. Native parameters, algorithm config and feature weights use their documented fields.

### Prepare, dispatch and receive

Preparation creates an immutable request identity and retains its exact bytes. Repeating the same preparation reuses the operation. An explicit refresh reason creates a later screening request when required.

Before dispatch, the application resolves the configured environment reference. It then saves a DISPATCHING reservation before the HTTP request may leave the process. Automatic redirects are disabled. The actual status, selected response headers and original response bytes remain attached to that request.

A received match response must contain the original correlation keys and valid native candidate/score/match structures. HTTP errors, invalid responses and uncertain transport results remain explicit states. Reopening a workspace with an interrupted dispatch marks that original operation uncertain; the operator can receive the existing worker's actual result through response intake.

Remote workers return their actual response file, HTTP status and source note. The application checks those original bytes against the request. Reattaching an identical response reuses the result.

## Complete receiving handover

**Download complete receiving workspace** produces a ZIP containing:

- Every original NDJSON source/build packet required by the selected domain.
- Original metadata, deltas, native requests/responses and immutable content objects.
- Edition/update/selection records.
- Source comparisons and original review events.
- Portfolios, case revisions and complete decision history.
- Service profiles with environment references.

Receiving uses the original NDJSON packet importer to reconstruct every projection and native dataset snapshot. It verifies source/object byte counts and hashes, rebuilds entity/referent/statement indexes, and regenerates native comparisons. Compatible original identities are reused; conflicting case or update histories produce an explicit receiving conflict.

The receiving ZIP is customer operating material. Select its delivery audience according to the actual source and customer data it contains.

## Python and HTTP composition

~~~python
from model import Domain

domain = Domain(existing_ndjson_workspace)
edition = domain.accept_edition(metadata_stream, entity_stream,
    metadata_url=original_url,
    entitlement={"kind":"customer_licensed","note":customer_scope})
comparison = domain.compare(before_id, after_id)
page = domain.changes(comparison["id"], limit=50, material=True)
~~~

The updates module exposes update_plan, stage_update and select_update for retained source objects. The matching module exposes save_profile, prepare, dispatch and receive. They use the same Domain, mutex, SQLite database and original lease.

The HTTP extension exposes /api/os/ operations in web.py. Original /api/query, source/build/export and dataset console routes remain with the existing handler. The console supports original uploads/downloads, paginated inspection, revisions, request/response intake and complete receiving.

## Selected primary contracts

SOURCE_CONTRACT.json records the original implementation revision, schema sources, reference URLs and evaluation data identities. Primary sources include the provider's monitoring, identifier, bulk JSON, delta and statement guides, yente's OpenAPI, and the original exporter implementation.

The original UN operating material includes September 30 and October 12, 2026 full exports and the three intervening nonempty delta editions. Its population moves from 2,926 to 2,923 through four MOD, four DEL and one ADD. The actual replacement of NK-imakgBoSw66P4ytCKUaNZ2 by Q94511220 provides the identifier receiving case.


The complete original-source receiving operation reconstructed three native builds, both retained editions and the two-event case history in a fresh Workspace. Its original source query returned the same dataset snapshot and canonical entity. The current reviewed case retained both decisions without reopening on that edition. Native screening operations use the selected service's own indexed edition and actual response, retained with the customer request.

Native candidate review continues the single existing case when its candidate or current canonical pointer matches. If the counterparty has several possible histories, the operator chooses the original history or explicitly starts a separate case. The prior case ID, revision and decisions stay visible while the exact received native request is attached to the new review.

## Installed Applications

The same console is available as **OpenSanctions source monitoring** through the maintained Applications registry. Its source-owned adapter extends the original NDJSON binding and shares the original workspace resource identity. Review and save the selected existing Python/workspace, start and open the authenticated console, then stop and reopen through the same managed application. Full source and customer receiving are described in [MANAGED_APPLICATIONS.md](MANAGED_APPLICATIONS.md).

The installed `source-monitoring` command forwards to this original Python application. Its additional `binding`, `--expected-binding`, `--startup-format json` and optional `--connection-file` interface retain the original source, Python and workspace identity without copying the case database into another service.

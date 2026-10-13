# GLEIF company source contract

The company research workspace reads the official GLEIF JSON:API resource at
https://api.gleif.org/api/v1/lei-records. Its implementation follows the
[official API documentation](https://documenter.getpostman.com/view/7679680/SVYrrxuU),
the [GLEIF Data Dictionary](https://www.gleif.org/en/lei-data/access-and-use-lei-data/gleif-data-dictionary),
and [current API field additions](https://www.gleif.org/content/4_lei-data/1_access-and-use-lei-data/6_supporting-documents/GLEIF-API-Changes-Documentation.html).

## Source acquisition

An exact LEI query selects one complete 20-character identifier with ISO check
digits. A legal-name query retains the entered string, optional country and source
statuses, and page size. The provider performs its own search; the returned
entities remain individual research candidates.

The original source query determines the entire capture. Each complete HTTP body,
URL, status, observed time, request-start time and selected response headers is
stored before the next-page position advances. Next links must keep the official
origin, resource path and original filter/size parameters and advance the source
page number. A source change or invalid link produces an explicit original
request error. The collector follows every returned page until links.next is null.

The source currently reads at most 100 records per requested page and allows
16 MiB for one page. These are local request/file settings. There is no
first-page or first-N-rows truncation. The native dataset supports up to one
million records and 256 MiB of CSV. A selection exceeding a concrete native
limit remains available as source research and can be delivered using full
reports or a separately selected source cohort.

GET requests use the official HTTPS origin and return redirects as provider
observations. After a source response supplies Retry-After, its retained capture
cannot resume before that original time. Each successive page uses a one-second
local interval. A failed GET keeps the prior completed responses and continues
the original next page when the operator resumes the same operation ID.

Pages are individually observed provider responses. A multi-page query is not a
transactional registry snapshot. A repeated LEI across pages is surfaced while
all original pages remain retained; it is not silently deduplicated into a
different result. The capture is marked SOURCE_REVIEW, and the complete project
can still be exported and received with every repeated original row. Company
decisions, comparisons and customer datasets require a complete unambiguous edition.

Original source acquired through a service's source URL attachment import keeps
that service's complete uploaded receipt, body identity, original URL and observed
interval. Origin HTTP status and headers remain null when they are absent from the
service return. The receipt-aware importer validates the exact body size and SHA-256
against that retained acquisition, then uses the same original JSON:API page rules.

## Fields and source meaning

Every complete JSON:API resource, including unknown future attributes,
relationship links and included records, survives in the original response.
The report includes the complete selected resource beside its convenience columns.

| Research column | Original source |
| --- | --- |
| lei | JSON:API id and attributes.lei, required to agree |
| legalName / legalNameLanguage | entity.legalName |
| otherNames / transliteratedOtherNames | Complete original name arrays |
| entityStatus | entity.status |
| registrationStatus | registration.status |
| legalJurisdiction | entity.jurisdiction |
| legalFormId / legalFormOther | entity.legalForm |
| registrationAuthorityId | entity.registeredAt.id |
| registrationAuthorityEntityId | entity.registeredAs |
| legalAddress / headquartersAddress | Complete distinct address objects |
| creationDate | entity.creationDate |
| initialRegistrationDate / lastUpdateDate / nextRenewalDate | Original registration dates |
| managingLou | registration.managingLou |
| validationSources | registration.corroborationLevel, or the explicitly supplied source validationSources field |
| bic | Complete attributes.bic array |
| successorEntities | Complete repeating entity.successorEntities; legacy single field only when the repeating field is absent |
| entityEvents | Complete entity.eventGroups |
| relationshipReferences | Complete original relationships object |
| captureId / sourcePage / sourceObservedAt | This capture's retained source observation |

The legal entity's status and its LEI registration status describe different
source concepts. A lapsed LEI registration does not convert an entity's own
ACTIVE status to INACTIVE. Registered identifiers remain strings. Name language,
address structure, repeating successors, event groups and relationship links
remain available in full.

A relationship reference is a source link and any included identifiers. The
workspace does not substitute a guessed parent identity or silently download
a different relationship family. Inspect the retained reference and use its
explicit original source in further research.

The public data are offered by GLEIF under
[its LEI Data Terms of Use](https://www.gleif.org/en/meta/lei-data-terms-of-use);
the Access Service section identifies CC0 for reference data. The product
identifies GLEIF as the source and TokenJunkieLabs as the software publisher.

## Review and source revisions

A company review contains a stable review ID, LEI, exact source capture,
original complete resource, source-page identity, reviewer, rationale, use case,
next research work and Include / Exclude / Research decision. Every revision is
retained. One stable current review ID belongs to each company LEI. Updating a
review supplies its current expectedVersion; source-specific effective decisions
come from the complete history for that LEI and capture.

The browser retains edits independently of refresh. A changed source resource
is labeled for another review. Selecting Include requires an explicit saved
decision against that exact source. Reports selecting an earlier capture use
its latest source-specific review, retaining later review history in the project.

Comparison requires complete editions of the same original query. It compares
all original attributes and relationship data and emits JSON Pointer paths with
before/after values and presence flags. Arrays remain full ordered source values.
Added, changed, unchanged and missing records retain their complete original
resources. Missing means absence from the later selected search result.

## Files and receiving

Customer reports contain complete original records in JSON and JSONL, all
projected rows in CSV, a separate spreadsheet CSV with formula-prefix treatment,
and printable HTML. Every selected source response stays in the project export.
The native SF30 CSV uses original strings; it is the machine dataset, while the
spreadsheet file is explicitly separate.

Native dataset configuration declares every column as a string. Structured
source fields are JSON strings. Original filters and sort capabilities are
selected explicitly. Native dataset loading, snapshot identities, admission,
cursor behavior and queries use the maintained dataset-handler.mjs.

The portable project schema is stellar-forge.gleif-research.v1.package. It
contains immutable project metadata, complete saved state and all source/report/
dataset object bytes in base64 with lengths and SHA-256 identities. Its sha256
binds the canonical package body without the sha256 field. Receiving validates
the complete inventory and source sequence, restores native dataset files, and
opens the same original project identity in the selected empty private directory.
Immutable files are staged and flushed before their completed filename appears.
The complete state is capped at its 256 MiB reopening limit before replacing the
last readable state. Browser/client complete JSON delivery also has a 256 MiB
limit, including base64 and state; the CLI can carry larger total JSON packages
whose individual objects and project state fit their limits.
The source package remains a separate versioned software deliverable.

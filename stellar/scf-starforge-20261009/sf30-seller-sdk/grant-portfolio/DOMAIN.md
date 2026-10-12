# Grant portfolio domain

The model reconciles independently published grant and activity records while preserving
the meaning and coverage of each source. It owns the review relationships and saved
portfolio history. The original IATI, 360Giving, XML and NDJSON engines continue to own
source parsing, native projection, publisher validation and complete native receiving.

## Source identity and original values

A source ID is SHA-256 over its exact input packet identity, standard, original selection,
label and capture/coverage statement. It identifies a selected publication context.

Each source retains:

- The complete original native handoff ZIP.
- Authoritative source URL, observation time, license and coverage.
- Native publisher/portfolio/build identities and original receiving information.
- Every selected original entity and financial record.
- The installed source files used to receive and project the native edition.

Entity keys use the record kind and published identifier. An organization without an
identifier keeps a source-local identity derived from its complete original representation.
Both the published identifier and original value remain visible.

A review reference is exactly:

~~~json
{"sourceId":"SOURCE_SHA256","entityKey":"ENTITY_SHA256","sha256":"ORIGINAL_ENTITY_SHA256"}
~~~

The semantic SHA binds the complete original entity used for the review:

| Entity | Retained original |
| --- | --- |
| IATI activity | Every native activity field plus the complete original activity produced by the existing IATI XML walker. |
| 360Giving grant | Every original native field and exact complete grant JSON text, including original numeric tokens. |
| IATI organization | Complete original organization objects and their activity roles. |
| 360Giving organization | Complete organization JSON with exact numeric tokens, plus its published grant relationships. |

Nullable native fields remain null. An individual-recipient grant retains its original
recipient data even when it has no recipient organization array. A missing value is never
replaced with zero or an invented organization.

Native source byte identity and semantic record identity serve different purposes. A
following file can change its publication metadata while leaving a particular activity
unchanged. That activity's unchanged semantic review can carry to the explicit replacement
edition. The complete source packet for each edition remains retained.

## Relationships and the review queue

Suggestions use explicit published organization identifiers, shared published reference
tokens, and exact normalized titles. They record the basis for review. Where a record
has multiple proposed counterparts, the queue marks the suggestions ambiguous.

An operator saves a relationship with a reviewer and rationale. Supported link types are
same organization, grant–activity and duplicate. Confirmed, rejected and ambiguous
dispositions are saved. Single-record decisions retain unmatched, coverage-only and
duplicate outcomes.

Current decisions must select records present in the selected portfolio revision, with
their exact semantic SHA. Different decisions for the same record relation cannot silently
contradict one another: reopen the existing decision ID to correct it. Confirmed links
are available as a separate table. Source records and financial rows stay separately
available after a relationship is confirmed.

A duplicate decision identifies the related original record. Its source values remain
available in the ledger and handover. The model does not infer that two separately
published amounts can be removed or consolidated.

## Financial meaning

The original values are decimal strings. Python Decimal computes independent groups
without conversion through binary floating point. The browser and clients display or
transport those same strings.

### IATI

IATI financial eligibility and dimensions come from the existing
[iati_source.py](../iati/iati_source.py) mapper. The complete domain and original report
semantics are described in [the IATI domain guide](../iati/DOMAIN.md).

Transactions retain their original transaction type. A commitment, incoming commitment,
disbursement, expenditure, incoming funds, loan repayment and other native type remain
distinct. Budgets retain type, status, period start and period end. Original currency
eligibility, inherited currency, reporting organization, hierarchy, dates and financial
issues remain in the complete native row.

No currency conversion or budget prorating is added by the portfolio application.
Native ineligible or missing amounts remain visible with their eligibility state.

### 360Giving

The source's amount awarded and amount applied for are separate financial meanings.
The amount, original currency and award date remain in their complete record. Original
funding and recipient organizations are retained as arrays. A grant's amount is recorded
once for each financial meaning, independently of the number of associated organizations.

The complete original grant JSON is retained as exact text, so original number tokens
and optional values survive export, API transport and cold receiving. The original
publisher and its schema files remain the source of native validation.

### Independent groups

A financial group includes source ID, standard, meaning, currency and original native
dimensions. It reports the exact included amount together with included, excluded and
missing counts. When no eligible amount is present, the group amount is null.

This design preserves the relationship between publication and financial meaning.
Neither a shared organization identifier nor a confirmed grant–activity link proves that
two amounts are the same measure or can be added. Source coverage remains part of the
operator's interpretation.

## Following editions

The operator explicitly pairs a removed source edition with a selected replacement of
the same standard. The new revision compares stable entity keys and complete original
semantic hashes.

An unchanged record carries its earlier review, with its earlier reference retained.
A changed or removed record marks the earlier decision stale and identifies the changed,
current or missing references. Stale decisions remain stale until explicitly reviewed.
They are never silently accepted by a later source addition.

Record changes include additions, removals, changed originals and originals that remained
unchanged in an explicit following edition. Review updates are included in the revision
changes. Full previous editions, decisions and financial records remain in the history.

## Saved transactions and complete receiving

An operation retains its exact ID and input before execution. Native source preparation
and complete export creation run against immutable inputs. Domain changes, workspace
revision advancement and action completion commit together in the original SQLite
transaction. A process interruption retains an operation for continuation.

Each portfolio revision has a SHA over its complete definition, original edit, decisions,
financial groups, source selection, previous snapshot and full table hashes. A complete
handoff contains every revision through the selected one, every referenced original
source packet, every table, all original portfolio operations and the selected application
source.

The receiver invokes the installed original source engines and rebuilds every saved
revision from its original edit. It compares complete record tables and snapshot identities
before publishing the received domain history. Incoming original operations retain their
source workspace identity through later local revisions and re-export.

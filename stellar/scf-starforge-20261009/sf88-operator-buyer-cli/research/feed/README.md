# Scholarly metadata feeds

This extension adds source-to-target field contracts, exception decisions and frozen
deliveries to the original research workspace. Open **Feed** on a retained works
edition. The same query, page chain, original buyer records and research reviews
continue to own acquisition and source identity.

## Operate the complete workflow

Node.js 22 or newer and Linux are required. Receiving uses Python 3 for the
original research receiver's atomic destination publication. The feed modules
use only Node's standard library. No provider credentials are needed to map,
compare, export or receive already retained editions.

From sf88-operator-buyer-cli:

```sh
node research/feed/cli.mjs serve --workspace /absolute/research-workspace
```

Open the printed local URL. The original server binds to 127.0.0.1 and uses its
existing host/origin checks and session bearer token.

1. Select an existing works edition and open **Feed**.
2. Create a contract. The supplied OpenAlex contract covers identity, DOI and
   matching key, title, publication date/year, source and target work type,
   language, ordered authorship, author/institution identities, venue, locations,
   access/license observations, topics/keywords, citations and retraction status.
   Its 21 columns plus source/review metadata implement the sixteen intake
   concepts without collapsing structured authorship into ambiguous text.
3. Edit target names, source JSON Pointers, types, transformations and missing/null
   rules. Save the complete contract revision. An identity field must remain a
   required, non-null direct mapping from the original /id.
4. Review the complete mapped-record, field-exception and omitted-occurrence tables.
   Search and paging cover the entire selected table. Inspect a row for its
   original page, request, query, edition and exact zero-based source pointer.
5. Save field decisions with a note. Replacements must satisfy the declared type.
   Omit only optional fields, or explicitly exclude the work. A source occurrence
   without a work ID can be excluded. Conflicting duplicate occurrences require
   a saved decision to keep the original first occurrence.
6. Compare another retained edition using the same contract. The comparison
   retains each edition's query identity, coverage, original research review
   and field-review context.
7. Freeze the complete delivery. Download the fixed JSONL, CSV, report and complete
   ZIP with both original source editions when comparison is selected.
8. Receive the unpacked delivery into a new operator workspace, then reopen its
   original research application. Repeating the same receive preserves later
   receiving-operator contract revisions and field reviews.

## Contract semantics

A field is a flat target name, a source JSON Pointer and a declared type. The
pointer escape rules are ~0 for tilde and ~1 for slash. The extension * traverses
array members in source order. The full authorships field preserves author roles
and author/institution associations; the derived author and institution arrays
are convenience projections. Missing array-element subfields are exceptions.

Supported types are string, number, integer, boolean, array, object, date, uri and
any. Dates preserve source day precision and must be valid YYYY-MM-DD dates.
Integer fields must be safe JSON integers. URI fields accept HTTP(S) URLs.

| Transformation | Behavior |
| --- | --- |
| identity | Preserve the exact JSON value and structure. |
| trim | Trim surrounding whitespace from a string. |
| doi-key | Normalize a DOI URL or DOI-prefixed string to a lower-case DOI key; the raw DOI remains a separate field. |
| flatten | Flatten one array level while preserving order and duplicates. |
| enum | Use an explicit raw-value to target-value JSON object; an unmapped value opens an exception. |

Absent optional source values follow the declared omit or null rule. Explicit
source null remains null and must satisfy nullable. A required absent value is
an exception even when the target normally permits null. An empty required
string is also an exception. These distinctions are visible in field coverage.

**All eligible works** honors explicit original research exclusions. **Only
included research works** also excludes undecided works. The complete source
exports retain every original occurrence and original review. Distinct OpenAlex
IDs remain distinct even when DOI keys match; collisions are reported separately.

Field review is keyed by the complete contract content and the exact source
fingerprint. That fingerprint includes edition/query/page identities and original
research decisions. A changed contract or research source opens a fresh review
context. Saved decisions never silently migrate onto changed source values.

A freeze requires all field exceptions to be resolved and a COMPLETE capture,
unless the saved contract explicitly permits partial capture. Coverage remains
visible in every case. The optional comparison may contain unresolved earlier
field exceptions; its summary includes their count, and the saved earlier review
is included in the package.

## Fixed delivery and receiving

Every output row has _source with edition/query IDs and revision, query hash,
page and zero-based row, source record pointer, page and request hashes, capture
timestamp, source URL and source fingerprint. The original research decision is
carried in _review. Citation counts and access/license values are dated
observations through this source timestamp.

JSONL is the typed feed. CSV contains the same columns, with arrays/objects encoded
as JSON, absent values as empty cells and explicit null as the literal null.
Spreadsheet formula-like cell values receive a leading apostrophe; use JSONL when
the exact original string is required. The CSV quoting also preserves embedded
commas, quotes and newlines.

The fixed release contains feed.jsonl, feed.csv, summary.json, field-report.csv,
exceptions.json, omissions.json, doi-collisions.json, the exact contract and
field review, report.html, RECEIVING.md and complete original source exports.
A selected comparison adds comparison.json and its earlier field review. The
manifest records exact file sizes and SHA-256 values. Partial writes have no
published manifest; repeating the same freeze safely resumes matching files.

```sh
node research/feed/cli.mjs inspect --source /absolute/unpacked-delivery
node research/feed/cli.mjs receive --source /absolute/unpacked-delivery --workspace /absolute/new-workspace
node research/feed/cli.mjs serve --workspace /absolute/new-workspace
```

Receiving validates every delivery member, source export and source chain. It
composes the original research receiver, validates saved field decisions and
regenerates the delivered JSONL and CSV before adopting the feed extension.
It retains the exact release and contract/review revision in the new workspace.
A repeated import verifies the same delivery and leaves the receiving operator's
later edits in place.

## Programmatic operation

```js
import {openResearchWorkspace} from '../workspace.mjs';
import {openFeedWorkspace} from './workspace.mjs';

const research = await openResearchWorkspace('/absolute/workspace');
const feed = await openFeedWorkspace(research);
try {
  const contract = await feed.saveContract({
    contract: feed.defaultContract('metadata-feed'),
    expectedRevision: 0,
  });
  const selection = {
    contractId: contract.contract.id,
    contractRevision: contract.revision,
    editionId: 'retained-edition',
  };
  const preview = await feed.preview(selection);
  // Resolve exceptions through feed.resolveException using the returned
  // sourceFingerprint and expected review revision, then reopen the preview.
  const release = await feed.freeze({
    ...selection,
    sourceFingerprint: preview.sourceFingerprint,
    expectedReviewRevision: preview.reviewRevision,
  });
  await feed.exportRelease(release.id, '/absolute/delivery');
} finally {
  await research.close();
}
```

CLI commands are default, contracts, save-contract, preview, resolve, compare,
freeze, releases, export, inspect, receive and serve. Run each from the original
sf88 source directory. Save a contract from a JSON file with:

```sh
node research/feed/cli.mjs default --id metadata-feed > /absolute/contract.json
node research/feed/cli.mjs save-contract --workspace /absolute/workspace --file /absolute/contract.json --expected-revision 0
node research/feed/cli.mjs preview --workspace /absolute/workspace --contract metadata-feed --edition retained-edition
node research/feed/cli.mjs freeze --workspace /absolute/workspace --contract metadata-feed --edition retained-edition --before earlier-edition
node research/feed/cli.mjs export --workspace /absolute/workspace --release feed-RELEASE_ID --destination /absolute/delivery
```

Use expected revisions when editing a saved contract or review. A stale write
returns a conflict with an instruction to reopen current state. The extension
shares the original workspace lock; acquisition, research decisions and feed
freeze cannot interleave inconsistent writes.

## Original-source exercise

The complete workflow was operated on the retained 169-work, two-page collection
(100 + 69 records) and its existing second review edition. The source pages were
unchanged. The supplied contract preserved 71 explicit DOI nulls, eleven
language nulls and thirty venue nulls; primary_topic was absent from all 169
selected source records.

A reference vocabulary contract left the actual book-review type for individual
review. The operator resolved that exception for W1539928189 by keeping its exact
source value. The resulting complete feed retained all 169 IDs. The fixed
delivery included both original editions, the mapping and field decision.
Receiving regenerated both machine-readable feeds exactly. Repeating import
retained a later recipient contract revision and recipient review note.

The earlier edition is a different query/review revision of the same capture.
Comparison therefore reports exact revision identities and review/mapping
changes. The operating example is a retained-source handover journey, and future
dated captures continue through the original provider and buyer workflow.

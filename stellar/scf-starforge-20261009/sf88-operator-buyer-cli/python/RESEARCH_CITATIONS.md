# Python citation analyst and complete customer receiving

This workflow connects the existing Research dossier to a full Python analyst
handover. An analyst reads a notice at a fixed revision, edits the complete
atomic request, saves it once, recovers the same request if its reply is lost,
and exports the original, reviewed and current dossier. The resulting package
contains every selected report, the complete original portable histories and
source bodies, the review request and any selected Analysis outputs.

The implementation uses the original Research SDK, server, citation operation
and portable readers. Python owns the local draft and call records around those
APIs. The optional workbook uses the existing Analysis source, query, workbook
and archive engines. Source coverage remains visible through every stage.

## Install and connect

Use Python 3.11+ on Linux or macOS, the existing Node runtime, and a complete
current source checkout. Upgrade the Python package and matching Node source
together. The wheel does not bundle a Node engine or source tree. The base
citation workflow uses Python's standard library. Select the existing
`workbooks` extra only when producing the workbook; it uses the package's
original pinned openpyxl dependency.

```sh
python3 -m pip install \
  /work/forge/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python

# Only when this operator selects the workbook workflow:
python3 -m pip install \
  '/work/forge/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python[workbooks]'
```

Keep the original Research listener's connection JSON in a private file. It
contains the existing local URL and authentication token. None of the handover
builders includes that connection file, a browser profile, signer settings or
environment values.

```python
from stellar_forge_buyer.research_workspace import ResearchWorkspace

workspace = ResearchWorkspace(
    checkout="/work/forge",
    node="/usr/bin/node",
    connection_file="/private/research/connection.json",
    directory="/private/python-analyst/client",
)
status = workspace.status()                  # actual original workspace ID
citations = workspace.citations(dossier_id)  # actual selected original dossier
```

The selected dossier ID, notice ID, occurrence IDs and review request ID come
from the original workspace. Examples below use variable names for these
actual selections.

## Read a complete notice at one revision

```python
metadata = workspace.metadata(dossier_id)
revision = metadata["revision"]
notices = list(citations.iter_notices(revision=revision, status="all"))
notice_id = notices[0]["noticeId"]
page = citations.detail(notice_id, revision=revision)
```

The iterator freezes the first returned revision when the caller does not
supply one. Every subsequent page uses it. A detail response includes original
registered notice assertions, retained source bindings, affected evidence and
findings, complete review history and source coverage. A registered correction
or retraction is a review input; it does not automatically exclude an article
or replace an analyst's decision. A local “reviewed” state does not establish
complete provider search coverage.

The installed command exposes the same selected-revision surface:

```sh
stellar-forge-research --checkout /work/forge \
  --connection /private/research/connection.json \
  --directory /private/python-analyst/client \
  citation-list --dossier "$DOSSIER_ID" --revision "$REVISION" --all

stellar-forge-research --checkout /work/forge \
  --connection /private/research/connection.json \
  --directory /private/python-analyst/client \
  citation-detail --dossier "$DOSSIER_ID" --notice "$NOTICE_ID" --revision "$REVISION"
```

## Edit the entire atomic review

Create a draft with a new actual request ID:

```python
draft = citations.draft(
    "/private/python-analyst/drafts/notice-01",
    notice_id=notice_id,
    request_id="analyst-notice-01-20261012",
    actor="Named reviewer",
    revision=revision,
)
current = draft.current()
draft.export_request("/private/python-analyst/notice-01.request.json")
```

The exported JSON is the original operation's full request, including:

| Field | Meaning |
| --- | --- |
| `requestId` | Stable identity for this exact atomic review |
| `noticeId`, `expectedRevision`, `expectedFingerprint` | Immutable original notice and dossier base |
| `actor`, `decision`, `reason` | Reviewer and reasoned overall decision |
| `evidenceChanges` | Complete selected state, classification and note for each chosen occurrence |
| `findingChanges` | Full finding title, text and citation occurrence IDs |
| `findingDispositions` | Reasoned disposition for every affected finding |

The initial draft retains all original evidence and findings. Its blank reasons
must be completed before submission. Overall decisions are `retain`,
`revise`, `exclude` and `follow-up`. Finding dispositions are `unchanged`,
`revised`, `citation-removed` and `follow-up`. The original validator checks
their relationship to the actual changes and references.

Edit the whole JSON in the operator's chosen editor, then import the exact bytes:

```python
draft.import_file(
    "/private/python-analyst/notice-01.request.json",
    expected_edit_revision=current["editRevision"],
)
```

Each draft revision is immutable, links to the preceding bytes and retains the
original imported JSON separately. A compare-and-set edit revision prevents
one local writer from silently overwriting another writer's changes. The
`edit()` API and `citation-edit` command also replace a complete selected
evidence, finding or disposition record; they do not apply ambiguous partial
record patches.

```sh
stellar-forge-research --directory /private/python-analyst/client \
  citation-draft-import --draft /private/python-analyst/drafts/notice-01 \
  --file /private/python-analyst/notice-01.request.json --expected-edit-revision 1
```

Use `citation-draft-show` to inspect the full current draft and any pending
request. Use `citation-draft-export` to save a new full JSON file. Export refuses
to overwrite an existing file.

A stale draft retains its original base and edits. Review current source and
create another draft/request ID for an intentionally revised decision. Copy
only the changes the analyst has reconciled against that new base. The client
does not silently change a pending request's revision, fingerprint or payload.

## Save once and recover the original request

```python
pending = draft.freeze(citations, expected_edit_revision=2)
reply = draft.submit(citations, expected_edit_revision=2)
review_id = reply["review"]["id"]

# After an interrupted/lost reply, reopen the same caller and draft:
reply = draft.submit(citations, expected_edit_revision=2, recover=True)
# Or recover its original Python call record directly:
reply = citations.recover("analyst-notice-01-20261012")
```

Freeze invokes the original Node input validator and retains the entire
normalized request and its hash. No further draft edit is accepted after a
pending request has been frozen. Before freeze/submission or export, an actual
status handshake establishes the original workspace identity and compares it
with the saved selection. A connection pointing at another workspace cannot
submit or export that selection.

The existing Python Research call journal retains the action, exact request,
workspace, attempts and original response. A known completed response returns
unchanged. The original server recognizes the same request even after later
dossier edits; different bytes under the same request ID are rejected. Unknown
transport completion stays visible until the original same-request recovery
is selected. Do not create another ID to retry an uncertain save.

```sh
stellar-forge-research --checkout /work/forge \
  --connection /private/research/connection.json \
  --directory /private/python-analyst/client \
  citation-save --dossier "$DOSSIER_ID" \
  --draft /private/python-analyst/drafts/notice-01 --expected-edit-revision 2

# Same request and pending bytes:
stellar-forge-research --checkout /work/forge \
  --connection /private/research/connection.json \
  --directory /private/python-analyst/client \
  citation-save --dossier "$DOSSIER_ID" \
  --draft /private/python-analyst/drafts/notice-01 --expected-edit-revision 2 --recover
```

## Export and cold receive the whole analyst handover

```python
delivery = citations.delivery(
    "analyst-notice-01-20261012",
    "/private/python-analyst/delivery",
)
manifest = delivery.export(citations)
workspace.close()

received = delivery.receive(
    "/private/python-analyst/received",
    checkout="/work/forge",
    node="/usr/bin/node",
)
handover = delivery.archive("/private/python-analyst/Citation_Analyst_Handover.zip")
```

The selection freezes three revisions: immediately before the review, the
reviewed revision and the selected current revision. It also retains their
complete original detail, metadata and history. The default current revision
is read once; later source/head changes do not retarget that selection.

There are **twelve original exports**: HTML, Markdown, JSON and gzip portable
files for each of the three revisions. Both original portable readers cold
reopen the selected current history and check every selected report, source,
review and history prefix. Completed receiving is a required input to the
first handover archive, so a premature ZIP cannot trap a later complete
customer handover.

The first published export bytes remain authoritative. If a download reply or
local receipt was interrupted, the exporter verifies the existing candidate
against its retained selection. Portable candidates pass the original history
and review replay; deterministic reports are compared with the same original
revision. Existing bytes are preserved. A missing or changed retained artifact
is reported rather than replaced with a newly timestamped export.

`citation-deliver --archive FILE` carries export, cold receiving and archive in
one explicit command. The separate `citation-receive`, `citation-verify` and
`citation-archive` commands retain the same selection and are useful after
interruption. Keep one full extras selection per delivery directory; select a
new delivery directory for a different handover.

Receive the complete ZIP on another host:

```python
from stellar_forge_buyer.research_citations import CitationDelivery

customer = CitationDelivery.from_archive(
    "/private/incoming/Citation_Analyst_Handover.zip",
    "/private/customer/citation",
    expected_sha256=reviewed_handover_sha256,
)
customer.receive(
    "/private/customer/citation-reopened",
    checkout="/work/forge",
    node="/usr/bin/node",
)
```

The extractor verifies the full outer file and exact member manifest, rejects
links and unsafe paths, and checks every file's complete bytes. Existing
matching files are reused; differing customer files are preserved and reported.
The original Research reopen validates source bodies and review transitions,
including the state preceding each atomic review. It does not require the
original HTTP connection or provider account.

## Analysis table, workbook and editable workspace

The optional complete analytical continuation turns the frozen selection into
an ordinary original Analysis source:

```python
from stellar_forge_buyer.research_citation_analysis import run_citation_analysis

analysis = run_citation_analysis(
    delivery,
    "/private/python-analyst/analysis",
    checkout="/work/forge",
    node="/usr/bin/node",
)
```

It retains an audit row for each selected notice, occurrence, finding, source,
review and coverage record at the original, reviewed and current revisions.
The complete source has a native document manifest, exact selected Research
JSON and gzip source pieces, full typed records, and the selected coverage
values. “Complete” describes this frozen audit selection; it does not claim
that an incomplete provider result has become complete.

The same original workspace performs source preview/import, activates its
versioned view, saves the SQL query, creates full JSONL/CSV/SQLite exports and a
workbook, archives the entire editable Analysis workspace, and cold restores it.
Saved job/request IDs survive interruption. A running or failed original
Analysis job stays visible; the helper does not create a new job to bypass it.

The workbook includes an explicit text preview of up to 2,000 Unicode
characters, encoded as an ASCII JSON string, alongside its full character count
and completeness marker. Full text, every citation ID and complete original
record stay in the CSV/JSONL/SQLite exports and source archive. It does not use
a truncated query preview as a full delivery.

Use the actual returned `analysis["files"]` to select optional archive members
under `analysis/`, before the first handover archive. The complete customer
receiver below does this automatically, including the original editable
workspace ZIP. The restored Analysis workspace opens through the original
Python reader without a source checkout; native retained outputs remain
downloadable. New native imports use the customer's configured runtime.

## Operate the original completed customer continuation

`examples/research_citation_analyst.py` receives an **already saved** actual
review. It first proves the same normalized request in the selected original
notice, imports its complete bytes into a local draft, and recovers that exact
review through the original Python call journal. It checks that no dossier
revision changed, retains all twelve exports, cold reopens both original
readers, optionally operates Analysis/workbook/archive/restore, and receives its
own final handover into a separate customer directory.

For a complete original `citation-review-workflow.mjs` result, the Node wrapper
reopens its same workspace with the original listener, invokes Python and
closes only its owned child and listener:

```sh
node /work/forge/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/examples/research_citation_analyst.mjs \
  --existing-run /private/original-citation-run \
  --directory /private/python-citation-receiving \
  --checkout /work/forge --python /usr/bin/python3 \
  --operation-id citation-python-receiving-20261012 --with-workbook
```

Run that command through the already selected native operation or an explicit
continuation after the original listener has closed. Its input is the
completed original result, selected source and saved review; it does not
repeat acquisition, create another review or start a scheduler.

The complete receipt names the original workspace/review/request, three
revisions, exact source files, all outputs and SHA-256 values. Reopening a
completed receiver verifies those outputs and returns its first receipt.
Partial source/output files are preserved for the same operation; a failed or
unknown child exit is never labeled complete.

## File and lifecycle limits

- Original review JSON: at most 16 MiB; the original dossier's state limits
  still apply to the resulting review.
- Local draft/selection state: at most 32 MiB per file.
- Each selected report, portable or extra member: at most 256 MiB.
- Complete ZIP: at most 512 MiB expanded and at most 512 MiB stored, with an
  exact member manifest and at most 10,000 selected members.
- Paths are private, regular files; immutable writes and receiving use original
  locks, checked descriptors, temporary files and atomic publication.
- Base client reads and saved-response readers do not acquire provider data.
  The optional Analysis continuation uses the frozen selected source.
- Connection files, token-bearing URLs and process environment values remain
  in original private runtime state and are excluded from handovers.

## Maintained source joins

The entry is `ResearchWorkspace.citations(dossier_id)`; callers can also import
`CitationReviewDraft` and `CitationDelivery` from
`stellar_forge_buyer.research_citations`. The existing
`stellar-forge-research` command exposes all operations. General top-level lazy
exports stay with the package's existing export owner.

This source composes B9D2's original Research Python bridge, call journal,
Documents/Pipelines and Analysis/workbook interfaces, and the complete original
Research citation operation, browser, Merchant exports and portable history.
It changes no provider, payment or dataset engine.

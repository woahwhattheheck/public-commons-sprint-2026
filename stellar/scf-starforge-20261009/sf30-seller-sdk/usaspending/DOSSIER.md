# Federal award research in the original SF88 dossier

The USAspending workspace captures award searches, keeps their original pages,
enriches selected awards with original details and saves immutable editions.
This receiving bridge carries that same edition into the maintained research
dossier, where an operator can ask questions, review evidence, write cited
findings and export a complete portable project.

Use the original award workspace or its complete saved edition export. The
bridge makes no provider request and starts no purchase. The original SF30
merchant and SF88 customer remain the acquisition path for a purchased edition.

## Start with a saved edition

The installed command is:

~~~sh
starforge usaspending-dossier help
~~~

The source command, from the repository root, is:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/dossier-cli.mjs help
~~~

Use the current Node 22.13+ runtime with built-in SQLite and JSON source-number
context. All file and workspace arguments must be absolute paths. Keep private
workspaces in a private directory whose parent exists.

Create a project using the existing dossier command, then add a question using
the returned project ID and revision:

~~~sh
starforge research-dossiers create \
  --store /private/research-dossiers \
  --title "Federal implementation partnerships" \
  --description "Current prime awards and the implementation work our team can deliver"

starforge research-dossiers question \
  --store /private/research-dossiers \
  --id RETURNED_DOSSIER_ID \
  --revision RETURNED_REVISION \
  --text "Which captured awards fit our technical work, and which source facts support an initial workshare?"
~~~

Retain the returned dossier ID, question ID and current revision. The same
operator can create or edit them in the industrial research workspace.

Receive an existing immutable award edition directly:

~~~sh
starforge usaspending-dossier receive \
  --store /private/research-dossiers \
  --id RETURNED_DOSSIER_ID \
  --question RETURNED_QUESTION_ID \
  --revision CURRENT_REVISION \
  --award-dir /private/award-research \
  --edition ORIGINAL_EDITION_ID
~~~

Or receive the original complete edition export:

~~~sh
starforge usaspending-dossier inspect \
  --file /private/delivery/original-award-edition.json

starforge usaspending-dossier receive \
  --store /private/research-dossiers \
  --id RETURNED_DOSSIER_ID \
  --question RETURNED_QUESTION_ID \
  --revision CURRENT_REVISION \
  --file /private/delivery/original-award-edition.json
~~~

The result includes the source signature, original edition and packet identities,
retained component bindings, coverage and current dossier revision. An optional
--out saves that import result to a new file. An identical packet export or the first completed
receipt for the same import is reused. Different existing output is preserved.

Saved analyst reviews are excluded by default. Use --include-reviews when
explicitly receiving an edition export that includes those private reviews.
The existing export is otherwise kept complete, including any original native
buyer delivery stored in its metadata.

## Use the retained source

Open the existing research operator:

~~~sh
starforge usaspending-dossier open --store /private/research-dossiers
~~~

The command prints its loopback URL and session token. The workspace offers the
existing project, question, evidence and finding controls. For each award,
the complete typed row and original record remain available together. Sources
are grouped by the original USAspending award URL; a later edition preserves a
separate source occurrence and any changed content.

A practical research pass is:

1. Read the captured query dates, filters and coverage before choosing a prime.
2. Inspect the original recipient, parent recipient, agency, award description,
   performance dates and amount fields.
3. Add separately captured company or opportunity sources to the same research
   question using the existing research-result import.
4. Select evidence and write the concrete technical workshare as an analyst
   finding, citing the source records that support the proposed fit.
5. Export the source-backed report and portable project for the relationship
   owner or receiving engineer.

The bridge preserves complete records; selecting evidence controls what the
analyst emphasizes. A source record establishes the reported award facts. The
operator supplies technical fit, implementation scope, deliverables, acceptance
criteria and commercial terms in the finding.

### Read amount and identity fields correctly

| Field | Preserved meaning |
| --- | --- |
| award_amount_usd | Original award-search amount, or the detail record's total obligation. |
| total_obligation_usd | Original detail total_obligation value. |
| exercised_usd | Original base_exercised_options value. |
| potential_usd | Original base_and_all_options value. |
| outlays_usd | Original reported outlay value; null remains unknown. |
| recipient_uei | Identity of the award recipient. |
| parent_recipient_uei | Separate parent-company identity from the original detail. |
| parent_award_key | Separate parent-award identity. |
| source_kind | Original search, original detail, or original buyer delivery. |

All monetary fields remain exact decimal strings. They are never passed through
floating-point formatting or added together across unlike fields. Missing amounts
remain null. Search coverage, enrichment coverage and the current edition's
selection remain separate in the retained coverage object.

Original source references:

- [USAspending API](https://api.usaspending.gov/)
- [API documentation](https://api.usaspending.gov/docs/)
- [Official source and API contracts](https://github.com/fedspendingtransparency/usaspending-api)
- [Original research dossier](../../sf88-operator-buyer-cli/research-dossiers/README.md)

## Exact saved-edition Node integration

Inside an existing original customer operation, pass the already-open
AwardWorkspace and DossierStore. Their existing owners manage their lifetimes:

~~~js
import {receiveUSAspendingEdition} from './dossier.mjs';

const project = await originalDossiers.get(dossierId);
const received = await receiveUSAspendingEdition(originalDossiers, dossierId, {
  workspace: originalAwardWorkspace,
  editionId: originalReceivedEditionId,
  questionId,
  expectedRevision: project.revision,
  includeReviews: false,
});
~~~

The bridge calls:

~~~js
originalAwardWorkspace.exportEdition(originalReceivedEditionId, {
  includeSourceBytes: true,
  includeReviews: false,
});
~~~

exactly once. It checks the packet digest, immutable edition digest, typed row
digests and original page/detail bytes before writing. The same import works on
an already-exported packet by passing packet instead of workspace.

A complete import creates one metadata component and as many size-aware source
components as the existing response limit requires. All rows, original search
pages, detailed responses, original native delivery archives and remaining packet
metadata are retained. Empty
cohorts still retain their original query and coverage. Each component uses the
original dossier store's exclusive immutable revisions and content-addressed
source storage.

The stable source signature excludes only the export timestamp and the packet's
derived digest. A retry with the current dossier revision reuses completed
components and the first export metadata. Source changes produce a new signature
and new edition occurrences. A conflict from another writer returns the ordinary
REVISION_CONFLICT; the original project remains available at its current revision.
A partial receiving failure carries error.usaSpendingImport with the completed
bindings, allowing the caller to resume the same import.

An optional signal cancels between components. onComponent(binding, progress)
receives the actual saved or reused component. Neither option changes the source
edition or its acquisition state.

The import uses the dossier's existing limits: 64 MiB per retained response,
8 MiB per revision and 256 MiB for a portable export. A single oversized source
record is reported before any import write. Use a selected immutable edition for
a research project that exceeds the portable dossier size.

## Preview the original edition through the provider registry

The operator can also read an original award edition through the existing
provider registry:

~~~js
import {startDossierWorkspace} from '../../sf88-operator-buyer-cli/research-dossiers/server.mjs';
import {createUSAspendingEditionProvider} from './dossier.mjs';

const app = await startDossierWorkspace({
  directory: '/private/research-dossiers',
  providers: {
    usaspending: createUSAspendingEditionProvider(originalAwardWorkspace),
  },
});
~~~

The equivalent installed command is:

~~~sh
starforge usaspending-dossier open \
  --store /private/research-dossiers \
  --award-dir /private/award-research
~~~

Attach provider usaspending with reference {"editionId":"ORIGINAL_EDITION_ID"}.
The original award key is the stable source handle. Coverage and warning state
remain visible, and the original workspace owns access and acquisition.

Use receive for a complete portable source copy. Provider attachment uses the
dossier's existing reference mode: notes, findings and original handles persist,
while its provider view is read from the configured original workspace.

## Reports, portable reopening and exact packet recovery

Use the existing export commands:

~~~sh
starforge research-dossiers export \
  --store /private/research-dossiers --id DOSSIER_ID \
  --format html --out /private/delivery/award-research.html

starforge research-dossiers export \
  --store /private/research-dossiers --id DOSSIER_ID \
  --format md --out /private/delivery/award-research.md

starforge research-dossiers export \
  --store /private/research-dossiers --id DOSSIER_ID \
  --format json --out /private/delivery/award-research.research.json
~~~

A receiver reopens the same dossier and its complete source history:

~~~sh
starforge research-dossiers reopen \
  --store /private/received-research \
  --file /private/delivery/award-research.research.json
~~~

The saved edition packet can be recovered from that portable project with the
source signature returned by receive:

~~~sh
starforge usaspending-dossier recover-edition \
  --store /private/received-research --id DOSSIER_ID \
  --signature SOURCE_SIGNATURE \
  --out /private/delivery/recovered-award-edition.json
~~~

When the same source was attached to more than one question, supply --question.
Recovery reconstructs the first exact export packet, including its export
timestamp and original packet digest, complete source responses, coverage and
saved native buyer metadata. The packet's canonical digest is unchanged; JSON
indentation in the newly written file may differ from another serialization.

The Node equivalent is recoverUSAspendingEdition(portable, sourceSignature,
{questionId}). It returns the complete original packet after checking the retained
component digests and original edition/source identities. Receiving that recovered
packet again reuses the same source signature and completed components.

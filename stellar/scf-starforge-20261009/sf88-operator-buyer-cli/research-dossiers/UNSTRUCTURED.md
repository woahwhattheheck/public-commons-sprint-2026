# Receive Unstructured documents in the research workspace

The Documents pane connects an existing Unstructured Partition purchase to the
original research dossier. Review the upload, exact processing profile, original
payment/output state and document elements, then receive the chosen edition into
an existing question. Sources, evidence selections, analyst notes, findings,
revision comparison and exports remain in the ordinary dossier workflow.

Complete provider and customer setup is in
[the Unstructured merchant handover](../../partners/unstructured/README.md).
That setup uses the original SF30 service, generated client, SF66 commerce
workspace and SF88 buyer. The research workspace consumes its saved purchase.

## Connect the saved buyer

Complete the selected document purchase in its existing commerce console. Keep
that original customer directory, including its inbox and response files. Create
a private source configuration pointing to the actual inbox returned by customer
preparation:

~~~json
{
  "schema": "stellar-forge.unstructured-document-source.v1",
  "workspaceId": "customer-document-operations",
  "inboxDirectory": "/absolute/original/customer/inbox"
}
~~~

Preserve the stable workspace ID with this source and its receiving history.
The current installed SF88 runtime is selected by default. An operator who has
selected another compatible original runtime may add its absolute
`runtimeDirectory`. For a Node Buyer that holds operations directly, replace
`inboxDirectory` with its original `stateDirectory`. Both may be supplied for a
configured buyer with a separate inbox.

Open the existing research workspace:

~~~sh
npx --no-install starforge research-workspace \
  --dir /absolute/private/research-dossiers \
  --document-source /absolute/private/document-source.json \
  --port 8846
~~~

Use the complete local address printed by that command. Its fragment supplies
the existing private session. Source directories are launcher settings; browser
requests select saved purchases and research questions. Optional OpenAlex,
Crossref and edition-adapter settings work on this same launch.

For programmatic startup, import `openSavedDocumentBuyerSource` from
`@tokenjunkielabs/starforge-merchant/buyer/research-dossiers/unstructured-workspace`,
load the same private configuration, and pass the returned `documentSource` to
`startDossierWorkspace({directory, documentSource, port})`. The existing research
server owns authentication, limits, origin checks and shutdown. Its startup
record adds `documentSourceConfigured` and `documentWorkspaceId`.

## Review and receive the document

1. Open the intended dossier and add or select its actual research question.
2. Choose **Documents**, then its completed original purchase. The list shows
   original intent, profile and saved-output state. Refresh reads the existing
   buyer.
3. Review the filename, size, parameters and original hashes. Payment and output
   have separate fields taken from the original buyer.
4. Inspect element types, page locations, coordinates and table records. **Page**,
   **Element type** and **Text contains** filter the original elements. Opening
   an element shows its complete text and metadata.
5. Choose the question and edition label. **Retain reviewed document** receives
   that exact reviewed edition into this dossier.
6. Return to **Sources** to select evidence, classify its role and write notes.
   Use **Findings** to connect the relevant sources to the question and record
   the analysis.
7. Use the ordinary **Export** action for HTML, Markdown or a portable dossier.

The review can download the uploaded document, unchanged provider JSON and
complete research edition separately. The document is an attachment; provider
table HTML appears as literal source. Original text and metadata remain in the
retained response.

Array position remains part of each source occurrence, including repeated
Unstructured element IDs. Each occurrence retains its original ID, type, page,
coordinates when provided, document identity and complete provider record.
An empty element array remains a completed original provider outcome with zero
evidence rows that the operator can inspect and retain.

## Recover the same decision

Before receiving, the browser retains the exact dossier, purchase selection,
reviewed edition hash, question, label and expected revision. A lost response or
expired session preserves this decision as **Retry saved receiving decision**.
Reopen the original session and retry it.

Receiving reconciles a committed matching edition before applying a later
revision check. If the first response was lost after the original Store committed
the edition, retry returns that existing edition and preserves current history.
A genuine competing revision before commit requires a new reviewed decision.

The pending label, question, purchase and edition hash remain visible.
**Review a new receiving decision** releases that pending decision explicitly
after refreshing the original document list. New documents, profiles or research
questions are separate operator choices.

When a buyer has no completed saved response, open that same purchase in its
original commerce or buyer workspace to inspect progress and recovery. That
buyer remains the owner of purchase execution.

## Reopen a portable dossier

A retained edition includes the original multipart request, upload, exact
parameters, unchanged provider response and derived research rows. The original
Store preserves these bytes using its normal blob hashes and revision history.

Export the portable dossier through the normal workspace control. On another
installation, choose **Open dossier file**. The Documents pane reads retained
editions directly from that restored Store. Open an edition to inspect its
elements or download the original document and provider JSON.

The Store's `readRetainedEdition(id, editionId)` uses its ordinary head lookup
and verified blob reader. The adapter checks the retained wire, document,
parameters, response and every derived row through the installed original
multipart reader. Metadata reads keep document lists and receiving guards from
re-projecting unrelated research bodies.

To continue unfinished purchases, preserve the original customer workspace,
inbox, response files and operator configuration. To continue research on received
documents, preserve the portable dossier and its original history.

## Node API

The installed package exports the maintained API:

~~~js
import {
  readPartitionManifest, preparePartitionRequest,
  createPartitionEditionProvider, receivePartitionEdition,
} from '@tokenjunkielabs/starforge-merchant/buyer/unstructured';
~~~

The standalone Node package exposes the same API at
`@stellar-forge/native-buyer/unstructured` with TypeScript declarations. Both use
the original runtime selected by the caller.

### Prepare an original SF66 request

`preparePartitionRequest` invokes the original multipart writer and reviewer:

~~~js
const prepared = await preparePartitionRequest({
  runtimeDirectory,
  manifest: await readPartitionManifest(manifestFile),
  profile: selectedProfileId,
  file: originalDocument,
  filename: selectedFilename,
  mediaType: selectedMediaType,
  bodyFile: originalRequestBody,
  intentId: originalIntent,
  acceptIndex: selectedPaymentOption,
  maxAtomic: independentlyApprovedMaximum,
});
~~~

The merchant handover passes `prepared.purchase` into original commerce
preparation. Its body file and headers identify the complete original request;
the result also retains document, request and parameters hashes and original
selected payment terms.

Repeating this helper with the same body destination reopens its exact original
bytes. It checks the current selected file and profile against those bytes.
A changed document, media type, filename or parameter selection requires an
explicit new preparation.

`preparePartitionPurchase(buyer, options)` creates one ordinary Node Buyer
operation through the generated seller client. Reopen an existing intent using
`buyer.operation(intentId)` and the original recovery API. That operation owns
review, approval, execution and saved output.

### Receive a saved original purchase

~~~js
import {Buyer} from '@tokenjunkielabs/starforge-merchant/buyer/node';
import {openDossierStore} from '@tokenjunkielabs/starforge-merchant/buyer/research-dossiers';

const buyer = new Buyer({runtimeDirectory, stateDirectory});
const provider = createPartitionEditionProvider(buyer, {
  workspaceId: 'customer-document-operations',
  inboxDirectory: originalInboxDirectory,
});
const review = await provider.describe(originalIntent);
const dossiers = await openDossierStore(researchDirectory, {
  providers: {unstructured: provider},
});
const current = await dossiers.get(existingDossierId);
const received = await receivePartitionEdition(dossiers, existingDossierId, {
  provider,
  intentId: originalIntent,
  questionId: existingQuestionId,
  label: reviewedEditionLabel,
  expectedRevision: current.revision,
  expectedEditionSha256: review.editionSha256,
});
~~~

The default retained mode supports complete portable receiving. Applications
choosing the existing reference mode preserve the original buyer and provider
adapter so the reference continues to resolve its original bytes.

`readPartitionInboxPurchase` reads the original `InboxResponse`; direct Node
operations use `readPartitionPurchase`. Both check the original configuration,
request-body path and bytes, saved response metadata and complete response before
deriving the research edition. Native outcome strings are retained unchanged.

## Limits and processor contract

Each merchant profile fixes one original multipart file and the selected native
Partition parameters. The manifest retains its payment options and declared
authorization flow. The customer selects its payment option and independent
atomic-unit ceiling before preparation.

The native request ceiling is 16 MiB including framing. The default document
ceiling is 8 MiB; profiles can choose another value within the original request
limit and framing allowance. The complete provider response ceiling is 1 MiB.
Provider, handler and request deadlines remain separately declared, with outer
deadlines exceeding inner deadlines. Select sizes and profiles that fit these
limits.

The original configured seller application validates the request and complete
JSON element response before authorization settlement. Review counts and research
rows are projections of those unchanged provider bytes.

The manifest identifies the supported self-hosted Partition contract:
[API revision 44835210](https://github.com/Unstructured-IO/unstructured-api/tree/448352104eefd2e5b8fa2dc32282fc1cd3db31ae),
[core revision d2990950](https://github.com/Unstructured-IO/unstructured/tree/d29909504c7a19a13c19721f6907ac2fef0bb5ca),
and the [Partition request reference](https://docs.unstructured.io/api-reference/legacy-api/partition/post-requests).
Configure the processor deployment to the selected compatible source and retain
its deployment identity in the handover. That processor supplies format support,
extraction behavior, language/model resources and its original memory
requirements.

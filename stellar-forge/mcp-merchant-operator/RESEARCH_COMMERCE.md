# Paid Research through the Merchant agent

The existing Merchant Research attachment can publish a frozen customer delivery, operate its original Stellar checkout and Buyer request, retrieve the complete paid file, and reopen the editable Research dossier. The twenty commerce tools share the original Research workspace client, customer commerce engine and retained-file reader.

A paid delivery contains the actual saved work snapshot, all four report bodies, complete portable dossier history and, when selected, the original Europe PMC source workspace. The merchant's native configuration supplies its network, asset, amount and receiving terms. A Buyer operation retains its original approval, exact atomic budgets, recipient binding and execution journal.

## Connect the existing workspaces

Use the same installed edition for the Research host and Merchant tools. Start or reopen the original Research application with its selected customer-commerce host configuration, as described in [the native operating guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/customer-commerce/OPERATING.md). Its existing Applications launch remains the owner of its browser and HTTP listener.

The Research connection document uses this shape. Replace the paths with the original private connection and workspace paths returned by those applications.

~~~json
{
  "schema": "stellar-forge.research-workspaces.v1",
  "workspaces": {
    "research_sender": {
      "label": "Research delivery publisher",
      "consoleUrlFile": "/srv/research/sender/console-url.json",
      "directory": "/srv/research/sender/workspace",
      "sources": {}
    },
    "research_receiver": {
      "label": "Research customer workspace",
      "consoleUrlFile": "/srv/research/receiver/console-url.json",
      "directory": "/srv/research/receiver/workspace",
      "sources": {}
    }
  }
}
~~~

The file is private and declares existing Research workspaces. Its alias is the MCP routing selection. The workspace's actual identity is checked by the original Research client when attaching.

Initialize the existing merchant owner once for a new merchant directory:

~~~bash
starforge merchant-mcp init-research-workspaces \
  --dir /srv/research/merchant \
  --connection /srv/research/research-workspaces.json \
  --name "Research delivery operations"
~~~

The original initializer creates its retained release store, customer exports directory and merchant-mcp.json. Reopen that same configuration for subsequent sessions:

~~~bash
starforge merchant-mcp serve \
  --config /srv/research/merchant/merchant-mcp.json \
  --token-env RESEARCH_MERCHANT_TOKEN
~~~

Use the original existing environment value for that name, or the original OAuth resource configuration supported by the merchant host. The command returns its actual listener. An Applications-managed Merchant session can use the same configuration and its original start/stop lifecycle.

Call merchant_research_workspaces, then merchant_research_attach for each declared alias needed in the journey. Keep the returned attachment IDs for detach. Call merchant_research_commerce_configuration on the selected Research workspace to read its actual merchant and Buyer aliases. The merchant attachment alias, configured checkout alias, configured Buyer alias, native publication ID and native purchase ID are separate selections.

## Keep the original operation and native request

Every commerce write accepts operationId: one caller-created UUID for the complete merchant invocation. It is retained under the original merchant's customer exports, scoped to the attached Research workspace. It binds the exact tool selection and captures the complete native input before dispatch.

A native requestId is the original application's idempotency key. Keep both IDs and every selected field when retrying. Publication enrollment uses the existing publication id and reviewSha256; its operationId still retains that complete enrollment invocation.

The normal completed tool result contains:

| Field | Meaning |
| --- | --- |
| operationId | This retained Merchant invocation |
| operationSha256 | Digest of its exact workspace, action and selected input |
| requestSha256 | The original complete native request digest |
| resultSha256 | Digest of the first complete native reply |
| result | The actual native publication, Buyer action or receiving result |
| reused | Whether the original complete result was reopened |
| sourceOperationId | Earlier retained invocation selected by an explicit replay |

Use merchant_research_commerce_resume with only workspace and operationId after a lost response. It returns the first completed result, or dispatches the same retained native request. It can complete the original mutation when the first process stopped before a native result was saved.

Use merchant_research_commerce_replay with a different operationId and the existing sourceOperationId when the operator intends to submit the actual original request again. It keeps the underlying native request ID and both retained replies. Repeating the new replay operation resumes its own request/result.

An operation ID already bound to another action or different input produces RESEARCH_COMMERCE_MERCHANT_OPERATION_CHANGED. Choose a new invocation ID for a changed selection and retain the earlier history. A cancel action needs a distinct operationId from the execution being awaited.

## Publish an actual customer delivery

Read the original customer project and its frozen deliveries with the existing Research customer-update tools. Select one original dossierId, deliveryId and exact revision. The selected native delivery already names its saved work and four report bodies.

Prepare a publication through merchant_research_commerce_publication_prepare. The following JSON shows the complete field set; all IDs and the selected checkout alias come from the current programme or are generated once by its caller before dispatch.

~~~json
{
  "workspace": "research_sender",
  "operationId": "<new retained merchant invocation UUID>",
  "requestId": "<new native publication request UUID>",
  "merchant": "<existing checkout alias>",
  "dossierId": "<original d_ dossier ID>",
  "deliveryId": "<original frozen customer delivery ID>",
  "revision": 1,
  "title": "<actual customer delivery title>",
  "summary": "<actual scope and delivered research>",
  "usage": "<agreed use and source conditions>"
}
~~~

Use the original delivery revision rather than the illustrative number in the field example. Optional sourceWorkspace selects an actual retained Europe PMC workspace with library, actor and requestId. It remains the original source engine's selection.

The native prepare operation compiles the complete handover, writes its framed compressed archive, binds the selected checkout configuration and returns the original review. Read the result's complete file selection, merchant terms and reviewSha256. Reopen it with merchant_research_commerce_publication whenever needed.

Enroll through merchant_research_commerce_publication_enroll using a new operationId, the original publication id and the exact reviewSha256. The native SF101 checkout publishes or reopens the original order. Its handoff binds the complete archive's bytes/hash and original recipient digest.

## Transfer the publication into the customer workspace

Read the sender's publication descriptor:

~~~json
{
  "workspace": "research_sender",
  "kind": "publications",
  "id": "<original enrolled publication ID>",
  "part": "publication"
}
~~~

This is the argument to merchant_research_commerce_file. Use the returned descriptor.sha256 in the existing full-file export:

~~~json
{
  "workspace": "research_sender",
  "kind": "commerce-publication",
  "commerceKind": "publications",
  "commerceId": "<original enrolled publication ID>",
  "expectedSha256": "<exact publication descriptor SHA256>"
}
~~~

Call merchant_research_export with that selection. It downloads the complete original publication and returns a retained exportId equal to its SHA256.

Receive it on the original customer Research attachment:

~~~json
{
  "workspace": "research_receiver",
  "operationId": "<new retained merchant invocation UUID>",
  "requestId": "<new native purchase-intake UUID>",
  "buyer": "<existing customer Buyer alias>",
  "fromWorkspace": "research_sender",
  "exportId": "<retained commerce-publication export ID>",
  "publicationSha256": "<same exact publication SHA256>"
}
~~~

Call merchant_research_commerce_purchase_receive. Both Research aliases must already be attached. The source is opened through that source attachment's own retained export manifest. The complete original publication bytes are captured in the receiver's invocation before the original Buyer intake.

A host file can supply the same complete publication when the source belongs to a different installed merchant. Add a source to the existing receiver connection:

~~~json
{
  "file": "/srv/research/incoming/customer.publication.json",
  "kind": "commerce-publication",
  "sha256": "<exact complete original file SHA256>"
}
~~~

The outer key under sources is its alias. Call purchase_receive using source and publicationSha256, omitting fromWorkspace and exportId. Select exactly one host source or retained export. Later resume uses the already-captured complete input even if the earlier donor file moved.

The native result is the original purchase-intake record. Its id is used by the rest of the customer journey.

## Review, execute and retrieve the original purchase

Read merchant_research_commerce_purchase with that original purchase id. The native Buyer view supplies the current paid-file revision, original handoff and configured customer agent.

Prepare with merchant_research_commerce_purchase_prepare:

~~~json
{
  "workspace": "research_receiver",
  "operationId": "<new retained merchant invocation UUID>",
  "id": "<original purchase-intake ID>",
  "requestId": "<new native preparation UUID>",
  "expectedRevision": 0,
  "totalAtomic": "<reviewed positive atomic budget string>",
  "dailyAtomic": "<reviewed positive daily atomic budget string>",
  "claimEnv": "<existing private claim environment name>"
}
~~~

Use the actual paid-file revision. The original Buyer permits revisions from zero through 10,000. Atomic amounts are exact strings, and the native engine checks their integer range and original payment policy. The prepared result retains the full original draft/approval details and preparedSha256.

Continue the actual Buyer approval using its existing operator flow. Then call merchant_research_commerce_purchase_execute with the original purchase id, preparedSha256, a new operationId and a native requestId generated once for this action. The original Buyer executes its approved request. The tool can remain pending while that execution runs.

To observe a pending execution, read purchase with refresh:true. To cancel it, call merchant_research_commerce_purchase_cancel with its actual executionId and a separate operationId/requestId. Cancellation reaches that original native execution while the execute call is awaiting completion.

Call merchant_research_commerce_purchase_retrieve with the same purchase id/preparedSha256 and its own retained request IDs. The original Buyer retrieves and retains the actual paid file. The Research receiver checks the complete compressed hash, exact delivery selection and every framed member before offering dossier receiving.

The recover and finalize tools call those same original Buyer actions. purchase_reconcile looks up an actual nativeRequestId in the original journal and can take its returned nativeId. The native journal determines the valid transition.

## Receive the editable customer workspace

Call merchant_research_commerce_purchase_receive_dossier with workspace, operationId, id, requestId and preparedSha256. Optional sourceActor identifies the original source receiving actor.

The original Research receiver restores the complete dossier, retained history and referenced blobs. Its native customer delivery includes the saved work snapshot and all four original report bodies. When the publication includes an original Europe PMC workspace, the same native source receiving engine adopts it before the customer continuation.

The completed result carries the actual received workspace identity and native receiving record. Reopen the dossier through the existing Research tools, edit the commissioned customer work, or record an actual correction through the original customer-update engine. Repeating the same receiving request reopens its retained result after those later changes.

Export commerce-received for the complete receiving file, and commerce-archive for the complete original paid handover. A receiver can preserve those full files alongside its editable workspace and commercial record.

## Complete files and restart recovery

The existing merchant_research_export, merchant_research_file_read and merchant_research_file_release tools carry every original byte. Commerce adds these export kinds:

| kind | Required selection |
| --- | --- |
| commerce-publication | commerceKind, commerceId, expectedSha256 |
| commerce-handoff | commerceKind, commerceId, expectedSha256 |
| commerce-archive | commerceKind, commerceId, expectedSha256 |
| commerce-received | commerceKind, commerceId, expectedSha256 |
| commerce-operation-json | commerceOperationId; optional expectedSha256 |

For the first four, read the native descriptor first and use its exact SHA256. commerceKind is publications or purchases; commerceId is that original native record ID.

commerce-operation-json contains the complete Merchant selection and original native request/result files. It retains the original publication input as well as the native reply. Use it to move the complete invocation record into the programme's working archive.

A full-file export returns its content-addressed exportId. Read with workspace, kind and exportId. Continue using the returned readId and nextOffset until the original reader reports completion; retain the advertised complete size and SHA256. The maximum chunk size comes from the existing file-reader schema. Release the readId after receiving all bytes.

If a reader expires or the Merchant restarts, reattach the same Research workspace and reopen the read with the same kind/exportId and the next offset, omitting the stale readId. The complete retained export is independent of that temporary reader. Existing export inventory pages recover the original file selection after a lost export reply.

The native and Python paid-delivery clients can also receive the complete archived file on a customer host. Their existing local receiving validates the full original compressed bytes and reconstructs the native handover directory before the original dossier import. See [the Python guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/RESEARCH-COMMERCE.md) for the complete two-workspace programme and offline archive receiving.

## Tool map

| Tool suffix after merchant_research_commerce_ | Operation |
| --- | --- |
| configuration | Existing checkout and Buyer aliases |
| library | Paged original publications or purchases |
| publication | Original selected delivery, review and enrolled order |
| purchase | Original Buyer and customer receiving state |
| file | Exact original file descriptor |
| operations | Paged retained Merchant invocations |
| operation | Original retained invocation and complete native reply |
| resume | First completed result or exact unfinished native request |
| replay | Distinct retained attempt of the original native request |
| publication_prepare | Complete frozen delivery and native order review |
| publication_enroll | Exact reviewed native enrollment |
| purchase_receive | Full declared or retained publication intake |
| purchase_prepare | Original paid-file review, budgets and approval |
| purchase_execute | Existing approved native execution |
| purchase_retrieve | Complete original paid file |
| purchase_recover | Existing native Buyer recovery action |
| purchase_finalize | Existing native Buyer finalization |
| purchase_cancel | Actual original execution cancellation |
| purchase_reconcile | Actual original native request reconciliation |
| purchase_receive_dossier | Complete editable Research and source receiving |

## Ownership and retained source layout

Each Research alias keeps its original private exports directory. The commerce subdirectory contains operations, original full-file exports and complete operation snapshots. An operation stores its exact agent.json selection, captured native-input.json and the original commerce operator's native directory. No caller supplies an arbitrary writable filesystem path through these tools.

The attached Research client owns the actual authenticated transport. Merchant detach first drains all accepted calls, then closes retained commerce cleanup owners and file reads, and finally releases that client. Failed original closers remain available for the same detach/Stop retry. The original Applications Research listener remains with its application owner.

Source integration consists of the commerce module and catalogue, additive joins in the two existing Research Merchant modules, and the original research-customer-commerce distribution contribution. The installed declaration uses the maintained SCF contribution registry and includes the original SF101 and buyer-runbook source components. The Node/browser/Python clients and Merchant tools all invoke the same paid Research engine and receiving history.

# Reviewer Customer Delivery

The Merchant Console can inspect an original grant purchase, retain every complete result and source file, and deliver its receiving packet to another configured operator. The workflow uses the existing reviewer workbench, Buyer, Merchant provider, Customer file receiver and saved Workflow engine.

A packet retains the original quote IDs, attempt counts, observed outcomes, result bodies and source documents. Opening the reviewer reads that saved purchase. It does not prepare another purchase or connect a signer.

## Open the original configured host

Initialize the original reviewer merchant connection with the maintained command:

~~~sh
starforge merchant-grant-reviewer init \
  --directory /private/reviewer-merchant \
  --connection /private/reviewer-connections.json
~~~

The connection file declares each original workbench directory, its workbench ID, any host-held packet aliases, and whether this merchant may start the original workbench. Keep the generated merchant configuration and receiving directories. A workbench already owned by Applications is borrowed; closing the merchant leaves that original controller with its owner.

Open the same Merchant Console through the maintained merchant host:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /private/reviewer-merchant/merchant-mcp.json \
  --port 3211 \
  --token-env MCP_ACCESS_TOKEN \
  --operator-console-dir /private/reviewer-merchant/operator-console
~~~

The installed merchant server also accepts these same serve options. Its exact command is shown by the selected package's command registry. The reviewer initialization command does not start a separate Console server.

Set the access token through the host's private environment. Enter it in the existing Console connection form. The browser clears that field and holds the connection code in memory. The configured host decides which tools and workbench aliases that principal may use. The new panel appears only when this host advertises the grant reviewer family.

A source with allowStart false must be opened by its original Applications owner first. The explicit workbench-open action checks that original owner. It never deletes or takes over its lease.

## Inspect and receive an original packet

Choose a named Console profile, then open **Customers → Reviewer customer delivery**. The five sections form one operating workflow:

1. **Select the original workbench.** Load the host's configured aliases, select the source, and open its current state. The displayed workbench identity and live Buyer state come from the original owner.
2. **Review packet intake.** Choose the bundled original purchase, a host-declared file alias, or a complete local receiving packet. Local input is bounded by the original 8 MiB packet capacity and hashed before it is sent. The selected workbench stores the exact bytes and returns its native review ID and revision.
3. **Use the original saved Buyer.** Inspect the selected revision, receive it through the original native method, and open its Buyer. View the saved history and select the original quote. The complete result button retains the actual result bytes; source document controls retain the exact file selected from the original packet.
4. **Export and deliver.** Close the original Buyer before exporting a new closed view. An already accepted export can instead be reopened with its original request UUID. Receive its manifest and files into the existing Customer record. The packet download is the unchanged grant-reviewer-packet.json, not a newly constructed archive.
5. **Prepare a saved operating recipe.** Send the complete selected procedure and inputs to Workflow Recipes. Review its exact native contracts, install a named workflow, and run it using the original Workflow controls and pauses.

The selected review's UUID and revision are visible. Original source paths, quote IDs, statuses and attempt counts remain associated with their files. A failed or indeterminate original observation remains visible alongside a later successful observation.

### Complete files and small display views

The Console keeps each original native call in Requests before dispatch. The reviewer panel opens that saved call and its retained return. Large structured returns are reopened through the maintained full-file reader; the interface does not substitute a short tool preview for the original result.

Customer receiving pins all of these values:

- Current Console profile and configured host fingerprint.
- Original workbench alias and workbench ID.
- Export ID and complete manifest SHA-256.
- Every filename, declared byte length and SHA-256.

Receiving resumes the original record after interruption. Completed files are verified before they are exposed. A saved-result or source-document export downloads that one original file. A reviewer-packet export downloads the complete original packet; its operation.json and grant-reviewer-manifest.json remain individually available in the same Customer record.

The export file and manifest are separate identities. Keep both when handing an existing export to another configured host.

## Original lifecycle and response recovery

A durable action receipt describes what the action accepted. It is not proof that its process remains live. Reopening an old buyer_open action after a controller restart can therefore return its recorded successful open and a current Buyer state of inactive. Inspect the current state before creating a fresh lifecycle intent to open that same received selection.

The Console records a native request UUID and its original arguments before dispatching each mutation. After a lost response:

1. Open the saved request from Requests or the reviewer action list.
2. Read its original native action UUID.
3. If a continuation is required, use **Continue exact original request**. The linked Console recovery call retains the same native UUID, selected revision and arguments.
4. Inspect the returned current state before proceeding.

Do not replace an uncertain receive, export or open UUID with an unrelated new UUID merely to get another response. A new lifecycle action is appropriate when the current original state proves that a previously closed process now needs opening again.

An accepted export is immutable. Replaying its UUID returns those same bytes even if later history has changed. Such a replay does not close a Buyer that was opened afterward. The saved delivery recipe therefore performs a distinct explicit buyer_close before reconciling its selected export. The close result is checked against current active state.

Changing profile or configured workbench immediately clears the selected reviewer state. Outstanding reads retain the profile epoch and selection context across every awaited digest and response. A reply belonging to a previous profile cannot be installed as the current selection.

## Saved delivery and receiving recipes

The complete delivery recipe has fourteen original native steps:

| Stage | Original actions | Review or continuation |
| --- | --- | --- |
| Source owner | workbench_open, selection | Pause at the exact selected packet and revision |
| Original purchase | buyer_open, buyer_read, buyer_result | Pause with the complete saved result retained |
| Closed export | buyer_close, export, manifest | Pause with the accepted packet and complete manifest |
| Receiving owner | workbench_open, review_export | Pause at the receiving review |
| Original stores | receive, buyer_open, buyer_read | Pause at the received saved history |
| Closure | buyer_close | Drain the receiving Buyer and retain its workspace |

The six-step receiving-only recipe starts at the receiving-owner stage. It accepts an already reviewed export ID and manifest SHA-256.

Preparing a recipe is not dispatch. The existing Workflow Recipes review resolves each workspace and native contract against the selected host, records the review digest, and installs the original immutable workflow edition.

Delivery inputs are:

~~~json
{
  "sourceWorkspace": "original",
  "destinationWorkspace": "receiver",
  "selectionId": "ORIGINAL_RECEIVED_SELECTION_UUID",
  "selectionRevision": 2,
  "quoteId": "ORIGINAL_QUOTE_ID",
  "title": "Original receiving",
  "actions": {
    "sourceOpen": "LIFECYCLE_UUID",
    "sourceClose": "LIFECYCLE_UUID",
    "sourceExport": "ORIGINAL_EXPORT_UUID",
    "review": "RECEIVING_REVIEW_UUID",
    "receive": "RECEIVING_ACTION_UUID",
    "receivingOpen": "LIFECYCLE_UUID",
    "receivingClose": "LIFECYCLE_UUID"
  }
}
~~~

The strings in this example mark fields to fill with actual selected identities. The UI prepares real UUIDs and current selection values. If continuing an already accepted export or receiving review, retain its exact original UUID, title and source bytes.

Receiving-only inputs replace selectionId, selectionRevision and quoteId with exportId and expectedManifestSha256. Its source workspace is the alias that actually retains that export, even if a different workbench is currently being inspected. The destination must be a distinct configured workbench.

A workflow pause remains a saved original run. Reopen its run ID after a host restart and use **Continue**. If its original Buyer closed during that restart, inspect the relevant received selection in the reviewer panel and open its current Buyer before continuing a saved-history step. Completed steps and their native UUIDs stay in the original run; the new live process is recorded as its own lifecycle action.

The Console profile archive includes the original workflow edition, recipe, selected inputs, run, call records and Customer manifests. Another Console imports those records as received custody. It does not automatically execute a copied workflow. Complete customer file bytes are then received through the original pinned export, or the complete original packet can be carried independently to a receiving workbench.

## Host configuration review stays intact

This extension composes with the original Host review and immutable binding history. Source snapshots, configured-tool contracts, prior host bindings and already running calls are preserved. Importing a Console profile does not silently rewrite that host configuration.

The original host's authorization is checked for each saved call and each complete file read, including archive and profile receiving. No workbench access code is included in a tool return, recipe, profile archive, shared packet or source guide.

## Complete native Console receiving

The restartable carrier continues the existing completed reviewer operation and its completed Merchant provider/client extension:

~~~sh
node stellar-forge/mcp-merchant-operator/console/REVIEWER_RECEIVING.mjs \
  --operation /absolute/original-reviewer-operation \
  --playwright /absolute/existing/playwright/index.js \
  --chromium /absolute/existing/chrome-headless-shell
~~~

It requires the actual original WORKBENCH-RESULT.json and merchant-client/MERCHANT-RESULT.json, with complete state and closed owned processes. It verifies and retains those exact input bodies. It never seeds a replacement reviewer purchase or launches another installer.

The carrier uses the original operation's controller.lock and writes only its customer-console continuation. Its complete path covers both original result bodies and statuses, a full original source document, explicit closure and accepted-export replay, five desktop and five mobile Console pages, a browser full-file download, actual UI recipe review and installation, the whole saved workflow with a real close/reopen at its export pause, a complete Console profile download, independent profile/Customer file receiving, and cold reopen of both operators.

The carrier's journal owns the original Console request IDs, native action UUIDs, workflow installation, run, file manifests and export. A browser-retained pending workflow start is recovered by its original intent. An unresolved native return is surfaced through the original linked recovery path; it is not counted as completion.

The final CONSOLE-RESULT.json is written only after all original browser, merchant and workbench owners have closed successfully. It carries complete file identities and the loaded source hashes. Execution availability or a published carrier alone is not reported as that result.

## Source and integration

The family adapter is customer-reviewer.mjs; the procedure builder is reviewer-recipes.mjs; the UI is public/customer-reviewer.mjs. Their shared joins are in the original Customers, service, store and browser workflow modules. They use the original reviewer merchant provider/client under stellar/scf_2026/presentation/reviewer/merchant.

The completed original reviewer run and its accepted payment/source identities remain the baseline. This contribution adds operating capability around that retained purchase; the existing grant application, grant totals and network transaction baseline remain associated with their original records.

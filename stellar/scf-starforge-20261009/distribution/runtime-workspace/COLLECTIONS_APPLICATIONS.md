# Request collections in Applications

Request collections retains a set of original SF88 buyer requests, presents their exact grouped maximum amounts, runs the selected original intents, and brings their outcomes and delivery files back into one private workspace. Applications supplies the existing managed process, saved runtime selection, source review, start/stop controls and reopening.

This guide covers the installed application. The product's [workspace guide](../../sf88-operator-buyer-cli/collections/WORKSPACE.md) covers request intake, the shared approval panel, run recovery and exports. The [collection controller guide](../../sf88-operator-buyer-cli/collections/README.md) contains the original command-line workflow.

## Choose the original workspace

Open **Applications → New application → Request collections** and select the READY runtime containing the installed collection command.

| Setting | What to select |
| --- | --- |
| Private collection workspace | The original private collection store, or one new folder within an existing private parent. |
| Original buyer inbox | An existing initialized private SF88 inbox. This is required for a new store; an existing store remembers its exact inbox. |
| Local port | Use 0 for an available loopback port, or select the required port explicitly. |
| Private environment JSON | Optional existing private environment values used by the original operator and approval bridge. |

Create an inbox through the original installed command when needed:

~~~sh
starforge buyer-inbox init --root /ABS/PRIVATE/INBOX
~~~

Use absolute paths belonging to the same operator. The initialized inbox contains its original inbox.json and jobs directory. An existing collection store retains its inbox path in collections.json. A different inbox requires a separate collection store.

Applications reads those original bindings during review and again at save/start. It retains their input identity alongside the selected runtime, command and managed release. The collection store and its parent are private directories. Saving a new application creates only the reviewed collection folder; its native first launch initializes the original collection metadata inside it.

## Review, save and start

1. **Review application** displays the selected runtime, source, private workspace, inbox and exact native arguments.
2. **Save application** records the reviewed settings and uses the existing managed release or its original adoption operation.
3. **Review start** reads the current input bindings and the original installed release.
4. **Start reviewed application** runs the original collection workspace command through the existing managed worker.
5. **Open application** opens the private URL actually announced by that process.

The current complete browser edition launches this original command:

~~~sh
starforge buyer-collections-workspace \
  --directory /ABS/PRIVATE/COLLECTIONS \
  --queue-root /ABS/PRIVATE/INBOX \
  --approval-mode browser \
  --startup-format json \
  --port 0
~~~

The managed process retains the structured startup announcement. Its collection directory, inbox, approval mode and chosen port must match the saved launch. The listener binds to 127.0.0.1 and returns its actual private token URL after startup.

## Work through a collection

Open the collection workspace and prepare a group from existing original operator configuration files. Review its requests and the exact grouped maximum amounts before saving. Amounts stay in their original atomic units and are grouped separately by network, asset, recipient, payment scheme and payment flow.

Saving retains the reviewed source and request material. Queueing uses the original inbox intents. A matching original intent can be shared by more than one collection, and reopening keeps that original record. Select the queued requests and use the workspace's run control to continue them sequentially.

In the current browser edition, the original SF81 approval panel displays each approval request. Its decision is tied to the current owned run and exact original request. The original buyer, signer, policy and ledger remain the execution path. Operator workspace mappings are retained with the run selection.

After an interrupted response, reopen the same retained run. The original request ID and run history recover the acknowledged operation. Once its outcome is received, a later explicit run of still-queued requests creates a new run selection. **Pause** stops the owned run through its original interruption path; the remaining queue stays available for a later reviewed selection.

The collection view returns original recorded attempts, cancellation and recovery outcomes. An ended collection is evaluated from those individual outcomes. Received files and original delivery references remain accessible from the same collection.

## Export and hand over results

Use **Download response** in a completed request row to receive the original saved buyer file. Its retained byte count and SHA-256 remain visible. The server checks the original delivery and streams the saved file; the browser checks the received bytes before offering the download.

Use the original collection export action to retain and download:

| File | Contents |
| --- | --- |
| collection.json | Retained collection definition and selected source identities. |
| results.json | Original item states, recorded outcomes and run history. |
| requests.csv | Request rows for operational review. |
| review.html | Portable human-readable collection review. |
| manifest.json | Exact file names, byte counts and SHA-256 hashes. |

Downloads are served through the original authenticated workspace after checking their retained size and hash. The collection's paid operations and source material are reviewed separately from its delivery export.

## Stop and reopen

The Applications process and collection browser have their own lifecycle. Closing a browser tab leaves the managed operation and its original collection state available.

Use Applications' existing stop operation to stop the owned workspace. The collection server cancels its active file transfers, pauses/drains its owned child, completes active handlers, closes its shared approval broker and closes the original controller. Its retained store, queue, run selection and outcome records supply the next opening.

Reopening an active application uses its existing operation and private URL. After a completed stop, use **Review start → Start reviewed application** for the next original server operation. That operation announces its current private URL. Opening it returns the same collection data and original inbox.

## Existing runtime editions

The selected runtime determines the available approval interface.

| Original selected source | Launch behavior |
| --- | --- |
| Complete collection browser, structured launch and SF81 browser approval bridge | The native browser run and original approval panel, with a structured startup announcement. |
| Original collection workspace before the browser-run addition | Its original workspace command and printed private URL; selected paid runs use its existing terminal command. |

Applications checks the files in the selected installation. It adds browser and structured-startup flags only when the complete original source is present. Earlier runtimes retain the original supported arguments. A partially composed browser edition asks the operator to select the complete source edition.

An earlier collection workspace can be opened for its existing review, queue, recovery and export work. The current browser edition adds direct selected execution to that same workflow.

## Application composition

The additive helper is application-collections.mjs in this directory. The existing shared Applications writer joins these hooks:

- collectionsApplication(common) supplies the Request collections catalog entry.
- prepareCollectionsApplication(settings, {inputPath, runtimeDirectory}) returns args, inputs and createDirectories for the existing applicationCommand preparation.
- collectionsStartup(request, text) returns the original URL and bound launch selection to the existing output observer.

The catalog entry uses id buyer-collections, command buyer-collections-workspace, terminal false, and the original stateDirectory resource key. The current browser path supplies approval through the native broker. Older editions use their original external terminal command.

The common preparation branch appends the returned args and inputs and carries createDirectories into the existing review/save path. Common port and private-environment handling remain in applicationCommand. The helper uses the same selected source root returned by inspectMerchantRuntime with load:false and source:false after the caller's complete runtime review.

The existing output observer invokes collectionsStartup only for buyer-collections-workspace. A returned URL is passed through its normal privateUrl check and saved as application-url.json with applicationId, operationId, command, source original-command-stdout, observedAt, url and original. A structured request accepts only the matching original structured announcement. The first accepted announcement binds that operation's link.

The native collection server imports collectionsWorkspaceLaunch from its sibling launch.mjs. With --startup-format json it emits that record from the ready listener and actual controller directory/inbox. With the default text format it keeps its existing human-readable startup output. Its optional --approval-mode retains the original browser/terminal selection.

The same maintained distribution component already includes the runtime-workspace helper and collection source. The original installed command and browser-assets registration carry the product into the next ordinary source edition.

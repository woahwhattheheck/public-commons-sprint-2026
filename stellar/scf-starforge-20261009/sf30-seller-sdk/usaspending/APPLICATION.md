# Federal awards and workshares in Applications

Open **Federal awards and workshares** from the installed Merchant Workspace Applications page. This is the original USAspending browser and saved award workspace, including transaction history, prime workshare assessments, complete source exports and customer receiving.

## Save a research application

Select the installed runtime containing the USAspending contribution and choose **Federal awards and workshares**.

Choose a private research workspace. An existing workspace reopens its original awards.sqlite3 database, award editions, exact source pages, modifications, saved reviews and receiving records. For a new workspace, choose a new folder beneath a private parent; saving the application creates the selected folder, and its first launch initializes the original award workspace.

Optionally select a private **Customer delivery folder**. The browser can receive original customer delivery directories from that folder through its existing receiving operation. A new selected folder is created when the application is saved. Use the **Operator name** for attribution on workspace operations and saved assessments. A local port of 0 selects an available loopback port.

Review and save the application, then review and start its original operation. **Open** uses the private browser link announced by that running workspace. Keep the link on the host where the application runs; it contains the browser session token.

The saved application retains its chosen workspace, operator, receiving folder and runtime. The original Applications lifecycle retains the run, process state, output and stop operation.

## Work through an award

The award browser keeps the complete research workflow:

1. Save the actual federal-award search and capture all original provider pages.
2. Open an award edition, retain the original award detail, and prepare a prime workshare against that source.
3. Open transaction history for the selected award. Capture or receive its actual transaction pages, inspect modification numbers, agency action descriptions, exact funding changes and fiscal-year totals, and compare retained captures.
4. Save the complete workshare assessment with its fit, proposed delivery, deliverables, acceptance and next action.
5. Export the original transaction capture, CSV or combined workshare brief. Choose private-review inclusion explicitly when preparing an assessment handover.
6. Receive the original award edition before its transactions. The transaction receiver keeps the selected source, saved review lineage and replay identity.
7. Use the existing whole-workspace backup and restore to carry the saved research and original transaction source into another workspace.

The transaction workflow and original provider contract are described in [TRANSACTIONS.md](TRANSACTIONS.md). The award source and dossier workflow remain documented in [README.md](README.md) and [DOSSIER.md](DOSSIER.md).

## Stop and reopen saved work

Use **Stop** on the original Applications run. The original USAspending server pauses active provider operations, waits for their retained state and closes the same workspace database. The application remains saved.

Start that application again to reopen the same research directory. It receives a new private session link and preserves the existing award editions, captured transaction pages, saved assessments, original operation history and customer receiving. Resume an interrupted source capture by its existing capture identity; the workspace retains its original request, accepted pages and continuation.

The launcher checks the selected workspace identity, original application source and running session before retaining the browser link. If a selected directory or installed source has changed, review the current selection in Applications. The small authenticated session endpoint identifies the original running process without transferring the complete research inventory.

## Original command

The installed command is:

~~~sh
usaspending-application serve \
  --workspace /PRIVATE_PARENT/award-research \
  --operator "Research desk" \
  --receiving-root /PRIVATE_PARENT/customer-deliveries \
  --port 0
~~~

From a complete source checkout, invoke the same command with Node 22.13 or newer:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/application.mjs serve \
  --workspace /PRIVATE_PARENT/award-research \
  --port 0
~~~

The command prints one structured startup line containing the private browser URL and the original workspace session identity. SIGINT or SIGTERM invokes the original server close operation. The existing usaspending-research and usaspending-dossier commands operate the same saved product.

## Source-owned installation

The usaspending distribution contribution declares the application, original research and dossier commands, and ./research/usaspending/application export. Its provider consumes the maintained Applications preparation, retained operation, startup observer and stop/reopen lifecycle.

The application source selection includes the existing award, transaction and browser modules plus its source-specific startup adapter. The installed runtime and managed release remain the original source owners. The launcher verifies the selected source in both locations and authenticates the original /api/identity before the shared observer saves the launch link.

## Continue the original native receiving operation

The maintained receiver consumes the completed transaction receiving directory.
It reopens the original SQLite workspace and source capture, retains the browser
announcement through the original Applications provider, stops the original
process, and reopens its saved transactions and assessment. It also opens a new
workspace, restores the original complete workspace, and reopens that restored
research.

From the complete original source materialized under DELIVERY/source:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/application-native.mjs \
  --received /PRIVATE_DELIVERY/native \
  --out /PRIVATE_DELIVERY/applications-source
```

For the full installed Applications lifecycle, supply the actual READY runtime
containing this contribution:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/application-native.mjs \
  --received /PRIVATE_DELIVERY/native \
  --runtime /PRIVATE_RUNTIME/federal-awards \
  --out /PRIVATE_DELIVERY/applications-managed
```

The managed run calls the existing workspace model to attach the retained runtime,
review and save both an existing and a new application, adopt its original release,
launch its original worker, retain its private browser URL, stop the operation,
and reopen the application after closing the operator workspace. The new-folder
case passes through the existing save-time directory creation and fresh start
preparation. It then restores the original transaction workspace into the new
folder and reopens that saved application.

The result identifies its actual mode as original-source-application or
original-managed-applications. Each creates application-receiving-result.json,
original operation records, session identities, complete workspace exports,
transaction CSVs, workshare documents, and the saved original assessment.
Use the same original operation ID, SCF-USASPENDING-AWARD-TRANSACTIONS-64B7-20261012,
and the existing receiving output. Both runs use the retained award and source
bytes already delivered with that operation.

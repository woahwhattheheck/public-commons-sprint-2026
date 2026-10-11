# Publish and deliver a Socrata dataset

The Publisher section takes a completed Socrata edition through original dataset publication, SF82 release operations, and an SF88 customer acquisition. Its source package retains the exact exported CSV, dataset configuration, source provenance and original merchant terms. It adds the original optional snapshot parameter to the generated versioned seller.

The original dataset service owns its version directory and private refresh socket. Its request wrapper pins a snapshot through admission, payment and response delivery. SF82 owns seller startup, process lifetime, release selection and shutdown. SF88 owns customer approvals, spending, individual page attempts and recovery; SF100 produces the completed data room.

## Open the maintained operator

Use the installed Socrata operator and open **Publisher**. The server keeps the publisher in the selected operator directory's **publisher/** area. Reopening the same operator reopens the original draft, release and acquisition stores. The selected original export directory is an immutable input and can be consumed while the capture workspace continues other work.

From an installed source tree, the publisher also exposes its original operations as a CLI:

    node sf30-seller-sdk/socrata/publisher.mjs --dir /absolute/publisher status
    node sf30-seller-sdk/socrata/publisher.mjs --dir /absolute/publisher publisher.prepare --input prepare.json

The maintained command alias is **starforge socrata-publisher**. JSON input files are read as files; quotation, secrets and shell interpolation are unnecessary. The original operator server keeps one publisher object open for its browser controls. A foreground publisher release-start process owns that same publisher directory until it drains and closes.

## 1. Prepare the selected edition

In the source workspace, finish capture, save the mapping, build the edition, configure its merchant and export it. Select that export in Publisher. The generated export contains adjacent dataset.csv, dataset.json, seller.json and source.json.

For the CLI, prepare.json contains:

    {"exportDirectory":"/absolute/operator/exports/EXPORTED_ID"}

Preparation verifies the original native CSV loader's snapshot and query capabilities, retains the exact source files, and initializes the original private version store when this is its first edition. The resulting draft displays its row count, native snapshot, source hash and original seller hash. Reopening the same export selects the same retained package and candidate.

The package retains both the initial seller configuration and its versioned generated configuration. The versioned configuration advertises **snapshot** so a customer's first page can explicitly select a retained edition. Network, asset, recipient, amount and timeout remain the supplied merchant's original values.

Later imports become retained candidates. They use the same original query contract: column types, exposed capabilities, paging and ordering. Create a separate publisher when intentionally changing that public contract.

## 2. Stage and run the original release

Choose a retained draft, enter a release ID and select the runtime port and facilitator. The original SF82 staging operation verifies and retains the source package. It reports the release digest, public origin, exact payment options, baseline snapshot, query contract hash and native dataset binding.

Example stage input:

    {
      "draftId":"ORIGINAL_DRAFT_UUID",
      "id":"hpd-queens-20261011",
      "label":"Queens HPD dataset",
      "runtime":{
        "port":8423,
        "facilitator":"https://YOUR_CONFIGURED_FACILITATOR"
      }
    }

Use the actual configured facilitator. A loopback facilitator uses an explicit http://127.0.0.1:PORT URL with allowLocalFacilitator:true. Omitting the facilitator starts the original challenge-only seller.

Activate the staged release using the displayed original generation:

    {"id":"hpd-queens-20261011","expectedGeneration":0}

Start it using its new generation:

    {"expectedGeneration":1}

The browser's **Start release** action retains the original SF82 process handle. The live status shows the original listener, release identity, runtime mode and current dataset snapshot. The standard seller endpoints remain available at /_seller/health, /_seller/offers, /_seller/docs and /_seller/openapi.json.

**Stop release** drains the owned original seller and closes its dataset writer and private control socket. Stage and select a successor, or select **Roll back release**, then start the selected release. The original SF82 generation check prevents a stale browser selection from starting or activating a different release.

Release selection and dataset selection have separate original histories. A release binds the dataset directory and its query contract. Compatible data refreshes update the original dataset's current snapshot. Restarting a release resumes that dataset selection and its retained cursor generations.

## 3. Preview, publish and recover a refresh

Select a candidate and use the original query controls. Preview can address a candidate or any retained published snapshot. It runs the existing native query parser and page renderer.

Start the original release before publishing a later candidate. The Publisher view displays the current snapshot and revision. **Review candidate** records those exact values; **Publish candidate** sends its retained configuration to the original private refresh controller with the same expected snapshot and revision.

Publication retains an attempt before the controller request. A completed response records the original result. If a process ends between publication and its response, reopen Publisher and choose **Refresh status**. The original draft journal reconciles the current native snapshot, CSV hash, configuration hash and source byte count. When the target has changed, explicitly review its current snapshot and revision before another publication attempt.

**Activate snapshot** uses the same controller and expected revision to select a retained generation. **Collect expired versions** uses the original retention operation. In-flight requests continue holding their native snapshot pins.

Scheduled work uses these same publisher actions and the original private controller. Give each scheduled capture a complete original export; read the current target, review its candidate and pass that exact revision into publication. A lost controller response is reconciled from its existing attempt before the scheduler continues. The original source capture workspace supplies source revisions and complete editions.

## 4. Prepare the actual customer request

Choose a retained published snapshot and a first-page query. **Review customer request**:

1. Runs the query through the original private dataset preview.
2. Reads the live original seller's fixed health and offers endpoints.
3. Verifies that this exact GET resource advertises the selected query capabilities and optional snapshot.
4. Shows its actual payment options, offer digest and complete snapshot-bound URL.

Choose the advertised payment option and a distinct customer intent. **Prepare customer** rereads the live offer before using the original SF88 preparation function. The saved buyer record contains its intent, snapshot, query, offer hash and prepared configuration hash. **Download buyer request** exports that original request for an existing operator host.

A customer starts from the first page. The acquisition engine adds each returned cursor unchanged; its original page attempt records determine whether a response can be resumed.

## 5. Acquire and reopen the same dataset session

Choose the prepared buyer and an existing original SF88 operator workspace. The workspace supplies the operator identity, signing module, payer, transport, policy, reservations ledger and evidence path. The customer request supplies the reviewed resource and payment terms.

Set the acquisition's maximum pages, total atomic amount, rows and page bytes. These limits are retained with the original buyer configuration. The workspace's current policy and signer limits apply to every page.

The first session action prepares the original SF88 dataset session. **Acquire pages** uses its existing execute function and the selected workspace environment. Each page has its own original intent and attempt marker; the original spend governor records it in the shared ledger.

**Recover session** inspects the same page attempts and retained responses. **Acquire pages** continues the next eligible page of that same session. A completed session reopens as complete. **Account recorded pages** applies the existing native finalization function to the existing attempts.

**Export completed acquisition** writes the original SF88 acquisition manifest and original SF100 data room. Its pages remain in their acquired order with the snapshot, query and response hashes. The server's download routes expose the completed manifest, CSV, JSONL and review page; the original data-room directory is also returned for the host's normal delivery workflow.

## Host API

Import openSocrataPublisher from the maintained ./seller/socrata/publisher export. It returns async state(), act(action,payload), readExport(kind,id), and close(). Each act returns {result,state}. The browser server exposes this state under its existing public state's publisher key.

| Action | Payload |
| --- | --- |
| publisher.status | {} |
| publisher.prepare | {exportDirectory} |
| publisher.preview | {target: "draft:UUID" or snapshot, query} |
| publisher.reviewDraft | {draftId, expectedSnapshot, expectedRevision} |
| publisher.publish | {draftId, expectedSnapshot, expectedRevision} |
| publisher.activateSnapshot | {snapshot, expectedSnapshot, expectedRevision} |
| publisher.collect | {} |
| publisher.release.stage | {draftId, id, label, runtime} |
| publisher.release.inspect | {id} |
| publisher.release.activate | {id, expectedGeneration} |
| publisher.release.rollback | {expectedGeneration} |
| publisher.release.start | {expectedGeneration} |
| publisher.release.stop | {} |
| publisher.buyer.review | {snapshot, query} |
| publisher.buyer.prepare | {review, intentId, acceptIndex, offerSha256} |
| publisher.buyer.session | {buyerId, workspaceDirectory, maxPages, maxTotalAtomic, maxRows?, maxPageBytes?} |
| publisher.buyer.run | {id} |
| publisher.buyer.recover | {id} |
| publisher.buyer.account | {id} |
| publisher.buyer.export | {id} |

readExport accepts draft-csv, draft-review, buyer-config, session-manifest, session-csv, session-jsonl and session-review with their retained original UUID. It returns {bytes,filename,contentType}. Host signing settings remain in the original operator workspace.

## Retained operating files

The publisher directory contains original draft metadata in drafts/, prepared dataset packages in packages/, the original version store in dataset/, the original SF82 store in releases/, and original customer acquisitions in sessions/. Preserve this whole directory together with the original buyer workspace through the host's backup workflow. Keep the original dataset binding available at its retained absolute path when reopening an existing release.

To move to another host directory, import the source workspace's complete portable package, export its selected edition and prepare a publisher at the new location. Stage its original dataset release against that new location. Retained customer acquisitions continue through their original configuration and workspace; their completed SF100 data room is a portable delivery artifact.

The source workspace's Socrata export preserves capture and edition history. Publisher preparation retains the selected export and original commercial operating state in its own directory, so source capture and the running seller can continue independently.

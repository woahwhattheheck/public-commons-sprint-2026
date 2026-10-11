# Linkup research: saved purchase to a usable dossier

Use a completed Linkup purchase to answer a research question, select useful evidence, record analysis, compare editions, and deliver a portable dossier or readable report. These commands use the original Node Buyer, Linkup parser, and research-dossier application shipped in the same merchant distribution.

The original merchant/customer setup is in [LINKUP_SEARCH.md](../../../sf30-seller-sdk/LINKUP_SEARCH.md). Finish the saved customer's ordinary prepare → review → execute flow first. The receiving commands below call the original operation's recovery reader. They can run after the merchant has stopped.

## Open the customer's research workspace

Keep the original buyer state, operator workspace, and dossiers under the customer's existing private state root. Use the same stable workspace name when reopening reference editions.

~~~sh
SF88_DIR=/absolute/installed/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli
CUSTOMER_ROOT=/absolute/private/customer
node "$SF88_DIR/node/examples/linkup-dossier-cli.mjs" open \
  --runtime "$SF88_DIR" \
  --state "$CUSTOMER_ROOT/buyer" \
  --workspace-id research-team \
  --dossiers "$CUSTOMER_ROOT/dossiers"
~~~

Open the complete local address printed by the command. Its session fragment authorizes this local workspace. Existing trusted provider modules can be joined with --edition-adapter /absolute/provider-adapters.mjs; they retain their current names, and this command registers Linkup alongside them.

Choose **New**, give the dossier a decision-oriented title, then use **Questions → Add question**. For example: “Which operational safeguards does the proposed paid research endpoint need?”

## Attach a saved search or sourced answer

Export the exact completed intent to a private research result file:

~~~sh
node "$SF88_DIR/node/examples/linkup-dossier-cli.mjs" export-envelope \
  --runtime "$SF88_DIR" \
  --state "$CUSTOMER_ROOT/buyer" \
  --workspace-id research-team \
  --intent linkup-search-october \
  --out "$CUSTOMER_ROOT/linkup-search-october.research.json"
~~~

The command creates a new file and prints its original purchase identity. It rejects a changed request, changed configuration, incomplete output, wrong route, or response that fails the existing Linkup parser.

In the dossier, choose **Add research → Retained result files**. Select the question, enter an edition label, keep **Research result envelope** as the format, and choose the exported file. A second saved intent can be attached as another edition to the same question.

The file contains:

| Material | Retained meaning |
| --- | --- |
| Original request | Exact UTF-8 request bytes, byte count and SHA-256, including the user's query and filters |
| Original response | Exact provider response bytes, byte count and SHA-256, with every original field retained |
| Purchase binding | Stable customer workspace/intent, original configuration digest, selected merchant route/output, and recorded native outcome |
| Search sources | Original rank, name, URL, content and complete provider record |
| Sourced answer | Separately labelled generated text, with its original inline citation text |
| Answer sources | Original returned source order, names, URLs, snippets and complete provider records |

The research envelope explicitly wraps those original bytes with the dossier's derived source rows. Its originalPurchase field retains the complete original records; the envelope digest describes the wrapper. The generated answer has a distinct source identity and an explicit **Linkup provider answer — original generated text** title. It is never relabelled as an independent third-party source.

## Work the evidence

The existing application supports the whole research workflow:

1. In **Sources**, leave sorting on **Result order** to read the returned ranking. Duplicate URLs group into one source while retaining their original edition occurrences.
2. Open a source, read its exact edition excerpt, select an **Evidence role**, and save an **Analyst note**. Selecting an item adds it to the report's evidence.
3. Use **Findings → Add finding** to write the conclusion and link the relevant sources. Keep your conclusion separate from the provider's generated answer.
4. Add another saved search or answer as a new edition. Earlier excerpts, notes, citations, and findings stay in the original dossier history.
5. In **Revisions**, choose the earlier and later saved states to compare added sources, changed content/citations, selections, and analysis.

The provider's inline citation numbering remains unchanged. The dossier's report references identify its own selected sources; they do not reinterpret or renumber the text inside the provider answer.

## Export and receive the completed work

Choose **Export** for a readable HTML report, an editable Markdown report, or the original portable JSON dossier. Selected retained source excerpts, original source records, analyst notes and findings are included by the existing report engine.

For a receiving user, choose **Open dossier file** in the original research workspace and select the portable JSON. The retained Linkup envelope, its exact original request/response bytes, and the complete dossier revision history travel inside that file. The receiving workspace can read this material without the original merchant or Linkup provider adapter.

The inner records can also be checked directly:

~~~sh
node "$SF88_DIR/node/examples/linkup-dossier-cli.mjs" verify-envelope \
  --file "$CUSTOMER_ROOT/linkup-search-october.research.json"
~~~

This checks the canonical original byte encodings, their SHA-256 values and lengths, the saved route/output binding, and every derived source/answer row. It reports the native outcome retained with that purchase. It performs no new network settlement check.

## Receive directly into an existing dossier

Applications can attach the saved purchase through the same existing store. Supply the current dossier/question IDs and revision from the original workspace.

~~~sh
node "$SF88_DIR/node/examples/linkup-dossier-cli.mjs" receive \
  --runtime "$SF88_DIR" \
  --state "$CUSTOMER_ROOT/buyer" \
  --workspace-id research-team \
  --dossiers "$CUSTOMER_ROOT/dossiers" \
  --dossier d_ACTUAL_SAVED_ID \
  --question q_ACTUAL_SAVED_ID \
  --intent linkup-answer-october \
  --label 'October sourced answer' \
  --expected-revision 6
~~~

The command returns the current dossier, original purchase binding and edition ID. If a committed reply was lost, repeating the same exact edition/label recovers it without creating another revision. A different new edition requires the current expected revision; stale writes remain conflicts.

Programmatic integration uses createLinkupEditionProvider(buyer,{workspaceId}) and receiveLinkupEdition(store,dossierId,{provider,intentId,questionId,label,expectedRevision}) from node/examples/linkup-dossier.mjs. The original Buyer and openDossierStore objects own execution and persistence.

## Reference editions and whole customer backup

For an original purchase reference, run reference with the same --runtime, --state, --workspace-id and --intent. Paste only the returned reference object into **Add research → Provider edition**, with provider linkup. The adapter checks every request/configuration/response identity when that reference is opened.

Reference mode uses the customer's original saved BuyerResult. Portable dossier files carry the reference and analyst work; its provider content follows the original buyer workspace. Use retained mode for a standalone dossier/report with the complete source bytes.

Use the already shipped WorkspaceRecovery.fromBuyer(buyer) for the customer's entire operational backup. Its existing inspect, snapshot, verify and restore methods include the original buyer state; add the dossier directory through include. Choose the original operator directory and common state root, quiesce the application, and supply the backup passphrase through its named environment variable. The authenticated record restores its original canonical root and preserves the original purchase identities. The existing workspace-recovery guide governs the archive operation.

## Source contract

The merchant remains bound to Linkup's standard POST /v1/search API and the primary SDK [832dbecf81f0728dc9e00cdf9f4355a625e219d5](https://github.com/LinkupPlatform/linkup-js-sdk/tree/832dbecf81f0728dc9e00cdf9f4355a625e219d5). Search uses searchResults; answer uses sourcedAnswer with inline citations; both use the original text-only response selection. API credentials stay with the original merchant.

The receiver opens the exact response already saved by the original buyer. Provider execution, balances and settlement remain with that original purchase workflow.

# Merchant settlements in Grant Operations

The **Merchant settlements** desk receives an existing merchant accounting run, period close or accountant handoff into the selected Grant Operations case. It retains the whole archive, the native reader's complete inspection, the operator's cash and delivery attribution, and every subsequent correction. The browser, CLI and Merchant MCP operate the same SF47 source, cash and event records.

The original merchant reconciliation, accountant and refund engines read the source. A matched original transfer can become an explicitly reviewed cash observation. Other merchant rows can be received with their source findings and associated with recorded work or deployments. The case's existing cash report retains its treatment of original assets, supplied USD valuations and testnet activity.

## Open the complete original source

In **Applications → Grant planning and delivery**, open the saved operating case, then choose **Merchant settlements** next to Cash.

Choose the complete plain TAR exported by the original merchant workspace. Keep its original report, input manifest, output manifest, review notes and any period-close, accountant or refund members together. A source-inclusive close also carries its original sources. An accountant handoff retains its original packet manifest and return. Exact supplementary source files may be added only when the original input manifest binds their paths, lengths and hashes; preserve the original accountant members unchanged.

The service reads archive members in memory and invokes the installed original merchant reader. It retains each original identity, network, asset, atomic quantity, event, transaction and source finding. Source inspection itself leaves the case unchanged.

The source review displays:

- Every original payment and refund row, including rows that remain observations.
- Original transfer evidence and exact atomic amounts.
- The original source run, report and archive identities.
- Existing case cash, deployments, work and sources available for explicit association.
- Earlier receiving reviews for this same archive.

A later source upload with the same bytes retains the first original filename and reader identity. A downloaded filename can therefore be reselected without creating a different underlying merchant source.

## Review cash and delivery attribution

Give the receiving review a name, then choose each row's treatment.

| Treatment | Result in the original case |
| --- | --- |
| Keep in original source | The complete source retains the row without a new selected attribution. |
| Record received cash | An eligible original transfer produces a cash observation with the reviewed native unit, date, valuation and attribution. |
| Link existing cash | The original cash identity is linked after the native reader checks the selected transfer, amount and unit. Its existing date, valuation and allocations remain intact. |
| Receive observation | The row and its source findings are retained with an explicit reason and any selected delivery links. |
| Exclude with reason | The reviewed exclusion is retained alongside the complete original source. |

For recorded cash, enter the cash observation date established by the dated source, currency label, asset precision and unit source explanation. State the source’s time basis in the row reason; a recovery import date identifies the recovery observation. Precision is an explicit integer from 0 through 12. The quantity is calculated from the original atomic amount using decimal arithmetic. Network, asset, transaction and selected native event come from the retained transfer.

For example, **50,000 atomic units at 7 decimals equal 0.005 native units**. The reader still requires the original source for the currency label and precision. A testnet transfer keeps its testnet network in the case.

Enter a separate USD value only when its source is available. Supply its valuation explanation and select retained source documents where applicable. An empty USD value leaves a non-USD asset unvalued. Merchant price or quotation fields remain part of the original source.

Incoming merchant payments use CUSTOMER, INVOICE or OTHER. Refunds use REFUND and the original outgoing direction. Supplier invoice allocations are available for original outflows; the browser shows those controls for refunds. Deployment and work selections link existing case records and preserve their separate acceptance histories.

**Link existing cash** asks for the original unit fields and the cash ID. The browser shows the current amount, date and valuation while you make that selection.

Choose **Review selected changes**. Read the complete native effects and findings. The native preview covers the exact source, case version, review name, selected rows, unit and valuation choices, cash links and delivery attribution. Editing the draft clears the previous preview.

Choose **Save reviewed attribution** when the full preview is ready. The source, cash changes, saved review and original request result are committed together. The saved review then opens with its current cash records and complete source downloads.

## Correct a saved attribution

Open the source's latest saved review and choose **Correct row**. Every correction keeps the selected original transfer and a reason.

| Correction | Native result |
| --- | --- |
| Update work and deployment links | A successor attribution review retains the original cash record and updates the explicit delivery associations. |
| Link existing cash | The edition adopts an existing observed cash record for the exact same transfer and native quantity, retaining its prior link in history. |
| Void and replace cash | The original cash is voided, a replacement is recorded with the reviewed date/unit/valuation fields, and the successor review preserves both. |
| Void cash | The original observation is voided with its reason and a successor review. |

Correction preview selects the saved review ID, row ID and expected cash ID. The expected cash ID is present even when null for an observation. A changed case or later source review requires a fresh preview against the current records.

The saved original edition remains readable. Use **Open edition** to follow its history; use the latest edition to make another correction. Original cash snapshots and subsequent cash states remain available separately.

Complete case receiving restores statement-created cash at its original receiving version before following later voids and corrections. Deployment attribution is checked against the role recorded when that row's attribution was selected. Later role changes and later reviews of other rows preserve that original attribution edition.

When an accountant export and a later period-close export describe the same transfer, record the cash once and link the second source to it. If a later correction voids and replaces that cash, open the second source’s latest review and choose **Link existing cash** to adopt the replacement. Select the replacement’s current cash ID and supply the original unit fields. The expected cash ID remains the second edition’s previous link, including a voided record. The saved correction records both links and preserves the original cash observations.

## CLI

Use the installed `grant` command from the [product operating guide](../../../../products/grant-operations/OPERATING.md), or call the same source through `python cli.py`. Operations options appear before the settlement subcommand.

~~~sh
grant operations --workspace "$GRANT_DATA" settlement-preview \
  --case CASE_ID --expected-version CASE_VERSION \
  --file /absolute/inputs/original-merchant-source.tar \
  --output /absolute/working/source-preview.json

grant operations --workspace "$GRANT_DATA" settlement-preview \
  --case CASE_ID --expected-version CASE_VERSION \
  --file /absolute/inputs/original-merchant-source.tar \
  --name "Merchant period receiving" \
  --selections /absolute/working/settlement-selections.json \
  --output /absolute/working/receiving-preview.json

grant operations --workspace "$GRANT_DATA" settlement-receive \
  --case CASE_ID --expected-version CASE_VERSION \
  --file /absolute/inputs/original-merchant-source.tar \
  --name "Merchant period receiving" \
  --selections /absolute/working/settlement-selections.json \
  --expected-preview-sha256 FULL_SELECTED_PREVIEW_SHA256 \
  --actor "Receiving operator" --note "Reviewed original merchant period" \
  --request-id ORIGINAL_SETTLEMENT_RECEIVE_REQUEST

grant operations --workspace "$GRANT_DATA" settlements --case CASE_ID
grant operations --workspace "$GRANT_DATA" settlement-show \
  --case CASE_ID --review SETTLEMENT_ID \
  --output /absolute/working/saved-settlement.json
grant operations --workspace "$GRANT_DATA" settlement-export \
  --case CASE_ID --review SETTLEMENT_ID \
  --output /absolute/delivery/merchant-settlement-review.zip
~~~

The selections file is a complete JSON array. This example shows the field structure; select real IDs, dates and source explanations from the opened original case.

~~~json
[
  {
    "rowId": "ORIGINAL_ROW_SHA256",
    "decision": "RECORD_CASH",
    "reason": "Original merchant payment received for the selected delivery",
    "cash": {
      "date": "YYYY-MM-DD",
      "currency": "ORIGINAL_ASSET_SYMBOL",
      "decimals": 7,
      "unitSourceIds": [],
      "unitNote": "Original source establishing the asset and its precision",
      "usdValue": null,
      "valuationSourceIds": [],
      "valuationNote": "",
      "category": "CUSTOMER",
      "tranche": null,
      "allocations": []
    },
    "deploymentIds": [],
    "workIds": []
  }
]
~~~

LINK_CASH supplies `cashId` and only `cash:{currency,decimals,unitSourceIds,unitNote}`. OBSERVE and OMIT supply their reason and associations with no cash input. A nonempty source requires at least one selected row; an original empty report can be retained with `selections:[]`.

For correction, put the original selection in a JSON file. Command metadata remains in its named CLI options.

~~~json
{
  "reviewId": "settlement-ORIGINAL_32_HEX_ID",
  "rowId": "ORIGINAL_ROW_SHA256",
  "expectedCashId": "cash-ORIGINAL_32_HEX_ID",
  "decision": "RELINK",
  "reason": "Reviewed delivery association",
  "deploymentIds": [],
  "workIds": []
}
~~~

~~~sh
grant operations --workspace "$GRANT_DATA" settlement-correction-preview \
  --case CASE_ID --expected-version CURRENT_CASE_VERSION \
  --data /absolute/working/correction.json \
  --output /absolute/working/correction-preview.json

grant operations --workspace "$GRANT_DATA" settlement-correct \
  --case CASE_ID --expected-version CURRENT_CASE_VERSION \
  --data /absolute/working/correction.json \
  --expected-preview-sha256 CORRECTION_PREVIEW_SHA256 \
  --actor "Reviewing operator" --note "Reviewed original correction" \
  --request-id ORIGINAL_SETTLEMENT_CORRECTION_REQUEST
~~~

CORRECT_CASH adds the full replacement cash input. LINK_CASH adds `cashId` and unit-only `cash` containing currency, decimals, unitSourceIds and unitNote; `expectedCashId` still identifies the previously saved link. VOID_CASH retains the selected cash ID and reason. The JSON file excludes expectedVersion, requestId, actor, note and expectedPreviewSha256 because those are supplied by the command options.

## Agent client and Merchant MCP

The adjacent `agent-client.d.mts` declarations cover original source inspection, row selections, preview effects, saved reviews, corrections and cash records.

| Native client | Merchant MCP tool | Selection |
| --- | --- | --- |
| `read('settlements', {caseId})` | `merchant_grant_settlements` | Original case. |
| `read('settlement', {caseId, reviewId})` | `merchant_grant_settlement` | Original case and saved settlement ID. |
| `settlementPreview(caseId, version, bytes, filename, selection?)` | `merchant_grant_settlement_preview` | Complete archive; optional complete name and selections. |
| `settlementReceive(caseId, bytes, body)` | `merchant_grant_settlement_receive` | Same archive, filename, review, native preview SHA and original operation metadata. |
| `settlementCorrectionPreview(caseId, body)` | `merchant_grant_settlement_correction_preview` | Current case version and complete correction. |
| `settlementCorrect(caseId, body)` | `merchant_grant_settlement_correct` | Same correction and native preview SHA, actor, request ID and optional history note. |
| `download('settlement', {caseId, reviewId})` | `merchant_grant_export`, kind `settlement` | Complete selected-review ZIP and original source. |

Merchant MCP receives the archive through its existing host-input, retained-snapshot or completed-transfer reference and the exact expectedInputSha256. The filename is explicit. The native client receives a Node Buffer containing all original archive bytes. The provider retains complete native responses for the existing snapshot, array-page and download interfaces.

The receiving body contains expectedVersion, filename, name, selections, expectedPreviewSha256, actor, requestId and optional note. Source-only inspection has no selected cash effects; preview both name and selections before receiving.

Saved IDs use `settlement-` followed by 32 lowercase hexadecimal characters. Original case, cash, source, deployment and work IDs keep their existing prefixes. Preserve decimal amounts as strings in inputs and native responses.

The original source limit is 8 MiB for both the TAR and its expanded members. The source reader supports up to 5,000 rows. Source, deployment, work and invoice reference arrays use the native bound of 200. A review name is at most 300 characters; row reasons, correction reasons, unit notes and valuation notes are at most 4,000.

### HTTP routes

All routes use the existing authenticated Grant Operations service.

| Method | Route | Body or response |
| --- | --- | --- |
| POST | `/api/operations/{caseId}/settlement/preview` | expectedVersion, filename, contentBase64, and optional paired name/selections. |
| POST | `/api/operations/{caseId}/settlement/correction-preview` | expectedVersion and the complete correction fields. |
| POST | `/api/operations/{caseId}/command` | Existing operation envelope, action settlement.receive or settlement.correct. |
| GET | `/api/operations/{caseId}/settlements` | Complete list of saved source reviews and correction editions. |
| GET | `/api/operations/{caseId}/settlements/{reviewId}` | Original source, selected review, all source rows, current cash and history. |
| GET | `/api/operations/{caseId}/settlements/{reviewId}/export` | Complete selected-review ZIP. |

## Continue after interruption

The browser retains the complete original command and its archive before dispatch. When an HTTP response is lost, reopen the same case and choose **Recover original request**. The original native command journal returns the saved result when that request already committed. Access and route failures keep that same request available. A definite native validation rejection keeps the receiving draft available for correction and a fresh preview.

Each open window has a separate editing desk. Its source bytes, selected rows, cash fields, correction editor and original request are retained together. An older window can continue or close while another window saves its own draft. Reloading a window reopens its own saved selection. Restored source and any pending request appear before saved native reviews load.

Open **Saved editing desks** to see the retained copies and their saved dates. **Open saved copy** opens a separate editable copy. Changing the selected source or replacing an unfinished correction also retains the previous desk. The saved case review remains the source for a fresh native preview.

Use **Download complete desk** to keep the current editing work as JSON, including the original archive when it is available. **Open complete desk JSON** restores that file into the same original case, preserves the currently open draft separately, checks the archive against its retained byte count and content identity, and keeps any pending request intact. The file limit is 64 MiB. A desk restored from the earlier browser format can request the original archive once; its original hash and byte count identify the required bytes.

If browser storage is unavailable, keep the current view open and download the complete desk. Its source and original request remain available in the open view while storage recovers. Saved native case reviews continue to open independently of browser draft storage.

CLI and agent clients recover an uncertain write by repeating its identical original command. A deliberate correction uses its own reviewed request.

## Export and continue the complete case

**Download complete review** contains the selected attribution, original merchant TAR, native JSON and HTML, source references, retained cash inputs and review history. This is useful for inspecting that settlement with the original files.

Use **Download complete case** when another operator will continue the work. The original case archive includes every source, settlement review, correction, cash record and event alongside the rest of the delivery case. Receive it through the existing case importer, then reopen the same settlement IDs in the returned receiving case.

~~~sh
grant operations --workspace "$GRANT_DATA" export \
  --case CASE_ID --expected-version CURRENT_CASE_VERSION \
  --output /absolute/delivery/complete-operating-case.zip

grant operations --workspace "$GRANT_RECEIVING" import \
  --file /absolute/delivery/complete-operating-case.zip \
  --name "Received grant delivery" --actor "Receiving operator" \
  --request-id ORIGINAL_COMPLETE_CASE_IMPORT
~~~

The importer validates the original archive bytes, retained native inspection, source associations, settlement review lineage and matching cash/event history together. The received case continues with its original records and a new receiving-case identity.

## Source and release integration

The maintained `grant-operations` source selection includes the complete merchant accounting component and its existing SF98, SF86, SF43, seller and buyer reader dependencies. Both managed Python and Node launch readers include the new native settlement bridge, Python operation module and browser assets.

The implementation joins the original `operations.py`, `operations_domain.py` and source/event export/import paths. `operations_settlement.py` owns case attribution and invokes `merchant_settlement_handoff.mjs`; `operations_settlements.mjs` is the mounted browser desk. The installed client and MCP provider use the same native service.

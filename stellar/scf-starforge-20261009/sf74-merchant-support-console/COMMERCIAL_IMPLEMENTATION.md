# Accepted quotations, implementation and change orders

The Commercial quotation desk carries a saved customer quotation into the implementation in the same merchant case. An accepted quotation supplies the agreed scope, quoted work and commercial totals. Later accepted quotation revisions update that same implementation as change orders. The Implementation and receiving desk remains the place to assign tasks, deliver files and record receiving.

## Start from the customer's accepted quotation

Reopen the merchant case, choose Commercial quotation and select the exact saved quote edition. Customer response records show the original message or document, the observed UTC time and the recorded response. Choose Implementation to review the accepted edition alongside the current work.

Review the scope, deliverables, commercial totals and proposed implementation changes. Enter the actual operator and an implementation note, then apply the displayed transfer. The desk refreshes the saved case and links to its Implementation and receiving workspace.

## Apply an accepted change order

Prepare a revised quotation from the selected saved edition. Keep its parent quotation and original source editions, update the quoted work and terms, and save the new quote edition through the existing pricing review. Record the customer's response against that exact new edition.

In Implementation, select the accepted revision and review the change against the current commercial basis. The comparison identifies additions, amendments and removals and shows the original and revised quoted amounts. Apply the accepted change order to continue the same implementation. Review task changes and current receiving in the Implementation and receiving desk.

## Resolve edits while applying accepted scope

The transfer review compares the earlier agreed field, the current implementation edit and the accepted quotation. When both sides changed the same field, choose **Keep current edit** or **Use accepted scope** for that field. The table identifies the task or plan field and displays all three values.

Choose values for the fields you want to resolve, then select **Review selected choices**. The model returns the revised scope comparison and transfer eligibility. Apply the transfer after the updated review is ready. Changing a choice retains the visible comparison and enables another review immediately.

The same choice map is retained with the final request and its review digest. Reopening or retrying that request preserves those decisions. Changing the case revision or selected quotation requires a review against that new selection.

Existing task progress, owners, dates and work notes continue with the implementation. Changed task title, acceptance criteria, dependencies or delivery-relevant plan fields follow the explicit source comparison and choices. A price-only revision updates the commercial basis while receiving continues to describe the same delivered subject.

## Continue delivery

Use the existing implementation tasks, owners, due dates, original materials and receiving controls. Delivery records remain associated with their actual work definition and files. If agreed scope changes a delivered subject, record receiving for that updated work after completing it.

The Commercial quotation desk shows the current accepted commercial basis and its transfer history. Quote editions and customer responses remain available alongside the implementation's saved work.

## Reopen and recover

The desk retains the exact request ID, case identity, saved revision and selected quotation for an operation awaiting its result. Reopen the original case to recover its saved result, or use Retry exact request for that retained operation. A changed case requires a fresh review before a new transfer.

The complete case handoff carries the quotation, customer response, agreed implementation, delivery records and original source files through the existing case-package workflow. In Export and reopen, download the selected customer quotation or choose Open complete case handoff to continue in the original package desk.

## Browser integration

The existing mountCommercialDesk({root, services}) component owns the quotation and implementation-transfer interface. Load commercial-desk.css beside the existing merchant console styles and connect the component to the original saved case.

The current read, preview, saveDraft, publish, compare, receive, receivePricing and download services retain their contracts. The existing Pricing workspace and its capture, inspect, attach, case review and restore services remain connected through the original receiving component. The two additive services use the same case scope, revision and exact-request recovery:

| Service | Arguments supplied by the desk | Result |
| --- | --- | --- |
| previewImplementation | quoteId, quoteSha256, optional resolutions, original scope and expectedRevision | The canonical implementation review, directly or as {review}. |
| adoptImplementation | quoteId, quoteSha256, acceptanceId, reviewSha256, actor, note, exact resolutions, original scope, expectedRevision and retained requestId | {view, implementation}, with the refreshed quotation view for the same case. |

The preview supplies mode (INITIAL or CHANGE_ORDER), canApply, reviewSha256, exact quotation and acceptance IDs/SHA-256, implementationRevision, the recorded acceptance, changes, totals and review issues. The model decides eligibility. The browser displays that decision and preserves the exact reviewed selection. Each optional resolutions entry maps a returned conflict key to accepted or current. The preview's conflicts list contains key, subject (task or plan), optional taskId, field, current, accepted, base and resolution. The model keeps canApply false while conflicts remain unresolved, or when the acceptance or quotation relationship cannot support this transfer.

Changes contains added, updated, retired and unchanged task rows plus a separate plan array with field, id, title, before and after. The Implementation plan comparison displays each changed plan field independently of the task changes and conflict review. Each changed row carries its original identity/title and before/after scope. The scope after transfer includes the reviewed field choices. The interface displays task acceptance criteria and dependencies as well as all supplied plan fields. The price comparison consumes exact decimal strings from totals.before, totals.after and totals.delta; the UI performs no monetary arithmetic.

Each total uses implementationUsd, recurringServiceUsd, routeUsageUsd and recurringUsd. Implementation is a one-time amount. Service, route usage and combined recurring amounts are monthly.

The refreshed quotation view adds:

~~~js
{
  // Existing scope, revision, draft, quotes, source lists and requests remain.
  implementation: {
    revision,
    active,
    history,
    summary
  }
}
~~~

The active transfer and history retain quotation ID/SHA-256, acceptance ID/SHA-256, recorded time, operator, note and the previous transfer under baseTransferId. The preview supplies the original response digest at acceptance.material.sha256; the interface also accepts a direct acceptanceSha256 field. The summary is the original implementation summary, including task count, current customer receiving and receiving that needs updating. Supply the complete transfer history to this component.

After a successful transfer, compose the returned canonical implementation with the existing Implementation and receiving desk using its mergeSaved operation and current-case replacement guard. Preserve other current case drafts through the existing console coordination.

The optional openImplementation({scope}) browser service continues assignment and delivery in the same selected saved case. The desk passes the current caseId and workspaceId; the application checks that selection before navigating. Both implementation continuation controls use this service when supplied. When embedded directly in Merchant workspace, the existing #implementation anchor remains the local destination.

The optional openCasePackage({scope}) service uses the same selected-case guard to continue to /?case=<id>#case-packages. The desk supplies Open complete case handoff in Export and reopen. When embedded in Merchant workspace, #case-packages is the local destination. The existing case-package component owns the original source-file export, retained operation and receiving.

## Selection and exact-request recovery

Changing the selected quotation, saved case revision or active case invalidates the displayed implementation review. A new transfer uses the review for that current selection. The model's original revision and review binding remain the authoritative mutation check.

The component retains its operator/note draft and pending request in the current case's session state. A retry sends the original quotation, acceptance, review, operator, note, case revision and request ID. It preserves these original arguments even when the operator has subsequently viewed another quotation. Reopening a completed request clears pending state through the existing case request history.

Connections using the current quotation and pricing receiving service contracts can continue their existing quote and pricing work. The Implementation tab identifies when its transfer services are unavailable. The complete model/controller integration supplies both services for the full workflow.

## Complete case handoff

In Export and reopen, choose Open complete case handoff. The application opens the same saved case in the original case-package desk. Use its Save and export control to retain the case and package operation, then use its complete download and receiving controls. This workflow carries the case revisions, source bundles and attachments together with the quotations, customer responses, active commercial basis and delivery history.

The customer quotation download remains the selected saved edition. Case record JSON is also available under its own disclosure for the saved workspace and support record. The quotation desk checks the download descriptor, complete byte count and SHA-256 before saving either of these files.

After package receiving, continue through the original case and implementation desks. The received case retains the original quotation and response references used by the accepted implementation and its change orders.

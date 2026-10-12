# Merchant quotations

The Merchant workspace turns a saved implementation, selected service commitments, and an existing pricing plan into a complete customer quotation. Work hours, service fees, and planned route usage are reviewed together. Each saved quote retains its original sources, customer document, exact calculations, and subsequent customer responses in the existing case.

Open the original support application with its private case directory:

~~~sh
starforge support-console --cases-dir /absolute/private/merchant-cases
~~~

Choose **Quotations**, or open the displayed loopback URL at **/commercial**. The page uses the same case directory and listener as Merchant workspace. Select an existing saved case. Case search and its next page use the original case list.

## Prepare the commercial scope

The editor has three independent source selections:

| Source | What stays with the quotation |
| --- | --- |
| Implementation edition | The original workorder, assigned tasks, acceptance descriptions, and selected implementation snapshot |
| Service terms | The original terms revision, responsible owner, operating calendar, dated coverage changes, and response/recovery targets |
| Pricing scenario | The complete original saved SF97 plan, seller, terms, observation and version manifest |

Select the sources relevant to the proposed work. Enter implementation hours and USD hourly rates as decimal text. Add recurring service lines with an explicit quantity and USD unit price. A line can name an original task or service commitment; an additional commercial line has its own description and explicit fee.

Complete the customer, title, validity date, scope, deliverables, payment schedule, acceptance terms and exclusions. **Save draft** retains unfinished work without requiring a publishable quote.

The page keeps each case's local draft and original unresolved request separately. Moving from case A to B and back restores A's saved editing state. A workspace identity change clears the previous workspace's private selection. The original case remains the authority for all completed changes.

## Receive the existing pricing plan

Choose the saved plan and scenario in the original pricing workspace. Export its selected source with the installed quotation command:

~~~sh
starforge merchant-commercial source \
  --pricing-config /absolute/private/pricing/seller.json \
  --pricing-directory /absolute/private/pricing/workspace \
  --pricing-snapshot /absolute/private/pricing/snapshot.json \
  --plan-id ORIGINAL_PLAN_UUID \
  --scenario-id ORIGINAL_SCENARIO_ID \
  --out /absolute/private/selected-pricing-source.json
~~~

Use **--pricing-history** in place of **--pricing-snapshot** when the original workspace was configured with retained history. Omitting **--scenario-id** uses the plan's saved selection, or its baseline when no scenario was selected.

This operation reads the existing saved workspace. It retains the exact original bytes of five files: the plan, version manifest, seller, terms and selected observation. Receiving verifies all five descriptors, reproduces the original source-native scenario review, and checks the original plan save request.

In Quotations, choose **Receive original pricing source**, select that file and apply it to the displayed saved case. Its source appears in the editor. Enter an explicit whole monthly request volume for every selected route. The original SF97 calculator supplies route USD valuations and route totals; the entered volumes are the customer's planning assumptions.

If a pricing receive reply is interrupted, keep its original UUID and reselect the same file. The page checks its complete byte hash before continuing the original request.

## Review and save a quote edition

Choose **Review quote**. The review shows implementation, monthly service, monthly route usage and the total recurring amount. It also shows the human-readable proposal and the selected source bindings.

Work and service quantities and unit prices accept up to six decimal places. Their extended fees use integer arithmetic and half-up rounding to one millionth of a USD. The review retains the exact multiplication numerator, denominator and rounded result. Route charges remain the original SF97 calculation.

Choose **Save quote edition** to retain the reviewed document. The original case revision, complete draft and source bindings must still match. The customer document identifies its edition and date, names the selected pricing source/scenario, and states the quantities, coverage windows and rounding terms. The machine quotation retains every complete hash and original source ID.

Revising a quote creates a new edition with its original parent. The earlier edition and its customer responses remain available. **Compare editions** shows amount changes, source changes, customer terms and response history.

## Record the customer's response

Select the exact saved quote and choose **Accepted**, **Revision requested**, or **Declined**. Record the original response time, its source reference and the receiving note. The response is retained against that quote's exact bytes.

Customer agreement, implementation task receiving and service activation have their own original meanings. Recording agreement preserves the existing task and service records. Staff continue the agreed work through the original Implementation and Service pages.

## Reopen an interrupted operation

Every mutation retains one request UUID, actor, exact original case revision and full request body. The native commissioning event resolves an identical replay before checking the current revision. A lost reply can therefore reopen the original result after another case edit.

**Reopen original case** reads completed requests before another mutation. If the original request is complete, the page adopts its retained result. Otherwise **Continue original request** resends the exact saved request. Changed inputs use a new request identity after the previous result is resolved.

A case conflict preserves the editor. Reopen the case, inspect the source changes and review the draft again before saving a new edition.

## Deliver the complete work

The page downloads the customer Markdown, immutable quotation JSON, and the original portable workspace/support handoff. Each download verifies the complete descriptor's length and SHA-256 before saving. The handoff uses the original saved case timestamp so the same case produces identical bytes on reopen.

For the full staff receiving directory, use the original implementation exporter:

~~~sh
starforge merchant-commercial export \
  --cases-dir /absolute/private/merchant-cases \
  --case ORIGINAL_CASE_UUID \
  --revision ORIGINAL_CASE_REVISION_SHA256 \
  --export-id customer-quotation-edition \
  --out /absolute/private/customer-delivery
~~~

This delegates to **merchant-implementation export**. The original case metadata, complete workspace, support material, implementation history, service history and every commercial source/draft/edition/response material travel together. Original source bundles retain their own complete inventories through the maintained case-source package.

Receive that package through the existing case import or Handoffs workflow. The receiving case can have its own UUID and editing owner; the imported quote keeps its origin case identity and original bytes. Subsequent edits belong to the receiving case. Earlier quote documents remain immutable.

## CLI operation

Use **starforge merchant-commercial --help** for exact flags. Commands return structured JSON.

| Command | Purpose |
| --- | --- |
| template | Write a complete empty draft using the original form schema |
| source | Receive the five original saved SF97 source files |
| read | Open a current or selected saved case revision |
| preview | Review one complete draft against the current saved case |
| save-draft | Retain the unfinished draft with one original request UUID |
| publish | Save the exact reviewed quote and optional parent edition |
| receive-pricing | Add the complete original pricing source to the case |
| receive | Record the actual customer response to one exact quote |
| compare | Compare two immutable quote editions |
| quote | Save customer Markdown or complete quote JSON |
| handoff | Save the complete original workspace/support handoff |
| export | Run the original complete case directory export |

Case commands use **--cases-dir** and **--case**. Changes also require **--revision**, **--request-id** and **--actor**. Use **--draft FILE** for preview, draft save and publish; publishing requires the returned **--review-sha**. Revisions retain **--parent** or the draft's original parent.

Output paths are absolute private paths. An existing output with identical bytes reopens; changed output bytes require a different destination.

## MCP operation

The existing configured support connection exposes:

- **merchant_case_commercial**, **merchant_case_commercial_preview**, **merchant_case_commercial_save_draft** and **merchant_case_commercial_publish**.
- **merchant_case_commercial_receive_pricing**, **merchant_case_commercial_receive** and **merchant_case_commercial_compare**.
- **merchant_case_commercial_file**, **merchant_case_commercial_file_reads** and **merchant_case_commercial_file_release**.

File receiving uses the original retained-file reader. Select the saved case revision, quote ID/hash and document kind. Keep its returned file descriptor, **readId**, **expectedSha256** and **nextOffset**. After the reader closes or the operator restarts, reopen the same immutable selection with the expected SHA and retained byte offset. A later case edit leaves that original revision available. The existing **merchant_case_export** and support export readers deliver the full case.

## Native composition

**openCaseCommercial({store,workspaceId})** reuses the original case store and commissioning operations. Its methods are **read**, **preview**, **saveDraft**, **publish**, **receive**, **receivePricing**, **compare** and **download**. All completed quote documents are original commissioning materials with empty task assignments.

**captureCommercialPricingSource({model,planning,planId,scenarioId})** accepts the original configured SF97 model and planning reader. **inspectCommercialPricingSource** verifies the complete received packet. **reviewCommercialUsage** delegates the explicit monthly volume to the original scenario engine.

The browser, CLI, MCP and receiving counterpart all use these same methods, case revisions and original retained events.

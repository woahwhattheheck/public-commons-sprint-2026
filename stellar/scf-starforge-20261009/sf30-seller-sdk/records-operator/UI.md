# Records operator UI

The industrial browser application at `/records-operator/` works with the original Python workspace server, the existing records processor and the original offsite-records reconciliation engine. Its source lives in `web/index.html`, `web/browser.mjs` and `web/style.css`. Start it with the complete product’s `workbench.mjs serve` command and open the full printed operator URL.

[CORE_CONTRACT.md](CORE_CONTRACT.md) defines the exact source, calculation and output shapes. [OPERATIONS.md](OPERATIONS.md) and [README.md](README.md) carry the original operating and receiving instructions.

## Scope and source history

Select a named period and a retained edition in the header. A saved report always shows its original period, edition and workspace revision. The UI labels a report from another source selection and uses exact request/finding bindings for decisions.

Every applied edit remains in a local draft until **Save draft**, **Save & inspect** or a build action saves it. Source files, metadata, corrections, decisions, assignments, checkpoints and field maps enter the original `workspace.json`; they do not go into a second database. The same workspace retains each immutable save revision.

The original IndexedDB helper stores the full local draft, incomplete source/mapping forms, selected records and pending mutation payloads under this workspace’s identity. Browser reload reopens the same draft. The token stays in the original same-origin session mechanism and is removed from the address fragment after use.

## Sources and contract scope

**Sources & contracts** edits the selected period and edition, review mode, capture time, historical evaluation time and same-period comparison target. Current owner review uses the original engine’s actual process UTC. Historical integrity review preserves the explicit evaluated-at timestamp.

The four authority sections retain policy, custody, services and invoice ledger scope. Policy includes declared currency, minor-unit digits, exact calculation rounding and authority age. Completeness is an explicit source declaration. Blank, unavailable or inconsistent data stays visible to the processor as an input correction.

Import complete UTF-8 CSV or JSON exports. The browser computes the exact file SHA256, preserves original bytes and keeps each capture at its content-addressed path. Declare its table, exact source identifier, money scale, capture time and JSON row pointer before adding it to the edition. Original files remain downloadable.

For each source, map canonical fields to exact original column names. An empty mapping uses identical canonical names. Once a mapping is present, declare every intended field. Explicit constants supply absent canonical fields; exact raw value maps apply before typed conversion. Rates support the original nested pricing fields, including graduated/volume tiers, minimums, maximums, explicit fee bases and credit methods. Monetary decimal values remain text; the UI does not calculate prices using binary floating point.

A maintained V1/V2 complete request can remain a requestSource edition. The interface displays its original descriptor and complete file instead of relabelling it as separate customer ledger exports.

## Reconciliation and corrections

**Reconciliation** inspects the whole selected source and returns one native page. Views include original findings, invoices, rates, sites, cartons, events, source identities, input errors, same-period changes, review history and customer projections. Literal search and exact record IDs are forwarded unchanged to the processor. Pagination follows the returned nextOffset; a shortened page explains the native byte limit.

Open a mapped row to see its original cells, mapped values, typed values, exact source row, mapping SHA and calculation. **Correct mapped source cell** records the exact existing value, new value, author and reason. Monetary fractions use exact text. Arrays or objects use JSON with quoted fractional values.

A correction can be appended to the working edition or placed in an explicitly named new correction edition. The latter retains the old edition as its comparison basis. Original source bytes remain unchanged. Explicit omission records stay visible with their original row and reason.

Native input corrections remain actionable source details. The UI does not call an empty or unavailable calculation successful.

## Named finding decisions

Select explicit findings across retained pages. Each selected record carries its own finding SHA256 and the exact request, period and edition. The shared disposition, owner, private note and evidence references are appended to each selected binding.

The dispositions are open, accepted, dispute-prepared, resolved-in-source and revisit. They do not rewrite engine states, alter an invoice, post AP or record a payment. Saved reviews are append-only in the source editor; the original processor determines current and stale bindings.

## Inventory and transfer

**Inventory & transfer** joins the retained custody rows to the operator’s named waves and exact carton assignments. It shows original availability at the review boundary, existing admission/termination data, multiple assignments and missing planning details. Original inactive or destroyed cartons remain visible.

Create or edit a wave, select exact retained cartons, and apply a destination, owner, status and notes. This explicitly replaces those cartons’ current draft assignment records; earlier saved source revisions retain the previous plan.

Record the five native checkpoints independently: manifest, custody-transfer, destination-receipt, inventory-reconciliation and access-handoff. Each appended status has an owner, time, note and evidence references. The original report determines wave completion and lists pending, rejected or unreferenced acceptance. The UI performs no physical transfer or destruction.

A correction edition can explicitly copy the earlier edition’s named assignments. Checkpoints retain their own original edition scope.

## Cooperative monthly reporting

**Monthly reporting** accepts the actual supplier/contract/agency header, exact percentage, declared rounding and credit treatment, IANA reporting timezone and included charge codes. Original invoice references map to actual agency IDs and names; the interface does not turn an invoice reference into an agency identity.

Previously recorded check/wire references and minor-unit amounts can be entered for native monthly fee comparison. No remittance is issued. The original report shows actual agency groups, source basis rows, excluded charge codes, unresolved inputs, present remittances and exact variance. Fee and sales arithmetic stays in the original engine.

## Requirements and catalog

**Requirements & catalog** opens the full retained original question and catalog sources through native pagination. Every row includes its original workbook/sheet/row metadata and complete source object. Blank catalog prices remain unpriced.

Responses are attributed entries with draft/reviewed state, owner, complete text, evidence and recorded time. They do not constitute a supplier certification. New responses preserve earlier source history. Complete structured reference files can be imported and downloaded without converting them into invoice records.

## Customer and operator handoff

**Customer handoff** uses the native `customer-invoices` view for the actual sanitized customer projection. The field editor shows available values, present nulls and unavailable paths separately, including exact RFC6901 pointers. The complete report carries whole-source mapping coverage.

Builds use the original saved-source `build_records` or `customer_records` function. Each compact report file is verified against its retained SHA256 and byte count before download. The UI can download the complete native output and full portable workspace.

For complete row files, enter the product directory, selected original runtime source root, existing workbench directory and new output destination. The UI generates the original `workbench.mjs handoff` command bound to the completed build ID and its immutable source revision. The same exporter writes every selected row and the exact delivery manifest. Operator delivery retains original source, calculation, private decisions/corrections and portable history; customer delivery uses the original safe projection and agreed field map.

Receiving commands use the existing create-only import and serve lifecycle. The UI never starts an alternate exporter, server, payment engine or background provider acquisition.

## Recovery and concurrency

**History** opens a saved revision read-only while retaining the working draft separately. Restore creates a new original source revision; it does not delete history. The file inventory exposes original source bytes and hashes.

Before a write, the UI retains the complete request payload. If a response is interrupted, recovery reconciles its original request ID or exact revision note/parent and file hashes. Preview retries reuse the original operationId. Source writes use the current expected head; an intervening source edit is preserved.

The three-way merge retains independent local/current fields, named periods/editions and appended review/checkpoint/response history. Competing changes to the same field are shown with both configurations for an explicit merge. A complete local-draft download and reopen route preserves edits even when browser storage needs attention.

The only polling is the current explicitly started native operation. There is no scheduled task, background data acquisition, separate source registry or duplicate application workspace.

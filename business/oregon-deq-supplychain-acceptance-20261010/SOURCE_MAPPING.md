# Source mapping and delivery inputs

This guide connects the original Oregon DEQ requirement, the vendor's published data roles and the existing `auditTrace` contract. Use it with the operator instructions in [README.md](README.md) and the single current offer in [CONDITIONAL_PAID_WORKSHARE.md](CONDITIONAL_PAID_WORKSHARE.md).

## 1. Source register

| Source | Observed basis | What it informs |
| --- | --- | --- |
| [Original OregonBuys solicitation S-34000-00018168](https://oregonbuys.gov/bso/external/bidDetail.sda?docId=S-34000-00018168&external=true&parentUrl=close) | Original source custodian read attachment 814025 on October 10; the current issuer page and the same 54-page PDF were recovered directly on October 11, 2026 at 19:34:14 UTC. | Buyer scope, schedule, export expectations and prime responsibilities. |
| [Sourcemap supply-chain mapping](https://www.sourcemap.com/technology/supply-chain-mapping) | First-party page read October 11, 2026. | Product/article and component relationships, supplier/facility associations, and records attached to transfers. |
| [Sourcemap integrations and data pipeline](https://www.sourcemap.com/technology/erp-integration) | First-party page read October 11, 2026. | Bulk upload and REST-based enterprise data exchange. |
| [Sourcemap partner program](https://www.sourcemap.com/partner) | First-party page read October 11, 2026. | Systems-integration, consulting, software and government/NGO delivery routes. |
| Original `audit.mjs` | Git blob `0608fd99735077728668f6ccdcc8934cc9e8f4f7`, retained unchanged in this implementation. | Exact local schema, allowed classifications, evidence-age calculation and selected-path results. |

The public vendor pages describe business data roles. They do not provide a current proprietary CSV header list or executable API schema. Field bindings therefore come from the partner's actual authorized export and reviewed data dictionary. The local names below are the application's audit contract.

The vendor describes evidence associated with specific material transfers, including commercial, shipment and production/origin records. This supports retaining evidence beside the relevant relationship instead of attaching one general document to every edge. Product/component identity and facility identity should remain distinct.

### Issuer baseline and current amendments

The original PDF endpoint is [attachment 814025](https://oregonbuys.gov/bso/external/bidDetail.sda?docId=S-34000-00018168&external=true&parentUrl=close&downloadFileNbr=814025&mode=download&fn=MM%20Built%20Envmt%20Material%20Tracing_RFP_FINAL.pdf).

The October 11 direct issuer recovery confirms the following original clauses:

| Issuer section | Relevant requirement | Consequence for this workshare |
| --- | --- | --- |
| §1.2, page 3 | Questions October 14 at 4 p.m. Pacific; offers October 21 at 4 p.m. Pacific. | Use the current issuer posting for the prime's calendar. |
| §2.4, pages 7–8 | Material-to-product supply tracing, supplier/facility/process/transport information and environmental/social risk analysis. | Preserve product scope, facility relationships and the source behind each supplied claim. |
| §3.1.1, page 9 | Open interfaces and CSV/XLSX interoperability with Microsoft 365/Power BI; IoT/telematics ingestion and offline synchronization. | Export-based QA covers the agreed supplied snapshot. Live integration and offline field synchronization require separately agreed work. |
| §2.4 and §3.1.1 | A 24-hour weekday response requirement and a separate 24/7 technical-support requirement. | Carry both terms into prime clarification and delivery planning; do not replace one with the other. |
| §3.1.1 | Security, identity, availability and recovery requirements for the commercial platform. | The prime provides the applicable platform, certification, SLA and operational evidence. |
| §3.9, page 18 | Mapping 30 points, source/data coverage 30, risks 15, platform/implementation 15 and price 10. | A useful delivery exposes actual source coverage and gaps for the partner's existing product. |

The current public issuer page retrieved on October 11 at 19:34:14 UTC lists one file attachment, `MM Built Envmt Material Tracing_RFP_FINAL.pdf` (814025), and shows an October 21, 2026, 4 p.m. opening. The recovered PDF's §1.2 gives October 14, 4 p.m. for questions and October 21, 4 p.m. for offers, both Pacific. The visible attachment list at that observation contains the original RFP.

The current page is 54,294 bytes with SHA-256 `e26f70547ccd9e54e5e5541afa4162485e4bde3597be8a9b236c3b1e4958f9d0`; the 54-page PDF is 715,459 bytes with SHA-256 `1b85d735447c90437f8dab9331d754e3d9edef3cf6edd8e0de7fa9a0d4d4707f`. Retain these original observations with later refreshes. Section 3.3.1 directs offerors to check OregonBuys for amendments; the designated prime reviews the live posting before relying on a submission schedule.

## 2. Partner source handoff

Agree up to ten selected product/article traces for the current commercial scope. The original engine can accept up to 100 products; that technical ceiling does not enlarge the paid sample.

Provide the source files in their original exported form, together with:

- Exporting system, tenant or project reference suitable for the private handoff, export time and data-dictionary version.
- The selected product/article IDs and source definition of a trace.
- Source table and record keys, relationship direction, declared stages/classifications, and any joins required across files.
- Original evidence references, their observation dates and the meaning of each risk status.
- The permitted location, recipients and retention treatment for the export.
- A named reviewer for mapping questions and unresolved findings.

Preserve leading zeroes and opaque identifiers as text. A facility, supplier company, product and transaction are different identities even when their display names match. Keep source timestamps distinct from the time a file was uploaded into the operator.

## 3. Map source roles into the original engine

The original input is JSON with schema `oregon-deq.trace-evidence.v1`.

| Logical source role | Local target | Required mapping decision |
| --- | --- | --- |
| Selected product/article | `products[].id`, `name`, `destinationNode` | Preserve the source product key and select its explicit Oregon-market destination node. |
| Material-process/facility node | `nodes[].id`, `stage` | Bind the stable source node key and map its declared activity to one supported stage. |
| Product-specific relationship | `links[].id`, `productId`, `from`, `to` | Preserve the source relationship key, product association and upstream-to-downstream direction. |
| Relationship evidence | `links[].evidence[]` | Bind each supporting source reference and its original observation date to the relationship it supports. |
| Node/category assessment | `risks[].nodeId`, `category`, `disposition` | Resolve the source's assessment scope and status using an explicit reviewed mapping. |
| Assessment evidence | `risks[].evidence[]` | Preserve the source reference and observation date supporting that assessment. |
| Frozen review time | `asOf` | Select and retain the UTC instant used to evaluate evidence age in this run. |

The operator retains the original file/row association beside normalized records. Additional supplied fields remain useful source context even where the original audit does not consume them.

### Exact accepted classifications

| Field | Original allowed values |
| --- | --- |
| `nodes[].stage` | `extraction`, `processing`, `manufacturing`, `distribution`, `oregon-market` |
| `risks[].category` | `labor`, `human_rights`, `environmental_justice`, `hazardous_substances`, `environmental_impacts` |
| `risks[].disposition` | `risk_found`, `reviewed_clear`, `unknown` |
| Evidence element | `{ "source": "...", "observedAt": "YYYY-MM-DDTHH:mm:ssZ" }` |

An unsupported source classification remains a mapping question. A missing source status maps to an explicit unknown/review item through the agreed mapping; it never becomes a favorable assessment by default.

The engine's five categories are its existing review model. Preserve additional vendor categories in the source context and findings package instead of forcing them into an inaccurate category.

### Identifier and evidence rules

The original engine requires:

- Unique, nonempty string IDs for products, nodes and links.
- Every product destination to identify an existing `oregon-market` node.
- Every link to identify an existing product and two different existing nodes.
- Every link and risk record to have an evidence array, including an explicitly empty array when the supplied evidence is absent.
- At most one risk assessment for each `nodeId + category` pair.
- Valid UTC instants for the run and each evidence observation that is used.

The original engine limits products to 100, nodes to 20,000, links to 100,000 and risks to 100,000. Retain the agreed smaller sample/record limits for a paid delivery.

When the vendor has multiple documents for one relationship, retain all of them in that relationship's evidence array. Do not erase repeated source rows to make them look like duplicate-free data: reconcile them to the resulting record or retain a conflict for review.

If assessments differ by product or material at the same physical facility, resolve that scope before reducing them to the engine's node/category key. One reviewed approach is distinct product-scoped node identities with the original physical-facility key preserved as source context. Another is a partner-confirmed common assessment. Conflicting assessments should not silently overwrite one another.

## 4. CSV and JSON intake decisions

Use JSON where the partner already provides the original contract or a structured export whose field paths are known. Use CSV for supplied flat tables and bind their column names explicitly.

For CSV, retain the delimiter, encoding, header row, source row number and original value. Resolve duplicate headers, embedded newlines, blank IDs and date formats before accepting the mapping. If several tables make one graph, record the source-to-target join fields for every table.

A date-only source value cannot supply an invented midnight observation instant. Preserve the source value and ask the reviewer to supply the documented time convention or a more precise source field. Likewise, the upload time does not replace an unknown historical observation date.

A normalized run should retain:

| Retained item | Purpose |
| --- | --- |
| Original source files and hashes | Reopen the exact supplied input. |
| Dataset/table and row locators | Account for every row and trace a finding back to its source. |
| Mapping version and reviewed classifications | Reproduce the normalization decisions. |
| Selected product IDs, `asOf` and freshness policy | Keep the paid sample and audit settings explicit. |
| Normalized original-engine input | Reproduce `auditTrace` without importing again. |
| Reviewer changes and earlier values | Reopen the corrected version while preserving source lineage. |
| Row dispositions and findings | Explain every mapped, unresolved or excluded row. |

Keep partner exports, commercial correspondence and private project references in the private workspace. The repository carries reusable source, empty contracts and public-source guidance.

## 5. Read the result correctly

The existing `auditTrace(data, {maxAgeDays})` selects one reverse path from the product destination to extraction. It prefers a path whose links have recent evidence; otherwise it reports an undocumented path or no source path. It evaluates the five risk categories along that selected path.

The default `maxAgeDays = 180` is the application's review policy, not a deadline stated by Oregon DEQ. The reviewer chooses the setting and freezes it with `asOf`. Future-dated or out-of-window evidence does not support a recent-evidence result.

The original path result is one part of the delivery. Review the operator's complete row and branch findings for additional upstream paths, cycles, orphan records, unresolved joins and conflicting identities. A selected path can be documented while another supplied branch still needs investigation.

The retained report separates:

- Original selected-path status and missing assessment pairs.
- Complete input-row disposition and unresolved mappings.
- Branch/reference findings across the supplied selected traces.
- Source changes and reviewer decisions between versions.

## 6. Delivery to the partner

Export the exact reviewed source version, normalized input, agreed CSV/XLSX outputs, findings and row-reconciliation tables, review settings and rerun instructions. Preserve opaque IDs as text and make exported cells safe for spreadsheet opening without destroying the original retained values.

The acceptance report identifies the selected products, files, mappings, settings, unresolved source questions and designated reviewer. The three-business-day review and one correction/rerun in the current offer use that same frozen delivery package.


## 7. Native CSV, XLSX and complete workspace handoff

The operator exports from an exact retained revision. Keep the source files, mappings, corrections, exclusions and review decisions together when transferring a case to another reviewer.

| Handoff member | Contents and use |
| --- | --- |
| `workspace.json` | Complete portable state, including import associations, reviewed field/value mappings, per-row changes, exclusion reasons, reviewer identity and timestamps, and both state/data revisions. |
| `report.json` | Full current row disposition, upstream branch findings, issue references, carried reviews, counts and the original selected-path audit. |
| `audit-report.json` | The original engine's result from this same snapshot. |
| `normalized-graph.json` | The derived trace graph, included when `report.summary.errors` is zero. A correction-stage bundle still retains the source and current findings. |
| `source-manifest.json` | Every import ID and original filename bound to its SHA-256, byte count, retained archive path and graph section where applicable. |
| `sources/` | Original supplied bytes, deduplicated by SHA-256. Multiple sections of an original graph retain distinct import associations while sharing one source member. |
| `tables/` | Full CSV tables for imports, mappings, corrections, exclusions, source rows, branch counts/members, findings, source references, reviews, selected paths, mapped records and evidence. |
| `review-workbook.xlsx` | The same review tables in a native workbook with frozen headings, filters and readable column widths. |
| `manifest.json` and `SHA256SUMS` | SHA-256 and byte count for every payload file. The two index files exclude themselves from that payload inventory. |

Original source filenames remain exact in the source manifest. The ZIP uses a safe display filename below the source hash directory, so an exporting system's path separators do not become local directories.

### Spreadsheet values and long text

The workbook stores every value as inline text. This preserves identifiers such as `0007`, dates as originally supplied, and strings beginning with formula characters. Arrays and objects use JSON text; the full structured state and report remain directly readable in their JSON members. Counts can be converted deliberately by the reviewer when preparing numerical analysis.

CSV files use UTF-8 with a byte-order mark, standard quoting and the operator's spreadsheet-formula protection. For direct spreadsheet review, use the XLSX workbook. When importing CSV manually, choose text column types for identifiers and source values. The original source bytes and JSON values retain their original content independently of display-oriented CSV protection.

A workbook cell longer than Excel's 32,767 UTF-16-code-unit limit points to `text_overflow`. That worksheet carries the complete value as ordered chunks, with the original table, row, column, reference and part number. Its chunks preserve surrogate pairs. CSV and JSON members keep the complete unsplit value.

### Restore the editable case

The native restore command accepts a workbench-created bundle:

~~~sh
node workbench/server.mjs restore \
  --bundle /private/handoff/trace-workspace.zip \
  --data /private/restored-trace-case
node workbench/server.mjs --data /private/restored-trace-case
~~~

Choose a new or empty data directory. Restore validates the complete archive before publishing the restored directory: entry paths and types, local/central ZIP agreement, declared sizes, CRCs, payload digests, the manifest, source associations and snapshot metadata. It also parses the original inputs through the native workbench, confirms their stored column/row shapes and derives the current report.

The restored state keeps the selected revision, mappings, corrections, exclusions and review decisions. The original source bytes are written once per SHA-256. Starting the restored operator creates its own access file; use that installation's `operator-access.json` when opening the local interface.

The format uses classic ZIP with UTF-8 names and stored or raw-deflate members. Its limits are 256 MiB for the archive, 512 MiB for total expanded members, 256 MiB for an individual member and 4,096 members. The reader enforces the declared expanded size before inflation and checks the actual output. The operator's source and row limits apply as well.

### Reusable module contract

`workbench/export.mjs` uses Node's standard library and the existing CSV helper:

~~~js
exportTables({ state, report });
// [{ name, columns: string[], rows: object[] }]

exportWorkbook({ state, report });
// Buffer containing the native XLSX workbook

exportBundle({ state, report, sources });
// Buffer containing the complete ZIP handoff
// sources: [{ id, fileName, sha256, bytes: Buffer }]

readBundle(bundleBytes);
// { state, sources: [{ id, fileName, sha256, bytes: Buffer }] }
~~~

The report must match the state's revision, review instant and evidence-age setting. Every retained import, including a disabled import, needs its original source bytes. The exporter checks supplied hashes and preserves all graph-section associations when several imports share one source.

The native operator recomputes the report after restore. Its original engine result, all-row reconciliation, branching findings and current reviewer choices can therefore be reopened and continued by the designated reviewer.

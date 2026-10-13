# Original field evidence and native file handover

The existing Implementation and fieldwork desk now keeps original photographs, laboratory files, reports and other attachments with their native source references. The complete handover ZIP carries the unchanged plan and every original local-file source; it can be opened in the standalone workbench and returned to the original native plan.

## Attach originals to the actual work record

Use **Files** beside a task, visit or sample activity, or **Add original files** in **Handover**. Choose the original files, select the actual work record and optionally add a readable label. Attaching files changes the browser draft. The source register retains the original filename, byte count, SHA-256, media type and same-plan attachment reference, while the work record retains its exact source IDs.

Structured field forms now let the operator choose attached files for an attachment list. Single-reference fields retain the original reference or source ID. Removing a source still referenced by work records, original source metadata, laboratory results/import history, custody fields or structured responses is rejected. Preserve those original associations with the source; remove a source only after intentionally removing its corresponding associations.

Save the native revision after fieldwork. Every existing save continuation—including saving before a laboratory request or observation registration—routes newly attached original files through the same native evidence import before proceeding. The original queued operation is retained on an uncertain response. Later browser changes remain available when that operation completes.

## Inspect, reopen and transfer

**Handover** shows the original file list, linked records and browser availability. **Download original** returns the retained bytes. **Preview image** supports the existing PNG, JPEG, GIF and WebP viewer. Native files can be hydrated through the original authorized download ticket, with their SHA-256 and byte count checked before they enter browser storage. Laboratory source IDs are preserved during hydration.

Use **Export plan + files ZIP** for the complete browser handover, and **Open plan + files ZIP** to reopen it in another workbench. Opening a package preserves a differing existing browser draft, clears transient controls from another plan, and retains the incoming native revision. The files live in IndexedDB; exporting the complete ZIP keeps an independent copy with the plan.

In the native desk, **Native plan + files ZIP** exports one exact saved revision and supplies the original download ticket. **Save plan + files to native** validates the entire package and imports its plan through the existing revision store. A revision conflict preserves the incoming archive and original files for the existing reconciliation flow. Repeating the same retained task reconnects to its original committed revision.

The existing **Results review** source inspector follows the actual sample activity to its file references. Results filters and complete matching CSV/context exports, laboratory CSV intake, requests and returned-result comparison, scientific report sources, Outcomes, sample QC and briefing follow-up stay in the cumulative application.

## Preserve laboratory source aliases

Current laboratory intake creates source IDs such as `lab_csv_…` and `lab_audit_…`; those IDs carry original mapping or operation identity. Their retained file path may use a storage suffix such as `lab-results.csv` while the original filename remains the actual uploaded filename.

The evidence package validates these original IDs and references without renaming them. References must remain ordinary, SHA-prefixed files inside the same plan’s attachment bank. Each source has its own complete manifest descriptor. Several legitimate mappings of the same original bytes can share a single ZIP member while retaining distinct IDs, labels, metadata and record relationships. Unlisted members, mismatched sizes/hashes and references outside the plan bank are rejected.

## Choose original source rows before importing

**Source selections → Import native selection** now opens the original retained community plan or completed conservation portfolio. Review original statuses, quantities and source context, search the rows, and explicitly select the intended work units. **Import chosen rows** preserves their frozen source snapshots.

The read-only preview returns the original source digest. The queued import verifies that digest again before saving the selected rows in one native revision. If the source changed, review its current rows again. The existing economic-scenario handoff remains its own exact edition/run/zone-bound intake.

## Native storage and resource behavior

The native model is `model/implementation_evidence.py`. Its maintained entry points are `read_package`, `import_package`, `export_package` and `exported_package`.

The native reader validates manifest/plan metadata and streams original ZIP members in 1 MiB chunks. Its returned file records are descriptors; it does not retain duplicate in-memory arrays of every file or the whole archive. Import atomically retains the verified incoming archive and each original file, then invokes the original plan import. Export streams each verified file directly to a deterministic ZIP, publishes it atomically and retains an immutable receipt.

The package accepts the native plan and laboratory intake capacities: 16 MiB per plan and 64 MiB per original file. The overall limits remain 128 source references, 128 MiB of unique archive evidence members and 1 MiB for the manifest. Native temporary files are removed on failure; completed originals remain immutable. Every original member is checked before plan import. No automatic file recompression, image transformation or result conversion occurs.

## Application integration

The complete installer includes the native evidence model, original browser evidence codec and UI, original source preview/form controls and native routes. The standalone builder bundles evidence modules alongside core, forms, results and briefing. Native-only laboratory, report, Outcomes and QC capabilities keep their existing lazy loading and native workspace requirements.

Routes added to the maintained implementation descriptor:

| Operation | Route or action |
| --- | --- |
| Read original source rows | GET `/api/implementation/selection-preview` |
| Import plan and original files | `implementation.evidence.import` / POST `/api/implementation/evidence-import` |
| Export exact saved plan and files | `implementation.evidence.export` / POST `/api/implementation/evidence-export` |

The provider uses the original upload verifier, task queue, revision history, immutable export selection and authorized file tickets. Workspace portable capture already includes these source files and retained plan directories through its maintained application and workspace traversal.

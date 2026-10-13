# Keep edited Monitoring field selections in the native Workspace

The existing **Monitoring design → Saved field selections** panel receives the JSON exported by the original Upper Savannah field-planning desk. It retains the exact UTF-8 input, source edition, chosen budget plan, source-station choices, notes and subset of original calendar rounds. A complete native Workspace backup carries these edits and the complete source study to the receiving application.

This is an explicit review layer over the original saved budgets. Historical E. coli stations and 2026 draft-assessment stations remain different source choices. Receiving a selection does not revise a Monitoring campaign, create a sampling assignment, record a collected sample or change the optimizer.

## Original completed source

RIVER’s completed field-support source is imported through `source/monitoring-field-study/receive_field_support.py`. Use its complete 239-member package and the original project, following that directory’s README. The native source collection is `371fca0c31de80d7309e6b7793ca56ac4563a7135409f667e240340957b098a3`; the working document is `monitoring-field-planning`. The saved source retains 223 companions. Its support identity is `e62688692e78bc7cb1551d15cff73afa2a6e3db47b44e78a06e34a89656b51aa`.

The original three plans select 6, 12 and 18 search areas. Their retained-source join reaches the same 234 E. coli records at 11 stations, including 233 routine samples and one separate field replicate. The complete source keeps all 730 records, 36 original observation stations, 87 native assessment sites and 217 catchments. These source-support counts remain separate from the area objective.

## Operate the complete field workflow

1. Open the original project’s **Monitoring design** view and find **Saved field selections**. Choose the retained field study and use **Download original working desk**. Open that HTML normally.
2. In the original desk, select a saved budget and search area. Inspect the original candidate source fields, coordinate basis, historical method/condition/date and actual calendar before choosing a station. Add field notes and select the original rounds to include. The separate original JSON and source files stay available in that desk.
3. Use **Save selection JSON**. Back in the native panel, choose that exact file and a useful title. Select **Review selected source and calendar**. The preview shows the saved plan, review choices, original coordinate basis, notes and every selected native visit.
4. Select **Retain reviewed selection**. This uses the existing original task queue and its persisted operation identity. On a lost response, repeat the same reviewed selection; the content-addressed native record and immutable files remain the same. If the original task failed or was interrupted, open that retained task in Operations and resume it.
5. Open the saved edition in **Retained editions**. Its original JSON downloads byte-for-byte. **Open selected field-planning desk** downloads the original complete working HTML initialized to that exact plan and saved choices. It keeps the original data, controls and downloads. Open the downloaded HTML in a browser and continue editing.
6. Save a changed selection from that desk and receive it as another native edition. The earlier edition remains immutable. A selection-specific browser storage key keeps a different edition’s local choices separate; downloaded JSON is the portable authority.
7. Use the existing full Workspace backup/restore. Open the receiving application’s Monitoring view and the same retained edition. Its exact original JSON, source and working desk remain available without the sender’s local browser storage or sibling output directory.

No station is selected automatically during intake. A plan with no station choices or no selected rounds remains an explicit valid review selection. Notes are preserved as text, including notes for still-unassigned search areas.

## Native API and source identity

The backend-only extension `monitoring-field-selection.json` registers POST reads under `/api/monitoring-field-selection/{catalog,source,preview,inspect}` and one original queue action, `monitoring.field-selection.receive`. Read and task payloads use the existing workspace envelope.

Preview and receive accept:

```json
{
  "source_collection_id": "the retained original collection",
  "source_id": "monitoring-field-planning",
  "selection_text": "the complete original selection JSON text",
  "title": "Field selection for scientific review"
}
```

The `selection_text` is preserved byte-for-byte after UTF-8 encoding; it is not reconstructed from a reduced form. The original selection schema is `upstate.monitoring-field-selection/v1`: `support_id`, `project_id`, `frontier_id`, `plan_id`, `budget_usd`, `choices`, `notes`, and `rounds`. Choices map HUC12 to the original `observation:ID` or `assessment:ID`. Native intake checks the exact original source support, original project/network/frontier/plan identities, source-station catchment membership, note length and original round subset. It compares the copied calendar and planning costs with the actual native saved plan.

Native records live in the original Workspace’s `monitoring_field_selections` collection. Original input and selected working desk live under `monitoring-field-selections`. The original source document and all companions remain in the existing source-object store. The Workspace restore hook reads and verifies retained source members and selected native records without creating source views or modifying the receiving project.

The selected desk is derived through two exact joins in the original delivered HTML: the existing storage key and final control initialization. An unknown successor with different anchors returns an actionable error and preserves the original source. The generated working desk does not replace the source document.

## Current owner direction and actual product use

Read the complete current `CURRENT_OWNER_DIRECTION.md` and root `AGENTS.md` shipped with this application and bank. Version 2026-10-13.3 keeps the primary demonstration on actual Upper Savannah source geometry, the original 30 m upstream/reporting/utility distinctions, clearly labeled simulated inputs where used, native annual physical outputs and independent editable receiving. Tim’s scientific direction and client relationship remain intact. The October 13 sprint cutoff is 14:00 UTC.

Operate the outgoing populated application and the downloaded working desk at desktop and 390 px. View their actual pixels; source review, HTTP success or screenshot capture alone is not product acceptance. Exercise an empty saved library, wrong-project or wrong-source JSON, a valid reviewed selection, notes, original rounds, save, download, subsequent editing and cold receiving. Literally open and inspect every outgoing attachment: complete HTML, JSON, source CSV, maps, PDF pages, archive and receiving project. Extract delivered archives and use the contained working product. Repair concrete clipped, unreadable or broken controls in their original source. Keep all accepted native records and ongoing regional calculations intact; this continuation requires no new model or optimizer run.

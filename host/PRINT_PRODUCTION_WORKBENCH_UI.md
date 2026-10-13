# Print production — operator guide

Open Print_Production_Workbench.html in a current browser. It contains the complete source tariff, working application and editable record. The supplied starter begins with actual customers, approved quotes and production jobs empty. Enter your current operator name before saving operational changes.

## Complete shop workflow

1. **Customers:** add the actual customer reference, name and published or supplied contact details. Keep stable customer IDs. Notes remain in the working project.
2. **Tariffs:** inspect the full screen-printing and embroidery quantity matrices, additional-thousand stitch rates, all selected charges, rush ranges and whole-order thresholds. Published decoration is priced per piece and location. Garment cost remains separate. A month-precision source date remains a month. Copy a tariff to make a new complete edition; earlier quotes retain their original rates and decisions.
3. **Estimate:** select the actual customer and price edition. Add garment lines with descriptions, colors and explicit supplied unit prices, then size references and quantities. For customer-supplied garments, enter an explicit zero price. An empty price remains unresolved.
4. Add each actual artwork/location as its own decoration batch. Select the garment lines in that batch. The engine calculates the applicable quantity band from those actual pieces. Pooling several lines requires the operator's common-artwork/color explanation.
5. Screen work needs its actual ink-color count, underbase decision and new/reorder setup note. Embroidery needs its actual stitch count, any fractional/whole-block additional-thousand decision and the digitizing explanation. Add each selected setup, digitizing or other charge with its actual count and scope. Use an approved custom unit price for an unlisted combination, custom method or source threshold requiring one.
6. Select a rush tier only after its actual approval. Retain its charge base and explanation, because published ranges overlap. Enter actual shipping, discount and tax treatment, including explicit zero where appropriate. A separate taxable amount is available when the whole amount is not taxable.
7. Calculate the complete estimate. Resolve each displayed item, then use a new quote reference to approve it. Editing an input clears the prior result. The approved quote freezes the entire request, calculated rows, tariff, original customer details, approving operator and time.
8. **Approved quotes:** open the whole retained quotation, download its readable HTML, or start a new revision with its predecessor and change reason. Create a production job from the selected approved quotation.
9. **Production jobs:** give the job its actual reference and confirmed completion date. Receive goods against the original garment and size references, recording rejected quantities and receiving source. Record the original artwork, actual version, decision and approval reference.
10. Move the job from intake to scheduled and printing when usable goods and current artwork approvals are available. Record actual production quantities. Spoilage identifies raw, printed or finished goods. Replacement receipts and reprints preserve the losses and complete the original requirement. Rework identifies printed or finished goods and records work on existing pieces.
11. Move to finishing and ready as the actual job advances. Record collection or shipping against each quoted garment size and the original dispatch reference. Dispatch stays within the surviving finished, usable and ordered quantities. Close as collected after all required goods have been dispatched.
12. Retain all actual production entries and source references in the job history. A later artwork change is recorded against its original artwork identity and current approval is checked before further production and dispatch.

The job's date is an operator-confirmed commitment. The separate business-day worksheet skips weekends and only the holidays you supply, counting subsequent business days after its starting date. The published turnaround starts after actual goods receipt and artwork approval; the worksheet supports that decision.

## Save, reopen and continue

**Save project** downloads the complete Working_Record.json, including unfinished forms. **Save offline app** retains that exact working record and full runtime in a single HTML file. **Download whole ZIP** includes all 18 operational exports, the offline application, complete generic source modules and both operating/API guides.

Extract the entire ZIP into one directory. Open Print_Production_Workbench.html and use Open project to receive an independently saved working record. Each retained approved quotation is checked before editing continues. The original customer, garment, artwork, price and job IDs stay intact. Earlier quotations remain available after tariff changes.

Use **Download quote HTML** for a complete readable quotation and **Download job handover** for the quotation, current goods/production quantities and complete retained job event history. The CSVs provide operational tables. Full JSON and HTML retain the editable history and unfinished entries.

Page-hosted copies use the available widget state for the current record. Download the full project to move or preserve a working copy independently of the host.

## Source decisions

The source catalogue contains the shop's published tariff and its existing quote calculator. Keep the source's exact quantity bands and additional charges. An existing calculator remains an existing product; the workbench adds the retained internal estimate/intake/production workflow.

The source decisions cover overlapping rush bands, screen/setup count units, additional-stitch rounding, rush calculation basis, detailed versus summary turnaround wording, and artwork/color pooling. Record the actual chosen decision and source explanation. The preparation does not fill unpublished garment prices, shipping, tax, promised capacity or approval references.

## Native use

From the extracted source directory:

```sh
node print_production_workbench_cli.mjs inspect --record ../Working_Record.json
node print_production_workbench_cli.mjs estimate --record ../Working_Record.json --selection /absolute/estimate.json
node print_production_workbench_cli.mjs readiness --record ../Working_Record.json --job ORIGINAL_JOB_ID
node print_production_workbench_cli.mjs apply --record ../Working_Record.json --change /absolute/exact-action.json --out /absolute/new-record.json
node print_production_workbench_cli.mjs build --record ../Working_Record.json --out /absolute/new-directory
```

The API guide specifies the complete action envelopes. Save an action before applying it and resume its original operation ID unchanged after an interruption. The CLI writes a new output file or directory; it retains previous editions.

## View and operate the outgoing product

Open the exact maintained application at desktop and a 390-pixel phone width. Look at the actual rendered screens, including light and dark embedding contexts. Operate the full populated estimate and job, source matrices, empty/error states, project reopening, quote/job HTML and whole ZIP downloads. View the actual screenshots and repair unreadable labels, overflow, cramped controls or broken output in this same application.

The supplied interface uses an explicit neutral root, readable light panels and controls, compact wrapping actions and scrollable matrices. Source-engine execution and file identities support the working flow; actual rendered inspection remains part of the original receiving operation.

## Stock after spoilage and rework

Production shows usable raw stock, printed unfinished stock and finished stock available for dispatch. Record spoilage at its actual stage. Replacement goods must be printed and finished; recording a receipt alone does not replenish finished stock. Rework records effort on existing printed or finished pieces and does not increase inventory. Every print, finish, rework and dispatch action uses the current artwork decision. The retained-spoilage classification panel records a reasoned correction as a new event while preserving the original production entry.

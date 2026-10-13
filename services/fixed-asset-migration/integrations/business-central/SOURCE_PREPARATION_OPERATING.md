# Guided native source preparation

Open the complete Fixed_Asset_Finance_Workspace.html and choose **Prepare native sources**. This is part of the existing fixed-asset and work-order workspace. It uses the same maintained prepareMasterCapture and prepareWorkOrderCapture functions as the original CLI. It makes no supplier request, tenant edit, posting or import.

## Retain the actual input and company context

You can open an existing complete capture JSON, or choose the already-received original response JSON files and enter their recorded request context. Every file is decoded as fatal UTF-8; invalid encoding is rejected. A Unicode BOM and original line endings remain in the retained file. A capture envelope may have a BOM; the original envelope is retained unchanged. Original response bodies must satisfy the maintained converter's JSON contract.

Choose the dataset and its role explicitly: original source or actual returned target. Enter the recorded tenant, environment, native company GUID, collection URL and capture timestamp. The workspace company identifier is an explicit mapping; it is not guessed from the tenant or a company name. State the population, filter and snapshot basis. A terminal page chain proves completion of that selected chain, not a transactionally consistent tenant snapshot.

Responses stay in their selected order. Enter each literal requested URL and recorded HTTP status. Optional request IDs and ETags stay attached to the original source. Move pages earlier/later only to reflect the actual continuation chain; missing pages, repeated URLs/IDs and extra pages are rejected. Individual Dynaway line responses require the original work-order GUID and the individual requested line URLs; they cannot establish a complete order population.

For work-order data, select the original quantity field. Posted-ledger quantities use quantity. Choosing an actual or expected expense LCY line amount requires the original same-company generalLedgerSetup record, its literal record URL/status and the declared currency/source reference. The converter checks the record and currency. Actual expense line cost, expected expense line cost and expected unit cost remain different quantities. It never multiplies a unit cost or replaces a missing amount with zero.

Enter the preparation reviewer and source/selection explanation. No current timestamp is silently substituted for the original capture time.

## Preview the entire selection

**Preview all rows and findings** validates the complete source through the maintained converter. The preview shows the actual population, API cautions, complete mappings and source findings. Choose any output file to inspect all rows, every original/native field or the complete JSON text. CSV search covers all cells; fifty visible rows per page do not limit the exported population. Scroll the table for every column. Download returns the complete selected file.

Fixed-asset and maintenance-asset cards prepare asset mapping plus native-ID and maintenance/fixed-asset crosswalks. They do not establish book balances, financial classification or depreciation history.

Work-order projections preserve additional native fields with their types. Absent, null and empty values stay distinguishable; original numeric spellings and nested fields remain in the source. A posted plan number does not become a work-order header ID. Missing header links and cost values remain findings for the original Work orders and costs workflow. Preparation does not mark those lines reconciled.

Changing source, role, company, population, quantity/cost meaning or reviewer choices invalidates the prior preview and confirmation. Unfinished files and choices travel with **Save working HTML**. Preview again after reopening. Original capture documents remain separate from the edited effective capture metadata.

## Adopt into the existing journals

Confirm review of the source scope, complete rows, mappings and findings, then choose **Adopt originals, source and mapping**.

The application builds a complete candidate with the original engine and work-order actions. It retains every exact response, company record, capture, crosswalk, findings file, manifest and preparation review in Exit files. It imports the canonical CSV and selects the converter's explicit column mapping. The complete candidate must export and independently reopen before it is passed to the existing single browser-storage commit. A validation or capacity failure leaves the current workspace unchanged. The existing storage-conflict recovery preserves both complete versions.

Adoption changes the selected mapping for the chosen source/target role and domain. Earlier sources, mappings, corrections and decisions remain in history. Existing financial attestations may become stale after this source change; review them against their actual new basis. Source findings remain unresolved until the operator records real source evidence or a reviewed correction in the original workflow.

Continue in **Source files / Field mapping** for master data or **Work orders and costs** for cost rows, header references, allocation and returned-target matching. The converter does not create target IDs, supplier posting capabilities, acceptance or missing header records.

## Save, deliver and independently reopen

Save the working HTML and complete workspace JSON. Handover includes all original data, source/mapping/correction journals, preparation context, readable reports and the complete application source tree. The standalone builder binds the operating preparer/UI modules to that source manifest. The receiving application uses those same retained modules, with no CDN, runtime installation or network dependency.

The normal source files remain available individually through Exit files. The saved HTML also retains unfinished preparation choices. A full workspace JSON retains adopted original sources and their journals; it does not substitute for unfinished browser draft state, which belongs in the saved working HTML.

## Continue the existing actual browser course

The maintained run_browser_receiving.mjs now calls runSourcePreparationReceiving in the same original receiving operation. Its independently isolated browser copy exercises both original illustrative captures bundled in the application: the two-page maintenance master and the posted expense example with exact long decimal tokens. These are explicitly illustrative source data, not Port tenant records.

The course operates existing-capture intake, raw-response and company-context intake, scope/quantity controls, full files/findings, explicit adoption, source/mapping journals, complete downloads, complete ZIP/application manifest, and cold-reopened working HTML at desktop and 390 pixels. It preserves the original financial receiving workspace and its existing counts/history. No browser is installed or supplier API queried.

Use the original equipped receiving driver's existing browser/context and output operation. Keep the full actual result, any first product exception, downloaded originals and screenshots. The producing owner must open and LOOK at the actual screens, working application, readable report, source CSV/JSON and extracted handover. An authored driver or a successful source exercise is not a claim that a browser course ran or that the outgoing product was visually inspected.

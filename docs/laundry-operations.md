# Laundry intake, fulfilment and accounts

This application prepares an editable operating record from Easy Laundry's published services and Wash Junkie's published staff workflow. It covers requested collections, actual shop intake, item assessment, reviewed quotations, machine and specialist work, delivery, invoices, recorded payments and complaints. It starts with 47 source tariffs and empty customer and transaction registers.

Open the offline application, review the source choices, then save a working record before entering actual work. The complete handover includes the editor, all source modules, guides, original factual source, every operating export and a file manifest. A browser file remains local until its user chooses to export or share it.

## Establish the source and office choices

The source edition was reviewed on 13 October 2026. Domestic tariffs are labelled April 2026; dry-cleaning and alterations retain the separately published April 2025 edition. A historical effective label is retained as provenance, not silently made current.

| Published item | Operating treatment |
| --- | --- |
| Standard, large and extra-large service wash | Keep the published load category. No kilogram capacity is stated for these labels. |
| Wash, dry and iron | A 5 kg bag is a separate base line; extra kilograms must link to the same item's base line. |
| Ironing | Enter the measured kilograms and the actual counted extras separately. Collars and cuffs are examples, not an automatic rule to count each twice. |
| Duvets | Keep size, filling and wash-only distinctions. Assess the care label before accepting an item. |
| Dry cleaning and alterations | Starting prices require an assessed amount or explicit reviewed tariff choice. Keep the partner's actual reference and expected date. |
| Inner collection/delivery | One combined £3 charge per domestic order. Do not add another return-delivery line. |
| Outer collection/delivery | The published £5 is a ceiling. Enter the actual office-confirmed fee for that address. |
| Domestic minimum | £15 including the single collection/delivery charge; shop drop-off and bespoke commercial arrangements are excluded. |
| Commercial work | Record the actual bespoke price and invoice terms. The source says collection is included. An agreed exception needs an explicit explanation. |

Tax treatment is not stated in the published tariff. The initial settings leave it unresolved. Choose the actual tax treatment, applicable rate and monetary rounding after office review. The engine never treats an unstated VAT basis as an established fact. Monetary amounts are integer minor units; measured quantities retain up to three decimal places. There is no automatic kilogram rounding or inferred load capacity.

The source does not specify whether the domestic minimum is assessed before or after discounts. Select that actual office choice in settings. Any adjustment to reach the minimum is a separate quote amount. It is included in the frozen calculation so staff can explain the charge.

Reviewed tariff decisions preserve the original source rate, amount, URL and qualifiers. Restoring a rate removes the active decision while retaining operation history. A rate change cannot alter an already prepared quotation or invoice.

## Locations and appointment requests

Burbage and Earl Shilton are the two published staffed shops. The head-office address is kept separately. The former Nuneaton shop is marked closed; CV10/CV11 collection coverage remains a coverage area rather than a third shop.

Create the customer and the order's actual intake items. Choose collection or shop drop-off. A shop order must use a staffed shop. For a collection address, choose the office-confirmed delivery zone: the source lists areas, but it provides no exact postcode lookup that would justify assigning a zone automatically.

A requested date or slot is not a confirmed appointment. Save the request, then record how the actual slot was confirmed. Collection and delivery are normally weekdays; the shops are closed on Sunday. An actual exception must have a recorded reason. An appointment can be edited while unfinished; the edit returns it to requested status and needs a fresh confirmation.

The current booking page says payment is not taken at booking and an invoice follows completed work. An older FAQ describes an upfront collection fee. Both source observations remain available; the starter follows the current booking sequence and does not pretend to charge a card or establish an advance payment.

The source only gives free cancellation before collection. Requested or confirmed orders can be cancelled with zero cancellation charge. Once goods have been received, preserve actual work and resolve the remaining service, return and account explicitly.

## Collection, assessment and a frozen quotation

1. Add an active driver and plan the actual route. Each pickup needs its same-order confirmed pickup appointment. Each return needs its same-order confirmed return appointment and an order ready for return.
2. Depart the route at its actual timezone-qualified time. The engine rechecks current order, driver and appointment availability and driver conflicts.
3. Record each stop's actual result. Failed access is a retained outcome; it does not mark goods received or returned. A successful handoff records the receiving person or agreed reference. The handoff retains its appointment and cannot predate actual departure.
4. Complete the route only after recording every stop outcome. The return time cannot predate one of those stops.
5. Assess every received intake item, including items refused for processing. Record actual count, measured weight, condition, care review and acceptance. A refused item needs its reason.
6. Link each quote line to an accepted item in the latest assessment. Select actual service quantities, starting-price amounts and any delivery override. The preview identifies unresolved source choices before a quotation can be prepared.
7. Prepare the complete quote, then record actual customer approval. Starting work, a machine cycle or specialist dispatch rechecks the latest item acceptance.

The calculation freezes the chosen source rate, unit, amount, quantity, discount, delivery charge, minimum adjustment, tax treatment and total. Later settings and tariff changes affect new quotations only. Further work before invoicing requires a new quote ID, an amendment reason and fresh customer approval. An active machine cycle or outstanding specialist job must be completed or received before replacing the scope. Earlier quotes remain intact.

A quote preview is advisory until all issues are resolved and that exact input is prepared. Changing an input requires a fresh preview. Never label an operator-entered assessment, quote approval or customer confirmation as a published source fact.

### October duvet campaign and first-order opt-in

The retained original campaign terms give a 30% discount for duvet laundering from 1 through 31 October 2026, across the published sizes. No code is required. Dry cleaning is excluded, and the campaign cannot be combined with another offer.

Choose the actual eligible quote lines. Delivery is separate and cannot be included as a second discounted service line. The source does not clearly resolve the wash-only column; selecting it requires the office's explicit eligibility note. An out-of-period quote is rejected while that campaign is selected.

The booking page's 20% first-order offer requires actual first-order eligibility and separate optional marketing consent. Neither is inferred from a new customer ID. Select the charge basis explicitly; the customer's laundry order does not imply consent to marketing.

## Work, specialist handling and readiness

A machine register holds the actual machine type, capacity and active status. It is independent of the tariff's unquantified standard/large/extra-large labels. Record actual batch weight, programme and care compatibility. A machine can have one running cycle, and a measured load cannot exceed its recorded capacity. Completing a cycle records the observed result and actual end time.

Specialist work has a separate partner, actual reference, item description, sent date and expected date. The published approximate turnaround is retained in the source; staff enter the real agreed date. The order keeps the specialist job open until actual receipt and returned condition are recorded.

Mark an order ready only after all its active cycles are completed and specialist items are received. Record the actual count and finish review. This action is an operating observation, not a generated quality or hygiene certification.

A completed return changes the order to returned. A requested return slot or planned route does not. A missed stop remains available for a new actual appointment and route.

## Invoice, payments and corrections

Issue one frozen invoice after the work is ready or returned. Enter the actual reference, issue date and due date; the application does not invent net terms. It takes the approved quote's total and source calculation.

Record actual receipts and refunds with their real references and methods. These entries record an existing payment; they do not execute a payment or connect to a bank or processor. A refund can use only an available paid credit balance. Record the approved invoice credit first, then the actual refund.

Corrections preserve original entries. Reverse a mistaken receipt or adjustment and enter its replacement. Charges for additional work require the actual customer agreement; credits retain responsible approval. An adjustment cannot predate its invoice or reduce the invoice total below zero.

Close an order after actual return, a resolved zero balance and resolution of its open complaints. If a later financial correction changes a closed balance, the application returns that order to the returned state for explicit account resolution. A later complaint also reopens administrative handling. The earlier close and all subsequent changes remain in history.

## Complaints and service recovery

Record the actual complaint description and reported time. Select the reviewed outcome: reclean, refund, credit, explanation or another recorded resolution. Keep the decision maker, reason and relevant order, adjustment or payment link.

Linked financial entries must belong to the complaint's order; a reclean order must belong to the same customer. A resolution note alone does not create a refund or mark a separate reclean job done. Perform the actual operating/account action and link its retained record.

Published reporting periods and liability language remain source references for the responsible operator. This application does not determine a customer's legal rights or automatically reject a complaint from elapsed time.

## Original-file customer intake and neutral transfers

The current importer accepts explicitly mapped customer records. Choose original headers for ID, name, customer type, email, phone, address, postcode, invoice terms and note. Supply defaults only where they are intentional. Preview all rows before receiving. Existing customer IDs are skipped; repeated incoming IDs require review. Original text, including leading/trailing whitespace and CRLF, original parsed rows, mapping choices, source digest and per-row decisions are retained.

This is a neutral source-preparation mapping. It does not claim an undocumented Wash Junkie API or database importer. The published 12-column order-tracker layout is supplied as an export using the real recorded orders. Its example customers are illustrative publisher data and are never loaded into the delivered operational starter.

The published tracker columns are: Order ref, Date in, Customer, Phone, Items, Service, Promised, Status, Price, Paid, Outstanding, Notes. Prices and balances use the frozen invoice and subsequent actual account entries. Uninvoiced orders leave these cells blank.

The engine supplies 28 exports: complete working record, factual source, change history, settings, original imports and mappings, published alternatives and issues, every quotation, tariffs, operating register CSVs, invoice balances, source index and the published order-tracker layout. Save the full working record whenever you need complete reopening; CSVs serve reviewed interchange and do not replace the full history.

## Reopen and retained change history

Every mutation records its operation ID, operator, timestamp, request identity and the actual changed values. Reusing an identical operation ID is idempotent; reusing it for different input is rejected. History stores changed records rather than repeated complete workspace snapshots.

Open a saved working record through the application or CLI. Source integrity, schema, register identities and history length are validated. Source facts remain in their original edition. The JSON record can include personal customer details once used; share it only with the intended business operators.

The initial delivered record has zero actual customers, orders, appointments, assessments, quotes, machine cycles, routes, invoices, payments and complaints. Separate implementation exercises are not seeded customer work.

## Engine contract

The UMD engine requires the maintained SHA256 module. The browser global is LaundryOperations and its dependency is LaundryOperationsHash. Node uses the sibling connected_sha256.cjs.

- create(source), validate(record), catalogue(record), summary(record).
- quote(record, input) returns a complete/issue preview and the full calculation.
- orderView(record, orderId) joins the current order, customer, latest assessment, all quotes, appointments, work, handoffs, invoice, balance and complaints.
- transferFields('customers') returns explicit mapping descriptors.
- previewImport(record, input) returns rows, errors, created and skipped counts.
- apply(record, {id, type, input, actor, at}) returns a new immutable record.
- exportFiles(record) returns complete {name, content, media_type} files.

The source edition travels with each record. Generated imports and operating outputs identify source observations and operator decisions separately. Original publisher HTML is retained in the private research programme; the code and customer package contain source-linked facts and concise operational wording.

## Publisher source references

- Domestic and specialist tariffs: https://easylaundry.com/services
- Current booking and consent flow: https://easylaundry.com/book-now
- Service terms: https://easylaundry.com/terms
- Branches and contact: https://easylaundry.com/contact
- FAQ and its alternative payment statement: https://easylaundry.com/faq
- Collection coverage: https://easylaundry.com/collection-delivery
- Ironing: https://easylaundry.com/ironing-service
- Complete dated duvet campaign: https://easylaundry.com/duvet-cleaning
- Commercial enquiries: https://easylaundry.com/commercial-laundry
- Wash Junkie staff product: https://washjunkie.com/
- Published product boundaries: https://washjunkie.com/what-wash-junkie-does-not-do
- Published tracker: https://washjunkie.com/laundry-order-tracking-template.csv

## Maintainer: inspect the exact outgoing application

Before customer use, open the exact outgoing application and profile HTMLs in an actual browser, inspect desktop and 390-pixel layouts, and use the important controls. Run the received-item, quotation approval, machine/specialist work, route, invoice/payment, correction, complaint, ZIP download and saved-record reopen journey. Inspect the downloaded application too. Fix visible overflow, unreadable or disabled controls, broken downloads and stale previews in the same original product edition. Retain original inputs and source facts while repairing it.

Source execution and callback operation support implementation review; they do not substitute for looking at the exact rendered outgoing pixels. Keep that browser receiving operation under the original programme and equipped owner.

# Put the complete chosen pack's value in the message

This is an unsent preparation feature in the existing lead fulfillment workflow. It reads the maintained complete customer JSON and a reviewed buyer/offer recipe. It produces readable plain and HTML bodies containing every selected prospect. Complete layout retains all original fields and openings. Concise layout uses one explicitly reviewed, source-bound editorial card per prospect and one or more complete original openings, while the entire original edition remains in the prepared record. The exact original edition text and both output identities are retained for independent reopening.

The first paragraph should already be useful to the buyer: name a real workflow or opportunity, describe the particular comparison or use, and say what the recipient can do now. The complete body carries the chosen pack; the attached files retain the editable table, full source and working record. Read the resulting body as a human before the original authorized sender considers delivery.

## Preserve the chosen service and its economics

The selected customer's exact quantity, currency and price come from the retained edition. The recipe must match them. Current new-prospect work uses the full free five and a distinct later five for USD 20 when that follow-on is appropriate; historical editions retain their actual quantity, price and sends. This code does not rewrite them or require a paid cohort to be researched before a free delivery.

This version composes the lead-pack service using USD cents. It also admits a maintained replacement edition with its recorded economics. Managed outreach, creator programmes, a production workshare and guaranteed customer acquisition are separate scope decisions. The code rejects a managed-service scope instead of silently expanding a pack offer. It does not infer interest, payment, permission to approach listed prospects or agreement to a paid follow-on.

The optional next offer describes future distinct research. It does not create, reserve or bill a second pack. Supply one practical next question and the real sender signature. Keep contact/source qualifications complete, including phone-first records and existing software. Do not invent an email or promise an integration because the product could theoretically support it.

## Existing delivered edition: compose without changing its record

Use the complete exported customer JSON, not an excerpt or a normalized rewrite. Its exact UTF-8 bytes are the source identity.

    node native/compose-message.mjs /absolute/Original_Customer.json /absolute/Message_Recipe.json /absolute/new-message

The output is create-only. Retrying the same original source and recipe at the same output resumes and verifies exact files. A changed source or recipe requires a new output; conflicting originals are preserved. Ownership/recovery state is beside the output, not inside the application source.

Open prepared/message.html and prepared/message.txt. The complete record is prepared/prepared-message.json, with all original edition text and the exact recipe. input/original-message-recipe.json retains the recipe file exactly as read. The output's complete-source.json contains all produced text and the full code required to reopen. Materialize it with the included maintained Python helper, then run the same CLI on its prepared/original-customer-edition.json and input/original-message-recipe.json into a separate directory. Reopened bodies and the prepared record must match.

The output state is PREPARED_UNSENT. This command has no mailbox access and does not create a Gmail draft, send a message or append a delivery event. Existing provider receipts and original customer files remain unchanged. A prepared replacement body for a previously delivered case is internal editorial work, not authority to contact the buyer again.

## Recipe

Use schema lead-value-message.input.v1 and these complete fields:

- prepared_at: actual UTC preparation timestamp.
- edition_sha256: SHA-256 of the exact selected customer JSON UTF-8 file, including its original whitespace and final newline.
- subject: single-line subject.
- buyer: name exactly matching the edition's customer, recipient_name, one published email, company_url, contact_source_url, fit, product_scope, pricing_fit, and sources containing URL plus a factual source note.
- opening: the complete opening, including its greeting if wanted. It should name the useful example immediately. The composer does not prepend a duplicate greeting.
- offer.scope: lead-pack.
- offer.current: quantity, price_minor, currency and description, matching the retained edition.
- offer.next: null, or quantity, price_minor, currency, description, timing and corrections for a separate distinct proposed follow-on.
- next_question: the one next decision you want the buyer to make.
- signature: complete multiline sender/signature text.

Buyer fit, product scope and pricing fit are rendered in complete layout and retained as qualification source in concise layout. Write them for the reader, not as internal source bookkeeping. Buyer source URLs/notes remain in the prepared recipe for review. Each prospect's exact source URL and contact route stay visible. Complete layout additionally shows the original check time, source status and status note. Concise cards retain a reviewed contact qualification; all original fields remain complete in the record and pack.

The source schema is dealscout.lead-pack.v1. Its actual exported fields are contact_route, business_need and why_it_fits. They are not the internal lead-record field names. Both layouts include every lead from the selected edition; there is no omit or first-five switch. Original source order is preserved. Empty original person/status fields are allowed and do not cause an invented contact name.

### Concise layout with source-bound editorial cards

Omitting layout retains the original complete behavior. For a concise body, set recipe.layout to {mode:'concise',cards:[...],opening_indices:[0]}. Supply one card in exact original source order: {index,lead_sha256,observed_workflow,product_use,contact_qualification}. The three texts are complete operator-authored summaries, never automatic truncation. lead_sha256 is the maintained SHA of canonical sorted-key original lead JSON; use composer.sourceBindings(editionText) to obtain every original index and digest. Any changed/reordered/omitted card is rejected.

Select at least one distinct original opening index. The entire chosen opening is rendered without editing. Every other complete original opening remains in original_edition_text and the existing full pack. Names, contact routes and source URLs always come directly from the exact original edition. The concise body shows the opening, all cards, selected complete opening(s), the current/next offer once, next question and signature. Its recipe still retains buyer source/pricing qualification, so those facts can be checked without copying internal status labels into a sales message.

The composer checks syntax and binding. It cannot establish that a public page still publishes a contact, that a pricing assertion is correct, that the recipient wants the service or that a source was recently read. Those facts come from the retained original case and current source review. Changing a buyer claim requires an updated recipe and a new prepared result.

## Preparing a new whole cohort

The existing prepare-cohort.mjs still accepts its original request unchanged. It now copies the existing message-receipt.cjs dependency required by delivery-recorder.cjs, plus the complete composer/CLI/guide.

After inspecting the complete generated edition, add an optional message selection to the same preparation request:

    "message": {
      "edition": "sample",
      "recipe": { "...": "the complete reviewed recipe above" }
    }

Select sample or paid from editions actually present in that request. The recipe's source digest must match the exact generated customer/<edition>.json. Retain the original preparation timestamp/configuration when adding message preparation, and publish to a new output directory. Alternatively run compose-message.mjs directly on the already-generated edition. An absent message field produces the original customer documents and core operations unchanged.

The complete new cohort source then includes message/message.txt, message/message.html, message/prepared-message.json, message/message-recipe.json and message/original-customer-edition.json. The full original preparation input is retained. Customer JSON/HTML/CSV/Markdown and their original ZIP remain separate, unchanged outputs. Normal reopen-cohort continues to verify the original core and deliveries.

## Maintained package API

The pure source is tools/revenue_owner_console_20261010/lead_value_message_core.cjs in Commons; the portable cohort carries it under runtime/ with the same body.

    const composer = createLeadValueMessage({sha256Utf8});
    const record = composer.compose({editionText, recipe});
    composer.receive(record);
    const completeFiles = composer.files(record);

Use the existing host/connected_sha256.cjs function. compose and receive are deterministic and do no I/O. receive recomposes both human bodies from the exact original edition and recipe, then compares the entire record. Altered bodies, source, quantity, price or recipe cannot masquerade as the reviewed preparation.

The existing lead_customer_mail.mjs adds leadCustomerValueMessage(prepared,{recipe,memberName:'leads.json'}) over the original complete package. It checks the immutable package's original customer JSON hash and matching customer/economics. Existing export dispatch also accepts customer-value-message, customer-value-message-text and customer-value-message-html with messageRecipe. Existing attachment/ZIP formats remain unchanged.

## Receiving and source review

The meaningful receiving case is an explicitly unsent re-composition of a retained, previously delivered full five. Verify every exact original opening, phone/email route, existing-system qualification and original source field in both human formats. Verify the selected free economics and distinct optional next offer. Independently receive the prepared record; alter a source byte, offer amount or output body and confirm rejection.

Run the actual existing cohort preparation with and without message, verify identical original customer files/core record, and verify message-receipt.cjs is present alongside its recorder. Exercise same-output continuation through the existing publication helper. No new sender or second delivery controller is introduced.

Warm replies follow the current account's designated relationship owner. New sales correspondence follows the current sending-account direction and the original sender's current history/readiness checks. This preparation feature does not impose a mailbox quota, create a campaign or replace actual provider evidence.


## Complimentary full editions and singular wording

The composer accepts the core's existing `complimentary` delivery type with its exact recorded quantity and zero price. The original sample or previous edition is included through the fulfilment core's explicit `include_edition_ids` contract; composition does not bypass duplicate checks or create a new delivery. A nonzero current price for a complimentary edition is rejected. All exact edition bytes, source-bound cards and original openings remain retained.

New messages use rendering version4, which says `1 complete profile` for a singular edition and keeps plural wording for larger packs. Receiving retains versions1,2,3 and4; earlier prepared records and their original bodies are unchanged. Complimentary admission does not change render output for previously supported edition types.

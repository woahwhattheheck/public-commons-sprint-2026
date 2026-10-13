# Register migration: complete delivery and receiving

## One application and one editable workspace

Use the complete maintained Migration Workbench. The register interface is mounted in its ordinary navigation. The CLI, SQLite store, original source objects, operation history, readable reports and portable ZIP all use the same original workspace.

The current application profile is commons.migration-workbench-application/v4. Its complete 48-file roster includes the original file migration, case, grant, financial reporting and property applications, plus the register domain, mounted operator interface, guides, receiver and authored operating example. The portable module declares the exact list. It still accepts complete earlier 16-, 21-, 24-, 31- and 39-file editions under their original profiles. An already captured delivery retains its original roster.

A delivery includes its complete SQLite snapshot, every retained source object, original completed historical delivery archives, every selected application file, and the complete readable and machine-readable reports. It does not depend on another checkout or an external service to restore the local working copy.

## Native operator commands

Run commands from the complete application directory with Python 3.10 or newer. The implementation uses the Python standard library and SQLite.

    python3 migration_cli.py --workspace /absolute/workspace register schema
    python3 migration_cli.py --workspace /absolute/workspace register list dataset --offset 0 --limit 100
    python3 migration_cli.py --workspace /absolute/workspace register preview --payload /absolute/projection.json
    python3 migration_cli.py --workspace /absolute/workspace register create dataset --payload /absolute/reviewed-request.json
    python3 migration_cli.py --workspace /absolute/workspace register get rehearsal REHEARSAL_ID
    python3 migration_cli.py --workspace /absolute/workspace register compare BEFORE_ID AFTER_ID --offset 0 --limit 100

Every mutating payload includes its original operation_id, expected_revision and actor. Use the advertised schema for the complete business payload. A compare or list command returns one explicitly selected page; continue until offset reaches total. Read a complete original row through the ordinary row.get operation. The generic command entrypoint can invoke every advertised register read and mutation.

For complete exports:

    python3 migration_cli.py --workspace /absolute/workspace export register.dataset DATASET_ID --format ndjson --out /absolute/dataset.ndjson
    python3 migration_cli.py --workspace /absolute/workspace export register.rehearsal REHEARSAL_ID --format csv --out /absolute/rehearsal.csv
    python3 migration_cli.py --workspace /absolute/workspace report --expected-revision REVISION --out /absolute/review-directory

The existing create-only output publisher retains complete exact-byte replay and preserves interrupted prefixes. The report includes the complete register catalogue, full selected result exports, immutable mapping and review descriptors, original source references, and a readable register-review.html alongside the original review. Open the HTML and its linked full CSV/NDJSON files.

Prepare and download an entire editable delivery:

    python3 migration_cli.py --workspace /absolute/workspace prepare-delivery --operation-id ORIGINAL_ID --expected-revision REVISION --actor "Operator" --title "Reviewed migration handover"
    python3 migration_cli.py --workspace /absolute/workspace delivery-file DELIVERY_ID --out /absolute/complete-delivery.zip
    python3 migration_cli.py inspect-delivery /absolute/complete-delivery.zip
    python3 migration_cli.py receive /absolute/complete-delivery.zip --into /absolute/new-recipient

The resulting application is under new-recipient/application and its editable workspace under new-recipient/workspace. Launch migration_server.py from that application with the received workspace. Receiving the same older archive into the same already completed destination preserves later customer edits.

## Full receiving programme

register_receiving.py uses the original maintained Receiving implementation through an explicit register profile. Case and grant receiving retain their original schema, action names and meaning. It runs ten ordered phases:

1. Retain the exact selected original input and complete source files.
2. Execute or replay the supplied original source, typed mapping, plan, rehearsal, review and cutover actions.
3. Produce the complete readable reports and full machine-readable populations.
4. Capture and download the complete original producer delivery.
5. Receive that delivery independently as an editable customer workspace.
6. Apply the customer's actual supplied continuation actions and compare both selected rehearsals completely.
7. Re-receive the original older archive and confirm that later customer edits remain.
8. Prepare the complete customer return, including the original history and source closure.
9. Receive the return independently, read every retained edition and verify both producer and customer operation histories.
10. Replay the exact original requests and confirm the later workspace head remains intact.

The programme owns its original kernel lock and workspace lifetimes, retains full accepted requests before transport, and resumes its original output directory. It does not start child processes or make target-system calls. Source and runtime selection are checked again on each invocation. A completed operation can reopen and verify its original history without replacing later legitimate edits.

Run it with:

    python3 register_receiving.py --input /absolute/register-input.json --out /absolute/private-original-operation

Keep the output directory private. Supply complete JSON with schema commons.register-migration-receiving/v1 and these fields:

| Field | Meaning |
| --- | --- |
| operation_id | Stable ID for this complete receiving programme, up to 80 characters. |
| title, actor, authorization | Actual title, attributed operator and scope of the supplied programme. |
| workspace | Original absolute path, exact id and reviewed expected_revision. |
| application | Every current APPLICATION_FILES entry, in declared order, with path, bytes and sha256. |
| source_files | Complete files with unique key, absolute path, filename, bytes and sha256. |
| steps | Complete producer actions in dependency order. |
| customer_steps | Complete recipient actions in dependency order. |
| comparison | before_id and after_id selecting two distinct retained rehearsal editions. |
| delivery_resume_reason | Original reason used if an interrupted delivery must continue. |

Each action has a unique key in its lane, original operation_id, operation and payload. Its optional resume_reason permits the original interrupted action to continue using that retained reason. Payloads exclude operation_id, expected_revision and actor; the receiving engine records the original envelope before the action begins. The allowed actions are source.import, the five register create operations, and workspace.update.

Results can be referenced by an exact JSON pointer:

    {"$result":"producer:first-plan","pointer":"/id"}

Complete retained file identity can be selected as:

    {"$file":"original-source","field":"sha256"}

The other supported file fields are bytes and filename. References retain their complete original values; do not substitute summaries or partial populations. Producer and customer actions have distinct result namespaces. All operation IDs must remain distinct, including generated delivery and continuation controls.

The complete programme requires an actual dataset, plan, rehearsal, review and cutover edition. It compares every selected result page. Register comparison identities include kind, register and logical key, so identical text keys in different registers remain independent.

## Authored seven-register example

The included executable example provides a complete runnable programme using its own explicit local data and conventions:

    python3 register_reference_example.py --directory /absolute/private-register-example

It covers people, episodes, relationships, signed finance, document-version metadata, workflow and access records. The exact textual IDs 001 and 01 remain distinct. Dates, offset-bearing timestamps, booleans, nested JSON and exact decimals are mapped explicitly. Relationship checks link episodes to people and the other registers to episodes.

The first independent local target contains a 5 GBP refund difference and a workflow-owner difference. The second edition corrects both and adds a new person, episode, financial occurrence and workflow. Controls retain separate GBP/USD and period/category populations. The example records the first rework decision and hold, the corrected second review, a recipient successor review and recipient cutover, full reports, producer delivery, customer edits, customer return and independent reopening.

EXAMPLE.json records the exact authored scope and publication time. Document rows are authored inventory metadata. Role rows are authored access descriptions. The example defines no external supplier columns, interval-overlap policy, document-store upload or target permission change.

Every created source file, original request, accepted result and complete receiving input is retained in the same directory. Reusing that directory continues or replays the same original programme. Choose a new directory for a genuinely different example edition. Open receiving/COMPLETE.json for the ten-phase result and receiving/reports for the readable complete review.

This source is an executable operating example. Its native completion and browser appearance are assessed from the actual run and outgoing interface.

## Review the outgoing application

Before presenting the outgoing application or its attachments, open and operate that exact version and look at its actual rendered screens. Capture and view the real wide and narrow screenshots, open every recipient-facing report/export, and repair any unreadable or broken result. This is the owner's existing product-inspection requirement; source review alone does not describe the delivered visual experience.

Start the complete installed migration_server.py against the selected workspace. Inspect the ordinary case, financial, property and register navigation. Open Registers, create or reopen an exact field mapping, preview all rows across multiple pages, and inspect original source occurrences. Open the relationship and financial controls; check their exact register, field, currency and period selections.

Read the first and second rehearsals, filter findings, compare the editions, open a complete original finding and create its successor review. Check that supporting original row IDs remain in the successor form. Read the selected cutover, its unresolved findings and attributed acceptance.

Exercise the actual download links for a complete export, browser working file and portable ZIP. Reopen the working file and customer delivery, preserving unsent form values and original pending requests. Inspect the report and interface at wide and narrow viewport widths; headings, controls, tables and keyboard navigation must remain readable and usable. Record the actual browser and native results with the original programme.


## Complete authored register browser receiving

Run the complete current source roster, including register_browser_receiving.py and register_browser_receiving.mjs. First complete the original two-edition native course:

    python3 register_reference_example.py --directory /absolute/private-register-example

Then select the actual installed runtimes and run the browser receiver:

    python3 register_browser_receiving.py \
      --reference /absolute/private-register-example \
      --out /absolute/private-register-browser \
      --operation-id register-authored-browser \
      --node /absolute/node \
      --playwright /absolute/playwright/index.js \
      --chromium /absolute/chrome-headless-shell

The original native programme must be COMPLETE with all ten stages, actual closed workspaces, and the same whole application manifest. The browser receiver adopts its complete customer-return ZIP into its own private customer workspace, retaining its original project identity. It freezes that complete report/archive, every application file and actual Python/Node/Playwright/browser entrypoint identity before starting the original server.

One inherited native operation lease spans the server, browser, actual close, full artifact verification and portable return reopening. The supervisor retains direct Popen owners immediately; adopted descendants use the reviewed namespace/start-identity/pidfd primitive, and ECHILD is the final empty-owner proof. The original listener port and persistent browser profile survive same-operation continuation. Keep the same source, runtime, input and output directory on retry.

The six complete browser phases exercise the mounted operator: exact source mapping and preview; full working-file download/reopen with its unsent note; seven-register destination/relationship/control plan; independent target reconciliation and two-edition comparison; predecessor evidence-preserving review and attributed cutover; complete CSV/NDJSON/working-file/ZIP downloads; wide and narrow layouts followed by original project reopening. Every mutation is captured before transport with its exact original request ID. An interrupted request is recovered with that same body; a new request is never substituted for an unresolved original. Phase checkpoints retain all screenshots, source/result pages and downloads.

The outgoing ZIP is compared to its complete native delivery receipt, received into a separate browser-return workspace, and each actual browser-created register operation is reopened there. The complete original native course and its earlier producer/customer/returned workspaces remain separately retained.

A completed retry verifies all selected hashes, all original operation receipts and the received return without starting another server or browser. The supervisor reports COMPLETE only after actual context closure and all owned child/workspace closure. Failed attempts preserve their full log and error in their exact attempt directory.

Open the actual wide/narrow screenshots and inspect the controls, wrapping, tables and downloaded reports. Attach those captured images to the original project delivery together with the complete receiving result and editable return; an automated viewport receipt alone is not visual approval.

This is an authored software commissioning course. Actual customer exports, identities, cutoffs, financial conventions and acceptance authority are selected through the same product when supplied by the original case owner.

The first completion and every completed adoption use the same complete validation: exact original ten-phase input/source/phase receipts; six ordered browser phases and all six exact operation bodies/results; complete report and artifact hashes; original project history; complete native delivery and independently received return receipt. A cleanup error takes the same terminal failure path on both first run and adoption. Server stop, descendant drain, workspace closure and log synchronization are independently attempted; the inherited lease remains owned until the actual descendant drain reaches ECHILD.

Each screenshot and download is fully hashed from its original regular-file descriptor, fsynced with its parent directory, and rechecked against its unchanged descriptor and path identity before its receipt is published. Complete CSV and NDJSON exports are compared to the selected descriptor and every ordered original finding. Accepted operations whose response did not reach the page are reconciled through the mounted original pending-request control before another mutation.

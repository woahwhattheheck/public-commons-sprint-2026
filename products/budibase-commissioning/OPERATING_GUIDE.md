# Budibase commissioning programme

## Customer outcome

Receive an existing low-code application, agree and perform its required implementation changes, configure its target services and roles, operate the real customer process with an independent reviewer, and deliver a complete source and operating handover. The browser app and Node CLI share the same commissioning engine. They do not alter or publish a Budibase installation automatically.

The original archives and all revision records remain in the saved project. The selected live configuration determines the displayed inventory and suggested operating cases. Later corrections add new observations and plans; accepted editions keep the exact operating results originally accepted.

## Open the programme

Open index.html in a current desktop or mobile browser. The app is self-contained and makes no network requests. Browser storage uses IndexedDB. Keep downloaded projects in approved customer storage and download a full project after significant work. Browser storage alone is not a backup.

Select New project and enter the actual customer or workstream. Receive the original export, or use an included official template to learn the flow. The three official sources are copied from Budibase commit ce17c2e58d05dd8df4073826106445fa653fc7ea. Sample data remains labelled as sample data; it is never presented as a deployed customer workflow.

The archive password is used for the current in-memory read and cleared from the input. Source exports themselves may contain confidential data or configuration; protect all project/handover files accordingly.

## Original source routes

Current workspace exports are gzip-compressed TAR archives containing root db.txt, optional global.txt and original attachment/object-store files. The database is newline-delimited PouchDB JSON. Complete original members and source bytes are retained. Password-protected regular files use the pinned Budibase encryption format; the programme derives the key locally and decrypts only for inspection.

Project packages are a different archive contract. The root manifest declares formatVersion 1 and artifactType project. The programme reads project.json, dependency-index.json and the complete supported docs directory. Budibase's native project importer creates new destination IDs and changes activation/default state; inspect and operate that actual destination before acceptance.

The included agency-client-portal and expense-approval TARs are legacy catalogue templates. Their database is nested under template-name/db/dump.txt. The programme's Extract original legacy database button downloads that original plaintext database unchanged for the native legacy import route. Uploading the catalogue TAR as if it were a current root-db.txt workspace archive is incorrect.

The Old App plaintext source is the complete official 8,139-byte legacy import fixture. Native migration is performed by the selected Budibase installation. Retain the original export and compare its resulting live configuration and required records.

Archive limits are 64 MiB compressed, 256 MiB expanded, 20,000 members and 24 MiB for the inspected database. TAR names and checksums are checked, and no archive member is executed or extracted to the filesystem by the core inspector. Use a separately provisioned native receiver for larger projects and keep the same complete source identity.

## Revision and scope census

Original PouchDB exports can include multiple records for an ID and tombstones. The programme retains all records, removes known ancestor revisions from the selectable leaf set and chooses a deterministic live inspection view. Multiple retained leaves remain an explicit review decision. The destination's native database is authoritative for its imported result.

Agency sample: 27 original records, 25 unique document IDs, nine selected tombstones and 16 live documents. There are six live screens, two tables and three rows. Expense sample: 91 original records, eight tombstones and 83 live documents; six screens, five automations, four tables and 30 rows.

Configuration comparison uses original document IDs and content, ignoring revision counters and timestamps. It reports additions, removals and changed configuration. Comparing separate workspace identities is explicitly labelled.

## Plan the implementation

Enter the actual installation, destination workspace/new name, native import route, target version, implementation operator and acceptance reviewer. Define the customer business outcome, agreed implementation changes and the recovery procedure, including reconciliation of work performed after the selected backup.

Assign each explicit connector and custom role to an accountable owner. Record the destination/configuration decision and a reference to credentials in the approved secret store. Resolve each source finding with the actual target decision.

Edit the operating-case list for the agreed customer process. Preserve unique IDs and clear expected business results. Suggested cases include complete source receiving, business-data results, a complete correction, independent operator receiving and recovery. Each live screen/query/automation adds its actual operating case.

Save the plan. A new plan is immutable and pinned to one source. Use the retained-plan selector to reopen an earlier plan or prepare a successor from the selected capture. Source/version changes require a corresponding plan.

## Operate and accept

Perform the native import and implementation work in the approved Budibase destination. Configure services and roles. Operate the real records, screens and automations as the intended role. Record the actual operator, outcome, detail and run/ticket/document reference in the programme.

A failed or needs-work result prevents issuing a new accepted edition until a later passing result exists for that same case and saved plan. Correct the implementation, rerun the original process and record the actual replacement result. Earlier outcomes remain visible in project history.

Issue an edition only after all selected cases pass and the named reviewer accepts the result. A later failed observation does not rewrite an already-issued edition's historical report.

## Hand over and independently receive

Select the exact accepted edition and download both its operator report and Complete handover. The complete handover contains every original capture, all plans and observations, the selected original edition and the original source index. Save the full project for continued internal work.

Open the handover in a second browser profile or use CLI receive in a new file. The receiver validates source bytes, plan digests, original accepted case references and the selected report. It can download each original archive again. In the same browser, a received extension is adopted only when the saved earlier source, plans, observations, editions, events and request history are preserved. Older handovers reopen their selected edition while retaining newer local work. Divergent histories require explicit reconciliation using separately saved copies.

Publishing the native Budibase app is a separate target action after configuration and receiving. Existing-workspace import preserves destination identity and existing-table rows according to the pinned importer; it must not be treated as a blind destructive restore.

## Commercial programme

The Commercial section edits the full input model, then calculates staffing, milestone invoices, collection timing, daily cash, capacity, care and referral scenarios. Default offer: USD 9,600, 80 hours, 20 business days. Scope covers implementation, independent receiving, adoption and complete handover.

The internal model includes costs, reserve and sensitivity. A saved commissioning plan carries only the customer fee/currency/scope selection; internal cost and margin inputs are kept in the separate commercial calculation. Platform subscriptions remain separate. Referral income is zero by default and must satisfy the actual appointment and qualifying subscription terms.

Read commercial/BUDIBASE_COMMERCIAL_WORKSHARE.md for the full workshare and assumptions.

## Source and maintenance

Download programme exports every source file, the standalone app, official fixtures, Node CLI, operating guide and commercial model. Node build.mjs rebuilds index.html from the complete source packet using builtin gzip. No dependency installation is required for the normal CLI or build.

The original upstream contract is:
https://github.com/Budibase/budibase/tree/ce17c2e58d05dd8df4073826106445fa653fc7ea

Official product documentation:
https://docs.budibase.com/docs/export-and-import-apps
https://budibase.com/partners/
https://budibase.com/partner-terms/

Budibase fixture licensing is retained in UPSTREAM_LICENSE.txt. The commissioning implementation is separate product code; the original fixtures retain upstream notices.

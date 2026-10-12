# Supplier order desk: customer operating guide

Use the supplier order desk to receive complete openTRANS 1.0 orders, review what
each original line requires, prepare confirmations, dispatch notifications and
invoices, and hand the complete working history to another operator. The browser,
command line and configured merchant client use the same workspace.

Start with **Customer profile** if this is an empty workspace. For an existing
workspace, check its selected profile and supplier before receiving another file.
The profile gives the documents their agreed business meaning; it does not convert
another format into openTRANS or establish a recipient connection.

## 1. Have the right workspace and agreement

Your deployment maintainer supplies the installed runtime, a private workspace
directory and the operator URL. The selected package README contains the complete
prepare, install and run commands. The application requires Node.js 24 or newer
and Python 3; the maintained Linux installer also uses npm, Python 3.11 or newer
and flock. Keep business data outside the installed source directory so a source
upgrade can retain the same customer workspace.

If the command is already installed, start the desk with:

~~~sh
starforge supplier-orders serve --workspace /absolute/path/to/customer-orders --port 0
~~~

Open the exact private URL printed by the command. Its access token grants access
to this workspace. Keep that URL with the intended operator. A later start may
print a different URL; use the new printed URL. Several browser clients can use
that one running host. Close the host before opening a separate command-line or
merchant host for the same workspace.

Agree these items with the customer before selecting the profile or configuring
a live connection:

| Item | What the operator needs |
|---|---|
| Interface | The complete openTRANS 1.0 specification or agreed variation, its revision and original reference. |
| Parties | The supplier account identifier and its PARTY_ID type, buyer, delivery and invoice parties. |
| Documents | Actual complete ORDER, ORDERRESPONSE, DISPATCHNOTIFICATION and INVOICE examples relevant to the agreed flow. |
| Confirmation rules | How partial availability, cancellations, omitted lines and later corrections are represented. |
| Quantities and money | Original units, currency, price quantity, tax fields and any explicit rounding policy. |
| Delivery route | Manual XML delivery, or host-configured HTTPS URLs, authentication, certificates, acknowledgment and non-acceptance rules. |
| Handover | The intended receiving operator, the workspace to receive the package, and any unresolved business or transport questions. |

Use one workspace for one supplier and declared interface. Compatible orders for
that supplier may share the workspace. A combined dispatch or invoice requires
compatible parties and currency. Another supplier or a different profile needs
its own workspace.

The included customer profile and publisher XML are examples for learning and
local verification. They are not a customer's accepted contract. Use the actual
customer declaration and original documents for operational work.

## 2. Understand the five separate actions

| Action | What it records | What to do next |
|---|---|---|
| **Save draft** | A complete editable revision, its source order selection and an operator reason. | Review findings and finish the document. |
| **Prepare XML** | Validated XML for that exact saved revision, with an immutable document and file receipt. | Inspect the prepared document and decide whether it is current. |
| **Select for this order** | The document's contribution to the order's current quantities. | Check the resulting quantities and findings. |
| **Prepare transmission** | The exact prepared XML and a reviewed, host-declared HTTPS channel. | Review the ready delivery record. |
| **Send this document** | One HTTPS POST and its retained transport outcome. | Inspect the outcome and any recipient response. |

Saving or preparing a document does not send it. Selecting it changes the desk's
quantity reconciliation; it does not prove a physical shipment, customer acceptance
or payment. A delivery marked **Acknowledged** records the agreed transport
acknowledgment. Recipient business processing is a separate matter.

## 3. Select the customer profile

Open **Customer profile** before the first business intake. The panel shows the
current rules in a readable overview. Expand **Complete interface settings** to
inspect or edit the entire declaration; an empty editable workspace opens those
settings automatically. Existing workspaces retain the Unite profile they already
use.

Choose **Start from openTRANS rules**, **Start from Unite rules**, or load a
complete reviewed declaration. Complete its title, distinct profile ID, declared
revision and source reference. Select the actual supplier identity priority and
the required recipient rules. Every additional required-field rule needs its
own source reference.

Review the complete declaration, give the reason and select it. The desk retains
the declaration and its hash, selection revision and request history. The declared
interface revision and the workspace selection revision are different: one
identifies the agreement, and the other records selection changes in this workspace.

Profile selection locks once business sources, documents, drafts, transmissions
or received histories exist, including an admitted intake. An invalid source still
has an intake history. Choose the profile before uploading a file; do not use a
later profile change to reinterpret an existing source.

If selection is interrupted, open **Continue saved request** and choose **Reopen
original request**. After a genuine selection conflict, use **Review current
revisions** to compare the current saved declaration with the attempted one and
choose the intended action. Preserve newer unsaved edits when reviewing an older
saved result.

See [the profile reference](PROFILES.md) for the complete field schema, supported
rules, command examples and explicit profile adoption from a customer package.

## 4. Receive the complete original order

In **Receive document / Original XML**, choose the entire original ORDER file.
Keep its filename and record where it came from. The desk hashes and retains the
original bytes; the parsed document is additional working structure.

The first valid original ORDER establishes the supplier and initializes that
order's current selection. In the browser, review the **Current revision** choice
before receiving each document. It defaults to current: a later edition can be
received directly into the current reconciliation by that explicit choice. Choose
history when the file should be retained without replacing the current selection.
Review a correction against the existing order history before receiving it as
current. Keep the complete order number, original line identifiers and any
punctuation or suffixes.

After receiving:

1. Open the order and confirm the supplier, buyer, original order number and date.
2. Compare its lines with the original source: article identifiers, quantities,
   units, prices, currency, delivery dates and parties.
3. Read every error and warning. Open its affected field or original document.
4. Check that the resulting current selection matches the **Current revision**
   choice. A file received as history can be selected later after reviewing the
   order history and giving a reason.

A structural error or unsupported source format needs the correct original file or
a separately implemented source adapter. Missing business information needs the
actual supplier/customer value. Preserve the rejected or incomplete original;
receive a corrected edition rather than editing the retained XML in place.

For local file intake and inspection:

~~~sh
starforge supplier-orders import --workspace /absolute/path/to/customer-orders \
  --input /absolute/path/to/incoming/order.xml --request-id order-intake-001

starforge supplier-orders orders --workspace /absolute/path/to/customer-orders

starforge supplier-orders order --workspace /absolute/path/to/customer-orders \
  --order ACTUAL_ORIGINAL_ORDER_NUMBER
~~~

These command-line imports retain later editions as history unless the import
request explicitly selects otherwise. HTTPS intake also retains later editions as
history. Inspect and select the intended current contribution through the desk or
the original selection command; the first valid ORDER still initializes its order.

The request ID belongs to this exact intake and payload. Keep it for recovery.
Use a new ID for a different intended file or action.

## 5. Review an order before acting

The line view reconciles the documents that are currently selected.

| Value | How to read it |
|---|---|
| Ordered | The quantity in the selected original ORDER line. |
| Confirmed | The latest selected nonnegative confirmation for that line; absence is not an availability confirmation. |
| Cancelled | The current cancellation quantity under the selected profile. |
| Dispatched | The sum of current distinct dispatch documents for the line. |
| Invoiced | The sum of current distinct invoice documents for the line. |
| Remaining | Quantities still to confirm, dispatch or invoice after the corresponding current contributions. |
| Findings | Structural, source-reference, article, unit, currency, quantity, price or recipient-rule issues that need review. |

Older documents remain in history even after their contribution is replaced.
A current document can have errors even when the quantities appear to balance.
**Documents complete** means the selected dispatch and invoice quantities match
the uncancelled order quantity; it does not record payment or external acceptance.

Read technical source paths, exact hashes and raw history when resolving a
specific issue. Keep them with the complete workspace for traceability.

## 6. Prepare an availability confirmation or cancellation

Choose the order and create an ORDERRESPONSE draft. It starts from the complete
selected original order. Review every line and set the actual current availability
or cancellation values; do not treat the initial suggested quantities as a customer
decision.

For the unchanged Unite profile:

- A nonnegative quantity states the current confirmed quantity for that line.
- A negative quantity states the current absolute cancelled quantity.
- The latest selected confirmation for a line replaces its earlier confirmation;
  the desk does not add the same cancellation again.
- A line omitted from a later partial confirmation retains its earlier explicit
  selection.

For example, on an order line of 10 units, a current confirmation of -4 records
4 cancelled units. The other 6 units remain unconfirmed unless there is a positive
availability statement represented by the agreed interface. Repeating -4 does not
cancel another 4 units.

A customer profile may instead reject negative quantities or require every
original order line. Follow the selected declaration and its findings. Keep the
original order and line identifiers, actual supplier reference, dates and other
required output fields. Missing confirmation delivery dates can be warnings under
a profile; read the finding instead of assuming every missing field is optional.

Save the complete draft with a reason, correct output errors and prepare its XML.
Inspect the prepared original and select it when it should become the current
confirmation. A receipt-only response is not a substitute for the agreed
availability/cancellation confirmation.

## 7. Record dispatches and invoices

### Dispatch notification

Create a DISPATCHNOTIFICATION from the intended order or compatible orders. The
draft proposes their remaining quantities. Enter the actual dispatch document ID,
date, quantities and agreed delivery, package, parcel or tracking information.
Keep each original order and line reference.

Separate dispatch document IDs contribute independently. A revised dispatch with
the same business identifier replaces that document's earlier contribution. If a
revision removes an order line or order reference, review the effect on every
affected order.

The selected declaration determines which recipient fields are required. Missing
tracking information can be a warning; missing a native required element is an
output error. Save, review, prepare and select the actual intended dispatch.

### Invoice

Create an INVOICE from the intended order or compatible orders. Enter its actual
invoice identifier and date. Review invoice, buyer and supplier parties, all
original order references and applicable dispatch references.

The draft uses the current commercial source and remaining uninvoiced quantities.
Check the original price amount, currency, price quantity, tax rate and totals.
Values stay exact decimal strings. The desk does not silently convert currencies,
units or tax conventions.

When a recipient requires rounding, choose it explicitly. For example:

~~~json
{"scale": 2, "mode": "half-up", "taxBasis": "line"}
~~~

Supported modes are half-up, half-even and toward-zero. The tax basis is line or
document. Without an explicit policy, exact arithmetic is retained and a value
that cannot be expressed as a finite output decimal needs a decision.

One native invoice item permits one delivery reference. When quantities span
different recorded dispatches, the draft can produce separate invoice lines to
retain those references. Review each portion. An invoice-before-dispatch warning
is not evidence that a shipment occurred.

Save the complete invoice, resolve output errors, prepare its XML and deliberately
select its current contribution.

## 8. Preserve edits and resolve review conflicts

Each saved draft retains its source orders, their revisions and state hashes.
Preparing it rechecks the same selections. If an order, current source branch or
draft changed meanwhile, reopen the intended current selection and compare it with
your working document before saving a new revision.

The browser records a request before dispatch. While it is active, the selected
editor is protected from replacement. After an interrupted response, open
**Continue saved request** and choose **Reopen original request**. If the saved
result predates newer working edits, retain those edits while reviewing the
returned saved revision. **Review current revisions** opens the actual current
records when a conflict requires a new decision.

For command-line recovery:

~~~sh
starforge supplier-orders operation --workspace /absolute/path/to/customer-orders \
  --request-id THE_ORIGINAL_REQUEST_ID
~~~

Check the operation state before consuming its result. A COMPLETE operation may
have completed an inspection or retained a transmission with an unknown outcome;
read the operation kind and its business result as well.

An actual conflict is a new review decision. Preserve the earlier request and
source, inspect the current record, and use a new request ID only for the deliberately
changed action. Do not remove history or edit the workspace database to bypass a
conflict.

## 9. Send through an agreed HTTPS channel

The host configures the channel; the browser selects a declared channel ID and
its reviewed hash. A complete channel identifies the supplier, test or live
environment, document endpoints, authentication references, TLS configuration and
the agreed acknowledgment/non-acceptance rules. A customer profile also needs the
matching profile hash.

A channel marked **Test** still makes a real HTTPS POST to its configured endpoint.
The endpoint owner must provide the actual test connection. Neither a profile nor
a test label creates an account, recipient activation or certification.

Open **EDI deliveries → Configured channels** to check the available choices. If none is
configured, use the agreed manual XML delivery route or ask the deployment maintainer
to configure the connection described in [TRANSPORT.md](TRANSPORT.md).

For an outgoing confirmation, dispatch or invoice:

1. Prepare and inspect the complete XML through the draft workflow.
2. Choose **Prepare transmission** on that prepared document.
3. Review the document, channel, supplier/profile and test/live selection. Record
   the reason and create the ready delivery.
4. Read the returned delivery and choose **Send this document** when this exact transfer should
   occur.
5. Inspect the resulting state, HTTP response and recipient-processing field.

You may select the same prepared document into the order's current quantities
before sending. The transport checks the pinned source branch and permits that
exact single-document selection advance. Other source or draft changes require
review of the intended current XML; cancel an obsolete unsent intent.

| Delivery state | Next action |
|---|---|
| Ready | Review and send once, or cancel the unsent intent. |
| Sending | Reopen the same request; do not start another send. |
| Acknowledged | Inspect the retained transport receipt and any separate recipient response. |
| Rejected | Read the complete response and the agreed non-acceptance rule; an eligible outgoing delivery can be deliberately returned to Ready. |
| Unknown | Obtain the provider's actual result for this exact document before deciding to retry. |
| Not accepted | Provider reconciliation established non-acceptance; a reasoned retry can return it to Ready. |
| Cancelled | The unsent or confirmed unaccepted intent was stopped; its history remains. |
| Receiving / Received | Incoming XML is pending intake or durably retained. Review its source and business findings. |

For an unknown outcome, record the actual provider reference and reason using
**Record provider result**. Bind a retained evidence file and its hash when available. Resolve as
Acknowledged or Not accepted only when the evidence establishes that outcome.
**Prepare another attempt** returns an eligible record to Ready; the separate **Send this document** action performs
the later attempt. The application does not automatically replay possible deliveries.

For inbound HTTPS, a configured success acknowledgment is returned only after the
original ORDER and receiving operation are durable. It confirms retention; the
recipient-processing field can still require review. A retry of the same provider
message and original bytes returns or resumes the same intake.

## 10. Hand the complete workspace to a customer

Use **Customer handover / Export workspace** to retain the complete ZIP. Keep its
file ID, byte length and SHA-256 with the delivery. The package contains original
XML, business parties and prices, all document/draft revisions, current selections,
profile declaration, operations, foreign branches and retained transport/evidence
history. Choose the intended recipient for that complete business record.

At the receiving workspace:

1. Inspect the entire ZIP before merging.
2. Compare its supplier, original workspace identity, profile and file receipt.
3. If the profile matches, receive normally. If it differs, an empty compatible
   workspace can explicitly adopt the incoming declaration with the inspected
   current profile hash and selection revision.
4. Receive the complete package and inspect the result.
5. Reopen representative original orders, current quantities, drafts, histories and
   source files. Continue a local draft and retain the next complete export.

An occupied workspace cannot silently adopt another profile. Its current orders
and later local draft revisions stay current. Incoming divergent or later history
is retained as a foreign branch. Replaying an older package does not roll back
the customer's newer work.

Imported transport history is inspectable but cannot send as its original sender.
The recipient configures its own connection and deliberately prepares a local
delivery when needed. Endpoint configuration and credential values are not
installed from the package.

Local commands for an already compatible receiving workspace are:

~~~sh
starforge supplier-orders export --workspace /absolute/path/to/supplier-orders \
  --request-id customer-handover-001 --out /absolute/path/to/delivery/customer-orders.zip

starforge supplier-orders receive --workspace /absolute/path/to/customer-orders \
  --input /absolute/path/to/delivery/customer-orders.zip \
  --request-id customer-inspection-001 --mode inspect

starforge supplier-orders receive --workspace /absolute/path/to/customer-orders \
  --input /absolute/path/to/delivery/customer-orders.zip \
  --request-id customer-receiving-001 --mode merge
~~~

A different-profile adoption needs the additional explicit request described in
[PROFILES.md](PROFILES.md). Keep inspection and merge as separate intended operations.

## 11. Resume downloads, shutdown and upgrades

Keep the original request ID and payload when reopening an interrupted import,
export or saved action. A changed source is a changed action. Preserve the original
source file or full ZIP and its receipt.

The browser verifies file length and SHA-256. Its streaming save path depends on
browser support; its in-memory fallback is limited to 128 MiB. For larger complete
packages or a retained byte-range continuation, use the installed client and keep
the same download directory, endpoint, workspace alias, file ID and manifest hash.
The client rechecks the prefix and publishes only the complete verified file.

The native limits are 64 MiB for one original XML file and 8 GiB for a complete
workspace ZIP. HTTP transfer activity can continue while bytes progress; a socket
idle for 30 seconds is closed. Parsing or document preparation has its own operation
lifetime, so an idle transfer timeout is not a reason to invent a second write.

Close the operator or merchant alias through its normal command so accepted work
and retained reads can finish. Keep the workspace directory, its original database
and retained files together. Do not replace it with a source installation or delete
a partial operation to force a restart.

For upgrades, prepare a separate runtime from the selected release and retain the
previous one. Stop the old host, inspect the new installation and reopen the same
customer workspace through the selected runtime. The package README explains the
maintained installer and recovery commands.

## 12. What a complete handover records

Give the receiving operator the selected source release and archive receipt,
installation instructions, the full customer package, the agreed profile and
connection instructions, and a short statement of remaining work. Identify:

- The supplier/workspace and intended customer recipient.
- The current profile agreement and selection.
- Current original orders, prepared/current documents and unresolved findings.
- Ready, unknown or disputed deliveries and the actual provider evidence.
- The agreed endpoint owner, activation status and credential-reference setup.
- The actual completed receiving checks and any desktop/phone review still pending.

Source publication, installation readiness, a local integration run and a live
partner acceptance are distinct results. Record only the results actually obtained
for the selected release and customer connection. The desk implements captured
openTRANS 1.0 documents and configured raw-XML HTTPS. SAP IDoc, cXML, AS2, SFTP or
another ERP/interface family needs its separately agreed adapter.

## Reference guides

- [Customer profiles](PROFILES.md): complete declaration schema and explicit package adoption.
- [HTTPS transport](TRANSPORT.md): complete channel, authentication, TLS and acknowledgment configuration.
- [Merchant operator and typed client](../../../../stellar-forge/mcp-merchant-operator/SUPPLIER_ORDERS.md): host setup, all 40 methods, paging and retained downloads.
- [Selected distribution and installer](../../distribution/selections/SUPPLIER_ORDERS.md): exact source archive installation and native commands.

The captured author DTDs and XML examples remain under
`source/openTRANS_1_0_eng/`, and `source/ReadMe.txt` retains the permission notice.
`source/opentrans-source.json` identifies their original bytes. Recipient rule references remain in the selected profile and
the retained Unite source contracts.

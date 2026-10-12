# Supplier order desk

Receive complete openTRANS 1.0 orders, review confirmations, dispatches and
invoices, send through a configured HTTPS connection, and hand the complete
workspace to a customer. The browser, native commands and 40 merchant methods use
the same retained source files, saved revisions and operation journal.

The package includes the customer operating guide:
`source/stellar/scf-starforge-20261009/sf30-seller-sdk/supplier-orders/GUIDE.md`.
In a source checkout, omit the leading `source/`. Start there for daily operation;
this README covers installation, command entry points and the packaged references.

## Install the selected source release

A source archive and a ready runtime are different deliverables. Record the supplied
archive's exact byte length, SHA-256 and source commit. Use the matching maintained
installer source and check its actual readiness result before starting business work.

The supplier application requires Node.js 24 or newer and Python 3. The maintained
Linux installer requires Python 3.11 or newer, npm and flock. It selects the schema
and merchant dependencies declared by this release. XML uses Python's standard
library and the captured local DTDs. Native build tools or matching Node headers
are needed only if the selected dependency installation reports a native build
requirement.

Run the installer from the matching source checkout or a verified unpacked
distribution. Its checkout path is:

~~~text
stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs
~~~

In an unpacked package, that path begins with `source/`. Keep its complete adjacent
source and helpers; the CLI is not a standalone installation script.

Use absolute paths for the archive, runtime and business workspace. The run command
uses the runtime directory as its working directory, so relative business paths
would otherwise refer to that location.

~~~sh
supplier_installer="/absolute/path/to/matching-source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs"
supplier_runtime="/absolute/path/to/supplier-runtime"

node "$supplier_installer" prepare \
  --dir "$supplier_runtime" \
  --archive /absolute/path/to/supplier-orders.tgz \
  --sha256 ACTUAL_SUPPLIED_ARCHIVE_SHA256 \
  --feature schema --feature mcp

node "$supplier_installer" install --dir "$supplier_runtime"

node "$supplier_installer" inspect --dir "$supplier_runtime" --load --source

node "$supplier_installer" run --dir "$supplier_runtime" -- \
  supplier-orders serve --workspace /absolute/path/to/customer-orders --port 0
~~~

Replace the archive hash with its actual 64-character SHA-256. Preparation creates
a new private runtime and retains the verified source in `package/`. Dependencies
are installed beside it in `node_modules/`. Preparation alone does not establish
READY. Installation uses the normal npm registry or the selected existing cache;
inspect its real result and reported errors.

The serving command prints the actual private operator URL. Open that exact URL.
Several browser clients can use one running host. Before starting a separate CLI
or merchant host over the same workspace, close the previous host normally so its
accepted work and retained reads finish. Preserve the customer workspace outside
the runtime's source directory.

### Use the installed command in the examples

If your deployment already exposes the supplied `starforge` entry point, use it.
Otherwise this shell function sends each command through the maintained runtime
launcher and its readiness checks:

~~~sh
starforge() {
  node "$supplier_installer" run --dir "$supplier_runtime" -- "$@"
}
~~~

Keep the two variables above in the same shell. Commands below use absolute example
paths; replace them with the intended customer paths.

### Resume, upgrade and recover an installation

An interrupted dependency install resumes in the same runtime:

~~~sh
node "$supplier_installer" resume --dir "$supplier_runtime"
node "$supplier_installer" inspect --dir "$supplier_runtime" --load --source
~~~

For an existing populated npm cache, use the supported `--offline --cache` options.
A complete retained dependency tree and original lock can instead be checked with
`install --adopt-existing`; that option does not download or invent missing
dependencies. It fails if the selected graph is incomplete.

Prepare an upgrade in a separate runtime and keep the previous one available:

~~~sh
node "$supplier_installer" upgrade \
  --from /absolute/path/to/previous-runtime \
  --dir /absolute/path/to/new-runtime \
  --archive /absolute/path/to/new-supplier-orders.tgz \
  --sha256 ACTUAL_NEW_ARCHIVE_SHA256 \
  --feature schema --feature mcp

node "$supplier_installer" inspect \
  --dir /absolute/path/to/new-runtime --load --source

node "$supplier_installer" compare \
  --before /absolute/path/to/previous-runtime \
  --after /absolute/path/to/new-runtime
~~~

The maintained `recover --from PREVIOUS --dir NEW` command reconstructs an
installation from its retained original selection. It is an installation recovery,
not a customer database restore. Do not delete or replace the original customer
workspace to fix a dependency problem. Keep normal application shutdown and the
actual deployment's stop/start procedure.

### Build from a published checkout

Release maintainers can build this same selected product from the exact checkout:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/path/to/complete-repository \
  --ref ACTUAL_SELECTED_COMMIT \
  --selection supplier-orders \
  --out /absolute/path/to/supplier-orders-release
~~~

Use the returned archive and hash with the installer above. `--resume` continues
the same partially completed build selection. A later source commit is a new release,
not a relabeling of an earlier signed archive.

## Select the customer interface

Open **Customer profile** before the first business intake. The current rules are
readable in the overview; **Complete interface settings** contains the full
declaration and editable settings for an empty workspace.

Keep the actual agreement reference, revision, complete declaration and selection
reason. The declaration records supplier identity priority, supported confirmation
rules, recipient requirements, currencies, units and sourced additional fields.
Selection uses the displayed profile hash and revision. It locks once business
intake/history exists.

Existing workspaces retain the Unite profile. A distinct customer interface uses
its own declared profile. The included `examples/customer-profile.json` is a
labeled local example, not an accepted recipient agreement. SAP IDoc ORDERS05,
cXML or another source family needs its separately agreed adapter.

~~~sh
starforge supplier-orders profile-template --base standard
starforge supplier-orders profile --workspace /absolute/path/to/customer-orders
starforge supplier-orders profile-history --workspace /absolute/path/to/customer-orders
starforge supplier-orders select-profile --workspace /absolute/path/to/customer-orders \
  --request /absolute/path/to/complete-profile-selection.json
~~~

The complete schema and selection/adoption request examples are in
`supplier-orders/PROFILES.md` within the packaged SDK source.

## Receive and review an original order

Import the complete ORDER XML. The first original ORDER establishes the supplier
and initializes the current order. Later XML can be retained as history or selected
for reconciliation through the browser's explicit **Current revision** choice;
review that choice and the current order pins before receiving. Native CLI intake
defaults to history for later editions, and incoming HTTPS also preserves later
editions for operator selection.

Order numbers and original line identifiers remain complete, including punctuation
and suffixes. Review article, unit, supplier, currency, quantity, price, party and
required recipient-field differences against the source. The order view reports
ordered, confirmed, cancelled, dispatched and invoiced quantities, remaining
quantities, current documents and findings.

~~~sh
starforge supplier-orders import --workspace /absolute/path/to/customer-orders \
  --input /absolute/path/to/incoming/order.xml --request-id original-order-intake-001

starforge supplier-orders orders --workspace /absolute/path/to/customer-orders

starforge supplier-orders order --workspace /absolute/path/to/customer-orders \
  --order ACTUAL_ORIGINAL_ORDER_NUMBER
~~~

Keep original inputs and the request ID. Repeating an uncertain request uses its
same payload and ID. A changed original file is a different intended intake.

## Confirm, dispatch and invoice

For the unchanged Unite profile, the latest selected confirmation states a line's
current confirmed quantity or absolute negative cancellation quantity. It replaces
the earlier line contribution; it is not an accumulated cancellation. An omitted
line retains its previous explicit selection. A customer profile may instead
reject negative quantities or require complete confirmation coverage.

Create dispatches from the intended remaining quantities and record the actual
document ID, date, original order/line references and available delivery/parcel
information. Distinct dispatch IDs contribute independently; a revised document
with the same business ID replaces its earlier contribution, including removed
order references.

Create invoices from the intended remaining quantities and current commercial
source. Retain exact price quantity, currency, tax and party fields. Choose rounding
explicitly when required. Separate invoice lines preserve separate original delivery
references where the native DTD permits only one reference per item.

~~~sh
starforge supplier-orders new-draft --workspace /absolute/path/to/customer-orders \
  --kind ORDERRESPONSE --order ACTUAL_ORIGINAL_ORDER_NUMBER

starforge supplier-orders save-draft --workspace /absolute/path/to/customer-orders \
  --request /absolute/path/to/complete-confirmation-request.json

starforge supplier-orders prepare --workspace /absolute/path/to/customer-orders \
  --request /absolute/path/to/prepare-request.json

starforge supplier-orders select --workspace /absolute/path/to/customer-orders \
  --request /absolute/path/to/current-selection-request.json

starforge supplier-orders export-document --workspace /absolute/path/to/customer-orders \
  --id RETURNED_DOCUMENT_RECORD_ID --out /absolute/path/to/delivery/confirmation.xml
~~~

The complete object from `new-draft` includes `orderIds`,
`sourceOrderDocuments`, `orderRevisions`, `orderStateSha256`, `document` and
`roundingPolicy`. Preserve those source fields, edit the document's original
business values, and add one stable `requestId` and a `reason` to the save request.
A later save includes `draftId` and the observed `expectedRevision`. Monetary
and quantity values remain strings.

Preparation takes `requestId`, `draftId` and `expectedRevision`. Check the
operation is COMPLETE before using `result.documentId` or `result.file`.
Selection takes `requestId`, the prepared document record's `id`, a reason,
and `expectedOrderRevisions` from the current workspace.

Saving retains an editable revision. Preparing retains reviewed XML. Selecting
makes it contribute to current quantities. None of these actions sends a message.
Read the customer operating guide for the full review and correction workflow.

## Configured HTTPS and outcome recovery

The host supplies negotiated HTTPS endpoints, authentication environment references,
certificates and exact acknowledgment/non-acceptance rules. The operator selects
that declared channel. A customer profile also needs the matching profile hash.
A channel labeled Test still posts to its configured endpoint.

~~~sh
starforge supplier-orders serve --workspace /absolute/path/to/customer-orders \
  --transport-config /absolute/path/to/supplier-channels.json --https-intake
~~~

In **EDI deliveries → Configured channels**, inspect the setup. From prepared XML,
use **Prepare transmission**, review the ready record and choose **Send this document**.
One Send makes one POST. The complete request, source, response and event history
remain retained.

A completed operation may retain an Acknowledged, Rejected or Unknown transport
outcome. An acknowledgment does not assert order acceptance, shipment, invoice
approval or payment. For Unknown, obtain the provider's actual result, then use
**Record provider result**. **Prepare another attempt** returns an eligible
confirmed-unaccepted delivery to Ready; a separate Send performs the next attempt.

The full channel schema and native `prepare-transmission`, `send-transmission`,
`resolve-transmission`, `retry-transmission` and history examples are in
`supplier-orders/TRANSPORT.md`. No live recipient account or certification is
created by the installation.

## Receive and return a complete customer workspace

~~~sh
starforge supplier-orders export --workspace /absolute/path/to/supplier-orders \
  --request-id supplier-handover-001 --out /absolute/path/to/delivery/customer-orders.zip

starforge supplier-orders receive --workspace /absolute/path/to/customer-orders \
  --input /absolute/path/to/delivery/customer-orders.zip \
  --request-id customer-inspection-001 --mode inspect

starforge supplier-orders receive --workspace /absolute/path/to/customer-orders \
  --input /absolute/path/to/delivery/customer-orders.zip \
  --request-id customer-receiving-001 --mode merge
~~~

The ZIP carries original sources, parties and prices, document/draft revisions,
current selections, the complete profile, operations, foreign branches and transport
history. Inspect the supplier, file receipt and profile before merging.

A matching workspace preserves newer local selections and drafts. A different
profile may be explicitly adopted only into an empty compatible workspace, with
the inspected current profile hash and selection revision; use the full adoption
request in `PROFILES.md`. Profile adoption and business rows commit together.
Replaying an older package does not overwrite later customer work.

Received transmission history cannot send as the original workspace. The customer
uses its own configured channel and deliberate local preparation. Channel secrets
and endpoint configuration are not installed from the package.

Keep the same request ID and complete input for interrupted receiving. Read the
original operation before creating another write:

~~~sh
starforge supplier-orders operation --workspace /absolute/path/to/customer-orders \
  --request-id THE_ORIGINAL_REQUEST_ID
~~~

One XML file supports 64 MiB; a workspace ZIP supports 8 GiB. The browser's
in-memory download fallback is limited to 128 MiB. The installed client supports
complete paged records and retained byte-range download continuation. Transfer
sockets have a 30-second inactivity timeout; preparation and merge retain their
own operation lifetimes.

## Merchant MCP and typed client

The supplier provider exposes 40 methods for profiles, documents, orders, drafts,
prepared XML, complete customer packages, configured transport and retained files.
The host declares workspace and input aliases; tools do not accept arbitrary host
paths or endpoint overrides.

~~~sh
starforge merchant-mcp init-provider supplier-orders \
  --options /absolute/path/to/host-setup.json

starforge merchant-mcp serve \
  --config /absolute/path/to/merchant-host/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN

starforge supplier-order-client --help
~~~

Use the actual setup schema, private connection file and environment from
`source/stellar-forge/mcp-merchant-operator/SUPPLIER_ORDERS.md`. Its complete method
map includes the four profile methods, all transport methods, operation recovery
and retained-file reads. The typed entry points are
`supplier-order-client.mjs` and `supplier-order-client.d.mts`; the public package
export is `./clients/supplier-orders`.

## Packaged guides and original sources

| Guide, relative to the supplier SDK component | Purpose |
|---|---|
| `GUIDE.md` | Complete day-to-day customer workflow and recovery. |
| `PROFILES.md` | Full customer declaration and profile adoption schema. |
| `TRANSPORT.md` | Negotiated HTTPS, credentials, TLS, receipts and retries. |
| `receiving/SUPPLIER_ORDERS_NATIVE.md` | Maintainer's reproducible source/quantity/portable verification program. |

The merchant operator guide is
`source/stellar-forge/mcp-merchant-operator/SUPPLIER_ORDERS.md` in the package.

Original author DTDs and four complete XML examples remain under
`supplier-orders/source/openTRANS_1_0_eng/`; `source/ReadMe.txt` retains the
permission notice and `source/opentrans-source.json` pins the original archive
and members. The native DTD determines XML spelling and structure. For example,
the confirmation date is ORDERRESPONSE_DATE and the dispatch identifier is
DELIVERY_NOTE_ID. Required party/delivery groups differ by document kind.

Recipient rule selections and their references are retained separately in
`source/UNITE_PROFILE_RULES.json` and `source/UNITE_HTTPS_TRANSPORT.json`.
Published references include:

- https://support.unite.eu/en-gb/for-suppliers/edi-interfaces-for-order-processing
- https://support.unite.eu/en-gb/for-suppliers/order-transmission-interface
- https://support.unite.eu/en-gb/for-suppliers/order-confirmation-interface
- https://support.unite.eu/en-gb/for-suppliers/dispatch-notification-interface
- https://support.unite.eu/en-gb/for-suppliers/invoice-interface
- https://unite.eu/assets/support/uk/mercateo-edi-3-3supplier_en.pdf
- https://unite.eu/assets/support/uk/specification_opentrans_v1_0_en-2.pdf

A source release, a READY installation, a completed local receiving program and a
recipient's live acceptance are separate outcomes. Retain the actual reports for
the selected source and customer connection; this README does not assert an
unperformed native or live-partner result.

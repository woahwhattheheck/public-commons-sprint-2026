# Customer supplier profiles

For the daily profile, order, confirmation, dispatch, invoice and handover workflow,
start with the [customer operating guide](GUIDE.md). This reference documents the
complete declaration and its programmatic interfaces.

A supplier workspace retains the complete interface declaration that gives its
original openTRANS 1.0 documents their business meaning. The same declaration is
used by XML intake, current-order reconciliation, working drafts, output preparation,
configured HTTPS channels and complete customer packages. Browser, native CLI and
the typed merchant client operate that same retained selection.

Existing Unite workspaces continue with the original `unite-opentrans-1.0` profile.
Their original source document identities, parser results, implicit configuration
and prior package histories keep their established meaning. A customer declaration
uses a distinct profile ID and is retained in full, with a canonical SHA-256.

This product implements the captured openTRANS 1.0 syntax. Selecting a profile does
not turn an SAP IDoc ORDERS05 or cXML source into openTRANS. Such a customer needs an
adapter based on its actual agreed source specification and complete original
messages. The declaration described here controls supported business rules within
the existing source format.

## Select the interface before receiving business data

Use one private supplier workspace per declared interface and supplier account.
Open **Customer profile** before its first original intake. Its overview shows the
current rules, selection revision and whether selection is still available. Expand
**Complete interface settings** to inspect the full declaration and profile SHA.
The settings open automatically in an empty editable workspace.

Choose **Start from openTRANS rules** or **Start from Unite rules**, or load a
complete reviewed declaration JSON. Fill in the actual interface reference and
revision, original specification URL/hash when available, supplier identity choices
and the agreed document rules. Every rule in the extra required-field array carries
its own source reference. The complete working JSON remains available inside
**Complete interface settings**.

Selecting the declaration retains:

- The entire declaration and its canonical SHA-256.
- The previous profile SHA and expected selection revision.
- One original operation ID, selection time and operator reason.
- The full selection record and its own integrity seal.

The selection can change while that same workspace remains empty of business
sources, documents, drafts, transmissions and received histories. An admitted intake
also blocks selection changes. Once business intake begins, another interface uses
a separate empty workspace. Even an invalid original document remains a source
receipt; it cannot be silently reinterpreted by selecting different rules afterward.

After a lost selection response, open **Continue saved request** and choose
**Reopen original request**. The page reads the same operation before creating
another request. A confirmed conflict offers **Review current revisions**, showing
the actual current selection alongside the earlier complete attempted declaration.
Newer unsaved editor changes remain available when an older saved request is
recovered.

### Original source and customer rule are separate

The XML parser always validates the selected original DTD and scalar grammar.
Required native element order, allowed original attributes, exact NUMBER/COUNT/
INTEGER values and document-specific party/reference placement cannot be disabled
by a customer profile. The full original raw tree and unchanged source bytes stay
with the normalized document.

The declaration then selects the supported recipient rules. A rule can require an
original field, restrict allowed currencies or units, or determine how a confirmation
is interpreted. It cannot run code, rename a native XML element, rewrite identifiers,
convert units or round prices implicitly.

## Full declaration schema

The complete object uses schema
`stellar-forge.supplier-order-profile.v1`. It is limited to 32 KiB of canonical
UTF-8 JSON. Unknown fields, omitted required declaration fields, duplicate list
entries and unsupported options are rejected. Strings are retained as entered;
document identifiers and quantities are never truncated or converted to JavaScript
numbers.

| Field | Meaning |
|---|---|
| `id` | Distinct lowercase ASCII ID, at most 96 characters. The original Unite ID is reserved for its unchanged full declaration. |
| `revision` | Positive integer revision of this declared interface. It is separate from the workspace's selection revision. |
| `title` | Human-readable interface title, at most 240 characters. |
| `format`, `version` | Exactly `openTRANS` and `1.0` for this adapter. |
| `declaration.reference` | Actual agreement, specification or explicitly authored demonstration reference; required, at most 2,000 characters. |
| `declaration.url` | Original HTTP(S) source URL without credentials, or explicit `null`. |
| `declaration.sourceSha256` | Exact original source SHA-256, or explicit `null`. |
| `declaration.notes` | Complete explanatory text, up to 8,000 characters. |
| `orderIdMaximum` | Original order-number limit, from 1 to 250 characters. Unite retains 21. |
| `supplierIdentity.partyIdTypes` | Up to 16 exact supplier PARTY_ID types, in declared priority order. |
| `supplierIdentity.allowUniqueFallback` | Whether an unambiguous original supplier identity may be used if no priority type matches. |
| `supplierIdentity.inheritOrderResponse` | Whether a response without an explicit supplier may inherit only its exact existing original order's supplier identity. |
| `confirmation.negativeQuantity` | `cancel` uses the absolute negative amount as cancelled units; `reject` produces review findings and does not treat the negative quantity as cancellation. |
| `confirmation.omittedLines` | `retain` keeps omitted original line state; `require-complete` additionally requires every original order line in a selected confirmation. |
| `serials.remarks` | `unite-number` derives serials through the established Unite remark convention; `opaque` keeps original remarks without that interpretation. |
| `validation.currencies` | Up to 64 original three-letter currency codes. An empty list adds no recipient-specific currency restriction. |
| `validation.units` | Up to 64 exact original unit strings. An empty list adds no recipient-specific unit restriction. |
| `validation.invoiceTaxRate` | Require the invoice tax-rate field in addition to native arithmetic and structure. |
| `validation.invoiceDeliveryReference` | Require the invoice's original delivery references. |
| `validation.invoiceParties` | Required party roles selected from `buyer`, `supplier`, `invoice`. The DTD's structural requirements still apply. |
| `validation.confirmationDeliveryWarning` | Enable the established missing-confirmation-delivery-date warning. |
| `validation.dispatchTrackingWarning` | Enable the established missing-dispatch-tracking warning. |
| `validation.requiredFields` | At most 32 complete sourced field rules described below. |

Each additional required-field rule has this complete shape:

~~~json
{
  "kinds": ["ORDERRESPONSE"],
  "path": "/header/supplierOrderId",
  "when": "output",
  "severity": "error",
  "message": "Retain the agreed supplier reference before preparing this confirmation.",
  "reference": "Customer interface agreement, selected revision and section"
}
~~~

`kinds` contains actual native document kinds. `when` is `always` or `output`.
An output-only rule allows the incomplete source or working draft to remain readable,
and blocks preparation when the required output value is still missing. `severity`
is `error` or `warning`; the selected source reference is included with findings.

A path is an absolute JSON pointer into `header`, `items`, `summary`,
`documentId`, `orderId`, `kind` or `version`. Use `*` for every member of an
array, such as `/items/*/article/supplierId`. Missing values, `null`, empty strings
and empty arrays produce the declared finding. Pointers cannot target profile
metadata, raw XML or filesystem paths. There is no expression language or script
evaluation.

### Included source-derived example

`examples/customer-profile.json` is a complete, explicitly authored local receiving
declaration. Its ID is `supplier-demo-opentrans-1.0`. It selects the captured
Fraunhofer openTRANS 1.0 corpus, keeps original source supplier identity priority,
rejects negative confirmations, requires all original confirmation lines and adds
one output supplier-reference rule.

Those three additional choices are explicitly labeled as demonstration choices.
Use the actual recipient agreement when preparing an operational declaration;
the example does not establish that recipient's requirements.

## Browser workflow

1. Open the empty supplier workspace and select **Customer profile**.
2. Review the current rules. Expand **Complete interface settings** to start from
   a complete template or load the agreed declaration. Fill all contract fields
   and explain the selection.
3. Select the declaration. Inspect its saved SHA and original selection history.
4. Receive the complete original ORDER XML through **Receive document**. The form
   pins the selected profile SHA, original source hash and provenance. Review
   **Current revision**, which defaults to current. A later edition can enter
   current reconciliation through that explicit choice; choose history to retain
   it without changing the current contribution.
5. Inspect findings, original XML, supplier account and current line quantities.
   Create a complete confirmation, dispatch or invoice from the actual selected
   order revisions.
6. Save the full draft with its reason and source pins. Preparation validates the
   complete outgoing XML against the same retained profile. Correct any errors
   through a new reasoned draft revision.
7. Use a host-declared HTTPS channel with the matching profile SHA, or download the
   full original XML for the agreed manual receiving route.
8. Export the complete workspace and use the customer package flow below.

The profile title and selected revision remain visible in the operator header.
The full declaration remains inspectable in **Complete interface settings** after
the editor locks. Transmission
filters use the actual profile's order-number limit. The customer editor does not
contain endpoint or credential fields; those remain with the host operator.

## Native command line

The installed selection remains `supplier-orders`. The maintained builder and
installer include the entire supplier component, native parser/DTDs, browser assets,
profile example and merchant provider.

~~~sh
starforge supplier-orders profile-template --base standard
starforge supplier-orders profile --workspace /private/supplier-a
starforge supplier-orders profile-history --workspace /private/supplier-a
~~~

The template deliberately has an empty source reference. Complete it from the actual
selected customer interface before attempting selection. Read the current profile
to obtain the expected SHA and selection revision. Save the complete request as
private JSON:

~~~json
{
  "requestId": "customer-profile-selection-001",
  "expectedProfileSha256": "ACTUAL_CURRENT_PROFILE_SHA256",
  "expectedSelectionRevision": 0,
  "profile": {
    "...": "the complete declared profile object"
  },
  "reason": "Selected the reviewed customer interface revision before original intake."
}
~~~

The displayed `profile` member is an explanatory placeholder, not a valid minimal
request. Use the entire template or agreed declaration.

~~~sh
starforge supplier-orders select-profile \
  --workspace /private/supplier-a \
  --request /private/customer-profile-selection.json

starforge supplier-orders import \
  --workspace /private/supplier-a \
  --input /incoming/original-order.xml \
  --request-id customer-original-order-001 \
  --request /private/original-source-metadata.json
~~~

Source metadata can include `expectedProfileSha256` from the current selection,
plus the existing complete provenance, original byte/hash and order-revision pins.
An original request ID is always bound to its full original payload. Reuse it for
recovery; give a changed action a different ID.

Standalone validation can use a complete profile without opening a workspace:

~~~sh
starforge supplier-orders validate \
  --input /incoming/original-order.xml \
  --profile /private/customer-profile.json
~~~

The returned normalized customer document includes its entire profile and
`profileSha256`. The existing native render command accepts that complete document
and applies customer output rules before writing:

~~~sh
starforge supplier-orders render \
  --input /private/complete-native-document.json \
  --out /deliveries/complete-document.xml
~~~

Use workspace draft preparation for output that depends on current order lineage
and fulfilment. It rechecks the exact source order documents, revisions and state
hashes before emitting the reviewed saved draft.

## Typed client and merchant MCP

The configured provider exposes 40 tools. The four additive profile tools share the
same host alias and original workspace lifetime:

| Typed method | MCP suffix | Result |
|---|---|---|
| `profile()` | `profile` | Complete declaration, selection revision/SHA, workspace ID and `canSelect`. |
| `profileTemplate({base})` | `profile_template` | Complete editable standard- or Unite-based customer template. |
| `profileHistory({offset,limit})` | `profile_history` | Paged actual selection/adoption operations, current selection revision/SHA and `nextOffset`. |
| `selectProfile(request)` | `select_profile` | Original journaled operation with its complete `result.profileSelection`. |

All MCP names begin `merchant_supplier_order_`. The ordinary native methods remain
available for documents, drafts, source intake, exact HTTPS transmissions and
retained-file delivery. The typed declarations are published beside the existing
client in `stellar-forge/mcp-merchant-operator/supplier-order-client.d.mts`.

~~~js
// This script is placed at the installed product root.
import { readFile } from 'node:fs/promises';
import { createSupplierOrderClient } from './source/stellar-forge/mcp-merchant-operator/supplier-order-client.mjs';
const completeReviewedDeclaration = JSON.parse(await readFile('/private/customer-profile.json', 'utf8'));

const client = await createSupplierOrderClient({
  url: process.env.MERCHANT_MCP_URL,
  tokenEnv: 'MERCHANT_MCP_TOKEN',
  workspace: 'customer-a'
});
await client.open();
try {
  const current = await client.profile();
  const request = {
    requestId: 'customer-profile-selection-001',
    expectedProfileSha256: current.profileSha256,
    expectedSelectionRevision: current.revision,
    profile: completeReviewedDeclaration,
    reason: 'Selected the agreed original interface before business intake.'
  };
  const operation = await client.selectProfile(request);
  if (operation.state !== 'COMPLETE') throw new Error(JSON.stringify(operation));
  for await (const page of client.pages('profileHistory', { limit: 20 })) {
    for (const saved of page.items) console.log(saved);
  }
} finally {
  await client.close();
}
~~~

The equivalent stable public package export is `./clients/supplier-orders`; use the
actual name in the installed package metadata when importing through that export. Host input aliases still
select exact XML, large draft JSON or customer ZIP files. Tool calls cannot provide
an arbitrary source path, partner URL, authentication value or TLS path.

The MCP response budget remains 1 MiB. Pages can contain fewer records than the
requested limit, and the client follows `nextOffset`. A large original operation
is represented by its retained identity; the full request and result remain in the
native journal and full customer package. A complete profile is bounded to 32 KiB.

## Complete customer package adoption and return

A customer-profile package includes the whole declaration and its SHA in both
manifest and snapshot, plus the sealed original selection when one exists. Every
immutable source document and working draft retains the same profile. Incoming
new immutable documents are parsed again from their original XML under that retained
profile before business merge.

A receiving workspace follows one of two paths:

- If its existing selected profile matches exactly, receive the package normally.
  Existing current orders and drafts keep their later local revisions.
- If it differs, inspect the full package first. Only an empty workspace may
  deliberately adopt the incoming complete profile, using its current profile SHA
  and selection revision as compare-and-swap pins.

In the browser, **Customer handover → Inspect complete package** displays the
incoming source workspace, full declaration, exact file identity and current profile.
The explicit adoption checkbox is enabled only for a different profile, an empty
workspace and a compatible supplier. Inspection is retained as an operation but
does not appear as a profile selection. **Receive complete ZIP** then carries the
selected adoption and its exact pins through the existing merge transaction.

~~~sh
starforge supplier-orders receive \
  --workspace /private/customer-a \
  --input /deliveries/complete-supplier.zip \
  --request-id customer-package-inspection-001 \
  --mode inspect
~~~

Retain the returned `result.profile.currentSha256` and
`result.profile.currentSelectionRevision`. For a deliberate different-profile
adoption, save:

~~~json
{
  "adoptProfile": true,
  "expectedProfileSha256": "ACTUAL_INSPECTED_CURRENT_PROFILE_SHA256",
  "expectedSelectionRevision": 0
}
~~~

Then run the same native merge with its own stable request:

~~~sh
starforge supplier-orders receive \
  --workspace /private/customer-a \
  --input /deliveries/complete-supplier.zip \
  --request-id customer-package-adoption-001 \
  --mode merge \
  --request /private/customer-profile-adoption.json
~~~

With the typed client, use `receiveWorkspace({requestId,inputId,mode:'inspect'})`,
then `receiveWorkspace` with `mode:'merge'`, `adoptProfile:true` and both inspected
pins. All original file length/hash checks remain part of the host input contract.

The profile adoption and original business rows commit together. A failed merge
cannot publish a new customer profile without its receiving transaction. Completed
replay returns the original operation before checking later profile/current-order
state. Old incoming packages retain their original history while preserving newer
local customer work, including local drafts after an ahead-history import.

A different profile does not silently overwrite that customer state. The inspector
returns the mismatch and the receiving operation refuses adoption into an occupied
workspace. The complete source remains available for review and transfer to the
proper workspace.

## Configured HTTPS channels

Use the existing `TRANSPORT.md` configuration and include `profileSha256` at the
channel level when the supplier workspace selects a customer profile:

~~~json
{
  "id": "customer-test",
  "title": "Agreed customer test connection",
  "mode": "test",
  "supplierId": "EXACT_ORIGINAL_SUPPLIER_ID",
  "profileSha256": "ACTUAL_SELECTED_PROFILE_SHA256",
  "agreement": { "reference": "Actual agreed transport contract and revision" },
  "incoming": { "...": "complete existing host intake declaration" },
  "outgoing": { "...": "complete existing host outgoing declaration" }
}
~~~

This illustrates the additional profile field. It is not a complete channel
configuration; use every required field from the transport guide and the real
negotiated URLs, credentials, TLS and acknowledgment contract.

A custom-profile channel without its exact selected pin cannot prepare, send or
receive business documents. Changing a channel's complete declaration changes its
channel SHA, so a previously prepared delivery keeps its original connection
identity. Existing implicit Unite channels retain their prior configuration hash
when this optional field is absent.

The transport journal keeps the full original XML file, profile identity, channel
identity, actual HTTP response/evidence and every transmission event. Imported
customer transport history cannot send through another workspace. The original
local-preparation and prospective-fulfilment checks remain in force. HTTP
acknowledgment and recipient business processing are separate states.

Possible deliveries are never automatically replayed. An interrupted attempt
remains UNKNOWN until actual provider readback or the deliberate supported
resolution/retry sequence establishes what to do. Selecting a customer profile
does not add a live recipient connection, alternate credential source or automatic
outreach.

## Maintainer verification and selected installation

Use the [selected package installation instructions](../../distribution/selections/SUPPLIER_ORDERS.md)
to install an operational desk. The program below verifies product behavior using
complete original examples and earlier receiving reports; it is separate from the
customer's acceptance of an operational connection.

The installed profile receiving export is
`./supplier-orders/profile-receiving`, implemented by
`receiving/supplier-order-profile-native.mjs`. Its entrypoint is
`runSupplierOrderProfileReceiving(options)`.

The full verification chain retains three source selections:

1. The selected earlier release runs its 27-tool operator and complete baseline
   supplier/customer receiving.
2. The configured-HTTPS release runs its 36-tool continuation, including actual
   local TLS, provider/client/browser operations and customer transport histories.
3. The customer-profile release runs the following 40-tool operation using the
   completed earlier reports and separate profile producer/customer workspaces.
   It preserves the publisher XML/DTDs and source selections before applying the
   explicitly authored example profile.

Use the actual reports and their retained artifacts as inputs. Record the source
edition, completed phases, findings and lifetime closure from the returned report.
Publishing this program or installing its source does not establish that the
verification ran. A local TLS result also does not establish activation or
certification of a customer's external endpoint.

The selected source build is:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /path/to/complete-original-repository \
  --ref SELECTED_PUBLIC_COMMIT \
  --selection supplier-orders \
  --out /private/supplier-orders-release
~~~

Use the returned archive and its actual SHA-256 with the maintained installer,
selecting the declared `schema` and `mcp` features. Follow its separate
prepare/install/inspect steps and readiness result. The package includes the
profile module, editor, complete example declaration, captured XML/DTDs and
receiving program.

The application requires Node 24+ and Python 3. The maintained Linux installer also
requires npm, Python 3.11+ and flock. A browser verification run uses an actually
installed Playwright/Chromium pair; place its temporary directory on the selected
operation's available private filesystem. Preserve the chosen source, reports,
operation ID and directories when continuing an interrupted run.

## Scope for a real customer adaptation

An operational installation needs the selected customer's full contract and corpus:
original ORDER plus confirmation, dispatch and invoice examples; their supplier
and buyer identity rules; corrections/cancellation semantics; native field
requirements; current transport endpoints/authentication; acceptance and unknown-
outcome handling; and an agreed customer receiving check.

The existing workspace supplies exact source preservation, durable review/revision
history, complete output and configured HTTPS transport. A source-family adapter
or a mapping into an ERP-specific schema is separately selected implementation work.
The adapter must retain its original foreign document, exact source values and
references alongside the produced native document, with both format declarations
and a source-derived receiving path. No such additional format is claimed by this
profile release.

## Sources and license

The captured original author package is:

https://www.digital.iao.fraunhofer.de/content/dam/iao/ikt/de/documents/openTRANS_1_0_complete_eng.zip

The original archive is 4,161,866 bytes with SHA-256
`baae9ea0e1363f98aa2323570456fdc384423af330ca95fa27e3769075cb521a`.
The unchanged `source/opentrans-source.json` records the actual capture and every
selected DTD/example/notice member. The accompanying `source/ReadMe.txt` retains
the original copyright and permission notice. The profile/editor implementation
and local demonstration declaration are authored product source.

The unchanged Unite default is grounded in the retained source contract
`source/UNITE_PROFILE_RULES.json` and these original interface pages:

- https://support.unite.eu/en-gb/for-suppliers/edi-interfaces-for-order-processing
- https://support.unite.eu/en-gb/for-suppliers/order-transmission-interface
- https://support.unite.eu/en-gb/for-suppliers/order-confirmation-interface
- https://support.unite.eu/en-gb/for-suppliers/dispatch-notification-interface
- https://support.unite.eu/en-gb/for-suppliers/invoice-interface

A customer profile's own references remain explicit in its declaration and findings.
Current HTML guidance and the captured original DTD can use different labels; the
native DTD still controls XML spelling and structure, as documented in the original
source manifest.

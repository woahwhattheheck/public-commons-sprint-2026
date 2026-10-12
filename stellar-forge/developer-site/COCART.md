# CoCart customer setup in the existing Starforge Site

The CoCart page turns a merchant’s saved product profile or a complete existing
customer receiving export into a portable setup package for the original
CoCart managed application. It joins the same Starforge Site, the existing
WooCommerce setup and the maintained merchant runtime.

Customer entry: **/cocart.html**. The original Site project remains
**appgprj_6acba66ca7a08191897b5a8c22611397**. Its publisher must preserve the
current audience and continue the same project and source repository.

## Customer workflow

1. Import **Download saved headless profile** from the original mapped Woo
   product, or import the complete CoCart receiving JSON from the preceding
   operator. The receiving input includes its original workspace and all
   referenced objects.
2. Optionally declare existing Woo handoffs and additional receiving files
   under distinct merchant aliases. For initial profile creation, a separate
   transport JSON can select the actual loopback receiving store and checkout.
3. Choose the real private customer directory, optional SDK entry, merchant
   connection and merchant agent directory.
4. Review the saved product, currency, exact decimal/atomic amounts, route,
   original source bytes and receiving history.
5. Download the complete ZIP. It contains original input bytes, setup.json,
   the source-native runner and a complete installation/operation handover.
6. Run Inspect and Prepare against the selected maintained toolkit. Open the
   original application, or select the same directory in managed Applications.
7. Operate the actual cart and Woo checkout, attach the original handoff,
   export the complete customer workspace, Stop and reopen the same work.

The source-native profile selects CoCart Community 4.9.7, its original v2 API,
and @cocartheadless/sdk 1.2.1. The original CoCart application requires Node 22
or later. The current profile’s checkout comparison selects one mapped simple
virtual product at quantity one with its exact saved total and Stellar terms.
The existing Woo setup also supports its separately maintained basket,
refund and merchant workflows; this page retains the CoCart source’s own
selected contract.

## Complete page and portable package

| Source | Responsibility |
| --- | --- |
| dist/cocart.html | Accessible original-file, host, review and operating steps. |
| dist/cocart.css | Existing industrial typography and neutral palette, including narrow screens. |
| dist/cocart-setup.mjs | File intake, saved draft lifecycle, local review, downloads and command presentation. |
| dist/cocart-onboarding.mjs | Byte-preserving source selection, packet manifest, exact local hashes and complete generated installation guide. |
| dist/cocart-runner.mjs | Portable forwarding to the original managed/native validators, setup, console, receiving export and profile companion. |
| dist/onboarding.mjs | Existing deterministic ZIP writer; imported files remain byte arrays. |
| dist/drafts.mjs | Existing IndexedDB transactions and expected-revision saves. |

The page recognizes native file formats and verifies their original lengths
and SHA-256 hashes. Full semantic validation stays with the original installed
workspace, receiving and buyer modules. The runner imports those modules from
the selected complete checkout or installed source package. It does not
implement a second cart, payment, session, native receiving or Applications
engine.

Saved browser drafts use **stellar-forge.frontdoor-cocart.v1**. The original
merchant draft store keeps CoCart rows under their own ID prefix. Saving an
existing draft supplies its expected revision to the same transactional writer.
An original newer tab edition is preserved; Save as new retains an intentional
separate draft. JSON download/open carries all original file bytes independently
of browser storage.

## Exact packet contract

The generated **stellar-forge.frontdoor-cocart-packet.v1** manifest contains:

- Operator-selected label, customer directory, optional SDK entry, private
  connection, workspace alias and optional merchant agent directory.
- Every original input’s role, native kind, optional merchant alias, canonical
  packet path, original display name, byte count and SHA-256.
- The selected native source path and plugin/SDK contract.
- A display projection of the imported profile or receiving workspace.

The ZIP includes each input as its original bytes, not reserialized JSON.
No payment key, signer selection or credential value is requested by the page.
Native profiles can contain public merchant payment terms, while customer
receiving files can contain private guest cart and order data. Browser processing
and chosen local saves stay in the operator’s browser. Deployment packages
contain only these source files.

The input capacity is the native 64 MiB per regular file, with the existing
Woo buyer handoff limited to 64 KiB. A page setup accepts at most 96 MiB across
its selected files, sixteen named Woo handoffs and sixteen named receiving
inputs. A primary receiving export retains the original alias reserved by
native managed setup.

Profile byte-order marks are rejected consistently with the original
workspace’s exact JSON source comparison. Valid UTF-8, CRLF, non-ASCII text
and original numeric lexemes remain unchanged in the copied files. Amounts
in the review are source strings; the page performs no floating-point price
conversion.

## Native runner

Run from the extracted setup folder:

~~~sh
TOOLKIT=/absolute/path/to/checkout-or-installed-package

node cocart.mjs inspect --toolkit "$TOOLKIT"
node cocart.mjs prepare --toolkit "$TOOLKIT"
node cocart.mjs status --toolkit "$TOOLKIT"

node cocart.mjs open --toolkit "$TOOLKIT"
# Use the original private URL printed by the listener.
# Ctrl+C stops this direct listener.

node cocart.mjs export --toolkit "$TOOLKIT" \
  --out /absolute/private/CoCart_Receiving_Workspace.json
~~~

**Inspect** reads the original manifest and every regular input with
no-follow file opens, checks stable file identity and exact saved hashes,
then invokes validateProfile, inspectReceiving and validateHandoff in the
original selected source. It resolves and checks the real SDK before native
setup writes. The result includes actual source, SDK, input and original
receiving identities.

**Prepare** calls setupCocartWorkspace. A native profile creates or reopens its
original workspace; a receiving export preserves the original complete
workspace and source objects. Optional named files enter the native merchant
connection. An optional merchant agent directory is initialized by the existing
shared merchant provider. After native setup, the runner checks the same input
identities and selected profile bytes again. The original receiving marker validates
the first imported revision; repeating Prepare retains later native customer changes
and reports both the input export's version and the current workspace version.

A profile packet may retain its original creation transport on repeated Prepare.
The native setup checks that declaration against its original recorded creation
selection, keeps the same connection metadata and leaves later transport rebinds,
cart revisions and history intact. Changing the current transport remains the
original explicit transport.rebind action.

The real parent of the customer workspace must exist. A missing selected
connection parent can be created as mode 0700 only under a real existing
parent. Existing directory and connection permissions are inspected and
retained. Native setup preserves a differing original connection or receiving
destination and reports the actual conflict.

**Open** forwards to the original managed console entry with the same selected
directory, SDK, connection and alias. The original entry owns its listener and
signal shutdown. Native cart requests and checkout are explicit customer
application actions.

**Status** rereads the native workspace without selecting a different cart or
order. **Export** uses CartWorkspace.receivingBundle and validates the complete
original receiving envelope before writing an exclusive private output.
Existing differing output bytes are preserved; choose a new filename for
a subsequent export. The actual returned revision, workspace version,
receiving digest, cart count and object count identify the result.

## First Woo installation

The existing **/woo.html** page remains the complete SF104 plugin,
merchant connection, seller, continuous SF98 delivery and buyer handover.
This page adds the original CoCart profile-export companion:

~~~sh
node cocart.mjs plugin --toolkit "$TOOLKIT" \
  --out /absolute/private/new-profile-plugin
~~~

The plugin preparation can run without setup.json. It copies the exact
original **profile-export.php** as **starforge-cocart-profile.php**, plus
the original CoCart, managed and gateway guides. Each copied file is hashed
and read back. The selected directory and existing differing files are
preserved.

Install and activate that companion in the existing Woo shop alongside its
selected CoCart, WooCommerce and SF104 plugins. Save the actual merchant
mapping, then download the product’s saved headless profile. The companion
uses the native Woo nonce and product-edit permissions.

## Original managed Applications and merchant agent

The generated handover names the actual existing Applications fields:

| Applications field | Setup source |
| --- | --- |
| workspaceDirectory | The original customer directory. |
| sdkModule | Optional explicit original SDK entry. |
| connectionFile | Optional same-workspace native merchant connection. |
| workspaceAlias | Its original selected alias. |
| Local port | The existing common setting; zero selects an available loopback port. |

Review, Save, Review start, Start and Open use the existing application
manager. The original CoCart preparer pins selected source, SDK and workspace
identity. Its serialized observer checks the actual token-bound listener
before retaining Open. Stop and reopen stay in that same original manager.

The optional native merchant configuration uses the existing
cocartWorkspaceConnection field. The provider and browser select the same
CartWorkspace; named inputs remain original host files. Setup declares
handoffs for subsequent explicit actions and does not attach a handoff to a
made-up checkout preview.

## Customer acceptance and support

The complete generated INSTALL.md connects the installer’s setup to the
customer’s operating handover:

- Selected shop, source, SDK, product and merchant mapping.
- Actual catalog, cart mutation and checkout behavior.
- Original order, attempt generation and buyer handoff.
- Existing seller and delivery operator.
- Complete receiving export, original revision and source objects.
- Managed Stop, reopen and continued access to the same customer history.
- Named operating owner, backup destination and support contact.

The same exported case supplies the support context for a returned cart,
checkout or handoff issue. A source update, local port change or new merchant
mapping is handled through the original selected product operation and
its recorded reason/version.

## Original source references

- Native application and profile contract: [CoCart README](../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/cocart/README.md).
- Native managed lifecycle: [CoCart MANAGED](../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/cocart/MANAGED.md).
- Native Woo merchant and buyer: [Gateway](../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/GATEWAY.md).
- Existing front-door Woo source: [Woo setup](dist/woo.html).
- Original CoCart source release: PR1618, merge 547410e191090cb37559df033292a43f6cffa8e8.
- Managed source release: PR1708, merge 27c8327273e5bad84b1096f01f0feafd8446eb16.

These original releases include the completed cart/checkout/receiving and
managed Stop/reopen operations. A site source update is carried into the
existing publishing conversation; the publishing provider’s saved version
and deployment response establish the actual hosted edition.

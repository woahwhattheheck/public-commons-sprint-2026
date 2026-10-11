# Stellar Forge merchant workspace

The maintained developer front door for the original Stellar x402 merchant toolkit. The static site prepares complete JSON merchant workspaces and provides the original native seller, buyer, MCP and operator entrypoints. Its existing Sites project and access policy stay in the tracked hosting manifest.

## Merchant workflow

1. Add up to 64 JSON resources, each with a unique route, description, tags and exact atomic price. Choose files or paste their original UTF-8 JSON. The resource text is preserved in the export, including whitespace, CRLF and number lexemes.
2. Configure workspace defaults or complete independent terms for each resource. Add, remove, copy and reorder 1–16 payment choices; each retains its network, asset, recipient, exact atomic amount, timeout and optional extra JSON. Amounts remain decimal strings.
3. Review every ordered choice and generated file. Download an ordinary ZIP containing the original seller.json, workspace.json, data files, editable starter-input.json and full launch instructions.
4. Install the original local toolkit archive and run starforge against that workspace. Its original developer explorer, OpenAPI and operations dashboard provide the running product interface.

Saved drafts use this browser's IndexedDB only when the operator chooses Save. Each save compares the expected revision in one transaction. A stale tab can reopen the newer version or save its current work under a new draft ID. Draft JSON import/export makes work portable. Imported seller configurations retain their original ordered payment choices, independent route terms and supported metadata. Runtime handlers, compiled offers and other resource types continue in their native workflows.

### Complete route payment terms

An imported route starts with independent terms. Changing the workspace defaults
does not rewrite an imported asset, recipient, network, price or timeout. Clear
“Use workspace defaults” on a new route to create independent choices; selecting
defaults again retains its previous edited list in the draft. Copying a list
from another resource replaces only payment terms. Add, remove and reorder
controls preserve merchant order, with an undo for the last list change before
further field edits.

The native declaration keeps its original `payment` or `paymentOptions` form.
Adding a second choice uses `paymentOptions`; a retained one-choice array stays
an array. Original legacy singleton fields stay visible and can be removed
explicitly when converting to the stricter native option array. Imported route
metadata remains attached when an operator renames its resource ID.

Every choice uses the original exact scheme and needs a distinct network,
asset and recipient tuple. A different amount or timeout alone does not define
another choice. Extra metadata remains an ordinary JSON object within the
original 8 KiB, depth and complexity limits. Incomplete extra JSON is retained
in saved/exported drafts for editing; complete workspace export requires valid
terms. The original seller compiler remains authoritative for live offers,
header limits and native payment operation. The front door neither ranks
payment choices nor combines atomic amounts across assets.

The review table displays every ordered choice with full identifiers, exact
amount, timeout and expandable extra JSON. Its generated README includes the
complete per-route terms and original install, launch, offer-inspection and
native-facilitator commands. The original offer decoder, fourteen workflow
recipes and WooCommerce setup remain available in the same front door.

The page also retains the original x402 offer inspector and request walkthrough. Offer text is not saved. No workspace content is transmitted by this static application.

## WooCommerce setup

Open `/woo.html` to import the original JSON route exports from saved Woo
products. This workflow keeps every imported route file byte-exact, supports
1–64 products for one seller origin, and reviews the declared native network,
asset, recipient, atomic amount and timeout alongside the actual shop, admission
endpoint, native facilitator and private service directory. Each Woo checkout
still contains one explicitly mapped virtual product at quantity one.

For a new installation, the first step supplies a plugin-preparation download
using the same local runner. It copies the original three PHP files from the
selected toolkit into a new installation folder without needing product routes
first. Its guide covers WordPress activation, the explicit PHP secret constant,
product mapping and the saved route export that enters the main setup workflow.

The downloadable setup ZIP includes `setup-input.json` for reopening the draft,
original route files, `setup.json`, the local `merchant.mjs` runner, and complete
merchant/buyer instructions. It reuses the existing `zipWorkspace` writer. The
runner selects a complete original source checkout or installed source-package
root, validates routes with the original SF104 compiler, prepares a new private
merchant configuration and copies the three original PHP plugin files. It
forwards seller/worker/buyer/operator/queue arguments to the original native
entrypoints and inherits their normal terminal approval. It supplies no second
payment implementation or automatic wallet operation.

The packet covers real REST ingress and unsigned admission preflight, original
seller and continuous SF98 worker startup, classic/Blocks checkout, private
buyer handoff, native SF88 review/workspace/inbox, explicit generation recovery,
independent merchant review, original Woo completion and file permissions. It
includes the original explicit testnet/pubnet workspace contract. Product
exports contain native terms; the storefront total stays in Woo and the frozen
order handoff, with no invented conversion in the Site.

No route, setup draft, private directory or key is sent to a merchant by this
page. The only additional page request loads the same-origin static runner for
export. Drafts are portable files downloaded on request; this page does not
silently save them. The native packet is for Linux/Node 22.16+; plugin/runtime
prerequisites remain in the original
[SF104 guide](../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/GATEWAY.md).

The actual exported ZIP was extracted and consumed by the original SF104
compiler/prepare/inspect commands using product 13 from the retained real Woo
installation. All three copied PHP files matched original bytes. The same
packet's original buyer imported the existing Woo handoff into its retained
workspace, completed offline SF88 review and read the original inbox identity.
An existing private configuration was preserved. A subsequent actual headless
Chromium journey at 1360×1000 and 390×844 used the original page navigation,
product import, connection/review steps, plugin/setup downloads and portable
draft reopen. Both viewport exports were byte-identical; UTF-8 BOM and CRLF
route bytes survived import/export. There were zero page errors or horizontal
overflow. Only the local Site origin received browser requests.

That browser-downloaded packet consumed the actual maintained PR1018 archive
`0.1.0-source.gc043dcae3d0e` (SHA-256
`318425dc2e1f1963ed0e48327ed95239fc0e6162c1300f8b807f8c5e270c086f`).
Initial plugin preparation and complete merchant preparation copied the same
three original PHP files; the archive's maintained `woo-seller` alias inspected
the actual generated configuration. Original buyer/workspace review and saved
inbox read also passed from that package. These checks made no new store
request, order, signature or payment. Native Site publication remains with the
original authenticated publisher and unchanged owner-private project.

## Source layout

- dist/onboarding.mjs: pure original-config generator, supported imports, validation and deterministic ZIP writer.
- dist/setup.mjs: resource editing, imports, field review, downloads and native launch handoff.
- dist/payment-editor.mjs: ordered per-route choice editing, independent/default terms, copy/reorder, original-field review and editable extra JSON.
- dist/drafts.mjs: IndexedDB records and atomic optimistic revision checks.
- dist/app.mjs: original offer inspector/walkthrough and component index.
- dist/recipes.mjs: 14 maintained workflows with copyable and downloadable commands, source guides and expected behavior.
- dist/offer.mjs: original x402 JSON/Base64 decoder, unchanged.
- dist/woo.html, dist/woo.css and dist/woo-setup.mjs: saved Woo product import, connection review, packet export and operating interface.
- dist/woo-onboarding.mjs: browser-local route validation, exact-file packet composition and complete merchant/buyer instructions.
- dist/woo-runner.mjs: portable local forwarding to the original native CLI; exported as merchant.mjs without modifying its source.
- dist/index.html and dist/style.css: responsive grayscale interface.

No build or package installation is needed for the static source. The original seller/payment implementations remain in their canonical repository modules.

## Validation and deployment

The October 11 integration used the unchanged native SF30 configuration reader and seller for two generated resources. Both returned native HTTP 402 challenges, health/OpenAPI returned HTTP 200, exact maximum prices were accepted, and exported UTF-8/CRLF/large-number source data remained byte-exact through ZIP extraction. Supported imported metadata and one-choice payment options were preserved. The native distribution workspace launcher was source-reviewed for the exact generated descriptor/config binding. These retained results should be reused; the existing offer decoder checks did not need rerunning.

The subsequent payment-choice integration imported a sixteen-choice route and
an independent original singleton, revised their ordered terms and metadata,
exported and extracted the full ZIP, then installed the accepted source archive
`0.1.0-source.gdc551b9afa1e` offline. The original workspace launcher served both
native HTTP 402 offers with choices identical to its authoritative compiler;
the explorer, OpenAPI and operations dashboard returned HTTP 200. The sixteen
choices covered explicit testnet/pubnet terms and exact maximum signed-i128
amounts. UTF-8 BOM, CRLF, Unicode and large-number source lexemes remained
byte-exact. Original singleton fields, identifier whitespace, renamed-route
metadata and portable draft reopening survived. The original default draft
also remained compatible; duplicate rails were rejected and unfinished extra
JSON remained editable. No new payment was made.

The actual local source-level Chromium continuation then reversed all sixteen
choices through the editor, reopened unfinished extra JSON from IndexedDB,
preserved a stale tab's edits as a separate draft, and exercised addition,
removal, copy, undo and independent/default term restoration. Its review had
seventeen choice rows. The browser-downloaded ZIP's seller configuration was
exactly the configuration already accepted by the original installed runtime;
both selected data files matched the accepted bytes. Portable draft reopening
also retained the revised choice order and JSON. Desktop and 390px mobile
layouts had no page errors or horizontal overflow, and the browser made no
requests outside its local source server. The native runtime check was reused.

The managed Site preview separately failed to mount `/proc`; its supervisor
was confirmed stopped and its infrastructure was left intact. The completed
local source/browser journey does not assert a new hosted version. Native
Site publication continues through the same original owner's project. The
earlier Woo browser/native package journey above retains its accepted scope.

Existing Sites project: appgprj_6acba66ca7a08191897b5a8c22611397. Static output is dist/. Continue the same project with the Sites source workflow, preserve its current owner-private audience, and apply the completed patch over the exact original source commit 845eafe472f15a04b0ada64fcba4a078008897fc. The existing Site account owns deployment; no replacement Site is needed.

## Original source and contribution

Original front-door source was recovered from the complete owner-authorized October 11 handoff archive, SHA-256 92ab33a15f260e22baf1e7bb881db2a2e33b3e16e99d1a47c793b121f0192caf. SCF-FRONTDOOR-543F integrates merchant workspace preparation, retained local drafts and current operator source.

Maintained native source: https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/stellar/scf-starforge-20261009

The workflow selector composes ASTRA26B1’s eight-path onboarding contribution with current seller, buyer, persistent MCP, merchant release, commerce and DuckDB source. The recovered donor archive was 47,089 bytes, SHA-256 e5558da845cb73fce8547dc3714ef6c14ee9c2aee5d83efcd5dfdd4e5ff39393. Source identities and the reviewed primary guide blobs are retained in dist/recipes.mjs.

## Fleet setup workbench

Open `/fleet.html` to prepare the first retained multi-merchant fleet. The
workbench edits two to thirty-two merchants, two to four fixed slots per
merchant, public hosts, current/later source aliases, initial releases and the
original gateway limits. Registered sources use the original API workspace,
Python application, DuckDB/Parquet, S3, Stellar RPC, SQLite, MySQL and ClickHouse package selectors.
SQLite source cards expose the original snapshot byte ceiling and timeout; the
export keeps those integer fields beside `sqlitePackage`. SQLite stages committed
database snapshots, while MySQL and MariaDB retain the prepared named queries and
read the live database through the merchant host's connection environment.

Each source card also imports an original host source JSON definition while
preserving that card's package alias and the rest of the fleet. ClickHouse source
definitions retain the original `clickhouseColumnTypes` map. Its ordered columns
are displayed for review and remain unchanged through draft reopen and native
launch export. Changing to another source type clears that companion. The
original ClickHouse release engine checks the retained review against the live
database at startup and supplies its original merchant operations to the fleet.

Review shows the exact sequential slot ports and retained store layout before
export. Drafts can be downloaded while incomplete and reopened as portable JSON;
the original native bootstrap declaration can also be imported. The launch ZIP
contains the editable draft, `fleet-setup.json`, machine-readable native command
arguments and complete host/recovery instructions. It reuses the maintained
`zipWorkspace` writer.

The packet invokes the original `fleet-release setup` command. The terminal,
managed browser and MCP handoffs all refer to the same retained directory and
published plan. The original host APIs inspect source packages, stage immutable
releases, select the initial slots and retain interruption recovery. The MCP
handoff uses `init-fleet --fleet-directory` and the original client-registration
command. Later stage/review/activation, drain and rollback remain available in
the original operator.
An interrupted SQLite capture is cancelled by the original setup or fleet owner,
including merchant MCP shutdown. Reopening the same directory preserves completed
releases and permits the uncommitted stage to be retried.

`dist/fleet-onboarding.mjs` owns the portable declaration and command generation.
`dist/fleet-setup.mjs` owns editing, import, review and downloads; `fleet.html` and
`fleet.css` share the original grayscale site controls. The workbench runs from
static files with the existing site. Source paths and merchant configuration
remain in the downloaded packet and original merchant host.

The fleet workbench acceptance used the actual browser to import three original
source declarations, edit their settings, follow a collapsed-limit validation
link, download/reopen the draft and export the launch ZIP. At 390px, document
width stayed 390px with zero browser errors. The unchanged exported command
arrays ran through the original distribution CLI and created six 0700 release
stores. The managed workspace served exact DuckDB decimal/Unicode values,
Python output and all three pinned S3 objects, including a 1,843,229-byte archive
across three HTTP 206 ranges with its expected hash. Eight native x402 requests
used the original SDK and a local facilitator fixture. Setup resume and the
exported MCP initialization/host registration reopened the same retained fleet
after the original S3 package moved. All owned child processes closed.

The joined SQLite/MySQL acceptance exported a seven-source browser packet and
used its unchanged native commands to initialize four retained stores. SQLite
capture limits survived native import, editing, source switching, draft reopen,
and ZIP export as numeric package fields. The managed fleet served exact large
integers, decimal strings, Unicode and selected columns through eight original
x402 SDK requests with the local facilitator fixture. An actual locked SQLite
capture was cancelled through both workspace shutdown and MCP shutdown; each
original worker exited and removed its uncommitted stage. The same stores reopened
and retried successfully. Original review and activation changed SQLite prices
12500→15000 and MySQL prices 10000→12500, then retirement and rollback restored
the retained releases. SQLite kept its staged data while MySQL read live updates.
After all prepared package directories moved, setup resume and MCP reopened the
same fleet at revision four. Both browser views stayed within 390px with zero
page errors, and all owned processes closed.

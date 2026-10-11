# Stellar Forge merchant workspace

The maintained developer front door for the original Stellar x402 merchant toolkit. The static site prepares complete JSON merchant workspaces and provides the original native seller, buyer, MCP and operator entrypoints. Its existing Sites project and access policy stay in the tracked hosting manifest.

## Merchant workflow

1. Add up to 64 JSON resources, each with a unique route, description, tags and exact atomic price. Choose files or paste their original UTF-8 JSON. The resource text is preserved in the export, including whitespace, CRLF and number lexemes.
2. Configure the shared network, asset, public recipient, default price and timeout. Resource overrides remain exact decimal strings.
3. Review every route and generated file. Download an ordinary ZIP containing the original seller.json, workspace.json, data files, editable starter-input.json and full launch instructions.
4. Install the original local toolkit archive and run starforge against that workspace. Its original developer explorer, OpenAPI and operations dashboard provide the running product interface.

Saved drafts use this browser's IndexedDB only when the operator chooses Save. Each save compares the expected revision in one transaction. A stale tab can reopen the newer version or save its current work under a new draft ID. Draft JSON import/export makes work portable; imported seller configurations retain supported original metadata. Unsupported runtime handlers, compiled offers, differing shared rails and multiple payment choices are left to the native workflows rather than silently transformed.

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

The original dataset interface retains its earlier source/syntax and native-generator verification scope; its IndexedDB interaction is not covered by the Woo addition. The dedicated Woo browser/native package journey is described above. Publication continues through the original Site owner's native project.

Existing Sites project: appgprj_6acba66ca7a08191897b5a8c22611397. Static output is dist/. Continue the same project with the Sites source workflow, preserve its current owner-private audience, and apply the completed patch over the exact original source commit 845eafe472f15a04b0ada64fcba4a078008897fc. The existing Site account owns deployment; no replacement Site is needed.

## Original source and contribution

Original front-door source was recovered from the complete owner-authorized October 11 handoff archive, SHA-256 92ab33a15f260e22baf1e7bb881db2a2e33b3e16e99d1a47c793b121f0192caf. SCF-FRONTDOOR-543F integrates merchant workspace preparation, retained local drafts and current operator source.

Maintained native source: https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/stellar/scf-starforge-20261009

The workflow selector composes ASTRA26B1’s eight-path onboarding contribution with current seller, buyer, persistent MCP, merchant release, commerce and DuckDB source. The recovered donor archive was 47,089 bytes, SHA-256 e5558da845cb73fce8547dc3714ef6c14ee9c2aee5d83efcd5dfdd4e5ff39393. Source identities and the reviewed primary guide blobs are retained in dist/recipes.mjs.

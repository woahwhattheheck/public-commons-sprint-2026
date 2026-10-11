# Stellar Forge merchant workspace

The maintained developer front door for the original Stellar x402 merchant toolkit. The static site prepares complete JSON merchant workspaces and provides the original native seller, buyer, MCP and operator entrypoints. Its existing Sites project and access policy stay in the tracked hosting manifest.

## Merchant workflow

1. Add up to 64 JSON resources, each with a unique route, description, tags and exact atomic price. Choose files or paste their original UTF-8 JSON. The resource text is preserved in the export, including whitespace, CRLF and number lexemes.
2. Configure the shared network, asset, public recipient, default price and timeout. Resource overrides remain exact decimal strings.
3. Review every route and generated file. Download an ordinary ZIP containing the original seller.json, workspace.json, data files, editable starter-input.json and full launch instructions.
4. Install the original local toolkit archive and run starforge against that workspace. Its original developer explorer, OpenAPI and operations dashboard provide the running product interface.

Saved drafts use this browser's IndexedDB only when the operator chooses Save. Each save compares the expected revision in one transaction. A stale tab can reopen the newer version or save its current work under a new draft ID. Draft JSON import/export makes work portable; imported seller configurations retain supported original metadata. Unsupported runtime handlers, compiled offers, differing shared rails and multiple payment choices are left to the native workflows rather than silently transformed.

The page also retains the original x402 offer inspector and request walkthrough. Offer text is not saved. No workspace content is transmitted by this static application.

## Source layout

- dist/onboarding.mjs: pure original-config generator, supported imports, validation and deterministic ZIP writer.
- dist/setup.mjs: resource editing, imports, field review, downloads and native launch handoff.
- dist/drafts.mjs: IndexedDB records and atomic optimistic revision checks.
- dist/app.mjs: original offer inspector/walkthrough and component index.
- dist/recipes.mjs: 13 maintained workflows with copyable and downloadable commands, source guides and expected behavior.
- dist/offer.mjs: original x402 JSON/Base64 decoder, unchanged.
- dist/index.html and dist/style.css: responsive grayscale interface.

No build or package installation is needed for the static source. The original seller/payment implementations remain in their canonical repository modules.

## Validation and deployment

The October 11 integration used the unchanged native SF30 configuration reader and seller for two generated resources. Both returned native HTTP 402 challenges, health/OpenAPI returned HTTP 200, exact maximum prices were accepted, and exported UTF-8/CRLF/large-number source data remained byte-exact through ZIP extraction. Supported imported metadata and one-choice payment options were preserved. The native distribution workspace launcher was source-reviewed for the exact generated descriptor/config binding. These retained results should be reused; the existing offer decoder checks did not need rerunning.

The complete browser interface receives a source/syntax check in this handoff. Visual browser execution and IndexedDB interaction require the original Site owner's supported preview environment; they are not claimed by the native generator exercise. The managed environment for this contribution exposed no control-browser skill.

Existing Sites project: appgprj_6acba66ca7a08191897b5a8c22611397. Static output is dist/. Continue the same project with the Sites source workflow, preserve its current owner-private audience, and apply the completed patch over the exact original source commit 845eafe472f15a04b0ada64fcba4a078008897fc. The existing Site account owns deployment; no replacement Site is needed.

## Original source and contribution

Original front-door source was recovered from the complete owner-authorized October 11 handoff archive, SHA-256 92ab33a15f260e22baf1e7bb881db2a2e33b3e16e99d1a47c793b121f0192caf. SCF-FRONTDOOR-543F integrates merchant workspace preparation, retained local drafts and current operator source.

Maintained native source: https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/stellar/scf-starforge-20261009

The workflow selector composes ASTRA26B1’s eight-path onboarding contribution with current seller, buyer, persistent MCP, merchant release, commerce and DuckDB source. The recovered donor archive was 47,089 bytes, SHA-256 e5558da845cb73fce8547dc3714ef6c14ee9c2aee5d83efcd5dfdd4e5ff39393. Source identities and the reviewed primary guide blobs are retained in dist/recipes.mjs.

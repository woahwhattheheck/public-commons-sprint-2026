# Grant Analyst Workbench and Learning exchange

Review complete grant sources, retain explicit decisions and Learning actions, and return a colleague's offline review to the original saved workspace. The installed product also connects the existing commissioned-study workflow, customer-agent tools and independent customer receiving.

The public package contains generic integration and the complete Learning exchange implementation. The original private application, commissioned material, donor workspaces, evidence and customer outputs are supplied separately under their complete source authority. The original analyst, Learning and study writers continue to own all domain decisions.

## Guides and complete source

| Task | Maintained guide |
| --- | --- |
| Prepare full private source and an independent receiving copy | [PREPARING.md](PREPARING.md) |
| Operate grant review, Learning, commissioned studies and customer-agent tools | [OPERATING.md](OPERATING.md) |
| Issue an offline action or complete cycle review, receive it and explicitly apply or rebase | [LEARNING_EXCHANGE.md](LEARNING_EXCHANGE.md) |
| Continue the complete installed application and customer receiving course | [RECEIVING.md](RECEIVING.md) |
| Continue offline Learning within that same installed course | [LEARNING_EXCHANGE_RECEIVING.md](LEARNING_EXCHANGE_RECEIVING.md) |
| Prepare a customer Installation work order | [Existing profile](../../stellar/scf_2026/sf49_data_commissioning/installation-workorders/grant-analyst-workbench.json) and [maintained preparer](../../stellar/scf_2026/sf49_data_commissioning/installation-workorders/prepare.mjs) |
| Build and install the selected public release | [Build guide](../../stellar/scf-starforge-20261009/distribution/BUILDING.md) and [runtime installation](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md) |

[PUBLIC_SOURCE.json](PUBLIC_SOURCE.json) identifies the complete original 39-file source, its newer authoring pair, deliberate lifecycle corrections and the actual public dependency selection. [AGENTS.md](AGENTS.md) carries the source and outgoing-product inspection instructions.

## Build the selected public package

From a complete checkout of the public repository:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /ABS/public-commons-sprint-2026 \
  --ref ACTUAL_PUBLIC_COMMIT_SHA \
  --selection grant-analyst-workbench \
  --out /ABS/PRIVATE/grant-analyst-release
~~~

Use the actual immutable commit that includes the complete product. Retain its returned archive, manifest, byte count and SHA-256. Resume an interrupted build with the same original commit, recipe and directory through the maintained builder's resume option. A deliberate changed source selection is a separately retained build.

The recipe composes the original `grant-analyst-workbench`, `grant-workspace`, `merchant-provider-tools` and `merchant-console-browser-assets` contributions. It includes the whole generic product, Runtime and Applications support, the current Grant workspace and managed source inventory, the maintained Installation preparer/receiver and Source Desk/collection commands. No shared registry is replaced.

Use the Node version required by the selected distribution and its actual runtime profile. The private application preparation requires the selected Linux CPython 3.10 or newer interpreter; preserve the additional native import and host requirements reported by that original source. Browser receiving uses the actual existing Playwright and Chromium paths chosen by its operator. Package composition alone does not install these dependencies.

Prepare, install and inspect the exact archive through the maintained runtime installer:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /ABS/PRIVATE/grant-runtime \
  --archive /ABS/PRIVATE/grant-analyst-release/ACTUAL_ARCHIVE.tgz \
  --sha256 ACTUAL_ARCHIVE_SHA256 --operator --feature mcp

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /ABS/PRIVATE/grant-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /ABS/PRIVATE/grant-runtime --load --source
~~~

Use its actual returned READY result and retained dependency mode. Do not substitute a source checkout for an installed, inspected runtime.

## Supply and preserve the private originals

A usable source authority lists every original member with its path, exact bytes and SHA-256. The current private application consists of its complete declared application sources plus three commissioned receiving leaves. The preparer reads the supplied declaration and validates the complete authority rather than embedding those private bodies in this public package.

Keep the original application directory, authority and actual business workspace separate from generic integration and runtime output. Supply the full originals through their existing authorized private custody. Preserve original source strings, decimal numeric tokens, codebooks, source editions, explicit grant decisions, complete reports, Learning actions and study evidence.

~~~sh
node products/grant-analyst-workbench/prepare.mjs prepare \
  --directory /ABS/PRIVATE/grant-preparation \
  --python /ABS/SELECTED/python3 \
  --source /ABS/PRIVATE/original-grant-source \
  --source-manifest /ABS/PRIVATE/original-grant-source.json \
  --source-manifest-sha256 ACTUAL_MANIFEST_SHA256
~~~

Use the returned preparation result and actual primary/receiving directories. Preparation imports and observes the selected original modules and creates an independently received source copy. It does not create a finding, Learning cycle, commissioned answer or completed customer operation.

The operating guide then joins the selected source to the original Applications review/save/connect/start workflow and Merchant configuration. Customer-agent calls retain complete request bodies, results and file transfers. Read every chunk of large files until completion and compare the complete identity. A failed observation does not establish that a native write had no effect.

## Work with an offline reviewer

From the existing hosted Learning console, choose either an individual action or a complete cycle review. Select the actual cycle, action or later source edition and reviewed grant references. The host captures the whole source-bound context while holding the original workspace lock: reports, actions, earlier reviews, codebooks, literal source text and their original identities.

Download the issued packet or self-contained HTML for the intended recipient. Names record declared attribution; a digest identifies content and is not a signature or evidence that someone approved a decision.

The colleague can inspect every original source and report, edit the required decision and rationale, save a complete draft file, and carry the full working HTML to another device. Browser storage is convenient working state; the complete downloaded files provide portable custody. A complete cycle return includes a decision for every original action.

The original operator opens the complete return and compares issued, current and proposed values. Preview does not save a native decision. Apply through the original writer only after explicit review. If the live context changed, use the documented explicit rebase, retaining the earlier packet and draft history; never change an old digest or silently replace a source selection.

The resulting handover includes both the original native workspace and complete exchange history. An independent recipient can reopen and edit its received workspace without rewriting the sender's later work.

## Installation and complete receiving

The existing `grant-analyst-workbench` Installation profile connects the complete work to Grant Operations, Workshare, assignments, payment and acceptance. Prepare that profile through the maintained `grant-installation-workorder` command; use its template and complete actual customer/task/source inputs. Review and save the resulting work order through the existing customer Installation workflow. Prices, grant amounts, assignment capacity and acceptance remain explicit original facts.

A completed original Learning donor is sufficient for the installed course. An optional completed commissioned-study donor retains its independent original custody and selection. Use the exact selected native handover members, not an unrelated outer archive.

Continue the original receiving command and directory:

~~~sh
node products/grant-analyst-workbench/receive.mjs \
  --directory /ABS/PRIVATE/original-installed-course \
  --merchant-workspace /ABS/PRIVATE/original-runtime-workspace \
  --merchant-runtime /ABS/SELECTED/installed-runtime \
  --preparation-result /ABS/PRIVATE/grant-preparation/.preparation/PREPARED.json \
  --original-request /ABS/PRIVATE/original-delivery-selection.json \
  --playwright /ABS/EXISTING/playwright/index.mjs \
  --chromium /ABS/SELECTED/chromium \
  --actor ORIGINAL_SELECTED_ACTOR \
  --resume
~~~

The paths are placeholders. An existing course keeps its exact selected package, source, donor, runtime, actor and request bytes. Resolve a deliberate source transition with its original owner; do not relabel historical results or run a completed donor again.

The same course owns hosted applications, offline browser pages, native requests, file releases, independent receiving and cold reopening. Positive closure comes from the original owner, not an inactive or pending observation. Keep unresolved errors and actual owned handles with the existing operation. Its complete native result remains the evidence of actual receiving completion.

## Inspect the outgoing edition

Before presenting the product or calling it ready, the producing worker must open the exact outgoing version and personally view its actual desktop and narrow screens. Operate grant/source review, Learning issue/draft/return/rebase/apply, downloads, customer-agent file reads and independent cold reopening. Use populated, empty, loading and error states that matter to the selected work.

Open every attachment in its normal recipient-facing viewer, including full source/context exports, all relevant report pages, JSON/CSV, the offline HTML with its saved draft and native/exchange archives. View actual screenshots; play any media. Fix clipping, contrast, navigation, missing rows, unstyled controls or incomplete exports in the original source and inspect the corrected edition.

The composition recorded here checks original registrations and initial file selection. The native builder still owns final import/browser closure and archive production. A source checkpoint is not a completed Python/Node installation, scientific conclusion, browser exercise or recipient acceptance.

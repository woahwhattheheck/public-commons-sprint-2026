# IATI aid-finance operator

This product carries the original IATI publisher-source workflow, native XML
dataset engine, reviewed aid-finance portfolios, private browser, complete
customer handovers, typed client and source-workspace MCP tools. The maintained
Runtime workspace starts, stops and reopens the same IATI application.

The source selection is `iati-operator`. Its recipe, contribution records,
complete component files and discovered imports are recorded in the ordinary
distribution manifest. The original source version, profile and dependency
lock identify the installation.

## Install and open

Build this selection from the complete immutable source commit that includes
the IATI operator and its receiving procedure:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/source-cache/repository.git \
  --ref FULL_ORIGINAL_COMMIT \
  --selection iati-operator \
  --out /absolute/iati-release \
  --offline
~~~

Use the original builder's returned archive path and SHA-256 with the
maintained installer:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/iati-runtime \
  --archive /absolute/iati-release/ORIGINAL.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/iati-runtime --offline

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/iati-runtime --load --source
~~~

The original profile is Node plus the existing operator host:
`native:false`, `features:[]`, `operator:true`, `pins:{}`. It has no npm runtime
dependencies. The installer still creates and verifies its original dependency
lock, source manifest, private installation plan and READY state. Use the
existing Node 22.16+ executable, Python 3.11+, Linux and flock. Browser receiving
uses the selected existing Chromium and Playwright separately from this profile.

The complete callable preparation at
`sf30-seller-sdk/iati/receiving/runtime.mjs` performs this sequence, retains
partial preparations and returns the actual READY installation to the original
receiving workflow. Its full contract and source acquisition instructions are
in `iati/receiving/RUNTIME.md`.

Run the installed command through the original runtime:

~~~sh
node /absolute/iati-runtime/package/source/stellar/scf-starforge-20261009/distribution/cli.mjs \
  dataset-iati --help
~~~

For a new customer workspace, use the original IATI command's init and serve
operations. Keep the workspace outside the installed source:

~~~sh
starforge dataset-iati --workspace /absolute/private-iati init
starforge dataset-iati --workspace /absolute/private-iati serve --port 8468
~~~

The command prints the current private browser URL. The complete operator guide
is at `sf30-seller-sdk/iati/OPERATIONS.md`; it includes source intake, portfolio
definitions, reviews, native datasets, comparisons, report files, receiving
and original restart behavior.

## Work with the original publisher source

Retain the publisher's complete XML file and its original source location,
retrieval time and SHA-256. Select the original source in the browser. Inventory
and field review show the actual publisher content before the saved portfolio
definition chooses activity and financial records.

The three native editions represent activities, transactions and budgets.
A saved portfolio binds those original builds and the explicit selection rules.
Revision checks preserve concurrent work. Exact request replay returns the
retained original selection. Review decisions remain attached to the selected
portfolio revision and records.

Financial reporting preserves currency, transaction or budget type, date basis,
reporting organization and hierarchy. Read the original dated group labels
alongside every amount. The maintained IATI domain guide explains source
defaults, withdrawn currency codes, decimal precision and the distinct stock,
flow and period meanings. The report keeps these dimensions with the source.

Choose explicit before and after portfolio revisions for a comparison.
The original change detail retains the selected activity and finance
identities alongside those revisions.

## Review, deliver and receive

The complete portfolio handover retains publisher source, original plans,
native datasets, review history, exact portfolio revisions and report files.
A complete report export carries the full readable report and its native data.
Use the original receive command to reconstruct a new private workspace,
then reopen the retained portfolio and source history.

Receiving preserves the original portfolio history while recording the local
native build provenance separately. The source, plan, CSV, dataset definition
and native snapshot identify the reconstructed data. The installed SQLite
version may create different internal index bytes; the original importer
checks the complete reconstructed rows and source rules.

An interrupted export keeps its original staged output and intent. A repeated
receive selects the same packet identity and retained workspace. Keep the
complete original packet, manifest and receipt with the customer handover.

## Managed Applications and client access

Attach the READY runtime to the original Runtime workspace. In Applications,
choose IATI aid finance, select the existing private IATI workspace and the
existing Python executable, review the exact inputs, save, start and open.
The existing managed observer verifies the application's startup binding.
Stop and reopen preserve the same saved workspace and application identity.

The typed client export is
`@tokenjunkielabs/starforge-merchant/seller/iati/client`. Its original client
communicates with the same authenticated local console. The source-workspace
MCP leaf retains named source handles, selected portfolio operations and
complete report/portfolio archive reads. Its guide is
`stellar-forge/mcp-merchant-operator/SOURCE_WORKSPACES.md`.

The Runtime browser, its public assets, the original XML engine and Python
operator modules travel in this selection. The original application provider
registration and source-workspace MCP contribution travel with their owners'
source. Standard package source, registration, runtime transfer and recovery
commands retain their original interfaces.

The selected source also declares the original managed-command child, container
runtime child, RPC network catalog and developer portal/generator assets that
are loaded by path at runtime. The SF43 MCP buyer acceptance module is a real
production import and is declared explicitly so the builder retains its original
filename. These source files travel with their original Git identities alongside
the builder's static import closure.

## Continue the same release and installation

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/source-cache/repository.git \
  --out /absolute/iati-release --resume
~~~

A resumed selected release uses its saved source commit and recipe. Changing
the selected product or source commit requires a different output directory.

The maintained installer resumes installation in the same prepared directory.
An incomplete preparation is recovered into a new original installation
directory while the prior partial files remain available. The callable IATI
preparation records those directories and returns the final verified one.

Keep the application workspace and complete customer source packets outside
the installation. Source upgrades, profile changes and rollback use the
existing Runtime workspace and SF46 managed-runtime lifecycle.

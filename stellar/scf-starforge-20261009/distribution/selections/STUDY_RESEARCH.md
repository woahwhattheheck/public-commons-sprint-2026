# Study source and property research

This selected Starforge package brings the original Study Source Refresh and Property Research application together with Census ACS, BLS LAUS/QCEW, HUD income-limit releases, native dataset publishing and complete customer receiving. The browser, installed command, typed client and Merchant tools use the same saved Study workspace.

## Receive and open the application

Receive the produced archive and its SHA256 through the original runtime installer. Use the actual archive identity from the completed build receipt:

~~~sh
starforge runtime-install prepare --dir /private/study-runtime \
  --archive /private/releases/study-research.tgz --sha256 ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --feature postgres --operator
starforge runtime-install install --dir /private/study-runtime
starforge runtime-install inspect --dir /private/study-runtime --load --source
~~~

The original profile and lock select the installed Node dependencies and Linux/Python operator. Reuse the installer's existing cache, offline transfer or retained operation when applicable. The PostgreSQL group comes from the original publisher contribution and retains its pinned driver dependencies.

Attach the resulting READY runtime in the Runtime workspace, open Applications, and select Study Source Refresh. Choose the private Study directory and the actual Python executable, review the saved application, then Start and Open. The original service holds its operator lease and announces the exact workspace, source selection and instance. Stop and restart reopen the same saved records. Buyer, the merchant console and the original PostgreSQL publisher applications are also present.

The direct command opens that same implementation:

~~~sh
starforge study-source-refresh --python /usr/bin/python3 --workspace /private/study init
starforge study-source-refresh --python /usr/bin/python3 --workspace /private/study serve --open
~~~

Choose the installed Python path on the receiving machine. Keep the Study directory, source captures, finalized acquisitions, commercial material and receiving outputs in private working directories outside the installed package.

## Source studies

Import a complete retained ACS, BLS or HUD source with its original provider declaration. The Sources view also receives an original finalized SF88 source-files acquisition or a saved SF100 scan. The original receivers verify the complete member inventory, acquired chunks and capture identity, then retain the provider files and original acquisition receipts.

The original Census county API packet uses its own acs_api intake. It retains the manifest, requested county coverage, E/M/EA/MA values and original metadata responses. Its input is the complete original capture, including the published query and response files.

In the Study application:

1. Select the actual geography definitions and requested measures for the portfolio.
2. Freeze the receiving field names, composite key, declared units, null behavior and any explicit decimal conversion.
3. Freeze a study edition against those exact source, portfolio and mapping identities.
4. Compare the selected editions. Same-period comparison identifies revisions within one observation period; successive-release comparison retains the operator's explanation of the chosen releases.
5. Inspect source locators and resolve the complete review queue against its current review version.
6. Export the accepted mapped tables and complete source package, then reopen it in the receiving operator.

Source release, observation period and retrieval time remain separate. ACS estimates and MOEs, year-specific Jam bounds, LAUS coverage and footnotes, QCEW disclosure states and HUD locality/area definitions travel with the original values. Missing requested geography/measure pairs remain explicit selection issues. Source-definition or unit differences retain their comparison status and review explanation.

The original source and acquisition commands are available directly:

~~~sh
starforge study-source-refresh --workspace /private/study import-source \
  --provider acs --source /private/census/source.json
starforge study-source-refresh --workspace /private/study receive-source-files \
  --provider bls --checkout INSTALLED_PACKAGE/source \
  --session /private/original-bls-session --capture-id CAPTURE_SHA256
starforge study-source-refresh --workspace /private/study receive-scan \
  --scan-file /private/original-sf100/scan.json --provider acs
~~~

An existing acquisition retains its original buyer session, reservations, payment state and recovery. When a finalized data room moves, use the original SF100 scanner at the new location before receiving its saved scan.

## Property surveys and comparable supply

Property Research retains the original survey/PDF files and source locators, study/PMA identity, property schedules, unit cohorts, rents, occupancy observations and effective dates. Import the exact source documents, then the complete source intake bound to those document IDs.

Freeze the study and survey edition, review an actual correction against the prior edition, and retain purpose-specific comparable selections with their reasons. Market-rate and assisted-housing analysis can use different property/unit selections. The original reports preserve the selected cohort and occupancy denominator, full rent schedules and supporting source records.

A selection export includes the analyst report, CSV tables, frozen review, transitive source editions and original source files. An imported package stays available in the receiving operator's Packages view. Repeating the receive verifies its immutable records and complete files; later local review decisions remain distinct from the review frozen in the incoming packet.

The complete original operator and CLI contracts are in:

- source/stellar/scf-starforge-20261009/sf30-seller-sdk/study-source-refresh/README.md
- source/stellar/scf-starforge-20261009/sf30-seller-sdk/study-source-refresh/PROPERTY_RESEARCH.md

The installed examples/property_source_journey.py consumes the operator's retained document map, intake and selections to create a complete original property export.

## Merchant agents and complete receiving

Initialize a declared Study connection through the original source-owned Merchant registry:

~~~sh
starforge merchant-providers inspect study-workspaces
starforge merchant-providers init study-workspaces --options /private/study-merchant-setup.json
~~~

The connection declares fixed workspace aliases, Python/Node executables, startup preferences and exact original input files or acquisitions. The Study provider exposes its 51 original tools for source intake, portfolio/mapping/edition work, review, property studies, reports and complete file receiving. It borrows an already-running Applications instance when configured for that original directory. The existing operator remains the SQLite and source-record owner.

Large native responses and files retain complete byte identities and paged access. Incoming packages use the original single-payload transfer with fsynced parts, exact chunk/full hashes and restart recovery. Native writes retain their result and instance identity for reconciliation.

For an existing completed property export, the installed receiving command exercises the actual Merchant stdio, original source operator, complete download, interrupted transfer and receiving operator:

~~~sh
node INSTALLED_PACKAGE/source/stellar/scf-starforge-20261009/sf30-seller-sdk/study-source-refresh/examples/agent_receive.mjs \
  --package INSTALLED_PACKAGE --commit FULL_INSTALLED_SOURCE_COMMIT \
  --workspace /private/completed-study --export-id ORIGINAL_PACKAGE_ID \
  --python /usr/bin/python3 --out /private/study-receiving
~~~

It reopens the borrowed source after the stdio restart, explicitly opens the receiving alias before import, verifies the original reports, selections and source documents, and reopens the final report through the installed CLI. Its private result.json carries the actual original operation and received package identities. Reuse the same selected export and output directory for the original transfer continuation.

The original setup, alias, lifetime, input verification and typed-client contract is in source/stellar/scf-starforge-20261009/sf30-seller-sdk/study-source-refresh/AGENT.md.

## Publish and acquire public source products

The complete provider directories, shared publisher, source-file receiver, SF88 Python/Node clients and SF100 data-room delivery are included. Use the original provider commands and their guides:

~~~sh
starforge census-publisher --help
starforge bls-publisher --help
starforge hud-income-limits --help
starforge buyer-dataset --help
starforge buyer-agent --help
~~~

Census and BLS source-files products reconstruct the lossless original capture; their observation products preserve typed native values, statuses and source locators. HUD preserves its original workbooks, methodology, HTTP receipts, selected localities and published income-limit categories. Publisher plans, reviewed candidates, dataset snapshots and buyer offers remain in their original workspaces.

The included source guides are under sf30-seller-sdk/census-acs/, bls-labor/ and hud-income-limits/ inside the installed source tree. The original buyer-runbook and SF88/SF100 guides define acquisition and payment continuation. Use the named exports in package.json for the original Study client, providers, publishers, buyer and Runtime interfaces.

## Build, inspect and continue the package

The recipe selects complete original components and their actual contribution descriptors. It explicitly includes the shared Python source_file_delivery.py, the full provider/Python/static-file directories, the original buyer/data-room source, and the native publisher dependencies.

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/original-checkout --ref FULL_COMMIT \
  --selection study-research --out /absolute/study-release
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/original-checkout --out /absolute/study-release --resume
~~~

The original build receipt reports the produced archive, actual bytes and complete source manifest. Its source-selection record binds this committed recipe by path, Git blob, SHA256 and byte count. A resume inherits that same selection and original commit; a different selection uses its own output.

~~~sh
starforge source
starforge registrations
starforge runtime-profile catalog
starforge doctor --native --feature schema --feature openapi --feature mcp --feature postgres
~~~

Deliver the actual selected archive and hash with the reviewed study package, original source/acquisition records, saved installation profile/lock and receiving instructions. The receiving operator can reopen the same study and source definitions independently of the producer's browser session.


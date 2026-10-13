# Source Monitoring: install, operate and hand over the complete product

This package continues one customer monitoring workspace through original source receiving, complete change comparisons, native screening, separate identity and relevance decisions, assigned reviewer work, customer-agent operations and independent receiving. It also includes the maintained GLEIF research and portfolio handover used by this workflow.

The authoritative customer records remain in the existing NDJSON workspace. Runtime Applications owns the selected running console. The installed client, browser and Merchant tools call that same service. A packaged source release contains reusable implementation and original public examples; actual customer editions, provider responses, credentials, assignments and decisions arrive separately through the customer's complete authorized workspace.

## Start with the right guide

| Task | Original maintained guide |
| --- | --- |
| Create or receive a workspace, start the console, operate source editions and native requests | [Operating workflow](OPERATING.md) |
| Configure the existing installed customer agent | [Customer setup](CUSTOMER_SETUP.md) |
| Use the nine tools and read complete retained files | [Agent operations](AGENT.md) |
| Assign, complete and sign a source or portfolio review cycle | [Review cycles](REVIEW_CYCLES.md) |
| Issue an independent reviewer copy and explicitly adopt returned decisions | [Reviewer exchange](REVIEWER_EXCHANGE.md) |
| Preserve source identifiers, edition meaning and native-provider interpretation | [Original source contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/opensanctions/SOURCE_CONTRACT.json) |
| Bring reviewed GLEIF company research into the same Monitoring workspace | [GLEIF handover](../../stellar/scf-starforge-20261009/sf30-seller-sdk/gleif/MONITORING_HANDOVER.md) |
| Build, install and transfer the selected source runtime | [Runtime installation](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md) and [runtime transfer](../../stellar/scf-starforge-20261009/distribution/RUNTIME_TRANSFER.md) |

Read [PUBLIC_SOURCE.json](PUBLIC_SOURCE.json) for the original source and composed dependency identities. [AGENTS.md](AGENTS.md) carries the product preservation and actual visual inspection instructions. The complete operating chapters remain in the package; this entry explains its public source selection and the route between those existing workflows.

## 1. Build one selected public source edition

Use the complete public repository and a specific original commit containing this selection:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /ABS/public-commons-sprint-2026 \
  --ref ACTUAL_COMMIT_SHA \
  --selection source-monitoring \
  --out /ABS/PRIVATE/releases/source-monitoring
~~~

Retain the returned complete archive, source manifest, byte count and SHA-256. Reuse its original build output and original commit/selection for an interrupted build. A deliberate source change gets a separately selected build; keep the earlier source and existing receiving history intact.

The recipe composes five maintained source contributions:

| Contribution | What it adds |
| --- | --- |
| `ndjson` | Native JSON Lines operations, customer/file-job receiving and the `opensanctions` Application |
| `source-monitoring-product` | Typed Monitoring client, nine customer-agent tools, managed customer setup and continued reviewer receiving |
| `gleif-research` | Complete company research, its native Application and agent provider, and original Monitoring portfolio handover |
| `merchant-provider-tools` | Inspection of the selected source-owned provider declarations |
| `merchant-console-browser-assets` | The original Merchant Console's declared browser-route dependencies |

The recipe retains the whole NDJSON, XML and GLEIF source roots, original reviewer browser modules, complete product guides, native consumer/file-job modules and original Runtime support. Original build dependency resolution retains the physical imports and declared browser assets. The current shared provider registry reads selected declarations; no second provider registry is introduced.

The Monitoring installation path is the existing `runtime-profile`/`runtime-install` workflow followed by Runtime Applications and customer setup. This selection does not invent a Monitoring-specific Grant Installation profile. Existing customer workorders may record the selected source and actual delivery using their ordinary operations.

## 2. Install the exact archive and inspect its registrations

The source-native Monitoring workflow needs Node 22.16 or later and Python 3.11 or later. Managed operation uses Linux, `flock`, and a private local filesystem supporting the original leases, atomic creation and fsync. Customer native screening uses its separately selected yente service. Keep actual provider credentials in their original private configuration.

For the dependency-free operator runtime:

~~~sh
starforge runtime-install prepare \
  --dir /ABS/PRIVATE/runtimes/source-monitoring \
  --archive /ABS/source-monitoring.tgz \
  --sha256 ACTUAL_ARCHIVE_SHA256 \
  --operator

starforge runtime-install install --dir /ABS/PRIVATE/runtimes/source-monitoring
starforge runtime-install inspect --dir /ABS/PRIVATE/runtimes/source-monitoring --load --source
~~~

The selected package also declares the existing `schema` and `mcp` feature dependencies. When operating the Merchant HTTP/stdio host or optional native schema/payment integrations, use the original runtime profile mechanism to include their actual declared features and dependencies. An operator-only installation must not be reported as having executed every optional host integration. The installer retains its selected dependency lock, profile and original operation. It supplies the exact supported installation arguments; preserve them on continuation.

For a source-only installation with package scripts disabled:

~~~sh
npm install --ignore-scripts --offline --omit=optional /ABS/source-monitoring.tgz
npx --no-install starforge source
npx --no-install starforge registrations --source source-monitoring-product
npx --no-install starforge registrations --source ndjson
npx --no-install starforge registrations --source gleif-research
~~~

Use the existing installed `starforge` executable for subsequent commands. In a source checkout, the equivalent entry is `node stellar/scf-starforge-20261009/distribution/cli.mjs`. A managed runtime's command forwarder remains `starforge runtime-install run --dir /ABS/PRIVATE/runtimes/source-monitoring -- COMMAND ...`.

## 3. Receive the customer's original workspace and open its Application

Use the customer's complete original workspace archive when continuing existing work. Preserve its full source objects, saved editions, delta chain, native request/response history, counterparties, case revisions, review-cycle events and reviewer exchanges.

~~~sh
starforge source-monitoring --python /ABS/python3 \
  --workspace /ABS/PRIVATE/customer-monitoring --create state

starforge source-monitoring --python /ABS/python3 \
  --workspace /ABS/PRIVATE/customer-monitoring import \
  --input /ABS/Customer_Monitoring_Workspace.zip
~~~

These example paths represent actual operator selections. The receiving directory must be an appropriate new physical workspace; receiving must not overwrite an unrelated existing branch.

Use the existing Runtime workspace to attach the selected READY installation. In Applications, select **OpenSanctions source monitoring**, the actual received workspace, actual Python executable and its original private environment/connection configuration. Follow **Review → Save → Connect → Review Start → Start → Open**. A release descriptor alone is not a verified current running connection.

The NDJSON and Monitoring consoles share the native data workspace. Stop the original active Application before starting another long-lived console over that same directory. Preserve its real process ownership, resource lease and completion history. After stopping, reopen the saved Application and verify its retained source and customer state.

The original JSON startup path remains available for an authorized direct console:

~~~sh
starforge source-monitoring --python /ABS/python3 \
  --workspace /ABS/PRIVATE/customer-monitoring serve \
  --startup-format json \
  --connection-file /ABS/PRIVATE/customer-monitoring.connection \
  --port 0
~~~

The actual private connection is a capability. Open it on the selected host and retain it privately. Receiving receipts or package metadata must not expose its token. Use the existing lifecycle owner rather than starting a second service for the agent.

## 4. Prepare and verify the customer agent

The provider ID is `source-monitoring-workspaces`; its original host input is `sourceMonitoringConnection`, pointing to a complete private JSON declaration. It borrows the selected running Monitoring Application.

Create the actual selection described in [CUSTOMER_SETUP.md](CUSTOMER_SETUP.md): current Runtime workspace ID, Application ID and revision, current run and home ID, original source alias, private storage directory, source/merchant configuration paths and exact expected whole-file hashes. Both configuration postimages are complete original files; unrelated existing configuration remains intact.

~~~sh
starforge source-monitoring-customer-setup prepare \
  --runtime-workspace /ABS/OPERATOR \
  --selection /ABS/PRIVATE/customer-selection.json \
  --out /ABS/PRIVATE/customer-plan.json

starforge source-monitoring-customer-setup status \
  --runtime-workspace /ABS/OPERATOR --plan /ABS/PRIVATE/customer-plan.json

starforge source-monitoring-customer-setup advance \
  --runtime-workspace /ABS/OPERATOR --plan /ABS/PRIVATE/customer-plan.json

starforge source-monitoring-customer-setup verify \
  --runtime-workspace /ABS/OPERATOR --plan /ABS/PRIVATE/customer-plan.json
~~~

Preparation retains the complete selection, verified Application identity, both before hashes, both complete configuration postimages and two original Runtime request IDs. Repeating it with the same selection reopens the original plan. Each advance dispatches at most one retained configuration save; inspect actual status before proceeding to the next stage. Verification reopens the native identity and the exact configuration history.

The original Runtime configuration editor admits complete files up to 20,000 bytes. Do not shorten a larger configuration or discard unrelated entries to fit that bridge. Use the maintained native configuration workflow for an explicitly selected larger original.

## 5. Operate complete original sources and explicit review decisions

Receive the actual metadata, FtM source files, complete delta chain and original provider responses. Preserve the native edition identifiers and original arrays. A source item's absence has the meaning established by the original complete population and selected comparison; a partial response must not become a removal finding.

Native screening candidates and confidence scores remain provider observations. The customer operator records identity resolution and source-designation relevance separately. Review cycles retain the exact original comparison, selected population, case versions, monitoring policy and assignments. Later edits do not rewrite that commissioned baseline.

GLEIF research follows the same source-bound approach. Keep the original research edition, reviewed shortlist, field mapping, report/dataset identity and explicit Monitoring portfolio intake. The included public research examples demonstrate an original source edition; they do not attest a customer's identities, exclusions, provider entitlement or current production result.

Independent reviewer copies retain their issued baseline, assigned reviewer, selected cases and full original evidence. Preserve unfinished drafts and named editions. If edits diverge, retain both sides and use the existing explicit comparison/adoption path. Returning a file is distinct from applying its decisions or signing the completed review cycle.

## 6. Use the maintained client and nine tools

The installed client export is `@tokenjunkielabs/starforge-merchant/source-monitoring/client`. The same package also exports the original merchant, agent-client, customer-setup and customer-agent receiving interfaces with their declarations.

| Tool | Original responsibility |
| --- | --- |
| `merchant_monitoring_workspaces` | Inspect selected workspace and input-file aliases |
| `merchant_monitoring_inspect` | Verify the actual native connection and physical identity |
| `merchant_monitoring_read` | Invoke one of the original native reads |
| `merchant_monitoring_command` | Invoke the selected native write from complete original JSON |
| `merchant_monitoring_upload` | Retain a complete configured original file |
| `merchant_monitoring_receive_archive` | Receive a complete selected native workspace archive |
| `merchant_monitoring_download` | Retain a complete native output with its exact descriptor |
| `merchant_monitoring_file_read` | Read a bounded range from the selected complete retained file |
| `merchant_monitoring_file_release` | Release the read handle while preserving the original file |

The current catalogue closes tool arguments and retains the complete argument snapshot before asynchronous work. It covers the original 26 reads and 23 writes; original domain validation still applies.

A successful tool transport is not necessarily a successful native operation. Inspect actual status, HTTP correspondence and retained body. `NATIVE_ERROR` remains a native failure. JSON responses larger than 32,768 bytes retain their complete original file; the inline field becomes null. Read the complete selected file when the task requires its full contents. Keep exact numeric JSON text authoritative where parsing into JavaScript numbers would lose precision.

## 7. Continue an interrupted operation from its original evidence

Keep the exact request, first returned source identity and physical workspace selection. Reconcile a lost response through the existing native request/status/history before repeating a mutation. An uncertain upload, command or archive import is not proof of non-commit. The client and agent retain the relevant full evidence; another request ID or another workspace is not an equivalent retry.

Customer setup similarly resumes its original frozen plan and original Runtime configuration requests. If the Application, runtime source or physical receiving host deliberately changes, prepare a new explicit setup selection and preserve its predecessor as history.

A receiving directory already bound to an original source/course must continue that exact selection. Do not replace its package under an in-progress receipt. A corrected public source release is a separate maintained source edition until the original receiver explicitly selects it. Reopening an already completed earlier reviewer course must describe reuse, not claim those earlier mutations ran through a newly added transport.

## 8. Deliver and personally inspect the complete usable product

Deliver the exact selected source release and manifest, complete authorized customer workspace archive, original customer setup and receiving instructions, and every selected reviewer/report/evidence attachment. Keep private credentials in their existing secure route. A code capsule, selected excerpt or source receipt alone is not a customer workspace.

The producing worker must run/open the exact outgoing version and personally inspect its real pixels. Operate the actual source, case, cycle, reviewer-copy and agent configuration controls; cover desktop and narrow layouts, empty/populated/error states, meaningful save/return actions, whole downloads, stop/reopen and independent receiving. Open every outgoing attachment normally and inspect all relevant pages; play media when present. Fix observed usability defects in the same source and regenerate the exact outputs. Source hashes, DOM text, successful HTTP, authored fixtures or screenshots that nobody viewed do not establish this result.

Use the selected existing native/browser operation and its current owner. Source packaging and read-only composition do not create a new receiver or prove that receiving completed. The original full native course must record the actual accepted source, process state, complete outputs and personally viewed result before client-facing readiness is asserted.

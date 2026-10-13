# Source Monitoring customer commissioning

This chapter connects the existing installed Source Monitoring Application to the merchant customer-agent tools. It uses the original Runtime Applications record, the live Python console, the exact private connection file, and the original case/cycle/reviewer model. The same selected source, matching request, human decisions, reviewer editions and full native exports remain authoritative.

The setup API does not start a console, matching engine, browser, merchant server or runtime. It commissions an already running original Application. The following customer receiving course borrows that service and the original programme's optional browser callback; the original native receiving remains the sole execution owner.

## 1. Select the actual installed Application

Use the existing Runtime operator and its Applications page to inspect the saved **OpenSanctions / Source Monitoring** Application. Select its current saved revision and current running operation, not a received historical run or a stopped process.

The original application kind is **opensanctions** and its maintained command is **source-monitoring**. Its provider verifies the complete selected source, Python 3.11+ executable, NDJSON workspace identity and binding. Its startup observer authenticates the original loopback console before Runtime records its application URL. The customer setup reopens that exact connection with the original MonitoringClient and compares the complete native identity, including workspace, source binding, Python and process ID.

Read the actual IDs and paths from the original model:

~~~js
const state = await model.state({operationDetail: 'summary'});
const applications = await model.applicationsState({historyLimit: 1});
// Select the intended applications.applications entry. Do not select by label alone.
~~~

The current Application must have phase RUNNING, an active current operation, kind opensanctions, command source-monitoring, its selected managed home and a valid retained application URL. An unavailable process observation is not a current running identity. An imported Application first goes through the existing current-host review and save.

Setup uses the console's explicit private connectionFile when present. Otherwise it uses Runtime's existing private operations/RUN_ID/application-url.json. It never writes the bearer URL or token into a new source configuration or public result.

Keep using the same native service's existing lifecycle. Configuration inspection and client closure do not stop it. Runtime model.close() closes that borrowed model's read cache; it does not claim the managed service stopped.

## 2. Prepare two complete private configuration editions

Create or select an existing private agent storage directory on the actual host. Choose two JSON filenames inside the selected Application home's existing config directory:

- A Source Monitoring declaration, such as source-monitoring.json.
- The existing complete merchant host configuration, such as merchant.json.

The merchant JSON must already exist. Setup preserves every unrelated key and changes only sourceMonitoringConnection to the absolute selected Source Monitoring declaration. The declaration preserves other configured workspaces and files, then sets the one explicitly selected alias and any explicitly supplied file additions.

The Runtime managed configuration editor supports complete files up to **20,000 bytes**. Setup enforces that bound for both whole postimages before dispatch. The broader agent declaration reader supports its own larger capacity; this convenience bridge does not silently trim a larger configuration. Use the maintained native configuration workflow for a larger existing file.

Save a private selection JSON with actual values:

~~~json
{
  "schema": "stellar-forge.source-monitoring-customer-setup.v1",
  "operationId": "ORIGINAL-SETUP-UUID",
  "workspaceDirectory": "/absolute/runtime-operator-workspace",
  "workspaceId": "ACTUAL-RUNTIME-WORKSPACE-UUID",
  "applicationId": "ACTUAL-24-HEX-APPLICATION-ID",
  "applicationRevision": "ACTUAL-SAVED-APPLICATION-REVISION",
  "runId": "ACTUAL-CURRENT-RUN-UUID",
  "homeId": "ACTUAL-24-HEX-MANAGED-HOME-ID",
  "alias": "monitoring",
  "storageDirectory": "/absolute/private-agent-storage",
  "sourceConfigPath": "source-monitoring.json",
  "merchantConfigPath": "merchant.json",
  "expectedSourceSha256": null,
  "expectedMerchantSha256": "ACTUAL-COMPLETE-MERCHANT-FILE-SHA256",
  "label": "Original source monitoring"
}
~~~

The capitalized identity placeholders above are instructions to copy the actual saved identities; they are not runnable or invented customer data. An absent Source Monitoring file uses expectedSourceSha256 null. An existing file requires its complete current SHA-256. Workspace and file aliases use lowercase letters, digits, underscores and hyphens, begin with a letter or digit, and are at most 64 characters.

Optional files is the original agent alias map. Each entry identifies path, bytes and sha256, with optional name, media and sourceUrl. Keep original input file bytes and original source URL. A file declaration authorizes that exact complete file; it does not author a portfolio, case, finding, decision or screening outcome.

The composed declaration is checked by the **same pure validator** used by the real agent configuration reader, before either Runtime write. Every prior field, workspace alias and file descriptor is validated. The actual storage directory is also checked. The existing merchant configuration is read through its maintained reader.

The existing installed CLI also exposes `starforge source-monitoring-client customer-setup --help` and `starforge source-monitoring-client customer-receive --help`. Those subcommands forward to the same source below, without a second connection selection.

Run the installed source directly:

~~~sh
node /ABS/INSTALLED-RUNTIME/source/products/source-monitoring/customer-setup.mjs prepare \
  --runtime-workspace /ABS/OPERATOR \
  --selection /ABS/PRIVATE/customer-selection.json \
  --out /ABS/PRIVATE/customer-plan.json
~~~

The caller-owned private plan directory must already exist. The full frozen plan contains the original selection, the verified Application/run identity, both complete proposed configuration postimages, exact before hashes and two deterministically derived original Runtime request IDs. It can contain private configuration values and remains private. The printed preparation result contains only its path, plan digest and reuse status.

Repeating prepare with the same full selection and output reopens the retained plan. It does not silently reselect a newer Application or config. A deliberately changed selection needs a separate named plan and setup operation; keep the earlier plan and Runtime history.

## 3. Advance and verify the original configuration requests

~~~sh
node /ABS/INSTALLED-RUNTIME/source/products/source-monitoring/customer-setup.mjs advance \
  --runtime-workspace /ABS/OPERATOR --plan /ABS/PRIVATE/customer-plan.json

node /ABS/INSTALLED-RUNTIME/source/products/source-monitoring/customer-setup.mjs status \
  --runtime-workspace /ABS/OPERATOR --plan /ABS/PRIVATE/customer-plan.json
~~~

Advance dispatches at most one configuration save. Runtime's original worker performs it. After the Source Monitoring declaration completes, a following advance validates the actual saved declaration and dispatches the merchant reference update. Continue the same plan after the actual worker returns; a PENDING result is not completed commissioning.

Each original managed-config-save request carries the complete expected preimage SHA. The maintained configuration history retains its whole before/after bytes and first result. An interrupted call cannot mint another request ID, adopt another current file, or overwrite a later edit as a replay. Setup checks that any retained configuration history belongs to the same exact request and proposed bytes.

If the original configuration worker is definitively inactive in an interrupted, failed or queued state, the operator can select advance --recover. This invokes the maintained Runtime recovery on that same original request. An active or unavailable worker observation never authorizes another worker. The kernel lease remains the original authority.

Completed setup status remains readable after a later deliberate configuration edit. It reports currentConfigurationMatches false and does not overwrite that edit. A half-completed setup will not publish its second file over a changed first file.

The status output includes operation status, complete file identities and configuration history identities, rather than printing full private configuration contents. The original Runtime configuration history remains the place to inspect or restore complete saved editions.

Finish current live verification:

~~~sh
node /ABS/INSTALLED-RUNTIME/source/products/source-monitoring/customer-setup.mjs verify \
  --runtime-workspace /ABS/OPERATOR --plan /ABS/PRIVATE/customer-plan.json
~~~

Verification requires both original writes completed, both current config hashes matching the prepared postimages, the exact same saved Application/run still live, and the real merchant config reader resolving sourceMonitoring to the same normalized declaration.

This establishes current connection/configuration correctness. It does not establish rendered acceptance or a completed customer review.

## 4. Use the typed customer tools

The merchant host input is sourceMonitoringConnection. Its provider config key is sourceMonitoring. The original reader returns a normalized configuration and MerchantSourceMonitoring borrows the existing native HTTP owner. The tools are documented in [AGENT.md](AGENT.md) and typed in merchant.d.mts.

All effects select a nested scope with the configured workspace alias, exact expectedWorkspace and expectedBindingSha256. A portable case or archive ID does not replace the physical workspace selection.

The agent retains complete native request and response bytes. Large replies return a retained file selection, not a shortened result. AgentMonitoringClient reconstructs the original NativeReply by reading every range under the same full-file SHA and byte count:

~~~js
import {createAgentMonitoringClient} from './agent-client.mjs';
const client = await createAgentMonitoringClient({
  configurationFile: '/ABS/MANAGED-HOME/config/source-monitoring.json',
  workspace: 'monitoring',
});
try {
  const identity = await client.inspect();
  const state = await client.get('state', {});
  // state.raw is the complete original native JSON response.
  // Preserve it when exact numeric token spelling matters.
} finally {
  await client.close();
}
~~~

The adapter exposes inspect, get, post, upload, receiveArchive and download plus close. It does not claim to implement the original client's higher-level multi-upload convenience methods. For a native mutation, use its complete original JSON file bytes and original UUID/version/review SHA values. JavaScript object convenience rejects unsafe integer values, nonfinite numbers and values JSON would silently omit; exact JSON text remains available for original numeric tokens.

A NATIVE_ERROR is reconstructed from its complete retained original evidence and response bytes, with its original error code, detail and uncertainty. Do not treat a transport failure as an uncommitted operation. Query the original native request and reuse its exact bytes/UUID when the native model permits replay.

Downloads first select the actual complete native descriptor. Reviewer documents use the original review-exchange view's SHA and byte count. Objects and sources use their original content ID. All file chunks are verified, streamed to a private temporary output and published exclusively after full byte/SHA verification. An existing different output is rejected. Closing the adapter drains its calls and readers; it never stops the original native service.

## 5. Run the complete original reviewer course through the agent

The executable receiving/customer-agent.mjs is a transport continuation of the existing reviewer-exchange course. It does not create a second review workflow. It accepts the same **stellar-forge.source-review-receiving.v1** selection used by [REVIEWER_EXCHANGE.md](REVIEWER_EXCHANGE.md), with the real cycle, assigned cases, reviewer, source/evidence selection and original operation ID.

~~~sh
node /ABS/INSTALLED-RUNTIME/source/products/source-monitoring/receiving/customer-agent.mjs \
  --runtime-workspace /ABS/OPERATOR \
  --plan /ABS/PRIVATE/customer-plan.json \
  --python /ABS/PYTHON \
  --output /ABS/ORIGINAL-PROGRAMME/reviewer-exchange \
  --selection /ABS/PRIVATE/original-reviewer-selection.json
~~~

The original equipped programme remains the sole owner. Retain its existing output directory, Python and native source selection. Do not run the direct and agent continuations concurrently.

The course:

1. Revalidates the exact completed current customer setup and original live identity.
2. Retains the complete original course selection, physical workspace declaration and setup-plan digest.
3. Uses the existing native receiving implementation for issue, full JSON/HTML download, unfinished/independent reviewer work, named-edition selection, exact returned-file preview, complete comparison and explicitly authored conflict choices.
4. Executes atomic adoption through the original case/cycle transaction. Original inputs are retained before dispatch; uncertain calls query the same original request and preserve its first result.
5. Exports the whole customer workspace, uses the original native CLI to receive it independently, verifies original results and historical adoption, performs the supplied real later cycle work, exports again and independently receives the following edition.
6. Reopens all three original request results through customer-agent tools and downloads the complete original issued JSON, issued HTML and returned file with their exact native descriptors.
7. Closes all owned clients/readers before retaining its completed customer-agent result.

If the selected reviewer file, supervisor choice file or later cycle commands have not yet arrived, the existing course retains a specific awaiting-work state. Continue the same paths and operation after that actual work arrives. No case rows, approvals, identities, portfolio-refresh events or final decisions are generated merely to make the course finish.

A browser-producing original programme can call receiveSourceMonitoringCustomer with its existing operateCopy callback. The original [reviewer-copy-browser.mjs](receiving/reviewer-copy-browser.mjs) borrows its page and independent context; the caller keeps their lifetimes. The full returned original can be authorized as the receiving input only when its path is the explicitly selected returnFile or the exact file recorded by that original browser callback. The wrapper freezes its actual name, media, bytes and SHA and retains a complete private declaration before the upload. The tool itself still accepts only a declared alias and exact file identity.

When an earlier direct course is already complete, the original completed native results are reused and verified. The following agent receipt explicitly records that it reopened an existing complete course. It does not claim the old mutations ran through a newly installed transport.

Keep the original source, customer archive, issued HTML and JSON, every evidence/source file, returned full copy, complete requests/results, both native receiving branches, and captured visual observations. The new private setup plan/configuration carries host paths and remains distinct from the portable customer archive.

## 6. Receiving on another host

The customer workspace ZIP carries the original source/case/cycle/reviewer data and history. It does not grant access to a former host's bearer connection or process.

Use the original Runtime/Applications current-host receiving and review workflow to bind the actual received native workspace and selected installed source. Start it only through the original authorized lifecycle. Prepare a new explicit customer setup plan for that new physical host and its actual current run; preserve the original setup and native history as history.

Configure the intended merchant host from the new private file reference. Recheck the live identity before commands. Later native work stays in the received branch; repeated old commands return their original saved result where supported and do not erase later decisions.

## 7. Source and verification status

The implementation consists of the original installed provider/client/domain plus customer-setup.mjs, agent-client.mjs, their declarations, and receiving/customer-agent.mjs. The original reviewer course adds only an optional clientFactory seam; its default remains the existing MonitoringClient. Runtime configuration writes use the original retained managed-config-save writer, not another configuration database.

The complete source has been reviewed and its JavaScript parsed. Native execution, TypeScript compiler output and rendered/pixel acceptance must be reported from actual returned execution evidence. No source-only result is described as a native or rendered customer delivery.

Related complete guides:

- [Original operating workflow and installation](OPERATING.md)
- [Agent tools and original result recovery](AGENT.md)
- [Review cycles](REVIEW_CYCLES.md)
- [Reviewer source exchange and complete receiving](REVIEWER_EXCHANGE.md)


## Rendered product inspection — owner instruction, 2026-10-13
This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999

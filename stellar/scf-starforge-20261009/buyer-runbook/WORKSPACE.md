# Buyer runbook workspace

The browser workspace turns the original buyer runbook into a complete local
operator workflow: arrange selected resources, retain draft revisions, review
exact request terms, initialize a frozen acquisition, follow native execution,
recover original results, download saved resources and complete original purchase
accounting with retained receipts and an accounting CSV. It uses the existing
runbook engine and original SF88 command for every operation.

## Set up a receiving host

A new receiving workspace can start with only `--state`; it creates its private
configuration directory automatically. Open **Local buyer setup** to configure,
review and save this host’s original operator preset. Earlier versions can be
restored or downloaded, and the page shows effects on pending reviews while
prepared buyers keep their original ledgers. See [OPERATOR_SETUP.md](OPERATOR_SETUP.md)
for first setup, exact-byte legacy adoption and CLI operation.

## Start with original buyer configurations

Prepare complete SF88 configs using the existing buyer onboarding or merchant
challenge handoff. Put the selected JSON files in a dedicated private directory.
Keep their original signer, policy, ledger, evidence and request-body references
on the same trusted operator host. Each selected operation has its own stable
native intent ID.

Start the original workspace with browser approval selected:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs workspace \
  --state /private/acquisitions/workspace \
  --configs /private/acquisitions/buyer-configs \
  --approval-mode browser \
  --port 8460
```

Both paths are absolute. Their existing parents must be canonical local paths;
the configuration directory must already exist. Private directories use `0700`
on POSIX systems. The new workspace and its files use `0700` and `0600`.

Open the printed `http://127.0.0.1:PORT` URL. Port `0` selects an available port.
The server binds only to loopback. Keep the host process running while using the
workspace. The page reports browser approval support independently of whether
a controlling terminal exists, along with the selected configuration directory.

For the existing terminal workflow, use `--approval-mode terminal` and start in
the controlling terminal that receives the original SF81 prompt. The direct
command defaults to terminal mode. Approval mode is chosen by the launching host;
select `--approval-mode browser` again on each browser reopen. Applications
reviews the selected runtime and starts this same original workspace; see
[BROWSER_WORKSPACE.md](BROWSER_WORKSPACE.md) for its source and lifecycle contract.

To reopen, use the same state directory. `--configs` can be omitted after the
first start. To include an existing original runbook, add its directory:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs workspace \
  --state /private/acquisitions/workspace \
  --approval-mode browser \
  --run /private/acquisitions/earlier-run
```

The existing run remains at its original path; the workspace retains a reference
to it. Previously registered runs remain available after later restarts. One
`--run` path can be registered per invocation.

## Receive a private merchant request

The same workspace can receive the complete private buyer request exported by
the original merchant API workspace. The file carries the exact operation ticket,
body bytes, ordinary request headers, stable intent, public URL and discovery
document. A ticket is included when the original operation uses one. It contains
no receiver operator, signer or filesystem settings. A received customer SDK can
also prepare the exact request through the [customer SDK workflow](CLIENT_SDK.md).

Declare this machine's operator once in an existing private `0600` JSON file:

```json
{
  "schema": "stellar-forge.buyer-runbook-operator.v1",
  "actor": "buyer-team",
  "service": "merchant-api",
  "payer": "YOUR_STELLAR_G_ACCOUNT",
  "python": "/usr/bin/python3",
  "maxTotalAtomic": "1000000",
  "maxDailyAtomic": "250000",
  "secretEnv": "STELLAR_SECRET"
}
```

Replace the payer with the receiver's real Stellar account and use its existing
Python executable. Atomic amounts are positive integer strings. The two maximums
limit each new request's local spending policy; they do not form a shared fleet
budget. Use `signerProvider` with an absolute trusted SEP-43 provider path instead
of `secretEnv` when applicable. Optional `rpc` and `httpsProxyEnv` follow the
original SF88 workspace configuration. The preset contains an environment name,
never a wallet key. The receiver supplies its wallet key through that environment
when executing, or uses its existing local provider.

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs workspace \
  --state /private/acquisitions/workspace \
  --configs /private/acquisitions/buyer-configs \
  --approval-mode browser \
  --operator-settings /private/acquisitions/local-operator.json
```

The declared settings path is retained and may be omitted on reopen. An existing
workspace can attach its first local settings file with the same flag. **Local
buyer setup** can adopt its exact bytes into the workspace, then retain selected
preset revisions without changing the external file. The configuration directory
and original declaration stay fixed. A different selected preset requires a
current request review before preparation; prepared buyers keep their original
local policy and identity. See [OPERATOR_SETUP.md](OPERATOR_SETUP.md).

1. Choose **Receive merchant request** and upload the original complete file
   within the packet limit shown by the receiver. The workspace retains its exact bytes privately. Uploading that
   identical file again opens the same retained request.
2. Inspect the public request, ticket expiry, exact body and ordinary headers.
   **Download exact body** returns the original bytes, including multipart or
   binary input. The private request attachment retains the original transfer.
   Multipart bodies use the shared 16 MiB request ceiling, including framing;
   packet and HTTP upload limits allow their base64 representation. A source-
   declared absent body stays absent and has no body attachment to download.
3. Explicitly choose a supported payment option from its original discovery.
   Set a total and daily atomic budget. The daily amount must cover the selected
   request ceiling and fit inside the total and the declared local limits.
4. Choose **Save request review**, inspect the recipient, asset, network, payer
   and budgets, then **Prepare local buyer**. This invokes original native
   handoff import and `initializeWorkspace`, including the original Python
   spending ledger. It creates a private operator beside the retained inputs.
5. Choose **Add to acquisition plan**. The ordinary SF88 config appears in the
   existing source directory as `received-<request-sha256>.json`. Continue with
   the original save, review and acquisition initialization below. Existing
   editable plan rows are preserved; an initialized plan starts a new draft.

Preparation does not load a wallet or send a payment. The original buyer owns
live terms and operator approval when the acquisition executes. Browser mode
presents that same native review in the acquisition; terminal mode retains its
original terminal prompt. Each received
stable intent is bound to one local prepared request. The workspace publishes
the ordinary source config only after native setup is complete, and records the
ready reference last. Repeating preparation after an interrupted final publication
adopts that same completed operator and ledger. An incomplete native attempt resumes its original setup generation from the
complete preset bytes retained before initialization, including when the active
host settings have changed. Its original private inputs, keys and spending ledger
remain attached to that generation. Older attempts can adopt actual matching
preset bytes from the current declaration or saved host versions. Changed retained
inputs report their native mismatch before setup continues. Existing distinct
request reviews retain their original generation identities.

Received source configs reference the private intake and native operator files
under this workspace. Keep that workspace and the original source directory at
their same paths. The acquisition still executes its pinned config snapshot.
For an intake-owned config, the workspace opens its original native operator in
accounting mode, checks the source identity and loads its three retained Governor
keys only into the original buyer child's environment. A missing key file fails
preflight before an attempt starts; restore local setup and retry the untouched
operation. Other selected configurations retain their original environment path.

## Receive a paid-file order

Choose **Receive paid file order** for an original SF101 purchase handoff. The
same local operator preset prepares its native buyer and spending ledger. Review
the file promise and budgets, select a host-declared claim environment name, then
add the prepared order to an acquisition. Its operation row keeps the original
purchase result, resumable entitled transfer and verified customer download
together. See [PAID_FILES.md](PAID_FILES.md) for the full receiving and delivery
workflow and the optional launcher flag `--claim-envs`.

## Arrange and review a plan

1. Choose **New acquisition plan** and give it a stable plan ID and title.
2. Add the original configurations in the desired execution order. Set a unique
   operation ID, optional label and optional `saveAs` filename for each resource.
   Move rows to change order. A plan supports 1–64 operations.
3. Existing runbook JSON can be pasted with **Import manifest**. Its config
   references must resolve inside the configuration directory selected at start.
   The page uses the same editing and native review path for imported manifests.
4. Choose **Save and review draft**. The original importer validates the complete
   configs, distinct IDs and output paths. The saved review shows each request,
   body hash, operator identity, recipient, timeout, output path and atomic cap.
   Totals remain separate for each network and asset and retain exact integers.
5. Edit and save another revision when needed. Earlier revisions remain readable
   in the revision selector. Two windows editing the same draft must reopen the
   latest revision before saving over its position in history.
6. Choose **Initialize acquisition** for the reviewed latest revision. The original
   initializer retains the reviewed config, body and manifest bytes before writing
   the acquisition snapshots. If a source config or body changed since review,
   save and review a new draft revision.

A successful initialization freezes that acquisition's plan. Its draft history
remains available for inspection. A repeated initialization request resolves to
the same run when its original reviewed plan matches. New work begins with a new
explicit plan and its selected native intent IDs.

If initialization is interrupted, its draft shows **Resume initialization**.
That revision stays fixed while the run directory is incomplete. Resume uses the
retained native bytes, including when the original config or body has since been
edited. Existing snapshot files must match those bytes; original attempts,
downloads and execution leases keep their own state. The private initialization
snapshot lives beside the run directory and travels with a workspace backup.

Separate workspace processes coordinate draft saves and initialization through
the original immutable lease generations. A concurrent edit reports that another
process owns the mutation; a later request recovers a dead local metadata owner.
This keeps the saved revision and its initialized plan together across processes.

The workspace lists up to 512 JSON configuration files, including ordinary
subdirectories through four levels. It ignores symlinks and hidden directories.
Invalid original configs are excluded from the selector; fixing the source and
using **Refresh local sources** makes them available when valid.

## Execute and follow the acquisition

Open a saved acquisition. The page shows untouched operations, retained results,
saved resources, local setup errors and the original execution owner. Use
**Execute untouched operations** for the current plan order, or execute one
untouched operation from its row.

The workspace calls the original `executeRunbook` API. That engine launches its
original SF88 CLI serially, preserving live-term lookup, the SF81 native review,
configured signer, SF36 reservations and SF82/SF31 evidence and response handling.
Terminal mode keeps its prompt in the controlling terminal. Browser mode presents
the original review in **Purchase approval**, inside the selected acquisition.

The panel identifies the acquisition, execution, operation and stable purchase
intent. It shows the exact amount in atomic units, method and resource, network,
asset, recipient, scheme, timeout, operator/service and request-body identity.
**Complete payment terms** retains every accepted term. **Request identity and
native review** includes the original request and accepted-terms digests and the
complete native review. **Budget at review** shows available capacity under all five original spending
limits; capacity is checked again when the operator records approval.

Choose **Approve purchase** or **Reject purchase** for that exact live request.
After a reservation is approved, follow the original payment, resource and
accounting result below. A completed review remains readable with its execution;
it cannot approve another purchase. Moving between acquisitions or operations
resets the old selection before loading the newly selected native review.

A disconnected or expired review disables purchase decisions. Use **Refresh
approval** or **Refresh original operation** to read the same execution and its
recorded result. A lost decision response is reconciled from that original state.
The browser refresh path does not launch another operation. Expiry ends that
review's decision window; inspect the retained native result before preparing
further work.

One workspace process owns one acquisition execution at a time. The original
per-run lease also coordinates with existing CLI processes. Previously attempted
operations keep their original status and are skipped by resumed execution.

**Cancel current execution** addresses the exact execution shown in the page.
It disables further approval, retires the pending native review, aborts the
workspace's own controller and lets the original buyer finish its cancellation
and output capture. The run stops launching further operations. Read its saved
payment, resource and accounting outcome after cleanup.
Closing the workspace with `Ctrl+C` or `SIGTERM`, or **Stop** in Applications,
follows the same drain path before closing the original approval broker.
Refreshes and other browser windows continue to read original state while the
process owns the acquisition. Incomplete rows with a running original lease
are displayed as in progress.

The browser retains recent execution events while that workspace process lives.
Durable attempts, process records, stdout/stderr and native results remain in
the original runbook directory and provide the state after a restart.

## Recover and use the resources

**Recover retained output** calls the original recovery API for the existing run.
A complete retained original SF88 stdout summary becomes its original recovery
record. An incomplete outcome remains available for inspection with the same
intent and evidence references.

When status identifies a dead local owner, the page offers **Release this dead
owner's lease** with its exact displayed PID. The original unlock routine checks
the host, process identity, unfinished child processes and lease generation.
Recovery can then continue against that same run. Active external owners remain
visible in the page.

An original `saveAs` resource becomes downloadable after SF31 reports `SAVED`.
The workspace opens only that recorded file inside the original run's downloads
directory, checks its recorded byte length and SHA-256, and streams it as an
attachment. **Preview resource** shows up to 64 KiB of UTF-8 text for textual
content types, with a clear truncation label; binary files retain their metadata
and download link. File identity is checked while reading the preview. External
configured output destinations remain visible in the original result.
**Download state** and **Download report** export the current original inspection
and its original HTML renderer, including saved accounting results.

## Complete accounting and retain receipts

The acquisition's **Accounting and receipts** section completes existing buyer
attempts through the original SF88 `finalizeOriginalAttempt` and SF36 worker.
Choose **Refresh all accounting**, or **Refresh accounting** on one operation.
Untouched operations keep their existing state. This action uses the original
accounting keys and ledger without loading a wallet provider, asking for another
approval, or starting a purchase. It is available without a controlling terminal.

For requests received and prepared in this workspace, the original private
operator is selected from that request's retained ready record and source config
hash. The selection is retained with the acquisition after the first accounting
check. Existing configurations from elsewhere need their original operator:

1. Open **Select the existing operator workspace** on the operation.
2. Enter the absolute path to its existing native SF88 operator directory and
   choose **Save operator selection**.
3. Choose **Refresh accounting**. The selected workspace must retain the same
   payer, ledger, policy, service, signer reference, transport, evidence directory
   and original network/asset/recipient as the frozen request. Selection never
   creates a replacement operator or spending ledger.

Each refresh checks the original started record, frozen config hash, exact request
identity, body presence/length/hash and canonical native evidence path. SF88 then
checks the original approved request and SF36 authenticates its reservation and
finality. The original network RPC and explicit proxy configuration remain in use.
A request body that becomes unavailable after purchase does not prevent original
accounting: the retained approved body digest is checked without rereading the
spent body file. Execution continues to require its unchanged body snapshot.

The page records the latest accounting outcome and retains the original receipt,
actual atomic amount and approved request digest when finalized. A later failed
observation keeps the earlier finalized receipt visible and included in totals.
The original unsigned-response helper handles a request requiring no payment;
that response has neither an actual payment amount nor a ledger receipt.

Totals group exact integer amounts by network and asset. Finalized operations,
unsigned responses, unresolved attempts and untouched operations have distinct
counts. Delivery status remains the original SF31 result, so an accounting receipt
does not mark a partial or failed download as complete. **Download accounting CSV**
exports one row per operation with those current outcomes and retained receipts;
the HTML report and JSON state contain the same saved accounting view.

Accounting uses the existing per-run lease, serially across the selected attempts.
The workspace shows progress while it runs. **Cancel accounting refresh** stops
the current original worker and leaves earlier results intact; reopening and
refreshing resolves the same attempts against the same original ledgers. A stale
local process lease uses the existing exact-owner recovery control. Receipt views
are private `0600` files inside the acquisition's `0700` accounting directory.

If original accounting succeeds but its view cannot be saved, the active result
reports `SAVE_FAILED` and retains the returned receipt. Refresh that same attempt
after restoring local storage; original SF36 reuses already finalized accounting.
The ledger remains authoritative throughout. Native CLI equivalents are documented
in [README.md](README.md#complete-original-accounting).

## Native composition and package integration

`runbook.mjs` now exposes `previewRunbook({manifest,output})` and
`runbookPlanDigest(plan)`. Preview and initialization share the original input
preparation function. Preview returns `{plan,sha256}`; the digest excludes only
the preview's creation time. `initializeRunbook` accepts an optional
`expectedSha256` and checks it before creating the output directory. With
`resume:true`, it resumes the retained review, or returns the matching complete
plan. Create-only file publication retains byte identity across interrupted and
concurrent continuations. Existing CLI callers retain their original behavior.

The browser entrypoint is `startRunbookWorkspace({directory,configsDirectory,
operatorSettings,paidFileClaimEnvs,runs,port,approvalMode,expectedSelectionSha256,
signal})` from `workspace.mjs`. It returns `{url,server,model,launch,close}`.
`approvalMode` is `BROWSER` or `TERMINAL`; the default preserves terminal callers.
The optional signal cancels startup or drains the live host. The launch record
and `GET /api/launch` identify the actual selected source, directories, process
instance, loopback URL and approval availability. The read-only
`inspectRunbookWorkspaceSelection` helper binds the same source and inputs for
managed review, Start and Reopen.

The existing `buyer-runbook` package alias continues to target `cli.mjs`; the
`workspace` subcommand is available through that alias. Include the complete
buyer-runbook component so `handoff-intake.mjs`, `client-intake.mjs`, the
`workspace-ui` modules and [CLIENT_SDK.md](CLIENT_SDK.md) travel with the model
and server. Browser mode also uses the original sibling SF81 broker, bridge and
shared `browser-ui` assets from that selected runtime. There is no new package
dependency.

The loopback server checks Host, Origin and browser fetch context. Mutations use
the current workspace session header and a JSON body. Reports and resource bytes
are served as attachments. Workspace state, commercial terms and original
results are private operator files.

The read-only native `inspectOperationHandoff` API supplies the receive page's
payment choices through the original `prepareReview`. It exposes request and
ticket metadata without the bearer. Intake mutations share the original runbook
metadata lease and workspace shutdown queue. `executeRunbook` accepts an optional
trusted `environmentForOperation(op)` function; it resolves after original input
preflight and before the durable started record. This callback is code supplied
by the local workspace, never a manifest field or a received setting. The host
keeps each prepared operator's original three keys and selects the SF81 transport
for that operation. It checks the selected channel before the attempt starts.

The shared panel is served at `/approval-ui/approval-panel.mjs`, with
`/approval-ui/approval.css`. `GET /api/approval` returns:

```json
{
  "approvalMode": "BROWSER",
  "approvalAvailable": true,
  "current": null,
  "approval": null
}
```

`current` and `approval` are explicitly `null` when absent. During an operation,
`current` is `{runId,executionId,operationId,intentId}`, with its actual native
identities. The approval field contains the original SF81 broker object,
including its exact native review and budget.
An authoritative successful read renders that object with the matching intent;
a local busy redraw never declares a disconnected review fresh.

`POST /api/approval` uses the existing `x-runbook-session` header and exactly
`{runId,executionId,operationId,intent,approvalId,requestSha256,decision}`.
The host matches every selected identity and delegates the explicit
`approve` or `reject` decision to the original broker. The private socket and
transport token are selected by the host and stay outside browser payloads.

## Back up acquisitions

Choose **Back up acquisitions** in the existing navigation. Review the common private parent containing the workspace, configurations, operator settings, retained original operators, imported runs and downloads. Stop the other processes writing that state, choose a new archive outside it, and enter the name of the passphrase environment variable already set in the server terminal. The workspace retains progress, native checkpoints, cancellation and the published backup selection.

The same view verifies an existing archive and displays exact restore and reopen commands. Restore runs from the installed CLI after stopping the live workspace and requires its original state root to be absent or empty. See [the complete recovery workflow](RECOVERY.md); verification and restore do not execute a buyer or refresh accounting.

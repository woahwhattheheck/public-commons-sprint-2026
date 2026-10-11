# Buyer runbook workspace

The browser workspace turns the original buyer runbook into a complete local
operator workflow: arrange selected resources, retain draft revisions, review
exact request terms, initialize a frozen acquisition, follow native execution,
recover original results and download saved resources. It uses the existing
runbook engine and original SF88 command for every operation.

## Start with original buyer configurations

Prepare complete SF88 configs using the existing buyer onboarding or merchant
challenge handoff. Put the selected JSON files in a dedicated private directory.
Keep their original signer, policy, ledger, evidence and request-body references
on the same trusted operator host. Each selected operation has its own stable
native intent ID.

Start the workspace from the same controlling terminal used for SF81 approval:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs workspace \
  --state /private/acquisitions/workspace \
  --configs /private/acquisitions/buyer-configs \
  --port 8460
```

Both paths are absolute. Their existing parents must be canonical local paths;
the configuration directory must already exist. Private directories use `0700`
on POSIX systems. The new workspace and its files use `0700` and `0600`.

Open the printed `http://127.0.0.1:PORT` URL. Port `0` selects an available port.
The server binds only to loopback. The page shows whether a controlling terminal
is available, along with the selected configuration directory.

To reopen, use the same state directory. `--configs` can be omitted after the
first start. To include an existing original runbook, add its directory:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs workspace \
  --state /private/acquisitions/workspace \
  --run /private/acquisitions/earlier-run
```

The existing run remains at its original path; the workspace retains a reference
to it. Previously registered runs remain available after later restarts. One
`--run` path can be registered per invocation.

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
original SF88 CLI serially, preserving original live-term lookup, SF81 controlling
terminal approval, signer, SF36 reservations and SF82/SF31 evidence and response
handling. Continue the prompt in the terminal that started the workspace.

One workspace process owns one acquisition execution at a time, keeping its
terminal prompts serial across all opened runs. The original per-run lease also
coordinates with existing CLI processes. Previously attempted operations keep
their original status and are skipped by resumed execution.

**Cancel current execution** addresses the exact execution shown in the page.
It aborts the workspace's own controller, lets the original buyer finish its
cancellation and output capture, and then stops launching further operations.
Closing the workspace with `Ctrl+C` or `SIGTERM` follows the same drain path.
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
and its original HTML renderer.

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
runs,port})` from `workspace.mjs`. It returns `{url,server,model,close}`. The
existing `buyer-runbook` package alias continues to target `cli.mjs`; the new
`workspace` subcommand is available through that alias. Include the complete
buyer-runbook component so `workspace-ui/index.html`, `app.mjs` and `style.css`
travel with the model and server. Its original sibling dependencies remain the
same native buyer and runbook components. There is no new package dependency.

The loopback server checks Host, Origin and browser fetch context. Mutations use
the current workspace session header and a JSON body. Reports and resource bytes
are served as attachments. Workspace state, commercial terms and original
results are private operator files.

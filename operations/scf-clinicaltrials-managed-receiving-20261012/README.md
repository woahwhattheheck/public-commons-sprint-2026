# ClinicalTrials managed receiving

This operating continuation receives an existing complete ClinicalTrials customer workspace through Starforge's original managed Applications lifecycle. It uses the installed merchant runtime, the original application review and request journals, the original SF46 managed home, and the one Python ClinicalTrials owner.

The retained receiving case is the complete Daiichi Sankyo results portfolio: 165 studies from four original response pages, one native dataset edition and the two original study reviews. The selected source packet is 7,936,017 bytes with SHA256 `ed8eb65e0d4fce506390eb50a0e7cd5f91df1e5ce07f4eb83927d9b4538b9416`.

## Files and source

- `receive.mjs` runs the original Review, Save, Connect, Start, Stop and same-application reopen operations. The request IDs, exact input selection and progress stay in `receiving.json`.
- `browser.mjs` opens the original Runtime Applications screen and its original ClinicalTrials link. It inspects the cohort, saved mapping, both reviewed whole studies, all seven sections and the original schema download.
- `run.mjs` joins those two parts for one operating invocation.
- `input-manifest.json` identifies the original retained customer source and the nine managed-source postimages.

Use a complete committed distribution that contains the source-owned Applications provider registry and the ClinicalTrials provider from PR1773. The native runtime inspector checks the installed manifest, dependency profile, package lock and READY state; the ClinicalTrials binding then verifies the original source files, Python interpreter, PRS schema set and workspace identity. The registry and application source must be included by the original distribution builder.

The managed product's full operating instructions are in `sf30-seller-sdk/clinicaltrials/MANAGED_APPLICATION.md`.

## Select the existing runtime and customer source

Keep these paths in the same host filesystem for the duration of the operation. The receiving directory, application workspace and original customer workspace are retained state; choose persistent paths on a VM. In an invocation-private Linux environment, finish the operation and save its resulting files before that invocation ends.

Select an existing complete READY runtime with the original installer. When a new committed source requires its first receiving installation, run the maintained distribution builder against that exact commit and prepare/install the runtime with the original `runtime-install` CLI. The base profile with operator support retains the selected Python host requirement. ClinicalTrials PRS uses the original `prs/requirements.txt` dependency, `lxml`, in the selected Python.

The customer input is the complete original `ClinicalTrials_Customer_Checkpoint.zip`, exact hash above. Restore it once into a new original ClinicalTrials workspace through the installed command:

```sh
starforge clinicaltrials --python /absolute/python --workspace /absolute/customer init
starforge clinicaltrials --python /absolute/python --workspace /absolute/customer --request-id ORIGINAL-UUID restore --file /absolute/ClinicalTrials_Customer_Checkpoint.zip
```

Retain that restore request ID if its response needs reconciliation. The CLI owns and closes the one Python workspace during this initial receiving step. The managed operation begins after that owner is closed.

The original core customer receiver and this managed receiver can consume the same saved packet into their own named receiver directories. Their original capture ID, source hash, native mapping, snapshot and both review IDs remain the same.

## Configure the managed continuation

Create a private JSON file containing the actual selected paths:

```json
{
  "runtimeDirectory": "/absolute/ready-runtime",
  "expectedSourceCommit": "EXACT_COMMITTED_DISTRIBUTION_SHA",
  "sourcePacket": "/absolute/ClinicalTrials_Customer_Checkpoint.zip",
  "packetSha256": "ed8eb65e0d4fce506390eb50a0e7cd5f91df1e5ce07f4eb83927d9b4538b9416",
  "workspaceDirectory": "/absolute/customer",
  "pythonExecutable": "/absolute/python",
  "receivingDirectory": "/absolute/managed-receiving",
  "label": "Retained ClinicalTrials portfolio",
  "browser": {
    "playwrightPackage": "/absolute/existing/node_modules/playwright",
    "browserExecutable": "/absolute/existing/chromium",
    "screenshots": false
  }
}
```

The JSON is an example shape; replace its paths and source commit with the actual runtime selection. Optional `environmentFile` uses the existing Applications environment loader. Optional `homeId` and `applicationWorkspace` select already-registered original managed state. Omitting `applicationWorkspace` creates the original Runtime Workspace below the chosen receiving directory.

Run the complete native and browser operation:

```sh
node run.mjs /absolute/managed-receiving-selection.json
```

The browser uses the existing Playwright and Chromium runtime. The equivalent environment variables are `SCF_PLAYWRIGHT_PACKAGE` and `SCF_BROWSER_EXECUTABLE`. The programmatic `receiveClinicalTrialsApplications(config, {onProgress, onOpen})` export allows an existing native receiver to lend its own browser callback.

## What the same operation does

The receiver first verifies the complete packet bytes and the selected installed runtime. It reads the original ClinicalTrials binding before opening a writer, preserving the existing marker identity, selected Python, PRS schema hashes and original source closure.

It then registers the selected READY runtime in the original Runtime Workspace, prepares the ClinicalTrials application through its source-owned provider, saves the exact review with a retained request UUID, and connects the original SF46 managed home. The ordinary original worker performs adoption and process startup.

The original stdout launch announcement and authenticated `/api/launch` must identify the same selected workspace, Python and adopted source. The original one-line console file must match the application's private URL.

While the original Python owner is running, the receiver:

1. Reads the same 165-study cohort, four page records, native edition, mapping and two existing review IDs.
2. Verifies the full raw JSON bytes and hash of each reviewed study.
3. Attaches the original complete 42-tool ClinicalTrials MCP family to that same console, reads all 165 retained studies through four pages, and receives/reopens the complete original protocol schema file.
4. Closes the MCP borrower and confirms the Python owner and review revision remain available.
5. Opens the managed Applications browser, follows its original link, displays all seven original sections, inspects the same two study histories and exact raw JSON, and downloads the same original protocol schema.

The browser and MCP only read the retained customer for this managed receiving case. Original review, capture, query and publication actions remain available in the product's normal console. The saved core customer workflow already exercises those actions.

Stop goes through the original Applications operation. Completion requires its request threads and publisher bridge to drain, the original Python PID to end, the listener to refuse connections and the owner to remove its unchanged console file. The retained workspace binding is checked again.

The second Start uses the same saved application and workspace. It opens a new private console session, repeats the native/browser receiving against the retained data, and stops through the same original lifecycle. Both passes must retain the same full source/review identity and binding digest.

## Resume and outputs

`receiving.json` stores the original selection, save request, application ID and the two start request IDs. Resume with the same configuration and receiving directory. The receiver reads existing original operations before deciding whether to continue an interrupted worker; an already-complete receiving record returns directly.

The selected source commit, package manifest, installation identity, packet hash, workspace identity and environment selection must match. A changed selection is a new reviewed operation.

Completed output includes:

- `receiving.json`, with both actual start/stop outcomes and exact original state identities;
- `first-open/` and `reopen/`, with each original MCP download/reopen and browser schema download;
- optional screenshots when explicitly selected;
- private MCP connection metadata and the original Runtime Workspace journals.

Keep private connection metadata with the receiving workspace. Share the compact completed result and the original public source/customer files through their existing delivery channel. The launch URL is represented by its digest and loopback origin in the completed result, and the private one-line console file is removed by the original owner on Stop.

If startup or receiving returns an error, the original request and phase remain in `receiving.json`. Open that original application operation and its output. The continuation uses the same original request IDs on resume and never replaces a failed launch with an unrelated process.

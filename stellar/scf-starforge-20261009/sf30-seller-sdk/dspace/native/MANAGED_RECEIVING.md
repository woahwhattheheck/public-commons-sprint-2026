# Managed DSpace operator receiving

This command completes the original DSpace Applications lifecycle and browser workflow using one READY runtime and one complete SQLite project. Its result binds the source commit, package manifest, original input digest, application IDs, running instances and saved data operations.

## Installed inputs

Use Node 24, the selected original Chromium executable, and an existing Playwright ESM entry such as playwright/index.mjs. All path arguments are absolute. Every product and Applications module is imported from the verified READY installation's source root.

The complete project must retain the original 45-record source cohort and saved editions. The repository agent receiver's Repository_Agent_Workspace.sqlite3 is a suitable input; it also carries its reviewed 44-record successor, complete original requests, metadata arrays and file identities.

The surrounding installed operation prepares the SAME maintained distribution TGZ with the original distribution/runtime-install.mjs exports:

1. prepareRuntimeInstall({directory,archive,sha256,native:false,features:[],operator:true,python:'python3'}).
2. installRuntime({directory,offline:true,npm,cache}).
3. inspectRuntimeInstall({directory,load:true,source:true}).
4. inspectMerchantRuntime(directory) from sf46-release/runtime-package.mjs returns sourceCommit and sourceManifestSha256 for the receiver.

The DSpace profile uses Node's original SQLite implementation and the maintained Linux process lifecycle.

## Run in the original installed operation

The installed entry is:

    source/stellar/scf-starforge-20261009/sf30-seller-sdk/dspace/native/managed-receiving.mjs

Its command arguments are:

    node INSTALLED_RECEIVER \
      --runtime-directory READY_RUNTIME \
      --source-commit SOURCE_COMMIT \
      --manifest-sha256 MANIFEST_SHA256 \
      --directory RECEIVING_DIRECTORY \
      --project-file ORIGINAL_COMPLETE_PROJECT \
      --browser-executable CHROMIUM_EXECUTABLE \
      --playwright-module PLAYWRIGHT_ESM_ENTRY

The source commit is forty hexadecimal characters; the manifest digest is sixty-four. The receiver writes its two independent project copies, Applications workspace, browser profile, journal and final downloads inside RECEIVING_DIRECTORY.

For an enclosing Node process, import and await:

    receiveDspaceManagedApplication({
      runtimeDirectory, expectedSourceCommit, expectedManifest,
      directory, projectFile, browserExecutable, playwrightModule
    }, {onProgress, signal})

The export returns the same serializable result saved in RESULT.json. It throws when an operation remains unfinished and retains the original journal and issue. The enclosing installed operation owns the single execution and final package.

## Native lifecycle and browser work

The receiver imports createRuntimeWorkspace and openRuntimeWorkspace, attaches the selected READY runtime, and performs the original applicationsReview, applicationsSave, applicationsConnect, applicationsStartReview, applicationsStart, applicationsRecover and applicationsStop calls. Save and start IDs are journaled before dispatch. Both applications share the selected release and use separate private operator and project directories.

The actual Applications browser opens each repository operator through its retained Open application link. One context holds two tabs on operator A and one tab on operator B, making the cross-port cookie behavior observable.

| Phase | Receiving result |
| --- | --- |
| Project intake | Both native receivers retain the input workspace, source rows, metadata versions and editions. |
| Applications | Review, save, connect, start and Open retain the selected source and private directory identities. |
| Source review | All source pages are read; a complete metadata object is compared; original source bytes download with their actual SHA. |
| Dataset | All query pages use the original engine; CSV, configuration and complete edition downloads keep their hashes. |
| Project transfer | A complete project is received; stale-tab reads and writes receive the original project-scope rejection. |
| Response loss | One actual review commits, its response is interrupted, and its original request remains in the browser. |
| Concurrent tab | Another tab cannot replace that pending request or dispatch a replacement mutation. |
| Reconnect | The saved request stays bound to its original project until the operator explicitly reconnects. |
| Restart | Applications stops and reopens A on its original port; old-instance requests reject. |
| Same request | Explicit reconnect and retry recover the same committed review and operation count. |
| Complete handoff | The final project opens in B with its original review, operation and native query. |
| Mobile and closure | The same project reopens at mobile width; both processes stop and Applications history reopens. |

The response interruption forwards the actual request to the original operator and retains its committed result before interrupting delivery to the browser. Subsequent recovery uses that native operation ID and its exact retained input.

## Same-origin recovery

IndexedDB and localStorage belong to the browser origin, including its port. The receiver records two explicit available ports before reviewing either application and reuses A's exact original port at restart. Keep that explicit port in a customer's saved application configuration when reopening browser drafts or a pending request.

The private operator directory retains the project registry and original workspaces. A running instance ID changes on restart. A saved browser request retains the operator, project, workspace and instance it addressed. Use Reconnect original workspace, inspect its target, then Retry saved request. The receiver exercises these actual page controls.

For an interrupted run, restore its original absolute directory and selected runtime, then invoke the same command with the same source and project arguments. The journal preserves completed phases, exact save/start IDs and data requests. Existing managed operations are inspected and recovered through their original lifecycle; completed runs remain in history.

Preserve the Applications records, operator/project directories, browser profile, journal and artifacts together during a host transfer. On per-process temporary storage, keep preparation, installation, both native receiving commands and archive creation in one invocation. Close the writers, then preserve the original state and outputs before that filesystem disappears.

## Finished package

A successful RESULT.json has state PASS, exact source selection, actual phase results, both application histories and an artifacts array. The explicit handoff contains:

- Original_Repository_Source.json, the complete original source download.
- Native_Query_Pages.json, every original dataset query page.
- Repository_Dataset.csv and Repository_Dataset_Config.json.
- Repository_Edition.json, the complete edition and lineage.
- Repository_Before_Managed_Review.sqlite3 and Repository_Managed_Workspace.sqlite3.
- Desktop Applications/source/query screenshots and mobile reopen screenshot.
- journal.json, retaining source selection, actual requests, outcomes and managed operation IDs.

The enclosing installed operation includes these files in its existing customer package with the distribution TGZ, original profile, dependency lock, install result and repository agent outputs. Receive Repository_Managed_Workspace.sqlite3 through the normal Delivery & receiving page to continue the complete saved work.

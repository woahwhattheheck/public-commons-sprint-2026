# Catalog Atlas in Applications

Catalog Atlas runs the original retained catalog and buyer preparation workspace through the existing managed Applications worker. The saved application retains its installation, data directory, live-source choice and each original process operation.

## Open an installed workspace

1. In the existing runtime console, select a READY installation containing the `atlas` command and `sf61-bazaar-explorer/managed-launch.mjs`.
2. Choose **Applications → New application → Catalog Atlas**.
3. Enter a label and the **Private Atlas workspace**. Choose the original workspace, a completely received workspace, or a new directory inside an existing private parent.
4. Leave both catalog origins empty to use retained source pages. To browse a live catalog alongside them, select one explicit origin using the settings below.
5. Choose **Review application**. Inspect the selected installation, retained input files, original command and data directory.
6. Choose **Save application**, then **Review start → Start reviewed application**. The original managed release and worker own this launch.
7. **Open application** appears after the original Atlas process publishes its matching private launch. It opens the saved workspace in the Atlas browser.

| Setting | Purpose |
| --- | --- |
| Private Atlas workspace | Original or received directory, or one new directory in an existing private parent. The directory belongs to the current operator and uses private permissions. |
| Public HTTPS catalog origin | Optional original public facilitator root, such as the HTTPS origin of the catalog you intend to inspect. Atlas applies its existing public-source rules. |
| Local seller catalog origin | Optional original seller catalog at an explicit `http://127.0.0.1:PORT` origin. Select this or the public source. |
| Local port | Use `0` to let Atlas choose an available loopback port. A selected fixed port must match the original listener. |
| Private environment JSON | Optional host-local environment values through the existing Applications environment mechanism. |

An application with both catalog origins empty opens its retained directory directly. Choosing a live source enables the same original Atlas discovery controls above that workspace. Changing a catalog origin requires reviewing and saving the changed application settings.

The saved command has this form:

```text
starforge atlas --workspace /private/catalog --managed-source /private/runtime/source/stellar/scf-starforge-20261009/sf61-bazaar-explorer --port 0
```

Applications derives `--managed-source` from the selected installation. Its form presents the runtime and useful data/source choices; the native source path travels with the reviewed command.

## Complete the catalog-to-buyer workflow

The original Atlas browser provides the following source intake controls:

- **Open capture folder** receives an original SF88 capture containing `session.json`, `manifest.json` and its `page-NNNNNN.json` files. Reopening the same capture resumes its missing pages. The original native capture reader validates the completed source.
- **Open saved page** retains an original native discovery page or an Atlas observed-page export. Its coverage stays attached to that original page.
- **Retain displayed page** saves the current original live observation into the same workspace.

Open a saved catalog, search its retained rows and choose a concrete advertised payment option. The saved request retains the original page, row and accept index. In **Buyer requests**, select saved requests to compare their exact original terms, then open the intended request.

Enter its stable operation ID, concrete URL, method and headers. Body and operation-ticket controls can keep the retained input, replace it with exact UTF-8 text or remove it. A replaced empty body remains a present zero-byte body. **Prepare and save revision** invokes the original SF88 preparation and retains that revision's inputs, source and configuration.

**Download buyer configuration** and **Create buyer handoff** continue into the original buyer. The handoff carries its original discovery and retained request inputs. Use the handoff's selected accept index when receiving it through the existing buyer import command. The original buyer owns operator settings, review, approval, reservation, signer and execution.

For a downloadable asset, Atlas displays the advertised file checksum, byte count, type and name and requires an absolute output path on the buyer host. Its saved buyer configuration contains those original receiving checks. Continue with the original buyer's configuration review and initialized operator workspace. The full file workflow and exact native commands are in [WORKSPACE.md](./WORKSPACE.md).

## Stop and reopen

Closing the Atlas tab or the runtime console leaves the managed process available through its original operation. Open the same saved application to return to its current private URL.

**Stop application** targets its existing run ID through the original managed worker. Atlas retires that launch record while it still owns the workspace lease, then drains its original server and workspace. The worker retains the actual process exit and completed stop state. An old launch record cannot redirect a later run.

After a confirmed stop, choose **Review start → Start reviewed application** again. This creates a reviewed new process operation over the same retained Atlas data and issues a fresh private URL. Catalog captures, saved request IDs, prepared revisions and handoffs remain in their original workspace.

Editing the workspace or source settings requires reviewing and saving that application revision. A changed `workspace.json` between review and start requires a fresh start review. Source and input changes use the existing Applications comparison and recovery controls.

## Receive the complete workspace on another host

Stop the original Atlas application before opening the transfer CLI, so the original workspace writer has closed. Export the complete workspace using the installed command:

```sh
starforge atlas-workspace export \
  --workspace /private/catalog \
  --output /private/catalog-transfer.ndjson
```

Move that complete private transfer file to the receiving host. The native inspection and receiving commands retain its original workspace, member paths, hashes and byte counts:

```sh
starforge atlas-workspace inspect --input /private/catalog-transfer.ndjson

starforge atlas-workspace receive \
  --input /private/catalog-transfer.ndjson \
  --workspace /private/received-catalog
```

If that receiving operation was interrupted, continue the same input and target:

```sh
starforge atlas-workspace receive \
  --input /private/catalog-transfer.ndjson \
  --workspace /private/received-catalog \
  --resume
```

The receiver finishes its original source members and native workspace manifest, then commits its completion record. Applications reads these original records before opening a received directory. The same native transfer command completes an interrupted receive.

In the receiving runtime console, select a READY installation carrying this Atlas source and create a **Catalog Atlas** application using `/private/received-catalog`. Complete the original review, save and start steps. Open the received catalog and request to continue with its preserved identity. For file delivery, prepare a revision using an explicit output path on that receiving buyer host.

The workspace transfer carries original source pages, selected requests, retained input files, configuration revisions and operation handoffs. The receiving managed application creates its own original process operation and private session URL. Runtime installation, managed worker state and buyer execution credentials retain their existing transfer and authorization workflows.

## Resolve the original operating state

| Situation | Operator action |
| --- | --- |
| The selected installation lacks Atlas managed source | Select a READY installation containing the merged Atlas command, managed launch module and Applications adapter. |
| A received directory reports `ATLAS_WORKSPACE_RECEIVING` | Continue its original `atlas-workspace receive` with the same input, target and `--resume`; reopen after that receive completes. |
| Original inputs changed after review | Refresh the saved application, review the current inputs and start the resulting reviewed operation. |
| The workspace already has a running owner | Open or stop that original Atlas operation through its owner, then review the next start. |
| Runtime console restarted | Reopen the saved application and its retained operation. A live worker exposes the same original Atlas session; a stopped operation retains its completed result. |

## Native integration

`distribution/runtime-workspace/application-atlas.mjs` supplies `atlasApplication(common)`, `prepareAtlasApplication(settings, inputPath, runtimeDirectory)` and `atlasStartup(request, text)`. It derives the original Atlas source from `inspectMerchantRuntime`, retains the selected directory and native input files, and uses the selected server's original source normalizers.

`managed-launch.mjs` supplies a read-only workspace identity inspection and the original process's private launch writer/reader. The compact startup schema is `stellar-forge.sf61.atlas-launch.v1`. Its private record binds the workspace ID, manifest at startup, selected source files, source mode and origin, process ID, launch instance and actual capability URL. Shutdown retires the record while the original workspace lease is held. Applications' existing worker records the process lifetime.

The Applications observer reads that original record through the selected runtime's native reader before saving its existing `application-url.json`. It checks the reviewed directory, source, port and announced process/instance. Its URL saving uses the same serialized observer chain as the other original applications.

The existing SF61 and distribution component selections carry these files. The same `atlas` command and original Applications worker provide the installed workflow.

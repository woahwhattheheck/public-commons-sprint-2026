# Timescale commissioning receiving

This guide joins commissioning to the original Timescale native and remediation receiving operation. The original native project, source selection, publisher, dataset, and retained outcomes remain the basis of the work.

Complete the pinned native operation first. Its source commit is `c2ff3fecf7749f484dee7edb0a9583871e8e17b6`. Then record the full, final merged commissioning commit as a subsequent source adoption. Keep the original invocation and its checkpoint unchanged. The commissioning receiver uses the existing Timescale client and owner to create the technical project, compare the retained sources, record the assessment, and export and reopen the complete project.

## Continue with the installed receiving command

The existing `starforge timescale-remediation-receiving` command implements this continuation. Use its original native result, merchant configuration, workspace alias, and remediation receiving directory. Add the exact final commissioning source commit and a separate private continuation directory:

```bash
starforge timescale-remediation-receiving \
  --native-result /absolute/original-operation/native/native-demo.json \
  --config /absolute/original-operation/native-receiving/merchant/merchant-mcp.json \
  --workspace usage \
  --directory /absolute/original-operation/remediation-receiving \
  --commissioning-source-commit FINAL_MERGED_40_CHARACTER_COMMIT \
  --commissioning-directory /absolute/original-operation/commissioning-receiving
```

Replace the example paths with the exact original operation paths. The source argument is the full merged commissioning commit, not the earlier native commit or a branch name. When supplying private inputs, add both `--commissioning-intake-file /absolute/original-intake.json` and `--commissioning-adoption-file /absolute/original-adoption.json`.

A completed remediation receiving record is verified against its saved full report, package, and receive receipt. The command then skips those original phases, including its previous later capture, and runs the commissioning continuation. If the original receiving is incomplete, the same command first continues its retained original phases; it does not replace their request IDs. The new commissioning portion adds no database capture, refresh, job change, publication, or browser phase.

The original `receiving.json` retains `commissioning.input`, including the source adoption, complete supplied-file hashes and original report/package identities, before the new continuation starts. The command passes the recorded byte counts and SHA-256 values as `expectedInputFiles` to the receiver, which checks the exact bytes before any project action and again when reopening retained inputs. A file changed while earlier native phases were finishing cannot be imported under the earlier file identity. It retains the completed commissioning result before closing the owner. The commissioning directory has its own complete `receiving.json` and exact requests. Repeat the same command and directories after interruption; changing any selected source or supplied file is rejected against that original binding.

The command without commissioning options keeps its existing behavior. No separate commissioning host, credential, or native launcher is required.

## Existing owner integration

The installed command calls `runTimescaleCommissioningReceiving` inside the original receiver's existing `try/finally`, after its original phases complete. Its `launch()` owns the merchant configuration, workspace names, retained ports, environment, and exact publisher binding. It supplies the actual restart and received-model callbacks shown below. This is the implemented integration in `timescale-remediation-receiving.mjs`; it is also the callback contract for another already-owned receiving continuation.

The following fragment shows those ownership boundaries; its variables refer to the original caller's existing records and functions:

```js
const ownerView = async () => ({
  client: await openTimescaleClient({
    url: host.startup.mcpUrl,
    workspace,
    workspaceId,
    tokenEnv,
    environment
  }),
  operator: host.operator,
  publisher: binding.publisher,
  workspaceDirectory: binding.publisherDirectory,
  bindingSha256: binding.bindingSha256
});

try {
  // The existing receiver completes or reopens its original native phases here.

  const commissioning = await runTimescaleCommissioningReceiving({
    owner: await ownerView(),
    nativeResult: completedNativeResult,
    directory: commissioningReceivingDirectory,
    sourceAdoption: {
      nativeSourceCommit:
        'c2ff3fecf7749f484dee7edb0a9583871e8e17b6',
      commissioningSourceCommit: finalMergedCommissioningCommit
    },
    // When using supplied inputs, pass both of these exact original files:
    // intakeFile: originalPrivateIntakeFile,
    // adoptionFile: originalPrivateAdoptionFile,
    actor: originalReceivingActor,
    onPhase: recordOriginalPhase,
    restartOriginal: async transition => {
      await host.close();
      host = null;
      await launch();
      return await ownerView();
    },
    withReceivedWorkspace: async (receipt, inspect) => {
      const received = await openTimescaleWorkspace({
        directory: receipt.directory,
        environment
      });
      try {
        return await inspect(received);
      } finally {
        await received.close();
      }
    }
  });

  // Retain this returned result in the same original receiving journal.
  // The original owner remains available for the caller's remaining work.
} finally {
  await host?.close();
}
```

Use the final merged 40-character source commit for `finalMergedCommissioningCommit`; a moving branch name does not identify this source adoption. `completedNativeResult` is the original complete native result. `commissioningReceivingDirectory` is a dedicated continuation directory inside the original operation's retained output.

The installed receiver's existing `launch()` reopens the same `startTimescaleAgentWorkspace` configuration, workspace, browser and MCP ports, token environment, and `expectedBindingSha256: binding.bindingSha256`. Its retained ports and binding are the restart contract. Keep the caller's original lifetime and cleanup around the new call. The module does not create another owner configuration, credential, database, or browser. Programmatic callers with separately retained supplied-file identities may also pass `expectedInputFiles: {intake: {bytes, sha256}, adoption: {bytes, sha256}}`; the installed command supplies it automatically for the two input files.

## Choose the intake and explicit adoption

There are two supported input forms.

With no supplied files, the receiver derives a clearly labeled technical intake from the actual native-demo source, selected window, and retained outcomes. It supplies the receiving technical owner and four technical criteria. These values describe that demonstration's observed technical scope.

For a supplied intake, pass **both** `intakeFile` and `adoptionFile`. Each must be a complete original UTF-8 file of at most 1 MiB. The receiver retains their exact bytes once under the fixed storage aliases `inputs/intake.json` and `inputs/adoption.json`; their descriptors preserve each literal original basename. Derived defaults use those actual basenames. Company and plant inputs stay in the private receiving operation; public source carries the generic integration.

The adoption file uses schema `stellar-forge.timescale-commissioning-receiving-input.v1`:

| Field | Required binding or decision |
| --- | --- |
| `nativeOperationId` | The exact original native operation identity. |
| `workspaceId` | The original persistent Timescale workspace UUID. |
| `sourceSelection` | The complete selection from the original select operation's `input.selection`. |
| `title`, `owner` | The supplied project title and accountable technical owner. |
| `contract` | Every key in `intake.source_contract`, each with `value`, `disposition`, and `reason`. Dispositions are `PROVIDED`, `PENDING`, or `NOT_APPLICABLE`. |
| `criteria` | Every original `intake.acceptance[].id` exactly once, with `decision`, `assessment`, optional `owner`, `references`, and `checks`. |
| `handover` | `disposition` (`ACCEPTED` or `WITH_OPEN_ITEMS`), `statement`, and `followUpOwner`. |

Criterion decisions are `PASS`, `FAIL`, `DEFERRED`, `NOT_RUN`, and `NOT_APPLICABLE`. A mapped `PASS` must cite retained evidence and at least one true observed fact. Keep unprovided contract values and unresolved decisions explicit. A technical handover decision does not establish a customer contract, commercial acceptance, or production authorization.

### Evidence references

Use the receiver's exact aliases:

| Evidence kind | Aliases |
| --- | --- |
| Complete source records | `jobs-before`, `jobs-after`, `customer-baseline`, `customer-observed` |
| Native comparisons | `catalog-comparison`, `customer-comparison` |
| Original observed operations | `capture-before`, `capture-after`, `job-change`, `refresh`, `verification`, `projection`, `extraction` |

Supported fact names are:

`source_bound`, `catalog_changed`, `catalog_matches`, `customer_matches`, `native_capture_complete`, `native_job_change_complete`, `native_refresh_complete`, `native_verification_matches`, and `native_publication_complete`.

The receiver compares the complete retained jobs before and after the native change, preserving the real mismatch. It also compares the saved customer baseline with the current preview from the same retained run, preserving the real match. All columns participate, including strings, null values, and duplicate rows. These comparisons use the retained original source and outcomes; they do not rerun database capture or publication.

## Run, retain, and recover

The receiver uses stable original requests and retains each exact request and returned attempt before advancing. Keep the same receiving directory, native result, source-adoption commits, input files, publisher binding, and source selection when continuing an interruption.

It creates the commissioning project's source records, complete comparisons, criterion mappings, assessment, and technical handover through the original model. The report phase retains a complete manifest and a partial download checkpoint, reopens the original owner through `restartOriginal`, and resumes the original report transfer. The returned owner uses the same endpoint, retained ports, and persistent workspace. The module then exports the original whole project, receives it through the existing project receiver, and inspects the reopened workspace through `withReceivedWorkspace`.

If a response is interrupted, reopen the same operation and resolve its retained requests and transfer state. Preserve its completed files and attempt envelopes. A changed input or source binding requires an explicit new reviewed continuation; it must not replace an existing operation's original input. The original caller's `finally` closes the owner on success or failure.

## Complete receiving files

The retained output contains the following material:

| Path | Contents |
| --- | --- |
| `receiving.json` | Original receiving identity, source adoption, completed phases, and results. |
| `inputs/` | Complete `native-demo.json`, `edition-before.json`, `edition-after.json`, `publisher-inspection.json`, `customer-baseline.json`, `customer-observed.json`, `intake.json`, and `adoption.json`. |
| `requests/` | Exact native requests and their retained attempt envelopes. |
| `results/` | Complete comparisons, acceptance mapping, initial handover, project result, and report-prefix checkpoint. |
| `report/` | `Timescale_Commissioning_Manifest.json`, `report.json`, `report.html`, and original `download-state/`. |
| `download/` | The complete original Timescale project export. |
| `customer-project/` | Original receive receipt and the reopened project workspace and dataset. |

The complete source contract, decisions, references, and project history travel through the original project export. The literal adoption input is retained separately in `inputs/adoption.json`; do not assume that raw mapping file is a member of the project ZIP.

Return the complete receiving result and its declared report and project artifacts with their native identities and full byte hashes. Keep execution claims tied to the actual retained result: authored source, an admitted operation, and a completed native receiving are distinct states.

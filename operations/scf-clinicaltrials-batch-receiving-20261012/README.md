# Original disclosure batch MCP receiving

This continuation reads the existing ClinicalTrials batch after the operator has completed its native review and saved its batch export. It borrows the original authenticated Python console. The operator keeps the Workspace and its source lease open until this callback returns.

## Complete source

Use the committed repository-shaped source at `a1700f90b92fd7879a5ede18f11f9bfe1b24b92d` or a private source directory containing the twelve exact members in `source-manifest.json`. The manifest includes each native Git blob, UTF-8 byte length and SHA256. These modules use Node builtins and the existing Linux `flock` command; the callback requires no external Node package or MCP SDK.

The ClinicalTrials Python owner still uses its original NDJSON/XML and PRS dependencies. The callback attaches that running owner and does not start a Python process.

## Invocation

```js
const { runClinicalTrialsBatchMcpJourney } = await import('/retained/operations/scf-clinicaltrials-batch-receiving-20261012/run-mcp-receiving.mjs');
const result = await runClinicalTrialsBatchMcpJourney({
  sourceRoot: '/private/complete-source',
  consoleUrl: originalConsoleUrl,
  outputDirectory: '/retained/original-batch-operation/mcp',
  batchId: originalBatch.id,
  exportId: originalBatchExport.id,
  expectedEntries: originalBatch.entries.length,
  expectedRevision: originalState.revision
});
if (!result.passed) throw new Error('Original batch MCP receiving did not complete.');
```

Keep the connection URL private and pass it directly in memory. `sourceRoot` contains both repository top-level `stellar-forge/` and `stellar/`; it is not the nested ClinicalTrials source directory. The source manifest defaults to this callback's sibling file and may be passed explicitly as a parsed object.

## Operating result

The original native catalog advertises 43 exact tool names: 25 Clinical controls and 18 original source controls. The callback verifies the source manifest and authenticated catalog, pages the original batch/export inventories, and reads each reviewed row with its original/current XML, plan, composition, reconciliation and source links. It then retains every file declared by the selected original batch export through the native one-read MCP file transport, receives it completely, compares its bytes and SHA256, and reopens it through the original completed-download lease.

The callback closes its own MCP listener, verifies that the original Python console still serves the same revision and source/review identities, attaches a new MCP borrower to the same console, and reads the same batch/export again. It saves `journey.json`, the original complete batch/export JSON, each row's full native report, and the completed file receiving directories beneath the selected output directory. Exact pending download state can be resumed with the same directory, batch ID and export ID.

After the callback returns, the existing operator performs its normal portable export/restore and closes its original owner. Preserve the complete customer files and source operation result together in the original delivery. The private `clinical-console.url` is a connection credential and is excluded from public deliverables.

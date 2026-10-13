# Complete Runtime procedure receiving course

This manual course operates the maintained Runtime workspace model, its original Operating Plan and Returned Work engines, and the installed Runtime CLI. It keeps one original operating case with full inputs, source identities, requests, results and customer handovers. Run it explicitly after composing the complete source; it is outside the default test and CI paths.

## Run the complete course

Use Node.js 22.16 or later, the maintained source checkout and the existing native `flock` executable. The source directory must contain the complete maintained Runtime workspace and its declared sibling dependencies.

```sh
node stellar/scf-starforge-20261009/distribution/runtime-workspace/receiving/RUNTIME_PROCEDURES_RECEIVE.mjs \
  --source /absolute/source/stellar/scf-starforge-20261009/distribution/runtime-workspace \
  --operation /absolute/private/SCF-RUNTIME-OPERATING-PROCEDURES-RD12-20261013
```

The operation directory's real parent must exist. The course creates this private directory when needed, then retains its native `receiving.guard` for the full invocation. Reuse the same arguments and directory for continuation. Every actual CLI descendant inherits that same kernel lease; a lost outer caller does not authorize a competing controller.

By default, the original operator, independent returning operator, and final cold recipient have separate Runtime workspaces beneath this one case. They are initialized through the original `createRuntimeWorkspace` function. The course creates its own attributed procedure and observes the actual state of these workspaces. It does not install, start, repair or replace a runtime.

You can use three existing independent workspaces instead:

```sh
node /absolute/source/runtime-workspace/receiving/RUNTIME_PROCEDURES_RECEIVE.mjs \
  --source /absolute/source/runtime-workspace \
  --operation /absolute/private/SCF-RUNTIME-OPERATING-PROCEDURES-RD12-20261013 \
  --workspace /absolute/private/original-runtime-workspace \
  --receiver /absolute/private/returning-runtime-workspace \
  --cold-receiver /absolute/private/final-receiving-workspace \
  --selection /absolute/private/original-runtime-selection.json \
  --source-file /absolute/source/discovery/operating-plan.mjs
```

Those existing workspaces must have complete original configuration and distinct identities. They retain their original records. The course adds only its own procedure and related request history. The optional selection document uses the existing procedure API shape:

```json
{
  "runtimeIds": [],
  "operationIds": [],
  "archiveIds": [],
  "backupOperationIds": []
}
```

Select actual retained IDs, and optionally add the original absolute `storageDirectory` when selecting saved backup operations. The independent recipient records its own actual Runtime state separately. The complete source file must fit the original 24 MiB OperatingFile limit. It is preserved byte for byte with its complete prior editions.

## What the original operation carries through

The course creates an attributed manual procedure from actual Runtime observations, attaches a complete original source file, and records a result with another full source capture. It confirms that an older document hash cannot overwrite a saved edit and that a changed request cannot reuse a retained request ID.

The independent operator receives the complete procedure JSON. Its new receiving request is appended after the unchanged original history. It then records its own receiving observation and returns a complete fork with both a conflicting result and a later full edition of the ordinary carried source file. The original operator saves its own intervening edit, reviews each returned change through the original comparison engine, and applies the complete return. The resulting record retains the completed comparison, original and incoming source captures, all plan revisions, and both full ordinary file editions.

The same apply request is replayed and must return the exact already-saved result. The final complete JSON, complete HTML handover and returned-work HTML are published as private files. The original CLI receives that complete JSON into the final independent workspace. Reopening that workspace must recover the same procedure; replaying its exact receiving request must preserve the saved result. Finally the CLI exports the original complete plan and its bytes are compared with the reviewed plan.

The complete HTML handover permits carried-file downloads inside its static historical plan frames. Those frames receive no script, form or same-origin sandbox permissions.

## Continue and inspect the retained case

The operation retains:

- `case.json`: original case identity, selected source bytes and stable action IDs.
- `requests/`: exact complete API requests and CLI intents saved before execution.
- `results/`: full results of completed stages, reused on continuation, with each executed stage's source and attempt in a separate provenance file.
- `logs/`: unique per-attempt controller records and full native CLI stdout/stderr.
- `handover/complete-procedure.json`: full editable procedure and history.
- `handover/complete-procedure.html`: every saved plan edition and returned-work review.
- `handover/returned-work.html`: the completed original return comparison.
- `handover/complete-plan.json`: the CLI's complete reviewed Operating Plan.
- `result.json`: the final source, original identities, outputs and completed-course result.

Every invocation unconditionally reopens all three current procedures and compares their full records with the original completed stage results, then verifies every outgoing file's complete bytes and hash. A later change or missing file prevents a new completion report. Prior completion reports are retained separately; cached steps keep their original execution provenance instead of being attributed to changed source in a later attempt.

Every new result is written to a unique temporary name, fsynced and atomically published; existing complete outputs must match exactly. Source repairs can be applied to the maintained source and continued against the same case: each actual attempt records its complete selected module hashes. The originally selected source file and workspace bindings remain fixed for that case.

If a process stops after a native API mutation but before its stage result is saved, continuation reuses the exact saved request. If the CLI completed its create-only plan export before its result was recorded, continuation verifies the original intent and complete output bytes instead of trying to overwrite the file. Prior command logs and interrupted temporary files remain available.

A failed workspace initialization is kept at its original path for reconciliation. The course never discards an incomplete original workspace or replaces a saved Runtime identity. Supplied existing workspaces must be fully initialized before this operation uses them.

## Source and execution status

The companion pure-core receiving result operates the unchanged original OperatingPlan and Returned Work source with manual steps, a complete source file, a conflicting returned fork, exact apply replay and complete-history receiving. The native course above is the separate filesystem, original model, kernel lease and CLI operation. Its `result.json` records actual completion only after all those stages finish.

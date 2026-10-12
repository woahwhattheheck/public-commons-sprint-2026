# Buyer receiving in Applications

Buyer receiving brings the original buyer runbook into the installed Applications lifecycle. Use it to receive a merchant's SDK, request or paid-file order, set up this buyer, approve acquisitions in the browser, and reopen the resulting files and accounting.

## Open the application

Select the READY installation that includes Buyer receiving, choose **Buyer receiving** in Applications, and enter the private buyer workspace directory. A new workspace needs an existing private parent directory. An existing workspace keeps its configurations, received sources, operator settings, acquisitions and recovery records.

Review and save the application, then review its current Start request and select **Start**. **Open** uses the original listener announced by that selected installation and checked against the running buyer instance.

| Field | Use |
| --- | --- |
| Private buyer workspace | Required. The original receiving state, or one new folder. |
| Original buyer configurations | Optional existing private configuration directory. A new workspace can create its own; an existing workspace remembers its selection. |
| Original operator settings | Optional existing private preset. The receiving console also provides Local buyer setup. |
| Paid-file claim environment names | Optional existing variable names separated by commas. The values remain in the host environment. |
| Existing acquisition to open | Optional original runbook directory to import and reopen. |
| Local port | Use 0 for an available port, or select a port for this instance. |
| Private environment JSON | Optional original Applications environment file for the host's signer, transport, claim and recovery requirements. |

The managed entry uses browser approval. It starts the maintained buyer console directly through the selected installation's registered buyer-runbook command.

## Receive and acquire

1. Open **Local buyer setup**. Review the actor, service, public payer, selected Python executable, signer reference and integer budget limits. Save this host's original preset. Its version history remains in the receiving workspace.
2. Receive the original merchant request, paid-file order, or completed SDK export. SDK receiving retains the completion receipt and its five named source files. Use the native request editor to select the route, payment option, path/query values and request body.
3. Review the exact request and prepare its original buyer workspace. Existing preparations reopen their retained operator and inputs.
4. Open the acquisition and run its selected operations. The shared approval panel shows the actual request, accepted payment terms, expiry and original ledger budgets before the configured signer runs.
5. Open the original result or downloaded file. Continue accounting, delivery and recovery from that acquisition's existing records.

The receiving console uses the existing SF88 buyer, SF81 approval bridge and SF36 ledger. Its request and paid-file handlers supply the operation's original private environment. The browser approval channel is attached to that same operation immediately before native execution.

## Stop and reopen

Use the application's existing **Stop** action. The original console cancels its active operation, closes pending approval and drains its model, HTTP listener and approval broker. Reopen the same saved application to continue using the same source and acquisition history.

An interrupted acquisition retains its attempt and native output. Use its original recovery and accounting actions to reconcile that attempt. Already attempted operations retain their existing execution identity.

The receiving application's encrypted recovery workflow includes the selected original operators and receiving state. Review the complete original state root, capture the archive through the console, and use the maintained restore command. After restoration, select that original workspace in Applications.

## Installation and changed selections

The selected installation must include the maintained runbook launch helper, host, local setup and shared approval components. Browser approval uses the host's private Unix socket support and the original selected Python bridge.

Applications binds its review to the selected installation, original workspace declarations, explicitly selected inputs and launch source. If one changes between review and Start, review the current selection again. Editing the buyer's local preset, receiving another request or completing an acquisition remains part of the running original workspace.

Only environment variable names and public signer references appear in setup and launch records. Use the existing private Applications environment file to supply host values.

## Maintainer integration

The application-buyer-runbook.mjs module exports the catalog descriptor, preparation adapter and startup reader. Preparation imports inspectRunbookWorkspaceSelection from the selected runtime's buyer-runbook/launch.mjs; it does not instantiate an intake, initialize a ledger or read operator keys.

The adapter retains the returned semantic selection and source digest in the existing private application request as buyerRunbook. It invokes:

    buyer-runbook workspace --state ABS --approval-mode browser --expected-selection-sha256 SHA256

Optional original flags preserve the chosen configurations, declared operator preset, paid-file claim names and initial run. The common Applications code supplies the selected port and private environment through its original managed worker.

The CLI checks the original selection before opening the workspace and emits one compact JSON startup record with schema stellar-forge.buyer-runbook-workspace-launch.v1. The startup reader matches that record against the saved request and verifies the same instance at the original listener's /api/launch. It then records the URL through the existing Applications output mechanism.

Source editions and native initialization semantics remain owned by the original runbook. The integration adds a managed entry and browser approval to that product; saved configurations, intake and acquisition records retain their existing formats.

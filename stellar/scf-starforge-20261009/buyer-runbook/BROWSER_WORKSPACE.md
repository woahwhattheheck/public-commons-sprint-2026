# Buyer workspace with browser approval

Open the existing buyer workspace from Applications to receive merchant SDKs, prepare requests and paid files, and operate saved acquisitions in one place. The Local buyer setup, original SF88 buyer, signer and native budget governor remain the same workflow.

## Start an existing workspace

Select the same private workspace and configurations directory used for its saved requests. Applications reviews the selected source and directory binding, then starts the original command with browser approval enabled.

For a direct launch:

```sh
node buyer-runbook/cli.mjs workspace \
  --state /absolute/private-workspace \
  --approval-mode browser \
  --port 0
```

Use the URL in the single JSON startup line. Keep this process running while operating the workspace. An existing workspace resolves its retained configurations directory automatically. A new workspace creates its private default configurations directory.

Optional existing host selections:

| Flag | Original input |
| --- | --- |
| `--configs` | Existing private configurations directory. It must agree with an existing workspace. |
| `--operator-settings` | Host-declared original operator preset. Local buyer setup can also retain the host settings in a new workspace. |
| `--claim-envs` | Comma-separated names of existing claim-token environment variables for paid-file delivery. Their values remain in the launching host. |
| `--run` | An existing original run to import into this workspace. Its plan and import identity are retained. |
| `--port` | Loopback port. Use `0` to let the host select an available port. |
| `--approval-mode` | `browser` or `terminal`. The direct command defaults to `terminal` for existing terminal workflows. |

## Receive and operate

1. Open **Local buyer setup** to review the saved host identity, selected signer source and native limits. Save a reviewed version if the host needs configuration.
2. Receive the merchant's original SDK completion receipt and its declared files, an operation handoff, or a paid-file order through the existing receiving view.
3. Review that request and prepare its original buyer configuration. Add the prepared operation to a draft, review the complete acquisition, and initialize its saved run.
4. Open the acquisition and start its selected operation. The original buyer reads the merchant's live payment terms and produces the native operator review.
5. In browser mode, read the exact operation, request, asset, amount, expiry and current budget projection in **Purchase approval**. Approve or reject that review.
6. Continue in the same acquisition to inspect the original result, retrieved content, paid-file transfer and accounting state.

An approval belongs to one run, execution, operation and native intent. Navigating to another acquisition requires a fresh read of that acquisition's active review. A disconnected or expired panel refreshes its original state before another decision becomes available.

The selected browser channel is checked before the original runbook records an attempt. A missing local prerequisite can therefore be repaired through the existing workspace and the same untouched operation. Once the original attempted record exists, the runbook's existing recovery and no-automatic-retry behavior applies.

## Cancel, Stop and Reopen

**Cancel** retires the current pending browser review and interrupts the original execution. Its saved acquisition records the resulting native state.

**Stop** in Applications, or SIGINT/SIGTERM in the direct command, stops accepting new operations, cancels pending reviews, drains the original execution and closes the HTTP listener and private approval broker. Wait for Stop to finish before starting another host over the same workspace.

**Reopen** selects the same workspace, configurations, declared host inputs and original imported runs. A new host gets a fresh process instance, HTTP session and private approval transport. Saved operator versions, acquisition attempts, retrieved files and accounting remain under their original native identities.

Use the existing **Recovery** workflow for a saved acquisition or an original workspace archive. Recovery reads the original records rather than creating a second purchase.

## Managed launch contract

The selected runtime exports the read-only helper `inspectRunbookWorkspaceSelection` from `buyer-runbook/launch.mjs`. Applications uses it during review to obtain:

- `selection`: canonical workspace and configuration paths, supplied and effective host declarations, imported-run identities, and approval mode.
- `selectionSha256`: a digest of those semantic selections and the selected source-file fingerprints.
- `inputFiles`: original immutable workspace, intake, declaration, import and plan records that existed at review.
- `sourceFiles`: relative source paths with byte counts and SHA256 digests, comparable between a selected installation and its managed copy.

The helper creates no state and reads no operator secret values. Mutable host-preset selection and purchase-attempt files are excluded from the launch digest, so normal work and the creation of initial workspace metadata do not invalidate a reviewed Reopen.

Applications passes `--expected-selection-sha256` to the original CLI. Start inspects before creating the workspace and again before publishing readiness. A changed source or semantic selection requires a current review.

The startup announcement and **GET /api/launch** use schema `stellar-forge.buyer-runbook-workspace-launch.v1` and contain the same selection, digest, source files, PID, fresh instance ID, loopback URL and explicit approval capability. The HTTP response contains no session token. The host retains the original loopback Host and Origin checks.

**GET /api/approval** returns the selected mode, availability, current run/execution/operation/intent binding, and the original native review. **POST /api/approval** requires the original host session and the exact current binding, approval ID and request digest. A repeated completed decision reconciles its original result; a completed or cancelled execution cannot accept a new decision.

The private Unix-socket path and ephemeral token belong to the launching host. Only that host supplies the two SF81 transport fields to its original operation environment. Neither received configurations, browser JSON, launch announcements nor saved workspace records select or retain those fields.

# Run and receive the complete governed application

This launcher prepares the original SCF application receiving operation on a Linux machine with Node24 and Python3. It fetches the exact 110 source files selected by the manifest, checks their immutable refs, lengths and SHA256 hashes, prepares MCP SDK 1.32.1, and invokes the existing `governed_receiving.mjs` once. The original runtime remains pinned at `0d58eaa67daef611146944ebc35613d78d206cb5`; three explicit source entries select the retained-schema receiving correction.

The source closure includes the application and its browser, HTTP and MCP surfaces, SF36 spending state, encrypted project capture and receiving, and the native spending recovery operation. It also includes the original SF36 `expired_resume.py` module imported by the approval console, using the same pinned source revision. All 110 selected files total 1,355,011 bytes. The launcher preserves the original receiving workflow. Its provider and payment responses remain the local integration fixtures defined in that source.

## Inputs and one command

Keep `receive_governed.py` and `governed_source_closure.json` together. Provide either the complete original `buyer-handoff` directory or the original `Cheesecake_Stellar_Agent_Integration_Kit_20261012.zip`. The original kit is 4,653,289 bytes with SHA256 `dd547ddde2bcab285a8b44990bdd184d69665702aae287d7c8289e9df89ff8de`. Its selected handoff is `reference/buyer-handoff/`.

Choose a new directory on the host's durable disk. The launcher creates it privately before preparing the source or starting the application:

```sh
python3 -B receive_governed.py \
  --kit /absolute/Cheesecake_Stellar_Agent_Integration_Kit_20261012.zip \
  --destination /absolute/cheesecake-complete-receiving
```

For an existing original handoff and installed MCP SDK:

```sh
python3 -B receive_governed.py \
  --handoff /absolute/original/buyer-handoff \
  --node-modules /absolute/installed/node_modules \
  --node /absolute/node24/bin/node \
  --python /absolute/python3 \
  --destination /absolute/cheesecake-complete-receiving
```

If all reviewed sources are already retained, add `--source /absolute/source-root`. Every source file is still checked against the same manifest. The launcher copies source into its own receiving directory, so the original repository and installed dependencies remain reusable.

Without `--node-modules`, npm installs only the declared MCP package and its dependencies in the new source directory with package scripts, audit and funding requests disabled. The exact generated package lock is retained in the delivery. With `--node-modules`, the original SDK version is checked and the existing module directory is linked. Node24 and Python executable paths are recorded with the run.

## Complete application journey

The original receiving operation opens the selected handoff and retains its request manifest. It exercises HTTP and MCP request discovery, a paid native operation with original SF36 reservation and approval, complete UTF8 result download, cancellation and revocation, and a restart that returns the same original quote and result.

It then captures the complete encrypted application project, opens the received project offline, reads the original result through HTTP and MCP without another provider operation, reattaches the original owner, restores the project with the original scoped signing keys, and verifies the same paid operation and result after restore. The native spending recovery journey runs in that same operation after the project restore.

The finished operation emits `case/receiving.json`. It contains the exact result hash and length, original quote and handoff identities, native recovery outcome, and all application recovery observations. The launcher checks that the native process exited successfully and that the report belongs to this original receiving operation.

## Retained handover

The new directory contains:

| Location | Contents |
| --- | --- |
| `source/` | All 110 reviewed source files; installed SDK or original dependency link |
| `original-input/` | Complete copied original buyer handoff, plus the original kit when supplied |
| `case/` | Original application state, SQLite stores, project capture, receiving and native recovery work |
| `delivery/native-receiving.log` | Actual native stdout and stderr, flushed to disk as the process runs |
| `delivery/run-state.json` | Preparation or native phase, original command, process ID and observed exit/result |
| `delivery/source-closure.json` | The exact source manifest used to prepare this run |
| `delivery/package-lock.json` | Exact npm resolution when this launcher installed the SDK |
| `delivery/receive_governed.py` | The launcher that prepared and retained this operation |

On completion or an observed process failure, the launcher creates a sibling ZIP, its SHA256 sidecar and `delivery/archive.json`. The ZIP contains retained case files, original inputs, delivery records and reviewed source; dependency trees remain available through the pinned package definition and installed lock. An interrupted native case remains at its original durable path with the already written logs and run state. An abrupt host failure can be inspected there before any continuation.

Each invocation requires a new destination. Use the retained original process and directory to inspect a running or interrupted case. If another receiving attempt is deliberately started after that inspection, its new destination keeps the earlier case and results available.

The case can contain private native state and scoped keys. The launcher uses private directories and files, and writes its archive with owner-only permissions. Deliver the archive through the original authorized customer or operator route.

## Retained tool schemas and a saved project continuation

The source closure keeps the original 0d58eaa67daef611146944ebc35613d78d206cb5 application and native engines, with the three request-receiving postimages selected explicitly at 7f4fb651757cbcf8a061d27b62e9c967bc1879e5. Each changed entry carries its own immutable `ref`, byte length and SHA-256. The launcher fetches that exact ref and verifies every selected byte; a supplied local source root must match the same complete manifest.

An unpinned remote tool schema is learned during original discovery. The encrypted project verifier now checks that learned hash against the captured native request, quote UUID, original ticket digest, complete invocation and accepted payment terms. It then checks the full retained request and review. A configured schema hash remains an exact selection constraint.

To continue a saved case that completed the original purchase and wrote `project-archives/original-application-recovery.receipt.json`, retain its original canonical application, handoff, source-reference paths and private fixture environment. Preserve those bytes and the original complete archive. Run the corrected operation at the original fixture module path, with the corrected receiver source in a separate directory:

```sh
node /ORIGINAL_SOURCE/stellar/scf-starforge-20261009/partners/cheesecake-stellar-agent/operations/governed_receiving.mjs \\
  --handoff /ORIGINAL_HANDOFF \\
  --work /ORIGINAL_CASE \\
  --python /ABSOLUTE_PYTHON \\
  --resume-with /CORRECTED_RECEIVER_SOURCE
```

The same operation reads the retained quote and complete result, replays the same snapshot operation ID, receives the encrypted project, reads and exports all captured bytes, reattaches the original owner, and restores the canonical owner with its scoped original keys. Its continuation report carries the prior quote, archive and result identities; signing and signed-call counters describe this continuation and must remain zero. The existing original native-spending recovery case then completes the full handover. Keep the prior runtime entrypoint alongside its corrected postimage in the delivery record; changing the receiver does not rewrite the encrypted project’s source references.

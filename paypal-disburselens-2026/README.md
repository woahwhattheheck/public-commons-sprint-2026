# DisburseLens

**A merchant workspace for understanding and following up PayPal payout batches.**

DisburseLens combines the original PayPal sandbox reader, exact-cent reconciliation, locally trained note classifier, and two-observation comparison in one application. Review a batch, see what changed since the previous observation, assign a case, record a disposition and note, then reopen the same saved workspace. The interface uses the original payout items throughout; a local review decision never changes the provider's payout status.

MIT · Node.js 22+ · no package installs · local browser interface

## Start the complete application

Keep the **whole `paypal-disburselens-2026` directory** together, including `src/`, `public/`, `fixtures/`, and `longitudinal/`. The comparison module imports the original reconciler and fixture from sibling directories; copying `longitudinal/` alone is insufficient.

From that directory:

```sh
npm start -- --data-dir "$HOME/.disburselens/review"
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). The first launch opens the original six-item fictional example. The explicit data directory saves observations, selected batch, case assignments, notes, dispositions, and review history. Stop with Ctrl+C and use the same command to resume.

`node src/server.mjs --data-dir /private/path/review` runs the same server directly. `DISBURSELENS_DATA_DIR` supplies the directory when the flag is omitted; relative paths resolve from the launch directory. `PORT` changes the default port of 8787. The server listens on loopback.

Running without a data directory keeps the original in-memory mode. The interface identifies the storage mode so the reviewer can see whether the workspace will survive a server restart.

## Review a payout from start to finish

1. Open an observation and check its source, capture time, batch ID, and evidence hash. The original fixture contains six payouts totalling $700.00.
2. Filter the queue and open a payout. Inspect the provider status, exact amount, duplicate sender ID, nonfinal or failed status, and any learned note signals together.
3. Inspect the AI explanation. The app shows the original source note, the portion scored by the model, and the strongest known token contributions. Provider status and amounts continue to come from the original pages.
4. Set a local disposition: `open`, `acknowledged`, or `escalated`. Add a reviewer/owner and a concrete follow-up note, then save. The case history records the saved change.
5. Open another observation or restart the server with the same data directory. Returning to the first observation restores its own review state. A newly captured observation gets its own review; cases from an earlier observation are not silently carried over.
6. Export the current CSV, individual case review, or portable casebook when needed. Use the original observation JSON to retain or move the complete source pages. Comparison exports use the original offline HTML and CSV renderer.

The owner field is an operator-supplied label. The local history records edits made in this workspace; it is not an authenticated user directory.

## Reproduce the accepted two-observation example

The existing longitudinal CLI creates the original pair used for the lifecycle exercise. It uses the repository's six-item fixture and changes two payout statuses over an explicitly fictional 48-hour interval.

```sh
node longitudinal/cli.mjs demo --out "$HOME/.disburselens/example-oct11"
```

The output directory must be new. In the application, use **Import observation** to select `before.json`, then import `after.json` from that directory. Each import validates the original envelope and complete batch before selecting it. Open the comparison view and choose:

| Setting | Value |
| --- | --- |
| Baseline | October 9, 2026, 09:00 UTC |
| Follow-up | October 11, 2026, 09:00 UTC |
| Stalled interval | 24 hours |
| Source | fictional example |

The original comparison produces:

| Result | Count |
| --- | ---: |
| Payouts | 6 |
| High priority | 3 |
| Review | 2 |
| Clear | 1 |
| Status changes | 2 |
| Stalled nonfinal payouts | 1 |

`ITEM-001` changes from `SUCCESS` to `REVERSED`; `ITEM-003` changes from `PENDING` to `SUCCESS`; `ITEM-006` remains `UNCLAIMED` for the full interval. The comparison retains the original sender-ID duplication and learned note signals. Open the follow-up observation to save the corresponding local review work.

For the same result as portable offline HTML, CSV, and JSON:

```sh
node longitudinal/cli.mjs compare \
  --before "$HOME/.disburselens/example-oct11/before.json" \
  --after "$HOME/.disburselens/example-oct11/after.json" \
  --out "$HOME/.disburselens/example-oct11/report" \
  --stale-hours 24
```

The new report directory contains `review.html`, `review.csv`, `report.json`, and `manifest.json`. It uses the same original `analyzeSnapshots` implementation as the application's comparison. `npm run lifecycle -- ...` is an alias for this CLI.

## Use authorized PayPal sandbox observations

The existing connector uses OAuth client credentials and PayPal's [Show payout batch details](https://developer.paypal.com/api/payments.payouts-batch/v1/payouts-get/) API. Supply `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in the server's private environment. The sandbox application needs the Payouts permission and an existing payout batch that the operator is authorized to read.

Enter that existing batch ID in the application's sandbox capture control. Capture is explicit: the server reads all required pages, validates them with the original reconciler, saves the completed observation, and selects it. A failed or inconsistent capture leaves the previously selected review intact.

The standalone command performs the same sandbox read and writes a portable observation:

```sh
node longitudinal/cli.mjs capture \
  --batch EXISTING_SANDBOX_BATCH_ID \
  --out /private/path/batch-before.json
```

Capture the same batch later into a different new file to compare its actual evolution. Both observations must have the same batch and source, valid chronological capture times, and complete source pages. The stalled interval is an operator-selected integer between 1 and 720 hours.

The fixed provider host is `https://api-m.sandbox.paypal.com`. The connector performs `POST /v1/oauth2/token` and paginated `GET /v1/payments/payouts/{id}`. It supports up to 10 pages of 100 items and checks page, batch, amount, currency, and declared count consistency. These are separate observations of an evolving batch; capture times are retained in every comparison.

All payout operations in this application are observations. Local acknowledgement, escalation, assignment, import, and restore update the review workspace only.

## What the AI contributes

`src/model.mjs` trains a multinomial Naive Bayes classifier at process startup using 24 included labeled fictional payout narratives. Classification executes locally, with no model account, API key, download, or paid inference call.

The original reconciler supplies up to the first 320 characters of a payout note. The model tokenizes that text, scores known vocabulary with Laplace smoothing, and returns a review score, matching-token count, label, and strongest token contributions. The detail panel connects those contributions to the source note the operator is reading.

Use the score to prioritize human review alongside deterministic flags and original provider facts. This small example model has not been calibrated as a fraud or settlement predictor. Replacing the training examples is an application change that should be evaluated with representative labeled merchant cases.

## Saved workspace and recovery

Durable mode stores one private, atomic workspace file containing the original observation envelopes, each observation's local cases and retained audit events, the selected observation, and the current version. A save becomes visible after its replacement file is committed. A failure before replacement leaves the previous review intact. If replacement completed but the filesystem could not confirm the final directory flush, the current version advances and the interface asks the operator to refresh before acting again.

Observations are identified by source, capture time, and original page evidence. Reimporting the exact same observation returns to its saved review; recapturing the same batch at a different time remains a separate observation. The workspace holds up to 128 observations, at most 4 MiB per envelope and 64 MiB in total. The interface shows capacity and supports explicit removal of an observation and its local review when it is no longer needed; at least one observation remains.

A single writer owns the directory. The Linux recovery check uses the original procfs process ID and start time in the same boot and procfs view, so a recycled runtime PID cannot make a dead writer appear active. Concurrent writers are rejected. Restart with the same directory to recover the last completed save after an interrupted process.

Directories are private and workspace files use mode 0600. Original observation JSON includes full source recipients and notes. The current CSV masks the provider recipient and includes the local owner and review note; the individual case JSON also contains its original source note and local history. Portable source exports and the saved workspace should therefore stay with the authorized reviewer. Up to 1,000 recent audit events are retained per observation, with an explicit count of older events removed from that history.

### Portable casebooks

The existing `disburselens-casebook/v1` format remains a compact state-only export. It contains the source, evidence hash, complete case IDs, local dispositions, export time, and historical version. Observation JSON carries source pages; the durable workspace also carries assignments, notes, and history.

Choose a casebook in the recovery panel, inspect the proposed changes, then explicitly restore. Preview and restore require the same source evidence and complete case-ID set. Restore checks the current report version; an intervening edit or observation switch requires a fresh preview. File selection and preview do not save changes. A state-only restore preserves the selected observation's current owner and note annotations.

Casebooks from the original application's `fixture` source label can be restored against the exact canonical fixture evidence. The preview identifies this legacy compatibility path; other fictional examples and sandbox observations still require their matching source and evidence.

The interface refreshes after a stale-version or uncertain-response error so the operator can inspect the current state before acting again. It does not automatically repeat review mutations.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/server.mjs` | Original application server, saved observation selection, review APIs, and launch |
| `src/observations.mjs` | Atomic private workspace storage, observation identity, retained history, and writer recovery |
| `src/paypal.mjs` | Original fixed-host sandbox OAuth and complete paginated payout read |
| `src/reconcile.mjs` | Original exact-cent batch checks, source hashes, masked rows, and deterministic flags |
| `src/model.mjs` | Original local training and interpretable note classification |
| `src/casebook.mjs` | Original portable state export and source-bound restore planning |
| `public/` | Observation library, review queue, source explanation, comparison, and recovery interface |
| `longitudinal/` | Original envelope validation, comparison, standalone capture, and offline reports |
| `fixtures/payout_batch.json` | Original six-item fictional example |

The repository retains its original focused checks. The full application can be exercised through the startup, import, review, restart, comparison, and export path above without running a hosted CI job.

## PayPal AI Hackathon 2026

This is the original DisburseLens entrant's working application. The [official overview](https://paypalaihackathon.devpost.com/) lists a November 12, 2026, noon PST deadline and requires meaningful PayPal and AI integration, public open-source code, a working build with usable setup, English materials, and a functional demonstration video under three minutes. The entrant maintains the official submission and publishes the final video.

The included example and recorded fixture workflow are explicitly labeled fictional. An authorized sandbox capture retains its own source label, batch pages, and capture time, and uses the same application and analysis path.

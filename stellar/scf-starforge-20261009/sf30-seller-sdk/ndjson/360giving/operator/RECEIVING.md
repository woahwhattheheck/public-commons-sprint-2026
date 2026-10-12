# Receive a complete 360Giving publisher handoff

This ZIP carries one complete publisher edition and the work performed on it: original input files, full publisher review, exact saved decisions, selected candidate, native projects, comparison and portable operator source.

## Open with an installed operator

Create a separate private workspace with the installed command:

~~~sh
starforge dataset-360giving-workspace --workspace /path/to/receiving-workspace init
starforge dataset-360giving-workspace --workspace /path/to/receiving-workspace serve
~~~

Open the printed private URL and choose this ZIP under **Receive a complete handoff**. The saved operation retains every source member, verifies the complete publisher package, reconstructs the original native projects, and reopens their exact source/mapping/build identities.

The equivalent CLI operation is:

~~~sh
starforge dataset-360giving-workspace --workspace /path/to/receiving-workspace receive \
  --request original-fund-receiving --file /path/to/360giving-complete-handoff.zip
~~~

Retain that request ID. After interruption, reopen the same workspace and run `resume --id original-fund-receiving`. A repeated completed request returns its saved result.

Receive another fund's complete ZIP into the same workspace when desired. Its dataset key keeps the native project separate. Later reviews of an existing edition remain alongside earlier reviews.

## Use the portable source

`runtime/sf30-seller-sdk/` contains the full saved-workflow and native-engine source closure. Preserve that hierarchy when placing the selected source installation on another machine. Use Python 3.11+ and Node 22+:

~~~sh
python3 -m pip install -r runtime/sf30-seller-sdk/ndjson/360giving/requirements.txt
node runtime/sf30-seller-sdk/ndjson/360giving/operator/cli.mjs \
  --workspace /path/to/receiving-workspace init
node runtime/sf30-seller-sdk/ndjson/360giving/operator/cli.mjs \
  --workspace /path/to/receiving-workspace receive \
  --request original-fund-receiving --file /path/to/360giving-complete-handoff.zip
~~~

Use this portable source when it is the installation you selected for receiving. An already installed operator imports the data with its own trusted implementation; the receiving operation retains the archive's code as source.

The portable source includes the original schemas, attribution, examples, standalone publisher and complete operator guide at `runtime/sf30-seller-sdk/ndjson/360giving/operator/README.md`.

## Contents

| Member | Purpose |
| --- | --- |
| `manifest.json` | Complete membership, byte counts and SHA-256 identities. |
| `handoff.json` | Original workspace/request, dataset, edition, decisions, candidate and native selections. |
| `inputs/source`, `inputs/registry` | Exact original uploaded files. |
| `inputs/capture`, `inputs/transport` | Exact original optional inputs when supplied. |
| `publisher.zip` | Complete source, review, schemas, mapping, saved decisions and candidate. |
| `native-original.zip` | Original source, mapping, CSV, configuration and native build review when ready. |
| `native-candidate.zip` | The selected candidate's complete native project when included. |
| `comparison.json`, `changes.jsonl` | Complete comparison when both projects are included. |
| `runtime/sf30-seller-sdk/` | Portable source for the complete workflow. |

The publisher review remains editable in the receiving workspace. Creating the same candidate again reopens its original identity and provenance. A new saved review creates a separately identified candidate. Every incoming handoff remains under `received/` with its original request and source directory.

The native query and comparison views read the reconstructed original engine. Exact monetary text, optional-value states, grant identifiers and full original grant JSON remain available.

Keep the complete ZIP and its manifest together. Open the receiving workspace to continue the work, export a later handoff, or read the exact original operation again.

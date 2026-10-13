# Receive complete operator downloads

The existing operator client now resumes interrupted files instead of discarding
received bytes. It can also receive every file in a completed task as one retained
cohort. This uses the original authenticated operator, saved task and file tickets.
The scientific workspace, native runs and task history stay unchanged.

## One retained file

Use the current original operator startup JSON. It contains the private local
capability and stays on the receiving machine.

```sh
python -B operator/rehearsal_cli.py --connection /private/operator-startup.json \
  download --task ORIGINAL_COMPLETE_TASK_ID --member EXACT_FILENAME_OR_TICKET_ID \
  --out /data/receiving/scientific-workspace.zip --progress
```

Substitute the complete task ID and exact filename or ticket ID returned by that
task. After a connection loss or process interruption, run the same command with
the same destination. The receiver rechecks its durable local prefix and requests
only the missing suffix from the original operator. A restarted operator can use
its new startup JSON; reopening the task recreates the original file tickets.
The checksum and byte length, rather than a port or session token, identify the
retained body.

Progress goes to standard error when requested; the final structured result goes
to standard output. Results keep `path`, `bytes`, `sha256` and `reused`, adding
`resumed_bytes`, `received_bytes` and elapsed time. An already complete matching
file is reused after checking its original checksum.

## Every download from a completed task

```sh
python -B operator/rehearsal_cli.py --connection /private/operator-startup.json \
  download-all --task ORIGINAL_COMPLETE_TASK_ID \
  --out /data/receiving/complete-project --progress
```

The command receives the complete `_downloads` list provided by that task. This
includes whichever archive, report, maps, tables or source companions the original
task exposes. It does not generate additional model results or recursively invent
unlisted files.

`COHORT.json` retains the selected task/workspace identifiers, original relative
file tickets, filenames, labels and expected complete checksums. Numbered native
filenames preserve distinct members with identical names. Repeated exact tickets
share one received member, with all their original labels recorded in the plan.
`RECEIVING.json` carries durable member progress and completed results.

Repeat the same command and directory after an interruption. Completed members
are checked and reused; the interrupted member resumes; subsequent members follow
in the original order. A different cohort needs its own directory, so a later task
cannot silently replace an earlier selection. The final result reports unique
completed members and total unique bytes; `selected_ticket_count` in the plan also
retains the original count including repeated tickets.

## Receiving behavior

The receiver keeps a private staging directory beside each destination and
checkpoints at eight MiB intervals. Durable bytes are flushed before the prefix
checksum and committed offset are saved. On restart, the receiver verifies that
prefix and removes only its own tail beyond the last durable checkpoint. Normal
read errors also checkpoint successfully received trailing bytes.

Downloads use bounded one-MiB reads. Continuation requires the original strong
ETag, exact remaining Content-Length and exact Content-Range. The client stays on
`127.0.0.1` and does not follow redirects. Checkpoints contain the body identity,
destination basename and progress, never the private connection token. The
original server still authorizes and verifies every requested file.

The full checksum is checked before atomic, non-overwriting publication. A
concurrent receiver for the same destination gets a busy file lock; a different
existing final file remains untouched. Local locks are released by the operating
system when a process exits, including abrupt termination. Lock files themselves
remain reusable and contain no credentials.

A changed prefix, incompatible response or changed cohort produces an error while
preserving the receiving files. For a changed scientific selection, choose a new
destination or cohort directory. An intentionally abandoned transfer can be
removed by deleting its private `.upstate-download-...` staging directory while
that destination is idle; preserve the final file and do not remove active lock
files. There is no automatic deletion of another selection's receiving state.

## Use from the original Python client

```python
from pathlib import Path
import sys

# Run from the original application directory.
sys.path.insert(0, str(Path("operator").resolve()))
from rehearsal_cli import Client

client = Client('/private/operator-startup.json')
task = client.task(original_task_id)
result = client.download_all(
    task['_downloads'], '/data/receiving/complete-project', task=task['id'])
```

The existing `Client.download(ticket, destination)` call remains compatible.
`Client.download_all(tickets, directory, task=...)` supports the complete selected
cohort, including receiving callers that already hold original file tickets.
Both accept an optional `progress` callback with credential-free structured state.
A callback exception interrupts receiving and retains its checkpoint.

## Source adoption

The complete current rehearsal source includes `model/retained_download.py` and
this guide. The maintained `operator/install_rehearsal.py` carries both with the
client. It still reads complete original ten-file packets for older clients;
a client that imports the new receiver requires its complete current packet.
Receive and compose current source using the original installer, preserving
concurrent application edits. Complete workspace/application archives include
these files through their normal `model/` and `operator/` source inventory.

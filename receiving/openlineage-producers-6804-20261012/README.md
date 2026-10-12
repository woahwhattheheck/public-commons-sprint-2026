# Complete native OpenLineage producer operation

This packet contains the complete 41-file application and its product metadata. It is the exact application source merged in public PR2321 and maintained product PR222. The original operating journey and the producer journey execute the application through native HTTP, typed clients, MCP, merchant operations and independent application receiving.

Source packet Git blob: c3cdef0798617b2f0d31685876688f870bb530d3.
Public application merge: 5995bd45d277863cd686b892a6e4d7263ebfb95a.
Maintained product merge: 3a2b5831a32319f1ce39e0f08a67bc1856e6f66b.

## Materialize the complete source

Use an existing Node 22+ and Python 3 runtime. Select an owned source directory with enough space for the complete original workspaces and received copies. The application uses Node builtins.

```sh
python3 - source-packet.json /absolute/owned/openlineage-source <<'PY'
from pathlib import Path, PurePosixPath
import hashlib, json, sys
raw = Path(sys.argv[1]).read_bytes()
assert hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == "c3cdef0798617b2f0d31685876688f870bb530d3"
packet = json.loads(raw)
root = Path(sys.argv[2])
root.mkdir(parents=True, exist_ok=False)
assert len(packet["files"]) == 41
for item in packet["files"]:
    name = item["path"]
    assert PurePosixPath(name).name == name and name not in ("", ".", "..")
    (root / name).write_bytes(item["content"].encode("utf-8"))
PY
```

## Run the complete original programmes

```sh
node /absolute/owned/openlineage-source/RECEIVING.mjs /absolute/owned/openlineage-merchant-operating
node /absolute/owned/openlineage-source/PRODUCER_RECEIVING.mjs /absolute/owned/openlineage-producer-operating
```

Capture full stdout and stderr in the owned operation. The first programme uses a new owned operation directory. The producer programme retains its original checkpoint, workspace identity, prepared export and completed stages; continue that programme through the same directory after an interruption.

The producer journey includes simultaneous plain/gzip arrivals, exact original replay, actual writer backpressure, private Python/Java configurations, server restart, complete export and independently receiving and starting the included application. Each programme verifies its unchanged upstream event fixtures before execution.

Return the complete generated workspace packages, reports and native result files with this full source packet. Keep runtime connection files, operator-token, producer-token and generated Python/Java configuration files private; a receiving operator generates new credentials through the included producer guide. The complete workspace packages retain the editable application, original source bytes, saved editions, reviews, results and operation history.

The original task also retains the earlier 35-file application export. Use the new application's verify command against that unchanged package when it is available to the receiving runtime:

```sh
node /absolute/owned/openlineage-source/cli.mjs verify --input /absolute/earlier/openlineage-workspace.json
```

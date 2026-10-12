# Merchant provider lifecycle receiving

This is the complete source and unchanged native receiving for operation `merchant-provider-lifecycle-native-ee290-20261012`.

## Source

The retained 93-file composition is commit `6668e417044170e9c2291afe9e50e7ef14c3d97d`, a direct child of the original `25621a9d66257afab373b6f7b67d9684cb023ee1` receiving cut. Every file has its original Git identity in `source-map.json`; the wrapper verifies the complete carrier blob `a85b9dc0cea654ae7ae75149d2759f8c086c89a4` before materialization.

This continuation preserves the original source, native loopback gRPC exchange, operator ownership and receiving driver. It adds the abort normalization correction exposed by the first actual run. Node's native AbortError carries numeric code 20, which the original adapter treated as a string. The type check keeps the intended GRPC_OPERATION_INTERRUPTED error and preserves original native HTTP/domain and storage failures.

The same correction is applied independently to the complete current gRPC adapter, preserving its later reflection, streaming and upgrade integrations.

## Run

Use the existing installed Python 3 and Node 24 or newer. Materialize `receive.py` and `source-map.json` from this same published directory, then run:

```sh
python3 -B receive.py source-map.json \
  --directory /ABS/PRIVATE/provider-lifecycle-continuation \
  --node /ABS/EXISTING/node
```

Choose a new private output directory for this continuation; preserve the first receiving record. The wrapper creates the source tree, checks all original module syntax and source identities, runs the original receiver, and writes its complete report, stdout, stderr and started record.

The receiving covers the actual retained gRPC call and concurrent native stop; shutdown/disconnect; provider loading admitted before close; and the original retained file-owner failure, recovery and reopening behavior. A passing report names each completed stage and the exact selected source identity.

## Completed native continuation

The original operation completed on Node 24.19.0 at 2026-10-12T11:41:50.704Z, with source composition `6668e417044170e9c2291afe9e50e7ef14c3d97d`. The complete result is `native-completed-run.json` (SHA256 `37ff878e025c7964c30ec867bc5d10a1ee7e0dafbed1dd632e92dc2c0eef32a1`).

All three native stages passed: exact identity of 93 files; actual gRPC call/concurrent stop/cancellation plus late provider-load closure; and retained native file ownership, failed child-close recovery, parent ordering and reopening. Source identity SHA256: `f2cb15b7db0bcda116b1ac505d71d22a7e8397a88fbd66cc80ccca41ecf116f7`.

The original full result is also delivered in the same receiving thread:
https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791805552967609?thread_ts=1791794627.499289

## First result and correction

The original native run started at 2026-10-12T11:22:50.144Z on Node 24.19.0. All 93 source identities and syntax passed. The real gRPC call, stop and shutdown reached the cancellation assertion, which exposed the masked error. Its complete original record is `native-first-run.json`.

Current operation custody and the complete continuation belong to the original thread:
https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791794627499289

Consume the published result from that operation before launching another receiving.
